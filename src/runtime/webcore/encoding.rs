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
// PORT NOTE: Zig used `comptime encoding: Encoding`. Stable Rust does not allow
// enum-typed const generics without `#![feature(adt_const_params)]`, so per
// PORTING.md we reshape to `const ENCODING: u8` and reconstitute the enum
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
#[allow(non_snake_case, dead_code)]
mod enc {
    use super::Encoding;
    pub const UTF8: u8 = Encoding::Utf8 as u8;
    pub const UCS2: u8 = Encoding::Ucs2 as u8;
    pub const UTF16LE: u8 = Encoding::Utf16le as u8;
    pub const LATIN1: u8 = Encoding::Latin1 as u8;
    pub const ASCII: u8 = Encoding::Ascii as u8;
    pub const BASE64: u8 = Encoding::Base64 as u8;
    pub const BASE64URL: u8 = Encoding::Base64url as u8;
    pub const HEX: u8 = Encoding::Hex as u8;
    pub const BUFFER: u8 = Encoding::Buffer as u8;
}

// ────────────────────────────────────────────────────────────────────────────
// `dispatch_encoding!` — Rust spelling of Zig's `switch (enc) { inline else
// => |e| f(..., e) }`. Expands a runtime [`Encoding`] into nine monomorphized
// arms, binding the discriminant as a `const $E: u8` usable in const-generic
// position (`f::<$E>(..)`). Stable-Rust workaround for `adt_const_params`.
//
// Two forms:
//   • pure      — every variant maps 1:1 to its own discriminant.
//   • override  — leading explicit arms (aliasing / `unreachable!()`), macro
//                 fills the identity tail; overridden tail arms are dead and
//                 silenced with `#[allow(unreachable_patterns)]`.
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
    // override: leading explicit arms; identity tail is filled and silenced
    ($scrut:expr, { $($pat:pat => $arm:expr),+ $(,)? }, |$E:ident| $body:expr) => {
        match $scrut {
            $($pat => $arm,)+
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Utf8      => { const $E: u8 = $crate::node::types::Encoding::Utf8      as u8; $body }
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Ucs2      => { const $E: u8 = $crate::node::types::Encoding::Ucs2      as u8; $body }
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Utf16le   => { const $E: u8 = $crate::node::types::Encoding::Utf16le   as u8; $body }
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Latin1    => { const $E: u8 = $crate::node::types::Encoding::Latin1    as u8; $body }
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Ascii     => { const $E: u8 = $crate::node::types::Encoding::Ascii     as u8; $body }
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Base64    => { const $E: u8 = $crate::node::types::Encoding::Base64    as u8; $body }
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Base64url => { const $E: u8 = $crate::node::types::Encoding::Base64url as u8; $body }
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Hex       => { const $E: u8 = $crate::node::types::Encoding::Hex       as u8; $body }
            #[allow(unreachable_patterns)] $crate::node::types::Encoding::Buffer    => { const $E: u8 = $crate::node::types::Encoding::Buffer    as u8; $body }
        }
    };
}
pub(crate) use dispatch_encoding;

// ────────────────────────────────────────────────────────────────────────────
// Exported C ABI entry points
// ────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__writeLatin1(
    input: *const u8,
    len: usize,
    to: *mut u8,
    to_len: usize,
    encoding: u8,
) -> usize {
    // SAFETY: caller (C++) guarantees `input[..len]` and `to[..to_len]` are valid.
    let r = dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Ucs2 => write_u8::<{ enc::UTF16LE }>(input, len, to, to_len),
        Encoding::Buffer => unreachable!(),
    }, |E| write_u8::<E>(input, len, to, to_len));
    r.unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__writeUTF16(
    input: *const u16,
    len: usize,
    to: *mut u8,
    to_len: usize,
    encoding: u8,
) -> usize {
    let r = dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Latin1 => write_u16::<{ enc::ASCII }, false>(input, len, to, to_len),
        Encoding::Ucs2 => write_u16::<{ enc::UTF16LE }, false>(input, len, to, to_len),
        Encoding::Buffer => unreachable!(),
    }, |E| write_u16::<E, false>(input, len, to, to_len));
    r.unwrap_or(0)
}

// TODO(@190n) handle unpaired surrogates
#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__byteLengthLatin1AsUTF8(input: *const u8, len: usize) -> usize {
    byte_length_u8::<{ enc::UTF8 }>(input, len)
}

