use core::ops::Range;

use bun_sema::bind::{CodeUnit, ScopeId, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{FnId, MemberId, StmtId};
use bun_sema::program::FileId;

use super::ScopeSlot;
use crate::ir::generated::FunctionFlags;
use crate::ir::{FunctionKey, VariableKey};
use crate::lower::captures::Capture;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(in crate::lower) enum BindingRef {
    Symbol(SymbolId),
    Slot(ScopeId, ScopeSlot),
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
}

impl ArgumentsObjects {
    pub(super) fn get(&self, unit: CodeUnit) -> ArgumentsObject {
        match unit {
            CodeUnit::File => self.file,
            CodeUnit::Function(function) => {
                let object = self.functions.get(function.idx());
                object.copied().unwrap_or(ArgumentsObject::None)
            }
            CodeUnit::FieldInitializer(_) => ArgumentsObject::None,
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
        let mut next = starts.clone();
        for &(group, item) in entries {
            items[next[group] as usize] = item;
            next[group] += 1;
        }
        GroupedList { starts, items }
    }

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
    pub(super) has_too_many_captures: bool,
}

pub(super) struct LoopStores {
    pub(super) statements: Vec<StmtId>,
    pub(super) stored: GroupedList<BindingRef>,
}

pub(crate) struct ScopeAnalysis {
    pub(super) file: FileId,
    pub(super) max_captures: usize,
    pub(super) forms: Vec<BindingForm>,
    pub(super) symbol_placements: Vec<Placement>,
    pub(super) slot_placements: Vec<(SlotKey, Placement)>,
    pub(super) lexical_owners: Vec<ScopeId>,
    pub(super) bindings: GroupedList<BindingRef>,
    pub(super) environment_fields: GroupedList<BindingRef>,
    pub(super) hoisted_functions: GroupedList<(SymbolId, FnId)>,
    pub(super) initial_functions: Vec<(SymbolId, FnId)>,
    pub(super) switch_scopes: Vec<ScopeId>,
    pub(super) functions: Vec<FunctionSummary>,
    pub(super) captures: Vec<Capture>,
    pub(super) arguments_objects: ArgumentsObjects,
    pub(super) loops: LoopStores,
    pub(super) field_initializers: Vec<(MemberId, FunctionKey)>,
    pub(super) initialized_holders: Vec<(FunctionKey, SymbolId)>,
    pub(super) has_wrapper_parameters: bool,
}

pub(super) fn find_by_key<K: Copy + Ord, V: Copy>(list: &[(K, V)], key: K) -> Option<V> {
    let index = list.binary_search_by_key(&key, |entry| entry.0).ok()?;
    Some(list[index].1)
}

pub(super) fn sort_unique<T: Ord>(list: &mut Vec<T>) {
    list.sort_unstable();
    list.dedup();
}

impl ScopeAnalysis {
    pub(in crate::lower) fn form(&self, symbol: SymbolId) -> BindingForm {
        let form = self.forms.get(symbol.idx());
        form.copied().unwrap_or(BindingForm::NotAValue)
    }

    pub(in crate::lower) fn placement(&self, binding: BindingRef) -> Option<Placement> {
        match binding {
            BindingRef::Symbol(symbol) => match self.form(symbol) {
                BindingForm::Stored => Some(self.symbol_placements[symbol.idx()]),
                _ => None,
            },
            BindingRef::Slot(scope, slot) => find_by_key(&self.slot_placements, (scope, slot)),
        }
    }

    pub(in crate::lower) fn bindings(&self, scope: ScopeId) -> &[BindingRef] {
        self.bindings.get(scope.idx())
    }

    pub(in crate::lower) fn environment_fields(&self, scope: ScopeId) -> &[BindingRef] {
        self.environment_fields.get(scope.idx())
    }

    pub(in crate::lower) fn has_environment(&self, scope: ScopeId) -> bool {
        !self.environment_fields(scope).is_empty()
    }

    pub(in crate::lower) fn hoisted_functions(&self, scope: ScopeId) -> &[(SymbolId, FnId)] {
        self.hoisted_functions.get(scope.idx())
    }

    pub(in crate::lower) fn initial_function(&self, symbol: SymbolId) -> Option<FnId> {
        find_by_key(&self.initial_functions, symbol)
    }

    pub(in crate::lower) fn is_switch_scope(&self, scope: ScopeId) -> bool {
        self.switch_scopes.binary_search(&scope).is_ok()
    }

    pub(in crate::lower) fn captures(&self, key: FunctionKey) -> &[Capture] {
        match self.find_function(key) {
            Some(function) => {
                &self.captures[function.captures.start as usize..function.captures.end as usize]
            }
            None => &[],
        }
    }

    /// `Some`: the function has more captures than a closure has room for, also with an environment for each scope that it reaches.
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

    pub(in crate::lower) fn has_too_many_captures(&self, key: FunctionKey) -> bool {
        let function = self.find_function(key);
        function.is_some_and(|function| function.has_too_many_captures)
    }

    /// The name holds a required module that is only read by members, so it holds no value, and every run of the function comes behind its initialization.
    pub(in crate::lower) fn is_initialized_holder(
        &self,
        function: FunctionKey,
        symbol: SymbolId,
    ) -> bool {
        let holders = &self.initialized_holders;
        holders.binary_search(&(function, symbol)).is_ok()
    }

    /// The text of the file is a function of `this` and the five names of a CommonJS module, with an `arguments` object.
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

    fn find_function(&self, key: FunctionKey) -> Option<&FunctionSummary> {
        let functions = &self.functions;
        let index = functions.binary_search_by_key(&key, |function| function.key);
        index.ok().map(|index| &functions[index])
    }
}
