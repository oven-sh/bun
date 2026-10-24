#[cfg(test)]
mod tests;

use bun_sema::util::SharedSort;

use super::definitions::MergedUnits;
use super::program_keys::{KeyContext, ProgramLayoutKey};
use super::state::{DefinitionSite, Definitions, Retained, UnitMarks, VariableDefinition};
use super::unit::{LinkUnit, LocalKind, LocalReference};
use super::unused_records::unmarked;
use super::{LinkError, Projects, key_context};
use crate::ir::{Id, LayoutKey, PropertyKeyId, Reference, TypeId, TypeTable, for_each_mut};
use crate::load::{PerProject, ProgramFile};
use core::mem::take;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

const NO_UNIT: u32 = u32::MAX;

pub(super) struct MarkContext<'a> {
    pub(super) merged: MergedUnits<'a>,
    pub(super) keys: PerProject<KeyContext<'a>>,
    pub(super) definitions: &'a Definitions,
    constructed_layouts: Vec<Option<u32>>,
    is_function_retained: Vec<AtomicBool>,
    is_layout_retained: Vec<AtomicBool>,
    is_variable_retained: Vec<AtomicBool>,
    pub(super) is_failure_retained: PerProject<Vec<AtomicBool>>,
    first_layout_referrer: Vec<AtomicU32>,
    first_direct_layout_use: Vec<AtomicU32>,
}

fn no_units(count: usize) -> Vec<AtomicU32> {
    (0..count).map(|_| AtomicU32::new(NO_UNIT)).collect()
}

fn into_marks(marks: Vec<AtomicBool>) -> Vec<bool> {
    marks.into_iter().map(AtomicBool::into_inner).collect()
}

fn try_mark_shared(is_marked: &AtomicBool) -> bool {
    !is_marked.load(Ordering::Relaxed) && !is_marked.swap(true, Ordering::Relaxed)
}

fn lower_to(first_unit: &AtomicU32, unit: u32) {
    if unit < first_unit.load(Ordering::Relaxed) {
        first_unit.fetch_min(unit, Ordering::Relaxed);
    }
}

#[derive(Default)]
struct Undefined {
    functions: Vec<(u32, ProgramFile)>,
    variables: Vec<(u32, ProgramFile)>,
    errors: Vec<LinkError>,
}

fn keep_first_referrers(undefined: &mut Vec<(u32, ProgramFile)>) {
    undefined.shared_sort_unstable();
    undefined.dedup_by_key(|&mut (index, _)| index);
}

pub(super) fn mark(
    input: &MergedUnits<'_>,
    projects: &Projects<'_, '_>,
    definitions: &Definitions,
    errors: &mut Vec<LinkError>,
) -> Retained {
    let layout_count = input.layouts.keys.len();
    let context = MarkContext {
        merged: *input,
        keys: projects
            .as_ref()
            .map(|project, _| key_context(projects, project)),
        definitions,
        constructed_layouts: find_constructed_layouts(input, definitions),
        is_function_retained: unmarked(input.functions.keys.len()),
        is_layout_retained: unmarked(layout_count),
        is_variable_retained: unmarked(input.variables.keys.len()),
        is_failure_retained: projects
            .as_ref()
            .map(|_, project| unmarked(project.graph.failures().len())),
        first_layout_referrer: no_units(layout_count),
        first_direct_layout_use: no_units(layout_count),
    };
    let unit_count = input.units.len() as u32;
    // The last one works for what has no unit.
    let mut markers: Vec<Marker<'_>> = (0..unit_count)
        .chain([NO_UNIT])
        .map(|unit| Marker {
            context: &context,
            unit,
            // The marks of a unit are seven lists, which the thread makes that first works for the unit.
            marks: None,
            stack: Vec::new(),
            sent: Vec::new(),
            undefined: Undefined::default(),
        })
        .collect();
    push_roots(input, definitions, &mut markers);
    loop {
        let mut busy_markers: Vec<&mut Marker<'_>> = markers
            .iter_mut()
            .filter(|marker| !marker.stack.is_empty())
            .collect();
        if busy_markers.is_empty() {
            break;
        }
        for_each_mut(&mut busy_markers, input.in_parallel, &|marker| {
            marker.work_off()
        });
        for sender in 0..markers.len() {
            for (unit, work) in take(&mut markers[sender].sent) {
                markers[unit as usize].stack.push(work);
            }
        }
    }
    let mut undefined = Undefined::default();
    let mut unit_marks = Vec::with_capacity(input.units.len());
    for mut marker in markers {
        unit_marks.extend(marker.take_marks());
        undefined.functions.extend(marker.undefined.functions);
        undefined.variables.extend(marker.undefined.variables);
        undefined.errors.extend(marker.undefined.errors);
    }
    report_undefined(&context, undefined, errors);
    check_undefined_layouts(&context, errors);
    Retained {
        functions: into_marks(context.is_function_retained),
        layouts: into_marks(context.is_layout_retained),
        variables: into_marks(context.is_variable_retained),
        module_failures: context
            .is_failure_retained
            .map(|_, marks| into_marks(marks)),
        units: unit_marks,
    }
}

