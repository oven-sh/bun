//! Contains helpers for C++ to do TextEncoder/Decoder like operations.
//! Also contains the code used by `bun.String.encode` and `bun.String.encodeInto`

use core::slice;

use crate::node::types::Encoding;
use crate::webcore::jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_core::String as BunString;
use bun_core::strings;
use bun_simdutf_sys::simdutf as bun_simdutf;

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
#[allow(non_snake_case)]
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
pub(crate) unsafe extern "C" fn Bun__encoding__writeLatin1(
    input: *const u8,
    len: usize,
    to: *mut u8,
    to_len: usize,
    encoding: u8,
) -> usize {
    // SAFETY: forwarded from this fn's contract.
    let r = unsafe {
        dispatch_encoding!(encoding_from_u8(encoding), {
            Encoding::Ucs2 => write_u8::<{ enc::UTF16LE }, false>(input, len, to, to_len),
            Encoding::Buffer => unreachable!(),
        }, |E| write_u8::<E, false>(input, len, to, to_len))
    };
    r.unwrap_or(0)
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` and `to[..to_len]` are valid for
/// reading / writing respectively for the duration of the call.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__encoding__writeUTF16(
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
pub(crate) unsafe extern "C" fn Bun__encoding__byteLengthLatin1AsUTF8(
    input: *const u8,
    len: usize,
) -> usize {
    // SAFETY: forwarded from this fn's contract.
    unsafe { byte_length_u8::<{ enc::UTF8 }>(input, len) }
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__encoding__byteLengthUTF16AsUTF8(
    input: *const u16,
    len: usize,
) -> usize {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    strings::element_length_utf16_into_utf8(input)
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__encoding__constructFromLatin1(
    global_object: &JSGlobalObject,
    input: *const u8,
    len: usize,
    encoding: u8,
) -> JSValue {
    // Ownership of the allocation transfers to JSC: `create_buffer` registers the
    // pointer with `MarkedArrayBuffer_deallocator`, which frees it on GC. Wrapping
    // in `ManuallyDrop` prevents Rust from also freeing it at scope exit (which
    // would be a use-after-free + double-free).
    // SAFETY: forwarded from this fn's contract.
    let mut slice = core::mem::ManuallyDrop::new(unsafe {
        dispatch_encoding!(encoding_from_u8(encoding), {
            Encoding::Ucs2 => construct_from_u8::<{ enc::UTF16LE }>(input, len),
            Encoding::Latin1 | Encoding::Buffer => unreachable!(),
        }, |E| construct_from_u8::<E>(input, len))
    });
    JSValue::create_buffer(global_object, &mut slice[..])
}

/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__encoding__constructFromUTF16(
    global_object: &JSGlobalObject,
    input: *const u16,
    len: usize,
    encoding: u8,
) -> JSValue {
    // Ownership of the allocation transfers to JSC: `create_buffer` registers the
    // pointer with `MarkedArrayBuffer_deallocator`, which frees it on GC. Wrapping
    // in `ManuallyDrop` prevents Rust from also freeing it at scope exit (which
    // would be a use-after-free + double-free).
    // SAFETY: forwarded from this fn's contract.
    let mut slice = core::mem::ManuallyDrop::new(unsafe {
        dispatch_encoding!(encoding_from_u8(encoding), {
            Encoding::Ucs2 => construct_from_u16::<{ enc::UTF16LE }>(input, len),
            Encoding::Buffer => unreachable!(),
        }, |E| construct_from_u16::<E>(input, len))
    });
    JSValue::create_buffer(global_object, &mut slice[..])
}

// for SQL statement
/// # Safety
/// Caller (C++) must guarantee `input[..len]` is valid for reading.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__encoding__toStringUTF8(
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
pub(crate) unsafe extern "C" fn Bun__encoding__toString(
    input: *const u8,
    len: usize,
    global_object: &JSGlobalObject,
    encoding: u8,
) -> JSValue {
    // SAFETY: forwarded from this fn's contract.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    match to_string(input, global_object, encoding_from_u8(encoding)) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
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
        return BunString::empty();
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
        Encoding::Buffer | Encoding::Utf8 => {
            let converted = match strings::to_utf16_alloc(&input, false, false) {
                Ok(v) => v,
                Err(_) => {
                    // input dropped
                    return BunString::dead();
                }
            };

            if let Some(utf16) = converted {
                // input dropped at end of scope
                return create_external_globally_allocated_utf16(utf16);
            }

            // If we get here, it means we can safely assume the string is 100% ASCII characters
            create_external_globally_allocated_latin1(input)
        }
        Encoding::Ucs2 | Encoding::Utf16le => {
            // Avoid incomplete characters - if input length is 0 or odd, handle gracefully
            let usable_len = if !input.len().is_multiple_of(2) {
                input.len() - 1
            } else {
                input.len()
            };

            if usable_len == 0 {
                // input dropped
                return BunString::empty();
            }

            // Allocate a fresh u16-aligned Vec and copy the bytes. Rebuilding a
            // `Vec<u16>` from a `Vec<u8>`'s raw parts would violate `Vec`'s
            // Layout contract: alloc happened with align 1, but the eventual
            // dealloc as `Vec<u16>` uses align 2. mimalloc gives us aligned
            // pointers in practice, so that wouldn't crash, but it's UB on
            // paper and an allocator change could surface it. Mirrors
            // `construct_from_u16`'s utf16le arm, which avoids the same
            // reinterpret for the same reason.
            let mut as_u16 = vec![0u16; usable_len / 2];
            let dst: &mut [u8] = bun_core::cast::cast_slice_mut(&mut as_u16);
            dst.copy_from_slice(&input[..usable_len]);
            create_external_globally_allocated_utf16(as_u16)
        }

        Encoding::Hex => {
            // input dropped at end of scope
            let (str, chars) = BunString::create_uninitialized_latin1(input.len() * 2);

            if str.is_dead() {
                return str;
            }

            let wrote = strings::encode_bytes_to_hex(chars, &input);

            // Return an empty string in this case, just like node.
            if wrote < chars.len() {
                str.deref();
                return BunString::empty();
            }

            str
        }

        // TODO: this is not right. There is an issue here. But it needs to
        // be addressed separately because constructFromU8's base64url also
        // appears inconsistent with Node.js.
        Encoding::Base64url => {
            // input dropped at end of scope
            let out_len = bun_base64::url_safe_encode_len(&input);
            let (out, chars) = BunString::create_uninitialized_latin1(out_len);
            if !out.is_dead() {
                let _ = bun_base64::encode_url_safe(chars, &input);
            }
            out
        }

        Encoding::Base64 => {
            // input dropped at end of scope
            let to_len = bun_base64::encode_len(&input);
            let (str, chars) = BunString::create_uninitialized_latin1(to_len);
            if str.is_dead() {
                return str;
            }
            let wrote = bun_base64::encode(chars, &input);
            debug_assert_eq!(wrote, to_len);
            str
        }
    }
}

pub(crate) fn to_string_comptime<const ENCODING: u8>(
    input: &[u8],
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let mut bun_string = to_bun_string_comptime::<ENCODING>(input);
    bun_string.transfer_to_js(global)
}

pub(crate) fn to_bun_string(input: &[u8], encoding: impl Into<Encoding>) -> BunString {
    dispatch_encoding!(encoding.into(), |E| to_bun_string_comptime::<E>(input))
}

pub(crate) fn to_bun_string_comptime<const ENCODING: u8>(input: &[u8]) -> BunString {
    if input.is_empty() {
        return BunString::empty();
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
                Err(_) => return BunString::dead(),
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
                return BunString::empty();
            }

            let chars_len = input.len() / 2;
            let (str, chars) = BunString::create_uninitialized_utf16(chars_len);
            if str.is_dead() {
                return str;
            }
            // chars is a freshly-allocated [u16] buffer; reinterpret as bytes.
            let output_bytes: &mut [u8] = bun_core::cast::cast_slice_mut(chars);
            let out_len = output_bytes.len();
            output_bytes[out_len - 1] = 0;

            output_bytes.copy_from_slice(&input[..out_len]);
            str
        }

        Encoding::Hex => {
            let (str, chars) = BunString::create_uninitialized_latin1(input.len() * 2);
            if str.is_dead() {
                return str;
            }

            let wrote = strings::encode_bytes_to_hex(chars, input);
            debug_assert!(wrote == chars.len());
            str
        }

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

    let mut to: Vec<u8> = Vec::new();
    if to.try_reserve_exact(to_len).is_err() {
        return BunString::dead();
    }
    // SAFETY: the spare bytes are write-only; the encoder reports how many it
    // initialized and only those are committed.
    let wrote = unsafe {
        bun_core::vec::fill_spare(&mut to, 0, |spare| {
            let wrote = if url_safe {
                bun_base64::encode_url_safe(&mut spare[..to_len], input)
            } else {
                bun_base64::encode(&mut spare[..to_len], input)
            };
            (wrote, wrote)
        })
    };
    debug_assert_eq!(wrote, to_len);
    create_external_globally_allocated_latin1(to)
}

/// `ALLOW_PARTIAL_WRITE` selects Node's `Buffer#fill` semantics: the encoding
/// is truncated at the byte level, so a code unit / code point that only partly
/// fits still gets its leading bytes. Without it (`buf.write`), stop at whole units.
///
/// # Safety
/// `input` must be valid for reading `len` bytes and `to_ptr` must be valid for
/// writing `to_len` bytes; the two ranges must not overlap.
pub(crate) unsafe fn write_u8<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: *const u8,
    len: usize,
    to_ptr: *mut u8,
    to_len: usize,
) -> Result<usize, crate::Error> {
    if len == 0 || to_len == 0 {
        return Ok(0);
    }

    // TODO: increase temporary buffer size for larger amounts of data

    // SAFETY: caller guarantees `input[..len]` and `to_ptr[..to_len]` are valid; len/to_len > 0.
    let (input_slice, to_slice) = unsafe {
        (
            bun_core::ffi::slice(input, len),
            slice::from_raw_parts_mut(to_ptr, to_len),
        )
    };

    match encoding_from_u8(ENCODING) {
        Encoding::Buffer | Encoding::Latin1 => {
            let written = len.min(to_len);
            to_slice[..written].copy_from_slice(&input_slice[..written]);

            Ok(written)
        }
        Encoding::Ascii => {
            let written = len.min(to_len);

            let to = &mut to_slice[..written];
            let remain = &input_slice[..written];

            if bun_simdutf::validate::ascii(remain) {
                to.copy_from_slice(remain);
            } else {
                strings::copy_latin1_into_ascii(to, remain);
            }

            Ok(written)
        }
        Encoding::Utf8 => {
            let r = strings::copy_latin1_into_utf8(to_slice, input_slice);
            let mut written = r.written as usize;
            // `copy_latin1_into_utf8` stops at whole code points. Under
            // byte-level truncation, a Latin-1 char >= 0x80 whose 2-byte
            // sequence straddles the end still gets its lead byte.
            if ALLOW_PARTIAL_WRITE && written < to_len && (r.read as usize) < len {
                debug_assert!(input_slice[r.read as usize] >= 0x80);
                to_slice[written] = 0xC0 | (input_slice[r.read as usize] >> 6);
                written += 1;
            }
            Ok(written)
        }
        // encode latin1 into UTF16
        Encoding::Ucs2 | Encoding::Utf16le => {
            let buf = input_slice;
            let out_units = to_len / 2;
            // `to_slice` already covers `to_ptr[..to_len]`; for the aligned fast
            // path, `cast_slice_mut` gives a safe `&mut [u8] → &mut [u16]` view (it
            // re-checks alignment + even length, both proven here).
            let mut written = if out_units == 0 {
                0
            } else if (to_slice.as_ptr() as usize).is_multiple_of(core::mem::align_of::<u16>()) {
                let output: &mut [u16] =
                    bun_core::cast::cast_slice_mut(&mut to_slice[..out_units * 2]);
                strings::copy_latin1_into_utf16(output, buf).written as usize * 2
            } else {
                // Rust `&mut [u16]` requires natural alignment, so inline the
                // (trivial) widen loop for the misaligned-dest case
                // (each Latin-1 byte → one u16).
                let n = buf.len().min(out_units);
                for i in 0..n {
                    to_slice[i * 2..i * 2 + 2].copy_from_slice(&(buf[i] as u16).to_ne_bytes());
                }
                n * 2
            };
            // Under byte-level truncation the trailing byte of an odd-length
            // destination (shorter than the encoded string) is the low byte
            // of the next code unit.
            if ALLOW_PARTIAL_WRITE && written < to_len && written < buf.len() * 2 {
                to_slice[written] = buf[written / 2];
                written += 1;
            }
            Ok(written)
        }

        Encoding::Hex => Ok(strings::decode_hex_to_bytes_truncate(to_slice, input_slice)),

        Encoding::Base64 | Encoding::Base64url => {
            let is_urlsafe = matches!(encoding_from_u8(ENCODING), Encoding::Base64url);
            Ok(bun_base64::decode_lenient(
                to_slice,
                input_slice,
                is_urlsafe,
            ))
        }
    }
}

