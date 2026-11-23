//! What C++ calls, as declared in src/jsc/bindings/bun_simd.h.
//!
//! A pointer can be anything if its length is 0. A panic aborts.
#![allow(unsafe_code)]

use super::{ascii, html, shared as search, substring, swap, width};
use core::{mem::MaybeUninit, slice, sync::atomic::AtomicU8};

/// # Safety
/// `len` values at `ptr` are initialized and aligned, and only change if `T` allows that.
/// If it does, `ptr` doesn't come from a shared reference to a type that doesn't.
#[inline(always)]
pub(super) unsafe fn values<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
    if len == 0 {
        return &[];
    }
    // SAFETY: the caller's.
    unsafe { slice::from_raw_parts(ptr, len) }
}

/// # Safety
/// `len` values at `ptr` are aligned and can be written, and nothing else accesses them.
#[inline(always)]
pub(super) unsafe fn output<'a, T>(ptr: *mut T, len: usize) -> &'a mut [MaybeUninit<T>] {
    if len == 0 {
        return &mut [];
    }
    // SAFETY: the caller's.
    unsafe { slice::from_raw_parts_mut(ptr.cast(), len) }
}

/// Calls `f` with the characters of a string. `ptr` needs no alignment.
///
/// # Safety
/// `len` values at `ptr` are initialized and don't change.
#[inline(always)]
pub(super) unsafe fn with_string<T: Copy, R>(
    ptr: *const T,
    len: usize,
    f: impl FnOnce(&[T]) -> R,
) -> R {
    #[cold]
    #[inline(never)]
    unsafe fn with_copy<T: Copy, R>(ptr: *const T, len: usize, f: impl FnOnce(&[T]) -> R) -> R {
        // SAFETY: the caller's.
        let copy: Vec<T> = (0..len)
            .map(|i| unsafe { ptr.add(i).read_unaligned() })
            .collect();
        f(&copy)
    }
    if !ptr.is_aligned() {
        // SAFETY: the caller's.
        return unsafe { with_copy(ptr, len, f) };
    }
    // SAFETY: the caller's, and it is aligned.
    f(unsafe { values(ptr, len) })
}

macro_rules! scans {
    ($($export:ident($unit:ty) = $kernel:path;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(text: *const $unit, len: usize) -> usize {
            // SAFETY: the characters of a string.
            unsafe { with_string(text, len, $kernel) }
        }
    )*};
}
scans! {
    bun_simd_count_printable_ascii16(u16) = ascii::count_printable_ascii16;
    bun_simd_first_non_ascii8(u8) = ascii::first_non_ascii;
    bun_simd_first_non_ascii16(u16) = ascii::first_non_ascii;
    bun_simd_html_escape_extra_len8(u8) = html::extra_len;
    bun_simd_html_escape_extra_len16(u16) = html::extra_len;
    bun_simd_index_of_escape_char8(u8) = ascii::index_of_escape_char;
    bun_simd_index_of_escape_char16(u16) = ascii::index_of_escape_char;
    bun_simd_index_of_first_ascii_upper8(u8) = ascii::index_of_first_ascii_upper;
    bun_simd_index_of_first_ascii_upper16(u16) = ascii::index_of_first_ascii_upper;
    bun_simd_index_of_html_escape_char8(u8) = html::index_of_escaped;
    bun_simd_index_of_html_escape_char16(u16) = html::index_of_escaped;
    bun_simd_visible_latin1_width(u8) = width::visible_latin1_width;
    bun_simd_visible_latin1_width_exclude_ansi(u8) = width::visible_latin1_width_exclude_ansi;
}

macro_rules! widths {
    ($($export:ident($($done:ident)?) = $kernel:path;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(text: *const u16, len: usize, width: &mut usize, $($done: &mut usize)?) -> usize {
            // SAFETY: the characters of a string.
            let (units, added) = unsafe { with_string(text, len, |text| $kernel(text, $($done)?)) };
            *width += added;
            units
        }
    )*};
}
widths! {
    bun_simd_visible_utf16_width() = width::visible_utf16_width;
    bun_simd_visible_utf16_width_exclude_ansi(done) = width::visible_utf16_width_exclude_ansi;
}