fn push_roots(input: &MergedUnits<'_>, definitions: &Definitions, markers: &mut [Marker<'_>]) {
    let without_unit = markers.len() - 1;
    let modules = input.modules;
    for (&module, &unit) in modules.modules.iter().zip(&modules.unit_by_module) {
        let marker = unit.map_or(without_unit, |unit| unit as usize);
        markers[marker].stack.push(Work::Module(module));
    }
    for root in &definitions.runtime_functions {
        markers[without_unit].mark_function(root.function, root.file);
    }
    if !input.units.is_empty() {
        for index in 0..TypeTable::WELL_KNOWN_COUNT as u32 {
            let reference = LocalReference {
                kind: LocalKind::Type,
                index,
            };
            markers[0].follow(reference, LayoutUse::InType);
        }
    }
}

fn report_undefined(
    context: &MarkContext<'_>,
    mut undefined: Undefined,
    errors: &mut Vec<LinkError>,
) {
    errors.append(&mut undefined.errors);
    keep_first_referrers(&mut undefined.functions);
    undefined
        .functions
        .shared_sort_unstable_by_key(|&(index, _)| context.merged.functions.keys[index as usize]);
    for (index, referenced_in) in undefined.functions {
        errors.push(LinkError::UndefinedFunction {
            key: context.merged.functions.keys[index as usize],
            referenced_in,
        });
    }
    keep_first_referrers(&mut undefined.variables);
    for (index, referenced_in) in undefined.variables {
        errors.push(LinkError::UndefinedVariable {
            key: context.merged.variables.keys[index as usize],
            referenced_in,
        });
    }
}

fn find_constructed_layouts(
    input: &MergedUnits<'_>,
    definitions: &Definitions,
) -> Vec<Option<u32>> {
    let mut constructed_layouts = vec![None; input.functions.keys.len()];
    for (unit_index, unit) in input.units.iter().enumerate() {
        let functions = &input.functions.local_to_merged[unit_index];
        let layouts = &input.layouts.local_to_merged[unit_index];
        for (index, (id, definition)) in (0..).zip(&unit.layout_definitions) {
            let Some(constructor) = definition.constructor else {
                continue;
            };
            let layout = layouts[id.index()];
            let site = DefinitionSite {
                unit: unit_index as u32,
                index,
            };
            if definitions.layouts[layout as usize] == Some(site) {
                constructed_layouts[functions[constructor.index()] as usize].get_or_insert(layout);
            }
        }
    }
    constructed_layouts
}

#[derive(Copy, Clone)]
pub(super) enum LayoutUse {
    Direct,
    InType,
}

#[derive(Copy, Clone)]
pub(super) enum Work {
    Module(super::program_keys::ProgramModule),
    Function {
        index: u32,
        definition: u32,
        from: ProgramFile,
    },
    LayoutDefinition {
        definition: u32,
        is_chosen: bool,
    },
    Supertypes(u32),
    Variable {
        definition: u32,
    },
    Local(LocalReference),
}

pub(super) struct Marker<'a> {
    pub(super) context: &'a MarkContext<'a>,
    unit: u32,
    marks: Option<UnitMarks>,
    stack: Vec<Work>,
    sent: Vec<(u32, Work)>,
    undefined: Undefined,
}

impl<'a> Marker<'a> {
    fn take_marks(&mut self) -> Option<UnitMarks> {
        let unit = self.context.merged.units.get(self.unit as usize)?;
        Some(self.marks.take().unwrap_or_else(|| UnitMarks::new(unit)))
    }

    fn work_off(&mut self) {
        while let Some(work) = self.stack.pop() {
            match work {
                Work::Module(module) => self.mark_module(module),
                Work::Function {
                    index,
                    definition,
                    from,
                } => self.process_function(index, definition, from),
                Work::LayoutDefinition {
                    definition,
                    is_chosen,
                } => self.process_layout_definition(definition, is_chosen),
                Work::Supertypes(index) => self.mark_supertypes(index),
                Work::Variable { definition } => self.process_variable(definition),
                Work::Local(reference) => self.process_local(reference),
            }
        }
    }