/// # Safety
/// `input` must be valid for reading `len` bytes.
pub(crate) unsafe fn byte_length_u8<const ENCODING: u8>(input: *const u8, len: usize) -> usize {
    if len == 0 {
        return 0;
    }

    // SAFETY: forwarded from this fn's contract.
    let input_slice = unsafe { bun_core::ffi::slice(input, len) };

    match encoding_from_u8(ENCODING) {
        Encoding::Utf8 => strings::element_length_latin1_into_utf8(input_slice),

        Encoding::Latin1 | Encoding::Ascii | Encoding::Buffer => len,

        Encoding::Ucs2 | Encoding::Utf16le => {
            strings::element_length_utf8_into_utf16(input_slice) * 2
        }

        Encoding::Hex => len / 2,

        Encoding::Base64 | Encoding::Base64url => bun_base64::decode_len(input_slice),
        // else => return &[_]u8{};
    }
}

pub(crate) fn encode_into_from16<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: &[u16],
    to: &mut [u8],
) -> Result<usize, crate::Error> {
    // SAFETY: pointers/lengths come from valid, non-overlapping borrowed slices.
    unsafe {
        write_u16::<ENCODING, ALLOW_PARTIAL_WRITE>(
            input.as_ptr(),
            input.len(),
            to.as_mut_ptr(),
            to.len(),
        )
    }
}

