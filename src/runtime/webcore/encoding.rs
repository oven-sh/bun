//! Contains helpers for C++ to do TextEncoder/Decoder like operations.
//! Also contains the code used by `bun.String.encode` and `bun.String.encodeInto`

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
// Exported C ABI entry points (thunks in `generated_host_exports.rs`)
// ────────────────────────────────────────────────────────────────────────────

// HOST_EXPORT(Bun__encoding__writeLatin1, c)
pub fn write_latin1(input: &[u8], to: &mut [u8], encoding: u8) -> usize {
    let r = dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Ucs2 => write_u8::<{ enc::UTF16LE }, false>(input, to),
        Encoding::Buffer => unreachable!(),
    }, |E| write_u8::<E, false>(input, to));
    r.unwrap_or(0)
}

// HOST_EXPORT(Bun__encoding__writeUTF16, c)
pub fn write_utf16(input: &[u16], to: &mut [u8], encoding: u8) -> usize {
    let r = dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Latin1 => write_u16::<{ enc::ASCII }, false>(input, to),
        Encoding::Ucs2 => write_u16::<{ enc::UTF16LE }, false>(input, to),
        Encoding::Buffer => unreachable!(),
    }, |E| write_u16::<E, false>(input, to));
    r.unwrap_or(0)
}

// HOST_EXPORT(Bun__encoding__byteLengthLatin1AsUTF8, c)
pub fn byte_length_latin1_as_utf8(input: &[u8]) -> usize {
    byte_length_u8::<{ enc::UTF8 }>(input)
}

// HOST_EXPORT(Bun__encoding__byteLengthUTF16AsUTF8, c)
pub fn byte_length_utf16_as_utf8(input: &[u16]) -> usize {
    strings::element_length_utf16_into_utf8(input)
}

// HOST_EXPORT(Bun__encoding__constructFromLatin1, c)
pub fn construct_from_latin1(
    global_object: &JSGlobalObject,
    input: &[u8],
    encoding: u8,
) -> JSValue {
    // Ownership of the allocation transfers to JSC: `create_buffer` registers the
    // pointer with `MarkedArrayBuffer_deallocator`, which frees it on GC. Wrapping
    // in `ManuallyDrop` prevents Rust from also freeing it at scope exit (which
    // would be a use-after-free + double-free).
    let mut slice = core::mem::ManuallyDrop::new(dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Ucs2 => construct_from_u8::<{ enc::UTF16LE }>(input),
        Encoding::Latin1 | Encoding::Buffer => unreachable!(),
    }, |E| construct_from_u8::<E>(input)));
    bun_jsc::HostReturn::or_pending_exception(JSValue::create_buffer(global_object, &mut slice[..]))
}

// HOST_EXPORT(Bun__encoding__constructFromUTF16, c)
pub fn construct_from_utf16(
    global_object: &JSGlobalObject,
    input: &[u16],
    encoding: u8,
) -> JSValue {
    // Ownership of the allocation transfers to JSC: `create_buffer` registers the
    // pointer with `MarkedArrayBuffer_deallocator`, which frees it on GC. Wrapping
    // in `ManuallyDrop` prevents Rust from also freeing it at scope exit (which
    // would be a use-after-free + double-free).
    let mut slice = core::mem::ManuallyDrop::new(dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Ucs2 => construct_from_u16::<{ enc::UTF16LE }>(input),
        Encoding::Buffer => unreachable!(),
    }, |E| construct_from_u16::<E>(input)));
    bun_jsc::HostReturn::or_pending_exception(JSValue::create_buffer(global_object, &mut slice[..]))
}

// for SQL statement
// HOST_EXPORT(Bun__encoding__toStringUTF8, c)
pub fn to_string_utf8(input: &[u8], global_object: &JSGlobalObject) -> JSValue {
    match to_string_comptime::<{ enc::UTF8 }>(input, global_object) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}

