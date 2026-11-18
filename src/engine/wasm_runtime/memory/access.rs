//! Reads and writes of the run time. Other threads may access the same bytes meanwhile, so no reference covers them,
//! and the compiler does not get to know what the functions that access them do.

use core::ffi::{c_int, c_void};
use core::mem::transmute;

use bun_engine_wasm_compiler::abi::Trap;

use super::Memory;

#[inline(always)]
fn unknown(function: *const ()) -> *const () {
    let mut address = function.expose_provenance();
    // SAFETY: it does nothing.
    unsafe {
        core::arch::asm!("/* {} */", inout(reg) address, options(pure, nomem, nostack, preserves_flags));
    }
    core::ptr::with_exposed_provenance(address)
}

/// The ranges may overlap.
///
/// # Safety
/// Both are accessible.
#[inline]
pub(crate) unsafe fn copy_bytes(dst: *mut u8, src: *const u8, count: usize) {
    type Move = unsafe extern "C" fn(*mut u8, *const u8, usize) -> *mut c_void;
    // SAFETY: the type of the function, and the caller's.
    unsafe { transmute::<*const (), Move>(unknown(libc::memmove as _))(dst, src, count) };
}

/// # Safety
/// The range is accessible.
#[inline]
pub(crate) unsafe fn fill_bytes(dst: *mut u8, value: u8, count: usize) {
    type Fill = unsafe extern "C" fn(*mut u8, c_int, usize) -> *mut c_void;
    // SAFETY: the type of the function, and the caller's.
    unsafe { transmute::<*const (), Fill>(unknown(libc::memset as _))(dst, value.into(), count) };
}

impl Memory {
    /// The bytes stay there until the memory grows.
    #[inline]
    pub(crate) fn address_of(&self, offset: u64, count: u64) -> Result<*mut u8, Trap> {
        let pages = self.pages.borrow();
        match offset.checked_add(count) {
            Some(end) if end <= pages.len() => Ok(pages.base().wrapping_add(offset as usize)),
            _ => Err(Trap::MemoryOutOfBounds),
        }
    }

    pub fn write(&self, offset: u64, bytes: &[u8]) -> Result<(), Trap> {
        let dst = self.address_of(offset, bytes.len() as u64)?;
        // SAFETY: in bounds.
        unsafe { copy_bytes(dst, bytes.as_ptr(), bytes.len()) };
        Ok(())
    }

    pub fn read(&self, offset: u64, bytes: &mut [u8]) -> Result<(), Trap> {
        let src = self.address_of(offset, bytes.len() as u64)?;
        // SAFETY: in bounds.
        unsafe { copy_bytes(bytes.as_mut_ptr(), src, bytes.len()) };
        Ok(())
    }
}
