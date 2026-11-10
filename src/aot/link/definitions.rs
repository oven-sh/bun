#[cfg(test)]
mod family_tests;
#[cfg(test)]
mod library_base_tests;
#[cfg(test)]
mod tests;

use bun_sema::util::SharedSort;
use bun_sort_by_number::number_of_pair;

use super::beside::{Beside, run_steps_beside};
use super::grouped::Grouped;
use super::merged_keys::{Merged, MergedKeys};
use super::program_keys::{
    InProject, KeyContext, ProgramFunctionKey, ProgramLayoutKey, ProgramModule, ProgramVariableKey,
};
use super::state::{
    DefinitionSite, Definitions, ExportWriter, RuntimeFunctionRoot, SupertypeEdges,
    VariableDefinition,
};
use super::tables::LinkTables;
use super::unit::LinkUnit;
use super::unused_records::{set_mark, unmarked};
use super::{Projects, key_context};
use crate::builtins::RuntimeModule;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{Layout, LayoutKind, Variable, VariableFlags, VariableInitialization};
use crate::ir::parallel::map_each;
use crate::ir::{
    DeclaredType, FunctionKey, Id, InParallel, LayoutId, LayoutKey, ModuleId, StringId, TypeFlags,
    TypeTable, VariableKey, for_each_mut,
};
use crate::load::{ProgramFile, ProjectId};
use crate::lower::ObjectTypeKey;
use crate::modules::{ModuleKind, ModuleRef, SyntheticExport, SyntheticExportId};
use crate::statistics::{Stage, StepClock};
use core::mem::replace;
use core::ops::Range;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;
use std::sync::atomic::{AtomicU64, Ordering};

fn numbered_synthetic_exports<'a>(
    context: &KeyContext<'a>,
) -> impl Iterator<Item = (SyntheticExportId, &'a SyntheticExport)> {
    (0..)
        .map(SyntheticExportId)
        .zip(context.graph.synthetic_exports())
}

fn is_common_js_file(projects: &Projects<'_, '_>, file: ProgramFile) -> bool {
    let graph = projects.get(file.project).graph;
    graph.has_record(file.file)
        && graph.kind(file.file) == ModuleKind::CommonJs
        && !graph.is_library(file.file)
}

fn find_file_with_copies(
    projects: &Projects<'_, '_>,
    exporter: ProgramModule,
) -> Option<ProgramFile> {
    match exporter {
        ProgramModule::File(file) => is_common_js_file(projects, file).then_some(file),
        _ => None,
    }
}

fn find_writer(projects: &Projects<'_, '_>, exporter: ProgramModule) -> ExportWriter {
    match exporter {
        ProgramModule::File(file) => match is_common_js_file(projects, file) {
            true => ExportWriter::Body,
            false => ExportWriter::Loader,
        },
        ProgramModule::Inner { .. } => ExportWriter::Body,
        ProgramModule::Facade(_) | ProgramModule::Check(_) => ExportWriter::Facade,
        ProgramModule::Runtime(_) | ProgramModule::External { .. } => ExportWriter::Loader,
    }
}

pub(super) fn synthetic_export_keys(projects: &Projects<'_, '_>) -> Vec<ProgramVariableKey> {
    let mut keys = Vec::new();
    for project in ProjectId::ALL {
        let context = key_context(projects, project);
        let exports = numbered_synthetic_exports(&context);
        keys.extend(exports.map(|(id, _)| context.variable_key(VariableKey::SyntheticExport(id))));
    }
    for project in ProjectId::ALL {
        let context = key_context(projects, project);
        let exports = numbered_synthetic_exports(&context).filter(|(_, export)| {
            find_file_with_copies(projects, context.module(export.module)).is_some()
        });
        keys.extend(exports.map(|(id, _)| context.variable_key(VariableKey::Copy(id))));
    }
    let named_by_mocks = runtime_modules_named_by_mocks(projects).into_iter();
    keys.extend(named_by_mocks.map(ProgramVariableKey::MockOfRuntimeModule));
    keys
}

