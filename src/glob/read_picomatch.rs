//! A pattern of picomatch 2.3.2: `parse.js`, token by token. What it writes is a list of bytes of the pattern and eleven constants.

use crate::braces;
use crate::class::{self, Class, Escape, Read};
use crate::node::{Assertion, MAX_NESTING, Node, Open, Piece, Program, lower, nest};
use crate::unit::Text;
use bun_collections::StringHashMap;
use bun_core::strings;

// ───────────────────────────── what is written ─────────────────────────────

/// Below 256 a byte, else one of the constants.
type Written = Vec<u16>;

/// `[^/]`
const QMARK: u16 = 256;
/// `[^/]*?`
const STAR: u16 = 257;
/// `(?=.)`
const ONE_CHAR: u16 = 258;
/// `(?!\.)`
const NO_DOT: u16 = 259;
/// `(?!(?:^|\/)\.{1,2}(?:\/|$))`
const NO_DOTS: u16 = 260;
/// `(?!\.{0,1}(?:\/|$))`
const NO_DOT_SLASH: u16 = 261;
/// `(?!\.{1,2}(?:\/|$))`
const NO_DOTS_SLASH: u16 = 262;
/// `[^.\/]`
const QMARK_NO_DOT: u16 = 263;
/// `(?:(?:(?!(?:^|\/)\.{1,2}(?:\/|$)).)*?)`. Without `dot`: `(?:(?:(?!(?:^|\/)\.).)*?)`
const GLOBSTAR: u16 = 264;
/// `(?:`
const OPEN: u16 = 265;
/// `(?!`
const OPEN_NOT: u16 = 266;

const BANG: u16 = b'!' as u16;
const DOLLAR: u16 = b'$' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const ASTERISK: u16 = b'*' as u16;
const PLUS: u16 = b'+' as u16;
const COMMA: u16 = b',' as u16;
const MINUS: u16 = b'-' as u16;
const DOT: u16 = b'.' as u16;
const SLASH: u16 = b'/' as u16;
const COLON: u16 = b':' as u16;
const LESS: u16 = b'<' as u16;
const EQUALS: u16 = b'=' as u16;
const QUESTION: u16 = b'?' as u16;
const OPEN_SQUARE: u16 = b'[' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const CLOSE_SQUARE: u16 = b']' as u16;
const CARET: u16 = b'^' as u16;
const OPEN_CURLY: u16 = b'{' as u16;
const BAR: u16 = b'|' as u16;
const CLOSE_CURLY: u16 = b'}' as u16;

const DOT_LITERAL: [u16; 2] = [BACKSLASH, DOT];
const PLUS_LITERAL: [u16; 2] = [BACKSLASH, PLUS];
const SLASH_LITERAL: [u16; 2] = [BACKSLASH, SLASH];

fn written(text: &[u8]) -> Written {
    text.iter().map(|byte| u16::from(*byte)).collect()
}

fn is(written: &[u16], text: &[u8]) -> bool {
    written.len() == text.len() && written.iter().zip(text).all(|(a, b)| *a == u16::from(*b))
}

fn count(written: &[u16], wanted: u16) -> usize {
    written.iter().filter(|it| **it == wanted).count()
}

/// A constant with a `(` in it as the text that the reference writes: for `escapeLast`, which cuts one in two.
fn constant_text(constant: u16, dot: bool) -> Option<&'static [u8]> {
    Some(match constant {
        ONE_CHAR => &b"(?=.)"[..],
        NO_DOT => b"(?!\\.)",
        NO_DOTS => b"(?!(?:^|\\/)\\.{1,2}(?:\\/|$))",
        NO_DOT_SLASH => b"(?!\\.{0,1}(?:\\/|$))",
        NO_DOTS_SLASH => b"(?!\\.{1,2}(?:\\/|$))",
        GLOBSTAR if dot => b"(?:(?:(?!(?:^|\\/)\\.{1,2}(?:\\/|$)).)*?)",
        GLOBSTAR => b"(?:(?:(?!(?:^|\\/)\\.).)*?)",
        OPEN => b"(?:",
        OPEN_NOT => b"(?!",
        _ => return None,
    })
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// `/[-*+?.^${}(|)[\]]/`
fn is_regex_char(c: u16) -> bool {
    const MEMBERS: [u16; 14] = [
        MINUS,
        ASTERISK,
        PLUS,
        QUESTION,
        DOT,
        CARET,
        DOLLAR,
        OPEN_CURLY,
        CLOSE_CURLY,
        OPEN_PAREN,
        BAR,
        CLOSE_PAREN,
        OPEN_SQUARE,
        CLOSE_SQUARE,
    ];
    MEMBERS.contains(&c)
}

/// `utils.escapeRegex`
fn escape_regex(text: &[u16]) -> Written {
    let mut out = Written::with_capacity(text.len() + 2);
    for c in text {
        if is_regex_char(*c) {
            out.push(BACKSLASH);
        }
        out.push(*c);
    }
    out
}

/// `/^[^@![\].,$*+?^{}()|\\/]+/`: one of those that it leaves out.
fn is_special(byte: u8) -> bool {
    matches!(
        byte,
        b'@' | b'!'
            | b'['
            | b']'
            | b'.'
            | b','
            | b'$'
            | b'*'
            | b'+'
            | b'?'
            | b'^'
            | b'{'
            | b'}'
            | b'('
            | b')'
            | b'|'
            | b'\\'
            | b'/'
    )
}

const POSIX_REGEX_SOURCE: [(&[u8], &[u8]); 14] = [
    (b"alnum", b"a-zA-Z0-9"),
    (b"alpha", b"a-zA-Z"),
    (b"ascii", b"\\x00-\\x7F"),
    (b"blank", b" \\t"),
    (b"cntrl", b"\\x00-\\x1F\\x7F"),
    (b"digit", b"0-9"),
    (b"graph", b"\\x21-\\x7E"),
    (b"lower", b"a-z"),
    (b"print", b"\\x20-\\x7E "),
    (b"punct", b"\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~"),
    (b"space", b" \\t\\r\\n\\v\\f"),
    (b"upper", b"A-Z"),
    (b"word", b"A-Za-z0-9_"),
    (b"xdigit", b"A-Fa-f0-9"),
];

/// How many brackets of all kinds can be open. picomatch has no such limit. Beyond it the pattern matches nothing.
const MAX_OPEN: usize = MAX_NESTING - 8;

/// Why a written text has no pieces.
pub(crate) enum Unread {
    /// It is no expression.
    NoExpression,
    /// It is one, with what is not taken: lookbehind, a named group.
    NotTaken,
}

