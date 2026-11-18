use core::ptr;
use core::sync::atomic::{AtomicU64, Ordering};
use core::time::Duration;

use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{DataIndex, MemoryIndex};

use super::minus_one;
use crate::host::Expected;
use crate::instance::Instance;
use crate::memory::{copy_bytes, fill_bytes};
use crate::outcome::{Failure, Outcome};

/// # Safety
/// The module has such a memory.
#[inline(always)]
unsafe fn address_of(
    instance: &Instance,
    memory: MemoryIndex,
    offset: u64,
    count: u64,
) -> Option<*mut u8> {
    // SAFETY: the caller's. The length of a shared memory lives as long as the memory, which the instance keeps.
    let (base, length) = unsafe {
        let view = &*instance.memory_view(memory);
        let length = match view.shared_length {
            0 => view.length,
            address => AtomicU64::from_ptr(ptr::with_exposed_provenance_mut(address))
                .load(Ordering::SeqCst),
        };
        (view.base, length)
    };
    let is_in_bounds = offset.checked_add(count)? <= length;
    is_in_bounds.then(|| ptr::with_exposed_provenance_mut(base + offset as usize))
}

#[native_abi]
pub(crate) unsafe fn grow(instance: &Instance, memory: MemoryIndex, pages: u64) -> Outcome {
    let memory = instance.memory(memory);
    let failed = |_| minus_one(memory.ty().address);
    Outcome::value(memory.grow(pages).unwrap_or_else(failed))
}

#[native_abi]
pub(crate) unsafe fn fill(
    instance: &Instance,
    memory: MemoryIndex,
    dst: u64,
    value: u64,
    count: u64,
) -> Outcome {
    // SAFETY: validated.
    let Some(dst) = (unsafe { address_of(instance, memory, dst, count) }) else {
        return Outcome::failure(Trap::MemoryOutOfBounds);
    };
    // SAFETY: in bounds.
    unsafe { fill_bytes(dst, value as u8, count as usize) };
    Outcome::value(0)
}

#[native_abi]
pub(crate) unsafe fn copy(
    instance: &Instance,
    dst_memory: MemoryIndex,
    src_memory: MemoryIndex,
    dst: u64,
    src: u64,
    count: u64,
) -> Outcome {
    // SAFETY: validated.
    let (Some(dst), Some(src)) = (unsafe {
        (
            address_of(instance, dst_memory, dst, count),
            address_of(instance, src_memory, src, count),
        )
    }) else {
        return Outcome::failure(Trap::MemoryOutOfBounds);
    };
    // SAFETY: in bounds.
    unsafe { copy_bytes(dst, src, count as usize) };
    Outcome::value(0)
}

#[native_abi]
pub(crate) unsafe fn init(
    instance: &Instance,
    memory: MemoryIndex,
    data: DataIndex,
    dst: u64,
    src: u64,
    count: u64,
) -> Outcome {
    // SAFETY: validated.
    let dst = unsafe { address_of(instance, memory, dst, count) };
    let (Some(dst), Some(bytes)) = (dst, instance.data(data, src, count)) else {
        return Outcome::failure(Trap::MemoryOutOfBounds);
    };
    // SAFETY: in bounds.
    unsafe { copy_bytes(dst, bytes.as_ptr(), bytes.len()) };
    Outcome::value(0)
}

#[native_abi]
pub(crate) unsafe fn drop_data(instance: &Instance, data: DataIndex) {
    instance.drop_data(data);
}

/// # Safety
/// The module has such a memory.
unsafe fn address_of_atomic(
    instance: &Instance,
    memory: MemoryIndex,
    offset: u64,
    address: u64,
    size: u64,
) -> Result<usize, Trap> {
    let start = address.checked_add(offset);
    let start = start.filter(|start| start.is_multiple_of(size));
    // SAFETY: the caller's.
    let place = start.and_then(|start| unsafe { address_of(instance, memory, start, size) });
    place.map(<*mut u8>::addr).ok_or(Trap::MemoryOutOfBounds)
}

/// # Safety
/// `address` is aligned and in bounds of the memory.
unsafe fn wait(
    instance: &Instance,
    memory: MemoryIndex,
    address: Result<usize, Trap>,
    expected: Expected,
    nanoseconds: i64,
) -> Result<u64, Failure> {
    let address = address?;
    if !instance.memory(memory).ty().shared {
        return Err(Trap::MemoryOutOfBounds.into());
    }
    let timeout = u64::try_from(nanoseconds).ok().map(Duration::from_nanos);
    let host = instance.engine().host();
    // SAFETY: the caller's. A shared memory does not move.
    Ok(unsafe { host.wait(instance, address, expected, timeout) }? as u64)
}

#[native_abi]
pub(crate) unsafe fn wait32(
    instance: &Instance,
    memory: MemoryIndex,
    offset: u64,
    address: u64,
    expected: u64,
    timeout: i64,
) -> Outcome {
    let expected = Expected::Bits32(expected as u32);
    // SAFETY: validated, and then checked.
    unsafe {
        let address = address_of_atomic(instance, memory, offset, address, 4);
        wait(instance, memory, address, expected, timeout).into()
    }
}

#[native_abi]
pub(crate) unsafe fn wait64(
    instance: &Instance,
    memory: MemoryIndex,
    offset: u64,
    address: u64,
    expected: u64,
    timeout: i64,
) -> Outcome {
    let expected = Expected::Bits64(expected);
    // SAFETY: validated, and then checked.
    unsafe {
        let address = address_of_atomic(instance, memory, offset, address, 8);
        wait(instance, memory, address, expected, timeout).into()
    }
}

#[native_abi]
pub(crate) unsafe fn notify(
    instance: &Instance,
    memory: MemoryIndex,
    offset: u64,
    address: u64,
    count: u64,
) -> Outcome {
    // SAFETY: validated.
    let address = unsafe { address_of_atomic(instance, memory, offset, address, 4) };
    let woken = address.map(|address| match instance.memory(memory).ty().shared {
        true => instance
            .engine()
            .host()
            .notify(address, count as u32)
            .into(),
        false => 0,
    });
    woken.into()
}
