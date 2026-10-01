//! What a rule handler may ask and say. One per file.
use crate::tokens::{Kind, Spans, Token, Tokens};
use bun_ast::{Expr, Loc, Ref, Stmt};
use bun_js_parser::lexer::T;
use bun_js_parser::parse::parse_entry::ParsedOnly;

pub(crate) struct Report {
    pub(crate) rule: &'static str,
    pub(crate) start: u32,
    pub(crate) len: u32,
    pub(crate) message: Vec<u8>,
}

/// Names whose meaning a rule depends on: a report that needs one of them is held until the walk has seen every binding.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Globals(u8);

impl Globals {
    pub(crate) const NONE: Globals = Globals(0);
    pub(crate) const NAN: Globals = Globals(1);
    pub(crate) const NUMBER: Globals = Globals(2);
    pub(crate) const UNDEFINED: Globals = Globals(4);
    pub(crate) fn or(self, other: Globals) -> Globals {
        Globals(self.0 | other.0)
    }
    pub(crate) fn is_none(self) -> bool {
        self.0 == 0
    }
    fn of(name: &[u8]) -> Globals {
        match name {
            b"NaN" => Globals::NAN,
            b"Number" => Globals::NUMBER,
            b"undefined" => Globals::UNDEFINED,
            _ => Globals::NONE,
        }
    }
}

/// What stands between two offsets, counted on tokens.
pub(crate) struct Between {
    /// `)` with no `(` since the first offset.
    pub(crate) unmatched: u32,
    /// Where the last token ends, and the one before it.
    pub(crate) last_end: u32,
    pub(crate) before_last_end: u32,
    pub(crate) last_kind: Option<Kind>,
}

pub(crate) struct Context<'a, 'p> {
    source: &'a bun_ast::Source,
    parsed: &'p ParsedOnly<'p, 'a>,
    arena: &'a bun_alloc::Arena,
    reports: Vec<Report>,
    held: Vec<(Globals, Report)>,
    declared: Globals,
    targets: Vec<usize>,
}

impl<'a, 'p> Context<'a, 'p> {
    pub(crate) fn new(parsed: &'p ParsedOnly<'p, 'a>, source: &'a bun_ast::Source, arena: &'a bun_alloc::Arena) -> Self {
        Context { source, parsed, arena, reports: Vec::new(), held: Vec::new(), declared: Globals::NONE, targets: Vec::new() }
    }

