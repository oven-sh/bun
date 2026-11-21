//! `unicode/uversion.h`, `unicode/icudataver.h`, `unicode/ulocdata.h`

use crate::capi::ffi::{ErrorCode, Out};
use crate::common::uresimp::ures_open_direct;
use bun_icu_macros::capi;

type UVersionInfo = [u8; 4];

/// Stores a version like "48.1".
fn store_version(bundle: &[u8], key: &[u8], version: Out<'_, UVersionInfo>, status: ErrorCode<'_>) {
    status.run((), |_| {
        let text = ures_open_direct(None, bundle)?.get_string_by_key(key)?;
        let mut units = text.iter();
        let fields = std::array::from_fn(|_| {
            let digits = units.by_ref().take_while(|&unit| unit != u16::from(b'.'));
            digits.fold(0u8, |field, digit| {
                field.wrapping_mul(10).wrapping_add(digit as u8 & 0xf)
            })
        });
        version.set(fields);
        Ok(())
    })
}

#[capi]
fn u_getVersion(version_array: Out<UVersionInfo>) {
    version_array.set([79, 1, 0, 0])
}

#[capi]
fn u_getDataVersion(data_version_fillin: Out<UVersionInfo>, status: ErrorCode) {
    store_version(b"icuver", b"DataVersion", data_version_fillin, status)
}

#[capi]
fn ulocdata_getCLDRVersion(version_array: Out<UVersionInfo>, status: ErrorCode) {
    store_version(b"supplementalData", b"cldrVersion", version_array, status)
}
