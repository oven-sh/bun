//! Prefer using `String` instead of `ZigString` in new code.
//!
//! Port of `src/string/string.zig`.

use core::ffi::c_void;
use core::fmt;
use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use std::sync::Arc;

use core::sync::atomic::{AtomicPtr, Ordering};

use bun_alloc::AllocError;
use bun_core::DebugOnly;
// TODO(b0): Encoding arrives from move-in (TYPE_ONLY bun_jsc::node::Encoding → string)
use crate::encoding::Encoding;
// TODO(b0): webcore_encoding arrives from move-in (MOVE_DOWN bun_jsc::webcore::encoding → string)
use crate::webcore_encoding;

/// Opaque handle to a JSC VM. Low tier never dereferences it; only passes it
/// through to FFI / higher-tier callbacks.
/// SAFETY: erased `bun_jsc::VM` (forward-decl, CYCLEBREAK b0).
#[repr(C)]
pub struct OpaqueJSVM {
    _priv: [u8; 0],
}

/// Hook: max WTFStringImpl length (in characters). Set by `bun_runtime::init()`
/// to `VirtualMachine::string_allocation_limit`. Null → falls back to
/// `i32::MAX` (WTF::String hard limit).
pub static STRING_ALLOCATION_LIMIT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

// Re-exports (thin — do NOT inline target bodies).
pub mod immutable;
pub use immutable as strings;

pub use crate::hashed_string::HashedString;
pub use crate::mutable_string::MutableString;
pub use crate::path_string::PathString;
pub use crate::smol_str::SmolStr;
pub use crate::string_builder::StringBuilder;
pub use crate::string_joiner::StringJoiner;
pub use crate::wtf::{StringImplAllocator, WTFString, WTFStringImpl, WTFStringImplStruct};

// `ZigString` lives in `bun_str` per the crate map (legacy type).
// TODO(port): in Zig this was `bun.jsc.ZigString`; confirm final home is `bun_str`.
use crate::zig_string::ZigString;
use crate::zig_string::Slice as ZigSlice;

pub mod hashed_string;
pub mod mutable_string;
pub mod path_string;
pub mod smol_str;
pub mod string_builder;
pub mod string_joiner;
pub mod wtf;
pub mod zig_string;

// Re-export at crate root for `bun_str::Encoding` callers (picohttp, etc.).
pub use crate::encoding::Encoding as NodeEncoding;

// ──────────────────────────────────────────────────────────────────────────
// move-in: encoding (TYPE_ONLY ← src/runtime/node/types.zig `Encoding`)
// ──────────────────────────────────────────────────────────────────────────

/// Node.js `Buffer` encoding tag. Lives here (not `bun_runtime::node`) so that
/// `bun_str` / `bun_picohttp` / `bun_interchange` can name it without a tier-6
/// dependency. JS-facing helpers (`fromJS`, `assert`, `encodeWithSize`) stay in
/// `bun_runtime::node` (Pass C) — only the tag + pure helpers move down.
pub mod encoding {
    use crate::immutable as strings;

    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Encoding {
        Utf8 = 0,
        Ucs2,
        Utf16le,
        Latin1,
        Ascii,
        Base64,
        Base64url,
        Hex,
        /// Refer to the buffer's encoding
        Buffer,
    }

    impl Encoding {
        pub fn is_binary_to_text(self) -> bool {
            matches!(self, Encoding::Hex | Encoding::Base64 | Encoding::Base64url)
        }

        /// Case-insensitive lookup; mirrors `Encoding.map` in Zig.
        pub fn from(slice: &[u8]) -> Option<Encoding> {
            // PERF(port): was ComptimeStringMap; small fixed set so linear is fine.
            const MAP: &[(&[u8], Encoding)] = &[
                (b"utf-8", Encoding::Utf8),
                (b"utf8", Encoding::Utf8),
                (b"ucs-2", Encoding::Utf16le),
                (b"ucs2", Encoding::Utf16le),
                (b"utf16-le", Encoding::Utf16le),
                (b"utf16le", Encoding::Utf16le),
                (b"binary", Encoding::Latin1),
                (b"latin1", Encoding::Latin1),
                (b"ascii", Encoding::Ascii),
                (b"base64", Encoding::Base64),
                (b"hex", Encoding::Hex),
                (b"buffer", Encoding::Buffer),
                (b"base64url", Encoding::Base64url),
            ];
            for (k, v) in MAP {
                if strings::eql_case_insensitive_ascii::<true>(slice, k) {
                    return Some(*v);
                }
            }
            None
        }
    }

