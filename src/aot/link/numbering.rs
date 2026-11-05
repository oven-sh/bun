#[cfg(test)]
mod tests;

use super::definitions::MergedUnits;
use super::keys::MergedKeys;
use super::layout_order::order_program_layouts;
use super::program_keys::{ProgramFunctionKey, ProgramLayoutKey, ProgramVariableKey};
use super::state::{
    DefinitionSite, Definitions, Numbering, ProgramCounts, Retained, UnitIds, UnitMarks,
    VariableDefinition,
};
use crate::ir::{Id, ModuleId, VariableId, for_each_mut};
use core::convert::identity;
use core::mem::take;

pub(super) struct RetainedDefinitions<'a, D> {
    local_to_merged: &'a [Vec<u32>],
    chosen: &'a [Option<D>],
    retained: &'a [bool],
    create_definition: fn(DefinitionSite) -> D,
}

impl<D: PartialEq> RetainedDefinitions<'_, D> {
    fn find(&self, site: DefinitionSite, id: impl Id) -> Option<u32> {
        let merged = self.local_to_merged[site.unit as usize][id.index()];
        let is_chosen = self.chosen[merged as usize] == Some((self.create_definition)(site));
        (is_chosen && self.retained[merged as usize]).then_some(merged)
    }

    pub(super) fn in_units<'u, I: Id + 'u, T: 'u>(
        &self,
        definition_lists: impl Iterator<Item = &'u Vec<(I, T)>>,
    ) -> impl Iterator<Item = u32> {
        (0..)
            .zip(definition_lists)
            .flat_map(move |(unit, definitions)| {
                (0..).zip(definitions).filter_map(move |(index, &(id, _))| {
                    self.find(DefinitionSite { unit, index }, id)
                })
            })
    }

    pub(super) fn take_from<I: Id, T>(
        &self,
        unit: u32,
        definitions: &mut Vec<(I, T)>,
    ) -> impl Iterator<Item = (u32, T)> {
        (0..)
            .zip(take(definitions))
            .filter_map(move |(index, (id, definition))| {
                let merged = self.find(DefinitionSite { unit, index }, id)?;
                Some((merged, definition))
            })
    }

    pub(super) fn take_retained_from<I: Id, T>(
        &self,
        unit: u32,
        definitions: &mut Vec<(I, T)>,
    ) -> impl Iterator<Item = (u32, DefinitionSite, bool, T)> {
        (0..)
            .zip(take(definitions))
            .filter_map(move |(index, (id, definition))| {
                let merged = self.local_to_merged[unit as usize][id.index()];
                let site = DefinitionSite { unit, index };
                let is_chosen =
                    self.chosen[merged as usize] == Some((self.create_definition)(site));
                self.retained[merged as usize].then_some((merged, site, is_chosen, definition))
            })
    }

    pub(super) fn without_definition(&self) -> impl Iterator<Item = u32> {
        let entries = (0..).zip(self.chosen.iter().zip(self.retained));
        entries.filter_map(|(merged, (chosen, &is_retained))| {
            (is_retained && chosen.is_none()).then_some(merged)
        })
    }
}

pub(super) struct ProgramDefinitions<'a> {
    pub functions: RetainedDefinitions<'a, DefinitionSite>,
    pub layouts: RetainedDefinitions<'a, DefinitionSite>,
    pub variables: RetainedDefinitions<'a, VariableDefinition>,
}

impl<'a> ProgramDefinitions<'a> {
    pub(super) fn new(
        functions: &'a MergedKeys<ProgramFunctionKey>,
        layouts: &'a MergedKeys<ProgramLayoutKey>,
        variables: &'a MergedKeys<ProgramVariableKey>,
        definitions: &'a Definitions,
        retained: &'a Retained,
    ) -> ProgramDefinitions<'a> {
        ProgramDefinitions {
            functions: RetainedDefinitions {
                local_to_merged: &functions.local_to_merged,
                chosen: &definitions.functions,
                retained: &retained.functions,
                create_definition: identity,
            },
            layouts: RetainedDefinitions {
                local_to_merged: &layouts.local_to_merged,
                chosen: &definitions.layouts,
                retained: &retained.layouts,
                create_definition: identity,
            },
            variables: RetainedDefinitions {
                local_to_merged: &variables.local_to_merged,
                chosen: &definitions.variables,
                retained: &retained.variables,
                create_definition: VariableDefinition::Unit,
            },
        }
    }
}

