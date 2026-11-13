#[cfg(test)]
mod tests;

use core::hash::Hash;
use core::mem::{replace, take};

use std::sync::Arc;

use bun_sema::atom::Atom;
use bun_sema::check::aot::TypeIdentity;
use bun_sema::erasure::PackedTypeRanges;
use bun_sema::program::FileId;
use rustc_hash::FxHashMap;

use super::CheckerTypeId;
use super::convert::FamilyFacts;
use super::layouts::ObjectTypeKey;
use super::tables::{SharedTables, TableLengths, TaskState, UnitTables};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Data, DeclaredRecord, EvalScope, ExpectedResult, Field, Function, FunctionRole,
    FunctionVisibility, Layout, LayoutFlags, ModuleInstance, ModuleLink, RuntimeFunctionEntry,
    SourcePositions, SourceRange, Variable,
};
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, FunctionKey, Id, LayoutId, LayoutKey,
    ModuleFailureId, ModuleId, PropertyKeyId, PropertyKeyTable, Reference, StringTable, TypeTable,
    VariableId, VariableKey,
};
use crate::link::TableIds;
use crate::modules::{self, ModuleRef};

#[derive(Default, Clone)]
pub struct ModuleFragment {
    pub body: Option<FunctionId>,
    pub data: Option<DataId>,
    pub positions: SourcePositions,
    pub erased_type_ranges: Option<PackedTypeRanges>,
    pub throws_at_load: bool,
}

/// A name that the code of a class uses off its instances, which the class it extends may have.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct NameOfHeir {
    pub heir: LayoutId,
    pub parent_is_parameter: bool,
    pub name: PropertyKeyId,
}

pub struct Fragment {
    pub file: FileId,
    pub is_checked: bool,
    pub tables: Arc<SharedTables>,
    pub lengths: TableLengths,
    pub functions: Vec<(FunctionId, Arc<Function>)>,
    pub layouts: Vec<(LayoutId, Layout)>,
    pub object_types: Vec<(u32, ObjectTypeKey)>,
    pub said_types: Vec<CheckerTypeId>,
    pub said_keys: Vec<(TypeIdentity, ObjectTypeKey)>,
    pub layouts_named_by_code: Vec<LayoutId>,
    pub allocated_layouts: Vec<LayoutId>,
    pub names_of_heirs: Vec<NameOfHeir>,
    pub written_keys: Vec<PropertyKeyId>,
    pub read_keys: Vec<PropertyKeyId>,
    pub keys_laid_by_descriptors: Vec<PropertyKeyId>,
    pub variables: Vec<(VariableId, Variable)>,
    pub eval_scopes: Vec<(EvalScopeId, EvalScope)>,
    pub data: Vec<(DataId, Data)>,
    pub expected_results: Vec<(ExpectedResultId, ExpectedResult)>,
    pub declared_records: Vec<DeclaredRecord>,
    pub module_instances: Vec<ModuleInstance>,
    pub module_links: Vec<ModuleLink>,
    pub supertype_edges: Vec<(LayoutId, LayoutId)>,
    pub function_type_edges: Vec<(FunctionId, FunctionId)>,
    pub builtin_members: Vec<(FunctionId, BuiltinId)>,
    pub(crate) family_facts: FamilyFacts,
    pub runtime_functions: Vec<RuntimeFunctionEntry>,
    pub module: ModuleFragment,
}

impl Fragment {
    /// The signatures of a fragment are one record, and few of those of a part are kept.
    pub(in crate::lower) fn remap_code(&mut self, ids: &TableIds) {
        let map = ids.as_map();
        let functions = self.functions.iter_mut().map(|(_, function)| function);
        for function in functions.filter(|it| it.role != FunctionRole::Signature) {
            Arc::make_mut(function).remap_ids(&map);
        }
        for (_, layout) in &mut self.layouts {
            layout.remap_ids(&map);
        }
    }
}

struct KeyTable<K> {
    ids: FxHashMap<K, u32>,
    keys: Vec<K>,
    named_in: Vec<u32>,
    defined_in: Vec<u32>,
}

impl<K> Default for KeyTable<K> {
    fn default() -> KeyTable<K> {
        KeyTable {
            ids: FxHashMap::default(),
            keys: Vec::new(),
            named_in: Vec::new(),
            defined_in: Vec::new(),
        }
    }
}

