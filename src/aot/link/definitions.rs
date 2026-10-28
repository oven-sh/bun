#[cfg(test)]
mod family_tests;
#[cfg(test)]
mod late_answer_tests;
#[cfg(test)]
mod library_base_tests;
#[cfg(test)]
mod tests;

use bun_sema::util::SharedSort;

use super::beside::{Beside, run_beside};
use super::keys::MergedKeys;
use super::program_keys::{
    InProject, KeyContext, ProgramFunctionKey, ProgramKey, ProgramLayoutKey, ProgramModule,
    ProgramVariableKey,
};
use super::state::{
    DefinitionSite, Definitions, ExportWriter, ModuleTable, RuntimeFunctionRoot, SupertypeEdges,
    VariableDefinition,
};
use super::unit::{KeyList, LinkUnit};
use super::{LinkError, Projects, key_context};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{Layout, LayoutFlags, LayoutKind, Variable, VariableInitialization};
use crate::ir::{
    DeclaredType, FunctionId, FunctionKey, Id, InParallel, LayoutId, LayoutKey, ModuleId, StringId,
    TypeFlags, TypeTable, VariableKey, for_each_mut,
};
use crate::load::{ProgramFile, ProjectId};
use crate::lower::ObjectTypeKey;
use crate::modules::{ModuleKind, SyntheticExport, SyntheticExportId};
use core::mem::replace;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

/// The units in the order of their files, and what their keys were merged into.
#[derive(Copy, Clone)]
pub(super) struct MergedUnits<'a> {
    pub units: &'a [LinkUnit],
    pub modules: &'a ModuleTable,
    pub functions: &'a MergedKeys<ProgramFunctionKey>,
    pub layouts: &'a MergedKeys<ProgramLayoutKey>,
    pub variables: &'a MergedKeys<ProgramVariableKey>,
    pub in_parallel: InParallel<'a>,
}

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

// ES importers hold copies of the names of a CommonJS file alone.
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
        ProgramModule::Face(_) | ProgramModule::Check(_) => ExportWriter::Face,
        ProgramModule::Runtime(_) | ProgramModule::External { .. } => ExportWriter::Loader,
    }
}

// The variables that link defines: every synthetic export, then the copy of each that can have one.
pub(super) fn synthetic_export_keys(projects: &Projects<'_, '_>) -> KeyList<ProgramVariableKey> {
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
    KeyList::new(keys)
}

// A file of the application names a class or a function of Bun's own modules as what a class of its own inherits from.
pub(super) fn forget_library_layouts_without_definition(
    units: &mut [LinkUnit],
    layouts: &MergedKeys<ProgramLayoutKey>,
) {
    let mut is_defined = vec![false; layouts.keys.len()];
    for (unit, local_to_merged) in units.iter().zip(&layouts.local_to_merged) {
        for (layout, _) in &unit.layout_definitions {
            is_defined[local_to_merged[layout.index()] as usize] = true;
        }
    }
    for (unit, local_to_merged) in units.iter_mut().zip(&layouts.local_to_merged) {
        let project = unit.file.project;
        let has_layout = |layout: LayoutId| {
            let merged = local_to_merged[layout.index()] as usize;
            layouts.keys[merged].project == project || is_defined[merged]
        };
        for (_, definition) in &mut unit.layout_definitions {
            definition.base = definition.base.filter(|&base| has_layout(base));
        }
        unit.supertype_edges
            .retain(|&(layout, supertype)| has_layout(layout) && has_layout(supertype));
    }
}

