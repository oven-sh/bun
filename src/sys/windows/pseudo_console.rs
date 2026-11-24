//! ConPTY.

use core::ptr;
use std::os::windows::io::{AsRawHandle as _, OwnedHandle};

use bun_windows_sys::externs;

use super::{COORD, HANDLE, HPCON, HRESULT, INVALID_HANDLE_VALUE};

/// What an `HPCON` points to: "part of an ABI shared with the rest of the operating system" (microsoft/terminal, `winconpty.h`).
#[repr(C)]
struct Handles {
    signal: HANDLE,
    reference: HANDLE,
    process: HANDLE,
}

/// Stays open if it is dropped, since [`close`](Self::close) can block.
pub struct PseudoConsole(HPCON);

// SAFETY: it belongs to no thread.
unsafe impl Send for PseudoConsole {}

impl PseudoConsole {
    /// It duplicates both handles.
    pub fn new(size: COORD, input: &OwnedHandle, output: &OwnedHandle) -> Option<Self> {
        let (input, output) = (input.as_raw_handle(), output.as_raw_handle());
        let mut console = ptr::null_mut();
        // SAFETY: it writes `console`.
        let result =
            unsafe { externs::CreatePseudoConsole(size, input, output, 0, &raw mut console) };
        (result >= 0).then_some(Self(console))
    }

    pub fn as_raw(&self) -> HPCON {
        self.0
    }

    pub fn resize(&self, size: COORD) -> HRESULT {
        // SAFETY: it is open.
        unsafe { externs::ResizePseudoConsole(self.0, size) }
    }

    /// `ReleasePseudoConsole`, which kernel32 has only since Windows 11 24H2.
    pub fn release(&self) {
        let handles = self.0.cast::<Handles>();
        // SAFETY: it is open, `Self` is not `Sync`, and `ClosePseudoConsole` skips a null handle.
        unsafe {
            let reference = (*handles).reference;
            if !reference.is_null() && reference != INVALID_HANDLE_VALUE {
                externs::CloseHandle(reference);
                (*handles).reference = ptr::null_mut();
            }
        }
    }

    /// Before Windows 11 24H2 it returns when the output has been read.
    pub fn close(self) {
        // SAFETY: it is open, and `self` is gone afterwards.
        unsafe { externs::ClosePseudoConsole(self.0) };
    }
}