/// The pieces of a written text. Of the pattern: `\x`, a class, `(`, `(?:`, `(?=`, `(?!`, `)`, `|`, `?`, `+`, `*`, `.`, `^`, `$`.
pub(crate) fn read_written(written: &[u16], dot: bool) -> Result<Vec<Piece>, Unread> {
    let mut out = Vec::with_capacity(written.len());
    let assert = |assertion: Assertion| Piece::Node(Node::Assert(assertion));
    // A class and an escape are read from bytes.
    let bytes: Vec<u8> = written
        .iter()
        .map(|c| u8::try_from(*c).unwrap_or(0xFF))
        .collect();
    let is_constant = |c: &u16| *c >= 256;
    let mut i = 0;
    while let Some(&c) = written.get(i) {
        i += 1;
        let piece = match c {
            QMARK => Piece::Node(Node::Any),
            STAR => Piece::Node(Node::Star),
            ONE_CHAR => assert(Assertion::SomeUnit),
            NO_DOT => assert(Assertion::NotDot),
            NO_DOTS => assert(Assertion::NotDotsBehindStart),
            NO_DOT_SLASH => assert(Assertion::NotDotOrEmpty),
            NO_DOTS_SLASH => assert(Assertion::NotDots),
            QMARK_NO_DOT => Piece::Node(Node::Class(Class::not_dot_or_slash())),
            GLOBSTAR => {
                let guard = Node::Assert(match dot {
                    true => Assertion::NotDotsBehindStart,
                    false => Assertion::NotDotBehindStart,
                });
                let unit = Node::Seq(vec![guard, Node::Dot { newlines: false }]);
                Piece::Node(Node::repeat(unit, 0, true))
            }
            OPEN => Piece::Open(Open::Group),
            OPEN_NOT => Piece::Open(Open::NotLook),
            BACKSLASH => {
                if written.get(i).is_none_or(is_constant) {
                    return Err(Unread::NoExpression);
                }
                let (piece, len) = match class::javascript_escape(&bytes, i - 1, false) {
                    // A half of a pair stays with its other half.
                    Escape::Unit { unit, len } if (0xD800..=0xDFFF).contains(&unit) => {
                        let half = bytes.get(i..i - 1 + len).unwrap_or_default();
                        (Piece::Node(Node::Lit(half.to_vec())), len)
                    }
                    Escape::Unit { unit, len } => (Piece::Node(Node::of_unit(unit)), len),
                    Escape::Ranges(ranges) => {
                        (Piece::Node(Node::Class(Class::of_ranges(ranges, false))), 2)
                    }
                    Escape::WordBoundary { negated: true } => {
                        (assert(Assertion::NotWordBoundary), 2)
                    }
                    Escape::WordBoundary { negated: false } => (assert(Assertion::WordBoundary), 2),
                    Escape::Backslash => (Piece::Node(Node::Lit(vec![b'\\'])), 1),
                    Escape::Reference { number, unit, len } => {
                        (Piece::Reference { number, unit }, len)
                    }
                };
                i += len - 1;
                piece
            }
            OPEN_SQUARE => {
                let Read::Class { class, len, .. } = class::javascript(&bytes, i - 1, false) else {
                    return Err(Unread::NoExpression);
                };
                let inside = written.get(i - 1..i - 1 + len).unwrap_or_default();
                if inside.iter().any(is_constant) {
                    return Err(Unread::NoExpression);
                }
                i += len - 1;
                Piece::Node(Node::Class(class))
            }
            OPEN_PAREN if written.get(i) != Some(&QUESTION) => Piece::Open(Open::Capture),
            OPEN_PAREN => {
                i += 2;
                Piece::Open(match written.get(i - 1) {
                    Some(&COLON) => Open::Group,
                    Some(&EQUALS) => Open::Look,
                    Some(&BANG) => Open::NotLook,
                    Some(&LESS) => return Err(Unread::NotTaken),
                    _ => return Err(Unread::NoExpression),
                })
            }
            CLOSE_PAREN => Piece::Close,
            BAR => Piece::Bar,
            QUESTION | PLUS | ASTERISK => {
                // Lazy or greedy is the same here.
                i += usize::from(written.get(i) == Some(&QUESTION));
                Piece::Quant {
                    min: u8::from(c == PLUS),
                    unbounded: c != QUESTION,
                }
            }
            // `\.{1,2}` and `\.{0,1}`, of a constant that has been written out. A `{` of the pattern is never written as it is.
            OPEN_CURLY
                if written.get(i + 1) == Some(&COMMA)
                    && written.get(i + 3) == Some(&CLOSE_CURLY)
                    && matches!(out.last(), Some(Piece::Node(Node::Lit(_)))) =>
            {
                if written.get(i) == Some(&u16::from(b'1'))
                    && let Some(Piece::Node(Node::Lit(last))) = out.last()
                {
                    let again = last.clone();
                    out.push(Piece::Node(Node::Lit(again)));
                }
                i += 4;
                Piece::Quant {
                    min: 0,
                    unbounded: false,
                }
            }
            DOT => Piece::Node(Node::Dot { newlines: false }),
            CARET => assert(Assertion::Start),
            DOLLAR => assert(Assertion::End),
            // A character. One piece for each, so that a `+` behind it repeats the right thing.
            _ => {
                let start = i - 1;
                while bytes.get(i).is_some_and(|it| (0x80..=0xBF).contains(it))
                    && written.get(i).is_some_and(|it| !is_constant(it))
                {
                    i += 1;
                }
                Piece::Node(Node::Lit(bytes.get(start..i).unwrap_or_default().to_vec()))
            }
        };
        out.push(piece);
    }
    Ok(out)
}

// ───────────────────────────── the helpers of parse.js for `+(..)` and `*(..)` ─────────────────────────────

/// `String.prototype.trim`, of ASCII.
fn trim(text: &[u8]) -> &[u8] {
    let is_space = |byte: &u8| matches!(byte, 9..=13 | b' ');
    let from = text.iter().take_while(|it| is_space(it)).count();
    let rest = &text[from..];
    &rest[..rest.len() - rest.iter().rev().take_while(|it| is_space(it)).count()]
}

/// What a scan of a pattern is in.
#[derive(Default)]
struct Nesting {
    bracket: usize,
    paren: usize,
    is_quoted: bool,
    is_escaped: bool,
}

fn split_top_level(input: &[u8]) -> Vec<&[u8]> {
    let mut parts = Vec::new();
    let mut nesting = Nesting::default();
    let mut start = 0;
    for (at, ch) in input.iter().enumerate() {
        if nesting.is_escaped {
            nesting.is_escaped = false;
            continue;
        }
        match ch {
            b'\\' => nesting.is_escaped = true,
            b'"' => nesting.is_quoted = !nesting.is_quoted,
            _ if nesting.is_quoted => {}
            b'[' => nesting.bracket += 1,
            b']' if nesting.bracket > 0 => nesting.bracket -= 1,
            _ if nesting.bracket > 0 => {}
            b'(' => nesting.paren += 1,
            b')' if nesting.paren > 0 => nesting.paren -= 1,
            b'|' if nesting.paren == 0 => {
                parts.push(&input[start..at]);
                start = at + 1;
            }
            _ => {}
        }
    }
    parts.push(&input[start..]);
    parts
}

fn is_plain_branch(branch: &[u8]) -> bool {
    let mut is_escaped = false;
    for ch in branch {
        if is_escaped {
            is_escaped = false;
        } else if *ch == b'\\' {
            is_escaped = true;
        } else if matches!(
            ch,
            b'?' | b'*' | b'+' | b'@' | b'!' | b'(' | b')' | b'[' | b']' | b'{' | b'}'
        ) {
            return false;
        }
    }
    true
}

/// The branch without `@(..)` around it and without escapes. `None` if it is not plain.
fn normalize_simple_branch(branch: &[u8]) -> Option<Vec<u8>> {
    let mut value = trim(branch);
    // `/^@\([^\\()[\]{}|]+\)$/`
    while let [b'@', b'(', inner @ .., b')'] = value
        && !inner.is_empty()
        && !strings::contains_any(inner, b"\\()[]{}|")
    {
        value = inner;
    }
    if !is_plain_branch(value) {
        return None;
    }
    // `/\\(.)/g` -> `$1`
    let mut out = Vec::with_capacity(value.len());
    let mut rest = value;
    while let [first, after @ ..] = rest {
        rest = after;
        match (first, after) {
            (b'\\', [escaped, after @ ..]) if !matches!(escaped, b'\n' | b'\r') => {
                out.push(*escaped);
                rest = after;
            }
            _ => out.push(*first),
        }
    }
    Some(out)
}

