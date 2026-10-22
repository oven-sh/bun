use bun_sema::bind::ScopeId;
use rustc_hash::FxHashMap;

use super::BindingRef;
use crate::ir::{LocalVariable, ValueId};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum DeadZone {
    Never,
    Uninitialized,
    Initialized,
    DecidedAtRunTime,
}

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct LocalBinding {
    pub(in crate::lower) variable: LocalVariable,
    pub(in crate::lower) dead_zone: DeadZone,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct EnteredScope {
    pub(super) scope: ScopeId,
    pub(super) environment: Option<LocalVariable>,
}

#[derive(Default)]
pub(crate) struct ScopeState {
    entered: Vec<EnteredScope>,
    locals: FxHashMap<BindingRef, LocalBinding>,
    entry_this: Option<ValueId>,
    /// The captures of a function that gets them in one object, read out of it at entry.
    unpacked_captures: Vec<ValueId>,
}

impl ScopeState {
    pub(super) fn push_scope(&mut self, entered: EnteredScope) {
        self.entered.push(entered);
    }

    pub(super) fn pop_scope(&mut self) -> Option<EnteredScope> {
        self.entered.pop()
    }

    pub(super) fn innermost_scope(&self) -> ScopeId {
        let innermost = self.entered.last();
        innermost.map_or(ScopeId::NONE, |entered| entered.scope)
    }

    pub(super) fn find_environment(&self, scope: ScopeId) -> Option<LocalVariable> {
        let mut entered = self.entered.iter().rev();
        entered.find(|entered| entered.scope == scope)?.environment
    }

    pub(in crate::lower) fn find_local(&self, binding: BindingRef) -> Option<LocalBinding> {
        self.locals.get(&binding).copied()
    }

    pub(in crate::lower) fn declare_local(&mut self, binding: BindingRef, local: LocalBinding) {
        self.locals.insert(binding, local);
    }

    pub(super) fn end_dead_zone(&mut self, binding: BindingRef) {
        if let Some(local) = self.locals.get_mut(&binding)
            && local.dead_zone == DeadZone::Uninitialized
        {
            local.dead_zone = DeadZone::Initialized;
        }
    }

    pub(in crate::lower) fn unpacked_captures(&self) -> &[ValueId] {
        &self.unpacked_captures
    }

    pub(in crate::lower) fn set_unpacked_captures(&mut self, values: Vec<ValueId>) {
        self.unpacked_captures = values;
    }

    pub(in crate::lower) fn entry_this(&self) -> Option<ValueId> {
        self.entry_this
    }

    pub(in crate::lower) fn set_entry_this(&mut self, value: ValueId) {
        self.entry_this = Some(value);
    }
}
