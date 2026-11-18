use core::ffi::c_char;

use crate::Result;
use crate::error::Status;
use crate::ffi::{borrowed, call, open};

bun_opaque::opaque_ffi! { pub(crate) struct UEnumeration; }

icu_functions! {
    fn uenum_close(enumeration: *mut UEnumeration);
    fn uenum_next(enumeration: *mut UEnumeration, length: &mut i32, status: &mut Status) -> *const c_char;
}

icu_handle! {
    /// A list of ASCII identifiers.
    pub struct Enumeration(UEnumeration), uenum_close
}

impl Enumeration {
    pub(crate) fn open(
        function: impl FnOnce(&mut Status) -> *mut UEnumeration,
    ) -> Result<Enumeration> {
        open(function).map(Enumeration)
    }

    pub fn next(&mut self) -> Result<Option<&[u8]>> {
        let mut length = 0;
        // SAFETY: the enumeration is open.
        let item = call(|status| unsafe { uenum_next(self.0.as_ptr(), &mut length, status) })?;
        // SAFETY: `length` characters that last until the next call, which needs the borrow of `self` back.
        Ok((!item.is_null()).then(|| unsafe { borrowed(item.cast(), length) }))
    }
}
