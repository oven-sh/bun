//! Research probe: the calls that ESLint's code path analyzer makes, from Bun's tree as written.
//! usage: cpaprobe <file>...   for each file: `== <file>`, then one call per line, in order.
//! The walk here is the mapping of code-path-analyzer.js (preprocess, processCodePathToEnter,
//! processCodePathToExit, postprocess) onto `bun_ast::walk::Visitor`; replay.cjs runs the calls on ESLint's own
//! CodePathState and prints the arrows of every code path.
mod shims;

use std::collections::HashSet;

use bun_ast::walk::{self, Visitor};
use bun_ast::{B, Binding, E, Expr, ExprData, G, Loc, OpCode, OptionalChain, S, Stmt, StmtData};
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::{ExprId, WrapperData};

struct Walk<'p, 'a> {
    parsed: &'p ParsedForLint<'p, 'a>,
    text: &'a [u8],
    out: String,
    /// Nodes that are assignment targets and are not walked yet, the next one to be walked last.
    targets: Vec<usize>,
    /// The label of the labeled statement whose body is the next statement.
    label: Option<&'a [u8]>,
    /// The next expression is a test, or an operand of a logical expression.
    forking: bool,
    /// The next expression is the target of a member or call that is part of an optional chain.
    chain_target: bool,
    /// The next expression, when it is an identifier, is an element of an array pattern or the argument of a rest element.
    not_ref: bool,
    /// The next expression is the value of a class field.
    field_value: bool,
    /// The next binding, when it is an identifier, is one that `isIdentifierReference` answers true for.
    bind_ref: bool,
    /// Operands that `as`, `satisfies`, `!` or `<T>` is around.
    ts_wrapped: HashSet<ExprId>,
    /// Members and calls that parentheses are around.
    parenthesized: HashSet<ExprId>,
    /// Trace statements for the rule prototype.
    with_nodes: bool,
    /// The statement before the next one in the same list.
    list_prev: Option<usize>,
}

fn target_of(expr: &Expr) -> Option<usize> {
    match &expr.data {
        ExprData::EArray(array) => Some(core::ptr::from_ref::<E::Array>(array).addr()),
        ExprData::EObject(object) => Some(core::ptr::from_ref::<E::Object>(object).addr()),
        ExprData::EBinary(binary) if binary.op == OpCode::BinAssign => Some(core::ptr::from_ref::<E::Binary>(binary).addr()),
        ExprData::ESpread(spread) => match &spread.value.data {
            ExprData::EArray(_) | ExprData::EObject(_) => target_of(&spread.value),
            _ => None,
        },
        _ => None,
    }
}

fn logical(op: OpCode) -> Option<&'static str> {
    match op {
        OpCode::BinLogicalAnd | OpCode::BinLogicalAndAssign => Some("&&"),
        OpCode::BinLogicalOr | OpCode::BinLogicalOrAssign => Some("||"),
        OpCode::BinNullishCoalescing | OpCode::BinNullishCoalescingAssign => Some("??"),
        _ => None,
    }
}

fn breakable(stmt: &Stmt) -> bool {
    matches!(
        stmt.data,
        StmtData::SWhile(_) | StmtData::SDoWhile(_) | StmtData::SFor(_) | StmtData::SForIn(_) | StmtData::SForOf(_) | StmtData::SSwitch(_)
    )
}


/// The statement that has the last token of `stmt`: itself, or the one at the end of it.
fn innermost_tail(mut stmt: &Stmt) -> &Stmt {
    loop {
        stmt = match &stmt.data {
            StmtData::SIf(node) => node.no.as_ref().unwrap_or(&node.yes),
            StmtData::SWhile(node) => &node.body,
            StmtData::SFor(node) => &node.body,
            StmtData::SForIn(node) => &node.body,
            StmtData::SForOf(node) => &node.body,
            StmtData::SLabel(node) => &node.stmt,
            StmtData::SWith(node) => &node.body,
            _ => return stmt,
        };
    }
}

/// Whether a `;` after `stmt` can be its own last token.
fn can_own_semicolon(stmt: &Stmt) -> bool {
    match &innermost_tail(stmt).data {
        StmtData::SExpr(_)
        | StmtData::SLocal(_)
        | StmtData::SReturn(_)
        | StmtData::SThrow(_)
        | StmtData::SBreak(_)
        | StmtData::SContinue(_)
        | StmtData::SDebugger(_)
        | StmtData::SDoWhile(_)
        | StmtData::SDirective(_)
        | StmtData::SEmpty(_)
        | StmtData::SExportClause(_)
        | StmtData::SExportFrom(_)
        | StmtData::SExportStar(_)
        | StmtData::SExportEquals(_)
        | StmtData::SImport(_)
        | StmtData::STypeScript(_) => true,
        StmtData::SExportDefault(node) => matches!(node.value, bun_ast::StmtOrExpr::Expr(_)),
        _ => false,
    }
}

