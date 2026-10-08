//! HTML, Vue, Angular templates, Lightning Web Components and MJML.
//!
//! The specification is Prettier's `src/language-html`, which parses with `angular-html-parser`.
//!
//! ```text
//! text ─ lexer ─→ tokens ─ parser, parse ─→ Tree ─ preprocess ─→ what white space counts ─ printer ─→ the document of `ir`
//! ```
//!
//! What is in another language (scripts, style sheets, expressions in attributes) is written to the same document
//! by the formatter for that language: `embed`.

mod angular;
mod angular_print;
mod ast;
mod cursor;
mod data;
mod embed;
pub(crate) mod in_js;
mod js;
mod lexer;
mod map_strings;
mod parse;
mod parser;
mod preprocess;
mod printer;
mod tag;
mod utilities;
mod verify;
mod vue;
mod writer;

use crate::css::normalize_end_of_line;
use crate::cursor::Region;
use crate::ir::formatter::Formatter;
use crate::js::context::JsFormatContext;
use crate::options::{HtmlRoot, InHtml, JavaScriptParser};
use crate::range::{Offsets, normalized_len, write_with_line_ending};
use crate::text::{self, BOM, trim_end};
use crate::{FormatError, FormatOptions, front_matter};
use bun_core::strings;
use cursor::Cursor;
use std::borrow::Cow;

/// Prettier's `parser` option.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Parser {
    Html,
    Angular,
    Vue,
    Lwc,
    Mjml,
    /// `__ng_action`, `__ng_binding`, `__ng_directive`, `__ng_interpolation`: the text is an expression of Angular, with no
    /// HTML around it.
    AngularExpression(HtmlRoot),
}

impl Parser {
    pub fn from_name(name: &[u8]) -> Option<Parser> {
        Some(match name {
            b"html" => Parser::Html,
            b"angular" => Parser::Angular,
            b"vue" => Parser::Vue,
            b"lwc" => Parser::Lwc,
            b"mjml" => Parser::Mjml,
            b"__ng_action" => Parser::AngularExpression(HtmlRoot::NgAction),
            b"__ng_binding" => Parser::AngularExpression(HtmlRoot::NgBinding),
            b"__ng_directive" => Parser::AngularExpression(HtmlRoot::NgDirective),
            b"__ng_interpolation" => Parser::AngularExpression(HtmlRoot::NgInterpolation),
            _ => return None,
        })
    }
}

/// The parser that Prettier infers from the name of a file. `None` if it is none of these languages.
pub fn parser_for_path(path: &[u8]) -> Option<Parser> {
    const EXTENSIONS: [(&[u8], Parser); 10] = [
        (b".component.html", Parser::Angular),
        (b".html", Parser::Html),
        (b".hta", Parser::Html),
        (b".htm", Parser::Html),
        (b".html.hl", Parser::Html),
        (b".inc", Parser::Html),
        (b".xht", Parser::Html),
        (b".xhtml", Parser::Html),
        (b".mjml", Parser::Mjml),
        (b".vue", Parser::Vue),
    ];
    let lower = path.to_ascii_lowercase();
    EXTENSIONS
        .iter()
        .find(|(extension, _)| lower.ends_with(extension))
        .map(|(_, parser)| *parser)
}

/// Everything that is allocated to format a text and can be used again for the next one.
#[derive(Default)]
pub struct Scratch {
    document: crate::Scratch,
}

/// What the functions of Prettier get as `options`.
pub(crate) struct Options<'o> {
    pub(crate) parser: Parser,
    /// `originalText`, in which every line break is `\n`.
    pub(crate) original_text: &'o [u8],
    pub(crate) format: &'o FormatOptions,
    pub(crate) filepath: Option<&'o [u8]>,
    /// Whether there is a `parentParser`: the text is in a text in another language.
    pub(crate) has_parent_parser: bool,
}

