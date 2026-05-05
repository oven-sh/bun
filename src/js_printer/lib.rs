//! JavaScript printer — translates the AST back to source text.
//! Port of src/js_printer/js_printer.zig.

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_str::strings;
use bun_str::strings::{CodepointIterator, Encoding};
use bun_logger as logger;
use bun_sourcemap as SourceMap;
use bun_options_types::{ImportRecord, ImportKind};
use bun_bundler::options;
use bun_bundler::analyze_transpiled_module;

use bun_js_parser as js_ast;
use bun_js_parser::{Ast, B, Binding, E, Expr, G, Ref, S, Stmt, Symbol, Op};
use bun_js_parser::Op::Level;
use bun_js_parser::js_lexer;
use bun_js_parser::runtime;
use bun_core::{Output, FeatureFlags, Environment};
use bun_core::schema::api;
use bun_core::MutableString;
use bun_sys::Fd;

pub mod renamer;
use renamer as rename;

const HEX_CHARS: &[u8; 16] = b"0123456789ABCDEF";
const FIRST_ASCII: u32 = 0x20;
const LAST_ASCII: u32 = 0x7E;
const FIRST_HIGH_SURROGATE: u32 = 0xD800;
const FIRST_LOW_SURROGATE: u32 = 0xDC00;
const LAST_LOW_SURROGATE: u32 = 0xDFFF;

/// For support JavaScriptCore
const ASCII_ONLY_ALWAYS_ON_UNLESS_MINIFYING: bool = true;

fn format_unsigned_integer_between<const LEN: usize>(buf: &mut [u8; LEN], val: u64) {
    let mut remainder = val;
    // Write out the number from the end to the front
    let mut i = LEN;
    while i > 0 {
        i -= 1;
        buf[i] = u8::try_from(remainder % 10).unwrap() + b'0';
        remainder /= 10;
    }
    // PERF(port): was comptime `inline while` unrolling — profile in Phase B
}

pub fn write_module_id(writer: &mut impl core::fmt::Write, module_id: u32) {
    debug_assert!(module_id != 0); // either module_id is forgotten or it should be disabled
    writer.write_str("$").expect("unreachable");
    write!(writer, "{:x}", module_id).expect("unreachable");
}

// PERF(port): was comptime monomorphization (`comptime CodePointType: type`) — Zig
// instantiated per code-unit type; Rust callers widen to i32 at the boundary. Profile in Phase B.
pub fn can_print_without_escape<const ASCII_ONLY: bool>(c: i32) -> bool {
    if c <= LAST_ASCII as i32 {
        c >= FIRST_ASCII as i32
            && c != b'\\' as i32
            && c != b'"' as i32
            && c != b'\'' as i32
            && c != b'`' as i32
            && c != b'$' as i32
    } else {
        !ASCII_ONLY
            && c != 0xFEFF
            && c != 0x2028
            && c != 0x2029
            && (c < FIRST_HIGH_SURROGATE as i32 || c > LAST_LOW_SURROGATE as i32)
    }
}

const INDENTATION_SPACE_BUF: [u8; 128] = [b' '; 128];
const INDENTATION_TAB_BUF: [u8; 128] = [b'\t'; 128];

