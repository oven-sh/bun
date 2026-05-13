//! Port of src/bun_core/fmt.zig — formatter newtypes and Display impls.

use core::cell::Cell;
use core::fmt::{self, Display, Formatter, Write as _};
use core::ptr::NonNull;

use crate::output as Output;
// `strings` is the canonical `crate::strings` (lib.rs); `js_printer`/`js_lexer`
// are defined locally below (move-in subset) and re-exported at the crate root.
use crate::strings;

/// SHA-512 digest length in bytes. Local constant to avoid bun_sha (T2) dependency.
const SHA512_DIGEST: usize = 64;

// ════════════════════════════════════════════════════════════════════════════
// js_lexer / js_printer minimal subsets.
// Only the free functions fmt.rs/output.rs actually call. The full modules
// (codepoint tables, JSON printer) stay in bun_str / bun_js_parser which add
// `pub use bun_core::strings::*` and extend with the heavy bits.
// ════════════════════════════════════════════════════════════════════════════

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
    use super::strings::Encoding;
    use core::fmt;
    use core::fmt::Write as _;
    /// Zig: js_printer.writeJSONString — minimal escape set for fmt.rs quoting.
    /// bun_js_printer overrides with the full (ctrl-char, \u escape, encoding-aware) impl.
    pub fn write_json_string(input: &[u8], f: &mut impl fmt::Write, enc: Encoding) -> fmt::Result {
        f.write_char('"')?;
        match enc {
            Encoding::Latin1 => super::encode_json_string_chars_latin1(f, input)?,
            _ => super::encode_json_string_chars(f, input)?,
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
        // TODO(port): full impl in bun_js_printer; this tier only needs the
        // "already quoted" passthrough for fmt.rs JS-string display.
        // Zig writePreQuotedString writes the escaped body WITHOUT surrounding
        // quotes — delegate to the canonical chars-only escaper.
        let _ = quote;
        match enc {
            Encoding::Latin1 => super::encode_json_string_chars_latin1(f, input),
            _ => super::encode_json_string_chars(f, input),
        }
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
    pub const UNICODE: TableSymbols = TableSymbols {
        enable_ansi_colors: true,
    };
    pub const ASCII: TableSymbols = TableSymbols {
        enable_ansi_colors: false,
    };

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
    const SYMBOLS: TableSymbols = TableSymbols {
        enable_ansi_colors: C,
    };

    pub fn init(
        column_names: &'a [&'a [u8]],
        column_inside_lengths: &'a [usize],
        column_color: &'static str,
    ) -> Self {
        Self {
            column_names,
            column_inside_lengths,
            column_color,
        }
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

            // Emit the run of bytes up to the next position where a uuid/npm
            // secret could possibly start, so multi-byte UTF-8 sequences are
            // written intact (Zig writes raw bytes, not Latin-1→UTF-8 chars).
            let mut next = i + 1;
            while next < self.url.len() {
                let b = self.url[next];
                if b.is_ascii_hexdigit() || b == b'n' || b == b'N' {
                    break;
                }
                next += 1;
            }
            write_bytes(f, &self.url[i..next])?;
            i = next;
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

            // Batch the non-secret span so multi-byte UTF-8 sequences pass
            // through intact (Zig writes raw bytes; per-byte `as char` would
            // re-encode each >=0x80 byte as a 2-byte sequence).
            let mut next = i + 1;
            while next < self.text.len()
                && strings::starts_with_secret(&self.text[next..]).is_none()
            {
                next += 1;
            }
            write_bytes(f, &self.text[i..next])?;
            i = next;
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
        while let Some(slash) = crate::strings_impl::index_of_char(remain, b'/') {
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

// adt_const_params (enum const-generic) is nightly. Stable rewrite: const bool.
pub const INTEGRITY_SHORT: bool = true;
pub const INTEGRITY_FULL: bool = false;
#[doc(hidden)]
#[derive(PartialEq, Eq, Clone, Copy)]
pub enum IntegrityFormatStyle {
    Short,
    Full,
} // kept for callers that name the enum

pub struct IntegrityFormatter<const SHORT: bool> {
    pub bytes: [u8; SHA512_DIGEST],
}

impl<const SHORT: bool> Display for IntegrityFormatter<SHORT> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        const BUF_LEN: usize = (SHA512_DIGEST + 2) / 3 * 4;
        let mut buf = [0u8; BUF_LEN];
        let count =
            bun_simdutf_sys::simdutf::base64::encode(&self.bytes[..SHA512_DIGEST], &mut buf, false);
        let encoded = &buf[..count];
        if SHORT {
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

pub fn integrity<const SHORT: bool>(bytes: [u8; SHA512_DIGEST]) -> IntegrityFormatter<SHORT> {
    IntegrityFormatter { bytes }
}

// ───────────────────────────────────────────────────────────────────────────
// JSON formatters
// ───────────────────────────────────────────────────────────────────────────

pub struct JSONFormatter<'a> {
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
            js_printer::write_pre_quoted_string(self.input, f, b'"', false, strings::Encoding::Utf8)
        }
    }
}

/// Expects latin1
pub fn format_json_string_latin1(text: &[u8]) -> JSONFormatter<'_> {
    JSONFormatter { input: text }
}

pub fn format_json_string_utf8(
    text: &[u8],
    opts: JSONFormatterUTF8Options,
) -> JSONFormatterUTF8<'_> {
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

/// RAII borrow of the thread-local shared temp buffer.
///
/// On construction: takes (or allocates) the buffer and nulls the thread-local
/// cell so any recursive borrow allocates a fresh one instead of aliasing this
/// one. On drop: restores the buffer to the cell, or frees it if recursion has
/// already restored a different buffer (mirrors fmt.zig's `defer` block).
struct SharedTempBufferBorrow {
    ptr: NonNull<SharedTempBuffer>,
}

impl SharedTempBufferBorrow {
    fn new() -> Self {
        let ptr = SHARED_TEMP_BUFFER_PTR.with(|cell| {
            cell.take()
                .unwrap_or_else(|| crate::heap::alloc_nn([0u8; 32 * 1024]))
        });
        Self { ptr }
    }

    #[inline]
    fn chunk(&mut self) -> &mut SharedTempBuffer {
        // SAFETY: this borrow uniquely owns the buffer for its lifetime; the
        // thread-local cell was nulled on construction so recursion cannot alias it.
        unsafe { self.ptr.as_mut() }
    }
}

impl Drop for SharedTempBufferBorrow {
    fn drop(&mut self) {
        SHARED_TEMP_BUFFER_PTR.with(|c| {
            if let Some(existing) = c.get() {
                if existing != self.ptr {
                    // Recursion restored a different buffer; free ours.
                    // SAFETY: ptr was allocated via heap::alloc_nn and is uniquely owned by self.
                    unsafe { crate::heap::destroy(self.ptr.as_ptr()) };
                }
            } else {
                c.set(Some(self.ptr));
            }
        });
    }
}

// ───────────────────────────────────────────────────────────────────────────
// UTF-16 formatting
// ───────────────────────────────────────────────────────────────────────────

pub fn format_utf16_type(slice_: &[u16], writer: &mut impl fmt::Write) -> fmt::Result {
    let mut borrow = SharedTempBufferBorrow::new();
    let chunk = borrow.chunk();

    let mut slice = slice_;

    while !slice.is_empty() {
        let result = strings::copy_utf16_into_utf8(chunk, slice);
        if result.read == 0 || result.written == 0 {
            break;
        }
        write_bytes(writer, &chunk[..result.written as usize])?;
        slice = &slice[result.read as usize..];
    }
    Ok(())
}

pub fn format_utf16_type_with_path_options(
    slice_: &[u16],
    writer: &mut impl fmt::Write,
    opts: PathFormatOptions,
) -> fmt::Result {
    let mut borrow = SharedTempBufferBorrow::new();
    let chunk = borrow.chunk();

    let mut slice = slice_;

    while !slice.is_empty() {
        let result = strings::copy_utf16_into_utf8(chunk, slice);
        if result.read == 0 || result.written == 0 {
            break;
        }

        let to_write = &chunk[..result.written as usize];
        if !opts.escape_backslashes && opts.path_sep == PathSep::Any {
            write_bytes(writer, to_write)?;
        } else {
            let mut ptr = to_write;
            while let Some(i) = crate::strings_impl::index_of_any(ptr, b"\\/") {
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
        slice = &slice[result.read as usize..];
    }
    Ok(())
}

#[inline]
pub fn utf16(slice_: &[u16]) -> FormatUTF16<'_> {
    FormatUTF16 {
        buf: slice_,
        path_fmt_opts: None,
    }
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
        let buf = path_buf.as_mut_slice();
        // SAFETY: FFI reads exactly path.len() u32s and writes ≤ MAX_PATH_BYTES bytes.
        let result = unsafe {
            bun_simdutf_sys::simdutf::simdutf__convert_utf32_to_utf8_with_errors(
                self.path.as_ptr(),
                self.path.len(),
                buf.as_mut_ptr(),
            )
        };
        let converted: &[u8] = if result.is_successful() {
            &buf[..result.count]
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
                return write!(f, "{}", bstr::BStr::new(self.buf));
            }

            let mut ptr = self.buf;
            while let Some(i) = crate::strings_impl::index_of_any(ptr, b"\\/") {
                let sep = match opts.path_sep {
                    PathSep::Windows => b'\\',
                    PathSep::Posix => b'/',
                    PathSep::Auto => crate::SEP,
                    PathSep::Any => ptr[i],
                };
                write!(f, "{}", bstr::BStr::new(&ptr[..i]))?;
                f.write_char(sep as char)?;
                if opts.escape_backslashes && sep == b'\\' {
                    f.write_char(sep as char)?;
                }
                ptr = &ptr[i + 1..];
            }

            return write!(f, "{}", bstr::BStr::new(ptr));
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
        Self {
            path_sep: PathSep::Any,
            escape_backslashes: false,
        }
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
    FormatOSPath {
        buf,
        path_fmt_opts: Some(options),
    }
}

// TODO(port): Zig `fmtPath` dispatches on `comptime T: type` returning either FormatUTF8
// or FormatUTF16. In Rust, callers should call `fmt_path_u8` / `fmt_path_u16` directly,
// or use a small trait. Providing both monomorphizations here.
pub fn fmt_path_u8(path: &[u8], options: PathFormatOptions) -> FormatUTF8<'_> {
    FormatUTF8 {
        buf: path,
        path_fmt_opts: Some(options),
    }
}
pub fn fmt_path_u16(path: &[u16], options: PathFormatOptions) -> FormatUTF16<'_> {
    FormatUTF16 {
        buf: path,
        path_fmt_opts: Some(options),
    }
}
/// `bun.fmt.fmtPath` — `u8` is the overwhelmingly common instantiation; route it
/// here so callers can write `bun_core::fmt::fmt_path(..)` without naming the
/// element type. Use `fmt_path_u16` for the wide variant.
#[inline]
pub fn fmt_path(path: &[u8], options: PathFormatOptions) -> FormatUTF8<'_> {
    fmt_path_u8(path, options)
}

