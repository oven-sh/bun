//! A line of an ignore file becomes a tree: three grammars for five flavours. It never sees a path.

use crate::class::{self, Class, Escape, Read};
use crate::ignore::{IgnoreOptions, IgnoreSyntax};
use crate::node::{Assertion, MAX_NESTING, Node, Program, lower, simplify};
use crate::unit::{Subject, Text, Unit, push_utf8};
use bun_core::strings;

pub(crate) struct Line {
    pub(crate) node: Node,
    pub(crate) is_negated: bool,
    /// The tree is for the path without a `/` behind it.
    pub(crate) is_for_directories: bool,
}

const CODE_POINTS: Text = Text {
    unit: Unit::CodePoint,
    folds: false,
};

pub(crate) fn text_for(options: IgnoreOptions) -> Text {
    Text {
        unit: match options.syntax {
            IgnoreSyntax::Git | IgnoreSyntax::Globset => Unit::Byte,
            _ => Unit::Utf16,
        },
        folds: options.ignores_case,
    }
}

/// `Ok(None)`: the line says nothing: a comment, blank. `Err`: `Globset` does not take it, and why.
pub(crate) fn line(bytes: &[u8], options: IgnoreOptions) -> Result<Option<Line>, Vec<u8>> {
    match options.syntax {
        IgnoreSyntax::Globset => globset_line(bytes, options.ignores_case),
        IgnoreSyntax::Git | IgnoreSyntax::Npm7012 => Ok(wildmatch_line(bytes, options)),
        IgnoreSyntax::Npm5 | IgnoreSyntax::Npm705 => Ok(legacy_line(bytes, options)),
    }
}

fn has_at(bytes: &[u8], at: usize, text: &[u8]) -> bool {
    bytes.get(at..).is_some_and(|rest| rest.starts_with(text))
}

fn slash() -> Node {
    Node::Lit(vec![b'/'])
}

/// `(?:^|\/)`, `(?:/?|.*/)`: any names.
const ANY_NAMES: Node = Node::Deep {
    empty_names: true,
    newlines: true,
};

/// `(?:[^/]+\/)*`: names that are not empty.
const FULL_NAMES: Node = Node::Deep {
    empty_names: false,
    newlines: true,
};

fn to_the_end(min: u8, newlines: bool) -> Node {
    Node::Rest { min, newlines }
}

/// `.*`, over line terminators too.
fn anything() -> Node {
    Node::repeat(Node::Dot { newlines: true }, 0, true)
}

// ───────────────────────────── globset: `GitignoreBuilder::add_line` of `ignore` 0.4.33, `Parser` of globset 0.4.18 ─────────────────────────────

fn globset_line(mut line: &[u8], folds: bool) -> Result<Option<Line>, Vec<u8>> {
    if line.starts_with(b"#") {
        return Ok(None);
    }
    if !line.ends_with(b"\\ ") {
        line = bun_core::strings::trim_unicode_whitespace_end(line);
    }
    if line.is_empty() {
        return Ok(None);
    }
    let (mut is_negated, mut is_absolute, mut is_for_directories) = (false, false, false);
    if line.starts_with(b"\\!") || line.starts_with(b"\\#") {
        line = &line[1..];
    } else {
        if let Some(rest) = line.strip_prefix(b"!") {
            is_negated = true;
            line = rest;
        }
        if let Some(rest) = line.strip_prefix(b"/") {
            is_absolute = true;
            line = rest;
        }
    }
    if let Some(rest) = line.strip_suffix(b"/") {
        is_for_directories = true;
        line = rest.strip_suffix(b"\\").unwrap_or(rest);
    }
    let is_for_names = !is_absolute && !strings::contains_char(line, b'/');
    let mut actual = Vec::with_capacity(line.len() + 5);
    if is_for_names && !line.starts_with(b"**/") && line != b"**" {
        actual.extend_from_slice(b"**/");
    }
    actual.extend_from_slice(line);
    // What is in a directory, and not the directory.
    if actual.ends_with(b"/**") {
        actual.extend_from_slice(b"/*");
    }
    Ok(Some(Line {
        node: globset_glob(&actual, Builder::OfIgnore { folds })?,
        is_negated,
        is_for_directories,
    }))
}

