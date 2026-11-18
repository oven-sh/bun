//! The usual cases of the instructions that make lists. They neither collect nor throw, and give `None` if there is
//! more to it.

use bun_engine_bytecode::ArrayShape;
use bun_engine_macros::native_abi;

use crate::{
    ArrayAllocationProfile, CallFrame, Cx, ElementKind, Gc, ImmutableArray, IndexingMode, JsArray,
    JsCell, MappedArguments, RealmSlot, Shape, Storage, Value,
};

const WORD: usize = size_of::<u64>();
const LONGEST: usize = 64;

/// # Safety
/// The two go together, and the storage is complete.
#[inline(always)]
unsafe fn try_create(cx: &Cx, shape: &Shape, storage: Storage) -> Option<Gc<JsArray>> {
    let address = cx
        .heap
        .cells
        .allocator_for(size_of::<JsArray>())?
        .try_bump()?;
    let words = [JsCell::header_for(shape), storage.address() as u64];
    // SAFETY: a new cell, and that is all there is to it.
    unsafe {
        core::ptr::with_exposed_provenance_mut::<[u64; 2]>(address).write(words);
        Some(Gc::from_address(address))
    }
}

/// `element` gives the words for the first `given` elements, which suit the kind. The others are holes.
#[inline(always)]
fn try_build(
    cx: &Cx,
    kind: ElementKind,
    [given, length, room]: [usize; 3],
    element: impl Fn(usize) -> u64,
) -> Option<Gc<JsArray>> {
    if room > LONGEST {
        return None;
    }
    let size = Storage::size(0, Some(Storage::min_vector_length(room as u32)));
    let allocator = cx.heap.auxiliary.allocator_for(size)?;
    let (base, words) = (allocator.try_bump()?, allocator.cell_size() / WORD);
    let storage = Storage::from_base(base, 0);
    // SAFETY: inside the new cell, which has an even number of words. The stores are not to be made calls.
    unsafe {
        let first = core::ptr::with_exposed_provenance_mut::<u64>(base);
        for pair in given.div_ceil(2)..words / 2 {
            (first.cast::<[u64; 2]>().add(pair)).write_volatile([kind.hole(); 2]);
        }
        first.add(1 + (given & !1)).write_volatile(kind.hole());
        for index in 0..given {
            first.add(1 + index).write_volatile(element(index));
        }
        storage.set_lengths(length as u32, words as u32 - 1);
        try_create(cx, &cx.global().array_shape(kind), storage)
    }
}

/// # Safety
/// As for `new_array`. There are `count` registers, from the one at the lowest address.
#[native_abi]
#[inline]
pub unsafe fn try_new_array(
    cx: &Cx,
    profile: &ArrayAllocationProfile,
    lowest: *const u64,
    count: usize,
    shape: ArrayShape,
) -> Option<Gc<JsArray>> {
    // SAFETY: the caller's.
    let (registers, (kind, room)) =
        unsafe { (core::slice::from_raw_parts(lowest, count), profile.update()) };
    let (kind, sizes) = (
        kind.max(shape.into()),
        [count, count, count.max(room as usize)],
    );
    let bits = |index: usize| registers[count - 1 - index];
    let array = match kind {
        ElementKind::Contiguous => try_build(cx, kind, sizes, bits),
        ElementKind::Double => {
            // SAFETY: a value, or nothing.
            let number = |bits| unsafe { Value::from_bits_or_empty(bits) }?.as_number();
            let fits = |&bits| number(bits).is_some_and(|it| !it.is_nan());
            registers.iter().all(fits).then_some(())?;
            let word = |index| number(bits(index)).map_or(0, f64::to_bits);
            try_build(cx, kind, sizes, word)
        }
        _ => {
            let common = registers.iter().fold(u64::MAX, |all, it| all & it);
            (common >= Value::NUMBER_TAG && (kind == ElementKind::Int32 || count == 0))
                .then_some(())?;
            try_build(cx, kind, sizes, bits)
        }
    };
    Some(profile.did_allocate(array?))
}

/// # Safety
/// As for `new_array`.
#[native_abi]
#[inline]
pub unsafe fn try_new_array_from_constant(
    cx: &Cx,
    profile: &ArrayAllocationProfile,
    elements: Gc<ImmutableArray>,
) -> Option<Gc<JsArray>> {
    // SAFETY: the caller's.
    let (global, (kind, room)) = (cx.global(), unsafe { profile.update() });
    if kind > elements.kind() || global.is_having_a_bad_time() {
        return None;
    }
    if profile.prefers_copy_of(elements.len()) {
        let (length, words) = (elements.len() as usize, elements.storage().elements_ptr());
        let sizes = [length, length, length.max(room as usize)];
        // SAFETY: it has that many.
        let word = |index| unsafe { *words.add(index) };
        return Some(profile.did_allocate(try_build(cx, elements.kind(), sizes, word)?));
    }
    let mode = IndexingMode::array(elements.kind()).copy_on_write();
    // SAFETY: what such a shape describes.
    let array = unsafe { try_create(cx, &global.original_array_shape(mode), elements.storage()) };
    Some(profile.did_allocate(array?))
}

/// # Safety
/// As for `new_array`.
#[native_abi]
#[inline]
pub unsafe fn try_new_array_with_size(
    cx: &Cx,
    profile: &ArrayAllocationProfile,
    length: Value,
) -> Option<Gc<JsArray>> {
    let length = length.as_int32()? as u32 as usize;
    // SAFETY: the caller's.
    let (kind, room) = unsafe { profile.update() };
    let array = try_build(cx, kind, [0, length, length.max(room as usize)], |_| 0);
    Some(profile.did_allocate(array?))
}

#[native_abi]
#[inline]
pub fn try_create_rest(cx: &Cx, frame: &CallFrame, skip: usize) -> Option<Gc<JsArray>> {
    frame.code_block()?.note_argument_count(frame);
    let rest = frame.rest(skip);
    let bits = |index: usize| rest[index].to_bits();
    try_build(cx, ElementKind::Contiguous, [rest.len(); 3], bits)
}

/// # Safety
/// The frame has arguments for that many parameters, not counting `this`.
#[native_abi]
#[inline]
pub unsafe fn try_create_direct_arguments(
    cx: &Cx,
    frame: &CallFrame,
    parameters: u32,
) -> Option<Gc<MappedArguments>> {
    frame.code_block()?.note_argument_count(frame);
    let length = frame.argument_count() as u32;
    let slot_count = length.max(parameters);
    let shape = (cx.global()).slot_if_initialized(RealmSlot::direct_arguments_shape)?;
    let size = MappedArguments::offset_of_slot(slot_count);
    let address = cx.heap.cells.allocator_for(size)?.try_bump()?;
    // SAFETY: a new cell that is large enough. The stores are not to be made a call.
    unsafe {
        let (shape, callee) = (shape.cast_unchecked(), frame.callee());
        MappedArguments::initialize_direct(address, shape, callee, length, parameters);
        let slots = address + MappedArguments::OFFSET_OF_SLOTS;
        let slots = core::ptr::with_exposed_provenance_mut::<u64>(slots);
        let first = (CallFrame::OFFSET_OF_ARGUMENTS / WORD) as isize;
        for index in 0..slot_count as usize {
            (slots.add(index)).write_volatile(frame.slot(first + index as isize).get());
        }
        Some(Gc::from_address(address))
    }
}