/// Non-validating `Display` adapter for a `&[u8]` known to be valid UTF-8.
///
/// Port of Zig's `{s}` format specifier on a `[]const u8`: Zig writes the bytes
/// straight through with no codepoint check. `bstr::BStr`'s `Display` impl walks
/// the input via `Utf8Chunks` to substitute U+FFFD on invalid sequences, which
/// shows up in install-hot-path profiles (registry hosts, package names, semver
/// pre/build tags — all pre-validated ASCII). Use this where the bytes are
/// already known-good and you just want `f.write_str` semantics.
///
/// Prefer the [`s`] alias at call sites — it reads like Zig's `{s}`.
#[derive(Copy, Clone)]
#[repr(transparent)]
pub struct Raw<'a>(pub &'a [u8]);
impl fmt::Display for Raw<'_> {
    #[inline(always)]
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        // SAFETY: caller contract — `self.0` is valid UTF-8 (in practice ASCII:
        // npm package names, registry URLs, semver tags). Matches Zig `{s}`.
        f.write_str(unsafe { core::str::from_utf8_unchecked(self.0) })
    }
}
/// Shorthand constructor for [`Raw`]. Prefer [`s`] (same thing, Zig-style name).
#[inline(always)]
pub const fn raw(bytes: &[u8]) -> Raw<'_> {
    Raw(bytes)
}

// Canonical `SliceCursor` / `buf_print` / `buf_print_len` live in T0
// `bun_alloc` so that crate can use them too; re-exported here for the
// `bun_core::fmt::` callers and extended with an `io::Write` face so the same
// struct also serves as Zig's `std.io.fixedBufferStream` for write-only sites.
pub use bun_alloc::{SliceCursor, buf_print, buf_print_len};

impl crate::io::Write for SliceCursor<'_> {
    #[inline]
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), crate::Error> {
        let end = self.at + bytes.len();
        if end > self.buf.len() {
            return Err(crate::err!("NoSpaceLeft"));
        }
        self.buf[self.at..end].copy_from_slice(bytes);
        self.at = end;
        Ok(())
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.at
    }
}

/// Port of `std.fmt.bufPrintZ` — [`buf_print`] then append a NUL terminator and
/// return a [`ZStr`](crate::ZStr) borrowing `buf`. Fails if the formatted output
/// *plus* the trailing NUL doesn't fit.
pub fn buf_print_z<'a>(
    buf: &'a mut [u8],
    args: core::fmt::Arguments<'_>,
) -> core::result::Result<&'a crate::ZStr, core::fmt::Error> {
    let mut c = SliceCursor { buf, at: 0 };
    core::fmt::write(&mut c, args)?;
    let n = c.at;
    if n >= c.buf.len() {
        return Err(core::fmt::Error);
    }
    c.buf[n] = 0;
    Ok(crate::ZStr::from_buf(c.buf, n))
}

/// [`buf_print`] that panics on overflow — mirrors Zig's
/// `std.fmt.bufPrint(buf, fmt, args) catch unreachable`. Use when the
/// caller-supplied stack buffer is sized so overflow is a programmer error.
#[inline]
#[track_caller]
pub fn buf_print_infallible<'a>(buf: &'a mut [u8], args: core::fmt::Arguments<'_>) -> &'a [u8] {
    buf_print(buf, args).expect("buf_print: buffer too small")
}

/// [`buf_print_z`] that panics on overflow — mirrors Zig's
/// `std.fmt.bufPrintZ(buf, fmt, args) catch unreachable`.
#[inline]
#[track_caller]
pub fn buf_print_z_infallible<'a>(
    buf: &'a mut [u8],
    args: core::fmt::Arguments<'_>,
) -> &'a crate::ZStr {
    buf_print_z(buf, args).expect("buf_print_z: buffer too small")
}

// ════════════════════════════════════════════════════════════════════════════
// VecWriter — `core::fmt::Write` over `&mut Vec<u8>`
// ════════════════════════════════════════════════════════════════════════════

/// `core::fmt::Write` adapter for `Vec<u8>`.
///
/// Rust's `Vec<u8>` only implements `std::io::Write` (banned in lower crates
/// per PORTING.md), not `core::fmt::Write`. This is the port of Zig's
/// `std.ArrayList(u8).writer()` — infallible (Vec growth aborts on OOM).
///
/// Both the tuple constructor and `::new()` are public so call sites can pick
/// whichever reads better: `write!(VecWriter(&mut buf), ...)` or
/// `VecWriter::new(&mut buf)`.
pub struct VecWriter<'a>(pub &'a mut Vec<u8>);

impl<'a> VecWriter<'a> {
    #[inline]
    pub fn new(v: &'a mut Vec<u8>) -> Self {
        Self(v)
    }
}
impl core::fmt::Write for VecWriter<'_> {
    #[inline]
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        self.0.extend_from_slice(s.as_bytes());
        Ok(())
    }
}

// ════════════════════════════════════════════════════════════════════════════
// std.fmt.parseInt / parseUnsigned — canonical &[u8] integer parsers.
//
// Zig has exactly one impl (`std.fmt.parseIntWithSign`, vendor/zig/lib/std/
// fmt.zig:409) plus thin no-sign wrapper `std.fmt.parseUnsigned` (:488). Every
// Zig caller invoked those directly on `[]const u8`; the Rust port spawned ~15
// local digit loops solely to dodge `core::str::from_utf8`. These restore 1:1
// parity. bun_string re-exports `parse_int` so existing `strings::parse_int`
// callers keep working. Re-exported via bun_core::lib.rs.
// ════════════════════════════════════════════════════════════════════════════

/// Error from [`parse_int`] / [`parse_unsigned`] (`std.fmt.ParseIntError` port).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseIntError {
    InvalidCharacter,
    Overflow,
}

impl ParseIntError {
    /// Zig `@errorName(e)` — for callers that bubble the tag verbatim
    /// (e.g. Postgres `CommandTag` Debug fmt).
    #[inline]
    pub const fn name(self) -> &'static str {
        match self {
            Self::InvalidCharacter => "InvalidCharacter",
            Self::Overflow => "Overflow",
        }
    }
}

/// Shared digit loop behind [`parse_int`] / [`parse_unsigned`]. `digits` has
/// any sign already stripped; `radix` is post-auto-detect (2..=36). Mirrors
/// `std.fmt.parseIntWithSign` body: skips embedded `_` separators, rejects
/// leading/trailing `_`, accumulates in `u128` with checked overflow.
#[inline]
fn parse_with_sign(digits: &[u8], radix: u8) -> Result<u128, ParseIntError> {
    debug_assert!((2..=36).contains(&radix));
    if digits.is_empty() || digits[0] == b'_' || *digits.last().unwrap() == b'_' {
        return Err(ParseIntError::InvalidCharacter);
    }
    let radix_u = radix as u128;
    let mut acc: u128 = 0;
    for &c in digits {
        if c == b'_' {
            continue;
        }
        let d = match c {
            b'0'..=b'9' => (c - b'0') as u128,
            b'a'..=b'z' => (c - b'a' + 10) as u128,
            b'A'..=b'Z' => (c - b'A' + 10) as u128,
            _ => return Err(ParseIntError::InvalidCharacter),
        };
        if d >= radix_u {
            return Err(ParseIntError::InvalidCharacter);
        }
        acc = acc
            .checked_mul(radix_u)
            .and_then(|v| v.checked_add(d))
            .ok_or(ParseIntError::Overflow)?;
    }
    Ok(acc)
}

