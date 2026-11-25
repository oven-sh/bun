//! Portable text is a path in a file, a hash or a URL: any platform may have written it, and any may read it.

use std::borrow::Cow;

use bun_core::strings;

use crate::PathChar;
use crate::path_style::{Host, PathStyle as _, Windows};

/// The text to save, hash or print for `path`. Its separators are `/`.
#[inline]
pub fn to_portable(path: &[u8]) -> Cow<'_, [u8]> {
    if cfg!(not(windows)) {
        return Cow::Borrowed(path);
    }
    strings::replace_char(path, b'\\', b'/')
}

/// See [`to_portable`].
#[inline]
pub fn to_portable_in_place<C: PathChar>(path: &mut [C]) {
    Host::to_portable_in_place(path);
}

/// The path that `text` means here. On POSIX `\` is a separator unless `text` starts with `/`, and `\a` is `./a`.
#[inline]
pub fn from_portable(text: &[u8]) -> Cow<'_, [u8]> {
    let mut path = from_portable_rooted(text);
    if let Cow::Owned(converted) = &mut path
        && converted.starts_with(b"/")
    {
        converted.insert(0, b'.');
    }
    path
}

/// [`from_portable`], but `\a` is `/a`. Not for text that has to stay inside a directory.
#[inline]
pub fn from_portable_rooted(text: &[u8]) -> Cow<'_, [u8]> {
    if cfg!(windows) || text.starts_with(b"/") {
        return Cow::Borrowed(text);
    }
    strings::replace_char(text, b'\\', b'/')
}

/// [`from_portable`] for `.\a`. `a\b` stays, since `a/b` would name a package, and `\\a` too: `//a` is a URL.
#[inline]
pub fn from_portable_specifier(text: &[u8]) -> Cow<'_, [u8]> {
    match text {
        [b'.', ..] => from_portable(text),
        _ => Cow::Borrowed(text),
    }
}

/// True for `/` and `\`.
#[inline(always)]
pub fn is_sep<C: PathChar>(unit: C) -> bool {
    Windows::is_sep(unit)
}

/// [`crate::is_absolute`], or `\a` or `C:/a` on any platform.
#[inline]
pub fn is_absolute(text: &[u8]) -> bool {
    Host::is_absolute(text) || matches!(*text, [b'\\', ..] | [_, b':', b'/' | b'\\', ..])
}

/// [`crate::climbs_out`] before or after [`from_portable`]. True for a NUL too: the OS opens `..` for `..\0a`.
pub fn climbs_out(text: &[u8]) -> bool {
    Host::climbs_out(text)
        || Host::climbs_out(&from_portable(text))
        || strings::contains_char(text, 0)
}

/// Whether there is a `..` between separators, or after a drive on Windows. It does not test for a root.
pub fn has_dot_dot(text: &[u8]) -> bool {
    let is_dot_dot = |name: &[u8]| name == b"..";
    strings::split_any(text, b"/\\").any(is_dot_dot)
        || (cfg!(windows) && Host::components(text).any(is_dot_dot))
}
