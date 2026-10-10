//! minimatch 3.1.5: the names of a pattern for `minimatch()`, and `makeRe`: one expression for the whole path, which answers otherwise.

use crate::braces;
use crate::node::{Node, Piece, Program, lower, nest};
use crate::pattern::Options;
use crate::read_picomatch::{Unread, read_written};
use crate::segments::{Part, has_braces};
use crate::unit::Text;
use bun_core::strings;

const QMARK: &[u8] = b"[^/]";
const STAR: &[u8] = b"[^/]*?";
const TWO_STAR_DOT: &[u8] = br"(?:(?!(?:\/|^)(?:\.{1,2})($|\/)).)*?";
const TWO_STAR_NO_DOT: &[u8] = br"(?:(?!(?:\/|^)\.).)*?";
const MAX_PATTERN_LENGTH: usize = 65_536;
/// Ours: each of these cuts and writes the text again. Beyond them the pattern matches nothing.
const MAX_DEPTH: usize = 64;
const MAX_OPEN_LISTS: usize = 100;
const MAX_NEGATIVE_LISTS: usize = 1_024;

/// `reSpecials`
fn is_re_special(c: u8) -> bool {
    matches!(
        c,
        b'(' | b')'
            | b'.'
            | b'*'
            | b'{'
            | b'}'
            | b'+'
            | b'?'
            | b'['
            | b']'
            | b'^'
            | b'$'
            | b'\\'
            | b'!'
    )
}

/// The flag `i`, without `u`.
fn text_of(options: Options) -> Text {
    Text {
        folds: options.nocase,
        ..Text::UTF16
    }
}

fn pieces_of(source: &[u8], options: Options) -> Result<Vec<Piece>, Unread> {
    let written: Vec<u16> = source.iter().map(|it| u16::from(*it)).collect();
    read_written(&written, options.dot, text_of(options))
}

/// Whether `new RegExp(source)` does not throw.
fn is_expression(source: &[u8]) -> bool {
    match pieces_of(source, Options::MINIMATCH_3) {
        Ok(pieces) => nest(pieces).is_some(),
        Err(Unread::NotTaken) => true,
        Err(Unread::NoExpression) => false,
    }
}

/// `plTypes[kind].open`
fn open_of(kind: u8) -> &'static [u8] {
    match kind {
        b'!' => b"(?:(?!(?:",
        _ => b"(?:",
    }
}

/// `plTypes[kind].close`
fn close_of(kind: u8) -> &'static [u8] {
    match kind {
        b'!' => b"))[^/]*?)",
        b'?' => b")?",
        b'+' => b")+",
        b'*' => b")*",
        _ => b")",
    }
}

/// `tail.replace(/((?:\\{2}){0,64})(\\?)\|/g, ..)`
fn with_bars_as_characters(tail: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(tail.len() + 8);
    let mut run = 0_usize;
    for c in tail {
        if *c == b'|' {
            let taken = run.min(129);
            out.truncate(out.len() - taken);
            out.extend(std::iter::repeat_n(b'\\', 4 * (taken / 2) + 1));
        }
        out.push(*c);
        run = if *c == b'\\' { run + 1 } else { 0 };
    }
    out
}

/// An extglob that is open or has been closed: where in the text it starts, and ends.
struct List {
    kind: u8,
    re_start: usize,
    re_end: usize,
}

struct Parsed {
    re: Vec<u8>,
    has_magic: bool,
}

impl Parsed {
    /// What `sp[0]` and `sp[1]` are of what is no array.
    fn undefined() -> Parsed {
        Parsed {
            re: b"undefined".to_vec(),
            has_magic: false,
        }
    }
}

/// What `parse` is writing.
struct Writer {
    re: Vec<u8>,
    has_magic: bool,
    state_char: Option<u8>,
}

impl Writer {
    fn clear_state_char(&mut self) {
        match self.state_char.take() {
            Some(b'*') => {
                self.re.extend_from_slice(STAR);
                self.has_magic = true;
            }
            Some(b'?') => {
                self.re.extend_from_slice(QMARK);
                self.has_magic = true;
            }
            Some(c) => self.re.extend([b'\\', c]),
            None => {}
        }
    }
}