/// Strip an optional `0x`/`0o`/`0b` prefix when `radix == 0`; otherwise pass
/// through unchanged. Mirrors `std.fmt.parseIntWithSign` radix-0 branch.
#[inline]
fn auto_radix(digits: &[u8], radix: u8) -> (&[u8], u8) {
    if radix != 0 {
        return (digits, radix);
    }
    if digits.len() >= 2 && digits[0] == b'0' {
        match digits[1] {
            b'x' | b'X' => return (&digits[2..], 16),
            b'o' | b'O' => return (&digits[2..], 8),
            b'b' | b'B' => return (&digits[2..], 2),
            _ => {}
        }
    }
    (digits, 10)
}

/// `std.fmt.parseInt(T, buf, radix)` — parse an integer of type `T` from `buf`.
///
/// `radix` ∈ 2..=36, or `0` to auto-detect from a `0x`/`0o`/`0b` prefix
/// (defaulting to 10). Accepts an optional leading `+`/`-`. Embedded `_`
/// separators are skipped; leading/trailing `_` are rejected. Port keeps Zig's
/// error set: `Overflow` on range error, `InvalidCharacter` otherwise.
///
/// Works directly on `&[u8]` so callers never need an intermediate
/// `core::str::from_utf8` round-trip.
pub fn parse_int<T>(buf: &[u8], radix: u8) -> Result<T, ParseIntError>
where
    T: TryFrom<i128> + TryFrom<u128>,
{
    if buf.is_empty() {
        return Err(ParseIntError::InvalidCharacter);
    }
    let (neg, rest) = match buf[0] {
        b'+' => (false, &buf[1..]),
        b'-' => (true, &buf[1..]),
        _ => (false, buf),
    };
    let (digits, radix) = auto_radix(rest, radix);
    let acc = parse_with_sign(digits, radix)?;
    if neg {
        let signed: i128 = if acc == (i128::MAX as u128) + 1 {
            i128::MIN
        } else if acc > i128::MAX as u128 {
            return Err(ParseIntError::Overflow);
        } else {
            -(acc as i128)
        };
        T::try_from(signed).map_err(|_| ParseIntError::Overflow)
    } else {
        T::try_from(acc).map_err(|_| ParseIntError::Overflow)
    }
}

/// `std.fmt.parseUnsigned(T, buf, radix)` — [`parse_int`] without sign
/// handling: a leading `+`/`-` is `InvalidCharacter`. Use when the grammar
/// being parsed forbids signs (semver components, HTTP status codes,
/// content-length, etc.).
#[inline]
pub fn parse_unsigned<T>(buf: &[u8], radix: u8) -> Result<T, ParseIntError>
where
    T: TryFrom<i128> + TryFrom<u128>,
{
    let (digits, radix) = auto_radix(buf, radix);
    let acc = parse_with_sign(digits, radix)?;
    T::try_from(acc).map_err(|_| ParseIntError::Overflow)
}

/// `std.fmt.parseInt(T, s, 10) catch null` — decimal convenience wrapper over
/// [`parse_int`]. Replaces the ~12 file-local
/// `fn parse_T(s:&[u8])->Option<T>{ parse_int(s,10).ok() }` thin wrappers the
/// port spawned (Zig calls `std.fmt.parseInt` inline at every site).
#[inline]
pub fn parse_decimal<T>(s: &[u8]) -> Option<T>
where
    T: TryFrom<i128> + TryFrom<u128>,
{
    parse_int::<T>(s, 10).ok()
}

// ──────────────────────────────────────────────────────────────────────────
// parse_double — `WTF.parseDouble` (src/jsc/WTF.zig:20 / bun.zig:1150)
//
// Partial-match JS-semantics double parse over Latin-1 bytes. Unlike
// [`parse_f64`] this accepts a numeric *prefix* (`b"1.5x"` → `Ok(1.5)`) and
// does NOT special-case `inf`/`nan` — it is exactly WebKit's lexer behaviour.
//
// Lives in tier-0 `bun_core` (not `bun_jsc`) so `bun_interchange` (yaml/toml),
// `bun_js_parser::lexer`, and `bun_install` can call it without taking a
// `bun_jsc` edge. `bun_core::wtf`, `bun_jsc::wtf`, and `bun::` re-export it
// to preserve the Zig namespace shape.
//
// TODO(port): Zig `bun.parseDouble` falls back to `std.fmt.parseFloat` under
// `comptime Environment.isWasm` (no WebKit link). Restore when wasm target is
// brought up.
// ──────────────────────────────────────────────────────────────────────────

/// Error from [`parse_double`] — Zig `error{InvalidCharacter}`.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct InvalidCharacter;

impl core::fmt::Display for InvalidCharacter {
    #[inline]
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("InvalidCharacter")
    }
}
impl core::error::Error for InvalidCharacter {}
impl From<InvalidCharacter> for crate::Error {
    #[inline]
    fn from(_: InvalidCharacter) -> Self {
        crate::Error::from_name("InvalidCharacter")
    }
}

/// `WTF.parseDouble` — partial-match Latin-1 double parser. Returns `Ok` if
/// any numeric prefix was consumed; `Err(InvalidCharacter)` on empty input or
/// when no leading digit/sign was recognised.
pub fn parse_double(buf: &[u8]) -> Result<f64, InvalidCharacter> {
    if buf.is_empty() {
        return Err(InvalidCharacter);
    }
    let mut count: usize = 0;
    // SAFETY: `buf` is a valid slice; WTF reads at most `len` Latin-1 bytes.
    let res = unsafe { WTF__parseDouble(buf.as_ptr(), buf.len(), &raw mut count) };
    if count == 0 {
        return Err(InvalidCharacter);
    }
    Ok(res)
}

// `WTF__parseDouble` — WebKit's JS-semantics double parser (Latin-1 input,
// reports prefix length). Declared here (not via `bun_string`) so tier-0
// callers can parse floats with no UTF-8 validation. Link-time symbol
// provided by `src/jsc/bindings/wtf-bindings.cpp`.
unsafe extern "C" {
    fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64;
}

/// `std.fmt.parseFloat(f64, buf)` — full-match parse of `s` as an `f64`.
/// Returns `None` on empty input, trailing garbage (`b"1.5x"`), or non-numeric
/// input. Backed by `WTF__parseDouble` (no `&str` round-trip — digits are
/// ASCII, validation is wasted work).
///
/// `WTF::parseDouble` rejects `inf`/`nan` (JS-number semantics); those are
/// special-cased here so callers ported from `std.fmt.parseFloat` keep the
/// same surface.
pub fn parse_f64(s: &[u8]) -> Option<f64> {
    if s.is_empty() {
        return None;
    }
    let mut count: usize = 0;
    // SAFETY: `s` is a valid slice; WTF reads at most `len` Latin-1 bytes.
    let res = unsafe { WTF__parseDouble(s.as_ptr(), s.len(), &raw mut count) };
    if count == s.len() {
        return Some(res);
    }
    if count == 0 {
        // WTF__parseDouble doesn't recognise inf/nan; std.fmt.parseFloat does.
        let (neg, rest) = match s[0] {
            b'-' => (true, &s[1..]),
            b'+' => (false, &s[1..]),
            _ => (false, s),
        };
        return match rest {
            b if strings::eql_any_case_insensitive_ascii(b, &[b"inf", b"infinity"]) => {
                Some(if neg {
                    f64::NEG_INFINITY
                } else {
                    f64::INFINITY
                })
            }
            b if strings::eql_case_insensitive_ascii_check_length(b, b"nan") => Some(f64::NAN),
            _ => None,
        };
    }
    None // partial match → trailing garbage
}

/// `parse_f64` truncated to `f32`. (Zig `std.fmt.parseFloat(f32, ..)`.)
#[inline]
pub fn parse_f32(s: &[u8]) -> Option<f32> {
    parse_f64(s).map(|v| v as f32)
}

/// Parse `s` as `T` for grammars whose alphabet is pure ASCII (IP addresses,
/// booleans). Any non-ASCII byte short-circuits to `None`, so the `&str` view
/// is always valid without a UTF-8 walk. **Do not** use for integers/floats —
/// use [`parse_int`] / [`parse_f64`].
#[inline]
pub fn parse_ascii<T: core::str::FromStr>(s: &[u8]) -> Option<T> {
    if !s.is_ascii() {
        return None;
    }
    // SAFETY: every byte < 0x80 ⇒ `s` is valid (ASCII ⊂ UTF-8).
    unsafe { core::str::from_utf8_unchecked(s) }
        .parse::<T>()
        .ok()
}

#[deprecated = "use parse_int / parse_f64 / parse_ascii (no from_utf8)"]
#[inline]
pub fn parse_num<T: core::str::FromStr>(s: &[u8]) -> Option<T> {
    parse_ascii(s)
}

// ───────────────────────────────────────────────────────────────────────────
// Latin-1 formatting
// ───────────────────────────────────────────────────────────────────────────