pub(super) fn forget_library_layouts_without_definition(
    units: &mut [LinkUnit],
    tables: &[LinkTables],
    layouts: &MergedKeys<'_, ProgramLayoutKey>,
    in_parallel: InParallel<'_>,
) {
    let is_defined = unmarked(layouts.keys.len());
    let tasks: Vec<&[LinkUnit]> = units.chunks(UNITS_IN_A_TASK).collect();
    in_parallel(tasks.len(), &|task| {
        for unit in tasks[task] {
            let local_to_merged = &layouts.local_to_merged[unit.tables as usize];
            for (layout, _) in &unit.layout_definitions {
                set_mark(&is_defined[local_to_merged[layout.index()] as usize]);
            }
        }
    });
    let mut tasks: Vec<&mut [LinkUnit]> = units.chunks_mut(UNITS_IN_A_TASK).collect();
    for_each_mut(&mut tasks, in_parallel, &|units| {
        for unit in units.iter_mut() {
            let project = unit.file.project;
            let keys = &tables[unit.tables as usize].layouts;
            let local_to_merged = &layouts.local_to_merged[unit.tables as usize];
            let has_layout = |layout: LayoutId| {
                keys[layout.index()].project == project
                    || is_defined[local_to_merged[layout.index()] as usize].load(Ordering::Relaxed)
            };
            for (_, definition) in &mut unit.layout_definitions {
                definition.base = definition.base.filter(|&base| has_layout(base));
            }
            unit.supertype_edges
                .retain(|&(layout, supertype)| has_layout(layout) && has_layout(supertype));
        }
    });
}

fn order_definitions_of_layout(
    definitions: &mut [(LayoutId, Layout)],
    start: u32,
    types: &mut [(u32, ObjectTypeKey)],
) {
    let mut types_of_definitions = types.iter().peekable();
    let mut order: SmallVec<[(Option<ObjectTypeKey>, u32, u32); 8]> = SmallVec::new();
    for (index, (_, definition)) in (0..).zip(definitions.iter()) {
        let ty =
            types_of_definitions.next_if(|&&(of_definition, _)| of_definition == start + index);
        order.push((ty.map(|&(_, ty)| ty), definition.position, index));
    }
    if order.is_sorted() {
        return;
    }
    order.sort_unstable();
    let mut taken: SmallVec<[Layout; 8]> = SmallVec::new();
    taken.extend(definitions.iter_mut().map(|it| core::mem::take(&mut it.1)));
    for (definition, &(.., from)) in definitions.iter_mut().zip(&order) {
        definition.1 = core::mem::take(&mut taken[from as usize]);
    }
    let in_order = (start..).zip(&order);
    let in_order = in_order.filter_map(|(index, &(ty, ..))| Some((index, ty?)));
    for (ty, in_order) in types.iter_mut().zip(in_order) {
        *ty = in_order;
    }
}

pub(super) fn order_layout_definitions(units: &mut [LinkUnit], in_parallel: InParallel<'_>) {
    let mut tasks: Vec<&mut [LinkUnit]> = units.chunks_mut(UNITS_IN_A_TASK).collect();
    for_each_mut(&mut tasks, in_parallel, &|units| {
        for unit in units.iter_mut() {
            let (mut start, mut first_type) = (0, 0);
            for of_layout in unit
                .layout_definitions
                .chunk_by_mut(|one, next| one.0 == next.0)
            {
                let end = start + of_layout.len() as u32;
                let types = &mut unit.object_types[first_type..];
                let type_count = types.partition_point(|&(of_definition, _)| of_definition < end);
                if of_layout.len() > 1 {
                    order_definitions_of_layout(of_layout, start, &mut types[..type_count]);
                }
                (start, first_type) = (end, first_type + type_count);
            }
        }
    });
}

