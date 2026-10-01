//! Research probe of "rule-no-unused-vars": the site facts that no-unused-vars reads of a reference, computed on the
//! tree of `Parser::parse_for_lint` by ONE top-down walk with three context values, as the plan says the Referencer
//! is to compute them. Output, one line per `E::Identifier`: `<byte offset>\t<flags>`:
//!   a  the whole left side of an assignment expression   l  that operator is `&&=`, `||=` or `??=`
//!   u  the operand of `++` or `--`                        x  the value of that assignment or update is unused
//!   L  inside a loop, before the nearest function         r  the for-in/of exception (left or right, a `return` first)
//!   f:n no function around it; f:y the nearest function is storable; f:N it is not;
//!   f:As / f:Ao  what decides is an assignment whose left side is an identifier of this name / another left side.
//! usage: sitesprobe <file>...        compare with ../sites-estree.cjs
mod shims;

use std::collections::{HashMap, HashSet};

use bun_ast::walk::{self, Visitor};
use bun_ast::{E, Expr, ExprData, G, OpCode, Stmt, StmtData};
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::{ExprId, WrapperData};

/// What a function found at a place is for `isStorableFunction`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Storable {
    No,
    Yes,
    /// The first deciding ancestor is an assignment: the index of the name of its left side, or `u32::MAX`.
    Assign(u32),
}

struct Sites<'p, 'a> {
    parsed: &'p ParsedForLint<'p, 'a>,
    text: &'a [u8],
    ts_wrapped: HashSet<ExprId>,
    names: Vec<&'a [u8]>,
    out: Vec<(i32, String)>,
    pending: HashMap<i32, String>,
    unused: bool,
    storable: Storable,
    loop_depth: u32,
    at_top: bool,
    fns: Vec<Storable>,
}

fn is_assign(op: OpCode) -> bool {
    (op as u8) >= (OpCode::BinAssign as u8)
}

fn is_logical_assign(op: OpCode) -> bool {
    matches!(op, OpCode::BinNullishCoalescingAssign | OpCode::BinLogicalOrAssign | OpCode::BinLogicalAndAssign)
}

fn is_update(op: OpCode) -> bool {
    matches!(op, OpCode::UnPreDec | OpCode::UnPreInc | OpCode::UnPostDec | OpCode::UnPostInc)
}

impl<'p, 'a> Sites<'p, 'a> {
    fn has_ts(&self, expr: &Expr) -> bool {
        !self.ts_wrapped.is_empty() && self.ts_wrapped.contains(&ExprId::of(expr))
    }

    fn flag(&mut self, at: i32, text: &str) {
        self.pending.entry(at).or_default().push_str(text);
    }

    fn ident(&mut self, at: i32, name: &[u8]) {
        let mut flags = self.pending.remove(&at).unwrap_or_default();
        if self.loop_depth > 0 {
            flags.push('L');
        }
        flags.push_str(match self.fns.last() {
            None => " f:n",
            Some(Storable::Yes) => " f:y",
            Some(Storable::No) => " f:N",
            Some(Storable::Assign(index)) => {
                if self.names.get(*index as usize).is_some_and(|left| *left == name) {
                    " f:As"
                } else {
                    " f:Ao"
                }
            }
        });
        self.out.push((at, flags));
    }

