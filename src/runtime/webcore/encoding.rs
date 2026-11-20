//! Contains helpers for C++ to do TextEncoder/Decoder like operations.
//! Also contains the code used by `bun.String.encode` and `bun.String.encodeInto`

use crate::node::types::Encoding;
use crate::webcore::jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_core::String as BunString;
use bun_core::strings;
use bun_simd::{Out, SharedOutU8, SharedU8};
use bun_simd_kernels as kernels;
use bun_simdutf_sys::simdutf as bun_simdutf;
use core::mem::MaybeUninit;

// `bun_core::String` exposes safe `Vec<u8>`/`Vec<u16>` → WTF::ExternalStringImpl
// constructors; delegate so the FFI ownership-transfer invariant is enforced
// once (in `bun_str`) instead of being re-derived here.
#[inline]
fn create_external_globally_allocated_latin1(bytes: Vec<u8>) -> BunString {
    BunString::create_external_globally_allocated_latin1(bytes)
}

#[inline]
fn create_external_globally_allocated_utf16(bytes: Vec<u16>) -> BunString {
    BunString::create_external_globally_allocated_utf16(bytes)
}

// ────────────────────────────────────────────────────────────────────────────
// Stable Rust does not allow enum-typed const generics without
// `#![feature(adt_const_params)]`, so we use `const ENCODING: u8` and reconstitute the enum
// inside each body via `encoding_from_u8(ENCODING)` (the optimizer folds the
// match since `ENCODING` is a monomorphized constant).
// ────────────────────────────────────────────────────────────────────────────

/// `@enumFromInt` for [`Encoding`] (which is `#[repr(u8)]` with contiguous
/// discriminants `0..=8`). Local because the enum lives in `bun_string`.
#[inline(always)]
const fn encoding_from_u8(n: u8) -> Encoding {
    // `n` is always a monomorphized `const ENCODING: u8` from the `enc::*`
    // table below, so the optimizer folds this match away entirely.
    match n {
        0 => Encoding::Utf8,
        1 => Encoding::Ucs2,
        2 => Encoding::Utf16le,
        3 => Encoding::Latin1,
        4 => Encoding::Ascii,
        5 => Encoding::Base64,
        6 => Encoding::Base64url,
        7 => Encoding::Hex,
        8 => Encoding::Buffer,
        _ => unreachable!(),
    }
}

/// `Encoding` discriminants as `u8` consts for use in `const ENCODING: u8`
/// generic args (stable-Rust workaround for `adt_const_params`).
mod enc {
    use super::Encoding;
    pub(super) const UTF8: u8 = Encoding::Utf8 as u8;
    pub(super) const UTF16LE: u8 = Encoding::Utf16le as u8;
    pub(super) const ASCII: u8 = Encoding::Ascii as u8;
}

