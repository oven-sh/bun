use super::beside::{Beside, run_steps_beside};
use super::definitions::{empty_layout, synthetic_export_variable, variable_that_holds_mock};
use super::linked_functions::FunctionsOfUnit;
use super::merged_keys::MergedKeys;
use super::numbering::Numbering;
use super::program_keys::{ProgramFunctionKey, ProgramLayoutKey, ProgramVariableKey};
use super::state::{DefinitionSite, Definitions, ExportWriter, SupertypeEdges, VariableDefinition};
use super::unit::LinkUnit;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Data, DeclaredRecord, EvalScope, ExpectedResult, Function, Layout, LayoutFlags, LayoutKind,
    Variable, VariableFlags,
};
use crate::ir::parallel::{extend_from_lists, map_each};
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, Id, InParallel, LayoutId, ModuleId,
    PackScratch, StringTable, VariableId, for_each_mut,
};
use crate::statistics::{Stage, StepClock};
use bun_sema::atom::{Atom, Interner};
use bun_sema::util::SharedSort;
use core::mem::take;
use std::sync::{Arc, OnceLock};

pub(super) struct ProgramTables {
    pub functions: Vec<FunctionsOfUnit>,
    pub layouts: Vec<Layout>,
    pub other_layout_definitions: Vec<Vec<(LayoutId, Layout)>>,
    pub variables: Vec<Variable>,
    pub eval_scopes: Vec<EvalScope>,
    pub data: Vec<Data>,
    pub expected_results: Vec<ExpectedResult>,
    pub declared_records: Vec<DeclaredRecord>,
}

#[derive(Default)]
struct UnitOutput {
    first_function: Option<FunctionId>,
    functions: Vec<Arc<Function>>,
    layouts: Vec<(LayoutId, Layout)>,
    other_layout_definitions: Vec<(LayoutId, Layout)>,
    variables: Vec<(VariableId, Variable)>,
    eval_scopes: Vec<(EvalScopeId, EvalScope)>,
    data: Vec<(DataId, Data)>,
    expected_results: Vec<(ExpectedResultId, ExpectedResult)>,
    declared_records: Vec<DeclaredRecord>,
}

fn place_of_export_named(name: &[u8]) -> u32 {
    let mix = |hash: u32, byte: &u8| (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193);
    name.iter().fold(0x811c_9dc5, mix)
}

fn forget_module_without_record(layout: &mut Layout, modules: &[Option<ModuleId>]) {
    let has_record = layout
        .module
        .is_none_or(|module| modules[module.index()].is_some());
    if layout.kind == LayoutKind::Record && !has_record {
        layout.module = None;
        layout.position = 0;
    }
}

fn program_id<I: Id>(ids: &[Option<I>], merged: u32) -> I {
    ids[merged as usize].expect("a key with a definition has a program id")
}

fn program_id_of_record<I: Id>(ids: &[Option<I>], number_in_tables: I) -> I {
    ids[number_in_tables.index()].expect("a record of a unit has a program id")
}

fn program_ids_above<I: Id>(edges: &SupertypeEdges, merged: u32, ids: &[Option<I>]) -> Vec<I> {
    let above = edges.of(merged).iter();
    let mut ids: Vec<I> = above.filter_map(|&above| ids[above as usize]).collect();
    ids.sort_unstable();
    ids
}

fn take_definitions<I: Id, T>(
    unit: u32,
    definitions: &mut Vec<(I, T)>,
    local_to_merged: &[u32],
) -> impl Iterator<Item = (u32, DefinitionSite, T)> {
    (0..)
        .zip(take(definitions))
        .map(move |(index, (id, definition))| {
            let site = DefinitionSite { unit, index };
            (local_to_merged[id.index()], site, definition)
        })
}

struct RecordMover<'a> {
    merged_functions: &'a [Vec<u32>],
    merged_layouts: &'a [Vec<u32>],
    merged_variables: &'a [Vec<u32>],
    layout_keys: &'a [ProgramLayoutKey],
    definitions: &'a Definitions,
    numbering: &'a Numbering,
}

