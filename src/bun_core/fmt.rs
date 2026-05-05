//! Port of src/bun_core/fmt.zig — formatter newtypes and Display impls.

use core::cell::Cell;
use core::fmt::{self, Display, Formatter, Write as _};
use core::ptr::NonNull;

use crate::output as Output;
// MOVE_DOWN: bun_str::strings → bun_core (move-in pass).
use crate::strings;
// MOVE_DOWN: bun_js_parser::{js_printer, js_lexer} → bun_core (move-in pass).
use crate::js_printer;

/// SHA-512 digest length in bytes. Local constant to avoid bun_sha (T2) dependency.
const SHA512_DIGEST: usize = 64;

// ════════════════════════════════════════════════════════════════════════════
// MOVE-IN: strings / js_lexer / js_printer minimal subsets (CYCLEBREAK §→core)
// Only the free functions fmt.rs/output.rs actually call. The full modules
// (SIMD search, codepoint tables, JSON printer) stay in bun_str / bun_js_parser
// which add `pub use bun_core::strings::*` and extend with the heavy bits.
// ════════════════════════════════════════════════════════════════════════════

pub mod strings {
    /// Zig: `bun.strings.contains` / fmt.rs+output.rs call site name.
    #[inline]
    pub fn includes(haystack: &[u8], needle: &[u8]) -> bool {
        if needle.is_empty() { return true; }
        haystack.windows(needle.len()).any(|w| w == needle)
        // PERF(port): was SIMD memmem — profile in Phase B
    }
    #[inline] pub fn contains(h: &[u8], n: &[u8]) -> bool { includes(h, n) }

    #[inline]
    pub fn index_of_char(s: &[u8], c: u8) -> Option<usize> {
        s.iter().position(|&b| b == c)
    }
    #[inline]
    pub fn index_of_any(s: &[u8], chars: &[u8]) -> Option<usize> {
        s.iter().position(|b| chars.contains(b))
    }
    #[inline]
    pub fn first_non_ascii(s: &[u8]) -> Option<usize> {
        s.iter().position(|&b| b >= 0x80)
    }

    /// Zig: `eqlCaseInsensitiveASCII(a, b, check_len)`.
    pub fn eql_case_insensitive_ascii(a: &[u8], b: &[u8], check_len: bool) -> bool {
        if check_len && a.len() != b.len() { return false; }
        let n = core::cmp::min(a.len(), b.len());
        for i in 0..n {
            if a[i].to_ascii_lowercase() != b[i].to_ascii_lowercase() { return false; }
        }
        true
    }

    /// Zig: `bun.strings.isIPV6Address` — heuristic (contains ':', not parseable as v4).
    #[inline]
    pub fn is_ipv6_address(s: &[u8]) -> bool {
        index_of_char(s, b':').is_some()
    }

    /// Allocating replace (output.rs uses it once for `{pid}` substitution).
    pub fn replace_owned(input: &[u8], needle: &[u8], with: &[u8]) -> Vec<u8> {
        if needle.is_empty() { return input.to_vec(); }
        let mut out = Vec::with_capacity(input.len());
        let mut i = 0;
        while i + needle.len() <= input.len() {
            if &input[i..i + needle.len()] == needle {
                out.extend_from_slice(with);
                i += needle.len();
            } else {
                out.push(input[i]);
                i += 1;
            }
        }
        out.extend_from_slice(&input[i..]);
        out
    }

    // ─── secret/uuid sniffers (fmt.rs URL redaction) ──────────────────────
    pub fn starts_with_uuid(s: &[u8]) -> bool {
        // 8-4-4-4-12 hex with dashes
        if s.len() < 36 { return false; }
        for (i, &b) in s[..36].iter().enumerate() {
            let ok = match i { 8 | 13 | 18 | 23 => b == b'-', _ => b.is_ascii_hexdigit() };
            if !ok { return false; }
        }
        true
    }
    pub fn starts_with_npm_secret(s: &[u8]) -> usize {
        if s.len() >= 40 && s.starts_with(b"npm_") && s[4..40].iter().all(|b| b.is_ascii_alphanumeric()) {
            40
        } else { 0 }
    }
    /// Generic high-entropy-looking token. Returns (offset_into_match, len).
    pub fn starts_with_secret(s: &[u8]) -> Option<(usize, usize)> {
        // TODO(port): Zig impl scans for ghp_/glpat-/sk-/xoxb- etc. Minimal
        // subset; bun_str extends.
        for prefix in [b"ghp_".as_slice(), b"sk-", b"glpat-", b"xoxb-", b"xoxp-"] {
            if s.starts_with(prefix) {
                let mut n = prefix.len();
                while n < s.len() && (s[n].is_ascii_alphanumeric() || s[n] == b'_' || s[n] == b'-') {
                    n += 1;
                }
                if n > prefix.len() + 8 { return Some((0, n)); }
            }
        }
        None
    }

    // ─── encoding ─────────────────────────────────────────────────────────
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Encoding { Ascii, Latin1, Utf8, Utf16 }

    #[derive(Clone, Copy, Default)]
    pub struct EncodeResult { pub read: usize, pub written: usize }

    /// Zig: `copyUTF16IntoUTF8`. Scalar fallback; bun_str overrides with SIMD.
    pub fn copy_utf16_into_utf8(dst: &mut [u8], src: &[u16]) -> EncodeResult {
        let mut r = 0usize; let mut w = 0usize;
        while r < src.len() {
            let c = src[r] as u32;
            // TODO(port): surrogate-pair handling — bun_str owns the correct impl.
            if c < 0x80 {
                if w >= dst.len() { break; }
                dst[w] = c as u8; w += 1;
            } else if c < 0x800 {
                if w + 2 > dst.len() { break; }
                dst[w] = 0xC0 | (c >> 6) as u8;
                dst[w+1] = 0x80 | (c & 0x3F) as u8; w += 2;
            } else {
                if w + 3 > dst.len() { break; }
                dst[w] = 0xE0 | (c >> 12) as u8;
                dst[w+1] = 0x80 | ((c >> 6) & 0x3F) as u8;
                dst[w+2] = 0x80 | (c & 0x3F) as u8; w += 3;
            }
            r += 1;
        }
        EncodeResult { read: r, written: w }
    }
    /// Zig: `copyLatin1IntoUTF8`.
    pub fn copy_latin1_into_utf8(dst: &mut [u8], src: &[u8]) -> EncodeResult {
        let mut r = 0usize; let mut w = 0usize;
        while r < src.len() {
            let c = src[r];
            if c < 0x80 {
                if w >= dst.len() { break; }
                dst[w] = c; w += 1;
            } else {
                if w + 2 > dst.len() { break; }
                dst[w] = 0xC0 | (c >> 6);
                dst[w+1] = 0x80 | (c & 0x3F); w += 2;
            }
            r += 1;
        }
        EncodeResult { read: r, written: w }
    }

    // ─── CodepointIterator (fmt.rs identifier formatter) ──────────────────
    #[derive(Default, Clone, Copy)]
    pub struct CodepointIteratorCursor { pub i: usize, pub c: i32, pub width: u8 }
    pub struct CodepointIterator<'a> { bytes: &'a [u8] }
    impl<'a> CodepointIterator<'a> {
        #[inline] pub fn init(bytes: &'a [u8]) -> Self { Self { bytes } }
        pub fn next(&self, cursor: &mut CodepointIteratorCursor) -> bool {
            let i = cursor.i + cursor.width as usize;
            if i >= self.bytes.len() { return false; }
            let b = self.bytes[i];
            // TODO(port): full UTF-8 decode — bun_str owns the table-driven impl.
            let (cp, w) = if b < 0x80 { (b as i32, 1u8) } else { (b as i32, 1u8) };
            cursor.i = i; cursor.c = cp; cursor.width = w;
            true
        }
    }
}

pub mod js_lexer {
    /// Zig: js_lexer.isIdentifierStart — ASCII fast path; bun_js_parser extends
    /// with the full Unicode ID_Start table.
    #[inline]
    pub fn is_identifier_start(c: i32) -> bool {
        matches!(c, 0x24 /* $ */ | 0x5F /* _ */)
            || (c >= b'a' as i32 && c <= b'z' as i32)
            || (c >= b'A' as i32 && c <= b'Z' as i32)
            || c > 0x7F // PERF(port): defer Unicode table to bun_js_parser
    }
    #[inline]
    pub fn is_identifier_continue(c: i32) -> bool {
        is_identifier_start(c) || (c >= b'0' as i32 && c <= b'9' as i32)
    }
}

pub mod js_printer {
    use core::fmt;
    use super::strings::Encoding;
    /// Zig: js_printer.writeJSONString — minimal escape set for fmt.rs quoting.
    /// bun_js_printer overrides with the full (ctrl-char, \u escape, encoding-aware) impl.
    pub fn write_json_string(input: &[u8], f: &mut impl fmt::Write, _enc: Encoding) -> fmt::Result {
        f.write_char('"')?;
        for &b in input {
            match b {
                b'"' => f.write_str("\\\"")?,
                b'\\' => f.write_str("\\\\")?,
                b'\n' => f.write_str("\\n")?,
                b'\r' => f.write_str("\\r")?,
                b'\t' => f.write_str("\\t")?,
                0x00..=0x1F => write!(f, "\\u{:04x}", b)?,
                _ => f.write_char(b as char)?,
            }
        }
        f.write_char('"')
    }
    pub fn write_pre_quoted_string(
        input: &[u8],
        f: &mut impl fmt::Write,
        quote: u8,
        _allow_backtick: bool,
        enc: Encoding,
    ) -> fmt::Result {
        let _ = (quote, enc);
        // TODO(port): full impl in bun_js_printer; this tier only needs the
        // "already quoted" passthrough for fmt.rs JS-string display.
        write_json_string(input, f, enc)
    }
}
use strum::IntoStaticStr;

// ───────────────────────────────────────────────────────────────────────────
// TableSymbols
// ───────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct TableSymbols {
    pub enable_ansi_colors: bool,
}

impl TableSymbols {
    pub const UNICODE: TableSymbols = TableSymbols { enable_ansi_colors: true };
    pub const ASCII: TableSymbols = TableSymbols { enable_ansi_colors: false };

    pub const fn top_left_sep(self) -> &'static str {
        if self.enable_ansi_colors { "┌" } else { "|" }
    }
    pub const fn top_right_sep(self) -> &'static str {
        if self.enable_ansi_colors { "┐" } else { "|" }
    }
    pub const fn top_column_sep(self) -> &'static str {
        if self.enable_ansi_colors { "┬" } else { "-" }
    }

    pub const fn bottom_left_sep(self) -> &'static str {
        if self.enable_ansi_colors { "└" } else { "|" }
    }
    pub const fn bottom_right_sep(self) -> &'static str {
        if self.enable_ansi_colors { "┘" } else { "|" }
    }
    pub const fn bottom_column_sep(self) -> &'static str {
        if self.enable_ansi_colors { "┴" } else { "-" }
    }

    pub const fn middle_left_sep(self) -> &'static str {
        if self.enable_ansi_colors { "├" } else { "|" }
    }
    pub const fn middle_right_sep(self) -> &'static str {
        if self.enable_ansi_colors { "┤" } else { "|" }
    }
    pub const fn middle_column_sep(self) -> &'static str {
        if self.enable_ansi_colors { "┼" } else { "|" }
    }

    pub const fn horizontal_edge(self) -> &'static str {
        if self.enable_ansi_colors { "─" } else { "-" }
    }
    pub const fn vertical_edge(self) -> &'static str {
        if self.enable_ansi_colors { "│" } else { "|" }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Table
