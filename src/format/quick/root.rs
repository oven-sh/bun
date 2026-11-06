//! format(): bytes in, bytes out.

use crate::doc::DOC_START;
use crate::js::{WRAP_BARE, WRAP_BY_KIND, WRAP_EXPAND, WRAP_GROUP, WRAP_NONE};
use crate::lang::lang;
use crate::options::{
    EOL_AUTO, EOL_CR, EOL_CRLF, EOL_LF, QUOTE_PROPS_AS_NEEDED, QUOTE_PROPS_CONSISTENT,
    QUOTE_PROPS_PRESERVE, TRAILING_COMMA_ALL, TRAILING_COMMA_ES5, TRAILING_COMMA_NONE,
    WHITESPACE_CSS, WHITESPACE_IGNORE,
};
use crate::text::SRC_BASE;
use crate::{Bytes, OwnLosses, Quick, R, Stop, Words, rare, why};

impl Quick {
    /// Turns "\r\n" and "\r" into "\n" in place. Returns the new length.
    pub(crate) fn normalize_end_of_line(&mut self, length: i32) -> R<i32> {
        let end = SRC_BASE + length;
        // The buffer is as large as the largest file so far: a "\r" behind the text keeps the search from running through all of it.
        self.t.put(end, 13);
        let first = self.t.index_of(13, SRC_BASE);
        if first < 0 || first >= end {
            if self.options.end_of_line == EOL_AUTO {
                self.set_end_of_line(EOL_LF);
            }
            return Ok(length);
        }
        if self.options.end_of_line == EOL_AUTO {
            // the first line ending decides
            let first_lf = self.t.index_of(10, SRC_BASE);
            if first_lf >= 0 && first_lf < first {
                self.set_end_of_line(EOL_LF);
            } else {
                self.set_end_of_line(if self.t.at(first + 1) == 10 {
                    EOL_CRLF
                } else {
                    EOL_CR
                });
            }
        }
        let mut w = first;
        let mut r = first;
        while r < end {
            let c = self.t.at(r);
            if c == 13 {
                self.t.put(
                    {
                        let v0 = w;
                        w += 1;
                        v0
                    },
                    10,
                );
                if self.t.at(r + 1) != 10 {
                    return Err(self.rare(rare::ODD_BYTES));
                }
                r += 1;
            } else {
                self.t.put(
                    {
                        let v1 = w;
                        w += 1;
                        v1
                    },
                    c,
                );
            }
            r += 1;
        }
        return Ok(w - SRC_BASE);
    }
}

/// The quick way does not print this file: the long way does, or says what is wrong with it.
#[derive(Debug)]
pub struct Refused;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Language {
    /// JavaScript, with JSX. A file with `@flow` in its first comments is read as Flow.
    JavaScript,
    /// Flow as its own parser reads it.
    Flow,
    /// Flow as Babel reads it.
    BabelFlow,
    TypeScript,
}

/// What kind of file the text is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Dialect {
    pub language: Language,
    /// TypeScript: is `<a>` an element (.tsx) or a type assertion (.ts)? `None`: the name of the file does not say, and both are tried.
    pub jsx: Option<bool>,
    /// A .cjs or .cts file: `await` is a name outside of async functions.
    pub common_js: bool,
    /// A .mjs or .mts file: `await` is no name anywhere.
    pub module_only: bool,
    /// A .d.ts, .d.mts or .d.cts file.
    pub declaration_file: bool,
    /// The name of the file ends in ".ts": `<T,>() => 1` needs no comma.
    pub name_ends_in_ts: bool,
    /// The name of the file ends in ".js.flow": JavaScript is read as Flow.
    pub name_ends_in_js_flow: bool,
}

fn ends_with_ignoring_case(name: &[u8], end: &[u8]) -> bool {
    name.len() >= end.len()
        && name
            .iter()
            .rev()
            .zip(end.iter().rev())
            .all(|(a, b)| a.to_ascii_lowercase() == *b)
}