pub fn best_quote_char_for_string<T>(str: &[T], allow_backtick: bool) -> u8
where
    T: Copy + Into<u32>,
{
    let mut single_cost: usize = 0;
    let mut double_cost: usize = 0;
    let mut backtick_cost: usize = 0;
    let mut i: usize = 0;
    while i < str.len().min(1024) {
        match str[i].into() {
            c if c == b'\'' as u32 => single_cost += 1,
            c if c == b'"' as u32 => double_cost += 1,
            c if c == b'`' as u32 => backtick_cost += 1,
            c if c == b'\n' as u32 => {
                single_cost += 1;
                double_cost += 1;
            }
            c if c == b'\\' as u32 => {
                i += 1;
            }
            c if c == b'$' as u32 => {
                if i + 1 < str.len() && str[i + 1].into() == b'{' as u32 {
                    backtick_cost += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }

    if allow_backtick && backtick_cost < single_cost.min(double_cost) {
        return b'`';
    }
    if single_cost < double_cost {
        return b'\'';
    }
    b'"'
}

#[derive(Clone, Copy)]
pub struct Whitespacer {
    pub normal: &'static [u8],
    pub minify: &'static [u8],
}

impl Whitespacer {
    // TODO(port): Zig `append` was comptime concatenation; in Rust, build callers via `ws!` macro instead.
    pub const fn append(self, _str: &'static [u8]) -> Whitespacer {
        // TODO(port): comptime string concat — use const_format::concatcp! at call sites
        self
    }
}

/// Compile-time helper: produce a `Whitespacer` whose `.minify` strips spaces.
// TODO(port): Zig computed `.minify` at comptime by stripping ' '. In Rust, use a
// `macro_rules! ws { ($s:literal) => { ... } }` backed by `const_format` in Phase B.
pub const fn ws(str: &'static [u8]) -> Whitespacer {
    Whitespacer { normal: str, minify: str /* TODO(port): strip spaces at compile time */ }
}

pub fn estimate_length_for_utf8<const ASCII_ONLY: bool, const QUOTE_CHAR: u8>(input: &[u8]) -> usize {
    let mut remaining = input;
    let mut len: usize = 2; // for quotes

    while let Some(i) = strings::index_of_needs_escape_for_javascript_string(remaining, QUOTE_CHAR) {
        len += i;
        remaining = &remaining[i..];
        let char_len = strings::wtf8_byte_sequence_length_with_invalid(remaining[0]);
        let bytes: [u8; 4] = match char_len {
            // 0 is not returned by `wtf8_byte_sequence_length_with_invalid`
            1 => [remaining[0], 0, 0, 0],
            2 => [remaining[0], remaining[1], 0, 0],
            3 => [remaining[0], remaining[1], remaining[2], 0],
            4 => [remaining[0], remaining[1], remaining[2], remaining[3]],
            _ => unreachable!(),
        };
        let c = strings::decode_wtf8_rune_t::<i32>(&bytes, char_len, 0);
        if can_print_without_escape::<ASCII_ONLY>(c) {
            len += char_len as usize;
        } else if c <= 0xFFFF {
            len += 6;
        } else {
            len += 12;
        }
        remaining = &remaining[char_len as usize..];
    }
    // Zig's `else` on `while` runs when the condition fails (i.e. `None`).
    if remaining.as_ptr() == input.as_ptr() {
        // PORT NOTE: reshaped — Zig returns `remaining.len + 2` when *no* escape was ever found.
        // The branch above already handled the loop body; falling out of the loop with no
        // iterations means "no escapes anywhere".
    }
    // TODO(port): the original `while ... else { return remaining.len + 2 }` returns early when
    // index_of_needs_escape returns null at the *first* check. The current shape returns `len`
    // (which equals 2) plus nothing for `remaining`. Match Zig precisely in Phase B.
    len + remaining.len()
}

pub fn write_pre_quoted_string<W, const QUOTE_CHAR: u8, const ASCII_ONLY: bool, const JSON: bool, const ENCODING: Encoding>(
    text_in: &[u8],
    writer: &mut W,
) -> Result<(), bun_core::Error>
where
    W: bun_io::Write,
{
    // TODO(port): for ENCODING == Utf16, Zig reinterprets `text_in` as []const u16 via bytesAsSlice.
    // In Rust we keep `text_in: &[u8]` and index by code-unit width below.
    const _: () = assert!(!(JSON && QUOTE_CHAR != b'"'), "for json, quote_char must be '\"'");

    // PORT NOTE: this is a large hot-path function; logic is ported 1:1 but the
    // utf16 path needs &[u16] handling in Phase B.
    let text = text_in;
    let mut i: usize = 0;
    let n: usize = match ENCODING {
        Encoding::Utf16 => text.len() / 2,
        _ => text.len(),
    };

    macro_rules! code_unit_at {
        ($idx:expr) => {
            match ENCODING {
                Encoding::Utf16 => {
                    let lo = text[$idx * 2];
                    let hi = text[$idx * 2 + 1];
                    u16::from_le_bytes([lo, hi]) as i32
                }
                _ => text[$idx] as i32,
            }
        };
    }

    while i < n {
        let width: u8 = match ENCODING {
            Encoding::Latin1 | Encoding::Ascii => 1,
            Encoding::Utf8 => strings::wtf8_byte_sequence_length_with_invalid(text[i]),
            Encoding::Utf16 => 1,
        };
        let clamped_width = (width as usize).min(n.saturating_sub(i));
        let c: i32 = match ENCODING {
            Encoding::Utf8 => {
                let bytes: [u8; 4] = match clamped_width {
                    1 => [text[i], 0, 0, 0],
                    2 => [text[i], text[i + 1], 0, 0],
                    3 => [text[i], text[i + 1], text[i + 2], 0],
                    4 => [text[i], text[i + 1], text[i + 2], text[i + 3]],
                    _ => unreachable!(),
                };
                strings::decode_wtf8_rune_t::<i32>(&bytes, width, 0)
            }
            Encoding::Ascii => {
                debug_assert!(text[i] <= 0x7F);
                text[i] as i32
            }
            Encoding::Latin1 => text[i] as i32,
            Encoding::Utf16 => {
                // TODO: if this is a part of a surrogate pair, we could parse the whole codepoint in order
                // to emit it as a single \u{result} rather than two paired \uLOW\uHIGH.
                // eg: "\u{10334}" will convert to "𐌴" without this.
                code_unit_at!(i)
            }
        };

        if can_print_without_escape::<ASCII_ONLY>(c) {
            match ENCODING {
                Encoding::Ascii | Encoding::Utf8 => {
                    let remain = &text[i + clamped_width..];
                    if let Some(j) = strings::index_of_needs_escape_for_javascript_string(remain, QUOTE_CHAR) {
                        let text_chunk = &text[i..i + clamped_width];
                        writer.write_all(text_chunk)?;
                        i += clamped_width;
                        writer.write_all(&remain[..j])?;
                        i += j;
                    } else {
                        writer.write_all(&text[i..])?;
                        i = n;
                        break;
                    }
                }
                Encoding::Latin1 | Encoding::Utf16 => {
                    let mut codepoint_bytes = [0u8; 4];
                    let codepoint_len = strings::encode_wtf8_rune(&mut codepoint_bytes, c);
                    writer.write_all(&codepoint_bytes[..codepoint_len])?;
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
                if QUOTE_CHAR == b'`' { writer.write_all(b"\n")?; } else { writer.write_all(b"\\n")?; }
                i += 1;
            }
            0x0D => { writer.write_all(b"\\r")?; i += 1; }
            // \v
            0x0B => { writer.write_all(b"\\v")?; i += 1; }
            // "\\"
            0x5C => { writer.write_all(b"\\\\")?; i += 1; }
            0x22 => {
                if QUOTE_CHAR == b'"' { writer.write_all(b"\\\"")?; } else { writer.write_all(b"\"")?; }
                i += 1;
            }
            0x27 => {
                if QUOTE_CHAR == b'\'' { writer.write_all(b"\\'")?; } else { writer.write_all(b"'")?; }
                i += 1;
            }
            0x60 => {
                if QUOTE_CHAR == b'`' { writer.write_all(b"\\`")?; } else { writer.write_all(b"`")?; }
                i += 1;
            }
            0x24 => {
                if QUOTE_CHAR == b'`' {
                    let next = if i + clamped_width < n { Some(code_unit_at!(i + clamped_width)) } else { None };
                    if next == Some(b'{' as i32) {
                        writer.write_all(b"\\$")?;
                    } else {
                        writer.write_all(b"$")?;
                    }
                } else {
                    writer.write_all(b"$")?;
                }
                i += 1;
            }
            0x09 => {
                if QUOTE_CHAR == b'`' { writer.write_all(b"\t")?; } else { writer.write_all(b"\\t")?; }
                i += 1;
            }
            _ => {
                i += width as usize;

                if c <= 0xFF && !JSON {
                    let k = usize::try_from(c).unwrap();
                    writer.write_all(&[b'\\', b'x', HEX_CHARS[(k >> 4) & 0xF], HEX_CHARS[k & 0xF]])?;
                } else if c <= 0xFFFF {
                    let k = usize::try_from(c).unwrap();
                    writer.write_all(&[
                        b'\\', b'u',
                        HEX_CHARS[(k >> 12) & 0xF],
                        HEX_CHARS[(k >> 8) & 0xF],
                        HEX_CHARS[(k >> 4) & 0xF],
                        HEX_CHARS[k & 0xF],
                    ])?;
                } else {
                    let k = usize::try_from(c - 0x10000).unwrap();
                    let lo = usize::from(FIRST_HIGH_SURROGATE) + ((k >> 10) & 0x3FF);
                    let hi = usize::from(FIRST_LOW_SURROGATE) + (k & 0x3FF);
                    writer.write_all(&[
                        b'\\', b'u',
                        HEX_CHARS[lo >> 12], HEX_CHARS[(lo >> 8) & 15], HEX_CHARS[(lo >> 4) & 15], HEX_CHARS[lo & 15],
                        b'\\', b'u',
                        HEX_CHARS[hi >> 12], HEX_CHARS[(hi >> 8) & 15], HEX_CHARS[(hi >> 4) & 15], HEX_CHARS[hi & 15],
                    ])?;
                }
            }
        }
    }
    Ok(())
}

pub fn quote_for_json<const ASCII_ONLY: bool>(text: &[u8], bytes: &mut MutableString) -> Result<(), bun_core::Error> {
    bytes.grow_if_needed(estimate_length_for_utf8::<ASCII_ONLY, b'"'>(text))?;
    bytes.append_char(b'"')?;
    write_pre_quoted_string::<_, b'"', ASCII_ONLY, true, { Encoding::Utf8 }>(text, &mut bytes.writer())?;
    bytes.append_char(b'"').expect("unreachable");
    Ok(())
}

pub fn write_json_string<W: bun_io::Write, const ENCODING: Encoding>(input: &[u8], writer: &mut W) -> Result<(), bun_core::Error> {
    writer.write_all(b"\"")?;
    write_pre_quoted_string::<_, b'"', false, true, ENCODING>(input, writer)?;
    writer.write_all(b"\"")?;
    Ok(())
}

// ───────────────────────────────────────────────────────────────────────────
// SourceMapHandler
// ───────────────────────────────────────────────────────────────────────────

pub struct SourceMapHandler<'a> {
    pub ctx: &'a mut (),
    pub callback: fn(*mut (), SourceMap::Chunk, &logger::Source) -> Result<(), bun_core::Error>,
}

impl<'a> SourceMapHandler<'a> {
    pub fn on_source_map_chunk(&self, chunk: SourceMap::Chunk, source: &logger::Source) -> Result<(), bun_core::Error> {
        (self.callback)(self.ctx as *const _ as *mut (), chunk, source)
    }

    pub fn for_<T>(
        ctx: &'a mut T,
        handler: fn(&mut T, SourceMap::Chunk, &logger::Source) -> Result<(), bun_core::Error>,
    ) -> SourceMapHandler<'a> {
        // SAFETY: type-erased borrow; `on_chunk` casts back to `*mut T` before calling `handler`.
        unsafe extern "Rust" fn on_chunk<T>(
            this: *mut (),
            chunk: SourceMap::Chunk,
            source: &logger::Source,
        ) -> Result<(), bun_core::Error> {
            // TODO(port): proc-macro — Zig used a comptime fn-type generator (`For`) to monomorphize.
            unreachable!()
        }
        let _ = handler;
        // TODO(port): store `handler` in a thunk; needs trait or Box<dyn>. Phase B.
        SourceMapHandler {
            // SAFETY: `ctx` is a live `&mut T` type-erased to `*mut ()`; the callback
            // casts back to `*mut T` before use and outlives this handler by construction.
            ctx: unsafe { &mut *(ctx as *mut T as *mut ()) },
            callback: |_, _, _| Ok(()),
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Options
// ───────────────────────────────────────────────────────────────────────────

pub struct Options<'a> {
    pub bundling: bool,
    pub transform_imports: bool,
    pub to_commonjs_ref: Ref,
    pub to_esm_ref: Ref,
    pub require_ref: Option<Ref>,
    pub import_meta_ref: Ref,
    pub hmr_ref: Ref,
    pub indent: Indentation,
    pub runtime_imports: runtime::Runtime::Imports,
    pub module_hash: u32,
    pub source_path: Option<fs::Path>,
    // allocator: dropped — global mimalloc (this is an AST crate but Options.allocator is the global default)
    // TODO(port): source_map_allocator was Option<Allocator>; arena-backed in some callers
    pub source_map_handler: Option<SourceMapHandler<'a>>,
    pub source_map_builder: Option<&'a mut SourceMap::Chunk::Builder>,
    pub css_import_behavior: api::CssInJsBehavior,
    pub target: options::Target,

    pub runtime_transpiler_cache: Option<&'a mut bun_jsc::RuntimeTranspilerCache>,
    pub module_info: Option<&'a mut analyze_transpiled_module::ModuleInfo>,
    pub input_files_for_dev_server: Option<&'a [logger::Source]>,

    pub commonjs_named_exports: js_ast::Ast::CommonJSNamedExports,
    pub commonjs_named_exports_deoptimized: bool,
    pub commonjs_module_exports_assigned_deoptimized: bool,
    pub commonjs_named_exports_ref: Ref,
    pub commonjs_module_ref: Ref,

    pub minify_whitespace: bool,
    pub minify_identifiers: bool,
    pub minify_syntax: bool,
    pub print_dce_annotations: bool,

    pub transform_only: bool,
    pub inline_require_and_import_errors: bool,
    pub has_run_symbol_renamer: bool,

    pub require_or_import_meta_for_source_callback: RequireOrImportMetaCallback,

    /// The module type of the importing file (after linking), used to determine interop helper behavior.
    /// Controls whether __toESM uses Node ESM semantics (isNodeMode=1 for .esm) or respects __esModule markers.
    pub input_module_type: options::ModuleType,
    pub module_type: options::Format,

    // /// Used for cross-module inlining of import items when bundling
    // const_values: Ast.ConstValuesMap = .{},
    pub ts_enums: Ast::TsEnumsMap,

    // If we're writing out a source map, this table of line start indices lets
    // us do binary search on to figure out what line a given AST node came from
    pub line_offset_tables: Option<SourceMap::LineOffsetTable::List>,

    pub mangled_props: Option<&'a bun_bundler::MangledProps>,
}

// Default indentation is 2 spaces
#[derive(Clone, Copy)]
pub struct Indentation {
    pub scalar: usize,
    pub count: usize,
    pub character: IndentationCharacter,
}

impl Default for Indentation {
    fn default() -> Self {
        Self { scalar: 2, count: 0, character: IndentationCharacter::Space }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IndentationCharacter { Tab, Space }

impl<'a> Options<'a> {
    pub fn require_or_import_meta_for_source(&self, id: u32, was_unwrapped_require: bool) -> RequireOrImportMeta {
        if self.require_or_import_meta_for_source_callback.ctx.is_none() {
            return RequireOrImportMeta::default();
        }
        self.require_or_import_meta_for_source_callback.call(id, was_unwrapped_require)
    }
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        Self {
            bundling: false,
            transform_imports: true,
            to_commonjs_ref: Ref::NONE,
            to_esm_ref: Ref::NONE,
            require_ref: None,
            import_meta_ref: Ref::NONE,
            hmr_ref: Ref::NONE,
            indent: Indentation::default(),
            runtime_imports: runtime::Runtime::Imports::default(),
            module_hash: 0,
            source_path: None,
            source_map_handler: None,
            source_map_builder: None,
            css_import_behavior: api::CssInJsBehavior::Facade,
            target: options::Target::Browser,
            runtime_transpiler_cache: None,
            module_info: None,
            input_files_for_dev_server: None,
            commonjs_named_exports: Default::default(),
            commonjs_named_exports_deoptimized: false,
            commonjs_module_exports_assigned_deoptimized: false,
            commonjs_named_exports_ref: Ref::NONE,
            commonjs_module_ref: Ref::NONE,
            minify_whitespace: false,
            minify_identifiers: false,
            minify_syntax: false,
            print_dce_annotations: true,
            transform_only: false,
            inline_require_and_import_errors: true,
            has_run_symbol_renamer: false,
            require_or_import_meta_for_source_callback: RequireOrImportMetaCallback::default(),
            input_module_type: options::ModuleType::Unknown,
            module_type: options::Format::Esm,
            ts_enums: Default::default(),
            line_offset_tables: None,
            mangled_props: None,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// RequireOrImportMeta
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct RequireOrImportMeta {
    // CommonJS files will return the "require_*" wrapper function and an invalid
    // exports object reference. Lazily-initialized ESM files will return the
    // "init_*" wrapper function and the exports object for that file.
    pub wrapper_ref: Ref,
    pub exports_ref: Ref,
    pub is_wrapper_async: bool,
    pub was_unwrapped_require: bool,
}

#[derive(Clone, Copy)]
pub struct RequireOrImportMetaCallback {
    pub ctx: Option<NonNull<()>>,
    pub callback: fn(*mut (), u32, bool) -> RequireOrImportMeta,
}

impl Default for RequireOrImportMetaCallback {
    fn default() -> Self {
        fn noop(_: *mut (), _: u32, _: bool) -> RequireOrImportMeta { RequireOrImportMeta::default() }
        Self { ctx: None, callback: noop }
    }
}

impl RequireOrImportMetaCallback {
    pub fn call(&self, id: u32, was_unwrapped_require: bool) -> RequireOrImportMeta {
        (self.callback)(self.ctx.unwrap().as_ptr(), id, was_unwrapped_require)
    }

    pub fn init<T>(
        ctx: &mut T,
        callback: fn(&mut T, u32, bool) -> RequireOrImportMeta,
    ) -> Self {
        // TODO(port): proc-macro — Zig monomorphized `callback` at comptime via @ptrCast.
        let _ = callback;
        Self {
            // SAFETY: `ctx` is `&mut T` so the pointer is non-null; type-erased to `*mut ()`
            // and cast back to `*mut T` inside the thunk before dereference.
            ctx: Some(unsafe { NonNull::new_unchecked(ctx as *mut T as *mut ()) }),
            callback: |_, _, _| RequireOrImportMeta::default(), // TODO(port): wire thunk
        }
    }
}

fn is_identifier_or_numeric_constant_or_property_access(expr: &Expr) -> bool {
    match &expr.data {
        Expr::Data::EIdentifier(_) | Expr::Data::EDot(_) | Expr::Data::EIndex(_) => true,
        Expr::Data::ENumber(e) => e.value.is_infinite() || e.value.is_nan(),
        _ => false,
    }
}

pub enum PrintResult {
    Result(PrintResultSuccess),
    Err(bun_core::Error),
}

pub struct PrintResultSuccess {
    pub code: Box<[u8]>,
    pub source_map: Option<SourceMap::Chunk>,
}

// do not make this a packed struct
// stage1 compiler bug:
// > /optional-chain-with-function.js: Evaluation failed: TypeError: (intermediate value) is not a function
// this test failure was caused by the packed struct implementation
#[derive(Clone, Copy, PartialEq, Eq, enumset::EnumSetType)]
pub enum ExprFlag {
    ForbidCall,
    ForbidIn,
    HasNonOptionalChainParent,
    ExprResultIsUnused,
}

pub type ExprFlagSet = enumset::EnumSet<ExprFlag>;

impl ExprFlag {
    #[inline] pub fn none() -> ExprFlagSet { ExprFlagSet::empty() }
    #[inline] pub fn forbid_call() -> ExprFlagSet { ExprFlag::ForbidCall.into() }
    // PORT NOTE: Zig had `ForbidAnd` referencing `.forbid_and` which doesn't exist in the enum — dead code.
    #[inline] pub fn has_non_optional_chain_parent() -> ExprFlagSet { ExprFlag::HasNonOptionalChainParent.into() }
    #[inline] pub fn expr_result_is_unused() -> ExprFlagSet { ExprFlag::ExprResultIsUnused.into() }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ImportVariant {
    PathOnly,
    ImportStar,
    ImportDefault,
    ImportStarAndImportDefault,
    ImportItems,
    ImportItemsAndDefault,
    ImportItemsAndStar,
    ImportItemsAndDefaultAndStar,
}

impl ImportVariant {
    #[inline]
    pub fn has_items(self) -> Self {
        match self {
            Self::ImportDefault => Self::ImportItemsAndDefault,
            Self::ImportStar => Self::ImportItemsAndStar,
            Self::ImportStarAndImportDefault => Self::ImportItemsAndDefaultAndStar,
            _ => Self::ImportItems,
        }
    }

    // We always check star first so don't need to be exhaustive here
    #[inline]
    pub fn has_star(self) -> Self {
        match self {
            Self::PathOnly => Self::ImportStar,
            _ => self,
        }
    }

    // We check default after star
    #[inline]
    pub fn has_default(self) -> Self {
        match self {
            Self::PathOnly => Self::ImportDefault,
            Self::ImportStar => Self::ImportStarAndImportDefault,
            _ => self,
        }
    }

    pub fn determine(record: &ImportRecord, s_import: &S::Import) -> ImportVariant {
        let mut variant = ImportVariant::PathOnly;

        if record.flags.contains_import_star {
            variant = variant.has_star();
        }

        if !record.flags.was_originally_bare_import {
            if !record.flags.contains_default_alias {
                if let Some(default_name) = &s_import.default_name {
                    if default_name.ref_.is_some() {
                        variant = variant.has_default();
                    }
                }
            } else {
                variant = variant.has_default();
            }
        }

        if s_import.items.len() > 0 {
            variant = variant.has_items();
        }

        variant
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ClauseItemAs { Import, Var, Export, ExportFrom }

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IsTopLevel { Yes, VarOnly, No }

// ───────────────────────────────────────────────────────────────────────────
// Printer (NewPrinter)
// ───────────────────────────────────────────────────────────────────────────

/// `fn NewPrinter(...) type` → generic struct.
pub struct Printer<
    'a,
    W,
    const ASCII_ONLY: bool,
    const REWRITE_ESM_TO_CJS: bool,
    const IS_BUN_PLATFORM: bool,
    const IS_JSON: bool,
    const GENERATE_SOURCE_MAP: bool,
> {
    pub import_records: &'a [ImportRecord],

    pub needs_semicolon: bool,
    pub stmt_start: i32,
    pub options: Options<'a>,
    pub export_default_start: i32,
    pub arrow_expr_start: i32,
    pub for_of_init_start: i32,
    pub prev_op: Op::Code,
    pub prev_op_end: i32,
    pub prev_num_end: i32,
    pub prev_reg_exp_end: i32,
    pub call_target: Option<Expr::Data>,
    pub writer: W,

    pub has_printed_bundled_import_statement: bool,

    pub renamer: rename::Renamer,
    pub prev_stmt_tag: Stmt::Tag,
    pub source_map_builder: SourceMap::Chunk::Builder,

    pub symbol_counter: u32,

    pub temporary_bindings: Vec<B::Property>,

    pub binary_expression_stack: Vec<BinaryExpressionVisitor<'a>>,

    pub was_lazy_export: bool,
    // PORT NOTE: Zig used `if (!may_have_module_info) void else ?*ModuleInfo` — in Rust we always
    // carry the Option and gate at call sites with MAY_HAVE_MODULE_INFO.
    pub module_info: Option<&'a mut analyze_transpiled_module::ModuleInfo>,
}

/// `MAY_HAVE_MODULE_INFO = IS_BUN_PLATFORM && !REWRITE_ESM_TO_CJS`
// TODO(port): const-generic associated const — written as a free fn until adt_const_params lands.
#[inline(always)]
const fn may_have_module_info(is_bun_platform: bool, rewrite_esm_to_cjs: bool) -> bool {
    is_bun_platform && !rewrite_esm_to_cjs
}

// PORT NOTE: Zig defined `TopLevelAndIsExport`/`TopLevel` as conditional zero-size structs when
// !may_have_module_info. In Rust we use one shape; dead-code elimination removes the unused
// fields when MAY_HAVE_MODULE_INFO is false.
#[derive(Clone, Copy, Default)]
pub struct TopLevelAndIsExport {
    pub is_export: bool,
    pub is_top_level: Option<analyze_transpiled_module::ModuleInfo::VarKind>,
}

#[derive(Clone, Copy)]
pub struct TopLevel {
    pub is_top_level: IsTopLevel,
}

impl TopLevel {
    #[inline] pub fn init(is_top_level: IsTopLevel) -> Self { Self { is_top_level } }
    pub fn sub_var(self) -> Self {
        if self.is_top_level == IsTopLevel::No { return Self::init(IsTopLevel::No); }
        Self::init(IsTopLevel::VarOnly)
    }
    #[inline] pub fn is_top_level(self) -> bool { self.is_top_level != IsTopLevel::No }
}

/// The handling of binary expressions is convoluted because we're using
/// iteration on the heap instead of recursion on the call stack to avoid
/// stack overflow for deeply-nested ASTs. See the comments for the similar
/// code in the JavaScript parser for details.
pub struct BinaryExpressionVisitor<'ast> {
    // Inputs
    pub e: &'ast E::Binary,
    pub level: Level,
    pub flags: ExprFlagSet,

    // Input for visiting the left child
    pub left_level: Level,
    pub left_flags: ExprFlagSet,

    // "Local variables" passed from "checkAndPrepare" to "visitRightAndFinish"
    pub entry: &'static Op,
    pub wrap: bool,
    pub right_level: Level,
}

impl<'ast> Default for BinaryExpressionVisitor<'ast> {
    fn default() -> Self {
        // TODO(port): `entry` defaulted to `undefined` in Zig; we need a sentinel &'static Op.
        unreachable!("construct via fields")
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Printer methods
// ───────────────────────────────────────────────────────────────────────────

impl<'a, W, const ASCII_ONLY: bool, const REWRITE_ESM_TO_CJS: bool, const IS_BUN_PLATFORM: bool, const IS_JSON: bool, const GENERATE_SOURCE_MAP: bool>
    Printer<'a, W, ASCII_ONLY, REWRITE_ESM_TO_CJS, IS_BUN_PLATFORM, IS_JSON, GENERATE_SOURCE_MAP>
where
    W: WriterTrait,
{
    pub const MAY_HAVE_MODULE_INFO: bool = IS_BUN_PLATFORM && !REWRITE_ESM_TO_CJS;

    /// When Printer is used as a io.Writer, this represents it's error type, aka nothing.
    pub type Error = core::convert::Infallible;

    #[inline]
    fn module_info(&mut self) -> Option<&mut analyze_transpiled_module::ModuleInfo> {
        if !Self::MAY_HAVE_MODULE_INFO { return None; }
        self.module_info.as_deref_mut()
    }

    // BinaryExpressionVisitor::checkAndPrepare
    fn binary_check_and_prepare(&mut self, v: &mut BinaryExpressionVisitor<'a>) -> bool {
        let e = v.e;

        let entry: &'static Op = Op::TABLE.get_ptr_const(e.op);
        let e_level = entry.level;
        v.entry = entry;
        v.wrap = v.level.gte(e_level) || (e.op == Op::Code::BinIn && v.flags.contains(ExprFlag::ForbidIn));

        // Destructuring assignments must be parenthesized
        let n = self.writer.written();
        if n == self.stmt_start || n == self.arrow_expr_start {
            if let Expr::Data::EObject(_) = e.left.data {
                v.wrap = true;
            }
        }

        if v.wrap {
            self.print(b"(");
            v.flags.insert(ExprFlag::ForbidIn);
        }

        v.left_level = e_level.sub(1);
        v.right_level = e_level.sub(1);

        if e.op.is_right_associative() {
            v.left_level = e_level;
        }

        if e.op.is_left_associative() {
            v.right_level = e_level;
        }

        match e.op {
            // "??" can't directly contain "||" or "&&" without being wrapped in parentheses
            Op::Code::BinNullishCoalescing => {
                if let Expr::Data::EBinary(left) = &e.left.data {
                    if matches!(left.op, Op::Code::BinLogicalAnd | Op::Code::BinLogicalOr) {
                        v.left_level = Level::Prefix;
                    }
                }
                if let Expr::Data::EBinary(right) = &e.right.data {
                    if matches!(right.op, Op::Code::BinLogicalAnd | Op::Code::BinLogicalOr) {
                        v.right_level = Level::Prefix;
                    }
                }
            }
            // "**" can't contain certain unary expressions
            Op::Code::BinPow => {
                match &e.left.data {
                    Expr::Data::EUnary(left) => {
                        if left.op.unary_assign_target() == Op::AssignTarget::None {
                            v.left_level = Level::Call;
                        }
                    }
                    Expr::Data::EAwait(_) | Expr::Data::EUndefined | Expr::Data::ENumber(_) => {
                        v.left_level = Level::Call;
                    }
                    Expr::Data::EBoolean(_) | Expr::Data::EBranchBoolean(_) => {
                        // When minifying, booleans are printed as "!0 and "!1"
                        if self.options.minify_syntax {
                            v.left_level = Level::Call;
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }

        // Special-case "#foo in bar"
        if matches!(e.left.data, Expr::Data::EPrivateIdentifier(_)) && e.op == Op::Code::BinIn {
            let private = match &e.left.data { Expr::Data::EPrivateIdentifier(p) => p, _ => unreachable!() };
            let name = self.renamer.name_for_symbol(private.ref_);
            self.add_source_mapping_for_name(e.left.loc, name, private.ref_);
            self.print_identifier(name);
            self.binary_visit_right_and_finish(v);
            return false;
        }

        v.left_flags = ExprFlagSet::empty();

        if v.flags.contains(ExprFlag::ForbidIn) {
            v.left_flags.insert(ExprFlag::ForbidIn);
        }

        if e.op == Op::Code::BinComma {
            v.left_flags.insert(ExprFlag::ExprResultIsUnused);
        }

        true
    }

    // BinaryExpressionVisitor::visitRightAndFinish
    fn binary_visit_right_and_finish(&mut self, v: &BinaryExpressionVisitor<'a>) {
        let e = v.e;
        let entry = v.entry;
        let mut flags = ExprFlagSet::empty();

        if e.op != Op::Code::BinComma {
            self.print_space();
        }

        if entry.is_keyword {
            self.print_space_before_identifier();
            self.print(entry.text);
        } else {
            self.print_space_before_operator(e.op);
            self.print(entry.text);
            self.prev_op = e.op;
            self.prev_op_end = self.writer.written();
        }

        self.print_space();

        // The result of the right operand of the comma operator is unused if the caller doesn't use it
        if e.op == Op::Code::BinComma && v.flags.contains(ExprFlag::ExprResultIsUnused) {
            flags.insert(ExprFlag::ExprResultIsUnused);
        }

        if v.flags.contains(ExprFlag::ForbidIn) {
            flags.insert(ExprFlag::ForbidIn);
        }

        self.print_expr(e.right, v.right_level, flags);

        if v.wrap {
            self.print(b")");
        }
    }

    pub fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        self.print(bytes);
        Ok(())
    }

    pub fn write_byte_n_times(&mut self, byte: u8, n: usize) -> Result<(), bun_core::Error> {
        let bytes = [byte; 256];
        let mut remaining = n;
        while remaining > 0 {
            let to_write = remaining.min(bytes.len());
            self.write_all(&bytes[..to_write])?;
            remaining -= to_write;
        }
        Ok(())
    }

    pub fn write_bytes_n_times(&mut self, bytes: &[u8], n: usize) -> Result<(), bun_core::Error> {
        for _ in 0..n {
            self.write_all(bytes)?;
        }
        Ok(())
    }

    fn fmt(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), bun_core::Error> {
        // PERF(port): Zig used std.fmt.count + bufPrint into reserved space (no heap).
        // TODO(port): implement `count` over fmt::Arguments to match.
        use std::io::Write as _;
        let mut buf: Vec<u8> = Vec::new();
        write!(&mut buf, "{}", args).expect("unreachable");
        let ptr = self.writer.reserve(buf.len() as u64)?;
        // SAFETY: writer reserved buf.len() bytes
        unsafe { core::ptr::copy_nonoverlapping(buf.as_ptr(), ptr, buf.len()); }
        self.writer.advance(buf.len() as u64);
        Ok(())
    }

    pub fn print_buffer(&mut self, str: &[u8]) {
        self.writer.print_slice(str);
    }

    /// Polymorphic print: bytes or single char.
    pub fn print(&mut self, str: impl PrintArg) {
        str.print_into(&mut self.writer);
    }

    #[inline] pub fn unindent(&mut self) { self.options.indent.count = self.options.indent.count.saturating_sub(1); }
    #[inline] pub fn indent(&mut self) { self.options.indent.count += 1; }

    pub fn print_indent(&mut self) {
        if self.options.indent.count == 0 || self.options.minify_whitespace {
            return;
        }

        let indentation_buf: &[u8; 128] = match self.options.indent.character {
            IndentationCharacter::Space => &INDENTATION_SPACE_BUF,
            IndentationCharacter::Tab => &INDENTATION_TAB_BUF,
        };

        let mut i: usize = self.options.indent.count * self.options.indent.scalar;

        while i > 0 {
            let amt = i.min(indentation_buf.len());
            self.print(&indentation_buf[..amt]);
            i -= amt;
        }
    }

    pub fn mangled_prop_name(&self, ref_: Ref) -> &[u8] {
        let ref_ = self.symbols().follow(ref_);
        // TODO: we don't support that
        if let Some(mangled_props) = self.options.mangled_props {
            if let Some(name) = mangled_props.get(ref_) { return name; }
        }
        self.renamer.name_for_symbol(ref_)
    }

    #[inline] pub fn print_space(&mut self) { if !self.options.minify_whitespace { self.print(b" "); } }
    #[inline] pub fn print_newline(&mut self) { if !self.options.minify_whitespace { self.print(b"\n"); } }
    #[inline] pub fn print_semicolon_after_statement(&mut self) {
        if !self.options.minify_whitespace { self.print(b";\n"); } else { self.needs_semicolon = true; }
    }
    pub fn print_semicolon_if_needed(&mut self) {
        if self.needs_semicolon {
            self.print(b";");
            self.needs_semicolon = false;
        }
    }

    fn print_equals(&mut self) {
        if self.options.minify_whitespace { self.print(b"="); } else { self.print(b" = "); }
    }

    fn print_global_bun_import_statement(&mut self, import: S::Import) {
        if !IS_BUN_PLATFORM { unreachable!(); }
        self.print_internal_bun_import(import, Some(b"globalThis.Bun"));
    }

    fn print_internal_bun_import(&mut self, import: S::Import, statement: Option<&'static [u8]>) {
        if !IS_BUN_PLATFORM { unreachable!(); }

        if import.star_name_loc.is_some() {
            self.print(b"var ");
            self.print_symbol(import.namespace_ref);
            self.print_space();
            self.print(b"=");
            self.print_space_before_identifier();
            match statement {
                None => self.print_require_or_import_expr(
                    import.import_record_index, false, &[], Expr::EMPTY, Level::Lowest, ExprFlag::none(),
                ),
                Some(s) => self.print(s),
            }
            self.print_semicolon_after_statement();
            self.print_indent();
        }

        if let Some(default) = &import.default_name {
            self.print_semicolon_if_needed();
            self.print(b"var ");
            self.print_symbol(default.ref_.unwrap());
            match statement {
                None => {
                    self.print_equals();
                    self.print_require_or_import_expr(
                        import.import_record_index, false, &[], Expr::EMPTY, Level::Lowest, ExprFlag::none(),
                    );
                }
                Some(s) => {
                    self.print_equals();
                    self.print(s);
                }
            }
            self.print_semicolon_after_statement();
        }

        if import.items.len() > 0 {
            self.print_semicolon_if_needed();
            self.print_whitespacer(ws(b"var {"));

            if !import.is_single_line {
                self.print_newline();
                self.indent();
                self.print_indent();
            }

            for (i, item) in import.items.iter().enumerate() {
                if i > 0 {
                    self.print(b",");
                    self.print_space();
                    if !import.is_single_line {
                        self.print_newline();
                        self.print_indent();
                    }
                }
                self.print_clause_item_as(*item, ClauseItemAs::Var);
            }

            if !import.is_single_line {
                self.print_newline();
                self.unindent();
            } else {
                self.print_space();
            }

            self.print_whitespacer(ws(b"} = "));

            if import.star_name_loc.is_none() && import.default_name.is_none() {
                match statement {
                    None => self.print_require_or_import_expr(import.import_record_index, false, &[], Expr::EMPTY, Level::Lowest, ExprFlag::none()),
                    Some(s) => self.print(s),
                }
            } else if let Some(name) = &import.default_name {
                self.print_symbol(name.ref_.unwrap());
            } else {
                self.print_symbol(import.namespace_ref);
            }

            self.print_semicolon_after_statement();
        }

        // Record var declarations for module_info. printGlobalBunImportStatement
        // bypasses printDeclStmt/printBinding, so we must record vars explicitly.
        if Self::MAY_HAVE_MODULE_INFO {
            if let Some(mi) = self.module_info() {
                if import.star_name_loc.is_some() {
                    let name = self.renamer.name_for_symbol(import.namespace_ref);
                    mi.add_var(mi.str(name), analyze_transpiled_module::ModuleInfo::VarKind::Declared);
                }
                if let Some(default) = &import.default_name {
                    let name = self.renamer.name_for_symbol(default.ref_.unwrap());
                    mi.add_var(mi.str(name), analyze_transpiled_module::ModuleInfo::VarKind::Declared);
                }
                for item in import.items.iter() {
                    let name = self.renamer.name_for_symbol(item.name.ref_.unwrap());
                    mi.add_var(mi.str(name), analyze_transpiled_module::ModuleInfo::VarKind::Declared);
                }
            }
        }
    }

    #[inline]
    pub fn print_space_before_identifier(&mut self) {
        if self.writer.written() > 0
            && (js_lexer::is_identifier_continue(self.writer.prev_char() as i32)
                || self.writer.written() == self.prev_reg_exp_end)
        {
            self.print(b" ");
        }
    }

    #[inline]
    pub fn maybe_print_space(&mut self) {
        match self.writer.prev_char() {
            0 | b' ' | b'\n' => {}
            _ => self.print(b" "),
        }
    }

    pub fn print_dot_then_prefix(&mut self) -> Level {
        self.print(b".then(() => ");
        Level::Comma
    }

    #[inline]
    pub fn print_undefined(&mut self, loc: logger::Loc, level: Level) {
        if self.options.minify_syntax {
            if level.gte(Level::Prefix) {
                self.add_source_mapping(loc);
                self.print(b"(void 0)");
            } else {
                self.print_space_before_identifier();
                self.add_source_mapping(loc);
                self.print(b"void 0");
            }
        } else {
            self.print_space_before_identifier();
            self.add_source_mapping(loc);
            self.print(b"undefined");
        }
    }

    pub fn print_body(&mut self, stmt: Stmt, tlmtlo: TopLevel) {
        match &stmt.data {
            Stmt::Data::SBlock(block) => {
                self.print_space();
                self.print_block(stmt.loc, &block.stmts, block.close_brace_loc, tlmtlo);
                self.print_newline();
            }
            _ => {
                self.print_newline();
                self.indent();
                self.print_stmt(stmt, tlmtlo).expect("unreachable");
                self.unindent();
            }
        }
    }

    pub fn print_block_body(&mut self, stmts: &[Stmt], tlmtlo: TopLevel) {
        for stmt in stmts {
            self.print_semicolon_if_needed();
            self.print_stmt(*stmt, tlmtlo).expect("unreachable");
        }
    }

    pub fn print_block(&mut self, loc: logger::Loc, stmts: &[Stmt], close_brace_loc: Option<logger::Loc>, tlmtlo: TopLevel) {
        self.add_source_mapping(loc);
        self.print(b"{");
        if !stmts.is_empty() {
            // @branchHint(.likely)
            self.print_newline();
            self.indent();
            self.print_block_body(stmts, tlmtlo);
            self.unindent();
            self.print_indent();
        }
        if let Some(cbl) = close_brace_loc {
            if cbl.start > loc.start {
                self.add_source_mapping(cbl);
            }
        }
        self.print(b"}");
        self.needs_semicolon = false;
    }

    pub fn print_two_blocks_in_one(&mut self, loc: logger::Loc, stmts: &[Stmt], prepend: &[Stmt]) {
        self.add_source_mapping(loc);
        self.print(b"{");
        self.print_newline();

        self.indent();
        self.print_block_body(prepend, TopLevel::init(IsTopLevel::No));
        self.print_block_body(stmts, TopLevel::init(IsTopLevel::No));
        self.unindent();
        self.needs_semicolon = false;

        self.print_indent();
        self.print(b"}");
    }

    pub fn print_decls(&mut self, keyword: &'static [u8], decls_: &[G::Decl], flags: ExprFlagSet, tlm: TopLevelAndIsExport) {
        self.print(keyword);
        self.print_space();
        let mut decls = decls_;

        if decls.is_empty() {
            // "var ;" is invalid syntax
            // assert we never reach it
            unreachable!();
        }

        if FeatureFlags::SAME_TARGET_BECOMES_DESTRUCTURING {
            // Minify
            //
            //    var a = obj.foo, b = obj.bar, c = obj.baz;
            //
            // to
            //
            //    var {a, b, c} = obj;
            //
            // Caveats:
            //   - Same consecutive target
            //   - No optional chaining
            //   - No computed property access
            //   - Identifier bindings only
            'brk: {
                if decls.len() <= 1 { break 'brk; }
                let first_decl = &decls[0];
                let second_decl = &decls[1];

                if !matches!(first_decl.binding.data, Binding::Data::BIdentifier(_)) { break 'brk; }
                if second_decl.value.is_none()
                    || !matches!(second_decl.value.as_ref().unwrap().data, Expr::Data::EDot(_))
                    || !matches!(second_decl.binding.data, Binding::Data::BIdentifier(_))
                {
                    break 'brk;
                }

                let Some(target_value) = &first_decl.value else { break 'brk; };
                let Expr::Data::EDot(target_e_dot) = &target_value.data else { break 'brk; };
                let target_ref = if matches!(target_e_dot.target.data, Expr::Data::EIdentifier(_)) && target_e_dot.optional_chain.is_none() {
                    match &target_e_dot.target.data { Expr::Data::EIdentifier(id) => id.ref_, _ => unreachable!() }
                } else {
                    break 'brk;
                };

                let second_e_dot = match &second_decl.value.as_ref().unwrap().data { Expr::Data::EDot(d) => d, _ => unreachable!() };
                if !matches!(second_e_dot.target.data, Expr::Data::EIdentifier(_)) || second_e_dot.optional_chain.is_some() {
                    break 'brk;
                }

                let second_ref = match &second_e_dot.target.data { Expr::Data::EIdentifier(id) => id.ref_, _ => unreachable!() };
                if !second_ref.eql(target_ref) {
                    break 'brk;
                }

                {
                    // Reset the temporary bindings array early on
                    let mut temp_bindings = core::mem::take(&mut self.temporary_bindings);
                    // PORT NOTE: Zig's defer swaps temp_bindings back if not replaced — Drop handles cleanup.
                    let _guard = scopeguard::guard((), |_| {
                        // TODO(port): replicate the Zig swap-back semantics in Phase B (see js_printer.zig:1251)
                    });
                    temp_bindings.reserve(2);
                    // PERF(port): was assume_capacity
                    temp_bindings.push(B::Property {
                        key: Expr::init(E::String::init(target_e_dot.name), target_e_dot.name_loc),
                        value: decls[0].binding,
                        ..Default::default()
                    });
                    temp_bindings.push(B::Property {
                        key: Expr::init(E::String::init(second_e_dot.name), second_e_dot.name_loc),
                        value: decls[1].binding,
                        ..Default::default()
                    });

                    decls = &decls[2..];
                    while !decls.is_empty() {
                        let decl = &decls[0];

                        if decl.value.is_none()
                            || !matches!(decl.value.as_ref().unwrap().data, Expr::Data::EDot(_))
                            || !matches!(decl.binding.data, Binding::Data::BIdentifier(_))
                        {
                            break;
                        }

                        let e_dot = match &decl.value.as_ref().unwrap().data { Expr::Data::EDot(d) => d, _ => unreachable!() };
                        if !matches!(e_dot.target.data, Expr::Data::EIdentifier(_)) || e_dot.optional_chain.is_some() {
                            break;
                        }

                        let ref_ = match &e_dot.target.data { Expr::Data::EIdentifier(id) => id.ref_, _ => unreachable!() };
                        if !ref_.eql(target_ref) {
                            break;
                        }

                        temp_bindings.push(B::Property {
                            key: Expr::init(E::String::init(e_dot.name), e_dot.name_loc),
                            value: decl.binding,
                            ..Default::default()
                        });
                        decls = &decls[1..];
                    }
                    let mut b_object = B::Object {
                        properties: &temp_bindings[..], // TODO(port): lifetime — temp_bindings is local
                        is_single_line: true,
                    };
                    let binding = Binding::init(&mut b_object, target_e_dot.target.loc);
                    self.print_binding(binding, tlm);
                    self.temporary_bindings = temp_bindings;
                }

                self.print_whitespacer(ws(b" = "));
                self.print_expr(second_e_dot.target, Level::Comma, flags);

                if decls.is_empty() {
                    return;
                }

                self.print(b",");
                self.print_space();
            }
        }

        {
            self.print_binding(decls[0].binding, tlm);

            if let Some(value) = &decls[0].value {
                self.print_whitespacer(ws(b" = "));
                self.print_expr(*value, Level::Comma, flags);
            }
        }

        for decl in &decls[1..] {
            self.print(b",");
            self.print_space();

            self.print_binding(decl.binding, tlm);

            if let Some(value) = &decl.value {
                self.print_whitespacer(ws(b" = "));
                self.print_expr(*value, Level::Comma, flags);
            }
        }
    }

    #[inline]
    pub fn add_source_mapping(&mut self, location: logger::Loc) {
        if !GENERATE_SOURCE_MAP { return; }
        self.source_map_builder.add_source_mapping(location, self.writer.slice());
    }

    #[inline]
    pub fn add_source_mapping_for_name(&mut self, location: logger::Loc, _name: &[u8], _ref: Ref) {
        if !GENERATE_SOURCE_MAP { return; }
        // TODO: esbuild does this to make the source map more accurate with E.NameOfSymbol
        self.add_source_mapping(location);
    }

    pub fn print_symbol(&mut self, ref_: Ref) {
        debug_assert!(!ref_.is_null()); // Invalid Symbol
        let name = self.renamer.name_for_symbol(ref_);
        self.print_identifier(name);
    }

    pub fn print_clause_alias(&mut self, alias: &[u8]) {
        debug_assert!(!alias.is_empty());

        if !strings::contains_non_bmp_code_point_or_is_invalid_identifier(alias) {
            self.print_space_before_identifier();
            self.print_identifier(alias);
        } else {
            self.print_string_literal_utf8(alias, false);
        }
    }

    pub fn print_fn_args(
        &mut self,
        open_paren_loc: Option<logger::Loc>,
        args: &[G::Arg],
        has_rest_arg: bool,
        // is_arrow can be used for minifying later
        _is_arrow: bool,
    ) {
        let wrap = true;

        if wrap {
            if let Some(loc) = open_paren_loc {
                self.add_source_mapping(loc);
            }
            self.print(b"(");
        }

        for (i, arg) in args.iter().enumerate() {
            if i != 0 {
                self.print(b",");
                self.print_space();
            }

            if has_rest_arg && i + 1 == args.len() {
                self.print(b"...");
            }

            self.print_binding(arg.binding, TopLevelAndIsExport::default());

            if let Some(default) = &arg.default {
                self.print_whitespacer(ws(b" = "));
                self.print_expr(*default, Level::Comma, ExprFlag::none());
            }
        }

        if wrap {
            self.print(b")");
        }
    }

    pub fn print_func(&mut self, func: G::Fn) {
        self.print_fn_args(func.open_parens_loc, &func.args, func.flags.contains(G::FnFlags::HasRestArg), false);
        self.print_space();
        self.print_block(func.body.loc, &func.body.stmts, None, TopLevel::init(IsTopLevel::No));
    }

    pub fn print_class(&mut self, class: G::Class) {
        if let Some(extends) = &class.extends {
            self.print(b" extends");
            self.print_space();
            self.print_expr(*extends, Level::New.sub(1), ExprFlag::none());
        }

        self.print_space();

        self.add_source_mapping(class.body_loc);
        self.print(b"{");
        self.print_newline();
        self.indent();

        for item in class.properties.iter() {
            self.print_semicolon_if_needed();
            self.print_indent();

            if item.kind == G::Property::Kind::ClassStaticBlock {
                self.print(b"static");
                self.print_space();
                let csb = item.class_static_block.as_ref().unwrap();
                self.print_block(csb.loc, csb.stmts.slice(), None, TopLevel::init(IsTopLevel::No));
                self.print_newline();
                continue;
            }

            self.print_property(*item);

            if item.value.is_none() {
                self.print_semicolon_after_statement();
            } else {
                self.print_newline();
            }
        }

        self.needs_semicolon = false;
        self.unindent();
        self.print_indent();
        if class.close_brace_loc.start > class.body_loc.start {
            self.add_source_mapping(class.close_brace_loc);
        }
        self.print(b"}");
    }

    pub fn best_quote_char_for_e_string(str: &E::String, allow_backtick: bool) -> u8 {
        if IS_JSON { return b'"'; }
        if str.is_utf8() {
            best_quote_char_for_string(str.data(), allow_backtick)
        } else {
            best_quote_char_for_string(str.slice16(), allow_backtick)
        }
    }

    pub fn print_whitespacer(&mut self, spacer: Whitespacer) {
        if self.options.minify_whitespace {
            self.print(spacer.minify);
        } else {
            self.print(spacer.normal);
        }
    }

    pub fn print_non_negative_float(&mut self, float: f64) {
        // Is this actually an integer?
        // PORT NOTE: @setRuntimeSafety(false) / @setFloatMode(.optimized) have no Rust equivalent.
        let floored = float.floor();
        let remainder = float - floored;
        let is_integer = remainder == 0.0;
        if float < (u64::MAX >> 12) as f64 /* maxInt(u52) */ && is_integer {
            // In JavaScript, numbers are represented as 64 bit floats
            // However, they could also be signed or unsigned int 32 (when doing bit shifts)
            // In this case, it's always going to unsigned since that conversion has already happened.
            let val = float as u64;
            match val {
                0 => self.print(b"0"),
                1..=9 => {
                    let bytes = [b'0' + u8::try_from(val).unwrap()];
                    self.print(&bytes[..]);
                }
                10 => self.print(b"10"),
                11..=99 => {
                    let buf = self.writer.reserve(2).expect("unreachable");
                    let mut tmp = [0u8; 2];
                    format_unsigned_integer_between::<2>(&mut tmp, val);
                    // SAFETY: reserved 2 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 2); }
                    self.writer.advance(2);
                }
                100 => self.print(b"100"),
                101..=999 => {
                    let buf = self.writer.reserve(3).expect("unreachable");
                    let mut tmp = [0u8; 3];
                    format_unsigned_integer_between::<3>(&mut tmp, val);
                    // SAFETY: reserved 3 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 3); }
                    self.writer.advance(3);
                }
                1000 => self.print(b"1000"),
                1001..=9999 => {
                    let buf = self.writer.reserve(4).expect("unreachable");
                    let mut tmp = [0u8; 4];
                    format_unsigned_integer_between::<4>(&mut tmp, val);
                    // SAFETY: reserved 4 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 4); }
                    self.writer.advance(4);
                }
                10000 => self.print(b"1e4"),
                100000 => self.print(b"1e5"),
                1000000 => self.print(b"1e6"),
                10000000 => self.print(b"1e7"),
                100000000 => self.print(b"1e8"),
                1000000000 => self.print(b"1e9"),
                10001..=99999 => {
                    let buf = self.writer.reserve(5).expect("unreachable");
                    let mut tmp = [0u8; 5];
                    format_unsigned_integer_between::<5>(&mut tmp, val);
                    // SAFETY: reserved 5 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 5); }
                    self.writer.advance(5);
                }
                100001..=999999 => {
                    let buf = self.writer.reserve(6).expect("unreachable");
                    let mut tmp = [0u8; 6];
                    format_unsigned_integer_between::<6>(&mut tmp, val);
                    // SAFETY: reserved 6 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 6); }
                    self.writer.advance(6);
                }
                1_000_001..=9_999_999 => {
                    let buf = self.writer.reserve(7).expect("unreachable");
                    let mut tmp = [0u8; 7];
                    format_unsigned_integer_between::<7>(&mut tmp, val);
                    // SAFETY: reserved 7 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 7); }
                    self.writer.advance(7);
                }
                10_000_001..=99_999_999 => {
                    let buf = self.writer.reserve(8).expect("unreachable");
                    let mut tmp = [0u8; 8];
                    format_unsigned_integer_between::<8>(&mut tmp, val);
                    // SAFETY: reserved 8 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 8); }
                    self.writer.advance(8);
                }
                100_000_001..=999_999_999 => {
                    let buf = self.writer.reserve(9).expect("unreachable");
                    let mut tmp = [0u8; 9];
                    format_unsigned_integer_between::<9>(&mut tmp, val);
                    // SAFETY: reserved 9 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 9); }
                    self.writer.advance(9);
                }
                1_000_000_001..=9_999_999_999 => {
                    let buf = self.writer.reserve(10).expect("unreachable");
                    let mut tmp = [0u8; 10];
                    format_unsigned_integer_between::<10>(&mut tmp, val);
                    // SAFETY: reserved 10 bytes
                    unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf, 10); }
                    self.writer.advance(10);
                }
                _ => { let _ = self.fmt(format_args!("{}", val)); }
            }
            return;
        }

        // TODO(port): Zig "{d}" on f64 — need shortest-round-trip formatter (ryu) to match output exactly.
        let _ = self.fmt(format_args!("{}", float));
    }

    pub fn print_string_characters_utf8(&mut self, text: &[u8], quote: u8) {
        let mut writer = self.writer.std_writer();
        let _ = match quote {
            b'\'' => write_pre_quoted_string::<_, b'\'', ASCII_ONLY, false, { Encoding::Utf8 }>(text, &mut writer),
            b'"' => write_pre_quoted_string::<_, b'"', ASCII_ONLY, false, { Encoding::Utf8 }>(text, &mut writer),
            b'`' => write_pre_quoted_string::<_, b'`', ASCII_ONLY, false, { Encoding::Utf8 }>(text, &mut writer),
            _ => unreachable!(),
        };
    }

    pub fn print_string_characters_utf16(&mut self, text: &[u16], quote: u8) {
        // SAFETY: reinterpret &[u16] as &[u8] for write_pre_quoted_string's utf16 path
        let slice = unsafe { core::slice::from_raw_parts(text.as_ptr() as *const u8, text.len() * 2) };
        let mut writer = self.writer.std_writer();
        let _ = match quote {
            b'\'' => write_pre_quoted_string::<_, b'\'', ASCII_ONLY, false, { Encoding::Utf16 }>(slice, &mut writer),
            b'"' => write_pre_quoted_string::<_, b'"', ASCII_ONLY, false, { Encoding::Utf16 }>(slice, &mut writer),
            b'`' => write_pre_quoted_string::<_, b'`', ASCII_ONLY, false, { Encoding::Utf16 }>(slice, &mut writer),
            _ => unreachable!(),
        };
    }

    pub fn is_unbound_eval_identifier(&self, value: Expr) -> bool {
        match &value.data {
            Expr::Data::EIdentifier(ident) => {
                if ident.ref_.is_source_contents_slice() { return false; }
                let Some(symbol) = self.symbols().get(self.symbols().follow(ident.ref_)) else { return false; };
                symbol.kind == Symbol::Kind::Unbound && symbol.original_name == b"eval"
            }
            _ => false,
        }
    }

    #[inline]
    fn symbols(&self) -> js_ast::Symbol::Map {
        self.renamer.symbols()
    }

    pub fn print_require_error(&mut self, text: &[u8]) {
        self.print(b"(()=>{throw new Error(\"Cannot require module \"+");
        self.print_string_literal_utf8(text, false);
        self.print(b");})()");
    }

    #[inline]
    pub fn import_record(&self, import_record_index: usize) -> &ImportRecord {
        &self.import_records[import_record_index]
    }

    pub fn is_unbound_identifier(&self, expr: &Expr) -> bool {
        let Expr::Data::EIdentifier(id) = &expr.data else { return false; };
        let ref_ = id.ref_;
        let Some(symbol) = self.symbols().get(self.symbols().follow(ref_)) else { return false; };
        symbol.kind == Symbol::Kind::Unbound
    }

    pub fn print_require_or_import_expr(
        &mut self,
        import_record_index: u32,
        was_unwrapped_require: bool,
        leading_interior_comments: &[G::Comment],
        import_options: Expr,
        level_: Level,
        flags: ExprFlagSet,
    ) {
        let _ = leading_interior_comments; // TODO:

        let mut level = level_;
        let wrap = level.gte(Level::New) || flags.contains(ExprFlag::ForbidCall);
        if wrap { self.print(b"("); }
        let _wrap_guard = scopeguard::guard((), |_| { /* defer if wrap p.print(")") — handled at fn tail */ });
        // PORT NOTE: Zig used `defer if (wrap) p.print(")")`. We close at every `return` below.

        debug_assert!(self.import_records.len() > import_record_index as usize);
        let record = self.import_record(import_record_index as usize);
        let module_type = self.options.module_type;

        if IS_BUN_PLATFORM {
            // "bun" is not a real module. It's just globalThis.Bun.
            //
            //  transform from:
            //      const foo = await import("bun")
            //      const bar = require("bun")
            //
            //  transform to:
            //      const foo = await Promise.resolve(globalThis.Bun)
            //      const bar = globalThis.Bun
            //
            if record.tag == ImportRecord::Tag::Bun {
                if record.kind == ImportKind::Dynamic {
                    self.print(b"Promise.resolve(globalThis.Bun)");
                    if wrap { self.print(b")"); }
                    return;
                } else if record.kind == ImportKind::Require || record.kind == ImportKind::Stmt {
                    self.print(b"globalThis.Bun");
                    if wrap { self.print(b")"); }
                    return;
                }
            }
        }

        if record.source_index.is_valid() {
            let mut meta = self.options.require_or_import_meta_for_source(record.source_index.get(), was_unwrapped_require);

            // Don't need the namespace object if the result is unused anyway
            if flags.contains(ExprFlag::ExprResultIsUnused) {
                meta.exports_ref = Ref::NONE;
            }

            // Internal "import()" of async ESM
            if record.kind == ImportKind::Dynamic && meta.is_wrapper_async {
                self.print_space_before_identifier();
                self.print_symbol(meta.wrapper_ref);
                self.print(b"()");
                if meta.exports_ref.is_valid() {
                    let _ = self.print_dot_then_prefix();
                    self.print_space_before_identifier();
                    self.print_symbol(meta.exports_ref);
                    self.print_dot_then_suffix();
                }
                if wrap { self.print(b")"); }
                return;
            }

            // Internal "require()" or "import()"
            let has_side_effects = meta.wrapper_ref.is_valid()
                || meta.exports_ref.is_valid()
                || meta.was_unwrapped_require
                || self.options.input_files_for_dev_server.is_some();
            if record.kind == ImportKind::Dynamic {
                self.print_space_before_identifier();
                self.print(b"Promise.resolve()");
                if has_side_effects {
                    level = self.print_dot_then_prefix();
                }
            }

            // Make sure the comma operator is properly wrapped
            let wrap_comma_operator = meta.exports_ref.is_valid()
                && meta.wrapper_ref.is_valid()
                && level.gte(Level::Comma);
            if wrap_comma_operator { self.print(b"("); }

            // Wrap this with a call to "__toESM()" if this is a CommonJS file
            let wrap_with_to_esm = record.flags.wrap_with_to_esm;
            if wrap_with_to_esm {
                self.print_space_before_identifier();
                self.print_symbol(self.options.to_esm_ref);
                self.print(b"(");
            }

            if let Some(input_files) = self.options.input_files_for_dev_server {
                debug_assert!(module_type == options::Format::InternalBakeDev);
                self.print_space_before_identifier();
                self.print_symbol(self.options.hmr_ref);
                self.print(b".require(");
                let path = &input_files[record.source_index.get() as usize].path;
                self.print_string_literal_utf8(&path.pretty, false);
                self.print(b")");
            } else if !meta.was_unwrapped_require {
                // Call the wrapper
                if meta.wrapper_ref.is_valid() {
                    self.print_space_before_identifier();
                    self.print_symbol(meta.wrapper_ref);
                    self.print(b"()");

                    if meta.exports_ref.is_valid() {
                        self.print(b",");
                        self.print_space();
                    }
                }

                // Return the namespace object if this is an ESM file
                if meta.exports_ref.is_valid() {
                    // Wrap this with a call to "__toCommonJS()" if this is an ESM file
                    let wrap_with_to_cjs = record.flags.wrap_with_to_commonjs;
                    if wrap_with_to_cjs {
                        self.print_symbol(self.options.to_commonjs_ref);
                        self.print(b"(");
                    }
                    self.print_symbol(meta.exports_ref);
                    if wrap_with_to_cjs {
                        self.print(b")");
                    }
                }
            } else {
                if !meta.exports_ref.is_null() {
                    self.print_symbol(meta.exports_ref);
                }
            }

            if wrap_with_to_esm {
                if self.options.input_module_type == options::ModuleType::Esm {
                    self.print(b",");
                    self.print_space();
                    self.print(b"1");
                }
                self.print(b")");
            }

            if wrap_comma_operator { self.print(b")"); }
            if record.kind == ImportKind::Dynamic && has_side_effects { self.print_dot_then_suffix(); }
            if wrap { self.print(b")"); }
            return;
        }

        // External "require()"
        if record.kind != ImportKind::Dynamic {
            self.print_space_before_identifier();

            if self.options.inline_require_and_import_errors {
                if record.path.is_disabled && record.flags.handles_import_errors {
                    self.print_require_error(&record.path.text);
                    if wrap { self.print(b")"); }
                    return;
                }

                if record.path.is_disabled {
                    self.print_disabled_import();
                    if wrap { self.print(b")"); }
                    return;
                }
            }

            let wrap_with_to_esm = record.flags.wrap_with_to_esm;

            if module_type == options::Format::InternalBakeDev {
                self.print_space_before_identifier();
                self.print_symbol(self.options.hmr_ref);
                if record.tag == ImportRecord::Tag::Builtin {
                    self.print(b".builtin(");
                } else {
                    self.print(b".require(");
                }
                let path = &record.path;
                self.print_string_literal_utf8(&path.pretty, false);
                self.print(b")");
                if wrap { self.print(b")"); }
                return;
            } else if wrap_with_to_esm {
                self.print_space_before_identifier();
                self.print_symbol(self.options.to_esm_ref);
                self.print(b"(");
            }

            if let Some(ref_) = self.options.require_ref {
                self.print_symbol(ref_);
            } else {
                self.print(b"require");
            }

            self.print(b"(");
            self.print_import_record_path(record);
            self.print(b")");

            if wrap_with_to_esm {
                self.print(b")");
            }
            if wrap { self.print(b")"); }
            return;
        }

        // External import()
        self.add_source_mapping(record.range.loc);

        self.print_space_before_identifier();

        // Wrap with __toESM if importing a CommonJS module
        let wrap_with_to_esm = record.flags.wrap_with_to_esm;

        // Allow it to fail at runtime, if it should
        if module_type != options::Format::InternalBakeDev {
            self.print(b"import(");
            self.print_import_record_path(record);
        } else {
            self.print_symbol(self.options.hmr_ref);
            self.print(b".dynamicImport(");
            let path = &record.path;
            self.print_string_literal_utf8(&path.pretty, false);
        }

        if !import_options.is_missing() {
            self.print_whitespacer(ws(b", "));
            self.print_expr(import_options, Level::Comma, ExprFlagSet::empty());
        }

        self.print(b")");

        // For CJS modules, unwrap the default export and convert to ESM
        if wrap_with_to_esm {
            self.print(b".then((m)=>");
            self.print_symbol(self.options.to_esm_ref);
            self.print(b"(m.default");
            if self.options.input_module_type == options::ModuleType::Esm {
                self.print(b",1");
            }
            self.print(b"))");
        }

        if wrap { self.print(b")"); }
    }

    #[inline]
    pub fn print_pure(&mut self) {
        if self.options.print_dce_annotations {
            self.print_whitespacer(ws(b"/* @__PURE__ */ "));
        }
    }

    pub fn print_string_literal_e_string(&mut self, str: &E::String, allow_backtick: bool) {
        let quote = Self::best_quote_char_for_e_string(str, allow_backtick);
        self.print(quote);
        self.print_string_characters_e_string(str, quote);
        self.print(quote);
    }

    pub fn print_string_literal_utf8(&mut self, str: &[u8], allow_backtick: bool) {
        if cfg!(debug_assertions) {
            debug_assert!(strings::wtf8_validate_slice(str));
        }

        let quote = if !IS_JSON {
            best_quote_char_for_string(str, allow_backtick)
        } else {
            b'"'
        };

        self.print(quote);
        self.print_string_characters_utf8(str, quote);
        self.print(quote);
    }

    fn print_clause_item(&mut self, item: js_ast::ClauseItem) {
        self.print_clause_item_as(item, ClauseItemAs::Import)
    }

    fn print_export_clause_item(&mut self, item: js_ast::ClauseItem) {
        self.print_clause_item_as(item, ClauseItemAs::Export)
    }

    fn print_export_from_clause_item(&mut self, item: js_ast::ClauseItem) {
        self.print_clause_item_as(item, ClauseItemAs::ExportFrom)
    }

    fn print_clause_item_as(&mut self, item: js_ast::ClauseItem, as_: ClauseItemAs) {
        let name = self.renamer.name_for_symbol(item.name.ref_.unwrap());

        match as_ {
            ClauseItemAs::Import => {
                if name == item.alias {
                    self.print_identifier(name);
                } else {
                    self.print_clause_alias(&item.alias);
                    self.print(b" as ");
                    self.add_source_mapping(item.alias_loc);
                    self.print_identifier(name);
                }
            }
            ClauseItemAs::Var => {
                self.print_clause_alias(&item.alias);
                if name != item.alias {
                    self.print(b":");
                    self.print_space();
                    self.print_identifier(name);
                }
            }
            ClauseItemAs::Export => {
                self.print_identifier(name);
                if name != item.alias {
                    self.print(b" as ");
                    self.add_source_mapping(item.alias_loc);
                    self.print_clause_alias(&item.alias);
                }
            }
            ClauseItemAs::ExportFrom => {
                // In `export { x } from 'mod'`, the "name" on the left of `as`
                // refers to an export of the other module, not a local binding.
                // It's stored as the raw source text on `item.original_name`
                // (ECMAScript allows this to be a string literal like `"a b c"`)
                // and the item's ref points to a synthesized intermediate symbol
                // whose display name may be mangled by a minifier. We must print
                // `original_name` via `printClauseAlias` so string literals stay
                // quoted and mangling can't corrupt the foreign-module name.
                let from_name = if !item.original_name.is_empty() { &item.original_name[..] } else { name };
                self.print_clause_alias(from_name);

                if from_name != item.alias {
                    self.print(b" as ");
                    self.add_source_mapping(item.alias_loc);
                    self.print_clause_alias(&item.alias);
                }
            }
        }
    }

    #[inline]
    pub fn can_print_identifier_utf16(&self, name: &[u16]) -> bool {
        if ASCII_ONLY || ASCII_ONLY_ALWAYS_ON_UNLESS_MINIFYING {
            js_lexer::is_latin1_identifier_u16(name)
        } else {
            js_lexer::is_identifier_utf16(name)
        }
    }

    fn print_raw_template_literal(&mut self, bytes: &[u8]) {
        if IS_JSON || !ASCII_ONLY {
            self.print(bytes);
            return;
        }

        // Translate any non-ASCII to unicode escape sequences
        // Note that this does not correctly handle malformed template literal strings
        // template literal strings can contain invalid unicode code points
        // and pretty much anything else
        //
        // we use WTF-8 here, but that's still not good enough.
        //
        let mut ascii_start: usize = 0;
        let mut is_ascii = false;
        let mut iter = CodepointIterator::init(bytes);
        let mut cursor = CodepointIterator::Cursor::default();

        while iter.next(&mut cursor) {
            match cursor.c {
                // unlike other versions, we only want to mutate > 0x7F
                0..=LAST_ASCII => {
                    if !is_ascii {
                        ascii_start = cursor.i;
                        is_ascii = true;
                    }
                }
                _ => {
                    if is_ascii {
                        self.print(&bytes[ascii_start..cursor.i]);
                        is_ascii = false;
                    }

                    match cursor.c {
                        0..=0xFFFF => {
                            let c = usize::try_from(cursor.c).unwrap();
                            self.print(&[
                                b'\\', b'u',
                                HEX_CHARS[c >> 12],
                                HEX_CHARS[(c >> 8) & 15],
                                HEX_CHARS[(c >> 4) & 15],
                                HEX_CHARS[c & 15],
                            ][..]);
                        }
                        _ => {
                            self.print(b"\\u{");
                            let _ = self.fmt(format_args!("{:x}", cursor.c));
                            self.print(b"}");
                        }
                    }
                }
            }
        }

        if is_ascii {
            self.print(&bytes[ascii_start..]);
        }
    }

    pub fn print_expr(&mut self, expr: Expr, level: Level, in_flags: ExprFlagSet) {
        let mut flags = in_flags;

        match &expr.data {
            Expr::Data::EMissing => {}
            Expr::Data::EUndefined => {
                self.add_source_mapping(expr.loc);
                self.print_undefined(expr.loc, level);
            }
            Expr::Data::ESuper => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(b"super");
            }
            Expr::Data::ENull => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(b"null");
            }
            Expr::Data::EThis => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(b"this");
            }
            Expr::Data::ESpread(e) => {
                self.add_source_mapping(expr.loc);
                self.print(b"...");
                self.print_expr(e.value, Level::Comma, ExprFlag::none());
            }
            Expr::Data::ENewTarget => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(b"new.target");
            }
            Expr::Data::EImportMeta => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                if self.options.module_type == options::Format::InternalBakeDev {
                    debug_assert!(self.options.hmr_ref.is_valid());
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".importMeta");
                } else if !self.options.import_meta_ref.is_valid() {
                    // Most of the time, leave it in there
                    if let Some(mi) = self.module_info() { mi.flags.contains_import_meta = true; }
                    self.print(b"import.meta");
                } else {
                    // Note: The bundler will not hit this code path. The bundler will replace
                    // the ImportMeta AST node with a regular Identifier AST node.
                    //
                    // This is currently only used in Bun's runtime for CommonJS modules
                    // referencing import.meta
                    //
                    // TODO: This assertion trips when using `import.meta` with `--format=cjs`
                    debug_assert!(self.options.module_type == options::Format::Cjs);

                    self.print_symbol(self.options.import_meta_ref);
                }
            }
            Expr::Data::EImportMetaMain(data) => {
                if self.options.module_type == options::Format::Esm && self.options.target != options::Target::Node {
                    // Node.js doesn't support import.meta.main
                    // Most of the time, leave it in there
                    if data.inverted {
                        self.add_source_mapping(expr.loc);
                        self.print(b"!");
                    } else {
                        self.print_space_before_identifier();
                        self.add_source_mapping(expr.loc);
                    }
                    if let Some(mi) = self.module_info() { mi.flags.contains_import_meta = true; }
                    self.print(b"import.meta.main");
                } else {
                    debug_assert!(self.options.module_type != options::Format::InternalBakeDev);

                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);

                    if let Some(require) = self.options.require_ref {
                        self.print_symbol(require);
                    } else {
                        self.print(b"require");
                    }

                    if data.inverted {
                        self.print_whitespacer(ws(b".main != "));
                    } else {
                        self.print_whitespacer(ws(b".main == "));
                    }

                    if self.options.target == options::Target::Node {
                        // "__require.module"
                        if let Some(require) = self.options.require_ref {
                            self.print_symbol(require);
                            self.print(b".module");
                        } else {
                            self.print(b"module");
                        }
                    } else if self.options.commonjs_module_ref.is_valid() {
                        self.print_symbol(self.options.commonjs_module_ref);
                    } else {
                        self.print(b"module");
                    }
                }
            }
            Expr::Data::ESpecial(special) => match special {
                E::Special::ModuleExports => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);

                    if self.options.commonjs_module_exports_assigned_deoptimized {
                        if self.options.commonjs_module_ref.is_valid() {
                            self.print_symbol(self.options.commonjs_module_ref);
                        } else {
                            self.print(b"module");
                        }
                        self.print(b".exports");
                    } else {
                        self.print_symbol(self.options.commonjs_named_exports_ref);
                    }
                }
                E::Special::HotEnabled => {
                    debug_assert!(self.options.module_type == options::Format::InternalBakeDev);
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".indirectHot");
                }
                E::Special::HotData => {
                    debug_assert!(self.options.module_type == options::Format::InternalBakeDev);
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".data");
                }
                E::Special::HotAccept => {
                    debug_assert!(self.options.module_type == options::Format::InternalBakeDev);
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".accept");
                }
                E::Special::HotAcceptVisited => {
                    debug_assert!(self.options.module_type == options::Format::InternalBakeDev);
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".acceptSpecifiers");
                }
                E::Special::HotDisabled => {
                    debug_assert!(self.options.module_type != options::Format::InternalBakeDev);
                    self.print_expr(Expr { data: Expr::Data::EUndefined, loc: expr.loc }, level, in_flags);
                }
                E::Special::ResolvedSpecifierString(index) => {
                    debug_assert!(self.options.module_type == options::Format::InternalBakeDev);
                    self.print_string_literal_utf8(&self.import_record(index.get() as usize).path.pretty, true);
                }
            },
            Expr::Data::ECommonjsExportIdentifier(id) => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);

                for (key, value) in self.options.commonjs_named_exports.keys().iter().zip(self.options.commonjs_named_exports.values().iter()) {
                    if value.loc_ref.ref_.unwrap().eql(id.ref_) {
                        if self.options.commonjs_named_exports_deoptimized || value.needs_decl {
                            if self.options.commonjs_module_exports_assigned_deoptimized
                                && id.base == E::CommonjsExportIdentifier::Base::ModuleDotExports
                                && self.options.commonjs_module_ref.is_valid()
                            {
                                self.print_symbol(self.options.commonjs_module_ref);
                                self.print(b".exports");
                            } else {
                                self.print_symbol(self.options.commonjs_named_exports_ref);
                            }

                            if js_lexer::is_identifier(key) {
                                self.print(b".");
                                self.print(key);
                            } else {
                                self.print(b"[");
                                self.print_string_literal_utf8(key, false);
                                self.print(b"]");
                            }
                        } else {
                            self.print_symbol(value.loc_ref.ref_.unwrap());
                        }
                        break;
                    }
                }
            }
            Expr::Data::ENew(e) => {
                let has_pure_comment = e.can_be_unwrapped_if_unused == E::CanBeUnwrapped::IfUnused && self.options.print_dce_annotations;
                let wrap = level.gte(Level::Call) || (has_pure_comment && level.gte(Level::Postfix));

                if wrap { self.print(b"("); }

                if has_pure_comment { self.print_pure(); }

                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(b"new");
                self.print_space();
                self.print_expr(e.target, Level::New, ExprFlag::forbid_call());
                let args = e.args.slice();
                if !args.is_empty() || level.gte(Level::Postfix) {
                    self.print(b"(");

                    if !args.is_empty() {
                        self.print_expr(args[0], Level::Comma, ExprFlag::none());
                        for arg in &args[1..] {
                            self.print(b",");
                            self.print_space();
                            self.print_expr(*arg, Level::Comma, ExprFlag::none());
                        }
                    }

                    if e.close_parens_loc.start > expr.loc.start {
                        self.add_source_mapping(e.close_parens_loc);
                    }

                    self.print(b")");
                }

                if wrap { self.print(b")"); }
            }
            Expr::Data::ECall(e) => {
                let mut wrap = level.gte(Level::New) || flags.contains(ExprFlag::ForbidCall);
                let mut target_flags = ExprFlag::none();
                if e.optional_chain.is_none() {
                    target_flags = ExprFlag::has_non_optional_chain_parent();
                } else if flags.contains(ExprFlag::HasNonOptionalChainParent) {
                    wrap = true;
                }

                let has_pure_comment = e.can_be_unwrapped_if_unused == E::CanBeUnwrapped::IfUnused && self.options.print_dce_annotations;
                if has_pure_comment && level.gte(Level::Postfix) {
                    wrap = true;
                }

                if wrap { self.print(b"("); }

                if has_pure_comment {
                    let was_stmt_start = self.stmt_start == self.writer.written();
                    self.print_pure();
                    if was_stmt_start {
                        self.stmt_start = self.writer.written();
                    }
                }
                // We only want to generate an unbound eval() in CommonJS
                self.call_target = Some(e.target.data.clone());

                let is_unbound_eval = !e.is_direct_eval
                    && self.is_unbound_eval_identifier(e.target)
                    && e.optional_chain.is_none();

                if is_unbound_eval {
                    self.print(b"(0,");
                    self.print_space();
                    self.print_expr(e.target, Level::Postfix, ExprFlag::none());
                    self.print(b")");
                } else {
                    self.print_expr(e.target, Level::Postfix, target_flags);
                }

                if e.optional_chain == Some(js_ast::OptionalChain::Start) {
                    self.print(b"?.");
                }
                self.print(b"(");
                let args = e.args.slice();

                if !args.is_empty() {
                    self.print_expr(args[0], Level::Comma, ExprFlag::none());
                    for arg in &args[1..] {
                        self.print(b",");
                        self.print_space();
                        self.print_expr(*arg, Level::Comma, ExprFlag::none());
                    }
                }
                if e.close_paren_loc.start > expr.loc.start {
                    self.add_source_mapping(e.close_paren_loc);
                }
                self.print(b")");
                if wrap { self.print(b")"); }
            }
            Expr::Data::ERequireMain => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);

                if let Some(require_ref) = self.options.require_ref {
                    self.print_symbol(require_ref);
                    self.print(b".main");
                } else if self.options.module_type == options::Format::InternalBakeDev {
                    self.print(b"false"); // there is no true main entry point
                } else {
                    self.print(b"require.main");
                }
            }
            Expr::Data::ERequireCallTarget => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);

                if let Some(require_ref) = self.options.require_ref {
                    self.print_symbol(require_ref);
                } else if self.options.module_type == options::Format::InternalBakeDev {
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".require");
                } else {
                    self.print(b"require");
                }
            }
            Expr::Data::ERequireResolveCallTarget => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);

                if let Some(require_ref) = self.options.require_ref {
                    self.print_symbol(require_ref);
                    self.print(b".resolve");
                } else if self.options.module_type == options::Format::InternalBakeDev {
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".requireResolve");
                } else {
                    self.print(b"require.resolve");
                }
            }
            Expr::Data::ERequireString(e) => {
                if !REWRITE_ESM_TO_CJS {
                    self.print_require_or_import_expr(
                        e.import_record_index,
                        e.unwrapped_id != u32::MAX,
                        &[],
                        Expr::EMPTY,
                        level,
                        flags,
                    );
                }
            }
            Expr::Data::ERequireResolveString(e) => {
                let wrap = level.gte(Level::New) || flags.contains(ExprFlag::ForbidCall);
                if wrap { self.print(b"("); }

                self.print_space_before_identifier();

                if let Some(require_ref) = self.options.require_ref {
                    self.print_symbol(require_ref);
                    self.print(b".resolve");
                } else if self.options.module_type == options::Format::InternalBakeDev {
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".requireResolve");
                } else {
                    self.print(b"require.resolve");
                }

                self.print(b"(");
                self.print_string_literal_utf8(&self.import_record(e.import_record_index as usize).path.text, true);
                self.print(b")");

                if wrap { self.print(b")"); }
            }
            Expr::Data::EImport(e) => {
                // Handle non-string expressions
                if e.is_import_record_null() {
                    let wrap = level.gte(Level::New) || flags.contains(ExprFlag::ForbidCall);
                    if wrap { self.print(b"("); }

                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    if self.options.module_type == options::Format::InternalBakeDev {
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".dynamicImport(");
                    } else {
                        self.print(b"import(");
                    }
                    // TODO: leading_interior_comments
                    self.print_expr(e.expr, Level::Comma, ExprFlag::none());

                    if !e.options.is_missing() {
                        self.print_whitespacer(ws(b", "));
                        self.print_expr(e.options, Level::Comma, ExprFlagSet::empty());
                    }

                    // TODO: leading_interior_comments
                    self.print(b")");
                    if wrap { self.print(b")"); }
                } else {
                    self.print_require_or_import_expr(
                        e.import_record_index,
                        false,
                        &[], // e.leading_interior_comments,
                        e.options,
                        level,
                        flags,
                    );
                }
            }
            Expr::Data::EDot(e) => {
                let is_optional_chain = e.optional_chain == Some(js_ast::OptionalChain::Start);

                let mut wrap = false;
                if e.optional_chain.is_none() {
                    flags.insert(ExprFlag::HasNonOptionalChainParent);

                    // Inline cross-module TypeScript enum references here
                    if let Some(inlined) = self.try_to_get_imported_enum_value(e.target, &e.name) {
                        self.print_inlined_enum(inlined, &e.name, level);
                        return;
                    }
                } else {
                    if flags.contains(ExprFlag::HasNonOptionalChainParent) {
                        wrap = true;
                        self.print(b"(");
                    }
                    flags.remove(ExprFlag::HasNonOptionalChainParent);
                }
                flags &= ExprFlag::HasNonOptionalChainParent | ExprFlag::ForbidCall;

                self.print_expr(e.target, Level::Postfix, flags);

                if js_lexer::is_identifier(&e.name) {
                    if is_optional_chain {
                        self.print(b"?.");
                    } else {
                        if self.prev_num_end == self.writer.written() {
                            // "1.toString" is a syntax error, so print "1 .toString" instead
                            self.print(b" ");
                        }
                        self.print(b".");
                    }

                    self.add_source_mapping(e.name_loc);
                    self.print_identifier(&e.name);
                } else {
                    if is_optional_chain {
                        self.print(b"?.[");
                    } else {
                        self.print(b"[");
                    }
                    self.print_string_literal_utf8(&e.name, false);
                    self.print(b"]");
                }

                if wrap { self.print(b")"); }
            }
            Expr::Data::EIndex(e) => {
                let mut wrap = false;
                if e.optional_chain.is_none() {
                    flags.insert(ExprFlag::HasNonOptionalChainParent);

                    if let Some(str) = e.index.data.as_e_string() {
                        str.resolve_rope_if_needed(/* allocator dropped */);
                        if str.is_utf8() {
                            if let Some(value) = self.try_to_get_imported_enum_value(e.target, str.data()) {
                                self.print_inlined_enum(value, str.data(), level);
                                return;
                            }
                        }
                    }
                } else {
                    if flags.contains(ExprFlag::HasNonOptionalChainParent) {
                        wrap = true;
                        self.print(b"(");
                    }
                    flags.remove(ExprFlag::HasNonOptionalChainParent);
                }

                self.print_expr(e.target, Level::Postfix, flags);

                let is_optional_chain_start = e.optional_chain == Some(js_ast::OptionalChain::Start);
                if is_optional_chain_start {
                    self.print(b"?.");
                }

                match &e.index.data {
                    Expr::Data::EPrivateIdentifier(priv_) => {
                        if !is_optional_chain_start {
                            self.print(b".");
                        }
                        self.add_source_mapping(e.index.loc);
                        self.print_symbol(priv_.ref_);
                    }
                    _ => {
                        self.print(b"[");
                        self.add_source_mapping(e.index.loc);
                        self.print_expr(e.index, Level::Lowest, ExprFlag::none());
                        self.print(b"]");
                    }
                }

                if wrap { self.print(b")"); }
            }
            Expr::Data::EIf(e) => {
                let wrap = level.gte(Level::Conditional);
                if wrap {
                    self.print(b"(");
                    flags.remove(ExprFlag::ForbidIn);
                }
                self.print_expr(e.test_, Level::Conditional, flags);
                self.print_space();
                self.print(b"?");
                self.print_space();
                self.print_expr(e.yes, Level::Yield, ExprFlag::none());
                self.print_space();
                self.print(b":");
                self.print_space();
                flags.insert(ExprFlag::ForbidIn);
                self.print_expr(e.no, Level::Yield, flags);
                if wrap { self.print(b")"); }
            }
            Expr::Data::EArrow(e) => {
                let wrap = level.gte(Level::Assign);

                if wrap { self.print(b"("); }

                if e.is_async {
                    self.add_source_mapping(expr.loc);
                    self.print_space_before_identifier();
                    self.print(b"async");
                    self.print_space();
                }

                self.print_fn_args(if e.is_async { None } else { Some(expr.loc) }, &e.args, e.has_rest_arg, true);
                self.print_whitespacer(ws(b" => "));

                let mut was_printed = false;
                if e.body.stmts.len() == 1 && e.prefer_expr {
                    if let Stmt::Data::SReturn(ret) = &e.body.stmts[0].data {
                        if let Some(val) = &ret.value {
                            self.arrow_expr_start = self.writer.written();
                            self.print_expr(*val, Level::Comma, ExprFlag::ForbidIn.into());
                            was_printed = true;
                        }
                    }
                }

                if !was_printed {
                    self.print_block(e.body.loc, &e.body.stmts, None, TopLevel::init(IsTopLevel::No));
                }

                if wrap { self.print(b")"); }
            }
            Expr::Data::EFunction(e) => {
                let n = self.writer.written();
                let wrap = self.stmt_start == n || self.export_default_start == n;

                if wrap { self.print(b"("); }

                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                if e.func.flags.contains(G::FnFlags::IsAsync) {
                    self.print(b"async ");
                }
                self.print(b"function");
                if e.func.flags.contains(G::FnFlags::IsGenerator) {
                    self.print(b"*");
                    self.print_space();
                }

                if let Some(sym) = &e.func.name {
                    self.print_space_before_identifier();
                    self.add_source_mapping(sym.loc);
                    self.print_symbol(sym.ref_.unwrap_or_else(|| Output::panic("internal error: expected E.Function's name symbol to have a ref")));
                }

                self.print_func(e.func);
                if wrap { self.print(b")"); }
            }
            Expr::Data::EClass(e) => {
                let n = self.writer.written();
                let wrap = self.stmt_start == n || self.export_default_start == n;
                if wrap { self.print(b"("); }

                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(b"class");
                if let Some(name) = &e.class_name {
                    self.print(b" ");
                    self.add_source_mapping(name.loc);
                    self.print_symbol(name.ref_.unwrap_or_else(|| Output::panic("internal error: expected E.Class's name symbol to have a ref")));
                }
                self.print_class(*e);
                if wrap { self.print(b")"); }
            }
            Expr::Data::EArray(e) => {
                self.add_source_mapping(expr.loc);
                self.print(b"[");
                let items = e.items.slice();
                if !items.is_empty() {
                    if !e.is_single_line { self.indent(); }

                    for (i, item) in items.iter().enumerate() {
                        if i != 0 {
                            self.print(b",");
                            if e.is_single_line { self.print_space(); }
                        }
                        if !e.is_single_line {
                            self.print_newline();
                            self.print_indent();
                        }
                        self.print_expr(*item, Level::Comma, ExprFlag::none());

                        if i == items.len() - 1 && matches!(item.data, Expr::Data::EMissing) {
                            // Make sure there's a comma after trailing missing items
                            self.print(b",");
                        }
                    }

                    if !e.is_single_line {
                        self.unindent();
                        self.print_newline();
                        self.print_indent();
                    }
                }

                if e.close_bracket_loc.start > expr.loc.start {
                    self.add_source_mapping(e.close_bracket_loc);
                }

                self.print(b"]");
            }
            Expr::Data::EObject(e) => {
                let n = self.writer.written();
                let wrap = if IS_JSON { false } else { self.stmt_start == n || self.arrow_expr_start == n };

                if wrap { self.print(b"("); }
                self.add_source_mapping(expr.loc);
                self.print(b"{");
                let props = e.properties.slice();
                if !props.is_empty() {
                    if !e.is_single_line { self.indent(); }

                    if e.is_single_line && !IS_JSON {
                        self.print_space();
                    } else {
                        self.print_newline();
                        self.print_indent();
                    }
                    self.print_property(props[0]);

                    if props.len() > 1 {
                        for property in &props[1..] {
                            self.print(b",");
                            if e.is_single_line && !IS_JSON {
                                self.print_space();
                            } else {
                                self.print_newline();
                                self.print_indent();
                            }
                            self.print_property(*property);
                        }
                    }

                    if e.is_single_line && !IS_JSON {
                        self.print_space();
                    } else {
                        self.unindent();
                        self.print_newline();
                        self.print_indent();
                    }
                }
                if e.close_brace_loc.start > expr.loc.start {
                    self.add_source_mapping(e.close_brace_loc);
                }
                self.print(b"}");
                if wrap { self.print(b")"); }
            }
            Expr::Data::EBoolean(e) | Expr::Data::EBranchBoolean(e) => {
                self.add_source_mapping(expr.loc);
                if self.options.minify_syntax {
                    if level.gte(Level::Prefix) {
                        self.print(if e.value { b"(!0)" } else { b"(!1)" });
                    } else {
                        self.print(if e.value { b"!0" } else { b"!1" });
                    }
                } else {
                    self.print_space_before_identifier();
                    self.print(if e.value { b"true".as_slice() } else { b"false".as_slice() });
                }
            }
            Expr::Data::EString(e) => {
                e.resolve_rope_if_needed(/* allocator dropped */);
                self.add_source_mapping(expr.loc);

                // If this was originally a template literal, print it as one as long as we're not minifying
                if e.prefer_template && !self.options.minify_syntax {
                    self.print(b"`");
                    self.print_string_characters_e_string(e, b'`');
                    self.print(b"`");
                    return;
                }

                self.print_string_literal_e_string(e, true);
            }
            Expr::Data::ETemplate(e) => {
                if e.tag.is_none() && (self.options.minify_syntax || self.was_lazy_export) {
                    let mut replaced: Vec<E::TemplatePart> = Vec::new();
                    for (i, _part) in e.parts.iter().enumerate() {
                        let mut part = *_part;
                        let inlined_value: Option<Expr> = match &part.value.data {
                            Expr::Data::ENameOfSymbol(e2) => Some(Expr::init(
                                E::String::init(self.mangled_prop_name(e2.ref_)),
                                part.value.loc,
                            )),
                            Expr::Data::EDot(_) => {
                                // TODO: handle inlining of dot properties
                                None
                            }
                            _ => None,
                        };

                        if let Some(value) = inlined_value {
                            if replaced.is_empty() {
                                replaced.extend_from_slice(&e.parts[..i]);
                            }
                            part.value = value;
                            replaced.push(part);
                        } else if !replaced.is_empty() {
                            replaced.push(part);
                        }
                    }

                    if !replaced.is_empty() {
                        let mut copy = e.clone();
                        copy.parts = &replaced[..]; // TODO(port): lifetime — `replaced` is local
                        let e2 = copy.fold(/* allocator dropped */ expr.loc);
                        match &e2.data {
                            Expr::Data::EString(s) => {
                                self.print(b'"');
                                self.print_string_characters_utf8(s.data(), b'"');
                                self.print(b'"');
                                return;
                            }
                            Expr::Data::ETemplate(t) => {
                                // SAFETY: e is &mut behind the AST arena pointer
                                // TODO(port): Zig mutated `e.* = e2.data.e_template.*` — needs &mut access through arena.
                                let _ = t;
                            }
                            _ => {}
                        }
                    }

                    // Convert no-substitution template literals into strings if it's smaller
                    if e.parts.is_empty() {
                        self.add_source_mapping(expr.loc);
                        self.print_string_characters_e_string(&e.head.cooked(), b'`');
                        return;
                    }
                }

                if let Some(tag) = &e.tag {
                    self.add_source_mapping(expr.loc);
                    // Optional chains are forbidden in template tags
                    if expr.is_optional_chain() {
                        self.print(b"(");
                        self.print_expr(*tag, Level::Lowest, ExprFlag::none());
                        self.print(b")");
                    } else {
                        self.print_expr(*tag, Level::Postfix, ExprFlag::none());
                    }
                } else {
                    self.add_source_mapping(expr.loc);
                }

                self.print(b"`");
                match &e.head {
                    E::Template::Head::Raw(raw) => self.print_raw_template_literal(raw),
                    E::Template::Head::Cooked(cooked) => {
                        if cooked.is_present() {
                            cooked.resolve_rope_if_needed(/* allocator dropped */);
                            self.print_string_characters_e_string(cooked, b'`');
                        }
                    }
                }

                for part in e.parts.iter() {
                    self.print(b"${");
                    self.print_expr(part.value, Level::Lowest, ExprFlag::none());
                    self.print(b"}");
                    match &part.tail {
                        E::Template::Head::Raw(raw) => self.print_raw_template_literal(raw),
                        E::Template::Head::Cooked(cooked) => {
                            if cooked.is_present() {
                                cooked.resolve_rope_if_needed(/* allocator dropped */);
                                self.print_string_characters_e_string(cooked, b'`');
                            }
                        }
                    }
                }
                self.print(b"`");
            }
            Expr::Data::ERegExp(e) => {
                self.add_source_mapping(expr.loc);
                self.print_reg_exp_literal(e);
            }
            Expr::Data::EBigInt(e) => {
                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(&e.value[..]);
                self.print(b'n');
            }
            Expr::Data::ENumber(e) => {
                self.add_source_mapping(expr.loc);
                self.print_number(e.value, level);
            }
            Expr::Data::EIdentifier(e) => {
                let name = self.renamer.name_for_symbol(e.ref_);
                let wrap = self.writer.written() == self.for_of_init_start && name == b"let";

                if wrap { self.print(b"("); }

                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print_identifier(name);

                if wrap { self.print(b")"); }
            }
            Expr::Data::EImportIdentifier(e) => {
                // Potentially use a property access instead of an identifier
                let mut did_print = false;

                let ref_ = if self.options.module_type != options::Format::InternalBakeDev {
                    self.symbols().follow(e.ref_)
                } else {
                    e.ref_
                };
                let symbol = self.symbols().get(ref_).unwrap();

                if symbol.import_item_status == Symbol::ImportItemStatus::Missing {
                    self.print_undefined(expr.loc, level);
                    did_print = true;
                } else if let Some(namespace) = &symbol.namespace_alias {
                    if (namespace.import_record_index as usize) < self.import_records.len() {
                        let import_record = self.import_record(namespace.import_record_index as usize);
                        if namespace.was_originally_property_access {
                            let mut wrap = false;
                            did_print = true;

                            if let Some(target) = &self.call_target {
                                wrap = e.was_originally_identifier
                                    && matches!(target, Expr::Data::EIdentifier(id) if id.ref_.eql(e.ref_));
                            }

                            if wrap { self.print_whitespacer(ws(b"(0, ")); }
                            self.print_space_before_identifier();
                            self.add_source_mapping(expr.loc);
                            self.print_namespace_alias(import_record, *namespace);

                            if wrap { self.print(b")"); }
                        } else if import_record.flags.was_originally_require && import_record.path.is_disabled {
                            self.add_source_mapping(expr.loc);

                            if import_record.flags.handles_import_errors {
                                self.print_require_error(&import_record.path.text);
                            } else {
                                self.print_disabled_import();
                            }
                            did_print = true;
                        }
                    }

                    if !did_print {
                        did_print = true;

                        let wrap = if let Some(target) = &self.call_target {
                            e.was_originally_identifier
                                && matches!(target, Expr::Data::EIdentifier(id) if id.ref_.eql(e.ref_))
                        } else {
                            false
                        };

                        if wrap { self.print_whitespacer(ws(b"(0, ")); }

                        self.print_space_before_identifier();
                        self.add_source_mapping(expr.loc);
                        self.print_symbol(namespace.namespace_ref);
                        let alias = &namespace.alias;
                        if js_lexer::is_identifier(alias) {
                            self.print(b".");
                            // TODO: addSourceMappingForName
                            self.print_identifier(alias);
                        } else {
                            self.print(b"[");
                            // TODO: addSourceMappingForName
                            self.print_string_literal_utf8(alias, false);
                            self.print(b"]");
                        }

                        if wrap { self.print(b")"); }
                    }
                }

                if !did_print {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print_symbol(e.ref_);
                }
            }
            Expr::Data::EAwait(e) => {
                let wrap = level.gte(Level::Prefix);
                if wrap { self.print(b"("); }

                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(b"await");
                self.print_space();
                self.print_expr(e.value, Level::Prefix.sub(1), ExprFlag::none());

                if wrap { self.print(b")"); }
            }
            Expr::Data::EYield(e) => {
                let wrap = level.gte(Level::Assign);
                if wrap { self.print(b"("); }

                self.print_space_before_identifier();
                self.add_source_mapping(expr.loc);
                self.print(b"yield");

                if let Some(val) = &e.value {
                    if e.is_star { self.print(b"*"); }
                    self.print_space();
                    self.print_expr(*val, Level::Yield, ExprFlag::none());
                }

                if wrap { self.print(b")"); }
            }
            Expr::Data::EUnary(e) => {
                let entry: &'static Op = Op::TABLE.get_ptr_const(e.op);
                let wrap = level.gte(entry.level);

                if wrap { self.print(b"("); }

                if !e.op.is_prefix() {
                    self.print_expr(e.value, Level::Postfix.sub(1), ExprFlag::none());
                }

                if entry.is_keyword {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(entry.text);
                    self.print_space();
                } else {
                    self.print_space_before_operator(e.op);
                    if e.op.is_prefix() {
                        self.add_source_mapping(expr.loc);
                    }
                    self.print(entry.text);
                    self.prev_op = e.op;
                    self.prev_op_end = self.writer.written();
                }

                if e.op.is_prefix() {
                    // Never turn "typeof (0, x)" into "typeof x" or "delete (0, x)" into "delete x"
                    if (e.op == Op::Code::UnTypeof && !e.flags.was_originally_typeof_identifier && self.is_unbound_identifier(&e.value))
                        || (e.op == Op::Code::UnDelete && !e.flags.was_originally_delete_of_identifier_or_property_access && is_identifier_or_numeric_constant_or_property_access(&e.value))
                    {
                        self.print(b"(0,");
                        self.print_space();
                        self.print_expr(e.value, Level::Prefix.sub(1), ExprFlag::none());
                        self.print(b")");
                    } else {
                        self.print_expr(e.value, Level::Prefix.sub(1), ExprFlag::none());
                    }
                }

                if wrap { self.print(b")"); }
            }
            Expr::Data::EBinary(e) => {
                // The handling of binary expressions is convoluted because we're using
                // iteration on the heap instead of recursion on the call stack to avoid
                // stack overflow for deeply-nested ASTs.
                let mut v = BinaryExpressionVisitor {
                    e,
                    level,
                    flags,
                    left_level: Level::Lowest,
                    left_flags: ExprFlag::none(),
                    entry: Op::TABLE.get_ptr_const(e.op),
                    wrap: false,
                    right_level: Level::Lowest,
                };

                // Use a single stack to reduce allocation overhead
                let stack_bottom = self.binary_expression_stack.len();

                loop {
                    if !self.binary_check_and_prepare(&mut v) {
                        break;
                    }

                    let left = v.e.left;
                    let left_binary: Option<&E::Binary> = if let Expr::Data::EBinary(b) = &left.data { Some(b) } else { None };

                    // Stop iterating if iteration doesn't apply to the left node
                    if left_binary.is_none() {
                        self.print_expr(left, v.left_level, v.left_flags);
                        self.binary_visit_right_and_finish(&v);
                        break;
                    }

                    // Only allocate heap memory on the stack for nested binary expressions
                    let lb = left_binary.unwrap();
                    let next = BinaryExpressionVisitor {
                        e: lb,
                        level: v.left_level,
                        flags: v.left_flags,
                        left_level: Level::Lowest,
                        left_flags: ExprFlag::none(),
                        entry: Op::TABLE.get_ptr_const(lb.op), // overwritten in checkAndPrepare
                        wrap: false,
                        right_level: Level::Lowest,
                    };
                    self.binary_expression_stack.push(v);
                    v = next;
                }

                // Process all binary operations from the deepest-visited node back toward
                // our original top-level binary operation
                while self.binary_expression_stack.len() > stack_bottom {
                    let last = self.binary_expression_stack.pop().unwrap();
                    self.binary_visit_right_and_finish(&last);
                }
            }
            Expr::Data::EInlinedEnum(e) => {
                self.print_expr(e.value, level, flags);
                if !self.options.minify_whitespace && !self.options.minify_identifiers {
                    self.print(b" /* ");
                    self.print(&e.comment[..]);
                    self.print(b" */");
                }
            }
            Expr::Data::ENameOfSymbol(e) => {
                let name = self.mangled_prop_name(e.ref_);
                self.add_source_mapping_for_name(expr.loc, name, e.ref_);

                if !self.options.minify_whitespace && e.has_property_key_comment {
                    self.print(b" /* @__KEY__ */");
                }

                self.print(b'"');
                self.print_string_characters_utf8(name, b'"');
                self.print(b'"');
            }
            Expr::Data::EJsxElement(_) | Expr::Data::EPrivateIdentifier(_) => {
                if cfg!(debug_assertions) {
                    Output::panic(format_args!("Unexpected expression of type .{}", <&'static str>::from(&expr.data)));
                }
            }
        }
    }

    pub fn print_space_before_operator(&mut self, next: Op::Code) {
        if self.prev_op_end == self.writer.written() {
            let prev = self.prev_op;
            // "+ + y" => "+ +y"
            // "+ ++ y" => "+ ++y"
            // "x + + y" => "x+ +y"
            // "x ++ + y" => "x+++y"
            // "x + ++ y" => "x+ ++y"
            // "-- >" => "-- >"
            // "< ! --" => "<! --"
            if ((prev == Op::Code::BinAdd || prev == Op::Code::UnPos) && (next == Op::Code::BinAdd || next == Op::Code::UnPos || next == Op::Code::UnPreInc))
                || ((prev == Op::Code::BinSub || prev == Op::Code::UnNeg) && (next == Op::Code::BinSub || next == Op::Code::UnNeg || next == Op::Code::UnPreDec))
                || (prev == Op::Code::UnPostDec && next == Op::Code::BinGt)
                || (prev == Op::Code::UnNot && next == Op::Code::UnPreDec && self.writer.written() > 1 && self.writer.prev_prev_char() == b'<')
            {
                self.print(b" ");
            }
        }
    }

    #[inline]
    pub fn print_dot_then_suffix(&mut self) {
        self.print(b")");
    }

    // This assumes the string has already been quoted.
    pub fn print_string_characters_e_string(&mut self, str: &E::String, c: u8) {
        if !str.is_utf8() {
            self.print_string_characters_utf16(str.slice16(), c);
        } else {
            self.print_string_characters_utf8(str.data(), c);
        }
    }

    pub fn print_namespace_alias(&mut self, _import_record: &ImportRecord, namespace: G::NamespaceAlias) {
        self.print_symbol(namespace.namespace_ref);

        // In the case of code like this:
        // module.exports = require("foo")
        // if "foo" is bundled
        // then we access it as the namespace symbol itself
        // that means the namespace alias is empty
        if namespace.alias.is_empty() { return; }

        if js_lexer::is_identifier(&namespace.alias) {
            self.print(b".");
            self.print_identifier(&namespace.alias);
        } else {
            self.print(b"[");
            self.print_string_literal_utf8(&namespace.alias, false);
            self.print(b"]");
        }
    }

    pub fn print_reg_exp_literal(&mut self, e: &E::RegExp) {
        let n = self.writer.written();

        // Avoid forming a single-line comment
        if n > 0 && self.writer.prev_char() == b'/' {
            self.print(b" ");
        }

        if IS_BUN_PLATFORM {
            // Translate any non-ASCII to unicode escape sequences
            let mut ascii_start: usize = 0;
            let mut is_ascii = false;
            let mut iter = CodepointIterator::init(&e.value);
            let mut cursor = CodepointIterator::Cursor::default();
            while iter.next(&mut cursor) {
                match cursor.c {
                    FIRST_ASCII..=LAST_ASCII => {
                        if !is_ascii {
                            ascii_start = cursor.i;
                            is_ascii = true;
                        }
                    }
                    _ => {
                        if is_ascii {
                            self.print(&e.value[ascii_start..cursor.i]);
                            is_ascii = false;
                        }

                        match cursor.c {
                            0..=0xFFFF => {
                                let c = usize::try_from(cursor.c).unwrap();
                                self.print(&[
                                    b'\\', b'u',
                                    HEX_CHARS[c >> 12], HEX_CHARS[(c >> 8) & 15],
                                    HEX_CHARS[(c >> 4) & 15], HEX_CHARS[c & 15],
                                ][..]);
                            }
                            c => {
                                let k = usize::try_from(c - 0x10000).unwrap();
                                let lo = usize::from(FIRST_HIGH_SURROGATE) + ((k >> 10) & 0x3FF);
                                let hi = usize::from(FIRST_LOW_SURROGATE) + (k & 0x3FF);
                                self.print(&[
                                    b'\\', b'u',
                                    HEX_CHARS[lo >> 12], HEX_CHARS[(lo >> 8) & 15], HEX_CHARS[(lo >> 4) & 15], HEX_CHARS[lo & 15],
                                    b'\\', b'u',
                                    HEX_CHARS[hi >> 12], HEX_CHARS[(hi >> 8) & 15], HEX_CHARS[(hi >> 4) & 15], HEX_CHARS[hi & 15],
                                ][..]);
                            }
                        }
                    }
                }
            }

            if is_ascii {
                self.print(&e.value[ascii_start..]);
            }
        } else {
            // UTF8 sequence is fine
            self.print(&e.value[..]);
        }

        // Need a space before the next identifier to avoid it turning into flags
        self.prev_reg_exp_end = self.writer.written();
    }

    pub fn print_property(&mut self, item_in: G::Property) {
        let mut item = item_in;
        if !IS_JSON {
            if item.kind == G::Property::Kind::Spread {
                self.print(b"...");
                self.print_expr(item.value.unwrap(), Level::Comma, ExprFlag::none());
                return;
            }

            // Handle key syntax compression for cross-module constant inlining of enums
            if self.options.minify_syntax && item.flags.contains(G::Property::Flags::IsComputed) {
                if let Some(dot) = item.key.as_ref().unwrap().data.as_e_dot() {
                    if let Some(value) = self.try_to_get_imported_enum_value(dot.target, &dot.name) {
                        match value {
                            js_ast::InlinedEnumValue::Decoded::String(str) => {
                                item.key.as_mut().unwrap().data = Expr::Data::EString(str);
                                // Problematic key names must stay computed for correctness
                                if !str.eql_comptime(b"__proto__") && !str.eql_comptime(b"constructor") && !str.eql_comptime(b"prototype") {
                                    item.flags.set_present(G::Property::Flags::IsComputed, false);
                                }
                            }
                            js_ast::InlinedEnumValue::Decoded::Number(num) => {
                                item.key.as_mut().unwrap().data = Expr::Data::ENumber(E::Number { value: num });
                                item.flags.set_present(G::Property::Flags::IsComputed, false);
                            }
                        }
                    }
                }
            }

            if item.flags.contains(G::Property::Flags::IsStatic) {
                self.print(b"static");
                self.print_space();
            }

            match item.kind {
                G::Property::Kind::Get => {
                    self.print_space_before_identifier();
                    self.print(b"get");
                    self.print_space();
                }
                G::Property::Kind::Set => {
                    self.print_space_before_identifier();
                    self.print(b"set");
                    self.print_space();
                }
                G::Property::Kind::AutoAccessor => {
                    self.print_space_before_identifier();
                    self.print(b"accessor");
                    self.print_space();
                }
                _ => {}
            }

            if let Some(val) = &item.value {
                if let Expr::Data::EFunction(func) = &val.data {
                    if item.flags.contains(G::Property::Flags::IsMethod) {
                        if func.func.flags.contains(G::FnFlags::IsAsync) {
                            self.print_space_before_identifier();
                            self.print(b"async");
                        }
                        if func.func.flags.contains(G::FnFlags::IsGenerator) {
                            self.print(b"*");
                        }
                        if func.func.flags.contains(G::FnFlags::IsGenerator) && func.func.flags.contains(G::FnFlags::IsAsync) {
                            self.print_space();
                        }
                    }
                }

                // If var is declared in a parent scope and var is then written via destructuring pattern, key is null
                if item.key.is_none() {
                    self.print_expr(*val, Level::Comma, ExprFlag::none());
                    return;
                }
            }
        }

        let key = item.key.unwrap();

        if !IS_JSON && item.flags.contains(G::Property::Flags::IsComputed) {
            self.print(b"[");
            self.print_expr(key, Level::Comma, ExprFlag::none());
            self.print(b"]");

            if let Some(val) = &item.value {
                if let Expr::Data::EFunction(func) = &val.data {
                    if item.flags.contains(G::Property::Flags::IsMethod) {
                        self.print_func(func.func);
                        return;
                    }
                }
                self.print(b":");
                self.print_space();
                self.print_expr(*val, Level::Comma, ExprFlag::none());
            }

            if let Some(initial) = &item.initializer {
                self.print_initializer(*initial);
            }
            return;
        }

        match &key.data {
            Expr::Data::EPrivateIdentifier(priv_) => {
                if IS_JSON { unreachable!(); }
                self.add_source_mapping(key.loc);
                self.print_symbol(priv_.ref_);
            }
            Expr::Data::EString(key_str) => {
                self.add_source_mapping(key.loc);
                if key_str.is_utf8() {
                    key_str.resolve_rope_if_needed(/* allocator dropped */);
                    self.print_space_before_identifier();
                    let mut allow_shorthand = true;
                    if !IS_JSON && js_lexer::is_identifier(key_str.data()) {
                        self.print_identifier(key_str.data());
                    } else {
                        allow_shorthand = false;
                        self.print_string_literal_e_string(key_str, false);
                    }

                    // Use a shorthand property if the names are the same
                    if let Some(val) = &item.value {
                        match &val.data {
                            Expr::Data::EIdentifier(e) => {
                                if key_str.eql(self.renamer.name_for_symbol(e.ref_)) {
                                    if let Some(initial) = &item.initializer {
                                        self.print_initializer(*initial);
                                    }
                                    if allow_shorthand { return; }
                                }
                            }
                            Expr::Data::EImportIdentifier(e) => 'inner: {
                                let ref_ = self.symbols().follow(e.ref_);
                                if self.options.input_files_for_dev_server.is_some() {
                                    break 'inner;
                                }
                                if let Some(symbol) = self.symbols().get(ref_) {
                                    if symbol.namespace_alias.is_none() && key_str.data() == self.renamer.name_for_symbol(e.ref_) {
                                        if let Some(initial) = &item.initializer {
                                            self.print_initializer(*initial);
                                        }
                                        if allow_shorthand { return; }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                } else if !IS_JSON && self.can_print_identifier_utf16(key_str.slice16()) {
                    self.print_space_before_identifier();
                    self.print_identifier_utf16(key_str.slice16()).expect("unreachable");

                    // Use a shorthand property if the names are the same
                    if let Some(val) = &item.value {
                        match &val.data {
                            Expr::Data::EIdentifier(e) => {
                                if item.flags.contains(G::Property::Flags::WasShorthand)
                                    || strings::utf16_eql_string(key_str.slice16(), self.renamer.name_for_symbol(e.ref_))
                                {
                                    if let Some(initial) = &item.initializer {
                                        self.print_initializer(*initial);
                                    }
                                    return;
                                }
                            }
                            Expr::Data::EImportIdentifier(e) => {
                                let ref_ = self.symbols().follow(e.ref_);
                                if let Some(symbol) = self.symbols().get(ref_) {
                                    if symbol.namespace_alias.is_none()
                                        && strings::utf16_eql_string(key_str.slice16(), self.renamer.name_for_symbol(e.ref_))
                                    {
                                        if let Some(initial) = &item.initializer {
                                            self.print_initializer(*initial);
                                        }
                                        return;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                } else {
                    let c = best_quote_char_for_string(key_str.slice16(), false);
                    self.print(c);
                    self.print_string_characters_utf16(key_str.slice16(), c);
                    self.print(c);
                }
            }
            _ => {
                if IS_JSON { unreachable!(); }
                self.print_expr(key, Level::Lowest, ExprFlagSet::empty());
            }
        }

        if item.kind != G::Property::Kind::Normal && item.kind != G::Property::Kind::AutoAccessor {
            if IS_JSON { unreachable!("item.kind must be normal in json"); }
            if let Expr::Data::EFunction(func) = &item.value.as_ref().unwrap().data {
                self.print_func(func.func);
                return;
            }
        }

        if let Some(val) = &item.value {
            if let Expr::Data::EFunction(f) = &val.data {
                if item.flags.contains(G::Property::Flags::IsMethod) {
                    self.print_func(f.func);
                    return;
                }
            }
            self.print(b":");
            self.print_space();
            self.print_expr(*val, Level::Comma, ExprFlagSet::empty());
        }

        if IS_JSON {
            debug_assert!(item.initializer.is_none());
        }

        if let Some(initial) = &item.initializer {
            self.print_initializer(*initial);
        }
    }

    pub fn print_initializer(&mut self, initial: Expr) {
        self.print_space();
        self.print(b"=");
        self.print_space();
        self.print_expr(initial, Level::Comma, ExprFlag::none());
    }

    pub fn print_binding(&mut self, binding: Binding, tlm: TopLevelAndIsExport) {
        match &binding.data {
            Binding::Data::BMissing => {}
            Binding::Data::BIdentifier(b) => {
                self.print_space_before_identifier();
                self.add_source_mapping(binding.loc);
                self.print_symbol(b.ref_);
                if Self::MAY_HAVE_MODULE_INFO {
                    if let Some(mi) = self.module_info() {
                        let local_name = self.renamer.name_for_symbol(b.ref_);
                        let name_id = mi.str(local_name);
                        if let Some(vk) = tlm.is_top_level { mi.add_var(name_id, vk); }
                        if tlm.is_export { mi.add_export_info_local(name_id, name_id); }
                    }
                }
            }
            Binding::Data::BArray(b) => {
                self.print(b"[");
                if !b.items.is_empty() {
                    if !b.is_single_line { self.indent(); }

                    for (i, item) in b.items.iter().enumerate() {
                        if i != 0 {
                            self.print(b",");
                            if b.is_single_line { self.print_space(); }
                        }

                        if !b.is_single_line {
                            self.print_newline();
                            self.print_indent();
                        }

                        let is_last = i + 1 == b.items.len();
                        if b.has_spread && is_last {
                            self.print(b"...");
                        }

                        self.print_binding(item.binding, tlm);
                        self.maybe_print_default_binding_value(item);

                        // Make sure there's a comma after trailing missing items
                        if is_last && matches!(item.binding.data, Binding::Data::BMissing) {
                            self.print(b",");
                        }
                    }

                    if !b.is_single_line {
                        self.unindent();
                        self.print_newline();
                        self.print_indent();
                    }
                }
                self.print(b"]");
            }
            Binding::Data::BObject(b) => {
                self.print(b"{");
                if !b.properties.is_empty() {
                    if !b.is_single_line { self.indent(); }

                    for (i, property) in b.properties.iter().enumerate() {
                        if i != 0 { self.print(b","); }

                        if b.is_single_line {
                            self.print_space();
                        } else {
                            self.print_newline();
                            self.print_indent();
                        }

                        if property.flags.contains(B::Property::Flags::IsSpread) {
                            self.print(b"...");
                        } else {
                            if property.flags.contains(B::Property::Flags::IsComputed) {
                                self.print(b"[");
                                self.print_expr(property.key, Level::Comma, ExprFlag::none());
                                self.print(b"]:");
                                self.print_space();

                                self.print_binding(property.value, tlm);
                                self.maybe_print_default_binding_value(property);
                                continue;
                            }

                            match &property.key.data {
                                Expr::Data::EString(str) => {
                                    str.resolve_rope_if_needed(/* allocator dropped */);
                                    self.add_source_mapping(property.key.loc);

                                    if str.is_utf8() {
                                        self.print_space_before_identifier();
                                        if js_lexer::is_identifier(str.data()) {
                                            self.print_identifier(str.data());

                                            // Use a shorthand property if the names are the same
                                            if let Binding::Data::BIdentifier(id) = &property.value.data {
                                                if str.eql(self.renamer.name_for_symbol(id.ref_)) {
                                                    if Self::MAY_HAVE_MODULE_INFO {
                                                        if let Some(mi) = self.module_info() {
                                                            let name_id = mi.str(str.data());
                                                            if let Some(vk) = tlm.is_top_level { mi.add_var(name_id, vk); }
                                                            if tlm.is_export { mi.add_export_info_local(name_id, name_id); }
                                                        }
                                                    }
                                                    self.maybe_print_default_binding_value(property);
                                                    continue;
                                                }
                                            }
                                        } else {
                                            self.print_string_literal_utf8(str.data(), false);
                                        }
                                    } else if self.can_print_identifier_utf16(str.slice16()) {
                                        self.print_space_before_identifier();
                                        self.print_identifier_utf16(str.slice16()).expect("unreachable");

                                        // Use a shorthand property if the names are the same
                                        if let Binding::Data::BIdentifier(id) = &property.value.data {
                                            if strings::utf16_eql_string(str.slice16(), self.renamer.name_for_symbol(id.ref_)) {
                                                if Self::MAY_HAVE_MODULE_INFO {
                                                    if let Some(mi) = self.module_info() {
                                                        let str8 = str.slice(/* allocator dropped */);
                                                        let name_id = mi.str(str8);
                                                        if let Some(vk) = tlm.is_top_level { mi.add_var(name_id, vk); }
                                                        if tlm.is_export { mi.add_export_info_local(name_id, name_id); }
                                                    }
                                                }
                                                self.maybe_print_default_binding_value(property);
                                                continue;
                                            }
                                        }
                                    } else {
                                        self.print_expr(property.key, Level::Lowest, ExprFlag::none());
                                    }
                                }
                                _ => {
                                    self.print_expr(property.key, Level::Lowest, ExprFlag::none());
                                }
                            }

                            self.print(b":");
                            self.print_space();
                        }

                        self.print_binding(property.value, tlm);
                        self.maybe_print_default_binding_value(property);
                    }

                    if !b.is_single_line {
                        self.unindent();
                        self.print_newline();
                        self.print_indent();
                    } else {
                        self.print_space();
                    }
                }
                self.print(b"}");
            }
        }
    }

    pub fn maybe_print_default_binding_value<P: HasDefaultValue>(&mut self, property: &P) {
        if let Some(default) = property.default_value() {
            self.print_space();
            self.print(b"=");
            self.print_space();
            self.print_expr(default, Level::Comma, ExprFlag::none());
        }
    }

    pub fn print_stmt(&mut self, stmt: Stmt, tlmtlo: TopLevel) -> Result<(), bun_core::Error> {
        let prev_stmt_tag = self.prev_stmt_tag;
        // Zig: `defer { p.prev_stmt_tag = std.meta.activeTag(stmt.data); }`
        // PORT NOTE: reshaped for borrowck — scopeguard would hold `&mut self.prev_stmt_tag`
        // across the whole match body and conflict with every `&mut self` call below. Instead
        // we assign `self.prev_stmt_tag = new_tag` at every return point (early + tail).
        let new_tag = stmt.data.tag();

        match &stmt.data {
            Stmt::Data::SComment(s) => {
                self.print_indent();
                self.add_source_mapping(stmt.loc);
                self.print_indented_comment(&s.text);
            }
            Stmt::Data::SFunction(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                let name = s.func.name.as_ref().unwrap_or_else(|| Output::panic("Internal error: expected func to have a name ref"));
                let name_ref = name.ref_.unwrap_or_else(|| Output::panic("Internal error: expected func to have a name"));

                if s.func.flags.contains(G::FnFlags::IsExport) {
                    if !REWRITE_ESM_TO_CJS { self.print(b"export "); }
                }
                if s.func.flags.contains(G::FnFlags::IsAsync) {
                    self.print(b"async ");
                }
                self.print(b"function");
                if s.func.flags.contains(G::FnFlags::IsGenerator) {
                    self.print(b"*");
                    self.print_space();
                } else {
                    self.print_space_before_identifier();
                }

                self.add_source_mapping(name.loc);
                let local_name = self.renamer.name_for_symbol(name_ref);
                self.print_identifier(local_name);
                self.print_func(s.func);

                if Self::MAY_HAVE_MODULE_INFO {
                    if let Some(mi) = self.module_info() {
                        let name_id = mi.str(local_name);
                        // function declarations are lexical (block-scoped in modules);
                        // only record at true top-level, not inside blocks.
                        if tlmtlo.is_top_level == IsTopLevel::Yes { mi.add_var(name_id, analyze_transpiled_module::ModuleInfo::VarKind::Lexical); }
                        if s.func.flags.contains(G::FnFlags::IsExport) { mi.add_export_info_local(name_id, name_id); }
                    }
                }

                self.print_newline();

                if REWRITE_ESM_TO_CJS && s.func.flags.contains(G::FnFlags::IsExport) {
                    self.print_indent();
                    self.print_bundled_export(local_name, local_name);
                    self.print_semicolon_after_statement();
                }
            }
            Stmt::Data::SClass(s) => {
                // Give an extra newline for readaiblity
                if prev_stmt_tag != Stmt::Tag::SEmpty {
                    self.print_newline();
                }

                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                let name_ref = s.class.class_name.as_ref().unwrap().ref_.unwrap();
                if s.is_export {
                    if !REWRITE_ESM_TO_CJS { self.print(b"export "); }
                }

                self.print(b"class ");
                self.add_source_mapping(s.class.class_name.as_ref().unwrap().loc);
                let name_str = self.renamer.name_for_symbol(name_ref);
                self.print_identifier(name_str);
                self.print_class(s.class);

                if Self::MAY_HAVE_MODULE_INFO {
                    if let Some(mi) = self.module_info() {
                        let name_id = mi.str(name_str);
                        if tlmtlo.is_top_level == IsTopLevel::Yes { mi.add_var(name_id, analyze_transpiled_module::ModuleInfo::VarKind::Lexical); }
                        if s.is_export { mi.add_export_info_local(name_id, name_id); }
                    }
                }

                if REWRITE_ESM_TO_CJS && s.is_export {
                    self.print_semicolon_after_statement();
                } else {
                    self.print_newline();
                }

                if REWRITE_ESM_TO_CJS {
                    if s.is_export {
                        self.print_indent();
                        let n = self.renamer.name_for_symbol(name_ref);
                        self.print_bundled_export(n, n);
                        self.print_semicolon_after_statement();
                    }
                }
            }
            Stmt::Data::SEmpty => {
                if prev_stmt_tag == Stmt::Tag::SEmpty && self.options.indent.count == 0 { self.prev_stmt_tag = new_tag; return Ok(()); }
                self.print_indent();
                self.add_source_mapping(stmt.loc);
                self.print(b";");
                self.print_newline();
            }
            Stmt::Data::SExportDefault(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"export default ");

                match &s.value {
                    js_ast::StmtOrExpr::Expr(expr) => {
                        // Functions and classes must be wrapped to avoid confusion with their statement forms
                        self.export_default_start = self.writer.written();
                        self.print_expr(*expr, Level::Comma, ExprFlag::none());
                        self.print_semicolon_after_statement();

                        if Self::MAY_HAVE_MODULE_INFO {
                            if let Some(mi) = self.module_info() {
                                mi.add_export_info_local(mi.str(b"default"), analyze_transpiled_module::StringID::STAR_DEFAULT);
                                mi.add_var(analyze_transpiled_module::StringID::STAR_DEFAULT, analyze_transpiled_module::ModuleInfo::VarKind::Lexical);
                            }
                        }
                        self.prev_stmt_tag = new_tag;
                        return Ok(());
                    }
                    js_ast::StmtOrExpr::Stmt(s2) => {
                        match &s2.data {
                            Stmt::Data::SFunction(func) => {
                                self.print_space_before_identifier();

                                if func.func.flags.contains(G::FnFlags::IsAsync) { self.print(b"async "); }
                                self.print(b"function");

                                if func.func.flags.contains(G::FnFlags::IsGenerator) {
                                    self.print(b"*");
                                    self.print_space();
                                } else {
                                    self.maybe_print_space();
                                }

                                let func_name: Option<&[u8]> = func.func.name.as_ref().map(|name| self.renamer.name_for_symbol(name.ref_.unwrap()));
                                if let Some(fn_name) = func_name {
                                    self.print_identifier(fn_name);
                                }

                                self.print_func(func.func);

                                if Self::MAY_HAVE_MODULE_INFO {
                                    if let Some(mi) = self.module_info() {
                                        let local_name = match func_name {
                                            Some(f) => mi.str(f),
                                            None => analyze_transpiled_module::StringID::STAR_DEFAULT,
                                        };
                                        mi.add_export_info_local(mi.str(b"default"), local_name);
                                        mi.add_var(local_name, analyze_transpiled_module::ModuleInfo::VarKind::Lexical);
                                    }
                                }

                                self.print_newline();
                            }
                            Stmt::Data::SClass(class) => {
                                self.print_space_before_identifier();

                                let class_name: Option<&[u8]> = class.class.class_name.as_ref().map(|name|
                                    self.renamer.name_for_symbol(name.ref_.unwrap_or_else(|| Output::panic("Internal error: Expected class to have a name ref")))
                                );
                                if let Some(name) = &class.class.class_name {
                                    self.print(b"class ");
                                    self.print_identifier(self.renamer.name_for_symbol(name.ref_.unwrap()));
                                } else {
                                    self.print(b"class");
                                }

                                self.print_class(class.class);

                                if Self::MAY_HAVE_MODULE_INFO {
                                    if let Some(mi) = self.module_info() {
                                        let local_name = match class_name {
                                            Some(f) => mi.str(f),
                                            None => analyze_transpiled_module::StringID::STAR_DEFAULT,
                                        };
                                        mi.add_export_info_local(mi.str(b"default"), local_name);
                                        mi.add_var(local_name, analyze_transpiled_module::ModuleInfo::VarKind::Lexical);
                                    }
                                }

                                self.print_newline();
                            }
                            _ => Output::panic("Internal error: unexpected export default stmt data"),
                        }
                    }
                }
            }
            Stmt::Data::SExportStar(s) => {
                // Give an extra newline for readaiblity
                if !prev_stmt_tag.is_export_like() {
                    self.print_newline();
                }
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);

                if s.alias.is_some() {
                    // TODO(port): comptime ws("export *").append(" as ")
                    self.print_whitespacer(Whitespacer { normal: b"export * as ", minify: b"export*as " });
                } else {
                    self.print_whitespacer(ws(b"export * from "));
                }

                if let Some(alias) = &s.alias {
                    self.print_clause_alias(&alias.original_name);
                    self.print(b" ");
                    self.print_whitespacer(ws(b"from "));
                }

                let irp = &self.import_record(s.import_record_index as usize).path.text;
                self.print_import_record_path(self.import_record(s.import_record_index as usize));
                self.print_semicolon_after_statement();

                if Self::MAY_HAVE_MODULE_INFO {
                    if let Some(mi) = self.module_info() {
                        let irp_id = mi.str(irp);
                        mi.request_module(irp_id, analyze_transpiled_module::ModuleInfo::FetchParameters::None);
                        if let Some(alias) = &s.alias {
                            mi.add_export_info_namespace(mi.str(&alias.original_name), irp_id);
                        } else {
                            mi.add_export_info_star(irp_id);
                        }
                    }
                }
            }
            Stmt::Data::SExportClause(s) => {
                if REWRITE_ESM_TO_CJS {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);

                    match s.items.len() {
                        0 => {}
                        // Object.assign(__export, {prop1, prop2, prop3});
                        _ => {
                            self.print(b"Object.assign");
                            self.print(b"(");
                            self.print_module_export_symbol();
                            self.print(b",");
                            self.print_space();
                            self.print(b"{");
                            self.print_space();
                            let last = s.items.len() - 1;
                            for (i, item) in s.items.iter().enumerate() {
                                let symbol = self.symbols().get_with_link(item.name.ref_.unwrap()).unwrap();
                                let name = &symbol.original_name;
                                let mut did_print = false;

                                if let Some(namespace) = &symbol.namespace_alias {
                                    let import_record = self.import_record(namespace.import_record_index as usize);
                                    if namespace.was_originally_property_access {
                                        self.print_identifier(name);
                                        self.print(b": () => ");
                                        self.print_namespace_alias(import_record, *namespace);
                                        did_print = true;
                                    }
                                }

                                if !did_print {
                                    self.print_clause_alias(&item.alias);
                                    if name != &item.alias {
                                        self.print(b":");
                                        self.print_space_before_identifier();
                                        self.print_identifier(name);
                                    }
                                }

                                if i < last { self.print(b","); }
                            }
                            self.print(b"})");
                            self.print_semicolon_after_statement();
                        }
                    }
                    self.prev_stmt_tag = new_tag;
                    return Ok(());
                }

                // Give an extra newline for export default for readability
                if !prev_stmt_tag.is_export_like() {
                    self.print_newline();
                }

                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"export");
                self.print_space();

                if s.items.is_empty() {
                    self.print(b"{}");
                    self.print_semicolon_after_statement();
                    self.prev_stmt_tag = new_tag;
                    return Ok(());
                }

                // PORT NOTE: Zig wraps `s.items` in an ArrayListUnmanaged and uses swapRemove
                // in-place. We mirror with a Vec view into the same backing storage.
                // TODO(port): lifetime — Zig mutates `s.items` in place via swapRemove. In Rust
                // the AST is arena-backed; need &mut access in Phase B.
                let mut array: Vec<js_ast::ClauseItem> = s.items.to_vec();
                {
                    let mut i: usize = 0;
                    while i < array.len() {
                        let item = array[i];

                        if !item.original_name.is_empty() {
                            if let Some(symbol) = self.symbols().get(item.name.ref_.unwrap()) {
                                if let Some(namespace) = &symbol.namespace_alias {
                                    let import_record = self.import_record(namespace.import_record_index as usize);
                                    if namespace.was_originally_property_access {
                                        self.print(b"var ");
                                        self.print_symbol(item.name.ref_.unwrap());
                                        self.print_equals();
                                        self.print_namespace_alias(import_record, *namespace);
                                        self.print_semicolon_after_statement();
                                        array.swap_remove(i);

                                        if i < array.len() {
                                            self.print_indent();
                                            self.print_space_before_identifier();
                                            self.print(b"export");
                                            self.print_space();
                                        }

                                        continue;
                                    }
                                }
                            }
                        }

                        i += 1;
                    }

                    if array.is_empty() {
                        self.prev_stmt_tag = new_tag;
                        return Ok(());
                    }
                    // s.items = array.items; — TODO(port): write back into AST in Phase B
                }

                self.print(b"{");

                if !s.is_single_line {
                    self.indent();
                } else {
                    self.print_space();
                }

                for (i, item) in array.iter().enumerate() {
                    if i != 0 {
                        self.print(b",");
                        if s.is_single_line { self.print_space(); }
                    }

                    if !s.is_single_line {
                        self.print_newline();
                        self.print_indent();
                    }

                    let name = self.renamer.name_for_symbol(item.name.ref_.unwrap());
                    self.print_export_clause_item(*item);

                    if Self::MAY_HAVE_MODULE_INFO {
                        if let Some(mi) = self.module_info() {
                            mi.add_export_info_local(mi.str(&item.alias), mi.str(name));
                        }
                    }
                }

                if !s.is_single_line {
                    self.unindent();
                    self.print_newline();
                    self.print_indent();
                } else {
                    self.print_space();
                }

                self.print(b"}");
                self.print_semicolon_after_statement();
            }
            Stmt::Data::SExportFrom(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);

                let import_record = self.import_record(s.import_record_index as usize);

                self.print_whitespacer(ws(b"export {"));

                if !s.is_single_line { self.indent(); } else { self.print_space(); }

                for (i, item) in s.items.iter().enumerate() {
                    if i != 0 {
                        self.print(b",");
                        if s.is_single_line { self.print_space(); }
                    }
                    if !s.is_single_line {
                        self.print_newline();
                        self.print_indent();
                    }
                    self.print_export_from_clause_item(*item);
                }

                if !s.is_single_line {
                    self.unindent();
                    self.print_newline();
                    self.print_indent();
                } else {
                    self.print_space();
                }

                self.print_whitespacer(ws(b"} from "));
                let irp = &import_record.path.text;
                self.print_import_record_path(import_record);
                self.print_semicolon_after_statement();

                if Self::MAY_HAVE_MODULE_INFO {
                    if let Some(mi) = self.module_info() {
                        let irp_id = mi.str(irp);
                        mi.request_module(irp_id, analyze_transpiled_module::ModuleInfo::FetchParameters::None);
                        for item in s.items.iter() {
                            let name = self.renamer.name_for_symbol(item.name.ref_.unwrap());
                            mi.add_export_info_indirect(mi.str(&item.alias), mi.str(name), irp_id);
                        }
                    }
                }
            }
            Stmt::Data::SLocal(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                match s.kind {
                    S::Local::Kind::KConst => self.print_decl_stmt(s.is_export, b"const", s.decls.slice(), tlmtlo),
                    S::Local::Kind::KLet => self.print_decl_stmt(s.is_export, b"let", s.decls.slice(), tlmtlo),
                    S::Local::Kind::KVar => self.print_decl_stmt(s.is_export, b"var", s.decls.slice(), tlmtlo),
                    S::Local::Kind::KUsing => self.print_decl_stmt(s.is_export, b"using", s.decls.slice(), tlmtlo),
                    S::Local::Kind::KAwaitUsing => self.print_decl_stmt(s.is_export, b"await using", s.decls.slice(), tlmtlo),
                }
            }
            Stmt::Data::SIf(s) => {
                self.print_indent();
                self.print_if(s, stmt.loc, tlmtlo.sub_var());
            }
            Stmt::Data::SDoWhile(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"do");
                let sub_var = tlmtlo.sub_var();
                match &s.body.data {
                    Stmt::Data::SBlock(block) => {
                        self.print_space();
                        self.print_block(s.body.loc, &block.stmts, block.close_brace_loc, sub_var);
                        self.print_space();
                    }
                    _ => {
                        self.print_newline();
                        self.indent();
                        self.print_stmt(s.body, sub_var).expect("unreachable");
                        self.print_semicolon_if_needed();
                        self.unindent();
                        self.print_indent();
                    }
                }

                self.print(b"while");
                self.print_space();
                self.print(b"(");
                self.print_expr(s.test_, Level::Lowest, ExprFlag::none());
                self.print(b")");
                self.print_semicolon_after_statement();
            }
            Stmt::Data::SForIn(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"for");
                self.print_space();
                self.print(b"(");
                self.print_for_loop_init(s.init);
                self.print_space();
                self.print_space_before_identifier();
                self.print(b"in");
                self.print_space();
                self.print_expr(s.value, Level::Lowest, ExprFlag::none());
                self.print(b")");
                self.print_body(s.body, tlmtlo.sub_var());
            }
            Stmt::Data::SForOf(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"for");
                if s.is_await { self.print(b" await"); }
                self.print_space();
                self.print(b"(");
                self.for_of_init_start = self.writer.written();
                self.print_for_loop_init(s.init);
                self.print_space();
                self.print_space_before_identifier();
                self.print(b"of");
                self.print_space();
                self.print_expr(s.value, Level::Comma, ExprFlag::none());
                self.print(b")");
                self.print_body(s.body, tlmtlo.sub_var());
            }
            Stmt::Data::SWhile(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"while");
                self.print_space();
                self.print(b"(");
                self.print_expr(s.test_, Level::Lowest, ExprFlag::none());
                self.print(b")");
                self.print_body(s.body, tlmtlo.sub_var());
            }
            Stmt::Data::SWith(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"with");
                self.print_space();
                self.print(b"(");
                self.print_expr(s.value, Level::Lowest, ExprFlag::none());
                self.print(b")");
                self.print_body(s.body, tlmtlo.sub_var());
            }
            Stmt::Data::SLabel(s) => {
                if !self.options.minify_whitespace && self.options.indent.count > 0 {
                    self.print_indent();
                }
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print_symbol(s.name.ref_.unwrap_or_else(|| Output::panic("Internal error: expected label to have a name")));
                self.print(b":");
                self.print_body(s.stmt, tlmtlo.sub_var());
            }
            Stmt::Data::STry(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"try");
                self.print_space();
                let sub_var_try = tlmtlo.sub_var();
                self.print_block(s.body_loc, &s.body, None, sub_var_try);

                if let Some(catch_) = &s.catch_ {
                    self.print_space();
                    self.add_source_mapping(catch_.loc);
                    self.print(b"catch");
                    if let Some(binding) = &catch_.binding {
                        self.print_space();
                        self.print(b"(");
                        self.print_binding(*binding, TopLevelAndIsExport::default());
                        self.print(b")");
                    }
                    self.print_space();
                    self.print_block(catch_.body_loc, &catch_.body, None, sub_var_try);
                }

                if let Some(finally) = &s.finally {
                    self.print_space();
                    self.print(b"finally");
                    self.print_space();
                    self.print_block(finally.loc, &finally.stmts, None, sub_var_try);
                }

                self.print_newline();
            }
            Stmt::Data::SFor(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"for");
                self.print_space();
                self.print(b"(");

                if let Some(init_) = &s.init {
                    self.print_for_loop_init(*init_);
                }

                self.print(b";");

                if let Some(test_) = &s.test_ {
                    self.print_expr(*test_, Level::Lowest, ExprFlag::none());
                }

                self.print(b";");
                self.print_space();

                if let Some(update) = &s.update {
                    self.print_expr(*update, Level::Lowest, ExprFlag::none());
                }

                self.print(b")");
                self.print_body(s.body, tlmtlo.sub_var());
            }
            Stmt::Data::SSwitch(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"switch");
                self.print_space();
                self.print(b"(");
                self.print_expr(s.test_, Level::Lowest, ExprFlag::none());
                self.print(b")");
                self.print_space();
                self.print(b"{");
                self.print_newline();
                self.indent();

                for c in s.cases.iter() {
                    self.print_semicolon_if_needed();
                    self.print_indent();

                    if let Some(val) = &c.value {
                        self.print(b"case");
                        self.print_space();
                        self.print_expr(*val, Level::LogicalAnd, ExprFlag::none());
                    } else {
                        self.print(b"default");
                    }

                    self.print(b":");

                    let sub_var_case = tlmtlo.sub_var();
                    if c.body.len() == 1 {
                        if let Stmt::Data::SBlock(block) = &c.body[0].data {
                            self.print_space();
                            self.print_block(c.body[0].loc, &block.stmts, block.close_brace_loc, sub_var_case);
                            self.print_newline();
                            continue;
                        }
                    }

                    self.print_newline();
                    self.indent();
                    for st in c.body.iter() {
                        self.print_semicolon_if_needed();
                        self.print_stmt(*st, sub_var_case).expect("unreachable");
                    }
                    self.unindent();
                }

                self.unindent();
                self.print_indent();
                self.print(b"}");
                self.print_newline();
                self.needs_semicolon = false;
            }
            Stmt::Data::SImport(s) => {
                debug_assert!((s.import_record_index as usize) < self.import_records.len());
                debug_assert!(self.options.module_type != options::Format::InternalBakeDev);

                let record: &ImportRecord = self.import_record(s.import_record_index as usize);
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);

                if IS_BUN_PLATFORM {
                    if record.tag == ImportRecord::Tag::Bun {
                        self.print_global_bun_import_statement(s.clone());
                        self.prev_stmt_tag = new_tag;
                        return Ok(());
                    }
                }

                if record.path.is_disabled {
                    if record.flags.contains_import_star {
                        self.print(b"var ");
                        self.print_symbol(s.namespace_ref);
                        self.print_equals();
                        self.print_disabled_import();
                        self.print_semicolon_after_statement();
                    }

                    if !s.items.is_empty() || s.default_name.is_some() {
                        self.print_indent();
                        self.print_space_before_identifier();
                        self.print_whitespacer(ws(b"var {"));

                        if let Some(default_name) = &s.default_name {
                            self.print_space();
                            self.print(b"default:");
                            self.print_space();
                            self.print_symbol(default_name.ref_.unwrap());

                            if !s.items.is_empty() {
                                self.print_space();
                                self.print(b",");
                                self.print_space();
                                for (i, item) in s.items.iter().enumerate() {
                                    self.print_clause_item_as(*item, ClauseItemAs::Var);
                                    if i < s.items.len() - 1 {
                                        self.print(b",");
                                        self.print_space();
                                    }
                                }
                            }
                        } else {
                            for (i, item) in s.items.iter().enumerate() {
                                self.print_clause_item_as(*item, ClauseItemAs::Var);
                                if i < s.items.len() - 1 {
                                    self.print(b",");
                                    self.print_space();
                                }
                            }
                        }

                        self.print(b"}");
                        self.print_equals();

                        if record.flags.contains_import_star {
                            self.print_symbol(s.namespace_ref);
                            self.print_semicolon_after_statement();
                        } else {
                            self.print_disabled_import();
                            self.print_semicolon_after_statement();
                        }
                    }

                    self.prev_stmt_tag = new_tag;
                    return Ok(());
                }

                if record.flags.handles_import_errors && record.path.is_disabled && record.kind.is_common_js() {
                    self.prev_stmt_tag = new_tag;
                    return Ok(());
                }

                self.print(b"import");

                let mut item_count: usize = 0;

                if let Some(name) = &s.default_name {
                    self.print(b" ");
                    self.print_symbol(name.ref_.unwrap());
                    item_count += 1;
                }

                if !s.items.is_empty() {
                    if item_count > 0 { self.print(b","); }
                    self.print_space();

                    self.print(b"{");
                    if !s.is_single_line { self.indent(); } else { self.print_space(); }

                    for (i, item) in s.items.iter().enumerate() {
                        if i != 0 {
                            self.print(b",");
                            if s.is_single_line { self.print_space(); }
                        }
                        if !s.is_single_line {
                            self.print_newline();
                            self.print_indent();
                        }
                        self.print_clause_item(*item);
                    }

                    if !s.is_single_line {
                        self.unindent();
                        self.print_newline();
                        self.print_indent();
                    } else {
                        self.print_space();
                    }
                    self.print(b"}");
                    item_count += 1;
                }

                if record.flags.contains_import_star {
                    if item_count > 0 { self.print(b","); }
                    self.print_space();
                    self.print_whitespacer(ws(b"* as"));
                    self.print(b" ");
                    self.print_symbol(s.namespace_ref);
                    item_count += 1;
                }

                if item_count > 0 {
                    if !self.options.minify_whitespace || record.flags.contains_import_star || s.items.is_empty() {
                        self.print(b" ");
                    }
                    self.print_whitespacer(ws(b"from "));
                }

                self.print_import_record_path(record);

                // backwards compatibility: previously, we always stripped type
                if IS_BUN_PLATFORM {
                    if let Some(loader) = record.loader {
                        use options::Loader;
                        match loader {
                            Loader::Jsx => self.print_whitespacer(ws(b" with { type: \"jsx\" }")),
                            Loader::Js => self.print_whitespacer(ws(b" with { type: \"js\" }")),
                            Loader::Ts => self.print_whitespacer(ws(b" with { type: \"ts\" }")),
                            Loader::Tsx => self.print_whitespacer(ws(b" with { type: \"tsx\" }")),
                            Loader::Css => self.print_whitespacer(ws(b" with { type: \"css\" }")),
                            Loader::File => self.print_whitespacer(ws(b" with { type: \"file\" }")),
                            Loader::Json => self.print_whitespacer(ws(b" with { type: \"json\" }")),
                            Loader::Jsonc => self.print_whitespacer(ws(b" with { type: \"jsonc\" }")),
                            Loader::Toml => self.print_whitespacer(ws(b" with { type: \"toml\" }")),
                            Loader::Yaml => self.print_whitespacer(ws(b" with { type: \"yaml\" }")),
                            Loader::Json5 => self.print_whitespacer(ws(b" with { type: \"json5\" }")),
                            Loader::Wasm => self.print_whitespacer(ws(b" with { type: \"wasm\" }")),
                            Loader::Napi => self.print_whitespacer(ws(b" with { type: \"napi\" }")),
                            Loader::Base64 => self.print_whitespacer(ws(b" with { type: \"base64\" }")),
                            Loader::Dataurl => self.print_whitespacer(ws(b" with { type: \"dataurl\" }")),
                            Loader::Text => self.print_whitespacer(ws(b" with { type: \"text\" }")),
                            Loader::Bunsh => self.print_whitespacer(ws(b" with { type: \"sh\" }")),
                            Loader::Sqlite | Loader::SqliteEmbedded => self.print_whitespacer(ws(b" with { type: \"sqlite\" }")),
                            Loader::Html => self.print_whitespacer(ws(b" with { type: \"html\" }")),
                            Loader::Md => self.print_whitespacer(ws(b" with { type: \"md\" }")),
                        }
                    }
                }
                self.print_semicolon_after_statement();

                if Self::MAY_HAVE_MODULE_INFO {
                    if let Some(mi) = self.module_info() {
                        let import_record_path = &record.path.text;
                        let irp_id = mi.str(import_record_path);
                        use analyze_transpiled_module::ModuleInfo::FetchParameters as FP;
                        let fetch_parameters: FP = if IS_BUN_PLATFORM {
                            if let Some(loader) = record.loader {
                                use options::Loader;
                                match loader {
                                    Loader::Json => FP::Json,
                                    Loader::Jsx => FP::host_defined(mi.str(b"jsx")),
                                    Loader::Js => FP::host_defined(mi.str(b"js")),
                                    Loader::Ts => FP::host_defined(mi.str(b"ts")),
                                    Loader::Tsx => FP::host_defined(mi.str(b"tsx")),
                                    Loader::Css => FP::host_defined(mi.str(b"css")),
                                    Loader::File => FP::host_defined(mi.str(b"file")),
                                    Loader::Jsonc => FP::host_defined(mi.str(b"jsonc")),
                                    Loader::Toml => FP::host_defined(mi.str(b"toml")),
                                    Loader::Yaml => FP::host_defined(mi.str(b"yaml")),
                                    Loader::Wasm => FP::host_defined(mi.str(b"wasm")),
                                    Loader::Napi => FP::host_defined(mi.str(b"napi")),
                                    Loader::Base64 => FP::host_defined(mi.str(b"base64")),
                                    Loader::Dataurl => FP::host_defined(mi.str(b"dataurl")),
                                    Loader::Text => FP::host_defined(mi.str(b"text")),
                                    Loader::Bunsh => FP::host_defined(mi.str(b"sh")),
                                    Loader::Sqlite | Loader::SqliteEmbedded => FP::host_defined(mi.str(b"sqlite")),
                                    Loader::Html => FP::host_defined(mi.str(b"html")),
                                    Loader::Json5 => FP::host_defined(mi.str(b"json5")),
                                    Loader::Md => FP::host_defined(mi.str(b"md")),
                                }
                            } else { FP::None }
                        } else { FP::None };
                        mi.request_module(irp_id, fetch_parameters);

                        if let Some(name) = &s.default_name {
                            let local_name = self.renamer.name_for_symbol(name.ref_.unwrap());
                            let local_name_id = mi.str(local_name);
                            mi.add_var(local_name_id, analyze_transpiled_module::ModuleInfo::VarKind::Lexical);
                            mi.add_import_info_single(irp_id, mi.str(b"default"), local_name_id, false);
                        }

                        for item in s.items.iter() {
                            let local_name = self.renamer.name_for_symbol(item.name.ref_.unwrap());
                            let local_name_id = mi.str(local_name);
                            mi.add_var(local_name_id, analyze_transpiled_module::ModuleInfo::VarKind::Lexical);
                            mi.add_import_info_single(irp_id, mi.str(&item.alias), local_name_id, false);
                        }

                        if record.flags.contains_import_star {
                            let local_name = self.renamer.name_for_symbol(s.namespace_ref);
                            mi.add_var(mi.str(local_name), analyze_transpiled_module::ModuleInfo::VarKind::Lexical);
                            mi.add_import_info_namespace(irp_id, mi.str(local_name));
                        }
                    }
                }
            }
            Stmt::Data::SBlock(s) => {
                self.print_indent();
                self.print_block(stmt.loc, &s.stmts, s.close_brace_loc, tlmtlo.sub_var());
                self.print_newline();
            }
            Stmt::Data::SDebugger => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"debugger");
                self.print_semicolon_after_statement();
            }
            Stmt::Data::SDirective(s) => {
                if IS_JSON { unreachable!(); }
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print_string_literal_utf8(&s.value, false);
                self.print_semicolon_after_statement();
            }
            Stmt::Data::SBreak(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"break");
                if let Some(label) = &s.label {
                    self.print(b" ");
                    self.print_symbol(label.ref_.unwrap());
                }
                self.print_semicolon_after_statement();
            }
            Stmt::Data::SContinue(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"continue");
                if let Some(label) = &s.label {
                    self.print(b" ");
                    self.print_symbol(label.ref_.unwrap());
                }
                self.print_semicolon_after_statement();
            }
            Stmt::Data::SReturn(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"return");
                if let Some(value) = &s.value {
                    self.print_space();
                    self.print_expr(*value, Level::Lowest, ExprFlag::none());
                }
                self.print_semicolon_after_statement();
            }
            Stmt::Data::SThrow(s) => {
                self.print_indent();
                self.print_space_before_identifier();
                self.add_source_mapping(stmt.loc);
                self.print(b"throw");
                self.print_space();
                self.print_expr(s.value, Level::Lowest, ExprFlag::none());
                self.print_semicolon_after_statement();
            }
            Stmt::Data::SExpr(s) => {
                if !self.options.minify_whitespace && self.options.indent.count > 0 {
                    self.print_indent();
                }
                self.stmt_start = self.writer.written();
                self.print_expr(s.value, Level::Lowest, ExprFlag::expr_result_is_unused());
                self.print_semicolon_after_statement();
            }
            other => {
                Output::panic(format_args!("Unexpected tag in printStmt: .{}", <&'static str>::from(other)));
            }
        }
        self.prev_stmt_tag = new_tag;
        Ok(())
    }

    #[inline]
    pub fn print_module_export_symbol(&mut self) {
        self.print(b"module.exports");
    }

    pub fn print_import_record_path(&mut self, import_record: &ImportRecord) {
        if IS_JSON { unreachable!(); }

        let quote = best_quote_char_for_string(&import_record.path.text, false);
        if import_record.flags.print_namespace_in_path && !import_record.path.is_file() {
            self.print(quote);
            self.print_string_characters_utf8(&import_record.path.namespace, quote);
            self.print(b":");
            self.print_string_characters_utf8(&import_record.path.text, quote);
            self.print(quote);
        } else {
            self.print(quote);
            self.print_string_characters_utf8(&import_record.path.text, quote);
            self.print(quote);
        }
    }

    pub fn print_bundled_import(&mut self, record: ImportRecord, s: &S::Import) {
        if record.flags.is_internal { return; }

        let import_record = self.import_record(s.import_record_index as usize);
        let is_disabled = import_record.path.is_disabled;
        let module_id = import_record.module_id;

        // If the bundled import was disabled and only imported for side effects we can skip it
        if record.path.is_disabled {
            if self.symbols().get(s.namespace_ref).is_none() { return; }
        }

        match ImportVariant::determine(&record, s) {
            ImportVariant::PathOnly => {
                if !is_disabled {
                    self.print_call_module_id(module_id);
                    self.print_semicolon_after_statement();
                }
            }
            ImportVariant::ImportItemsAndDefault | ImportVariant::ImportDefault => {
                if !is_disabled {
                    self.print(b"var $");
                    self.print_module_id(module_id);
                    self.print_equals();
                    self.print_load_from_bundle(s.import_record_index);

                    if let Some(default_name) = &s.default_name {
                        self.print(b", ");
                        self.print_symbol(default_name.ref_.unwrap());
                        self.print(b" = (($");
                        self.print_module_id(module_id);
                        self.print(b" && \"default\" in $");
                        self.print_module_id(module_id);
                        self.print(b") ? $");
                        self.print_module_id(module_id);
                        self.print(b".default : $");
                        self.print_module_id(module_id);
                        self.print(b")");
                    }
                } else {
                    if let Some(default_name) = &s.default_name {
                        self.print(b"var ");
                        self.print_symbol(default_name.ref_.unwrap());
                        self.print_equals();
                        self.print_disabled_import();
                    }
                }
                self.print_semicolon_after_statement();
            }
            ImportVariant::ImportStarAndImportDefault => {
                self.print(b"var ");
                self.print_symbol(s.namespace_ref);
                self.print_equals();
                self.print_load_from_bundle(s.import_record_index);

                if let Some(default_name) = &s.default_name {
                    self.print(b",");
                    self.print_space();
                    self.print_symbol(default_name.ref_.unwrap());
                    self.print_equals();

                    if !IS_BUN_PLATFORM {
                        self.print(b"(");
                        self.print_symbol(s.namespace_ref);
                        self.print_whitespacer(ws(b" && \"default\" in "));
                        self.print_symbol(s.namespace_ref);
                        self.print_whitespacer(ws(b" ? "));
                        self.print_symbol(s.namespace_ref);
                        self.print_whitespacer(ws(b".default : "));
                        self.print_symbol(s.namespace_ref);
                        self.print(b")");
                    } else {
                        self.print_symbol(s.namespace_ref);
                    }
                }
                self.print_semicolon_after_statement();
            }
            ImportVariant::ImportStar => {
                self.print(b"var ");
                self.print_symbol(s.namespace_ref);
                self.print_equals();
                self.print_load_from_bundle(s.import_record_index);
                self.print_semicolon_after_statement();
            }
            _ => {
                self.print(b"var $");
                self.print_module_id_assume_enabled(module_id);
                self.print_equals();
                self.print_load_from_bundle(s.import_record_index);
                self.print_semicolon_after_statement();
            }
        }
    }

    pub fn print_load_from_bundle(&mut self, import_record_index: u32) {
        self.print_load_from_bundle_without_call(import_record_index);
        self.print(b"()");
    }

    #[inline]
    fn print_disabled_import(&mut self) {
        self.print_whitespacer(ws(b"(() => ({}))"));
    }

    pub fn print_load_from_bundle_without_call(&mut self, import_record_index: u32) {
        let record = self.import_record(import_record_index as usize);
        if record.path.is_disabled {
            self.print_disabled_import();
            return;
        }
        self.print_module_id(self.import_record(import_record_index as usize).module_id);
    }

    pub fn print_call_module_id(&mut self, module_id: u32) {
        self.print_module_id(module_id);
        self.print(b"()");
    }

    #[inline]
    fn print_module_id(&mut self, module_id: u32) {
        debug_assert!(module_id != 0); // either module_id is forgotten or it should be disabled
        self.print_module_id_assume_enabled(module_id);
    }

    #[inline]
    fn print_module_id_assume_enabled(&mut self, module_id: u32) {
        self.print(b"$");
        let _ = self.fmt(format_args!("{:x}", module_id));
    }

    pub fn print_bundled_rexport(&mut self, name: &[u8], import_record_index: u32) {
        self.print(b"Object.defineProperty(");
        self.print_module_export_symbol();
        self.print(b",");
        self.print_string_literal_utf8(name, true);
        self.print_whitespacer(ws(b",{get: () => ("));
        self.print_load_from_bundle(import_record_index);
        self.print_whitespacer(ws(b"), enumerable: true, configurable: true})"));
    }

    // We must use Object.defineProperty() to handle re-exports from ESM -> CJS
    pub fn print_bundled_export(&mut self, name: &[u8], identifier: &[u8]) {
        self.print(b"Object.defineProperty(");
        self.print_module_export_symbol();
        self.print(b",");
        self.print_string_literal_utf8(name, true);
        self.print(b",{get: () => ");
        self.print_identifier(identifier);
        self.print(b", enumerable: true, configurable: true})");
    }

    pub fn print_for_loop_init(&mut self, init_st: Stmt) {
        match &init_st.data {
            Stmt::Data::SExpr(s) => {
                self.print_expr(s.value, Level::Lowest, ExprFlag::ForbidIn | ExprFlag::ExprResultIsUnused);
            }
            Stmt::Data::SLocal(s) => {
                let flags = ExprFlag::ForbidIn.into();
                match s.kind {
                    S::Local::Kind::KVar => self.print_decls(b"var", s.decls.slice(), flags, TopLevelAndIsExport::default()),
                    S::Local::Kind::KLet => self.print_decls(b"let", s.decls.slice(), flags, TopLevelAndIsExport::default()),
                    S::Local::Kind::KConst => self.print_decls(b"const", s.decls.slice(), flags, TopLevelAndIsExport::default()),
                    S::Local::Kind::KUsing => self.print_decls(b"using", s.decls.slice(), flags, TopLevelAndIsExport::default()),
                    S::Local::Kind::KAwaitUsing => self.print_decls(b"await using", s.decls.slice(), flags, TopLevelAndIsExport::default()),
                }
            }
            // for(;)
            Stmt::Data::SEmpty => {}
            _ => Output::panic("Internal error: Unexpected stmt in for loop"),
        }
    }

    pub fn print_if(&mut self, s: &S::If, loc: logger::Loc, tlmtlo: TopLevel) {
        self.print_space_before_identifier();
        self.add_source_mapping(loc);
        self.print(b"if");
        self.print_space();
        self.print(b"(");
        self.print_expr(s.test_, Level::Lowest, ExprFlag::none());
        self.print(b")");

        match &s.yes.data {
            Stmt::Data::SBlock(block) => {
                self.print_space();
                self.print_block(s.yes.loc, &block.stmts, block.close_brace_loc, tlmtlo);
                if s.no.is_some() { self.print_space(); } else { self.print_newline(); }
            }
            _ => {
                if Self::wrap_to_avoid_ambiguous_else(&s.yes.data) {
                    self.print_space();
                    self.print(b"{");
                    self.print_newline();

                    self.indent();
                    self.print_stmt(s.yes, tlmtlo).expect("unreachable");
                    self.unindent();
                    self.needs_semicolon = false;

                    self.print_indent();
                    self.print(b"}");

                    if s.no.is_some() { self.print_space(); } else { self.print_newline(); }
                } else {
                    self.print_newline();
                    self.indent();
                    self.print_stmt(s.yes, tlmtlo).expect("unreachable");
                    self.unindent();

                    if s.no.is_some() { self.print_indent(); }
                }
            }
        }

        if let Some(no_block) = &s.no {
            self.print_semicolon_if_needed();
            self.print_space_before_identifier();
            self.add_source_mapping(no_block.loc);
            self.print(b"else");

            match &no_block.data {
                Stmt::Data::SBlock(block) => {
                    self.print_space();
                    self.print_block(no_block.loc, &block.stmts, None, tlmtlo);
                    self.print_newline();
                }
                Stmt::Data::SIf(s_if) => {
                    self.print_if(s_if, no_block.loc, tlmtlo);
                }
                _ => {
                    self.print_newline();
                    self.indent();
                    self.print_stmt(*no_block, tlmtlo).expect("unreachable");
                    self.unindent();
                }
            }
        }
    }

    pub fn wrap_to_avoid_ambiguous_else(s_: &Stmt::Data) -> bool {
        let mut s = s_;
        loop {
            match s {
                Stmt::Data::SIf(index) => {
                    if let Some(no) = &index.no { s = &no.data; } else { return true; }
                }
                Stmt::Data::SFor(current) => s = &current.body.data,
                Stmt::Data::SForIn(current) => s = &current.body.data,
                Stmt::Data::SForOf(current) => s = &current.body.data,
                Stmt::Data::SWhile(current) => s = &current.body.data,
                Stmt::Data::SWith(current) => s = &current.body.data,
                _ => return false,
            }
        }
    }

    pub fn try_to_get_imported_enum_value(&self, target: Expr, name: &[u8]) -> Option<js_ast::InlinedEnumValue::Decoded> {
        if let Some(id) = target.data.as_e_import_identifier() {
            let ref_ = self.symbols().follow(id.ref_);
            if let Some(symbol) = self.symbols().get(ref_) {
                if symbol.kind == Symbol::Kind::TsEnum {
                    if let Some(enum_value) = self.options.ts_enums.get(ref_) {
                        if let Some(value) = enum_value.get(name) {
                            return Some(value.decode());
                        }
                    }
                }
            }
        }
        None
    }

    pub fn print_inlined_enum(&mut self, inlined: js_ast::InlinedEnumValue::Decoded, comment: &[u8], level: Level) {
        match inlined {
            js_ast::InlinedEnumValue::Decoded::Number(num) => self.print_number(num, level),
            // TODO: extract printString
            js_ast::InlinedEnumValue::Decoded::String(str) => self.print_expr(
                Expr { data: Expr::Data::EString(str), loc: logger::Loc::EMPTY },
                level,
                ExprFlagSet::empty(),
            ),
        }

        if !self.options.minify_whitespace && !self.options.minify_identifiers {
            // TODO: rewrite this to handle </script>
            if !strings::contains(comment, b"*/") {
                self.print(b" /* ");
                self.print(comment);
                self.print(b" */");
            }
        }
    }

    pub fn print_decl_stmt(&mut self, is_export: bool, keyword: &'static [u8], decls: &[G::Decl], tlmtlo: TopLevel) {
        if !REWRITE_ESM_TO_CJS && is_export {
            self.print(b"export ");
        }
        let tlm: TopLevelAndIsExport = if Self::MAY_HAVE_MODULE_INFO {
            TopLevelAndIsExport {
                is_export,
                is_top_level: if keyword == b"var" {
                    if tlmtlo.is_top_level() { Some(analyze_transpiled_module::ModuleInfo::VarKind::Declared) } else { None }
                } else {
                    // let/const are block-scoped: only record at true top-level,
                    // not inside blocks where subVar() downgrades to .var_only.
                    if tlmtlo.is_top_level == IsTopLevel::Yes { Some(analyze_transpiled_module::ModuleInfo::VarKind::Lexical) } else { None }
                },
            }
        } else {
            TopLevelAndIsExport::default()
        };
        self.print_decls(keyword, decls, ExprFlag::none(), tlm);
        self.print_semicolon_after_statement();
        if REWRITE_ESM_TO_CJS && is_export && !decls.is_empty() {
            for decl in decls {
                self.print_indent();
                self.print_symbol(self.options.runtime_imports.__export.as_ref().unwrap().ref_);
                self.print(b"(");
                self.print_space_before_identifier();
                self.print_module_export_symbol();
                self.print(b",");
                self.print_space();

                match &decl.binding.data {
                    Binding::Data::BIdentifier(ident) => {
                        self.print(b"{");
                        self.print_space();
                        self.print_symbol(ident.ref_);
                        if self.options.minify_whitespace { self.print(b":()=>("); } else { self.print(b": () => ("); }
                        self.print_symbol(ident.ref_);
                        self.print(b") }");
                    }
                    Binding::Data::BObject(obj) => {
                        self.print(b"{");
                        self.print_space();
                        for prop in obj.properties.iter() {
                            if let Binding::Data::BIdentifier(ident) = &prop.value.data {
                                self.print_symbol(ident.ref_);
                                if self.options.minify_whitespace { self.print(b":()=>("); } else { self.print(b": () => ("); }
                                self.print_symbol(ident.ref_);
                                self.print(b"),");
                                self.print_newline();
                            }
                        }
                        self.print(b"}");
                    }
                    _ => {
                        self.print_binding(decl.binding, TopLevelAndIsExport::default());
                    }
                }
                self.print(b")");
                self.print_semicolon_after_statement();
            }
        }
    }

    pub fn print_identifier(&mut self, identifier: &[u8]) {
        if ASCII_ONLY {
            self.print_identifier_ascii_only(identifier);
        } else {
            self.print(identifier);
        }
    }

    fn print_identifier_ascii_only(&mut self, identifier: &[u8]) {
        let mut ascii_start: usize = 0;
        let mut is_ascii = false;
        let mut iter = CodepointIterator::init(identifier);
        let mut cursor = CodepointIterator::Cursor::default();
        while iter.next(&mut cursor) {
            match cursor.c {
                FIRST_ASCII..=LAST_ASCII => {
                    if !is_ascii {
                        ascii_start = cursor.i;
                        is_ascii = true;
                    }
                }
                _ => {
                    if is_ascii {
                        self.print(&identifier[ascii_start..cursor.i]);
                        is_ascii = false;
                    }
                    self.print(b"\\u{");
                    let _ = self.fmt(format_args!("{:x}", cursor.c));
                    self.print(b"}");
                }
            }
        }

        if is_ascii {
            self.print(&identifier[ascii_start..]);
        }
    }

    pub fn print_identifier_utf16(&mut self, name: &[u16]) -> Result<(), bun_core::Error> {
        let n = name.len();
        let mut i: usize = 0;

        type CodeUnitType = u32;
        while i < n {
            let mut c: CodeUnitType = name[i] as CodeUnitType;
            i += 1;

            if c & !0x03ff == 0xd800 && i < n {
                c = 0x10000 + (((c & 0x03ff) << 10) | (name[i] as CodeUnitType & 0x03ff));
                i += 1;
            }

            if ASCII_ONLY && c > LAST_ASCII {
                match c {
                    0..=0xFFFF => {
                        let cu = usize::try_from(c).unwrap();
                        self.print(&[
                            b'\\', b'u',
                            HEX_CHARS[cu >> 12], HEX_CHARS[(cu >> 8) & 15],
                            HEX_CHARS[(cu >> 4) & 15], HEX_CHARS[cu & 15],
                        ][..]);
                    }
                    _ => {
                        self.print(b"\\u");
                        let buf_ptr = self.writer.reserve(4).expect("unreachable");
                        let mut tmp = [0u8; 4];
                        let len = strings::encode_wtf8_rune_t::<CodeUnitType>(&mut tmp, c);
                        // SAFETY: reserved 4 bytes
                        unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf_ptr, len); }
                        self.writer.advance(len as u64);
                    }
                }
                continue;
            }

            {
                let buf_ptr = self.writer.reserve(4).expect("unreachable");
                let mut tmp = [0u8; 4];
                let len = strings::encode_wtf8_rune_t::<CodeUnitType>(&mut tmp, c);
                // SAFETY: reserved 4 bytes
                unsafe { core::ptr::copy_nonoverlapping(tmp.as_ptr(), buf_ptr, len); }
                self.writer.advance(len as u64);
            }
        }
        Ok(())
    }

    pub fn print_number(&mut self, value: f64, level: Level) {
        let abs_value = value.abs();
        if value.is_nan() {
            self.print_space_before_identifier();
            self.print(b"NaN");
        } else if value.is_infinite() {
            let is_neg_inf = value.is_sign_negative();
            let wrap = ((!self.options.has_run_symbol_renamer || self.options.minify_syntax) && level.gte(Level::Multiply))
                || (is_neg_inf && level.gte(Level::Prefix));

            if wrap { self.print(b"("); }

            if is_neg_inf {
                self.print_space_before_operator(Op::Code::UnNeg);
                self.print(b"-");
            } else {
                self.print_space_before_identifier();
            }

            // If we are not running the symbol renamer, we must not print "Infinity".
            if IS_JSON || (!self.options.minify_syntax && self.options.has_run_symbol_renamer) {
                self.print(b"Infinity");
            } else if self.options.minify_whitespace {
                self.print(b"1/0");
            } else {
                self.print(b"1 / 0");
            }

            if wrap { self.print(b")"); }
        } else if !value.is_sign_negative() {
            self.print_space_before_identifier();
            self.print_non_negative_float(abs_value);
            // Remember the end of the latest number
            self.prev_num_end = self.writer.written();
        } else if level.gte(Level::Prefix) {
            // Expressions such as "(-1).toString" need to wrap negative numbers.
            // Instead of testing for "value < 0" we test for "signbit(value)" and
            // "!isNaN(value)" because we need this to be true for "-0" and "-0 < 0"
            // is false.
            self.print(b"(-");
            self.print_non_negative_float(abs_value);
            self.print(b")");
        } else {
            self.print_space_before_operator(Op::Code::UnNeg);
            self.print(b"-");
            self.print_non_negative_float(abs_value);
            // Remember the end of the latest number
            self.prev_num_end = self.writer.written();
        }
    }

    pub fn print_indented_comment(&mut self, _text: &[u8]) {
        let mut text = _text;
        if text.starts_with(b"/*") {
            // Re-indent multi-line comments
            while let Some(newline_index) = strings::index_of_char(text, b'\n') {
                // Skip over \r if it precedes \n
                if newline_index > 0 && text[newline_index - 1] == b'\r' {
                    self.print(&text[..newline_index - 1]);
                    self.print(b"\n");
                } else {
                    self.print(&text[..newline_index + 1]);
                }
                self.print_indent();
                text = &text[newline_index + 1..];
            }
            self.print(text);
            self.print_newline();
        } else {
            // Print a mandatory newline after single-line comments
            if !text.is_empty() && text[text.len() - 1] == b'\r' {
                text = &text[..text.len() - 1];
            }
            self.print(text);
            self.print(b"\n");
        }
    }

    pub fn init(
        writer: W,
        import_records: &'a [ImportRecord],
        opts: Options<'a>,
        renamer: rename::Renamer,
        source_map_builder: SourceMap::Chunk::Builder,
    ) -> Self {
        let mut printer = Self {
            import_records,
            needs_semicolon: false,
            stmt_start: -1,
            options: opts,
            export_default_start: -1,
            arrow_expr_start: -1,
            for_of_init_start: -1,
            prev_op: Op::Code::BinAdd,
            prev_op_end: -1,
            prev_num_end: -1,
            prev_reg_exp_end: -1,
            call_target: None,
            writer,
            has_printed_bundled_import_statement: false,
            renamer,
            prev_stmt_tag: Stmt::Tag::SEmpty,
            source_map_builder,
            symbol_counter: 0,
            temporary_bindings: Vec::new(),
            binary_expression_stack: Vec::new(),
            was_lazy_export: false,
            module_info: None,
        };
        if GENERATE_SOURCE_MAP {
            // This seems silly to cache but the .items() function apparently costs 1ms according to Instruments.
            printer.source_map_builder.line_offset_table_byte_offset_list =
                printer.source_map_builder.line_offset_tables.items_byte_offset_to_start_of_line();
        }
        printer
    }

    fn print_dev_server_module(&mut self, source: &logger::Source, ast: &Ast, part: &js_ast::Part) {
        self.indent();
        self.print_indent();

        self.print_string_literal_utf8(&source.path.pretty, false);

        let func = &part.stmts[0].data.as_s_expr().unwrap().value.data.as_e_function().unwrap().func;

        // Special-case lazy-export AST
        if ast.has_lazy_export {
            // @branchHint(.unlikely)
            self.print_fn_args(func.open_parens_loc, &func.args, func.flags.contains(G::FnFlags::HasRestArg), false);
            self.print_space();
            self.print(b"{\n");
            let lazy = func.body.stmts[0].data.as_s_lazy_export().unwrap();
            if !matches!(*lazy, Expr::Data::EUndefined) {
                self.indent();
                self.print_indent();
                self.print_symbol(self.options.hmr_ref);
                self.print(b".cjs.exports = ");
                self.print_expr(Expr { data: lazy.clone(), loc: func.body.stmts[0].loc }, Level::Comma, ExprFlagSet::empty());
                self.print(b"; // bun .s_lazy_export\n");
                self.unindent();
            }
            self.print_indent();
            self.print(b"},\n");
            return;
        }
        // ESM is represented by an array tuple [ dependencies, exports, starImports, load, async ];
        else if ast.exports_kind == js_ast::ExportsKind::Esm {
            self.print(b": [ [");
            // Print the dependencies.
            if part.stmts.len() > 1 {
                self.indent();
                self.print(b"\n");
                for stmt in &part.stmts[1..] {
                    self.print_indent();
                    let import = stmt.data.as_s_import().unwrap();
                    let record = self.import_record(import.import_record_index as usize);
                    self.print_string_literal_utf8(&record.path.pretty, false);

                    let item_count = u32::from(import.default_name.is_some()) + u32::try_from(import.items.len()).unwrap();
                    let _ = self.fmt(format_args!(", {},", item_count));
                    if item_count == 0 {
                        // Add a comment explaining why the number could be zero
                        self.print(if import.star_name_loc.is_some() { b" // namespace import".as_slice() } else { b" // bare import".as_slice() });
                    } else {
                        if import.default_name.is_some() {
                            self.print(b" \"default\",");
                        }
                        for item in import.items.iter() {
                            self.print(b" ");
                            self.print_string_literal_utf8(&item.alias, false);
                            self.print(b",");
                        }
                    }
                    self.print(b"\n");
                }
                self.unindent();
                self.print_indent();
            }
            self.print(b"], [");

            // Print the exports
            if ast.named_exports.count() > 0 {
                self.indent();
                let mut len: usize = usize::MAX;
                for key in ast.named_exports.keys() {
                    if len > 120 {
                        self.print_newline();
                        self.print_indent();
                        len = 0;
                    } else {
                        self.print(b" ");
                    }
                    len += key.len();
                    self.print_string_literal_utf8(key, false);
                    self.print(b",");
                }
                self.unindent();
                self.print_newline();
                self.print_indent();
            }
            self.print(b"], [");

            // Print export stars
            self.indent();
            let mut had_any_stars = false;
            for &star in ast.export_star_import_records.iter() {
                let record = self.import_record(star as usize);
                if record.path.is_disabled { continue; }
                had_any_stars = true;
                self.print_newline();
                self.print_indent();
                self.print_string_literal_utf8(&record.path.pretty, false);
                self.print(b",");
            }
            self.unindent();
            if had_any_stars {
                self.print_newline();
                self.print_indent();
            }
            self.print(b"], ");

            // Print the code
            if !ast.top_level_await_keyword.is_empty() { self.print(b"async"); }
            self.print_fn_args(func.open_parens_loc, &func.args, func.flags.contains(G::FnFlags::HasRestArg), false);
            self.print(b" => {\n");
            self.indent();
            self.print_block_body(&func.body.stmts, TopLevel::init(IsTopLevel::No));
            self.unindent();
            self.print_indent();
            self.print(b"}, ");

            // Print isAsync
            self.print(if !ast.top_level_await_keyword.is_empty() { b"true".as_slice() } else { b"false".as_slice() });
            self.print(b"],\n");
        } else {
            debug_assert!(ast.exports_kind == js_ast::ExportsKind::Cjs);
            self.print_func(*func);
            self.print(b",\n");
        }

        self.unindent();
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PrintArg helper trait (Zig's `anytype` for `print()`)
// ───────────────────────────────────────────────────────────────────────────

pub trait PrintArg {
    fn print_into<W: WriterTrait>(self, w: &mut W);
}
impl PrintArg for u8 {
    fn print_into<W: WriterTrait>(self, w: &mut W) { w.print_byte(self); }
}
impl PrintArg for &[u8] {
    fn print_into<W: WriterTrait>(self, w: &mut W) { w.print_slice(self); }
}
impl<const N: usize> PrintArg for &[u8; N] {
    fn print_into<W: WriterTrait>(self, w: &mut W) { w.print_slice(self); }
}

/// Trait covering `B::ArrayItem` / `B::Property` for `maybe_print_default_binding_value`.
pub trait HasDefaultValue {
    fn default_value(&self) -> Option<Expr>;
}
// TODO(port): impl HasDefaultValue for B::ArrayItem and B::Property in bun_js_parser.

// ───────────────────────────────────────────────────────────────────────────
// Writer (NewWriter)
// ───────────────────────────────────────────────────────────────────────────

pub struct WriteResult {
    pub off: u32,
    pub len: usize,
    pub end_off: u32,
}

/// Backend operations a `Writer` context provides. Mirrors the comptime fn-pointer
/// params of Zig's `NewWriter(...)`.
pub trait WriterContext {
    fn write_byte(&mut self, char: u8) -> Result<usize, bun_core::Error>;
    fn write_all(&mut self, buf: &[u8]) -> Result<usize, bun_core::Error>;
    fn get_last_byte(&self) -> u8;
    fn get_last_last_byte(&self) -> u8;
    fn reserve_next(&mut self, count: u64) -> Result<*mut u8, bun_core::Error>;
    fn advance_by(&mut self, count: u64);
    fn slice(&self) -> &[u8];
    fn get_mutable_buffer(&mut self) -> &mut MutableString;
    fn take_buffer(&mut self) -> MutableString;
    fn get_written(&self) -> &[u8];
    fn flush(&mut self) -> Result<(), bun_core::Error> { Ok(()) }
    fn done(&mut self) -> Result<(), bun_core::Error> { Ok(()) }
    // TODO(port): copyFileRange optional method (`@hasDecl` check in Zig)
}

/// Abstracted writer interface used by `Printer` (the methods Printer calls on `p.writer`).
pub trait WriterTrait {
    fn written(&self) -> i32;
    fn prev_char(&self) -> u8;
    fn prev_prev_char(&self) -> u8;
    fn print_byte(&mut self, b: u8);
    fn print_slice(&mut self, s: &[u8]);
    fn reserve(&mut self, count: u64) -> Result<*mut u8, bun_core::Error>;
    fn advance(&mut self, count: u64);
    fn slice(&self) -> &[u8];
    fn get_error(&self) -> Result<(), bun_core::Error>;
    fn done(&mut self) -> Result<(), bun_core::Error>;
    fn std_writer(&mut self) -> StdWriterAdapter<'_, Self> where Self: Sized {
        StdWriterAdapter(self)
    }
    fn take_buffer(&mut self) -> MutableString;
    // TODO(port): get_mutable_buffer / ctx access for source-map chunk generation
}

pub struct StdWriterAdapter<'a, W: ?Sized>(&'a mut W);
impl<'a, W: WriterTrait + ?Sized> bun_io::Write for StdWriterAdapter<'a, W> {
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        self.0.print_slice(bytes);
        Ok(())
    }
}

