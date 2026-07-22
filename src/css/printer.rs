use core::fmt;

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec as BumpVec;
use bun_ast::ImportRecord;

use crate::css_parser as css;
use crate::values as css_values;

use crate::{Location, PrintErr, PrintResult};
use css_values::ident::DashedIdent;

// Byte-oriented writer (writeAll/writeByte/print equivalents).
use bun_io::Write;

/// Options that control how CSS is serialized to a string.
pub struct PrinterOptions<'a> {
    /// Whether to minify the CSS, i.e. remove white space.
    pub minify: bool,
    /// An optional project root path, used to generate relative paths for sources used in CSS module hashes.
    pub project_root: Option<&'a [u8]>,
    /// Targets to output the CSS for.
    pub targets: Targets,
    /// A mapping of pseudo classes to replace with class names that can be applied
    /// from JavaScript. Useful for polyfills, for example.
    pub pseudo_classes: Option<PseudoClasses<'a>>,
}

impl<'a> PrinterOptions<'a> {
    pub fn default() -> PrinterOptions<'a> {
        Self::default_with_minify(false)
    }

    pub(crate) fn default_with_minify(minify: bool) -> PrinterOptions<'a> {
        PrinterOptions {
            minify,
            project_root: None,
            targets: Targets {
                browsers: None,
                ..Targets::default()
            },
            pseudo_classes: None,
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
    pub(crate) hover: Option<&'a [u8]>,
    /// The class name to replace `:active` with.
    pub(crate) active: Option<&'a [u8]>,
    /// The class name to replace `:focus` with.
    pub(crate) focus: Option<&'a [u8]>,
    /// The class name to replace `:focus-visible` with.
    pub(crate) focus_visible: Option<&'a [u8]>,
    /// The class name to replace `:focus-within` with.
    pub(crate) focus_within: Option<&'a [u8]>,
}

pub use css::targets::Targets;

pub use css::targets::Features;

#[derive(Clone, Copy)]
pub struct ImportInfo<'a> {
    pub import_records: &'a [ImportRecord],
    /// bundle_v2.graph.ast.items(.url_for_css)
    pub ast_urls_for_css: &'a [&'a [u8]],
    /// bundle_v2.graph.input_files.items(.unique_key_for_additional_file)
    pub ast_unique_key_for_additional_file: &'a [&'a [u8]],
}