/// `Token` of globset, as nodes at once. The three of `**` are kept apart, because `parse_star` looks back at them.
enum Token {
    Node(Node),
    /// `(?:/?|.*/)`
    RecursivePrefix,
    /// `/.*`
    RecursiveSuffix,
    /// `(?:/|/.*/)`
    RecursiveZeroOrMore,
}

/// How deep `{` can be nested. globset has no such limit.
const MAX_ALTERNATES: usize = MAX_NESTING / 2;

fn nodes_of_globset(tokens: Vec<Token>) -> Node {
    let mut nodes = Vec::with_capacity(tokens.len());
    for token in tokens {
        match token {
            Token::Node(node) => nodes.push(node),
            Token::RecursivePrefix => nodes.push(ANY_NAMES),
            Token::RecursiveSuffix => nodes.extend([slash(), anything()]),
            Token::RecursiveZeroOrMore => nodes.extend([slash(), ANY_NAMES]),
        }
    }
    Node::Seq(nodes)
}

/// `Parser` of globset: where it is in the pattern.
struct Chars<'g> {
    glob: &'g [u8],
    at: usize,
    prev: Option<u32>,
    cur: Option<u32>,
}

impl Chars<'_> {
    fn peek(&self) -> Option<u32> {
        Some(CODE_POINTS.next(Subject::of(self.glob), self.at)?.0)
    }

    fn bump(&mut self) -> Option<u32> {
        self.prev = self.cur;
        let next = CODE_POINTS.next(Subject::of(self.glob), self.at);
        self.at += next.map_or(0, |it| it.1);
        self.cur = next.map(|it| it.0);
        self.cur
    }
}

fn character(c: u32) -> Token {
    let mut bytes = Vec::with_capacity(4);
    push_utf8(&mut bytes, c);
    Token::Node(Node::Lit(bytes))
}

/// How `GlobBuilder` is set.
#[derive(Copy, Clone, PartialEq)]
enum Builder {
    /// `.literal_separator(true).backslash_escape(true).allow_unclosed_class(true)`
    OfIgnore { folds: bool },
    /// `Glob::new`: `*`, `?` take a `/`, a class that is not closed is refused.
    Default,
}

/// `Glob::new(glob).ok().map(|it| it.compile_matcher())`
pub(crate) fn globset_matcher(glob: &[u8]) -> Option<Program> {
    let text = Text {
        unit: Unit::Byte,
        folds: false,
    };
    Some(lower(globset_glob(glob, Builder::Default).ok()?, text))
}