/// The child of `stmt` that has its last token.
fn tail_child(stmt: &Stmt) -> Option<usize> {
    let id = |stmt: &Stmt| core::ptr::from_ref(stmt).addr();
    match &stmt.data {
        StmtData::SIf(node) => Some(id(node.no.as_ref().unwrap_or(&node.yes))),
        StmtData::SWhile(node) => Some(id(&node.body)),
        StmtData::SFor(node) => Some(id(&node.body)),
        StmtData::SForIn(node) => Some(id(&node.body)),
        StmtData::SForOf(node) => Some(id(&node.body)),
        StmtData::SLabel(node) => Some(id(&node.stmt)),
        StmtData::SWith(node) => Some(id(&node.body)),
        StmtData::STry(node) => match (&node.finally, &node.catch) {
            (Some(finally), _) => Some(core::ptr::from_ref(finally).addr()),
            (None, Some(catch)) => Some(core::ptr::from_ref(catch).addr()),
            (None, None) => None,
        },
        StmtData::SExportDefault(node) => match &node.value {
            bun_ast::StmtOrExpr::Stmt(inner) => Some(id(inner)),
            bun_ast::StmtOrExpr::Expr(_) => None,
        },
        _ => None,
    }
}

/// What no-unreachable registers a handler for: `1`, `0`, or `x` for one that is exported.
fn registered(stmt: &Stmt) -> &'static str {
    match &stmt.data {
        StmtData::SBlock(_)
        | StmtData::SBreak(_)
        | StmtData::SContinue(_)
        | StmtData::SDebugger(_)
        | StmtData::SDoWhile(_)
        | StmtData::SExpr(_)
        | StmtData::SDirective(_)
        | StmtData::SForIn(_)
        | StmtData::SForOf(_)
        | StmtData::SFor(_)
        | StmtData::SIf(_)
        | StmtData::SLabel(_)
        | StmtData::SReturn(_)
        | StmtData::SSwitch(_)
        | StmtData::SThrow(_)
        | StmtData::STry(_)
        | StmtData::SWhile(_)
        | StmtData::SWith(_)
        | StmtData::SExportClause(_)
        | StmtData::SExportFrom(_)
        | StmtData::SExportStar(_)
        | StmtData::SExportDefault(_) => "1",
        StmtData::SClass(node) => if node.is_export { "x" } else { "1" },
        StmtData::SLocal(node) => {
            if node.is_export {
                "x"
            } else if node.kind != S::Kind::KVar || node.decls.iter().any(|decl| decl.value.is_some()) {
                "1"
            } else {
                "0"
            }
        }
        StmtData::SFunction(node) => {
            if node.func.flags.contains(bun_ast::flags::Function::IsExport) { "x" } else { "0" }
        }
        StmtData::SEnum(node) => if node.is_export { "x" } else { "0" },
        StmtData::SNamespace(node) => if node.is_export { "x" } else { "0" },
        _ => "0",
    }
}

impl<'ast> Walk<'_, 'ast> {
    /// The statements of one list: each knows the one before it.
    fn list(&mut self, stmts: &'ast [Stmt]) {
        let mut prev = None;
        for stmt in stmts {
            if matches!(stmt.data, StmtData::SComment(_)) {
                continue;
            }
            self.list_prev = prev;
            self.visit_stmt(stmt);
            prev = Some(core::ptr::from_ref(stmt).addr());
        }
        self.list_prev = None;
    }

    /// A block that is no statement of the tree: the body of a function, of `try`, of `catch` or of `finally`.
    fn block_enter(&mut self, id: usize, at: Loc) {
        if self.with_nodes {
            let text = format!("@stmt block {} {id} - 1 0", at.start);
            self.op(&text);
        }
    }

    fn block_leave(&mut self, id: usize) {
        if self.with_nodes {
            let text = format!("@leave {id} -");
            self.op(&text);
        }
    }
}