// ────────────────────────────────────────────────────────────────────────────
// `dispatch_encoding!` — expands a runtime [`Encoding`] into nine monomorphized
// arms, binding the discriminant as a `const $E: u8` usable in const-generic
// position (`f::<$E>(..)`). Stable-Rust workaround for `adt_const_params`.
//
// Two forms:
//   • pure      — every variant maps 1:1 to its own discriminant.
//   • override  — leading explicit arms (aliasing / `unreachable!()`); the
//                 catch-all delegates to the pure form so the identity tail
//                 has no statically-unreachable arms.
//
// Uses `$crate` paths so call sites need no imports beyond the macro itself.
// ────────────────────────────────────────────────────────────────────────────
macro_rules! dispatch_encoding {
    // pure: every variant → its own discriminant
    ($scrut:expr, |$E:ident| $body:expr) => {
        match $scrut {
            $crate::node::types::Encoding::Utf8      => { const $E: u8 = $crate::node::types::Encoding::Utf8      as u8; $body }
            $crate::node::types::Encoding::Ucs2      => { const $E: u8 = $crate::node::types::Encoding::Ucs2      as u8; $body }
            $crate::node::types::Encoding::Utf16le   => { const $E: u8 = $crate::node::types::Encoding::Utf16le   as u8; $body }
            $crate::node::types::Encoding::Latin1    => { const $E: u8 = $crate::node::types::Encoding::Latin1    as u8; $body }
            $crate::node::types::Encoding::Ascii     => { const $E: u8 = $crate::node::types::Encoding::Ascii     as u8; $body }
            $crate::node::types::Encoding::Base64    => { const $E: u8 = $crate::node::types::Encoding::Base64    as u8; $body }
            $crate::node::types::Encoding::Base64url => { const $E: u8 = $crate::node::types::Encoding::Base64url as u8; $body }
            $crate::node::types::Encoding::Hex       => { const $E: u8 = $crate::node::types::Encoding::Hex       as u8; $body }
            $crate::node::types::Encoding::Buffer    => { const $E: u8 = $crate::node::types::Encoding::Buffer    as u8; $body }
        }
    };
    // override: leading explicit arms; remaining variants fall through to the pure form
    ($scrut:expr, { $($pat:pat => $arm:expr),+ $(,)? }, |$E:ident| $body:expr) => {
        match $scrut {
            $($pat => $arm,)+
            other => $crate::webcore::encoding::dispatch_encoding!(other, |$E| $body),
        }
    };
}
pub(crate) use dispatch_encoding;

// ────────────────────────────────────────────────────────────────────────────
// Exported C ABI entry points
// ────────────────────────────────────────────────────────────────────────────

