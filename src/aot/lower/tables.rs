use core::any::Any;
use std::sync::Arc;

use bun_sema::atom::Atom;
use bun_sema::check::Checker;
use bun_sema::check::aot::RowsCarriedOver;
use bun_sema::program::FileId;
use bun_threading::Guarded;
use rustc_hash::FxHashMap;

use super::fragment::{FileMarks, KeyFinders};
use super::layouts::KnownOrders;
use super::types::TypeMemo;
use crate::ir::{
    FunctionKey, LayoutKey, PropertyKeyId, PropertyKeyTable, StringId, StringTable, TypeTable,
    VariableKey,
};
use crate::modules::{self, ModuleRef};

pub struct UnitTables {
    pub strings: StringTable,
    pub property_keys: PropertyKeyTable,
    pub types: TypeTable,
    pub function_keys: Vec<FunctionKey>,
    pub layout_keys: Vec<LayoutKey>,
    pub variable_keys: Vec<VariableKey>,
    pub module_keys: Vec<ModuleRef>,
    pub module_failure_keys: Vec<modules::ModuleFailureId>,
    pub eval_scope_count: u32,
    pub data_count: u32,
    pub expected_result_count: u32,
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct TableLengths {
    pub strings: u32,
    pub property_keys: u32,
    pub types: u32,
    pub functions: u32,
    pub layouts: u32,
    pub variables: u32,
    pub modules: u32,
    pub module_failures: u32,
    pub eval_scopes: u32,
    pub data: u32,
    pub expected_results: u32,
}

impl TableLengths {
    pub fn max(self, other: TableLengths) -> TableLengths {
        TableLengths {
            strings: self.strings.max(other.strings),
            property_keys: self.property_keys.max(other.property_keys),
            types: self.types.max(other.types),
            functions: self.functions.max(other.functions),
            layouts: self.layouts.max(other.layouts),
            variables: self.variables.max(other.variables),
            modules: self.modules.max(other.modules),
            module_failures: self.module_failures.max(other.module_failures),
            eval_scopes: self.eval_scopes.max(other.eval_scopes),
            data: self.data.max(other.data),
            expected_results: self.expected_results.max(other.expected_results),
        }
    }
}

impl UnitTables {
    fn new() -> UnitTables {
        UnitTables {
            strings: StringTable::default(),
            property_keys: PropertyKeyTable::default(),
            types: TypeTable::new(),
            function_keys: Vec::new(),
            layout_keys: Vec::new(),
            variable_keys: Vec::new(),
            module_keys: Vec::new(),
            module_failure_keys: Vec::new(),
            eval_scope_count: 0,
            data_count: 0,
            expected_result_count: 0,
        }
    }

    pub fn lengths(&self) -> TableLengths {
        TableLengths {
            strings: self.strings.len() as u32,
            property_keys: self.property_keys.len() as u32,
            types: self.types.len() as u32,
            functions: self.function_keys.len() as u32,
            layouts: self.layout_keys.len() as u32,
            variables: self.variable_keys.len() as u32,
            modules: self.module_keys.len() as u32,
            module_failures: self.module_failure_keys.len() as u32,
            eval_scopes: self.eval_scope_count,
            data: self.data_count,
            expected_results: self.expected_result_count,
        }
    }

    fn truncate(&mut self, lengths: TableLengths) {
        self.strings.truncate(lengths.strings as usize);
        self.property_keys.truncate(lengths.property_keys as usize);
        self.types.truncate(lengths.types as usize);
        self.function_keys.truncate(lengths.functions as usize);
        self.layout_keys.truncate(lengths.layouts as usize);
        self.variable_keys.truncate(lengths.variables as usize);
        self.module_keys.truncate(lengths.modules as usize);
        self.module_failure_keys
            .truncate(lengths.module_failures as usize);
        self.eval_scope_count = self.eval_scope_count.min(lengths.eval_scopes);
        self.data_count = self.data_count.min(lengths.data);
        self.expected_result_count = self.expected_result_count.min(lengths.expected_results);
    }
}

pub struct SharedTables {
    tables: Guarded<Option<Box<UnitTables>>>,
    commits: Guarded<Option<(TableLengths, u32)>>,
}

impl SharedTables {
    fn new(tables: UnitTables) -> SharedTables {
        SharedTables {
            tables: Guarded::new(Some(Box::new(tables))),
            commits: Guarded::new(None),
        }
    }