/// The length of the first character of `text` in bytes.
fn first_len(text: &[u8]) -> usize {
    match text.first() {
        None | Some(0..0x80) => 1,
        Some(0x80..0xE0) => 2,
        Some(0xE0..0xF0) => 3,
        Some(_) => 4,
    }
}

/// Two branches that are one and the same character, repeated: `a|aa`. They always overlap, so the characters are remembered.
fn has_repeated_char_prefix_overlap(branches: &[&[u8]]) -> bool {
    let mut seen = StringHashMap::<()>::new();
    for branch in branches {
        let Some(value) = normalize_simple_branch(branch).filter(|it| !it.is_empty()) else {
            continue;
        };
        let len = first_len(&value);
        // A character beyond U+FFFF is two units, which are not each other.
        let is_repeat = len < 4
            && value.len().is_multiple_of(len)
            && value
                .iter()
                .zip(value.iter().skip(len))
                .all(|(a, b)| a == b);
        if is_repeat && bun_core::handle_oom(seen.get_or_put(&value[..len])).found_existing {
            return true;
        }
    }
    false
}

/// `+(..)` or `*(..)`.
struct Repeated<'p> {
    kind: u8,
    body: &'p [u8],
    /// Where its `)` is.
    end: usize,
}

/// What `pattern` starts with. `None`: it is neither, or (`require_end`) something follows it.
fn parse_repeated_extglob(pattern: &[u8], require_end: bool) -> Option<Repeated<'_>> {
    let [kind @ (b'+' | b'*'), b'(', ..] = pattern else {
        return None;
    };
    let mut nesting = Nesting::default();
    for (i, ch) in pattern.iter().enumerate().skip(1) {
        if nesting.is_escaped {
            nesting.is_escaped = false;
            continue;
        }
        match ch {
            b'\\' => nesting.is_escaped = true,
            b'"' => nesting.is_quoted = !nesting.is_quoted,
            _ if nesting.is_quoted => {}
            b'[' => nesting.bracket += 1,
            b']' if nesting.bracket > 0 => nesting.bracket -= 1,
            _ if nesting.bracket > 0 => {}
            b'(' => nesting.paren += 1,
            b')' => {
                nesting.paren = nesting.paren.saturating_sub(1);
                if nesting.paren == 0 {
                    return (!require_end || i + 1 == pattern.len()).then_some(Repeated {
                        kind: *kind,
                        body: &pattern[2..i],
                        end: i,
                    });
                }
            }
            _ => {}
        }
    }
    None
}

/// `*(a)*(b)`: `[ab]*`. `None`: it is not of that form.
fn star_extglob_sequence_output(pattern: &[u8]) -> Option<Written> {
    let mut chars: Vec<Written> = Vec::new();
    let mut rest = pattern;
    while !rest.is_empty() {
        let found = parse_repeated_extglob(rest, false).filter(|it| it.kind == b'*')?;
        let [only] = split_top_level(found.body)[..] else {
            return None;
        };
        let branch = normalize_simple_branch(only).filter(|it| !it.is_empty())?;
        // One UTF-16 unit.
        if branch.len() != first_len(&branch) || branch.len() == 4 {
            return None;
        }
        chars.push(escape_regex(&written(&branch)));
        rest = &rest[found.end + 1..];
    }
    let mut out = match &chars[..] {
        [] => return None,
        [only] => only.clone(),
        all => [&[OPEN_SQUARE][..], &all.concat(), &[CLOSE_SQUARE]].concat(),
    };
    out.push(ASTERISK);
    Some(out)
}

/// `analyzeRepeatedExtglob`: whether it is risky, and what is written for it then, if not the characters that it is.
fn analyze_repeated_extglob(body: &[u8]) -> (bool, Option<Written>) {
    let branches: Vec<&[u8]> = split_top_level(body).into_iter().map(trim).collect();
    // Empty, or `/^[*?]+$/`
    let is_wild = |branch: &&[u8]| branch.iter().all(|c| matches!(c, b'*' | b'?'));
    if branches.len() > 1
        && (branches.iter().any(is_wild) || has_repeated_char_prefix_overlap(&branches))
    {
        return (true, None);
    }
    for branch in branches {
        if let Some(safe_output) = star_extglob_sequence_output(branch) {
            return (true, Some(safe_output));
        }
        // `maxExtglobRecursion` is 0: one in it that is all of a branch is too many.
        if parse_repeated_extglob(branch, true).is_some() {
            return (true, None);
        }
    }
    (false, None)
}

// ───────────────────────────── parse.js ─────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Bos,
    Text,
    Star,
    Globstar,
    Slash,
    Paren,
    Bracket,
    Brace,
    Comma,
    Dot,
    Dots,
    Qmark,
    Plus,
    At,
    Negate,
    MaybeSlash,
}

/// What is open: `stack` of the reference.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Opened {
    Parens,
    Braces,
    Brackets,
}

struct Token {
    kind: Kind,
    value: Written,
    /// `None`: it is written as `value`.
    output: Option<Written>,
    /// Where in `Parser::all`.
    prev: Option<usize>,
    is_extglob: bool,
    is_star: bool,
    is_posix: bool,
    /// Of a `[`: how many `[` and `:` are in `value` behind its first byte.
    inner_opens: usize,
    inner_colons: usize,
    /// Of a `{`.
    has_comma: bool,
    has_dots: bool,
    output_index: usize,
    tokens_index: usize,
}

impl Token {
    fn new(kind: Kind, value: Written, output: Option<Written>) -> Token {
        Token {
            kind,
            value,
            output,
            prev: None,
            is_extglob: false,
            is_star: false,
            is_posix: false,
            inner_opens: 0,
            inner_colons: 0,
            has_comma: false,
            has_dots: false,
            output_index: 0,
            tokens_index: 0,
        }
    }

    fn written(&self) -> &[u16] {
        self.output.as_ref().unwrap_or(&self.value)
    }

    fn output_len(&self) -> usize {
        self.output.as_ref().map_or(0, Vec::len)
    }

    /// One more member of a class.
    fn add_member(&mut self, member: &[u16]) {
        self.inner_opens += count(member, OPEN_SQUARE);
        self.inner_colons += count(member, COLON);
        self.value.extend_from_slice(member);
    }
}

/// An extglob that is open.
struct Extglob {
    kind: Kind,
    close: Written,
    /// Of the values of the tokens in it: how long they are, and whether they have a `/` and a `*`.
    inner_len: usize,
    has_slash: bool,
    has_star: bool,
    parens: isize,
    /// How much was written before it.
    output_len: usize,
    start_index: usize,
    tokens_index: usize,
}

fn replaced(input: &[u8]) -> &[u8] {
    match input {
        b"***" => b"*",
        b"**/**" | b"**/**/**" => b"**",
        _ => input,
    }
}

/// `utils.escapeLast(output, byte)`. The `(` that is found can be one that `parse.js` wrote itself: `src(/**` matches `src`.
fn escape_last(output: &mut Written, byte: u16, dot: bool) {
    for at in (0..output.len()).rev() {
        if byte == OPEN_PAREN
            && let Some(text) = constant_text(output[at], dot)
        {
            let mut text = written(text);
            let last = text.iter().rposition(|c| *c == byte).unwrap_or(0);
            text.insert(last, BACKSLASH);
            output.splice(at..=at, text);
            return;
        }
        if output[at] == byte && (at == 0 || output[at - 1] != BACKSLASH) {
            return output.insert(at, BACKSLASH);
        }
    }
}