pub struct Writer<C: WriterContext> {
    pub ctx: C,
    pub written: i32,
    // Used by the printer
    pub prev_char: u8,
    pub prev_prev_char: u8,
    pub err: Option<bun_core::Error>,
    pub orig_err: Option<bun_core::Error>,
}

impl<C: WriterContext> Writer<C> {
    pub fn init(ctx: C) -> Self {
        Self { ctx, written: -1, prev_char: 0, prev_prev_char: 0, err: None, orig_err: None }
    }

    pub fn std_writer_write(&mut self, bytes: &[u8]) -> Result<usize, core::convert::Infallible> {
        self.print_slice(bytes);
        Ok(bytes.len())
    }

    pub fn is_copy_file_range_supported() -> bool {
        // TODO(port): @hasDecl(ContextType, "copyFileRange")
        false
    }

    pub fn copy_file_range(ctx: C, in_file: Fd, start: usize, end: usize) -> Result<(), bun_core::Error> {
        // TODO(port): ctx.sendfile(in_file, start, end)
        let _ = (ctx, in_file, start, end);
        Ok(())
    }

    pub fn get_mutable_buffer(&mut self) -> &mut MutableString { self.ctx.get_mutable_buffer() }
    pub fn take_buffer(&mut self) -> MutableString { self.ctx.take_buffer() }
    pub fn slice(&self) -> &[u8] { self.ctx.slice() }