impl<'a> ImportInfo<'a> {
    /// Only safe to use when outside the bundler. As in, the import records
    /// were not resolved to source indices. This will out-of-bounds otherwise.
    pub fn init_outside_of_bundler(records: &'a [ImportRecord]) -> ImportInfo<'a> {
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
    pub(crate) sources: Option<&'a Vec<Box<[u8]>>>,
    pub(crate) dest: &'a mut dyn Write,
    pub(crate) loc: Location,
    pub(crate) indent_amt: u8,
    pub(crate) line: u32,
    pub(crate) col: u32,
    pub(crate) minify: bool,
    pub(crate) targets: Targets,
    pub(crate) vendor_prefix: css::VendorPrefix,
    /// True while nested rules are being re-serialized for a non-final vendor
    /// prefix pass of an ancestor style rule (when nesting is compiled away).
    /// Nested style rules that carry their own vendor prefixes override
    /// `vendor_prefix`, so their output is identical in every ancestor pass;
    /// they are skipped while this is set and emitted once in the final pass,
    /// keeping the output linear in nesting depth instead of exponential.
    pub(crate) skip_prefixed_nested_rules: bool,
    pub(crate) in_calc: bool,
    pub(crate) css_module: Option<css::CssModule<'a>>,
    /// A mapping of pseudo classes to replace with class names that can be applied
    /// from JavaScript. Useful for polyfills, for example.
    pub(crate) pseudo_classes: Option<PseudoClasses<'a>>,
    // INVARIANT: `with_context()` points this at a stack-local `StyleContext` (via an
    // unsafe variance cast — see the SAFETY note there) and always restores the parent
    // before that frame returns; never stash `ctx` beyond the `with_context` call.
    pub(crate) ctx: Option<&'a css::StyleContext<'a>>,
    /// Number of parent-selector substitutions performed for `&` while
    /// serializing the current rule prelude with compiled nesting (targets
    /// without CSS nesting support). Reset per prelude (in
    /// `StyleRule::to_css_base` and `ScopeRule::to_css`) and bounded in
    /// `serialize::serialize_nesting` so deeply nested rules with multiple
    /// `&` references per level cannot expand exponentially.
    pub(crate) nesting_expansions: u32,
    /// Running total of bytes emitted by duplicate vendor-prefix passes. A rule
    /// whose selector list carries more than one vendor prefix (e.g. a list
    /// mixing `:-webkit-autofill` with an unprefixed pseudo-class, or a single
    /// pseudo downleveled to several prefixes) is serialized once per prefix,
    /// and every pass after the first re-serializes the rule's whole body —
    /// declarations, nested rules, and everything under them. Nesting such
    /// rules repeats that body once per prefix at every level, so the output
    /// grows by (prefix count)^depth. The bytes written by each such duplicate
    /// pass are measured and accumulated here (across the whole stylesheet,
    /// never reset) and bounded in `StyleRule::to_css`, so a few kilobytes of
    /// deeply nested input cannot expand into gigabytes — regardless of whether
    /// the duplicated payload is nested rules or a large declaration block. The
    /// original (first) pass of each rule, and any single-prefix output (which
    /// has no passes after the first), emit nothing here. A flat multi-prefix
    /// rule's later passes do count, but without nesting to compound them that
    /// stays linear in the input.
    pub(crate) prefix_expansion_bytes: usize,
    pub(crate) scratchbuf: BumpVec<'a, u8>,
    pub(crate) error_kind: Option<css::PrinterError>,
    pub(crate) import_info: Option<ImportInfo<'a>>,
    pub(crate) symbols: &'a SymbolMap,
    pub(crate) local_names: Option<&'a css::LocalsResultsMap>,
    /// NOTE This should be the same mimalloc heap arena arena
    pub(crate) arena: &'a Bump,
}

impl<'a> Printer<'a> {
    pub(crate) fn lookup_symbol(&self, ref_: bun_ast::Ref) -> &'a [u8] {
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

    pub(crate) fn lookup_ident_or_ref(&self, ident: css_values::ident::IdentOrRef) -> &'a [u8] {
        if ident.is_ident() {
            // SAFETY: Ident.v is an arena-owned slice packed by IdentOrRef::from_ident.
            return unsafe { crate::arena_str(ident.as_ident().unwrap().v) };
        }
        self.lookup_symbol(ident.as_ref().unwrap())
    }

    // The `Write` trait exposes `written_len()` directly
    // (Vec<u8> / MutableString / counting sinks override it, others panic).
    #[inline]
    fn get_written_amt(writer: &dyn Write) -> usize {
        writer.written_len()
    }

    /// Total number of bytes written to the destination so far. Used to measure
    /// how much output a duplicate vendor-prefix pass emits (see
    /// `prefix_expansion_bytes`).
    #[inline]
    pub(crate) fn bytes_written(&self) -> usize {
        Self::get_written_amt(self.dest)
    }

    /// Returns the current source filename that is being printed.
    pub(crate) fn filename(&self) -> &[u8] {
        if let Some(sources) = self.sources {
            if (self.loc.source_index as usize) < sources.len() {
                return sources[self.loc.source_index as usize].as_ref();
            }
        }
        b"unknown.css"
    }

    /// Returns whether the indent level is greater than one.
    pub(crate) fn is_nested(&self) -> bool {
        self.indent_amt > 2
    }

    /// Add an error related to std lib fmt errors
    pub(crate) fn add_fmt_error(&mut self) -> PrintErr {
        self.error_kind = Some(css::PrinterError {
            kind: css::PrinterErrorKind::fmt_error,
            loc: None,
        });
        PrintErr::CSSPrintError
    }

    pub(crate) fn add_no_import_record_error(&mut self) -> PrintErr {
        self.error_kind = Some(css::PrinterError {
            kind: css::PrinterErrorKind::no_import_records,
            loc: None,
        });
        PrintErr::CSSPrintError
    }

    /// Returns an error of the given kind at the provided location in the current source file.
    pub(crate) fn new_error(
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

    // deinit() dropped — scratchbuf is arena-backed
    // BumpVec<'a, _>; freed in bulk by `arena.reset()`. No explicit Drop impl needed.

    /// If `import_records` is null, then the printer will error when it encounters code that relies on import records (urls())
    pub fn new(
        arena: &'a Bump,
        scratchbuf: BumpVec<'a, u8>,
        dest: &'a mut dyn Write,
        options: &PrinterOptions<'a>,
        import_info: Option<ImportInfo<'a>>,
        local_names: Option<&'a css::LocalsResultsMap>,
        symbols: &'a SymbolMap,
    ) -> Self {
        Printer {
            sources: None,
            dest,
            minify: options.minify,
            targets: options.targets,
            pseudo_classes: options.pseudo_classes,
            import_info,
            scratchbuf,
            arena,
            local_names,
            loc: Location {
                source_index: 0,
                line: 0,
                column: 1,
            },
            symbols,
            indent_amt: 0,
            line: 0,
            col: 0,
            vendor_prefix: css::VendorPrefix::default(),
            skip_prefixed_nested_rules: false,
            in_calc: false,
            css_module: None,
            ctx: None,
            nesting_expansions: 0,
            prefix_expansion_bytes: 0,
            error_kind: None,
        }
    }

    #[inline]
    pub(crate) fn import_record(&mut self, import_record_idx: u32) -> PrintResult<&ImportRecord> {
        if let Some(info) = &self.import_info {
            return Ok(&info.import_records[import_record_idx as usize]);
        }
        Err(self.add_no_import_record_error())
    }

    #[inline]
    pub(crate) fn get_import_record_url(&mut self, import_record_idx: u32) -> PrintResult<&[u8]> {
        let Some(import_info) = &self.import_info else {
            return Err(self.add_no_import_record_error());
        };
        let record = &import_info.import_records[import_record_idx as usize];
        if record.source_index.is_valid() {
            // A `url()`'s `?query`/`#fragment` (e.g. `url(sprites.svg#icon)`) is
            // stripped by the resolver to find the file; re-append it to the
            // rewritten reference so the fragment still addresses the element.
            let suffix: &[u8] = if record.kind == bun_ast::ImportKind::Url {
                match bun_core::strings::index_of_any(record.original_path, b"?#") {
                    Some(i) => &record.original_path[i..],
                    None => b"",
                }
            } else {
                b""
            };
            let arena = self.arena;
            let with_suffix = |url: &'a [u8], suffix: &[u8]| -> &'a [u8] {
                if suffix.is_empty() {
                    return url;
                }
                let buf = arena.alloc_slice_fill_copy(url.len() + suffix.len(), 0u8);
                buf[..url.len()].copy_from_slice(url);
                buf[url.len()..].copy_from_slice(suffix);
                buf
            };
            // It has an inlined data: URL for CSS. A `?query` here lands in the
            // base64 body and fails decoding, so keep only the `#fragment`.
            let urls_for_css = import_info.ast_urls_for_css[record.source_index.get() as usize];
            if !urls_for_css.is_empty() {
                let fragment: &[u8] = match bun_core::strings::index_of_char(suffix, b'#') {
                    Some(i) => &suffix[i as usize..],
                    None => b"",
                };
                return Ok(with_suffix(urls_for_css, fragment));
            }
            // It is a chunk URL (copied asset): keep the full `?query#fragment`.
            let unique_key_for_additional_file =
                import_info.ast_unique_key_for_additional_file[record.source_index.get() as usize];
            if !unique_key_for_additional_file.is_empty() {
                return Ok(with_suffix(unique_key_for_additional_file, suffix));
            }
        }
        // External URL stays as-is
        Ok(record.path.text)
    }

    pub(crate) fn context(&self) -> Option<&css::StyleContext<'a>> {
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
        Printer::write_str(self, buf).map_err(|_| bun_core::Error::WriteFailed)
    }
    #[inline]
    fn write_byte(&mut self, b: u8) -> bun_io::Result<()> {
        Printer::write_char(self, b).map_err(|_| bun_core::Error::WriteFailed)
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
    pub(crate) fn serialize_identifier(&mut self, v: &[u8]) -> PrintResult<()> {
        css::serializer::serialize_identifier(v, self).map_err(|_| PrintErr::CSSPrintError)
    }

    /// Serialize a quoted CSS string through this printer. See
    /// [`Printer::serialize_identifier`] for the error-mapping rationale.
    #[inline]
    pub(crate) fn serialize_string(&mut self, v: &[u8]) -> PrintResult<()> {
        css::serializer::serialize_string(v, self).map_err(|_| PrintErr::CSSPrintError)
    }

    /// Serialize a CSS name (identifier-tail escaping) through this printer.
    /// See [`Printer::serialize_identifier`] for the error-mapping rationale.
    #[inline]
    pub(crate) fn serialize_name(&mut self, v: &[u8]) -> PrintResult<()> {
        css::serializer::serialize_name(v, self).map_err(|_| PrintErr::CSSPrintError)
    }

    pub(crate) fn write_comment(&mut self, comment: &[u8]) -> PrintResult<()> {
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
    pub(crate) fn write_str(&mut self, s: impl AsRef<[u8]>) -> PrintResult<()> {
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

    /// `write_str(&self.scratchbuf[range])` with the field borrows split so
    /// callers can fill `scratchbuf` and flush it through the same `&mut self`.
    pub(crate) fn write_scratchbuf(&mut self, range: core::ops::Range<usize>) -> PrintResult<()> {
        let s = &self.scratchbuf[range];
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

    /// Like `write_str`, but newline-containing byte content is permitted:
    /// `line`/`col` are tracked across newlines (matching `write_char` applied
    /// byte-by-byte), whereas `write_str` debug-asserts that no newlines are
    /// present. Used for raw token round-trip content (whitespace tokens,
    /// comments, unparsed contents).
    #[inline]
    pub(crate) fn write_bytes(&mut self, s: &[u8]) -> PrintResult<()> {
        // Unlike `write_str`, newlines are allowed here; track line/col across them
        // (matching `write_char` applied byte-by-byte) so source maps stay correct.
        if let Some(last_newline) = s.iter().rposition(|&b| b == b'\n') {
            let new_lines = s.iter().filter(|&&b| b == b'\n').count();
            self.line += u32::try_from(new_lines).expect("int cast");
            self.col = u32::try_from(s.len() - last_newline - 1).expect("int cast");
        } else {
            self.col += u32::try_from(s.len()).expect("int cast");
        }
        if self.dest.write_all(s).is_err() {
            return Err(self.add_fmt_error());
        }
        Ok(())
    }

    /// Writes a formatted string to the underlying destination.
    ///
    /// NOTE: Is is assumed that the formatted string does not contain any newline characters.
    /// If such a string is written, it will break source maps.
    pub(crate) fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> PrintResult<()> {
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

    pub(crate) fn write_ident_or_ref(
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
                // Copy out the arena slice before re-borrowing &mut self.
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
    pub(crate) fn write_ident(
        &mut self,
        ident: &'a [u8],
        handle_css_module: bool,
    ) -> PrintResult<()> {
        if handle_css_module {
            if self.css_module.is_some() {
                // Copy the `'a`-lifetime references out of `css_module` up front so
                // the closure can hold the sole `&mut self`.
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

                return Ok(());
            }
        }

        self.serialize_identifier(ident)
    }

    pub(crate) fn write_dashed_ident(&mut self, ident: &DashedIdent) -> PrintResult<()> {
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
            // Same borrowck reshape as `write_ident`.
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
        }

        self.serialize_name(&ident_v[2..])
    }

    /// Write a single character to the underlying destination.
    pub(crate) fn write_char(&mut self, char_: u8) -> PrintResult<()> {
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
    pub(crate) fn newline(&mut self) -> PrintResult<()> {
        if self.minify {
            return Ok(());
        }

        self.write_char(b'\n')?;
        self.write_indent()
    }

    /// Writes a delimiter character, followed by whitespace (depending on the `minify` option).
    /// If `ws_before` is true, then whitespace is also written before the delimiter.
    pub(crate) fn delim(&mut self, delim_: u8, ws_before: bool) -> PrintResult<()> {
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
    pub(crate) fn whitespace(&mut self) -> PrintResult<()> {
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
    pub(crate) fn block(
        &mut self,
        f: impl FnOnce(&mut Self) -> PrintResult<()>,
    ) -> PrintResult<()> {
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
    pub(crate) fn write_separated<I, S, F>(
        &mut self,
        iter: I,
        mut sep: S,
        mut f: F,
    ) -> PrintResult<()>
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
    pub(crate) fn write_comma_separated<I, F>(&mut self, iter: I, f: F) -> PrintResult<()>
    where
        I: IntoIterator,
        F: FnMut(&mut Self, I::Item) -> PrintResult<()>,
    {
        self.write_separated(iter, |d| d.delim(b',', false), f)
    }

    pub(crate) fn with_context<C, F>(
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

        // `&ctx` is stack-local but the field type is `&'a StyleContext<'a>`;
        // soundness relies on restoring `parent` before this frame returns.
        // SAFETY: ctx outlives the call to func; self.ctx is restored to `parent` before return.
        // Inner-lifetime variance cast via raw pointer (`StyleContext<'x>` and
        // `StyleContext<'a>` share layout; only the borrow-checker tag differs).
        self.ctx = Some(unsafe { &*core::ptr::from_ref(&ctx).cast::<css::StyleContext<'a>>() });
        let res = func(closure, self);
        self.ctx = parent;

        res
    }

    pub(crate) fn with_cleared_context<C, F>(&mut self, closure: C, func: F) -> PrintResult<()>
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
    pub(crate) fn indent(&mut self) {
        self.indent_amt += 2;
    }

    /// Decreases the current indent level.
    pub(crate) fn dedent(&mut self) {
        self.indent_amt -= 2;
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

// bun.ast.Symbol.Map — lives in bun_logger.
type SymbolMap = bun_ast::symbol::Map;
