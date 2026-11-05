//! The door to the quick way for JavaScript and TypeScript, the crate `bun_format_quick`: text in, text out, with a
//! parser, a tree and a printer of its own. It is tried before anything is parsed. What it prints is what the long way
//! prints, and whatever it is not certain about it refuses: the caller then goes the long way, which prints the file or
//! says what is wrong with it.
//!
//! Here is what it is not asked about at all: the options and the kinds of text that it does not know.

use super::quick_guests::QuickGuests;
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
    /// Code in HTML that the long way reads in another way than a file.
    InHtml,
    /// A comment may say that something stays as it is written.
    IgnoreComment,
    SyntaxError,
    /// Something rare that is left to the long way.
    Rare,
    /// A template that may be in another language.
    Guest,
    Stack,
    TooLong,
    /// Something was written or read beyond a buffer: a mistake in the quick way that it has noticed.
    Lost,
    Other,
}

impl Reason {
    pub const ALL: [Reason; 11] = [
        Reason::Options,
        Reason::Language,
        Reason::InHtml,
        Reason::IgnoreComment,
        Reason::SyntaxError,
        Reason::Rare,
        Reason::Guest,
        Reason::Stack,
        Reason::TooLong,
        Reason::Lost,
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
    /// [`Reason::Rare`] by the number that the quick way gives the rare thing. The last one is for all higher numbers.
    pub rare: [Count; 16],
}

/// What lives from one text to the next.
pub struct Scratch {
    quick: Option<Box<quick::Quick>>,
    /// See `block_stands`.
    credit: i32,
    /// Kept only if somebody has asked for them.
    pub counts: Option<Box<Counts>>,
}

impl Default for Scratch {
    fn default() -> Scratch {
        Scratch {
            quick: None,
            credit: 8,
            counts: None,
        }
    }
}

impl Scratch {
    /// Forgets what is known from the texts that have been formatted, as at the start of a run.
    pub fn forget_other_files(&mut self) {
        self.credit = 8;
    }

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
/// option doesn't compile until someone has said what it means here. With `is_host`, the options are those of a text of
/// HTML, for the scripts in it.
fn options_for(options: &FormatOptions, text: &[u8], is_host: bool) -> Option<quick::Options> {
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
        // For what is in a template in another language: `QuickGuests`.
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
        // `format`
        is_in_markdown: _,
        is_at_margin: _,
        // `format`
        is_mdx_jsx: _,
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
        // A pragma goes to the top of the host. Where the doctype of HTML in a template is asked about, the host isn't.
        && (is_host || (!insert_pragma && !is_in_html_file))
        && *html_template_depth == 0
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
        is_in_markdown: false,
        is_mdx_es_syntax: *is_mdx_es_syntax,
        marks_line_breaks_in_texts: false,
        indentation: 0,
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

/// True if `code` may be nothing but JSX. See `FormatOptions::is_in_markdown`.
fn may_be_jsx(code: &Code<'_>) -> bool {
    let can_have_jsx = ![&b".ts"[..], b".mts", b".cts"]
        .iter()
        .any(|end| ends_with_ignore_ascii_case(code.path, end));
    can_have_jsx && strings::contains_char(code.text, b'<')
}

/// Puts `code`, formatted, in the place of what `out` held. If it's refused, `out` is empty.
pub fn format(
    code: Code<'_>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), Refused> {
    let Some(mut quick_options) = options_for(options, code.text, false) else {
        return Err(scratch.refuse(Reason::Options, code.text));
    };
    let Some(language) = language_of(&code, options) else {
        return Err(scratch.refuse(Reason::Language, code.text));
    };
    if options.is_in_markdown {
        quick_options.is_in_markdown = may_be_jsx(&code);
        quick_options.marks_line_breaks_in_texts = !options.is_at_margin;
    }
    if options.is_mdx_jsx {
        return format_mdx_jsx(code.text, &quick_options, scratch, out);
    }
    let mut dialect = quick::Dialect::of_name(language, code.path);
    // In a declaration file, too, `await` is a name outside of async functions.
    dialect.common_js |= [&b".d.ts"[..], b".d.mts"]
        .iter()
        .any(|end| ends_with_ignore_ascii_case(code.path, end));
    let file = Some((options, code.path));
    format_as(code.text, dialect, &quick_options, file, scratch, out)
}

/// See `FormatOptions::is_mdx_jsx`. There's no line break at the end.
fn format_mdx_jsx(
    text: &[u8],
    quick_options: &quick::Options,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), Refused> {
    // What is white space, and how wide a character is that is none of ASCII's, is where the long way corrects Prettier.
    let is_plain = |byte: &u8| matches!(byte, b' '..=b'~' | b'\n' | b'\t');
    if !text.iter().all(is_plain) {
        return Err(scratch.refuse(Reason::Rare, text));
    }
    let how = quick::Expression {
        text,
        is_typescript: false,
        has_vue_filters: false,
        is_mdx_jsx: true,
        wrap: quick::Wrap::Bare,
        before: b"",
        after: b"",
    };
    let quick = scratch.quick.get_or_insert_default();
    let guests = quick.lend_guests(None);
    let done = quick::format_expression(&how, quick_options, quick, out);
    quick.lend_guests(guests);
    if done.is_err() {
        let reason = match quick.why() {
            1 => Reason::SyntaxError,
            8 => Reason::Guest,
            _ => Reason::Rare,
        };
        return Err(scratch.refuse(reason, text));
    }
    if let Some(counts) = &mut scratch.counts {
        counts.printed.add(text);
    }
    Ok(())
}

/// All that is in a `<script>` of HTML or Vue.
#[derive(Copy, Clone)]
pub(crate) struct Script<'c> {
    pub(crate) text: &'c [u8],
    /// The name of the file that it is in: Prettier's `filepath`.
    pub(crate) name: &'c [u8],
    pub(crate) is_typescript: bool,
    /// It's known to be no module.
    pub(crate) is_no_module: bool,
    /// By how many levels the host indents it.
    pub(crate) indentation: u32,
}

/// The same for a script in a text of HTML with `options`, which is printed between two forced line breaks. The lines of
/// the result are indented, but for the first.
pub(crate) fn format_script(
    script: Script<'_>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), Refused> {
    let text = script.text;
    let Some(of_host) = options_for(options, b"", true) else {
        return Err(scratch.refuse(Reason::Options, text));
    };
    let name = script.name;
    // In a host nothing is Flow, `<!--` can start a comment, and a byte order mark is white space. What only a module
    // has is an error elsewhere.
    if strings::contains_char(text, b'\r')
        || text.starts_with(b"\xEF\xBB\xBF")
        || strings::contains(text, b"<!--")
        || strings::contains(text, b"-->")
        || bun_lint::linter::is_flow_file(text, name)
        || (script.is_no_module
            && (strings::contains(text, b"import") || strings::contains(text, b"export")))
    {
        return Err(scratch.refuse(Reason::InHtml, text));
    }
    let quick_options = quick::Options {
        end_of_line: quick::EndOfLine::Lf,
        indentation: i32::try_from(script.indentation).unwrap_or(i32::MAX),
        ..of_host
    };
    let dialect = quick::Dialect {
        language: match script.is_typescript {
            true => quick::Language::TypeScript,
            false => quick::Language::JavaScript,
        },
        // The name of the host doesn't say whether TypeScript has JSX.
        jsx: (!script.is_typescript).then_some(true),
        common_js: script.is_no_module,
        module_only: false,
        declaration_file: false,
        name_ends_in_ts: name.ends_with(b".ts"),
        name_ends_in_js_flow: false,
    };
    format_as(text, dialect, &quick_options, None, scratch, out)
}

/// True if [`format`] leaves a code block of Markdown with `options` as it is written: `text`, without the line break at
/// its end, in the file at `path`, at the left margin. No is always a valid answer.
pub(crate) fn block_stands(
    path: &[u8],
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
) -> bool {
    // Where the code has never been formatted, or the options ask for another layout than it has, the answer is no
    // again and again, and to ask isn't free. So after some of them in a row, most blocks aren't asked about.
    if scratch.credit <= 0 {
        scratch.credit -= 1;
        if scratch.credit > -16 {
            return false;
        }
        scratch.credit = 2;
    }
    let stands = match options_for(options, b"", true) {
        Some(of_host) if !strings::contains(text, b"prettier-ignore") => {
            let quick_options = quick::Options {
                end_of_line: quick::EndOfLine::Lf,
                ..of_host
            };
            let language = match is_typescript(path) {
                true => quick::Language::TypeScript,
                false => quick::Language::JavaScript,
            };
            let dialect = quick::Dialect::of_name(language, path);
            let quick = scratch.quick.get_or_insert_default();
            quick::stands(text, dialect, &quick_options, quick)
        }
        _ => false,
    };
    match stands {
        true => scratch.credit = (scratch.credit + 2).min(16),
        false => scratch.credit -= 1,
    }
    stands
}

/// An expression of Vue.
#[derive(Copy, Clone)]
pub(crate) struct Expression<'c> {
    pub(crate) text: &'c [u8],
    pub(crate) is_typescript: bool,
    /// `__vue_expression`: `a | b` is a filter.
    pub(crate) has_filters: bool,
    /// The name of the attribute whose value it is, `="`, and what the value has in front of the expression (`a in `).
    /// None of it can be broken. `None` for an expression between `{{` and `}}`.
    pub(crate) attribute: Option<&'c [u8]>,
    /// `formatAttributeValue()` isn't given `shouldHugJsExpression()`: the right side of `v-for`.
    pub(crate) hugs: bool,
    /// By how many levels the line is indented that it starts, together with the name of its attribute.
    pub(crate) indentation: u32,
}

/// Puts an expression in a text of HTML with `options`, formatted, in the place of what `out` held: all of the attribute,
/// or what is between the braces. It's what is printed if it starts a line and a line break follows.
pub(crate) fn format_expression(
    expression: Expression<'_>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), Refused> {
    let text = expression.text;
    let Some(of_host) = options_for(options, b"", true) else {
        return Err(scratch.refuse(Reason::Options, text));
    };
    // A comment, which the long way has rules of its own for. In an attribute: a quote that is written as an entity (no
    // other entity is decoded there), and a string whose quotes may have to change. Between braces: what may end with `}}`.
    // Which keys get quotes together with the others depends on the name of the parser.
    let is_plain = of_host.quote_props != quick::QuoteProps::Consistent
        && !strings::contains(text, b"//")
        && !strings::contains(text, b"/*")
        && !strings::contains_char(text, 0)
        && match expression.attribute {
            Some(_) => {
                strings::index_of_any(text, b"\"\\").is_none()
                    && !strings::contains(text, b"&quot;")
                    && !strings::contains(text, b"&apos;")
            }
            None => !strings::contains_char(text, b'{'),
        };
    if !is_plain {
        return Err(scratch.refuse(Reason::InHtml, text));
    }
    if !strings::is_valid_utf8(text) {
        return Err(scratch.refuse(Reason::Rare, text));
    }
    let quick_options = quick::Options {
        end_of_line: quick::EndOfLine::Lf,
        indentation: i32::try_from(expression.indentation).unwrap_or(i32::MAX),
        single_quote: expression.attribute.is_some() || of_host.single_quote,
        ..of_host
    };
    let how = quick::Expression {
        text,
        is_typescript: expression.is_typescript,
        has_vue_filters: expression.has_filters,
        is_mdx_jsx: false,
        wrap: match expression.attribute {
            Some(_) if expression.hugs => quick::Wrap::Group,
            Some(_) => quick::Wrap::ByKind,
            None => quick::Wrap::Bare,
        },
        before: expression.attribute.unwrap_or_default(),
        after: match expression.attribute {
            Some(_) => b"\"",
            None => b"",
        },
    };
    let quick = scratch.quick.get_or_insert_default();
    quick.lend_guests(None);
    if quick::format_expression(&how, &quick_options, quick, out).is_err() {
        let reason = match quick.why() {
            1 => Reason::SyntaxError,
            8 => Reason::Guest,
            _ => Reason::Rare,
        };
        return Err(scratch.refuse(reason, text));
    }
    if let Some(counts) = &mut scratch.counts {
        counts.printed.add(text);
    }
    Ok(())
}

/// `file`: the options and the name for what is in a template in another language.
fn format_as(
    text: &[u8],
    dialect: quick::Dialect,
    quick_options: &quick::Options,
    file: Option<(&FormatOptions, &[u8])>,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<(), Refused> {
    let code = Code {
        path: b"",
        text,
        is_flow: false,
    };
    // What is printed around code that stays as it is written (parentheses, semicolons, the comment itself) is where
    // the long way corrects Prettier most often.
    if strings::contains(code.text, b"prettier-ignore") {
        return Err(scratch.refuse(Reason::IgnoreComment, code.text));
    }
    let quick = scratch.quick.get_or_insert_default();
    match file {
        Some((options, path)) => {
            if quick.guests_mut().is_none() {
                quick.lend_guests(Some(Box::<QuickGuests>::default()));
            }
            if quick_options.embedded_language_formatting_auto
                && let Some(guests) = quick.guests_mut()
                && let Some(guests) =
                    (guests as &mut dyn std::any::Any).downcast_mut::<QuickGuests>()
            {
                guests.start_file(options, path);
            }
        }
        // Without them, a template that may be in another language is refused.
        None => _ = quick.lend_guests(None),
    }
    if quick::format(code.text, dialect, quick_options, quick, out).is_err() {
        let reason = match quick.why() {
            1 => Reason::SyntaxError,
            5 => Reason::TooLong,
            6 => Reason::Stack,
            7 => Reason::Rare,
            8 => Reason::Guest,
            9 => Reason::Lost,
            _ => Reason::Other,
        };
        let which = usize::try_from(quick.which_rare()).unwrap_or(0);
        if reason == Reason::Rare
            && let Some(counts) = &mut scratch.counts
        {
            let last = counts.rare.len().saturating_sub(1);
            if let Some(count) = counts.rare.get_mut(which.min(last)) {
                count.add(code.text);
            }
        }
        return Err(scratch.refuse(reason, code.text));
    }
    if crate::is_too_long(out.len()) {
        out.clear();
        return Err(scratch.refuse(Reason::TooLong, code.text));
    }
    // Every text but the empty one ends with the end of a line. One that doesn't has been cut short.
    if !matches!(out[..], [] | [0xEF, 0xBB, 0xBF] | [.., b'\n' | b'\r']) {
        out.clear();
        return Err(scratch.refuse(Reason::Other, code.text));
    }
    if let Some(counts) = &mut scratch.counts {
        counts.printed.add(code.text);
    }
    Ok(())
}