pub fn format_latin1(slice_: &[u8], writer: &mut impl fmt::Write) -> fmt::Result {
    let mut borrow = SharedTempBufferBorrow::new();
    let chunk = borrow.chunk();
    let mut slice = slice_;

    while let Some(i) = crate::strings_impl::first_non_ascii(slice) {
        if i > 0 {
            write_bytes(writer, &slice[..i])?;
            slice = &slice[i..];
        }
        let take = chunk.len().min(slice.len());
        let result = strings::copy_latin1_into_utf8(chunk, &slice[..take]);
        if result.read == 0 || result.written == 0 {
            break;
        }
        write_bytes(writer, &chunk[..result.written as usize])?;
        slice = &slice[result.read as usize..];
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
        Self {
            proto: URLProto::Http,
            hostname: None,
            port: None,
        }
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
        write!(
            f,
            "{}://",
            match self.proto {
                URLProto::Http => "http",
                URLProto::Https => "https",
                URLProto::Unix => "unix",
                URLProto::Abstract => "abstract",
            }
        )?;

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
        if crate::strings_impl::index_of_char(self.host, b':').is_some() {
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

        let mut iterator = crate::CodepointIterator::init(self.name);
        let mut cursor = crate::CodepointIteratorCursor::default();

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
            iterator = crate::CodepointIterator::init(slice);
            cursor = crate::CodepointIteratorCursor::default();

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
        if let Some(i) = crate::strings::index_of_newline_or_non_ascii_or_ansi(self_, offset as u32)
        {
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
                        if let Some(j) = crate::strings_impl::index_of_char(remain, b'm') {
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

/// Formats a string to be safe to use as a Github Actions workflow-command
/// *property* value (e.g. the `title=` in `::error title=...::`). Unlike
/// [`github_action`] (which only escapes the message-class metacharacters), this
/// escapes the property-class metacharacters per the actions/toolkit spec:
/// `%`->`%25`, `\r`->`%0D`, `\n`->`%0A`, `:`->`%3A`, `,`->`%2C`.
pub fn github_action_property_writer(writer: &mut impl fmt::Write, self_: &[u8]) -> fmt::Result {
    let mut start: usize = 0;
    for (i, &byte) in self_.iter().enumerate() {
        let replacement: &str = match byte {
            b'%' => "%25",
            b'\r' => "%0D",
            b'\n' => "%0A",
            b':' => "%3A",
            b',' => "%2C",
            _ => continue,
        };
        if i > start {
            write_bytes(writer, &self_[start..i])?;
        }
        writer.write_str(replacement)?;
        start = i + 1;
    }
    if start < self_.len() {
        write_bytes(writer, &self_[start..])?;
    }
    Ok(())
}

pub struct GithubActionPropertyFormatter<'a> {
    pub text: &'a [u8],
}

impl Display for GithubActionPropertyFormatter<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        github_action_property_writer(f, self.text)
    }
}

pub fn github_action_property(self_: &[u8]) -> GithubActionPropertyFormatter<'_> {
    GithubActionPropertyFormatter { text: self_ }
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

/// snake_case alias of `fmt_java_script` (Zig: `fmtJavaScript`). Several
/// downstream crates spell it `fmt_javascript`.
#[inline]
pub fn fmt_javascript(
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
pub enum ColorCode {
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
        matches!(
            s,
            b"_auth" | b"_authToken" | b"token" | b"_password" | b"email"
        )
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
                                let end = crate::strings_impl::index_of_char(text, b'\n')
                                    .unwrap_or(text.len());
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
                                        write!(
                                            writer,
                                            "{}\x1b[32m`{}",
                                            Output::RESET,
                                            Output::RESET
                                        )?;
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
                                    continue 'outer;
                                }

                                let npm_secret_len = strings::starts_with_npm_secret(inner);
                                if npm_secret_len != 0 {
                                    write!(writer, "{}\x1b[32m{}", Output::RESET, char_ as char)?;
                                    splat_byte_all(writer, b'*', npm_secret_len)?;
                                    write!(writer, "{}{}", char_ as char, Output::RESET)?;
                                    text = &text[i..];
                                    continue 'outer;
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
                                    continue 'outer;
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
                            let len = crate::strings_impl::index_of_char(text, b'\n')
                                .unwrap_or(text.len());
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
                                continue 'outer;
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
                            let len = crate::strings_impl::index_of_char(text, b'\n')
                                .unwrap_or(text.len());
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
                            let len = crate::strings_impl::index_of_char(text, b'\n')
                                .unwrap_or(text.len());
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
                            let len = crate::strings_impl::index_of_char(text, b'\n')
                                .unwrap_or(text.len());
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
                            let len = crate::strings_impl::index_of_char(text, b'\n')
                                .unwrap_or(text.len());
                            splat_byte_all(writer, b'*', len)?;
                            text = &text[len..];
                            continue;
                        }

                        let mut i: usize = 1;
                        if text.len() > 1
                            && (js_lexer::is_identifier_start(text[1] as i32) || text[1] == b'#')
                        {
                            i = 2;

                            while i < text.len() && js_lexer::is_identifier_continue(text[i] as i32)
                            {
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
                            let len = crate::strings_impl::index_of_char(text, b'\n')
                                .unwrap_or(text.len());
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
                            while i < text.len() && js_lexer::is_identifier_continue(text[i] as i32)
                            {
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
                                continue 'outer;
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
                            let len = crate::strings_impl::index_of_char(text, b'\n')
                                .unwrap_or(text.len());
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
// adt_const_params rewrite: SEPARATOR enum → const bool (only 2 variants).
pub const SEP_LIST: bool = true;
pub const SEP_DASH: bool = false;
#[doc(hidden)]
pub enum EnumTagListSeparator {
    List,
    Dash,
} // kept for callers naming the enum

pub struct EnumTagListFormatter<E: strum::VariantNames, const LIST: bool> {
    pub pretty: bool,
    _marker: core::marker::PhantomData<E>,
}

impl<E: strum::VariantNames, const LIST: bool> Display for EnumTagListFormatter<E, LIST> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        // PERF(port): Zig computed this at comptime as a single &'static str.
        let names = E::VARIANTS;
        for (i, name) in names.iter().enumerate() {
            if LIST {
                if i > 0 {
                    if i + 1 == names.len() {
                        f.write_str(", or ")?;
                    } else {
                        f.write_str(", ")?;
                    }
                }
                write!(f, "\"{}\"", name)?;
            } else {
                write!(f, "\n-  {}", name)?;
            }
        }
        Ok(())
    }
}

pub fn enum_tag_list<E: strum::VariantNames, const LIST: bool>() -> EnumTagListFormatter<E, LIST> {
    EnumTagListFormatter {
        pretty: true,
        _marker: core::marker::PhantomData,
    }
}

// ───────────────────────────────────────────────────────────────────────────
// formatIp
// ───────────────────────────────────────────────────────────────────────────

// TODO(port): `std.net.Address` — bun_core stays I/O-free; Phase B should accept a
// bun_sys/bun_net Address type here. Logic preserved against a placeholder Display.
pub fn format_ip<'a>(
    address: &impl Display,
    into: &'a mut [u8],
) -> Result<&'a mut [u8], crate::Error> {
    // std.net.Address.format includes `:<port>` and square brackets (IPv6)
    //  while Node does neither.  This uses format then strips these to bring
    //  the result into conformance with Node.
    use std::io::Write;
    let mut cursor = std::io::Cursor::new(&mut into[..]);
    write!(cursor, "{}", address).map_err(|_| crate::err!("NoSpaceLeft"))?;
    let written = cursor.position() as usize;

    // PORT NOTE: reshaped for borrowck — compute (start, end) offsets against
    // `into` instead of iteratively reborrowing a `result` slice, so the final
    // returned `&mut into[start..end]` carries the caller's `'a` lifetime
    // cleanly. Semantics match Zig's `result = result[a..b]` chain exactly.
    let mut start = 0usize;
    let mut end = written;

    // Strip `:<port>`
    if let Some(colon) = into[start..end].iter().rposition(|&b| b == b':') {
        end = start + colon;
    }
    // Strip brackets
    if start < end && into[start] == b'[' && into[end - 1] == b']' {
        start += 1;
        end -= 1;
    }
    Ok(&mut into[start..end])
}

// ───────────────────────────────────────────────────────────────────────────
// count (std.fmt.count)
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────── CountingWriter / Null ─────────────────────────
// One type subsumes Zig's `std.Io.Writer.Discarding` (null sink) and the
// removed `std.io.countingWriter(inner)` (forwarding wrapper). Implements
// `core::fmt::Write` so it can replace the per-crate private `CountingWriter`
// reinventions (clap). The byte-level `bun_io::Write` counting sink stays in
// `bun_io::DiscardingWriter` (different trait, sits above bun_core).

/// Zero-sized `fmt::Write` no-op — default type param for [`CountingWriter`].
pub struct Null;
impl fmt::Write for Null {
    #[inline]
    fn write_str(&mut self, _: &str) -> fmt::Result {
        Ok(())
    }
}

/// Counts every byte written; optionally forwards to a wrapped `fmt::Write`.
/// `inner: None` ⇒ pure discarding sink (Zig `Writer.Discarding`).
pub struct CountingWriter<'a, W: fmt::Write = Null> {
    inner: Option<&'a mut W>,
    /// Total bytes written so far (counted before forwarding).
    pub count: usize,
}

impl<'a, W: fmt::Write> CountingWriter<'a, W> {
    /// Wrap an existing `fmt::Write` sink, forwarding writes through it.
    #[inline]
    pub fn wrap(w: &'a mut W) -> Self {
        Self {
            inner: Some(w),
            count: 0,
        }
    }
    /// Direct access to the inner sink (bypasses counting). Panics on the
    /// `null()` variant — callers know which mode they constructed.
    #[inline]
    pub fn inner(&mut self) -> &mut W {
        self.inner.as_mut().unwrap()
    }
}

impl CountingWriter<'static, Null> {
    /// Pure discarding sink — `inner: None`, never forwarded.
    #[inline]
    pub fn null() -> Self {
        Self {
            inner: None,
            count: 0,
        }
    }
}

