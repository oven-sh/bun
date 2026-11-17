//! Converts between `/` and `\`, and changes nothing else.

use std::borrow::Cow;

use bun_core::strings;

use crate::PathChar;

/// `\` becomes `/` on every platform.
#[inline]
pub fn slashes_to_posix_in_place<T: PathChar>(path: &mut [T]) {
    replace_in_place(path, T::from_u8(b'\\'), T::from_u8(b'/'));
}

/// `/` becomes `\` on every platform.
#[inline]
pub fn slashes_to_windows_in_place<T: PathChar>(path: &mut [T]) {
    replace_in_place(path, T::from_u8(b'/'), T::from_u8(b'\\'));
}

/// On Windows `\` becomes `/`.
#[inline]
pub fn platform_to_posix_in_place<T: PathChar>(path: &mut [T]) {
    if cfg!(windows) {
        slashes_to_posix_in_place(path);
    }
}

/// On Windows `/` becomes `\`.
#[inline]
pub fn posix_to_platform_in_place<T: PathChar>(path: &mut [T]) {
    if cfg!(windows) {
        slashes_to_windows_in_place(path);
    }
}

/// [`slashes_to_posix_in_place`] on a copy, if there is anything to replace.
#[inline]
pub fn slashes_to_posix(path: &[u8]) -> Cow<'_, [u8]> {
    if !strings::contains_char(path, b'\\') {
        return Cow::Borrowed(path);
    }
    let mut path = path.to_vec();
    slashes_to_posix_in_place(&mut path);
    Cow::Owned(path)
}

/// [`platform_to_posix_in_place`] on a copy, if there is anything to replace.
#[inline]
pub fn platform_to_posix(path: &[u8]) -> Cow<'_, [u8]> {
    if cfg!(windows) {
        slashes_to_posix(path)
    } else {
        Cow::Borrowed(path)
    }
}

/// [`posix_to_platform_in_place`] on a copy, if there is anything to replace.
#[inline]
pub fn posix_to_platform(path: &[u8]) -> Cow<'_, [u8]> {
    if cfg!(not(windows)) || !strings::contains_char(path, b'/') {
        return Cow::Borrowed(path);
    }
    let mut path = path.to_vec();
    slashes_to_windows_in_place(&mut path);
    Cow::Owned(path)
}

/// For a path in a file that may have been written on Windows. On POSIX `\` becomes `/`, unless the path starts with `/`.
#[inline]
pub fn windows_to_platform(path: &[u8]) -> Cow<'_, [u8]> {
    if cfg!(windows) || path.starts_with(b"/") {
        return Cow::Borrowed(path);
    }
    slashes_to_posix(path)
}

#[inline(always)]
fn replace_in_place<T: PathChar>(path: &mut [T], from: T, to: T) {
    // An unconditional store is what lets this be vectorized.
    for unit in path {
        *unit = if *unit == from { to } else { *unit };
    }
}
