//! Most files that `bun fmt` is given are already formatted. [`check`] recognizes them without building the file's
//! syntax tree and document. It may answer [`Verdict::Unknown`] for any file, but [`Verdict::Formatted`] only if
//! formatting the file would succeed and return the same text. If only some statements are known to be formatted, it
//! replaces them with placeholders, and the formatter gets what's left.
//!
//! - [`parser`] builds a small tree for one top-level statement at a time.
//! - [`emit`] has the printing rules for that tree. A statement that's on one line is compared with the source token by
//!   token. For any other statement it writes a document, in which what's on one line is a text, and the real printer
//!   prints it.
//! - The statements in a block don't affect the layout of what's around the block. They're left out of the document
//!   and checked on their own.

mod emit;
mod lexer;
mod parser;
mod tree;

use self::emit::{Emitter, Hole, is_comment_settled, is_inert};
use self::lexer::{Comment, Gap, Lexer, T};
use self::parser::{Language, Parser, Style};
use self::tree::{Id, K, NONE, Node, Tree, flag};
use crate::ir::formatter::FormatterBuffers;
use crate::ir::prelude::*;
use crate::ir::printer::{Outcome, PLACEHOLDER, PrinterBuffers, PrinterOptions, print};
use crate::js::comments::NO_COMMENTS;
use crate::js::context::JsFormatContext;
use crate::js::sort_imports::{PrintedImport, SortImports, UnchangedImports};
use crate::options::*;
use crate::tailwind::Oxc;
use bun_core::strings;

/// Allocations that are reused for the next file.
#[derive(Default)]
pub struct Scratch {
    tree: Tree,
    parser: parser::Buffers,
    lexer: lexer::Buffers,
    stops: bun_highway::ScannerStopsBuffer,
    holes: Vec<Hole>,
    cache: emit::Cache,
    follow: emit::Follow,
    formatter: FormatterBuffers,
    printer: PrinterBuffers,
    printed: Vec<u8>,
    elisions: Vec<Elision>,
    reduced: Vec<u8>,
    /// See [`Parser::has_skipped`].
    has_skipped: bool,
    has_semicolons: bool,
    has_carriage_returns: bool,
    /// The text without carriage returns
    lines: Vec<u8>,
    are_imports_unsettled: bool,
}

fn are_options_supported(options: &FormatOptions) -> bool {
    (1..=16).contains(&options.indent_width.value())
        && options.line_width.value() <= 10_000
        && options.experimental_operator_position != OperatorPosition::Start
        && !options.experimental_ternaries
        && options.parser.is_none()
        && (
            options.range_start,
            options.range_end,
            options.cursor_offset,
        ) == (None, None, None)
        && !options.insert_pragma
        && !(options.is_in_markdown || options.is_mdx_jsx || options.is_mdx_es_syntax)
        && !options.is_in_html_file
        && options.in_html.root == HtmlRoot::None
        && options.html_template_depth == 0
        && options.jsdoc.is_none()
        && (options.tailwind.as_deref()).is_none_or(|it| it.oxc != Oxc::After)
        && options.debug_comments == DebugComments::default()
}

fn language_of(path: &[u8]) -> Option<Language> {
    let extension = path.get(strings::last_index_of_char(path, b'.')?..)?;
    let is_typescript = match extension {
        b".ts" | b".tsx" | b".mts" | b".cts" => true,
        b".js" | b".jsx" | b".mjs" | b".cjs" => false,
        _ => return None,
    };
    let name = path.get(strings::last_index_of_any(path, b"/\\").map_or(0, |it| it + 1)..)?;
    let is_declaration_file = is_typescript && strings::contains(name, b".d.");
    if is_declaration_file && !path.ends_with(b".d.ts") {
        return None;
    }
    Some(Language {
        is_typescript,
        has_jsx: !is_typescript || extension == b".tsx",
        allows_module_syntax: !matches!(extension, b".cjs" | b".cts"),
        reserves_angle_brackets: matches!(extension, b".mts" | b".cts"),
        is_declaration_file,
    })
}

fn is_text_supported(text: &[u8], is_ascii: bool) -> bool {
    text.len() < (u32::MAX / 4) as usize
        && text.ends_with(b"\n")
        && strings::index_of_any(text, b"\0\r\x7F").is_none()
        && (is_ascii
            || (strings::is_valid_utf8(text)
                && !strings::contains(text, "\u{2028}".as_bytes())
                && !strings::contains(text, "\u{2029}".as_bytes())))
}