fn json(name: &[u8]) -> String {
    let mut out = String::from("\"");
    for ch in String::from_utf8_lossy(name).chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

impl<'a> Walk<'_, 'a> {
    fn op(&mut self, text: &str) {
        self.out.push_str(text);
        self.out.push('\n');
    }

    /// forwardCurrentToHead.
    fn f(&mut self) {
        self.op("F");
    }

    fn mark(&mut self, expr: &Expr) {
        if let Some(address) = target_of(expr) {
            self.targets.push(address);
        }
    }

    fn take(&mut self, address: usize) -> bool {
        if self.targets.last() == Some(&address) {
            self.targets.pop();
            return true;
        }
        false
    }

    fn label_of(&self, name: Option<&'a [u8]>) -> String {
        name.map_or("null".to_owned(), json)
    }

    fn is_ts_wrapped(&self, expr: &Expr) -> bool {
        !self.ts_wrapped.is_empty() && self.ts_wrapped.contains(&ExprId::of(expr))
    }

    /// getBooleanValueIfSimpleConstant: `null` where the node is no Literal.
    fn constant(&self, expr: &Expr) -> &'static str {
        if self.is_ts_wrapped(expr) {
            return "null";
        }
        let truthy = match &expr.data {
            ExprData::EBoolean(node) => node.value,
            ExprData::ENumber(node) => {
                let value = node.value();
                value != 0.0 && !value.is_nan()
            }
            ExprData::EString(node) if !node.prefer_template => node.len() > 0,
            ExprData::ENull(_) => false,
            ExprData::ERegExp(_) => true,
            ExprData::EBigInt(node) => {
                let text = node.value.slice();
                let digits = match text {
                    [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', rest @ ..] => rest,
                    all => all,
                };
                digits.iter().any(|&digit| digit != b'0' && digit != b'_' && digit != b'n')
            }
            _ => return "null",
        };
        if truthy { "true" } else { "false" }
    }

    /// `left` of an AssignmentPattern is walked; now its `right`.
    fn default_value(&mut self, value: &'a Expr)
    where
        Self: Visitor<'a>,
    {
        self.op("pushForkContext");
        self.op("forkBypassPath");
        self.op("forkPath");
        self.visit_expr(value);
    }

    /// The exit of an AssignmentPattern.
    fn default_end(&mut self) {
        self.op("popForkContext");
        self.f();
    }
}

impl<'ast> Walk<'_, 'ast> {
    fn args(&mut self, args: &'ast [G::Arg], has_rest: bool) {
        let count = args.len();
        for (index, arg) in args.iter().enumerate() {
            for decorator in arg.ts_decorators.iter() {
                self.visit_expr(decorator);
            }
            if let Some(default) = &arg.default {
                self.f();
                self.bind_ref = true;
                self.visit_binding(&arg.binding);
                self.default_value(default);
                self.default_end();
            } else if has_rest && index + 1 == count {
                self.f();
                self.bind_ref = false;
                self.visit_binding(&arg.binding);
                self.f();
            } else {
                self.bind_ref = true;
                self.visit_binding(&arg.binding);
            }
        }
    }

    fn body(&mut self, body: &'ast G::FnBody) {
        let id = core::ptr::from_ref(body).addr();
        self.f();
        self.block_enter(id, body.loc);
        self.list(body.stmts.slice());
        self.f();
        self.block_leave(id);
    }

    fn func(&mut self, func: &'ast G::Fn) {
        self.args(func.args.slice(), func.flags.contains(bun_ast::flags::Function::HasRestArg));
        self.body(&func.body);
    }

    fn class(&mut self, class: &'ast G::Class) {
        for decorator in class.ts_decorators.iter() {
            self.visit_expr(decorator);
        }
        if let Some(extends) = &class.extends {
            self.visit_expr(extends);
        }
        self.f();
        for property in class.properties.slice() {
            if let Some(block) = &property.class_static_block {
                self.op("start class-static-block");
                self.f();
                self.list(&block.stmts);
                self.f();
                self.op("end");
                continue;
            }
            self.f();
            for decorator in property.ts_decorators.iter() {
                self.visit_expr(decorator);
            }
            if let Some(key) = &property.key {
                if property.flags.contains(bun_ast::flags::Property::IsComputed) {
                    self.visit_expr(key);
                }
            }
            let is_constructor = property.kind == G::PropertyKind::Normal
                && property.flags.contains(bun_ast::flags::Property::IsMethod)
                && !property.flags.contains(bun_ast::flags::Property::IsStatic)
                && !property.flags.contains(bun_ast::flags::Property::IsComputed)
                && matches!(property.key.as_ref().map(|key| &key.data), Some(ExprData::EString(name)) if name.eql_comptime(b"constructor"));
            if is_constructor && self.with_nodes {
                self.op("@ctor-enter");
            }
            if let Some(value) = &property.value {
                self.visit_expr(value);
            }
            if is_constructor && self.with_nodes {
                let mut text = format!("@ctor-exit {}", u8::from(class.extends.is_some()));
                let mut prev: Option<usize> = None;
                for element in class.properties.slice() {
                    let id = core::ptr::from_ref(element).addr();
                    let is_field = element.kind == G::PropertyKind::Normal
                        && element.class_static_block.is_none()
                        && !element.flags.contains(bun_ast::flags::Property::IsMethod)
                        && !element.flags.contains(bun_ast::flags::Property::IsStatic);
                    if is_field {
                        let at = element.key.as_ref().map_or(-1, |key| key.loc.start);
                        let before = prev.map_or("-".to_owned(), |id| id.to_string());
                        text.push_str(&format!(" {at},{id},{before},{}", u8::from(element.flags.contains(bun_ast::flags::Property::IsComputed))));
                    }
                    prev = Some(id);
                }
                self.op(&text);
            }
            if let Some(initializer) = &property.initializer {
                self.field_value = property.kind != G::PropertyKind::AutoAccessor;
                self.visit_expr(initializer);
            }
            self.f();
        }
        self.f();
    }

    /// A property of an object literal, or of an object that is an assignment target.
    fn property(&mut self, property: &'ast G::Property, is_target: bool) {
        self.f();
        if property.kind == G::PropertyKind::Spread {
            if let Some(value) = &property.value {
                self.not_ref = is_target;
                if is_target {
                    self.mark(value);
                }
                self.visit_expr(value);
            }
            self.f();
            return;
        }
        let shorthand = property.flags.contains(bun_ast::flags::Property::WasShorthand);
        if let Some(key) = &property.key {
            if property.flags.contains(bun_ast::flags::Property::IsComputed) {
                self.visit_expr(key);
            } else if shorthand {
                self.f();
                self.op("makeFirstThrowablePathInTryOrCatchBlock");
            }
        }
        if property.initializer.is_some() {
            self.f();
        }
        if let Some(value) = &property.value {
            if is_target {
                self.mark(value);
            }
            self.visit_expr(value);
        }
        if let Some(initializer) = &property.initializer {
            self.default_value(initializer);
            self.default_end();
        }
        self.f();
    }
}

