use super::beside::{Beside, run_beside};
use super::definitions::{empty_layout, synthetic_export_variable};
use super::keys::MergedKeys;
use super::numbering::ProgramDefinitions;
use super::program_keys::ProgramLayoutKey;
use super::state::{
    Definitions, ExportWriter, Numbering, ProgramTables, SupertypeEdges, VariableDefinition,
};
use super::unit::LinkUnit;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Data, EvalScope, ExpectedResult, Function, Layout, LayoutFlags, LayoutKind, TypeSite, Variable,
};
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, Id, IdMap, InParallel, LayoutId, StringTable,
    TypeSiteId, VariableId, for_each_mut,
};
use bun_sema::atom::{Atom, Interner};
use bun_sema::util::SharedSort;
use core::mem::{MaybeUninit, take};
use std::sync::Arc;

pub(super) struct MoveInput<'a, 's> {
    pub defined: ProgramDefinitions<'a>,
    pub layouts: &'a MergedKeys<ProgramLayoutKey>,
    pub definitions: &'a Definitions,
    pub numbering: &'a Numbering,
    pub atoms: &'a Interner<'s>,
    pub in_parallel: InParallel<'a>,
    pub beside: Beside<'a>,
}

#[derive(Default)]
struct UnitOutput {
    functions: Vec<Arc<Function>>,
    layouts: Vec<(LayoutId, Layout)>,
    other_layout_definitions: Vec<(LayoutId, Layout)>,
    variables: Vec<(VariableId, Variable)>,
    type_sites: Vec<(TypeSiteId, TypeSite)>,
    expected_results: Vec<(ExpectedResultId, ExpectedResult)>,
    eval_scopes: Vec<(EvalScopeId, EvalScope)>,
    data: Vec<(DataId, Data)>,
}

// A file may be in the build for the types it declares alone. Nothing loads it then, so the program has no record of it.
fn forget_module_without_record(layout: &mut Layout, map: &IdMap<'_>) {
    let has_record = layout
        .module
        .is_none_or(|module| map.modules[module.index()].is_some());
    if layout.kind == LayoutKind::Record && !has_record {
        layout.module = None;
        layout.position = 0;
    }
}

fn program_id<I: Id>(ids: &[Option<I>], merged: u32) -> I {
    ids[merged as usize].expect("a retained key has a program id")
}

fn take_numbered<I: Id, T>(
    records: &mut Vec<T>,
    ids: &[Option<I>],
) -> impl Iterator<Item = (I, T)> {
    debug_assert_eq!(records.len(), ids.len());
    let numbered_records = take(records).into_iter().zip(ids);
    numbered_records.filter_map(|(record, &id)| Some((id?, record)))
}

fn program_ids_above<I: Id>(edges: &SupertypeEdges, merged: u32, ids: &[Option<I>]) -> Vec<I> {
    let above = edges.of(merged).iter();
    let mut ids: Vec<I> = above.filter_map(|&above| ids[above as usize]).collect();
    ids.sort_unstable();
    ids
}

impl MoveInput<'_, '_> {
    fn add_family(&self, merged: u32, layout: &mut Layout) {
        layout.supertypes = program_ids_above(
            &self.definitions.supertypes,
            merged,
            &self.numbering.layouts,
        );
        if self.definitions.has_members_without_layout[merged as usize] {
            layout.flags |= LayoutFlags::HAS_MEMBERS_WITHOUT_LAYOUT;
        }
    }

    fn builtin_members_of(&self, function_type: u32) -> Vec<BuiltinId> {
        let members = &self.definitions.builtin_members;
        let start = members.partition_point(|&(owner, _)| owner < function_type);
        let members = members[start..].iter();
        members
            .take_while(|&&(owner, _)| owner == function_type)
            .map(|&(_, builtin)| builtin)
            .collect()
    }