impl Dialect {
    /// What the name of the file says about a text in `language`.
    pub fn of_name(language: Language, name: &[u8]) -> Dialect {
        let ends_with_one_of =
            |ends: &[&[u8]]| ends.iter().any(|end| ends_with_ignoring_case(name, end));
        Dialect {
            language,
            jsx: if ends_with_one_of(&[b".ts", b".mts", b".cts"]) {
                Some(false)
            } else if ends_with_one_of(&[b".js", b".mjs", b".cjs", b".jsx", b".tsx"]) {
                Some(true)
            } else {
                None
            },
            common_js: ends_with_one_of(&[b".cjs", b".cts"]),
            module_only: ends_with_one_of(&[b".mjs", b".mts"]),
            declaration_file: ends_with_one_of(&[b".d.ts", b".d.mts", b".d.cts"]),
            name_ends_in_ts: name.ends_with(b".ts"),
            name_ends_in_js_flow: name.ends_with(b".js.flow"),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum QuoteProps {
    AsNeeded,
    Consistent,
    Preserve,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TrailingComma {
    None,
    Es5,
    All,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EndOfLine {
    Lf,
    Crlf,
    Cr,
    Auto,
}

#[derive(Clone, Debug)]
pub struct Options {
    pub print_width: i32,
    pub tab_width: i32,
    pub use_tabs: bool,
    pub semi: bool,
    pub single_quote: bool,
    pub jsx_single_quote: bool,
    pub quote_props: QuoteProps,
    pub trailing_comma: TrailingComma,
    pub bracket_spacing: bool,
    pub object_wrap_preserve: bool,
    pub bracket_same_line: bool,
    pub arrow_parens_always: bool,
    pub end_of_line: EndOfLine,
    pub single_attribute_per_line: bool,
    pub operator_position_start: bool,
    pub embedded_language_formatting_auto: bool,
    /// `htmlWhitespaceSensitivity: "ignore"`, for HTML in templates.
    pub html_whitespace_sensitivity_ignore: bool,
    /// The text is code in Markdown: a program that is nothing but an element of JSX gets no semicolon.
    pub is_in_markdown: bool,
    /// The text is `import` and `export` declarations of MDX. Anything else in it is refused.
    pub is_mdx_es_syntax: bool,
    /// A line break that is part of a text (in a template, a comment, a string) is written as "\r\n": a host that indents the lines of the result tells
    /// it from the others, behind which the indentation of the host goes. Only with `EndOfLine::Lf`.
    pub marks_line_breaks_in_texts: bool,
    /// The text is printed in a host that indents it by so many levels. The first line of the result starts behind its indentation, which the host
    /// has written; the other lines have theirs, but for those that start in a text (a template, a comment).
    pub indentation: i32,
    /// Everything goes through the tokens, the tree and the document.
    pub no_short_cuts: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            print_width: 80,
            tab_width: 2,
            use_tabs: false,
            semi: true,
            single_quote: false,
            jsx_single_quote: false,
            quote_props: QuoteProps::AsNeeded,
            trailing_comma: TrailingComma::All,
            bracket_spacing: true,
            object_wrap_preserve: true,
            bracket_same_line: false,
            arrow_parens_always: true,
            end_of_line: EndOfLine::Lf,
            single_attribute_per_line: false,
            operator_position_start: false,
            embedded_language_formatting_auto: true,
            html_whitespace_sensitivity_ignore: false,
            is_in_markdown: false,
            is_mdx_es_syntax: false,
            marks_line_breaks_in_texts: false,
            indentation: 0,
            no_short_cuts: false,
        }
    }
}

/// A file that is longer is refused at once. One that is as long has room in the buffers, which have a limit of their own ([`crate::LARGEST`]): four bytes of text,
/// four words of the tree and of the document and four bytes of output for each of its bytes.
pub(crate) const LONGEST_FILE: usize = (crate::LARGEST / 4) as usize;
/// Columns are products of levels and the width of one.
const DEEPEST_HOST: i32 = 1 << 12;

/// Formats `text` and puts the result in the place of what `out` held. `scratch` lives from file to file; what it holds never changes what is printed.
/// If the file is refused, `out` is empty.
pub fn format(
    text: &[u8],
    dialect: Dialect,
    options: &Options,
    scratch: &mut Quick,
    out: &mut Vec<u8>,
) -> Result<(), Refused> {
    out.clear();
    if text.len() > LONGEST_FILE {
        scratch.why.set(why::TOO_LARGE);
        return Err(Refused);
    }
    if options.tab_width < 1
        || options.print_width < 1
        || !(0..=DEEPEST_HOST).contains(&options.indentation)
    {
        scratch.why.set(why::RARE);
        return Err(Refused);
    }
    let _losses = OwnLosses::start();
    match scratch.format_buffer(text, dialect, options) {
        Ok(()) => {
            if scratch.had_bom {
                out.extend_from_slice(b"\xef\xbb\xbf");
            }
            out.extend_from_slice(scratch.printer.out.sub(0, scratch.printer.out_length));
            if options.indentation != 0 {
                // the indentation behind the last line break
                while let [.., b' ' | b'\t'] = out[..] {
                    out.pop();
                }
            }
            scratch.give_back_what_is_large();
            Ok(())
        }
        Err(Stop) => {
            scratch.forget_run();
            scratch.give_back_what_is_large();
            Err(Refused)
        }
    }
}

/// Would [`format`] print `text` and a line break? No is always a valid answer. It costs a fraction of what formatting costs: nothing is made of the text, it is
/// only read. For a host whose guest starts at the left margin, and which then prints the guest as it is written.
pub fn stands(text: &[u8], dialect: Dialect, options: &Options, scratch: &mut Quick) -> bool {
    let language = match dialect.language {
        Language::JavaScript => lang::Babel,
        Language::TypeScript => lang::TypeScript,
        Language::Flow | Language::BabelFlow => return false,
    };
    if text.len() > LONGEST_FILE
        || options.tab_width < 1
        || options.print_width < 1
        || options.indentation != 0
        || options.end_of_line != EndOfLine::Lf
        || options.no_short_cuts
        || dialect.name_ends_in_js_flow
        || bun_core::strings::contains_char(text, b'\r')
    {
        return false;
    }
    let length = text.len() as i32;
    let _losses = OwnLosses::start();
    scratch.start_run();
    scratch.set_options(options, dialect);
    scratch.source_buffer(length, 0);
    scratch.t.set_all(text, SRC_BASE);
    scratch.set_source_length(length);
    scratch.reset_filters();
    scratch.set_may_break_lines(false);
    scratch.set_short_cuts(true);
    let stands = scratch.program_stands(language, SRC_BASE, SRC_BASE + length);
    scratch.set_short_cuts(false);
    // The text is gone when the parser comes.
    scratch.set_verified(0, 0);
    if stands.is_err() {
        scratch.forget_run();
    }
    let stands = matches!(stands, Ok(true)) && scratch.nothing_lost().is_ok();
    scratch.give_back_what_is_large();
    stands
}

/// What `formatAttributeValue()` of language-html puts around the document of an expression.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Wrap {
    /// Nothing.
    Bare,
    /// `group(doc)`
    Group,
    /// `printExpand(doc)`
    Expand,
    /// The one for an object, an array and, in Vue, a string or a template; the other for everything else: `shouldHugJsExpression()`.
    ByKind,
}

/// An expression in HTML: the value of an attribute, or what is between `{{` and `}}`.
#[derive(Clone, Copy, Debug)]
pub struct Expression<'a> {
    pub text: &'a [u8],
    pub is_typescript: bool,
    /// `a | b` at its top is a filter of Vue.
    pub has_vue_filters: bool,
    /// It is `<$>`, JSX of MDX and `</$>`: Prettier's `rootMarker: "mdx"`. What is between the two is printed.
    pub is_mdx_jsx: bool,
    pub wrap: Wrap,
    /// What is printed in front of it on its line (the name of the attribute, `="`), and behind it.
    pub before: &'a [u8],
    pub after: &'a [u8],
}

/// Puts `before`, the expression and `after` in the place of what `out` held, as they are printed where `before` starts a line that is indented by
/// `options.indentation` levels and a line break follows `after`. There is no line break at the end. An expression with a comment is refused.
pub fn format_expression(
    expression: &Expression<'_>,
    options: &Options,
    scratch: &mut Quick,
    out: &mut Vec<u8>,
) -> Result<(), Refused> {
    out.clear();
    let text = expression.text;
    if text.len() > LONGEST_FILE
        || expression.before.len() > LONGEST_FILE
        || expression.after.len() > LONGEST_FILE
    {
        scratch.why.set(why::TOO_LARGE);
        return Err(Refused);
    }
    if options.tab_width < 1
        || options.print_width < 1
        || !(0..=DEEPEST_HOST).contains(&options.indentation)
        || options.end_of_line != EndOfLine::Lf
        || bun_core::strings::contains_char(text, b'\r')
    {
        scratch.why.set(why::RARE);
        return Err(Refused);
    }
    let _losses = OwnLosses::start();
    let dialect = Dialect {
        language: if expression.is_typescript {
            Language::TypeScript
        } else {
            Language::JavaScript
        },
        jsx: Some(!expression.is_typescript),
        common_js: false,
        module_only: true,
        declaration_file: false,
        name_ends_in_ts: false,
        name_ends_in_js_flow: false,
    };
    scratch.host.wrap = match expression.wrap {
        Wrap::Bare => WRAP_BARE,
        Wrap::Group => WRAP_GROUP,
        Wrap::Expand => WRAP_EXPAND,
        Wrap::ByKind => WRAP_BY_KIND,
    };
    scratch.host.before.clear();
    scratch.host.before.extend_from_slice(expression.before);
    scratch.host.after.clear();
    scratch.host.after.extend_from_slice(expression.after);
    scratch.host.has_vue_filters = expression.has_vue_filters;
    scratch.host.is_mdx_jsx = expression.is_mdx_jsx;
    let done = scratch.format_expression_buffer(expression, dialect, options);
    scratch.host.wrap = WRAP_NONE;
    scratch.host.has_vue_filters = false;
    scratch.host.is_mdx_jsx = false;
    match done {
        Ok(()) => {
            out.extend_from_slice(scratch.printer.out.sub(0, scratch.printer.out_length));
            scratch.give_back_what_is_large();
            Ok(())
        }
        Err(Stop) => {
            scratch.forget_run();
            scratch.give_back_what_is_large();
            Err(Refused)
        }
    }
}

impl Quick {
    fn format_expression_buffer(
        &mut self,
        expression: &Expression<'_>,
        dialect: Dialect,
        options: &Options,
    ) -> R<()> {
        let length = expression.text.len() as i32 + 3;
        self.start_run();
        self.set_options(options, dialect);
        self.source_buffer(length, 0);
        self.t.put(SRC_BASE, 40);
        self.t.set_all(expression.text, SRC_BASE + 1);
        self.t.put(SRC_BASE + length - 2, 10);
        self.t.put(SRC_BASE + length - 1, 41);
        self.had_bom = false;
        self.set_short_cuts(false);
        let language = if expression.is_typescript {
            lang::TypeScript
        } else {
            lang::Babel
        };
        self.format_normalized(length, language)
    }