pub(super) fn choose_definitions(
    merged: &Merged<'_>,
    projects: &Projects<'_, '_>,
    beside: Beside<'_>,
) -> Definitions {
    debug_assert!(merged.units.is_sorted_by_key(|unit| unit.file));
    let unit_count = merged.units.len() as u32;
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let ((functions, variables), chosen_layouts) = run_steps_beside(
        beside,
        &mut steps,
        ["definitions of functions and variables", "of layouts"],
        || {
            let functions = choose_functions(merged);
            let mut variables = vec![None; merged.variables.keys.len()];
            for unit in 0..unit_count {
                choose_variables(merged, unit, &mut variables);
            }
            (
                functions,
                add_synthetic_exports(merged, projects, variables),
            )
        },
        || choose_layouts(merged),
    );
    Definitions {
        functions,
        layouts: chosen_layouts.sites,
        bases_of_layouts: chosen_layouts.bases,
        other_layout_definitions: chosen_layouts.others,
        variables,
        runtime_functions: collect_runtime_functions(merged),
        supertypes: SupertypeEdges::default(),
        has_members_without_layout: Vec::new(),
        function_types: SupertypeEdges::default(),
        builtin_members: Vec::new(),
    }
}

pub(super) struct RelatedLayouts(ClosedFamilies);

pub(super) fn relate_layouts(
    merged: &Merged<'_>,
    bases_of_layouts: &[Option<u32>],
) -> RelatedLayouts {
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let supertypes = merge_supertype_edges(merged);
    steps.end("families: supertype edges of the units");
    RelatedLayouts(close_families(merged, bases_of_layouts, supertypes))
}

pub(super) struct RelatedFunctions {
    function_types: SupertypeEdges,
    builtin_members: Vec<(u32, BuiltinId)>,
}

pub(super) fn relate_functions(merged: &Merged<'_>) -> RelatedFunctions {
    let function_types = merge_function_type_edges(merged);
    RelatedFunctions {
        function_types: create_supertype_edges(merged.functions.keys.len(), &function_types),
        builtin_members: merge_builtin_members(merged),
    }
}

impl Definitions {
    pub(super) fn add_related_layouts(&mut self, related: RelatedLayouts) {
        let RelatedLayouts(families) = related;
        self.supertypes = families.supertypes;
        self.has_members_without_layout = families.has_members_without_layout;
    }

    pub(super) fn add_related_functions(&mut self, related: RelatedFunctions) {
        self.function_types = related.function_types;
        self.builtin_members = related.builtin_members;
    }
}

#[cfg(test)]
pub(super) fn choose_and_relate_definitions(
    merged: &Merged<'_>,
    projects: &Projects<'_, '_>,
    beside: Beside<'_>,
) -> Definitions {
    let mut definitions = choose_definitions(merged, projects, beside);
    let layouts = relate_layouts(merged, &definitions.bases_of_layouts);
    definitions.add_related_layouts(layouts);
    definitions.add_related_functions(relate_functions(merged));
    definitions
}

fn choose_functions(merged: &Merged<'_>) -> Vec<Option<DefinitionSite>> {
    const WITHOUT_PARAMETERS: u64 = 1 << 63;
    const NO_DEFINITION: u64 = u64::MAX;
    assert!(
        merged.units.len() < i32::MAX as usize,
        "the highest bit of the number of a unit is free"
    );
    let keys = &merged.functions.keys;
    let chosen: Vec<AtomicU64> = keys.iter().map(|_| AtomicU64::new(NO_DEFINITION)).collect();
    (merged.in_parallel)(merged.units.len(), &|unit| {
        let link_unit = &merged.units[unit];
        for (index, (id, definition)) in (0u32..).zip(&link_unit.function_definitions) {
            let function = merged.function(link_unit, *id) as usize;
            let key = keys[function].key;
            let is_function_type = matches!(
                key,
                FunctionKey::Signature(_) | FunctionKey::ClassSignature(_)
            );
            let number = match is_function_type && definition.parameters.is_empty() {
                true => WITHOUT_PARAMETERS | number_of_pair(unit as u32, index),
                false => number_of_pair(unit as u32, index),
            };
            let other = chosen[function].fetch_min(number, Ordering::Relaxed);
            debug_assert!(
                is_function_type || other == NO_DEFINITION,
                "two definitions of {key:?}"
            );
        }
    });
    let chosen = chosen.into_iter().map(AtomicU64::into_inner);
    chosen
        .map(|number| {
            (number != NO_DEFINITION).then_some(DefinitionSite {
                unit: ((number & !WITHOUT_PARAMETERS) >> 32) as u32,
                index: number as u32,
            })
        })
        .collect()
}