fn globset_glob(glob: &[u8], builder: Builder) -> Result<Node, Vec<u8>> {
    let is_default = builder == Builder::Default;
    let folds = builder == Builder::OfIgnore { folds: true };
    const SLASH: Option<u32> = Some(b'/' as u32);
    const STAR: Option<u32> = Some(b'*' as u32);
    const COMMA: Option<u32> = Some(b',' as u32);
    const OPEN: Option<u32> = Some(b'{' as u32);
    const CLOSE: Option<u32> = Some(b'}' as u32);
    let star = || {
        Token::Node(match is_default {
            true => anything(),
            false => Node::Star,
        })
    };
    // The lists of tokens that are closed, and the one that is being written. `alternates`: where in `branches` each open group starts.
    let mut branches: Vec<Vec<Token>> = Vec::new();
    let mut branch: Vec<Token> = Vec::new();
    let mut alternates: Vec<usize> = Vec::new();
    let mut found_unclosed_class = false;
    let mut chars = Chars {
        glob,
        at: 0,
        prev: None,
        cur: None,
    };
    loop {
        let start = chars.at;
        let Some(c) = chars.bump() else {
            break;
        };
        match u8::try_from(c).unwrap_or(0) {
            b'?' if is_default => branch.push(Token::Node(Node::Dot { newlines: true })),
            b'?' => branch.push(Token::Node(Node::Any)),
            b'*' => {
                let before = chars.prev;
                if chars.peek() != STAR {
                    branch.push(star());
                    continue;
                }
                chars.bump();
                let after = chars.peek();
                let is_in_group = !branches.is_empty();
                if branch.is_empty() {
                    if after.is_some() && after != SLASH {
                        branch.push(star());
                    } else {
                        branch.push(Token::RecursivePrefix);
                        chars.bump();
                    }
                    continue;
                }
                if before != SLASH && !(is_in_group && (before == COMMA || before == OPEN)) {
                    branch.push(star());
                    continue;
                }
                let is_suffix = if after.is_none() || after == SLASH {
                    chars.bump();
                    after.is_none()
                } else if is_in_group && (after == COMMA || after == CLOSE) {
                    true
                } else {
                    branch.push(star());
                    continue;
                };
                // The `/` before it, or a `**` of which this is one more.
                let last = branch.pop();
                branch.push(match last {
                    Some(it @ (Token::RecursivePrefix | Token::RecursiveSuffix)) => it,
                    _ if is_suffix => Token::RecursiveSuffix,
                    _ => Token::RecursiveZeroOrMore,
                });
            }
            // No `]` follows the first one that is not closed, so none follows this one.
            b'[' if found_unclosed_class => branch.push(character(c)),
            b'[' => match class::globset(glob, start, folds)? {
                Read::Class { class, len, .. } => {
                    branch.push(Token::Node(Node::Class(class)));
                    // As `bump` leaves them behind the `]`.
                    chars.at = start + len;
                    chars.prev = None;
                    chars.cur = Some(u32::from(b']'));
                }
                Read::Never => return Ok(Node::Fail),
                Read::NotAClass | Read::One { .. } if is_default => {
                    return Err(b"unclosed character class; missing ']'".to_vec());
                }
                Read::NotAClass | Read::One { .. } => {
                    found_unclosed_class = true;
                    branch.push(character(c));
                }
            },
            b'{' => {
                if alternates.len() >= MAX_ALTERNATES {
                    return Ok(Node::Fail);
                }
                branches.push(std::mem::take(&mut branch));
                alternates.push(branches.len());
            }
            b'}' => {
                let Some(first) = alternates.pop() else {
                    return Err(
                        b"unopened alternate group; missing '{' (maybe escape '}' with '[}]'?)"
                            .to_vec(),
                    );
                };
                branches.push(std::mem::take(&mut branch));
                // An alternative that is written as nothing is dropped: `empty_alternates` is off.
                let group = branches.split_off(first).into_iter();
                let nodes: Vec<Node> = group
                    .map(|it| simplify(nodes_of_globset(it)))
                    .filter(|it| !matches!(it, Node::Empty))
                    .collect();
                branch = branches.pop().unwrap_or_default();
                branch.push(Token::Node(match nodes.is_empty() {
                    true => Node::Empty,
                    false => Node::Alt(nodes),
                }));
            }
            b',' if !alternates.is_empty() => branches.push(std::mem::take(&mut branch)),
            b'\\' => match chars.bump() {
                Some(escaped) => branch.push(character(escaped)),
                None => return Err(b"dangling '\\'".to_vec()),
            },
            _ => branch.push(character(c)),
        }
    }
    if !branches.is_empty() {
        return Err(
            b"unclosed alternate group; missing '}' (maybe escape '{' with '[{]'?)".to_vec(),
        );
    }
    // The whole of it is `**`: everything.
    if matches!(branch[..], [Token::RecursivePrefix]) {
        return Ok(to_the_end(0, true));
    }
    Ok(Node::Seq(vec![
        nodes_of_globset(branch),
        Node::Assert(Assertion::End),
    ]))
}

// ───────────────────────────── what all three versions of the package leak ─────────────────────────────

/// `$.|*+(){^`
fn is_leakable(c: u8) -> bool {
    matches!(
        c,
        b'$' | b'.' | b'|' | b'*' | b'+' | b'(' | b')' | b'{' | b'^'
    )
}

/// Behind a `\\` the package writes one of `$ . | * + ( ) { ^` as it is: `a\\*b` is `a`, any number of `\`, `b`. `false`: it throws.
fn write_leaked(alternatives: &mut Vec<Node>, nodes: &mut Vec<Node>, c: u8) -> bool {
    match c {
        b'*' | b'+' => match nodes.pop() {
            Some(last @ (Node::Lit(_) | Node::Class(_))) => {
                nodes.push(Node::repeat(last, u8::from(c == b'+'), true));
            }
            _ => return false,
        },
        b'.' => nodes.push(Node::Dot { newlines: false }),
        b'$' => nodes.push(Node::Assert(Assertion::End)),
        b'^' => nodes.push(Node::Assert(Assertion::Start)),
        b'{' => nodes.push(Node::Lit(vec![c])),
        b'|' => {
            alternatives.push(Node::Seq(std::mem::take(nodes)));
            // What is behind it need not start at the start.
            nodes.push(anything());
        }
        _ => return false,
    }
    true
}