/// `/^\s*<!--\s*@(?:a|b)\s*-->/.test(text)`
fn has_pragma(text: &[u8], pragmas: [&[u8]; 2]) -> bool {
    (|| {
        let rest =
            text::trim_start(text::trim_start(text).strip_prefix(b"<!--")?).strip_prefix(b"@")?;
        let rest = pragmas.iter().find_map(|pragma| {
            rest.strip_prefix(*pragma)
                .filter(|rest| text::trim_start(rest).starts_with(b"-->"))
        });
        rest.map(|_| ())
    })()
    .is_some()
}

/// What is parsed of `text`: it has blanks in the place of the front matter, so that all positions stay. And the length of
/// the front matter.
fn without_front_matter(text: &[u8]) -> (Cow<'_, [u8]>, Option<usize>) {
    let Some(len) = front_matter::parse(text).map(|it| it.end) else {
        return (Cow::Borrowed(text), None);
    };
    let mut blanked = text.to_vec();
    for byte in &mut blanked[..len] {
        if *byte != b'\n' {
            *byte = b' ';
        }
    }
    (Cow::Owned(blanked), Some(len))
}

/// What is formatted of `text`: without the byte order mark, with `\n` for every line break, and with the pragma that is
/// to be inserted. And whether only a part of it is to be formatted. `None`: because of a pragma, or because that part is
/// empty, it stays as it is.
fn prepared_text<'t>(text: &'t [u8], options: &FormatOptions) -> Option<(Cow<'t, [u8]>, bool)> {
    let first = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let Offsets { start, end, .. } = Offsets::new(text, first, options);
    let [start, end] =
        [start, end].map(|offset| normalized_len(text.get(first..offset).unwrap_or_default()));
    let text = normalize_end_of_line(&text[first..]);
    let has_format_pragma = (options.require_pragma || options.insert_pragma)
        && has_pragma(&text, [b"format", b"prettier"]);
    if (start >= end && !text.is_empty())
        || (options.require_pragma && !has_format_pragma)
        || (options.check_ignore_pragma && has_pragma(&text, [b"noformat", b"noprettier"]))
    {
        return None;
    }
    let is_range = start > 0 || end < text.len();
    Some(
        match !is_range && options.insert_pragma && !options.require_pragma && !has_format_pragma {
            true => (
                Cow::Owned([b"<!-- @format -->\n\n", &text[..]].concat()),
                false,
            ),
            false => (text, is_range),
        },
    )
}

/// Whether `after`, which `before` has been formatted to with `options`, has all that is in `before` and nothing else. See
/// `verify.rs`.
pub fn has_same_content(
    before: &[u8],
    after: &[u8],
    parser: Parser,
    options: &FormatOptions,
) -> bool {
    if matches!(parser, Parser::AngularExpression(_)) {
        return true;
    }
    let after = normalize_end_of_line(after.strip_prefix(BOM).unwrap_or(after));
    prepared_text(before, options).is_none_or(|(before, _)| {
        text::trim(&before).is_empty() || verify::has_same_content(&before, &after, parser)
    })
}

/// Whether `text`, in which every line break is `\n`, has no syntax error.
pub(crate) fn can_be_parsed(text: &[u8], parser: Parser) -> bool {
    let (content, front_matter_len) = without_front_matter(text);
    parse::parse(
        &content,
        front_matter_len,
        parser,
        &mut ast::Tree::default(),
    )
    .is_ok()
}

/// What is known once a document is written.
struct Written {
    /// The part of the text around the cursor that the document has marks around.
    region: Option<Region>,
    /// How many nodes are at the top level.
    top_level_count: usize,
}

/// Writes the document for `text`, in which every line break is `\n`. Returns how many nodes are at the top level.
///
/// `is_embedded`: the text is in a text in another language, and no line break is written at the end.
/// `indent_level`: how many `indent`s are around what is written, if that is known.
pub(crate) fn write_document(
    text: &[u8],
    parser: Parser,
    path: Option<&[u8]>,
    options: &FormatOptions,
    is_embedded: bool,
    indent_level: Option<u32>,
    f: &mut Formatter<'_>,
) -> Result<usize, FormatError> {
    write_document_with_cursor(
        text,
        parser,
        path,
        options,
        is_embedded,
        indent_level,
        None,
        f,
    )
    .map(|written| written.top_level_count)
}