// ───────────────────────────────────────────────────────────────────────────

// TODO(port): Zig `column_color` was a comptime `[]const u8` param spliced into the
// format string at compile time. Rust const generics don't accept `&'static str`, so
// it is stored as a runtime field and the format string is built at print time.
pub struct Table<
    'a,
    const COLUMN_LEFT_PAD: usize,
    const COLUMN_RIGHT_PAD: usize,
    const ENABLE_ANSI_COLORS: bool,
> {
    pub column_names: &'a [&'a [u8]],
    pub column_inside_lengths: &'a [usize],
    pub column_color: &'static str,
}

impl<'a, const L: usize, const R: usize, const C: bool> Table<'a, L, R, C> {
    const SYMBOLS: TableSymbols = TableSymbols { enable_ansi_colors: C };

    pub fn init(
        column_names: &'a [&'a [u8]],
        column_inside_lengths: &'a [usize],
        column_color: &'static str,
    ) -> Self {
        Self { column_names, column_inside_lengths, column_color }
    }

    pub fn print_top_line_separator(&self) {
        self.print_line(
            Self::SYMBOLS.top_left_sep(),
            Self::SYMBOLS.top_right_sep(),
            Self::SYMBOLS.top_column_sep(),
        );
    }

    pub fn print_bottom_line_separator(&self) {
        self.print_line(
            Self::SYMBOLS.bottom_left_sep(),
            Self::SYMBOLS.bottom_right_sep(),
            Self::SYMBOLS.bottom_column_sep(),
        );
    }

    pub fn print_line_separator(&self) {
        self.print_line(
            Self::SYMBOLS.middle_left_sep(),
            Self::SYMBOLS.middle_right_sep(),
            Self::SYMBOLS.middle_column_sep(),
        );
    }

    pub fn print_line(
        &self,
        left_edge_separator: &str,
        right_edge_separator: &str,
        column_separator: &str,
    ) {
        for (i, &column_inside_length) in self.column_inside_lengths.iter().enumerate() {
            if i == 0 {
                Output::pretty(format_args!("{}", left_edge_separator));
            } else {
                Output::pretty(format_args!("{}", column_separator));
            }

            for _ in 0..(L + column_inside_length + R) {
                Output::pretty(format_args!("{}", Self::SYMBOLS.horizontal_edge()));
            }

            if i == self.column_inside_lengths.len() - 1 {
                Output::pretty(format_args!("{}\n", right_edge_separator));
            }
        }
    }

    pub fn print_column_names(&self) {
        for (i, &column_inside_length) in self.column_inside_lengths.iter().enumerate() {
            Output::pretty(format_args!("{}", Self::SYMBOLS.vertical_edge()));
            for _ in 0..L {
                Output::pretty(format_args!(" "));
            }
            // TODO(port): Zig spliced `column_color` into the comptime format string
            // ("<b><" ++ column_color ++ ">{s}<r>"). Replicate via Output::pretty's
            // runtime tag handling.
            Output::pretty(format_args!(
                "<b><{}>{}<r>",
                self.column_color,
                bstr::BStr::new(self.column_names[i]),
            ));
            for _ in self.column_names[i].len()..(column_inside_length + R) {
                Output::pretty(format_args!(" "));
            }
            if i == self.column_inside_lengths.len() - 1 {
                Output::pretty(format_args!("{}\n", Self::SYMBOLS.vertical_edge()));
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// RedactedNpmUrlFormatter
// ───────────────────────────────────────────────────────────────────────────

pub struct RedactedNpmUrlFormatter<'a> {
    pub url: &'a [u8],
}

impl Display for RedactedNpmUrlFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let mut i: usize = 0;
        while i < self.url.len() {
            if strings::starts_with_uuid(&self.url[i..]) {
                f.write_str("***")?;
                i += 36;
                continue;
            }

            let npm_secret_len = strings::starts_with_npm_secret(&self.url[i..]);
            if npm_secret_len > 0 {
                f.write_str("***")?;
                i += npm_secret_len;
                continue;
            }

            // TODO: redact password from `https://username:password@registry.com/`

            f.write_char(self.url[i] as char)?;
            i += 1;
        }
        Ok(())
    }
}

pub fn redacted_npm_url(str: &[u8]) -> RedactedNpmUrlFormatter<'_> {
    RedactedNpmUrlFormatter { url: str }
}

// ───────────────────────────────────────────────────────────────────────────
// RedactedSourceFormatter
// ───────────────────────────────────────────────────────────────────────────

pub struct RedactedSourceFormatter<'a> {
    pub text: &'a [u8],
}

impl Display for RedactedSourceFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let mut i: usize = 0;
        while i < self.text.len() {
            if let Some((offset, len)) = strings::starts_with_secret(&self.text[i..]) {
                write_bytes(f, &self.text[i..][..offset])?;
                splat_byte_all(f, b'*', len)?;
                i += offset + len;
                continue;
            }

            f.write_char(self.text[i] as char)?;
            i += 1;
        }
        Ok(())
    }
}

pub fn redacted_source(str: &[u8]) -> RedactedSourceFormatter<'_> {
    RedactedSourceFormatter { text: str }
}

// ───────────────────────────────────────────────────────────────────────────
// DependencyUrlFormatter
// https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/node_modules/npm-package-arg/lib/npa.js#L163
// ───────────────────────────────────────────────────────────────────────────

pub struct DependencyUrlFormatter<'a> {
    pub url: &'a [u8],
}

impl Display for DependencyUrlFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let mut remain = self.url;
        while let Some(slash) = strings::index_of_char(remain, b'/') {
            write_bytes(f, &remain[..slash])?;
            f.write_str("%2f")?;
            remain = &remain[slash + 1..];
        }
        write_bytes(f, remain)
    }
}

pub fn dependency_url(url: &[u8]) -> DependencyUrlFormatter<'_> {
    DependencyUrlFormatter { url }
}

// ───────────────────────────────────────────────────────────────────────────
// IntegrityFormatter
// ───────────────────────────────────────────────────────────────────────────

// B-1: ConstParamTy is nightly (adt_const_params). Use as runtime value instead.
#[derive(PartialEq, Eq, Clone, Copy)]
pub enum IntegrityFormatStyle {
    Short,
    Full,
}

pub struct IntegrityFormatter<const STYLE: IntegrityFormatStyle> {
    pub bytes: [u8; SHA512_DIGEST],
}

impl<const STYLE: IntegrityFormatStyle> Display for IntegrityFormatter<STYLE> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        // TODO(port): std.base64.standard.Encoder.calcSize — compute exact len at const time.
        const BUF_LEN: usize = (SHA512_DIGEST + 2) / 3 * 4;
        let mut buf = [0u8; BUF_LEN];
        let count = bun_simdutf::base64::encode(
            &self.bytes[..SHA512_DIGEST],
            &mut buf,
            false,
        );

        let encoded = &buf[..count];

        if STYLE == IntegrityFormatStyle::Short {
            write!(
                f,
                "sha512-{}[...]{}",
                bstr::BStr::new(&encoded[..13]),
                bstr::BStr::new(&encoded[encoded.len() - 15..]),
            )
        } else {
            write!(f, "sha512-{}", bstr::BStr::new(encoded))
        }
    }
}

pub fn integrity<const STYLE: IntegrityFormatStyle>(
    bytes: [u8; SHA512_DIGEST],
) -> IntegrityFormatter<STYLE> {
    IntegrityFormatter { bytes }
}

// ───────────────────────────────────────────────────────────────────────────
// JSON formatters
// ───────────────────────────────────────────────────────────────────────────

struct JSONFormatter<'a> {
    input: &'a [u8],
}

impl Display for JSONFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        js_printer::write_json_string(self.input, f, strings::Encoding::Latin1)
    }
}

pub struct JSONFormatterUTF8<'a> {
    input: &'a [u8],
    opts: JSONFormatterUTF8Options,
}

#[derive(Clone, Copy)]
pub struct JSONFormatterUTF8Options {
    pub quote: bool,
}

impl Default for JSONFormatterUTF8Options {
    fn default() -> Self {
        Self { quote: true }
    }
}

impl Display for JSONFormatterUTF8<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        if self.opts.quote {
            js_printer::write_json_string(self.input, f, strings::Encoding::Utf8)
        } else {
            js_printer::write_pre_quoted_string(
                self.input,
                f,
                b'"',
                false,
                true,
                strings::Encoding::Utf8,
            )
        }
    }
}

/// Expects latin1
pub fn format_json_string_latin1(text: &[u8]) -> JSONFormatter<'_> {
    JSONFormatter { input: text }
}

pub fn format_json_string_utf8(text: &[u8], opts: JSONFormatterUTF8Options) -> JSONFormatterUTF8<'_> {
    JSONFormatterUTF8 { input: text, opts }
}

// ───────────────────────────────────────────────────────────────────────────
// Shared temp buffer (threadlocal)
// ───────────────────────────────────────────────────────────────────────────

type SharedTempBuffer = [u8; 32 * 1024];

thread_local! {
    static SHARED_TEMP_BUFFER_PTR: Cell<Option<NonNull<SharedTempBuffer>>> =
        const { Cell::new(None) };
}

fn get_shared_buffer() -> &'static mut SharedTempBuffer {
    SHARED_TEMP_BUFFER_PTR.with(|cell| {
        let ptr = match cell.get() {
            Some(p) => p,
            None => {
                let b = Box::new([0u8; 32 * 1024]);
                // SAFETY: Box::into_raw is non-null.
                let p = unsafe { NonNull::new_unchecked(Box::into_raw(b)) };
                cell.set(Some(p));
                p
            }
        };
        // SAFETY: pointer is owned by this thread's cell; caller is the unique
        // borrower (Zig code defensively nulls the cell during use to handle recursion).
        unsafe { &mut *ptr.as_ptr() }
    })
}

// ───────────────────────────────────────────────────────────────────────────
// UTF-16 formatting
// ───────────────────────────────────────────────────────────────────────────