    pub fn get_error(&self) -> Result<(), bun_core::Error> {
        if let Some(e) = self.orig_err { return Err(e); }
        if let Some(e) = self.err { return Err(e); }
        Ok(())
    }

    #[inline] pub fn prev_char(&self) -> u8 { self.ctx.get_last_byte() }
    #[inline] pub fn prev_prev_char(&self) -> u8 { self.ctx.get_last_last_byte() }

    pub fn reserve(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> {
        self.ctx.reserve_next(count)
    }

    pub fn advance(&mut self, count: u64) {
        self.ctx.advance_by(count);
        self.written += i32::try_from(count).unwrap();
    }

    pub fn write_all(&mut self, bytes: &[u8]) -> Result<usize, bun_core::Error> {
        let written = self.written.max(0);
        self.print_slice(bytes);
        Ok(usize::try_from(self.written).unwrap() - usize::try_from(written).unwrap())
    }

    #[inline]
    pub fn print_byte(&mut self, b: u8) {
        let written = match self.ctx.write_byte(b) {
            Ok(n) => n,
            Err(err) => { self.orig_err = Some(err); 0 }
        };
        self.written += i32::try_from(written).unwrap();
        if written == 0 { self.err = Some(bun_core::err!("WriteFailed")); }
    }

    #[inline]
    pub fn print_slice(&mut self, s: &[u8]) {
        let written = match self.ctx.write_all(s) {
            Ok(n) => n,
            Err(err) => { self.orig_err = Some(err); 0 }
        };
        self.written += i32::try_from(written).unwrap();
        if written < s.len() {
            self.err = Some(if written == 0 { bun_core::err!("WriteFailed") } else { bun_core::err!("PartialWrite") });
        }
    }

    pub fn flush(&mut self) -> Result<(), bun_core::Error> { self.ctx.flush() }
    pub fn done(&mut self) -> Result<(), bun_core::Error> { self.ctx.done() }
}

impl<C: WriterContext> WriterTrait for Writer<C> {
    fn written(&self) -> i32 { self.written }
    fn prev_char(&self) -> u8 { self.prev_char() }
    fn prev_prev_char(&self) -> u8 { self.prev_prev_char() }
    fn print_byte(&mut self, b: u8) { self.print_byte(b) }
    fn print_slice(&mut self, s: &[u8]) { self.print_slice(s) }
    fn reserve(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> { self.reserve(count) }
    fn advance(&mut self, count: u64) { self.advance(count) }
    fn slice(&self) -> &[u8] { self.slice() }
    fn get_error(&self) -> Result<(), bun_core::Error> { self.get_error() }
    fn done(&mut self) -> Result<(), bun_core::Error> { self.done() }
    fn take_buffer(&mut self) -> MutableString { self.take_buffer() }
}

// `&mut W` forwards to `W` so `printWithWriter(*BufferPrinter, ...)` works.
impl<W: WriterTrait> WriterTrait for &mut W {
    fn written(&self) -> i32 { (**self).written() }
    fn prev_char(&self) -> u8 { (**self).prev_char() }
    fn prev_prev_char(&self) -> u8 { (**self).prev_prev_char() }
    fn print_byte(&mut self, b: u8) { (**self).print_byte(b) }
    fn print_slice(&mut self, s: &[u8]) { (**self).print_slice(s) }
    fn reserve(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> { (**self).reserve(count) }
    fn advance(&mut self, count: u64) { (**self).advance(count) }
    fn slice(&self) -> &[u8] { (**self).slice() }
    fn get_error(&self) -> Result<(), bun_core::Error> { (**self).get_error() }
    fn done(&mut self) -> Result<(), bun_core::Error> { (**self).done() }
    fn take_buffer(&mut self) -> MutableString { (**self).take_buffer() }
}

// ───────────────────────────────────────────────────────────────────────────
// DirectWriter / BufferWriter
// ───────────────────────────────────────────────────────────────────────────

pub struct DirectWriter {
    pub handle: Fd,
}

impl DirectWriter {
    pub fn write(&mut self, buf: &[u8]) -> Result<usize, bun_core::Error> {
        // TODO(port): Zig used std.posix.write directly. Route via bun_sys::write.
        bun_sys::write(self.handle, buf).map_err(Into::into)
    }
    pub fn write_all(&mut self, buf: &[u8]) -> Result<(), bun_core::Error> {
        let _ = bun_sys::write(self.handle, buf)?;
        Ok(())
    }
}

pub struct BufferWriter {
    pub buffer: MutableString,
    pub written: Box<[u8]>,
    pub sentinel: bun_str::ZStr<'static>, // TODO(port): lifetime — Zig stored a sentinel slice into `buffer`
    pub append_null_byte: bool,
    pub append_newline: bool,
    pub approximate_newline_count: usize,
    pub last_bytes: [u8; 2],
}

impl BufferWriter {
    pub fn get_mutable_buffer(&mut self) -> &mut MutableString { &mut self.buffer }