/// False if the first block of a statement is indented in another style, so that next to nothing is formatted.
fn is_indented_alike(text: &[u8], options: &FormatOptions) -> bool {
    let Some(at) = strings::index_of(text, b"{\n") else {
        return true;
    };
    let line = strings::last_index_of_char(&text[..at], b'\n').map_or(0, |it| it + 1);
    let inside = &text[at + 2..];
    let is_blank = |it: &&u8| matches!(it, b' ' | b'\t');
    match inside.iter().take_while(is_blank).count() {
        0 => true,
        _ if !text[line].is_ascii_alphabetic() => true,
        count if options.indent_style.is_tab() => inside[..count] == *b"\t",
        count => count == options.indent_width.value() as usize && inside[0] == b' ',
    }
}

/// What [`check`] found.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Verdict {
    /// Formatting succeeds and changes nothing.
    Formatted,
    /// Only [`Scratch::reduced`] has to be formatted.
    Reduced,
    Unknown,
}

/// `text` is the content of the JavaScript or TypeScript file at `path`, which isn't a Flow file.
pub fn check(path: &[u8], text: &[u8], options: &FormatOptions, scratch: &mut Scratch) -> Verdict {
    scratch.has_carriage_returns = match options.line_ending.resolve(text) {
        LineEnding::Lf => false,
        LineEnding::Crlf => true,
        _ => return Verdict::Unknown,
    };
    if !scratch.has_carriage_returns {
        return check_lines(path, text, options, scratch);
    }
    let mut lines = std::mem::take(&mut scratch.lines);
    lines.clear();
    strings::push_crlf_as_lf(&mut lines, text);
    let mut verdict = Verdict::Unknown;
    if lines.len() + strings::count_char(&lines, b'\n') == text.len()
        && strings::count_char(text, b'\n') == text.len() - lines.len()
    {
        verdict = check_lines(path, &lines, options, scratch);
    }
    if verdict == Verdict::Reduced {
        lines.clear();
        crate::range::write_with_line_ending(&scratch.reduced, b"\r\n", &mut lines);
        std::mem::swap(&mut lines, &mut scratch.reduced);
    }
    scratch.lines = lines;
    verdict
}

