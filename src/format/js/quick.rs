//! The door to the quick way for JavaScript and TypeScript, the crate `bun_format_quick`: text in, text out, with a
//! parser, a tree and a printer of its own. It is tried before anything is parsed. What it prints is what the long way
//! prints, and whatever it is not certain about it refuses: the caller then goes the long way, which prints the file or
//! says what is wrong with it.
//!
//! Here is what it is not asked about at all: the options and the kinds of text that it does not know.

use crate::options::*;
use crate::text::ends_with_ignore_ascii_case;
use bun_core::strings;
use bun_format_quick as quick;

/// The caller goes the long way.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct Refused;

/// The text to format, after `pragma::before_parsing`.
#[derive(Copy, Clone)]
pub struct Code<'c> {
    /// Its extension says whether it's TypeScript, and whether it can have JSX.
    pub path: &'c [u8],
    pub text: &'c [u8],
    /// The caller has found it to be Flow.
    pub is_flow: bool,
}

/// Why a text went the long way.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Reason {
    /// An option that the quick way doesn't know.
    Options,
    /// A parser or a kind of file that it doesn't know.
    Language,
    /// Code in Markdown in which a text may have a line break, or which may be nothing but JSX.
    InMarkdown,
    /// A comment may say that something stays as it is written.
    IgnoreComment,
    SyntaxError,
    /// Something rare that is left to the long way.
    Rare,
    /// A template that may be in another language.
    Guest,
    Stack,
    TooLong,
    Other,
}

impl Reason {
    pub const ALL: [Reason; 10] = [
        Reason::Options,
        Reason::Language,
        Reason::InMarkdown,
        Reason::IgnoreComment,
        Reason::SyntaxError,
        Reason::Rare,
        Reason::Guest,
        Reason::Stack,
        Reason::TooLong,
        Reason::Other,
    ];
}

/// How many texts, and how many bytes.
#[derive(Debug, Default, Copy, Clone)]
pub struct Count {
    pub texts: u64,
    pub bytes: u64,
}

impl Count {
    fn add(&mut self, text: &[u8]) {
        self.texts += 1;
        self.bytes += text.len() as u64;
    }

    pub fn merge(&mut self, other: Count) {
        self.texts += other.texts;
        self.bytes += other.bytes;
    }
}

/// What went which way. For measurements.
#[derive(Debug, Default, Copy, Clone)]
pub struct Counts {
    pub printed: Count,
    /// In the order of [`Reason::ALL`].
    pub refused: [Count; Reason::ALL.len()],
}

/// What lives from one text to the next.
#[derive(Default)]
pub struct Scratch {
    quick: Option<Box<quick::Quick>>,
    /// Kept only if somebody has asked for them.
    pub counts: Option<Box<Counts>>,
}

impl Scratch {
    #[cold]
    fn refuse(&mut self, reason: Reason, text: &[u8]) -> Refused {
        if let Some(counts) = &mut self.counts
            && let Some(count) = counts.refused.get_mut(reason as usize)
        {
            count.add(text);
        }
        Refused
    }
}

/// The options as the quick way takes them, or `None` if it isn't to be asked with these. Every field is named: a new
/// option doesn't compile until someone has said what it means here.
fn options_for(options: &FormatOptions, text: &[u8]) -> Option<quick::Options> {
    let FormatOptions {
        indent_style,
        indent_width,
        line_ending,
        line_width,
        quote_style,
        jsx_quote_style,
        quote_properties,
        trailing_commas,
        semicolons,
        arrow_parentheses,
        bracket_spacing,
        bracket_same_line,
        attribute_position,
        expand,
        experimental_operator_position,
        experimental_ternaries,
        embedded_language_formatting,
        // For what is in a template in another language, which is refused.
        prose_wrap: _,
        html_whitespace_sensitivity,
        vue_indent_script_and_style: _,
        svelte: _,
        embedded_html: _,
        // `language_of`
        filepath: _,
        parser: _,
        range_start,
        range_end,
        cursor_offset,
        insert_pragma,
        // `pragma::before_parsing` has looked at them.
        require_pragma: _,
        check_ignore_pragma: _,
        // `may_differ_in_markdown`
        is_in_markdown: _,
        is_mdx_jsx,
        is_mdx_es_syntax,
        html_template_depth,
        is_in_html_file,
        format_javascript: _,
        parse_javascript: _,
        parse_parts: _,
        in_html,
        flavor,
        sort_package_json: _,
        sort_imports,
        jsdoc,
        tailwind,
        toml: _,
        debug_comments,
        no_short_cuts,
    } = options;
    let is_known = !no_short_cuts
        && !experimental_ternaries
        && range_start.is_none()
        && range_end.is_none()
        && cursor_offset.is_none()
        && !insert_pragma
        && !is_mdx_jsx
        && !is_mdx_es_syntax
        && *html_template_depth == 0
        && !is_in_html_file
        && *in_html == InHtml::default()
        && !flavor.is_oxfmt()
        && sort_imports.is_none()
        && jsdoc.is_none()
        && tailwind.is_none()
        && *debug_comments == DebugComments::Off
        // Columns are sums and products of these.
        && indent_width.value() <= WIDEST_INDENT;
    is_known.then(|| quick::Options {
        print_width: i32::try_from(line_width.value()).unwrap_or(i32::MAX),
        tab_width: indent_width.value() as i32,
        use_tabs: indent_style.is_tab(),
        semi: semicolons.is_always(),
        single_quote: !quote_style.is_double(),
        jsx_single_quote: !jsx_quote_style.is_double(),
        quote_props: match quote_properties {
            QuoteProperties::AsNeeded => quick::QuoteProps::AsNeeded,
            QuoteProperties::Consistent => quick::QuoteProps::Consistent,
            QuoteProperties::Preserve => quick::QuoteProps::Preserve,
        },
        trailing_comma: match trailing_commas {
            TrailingCommas::All => quick::TrailingComma::All,
            TrailingCommas::Es5 => quick::TrailingComma::Es5,
            TrailingCommas::None => quick::TrailingComma::None,
        },
        bracket_spacing: bracket_spacing.value(),
        object_wrap_preserve: *expand == Expand::Auto,
        bracket_same_line: bracket_same_line.value(),
        arrow_parens_always: !arrow_parentheses.is_as_needed(),
        end_of_line: match line_ending.resolve(text) {
            LineEnding::Lf | LineEnding::Auto => quick::EndOfLine::Lf,
            LineEnding::Crlf => quick::EndOfLine::Crlf,
            LineEnding::Cr => quick::EndOfLine::Cr,
        },
        single_attribute_per_line: *attribute_position == AttributePosition::Multiline,
        operator_position_start: !experimental_operator_position.is_end(),
        embedded_language_formatting_auto: *embedded_language_formatting
            == EmbeddedLanguageFormatting::Auto,
        html_whitespace_sensitivity_ignore: *html_whitespace_sensitivity
            == HtmlWhitespaceSensitivity::Ignore,
        no_short_cuts: false,
    })
}

