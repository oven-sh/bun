use std::cell::{Cell, RefCell};

use bun_core::strings::contains_char;
use bun_sema::atom::{Atom, known, written_name};
use bun_sema::bind::{Binding, BindingInitializer, BindingKind, Decl, FnOwner, Parent};
use bun_sema::check::spans::skip_trivia;
use bun_sema::fold::{self, Constant, Decision, FoldedValue, TreeNode, push_children};
use bun_sema::hir::{
    BinOp, Call, Chain, EnumMemberId, ExprFlags, ExprId, ExprKind, FnBody, FnKind, IdList,
    MemberKey, PropKey, PropKind, UnOp, end_of_expr, start_of,
};
use bun_sema::import_sites::ImportSiteKind;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

use super::Callee;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::LimitId;
use crate::ir::{BlockId, StringId, ValueId};
use crate::lower::member::{self, KeyConversion, PropertyName};
use crate::lower::module;
use crate::lower::operator::needs_parentheses;
use crate::lower::statement::Printed;
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

fn is_computable(op: BinOp) -> bool {
    !matches!(
        op,
        BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma | BinOp::In | BinOp::Instanceof
    )
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum StringForm {
    Flat,
    // The result of `+`. Bun's transpiler inlines none as the value of a constant and converts none to a number.
    Rope,
    // Has a character outside ASCII. Bun's transpiler folds no `+` over one.
    Utf16,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum LiteralKind {
    Number,
    String(StringForm),
    Boolean,
    Null,
    Undefined,
    BigInt,
}

// The kind of literal that Bun's transpiler folds an operator over two literals into.
fn find_folded_kind(op: BinOp, left: LiteralKind, right: LiteralKind) -> Option<LiteralKind> {
    use LiteralKind::{BigInt, Boolean, Null, Number, String, Undefined};
    let is_comparison = matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge);
    if is_equality(op) {
        let is_folded = match (left, right) {
            (Null | Undefined, _) | (_, Null | Undefined) => true,
            (Boolean | Number, Boolean | Number) => true,
            (BigInt, BigInt) | (String(_), String(_)) => true,
            (String(_), Number) => matches!(op, BinOp::EqEqEq | BinOp::NotEqEq),
            _ => false,
        };
        return is_folded.then_some(Boolean);
    }
    match (left, right) {
        (Number, Number) if is_comparison => Some(Boolean),
        (Number, Number) => Some(Number),
        (String(left), String(right)) if is_comparison => {
            ((left == StringForm::Utf16) == (right == StringForm::Utf16)).then_some(Boolean)
        }
        (String(StringForm::Utf16), _) | (_, String(StringForm::Utf16)) => None,
        (String(_), _) | (_, String(_)) if op == BinOp::Add => Some(String(StringForm::Rope)),
        _ => None,
    }
}

// What stands around the start of an expression in the text that Bun's transpiler prints.
#[derive(Copy, Clone)]
enum Around {
    Spread,
    Operator(BinOp),
    RightOperand(BinOp),
    Condition,
    Access { is_callee: bool },
}

// What Bun's transpiler prints for the operators of a file. Each is asked once, however many operators and names of constants lead to it.
#[derive(Default)]
pub(in crate::lower) struct PrintedOperators {
    // Indexed by `is_asking_about_variable_used_once`, which changes the answers.
    kinds: [RefCell<FxHashMap<ExprId, Option<LiteralKind>>>; 2],
    values: [RefCell<FxHashMap<ExprId, Option<Constant>>>; 2],
    // By the only use of a variable: the initializer that is printed there, if the statement is visited again.
    revisited_initializers: RefCell<FxHashMap<ExprId, Option<ExprId>>>,
    // By a name in whose place an initializer or a value is printed: where that begins.
    first_positions: RefCell<FxHashMap<ExprId, u32>>,
    // Whether a variable that is used once is being asked about. What that question asks of other such variables is answered without them.
    is_asking_about_variable_used_once: Cell<bool>,
}

impl PrintedOperators {
    fn find_kind(&self, operator: ExprId) -> Option<Option<LiteralKind>> {
        let kinds = &self.kinds[usize::from(self.is_asking_about_variable_used_once())];
        kinds.borrow().get(&operator).copied()
    }

    fn remember_kind(&self, operator: ExprId, kind: Option<LiteralKind>) {
        let kinds = &self.kinds[usize::from(self.is_asking_about_variable_used_once())];
        kinds.borrow_mut().insert(operator, kind);
    }

    fn find_value(&self, operator: ExprId) -> Option<Option<Constant>> {
        let values = &self.values[usize::from(self.is_asking_about_variable_used_once())];
        values.borrow().get(&operator).copied()
    }

    fn remember_value(&self, operator: ExprId, value: Option<Constant>) {
        let values = &self.values[usize::from(self.is_asking_about_variable_used_once())];
        values.borrow_mut().insert(operator, value);
    }

    pub(in crate::lower) fn is_asking_about_variable_used_once(&self) -> bool {
        self.is_asking_about_variable_used_once.get()
    }
}

impl FileLowering<'_, '_, '_, '_> {
    // JSC reports a call at the end of its callee, which the source map takes back to this token. A text that runs as written has no source map.
    pub(in crate::lower) fn last_mapped_position(&self, expression: ExprId) -> u32 {
        self.last_mapped_position_in(expression, true)
    }

    // The same for an expression that is no callee and no object of a member: there `new Map()` is printed `new Map`.
    pub(in crate::lower) fn last_mapped_value_position(&self, expression: ExprId) -> u32 {
        self.last_mapped_position_in(expression, false)
    }

    fn last_mapped_position_in(&self, expression: ExprId, is_callee: bool) -> u32 {
        let hir = self.hir;
        if self.is_shown_without_source_map() {
            return end_of_expr(hir, self.skip_type_syntax(expression));
        }
        let mut last = self.skip_type_syntax(expression);
        // What is printed in place of a name stands where the name stands.
        let mut is_callee = is_callee;
        loop {
            if self.is_literal_operand(last) {
                return self.first_position(last);
            }
            if let Some(value) = self.find_printed_member(last) {
                last = self.skip_type_syntax(value);
                continue;
            }
            let next = match hir.written_kind(last) {
                ExprKind::Index { obj, index, .. } => {
                    self.find_printed_element(obj, index).unwrap_or(index)
                }
                ExprKind::Binary {
                    op: BinOp::Add,
                    left,
                    right,
                } if self.is_joined_with_text_on_the_left(left, right) => left,
                ExprKind::Binary { op, left, right }
                    if let Some(operand) = self.find_printed_logical_operand(op, left, right) =>
                {
                    operand
                }
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
                ExprKind::TaggedTemplate(site) => match hir.ids(hir[site].args).last() {
                    Some(substitution) => substitution,
                    None => return hir[last].pos,
                },
                ExprKind::Class(_) => return self.last_token_position(last),
                ExprKind::New(site) if let Some(literal) = self.find_printed_literal(hir[site]) => {
                    match literal {
                        Some(last_part) => last_part,
                        None => return hir[last].pos,
                    }
                }
                ExprKind::New(site) if hir[site].close_pos == u32::MAX => hir[site].callee,
                ExprKind::New(site) if hir[site].args.is_empty() && !is_callee => hir[site].callee,
                ExprKind::Fn(function) => match hir[function].body {
                    FnBody::Expr(body) => body,
                    FnBody::None | FnBody::Block(_) => {
                        let position = self.last_mapped_function_position(function);
                        return position.unwrap_or_else(|| self.last_token_position(last));
                    }
                },
                ExprKind::Ident(_) => match self.find_printed_in_place(last) {
                    Some(Printed::Initializer(initializer)) => initializer,
                    Some(Printed::Function(function)) => {
                        let position = self.last_mapped_function_position(function);
                        return position.unwrap_or(hir[last].pos);
                    }
                    None => match self.find_printed_value(last) {
                        Some(value) => return self.first_position(value),
                        None => return hir[last].pos,
                    },
                },
                ExprKind::Dot { .. } => return hir.name_pos(last),
                ExprKind::Call(_) if self.is_require_of_literal(last) => {
                    return self.first_position(last);
                }
                ExprKind::Call(site) | ExprKind::New(site) => return hir[site].close_pos,
                ExprKind::Array(_) | ExprKind::Object(_) => {
                    return self.last_token_position(last);
                }
                _ => return hir[last].pos,
            };
            is_callee &= matches!(hir[last].kind, ExprKind::Ident(_));
            last = self.skip_type_syntax(next);
        }
    }

    // JSC reports a call at the end of the last token in front of the arguments, which is the `?.` of `f?.()`.
    pub(in crate::lower) fn call_position(&self, site: Call) -> u32 {
        if let Some(start) = self.find_start_of_require_printed_alone(site) {
            return start;
        }
        let end = self.last_mapped_position(site.callee);
        match site.chain {
            Chain::Start if self.is_shown_without_source_map() => self.next_token_position(end) + 2,
            Chain::Start | Chain::Continue | Chain::No => end,
        }
    }

    // JSC reports an access to a member at the `.`, the `?.` or the `[` behind the object, which the source map takes back to the last token of the object.
    pub(in crate::lower) fn member_position(&self, object: ExprId) -> u32 {
        let end = self.last_mapped_position(object);
        // The text that runs has no syntax of types: the operator stands right behind the object there.
        if !self.is_shown_without_source_map() || self.skip_type_syntax(object) != object {
            return end;
        }
        let operator = self.next_token_position(end);
        if !self.hir.text[operator as usize..].starts_with(b"?.") {
            return operator;
        }
        let key = self.next_token_position(operator + 2);
        match self.hir.text.get(key as usize) {
            Some(b'[') => key,
            _ => operator,
        }
    }

    pub(in crate::lower) fn next_token_position(&self, position: u32) -> u32 {
        skip_trivia(&self.hir.text, position as usize) as u32
    }

    // JSC records a name where it ends. The source map takes that to a `)` or `]` that is printed right behind the name.
    pub(in crate::lower) fn name_position(&self, identifier: ExprId) -> u32 {
        if let Some(position) = self.find_shorthand_name_position(identifier) {
            return position;
        }
        if self.is_shown_without_source_map() {
            return self.hir[identifier].end;
        }
        self.find_closing_token_behind(identifier)
            .unwrap_or(self.hir[identifier].pos)
    }

    // JSC records a name where it ends, which the source map takes back to where the name starts.
    pub(in crate::lower) fn recorded_name_position(&self, identifier: ExprId) -> u32 {
        let name = self.hir[identifier];
        match self.runs_as_written() {
            true => name.end,
            false => name.pos,
        }
    }

    // JSC reports the store of `a += b` one character behind the start of the operator, which the source map takes back to the last token of the target.
    pub(in crate::lower) fn updating_store_position(&self, target: ExprId) -> u32 {
        let end = self.last_mapped_position(target);
        match self.runs_as_written() {
            true => self.next_token_position(end) + 1,
            false => end,
        }
    }

    // The `)` of a call or the `]` of a list that is printed right behind an expression.
    pub(in crate::lower) fn find_closing_token_behind(&self, expression: ExprId) -> Option<u32> {
        let hir = self.hir;
        let is_last = |list: IdList<ExprId>, member: ExprId| {
            hir.ids[list.range()]
                .last()
                .is_some_and(|&last| ExprId::from(last) == member)
        };
        let mut last = expression;
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
                    return Some(hir[site].close_pos);
                }
                ExprKind::Array(elements) if is_last(elements, last) => {
                    match self.find_access_printed_as(parent, last) {
                        Some(access) => access,
                        None if !self.is_list_printed_on_one_line(parent, elements) => break,
                        None => return Some(self.last_token_position(parent)),
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
                        ExprKind::Assign { .. } | ExprKind::Cond { .. } => op != BinOp::Comma,
                        _ => false,
                    };
                    if is_in_parentheses || self.printed_operands(op, left, right).1 != last {
                        break;
                    }
                    parent
                }
                ExprKind::Unary { op, .. } if !matches!(op, UnOp::PostInc | UnOp::PostDec) => {
                    match hir[self.skip_type_syntax(last)].kind {
                        ExprKind::Assign { .. } | ExprKind::Cond { .. } => break,
                        _ => parent,
                    }
                }
                ExprKind::Assign { value, .. } if value == last => parent,
                ExprKind::Cond { test, branches } => {
                    let printed = match self.find_printed_condition(test) {
                        Some(true) => hir.branches(branches).yes,
                        Some(false) | None => hir.branches(branches).no,
                    };
                    if printed != last {
                        break;
                    }
                    parent
                }
                ExprKind::Spread(_) => parent,
                _ if hir.type_assertion_operand(parent).is_some() => parent,
                _ => break,
            };
        }
        None
    }

    // Bun's transpiler gives each element and the `]` a line of their own if a line ends behind the `[`, beside a comma or in front of the `]`.
    fn is_list_printed_on_one_line(&self, list: ExprId, elements: IdList<ExprId>) -> bool {
        let hir = self.hir;
        let has_line_break = |start: u32, end: u32| {
            let gap = hir.text.get(start as usize..end as usize);
            gap.is_some_and(|gap| contains_char(gap, b'\n'))
        };
        let mut gap = hir[list].pos;
        for element in hir.ids(elements) {
            if matches!(hir[element].kind, ExprKind::Missing) {
                continue;
            }
            if has_line_break(gap, start_of(hir, element)) {
                return false;
            }
            gap = end_of_expr(hir, element);
        }
        !has_line_break(gap, self.last_token_position(list))
    }

    // JSC's parser starts the name of a shorthand member at the token behind it, and JSC records a name where it ends: as many characters behind
    // the start of that token as the name has. The source map takes that back to the last token it knows. The source text stands for the printed
    // text here, which has the same spaces if the source is formatted as Bun's transpiler prints it.
    pub(in crate::lower) fn find_shorthand_name_position(&self, identifier: ExprId) -> Option<u32> {
        let hir = self.hir;
        let Parent::Prop(property) = self.bound.parent_of_expr(identifier) else {
            return None;
        };
        if hir[property].kind != PropKind::Shorthand {
            return None;
        }
        let is_in_word =
            |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | 0x80..);
        let name = hir[identifier];
        let start = self.next_token_position(name.end) as usize;
        let end = start + (name.end - name.pos) as usize;
        if self.is_shown_without_source_map() {
            return Some(end as u32);
        }
        let mut mapped = name.pos as usize;
        let mut position = start;
        while let Some(&byte) = hir.text.get(position).filter(|_| position <= end) {
            match byte {
                b'{' | b'}' | b')' | b']' => mapped = position,
                b'"' | b'\'' | b'`' => {
                    mapped = position;
                    let rest = &hir.text[position + 1..];
                    let length = rest.iter().position(|&next| next == byte);
                    position += length.unwrap_or(rest.len()) + 1;
                }
                _ if is_in_word(byte) && !is_in_word(hir.text[position - 1]) => mapped = position,
                _ => {}
            }
            position += 1;
        }
        Some(mapped as u32)
    }

    // JSC reports `instanceof` and `in` where the right operand starts. The source map knows no `(` that is printed around it, and takes that to the token in front.
    pub(in crate::lower) fn right_operand_position(&self, left: ExprId, right: ExprId) -> u32 {
        if self.runs_as_written() {
            return start_of(self.hir, right);
        }
        match self.begins_with_parenthesis_in(right, Around::RightOperand(BinOp::In)) {
            true => self.last_mapped_position(left),
            false => self.first_position(right),
        }
    }

    // What stands in place of an operand when Bun's transpiler last visits the operator around it.
    fn skip_to_initializer_visited_again(&self, operand: ExprId) -> ExprId {
        let mut printed = self.skip_unprinted_syntax(operand);
        while let ExprKind::Ident(_) = self.hir[printed].kind
            && let Some(initializer) = self.find_revisited_initializer(printed)
        {
            printed = self.skip_unprinted_syntax(initializer);
        }
        printed
    }

    // `[n][0]`, of which only `n` is printed.
    fn find_access_printed_as(&self, list: ExprId, element: ExprId) -> Option<ExprId> {
        let Parent::Expr(access) = self.bound.parent_of_expr(list) else {
            return None;
        };
        let ExprKind::Index { obj, index, .. } = self.hir.written_kind(access) else {
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

    // JSC stores the value of `export default value` in a variable named `starDefault`, and reports the store as many columns behind the start of the value as that name is long. The source map takes
    // the place back to the last token that it knows there.
    pub(in crate::lower) fn default_export_position(&self, value: ExprId) -> u32 {
        const LENGTH_OF_VARIABLE_NAME: u32 = 11;
        let hir = self.hir;
        let start = self.first_position(value);
        let reported = start + LENGTH_OF_VARIABLE_NAME;
        if self.runs_as_written() {
            return reported;
        }
        let mut last = start;
        let mut stack = vec![TreeNode::Expr(value)];
        while let Some(node) = stack.pop() {
            let TreeNode::Expr(part) = node else {
                continue;
            };
            let first = self.first_position(part);
            if first > reported {
                continue;
            }
            let mut tokens: SmallVec<[u32; 8]> =
                smallvec![first, self.last_mapped_value_position(part)];
            if let ExprKind::Object(properties) = hir[self.skip_type_syntax(part)].kind {
                tokens.extend(properties.iter().map(|property| hir[property].pos));
            }
            let in_front = tokens.into_iter().filter(|&token| token <= reported);
            last = last.max(in_front.max().unwrap_or(last));
            push_children(hir, node, &mut stack);
        }
        last
    }

    // Bun's transpiler gives an expression the position of its first operand, without the parentheses around it.
    pub(in crate::lower) fn first_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let mut first = self.skip_type_syntax(expression);
        if self.runs_as_written() {
            return hir[first].pos;
        }
        let mut replaced: SmallVec<[ExprId; 4]> = SmallVec::new();
        let position = loop {
            let next = match hir.written_kind(first) {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    right,
                } => match self.is_removed_when_unused(left) {
                    true => right,
                    false => left,
                },
                ExprKind::Binary { op, left, right }
                    if let Some(operand) = self.find_printed_logical_operand(op, left, right) =>
                {
                    operand
                }
                // The transpiler gives a string that it concatenates the position of the left operand as printed, and any other folded result the position of the expression as parsed.
                ExprKind::Binary { left, .. } if self.is_rope(first) => left,
                ExprKind::Binary { .. } | ExprKind::Dot { .. }
                    if self.is_literal_operand(first) =>
                {
                    break self.parsed_position(first);
                }
                ExprKind::Binary { op, left, right } => self.printed_operands(op, left, right).0,
                ExprKind::Cond { test, branches } => match self.find_printed_condition(test) {
                    Some(true) => hir.branches(branches).yes,
                    Some(false) => hir.branches(branches).no,
                    None => test,
                },
                ExprKind::Assign { target, .. } => target,
                ExprKind::Index { obj, index, .. } => {
                    self.find_printed_element(obj, index).unwrap_or(obj)
                }
                // The transpiler gives what it makes of `void 0` the position of the operand, which is still a name if an initializer is printed there later.
                ExprKind::Unary {
                    op: UnOp::Void,
                    operand,
                } if self.is_printed_as_undefined(first) => {
                    let is_literal = self.is_literal_operand(operand)
                        && !self.becomes_literal_when_visited_again(operand);
                    match is_literal {
                        true => operand,
                        false => break self.parsed_position(operand),
                    }
                }
                ExprKind::Dot { obj, .. } => obj,
                ExprKind::Call(site) | ExprKind::TaggedTemplate(site) => hir[site].callee,
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => operand,
                ExprKind::Ident(_)
                    if let Some(&position) =
                        self.printed_operators.first_positions.borrow().get(&first) =>
                {
                    break position;
                }
                ExprKind::Ident(_) => {
                    let printed = match self.find_printed_in_place(first) {
                        Some(Printed::Initializer(initializer)) => initializer,
                        Some(Printed::Function(function)) => break hir[function].start,
                        None => match self.find_printed_value(first) {
                            Some(value) => value,
                            None => break hir[first].pos,
                        },
                    };
                    replaced.push(first);
                    printed
                }
                _ => break hir[first].pos,
            };
            first = self.skip_type_syntax(next);
        };
        let mut first_positions = self.printed_operators.first_positions.borrow_mut();
        first_positions.extend(replaced.into_iter().map(|name| (name, position)));
        position
    }

    // Bun's parser gives an expression the position of its first operand, without the parentheses around it.
    fn parsed_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let mut first = self.skip_type_syntax(expression);
        loop {
            let next = match hir.written_kind(first) {
                ExprKind::Binary { left, .. } => left,
                ExprKind::Cond { test, .. } => test,
                ExprKind::Assign { target, .. } => target,
                ExprKind::Index { obj, .. } | ExprKind::Dot { obj, .. } => obj,
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

    // Whether the text that Bun's transpiler prints for the operand of a `...` begins with a parenthesis, which its source map does not know.
    pub(in crate::lower) fn begins_with_parenthesis(&self, operand: ExprId) -> bool {
        self.begins_with_parenthesis_in(operand, Around::Spread)
    }

    fn begins_with_parenthesis_in(&self, operand: ExprId, around: Around) -> bool {
        let hir = self.hir;
        let mut first = self.skip_type_syntax(operand);
        let mut around = around;
        loop {
            let is_access = matches!(around, Around::Access { .. });
            let is_loose = !matches!(around, Around::Spread);
            let (next, below) = match hir.written_kind(first) {
                _ if self.is_literal_operand(first) => return false,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    right,
                } if self.is_removed_when_unused(left) => {
                    let kept = hir[self.skip_type_syntax(right)].kind;
                    let is_member = matches!(kept, ExprKind::Dot { .. } | ExprKind::Index { .. });
                    if is_member && matches!(around, Around::Access { is_callee: true }) {
                        return true;
                    }
                    (right, around)
                }
                ExprKind::Binary { op, left, right }
                    if let Some(operand) = self.find_printed_logical_operand(op, left, right) =>
                {
                    (operand, around)
                }
                ExprKind::Binary { op, left, right } => {
                    let is_wrapped = match around {
                        Around::Spread => op == BinOp::Comma,
                        Around::Operator(outer) => {
                            op == BinOp::Comma || needs_parentheses(outer, op, true)
                        }
                        Around::RightOperand(outer) => {
                            op == BinOp::Comma || needs_parentheses(outer, op, false)
                        }
                        Around::Condition => op == BinOp::Comma,
                        Around::Access { .. } => true,
                    };
                    if is_wrapped {
                        return true;
                    }
                    (
                        self.printed_operands(op, left, right).0,
                        Around::Operator(op),
                    )
                }
                ExprKind::Cond { test, branches } => match self.find_printed_condition(test) {
                    Some(true) => (hir.branches(branches).yes, around),
                    Some(false) => (hir.branches(branches).no, around),
                    None if is_loose => return true,
                    None => (test, Around::Condition),
                },
                ExprKind::Assign { .. } | ExprKind::Yield { .. } => return is_loose,
                ExprKind::Fn(function) => return is_loose && hir[function].kind == FnKind::Arrow,
                ExprKind::Await(_) => {
                    return is_access || matches!(around, Around::Operator(BinOp::Pow));
                }
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    ..
                } => return is_access,
                ExprKind::Unary { .. } => {
                    return is_access || matches!(around, Around::Operator(BinOp::Pow));
                }
                ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_)
                    if is_access
                        && self.is_chain_root(first)
                        && hir.expr_flags(first).contains(ExprFlags::PARENTHESIZED) =>
                {
                    return true;
                }
                ExprKind::Index { obj, index, .. } => match self.find_printed_element(obj, index) {
                    Some(element) => (element, around),
                    None => (obj, Around::Access { is_callee: false }),
                },
                ExprKind::Dot { obj, .. } => (obj, Around::Access { is_callee: false }),
                ExprKind::Call(site) => (hir[site].callee, Around::Access { is_callee: true }),
                // Its source map knows where a tagged template begins, whatever the tag begins with.
                ExprKind::TaggedTemplate(_) => return false,
                ExprKind::Ident(_) => match self.find_printed_in_place(first) {
                    Some(Printed::Initializer(initializer)) => (initializer, around),
                    Some(Printed::Function(_)) | None => return false,
                },
                _ => return false,
            };
            first = self.skip_type_syntax(next);
            around = below;
        }
    }

    // Bun's transpiler computes an operator whose operands are literals, and prints the result at the position of the operator's expression.
    // Bun's transpiler prints the initializer of a variable in place of its only use. Where the expression of that statement is an operator or a condition it visits the expression again, and computes
    // what has become an operator over literals.
    fn find_revisited_initializer(&self, name: ExprId) -> Option<ExprId> {
        let is_asking = &self.printed_operators.is_asking_about_variable_used_once;
        if is_asking.get() {
            return None;
        }
        let remembered = &self.printed_operators.revisited_initializers;
        if let Some(&initializer) = remembered.borrow().get(&name) {
            return initializer;
        }
        is_asking.set(true);
        let initializer = self.find_initializer_visited_again(name);
        is_asking.set(false);
        remembered.borrow_mut().insert(name, initializer);
        initializer
    }

    fn find_literal_visited_again(&self, name: ExprId) -> Option<ExprId> {
        self.find_revisited_initializer(name)
            .filter(|&initializer| self.is_literal_operand(initializer))
    }

    // `1 + "ab".length` and `Level.High`, of which Bun's transpiler prints the value.
    pub(in crate::lower) fn is_folded_into_literal(&self, expression: ExprId) -> bool {
        match self.hir.written_kind(self.skip_type_syntax(expression)) {
            ExprKind::Unary { op: UnOp::Void, .. } => false,
            ExprKind::Binary { .. }
            | ExprKind::Unary { .. }
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. } => self.is_literal_operand(expression),
            _ => false,
        }
    }

    // `a` in `.a` and in `["a"]`.
    fn find_written_member_name(&self, key: MemberKey) -> Option<Atom> {
        match key {
            MemberKey::Name(name) => Some(name),
            MemberKey::Computed(key) => match self.hir[self.skip_type_syntax(key)].kind {
                ExprKind::String(text) => Some(text),
                _ => None,
            },
            MemberKey::PrivateName(_) => None,
        }
    }

    // `Level.High`, `Level["High"]`, or `High` in another member of `Level`.
    fn find_named_enum_member(&self, expression: ExprId) -> Option<EnumMemberId> {
        let (hir, bound) = (self.hir, self.bound);
        let declarations_of = |name: ExprId| match (hir[name].kind, bound.binding(name)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(bound.symbol(symbol).decls),
            _ => None,
        };
        let Some((object, key)) = hir.member_key(expression) else {
            return match *declarations_of(expression)? {
                [Decl::EnumMember(member)] => Some(member),
                _ => None,
            };
        };
        let name = self.find_written_member_name(key)?;
        if !hir.is_name_resolved_by_transpiler(expression, self.queries.atom_bytes(name)) {
            return None;
        }
        let limit = self
            .inputs
            .limits
            .get(LimitId::MaxStepsToPrintedInitializer) as usize;
        let declarations = declarations_of(self.skip_type_syntax(object))?;
        declarations
            .iter()
            .find_map(|&declaration| match declaration {
                Decl::Enum(declared) => {
                    let mut members = hir[declared].members.iter().take(limit);
                    members.find(|&member| hir[member].name == name)
                }
                _ => None,
            })
    }

    // Bun's transpiler prints the value in place of the name of such a member: its initializer is a literal, or it counts on from one that is a number.
    fn is_enum_member_known_when_parsed(&self, member: EnumMemberId) -> bool {
        let hir = self.hir;
        let Some(owner) = self.bound.enum_member_owner[member.idx()].some() else {
            return false;
        };
        let limit = self
            .inputs
            .limits
            .get(LimitId::MaxStepsToPrintedInitializer) as usize;
        let members = hir[owner].members;
        let index = (member.0 - members.start) as usize;
        let mut counted = (0..=index).rev().take(limit + 1);
        let first = counted.find_map(|index| {
            let other = members.at(index);
            Some((other, hir[other].init.some()?))
        });
        match first {
            Some((other, initializer)) => match self.find_literal_kind(initializer) {
                Some(LiteralKind::Number) => true,
                Some(LiteralKind::String(_)) => other == member,
                _ => false,
            },
            None => index <= limit,
        }
    }

    fn find_enum_member_value(&self, member: EnumMemberId) -> Option<Constant> {
        let hir = self.hir;
        let owner = self.bound.enum_member_owner[member.idx()].some()?;
        let members = hir[owner].members;
        let index = (member.0 - members.start) as usize;
        let first = (0..=index)
            .rev()
            .find_map(|other| Some((other, hir[members.at(other)].init.some()?)));
        match first {
            Some((other, initializer)) if other == index => self.find_literal_value(initializer),
            Some((other, initializer)) => match self.find_literal_value(initializer)? {
                Constant::Number(start) => Some(Constant::Number(start + (index - other) as f64)),
                _ => None,
            },
            None => Some(Constant::Number(index as f64)),
        }
    }

    // Bun's transpiler drops the left operand of a comma if evaluating it does nothing.
    pub(in crate::lower) fn is_removed_when_unused(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut parts: SmallVec<[ExprId; 8]> = smallvec![expression];
        while let Some(part) = parts.pop() {
            let inner = self.skip_type_syntax(part);
            let is_removed = match hir[inner].kind {
                ExprKind::Ident(_) => match self.bound.binding(inner) {
                    Binding::Free => self.is_literal_operand(inner),
                    // It keeps a read of what `import { name }` or `import name` binds.
                    Binding::Symbol(symbol) => {
                        let mut declarations = self.bound.symbol(symbol).decls.iter();
                        !declarations.any(|decl| {
                            matches!(decl, Decl::ImportDefault(_) | Decl::ImportSpec(_))
                        })
                    }
                    Binding::Arguments(_) | Binding::CommonJs(_) => true,
                },
                ExprKind::This | ExprKind::BigInt(_) | ExprKind::Fn(_) => true,
                ExprKind::Unary {
                    op: UnOp::Typeof,
                    operand,
                } if matches!(hir[operand].kind, ExprKind::Ident(_)) => true,
                // It decides at the first visit, where a variable that is used once still stands in the expression.
                _ if self.is_literal_operand(inner)
                    && !self.becomes_literal_when_visited_again(inner) =>
                {
                    true
                }
                // An operator that converts nothing goes with its operands.
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Void,
                    operand,
                } => {
                    parts.push(operand);
                    true
                }
                ExprKind::Binary {
                    op:
                        BinOp::EqEqEq
                        | BinOp::NotEqEq
                        | BinOp::Comma
                        | BinOp::And
                        | BinOp::Or
                        | BinOp::Nullish,
                    left,
                    right,
                } => {
                    parts.extend([left, right]);
                    true
                }
                ExprKind::Cond { test, branches } => {
                    let branches = hir.branches(branches);
                    parts.extend([test, branches.yes, branches.no]);
                    true
                }
                ExprKind::Array(elements) => {
                    parts.extend(hir.ids(elements));
                    true
                }
                _ => false,
            };
            if !is_removed {
                return false;
            }
        }
        true
    }

    // Of `!a` and `void a` whose value nobody takes it prints `a`.
    pub(in crate::lower) fn skip_operators_dropped_when_unused(
        &self,
        expression: ExprId,
    ) -> ExprId {
        let mut kept = self.skip_type_syntax(expression);
        while let ExprKind::Unary {
            op: UnOp::Not | UnOp::Void,
            operand,
        } = self.hir[kept].kind
        {
            kept = self.skip_type_syntax(operand);
        }
        kept
    }

    fn becomes_literal_when_visited_again(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut stack = vec![TreeNode::Expr(expression)];
        while let Some(node) = stack.pop() {
            if let TreeNode::Expr(part) = node {
                // `void a` is folded at the first visit.
                if matches!(hir[part].kind, ExprKind::Unary { op: UnOp::Void, .. })
                    && self.is_printed_as_undefined(part)
                {
                    continue;
                }
                if matches!(hir[part].kind, ExprKind::Ident(_))
                    && self.find_printed_value(part).is_none()
                    && self.find_literal_visited_again(part).is_some()
                {
                    return true;
                }
            }
            push_children(hir, node, &mut stack);
        }
        false
    }

    // An expression without what Bun's transpiler does not print: type syntax, a comma whose left operand it drops, and what a literal decides against.
    pub(in crate::lower) fn skip_unprinted_syntax(&self, expression: ExprId) -> ExprId {
        let mut printed = self.skip_type_syntax(expression);
        if self.runs_as_written() {
            return printed;
        }
        loop {
            let inner = match self.hir.written_kind(printed) {
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
                ExprKind::Cond { test, branches } => match self.find_printed_condition(test) {
                    Some(true) => self.hir.branches(branches).yes,
                    Some(false) => self.hir.branches(branches).no,
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
        if op == BinOp::Nullish {
            let printed = match hir[literal].kind {
                ExprKind::Ident(_) => self.skip_to_initializer_visited_again(literal),
                _ => literal,
            };
            let is_never_nullish = match hir[printed].kind {
                ExprKind::Unary { op, .. } => matches!(
                    op,
                    UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof
                ),
                ExprKind::Binary { op, .. } => {
                    !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
                }
                _ => false,
            };
            if is_never_nullish {
                return Some(true);
            }
            let kind = self.find_literal_kind(literal)?;
            return Some(!matches!(kind, LiteralKind::Null | LiteralKind::Undefined));
        }
        let is_true = self.find_printed_condition(literal)?;
        Some(match op {
            BinOp::And => !is_true,
            _ => is_true,
        })
    }

    // For `require("a")` and `require.resolve("a")` the source map of Bun's transpiler knows one token, where the call starts.
    fn is_require_of_literal(&self, call: ExprId) -> bool {
        let analysis = &self.compiled.analysis;
        let Some(site) = analysis.import_site_of_call(call) else {
            return false;
        };
        let site = analysis.import_sites[site];
        // A function that the program has made and named `require` is called as any other.
        let hir = self.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return false;
        };
        let mut root = self.skip_type_syntax(hir[id].callee);
        if let ExprKind::Dot { obj, .. } = hir.written_kind(root) {
            root = self.skip_type_syntax(obj);
        }
        let is_declared = matches!(hir[root].kind, ExprKind::Ident(_))
            && matches!(self.bound.binding(root), Binding::Symbol(_));
        !is_declared
            && matches!(
                site.kind,
                ImportSiteKind::Require(_) | ImportSiteKind::RequireResolve(_)
            )
            && site.specifier_node.is_some()
            && self.is_literal_operand(site.specifier_node)
    }

    // Of `(0, require)("a")` Bun's transpiler prints `require("a")`, and that one token stands where the callee is written.
    fn find_start_of_require_printed_alone(&self, site: Call) -> Option<u32> {
        let hir = self.hir;
        let written = self.skip_type_syntax(site.callee);
        let printed = self.skip_unprinted_syntax(written);
        let is_require = printed != written
            && matches!(hir[printed].kind, ExprKind::Ident(known::require))
            && !matches!(self.bound.binding(printed), Binding::Symbol(_));
        let mut arguments = hir.ids(site.args);
        let (Some(specifier), None) = (arguments.next(), arguments.next()) else {
            return None;
        };
        if !is_require || !self.is_printed_as_specifier(specifier) {
            return None;
        }
        let mut first = written;
        loop {
            let operand = match hir.written_kind(first) {
                ExprKind::Binary { left, .. } => left,
                ExprKind::Cond { test, .. } => test,
                ExprKind::Index { obj, .. } => obj,
                _ => return Some(hir[first].pos),
            };
            first = self.skip_type_syntax(operand);
        }
    }

    // `require(a ? "b" : "c")` is printed `a ? require("b") : require("c")`.
    fn is_printed_as_specifier(&self, argument: ExprId) -> bool {
        let printed = self.skip_unprinted_syntax(argument);
        match self.hir.written_kind(printed) {
            ExprKind::Cond { branches, .. } => {
                let branches = self.hir.branches(branches);
                self.is_printed_as_specifier(branches.yes)
                    && self.is_printed_as_specifier(branches.no)
            }
            _ => self.is_string_literal_operand(printed),
        }
    }

    // `{ a: b }.a` is printed `b`, unless it is called.
    fn find_printed_member(&self, access: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let (object, key) = hir.member_key(access)?;
        let ExprKind::Object(properties) = hir[self.skip_type_syntax(object)].kind else {
            return None;
        };
        let name = self.find_written_member_name(key)?;
        let mut properties = properties.iter().map(|property| hir[property]);
        let (Some(only), None) = (properties.next(), properties.next()) else {
            return None;
        };
        let is_called = match self.bound.parent_of_expr(access) {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Call(site) | ExprKind::TaggedTemplate(site) => {
                    self.skip_type_syntax(hir[site].callee) == access
                }
                _ => false,
            },
            _ => false,
        };
        let is_found = only.kind == PropKind::Init
            && matches!(only.key, PropKey::Name(written) if written == name)
            && self.is_removed_when_unused(only.value);
        (is_found && !is_called).then_some(only.value)
    }

    // `new Object()` is printed `{}`, `new Object({ a })` is printed `{ a }`, `new Array()` is printed `[]` and `new Array(a, b)` is printed `[a, b]`.
    // The last part of the literal, if it has one.
    fn find_printed_literal(&self, site: Call) -> Option<Option<ExprId>> {
        let hir = self.hir;
        let callee = self.skip_type_syntax(site.callee);
        let ExprKind::Ident(name) = hir[callee].kind else {
            return None;
        };
        if !matches!(self.bound.binding(callee), Binding::Free) {
            return None;
        }
        let mut arguments = hir.ids(site.args);
        if arguments.any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return None;
        }
        let last = hir.ids(site.args).last();
        match (name, site.args.len) {
            (known::Object | known::Array, 0) => Some(None),
            (known::Object, 1) => last
                .filter(|&only| {
                    matches!(hir[self.skip_type_syntax(only)].kind, ExprKind::Object(_))
                })
                .map(Some),
            (known::Array, 2..) => Some(last),
            _ => None,
        }
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

    // The kind of literal that Bun's transpiler prints in place of an expression, if it prints one.
    // The operators of `a + b + c` are asked from the innermost on, so that each finds the answer for its left operand.
    fn find_literal_kind(&self, expression: ExprId) -> Option<LiteralKind> {
        let written = self.skip_type_syntax(expression);
        if !matches!(self.hir[written].kind, ExprKind::Binary { .. }) {
            return self.compute_literal_kind(written);
        }
        if let Some(kind) = self.printed_operators.find_kind(written) {
            return kind;
        }
        let mut row: SmallVec<[ExprId; 8]> = smallvec![written];
        while let Some(left) = self.find_deciding_left_operator(row[row.len() - 1])
            && self.printed_operators.find_kind(left).is_none()
        {
            row.push(left);
        }
        let mut kind = None;
        for &operator in row.iter().rev() {
            kind = self.compute_literal_kind(operator);
            self.printed_operators.remember_kind(operator, kind);
        }
        kind
    }

    fn compute_literal_kind(&self, expression: ExprId) -> Option<LiteralKind> {
        let hir = self.hir;
        let printed = self.skip_unprinted_syntax(expression);
        if let Some(member) = self.find_named_enum_member(printed) {
            if !self.is_enum_member_known_when_parsed(member) {
                return None;
            }
            return match hir[member].init.some().map(|it| self.find_literal_kind(it)) {
                Some(Some(LiteralKind::String(StringForm::Rope))) => {
                    Some(LiteralKind::String(StringForm::Flat))
                }
                Some(kind) => kind,
                None => Some(LiteralKind::Number),
            };
        }
        let form_of = |text: Atom| match self.queries.atom_bytes(text).is_ascii() {
            true => StringForm::Flat,
            false => StringForm::Utf16,
        };
        match hir.written_kind(printed) {
            ExprKind::Null => Some(LiteralKind::Null),
            ExprKind::True | ExprKind::False => Some(LiteralKind::Boolean),
            ExprKind::Number(_) => Some(LiteralKind::Number),
            ExprKind::BigInt(_) => Some(LiteralKind::BigInt),
            ExprKind::String(text) => Some(LiteralKind::String(form_of(text))),
            ExprKind::Template { exprs } => {
                let is_ascii = |kind| kind != LiteralKind::String(StringForm::Utf16);
                let mut texts = hir.ids(hir.template_texts(exprs));
                match texts.all(|text| form_of(text) == StringForm::Flat) {
                    true => hir
                        .ids(exprs)
                        .all(|part| self.find_literal_kind(part).is_some_and(is_ascii))
                        .then_some(LiteralKind::String(StringForm::Flat)),
                    false => exprs
                        .is_empty()
                        .then_some(LiteralKind::String(StringForm::Utf16)),
                }
            }
            ExprKind::Ident(name) if matches!(self.bound.binding(printed), Binding::Free) => {
                match name {
                    known::undefined => Some(LiteralKind::Undefined),
                    known::Infinity | known::NaN => Some(LiteralKind::Number),
                    _ => None,
                }
            }
            ExprKind::Ident(_) => {
                let value = self
                    .find_printed_value(printed)
                    .or_else(|| self.find_literal_visited_again(printed))?;
                self.find_literal_kind(value)
            }
            ExprKind::Dot { obj, .. } => {
                let is_length = matches!(
                    hir.member_key(printed),
                    Some((_, MemberKey::Name(known::length)))
                );
                let is_string =
                    || matches!(self.find_literal_kind(obj), Some(LiteralKind::String(_)));
                (is_length && is_string()).then_some(LiteralKind::Number)
            }
            ExprKind::Unary { op: UnOp::Void, .. } => self
                .is_printed_as_undefined(printed)
                .then_some(LiteralKind::Undefined),
            ExprKind::Unary { op, operand } => {
                let operand = self.find_literal_kind(operand)?;
                match op {
                    UnOp::Plus | UnOp::Minus | UnOp::BitNot => match operand {
                        LiteralKind::BigInt
                        | LiteralKind::String(StringForm::Rope | StringForm::Utf16) => None,
                        _ => Some(LiteralKind::Number),
                    },
                    UnOp::Not => Some(LiteralKind::Boolean),
                    UnOp::Typeof => Some(LiteralKind::String(StringForm::Flat)),
                    _ => None,
                }
            }
            ExprKind::Binary { op, left, right } if is_computable(op) => {
                let (left, right) = self.printed_operands(op, left, right);
                let right_kind = self.find_literal_kind(right)?;
                let left_kind = self.find_literal_kind(left)?;
                let is_number_comparison = left_kind == LiteralKind::Number
                    && matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge);
                match !is_number_comparison || self.is_comparison_folded(left, right) {
                    true => find_folded_kind(op, left_kind, right_kind),
                    false => None,
                }
            }
            _ => None,
        }
    }

    // Bun's transpiler folds `<` over two numbers unless one is NaN, or both are finite and one is beyond the safe integers.
    fn is_comparison_folded(&self, left: ExprId, right: ExprId) -> bool {
        const MAX_SAFE_INTEGER: f64 = 9007199254740991.0;
        let values = [left, right].map(|operand| self.find_literal_value(operand));
        let [Some(Constant::Number(left)), Some(Constant::Number(right))] = values else {
            return true;
        };
        !left.is_nan()
            && !right.is_nan()
            && (left.is_infinite()
                || right.is_infinite()
                || left.abs().max(right.abs()) <= MAX_SAFE_INTEGER)
    }

    pub(in crate::lower) fn is_literal_operand(&self, expression: ExprId) -> bool {
        self.find_literal_kind(expression).is_some()
    }

    pub(in crate::lower) fn is_string_literal_operand(&self, expression: ExprId) -> bool {
        matches!(
            self.find_literal_kind(expression),
            Some(LiteralKind::String(_))
        )
    }

    fn is_rope(&self, expression: ExprId) -> bool {
        self.find_literal_kind(expression) == Some(LiteralKind::String(StringForm::Rope))
    }

    // Whether Bun's transpiler prints the literal wherever the name of a constant that is initialized with it stands.
    pub(in crate::lower) fn can_be_constant_value(&self, initializer: ExprId) -> bool {
        let is_inlined = match self.find_literal_kind(initializer) {
            Some(LiteralKind::BigInt | LiteralKind::String(StringForm::Rope)) | None => false,
            Some(_) => true,
        };
        // It decides at the first visit, where a variable that is used once still stands in the initializer.
        is_inlined && !self.becomes_literal_when_visited_again(initializer)
    }

    fn find_value_known_to_build(&self, expression: ExprId) -> Option<Constant> {
        match self.decisions().constant(self.hir, expression) {
            FoldedValue::Constant(value) | FoldedValue::ConstantOutsideDeadZone(value) => {
                Some(value)
            }
            FoldedValue::Unknown => None,
        }
    }

    // The value of the literal that Bun's transpiler prints in place of an expression, if it prints one.
    fn find_literal_value(&self, expression: ExprId) -> Option<Constant> {
        self.find_literal_kind(expression)?;
        let written = self.skip_type_syntax(expression);
        if !matches!(self.hir[written].kind, ExprKind::Binary { .. }) {
            return self.compute_literal_value(written);
        }
        if let Some(value) = self.printed_operators.find_value(written) {
            return value;
        }
        let mut row: SmallVec<[ExprId; 8]> = smallvec![written];
        while self.find_value_known_to_build(row[row.len() - 1]).is_none()
            && let Some(left) = self.find_deciding_left_operator(row[row.len() - 1])
            && self.printed_operators.find_value(left).is_none()
        {
            row.push(left);
        }
        let mut value = None;
        for &operator in row.iter().rev() {
            value = self.compute_literal_value(operator);
            self.printed_operators.remember_value(operator, value);
        }
        value
    }

    fn compute_literal_value(&self, expression: ExprId) -> Option<Constant> {
        let hir = self.hir;
        let printed = self.skip_unprinted_syntax(expression);
        if let Some(value) = self.find_value_known_to_build(printed) {
            return Some(value);
        }
        if let Some(member) = self.find_named_enum_member(printed) {
            return self.find_enum_member_value(member);
        }
        let atoms = &self.queries.files().atoms;
        match hir.written_kind(printed) {
            ExprKind::Ident(name) if matches!(self.bound.binding(printed), Binding::Free) => {
                match name {
                    known::undefined => Some(Constant::Undefined),
                    known::Infinity => Some(Constant::Number(f64::INFINITY)),
                    known::NaN => Some(Constant::Number(f64::NAN)),
                    _ => None,
                }
            }
            ExprKind::Ident(_) => {
                let value = self
                    .find_printed_value(printed)
                    .or_else(|| self.find_literal_visited_again(printed))?;
                self.find_literal_value(value)
            }
            ExprKind::Dot { obj, .. } => match self.find_literal_value(obj)? {
                Constant::String(text) => {
                    let units = self
                        .queries
                        .atom_bytes(text)
                        .iter()
                        .map(|&byte| match byte {
                            0x80..=0xBF => 0,
                            0xF0.. => 2,
                            _ => 1,
                        });
                    Some(Constant::Number(f64::from(units.sum::<u32>())))
                }
                _ => None,
            },
            ExprKind::Template { exprs } => {
                let mut texts = hir.ids(hir.template_texts(exprs)).map(Constant::String);
                let mut joined = texts.next()?;
                for (part, text) in hir.ids(exprs).zip(texts) {
                    for next in [self.find_literal_value(part)?, text] {
                        joined = fold::apply_binary(atoms, BinOp::Add, [joined, next], usize::MAX)?;
                    }
                }
                Some(joined)
            }
            ExprKind::Unary { op: UnOp::Void, .. } => Some(Constant::Undefined),
            ExprKind::Unary { op, operand } => {
                fold::apply_unary(atoms, op, self.find_literal_value(operand)?)
            }
            ExprKind::Binary { op, left, right } => {
                let operands = [
                    self.find_literal_value(left)?,
                    self.find_literal_value(right)?,
                ];
                fold::apply_binary(atoms, op, operands, usize::MAX)
            }
            _ => None,
        }
    }

    // Bun's transpiler moves a literal on the left of an equality operator to the right.
    pub(in crate::lower) fn printed_operands(
        &self,
        op: BinOp,
        left: ExprId,
        right: ExprId,
    ) -> (ExprId, ExprId) {
        if self.runs_as_written() {
            return (left, right);
        }
        // It decides at the first visit, where a variable that is used once still stands in the operand.
        let is_moved = |operand| {
            self.is_literal_operand(operand) && !self.becomes_literal_when_visited_again(operand)
        };
        match is_equality(op) && is_moved(left) && !is_moved(right) {
            true => (right, left),
            false => (left, right),
        }
    }

    // The left operand of an operator, where that is an operator which decides what is printed for this one.
    fn find_deciding_left_operator(&self, operator: ExprId) -> Option<ExprId> {
        let ExprKind::Binary { op, left, right } = self.hir[operator].kind else {
            return None;
        };
        let left = self.skip_type_syntax(left);
        let is_deciding = matches!(self.hir[left].kind, ExprKind::Binary { .. })
            && (!is_computable(op) || self.is_literal_operand(right));
        is_deciding.then_some(left)
    }

    // `undefined` and `void 0`, which Bun's transpiler prints `void 0`.
    pub(in crate::lower) fn is_printed_as_undefined(&self, expression: ExprId) -> bool {
        let written = self.skip_type_syntax(expression);
        match self.hir[written].kind {
            ExprKind::Ident(known::undefined) => {
                matches!(self.bound.binding(written), Binding::Free)
            }
            ExprKind::Unary {
                op: UnOp::Void,
                operand,
            } => self.is_removed_when_unused(operand),
            _ => false,
        }
    }

    // `x + "a" + "b"` is printed `x + "ab"`.
    fn is_joined_with_text_on_the_left(&self, left: ExprId, right: ExprId) -> bool {
        let left = self.hir[self.skip_to_initializer_visited_again(left)].kind;
        let ExprKind::Binary {
            op: BinOp::Add,
            right: middle,
            ..
        } = left
        else {
            return false;
        };
        let is_ascii = |kind| kind != LiteralKind::String(StringForm::Utf16);
        let middle = self.find_literal_kind(middle);
        matches!(middle, Some(kind @ LiteralKind::String(_)) if is_ascii(kind))
            && self.find_literal_kind(right).is_some_and(is_ascii)
    }

    // Of `true ? a : b` Bun's transpiler prints `a`.
    pub(in crate::lower) fn find_printed_condition(&self, test: ExprId) -> Option<bool> {
        let value = self.find_literal_value(test)?;
        match fold::apply_unary(&self.queries.files().atoms, UnOp::Not, value)? {
            Constant::Boolean(is_false) => Some(!is_false),
            _ => None,
        }
    }

    // JSC's parser knows `Reflect.construct(target, list)` by these two names, whatever `Reflect` is bound to.
    pub(super) fn is_reflect_construct_syntax(&self, callee: ExprId) -> bool {
        let hir = self.hir;
        let member = self.skip_type_syntax(callee);
        let Some((object, key)) = hir.member_key(member) else {
            return false;
        };
        // Bun's transpiler prints `Reflect["construct"]` with a dot.
        if self.runs_as_written() && !matches!(hir.written_kind(member), ExprKind::Dot { .. }) {
            return false;
        }
        // Bun's transpiler prints the initializer of a variable in place of its only use, and a literal in place of the name of a constant.
        let name = match key {
            MemberKey::Name(name) => name,
            MemberKey::Computed(key) => match self
                .find_printed_initializer(key)
                .or_else(|| self.find_printed_value(key))
            {
                Some(printed) => match hir[self.skip_type_syntax(printed)].kind {
                    ExprKind::String(text) => text,
                    _ => return false,
                },
                None => return false,
            },
            MemberKey::PrivateName(_) => return false,
        };
        let object = self.skip_type_syntax(object);
        let ExprKind::Ident(object_name) = hir[object].kind else {
            return false;
        };
        self.queries.atom_bytes(object_name) == b"Reflect"
            && self.queries.atom_bytes(name) == b"construct"
            && self.find_printed_in_place(object).is_none()
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

    /// `value instanceof a.b`, as plain Bun quotes it in "a.b is not a function. (evaluating 'value instanceof a.b')", where both operands consist of names.
    pub(in crate::lower) fn find_written_instanceof(
        &mut self,
        left: ExprId,
        right: ExprId,
    ) -> Option<StringId> {
        let mut text = Vec::new();
        if !self.append_written_operand(left, &mut text) {
            return None;
        }
        text.extend_from_slice(b" instanceof ");
        let mut constructor = Vec::new();
        if !self.append_written_operand(right, &mut constructor) {
            return None;
        }
        text.extend_from_slice(&constructor);
        Some(self.intern_bytes(&text))
    }

    /// A path of names, or a literal as Bun's transpiler prints it.
    fn append_written_operand(&self, operand: ExprId, text: &mut Vec<u8>) -> bool {
        let printed = self.skip_unprinted_syntax(operand);
        let literal: &[u8] = match self.hir[printed].kind {
            ExprKind::Null => b"null",
            ExprKind::True => b"!0",
            ExprKind::False => b"!1",
            ExprKind::Ident(name) if matches!(self.bound.binding(printed), Binding::Free) => {
                match self.queries.atom_bytes(name) {
                    b"undefined" => b"void 0",
                    b"Infinity" => b"1 / 0",
                    _ => return self.append_written_path(printed, text),
                }
            }
            _ => {
                return self.names_what_is_printed(printed)
                    && self.append_written_path(printed, text);
            }
        };
        text.extend_from_slice(literal);
        true
    }

    // Bun's transpiler may print the initializer of a local `let` or `const` in place of its only use.
    fn names_what_is_printed(&self, path: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let inner = self.skip_type_syntax(path);
        match hir.written_kind(inner) {
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(inner) else {
                    return true;
                };
                !(matches!(
                    bound.binding_kind(symbol),
                    BindingKind::Let | BindingKind::Const
                ) && self.scopes.is_used_once(symbol)
                    && bound.symbol_scope(symbol) != module::file_scope(self)
                    && matches!(
                        bound.binding_initializer(hir, symbol),
                        BindingInitializer::Expression(_)
                    ))
            }
            ExprKind::Dot { obj, .. } => self.names_what_is_printed(obj),
            ExprKind::Index { obj, index, .. } => {
                self.names_what_is_printed(obj) && self.names_what_is_printed(index)
            }
            _ => true,
        }
    }

    /// `a.b.c`, `this.#x`, `a?.b[key]`: a callee that consists of names, as plain Bun quotes it in "a.b.c is not a function".
    /// Answers false, with `path` in any state, for anything else and for what is too long to be worth its bytes in the executable.
    fn append_written_path(&self, expression: ExprId, path: &mut Vec<u8>) -> bool {
        const LONGEST_PATH: usize = 80;
        let hir = self.hir;
        let inner = self.skip_type_syntax(expression);
        match hir.written_kind(inner) {
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
                    ExprKind::Number(key) => {
                        let key = hir.numbers[key as usize];
                        if key.fract() != 0.0 || !(0.0..=f64::from(u32::MAX)).contains(&key) {
                            return false;
                        }
                        if chain == Chain::Start {
                            path.extend_from_slice(b"?.");
                        }
                        path.extend_from_slice(format!("[{}]", key as u32).as_bytes());
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
    match file.builtins.of_pure_expr(expression) {
        Some(Resolved::Builtin(path)) => path.locked_builtin(),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}