// TODO(@190n) handle unpaired surrogates
#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__byteLengthUTF16AsUTF8(input: *const u16, len: usize) -> usize {
    // SAFETY: caller guarantees `input[..len]` is valid.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    strings::element_length_utf16_into_utf8(input)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__constructFromLatin1(
    global_object: &JSGlobalObject,
    input: *const u8,
    len: usize,
    encoding: u8,
) -> JSValue {
    // Ownership of the allocation transfers to JSC: `create_buffer` registers the
    // pointer with `MarkedArrayBuffer_deallocator`, which frees it on GC. Wrapping
    // in `ManuallyDrop` prevents Rust from also freeing it at scope exit (which
    // would be a use-after-free + double-free). Mirrors encoding.zig:42-54.
    let mut slice = core::mem::ManuallyDrop::new(dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Ucs2 => construct_from_u8::<{ enc::UTF16LE }>(input, len),
        Encoding::Latin1 | Encoding::Buffer => unreachable!(),
    }, |E| construct_from_u8::<E>(input, len)));
    JSValue::create_buffer(global_object, &mut slice[..])
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__constructFromUTF16(
    global_object: &JSGlobalObject,
    input: *const u16,
    len: usize,
    encoding: u8,
) -> JSValue {
    // Ownership of the allocation transfers to JSC: `create_buffer` registers the
    // pointer with `MarkedArrayBuffer_deallocator`, which frees it on GC. Wrapping
    // in `ManuallyDrop` prevents Rust from also freeing it at scope exit (which
    // would be a use-after-free + double-free). Mirrors encoding.zig:56-69.
    let mut slice = core::mem::ManuallyDrop::new(dispatch_encoding!(encoding_from_u8(encoding), {
        Encoding::Ucs2 => construct_from_u16::<{ enc::UTF16LE }>(input, len),
        Encoding::Buffer => unreachable!(),
    }, |E| construct_from_u16::<E>(input, len)));
    JSValue::create_buffer(global_object, &mut slice[..])
}

// for SQL statement
#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__toStringUTF8(
    input: *const u8,
    len: usize,
    global_object: &JSGlobalObject,
) -> JSValue {
    // SAFETY: caller guarantees `input[..len]` is valid.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    match to_string_comptime::<{ enc::UTF8 }>(input, global_object) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__toString(
    input: *const u8,
    len: usize,
    global_object: &JSGlobalObject,
    encoding: u8,
) -> JSValue {
    // SAFETY: caller guarantees `input[..len]` is valid.
    let input = unsafe { bun_core::ffi::slice(input, len) };
    match to_string(input, global_object, encoding_from_u8(encoding)) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}

// pub fn writeUTF16AsUTF8(utf16: [*]const u16, len: usize, to: [*]u8, to_len: usize) callconv(.c) i32 {
//     return @intCast(i32, strings.copyUTF16IntoUTF8(to[0..to_len], []const u16, utf16[0..len]).written);
// }

