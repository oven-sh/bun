use core::cell::Cell;
use core::fmt;

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::ImportRecord;
use bun_collections::VecExt;

use crate::css_parser as css;
use crate::sourcemap;
use crate::values as css_values;

use crate::{Location, PrintErr, PrintResult};
use css_values::ident::DashedIdent;

pub use css::Error;

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
        Self::default_with_minify(false)
    }

    pub fn default_with_minify(minify: bool) -> PrinterOptions<'a> {
        PrinterOptions {
            minify,
            source_map: None,
            project_root: None,
            targets: Targets {
                browsers: None,
                ..Targets::default()
            },
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

#[derive(Clone, Copy)]
pub struct ImportInfo<'a> {
    pub import_records: &'a Vec<ImportRecord>,
    /// bundle_v2.graph.ast.items(.url_for_css)
    pub ast_urls_for_css: &'a [&'a [u8]],
    /// bundle_v2.graph.input_files.items(.unique_key_for_additional_file)
    pub ast_unique_key_for_additional_file: &'a [&'a [u8]],
}

impl<'a> ImportInfo<'a> {
    /// Only safe to use when outside the bundler. As in, the import records
    /// were not resolved to source indices. This will out-of-bounds otherwise.
    pub fn init_outside_of_bundler(records: &'a Vec<ImportRecord>) -> ImportInfo<'a> {
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
    pub sources: Option<&'a Vec<Box<[u8]>>>,
    pub dest: &'a mut dyn Write,
    pub loc: Location,
    pub indent_amt: u8,
    pub line: u32,
    pub col: u32,
    pub minify: bool,
    pub targets: Targets,
    pub vendor_prefix: css::VendorPrefix,
    pub in_calc: bool,
    pub css_module: Option<css::CssModule<'a>>,
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
    /// NOTE This should be the same mimalloc heap arena arena
    pub arena: &'a Bump,
    // TODO: finish the fields
}

#[cfg(debug_assertions)]
thread_local! {
    pub static IN_DEBUG_FMT: Cell<bool> = const { Cell::new(false) };
}

impl<'a> Printer<'a> {
    pub fn lookup_symbol(&self, ref_: bun_ast::Ref) -> &'a [u8] {
        let symbols = self.symbols;

        let final_ref = symbols.follow(ref_);
        if let Some(local_names) = self.local_names {
            if let Some(local_name) = local_names.get(&final_ref) {
                // `local_names: &'a LocalsResultsMap` → `&'a Box<[u8]>` → `&'a [u8]`.
                return &**local_name;
            }
        }

        // `original_name` is `StoreStr` (arena-erased); `.slice()` yields `&'a [u8]`.
        symbols.get_const(final_ref).unwrap().original_name.slice()
    }

    pub fn lookup_ident_or_ref(&self, ident: css_values::ident::IdentOrRef) -> &'a [u8] {
        #[cfg(debug_assertions)]
        {
            if IN_DEBUG_FMT.with(|f| f.get()) {
                return ident.debug_ident();
            }
        }
        if ident.is_ident() {
            // SAFETY: Ident.v is an arena-owned slice packed by IdentOrRef::from_ident.
            return unsafe { crate::arena_str(ident.as_ident().unwrap().v) };
        }
        self.lookup_symbol(ident.as_ref().unwrap())
    }

    // Zig checked vtable identity against std.Io.Writer.Allocating and recovered the
    // backing buffer length via `container_of`; in Rust the trait exposes `written_len()`
    // directly (Vec<u8> / MutableString / counting sinks override it, others panic — same
    // contract as Zig's `@panic("css: got bad writer type")` fallthrough).
    #[inline]
    fn get_written_amt(writer: &dyn Write) -> usize {
        writer.written_len()
    }

    /// Returns the current source filename that is being printed.
    pub fn filename(&self) -> &[u8] {
        if let Some(sources) = self.sources {
            if (self.loc.source_index as usize) < sources.len() {
                return sources[self.loc.source_index as usize].as_ref();
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
            kind: css::PrinterErrorKind::fmt_error,
            loc: None,
        });
        PrintErr::CSSPrintError
    }

    pub fn add_no_import_record_error(&mut self) -> PrintErr {
        self.error_kind = Some(css::PrinterError {
            kind: css::PrinterErrorKind::no_import_records,
            loc: None,
        });
        PrintErr::CSSPrintError
    }

    pub fn add_invalid_css_modules_pattern_in_grid_error(&mut self) -> PrintErr {
        self.error_kind = Some(css::PrinterError {
            kind: css::PrinterErrorKind::invalid_css_modules_pattern_in_grid,
            loc: Some(css::ErrorLocation {
                filename: std::ptr::from_ref::<[u8]>(self.filename()),
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
                filename: std::ptr::from_ref::<[u8]>(self.filename()),
                line: loc.line - 1,
                column: loc.column,
            }),
        });
        Err(PrintErr::CSSPrintError)
    }