// HOST_EXPORT(Bun__encoding__toString, c)
pub fn to_string_dyn(input: &[u8], global_object: &JSGlobalObject, encoding: u8) -> JSValue {
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

        Encoding::Hex => {
            // input dropped at end of scope
            let (str, chars) = BunString::create_uninitialized_latin1(input.len() * 2);

            if str.is_dead() {
                return str;
            }

            let wrote = strings::encode_bytes_to_hex(chars, &input);

            // Return an empty string in this case, just like node.
            if wrote < chars.len() {
                return BunString::EMPTY;
            }

            str
        }

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
            // chars is a freshly-allocated [u16] buffer; reinterpret as bytes.
            let output_bytes: &mut [u8] = bytemuck::cast_slice_mut(chars);
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

    // `create_external_globally_allocated_latin1` would reject this length
    // after the encode; checked first so a failed reserve below is a true OOM.
    if to_len > BunString::max_length() {
        return BunString::DEAD;
    }
    let mut to: Vec<u8> = Vec::new();
    if to.try_reserve_exact(to_len).is_err() {
        return BunString::OUT_OF_MEMORY;
    }
    let wrote = if url_safe {
        bun_base64::encode_url_safe_append(&mut to, input)
    } else {
        bun_base64::encode_append(&mut to, input)
    };
    debug_assert_eq!(wrote, to_len);
    create_external_globally_allocated_latin1(to)
}

