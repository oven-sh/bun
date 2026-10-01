//! The one re-scan of source text: Bun's lexer seated at an offset, told by the tree where a regular expression or JSX is.

use bun_ast::lexer_tables::T;
use bun_ast::walk::{self, Visitor};
use bun_ast::{Binding, E, Expr, Loc, Log, Source, Stmt};
use bun_core::{StackCheck, strings};
use bun_js_parser::lexer::Lexer;

/// A regular expression or a JSX element: one token for every reader.
#[derive(Clone, Copy)]
pub(crate) struct Span {
    start: u32,
    end: u32,
}

#[derive(Clone, Copy)]
pub(crate) struct Token {
    pub(crate) t: T,
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// A span or a piece of template text: its bytes are what it is.
    pub(crate) opaque: bool,
}

/// The spans under `roots`, sorted. `None`: the tree is too deep to walk, or a JSX element has no end in the text.
pub(crate) fn spans_under(
    source: &[u8],
    roots: &[&Expr],
    stack_check: StackCheck,
) -> Option<Vec<Span>> {
    let mut collector = Collector {
        source,
        spans: Vec::new(),
        stack_check,
        cut: false,
    };
    for root in roots {
        collector.visit_expr(root);
    }
    collector.finish()
}

/// The spans under `stmts`, sorted. `None` as for [`spans_under`].
pub(crate) fn spans_under_stmts(
    source: &[u8],
    stmts: &[Stmt],
    stack_check: StackCheck,
) -> Option<Vec<Span>> {
    let mut collector = Collector {
        source,
        spans: Vec::new(),
        stack_check,
        cut: false,
    };
    for stmt in stmts {
        collector.visit_stmt(stmt);
    }
    collector.finish()
}

struct Collector<'s> {
    source: &'s [u8],
    spans: Vec<Span>,
    stack_check: StackCheck,
    /// A span is missing: none of them is used.
    cut: bool,
}

impl Collector<'_> {
    fn finish(mut self) -> Option<Vec<Span>> {
        if self.cut {
            return None;
        }
        self.spans.sort_unstable_by_key(|span| span.start);
        Some(self.spans)
    }

    /// Whether the walk goes one node deeper: not after a cut, and not without the stack for it.
    fn descends(&mut self) -> bool {
        if self.cut || !self.stack_check.is_safe_to_recurse() {
            self.cut = true;
            return false;
        }
        true
    }
}

impl<'ast> Visitor<'ast> for Collector<'_> {
    fn visit_expr(&mut self, expr: &'ast Expr) {
        if self.descends() {
            walk::walk_expr(self, expr);
        }
    }

    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        if self.descends() {
            walk::walk_stmt(self, stmt);
        }
    }

    fn visit_binding(&mut self, binding: &'ast Binding) {
        if self.descends() {
            walk::walk_binding(self, binding);
        }
    }

    fn visit_e_reg_exp(&mut self, node: &'ast E::RegExp, loc: Loc) {
        let Ok(start) = u32::try_from(loc.start) else {
            self.cut = true;
            return;
        };
        self.spans.push(Span {
            start,
            end: start.saturating_add(node.value.slice().len() as u32),
        });
    }

    // Nothing inside the element is read: its children are not walked.
    fn visit_e_jsx_element(&mut self, node: &'ast E::JSXElement, loc: Loc) {
        let (Ok(start), Ok(close)) = (
            u32::try_from(loc.start),
            usize::try_from(node.close_tag_loc.start),
        ) else {
            self.cut = true;
            return;
        };
        match jsx_end(self.source, close) {
            Some(end) => self.spans.push(Span { start, end }),
            None => self.cut = true,
        }
    }
}

/// After the `>` that ends the closing tag whose `/`, name or `>` is at `at`.
pub(crate) fn jsx_end(source: &[u8], mut at: usize) -> Option<u32> {
    loop {
        match *source.get(at)? {
            b'>' => return u32::try_from(at + 1).ok(),
            b'/' if source.get(at + 1) == Some(&b'*') => {
                at += 2 + strings::index_of(source.get(at + 2..)?, b"*/")? + 2;
            }
            b'/' if source.get(at + 1) == Some(&b'/') => at = line_end(source, at + 2),
            _ => at += 1,
        }
    }
}

