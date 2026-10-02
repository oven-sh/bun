//! `checkSourceFile`: the statements of a file from top to bottom, each with all that is in it, then what was put off on the way
//! (`checkDeferredNodes`): the bodies of function expressions and the members of class expressions.
//!
//! A function here has the name of the function of checker.go it is the port of. It visits what that one visits, in that order, and
//! returns where that one returns. So every question is asked for the first time in the place TypeScript asks it, and where the
//! answer depends on what is under way, it is the same answer.

use super::errors_x_statements::is_with_statement;
use super::*;
use crate::bind::Parent;

/// `deferredNodes`
pub(super) enum DeferredNode {
    FunctionExpression(FnId),
    ClassExpression(ClassId),
}

impl Checker<'_> {
    /// `checkSourceFile`
    pub(super) fn check_source_file(&mut self, file: FileId) {
        let uncertain = self.uncertain;
        self.check_source_elements(file, self.hir(file).body);
        self.check_deferred_nodes(file);
        self.uncertain = uncertain;
    }

    /// `checkSourceElements`
    fn check_source_elements(&mut self, file: FileId, statements: IdList<StmtId>) {
        for s in self.hir(file).ids(statements) {
            self.check_source_element(file, s);
        }
    }

    /// `checkDeferredNodes`: what is put off meanwhile goes to the end of the line.
    fn check_deferred_nodes(&mut self, file: FileId) {
        let hir = self.hir(file);
        while let Some(node) = self.deferred_nodes.pop_front() {
            if self.timed_out() {
                break;
            }
            match node {
                // `checkFunctionExpressionOrObjectLiteralMethodDeferred`
                DeferredNode::FunctionExpression(func) => {
                    if hir[func].ret.is_none() {
                        self.return_type_of_fn(file, func);
                    }
                    self.check_function_body(file, func);
                }
                // `checkClassExpressionDeferred`
                DeferredNode::ClassExpression(class) => self.check_class_members(file, class),
            }
        }
        self.deferred_nodes.clear();
    }

    /// `checkSourceElement(node.Body())`, `checkExpressionCached(node.Body())`
    fn check_function_body(&mut self, file: FileId, func: FnId) {
        match self.hir(file)[func].body {
            FnBody::Block(list) => self.check_source_elements(file, list),
            FnBody::Expr(e) => self.check_expression(file, e),
            FnBody::None => {}
        }
    }

    /// `checkSignatureDeclaration`
    fn check_signature_declaration(&mut self, file: FileId, func: FnId) {
        let hir = self.hir(file);
        for p in hir[func].params.iter() {
            let param = &hir[p];
            if param.ty.is_some() {
                self.type_from_node(file, param.ty);
            }
            self.check_binding_name(file, param.pat);
            self.check_expression(file, param.default);
        }
        if hir[func].ret.is_some() {
            self.type_from_node(file, hir[func].ret);
        }
    }

    /// `checkFunctionOrMethodDeclaration`, `checkConstructorDeclaration`, `checkAccessorDeclaration`: the body is not put off.
    fn check_function_or_method_declaration(&mut self, file: FileId, func: FnId) {
        if func.is_none() {
            return;
        }
        self.check_signature_declaration(file, func);
        self.check_function_body(file, func);
    }

    /// `checkVariableLikeDeclaration`, as far as `node.Name()` goes: a name, or the elements of a pattern (`checkBindingElement`).
    fn check_binding_name(&mut self, file: FileId, pat: PatId) {
        if pat.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => {
                self.type_of_pat(file, pat);
            }
            PatKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(key) = hir[p].key {
                        self.check_expression(file, key);
                    }
                    self.check_binding_name(file, hir[p].value);
                    self.check_expression(file, hir[p].default);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.check_binding_name(file, hir[e].pat);
                    self.check_expression(file, hir[e].default);
                }
            }
        }
    }

    /// `checkVariableDeclarationList`
    fn check_variable_declaration_list(&mut self, file: FileId, decls: Span<VarDeclId>) {
        let hir = self.hir(file);
        for d in decls.iter() {
            let decl = &hir[d];
            if decl.ty.is_some() {
                self.type_from_node(file, decl.ty);
            }
            self.check_binding_name(file, decl.pat);
            self.check_expression(file, decl.init);
        }
    }

    /// `checkClassLikeDeclaration`, up to the members.
    fn check_class_like_declaration(&mut self, file: FileId, class: ClassId) {
        let symbol = self.bound(file).class_symbol[class.idx()];
        if symbol.is_some() {
            let sym = self.files().sym(file, symbol);
            self.declared_type(sym);
            self.type_of_symbol(sym);
            self.check_expression(file, self.hir(file)[class].extends);
            self.base_types(sym);
        }
    }

    /// `checkSourceElements(node.Members())` of `checkClassLikeDeclaration`
    fn check_class_members(&mut self, file: FileId, class: ClassId) {
        let hir = self.hir(file);
        for m in hir[class].members.iter() {
            let member = &hir[m];
            if let PropKey::Computed(key) = member.key {
                self.check_expression(file, key);
            }
            if member.ty.is_some() {
                self.type_from_node(file, member.ty);
            }
            self.check_function_or_method_declaration(file, member.func);
            self.check_expression(file, member.init);
        }
    }

    /// `checkSourceElement`, of a statement.
    fn check_source_element(&mut self, file: FileId, s: StmtId) {
        if s.is_none() || self.timed_out() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[s].kind {
            StmtKind::Expr(e) | StmtKind::Throw(e) => self.check_expression(file, e),
            // `checkExportAssignment`: out of place, or in a namespace, it is not looked at.
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                let is_looked_at = match bound.stmt_parent[s.idx()] {
                    Parent::File => true,
                    Parent::Module(m) => !matches!(hir[m].name, ModuleName::Ident(_)),
                    _ => false,
                };
                if is_looked_at {
                    self.check_expression(file, e);
                }
            }
            // `checkReturnStatement`: in no function, or in a static block, what is returned is not looked at. Elsewhere it is asked
            // what the function returns first.
            StmtKind::Return(e) => {
                if let Some(func) = self.enclosing_fn(file, Parent::Stmt(s))
                    && hir[func].kind != FnKind::StaticBlock
                {
                    self.return_type_of_fn(file, func);
                    self.check_expression(file, e);
                }
            }
            StmtKind::Var(decls) => self.check_variable_declaration_list(file, decls),
            StmtKind::Fn(func) => self.check_function_or_method_declaration(file, func),
            StmtKind::Class(class) => {
                self.check_class_like_declaration(file, class);
                self.check_class_members(file, class);
            }
            StmtKind::If { test, yes, no } => {
                self.check_expression(file, test);
                self.check_source_element(file, yes);
                self.check_source_element(file, no);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.check_source_element(file, init);
                self.check_expression(file, test);
                self.check_expression(file, update);
                self.check_source_element(file, body);
            }
            // `checkForInStatement`: the object first.
            StmtKind::ForIn { left, expr, body } => {
                self.check_expression(file, expr);
                self.check_source_element(file, left);
                self.check_source_element(file, body);
            }
            // `checkForOfStatement`: what is iterated is looked at for the variable (`checkRightHandSideOfForOf`), so not at all
            // where none is declared, and before what is written in the place of a declaration.
            StmtKind::ForOf {
                left, expr, body, ..
            } => {
                match hir[left].kind {
                    StmtKind::Var(decls) if decls.is_empty() => {}
                    StmtKind::Var(_) => {
                        self.check_source_element(file, left);
                        self.check_expression(file, expr);
                    }
                    _ => {
                        self.check_expression(file, expr);
                        self.check_source_element(file, left);
                    }
                }
                self.check_source_element(file, body);
            }
            StmtKind::While { test, body } => {
                self.check_expression(file, test);
                self.check_source_element(file, body);
            }
            StmtKind::DoWhile { body, test } => {
                self.check_source_element(file, body);
                self.check_expression(file, test);
            }
            // `checkWithStatement`: the object, and not the body.
            StmtKind::Block(list) if is_with_statement(hir, s) => {
                self.check_source_element(file, hir.id_at(list, 0));
            }
            StmtKind::Block(list) => self.check_source_elements(file, list),
            StmtKind::Switch { expr, cases } => {
                self.check_expression(file, expr);
                for c in cases.iter() {
                    self.check_expression(file, hir[c].test);
                    self.check_source_elements(file, hir[c].body);
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.check_source_element(file, block);
                self.check_source_element(file, handler);
                self.check_source_element(file, finalizer);
            }
            StmtKind::Labeled { body, .. } => self.check_source_element(file, body),
            StmtKind::Module(module) => self.check_source_elements(file, hir[module].body),
            StmtKind::Enum(e) => {
                for m in hir[e].members.iter() {
                    self.check_expression(file, hir[m].init);
                }
            }
            _ => {}
        }
    }

    /// For finding where less is looked at than `checkExpression` looks at: the operands of `e`, which has just been looked at, that
    /// nothing is known of.
    fn report_what_was_not_looked_at(&self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let mut operands: Vec<(&str, ExprId)> = Vec::new();
        match hir[e].kind {
            ExprKind::Template { exprs, .. } => {
                operands.extend(hir.ids(exprs).map(|x| ("part", x)))
            }
            ExprKind::Array(exprs) => operands.extend(hir.ids(exprs).map(|x| ("element", x))),
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                operands.push(("callee", hir[c].callee));
                operands.extend(hir.ids(hir[c].args).map(|x| ("argument", x)));
            }
            ExprKind::Object(props) => {
                operands.extend(props.iter().map(|p| ("value", hir[p].value)))
            }
            ExprKind::Dot { obj: x, .. }
            | ExprKind::Unary { operand: x, .. }
            | ExprKind::Spread(x)
            | ExprKind::Await(x)
            | ExprKind::Yield { value: x, .. }
            | ExprKind::As { expr: x, .. }
            | ExprKind::Satisfies { expr: x, .. }
            | ExprKind::AsConst(x)
            | ExprKind::NonNull(x)
            | ExprKind::Instantiation { expr: x, .. } => operands.push(("operand", x)),
            ExprKind::Index { obj, index, .. } => {
                operands.extend([("object", obj), ("index", index)])
            }
            ExprKind::Binary { left, right, .. } => {
                operands.extend([("left", left), ("right", right)])
            }
            ExprKind::Assign { target, value, .. } => {
                operands.extend([("target", target), ("value", value)])
            }
            ExprKind::Cond { test, yes, no } => {
                operands.extend([("test", test), ("yes", yes), ("no", no)])
            }
            ExprKind::Jsx(jsx) => {
                operands.extend(hir[jsx].attrs.iter().map(|p| ("attribute", hir[p].value)));
                operands.extend(hir.ids(hir[jsx].children).map(|x| ("child", x)));
            }
            _ => {}
        }
        for (role, x) in operands {
            if x.is_none()
                || matches!(
                    hir[x].kind,
                    ExprKind::Fn(_)
                        | ExprKind::Class(_)
                        | ExprKind::Missing
                        | ExprKind::Number(_)
                        | ExprKind::String(_)
                        | ExprKind::BigInt(_)
                        | ExprKind::True
                        | ExprKind::False
                        | ExprKind::Null
                        | ExprKind::Regex
                )
                || self.kept_type_of_expr(file, x).is_some()
                || self.looked_at.contains(&(file, x))
            {
                continue;
            }
            eprintln!(
                "GAP {:?} {role} {:?} {}:{}",
                hir[e].kind.tag(),
                hir[x].kind.tag(),
                self.files().module(file).path,
                hir[x].pos
            );
        }
    }

    /// `checkExpression`: `e`, then whatever in it that did not need looking at.
    fn check_expression(&mut self, file: FileId, e: ExprId) {
        if e.is_none() || self.is_stack_low() {
            return;
        }
        let hir = self.hir(file);
        self.type_of_expr(file, e);
        if self.trace_cycles {
            self.report_what_was_not_looked_at(file, e);
        }
        match hir[e].kind {
            ExprKind::Template { exprs, .. } | ExprKind::Array(exprs) => {
                for x in hir.ids(exprs) {
                    self.check_expression(file, x);
                }
            }
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                self.check_expression(file, hir[c].callee);
                for x in hir.ids(hir[c].args) {
                    self.check_expression(file, x);
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(key) = hir[p].key {
                        self.check_expression(file, key);
                    }
                    self.check_expression(file, hir[p].value);
                }
            }
            // `checkFunctionExpressionOrObjectLiteralMethod`: the signature now, and what it returns if something is expected of it.
            ExprKind::Fn(func) => {
                self.check_signature_declaration(file, func);
                if hir[func].ret.is_none() && self.contextual_signature(file, func).is_some() {
                    self.return_type_of_fn(file, func);
                }
                self.deferred_nodes
                    .push_back(DeferredNode::FunctionExpression(func));
            }
            // `checkClassExpression`
            ExprKind::Class(class) => {
                self.check_class_like_declaration(file, class);
                self.deferred_nodes
                    .push_back(DeferredNode::ClassExpression(class));
            }
            // `checkYieldExpression`: outside a generator what is yielded is not looked at.
            ExprKind::Yield { value, .. } => {
                if self.containing_generator(file, e).is_some() {
                    self.check_expression(file, value);
                }
            }
            ExprKind::Dot { obj: x, .. }
            | ExprKind::Unary { operand: x, .. }
            | ExprKind::Spread(x)
            | ExprKind::Await(x)
            | ExprKind::As { expr: x, .. }
            | ExprKind::Satisfies { expr: x, .. }
            | ExprKind::AsConst(x)
            | ExprKind::NonNull(x)
            | ExprKind::Instantiation { expr: x, .. }
            | ExprKind::ImportCall(x, _) => self.check_expression(file, x),
            ExprKind::Index {
                obj: a, index: b, ..
            }
            | ExprKind::Binary {
                left: a, right: b, ..
            }
            | ExprKind::Assign {
                target: a,
                value: b,
                ..
            } => {
                self.check_expression(file, a);
                self.check_expression(file, b);
            }
            ExprKind::Cond { test, yes, no } => {
                self.check_expression(file, test);
                self.check_expression(file, yes);
                self.check_expression(file, no);
            }
            ExprKind::Jsx(jsx) => {
                self.check_expression(file, hir[jsx].tag);
                for p in hir[jsx].attrs.iter() {
                    self.check_expression(file, hir[p].value);
                }
                for x in hir.ids(hir[jsx].children) {
                    self.check_expression(file, x);
                }
            }
            _ => {}
        }
    }
}
