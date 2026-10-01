//! The one re-scan of source text: Bun's lexer seated at an offset, told by the tree where a regular expression or JSX is.

use bun_ast::lexer_tables::T;
use bun_ast::walk::{self, Visitor};
use bun_ast::{E, Expr, Loc, Log, Source};
use bun_core::StackCheck;
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

/// The spans under `roots`, sorted. `None`: nested too deeply to collect.
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
    if collector.cut {
        return None;
    }
    collector.spans.sort_unstable_by_key(|span| span.start);
    Some(collector.spans)
}

struct Collector<'s> {
    source: &'s [u8],
    spans: Vec<Span>,
    stack_check: StackCheck,
    cut: bool,
}

impl<'ast> Visitor<'ast> for Collector<'_> {
    fn visit_expr(&mut self, expr: &'ast Expr) {
        if !self.stack_check.is_safe_to_recurse() {
            self.cut = true;
            return;
        }
        walk::walk_expr(self, expr);
    }

    fn visit_stmt(&mut self, stmt: &'ast bun_ast::Stmt) {
        if !self.stack_check.is_safe_to_recurse() {
            self.cut = true;
            return;
        }
        walk::walk_stmt(self, stmt);
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
fn jsx_end(source: &[u8], mut at: usize) -> Option<u32> {
    loop {
        match *source.get(at)? {
            b'>' => return u32::try_from(at + 1).ok(),
            b'/' if source.get(at + 1) == Some(&b'*') => {
                at += 2 + bun_core::strings::index_of(source.get(at + 2..)?, b"*/")? + 2;
            }
            b'/' if source.get(at + 1) == Some(&b'/') => {
                at += bun_core::strings::index_of_char(source.get(at..)?, b'\n')? as usize;
            }
            _ => at += 1,
        }
    }
}

/// After the backtick that ends the template text at `at`, or after its `${` (then `true`).
fn template_text_end(source: &[u8], mut at: usize) -> Option<(u32, bool)> {
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
    /// `log` takes what the lexer says about text it cannot read: nobody prints it.
    pub(crate) fn new(
        log: &mut Log,
        source: &'s Source,
        arena: &'s bun_alloc::Arena,
        spans: &'c [Span],
        from: u32,
    ) -> Tokens<'c, 's> {
        let mut tokens = Tokens {
            lexer: Lexer::init_without_reading(log, source, arena),
            source: &source.contents,
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

/// What ESLint compares of a `case` test, its tokens, as bytes: read from its first own token to the `:` of its clause.
pub(crate) fn case_key(tokens: &mut Tokens<'_, '_>, source: &[u8]) -> Option<Vec<u8>> {
    let mut out: Vec<Token> = Vec::new();
    // One entry per open bracket: the token that closes it, and the `?` of the level around it that wait.
    let mut stack: Vec<(T, u32)> = Vec::new();
    let mut waiting = 0u32;
    // The `)` that no `(` of the test opens: all of them, and those at the end of what is read.
    let mut leading = 0u32;
    let mut trailing = 0u32;
    loop {
        let token = tokens.next()?;
        if !token.opaque {
            match token.t {
                T::TOpenParen => {
                    stack.push((T::TCloseParen, waiting));
                    waiting = 0;
                }
                T::TOpenBracket => {
                    stack.push((T::TCloseBracket, waiting));
                    waiting = 0;
                }
                T::TOpenBrace => {
                    stack.push((T::TCloseBrace, waiting));
                    waiting = 0;
                }
                T::TCloseParen | T::TCloseBracket | T::TCloseBrace => match stack.pop() {
                    Some((close, around)) => {
                        if close != token.t {
                            return None;
                        }
                        waiting = around;
                    }
                    None => {
                        if token.t != T::TCloseParen {
                            return None;
                        }
                        leading += 1;
                        trailing += 1;
                        out.push(token);
                        continue;
                    }
                },
                T::TQuestion => waiting += 1,
                T::TColon => {
                    if waiting > 0 {
                        waiting -= 1;
                    } else if stack.is_empty() {
                        break;
                    }
                }
                _ => {}
            }
        } else if token.t == T::TTemplateHead {
            stack.push((T::TTemplateTail, waiting));
            waiting = 0;
        } else if token.t == T::TTemplateTail {
            let (close, around) = stack.pop()?;
            if close != T::TTemplateTail {
                return None;
            }
            waiting = around;
        } else if token.t == T::TTemplateMiddle
            && !matches!(stack.last(), Some((T::TTemplateTail, _)))
        {
            return None;
        }
        trailing = 0;
        out.push(token);
    }
    // The `)` at the end close parentheses around the whole test: ESLint's node has neither.
    out.truncate(out.len().saturating_sub(trailing as usize));
    // `(a).b`: the `(` before the first token that the test closes are part of it.
    let mut key = (leading - trailing).to_le_bytes().to_vec();
    for token in &out {
        let raw = source.get(token.start as usize..token.end as usize)?;
        let spelled = if token.opaque {
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
    bun_core::strings::index_of_char(raw, b'\\')?;
    spelled(raw)
}

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
            let close =
                at + 3 + bun_core::strings::index_of_char(name.get(at + 3..)?, b'}')? as usize;
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

/// How many `)` between `from` and `to` close a `(` that stands before `from`. `to` is where a token starts.
pub(crate) fn closes_between(tokens: &mut Tokens<'_, '_>, to: u32) -> Option<u32> {
    let mut depth = 0i32;
    let mut lowest = 0i32;
    loop {
        let token = tokens.next()?;
        if token.start >= to {
            return (token.start == to).then_some(lowest.unsigned_abs());
        }
        if token.opaque {
            continue;
        }
        match token.t {
            T::TOpenParen => depth += 1,
            T::TCloseParen => {
                depth -= 1;
                lowest = lowest.min(depth);
            }
            _ => {}
        }
    }
}

/// The `]` that closes a `[` standing before the first token read.
pub(crate) fn close_bracket(tokens: &mut Tokens<'_, '_>) -> Option<u32> {
    let mut depth = 0u32;
    loop {
        let token = tokens.next()?;
        if token.opaque {
            continue;
        }
        match token.t {
            T::TOpenBracket => depth += 1,
            T::TCloseBracket => {
                if depth == 0 {
                    return Some(token.start);
                }
                depth -= 1;
            }
            _ => {}
        }
    }
}

/// Back from `own` over blanks and one `(`, up to `closes` times: where that ends, and how many `(` were not found.
pub(crate) fn before_opens(source: &[u8], own: u32, closes: u32) -> (u32, u32) {
    let mut at = own as usize;
    let mut missing = closes;
    while missing > 0 {
        let open = before_blanks(source, at);
        if open == 0 || source.get(open - 1) != Some(&b'(') {
            break;
        }
        at = open - 1;
        missing -= 1;
    }
    (u32::try_from(at).unwrap_or(own), missing)
}

fn before_blanks(source: &[u8], mut at: usize) -> usize {
    while at > 0 && matches!(source.get(at - 1), Some(b' ' | b'\t')) {
        at -= 1;
    }
    at
}

/// The `case` that stands before the test whose first own token is at `own`, with blanks and `(` between them only.
pub(crate) fn case_before(source: &[u8], own: u32) -> Option<u32> {
    let mut at = own as usize;
    loop {
        at = before_blanks(source, at);
        if at > 0 && source.get(at - 1) == Some(&b'(') {
            at -= 1;
        } else {
            break;
        }
    }
    let start = at.checked_sub(4)?;
    if source.get(start..at)? != b"case" {
        return None;
    }
    if let Some(&before) = start.checked_sub(1).and_then(|index| source.get(index)) {
        if before.is_ascii_alphanumeric()
            || matches!(before, b'_' | b'$' | b'\\' | b'#')
            || before >= 0x80
        {
            return None;
        }
    }
    u32::try_from(start).ok()
}

/// Probe only: the spans under every statement of a file.
pub(crate) fn spans_under_stmts(
    source: &[u8],
    stmts: &[bun_ast::Stmt],
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
    if collector.cut {
        return None;
    }
    collector.spans.sort_unstable_by_key(|span| span.start);
    Some(collector.spans)
}
