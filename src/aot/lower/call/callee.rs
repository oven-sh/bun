use bun_sema::atom::{Atom, known, written_name};
use bun_sema::bind::{Binding, FnOwner, Parent};
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{
    BinOp, Call, Chain, ExprFlags, ExprId, ExprKind, FnBody, FnId, IdList, MemberKey, StmtKind,
    UnOp,
};

use super::Callee;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, StringId, ValueId};
use crate::lower::member::{self, KeyConversion, PropertyName};
use crate::lower::operator::needs_parentheses;
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

fn is_equality(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
    )
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
                ExprKind::Binary { op, left, right } => self.printed_operands(op, left, right).1,
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

    // JSC records a name where it ends. The source map takes that to a `)` or `]` that is printed right behind the name.
    pub(in crate::lower) fn name_position(&self, identifier: ExprId) -> u32 {
        let hir = self.hir;
        let is_last = |list: IdList<ExprId>, member: ExprId| {
            hir.ids[list.range()]
                .last()
                .is_some_and(|&last| ExprId::from(last) == member)
        };
        let mut last = identifier;
        loop {
            let parent = match self.bound.parent_of_expr(last) {
                Parent::Expr(parent) => parent,
                // The body of an arrow function.
                Parent::FnBody(function) => match self.bound.fns[function.idx()].owner {
                    FnOwner::Expr(arrow) => {
                        last = arrow;
                        continue;
                    }
                    _ => break,
                },
                _ => break,
            };
            last = match hir[parent].kind {
                ExprKind::Call(site) | ExprKind::New(site) if is_last(hir[site].args, last) => {
                    return hir[site].close_pos;
                }
                ExprKind::Array(elements) if is_last(elements, last) => {
                    match self.find_access_printed_as(parent, last) {
                        Some(access) => access,
                        None => return self.last_token_position(parent),
                    }
                }
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    ..
                } if !self.is_removed_when_unused(left) => break,
                ExprKind::Binary { op, left, right } => {
                    let is_in_parentheses = match hir[self.skip_type_syntax(last)].kind {
                        ExprKind::Binary { op: inner, .. } => needs_parentheses(op, inner, false),
                        _ => false,
                    };
                    if is_in_parentheses || self.printed_operands(op, left, right).1 != last {
                        break;
                    }
                    parent
                }
                _ if hir.type_assertion_operand(parent).is_some() => parent,
                _ => break,
            };
        }
        hir[identifier].pos
    }

    // `[n][0]`, of which only `n` is printed.
    fn find_access_printed_as(&self, list: ExprId, element: ExprId) -> Option<ExprId> {
        let Parent::Expr(access) = self.bound.parent_of_expr(list) else {
            return None;
        };
        let ExprKind::Index { obj, index, .. } = self.hir[access].kind else {
            return None;
        };
        (obj == list && self.find_printed_element(obj, index) == Some(element)).then_some(access)
    }

    // An expression that no file holds has no end.
    pub(in crate::lower) fn last_token_position(&self, expression: ExprId) -> u32 {
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
        // The result of an operator that the transpiler computes stands where the operator's expression is written.
        let mut is_computed = false;
        loop {
            let next = match hir[first].kind {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    right,
                } => match !is_computed && self.is_removed_when_unused(left) {
                    true => right,
                    false => left,
                },
                ExprKind::Binary { op, left, right }
                    if let Some(operand) = self.find_printed_logical_operand(op, left, right) =>
                {
                    operand
                }
                ExprKind::Binary { op, left, right } => {
                    let (printed_left, printed_right) = self.printed_operands(op, left, right);
                    let is_behind_comma = self.skip_unprinted_syntax(printed_left)
                        != self.skip_type_syntax(printed_left);
                    is_computed |= is_behind_comma
                        && self.is_literal_operand(printed_right)
                        && self.is_printed_as_literal(first);
                    printed_left
                }
                ExprKind::Cond { test, .. } => test,
                ExprKind::Assign { target, .. } => target,
                ExprKind::Index { obj, index, .. } => {
                    self.find_printed_element(obj, index).unwrap_or(obj)
                }
                ExprKind::Dot { obj, .. } => obj,
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
                ) && self.is_literal_operand(right)
                    && self.is_literal_operand(left)
                    && self.is_computed(op, left, right)
            }
            ExprKind::Template { exprs } => {
                let mut substitutions = hir.ids(exprs);
                !exprs.is_empty() && substitutions.all(|part| self.is_literal_operand(part))
            }
            _ => false,
        }
    }

    // Bun's transpiler drops the left operand of a comma if evaluating it does nothing.
    pub(in crate::lower) fn is_removed_when_unused(&self, expression: ExprId) -> bool {
        let inner = self.skip_type_syntax(expression);
        match self.hir[inner].kind {
            ExprKind::Ident(_) => !matches!(self.bound.binding(inner), Binding::Free),
            ExprKind::This | ExprKind::BigInt(_) | ExprKind::Fn(_) => true,
            ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            } if matches!(self.hir[operand].kind, ExprKind::Ident(_)) => true,
            _ => self.is_literal_operand(inner),
        }
    }

    // An expression without what Bun's transpiler does not print: type syntax, and a comma whose left operand it drops.
    pub(in crate::lower) fn skip_unprinted_syntax(&self, expression: ExprId) -> ExprId {
        let mut printed = self.skip_type_syntax(expression);
        loop {
            let inner = match self.hir[printed].kind {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    right,
                } if self.is_removed_when_unused(left) => right,
                ExprKind::Binary { op, left, right } => {
                    match self.find_printed_logical_operand(op, left, right) {
                        Some(operand) => operand,
                        None => return printed,
                    }
                }
                ExprKind::Index { obj, index, .. } => match self.find_printed_element(obj, index) {
                    Some(element) => element,
                    None => return printed,
                },
                _ => return printed,
            };
            printed = self.skip_type_syntax(inner);
        }
    }

    // Of `1 && a` Bun's transpiler prints `a`, and of `0 && a` it prints `0`.
    fn find_printed_logical_operand(
        &self,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> Option<ExprId> {
        self.ends_logical_chain(op, left).map(|ends| match ends {
            true => left,
            false => right,
        })
    }

    // Whether a literal decides `literal && ..`, `literal || ..` or `literal ?? ..`, so that the transpiler drops what follows. `None`: not a literal.
    pub(in crate::lower) fn ends_logical_chain(&self, op: BinOp, operand: ExprId) -> Option<bool> {
        if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) {
            return None;
        }
        let hir = self.hir;
        let mut literal = self.skip_type_syntax(operand);
        while let ExprKind::Binary {
            op: BinOp::Comma,
            left,
            right,
        } = hir[literal].kind
            && self.is_removed_when_unused(left)
        {
            literal = self.skip_type_syntax(right);
        }
        let is_true = match hir[literal].kind {
            ExprKind::Null if op == BinOp::Nullish => return Some(false),
            ExprKind::Unary {
                op: UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof,
                ..
            } if op == BinOp::Nullish => return Some(true),
            ExprKind::Null | ExprKind::False => false,
            ExprKind::True => true,
            ExprKind::Number(index) => {
                let number = hir.numbers[index as usize];
                number != 0.0 && !number.is_nan()
            }
            ExprKind::String(text) => text != known::empty,
            _ => return None,
        };
        Some(match op {
            BinOp::And => !is_true,
            BinOp::Or => is_true,
            _ => true,
        })
    }

    // `[a, b][1]` is printed `b` if evaluating the other elements does nothing.
    fn find_printed_element(&self, list: ExprId, index: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let ExprKind::Array(elements) = hir[self.skip_type_syntax(list)].kind else {
            return None;
        };
        let ExprKind::Number(_) = hir[self.skip_type_syntax(index)].kind else {
            return None;
        };
        let FoldedValue::Constant(Constant::Number(index)) = self.decisions().constant(hir, index)
        else {
            return None;
        };
        let is_plain = |element: ExprId| {
            !matches!(hir[element].kind, ExprKind::Missing | ExprKind::Spread(_))
                && self.is_removed_when_unused(element)
        };
        let element = hir.ids(elements).nth(index as usize)?;
        (index.fract() == 0.0 && index >= 0.0 && hir.ids(elements).all(is_plain)).then_some(element)
    }

    // Whether Bun's transpiler computes an operator whose operands are these two literals.
    fn is_computed(&self, op: BinOp, left: ExprId, right: ExprId) -> bool {
        let value_of = |operand| {
            let operand = self.skip_unprinted_syntax(operand);
            match self.decisions().constant(self.hir, operand) {
                FoldedValue::Constant(constant) => Some(constant),
                _ => None,
            }
        };
        let (Some(left), Some(right)) = (value_of(left), value_of(right)) else {
            return false;
        };
        match (left, right) {
            (Constant::Number(_), Constant::Number(_)) => true,
            (Constant::String(_), Constant::String(_)) => {
                is_equality(op)
                    || matches!(
                        op,
                        BinOp::Add | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge
                    )
            }
            (Constant::String(_), _) | (_, Constant::String(_)) => op == BinOp::Add,
            _ => is_equality(op) && std::mem::discriminant(&left) == std::mem::discriminant(&right),
        }
    }

    // Bun's transpiler moves a literal on the left of an equality operator to the right.
    pub(in crate::lower) fn printed_operands(
        &self,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> (ExprId, ExprId) {
        let is_moved = |operand| {
            let printed = self.skip_unprinted_syntax(operand);
            match self.hir[printed].kind {
                ExprKind::BigInt(_) => true,
                ExprKind::Ident(name) => {
                    name == known::undefined && matches!(self.bound.binding(printed), Binding::Free)
                }
                _ => self.is_literal_operand(printed),
            }
        };
        match is_equality(op) && is_moved(left) && !is_moved(right) {
            true => (right, left),
            false => (left, right),
        }
    }

    pub(in crate::lower) fn is_literal_operand(&self, expression: ExprId) -> bool {
        let inner = self.skip_unprinted_syntax(expression);
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
                if !self.append_written_path(obj, path) {
                    return false;
                }
                match hir[index].kind {
                    ExprKind::Ident(key) => {
                        if chain == Chain::Start {
                            path.extend_from_slice(b"?.");
                        }
                        path.push(b'[');
                        self.append_identifier(index, key, path);
                        path.push(b']');
                    }
                    // Plain Bun prints `a["b"]` as `a.b` before it runs the file.
                    ExprKind::String(key) if is_identifier_name(self.queries.atom_bytes(key)) => {
                        path.extend_from_slice(if chain == Chain::Start { b"?." } else { b"." });
                        path.extend_from_slice(self.queries.atom_bytes(key));
                    }
                    ExprKind::String(key) if needs_no_escape(self.queries.atom_bytes(key)) => {
                        if chain == Chain::Start {
                            path.extend_from_slice(b"?.");
                        }
                        path.extend_from_slice(b"[\"");
                        path.extend_from_slice(self.queries.atom_bytes(key));
                        path.extend_from_slice(b"\"]");
                    }
                    _ => return false,
                }
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

fn is_identifier_name(text: &[u8]) -> bool {
    let is_start = |byte: u8| byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$');
    text.first().is_some_and(|&first| is_start(first))
        && text
            .iter()
            .all(|&byte| is_start(byte) || byte.is_ascii_digit())
}

fn needs_no_escape(text: &[u8]) -> bool {
    text.iter().all(|&byte| {
        (byte == b' ' || byte.is_ascii_graphic())
            && !matches!(byte, b'"' | b'\'' | b'`' | b'\\' | b'$')
    })
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