    pub fn take_buffer(&mut self) -> MutableString {
        core::mem::replace(&mut self.buffer, MutableString::init_empty())
    }

    pub fn get_written(&self) -> &[u8] { self.buffer.list.as_slice() }

    pub fn init() -> BufferWriter {
        BufferWriter {
            buffer: MutableString::init_empty(),
            written: Box::default(),
            sentinel: bun_str::ZStr::EMPTY,
            append_null_byte: false,
            append_newline: false,
            approximate_newline_count: 0,
            last_bytes: [0, 0],
        }
    }

    pub fn print(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), bun_core::Error> {
        use std::io::Write as _;
        write!(self.buffer.list_writer(), "{}", args).map_err(|_| bun_core::err!("WriteFailed"))
    }

    pub fn write_byte_n_times(&mut self, byte: u8, n: usize) -> Result<(), bun_core::Error> {
        self.buffer.append_char_n_times(byte, n)
    }
    // alias
    pub fn splat_byte_all(&mut self, byte: u8, n: usize) -> Result<(), bun_core::Error> {
        self.write_byte_n_times(byte, n)
    }

    pub fn write_byte(&mut self, byte: u8) -> Result<usize, bun_core::Error> {
        self.buffer.append_char(byte)?;
        self.approximate_newline_count += (byte == b'\n') as usize;
        self.last_bytes = [self.last_bytes[1], byte];
        Ok(1)
    }