/// `ALLOW_PARTIAL_WRITE` selects Node's `Buffer#fill` semantics: the encoding
/// is truncated at the byte level, so a code unit / code point that only partly
/// fits still gets its leading bytes. Without it (`buf.write`), stop at whole units.
pub(crate) fn write_u8<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: &[u8],
    to: &mut [u8],
) -> Result<usize, crate::Error> {
    if input.is_empty() || to.is_empty() {
        return Ok(0);
    }

    // TODO: increase temporary buffer size for larger amounts of data

    match encoding_from_u8(ENCODING) {
        Encoding::Buffer | Encoding::Latin1 => {
            let written = input.len().min(to.len());
            to[..written].copy_from_slice(&input[..written]);

            Ok(written)
        }
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
        Encoding::Utf8 => {
            let r = strings::copy_latin1_into_utf8(to, input);
            let mut written = r.written as usize;
            // `copy_latin1_into_utf8` stops at whole code points. Under
            // byte-level truncation, a Latin-1 char >= 0x80 whose 2-byte
            // sequence straddles the end still gets its lead byte.
            if ALLOW_PARTIAL_WRITE && written < to.len() && (r.read as usize) < input.len() {
                debug_assert!(input[r.read as usize] >= 0x80);
                to[written] = 0xC0 | (input[r.read as usize] >> 6);
                written += 1;
            }
            Ok(written)
        }
        // encode latin1 into UTF16
        Encoding::Ucs2 | Encoding::Utf16le => {
            let buf = input;
            let out_units = to.len() / 2;
            // For the aligned fast path, `bytemuck` gives a safe `&mut [u8] → &mut [u16]`
            // view (it re-checks alignment + even length, both proven here).
            let mut written = if out_units == 0 {
                0
            } else if (to.as_ptr() as usize).is_multiple_of(core::mem::align_of::<u16>()) {
                let output: &mut [u16] = bytemuck::cast_slice_mut(&mut to[..out_units * 2]);
                strings::copy_latin1_into_utf16(output, buf).written as usize * 2
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

        Encoding::Hex => Ok(strings::decode_hex_to_bytes_truncate(to, input)),

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

/// [`write_u8`] for a UTF-16 source. `input` and `to` never share memory, so
/// every arm is a plain copy (as in [`write_u8`]): `input` is always a JS
/// string's characters (`JSString::view()` in `Buffer.prototype.write` /
/// `Buffer.fill` / `napi_get_value_string_*`), which JSC keeps immutable and
/// never backs with `ArrayBuffer` storage, and `to` is typed-array storage or a
/// NAPI caller's own out-buffer. The C++ declarations carry the same contract.
pub(crate) fn write_u16<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: &[u16],
    to: &mut [u8],
) -> Result<usize, crate::Error> {
    if input.is_empty() || to.is_empty() {
        return Ok(0);
    }

    match encoding_from_u8(ENCODING) {
        Encoding::Utf8 => Ok(
            strings::copy_utf16_into_utf8_impl::<ALLOW_PARTIAL_WRITE>(to, input).written as usize,
        ),
        Encoding::Latin1 | Encoding::Ascii | Encoding::Buffer => {
            let out = input.len().min(to.len());
            strings::copy_u16_into_u8(to, &input[..out]);
            Ok(out)
        }
        // string is already encoded, just need to copy the data
        Encoding::Ucs2 | Encoding::Utf16le => {
            let bytes: &[u8] = bytemuck::cast_slice(input);
            let written = bytes.len().min(to.len());
            let written = if ALLOW_PARTIAL_WRITE {
                written
            } else if written < 2 {
                return Ok(0);
            } else {
                (written / 2) * 2
            };
            to[..written].copy_from_slice(&bytes[..written]);
            Ok(written)
        }

        Encoding::Hex => Ok(strings::decode_hex_to_bytes_truncate(to, input)),

        Encoding::Base64 | Encoding::Base64url => {
            // Match Node.js: two-byte strings are decoded from the low byte of
            // each UTF-16 code unit (so e.g. U+013D behaves like '=' and
            // U+1234 like '4'), the same narrowing Node's lenient fallback
            // decoder applies.
            write_u8::<ENCODING, ALLOW_PARTIAL_WRITE>(&narrow_u16_to_u8(input), to)
        } // else => return &[_]u8{};
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
            let mut to: Vec<u8> = Vec::new();
            strings::append_latin1_as_utf16_bytes(&mut to, input);
            to
        }

        Encoding::Hex => construct_from_hex(input),

        Encoding::Base64 | Encoding::Base64url => {
            const TRIM_CHARS: &[u8] = b"\r\n\t \x0B"; // \x0B = vertical tab
            let slice = strings::trim(input, TRIM_CHARS);
            if slice.is_empty() {
                return Vec::new();
            }

            let is_urlsafe = matches!(encoding_from_u8(ENCODING), Encoding::Base64url);
            // Decoded straight into what becomes the Buffer's storage (no
            // zero-fill, no second copy).
            let mut to: Vec<u8> = Vec::new();
            if bun_base64::decode_lenient_append(&mut to, slice, is_urlsafe) == 0 {
                return Vec::new();
            }
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
            bytemuck::cast_slice::<u16, u8>(input).to_vec()
        }

        Encoding::Hex => construct_from_hex(input),

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
    input.iter().map(|&unit| unit as u8).collect()
}

/// Decodes hex pairs up to the first invalid one (`Buffer.from("..", "hex")` semantics).
fn construct_from_hex<Char: strings::HexChar>(input: &[Char]) -> Vec<u8> {
    let outlen = input.len() / 2;
    if outlen == 0 {
        return Vec::new();
    }

    let mut to: Vec<u8> = Vec::new();
    // `create_buffer` frees nothing for an empty slice, so an empty result must not own memory.
    if strings::decode_hex_append(&mut to, input) == 0 {
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
pub trait BunStringEncode {
    fn encode(&self, enc: Encoding) -> Vec<u8>;
}

impl BunStringEncode for bun_core::String {
    /// Encode `self` with the given encoding.
    fn encode(&self, enc: Encoding) -> Vec<u8> {
        self.to_encoded_slice().encode_with_allocator(enc)
    }
}

/// `EncodedSlice` encoding. Extension trait — encoder bodies live in this crate.
pub trait EncodedSliceEncode {
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