    /// Port of `WebCore.encoding.byteLengthU8` (the latin1-input arm only —
    /// the multi-encoding switch lives in `webcore_encoding`).
    /// Kept here because `WTFStringImpl::utf8_byte_length` calls it directly.
    pub fn byte_length_u8(input: *const u8, len: usize, encoding: Encoding) -> usize {
        if len == 0 {
            return 0;
        }
        // SAFETY: caller passes a valid (ptr,len) pair from a live slice.
        let slice = unsafe { core::slice::from_raw_parts(input, len) };
        match encoding {
            Encoding::Utf8 => strings::element_length_latin1_into_utf8(slice),
            Encoding::Latin1 | Encoding::Ascii | Encoding::Buffer => len,
            Encoding::Ucs2 | Encoding::Utf16le => {
                strings::element_length_utf8_into_utf16(slice) * 2
            }
            Encoding::Hex => len / 2,
            Encoding::Base64 | Encoding::Base64url => {
                // base64 decode length upper bound: ⌈len/4⌉·3 (matches bun.base64.decodeLen).
                ((len + 3) / 4) * 3
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// move-in: webcore_encoding (HOOK ← src/runtime/webcore/encoding.zig)
//
// The full encoder bodies (writeU8/writeU16) are several hundred lines and
// pull in base64/hex/simdutf. Per PORTING.md §Dispatch (debug/crash hooks),
// expose fn-ptr hooks that `bun_runtime::init()` populates. String crate
// callers see plain fns; tier-6 owns the bodies.
// ──────────────────────────────────────────────────────────────────────────

pub mod webcore_encoding {
    use super::{encoding::Encoding, String};
    use core::sync::atomic::{AtomicPtr, Ordering};

    type EncodeInto16 = unsafe fn(*const u16, usize, *mut u8, usize, Encoding, bool) -> usize;
    type EncodeInto8 = unsafe fn(*const u8, usize, *mut u8, usize, Encoding) -> usize;
    type ToBunString = unsafe fn(*const u8, usize, Encoding) -> String;
    type ToBunStringOwned = unsafe fn(*mut u8, usize, Encoding) -> String;

    pub static ENCODE_INTO_FROM16_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    pub static ENCODE_INTO_FROM8_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    pub static TO_BUN_STRING_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    pub static TO_BUN_STRING_OWNED_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

    /// `bun_runtime::init()` calls this once with real impls.
    pub fn install_hooks(
        encode16: EncodeInto16,
        encode8: EncodeInto8,
        to_str: ToBunString,
        to_str_owned: ToBunStringOwned,
    ) {
        ENCODE_INTO_FROM16_HOOK.store(encode16 as *mut (), Ordering::Release);
        ENCODE_INTO_FROM8_HOOK.store(encode8 as *mut (), Ordering::Release);
        TO_BUN_STRING_HOOK.store(to_str as *mut (), Ordering::Release);
        TO_BUN_STRING_OWNED_HOOK.store(to_str_owned as *mut (), Ordering::Release);
    }

    #[inline]
    pub fn encode_into_from16<const ENC: u8>(
        input: &[u16],
        out: &mut [u8],
        allow_partial_write: bool,
    ) -> usize {
        let f = ENCODE_INTO_FROM16_HOOK.load(Ordering::Acquire);
        debug_assert!(!f.is_null(), "webcore_encoding hooks not installed");
        // SAFETY: hook installed by runtime init; ENC is a valid Encoding discriminant.
        unsafe {
            core::mem::transmute::<*mut (), EncodeInto16>(f)(
                input.as_ptr(),
                input.len(),
                out.as_mut_ptr(),
                out.len(),
                core::mem::transmute::<u8, Encoding>(ENC),
                allow_partial_write,
            )
        }
    }

    #[inline]
    pub fn encode_into_from8<const ENC: u8>(input: &[u8], out: &mut [u8]) -> usize {
        let f = ENCODE_INTO_FROM8_HOOK.load(Ordering::Acquire);
        debug_assert!(!f.is_null(), "webcore_encoding hooks not installed");
        unsafe {
            core::mem::transmute::<*mut (), EncodeInto8>(f)(
                input.as_ptr(),
                input.len(),
                out.as_mut_ptr(),
                out.len(),
                core::mem::transmute::<u8, Encoding>(ENC),
            )
        }
    }

    #[inline]
    pub fn to_bun_string_comptime(input: &[u8], encoding: Encoding) -> String {
        let f = TO_BUN_STRING_HOOK.load(Ordering::Acquire);
        if f.is_null() {
            // Fallback for the only call site (`String::create_utf8`, encoding=Utf8)
            // before runtime init: clone via WTF FFI directly.
            debug_assert_eq!(encoding, Encoding::Utf8);
            return String::clone_utf8(input);
        }
        unsafe {
            core::mem::transmute::<*mut (), ToBunString>(f)(input.as_ptr(), input.len(), encoding)
        }
    }

    #[inline]
    pub fn to_bun_string_from_owned_slice(input: Box<[u8]>, encoding: Encoding) -> String {
        let f = TO_BUN_STRING_OWNED_HOOK.load(Ordering::Acquire);
        debug_assert!(!f.is_null(), "webcore_encoding hooks not installed");
        let len = input.len();
        let ptr = Box::into_raw(input) as *mut u8;
        unsafe { core::mem::transmute::<*mut (), ToBunStringOwned>(f)(ptr, len, encoding) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// move-in: lexer (MOVE_DOWN ← src/js_parser/lexer/identifier.zig)
//
// Only the identifier predicates move down — they are pure char-class
// queries that `strings`/`MutableString` need. The non-ASCII Unicode stage
// tables (~120 KB) stay in `bun_js_parser` and are wired in via hook.
// ──────────────────────────────────────────────────────────────────────────

pub mod lexer {
    use core::sync::atomic::{AtomicPtr, Ordering};

    /// `bun_js_parser::init()` writes `is_id_start_esnext` / `is_id_continue_esnext`
    /// here so the slow path can consult the full Unicode tables without
    /// `bun_str` depending on `bun_js_parser`.
    pub static ID_START_ESNEXT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    pub static ID_CONTINUE_ESNEXT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

    type IdPredicate = fn(u32) -> bool;

    pub fn install_hooks(start: IdPredicate, cont: IdPredicate) {
        ID_START_ESNEXT_HOOK.store(start as *mut (), Ordering::Release);
        ID_CONTINUE_ESNEXT_HOOK.store(cont as *mut (), Ordering::Release);
    }

    #[inline]
    pub fn is_identifier_start(codepoint: i32) -> bool {
        match codepoint {
            // 'a'..='z' | 'A'..='Z' | '_' | '$'
            0x61..=0x7A | 0x41..=0x5A | 0x5F | 0x24 => true,
            i32::MIN..=0 => false,
            cp if cp >= 0x10FFFF => false,
            cp => {
                let f = ID_START_ESNEXT_HOOK.load(Ordering::Acquire);
                if f.is_null() {
                    // PERF(port): hook not yet installed (early init) — conservative.
                    return false;
                }
                // SAFETY: installed by js_parser init; cp in 1..0x10FFFF.
                unsafe { core::mem::transmute::<*mut (), IdPredicate>(f)(cp as u32) }
            }
        }
    }

    /// Zig name: `isIdentifierPart` (aliased as `isIdentifierContinue` at call sites).
    #[inline]
    pub fn is_identifier_continue(codepoint: i32) -> bool {
        match codepoint {
            // 'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '$'
            0x61..=0x7A | 0x41..=0x5A | 0x30..=0x39 | 0x5F | 0x24 => true,
            i32::MIN..=0 => false,
            cp if cp >= 0x10FFFF => false,
            cp => {
                let f = ID_CONTINUE_ESNEXT_HOOK.load(Ordering::Acquire);
                if f.is_null() {
                    return false;
                }
                unsafe { core::mem::transmute::<*mut (), IdPredicate>(f)(cp as u32) }
            }
        }
    }

    #[inline]
    pub fn is_identifier_part(codepoint: i32) -> bool {
        is_identifier_continue(codepoint)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// move-in: lexer_tables (MOVE_DOWN ← src/js_parser/lexer_tables.zig)
//
// Only the strict-mode reserved-word remap is needed by `MutableString::
// ensure_valid_identifier`. The full keyword/token tables stay in js_parser.
// ──────────────────────────────────────────────────────────────────────────

pub mod lexer_tables {
    /// Maps a strict-mode reserved word to its `_`-prefixed safe identifier.
    /// Port of `StrictModeReservedWordsRemap` (ComptimeStringMap → phf).
    pub static STRICT_MODE_RESERVED_WORDS_REMAP: phf::Map<&'static [u8], &'static [u8]> = phf::phf_map! {
        b"implements" => b"_implements".as_slice(),
        b"interface"  => b"_interface".as_slice(),
        b"let"        => b"_let".as_slice(),
        b"package"    => b"_package".as_slice(),
        b"private"    => b"_private".as_slice(),
        b"protected"  => b"_protected".as_slice(),
        b"public"     => b"_public".as_slice(),
        b"static"     => b"_static".as_slice(),
        b"yield"      => b"_yield".as_slice(),
    };
}

// ──────────────────────────────────────────────────────────────────────────
// move-in: printer (MOVE_DOWN ← src/js_printer/js_printer.zig)
//
// Self-contained string-quoting helpers used by `strings::format_escapes`,
// `picohttp` (JSON header serialization), and `js_parser` (quoteForJSON).
// ──────────────────────────────────────────────────────────────────────────

pub mod printer {
    use crate::immutable::{self as strings, Encoding as StrEncoding};
    use crate::mutable_string::MutableString;

    const HEX_CHARS: &[u8; 16] = b"0123456789ABCDEF";
    const FIRST_ASCII: i32 = 0x20;
    const LAST_ASCII: i32 = 0x7E;
    const FIRST_HIGH_SURROGATE: i32 = 0xD800;
    const FIRST_LOW_SURROGATE: i32 = 0xDC00;
    const LAST_LOW_SURROGATE: i32 = 0xDFFF;

    /// Minimal byte-sink so `write_pre_quoted_string` works for both
    /// `core::fmt::Formatter` and `MutableString` without an `io::Write` bound.
    pub trait PrinterWriter {
        fn write_all(&mut self, bytes: &[u8]) -> core::fmt::Result;
    }

    impl PrinterWriter for core::fmt::Formatter<'_> {
        #[inline]
        fn write_all(&mut self, bytes: &[u8]) -> core::fmt::Result {
            // SAFETY: callers only pass WTF-8/ASCII escape output, which is valid UTF-8.
            core::fmt::Write::write_str(self, unsafe { core::str::from_utf8_unchecked(bytes) })
        }
    }

    impl PrinterWriter for MutableString {
        #[inline]
        fn write_all(&mut self, bytes: &[u8]) -> core::fmt::Result {
            self.append(bytes).map_err(|_| core::fmt::Error)
        }
    }

    impl PrinterWriter for Vec<u8> {
        #[inline]
        fn write_all(&mut self, bytes: &[u8]) -> core::fmt::Result {
            self.extend_from_slice(bytes);
            Ok(())
        }
    }

    #[inline]
    pub fn can_print_without_escape(c: i32, ascii_only: bool) -> bool {
        if c <= LAST_ASCII {
            c >= FIRST_ASCII
                && c != b'\\' as i32
                && c != b'"' as i32
                && c != b'\'' as i32
                && c != b'`' as i32
                && c != b'$' as i32
        } else {
            !ascii_only
                && c != 0xFEFF
                && c != 0x2028
                && c != 0x2029
                && (c < FIRST_HIGH_SURROGATE || c > LAST_LOW_SURROGATE)
        }
    }

    pub fn best_quote_char_for_string_u8(str: &[u8], allow_backtick: bool) -> u8 {
        best_quote_char_for_string_impl(str.iter().map(|b| *b as u32), allow_backtick)
    }

    pub fn best_quote_char_for_string_u16(str: &[u16], allow_backtick: bool) -> u8 {
        best_quote_char_for_string_impl(str.iter().map(|b| *b as u32), allow_backtick)
    }

    #[inline]
    fn best_quote_char_for_string_impl(
        mut iter: impl Iterator<Item = u32>,
        allow_backtick: bool,
    ) -> u8 {
        let mut single_cost: usize = 0;
        let mut double_cost: usize = 0;
        let mut backtick_cost: usize = 0;
        let mut i: usize = 0;
        let mut prev_dollar = false;
        while i < 1024 {
            let Some(c) = iter.next() else { break };
            match c {
                0x27 /* '\'' */ => single_cost += 1,
                0x22 /* '"'  */ => double_cost += 1,
                0x60 /* '`'  */ => backtick_cost += 1,
                0x0A /* '\n' */ => { single_cost += 1; double_cost += 1; }
                0x5C /* '\\' */ => { let _ = iter.next(); i += 1; }
                0x7B /* '{'  */ if prev_dollar => backtick_cost += 1,
                _ => {}
            }
            prev_dollar = c == 0x24; // '$'
            i += 1;
        }
        if allow_backtick && backtick_cost < single_cost.min(double_cost) {
            return b'`';
        }
        if single_cost < double_cost { b'\'' } else { b'"' }
    }

    /// Port of `js_printer.writePreQuotedString`.
    /// PERF(port): was comptime-monomorphized over (quote_char, ascii_only, json,
    /// encoding); demoted to runtime params per PORTING.md.
    pub fn write_pre_quoted_string<W: PrinterWriter + ?Sized>(
        text_in: &[u8],
        writer: &mut W,
        quote_char: u8,
        ascii_only: bool,
        json: bool,
        encoding: StrEncoding,
    ) -> core::fmt::Result {
        debug_assert!(!json || quote_char == b'"');
        // utf16 view over the same bytes (only used when encoding == Utf16).
        // SAFETY: callers pass 2-byte-aligned even-length input for Utf16.
        let text16: &[u16] = if encoding == StrEncoding::Utf16 {
            unsafe {
                core::slice::from_raw_parts(text_in.as_ptr() as *const u16, text_in.len() / 2)
            }
        } else {
            &[]
        };
        let n: usize = if encoding == StrEncoding::Utf16 { text16.len() } else { text_in.len() };
        let mut i: usize = 0;

        while i < n {
            let width: u8 = match encoding {
                StrEncoding::Latin1 | StrEncoding::Ascii | StrEncoding::Utf16 => 1,
                StrEncoding::Utf8 => strings::wtf8_byte_sequence_length_with_invalid(text_in[i]),
            };
            let clamped_width = (width as usize).min(n.saturating_sub(i));
            let c: i32 = match encoding {
                StrEncoding::Utf8 => {
                    let mut buf = [0u8; 4];
                    buf[..clamped_width].copy_from_slice(&text_in[i..i + clamped_width]);
                    strings::decode_wtf8_rune_t::<i32>(&buf, width, 0)
                }
                StrEncoding::Ascii => {
                    debug_assert!(text_in[i] <= 0x7F);
                    text_in[i] as i32
                }
                StrEncoding::Latin1 => text_in[i] as i32,
                StrEncoding::Utf16 => text16[i] as i32,
            };

            if can_print_without_escape(c, ascii_only) {
                match encoding {
                    StrEncoding::Ascii | StrEncoding::Utf8 => {
                        let remain = &text_in[i + clamped_width..];
                        if let Some(j) =
                            strings::index_of_needs_escape_for_java_script_string(remain, quote_char)
                        {
                            writer.write_all(&text_in[i..i + clamped_width])?;
                            i += clamped_width;
                            writer.write_all(&remain[..j as usize])?;
                            i += j as usize;
                        } else {
                            writer.write_all(&text_in[i..])?;
                            break;
                        }
                    }
                    StrEncoding::Latin1 | StrEncoding::Utf16 => {
                        let mut cp = [0u8; 4];
                        let cp_len = strings::encode_wtf8_rune(&mut cp, c) as usize;
                        writer.write_all(&cp[..cp_len])?;
                        i += clamped_width;
                    }
                }
                continue;
            }

            match c {
                0x07 => { writer.write_all(b"\\x07")?; i += 1; }
                0x08 => { writer.write_all(b"\\b")?; i += 1; }
                0x0C => { writer.write_all(b"\\f")?; i += 1; }
                0x0A => {
                    writer.write_all(if quote_char == b'`' { b"\n" } else { b"\\n" })?;
                    i += 1;
                }
                0x0D => { writer.write_all(b"\\r")?; i += 1; }
                0x0B => { writer.write_all(b"\\v")?; i += 1; }
                0x5C => { writer.write_all(b"\\\\")?; i += 1; }
                0x22 => {
                    writer.write_all(if quote_char == b'"' { b"\\\"" } else { b"\"" })?;
                    i += 1;
                }
                0x27 => {
                    writer.write_all(if quote_char == b'\'' { b"\\'" } else { b"'" })?;
                    i += 1;
                }
                0x60 => {
                    writer.write_all(if quote_char == b'`' { b"\\`" } else { b"`" })?;
                    i += 1;
                }
                0x24 => {
                    if quote_char == b'`' {
                        let next_is_brace = match encoding {
                            StrEncoding::Utf16 => i + 1 < n && text16[i + 1] == b'{' as u16,
                            _ => i + 1 < n && text_in[i + 1] == b'{',
                        };
                        writer.write_all(if next_is_brace { b"\\$" } else { b"$" })?;
                    } else {
                        writer.write_all(b"$")?;
                    }
                    i += 1;
                }
                0x09 => {
                    writer.write_all(if quote_char == b'`' { b"\t" } else { b"\\t" })?;
                    i += 1;
                }
                _ => {
                    i += width as usize;
                    if c <= 0xFF && !json {
                        let k = c as usize;
                        writer.write_all(&[
                            b'\\', b'x',
                            HEX_CHARS[(k >> 4) & 0xF],
                            HEX_CHARS[k & 0xF],
                        ])?;
                    } else if c <= 0xFFFF {
                        let k = c as usize;
                        writer.write_all(&[
                            b'\\', b'u',
                            HEX_CHARS[(k >> 12) & 0xF],
                            HEX_CHARS[(k >> 8) & 0xF],
                            HEX_CHARS[(k >> 4) & 0xF],
                            HEX_CHARS[k & 0xF],
                        ])?;
                    } else {
                        let k = c - 0x10000;
                        let lo = (FIRST_HIGH_SURROGATE + ((k >> 10) & 0x3FF)) as usize;
                        let hi = (FIRST_LOW_SURROGATE + (k & 0x3FF)) as usize;
                        writer.write_all(&[
                            b'\\', b'u',
                            HEX_CHARS[lo >> 12],
                            HEX_CHARS[(lo >> 8) & 15],
                            HEX_CHARS[(lo >> 4) & 15],
                            HEX_CHARS[lo & 15],
                            b'\\', b'u',
                            HEX_CHARS[hi >> 12],
                            HEX_CHARS[(hi >> 8) & 15],
                            HEX_CHARS[(hi >> 4) & 15],
                            HEX_CHARS[hi & 15],
                        ])?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Port of `js_printer.quoteForJSON`.
    pub fn quote_for_json(
        text: &[u8],
        bytes: &mut MutableString,
        ascii_only: bool,
    ) -> core::fmt::Result {
        // Zig pre-grew via estimateLengthForUTF8; Phase B can add the estimator.
        bytes.append_char(b'"').map_err(|_| core::fmt::Error)?;
        write_pre_quoted_string(text, bytes, b'"', ascii_only, true, StrEncoding::Utf8)?;
        bytes.append_char(b'"').map_err(|_| core::fmt::Error)
    }

    /// Port of `js_printer.writeJSONString`.
    pub fn write_json_string<W: PrinterWriter + ?Sized>(
        input: &[u8],
        writer: &mut W,
        encoding: StrEncoding,
    ) -> core::fmt::Result {
        writer.write_all(b"\"")?;
        write_pre_quoted_string(input, writer, b'"', false, true, encoding)?;
        writer.write_all(b"\"")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// move-in: cheap_prefix_normalizer (MOVE_DOWN ← src/bundler/bundle_v2.zig)
//
// Pure path-string helper; used by `css::printer` and the bundler chunk
// writer. No bundler types — only `&[u8]` in/out.
// ──────────────────────────────────────────────────────────────────────────

pub fn cheap_prefix_normalizer<'a>(prefix: &'a [u8], suffix: &'a [u8]) -> [&'a [u8]; 2] {
    use crate::immutable as strings;
    if prefix.is_empty() {
        let suffix_no_slash = strings::remove_leading_dot_slash(suffix);
        return [
            if strings::has_prefix_comptime(suffix_no_slash, b"../") { b"" } else { b"./" },
            suffix_no_slash,
        ];
    }

    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"]                 => "/foo/bar.js"
    let win = bun_core::Environment::IS_WINDOWS;
    if strings::ends_with_char(prefix, b'/') || (win && strings::ends_with_char(prefix, b'\\')) {
        if strings::starts_with_char(suffix, b'/')
            || (win && strings::starts_with_char(suffix, b'\\'))
        {
            return [prefix, &suffix[1..]];
        }
        // It gets really complicated if we try to deal with URLs more than this
        // (see bundle_v2.zig comment block).
    }

    [prefix, strings::remove_leading_dot_slash(suffix)]
}

// ──────────────────────────────────────────────────────────────────────────
// Tag
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Tag {
    /// String is not valid. Observed on some failed operations.
    /// To prevent crashes, this value acts similarly to .Empty (such as length = 0)
    Dead = 0,
    /// String is backed by a WTF::StringImpl from JavaScriptCore.
    /// Can be in either `latin1` or `utf16le` encodings.
    WTFStringImpl = 1,
    /// Memory has an unknown owner, likely in Bun's Zig codebase. If `isGloballyAllocated`
    /// is set, then it is owned by mimalloc. When converted to a JS value it has to be cloned
    /// into a WTF::String.
    /// Can be in either `utf8` or `utf16le` encodings.
    ZigString = 2,
    /// Static memory that is guaranteed to never be freed. When converted to WTF::String,
    /// the memory is not cloned, but instead referenced with WTF::ExternalStringImpl.
    /// Can be in either `utf8` or `utf16le` encodings.
    StaticZigString = 3,
    /// String is ""
    Empty = 4,
}

// ──────────────────────────────────────────────────────────────────────────
// StringImpl
// ──────────────────────────────────────────────────────────────────────────

/// `extern union` — C++ mutates tag and value independently across FFI.
#[repr(C)]
pub union StringImpl {
    pub zig_string: ManuallyDrop<ZigString>,
    // LIFETIMES.tsv: class=SHARED rust_type=Arc<WTFStringImplStruct>
    // TODO(port): this is a #[repr(C)] union returned by-value from extern "C"
    // (BunString__*). `Arc` adds a control-block header so the raw pointer C++
    // writes here would not be a valid `Arc`. Phase B: likely `*mut WTFStringImplStruct`
    // (intrusive refcount) — keeping TSV verbatim for now.
    pub wtf_string_impl: ManuallyDrop<Arc<WTFStringImplStruct>>,
    pub static_zig_string: ManuallyDrop<ZigString>,
    pub dead: (),
    pub empty: (),
}

// ──────────────────────────────────────────────────────────────────────────
// String
// ──────────────────────────────────────────────────────────────────────────

/// Prefer using String instead of ZigString in new code.
///
/// `#[repr(C)] struct { tag: u8, value: StringValue }` — NOT a Rust enum
/// (C++ mutates tag and value independently across FFI).
#[repr(C)]
pub struct String {
    pub tag: Tag,
    pub value: StringImpl,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub fn BunString__createExternal(
        bytes: *const u8,
        len: usize,
        is_latin1: bool,
        ptr: *mut c_void,
        callback: Option<extern "C" fn(*mut c_void, *mut c_void, u32)>,
    ) -> String;
    pub fn BunString__createStaticExternal(bytes: *const u8, len: usize, is_latin1: bool) -> String;
    pub fn BunString__createExternalGloballyAllocatedLatin1(bytes: *mut u8, len: usize) -> String;
    pub fn BunString__createExternalGloballyAllocatedUTF16(bytes: *mut u16, len: usize) -> String;
}

impl String {
    pub const NAME: &'static str = "BunString";

    pub const EMPTY: String = String {
        tag: Tag::Empty,
        value: StringImpl { empty: () },
    };

    pub const DEAD: String = String {
        tag: Tag::Dead,
        value: StringImpl { dead: () },
    };

    // re-export
    pub use crate::wtf::StringImplAllocator;

    pub fn to_int32(&self) -> Option<i32> {
        let val = bun_cpp::BunString__toInt32(self);
        if val > i32::MAX as i64 {
            return None;
        }
        Some(i32::try_from(val).unwrap())
    }

    pub fn ascii(bytes: &[u8]) -> String {
        String {
            tag: Tag::ZigString,
            value: StringImpl {
                zig_string: ManuallyDrop::new(ZigString::init(bytes)),
            },
        }
    }

    pub fn is_global(&self) -> bool {
        // SAFETY: tag check guards union access
        self.tag == Tag::ZigString && unsafe { self.value.zig_string.is_globally_allocated() }
    }

    pub fn ensure_hash(&self) {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            unsafe { self.value.wtf_string_impl.ensure_hash() };
        }
    }

    // `transferToJS` / `toErrorInstance` / `toJS` / etc. were `string_jsc.*` aliases.
    // Deleted per PORTING.md: extension-trait methods live in the `*_jsc` crate.

    pub fn to_owned_slice(&self) -> Result<Vec<u8>, AllocError> {
        let (bytes, _) = self.to_owned_slice_impl()?;
        Ok(bytes)
    }

    /// Returns `(utf8_bytes, is_all_ascii)`.
    ///
    /// `false` means the string contains at least one non-ASCII character.
    pub fn to_owned_slice_returning_all_ascii(&self) -> Result<(Vec<u8>, bool), AllocError> {
        let (bytes, ascii_status) = self.to_owned_slice_impl()?;
        let is_ascii = match ascii_status {
            AsciiStatus::AllAscii => true,
            AsciiStatus::NonAscii => false,
            AsciiStatus::Unknown => strings::is_all_ascii(&bytes),
        };
        Ok((bytes, is_ascii))
    }

    fn to_owned_slice_impl(&self) -> Result<(Vec<u8>, AsciiStatus), AllocError> {
        match self.tag {
            // SAFETY: tag check guards union access
            Tag::ZigString => Ok((
                unsafe { self.value.zig_string.to_owned_slice()? },
                AsciiStatus::Unknown,
            )),
            Tag::WTFStringImpl => {
                // SAFETY: tag check guards union access
                let wtf = unsafe { &*self.value.wtf_string_impl };
                let utf8_slice = wtf.to_utf8_without_ref();
                // `utf8_slice.allocator` is either null, or the default allocator.
                // (errdefer utf8_slice.deinit() — handled by Drop on `?`)

                let ascii_status = if utf8_slice.allocator_is_null() {
                    AsciiStatus::AllAscii // no allocation means the string was 8-bit and all ascii
                } else if wtf.is_8bit() {
                    AsciiStatus::NonAscii // otherwise the allocator would be null for an 8-bit string
                } else {
                    AsciiStatus::Unknown // string was 16-bit; may or may not be all ascii
                };

                let owned_slice = utf8_slice.clone_if_borrowed()?;
                // `owned_slice` is guaranteed to be owned.
                Ok((owned_slice.into_mut(), ascii_status))
            }
            Tag::StaticZigString => Ok((
                // SAFETY: tag check guards union access
                unsafe { self.value.static_zig_string.to_owned_slice()? },
                AsciiStatus::Unknown,
            )),
            _ => Ok((Vec::new(), AsciiStatus::AllAscii)), // trivially all ascii
        }
    }

    pub fn create_if_different(other: &String, utf8_slice: &[u8]) -> String {
        if other.tag == Tag::WTFStringImpl {
            if other.eql_utf8(utf8_slice) {
                return other.dupe_ref();
            }
        }

        Self::clone_utf8(utf8_slice)
    }

    fn create_uninitialized_latin1(len: usize) -> (String, &'static mut [u8]) {
        // TODO(port): return type lifetime — slice borrows from the WTF allocation
        // owned by the returned `String`; expressed as `'static` here, Phase B
        // should tie to a guard or use raw `*mut [u8]`.
        debug_assert!(len > 0);
        let string = bun_cpp::BunString__fromLatin1Unitialized(len);
        if string.tag == Tag::Dead {
            return (string, &mut []);
        }
        let _ = Self::validate_ref_count(&string);
        // SAFETY: tag is WTFStringImpl on success path
        let wtf = unsafe { &*string.value.wtf_string_impl };
        let slice = unsafe {
            // SAFETY: freshly created uninitialized buffer of `m_length` latin1 bytes
            core::slice::from_raw_parts_mut(wtf.m_ptr.latin1 as *mut u8, wtf.m_length as usize)
        };
        (string, slice)
    }

    fn create_uninitialized_utf16(len: usize) -> (String, &'static mut [u16]) {
        // TODO(port): return type lifetime — see create_uninitialized_latin1.
        debug_assert!(len > 0);
        let string = bun_cpp::BunString__fromUTF16Unitialized(len);
        if string.tag == Tag::Dead {
            return (string, &mut []);
        }
        let _ = Self::validate_ref_count(&string);
        // SAFETY: tag is WTFStringImpl on success path
        let wtf = unsafe { &*string.value.wtf_string_impl };
        let slice = unsafe {
            // SAFETY: freshly created uninitialized buffer of `m_length` utf16 code units
            core::slice::from_raw_parts_mut(wtf.m_ptr.utf16 as *mut u16, wtf.m_length as usize)
        };
        (string, slice)
    }

    pub fn clone_latin1(bytes: &[u8]) -> String {
        bun_core::mark_binding();
        if bytes.is_empty() {
            return String::EMPTY;
        }
        Self::validate_ref_count_owned(bun_cpp::BunString__fromLatin1(bytes.as_ptr(), bytes.len()))
    }

    #[inline]
    pub fn validate_ref_count(this: &String) -> &String {
        if cfg!(debug_assertions) {
            // Newly created strings should have a ref count of 1
            if !this.is_empty() {
                // SAFETY: !is_empty() with a freshly-created WTF string ⇒ tag is WTFStringImpl
                let ref_count = unsafe { this.value.wtf_string_impl.ref_count() };
                debug_assert!(ref_count == 1);
            }
        }
        this
    }

    #[inline]
    fn validate_ref_count_owned(this: String) -> String {
        Self::validate_ref_count(&this);
        this
    }

    pub fn clone_utf8(bytes: &[u8]) -> String {
        webcore_encoding::to_bun_string_comptime(bytes, Encoding::Utf8)
    }

    pub fn clone_utf16(bytes: &[u16]) -> String {
        if bytes.is_empty() {
            return String::EMPTY;
        }
        if strings::first_non_ascii16(bytes).is_none() {
            return Self::validate_ref_count_owned(bun_cpp::BunString__fromUTF16ToLatin1(
                bytes.as_ptr(),
                bytes.len(),
            ));
        }
        Self::validate_ref_count_owned(bun_cpp::BunString__fromUTF16(bytes.as_ptr(), bytes.len()))
    }

    pub fn create_format(args: fmt::Arguments<'_>) -> Result<String, AllocError> {
        // Zig: if args tuple is empty → String.static(fmt). In Rust, callers
        // with no args should call `String::static_` directly.
        // TODO(port): cannot detect "zero args" on fmt::Arguments at compile time.
        if let Some(s) = args.as_str() {
            // No interpolation — treat as static.
            return Ok(String::static_(s.as_bytes()));
        }

        // PERF(port): was StackFallbackAllocator(512) — profile in Phase B
        let mut buf: Vec<u8> = Vec::new();
        use std::io::Write;
        write!(&mut buf, "{}", args).map_err(|_| AllocError)?;
        Ok(Self::clone_utf8(&buf))
    }

    pub fn create_from_os_path(os_path: bun_paths::OSPathSlice<'_>) -> String {
        #[cfg(not(windows))]
        {
            Self::clone_utf8(os_path)
        }
        #[cfg(windows)]
        {
            Self::clone_utf16(os_path)
        }
    }

    pub fn is_empty(&self) -> bool {
        self.tag == Tag::Empty || self.length() == 0
    }

    pub fn dupe_ref(&self) -> String {
        self.ref_();
        // TODO(port): `String` is not `Copy` because of the Arc field; in Zig this
        // is a by-value copy of the 24-byte struct. Phase B: when wtf_string_impl
        // becomes a raw ptr, derive Copy and return `*self`.
        // SAFETY: String is a 24-byte #[repr(C)] POD; bitwise copy matches Zig
        // pass-by-value (refcount bumped via ref_() above).
        unsafe { core::ptr::read(self) }
    }

    pub fn clone(&self) -> String {
        if self.tag == Tag::WTFStringImpl {
            return self.dupe_ref();
        }

        if self.is_empty() {
            return String::EMPTY;
        }

        if self.is_utf16() {
            let (new, bytes) = Self::create_uninitialized::<Utf16>(self.length());
            if new.tag != Tag::Dead {
                // SAFETY: tag is ZigString/StaticZigString here (not WTF, not empty, is utf16)
                bytes.copy_from_slice(unsafe { self.value.zig_string.utf16_slice() });
            }
            return new;
        }

        Self::clone_utf8(self.byte_slice())
    }

    /// Must be given ascii input
    pub fn create_atom_ascii(bytes: &[u8]) -> String {
        bun_cpp::BunString__createAtom(bytes.as_ptr(), bytes.len())
    }

    /// Will return None if the input is non-ascii or too long
    pub fn try_create_atom(bytes: &[u8]) -> Option<String> {
        let atom = bun_cpp::BunString__tryCreateAtom(bytes.as_ptr(), bytes.len());
        if atom.tag == Tag::Dead {
            None
        } else {
            Some(atom)
        }
    }

    /// Atomized strings are interned strings
    /// They're de-duplicated in a threadlocal hash table
    /// They cannot be used from other threads.
    pub fn create_atom_if_possible(bytes: &[u8]) -> String {
        if bytes.is_empty() {
            return String::EMPTY;
        }

        if bytes.len() < 64 {
            if let Some(atom) = Self::try_create_atom(bytes) {
                return atom;
            }
        }

        Self::clone_utf8(bytes)
    }

    pub fn utf8_byte_length(&self) -> usize {
        match self.tag {
            // SAFETY: tag check guards union access
            Tag::WTFStringImpl => unsafe { self.value.wtf_string_impl.utf8_byte_length() },
            Tag::ZigString => unsafe { self.value.zig_string.utf8_byte_length() },
            Tag::StaticZigString => unsafe { self.value.static_zig_string.utf8_byte_length() },
            Tag::Dead | Tag::Empty => 0,
        }
    }

    pub fn utf16_byte_length(&self) -> usize {
        match self.tag {
            // SAFETY: tag check guards union access
            Tag::WTFStringImpl => unsafe { self.value.wtf_string_impl.utf16_byte_length() },
            Tag::StaticZigString | Tag::ZigString => unsafe {
                self.value.zig_string.utf16_byte_length()
            },
            Tag::Dead | Tag::Empty => 0,
        }
    }

    pub fn latin1_byte_length(&self) -> usize {
        match self.tag {
            // SAFETY: tag check guards union access
            Tag::WTFStringImpl => unsafe { self.value.wtf_string_impl.latin1_byte_length() },
            Tag::StaticZigString | Tag::ZigString => unsafe {
                self.value.zig_string.latin1_byte_length()
            },
            Tag::Dead | Tag::Empty => 0,
        }
    }

    pub fn trunc(&self, len: usize) -> String {
        if self.length() <= len {
            // PORT NOTE: Zig returns `this` by value with NO refcount bump; using a
            // raw bitwise copy here (not `dupe_ref()`, which would add an extra ref).
            // SAFETY: String is a 24-byte #[repr(C)] POD; bitwise copy matches Zig
            // pass-by-value semantics.
            return unsafe { core::ptr::read(self) };
        }

        String::init(self.to_zig_string().trunc(len))
    }

    pub fn to_owned_slice_z(&self) -> Result<Box<crate::ZStr>, AllocError> {
        // TODO(port): return type — Zig returns `[:0]u8` owned by allocator.
        self.to_zig_string().to_owned_slice_z()
    }

    /// Create a bun.String from a slice. This is never a copy.
    /// For strings created from static string literals, use `String::static_`
    pub fn init(value: impl Into<String>) -> String {
        value.into()
    }

    pub fn static_(input: &'static [u8]) -> String {
        // TODO(port): Zig signature was `[:0]const u8` (NUL-terminated). Rust
        // call sites pass `b"..."` which has no NUL; verify C++ side does not
        // depend on the sentinel.
        String {
            tag: Tag::StaticZigString,
            value: StringImpl {
                static_zig_string: ManuallyDrop::new(ZigString::init(input)),
            },
        }
    }

    /// ctx is the pointer passed into `create_external`
    /// buffer is the pointer to the buffer, either [*]u8 or [*]u16
    /// len is the number of characters in that buffer.
    pub type ExternalStringImplFreeFunction<Ctx> =
        extern "C" fn(ctx: Ctx, buffer: *mut c_void, len: u32);

    /// Creates a `String` backed by a `WTF::ExternalStringImpl`.
    ///
    /// External strings are WTF strings with bytes allocated somewhere else.
    /// When destroyed, they call `callback`, which should free the allocation
    /// as needed.
    ///
    /// If `bytes` is too long (longer than `max_length()`), `callback` gets
    /// called and a `dead` string is returned. `bytes` cannot be empty. Passing
    /// an empty slice is safety-checked Illegal Behavior.
    ///
    /// ### Memory Characteristics
    /// - Allocates memory for backing `WTF::ExternalStringImpl` struct. Does
    ///   not allocate for actual string bytes.
    /// - `bytes` is borrowed.
    pub fn create_external<Ctx>(
        bytes: &[u8],
        is_latin1: bool,
        ctx: Ctx,
        callback: Option<ExternalStringImplFreeFunction<Ctx>>,
    ) -> String
    where
        // TODO(port): Zig asserts `@typeInfo(Ctx) == .pointer` at comptime.
        // Express as a sealed `IsPointer` trait in Phase B; for now require
        // pointer-size + 'static so the transmute below is sound.
        Ctx: 'static,
    {
        const _: () = assert!(core::mem::size_of::<Ctx>() == core::mem::size_of::<*mut c_void>());
        debug_assert!(!bytes.is_empty());
        bun_core::mark_binding();
        if bytes.len() >= Self::max_length() {
            if let Some(cb) = callback {
                cb(ctx, bytes.as_ptr() as *mut c_void, bytes.len() as u32);
            }
            return String::DEAD;
        }
        // SAFETY: Ctx is pointer-sized; callback ABI matches (Ctx erased to *mut c_void).
        let ctx_erased: *mut c_void = unsafe { core::mem::transmute_copy(&ctx) };
        let cb_erased: Option<extern "C" fn(*mut c_void, *mut c_void, u32)> =
            unsafe { core::mem::transmute(callback) };
        // SAFETY: bytes.len() < max_length() checked above; ctx/cb erased to
        // ABI-compatible *mut c_void.
        Self::validate_ref_count_owned(unsafe {
            BunString__createExternal(bytes.as_ptr(), bytes.len(), is_latin1, ctx_erased, cb_erased)
        })
    }

    /// This should rarely be used. The WTF::StringImpl* will never be freed.
    ///
    /// So this really only makes sense when you need to dynamically allocate a
    /// string that will never be freed.
    pub fn create_static_external(bytes: &[u8], is_latin1: bool) -> String {
        bun_core::mark_binding();
        debug_assert!(!bytes.is_empty());
        // SAFETY: FFI call with valid slice
        unsafe { BunString__createStaticExternal(bytes.as_ptr(), bytes.len(), is_latin1) }
    }

    /// Max WTFStringImpl length.
    /// **Not** in bytes. In characters.
    #[inline]
    pub fn max_length() -> usize {
        // CYCLEBREAK(b0): hook-registration replaces direct
        // `bun_jsc::VirtualMachine::string_allocation_limit()` upcall.
        let p = STRING_ALLOCATION_LIMIT_HOOK.load(Ordering::Relaxed);
        if p.is_null() {
            i32::MAX as usize
        } else {
            // SAFETY: runtime stores a `fn() -> usize` here during init.
            let f: fn() -> usize = unsafe { core::mem::transmute(p) };
            f()
        }
    }

    /// If the allocation fails, this will free the bytes and return a dead string.
    pub fn create_external_globally_allocated<E: WTFEncoding>(bytes: Box<[E::Byte]>) -> String {
        bun_core::mark_binding();
        debug_assert!(!bytes.is_empty());

        if bytes.len() >= Self::max_length() {
            drop(bytes);
            return String::DEAD;
        }

        let len = bytes.len();
        // SAFETY: ownership transferred to WTF::ExternalStringImpl, which frees via mimalloc
        let ptr = Box::into_raw(bytes) as *mut E::Byte;
        Self::validate_ref_count_owned(E::create_external_globally_allocated(ptr, len))
    }

    /// Create a `String` from a UTF-8 slice.
    ///
    /// No checks are performed to ensure `value` is valid UTF-8. Caller is
    /// responsible for ensuring `value` is valid.
    ///
    /// ### Memory Characteristics
    /// - `value` is borrowed.
    /// - Never allocates or copies any memory
    /// - Does not increment reference counts
    pub fn borrow_utf8(value: &[u8]) -> String {
        String::init(ZigString::init_utf8(value))
    }

    /// Create a `String` from a UTF-16 slice.
    ///
    /// No checks are performed to ensure `value` is valid UTF-16. Caller is
    /// responsible for ensuring `value` is valid.
    ///
    /// ### Memory Characteristics
    /// - `value` is borrowed.
    /// - Never allocates or copies any memory
    /// - Does not increment reference counts
    pub fn borrow_utf16(value: &[u16]) -> String {
        String::init(ZigString::init_utf16(value))
    }

    pub fn init_latin1_or_ascii_view(value: &[u8]) -> String {
        String::init(ZigString::init(value))
    }

    /// Create a `String` from a byte slice.
    ///
    /// Checks if `value` is ASCII (using `strings::is_all_ascii`) and, if so,
    /// the returned `String` is marked as UTF-8. Otherwise, no encoding is assumed.
    ///
    /// ### Memory Characteristics
    /// - `value` is borrowed.
    /// - Never allocates or copies any memory
    /// - Does not increment reference counts
    pub fn from_bytes(value: &[u8]) -> String {
        String::init(ZigString::from_bytes(value))
    }

    pub fn to_zig_string(&self) -> ZigString {
        if self.tag == Tag::StaticZigString || self.tag == Tag::ZigString {
            // SAFETY: tag check guards union access
            return unsafe { (*self.value.zig_string).clone() };
        }

        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            return unsafe { self.value.wtf_string_impl.to_zig_string() };
        }

        ZigString::EMPTY
    }

    pub fn to_wtf(&mut self) {
        bun_core::mark_binding();
        bun_cpp::BunString__toWTFString(self);
    }

    #[inline]
    pub fn length(&self) -> usize {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            unsafe { self.value.wtf_string_impl.length() }
        } else {
            self.to_zig_string().length()
        }
    }

    #[inline]
    pub fn utf16(&self) -> &[u16] {
        if self.tag == Tag::Empty {
            return &[];
        }
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            return unsafe { self.value.wtf_string_impl.utf16_slice() };
        }

        self.to_zig_string().utf16_slice_aligned()
        // TODO(port): lifetime — Zig returns a slice borrowing into self;
        // to_zig_string() returns an owned ZigString temporary. Phase B: have
        // ZigString::utf16_slice_aligned take &self and return slice with
        // String's lifetime via raw access.
    }

    #[inline]
    pub fn latin1(&self) -> &[u8] {
        if self.tag == Tag::Empty {
            return &[];
        }

        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            return unsafe { self.value.wtf_string_impl.latin1_slice() };
        }

        self.to_zig_string().slice()
        // TODO(port): lifetime — see utf16()
    }

    pub fn is_utf8(&self) -> bool {
        if !(self.tag == Tag::ZigString || self.tag == Tag::StaticZigString) {
            return false;
        }

        // SAFETY: tag check guards union access
        unsafe { self.value.zig_string.is_utf8() }
    }

    #[inline]
    pub fn as_utf8(&self) -> Option<&[u8]> {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            let wtf = unsafe { &*self.value.wtf_string_impl };
            if wtf.is_8bit() && strings::is_all_ascii(wtf.latin1_slice()) {
                return Some(wtf.latin1_slice());
            }

            return None;
        }

        if self.tag == Tag::ZigString || self.tag == Tag::StaticZigString {
            // SAFETY: tag check guards union access
            let zs = unsafe { &*self.value.zig_string };
            if zs.is_utf8() {
                return Some(zs.slice());
            }

            if strings::is_all_ascii(self.to_zig_string().slice()) {
                return Some(zs.slice());
            }

            return None;
        }

        Some(b"")
    }

    pub fn encoding(&self) -> strings::EncodingNonAscii {
        if self.is_utf16() {
            return strings::EncodingNonAscii::Utf16;
        }

        if self.is_utf8() {
            return strings::EncodingNonAscii::Utf8;
        }

        strings::EncodingNonAscii::Latin1
    }

    pub fn github_action(&self) -> crate::zig_string::GithubActionFormatter {
        self.to_zig_string().github_action()
    }

    pub fn byte_slice(&self) -> &[u8] {
        match self.tag {
            // SAFETY: tag check guards union access
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig_string.byte_slice() },
            Tag::WTFStringImpl => unsafe { self.value.wtf_string_impl.byte_slice() },
            _ => &[],
        }
    }

    pub fn is_utf16(&self) -> bool {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            return unsafe { !self.value.wtf_string_impl.is_8bit() };
        }

        if self.tag == Tag::ZigString || self.tag == Tag::StaticZigString {
            // SAFETY: tag check guards union access
            return unsafe { self.value.zig_string.is_16bit() };
        }

        false
    }

    pub fn encode_into<const ENC: Encoding>(
        &self,
        out: &mut [u8],
    ) -> Result<usize, bun_core::Error> {
        // TODO(port): narrow error set
        if self.is_utf16() {
            return webcore_encoding::encode_into_from16::<ENC>(self.utf16(), out, true);
        }

        if self.is_utf8() {
            todo!("encode_into from UTF-8");
        }

        webcore_encoding::encode_into_from8::<ENC>(self.latin1(), out)
    }

    pub fn encode(&self, enc: Encoding) -> Vec<u8> {
        self.to_zig_string().encode_with_allocator(enc)
    }

    #[inline]
    pub fn utf8(&self) -> &[u8] {
        if cfg!(debug_assertions) {
            debug_assert!(self.tag == Tag::ZigString || self.tag == Tag::StaticZigString);
            debug_assert!(self.can_be_utf8());
        }
        // SAFETY: asserted tag is ZigString/StaticZigString
        unsafe { self.value.zig_string.slice() }
    }

    pub fn can_be_utf8(&self) -> bool {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            let wtf = unsafe { &*self.value.wtf_string_impl };
            return wtf.is_8bit() && strings::is_all_ascii(wtf.latin1_slice());
        }

        if self.tag == Tag::ZigString || self.tag == Tag::StaticZigString {
            // SAFETY: tag check guards union access
            if unsafe { self.value.zig_string.is_utf8() } {
                return true;
            }

            return strings::is_all_ascii(self.to_zig_string().slice());
        }

        self.tag == Tag::Empty
    }

    pub fn substring(&self, start_index: usize) -> String {
        let len = self.length();
        self.substring_with_len(len.min(start_index), len)
    }

    pub fn substring_with_len(&self, start_index: usize, end_index: usize) -> String {
        match self.tag {
            Tag::ZigString | Tag::StaticZigString => {
                // SAFETY: tag check guards union access
                String::init(unsafe {
                    self.value.zig_string.substring_with_len(start_index, end_index)
                })
            }
            Tag::WTFStringImpl => {
                // SAFETY: tag check guards union access
                let wtf = unsafe { &*self.value.wtf_string_impl };
                if wtf.is_8bit() {
                    String::init(ZigString::init(&wtf.latin1_slice()[start_index..end_index]))
                } else {
                    String::init(ZigString::init_utf16(
                        &wtf.utf16_slice()[start_index..end_index],
                    ))
                }
            }
            _ => self.dupe_ref(),
        }
    }

    pub fn to_utf8(&self) -> ZigSlice {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            return unsafe { self.value.wtf_string_impl.to_utf8() };
        }

        if self.tag == Tag::ZigString {
            // SAFETY: tag check guards union access
            return unsafe { self.value.zig_string.to_slice() };
        }

        if self.tag == Tag::StaticZigString {
            // SAFETY: tag check guards union access
            return ZigSlice::from_utf8_never_free(unsafe {
                self.value.static_zig_string.slice()
            });
        }

        ZigSlice::EMPTY
    }

    /// This is the same as to_utf8, but it doesn't increment the reference count for latin1 strings
    pub fn to_utf8_without_ref(&self) -> ZigSlice {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            return unsafe { self.value.wtf_string_impl.to_utf8_without_ref() };
        }

        if self.tag == Tag::ZigString {
            // SAFETY: tag check guards union access
            return unsafe { self.value.zig_string.to_slice() };
        }

        if self.tag == Tag::StaticZigString {
            // SAFETY: tag check guards union access
            return ZigSlice::from_utf8_never_free(unsafe {
                self.value.static_zig_string.slice()
            });
        }

        ZigSlice::EMPTY
    }

    /// Equivalent to calling `to_utf8_without_ref` followed by `clone_if_borrowed`.
    pub fn to_utf8_owned(&self) -> ZigSlice {
        self.to_utf8_without_ref()
            .clone_if_borrowed()
            .expect("OOM") // bun.handleOom — global allocator aborts on OOM
    }

    /// The returned slice is always heap-allocated.
    pub fn to_utf8_bytes(&self) -> Vec<u8> {
        self.to_utf8_owned().into_mut()
    }

    /// use `byte_slice` to get a `&[u8]`.
    pub fn to_slice(&mut self) -> SliceWithUnderlyingString {
        let utf8 = self.to_utf8();
        let underlying = core::mem::replace(self, String::EMPTY);
        SliceWithUnderlyingString {
            utf8,
            underlying,
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    pub fn to_thread_safe_slice(&mut self) -> Result<SliceWithUnderlyingString, AllocError> {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            let wtf = unsafe { &*self.value.wtf_string_impl };
            if !wtf.is_thread_safe() {
                let slice = wtf.to_utf8_without_ref();

                if slice.allocator_is_null() {
                    // This is an ASCII latin1 string with the same reference as the original.
                    return Ok(SliceWithUnderlyingString {
                        utf8: ZigSlice::init_owned(slice.slice().to_vec().into_boxed_slice()),
                        underlying: String::EMPTY,
                        #[cfg(debug_assertions)]
                        did_report_extra_memory_debug: false,
                    });
                }

                #[cfg(debug_assertions)]
                {
                    debug_assert!(!String::is_wtf_allocator(slice.allocator().unwrap())); // toUTF8WithoutRef() should never return a WTF allocator
                    // TODO(port): vtable identity check dropped (no allocator param in Rust)
                }

                // We've already cloned the string, so let's just return the slice.
                return Ok(SliceWithUnderlyingString {
                    utf8: slice,
                    underlying: String::EMPTY,
                    #[cfg(debug_assertions)]
                    did_report_extra_memory_debug: false,
                });
            } else {
                let slice = wtf.to_utf8_without_ref();

                // this WTF-allocated string is already thread safe
                // and it's ASCII, so we can just use it directly
                if slice.allocator_is_null() {
                    // Once for the string
                    self.ref_();

                    // Once for the utf8 slice
                    self.ref_();

                    // We didn't clone anything, so let's conserve memory by re-using the existing WTFStringImpl
                    return Ok(SliceWithUnderlyingString {
                        utf8: ZigSlice::init_with_allocator(
                            wtf.ref_count_allocator(),
                            slice.slice(),
                        ),
                        underlying: self.dupe_ref_raw(),
                        #[cfg(debug_assertions)]
                        did_report_extra_memory_debug: false,
                    });
                }

                #[cfg(debug_assertions)]
                {
                    debug_assert!(!String::is_wtf_allocator(slice.allocator().unwrap())); // toUTF8WithoutRef() should never return a WTF allocator
                    // TODO(port): vtable identity check dropped (no allocator param in Rust)
                }

                // We did have to clone the string. Let's avoid keeping the WTFStringImpl around
                // for longer than necessary, since the string could potentially have a single
                // reference count and that means excess memory usage
                return Ok(SliceWithUnderlyingString {
                    utf8: slice,
                    underlying: String::DEAD,
                    #[cfg(debug_assertions)]
                    did_report_extra_memory_debug: false,
                });
            }
        }

        Ok(self.to_slice())
    }

    pub fn ref_(&self) {
        match self.tag {
            // SAFETY: tag check guards union access
            Tag::WTFStringImpl => unsafe { self.value.wtf_string_impl.ref_() },
            _ => {}
        }
    }

    pub fn deref(&self) {
        match self.tag {
            // SAFETY: tag check guards union access
            Tag::WTFStringImpl => unsafe { self.value.wtf_string_impl.deref() },
            _ => {}
        }
    }

    pub fn eql_comptime(&self, value: &'static [u8]) -> bool {
        self.to_zig_string().eql_comptime(value)
    }

    pub fn is_8bit(&self) -> bool {
        match self.tag {
            // SAFETY: tag check guards union access
            Tag::WTFStringImpl => unsafe { self.value.wtf_string_impl.is_8bit() },
            Tag::ZigString => unsafe { !self.value.zig_string.is_16bit() },
            _ => true,
        }
    }

    pub fn char_at(&self, index: usize) -> u16 {
        if cfg!(debug_assertions) {
            debug_assert!(index < self.length());
        }
        match self.tag {
            Tag::WTFStringImpl => {
                // SAFETY: tag check guards union access
                let wtf = unsafe { &*self.value.wtf_string_impl };
                if wtf.is_8bit() {
                    wtf.latin1_slice()[index] as u16
                } else {
                    wtf.utf16_slice()[index]
                }
            }
            Tag::ZigString | Tag::StaticZigString => {
                // SAFETY: tag check guards union access
                let zs = unsafe { &*self.value.zig_string };
                if !zs.is_16bit() {
                    zs.slice()[index] as u16
                } else {
                    zs.utf16_slice()[index]
                }
            }
            _ => 0,
        }
    }

    pub fn index_of_ascii_char(&self, chr: u8) -> Option<usize> {
        debug_assert!(chr < 128);
        match self.is_utf16() {
            true => self.utf16().iter().position(|&c| c == u16::from(chr)),
            false => strings::index_of_char_usize(self.byte_slice(), chr),
        }
    }

    pub fn visible_width(&self, ambiguous_as_wide: bool) -> usize {
        if self.is_utf8() {
            strings::visible::width::utf8(self.utf8())
        } else if self.is_utf16() {
            strings::visible::width::utf16(self.utf16(), ambiguous_as_wide)
        } else {
            strings::visible::width::latin1(self.latin1())
        }
    }

    pub fn visible_width_exclude_ansi_colors(&self, ambiguous_as_wide: bool) -> usize {
        if self.is_utf8() {
            strings::visible::width::exclude_ansi_colors::utf8(self.utf8())
        } else if self.is_utf16() {
            strings::visible::width::exclude_ansi_colors::utf16(self.utf16(), ambiguous_as_wide)
        } else {
            strings::visible::width::exclude_ansi_colors::latin1(self.latin1())
        }
    }

    pub fn index_of_comptime_with_check_len(
        &self,
        values: &'static [&'static [u8]],
        check_len: bool,
    ) -> Option<usize> {
        // PERF(port): was comptime monomorphization (`comptime values`, `comptime check_len`) — profile in Phase B
        if self.is_8bit() {
            let bytes = self.byte_slice();
            for (i, val) in values.iter().enumerate() {
                if strings::eql_comptime_check_len_with_type_u8(bytes, val, check_len) {
                    return Some(i);
                }
            }

            return None;
        }

        let u16_bytes = self.byte_slice();
        for (i, val) in values.iter().enumerate() {
            // PERF(port): was `inline for` + `comptime bun.strings.toUTF16Literal(val)` — profile in Phase B
            if strings::eql_comptime_check_len_with_type_u16(
                u16_bytes,
                &strings::to_utf16_literal(val),
                check_len,
            ) {
                return Some(i);
            }
        }

        None
    }

    pub fn index_of_comptime_array_assume_same_length(
        &self,
        values: &'static [&'static [u8]],
    ) -> Option<usize> {
        // PERF(port): was comptime monomorphization (`comptime values`) — profile in Phase B
        if self.is_8bit() {
            let bytes = self.byte_slice();

            for (i, val) in values.iter().enumerate() {
                debug_assert!(bytes.len() == val.len());
                if strings::eql_comptime_check_len_with_type_u8(bytes, val, false) {
                    return Some(i);
                }
            }

            return None;
        }

        let u16_bytes = self.utf16();
        // TODO(port): Zig used a fixed `[values[0].len]u8` stack buffer; Rust
        // can't size an array from a runtime slice. Using a small heapless
        // buffer cap; Phase B may macro-generate per call site.
        let len0 = values[0].len();
        let mut buffer = [0u8; 256];
        debug_assert!(len0 <= buffer.len());
        for i in 0..len0 {
            let uchar = u16_bytes[i];
            if uchar > 255 {
                return None;
            }
            buffer[i] = u8::try_from(uchar).unwrap();
        }

        for (i, val) in values.iter().enumerate() {
            if strings::eql_comptime_check_len_with_type_u8(&buffer[..len0], val, false) {
                return Some(i);
            }
        }

        None
    }

    pub fn in_map<M: ComptimeStringMapLike>(&self) -> Option<M::Value> {
        // TODO(port): `ComptimeStringMap.getWithEqlList` — Phase B wires phf custom hasher
        M::get_with_eql_list(self, Self::index_of_comptime_array_assume_same_length)
    }

    pub fn in_map_case_insensitive<M: ComptimeStringMapLike>(&self) -> Option<M::Value> {
        // TODO(port): phf custom hasher
        M::get_with_eql_list(self, Self::index_of_comptime_array_case_insensitive_same_length)
    }

    pub fn index_of_comptime_array_case_insensitive_same_length(
        &self,
        values: &'static [&'static [u8]],
    ) -> Option<usize> {
        // PERF(port): was comptime monomorphization (`comptime values`) — profile in Phase B
        if self.is_8bit() {
            let bytes = self.byte_slice();

            for (i, val) in values.iter().enumerate() {
                debug_assert!(bytes.len() == val.len());
                if strings::eql_case_insensitive_ascii_ignore_length(bytes, val) {
                    return Some(i);
                }
            }

            return None;
        }

        let u16_bytes = self.utf16();
        let len0 = values[0].len();
        let buffer: [u8; 256] = 'brk: {
            let mut bytes = [0u8; 256];
            debug_assert!(len0 <= bytes.len());
            debug_assert_eq!(u16_bytes.len(), len0);
            for (byte, &uchar) in bytes[..len0].iter_mut().zip(u16_bytes) {
                if uchar > 255 {
                    return None;
                }
                *byte = u8::try_from(uchar).unwrap();
            }
            break 'brk bytes;
        };

        for (i, val) in values.iter().enumerate() {
            if strings::eql_case_insensitive_ascii_ignore_length(&buffer[..len0], val) {
                return Some(i);
            }
        }

        None
    }