#[derive(Copy, Clone)]
struct DefinedLayout {
    layout: u32,
    site: DefinitionSite,
    object_type: Option<ObjectTypeKey>,
    is_mentioned_by_code: bool,
    has_place: bool,
    base: Option<u32>,
}

const UNITS_IN_A_TASK: usize = if cfg!(test) { 2 } else { 64 };
const KEYS_IN_A_TASK: usize = if cfg!(test) { 8 } else { 1 << 12 };
const MAX_PARTS_OF_LAYOUTS: u32 = if cfg!(test) { 4 } else { 256 };

fn list_defined_layouts(
    merged: &Merged<'_>,
    first_unit: u32,
    units: &[LinkUnit],
    layouts_in_a_part: u32,
    part_count: usize,
) -> Grouped<DefinedLayout> {
    let mut defined = Vec::new();
    for (unit, link_unit) in (first_unit..).zip(units) {
        let mut types_of_definitions = link_unit.object_types.iter().peekable();
        for (index, (id, definition)) in (0..).zip(&link_unit.layout_definitions) {
            let ty = types_of_definitions.next_if(|&&(of_definition, _)| of_definition == index);
            defined.push(DefinedLayout {
                layout: merged.layout(link_unit, *id),
                site: DefinitionSite { unit, index },
                object_type: ty.map(|&(_, ty)| ty),
                is_mentioned_by_code: link_unit.layouts_named_by_code.binary_search(id).is_ok(),
                has_place: definition.module.is_some(),
                base: definition.base.map(|base| merged.layout(link_unit, base)),
            });
        }
    }
    let parts = defined.iter().map(|it| it.layout / layouts_in_a_part);
    let parts: Vec<u32> = parts.collect();
    Grouped::new(&defined, &parts, part_count)
}

struct ChosenLayouts {
    sites: Vec<Option<DefinitionSite>>,
    bases: Vec<Option<u32>>,
    others: Vec<(u32, DefinitionSite)>,
}

fn choose_layouts_of_part(
    merged: &Merged<'_>,
    defined: &[Grouped<DefinedLayout>],
    part: usize,
    layouts: Range<u32>,
) -> ChosenLayouts {
    let mut chosen_definitions: Vec<Option<DefinedLayout>> = vec![None; layouts.len()];
    let mut others = Vec::new();
    let mut object_types = FxHashSet::default();
    for definition in defined.iter().flat_map(|of_units| of_units.in_group(part)) {
        let DefinedLayout { layout, site, .. } = *definition;
        let ty = definition.object_type;
        if ty.is_some_and(|ty| !object_types.insert((layout, ty))) {
            continue;
        }
        let key = merged.layouts.keys[layout as usize];
        let home = key.key.home_file().map(|file| ProgramFile {
            project: key.project,
            file,
        });
        let here = merged.units[site.unit as usize].file;
        let chosen = &mut chosen_definitions[(layout - layouts.start) as usize];
        match *chosen {
            None => *chosen = Some(*definition),
            Some(_) if home == Some(here) && definition.is_mentioned_by_code => {
                *chosen = Some(*definition);
            }
            Some(_) if !key.key.has_united_definitions() => {}
            Some(first) if definition.has_place && !first.has_place => {
                others.push((layout, first.site));
                *chosen = Some(*definition);
            }
            Some(_) => others.push((layout, site)),
        }
    }
    others.sort_unstable();
    let chosen = chosen_definitions.iter();
    ChosenLayouts {
        sites: chosen.clone().map(|it| it.map(|it| it.site)).collect(),
        bases: chosen.map(|it| it.and_then(|it| it.base)).collect(),
        others,
    }
}