impl<W: fmt::Write> fmt::Write for CountingWriter<'_, W> {
    #[inline]
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.count += s.len();
        if let Some(w) = self.inner.as_mut() {
            w.write_str(s)?;
        }
        Ok(())
    }
}

/// Port of `std.fmt.count`: number of bytes the formatted args would produce.
///
/// Zig drives a `Writer.Discarding` (64-byte scratch buffer that drops writes
/// and tallies length); Rust's `fmt::Arguments` plugs into the same shape via
/// a `fmt::Write` impl that only sums `s.len()`. No allocation, no UTF-8
/// validation beyond what the formatter already did.
#[inline]
pub fn count(args: fmt::Arguments<'_>) -> usize {
    // Implementation sunk to T0 so `bun_alloc` (which sits below `bun_core`)
    // can share it; this stays as the canonical higher-tier entry point so
    // existing `bun_core::fmt::count` / `bun_fmt::count` callers are unchanged.
    bun_alloc::fmt_count(args)
}

// ───────────────────────────────────────────────────────────────────────────
// digit_count — unified decimal-width helper
//
// Replaces the former two-impl split:
//   • fast_digit_count(u64)->u64  — Lemire 32-entry table; PANICKED on x ≥ 2³²
//                                    (table OOB) despite its u64 signature.
//   • count_int(i64)->usize       — /=10 loop, full i64 incl. MIN, +1 for '-'.
// Zig has the same split (bun.fmt.fastDigitCount vs std.fmt.count("{d}",..));
// unifying here improves on the original.
// ───────────────────────────────────────────────────────────────────────────

/// Decimal digit count of an unsigned 64-bit integer — i.e. the byte length
/// of its default `{}` rendering (`0 → 1`).
///
/// Values < 2³² use Lemire's branchless table
/// (<https://lemire.me/blog/2021/06/03/computing-the-number-of-digits-of-an-integer-even-faster/>);
/// the rare ≥ 2³² tail falls back to a `/= 10` loop so the full `u64` range is
/// covered (the old `fast_digit_count` panicked on table OOB there).
#[inline]
pub fn digit_count_u64(x: u64) -> usize {
    if x == 0 {
        return 1;
    }
    if x < (1u64 << 32) {
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
        let log2 = 63 - x.leading_zeros() as usize;
        return ((x + TABLE[log2]) >> 32) as usize;
    }
    let mut x = x;
    let mut d = 0usize;
    while x > 0 {
        d += 1;
        x /= 10;
    }
    d
}

/// Decimal digit count of a signed 64-bit integer, including the leading `-`
/// for negatives. Handles `i64::MIN` via `unsigned_abs`.
#[inline]
pub fn digit_count_i64(n: i64) -> usize {
    (n < 0) as usize + digit_count_u64(n.unsigned_abs())
}

/// Polymorphic decimal-width helper — `digit_count(n)` returns the byte
/// length of `n`'s default `{}` rendering for any primitive integer.
///
/// Dispatches via [`DigitCount`] to [`digit_count_u64`] / [`digit_count_i64`].
/// Callers needing the old `u64` return type cast: `digit_count(x) as u64`.
#[inline]
pub fn digit_count<T: DigitCount>(n: T) -> usize {
    n.digit_count()
}

/// Implemented for every primitive integer; routes to the appropriate
/// signed/unsigned 64-bit kernel. Not meant to be implemented outside this
/// module.
pub trait DigitCount: Copy {
    fn digit_count(self) -> usize;
}
macro_rules! impl_digit_count_unsigned {
    ($($t:ty),+) => {$(
        impl DigitCount for $t {
            #[inline] fn digit_count(self) -> usize { digit_count_u64(self as u64) }
        }
    )+};
}
macro_rules! impl_digit_count_signed {
    ($($t:ty),+) => {$(
        impl DigitCount for $t {
            #[inline] fn digit_count(self) -> usize { digit_count_i64(self as i64) }
        }
    )+};
}
impl_digit_count_unsigned!(u8, u16, u32, u64, usize);
impl_digit_count_signed!(i8, i16, i32, i64, isize);

#[deprecated(note = "use digit_count / digit_count_u64")]
#[doc(hidden)]
#[inline]
pub fn fast_digit_count(x: u64) -> u64 {
    digit_count_u64(x) as u64
}

#[deprecated(note = "use digit_count / digit_count_i64")]
#[doc(hidden)]
#[inline]
pub fn count_int(n: i64) -> usize {
    digit_count_i64(n)
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
        Self {
            space_between_number_and_unit: true,
        }
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
        let precision: usize = if (new_value - new_value.trunc()).abs() <= 0.100 {
            1
        } else {
            2
        };
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
/// Short-name alias of `size(.., default)` for `{B}`-style formatting
/// (Zig: `bun.fmt.bytes`). Downstream: `bun_fmt::bytes(rss)`.
#[inline]
pub fn bytes(n: usize) -> SizeFormatter {
    SizeFormatter {
        value: n,
        opts: SizeFormatterOptions::default(),
    }
}

/// Lowercase hex encode into `out` (must be `2 * input.len()`). Port of
/// `std.fmt.bytesToHex(.., .lower)` as used by Bun's hash printers.
pub fn bytes_to_hex_lower(input: &[u8], out: &mut [u8]) -> usize {
    debug_assert!(out.len() >= input.len() * 2);
    for (i, &b) in input.iter().enumerate() {
        out[i * 2] = LOWER_HEX_TABLE[(b >> 4) as usize];
        out[i * 2 + 1] = LOWER_HEX_TABLE[(b & 0x0F) as usize];
    }
    input.len() * 2
}

/// Allocating lowercase hex encode. Returns a `String` (output is always ASCII).
pub fn bytes_to_hex_lower_string(input: &[u8]) -> String {
    let mut out = vec![0u8; input.len() * 2];
    bytes_to_hex_lower(input, &mut out);
    // SAFETY: hex alphabet is ASCII.
    unsafe { String::from_utf8_unchecked(out) }
}
pub fn size_f64(bytes: f64, opts: SizeFormatterOptions) -> SizeFormatter {
    SizeFormatter {
        value: bytes as usize,
        opts,
    }
}
pub fn size_i64(bytes: i64, opts: SizeFormatterOptions) -> SizeFormatter {
    // PORT NOTE: Zig's `@intCast(bytes)` is unchecked in release (UB-wraps negative);
    // clamp to 0 instead of panicking so release builds never crash on a transiently
    // negative size, while keeping the safe-build trap via debug_assert.
    debug_assert!(bytes >= 0);
    SizeFormatter {
        value: bytes.max(0) as usize,
        opts,
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Hex formatters
// ───────────────────────────────────────────────────────────────────────────

/// Port of Zig `std.fmt`'s `{x}` / `{X}` on a `[]const u8` — prints each byte
/// as two hex digits with no separator. `LOWER == true` → lowercase, else
/// uppercase. Used by `Lockfile::MetaHashFormatter` and tmp-lockfile naming.
pub struct HexBytes<'a, const LOWER: bool>(pub &'a [u8]);

impl<'a, const LOWER: bool> Display for HexBytes<'a, LOWER> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let table = if LOWER {
            &LOWER_HEX_TABLE
        } else {
            &UPPER_HEX_TABLE
        };
        let mut buf = [0u8; 2];
        for &b in self.0 {
            buf[0] = table[(b >> 4) as usize];
            buf[1] = table[(b & 0x0f) as usize];
            // SAFETY: hex alphabet is ASCII.
            f.write_str(unsafe { core::str::from_utf8_unchecked(&buf) })?;
        }
        Ok(())
    }
}

/// Ergonomic constructor for the lowercase `HexBytes` Display adapter — port of
/// Zig `std.fmt.bytesToHex(.., .lower)` at format-arg call sites (`{x}` on
/// `[]const u8`). Avoids turbofish at every caller.
#[inline]
pub fn hex_lower(bytes: &[u8]) -> HexBytes<'_, true> {
    HexBytes(bytes)
}

/// Ergonomic constructor for the uppercase `HexBytes` Display adapter — port of
/// Zig `std.fmt.bytesToHex(.., .upper)` / the `{X}` format spec on `[]const u8`.
/// Pairs with [`hex_lower`]; avoids turbofish at every caller.
#[inline]
pub fn hex_upper(bytes: &[u8]) -> HexBytes<'_, false> {
    HexBytes(bytes)
}

pub const LOWER_HEX_TABLE: [u8; 16] = [
    b'0', b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'a', b'b', b'c', b'd', b'e', b'f',
];
pub const UPPER_HEX_TABLE: [u8; 16] = [
    b'0', b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'A', b'B', b'C', b'D', b'E', b'F',
];

/// Sentinel returned by [`HEX_DECODE_TABLE`] for non-hex-digit bytes.
pub const HEX_INVALID: u8 = 0xff;

