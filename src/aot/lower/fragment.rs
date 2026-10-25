#[cfg(test)]
mod tests;

use core::hash::Hash;
use std::collections::hash_map::Entry;
use std::sync::Arc;

use bun_sema::program::FileId;
use rustc_hash::FxHashMap;

use super::convert::FamilyFacts;
use super::layouts::ObjectTypeKey;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Data, EvalScope, ExpectedResult, Function, Layout, LayoutFlags, RuntimeFunctionEntry,
    SourcePositions, TypeSite, Variable,
};
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, FunctionKey, Id, LayoutId, LayoutKey,
    ModuleFailureId, ModuleId, PropertyKeyId, PropertyKeyTable, Reference, StringTable, TypeSiteId,
    TypeTable, VariableId, VariableKey,
};
use crate::modules::{self, ModuleRef};

#[derive(Default)]
pub struct ModuleFragment {
    pub body: Option<FunctionId>,
    pub data: Option<DataId>,
    pub positions: SourcePositions,
    pub function_text: Vec<u8>,
}

pub struct Fragment {
    pub file: FileId,
    pub is_checked: bool,
    pub strings: StringTable,
    pub property_keys: PropertyKeyTable,
    pub types: TypeTable,
    pub function_keys: Vec<FunctionKey>,
    pub layout_keys: Vec<LayoutKey>,
    pub code_layout_count: usize,
    pub variable_keys: Vec<VariableKey>,
    pub module_keys: Vec<ModuleRef>,
    pub module_failure_keys: Vec<modules::ModuleFailureId>,
    pub functions: Vec<(FunctionId, Arc<Function>)>,
    pub layouts: Vec<(LayoutId, Layout)>,
    /// By index in `layouts`, ascending: the type that a definition of a plain layout speaks of.
    pub object_types: Vec<(u32, ObjectTypeKey)>,
    /// For each of `object_types`: how far the type is from the code of the file.
    pub object_type_levels: Vec<u8>,
    /// The layouts with which the code or the data of the file makes an object, ascending.
    pub allocated_layouts: Vec<LayoutId>,
    /// The keys under which the code or the data of the file puts a property into an object, ascending.
    pub written_keys: Vec<PropertyKeyId>,
    pub variables: Vec<(VariableId, Variable)>,
    pub type_sites: Vec<TypeSite>,
    pub expected_results: Vec<ExpectedResult>,
    pub eval_scopes: Vec<EvalScope>,
    pub data: Vec<Data>,
    pub supertype_edges: Vec<(LayoutId, LayoutId)>,
    pub function_type_edges: Vec<(FunctionId, FunctionId)>,
    pub builtin_members: Vec<(FunctionId, BuiltinId)>,
    pub(crate) family_facts: FamilyFacts,
    pub runtime_functions: Vec<RuntimeFunctionEntry>,
    pub module: ModuleFragment,
}

struct KeyTable<K> {
    ids: FxHashMap<K, u32>,
    keys: Vec<K>,
    is_defined: Vec<bool>,
}

impl<K: Copy + Eq + Hash> KeyTable<K> {
    fn new() -> KeyTable<K> {
        KeyTable {
            ids: FxHashMap::default(),
            keys: Vec::new(),
            is_defined: Vec::new(),
        }
    }

    fn declare<I: Id>(&mut self, key: K) -> I {
        match self.ids.entry(key) {
            Entry::Occupied(entry) => I::new(*entry.get() as usize),
            Entry::Vacant(entry) => {
                let id = I::new(self.keys.len());
                entry.insert(id.to_word());
                self.keys.push(key);
                self.is_defined.push(false);
                id
            }
        }
    }

    fn is_declared(&self, id: impl Id) -> bool {
        id.index() < self.keys.len()
    }

    fn key_of(&self, id: impl Id) -> K {
        self.keys[id.index()]
    }

    fn is_defined(&self, id: impl Id) -> bool {
        self.is_defined[id.index()]
    }