    pub fn write_all(&mut self, bytes: &[u8]) -> Result<usize, bun_core::Error> {
        self.buffer.append(bytes)?;
        self.approximate_newline_count += (!bytes.is_empty() && bytes[bytes.len() - 1] == b'\n') as usize;

        if bytes.len() >= 2 {
            self.last_bytes = [bytes[bytes.len() - 2], bytes[bytes.len() - 1]];
        } else if bytes.len() >= 1 {
            self.last_bytes = [self.last_bytes[1], bytes[bytes.len() - 1]];
        }

        Ok(bytes.len())
    }

    pub fn slice(&self) -> &[u8] { self.buffer.list.as_slice() }

    pub fn get_last_byte(&self) -> u8 { self.last_bytes[1] }
    pub fn get_last_last_byte(&self) -> u8 { self.last_bytes[0] }

    pub fn reserve_next(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> {
        self.buffer.grow_if_needed(usize::try_from(count).unwrap())?;
        // SAFETY: grow_if_needed ensured capacity; pointer to one-past-len is valid for write
        unsafe { Ok(self.buffer.list.as_mut_ptr().add(self.buffer.list.len())) }
    }

    pub fn advance_by(&mut self, count: u64) {
        let count_usize = usize::try_from(count).unwrap();
        if cfg!(debug_assertions) {
            debug_assert!(self.buffer.list.len() + count_usize <= self.buffer.list.capacity());
        }
        // SAFETY: reserve_next was called and the bytes were initialized
        unsafe { self.buffer.list.set_len(self.buffer.list.len() + count_usize); }

        let len = self.buffer.list.len();
        if count >= 2 {
            self.last_bytes = [self.buffer.list[len - 2], self.buffer.list[len - 1]];
        } else if count >= 1 {
            self.last_bytes = [self.last_bytes[1], self.buffer.list[len - 1]];
        }
    }

    pub fn reset(&mut self) {
        self.buffer.reset();
        self.approximate_newline_count = 0;
        self.written = Box::default();
    }

    pub fn written_without_trailing_zero(&self) -> &[u8] {
        let mut written = &self.written[..];
        while !written.is_empty() && written[written.len() - 1] == 0 {
            written = &written[..written.len() - 1];
        }
        written
    }

    pub fn done(&mut self) -> Result<(), bun_core::Error> {
        if self.append_newline {
            self.append_newline = false;
            self.buffer.append_char(b'\n')?;
        }

        if self.append_null_byte {
            // TODO(port): self.sentinel = self.buffer.slice_with_sentinel() — borrows buffer
            self.written = self.buffer.slice().to_vec().into_boxed_slice(); // TODO(port): avoid copy; Zig aliased
        } else {
            self.written = self.buffer.slice().to_vec().into_boxed_slice(); // TODO(port): avoid copy
        }
        Ok(())
    }

    pub fn flush(&mut self) -> Result<(), bun_core::Error> { Ok(()) }
}

impl WriterContext for BufferWriter {
    fn write_byte(&mut self, c: u8) -> Result<usize, bun_core::Error> { self.write_byte(c) }
    fn write_all(&mut self, buf: &[u8]) -> Result<usize, bun_core::Error> { self.write_all(buf) }
    fn get_last_byte(&self) -> u8 { self.get_last_byte() }
    fn get_last_last_byte(&self) -> u8 { self.get_last_last_byte() }
    fn reserve_next(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> { self.reserve_next(count) }
    fn advance_by(&mut self, count: u64) { self.advance_by(count) }
    fn slice(&self) -> &[u8] { self.slice() }
    fn get_mutable_buffer(&mut self) -> &mut MutableString { self.get_mutable_buffer() }
    fn take_buffer(&mut self) -> MutableString { self.take_buffer() }
    fn get_written(&self) -> &[u8] { self.get_written() }
    fn flush(&mut self) -> Result<(), bun_core::Error> { self.flush() }
    fn done(&mut self) -> Result<(), bun_core::Error> { self.done() }
}

pub type BufferPrinter = Writer<BufferWriter>;

// ───────────────────────────────────────────────────────────────────────────
// Format / GenerateSourceMap
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Esm,
    Cjs,
    // bun.js must escape non-latin1 identifiers in the output This is because
    // we load JavaScript as a UTF-8 buffer instead of a UTF-16 buffer
    // JavaScriptCore does not support UTF-8 identifiers when the source code
    // string is loaded as const char* We don't want to double the size of code
    // in memory...
    EsmAscii,
    CjsAscii,
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum GenerateSourceMap { Disable, Lazy, Eager }

pub fn get_source_map_builder<const GENERATE_SOURCE_MAP: GenerateSourceMap, const IS_BUN_PLATFORM: bool>(
    opts: &Options,
    source: &logger::Source,
    tree: &Ast,
) -> SourceMap::Chunk::Builder {
    if GENERATE_SOURCE_MAP == GenerateSourceMap::Disable {
        // TODO(port): Zig returned `undefined` here.
        return SourceMap::Chunk::Builder::default();
    }

    SourceMap::Chunk::Builder {
        source_map: SourceMap::Chunk::SourceMap::init(
            // opts.source_map_allocator orelse opts.allocator — allocator dropped
            IS_BUN_PLATFORM && GENERATE_SOURCE_MAP == GenerateSourceMap::Lazy,
        ),
        cover_lines_without_mappings: true,
        approximate_input_line_count: tree.approximate_newline_count,
        prepend_count: IS_BUN_PLATFORM && GENERATE_SOURCE_MAP == GenerateSourceMap::Lazy,
        line_offset_tables: opts.line_offset_tables.clone().unwrap_or_else(|| 'brk: {
            if GENERATE_SOURCE_MAP == GenerateSourceMap::Lazy {
                break 'brk SourceMap::LineOffsetTable::generate(
                    // allocator dropped
                    &source.contents,
                    i32::try_from(tree.approximate_newline_count).unwrap(),
                );
            }
            break 'brk SourceMap::LineOffsetTable::List::EMPTY;
        }),
        ..Default::default()
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Top-level print entry points
// ───────────────────────────────────────────────────────────────────────────

pub fn print_ast<W: WriterTrait, const ASCII_ONLY: bool, const GENERATE_SOURCE_MAP: bool>(
    _writer: W,
    tree: Ast,
    symbols: js_ast::Symbol::Map,
    source: &logger::Source,
    opts: Options,
) -> Result<usize, bun_core::Error> {
    let mut renamer: rename::Renamer;
    let mut no_op_renamer: rename::NoOpRenamer;
    let mut module_scope = tree.module_scope;
    if opts.minify_identifiers {
        let mut reserved_names = rename::compute_initial_reserved_names(opts.module_type)?;
        for child in module_scope.children.slice_mut() {
            child.parent = Some(&mut module_scope); // TODO(port): self-reference — needs raw ptr in Phase B
        }

        rename::compute_reserved_names_for_scope(&module_scope, &symbols, &mut reserved_names);
        let mut minify_renamer = rename::MinifyRenamer::init(symbols, tree.nested_scope_slot_counts, reserved_names)?;

        let mut top_level_symbols = rename::StableSymbolCount::Array::new();

        let uses_exports_ref = tree.uses_exports_ref;
        let uses_module_ref = tree.uses_module_ref;
        let exports_ref = tree.exports_ref;
        let module_ref = tree.module_ref;
        let parts = &tree.parts;

        let dont_break_the_code = [tree.module_ref, tree.exports_ref, tree.require_ref];
        for ref_ in dont_break_the_code {
            if let Some(symbol) = symbols.get(ref_) {
                symbol.must_not_be_renamed = true;
            }
        }

        for named_export in tree.named_exports.values() {
            if let Some(symbol) = symbols.get(named_export.ref_) {
                symbol.must_not_be_renamed = true;
            }
        }

        if uses_exports_ref {
            minify_renamer.accumulate_symbol_use_count(&mut top_level_symbols, exports_ref, 1, &[source.index.value])?;
        }
        if uses_module_ref {
            minify_renamer.accumulate_symbol_use_count(&mut top_level_symbols, module_ref, 1, &[source.index.value])?;
        }

        for part in parts.slice() {
            minify_renamer.accumulate_symbol_use_counts(&mut top_level_symbols, &part.symbol_uses, &[source.index.value])?;
            for declared_ref in part.declared_symbols.refs() {
                minify_renamer.accumulate_symbol_use_count(&mut top_level_symbols, *declared_ref, 1, &[source.index.value])?;
            }
        }

        top_level_symbols.sort_by(rename::StableSymbolCount::less_than);

        minify_renamer.allocate_top_level_symbol_slots(top_level_symbols)?;
        let mut minifier = tree.char_freq.as_ref().unwrap().compile();
        minify_renamer.assign_names_by_frequency(&mut minifier)?;

        renamer = minify_renamer.to_renamer();
    } else {
        no_op_renamer = rename::NoOpRenamer::init(symbols, source);
        renamer = no_op_renamer.to_renamer();
    }

    // defer: if minify_identifiers { renamer.deinit() } — Drop handles.

    type PrinterType<'a, W, const A: bool, const G: bool> = Printer<'a, W, A, false, /*IS_BUN_PLATFORM=*/A, false, G>;
    let writer = _writer;

    let mut printer = PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::init(
        writer,
        tree.import_records.slice(),
        opts,
        renamer,
        get_source_map_builder::<{ if GENERATE_SOURCE_MAP { GenerateSourceMap::Lazy } else { GenerateSourceMap::Disable } }, ASCII_ONLY>(&opts, source, &tree),
    );
    // defer: if GENERATE_SOURCE_MAP { printer.source_map_builder.line_offset_tables.deinit() } — Drop handles.
    printer.was_lazy_export = tree.has_lazy_export;
    if PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::MAY_HAVE_MODULE_INFO {
        printer.module_info = opts.module_info;
    }
    // PERF(port): was stack-fallback allocator for binary_expression_stack
    printer.binary_expression_stack = Vec::new();

    if !opts.bundling
        && tree.uses_require_ref
        && tree.exports_kind == js_ast::ExportsKind::Esm
        && opts.target == options::Target::Bun
    {
        // Hoist the `var {require}=import.meta;` declaration. Previously,
        // `import.meta.require` was inlined into transpiled files, which
        // meant calling `func.toString()` on a function with `require`
        // would observe `import.meta.require` inside of the source code.
        // https://github.com/oven-sh/bun/issues/15738#issuecomment-2574283514
        //
        // This is never a symbol collision because `uses_require_ref` means
        // `require` must be an unbound variable.
        printer.print(b"var {require}=import.meta;");

        if PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::MAY_HAVE_MODULE_INFO {
            if let Some(mi) = printer.module_info() {
                mi.flags.contains_import_meta = true;
                mi.add_var(mi.str(b"require"), analyze_transpiled_module::ModuleInfo::VarKind::Declared);
            }
        }
    }

    for part in tree.parts.slice() {
        for stmt in &part.stmts {
            printer.print_stmt(*stmt, TopLevel::init(IsTopLevel::Yes))?;
            printer.writer.get_error()?;
            printer.print_semicolon_if_needed();
        }
    }

    let have_module_info = PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::MAY_HAVE_MODULE_INFO && opts.module_info.is_some();
    if have_module_info {
        opts.module_info.as_mut().unwrap().finalize()?;
    }

    let mut source_maps_chunk: Option<SourceMap::Chunk> = if GENERATE_SOURCE_MAP {
        if opts.source_map_handler.is_some() {
            Some(printer.source_map_builder.generate_chunk(printer.writer.ctx_get_written()))
            // TODO(port): writer.ctx.getWritten() — need accessor on WriterTrait
        } else { None }
    } else { None };
    // defer: if let Some(chunk) = &mut source_maps_chunk { chunk.deinit() } — Drop handles.

    if let Some(cache) = opts.runtime_transpiler_cache {
        let mut srlz_res: Vec<u8> = Vec::new();
        if have_module_info {
            opts.module_info.as_ref().unwrap().as_deserialized().serialize(&mut srlz_res)?;
        }
        cache.put(
            printer.writer.ctx_get_written(), // TODO(port): accessor
            source_maps_chunk.as_ref().map(|c| c.buffer.list.as_slice()).unwrap_or(b""),
            &srlz_res,
        );
    }

    if GENERATE_SOURCE_MAP {
        if let Some(handler) = &opts.source_map_handler {
            handler.on_source_map_chunk(source_maps_chunk.take().unwrap(), source)?;
        }
    }

    printer.writer.done()?;

    Ok(usize::try_from(printer.writer.written().max(0)).unwrap())
}

pub fn print_json<W: WriterTrait>(
    _writer: W,
    expr: Expr,
    source: &logger::Source,
    opts: Options,
) -> Result<usize, bun_core::Error> {
    type PrinterType<'a, W> = Printer<'a, W, false, false, false, true, false>;
    let writer = _writer;
    let mut s_expr = S::SExpr { value: expr, ..Default::default() };
    let stmt = Stmt { loc: logger::Loc::EMPTY, data: Stmt::Data::SExpr(&mut s_expr) };
    let mut stmts = [stmt];
    let mut parts = [js_ast::Part { stmts: &stmts[..], ..Default::default() }];
    let ast = Ast::init_test(&mut parts);
    let list = js_ast::Symbol::List::from_borrowed_slice_dangerous(ast.symbols.slice());
    let nested_list = js_ast::Symbol::NestedList::from_borrowed_slice_dangerous(&[list]);
    let mut renamer = rename::NoOpRenamer::init(js_ast::Symbol::Map::init_list(nested_list), source);

    let mut printer = PrinterType::<W>::init(
        writer,
        ast.import_records.slice(),
        opts,
        renamer.to_renamer(),
        SourceMap::Chunk::Builder::default(), // undefined
    );
    // PERF(port): was stack-fallback allocator
    printer.binary_expression_stack = Vec::new();

    printer.print_expr(expr, Level::Lowest, ExprFlagSet::empty());
    printer.writer.get_error()?;
    printer.writer.done()?;

    Ok(usize::try_from(printer.writer.written().max(0)).unwrap())
}

pub fn print<const GENERATE_SOURCE_MAPS: bool>(
    target: options::Target,
    ast: Ast,
    source: &logger::Source,
    opts: Options,
    import_records: &[ImportRecord],
    parts: &[js_ast::Part],
    renamer: rename::Renamer,
) -> PrintResult {
    let _trace = bun_core::perf::trace("JSPrinter.print");

    let buffer_writer = BufferWriter::init();
    let mut buffer_printer = BufferPrinter::init(buffer_writer);

    print_with_writer::<&mut BufferPrinter, GENERATE_SOURCE_MAPS>(
        &mut buffer_printer,
        target,
        ast,
        source,
        opts,
        import_records,
        parts,
        renamer,
    )
}

pub fn print_with_writer<W: WriterTrait, const GENERATE_SOURCE_MAPS: bool>(
    writer: W,
    target: options::Target,
    ast: Ast,
    source: &logger::Source,
    opts: Options,
    import_records: &[ImportRecord],
    parts: &[js_ast::Part],
    renamer: rename::Renamer,
) -> PrintResult {
    if target.is_bun() {
        print_with_writer_and_platform::<W, true, GENERATE_SOURCE_MAPS>(
            writer, ast, source, opts, import_records, parts, renamer,
        )
    } else {
        print_with_writer_and_platform::<W, false, GENERATE_SOURCE_MAPS>(
            writer, ast, source, opts, import_records, parts, renamer,
        )
    }
}

/// The real one
pub fn print_with_writer_and_platform<W: WriterTrait, const IS_BUN_PLATFORM: bool, const GENERATE_SOURCE_MAPS: bool>(
    writer: W,
    ast: Ast,
    source: &logger::Source,
    opts: Options,
    import_records: &[ImportRecord],
    parts: &[js_ast::Part],
    renamer: rename::Renamer,
) -> PrintResult {
    let prev_action = bun_crash_handler::current_action();
    let _restore = scopeguard::guard((), |_| bun_crash_handler::set_current_action(prev_action));
    bun_crash_handler::set_current_action(bun_crash_handler::Action::Print(source.path.text.clone()));

    type PrinterType<'a, W, const B: bool, const G: bool> = Printer<'a, W, /*ASCII_ONLY=*/B, false, B, false, G>;
    let mut printer = PrinterType::<W, IS_BUN_PLATFORM, GENERATE_SOURCE_MAPS>::init(
        writer,
        import_records,
        opts,
        renamer,
        get_source_map_builder::<{ if GENERATE_SOURCE_MAPS { GenerateSourceMap::Eager } else { GenerateSourceMap::Disable } }, IS_BUN_PLATFORM>(&opts, source, &ast),
    );
    printer.was_lazy_export = ast.has_lazy_export;
    if PrinterType::<W, IS_BUN_PLATFORM, GENERATE_SOURCE_MAPS>::MAY_HAVE_MODULE_INFO {
        printer.module_info = opts.module_info;
    }
    // PERF(port): was stack-fallback allocator
    printer.binary_expression_stack = Vec::new();
    // defer: temporary_bindings.deinit / writer.* = printer.writer.* — handled by move-out below.

    if opts.module_type == options::Format::InternalBakeDev && !source.index.is_runtime() {
        printer.print_dev_server_module(source, &ast, &parts[0]);
    } else {
        // The IIFE wrapper is done in `postProcessJSChunk`, so we just manually
        // trigger an indent.
        if opts.module_type == options::Format::Iife {
            printer.indent();
        }

        for part in parts {
            for stmt in &part.stmts {
                if let Err(err) = printer.print_stmt(*stmt, TopLevel::init(IsTopLevel::Yes)) {
                    return PrintResult::Err(err);
                }
                if let Err(err) = printer.writer.get_error() {
                    return PrintResult::Err(err);
                }
                printer.print_semicolon_if_needed();
            }
        }
    }

    if let Err(err) = printer.writer.done() {
        // In bundle_v2, this is backed by an arena, but incremental uses
        // `dev.allocator` for this buffer, so it must be freed.
        // TODO(port): printer.source_map_builder.source_map.ctx.data.deinit() — Drop handles.
        return PrintResult::Err(err);
    }

    // TODO(port): need ctx accessor on WriterTrait for getWritten()
    let written = printer.writer.slice(); // PORT NOTE: Zig used printer.writer.ctx.getWritten()
    let source_map: Option<SourceMap::Chunk> = if GENERATE_SOURCE_MAPS {
        'brk: {
            if written.is_empty() || printer.source_map_builder.source_map.should_ignore() {
                // Drop handles cleanup
                break 'brk None;
            }
            let chunk = printer.source_map_builder.generate_chunk(written);
            debug_assert!(!chunk.should_ignore);
            break 'brk Some(chunk);
        }
    } else { None };