pub fn format_utf16_type(slice_: &[u16], writer: &mut impl fmt::Write) -> fmt::Result {
    let chunk_ptr = get_shared_buffer().as_mut_ptr();
    // SAFETY: chunk_ptr was just obtained from get_shared_buffer() (Box-allocated, thread-local);
    // we are the unique borrower for this scope and the cell is nulled below to guard recursion.
    let chunk: &mut SharedTempBuffer = unsafe { &mut *(chunk_ptr as *mut SharedTempBuffer) };

    // Defensively ensure recursion doesn't cause the buffer to be overwritten in-place
    SHARED_TEMP_BUFFER_PTR.with(|c| c.set(None));
    let _guard = scopeguard::guard((), |_| {
        SHARED_TEMP_BUFFER_PTR.with(|c| {
            if let Some(existing) = c.get() {
                if existing.as_ptr() as *mut u8 != chunk_ptr {
                    // SAFETY: chunk_ptr was allocated via Box::into_raw above.
                    drop(unsafe { Box::from_raw(chunk_ptr as *mut SharedTempBuffer) });
                }
            } else {
                // SAFETY: chunk_ptr is non-null (came from Box::into_raw).
                c.set(Some(unsafe { NonNull::new_unchecked(chunk_ptr as *mut SharedTempBuffer) }));
            }
        });
    });

    let mut slice = slice_;

    while !slice.is_empty() {
        let result = strings::copy_utf16_into_utf8(chunk, slice);
        if result.read == 0 || result.written == 0 {
            break;
        }
        write_bytes(writer, &chunk[..result.written])?;
        slice = &slice[result.read..];
    }
    Ok(())
}

pub fn format_utf16_type_with_path_options(
    slice_: &[u16],
    writer: &mut impl fmt::Write,
    opts: PathFormatOptions,
) -> fmt::Result {
    let chunk_ptr = get_shared_buffer().as_mut_ptr();
    // SAFETY: chunk_ptr was just obtained from get_shared_buffer() (Box-allocated, thread-local);
    // we are the unique borrower for this scope and the cell is nulled below to guard recursion.
    let chunk: &mut SharedTempBuffer = unsafe { &mut *(chunk_ptr as *mut SharedTempBuffer) };

    // Defensively ensure recursion doesn't cause the buffer to be overwritten in-place
    SHARED_TEMP_BUFFER_PTR.with(|c| c.set(None));
    let _guard = scopeguard::guard((), |_| {
        SHARED_TEMP_BUFFER_PTR.with(|c| {
            if let Some(existing) = c.get() {
                if existing.as_ptr() as *mut u8 != chunk_ptr {
                    // SAFETY: chunk_ptr was allocated via Box::into_raw above.
                    drop(unsafe { Box::from_raw(chunk_ptr as *mut SharedTempBuffer) });
                }
            } else {
                // SAFETY: chunk_ptr is non-null.
                c.set(Some(unsafe { NonNull::new_unchecked(chunk_ptr as *mut SharedTempBuffer) }));
            }
        });
    });

    let mut slice = slice_;

    while !slice.is_empty() {
        let result = strings::copy_utf16_into_utf8(chunk, slice);
        if result.read == 0 || result.written == 0 {
            break;
        }

        let to_write = &chunk[..result.written];
        if !opts.escape_backslashes && opts.path_sep == PathSep::Any {
            write_bytes(writer, to_write)?;
        } else {
            let mut ptr = to_write;
            while let Some(i) = strings::index_of_any(ptr, b"\\/") {
                let sep = match opts.path_sep {
                    PathSep::Windows => b'\\',
                    PathSep::Posix => b'/',
                    PathSep::Auto => crate::SEP,
                    PathSep::Any => ptr[i],
                };
                write_bytes(writer, &ptr[..i])?;
                writer.write_char(sep as char)?;
                if opts.escape_backslashes && sep == b'\\' {
                    writer.write_char(sep as char)?;
                }

                ptr = &ptr[i + 1..];
            }
            write_bytes(writer, ptr)?;
        }
        slice = &slice[result.read..];
    }
    Ok(())
}

#[inline]
pub fn utf16(slice_: &[u16]) -> FormatUTF16<'_> {
    FormatUTF16 { buf: slice_, path_fmt_opts: None }
}

/// Debug, this does not handle invalid utf32
#[inline]
pub fn debug_utf32_path_formatter(path: &[u32]) -> DebugUTF32PathFormatter<'_> {
    DebugUTF32PathFormatter { path }
}

pub struct DebugUTF32PathFormatter<'a> {
    pub path: &'a [u32],
}

impl Display for DebugUTF32PathFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let mut path_buf = crate::PathBuffer::uninit();
        let result = bun_simdutf::convert::utf32::to_utf8_with_errors_le(self.path, path_buf.as_mut_slice());
        let converted: &[u8] = if result.is_successful() {
            &path_buf.as_slice()[..result.count]
        } else {
            b"Invalid UTF32!"
        };

        write_bytes(f, converted)
    }
}

pub struct FormatUTF16<'a> {
    pub buf: &'a [u16],
    pub path_fmt_opts: Option<PathFormatOptions>,
}

impl Display for FormatUTF16<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        if let Some(opts) = self.path_fmt_opts {
            format_utf16_type_with_path_options(self.buf, f, opts)
        } else {
            format_utf16_type(self.buf, f)
        }
    }
}

pub struct FormatUTF8<'a> {
    pub buf: &'a [u8],
    pub path_fmt_opts: Option<PathFormatOptions>,
}

impl Display for FormatUTF8<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        if let Some(opts) = self.path_fmt_opts {
            if opts.path_sep == PathSep::Any && !opts.escape_backslashes {
                return write_bytes(f, self.buf);
            }

            let mut ptr = self.buf;
            while let Some(i) = strings::index_of_any(ptr, b"\\/") {
                let sep = match opts.path_sep {
                    PathSep::Windows => b'\\',
                    PathSep::Posix => b'/',
                    PathSep::Auto => crate::SEP,
                    PathSep::Any => ptr[i],
                };
                write_bytes(f, &ptr[..i])?;
                f.write_char(sep as char)?;
                if opts.escape_backslashes && sep == b'\\' {
                    f.write_char(sep as char)?;
                }
                ptr = &ptr[i + 1..];
            }

            return write_bytes(f, ptr);
        }

        write_bytes(f, self.buf)
    }
}

#[derive(Clone, Copy)]
pub struct PathFormatOptions {
    /// The path separator used when formatting the path.
    pub path_sep: PathSep,
    /// Any backslashes are escaped, including backslashes added through `path_sep`.
    pub escape_backslashes: bool,
}

impl Default for PathFormatOptions {
    fn default() -> Self {
        Self { path_sep: PathSep::Any, escape_backslashes: false }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PathSep {
    /// Keep paths separators as is.
    Any,
    /// Replace all path separators with the current platform path separator.
    Auto,
    /// Replace all path separators with `/`.
    Posix,
    /// Replace all path separators with `\`.
    Windows,
}

#[cfg(windows)]
pub type FormatOSPath<'a> = FormatUTF16<'a>;
#[cfg(not(windows))]
pub type FormatOSPath<'a> = FormatUTF8<'a>;

// TYPE_ONLY: bun_paths::OSPathSlice → bun_core (move-in pass).
pub fn fmt_os_path(buf: crate::OSPathSlice<'_>, options: PathFormatOptions) -> FormatOSPath<'_> {
    FormatOSPath { buf, path_fmt_opts: Some(options) }
}

// TODO(port): Zig `fmtPath` dispatches on `comptime T: type` returning either FormatUTF8
// or FormatUTF16. In Rust, callers should call `fmt_path_u8` / `fmt_path_u16` directly,
// or use a small trait. Providing both monomorphizations here.
pub fn fmt_path_u8(path: &[u8], options: PathFormatOptions) -> FormatUTF8<'_> {
    FormatUTF8 { buf: path, path_fmt_opts: Some(options) }
}
pub fn fmt_path_u16(path: &[u16], options: PathFormatOptions) -> FormatUTF16<'_> {
    FormatUTF16 { buf: path, path_fmt_opts: Some(options) }
}

// ───────────────────────────────────────────────────────────────────────────
// Latin-1 formatting
// ───────────────────────────────────────────────────────────────────────────

pub fn format_latin1(slice_: &[u8], writer: &mut impl fmt::Write) -> fmt::Result {
    let chunk_ptr = get_shared_buffer().as_mut_ptr();
    // SAFETY: chunk_ptr was just obtained from get_shared_buffer() (Box-allocated, thread-local);
    // we are the unique borrower for this scope and the cell is nulled below to guard recursion.
    let chunk: &mut SharedTempBuffer = unsafe { &mut *(chunk_ptr as *mut SharedTempBuffer) };
    let mut slice = slice_;

    // Defensively ensure recursion doesn't cause the buffer to be overwritten in-place
    SHARED_TEMP_BUFFER_PTR.with(|c| c.set(None));
    let _guard = scopeguard::guard((), |_| {
        SHARED_TEMP_BUFFER_PTR.with(|c| {
            if let Some(existing) = c.get() {
                if existing.as_ptr() as *mut u8 != chunk_ptr {
                    // SAFETY: chunk_ptr was allocated via Box::into_raw.
                    drop(unsafe { Box::from_raw(chunk_ptr as *mut SharedTempBuffer) });
                }
            } else {
                // SAFETY: chunk_ptr is non-null.
                c.set(Some(unsafe { NonNull::new_unchecked(chunk_ptr as *mut SharedTempBuffer) }));
            }
        });
    });

    while let Some(i) = strings::first_non_ascii(slice) {
        if i > 0 {
            write_bytes(writer, &slice[..i])?;
            slice = &slice[i..];
        }
        let take = chunk.len().min(slice.len());
        let result = strings::copy_latin1_into_utf8(chunk, &slice[..take]);
        if result.read == 0 || result.written == 0 {
            break;
        }
        write_bytes(writer, &chunk[..result.written])?;
        slice = &slice[result.read..];
    }

    if !slice.is_empty() {
        write_bytes(writer, slice)?; // write the remaining bytes
    }
    Ok(())
}

// ───────────────────────────────────────────────────────────────────────────
// URLFormatter
// ───────────────────────────────────────────────────────────────────────────

pub struct URLFormatter<'a> {
    pub proto: URLProto,
    pub hostname: Option<&'a [u8]>,
    pub port: Option<u16>,
}

impl Default for URLFormatter<'_> {
    fn default() -> Self {
        Self { proto: URLProto::Http, hostname: None, port: None }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum URLProto {
    Http,
    Https,
    Unix,
    Abstract,
}

impl Display for URLFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, "{}://", match self.proto {
            URLProto::Http => "http",
            URLProto::Https => "https",
            URLProto::Unix => "unix",
            URLProto::Abstract => "abstract",
        })?;

        if let Some(hostname) = self.hostname {
            let needs_brackets = hostname[0] != b'[' && strings::is_ipv6_address(hostname);
            if needs_brackets {
                write!(f, "[{}]", bstr::BStr::new(hostname))?;
            } else {
                write_bytes(f, hostname)?;
            }
        } else {
            f.write_str("localhost")?;
        }

        if self.proto == URLProto::Unix {
            return Ok(());
        }

        let is_port_optional = self.port.is_none()
            || (self.proto == URLProto::Https && self.port == Some(443))
            || (self.proto == URLProto::Http && self.port == Some(80));
        if is_port_optional {
            f.write_str("/")
        } else {
            write!(f, ":{}/", self.port.unwrap())
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// HostFormatter
// ───────────────────────────────────────────────────────────────────────────

pub struct HostFormatter<'a> {
    pub host: &'a [u8],
    pub port: Option<u16>,
    pub is_https: bool,
}