    // PORT NOTE: deinit() dropped — scratchbuf/indentation_buf/dependencies are arena-backed
    // BumpVec<'a, _>; freed in bulk by `arena.reset()`. No explicit Drop impl needed.

    /// If `import_records` is null, then the printer will error when it encounters code that relies on import records (urls())
    pub fn new(
        arena: &'a Bump,
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
            dependencies: if options.analyze_dependencies.is_some() {
                Some(BumpVec::new_in(arena))
            } else {
                None
            },
            remove_imports: options
                .analyze_dependencies
                .as_ref()
                .map(|d| d.remove_imports)
                .unwrap_or(false),
            pseudo_classes: options.pseudo_classes,
            indentation_buf: BumpVec::new_in(arena),
            import_info,
            scratchbuf,
            arena,
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

    /// Construct a `Printer` that writes into an in-memory `Vec<u8>` buffer
    /// using default `PrinterOptions`. Mirrors the Zig pattern of pairing
    /// `std.Io.Writer.Allocating` with `Printer.new(..., PrinterOptions.default(), ...)`
    /// for sub-serialization (e.g. `PseudoClass::toCss`, `Selector` debug fmt).
    pub fn new_buffered(
        arena: &'a Bump,
        dest: &'a mut Vec<u8>,
        import_info: Option<ImportInfo<'a>>,
        local_names: Option<&'a css::LocalsResultsMap>,
        symbols: &'a SymbolMap,
    ) -> Self {
        Printer::new(
            arena,
            BumpVec::new_in(arena),
            dest,
            PrinterOptions::default(),
            import_info,
            local_names,
            symbols,
        )
    }

    #[inline]
    pub fn get_import_records(&mut self) -> PrintResult<&'a Vec<ImportRecord>> {
        if let Some(info) = &self.import_info {
            return Ok(info.import_records);
        }
        Err(self.add_no_import_record_error())
    }

    pub fn print_import_record(&mut self, import_record_idx: u32) -> PrintResult<()> {
        if let Some(info) = &self.import_info {
            let import_record = info.import_records.at(import_record_idx as usize);
            let [a, b] =
                bun_core::cheap_prefix_normalizer(self.public_path, &import_record.path.text);
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
            return Ok(info.import_records.at(import_record_idx as usize));
        }
        Err(self.add_no_import_record_error())
    }

    #[inline]
    pub fn get_import_record_url(&mut self, import_record_idx: u32) -> PrintResult<&[u8]> {
        let Some(import_info) = &self.import_info else {
            return Err(self.add_no_import_record_error());
        };
        let record = import_info.import_records.at(import_record_idx as usize);
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
}

/// `Printer` participates in `serializer::serialize_*<W: bun_io::Write>` so
/// `Token::to_css` and friends can write through it generically.
impl<'a> bun_io::Write for Printer<'a> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        Printer::write_str(self, buf).map_err(|_| bun_core::err!("CSSPrintError"))
    }
    #[inline]
    fn write_byte(&mut self, b: u8) -> bun_io::Result<()> {
        Printer::write_char(self, b).map_err(|_| bun_core::err!("CSSPrintError"))
    }
}

impl<'a> Printer<'a> {
    /// Serialize a CSS identifier through this printer.
    ///
    /// Thin wrapper over `css::serializer::serialize_identifier`. The
    /// serializer returns `bun_io::Result<()>`; `write_str`/`write_char` have
    /// already recorded `add_fmt_error()` on failure, so the error payload is
    /// just remapped to `PrintErr::CSSPrintError`.
    #[inline]
    pub fn serialize_identifier(&mut self, v: &[u8]) -> PrintResult<()> {
        css::serializer::serialize_identifier(v, self).map_err(|_| PrintErr::CSSPrintError)
    }

    /// Serialize a quoted CSS string through this printer. See
    /// [`Printer::serialize_identifier`] for the error-mapping rationale.
    #[inline]
    pub fn serialize_string(&mut self, v: &[u8]) -> PrintResult<()> {
        css::serializer::serialize_string(v, self).map_err(|_| PrintErr::CSSPrintError)
    }

    /// Serialize a CSS name (identifier-tail escaping) through this printer.
    /// See [`Printer::serialize_identifier`] for the error-mapping rationale.
    #[inline]
    pub fn serialize_name(&mut self, v: &[u8]) -> PrintResult<()> {
        css::serializer::serialize_name(v, self).map_err(|_| PrintErr::CSSPrintError)
    }

