//! References and their types.

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{RefType, ValType};
use bun_engine_wasm_runtime::Reference;

use super::control::jump;
use crate::code::Op;
use crate::machine::{Handler, Machine, fail, given, handlers, specialize};

impl Machine<'_, '_> {
    /// The record has the type in `imm`, and in `low` the offset of the header for objects of it, or zero.
    #[inline(always)]
    fn has_type(&self, value: u64, ty: &Op) -> Option<bool> {
        if ty.low() != 0 && self.cx.has_exact_type(value, ty.low()) {
            return Some(true);
        }
        Some(
            self.cx
                .has_type(value, ValType::from_bits(ty.imm).as_ref()?),
        )
    }
}

fn trap_for_cast(value: u64, to: Option<RefType>) -> Trap {
    let is_defined = to.is_some_and(|to| to.heap_type().index().is_some());
    match is_defined && Reference(value).is_null() {
        true => Trap::NullReference,
        false => Trap::CastFailure,
    }
}

handlers! {
    fn as_non_null(m, op) {
        if Reference(m.get(op.a)).is_null() {
            fail!(Trap::NullAsNonNull);
        }
    }

    fn test(m, op, ty) {
        let has_type = given!(m.has_type(m.get(op.b), ty));
        m.forget_last_results();
        m.produce(op.a, u32::from(has_type));
    }

    fn cast(m, op, ty) {
        let value = m.get(op.a);
        if !given!(m.has_type(value, ty)) {
            fail!(trap_for_cast(value, ValType::from_bits(ty.imm).as_ref()));
        }
        m.forget_last_results();
    }

    fn branch_on_cast[const IF_IT_PASSES: bool, const IS_BACKWARD: bool](m, op, ty) {
        let has_type = given!(m.has_type(m.get(op.a), ty));
        m.forget_last_results();
        if has_type == IF_IT_PASSES {
            jump!(m, op.imm, IS_BACKWARD);
        }
    }

    fn new_i31(m, op) {
        let reference = Reference::from_i31(m.get(op.b) as i32);
        m.produce(op.a, reference.0);
    }

    /// `imm` has the bits that count.
    fn i31_get(m, op) {
        let value = m.get(op.b);
        if Reference(value).is_null() {
            fail!(Trap::NullI31);
        }
        m.produce(op.a, value as u32 & op.imm);
    }

    fn any_convert_extern(m, op) {
        let converted = Reference(m.get(op.b)).internalized();
        m.forget_last_results();
        m.produce(op.a, converted.0);
    }
}

pub(crate) fn for_branch_on_cast(if_it_passes: bool, is_backward: bool) -> Handler {
    specialize!(if_it_passes => const IF_IT_PASSES: bool,
        specialize!(is_backward => const IS_BACKWARD: bool, branch_on_cast::<IF_IT_PASSES, IS_BACKWARD>))
}