    pub(crate) fn take(&self) -> Box<UnitTables> {
        let tables = self.tables.lock().take();
        tables.expect("the tables are out: a visit has not given them back, or the link has them")
    }

    pub(crate) fn put_back(&self, tables: Box<UnitTables>) {
        let others = self.tables.lock().replace(tables);
        debug_assert!(others.is_none(), "only tables that were taken are put back");
    }

    pub(crate) fn note_commit(&self, lengths: TableLengths) {
        let mut commits = self.commits.lock();
        let count = commits.map_or(0, |(_, count)| count);
        *commits = Some((lengths, count + 1));
    }

    pub(crate) fn count_noted_commits(&self) -> Option<u32> {
        self.commits.lock().map(|(_, count)| count)
    }
}

const TOO_MANY_PLACES: &str = "a task gives out fewer than 2^32 places";

pub(crate) struct Places {
    entries: Vec<u32>,
    first: u32,
    count: u32,
}

impl Default for Places {
    fn default() -> Places {
        Places {
            entries: Vec::new(),
            first: 1,
            count: 0,
        }
    }
}

impl Places {
    pub(in crate::lower) fn begin_file(&mut self) {
        self.first = self.first.checked_add(self.count).expect(TOO_MANY_PLACES);
        self.count = 0;
    }

    #[inline]
    pub(in crate::lower) fn place(&mut self, index: usize) -> usize {
        if self.entries.len() <= index {
            self.add_entries_up_to(index);
        }
        let entry = &mut self.entries[index];
        if *entry < self.first {
            *entry = self.first.checked_add(self.count).expect(TOO_MANY_PLACES);
            self.count += 1;
        }
        (*entry - self.first) as usize
    }

    #[cold]
    #[inline(never)]
    fn add_entries_up_to(&mut self, index: usize) {
        let length = (index + 1).max(2 * self.entries.len());
        self.entries.resize(length, 0);
    }

    #[inline]
    pub(in crate::lower) fn find(&self, index: usize) -> Option<usize> {
        let place = self.entries.get(index)?.checked_sub(self.first)?;
        Some(place as usize)
    }
}

pub(crate) struct TaskState {
    pub(in crate::lower) tables: Arc<SharedTables>,
    pub(in crate::lower) finders: KeyFinders,
    pub(in crate::lower) marks: FileMarks,
    pub(in crate::lower) layout_places: Places,
    pub(in crate::lower) function_places: Places,
    pub(in crate::lower) memo: TypeMemo,
    pub(in crate::lower) orders: KnownOrders,
    is_of_program: Option<bool>,
    pub(in crate::lower) atoms: FxHashMap<Atom, StringId>,
    pub(in crate::lower) atom_keys: FxHashMap<Atom, PropertyKeyId>,
    pub(in crate::lower) visit: u32,
    pub(in crate::lower) last_visit: Option<(FileId, TableLengths)>,
}

impl TaskState {
    pub(crate) fn new() -> TaskState {
        TaskState {
            tables: Arc::new(SharedTables::new(UnitTables::new())),
            finders: KeyFinders::default(),
            marks: FileMarks::default(),
            layout_places: Places::default(),
            function_places: Places::default(),
            memo: TypeMemo::default(),
            orders: KnownOrders::default(),
            is_of_program: None,
            atoms: FxHashMap::default(),
            atom_keys: FxHashMap::default(),
            visit: 0,
            last_visit: None,
        }
    }

    pub(in crate::lower) fn begin_file_of(&mut self, is_of_program: bool) {
        let filled_by = self.is_of_program.replace(is_of_program);
        if filled_by.is_some_and(|filled_by| filled_by != is_of_program) {
            self.memo = TypeMemo::default();
        }
    }

    pub(in crate::lower) fn roll_back(&mut self, lengths: TableLengths) {
        let mut tables = self.tables.take();
        debug_assert_eq!(
            tables.lengths().max(lengths),
            tables.lengths(),
            "the lengths are those of these tables at an earlier moment"
        );
        tables.truncate(lengths);
        self.tables.put_back(tables);
        self.finders.truncate(lengths);
        self.atoms
            .retain(|_, string| string.to_word() < lengths.strings);
        self.atom_keys
            .retain(|_, key| key.to_word() < lengths.property_keys);
        self.memo.forget_types_from(lengths.types);
    }

