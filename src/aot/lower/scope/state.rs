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
    pub(super) entered: Vec<EnteredScope>,
    pub(in crate::lower) locals: FxHashMap<BindingRef, LocalBinding>,
    pub(in crate::lower) entry_this: Option<ValueId>,
    /// The captures of a function that gets them in one object, read out of it at entry.
    pub(in crate::lower) unpacked_captures: Vec<ValueId>,
}

impl ScopeState {
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

    pub(super) fn end_dead_zone(&mut self, binding: BindingRef) {
        if let Some(local) = self.locals.get_mut(&binding)
            && local.dead_zone == DeadZone::Uninitialized
        {
            local.dead_zone = DeadZone::Initialized;
        }
    }
}