fn with_alternatives(mut alternatives: Vec<Node>, nodes: Vec<Node>) -> Node {
    if alternatives.is_empty() {
        return Node::Seq(nodes);
    }
    alternatives.push(Node::Seq(nodes));
    Node::Alt(alternatives)
}

// ───────────────────────────── wildmatch: git, npm `ignore` 7.0.12 ─────────────────────────────

fn trailing(bytes: &[u8], byte: u8) -> usize {
    bytes.iter().rev().take_while(|it| **it == byte).count()
}

/// `trim_trailing_spaces` of git, `trimEnd` of the package: blanks at the end go, unless a `\` is before the first of them.
fn trim_blanks(mut body: &[u8], is_git: bool) -> &[u8] {
    if !is_git {
        while let [rest @ .., b'\r' | b'\n'] = body {
            body = rest;
        }
    }
    let end = body.len() - trailing(body, b' ');
    // `\ ` stays, as the two that it is: it is read as a blank below.
    let is_escaped = end < body.len() && trailing(&body[..end], b'\\') % 2 == 1;
    &body[..end + usize::from(is_escaped)]
}

fn wildmatch_line(line: &[u8], options: IgnoreOptions) -> Option<Line> {
    let is_git = options.syntax == IgnoreSyntax::Git;
    let text = text_for(options);
    let mut body = line;
    if !is_git {
        // `/(?:[^\\]|^)\\$/`
        if body.ends_with(b"\\") && !body.ends_with(b"\\\\") {
            return None;
        }
        body = body.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(body);
    }
    if body.is_empty() || body.starts_with(b"#") {
        return None;
    }
    let is_negated = body.starts_with(b"!");
    body = trim_blanks(&body[usize::from(is_negated)..], is_git);
    if body.is_empty() {
        return None;
    }
    let mut is_for_directories = false;
    let line_of = |node: Node, is_for_directories: bool| {
        Some(Line {
            node,
            is_negated,
            is_for_directories,
        })
    };
    // A `/` that is not the last character ties the pattern to the directory of the file. It counts wherever it stands.
    let is_anchored =
        strings::index_of_char_usize(body, b'/').is_some_and(|it| it == 0 || it + 1 < body.len());
    if !is_git {
        // The package: nothing but `**/`, any number of times, behind a `/` or not: every directory.
        let mut at = usize::from(body.starts_with(b"/"));
        while has_at(body, at, b"**/") {
            at += 3;
        }
        if at == body.len() && at > 1 {
            let end = Node::Assert(Assertion::EndOrFinalSlash);
            return line_of(Node::Seq(vec![ANY_NAMES, end]), false);
        }
    }
    if let [rest @ .., b'/'] = body
        && !rest.is_empty()
    {
        // The package: `\/` at the end matches nothing.
        if !is_git && trailing(rest, b'\\') % 2 == 1 {
            return line_of(Node::Fail, false);
        }
        is_for_directories = true;
        body = rest;
    }
    let (mut nodes, mut alternatives): (Vec<Node>, Vec<Node>) = (Vec::new(), Vec::new());
    let mut i = usize::from(body.starts_with(b"/"));
    let is_slash_or_end = |at: usize| matches!(body.get(at), None | Some(b'/'));
    // `**/` at the start, any number of times.
    let mut has_deep = false;
    while (is_anchored || !is_git) && has_at(body, i, b"**/") {
        i += 3;
        has_deep = true;
    }
    if has_deep {
        nodes.push(Node::Deep {
            empty_names: true,
            newlines: is_git,
        });
    } else if !is_anchored {
        nodes.push(ANY_NAMES);
    }
    // git compares what is before the first of `*?[\` as characters. To `wildmatch` a `**` at the start of the rest is a whole name.
    let first_special = (is_git && is_anchored && !has_deep).then(|| {
        let rest = body.get(i..).unwrap_or_default();
        i + strings::index_of_any(rest, b"*?[\\").unwrap_or(rest.len())
    });
    // The last thing read is a `/` that is written as one.
    let mut is_behind_slash = false;
    while let Some(&c) = body.get(i) {
        let was_behind_slash = std::mem::replace(&mut is_behind_slash, false);
        match c {
            b'\\' => {
                let Some((_, len)) = CODE_POINTS.next(Subject::of(body), i + 1) else {
                    return line_of(Node::Fail, is_for_directories);
                };
                let escaped = body.get(i + 1..i + 1 + len).unwrap_or_default();
                nodes.push(Node::Lit(escaped.to_vec()));
                // git looks at the byte before a `**`, escaped or not. So does the package before a `*` that is the last name.
                is_behind_slash = escaped == b"/";
                i += 1 + len;
                // The leak. A `*` that is the last character is spared.
                if !is_git
                    && escaped == b"\\"
                    && let Some(&leaked) = body.get(i)
                    && is_leakable(leaked)
                    && !(leaked == b'*' && i + 1 == body.len() && !is_for_directories)
                {
                    if !write_leaked(&mut alternatives, &mut nodes, leaked) {
                        return line_of(Node::Fail, is_for_directories);
                    }
                    i += 1;
                }
            }
            b'?' => {
                nodes.push(Node::Any);
                i += 1;
            }
            b'[' => match class::wildmatch(body, i, text) {
                Read::Class { class, len, .. } => {
                    nodes.push(Node::Class(class));
                    i += len;
                }
                _ => return line_of(Node::Fail, is_for_directories),
            },
            // The package: `/**` that is a whole name, any number of times.
            b'/' if !is_git && is_anchored && has_at(body, i, b"/**") && is_slash_or_end(i + 3) => {
                let mut groups = 0;
                while has_at(body, i, b"/**") && is_slash_or_end(i + 3) {
                    i += 3;
                    groups += 1;
                }
                nodes.push(slash());
                if i < body.len() {
                    nodes.push(FULL_NAMES);
                    i += 1;
                    is_behind_slash = true;
                } else if is_for_directories {
                    // `a/**/`: the directories in it, at any depth.
                    nodes.extend([FULL_NAMES, Node::Plus]);
                } else {
                    if groups > 1 {
                        nodes.push(FULL_NAMES);
                    }
                    nodes.push(to_the_end(1, false));
                }
            }
            b'*' => {
                let stars = body[i..].iter().take_while(|it| **it == b'*').count();
                let is_whole_name_of_git = is_git
                    && is_anchored
                    && (first_special == Some(i) || was_behind_slash)
                    && stars >= 2;
                i += stars;
                if is_whole_name_of_git && has_at(body, i, b"\\/") {
                    // Before `\/` it is a whole name too, but one that cannot be left out with its `/`.
                    nodes.push(anything());
                } else if is_whole_name_of_git && i == body.len() {
                    nodes.push(to_the_end(0, true));
                    return line_of(Node::Seq(nodes), is_for_directories);
                } else if is_whole_name_of_git && is_slash_or_end(i) {
                    nodes.push(ANY_NAMES);
                    i += 1;
                    is_behind_slash = true;
                } else {
                    // The package: a `*` that is the last name, all of it, takes something.
                    let is_last_name = !is_git
                        && !is_for_directories
                        && stars == 1
                        && i == body.len()
                        && was_behind_slash;
                    nodes.push(if is_last_name { Node::Plus } else { Node::Star });
                }
            }
            _ => {
                nodes.push(Node::Lit(vec![c]));
                is_behind_slash = c == b'/';
                i += 1;
            }
        }
    }
    nodes.push(Node::Assert(match is_for_directories || is_git {
        true => Assertion::End,
        false => Assertion::EndOrFinalSlash,
    }));
    line_of(with_alternatives(alternatives, nodes), is_for_directories)
}

