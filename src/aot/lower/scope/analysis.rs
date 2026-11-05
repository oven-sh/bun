use core::cmp::Ordering;
use core::ops::Range;

use bun_sema::bind::{CodeUnit, ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{ExprId, FnId, MemberId, StmtId};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;

use super::ScopeSlot;
use crate::ir::generated::FunctionFlags;
use crate::ir::{FunctionKey, VariableKey};
use crate::lower::captures::Capture;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(in crate::lower) enum BindingRef {
    Symbol(SymbolId),
    Slot(ScopeId, ScopeSlot),
}

impl Ord for BindingRef {
    #[inline]
    fn cmp(&self, other: &BindingRef) -> Ordering {
        match (self, other) {
            (BindingRef::Symbol(symbol), BindingRef::Symbol(other)) => symbol.cmp(other),
            _ => self.compare_with_slot(other),
        }
    }
}

impl PartialOrd for BindingRef {
    #[inline]
    fn partial_cmp(&self, other: &BindingRef) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl BindingRef {
    #[inline(never)]
    fn compare_with_slot(&self, other: &BindingRef) -> Ordering {
        match (self, other) {
            (BindingRef::Symbol(symbol), BindingRef::Symbol(other)) => symbol.cmp(other),
            (BindingRef::Symbol(_), BindingRef::Slot(..)) => Ordering::Less,
            (BindingRef::Slot(..), BindingRef::Symbol(_)) => Ordering::Greater,
            (BindingRef::Slot(scope, slot), BindingRef::Slot(other_scope, other_slot)) => {
                scope.cmp(other_scope).then_with(|| slot.cmp(other_slot))
            }
        }
    }

    #[inline]
    pub(in crate::lower) fn is_listed_in(self, symbols: &[SymbolId]) -> bool {
        match self {
            BindingRef::Symbol(symbol) => {
                !symbols.is_empty() && symbols.binary_search(&symbol).is_ok()
            }
            BindingRef::Slot(..) => false,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum BindingForm {
    NotAValue,
    Import,
    Callee { function: FnId },
    MappedArgument { unit: CodeUnit, index: u32 },
    ContainerMember { container: SymbolId },
    Stored,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum Storage {
    Local,
    Field { scope: ScopeId, field: u32 },
    Variable(VariableKey),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) struct Placement {
    pub(in crate::lower) storage: Storage,
    pub(in crate::lower) has_local: bool,
    pub(in crate::lower) is_immutable: bool,
    pub(in crate::lower) is_shared: bool,
}

impl Placement {
    pub(in crate::lower) const LOCAL: Placement = Placement {
        storage: Storage::Local,
        has_local: true,
        is_immutable: false,
        is_shared: false,
    };
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum ArgumentsObject {
    None,
    Unmapped,
    Mapped,
}

pub(super) struct ArgumentsObjects {
    pub(super) file: ArgumentsObject,
    pub(super) functions: Vec<ArgumentsObject>,
    pub(super) fields: Vec<MemberId>,
}

impl ArgumentsObjects {
    pub(super) fn get(&self, unit: CodeUnit) -> ArgumentsObject {
        match unit {
            CodeUnit::File => self.file,
            CodeUnit::Function(function) => {
                let object = self.functions.get(function.idx());
                object.copied().unwrap_or(ArgumentsObject::None)
            }
            CodeUnit::FieldInitializer(member) => match self.fields.binary_search(&member) {
                Ok(_) => ArgumentsObject::Unmapped,
                Err(_) => ArgumentsObject::None,
            },
        }
    }
}

pub(super) type SlotKey = (ScopeId, ScopeSlot);

pub(super) struct GroupedList<T> {
    starts: Vec<u32>,
    items: Vec<T>,
}

impl<T: Copy> GroupedList<T> {
    pub(super) fn new(group_count: usize, entries: &[(usize, T)]) -> GroupedList<T> {
        if entries.is_empty() {
            return GroupedList {
                starts: Vec::new(),
                items: Vec::new(),
            };
        }
        let mut starts = vec![0; group_count + 1];
        for &(group, _) in entries {
            starts[group + 1] += 1;
        }
        let mut total = 0;
        for start in &mut starts {
            total += *start;
            *start = total;
        }
        let mut items: Vec<T> = entries.iter().map(|entry| entry.1).collect();
        for &(group, item) in entries {
            items[starts[group] as usize] = item;
            starts[group] += 1;
        }
        starts.copy_within(..group_count, 1);
        starts[0] = 0;
        GroupedList { starts, items }
    }

    #[inline]
    pub(super) fn get(&self, group: usize) -> &[T] {
        match self.starts.get(group..group + 2) {
            Some(&[start, end]) => &self.items[start as usize..end as usize],
            _ => &[],
        }
    }
}

pub(super) struct FunctionSummary {
    pub(super) key: FunctionKey,
    pub(super) entry_flags: FunctionFlags,
    pub(super) undeclared_parameters: u32,
    pub(super) captures: Range<u32>,
}

pub(super) struct LoopStores {
    pub(super) statements: Vec<StmtId>,
    pub(super) stored: GroupedList<BindingRef>,
}

pub(super) struct StoresUnderHandlers {
    pub(super) statements: Vec<StmtId>,
    pub(super) stored: GroupedList<BindingRef>,
}

pub(crate) struct ScopeAnalysis {
    pub(super) file: FileId,
    pub(super) max_captures: usize,
    pub(super) forms: Vec<BindingForm>,
    pub(super) use_counts: Vec<u8>,
    pub(super) calls_by_name: Vec<(ExprId, FnId)>,
    pub(super) made_at_first_read: Vec<(SymbolId, FnId)>,
    pub(super) created_at_each_read: Vec<SymbolId>,
    pub(super) functions_created_before_loops: Vec<(StmtId, SymbolId)>,
    pub(super) names_called: Vec<SymbolId>,
    pub(super) symbol_placements: Vec<Placement>,
    pub(super) slot_placements: Vec<(SlotKey, Placement)>,
    pub(super) lexical_owners: Vec<ScopeId>,
    pub(super) bindings: GroupedList<BindingRef>,
    pub(super) environment_fields: GroupedList<BindingRef>,
    pub(super) hoisted_functions: GroupedList<(SymbolId, FnId)>,
    pub(super) initial_functions: Vec<(SymbolId, FnId)>,
    pub(super) switch_scopes: Vec<ScopeId>,
    pub(super) functions: Vec<FunctionSummary>,
    pub(super) summaries_of_source_functions: Vec<u32>,
    pub(super) captures: Vec<Capture>,
    pub(super) arguments_objects: ArgumentsObjects,
    pub(super) loops: LoopStores,
    pub(super) tries: StoresUnderHandlers,
    pub(super) field_initializers: Vec<(MemberId, FunctionKey)>,
    pub(super) initialized_holders: Vec<(FunctionKey, SymbolId)>,
    pub(super) registries: Vec<(ScopeId, BindingRef)>,
    pub(super) has_wrapper_parameters: bool,
}

pub(super) fn find_by_key<K: Copy + Ord, V: Copy>(list: &[(K, V)], key: K) -> Option<V> {
    let index = list.binary_search_by_key(&key, |entry| entry.0).ok()?;
    Some(list[index].1)
}

#[inline]
pub(super) fn sort_unique<T: Ord>(list: &mut Vec<T>) {
    if list.len() > 1 {
        sort_unique_of_several(list);
    }
}

fn sort_unique_of_several<T: Ord>(list: &mut Vec<T>) {
    list.sort_unstable();
    list.dedup();
}

pub(super) fn shared_sort_unique<T: Ord>(list: &mut Vec<T>) {
    if list.len() > 1 {
        list.shared_sort_unstable();
        list.dedup();
    }
}

impl ScopeAnalysis {
    #[inline]
    pub(in crate::lower) fn form(&self, symbol: SymbolId) -> BindingForm {
        let form = self.forms.get(symbol.idx());
        form.copied().unwrap_or(BindingForm::NotAValue)
    }

    pub(in crate::lower) fn is_named_once(&self, symbol: SymbolId) -> bool {
        self.use_counts.get(symbol.idx()) == Some(&1)
            && self.names_called.binary_search(&symbol).is_err()
    }

    pub(in crate::lower) fn is_never_named(&self, symbol: SymbolId) -> bool {
        self.use_counts.get(symbol.idx()) == Some(&0)
    }

    /// The function that the name is declared as, where its function object is made by whoever reads the name first.
    pub(in crate::lower) fn is_created_at_each_read(&self, symbol: SymbolId) -> bool {
        self.created_at_each_read.binary_search(&symbol).is_ok()
    }

    #[inline]
    pub(in crate::lower) fn function_made_at_first_read(&self, symbol: SymbolId) -> Option<FnId> {
        if self.made_at_first_read.is_empty() {
            return None;
        }
        find_by_key(&self.made_at_first_read, symbol)
    }

    pub(in crate::lower) fn functions_created_before_loop(
        &self,
        statement: StmtId,
    ) -> &[(StmtId, SymbolId)] {
        let functions = &self.functions_created_before_loops;
        let first = functions.partition_point(|entry| entry.0 < statement);
        let end = functions.partition_point(|entry| entry.0 <= statement);
        &functions[first..end]
    }

    pub(in crate::lower) fn function_called_by_name(&self, call: ExprId) -> Option<FnId> {
        let calls = &self.calls_by_name;
        let index = calls.binary_search_by_key(&call, |&(call, _)| call).ok()?;
        Some(calls[index].1)
    }

    #[inline]
    pub(in crate::lower) fn placement(&self, binding: BindingRef) -> Option<Placement> {
        match binding {
            BindingRef::Symbol(symbol) => match self.forms.get(symbol.idx()) {
                Some(BindingForm::Stored) => Some(self.symbol_placements[symbol.idx()]),
                _ => None,
            },
            BindingRef::Slot(scope, slot) => find_by_key(&self.slot_placements, (scope, slot)),
        }
    }

    #[inline]
    pub(in crate::lower) fn bindings(&self, scope: ScopeId) -> &[BindingRef] {
        self.bindings.get(scope.idx())
    }

    #[inline]
    pub(in crate::lower) fn environment_fields(&self, scope: ScopeId) -> &[BindingRef] {
        self.environment_fields.get(scope.idx())
    }

    #[inline]
    pub(in crate::lower) fn has_environment(&self, scope: ScopeId) -> bool {
        !self.environment_fields(scope).is_empty()
    }

    #[inline]
    pub(in crate::lower) fn hoisted_functions(&self, scope: ScopeId) -> &[(SymbolId, FnId)] {
        self.hoisted_functions.get(scope.idx())
    }

    pub(in crate::lower) fn initial_function(&self, symbol: SymbolId) -> Option<FnId> {
        find_by_key(&self.initial_functions, symbol)
    }

    #[inline]
    pub(in crate::lower) fn is_switch_scope(&self, scope: ScopeId) -> bool {
        !self.switch_scopes.is_empty() && self.switch_scopes.binary_search(&scope).is_ok()
    }

    pub(in crate::lower) fn captures(&self, key: FunctionKey) -> &[Capture] {
        match self.find_function(key) {
            Some(function) => {
                &self.captures[function.captures.start as usize..function.captures.end as usize]
            }
            None => &[],
        }
    }

    pub(in crate::lower) fn packed_captures(&self, key: FunctionKey) -> Option<u32> {
        let captures = &self.find_function(key)?.captures;
        (captures.len() > self.max_captures).then_some(captures.start)
    }

    pub(in crate::lower) fn entry_flags(&self, key: FunctionKey) -> FunctionFlags {
        let function = self.find_function(key);
        function.map_or_else(FunctionFlags::default, |function| function.entry_flags)
    }

    pub(in crate::lower) fn undeclared_parameters(&self, key: FunctionKey) -> u32 {
        let function = self.find_function(key);
        function.map_or(0, |function| function.undeclared_parameters)
    }

    pub(in crate::lower) fn is_initialized_holder(
        &self,
        function: FunctionKey,
        symbol: SymbolId,
    ) -> bool {
        let holders = &self.initialized_holders;
        holders.binary_search(&(function, symbol)).is_ok()
    }

    pub(in crate::lower) fn list_registries(&self) -> &[(ScopeId, BindingRef)] {
        &self.registries
    }

    #[inline]
    pub(in crate::lower) fn has_wrapper_parameters(&self) -> bool {
        self.has_wrapper_parameters
    }

    pub(in crate::lower) fn arguments_object(&self, unit: CodeUnit) -> ArgumentsObject {
        self.arguments_objects.get(unit)
    }

    pub(in crate::lower) fn stored_in_loop(&self, statement: StmtId) -> &[BindingRef] {
        let index = self.loops.statements.binary_search(&statement);
        let index = index.expect("the scope walk records every live loop");
        self.loops.stored.get(index)
    }

    pub(in crate::lower) fn stored_under_handlers(&self, statement: StmtId) -> &[BindingRef] {
        match self.tries.statements.binary_search(&statement) {
            Ok(index) => self.tries.stored.get(index),
            Err(_) => &[],
        }
    }

    pub(in crate::lower) fn lexical_owner(&self, scope: ScopeId) -> ScopeId {
        let owner = self.lexical_owners.get(scope.idx());
        owner.copied().unwrap_or(scope)
    }

    pub(in crate::lower) fn function_key(&self, unit: CodeUnit) -> FunctionKey {
        let file = self.file;
        match unit {
            CodeUnit::File => FunctionKey::ModuleBody(file),
            CodeUnit::Function(function) => FunctionKey::Source(FunctionRef { file, function }),
            CodeUnit::FieldInitializer(member) => {
                let initializer = find_by_key(&self.field_initializers, member);
                initializer.expect("the member is a class field with an initializer")
            }
        }
    }

    #[inline]
    fn find_function(&self, key: FunctionKey) -> Option<&FunctionSummary> {
        match key {
            FunctionKey::Source(source) if source.file == self.file => {
                let summaries = &self.summaries_of_source_functions;
                let index = *summaries.get(source.function.idx())?;
                self.functions.get(index as usize)
            }
            _ => match self.functions.first() {
                Some(first) if first.key == key => Some(first),
                _ => self.find_function_by_key(key),
            },
        }
    }

    fn find_function_by_key(&self, key: FunctionKey) -> Option<&FunctionSummary> {
        let functions = &self.functions;
        let index = functions.binary_search_by_key(&key, |function| function.key);
        index.ok().map(|index| &functions[index])
    }
}
