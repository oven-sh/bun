//! The available locales, as listed in `res_index.res`. ICU4C: locavailable.cpp

use crate::common::resource::{ResourceTable, ResourceValue};
use crate::common::umutex::OnceBox;
use crate::common::uresdata::DataKey;
use crate::common::uresimp::{ures_get_all_items_with_fallback, ures_open_direct};
use crate::common::utypes::*;
use std::ffi::CStr;

/// The list of an ancestor of the bundle replaces the list of the bundle.
fn load() -> Result<ResourceTable, UErrorCode> {
    let mut installed = None;
    let mut sink = |root: &ResourceValue| {
        for (key, value) in root.get_table()?.iter() {
            match key {
                b"InstalledLocales" => installed = Some(value.get_table()?),
                b"AliasLocales" => _ = value.get_table()?,
                _ => {}
            }
        }
        Ok(())
    };
    ures_get_all_items_with_fallback(&ures_open_direct(None, b"res_index")?, b"", &mut sink)?;
    installed.ok_or(U_MISSING_RESOURCE_ERROR)
}

fn installed_locales() -> Option<&'static ResourceTable> {
    static INSTALLED: OnceBox<Result<ResourceTable, UErrorCode>> = OnceBox::new();
    INSTALLED.get_or_init_caching_err(load).ok()
}

pub(crate) fn uloc_count_available() -> usize {
    installed_locales().map_or(0, ResourceTable::get_size)
}

pub(crate) fn uloc_get_available(offset: usize) -> Option<&'static CStr> {
    installed_locales()?.key_at(offset).map(DataKey::as_c_str)
}