impl RecordMover<'_> {
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

    fn move_functions(&self, index: u32, unit: &mut LinkUnit, output: &mut UnitOutput) {
        let local_to_merged = &self.merged_functions[unit.tables as usize];
        let definitions = &mut unit.function_definitions;
        let mut scratch = PackScratch::default();
        output.functions.reserve(definitions.len());
        for (merged, site, function) in take_definitions(index, definitions, local_to_merged) {
            if self.definitions.functions[merged as usize] != Some(site) {
                continue;
            }
            let id = program_id(&self.numbering.functions, merged);
            let first = *output.first_function.get_or_insert(id);
            assert!(
                id.index() == first.index() + output.functions.len(),
                "program ids follow the order of the unit"
            );
            let mut function = function.unpack(&mut scratch);
            let record = Arc::make_mut(&mut function);
            record.function_types = program_ids_above(
                &self.definitions.function_types,
                merged,
                &self.numbering.functions,
            );
            record.builtin_members = self.builtin_members_of(merged);
            output.functions.push(function);
        }
    }

    fn move_layouts(&self, index: u32, unit: &mut LinkUnit, output: &mut UnitOutput) {
        let ids = &self.numbering.tables[unit.tables as usize];
        let map = ids.as_map();
        let local_to_merged = &self.merged_layouts[unit.tables as usize];
        let definitions = &mut unit.layout_definitions;
        let mut scratch = PackScratch::default();
        for (merged, site, layout) in take_definitions(index, definitions, local_to_merged) {
            let is_chosen = self.definitions.layouts[merged as usize] == Some(site);
            if !is_chosen && !self.definitions.is_other_definition(merged, site) {
                continue;
            }
            let id = program_id(&self.numbering.layouts, merged);
            let mut layout = layout.unpack(&mut scratch);
            forget_module_without_record(&mut layout, &ids.modules);
            if layout.module.is_some() && layout.place.is_none() {
                layout.place = Some(layout.position);
            }
            if is_chosen {
                layout.remap_ids(&map);
                self.add_family(merged, &mut layout);
                output.layouts.push((id, layout));
            } else {
                layout.name = None;
                layout.remap_ids(&map);
                output.other_layout_definitions.push((id, layout));
            }
        }
    }

    fn move_variables(&self, index: u32, unit: &mut LinkUnit, output: &mut UnitOutput) {
        let map = self.numbering.tables[unit.tables as usize].as_map();
        let local_to_merged = &self.merged_variables[unit.tables as usize];
        let definitions = &mut unit.variable_definitions;
        output.variables.reserve(definitions.len());
        for (merged, site, mut variable) in take_definitions(index, definitions, local_to_merged) {
            let chosen = self.definitions.variables[merged as usize];
            if chosen != Some(VariableDefinition::Unit(site)) {
                continue;
            }
            variable.remap_ids(&map);
            let id = program_id(&self.numbering.variables, merged);
            output.variables.push((id, variable));
        }
    }

    fn move_records_without_key(&self, unit: &mut LinkUnit, output: &mut UnitOutput) {
        let ids = &self.numbering.tables[unit.tables as usize];
        let map = ids.as_map();
        output.eval_scopes = take(&mut unit.records.eval_scopes);
        for (id, scope) in &mut output.eval_scopes {
            scope.remap_ids(&map);
            *id = program_id_of_record(&ids.eval_scopes, *id);
        }
        output.data = take(&mut unit.records.data);
        for (id, data) in &mut output.data {
            data.remap_ids(&map);
            *id = program_id_of_record(&ids.data, *id);
        }
        output.expected_results = take(&mut unit.records.expected_results);
        for (id, expected) in &mut output.expected_results {
            expected.remap_ids(&map);
            expected.layouts.sort_unstable();
            *id = program_id_of_record(&ids.expected_results, *id);
        }
        output.declared_records = take(&mut unit.records.declared_records);
        output.declared_records.retain_mut(|declared| {
            let Some(&Some(module)) = map.modules.get(declared.module.index()) else {
                return false;
            };
            declared.module = module;
            let has_every_name = declared.names.iter_mut().all(|name| {
                let in_program = map.property_keys.get(name.index()).copied().flatten();
                in_program.map(|key| *name = key).is_some()
            });
            declared.names.sort_unstable();
            has_every_name
        });
    }

    fn move_unit(&self, index: u32, unit: &mut LinkUnit) -> UnitOutput {
        let mut output = UnitOutput::default();
        self.move_functions(index, unit, &mut output);
        self.move_layouts(index, unit, &mut output);
        self.move_variables(index, unit, &mut output);
        self.move_records_without_key(unit, &mut output);
        output
    }

    fn add_layouts_without_definition(&self, layouts: &RecordsById<Layout>) {
        let chosen = self.definitions.layouts.iter();
        for (merged, (chosen, &id)) in (0u32..).zip(chosen.zip(&self.numbering.layouts)) {
            if let (None, Some(id)) = (chosen, id) {
                let mut record = empty_layout(&self.layout_keys[merged as usize].key);
                self.add_family(merged, &mut record);
                layouts.insert(id, record);
            }
        }
    }

    fn add_variables_without_unit(
        &self,
        variables: &RecordsById<Variable>,
        synthetic_exports: Vec<(VariableId, Variable)>,
    ) {
        let definitions = self.definitions.variables.iter();
        for (&definition, &id) in definitions.zip(&self.numbering.variables) {
            let (Some(definition), Some(id)) = (definition, id) else {
                continue;
            };
            match definition {
                VariableDefinition::Unit(_) | VariableDefinition::SyntheticExport { .. } => {}
                VariableDefinition::MockOfRuntimeModule { module } => {
                    let module = module_id(self.numbering, module);
                    variables.insert(id, variable_that_holds_mock(module));
                }
            }
        }
        for (id, variable) in synthetic_exports {
            variables.insert(id, variable);
        }
    }
}