/// # Safety
/// Caller (C++) must guarantee `input[..len]` and `to[..to_len]` are valid for
/// reading / writing respectively for the duration of the call.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__writeLatin1(
    input: *const u8,
    len: usize,
    to: *mut u8,
    to_len: usize,
    encoding: u8,
) -> usize {
    // SAFETY: forwarded from this fn's contract.
    let r = unsafe {
        let input = bun_core::ffi::slice(input, len);
        dispatch_encoding!(encoding_from_u8(encoding), {
            Encoding::Ucs2 => write_u8::<{ enc::UTF16LE }, false>(input, to, to_len),
            Encoding::Buffer => unreachable!(),
        }, |E| write_u8::<E, false>(input, to, to_len))
    };
    r.unwrap_or(0)
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` and `to[..to_len]` are valid for
/// reading / writing respectively for the duration of the call.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__writeUTF16(
    input: *const u16,
    len: usize,
    to: *mut u8,
    to_len: usize,
    encoding: u8,
) -> usize {
    // SAFETY: forwarded from this fn's contract.
    let r = unsafe {
        dispatch_encoding!(encoding_from_u8(encoding), {
            Encoding::Latin1 => write_u16::<{ enc::ASCII }, false>(input, len, to, to_len),
            Encoding::Ucs2 => write_u16::<{ enc::UTF16LE }, false>(input, len, to, to_len),
            Encoding::Buffer => unreachable!(),
        }, |E| write_u16::<E, false>(input, len, to, to_len))
    };
    r.unwrap_or(0)
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__byteLengthLatin1AsUTF8(input: *const u8, len: usize) -> usize {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    byte_length_u8::<{ enc::UTF8 }>(input)
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__byteLengthUTF16AsUTF8(input: *const u16, len: usize) -> usize {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    strings::element_length_utf16_into_utf8(input)
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__constructFromLatin1(
    global_object: &JSGlobalObject,
    input: *const u8,
    len: usize,
    encoding: u8,
) -> JSValue {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    let bytes = dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Ucs2 => construct_from_u8::<{ enc::UTF16LE }>(input),
        Encoding::Latin1 | Encoding::Buffer => unreachable!(),
    }, |E| construct_from_u8::<E>(input));
    bun_jsc::HostReturn::or_pending_exception(JSValue::create_buffer(global_object, bytes))
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__constructFromUTF16(
    global_object: &JSGlobalObject,
    input: *const u16,
    len: usize,
    encoding: u8,
) -> JSValue {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    let bytes = dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Ucs2 => construct_from_u16::<{ enc::UTF16LE }>(input),
        Encoding::Buffer => unreachable!(),
    }, |E| construct_from_u16::<E>(input));
    bun_jsc::HostReturn::or_pending_exception(JSValue::create_buffer(global_object, bytes))
}

/// `Buffer.from(string, encoding)` at compile time, for a constant string.
///
/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading and that `append` may be called with `sink`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__encodeLatin1(
    input: *const u8,
    len: usize,
    encoding: u8,
    sink: *mut core::ffi::c_void,
    append: unsafe extern "C" fn(*mut core::ffi::c_void, *const u8, usize),
) {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    let bytes = construct_from_u8_dyn(input, encoding_from_u8(encoding));
    // SAFETY: forwarded from this fn's contract.
    unsafe { append(sink, bytes.as_ptr(), bytes.len()) };
}

/// The same for a 16-bit string.
///
/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading and that `append` may be called with `sink`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__encodeUTF16(
    input: *const u16,
    len: usize,
    encoding: u8,
    sink: *mut core::ffi::c_void,
    append: unsafe extern "C" fn(*mut core::ffi::c_void, *const u8, usize),
) {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    let bytes = construct_from_u16_dyn(input, encoding_from_u8(encoding));
    // SAFETY: forwarded from this fn's contract.
    unsafe { append(sink, bytes.as_ptr(), bytes.len()) };
}
// for SQL statement
/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__toStringUTF8(
    input: *const u8,
    len: usize,
    global_object: &JSGlobalObject,
) -> JSValue {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    match to_string_comptime::<{ enc::UTF8 }>(input, global_object) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__encoding__toString(
    input: *const u8,
    len: usize,
    global_object: &JSGlobalObject,
    encoding: u8,
) -> JSValue {
    let encoding = encoding_from_u8(encoding);
    let string = if encoding == Encoding::Hex {
        // SAFETY: forwarded from this fn's contract. `SharedU8` has the layout of `u8`.
        let input = unsafe { bun_core::ffi::slice(input.cast::<SharedU8>(), len) };
        hex_string(len, |out| kernels::encode_hex_lower_from_shared(input, out))
            .into_js(global_object)
    } else {
        // SAFETY: forwarded from this fn's contract.
        let input = unsafe { bun_core::ffi::slice(input, len) };
        to_string(input, global_object, encoding)
    };
    bun_jsc::HostReturn::or_pending_exception(string)
}

/// The digits of `len` bytes.
fn hex_string(len: usize, encode: impl FnOnce(Out<'_, u8>) -> &mut [u8]) -> BunString {
    if len == 0 {
        return BunString::EMPTY;
    }
    let (str, chars) = BunString::create_uninitialized_latin1(len * 2);
    if !str.is_dead() {
        let digits = encode(chars.into());
        assert_eq!(digits.len(), len * 2);
    }
    str
}

pub(crate) fn to_string(
    input: &[u8],
    global_object: &JSGlobalObject,
    encoding: impl Into<Encoding>,
) -> JsResult<JSValue> {
    // treat buffer as utf8 — callers are expected to check that before
    // constructing `Buffer` objects
    dispatch_encoding!(encoding.into(), {
        Encoding::Buffer => to_string_comptime::<{ enc::UTF8 }>(input, global_object),
    }, |E| to_string_comptime::<E>(input, global_object))
}

pub(crate) fn to_bun_string_from_owned_slice(input: Vec<u8>, encoding: Encoding) -> BunString {
    if input.is_empty() {
        return BunString::EMPTY;
    }

    match encoding {
        Encoding::Ascii => {
            if strings::is_all_ascii(&input) {
                return create_external_globally_allocated_latin1(input);
            }

            let (str, chars) = BunString::create_uninitialized_latin1(input.len());
            // `input` dropped at end of scope (was: defer allocator.free(input))
            if str.is_dead() {
                return str;
            }
            strings::copy_latin1_into_ascii(chars, &input);
            str
        }
        Encoding::Latin1 => create_external_globally_allocated_latin1(input),
        Encoding::Buffer | Encoding::Utf8 => BunString::from_owned_utf8(input),
        Encoding::Ucs2 | Encoding::Utf16le => {
            // Avoid incomplete characters - if input length is 0 or odd, handle gracefully
            let usable_len = if !input.len().is_multiple_of(2) {
                input.len() - 1
            } else {
                input.len()
            };

            if usable_len == 0 {
                // input dropped
                return BunString::EMPTY;
            }

            // Allocate a fresh u16-aligned Vec and copy the bytes. Rebuilding a
            // `Vec<u16>` from a `Vec<u8>`'s raw parts would violate `Vec`'s
            // Layout contract: alloc happened with align 1, but the eventual
            // dealloc as `Vec<u16>` uses align 2. mimalloc gives us aligned
            // pointers in practice, so that wouldn't crash, but it's UB on
            // paper and an allocator change could surface it. Mirrors
            // `construct_from_u16`'s utf16le arm, which avoids the same
            // reinterpret for the same reason.
            let as_u16: Vec<u16> = input[..usable_len]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&unit| u16::from_ne_bytes(unit))
                .collect();
            create_external_globally_allocated_utf16(as_u16)
        }

        Encoding::Hex => hex_string(input.len(), |out| kernels::encode_hex_lower(&input, out)),

        // The output is strictly larger than the input, so the owned
        // allocation cannot be reused; drop it at end of scope.
        Encoding::Base64url => encode_base64_to_bun_string(&input, true),
        Encoding::Base64 => encode_base64_to_bun_string(&input, false),
    }
}

fn to_string_comptime<const ENCODING: u8>(
    input: &[u8],
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    to_bun_string_comptime::<ENCODING>(input).into_js(global)
}

pub(crate) fn to_bun_string(input: &[u8], encoding: impl Into<Encoding>) -> BunString {
    dispatch_encoding!(encoding.into(), |E| to_bun_string_comptime::<E>(input))
}

fn to_bun_string_comptime<const ENCODING: u8>(input: &[u8]) -> BunString {
    if input.is_empty() {
        return BunString::EMPTY;
    }

    match encoding_from_u8(ENCODING) {
        Encoding::Ascii => {
            let (str, chars) = BunString::create_uninitialized_latin1(input.len());
            if str.is_dead() {
                return str;
            }
            strings::copy_latin1_into_ascii(chars, input);
            str
        }
        Encoding::Latin1 => {
            let (str, chars) = BunString::create_uninitialized_latin1(input.len());
            if str.is_dead() {
                return str;
            }
            chars.copy_from_slice(input);
            str
        }
        Encoding::Buffer | Encoding::Utf8 => {
            let converted = match strings::to_utf16_alloc(input, false, false) {
                Ok(v) => v,
                Err(_) => return BunString::utf16_transcode_failure(input),
            };
            if let Some(utf16) = converted {
                return create_external_globally_allocated_utf16(utf16);
            }

            // If we get here, it means we can safely assume the string is 100% ASCII characters
            // For this, we rely on WebKit to manage the memory.
            BunString::clone_latin1(input)
        }
        Encoding::Ucs2 | Encoding::Utf16le => {
            // Avoid incomplete characters
            if input.len() / 2 == 0 {
                return BunString::EMPTY;
            }

            let chars_len = input.len() / 2;
            let (str, chars) = BunString::create_uninitialized_utf16(chars_len);
            if str.is_dead() {
                return str;
            }
            bun_core::slice_as_bytes_mut(chars).copy_from_slice(&input[..chars_len * 2]);
            str
        }

        Encoding::Hex => hex_string(input.len(), |out| kernels::encode_hex_lower(input, out)),

        Encoding::Base64url => encode_base64_to_bun_string(input, true),

        Encoding::Base64 => encode_base64_to_bun_string(input, false),
    }
}

/// Base64/base64url-encode `input` into a new Latin-1 `BunString`.
///
/// Small outputs are encoded straight into an uninitialized WTF string (one
/// allocation, no finalizer). Large outputs are encoded into a mimalloc-backed
/// buffer wrapped in an external WTF string, because cycling large blocks
/// through WTF's string allocator on every call is measurably more expensive
/// than letting mimalloc reuse them.
fn encode_base64_to_bun_string(input: &[u8], url_safe: bool) -> BunString {
    // Output size above which the external-string strategy is used.
    const EXTERNAL_MIN_LEN: usize = 32 * 1024;

    let to_len = if url_safe {
        bun_base64::url_safe_encode_len(input)
    } else {
        bun_base64::encode_len(input)
    };

    if to_len < EXTERNAL_MIN_LEN {
        let (str, chars) = BunString::create_uninitialized_latin1(to_len);
        if str.is_dead() {
            return str;
        }
        let wrote = if url_safe {
            bun_base64::encode_url_safe(chars, input)
        } else {
            bun_base64::encode(chars, input)
        };
        debug_assert_eq!(wrote, to_len);
        return str;
    }

    // `create_external_globally_allocated_latin1` would reject this length
    // after the encode; checked first so a failed reserve below is a true OOM.
    if to_len > BunString::max_length() {
        return BunString::DEAD;
    }
    let mut to: Vec<u8> = Vec::new();
    if to.try_reserve_exact(to_len).is_err() {
        return BunString::OUT_OF_MEMORY;
    }
    bun_core::vec::append_with(&mut to, to_len, |spare| {
        bun_simdutf::base64::encode(input, spare, url_safe)
    });
    debug_assert_eq!(to.len(), to_len);
    create_external_globally_allocated_latin1(to)
}

/// `ALLOW_PARTIAL_WRITE` selects Node's `Buffer#fill` semantics: the encoding
/// is truncated at the byte level, so a code unit / code point that only partly
/// fits still gets its leading bytes. Without it (`buf.write`), stop at whole units.
///
/// # Safety
/// `to` must be valid for writing `to_len` bytes that do not overlap `input`, or null if that is 0.
pub(crate) unsafe fn write_u8<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: &[u8],
    to: *mut u8,
    to_len: usize,
) -> Result<usize, crate::Error> {
    if input.is_empty() || to_len == 0 {
        return Ok(0);
    }
    let encoding = encoding_from_u8(ENCODING);
    if let Encoding::Buffer | Encoding::Latin1 | Encoding::Hex | Encoding::Utf8 = encoding {
        // SAFETY: forwarded from this fn's contract. `SharedOutU8` has the layout of `u8`.
        let to = unsafe { bun_core::ffi::slice(to.cast::<SharedOutU8>(), to_len) };
        if encoding == Encoding::Hex {
            return Ok(kernels::decode_hex_to_shared(input.as_chunks().0, to));
        }
        if encoding != Encoding::Utf8 {
            return Ok(bun_simd::copy_to_shared(input, to));
        }
        let r = strings::copy_latin1_into_shared_utf8(to, input);
        let mut written = r.written;
        // That stops at whole code points. Under byte-level truncation, a Latin-1 char >= 0x80
        // whose 2-byte sequence straddles the end still gets its lead byte.
        if ALLOW_PARTIAL_WRITE && written < to.len() && r.read < input.len() {
            debug_assert!(input[r.read] >= 0x80);
            to[written].set(0xC0 | (input[r.read] >> 6));
            written += 1;
        }
        return Ok(written);
    }
    // SAFETY: forwarded from this fn's contract.
    let to = unsafe { bun_core::ffi::slice_mut(to, to_len) };

    // TODO: increase temporary buffer size for larger amounts of data

    match encoding_from_u8(ENCODING) {
        Encoding::Ascii => {
            let written = input.len().min(to.len());

            let to = &mut to[..written];
            let remain = &input[..written];

            if bun_simdutf::validate::ascii(remain) {
                to.copy_from_slice(remain);
            } else {
                strings::copy_latin1_into_ascii(to, remain);
            }

            Ok(written)
        }
        // encode latin1 into UTF16
        Encoding::Ucs2 | Encoding::Utf16le => {
            let buf = input;
            let out_units = to.len() / 2;
            let mut written = if let Some(output) =
                bun_core::try_cast_slice_mut::<u8, u16>(&mut to[..out_units * 2])
            {
                strings::copy_latin1_into_utf16(output, buf).written * 2
            } else {
                // Rust `&mut [u16]` requires natural alignment, so inline the
                // (trivial) widen loop for the misaligned-dest case
                // (each Latin-1 byte → one u16).
                let n = buf.len().min(out_units);
                for i in 0..n {
                    to[i * 2..i * 2 + 2].copy_from_slice(&(buf[i] as u16).to_ne_bytes());
                }
                n * 2
            };
            // Under byte-level truncation the trailing byte of an odd-length
            // destination (shorter than the encoded string) is the low byte
            // of the next code unit.
            if ALLOW_PARTIAL_WRITE && written < to.len() && written < buf.len() * 2 {
                to[written] = buf[written / 2];
                written += 1;
            }
            Ok(written)
        }

        Encoding::Buffer | Encoding::Latin1 | Encoding::Hex | Encoding::Utf8 => unreachable!(),

        Encoding::Base64 | Encoding::Base64url => {
            let is_urlsafe = matches!(encoding_from_u8(ENCODING), Encoding::Base64url);
            Ok(bun_base64::decode_lenient(to, input, is_urlsafe))
        }
    }
}