    fn hand_on(self, carried: Option<&RowsCarriedOver<'_>>) -> Option<TaskState> {
        let (committed_lengths, _) = (*self.tables.commits.lock())?;
        let mut next = TaskState {
            tables: self.tables,
            finders: self.finders,
            marks: self.marks,
            layout_places: Places::default(),
            function_places: Places::default(),
            memo: self.memo.hand_on(carried),
            orders: KnownOrders::default(),
            is_of_program: carried.and(self.is_of_program),
            atoms: self.atoms,
            atom_keys: self.atom_keys,
            visit: self.visit,
            last_visit: None,
        };
        let tables = next.tables.take();
        let ends_with_lost_visit = tables.lengths() != committed_lengths;
        next.tables.put_back(tables);
        if ends_with_lost_visit {
            next.roll_back(committed_lengths);
        }
        Some(next)
    }
}

pub(in crate::lower) fn take_task_state(checker: &mut Checker<'_, '_>) -> Box<TaskState> {
    let kept = checker.state_of_lowering().take();
    let kept = kept.or_else(|| checker.state_of_lowering_in_last_task().take());
    let state = kept.and_then(|kept| kept.downcast::<TaskState>().ok());
    state.unwrap_or_else(|| Box::new(TaskState::new()))
}

fn hand_on_at_end_of_task(
    kept: Box<dyn Any + Send>,
    carried: Option<&RowsCarriedOver<'_>>,
) -> Option<Box<dyn Any + Send>> {
    let next = kept.downcast::<TaskState>().ok()?.hand_on(carried)?;
    Some(Box::new(next))
}

pub(in crate::lower) fn put_back_task_state(checker: &mut Checker<'_, '_>, state: Box<TaskState>) {
    let kept: Box<dyn Any + Send> = state;
    *checker.state_of_lowering() = Some(kept);
    checker.hand_state_of_lowering_on_with(hand_on_at_end_of_task);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{PropertyKey, Type};
    use crate::link::testing::{test_class_key, test_function_key, test_variable_key};
    use crate::lower::fragment::{FragmentBuilder, ModuleFragment};

    #[test]
    fn file_gets_its_places_in_the_order_of_asking() {
        let mut places = Places::default();
        places.begin_file();
        assert_eq!(places.find(7), None);
        assert_eq!(
            [places.place(7), places.place(2), places.place(7)],
            [0, 1, 0]
        );
        assert_eq!([places.find(7), places.find(2)], [Some(0), Some(1)]);
        assert_eq!([places.find(3), places.find(8)], [None, None]);
    }

    #[test]
    fn file_has_no_place_that_an_earlier_file_was_given() {
        let mut places = Places::default();
        places.begin_file();
        places.place(7);
        places.place(2);
        places.begin_file();
        assert_eq!([places.find(7), places.find(2)], [None, None]);
        assert_eq!([places.place(2), places.place(7)], [0, 1]);
        places.begin_file();
        places.begin_file();
        assert_eq!(places.find(2), None);
        assert_eq!(places.place(9), 0);
    }

    #[test]
    fn max_takes_each_length_by_itself() {
        let first = TableLengths {
            strings: 3,
            types: 20,
            ..TableLengths::default()
        };
        let second = TableLengths {
            strings: 5,
            types: 17,
            data: 1,
            ..TableLengths::default()
        };
        let both = TableLengths {
            strings: 5,
            types: 20,
            data: 1,
            ..TableLengths::default()
        };
        assert_eq!(first.max(second), both);
        assert_eq!(second.max(first), both);
    }

    #[test]
    fn new_tables_hold_the_well_known_types_alone() {
        let lengths = TaskState::new().tables.take().lengths();
        let well_known = TableLengths {
            types: TypeTable::WELL_KNOWN_COUNT as u32,
            ..TableLengths::default()
        };
        assert_eq!(lengths, well_known);
    }

    #[test]
    #[should_panic(expected = "the tables are out")]
    fn tables_that_are_out_cannot_be_taken() {
        let state = TaskState::new();
        let _tables = state.tables.take();
        state.tables.take();
    }

    #[test]
    fn next_task_writes_under_the_tables_of_the_last_without_the_visit_that_was_lost() {
        let mut state = TaskState::new();
        let mut committed = FragmentBuilder::new(FileId(0), &mut state);
        let function = committed.declare_function(test_function_key(0, 0));
        let string = committed.strings.intern(b"committed");
        let committed = committed.finish(ModuleFragment::default(), &mut state);
        committed.tables.note_commit(committed.lengths);
        state.atoms.insert(Atom(1), string);

        let mut lost = FragmentBuilder::new(FileId(1), &mut state);
        lost.declare_function(test_function_key(1, 0));
        let late_string = lost.strings.intern(b"lost");
        let lost = lost.finish(ModuleFragment::default(), &mut state);
        state.atoms.insert(Atom(2), late_string);
        let visit = state.visit;

        let mut next = state.hand_on(None).expect("a visit was committed");
        assert!(Arc::ptr_eq(&next.tables, &committed.tables));
        assert!(Arc::ptr_eq(&next.tables, &lost.tables));
        assert_eq!(next.atoms, FxHashMap::from_iter([(Atom(1), string)]));
        assert_eq!((next.visit, next.last_visit), (visit, None));
        let mut builder = FragmentBuilder::new(FileId(2), &mut next);
        assert_eq!(builder.declare_function(test_function_key(0, 0)), function);
        assert_eq!(
            builder.declare_function(test_function_key(2, 0)).to_word(),
            1
        );
        assert_eq!(builder.strings.find(b"committed"), Some(string));
        assert_eq!(builder.strings.find(b"lost"), None);
        assert_eq!(builder.strings.intern(b"next"), late_string);
    }

    #[test]
    fn next_task_keeps_all_that_the_last_has_committed() {
        let mut state = TaskState::new();
        let mut committed = FragmentBuilder::new(FileId(0), &mut state);
        let string = committed.strings.intern(b"committed");
        let committed = committed.finish(ModuleFragment::default(), &mut state);
        committed.tables.note_commit(committed.lengths);
        let next = state.hand_on(None).expect("a visit was committed");
        let tables = next.tables.take();
        assert_eq!(tables.lengths(), committed.lengths);
        assert_eq!(tables.strings.find(b"committed"), Some(string));
    }

    #[test]
    fn tables_without_a_committed_visit_are_not_handed_on() {
        let mut state = TaskState::new();
        let lost = FragmentBuilder::new(FileId(0), &mut state);
        drop(lost.finish(ModuleFragment::default(), &mut state));
        assert!(state.hand_on(None).is_none());
    }

    #[test]
    fn roll_back_takes_out_what_lies_behind_the_lengths() {
        let mut state = TaskState::new();
        let mut committed = FragmentBuilder::new(FileId(0), &mut state);
        let function = committed.declare_function(test_function_key(0, 0));
        let string = committed.strings.intern(b"committed");
        let key = committed
            .property_keys
            .intern(PropertyKey::from_text(string));
        let committed = committed.finish(ModuleFragment::default(), &mut state);
        let lengths = committed.lengths;
        state.atoms.insert(Atom(1), string);
        state.atom_keys.insert(Atom(1), key);

        let mut superseded = FragmentBuilder::new(FileId(1), &mut state);
        superseded.declare_function(test_function_key(1, 0));
        superseded.declare_layout(test_class_key(1, 0));
        superseded.declare_variable(test_variable_key(1, 0));
        superseded.declare_module(ModuleRef::File(FileId(1)));
        superseded.declare_module_failure(modules::ModuleFailureId(3));
        let late_string = superseded.strings.intern(b"superseded");
        let late_key = superseded
            .property_keys
            .intern(PropertyKey::from_text(late_string));
        superseded.types.intern(Type::string_literal(late_string));
        drop(superseded.finish(ModuleFragment::default(), &mut state));
        state.atoms.insert(Atom(2), late_string);
        state.atom_keys.insert(Atom(2), late_key);
        let mut tables = state.tables.take();
        tables.eval_scope_count += 1;
        tables.data_count += 1;
        tables.expected_result_count += 1;
        state.tables.put_back(tables);

        state.roll_back(lengths);

        assert_eq!(state.atoms, FxHashMap::from_iter([(Atom(1), string)]));
        assert_eq!(state.atom_keys, FxHashMap::from_iter([(Atom(1), key)]));
        let mut next = FragmentBuilder::new(FileId(2), &mut state);
        assert_eq!(state.last_visit, Some((FileId(2), lengths)));
        assert_eq!(next.declare_function(test_function_key(0, 0)), function);
        assert_eq!(next.declare_function(test_function_key(2, 0)).to_word(), 1);
        assert_eq!(next.strings.find(b"committed"), Some(string));
        assert_eq!(next.strings.find(b"superseded"), None);
        assert_eq!(next.strings.intern(b"next"), late_string);
    }
}
