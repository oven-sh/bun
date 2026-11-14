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

pub(super) struct EnvironmentPutOff {
    pub(super) scope: ScopeId,
    pub(super) depth: usize,
    pub(super) variable: LocalVariable,
    pub(super) layout: LayoutId,
    pub(super) fields: SmallVec<[u32; 8]>,
    pub(super) values: SmallVec<[ValueId; 8]>,
    pub(super) place: Place,
    pub(super) list: IdList<StmtId>,
}

#[derive(Default)]
pub(in crate::lower) struct Locals {
    symbols: Vec<Option<(SymbolId, LocalBinding)>>,
    symbol_count: usize,
    slots: FxHashMap<BindingRef, LocalBinding>,
}

impl Locals {
    #[inline]
    fn place_of(&self, symbol: SymbolId) -> usize {
        let mask = self.symbols.len() - 1;
        let mut place = (symbol.0.wrapping_mul(0x9E37_79B1) >> 8) as usize & mask;
        while let Some((other, _)) = self.symbols[place]
            && other != symbol
        {
            place = (place + 1) & mask;
        }
        place
    }

    #[inline]
    fn get(&self, binding: BindingRef) -> Option<LocalBinding> {
        match binding {
            BindingRef::Symbol(_) if self.symbols.is_empty() => None,
            BindingRef::Symbol(symbol) => self.symbols[self.place_of(symbol)].map(|entry| entry.1),
            BindingRef::Slot(..) => self.slots.get(&binding).copied(),
        }
    }

    #[inline]
    fn get_mut(&mut self, binding: BindingRef) -> Option<&mut LocalBinding> {
        match binding {
            BindingRef::Symbol(_) if self.symbols.is_empty() => None,
            BindingRef::Symbol(symbol) => {
                let place = self.place_of(symbol);
                self.symbols[place].as_mut().map(|entry| &mut entry.1)
            }
            BindingRef::Slot(..) => self.slots.get_mut(&binding),
        }
    }

    pub(in crate::lower) fn insert(&mut self, binding: BindingRef, local: LocalBinding) {
        let BindingRef::Symbol(symbol) = binding else {
            self.slots.insert(binding, local);
            return;
        };
        if (self.symbol_count + 1) * 2 > self.symbols.len() {
            self.grow();
        }
        let place = self.place_of(symbol);
        if self.symbols[place].is_none() {
            self.symbol_count += 1;
        }
        self.symbols[place] = Some((symbol, local));
    }

    #[cold]
    #[inline(never)]
    fn grow(&mut self) {
        let capacity = (self.symbols.len() * 2).max(8);
        let smaller = core::mem::replace(&mut self.symbols, vec![None; capacity]);
        for entry in smaller.into_iter().flatten() {
            let place = self.place_of(entry.0);
            self.symbols[place] = Some(entry);
        }
    }
}

#[derive(Default)]
pub(crate) struct ScopeState {
    pub(super) entered: Vec<EnteredScope>,
    pub(super) environments_put_off: Vec<EnvironmentPutOff>,
    pub(in crate::lower) locals: Locals,
    pub(in crate::lower) entry_this: Option<ValueId>,
    /// Values of `this` that hold an object: a parent constructor returned them, or they were checked.
    pub(in crate::lower) initialized_this: SmallVec<[ValueId; 4]>,
    pub(in crate::lower) allocated_instance: Option<ValueId>,
    pub(in crate::lower) unpacked_captures: Vec<ValueId>,
    pub(super) created_functions: FxHashMap<SymbolId, ValueId>,
}

impl ScopeState {
    #[inline]
    pub(super) fn innermost_scope(&self) -> ScopeId {
        let innermost = self.entered.last();
        innermost.map_or(ScopeId::NONE, |entered| entered.scope)
    }

    pub(in crate::lower) fn is_entered(&self, scope: ScopeId) -> bool {
        self.entered.iter().any(|entered| entered.scope == scope)
    }

    pub(in crate::lower) fn find_environment(&self, scope: ScopeId) -> Option<LocalVariable> {
        let mut entered = self.entered.iter().rev();
        entered.find(|entered| entered.scope == scope)?.environment
    }

    pub(in crate::lower) fn find_local(&self, binding: BindingRef) -> Option<LocalBinding> {
        self.locals.get(binding)
    }

    pub(super) fn end_dead_zone(&mut self, binding: BindingRef) {
        if let Some(local) = self.locals.get_mut(binding)
            && local.dead_zone == DeadZone::Uninitialized
        {
            local.dead_zone = DeadZone::Initialized;
        }
    }
}