fn byte_length_u8<const ENCODING: u8>(input: &[u8]) -> usize {
    if input.is_empty() {
        return 0;
    }

    match encoding_from_u8(ENCODING) {
        Encoding::Utf8 => strings::element_length_latin1_into_utf8(input),

        Encoding::Latin1 | Encoding::Ascii | Encoding::Buffer => input.len(),

        Encoding::Ucs2 | Encoding::Utf16le => strings::element_length_utf8_into_utf16(input) * 2,

        Encoding::Hex => input.len() / 2,

        Encoding::Base64 | Encoding::Base64url => bun_base64::decode_len(input),
        // else => return &[_]u8{};
    }
}

/// # Safety
/// `input` must be valid for reading `len` `u16`s and `to` must be valid for
/// writing `to_len` bytes; either pointer may be null when its length is 0 (a
/// detached `ArrayBufferView` has a null vector and a byte length of 0). For
/// `Ucs2`/`Utf16le` the ranges may overlap (memmove semantics); for all other
/// encodings they must not.
pub(crate) unsafe fn write_u16<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: *const u16,
    len: usize,
    to: *mut u8,
    to_len: usize,
) -> Result<usize, crate::Error> {
    if len == 0 || to_len == 0 {
        return Ok(0);
    }

    // SAFETY: forwarded from this fn's contract. `SharedOutU8` has the layout of `u8`.
    let output = unsafe { bun_core::ffi::slice(to.cast::<SharedOutU8>(), to_len) };

    // string is already encoded, just need to copy the data
    if let Encoding::Ucs2 | Encoding::Utf16le = encoding_from_u8(ENCODING) {
        // SAFETY: the same for `SharedU8`, which may overlap with `output`.
        let bytes = unsafe { bun_core::ffi::slice(input.cast::<SharedU8>(), len * 2) };
        let room = if ALLOW_PARTIAL_WRITE {
            to_len
        } else {
            to_len & !1
        };
        return Ok(bun_simd::copy_to_shared(bytes, &output[..room]));
    }

    // SAFETY: forwarded from this fn's contract, which rules out an overlap for these encodings.
    let input = unsafe { bun_core::ffi::slice(input, len) };

    match encoding_from_u8(ENCODING) {
        Encoding::Utf8 => {
            Ok(strings::copy_utf16_into_utf8_impl::<ALLOW_PARTIAL_WRITE>(output, input).written)
        }
        Encoding::Latin1 | Encoding::Ascii | Encoding::Buffer => {
            Ok(kernels::copy_u16_to_shared(input, output))
        }
        Encoding::Ucs2 | Encoding::Utf16le => unreachable!(),
        Encoding::Hex => Ok(kernels::decode_hex16_to_shared(input.as_chunks().0, output)),
        Encoding::Base64 | Encoding::Base64url => {
            // Match Node.js: two-byte strings are decoded from the low byte of
            // each UTF-16 code unit (so e.g. U+013D behaves like '=' and
            // U+1234 like '4'), the same narrowing Node's lenient fallback
            // decoder applies.
            let narrowed = narrow_u16_to_u8(input);
            // SAFETY: forwarded from this fn's contract. `output` is not used again.
            unsafe { write_u8::<ENCODING, ALLOW_PARTIAL_WRITE>(&narrowed, to, to_len) }
        }
    }
}

