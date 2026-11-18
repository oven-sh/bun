//! What Windows needs to walk through the frames of generated code, all of which are chained by the frame pointer.

use core::ffi::c_void;

use crate::pool::{self, GRANULE, Pool};

/// `PEXCEPTION_ROUTINE`
pub type ExceptionHandler =
    unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void, *mut c_void) -> i32;

/// <https://learn.microsoft.com/en-us/cpp/build/exception-handling-x64>
#[cfg(target_arch = "x86_64")]
mod format {
    pub(super) const FUNCTION_SIZE: u32 = 1 << 30;

    const VERSION_1_WITH_HANDLER: u8 = 1 | 1 << 3;
    const RBP: u8 = 5;
    const PUSH_NONVOLATILE: u8 = 0;
    const SET_FRAME_POINTER: u8 = 3;
    /// Where `push rbp` and `mov rbp, rsp` end.
    const AFTER_PUSH: u8 = 1;
    const AFTER_MOVE: u8 = 4;

    /// What comes before the offset of the handler.
    pub(super) const UNWIND_INFO: [u8; 8] = [
        VERSION_1_WITH_HANDLER,
        AFTER_MOVE,
        2,
        RBP,
        AFTER_MOVE,
        SET_FRAME_POINTER,
        AFTER_PUSH,
        PUSH_NONVOLATILE | RBP << 4,
    ];

    pub(super) fn runtime_function(start: u32, unwind_info: u32) -> [u32; 3] {
        [start, start + FUNCTION_SIZE, unwind_info]
    }
}

/// <https://learn.microsoft.com/en-us/cpp/build/arm64-exception-handling>
#[cfg(target_arch = "aarch64")]
mod format {
    /// The count of instructions has 18 bits.
    pub(super) const FUNCTION_SIZE: u32 = 1 << 19;

    const HAS_HANDLER: u32 = 1 << 20;
    const ONE_WORD_OF_CODES: u32 = 1 << 27;
    const HEADER: [u8; 4] = ((FUNCTION_SIZE / 4) | HAS_HANDLER | ONE_WORD_OF_CODES).to_le_bytes();
    const SET_FRAME_POINTER: u8 = 0xe1;
    const PUSH_FRAME_POINTER_AND_LINK_REGISTER: u8 = 0x81;
    const END: u8 = 0xe4;
    const NOP: u8 = 0xe3;

    pub(super) const UNWIND_INFO: [u8; 8] = [
        HEADER[0],
        HEADER[1],
        HEADER[2],
        HEADER[3],
        SET_FRAME_POINTER,
        PUSH_FRAME_POINTER_AND_LINK_REGISTER,
        END,
        NOP,
    ];

    pub(super) fn runtime_function(start: u32, unwind_info: u32) -> [u32; 2] {
        [start, unwind_info]
    }
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn RtlAddGrowableFunctionTable(
        table: *mut *mut c_void,
        functions: *const c_void,
        count: u32,
        capacity: u32,
        start: usize,
        end: usize,
    ) -> u32;
}

/// Once. The handler hears of each exception of the system that gets to such a frame. False if that cannot be arranged.
pub fn describe_frames(handler: ExceptionHandler) -> bool {
    let Some(pool) = pool::pool() else {
        return false;
    };
    let range = pool::address_range();
    let mut state = pool.state.lock();
    // Both are found by their distance from the start of the range.
    let Some(info) = pool.allocate(&mut state, GRANULE, GRANULE, Pool::MAX_CAPACITY) else {
        return false;
    };
    let Some(handler) = pool.veneer(&mut state, info, handler as usize) else {
        return false;
    };
    let mut bytes = [0; 12];
    bytes[..8].copy_from_slice(&format::UNWIND_INFO);
    bytes[8..].copy_from_slice(&((handler - range.start) as u32).to_le_bytes());
    // SAFETY: a new block, which is never freed.
    unsafe { pool::write(info, &bytes) };

    let functions = (0..range.len() as u32)
        .step_by(format::FUNCTION_SIZE as usize)
        .map(|start| format::runtime_function(start, (info - range.start) as u32));
    let functions = Vec::leak(functions.collect());
    let (count, mut table) = (functions.len() as u32, core::ptr::null_mut());
    // SAFETY: sorted entries that stay, for a range that is never unmapped.
    let status = unsafe {
        RtlAddGrowableFunctionTable(
            &raw mut table,
            functions.as_ptr().cast(),
            count,
            count,
            range.start,
            range.end,
        )
    };
    status == 0
}