/// `/[!=<:]/`
fn is_group_kind(byte: Option<u8>) -> bool {
    matches!(byte, Some(b'!' | b'=' | b'<' | b':'))
}

struct Parser<'i> {
    input: &'i [u8],
    dot: bool,
    posix: bool,
    /// `parse` calls itself for `.ext` behind a `!(..)`.
    depth: usize,
    /// Every token that was made, and where in it those are that count. The first is the start of the pattern.
    all: Vec<Token>,
    tokens: Vec<usize>,
    prev: usize,
    /// How much of the input has been read: `state.index + 1`.
    at: usize,
    start: usize,
    output: Written,
    backtrack: bool,
    negated: bool,
    brackets: isize,
    braces: isize,
    parens: isize,
    is_quoted: bool,
    extglobs: Vec<Extglob>,
    open_braces: Vec<usize>,
    stack: Vec<Opened>,
    is_broken: bool,
    /// Where the last `<!`, `<=` or `<word>` of the input starts, once it has been looked for.
    last_angle: Option<Option<usize>>,
}

impl Parser<'_> {
    fn eos(&self) -> bool {
        self.at >= self.input.len()
    }

    /// `peek(n)`
    fn peek(&self, n: usize) -> Option<u8> {
        self.input.get(self.at + n - 1).copied()
    }

    fn advance(&mut self) -> Option<u8> {
        self.at += 1;
        self.input.get(self.at - 1).copied()
    }

    fn cut(&mut self, count: usize) {
        self.output
            .truncate(self.output.len().saturating_sub(count));
    }

    fn counter(&mut self, kind: Opened) -> &mut isize {
        match kind {
            Opened::Parens => &mut self.parens,
            Opened::Braces => &mut self.braces,
            Opened::Brackets => &mut self.brackets,
        }
    }

    fn increment(&mut self, kind: Opened) {
        *self.counter(kind) += 1;
        self.stack.push(kind);
        self.is_broken |= self.stack.len() > MAX_OPEN;
    }

    fn decrement(&mut self, kind: Opened) {
        *self.counter(kind) -= 1;
        self.stack.pop();
    }

    fn prev(&self) -> &Token {
        &self.all[self.prev]
    }

    fn prev_mut(&mut self) -> &mut Token {
        &mut self.all[self.prev]
    }

    /// `/<([!=]|\w+>)/.test(input[from..])`, without a search each time.
    fn has_angle_behind(&mut self, from: usize) -> bool {
        let input = self.input;
        let last = *self.last_angle.get_or_insert_with(|| {
            (0..input.len()).rev().find(|at| match &input[*at..] {
                [b'<', b'!' | b'=', ..] => true,
                [b'<', after @ ..] => {
                    let word = after.iter().take_while(|it| is_word(**it)).count();
                    word > 0 && after.get(word) == Some(&b'>')
                }
                _ => false,
            })
        });
        last.is_some_and(|it| it >= from)
    }

    fn push(&mut self, tok: Token) {
        if self.prev().kind == Kind::Globstar {
            let is_brace = self.braces > 0 && matches!(tok.kind, Kind::Comma | Kind::Brace);
            let is_extglob = tok.is_extglob || !self.extglobs.is_empty() && tok.kind == Kind::Paren;
            if !matches!(tok.kind, Kind::Slash | Kind::Paren) && !is_brace && !is_extglob {
                self.cut(self.prev().output_len());
                let prev = self.prev_mut();
                prev.kind = Kind::Star;
                prev.value = vec![ASTERISK];
                prev.output = Some(vec![STAR]);
                self.output.push(STAR);
            }
        }
        if tok.kind != Kind::Paren
            && let Some(extglob) = self.extglobs.last_mut()
        {
            extglob.inner_len += tok.value.len();
            extglob.has_slash |= count(&tok.value, SLASH) > 0;
            extglob.has_star |= count(&tok.value, ASTERISK) > 0;
        }
        self.output.extend_from_slice(tok.written());
        let prev = self.prev_mut();
        if prev.kind == Kind::Text && tok.kind == Kind::Text {
            // As the reference has it: what the first of them was written as is lost if the expression is put together again.
            prev.output
                .get_or_insert_default()
                .extend_from_slice(&tok.value);
            prev.value.extend_from_slice(&tok.value);
            return;
        }
        self.all.push(Token {
            prev: Some(self.prev),
            ..tok
        });
        self.prev = self.all.len() - 1;
        self.tokens.push(self.prev);
    }

    fn push_new(&mut self, kind: Kind, value: &[u16], output: Option<&[u16]>) {
        self.push(Token::new(
            kind,
            value.to_vec(),
            output.map(<[u16]>::to_vec),
        ));
    }

    /// `value`: `?`, `!`, `+` or `*`, before a `(`.
    fn extglob_open(&mut self, kind: Kind, value: u8) {
        let (open, close): (&[u16], &[u16]) = match kind {
            Kind::Negate => (
                &[OPEN, OPEN_NOT, OPEN],
                &[CLOSE_PAREN, CLOSE_PAREN, STAR, CLOSE_PAREN],
            ),
            Kind::Qmark => (&[OPEN], &[CLOSE_PAREN, QUESTION]),
            Kind::Plus => (&[OPEN], &[CLOSE_PAREN, PLUS]),
            _ => (&[OPEN], &[CLOSE_PAREN, ASTERISK]),
        };
        let extglob = Extglob {
            kind,
            close: close.to_vec(),
            inner_len: 0,
            has_slash: false,
            has_star: false,
            parens: self.parens,
            output_len: self.output.len(),
            start_index: self.at - 1,
            tokens_index: self.tokens.len(),
        };
        self.increment(Opened::Parens);
        let guard: &[u16] = if self.output.is_empty() {
            &[ONE_CHAR]
        } else {
            &[]
        };
        self.push_new(kind, &[u16::from(value)], Some(guard));
        self.advance();
        self.push(Token {
            is_extglob: true,
            ..Token::new(Kind::Paren, vec![OPEN_PAREN], Some(open.to_vec()))
        });
        self.extglobs.push(extglob);
    }

    /// At the `)` of `it`.
    fn extglob_close(&mut self, it: Extglob) {
        let input = self.input;
        let mut output = it.close;
        if matches!(it.kind, Kind::Plus | Kind::Star) {
            let body = input
                .get(it.start_index + 2..self.at - 1)
                .unwrap_or_default();
            if let (true, safe_output) = analyze_repeated_extglob(body) {
                // It is taken as the characters that it is, or as a class with a `*`.
                let literal = written(input.get(it.start_index..self.at).unwrap_or_default());
                let as_written = match safe_output {
                    Some(safe) if it.output_len == 0 => [&[ONE_CHAR][..], &safe].concat(),
                    Some(safe) => safe,
                    None => escape_regex(&literal),
                };
                self.output.truncate(it.output_len);
                self.output.extend_from_slice(&as_written);
                let mut inside = self
                    .tokens
                    .get(it.tokens_index..)
                    .unwrap_or_default()
                    .iter();
                if let Some(open) = inside.next() {
                    let open = &mut self.all[*open];
                    open.kind = Kind::Text;
                    open.value = literal;
                    open.output = Some(as_written);
                }
                for token in inside {
                    self.all[*token].value = Written::new();
                    self.all[*token].output = Some(Written::new());
                }
                self.backtrack = true;
                output = Written::new();
            }
        } else if it.kind == Kind::Negate {
            let rest = input.get(self.at..).unwrap_or_default();
            let extglob_star = match it.inner_len > 1 && it.has_slash {
                true => GLOBSTAR,
                false => STAR,
            };
            // The end, or `/^\)+$/.test(remaining())`
            if extglob_star != STAR || rest.iter().all(|c| *c == b')') {
                output = vec![CLOSE_PAREN, DOLLAR, CLOSE_PAREN, CLOSE_PAREN, extglob_star];
            }
            // `/^\.[^\\/.]+$/.test(rest)`: `.ts`, `.{ts,tsx}`, `.@(js)` behind it is what must not follow either.
            if it.has_star
                && let [b'.', extension @ ..] = rest
                && !extension.is_empty()
                && !strings::contains_any(extension, b"\\/.")
            {
                match parse(rest, self.dot, self.posix, false, self.depth + 1) {
                    Some((expression, _)) => {
                        output = vec![CLOSE_PAREN];
                        output.extend(expression);
                        output.extend([CLOSE_PAREN, extglob_star, CLOSE_PAREN]);
                    }
                    None => self.is_broken = true,
                }
            }
        }
        self.push(Token {
            is_extglob: true,
            ..Token::new(Kind::Paren, vec![CLOSE_PAREN], Some(output))
        });
        self.decrement(Opened::Parens);
    }

    /// A `:` in a class: `[:alpha:]` has been read up to its second `:`. Whether it has been replaced.
    fn posix_class(&mut self) -> bool {
        let prev = self.prev_mut();
        if prev.inner_opens == 0 {
            return false;
        }
        prev.is_posix = true;
        if prev.inner_colons == 0 {
            return false;
        }
        // No name is longer than six, so a `[` that is further back is of no name.
        let tail = prev.value.len().saturating_sub(8);
        let Some(at) = prev.value[tail..].iter().rposition(|c| *c == OPEN_SQUARE) else {
            return false;
        };
        let name = prev.value.split_off(tail + at);
        let Some((_, source)) = POSIX_REGEX_SOURCE
            .iter()
            .find(|it| name.get(2..).is_some_and(|name| is(name, it.0)))
        else {
            prev.value.extend(name);
            return false;
        };
        prev.inner_opens -= 1;
        prev.inner_colons -= count(&name, COLON);
        prev.add_member(&written(source));
        self.backtrack = true;
        self.advance();
        if self.all[0].output_len() == 0 && self.tokens.get(1) == Some(&self.prev) {
            self.all[0].output = Some(vec![ONE_CHAR]);
        }
        true
    }

    /// At a `}` that closes `brace`.
    fn brace_close(&mut self, brace: usize) {
        let (mut closing, mut output) = (vec![CLOSE_CURLY], vec![CLOSE_PAREN]);
        if self.all[brace].has_dots {
            let mut range: Vec<Written> = Vec::new();
            while let Some(it) = self.tokens.pop() {
                let it = &self.all[it];
                match it.kind {
                    Kind::Brace => break,
                    Kind::Dots => {}
                    _ => range.push(it.value.clone()),
                }
            }
            output = expand_range(range, self.dot);
            self.backtrack = true;
        } else if !self.all[brace].has_comma {
            self.output.truncate(self.all[brace].output_index);
            self.all[brace].value = vec![BACKSLASH, OPEN_CURLY];
            self.all[brace].output = Some(vec![BACKSLASH, OPEN_CURLY]);
            closing = vec![BACKSLASH, CLOSE_CURLY];
            output.clone_from(&closing);
            let inside = self.tokens.get(self.all[brace].tokens_index..);
            for it in inside.unwrap_or_default() {
                let it = &self.all[*it];
                self.output.extend_from_slice(match &it.output {
                    Some(output) if !output.is_empty() => output,
                    _ => &it.value,
                });
            }
        }
        self.push(Token::new(Kind::Brace, closing, Some(output)));
        self.decrement(Opened::Braces);
        self.open_braces.pop();
    }

    /// At the second `*` of two. `prev` is the first.
    fn second_star(&mut self) {
        let input = self.input;
        let Some(prior) = self.prev().prev else {
            return;
        };
        let kind_of = |it: Option<usize>| it.map(|it| self.all[it].kind);
        let (prior_kind, before) = (self.all[prior].kind, kind_of(self.all[prior].prev));
        let is_start = matches!(prior_kind, Kind::Slash | Kind::Bos);
        let after_star = matches!(before, Some(Kind::Star | Kind::Globstar));
        let is_brace = self.braces > 0 && matches!(prior_kind, Kind::Comma | Kind::Brace);
        if !is_start && prior_kind != Kind::Paren && !is_brace {
            return self.push_new(Kind::Star, &[ASTERISK], Some(&[]));
        }
        // Consecutive `/**/` are one.
        while input
            .get(self.at..)
            .is_some_and(|rest| rest.starts_with(b"/**"))
            && matches!(input.get(self.at + 3), None | Some(b'/'))
        {
            self.at += 3;
        }
        let is_before_slash = input.get(self.at) == Some(&b'/');
        let is_behind_name = prior_kind == Kind::Slash && before != Some(Kind::Bos);
        let is_first = prior_kind == Kind::Bos;
        self.prev_mut().value.push(ASTERISK);
        self.prev_mut().kind = Kind::Globstar;
        // What is written for it, and whether `(?:` is put before the `/` that is before it.
        let (output, opens_before_slash): (Written, bool) = if is_first && self.eos() {
            self.output.clear();
            (vec![GLOBSTAR], false)
        } else if is_behind_name && !after_star && self.eos() {
            (vec![GLOBSTAR, BAR, DOLLAR, CLOSE_PAREN], true)
        } else if is_behind_name && is_before_slash {
            let mut output = vec![GLOBSTAR, BACKSLASH, SLASH, BAR, BACKSLASH, SLASH];
            if input.get(self.at + 1).is_some() {
                output.extend([BAR, DOLLAR]);
            }
            output.push(CLOSE_PAREN);
            (output, true)
        } else if is_first && is_before_slash {
            self.output.clear();
            let output = [
                &[OPEN, CARET, BAR][..],
                &SLASH_LITERAL,
                &[BAR, GLOBSTAR],
                &SLASH_LITERAL,
                &[CLOSE_PAREN],
            ];
            (output.concat(), false)
        } else {
            self.cut(self.prev().output_len());
            self.prev_mut().output = Some(vec![GLOBSTAR]);
            return self.output.push(GLOBSTAR);
        };
        if opens_before_slash {
            self.cut(self.all[prior].output_len() + self.prev().output_len());
            let prior = &mut self.all[prior];
            prior.output.get_or_insert_default().insert(0, OPEN);
            self.output.extend_from_slice(prior.written());
        }
        self.output.extend_from_slice(&output);
        self.prev_mut().output = Some(output);
        if !self.eos() {
            self.advance();
            self.push_new(Kind::Slash, &[SLASH], Some(&[]));
        }
    }

    fn run(&mut self) {
        let input = self.input;
        let last_close_square = strings::last_index_of_char(input, b']');
        while !self.eos() && !self.is_broken {
            let Some(value) = self.advance() else {
                break;
            };
            let unit = u16::from(value);
            if value == 0 {
                continue;
            }

            // Escaped characters. `text`: `value` where it is more than one character.
            let mut text: Option<Written> = None;
            if value == b'\\' {
                match self.peek(1) {
                    Some(b'/' | b'.' | b';') => continue,
                    None => {
                        self.push_new(Kind::Text, &[BACKSLASH, BACKSLASH], None);
                        continue;
                    }
                    Some(_) => {}
                }
                let mut escaped = vec![BACKSLASH];
                let rest = input.get(self.at..).unwrap_or_default();
                let slashes = rest.iter().take_while(|it| **it == b'\\').count();
                if slashes > 2 {
                    self.at += slashes;
                    if !slashes.is_multiple_of(2) {
                        escaped.push(BACKSLASH);
                    }
                }
                // One UTF-16 unit, not one byte: a character of up to three bytes, or the first half of four.
                let after = self.advance();
                escaped.extend(after.map(u16::from));
                let more = match after {
                    Some(0xC0..0xE0 | 0xF0..) => 1,
                    Some(0xE0..0xF0) => 2,
                    _ => 0,
                };
                for _ in 0..more {
                    if !matches!(self.peek(1), Some(0x80..=0xBF)) {
                        break;
                    }
                    escaped.extend(self.advance().map(u16::from));
                }
                if self.brackets == 0 {
                    self.push(Token::new(Kind::Text, escaped, None));
                    continue;
                }
                text = Some(escaped);
            }

            // In a class, up to the closing bracket.
            let is_at_start_of_class =
                is(&self.prev().value, b"[") || is(&self.prev().value, b"[^");
            if self.brackets > 0 && (text.is_some() || value != b']' || is_at_start_of_class) {
                if text.is_none() && value == b':' && self.posix_class() {
                    continue;
                }
                let member = text.unwrap_or_else(|| match (value, self.peek(1)) {
                    (b'!', _) if self.posix && is(&self.prev().value, b"[") => vec![CARET],
                    (b']', _) => vec![BACKSLASH, unit],
                    (b'[', next) if next != Some(b':') => vec![BACKSLASH, unit],
                    (b'-', Some(b']')) => vec![BACKSLASH, unit],
                    _ => vec![unit],
                });
                self.prev_mut().add_member(&member);
                self.output.extend(member);
                continue;
            }

            // In quotes.
            if value == b'"' {
                self.is_quoted = !self.is_quoted;
                continue;
            }
            if self.is_quoted {
                let escaped = escape_regex(&[unit]);
                self.prev_mut().value.extend_from_slice(&escaped);
                self.output.extend(escaped);
                continue;
            }

            match value {
                b'(' => {
                    self.increment(Opened::Parens);
                    self.push_new(Kind::Paren, &[unit], None);
                }
                b')' => {
                    if self
                        .extglobs
                        .last()
                        .is_some_and(|it| self.parens == it.parens + 1)
                        && let Some(extglob) = self.extglobs.pop()
                    {
                        self.extglob_close(extglob);
                        continue;
                    }
                    let output: &[u16] = match self.parens {
                        0 => &[BACKSLASH, CLOSE_PAREN],
                        _ => &[CLOSE_PAREN],
                    };
                    self.push_new(Kind::Paren, &[unit], Some(output));
                    self.decrement(Opened::Parens);
                }
                b'[' if last_close_square.is_none_or(|it| it < self.at) => {
                    self.push_new(Kind::Bracket, &[BACKSLASH, unit], None);
                }
                b'[' => {
                    self.increment(Opened::Brackets);
                    self.push_new(Kind::Bracket, &[unit], None);
                }
                b']' if self.brackets == 0
                    || self.prev().kind == Kind::Bracket && self.prev().value.len() == 1 =>
                {
                    self.push_new(Kind::Text, &[unit], Some(&[BACKSLASH, unit]));
                }
                b']' => {
                    self.decrement(Opened::Brackets);
                    let prev = &mut self.all[self.prev];
                    let inside = prev.value.get(1..).unwrap_or_default();
                    let is_special = inside.iter().any(|c| is_regex_char(*c));
                    let adds_slash = !prev.is_posix
                        && inside.first() == Some(&CARET)
                        && count(inside, SLASH) == 0;
                    let closing: &[u16] = match adds_slash {
                        true => &[SLASH, CLOSE_SQUARE],
                        false => &[CLOSE_SQUARE],
                    };
                    prev.value.extend_from_slice(closing);
                    self.output.extend_from_slice(closing);
                    if is_special {
                        continue;
                    }
                    // Nothing in it is special: it may be meant as the characters that it is.
                    let class = std::mem::take(&mut prev.value);
                    prev.value = [
                        &[OPEN][..],
                        &escape_regex(&class),
                        &[BAR],
                        &class,
                        &[CLOSE_PAREN],
                    ]
                    .concat();
                    let len = self.output.len().saturating_sub(class.len());
                    self.output.truncate(len);
                    self.output.extend_from_slice(&prev.value);
                }
                b'{' => {
                    self.increment(Opened::Braces);
                    self.push(Token {
                        output_index: self.output.len(),
                        tokens_index: self.tokens.len(),
                        ..Token::new(Kind::Brace, vec![unit], Some(vec![OPEN_PAREN]))
                    });
                    self.open_braces.push(self.prev);
                }
                b'}' => match self.open_braces.last().copied() {
                    Some(brace) => self.brace_close(brace),
                    None => self.push_new(Kind::Text, &[unit], Some(&[unit])),
                },
                b'|' => self.push_new(Kind::Text, &[unit], None),
                b',' => {
                    let brace = self.open_braces.last().copied();
                    match brace.filter(|_| self.stack.last() == Some(&Opened::Braces)) {
                        Some(brace) => {
                            self.all[brace].has_comma = true;
                            self.push_new(Kind::Comma, &[unit], Some(&[BAR]));
                        }
                        None => self.push_new(Kind::Comma, &[unit], Some(&[unit])),
                    }
                }
                // `./` at the start is left out, any number of times.
                b'/' if self.prev().kind == Kind::Dot && self.at == self.start + 2 => {
                    self.start = self.at;
                    self.output.clear();
                    self.tokens.pop();
                    self.prev = 0;
                }
                b'/' => self.push_new(Kind::Slash, &[unit], Some(&SLASH_LITERAL)),
                b'.' if self.braces > 0 && self.prev().kind == Kind::Dot => {
                    let prev = self.prev_mut();
                    if is(&prev.value, b".") {
                        prev.output = Some(DOT_LITERAL.to_vec());
                    }
                    prev.kind = Kind::Dots;
                    prev.output.get_or_insert_default().push(unit);
                    prev.value.push(unit);
                    if let Some(brace) = self.open_braces.last() {
                        self.all[*brace].has_dots = true;
                    }
                }
                b'.' => {
                    let is_in_name = self.braces + self.parens == 0
                        && !matches!(self.prev().kind, Kind::Bos | Kind::Slash);
                    let kind = if is_in_name { Kind::Text } else { Kind::Dot };
                    self.push_new(kind, &[unit], Some(&DOT_LITERAL));
                }
                b'?' => {
                    let is_group = is(&self.prev().value, b"(");
                    let next = self.peek(1);
                    if !is_group && next == Some(b'(') && self.peek(2) != Some(b'?') {
                        self.extglob_open(Kind::Qmark, value);
                    } else if self.prev().kind == Kind::Paren {
                        let is_escaped = is_group && !is_group_kind(next)
                            || next == Some(b'<') && !self.has_angle_behind(self.at);
                        let output: &[u16] = match is_escaped {
                            true => &[BACKSLASH, QUESTION],
                            false => &[QUESTION],
                        };
                        self.push_new(Kind::Text, &[unit], Some(output));
                    } else {
                        let is_first = matches!(self.prev().kind, Kind::Slash | Kind::Bos);
                        let output = if !self.dot && is_first {
                            QMARK_NO_DOT
                        } else {
                            QMARK
                        };
                        self.push_new(Kind::Qmark, &[unit], Some(&[output]));
                    }
                }
                b'!' if self.peek(1) == Some(b'(')
                    && (self.peek(2) != Some(b'?') || !is_group_kind(self.peek(3))) =>
                {
                    self.extglob_open(Kind::Negate, value);
                }
                // `negate()`
                b'!' if self.at == 1 => {
                    let mut bangs = 1;
                    while self.peek(1) == Some(b'!')
                        && (self.peek(2) != Some(b'(') || self.peek(3) == Some(b'?'))
                    {
                        self.advance();
                        self.start += 1;
                        bangs += 1;
                    }
                    if bangs % 2 == 1 {
                        self.negated = true;
                        self.start += 1;
                    }
                }
                b'+' if self.peek(1) == Some(b'(') && self.peek(2) != Some(b'?') => {
                    self.extglob_open(Kind::Plus, value);
                }
                b'+' => {
                    let prev = self.prev();
                    if is(&prev.value, b"(") {
                        self.push_new(Kind::Plus, &[unit], Some(&PLUS_LITERAL));
                    } else if matches!(prev.kind, Kind::Bracket | Kind::Paren | Kind::Brace)
                        || self.parens > 0
                    {
                        self.push_new(Kind::Plus, &[unit], None);
                    } else {
                        self.push_new(Kind::Plus, &PLUS_LITERAL, None);
                    }
                }
                b'@' if self.peek(1) == Some(b'(') && self.peek(2) != Some(b'?') => {
                    self.push(Token {
                        is_extglob: true,
                        ..Token::new(Kind::At, vec![unit], Some(Written::new()))
                    });
                }
                b'@' => self.push_new(Kind::Text, &[unit], None),
                b'*' => self.star(),
                // Plain text.
                _ => {
                    let mut run = match value {
                        b'$' | b'^' => vec![BACKSLASH, unit],
                        _ => vec![unit],
                    };
                    let rest = input.get(self.at..).unwrap_or_default();
                    let plain = rest.iter().take_while(|it| !is_special(**it)).count();
                    run.extend(rest[..plain].iter().map(|it| u16::from(*it)));
                    self.at += plain;
                    self.push(Token::new(Kind::Text, run, None));
                }
            }
        }
    }

    /// At a `*`.
    fn star(&mut self) {
        if self.prev().kind == Kind::Globstar || self.prev().is_star {
            let prev = self.prev_mut();
            prev.kind = Kind::Star;
            prev.is_star = true;
            prev.value.push(ASTERISK);
            prev.output = Some(vec![STAR]);
            self.backtrack = true;
            return;
        }
        // `/^\([^?]/.test(rest)`
        if self.peek(1) == Some(b'(') && self.peek(2).is_some_and(|it| it != b'?') {
            return self.extglob_open(Kind::Star, b'*');
        }
        if self.prev().kind == Kind::Star {
            return self.second_star();
        }
        if self.at == self.start + 1 || matches!(self.prev().kind, Kind::Slash | Kind::Dot) {
            let mut guard = vec![match (self.prev().kind, self.dot) {
                (Kind::Dot, _) => NO_DOT_SLASH,
                (_, true) => NO_DOTS_SLASH,
                (_, false) => NO_DOT,
            }];
            if self.peek(1) != Some(b'*') {
                guard.push(ONE_CHAR);
            }
            self.output.extend_from_slice(&guard);
            self.prev_mut().output.get_or_insert_default().extend(guard);
        }
        self.push_new(Kind::Star, &[ASTERISK], Some(&[STAR]));
    }
}

