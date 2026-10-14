//! Goes over JavaScript token by token without parsing it, for code whose end has to be found first: the `{a}` of Svelte
//! and of MDX.
//!
//! It tells brackets, words and operators from what is in strings, templates, comments and regular expressions. The code
//! can be broken, cut off, or have JSX or markup in it. It takes linear time whatever it's given.

use bun_core::strings;
use bun_sema::check::spans::{skip_trivia, token_end};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Piece {
    /// `(`, `[`, `{`, and the start of a template up to its first `${`.
    Open,
    /// `)`, `]`, `}`, and the end of a template from its last `}` on.
    Close,
    /// A name, a keyword or a number.
    Word,
    /// A string, a regular expression, a template without a `${`, or the part of one from a `}` to the next `${`.
    Literal,
    /// An operator, or one character of anything else.
    Other,
}

/// Searches that found nothing, so that they aren't repeated. A caller that makes one `Skimmer` after another for the same
/// code hands this from each one to the next. Otherwise `{/[}` over and over on one line would read the line every time.
#[derive(Copy, Clone, Default)]
pub(crate) struct Searched {
    /// A `/` before this starts no regular expression: the line was searched for the end of one, and has none.
    no_regex_before: usize,
    /// The same for a `'` and a `"` and the end of a string.
    no_string_before: [usize; 2],
}

pub(crate) struct Skimmer<'a> {
    code: &'a [u8],
    /// Behind the last piece.
    pub(crate) at: usize,
    /// How many `{` are open.
    pub(crate) braces: usize,
    /// How many brackets of any kind are open, if `next_outside_brackets` is what is called.
    depth: usize,
    /// For each template with an open `${`: what `braces` was before it.
    templates: Vec<usize>,
    /// The last piece was a value, so a `/` divides.
    is_after_value: bool,
    pub(crate) searched: Searched,
}

/// A character that isn't ASCII counts as part of a name.
fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'#' | 0x80..)
}

/// A `/` behind it starts a regular expression. `if` is for Svelte's `{:else if /a/.test(b)}`.
fn is_keyword_before_value(word: &[u8]) -> bool {
    matches!(
        word,
        b"return"
            | b"typeof"
            | b"instanceof"
            | b"in"
            | b"of"
            | b"new"
            | b"delete"
            | b"void"
            | b"throw"
            | b"case"
            | b"default"
            | b"do"
            | b"if"
            | b"else"
            | b"yield"
            | b"await"
    )
}

