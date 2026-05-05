use core::cell::Cell;
use core::fmt;

use bun_alloc::Arena as Bump;
use bumpalo::collections::Vec as BumpVec;
use bun_collections::BabyList;
use bun_options_types::ImportRecord;

use crate::css_parser as css;
use crate::sourcemap;
use crate::values as css_values;

use css::{Location, PrintErr};
use css_values::ident::DashedIdent;

pub use css::Error;

type PrintResult<T> = Result<T, PrintErr>;

// TODO(port): move to <area>_sys / clarify which Write trait. Zig used *std.Io.Writer
// (byte-oriented: writeAll/writeByte/print/splatByteAll). Using a local dyn trait alias.
use bun_io::Write;

/// Options that control how CSS is serialized to a string.
pub struct PrinterOptions<'a> {
    /// Whether to minify the CSS, i.e. remove white space.
    pub minify: bool,
    /// An optional reference to a source map to write mappings into.
    /// (Available when the `sourcemap` feature is enabled.)
    pub source_map: Option<&'a mut sourcemap::SourceMap>,
    /// An optional project root path, used to generate relative paths for sources used in CSS module hashes.
    pub project_root: Option<&'a [u8]>,
    /// Targets to output the CSS for.
    pub targets: Targets,
    /// Whether to analyze dependencies (i.e. `@import` and `url()`).
    /// If true, the dependencies are returned as part of the
    /// [ToCssResult](super::stylesheet::ToCssResult).
    ///
    /// When enabled, `@import` and `url()` dependencies
    /// are replaced with hashed placeholders that can be replaced with the final
    /// urls later (after bundling).
    pub analyze_dependencies: Option<css::dependencies::DependencyOptions>,
    /// A mapping of pseudo classes to replace with class names that can be applied
    /// from JavaScript. Useful for polyfills, for example.
    pub pseudo_classes: Option<PseudoClasses<'a>>,
    pub public_path: &'a [u8],
}

impl<'a> PrinterOptions<'a> {
    pub fn default() -> PrinterOptions<'a> {
        PrinterOptions {
            minify: false,
            source_map: None,
            project_root: None,
            targets: Targets { browsers: None, ..Targets::default() },
            analyze_dependencies: None,
            pseudo_classes: None,
            public_path: b"",
        }
    }

    pub fn default_with_minify(minify: bool) -> PrinterOptions<'a> {
        PrinterOptions {
            minify,
            source_map: None,
            project_root: None,
            targets: Targets { browsers: None, ..Targets::default() },
            analyze_dependencies: None,
            pseudo_classes: None,
            public_path: b"",
        }
    }
}

impl<'a> Default for PrinterOptions<'a> {
    fn default() -> Self {
        Self::default()
    }
}

/// A mapping of user action pseudo classes to replace with class names.
///
/// See [PrinterOptions](PrinterOptions).
#[derive(Default, Clone, Copy)]
pub struct PseudoClasses<'a> {
    /// The class name to replace `:hover` with.
    pub hover: Option<&'a [u8]>,
    /// The class name to replace `:active` with.
    pub active: Option<&'a [u8]>,
    /// The class name to replace `:focus` with.
    pub focus: Option<&'a [u8]>,
    /// The class name to replace `:focus-visible` with.
    pub focus_visible: Option<&'a [u8]>,
    /// The class name to replace `:focus-within` with.
    pub focus_within: Option<&'a [u8]>,
}

pub use css::targets::Targets;

pub use css::targets::Features;

pub struct ImportInfo<'a> {
    pub import_records: &'a BabyList<ImportRecord>,
    /// bundle_v2.graph.ast.items(.url_for_css)
    pub ast_urls_for_css: &'a [&'a [u8]],
    /// bundle_v2.graph.input_files.items(.unique_key_for_additional_file)
    pub ast_unique_key_for_additional_file: &'a [&'a [u8]],
}