fn construct_from_u8<const ENCODING: u8>(input: &[u8]) -> Vec<u8> {
    if input.is_empty() {
        return Vec::new();
    }

    match encoding_from_u8(ENCODING) {
        Encoding::Buffer | Encoding::Latin1 | Encoding::Ascii => input.to_vec(),
        Encoding::Utf8 => {
            // need to encode
            strings::allocate_latin1_into_utf8(input).unwrap_or_default()
        }
        // encode latin1 into UTF16
        // return as bytes
        Encoding::Ucs2 | Encoding::Utf16le => {
            // Each Latin-1 byte widens to one native-endian u16 code unit
            // (`copy_latin1_into_utf16` is exactly that loop). Write the bytes
            // directly into a `Vec<u8>` so we never depend on an allocator-
            // layout-dependent `Vec<u16> → Vec<u8>` header reinterpret.
            let out_len = input.len() * 2;
            let mut to: Vec<u8> = Vec::with_capacity(out_len);
            let (pairs, _) = to.spare_capacity_mut().as_chunks_mut::<2>();
            for (out, &b) in pairs.iter_mut().zip(input) {
                *out = u16::from(b).to_ne_bytes().map(MaybeUninit::new);
            }
            // SAFETY: the loop wrote one pair per input byte, i.e. all `out_len` reserved bytes.
            unsafe { to.set_len(out_len) };
            to
        }

        Encoding::Hex => construct_from_hex(input.as_chunks().0, kernels::decode_hex),

        Encoding::Base64 | Encoding::Base64url => {
            const TRIM_CHARS: &[u8] = b"\r\n\t \x0B"; // \x0B = vertical tab
            let slice = strings::trim(input, TRIM_CHARS);
            if slice.is_empty() {
                return Vec::new();
            }

            let is_urlsafe = matches!(encoding_from_u8(ENCODING), Encoding::Base64url);
            let outlen = bun_base64::decode_lenient_len(slice.len());
            // Decode into uninitialized spare capacity: the decoder only ever
            // writes to the destination, and only the `wrote` bytes it
            // initialized are committed below. This buffer becomes the
            // Buffer's storage, so a zero-fill would be pure overhead for
            // large inputs.
            let mut to: Vec<u8> = Vec::new();
            // SAFETY: the returned spare bytes are write-only until committed.
            let dest = unsafe { bun_core::vec::reserve_spare_bytes(&mut to, outlen) };
            let wrote = bun_base64::decode_lenient(&mut dest[..outlen], slice, is_urlsafe);
            if wrote == 0 {
                return Vec::new();
            }
            // SAFETY: the decoder initialized the first `wrote` bytes
            // (`wrote <= outlen <= capacity`).
            unsafe { bun_core::vec::commit_spare(&mut to, wrote) };
            to
        }
    }
}