    fn mark_defined(&mut self, id: impl Id) {
        let was_defined = core::mem::replace(&mut self.is_defined[id.index()], true);
        debug_assert!(!was_defined, "a fragment defines a key once");
    }
}

fn set_mark(marks: &mut Vec<bool>, id: impl Id) {
    if marks.len() <= id.index() {
        marks.resize(id.index() + 1, false);
    }
    marks[id.index()] = true;
}

fn collect_marked<I: Id>(marks: &[bool]) -> Vec<I> {
    let marked = marks
        .iter()
        .enumerate()
        .filter(|&(_, &is_marked)| is_marked);
    marked.map(|(index, _)| I::new(index)).collect()
}

fn add_record<I: Id, R>(records: &mut Vec<R>, record: R) -> I {
    let id = I::new(records.len());
    records.push(record);
    id
}

fn sort_and_dedup<T: Ord>(mut list: Vec<T>) -> Vec<T> {
    list.sort_unstable();
    list.dedup();
    list
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
    function_keys: KeyTable<FunctionKey>,
    layout_keys: KeyTable<LayoutKey>,
    code_layout_count: Option<usize>,
    variable_keys: KeyTable<VariableKey>,
    module_keys: KeyTable<ModuleRef>,
    module_failure_keys: KeyTable<modules::ModuleFailureId>,
    functions: Vec<(FunctionId, Arc<Function>)>,
    layouts: Vec<(LayoutId, Layout)>,
    object_types: Vec<(u32, ObjectTypeKey)>,
    object_type_levels: Vec<u8>,
    is_layout_allocated: Vec<bool>,
    is_layout_written_under_dictionary_type: Vec<bool>,
    is_key_written: Vec<bool>,
    variables: Vec<(VariableId, Variable)>,
    type_sites: Vec<TypeSite>,
    expected_results: Vec<ExpectedResult>,
    eval_scopes: Vec<EvalScope>,
    data: Vec<Data>,
    supertype_edges: Vec<(LayoutId, LayoutId)>,
    function_type_edges: Vec<(FunctionId, FunctionId)>,
    builtin_members: Vec<(FunctionId, BuiltinId)>,
    runtime_functions: Vec<RuntimeFunctionEntry>,
}

impl FragmentBuilder {
    pub(crate) fn new(file: FileId) -> FragmentBuilder {
        FragmentBuilder {
            strings: StringTable::default(),
            property_keys: PropertyKeyTable::default(),
            types: TypeTable::new(),
            family_facts: FamilyFacts::default(),
            is_checked: false,
            file,
            function_keys: KeyTable::new(),
            layout_keys: KeyTable::new(),
            code_layout_count: None,
            variable_keys: KeyTable::new(),
            module_keys: KeyTable::new(),
            module_failure_keys: KeyTable::new(),
            functions: Vec::new(),
            layouts: Vec::new(),
            object_types: Vec::new(),
            object_type_levels: Vec::new(),
            is_layout_allocated: Vec::new(),
            is_layout_written_under_dictionary_type: Vec::new(),
            is_key_written: Vec::new(),
            variables: Vec::new(),
            type_sites: Vec::new(),
            expected_results: Vec::new(),
            eval_scopes: Vec::new(),
            data: Vec::new(),
            supertype_edges: Vec::new(),
            function_type_edges: Vec::new(),
            builtin_members: Vec::new(),
            runtime_functions: Vec::new(),
        }
    }

    pub(crate) fn declare_function(&mut self, key: FunctionKey) -> FunctionId {
        self.function_keys.declare(key)
    }

    pub(crate) fn declare_layout(&mut self, key: LayoutKey) -> LayoutId {
        self.layout_keys.declare(key)
    }

    pub(crate) fn declare_variable(&mut self, key: VariableKey) -> VariableId {
        self.variable_keys.declare(key)
    }

    pub(crate) fn declare_module(&mut self, module: ModuleRef) -> ModuleId {
        self.module_keys.declare(module)
    }