impl<K: Copy + Eq + Hash> KeyTable<K> {
    fn with_keys(mut self, keys: Vec<K>) -> KeyTable<K> {
        debug_assert!(self.keys.is_empty());
        debug_assert_eq!(self.ids.len(), keys.len());
        debug_assert_eq!(self.named_in.len(), keys.len());
        debug_assert_eq!(self.defined_in.len(), keys.len());
        self.keys = keys;
        self
    }

    fn number<I: Id>(&mut self, key: K) -> I {
        if let Some(&id) = self.ids.get(&key) {
            return I::new(id as usize);
        }
        let id = I::new(self.keys.len());
        self.ids.insert(key, id.to_word());
        self.keys.push(key);
        self.named_in.push(0);
        self.defined_in.push(0);
        id
    }

    #[inline]
    fn name(&mut self, id: impl Id, visit: u32) -> bool {
        replace(&mut self.named_in[id.index()], visit) != visit
    }

    fn declare<I: Id>(&mut self, key: K, visit: u32) -> (I, bool) {
        let id: I = self.number(key);
        (id, self.name(id, visit))
    }

    fn is_named(&self, id: impl Id, visit: u32) -> bool {
        self.named_in.get(id.index()) == Some(&visit)
    }

    #[inline]
    fn key_of(&self, id: impl Id) -> K {
        self.keys[id.index()]
    }

    #[inline]
    fn is_defined(&self, id: impl Id, visit: u32) -> bool {
        self.defined_in[id.index()] == visit
    }

    fn mark_defined(&mut self, id: impl Id, visit: u32) {
        let last_defined_in = replace(&mut self.defined_in[id.index()], visit);
        debug_assert!(last_defined_in != visit, "a fragment defines a key once");
    }

    fn truncate(&mut self, length: u32) {
        debug_assert!(self.keys.is_empty());
        let length = length as usize;
        if self.named_in.len() <= length {
            return;
        }
        self.ids.retain(|_, id| (*id as usize) < length);
        self.named_in.truncate(length);
        self.defined_in.truncate(length);
    }

    fn forget_keys_from(&mut self, length: u32) {
        let length = length as usize;
        for key in self.keys.drain(length..) {
            self.ids.remove(&key);
        }
        self.named_in.truncate(length);
        self.defined_in.truncate(length);
    }
}

#[derive(Default)]
pub(crate) struct KeyFinders {
    functions: KeyTable<FunctionKey>,
    layouts: KeyTable<LayoutKey>,
    variables: KeyTable<VariableKey>,
    modules: KeyTable<ModuleRef>,
    module_failures: KeyTable<modules::ModuleFailureId>,
}

impl KeyFinders {
    pub(crate) fn truncate(&mut self, lengths: TableLengths) {
        self.functions.truncate(lengths.functions);
        self.layouts.truncate(lengths.layouts);
        self.variables.truncate(lengths.variables);
        self.modules.truncate(lengths.modules);
        self.module_failures.truncate(lengths.module_failures);
    }
}

#[derive(Default)]
pub(crate) struct FileMarks {
    layout_allocated_in: Vec<u32>,
    layout_written_under_dictionary_type_in: Vec<u32>,
    key_written_in: Vec<u32>,
    keys_read: Vec<u64>,
}

#[inline]
fn set_mark(marked_in: &mut Vec<u32>, id: impl Id, visit: u32) -> bool {
    if marked_in.len() <= id.index() {
        marked_in.resize(id.index() + 1, 0);
    }
    replace(&mut marked_in[id.index()], visit) != visit
}

fn is_marked(marked_in: &[u32], id: impl Id, visit: u32) -> bool {
    marked_in.get(id.index()) == Some(&visit)
}

fn add_record<I: Id, R>(records: &mut Vec<(I, R)>, count_in_tables: &mut u32, record: R) -> I {
    let id = I::new(*count_in_tables as usize);
    *count_in_tables += 1;
    records.push((id, record));
    id
}

fn sort_and_dedup<T: Ord>(mut list: Vec<T>) -> Vec<T> {
    list.sort_unstable();
    list.dedup();
    list
}

fn new_id<I: Id>(ids: &[Option<I>], id: I) -> I {
    ids[id.index()].expect("every record of a part has a place in the tables of the file")
}

fn is_function_type(key: FunctionKey) -> bool {
    matches!(
        key,
        FunctionKey::Signature(_) | FunctionKey::ClassSignature(_)
    )
}