fn construct_from_u16<const ENCODING: u8>(input: &[u16]) -> Vec<u8> {
    if input.is_empty() {
        return Vec::new();
    }

    match encoding_from_u8(ENCODING) {
        Encoding::Utf8 => strings::to_utf8_alloc_with_type(input),
        Encoding::Latin1 | Encoding::Buffer | Encoding::Ascii => narrow_u16_to_u8(input),
        // string is already encoded, just need to copy the data
        Encoding::Ucs2 | Encoding::Utf16le => {
            // `input: &[u16]` is the source bytes verbatim; copy them
            // out into a fresh u8 Vec (a `Vec<u16>` header reinterpret would be
            // allocator-layout-dependent).
            bun_core::slice_as_bytes(input).to_vec()
        }

        Encoding::Hex => construct_from_hex(input.as_chunks().0, kernels::decode_hex16),

        Encoding::Base64 | Encoding::Base64url => {
            // Match Node.js: two-byte strings are decoded from the low byte of
            // each UTF-16 code unit (so e.g. U+013D behaves like '=' and
            // U+1234 like '4'), the same narrowing Node's lenient fallback
            // decoder applies.
            construct_from_u8::<ENCODING>(&narrow_u16_to_u8(input))
        }
    }
}

/// The low byte of every code unit, in a fresh exactly-sized `Vec<u8>`.
fn narrow_u16_to_u8(input: &[u16]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(input.len());
    bun_simd::extend_vec(&mut out, input.len(), |dst| {
        kernels::copy_u16_to_u8(input, dst)
    });
    out
}