    pub fn has_prefix_comptime(&self, value: &'static [u8]) -> bool {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            return unsafe { self.value.wtf_string_impl.has_prefix(value) };
        }

        let str = self.to_zig_string();
        if str.len() < value.len() {
            return false;
        }

        str.substring_with_len(0, value.len()).eql_comptime(value)
    }

    pub fn is_wtf_allocator(allocator: &dyn bun_alloc::Allocator) -> bool {
        // TODO(port): Zig compared vtable pointer identity to
        // `StringImplAllocator.VTablePtr`. Rust trait objects don't expose a
        // stable vtable address; Phase B should expose a sentinel ZST or use
        // `Any::type_id`.
        core::ptr::eq(
            allocator as *const _ as *const (),
            StringImplAllocator::vtable_ptr(),
        )
    }

    pub fn eql_bytes(&self, value: &[u8]) -> bool {
        strings::eql_long(self.byte_slice(), value, true)
    }

    /// Replace the underlying StringImpl with an isolated copy that is safe to
    /// hand to another thread. This **transfers** ownership: the reference this
    /// String held on the previous StringImpl is released, and the String now
    /// holds exactly one reference to the new (or unchanged) StringImpl.
    pub fn to_thread_safe(&mut self) {
        bun_core::mark_binding();

        if self.tag == Tag::WTFStringImpl {
            bun_cpp::BunString__toThreadSafe(self);
        }
    }

    /// Like `to_thread_safe`, but leaves the result with one extra ref compared
    /// to before the call (i.e. the caller wants `to_thread_safe` + `ref`).
    pub fn to_thread_safe_ensure_ref(&mut self) {
        bun_core::mark_binding();

        if self.tag == Tag::WTFStringImpl {
            bun_cpp::BunString__toThreadSafe(self);
            // SAFETY: tag check guards union access
            unsafe { self.value.wtf_string_impl.ref_() };
        }
    }

    pub fn eql_utf8(&self, other: &[u8]) -> bool {
        self.to_zig_string().eql(&ZigString::from_utf8(other))
    }

    pub fn eql(&self, other: &String) -> bool {
        self.to_zig_string().eql(&other.to_zig_string())
    }

    /// Reports owned allocation size, not the actual size of the string.
    pub fn estimated_size(&self) -> usize {
        match self.tag {
            Tag::Dead | Tag::Empty | Tag::StaticZigString => 0,
            // SAFETY: tag check guards union access
            Tag::ZigString => unsafe { self.value.zig_string.len() },
            Tag::WTFStringImpl => unsafe { self.value.wtf_string_impl.byte_length() },
        }
    }

    // TODO: move ZigString.Slice here
    /// A UTF-8 encoded slice tied to the lifetime of a `bun.String`
    /// Must call `.deinit` to release memory
    pub type Slice = ZigSlice;

    // helper: by-value copy without ref bump (Zig pass-by-value)
    fn dupe_ref_raw(&self) -> String {
        // SAFETY: 24-byte POD copy; caller is responsible for ref counting
        unsafe { core::ptr::read(self) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WTFEncoding
// ──────────────────────────────────────────────────────────────────────────

/// Zig: `enum { latin1, utf16 }` with `fn Byte(comptime this) type`.
/// Ported as a sealed trait so `Byte` is an associated type usable in
/// generic return positions.
pub trait WTFEncoding: sealed::Sealed {
    type Byte: Copy;
    fn create_uninitialized_impl(len: usize) -> (String, &'static mut [Self::Byte]);
    fn create_external_globally_allocated(ptr: *mut Self::Byte, len: usize) -> String;
}

pub struct Latin1;
pub struct Utf16;

mod sealed {
    pub trait Sealed {}
    impl Sealed for super::Latin1 {}
    impl Sealed for super::Utf16 {}
}

impl WTFEncoding for Latin1 {
    type Byte = u8;
    fn create_uninitialized_impl(len: usize) -> (String, &'static mut [u8]) {
        String::create_uninitialized_latin1(len)
    }
    fn create_external_globally_allocated(ptr: *mut u8, len: usize) -> String {
        // SAFETY: ptr/len from Box::into_raw of mimalloc-backed allocation
        unsafe { BunString__createExternalGloballyAllocatedLatin1(ptr, len) }
    }
}

impl WTFEncoding for Utf16 {
    type Byte = u16;
    fn create_uninitialized_impl(len: usize) -> (String, &'static mut [u16]) {
        String::create_uninitialized_utf16(len)
    }
    fn create_external_globally_allocated(ptr: *mut u16, len: usize) -> String {
        // SAFETY: ptr/len from Box::into_raw of mimalloc-backed allocation
        unsafe { BunString__createExternalGloballyAllocatedUTF16(ptr, len) }
    }
}

impl String {
    /// Allocate memory for a WTF::String of a given length and encoding, and
    /// return the string and a mutable slice for that string.
    ///
    /// This is not allowed on zero-length strings, in this case you should
    /// check earlier and use String::EMPTY in that case.
    ///
    /// If the length is too large, this will return a dead string.
    pub fn create_uninitialized<E: WTFEncoding>(len: usize) -> (String, &'static mut [E::Byte]) {
        debug_assert!(len > 0);
        E::create_uninitialized_impl(len)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// From<T> impls for String::init
// ──────────────────────────────────────────────────────────────────────────

impl From<String> for String {
    fn from(value: String) -> Self {
        value
    }
}
// TODO(port): the above blanket `From<String> for String` conflicts with std's
// reflexive `From<T> for T`. Phase B: drop this impl; `init(String)` works via
// the reflexive impl already.

impl From<ZigString> for String {
    fn from(value: ZigString) -> Self {
        String {
            tag: Tag::ZigString,
            value: StringImpl {
                zig_string: ManuallyDrop::new(value),
            },
        }
    }
}

impl<'a> From<&'a ZigString> for String {
    fn from(value: &'a ZigString) -> Self {
        String {
            tag: Tag::ZigString,
            value: StringImpl {
                zig_string: ManuallyDrop::new(value.clone()),
            },
        }
    }
}

impl<'a> From<&'a [u8]> for String {
    fn from(value: &'a [u8]) -> Self {
        String {
            tag: Tag::ZigString,
            value: StringImpl {
                zig_string: ManuallyDrop::new(ZigString::from_bytes(value)),
            },
        }
    }
}

impl<'a> From<&'a [u16]> for String {
    fn from(value: &'a [u16]) -> Self {
        String {
            tag: Tag::ZigString,
            value: StringImpl {
                zig_string: ManuallyDrop::new(ZigString::from16_slice(value)),
            },
        }
    }
}

impl From<WTFStringImpl> for String {
    fn from(value: WTFStringImpl) -> Self {
        String {
            tag: Tag::WTFStringImpl,
            value: StringImpl {
                // TODO(port): WTFStringImpl is `*WTFStringImplStruct` in Zig;
                // see ABI note on the union field.
                wtf_string_impl: ManuallyDrop::new(value),
            },
        }
    }
}

// Zig string literals (`*const [N:0]u8`) → handled by `static_` directly;
// Rust `&'static [u8; N]` coerces to `&'static [u8]` for `static_`.
// TODO(port): cannot replicate the `@typeInfo` literal-detection branch of
// `init`; callers should use `String::static_(b"...")` for literals.

// ──────────────────────────────────────────────────────────────────────────
// Display
// ──────────────────────────────────────────────────────────────────────────

impl fmt::Display for String {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.to_zig_string(), f)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SliceWithUnderlyingString
// ──────────────────────────────────────────────────────────────────────────

pub struct SliceWithUnderlyingString {
    pub utf8: ZigSlice,
    pub underlying: String,

    #[cfg(debug_assertions)]
    pub did_report_extra_memory_debug: bool,
}

impl Default for SliceWithUnderlyingString {
    fn default() -> Self {
        Self {
            utf8: ZigSlice::EMPTY,
            underlying: String::DEAD,
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }
}

impl SliceWithUnderlyingString {
    #[inline]
    pub fn report_extra_memory(&mut self, vm: &OpaqueJSVM) {
        #[cfg(debug_assertions)]
        {
            debug_assert!(!self.did_report_extra_memory_debug);
            self.did_report_extra_memory_debug = true;
        }
        self.utf8.report_extra_memory(vm);
    }

    pub fn is_wtf_allocated(&self) -> bool {
        if let Some(allocator) = self.utf8.allocator() {
            let is_wtf_allocator = String::is_wtf_allocator(allocator);
            return is_wtf_allocator;
        }

        false
    }

    pub fn dupe_ref(&self) -> SliceWithUnderlyingString {
        SliceWithUnderlyingString {
            utf8: ZigSlice::EMPTY,
            underlying: self.underlying.dupe_ref(),
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    /// Transcode a byte array to an encoded String, avoiding unnecessary copies.
    ///
    /// owned_input_bytes ownership is transferred to this function
    pub fn transcode_from_owned_slice(
        owned_input_bytes: Vec<u8>,
        encoding: Encoding,
    ) -> SliceWithUnderlyingString {
        if owned_input_bytes.is_empty() {
            return SliceWithUnderlyingString {
                utf8: ZigSlice::EMPTY,
                underlying: String::EMPTY,
                #[cfg(debug_assertions)]
                did_report_extra_memory_debug: false,
            };
        }

        SliceWithUnderlyingString {
            utf8: ZigSlice::EMPTY,
            underlying: webcore_encoding::to_bun_string_from_owned_slice(owned_input_bytes, encoding),
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    /// Assumes default allocator in use
    pub fn from_utf8(utf8: &[u8]) -> SliceWithUnderlyingString {
        SliceWithUnderlyingString {
            utf8: ZigSlice::init_default(utf8),
            underlying: String::DEAD,
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    pub fn to_thread_safe(&mut self) {
        if self.underlying.tag == Tag::WTFStringImpl {
            // SAFETY: tag check guards union access
            let orig = unsafe { Arc::as_ptr(&self.underlying.value.wtf_string_impl) };
            // BunString__toThreadSafe transfers ownership: it derefs the
            // previous impl and installs a new one. We only need to migrate
            // the utf8 slice if it was a ref-counted view into the old impl.
            self.underlying.to_thread_safe();
            // SAFETY: tag is still WTFStringImpl after to_thread_safe
            let new_ptr = unsafe { Arc::as_ptr(&self.underlying.value.wtf_string_impl) };
            if new_ptr != orig {
                if let Some(allocator) = self.utf8.allocator() {
                    if String::is_wtf_allocator(allocator) {
                        // drop old slice (Drop), replace with view into new impl
                        // SAFETY: tag check guards union access
                        self.utf8 =
                            unsafe { self.underlying.value.wtf_string_impl.to_latin1_slice() };
                    }
                }
            }
        }
    }

    pub fn slice(&self) -> &[u8] {
        self.utf8.slice()
    }
}

impl Drop for SliceWithUnderlyingString {
    fn drop(&mut self) {
        // utf8 has its own Drop; underlying needs explicit deref (intrusive refcount).
        self.underlying.deref();
    }
}

impl fmt::Display for SliceWithUnderlyingString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.utf8.len() == 0 {
            return fmt::Display::fmt(&self.underlying, f);
        }

        fmt::Display::fmt(bstr::BStr::new(self.utf8.slice()), f)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper trait for in_map / in_map_case_insensitive
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): placeholder for `ComptimeStringMap.getWithEqlList` protocol.
pub trait ComptimeStringMapLike {
    type Value;
    fn get_with_eql_list(
        s: &String,
        eql: fn(&String, &'static [&'static [u8]]) -> Option<usize>,
    ) -> Option<Self::Value>;
}

// ──────────────────────────────────────────────────────────────────────────
// Layout assertions
// ──────────────────────────────────────────────────────────────────────────

const _: () = assert!(core::mem::size_of::<String>() == 24);
const _: () = assert!(core::mem::align_of::<String>() == 8);

// ──────────────────────────────────────────────────────────────────────────
// Local re-exports of imports (Zig bottom-of-file imports)
// ──────────────────────────────────────────────────────────────────────────

use crate::immutable::AsciiStatus;

// !Send/!Sync: String holds a thread-affine WTFStringImpl when tag == WTFStringImpl,
// unless explicitly made thread-safe via `to_thread_safe`.
// TODO(port): decide on Send/Sync bounds in Phase B; Zig passed by value freely.
impl core::marker::Unpin for String {}
unsafe impl Sync for StringImpl {}
unsafe impl Send for StringImpl {}
// TODO(port): the two `unsafe impl` above are placeholders so the union (with
// `Arc` field) participates in FFI; revisit once the field is a raw pointer.

// PhantomData to suppress unused-import warnings during Phase A
const _: PhantomData<DebugOnly<bool>> = PhantomData;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/string.zig (1143 lines)
//   confidence: medium
//   todos:      25
//   notes:      StringImpl.wtf_string_impl uses Arc per LIFETIMES.tsv but is #[repr(C)] FFI-crossing — Phase B must use raw *mut WTFStringImplStruct (intrusive refcount); comptime-array fns demoted to runtime slices with PERF markers; all `string_jsc.*` aliases deleted per guide.
// ──────────────────────────────────────────────────────────────────────────