impl<'a> ImportInfo<'a> {
    /// Only safe to use when outside the bundler. As in, the import records
    /// were not resolved to source indices. This will out-of-bounds otherwise.
    pub fn init_outside_of_bundler(records: &'a BabyList<ImportRecord>) -> ImportInfo<'a> {
        ImportInfo {
            import_records: records,
            ast_urls_for_css: &[],
            ast_unique_key_for_additional_file: &[],
        }
    }
}

/// A `Printer` represents a destination to output serialized CSS, as used in
/// the [ToCss](super::traits::ToCss) trait. It can wrap any destination that
/// implements [std::fmt::Write](std::fmt::Write), such as a [String](String).
///
/// A `Printer` keeps track of the current line and column position, and uses
/// this to generate a source map if provided in the options.
///
/// `Printer` also includes helper functions that assist with writing output
/// that respects options such as `minify`, and `css_modules`.
pub struct Printer<'a> {
    // #[cfg(feature = "sourcemap")]
    pub sources: Option<&'a Vec<&'a [u8]>>,
    pub dest: &'a mut dyn Write,
    pub loc: Location,
    pub indent_amt: u8,
    pub line: u32,
    pub col: u32,
    pub minify: bool,
    pub targets: Targets,
    pub vendor_prefix: css::VendorPrefix,
    pub in_calc: bool,
    pub css_module: Option<css::CssModule>,
    pub dependencies: Option<BumpVec<'a, css::Dependency>>,
    pub remove_imports: bool,
    /// A mapping of pseudo classes to replace with class names that can be applied
    /// from JavaScript. Useful for polyfills, for example.
    pub pseudo_classes: Option<PseudoClasses<'a>>,
    pub indentation_buf: BumpVec<'a, u8>,
    // TODO(port): lifetime — ctx is set to a stack-local during with_context() and restored
    // after; `&'a StyleContext<'a>` will not borrow-check there. May need raw `*const StyleContext`.
    pub ctx: Option<&'a css::StyleContext<'a>>,
    pub scratchbuf: BumpVec<'a, u8>,
    pub error_kind: Option<css::PrinterError>,
    pub import_info: Option<ImportInfo<'a>>,
    pub public_path: &'a [u8],
    pub symbols: &'a SymbolMap,
    pub local_names: Option<&'a css::LocalsResultsMap>,
    /// NOTE This should be the same mimalloc heap arena allocator
    pub allocator: &'a Bump,
    // TODO: finish the fields
}

#[cfg(debug_assertions)]
thread_local! {
    pub static IN_DEBUG_FMT: Cell<bool> = const { Cell::new(false) };
}

impl<'a> Printer<'a> {
    pub fn lookup_symbol(&self, ref_: bun_js_parser::Ref) -> &[u8] {
        let symbols = self.symbols;

        let final_ref = symbols.follow(ref_);
        if let Some(local_names) = self.local_names {
            if let Some(local_name) = local_names.get(&final_ref) {
                return local_name;
            }
        }

        let original_name = symbols.get(final_ref).unwrap().original_name;
        original_name
    }

    pub fn lookup_ident_or_ref(&self, ident: css_values::ident::IdentOrRef) -> &[u8] {
        #[cfg(debug_assertions)]
        {
            if IN_DEBUG_FMT.with(|f| f.get()) {
                return ident.debug_ident();
            }
        }
        if ident.is_ident() {
            return ident.as_ident().unwrap().v;
        }
        self.lookup_symbol(ident.as_ref().unwrap())
    }

    // TODO(port): Zig checked vtable identity against std.Io.Writer.Allocating to recover
    // the backing buffer length via @fieldParentPtr. In Rust the dest writer should expose
    // a `written_len()` method (or be a concrete `Vec<u8>`-backed writer).
    #[inline]
    fn get_written_amt(writer: &dyn Write) -> usize {
        // TODO(port): replace with writer.written_len() once bun_io::Write provides it
        let _ = writer;
        unreachable!("css: got bad writer type");
    }

    /// Returns the current source filename that is being printed.
    pub fn filename(&self) -> &[u8] {
        if let Some(sources) = self.sources {
            if (self.loc.source_index as usize) < sources.len() {
                return sources[self.loc.source_index as usize];
            }
        }
        b"unknown.css"
    }

    /// Returns whether the indent level is greater than one.
    pub fn is_nested(&self) -> bool {
        self.indent_amt > 2
    }

    /// Add an error related to std lib fmt errors
    pub fn add_fmt_error(&mut self) -> PrintErr {
        self.error_kind = Some(css::PrinterError {
            kind: css::PrinterErrorKind::FmtError,
            loc: None,
        });
        PrintErr::CSSPrintError
    }

    pub fn add_no_import_record_error(&mut self) -> PrintErr {
        self.error_kind = Some(css::PrinterError {
            kind: css::PrinterErrorKind::NoImportRecords,
            loc: None,
        });
        PrintErr::CSSPrintError
    }