pub(super) fn choose_definitions(
    input: &MergedUnits<'_>,
    projects: &Projects<'_, '_>,
    beside: Beside<'_>,
    errors: &mut Vec<LinkError>,
) -> Definitions {
    debug_assert!(input.units.is_sorted_by_key(|unit| unit.file));
    let units = 0..input.units.len() as u32;
    // Each kind of key has its own definitions. An error stands where one walk over the units would have put it.
    let (of_layouts, (of_functions, of_variables)) = run_beside(
        beside,
        || {
            let mut layouts = vec![None; input.layouts.keys.len()];
            let mut other_layout_definitions = Vec::new();
            let mut object_types = FxHashSet::default();
            for unit in units.clone() {
                let others = &mut other_layout_definitions;
                choose_layouts(input, unit, &mut layouts, others, &mut object_types);
            }
            other_layout_definitions.sort_unstable();
            let families = close_families(input, &layouts, merge_supertype_edges(input));
            (layouts, other_layout_definitions, families)
        },
        || {
            run_beside(
                beside,
                || {
                    let mut functions = vec![None; input.functions.keys.len()];
                    let mut errors_by_unit = Vec::new();
                    for unit in units.clone() {
                        choose_functions(input, unit, &mut functions, &mut errors_by_unit);
                    }
                    let function_types = merge_function_type_edges(input);
                    let function_types =
                        create_supertype_edges(input.functions.keys.len(), &function_types);
                    (
                        functions,
                        function_types,
                        merge_builtin_members(input),
                        errors_by_unit,
                    )
                },
                || {
                    let mut variables = vec![None; input.variables.keys.len()];
                    let mut errors_by_unit = Vec::new();
                    for unit in units.clone() {
                        choose_variables(input, unit, &mut variables, &mut errors_by_unit);
                    }
                    (
                        add_synthetic_exports(input, projects, variables),
                        errors_by_unit,
                    )
                },
            )
        },
    );
    let (layouts, other_layout_definitions, families) = of_layouts;
    let (functions, function_types, builtin_members, mut errors_by_unit) = of_functions;
    let (variables, errors_of_variables) = of_variables;
    errors_by_unit.extend(errors_of_variables);
    errors_by_unit.shared_sort_by_key(|&(unit, kind, _)| (unit, kind));
    errors.extend(errors_by_unit.into_iter().map(|(_, _, error)| error));
    Definitions {
        functions,
        layouts,
        other_layout_definitions,
        variables,
        supertypes: families.supertypes,
        function_types,
        builtin_members,
        has_members_without_layout: families.has_members_without_layout,
        conversions_outside_family: families.conversions_outside_family,
        runtime_functions: collect_runtime_functions(input, errors),
    }
}

fn file_of(units: &[LinkUnit], site: DefinitionSite) -> ProgramFile {
    units[site.unit as usize].file
}

fn merged_definitions<K: Copy, I: Id, T>(
    keys: &MergedKeys<K>,
    unit: u32,
    definitions: &[(I, T)],
) -> impl Iterator<Item = (usize, K, DefinitionSite)> {
    let local_to_merged = &keys.local_to_merged[unit as usize];
    (0..).zip(definitions).map(move |(index, (id, _))| {
        let merged = local_to_merged[id.index()] as usize;
        let site = DefinitionSite { unit, index };
        (merged, keys.keys[merged], site)
    })
}

fn try_define_at_home(
    units: &[LinkUnit],
    home: ProgramFile,
    site: DefinitionSite,
    chosen: &mut Option<DefinitionSite>,
) -> Result<(), [ProgramFile; 2]> {
    let here = file_of(units, site);
    if home != here {
        return Err([home, here]);
    }
    if let Some(first) = *chosen {
        return Err([file_of(units, first), here]);
    }
    *chosen = Some(site);
    Ok(())
}

fn choose_functions(
    input: &MergedUnits<'_>,
    unit: u32,
    sites: &mut [Option<DefinitionSite>],
    errors: &mut Vec<(u32, u8, LinkError)>,
) {
    let definitions = &input.units[unit as usize].function_definitions;
    for (merged, key, site) in merged_definitions(input.functions, unit, definitions) {
        if let FunctionKey::Signature(_) | FunctionKey::ClassSignature(_) = key.key {
            sites[merged].get_or_insert(site);
            continue;
        }
        let home = ProgramFile {
            project: key.project,
            file: key.key.home_file(),
        };
        if let Err(files) = try_define_at_home(input.units, home, site, &mut sites[merged]) {
            let key = ProgramKey::Function(key);
            errors.push((unit, 0, LinkError::ConflictingDefinitions { key, files }));
        }
    }
}