    /// Whether the first statement of the body of a for-in/of is a `return`, as the source has it.
    fn returns_first(&self, body: &Stmt) -> bool {
        match &body.data {
            StmtData::SReturn(_) => true,
            StmtData::SBlock(_) => {
                let Ok(mut at) = usize::try_from(body.loc.start) else { return false };
                if self.text.get(at) != Some(&b'{') {
                    return false;
                }
                at += 1;
                loop {
                    match self.text.get(at..) {
                        Some([b' ' | b'\t' | b'\n' | b'\r', ..]) => at += 1,
                        Some([b'/', b'/', ..]) => {
                            while !matches!(self.text.get(at), None | Some(b'\n' | b'\r')) {
                                at += 1;
                            }
                        }
                        Some([b'/', b'*', ..]) => {
                            at += 2;
                            while at < self.text.len() && self.text.get(at..at + 2) != Some(b"*/".as_slice()) {
                                at += 1;
                            }
                            at += 2;
                        }
                        Some(rest) => {
                            return rest.starts_with(b"return") && !rest.get(6).is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'$' || *c >= 0x80);
                        }
                        None => return false,
                    }
                }
            }
            _ => false,
        }
    }

    /// A node where the source has an assignment target: no identifier in it is the left side of an assignment expression.
    fn pattern<'ast>(&mut self, expr: &'ast Expr, context: Storable) {
        match &expr.data {
            ExprData::EArray(node) if !self.has_ts(expr) => {
                for item in node.items.as_slice().iter() {
                    self.pattern(item, context);
                }
            }
            ExprData::EObject(node) if !self.has_ts(expr) => {
                for property in node.properties.as_slice().iter() {
                    if let Some(key) = &property.key {
                        self.storable = context;
                        self.visit_expr(key);
                    }
                    if let Some(value) = &property.value {
                        self.pattern(value, context);
                    }
                    if let Some(initializer) = &property.initializer {
                        self.storable = context;
                        self.visit_expr(initializer);
                    }
                }
            }
            ExprData::EBinary(node) if node.op == OpCode::BinAssign && !self.has_ts(expr) => {
                self.pattern(&node.left, context);
                self.storable = context;
                self.visit_expr(&node.right);
            }
            ExprData::ESpread(node) => self.pattern(&node.value, context),
            ExprData::EIdentifier(node) => {
                let name = self.parsed.name_of(node.ref_);
                self.ident(expr.loc.start, name);
            }
            _ => {
                self.storable = context;
                self.visit_expr(expr);
            }
        }
    }

    fn binary<'ast>(&mut self, expr: &'ast Expr, node: &'ast E::Binary, unused: bool, storable: Storable) {
        if node.op == OpCode::BinComma {
            self.unused = true;
            self.storable = Storable::No;
            self.visit_expr(&node.left);
            self.unused = unused;
            self.storable = storable;
            self.visit_expr(&node.right);
            return;
        }
        if is_assign(node.op) {
            let mut index = u32::MAX;
            if let ExprData::EIdentifier(left) = &node.left.data
                && !self.has_ts(&node.left)
            {
                let mut flags = String::from("a");
                if is_logical_assign(node.op) {
                    flags.push('l');
                }
                if unused {
                    flags.push('x');
                }
                self.flag(node.left.loc.start, &flags);
                index = self.names.len() as u32;
                self.names.push(self.parsed.name_of(left.ref_));
            }
            let context = Storable::Assign(index);
            if node.op == OpCode::BinAssign && matches!(node.left.data, ExprData::EArray(_) | ExprData::EObject(_)) && !self.has_ts(&node.left) {
                self.pattern(&node.left, context);
            } else {
                self.storable = context;
                self.visit_expr(&node.left);
            }
            self.storable = context;
            self.visit_expr(&node.right);
            return;
        }
        // A chain of other operators: down its left spine without recursion.
        let _ = expr;
        let mut rights = vec![&node.right];
        let mut leftmost = &node.left;
        while let ExprData::EBinary(inner) = &leftmost.data {
            if inner.op == OpCode::BinComma || is_assign(inner.op) || self.has_ts(leftmost) {
                break;
            }
            rights.push(&inner.right);
            leftmost = &inner.left;
        }
        self.storable = storable;
        self.visit_expr(leftmost);
        for right in rights.into_iter().rev() {
            self.storable = storable;
            self.visit_expr(right);
        }
    }

    fn function<'ast>(&mut self, func: &'ast G::Fn, verdict: Storable, inside: Storable) {
        self.fns.push(verdict);
        let loop_depth = core::mem::replace(&mut self.loop_depth, 0);
        let at_top = core::mem::replace(&mut self.at_top, false);
        self.args(func.args.slice(), inside);
        for stmt in func.body.stmts.slice() {
            self.visit_stmt(stmt);
        }
        self.at_top = at_top;
        self.loop_depth = loop_depth;
        self.fns.pop();
    }

    fn args<'ast>(&mut self, args: &'ast [G::Arg], inside: Storable) {
        for arg in args {
            for decorator in arg.ts_decorators.iter() {
                self.storable = inside;
                self.visit_expr(decorator);
            }
            self.storable = inside;
            self.visit_binding(&arg.binding);
            if let Some(default) = &arg.default {
                self.storable = inside;
                self.visit_expr(default);
            }
        }
    }
}