// ───────────────────────────── legacy: npm `ignore` 5.3.2 and 7.0.5 ─────────────────────────────

fn chars_of(bytes: &[u8]) -> Vec<char> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while let Some((c, len)) = CODE_POINTS.next(Subject::of(bytes), at) {
        out.push(char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER));
        at += len;
    }
    out
}

fn legacy_line(line: &[u8], options: IgnoreOptions) -> Option<Line> {
    let chars = chars_of(line);
    if chars
        .iter()
        .all(|c| bun_core::strings::is_js_whitespace(*c as u32))
        || chars.first() == Some(&'#')
    {
        return None;
    }
    // `/(?:[^\\]|^)\\$/`
    if chars.ends_with(&['\\']) && !chars.ends_with(&['\\', '\\']) {
        return None;
    }
    let (is_negated, body) = match &chars[..] {
        ['!', rest @ ..] => (true, rest),
        all => (false, all),
    };
    let body = match body {
        ['\\', rest @ ..] if matches!(rest, ['!' | '#', ..]) => rest,
        _ => body,
    };
    let mut source = Vec::with_capacity(body.len() * 2);
    for c in legacy_source(body, options.syntax) {
        source.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
    }
    Some(Line {
        node: legacy_node(&source, options.ignores_case),
        is_negated,
        is_for_directories: false,
    })
}

