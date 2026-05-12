use core::ffi::c_int;
use core::marker::{PhantomData, PhantomPinned};

use crate::{JSValue, VM};
use bun_core::{self as bstr, ZigString};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for WebCore::DOMURL (C++ side).
    pub struct DOMURL;
}

// TODO(port): move to jsc_sys
//
// `DOMURL`/`VM` are opaque `UnsafeCell`-backed ZST handles; `ZigString`/`c_int`
// out-params are plain `#[repr(C)]` PODs whose `&mut` is exclusive for the
// call → `safe fn`.
unsafe extern "C" {
    safe fn WebCore__DOMURL__cast_(value: JSValue, vm: &VM) -> *mut DOMURL;
    safe fn WebCore__DOMURL__fileSystemPath(this: &DOMURL, error_code: &mut c_int) -> bstr::String;
    // These two are referenced via `bun.cpp.*` in the Zig source.
    safe fn WebCore__DOMURL__href_(this: &DOMURL, out: &mut ZigString);
    safe fn WebCore__DOMURL__pathname_(this: &DOMURL, out: &mut ZigString);
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

bun_core::named_error_set!(ToFileSystemPathError);

impl DOMURL {
    pub fn cast_<'a>(value: JSValue, vm: &'a VM) -> Option<&'a mut DOMURL> {
        // TODO(port): lifetime — DOMURL is a GC-owned C++ cell; no Rust-expressible lifetime. Phase B revisit.
        // `DOMURL` is an `opaque_ffi!` ZST handle; `opaque_mut` is the
        // centralised non-null-ZST deref proof (zero-byte `&mut` cannot alias).
        let p = WebCore__DOMURL__cast_(value, vm);
        (!p.is_null()).then(|| DOMURL::opaque_mut(p))
    }

    pub fn cast<'a>(value: JSValue) -> Option<&'a mut DOMURL> {
        // SAFETY: VirtualMachine::get() returns the per-thread singleton; caller is on the JS thread.
        Self::cast_(
            value,
            crate::virtual_machine::VirtualMachine::get().global().vm(),
        )
    }

    pub fn href_(&mut self, out: &mut ZigString) {
        WebCore__DOMURL__href_(self, out)
    }

    pub fn href(&mut self) -> ZigString {
        let mut out = ZigString::EMPTY;
        self.href_(&mut out);
        out
    }

    pub fn file_system_path(&mut self) -> Result<bstr::String, ToFileSystemPathError> {
        let mut error_code: c_int = 0;
        let path = WebCore__DOMURL__fileSystemPath(self, &mut error_code);
        match error_code {
            1 => return Err(ToFileSystemPathError::InvalidHost),
            2 => return Err(ToFileSystemPathError::InvalidPath),
            3 => return Err(ToFileSystemPathError::NotFileUrl),
            _ => {}
        }
        debug_assert!(path.tag() != bun_core::Tag::Dead);
        Ok(path)
    }

    pub fn pathname_(&mut self, out: &mut ZigString) {
        WebCore__DOMURL__pathname_(self, out)
    }

    pub fn pathname(&mut self) -> ZigString {
        let mut out = ZigString::EMPTY;
        self.pathname_(&mut out);
        out
    }
}

// ported from: src/jsc/DOMURL.zig