const WIDEST_INDENT: u32 = 1 << 14;

fn is_typescript(path: &[u8]) -> bool {
    [&b".ts"[..], b".tsx", b".mts", b".cts"]
        .iter()
        .any(|end| ends_with_ignore_ascii_case(path, end))
}

/// Which parser of Prettier reads the text, if the quick way has it.
fn language_of(code: &Code<'_>, options: &FormatOptions) -> Option<quick::Language> {
    // The name says one thing to the parser and another to the printer. A text without a name has the name "".
    if (options.filepath.as_deref()).is_some_and(|name| name != code.path) {
        return None;
    }
    let is_typescript = is_typescript(code.path);
    let is_known = match options.parser.as_deref() {
        None => true,
        Some(b"babel" | b"flow" | b"babel-flow") => !is_typescript,
        Some(b"typescript") => is_typescript,
        Some(_) => false,
    };
    if !is_known || (is_typescript && code.is_flow) {
        return None;
    }
    Some(match (is_typescript, code.is_flow) {
        (true, _) => quick::Language::TypeScript,
        (false, false) => quick::Language::JavaScript,
        (false, true) if crate::flow::is_parsed_by_babel_flow(options, code.path) => {
            quick::Language::BabelFlow
        }
        (false, true) => quick::Language::Flow,
    })
}

/// See `FormatOptions::is_in_markdown`: true if a text in `code` may have a line break in it (a template, a comment, a
/// string), or if `code` may be nothing but JSX.
fn may_differ_in_markdown(code: &Code<'_>) -> bool {
    let text = code.text;
    let can_have_jsx = ![&b".ts"[..], b".mts", b".cts"]
        .iter()
        .any(|end| ends_with_ignore_ascii_case(code.path, end));
    strings::contains_char(text, b'`')
        || strings::contains_char(text, b'\\')
        || strings::contains(text, b"/*")
        || (can_have_jsx && strings::contains_char(text, b'<'))
}

/// Puts `code`, formatted, in the place of what `out` held. If it's refused, `out` is empty.
pub fn format(
    code: Code<'_>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), Refused> {
    let Some(quick_options) = options_for(options, code.text) else {
        return Err(scratch.refuse(Reason::Options, code.text));
    };
    let Some(language) = language_of(&code, options) else {
        return Err(scratch.refuse(Reason::Language, code.text));
    };
    if options.is_in_markdown && may_differ_in_markdown(&code) {
        return Err(scratch.refuse(Reason::InMarkdown, code.text));
    }
    // What is printed around code that stays as it is written (parentheses, semicolons, the comment itself) is where
    // the long way corrects Prettier most often.
    if strings::contains(code.text, b"prettier-ignore") {
        return Err(scratch.refuse(Reason::IgnoreComment, code.text));
    }
    let quick = scratch.quick.get_or_insert_default();
    let dialect = quick::Dialect::of_name(language, code.path);
    if quick::format(code.text, dialect, &quick_options, quick, out).is_err() {
        let reason = match quick.why() {
            1 => Reason::SyntaxError,
            5 => Reason::TooLong,
            6 => Reason::Stack,
            7 => Reason::Rare,
            8 => Reason::Guest,
            _ => Reason::Other,
        };
        return Err(scratch.refuse(reason, code.text));
    }
    if crate::is_too_long(out.len()) {
        out.clear();
        return Err(scratch.refuse(Reason::TooLong, code.text));
    }
    if let Some(counts) = &mut scratch.counts {
        counts.printed.add(code.text);
    }
    Ok(())
}
