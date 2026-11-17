//! Portable text is a path in a file, a hash or a URL: any platform may have written it, and any may read it.

use std::borrow::Cow;

use bun_core::strings;

use crate::PathChar;
use crate::path_style::{Host, PathStyle as _, Posix, Windows};

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

/// The path that `text` means here. `\` is a separator, unless `text` starts with `/` on POSIX.
#[inline]
pub fn from_portable(text: &[u8]) -> Cow<'_, [u8]> {
    if cfg!(windows) || text.starts_with(b"/") {
        return Cow::Borrowed(text);
    }
    strings::replace_char(text, b'\\', b'/')
}

/// True for `/` and `\`.
#[inline(always)]
pub fn is_sep<C: PathChar>(unit: C) -> bool {
    Windows::is_sep(unit)
}

/// [`crate::is_absolute`] on any platform.
#[inline]
pub fn is_absolute(text: &[u8]) -> bool {
    Windows::is_absolute(text)
}

/// [`crate::climbs_out`] on any platform.
pub fn climbs_out(text: &[u8]) -> bool {
    Windows::climbs_out(text) || Posix::climbs_out(text)
}

/// Whether a component is `..` on any platform. Stricter than [`climbs_out`], which a symlink can defeat.
pub fn has_dot_dot(text: &[u8]) -> bool {
    Windows::components(text).any(|name| name == b"..")
}