    pub(crate) fn module_ref(&self, module: ModuleId) -> ModuleRef {
        self.module_keys.key_of(module)
    }

    pub(crate) fn declare_module_failure(
        &mut self,
        failure: modules::ModuleFailureId,
    ) -> ModuleFailureId {
        self.module_failure_keys.declare(failure)
    }

    pub(crate) fn function_key(&self, function: FunctionId) -> FunctionKey {
        self.function_keys.key_of(function)
    }

    #[cfg(test)]
    pub(crate) fn function_keys(&self) -> &[FunctionKey] {
        &self.function_keys.keys
    }

    pub(crate) fn layout_key(&self, layout: LayoutId) -> LayoutKey {
        self.layout_keys.key_of(layout)
    }

    pub(crate) fn layout_keys(&self) -> &[LayoutKey] {
        &self.layout_keys.keys
    }

    pub(crate) fn end_layouts_of_code(&mut self) -> usize {
        debug_assert!(self.code_layout_count.is_none());
        let count = self.layout_keys.keys.len();
        self.code_layout_count = Some(count);
        count
    }

    pub(crate) fn is_layout_defined(&self, layout: LayoutId) -> bool {
        self.layout_keys.is_defined(layout)
    }

    pub(crate) fn is_variable_defined(&self, variable: VariableId) -> bool {
        self.variable_keys.is_defined(variable)
    }

    pub(crate) fn define_function(&mut self, id: FunctionId, function: impl Into<Arc<Function>>) {
        let function = function.into();
        debug_assert!(
            is_function_type(self.function_key(id))
                || self.function_key(id).home_file() == self.file
        );
        debug_assert!(
            function.function_types.is_empty(),
            "function types are edges until link"
        );
        self.function_keys.mark_defined(id);
        self.functions.push((id, function));
    }

    pub(crate) fn define_layout(&mut self, id: LayoutId, layout: Layout) {
        debug_assert!(
            layout.supertypes.is_empty(),
            "supertypes are edges until link"
        );
        self.layout_keys.mark_defined(id);
        self.layouts.push((id, layout));
    }

    // A plain layout has a definition for each type that has it. `ty`: the type and its level.
    pub(crate) fn define_object_type(
        &mut self,
        id: LayoutId,
        layout: Layout,
        ty: Option<(ObjectTypeKey, u8)>,
    ) {
        debug_assert!(matches!(self.layout_key(id), LayoutKey::ObjectType { .. }));
        self.layout_keys.is_defined[id.index()] = true;
        if let Some((ty, level)) = ty {
            self.object_types.push((self.layouts.len() as u32, ty));
            self.object_type_levels.push(level);
        }
        self.layouts.push((id, layout));
    }

    pub(crate) fn define_variable(&mut self, id: VariableId, variable: Variable) {
        self.variable_keys.mark_defined(id);
        self.variables.push((id, variable));
    }

    pub(crate) fn add_type_site(&mut self, site: TypeSite) -> TypeSiteId {
        add_record(&mut self.type_sites, site)
    }

    pub(crate) fn type_site(&self, id: TypeSiteId) -> TypeSite {
        self.type_sites[id.index()]
    }

    pub(crate) fn is_allocated(&self, layout: LayoutId) -> bool {
        self.is_layout_allocated
            .get(layout.index())
            .is_some_and(|&is_marked| is_marked)
    }

    pub(crate) fn note_allocation(&mut self, layout: LayoutId) {
        set_mark(&mut self.is_layout_allocated, layout);
    }

    pub(crate) fn note_literal_under_dictionary_type(&mut self, layout: LayoutId) {
        set_mark(&mut self.is_layout_written_under_dictionary_type, layout);
    }

    pub(crate) fn note_write(&mut self, key: PropertyKeyId) {
        set_mark(&mut self.is_key_written, key);
    }

    // Whoever builds what the record describes makes objects with its layouts and puts its keys into them.
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

