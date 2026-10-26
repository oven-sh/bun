use bun_sema::atom::{Atom, known, written_name};
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{
    BinOp, Call, Chain, ExprFlags, ExprId, ExprKind, FnBody, FnId, MemberKey, StmtKind, UnOp,
};

use super::Callee;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, StringId, ValueId};
use crate::lower::member::{self, KeyConversion, PropertyName};
use crate::lower::{FileLowering, FunctionLowering};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // `f?.()` leaves its chain where `f` is null or undefined.
    pub(in crate::lower) fn leave_chain_if_nullish(
        &mut self,
        site: Call,
        function: ValueId,
        exit: Option<BlockId>,
    ) -> ValueId {
        match site.chain {
            Chain::Start => {
                let exit = exit.expect("an optional call has the exit of its chain");
                self.branch_if_expression_nullish(site.callee, function, exit)
            }
            Chain::No | Chain::Continue => function,
        }
    }

    // A built-in that the signature of the call names says more than the type the checker has for the callee.
    pub(in crate::lower) fn lower_callee(
        &mut self,
        callee: ExprId,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let hir = self.file.hir;
        let inner = self.file.skip_type_syntax(callee);
        let is_parenthesized = hir.expr_flags(inner).contains(ExprFlags::PARENTHESIZED);
        let mut lowered = match self.file.decisions().decision(inner) {
            Decision::Unknown
                if self.file.is_chain_root(inner) && (exit.is_none() || is_parenthesized) =>
            {
                self.lower_chain_callee(inner, expected)
            }
            Decision::Unknown => self.lower_callee_with_exit(callee, inner, exit, expected),
            Decision::GlobalPath(path) => {
                self.set_position(hir[inner].pos);
                self.lower_global_path_callee(inner, path)
            }
            Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
                Callee::without_key(self.lower_expression(inner), None, None)
            }
        };
        if let Some(builtin) = expected {
            lowered.function = self.expect_builtin(lowered.function, builtin);
        }
        lowered
    }

    fn finish_callee(
        &mut self,
        callee: ExprId,
        function: ValueId,
        expected: Option<BuiltinId>,
    ) -> ValueId {
        match expected {
            Some(_) => function,
            None => self.finish_expression(callee, function),
        }
    }

    fn lower_global_path_callee(&mut self, inner: ExprId, path: &[Atom]) -> Callee {
        let last = self.lower_global_path_holder(path);
        let name = Some(self.file.intern_atom(last.name));
        if let Some(builtin) = find_locked_builtin(self.file, inner) {
            return Callee::without_key(self.emit_locked_builtin(builtin), last.holder, name);
        }
        let (function, key) = match last.holder {
            Some(holder) => {
                let key = self.file.atom_key(last.name);
                let function = self.emit_get(holder, PropertyName::Constant(key));
                (function, Some(key))
            }
            None => (self.emit_free_name_get(last.name, false), None),
        };
        Callee {
            function: self.expect_resolved_path(inner, function),
            this: last.holder,
            key,
            name,
        }
    }

    fn lower_chain_callee(&mut self, inner: ExprId, expected: Option<BuiltinId>) -> Callee {
        let own_exit = self.create_block();
        let join = self.create_block();
        let function_variable = self.builder.create_variable(None);
        let this_variable = self.builder.create_variable(None);

        let lowered = self.lower_callee_with_exit(inner, inner, Some(own_exit), expected);
        let this = lowered.this.unwrap_or_else(|| self.builder.undefined());
        self.builder
            .write_variable(function_variable, lowered.function);
        self.builder.write_variable(this_variable, this);
        self.jump(join);

        self.continue_in(own_exit);
        let undefined = self.builder.undefined();
        self.builder.write_variable(function_variable, undefined);
        self.builder.write_variable(this_variable, undefined);
        self.jump(join);

        self.continue_in(join);
        let function = self.builder.read_variable(function_variable);
        let this = self.builder.read_variable(this_variable);
        Callee::without_key(function, Some(this), lowered.name)
    }

    fn lower_callee_with_exit(
        &mut self,
        callee: ExprId,
        inner: ExprId,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        match self.file.hir.member_key(inner) {
            Some((object, member_key)) => {
                self.lower_member_callee(inner, object, member_key, exit, expected)
            }
            None => self.lower_plain_callee(callee, inner, exit, expected),
        }
    }

    fn lower_member_callee(
        &mut self,
        access: ExprId,
        object: ExprId,
        member_key: MemberKey,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let hir = self.file.hir;
        let name = self.file.find_callee_name(access);
        if let Some(builtin) = find_locked_builtin(self.file, access) {
            let this = self.lower_expression(object);
            return Callee::without_key(self.emit_locked_builtin(builtin), Some(this), name);
        }
        if matches!(hir[object].kind, ExprKind::Super) {
            let this = self.get_this();
            let reference = self.lower_reference(access, KeyConversion::AtAccess);
            self.set_position(hir[access].pos);
            return Callee::without_key(self.get_reference(&reference), Some(this), name);
        }
        if matches!(member_key, MemberKey::PrivateName(_)) {
            let base = self.lower_member_base(access, object, exit);
            return Callee::without_key(self.emit_private_get(base, access), Some(base), name);
        }
        if let Some(function) = self.lower_namespace_member(access) {
            let this = self.lower_namespace_receiver(object);
            return Callee::without_key(function, Some(this), name);
        }
        if let Some(function) = self.lower_export_member(access) {
            let this = self.lower_export_receiver(access);
            return Callee::without_key(function, Some(this), name);
        }
        let (base, property) = member::lower_member_operands(self, access, exit);
        let function = member::emit_member_read(self, access, base, property);
        let function = self.finish_callee(access, function, expected);
        let function = self.expect_resolved_path(access, function);
        Callee {
            function,
            this: Some(base),
            key: property.key_operands().1,
            name,
        }
    }

    fn lower_plain_callee(
        &mut self,
        callee: ExprId,
        inner: ExprId,
        exit: Option<BlockId>,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let hir = self.file.hir;
        if !matches!(hir[inner].kind, ExprKind::Ident(_)) {
            return Callee::without_key(self.lower_chain_base(callee, exit), None, None);
        }
        let name = self.file.find_callee_name(inner);
        if let Some(builtin) = find_locked_builtin(self.file, inner) {
            return Callee::without_key(self.emit_locked_builtin(builtin), None, name);
        }
        self.set_position(hir[inner].pos);
        let (function, this) = self.lower_identifier_callee(inner);
        Callee::without_key(self.finish_callee(inner, function, expected), this, name)
    }
}

