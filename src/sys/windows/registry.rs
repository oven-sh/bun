//! Read access to values under `HKEY_LOCAL_MACHINE`.

use core::ffi::c_void;
use core::ptr;

use bun_core::{AnyBitPattern, WStr};

use super::{DWORD, HANDLE, LPCWSTR};
use crate::windows_format::wtf16;

type LSTATUS = i32;

#[link(name = "advapi32")]
unsafe extern "system" {
    fn RegOpenKeyExW(
        hKey: HANDLE,
        lpSubKey: LPCWSTR,
        ulOptions: DWORD,
        samDesired: DWORD,
        phkResult: *mut HANDLE,
    ) -> LSTATUS;
    fn RegGetValueW(
        hkey: HANDLE,
        lpSubKey: LPCWSTR,
        lpValue: LPCWSTR,
        dwFlags: DWORD,
        pdwType: *mut DWORD,
        pvData: *mut c_void,
        pcbData: *mut DWORD,
    ) -> LSTATUS;
    fn RegCloseKey(hKey: HANDLE) -> LSTATUS;
}

const HKEY_LOCAL_MACHINE: HANDLE = ptr::without_provenance_mut(0xFFFF_FFFF_8000_0002);
const KEY_QUERY_VALUE: DWORD = 0x01;
const RRF_RT_REG_SZ: DWORD = 0x02;
const RRF_RT_DWORD: DWORD = 0x18;

pub(super) struct Key(HANDLE);

impl Key {
    pub(super) fn open(path: &WStr) -> Option<Self> {
        let mut key = ptr::null_mut();
        // SAFETY: `path` is NUL-terminated, and `key` is a valid out-param.
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                path.as_ptr(),
                0,
                KEY_QUERY_VALUE,
                &raw mut key,
            )
        };
        (status == 0).then(|| Self(key))
    }

    fn query_value<T: AnyBitPattern>(&self, name: &WStr, type_flags: DWORD) -> Option<T> {
        let mut value: T = bun_core::ffi::zeroed();
        let mut size = size_of::<T>() as DWORD;
        // SAFETY: the key is open, `name` is NUL-terminated, and `value` is writable for `size` bytes.
        let status = unsafe {
            RegGetValueW(
                self.0,
                ptr::null(),
                name.as_ptr(),
                type_flags,
                ptr::null_mut(),
                (&raw mut value).cast(),
                &raw mut size,
            )
        };
        (status == 0).then_some(value)
    }

    pub(super) fn query_dword(&self, name: &WStr) -> Option<u32> {
        self.query_value(name, RRF_RT_DWORD)
    }

    /// Expands a `REG_EXPAND_SZ`.
    pub(super) fn query_wide_string(&self, name: &WStr) -> Option<Vec<u16>> {
        let value: [u16; 260] = self.query_value(name, RRF_RT_REG_SZ)?;
        Some(value.into_iter().take_while(|&unit| unit != 0).collect())
    }

    /// WTF-8.
    pub(super) fn query_string(&self, name: &WStr) -> Option<Vec<u8>> {
        let value = self.query_wide_string(name)?;
        Some(wtf16::decode_until_nul(value.into_iter()))
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the handle is from `RegOpenKeyExW` and is closed only here.
        unsafe { RegCloseKey(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use bun_core::wstr;

    use super::*;

    #[test]
    fn queries_succeed_only_for_existing_values() {
        let path = wstr!("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0");
        let key = Key::open(path).unwrap();
        assert!(key.query_dword(wstr!("~MHz")).is_some());
        assert!(key.query_string(wstr!("Identifier")).is_some());
        assert_eq!(key.query_dword(wstr!("missing")), None);
        assert_eq!(key.query_string(wstr!("missing")), None);
        assert!(Key::open(wstr!("HARDWARE\\missing")).is_none());
    }
}
