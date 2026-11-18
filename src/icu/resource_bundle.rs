//! The typed trees in which ICU stores its data.

use core::ffi::{CStr, c_char};
use core::ptr;

use crate::argument::locale_id;
use crate::error::Status;
use crate::ffi::{adopt, call, open};
use crate::{Error, Result};

bun_opaque::opaque_ffi! { struct UResourceBundle; }

icu_functions! {
    fn ures_open(package: *const c_char, locale: *const c_char, status: &mut Status) -> *mut UResourceBundle;
    fn ures_openDirect(package: *const c_char, name: *const c_char, status: &mut Status) -> *mut UResourceBundle;
    fn ures_close(bundle: *mut UResourceBundle);
    fn ures_getSize(bundle: *const UResourceBundle) -> i32;
    fn ures_getByKey(
        bundle: *const UResourceBundle,
        key: *const c_char,
        reuse: *mut UResourceBundle,
        status: &mut Status,
    ) -> *mut UResourceBundle;
    fn ures_getByIndex(bundle: *const UResourceBundle, index: i32, reuse: *mut UResourceBundle, status: &mut Status) -> *mut UResourceBundle;
    fn ures_getInt(bundle: *const UResourceBundle, status: &mut Status) -> i32;
    fn ures_getIntVector(bundle: *const UResourceBundle, length: &mut i32, status: &mut Status) -> *const i32;
    fn ures_getBinary(bundle: *const UResourceBundle, length: &mut i32, status: &mut Status) -> *const u8;
    fn ures_getString(bundle: *const UResourceBundle, length: &mut i32, status: &mut Status) -> *const u16;
    fn ures_getStringByKey(bundle: *const UResourceBundle, key: *const c_char, length: &mut i32, status: &mut Status) -> *const u16;
    fn ures_getStringByIndex(bundle: *const UResourceBundle, index: i32, length: &mut i32, status: &mut Status) -> *const u16;
}

icu_handle! {
    /// A node of a tree. It keeps the data loaded by itself, so it can outlive its parent.
    pub struct ResourceBundle(UResourceBundle), ures_close
}

// SAFETY: what takes `&self` only reads the node, and ICU counts the users of the data under a lock.
unsafe impl Sync for ResourceBundle {}

fn position(index: usize) -> Result<i32> {
    i32::try_from(index).map_err(|_| Error::MISSING_RESOURCE)
}

impl ResourceBundle {
    /// The root of the tree of a locale, which falls back to those of its parents for a key that it lacks.
    pub fn open(locale: &CStr) -> Result<ResourceBundle> {
        let locale = locale_id(locale)?;
        // SAFETY: `locale` is terminated, and no package means the data of ICU itself.
        open(|status| unsafe { ures_open(ptr::null(), locale, status) }).map(ResourceBundle)
    }

    /// The root of the tree of this name, with no fallback to another.
    pub fn open_direct(name: &CStr) -> Result<ResourceBundle> {
        // SAFETY: `name` is terminated, and no package means the data of ICU itself.
        open(|status| unsafe { ures_openDirect(ptr::null(), name.as_ptr(), status) })
            .map(ResourceBundle)
    }

    /// The names of time zones that `locale` does not share with its parents.
    pub fn open_zone_names(locale: &CStr) -> Result<ResourceBundle> {
        let locale = locale_id(locale)?;
        // SAFETY: both strings are terminated, and the first names a part of the data of ICU itself.
        open(|status| unsafe { ures_openDirect(c"ICUDATA-zone".as_ptr(), locale, status) })
            .map(ResourceBundle)
    }

    /// Of a table or an array.
    pub fn item_count(&self) -> usize {
        // SAFETY: the bundle is open.
        usize::try_from(unsafe { ures_getSize(self.0.as_ptr()) }).unwrap_or(0)
    }

    pub fn by_key(&self, key: &CStr) -> Result<ResourceBundle> {
        adopt(
            // SAFETY: the bundle is open and `key` is terminated.
            |status| unsafe {
                ures_getByKey(self.0.as_ptr(), key.as_ptr(), ptr::null_mut(), status)
            },
            ResourceBundle,
        )
    }

    pub fn by_index(&self, index: usize) -> Result<ResourceBundle> {
        let index = position(index)?;
        adopt(
            // SAFETY: the bundle is open, and ICU checks the range of `index`.
            |status| unsafe { ures_getByIndex(self.0.as_ptr(), index, ptr::null_mut(), status) },
            ResourceBundle,
        )
    }

    pub fn int(&self) -> Result<i32> {
        // SAFETY: the bundle is open.
        call(|status| unsafe { ures_getInt(self.0.as_ptr(), status) })
    }

    pub fn int_vector(&self) -> Result<&[i32]> {
        // SAFETY: the bundle is open, and the function returns its data.
        unsafe { self.data(|bundle, length, status| ures_getIntVector(bundle, length, status)) }
    }

    pub fn binary(&self) -> Result<&[u8]> {
        // SAFETY: the bundle is open, and the function returns its data.
        unsafe { self.data(|bundle, length, status| ures_getBinary(bundle, length, status)) }
    }

    pub fn string(&self) -> Result<&[u16]> {
        // SAFETY: the bundle is open, and the function returns its data.
        unsafe { self.data(|bundle, length, status| ures_getString(bundle, length, status)) }
    }

    pub fn string_by_key(&self, key: &CStr) -> Result<&[u16]> {
        // SAFETY: the bundle is open, `key` is terminated, and the function returns data of the bundle.
        unsafe {
            self.data(|bundle, length, status| {
                ures_getStringByKey(bundle, key.as_ptr(), length, status)
            })
        }
    }

    pub fn string_at(&self, index: usize) -> Result<&[u16]> {
        let index = position(index)?;
        // SAFETY: the bundle is open, ICU checks the range of `index`, and the function returns data of the bundle.
        unsafe {
            self.data(|bundle, length, status| ures_getStringByIndex(bundle, index, length, status))
        }
    }

    /// # Safety
    /// `function` returns null, or as many items as the length it writes, which last as long as the bundle.
    unsafe fn data<T>(
        &self,
        function: impl FnOnce(*const UResourceBundle, &mut i32, &mut Status) -> *const T,
    ) -> Result<&[T]> {
        let mut length = 0;
        let items = call(|status| function(self.0.as_ptr(), &mut length, status))?;
        if items.is_null() {
            return Err(Error::RESOURCE_TYPE_MISMATCH);
        }
        let length = usize::try_from(length).unwrap_or(0);
        // SAFETY: the caller's.
        Ok(unsafe { core::slice::from_raw_parts(items, length) })
    }
}