    fn send(&mut self, unit: u32, work: Work) {
        match unit == self.unit {
            true => self.stack.push(work),
            false => self.sent.push((unit, work)),
        }
    }

    pub(super) fn add_error(&mut self, error: LinkError) {
        self.undefined.errors.push(error);
    }

    pub(super) fn follow(&mut self, reference: LocalReference, layout_use: LayoutUse) {
        let context = self.context;
        let (unit_index, index) = (self.unit as usize, reference.index as usize);
        let link_unit = &context.merged.units[unit_index];
        let marks = self.marks.get_or_insert_with(|| UnitMarks::new(link_unit));
        let record_mark = match reference.kind {
            LocalKind::Function => {
                let function = context.merged.functions.local_to_merged[unit_index][index];
                return self.mark_function(function, link_unit.file);
            }
            LocalKind::Layout => {
                let layout = context.merged.layouts.local_to_merged[unit_index][index];
                return self.mark_layout(layout, self.unit, layout_use);
            }
            LocalKind::Variable => {
                let variable = context.merged.variables.local_to_merged[unit_index][index];
                return self.mark_variable(variable, link_unit.file);
            }
            LocalKind::ModuleTarget | LocalKind::ModuleReferrer => return,
            LocalKind::ModuleFailure => {
                let failure = link_unit.module_failures[index];
                return self.mark_failure(link_unit.file.project, failure);
            }
            LocalKind::String => {
                marks.strings[index] = true;
                return;
            }
            LocalKind::PropertyKey => &mut marks.property_keys[index],
            LocalKind::Type => &mut marks.types[index],
            LocalKind::TypeSite => &mut marks.type_sites[index],
            LocalKind::ExpectedResult => &mut marks.expected_results[index],
            LocalKind::EvalScope => &mut marks.eval_scopes[index],
            LocalKind::Data => &mut marks.data[index],
        };
        if !core::mem::replace(record_mark, true) {
            self.stack.push(Work::Local(reference));
        }
    }

    fn reference_visitor(&mut self, layout_use: LayoutUse) -> impl FnMut(Reference) {
        move |reference| {
            if let Some(local) = LocalReference::new(reference) {
                self.follow(local, layout_use);
            }
        }
    }

    pub(super) fn mark_function(&mut self, index: u32, from: ProgramFile) {
        let context = self.context;
        let is_retained = &context.is_function_retained[index as usize];
        if is_retained.load(Ordering::Relaxed) {
            return;
        }
        let Some(site) = context.definitions.functions[index as usize] else {
            self.undefined.functions.push((index, from));
            return;
        };
        if try_mark_shared(is_retained) {
            let work = Work::Function {
                index,
                definition: site.index,
                from,
            };
            self.send(site.unit, work);
        }
    }

    pub(super) fn mark_variable(&mut self, index: u32, from: ProgramFile) {
        let context = self.context;
        let is_retained = &context.is_variable_retained[index as usize];
        if is_retained.load(Ordering::Relaxed) {
            return;
        }
        match context.definitions.variables[index as usize] {
            None => self.undefined.variables.push((index, from)),
            Some(VariableDefinition::SyntheticExport { .. }) => {
                is_retained.store(true, Ordering::Relaxed);
            }
            Some(VariableDefinition::Unit(site)) => {
                if try_mark_shared(is_retained) {
                    let definition = site.index;
                    self.send(site.unit, Work::Variable { definition });
                }
            }
        }
    }

    fn mark_layout(&mut self, index: u32, referrer: u32, layout_use: LayoutUse) {
        let context = self.context;
        match layout_use {
            LayoutUse::Direct => {
                lower_to(&context.first_direct_layout_use[index as usize], referrer)
            }
            LayoutUse::InType => {}
        }
        lower_to(&context.first_layout_referrer[index as usize], referrer);
        if !try_mark_shared(&context.is_layout_retained[index as usize]) {
            return;
        }
        if let Some(site) = context.definitions.layouts[index as usize] {
            let work = Work::LayoutDefinition {
                definition: site.index,
                is_chosen: true,
            };
            self.send(site.unit, work);
        }
        for &(_, site) in context.definitions.other_definitions_of(index) {
            let work = Work::LayoutDefinition {
                definition: site.index,
                is_chosen: false,
            };
            self.send(site.unit, work);
        }
        self.stack.push(Work::Supertypes(index));
    }

