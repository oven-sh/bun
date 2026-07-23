use core::ffi::c_int;

use crate::{JSValue, VM};
use bun_core as bstr;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for WebCore::DOMURL (C++ side).
    pub struct DOMURL;
}

// `DOMURL`/`VM` are opaque `UnsafeCell`-backed ZST handles; `ZigString`/`c_int`
// out-params are plain `#[repr(C)]` PODs whose `&mut` is exclusive for the
// call → `safe fn`.
unsafe extern "C" {
    safe fn WebCore__DOMURL__cast_(value: JSValue, vm: &VM) -> *mut DOMURL;
    safe fn WebCore__DOMURL__fileSystemPath(this: &DOMURL, error_code: &mut c_int) -> bstr::String;
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

impl DOMURL {
    pub fn cast_<'a>(value: JSValue, vm: &'a VM) -> Option<&'a mut DOMURL> {
        // DOMURL is a GC-owned C++ cell; the returned reference is only valid
        // while `value` stays alive (e.g. stack-rooted for the conservative GC
        // scan) — the borrow on `vm` does not capture that.
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
}