impl<'a> Skimmer<'a> {
    /// Starts at `at`, where a value can start.
    pub(crate) fn new(code: &'a [u8], at: usize) -> Skimmer<'a> {
        Skimmer {
            code,
            at,
            braces: 0,
            depth: 0,
            templates: Vec::new(),
            is_after_value: false,
            searched: Searched::default(),
        }
    }

    /// The same behind a `{`. `braces` is 0 again after the `}` that closes it.
    pub(crate) fn behind_brace(code: &'a [u8], at: usize) -> Skimmer<'a> {
        Skimmer {
            braces: 1,
            ..Skimmer::new(code, at)
        }
    }

    fn byte_before(&self, at: usize) -> Option<u8> {
        self.code.get(at.checked_sub(1)?).copied()
    }

    /// The next piece, and where it starts. It ends at `self.at`.
    pub(crate) fn next(&mut self) -> Option<(Piece, usize)> {
        let start = skip_trivia(self.code, self.at);
        let byte = *self.code.get(start)?;
        self.at = start + 1;
        let piece;
        (piece, self.is_after_value) = match byte {
            b'(' | b'[' => (Piece::Open, false),
            b')' | b']' => (Piece::Close, true),
            b'{' => {
                self.braces += 1;
                (Piece::Open, false)
            }
            b'}' => {
                self.braces = self.braces.saturating_sub(1);
                // Behind the `}` of a `${ }` the template goes on.
                let is_in_template = self.templates.last() == Some(&self.braces);
                if is_in_template && self.skip_template_text() {
                    self.braces += 1;
                    (Piece::Literal, false)
                } else {
                    if is_in_template {
                        self.templates.pop();
                    }
                    (Piece::Close, true)
                }
            }
            b'`' if self.skip_template_text() => {
                self.templates.push(self.braces);
                self.braces += 1;
                (Piece::Open, false)
            }
            b'`' => (Piece::Literal, true),
            b'"' | b'\'' if self.skip_string(byte) => (Piece::Literal, true),
            b'"' | b'\'' => (Piece::Other, false),
            b'/' if self.skip_regex() => (Piece::Literal, true),
            _ => {
                self.at = token_end(self.code, start, false).max(self.at);
                match self.code.get(start..self.at).unwrap_or_default() {
                    // They come before a value or behind one: `!/a/.test(b)`, `a! / b`, `a++ / b`.
                    b"!" | b"++" | b"--" => (Piece::Other, self.is_after_value),
                    [b'.', b'0'..=b'9', ..] => (Piece::Word, true),
                    _ if !is_word_byte(byte) => (Piece::Other, false),
                    // `a.in / b`
                    _ if self.byte_before(start) == Some(b'.') => (Piece::Word, true),
                    word => (Piece::Word, !is_keyword_before_value(word)),
                }
            }
        };
        Some((piece, start))
    }

    /// The next piece that is in no brackets. An opening bracket is outside of itself, a closing one isn't.
    pub(crate) fn next_outside_brackets(&mut self) -> Option<(Piece, usize)> {
        loop {
            let (piece, at) = self.next()?;
            let depth = self.depth;
            match piece {
                Piece::Open => self.depth += 1,
                Piece::Close => self.depth = depth.saturating_sub(1),
                Piece::Word | Piece::Literal | Piece::Other => {}
            }
            if depth == 0 && piece != Piece::Close {
                return Some((piece, at));
            }
        }
    }

    /// Behind a quote: goes behind the string. `false`: nothing closes it on its line, so the quote is just a character,
    /// like the one in `<p>Don't</p>`.
    fn skip_string(&mut self, quote: u8) -> bool {
        let no_string_before = &mut self.searched.no_string_before[usize::from(quote == b'"')];
        let mut at = self.at;
        while at >= *no_string_before {
            let rest = self.code.get(at..).unwrap_or_default();
            at += strings::index_of_any(rest, &[quote, b'\\', b'\n', b'\r']).unwrap_or(rest.len());
            match self.code.get(at..).unwrap_or_default() {
                [b'\\', b'\r', b'\n', ..] => at += 3,
                [b'\\', ..] => at += 2,
                [b'"' | b'\'', ..] => {
                    self.at = at + 1;
                    return true;
                }
                // Every quote on the way has a backslash before it, so none of them starts a string that ends.
                _ => *no_string_before = at + 1,
            }
        }
        false
    }

    /// In the text of a template: goes behind the backtick that ends it, or, and then it returns `true`, behind the next
    /// `${`. Without either it runs to the end.
    fn skip_template_text(&mut self) -> bool {
        loop {
            let rest = self.code.get(self.at..).unwrap_or_default();
            let Some(found) = strings::index_of_any(rest, b"`\\$") else {
                self.at = self.code.len();
                return false;
            };
            self.at += found + 1;
            match rest.get(found..).unwrap_or_default() {
                [b'`', ..] => return false,
                [b'\\', ..] => self.at += 1,
                [b'$', b'{', ..] => {
                    self.at += 1;
                    return true;
                }
                _ => {}
            }
        }
    }

    /// Behind a `/`: goes behind the regular expression that it starts. `false`: it's an operator, or the `/` of `</a>`.
    fn skip_regex(&mut self) -> bool {
        if self.is_after_value
            || self.at < self.searched.no_regex_before
            || self.byte_before(self.at - 1) == Some(b'<')
        {
            return false;
        }
        let (mut at, mut is_in_class) = (self.at, false);
        while let Some(&byte) = self.code.get(at) {
            match byte {
                b'\n' | b'\r' => break,
                b'\\' => at += 1,
                b'[' => is_in_class = true,
                b']' => is_in_class = false,
                b'/' if !is_in_class => {
                    self.at = at + 1;
                    return true;
                }
                _ => {}
            }
            at += 1;
        }
        self.searched.no_regex_before = at;
        false
    }
}