pub fn to_string(
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

pub fn to_bun_string_from_owned_slice(input: Vec<u8>, encoding: Encoding) -> BunString {
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
            let usable_len = if input.len() % 2 != 0 {
                input.len() - 1
            } else {
                input.len()
            };

            if usable_len == 0 {
                // input dropped
                return BunString::empty();
            }

            // TODO(port): Zig reinterpreted the owned u8 allocation as []u16 (with @alignCast)
            // and handed it to createExternalGloballyAllocated(.utf16, ...). Reinterpreting a
            // Vec<u8> as Vec<u16> is not generally sound in Rust (alignment + allocator layout).
            // Phase B: route through bun_core::String API that accepts raw (ptr,len,cap) bytes.
            // SAFETY: input.as_ptr() is at least 1-aligned; Zig asserted u16 alignment via @alignCast.
            let as_u16 = unsafe {
                let mut input = core::mem::ManuallyDrop::new(input);
                Vec::from_raw_parts(
                    input.as_mut_ptr().cast::<u16>(),
                    usable_len / 2,
                    input.capacity() / 2,
                )
            };
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

pub fn to_string_comptime<const ENCODING: u8>(
    input: &[u8],
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let mut bun_string = to_bun_string_comptime::<ENCODING>(input);
    bun_string.transfer_to_js(global)
}

pub fn to_bun_string(input: &[u8], encoding: impl Into<Encoding>) -> BunString {
    dispatch_encoding!(encoding.into(), |E| to_bun_string_comptime::<E>(input))
}

pub fn to_bun_string_comptime<const ENCODING: u8>(input: &[u8]) -> BunString {
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

        Encoding::Base64url => {
            let to_len = bun_base64::url_safe_encode_len(input);
            let (str, chars) = BunString::create_uninitialized_latin1(to_len);
            if str.is_dead() {
                return str;
            }
            let wrote = bun_base64::encode_url_safe(chars, input);
            debug_assert_eq!(wrote, to_len);
            str
        }

        Encoding::Base64 => {
            let to_len = bun_base64::encode_len(input);
            let (str, chars) = BunString::create_uninitialized_latin1(to_len);
            if str.is_dead() {
                return str;
            }
            let wrote = bun_base64::encode(chars, input);
            debug_assert_eq!(wrote, to_len);
            str
        }
    }
}

// TODO(port): narrow error set — Zig signature is `!usize` but body never fails.
pub fn write_u8<const ENCODING: u8>(
    input: *const u8,
    len: usize,
    to_ptr: *mut u8,
    to_len: usize,
) -> Result<usize, bun_core::Error> {
    if len == 0 || to_len == 0 {
        return Ok(0);
    }

    // TODO: increase temporary buffer size for larger amounts of data
    // defer {
    //     if (comptime encoding.isBinaryToText()) {}
    // }

    // if (comptime encoding.isBinaryToText()) {}

    // SAFETY: caller guarantees `input[..len]` and `to_ptr[..to_len]` are valid; len/to_len > 0.
    let input_slice = unsafe { bun_core::ffi::slice(input, len) };
    let to_slice = unsafe { slice::from_raw_parts_mut(to_ptr, to_len) };

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
            // need to encode
            Ok(strings::copy_latin1_into_utf8(to_slice, input_slice).written as usize)
        }
        // encode latin1 into UTF16
        Encoding::Ucs2 | Encoding::Utf16le => {
            if to_len < 2 {
                return Ok(0);
            }

            let buf = input_slice;
            let out_units = to_len / 2;
            // `to_slice` already covers `to_ptr[..to_len]`; for the aligned fast
            // path, `bytemuck` gives a safe `&mut [u8] → &mut [u16]` view (it
            // re-checks alignment + even length, both proven here).
            if (to_slice.as_ptr() as usize) % core::mem::align_of::<u16>() == 0 {
                let output: &mut [u16] = bytemuck::cast_slice_mut(&mut to_slice[..out_units * 2]);
                let written = strings::copy_latin1_into_utf16(output, buf).written as usize;
                Ok(written * 2)
            } else {
                // PORT NOTE: Zig used `[]align(1) u16` and a generic Buffer type. Rust
                // `&mut [u16]` requires natural alignment, so inline the (trivial) widen
                // loop with `write_unaligned` for the misaligned-dest case — matches
                // `copyLatin1IntoUTF16` body 1:1 (each Latin-1 byte → one u16).
                let written = buf.len().min(out_units);
                let output_ptr = to_slice.as_mut_ptr().cast::<u16>();
                // SAFETY: `to_slice` is valid for `written * 2` bytes; unaligned stores.
                for i in 0..written {
                    unsafe { output_ptr.add(i).write_unaligned(buf[i] as u16) };
                }
                Ok(written * 2)
            }
        }

        Encoding::Hex => Ok(strings::decode_hex_to_bytes_truncate(to_slice, input_slice)),

        Encoding::Base64 | Encoding::Base64url => {
            Ok(bun_base64::decode(to_slice, input_slice).count)
        }
    }
}

pub fn byte_length_u8<const ENCODING: u8>(input: *const u8, len: usize) -> usize {
    if len == 0 {
        return 0;
    }

    // SAFETY: caller guarantees `input[..len]` is valid.
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

pub fn encode_into_from16<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: &[u16],
    to: &mut [u8],
) -> Result<usize, bun_core::Error> {
    write_u16::<ENCODING, ALLOW_PARTIAL_WRITE>(
        input.as_ptr(),
        input.len(),
        to.as_mut_ptr(),
        to.len(),
    )
}

pub fn encode_into_from8<const ENCODING: u8>(
    input: &[u8],
    to: &mut [u8],
) -> Result<usize, bun_core::Error> {
    write_u8::<ENCODING>(input.as_ptr(), input.len(), to.as_mut_ptr(), to.len())
}

