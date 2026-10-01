//! Research probe: the support that the rules on expression shape need of the wrapper records (`plain`, `parens`,
//! `start_of_node`, `start_of_place`), the key of an operand from the scanner of src/lint/tokens.rs, and no-dupe-else-if on them.
use bun_ast::lexer_tables::T;
use bun_ast::walk::{self, Visitor};
use bun_ast::{Expr, ExprData, Log, OpCode, Stmt, StmtData, S};
use bun_core::StackCheck;
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::{ExprId, Wrapper, WrapperData};

use crate::tokens::{self, Span, Tokens};

type Key = (i32, u8, usize);

fn key_of(expr: &Expr) -> Key {
    let id = ExprId::of(expr);
    (id.loc, id.tag as u8, id.payload)
}

pub struct Ctx<'p, 'a> {
    parsed: &'p ParsedForLint<'p, 'a>,
    source: &'a bun_ast::Source,
    arena: &'a bun_alloc::Arena,
    /// The records by their operand; those of one operand keep their order, the inner one first.
    index: Vec<(Key, u32)>,
    has_ts: bool,
    stack_check: StackCheck,
    pub reports: Vec<u32>,
}

impl<'p, 'a> Ctx<'p, 'a> {
    fn new(parsed: &'p ParsedForLint<'p, 'a>, source: &'a bun_ast::Source, arena: &'a bun_alloc::Arena) -> Self {
        let records = &parsed.sidecar.wrappers.records;
        let mut index: Vec<(Key, u32)> = records.iter().enumerate().map(|(i, record)| (key_of(&record.operand), i as u32)).collect();
        index.sort_unstable();
        let has_ts = records.iter().any(|record| !matches!(record.data, WrapperData::Parenthesized));
        Ctx { parsed, source, arena, index, has_ts, stack_check: StackCheck::init(), reports: Vec::new() }
    }

    fn wrappers<'s>(&'s self, expr: &Expr) -> impl Iterator<Item = &'s Wrapper> + 's {
        let key = key_of(expr);
        let from = self.index.partition_point(|(k, _)| *k < key);
        self.index[from..].iter().take_while(move |(k, _)| *k == key).map(|(_, i)| &self.parsed.sidecar.wrappers.records[*i as usize])
    }

    /// What ESLint has at the place of `expr`: `expr`, or nothing behind `as`, `satisfies`, `!` or `<T>`.
    fn plain<'e>(&self, expr: &'e Expr) -> Option<&'e Expr> {
        if self.has_ts && self.wrappers(expr).any(|w| !matches!(w.data, WrapperData::Parenthesized)) {
            return None;
        }
        Some(expr)
    }

    /// The parentheses around what ESLint has at the place of `expr`.
    fn parens(&self, expr: &Expr) -> u32 {
        let mut count = 0;
        for w in self.wrappers(expr) {
            count = if matches!(w.data, WrapperData::Parenthesized) { count + 1 } else { 0 };
        }
        count
    }

    /// Where the node `expr` starts for ESLint, its own wrappers aside: at the `(` or the `<` of its first operand.
    fn start_of_node(&self, expr: &Expr) -> u32 {
        let mut e = expr;
        loop {
            let child = match &e.data {
                ExprData::EBinary(node) => &node.left,
                ExprData::EDot(node) => &node.target,
                ExprData::EIndex(node) => &node.target,
                ExprData::ECall(node) => &node.target,
                ExprData::EIf(node) => &node.test,
                ExprData::ETemplate(node) => match &node.tag {
                    Some(tag) => tag,
                    None => break,
                },
                ExprData::EUnary(node) if matches!(node.op, OpCode::UnPostDec | OpCode::UnPostInc) => &node.value,
                _ => break,
            };
            let open = self.wrappers(child).filter(|w| matches!(w.data, WrapperData::Parenthesized | WrapperData::TypeAssertion(_))).map(|w| w.op).min();
            if let Some(open) = open {
                return open;
            }
            e = child;
        }
        expr.loc.start as u32
    }

    /// Where what ESLint has at the place of `expr` starts: the wrappers up to the outermost TypeScript one belong to it.
    fn start_of_place(&self, expr: &Expr) -> u32 {
        let wrappers: Vec<&Wrapper> = self.wrappers(expr).collect();
        let mut start = self.start_of_node(expr);
        if let Some(last) = wrappers.iter().rposition(|w| !matches!(w.data, WrapperData::Parenthesized)) {
            for w in &wrappers[..=last] {
                if matches!(w.data, WrapperData::Parenthesized | WrapperData::TypeAssertion(_)) {
                    start = start.min(w.op);
                }
            }
        }
        start
    }

    /// What ESLint compares of an operand: its tokens, read from where it starts. `bounded`: only a bracket from before it ends it.
    fn operand_key(&self, place: &Expr, bounded: bool, spans: &[Span]) -> Option<Vec<u8>> {
        let from = self.start_of_place(place);
        let text = self.source.contents();
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, spans, from);
        let mut stack: Vec<T> = Vec::new();
        let mut key = Vec::new();
        loop {
            let token = tokens.next()?;
            if !token.opaque {
                match token.t {
                    T::TOpenParen => stack.push(T::TCloseParen),
                    T::TOpenBracket => stack.push(T::TCloseBracket),
                    T::TOpenBrace => stack.push(T::TCloseBrace),
                    T::TCloseParen | T::TCloseBracket | T::TCloseBrace => match stack.pop() {
                        Some(close) => {
                            if close != token.t {
                                return None;
                            }
                        }
                        None => break,
                    },
                    T::TBarBar | T::TAmpersandAmpersand if !bounded && stack.is_empty() => break,
                    _ => {}
                }
            } else if token.t == T::TTemplateHead {
                stack.push(T::TTemplateTail);
            } else if token.t == T::TTemplateTail {
                if stack.pop()? != T::TTemplateTail {
                    return None;
                }
            } else if token.t == T::TTemplateMiddle && stack.last() != Some(&T::TTemplateTail) {
                return None;
            }
            let raw = text.get(token.start as usize..token.end as usize)?;
            let spelled = if token.opaque { None } else { spelled_word(raw) };
            let piece = spelled.as_deref().unwrap_or(raw);
            key.push(u8::from(token.opaque));
            key.extend_from_slice(&(piece.len() as u32).to_le_bytes());
            key.extend_from_slice(piece);
        }
        Some(key)
    }
}