fn module_id(numbering: &Numbering, module: u32) -> ModuleId {
    numbering.modules[module as usize].expect("every module of the table has a record")
}

struct SyntheticExportVariable {
    id: VariableId,
    module: ModuleId,
    name: Atom,
    is_known_member: bool,
    is_replaceable: bool,
    writer: ExportWriter,
}

const SLOTS_IN_A_LOT: usize = if cfg!(test) { 2 } else { 1 << 10 };
const LISTS_IN_A_TASK: usize = if cfg!(test) { 2 } else { 64 };

struct RecordsById<T> {
    lots: Vec<Vec<OnceLock<T>>>,
}

impl<T: Send + Sync> RecordsById<T> {
    fn new(count: usize, in_parallel: InParallel<'_>) -> RecordsById<T> {
        let starts: Vec<usize> = (0..count).step_by(SLOTS_IN_A_LOT).collect();
        let lots = map_each(starts, in_parallel, &|start: usize| {
            let places = start..count.min(start + SLOTS_IN_A_LOT);
            places
                .map(|_| OnceLock::new())
                .collect::<Vec<OnceLock<T>>>()
        });
        RecordsById { lots }
    }

    fn insert(&self, id: impl Id, record: T) {
        let slot = &self.lots[id.index() / SLOTS_IN_A_LOT][id.index() % SLOTS_IN_A_LOT];
        assert!(slot.set(record).is_ok(), "two records have one program id");
    }