impl Display for HostFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        if strings::index_of_char(self.host, b':').is_some() {
            return write_bytes(f, self.host);
        }

        write_bytes(f, self.host)?;

        let is_port_optional = self.port.is_none()
            || (self.is_https && self.port == Some(443))
            || (!self.is_https && self.port == Some(80));
        if !is_port_optional {
            write!(f, ":{}", self.port.unwrap())?;
        }
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// FormatValidIdentifier
// ───────────────────────────────────────────────────────────────────────────

/// Format a string to an ECMAScript identifier.
/// Unlike the string_mutable.zig version, this always allocate/copy
pub fn fmt_identifier(name: &[u8]) -> FormatValidIdentifier<'_> {
    FormatValidIdentifier { name }
}

/// Format a string to an ECMAScript identifier.
/// Different implementation than string_mutable because string_mutable may avoid allocating
/// This will always allocate
pub struct FormatValidIdentifier<'a> {
    pub name: &'a [u8],
}

impl Display for FormatValidIdentifier<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        use crate::js_lexer;

        let mut iterator = strings::CodepointIterator::init(self.name);
        let mut cursor = strings::CodepointIteratorCursor::default();

        let mut has_needed_gap = false;
        let mut needs_gap;
        let mut start_i: usize = 0;

        if !iterator.next(&mut cursor) {
            return f.write_str("_");
        }

        // Common case: no gap necessary. No allocation necessary.
        needs_gap = !js_lexer::is_identifier_start(cursor.c);
        if !needs_gap {
            // Are there any non-alphanumeric chars at all?
            while iterator.next(&mut cursor) {
                if !js_lexer::is_identifier_continue(cursor.c) || cursor.width > 1 {
                    needs_gap = true;
                    start_i = cursor.i as usize;
                    break;
                }
            }
        }

        if needs_gap {
            needs_gap = false;
            if start_i > 0 {
                write_bytes(f, &self.name[..start_i])?;
            }
            let slice = &self.name[start_i..];
            iterator = strings::CodepointIterator::init(slice);
            cursor = strings::CodepointIteratorCursor::default();

            while iterator.next(&mut cursor) {
                if js_lexer::is_identifier_continue(cursor.c) && cursor.width == 1 {
                    if needs_gap {
                        f.write_str("_")?;
                        needs_gap = false;
                        has_needed_gap = true;
                    }
                    let i = cursor.i as usize;
                    write_bytes(f, &slice[i..i + cursor.width as usize])?;
                } else if !needs_gap {
                    needs_gap = true;
                    // skip the code point, replace it with a single _
                }
            }

            // If it ends with an emoji
            if needs_gap {
                f.write_str("_")?;
                #[allow(unused_assignments)]
                {
                    needs_gap = false;
                    has_needed_gap = true;
                }
            }

            let _ = has_needed_gap;
            return Ok(());
        }

        write_bytes(f, self.name)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// GitHub Actions formatting
// ───────────────────────────────────────────────────────────────────────────

/// Formats a string to be safe to output in a Github action.
/// - Encodes "\n" as "%0A" to support multi-line strings.
///   https://github.com/actions/toolkit/issues/193#issuecomment-605394935
/// - Strips ANSI output as it will appear malformed.
pub fn github_action_writer(writer: &mut impl fmt::Write, self_: &[u8]) -> fmt::Result {
    let mut offset: usize = 0;
    let end = self_.len() as u32;
    while (offset as u32) < end {
        if let Some(i) = strings::index_of_newline_or_non_ascii_or_ansi(self_, offset as u32) {
            let i = i as usize;
            let byte = self_[i];
            if byte > 0x7F {
                offset += (strings::wtf8_byte_sequence_length(byte) as usize).max(1);
                continue;
            }
            if i > 0 {
                write_bytes(writer, &self_[offset..i])?;
            }
            let mut n: usize = 1;
            if byte == b'\n' {
                writer.write_str("%0A")?;
            } else if (i + 1) < end as usize {
                let next = self_[i + 1];
                if byte == b'\r' && next == b'\n' {
                    n += 1;
                    writer.write_str("%0A")?;
                } else if byte == 0x1b && next == b'[' {
                    n += 1;
                    if (i + 2) < end as usize {
                        let upper = (i + 5).min(end as usize);
                        let remain = &self_[(i + 2)..upper];
                        if let Some(j) = strings::index_of_char(remain, b'm') {
                            n += j + 1;
                        }
                    }
                }
            }
            offset = i + n;
        } else {
            write_bytes(writer, &self_[offset..end as usize])?;
            break;
        }
    }
    Ok(())
}

pub struct GithubActionFormatter<'a> {
    pub text: &'a [u8],
}

impl Display for GithubActionFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        github_action_writer(f, self.text)
    }
}

pub fn github_action(self_: &[u8]) -> GithubActionFormatter<'_> {
    GithubActionFormatter { text: self_ }
}

// ───────────────────────────────────────────────────────────────────────────
// QuotedFormatter
// ───────────────────────────────────────────────────────────────────────────

pub fn quoted_writer(writer: &mut impl fmt::Write, self_: &[u8]) -> fmt::Result {
    let remain = self_;
    if strings::contains_newline_or_non_ascii_or_quote(remain) {
        js_printer::write_json_string(self_, writer, strings::Encoding::Utf8)
    } else {
        writer.write_str("\"")?;
        write_bytes(writer, self_)?;
        writer.write_str("\"")
    }
}

pub struct QuotedFormatter<'a> {
    pub text: &'a [u8],
}

impl Display for QuotedFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        quoted_writer(f, self.text)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// QuickAndDirtyJavaScriptSyntaxHighlighter
// ───────────────────────────────────────────────────────────────────────────

pub fn fmt_java_script(
    text: &[u8],
    opts: HighlighterOptions,
) -> QuickAndDirtyJavaScriptSyntaxHighlighter<'_> {
    QuickAndDirtyJavaScriptSyntaxHighlighter { text, opts }
}

pub struct QuickAndDirtyJavaScriptSyntaxHighlighter<'a> {
    pub text: &'a [u8],
    pub opts: HighlighterOptions,
}

#[derive(Clone, Copy)]
pub struct HighlighterOptions {
    pub enable_colors: bool,
    pub check_for_unhighlighted_write: bool,
    pub redact_sensitive_information: bool,
}