/// From a string to new memory.
macro_rules! copies {
    ($($export:ident($from:ty, $to:ty) = $kernel:path;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(from: *const $from, len: usize, to: *mut $to) {
            // SAFETY: the characters of a string, and room for as many that only the caller knows of.
            unsafe { with_string(from, len, move |from| $kernel(from, output(to, len))) }
        }
    )*};
}
copies! {
    bun_simd_lower_ascii8(u8, u8) = ascii::lower_ascii;
    bun_simd_lower_ascii16(u16, u16) = ascii::lower_ascii;
    bun_simd_narrow_to_latin1(u16, u8) = ascii::narrow_to_latin1;
}

macro_rules! escapes {
    ($($export:ident($unit:ty) = $kernel:path;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(from: *const $unit, len: usize, to: *mut $unit, to_len: usize) {
            // SAFETY: the characters of a string, and room that only the caller knows of.
            unsafe { with_string(from, len, move |from| $kernel(from, output(to, to_len))) }
        }
    )*};
}
escapes! {
    bun_simd_escape_html8(u8) = html::escape;
    bun_simd_escape_html16(u16) = html::escape;
}

macro_rules! strips {
    ($($export:ident($unit:ty);)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(from: *const $unit, len: usize, to: *mut $unit, written: &mut usize) -> usize {
            let read;
            // SAFETY: the characters of a string, and room for as many that only the caller knows of.
            (read, *written) = unsafe { with_string(from, len, move |from| width::strip_csi(from, output(to, len))) };
            read
        }
    )*};
}
strips! {
    bun_simd_strip_csi8(u8);
    bun_simd_strip_csi16(u16);
}

/// The memory of buffers can be shared with other threads, and has no alignment.
macro_rules! substrings {
    ($($export:ident = $kernel:path;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(
            haystack: *const u8,
            haystack_len: usize,
            needle: *const u8,
            needle_len: usize,
        ) -> usize {
            // SAFETY: as many units of a buffer, as atomic bytes.
            let (haystack, needle) = unsafe {
                (values(haystack.cast(), haystack_len), values(needle.cast(), needle_len))
            };
            $kernel(haystack, needle)
        }
    )*};
}
substrings! {
    bun_simd_memmem = substring::memmem_shared;
    bun_simd_memrmem = substring::memrmem_shared;
    bun_simd_memmem16 = substring::memmem16_shared;
    bun_simd_memrmem16 = substring::memrmem16_shared;
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_index_of_char(
    haystack: *const AtomicU8,
    len: usize,
    needle: u8,
) -> usize {
    // SAFETY: the bytes of a buffer.
    search::first(unsafe { values(haystack, len) }, needle)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_simd_last_index_of_char(
    haystack: *const AtomicU8,
    len: usize,
    needle: u8,
) -> usize {
    // SAFETY: the bytes of a buffer.
    search::last(unsafe { values(haystack, len) }, needle, len)
}

macro_rules! swaps {
    ($($export:ident = $kernel:path;)*) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $export(data: *const AtomicU8, len: usize) {
            // SAFETY: the bytes of a buffer, which can be written.
            $kernel(unsafe { values(data, len) })
        }
    )*};
}
swaps! {
    bun_simd_bswap16 = swap::swap_bytes::<u16>;
    bun_simd_bswap32 = swap::swap_bytes::<u32>;
    bun_simd_bswap64 = swap::swap_bytes::<u64>;
}

/// Replaces that of libc in the executable. It can run before `main`, and does not allocate.
#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
#[cfg_attr(not(target_os = "macos"), linkage = "weak")]
#[unsafe(no_mangle)]
unsafe extern "C" fn memmem(
    haystack: *const core::ffi::c_void,
    haystack_len: usize,
    needle: *const core::ffi::c_void,
    needle_len: usize,
) -> *mut core::ffi::c_void {
    // SAFETY: the contract of `memmem` in C.
    let (bytes, needle) = unsafe {
        (
            values(haystack.cast(), haystack_len),
            values(needle.cast(), needle_len),
        )
    };
    match substring::memmem(bytes, needle) {
        Some(at) => haystack.wrapping_byte_add(at).cast_mut(),
        None => core::ptr::null_mut(),
    }
}
