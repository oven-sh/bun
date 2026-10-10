use core::ffi::c_int;

use crate::{ErrorCode, JSGlobalObject, JSValue, JsResult, VM};
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

    /// [`file_system_path`](Self::file_system_path) that throws `fileURLToPath()`'s errors for a non-`file:` or empty path.
    pub fn file_system_path_for_js(&mut self, global: &JSGlobalObject) -> JsResult<bstr::String> {
        let code = match self.file_system_path() {
            Ok(path) if !path.is_empty() => return Ok(path),
            Ok(_) => ErrorCode::INVALID_ARG_VALUE,
            Err(ToFileSystemPathError::NotFileUrl) => ErrorCode::INVALID_URL_SCHEME,
            Err(ToFileSystemPathError::InvalidPath) => ErrorCode::INVALID_FILE_URL_PATH,
            Err(ToFileSystemPathError::InvalidHost) => ErrorCode::INVALID_FILE_URL_HOST,
        };
        Err(global
            .err(code, format_args!("URL must be a non-empty \"file:\" path"))
            .throw())
    }
}