/// `Minimatch.prototype.parse`. `depth`: above 0 it is `SUBPARSE`. `None`: beyond a limit.
fn parse(pattern: &[u8], options: Options, depth: usize) -> Option<Parsed> {
    let pattern = match pattern {
        b"**" if options.noglobstar => &b"*"[..],
        _ => pattern,
    };
    let mut w = Writer {
        re: Vec::with_capacity(pattern.len() * 2),
        has_magic: options.nocase,
        state_char: None,
    };
    let mut escaping = false;
    // Where the class that is open starts, in the pattern and in the text.
    let mut class: Option<(usize, usize)> = None;
    let (mut lists, mut negative_lists): (Vec<List>, Vec<List>) = (Vec::new(), Vec::new());
    let sub = |cs: &[u8]| match cs {
        // `parse` gives `''` and `GLOBSTAR` for these. Neither has a `[0]`, and `'\\[' + undefined` is written.
        b"" => Some(Parsed::undefined()),
        b"**" if !options.noglobstar => Some(Parsed::undefined()),
        _ if depth < MAX_DEPTH => parse(cs, options, depth + 1),
        _ => None,
    };
    for (i, &c) in pattern.iter().enumerate() {
        if escaping && is_re_special(c) {
            w.re.extend([b'\\', c]);
            escaping = false;
            continue;
        }
        let is_first_in_class = class.is_some_and(|it| i == it.0 + 1);
        match c {
            b'\\' => {
                w.clear_state_char();
                escaping = true;
            }
            b'?' | b'*' | b'+' | b'@' | b'!' if class.is_some() => {
                w.re.push(if c == b'!' && is_first_in_class {
                    b'^'
                } else {
                    c
                });
            }
            b'*' if w.state_char == Some(b'*') => {}
            b'?' | b'*' | b'+' | b'@' | b'!' => {
                w.clear_state_char();
                w.state_char = Some(c);
                if options.noext {
                    w.clear_state_char();
                }
            }
            b'(' if class.is_some() => w.re.push(b'('),
            b'(' => match w.state_char.take() {
                None => w.re.extend_from_slice(b"\\("),
                Some(_) if lists.len() >= MAX_OPEN_LISTS => return None,
                Some(kind) => {
                    lists.push(List {
                        kind,
                        re_start: w.re.len(),
                        re_end: 0,
                    });
                    w.re.extend_from_slice(open_of(kind));
                }
            },
            b')' if class.is_some() => w.re.extend_from_slice(b"\\)"),
            b')' => match lists.pop() {
                None => w.re.extend_from_slice(b"\\)"),
                Some(list) => {
                    w.clear_state_char();
                    w.has_magic = true;
                    w.re.extend_from_slice(close_of(list.kind));
                    if list.kind == b'!' {
                        if negative_lists.len() >= MAX_NEGATIVE_LISTS {
                            return None;
                        }
                        let re_end = w.re.len();
                        negative_lists.push(List { re_end, ..list });
                    }
                }
            },
            b'|' if class.is_some() || lists.is_empty() || escaping => {
                w.re.extend_from_slice(b"\\|");
                escaping = false;
            }
            b'|' => {
                w.clear_state_char();
                w.re.push(b'|');
            }
            b'[' => {
                w.clear_state_char();
                match class {
                    Some(_) => w.re.extend_from_slice(b"\\["),
                    None => {
                        class = Some((i, w.re.len()));
                        w.re.push(b'[');
                    }
                }
            }
            b']' => match class.filter(|_| !is_first_in_class) {
                None => {
                    w.re.extend_from_slice(b"\\]");
                    escaping = false;
                }
                Some((class_start, re_class_start)) => {
                    class = None;
                    let cs = &pattern[class_start + 1..i];
                    if is_expression(&[b"[", cs, b"]"].concat()) {
                        w.has_magic = true;
                        w.re.push(b']');
                    } else {
                        let sp = sub(cs)?;
                        w.re.truncate(re_class_start);
                        w.re.extend_from_slice(&[b"\\[", &sp.re[..], b"\\]"].concat());
                        w.has_magic |= sp.has_magic;
                    }
                }
            },
            _ => {
                w.clear_state_char();
                if escaping {
                    escaping = false;
                } else if is_re_special(c) && !(c == b'^' && class.is_some()) {
                    w.re.push(b'\\');
                }
                w.re.push(c);
            }
        }
    }
    if let Some((class_start, re_class_start)) = class {
        let sp = sub(&pattern[class_start + 1..])?;
        w.re.truncate(re_class_start);
        w.re.extend_from_slice(b"\\[");
        w.re.extend_from_slice(&sp.re);
        w.has_magic |= sp.has_magic;
    }
    while let Some(list) = lists.pop() {
        let tail = with_bars_as_characters(&w.re[list.re_start + open_of(list.kind).len()..]);
        w.re.truncate(list.re_start);
        match list.kind {
            b'*' => w.re.extend_from_slice(STAR),
            b'?' => w.re.extend_from_slice(QMARK),
            kind => w.re.extend([b'\\', kind]),
        }
        w.re.extend_from_slice(b"\\(");
        w.re.extend_from_slice(&tail);
        w.has_magic = true;
    }
    w.clear_state_char();
    if escaping {
        w.re.extend_from_slice(b"\\\\");
    }
    let Writer {
        mut re, has_magic, ..
    } = w;
    let adds_pattern_start = matches!(re.first(), Some(b'[' | b'.' | b'('));
    for list in negative_lists.iter().rev() {
        // What has been cut since has moved the text under these places. `slice` takes what is there.
        let at = |place: usize| place.min(re.len());
        let (before, first) = re[..at(list.re_end - 8)].split_at(at(list.re_start));
        let last = &re[at(list.re_end - 8)..];
        let mut after = re[at(list.re_end)..].to_vec();
        for _ in 0..strings::count_char(before, b'(') {
            let Some(at) = strings::index_of_char_usize(&after, b')') else {
                break;
            };
            let has_quantifier = matches!(after.get(at + 1), Some(b'+' | b'*' | b'?'));
            after.drain(at..at + 1 + usize::from(has_quantifier));
        }
        let dollar: &[u8] = if after.is_empty() && depth == 0 {
            b"$"
        } else {
            b""
        };
        re = [before, first, &after, dollar, last].concat();
    }
    if !re.is_empty() && has_magic {
        re.splice(0..0, *b"(?=.)");
    }
    if adds_pattern_start {
        let pattern_start: &[u8] = match (pattern.first(), options.dot) {
            (Some(b'.'), _) => b"",
            (_, true) => br"(?!(?:^|\/)\.{1,2}(?:$|\/))",
            (_, false) => br"(?!\.)",
        };
        re.splice(0..0, pattern_start.iter().copied());
    }
    Some(Parsed { re, has_magic })
}