    fn set_options(&mut self, o: &Options, dialect: Dialect) {
        let to = &mut self.options;
        to.print_width = o.print_width.min(0x1fffffff);
        to.tab_width = o.tab_width;
        to.use_tabs = o.use_tabs;
        to.semi = o.semi;
        to.single_quote = o.single_quote;
        to.jsx_single_quote = o.jsx_single_quote;
        to.quote_props = match o.quote_props {
            QuoteProps::AsNeeded => QUOTE_PROPS_AS_NEEDED,
            QuoteProps::Consistent => QUOTE_PROPS_CONSISTENT,
            QuoteProps::Preserve => QUOTE_PROPS_PRESERVE,
        };
        to.trailing_comma = match o.trailing_comma {
            TrailingComma::None => TRAILING_COMMA_NONE,
            TrailingComma::Es5 => TRAILING_COMMA_ES5,
            TrailingComma::All => TRAILING_COMMA_ALL,
        };
        to.bracket_spacing = o.bracket_spacing;
        to.object_wrap_preserve = o.object_wrap_preserve;
        to.bracket_same_line = o.bracket_same_line;
        to.arrow_parens_always = o.arrow_parens_always;
        to.end_of_line = match o.end_of_line {
            EndOfLine::Lf => EOL_LF,
            EndOfLine::Crlf => EOL_CRLF,
            EndOfLine::Cr => EOL_CR,
            EndOfLine::Auto => EOL_AUTO,
        };
        to.single_attribute_per_line = o.single_attribute_per_line;
        to.operator_position_start = o.operator_position_start;
        to.embedded_language_formatting_auto = o.embedded_language_formatting_auto;
        to.html_whitespace_sensitivity = if o.html_whitespace_sensitivity_ignore {
            WHITESPACE_IGNORE
        } else {
            WHITESPACE_CSS
        };
        to.is_in_markdown = o.is_in_markdown;
        to.is_mdx_es_syntax = o.is_mdx_es_syntax;
        to.marks_line_breaks_in_texts = o.marks_line_breaks_in_texts;
        to.indentation = o.indentation;
        to.name_ends_in_ts = dialect.name_ends_in_ts;
        to.name_ends_in_js_flow = dialect.name_ends_in_js_flow;
        self.dialect = dialect;
    }