pub(crate) fn encode_into_from8<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: &[u8],
    to: &mut [u8],
) -> Result<usize, crate::Error> {
    // SAFETY: pointers/lengths come from valid, non-overlapping borrowed slices.
    unsafe {
        write_u8::<ENCODING, ALLOW_PARTIAL_WRITE>(
            input.as_ptr(),
            input.len(),
            to.as_mut_ptr(),
            to.len(),
        )
    }
}

/// # Safety
/// `input` must be valid for reading `len` `u16`s and `to` must be valid for
/// writing `to_len` bytes. For `Ucs2`/`Utf16le` the ranges may overlap (memmove
/// semantics); for all other encodings they must not.
pub(crate) unsafe fn write_u16<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: *const u16,
    len: usize,
    to: *mut u8,
    to_len: usize,
) -> Result<usize, crate::Error> {
    if len == 0 {
        return Ok(0);
    }

    // NOTE: Do NOT eagerly materialize `&[u16]` / `&mut [u8]` slices over `input`/`to` here.
    // The Ucs2/Utf16le arm is spec'd to accept overlapping input/output (it copies with
    // memmove semantics). Building a `&mut [u8]` whose memory is also
    // covered by a live `&[u16]` would violate `slice::from_raw_parts_mut`'s exclusive-access
    // contract (aliased-&mut UB). Each arm below constructs only the slice views it needs,
    // and the Ucs2/Utf16le arm stays raw-pointer-only.

    match encoding_from_u8(ENCODING) {
        Encoding::Utf8 => {
            // SAFETY: caller guarantees `input[..len]` and `to[..to_len]` are valid and
            // non-overlapping for this encoding.
            let (input_slice, to_slice) = unsafe {
                (
                    bun_core::ffi::slice(input, len),
                    slice::from_raw_parts_mut(to, to_len),
                )
            };
            Ok(
                strings::copy_utf16_into_utf8_impl::<ALLOW_PARTIAL_WRITE>(to_slice, input_slice)
                    .written as usize,
            )
        }
        Encoding::Latin1 | Encoding::Ascii | Encoding::Buffer => {
            let out = len.min(to_len);
            // SAFETY: caller guarantees `input[..len]` and `to[..to_len]` are valid and
            // non-overlapping for this encoding.
            let (input_slice, to_slice) = unsafe {
                (
                    bun_core::ffi::slice(input, out),
                    slice::from_raw_parts_mut(to, to_len),
                )
            };
            strings::copy_u16_into_u8(to_slice, input_slice);
            Ok(out)
        }
        // string is already encoded, just need to copy the data
        Encoding::Ucs2 | Encoding::Utf16le => {
            if ALLOW_PARTIAL_WRITE {
                let bytes_input_len = len * 2;
                let written = bytes_input_len.min(to_len);
                let input_u8 = input.cast::<u8>();
                // SAFETY: ranges may overlap; use ptr::copy (memmove).
                unsafe { core::ptr::copy(input_u8, to, written) };
                Ok(written)
            } else {
                let bytes_input_len = len * 2;
                let written = bytes_input_len.min(to_len);
                if written < 2 {
                    return Ok(0);
                }

                let fixed_len = (written / 2) * 2;
                let input_u8 = input.cast::<u8>();
                // SAFETY: ranges may overlap; use ptr::copy (memmove).
                unsafe { core::ptr::copy(input_u8, to, fixed_len) };
                Ok(fixed_len)
            }
        }

        Encoding::Hex => {
            // SAFETY: caller guarantees `input[..len]` and `to[..to_len]` are valid and
            // non-overlapping for this encoding.
            let (input_slice, to_slice) = unsafe {
                (
                    bun_core::ffi::slice(input, len),
                    slice::from_raw_parts_mut(to, to_len),
                )
            };
            Ok(strings::decode_hex_to_bytes_truncate(to_slice, input_slice))
        }

        Encoding::Base64 | Encoding::Base64url => {
            // Match Node.js: two-byte strings are decoded from the low byte of
            // each UTF-16 code unit (so e.g. U+013D behaves like '=' and
            // U+1234 like '4'), the same narrowing Node's lenient fallback
            // decoder applies.
            // SAFETY: caller guarantees `input[..len]` is valid; only an immutable view is
            // needed here since the output goes through `write_u8` with raw `to`.
            let input_slice = unsafe { bun_core::ffi::slice(input, len) };
            let mut narrowed = vec![0u8; len];
            strings::copy_u16_into_u8(&mut narrowed, input_slice);
            // SAFETY: `narrowed` is a valid local Vec; `to[..to_len]` validity is
            // forwarded from this fn's contract and is disjoint from `narrowed`.
            unsafe {
                write_u8::<ENCODING, ALLOW_PARTIAL_WRITE>(
                    narrowed.as_ptr(),
                    narrowed.len(),
                    to,
                    to_len,
                )
            }
        } // else => return &[_]u8{};
    }
}