/// 256-entry ASCII-hex-digit → nibble (0..=15) lookup. Non-hex bytes map to
/// [`HEX_INVALID`]. Decode-side counterpart of [`LOWER_HEX_TABLE`] /
/// [`UPPER_HEX_TABLE`].
pub const HEX_DECODE_TABLE: [u8; 256] = {
    let mut t = [HEX_INVALID; 256];
    let mut i = 0u8;
    while i < 10 {
        t[(b'0' + i) as usize] = i;
        i += 1;
    }
    let mut i = 0u8;
    while i < 6 {
        t[(b'a' + i) as usize] = 10 + i;
        t[(b'A' + i) as usize] = 10 + i;
        i += 1;
    }
    t
};

/// Decode a single ASCII hex digit (`0-9`, `a-f`, `A-F`) to its nibble value `0..=15`.
///
/// Returns `None` for any other byte. Callers needing a wider int cast with `as u16/u32`
/// or `.map(u32::from)`; callers needing `Result` use `.ok_or(..)`; callers with a
/// pre-validated byte use `.unwrap()`.
///
/// Zig precedent: `std.fmt.charToDigit(c, 16)` / `bun.strings.toASCIIHexValue`.
#[inline]
pub const fn hex_digit_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Widened wrapper over [`hex_digit_value`] for callers holding a decoded code
/// point (`u32`, or `i32` bit-cast via `as u32`). Any value outside `0..=0xFF`
/// — including a `-1i32 as u32` EOF sentinel — falls through to `None`.
///
/// Returns the nibble `0..=15`; callers cast to their accumulator width.
#[inline]
pub const fn hex_digit_value_u32(c: u32) -> Option<u8> {
    if c <= 0xFF {
        hex_digit_value(c as u8)
    } else {
        None
    }
}

/// Decode two ASCII hex digits into a single byte: `(hi << 4) | lo`.
///
/// Returns `None` if either byte is not `[0-9a-fA-F]`. Callers adapt the
/// error channel exactly as for [`hex_digit_value`]: `.ok_or(..)?` for
/// `Result`, `.unwrap()` when pre-validated, `?` in `Option` context.
///
/// Zig precedent: inner loop of `std.fmt.hexToBytes`.
#[inline]
pub const fn hex_pair_value(hi: u8, lo: u8) -> Option<u8> {
    match (hex_digit_value(hi), hex_digit_value(lo)) {
        (Some(h), Some(l)) => Some((h << 4) | l),
        _ => None,
    }
}

/// Parse exactly 4 ASCII hex digits from `input[..4]` into a `u16`.
///
/// Returns `None` if `input.len() < 4` or any of the first 4 bytes is not
/// `[0-9A-Fa-f]`. Non-consuming — caller advances its cursor by 4 on `Some`.
///
/// This is the `\uHHHH` primitive for JSON/JS string-escape parsing. Surrogate
/// handling (WTF-8 pass-through vs U+FFFD replace, consume-both vs leave-trail
/// on a non-trail second unit) is intentionally **not** baked in: callers
/// compose this with [`crate::strings::u16_is_lead`] /
/// [`crate::strings::decode_surrogate_pair`] and apply their own policy, per
/// the `strings` module note on caller-specific surrogate policy.
#[inline]
pub const fn parse_hex4(input: &[u8]) -> Option<u16> {
    if input.len() < 4 {
        return None;
    }
    match (
        hex_pair_value(input[0], input[1]),
        hex_pair_value(input[2], input[3]),
    ) {
        (Some(hi), Some(lo)) => Some(((hi as u16) << 8) | lo as u16),
        _ => None,
    }
}

/// Consume a run of ASCII hex digits from the front of `input`, accumulating
/// into a `u32` and stopping at the first non-hex byte, end of slice, or after
/// `max_digits` (whichever comes first).
///
/// Returns `(value, digits_consumed)`. With `max_digits <= 8` the accumulator
/// cannot overflow `u32`; callers passing larger caps are responsible for
/// validating the digit count themselves.
///
/// This is the *prefix* primitive — it never fails. Callers needing exact-N
/// semantics (e.g. `\uHHHH`) check `digits_consumed == N` afterward; callers
/// needing a narrower result cast (`value as u8`, `value as i32`).
///
/// Zig precedent: none (each module hand-rolls); analogous to a bounded
/// `std.fmt.parseInt(u32, prefix, 16)` that also reports how much it ate.
#[inline]
pub fn parse_hex_prefix(input: &[u8], max_digits: usize) -> (u32, usize) {
    let mut value: u32 = 0;
    let mut n: usize = 0;
    while n < max_digits && n < input.len() {
        match hex_digit_value(input[n]) {
            Some(d) => {
                value = (value << 4) | d as u32;
                n += 1;
            }
            None => break,
        }
    }
    (value, n)
}

/// Decode a `2 * size_of::<T>()`-char ASCII hex slice into `T` via native-endian
/// byte reinterpretation. Mirrors Zig's `parseHexToInt` (DevServer.zig:961):
/// `std.fmt.hexToBytes` into `[@sizeOf(T)]u8` then `@bitCast` — i.e. pairwise
/// hex-decode then `from_ne_bytes`, **not** a big-endian numeric accumulator.
/// `"0100000000000000"` → `1u64` on little-endian.
///
/// Returns `None` if `slice.len() != 2 * size_of::<T>()` or any byte is not
/// `[0-9a-fA-F]`. `T` is capped at 16 bytes (u128) since stable Rust can't size
/// a stack array by a generic without `generic_const_exprs`.
#[inline]
pub fn parse_hex_to_int<T: bytemuck::Pod>(slice: &[u8]) -> Option<T> {
    let n = core::mem::size_of::<T>();
    debug_assert!(n <= 16);
    if slice.len() != n * 2 {
        return None;
    }
    let mut buf = [0u8; 16];
    for i in 0..n {
        buf[i] = hex_pair_value(slice[i * 2], slice[i * 2 + 1])?;
    }
    Some(bytemuck::pod_read_unaligned(&buf[..n]))
}

/// Map the low 4 bits of `n` to a lowercase ASCII hex digit (`0-9`, `a-f`).
/// High bits are masked, so any `u8` is accepted.
#[inline]
pub const fn hex_char_lower(n: u8) -> u8 {
    LOWER_HEX_TABLE[(n & 0x0F) as usize]
}

/// Map the low 4 bits of `n` to an uppercase ASCII hex digit (`0-9`, `A-F`).
/// High bits are masked, so any `u8` is accepted.
#[inline]
pub const fn hex_char_upper(n: u8) -> u8 {
    UPPER_HEX_TABLE[(n & 0x0F) as usize]
}

/// Encode a single byte as two lowercase ASCII hex digits `[hi, lo]`.
/// Port of the open-coded `CHARSET[(b>>4)] / CHARSET[(b&0xF)]` pair found
/// throughout the Zig sources. For contiguous full-slice output prefer
/// [`bytes_to_hex_lower`].
#[inline]
pub const fn hex_byte_lower(b: u8) -> [u8; 2] {
    [
        LOWER_HEX_TABLE[(b >> 4) as usize],
        LOWER_HEX_TABLE[(b & 0x0F) as usize],
    ]
}

/// Encode a single byte as two UPPERCASE ASCII hex digits `[hi, lo]`.
/// Used by percent-encoders (RFC 3986 mandates uppercase).
#[inline]
pub const fn hex_byte_upper(b: u8) -> [u8; 2] {
    [
        UPPER_HEX_TABLE[(b >> 4) as usize],
        UPPER_HEX_TABLE[(b & 0x0F) as usize],
    ]
}

/// Two hex nibbles for a `u8` (`\\xXX`). `LOWER == false` → uppercase.
#[inline]
pub const fn hex_u8<const LOWER: bool>(b: u8) -> [u8; 2] {
    if LOWER {
        hex_byte_lower(b)
    } else {
        hex_byte_upper(b)
    }
}

// ── compat aliases (pre-dedup names) ──────────────────────────────────────
#[doc(hidden)]
#[inline]
pub const fn hex2_upper(b: u8) -> [u8; 2] {
    hex_byte_upper(b)
}
#[doc(hidden)]
#[inline]
pub const fn hex2_lower(b: u8) -> [u8; 2] {
    hex_byte_lower(b)
}
#[doc(hidden)]
#[inline]
pub const fn hex4_upper(v: u16) -> [u8; 4] {
    hex_u16::<false>(v)
}
#[doc(hidden)]
#[inline]
pub const fn hex4_lower(v: u16) -> [u8; 4] {
    hex_u16::<true>(v)
}

/// Four hex nibbles for a `u16` (`\\uXXXX`). `LOWER == false` → uppercase.
#[inline]
pub const fn hex_u16<const LOWER: bool>(v: u16) -> [u8; 4] {
    let t = if LOWER {
        &LOWER_HEX_TABLE
    } else {
        &UPPER_HEX_TABLE
    };
    [
        t[((v >> 12) & 0xF) as usize],
        t[((v >> 8) & 0xF) as usize],
        t[((v >> 4) & 0xF) as usize],
        t[(v & 0xF) as usize],
    ]
}

// TODO(port): Zig parameterizes on `comptime Int: type` and computes
// `BufType = [@bitSizeOf(Int) / 4]u8`. Rust const generics can't derive an array
// length from a type's bit-width. Represent as a generic over u64 with explicit
// nibble count; Phase B can add per-width helpers if hot.
pub struct HexIntFormatter<const LOWER: bool, const NIBBLES: usize> {
    pub value: u64,
}

