//! What instructions want of the scopes that they name.

use std::rc::Rc;

use super::{Fault, Verifier};
use crate::instruction::Opcode;
use crate::operand::{Field, Register};
use crate::scope::{ScopeKind, SlotKind, StaticScope};

pub(super) const fn names_a_scope(opcode: Opcode) -> bool {
    use Opcode::*;
    (CreateScope as u8 <= opcode as u8 && opcode as u8 <= GetImport as u8)
        || matches!(
            opcode,
            CreateScopedArguments
                | ResolveDynamic
                | PutHoisted
                | NewFunction
                | NewClass
                | DirectEval
                | DynamicImport
        )
}

impl<'a> Verifier<'a> {
    /// `Some(None)` is the global scope.
    #[inline]
    fn scope_in(&self, register: u32) -> Option<Option<&'a StaticScope>> {
        match Register::from_word(register).local_index()? {
            0 => Some(self.scope_of_callee),
            local => {
                let index = (self.created_scopes).binary_search_by_key(&local, |it| it.0);
                Some(Some(self.created_scopes[index.ok()?].1))
            }
        }
    }

    fn holds(&self, register: u32, scope: Option<&Rc<StaticScope>>) -> bool {
        let address = |scope: Option<&StaticScope>| scope.map(core::ptr::from_ref);
        self.scope_in(register).map(address) == Some(address(scope.map(|it| &**it)))
    }

    /// Those in the locals above it have ended.
    fn note_scope(&mut self, register: u32, scope: &'a StaticScope) -> Option<()> {
        let local = Register::from_word(register).local_index()?;
        let lasting = self.created_scopes.partition_point(|it| it.0 < local);
        self.created_scopes.truncate(lasting);
        self.created_scopes.try_reserve(1).ok()?;
        self.created_scopes.push((local, scope));
        Some(())
    }

    /// Code has its own scopes at hand.
    #[inline]
    fn scope_around(&mut self, register: u32, depth: u32) -> Option<&'a StaticScope> {
        if register != Register::SCOPE.word() {
            return self.scope_in(register)?.filter(|_| depth == 0);
        }
        while self.chain.len() <= depth as usize {
            let parent = self.chain.last()?.parent.as_deref()?;
            self.chain.try_reserve(1).ok()?;
            self.chain.push(parent);
        }
        Some(self.chain[depth as usize])
    }

    #[inline]
    fn has_slot(&mut self, register: u32, depth: u32, slot: u32) -> bool {
        (self.scope_around(register, depth)).is_some_and(|scope| slot < scope.slot_count)
    }

    fn kind_of_slot(&mut self, register: u32, depth: u32, slot: u32) -> Option<SlotKind> {
        Some(self.scope_around(register, depth)?.slot_at(slot)?.kind)
    }

    /// Goes by the order of the code.
    #[inline(always)]
    pub(super) fn check_scopes(&mut self, opcode: Opcode, words: &[u32]) -> Result<(), Fault> {
        use Opcode::*;
        let (functions, scopes) = (&self.code.functions, &self.code.scopes);
        let is_valid = match (opcode, words) {
            (GetScoped, &[_, scope, slot]) | (PutScoped, &[scope, slot, _]) => {
                self.has_slot(scope, 0, slot)
            }
            (GetOuter | GetInternal, &[_, scope, depth, slot])
            | (PutOuter, &[scope, depth, slot, _]) => self.has_slot(scope, depth, slot),
            (GetScopedChecked, &[_, scope, slot]) => self.kind_of_slot(scope, 0, slot).is_some(),
            (GetOuterChecked, &[_, scope, depth, slot]) => {
                self.kind_of_slot(scope, depth, slot).is_some()
            }
            (GetImport, &[_, scope, depth, slot]) => {
                self.kind_of_slot(scope, depth, slot) == Some(SlotKind::Import)
            }
            (CreateScope | CreateWithScope, &[dst, parent, scope, ..]) => {
                let scope = &scopes[scope as usize];
                self.holds(parent, scope.parent()) && self.note_scope(dst, scope).is_some()
            }
            (NewFunction, &[_, scope, function]) | (NewClass, &[_, _, scope, function, ..]) => {
                self.holds(scope, functions[function as usize].outer_scope())
            }
            (CopyScope, &[scope]) | (CreateScopedArguments, &[_, scope]) => self
                .scope_around(scope, 0)
                .is_some_and(|it| it.kind != ScopeKind::With),
            (ResolveDynamic, &[_, scope, _])
            | (PutHoisted, &[scope, ..])
            | (DirectEval, &[_, _, scope, _])
            | (DynamicImport, &[_, _, _, scope, _]) => self.scope_in(scope).is_some(),
            _ => true,
        };
        (is_valid || !self.checks_scopes).ok_or(Fault::Scope)
    }
}
