use bun_sema::bind::{ScopeId, SymbolId};
use bun_sema::hir::{IdList, StmtId};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::BindingRef;
use crate::ir::{LayoutId, LocalVariable, Place, ValueId};

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

/// The cell of a scope that nothing has asked for yet.
pub(super) struct EnvironmentPutOff {
    pub(super) scope: ScopeId,
    /// How many scopes were entered when this one was.
    pub(super) depth: usize,
    pub(super) variable: LocalVariable,
    pub(super) layout: LayoutId,
    pub(super) fields: SmallVec<[u32; 8]>,
    pub(super) values: SmallVec<[ValueId; 8]>,
    /// The entry of the scope, then the start of each statement of `list` in its turn.
    pub(super) place: Place,
    /// The statements that are all there is of the scope from its entry on: the body of the function, the block.
    pub(super) list: IdList<StmtId>,
}

#[derive(Default)]
pub(crate) struct ScopeState {
    pub(super) entered: Vec<EnteredScope>,
    pub(super) environments_put_off: Vec<EnvironmentPutOff>,
    pub(in crate::lower) locals: FxHashMap<BindingRef, LocalBinding>,
    pub(in crate::lower) entry_this: Option<ValueId>,
    /// The captures of a function that gets them in one object, read out of it at entry.
    pub(in crate::lower) unpacked_captures: Vec<ValueId>,
    /// By declared function that is created at its first read: a value of its local that is known to be the closure.
    pub(super) created_functions: FxHashMap<SymbolId, ValueId>,
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