/// The same. `cursor_offset`: where the cursor is in `text`.
#[allow(clippy::too_many_arguments)]
fn write_document_with_cursor(
    text: &[u8],
    parser: Parser,
    path: Option<&[u8]>,
    options: &FormatOptions,
    is_embedded: bool,
    indent_level: Option<u32>,
    cursor_offset: Option<u32>,
    f: &mut Formatter<'_>,
) -> Result<Written, FormatError> {
    let (content, front_matter_len) = without_front_matter(text);
    let mut tree = ast::Tree::default();
    parse::parse(&content, front_matter_len, parser, &mut tree).map_err(|error| match error {
        parse::ParseError::Syntax => FormatError::SyntaxError,
        parse::ParseError::NestedTooDeeply => FormatError::NestedTooDeeply,
    })?;
    let cursor = cursor_offset.map_or(Cursor::Nowhere, |offset| cursor::locate(&tree, offset));
    let options = Options {
        parser,
        original_text: text,
        format: options,
        filepath: path,
        has_parent_parser: is_embedded || options.is_in_markdown,
    };
    if !preprocess::preprocess(&mut tree, &options) {
        return Err(FormatError::NestedTooDeeply);
    }
    let mut printer = printer::Printer {
        tree: &tree,
        options: &options,
        out: writer::Writer::new(f, indent_level, !is_embedded),
        ancestors: 0,
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
        has_typescript_script: None,
        cursor,
    };
    printer.print_root(!is_embedded);
    let is_nested_too_deeply = printer.is_nested_too_deeply;
    printer.out.finish();
    match is_nested_too_deeply {
        true => Err(FormatError::NestedTooDeeply),
        false => Ok(Written {
            region: cursor.region(&tree),
            top_level_count: tree.children(tree.root).count(),
        }),
    }
}

/// Appends `text`, which is an expression of Angular, as it is formatted to `out`. No line break ends it.
///
/// The parsers of Prettier for that know of no pragma: it is as if the one that is asked for were there.
fn format_angular_expression(
    text: &[u8],
    root: HtmlRoot,
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    let start = out.len();
    let options = FormatOptions {
        line_ending: options.line_ending.resolve(text),
        ..options.clone()
    };
    let text = match text.strip_prefix(BOM) {
        Some(rest) => {
            out.extend_from_slice(BOM);
            rest
        }
        None => text,
    };
    let text = normalize_end_of_line(text);
    if text::trim(&text).is_empty() {
        return Ok(());
    }
    let mut context = JsFormatContext::without_file(&text, options.clone(), &[]);
    context.parse_javascript = parse_javascript;
    let mut is_written = false;
    let document = crate::ir::run::write_with(context, &text, &mut scratch.document, |f| {
        let mut printer = printer::Printer {
            tree: &ast::Tree::default(),
            options: &Options {
                parser: Parser::Angular,
                original_text: &text,
                format: &options,
                filepath: None,
                has_parent_parser: false,
            },
            out: writer::Writer::new(f, Some(0), true),
            ancestors: 0,
            stack_check: bun_core::StackCheck::init(),
            is_nested_too_deeply: false,
            has_typescript_script: None,
            cursor: Cursor::Nowhere,
        };
        let in_html = InHtml {
            root,
            ..InHtml::default()
        };
        is_written = printer.write_angular_expression(&text, in_html, js::Hug::Bare);
        printer.out.finish();
    });
    document
        .and_then(|document| match is_written {
            true => crate::ir::run::print(document, &text, &options, &mut scratch.document, out),
            false => Err(FormatError::SyntaxError),
        })
        .inspect_err(|_| out.truncate(start))
}

/// Appends the formatted `text` to `out`. `path`: the name of the file.
pub fn format(
    path: &[u8],
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), FormatError> {
    format_with_cursor(path, text, parser, options, scratch, out).map(|_| ())
}