/// # Safety
/// `input` must be valid for reading `len` bytes.
pub(crate) unsafe fn construct_from_u8<const ENCODING: u8>(
    input: *const u8,
    len: usize,
) -> Vec<u8> {
    if len == 0 {
        return Vec::new();
    }

    // SAFETY: forwarded from this fn's contract.
    let input_slice = unsafe { bun_core::ffi::slice(input, len) };

    match encoding_from_u8(ENCODING) {
        Encoding::Buffer => {
            let mut to = vec![0u8; len];
            to.copy_from_slice(input_slice);
            to
        }
        Encoding::Latin1 | Encoding::Ascii => {
            let mut to = vec![0u8; len];
            to.copy_from_slice(input_slice);
            to
        }
        Encoding::Utf8 => {
            // need to encode
            strings::allocate_latin1_into_utf8(input_slice).unwrap_or_default()
        }
        // encode latin1 into UTF16
        // return as bytes
        Encoding::Ucs2 | Encoding::Utf16le => {
            // Each Latin-1 byte widens to one native-endian u16 code unit
            // (`copy_latin1_into_utf16` is exactly that loop). Write the bytes
            // directly into a `Vec<u8>` so we never depend on an allocator-
            // layout-dependent `Vec<u16> → Vec<u8>` header reinterpret.
            let mut to = vec![0u8; len * 2];
            for (out, &b) in to.chunks_exact_mut(2).zip(input_slice) {
                out.copy_from_slice(&u16::from(b).to_ne_bytes());
            }
            to
        }

        Encoding::Hex => {
            if len < 2 {
                return Vec::new();
            }

            let mut to = vec![0u8; len / 2];
            let wrote = strings::decode_hex_to_bytes_truncate(&mut to, input_slice);
            if wrote == 0 {
                // No valid hex pairs were decoded (e.g. Buffer.from("zz", "hex")). The
                // allocation is unreachable once we return a zero-length slice, so free
                // it here instead of leaking it.
                return Vec::new();
            }
            to.truncate(wrote);
            to
        }

        Encoding::Base64 | Encoding::Base64url => {
            const TRIM_CHARS: &[u8] = b"\r\n\t \x0B"; // \x0B = vertical tab
            let slice = strings::trim(input_slice, TRIM_CHARS);
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

/// # Safety
/// `input` must be valid for reading `len` `u16`s.
pub(crate) unsafe fn construct_from_u16<const ENCODING: u8>(
    input: *const u16,
    len: usize,
) -> Vec<u8> {
    if len == 0 {
        return Vec::new();
    }

    // SAFETY: forwarded from this fn's contract.
    let input_slice = unsafe { bun_core::ffi::slice(input, len) };

    match encoding_from_u8(ENCODING) {
        Encoding::Utf8 => strings::to_utf8_alloc_with_type(input_slice),
        Encoding::Latin1 | Encoding::Buffer | Encoding::Ascii => {
            let mut to = vec![0u8; len];
            strings::copy_u16_into_u8(&mut to, input_slice);
            to
        }
        // string is already encoded, just need to copy the data
        Encoding::Ucs2 | Encoding::Utf16le => {
            // `input_slice: &[u16]` is the source bytes verbatim — copy them
            // out into a fresh u8 Vec (a `Vec<u16>` header reinterpret would be
            // allocator-layout-dependent).
            bun_core::cast::cast_slice::<u16, u8>(input_slice).to_vec()
        }

        Encoding::Hex => {
            if len < 2 {
                return Vec::new();
            }

            let mut to = vec![0u8; len / 2];
            let wrote = strings::decode_hex_to_bytes_truncate(&mut to, input_slice);
            if wrote == 0 {
                return Vec::new();
            }
            to.truncate(wrote);
            to
        }

        Encoding::Base64 | Encoding::Base64url => {
            // Match Node.js: two-byte strings are decoded from the low byte of
            // each UTF-16 code unit (so e.g. U+013D behaves like '=' and
            // U+1234 like '4'), the same narrowing Node's lenient fallback
            // decoder applies.
            let mut narrowed = vec![0u8; len];
            strings::copy_u16_into_u8(&mut narrowed, input_slice);
            // SAFETY: `narrowed` is a valid local Vec.
            unsafe { construct_from_u8::<ENCODING>(narrowed.as_ptr(), narrowed.len()) }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `String` / `ZigString` encoding extension traits.
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
    let (p, n) = (input.as_ptr(), input.len());
    // SAFETY: pointer/length come from a valid borrowed slice.
    dispatch_encoding!(encoding, |E| unsafe { construct_from_u8::<E>(p, n) })
}

/// Runtime-dispatch wrapper over [`construct_from_u16`].
fn construct_from_u16_dyn(input: &[u16], encoding: Encoding) -> Vec<u8> {
    let (p, n) = (input.as_ptr(), input.len());
    // SAFETY: pointer/length come from a valid borrowed slice.
    dispatch_encoding!(encoding, |E| unsafe { construct_from_u16::<E>(p, n) })
}

/// Runtime-dispatch wrapper over [`encode_into_from16`] (passes
/// `ALLOW_PARTIAL_WRITE = true`).
fn encode_into_from16_dyn(
    input: &[u16],
    to: &mut [u8],
    encoding: Encoding,
) -> Result<usize, crate::Error> {
    dispatch_encoding!(encoding, |E| encode_into_from16::<E, true>(input, to))
}

/// Runtime-dispatch wrapper over [`encode_into_from8`] (passes
/// `ALLOW_PARTIAL_WRITE = true`, matching the 16-bit twin: the result must
/// not depend on the string's internal storage width).
fn encode_into_from8_dyn(
    input: &[u8],
    to: &mut [u8],
    encoding: Encoding,
) -> Result<usize, crate::Error> {
    dispatch_encoding!(encoding, |E| encode_into_from8::<E, true>(input, to))
}

/// Extension trait — see module note above for why this lives in
/// `bun_runtime`.
pub trait BunStringEncode {
    fn encode_into(&self, out: &mut [u8], enc: Encoding) -> Result<usize, crate::Error>;
    fn encode(&self, enc: Encoding) -> Vec<u8>;
}

impl BunStringEncode for bun_core::String {
    /// `bun.String.encodeInto` — encode `self` into `out`. Returns bytes written.
    fn encode_into(&self, out: &mut [u8], enc: Encoding) -> Result<usize, crate::Error> {
        if self.is_utf16() {
            return encode_into_from16_dyn(self.utf16(), out, enc);
        }
        if self.is_utf8() {
            // The UTF-8 source path was never implemented.
            unreachable!("String.encodeInto from UTF-8 source — unimplemented in Zig");
        }
        encode_into_from8_dyn(self.latin1(), out, enc)
    }

    /// Encode `self` with the given encoding.
    fn encode(&self, enc: Encoding) -> Vec<u8> {
        self.to_zig_string().encode_with_allocator(enc)
    }
}

/// `ZigString` encoding. Extension trait — encoder bodies live in this crate.
pub trait ZigStringEncode {
    fn encode_with_allocator(&self, enc: Encoding) -> Vec<u8>;
    #[inline]
    fn encode(&self, enc: Encoding) -> Vec<u8> {
        self.encode_with_allocator(enc)
    }
}

impl ZigStringEncode for bun_core::ZigString {
    fn encode_with_allocator(&self, enc: Encoding) -> Vec<u8> {
        if self.is_16bit() {
            construct_from_u16_dyn(self.utf16_slice(), enc)
        } else {
            construct_from_u8_dyn(self.slice(), enc)
        }
    }
}