    pub(super) fn own_unit(&self) -> Option<&'a LinkUnit> {
        self.context.merged.units.get(self.unit as usize)
    }

    fn link_unit(&self) -> &'a LinkUnit {
        self.own_unit().expect("only a unit has definitions")
    }

    fn process_local(&mut self, reference: LocalReference) {
        let link_unit = self.link_unit();
        let records = &link_unit.records;
        let (word, index) = (reference.index, reference.index as usize);
        match reference.kind {
            LocalKind::Type => {
                let ty = link_unit.types.get(TypeId::from_word(word));
                ty.for_each_reference(&mut self.reference_visitor(LayoutUse::InType));
            }
            LocalKind::PropertyKey => {
                let key = link_unit.property_keys.get(PropertyKeyId::from_word(word));
                key.for_each_reference(&mut self.reference_visitor(LayoutUse::Direct));
            }
            LocalKind::TypeSite => {
                let site = &records.type_sites[index];
                site.for_each_reference(&mut self.reference_visitor(LayoutUse::Direct));
            }
            LocalKind::ExpectedResult => {
                let expected = &records.expected_results[index];
                expected.for_each_reference(&mut self.reference_visitor(LayoutUse::Direct));
            }
            LocalKind::EvalScope => {
                let scope = &records.eval_scopes[index];
                scope.for_each_reference(&mut self.reference_visitor(LayoutUse::Direct));
            }
            LocalKind::Data => {
                let data = &records.data[index];
                data.for_each_reference(&mut self.reference_visitor(LayoutUse::Direct));
            }
            _ => {
                unreachable!("only a record of a unit is queued as local work")
            }
        }
    }

    fn process_function(&mut self, index: u32, definition: u32, from: ProgramFile) {
        let context = self.context;
        let references = &self.link_unit().function_references;
        for kind in LocalKind::ALL {
            for &local in references.of(definition as usize, kind) {
                let reference = LocalReference { kind, index: local };
                self.follow(reference, LayoutUse::Direct);
            }
        }
        if let Some(layout) = context.constructed_layouts[index as usize] {
            self.mark_layout(layout, self.unit, LayoutUse::Direct);
        }
        for &function_type in context.definitions.function_types.of(index) {
            self.mark_function(function_type, from);
        }
    }

    fn process_variable(&mut self, definition: u32) {
        let (_, variable) = &self.link_unit().variable_definitions[definition as usize];
        variable.for_each_reference(&mut self.reference_visitor(LayoutUse::Direct));
    }

    // The united layout has the name of the first definition, and each of its fields has the site of that one.
    fn process_layout_definition(&mut self, definition: u32, is_chosen: bool) {
        let (_, layout) = &self.link_unit().layout_definitions[definition as usize];
        layout.for_each_reference(&mut |reference| match LocalReference::new(reference) {
            Some(local)
                if is_chosen || !matches!(local.kind, LocalKind::String | LocalKind::TypeSite) =>
            {
                self.follow(local, LayoutUse::Direct);
            }
            Some(_) | None => {}
        });
    }

    fn mark_supertypes(&mut self, index: u32) {
        let context = self.context;
        let referrer = context.first_layout_referrer[index as usize].load(Ordering::Relaxed);
        for &supertype in context.definitions.supertypes.of(index) {
            self.mark_layout(supertype, referrer, LayoutUse::InType);
        }
    }
}

fn check_undefined_layouts(context: &MarkContext<'_>, errors: &mut Vec<LinkError>) {
    let mut undefined = Vec::new();
    for (index, &key) in context.merged.layouts.keys.iter().enumerate() {
        let is_retained = context.is_layout_retained[index].load(Ordering::Relaxed);
        if !is_retained || context.definitions.layouts[index].is_some() {
            continue;
        }
        if let Some(referrer) = find_referrer_to_blame(context, index, key) {
            undefined.push((key, referrer));
        }
    }
    undefined.shared_sort_unstable_by_key(|&(key, _)| key);
    for (key, referrer) in undefined {
        errors.push(LinkError::UndefinedLayout {
            key,
            referenced_in: context.merged.units[referrer as usize].file,
        });
    }
}

// A layout without a definition is an error where this names a unit, and is empty elsewhere.
fn find_referrer_to_blame(
    context: &MarkContext<'_>,
    index: usize,
    key: ProgramLayoutKey,
) -> Option<u32> {
    match key.key {
        LayoutKey::Class(_) | LayoutKey::ConstructorFunction(_) | LayoutKey::Library(_) => {
            let referrer = context.first_direct_layout_use[index].load(Ordering::Relaxed);
            (referrer != NO_UNIT).then_some(referrer)
        }
        LayoutKey::Environment { .. } => {
            Some(context.first_layout_referrer[index].load(Ordering::Relaxed))
        }
        _ => None,
    }
}