    fn format_buffer(&mut self, text: &[u8], dialect: Dialect, options: &Options) -> R<()> {
        let mut length = text.len() as i32;
        self.start_run();
        self.set_options(options, dialect);
        self.source_buffer(length, 0);
        self.t.set_all(text, SRC_BASE);
        let language = match dialect.language {
            Language::JavaScript => lang::Babel,
            Language::Flow => lang::Flow,
            Language::BabelFlow => lang::BabelFlow,
            Language::TypeScript => lang::TypeScript,
        };
        self.had_bom = text.starts_with(b"\xef\xbb\xbf");
        if self.had_bom {
            self.t
                .move_within(SRC_BASE, SRC_BASE + 3, SRC_BASE + length);
            length -= 3;
        }
        length = self.normalize_end_of_line(length)?;
        if options.no_short_cuts {
            return self.format_normalized(length, language);
        }
        self.set_short_cuts(true);
        let mut result = self.format_normalized(length, language);
        if result.is_ok() {
            self.note_guess(false, length);
        } else if self.why.get() == why::REDO {
            // A guess about the layout was wrong. The text is still there: once more, without guessing.
            self.redone += 1;
            self.note_guess(true, length);
            self.forget_run();
            self.set_short_cuts(false);
            self.unwind_source(0);
            let end_of_line = self.options.end_of_line;
            self.set_options(options, dialect);
            self.options.end_of_line = end_of_line;
            self.why.set(why::NONE);
            result = self.format_normalized(length, language);
        }
        self.set_short_cuts(false);
        result
    }

