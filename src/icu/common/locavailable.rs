//! The available locales, as listed in `res_index.res`. ICU4C: locavailable.cpp

use crate::common::resource::ResourceTable;
use crate::common::umutex::OnceBox;
use crate::common::uresdata::DataKey;
use crate::common::uresimp::ures_open_direct;
use crate::common::utypes::*;
use std::ffi::CStr;

fn installed_locales() -> Option<&'static ResourceTable> {
    static INSTALLED: OnceBox<Result<ResourceTable, UErrorCode>> = OnceBox::new();
    let load = || {
        let index = ures_open_direct(None, b"res_index")?;
        index.find_by_key(b"InstalledLocales")?.get_table()
    };
    INSTALLED.get_or_init_caching_err(load).ok()
}

pub(crate) fn uloc_count_available() -> usize {
    installed_locales().map_or(0, ResourceTable::get_size)
}

pub(crate) fn uloc_get_available(offset: usize) -> Option<&'static CStr> {
    installed_locales()?.key_at(offset).map(DataKey::as_c_str)
}