    pub(crate) fn add_expected_result(&mut self, expected: ExpectedResult) -> ExpectedResultId {
        expected.for_each_reference(&mut |reference| self.note_what_is_built(reference));
        add_record(&mut self.expected_results, expected)
    }

    // What a call is declared to answer where nothing of the compiler's builds the answer.
    pub(crate) fn add_described_result(&mut self, expected: ExpectedResult) -> ExpectedResultId {
        add_record(&mut self.expected_results, expected)
    }

    pub(crate) fn add_eval_scope(&mut self, scope: EvalScope) -> EvalScopeId {
        add_record(&mut self.eval_scopes, scope)
    }

    pub(crate) fn add_data(&mut self, data: Data) -> DataId {
        data.for_each_reference(&mut |reference| self.note_what_is_built(reference));
        add_record(&mut self.data, data)
    }

    pub(crate) fn supertype_edges(&self) -> &[(LayoutId, LayoutId)] {
        &self.supertype_edges
    }

    pub(crate) fn add_supertype(&mut self, layout: LayoutId, supertype: LayoutId) {
        debug_assert!(self.layout_keys.is_declared(layout));
        debug_assert!(self.layout_keys.is_declared(supertype));
        if layout != supertype {
            self.supertype_edges.push((layout, supertype));
        }
    }

    pub(crate) fn add_function_type_edge(&mut self, source: FunctionId, target: FunctionId) {
        debug_assert!(self.function_keys.is_declared(source));
        debug_assert!(is_function_type(self.function_key(target)));
        if source != target {
            self.function_type_edges.push((source, target));
        }
    }

    pub(crate) fn add_builtin_member(&mut self, function_type: FunctionId, builtin: BuiltinId) {
        debug_assert!(is_function_type(self.function_key(function_type)));
        self.builtin_members.push((function_type, builtin));
    }

    pub(crate) fn add_runtime_function(&mut self, entry: RuntimeFunctionEntry) {
        debug_assert!(self.function_keys.is_declared(entry.function));
        self.runtime_functions.push(entry);
    }

    pub(crate) fn finish(mut self, module: ModuleFragment) -> Fragment {
        debug_assert!(
            module
                .body
                .is_none_or(|body| self.function_keys.is_declared(body))
        );
        for (id, layout) in &mut self.layouts {
            let marks = &self.is_layout_written_under_dictionary_type;
            if marks.get(id.index()).is_some_and(|&is_marked| is_marked) {
                layout.flags |= LayoutFlags::IS_WRITTEN_UNDER_DICTIONARY_TYPE;
            }
        }
        debug_assert!(
            module
                .data
                .is_none_or(|data| data.index() < self.data.len())
        );
        Fragment {
            file: self.file,
            is_checked: self.is_checked,
            strings: self.strings,
            property_keys: self.property_keys,
            types: self.types,
            function_keys: self.function_keys.keys,
            code_layout_count: self
                .code_layout_count
                .unwrap_or(self.layout_keys.keys.len()),
            layout_keys: self.layout_keys.keys,
            variable_keys: self.variable_keys.keys,
            module_keys: self.module_keys.keys,
            module_failure_keys: self.module_failure_keys.keys,
            functions: self.functions,
            layouts: self.layouts,
            object_types: self.object_types,
            object_type_levels: self.object_type_levels,
            allocated_layouts: collect_marked(&self.is_layout_allocated),
            written_keys: collect_marked(&self.is_key_written),
            variables: self.variables,
            type_sites: self.type_sites,
            expected_results: self.expected_results,
            eval_scopes: self.eval_scopes,
            data: self.data,
            supertype_edges: sort_and_dedup(self.supertype_edges),
            function_type_edges: sort_and_dedup(self.function_type_edges),
            builtin_members: sort_and_dedup(self.builtin_members),
            family_facts: self.family_facts.finish(),
            runtime_functions: self.runtime_functions,
            module,
        }
    }
}