/// Where the line that holds `at` ends, as the lexer ends a `//` comment: U+2028 and U+2029 break a line too.
fn line_end(source: &[u8], mut at: usize) -> usize {
    loop {
        match source.get(at..) {
            None | Some([] | [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..]) => return at,
            Some(_) => at += 1,
        }
    }
}

/// After the backtick that ends the template text at `at`, or after its `${` (then `true`).
pub(crate) fn template_text_end(source: &[u8], mut at: usize) -> Option<(u32, bool)> {
    loop {
        match *source.get(at)? {
            b'\\' => at += 2,
            b'`' => return Some((u32::try_from(at + 1).ok()?, false)),
            b'$' if source.get(at + 1) == Some(&b'{') => {
                return Some((u32::try_from(at + 2).ok()?, true));
            }
            _ => at += 1,
        }
    }
}

pub(crate) struct Tokens<'c, 's> {
    lexer: Lexer<'s>,
    source: &'s [u8],
    spans: &'c [Span],
    /// One entry per template substitution that is open: the `{` inside it that wait for their `}`.
    templates: Vec<u32>,
}

impl<'c, 's> Tokens<'c, 's> {
    /// `log` takes what the lexer says about text it cannot read: nobody prints it. The lexer keeps its address for `'c`.
    pub(crate) fn new(
        log: &'c mut Log,
        source: &'s Source,
        arena: &'s bun_alloc::Arena,
        spans: &'c [Span],
        from: u32,
    ) -> Tokens<'c, 's> {
        let mut tokens = Tokens {
            lexer: Lexer::init_without_reading(log, source, arena),
            source: source.contents(),
            spans,
            templates: Vec::new(),
        };
        tokens.seat(from);
        tokens
    }

    fn seat(&mut self, at: u32) {
        self.lexer.current = at as usize;
        self.lexer.step();
    }

    fn span_at(&self, start: u32) -> Option<Span> {
        let index = self
            .spans
            .binary_search_by_key(&start, |span| span.start)
            .ok()?;
        self.spans.get(index).copied()
    }

    /// `None`: the end of the text, or text that does not read as the tree says.
    pub(crate) fn next(&mut self) -> Option<Token> {
        self.lexer.next().ok()?;
        let t = self.lexer.token;
        let start = u32::try_from(self.lexer.loc().start).ok()?;
        let end = u32::try_from(self.lexer.end).ok()?;
        let plain = Token {
            t,
            start,
            end,
            opaque: false,
        };
        match t {
            T::TEndOfFile | T::TSyntaxError => None,
            T::TSlash | T::TSlashEquals | T::TLessThan => {
                let Some(span) = self.span_at(start) else {
                    return Some(plain);
                };
                self.seat(span.end);
                Some(Token {
                    t,
                    start,
                    end: span.end,
                    opaque: true,
                })
            }
            T::TTemplateHead => {
                self.templates.push(0);
                Some(Token {
                    opaque: true,
                    ..plain
                })
            }
            T::TNoSubstitutionTemplateLiteral => Some(Token {
                opaque: true,
                ..plain
            }),
            T::TOpenBrace => {
                if let Some(open) = self.templates.last_mut() {
                    *open += 1;
                }
                Some(plain)
            }
            T::TCloseBrace => {
                let Some(open) = self.templates.last_mut() else {
                    return Some(plain);
                };
                if *open > 0 {
                    *open -= 1;
                    return Some(plain);
                }
                let (end, opens) = template_text_end(self.source, start as usize + 1)?;
                if !opens {
                    self.templates.pop();
                }
                self.seat(end);
                Some(Token {
                    t: if opens {
                        T::TTemplateMiddle
                    } else {
                        T::TTemplateTail
                    },
                    start,
                    end,
                    opaque: true,
                })
            }
            _ => Some(plain),
        }
    }
}