impl Default for HighlighterOptions {
    fn default() -> Self {
        Self {
            enable_colors: false,
            check_for_unhighlighted_write: true,
            redact_sensitive_information: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ColorCode {
    Magenta,
    Blue,
    Orange,
    Red,
    Pink,
}

impl ColorCode {
    pub fn color(self) -> &'static str {
        match self {
            ColorCode::Magenta => "\x1b[35m",
            ColorCode::Blue => "\x1b[34m",
            ColorCode::Orange => "\x1b[33m",
            ColorCode::Red => "\x1b[31m",
            // light pink
            ColorCode::Pink => "\x1b[38;5;206m",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
// bun.ComptimeEnumMap(Keyword) — Zig builds a comptime perfect-hash map keyed by @tagName.
// Mapped to `phf::Map<&'static [u8], Keyword>` in `Keywords::get` below.
pub enum Keyword {
    Abstract,
    As,
    Async,
    Await,
    Case,
    Catch,
    Class,
    Const,
    Continue,
    Debugger,
    Default,
    Delete,
    Do,
    Else,
    Enum,
    Export,
    Extends,
    False,
    Finally,
    For,
    Function,
    If,
    Implements,
    Import,
    In,
    Instanceof,
    Interface,
    Let,
    New,
    Null,
    Package,
    Private,
    Protected,
    Public,
    Return,
    Static,
    Super,
    Switch,
    This,
    Throw,
    Break,
    True,
    Try,
    Type,
    Typeof,
    Var,
    Void,
    While,
    With,
    Yield,
    String,
    Number,
    Boolean,
    Symbol,
    Any,
    Object,
    Unknown,
    Never,
    Namespace,
    Declare,
    Readonly,
    Undefined,
}

impl Keyword {
    pub fn color_code(self) -> ColorCode {
        use ColorCode::*;
        use Keyword as K;
        match self {
            K::Abstract => Blue,
            K::As => Blue,
            K::Async => Magenta,
            K::Await => Magenta,
            K::Case => Magenta,
            K::Catch => Magenta,
            K::Class => Magenta,
            K::Const => Magenta,
            K::Continue => Magenta,
            K::Debugger => Magenta,
            K::Default => Magenta,
            K::Delete => Red,
            K::Do => Magenta,
            K::Else => Magenta,
            K::Break => Magenta,
            K::Undefined => Orange,
            K::Enum => Blue,
            K::Export => Magenta,
            K::Extends => Magenta,
            K::False => Orange,
            K::Finally => Magenta,
            K::For => Magenta,
            K::Function => Magenta,
            K::If => Magenta,
            K::Implements => Blue,
            K::Import => Magenta,
            K::In => Magenta,
            K::Instanceof => Magenta,
            K::Interface => Blue,
            K::Let => Magenta,
            K::New => Magenta,
            K::Null => Orange,
            K::Package => Magenta,
            K::Private => Blue,
            K::Protected => Blue,
            K::Public => Blue,
            K::Return => Magenta,
            K::Static => Magenta,
            K::Super => Magenta,
            K::Switch => Magenta,
            K::This => Orange,
            K::Throw => Magenta,
            K::True => Orange,
            K::Try => Magenta,
            K::Type => Blue,
            K::Typeof => Magenta,
            K::Var => Magenta,
            K::Void => Magenta,
            K::While => Magenta,
            K::With => Magenta,
            K::Yield => Magenta,
            K::String => Blue,
            K::Number => Blue,
            K::Boolean => Blue,
            K::Symbol => Blue,
            K::Any => Blue,
            K::Object => Blue,
            K::Unknown => Blue,
            K::Never => Blue,
            K::Namespace => Blue,
            K::Declare => Blue,
            K::Readonly => Blue,
        }
    }
}

pub struct Keywords;
impl Keywords {
    pub fn get(s: &[u8]) -> Option<Keyword> {
        static KEYWORDS: phf::Map<&'static [u8], Keyword> = phf::phf_map! {
            b"abstract" => Keyword::Abstract,
            b"as" => Keyword::As,
            b"async" => Keyword::Async,
            b"await" => Keyword::Await,
            b"case" => Keyword::Case,
            b"catch" => Keyword::Catch,
            b"class" => Keyword::Class,
            b"const" => Keyword::Const,
            b"continue" => Keyword::Continue,
            b"debugger" => Keyword::Debugger,
            b"default" => Keyword::Default,
            b"delete" => Keyword::Delete,
            b"do" => Keyword::Do,
            b"else" => Keyword::Else,
            b"enum" => Keyword::Enum,
            b"export" => Keyword::Export,
            b"extends" => Keyword::Extends,
            b"false" => Keyword::False,
            b"finally" => Keyword::Finally,
            b"for" => Keyword::For,
            b"function" => Keyword::Function,
            b"if" => Keyword::If,
            b"implements" => Keyword::Implements,
            b"import" => Keyword::Import,
            b"in" => Keyword::In,
            b"instanceof" => Keyword::Instanceof,
            b"interface" => Keyword::Interface,
            b"let" => Keyword::Let,
            b"new" => Keyword::New,
            b"null" => Keyword::Null,
            b"package" => Keyword::Package,
            b"private" => Keyword::Private,
            b"protected" => Keyword::Protected,
            b"public" => Keyword::Public,
            b"return" => Keyword::Return,
            b"static" => Keyword::Static,
            b"super" => Keyword::Super,
            b"switch" => Keyword::Switch,
            b"this" => Keyword::This,
            b"throw" => Keyword::Throw,
            b"break" => Keyword::Break,
            b"true" => Keyword::True,
            b"try" => Keyword::Try,
            b"type" => Keyword::Type,
            b"typeof" => Keyword::Typeof,
            b"var" => Keyword::Var,
            b"void" => Keyword::Void,
            b"while" => Keyword::While,
            b"with" => Keyword::With,
            b"yield" => Keyword::Yield,
            b"string" => Keyword::String,
            b"number" => Keyword::Number,
            b"boolean" => Keyword::Boolean,
            b"symbol" => Keyword::Symbol,
            b"any" => Keyword::Any,
            b"object" => Keyword::Object,
            b"unknown" => Keyword::Unknown,
            b"never" => Keyword::Never,
            b"namespace" => Keyword::Namespace,
            b"declare" => Keyword::Declare,
            b"readonly" => Keyword::Readonly,
            b"undefined" => Keyword::Undefined,
        };
        KEYWORDS.get(s).copied()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RedactedKeyword {
    Auth,      // _auth
    AuthToken, // _authToken
    Token,     // token
    Password,  // _password
    Email,     // email
}

pub struct RedactedKeywords;
impl RedactedKeywords {
    // TODO(port): replace with phf::Map.
    pub fn has(s: &[u8]) -> bool {
        matches!(s, b"_auth" | b"_authToken" | b"token" | b"_password" | b"email")
    }
}

impl Display for QuickAndDirtyJavaScriptSyntaxHighlighter<'_> {
    fn fmt(&self, writer: &mut Formatter<'_>) -> fmt::Result {
        use crate::js_lexer;

        let mut text = self.text;
        if self.opts.check_for_unhighlighted_write {
            if !self.opts.enable_colors
                || text.len() > 2048
                || text.is_empty()
                || !strings::is_all_ascii(text)
            {
                if self.opts.redact_sensitive_information {
                    return write!(writer, "{}", redacted_source(text));
                } else {
                    return write_bytes(writer, text);
                }
            }
        }

        let mut prev_keyword: Option<Keyword> = None;
        let mut should_redact_value = false;

        'outer: while !text.is_empty() {
            if js_lexer::is_identifier_start(text[0] as i32) {
                let mut i: usize = 1;

                while i < text.len() && js_lexer::is_identifier_continue(text[i] as i32) {
                    i += 1;
                }

                if let Some(keyword) = Keywords::get(&text[..i]) {
                    should_redact_value = false;
                    if keyword != Keyword::As {
                        prev_keyword = Some(keyword);
                    }
                    let code = keyword.color_code();
                    write!(
                        writer,
                        // TODO(port): Output.prettyFmt("<r>{s}{s}<r>", true)
                        "{}{}{}{}",
                        Output::RESET,
                        code.color(),
                        bstr::BStr::new(&text[..i]),
                        Output::RESET,
                    )?;
                } else {
                    should_redact_value =
                        self.opts.redact_sensitive_information && RedactedKeywords::has(&text[..i]);
                    'write: {
                        if let Some(prev) = prev_keyword {
                            match prev {
                                Keyword::New => {
                                    prev_keyword = None;

                                    if i < text.len() && text[i] == b'(' {
                                        // TODO(port): Output.prettyFmt("<r><b>{s}<r>", true)
                                        write!(
                                            writer,
                                            "{}{}{}{}",
                                            Output::RESET,
                                            Output::BOLD,
                                            bstr::BStr::new(&text[..i]),
                                            Output::RESET,
                                        )?;
                                        break 'write;
                                    }
                                }
                                Keyword::Abstract
                                | Keyword::Namespace
                                | Keyword::Declare
                                | Keyword::Type
                                | Keyword::Interface => {
                                    // TODO(port): Output.prettyFmt("<r><b><blue>{s}<r>", true)
                                    write!(
                                        writer,
                                        "{}{}{}{}{}",
                                        Output::RESET,
                                        Output::BOLD,
                                        ColorCode::Blue.color(),
                                        bstr::BStr::new(&text[..i]),
                                        Output::RESET,
                                    )?;
                                    prev_keyword = None;
                                    break 'write;
                                }
                                Keyword::Import => {
                                    if &text[..i] == b"from" {
                                        let code = ColorCode::Magenta;
                                        write!(
                                            writer,
                                            "{}{}{}{}",
                                            Output::RESET,
                                            code.color(),
                                            bstr::BStr::new(&text[..i]),
                                            Output::RESET,
                                        )?;
                                        prev_keyword = None;
                                        break 'write;
                                    }
                                }
                                _ => {}
                            }
                        }

                        write_bytes(writer, &text[..i])?;
                    }
                }
                text = &text[i..];
            } else {
                if self.opts.redact_sensitive_information && should_redact_value {
                    while !text.is_empty() && text[0].is_ascii_whitespace() {
                        writer.write_char(text[0] as char)?;
                        text = &text[1..];
                    }

                    if !text.is_empty() && (text[0] == b'=' || text[0] == b':') {
                        writer.write_char(text[0] as char)?;
                        text = &text[1..];
                        while !text.is_empty() && text[0].is_ascii_whitespace() {
                            writer.write_char(text[0] as char)?;
                            text = &text[1..];
                        }

                        if text.is_empty() {
                            return Ok(());
                        }
                    }
                }

                match text[0] {
                    num @ b'0'..=b'9' => {
                        if self.opts.redact_sensitive_information {
                            if should_redact_value {
                                should_redact_value = false;
                                let end = strings::index_of_char(text, b'\n').unwrap_or(text.len());
                                text = &text[end..];
                                // TODO(port): Output.prettyFmt("<r><yellow>***<r>", true)
                                write!(writer, "{}\x1b[33m***{}", Output::RESET, Output::RESET)?;
                                continue;
                            }

                            if strings::starts_with_uuid(text) {
                                text = &text[36..];
                                write!(writer, "{}\x1b[33m***{}", Output::RESET, Output::RESET)?;
                                continue;
                            }
                        }

                        prev_keyword = None;
                        let mut i: usize = 1;
                        if text.len() > 1 && num == b'0' && text[1] == b'x' {
                            i += 1;
                            while i < text.len()
                                && matches!(text[i], b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F')
                            {
                                i += 1;
                            }
                        } else {
                            while i < text.len()
                                && matches!(
                                    text[i],
                                    b'0'..=b'9'
                                        | b'.'
                                        | b'e'
                                        | b'E'
                                        | b'x'
                                        | b'X'
                                        | b'b'
                                        | b'B'
                                        | b'o'
                                        | b'O'
                                )
                            {
                                i += 1;
                            }
                        }

                        // TODO(port): Output.prettyFmt("<r><yellow>{s}<r>", true)
                        write!(
                            writer,
                            "{}\x1b[33m{}{}",
                            Output::RESET,
                            bstr::BStr::new(&text[..i]),
                            Output::RESET,
                        )?;
                        text = &text[i..];
                    }
                    char_ @ (b'`' | b'"' | b'\'') => {
                        prev_keyword = None;

                        let mut i: usize = 1;
                        while i < text.len() && text[i] != char_ {
                            // if we're redacting, no need to syntax highlight contents
                            if !should_redact_value && char_ == b'`' {
                                if text[i] == b'$' && i + 1 < text.len() && text[i + 1] == b'{' {
                                    let curly_start = i;
                                    i += 2;

                                    while i < text.len() && text[i] != b'}' {
                                        if text[i] == b'\\' {
                                            i += 1;
                                        }
                                        i += 1;
                                    }

                                    // TODO(port): Output.prettyFmt("<r><green>{s}<r>", true)
                                    write!(
                                        writer,
                                        "{}\x1b[32m{}{}",
                                        Output::RESET,
                                        bstr::BStr::new(&text[..curly_start]),
                                        Output::RESET,
                                    )?;
                                    writer.write_str("${")?;
                                    let mut opts = self.opts;
                                    opts.check_for_unhighlighted_write = false;
                                    let curly_remain = QuickAndDirtyJavaScriptSyntaxHighlighter {
                                        text: &text[curly_start + 2..i],
                                        opts,
                                    };

                                    if !curly_remain.text.is_empty() {
                                        curly_remain.fmt(writer)?;
                                    }

                                    if i < text.len() && text[i] == b'}' {
                                        writer.write_str("}")?;
                                        i += 1;
                                    }
                                    text = &text[i..];
                                    i = 0;
                                    if !text.is_empty() && text[0] == char_ {
                                        // TODO(port): Output.prettyFmt("<r><green>`<r>", true)
                                        write!(writer, "{}\x1b[32m`{}", Output::RESET, Output::RESET)?;
                                        text = &text[1..];
                                        continue 'outer;
                                    }
                                    continue;
                                }
                            }

                            if i + 1 < text.len() && text[i] == b'\\' {
                                i += 1;
                            }

                            i += 1;
                        }

                        // Include the trailing quote, if any
                        i += (i < text.len()) as usize;

                        if should_redact_value {
                            should_redact_value = false;
                            if i > 2 && text[i - 1] == char_ {
                                let len = i - 2;
                                // TODO(port): Output.prettyFmt("<r><green>{c}", true)
                                write!(writer, "{}\x1b[32m{}", Output::RESET, char_ as char)?;
                                splat_byte_all(writer, b'*', len)?;
                                write!(writer, "{}{}", char_ as char, Output::RESET)?;
                            } else {
                                splat_byte_all(writer, b'*', i)?;
                            }
                            text = &text[i..];
                            continue;
                        } else if self.opts.redact_sensitive_information {
                            'try_redact: {
                                let mut inner = &text[1..i];
                                if !inner.is_empty() && inner[inner.len() - 1] == char_ {
                                    inner = &inner[..inner.len() - 1];
                                }

                                if inner.is_empty() {
                                    break 'try_redact;
                                }

                                if inner.len() == 36 && strings::is_uuid(inner) {
                                    write!(writer, "{}\x1b[32m{}", Output::RESET, char_ as char)?;
                                    splat_byte_all(writer, b'*', 36)?;
                                    write!(writer, "{}{}", char_ as char, Output::RESET)?;
                                    text = &text[i..];
                                    continue;
                                }

                                let npm_secret_len = strings::starts_with_npm_secret(inner);
                                if npm_secret_len != 0 {
                                    write!(writer, "{}\x1b[32m{}", Output::RESET, char_ as char)?;
                                    splat_byte_all(writer, b'*', npm_secret_len)?;
                                    write!(writer, "{}{}", char_ as char, Output::RESET)?;
                                    text = &text[i..];
                                    continue;
                                }

                                if let Some((offset, len)) = strings::find_url_password(inner) {
                                    write!(
                                        writer,
                                        "{}\x1b[32m{}{}",
                                        Output::RESET,
                                        char_ as char,
                                        bstr::BStr::new(&inner[..offset]),
                                    )?;
                                    splat_byte_all(writer, b'*', len)?;
                                    write!(
                                        writer,
                                        "{}{}{}",
                                        bstr::BStr::new(&inner[offset + len..]),
                                        char_ as char,
                                        Output::RESET,
                                    )?;
                                    text = &text[i..];
                                    continue;
                                }
                            }

                            write!(
                                writer,
                                "{}\x1b[32m{}{}",
                                Output::RESET,
                                bstr::BStr::new(&text[..i]),
                                Output::RESET,
                            )?;
                            text = &text[i..];
                            continue;
                        }

                        write!(
                            writer,
                            "{}\x1b[32m{}{}",
                            Output::RESET,
                            bstr::BStr::new(&text[..i]),
                            Output::RESET,
                        )?;
                        text = &text[i..];
                    }
                    b'/' => {
                        prev_keyword = None;

                        if should_redact_value {
                            should_redact_value = false;
                            let len = strings::index_of_char(text, b'\n').unwrap_or(text.len());
                            splat_byte_all(writer, b'*', len)?;
                            text = &text[len..];
                            continue;
                        }

                        let mut i: usize = 1;

                        // the start of a line comment
                        if i < text.len() && text[i] == b'/' {
                            while i < text.len() && text[i] != b'\n' {
                                i += 1;
                            }

                            let remain_to_print = &text[..i];
                            if i < text.len() && text[i] == b'\n' {
                                i += 1;
                            }

                            if i < text.len() && text[i] == b'\r' {
                                i += 1;
                            }

                            if self.opts.redact_sensitive_information {
                                // TODO(port): Output.prettyFmt("<r><d>{f}<r>", true)
                                write!(
                                    writer,
                                    "{}\x1b[2m{}{}",
                                    Output::RESET,
                                    redacted_source(remain_to_print),
                                    Output::RESET,
                                )?;
                            } else {
                                write!(
                                    writer,
                                    "{}\x1b[2m{}{}",
                                    Output::RESET,
                                    bstr::BStr::new(remain_to_print),
                                    Output::RESET,
                                )?;
                            }
                            text = &text[i..];
                            continue;
                        }

                        'as_multiline_comment: {
                            if i < text.len() && text[i] == b'*' {
                                i += 1;

                                while i + 2 < text.len() && &text[i..i + 2] != b"*/" {
                                    i += 1;
                                }

                                if i + 2 < text.len() && &text[i..i + 2] == b"*/" {
                                    i += 2;
                                } else {
                                    i = 1;
                                    break 'as_multiline_comment;
                                }

                                if self.opts.redact_sensitive_information {
                                    write!(
                                        writer,
                                        "{}\x1b[2m{}{}",
                                        Output::RESET,
                                        redacted_source(&text[..i]),
                                        Output::RESET,
                                    )?;
                                } else {
                                    write!(
                                        writer,
                                        "{}\x1b[2m{}{}",
                                        Output::RESET,
                                        bstr::BStr::new(&text[..i]),
                                        Output::RESET,
                                    )?;
                                }
                                text = &text[i..];
                                continue;
                            }
                        }

                        write_bytes(writer, &text[..i])?;
                        text = &text[i..];
                    }
                    brace @ (b'}' | b'{') => {
                        // support potentially highlighting "from" in an import statement
                        if prev_keyword.unwrap_or(Keyword::Continue) != Keyword::Import {
                            prev_keyword = None;
                        }

                        if should_redact_value {
                            should_redact_value = false;
                            let len = strings::index_of_char(text, b'\n').unwrap_or(text.len());
                            splat_byte_all(writer, b'*', len)?;
                            text = &text[len..];
                            continue;
                        }

                        writer.write_char(brace as char)?;
                        text = &text[1..];
                    }
                    bracket @ (b'[' | b']') => {
                        prev_keyword = None;
                        if should_redact_value {
                            should_redact_value = false;
                            let len = strings::index_of_char(text, b'\n').unwrap_or(text.len());
                            splat_byte_all(writer, b'*', len)?;
                            text = &text[len..];
                            continue;
                        }
                        writer.write_char(bracket as char)?;
                        text = &text[1..];
                    }
                    b';' => {
                        prev_keyword = None;
                        if should_redact_value {
                            should_redact_value = false;
                            let len = strings::index_of_char(text, b'\n').unwrap_or(text.len());
                            splat_byte_all(writer, b'*', len)?;
                            text = &text[len..];
                            continue;
                        }
                        // TODO(port): Output.prettyFmt("<r><d>;<r>", true)
                        write!(writer, "{}\x1b[2m;{}", Output::RESET, Output::RESET)?;
                        text = &text[1..];
                    }
                    b'.' => {
                        prev_keyword = None;

                        if should_redact_value {
                            should_redact_value = false;
                            let len = strings::index_of_char(text, b'\n').unwrap_or(text.len());
                            splat_byte_all(writer, b'*', len)?;
                            text = &text[len..];
                            continue;
                        }

                        let mut i: usize = 1;
                        if text.len() > 1
                            && (js_lexer::is_identifier_start(text[1] as i32) || text[1] == b'#')
                        {
                            i = 2;

                            while i < text.len() && js_lexer::is_identifier_continue(text[i] as i32) {
                                i += 1;
                            }

                            if i < text.len() && text[i] == b'(' {
                                // TODO(port): Output.prettyFmt("<r><i><b>{s}<r>", true)
                                write!(
                                    writer,
                                    "{}\x1b[3m{}{}{}",
                                    Output::RESET,
                                    Output::BOLD,
                                    bstr::BStr::new(&text[..i]),
                                    Output::RESET,
                                )?;
                                text = &text[i..];
                                continue;
                            }
                            i = 1;
                        }
                        let _ = i;

                        writer.write_char(text[0] as char)?;
                        text = &text[1..];
                    }
                    b'<' => {
                        if should_redact_value {
                            should_redact_value = false;
                            let len = strings::index_of_char(text, b'\n').unwrap_or(text.len());
                            splat_byte_all(writer, b'*', len)?;
                            text = &text[len..];
                            continue;
                        }
                        let mut i: usize = 1;

                        // JSX
                        'jsx: {
                            if text.len() > 1 && text[0] == b'/' {
                                i = 2;
                            }
                            prev_keyword = None;

                            // Zig `while (cond) { i += 1 } else { i = 1; break :jsx; }` — Zig's
                            // while-else runs the else branch whenever the condition becomes false
                            // (i.e. on normal loop exit, since the body has no `break`). So the
                            // else ALWAYS fires here and the code below is dead in Zig too.
                            // TODO(port): Zig while-else always fires here — likely upstream bug, verify in Phase B.
                            while i < text.len() && js_lexer::is_identifier_continue(text[i] as i32) {
                                i += 1;
                            }
                            i = 1;
                            break 'jsx;

                            #[allow(unreachable_code)]
                            while i < text.len() && text[i] != b'>' {
                                i += 1;

                                if i < text.len() && text[i] == b'<' {
                                    i = 1;
                                    break 'jsx;
                                }
                            }

                            if i < text.len() && text[i] == b'>' {
                                i += 1;
                                // TODO(port): Output.prettyFmt("<r><cyan>{s}<r>", true)
                                write!(
                                    writer,
                                    "{}\x1b[36m{}{}",
                                    Output::RESET,
                                    bstr::BStr::new(&text[..i]),
                                    Output::RESET,
                                )?;
                                text = &text[i..];
                                continue;
                            }

                            i = 1;
                        }

                        write!(
                            writer,
                            "{}{}{}",
                            Output::RESET,
                            bstr::BStr::new(&text[..i]),
                            Output::RESET,
                        )?;
                        text = &text[i..];
                    }
                    c => {
                        if should_redact_value {
                            should_redact_value = false;
                            let len = strings::index_of_char(text, b'\n').unwrap_or(text.len());
                            splat_byte_all(writer, b'*', len)?;
                            text = &text[len..];
                            continue;
                        }
                        writer.write_char(c as char)?;
                        text = &text[1..];
                    }
                }
            }
        }
        Ok(())
    }
}

pub fn quote(self_: &[u8]) -> QuotedFormatter<'_> {
    QuotedFormatter { text: self_ }
}

