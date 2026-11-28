//! Bytes that `utf8.rs` has checked become text.

use crate::utf8::Check;
use crate::{B64, Isa, Simd, WithToken};
use core::str::Utf8Error;

/// An iterator over all whole blocks of 64 bytes of a slice, which checks that they are UTF-8 while they are in registers.
/// See [`Over::utf8`](crate::Over::utf8).
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let bytes = "é\n".repeat(50).into_bytes();
/// let mut text = over(&bytes).utf8();
/// let mut lines = 0;
/// for v in &mut text {
///     lines += v.simd_eq(b'\n').count();
/// }
/// lines += over(text.rest()).count(|v| v.simd_eq(b'\n'));
/// assert_eq!((lines, text.finish().unwrap().chars().count()), (50, 100));
/// # } example()
/// ```
pub struct Utf8<'a, S: Isa> {
    all: &'a [u8],
    /// `check` has seen what comes before this in `all`.
    rest: &'a [u8],
    check: Check<S>,
    s: S,
}

impl<'a, S: Isa> Utf8<'a, S> {
    #[inline(always)]
    pub(crate) fn new(s: S, all: &'a [u8]) -> Self {
        let all = crate::rolled::slice(all);
        Self { all, rest: all, check: Check::new(s), s }
    }
    /// What the iterator has not returned.
    #[inline(always)]
    pub fn rest(&self) -> &'a [u8] {
        crate::rolled::slice(self.rest)
    }
    /// Checks the rest, and returns the whole slice.
    #[inline(always)]
    pub fn finish(self) -> Result<&'a str, Utf8Error> {
        let all = self.all;
        or_in_core(self.checked(), all)
    }
    #[inline(always)]
    fn checked(self) -> Option<&'a str> {
        if !self.check.ends_with(self.rest) {
            return None;
        }
        // SAFETY: the check has seen all of it, in order.
        #[allow(unsafe_code)]
        Some(unsafe { core::str::from_utf8_unchecked(self.all) })
    }
}

#[inline(always)]
fn or_in_core<'a>(text: Option<&'a str>, bytes: &'a [u8]) -> Result<&'a str, Utf8Error> {
    if let Some(text) = text { Ok(text) } else { in_core(bytes) }
}
#[cold]
#[inline(never)]
fn in_core(bytes: &[u8]) -> Result<&str, Utf8Error> {
    core::str::from_utf8(bytes)
}

impl<S: Isa> Iterator for Utf8<'_, S> {
    type Item = Simd<u8, B64, S>;
    #[inline(always)]
    fn next(&mut self) -> Option<Self::Item> {
        let (block, rest) = self.rest.split_first_chunk::<64>()?;
        let v = self.s.from(block);
        self.check.block(v);
        self.rest = rest;
        Some(v.in_place())
    }
}

use crate::__Targets;
#[crate::kernel]
#[inline]
/// This result fits in registers.
fn on_best(bytes: &[u8]) -> Option<&str> {
    Utf8::new(S::default(), bytes).checked()
}

/// `str::from_utf8`, on the best target. In a kernel, it is [`over(bytes).to_str()`](crate::Over::to_str).
///
/// ```
/// # use bun_simd::text::from_utf8;
/// assert_eq!(from_utf8("né".as_bytes()), Ok("né"));
/// assert!(from_utf8(b"n\xe9").is_err());
/// ```
#[inline]
pub fn from_utf8(bytes: &[u8]) -> Result<&str, Utf8Error> {
    or_in_core(on_best(bytes), bytes)
}

/// `String::from_utf8`, on the best target.
#[cfg(feature = "alloc")]
#[inline]
pub fn string_from_utf8(bytes: alloc::vec::Vec<u8>) -> Result<alloc::string::String, alloc::string::FromUtf8Error> {
    if !on_best(crate::rolled::slice(&bytes)).is_some_and(|text| core::ptr::eq(text.as_bytes(), &bytes[..])) {
        return alloc::string::String::from_utf8(bytes);
    }
    // SAFETY: these bytes were a `str` just now.
    #[allow(unsafe_code)]
    Ok(unsafe { alloc::string::String::from_utf8_unchecked(bytes) })
}

/// A byte below 128. A slice of these is a `str`, and an [`Output`](crate::mem::Output) of them appends to a `String` without a check.
///
/// ```
/// # use bun_simd::prelude::*;
/// let mut text = String::from("#");
/// u8xN::<Baseline>::over(&[1, 2, 3]).map_into(&mut Output::append(&mut text, 3), |v| v + b'0');
/// assert_eq!(text, "#123");
/// ```
#[derive(Copy, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(transparent)]
pub struct Ascii(u8);

impl Ascii {
    /// If the byte is below 128.
    #[inline(always)]
    pub const fn from_u8(byte: u8) -> Option<Self> {
        if byte < 128 { Some(Self(byte)) } else { None }
    }
    /// The byte.
    #[inline(always)]
    pub const fn to_u8(self) -> u8 {
        self.0
    }
    /// If all bytes are below 128.
    #[inline(always)]
    pub const fn from_bytes(bytes: &[u8]) -> Option<&[Self]> {
        Self::from_seen(crate::hints::unseen(bytes))
    }
    #[inline(always)]
    pub(crate) const fn from_seen(bytes: &[u8]) -> Option<&[Self]> {
        if !bytes.is_ascii() {
            return None;
        }
        // SAFETY: the line above, and the type is transparent.
        #[allow(unsafe_code)]
        Some(unsafe { &*(bytes as *const [u8] as *const [Self]) })
    }
    /// The same memory.
    #[inline(always)]
    pub const fn as_str(text: &[Self]) -> &str {
        // SAFETY: each byte is UTF-8 by itself.
        #[allow(unsafe_code)]
        unsafe {
            &*(text as *const [Self] as *const str)
        }
    }
}
impl core::fmt::Debug for Ascii {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        (self.0 as char).fmt(f)
    }
}
