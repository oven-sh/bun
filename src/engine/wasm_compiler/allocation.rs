//! Making structs and arrays without a call. The code goes to `slow` if that cannot be done.

use bun_engine_asm::RegOrImm;
use bun_engine_asm::prelude::*;
use bun_engine_wasm_format::TypeIndex;

use crate::abi::{AllocatorLayout, INSTANCE, InstanceLayout, object};
use crate::output::Environment;

/// In bytes. The run time writes the defaults of a larger struct.
pub(crate) const LARGEST_CLEARED_IN_LINE: u32 = 64;

fn find_cell(
    masm: &mut MacroAssembler,
    layout: &AllocatorLayout,
    allocator: Address,
    cell: Gpr,
    slow: Label,
) {
    masm.load64(cell, allocator.plus(layout.start));
    masm.branch64(Cond::AboveEq, cell, allocator.plus(layout.end), slow);
}

/// For what [`AllocatorLayout::for_size`] gives.
pub(crate) fn take_cell(
    masm: &mut MacroAssembler,
    env: &Environment<'_>,
    (allocator, cell_size): (i32, u32),
    cell: Gpr,
    [first, temp]: [Gpr; 2],
    slow: Label,
) {
    let host = env.host;
    masm.load64(
        first,
        Address::new(INSTANCE, InstanceLayout::allocators(host)),
    );
    let allocator = Address::new(first, allocator);
    find_cell(masm, &host.allocators, allocator, cell, slow);
    masm.add64(temp, cell, cell_size);
    masm.store64(allocator.plus(host.allocators.start), temp);
}

/// `length` is for an array.
pub(crate) fn write_header(
    masm: &mut MacroAssembler,
    env: &Environment<'_>,
    ty: TypeIndex,
    cell: Gpr,
    temp: Gpr,
    length: Option<RegOrImm>,
) {
    masm.load64(temp, Address::new(INSTANCE, env.layout.object_header(ty)));
    masm.store64(Address::new(cell, 0), temp);
    if let Some(length) = length {
        masm.store32(Address::new(cell, object::LENGTH), length);
    }
}

/// `pattern` is a vector of elements.
pub(crate) fn new_filled_array(
    masm: &mut MacroAssembler,
    env: &Environment<'_>,
    ty: TypeIndex,
    cell: Gpr,
    (length, pattern): (Gpr, Fpr),
    [end, allocator, temp]: [Gpr; 3],
    slow: Label,
) {
    const MOST_STEPS: usize = 64;
    const STEP_LOG2: u8 = AllocatorLayout::STEP_LOG2;
    const STEP: i32 = 1 << STEP_LOG2;
    let host = env.host;
    let layout = &host.allocators;
    let element = env.module.types().array_type(ty).element.storage;
    let elements = object::elements(element);
    masm.shl64(end, length, element.log2_size());
    masm.add64(end, end, elements + STEP - 1);
    masm.shr64(end, end, STEP_LOG2);
    let steps = layout.class_of_step.len().min(MOST_STEPS);
    masm.branch64(Cond::AboveEq, end, steps, slow);
    masm.move64(temp, layout.class_of_step.as_ptr().addr());
    masm.load8(temp, Address::indexed(temp, end, Scale::One, 0));
    masm.mul32(temp, temp, layout.stride);
    let first = Address::new(INSTANCE, InstanceLayout::allocators(host));
    masm.load64(allocator, first);
    masm.add64(allocator, allocator, temp);
    let allocator = Address::new(allocator, 0);
    find_cell(masm, layout, allocator, cell, slow);
    masm.load32(temp, allocator.plus(layout.cell_size));
    masm.add64(temp, temp, cell);
    masm.store64(allocator.plus(layout.start), temp);

    // This may reach into the header.
    masm.shl32(end, end, STEP_LOG2);
    let again = masm.here();
    masm.sub32(end, end, STEP);
    masm.store_vector(Address::indexed(cell, end, Scale::One, 0), pattern);
    masm.branch32(Cond::Above, end, elements, again);
    write_header(masm, env, ty, cell, temp, Some(length.into()));
}