    pub(crate) fn text(&self) -> &'a [u8] {
        self.source.contents()
    }

    /// The spelling of an identifier, decoded. Empty for a reference the parser made up.
    pub(crate) fn name(&self, r#ref: Ref) -> &'a [u8] {
        if !r#ref.is_valid() {
            return b"";
        }
        self.parsed.name_of(r#ref)
    }

    fn make(&self, rule: &'static str, at: u32, message: core::fmt::Arguments<'_>) -> Report {
        use std::io::Write;
        let mut text = Vec::new();
        let _ = text.write_fmt(message);
        Report { rule, start: at, len: self.token_len(at), message: text }
    }

    /// The length of a report is the token at `at`: no rule computes one.
    pub(crate) fn report(&mut self, rule: &'static str, at: Loc, message: core::fmt::Arguments<'_>) {
        let Ok(at) = u32::try_from(at.start) else { return };
        let report = self.make(rule, at, message);
        self.reports.push(report);
    }

    /// Reported at the end of the walk, unless the file binds every name of `needs`.
    pub(crate) fn report_if_global(&mut self, needs: Globals, rule: &'static str, at: Loc, message: core::fmt::Arguments<'_>) {
        let Ok(at) = u32::try_from(at.start) else { return };
        let report = self.make(rule, at, message);
        self.held.push((needs, report));
    }

    /// A binding of the file: a variable, a parameter, a function, a class, an import.
    pub(crate) fn declare(&mut self, r#ref: Ref) {
        let name = self.name(r#ref);
        self.declared = self.declared.or(Globals::of(name));
    }

    pub(crate) fn finish(mut self) -> Vec<Report> {
        for (needs, report) in self.held.drain(..) {
            if needs.0 & !self.declared.0 != 0 {
                self.reports.push(report);
            }
        }
        self.reports.sort_by(|a, b| (a.start, a.rule, &a.message).cmp(&(b.start, b.rule, &b.message)));
        self.reports.dedup_by(|a, b| a.start == b.start && a.rule == b.rule && a.message == b.message);
        self.reports
    }

    /// `expr` is written to: an array or object literal there is a pattern.
    pub(crate) fn mark_target(&mut self, expr: &Expr) {
        match &expr.data {
            bun_ast::ExprData::EArray(array) => self.targets.push(core::ptr::from_ref(&**array) as usize),
            bun_ast::ExprData::EObject(object) => self.targets.push(core::ptr::from_ref(&**object) as usize),
            bun_ast::ExprData::ESpread(spread) => self.mark_target(&spread.value),
            // `[a = 1] = b`: a default, not an assignment.
            bun_ast::ExprData::EBinary(binary) if binary.op == bun_ast::OpCode::BinAssign => {
                self.targets.push(core::ptr::from_ref(&**binary) as usize);
            }
            _ => {}
        }
    }

    pub(crate) fn take_target<N>(&mut self, node: &N) -> bool {
        let address = core::ptr::from_ref(node) as usize;
        match self.targets.iter().position(|&target| target == address) {
            Some(index) => {
                self.targets.swap_remove(index);
                true
            }
            None => false,
        }
    }

    pub(crate) fn spans(&self, exprs: &[&Expr], stmts: &[&Stmt]) -> Spans {
        Spans::under(self.text(), exprs, stmts)
    }

    pub(crate) fn tokens<'s>(&self, log: &mut bun_ast::Log, spans: &'s Spans, from: u32) -> Tokens<'a, 's> {
        Tokens::new(log, self.source, self.arena, spans, from)
    }

    /// The token at `at`, where one starts.
    pub(crate) fn token_at(&self, at: u32) -> Option<Token> {
        let spans = Spans::default();
        let mut log = bun_ast::Log::init();
        self.tokens(&mut log, &spans, at).next().filter(|token| token.start == at)
    }

    pub(crate) fn token_len(&self, at: u32) -> u32 {
        self.token_at(at).map_or(0, |token| token.end - token.start)
    }

    /// The tokens that start in `[from, to)`; `under` are the expressions whose text that is.
    pub(crate) fn between(&self, from: u32, to: u32, under: &[&Expr]) -> Option<Between> {
        let spans = self.spans(under, &[]);
        let mut log = bun_ast::Log::init();
        let mut tokens = self.tokens(&mut log, &spans, from);
        let mut depth: i64 = 0;
        let mut lowest: i64 = 0;
        let mut found = Between { unmatched: 0, last_end: from, before_last_end: from, last_kind: None };
        while let Some(token) = tokens.next() {
            if token.start >= to {
                break;
            }
            match token.kind {
                Kind::Code(T::TOpenParen) => depth += 1,
                Kind::Code(T::TCloseParen) => {
                    depth -= 1;
                    lowest = lowest.min(depth);
                }
                _ => {}
            }
            found.before_last_end = found.last_end;
            found.last_end = token.end;
            found.last_kind = Some(token.kind);
        }
        // A token across `to` means the text was not read the way the parser read it.
        if tokens.failed() || found.last_end > to {
            return None;
        }
        found.unmatched = u32::try_from(-lowest).ok()?;
        Some(found)
    }

    pub(crate) fn arena(&self) -> &'a bun_alloc::Arena {
        self.arena
    }

    /// Where a binary expression starts: at the `(` of a left operand in parentheses, when it can be found.
    pub(crate) fn start_of_binary(&self, node: &bun_ast::E::Binary, loc: Loc) -> Loc {
        let (Ok(own), Ok(right)) = (u32::try_from(loc.start), u32::try_from(node.right.loc.start)) else { return loc };
        let Some(between) = self.between(own, right, &[&node.left, &node.right]) else { return loc };
        match self.open_parens_before(own, between.unmatched) {
            Some(start) => Loc { start: start as i32 },
            None => loc,
        }
    }

    /// Where clause `index` of a switch starts: the `case` before its test.
    pub(crate) fn case_loc(&self, node: &bun_ast::S::Switch, index: usize) -> Loc {
        let Some(test) = node.cases.slice().get(index).and_then(|case| case.value.as_ref()) else { return Loc::EMPTY };
        let Ok(at) = u32::try_from(test.loc.start) else { return test.loc };
        match self.case_keyword_before(at).or_else(|| self.case_keyword_scanned(node, index)) {
            Some(start) => Loc { start: start as i32 },
            None => test.loc,
        }
    }

    /// The tokens of a case test from its first own token: `each` gets a token and whether it is a `)` whose `(`
    /// stands before the test. Answers where the `:` of the clause ends.
    pub(crate) fn case_test(&self, test: &Expr, mut each: impl FnMut(&Token, bool)) -> Option<u32> {
        let from = u32::try_from(test.loc.start).ok()?;
        let spans = self.spans(&[test], &[]);
        let mut log = bun_ast::Log::init();
        let mut tokens = self.tokens(&mut log, &spans, from);
        let (mut braces, mut parens, mut conditionals) = (0u32, 0u32, 0u32);
        loop {
            let token = tokens.next()?;
            let mut closes_outer = false;
            match token.kind {
                Kind::Code(T::TOpenBrace | T::TTemplateHead) => braces += 1,
                Kind::Code(T::TCloseBrace) | Kind::TemplateTail => braces = braces.checked_sub(1)?,
                Kind::Code(T::TOpenParen) => parens += 1,
                Kind::Code(T::TCloseParen) => match parens.checked_sub(1) {
                    Some(open) => parens = open,
                    None => closes_outer = true,
                },
                // Outside braces a `:` belongs to a `?`, or it ends the test.
                Kind::Code(T::TQuestion) if braces == 0 => conditionals += 1,
                Kind::Code(T::TColon) if braces == 0 => match conditionals.checked_sub(1) {
                    Some(open) => conditionals = open,
                    None => return Some(token.end),
                },
                _ => {}
            }
            each(&token, closes_outer);
        }
    }

    fn token_after(&self, at: u32) -> Option<Token> {
        let spans = Spans::default();
        let mut log = bun_ast::Log::init();
        self.tokens(&mut log, &spans, at).next()
    }

    /// The `case`, `default` or `}` that follows the statement that ends a clause.
    fn keyword_after_statement(&self, stmt: &Stmt) -> Option<Token> {
        let from = u32::try_from(stmt.loc.start).ok()?;
        let spans = self.spans(&[], &[stmt]);
        let mut log = bun_ast::Log::init();
        let mut tokens = self.tokens(&mut log, &spans, from);
        // A statement may start inside parentheses: the next clause is at the lowest depth the scan reaches.
        let (mut depth, mut lowest) = (0i64, 0i64);
        let mut after_dot = false;
        loop {
            let token = tokens.next()?;
            match token.kind {
                Kind::Code(T::TOpenParen | T::TOpenBracket | T::TOpenBrace | T::TTemplateHead) => depth += 1,
                Kind::Code(T::TCloseParen | T::TCloseBracket) | Kind::TemplateTail => {
                    depth -= 1;
                    lowest = lowest.min(depth);
                }
                Kind::Code(T::TCloseBrace) => {
                    if depth == lowest {
                        return Some(token);
                    }
                    depth -= 1;
                }
                // `a.case` is a property.
                Kind::Code(T::TCase | T::TDefault) if depth == lowest && !after_dot => return Some(token),
                _ => {}
            }
            after_dot = matches!(token.kind, Kind::Code(T::TDot | T::TQuestionDot));
        }
    }

    /// The keyword of the clause after `case`; `keyword_end` is where the keyword of `case` ends, when that is known.
    fn keyword_after_clause(&self, case: &bun_ast::Case, keyword_end: Option<u32>) -> Option<Token> {
        if let Some(last) = case.body.slice().last() {
            return self.keyword_after_statement(last);
        }
        let colon_end = match &case.value {
            Some(test) => self.case_test(test, |_, _| {})?,
            None => {
                let colon = self.token_after(keyword_end?)?;
                if colon.kind != Kind::Code(T::TColon) {
                    return None;
                }
                colon.end
            }
        };
        self.token_after(colon_end)
    }

    /// Reads forward from the nearest place the tree knows to the keyword of clause `index`.
    fn case_keyword_scanned(&self, node: &bun_ast::S::Switch, index: usize) -> Option<u32> {
        let cases = node.cases.slice();
        let known = (0..index).rev().find(|&j| !cases[j].body.slice().is_empty() || cases[j].value.is_some());
        let (mut token, mut next) = match known {
            Some(j) => (self.keyword_after_clause(&cases[j], None)?, j + 1),
            None => {
                let open = self.token_after(u32::try_from(node.body_loc.start).ok()?)?;
                if open.kind != Kind::Code(T::TOpenBrace) {
                    return None;
                }
                (self.token_after(open.end)?, 0)
            }
        };
        while next < index {
            // Only a `default` without statements is between.
            if token.kind != Kind::Code(T::TDefault) {
                return None;
            }
            token = self.keyword_after_clause(&cases[next], Some(token.end))?;
            next += 1;
        }
        (token.kind == Kind::Code(T::TCase)).then_some(token.start)
    }

    /// After `from`, past any `)`, the end of the `]` that closes an index.
    pub(crate) fn closing_bracket_after(&self, from: u32) -> Option<u32> {
        let spans = Spans::default();
        let mut log = bun_ast::Log::init();
        let mut tokens = self.tokens(&mut log, &spans, from);
        loop {
            let token = tokens.next()?;
            match token.kind {
                Kind::Code(T::TCloseParen) => {}
                Kind::Code(T::TCloseBracket) => return Some(token.end),
                _ => return None,
            }
        }
    }

    /// The `(` before `at` when only blanks on the same line are between them.
    pub(crate) fn open_paren_before(&self, at: u32) -> Option<u32> {
        let text = self.text();
        let mut index = at as usize;
        while index > 0 && matches!(text.get(index - 1), Some(b' ' | b'\t')) {
            index -= 1;
        }
        if index > 0 && text.get(index - 1) == Some(&b'(') { u32::try_from(index - 1).ok() } else { None }
    }

    /// `count` times `open_paren_before`; `None` when one of them is not found.
    pub(crate) fn open_parens_before(&self, mut at: u32, count: u32) -> Option<u32> {
        for _ in 0..count {
            at = self.open_paren_before(at)?;
        }
        Some(at)
    }

    /// The `case` of the clause whose test starts at `test`.
    pub(crate) fn case_keyword_before(&self, test: u32) -> Option<u32> {
        let text = self.text();
        let mut at = test;
        while let Some(paren) = self.open_paren_before(at) {
            at = paren;
        }
        let mut index = at as usize;
        while index > 0 && matches!(text.get(index - 1), Some(b' ' | b'\t')) {
            index -= 1;
        }
        if index < 4 || text.get(index - 4..index) != Some(b"case") {
            return None;
        }
        let start = index - 4;
        if start > 0 {
            let before = text[start - 1];
            if before.is_ascii_alphanumeric() || matches!(before, b'_' | b'$' | b'\\' | b'#') || before >= 0x80 {
                return None;
            }
        }
        u32::try_from(start).ok()
    }
}
