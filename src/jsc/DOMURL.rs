use core::ffi::c_int;
use core::marker::{PhantomData, PhantomPinned};

use crate::{JSValue, VM};
use bun_string::{self as bstr, ZigString};

/// Opaque FFI handle for WebCore::DOMURL (C++ side).
#[repr(C)]
pub struct DOMURL {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn WebCore__DOMURL__cast_(value: JSValue, vm: *mut VM) -> *mut DOMURL;
    fn WebCore__DOMURL__fileSystemPath(this: *mut DOMURL, error_code: *mut c_int) -> bstr::String;
    // These two are referenced via `bun.cpp.*` in the Zig source.
    fn WebCore__DOMURL__href_(this: *mut DOMURL, out: *mut ZigString);
    fn WebCore__DOMURL__pathname_(this: *mut DOMURL, out: *mut ZigString);
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, thiserror::Error, strum::IntoStaticStr)]
pub enum ToFileSystemPathError {
    #[error("NotFileUrl")]
    NotFileUrl,
    #[error("InvalidPath")]
    InvalidPath,
    #[error("InvalidHost")]
    InvalidHost,
}

impl From<ToFileSystemPathError> for bun_core::Error {
    fn from(e: ToFileSystemPathError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

impl DOMURL {
    pub fn cast_<'a>(value: JSValue, vm: &'a VM) -> Option<&'a mut DOMURL> {
        // TODO(port): lifetime — DOMURL is a GC-owned C++ cell; no Rust-expressible lifetime. Phase B revisit.
        // SAFETY: FFI call; `vm` is a live JSC VM borrow whose opaque bytes are
        // wrapped in `UnsafeCell`, so `VM::as_mut_ptr` yields a `*mut VM` with
        // write provenance (no `&T as *const T as *mut T` laundering). The C++
        // side ignores the `vm` argument (`WebCoreCast` only inspects `value`).
        // Returned pointer is null or a valid GC cell uniquely materialized here.
        unsafe { WebCore__DOMURL__cast_(value, vm.as_mut_ptr()).as_mut() }
    }

    pub fn cast<'a>(value: JSValue) -> Option<&'a mut DOMURL> {
        // SAFETY: VirtualMachine::get() returns the per-thread singleton; caller is on the JS thread.
        Self::cast_(value, crate::virtual_machine::VirtualMachine::get().global().vm())
    }

    pub fn href_(&mut self, out: &mut ZigString) {
        // SAFETY: self is a valid DOMURL handle obtained from cast/cast_.
        unsafe { WebCore__DOMURL__href_(self, out) }
    }

    pub fn href(&mut self) -> ZigString {
        let mut out = ZigString::EMPTY;
        self.href_(&mut out);
        out
    }

    pub fn file_system_path(&mut self) -> Result<bstr::String, ToFileSystemPathError> {
        let mut error_code: c_int = 0;
        // SAFETY: self is a valid DOMURL handle; error_code is a valid out-param.
        let path = unsafe { WebCore__DOMURL__fileSystemPath(self, &raw mut error_code) };
        match error_code {
            1 => return Err(ToFileSystemPathError::InvalidHost),
            2 => return Err(ToFileSystemPathError::InvalidPath),
            3 => return Err(ToFileSystemPathError::NotFileUrl),
            _ => {}
        }
        debug_assert!(path.tag() != bun_string::Tag::Dead);
        Ok(path)
    }

    pub fn pathname_(&mut self, out: &mut ZigString) {
        // SAFETY: self is a valid DOMURL handle obtained from cast/cast_.
        unsafe { WebCore__DOMURL__pathname_(self, out) }
    }

    pub fn pathname(&mut self) -> ZigString {
        let mut out = ZigString::EMPTY;
        self.pathname_(&mut out);
        out
    }
}

// ported from: src/jsc/DOMURL.zig