impl FileLowering<'_, '_, '_, '_> {
    // JSC reports a call at the end of its callee, which the source map takes back to this token.
    pub(in crate::lower) fn last_mapped_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let mut last = self.skip_type_syntax(expression);
        loop {
            if self.is_printed_as_literal(last) {
                return self.first_position(last);
            }
            let next = match hir[last].kind {
                ExprKind::Index { index, .. } => index,
                ExprKind::Binary {
                    op: BinOp::Add,
                    left,
                    right,
                } if self.is_joined_with_text_on_the_left(left, right) => left,
                ExprKind::Binary { right, .. } => right,
                ExprKind::Assign { value, .. } => value,
                ExprKind::Cond { test, branches } => match self.find_printed_condition(test) {
                    Some(true) => hir.branches(branches).yes,
                    Some(false) | None => hir.branches(branches).no,
                },
                ExprKind::Await(operand) | ExprKind::Unary { operand, .. } => operand,
                ExprKind::Template { exprs } => match hir.ids(exprs).last() {
                    Some(substitution) => substitution,
                    None => return hir[last].pos,
                },
                ExprKind::Class(_) => return self.last_token_position(last),
                ExprKind::New(site) if hir[site].close_pos == u32::MAX => hir[site].callee,
                ExprKind::Fn(function) => match self.last_expression_of_body(function) {
                    Some(expression) => expression,
                    None => return self.last_token_position(last),
                },
                ExprKind::Dot { .. } => return hir.name_pos(last),
                ExprKind::Call(site) | ExprKind::New(site) => return hir[site].close_pos,
                ExprKind::Array(_) | ExprKind::Object(_) => {
                    return self.last_token_position(last);
                }
                _ => return hir[last].pos,
            };
            last = self.skip_type_syntax(next);
        }
    }

    // An expression that no file holds has no end.
    fn last_token_position(&self, expression: ExprId) -> u32 {
        let node = self.hir[expression];
        match node.end {
            0 => node.pos,
            end => end - 1,
        }
    }

    // Bun's transpiler gives an expression the position of its first operand, without the parentheses around it.
    pub(in crate::lower) fn first_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let mut first = self.skip_type_syntax(expression);
        loop {
            let next = match hir[first].kind {
                ExprKind::Binary { left, .. } => left,
                ExprKind::Cond { test, .. } => test,
                ExprKind::Assign { target, .. } => target,
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::Call(site) | ExprKind::TaggedTemplate(site) => hir[site].callee,
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => operand,
                _ => return hir[first].pos,
            };
            first = self.skip_type_syntax(next);
        }
    }

    // Bun's transpiler computes an operator whose operands are literals, and prints the result at the position of the operator's expression.
    fn is_printed_as_literal(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        match hir[self.skip_type_syntax(expression)].kind {
            ExprKind::Unary { op, operand } => {
                matches!(
                    op,
                    UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof
                ) && self.is_literal_operand(operand)
            }
            ExprKind::Binary { op, left, right } => {
                !matches!(
                    op,
                    BinOp::And
                        | BinOp::Or
                        | BinOp::Nullish
                        | BinOp::Comma
                        | BinOp::In
                        | BinOp::Instanceof
                ) && self.is_literal_operand(left)
                    && self.is_literal_operand(right)
            }
            ExprKind::Template { exprs } => {
                let mut substitutions = hir.ids(exprs);
                !exprs.is_empty() && substitutions.all(|part| self.is_literal_operand(part))
            }
            _ => false,
        }
    }

    fn is_literal_operand(&self, expression: ExprId) -> bool {
        let inner = self.skip_type_syntax(expression);
        match self.hir[inner].kind {
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            _ => self.is_printed_as_literal(inner),
        }
    }

    fn is_text(&self, expression: ExprId) -> bool {
        match self.hir[self.skip_type_syntax(expression)].kind {
            ExprKind::String(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            _ => false,
        }
    }

    // `x + "a" + "b"` is printed `x + "ab"`.
    fn is_joined_with_text_on_the_left(&self, left: ExprId, right: ExprId) -> bool {
        let left = self.hir[self.skip_type_syntax(left)].kind;
        let ExprKind::Binary {
            op: BinOp::Add,
            right: middle,
            ..
        } = left
        else {
            return false;
        };
        self.is_text(middle) && self.is_text(right)
    }

    // Of `true ? a : b` Bun's transpiler prints `a`.
    fn find_printed_condition(&self, test: ExprId) -> Option<bool> {
        let hir = self.hir;
        let test = self.skip_type_syntax(test);
        match hir[test].kind {
            ExprKind::True => Some(true),
            ExprKind::False | ExprKind::Null => Some(false),
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => self.find_printed_condition(operand).map(|is_true| !is_true),
            _ if !self.is_literal_operand(test) => None,
            _ => match self.decisions().constant(hir, test) {
                FoldedValue::Constant(Constant::Boolean(value)) => Some(value),
                FoldedValue::Constant(Constant::Number(value)) => {
                    Some(value != 0.0 && !value.is_nan())
                }
                FoldedValue::Constant(Constant::String(value)) => Some(value != known::empty),
                _ => None,
            },
        }
    }

    // An operation JSC records no position for is reported at the last position recorded before it, which belongs to the end of the operand.
    pub(in crate::lower) fn last_reported_position(&self, operand: ExprId) -> u32 {
        let hir = self.hir;
        let mut last = self.skip_type_syntax(operand);
        loop {
            let next = match hir[last].kind {
                ExprKind::Call(site) => return self.last_mapped_position(hir[site].callee),
                ExprKind::New(_) => return self.construct_position(last),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    return self.last_mapped_position(obj);
                }
                ExprKind::Cond { branches, .. } => hir.branches(branches).no,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    right,
                    ..
                } => right,
                ExprKind::Assign { value, .. } => value,
                ExprKind::Await(awaited) => awaited,
                _ => return hir[last].pos,
            };
            last = self.skip_type_syntax(next);
        }
    }

    fn last_expression_of_body(&self, function: FnId) -> Option<ExprId> {
        let hir = self.hir;
        let statement = match hir[function].body {
            FnBody::None => return None,
            FnBody::Expr(body) => return Some(body),
            FnBody::Block(statements) => hir.ids(statements).last()?,
        };
        match hir[statement].kind {
            StmtKind::Expr(value) | StmtKind::Throw(value) => Some(value),
            StmtKind::Return(value) => value.is_some().then_some(value),
            _ => None,
        }
    }

    // JSC's parser knows `Reflect.construct(target, list)` by these two names, whatever `Reflect` is bound to.
    pub(super) fn is_reflect_construct_syntax(&self, callee: ExprId) -> bool {
        let hir = self.hir;
        let Some((object, MemberKey::Name(name))) = hir.member_key(self.skip_type_syntax(callee))
        else {
            return false;
        };
        let ExprKind::Ident(object) = hir[self.skip_type_syntax(object)].kind else {
            return false;
        };
        self.queries.atom_bytes(object) == b"Reflect"
            && self.queries.atom_bytes(name) == b"construct"
    }

    pub(super) fn find_callee_name(&mut self, callee: ExprId) -> Option<StringId> {
        let hir = self.hir;
        let inner = self.skip_type_syntax(callee);
        if let ExprKind::Ident(name) = hir[inner].kind {
            return Some(self.intern_binding_name(self.bound.binding(inner), name));
        }
        let mut path = Vec::new();
        if self.append_written_path(inner, &mut path) {
            return Some(self.intern_bytes(&path));
        }
        match hir.member_key(inner) {
            Some((_, MemberKey::Name(name))) => Some(self.intern_atom(name)),
            Some((_, MemberKey::PrivateName(name))) => {
                let text = written_name(self.queries.atom_bytes(name));
                Some(self.intern_bytes(text))
            }
            Some((_, MemberKey::Computed(_))) | None => None,
        }
    }

    /// `a.b.c`, `this.#x`, `a?.b[key]`: a callee that consists of names, as plain Bun quotes it in "a.b.c is not a function".
    /// Answers false, with `path` in any state, for anything else and for what is too long to be worth its bytes in the executable.
    fn append_written_path(&self, expression: ExprId, path: &mut Vec<u8>) -> bool {
        const LONGEST_PATH: usize = 80;
        let hir = self.hir;
        let inner = self.skip_type_syntax(expression);
        match hir[inner].kind {
            ExprKind::Ident(name) => self.append_identifier(inner, name, path),
            ExprKind::This => path.extend_from_slice(b"this"),
            ExprKind::Super => path.extend_from_slice(b"super"),
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                if !self.append_written_path(obj, path) {
                    return false;
                }
                path.extend_from_slice(if chain == Chain::Start { b"?." } else { b"." });
                path.extend_from_slice(written_name(self.queries.atom_bytes(name)));
            }
            ExprKind::Index { obj, index, chain } => {
                let ExprKind::Ident(key) = hir[index].kind else {
                    return false;
                };
                if !self.append_written_path(obj, path) {
                    return false;
                }
                if chain == Chain::Start {
                    path.extend_from_slice(b"?.");
                }
                path.push(b'[');
                self.append_identifier(index, key, path);
                path.push(b']');
            }
            _ => return false,
        }
        path.len() <= LONGEST_PATH
    }

    fn append_identifier(&self, identifier: ExprId, name: Atom, path: &mut Vec<u8>) {
        if !self.append_short_binding_name(self.bound.binding(identifier), path) {
            path.extend_from_slice(self.queries.atom_bytes(name));
        }
    }
}

fn find_locked_builtin(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<BuiltinId> {
    match file.builtins.of_expr(expression) {
        Some(Resolved::Builtin(path)) => path.locked_builtin(),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}