impl<'ast> Visitor<'ast> for Walk<'_, 'ast> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        let label = self.label.take();
        let list_prev = self.list_prev.take();
        if matches!(stmt.data, StmtData::SComment(_)) {
            return;
        }
        // processCodePathToEnter
        match &stmt.data {
            StmtData::SFunction(_) => self.op("start function"),
            StmtData::SSwitch(node) => {
                let has_case = node.cases.slice().iter().any(|case| case.value.is_some());
                let text = format!("pushSwitchContext [{has_case},{}]", self.label_of(label));
                self.op(&text);
            }
            StmtData::STry(node) => {
                let text = format!("pushTryContext [{}]", node.finally.is_some());
                self.op(&text);
            }
            StmtData::SIf(_) => self.op("pushChoiceContext [\"test\",false]"),
            StmtData::SWhile(_) => {
                let text = format!("pushLoopContext [\"WhileStatement\",{}]", self.label_of(label));
                self.op(&text);
            }
            StmtData::SDoWhile(_) => {
                let text = format!("pushLoopContext [\"DoWhileStatement\",{}]", self.label_of(label));
                self.op(&text);
            }
            StmtData::SFor(_) => {
                let text = format!("pushLoopContext [\"ForStatement\",{}]", self.label_of(label));
                self.op(&text);
            }
            StmtData::SForIn(_) => {
                let text = format!("pushLoopContext [\"ForInStatement\",{}]", self.label_of(label));
                self.op(&text);
            }
            StmtData::SForOf(_) => {
                let text = format!("pushLoopContext [\"ForOfStatement\",{}]", self.label_of(label));
                self.op(&text);
            }
            StmtData::SLabel(node) => {
                if !breakable(&node.stmt) {
                    let name = self.parsed.name_of(node.name.ref_);
                    let text = format!("pushBreakContext [false,{}]", json(name));
                    self.op(&text);
                }
            }
            _ => {}
        }
        self.f();
        if self.with_nodes {
            let kind = <&'static str>::from(stmt.data.tag());
            let prev = list_prev.map_or("-".to_owned(), |id| id.to_string());
            let text = format!(
                "@stmt {kind} {} {} {prev} {} {}",
                stmt.loc.start,
                core::ptr::from_ref(stmt).addr(),
                registered(stmt),
                u8::from(can_own_semicolon(stmt))
            );
            self.op(&text);
        }
        walk::walk_stmt(self, stmt);
        // processCodePathToExit
        let mut dont_forward = false;
        match &stmt.data {
            StmtData::SIf(_) => self.op("popChoiceContext"),
            StmtData::SSwitch(_) => self.op("popSwitchContext"),
            StmtData::STry(_) => self.op("popTryContext"),
            StmtData::SBreak(node) => {
                self.f();
                let name = node.label.as_ref().map(|label| self.parsed.name_of(label.ref_));
                let text = format!("makeBreak [{}]", self.label_of(name));
                self.op(&text);
                dont_forward = true;
            }
            StmtData::SContinue(node) => {
                self.f();
                let name = node.label.as_ref().map(|label| self.parsed.name_of(label.ref_));
                let text = format!("makeContinue [{}]", self.label_of(name));
                self.op(&text);
                dont_forward = true;
            }
            StmtData::SReturn(_) => {
                self.f();
                self.op("makeReturn");
                dont_forward = true;
            }
            StmtData::SThrow(_) => {
                self.f();
                self.op("makeThrow");
                dont_forward = true;
            }
            StmtData::SWhile(_) | StmtData::SDoWhile(_) | StmtData::SFor(_) | StmtData::SForIn(_) | StmtData::SForOf(_) => {
                self.op("popLoopContext");
            }
            StmtData::SLabel(node) => {
                if !breakable(&node.stmt) {
                    self.op("popBreakContext");
                }
            }
            _ => {}
        }
        if !dont_forward {
            self.f();
        }
        if self.with_nodes {
            let tail = tail_child(stmt).map_or("-".to_owned(), |id| id.to_string());
            let text = format!("@leave {} {tail}", core::ptr::from_ref(stmt).addr());
            self.op(&text);
        }
        // postprocess
        if matches!(stmt.data, StmtData::SFunction(_)) {
            self.op("end");
        }
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        let forking = core::mem::take(&mut self.forking);
        let from_chain = core::mem::take(&mut self.chain_target);
        let not_ref = core::mem::take(&mut self.not_ref);
        let field_value = core::mem::take(&mut self.field_value);
        if matches!(expr.data, ExprData::EMissing(_)) {
            return;
        }
        let optional_chain = match &expr.data {
            ExprData::EDot(node) => node.optional_chain,
            ExprData::EIndex(node) => node.optional_chain,
            ExprData::ECall(node) => node.optional_chain,
            _ => None,
        };
        // Parentheses end a chain: ESTree has a ChainExpression of its own inside them.
        let chain_root = optional_chain.is_some() && (!from_chain || self.parenthesized.contains(&ExprId::of(expr)));
        // An AssignmentPattern in an assignment target: the `=` of a default.
        let mut is_default = false;
        // processCodePathToEnter
        if field_value {
            self.op("start class-field-initializer");
        }
        if chain_root {
            self.op("pushChainContext");
            self.f();
        }
        match &expr.data {
            ExprData::EFunction(_) | ExprData::EArrow(_) => self.op("start function"),
            ExprData::EDot(_) | ExprData::EIndex(_) | ExprData::ECall(_) => {
                if optional_chain == Some(OptionalChain::Start) {
                    self.op("makeOptionalNode");
                }
            }
            ExprData::EBinary(node) => {
                if node.op == OpCode::BinAssign && self.take(core::ptr::from_ref::<E::Binary>(node).addr()) {
                    is_default = true;
                } else if let Some(kind) = logical(node.op) {
                    let forks = forking && !self.is_ts_wrapped(expr);
                    let text = format!("pushChoiceContext [\"{kind}\",{forks}]");
                    self.op(&text);
                }
            }
            ExprData::EIf(_) => self.op("pushChoiceContext [\"test\",false]"),
            ExprData::ESpread(_) => self.not_ref = not_ref,
            _ => {}
        }
        self.f();
        match &expr.data {
            // The loop of `walk_expr` is not used: the operands are walked in the order they are evaluated.
            ExprData::EBinary(node) => self.binary(node, is_default),
            _ => walk::walk_expr(self, expr),
        }
        // processCodePathToExit
        let mut dont_forward = false;
        match &expr.data {
            ExprData::EIf(_) => self.op("popChoiceContext"),
            ExprData::EBinary(node) => {
                if is_default {
                    self.op("popForkContext");
                } else if logical(node.op).is_some() {
                    self.op("popChoiceContext");
                }
            }
            ExprData::EIdentifier(_) => {
                if !not_ref {
                    self.op("makeFirstThrowablePathInTryOrCatchBlock");
                    dont_forward = true;
                }
            }
            ExprData::ECall(_) | ExprData::EImport(_) | ExprData::EDot(_) | ExprData::EIndex(_) | ExprData::ENew(_) => {
                self.op("makeFirstThrowablePathInTryOrCatchBlock");
            }
            // A MetaProperty: its two names are identifiers that `isIdentifierReference` takes for references.
            ExprData::ENewTarget(_) | ExprData::EImportMeta(_) => {
                self.op("makeFirstThrowablePathInTryOrCatchBlock");
            }
            ExprData::EYield(_) => self.op("makeYield"),
            _ => {}
        }
        if !dont_forward {
            self.f();
        }
        // postprocess
        match &expr.data {
            ExprData::EFunction(_) | ExprData::EArrow(_) => self.op("end"),
            ExprData::ECall(node) => {
                if optional_chain == Some(OptionalChain::Start) && node.args.is_empty() {
                    self.op("makeOptionalRight");
                }
            }
            _ => {}
        }
        if chain_root {
            self.op("popChainContext");
            self.f();
        }
        // `as`, `satisfies`, `!` and `<T>` are nodes of typescript-eslint around this one: their exit forwards.
        if self.is_ts_wrapped(expr) {
            self.f();
        }
        if field_value {
            self.op("end");
        }
    }

    fn visit_binding(&mut self, binding: &'ast Binding) {
        let is_ref = core::mem::take(&mut self.bind_ref);
        match &binding.data {
            B::B::BMissing(_) => {}
            B::B::BIdentifier(_) => {
                self.f();
                if is_ref {
                    self.op("makeFirstThrowablePathInTryOrCatchBlock");
                } else {
                    self.f();
                }
            }
            B::B::BArray(node) => {
                self.f();
                let items = node.items.slice();
                let count = items.len();
                for (index, item) in items.iter().enumerate() {
                    if let Some(default) = &item.default_value {
                        self.f();
                        self.bind_ref = true;
                        self.visit_binding(&item.binding);
                        self.default_value(default);
                        self.default_end();
                    } else if node.has_spread && index + 1 == count {
                        self.f();
                        self.visit_binding(&item.binding);
                        self.f();
                    } else {
                        self.visit_binding(&item.binding);
                    }
                }
                self.f();
            }
            B::B::BObject(node) => {
                self.f();
                for property in node.properties.slice() {
                    self.f();
                    if property.flags.contains(bun_ast::flags::Property::IsSpread) {
                        self.visit_binding(&property.value);
                        self.f();
                        continue;
                    }
                    if property.flags.contains(bun_ast::flags::Property::IsComputed) {
                        self.visit_expr(&property.key);
                    } else if property.key.loc.start == property.value.loc.start
                        && matches!(property.value.data, B::B::BIdentifier(_))
                    {
                        // A shorthand: its key is an identifier that `isIdentifierReference` takes for a reference.
                        self.f();
                        self.op("makeFirstThrowablePathInTryOrCatchBlock");
                    }
                    if let Some(default) = &property.default_value {
                        self.f();
                        self.bind_ref = true;
                        self.visit_binding(&property.value);
                        self.default_value(default);
                        self.default_end();
                    } else {
                        self.bind_ref = true;
                        self.visit_binding(&property.value);
                    }
                    self.f();
                }
                self.f();
            }
        }
    }

    fn visit_s_if(&mut self, node: &'ast S::If, _: Loc) {
        self.forking = true;
        self.visit_expr(&node.test);
        self.op("makeIfConsequent");
        self.visit_stmt(&node.yes);
        if let Some(no) = &node.no {
            self.op("makeIfAlternate");
            self.visit_stmt(no);
        }
    }

    fn visit_s_while(&mut self, node: &'ast S::While, _: Loc) {
        let text = format!("makeWhileTest [{}]", self.constant(&node.test));
        self.op(&text);
        self.forking = true;
        self.visit_expr(&node.test);
        self.op("makeWhileBody");
        self.visit_stmt(&node.body);
    }

    fn visit_s_do_while(&mut self, node: &'ast S::DoWhile, _: Loc) {
        self.op("makeDoWhileBody");
        self.visit_stmt(&node.body);
        let text = format!("makeDoWhileTest [{}]", self.constant(&node.test));
        self.op(&text);
        self.forking = true;
        self.visit_expr(&node.test);
    }

    fn visit_s_for(&mut self, node: &'ast S::For, _: Loc) {
        if let Some(init) = &node.init {
            match &init.data {
                StmtData::SExpr(head) => self.visit_expr(&head.value),
                _ => self.visit_stmt(init),
            }
        }
        if let Some(test) = &node.test {
            let text = format!("makeForTest [{}]", self.constant(test));
            self.op(&text);
            self.forking = true;
            self.visit_expr(test);
        }
        if let Some(update) = &node.update {
            self.op("makeForUpdate");
            self.visit_expr(update);
        }
        self.op("makeForBody");
        self.visit_stmt(&node.body);
    }

    fn visit_s_for_in(&mut self, node: &'ast S::ForIn, _: Loc) {
        self.op("makeForInOfLeft");
        match &node.init.data {
            StmtData::SExpr(head) => {
                self.mark(&head.value);
                self.visit_expr(&head.value);
            }
            _ => self.visit_stmt(&node.init),
        }
        self.op("makeForInOfRight");
        self.visit_expr(&node.value);
        self.op("makeForInOfBody");
        self.visit_stmt(&node.body);
    }

    fn visit_s_for_of(&mut self, node: &'ast S::ForOf, _: Loc) {
        self.op("makeForInOfLeft");
        match &node.init.data {
            StmtData::SExpr(head) => {
                self.mark(&head.value);
                self.visit_expr(&head.value);
            }
            _ => self.visit_stmt(&node.init),
        }
        self.op("makeForInOfRight");
        self.visit_expr(&node.value);
        self.op("makeForInOfBody");
        self.visit_stmt(&node.body);
    }

    fn visit_s_label(&mut self, node: &'ast S::Label, _: Loc) {
        self.label = Some(self.parsed.name_of(node.name.ref_));
        self.visit_stmt(&node.stmt);
    }

    fn visit_s_switch(&mut self, node: &'ast S::Switch, _: Loc) {
        self.visit_expr(&node.test);
        for (index, case) in node.cases.slice().iter().enumerate() {
            // A SwitchCase: processCodePathToEnter.
            if index > 0 {
                self.op("forkPath");
            }
            self.f();
            if let Some(value) = &case.value {
                self.visit_expr(value);
            }
            let is_default = case.value.is_none();
            let body = case.body.slice();
            let mut prev = None;
            for (at, stmt) in body.iter().enumerate() {
                if at == 0 {
                    let text = format!("makeSwitchCaseBody [false,{is_default}]");
                    self.op(&text);
                }
                self.list_prev = prev;
                self.visit_stmt(stmt);
                prev = Some(core::ptr::from_ref(stmt).addr());
            }
            // A SwitchCase: processCodePathToExit.
            if body.is_empty() {
                let text = format!("makeSwitchCaseBody [true,{is_default}]");
                self.op(&text);
            }
            self.op("F-unless-reachable");
        }
    }

    fn visit_s_try(&mut self, node: &'ast S::Try, _: Loc) {
        let body_id = core::ptr::from_ref(&node.body_loc).addr();
        self.f();
        self.block_enter(body_id, node.body_loc);
        self.list(node.body.slice());
        self.f();
        self.block_leave(body_id);
        if let Some(catch) = &node.catch {
            let id = core::ptr::from_ref(catch).addr();
            self.op("makeCatchBlock");
            self.f();
            if let Some(binding) = &catch.binding {
                self.visit_binding(binding);
            }
            self.f();
            self.block_enter(id, catch.body_loc);
            self.list(catch.body.slice());
            self.f();
            self.block_leave(id);
            self.f();
        }
        if let Some(finally) = &node.finally {
            let id = core::ptr::from_ref(finally).addr();
            self.op("makeFinallyBlock");
            self.f();
            if self.with_nodes {
                // Its `{` is the token after `finally`.
                let text = format!("@stmt finally {} {id} - 1 0", finally.loc.start);
                self.op(&text);
            }
            self.list(finally.stmts.slice());
            self.f();
            self.block_leave(id);
        }
    }

    fn visit_s_local(&mut self, node: &'ast S::Local, _: Loc) {
        for decl in node.decls.iter() {
            self.f();
            self.visit_binding(&decl.binding);
            if let Some(value) = &decl.value {
                self.visit_expr(value);
            }
            self.f();
        }
    }

    fn visit_s_enum(&mut self, node: &'ast S::Enum, _: Loc) {
        // A TSEnumDeclaration: its name is an Identifier that `isIdentifierReference` takes for a reference.
        self.op("makeFirstThrowablePathInTryOrCatchBlock");
        self.f();
        for value in node.values.slice() {
            self.f();
            let at = usize::try_from(value.loc.start).unwrap_or(usize::MAX);
            let quoted = matches!(self.text.get(at), Some(b'"' | b'\'' | b'`'));
            if !quoted {
                self.f();
                self.op("makeFirstThrowablePathInTryOrCatchBlock");
            }
            if let Some(init) = &value.value {
                self.visit_expr(init);
            }
            self.f();
        }
    }

    fn visit_s_namespace(&mut self, node: &'ast S::Namespace, _: Loc) {
        // A TSModuleDeclaration: its name is an Identifier that `isIdentifierReference` takes for a reference.
        self.op("makeFirstThrowablePathInTryOrCatchBlock");
        self.f();
        self.list(node.stmts.slice());
    }

    fn visit_s_block(&mut self, node: &'ast S::Block, _: Loc) {
        self.list(node.stmts.slice());
    }

    fn visit_s_function(&mut self, node: &'ast S::Function, _: Loc) {
        self.func(&node.func);
    }

    fn visit_s_class(&mut self, node: &'ast S::Class, _: Loc) {
        self.class(&node.class);
    }

    fn visit_e_class(&mut self, node: &'ast E::Class, _: Loc) {
        self.class(node);
    }

    fn visit_e_function(&mut self, node: &'ast E::Function, _: Loc) {
        self.func(&node.func);
    }

    fn visit_e_arrow(&mut self, node: &'ast E::Arrow, _: Loc) {
        self.args(node.args.slice(), node.has_rest_arg);
        if node.prefer_expr {
            // The parse pass wraps the expression in a return statement: ESTree has the expression alone.
            if let Some(StmtData::SReturn(ret)) = node.body.stmts.slice().first().map(|stmt| &stmt.data) {
                if let Some(value) = &ret.value {
                    self.visit_expr(value);
                }
            }
        } else {
            self.body(&node.body);
        }
    }

    fn visit_e_if(&mut self, node: &'ast E::If, _: Loc) {
        self.forking = true;
        self.visit_expr(&node.test);
        self.op("makeIfConsequent");
        self.visit_expr(&node.yes);
        self.op("makeIfAlternate");
        self.visit_expr(&node.no);
    }

    fn visit_e_dot(&mut self, node: &'ast E::Dot, _: Loc) {
        self.chain_target = node.optional_chain.is_some();
        self.visit_expr(&node.target);
        if node.optional_chain == Some(OptionalChain::Start) {
            self.op("makeOptionalRight");
        }
        // The property is an Identifier that `isIdentifierReference` takes for a reference.
        self.f();
        self.op("makeFirstThrowablePathInTryOrCatchBlock");
    }

    fn visit_e_index(&mut self, node: &'ast E::Index, _: Loc) {
        self.chain_target = node.optional_chain.is_some();
        self.visit_expr(&node.target);
        if node.optional_chain == Some(OptionalChain::Start) {
            self.op("makeOptionalRight");
        }
        self.visit_expr(&node.index);
    }

    fn visit_e_call(&mut self, node: &'ast E::Call, _: Loc) {
        if self.with_nodes && matches!(node.target.data, ExprData::ESuper(_)) {
            self.op("@super-call");
        }
        self.chain_target = node.optional_chain.is_some();
        self.visit_expr(&node.target);
        for (index, arg) in node.args.iter().enumerate() {
            if index == 0 && node.optional_chain == Some(OptionalChain::Start) {
                self.op("makeOptionalRight");
            }
            self.visit_expr(arg);
        }
    }

    fn visit_e_array(&mut self, node: &'ast E::Array, _: Loc) {
        let is_target = self.take(core::ptr::from_ref(node).addr());
        if is_target {
            for item in node.items.iter().rev() {
                self.mark(item);
            }
        }
        for item in node.items.iter() {
            self.not_ref = is_target;
            self.visit_expr(item);
        }
        self.not_ref = false;
    }

    fn visit_e_object(&mut self, node: &'ast E::Object, _: Loc) {
        let is_target = self.take(core::ptr::from_ref(node).addr());
        for property in node.properties.iter() {
            self.property(property, is_target);
        }
    }

    fn visit_e_jsx_element(&mut self, node: &'ast E::JSXElement, _: Loc) {
        // The tag is a JSXIdentifier or a JSXMemberExpression: no Identifier and no MemberExpression.
        for property in node.properties.iter() {
            if let Some(value) = &property.value {
                self.visit_expr(value);
            }
        }
        for child in node.children.iter() {
            self.visit_expr(child);
        }
    }
}