// ───────────────────────────────────────────────────────────────────────────
// EnumTagListFormatter
// ───────────────────────────────────────────────────────────────────────────

// B-1: ConstParamTy is nightly. Use as runtime value instead.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EnumTagListSeparator {
    List,
    Dash,
}

// TODO(port): Zig builds the output string at comptime via `std.meta.fieldNames(Enum)`.
// Rust has no struct-field reflection. Phase B: require `Enum: strum::VariantNames` and
// build the string in a `LazyLock<&'static str>` (or generate via `const_format` if a
// const iterator over variant names becomes available).
pub struct EnumTagListFormatter<E: strum::VariantNames, const SEPARATOR: EnumTagListSeparator> {
    pub pretty: bool,
    _marker: core::marker::PhantomData<E>,
}

impl<E: strum::VariantNames, const SEPARATOR: EnumTagListSeparator> Display
    for EnumTagListFormatter<E, SEPARATOR>
{
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        // PERF(port): Zig computed this at comptime as a single &'static str.
        let names = E::VARIANTS;
        for (i, name) in names.iter().enumerate() {
            match SEPARATOR {
                EnumTagListSeparator::List => {
                    if i > 0 {
                        if i + 1 == names.len() {
                            f.write_str(", or ")?;
                        } else {
                            f.write_str(", ")?;
                        }
                    }
                    write!(f, "\"{}\"", name)?;
                }
                EnumTagListSeparator::Dash => {
                    write!(f, "\n-  {}", name)?;
                }
            }
        }
        Ok(())
    }
}

pub fn enum_tag_list<E: strum::VariantNames, const SEPARATOR: EnumTagListSeparator>(
) -> EnumTagListFormatter<E, SEPARATOR> {
    EnumTagListFormatter { pretty: true, _marker: core::marker::PhantomData }
}

// ───────────────────────────────────────────────────────────────────────────
// formatIp
// ───────────────────────────────────────────────────────────────────────────

