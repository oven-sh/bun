//! The order TypeScript looks at a file in. `checkSourceFile`: the statements from top to bottom, each with all that is in it, then
//! what was put off on the way (`checkDeferredNodes`): the bodies of function expressions and the members of class expressions.
//!
//! Nothing is reported here. Every question is asked for the first time in the place TypeScript asks it, so that where the answer
//! depends on what is under way, it is the same answer. The passes that report errors find it kept.

use super::*;
use crate::bind::Parent;
use std::collections::VecDeque;

enum PutOff {
    Function(FnId),
    ClassExpression(ClassId),
}

impl Checker<'_> {
    pub(super) fn look_at_file_in_order(&mut self, file: FileId) {
        let hir = self.hir(file);
        let uncertain = self.uncertain;
        let mut put_off = VecDeque::new();
        for s in hir.ids(hir.body) {
            self.statement_in_order(file, s, &mut put_off);
        }
        // `checkDeferredNodes`: what is put off meanwhile goes to the end of the line.
        while let Some(next) = put_off.pop_front() {
            if self.timed_out() {
                break;
            }
            match next {
                // `checkFunctionExpressionOrObjectLiteralMethodDeferred`
                PutOff::Function(func) => {
                    if hir[func].ret.is_none() {
                        self.return_type_of_fn(file, func);
                    }
                    self.body_in_order(file, func, &mut put_off);
                }
                // `checkClassExpressionDeferred`
                PutOff::ClassExpression(class) => self.members_in_order(file, class, &mut put_off),
            }
        }
        self.uncertain = uncertain;
    }

    fn body_in_order(&mut self, file: FileId, func: FnId, put_off: &mut VecDeque<PutOff>) {
        let hir = self.hir(file);
        match hir[func].body {
            FnBody::Block(list) => {
                for s in hir.ids(list) {
                    self.statement_in_order(file, s, put_off);
                }
            }
            FnBody::Expr(e) => self.expression_in_order(file, e, put_off),
            FnBody::None => {}
        }
    }

    /// `checkSignatureDeclaration`
    fn signature_in_order(&mut self, file: FileId, func: FnId, put_off: &mut VecDeque<PutOff>) {
        let hir = self.hir(file);
        for p in hir[func].params.iter() {
            let param = &hir[p];
            if param.ty.is_some() {
                self.type_from_node(file, param.ty);
            }
            self.pattern_in_order(file, param.pat, put_off);
            self.expression_in_order(file, param.default, put_off);
        }
        if hir[func].ret.is_some() {
            self.type_from_node(file, hir[func].ret);
        }
    }

    /// `checkFunctionOrMethodDeclaration`, `checkConstructorDeclaration`, `checkAccessorDeclaration`: the body is not put off.
    fn declared_function_in_order(
        &mut self,
        file: FileId,
        func: FnId,
        put_off: &mut VecDeque<PutOff>,
    ) {
        if func.is_none() {
            return;
        }
        self.signature_in_order(file, func, put_off);
        self.body_in_order(file, func, put_off);
    }

    /// `checkVariableLikeDeclaration`, of the names in a pattern.
    fn pattern_in_order(&mut self, file: FileId, pat: PatId, put_off: &mut VecDeque<PutOff>) {
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
                        self.expression_in_order(file, key, put_off);
                    }
                    self.pattern_in_order(file, hir[p].value, put_off);
                    self.expression_in_order(file, hir[p].default, put_off);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.pattern_in_order(file, hir[e].pat, put_off);
                    self.expression_in_order(file, hir[e].default, put_off);
                }
            }
        }
    }

    /// `checkClassLikeDeclaration`
    fn class_in_order(&mut self, file: FileId, class: ClassId, put_off: &mut VecDeque<PutOff>) {
        let symbol = self.bound(file).class_symbol[class.idx()];
        if symbol.is_some() {
            let sym = self.files().sym(file, symbol);
            self.declared_type(sym);
            self.type_of_symbol(sym);
            self.expression_in_order(file, self.hir(file)[class].extends, put_off);
            self.base_types(sym);
        }
    }

    fn members_in_order(&mut self, file: FileId, class: ClassId, put_off: &mut VecDeque<PutOff>) {
        let hir = self.hir(file);
        for m in hir[class].members.iter() {
            let member = &hir[m];
            if let PropKey::Computed(key) = member.key {
                self.expression_in_order(file, key, put_off);
            }
            if member.ty.is_some() {
                self.type_from_node(file, member.ty);
            }
            self.declared_function_in_order(file, member.func, put_off);
            self.expression_in_order(file, member.init, put_off);
        }
    }

    /// `checkSourceElement`
    fn statement_in_order(&mut self, file: FileId, s: StmtId, put_off: &mut VecDeque<PutOff>) {
        if s.is_none() || self.timed_out() {
            return;
        }
        let hir = self.hir(file);
        match hir[s].kind {
            StmtKind::Expr(e)
            | StmtKind::Throw(e)
            | StmtKind::ExportDefault(e)
            | StmtKind::ExportAssign(e) => self.expression_in_order(file, e, put_off),
            // `checkReturnStatement` asks what the function returns before it looks at what is returned.
            StmtKind::Return(e) => {
                if let Some(func) = self.enclosing_fn(file, Parent::Stmt(s)) {
                    self.return_type_of_fn(file, func);
                }
                self.expression_in_order(file, e, put_off);
            }
            StmtKind::Var(decls) => {
                for d in decls.iter() {
                    let decl = &hir[d];
                    if decl.ty.is_some() {
                        self.type_from_node(file, decl.ty);
                    }
                    self.pattern_in_order(file, decl.pat, put_off);
                    self.expression_in_order(file, decl.init, put_off);
                }
            }
            StmtKind::Fn(func) => self.declared_function_in_order(file, func, put_off),
            StmtKind::Class(class) => {
                self.class_in_order(file, class, put_off);
                self.members_in_order(file, class, put_off);
            }
            StmtKind::If { test, yes, no } => {
                self.expression_in_order(file, test, put_off);
                self.statement_in_order(file, yes, put_off);
                self.statement_in_order(file, no, put_off);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.statement_in_order(file, init, put_off);
                self.expression_in_order(file, test, put_off);
                self.expression_in_order(file, update, put_off);
                self.statement_in_order(file, body, put_off);
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                self.statement_in_order(file, left, put_off);
                self.expression_in_order(file, expr, put_off);
                self.statement_in_order(file, body, put_off);
            }
            StmtKind::While { test, body } => {
                self.expression_in_order(file, test, put_off);
                self.statement_in_order(file, body, put_off);
            }
            StmtKind::DoWhile { body, test } => {
                self.statement_in_order(file, body, put_off);
                self.expression_in_order(file, test, put_off);
            }
            StmtKind::Block(list) => {
                for s in hir.ids(list) {
                    self.statement_in_order(file, s, put_off);
                }
            }
            StmtKind::Switch { expr, cases } => {
                self.expression_in_order(file, expr, put_off);
                for c in cases.iter() {
                    self.expression_in_order(file, hir[c].test, put_off);
                    for s in hir.ids(hir[c].body) {
                        self.statement_in_order(file, s, put_off);
                    }
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.statement_in_order(file, block, put_off);
                self.statement_in_order(file, handler, put_off);
                self.statement_in_order(file, finalizer, put_off);
            }
            StmtKind::Labeled { body, .. } => self.statement_in_order(file, body, put_off),
            StmtKind::Module(module) => {
                for s in hir.ids(hir[module].body) {
                    self.statement_in_order(file, s, put_off);
                }
            }
            StmtKind::Enum(e) => {
                for m in hir[e].members.iter() {
                    self.expression_in_order(file, hir[m].init, put_off);
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
    fn expression_in_order(&mut self, file: FileId, e: ExprId, put_off: &mut VecDeque<PutOff>) {
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
                    self.expression_in_order(file, x, put_off);
                }
            }
            ExprKind::Call(c) | ExprKind::New(c) | ExprKind::TaggedTemplate(c) => {
                self.expression_in_order(file, hir[c].callee, put_off);
                for x in hir.ids(hir[c].args) {
                    self.expression_in_order(file, x, put_off);
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(key) = hir[p].key {
                        self.expression_in_order(file, key, put_off);
                    }
                    self.expression_in_order(file, hir[p].value, put_off);
                }
            }
            // `checkFunctionExpressionOrObjectLiteralMethod`: the signature now, and what it returns if something is expected of it.
            ExprKind::Fn(func) => {
                self.signature_in_order(file, func, put_off);
                if hir[func].ret.is_none() && self.contextual_signature(file, func).is_some() {
                    self.return_type_of_fn(file, func);
                }
                put_off.push_back(PutOff::Function(func));
            }
            ExprKind::Class(class) => {
                self.class_in_order(file, class, put_off);
                put_off.push_back(PutOff::ClassExpression(class));
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
            | ExprKind::Instantiation { expr: x, .. }
            | ExprKind::ImportCall(x) => self.expression_in_order(file, x, put_off),
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
                self.expression_in_order(file, a, put_off);
                self.expression_in_order(file, b, put_off);
            }
            ExprKind::Cond { test, yes, no } => {
                self.expression_in_order(file, test, put_off);
                self.expression_in_order(file, yes, put_off);
                self.expression_in_order(file, no, put_off);
            }
            ExprKind::Jsx(jsx) => {
                self.expression_in_order(file, hir[jsx].tag, put_off);
                for p in hir[jsx].attrs.iter() {
                    self.expression_in_order(file, hir[p].value, put_off);
                }
                for x in hir.ids(hir[jsx].children) {
                    self.expression_in_order(file, x, put_off);
                }
            }
            _ => {}
        }
    }
}
