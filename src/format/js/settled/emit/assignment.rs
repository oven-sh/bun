use super::function::{ArrowOptions, ExprOptions};
use super::*;
use crate::js::utils::string::{is_name_without_quotes, is_simple_number};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Layout {
    Fluid,
    BreakAfterOperator,
    NeverBreakAfterOperator,
    Chain,
    ChainTail,
    BreakLeftHandSide,
    ChainTailArrowFunction,
}

impl Layout {
    fn has_group_around_it(self, is_left_text: bool) -> bool {
        match self {
            Layout::Chain | Layout::ChainTail | Layout::ChainTailArrowFunction => false,
            Layout::BreakAfterOperator => !is_left_text,
            _ => true,
        }
    }
}

fn is_text_on_one_line(element: &FormatElement) -> bool {
    match element {
        FormatElement::Token(_) | FormatElement::Space => true,
        FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
            !text.width.is_multiline()
        }
        _ => false,
    }
}

fn operator(node: &Node) -> &'static str {
    match (node.kind, node.op) {
        (K::Prop | K::PatternProp, _) => ":",
        (_, T::PlusEq) => " +=",
        (_, T::MinusEq) => " -=",
        (_, T::StarEq) => " *=",
        (_, T::StarStarEq) => " **=",
        (_, T::SlashEq) => " /=",
        (_, T::PercentEq) => " %=",
        (_, T::ShlEq) => " <<=",
        (_, T::ShrEq) => " >>=",
        (_, T::UShrEq) => " >>>=",
        (_, T::AmpEq) => " &=",
        (_, T::BarEq) => " |=",
        (_, T::CaretEq) => " ^=",
        (_, T::AmpAmpEq) => " &&=",
        (_, T::BarBarEq) => " ||=",
        (_, T::QuestionQuestionEq) => " ??=",
        _ => " =",
    }
}