// TODO(port): `std.net.Address` — bun_core stays I/O-free; Phase B should accept a
// bun_sys/bun_net Address type here. Logic preserved against a placeholder Display.
pub fn format_ip(address: &impl Display, into: &mut [u8]) -> Result<&mut [u8], crate::Error> {
    // std.net.Address.format includes `:<port>` and square brackets (IPv6)
    //  while Node does neither.  This uses format then strips these to bring
    //  the result into conformance with Node.
    use std::io::Write;
    let mut cursor = std::io::Cursor::new(&mut into[..]);
    write!(cursor, "{}", address).map_err(|_| crate::err!("NoSpaceLeft"))?;
    let written = cursor.position() as usize;
    let mut result = &mut into[..written];

    // Strip `:<port>`
    if let Some(colon) = result.iter().rposition(|&b| b == b':') {
        result = &mut result[..colon];
    }
    // Strip brackets
    if !result.is_empty() && result[0] == b'[' && result[result.len() - 1] == b']' {
        let len = result.len();
        result = &mut result[1..len - 1];
    }
    // PORT NOTE: reshaped for borrowck — recompute slice from `into` to satisfy lifetimes.
    // TODO(port): narrow error set
    let _ = result;
    todo!("// TODO(port): return mutable subslice of `into`; reborrow plumbing for Phase B")
}

// ───────────────────────────────────────────────────────────────────────────
// fastDigitCount
// https://lemire.me/blog/2021/06/03/computing-the-number-of-digits-of-an-integer-even-faster/
// ───────────────────────────────────────────────────────────────────────────

pub fn fast_digit_count(x: u64) -> u64 {
    if x == 0 {
        return 1;
    }

    const TABLE: [u64; 32] = [
        4294967296,
        8589934582,
        8589934582,
        8589934582,
        12884901788,
        12884901788,
        12884901788,
        17179868184,
        17179868184,
        17179868184,
        21474826480,
        21474826480,
        21474826480,
        21474826480,
        25769703776,
        25769703776,
        25769703776,
        30063771072,
        30063771072,
        30063771072,
        34349738368,
        34349738368,
        34349738368,
        34349738368,
        38554705664,
        38554705664,
        38554705664,
        41949672960,
        41949672960,
        41949672960,
        42949672960,
        42949672960,
    ];
    // std.math.log2(x) for nonzero x == 63 - leading_zeros
    let log2 = 63 - x.leading_zeros() as usize;
    (x + TABLE[log2]) >> 32
}

// ───────────────────────────────────────────────────────────────────────────
// SizeFormatter
// ───────────────────────────────────────────────────────────────────────────

pub struct SizeFormatter {
    pub value: usize,
    pub opts: SizeFormatterOptions,
}

#[derive(Clone, Copy)]
pub struct SizeFormatterOptions {
    pub space_between_number_and_unit: bool,
}

impl Default for SizeFormatterOptions {
    fn default() -> Self {
        Self { space_between_number_and_unit: true }
    }
}

impl Display for SizeFormatter {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let value = self.value;
        if value == 0 {
            return if self.opts.space_between_number_and_unit {
                f.write_str("0 KB")
            } else {
                f.write_str("0KB")
            };
        }

        if value < 512 {
            write!(f, "{}", self.value)?;
            return if self.opts.space_between_number_and_unit {
                f.write_str(" bytes")
            } else {
                f.write_char('B')
            };
        }

        const MAGS_SI: &[u8] = b" KMGTPEZY";
        let log2 = (usize::BITS - 1 - value.leading_zeros()) as usize;
        // comptime math.log2(1000) == 9 (integer log2)
        let magnitude = (log2 / 9).min(MAGS_SI.len() - 1);
        let new_value = value as f64 / 1000f64.powf(magnitude as f64);
        let suffix = MAGS_SI[magnitude];

        if suffix == b' ' {
            if self.opts.space_between_number_and_unit {
                write!(f, "{:.2} KB", new_value / 1000.0)?;
            } else {
                write!(f, "{:.2}KB", new_value / 1000.0)?;
            }
            return Ok(());
        }
        let precision: usize =
            if (new_value - new_value.trunc()).abs() < 0.100 { 1 } else { 2 };
        write!(f, "{:.1$}", new_value, precision)?;
        if self.opts.space_between_number_and_unit {
            write!(f, " {}B", suffix as char)
        } else {
            write!(f, "{}B", suffix as char)
        }
    }
}

// TODO(port): Zig `size(bytes: anytype, ...)` switched on @TypeOf(bytes) for
// f64/f32/f128 (intFromFloat) and i64/isize (intCast). Expose typed helpers.
pub fn size(bytes: usize, opts: SizeFormatterOptions) -> SizeFormatter {
    SizeFormatter { value: bytes, opts }
}
pub fn size_f64(bytes: f64, opts: SizeFormatterOptions) -> SizeFormatter {
    SizeFormatter { value: bytes as usize, opts }
}
pub fn size_i64(bytes: i64, opts: SizeFormatterOptions) -> SizeFormatter {
    SizeFormatter { value: usize::try_from(bytes).unwrap(), opts }
}

// ───────────────────────────────────────────────────────────────────────────
// Hex formatters
// ───────────────────────────────────────────────────────────────────────────

const LOWER_HEX_TABLE: [u8; 16] =
    [b'0', b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'a', b'b', b'c', b'd', b'e', b'f'];
const UPPER_HEX_TABLE: [u8; 16] =
    [b'0', b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'A', b'B', b'C', b'D', b'E', b'F'];

// TODO(port): Zig parameterizes on `comptime Int: type` and computes
// `BufType = [@bitSizeOf(Int) / 4]u8`. Rust const generics can't derive an array
// length from a type's bit-width. Represent as a generic over u64 with explicit
// nibble count; Phase B can add per-width helpers if hot.
pub struct HexIntFormatter<const LOWER: bool, const NIBBLES: usize> {
    pub value: u64,
}

impl<const LOWER: bool, const NIBBLES: usize> HexIntFormatter<LOWER, NIBBLES> {
    fn get_out_buf(value: u64) -> [u8; NIBBLES] {
        let table = if LOWER { &LOWER_HEX_TABLE } else { &UPPER_HEX_TABLE };
        let mut buf = [0u8; NIBBLES];
        // PERF(port): Zig used `inline for`; plain loop here.
        for (i, c) in buf.iter_mut().enumerate() {
            // value relative to the current nibble
            let shift = ((NIBBLES - i - 1) * 4) as u32;
            *c = table[((value >> shift) as u8 & 0xF) as usize];
        }
        buf
    }
}

impl<const LOWER: bool, const NIBBLES: usize> Display for HexIntFormatter<LOWER, NIBBLES> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let buf = Self::get_out_buf(self.value);
        write_bytes(f, &buf)
    }
}

pub fn hex_int<const LOWER: bool, const NIBBLES: usize>(
    value: u64,
) -> HexIntFormatter<LOWER, NIBBLES> {
    HexIntFormatter { value }
}

pub fn hex_int_lower<const NIBBLES: usize>(value: u64) -> HexIntFormatter<true, NIBBLES> {
    HexIntFormatter { value }
}

pub fn hex_int_upper<const NIBBLES: usize>(value: u64) -> HexIntFormatter<false, NIBBLES> {
    HexIntFormatter { value }
}

// ───────────────────────────────────────────────────────────────────────────
// TrimmedPrecisionFormatter
// ───────────────────────────────────────────────────────────────────────────

/// Equivalent to `{d:.<precision>}` but trims trailing zeros
/// if decimal part is less than `precision` digits.
pub struct TrimmedPrecisionFormatter<const PRECISION: usize> {
    pub num: f64,
    pub precision: usize,
}

impl<const PRECISION: usize> Display for TrimmedPrecisionFormatter<PRECISION> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let whole = self.num.trunc();
        write!(f, "{}", whole)?;
        let rem = self.num - whole;
        if rem != 0.0 {
            // buf size = "0." + PRECISION digits
            // TODO(port): Zig used `[2 + precision]u8` stack array; Rust const-generic array
            // length arithmetic is unstable, so use a small fixed upper bound.
            let mut buf = [0u8; 32];
            use std::io::Write;
            let mut cursor = std::io::Cursor::new(&mut buf[..]);
            write!(cursor, "{:.1$}", rem, PRECISION).expect("unreachable");
            let written = cursor.position() as usize;
            let formatted = &buf[2..written];
            let trimmed = strings::trim_right(formatted, b"0");
            write!(f, ".{}", bstr::BStr::new(trimmed))?;
        }
        Ok(())
    }
}

pub fn trimmed_precision<const PRECISION: usize>(value: f64) -> TrimmedPrecisionFormatter<PRECISION> {
    TrimmedPrecisionFormatter { num: value, precision: PRECISION }
}

// ───────────────────────────────────────────────────────────────────────────
// Duration formatting
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
struct FormatDurationData {
    ns: u64,
    negative: bool,
}

impl Default for FormatDurationData {
    fn default() -> Self {
        Self { ns: 0, negative: false }
    }
}

const NS_PER_US: u64 = 1_000;
const NS_PER_MS: u64 = 1_000_000;
const NS_PER_S: u64 = 1_000_000_000;
const NS_PER_MIN: u64 = 60 * NS_PER_S;
const NS_PER_HOUR: u64 = 60 * NS_PER_MIN;
const NS_PER_DAY: u64 = 24 * NS_PER_HOUR;
const NS_PER_WEEK: u64 = 7 * NS_PER_DAY;

/// This is copied from std.fmt.formatDuration, except it will only print one decimal instead of three
fn format_duration_one_decimal(data: FormatDurationData, writer: &mut impl fmt::Write) -> fmt::Result {
    // worst case: "-XXXyXXwXXdXXhXXmXX.XXXs".len = 24
    let mut buf = [0u8; 24];
    let mut pos: usize = 0;
    macro_rules! push_str {
        ($s:expr) => {{
            let s: &[u8] = $s;
            buf[pos..pos + s.len()].copy_from_slice(s);
            pos += s.len();
        }};
    }
    macro_rules! push_fmt {
        ($($arg:tt)*) => {{
            use std::io::Write;
            let mut cursor = std::io::Cursor::new(&mut buf[pos..]);
            write!(cursor, $($arg)*).expect("unreachable");
            pos += cursor.position() as usize;
        }};
    }

    if data.negative {
        push_str!(b"-");
    }

    let mut ns_remaining = data.ns;
    // PERF(port): Zig used `inline for` over a tuple of structs.
    const COARSE: [(u64, u8); 5] = [
        (365 * NS_PER_DAY, b'y'),
        (NS_PER_WEEK, b'w'),
        (NS_PER_DAY, b'd'),
        (NS_PER_HOUR, b'h'),
        (NS_PER_MIN, b'm'),
    ];
    for &(unit_ns, sep) in COARSE.iter() {
        if ns_remaining >= unit_ns {
            let units = ns_remaining / unit_ns;
            push_fmt!("{}", units);
            push_str!(&[sep]);
            ns_remaining -= units * unit_ns;
            if ns_remaining == 0 {
                return write_bytes(writer, &buf[..pos]);
            }
        }
    }

    const FINE: [(u64, &[u8]); 3] = [
        (NS_PER_S, b"s"),
        (NS_PER_MS, b"ms"),
        (NS_PER_US, b"us"),
    ];
    for &(unit_ns, sep) in FINE.iter() {
        let kunits = ns_remaining * 1000 / unit_ns;
        if kunits >= 1000 {
            push_fmt!("{}", kunits / 1000);
            let frac = (kunits % 1000) / 100;
            if frac > 0 {
                let decimal_buf = [b'.', b'0' + u8::try_from(frac).unwrap()];
                push_str!(&decimal_buf);
            }
            push_str!(sep);
            return write_bytes(writer, &buf[..pos]);
        }
    }

    push_fmt!("{}", ns_remaining);
    push_str!(b"ns");
    write_bytes(writer, &buf[..pos])
}