    fn move_unit(&self, index: u32, unit: &mut LinkUnit) -> UnitOutput {
        let numbering = self.numbering;
        let ids = &numbering.units[index as usize];
        let map = ids.as_map();
        let defined = &self.defined;
        let mut output = UnitOutput::default();
        let mut next_function = None;
        for (merged, mut function) in defined
            .functions
            .take_from(index, &mut unit.function_definitions)
        {
            let id = program_id(&numbering.functions, merged).index();
            assert!(
                next_function.is_none_or(|next| next == id),
                "program ids follow the order of the unit"
            );
            next_function = Some(id + 1);
            // The record stays where it is, with the ids of its unit. Only one that several keys share is copied.
            let record = Arc::make_mut(&mut function);
            record.function_types = program_ids_above(
                &self.definitions.function_types,
                merged,
                &numbering.functions,
            );
            record.builtin_members = self.builtin_members_of(merged);
            output.functions.push(function);
        }
        for (merged, site, is_chosen, mut layout) in defined
            .layouts
            .take_retained_from(index, &mut unit.layout_definitions)
        {
            let id = program_id(&numbering.layouts, merged);
            forget_module_without_record(&mut layout, &map);
            if is_chosen {
                layout.remap_ids(&map);
                self.add_family(merged, &mut layout);
                output.layouts.push((id, layout));
            } else if self.definitions.is_other_definition(merged, site) {
                layout.name = None;
                for field in &mut layout.fields {
                    field.declared.site = None;
                }
                layout.remap_ids(&map);
                output.other_layout_definitions.push((id, layout));
            }
        }
        for (merged, mut variable) in defined
            .variables
            .take_from(index, &mut unit.variable_definitions)
        {
            variable.remap_ids(&map);
            let id = program_id(&numbering.variables, merged);
            output.variables.push((id, variable));
        }
        let records = &mut unit.records;
        for (id, mut site) in take_numbered(&mut records.type_sites, &ids.type_sites) {
            site.remap_ids(&map);
            output.type_sites.push((id, site));
        }
        for (id, mut expected) in
            take_numbered(&mut records.expected_results, &ids.expected_results)
        {
            expected.remap_ids(&map);
            output.expected_results.push((id, expected));
        }
        for (id, mut scope) in take_numbered(&mut records.eval_scopes, &ids.eval_scopes) {
            scope.remap_ids(&map);
            output.eval_scopes.push((id, scope));
        }
        for (id, mut data) in take_numbered(&mut records.data, &ids.data) {
            data.remap_ids(&map);
            output.data.push((id, data));
        }
        output
    }
}

struct RecordsById<T> {
    slots: Vec<Option<T>>,
}

impl<T> RecordsById<T> {
    fn new(count: usize) -> RecordsById<T> {
        RecordsById {
            slots: (0..count).map(|_| None).collect(),
        }
    }

    fn insert(&mut self, id: impl Id, record: T) {
        let slot = &mut self.slots[id.index()];
        debug_assert!(slot.is_none(), "two records have one program id");
        *slot = Some(record);
    }

    fn insert_all(&mut self, lists: Vec<Vec<(impl Id, T)>>) {
        for (id, record) in lists.into_iter().flatten() {
            self.insert(id, record);
        }
    }

    fn into_records(self) -> Vec<T> {
        let slots = self.slots.into_iter();
        slots
            .map(|slot| slot.expect("every program id has a record"))
            .collect()
    }
}

// The ids of the records of a unit follow each other, and the first follows the last of the unit before.
fn join_records<I: Id + Send, T: Send>(
    lists: Vec<Vec<(I, T)>>,
    count: usize,
    in_parallel: InParallel<'_>,
) -> Vec<T> {
    let mut records: Vec<T> = Vec::with_capacity(count);
    let mut free = &mut records.spare_capacity_mut()[..count];
    let mut first = 0;
    let mut tasks: Vec<(usize, Vec<(I, T)>, &mut [MaybeUninit<T>])> = Vec::new();
    for list in lists {
        if list.is_empty() {
            continue;
        }
        let length = list.len();
        let (slots, rest) = take(&mut free).split_at_mut(length);
        free = rest;
        tasks.push((first, list, slots));
        first += length;
    }
    assert!(free.is_empty(), "every program id has a record");
    for_each_mut(&mut tasks, in_parallel, &|(first, list, slots)| {
        let numbered_slots = (*first..).zip(slots.iter_mut());
        for ((id, record), (index, slot)) in take(list).into_iter().zip(numbered_slots) {
            assert!(
                id.index() == index,
                "program ids follow the order of the units"
            );
            slot.write(record);
        }
    });
    drop(tasks);
    // SAFETY: the tasks have the first `count` slots among them, each as many as it has records, and each has written all of
    // its own.
    unsafe { records.set_len(count) };
    records
}