// A plain layout is shown under the name, and at the place, of its first definition by a type that is declared in a file of the program.
fn choose_layouts(
    input: &MergedUnits<'_>,
    unit: u32,
    sites: &mut [Option<DefinitionSite>],
    others: &mut Vec<(u32, DefinitionSite)>,
    object_types: &mut FxHashSet<(u32, ObjectTypeKey)>,
) {
    let here = input.units[unit as usize].file;
    let code_layout_count = input.units[unit as usize].code_layout_count;
    let definitions = &input.units[unit as usize].layout_definitions;
    let mut types_of_definitions = input.units[unit as usize].object_types.iter().peekable();
    for (merged, key, site) in merged_definitions(input.layouts, unit, definitions) {
        // Which files say again what an earlier file has said of a type differs from one build to the next.
        let ty = types_of_definitions.next_if(|&&(index, _)| index == site.index);
        if ty.is_some_and(|&(_, ty)| !object_types.insert((merged as u32, ty))) {
            continue;
        }
        let home = key.key.home_file().map(|file| ProgramFile {
            project: key.project,
            file,
        });
        let is_mentioned_by_code = definitions[site.index as usize].0.index() < code_layout_count;
        let has_place = |site: DefinitionSite| {
            let definitions = &input.units[site.unit as usize].layout_definitions;
            definitions[site.index as usize].1.module.is_some()
        };
        match sites[merged] {
            None => sites[merged] = Some(site),
            Some(_) if home == Some(here) && is_mentioned_by_code => sites[merged] = Some(site),
            Some(_) if !key.key.has_united_definitions() => {}
            Some(first) if has_place(site) && !has_place(first) => {
                others.push((merged as u32, first));
                sites[merged] = Some(site);
            }
            Some(_) => others.push((merged as u32, site)),
        }
    }
}

fn choose_variables(
    input: &MergedUnits<'_>,
    unit: u32,
    sites: &mut [Option<DefinitionSite>],
    errors: &mut Vec<(u32, u8, LinkError)>,
) {
    let definitions = &input.units[unit as usize].variable_definitions;
    for (merged, key, site) in merged_definitions(input.variables, unit, definitions) {
        let home = match key {
            ProgramVariableKey::Declared(declared) => {
                declared.key.home_file().map(|file| ProgramFile {
                    project: declared.project,
                    file,
                })
            }
            ProgramVariableKey::SyntheticExport { .. } | ProgramVariableKey::Copy { .. } => None,
        };
        let result = match home {
            Some(home) => try_define_at_home(input.units, home, site, &mut sites[merged]),
            None => Err([file_of(input.units, site); 2]),
        };
        if let Err(files) = result {
            let key = ProgramKey::Variable(key);
            errors.push((unit, 1, LinkError::ConflictingDefinitions { key, files }));
        }
    }
}

