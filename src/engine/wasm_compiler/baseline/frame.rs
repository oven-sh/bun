//! Where baseline code keeps what is not in a register.

use bun_engine_wasm_format::{FunctionBody, FunctionFlags, ValType};

use crate::abi::{Place, Signature, frame};

/// Below the frame pointer are the locals, the exceptions that `catch` blocks hold, the operand stack, and the words
/// that a callee fills in. Offsets are from the frame pointer.
#[derive(Clone, Copy)]
pub struct Frame {
    params_end: i32,
    locals_end: i32,
    operands_start: i32,
    operand_size_log2: u8,
    size: u32,
}

const ALIGNMENT: i32 = 16;
pub(super) const CALLEE_WORDS_SIZE: u32 = (frame::ARGUMENTS - frame::INSTANCE) as u32;

impl Frame {
    /// Calls `local` with the type and the offset of each local, parameters first.
    pub fn new(
        body: &FunctionBody<'_>,
        signature: &Signature,
        mut local: impl FnMut(ValType, i32),
    ) -> Self {
        let mut end = 0;
        let mut take = |ty: ValType| {
            let size = ty.size_in_bytes() as i32;
            end = (end - size) & -size;
            end
        };
        // Results are written while parameters are still read.
        let is_overwritten = signature.has_results_on_stack();
        let mut params_end = 0;
        for (&ty, &place) in body.func_type().params.iter().zip(&signature.params) {
            match place {
                Place::Stack(offset) if !is_overwritten => local(ty, offset),
                _ => {
                    params_end = take(ty);
                    local(ty, params_end);
                }
            }
        }
        for (count, ty) in body.local_groups() {
            for _ in 0..count {
                local(ty, take(ty));
            }
        }

        let facts = body.facts();
        let locals_end = end & -ALIGNMENT;
        let operands_start = (locals_end - facts.max_catch_depth as i32 * 8) & -ALIGNMENT;
        let operand_size_log2 = 3 + u8::from(facts.flags.contains(FunctionFlags::USES_SIMD));
        let operands_size = facts.max_stack_height << operand_size_log2;
        Self {
            params_end,
            locals_end,
            operands_start,
            operand_size_log2,
            size: operands_start.unsigned_abs()
                + operands_size.next_multiple_of(ALIGNMENT as u32)
                + CALLEE_WORDS_SIZE,
        }
    }

    /// From the stack pointer up to the frame pointer.
    #[inline]
    pub fn size(&self) -> u32 {
        self.size
    }

    /// `position` counts from the bottom of the operand stack.
    #[inline]
    pub fn operand(&self, position: u32) -> i32 {
        self.operands_start - ((position as i32 + 1) << self.operand_size_log2)
    }

    /// Of the `exnref` that a `catch` or `catch_all` block holds. `depth` counts those around it.
    #[inline]
    pub fn exception(&self, depth: u32) -> i32 {
        self.locals_end - (depth as i32 + 1) * 8
    }

    /// Covers the locals that are not parameters. Both ends are multiples of 16.
    pub(super) fn declared_locals(&self) -> core::ops::Range<i32> {
        self.locals_end..(self.params_end + ALIGNMENT - 1) & -ALIGNMENT
    }
}