/// The lines of `text` end with line feeds.
fn check_lines(
    path: &[u8],
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
) -> Verdict {
    let sort = options.sort_imports.as_deref();
    if sort.is_none_or(SortImports::only_moves_imports) {
        let verdict = check_with(path, text, options, Imports::Checked, scratch);
        if !std::mem::take(&mut scratch.are_imports_unsettled) {
            return verdict;
        }
    }
    match sort.is_some_and(SortImports::only_looks_at_imports) {
        true => check_with(path, text, options, Imports::Kept, scratch),
        false => Verdict::Unknown,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Imports {
    /// Like other statements, and with [`UnchangedImports`] if they're sorted.
    Checked,
    /// Everything up to the first token after the last import is left to the formatter.
    Kept,
}

fn check_with(
    path: &[u8],
    text: &[u8],
    options: &FormatOptions,
    imports: Imports,
    scratch: &mut Scratch,
) -> Verdict {
    let Some(language) = language_of(path) else {
        return Verdict::Unknown;
    };
    let is_renamed = (options.filepath.as_deref()).is_some_and(|it| !it.is_empty() && it != path);
    let is_ascii = strings::is_all_ascii(text);
    if is_renamed
        || !are_options_supported(options)
        || !is_text_supported(text, is_ascii)
        || !is_indented_alike(text, options)
    {
        return Verdict::Unknown;
    }
    // The parser would ask for the order of classes that aren't sorted.
    if options.tailwind.is_some()
        && (strings::contains(text, b"prettier-ignore") || strings::contains(text, b"oxfmt-ignore"))
    {
        return Verdict::Unknown;
    }
    let mut stops = std::mem::take(&mut scratch.stops);
    let lexer = Lexer::new(
        text,
        stops.find(text),
        std::mem::take(&mut scratch.lexer),
        options.line_width.value(),
        options.indent_width.value(),
    );
    let style = Style {
        quote: options.quote_style.as_byte(),
        jsx_quote: options.jsx_quote_style.as_byte(),
        has_semicolons: options.semicolons.is_always(),
        inside_braces: if options.bracket_spacing.value() {
            Gap::Space
        } else {
            Gap::None
        },
        avoids_arrow_parentheses: options.arrow_parentheses.is_as_needed(),
        has_one_attribute_per_line: options.attribute_position == AttributePosition::Multiline,
        has_consistent_keys: options.quote_properties.is_consistent(),
    };
    let (tree, buffers) = (
        std::mem::take(&mut scratch.tree),
        std::mem::take(&mut scratch.parser),
    );
    let mut parser = Parser::new(
        lexer,
        tree,
        buffers,
        language,
        (style, options.tailwind.as_deref()),
    );
    let context = JsFormatContext::without_file(options.clone(), &NO_COMMENTS);
    let mut formatter = Formatter::new(context, text, std::mem::take(&mut scratch.formatter));
    let flags = (!language.is_typescript, !path.ends_with(b".ts"), is_ascii);
    scratch.follow.set_options(options);
    let verdict = match check_file(&mut parser, &mut formatter, flags, imports, scratch) {
        Some(true) => Verdict::Formatted,
        Some(false) if !parser.are_statements_linked() && !language.is_declaration_file => {
            scratch.has_skipped = parser.has_skipped;
            scratch.has_semicolons = options.semicolons.is_always();
            scratch.reduce(text)
        }
        _ => Verdict::Unknown,
    };
    scratch.formatter = formatter.finish().1;
    (scratch.tree, scratch.parser) = (parser.tree, parser.buffers);
    scratch.lexer = parser.lx.into_buffers();
    scratch.stops = stops;
    verdict
}

pub(crate) fn write_placeholder(f: &mut Formatter<'_>) {
    if_group_breaks(&PLACEHOLDER).fmt(f);
    group(&()).fmt(f);
}

/// Consecutive statements that are formatted.
#[derive(Copy, Clone)]
struct Elision {
    start: u32,
    end: u32,
    has_comments: bool,
    has_module_syntax: bool,
}

impl Elision {
    fn indentation(self, text: &[u8]) -> &[u8] {
        let before = text.get(..self.start as usize).unwrap_or_default();
        let len = before.iter().rev().take_while(|&&b| b != b'\n').count();
        before.get(before.len() - len..).unwrap_or_default()
    }

    /// What's before and after the [`PLACEHOLDER`].
    fn around_placeholder(self, has_semicolons: bool) -> [&'static [u8]; 2] {
        let before: &[u8] = match (self.has_module_syntax, has_semicolons) {
            (false, _) => b"",
            (true, true) => b"export {};\n",
            (true, false) => b"export {}\n",
        };
        let after: &[u8] = match (self.has_comments, has_semicolons) {
            (false, false) => b"",
            (false, true) => b";",
            (true, false) => b" //",
            (true, true) => b"; //",
        };
        [before, after]
    }
}

impl Scratch {
    fn reduce(&mut self, text: &[u8]) -> Verdict {
        self.reduced.clear();
        let mut at = 0;
        for &elision in &self.elisions {
            let [before, after] = elision.around_placeholder(self.has_semicolons);
            let kept = text.get(at..elision.start as usize).unwrap_or_default();
            if strings::contains(kept, PLACEHOLDER.as_bytes()) {
                return Verdict::Unknown;
            }
            for part in [kept, before, PLACEHOLDER.as_bytes(), after] {
                self.reduced.extend_from_slice(part);
            }
            at = elision.end as usize;
        }
        let rest = text.get(at..).unwrap_or_default();
        self.reduced.extend_from_slice(rest);
        match self.reduced.len() * 5 < text.len() * 4
            && !strings::contains(rest, PLACEHOLDER.as_bytes())
        {
            true => Verdict::Reduced,
            false => Verdict::Unknown,
        }
    }

    /// The file with placeholders for the statements that are formatted. See [`FormatOptions::is_reduced`].
    pub fn reduced(&self) -> &[u8] {
        &self.reduced
    }

    /// Returns the result of formatting `text`, if it follows from `formatted`, which is what [`Scratch::reduced`]
    /// was just formatted to with `scratch`.
    pub fn restore(
        &self,
        text: &[u8],
        formatted: &[u8],
        scratch: &crate::Scratch,
    ) -> Option<Vec<u8>> {
        let outcome = scratch.outcome();
        require(outcome.placeholders as usize == self.elisions.len())?;
        require(!outcome.has_placeholder_in_try)?;
        if formatted == self.reduced {
            return Some(text.to_vec());
        }
        require(!self.has_skipped && !self.has_carriage_returns)?;
        let (mut out, mut rest) = (Vec::with_capacity(text.len() + 64), formatted);
        for &elision in &self.elisions {
            let [before, after] = elision.around_placeholder(self.has_semicolons);
            let (kept, placeholder) = strings::split_once(rest, PLACEHOLDER.as_bytes())?;
            let kept = kept.strip_suffix(before)?;
            let lines = kept.strip_suffix(elision.indentation(text))?;
            require(lines.ends_with(b"\n") || out.len() + lines.len() == 0)?;
            out.extend_from_slice(kept);
            out.extend_from_slice(text.get(elision.start as usize..elision.end as usize)?);
            rest = placeholder.strip_prefix(after)?;
        }
        require(!strings::contains(rest, PLACEHOLDER.as_bytes()))?;
        out.extend_from_slice(rest);
        Some(out)
    }
}

/// False if `comment`, which is before the first token, may be an invalid `/// <reference />`.
fn is_known_pragma(comment: &Comment, src: &[u8]) -> bool {
    let text = (src.get(comment.start as usize..comment.end as usize)).unwrap_or_default();
    let Some(tag) =
        (text.strip_prefix(b"///")).and_then(|it| it.trim_ascii_start().strip_prefix(b"<"))
    else {
        return true;
    };
    let name = tag.get(.."reference".len()).unwrap_or_default();
    !name.eq_ignore_ascii_case(b"reference")
        || [
            &b"reference types=\""[..],
            b"reference path=\"",
            b"reference lib=\"",
        ]
        .iter()
        .find_map(|it| tag.strip_prefix(*it)?.strip_suffix(b"\" />"))
        .is_some_and(|value| !strings::contains_char(value, b'"'))
}

/// Returns true if all of the file is formatted.
fn check_file<'a>(
    parser: &mut Parser<'a>,
    f: &mut Formatter<'a>,
    flags: (bool, bool, bool),
    how: Imports,
    scratch: &mut Scratch,
) -> Option<bool> {
    let src = parser.lx.src;
    let printer_options = PrinterOptions {
        line_ending: LineEnding::Lf,
        ..PrinterOptions::new(f.options(), src)
    };
    let mut list = List::new(src, 0, src.len() as u32 - 1, 0, printer_options)?;
    if src.starts_with(b"#!") {
        let end = strings::index_of_char_usize(src, b'\n')?;
        require(!src.get(end - 1)?.is_ascii_whitespace())?;
        list.at = end as u32;
        list.next_line(true)?;
    }
    let mut first_comments = (parser.lx.comments.iter()).take_while(|it| it.start < parser.start());
    require(first_comments.all(|it| is_known_pragma(it, src)))?;
    scratch.elisions.clear();
    let (mut has_only_directives, mut counts) = (true, [0; 2]);
    require(parser.token() != T::Eof)?;
    let (sort, mut imports) = (
        f.options().sort_imports.clone(),
        UnchangedImports::default(),
    );
    let mut is_after_import = false;
    while parser.token() != T::Eof {
        let id = parser.top_level_statement(has_only_directives)?;
        parser.lx.find_long_lines();
        let (tree, comments) = (&parser.tree, &parser.lx.comments[..]);
        has_only_directives &= tree.kind(id) == K::Directive;
        scratch.holes.clear();
        let buffers = (&mut scratch.holes, &mut scratch.cache, &mut scratch.follow);
        let mut checker = Checker {
            emitter: Emitter::new(f, tree, comments, buffers, flags),
            long_lines: &parser.lx.long_lines,
            next_comment: list.next_comment,
            printer_options,
            printer: &mut scratch.printer,
            printed: &mut scratch.printed,
            elisions: &mut scratch.elisions,
            counts,
        };
        let (gap, failures) = (list.at, counts[0]);
        checker.item(
            &mut list,
            id,
            (parser.token() != T::Eof).then(|| parser.start()),
        );
        if let Some(sort) = sort.as_deref() {
            let node = tree.node(id);
            let is_import = node.kind == K::Import
                || (node.kind == K::Empty
                    && strings::contains(
                        src.get(node.start as usize..node.end as usize)?,
                        b"import",
                    ));
            match (how, is_import) {
                (Imports::Kept, true) => {
                    checker.elisions.clear();
                    (list.is_formatted, list.is_eliding) = (false, false);
                }
                (Imports::Kept, false) => {
                    // What's between the imports ends up before it, and may lack a semicolon.
                    require(
                        !is_after_import || src.get(node.start as usize)?.is_ascii_alphabetic(),
                    )?;
                    if let Some(first) = checker.elisions.first_mut()
                        && is_after_import
                    {
                        first.start = first.start.max(node.start);
                    }
                }
                (Imports::Checked, _) => {
                    // Imports are left out of the reduced text together or not at all.
                    scratch.are_imports_unsettled = true;
                    if is_import {
                        require(checker.counts[0] == failures && list.is_at_line_start)?;
                        add_import(&mut imports, &checker.emitter, gap, node)?;
                    } else {
                        require(imports.finish(sort))?;
                    }
                    scratch.are_imports_unsettled = false;
                }
            }
            is_after_import = is_import;
        }
        require(!checker.has_failed_too_often())?;
        counts = checker.counts;
    }
    scratch.are_imports_unsettled = sort.is_some_and(|it| !imports.finish(&it));
    require(!scratch.are_imports_unsettled)?;
    require(!has_only_directives || parser.lx.comments.is_empty())?;
    require(!parser.has_duplicate_exports())?;
    Some(list.is_formatted)
}

/// `import` is formatted, and so are the comments from `gap` on, which is at the start of a line.
fn add_import<'a>(
    imports: &mut UnchangedImports<'a>,
    e: &Emitter<'a, '_>,
    gap: u32,
    import: &Node,
) -> Option<()> {
    if !imports.is_empty() {
        let is_after_empty_line = |at: u32| {
            e.src
                .get(..at as usize)
                .is_some_and(|it| it.ends_with(b"\n\n"))
        };
        for comment in e.comments_between(gap, import.start) {
            if is_after_empty_line(comment.start) {
                imports.empty_line();
            }
            imports.comment();
        }
        if is_after_empty_line(import.start) {
            imports.empty_line();
        }
    }
    let source = e.tree.node(import.d);
    imports.import(PrintedImport {
        source: e.src.get(source.start as usize..source.end as usize)?,
        is_side_effect: import.op == T::Str,
        is_type_only: import.has(flag::TYPE_ONLY),
        has_default: import.a != NONE,
        has_namespace: import.b != NONE,
        has_named: e.tree.node(import.c).len > 0,
    });
    Some(())
}