    pub fn add_invalid_css_modules_pattern_in_grid_error(&mut self) -> PrintErr {
        self.error_kind = Some(css::PrinterError {
            kind: css::PrinterErrorKind::InvalidCssModulesPatternInGrid,
            loc: Some(css::ErrorLocation {
                filename: self.filename().into(),
                line: self.loc.line,
                column: self.loc.column,
            }),
        });
        PrintErr::CSSPrintError
    }

    /// Returns an error of the given kind at the provided location in the current source file.
    pub fn new_error(
        &mut self,
        kind: css::PrinterErrorKind,
        maybe_loc: Option<css::dependencies::Location>,
    ) -> PrintResult<()> {
        debug_assert!(self.error_kind.is_none());
        self.error_kind = Some(css::PrinterError {
            kind,
            loc: maybe_loc.map(|loc| css::ErrorLocation {
                filename: self.filename().into(),
                line: loc.line - 1,
                column: loc.column,
            }),
        });
        Err(PrintErr::CSSPrintError)
    }

    // PORT NOTE: deinit() dropped — scratchbuf/indentation_buf/dependencies are arena-backed
    // BumpVec<'a, _>; freed in bulk by `allocator.reset()`. No explicit Drop impl needed.

    /// If `import_records` is null, then the printer will error when it encounters code that relies on import records (urls())
    pub fn new(
        allocator: &'a Bump,
        scratchbuf: BumpVec<'a, u8>,
        dest: &'a mut dyn Write,
        options: PrinterOptions<'a>,
        import_info: Option<ImportInfo<'a>>,
        local_names: Option<&'a css::LocalsResultsMap>,
        symbols: &'a SymbolMap,
    ) -> Self {
        Printer {
            sources: None,
            dest,
            minify: options.minify,
            targets: options.targets,
            dependencies: if options.analyze_dependencies.is_some() { Some(BumpVec::new_in(allocator)) } else { None },
            remove_imports: options
                .analyze_dependencies
                .as_ref()
                .map(|d| d.remove_imports)
                .unwrap_or(false),
            pseudo_classes: options.pseudo_classes,
            indentation_buf: BumpVec::new_in(allocator),
            import_info,
            scratchbuf,
            allocator,
            public_path: options.public_path,
            local_names,
            loc: Location {
                source_index: 0,
                line: 0,
                column: 1,
            },
            symbols,
            // defaults for fields not set by Zig's `.{}` initializer
            indent_amt: 0,
            line: 0,
            col: 0,
            vendor_prefix: css::VendorPrefix::default(),
            in_calc: false,
            css_module: None,
            ctx: None,
            error_kind: None,
        }
    }