fn choose_layouts(merged: &Merged<'_>) -> ChosenLayouts {
    let layout_count = merged.layouts.keys.len() as u32;
    let layouts_in_a_part = layout_count.div_ceil(MAX_PARTS_OF_LAYOUTS).max(1);
    let part_count = layout_count.div_ceil(layouts_in_a_part) as usize;
    let first_units = (0u32..).step_by(UNITS_IN_A_TASK);
    let tasks: Vec<(u32, &[LinkUnit])> = first_units
        .zip(merged.units.chunks(UNITS_IN_A_TASK))
        .collect();
    let defined = map_each(tasks, merged.in_parallel, &|(first_unit, units)| {
        list_defined_layouts(merged, first_unit, units, layouts_in_a_part, part_count)
    });
    let parts: Vec<usize> = (0..part_count).collect();
    let parts = map_each(parts, merged.in_parallel, &|part| {
        let start = part as u32 * layouts_in_a_part;
        let end = layout_count.min(start + layouts_in_a_part);
        choose_layouts_of_part(merged, &defined, part, start..end)
    });
    let mut chosen = ChosenLayouts {
        sites: Vec::with_capacity(layout_count as usize),
        bases: Vec::with_capacity(layout_count as usize),
        others: Vec::new(),
    };
    for part in parts {
        chosen.sites.extend(part.sites);
        chosen.bases.extend(part.bases);
        chosen.others.extend(part.others);
    }
    chosen
}

fn choose_variables(merged: &Merged<'_>, unit: u32, sites: &mut [Option<DefinitionSite>]) {
    let link_unit = &merged.units[unit as usize];
    for (index, (id, _)) in (0..).zip(&link_unit.variable_definitions) {
        let variable = merged.variable(link_unit, *id) as usize;
        debug_assert!(
            sites[variable].is_none(),
            "two definitions of {:?}",
            merged.variables.keys[variable]
        );
        sites[variable] = Some(DefinitionSite { unit, index });
    }
}

fn add_synthetic_exports(
    merged: &Merged<'_>,
    projects: &Projects<'_, '_>,
    sites: Vec<Option<DefinitionSite>>,
) -> Vec<Option<VariableDefinition>> {
    let mut variables: Vec<Option<VariableDefinition>> = sites
        .into_iter()
        .map(|site| site.map(VariableDefinition::Unit))
        .collect();
    let listed = &merged.variables.local_to_merged[merged.tables.len()];
    let graphs = ProjectId::ALL.map(|project| projects.get(project).graph);
    let export_counts = graphs.map(|graph| graph.synthetic_exports().len());
    let (mut next_export, mut next_copy) = (0, export_counts.iter().sum::<usize>());
    let has_key =
        |variable: u32, key: ProgramVariableKey| merged.variables.keys[variable as usize] == key;
    let mut define = |variable: u32, module, export: &SyntheticExport, writer| {
        let definition = &mut variables[variable as usize];
        let (is_known_elsewhere, is_replaceable_elsewhere) = match *definition {
            Some(VariableDefinition::SyntheticExport {
                is_known_member,
                is_replaceable,
                ..
            }) => (is_known_member, is_replaceable),
            Some(VariableDefinition::MockOfRuntimeModule { .. } | VariableDefinition::Unit(_))
            | None => (true, false),
        };
        *definition = Some(VariableDefinition::SyntheticExport {
            module,
            name: export.name,
            is_known_member: export.is_known_member && is_known_elsewhere,
            is_replaceable: export.is_replaceable || is_replaceable_elsewhere,
            writer,
        });
    };
    let index_by_module = &merged.modules.index_by_module;
    for project in ProjectId::ALL {
        let context = key_context(projects, project);
        for (id, export) in numbered_synthetic_exports(&context) {
            let exporter = context.module(export.module);
            let variable = listed[next_export];
            next_export += 1;
            let with_copies = find_file_with_copies(projects, exporter).map(|file| {
                next_copy += 1;
                (file, listed[next_copy - 1])
            });
            let Some(&module) = index_by_module.get(&exporter) else {
                continue;
            };
            debug_assert!(has_key(
                variable,
                context.variable_key(VariableKey::SyntheticExport(id))
            ));
            define(variable, module, export, find_writer(projects, exporter));
            let Some((file, copy)) = with_copies else {
                continue;
            };
            let Some(&facade) = index_by_module.get(&ProgramModule::Facade(file)) else {
                continue;
            };
            debug_assert!(has_key(copy, context.variable_key(VariableKey::Copy(id))));
            let captures = projects.get(file.project).graph.commonjs();
            let captures = captures.has_capturing_facade(file.file);
            let writer = match captures && export.name != bun_sema::atom::known::default {
                true => ExportWriter::Capture,
                false => ExportWriter::Facade,
            };
            define(copy, facade, export, writer);
        }
    }
    let context = key_context(projects, ProjectId::Application);
    let named_by_mocks = runtime_modules_named_by_mocks(projects).into_iter();
    debug_assert_eq!(listed.len(), next_copy + named_by_mocks.len());
    for (named, &variable) in named_by_mocks.zip(&listed[next_copy..]) {
        debug_assert!(has_key(
            variable,
            ProgramVariableKey::MockOfRuntimeModule(named)
        ));
        let exporter = context.module(ModuleRef::Runtime(named));
        if let Some(&module) = index_by_module.get(&exporter) {
            variables[variable as usize] = Some(VariableDefinition::MockOfRuntimeModule { module });
        }
    }
    variables
}

