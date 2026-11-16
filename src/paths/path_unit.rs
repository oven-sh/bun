//! What [`PathIn`](crate::PathIn) does differently for `u8` (WTF-8) and `u16` (WTF-16).

use core::mem::MaybeUninit;
use core::ops::{Deref, DerefMut};

use bun_core::strings::{self, CodeUnits};
use bun_core::vec::BorrowedBuf;
use bun_core::{MAX_PATH_BYTES, PATH_MAX_WIDE, PathBuffer, WPathBuffer, WStr, ZStr};

use crate::PathChar;
use crate::path_buffer_pool::PoolStorage;

/// `u8` or `u16`.
pub trait PathUnit: sealed::Kernels {}
impl<U: sealed::Kernels> PathUnit for U {}

#[cfg(test)]
pub(crate) const KNOWN_DIR_IN_TESTS: &[u8] = br"/a\A/..\bc/a\/\a/C:\a/a\A\a/b\..\..\a/\";

pub(crate) mod sealed {
    use super::*;

    pub trait Kernels: PathChar {
        /// `ZStr` or `WStr`.
        type Z: ?Sized + Deref<Target = [Self]>;
        /// `PathBuffer` or `WPathBuffer`.
        type Buffer: PoolStorage + DerefMut<Target = [Self]>;
        /// The length of `Self::Buffer`.
        const POOLED_LEN: usize;
        const NUL: &'static Self;

        /// SAFETY: `units[..=len]` is readable for `'a` and `units[len]` is NUL.
        unsafe fn z<'a>(units: *const Self, len: usize) -> &'a Self::Z;

        /// No less than what [`Self::write`] returns, and more only for WTF-8 that becomes WTF-16.
        fn room_for<C: PathChar>(from: &[C]) -> usize;

        /// Initializes the start of `to`, which has `room_for(from)` units, and returns how much of it.
        fn write<C: PathChar>(from: &[C], to: &mut [MaybeUninit<Self>]) -> usize;

        /// The length of a leading `X:`. Win32 takes any UTF-16 unit for `X`, not only a letter.
        fn drive_len(path: &[Self]) -> usize;

        /// The directories that the system has named: the home, and each that has been the top-level one.
        fn with_known_dirs(read: impl FnOnce(&[&[Self]]));

        fn index_of_untidy_slash(path: &[Self]) -> Option<usize>;
        fn last_index_of_slash(path: &[Self]) -> Option<usize>;
        fn count_slashes(path: &[Self]) -> usize;
        fn common_prefix_length(a: &[Self], b: &[Self]) -> usize;
    }

    impl Kernels for u8 {
        type Z = ZStr;
        type Buffer = PathBuffer;
        const POOLED_LEN: usize = MAX_PATH_BYTES;
        const NUL: &'static u8 = &0;

        #[inline(always)]
        unsafe fn z<'a>(units: *const u8, len: usize) -> &'a ZStr {
            // SAFETY: the caller's contract.
            unsafe {
                debug_assert_eq!(*units.add(len), 0);
                ZStr::from_raw(units, len)
            }
        }

        #[inline(always)]
        fn room_for<C: PathChar>(from: &[C]) -> usize {
            match C::units(from) {
                CodeUnits::U8(from) => from.len(),
                CodeUnits::U16(from) => strings::element_length_utf16_into_utf8(from),
            }
        }

        #[inline(always)]
        fn write<C: PathChar>(from: &[C], to: &mut [MaybeUninit<u8>]) -> usize {
            match C::units(from) {
                CodeUnits::U8(from) => to[..from.len()].write_copy_of_slice(from).len(),
                CodeUnits::U16(from) => {
                    let mut to = BorrowedBuf::from(to);
                    assert!(strings::try_write_wtf16_as_wtf8(from, to.unfilled()));
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

        fn with_known_dirs(read: impl FnOnce(&[&[u8]])) {
            #[cfg(test)]
            read(&[b"", KNOWN_DIR_IN_TESTS]);
            #[cfg(all(unix, not(test)))]
            crate::fs::with_known_dirs(read);
            #[cfg(not(any(unix, test)))]
            read(&[]);
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

    impl Kernels for u16 {
        type Z = WStr;
        type Buffer = WPathBuffer;
        const POOLED_LEN: usize = PATH_MAX_WIDE;
        const NUL: &'static u16 = &0;

        #[inline(always)]
        unsafe fn z<'a>(units: *const u16, len: usize) -> &'a WStr {
            // SAFETY: the caller's contract.
            unsafe {
                debug_assert_eq!(*units.add(len), 0);
                WStr::from_raw(units, len)
            }
        }

        #[inline(always)]
        fn room_for<C: PathChar>(from: &[C]) -> usize {
            from.len()
        }

        #[inline(always)]
        fn write<C: PathChar>(from: &[C], to: &mut [MaybeUninit<u16>]) -> usize {
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

        fn with_known_dirs(read: impl FnOnce(&[&[u16]])) {
            #[cfg(test)]
            read(&[&Vec::from_iter(
                KNOWN_DIR_IN_TESTS.iter().map(|&it| it.into()),
            )]);
            #[cfg(not(test))]
            read(&[]);
        }

        fn index_of_untidy_slash(path: &[u16]) -> Option<usize> {
            (0..path.len()).find(|&at| {
                matches!(
                    path[at..],
                    [SLASH, SLASH, ..]
                        | [SLASH, DOT]
                        | [SLASH, DOT, SLASH, ..]
                        | [SLASH, DOT, DOT]
                        | [SLASH, DOT, DOT, SLASH, ..]
                )
            })
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
}