    #[inline]
    pub fn get_import_records(&mut self) -> PrintResult<&'a BabyList<ImportRecord>> {
        if let Some(info) = &self.import_info {
            return Ok(info.import_records);
        }
        Err(self.add_no_import_record_error())
    }

    pub fn print_import_record(&mut self, import_record_idx: u32) -> PrintResult<()> {
        if let Some(info) = &self.import_info {
            let import_record = info.import_records.at(import_record_idx);
            let (a, b) = bun_str::cheap_prefix_normalizer(self.public_path, &import_record.path.text);
            // PORT NOTE: reshaped for borrowck — copied (a, b) out before re-borrowing &mut self
            let a = a.to_vec();
            let b = b.to_vec();
            // PERF(port): two small heap copies above; Zig borrowed directly. Profile in Phase B.
            self.write_str(&a)?;
            self.write_str(&b)?;
            return Ok(());
        }
        Err(self.add_no_import_record_error())
    }

    #[inline]
    pub fn import_record(&mut self, import_record_idx: u32) -> PrintResult<&ImportRecord> {
        if let Some(info) = &self.import_info {
            return Ok(info.import_records.at(import_record_idx));
        }
        Err(self.add_no_import_record_error())
    }

    #[inline]
    pub fn get_import_record_url(&mut self, import_record_idx: u32) -> PrintResult<&[u8]> {
        let Some(import_info) = &self.import_info else {
            return Err(self.add_no_import_record_error());
        };
        let record = import_info.import_records.at(import_record_idx);
        if record.source_index.is_valid() {
            // It has an inlined url for CSS
            let urls_for_css = import_info.ast_urls_for_css[record.source_index.get() as usize];
            if !urls_for_css.is_empty() {
                return Ok(urls_for_css);
            }
            // It is a chunk URL
            let unique_key_for_additional_file =
                import_info.ast_unique_key_for_additional_file[record.source_index.get() as usize];
            if !unique_key_for_additional_file.is_empty() {
                return Ok(unique_key_for_additional_file);
            }
        }
        // External URL stays as-is
        Ok(&record.path.text)
    }

    pub fn context(&self) -> Option<&css::StyleContext<'a>> {
        self.ctx
    }

    /// To satisfy io.Writer interface
    ///
    /// NOTE: Same constraints as `write_str`, the `str` param is assumed to not
    /// contain any newline characters
    pub fn write_all(&mut self, str_: &[u8]) -> Result<(), bun_alloc::AllocError> {
        self.write_str(str_).map_err(|_| bun_alloc::AllocError)
    }

    pub fn write_comment(&mut self, comment: &[u8]) -> PrintResult<()> {
        if self.dest.write_all(comment).is_err() {
            return Err(self.add_fmt_error());
        }
        let new_lines = comment.iter().filter(|&&b| b == b'\n').count();
        self.line += u32::try_from(new_lines).unwrap();
        self.col = 0;
        let last_line_start = comment.len()
            - comment
                .iter()
                .rposition(|&b| b == b'\n')
                .unwrap_or(comment.len());
        self.col += u32::try_from(last_line_start).unwrap();
        Ok(())
    }

    /// Writes a raw string to the underlying destination.
    ///
    /// NOTE: Is is assumed that the string does not contain any newline characters.
    /// If such a string is written, it will break source maps.
    pub fn write_str(&mut self, s: &[u8]) -> PrintResult<()> {
        #[cfg(debug_assertions)]
        {
            debug_assert!(!s.contains(&b'\n'));
        }
        self.col += u32::try_from(s.len()).unwrap();
        if self.dest.write_all(s).is_err() {
            return Err(self.add_fmt_error());
        }
        Ok(())
    }

    /// Writes a formatted string to the underlying destination.
    ///
    /// NOTE: Is is assumed that the formatted string does not contain any newline characters.
    /// If such a string is written, it will break source maps.
    pub fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> PrintResult<()> {
        // assuming the writer comes from an ArrayList
        let start: usize = Self::get_written_amt(self.dest);
        if self.dest.write_fmt(args).is_err() {
            return Err(self.add_fmt_error());
        }
        let written = Self::get_written_amt(self.dest) - start;
        self.col += u32::try_from(written).unwrap();
        Ok(())
    }

    fn replace_dots<'b>(allocator: &'b Bump, s: &[u8]) -> &'b mut [u8] {
        let str_ = allocator.alloc_slice_copy(s);
        for b in str_.iter_mut() {
            if *b == b'.' {
                *b = b'-';
            }
        }
        str_
    }

    pub fn write_ident_or_ref(
        &mut self,
        ident: css_values::ident::IdentOrRef,
        handle_css_module: bool,
    ) -> PrintResult<()> {
        if !handle_css_module {
            if let Some(identifier) = ident.as_ident() {
                return css::serializer::serialize_identifier(identifier.v, self)
                    .map_err(|_| self.add_fmt_error());
            } else {
                let ref_ = ident.as_ref().unwrap();
                let Some(symbol) = self.symbols.get(ref_) else {
                    return Err(self.add_fmt_error());
                };
                // PORT NOTE: reshaped for borrowck
                let name = symbol.original_name;
                return css::serializer::serialize_identifier(name, self)
                    .map_err(|_| self.add_fmt_error());
            }
        }

        let str_ = self.lookup_ident_or_ref(ident);
        // PORT NOTE: reshaped for borrowck
        // TODO(port): avoid this clone — Zig borrowed the slice while passing &mut self.
        let str_ = str_.to_vec();
        css::serializer::serialize_identifier(&str_, self).map_err(|_| self.add_fmt_error())
    }

    /// Writes a CSS identifier to the underlying destination, escaping it
    /// as appropriate. If the `css_modules` option was enabled, then a hash
    /// is added, and the mapping is added to the CSS module.
    pub fn write_ident(&mut self, ident: &[u8], handle_css_module: bool) -> PrintResult<()> {
        if handle_css_module {
            if let Some(css_module) = &mut self.css_module {
                // TODO(port): borrowck — Zig captured `&mut self` inside the closure while
                // `css_module` (a field of self) is also borrowed. Phase B may need to split
                // the borrow or restructure pattern.write to take the printer separately.
                struct Closure<'p, 'a> {
                    first: bool,
                    printer: *mut Printer<'a>,
                    _p: core::marker::PhantomData<&'p mut Printer<'a>>,
                }
                let mut closure = Closure {
                    first: true,
                    printer: self as *mut _,
                    _p: core::marker::PhantomData,
                };
                let source_index = self.loc.source_index as usize;
                css_module.config.pattern.write(
                    &css_module.hashes[source_index],
                    &css_module.sources[source_index],
                    ident,
                    &mut closure,
                    |self_: &mut Closure<'_, '_>, s1: &[u8], replace_dots: bool| {
                        // PERF: stack fallback?
                        // SAFETY: closure.printer is valid for the duration of pattern.write;
                        // no other &mut to *self exists across this call.
                        let printer = unsafe { &mut *self_.printer };
                        let s: &[u8] = if !replace_dots {
                            s1
                        } else {
                            Printer::replace_dots(printer.allocator, s1)
                        };
                        printer.col += u32::try_from(s.len()).unwrap();
                        if self_.first {
                            self_.first = false;
                            css::serializer::serialize_identifier(s, printer)
                                .unwrap_or_else(|e| css::oom(e));
                        } else {
                            css::serializer::serialize_name(s, printer)
                                .unwrap_or_else(|e| css::oom(e));
                        }
                    },
                );

                css_module.add_local(self.allocator, ident, ident, self.loc.source_index);
                return Ok(());
            }
        }

        css::serializer::serialize_identifier(ident, self).map_err(|_| self.add_fmt_error())
    }

    pub fn write_dashed_ident(
        &mut self,
        ident: &DashedIdent,
        is_declaration: bool,
    ) -> PrintResult<()> {
        self.write_str(b"--")?;

        if let Some(css_module) = &mut self.css_module {
            if css_module.config.dashed_idents {
                // TODO(port): same borrowck reshape as write_ident — closure captures &mut self
                // while css_module (field of self) is borrowed.
                let source_index = self.loc.source_index as usize;
                let this_ptr: *mut Printer<'a> = self as *mut _;
                css_module.config.pattern.write(
                    &css_module.hashes[source_index],
                    &css_module.sources[source_index],
                    &ident.v[2..],
                    // SAFETY: this_ptr is valid for the duration of pattern.write
                    unsafe { &mut *this_ptr },
                    |self_: &mut Printer<'_>, s1: &[u8], replace_dots: bool| {
                        let s: &[u8] = if !replace_dots {
                            s1
                        } else {
                            Printer::replace_dots(self_.allocator, s1)
                        };
                        self_.col += u32::try_from(s.len()).unwrap();
                        css::serializer::serialize_name(s, self_).unwrap_or_else(|e| css::oom(e));
                    },
                );

                if is_declaration {
                    css_module.add_dashed(self.allocator, ident.v, self.loc.source_index);
                }
            }
        }

        css::serializer::serialize_name(&ident.v[2..], self).map_err(|_| self.add_fmt_error())
    }

    pub fn write_byte(&mut self, char_: u8) -> Result<(), bun_alloc::AllocError> {
        self.write_char(char_).map_err(|_| bun_alloc::AllocError)
    }

    /// Write a single character to the underlying destination.
    pub fn write_char(&mut self, char_: u8) -> PrintResult<()> {
        if char_ == b'\n' {
            self.line += 1;
            self.col = 0;
        } else {
            self.col += 1;
        }
        if self.dest.write_byte(char_).is_err() {
            return Err(self.add_fmt_error());
        }
        Ok(())
    }

    /// Writes a newline character followed by indentation.
    /// If the `minify` option is enabled, then nothing is printed.
    pub fn newline(&mut self) -> PrintResult<()> {
        if self.minify {
            return Ok(());
        }

        self.write_char(b'\n')?;
        self.write_indent()
    }

    /// Writes a delimiter character, followed by whitespace (depending on the `minify` option).
    /// If `ws_before` is true, then whitespace is also written before the delimiter.
    pub fn delim(&mut self, delim_: u8, ws_before: bool) -> PrintResult<()> {
        if ws_before {
            self.whitespace()?;
        }
        self.write_char(delim_)?;
        self.whitespace()
    }

    /// Writes a single whitespace character, unless the `minify` option is enabled.
    ///
    /// Use `write_char` instead if you wish to force a space character to be written,
    /// regardless of the `minify` option.
    pub fn whitespace(&mut self) -> PrintResult<()> {
        if self.minify {
            return Ok(());
        }
        self.write_char(b' ')
    }

    pub fn with_context<C, F>(
        &mut self,
        selectors: &css::SelectorList,
        closure: C,
        func: F,
    ) -> PrintResult<()>
    where
        F: FnOnce(C, &mut Self) -> PrintResult<()>,
    {
        let parent = if let Some(ctx) = self.ctx {
            self.ctx = None;
            Some(ctx)
        } else {
            None
        };

        let ctx = css::StyleContext { selectors, parent };

        // TODO(port): lifetime — `&ctx` is stack-local but field type is `&'a StyleContext<'a>`.
        // Zig relied on restoring `parent` before return. Phase B: change field to raw
        // `*const StyleContext` or restructure StyleContext as an explicit stack.
        // SAFETY: ctx outlives the call to func; self.ctx is restored to `parent` before return.
        self.ctx = Some(unsafe { core::mem::transmute::<&css::StyleContext<'_>, &'a css::StyleContext<'a>>(&ctx) });
        let res = func(closure, self);
        self.ctx = parent;

        res
    }

    pub fn with_cleared_context<C, F>(&mut self, closure: C, func: F) -> PrintResult<()>
    where
        F: FnOnce(C, &mut Self) -> PrintResult<()>,
    {
        let parent = if let Some(ctx) = self.ctx {
            self.ctx = None;
            Some(ctx)
        } else {
            None
        };
        let res = func(closure, self);
        self.ctx = parent;
        res
    }

    /// Increases the current indent level.
    pub fn indent(&mut self) {
        self.indent_amt += 2;
    }

    /// Decreases the current indent level.
    pub fn dedent(&mut self) {
        self.indent_amt -= 2;
    }

    fn get_indent(&mut self, idnt: u8) -> &[u8] {
        // divide by 2 to get index into table
        let i = (idnt >> 1) as usize;
        // PERF: may be faster to just do `i < (IDENTS.len - 1) * 2` (e.g. 62 if IDENTS.len == 32) here
        if i < INDENTS_LEVELS {
            return &INDENT_SPACES[..i * 2];
        }
        if self.indentation_buf.len() < idnt as usize {
            // PORT NOTE: Zig had `appendNTimes(' ', items.len - idnt)` which underflows when
            // len < idnt — preserving the (buggy) arithmetic verbatim would panic in Rust.
            // Mirroring intent: pad up to `idnt` spaces.
            // TODO(port): verify upstream bug; Zig wrapping-sub here is suspicious.
            let need = idnt as usize - self.indentation_buf.len();
            self.indentation_buf
                .extend(core::iter::repeat(b' ').take(need));
        } else {
            self.indentation_buf.truncate(idnt as usize);
        }
        &self.indentation_buf
    }

    fn write_indent(&mut self) -> PrintResult<()> {
        debug_assert!(!self.minify);
        if self.indent_amt > 0 {
            // try this.writeStr(this.getIndent(this.ident));
            if self
                .dest
                .splat_byte_all(b' ', self.indent_amt as usize)
                .is_err()
            {
                return Err(self.add_fmt_error());
            }
        }
        Ok(())
    }
}

// PORT NOTE: Zig built a comptime [32][]const u8 table of " " * (i*2). Equivalent here is a
// single static buffer of 64 spaces, sliced on demand — same observable behavior, simpler const.
const INDENTS_LEVELS: usize = 32;
static INDENT_SPACES: [u8; INDENTS_LEVELS * 2] = [b' '; INDENTS_LEVELS * 2];

// TODO(port): narrow — bun.ast.Symbol.Map. Moved down to bun_logger per CYCLEBREAK B-0.
type SymbolMap = bun_logger::symbol::Map;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/printer.zig (581 lines)
//   confidence: medium
//   todos:      10
//   notes:      ctx field lifetime + write_ident/write_dashed_ident closure borrows need Phase-B reshape; get_written_amt stubbed (write_fmt panics) until bun_io::Write exposes written_len()
// ──────────────────────────────────────────────────────────────────────────
