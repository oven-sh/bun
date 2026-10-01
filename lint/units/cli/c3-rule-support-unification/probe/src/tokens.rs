//! The one scanner: Bun's lexer run again over a stretch of the source, told by the tree where a regular
//! expression or a JSX element starts, and reading the text of a template itself.
use bun_ast::walk::{self, Visitor};
use bun_ast::{E, Expr, Loc, Stmt};
use bun_js_parser::lexer::{Lexer, T};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    /// What `Lexer::next` made of it.
    Code(T),
    /// A regular expression literal, flags included.
    RegExp,
    /// A JSX element from `<` to the `>` that closes it.
    Jsx,
    /// `}` up to and with the next `${` of a template.
    TemplateMiddle,
    /// `}` up to and with the backtick that closes a template.
    TemplateTail,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Token {
    pub(crate) kind: Kind,
    pub(crate) start: u32,
    pub(crate) end: u32,
}

/// Where the lexer cannot tell alone what a `/` or a `<` starts: sorted by start.
#[derive(Default)]
pub(crate) struct Spans {
    spans: Vec<(u32, u32, Kind)>,
    /// The walk that collects them ran out of stack: no scan can be trusted.
    pub(crate) incomplete: bool,
}

struct Collector<'s> {
    text: &'s [u8],
    out: Spans,
    stack: bun_core::StackCheck,
}

impl<'ast> Visitor<'ast> for Collector<'_> {
    fn visit_expr(&mut self, expr: &'ast Expr) {
        if !self.stack.is_safe_to_recurse() {
            self.out.incomplete = true;
            return;
        }
        walk::walk_expr(self, expr);
    }
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        if !self.stack.is_safe_to_recurse() {
            self.out.incomplete = true;
            return;
        }
        walk::walk_stmt(self, stmt);
    }
    fn visit_binding(&mut self, binding: &'ast bun_ast::Binding) {
        if !self.stack.is_safe_to_recurse() {
            self.out.incomplete = true;
            return;
        }
        walk::walk_binding(self, binding);
    }
    fn visit_e_reg_exp(&mut self, node: &'ast E::RegExp, loc: Loc) {
        let Ok(start) = u32::try_from(loc.start) else { return };
        self.out.spans.push((start, start + node.value.len() as u32, Kind::RegExp));
    }
    fn visit_e_jsx_element(&mut self, node: &'ast E::JSXElement, loc: Loc) {
        let (Ok(start), Ok(close)) = (u32::try_from(loc.start), usize::try_from(node.close_tag_loc.start)) else {
            self.out.incomplete = true;
            return;
        };
        match jsx_end(self.text, close) {
            Some(end) => self.out.spans.push((start, end, Kind::Jsx)),
            None => self.out.incomplete = true,
        }
    }
}

/// From inside the last tag of an element, the offset after its `>`.
fn jsx_end(text: &[u8], mut at: usize) -> Option<u32> {
    loop {
        match *text.get(at)? {
            b'>' => return u32::try_from(at + 1).ok(),
            b'/' if text.get(at + 1) == Some(&b'*') => {
                at += 2;
                loop {
                    if *text.get(at)? == b'*' && text.get(at + 1) == Some(&b'/') {
                        at += 2;
                        break;
                    }
                    at += 1;
                }
            }
            b'/' if text.get(at + 1) == Some(&b'/') => {
                while !matches!(*text.get(at)?, b'\n' | b'\r') {
                    at += 1;
                }
            }
            _ => at += 1,
        }
    }
}

impl Spans {
    pub(crate) fn under<'ast>(text: &[u8], exprs: &[&'ast Expr], stmts: &[&'ast Stmt]) -> Spans {
        let mut collector = Collector { text, out: Spans::default(), stack: bun_core::StackCheck::init() };
        for expr in exprs {
            collector.visit_expr(expr);
        }
        for stmt in stmts {
            collector.visit_stmt(stmt);
        }
        collector.out.spans.sort_unstable_by_key(|span| span.0);
        collector.out
    }
}

pub(crate) struct Tokens<'a, 's> {
    lexer: Lexer<'a>,
    text: &'a [u8],
    spans: &'s [(u32, u32, Kind)],
    next_span: usize,
    /// Per template that is open: the `{` that are open inside its substitution.
    templates: Vec<u32>,
    failed: bool,
}

impl<'a, 's> Tokens<'a, 's> {
    /// `from` is where a token starts, or blank space or a comment before one. `log` outlives the result.
    pub(crate) fn new(
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
        arena: &'a bun_alloc::Arena,
        spans: &'s Spans,
        from: u32,
    ) -> Self {
        let mut lexer = Lexer::init_without_reading(log, source, arena);
        lexer.current = from as usize;
        lexer.step();
        Tokens {
            lexer,
            text: source.contents(),
            spans: &spans.spans,
            next_span: 0,
            templates: Vec::new(),
            failed: spans.incomplete,
        }
    }

    fn restart(&mut self, at: u32) {
        self.lexer.current = at as usize;
        self.lexer.step();
    }

    /// `None`: the end of the file, or text the lexer does not take.
    pub(crate) fn next(&mut self) -> Option<Token> {
        if self.failed {
            return None;
        }
        if self.lexer.next().is_err() {
            self.failed = true;
            return None;
        }
        let kind = self.lexer.token;
        if kind == T::TEndOfFile {
            return None;
        }
        let start = u32::try_from(self.lexer.loc().start).ok()?;
        let end = u32::try_from(self.lexer.end).ok()?;
        while self.spans.get(self.next_span).is_some_and(|span| span.0 < start) {
            self.next_span += 1;
        }
        if let Some(&(span_start, span_end, span_kind)) = self.spans.get(self.next_span) {
            if span_start == start {
                self.next_span += 1;
                self.restart(span_end);
                return Some(Token { kind: span_kind, start, end: span_end });
            }
        }
        match kind {
            T::TTemplateHead => self.templates.push(0),
            T::TOpenBrace => {
                if let Some(open) = self.templates.last_mut() {
                    *open += 1;
                }
            }
            T::TCloseBrace => match self.templates.last_mut() {
                Some(0) => {
                    let (kind, end) = self.template_text(end as usize)?;
                    if kind == Kind::TemplateTail {
                        self.templates.pop();
                    }
                    self.restart(end);
                    return Some(Token { kind, start, end });
                }
                Some(open) => *open -= 1,
                None => {}
            },
            _ => {}
        }
        Some(Token { kind: Kind::Code(kind), start, end })
    }

    /// The text of a template after a `}`: up to and with the next `${` or the closing backtick.
    fn template_text(&mut self, mut at: usize) -> Option<(Kind, u32)> {
        loop {
            let Some(&byte) = self.text.get(at) else {
                self.failed = true;
                return None;
            };
            match byte {
                b'\\' => at += 2,
                b'`' => return Some((Kind::TemplateTail, u32::try_from(at + 1).ok()?)),
                b'$' if self.text.get(at + 1) == Some(&b'{') => {
                    return Some((Kind::TemplateMiddle, u32::try_from(at + 2).ok()?));
                }
                _ => at += 1,
            }
        }
    }

    pub(crate) fn failed(&self) -> bool {
        self.failed
    }
}