impl<'t> Emitter<'_, 't> {
    /// The key of `owner`, a property or member, with its brackets.
    pub(super) fn key(&mut self, owner: Id) {
        let node = self.node(owner);
        if node.has(flag::COMPUTED) {
            self.token("[");
            self.expr(node.a);
            return self.token("]");
        }
        let key = self.node(node.a);
        match key.kind {
            K::Str => self.string_key(node),
            K::Num => self.number(node.a),
            _ => self.source(key.start, key.end),
        }
    }

    /// True if all the keys next to that of `owner` are strings, and one of them needs its quotes.
    fn are_keys_consistently_quoted(&self, owner: &Node) -> bool {
        let keys = || {
            (self.list(owner.parent).iter().map(|&it| self.node(it)))
                .filter(|it| match it.kind {
                    K::Prop | K::PatternProp => it.op != T::Ident,
                    kind => matches!(
                        kind,
                        K::PropertySignature | K::MethodSignature | K::EnumMember
                    ),
                })
                .filter(|it| !it.has(flag::COMPUTED))
        };
        let needs_quotes = |it: &Node| {
            let text = self.text_of(it.a);
            strings::index_of_any(text, b"-/ :@").is_some() && !strings::contains_char(text, b'\\')
        };
        match keys().next() {
            Some(first) if first.a == owner.a => {
                keys().all(|it| self.kind(it.a) == K::Str) && keys().any(needs_quotes)
            }
            first => first.is_some_and(|it| self.kind(it.a) == K::Str),
        }
    }

    fn string_key(&mut self, owner: &Node) {
        if self.f.options().quote_properties.is_consistent()
            && !self.are_keys_consistently_quoted(owner)
        {
            return self.give_up();
        }
        if self.f.options().quote_properties == QuoteProperties::AsNeeded {
            let text = self.text_of(owner.a);
            let content = text
                .get(1..text.len().saturating_sub(1))
                .unwrap_or_default();
            let keeps_quotes = match owner.kind {
                K::MethodSignature if content == b"new" => true,
                K::Field if !self.is_javascript && !owner.has(flag::ABSTRACT) => true,
                _ => {
                    !is_name_without_quotes(content, self.f.options().flavor)
                        && !(self.is_javascript && is_simple_number(content))
                }
            };
            if !keeps_quotes {
                return self.give_up();
            }
        }
        self.string(owner.a);
    }

    fn is_short_key(&mut self, owner: &Node) -> bool {
        let limit = self.f.options().indent_width.value() as usize + 3;
        let text = self.text_of(owner.a);
        if !owner.has(flag::COMPUTED) {
            return text.len() < limit || (crate::ir::width::string_width(text) as usize) < limit;
        }
        if self.source_text().span_width(self.span(owner.a)) + 2 >= limit {
            return false;
        }
        match self.kind(owner.a) {
            K::Ident | K::Num | K::Str => true,
            _ if self.is_oxfmt => true,
            K::Dot | K::Index | K::Call | K::Template | K::Binary => false,
            _ => {
                self.give_up();
                false
            }
        }
    }

    pub(super) fn member_modifiers(&mut self, node: &Node) {
        if node.flags & !flag::ODD < flag::DECLARE {
            return;
        }
        for (modifier, keyword) in [
            (flag::DECLARE, "declare "),
            (flag::PUBLIC, "public "),
            (flag::PROTECTED, "protected "),
            (flag::PRIVATE, "private "),
            (flag::STATIC, "static "),
            (flag::ABSTRACT, "abstract "),
            (flag::OVERRIDE, "override "),
            (flag::READONLY, "readonly "),
        ] {
            self.token_if(node.has(modifier), keyword);
        }
    }

    fn left_side(&mut self, id: Id) {
        let node = self.node(id);
        match node.kind {
            K::Declarator => {
                self.pattern_without_shortcut(node.a);
                self.token_if(node.has(flag::DEFINITE), "!");
                self.type_annotation(node.b);
            }
            K::Assign => self.expr(node.a),
            K::Field => {
                self.member_decorators(node);
                self.member_modifiers(node);
                self.key(id);
                self.token_if(node.has(flag::OPTIONAL), "?");
                self.token_if(node.has(flag::DEFINITE), "!");
                self.type_annotation(node.b);
            }
            _ => self.key(id),
        }
    }

    /// A `Declarator`, `Assign` or `Field`, or a `Prop` or `PatternProp` with a colon.
    pub(super) fn assignment_like(&mut self, id: Id) {
        let node = self.node(id);
        let right = match node.kind {
            K::Declarator | K::Field => node.c,
            _ => node.b,
        };
        if right == NONE {
            return self.left_side(id);
        }
        if self.is_flat() {
            let is_in_chain = node.kind == K::Assign
                && matches!(self.kind(node.parent), K::Declarator | K::Assign);
            return self.group_if(!is_in_chain, |e| {
                e.left_side(id);
                e.token(operator(node));
                e.line();
                e.right_side_of_assignment(node, right, Layout::Fluid);
            });
        }
        let is_key = matches!(node.kind, K::Prop | K::PatternProp);
        let is_name = self.kind(node.a) == K::Ident
            && match node.kind {
                K::Declarator => node.b == NONE,
                K::Field => false,
                _ => !node.has(flag::COMPUTED),
            };
        let is_left_short = is_key && self.is_short_key(node);
        if is_name {
            let layout = self.assignment_layout(id, right, is_left_short, false);
            return self.group_if(layout.has_group_around_it(true), |e| {
                e.source_of(node.a);
                e.token(operator(node));
                e.after_operator(node, right, layout);
            });
        }
        if self.flat.is_on {
            let left_may_break = self.left_side_may_break(id);
            let layout = self.assignment_layout(id, right, is_left_short, left_may_break);
            return self.group_if(layout.has_group_around_it(false), |e| {
                e.group_if(layout != Layout::BreakLeftHandSide, |e| e.left_side(id));
                e.token(operator(node));
                e.after_operator(node, right, layout);
            });
        }
        let outer_group = self.f.reserve_tag();
        let left_group = self.f.reserve_tag();
        self.exactly(|e| e.left_side(id));
        let left = self.f.elements().get(left_group + 1..).unwrap_or_default();
        let is_left_text = left.len() <= 12 && left.iter().all(is_text_on_one_line);
        let flavor = self.f.options().flavor;
        let left_may_break = !is_left_text
            && self
                .f
                .elements_from(left_group + 1)
                .may_directly_break(flavor);
        let layout = self.assignment_layout(id, right, is_left_short, left_may_break);
        let groups_left = layout != Layout::BreakLeftHandSide
            && !(is_left_text && layout.has_group_around_it(false));
        if groups_left {
            self.group_from(left_group, false);
        }
        self.token(operator(node));
        self.after_operator(node, right, layout);
        if layout.has_group_around_it(is_left_text) {
            self.group_from(outer_group, false);
        }
    }

    /// `may_directly_break`, during a comparison
    fn left_side_may_break(&mut self, id: Id) -> bool {
        let node = self.node(id);
        let target = self.node(node.a);
        let is_pattern = matches!(
            target.kind,
            K::ObjectPattern | K::ArrayPattern | K::Object | K::Array
        );
        if (is_pattern && target.len > 0 && !node.has(flag::COMPUTED))
            || (node.kind == K::Field && node.d != NONE)
        {
            return true;
        }
        let ty = if matches!(node.kind, K::Declarator | K::Field) {
            node.b
        } else {
            NONE
        };
        match self.node(ty) {
            it if it.has(flag::MULTILINE) => {
                self.flat.matches &= !strings::contains_char(self.text_of(ty), b'`');
                return true;
            }
            it if matches!(it.kind, K::None | K::TypeKeyword)
                && matches!(target.kind, K::Ident | K::Str | K::Num | K::PrivateName) =>
            {
                return false;
            }
            _ => {}
        }
        if strings::index_of_any(self.text_of(node.a), b"(\n").is_some() {
            self.not_flat();
            return false;
        }
        self.has_line(|e| e.left_side(id))
    }

    fn comments_before_right_side(&self, node: &Node, right: Id) -> &'t [Comment] {
        match node.kind == K::PatternProp || self.kind(right) == K::Jsx {
            true => &[],
            false => self.comments_leading(node, right),
        }
    }

    fn right_side_of_assignment(&mut self, node: &Node, right: Id, layout: Layout) {
        let comments = self.comments_before_right_side(node, right);
        if !comments.is_empty() {
            let value = self.node(right);
            if value.kind == K::Assign || (value.kind == K::Arrow && self.kind(value.d) == K::Arrow)
            {
                return self.give_up();
            }
            self.leading_comments_of(right, comments);
        }
        match (node.kind, self.kind(right)) {
            (K::PatternProp, _) => self.pattern(right),
            (_, K::Arrow) => {
                let options = ExprOptions::Arrow(ArrowOptions {
                    assignment_layout: Some(layout),
                    ..Default::default()
                });
                match layout {
                    Layout::ChainTailArrowFunction => self.give_up(),
                    _ => self.shortcut(right, |e| e.expr_with(right, options)),
                }
            }
            (_, K::Assign) => self.expr_without_shortcut(right),
            _ => self.expr(right),
        }
    }

    fn after_operator(&mut self, node: &Node, right: Id, layout: Layout) {
        let write = |e: &mut Self| e.right_side_of_assignment(node, right, layout);
        match layout {
            Layout::Fluid => {
                let group_id = self.group_id();
                self.indented_line_group(group_id);
                self.boundary();
                self.indent_if_group_breaks(group_id, write);
            }
            Layout::BreakAfterOperator => self.group(|e| e.soft_line_indent_or_space(write)),
            Layout::NeverBreakAfterOperator => {
                self.space();
                write(self);
            }
            Layout::ChainTailArrowFunction => write(self),
            Layout::BreakLeftHandSide => {
                self.space();
                self.group(write);
            }
            Layout::Chain => {
                self.line();
                write(self);
            }
            Layout::ChainTail => self.soft_line_indent_or_space(write),
        }
    }

    fn assignment_layout(
        &mut self,
        id: Id,
        right: Id,
        is_left_short: bool,
        left_may_break: bool,
    ) -> Layout {
        let (node, value) = (self.node(id), self.node(right));
        let is_expression = node.kind != K::PatternProp;
        let is_default = value.kind == K::Assign && value.has(flag::TARGET);
        if is_expression {
            if let Some(layout) = self.chain_layout(id, value) {
                return layout;
            }
            if value.kind == K::Assign && !is_default && self.kind(value.b) == K::Assign {
                return Layout::BreakAfterOperator;
            }
            let comments = self.comments_before_right_side(node, right);
            if self.has_line_break_after(comments) || self.has_indentable_block(comments) {
                return Layout::BreakAfterOperator;
            }
            if value.kind == K::Call
                && self.node(value.a).op == T::Require
                && self.kind(value.a) == K::Ident
                && !self.is_chain_root(right)
            {
                return Layout::NeverBreakAfterOperator;
            }
        }
        if self.is_complex_destructuring(node)
            || (node.kind == K::Declarator
                && (self.is_complex_type_annotation(node.b)
                    || (left_may_break && value.kind == K::Arrow)))
        {
            return Layout::BreakLeftHandSide;
        }
        if is_expression && self.should_break_after_operator(right, is_left_short) {
            return Layout::BreakAfterOperator;
        }
        let stays_on_line = is_expression
            && matches!(
                value.kind,
                K::Class | K::Template | K::Tagged | K::Bool | K::Num
            );
        match !left_may_break && (is_left_short || stays_on_line) {
            true => Layout::NeverBreakAfterOperator,
            false => Layout::Fluid,
        }
    }

    fn chain_layout(&self, id: Id, right: &Node) -> Option<Layout> {
        let node = self.node(id);
        if node.kind != K::Assign {
            return None;
        }
        let (parent, right_is_tail) = (self.node(node.parent), right.kind != K::Assign);
        let is_eligible = match parent.kind {
            K::Declarator => !right_is_tail,
            K::Assign if parent.has(flag::TARGET) => false,
            K::Assign => !right_is_tail || self.kind(parent.parent) != K::ExprStmt,
            _ => false,
        };
        is_eligible.then(|| match right.kind {
            K::Assign => Layout::Chain,
            K::Arrow if self.kind(right.d) == K::Arrow => Layout::ChainTailArrowFunction,
            _ => Layout::ChainTail,
        })
    }

    fn is_complex_destructuring(&self, node: &Node) -> bool {
        let left = self.node(node.a);
        let has_value = |&it: &Id| {
            let property = self.node(it);
            match property.kind {
                K::PatternProp => {
                    property.op != T::Ident || self.kind(property.b) == K::AssignPattern
                }
                K::Prop => property.op != T::Ident || property.b != NONE,
                _ => false,
            }
        };
        matches!(
            (node.kind, left.kind),
            (K::Declarator, K::ObjectPattern) | (K::Assign, K::Object)
        ) && left.len > 2
            && self.tree.list_of(left).iter().any(has_value)
    }

    pub(super) fn is_complex_type_annotation(&self, ty: Id) -> bool {
        let node = self.node(ty);
        let args = self.list(node.b);
        node.kind == K::TypeRef
            && args.len() > 1
            && args.iter().any(|&it| match self.kind(it) {
                K::Conditional => true,
                K::TypeRef => self.node(it).b != NONE,
                _ => false,
            })
    }

    fn should_break_after_operator(&mut self, right: Id, is_left_short: bool) -> bool {
        let breaks_as_binary = |id: Id| match self.kind(id) {
            K::Logical => !self.should_inline_logical_expression(id),
            kind => kind == K::Binary,
        };
        match self.kind(right) {
            K::Binary | K::Logical => breaks_as_binary(right),
            K::Seq => true,
            K::Cond => breaks_as_binary(self.node(right).a),
            K::Class => false,
            _ if is_left_short => false,
            _ => {
                let mut inner = right;
                loop {
                    let node = self.node(inner);
                    match node.kind {
                        K::Unary | K::Await => inner = node.a,
                        K::Yield if node.a != NONE => inner = node.a,
                        K::NonNull if !self.is_chain_root(inner) => inner = node.a,
                        _ => break,
                    }
                }
                self.kind(inner) == K::Str || self.is_poorly_breakable_member_or_call_chain(inner)
            }
        }
    }

    fn is_poorly_breakable_member_or_call_chain(&mut self, id: Id) -> bool {
        let threshold = self.f.options().line_width.value() as usize / 4;
        let mut calls = SmallVec::<[Id; 4]>::new();
        let (mut current, mut is_chain) = (id, false);
        loop {
            let node = self.node(current);
            match node.kind {
                K::NonNull => {}
                K::Call => {
                    match *self.args(current) {
                        [] => {}
                        [only]
                            if self.is_short_argument(only, threshold)
                                && !self.has_comments_around_items(node.c) => {}
                        _ => return false,
                    }
                    is_chain = true;
                    calls.push(current);
                }
                K::Dot | K::Index => is_chain = true,
                K::Ident | K::This => break,
                _ => return false,
            }
            current = node.a;
        }
        let Some(&first_call) = calls.first() else {
            return is_chain;
        };
        if self.is_oxfmt && self.node(first_call).has(flag::COMMENT) {
            return false;
        }
        if calls
            .iter()
            .any(|&call| self.is_complex_type_arguments(self.node(call).b))
        {
            return false;
        }
        let checked = if self.is_oxfmt { 1 } else { calls.len() };
        !calls.iter().take(checked).any(|&call| {
            let callee = self.node(call).a;
            !self.is_chain_root(callee)
                && match self.kind(callee) {
                    K::Dot | K::Index => true,
                    K::Call => self.is_oxfmt,
                    _ => false,
                }
                && self.is_member_call_chain(call)
        })
    }

    pub(super) fn is_short_argument(&self, mut id: Id, threshold: usize) -> bool {
        while self.kind(id) == K::Unary {
            id = self.node(id).a;
        }
        let len = |text: &[u8]| match self.is_oxfmt {
            true => text.len(),
            false => strings::wtf8_len_utf16(text) as usize,
        };
        let (node, text) = (self.node(id), self.text_of(id));
        match node.kind {
            K::Ident => text.len() <= threshold,
            K::Regex => {
                let end = strings::last_index_of_char(text, b'/').unwrap_or(0);
                len(text.get(1..end).unwrap_or_default()) <= threshold
            }
            K::Str if self.is_oxfmt => crate::ir::width::string_width(text) as usize <= threshold,
            K::Str => len(text) <= threshold,
            K::Template => {
                node.len == 1 && len(text) <= threshold + 2 && !node.has(flag::MULTILINE)
            }
            K::Call => {
                self.args(id).is_empty()
                    && self.kind(node.a) == K::Ident
                    && self.text_of(node.a).len() <= threshold.saturating_sub(2)
                    && !self.is_chain_root(id)
            }
            K::This | K::Null | K::BigInt | K::Bool | K::Num => true,
            _ => false,
        }
    }

    fn is_complex_type_arguments(&mut self, type_args: Id) -> bool {
        match *self.list(type_args) {
            [] => false,
            [only] => {
                matches!(self.kind(only), K::Union | K::Intersection | K::TypeLiteral)
                    || match self.flat.is_on {
                        true => {
                            self.flat.matches &= !self.node(type_args).has(flag::MULTILINE);
                            false
                        }
                        false => (self.intern(|e| e.type_arguments(type_args)))
                            .is_some_and(|it| it.will_break(self.f)),
                    }
            }
            _ => true,
        }
    }
}
