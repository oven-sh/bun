//! What a script sees of a trap.

use bun_engine_vm::Thrown;
use bun_engine_wasm_compiler::abi::Trap;

use crate::errors::{self, Kind};
use crate::prelude::*;

fn message_of(trap: Trap) -> &'static str {
    match trap {
        Trap::Unreachable => "Unreachable code should not be executed",
        Trap::MemoryOutOfBounds => "Out of bounds memory access",
        Trap::UnalignedAtomic => "Unaligned memory access",
        Trap::TableOutOfBounds => "Out of bounds table access",
        Trap::IndirectCallOutOfBounds => "Out of bounds call_indirect",
        Trap::SignatureMismatch => "call_indirect to a signature that does not match",
        Trap::DivisionByZero => "Division by zero",
        Trap::IntegerOverflow => "Integer overflow",
        Trap::TruncationOutOfRange => "Out of bounds Trunc operation",
        Trap::StackOverflow => "Stack overflow",
        Trap::NullReference => "access to a null reference",
        Trap::NullExnref => "throw_ref on a null reference",
        Trap::NullI31 => "i31.get_<sx> to a null reference",
        Trap::NullFunction => "call_ref to a null reference",
        Trap::NullAsNonNull => "ref.as_non_null to a null reference",
        Trap::NullArrayInitData => "array.init_data to a null reference",
        Trap::NullArrayInitElem => "array.init_elem to a null reference",
        Trap::CastFailure => "ref.cast failed to cast reference to target heap type",
        Trap::ArrayGetOutOfBounds => "Out of bounds array.get",
        Trap::ArraySetOutOfBounds => "Out of bounds array.set",
        Trap::ArrayFillOutOfBounds => "Out of bounds array.fill",
        Trap::ArrayCopyOutOfBounds => "Out of bounds array.copy",
        Trap::ArrayInitDataOutOfBounds => "Out of bounds array.init_data",
        Trap::ArrayInitElemOutOfBounds => "Out of bounds array.init_elem",
        Trap::StructNewFailure => "Failed to allocate new struct",
        Trap::ArrayNewFailure => "Failed to allocate new array",
        Trap::ArrayNewDataFailure => "Out of bounds or failed to allocate in array.new_data",
        Trap::ArrayNewElemFailure => "Out of bounds or failed to allocate in array.new_elem",
        Trap::IllegalArgument => "Illegal argument",
        Trap::OutOfMemory => "Out of memory",
    }
}

/// An error that no handler of WebAssembly catches.
pub(crate) fn throw(cx: &Cx, trap: Trap) -> Thrown {
    if trap == Trap::StackOverflow {
        return cx.throw_stack_overflow();
    }
    let error = errors::create(cx, Kind::Runtime, message_of(trap));
    error.set_not_catchable_from_wasm();
    cx.throw(error.into())
}
