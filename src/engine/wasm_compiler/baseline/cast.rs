//! Tests of the types of references.

use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::{RefType, Rtt, ValType};

use super::operand::Operand;
use super::{Compiled, Function};
use crate::abi::{Callable, INSTANCE, INT32_TAG, InstanceLayout, NULL, ObjectType, Trap, object};
use crate::cast::{Cast, Check, NOT_CELL_MASK, Null, ObjectCheck, RttCheck, Source};

impl Function<'_> {
    /// `rtt` may be overwritten.
    pub(super) fn check_rtt(&mut self, check: RttCheck, rtt: Gpr, failure: Label) {
        match check {
            RttCheck::Is { expected } => self.masm.branch64(Cond::Ne, rtt, expected, failure),
            RttCheck::InlineEntryIs { offset, expected } => {
                (self.masm).branch64(Cond::Ne, Address::new(rtt, offset), expected, failure);
            }
            RttCheck::LongEntryIs { depth, expected } => {
                let own_depth = Address::new(rtt, Rtt::DEPTH_OFFSET);
                self.masm.branch32(Cond::Below, own_depth, depth, failure);
                (self.masm).load64(rtt, Address::new(rtt, Rtt::LONG_DISPLAY_OFFSET));
                let entry = Address::new(rtt, depth as i32 * 8);
                self.masm.branch64(Cond::Ne, entry, expected, failure);
            }
        }
    }

    fn cast_of(&self, value: Operand, to: RefType) -> Cast {
        let from = value.ty().as_ref().expect("a reference");
        Cast::new(self.module.types(), from, to)
    }

    /// The outcome, if it does not depend on the value.
    fn known_outcome(&self, value: Operand, to: RefType) -> Option<bool> {
        let cast = self.cast_of(value, to);
        match (value.constant(), cast.null, cast.check) {
            (Some(bits), ..) if bits == NULL as u64 => Some(to.is_nullable()),
            (_, Null::Impossible | Null::Passes, Check::Passes) => Some(true),
            (_, Null::Impossible | Null::Fails, Check::Fails) => Some(false),
            _ => None,
        }
    }

    fn branch_unless_cell(&mut self, source: Source, value: Gpr, target: Label) {
        match source {
            Source::Any => {
                (self.masm).branch_test64(TestCond::NonZero, value, NOT_CELL_MASK, target);
            }
            Source::Eq => self
                .masm
                .branch_test64(TestCond::Negative, value, -1, target),
            Source::Object => {}
        }
    }

    fn branch_unless_object(&mut self, cell: Gpr, target: Label) {
        let host = self.env.host;
        let (kind, expected) = (Address::new(cell, host.cell_kind), host.object_kind);
        self.masm.branch8(Cond::Ne, kind, expected.into(), target);
    }

    fn check_object(&mut self, check: ObjectCheck, cell: Gpr, temp: Gpr, failure: Label) {
        let number_of = |ty| Address::new(INSTANCE, self.env.layout.object_header(ty));
        let types = Address::new(INSTANCE, InstanceLayout::object_types(self.env.host));
        (self.masm).load32(temp, Address::new(cell, object::TYPE_NUMBER));
        match check {
            ObjectCheck::Is { expected } => {
                (self.masm).branch32(Cond::Ne, temp, number_of(expected), failure);
            }
            ObjectCheck::EntryIs { offset, expected } => {
                self.masm.add64(temp, temp, types);
                self.masm.load32(temp, Address::new(temp, offset));
                (self.masm).branch32(Cond::Ne, temp, number_of(expected), failure);
            }
            ObjectCheck::Rtt(check) => {
                self.masm.add64(temp, temp, types);
                self.masm.load64(temp, Address::new(temp, ObjectType::RTT));
                self.check_rtt(check, temp, failure);
            }
            ObjectCheck::KindIs(kind) => {
                self.masm.add64(temp, temp, types);
                let actual = Address::new(temp, ObjectType::KIND);
                (self.masm).branch8(Cond::Ne, actual, (kind as u8).into(), failure);
            }
        }
    }

    /// Goes on if the value has the type. Overwrites `temp`.
    fn check_cast(&mut self, cast: Cast, value: Gpr, temp: Gpr, failure: Label) {
        let host = self.env.host;
        let success = self.masm.new_label();
        match (cast.null, cast.check) {
            (Null::Impossible, _) | (Null::Fails, Check::IsI31(_)) => {}
            (Null::Passes, _) => self.masm.branch64(Cond::Eq, value, NULL, success),
            (Null::Fails, Check::IsEq | Check::IsObject(Source::Any, _)) => {}
            (Null::Fails, _) => self.masm.branch64(Cond::Eq, value, NULL, failure),
        }
        match cast.check {
            Check::Passes => {}
            Check::Fails => self.masm.jump(failure),
            Check::IsI31(Source::Any) => {
                self.masm.branch64(Cond::Below, value, INT32_TAG, failure);
            }
            Check::IsI31(_) => {
                (self.masm).branch_test64(TestCond::NonNegative, value, -1, failure);
            }
            Check::IsEq => {
                self.masm.branch64(Cond::AboveEq, value, INT32_TAG, success);
                self.branch_unless_cell(Source::Any, value, failure);
                self.branch_unless_object(value, failure);
            }
            Check::IsObject(source, check) => {
                self.branch_unless_cell(source, value, failure);
                if source == Source::Any && !matches!(check, ObjectCheck::Is { .. }) {
                    self.branch_unless_object(value, failure);
                }
                self.check_object(check, value, temp, failure);
            }
            Check::IsFunction(check) => {
                let rtt = Address::new(value, host.function_callable + Callable::RTT);
                if let RttCheck::Is { expected } = check {
                    self.masm.branch64(Cond::Ne, rtt, expected, failure);
                } else {
                    self.masm.load64(temp, rtt);
                    self.check_rtt(check, temp, failure);
                }
            }
        }
        self.masm.bind(success);
    }

    pub(super) fn test_type(&mut self, to: RefType) {
        let value = self.pop();
        if let Some(outcome) = self.known_outcome(value, to) {
            return self.push_lazy(Operand::int(Width::W32, outcome.into()));
        }
        let cast = self.cast_of(value, to);
        let value = self.gpr(value);
        let (dst, temp) = (self.take_gpr(), self.take_gpr());
        let failure = self.masm.new_label();
        self.masm.move32(dst, 0);
        self.check_cast(cast, value, temp, failure);
        self.masm.move32(dst, 1);
        self.masm.bind(failure);
        self.push_register(ValType::I32, dst);
    }

    pub(super) fn cast(&mut self, to: RefType) {
        let value = self.top();
        let mut cast = self.cast_of(value, to);
        let null_is_accessed = cast.null == Null::Fails && to.heap_type().index().is_some();
        match self.known_outcome(value, to) {
            Some(true) => return,
            Some(false) if !null_is_accessed => return self.trap(Trap::CastFailure),
            _ => {}
        }
        let reg = self.top_gpr();
        if null_is_accessed {
            let trap = self.trap_label(Trap::NullReference);
            self.masm.branch64(Cond::Eq, reg, NULL, trap);
            cast.null = Null::Impossible;
        }
        let temp = self.take_gpr();
        let trap = self.trap_label(Trap::CastFailure);
        self.check_cast(cast, reg, temp, trap);
        self.narrow_top_after(cast, to);
    }

    fn narrow_top_after(&mut self, cast: Cast, to: RefType) {
        let from = self.top().ty().as_ref().expect("a reference");
        let heap_type = match cast.check {
            Check::Passes => from.heap_type(),
            _ => to.heap_type(),
        };
        let is_nullable = from.is_nullable() && to.is_nullable();
        self.narrow_top(RefType::new(heap_type, is_nullable));
    }

    /// If null passes, what fails is not null.
    fn narrow_top_after_failure(&mut self, to: RefType) {
        let from = self.top().ty().as_ref().expect("a reference");
        let is_nullable = from.is_nullable() && !to.is_nullable();
        self.narrow_top(RefType::new(from.heap_type(), is_nullable));
    }

    pub(super) fn branch_on_cast(&mut self, label: u32, to: RefType) -> Compiled {
        match self.known_outcome(self.top(), to) {
            Some(true) => return self.jump_to_label(label),
            Some(false) => return Ok(()),
            None => {}
        }
        let (cast, value, temp, target) = self.prepare_branch_on_cast(label, to)?;
        let failure = self.masm.new_label();
        self.check_cast(cast, value, temp, failure);
        self.masm.jump(target);
        self.masm.bind(failure);
        self.narrow_top_after_failure(to);
        Ok(())
    }

    pub(super) fn branch_on_cast_failure(&mut self, label: u32, to: RefType) -> Compiled {
        match self.known_outcome(self.top(), to) {
            Some(true) => return Ok(()),
            Some(false) => return self.jump_to_label(label),
            None => {}
        }
        let (cast, value, temp, target) = self.prepare_branch_on_cast(label, to)?;
        self.check_cast(cast, value, temp, target);
        self.narrow_top_after(cast, to);
        Ok(())
    }

    fn prepare_branch_on_cast(
        &mut self,
        label: u32,
        to: RefType,
    ) -> Result<(Cast, Gpr, Gpr, Label), bun_engine_asm::CodeTooLarge> {
        let cast = self.cast_of(self.top(), to);
        let value = self.own_top().gpr();
        let temp = self.take_gpr();
        let target = self.label_for_branch(self.block_index(label))?;
        Ok((cast, value, temp, target))
    }
}
