use crate::{JSGlobalObject, JSValue, VM};
use bun_core as bstr;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for WebCore::DOMURL (C++ side).
    pub struct DOMURL;
}

// SAFETY: `DOMURL`/`VM`/`JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles; the
// error out-param is a `#[repr(u8)]` enum that C++ writes only with one of
// its values, and its `&mut` is exclusive for the call → `safe fn`.
unsafe extern "C" {
    safe fn WebCore__DOMURL__cast_(value: JSValue, vm: &VM) -> *mut DOMURL;
    safe fn WebCore__DOMURL__fileSystemPath(
        this: &DOMURL,
        error: &mut ToFileSystemPathError,
    ) -> bstr::String;
    safe fn Bun__createURIMalformedError(global: &JSGlobalObject) -> JSValue;
}

/// Mirrors `Bun::FileURLToPathError` in NodeURLHelpers.h.
#[repr(u8)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, thiserror::Error, strum::IntoStaticStr)]
pub enum ToFileSystemPathError {
    #[error("NotFileUrl")]
    NotFileUrl = 0,
    #[error("InvalidHost")]
    InvalidHost = 1,
    #[error("InvalidPath")]
    InvalidPath = 2,
    /// The percent-decoded path is not UTF-8.
    #[error("Undecodable")]
    Undecodable = 3,
}

/// Node's error for [`ToFileSystemPathError::Undecodable`]: `URIError: URI malformed`, with no `code`.
pub fn uri_malformed_error(global: &JSGlobalObject) -> JSValue {
    Bun__createURIMalformedError(global)
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
        let mut error = ToFileSystemPathError::NotFileUrl;
        let path = WebCore__DOMURL__fileSystemPath(self, &mut error);
        if path.is_dead() {
            return Err(error);
        }
        Ok(path)
    }
}