/// The same. Returns where the cursor, which is at `options.cursor_offset` in `text`, is in what is appended, in UTF-16 code
/// units like the option.
pub fn format_with_cursor(
    path: &[u8],
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<Option<u32>, FormatError> {
    format_with(path, text, parser, options, None, scratch, out)
}

/// The same. `parse_javascript`: in the place of `options.parse_javascript`.
pub fn format_with(
    path: &[u8],
    text: &[u8],
    parser: Parser,
    options: &FormatOptions,
    parse_javascript: Option<JavaScriptParser<'_>>,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<Option<u32>, FormatError> {
    if let Parser::AngularExpression(root) = parser {
        return format_angular_expression(text, root, options, parse_javascript, scratch, out)
            .map(|()| None);
    }
    let original = text;
    let has_bom = text.starts_with(BOM);
    let Some((text, is_range)) = prepared_text(text, options) else {
        out.extend_from_slice(original);
        return Ok(options.cursor_offset);
    };
    if has_bom {
        out.extend_from_slice(BOM);
    }
    if text::trim(&text).is_empty() {
        return Ok(None);
    }
    // Prettier's `isSourceElement`: nothing can be formatted on its own, except that in Vue everything can. It does not
    // find what is in the root, so that is all of the text.
    if is_range && parser != Parser::Vue {
        if !can_be_parsed(&text, parser) {
            out.truncate(out.len() - if has_bom { BOM.len() } else { 0 });
            return Err(FormatError::SyntaxError);
        }
        let from = out.len();
        write_with_line_ending(&text, options.line_ending.resolve(original).as_bytes(), out);
        return Ok(
            crate::cursor::cursor_in_formatted_text(&text, options, &out[from..])
                .map(|cursor| cursor + u32::from(has_bom)),
        );
    }
    // In `text`, which has one byte for every line break and no byte order mark.
    let cursor_offset = crate::cursor::cursor_offset_in_bytes(original, options).map(|offset| {
        let before = original.get(..offset as usize).unwrap_or(original);
        offset.saturating_sub(
            strings::count(before, b"\r\n") as u32 + if has_bom { BOM.len() as u32 } else { 0 },
        )
    });
    let start = out.len() - if has_bom { BOM.len() } else { 0 };
    let options = FormatOptions {
        line_ending: options.line_ending.resolve(original),
        is_in_html_file: path.ends_with(b".html") || path.ends_with(b".htm"),
        ..options.clone()
    };
    let path = Some(path).filter(|path| !path.is_empty());
    let mut result = Ok(None);
    let mut context = JsFormatContext::without_file(&text, options.clone(), &[]);
    context.parse_javascript = parse_javascript;
    let root = crate::ir::run::write_with(context, &text, &mut scratch.document, |f| {
        result = write_document_with_cursor(
            &text,
            parser,
            path,
            &options,
            false,
            Some(0),
            cursor_offset,
            f,
        )
        .map(|written| written.region);
    });
    let printed_from = out.len();
    let region = result
        .and_then(|region| root.map(|root| (region, root)))
        .and_then(|(region, root)| {
            crate::ir::run::print(root, &text, &options, &mut scratch.document, out)
                .map(|()| region)
        })
        .inspect_err(|_| out.truncate(start))?;
    // `formatRange` leaves out the line break at the end.
    if is_range {
        out.truncate(printed_from + trim_end(&out[printed_from..]).len());
    }
    let (Some(offset), Some(region)) = (cursor_offset, region) else {
        return Ok(None);
    };
    let printed = out.get(printed_from..).unwrap_or_default();
    // Without a node on one side, the part goes to that end of the document.
    let [first, second] = scratch.document.marks();
    let marks = match region {
        Region::Between {
            before: None,
            after: Some(_),
        } => Some(0).zip(second),
        Region::Between {
            before: Some(_),
            after: None,
        } => first.zip(Some(printed.len() as u32)),
        _ => first.zip(second),
    };
    Ok(Some(
        crate::cursor::cursor_in_region(&text, offset, region, printed, marks) + u32::from(has_bom),
    ))
}