fn runtime_modules_named_by_mocks(projects: &Projects<'_, '_>) -> Vec<RuntimeModule> {
    let graph = projects.get(ProjectId::Application).graph;
    graph.runtime_modules_named_by_mocks().to_vec()
}

pub(super) fn variable_that_holds_mock(module: ModuleId) -> Variable {
    let mut declared = DeclaredType::untyped();
    declared.ty = TypeTable::ANYTHING_OR_ABSENT;
    Variable {
        name: None,
        module,
        declared,
        initialization: VariableInitialization::Uninitialized,
        flags: VariableFlags::IS_REPLACEABLE | VariableFlags::HOLDS_MOCK,
        place: Some(0),
        ..Variable::default()
    }
}

fn create_supertype_edges(layout_count: usize, sorted_edges: &[(u32, u32)]) -> SupertypeEdges {
    assert!(
        sorted_edges.len() <= u32::MAX as usize,
        "the supertype edges of a program have 32-bit offsets"
    );
    let mut starts = vec![0u32; layout_count + 1];
    for &(layout, _) in sorted_edges {
        starts[layout as usize + 1] += 1;
    }
    for layout in 0..layout_count {
        starts[layout + 1] += starts[layout];
    }
    let supertypes = sorted_edges.iter().map(|&(_, supertype)| supertype);
    SupertypeEdges {
        starts,
        supertypes: supertypes.collect(),
    }
}

fn merge_supertype_edges(merged: &Merged<'_>) -> Vec<(u32, u32)> {
    let mut slots: Vec<(usize, Vec<(u32, u32)>)> = (0..merged.units.len())
        .map(|unit| (unit, Vec::new()))
        .collect();
    for_each_mut(&mut slots, merged.in_parallel, &|(unit, edges)| {
        let unit = &merged.units[*unit];
        for &(layout, supertype) in &unit.supertype_edges {
            let edge = (merged.layout(unit, layout), merged.layout(unit, supertype));
            if edge.0 != edge.1 {
                edges.push(edge);
            }
        }
    });
    let mut edges = Vec::with_capacity(slots.iter().map(|(_, edges)| edges.len()).sum());
    for (_, unit_edges) in &slots {
        edges.extend_from_slice(unit_edges);
    }
    edges.sort_unstable();
    edges.dedup();
    edges
}

fn merge_function_type_edges(merged: &Merged<'_>) -> Vec<(u32, u32)> {
    let mut edges: Vec<(u32, u32)> = Vec::new();
    for unit in merged.units {
        let unit_edges = unit.function_type_edges.iter();
        edges.extend(unit_edges.map(|&(source, target)| {
            (merged.function(unit, source), merged.function(unit, target))
        }));
    }
    let first_keys = (0u32..).step_by(KEYS_IN_A_TASK);
    let tasks: Vec<(u32, &[ProgramFunctionKey])> = first_keys
        .zip(merged.functions.keys.chunks(KEYS_IN_A_TASK))
        .collect();
    let edges_of_keys = map_each(tasks, merged.in_parallel, &|(first_key, keys)| {
        let mut edges: Vec<(u32, u32)> = Vec::new();
        for (signature, key) in (first_key..).zip(keys) {
            let definition = match key.key {
                FunctionKey::Signature(declaration) => FunctionKey::Source(declaration),
                FunctionKey::ClassSignature(class) => FunctionKey::ImplicitConstructor(class),
                _ => continue,
            };
            let definition: ProgramFunctionKey = InProject {
                project: key.project,
                key: definition,
            };
            if let Some(definition) = merged.functions.find(&definition) {
                edges.push((definition, signature));
            }
        }
        edges
    });
    edges.extend(edges_of_keys.into_iter().flatten());
    edges.sort_unstable();
    edges.dedup();
    edges
}

