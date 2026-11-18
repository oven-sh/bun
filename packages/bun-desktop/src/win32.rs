//! What is used of the Windows API. A handle is a number, and 0 is none.

pub mod com;
mod constants;
mod functions;
mod interfaces;
mod structures;

use std::ffi::{OsStr, c_void};
use std::marker::PhantomData;
use std::os::windows::ffi::OsStrExt as _;

pub use constants::*;
pub use functions::*;
pub use interfaces::*;
pub use structures::*;

pub type Handle = isize;
pub type Bool = i32;

/// UTF-16 with a zero at the end.
pub struct Wide(Vec<u16>);

/// The address of that, or null.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct Str<'a>(*const u16, PhantomData<&'a u16>);

impl Wide {
    pub fn new(text: impl AsRef<OsStr>) -> Wide {
        Wide::of(text.as_ref().encode_wide())
    }

    pub fn of(units: impl IntoIterator<Item = u16>) -> Wide {
        Wide(units.into_iter().chain([0]).collect())
    }

    pub fn str(&self) -> Str<'_> {
        Str(self.0.as_ptr(), PhantomData)
    }

    pub fn as_ptr(&self) -> *const u16 {
        self.0.as_ptr()
    }

    /// With the zero.
    pub fn bytes(&self) -> Vec<u8> {
        self.0.iter().flat_map(|it| it.to_le_bytes()).collect()
    }
}

impl Str<'_> {
    pub const NULL: Str<'static> = Str(std::ptr::null(), PhantomData);

    /// `MAKEINTRESOURCE`
    pub const fn numbered(id: u16) -> Str<'static> {
        Str(std::ptr::without_provenance(id as usize), PhantomData)
    }

    pub const fn literal(units: &'static [u16]) -> Str<'static> {
        assert!(units[units.len() - 1] == 0);
        Str(units.as_ptr(), PhantomData)
    }

    /// # Safety
    /// As for `string_at`.
    pub unsafe fn at<'a>(start: *const u16) -> Str<'a> {
        Str(start, PhantomData)
    }

    pub fn text(self) -> String {
        // SAFETY: what this type stands for.
        unsafe { string_at(self.0) }
    }
}

impl Default for Str<'_> {
    fn default() -> Self {
        Str::NULL
    }
}

/// An ASCII literal as a `Str`.
macro_rules! wide {
    ($text:literal) => {
        const {
            $crate::win32::Str::literal(
                &const {
                    let (mut units, mut at) = ([0u16; $text.len() + 1], 0);
                    while at < $text.len() {
                        units[at] = $text.as_bytes()[at] as u16;
                        at += 1;
                    }
                    units
                },
            )
        }
    };
}

pub(crate) use wide;

/// # Safety
/// It is null, or there is a zero at the end.
pub unsafe fn string_at(start: *const u16) -> String {
    if start.is_null() {
        return String::new();
    }
    // SAFETY: the caller's contract.
    unsafe {
        String::from_utf16_lossy(std::slice::from_raw_parts(
            start,
            (0..).take_while(|it| *start.add(*it) != 0).count(),
        ))
    }
}

/// Up to the first zero.
pub fn string_in(units: &[u16]) -> String {
    String::from_utf16_lossy(units.split(|it| *it == 0).next().unwrap_or_default())
}

/// As much as fits, in whole characters.
pub fn copy_into(field: &mut [u16], text: &str) {
    let (mut at, room) = (0, field.len() - 1);
    for character in text.chars() {
        if at + character.len_utf16() > room {
            break;
        }
        at += character.encode_utf16(&mut field[at..]).len();
    }
    field[at..].fill(0);
}

pub fn units_in(bytes: &[u8]) -> Vec<u16> {
    bytes
        .as_chunks()
        .0
        .iter()
        .map(|it| u16::from_le_bytes(*it))
        .collect()
}

pub fn succeeded(result: Bool) -> std::io::Result<()> {
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn low(word: impl TryInto<i64>) -> i32 {
    (word.try_into().unwrap_or(0) as i16).into()
}

pub fn high(word: impl TryInto<i64>) -> i32 {
    ((word.try_into().unwrap_or(0) >> 16) as i16).into()
}

pub fn pair(low: i32, high: i32) -> isize {
    (u32::from(low as u16) | u32::from(high as u16) << 16) as isize
}

/// This library.
pub fn module() -> Handle {
    unsafe extern "C" {
        static __ImageBase: u8;
    }
    (&raw const __ImageBase).addr() as Handle
}

pub fn system_parameter<T>(which: u32, mut value: T) -> T {
    // SAFETY: the callers pass what the parameter is read into.
    unsafe {
        SystemParametersInfoW(
            which,
            size_of::<T>() as u32,
            (&raw mut value).cast::<c_void>(),
            0,
        )
    };
    value
}

pub fn language_of_user() -> String {
    let mut name = [0; 85];
    // SAFETY: the buffer with its length.
    unsafe { GetUserDefaultLocaleName(name.as_mut_ptr(), name.len() as i32) };
    string_in(&name)
}

pub fn languages_of_user() -> Vec<String> {
    registry::list(
        wide!("Control Panel\\International\\User Profile"),
        wide!("Languages"),
    )
}

pub mod registry {
    use super::*;

    pub fn text(root: Handle, key: Str, name: Str) -> String {
        let (mut value, mut size) = ([0u16; 256], 512);
        // SAFETY: a buffer of that size.
        unsafe {
            RegGetValueW(
                root,
                key,
                name,
                RRF_RT_REG_SZ,
                None,
                value.as_mut_ptr().cast(),
                &mut size,
            )
        };
        string_in(&value)
    }

    pub fn exists(root: Handle, key: Str, name: Str) -> bool {
        // SAFETY: only the size is asked for.
        unsafe {
            RegGetValueW(
                root,
                key,
                name,
                RRF_RT_REG_SZ,
                None,
                std::ptr::null_mut(),
                &mut 0,
            ) == 0
        }
    }

    pub fn list(key: Str, name: Str) -> Vec<String> {
        let (mut value, mut size) = ([0u16; 512], 1024);
        // SAFETY: a buffer of that size.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key,
                name,
                RRF_RT_REG_MULTI_SZ,
                None,
                value.as_mut_ptr().cast(),
                &mut size,
            )
        };
        value
            .split(|it| *it == 0)
            .take_while(|it| status == 0 && !it.is_empty())
            .map(String::from_utf16_lossy)
            .collect()
    }

    pub fn number(key: Str, name: Str) -> Option<u32> {
        let (mut value, mut size) = (0u32, 4);
        // SAFETY: a buffer of that size.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key,
                name,
                RRF_RT_REG_DWORD,
                None,
                (&raw mut value).cast(),
                &mut size,
            )
        };
        (status == 0).then_some(value)
    }

    pub fn set_text(key: Str, name: Str, value: &str) -> std::io::Result<()> {
        let bytes = Wide::new(value).bytes();
        // SAFETY: as above.
        match unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key,
                name,
                REG_SZ,
                bytes.as_ptr().cast(),
                bytes.len() as u32,
            )
        } {
            0 => Ok(()),
            error => Err(std::io::Error::from_raw_os_error(error)),
        }
    }
}