fn chars_at(s: &[char], at: usize, literal: &str) -> bool {
    let mut rest = s.get(at..).unwrap_or_default().iter();
    literal.chars().all(|c| rest.next() == Some(&c))
}

/// The number of `\` that `s` starts with.
fn leading_backslashes(s: &[char]) -> usize {
    s.iter().take_while(|c| **c == '\\').count()
}

/// The number of `\` that `s` ends with.
fn trailing_backslashes(s: &[char]) -> usize {
    s.iter().rev().take_while(|c| **c == '\\').count()
}

/// `$.|*+(){^`
fn is_meta(c: char) -> bool {
    matches!(c, '$' | '.' | '|' | '*' | '+' | '(' | ')' | '{' | '^')
}

/// `sanitizeRange`: without the `b-a` that an expression is refused for.
fn sanitize_range(range: &[char]) -> Vec<char> {
    let is_bound = |c: Option<&char>| c.is_some_and(|c| ('0'..='z').contains(c));
    let mut out = Vec::with_capacity(range.len());
    let mut i = 0;
    while i < range.len() {
        if is_bound(range.get(i)) && range.get(i + 1) == Some(&'-') && is_bound(range.get(i + 2)) {
            if range[i] <= range[i + 2] {
                out.extend_from_slice(&range[i..i + 3]);
            }
            i += 3;
        } else {
            out.push(range[i]);
            i += 1;
        }
    }
    out
}