    let mut buffer: MutableString = printer.writer.take_buffer();

    PrintResult::Result(PrintResultSuccess {
        code: buffer.take_slice(),
        source_map,
    })
}

pub fn print_common_js<W: WriterTrait, const ASCII_ONLY: bool, const GENERATE_SOURCE_MAP: bool>(
    _writer: W,
    tree: Ast,
    symbols: js_ast::Symbol::Map,
    source: &logger::Source,
    opts: Options,
) -> Result<usize, bun_core::Error> {
    let prev_action = bun_crash_handler::current_action();
    let _restore = scopeguard::guard((), |_| bun_crash_handler::set_current_action(prev_action));
    bun_crash_handler::set_current_action(bun_crash_handler::Action::Print(source.path.text.clone()));

    type PrinterType<'a, W, const A: bool, const G: bool> = Printer<'a, W, A, true, false, false, G>;
    let writer = _writer;
    let mut renamer = rename::NoOpRenamer::init(symbols, source);
    let mut printer = PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::init(
        writer,
        tree.import_records.slice(),
        opts,
        renamer.to_renamer(),
        get_source_map_builder::<{ if GENERATE_SOURCE_MAP { GenerateSourceMap::Lazy } else { GenerateSourceMap::Disable } }, false>(&opts, source, &tree),
    );
    // PERF(port): was stack-fallback allocator
    printer.binary_expression_stack = Vec::new();

    for part in tree.parts.slice() {
        for stmt in &part.stmts {
            printer.print_stmt(*stmt, TopLevel::init(IsTopLevel::Yes))?;
            printer.writer.get_error()?;
            printer.print_semicolon_if_needed();
        }
    }

    // Add a couple extra newlines at the end
    printer.writer.print_slice(b"\n\n");

    if GENERATE_SOURCE_MAP {
        if let Some(handler) = &opts.source_map_handler {
            let chunk = printer.source_map_builder.generate_chunk(printer.writer.slice());
            handler.on_source_map_chunk(chunk, source)?;
        }
    }

    printer.writer.done()?;

    Ok(usize::try_from(printer.writer.written().max(0)).unwrap())
}

/// Serializes ModuleInfo to an owned byte slice. Returns null on failure.
/// The caller is responsible for freeing the returned slice.
pub fn serialize_module_info(module_info: Option<&mut analyze_transpiled_module::ModuleInfo>) -> Option<Box<[u8]>> {
    let mi = module_info?;
    if !mi.finalized {
        if mi.finalize().is_err() { return None; }
    }
    let deserialized = mi.as_deserialized();
    let mut buf: Vec<u8> = Vec::new();
    if deserialized.serialize(&mut buf).is_err() { return None; }
    Some(buf.into_boxed_slice())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_printer/js_printer.zig (6419 lines)
//   confidence: low
//   todos:      38
//   notes:      Huge comptime-generic printer; ws() needs const-eval macro, NewWriter→trait reshape, several arena-mutation sites & callback thunks stubbed; defer-if-wrap reshaped manually in printRequireOrImportExpr; print_stmt's `defer prev_stmt_tag = ...` expanded to per-return assignments for borrowck.
// ──────────────────────────────────────────────────────────────────────────