impl<'ast> Walk<'_, 'ast> {
    /// The operands of a binary expression in the order they are evaluated, a chain of left operands without recursion.
    fn binary(&mut self, outer: &'ast E::Binary, outer_is_default: bool) {
        // `outer`, then each binary expression that is the left operand of the one before it, with what its enter decided.
        let mut links: Vec<(&'ast E::Binary, bool)> = vec![(outer, outer_is_default)];
        let mut link = outer;
        loop {
            if link.op == OpCode::BinAssign && matches!(link.left.data, ExprData::EArray(_) | ExprData::EObject(_)) {
                self.mark(&link.left);
            }
            let ExprData::EBinary(left) = &link.left.data else {
                break;
            };
            // processCodePathToEnter of `left`, an operand of `link`.
            let mut is_default = false;
            if left.op == OpCode::BinAssign && self.take(core::ptr::from_ref::<E::Binary>(left).addr()) {
                is_default = true;
            } else if let Some(kind) = logical(left.op) {
                let forks = logical(link.op).is_some() && !self.is_ts_wrapped(&link.left);
                let text = format!("pushChoiceContext [\"{kind}\",{forks}]");
                self.op(&text);
            }
            self.f();
            links.push((left, is_default));
            link = left;
        }
        self.forking = logical(link.op).is_some();
        self.visit_expr(&link.left);
        while let Some((link, is_default)) = links.pop() {
            if is_default {
                self.default_value(&link.right);
            } else {
                if logical(link.op).is_some() {
                    self.op("makeLogicalRight");
                    self.forking = true;
                }
                self.visit_expr(&link.right);
            }
            if links.is_empty() {
                // processCodePathToExit of `outer` is its caller's.
                break;
            }
            if is_default {
                self.default_end();
            } else {
                if logical(link.op).is_some() {
                    self.op("popChoiceContext");
                }
                self.f();
            }
        }
    }
}