    fn insert_all<I: Id + Send>(&self, lists: Vec<Vec<(I, T)>>, in_parallel: InParallel<'_>) {
        let mut lists = lists.into_iter().filter(|list| !list.is_empty());
        let mut tasks: Vec<Vec<Vec<(I, T)>>> = Vec::new();
        loop {
            let task: Vec<Vec<(I, T)>> = lists.by_ref().take(LISTS_IN_A_TASK).collect();
            if task.is_empty() {
                break;
            }
            tasks.push(task);
        }
        map_each(tasks, in_parallel, &|task: Vec<Vec<(I, T)>>| {
            for (id, record) in task.into_iter().flatten() {
                self.insert(id, record);
            }
        });
    }

    fn into_records(self, in_parallel: InParallel<'_>) -> Vec<T> {
        let lots = map_each(self.lots, in_parallel, &|lot: Vec<OnceLock<T>>| {
            let slots = lot.into_iter().map(OnceLock::into_inner);
            slots
                .map(|slot| slot.expect("every program id has a record"))
                .collect::<Vec<T>>()
        });
        let count: usize = lots.iter().map(Vec::len).sum();
        let mut records = Vec::with_capacity(count + count / 8);
        extend_from_lists(&mut records, lots, in_parallel);
        records
    }
}

fn join_records<I: Id, T>(lists: Vec<Vec<(I, T)>>, count: usize) -> Vec<T> {
    let mut records: Vec<T> = Vec::with_capacity(count);
    for (id, record) in lists.into_iter().flatten() {
        assert!(
            id.index() == records.len(),
            "program ids follow the order of the units"
        );
        records.push(record);
    }
    assert!(records.len() == count, "every program id has a record");
    records
}

pub(super) fn make_synthetic_export_variables(
    definitions: &Definitions,
    numbering: &Numbering,
    atoms: &Interner<'_>,
    strings: &mut StringTable,
) -> Vec<(VariableId, Variable)> {
    let mut exports: Vec<SyntheticExportVariable> = Vec::new();
    for (&definition, &id) in definitions.variables.iter().zip(&numbering.variables) {
        let (Some(definition), Some(id)) = (definition, id) else {
            continue;
        };
        if let VariableDefinition::SyntheticExport {
            module,
            name,
            is_known_member,
            is_replaceable,
            writer,
        } = definition
        {
            exports.push(SyntheticExportVariable {
                id,
                module: module_id(numbering, module),
                name,
                is_known_member,
                is_replaceable,
                writer,
            });
        }
    }
    exports.shared_sort_unstable_by_key(|export| export.id);
    let variables = exports.into_iter().map(|export| {
        let name = strings.intern(atoms.bytes(export.name));
        let mut variable =
            synthetic_export_variable(name, export.module, export.writer, export.is_known_member);
        variable.place = Some(place_of_export_named(atoms.bytes(export.name)));
        if export.is_replaceable {
            variable.flags |= VariableFlags::IS_REPLACEABLE;
        }
        (export.id, variable)
    });
    variables.collect()
}