/// `parse(input, options)`: what is written, and whether it is negated. `None`: beyond `MAX_OPEN`, or a `{` is not closed.
fn parse(
    input: &[u8],
    dot: bool,
    posix: bool,
    fastpaths: bool,
    depth: usize,
) -> Option<(Written, bool)> {
    if depth > 4 {
        return None;
    }
    let input = replaced(input);
    // `utils.removePrefix`
    let input = input.strip_prefix(b"./").unwrap_or(input);
    // The fast path: nothing but names, `?`, `*`, `.` and escapes.
    if fastpaths
        && !matches!(input.first(), Some(b'*' | b'!'))
        && !strings::contains_any(input, b"/()[]{}\"")
    {
        let qmark_no_dot = if dot { QMARK } else { QMARK_NO_DOT };
        let mut output = vec![CARET, OPEN];
        output.extend(fast_path(input, qmark_no_dot));
        output.extend([CLOSE_PAREN, DOLLAR]);
        return Some((output, false));
    }
    let mut parser = Parser {
        input,
        dot,
        posix,
        depth,
        all: vec![Token::new(Kind::Bos, Written::new(), Some(Written::new()))],
        tokens: vec![0],
        prev: 0,
        at: 0,
        start: 0,
        output: Written::new(),
        backtrack: false,
        negated: false,
        brackets: 0,
        braces: 0,
        parens: 0,
        is_quoted: false,
        extglobs: Vec::new(),
        open_braces: Vec::new(),
        stack: Vec::new(),
        is_broken: false,
        last_angle: None,
    };
    parser.run();
    if parser.is_broken {
        return None;
    }
    // What is not closed is a character: the last one that is written, wherever it came from.
    for (open, byte) in [(parser.brackets, OPEN_SQUARE), (parser.parens, OPEN_PAREN)] {
        for _ in 0..open {
            escape_last(&mut parser.output, byte, dot);
        }
    }
    // A `{` is written `(`, which no `\` before a `{` closes: it is no expression.
    if parser.braces > 0 {
        return None;
    }
    if matches!(parser.prev().kind, Kind::Star | Kind::Bracket) {
        parser.push_new(Kind::MaybeSlash, &[], Some(&[BACKSLASH, SLASH, QUESTION]));
    }
    // Put together again from the tokens, if one of them was changed after it was written.
    if parser.backtrack {
        parser.output.clear();
        for it in &parser.tokens {
            parser.output.extend_from_slice(parser.all[*it].written());
        }
    }
    Some((parser.output, parser.negated))
}