pub(super) fn move_definitions(
    units: &mut [LinkUnit],
    input: &MoveInput<'_, '_>,
    strings: &mut StringTable,
) -> ProgramTables {
    let numbering = input.numbering;
    debug_assert_eq!(units.len(), numbering.units.len());
    let mut tasks: Vec<(u32, &mut LinkUnit, UnitOutput)> = (0..)
        .zip(units)
        .map(|(index, unit)| (index, unit, UnitOutput::default()))
        .collect();
    for_each_mut(&mut tasks, input.in_parallel, &|(index, unit, output)| {
        *output = input.move_unit(*index, unit);
    });

    let counts = &numbering.counts;
    let mut functions = Vec::with_capacity(tasks.len());
    let mut layout_lists = Vec::with_capacity(tasks.len());
    let mut other_layout_lists = Vec::with_capacity(tasks.len());
    let mut variable_lists = Vec::with_capacity(tasks.len());
    let mut type_sites = Vec::with_capacity(tasks.len());
    let mut expected_results = Vec::with_capacity(tasks.len());
    let mut eval_scopes = Vec::with_capacity(tasks.len());
    let mut data = Vec::with_capacity(tasks.len());
    for (_, _, output) in tasks {
        functions.push(output.functions);
        layout_lists.push(output.layouts);
        if !output.other_layout_definitions.is_empty() {
            other_layout_lists.push(output.other_layout_definitions);
        }
        variable_lists.push(output.variables);
        type_sites.push(output.type_sites);
        expected_results.push(output.expected_results);
        eval_scopes.push(output.eval_scopes);
        data.push(output.data);
    }
    let in_parallel = input.in_parallel;
    // A record is large to move, and each kind has a table of its own.
    let (layouts, (mut variables, joined)) = run_beside(
        input.beside,
        || {
            let mut layouts = RecordsById::new(counts.layouts);
            layouts.insert_all(layout_lists);
            for layout in input.defined.layouts.without_definition() {
                let mut record = empty_layout(&input.layouts.keys[layout as usize].key);
                input.add_family(layout, &mut record);
                layouts.insert(program_id(&numbering.layouts, layout), record);
            }
            layouts.into_records()
        },
        || {
            run_beside(
                input.beside,
                || {
                    let mut variables = RecordsById::new(counts.variables);
                    variables.insert_all(variable_lists);
                    variables
                },
                || {
                    (
                        join_records(type_sites, counts.type_sites, in_parallel),
                        join_records(expected_results, counts.expected_results, in_parallel),
                        join_records(eval_scopes, counts.eval_scopes, in_parallel),
                        join_records(data, counts.data, in_parallel),
                    )
                },
            )
        },
    );
    let definitions = input.definitions.variables.iter();
    let mut synthetic_exports: Vec<(VariableId, u32, Atom, ExportWriter)> = definitions
        .zip(&numbering.variables)
        .filter_map(|(&definition, &id)| match definition {
            Some(VariableDefinition::SyntheticExport {
                module,
                name,
                writer,
                ..
            }) => Some((id?, module, name, writer)),
            Some(VariableDefinition::Unit(_)) | None => None,
        })
        .collect();
    synthetic_exports.shared_sort_unstable_by_key(|&(id, ..)| id);
    for (id, module, name, writer) in synthetic_exports {
        let name = strings.intern(input.atoms.bytes(name));
        let module = numbering.modules[module as usize]
            .expect("the mark keeps the module of a retained synthetic export");
        variables.insert(id, synthetic_export_variable(name, module, writer));
    }
    let (type_sites, expected_results, eval_scopes, data) = joined;
    assert_eq!(
        functions.iter().map(Vec::len).sum::<usize>(),
        counts.functions,
        "every program id has a record"
    );
    ProgramTables {
        functions_by_unit: functions,
        layouts,
        other_layout_definitions: other_layout_lists,
        variables: variables.into_records(),
        type_sites,
        expected_results,
        eval_scopes,
        data,
    }
}