    pub fn write_comment(&mut self, comment: &[u8]) -> PrintResult<()> {
        if self.dest.write_all(comment).is_err() {
            return Err(self.add_fmt_error());
        }
        let new_lines = comment.iter().filter(|&&b| b == b'\n').count();
        self.line += u32::try_from(new_lines).expect("int cast");
        self.col = 0;
        let last_line_start = comment.len()
            - comment
                .iter()
                .rposition(|&b| b == b'\n')
                .unwrap_or(comment.len());
        self.col += u32::try_from(last_line_start).expect("int cast");
        Ok(())
    }

    /// Writes a raw string to the underlying destination.
    ///
    /// NOTE: Is is assumed that the string does not contain any newline characters.
    /// If such a string is written, it will break source maps.
    pub fn write_str(&mut self, s: impl AsRef<[u8]>) -> PrintResult<()> {
        let s = s.as_ref();
        #[cfg(debug_assertions)]
        {
            debug_assert!(!s.contains(&b'\n'));
        }
        self.col += u32::try_from(s.len()).expect("int cast");
        if self.dest.write_all(s).is_err() {
            return Err(self.add_fmt_error());
        }
        Ok(())
    }

    /// Alias of `write_str` for callers that want to be explicit about
    /// possibly-newline-containing byte content (Zig: `writeBytes`).
    #[inline]
    pub fn write_bytes(&mut self, s: &[u8]) -> PrintResult<()> {
        // TODO(port): Zig writeBytes did not assert no-newline; tracked
        // line/col separately. For now route through write_str.
        self.col += u32::try_from(s.len()).expect("int cast");
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
        self.col += u32::try_from(written).expect("int cast");
        Ok(())
    }