/// `expandRange`: `{a..c}` is the class `[a-c]`, whatever the two are, if that is an expression at all.
fn expand_range(args: Vec<Written>, dot: bool) -> Written {
    // The value of a class that may be meant as characters has a `(?:` in it.
    let as_text = |it: Written| -> Written {
        let mut out = Written::with_capacity(it.len());
        for c in it {
            match constant_text(c, dot) {
                Some(text) => out.extend(written(text)),
                None => out.push(c),
            }
        }
        out
    };
    let mut args: Vec<Written> = args.into_iter().map(as_text).collect();
    // JavaScript's order of strings is that of UTF-16 units. For what is here the order of bytes is the same but beyond U+FFFF.
    args.sort();
    let value = [&[OPEN_SQUARE][..], &args.join(&MINUS), &[CLOSE_SQUARE]].concat();
    let is_expression = match read_written(&value, dot) {
        Ok(pieces) => nest(pieces).is_some(),
        Err(Unread::NotTaken) => true,
        Err(Unread::NoExpression) => false,
    };
    if is_expression {
        return value;
    }
    let escaped: Vec<Written> = args.iter().map(|it| escape_regex(it)).collect();
    escaped.join(&[DOT, DOT][..])
}

/// `REGEX_SPECIAL_CHARS_BACKREF` of the fast path: `/(\\?)((\W)(\3*))/g`. Then runs of `\` are cut down.
fn fast_path(input: &[u8], qmark_no_dot: u16) -> Written {
    let mut out = Written::with_capacity(input.len() * 2);
    let mut has_backslashes = false;
    let mut i = 0;
    while let Some(&byte) = input.get(i) {
        if is_word(byte) {
            out.push(u16::from(byte));
            i += 1;
            continue;
        }
        let index = i;
        // `(\\?)`: it is given back if nothing that is no word character follows.
        let esc = byte == b'\\' && input.get(i + 1).is_some_and(|it| !is_word(*it));
        i += usize::from(esc);
        // One UTF-16 unit. A character of four bytes is two, which never repeat: it is kept whole, which comes to the same.
        let first = input.get(i).copied().unwrap_or(0);
        let unit_len = match first {
            0..0x80 => 1,
            0x80..0xE0 => 2,
            0xE0..0xF0 => 3,
            0xF0.. => 4,
        };
        let unit = input.get(i..i + unit_len).unwrap_or_default();
        let is_again = |times: usize| {
            let rest = input.get(i + times * unit_len..).unwrap_or_default();
            !rest.is_empty() && rest.starts_with(unit)
        };
        let mut times = 1;
        while unit_len < 4 && is_again(times) {
            times += 1;
        }
        let end = (i + times * unit_len).min(input.len());
        let (chars, all) = (written(&input[i..end]), written(&input[index..end]));
        i = end;
        let qmarks = |times: usize| std::iter::repeat_n(QMARK, times);
        match first {
            b'\\' => {
                has_backslashes = true;
                out.extend(all);
            }
            b'?' if esc => {
                out.extend([BACKSLASH, QUESTION]);
                out.extend(qmarks(times - 1));
            }
            b'?' if index == 0 => {
                out.push(qmark_no_dot);
                out.extend(qmarks(times - 1));
            }
            b'?' => out.extend(qmarks(times)),
            b'.' => out.extend((0..times).flat_map(|_| DOT_LITERAL)),
            b'*' if esc => {
                out.extend([BACKSLASH, ASTERISK]);
                out.extend((times > 1).then_some(STAR));
            }
            b'*' => out.push(STAR),
            _ if esc => out.extend(all),
            _ => {
                out.push(BACKSLASH);
                out.extend(chars);
            }
        }
    }
    if !has_backslashes {
        return out;
    }
    // `/\\+/g`: an even run is one `\` that is a character, an odd run is one that escapes.
    let mut cut = Written::with_capacity(out.len());
    let mut rest = &out[..];
    while let Some(first) = rest.first() {
        let run = rest.iter().take_while(|it| **it == BACKSLASH).count();
        cut.push(*first);
        if run > 0 && run.is_multiple_of(2) {
            cut.push(BACKSLASH);
        }
        rest = &rest[run.max(1)..];
    }
    cut
}