/// Decodes hex pairs up to the first invalid one (`Buffer.from("..", "hex")` semantics).
fn construct_from_hex<Char>(
    pairs: &[[Char; 2]],
    decode: impl for<'a> FnOnce(&[[Char; 2]], Out<'a, u8>) -> &'a mut [u8],
) -> Vec<u8> {
    let mut to: Vec<u8> = Vec::new();
    bun_simd::extend_vec(&mut to, pairs.len(), |out| decode(pairs, out));
    if to.is_empty() {
        return Vec::new();
    }
    to
}

// ──────────────────────────────────────────────────────────────────────────
// `String` / `EncodedSlice` encoding extension traits.
//
// Hosted here (not on `bun_core::String`) because the encoder bodies above
// (`encodeIntoFrom{8,16}` / `constructFrom{U8,U16}`) belong to `bun_runtime`;
// putting the methods on the `String` type would require a `bun_string →
// bun_runtime` upward dep. Per PORTING.md §Dep-cycle, the methods move UP into
// the crate that owns the impls. Provided as extension traits so call sites
// keep the `s.encode(enc)` shape.
// ──────────────────────────────────────────────────────────────────────────

/// Runtime-dispatch wrapper over [`construct_from_u8`].
fn construct_from_u8_dyn(input: &[u8], encoding: Encoding) -> Vec<u8> {
    dispatch_encoding!(encoding, |E| construct_from_u8::<E>(input))
}

/// Runtime-dispatch wrapper over [`construct_from_u16`].
fn construct_from_u16_dyn(input: &[u16], encoding: Encoding) -> Vec<u8> {
    dispatch_encoding!(encoding, |E| construct_from_u16::<E>(input))
}

/// Extension trait — see module note above for why this lives in
/// `bun_runtime`.
pub(crate) trait BunStringEncode {
    fn encode(&self, enc: Encoding) -> Vec<u8>;
}

impl BunStringEncode for bun_core::String {
    /// Encode `self` with the given encoding.
    fn encode(&self, enc: Encoding) -> Vec<u8> {
        self.to_encoded_slice().encode_with_allocator(enc)
    }
}

/// `EncodedSlice` encoding. Extension trait — encoder bodies live in this crate.
pub(crate) trait EncodedSliceEncode {
    fn encode_with_allocator(&self, enc: Encoding) -> Vec<u8>;
}

impl EncodedSliceEncode for bun_core::EncodedSlice<'_> {
    fn encode_with_allocator(&self, enc: Encoding) -> Vec<u8> {
        if self.is_16bit() {
            construct_from_u16_dyn(self.utf16_slice(), enc)
        } else {
            construct_from_u8_dyn(self.slice(), enc)
        }
    }
}