#[inline]
fn require(condition: bool) -> Option<()> {
    condition.then_some(())
}

/// The printer's `measured_group_fits` after a statement.
#[derive(Copy, Clone)]
enum Measured {
    Yes,
    AsBefore,
    Maybe,
}

/// The state of checking a list of statements.
struct List<'a> {
    src: &'a [u8],
    indentation: &'a [u8],
    flavor: Flavor,
    at: u32,
    end: u32,
    /// The index of the first comment that doesn't start before `at`.
    next_comment: usize,
    is_at_line_start: bool,
    is_formatted: bool,
    measured: Measured,
    /// The last elision ends in this list, and the next statement can be added to it.
    is_eliding: bool,
    /// For the statements since the start of that elision.
    is_measured_in_elision: bool,
}

impl<'a> List<'a> {
    /// `None` if `start` isn't at the start of a line.
    fn new(
        src: &'a [u8],
        start: u32,
        end: u32,
        next_comment: usize,
        options: PrinterOptions,
    ) -> Option<Self> {
        let before = src.get(..start as usize)?;
        let blank = if options.indent_style.is_tab() {
            b'\t'
        } else {
            b' '
        };
        let len = before.iter().rev().take_while(|&&b| b == blank).count();
        let (lines, indentation) = before.split_at(before.len() - len);
        require(matches!(lines.last(), None | Some(b'\n')))?;
        Some(List {
            src,
            indentation,
            flavor: options.flavor,
            at: start,
            end,
            next_comment,
            is_at_line_start: true,
            is_formatted: true,
            measured: Measured::AsBefore,
            is_eliding: false,
            is_measured_in_elision: false,
        })
    }