/// Return a Formatter for number of nanoseconds according to its magnitude:
/// [#y][#w][#d][#h][#m]#[.###][n|u|m]s
pub struct DurationOneDecimal(FormatDurationData);

impl Display for DurationOneDecimal {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        format_duration_one_decimal(self.0, f)
    }
}

pub fn fmt_duration_one_decimal(ns: u64) -> DurationOneDecimal {
    DurationOneDecimal(FormatDurationData { ns, negative: false })
}

// ───────────────────────────────────────────────────────────────────────────
// FormatSlice
// ───────────────────────────────────────────────────────────────────────────

pub fn fmt_slice<'a, T: AsRef<[u8]>>(
    data: &'a [T],
    delim: &'static str,
) -> FormatSlice<'a, T> {
    FormatSlice { slice: data, delim }
}

pub struct FormatSlice<'a, T: AsRef<[u8]>> {
    pub slice: &'a [T],
    // PERF(port): Zig `delim` was a comptime []const u8 — runtime here.
    pub delim: &'static str,
}

impl<T: AsRef<[u8]>> Display for FormatSlice<'_, T> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        if self.slice.is_empty() {
            return Ok(());
        }
        write_bytes(f, self.slice[0].as_ref())?;
        for item in &self.slice[1..] {
            if !self.delim.is_empty() {
                f.write_str(self.delim)?;
            }
            write_bytes(f, item.as_ref())?;
        }
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// FormatDouble — Uses WebKit's double formatter
// ───────────────────────────────────────────────────────────────────────────

/// Uses WebKit's double formatter
pub fn double(number: f64) -> FormatDouble {
    FormatDouble { number }
}

pub struct FormatDouble {
    pub number: f64,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn WTF__dtoa(buf: *mut u8, number: f64) -> usize;
}

impl FormatDouble {
    pub fn dtoa(buf: &mut [u8; 124], number: f64) -> &[u8] {
        // SAFETY: WTF__dtoa writes at most 124 bytes into buf and returns the length written.
        let len = unsafe { WTF__dtoa(buf.as_mut_ptr(), number) };
        &buf[..len]
    }

    pub fn dtoa_with_negative_zero(buf: &mut [u8; 124], number: f64) -> &[u8] {
        if number == 0.0 && number.is_sign_negative() {
            return b"-0";
        }
        // SAFETY: see dtoa.
        let len = unsafe { WTF__dtoa(buf.as_mut_ptr(), number) };
        &buf[..len]
    }
}

impl Display for FormatDouble {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let mut buf = [0u8; 124];
        let slice = Self::dtoa(&mut buf, self.number);
        write_bytes(f, slice)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// NullableFallback
// ───────────────────────────────────────────────────────────────────────────

pub fn nullable_fallback<T: Display>(value: Option<T>, null_fallback: &[u8]) -> NullableFallback<'_, T> {
    NullableFallback { value, null_fallback }
}

pub struct NullableFallback<'a, T: Display> {
    pub value: Option<T>,
    pub null_fallback: &'a [u8],
}

impl<T: Display> Display for NullableFallback<'_, T> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        if let Some(value) = &self.value {
            write!(f, "{}", value)
        } else {
            write_bytes(f, self.null_fallback)
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// escapePowershell
// ───────────────────────────────────────────────────────────────────────────

pub struct EscapePowershell<'a>(pub &'a [u8]);

pub fn escape_powershell(str: &[u8]) -> EscapePowershell<'_> {
    EscapePowershell(str)
}

impl Display for EscapePowershell<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        escape_powershell_impl(self.0, f)
    }
}

fn escape_powershell_impl(str: &[u8], writer: &mut impl fmt::Write) -> fmt::Result {
    let mut remain = str;
    while let Some(i) = strings::index_of_any(remain, b"\"`") {
        write_bytes(writer, &remain[..i])?;
        writer.write_str("`")?;
        writer.write_char(remain[i] as char)?;
        remain = &remain[i + 1..];
    }
    write_bytes(writer, remain)
}

// js_bindings (fmtString for highlighter.test.ts) lives in src/jsc/fmt_jsc.zig
// alongside fmt_jsc.bind.ts; bun_core/ stays JSC-free.

// ───────────────────────────────────────────────────────────────────────────
// OutOfRangeFormatter — Equivalent to ERR_OUT_OF_RANGE
// ───────────────────────────────────────────────────────────────────────────

// TODO(port): Zig `NewOutOfRangeFormatter(comptime T: type)` branches on `@typeName(T)`
// and `std.meta.hasFn(T, "format")` for the "Received" tail. The `@typeName(T)` fallback
// path is debug-only (Zig panics if field_name unset in debug). Represent as a trait so
// each `T` controls how it prints "Received <value>".
pub trait OutOfRangeValue {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result;
    fn type_name() -> &'static str;
}

impl OutOfRangeValue for f64 {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, " Received {}", double(*self))
    }
    fn type_name() -> &'static str { "f64" }
}
impl OutOfRangeValue for i64 {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, " Received {}", self)
    }
    fn type_name() -> &'static str { "i64" }
}
impl<'a> OutOfRangeValue for &'a [u8] {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, " Received {}", bstr::BStr::new(self))
    }
    fn type_name() -> &'static str { "[]const u8" }
}
// MOVE_DOWN: bun_str::String → bun_alloc (T0). Re-import from there.
impl OutOfRangeValue for bun_alloc::String {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, " Received {}", self)
    }
    fn type_name() -> &'static str { "bun.String" }
}

pub struct NewOutOfRangeFormatter<'a, T: OutOfRangeValue> {
    pub value: T,
    pub min: i64,
    pub max: i64,
    pub field_name: &'a [u8],
    pub msg: &'a [u8],
}

impl<T: OutOfRangeValue> Display for NewOutOfRangeFormatter<'_, T> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        if !self.field_name.is_empty() {
            f.write_str("The value of \"")?;
            write_bytes(f, self.field_name)?;
            f.write_str("\" is out of range. It must be ")?;
        } else {
            if cfg!(debug_assertions) {
                panic!("Set field_name plz");
            }
            f.write_str("The value is out of range. It must be ")?;
        }

        let min = self.min;
        let max = self.max;
        let msg = self.msg;

        if min != i64::MAX && max != i64::MAX {
            write!(f, ">= {} and <= {}.", min, max)?;
        } else if min != i64::MAX {
            write!(f, ">= {}.", min)?;
        } else if max != i64::MAX {
            write!(f, "<= {}.", max)?;
        } else if !msg.is_empty() {
            write_bytes(f, msg)?;
            f.write_char('.')?;
        } else {
            f.write_str("within the range of values for type ")?;
            f.write_str(T::type_name())?;
            f.write_str(".")?;
        }

        self.value.write_received(f)
    }
}

pub type DoubleOutOfRangeFormatter<'a> = NewOutOfRangeFormatter<'a, f64>;
pub type IntOutOfRangeFormatter<'a> = NewOutOfRangeFormatter<'a, i64>;
pub type StringOutOfRangeFormatter<'a> = NewOutOfRangeFormatter<'a, &'a [u8]>;
pub type BunStringOutOfRangeFormatter<'a> = NewOutOfRangeFormatter<'a, bun_alloc::String>;

pub struct OutOfRangeOptions<'a> {
    pub min: i64,
    pub max: i64,
    pub field_name: &'a [u8],
    pub msg: &'a [u8],
}

impl Default for OutOfRangeOptions<'_> {
    fn default() -> Self {
        Self { min: i64::MAX, max: i64::MAX, field_name: b"", msg: b"" }
    }
}

pub fn out_of_range<T: OutOfRangeValue>(
    value: T,
    options: OutOfRangeOptions<'_>,
) -> NewOutOfRangeFormatter<'_, T> {
    NewOutOfRangeFormatter {
        value,
        min: options.min,
        max: options.max,
        field_name: options.field_name,
        msg: options.msg,
    }
}

// ───────────────────────────────────────────────────────────────────────────
// truncatedHash32
// ───────────────────────────────────────────────────────────────────────────

/// esbuild has an 8 character truncation of a base32 encoded bytes. this
/// is not exactly that, but it will appear as such. the character list
/// chosen omits similar characters in the unlikely case someone is
/// trying to memorize a hash.
///
/// this hash is used primarily for the hashes in bundler chunk file names. the
/// output is all lowercase to avoid issues with case-insensitive filesystems.
pub struct TruncatedHash32(pub u64);

pub fn truncated_hash32(int: u64) -> TruncatedHash32 {
    TruncatedHash32(int)
}

impl Display for TruncatedHash32 {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        truncated_hash32_impl(self.0, f)
    }
}

fn truncated_hash32_impl(int: u64, writer: &mut impl fmt::Write) -> fmt::Result {
    let in_bytes = int.to_ne_bytes();
    const CHARS: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";
    let out = [
        CHARS[(in_bytes[0] & 31) as usize],
        CHARS[(in_bytes[1] & 31) as usize],
        CHARS[(in_bytes[2] & 31) as usize],
        CHARS[(in_bytes[3] & 31) as usize],
        CHARS[(in_bytes[4] & 31) as usize],
        CHARS[(in_bytes[5] & 31) as usize],
        CHARS[(in_bytes[6] & 31) as usize],
        CHARS[(in_bytes[7] & 31) as usize],
    ];
    write_bytes(writer, &out)
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

#[inline]
fn write_bytes(w: &mut impl fmt::Write, bytes: &[u8]) -> fmt::Result {
    // Data is bytes, not str — route through bstr::BStr Display.
    write!(w, "{}", bstr::BStr::new(bytes))
}

#[inline]
fn splat_byte_all(w: &mut impl fmt::Write, byte: u8, count: usize) -> fmt::Result {
    // Mirrors std.Io.Writer.splatByteAll.
    for _ in 0..count {
        w.write_char(byte as char)?;
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/fmt.zig (1851 lines)
//   confidence: medium
//   todos:      27
//   notes:      Output.prettyFmt comptime-format-string expansion stubbed with raw ANSI; format_ip needs Address type + reborrow plumbing; JSX while-else in highlighter matches Zig's (likely buggy) always-break behavior.
// ──────────────────────────────────────────────────────────────────────────