fn trace(path: &str, with_nodes: bool) -> Option<String> {
    let text = std::fs::read(path).ok()?;
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path.as_bytes().to_vec().leak() as &'static [u8], text.leak() as &'static [u8]);
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
        let ts_wrapped = parsed
            .sidecar
            .wrappers
            .records
            .iter()
            .filter(|record| !matches!(record.data, WrapperData::Parenthesized))
            .map(|record| ExprId::of(&record.operand))
            .collect();
        let parenthesized = parsed
            .sidecar
            .wrappers
            .records
            .iter()
            .filter(|record| {
                matches!(record.data, WrapperData::Parenthesized)
                    && matches!(record.operand.data, ExprData::EDot(_) | ExprData::EIndex(_) | ExprData::ECall(_))
            })
            .map(|record| ExprId::of(&record.operand))
            .collect();
        let mut walk = Walk {
            parsed,
            text: &source.contents,
            out: String::new(),
            targets: Vec::new(),
            label: None,
            forking: false,
            chain_target: false,
            not_ref: false,
            field_value: false,
            bind_ref: false,
            ts_wrapped,
            parenthesized,
            with_nodes,
            list_prev: None,
        };
        walk.op("start program");
        walk.f();
        walk.list(parsed.stmts);
        walk.f();
        if with_nodes {
            walk.op("@program-exit");
        }
        walk.op("end");
        walk.out
    });
    match result {
        Ok(out) => Some(out),
        Err(_) => {
            let mut out = String::from("PARSE_ERROR\n");
            for msg in &log.msgs {
                out.push_str(&format!("# {}\n", bstr::BStr::new(&msg.data.text)));
            }
            Some(out)
        }
    }
}

fn main() {
    let mut with_nodes = false;
    for path in std::env::args().skip(1) {
        if path == "--nodes" {
            with_nodes = true;
            continue;
        }
        println!("== {path}");
        match trace(&path, with_nodes) {
            Some(out) => print!("{out}"),
            None => println!("CANNOT_READ_OR_INIT"),
        }
    }
}