// TODO(port): narrow error set
pub fn write_u16<const ENCODING: u8, const ALLOW_PARTIAL_WRITE: bool>(
    input: *const u16,
    len: usize,
    to: *mut u8,
    to_len: usize,
) -> Result<usize, bun_core::Error> {
    if len == 0 {
        return Ok(0);
    }

    // NOTE: Do NOT eagerly materialize `&[u16]` / `&mut [u8]` slices over `input`/`to` here.
    // The Ucs2/Utf16le arm is spec'd to accept overlapping input/output (Zig uses
    // `bun.memmove` at encoding.zig:391/400). Building a `&mut [u8]` whose memory is also
    // covered by a live `&[u16]` would violate `slice::from_raw_parts_mut`'s exclusive-access
    // contract (aliased-&mut UB). Each arm below constructs only the slice views it needs,
    // and the Ucs2/Utf16le arm stays raw-pointer-only.

    match encoding_from_u8(ENCODING) {
        Encoding::Utf8 => {
            // SAFETY: caller guarantees `input[..len]` and `to[..to_len]` are valid and
            // non-overlapping for this encoding.
            let input_slice = unsafe { bun_core::ffi::slice(input, len) };
            let to_slice = unsafe { slice::from_raw_parts_mut(to, to_len) };
            Ok(
                strings::copy_utf16_into_utf8_impl::<ALLOW_PARTIAL_WRITE>(to_slice, input_slice)
                    .written as usize,
            )
        }
        Encoding::Latin1 | Encoding::Ascii | Encoding::Buffer => {
            let out = len.min(to_len);
            // SAFETY: caller guarantees `input[..len]` and `to[..to_len]` are valid and
            // non-overlapping for this encoding.
            let input_slice = unsafe { bun_core::ffi::slice(input, out) };
            let to_slice = unsafe { slice::from_raw_parts_mut(to, to_len) };
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
                // PORT NOTE: Zig wrote `to[0..written]` from `input_u8[0..fixed_len]` (mismatched
                // lengths into bun.memmove). Preserving fixed_len bytes copied as that is what is
                // returned; revisit in Phase B if behavior diverges.
                Ok(fixed_len)
            }
        }

        Encoding::Hex => {
            // SAFETY: caller guarantees `input[..len]` and `to[..to_len]` are valid and
            // non-overlapping for this encoding.
            let input_slice = unsafe { bun_core::ffi::slice(input, len) };
            let to_slice = unsafe { slice::from_raw_parts_mut(to, to_len) };
            Ok(strings::decode_hex_to_bytes_truncate(to_slice, input_slice))
        }

        Encoding::Base64 | Encoding::Base64url => {
            if to_len < 2 || len == 0 {
                return Ok(0);
            }

            // very very slow case!
            // shouldn't really happen though
            // SAFETY: caller guarantees `input[..len]` is valid; only an immutable view is
            // needed here since the output goes through `write_u8` with raw `to`.
            let input_slice = unsafe { bun_core::ffi::slice(input, len) };
            let transcoded = strings::to_utf8_alloc(input_slice);
            // transcoded dropped at end of scope
            write_u8::<ENCODING>(transcoded.as_ptr(), transcoded.len(), to, to_len)
        } // else => return &[_]u8{};
    }
}

// PORT NOTE: Zig `constructFrom(comptime T: type, input: []const T, ...)` dispatched on
// T == u8 vs u16 to constructFromU8/constructFromU16. A u8-only wrapper here would silently
// drop the u16 path, so the generic entry point is omitted — callers use `construct_from_u8`
// / `construct_from_u16` directly.
// TODO(port): if a generic entry point is needed, introduce a sealed trait
// `ConstructFromEncoding` impl'd for u8/u16 so
// `construct_from<T: ConstructFromEncoding, const ENCODING: u8>(input: &[T]) -> Vec<u8>`
// dispatches correctly.

pub fn construct_from_u8<const ENCODING: u8>(input: *const u8, len: usize) -> Vec<u8> {
    if len == 0 {
        return Vec::new();
    }

    // SAFETY: caller guarantees `input[..len]` is valid.
    let input_slice = unsafe { bun_core::ffi::slice(input, len) };

    match encoding_from_u8(ENCODING) {
        Encoding::Buffer => {
            // TODO(port): Zig returned &[] on OOM; Rust aborts.
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
            match strings::allocate_latin1_into_utf8(input_slice) {
                Ok(v) => v,
                Err(_) => Vec::new(),
            }
        }
        // encode latin1 into UTF16
        // return as bytes
        Encoding::Ucs2 | Encoding::Utf16le => {
            // Each Latin-1 byte widens to one native-endian u16 code unit
            // (`copy_latin1_into_utf16` is exactly that loop). Write the bytes
            // directly into a `Vec<u8>` so we never depend on the allocator-
            // layout-dependent `Vec<u16> → Vec<u8>` header reinterpret the Zig
            // original relied on (`sliceAsBytes` over a heap allocation).
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
            const TRIM_CHARS: &[u8] = b"\r\n\t \x0B"; // \x0B = std.ascii.control_code.vt
            let slice = strings::trim(input_slice, TRIM_CHARS);
            if slice.is_empty() {
                return Vec::new();
            }

            let outlen = bun_base64::decode_len(slice);
            let mut to = vec![0u8; outlen];

            let wrote = bun_base64::decode(&mut to[..outlen], slice).count;
            if wrote == 0 {
                return Vec::new();
            }
            to.truncate(wrote);
            to
        }
    }
}