    /// `!text.trim()`
    fn is_blank(&self, length: i32) -> bool {
        let mut rest = self.t.sub(SRC_BASE, SRC_BASE + length);
        loop {
            rest = match rest {
                [] => return true,
                [32 | 9..=13, rest @ ..] => rest,
                [0xc2, 0xa0, rest @ ..] => rest,
                [0xe1, 0x9a, 0x80, rest @ ..] => rest,
                [0xe2, 0x80, 0x80..=0x8a | 0xa8 | 0xa9 | 0xaf, rest @ ..] => rest,
                [0xe2, 0x81, 0x9f, rest @ ..] => rest,
                [0xe3, 0x80, 0x80, rest @ ..] => rest,
                [0xef, 0xbb, 0xbf, rest @ ..] => rest,
                _ => return false,
            };
        }
    }

    /// The same for a text without a byte order mark and with "\n" at the end of its lines.
    fn format_normalized(&mut self, length: i32, language: i32) -> R<()> {
        self.set_source_length(length);
        if self.is_blank(length) {
            self.print_nothing();
            return Ok(());
        }
        self.allow_waste_for(length);
        self.reset_ast(length * 2 + 1024);
        self.reset_doc(length * 2 + 4096);
        self.reset_filters();
        self.begin_root(language);
        self.format_js()?;
        let stub = self.end_doc();
        self.nothing_lost()?;
        if self.doc.overflowed {
            return Err(self.stop(why::BUG));
        }
        self.stage(2);
        self.print_doc(DOC_START, stub)?;
        self.nothing_lost()?;
        if self.text.overflowed
            || self.text.gen_pos > self.text.t_cap
            || self.printer.out_length > self.printer.out.len() as i32
        {
            return Err(self.stop(why::BUG));
        }
        Ok(())
    }