/// `makeRegex(pattern).source`: the `REPLACERS` in their order. Later steps see what earlier steps wrote.
fn legacy_source(pattern: &[char], syntax: IgnoreSyntax) -> Vec<char> {
    let mut s = pattern
        .strip_prefix(&['\u{FEFF}'])
        .unwrap_or(pattern)
        .to_vec();

    // Trailing spaces are ignored unless they are quoted with a backslash.
    let end = s.len()
        - s.iter()
            .rev()
            .take_while(|c| bun_core::strings::is_js_whitespace(**c as u32))
            .count();
    if end < s.len() {
        s.truncate(end);
        if trailing_backslashes(&s) % 2 == 1 {
            s.pop();
            s.push(' ');
        }
    }

    // `\ ` is a space.
    let mut out = Vec::with_capacity(s.len() * 2);
    let mut i = 0;
    while i < s.len() {
        let backslashes = leading_backslashes(&s[i..]);
        if backslashes == 0 {
            out.push(s[i]);
            i += 1;
            continue;
        }
        i += backslashes;
        let is_before_space = s
            .get(i)
            .is_some_and(|c| bun_core::strings::is_js_whitespace(*c as u32));
        let kept = if is_before_space {
            backslashes - backslashes % 2
        } else {
            backslashes
        };
        out.extend(std::iter::repeat_n('\\', kept));
        if is_before_space {
            out.push(' ');
            i += 1;
        }
    }
    s = out;

    // Metacharacters are escaped, `?` is any character of a name, a leading `/` is the start.
    let mut out = Vec::with_capacity(s.len() * 2);
    for (i, &c) in s.iter().enumerate() {
        match c {
            '\\' => out.extend(['\\', c]),
            c if is_meta(c) => out.extend(['\\', c]),
            '?' => out.extend("[^\\/]".chars()),
            '/' if i == 0 => out.push('^'),
            '/' => out.extend(['\\', '/']),
            _ => out.push(c),
        }
    }
    s = out;

    // A leading `**/` is any directory.
    let carets = s.iter().take_while(|c| **c == '^').count();
    if chars_at(&s, carets, "\\*\\*\\/") {
        s.splice(..carets + 6, "^(?:.*\\/)?".chars());
    }

    // A pattern with a `/` that is not its last character is relative to the root.
    if s.first().is_some_and(|c| *c != '^') {
        let has_inner_slash = pattern.iter().rev().skip(1).any(|c| *c == '/');
        let start = if has_inner_slash { "^" } else { "(?:^|\\/)" };
        s.splice(..0, start.chars());
    }

    // `/**/` is any number of directories, a trailing `/**` everything inside.
    let mut out = Vec::with_capacity(s.len() * 2);
    let mut i = 0;
    while i < s.len() {
        if chars_at(&s, i, "\\/\\*\\*") && (i + 6 == s.len() || chars_at(&s, i + 6, "\\/")) {
            out.extend(
                if i + 6 < s.len() {
                    "(?:\\/[^\\/]+)*"
                } else {
                    "\\/.+"
                }
                .chars(),
            );
            i += 6;
        } else {
            out.push(s[i]);
            i += 1;
        }
    }
    s = out;

    // Other `*` that are neither escaped nor the last character: anything but a `/`.
    let end_of_stars = |at: usize| {
        let mut count = 0;
        while chars_at(&s, at + 2 * count, "\\*") {
            count += 1;
        }
        let mut ends = (1..=count).rev().map(|n| at + 2 * n);
        ends.find(|&end| {
            s.get(end)
                .is_some_and(|c| !bun_core::strings::is_js_line_terminator(u32::from(*c)))
        })
    };
    let mut out = Vec::with_capacity(s.len() * 2);
    let (mut copied, mut i) = (0, 0);
    while i < s.len() {
        let mut stars = i;
        let mut end = if i == 0 { end_of_stars(0) } else { None };
        if end.is_none() {
            stars += s[i..].iter().take_while(|c| **c != '\\').count();
            if stars > i {
                end = end_of_stars(stars);
            }
        }
        match end {
            Some(end) => {
                out.extend_from_slice(&s[copied..stars]);
                out.extend("[^\\/]*".chars());
                copied = end;
                i = end;
            }
            None => i = stars.max(i + 1),
        }
    }
    out.extend_from_slice(&s[copied..]);
    s = out;

    // What the pattern itself escapes was escaped twice.
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let is_escaped_twice =
            chars_at(&s, i, "\\\\\\") && s.get(i + 3).is_some_and(|c| is_meta(*c));
        out.push(s[i]);
        i += if is_escaped_twice { 3 } else { 1 };
    }
    s = out;
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        out.push(s[i]);
        i += if chars_at(&s, i, "\\\\") { 2 } else { 1 };
    }
    s = out;

    // `[a-z]`
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    // The first `]` or `/` from where it was last looked for.
    let mut close = 0;
    while i < s.len() {
        let is_escaped = s[i] == '\\' && s.get(i + 1) == Some(&'[');
        let inside = i + usize::from(is_escaped) + 1;
        if s.get(inside - 1) == Some(&'[') && close < inside {
            let rest = s.get(inside..).unwrap_or_default().iter();
            close = inside + rest.take_while(|c| !matches!(**c, ']' | '/')).count();
        }
        if s.get(inside - 1) != Some(&'[') || s.get(close) == Some(&'/') {
            out.push(s[i]);
            i += 1;
            continue;
        }
        let escapes = trailing_backslashes(&s[inside..close]);
        let range = &s[inside..close - escapes];
        let is_closed = close < s.len();
        if is_escaped {
            out.extend(['\\', '[']);
            out.extend_from_slice(range);
            out.extend(std::iter::repeat_n('\\', escapes - escapes % 2));
            if is_closed {
                out.push(']');
            }
        } else if is_closed && escapes.is_multiple_of(2) {
            out.push('[');
            out.extend(sanitize_range(range));
            out.extend(std::iter::repeat_n('\\', escapes));
            out.push(']');
        } else {
            out.extend(['[', ']']);
        }
        i = close + usize::from(is_closed);
    }
    s = out;

    // `a` matches `a` and `a/`, `a/` only the latter.
    match s.last().copied() {
        None | Some('*') => {}
        Some('/') => s.push('$'),
        Some(_) => s.extend("(?=$|\\/$)".chars()),
    }

    // A trailing `*`
    if s.ends_with(&['\\', '*']) {
        s.truncate(s.len() - 2);
        let is_whole_name =
            s.ends_with(&['\\', '/']) || syntax == IgnoreSyntax::Npm5 && s.last() == Some(&'^');
        s.extend(if is_whole_name { "[^/]+" } else { "[^/]*" }.chars());
        s.extend("(?=$|\\/$)".chars());
    }
    s
}