fn number_in_order<I: Id>(
    merged_count: usize,
    order: impl IntoIterator<Item = u32>,
    count: &mut usize,
) -> Vec<Option<I>> {
    let mut ids: Vec<Option<I>> = vec![None; merged_count];
    for merged in order {
        debug_assert!(ids[merged as usize].is_none());
        ids[merged as usize] = Some(I::new(*count));
        *count += 1;
    }
    ids
}

fn number_marked<I: Id>(marks: &[bool], count: &mut usize) -> Vec<Option<I>> {
    let number = |&is_marked: &bool| {
        let id = is_marked.then(|| I::new(*count));
        *count += usize::from(is_marked);
        id
    };
    marks.iter().map(number).collect()
}

fn resolve_program_ids<I: Id>(local_to_merged: &[u32], ids: &[Option<I>]) -> Vec<Option<I>> {
    local_to_merged
        .iter()
        .map(|&merged| ids[merged as usize])
        .collect()
}

fn number_unit_records(marks: &[UnitMarks], counts: &mut ProgramCounts) -> Vec<(usize, UnitIds)> {
    marks
        .iter()
        .map(|marks| UnitIds {
            type_sites: number_marked(&marks.type_sites, &mut counts.type_sites),
            expected_results: number_marked(&marks.expected_results, &mut counts.expected_results),
            eval_scopes: number_marked(&marks.eval_scopes, &mut counts.eval_scopes),
            data: number_marked(&marks.data, &mut counts.data),
            ..UnitIds::default()
        })
        .enumerate()
        .collect()
}

/// The strings, the property keys and the types of a unit get their ids elsewhere.
pub(super) fn number_program(
    input: &MergedUnits<'_>,
    definitions: &Definitions,
    retained: &Retained,
) -> Numbering {
    let (units, modules) = (input.units, input.modules);
    let (functions, layouts, variables) = (input.functions, input.layouts, input.variables);
    let defined = ProgramDefinitions::new(functions, layouts, variables, definitions, retained);
    let mut counts = ProgramCounts::default();

    let function_lists = units.iter().map(|unit| &unit.function_definitions);
    let function_order = defined.functions.in_units(function_lists);
    let function_ids = number_in_order(functions.keys.len(), function_order, &mut counts.functions);

    let variable_lists = units.iter().map(|unit| &unit.variable_definitions);
    let unit_variables = defined.variables.in_units(variable_lists);
    let mut variable_ids =
        number_in_order(variables.keys.len(), unit_variables, &mut counts.variables);
    debug_assert_eq!(variables.local_to_merged.len(), units.len() + 1);
    for &synthetic_export in &variables.local_to_merged[units.len()] {
        let id = &mut variable_ids[synthetic_export as usize];
        if retained.variables[synthetic_export as usize] && id.is_none() {
            *id = Some(VariableId::new(counts.variables));
            counts.variables += 1;
        }
    }

    let layout_order = order_program_layouts(units, layouts, definitions, &defined.layouts);
    let layout_ids = number_in_order(layouts.keys.len(), layout_order, &mut counts.layouts);

    counts.modules = modules.modules.len();
    let module_ids: Vec<Option<ModuleId>> = (0..counts.modules)
        .map(|index| Some(ModuleId::new(index)))
        .collect();
    let failure_marks = retained.module_failures.as_ref();
    let module_failure_ids =
        failure_marks.map(|_, marks| number_marked(marks, &mut counts.module_failures));

    debug_assert_eq!(retained.units.len(), units.len());
    let mut slots = number_unit_records(&retained.units, &mut counts);
    for_each_mut(&mut slots, input.in_parallel, &|(index, ids)| {
        let (index, unit) = (*index, &units[*index]);
        ids.functions = resolve_program_ids(&functions.local_to_merged[index], &function_ids);
        ids.layouts = resolve_program_ids(&layouts.local_to_merged[index], &layout_ids);
        ids.variables = resolve_program_ids(&variables.local_to_merged[index], &variable_ids);
        let declared_modules = unit.modules.iter();
        ids.modules = declared_modules
            .map(|module| {
                // A module that the program does not reach is declared by code that is not kept.
                let index = *modules.index_by_module.get(module)?;
                module_ids[index as usize]
            })
            .collect();
        let project_failure_ids = module_failure_ids.get(unit.file.project);
        let declared_failures = unit.module_failures.iter();
        ids.module_failures = declared_failures
            .map(|failure| project_failure_ids[failure.0 as usize])
            .collect();
    });

    Numbering {
        functions: function_ids,
        layouts: layout_ids,
        variables: variable_ids,
        modules: module_ids,
        module_failures: module_failure_ids,
        counts,
        units: slots.into_iter().map(|(_, ids)| ids).collect(),
    }
}