/// `parse.fastpaths`: eight frequent patterns, with any number of `.ext` behind them. `None`: it is none of them.
fn fastpaths(input: &[u8], dot: bool) -> Option<Written> {
    let input = replaced(input);
    let input = input.strip_prefix(b"./").unwrap_or(input);
    let (nodot, slash_dot) = match dot {
        true => (NO_DOTS, NO_DOTS_SLASH),
        false => (NO_DOT, NO_DOT),
    };
    const DEEP: u16 = 0;
    // `/^(.*?)\.(\w+)$/`, again and again: what is behind the last `.` is letters, digits and `_`.
    let mut end = input.len();
    loop {
        // `DEEP` stands for `(?:` nodot globstar `\/)?`.
        let source = match &input[..end] {
            b"*" => Some(vec![nodot, ONE_CHAR, STAR]),
            b".*" => Some(vec![BACKSLASH, DOT, ONE_CHAR, STAR]),
            b"*.*" => Some(vec![nodot, STAR, BACKSLASH, DOT, ONE_CHAR, STAR]),
            b"*/*" => Some(vec![
                nodot, STAR, BACKSLASH, SLASH, ONE_CHAR, slash_dot, STAR,
            ]),
            b"**" => Some(vec![nodot, GLOBSTAR]),
            b"**/*" => Some(vec![DEEP, slash_dot, ONE_CHAR, STAR]),
            b"**/*.*" => Some(vec![DEEP, slash_dot, STAR, BACKSLASH, DOT, ONE_CHAR, STAR]),
            b"**/.*" => Some(vec![DEEP, BACKSLASH, DOT, ONE_CHAR, STAR]),
            _ => None,
        };
        if let Some(source) = source {
            let mut out = Written::with_capacity(input.len() + 16);
            for c in source {
                match c {
                    DEEP => out.extend([
                        OPEN,
                        nodot,
                        GLOBSTAR,
                        BACKSLASH,
                        SLASH,
                        CLOSE_PAREN,
                        QUESTION,
                    ]),
                    c => out.push(c),
                }
            }
            // The extensions that were taken off: `.` is written `\.`, the rest is words.
            for byte in &input[end..] {
                if *byte == b'.' {
                    out.push(BACKSLASH);
                }
                out.push(u16::from(*byte));
            }
            out.extend([BACKSLASH, SLASH, QUESTION]);
            return Some(out);
        }
        let word = input[..end]
            .iter()
            .rev()
            .take_while(|it| is_word(**it))
            .count();
        let dot_at = (end - word).checked_sub(1)?;
        // `.*?` takes no line terminator. One would end up here as the last character, and be no word.
        if word == 0 || input[dot_at] != b'.' {
            return None;
        }
        end = dot_at;
    }
}

