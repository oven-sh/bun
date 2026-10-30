use std::cell::RefCell;

use bun_core::fmt::pow10_exp_1e4_to_1e9;
use bun_core::strings::contains_char;
use bun_sema::atom::{Atom, known, written_name};
use bun_sema::bind::{Binding, FnOwner, Parent};
use bun_sema::check::spans::skip_trivia;
use bun_sema::fold::{Constant, Decision, TreeNode, push_children};
use bun_sema::hir::{
    BinOp, Call, Chain, ExprFlags, ExprId, ExprKind, FnBody, FnId, FnKind, IdList, MemberKey,
    PropKind, UnOp, end_of_expr, start_of,
};
use bun_sema::import_sites::{ImportSiteKind, find_module_printed_as_require};
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

use super::Callee;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, StringId, ValueId};
use crate::lower::member::{self, KeyConversion, PropertyName};
use crate::lower::operator::needs_parentheses;
use crate::lower::statement::Printed;
use crate::lower::transpiled::{Rewrite, find_written_literal};
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
        let (hir, bound) = (self.file.hir, self.file.bound);
        if let Some(module) = find_module_printed_as_require(hir, bound, inner) {
            return self.lower_callee_printed_as_require(inner, module, expected);
        }
        match hir.member_key(inner) {
            Some((object, member_key)) => {
                self.lower_member_callee(inner, object, member_key, exit, expected)
            }
            None => self.lower_plain_callee(callee, inner, exit, expected),
        }
    }

    fn lower_callee_printed_as_require(
        &mut self,
        access: ExprId,
        module: ExprId,
        expected: Option<BuiltinId>,
    ) -> Callee {
        let name = Some(self.file.intern_atom(known::require));
        if let Some(builtin) = find_locked_builtin(self.file, access) {
            return Callee::without_key(self.emit_locked_builtin(builtin), None, name);
        }
        self.set_position(self.file.hir[module].pos);
        let (function, this) = self.lower_require_printed_at(module);
        Callee::without_key(self.finish_callee(access, function, expected), this, name)
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

// What stands around the start of an expression in the text that Bun's transpiler prints.
#[derive(Copy, Clone)]
enum Around {
    Spread,
    Operator(BinOp),
    RightOperand(BinOp),
    Condition,
    Access,
}

#[derive(Default)]
pub(in crate::lower) struct PrintedOperators {
    // By a name in whose place an initializer is printed: where that begins.
    first_positions: RefCell<FxHashMap<ExprId, u32>>,
    // By a name in whose place an initializer is printed: what stands there once every such name is followed to its initializer.
    printed_behind_names: RefCell<FxHashMap<ExprId, ExprId>>,
    // The functions printed in place of a name whose last position is being looked for.
    entered_functions: RefCell<SmallVec<[FnId; 4]>>,
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
            if let Some(operand) = self.find_operand_printed_alone(last) {
                last = self.skip_type_syntax(operand);
                continue;
            }
            let next = match hir.written_kind(last) {
                ExprKind::Index { index, .. } => index,
                ExprKind::Binary { left, .. }
                    if let Some(Rewrite::JoinedWithLeftOperand) = self.find_rewrite(last) =>
                {
                    left
                }
                ExprKind::Binary { .. } => self.printed_operands(last).1,
                ExprKind::Assign { value, .. } => value,
                ExprKind::Cond { branches, .. } => hir.branches(branches).no,
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
                        let entered = &self.printed_operators.entered_functions;
                        if entered.borrow().contains(&function) {
                            return hir[last].pos;
                        }
                        entered.borrow_mut().push(function);
                        let position = self.last_mapped_function_position(function);
                        entered.borrow_mut().pop();
                        return position.unwrap_or(hir[last].pos);
                    }
                    None => return hir[last].pos,
                },
                ExprKind::Dot { .. } if self.is_require_main_node(last) => {
                    return hir[last].pos;
                }
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

    // The transpiler prints `require.main` as one node, with one source map entry at its start.
    fn is_require_main_node(&self, member: ExprId) -> bool {
        let start = self.hir[member].pos;
        let transpiled = self.transpiled.as_ref();
        transpiled.is_some_and(|it| it.has_require_main_at(start))
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
        // JSC records no position for what an object pattern reads: the last one is that of the object behind the pattern.
        let written = self.hir[self.skip_type_syntax(object)].pos;
        let transpiled = self.transpiled.as_ref();
        if let Some(joined) = transpiled.and_then(|it| it.find_joined_declarator_at(written)) {
            return joined.printed_object;
        }
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
                _ if let Some(operand) = self.find_operand_printed_alone(parent) => {
                    if operand != last {
                        break;
                    }
                    parent
                }
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
                    op: BinOp::Comma, ..
                } => break,
                ExprKind::Binary { op, .. } => {
                    let is_in_parentheses = match hir[self.skip_type_syntax(last)].kind {
                        ExprKind::Binary { op: inner, .. } => needs_parentheses(op, inner, false),
                        ExprKind::Assign { .. } | ExprKind::Cond { .. } => op != BinOp::Comma,
                        _ => false,
                    };
                    if is_in_parentheses || self.printed_operands(parent).1 != last {
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
                ExprKind::Cond { branches, .. } => {
                    if hir.branches(branches).no != last {
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

    // `[n][0]`, of which only `n` is printed.
    fn find_access_printed_as(&self, list: ExprId, element: ExprId) -> Option<ExprId> {
        let Parent::Expr(access) = self.bound.parent_of_expr(list) else {
            return None;
        };
        (self.find_operand_printed_alone(access) == Some(element)).then_some(access)
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

    // Where the first token stands that Bun's transpiler prints for an expression.
    pub(in crate::lower) fn first_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let mut first = self.skip_type_syntax(expression);
        if self.runs_as_written() {
            return hir[first].pos;
        }
        let mut replaced: SmallVec<[ExprId; 4]> = SmallVec::new();
        let position = loop {
            let next = match hir.written_kind(first) {
                _ if let Some(Rewrite::Literal { position, .. }) = self.find_rewrite(first) => {
                    break position;
                }
                _ if let Some(operand) = self.find_operand_printed_alone(first) => operand,
                ExprKind::Binary { .. } => self.printed_operands(first).0,
                ExprKind::Cond { test, .. } => test,
                ExprKind::Assign { target, .. } => target,
                ExprKind::Index { obj, .. } | ExprKind::Dot { obj, .. } => obj,
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
                        None => break hir[first].pos,
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

    // Whether the text that Bun's transpiler prints for the operand of a `...` begins with a parenthesis, which its source map does not know.
    pub(in crate::lower) fn begins_with_parenthesis(&self, operand: ExprId) -> bool {
        self.begins_with_parenthesis_in(operand, Around::Spread)
    }

    fn begins_with_parenthesis_in(&self, operand: ExprId, around: Around) -> bool {
        let hir = self.hir;
        let mut first = self.skip_type_syntax(operand);
        let mut around = around;
        loop {
            let is_access = matches!(around, Around::Access);
            let is_loose = !matches!(around, Around::Spread);
            let (next, below) = match hir.written_kind(first) {
                _ if self.is_literal_operand(first) => return false,
                _ if let Some(operand) = self.find_operand_printed_alone(first) => {
                    (operand, around)
                }
                ExprKind::Binary { op, .. } => {
                    let is_wrapped = match around {
                        Around::Spread => op == BinOp::Comma,
                        Around::Operator(outer) => {
                            op == BinOp::Comma || needs_parentheses(outer, op, true)
                        }
                        Around::RightOperand(outer) => {
                            op == BinOp::Comma || needs_parentheses(outer, op, false)
                        }
                        Around::Condition => op == BinOp::Comma,
                        Around::Access => true,
                    };
                    if is_wrapped {
                        return true;
                    }
                    (self.printed_operands(first).0, Around::Operator(op))
                }
                ExprKind::Cond { .. } if is_loose => return true,
                ExprKind::Cond { test, .. } => (test, Around::Condition),
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
                ExprKind::Index { obj, .. } | ExprKind::Dot { obj, .. } => (obj, Around::Access),
                ExprKind::Call(site) => (hir[site].callee, Around::Access),
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

    fn find_rewrite(&self, expression: ExprId) -> Option<Rewrite> {
        self.transpiled.as_ref()?.find_rewrite(expression)
    }

    // Of `(a, b)`, `1 && b`, `true ? b : c` and `[b][0]` Bun's transpiler may print `b` alone.
    pub(in crate::lower) fn find_operand_printed_alone(
        &self,
        expression: ExprId,
    ) -> Option<ExprId> {
        match self.find_rewrite(expression)? {
            Rewrite::Operand(operand)
                if !matches!(self.hir[expression].kind, ExprKind::Ident(_)) =>
            {
                Some(operand)
            }
            _ => None,
        }
    }

    // An expression without what Bun's transpiler does not print: type syntax, and operators of which it prints one operand.
    pub(in crate::lower) fn skip_unprinted_syntax(&self, expression: ExprId) -> ExprId {
        let mut printed = self.skip_type_syntax(expression);
        while let Some(operand) = self.find_operand_printed_alone(printed) {
            printed = self.skip_type_syntax(operand);
        }
        printed
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

    pub(in crate::lower) fn is_literal_operand(&self, expression: ExprId) -> bool {
        self.find_literal_value(expression).is_some()
    }

    pub(in crate::lower) fn is_string_literal_operand(&self, expression: ExprId) -> bool {
        matches!(
            self.find_literal_value(expression),
            Some(Constant::String(_))
        )
    }

    // JSC's parser finds a number or a string where Bun's transpiler has printed the expression. `NaN` is printed as the name.
    pub(in crate::lower) fn is_printed_as_number_or_text(&self, expression: ExprId) -> bool {
        match self.find_literal_value(expression) {
            Some(Constant::String(_)) => true,
            Some(Constant::Number(value)) => !value.is_nan(),
            _ => false,
        }
    }

    // Bun's transpiler prints the name `NaN` for the number, and JSC records the read of a free name.
    pub(in crate::lower) fn find_position_of_printed_nan(&self, expression: ExprId) -> Option<u32> {
        match self.find_literal_value(expression)? {
            Constant::Number(number) if number.is_nan() => Some(self.first_position(expression)),
            _ => None,
        }
    }

    // What Bun's transpiler prints of an expression, with each name in whose place it prints an initializer followed to that initializer.
    // In a row of constants that are each named after the one before, every name is followed once.
    pub(in crate::lower) fn follow_replaced_names(&self, expression: ExprId) -> ExprId {
        let mut printed = self.skip_unprinted_syntax(expression);
        let mut replaced: SmallVec<[ExprId; 4]> = SmallVec::new();
        while let ExprKind::Ident(_) = self.hir[printed].kind {
            let known = self.printed_operators.printed_behind_names.borrow();
            if let Some(&end) = known.get(&printed) {
                printed = end;
                break;
            }
            drop(known);
            let Some(initializer) = self.find_printed_initializer(printed) else {
                break;
            };
            replaced.push(printed);
            printed = self.skip_unprinted_syntax(initializer);
        }
        let mut known = self.printed_operators.printed_behind_names.borrow_mut();
        known.extend(replaced.into_iter().map(|name| (name, printed)));
        printed
    }

    // The literal that Bun's transpiler prints in place of an expression, if it prints one.
    fn find_literal_value(&self, expression: ExprId) -> Option<Constant> {
        let printed = self.follow_replaced_names(expression);
        match self.find_rewrite(printed) {
            Some(Rewrite::Literal { value, .. }) => Some(value),
            _ => find_written_literal(self.hir, self.bound, printed),
        }
    }

    // Bun's transpiler moves a literal on the left of an equality operator to the right.
    pub(in crate::lower) fn printed_operands(&self, operator: ExprId) -> (ExprId, ExprId) {
        let ExprKind::Binary { left, right, .. } = self.hir[operator].kind else {
            unreachable!("printed_operands takes a Binary expression");
        };
        match self.find_rewrite(operator) {
            Some(Rewrite::SwappedOperands) => (right, left),
            _ => (left, right),
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
        let name = match key {
            MemberKey::Name(name) => name,
            MemberKey::Computed(key) => match self.find_literal_value(key) {
                Some(Constant::String(text)) => text,
                _ => return false,
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
        if let ExprKind::Ident(name) = hir[inner].kind
            && !self.is_name_printed_otherwise(inner)
        {
            return Some(self.intern_binding_name(self.bound.binding(inner), name));
        }
        let mut path = Vec::new();
        if self.append_written_path(inner, &mut path) {
            return Some(self.intern_bytes(&path));
        }
        if self.is_literal_operand(inner) || matches!(hir[inner].kind, ExprKind::Ident(_)) {
            return None;
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
            _ => return self.append_written_path(printed, text),
        };
        text.extend_from_slice(literal);
        true
    }

    /// `a.b.c`, `this.#x`, `a?.b[key]`: a callee that consists of names, as plain Bun quotes it in "a.b.c is not a function".
    /// Answers false, with `path` in any state, for anything else and for what is too long to be worth its bytes in the executable.
    fn append_written_path(&self, expression: ExprId, path: &mut Vec<u8>) -> bool {
        const LONGEST_PATH: usize = 80;
        let hir = self.hir;
        let inner = self.skip_type_syntax(expression);
        if self.is_literal_operand(inner) {
            return self.append_printed_literal(inner, path);
        }
        match hir.written_kind(inner) {
            ExprKind::Ident(_) if self.is_name_printed_otherwise(inner) => {
                return match self.find_printed_in_place(inner) {
                    Some(Printed::Initializer(initializer)) => {
                        self.append_written_path(initializer, path)
                    }
                    Some(Printed::Function(_)) | None => false,
                };
            }
            ExprKind::Ident(name) => self.append_identifier(inner, name, path),
            ExprKind::This => path.extend_from_slice(b"this"),
            ExprKind::Super => path.extend_from_slice(b"super"),
            ExprKind::ImportMeta => path.extend_from_slice(b"import.meta"),
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                if self.is_literal_operand(obj) || !self.append_written_path(obj, path) {
                    return false;
                }
                path.extend_from_slice(if chain == Chain::Start { b"?." } else { b"." });
                path.extend_from_slice(written_name(self.queries.atom_bytes(name)));
            }
            ExprKind::Index { obj, index, chain } => {
                if self.is_literal_operand(obj) || !self.append_written_path(obj, path) {
                    return false;
                }
                match (self.find_literal_value(index), hir[index].kind) {
                    (None, ExprKind::Ident(_)) if self.is_name_printed_otherwise(index) => {
                        return false;
                    }
                    (None, ExprKind::Ident(key)) => {
                        if chain == Chain::Start {
                            path.extend_from_slice(b"?.");
                        }
                        path.push(b'[');
                        self.append_identifier(index, key, path);
                        path.push(b']');
                    }
                    // Plain Bun prints `a["b"]` as `a.b` before it runs the file.
                    (Some(Constant::String(key)), _)
                        if is_identifier_name(self.queries.atom_bytes(key)) =>
                    {
                        path.extend_from_slice(if chain == Chain::Start { b"?." } else { b"." });
                        path.extend_from_slice(self.queries.atom_bytes(key));
                    }
                    (Some(Constant::String(key)), _)
                        if needs_no_escape(self.queries.atom_bytes(key)) =>
                    {
                        if chain == Chain::Start {
                            path.extend_from_slice(b"?.");
                        }
                        path.extend_from_slice(b"[\"");
                        path.extend_from_slice(self.queries.atom_bytes(key));
                        path.extend_from_slice(b"\"]");
                    }
                    (Some(Constant::Number(key)), _) => {
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

    // Bun's transpiler prints an initializer in place of the name.
    fn is_name_printed_otherwise(&self, name: ExprId) -> bool {
        self.find_printed_in_place(name).is_some()
    }

    // A number or a text that is called, as Bun's transpiler prints it there. Whatever else it prints in parentheses.
    fn append_printed_literal(&self, literal: ExprId, path: &mut Vec<u8>) -> bool {
        match self.find_literal_value(literal) {
            Some(Constant::Number(number)) if number.is_nan() => path.extend_from_slice(b"NaN"),
            Some(Constant::Number(number)) if number.is_finite() && !number.is_sign_negative() => {
                let is_integer = number.fract() == 0.0 && number < (u64::MAX >> 12) as f64;
                match is_integer
                    .then(|| pow10_exp_1e4_to_1e9(number as u64))
                    .flatten()
                {
                    Some(exponent) => path.extend_from_slice(&[b'1', b'e', b'0' + exponent]),
                    None => path.extend_from_slice(format!("{number}").as_bytes()),
                }
            }
            Some(Constant::String(text)) if needs_no_escape(self.queries.atom_bytes(text)) => {
                path.push(b'"');
                path.extend_from_slice(self.queries.atom_bytes(text));
                path.push(b'"');
            }
            Some(Constant::Null) => path.extend_from_slice(b"null"),
            _ => return false,
        }
        true
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