/// The bytes of `globUnescape(part)`.
fn each_character(part: &[u8], mut take: impl FnMut(u8)) {
    let mut rest = part;
    while let [c, after @ ..] = rest {
        let (c, after) = match (c, after) {
            (b'\\', [escaped, behind @ ..]) if !bun_core::lexer::starts_with_line_break(after) => {
                (escaped, behind)
            }
            _ => (c, after),
        };
        take(*c);
        rest = after;
    }
}

/// `regExpEscape(globUnescape(part))`, but for the `\` that change nothing.
fn write_characters(part: &[u8], re: &mut Vec<u8>) {
    each_character(part, |c| {
        if c == b'|' || c != b'!' && is_re_special(c) {
            re.push(b'\\');
        }
        re.push(c);
    });
}

/// `None`: `makeRe` gives `false`, or it is beyond a limit.
fn source(pattern: &[u8], options: Options) -> Option<Vec<u8>> {
    let dot = options.dot;
    let pattern = strings::trim_js_whitespace(pattern);
    let is_comment = pattern.starts_with(b"#") && !options.nocomment;
    if pattern.len() > MAX_PATTERN_LENGTH || pattern.is_empty() || is_comment {
        return None;
    }
    let bangs = (pattern.iter())
        .take_while(|it| **it == b'!' && !options.nonegate)
        .count();
    let rest = &pattern[bangs..];
    let globs = match has_braces(rest) && !options.nobrace {
        true => braces::expand(rest)?,
        false => vec![rest.to_vec()],
    };
    if globs.is_empty() {
        return None;
    }
    let mut re = b"^(?:".to_vec();
    for (index, glob) in globs.iter().enumerate() {
        if index > 0 {
            re.push(b'|');
        }
        // `split(/\/+/)`
        let mut names = strings::split(&glob[..], b"/").enumerate().peekable();
        let mut is_first = true;
        while let Some((at, part)) = names.next() {
            // An empty name in the middle is a second `/`.
            if part.is_empty() && at > 0 && names.peek().is_some() {
                continue;
            }
            if !std::mem::take(&mut is_first) {
                re.extend_from_slice(b"\\/");
            }
            if part == b"**" && !options.noglobstar {
                re.extend_from_slice(if dot { TWO_STAR_DOT } else { TWO_STAR_NO_DOT });
                continue;
            }
            // `if (pattern === '') return ''`
            if part.is_empty() {
                continue;
            }
            let parsed = parse(part, options, 0)?;
            // What `RegExp` refuses is `/$./`, which has no `_src`: nothing is written.
            if !parsed.has_magic {
                write_characters(part, &mut re);
            } else if is_expression(&[b"^", &parsed.re[..], b"$"].concat()) {
                re.extend_from_slice(&parsed.re);
            }
        }
    }
    re.extend_from_slice(b")$");
    Some(match bangs % 2 {
        1 => [b"^(?!", &re[..], b").*$"].concat(),
        _ => re,
    })
}

/// `None`: `RegExp` refuses it.
fn program_of(written: &[u8], options: Options) -> Option<Program> {
    let tree = match pieces_of(written, options) {
        Ok(pieces) => nest(pieces),
        Err(Unread::NotTaken) => Some(Node::Fail),
        Err(Unread::NoExpression) => None,
    };
    tree.map(|it| lower(it, text_of(options)))
}

pub(crate) fn pattern(bytes: &[u8], options: Options) -> Program {
    let program = source(bytes, options).and_then(|it| program_of(&it, options));
    program.unwrap_or(Program::Never)
}

/// What `make` makes of a name, for `match`.
pub(crate) fn part(name: &[u8], options: Options) -> Part {
    if name == b"**" && !options.noglobstar {
        return Part::GlobStar;
    }
    // `if (pattern === '') return ''`
    if name.is_empty() {
        return Part::Literal(Box::default());
    }
    match parse(name, options, 0) {
        None => Part::Never,
        Some(parsed) if !parsed.has_magic => {
            let mut characters = Vec::with_capacity(name.len());
            each_character(name, |c| characters.push(c));
            Part::Literal(characters.into())
        }
        // What `RegExp` refuses is `/$./`.
        Some(parsed) => program_of(&[b"^", &parsed.re[..], b"$"].concat(), options)
            .map_or(Part::Never, Part::Name),
    }
}