impl<const LOWER: bool, const NIBBLES: usize> HexIntFormatter<LOWER, NIBBLES> {
    pub fn get_out_buf(value: u64) -> [u8; NIBBLES] {
        let table = if LOWER {
            &LOWER_HEX_TABLE
        } else {
            &UPPER_HEX_TABLE
        };
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

/// `{:0N x}` / `{:0N X}` — zero-padded fixed-width hex of a u64 into a stack
/// buffer. Thin alias over [`HexIntFormatter::get_out_buf`] for callers that
/// want bytes, not a `Display` adapter. Port of Zig `bun.fmt.hexIntLower` /
/// `hexIntUpper` when used with `bufPrint`.
#[inline]
pub fn u64_hex_fixed<const LOWER: bool, const N: usize>(v: u64) -> [u8; N] {
    HexIntFormatter::<LOWER, N>::get_out_buf(v)
}

/// Format a 6-byte MAC address as `xx:xx:xx:xx:xx:xx` (lowercase hex,
/// colon-separated). Returns a fixed 17-byte ASCII buffer; borrow as `&[u8]`
/// for `ZigString::init`. Port of the inline `std.fmt.bufPrint(.., "{x:0>2}:..")`
/// pattern duplicated at `node_os.zig:686` and `:800`.
#[inline]
pub fn mac_address_lower(mac: &[u8; 6]) -> [u8; 17] {
    let mut out = [b':'; 17];
    let mut i = 0;
    for &b in mac {
        out[i] = LOWER_HEX_TABLE[(b >> 4) as usize];
        out[i + 1] = LOWER_HEX_TABLE[(b & 0x0f) as usize];
        i += 3;
    }
    out
}

/// `{:0N}` — zero-padded fixed-width decimal of a `u64` into `[u8; N]`.
/// Decimal sibling of [`u64_hex_fixed`] / [`hex_byte_upper`]. Port of Zig
/// `std.fmt.printInt(.., .{.width=N, .fill='0'})`. Caller guarantees
/// `val < 10^N`; excess high digits are silently dropped (debug-asserted).
#[inline(always)]
pub fn itoa_padded<const N: usize>(mut val: u64) -> [u8; N] {
    debug_assert!(N == 0 || val < 10u64.saturating_pow(N as u32));
    let mut buf = [b'0'; N];
    let mut i = N;
    while i > 0 {
        i -= 1;
        // val % 10 < 10 ⇒ cast never truncates.
        buf[i] = b'0' + (val % 10) as u8;
        val /= 10;
    }
    buf
}

/// `{:x}` — variable-width lower-hex of a u64 (no leading zeros; `0` → `"0"`),
/// written into the tail of `buf` and returned as a slice borrow.
#[inline]
pub fn u64_hex_var_lower(buf: &mut [u8; 16], mut n: u64) -> &[u8] {
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = LOWER_HEX_TABLE[(n & 0xF) as usize];
        n >>= 4;
        if n == 0 {
            break;
        }
    }
    &buf[i..]
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
            // PORT NOTE: Zig used `[2 + precision]u8` stack array; Rust const-generic array
            // length arithmetic is unstable, so use a small fixed upper bound and
            // const-assert it suffices (matches Zig's compile-time sizing guarantee).
            const {
                assert!(
                    PRECISION + 3 <= 32,
                    "TrimmedPrecisionFormatter PRECISION too large for fixed buffer"
                )
            };
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

pub fn trimmed_precision<const PRECISION: usize>(
    value: f64,
) -> TrimmedPrecisionFormatter<PRECISION> {
    TrimmedPrecisionFormatter {
        num: value,
        precision: PRECISION,
    }
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
        Self {
            ns: 0,
            negative: false,
        }
    }
}

use crate::time::{
    NS_PER_DAY, NS_PER_HOUR, NS_PER_MIN, NS_PER_MS, NS_PER_S, NS_PER_US, NS_PER_WEEK,
};

/// This is copied from std.fmt.formatDuration, except it will only print one decimal instead of three
fn format_duration_one_decimal(
    data: FormatDurationData,
    writer: &mut impl fmt::Write,
) -> fmt::Result {
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

    const FINE: [(u64, &[u8]); 3] = [(NS_PER_S, b"s"), (NS_PER_MS, b"ms"), (NS_PER_US, b"us")];
    for &(unit_ns, sep) in FINE.iter() {
        let kunits = ns_remaining * 1000 / unit_ns;
        if kunits >= 1000 {
            push_fmt!("{}", kunits / 1000);
            let frac = (kunits % 1000) / 100;
            if frac > 0 {
                let decimal_buf = [b'.', b'0' + u8::try_from(frac).expect("int cast")];
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
    DurationOneDecimal(FormatDurationData {
        ns,
        negative: false,
    })
}

// ───────────────────────────────────────────────────────────────────────────
// SQL connection-timeout error message — pure formatting, cycle-free: bun_core
// is already a dep of bun_sql_jsc AND bun_runtime.
// ───────────────────────────────────────────────────────────────────────────

/// Which connection-level timeout fired. Drives the message template in
/// [`fmt_conn_timeout`]; shared by the Postgres and MySQL backends.
#[derive(Clone, Copy)]
pub enum ConnTimeoutKind {
    Idle,
    Connection,
    MaxLifetime,
}

/// Render the canonical SQL connection-timeout error message.
///
/// `ms` is converted to nanoseconds with a saturating multiply and rendered
/// through [`fmt_duration_one_decimal`] (matching the Zig backends' inline
/// `bun.fmt.fmtDurationOneDecimal(ms * std.time.ns_per_ms)`). `suffix` is
/// appended verbatim — used for the per-status `(sent startup message…)` /
/// `(during authentication)` tails.
pub fn fmt_conn_timeout(kind: ConnTimeoutKind, ms: u32, suffix: &str) -> impl Display + '_ {
    struct F<'a>(ConnTimeoutKind, u32, &'a str);
    impl Display for F<'_> {
        fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
            let prefix = match self.0 {
                ConnTimeoutKind::Idle => "Idle timeout reached after ",
                ConnTimeoutKind::Connection => "Connection timeout after ",
                ConnTimeoutKind::MaxLifetime => "Max lifetime timeout reached after ",
            };
            f.write_str(prefix)?;
            fmt_duration_one_decimal((self.1 as u64).saturating_mul(1_000_000)).fmt(f)?;
            f.write_str(self.2)
        }
    }
    F(kind, ms, suffix)
}

// ───────────────────────────────────────────────────────────────────────────
// FormatSlice
// ───────────────────────────────────────────────────────────────────────────

pub fn fmt_slice<'a, T: AsRef<[u8]>>(data: &'a [T], delim: &'static str) -> FormatSlice<'a, T> {
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
    // `&mut [u8; 124]` is ABI-identical to the C `char *` argument (thin
    // non-null pointer to 124 writable bytes); the type encodes WTF__dtoa's
    // only precondition (≥124-byte writable buffer), so `safe fn` discharges
    // the link-time proof and callers need no `unsafe` block.
    safe fn WTF__dtoa(buf: &mut [u8; 124], number: f64) -> usize;
}

impl FormatDouble {
    pub fn dtoa(buf: &mut [u8; 124], number: f64) -> &[u8] {
        let len = WTF__dtoa(buf, number);
        &buf[..len]
    }