/// What the chain has written, read by a closed list: its own pieces, an escape, a class, a character. `Fail`: none of these.
fn legacy_node(s: &[u8], folds: bool) -> Node {
    const NAMES: &[u8] = b"(?:\\/[^\\/]+)*";
    /// What the chain writes, and what it is.
    const PIECES: [(&[u8], fn() -> Node); 9] = [
        (b".+", || to_the_end(1, false)),
        (b"[^\\/]*", || Node::Star),
        (b"[^\\/]", || Node::Any),
        (b"[^/]+", || Node::Plus),
        (b"[^/]*", || Node::Star),
        (b"[^/]", || Node::Any),
        (b"(?=$|\\/$)", || Node::Assert(Assertion::EndOrFinalSlash)),
        (b"$", || Node::Assert(Assertion::End)),
        (b"\\/", slash),
    ];
    let (mut nodes, mut alternatives) = (Vec::new(), Vec::new());
    // `!` alone, or with blanks: the empty expression, which finds something in every text.
    if s.is_empty() {
        return Node::Empty;
    }
    let mut i = if s.starts_with(b"(?:^|\\/)") {
        nodes.push(ANY_NAMES);
        8
    } else if s.starts_with(b"^(?:.*\\/)?") {
        nodes.push(Node::Deep {
            empty_names: true,
            newlines: false,
        });
        10
    } else if s.starts_with(b"^") {
        1
    } else {
        return Node::Fail;
    };
    while let Some(&byte) = s.get(i) {
        if has_at(s, i, NAMES) {
            while has_at(s, i, NAMES) {
                i += NAMES.len();
            }
            // `a(?:/n)*/b` is `a/(?:n/)*b`: a `**` stands where a name starts.
            if has_at(s, i, b"\\/") {
                nodes.extend([slash(), FULL_NAMES]);
                i += 2;
            } else {
                nodes.push(Node::repeat(Node::Seq(vec![slash(), Node::Plus]), 0, true));
            }
            continue;
        }
        if let Some((piece, node)) = PIECES.iter().find(|it| has_at(s, i, it.0)) {
            nodes.push(node());
            i += piece.len();
            continue;
        }
        match byte {
            b'[' => {
                let Read::Class { class, len, .. } = class::javascript(s, i, folds) else {
                    return Node::Fail;
                };
                i += len;
                // `[a*`, `[a/*` of a pattern: a `*` or a `+` can follow. It is read below.
                nodes.push(Node::Class(class));
            }
            b'\\' if i + 1 < s.len() => match class::javascript_escape(s, i, false) {
                // A half of a pair stays with its other half.
                Escape::Unit { unit, len } if (0xD800..=0xDFFF).contains(&unit) => {
                    nodes.push(Node::Lit(
                        s.get(i + 1..i + len).unwrap_or_default().to_vec(),
                    ));
                    i += len;
                }
                // There is no group to refer to.
                Escape::Unit { unit, len } | Escape::Reference { unit, len, .. } => {
                    nodes.push(Node::of_unit(unit));
                    i += len;
                }
                Escape::Ranges(ranges) => {
                    nodes.push(Node::Class(Class::of_ranges(ranges, folds)));
                    i += 2;
                }
                Escape::WordBoundary { negated } => {
                    nodes.push(Node::Assert(match negated {
                        true => Assertion::NotWordBoundary,
                        false => Assertion::WordBoundary,
                    }));
                    i += 2;
                }
                Escape::Backslash => {
                    nodes.push(Node::Lit(vec![b'\\']));
                    i += 1;
                }
            },
            _ if is_leakable(byte) => {
                if !write_leaked(&mut alternatives, &mut nodes, byte) {
                    return Node::Fail;
                }
                i += 1;
            }
            b'?' | b'\\' => return Node::Fail,
            _ => {
                nodes.push(Node::Lit(vec![byte]));
                i += 1;
            }
        }
    }
    with_alternatives(alternatives, nodes)
}