// `spelled_word` and `spelled` of src/lint/tokens.rs, which keeps them private.
fn spelled_word(raw: &[u8]) -> Option<Vec<u8>> {
    let first = raw.first()?;
    if !(first.is_ascii_alphabetic() || matches!(first, b'_' | b'$' | b'\\' | b'#') || *first >= 0x80) {
        return None;
    }
    if !raw.contains(&b'\\') {
        return None;
    }
    let mut out = Vec::with_capacity(raw.len());
    let mut at = 0;
    while let Some(&byte) = raw.get(at) {
        if byte != b'\\' {
            out.push(byte);
            at += 1;
            continue;
        }
        if raw.get(at + 1) != Some(&b'u') {
            return None;
        }
        let (digits, next) = if raw.get(at + 2) == Some(&b'{') {
            let close = at + 3 + raw.get(at + 3..)?.iter().position(|&b| b == b'}')?;
            (raw.get(at + 3..close)?, close + 1)
        } else {
            (raw.get(at + 2..at + 6)?, at + 6)
        };
        let mut value = 0u32;
        for &digit in digits {
            value = value.checked_mul(16)?.checked_add(char::from(digit).to_digit(16)?)?;
        }
        let mut utf8 = [0u8; 4];
        out.extend_from_slice(char::from_u32(value)?.encode_utf8(&mut utf8).as_bytes());
        at = next;
    }
    Some(out)
}

/// An operand as `equal` reads it: `||` and `&&` by their operands, anything else by its key.
enum Operand {
    Leaf(Option<Vec<u8>>),
    Logical(OpCode, Box<Operand>, Box<Operand>),
}

fn equal(a: &Operand, b: &Operand) -> bool {
    match (a, b) {
        (Operand::Logical(op_a, left_a, right_a), Operand::Logical(op_b, left_b, right_b)) if op_a == op_b => {
            (equal(left_a, left_b) && equal(right_a, right_b)) || (equal(left_a, right_b) && equal(right_a, left_b))
        }
        (Operand::Leaf(Some(a)), Operand::Leaf(Some(b))) => a == b,
        _ => false,
    }
}

/// `splitByLogicalOperator`, without recursion.
fn split<'e>(ctx: &Ctx<'_, '_>, op: OpCode, place: &'e Expr, out: &mut Vec<&'e Expr>) {
    let mut stack = vec![place];
    while let Some(place) = stack.pop() {
        match ctx.plain(place).map(|node| &node.data) {
            Some(ExprData::EBinary(binary)) if binary.op == op => {
                stack.push(&binary.right);
                stack.push(&binary.left);
            }
            _ => out.push(place),
        }
    }
}

fn operand(ctx: &Ctx<'_, '_>, place: &Expr, root: &Expr, spans: Option<&[Span]>) -> Operand {
    if !ctx.stack_check.is_safe_to_recurse() {
        return Operand::Leaf(None);
    }
    match ctx.plain(place).map(|node| &node.data) {
        Some(ExprData::EBinary(binary)) if matches!(binary.op, OpCode::BinLogicalOr | OpCode::BinLogicalAnd) => Operand::Logical(
            binary.op,
            Box::new(operand(ctx, &binary.left, root, spans)),
            Box::new(operand(ctx, &binary.right, root, spans)),
        ),
        _ => {
            let bounded = core::ptr::eq(place, root) || ctx.parens(place) > 0;
            Operand::Leaf(spans.and_then(|spans| ctx.operand_key(place, bounded, spans)))
        }
    }
}

