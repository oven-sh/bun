//! What a path does differently for `u8` (WTF-8) and `u16` (WTF-16).

use core::mem::MaybeUninit;
use core::ops::Deref;

use bun_core::strings::{self, CodeUnits};
use bun_core::vec::BorrowedBuf;
use bun_core::{MAX_PATH_BYTES, PATH_MAX_WIDE, WStr, ZStr};

use crate::PathChar;

/// `u8` or `u16`.
pub trait PathUnit: PathChar + Default {
    /// `ZStr` or `WStr`.
    type ZSlice: ?Sized + Deref<Target = [Self]>;
    /// The most that a syscall takes, NUL included.
    const PATH_MAX: usize;
    /// A reference, so that an empty path can point at it.
    const NUL: &'static Self;

    /// SAFETY: `ptr[..=len]` is readable for `'a` and `ptr[len]` is NUL.
    unsafe fn zslice_from_raw<'a>(ptr: *const Self, len: usize) -> &'a Self::ZSlice;

    /// Upper bound on the converted length. Exact if there is nothing to transcode.
    fn max_len_for<C: PathChar>(from: &[C]) -> usize;

    /// `to` is at least `max_len_for(from)` long. Returns the number of units written.
    fn copy_or_transcode<C: PathChar>(from: &[C], to: &mut [MaybeUninit<Self>]) -> usize;

    /// The length of a leading `X:`. Win32 accepts any UTF-16 unit for `X`, not only a letter.
    fn drive_len(path: &[Self]) -> usize;

    fn index_of_untidy_slash(path: &[Self]) -> Option<usize>;
    fn last_index_of_slash(path: &[Self]) -> Option<usize>;
    fn count_slashes(path: &[Self]) -> usize;
    fn common_prefix_length(a: &[Self], b: &[Self]) -> usize;
}

impl PathUnit for u8 {
    type ZSlice = ZStr;
    const PATH_MAX: usize = MAX_PATH_BYTES;
    const NUL: &'static u8 = &0;

    #[inline(always)]
    unsafe fn zslice_from_raw<'a>(ptr: *const u8, len: usize) -> &'a ZStr {
        // SAFETY: the caller's contract.
        unsafe {
            debug_assert_eq!(*ptr.add(len), 0);
            ZStr::from_raw(ptr, len)
        }
    }

    #[inline(always)]
    fn max_len_for<C: PathChar>(from: &[C]) -> usize {
        match C::units(from) {
            CodeUnits::U8(from) => from.len(),
            CodeUnits::U16(from) => 3 * from.len(),
        }
    }

    #[inline(always)]
    fn copy_or_transcode<C: PathChar>(from: &[C], to: &mut [MaybeUninit<u8>]) -> usize {
        match C::units(from) {
            CodeUnits::U8(from) => to[..from.len()].write_copy_of_slice(from).len(),
            CodeUnits::U16(from) => {
                let mut to = BorrowedBuf::from(to);
                assert!(strings::try_write_utf16_as_wtf8(from, to.unfilled()));
                to.len()
            }
        }
    }

    #[inline]
    fn drive_len(path: &[u8]) -> usize {
        match path {
            [_, b':', ..] => 2,
            [0xC2..=0xDF, 0x80..=0xBF, b':', ..] => 3,
            [0xE0, 0xA0..=0xBF, 0x80..=0xBF, b':', ..]
            | [0xE1..=0xEF, 0x80..=0xBF, 0x80..=0xBF, b':', ..] => 4,
            _ => 0,
        }
    }

    #[inline(always)]
    fn index_of_untidy_slash(path: &[u8]) -> Option<usize> {
        bun_highway::index_of_untidy_slash(path)
    }

    #[inline(always)]
    fn last_index_of_slash(path: &[u8]) -> Option<usize> {
        bun_highway::last_index_of_slash(path)
    }

    #[inline(always)]
    fn count_slashes(path: &[u8]) -> usize {
        bun_highway::count_slashes(path)
    }

    #[inline(always)]
    fn common_prefix_length(a: &[u8], b: &[u8]) -> usize {
        bun_highway::common_prefix_length(a, b)
    }
}

const SLASH: u16 = b'/' as u16;
const DOT: u16 = b'.' as u16;
const COLON: u16 = b':' as u16;

impl PathUnit for u16 {
    type ZSlice = WStr;
    const PATH_MAX: usize = PATH_MAX_WIDE;
    const NUL: &'static u16 = &0;

    #[inline(always)]
    unsafe fn zslice_from_raw<'a>(ptr: *const u16, len: usize) -> &'a WStr {
        // SAFETY: the caller's contract.
        unsafe {
            debug_assert_eq!(*ptr.add(len), 0);
            WStr::from_raw(ptr, len)
        }
    }

    #[inline(always)]
    fn max_len_for<C: PathChar>(from: &[C]) -> usize {
        from.len()
    }

    #[inline(always)]
    fn copy_or_transcode<C: PathChar>(from: &[C], to: &mut [MaybeUninit<u16>]) -> usize {
        match C::units(from) {
            CodeUnits::U8(from) => {
                let mut to = BorrowedBuf::from(to);
                assert!(strings::try_write_wtf8_as_utf16(from, to.unfilled()));
                to.len()
            }
            CodeUnits::U16(from) => to[..from.len()].write_copy_of_slice(from).len(),
        }
    }

    #[inline]
    fn drive_len(path: &[u16]) -> usize {
        match path {
            [_, COLON, ..] => 2,
            _ => 0,
        }
    }

    fn index_of_untidy_slash(path: &[u16]) -> Option<usize> {
        const BLOCK: usize = 16;
        let is_untidy = |&at: &usize| {
            path[at] == SLASH
                && matches!(
                    path[at + 1..],
                    [SLASH, ..] | [DOT] | [DOT, SLASH, ..] | [DOT, DOT] | [DOT, DOT, SLASH, ..]
                )
        };
        // `&` and `|` are what let this be vectorized. `.` is `/` without its lowest bit.
        let has_suspect = |units: &[u16; BLOCK + 1]| {
            let is_suspect = |at: usize| (units[at] == SLASH) & ((units[at + 1] | 1) == SLASH);
            (0..BLOCK).fold(false, |any, at| any | is_suspect(at))
        };
        let mut start = 0;
        while let Some(units) = path[start..].first_chunk() {
            if has_suspect(units)
                && let Some(found) = (start..start + BLOCK).find(is_untidy)
            {
                return Some(found);
            }
            start += BLOCK;
        }
        // Overlaps the block before it, in place of a scalar loop.
        if path.last_chunk().is_some_and(|units| !has_suspect(units)) {
            return None;
        }
        (start..path.len()).find(is_untidy)
    }

    fn last_index_of_slash(path: &[u16]) -> Option<usize> {
        path.iter().rposition(|&unit| unit == SLASH)
    }

    fn count_slashes(path: &[u16]) -> usize {
        path.iter().filter(|&&unit| unit == SLASH).count()
    }

    fn common_prefix_length(a: &[u16], b: &[u16]) -> usize {
        a.iter().zip(b).take_while(|(a, b)| a == b).count()
    }
}