    fn replace_dots<'b>(arena: &'b Bump, s: &[u8]) -> &'b mut [u8] {
        let str_ = arena.alloc_slice_copy(s);
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
                return self.serialize_identifier(identifier.v());
            } else {
                let ref_ = ident.as_ref().unwrap();
                let Some(symbol) = self.symbols.get_const(ref_) else {
                    return Err(self.add_fmt_error());
                };
                // PORT NOTE: copy out the arena slice before re-borrowing &mut self.
                let name = symbol.original_name.slice();
                return self.serialize_identifier(name);
            }
        }

        // `lookup_ident_or_ref` returns an `'a`-lifetime slice (arena/symbol-table),
        // independent of the `&self` borrow, so no clone is needed before re-borrowing
        // `&mut self` for the writer.
        let str_: &'a [u8] = self.lookup_ident_or_ref(ident);
        self.serialize_identifier(str_)
    }

    /// Writes a CSS identifier to the underlying destination, escaping it
    /// as appropriate. If the `css_modules` option was enabled, then a hash
    /// is added, and the mapping is added to the CSS module.
    pub fn write_ident(&mut self, ident: &'a [u8], handle_css_module: bool) -> PrintResult<()> {
        if handle_css_module {
            if self.css_module.is_some() {
                // PORT NOTE: borrowck reshape — Zig captured `&mut self` inside the closure
                // while `css_module` (a field of self) was simultaneously borrowed. We instead
                // copy the `'a`-lifetime references out of `css_module` up front so the
                // closure can hold the sole `&mut self`.
                let source_index = self.loc.source_index as usize;
                let arena = self.arena;
                let (config, hash, source): (&'a css::css_modules::Config, &'a [u8], &'a [u8]) = {
                    let m = self.css_module.as_ref().unwrap();
                    let sources: &'a Vec<Box<[u8]>> = m.sources;
                    (
                        m.config,
                        m.hashes[source_index],
                        sources[source_index].as_ref(),
                    )
                };

                let mut first = true;
                let mut err: Option<PrintErr> = None;
                config
                    .pattern
                    .write(hash, source, ident, |s1: &[u8], replace_dots: bool| {
                        if err.is_some() {
                            return;
                        }
                        // PERF: stack fallback?
                        let s: &[u8] = if !replace_dots {
                            s1
                        } else {
                            Printer::replace_dots(arena, s1)
                        };
                        self.col += u32::try_from(s.len()).expect("int cast");
                        let r = if first {
                            first = false;
                            css::serializer::serialize_identifier(s, self)
                        } else {
                            css::serializer::serialize_name(s, self)
                        };
                        if r.is_err() {
                            err = Some(PrintErr::CSSPrintError);
                        }
                    });
                if let Some(e) = err {
                    return Err(e);
                }

                let src_idx = self.loc.source_index;
                self.css_module
                    .as_mut()
                    .unwrap()
                    .add_local(arena, ident, ident, src_idx);
                return Ok(());
            }
        }

        self.serialize_identifier(ident)
    }

    pub fn write_dashed_ident(
        &mut self,
        ident: &DashedIdent,
        is_declaration: bool,
    ) -> PrintResult<()> {
        self.write_str(b"--")?;

        // NOTE: cannot use `ident.v()` here — `add_dashed` requires `&'a [u8]`
        // (arena lifetime), but the safe accessor ties the borrow to `&ident`.
        // SAFETY: DashedIdent.v is an arena-owned slice valid for `'a`.
        let ident_v: &'a [u8] = unsafe { crate::arena_str(ident.v) };

        let dashed_idents = match &self.css_module {
            Some(m) => m.config.dashed_idents,
            None => false,
        };
        if dashed_idents {
            // PORT NOTE: same borrowck reshape as `write_ident`.
            let source_index = self.loc.source_index as usize;
            let arena = self.arena;
            let (config, hash, source): (&'a css::css_modules::Config, &'a [u8], &'a [u8]) = {
                let m = self.css_module.as_ref().unwrap();
                let sources: &'a Vec<Box<[u8]>> = m.sources;
                (
                    m.config,
                    m.hashes[source_index],
                    sources[source_index].as_ref(),
                )
            };

            let mut err: Option<PrintErr> = None;
            config.pattern.write(
                hash,
                source,
                &ident_v[2..],
                |s1: &[u8], replace_dots: bool| {
                    if err.is_some() {
                        return;
                    }
                    let s: &[u8] = if !replace_dots {
                        s1
                    } else {
                        Printer::replace_dots(arena, s1)
                    };
                    self.col += u32::try_from(s.len()).expect("int cast");
                    if css::serializer::serialize_name(s, self).is_err() {
                        err = Some(PrintErr::CSSPrintError);
                    }
                },
            );
            if let Some(e) = err {
                return Err(e);
            }

            if is_declaration {
                let src_idx = self.loc.source_index;
                self.css_module
                    .as_mut()
                    .unwrap()
                    .add_dashed(arena, ident_v, src_idx);
            }
        }

        self.serialize_name(&ident_v[2..])
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

    /// Writes a `{ ... }` block envelope: optional leading whitespace, `{`,
    /// indent, the caller-supplied body, dedent, trailing newline, `}`.
    ///
    /// This is the shared shape used by every nested-rule at-rule printer
    /// (`@media`, `@supports`, `@container`, `@layer`, `@starting-style`,
    /// `@-moz-document`, unknown at-rules). The body closure is responsible
    /// for its own leading `newline()` if it wants one — per-item printers
    /// (e.g. `@font-face`, `@keyframes`) interleave newlines differently.
    pub fn block(&mut self, f: impl FnOnce(&mut Self) -> PrintResult<()>) -> PrintResult<()> {
        self.whitespace()?;
        self.write_char(b'{')?;
        self.indent();
        f(self)?;
        self.dedent();
        self.newline()?;
        self.write_char(b'}')
    }

    /// Writes each item via `f`, calling `sep` *between* items (not before the
    /// first, not after the last). All errors short-circuit via `?`.
    ///
    /// This is the canonical replacement for the open-coded
    /// `let mut first = true; for x in iter { if !first { <sep>? } first = false; <body>? }`
    /// loop that pervades `to_css` impls.
    ///
    /// `sep` is a closure — not a `u8` — because the dominant separator in CSS
    /// printing is [`delim`](Self::delim) (minify-aware whitespace around a byte),
    /// and several sites need a multi-statement or `minify`-conditional separator.
    pub fn write_separated<I, S, F>(&mut self, iter: I, mut sep: S, mut f: F) -> PrintResult<()>
    where
        I: IntoIterator,
        S: FnMut(&mut Self) -> PrintResult<()>,
        F: FnMut(&mut Self, I::Item) -> PrintResult<()>,
    {
        let mut first = true;
        for item in iter {
            if first {
                first = false;
            } else {
                sep(self)?;
            }
            f(self, item)?;
        }
        Ok(())
    }

    /// [`write_separated`](Self::write_separated) with the most common separator,
    /// [`delim(b',', false)`](Self::delim).
    #[inline]
    pub fn write_comma_separated<I, F>(&mut self, iter: I, f: F) -> PrintResult<()>
    where
        I: IntoIterator,
        F: FnMut(&mut Self, I::Item) -> PrintResult<()>,
    {
        self.write_separated(iter, |d| d.delim(b',', false), f)
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
        // Inner-lifetime variance cast via raw pointer (`StyleContext<'x>` and
        // `StyleContext<'a>` share layout; only the borrow-checker tag differs).
        self.ctx = Some(unsafe { &*core::ptr::from_ref(&ctx).cast::<css::StyleContext<'a>>() });
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

// bun.ast.Symbol.Map — lives in bun_logger.
type SymbolMap = bun_ast::symbol::Map;

// ported from: src/css/printer.zig