pub(super) fn move_records(
    units: &mut [LinkUnit],
    functions: &MergedKeys<'_, ProgramFunctionKey>,
    layouts: &MergedKeys<'_, ProgramLayoutKey>,
    variables: &MergedKeys<'_, ProgramVariableKey>,
    definitions: &Definitions,
    numbering: &Numbering,
    synthetic_exports: Vec<(VariableId, Variable)>,
    in_parallel: InParallel<'_>,
    beside: Beside<'_>,
) -> ProgramTables {
    assert_eq!(definitions.functions.len(), numbering.functions.len());
    assert_eq!(definitions.layouts.len(), numbering.layouts.len());
    assert_eq!(definitions.layouts.len(), layouts.keys.len());
    assert_eq!(definitions.variables.len(), numbering.variables.len());
    let mover = RecordMover {
        merged_functions: &functions.local_to_merged,
        merged_layouts: &layouts.local_to_merged,
        merged_variables: &variables.local_to_merged,
        layout_keys: &layouts.keys,
        definitions,
        numbering,
    };
    let mut tasks: Vec<(u32, &mut LinkUnit, UnitOutput)> = (0..)
        .zip(units)
        .map(|(index, unit)| (index, unit, UnitOutput::default()))
        .collect();
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    for_each_mut(&mut tasks, in_parallel, &|(index, unit, output)| {
        *output = mover.move_unit(*index, unit);
    });
    steps.end("take records out of the units");

    let counts = &numbering.counts;
    let mut function_count = 0;
    let mut function_lists = Vec::with_capacity(tasks.len());
    let mut layout_lists = Vec::with_capacity(tasks.len());
    let mut other_layout_lists = Vec::new();
    let mut variable_lists = Vec::with_capacity(tasks.len());
    let mut eval_scope_lists = Vec::with_capacity(tasks.len());
    let mut data_lists = Vec::with_capacity(tasks.len());
    let mut expected_result_lists = Vec::with_capacity(tasks.len());
    let mut declared_records = Vec::new();
    for (_, unit, output) in tasks {
        assert!(
            output
                .first_function
                .is_none_or(|first| first.index() == function_count),
            "program ids follow the order of the units"
        );
        function_count += output.functions.len();
        function_lists.push(FunctionsOfUnit {
            tables: unit.tables,
            functions: output.functions,
        });
        layout_lists.push(output.layouts);
        if !output.other_layout_definitions.is_empty() {
            other_layout_lists.push(output.other_layout_definitions);
        }
        variable_lists.push(output.variables);
        eval_scope_lists.push(output.eval_scopes);
        data_lists.push(output.data);
        expected_result_lists.push(output.expected_results);
        declared_records.extend(output.declared_records);
    }
    assert!(
        function_count == counts.functions,
        "every program id has a record"
    );

    steps.end("lists of the units");

    let (layouts, (variables, (eval_scopes, data, expected_results))) = run_steps_beside(
        beside,
        &mut steps,
        ["table of layouts", "the other tables"],
        || {
            let layouts = RecordsById::new(counts.layouts, in_parallel);
            layouts.insert_all(layout_lists, in_parallel);
            mover.add_layouts_without_definition(&layouts);
            layouts.into_records(in_parallel)
        },
        || {
            let mut steps = StepClock::new(Stage::LinkAndEmit);
            run_steps_beside(
                beside,
                &mut steps,
                ["table of variables", "scopes, data, expected results"],
                || {
                    let variables = RecordsById::new(counts.variables, in_parallel);
                    variables.insert_all(variable_lists, in_parallel);
                    variables
                },
                || {
                    (
                        join_records(eval_scope_lists, counts.eval_scopes),
                        join_records(data_lists, counts.data),
                        join_records(expected_result_lists, counts.expected_results),
                    )
                },
            )
        },
    );
    mover.add_variables_without_unit(&variables, synthetic_exports);
    declared_records.sort_unstable_by(|one, other| {
        let place = |it: &DeclaredRecord| (it.module, it.position, it.parameter);
        place(one)
            .cmp(&place(other))
            .then_with(|| one.names.cmp(&other.names))
    });
    declared_records.dedup();
    ProgramTables {
        functions: function_lists,
        layouts,
        other_layout_definitions: other_layout_lists,
        variables: variables.into_records(in_parallel),
        eval_scopes,
        data,
        expected_results,
        declared_records,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::link::testing::{forward, reverse};

    fn layout_declared_in(kind: LayoutKind, module: usize) -> Layout {
        Layout {
            kind,
            module: Some(ModuleId::new(module)),
            position: 9,
            ..Layout::default()
        }
    }

    fn place_after_forgetting(mut layout: Layout) -> (Option<ModuleId>, u32) {
        forget_module_without_record(&mut layout, &[Some(ModuleId::new(4)), None]);
        (layout.module, layout.position)
    }

    #[test]
    fn plain_layout_loses_the_place_in_a_file_that_nothing_loads() {
        let layout = layout_declared_in(LayoutKind::Record, 1);
        assert_eq!(place_after_forgetting(layout), (None, 0));
    }

    #[test]
    fn plain_layout_keeps_the_place_in_a_file_with_a_record() {
        let layout = layout_declared_in(LayoutKind::Record, 0);
        assert_eq!(
            place_after_forgetting(layout),
            (Some(ModuleId::new(0)), 9),
            "the number of the tables stands until the record is remapped"
        );
    }

    #[test]
    fn class_keeps_its_place() {
        let layout = layout_declared_in(LayoutKind::Instance, 1);
        assert_eq!(place_after_forgetting(layout), (Some(ModuleId::new(1)), 9));
    }

    #[test]
    fn plain_layout_without_a_place_stays_as_it_is() {
        let layout = Layout {
            kind: LayoutKind::Record,
            ..Layout::default()
        };
        assert_eq!(place_after_forgetting(layout), (None, 0));
    }

    #[test]
    fn ids_above_are_sorted_and_leave_out_what_has_no_id() {
        let edges = SupertypeEdges {
            starts: vec![0, 3, 3],
            supertypes: vec![1, 2, 3],
        };
        let ids = [None, Some(LayoutId::new(7)), None, Some(LayoutId::new(2))];
        assert_eq!(
            program_ids_above(&edges, 0, &ids),
            [LayoutId::new(2), LayoutId::new(7)]
        );
        assert!(program_ids_above(&edges, 1, &ids).is_empty());
    }

    #[test]
    fn definitions_are_taken_with_merged_index_and_site() {
        let mut definitions = vec![(VariableId::new(2), 'a'), (VariableId::new(0), 'b')];
        let taken: Vec<_> = take_definitions(5, &mut definitions, &[10, 11, 12]).collect();
        assert_eq!(
            taken,
            [
                (12, DefinitionSite { unit: 5, index: 0 }, 'a'),
                (10, DefinitionSite { unit: 5, index: 1 }, 'b'),
            ]
        );
        assert!(definitions.is_empty());
    }

    #[test]
    fn records_stand_at_their_ids() {
        let ways: [InParallel<'_>; 2] = [&forward, &reverse];
        for in_parallel in ways {
            let records = RecordsById::new(5, in_parallel);
            let lists = vec![
                vec![(VariableId::new(2), 'c'), (VariableId::new(0), 'a')],
                Vec::new(),
                vec![(VariableId::new(4), 'e')],
                vec![(VariableId::new(3), 'd')],
            ];
            records.insert_all(lists, in_parallel);
            records.insert(VariableId::new(1), 'b');
            assert_eq!(records.into_records(in_parallel), ['a', 'b', 'c', 'd', 'e']);
        }
    }

    #[test]
    #[should_panic(expected = "two records have one program id")]
    fn second_record_for_an_id_stops_the_link() {
        let records = RecordsById::new(1, &forward);
        records.insert(VariableId::new(0), 'a');
        records.insert(VariableId::new(0), 'b');
    }

    #[test]
    #[should_panic(expected = "every program id has a record")]
    fn id_without_a_record_stops_the_link() {
        let records = RecordsById::new(2, &forward);
        records.insert(VariableId::new(1), 'b');
        records.into_records(&forward);
    }

    #[test]
    fn lists_of_units_are_joined_in_their_order() {
        let lists = vec![
            vec![(DataId::new(0), 'a'), (DataId::new(1), 'b')],
            Vec::new(),
            vec![(DataId::new(2), 'c')],
        ];
        assert_eq!(join_records(lists, 3), ['a', 'b', 'c']);
    }

    #[test]
    #[should_panic(expected = "program ids follow the order of the units")]
    fn gap_between_the_ids_of_two_units_stops_the_link() {
        let lists = vec![vec![(DataId::new(0), 'a')], vec![(DataId::new(2), 'c')]];
        join_records(lists, 3);
    }

    #[test]
    #[should_panic(expected = "every program id has a record")]
    fn fewer_records_than_ids_stop_the_link() {
        join_records(vec![vec![(DataId::new(0), 'a')]], 2);
    }
}