fn add_synthetic_exports(
    input: &MergedUnits<'_>,
    projects: &Projects<'_, '_>,
    sites: Vec<Option<DefinitionSite>>,
) -> Vec<Option<VariableDefinition>> {
    let mut variables: Vec<Option<VariableDefinition>> = sites
        .into_iter()
        .map(|site| site.map(VariableDefinition::Unit))
        .collect();
    let mut define = |key: ProgramVariableKey, module, export: &SyntheticExport, writer| {
        let merged = input.variables.find(&key);
        let merged = merged.expect("link declares every synthetic export and every copy");
        let definition = &mut variables[merged as usize];
        // A name that either project requires is tested when the module is linked.
        let is_known_elsewhere = match *definition {
            Some(VariableDefinition::SyntheticExport {
                is_known_member, ..
            }) => is_known_member,
            Some(VariableDefinition::Unit(_)) | None => true,
        };
        *definition = Some(VariableDefinition::SyntheticExport {
            module,
            name: export.name,
            is_known_member: export.is_known_member && is_known_elsewhere,
            writer,
        });
    };
    let index_by_module = &input.modules.index_by_module;
    for project in ProjectId::ALL {
        let context = key_context(projects, project);
        for (id, export) in numbered_synthetic_exports(&context) {
            let exporter = context.module(export.module);
            // The program does not reach the module.
            let Some(&module) = index_by_module.get(&exporter) else {
                continue;
            };
            let key = context.variable_key(VariableKey::SyntheticExport(id));
            define(key, module, export, find_writer(projects, exporter));
            let Some(file) = find_file_with_copies(projects, exporter) else {
                continue;
            };
            // A file that no ES module imports has no face.
            let Some(&face) = index_by_module.get(&ProgramModule::Face(file)) else {
                continue;
            };
            let key = context.variable_key(VariableKey::Copy(id));
            let captures = projects.get(file.project).graph.commonjs();
            let captures = captures.face_captures(file.file);
            // Whatever a CommonJS file exports, its importers find a `default`.
            let writer = match captures && export.name != bun_sema::atom::known::default {
                true => ExportWriter::Capture,
                false => ExportWriter::Face,
            };
            define(key, face, export, writer);
        }
    }
    variables
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

fn merge_supertype_edges(input: &MergedUnits<'_>) -> Vec<(u32, u32)> {
    let (units, local_to_merged) = (input.units, &input.layouts.local_to_merged);
    let mut slots: Vec<(usize, Vec<(u32, u32)>)> =
        (0..units.len()).map(|unit| (unit, Vec::new())).collect();
    for_each_mut(&mut slots, input.in_parallel, &|(unit, edges)| {
        let to_merged = |layout: LayoutId| local_to_merged[*unit][layout.index()];
        for &(layout, supertype) in &units[*unit].supertype_edges {
            let edge = (to_merged(layout), to_merged(supertype));
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

fn merge_function_type_edges(input: &MergedUnits<'_>) -> Vec<(u32, u32)> {
    let mut edges: Vec<(u32, u32)> = Vec::new();
    for (unit, local_to_merged) in input.units.iter().zip(&input.functions.local_to_merged) {
        let to_merged = |function: FunctionId| local_to_merged[function.index()];
        let unit_edges = unit.function_type_edges.iter();
        edges.extend(unit_edges.map(|&(source, target)| (to_merged(source), to_merged(target))));
    }
    for (signature, key) in (0u32..).zip(&input.functions.keys) {
        let definition = match key.key {
            FunctionKey::Signature(declaration) => FunctionKey::Source(declaration),
            FunctionKey::ClassSignature(class) => FunctionKey::ImplicitConstructor(class),
            _ => continue,
        };
        let definition = InProject {
            project: key.project,
            key: definition,
        };
        if let Some(definition) = input.functions.find(&definition) {
            edges.push((definition, signature));
        }
    }
    edges.sort_unstable();
    edges.dedup();
    edges
}

fn merge_builtin_members(input: &MergedUnits<'_>) -> Vec<(u32, BuiltinId)> {
    let mut members: Vec<(u32, BuiltinId)> = Vec::new();
    for (unit, local_to_merged) in input.units.iter().zip(&input.functions.local_to_merged) {
        let unit_members = unit.builtin_members.iter();
        members
            .extend(unit_members.map(|&(function_type, builtin)| {
                (local_to_merged[function_type.index()], builtin)
            }));
    }
    members.sort_unstable();
    members.dedup();
    members
}

struct ClosedFamilies {
    supertypes: SupertypeEdges,
    has_members_without_layout: Vec<bool>,
    conversions_outside_family: Vec<(u32, u32)>,
}

struct FamilyCloser<'a> {
    units: &'a [LinkUnit],
    merged_layouts: &'a [Vec<u32>],
    above: Vec<Vec<u32>>,
    added_supertypes: Vec<(u32, u32)>,
    has_members_without_layout: Vec<bool>,
    visit_of: Vec<u32>,
    visit: u32,
}

impl FamilyCloser<'_> {
    fn layout(&self, unit: u32, layout: LayoutId) -> u32 {
        self.merged_layouts[unit as usize][layout.index()]
    }

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

    // A conversion whose parts the lowering could not follow leaves a layout outside the family it flows into.
    fn widen_families(&mut self) -> Vec<(u32, u32)> {
        let units = self.units;
        let mut outside = Vec::new();
        for (unit, link_unit) in (0u32..).zip(units) {
            for &(source, target) in &link_unit.family_facts.conversions {
                let (source, target) = (link_unit.types.get(source), link_unit.types.get(target));
                if target.layouts.is_empty() || target.flags.contains(TypeFlags::ANY_OBJECT) {
                    continue;
                }
                let targets: SmallVec<[u32; 4]> = target
                    .layouts
                    .iter()
                    .map(|&layout| self.layout(unit, layout))
                    .collect();
                for &layout in &source.layouts {
                    let layout = self.layout(unit, layout);
                    if self.reaches_any(layout, &targets) {
                        continue;
                    }
                    for &supertype in &targets {
                        outside.push((layout, supertype));
                        self.add_supertype(layout, supertype);
                    }
                }
            }
        }
        outside.sort_unstable();
        outside.dedup();
        outside
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

// The family of a type is what reaches it over the conversions that the program performs, each in the direction the checker allows, and over the base of each class.
fn close_families(
    input: &MergedUnits<'_>,
    layouts: &[Option<DefinitionSite>],
    mut supertypes: Vec<(u32, u32)>,
) -> ClosedFamilies {
    let layout_count = input.layouts.keys.len();
    let mut closer = FamilyCloser {
        units: input.units,
        merged_layouts: &input.layouts.local_to_merged,
        above: vec![Vec::new(); layout_count],
        added_supertypes: Vec::new(),
        has_members_without_layout: vec![false; layout_count],
        visit_of: vec![0; layout_count],
        visit: 0,
    };
    for &(layout, supertype) in &supertypes {
        closer.connect(layout, supertype);
    }
    for (layout, site) in (0u32..).zip(layouts) {
        let Some(site) = *site else {
            continue;
        };
        let definitions = &input.units[site.unit as usize].layout_definitions;
        let (_, definition) = &definitions[site.index as usize];
        if let Some(base) = definition.base {
            let base = closer.layout(site.unit, base);
            closer.connect(layout, base);
        }
    }
    for (unit, link_unit) in (0u32..).zip(input.units) {
        for &layout in &link_unit.family_facts.layouts_with_members_without_layout {
            let layout = closer.layout(unit, layout);
            closer.has_members_without_layout[layout as usize] = true;
        }
    }
    let conversions_outside_family = closer.widen_families();
    closer.spread_members_without_layout();
    supertypes.extend(closer.added_supertypes);
    supertypes.sort_unstable();
    supertypes.dedup();
    ClosedFamilies {
        supertypes: create_supertype_edges(layout_count, &supertypes),
        has_members_without_layout: closer.has_members_without_layout,
        conversions_outside_family,
    }
}

fn collect_runtime_functions(
    input: &MergedUnits<'_>,
    errors: &mut Vec<LinkError>,
) -> Vec<RuntimeFunctionRoot> {
    let mut roots = Vec::new();
    for (unit, local_to_merged) in input.units.iter().zip(&input.functions.local_to_merged) {
        for &entry in &unit.runtime_functions {
            roots.push(RuntimeFunctionRoot {
                function: local_to_merged[entry.function.index()],
                entry,
                file: unit.file,
            });
        }
    }
    roots.shared_sort_by_key(|root| (root.entry.id, root.file));
    roots.dedup_by(|later, earlier| {
        let is_conflict = later.entry.id == earlier.entry.id;
        if is_conflict {
            errors.push(LinkError::ConflictingRuntimeFunctions {
                function: later.entry.id,
                files: [earlier.file, later.file],
            });
        }
        is_conflict
    });
    roots
}

pub(super) fn empty_layout(key: &LayoutKey) -> Layout {
    let kind = match key {
        LayoutKey::Container(_) => LayoutKind::Container,
        LayoutKey::Class(_) | LayoutKey::ConstructorFunction(_) | LayoutKey::Library(_) => {
            LayoutKind::Instance
        }
        LayoutKey::Environment { .. } => LayoutKind::Environment,
        _ => LayoutKind::Record,
    };
    let flags = match key {
        LayoutKey::TypeParameter(_) => LayoutFlags::IS_TYPE_PARAMETER,
        _ => LayoutFlags::default(),
    };
    Layout {
        kind,
        flags,
        ..Layout::default()
    }
}

pub(super) fn synthetic_export_variable(
    name: StringId,
    module: ModuleId,
    writer: ExportWriter,
) -> Variable {
    let initialization = match writer {
        ExportWriter::Loader | ExportWriter::Face | ExportWriter::Capture => {
            VariableInitialization::Uninitialized
        }
        ExportWriter::Body => VariableInitialization::Undefined,
    };
    let mut declared = DeclaredType::untyped();
    // The object may lack the name when the copies are taken: the copy stays empty, and the check of the importer tests for that.
    // An importer that the CommonJS file itself requires runs before the face has taken anything.
    if matches!(writer, ExportWriter::Capture | ExportWriter::Face) {
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