pub(crate) struct FragmentBuilder {
    pub(crate) strings: StringTable,
    pub(crate) property_keys: PropertyKeyTable,
    pub(crate) types: TypeTable,
    pub(crate) family_facts: FamilyFacts,
    pub(crate) is_checked: bool,
    file: FileId,
    visit: u32,
    atoms_first_met: Vec<Atom>,
    function_keys: KeyTable<FunctionKey>,
    layout_keys: KeyTable<LayoutKey>,
    layouts_named_in_file: Vec<LayoutId>,
    layouts_named_in_parts: Vec<LayoutId>,
    /// What other parts say of a layout that one part defines.
    declared_by_other_parts: FxHashMap<LayoutId, (LayoutFlags, Option<FunctionId>)>,
    code_layout_count: Option<usize>,
    variable_keys: KeyTable<VariableKey>,
    module_keys: KeyTable<ModuleRef>,
    module_of_file: Option<ModuleId>,
    module_failure_keys: KeyTable<modules::ModuleFailureId>,
    functions: Vec<(FunctionId, Arc<Function>)>,
    layouts: Vec<(LayoutId, Layout)>,
    object_types: Vec<(u32, ObjectTypeKey)>,
    said_types: Vec<CheckerTypeId>,
    said_keys: Vec<(TypeIdentity, ObjectTypeKey)>,
    marks: FileMarks,
    allocated_layouts: Vec<LayoutId>,
    names_of_heirs: Vec<NameOfHeir>,
    written_keys: Vec<PropertyKeyId>,
    read_keys: Vec<PropertyKeyId>,
    keys_laid_by_descriptors: Vec<PropertyKeyId>,
    variables: Vec<(VariableId, Variable)>,
    eval_scope_count: u32,
    eval_scopes: Vec<(EvalScopeId, EvalScope)>,
    data_count: u32,
    data: Vec<(DataId, Data)>,
    expected_result_count: u32,
    expected_results: Vec<(ExpectedResultId, ExpectedResult)>,
    declared_records: Vec<DeclaredRecord>,
    module_instances: Vec<ModuleInstance>,
    module_links: Vec<ModuleLink>,
    supertype_edges: Vec<(LayoutId, LayoutId)>,
    function_type_edges: Vec<(FunctionId, FunctionId)>,
    runtime_functions: Vec<RuntimeFunctionEntry>,
    #[cfg(test)]
    own_state: Option<Box<TaskState>>,
}