    pub fn dtoa_with_negative_zero(buf: &mut [u8; 124], number: f64) -> &[u8] {
        if number == 0.0 && number.is_sign_negative() {
            return b"-0";
        }
        let len = WTF__dtoa(buf, number);
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

/// Downstream alias — several callers (ConsoleObject) refer to this as
/// `bun_core::fmt::DoubleFormatter` (matching the Zig "formatter" naming
/// convention rather than the `Format*` struct convention used here).
pub type DoubleFormatter = FormatDouble;

// ─── Integer → ASCII ───────────────────────────────────────────────────────
// One path for every base-10 integer write. Backed by the `itoa` crate (LUT
// 2-digits-at-a-time — same code serde_json/cssparser ship), already in the
// workspace link graph. Replaces the three competing impls the port grew:
// `core::fmt`-via-SliceCursor (slow + silent-truncate footgun), the hand-
// rolled `itoa_u64` reverse-fill, and tcc_sys's private `itoa::Buffer` use.
// Zig has exactly one path (`std.fmt.printInt`); this restores that parity.

/// Stack scratch for [`itoa`]. 40 bytes — fits `i128::MIN`. `::new()` is a
/// const no-op (uninit array), so declare it inline at the call site.
pub use ::itoa::Buffer as ItoaBuf;

/// Format `n` as base-10 ASCII into `buf` and return the digits (with leading
/// `-` for negatives) as `&[u8]`. `core::fmt`-free; no `Formatter` vtable.
#[inline]
pub fn itoa<T: ::itoa::Integer>(buf: &mut ItoaBuf, n: T) -> &[u8] {
    buf.format(n).as_bytes()
}

/// If `val` is exactly `10^e` for `e` in `4..=9`, return `Some(e)`; else `None`.
///
/// Used by `js_printer`'s non-negative-integer fast path to emit the
/// minified-JS forms `1e4`..`1e9` (which are shorter than the full digit
/// expansion). `e ≤ 3` is not shorter; `e ≥ 10` exceeds `u32::MAX` and is
/// handled by the printer's f64 path.
#[inline]
pub const fn pow10_exp_1e4_to_1e9(val: u64) -> Option<u8> {
    match val {
        10_000 => Some(4),
        100_000 => Some(5),
        1_000_000 => Some(6),
        10_000_000 => Some(7),
        100_000_000 => Some(8),
        1_000_000_000 => Some(9),
        _ => None,
    }
}

/// Port of `std.fmt.printInt(buf, value, 10, .lower, .{})`: format `value`
/// into `buf` as base-10 ASCII and return the number of bytes written.
/// Panics if `buf` is too small — callers size the buffer by the type's max
/// digit count. Use [`itoa`] directly when you can own a fresh [`ItoaBuf`];
/// this exists for offset-writes into a larger caller buffer.
#[inline]
pub fn print_int<T: ::itoa::Integer>(buf: &mut [u8], value: T) -> usize {
    let mut tmp = ItoaBuf::new();
    let s = tmp.format(value).as_bytes();
    buf[..s.len()].copy_from_slice(s);
    s.len()
}

/// [`print_int`] returning the written sub-slice of `buf` — the moral
/// equivalent of Zig's `std.fmt.bufPrint(&buf, "{d}", .{v}) catch unreachable`.
/// Use this when the caller wants the bytes; use [`print_int`] directly when
/// writing at an offset and only the byte-count is needed.
#[inline]
pub fn int_as_bytes<T: ::itoa::Integer>(buf: &mut [u8], value: T) -> &[u8] {
    let n = print_int(buf, value);
    &buf[..n]
}

/// NUL-terminated decimal `u64` → ASCII into a caller-owned scratch buffer,
/// returning a [`CStr`] borrowing the head of `buf`.
///
/// This is the Rust analogue of Zig's `std.fmt.bufPrintZ(&buf, "{d}", .{n})`
/// — used when handing an integer to a C API that wants a `*const c_char`
/// service/port string (e.g. `getaddrinfo`, `ares_getaddrinfo`). 21 bytes
/// covers `u64::MAX` (20 digits) + NUL; `u16`/`u32` callers widen via `as u64`.
#[inline]
pub fn itoa_z(buf: &mut [u8; 21], n: u64) -> &core::ffi::CStr {
    let mut tmp = ItoaBuf::new();
    let s = tmp.format(n).as_bytes();
    buf[..s.len()].copy_from_slice(s);
    buf[s.len()] = 0;
    // SAFETY: itoa output is pure ASCII digits (no interior NUL); we just
    // wrote a NUL terminator at `s.len()`.
    unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(&buf[..=s.len()]) }
}

/// Byte length of `n` formatted with the default `{}` Display — moral
/// equivalent of Zig's `std.fmt.count("{d}", .{n})`. Used by ConsoleObject
/// width tracking for `%f` substitutions.
#[inline]
pub fn count_float(n: f64) -> usize {
    count(format_args!("{n}"))
}

// ───────────────────────────────────────────────────────────────────────────
// NullableFallback
// ───────────────────────────────────────────────────────────────────────────

pub fn nullable_fallback<T: Display>(
    value: Option<T>,
    null_fallback: &[u8],
) -> NullableFallback<'_, T> {
    NullableFallback {
        value,
        null_fallback,
    }
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
    while let Some(i) = crate::strings_impl::index_of_any(remain, b"\"`") {
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
    fn type_name() -> &'static str {
        "f64"
    }
}
impl OutOfRangeValue for i64 {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, " Received {}", self)
    }
    fn type_name() -> &'static str {
        "i64"
    }
}
impl OutOfRangeValue for i32 {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, " Received {}", self)
    }
    fn type_name() -> &'static str {
        "i32"
    }
}
impl<'a> OutOfRangeValue for &'a [u8] {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, " Received {}", bstr::BStr::new(self))
    }
    fn type_name() -> &'static str {
        "[]const u8"
    }
}
// MOVE_DOWN: bun_core::String → bun_alloc (T0). Re-import from there.
impl OutOfRangeValue for bun_alloc::String {
    fn write_received(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, " Received {}", self)
    }
    fn type_name() -> &'static str {
        "bun.String"
    }
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
        Self {
            min: i64::MAX,
            max: i64::MAX,
            field_name: b"",
            msg: b"",
        }
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
    write_bytes(writer, &truncated_hash32_bytes(int))
}

/// Const-fn core of [`truncated_hash32`] / [`TruncatedHash32`]: the 8-byte
/// base32-ish encoding (native-endian, matches Zig `@bitCast([8]u8, int)`).
/// Exposed so const contexts (e.g. `js_parser::generated_symbol_name!`) can
/// share the single alphabet table instead of copy-pasting it.
pub const fn truncated_hash32_bytes(int: u64) -> [u8; 8] {
    const CHARS: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";
    let b = int.to_ne_bytes();
    [
        CHARS[(b[0] & 31) as usize],
        CHARS[(b[1] & 31) as usize],
        CHARS[(b[2] & 31) as usize],
        CHARS[(b[3] & 31) as usize],
        CHARS[(b[4] & 31) as usize],
        CHARS[(b[5] & 31) as usize],
        CHARS[(b[6] & 31) as usize],
        CHARS[(b[7] & 31) as usize],
    ]
}

/// Zero-validation `&[u8] -> impl Display` adapter — alias of [`raw`] named to
/// read like Zig's `{s}` specifier at call sites (`bun_fmt::s(name)`).
#[inline(always)]
pub const fn s(bytes: &[u8]) -> Raw<'_> {
    Raw(bytes)
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

#[inline]
fn write_bytes(w: &mut impl fmt::Write, bytes: &[u8]) -> fmt::Result {
    // SAFETY: see `s()` above — Zig's `{s}` path, callers feed ASCII/utf8.
    w.write_str(unsafe { core::str::from_utf8_unchecked(bytes) })
}

#[inline]
fn splat_byte_all(w: &mut impl fmt::Write, byte: u8, count: usize) -> fmt::Result {
    // Mirrors std.Io.Writer.splatByteAll.
    for _ in 0..count {
        w.write_char(byte as char)?;
    }
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// std.json.encodeJsonString — single canonical port.
// Zig: vendor/zig/lib/std/json/Stringify.zig:670 (encodeJsonString →
// encodeJsonStringChars → outputSpecialEscape). Every Rust copy that was
// hand-ported from a Zig `std.json.fmt(...)` call funnels through here.
// ════════════════════════════════════════════════════════════════════════════

/// Port of Zig stdlib `std.json.encodeJsonStringChars` with default options
/// (`escape_unicode = false`): writes the escaped body of a JSON string
/// **without** surrounding quotes.
///
/// Escape set (matches `outputSpecialEscape` exactly):
///   - `\"` `\\` `\b` `\f` `\n` `\r` `\t`
///   - other `0x00..=0x1F` → `\u00XX` (lowercase hex)
///   - `0x20..=0xFF` → emitted verbatim in run-batched `write_str` calls
///     (input is treated as UTF-8/Latin-1 bytes; no transcoding).
pub fn encode_json_string_chars(w: &mut impl fmt::Write, s: &[u8]) -> fmt::Result {
    let mut run = 0;
    for (i, &b) in s.iter().enumerate() {
        let esc: &str = match b {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            0x08 => "\\b",
            0x0C => "\\f",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0x00..=0x1F => {
                if run < i {
                    write_bytes(w, &s[run..i])?;
                }
                let hex = hex_u16::<true>(b as u16);
                w.write_str("\\u")?;
                write_bytes(w, &hex)?;
                run = i + 1;
                continue;
            }
            _ => continue,
        };
        if run < i {
            write_bytes(w, &s[run..i])?;
        }
        w.write_str(esc)?;
        run = i + 1;
    }
    if run < s.len() {
        write_bytes(w, &s[run..])?;
    }
    Ok(())
}

/// Latin-1 sibling of [`encode_json_string_chars`]: same escape table, but
/// non-escaped bytes are widened (`b as char`) so 0x80..=0xFF are emitted as
/// their U+0080..U+00FF UTF-8 encodings rather than passed through as raw
/// (invalid) single bytes. ASCII runs are still batched via `write_bytes`.
pub fn encode_json_string_chars_latin1(w: &mut impl fmt::Write, s: &[u8]) -> fmt::Result {
    let mut run = 0;
    for (i, &b) in s.iter().enumerate() {
        let esc: &str = match b {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            0x08 => "\\b",
            0x0C => "\\f",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0x00..=0x1F => {
                if run < i {
                    write_bytes(w, &s[run..i])?;
                }
                let hex = hex_u16::<true>(b as u16);
                w.write_str("\\u")?;
                write_bytes(w, &hex)?;
                run = i + 1;
                continue;
            }
            0x80..=0xFF => {
                if run < i {
                    write_bytes(w, &s[run..i])?;
                }
                // Widen Latin-1 byte → Unicode scalar → UTF-8.
                w.write_char(b as char)?;
                run = i + 1;
                continue;
            }
            _ => continue,
        };
        if run < i {
            write_bytes(w, &s[run..i])?;
        }
        w.write_str(esc)?;
        run = i + 1;
    }
    if run < s.len() {
        write_bytes(w, &s[run..])?;
    }
    Ok(())
}

/// Port of Zig stdlib `std.json.encodeJsonString`: surrounding `"` quotes
/// around [`encode_json_string_chars`].
#[inline]
pub fn encode_json_string(w: &mut impl fmt::Write, s: &[u8]) -> fmt::Result {
    w.write_char('"')?;
    encode_json_string_chars(w, s)?;
    w.write_char('"')
}

// ported from: src/bun_core/fmt.zig