/// `splitByOr(place).map(splitByAnd)`.
fn or_operands(ctx: &Ctx<'_, '_>, place: &Expr, root: &Expr, spans: Option<&[Span]>) -> Vec<Vec<Operand>> {
    let mut ors = Vec::new();
    split(ctx, OpCode::BinLogicalOr, place, &mut ors);
    ors.into_iter()
        .map(|or| {
            let mut ands = Vec::new();
            split(ctx, OpCode::BinLogicalAnd, or, &mut ands);
            ands.into_iter().map(|and| operand(ctx, and, root, spans)).collect()
        })
        .collect()
}

/// The `IfStatement` handler, for the first `if` of a chain: each later test that the tests before it cover is reported.
fn s_if(ctx: &mut Ctx<'_, '_>, head: &S::If) {
    let mut tests: Vec<&Expr> = vec![&head.test];
    let mut node = head;
    while let Some(Stmt { data: StmtData::SIf(next), .. }) = &node.no {
        tests.push(&next.test);
        node = next;
    }
    if tests.len() < 2 {
        return;
    }
    let spans: Vec<Option<Vec<Span>>> = tests.iter().map(|test| tokens::spans_under(ctx.source.contents(), &[*test], ctx.stack_check)).collect();
    // What each test is for the tests after it.
    let before: Vec<Vec<Vec<Operand>>> = tests.iter().zip(&spans).map(|(test, spans)| or_operands(ctx, test, test, spans.as_deref())).collect();
    for i in 1..tests.len() {
        let test = tests[i];
        let spans_i = spans[i].as_deref();
        let mut conditions: Vec<&Expr> = vec![test];
        if let Some(ExprData::EBinary(binary)) = ctx.plain(test).map(|node| &node.data) {
            if binary.op == OpCode::BinLogicalAnd {
                split(ctx, OpCode::BinLogicalAnd, test, &mut conditions);
            }
        }
        let mut list: Vec<Vec<Vec<Operand>>> = conditions.iter().map(|condition| or_operands(ctx, condition, test, spans_i)).collect();
        for current in before[..i].iter().rev() {
            for or_list in &mut list {
                or_list.retain(|or_operand| !current.iter().any(|cur| cur.iter().all(|a| or_operand.iter().any(|b| equal(a, b)))));
            }
            if list.iter().any(|or_list| or_list.is_empty()) {
                let at = ctx.start_of_place(test);
                ctx.reports.push(at);
                break;
            }
        }
    }
}

struct Walk<'c, 'p, 'a> {
    ctx: &'c mut Ctx<'p, 'a>,
    else_if: Option<usize>,
}

impl<'ast> Visitor<'ast> for Walk<'_, '_, '_> {
    fn visit_s_if(&mut self, node: &'ast S::If, _: bun_ast::Loc) {
        let address = core::ptr::from_ref(node).addr();
        if self.else_if.take() != Some(address) {
            s_if(self.ctx, node);
        }
        self.visit_expr(&node.test);
        self.visit_stmt(&node.yes);
        if let Some(no) = &node.no {
            if let StmtData::SIf(next) = &no.data {
                self.else_if = Some(core::ptr::from_ref::<S::If>(next).addr());
            }
            self.visit_stmt(no);
        }
    }

    fn visit_e_binary(&mut self, node: &'ast bun_ast::E::Binary, _: bun_ast::Loc) -> Option<&'ast Expr> {
        walk::walk_e_binary(self, node)
    }
}

pub fn run(path: &str) {
    let Ok(text) = std::fs::read(path) else { return };
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let text: &'static [u8] = text.leak();
    let source = bun_ast::Source::init_path_string(path.as_bytes().to_vec().leak() as &'static [u8], text);
    let loader = if path.ends_with(".tsx") {
        bun_ast::Loader::Tsx
    } else if path.ends_with("ts") {
        bun_ast::Loader::Ts
    } else {
        bun_ast::Loader::Jsx
    };
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.is_macro_runtime = true;
    options.features.top_level_await = true;
    options.features.standard_decorators = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let Ok(parser) = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena) else {
        println!("{path}: PARSE_ERROR");
        return;
    };
    let reports = parser.parse_for_lint(|parsed| {
        let mut ctx = Ctx::new(parsed, &source, &arena);
        let mut walk = Walk { ctx: &mut ctx, else_if: None };
        for stmt in parsed.stmts {
            walk.visit_stmt(stmt);
        }
        ctx.reports
    });
    match reports {
        Err(_) => println!("{path}: PARSE_ERROR"),
        Ok(mut reports) => {
            println!("{path}: OK");
            reports.sort_unstable();
            reports.dedup();
            for at in reports {
                let before = &text[..at as usize];
                let line = before.iter().filter(|&&b| b == b'\n').count() + 1;
                let column = before.len() - before.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1) + 1;
                println!("{path}({line},{column}): no-dupe-else-if");
            }
        }
    }
}