impl<'ast> Visitor<'ast> for Sites<'_, '_> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        let at_top = core::mem::replace(&mut self.at_top, false);
        self.unused = false;
        self.storable = Storable::Yes;
        match &stmt.data {
            StmtData::SExpr(node) => {
                self.unused = true;
                self.visit_expr(&node.value);
            }
            StmtData::SFor(node) => {
                self.loop_depth += 1;
                if let Some(init) = &node.init {
                    if let StmtData::SExpr(head) = &init.data {
                        self.visit_expr(&head.value);
                    } else {
                        self.visit_stmt(init);
                    }
                }
                if let Some(test) = &node.test {
                    self.storable = Storable::Yes;
                    self.visit_expr(test);
                }
                if let Some(update) = &node.update {
                    self.storable = Storable::Yes;
                    self.visit_expr(update);
                }
                self.visit_stmt(&node.body);
                self.loop_depth -= 1;
            }
            StmtData::SForIn(_) | StmtData::SForOf(_) => {
                let (init, value, body) = match &stmt.data {
                    StmtData::SForIn(node) => (&node.init, &node.value, &node.body),
                    StmtData::SForOf(node) => (&node.init, &node.value, &node.body),
                    _ => return,
                };
                self.loop_depth += 1;
                let returns = self.returns_first(body);
                if let StmtData::SExpr(head) = &init.data {
                    if returns && matches!(head.value.data, ExprData::EIdentifier(_)) && !self.has_ts(&head.value) {
                        self.flag(head.value.loc.start, "r");
                    }
                    if matches!(head.value.data, ExprData::EArray(_) | ExprData::EObject(_)) && !self.has_ts(&head.value) {
                        self.pattern(&head.value, Storable::Yes);
                    } else {
                        self.pattern(&head.value, Storable::Yes);
                    }
                } else {
                    self.visit_stmt(init);
                }
                if returns && matches!(value.data, ExprData::EIdentifier(_)) && !self.has_ts(value) {
                    self.flag(value.loc.start, "r");
                }
                self.storable = Storable::Yes;
                self.visit_expr(value);
                self.visit_stmt(body);
                self.loop_depth -= 1;
            }
            StmtData::SWhile(_) | StmtData::SDoWhile(_) => {
                self.loop_depth += 1;
                walk::walk_stmt(self, stmt);
                self.loop_depth -= 1;
            }
            StmtData::SFunction(node) => {
                // A declaration right in the file has no deciding ancestor; with `export` before it, it has.
                let verdict = if at_top && !node.func.flags.contains(G::FnFlags::IsExport) { Storable::No } else { Storable::Yes };
                self.function(&node.func, verdict, Storable::Yes);
            }
            StmtData::SExportDefault(node) => match &node.value {
                bun_ast::StmtOrExpr::Stmt(inner) => self.visit_stmt(inner),
                bun_ast::StmtOrExpr::Expr(inner) => self.visit_expr(inner),
            },
            _ => walk::walk_stmt(self, stmt),
        }
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        let unused = core::mem::replace(&mut self.unused, false) && !self.has_ts(expr);
        let storable = self.storable;
        match &expr.data {
            ExprData::EIdentifier(node) => {
                let name = self.parsed.name_of(node.ref_);
                self.ident(expr.loc.start, name);
            }
            ExprData::EBinary(node) => self.binary(expr, node, unused, storable),
            ExprData::EUnary(node) => {
                if is_update(node.op) && matches!(node.value.data, ExprData::EIdentifier(_)) && !self.has_ts(&node.value) {
                    self.flag(node.value.loc.start, if unused { "ux" } else { "u" });
                }
                self.visit_expr(&node.value);
            }
            ExprData::ECall(node) => {
                self.storable = Storable::No;
                self.visit_expr(&node.target);
                for arg in node.args.iter() {
                    self.storable = Storable::Yes;
                    self.visit_expr(arg);
                }
            }
            ExprData::ENew(node) => {
                self.storable = Storable::No;
                self.visit_expr(&node.target);
                for arg in node.args.iter() {
                    self.storable = Storable::Yes;
                    self.visit_expr(arg);
                }
            }
            ExprData::ETemplate(node) if node.tag.is_some() => {
                if let Some(tag) = &node.tag {
                    self.storable = Storable::Yes;
                    self.visit_expr(tag);
                }
                for part in node.parts.slice() {
                    self.storable = Storable::Yes;
                    self.visit_expr(&part.value);
                }
            }
            ExprData::EYield(node) => {
                if let Some(value) = &node.value {
                    self.storable = Storable::Yes;
                    self.visit_expr(value);
                }
            }
            ExprData::EFunction(node) => self.function(&node.func, storable, storable),
            ExprData::EArrow(node) => {
                self.fns.push(storable);
                let loop_depth = core::mem::replace(&mut self.loop_depth, 0);
                let at_top = core::mem::replace(&mut self.at_top, false);
                self.args(node.args.slice(), storable);
                let stmts = node.body.stmts.slice();
                match stmts {
                    // The expression after `=>` is no return statement: the arrow function is its parent.
                    [only] if node.prefer_expr => {
                        if let StmtData::SReturn(ret) = &only.data
                            && let Some(value) = &ret.value
                        {
                            self.storable = storable;
                            self.visit_expr(value);
                        } else {
                            self.visit_stmt(only);
                        }
                    }
                    _ => {
                        for stmt in stmts {
                            self.visit_stmt(stmt);
                        }
                    }
                }
                self.at_top = at_top;
                self.loop_depth = loop_depth;
                self.fns.pop();
            }
            _ => walk::walk_expr(self, expr),
        }
        self.storable = storable;
    }

    fn visit_e_binary(&mut self, node: &'ast E::Binary, _: bun_ast::Loc) -> Option<&'ast Expr> {
        walk::walk_e_binary(self, node)
    }
}