    #[inline]
    fn next_line(&mut self, allows_empty_line: bool) -> Option<()> {
        let rest = self.src.get(self.at as usize..)?;
        let rest = match rest {
            [b'\n', b'\n', rest @ ..] if allows_empty_line => rest,
            [b'\n', rest @ ..] => rest,
            _ => return None,
        };
        let rest = rest.strip_prefix(self.indentation)?;
        self.at = (self.src.len() - rest.len()) as u32;
        Some(())
    }

    fn comment(&mut self, comment: &Comment) -> Option<()> {
        require(comment.start == self.at)?;
        require(is_comment_settled(
            comment,
            self.src,
            self.indentation,
            self.flavor,
        ))?;
        self.at = comment.end;
        self.next_comment += 1;
        Some(())
    }

    #[inline]
    fn up_to_statement(&mut self, start: u32, comments: &[Comment]) -> Option<()> {
        while self.at != start {
            let comment = comments.get(self.next_comment)?;
            self.comment(comment)?;
            self.next_line(true)?;
            // It may be a type cast, or name the language of a template.
            require(comment.is_line || !matches!(self.src.get(start as usize), Some(b'(' | b'`')))?;
        }
        Some(())
    }

    #[inline]
    fn after_statement(&mut self, end: u32, is_last: bool, comments: &[Comment]) -> Option<()> {
        self.at = end;
        while comments
            .get(self.next_comment)
            .is_some_and(|it| it.start < end)
        {
            self.next_comment += 1;
        }
        if end == self.end {
            return require(matches!(
                self.src.get(end as usize..)?,
                [b'\n', ..] | [b' ', b'/', b'/', ..]
            ));
        }
        if self.src.get(end as usize) == Some(&b' ') {
            self.at += 1;
            self.comment(comments.get(self.next_comment).filter(|it| it.is_line)?)?;
        }
        if !is_last {
            return self.next_line(true);
        }
        while self.at != self.end {
            self.next_line(true)?;
            self.comment(comments.get(self.next_comment)?)?;
        }
        Some(())
    }