    /// Why the last file was refused: 1 a syntax error, 4 a mistake in here, 5 the text, what is made of it or what is tried on it is too much, 6 the stack is full, 7 something rare, 8 code in another language.
    pub fn why(&self) -> i32 {
        self.why.get()
    }

    /// Where the syntax error is, from the start of the text (without the byte order mark, and with "\n" at the ends of the lines).
    pub fn failed_at(&self) -> i32 {
        self.failed_at.get()
    }

    /// Which rare thing the last file was refused for, for those who count; 0 if it has no number.
    pub fn which_rare(&self) -> i32 {
        self.which_rare.get()
    }

    /// How many files were formatted twice.
    pub fn redone(&self) -> i32 {
        self.redone
    }

    #[inline(always)]
    pub(crate) fn stage(&mut self, _stage: i32) {
        #[cfg(feature = "stages")]
        self.note_stage(_stage);
    }
}

/// For tools that compare what each stage leaves behind.
#[cfg(feature = "stages")]
impl Quick {
    fn note_stage(&mut self, stage: i32) {
        fn hash_words(words: &[i32], from: (i32, i32)) -> (i32, i32) {
            let (mut h1, mut h2) = from;
            for &w in words {
                h1 = (h1 ^ w).wrapping_mul(16777619);
                h2 = h2.wrapping_add(w).wrapping_mul(0x9e3779b1u32 as i32)
                    ^ ((h2 as u32) >> 15) as i32;
            }
            (h1, h2)
        }
        let h = match stage {
            0 | 1 => hash_words(
                self.lexer.c.sub(0, self.lexer.c_count * 8),
                hash_words(self.n.sub(0, self.arena.n_pos), (1, 2)),
            ),
            _ => hash_words(self.d.sub(0, self.doc.d_pos), (1, 2)),
        };
        let h = ((h.0 as u32 as u64) << 32) | h.1 as u32 as u64;
        if let Some(slot) = self.stages.get_mut(stage as usize) {
            *slot = h;
        }
        if self.keep_stages {
            match stage {
                0 | 1 => {
                    let mut words = self.n.sub(0, self.arena.n_pos).to_vec();
                    words.push(-1);
                    words.extend_from_slice(self.lexer.c.sub(0, self.lexer.c_count * 8));
                    self.kept.push(words);
                }
                _ => self.kept.push(self.d.sub(0, self.doc.d_pos).to_vec()),
            }
        }
    }
    pub fn stages(&self) -> [u64; 3] {
        self.stages
    }
    pub fn clear_stages(&mut self, keep: bool) {
        self.stages = [0; 3];
        self.keep_stages = keep;
        self.kept.clear();
    }
    pub fn kept(&self) -> &[Vec<i32>] {
        &self.kept
    }
    pub fn set_no_guests(&mut self, value: bool) {
        self.no_guests = value;
    }
    /// How much work of the last run was for nothing: see `waste()`.
    pub fn wasted(&self) -> i32 {
        self.wasted
    }
}