fn merge_builtin_members(merged: &Merged<'_>) -> Vec<(u32, BuiltinId)> {
    let mut members: Vec<(u32, BuiltinId)> = Vec::new();
    for unit in merged.units {
        let unit_members = unit.builtin_members.iter();
        members.extend(
            unit_members
                .map(|&(function_type, builtin)| (merged.function(unit, function_type), builtin)),
        );
    }
    members.sort_unstable();
    members.dedup();
    members
}

fn collect_merged_layouts(
    merged: &Merged<'_>,
    unit: &LinkUnit,
    layouts: &[LayoutId],
) -> SmallVec<[u32; 4]> {
    let layouts = layouts.iter().map(|&layout| merged.layout(unit, layout));
    let mut layouts: SmallVec<[u32; 4]> = layouts.collect();
    layouts.sort_unstable();
    layouts
}

struct ClosedFamilies {
    supertypes: SupertypeEdges,
    has_members_without_layout: Vec<bool>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct Conversion {
    sources: SmallVec<[u32; 4]>,
    targets: SmallVec<[u32; 4]>,
}

fn list_conversions(merged: &Merged<'_>) -> Vec<Vec<Conversion>> {
    let tasks: Vec<&[LinkUnit]> = merged.units.chunks(UNITS_IN_A_TASK).collect();
    map_each(tasks, merged.in_parallel, &|units| {
        let mut conversions = Vec::new();
        let mut listed = FxHashSet::default();
        for unit in units {
            let types = merged.types_of(unit);
            for &(source, target) in &unit.family_facts.conversions {
                let (source, target) = (types.get(source), types.get(target));
                if source.layouts.is_empty()
                    || target.layouts.is_empty()
                    || target.flags.contains(TypeFlags::ANY_OBJECT)
                {
                    continue;
                }
                let conversion = Conversion {
                    sources: collect_merged_layouts(merged, unit, source.layouts),
                    targets: collect_merged_layouts(merged, unit, target.layouts),
                };
                if listed.insert(conversion.clone()) {
                    conversions.push(conversion);
                }
            }
        }
        conversions
    })
}

struct FamilyCloser {
    above: Vec<Vec<u32>>,
    added_supertypes: Vec<(u32, u32)>,
    has_members_without_layout: Vec<bool>,
    visit_of: Vec<u32>,
    visit: u32,
}

impl FamilyCloser {
    fn connect(&mut self, layout: u32, supertype: u32) -> bool {
        if layout == supertype || self.above[layout as usize].contains(&supertype) {
            return false;
        }
        self.above[layout as usize].push(supertype);
        true
    }

    fn add_supertype(&mut self, layout: u32, supertype: u32) {
        if self.connect(layout, supertype) {
            self.added_supertypes.push((layout, supertype));
        }
    }

    fn reaches_any(&mut self, layout: u32, targets: &[u32]) -> bool {
        if targets.contains(&layout) {
            return true;
        }
        self.visit += 1;
        let mut pending: SmallVec<[u32; 16]> = SmallVec::new();
        pending.push(layout);
        self.visit_of[layout as usize] = self.visit;
        while let Some(reached) = pending.pop() {
            for &supertype in &self.above[reached as usize] {
                if replace(&mut self.visit_of[supertype as usize], self.visit) != self.visit {
                    if targets.contains(&supertype) {
                        return true;
                    }
                    pending.push(supertype);
                }
            }
        }
        false
    }

    fn widen_families(&mut self, conversions: &[Vec<Conversion>]) {
        for conversion in conversions.iter().flatten() {
            for &layout in &conversion.sources {
                if self.reaches_any(layout, &conversion.targets) {
                    continue;
                }
                for &supertype in &conversion.targets {
                    self.add_supertype(layout, supertype);
                }
            }
        }
    }

