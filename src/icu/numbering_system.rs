//! Sets of digits, and rules that spell numbers.

use core::ffi::{CStr, c_char};

use crate::argument::locale_id;
use crate::enumeration::UEnumeration;
use crate::error::Status;
use crate::ffi::open;
use crate::{Enumeration, Result};

bun_opaque::opaque_ffi! { struct UNumberingSystem; }

icu_functions! {
    fn unumsys_open(locale: *const c_char, status: &mut Status) -> *mut UNumberingSystem;
    fn unumsys_openByName(name: *const c_char, status: &mut Status) -> *mut UNumberingSystem;
    fn unumsys_close(system: *mut UNumberingSystem);
    fn unumsys_openAvailableNames(status: &mut Status) -> *mut UEnumeration;
    fn unumsys_getName(system: *const UNumberingSystem) -> *const c_char;
    fn unumsys_isAlgorithmic(system: *const UNumberingSystem) -> i8;
}

icu_handle! {
    pub struct NumberingSystem(UNumberingSystem), unumsys_close
}

impl NumberingSystem {
    /// The one that `locale` names or prefers.
    pub fn for_locale(locale: &CStr) -> Result<NumberingSystem> {
        let locale = locale_id(locale)?;
        // SAFETY: `locale` is terminated.
        open(|status| unsafe { unumsys_open(locale, status) }).map(NumberingSystem)
    }

    pub fn by_name(name: &CStr) -> Result<NumberingSystem> {
        // SAFETY: `name` is terminated.
        open(|status| unsafe { unumsys_openByName(name.as_ptr(), status) }).map(NumberingSystem)
    }

    pub fn names() -> Result<Enumeration> {
        // SAFETY: it takes nothing but the status.
        Enumeration::open(|status| unsafe { unumsys_openAvailableNames(status) })
    }

    pub fn name(&self) -> &[u8] {
        // SAFETY: the object is open and holds its terminated name.
        unsafe { CStr::from_ptr(unumsys_getName(self.0.as_ptr())) }.to_bytes()
    }

    /// Whether it is more than a set of positional digits.
    pub fn is_algorithmic(&self) -> bool {
        // SAFETY: the object is open.
        unsafe { unumsys_isAlgorithmic(self.0.as_ptr()) != 0 }
    }
}