/// `picomatch.makeRe(pattern, { dot, posix })`. Negated: `^(?!^(?:..)$).*$`, and the program is what is in the lookahead.
pub(crate) fn pattern(bytes: &[u8], dot: bool, posix: bool) -> (Program, bool) {
    let fast = match bytes.first() {
        Some(b'.' | b'*') => fastpaths(bytes, dot).map(|output| (output, false)),
        _ => None,
    };
    // No expression: `toRegex` catches that, and `/$^/` matches nothing, negated or not.
    let never = (Program::Never, false);
    let Some((output, negated)) = fast.or_else(|| parse(bytes, dot, posix, true, 0)) else {
        return never;
    };
    let whole = [&[CARET, OPEN][..], &output, &[CLOSE_PAREN, DOLLAR]].concat();
    match read_written(&whole, dot).map(nest) {
        Ok(Some(tree)) => (lower(tree, Text::UTF16), negated),
        // It is an expression, and one that is not followed. It matches nothing, so negated it matches all.
        Err(Unread::NotTaken) => (Program::Never, negated),
        Ok(None) | Err(Unread::NoExpression) => never,
    }
}

/// `processPatterns` of fast-glob: `braces` 3.0.3, for which `braces::expand` stands in, and `removeDuplicateSlashes`.
pub(crate) fn expand_for_fast_glob(bytes: &[u8]) -> Vec<Vec<u8>> {
    // `hasBraces` of micromatch: a `{` and a `}` behind it.
    let has_braces = strings::index_of_char_usize(bytes, b'{')
        .is_some_and(|open| strings::contains_char(&bytes[open..], b'}'));
    let mut out = match has_braces {
        // Beyond its limit there is nothing to match with.
        true => braces::expand(bytes).unwrap_or_default(),
        false => vec![bytes.to_vec()],
    };
    let mut seen = StringHashMap::<()>::new();
    out.retain_mut(|it| {
        // `/(?!^)\/{2,}/g`: a run of `/` is one, but at the very start.
        let (mut at, mut was_slash) = (0_usize, false);
        it.retain(|byte| {
            let is_dropped = *byte == b'/' && at >= 2 && was_slash;
            (at, was_slash) = (at + 1, *byte == b'/');
            !is_dropped
        });
        !it.is_empty() && !bun_core::handle_oom(seen.get_or_put(it)).found_existing
    });
    out
}