impl FragmentBuilder {
    pub(crate) fn new(file: FileId, state: &mut TaskState) -> FragmentBuilder {
        if let Some((last_file, lengths)) = state.last_visit
            && last_file == file
        {
            state.roll_back(lengths);
        }
        state.visit += 1;
        let tables = *state.tables.take();
        state.last_visit = Some((file, tables.lengths()));
        let finders = take(&mut state.finders);
        FragmentBuilder {
            strings: tables.strings,
            property_keys: tables.property_keys,
            types: tables.types,
            family_facts: FamilyFacts::default(),
            is_checked: false,
            file,
            visit: state.visit,
            atoms_first_met: Vec::new(),
            function_keys: finders.functions.with_keys(tables.function_keys),
            layout_keys: finders.layouts.with_keys(tables.layout_keys),
            layouts_named_in_file: Vec::new(),
            layouts_named_in_parts: Vec::new(),
            declared_by_other_parts: FxHashMap::default(),
            code_layout_count: None,
            variable_keys: finders.variables.with_keys(tables.variable_keys),
            module_keys: finders.modules.with_keys(tables.module_keys),
            module_of_file: None,
            module_failure_keys: finders
                .module_failures
                .with_keys(tables.module_failure_keys),
            functions: Vec::new(),
            layouts: Vec::new(),
            object_types: Vec::new(),
            said_types: Vec::new(),
            said_keys: Vec::new(),
            marks: take(&mut state.marks),
            allocated_layouts: Vec::new(),
            names_of_heirs: Vec::new(),
            written_keys: Vec::new(),
            read_keys: Vec::new(),
            keys_laid_by_descriptors: Vec::new(),
            variables: Vec::new(),
            eval_scope_count: tables.eval_scope_count,
            eval_scopes: Vec::new(),
            data_count: tables.data_count,
            data: Vec::new(),
            expected_result_count: tables.expected_result_count,
            expected_results: Vec::new(),
            declared_records: Vec::new(),
            module_instances: Vec::new(),
            module_links: Vec::new(),
            supertype_edges: Vec::new(),
            function_type_edges: Vec::new(),
            runtime_functions: Vec::new(),
            #[cfg(test)]
            own_state: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn alone(file: FileId) -> FragmentBuilder {
        let mut state = Box::new(TaskState::new());
        let mut builder = FragmentBuilder::new(file, &mut state);
        builder.own_state = Some(state);
        builder
    }

    #[inline]
    pub(crate) fn note_atom_first_met(&mut self, atom: Atom) {
        self.atoms_first_met.push(atom);
    }

    pub(crate) fn declare_function(&mut self, key: FunctionKey) -> FunctionId {
        self.function_keys.declare(key, self.visit).0
    }

    pub(crate) fn declare_layout(&mut self, key: LayoutKey) -> LayoutId {
        let layout = self.number_layout(key);
        self.name_layout(layout);
        layout
    }

    pub(crate) fn number_layout(&mut self, key: LayoutKey) -> LayoutId {
        self.layout_keys.number(key)
    }

    #[inline]
    pub(crate) fn name_layout(&mut self, layout: LayoutId) {
        if self.layout_keys.name(layout, self.visit) {
            self.layouts_named_in_file.push(layout);
        }
    }

    pub(crate) fn declare_variable(&mut self, key: VariableKey) -> VariableId {
        self.variable_keys.declare(key, self.visit).0
    }

    #[inline]
    pub(crate) fn declare_module(&mut self, module: ModuleRef) -> ModuleId {
        match self.module_of_file {
            Some(own) if module == ModuleRef::File(self.file) => own,
            _ => self.declare_module_in_table(module),
        }
    }

    fn declare_module_in_table(&mut self, module: ModuleRef) -> ModuleId {
        let id = self.module_keys.declare(module, self.visit).0;
        if module == ModuleRef::File(self.file) {
            self.module_of_file = Some(id);
        }
        id
    }

    #[inline]
    pub(crate) fn module_ref(&self, module: ModuleId) -> ModuleRef {
        self.module_keys.key_of(module)
    }

    pub(crate) fn declare_module_failure(
        &mut self,
        failure: modules::ModuleFailureId,
    ) -> ModuleFailureId {
        self.module_failure_keys.declare(failure, self.visit).0
    }

    #[inline]
    pub(crate) fn function_key(&self, function: FunctionId) -> FunctionKey {
        self.function_keys.key_of(function)
    }

    #[inline]
    pub(crate) fn layout_key(&self, layout: LayoutId) -> LayoutKey {
        self.layout_keys.key_of(layout)
    }

    #[inline]
    pub(crate) fn layouts_named_in_file(&self) -> &[LayoutId] {
        &self.layouts_named_in_file
    }

    pub(crate) fn end_layouts_of_code(&mut self) -> usize {
        debug_assert!(self.code_layout_count.is_none());
        let count = self.layouts_named_in_file.len();
        self.code_layout_count = Some(count);
        count
    }

    #[inline]
    pub(crate) fn is_layout_defined(&self, layout: LayoutId) -> bool {
        self.layout_keys.is_defined(layout, self.visit)
    }

    #[inline]
    pub(crate) fn is_variable_defined(&self, variable: VariableId) -> bool {
        self.variable_keys.is_defined(variable, self.visit)
    }

    pub(crate) fn define_function(&mut self, id: FunctionId, function: impl Into<Arc<Function>>) {
        self.define_shared_function(id, function.into());
    }

    fn define_shared_function(&mut self, id: FunctionId, function: Arc<Function>) {
        debug_assert!(
            is_function_type(self.function_key(id))
                || self.function_key(id).home_file() == self.file
        );
        debug_assert!(
            function.function_types.is_empty(),
            "function types are edges until link"
        );
        self.function_keys.mark_defined(id, self.visit);
        self.functions.push((id, function));
    }

    pub(crate) fn map_function_source_ranges(
        &mut self,
        mut map: impl FnMut(FunctionKey, SourceRange) -> SourceRange,
    ) {
        for (id, function) in &mut self.functions {
            let mapped = map(self.function_keys.key_of(*id), function.source_range);
            if mapped != function.source_range {
                Arc::make_mut(function).source_range = mapped;
            }
        }
    }

    pub(crate) fn define_layout(&mut self, id: LayoutId, layout: Layout) {
        debug_assert!(
            layout.supertypes.is_empty(),
            "supertypes are edges until link"
        );
        self.layout_keys.mark_defined(id, self.visit);
        self.layouts.push((id, layout));
    }

    pub(crate) fn define_object_type(
        &mut self,
        id: LayoutId,
        layout: Layout,
        ty: Option<ObjectTypeKey>,
    ) -> u32 {
        debug_assert!(matches!(self.layout_key(id), LayoutKey::ObjectType { .. }));
        self.layout_keys.defined_in[id.index()] = self.visit;
        let index = self.layouts.len() as u32;
        if let Some(ty) = ty {
            self.object_types.push((index, ty));
        }
        self.layouts.push((id, layout));
        index
    }

    pub(crate) fn note_said_type(&mut self, ty: CheckerTypeId) {
        self.said_types.push(ty);
    }

    pub(crate) fn note_said_key(&mut self, names: TypeIdentity, key: ObjectTypeKey) {
        self.said_keys.push((names, key));
    }

    pub(crate) fn define_object_type_anew(&mut self, index: u32, layout: Layout) {
        self.layouts[index as usize].1 = layout;
    }

    pub(crate) fn define_variable(&mut self, id: VariableId, variable: Variable) {
        self.variable_keys.mark_defined(id, self.visit);
        self.variables.push((id, variable));
    }

    pub(crate) fn note_allocation(&mut self, layout: LayoutId) {
        if set_mark(&mut self.marks.layout_allocated_in, layout, self.visit) {
            self.allocated_layouts.push(layout);
        }
    }

    pub(crate) fn note_name_of_heir(&mut self, name: NameOfHeir) {
        self.names_of_heirs.push(name);
    }

    pub(crate) fn allocated_layouts(&self) -> &[LayoutId] {
        &self.allocated_layouts
    }

    pub(crate) fn note_literal_under_dictionary_type(&mut self, layout: LayoutId) {
        let marked_in = &mut self.marks.layout_written_under_dictionary_type_in;
        set_mark(marked_in, layout, self.visit);
    }

    pub(crate) fn note_write(&mut self, key: PropertyKeyId) {
        if set_mark(&mut self.marks.key_written_in, key, self.visit) {
            self.written_keys.push(key);
        }
    }

    pub(crate) fn note_key_laid_by_descriptor(&mut self, key: PropertyKeyId) {
        self.keys_laid_by_descriptors.push(key);
    }

    pub(crate) fn note_read(&mut self, key: PropertyKeyId) {
        let (word, bit) = (key.index() / 64, 1u64 << (key.index() % 64));
        let words = &mut self.marks.keys_read;
        if words.len() <= word {
            words.resize(word + 1, 0);
        }
        if words[word] & bit == 0 {
            words[word] |= bit;
            self.read_keys.push(key);
        }
    }

    fn note_what_is_built(&mut self, reference: Reference) {
        match reference {
            Reference::Layout(layout) => self.note_allocation(layout),
            Reference::PropertyKey(key) => self.note_write(key),
            Reference::String(_)
            | Reference::Type(_)
            | Reference::TypeSite(_)
            | Reference::ExpectedResult(_)
            | Reference::Variable(_)
            | Reference::Module(..)
            | Reference::ModuleFailure(_)
            | Reference::EvalScope(_)
            | Reference::Function(..)
            | Reference::Data(_)
            | Reference::Builtin(_) => {}
        }
    }

    pub(crate) fn add_eval_scope(&mut self, scope: EvalScope) -> EvalScopeId {
        add_record(&mut self.eval_scopes, &mut self.eval_scope_count, scope)
    }

    pub(crate) fn add_data(&mut self, data: Data) -> DataId {
        data.for_each_reference(&mut |reference| self.note_what_is_built(reference));
        add_record(&mut self.data, &mut self.data_count, data)
    }

    pub(crate) fn add_declared_record(&mut self, declared: DeclaredRecord) {
        self.declared_records.push(declared);
    }

    pub(crate) fn add_module_instance(&mut self, instance: ModuleInstance) {
        self.module_instances.push(instance);
    }

    pub(crate) fn add_module_link(&mut self, link: ModuleLink) {
        self.module_links.push(link);
    }

    pub(crate) fn add_layout_field(&mut self, layout: LayoutId, field: Field) -> u32 {
        let mut layouts = self.layouts.iter_mut().rev();
        let defined = layouts.find(|it| it.0 == layout);
        let fields = &mut defined.expect("the file defines the layout").1.fields;
        fields.push(field);
        fields.len() as u32 - 1
    }

    pub(crate) fn add_expected_result(&mut self, expected: ExpectedResult) -> ExpectedResultId {
        expected.for_each_reference(&mut |reference| self.note_what_is_built(reference));
        self.add_described_result(expected)
    }

    pub(crate) fn add_described_result(&mut self, expected: ExpectedResult) -> ExpectedResultId {
        let count = &mut self.expected_result_count;
        add_record(&mut self.expected_results, count, expected)
    }

    pub(crate) fn add_supertype(&mut self, layout: LayoutId, supertype: LayoutId) {
        debug_assert!(self.layout_keys.is_named(layout, self.visit));
        debug_assert!(self.layout_keys.is_named(supertype, self.visit));
        if layout != supertype {
            self.supertype_edges.push((layout, supertype));
        }
    }

    pub(crate) fn supertype_edges(&self) -> &[(LayoutId, LayoutId)] {
        &self.supertype_edges
    }

    pub(crate) fn add_function_type_edge(&mut self, source: FunctionId, target: FunctionId) {
        debug_assert!(self.function_keys.is_named(source, self.visit));
        debug_assert!(is_function_type(self.function_key(target)));
        if source != target {
            self.function_type_edges.push((source, target));
        }
    }

    pub(crate) fn add_runtime_function(&mut self, entry: RuntimeFunctionEntry) {
        debug_assert!(self.function_keys.is_named(entry.function, self.visit));
        self.runtime_functions.push(entry);
    }

    pub(crate) fn lists_functions_inside(&self, function: FunctionId) -> bool {
        self.runtime_functions.iter().any(|entry| {
            entry.function == function && entry.visibility == FunctionVisibility::Private
        })
    }

    pub(in crate::lower) fn is_function_named(&self, key: FunctionKey) -> bool {
        let id = self.function_keys.ids.get(&key);
        id.is_some_and(|&id| self.function_keys.named_in[id as usize] == self.visit)
    }

    pub(in crate::lower) fn is_function_defined(&self, key: FunctionKey) -> bool {
        let id = self.function_keys.ids.get(&key);
        id.is_some_and(|&id| self.function_keys.defined_in[id as usize] == self.visit)
    }

    /// The places of what `tables` hold in the tables of this file.
    fn number_tables_of_part(&mut self, tables: &UnitTables) -> TableIds {
        let mut ids = TableIds::default();
        for &key in &tables.module_keys {
            ids.modules.push(Some(self.declare_module(key)));
        }
        for &key in &tables.module_failure_keys {
            ids.module_failures
                .push(Some(self.declare_module_failure(key)));
        }
        for &key in &tables.function_keys {
            ids.functions.push(Some(self.declare_function(key)));
        }
        for &key in &tables.layout_keys {
            ids.layouts.push(Some(self.declare_layout(key)));
        }
        for &key in &tables.variable_keys {
            ids.variables.push(Some(self.declare_variable(key)));
        }
        for string in tables.strings.ids() {
            let string = self.strings.intern_string_of(&tables.strings, string);
            ids.strings.push(Some(string));
        }
        for key in tables.property_keys.as_slice() {
            let mut key = *key;
            key.remap_ids(&ids.as_map());
            ids.property_keys.push(Some(self.property_keys.intern(key)));
        }
        for ty in tables.types.types().iter() {
            let mut ty = ty.to_type();
            ty.remap_ids(&ids.as_map());
            ids.types.push(Some(self.types.intern(ty)));
        }
        let records = |first: u32, count: u32| first..first + count;
        let of_file = records(self.eval_scope_count, tables.eval_scope_count);
        ids.eval_scopes = of_file.clone().map(|it| Some(Id::from_word(it))).collect();
        self.eval_scope_count = of_file.end;
        let of_file = records(self.data_count, tables.data_count);
        ids.data = of_file.clone().map(|it| Some(Id::from_word(it))).collect();
        self.data_count = of_file.end;
        let of_file = records(self.expected_result_count, tables.expected_result_count);
        ids.expected_results = of_file.clone().map(|it| Some(Id::from_word(it))).collect();
        self.expected_result_count = of_file.end;
        ids
    }

    /// Where this file has what a part of it has lowered under tables of its own.
    pub(in crate::lower) fn number_part(&mut self, part: &Fragment) -> TableIds {
        debug_assert_eq!(part.file, self.file);
        let tables = part.tables.take();
        self.number_tables_of_part(&tables)
    }

    /// Adds what a part of the file has lowered. `ids`: `number_part`. `Fragment::remap_code` has come before it.
    pub(in crate::lower) fn absorb(&mut self, part: Fragment, ids: &TableIds) {
        let map = ids.as_map();
        let layout_of = |layout: LayoutId| new_id(&ids.layouts, layout);
        let function_of = |function: FunctionId| new_id(&ids.functions, function);
        let key_of = |key: PropertyKeyId| new_id(&ids.property_keys, key);
        for (id, mut function) in part.functions {
            let id = function_of(id);
            if self.function_keys.is_defined(id, self.visit) {
                // A signature, or what the members of a class share: whoever names it lowers it.
                continue;
            }
            if function.role == FunctionRole::Signature {
                Arc::make_mut(&mut function).remap_ids(&map);
            }
            self.define_shared_function(id, function);
        }
        let mut object_types = part.object_types.iter().peekable();
        for (index, (id, layout)) in (0u32..).zip(part.layouts) {
            let id = layout_of(id);
            let ty = object_types.next_if(|&&(of_layout, _)| of_layout == index);
            if let LayoutKey::ObjectType { .. } = self.layout_key(id) {
                self.define_object_type(id, layout, ty.map(|&(_, ty)| ty));
                continue;
            }
            debug_assert!(ty.is_none());
            if !self.is_layout_defined(id) {
                self.define_layout(id, layout);
            } else {
                let said = self.declared_by_other_parts.entry(id).or_default();
                said.0 |= layout.flags;
                said.1 = said.1.or(layout.constructor);
            }
        }
        for layout in part.layouts_named_by_code {
            self.layouts_named_in_parts.push(layout_of(layout));
        }
        for layout in part.allocated_layouts {
            self.note_allocation(layout_of(layout));
        }
        for name in part.names_of_heirs {
            self.note_name_of_heir(NameOfHeir {
                heir: layout_of(name.heir),
                name: key_of(name.name),
                ..name
            });
        }
        for key in part.written_keys {
            self.note_write(key_of(key));
        }
        for key in part.read_keys {
            self.note_read(key_of(key));
        }
        for key in part.keys_laid_by_descriptors {
            self.note_key_laid_by_descriptor(key_of(key));
        }
        for (id, mut variable) in part.variables {
            let id = new_id(&ids.variables, id);
            if !self.is_variable_defined(id) {
                variable.remap_ids(&map);
                self.define_variable(id, variable);
            }
        }
        for (id, mut scope) in part.eval_scopes {
            scope.remap_ids(&map);
            self.eval_scopes.push((new_id(&ids.eval_scopes, id), scope));
        }
        for (id, mut data) in part.data {
            data.remap_ids(&map);
            self.data.push((new_id(&ids.data, id), data));
        }
        for (id, mut expected) in part.expected_results {
            expected.remap_ids(&map);
            let id = new_id(&ids.expected_results, id);
            self.expected_results.push((id, expected));
        }
        for mut declared in part.declared_records {
            declared.module = new_id(&ids.modules, declared.module);
            for name in &mut declared.names {
                *name = key_of(*name);
            }
            self.declared_records.push(declared);
        }
        debug_assert!(part.module_instances.is_empty() && part.module_links.is_empty());
        debug_assert!(part.runtime_functions.is_empty());
        for (layout, supertype) in part.supertype_edges {
            self.add_supertype(layout_of(layout), layout_of(supertype));
        }
        for (source, target) in part.function_type_edges {
            self.add_function_type_edge(function_of(source), function_of(target));
        }
        for (source, target) in part.family_facts.conversions {
            let (source, target) = (new_id(&ids.types, source), new_id(&ids.types, target));
            self.family_facts.record_conversion(source, target);
        }
        for layout in part.family_facts.layouts_with_members_without_layout {
            self.family_facts
                .layouts_with_members_without_layout
                .push(layout_of(layout));
        }
        self.said_types.extend(part.said_types);
        self.said_keys.extend(part.said_keys);
    }

    pub(crate) fn finish(mut self, module: ModuleFragment, state: &mut TaskState) -> Fragment {
        debug_assert_eq!(self.visit, state.visit);
        debug_assert!(
            module
                .body
                .is_none_or(|body| self.function_keys.is_named(body, self.visit))
        );
        debug_assert!(
            module
                .data
                .is_none_or(|data| self.data.iter().any(|&(id, _)| id == data))
        );
        let declared_by_other_parts = take(&mut self.declared_by_other_parts);
        for (id, layout) in &mut self.layouts {
            if !declared_by_other_parts.is_empty()
                && let Some(&(flags, constructor)) = declared_by_other_parts.get(id)
            {
                layout.flags |= flags;
                layout.constructor = layout.constructor.or(constructor);
            }
            let marked_in = &self.marks.layout_written_under_dictionary_type_in;
            if is_marked(marked_in, *id, self.visit) {
                layout.flags |= LayoutFlags::IS_WRITTEN_UNDER_DICTIONARY_TYPE;
            }
        }
        if let Some(count) = self.code_layout_count {
            self.layouts_named_in_file.truncate(count);
        }
        if !self.layouts_named_in_parts.is_empty() {
            self.layouts_named_in_file
                .append(&mut self.layouts_named_in_parts);
            self.layouts_named_in_file.sort_unstable();
            self.layouts_named_in_file.dedup();
        }
        self.layouts_named_in_file.sort_unstable();
        self.allocated_layouts.sort_unstable();
        self.names_of_heirs.sort_unstable();
        self.names_of_heirs.dedup();
        self.written_keys.sort_unstable();
        for key in &self.read_keys {
            self.marks.keys_read[key.index() / 64] = 0;
        }
        self.read_keys.shrink_to_fit();
        self.keys_laid_by_descriptors.sort_unstable();
        self.keys_laid_by_descriptors.dedup();

        let tables = Box::new(UnitTables {
            strings: self.strings,
            property_keys: self.property_keys,
            types: self.types,
            function_keys: take(&mut self.function_keys.keys),
            layout_keys: take(&mut self.layout_keys.keys),
            variable_keys: take(&mut self.variable_keys.keys),
            module_keys: take(&mut self.module_keys.keys),
            module_failure_keys: take(&mut self.module_failure_keys.keys),
            eval_scope_count: self.eval_scope_count,
            data_count: self.data_count,
            expected_result_count: self.expected_result_count,
        });
        let lengths = tables.lengths();
        state.tables.put_back(tables);
        state.finders = KeyFinders {
            functions: self.function_keys,
            layouts: self.layout_keys,
            variables: self.variable_keys,
            modules: self.module_keys,
            module_failures: self.module_failure_keys,
        };
        state.marks = self.marks;

        Fragment {
            file: self.file,
            is_checked: self.is_checked,
            tables: Arc::clone(&state.tables),
            lengths,
            functions: self.functions,
            layouts: self.layouts,
            object_types: self.object_types,
            said_types: self.said_types,
            said_keys: self.said_keys,
            layouts_named_by_code: self.layouts_named_in_file,
            allocated_layouts: self.allocated_layouts,
            names_of_heirs: self.names_of_heirs,
            written_keys: self.written_keys,
            read_keys: self.read_keys,
            keys_laid_by_descriptors: self.keys_laid_by_descriptors,
            variables: self.variables,
            eval_scopes: self.eval_scopes,
            data: self.data,
            expected_results: self.expected_results,
            declared_records: self.declared_records,
            module_instances: self.module_instances,
            module_links: self.module_links,
            supertype_edges: sort_and_dedup(self.supertype_edges),
            function_type_edges: sort_and_dedup(self.function_type_edges),
            builtin_members: Vec::new(),
            family_facts: self.family_facts.finish(),
            runtime_functions: self.runtime_functions,
            module,
        }
    }

    #[cfg(test)]
    pub(crate) fn finish_alone(mut self, module: ModuleFragment) -> Fragment {
        let state = self.own_state.take();
        let mut state = state.expect("`alone` made the builder");
        self.finish(module, &mut state)
    }

    pub(crate) fn abandon(mut self, state: &mut TaskState) {
        let last_visit = state.last_visit.take();
        let (file, lengths) = last_visit.expect("`new` notes the visit");
        debug_assert_eq!(file, self.file);
        self.function_keys.forget_keys_from(lengths.functions);
        self.layout_keys.forget_keys_from(lengths.layouts);
        self.variable_keys.forget_keys_from(lengths.variables);
        self.module_keys.forget_keys_from(lengths.modules);
        self.module_failure_keys
            .forget_keys_from(lengths.module_failures);
        let (mut atoms, mut atom_keys) = (take(&mut state.atoms), take(&mut state.atom_keys));
        for atom in take(&mut self.atoms_first_met) {
            if let Some(string) = atoms.get(&atom)
                && string.to_word() >= lengths.strings
            {
                atoms.remove(&atom);
            }
            if let Some(key) = atom_keys.get(&atom)
                && key.to_word() >= lengths.property_keys
            {
                atom_keys.remove(&atom);
            }
        }
        drop(self.finish(ModuleFragment::default(), state));
        state.roll_back(lengths);
        (state.atoms, state.atom_keys) = (atoms, atom_keys);
    }
}
