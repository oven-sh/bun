use core::ffi::c_int;

use crate::{JSValue, VM, WrapperGuard};
use bun_core as bstr;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for WebCore::DOMURL (C++ side).
    pub struct DOMURL;
}

// `DOMURL`/`VM` are opaque `UnsafeCell`-backed ZST handles; the `c_int`
// out-param is a plain `#[repr(C)]` POD whose `&mut` is exclusive for the
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
    pub fn cast_<'a>(value: &'a JSValue, vm: &VM) -> Option<WrapperGuard<'a, DOMURL>> {
        // SAFETY: a `JSDOMURL` holds a ref on what it wraps.
        unsafe { WrapperGuard::new(value, WebCore__DOMURL__cast_(*value, vm)) }
    }

    pub fn cast(value: &JSValue) -> Option<WrapperGuard<'_, DOMURL>> {
        Self::cast_(
            value,
            crate::virtual_machine::VirtualMachine::get().global().vm(),
        )
    }

    pub fn file_system_path(&self) -> Result<bstr::String, ToFileSystemPathError> {
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