    fn only_comments(&mut self, comments: &[Comment]) -> Option<()> {
        loop {
            self.comment(comments.get(self.next_comment)?)?;
            if self.at == self.end {
                return Some(());
            }
            self.next_line(false)?;
        }
    }
}

struct Checker<'a, 't> {
    emitter: Emitter<'a, 't>,
    /// Without those that end before the current statement.
    long_lines: &'t [(u32, u32)],
    /// The comments before this index start before the current list.
    next_comment: usize,
    printer_options: PrinterOptions,
    printer: &'t mut PrinterBuffers,
    printed: &'t mut Vec<u8>,
    elisions: &'t mut Vec<Elision>,
    /// The number of statements that don't match, and that do.
    counts: [u32; 2],
}

impl<'a> Checker<'a, '_> {
    /// The file doesn't seem to be formatted.
    fn has_failed_too_often(&self) -> bool {
        self.counts[0] > 4 + self.counts[1] / 2
    }

    /// `next` is the start of the next statement.
    fn item(&mut self, list: &mut List<'a>, id: Id, next: Option<u32>) {
        let (node, comments) = (self.emitter.tree.node(id), self.emitter.comments);
        let (first_elision, gap) = (self.elisions.len(), list.at);
        let starts_well =
            list.is_at_line_start && list.up_to_statement(node.start, comments).is_some();
        let measured = if starts_well {
            self.statement(id, list.indentation)
        } else {
            self.counts[0] += 1;
            let leading = self.emitter.comments_between(gap, node.start);
            if leading.iter().all(|it| is_inert(it, list.src, list.flavor)) {
                self.lists_in(id);
            }
            None
        };
        // A comment after an empty statement trails this one.
        list.next_comment = list.next_comment.max(self.next_comment);
        let ends_well = list
            .after_statement(node.end, next.is_none(), comments)
            .is_some()
            && next.is_none_or(|it| list.src.get(it as usize) != Some(&b';'));
        list.is_at_line_start = ends_well;
        if !ends_well {
            list.at = node.end;
        }
        let Some(measured) = measured.filter(|_| ends_well) else {
            (list.is_formatted, list.is_eliding) = (false, false);
            return;
        };
        if !matches!(measured, Measured::AsBefore) {
            list.measured = measured;
        }
        self.elisions.truncate(first_elision);
        if node.kind == K::Directive {
            return;
        }
        let was_measured = list.is_eliding && list.is_measured_in_elision;
        list.is_measured_in_elision = match measured {
            Measured::Yes => true,
            Measured::AsBefore => was_measured,
            Measured::Maybe => false,
        };
        let can_end_here = list.is_measured_in_elision || list.indentation.is_empty();
        let has_module_syntax = list.indentation.is_empty()
            && matches!(
                match node.kind {
                    K::Decorated => self.emitter.tree.kind(node.b),
                    kind => kind,
                },
                K::Import | K::Export | K::ExportAll | K::ExportDefault | K::ExportNamed
            );
        match self.elisions.last_mut() {
            Some(last) if list.is_eliding => {
                if can_end_here {
                    let next = list
                        .next_comment
                        .checked_sub(1)
                        .and_then(|it| comments.get(it));
                    last.has_comments |= next.is_some_and(|it| it.start > last.start);
                    last.has_module_syntax |= has_module_syntax;
                    last.end = node.end;
                }
            }
            _ if can_end_here => {
                list.is_eliding = true;
                self.elisions.push(Elision {
                    start: gap,
                    end: node.end,
                    has_comments: gap < node.start || node.has(flag::COMMENT),
                    has_module_syntax,
                });
            }
            _ => {}
        }
    }

    /// `None` if it isn't known to be formatted.
    fn statement(&mut self, id: Id, indentation: &'a [u8]) -> Option<Measured> {
        let node = self.emitter.tree.node(id);
        if node.kind == K::Import && node.parent != NONE {
            require(self.emitter.f.options().sort_imports.is_none())?;
        }
        while let [(_, end), rest @ ..] = self.long_lines
            && *end <= node.start
        {
            self.long_lines = rest;
        }
        let long_lines = self.long_lines;
        if long_lines.first().is_none_or(|it| it.0 >= node.end)
            && !node.has(flag::MULTILINE | flag::COMMENT | flag::UNSURE)
            && let Some(has_group) = self.emitter.compare_statement(id)
        {
            self.counts[1] += 1;
            return Some(if has_group {
                Measured::Yes
            } else {
                Measured::AsBefore
            });
        }
        let first_hole = self.emitter.holes.len();
        self.emitter.long_lines = long_lines;
        let Some((outcome, has_group)) = self.without_holes(id, indentation) else {
            self.counts[0] += 1;
            self.emitter.holes.truncate(first_hole);
            let inner = self.emitter.comments_between(node.start, node.end);
            if inner
                .iter()
                .all(|it| is_inert(it, self.emitter.src, self.printer_options.flavor))
            {
                self.lists_in(id);
            }
            return None;
        };
        self.counts[1] += 1;
        let holes = first_hole..self.emitter.holes.len();
        let (mut is_formatted, mut is_measured_in_holes) = (true, true);
        for index in holes.clone() {
            match self.hole(*self.emitter.holes.get(index)?) {
                None => is_formatted = false,
                Some(Measured::Yes) => {}
                Some(Measured::AsBefore) if !outcome.has_placeholder_after_flat_line_break => {}
                Some(_) => is_measured_in_holes = false,
            }
        }
        if !is_measured_in_holes {
            let holes = self.emitter.holes.get(holes)?;
            let is_after_hole = |&(_, end): &(u32, u32)| {
                holes.first().is_some_and(|it| it.end < end)
                    && !holes.iter().any(|it| it.start < end && end <= it.end)
            };
            let mut lines = long_lines.iter().take_while(|it| it.0 < node.end);
            is_formatted &= !lines.any(is_after_hole);
        }
        self.emitter.holes.truncate(first_hole);
        let is_measured = has_group && is_measured_in_holes && outcome.measured_group_fits;
        is_formatted.then_some(if is_measured {
            Measured::Yes
        } else {
            Measured::Maybe
        })
    }

    /// Also returns whether the statement has a group.
    fn without_holes(&mut self, id: Id, indentation: &[u8]) -> Option<(Outcome, bool)> {
        require(!self.emitter.tree.node(id).has(flag::UNSURE))?;
        let first_hole = self.emitter.holes.len();
        if let Some(has_group) = self.emitter.follow_statement(id, indentation) {
            self.emitter.has_given_up = false;
            let outcome = Outcome {
                measured_group_fits: true,
                ..Outcome::default()
            };
            return Some((outcome, has_group));
        }
        require(!self.emitter.has_given_up)?;
        if self
            .print_and_compare(id, indentation, first_hole)
            .is_none()
        {
            require(self.emitter.has_stand_ins && !self.emitter.has_given_up)?;
            self.emitter.exact = 1;
            let result = self.print_and_compare(id, indentation, first_hole);
            self.emitter.exact = 0;
            result?;
        }
        require(!self.printer.outcome.has_placeholder_in_try)?;
        Some((self.printer.outcome, self.emitter.has_group))
    }

    fn print_and_compare(&mut self, id: Id, indentation: &[u8], first_hole: usize) -> Option<()> {
        let e = &mut self.emitter;
        e.holes.truncate(first_hole);
        e.write_statement(id, indentation);
        require(!e.has_given_up)?;
        self.printed.clear();
        let (root, options) = (e.f.root(), self.printer_options);
        print(
            root,
            &e.f.storage,
            e.src,
            options,
            self.printer,
            self.printed,
        )
        .ok()?;
        if e.holes.len() > first_hole + 1 {
            let holes = e.holes.get_mut(first_hole..)?;
            if !holes.is_sorted_by(|a, b| a.start < b.start) {
                crate::sort::sort_by_key(holes, |it| it.start);
                let mut rest = e.holes.split_off(first_hole);
                rest.dedup_by_key(|it| it.start);
                e.holes.append(&mut rest);
            }
        }
        let node = e.tree.node(id);
        let mut at = node.start as usize - indentation.len();
        let mut printed = &self.printed[..];
        for hole in e.holes.get(first_hole..)? {
            let before = e.src.get(at..hole.start as usize)?;
            printed = printed
                .strip_prefix(before)?
                .strip_prefix(PLACEHOLDER.as_bytes())?;
            at = hole.end as usize;
        }
        require(printed == e.src.get(at..node.end as usize)?)
    }

    fn hole(&mut self, hole: Hole) -> Option<Measured> {
        let (src, tree, comments) = (self.emitter.src, self.emitter.tree, self.emitter.comments);
        let statements = tree.list(hole.owner);
        let options = self.printer_options;
        while (comments.get(self.next_comment)).is_some_and(|it| it.start < hole.start) {
            self.next_comment += 1;
        }
        let list = List::new(src, hole.start, hole.end, self.next_comment, options);
        let Some(mut list) = list else {
            statements.iter().for_each(|&it| self.lists_in(it));
            return None;
        };
        let Some(&last) = statements.last() else {
            return list.only_comments(comments).map(|()| Measured::AsBefore);
        };
        for (i, &id) in statements.iter().enumerate() {
            if self.has_failed_too_often() {
                return None;
            }
            self.item(
                &mut list,
                id,
                statements.get(i + 1).map(|&it| tree.node(it).start),
            );
        }
        require(tree.kind(last) != K::Directive || !tree.node(hole.owner).has(flag::COMMENT))?;
        list.is_formatted.then_some(list.measured)
    }

    /// Checks the lists of statements in `id`, which isn't known to be formatted itself.
    fn lists_in(&mut self, id: Id) {
        let tree = self.emitter.tree;
        let start = tree.node(id).start;
        let mut owners = smallvec::SmallVec::<[Id; 8]>::new();
        let mut skips_from = u32::MAX;
        // A node is added after the nodes in it.
        for inner in (1..=id).rev() {
            let node = tree.node(inner);
            if node.start < start {
                break;
            }
            if node.start >= skips_from {
                continue;
            }
            match node.kind {
                K::Block | K::Body | K::Case => {
                    skips_from = node.start;
                    if node.len > 0 {
                        owners.push(inner);
                    }
                }
                K::Template | K::Params | K::Extends | K::ModuleBlock | K::Decorators => {
                    skips_from = node.start
                }
                _ => {}
            }
        }
        for &owner in owners.iter().rev() {
            self.hole(self.emitter.hole_of(owner));
        }
    }
}