    fn spread_members_without_layout(&mut self) {
        let layouts = 0..self.has_members_without_layout.len() as u32;
        let mut pending: Vec<u32> = layouts
            .filter(|&layout| self.has_members_without_layout[layout as usize])
            .collect();
        while let Some(layout) = pending.pop() {
            for &supertype in &self.above[layout as usize] {
                if !replace(
                    &mut self.has_members_without_layout[supertype as usize],
                    true,
                ) {
                    pending.push(supertype);
                }
            }
        }
    }
}

fn close_families(
    merged: &Merged<'_>,
    bases_of_layouts: &[Option<u32>],
    mut supertypes: Vec<(u32, u32)>,
) -> ClosedFamilies {
    let layout_count = bases_of_layouts.len();
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let mut closer = FamilyCloser {
        above: vec![Vec::new(); layout_count],
        added_supertypes: Vec::new(),
        has_members_without_layout: vec![false; layout_count],
        visit_of: vec![0; layout_count],
        visit: 0,
    };
    for &(layout, supertype) in &supertypes {
        closer.connect(layout, supertype);
    }
    if steps.logs() {
        steps.end(&format!(
            "families: {layout_count} layouts, {} supertype edges",
            supertypes.len()
        ));
    }
    for (layout, &base) in (0u32..).zip(bases_of_layouts) {
        if let Some(base) = base {
            closer.connect(layout, base);
        }
    }
    for unit in merged.units {
        for &layout in &unit.family_facts.layouts_with_members_without_layout {
            closer.has_members_without_layout[merged.layout(unit, layout) as usize] = true;
        }
    }
    steps.end("families: bases, members without layout");
    let conversions = list_conversions(merged);
    steps.end("families: list conversions");
    closer.widen_families(&conversions);
    if steps.logs() {
        let written = merged
            .units
            .iter()
            .map(|unit| unit.family_facts.conversions.len());
        steps.end(&format!(
            "families: {} of {} conversions, which add {} edges",
            conversions.iter().map(Vec::len).sum::<usize>(),
            written.sum::<usize>(),
            closer.added_supertypes.len()
        ));
    }
    closer.spread_members_without_layout();
    supertypes.extend(closer.added_supertypes);
    supertypes.sort_unstable();
    supertypes.dedup();
    ClosedFamilies {
        supertypes: create_supertype_edges(layout_count, &supertypes),
        has_members_without_layout: closer.has_members_without_layout,
    }
}

fn collect_runtime_functions(merged: &Merged<'_>) -> Vec<RuntimeFunctionRoot> {
    let mut roots = Vec::new();
    for unit in merged.units {
        for &entry in &unit.runtime_functions {
            roots.push(RuntimeFunctionRoot {
                function: merged.function(unit, entry.function),
                entry,
                file: unit.file,
            });
        }
    }
    roots.shared_sort_by_key(|root| (root.entry.id, root.file));
    roots
}

pub(super) fn empty_layout(key: &LayoutKey) -> Layout {
    let kind = match key {
        LayoutKey::Container(_) => LayoutKind::Container,
        LayoutKey::Class(_)
        | LayoutKey::ConstructorFunction(_)
        | LayoutKey::Library(_)
        | LayoutKey::CreatedObject { .. } => LayoutKind::Instance,
        LayoutKey::Environment { .. } | LayoutKey::ModuleInstance(_) => LayoutKind::Environment,
        _ => LayoutKind::Record,
    };
    Layout {
        kind,
        ..Layout::default()
    }
}

pub(super) fn synthetic_export_variable(
    name: StringId,
    module: ModuleId,
    writer: ExportWriter,
    is_known_member: bool,
) -> Variable {
    let initialization = match writer {
        ExportWriter::Loader | ExportWriter::Facade | ExportWriter::Capture => {
            VariableInitialization::Uninitialized
        }
        ExportWriter::Body => VariableInitialization::Undefined,
    };
    let mut declared = DeclaredType::untyped();
    let may_stay_empty = match writer {
        ExportWriter::Capture | ExportWriter::Facade => true,
        ExportWriter::Loader => !is_known_member,
        ExportWriter::Body => false,
    };
    if may_stay_empty {
        declared.ty = TypeTable::ANYTHING_OR_ABSENT;
    }
    Variable {
        name: Some(name),
        module,
        declared,
        initialization,
        ..Variable::default()
    }
}