pub fn construct_from_u16<const ENCODING: u8>(input: *const u16, len: usize) -> Vec<u8> {
    if len == 0 {
        return Vec::new();
    }

    // SAFETY: caller guarantees `input[..len]` is valid.
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
            // `input_slice: &[u16]` is the source bytes verbatim — copy them out.
            // The Zig original allocated u16-aligned then reinterpreted the Vec
            // header to u8, which is allocator-layout-dependent in Rust; a fresh
            // u8 Vec sidesteps that and matches the returned `Vec<u8>` layout.
            bytemuck::cast_slice::<u16, u8>(input_slice).to_vec()
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
            // very very slow case!
            // shouldn't really happen though
            let transcoded = strings::to_utf8_alloc(input_slice);
            // transcoded dropped at end of scope
            construct_from_u8::<ENCODING>(transcoded.as_ptr(), transcoded.len())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.String.encodeInto` / `bun.String.encode` / `ZigString.encodeWithAllocator`
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
    dispatch_encoding!(encoding, |E| construct_from_u8::<E>(p, n))
}

/// Runtime-dispatch wrapper over [`construct_from_u16`].
fn construct_from_u16_dyn(input: &[u16], encoding: Encoding) -> Vec<u8> {
    let (p, n) = (input.as_ptr(), input.len());
    dispatch_encoding!(encoding, |E| construct_from_u16::<E>(p, n))
}

/// Runtime-dispatch wrapper over [`encode_into_from16`] (Zig passed
/// `comptime allow_partial_write = true` from `String.encodeInto`).
fn encode_into_from16_dyn(
    input: &[u16],
    to: &mut [u8],
    encoding: Encoding,
) -> Result<usize, bun_core::Error> {
    dispatch_encoding!(encoding, |E| encode_into_from16::<E, true>(input, to))
}

/// Runtime-dispatch wrapper over [`encode_into_from8`].
fn encode_into_from8_dyn(
    input: &[u8],
    to: &mut [u8],
    encoding: Encoding,
) -> Result<usize, bun_core::Error> {
    dispatch_encoding!(encoding, |E| encode_into_from8::<E>(input, to))
}

/// `bun.String.{encodeInto,encode}` (string.zig:630-644). Extension trait —
/// see module note above for why this lives in `bun_runtime`.
pub trait BunStringEncode {
    fn encode_into(&self, out: &mut [u8], enc: Encoding) -> Result<usize, bun_core::Error>;
    fn encode(&self, enc: Encoding) -> Vec<u8>;
}

impl BunStringEncode for bun_core::String {
    /// `bun.String.encodeInto` — encode `self` into `out`. Returns bytes written.
    fn encode_into(&self, out: &mut [u8], enc: Encoding) -> Result<usize, bun_core::Error> {
        if self.is_utf16() {
            return encode_into_from16_dyn(self.utf16(), out, enc);
        }
        if self.is_utf8() {
            // Zig: `@panic("TODO")` — UTF-8 source path was never implemented
            // (string.zig:636). Match Zig behaviour.
            unreachable!("String.encodeInto from UTF-8 source — unimplemented in Zig");
        }
        encode_into_from8_dyn(self.latin1(), out, enc)
    }

    /// `bun.String.encode` (string.zig:642) —
    /// `self.toZigString().encodeWithAllocator(allocator, enc)`.
    fn encode(&self, enc: Encoding) -> Vec<u8> {
        self.to_zig_string().encode_with_allocator(enc)
    }
}

/// `ZigString.encodeWithAllocator` (ZigString.zig). Extension trait — encoder
/// bodies live in this crate.
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

// ported from: src/runtime/webcore/encoding.zig
