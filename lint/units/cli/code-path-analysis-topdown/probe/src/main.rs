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
    dont_forward: bool,
    /// Operands that `as`, `satisfies`, `!` or `<T>` is around.
    ts_wrapped: HashSet<ExprId>,
    /// Trace statements for the rule prototype.
    with_nodes: bool,
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

    /// getBooleanValueIfSimpleConstant: `t`, `f`, or `u` where the node is no Literal.
    fn constant(&self, expr: &Expr) -> &'static str {
        if self.is_ts_wrapped(expr) {
            return "u";
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
            _ => return "u",
        };
        if truthy { "t" } else { "f" }
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
        self.f();
        for stmt in body.stmts.slice() {
            self.visit_stmt(stmt);
        }
        self.f();
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
                self.f();
                self.op("start class-static-block");
                self.f();
                for stmt in block.stmts.iter() {
                    self.visit_stmt(stmt);
                }
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
            if let Some(value) = &property.value {
                self.visit_expr(value);
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
        }
        self.f();
    }
}

impl<'ast> Visitor<'ast> for Walk<'_, 'ast> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        let label = self.label.take();
        if matches!(stmt.data, StmtData::SComment(_)) {
            return;
        }
        if self.with_nodes {
            let kind = <&'static str>::from(stmt.data.tag());
            self.op(&format!("@stmt {kind} {}", stmt.loc.start));
        }
        // processCodePathToEnter
        match &stmt.data {
            StmtData::SFunction(_) => {
                self.f();
                self.op("start function");
            }
            StmtData::SSwitch(node) => {
                let has_case = node.cases.slice().iter().any(|case| case.value.is_some());
                let text = format!("pushSwitchContext {} {}", u8::from(has_case), self.label_of(label));
                self.op(&text);
            }
            StmtData::STry(node) => {
                let text = format!("pushTryContext {}", u8::from(node.finally.is_some()));
                self.op(&text);
            }
            StmtData::SIf(_) => self.op("pushChoiceContext test 0"),
            StmtData::SWhile(_) => {
                let text = format!("pushLoopContext WhileStatement {}", self.label_of(label));
                self.op(&text);
            }
            StmtData::SDoWhile(_) => {
                let text = format!("pushLoopContext DoWhileStatement {}", self.label_of(label));
                self.op(&text);
            }
            StmtData::SFor(_) => {
                let text = format!("pushLoopContext ForStatement {}", self.label_of(label));
                self.op(&text);
            }
            StmtData::SForIn(_) => {
                let text = format!("pushLoopContext ForInStatement {}", self.label_of(label));
                self.op(&text);
            }
            StmtData::SForOf(_) => {
                let text = format!("pushLoopContext ForOfStatement {}", self.label_of(label));
                self.op(&text);
            }
            StmtData::SLabel(node) => {
                if !breakable(&node.stmt) {
                    let name = self.parsed.name_of(node.name.ref_);
                    let text = format!("pushBreakContext 0 {}", json(name));
                    self.op(&text);
                }
            }
            _ => {}
        }
        self.f();
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
                let text = format!("makeBreak {}", self.label_of(name));
                self.op(&text);
                dont_forward = true;
            }
            StmtData::SContinue(node) => {
                self.f();
                let name = node.label.as_ref().map(|label| self.parsed.name_of(label.ref_));
                let text = format!("makeContinue {}", self.label_of(name));
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
            self.op("@stmt-exit");
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
        let chain_root = optional_chain.is_some() && !from_chain;
        // An AssignmentPattern in an assignment target: the `=` of a default.
        let mut is_default = false;
        // processCodePathToEnter
        if field_value {
            self.f();
            self.op("start class-field-initializer");
        }
        if chain_root {
            self.op("pushChainContext");
            self.f();
        }
        match &expr.data {
            ExprData::EFunction(_) | ExprData::EArrow(_) => {
                self.f();
                self.op("start function");
            }
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
                    let text = format!("pushChoiceContext {kind} {}", u8::from(forks));
                    self.op(&text);
                }
            }
            ExprData::EIf(_) => self.op("pushChoiceContext test 0"),
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
        let mut dont_forward = core::mem::take(&mut self.dont_forward);
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
        let text = format!("makeWhileTest {}", self.constant(&node.test));
        self.op(&text);
        self.forking = true;
        self.visit_expr(&node.test);
        self.op("makeWhileBody");
        self.visit_stmt(&node.body);
    }

    fn visit_s_do_while(&mut self, node: &'ast S::DoWhile, _: Loc) {
        self.op("makeDoWhileBody");
        self.visit_stmt(&node.body);
        let text = format!("makeDoWhileTest {}", self.constant(&node.test));
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
            let text = format!("makeForTest {}", self.constant(test));
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
            let is_default = u8::from(case.value.is_none());
            let body = case.body.slice();
            for (at, stmt) in body.iter().enumerate() {
                if at == 0 {
                    let text = format!("makeSwitchCaseBody 0 {is_default}");
                    self.op(&text);
                }
                self.visit_stmt(stmt);
            }
            // A SwitchCase: processCodePathToExit.
            if body.is_empty() {
                let text = format!("makeSwitchCaseBody 1 {is_default}");
                self.op(&text);
            }
            self.op("F-unless-reachable");
        }
    }

    fn visit_s_try(&mut self, node: &'ast S::Try, _: Loc) {
        self.f();
        for stmt in node.body.slice() {
            self.visit_stmt(stmt);
        }
        self.f();
        if let Some(catch) = &node.catch {
            self.op("makeCatchBlock");
            self.f();
            if let Some(binding) = &catch.binding {
                self.visit_binding(binding);
            }
            self.f();
            for stmt in catch.body.slice() {
                self.visit_stmt(stmt);
            }
            self.f();
            self.f();
        }
        if let Some(finally) = &node.finally {
            self.op("makeFinallyBlock");
            self.f();
            for stmt in finally.stmts.slice() {
                self.visit_stmt(stmt);
            }
            self.f();
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
        // Each link of the chain below `outer`, with what its enter decided.
        let mut inner: Vec<(&'ast E::Binary, bool)> = Vec::new();
        let mut link = outer;
        let mut link_is_default = outer_is_default;
        loop {
            // `left` of `link` is next: mark it when it is an assignment target.
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
                let forks = logical(link.op).is_some() && !link_is_default && !self.is_ts_wrapped(&link.left);
                let text = format!("pushChoiceContext {kind} {}", u8::from(forks));
                self.op(&text);
            }
            self.f();
            inner.push((left, is_default));
            link = left;
            link_is_default = is_default;
        }
        self.forking = logical(link.op).is_some() && !link_is_default;
        self.visit_expr(&link.left);
        loop {
            // `right` of `link`.
            if link_is_default {
                self.default_value(&link.right);
            } else {
                if logical(link.op).is_some() {
                    self.op("makeLogicalRight");
                    self.forking = true;
                }
                self.visit_expr(&link.right);
            }
            let Some((done, is_default)) = inner.pop() else {
                break;
            };
            // processCodePathToExit of `done`; the one of `outer` is its caller's.
            if is_default {
                // popForkContext and the forward were made by `default_value`.
            } else {
                if logical(done.op).is_some() {
                    self.op("popChoiceContext");
                }
                self.f();
            }
            let _ = is_default;
            link = inner.last().map_or(outer, |(node, _)| *node);
            link_is_default = inner.last().map_or(outer_is_default, |(_, is_default)| *is_default);
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
        let mut walk = Walk {
            parsed,
            out: String::new(),
            targets: Vec::new(),
            label: None,
            forking: false,
            chain_target: false,
            not_ref: false,
            field_value: false,
            bind_ref: false,
            dont_forward: false,
            ts_wrapped,
            with_nodes,
        };
        walk.op("start program");
        walk.f();
        for stmt in parsed.stmts {
            walk.visit_stmt(stmt);
        }
        walk.f();
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