/// What ESLint compares of a node, its tokens, as bytes: read from its first token up to `end`. `cooked`: a word is what it spells, as ESLint's own parser has it and typescript-eslint has not.
pub(crate) fn key_until(
    tokens: &mut Tokens<'_, '_>,
    source: &[u8],
    end: u32,
    cooked: bool,
) -> Option<Vec<u8>> {
    let mut key = Vec::new();
    loop {
        let token = tokens.next()?;
        if token.start >= end {
            break;
        }
        if token.end > end {
            return None;
        }
        let raw = source.get(token.start as usize..token.end as usize)?;
        // `>>` closes two lists of type arguments for typescript-eslint and is one operator elsewhere: each `>` and `=` of such a token is compared alone.
        if !token.opaque && raw.len() > 1 && raw.first() == Some(&b'>') {
            for byte in raw {
                key.extend_from_slice(&[0, 1, 0, 0, 0, *byte]);
            }
            continue;
        }
        let spelled = if token.opaque || !cooked {
            None
        } else {
            spelled_word(raw)
        };
        let text = spelled.as_deref().unwrap_or(raw);
        key.push(u8::from(token.opaque));
        key.extend_from_slice(&u32::try_from(text.len()).ok()?.to_le_bytes());
        key.extend_from_slice(text);
    }
    Some(key)
}

/// What a word or a private name with a `\u` escape spells: `\u0061` is `a`. A string with that escape is another string.
fn spelled_word(raw: &[u8]) -> Option<Vec<u8>> {
    let first = raw.first()?;
    if !(first.is_ascii_alphabetic()
        || matches!(first, b'_' | b'$' | b'\\' | b'#')
        || *first >= 0x80)
    {
        return None;
    }
    if !strings::contains_char(raw, b'\\') {
        return None;
    }
    spelled(raw)
}

/// `name` with each `\uXXXX` and `\u{X}` as the character it names. `None`: a `\` that starts neither.
fn spelled(name: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(name.len());
    let mut at = 0;
    while let Some(&byte) = name.get(at) {
        if byte != b'\\' {
            out.push(byte);
            at += 1;
            continue;
        }
        if name.get(at + 1) != Some(&b'u') {
            return None;
        }
        let (digits, next) = if name.get(at + 2) == Some(&b'{') {
            let close = at + 3 + strings::index_of_char_usize(name.get(at + 3..)?, b'}')?;
            (name.get(at + 3..close)?, close + 1)
        } else {
            (name.get(at + 2..at + 6)?, at + 6)
        };
        let mut value = 0u32;
        for &digit in digits {
            value = value
                .checked_mul(16)?
                .checked_add(char::from(digit).to_digit(16)?)?;
        }
        let mut utf8 = [0u8; 4];
        out.extend_from_slice(char::from_u32(value)?.encode_utf8(&mut utf8).as_bytes());
        at = next;
    }
    Some(out)
}

/// After the `}` that closes the `{` which is the first token read.
pub(crate) fn matching_close(tokens: &mut Tokens<'_, '_>) -> Option<u32> {
    let mut depth = 0u32;
    loop {
        let token = tokens.next()?;
        if token.opaque {
            continue;
        }
        match token.t {
            T::TOpenBrace => depth += 1,
            T::TCloseBrace => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(token.end);
                }
            }
            _ => {
                if depth == 0 {
                    return None;
                }
            }
        }
    }
}

/// The last token before the one that starts at `target`. `None`: no token starts there.
pub(crate) fn last_before(tokens: &mut Tokens<'_, '_>, target: u32) -> Option<Token> {
    let mut last = None;
    loop {
        let token = tokens.next()?;
        if token.start >= target {
            return if token.start == target { last } else { None };
        }
        last = Some(token);
    }
}

fn before_blanks(source: &[u8], mut at: usize) -> usize {
    while at > 0 && matches!(source.get(at - 1), Some(b' ' | b'\t')) {
        at -= 1;
    }
    at
}

/// The `case` that stands before `at` with blanks between them only.
pub(crate) fn case_before(source: &[u8], at: u32) -> Option<u32> {
    let at = before_blanks(source, at as usize);
    let start = at.checked_sub(4)?;
    if source.get(start..at)? != b"case" {
        return None;
    }
    if let Some(&before) = start.checked_sub(1).and_then(|index| source.get(index)) {
        if before.is_ascii_alphanumeric() || matches!(before, b'_' | b'$' | b'\\' | b'#') {
            return None;
        }
    }
    u32::try_from(start).ok()
}