fn sites(path: &str) -> Option<String> {
    let text: &'static [u8] = std::fs::read(path).ok()?.leak();
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path.as_bytes().to_vec().leak() as &'static [u8], text);
    let loader = if path.ends_with(".tsx") {
        bun_ast::Loader::Tsx
    } else if path.ends_with("ts") {
        bun_ast::Loader::Ts
    } else if path.ends_with(".mjs") || path.ends_with(".cjs") {
        bun_ast::Loader::Js
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
    let parser = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    let result = parser.parse_for_lint(|parsed| {
        let mut ts_wrapped = HashSet::new();
        for record in &parsed.sidecar.wrappers.records {
            if !matches!(record.data, WrapperData::Parenthesized) {
                ts_wrapped.insert(ExprId::of(&record.operand));
            }
        }
        let mut walker = Sites {
            parsed,
            text,
            ts_wrapped,
            names: Vec::new(),
            out: Vec::new(),
            pending: HashMap::new(),
            unused: false,
            storable: Storable::No,
            loop_depth: 0,
            at_top: true,
            fns: Vec::new(),
        };
        for stmt in parsed.stmts {
            // SAFETY: the statement is in the arena of the parse, which lives until the closure returns.
            let stmt: &Stmt = unsafe { &*core::ptr::from_ref(stmt) };
            walker.at_top = true;
            walker.visit_stmt(stmt);
        }
        walker.out.sort();
        let mut out = String::new();
        for (at, flags) in &walker.out {
            out.push_str(&format!("{at}\t{flags}\n"));
        }
        out
    });
    match result {
        Ok(out) => Some(out),
        Err(_) => Some(String::from("PARSE_ERROR\n")),
    }
}

fn run() {
    for path in std::env::args().skip(1) {
        println!("== {path}");
        match sites(&path) {
            Some(out) => print!("{out}"),
            None => println!("CANNOT_READ_OR_INIT"),
        }
    }
}

fn main() {
    // A deep tree is walked by recursion: the thread has the stack for it.
    let child = std::thread::Builder::new().stack_size(1 << 30).spawn(run);
    if let Ok(handle) = child {
        let _ = handle.join();
    }
}
