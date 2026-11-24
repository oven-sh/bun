//! Objects, arrays and patterns.

use super::*;
use crate::js::utils::array::is_line_after_element_empty;

impl Emitter<'_, '_> {
    /// `join_nodes_with_soft_line().entries_with_trailing_separator(.., ",", ..)`
    pub(super) fn comma_separated_nodes(
        &mut self,
        owner: Id,
        trailing_comma: Option<FormatTrailingCommas>,
        item: impl Fn(&mut Self, Id),
    ) {
        self.items(
            owner,
            self.node(owner).start,
            |e, _, next, comment| match e.has_empty_line_before(next, comment) {
                true => e.line_of(LineMode::Empty),
                false => e.line(),
            },
            item,
            |e, _, is_last| match (is_last, trailing_comma) {
                (false, _) => e.token(","),
                (true, Some(kind)) => e.trailing_comma(kind),
                (true, None) => {}
            },
        );
    }

    /// The same, without empty lines.
    pub(super) fn comma_separated(
        &mut self,
        owner: Id,
        trailing_comma: Option<FormatTrailingCommas>,
        item: impl Fn(&mut Self, Id),
    ) {
        self.items(
            owner,
            self.node(owner).start,
            |e, _, _, _| e.line(),
            item,
            |e, _, is_last| match (is_last, trailing_comma) {
                (false, _) => e.token(","),
                (true, Some(kind)) => e.trailing_comma(kind),
                (true, None) => {}
            },
        );
    }

    pub(super) fn has_empty_line_before(&self, id: Id, first_comment: Option<Span>) -> bool {
        !self.is_flat()
            && (self.source_text()).get_lines_before(self.span(id), first_comment, !self.is_oxfmt)
                > 1
    }

    /// An object literal or a type literal.
    pub(super) fn object_like(&mut self, id: Id) {
        let node = self.node(id);
        self.token("{");
        match self.tree.list_of(node).first() {
            None if node.has(flag::COMMENT)
                && node.kind == K::TypeLiteral
                && self.should_hug_type_literal(id) =>
            {
                self.give_up();
            }
            None => self.dangling_comments(id),
            Some(&first) => {
                let inner = |e: &mut Self| {
                    e.soft_block_indent_with_space(e.has_bracket_spacing(), |e| match node.kind {
                        K::Object => {
                            let comma = Some(FormatTrailingCommas::ES5);
                            e.comma_separated_nodes(id, comma, Self::property);
                        }
                        _ => e.signatures(id),
                    });
                };
                if node.kind == K::TypeLiteral && self.should_hug_type_literal(id) {
                    inner(self);
                } else {
                    let mode = if !self.preserves_expanded_objects() {
                        GroupMode::Flat
                    } else if node.has(flag::MULTILINE)
                        && self.has_newline(node.start, self.node(first).start)
                    {
                        GroupMode::Expand
                    } else {
                        GroupMode::StaysExpanded
                    };
                    self.start_group_of(mode, None);
                    inner(self);
                    self.end_group();
                }
            }
        }
        self.token("}");
    }

    pub(super) fn should_hug_type_literal(&self, id: Id) -> bool {
        let param = self.node(self.node(id).parent);
        if param.kind != K::Param || param.c != NONE || param.has(flag::REST) {
            return false;
        }
        let params = self.node(param.parent);
        params.kind == K::Params
            && (self.kind(param.a) != K::This || self.is_function_node(params.parent))
            && self.should_hug_function_parameters(params.parent, false)
    }

    fn property(&mut self, id: Id) {
        let node = self.node(id);
        match (node.kind, node.op) {
            (K::Spread, _) => {
                self.token("...");
                self.expr(node.a);
            }
            (_, T::Ident) => {
                self.source_of(node.a);
                if node.b != NONE {
                    self.space();
                    self.keyword("=");
                    self.expr(node.b);
                }
            }
            (_, T::Colon) => self.shortcut(id, |e| e.assignment_like(id)),
            _ => {
                self.method_prefix(node);
                self.key(id);
                self.grouped_parameters_with_return_type_for_method(node.b);
                self.function_body(node.b);
            }
        }
    }

    pub(super) fn method_prefix(&mut self, node: &Node) {
        let function = self.node(node.b);
        self.keyword_if(node.op == T::Get, "get");
        self.keyword_if(node.op == T::Set, "set");
        self.token_if(function.has(flag::ASYNC), "async ");
        self.token_if(function.has(flag::STAR), "*");
    }

    // ───────────────────────────── patterns ─────────────────────────────

    #[inline]
    pub(super) fn pattern(&mut self, id: Id) {
        match self.kind(id) {
            K::Ident | K::This => self.source_of(id),
            _ => self.shortcut(id, |e| e.pattern_without_shortcut(id)),
        }
    }

    pub(super) fn pattern_without_shortcut(&mut self, id: Id) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        let node = self.node(id);
        match node.kind {
            K::ObjectPattern => self.object_pattern(id),
            K::ArrayPattern => self.array_pattern(id),
            K::AssignPattern => {
                self.group(|e| e.pattern(node.a));
                self.space();
                self.keyword("=");
                self.expr(node.b);
            }
            K::Rest => {
                self.token("...");
                self.pattern(node.a);
            }
            _ => self.source(node.start, node.end),
        }
    }

    fn binding_property(&mut self, id: Id) {
        let node = self.node(id);
        match (node.kind, node.op) {
            (K::PatternProp, T::Ident) => self.pattern(node.b),
            (K::PatternProp, _) => self.shortcut(id, |e| e.assignment_like(id)),
            (K::Rest, _) => self.pattern(id),
            _ => self.property(id),
        }
    }

    /// An `ObjectPattern`, or an `Object` that's assigned to.
    pub(super) fn object_pattern(&mut self, id: Id) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        let node = self.node(id);
        let properties = self.tree.list_of(node);
        self.token("{");
        let Some(&last) = properties.last() else {
            return self.token("}");
        };
        let parent = self.node(node.parent);
        let function = match (parent.kind, self.kind(parent.parent)) {
            (K::Param, K::Params) if !parent.has(flag::REST) => self.node(parent.parent).parent,
            _ => NONE,
        };
        let is_exempt = match parent.kind {
            K::AssignPattern => true,
            K::Param if parent.has(flag::REST) => false,
            K::Param => function == NONE || parent.c != NONE || self.node(function).d != NONE,
            _ => false,
        };
        let has_pattern_value = |&it: &Id| {
            let (property, value) = (self.node(it), self.node(self.node(it).b));
            property.op == T::Colon
                && match value.kind {
                    K::ObjectPattern | K::ArrayPattern => true,
                    K::Object | K::Array => value.has(flag::TARGET),
                    _ => false,
                }
        };
        let should_break = !is_exempt && properties.iter().any(has_pattern_value);
        let is_inline = match should_break {
            true => function != NONE && self.should_hug_function_parameters(function, false),
            false => {
                function != NONE
                    || parent.kind == K::Declarator
                    || (parent.kind == K::Assign && !parent.has(flag::TARGET))
            }
        };
        let comma =
            (!matches!(self.kind(last), K::Rest | K::Spread)).then_some(FormatTrailingCommas::ES5);
        let inner = |e: &mut Self| {
            e.soft_block_indent_with_space(e.has_bracket_spacing(), |e| {
                e.comma_separated_nodes(id, comma, Self::binding_property);
            });
        };
        match is_inline {
            true => inner(self),
            false => self.group_with(should_break, None, inner),
        }
        self.token("}");
    }

    /// An `ArrayPattern`, or an `Array` that's assigned to.
    pub(super) fn array_pattern(&mut self, id: Id) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        self.token("[");
        if self.node(id).len > 0 {
            self.group(|e| e.soft_block_indent(|e| e.array_elements(id)));
        }
        self.token("]");
    }

    pub(super) fn array(&mut self, id: Id) {
        let elements = self.list(id);
        self.token("[");
        if elements.is_empty() {
            self.dangling_comments(id);
            return self.token("]");
        }
        let should_break = self.tree.should_break_array(elements);
        if self.is_flat() {
            self.group_with(should_break, None, |e| {
                e.soft_block_indent(|e| e.array_elements(id));
            });
            return self.token("]");
        }
        let group_id = self.group_id();
        self.group_with(should_break, Some(group_id), |e| {
            e.soft_block_indent(|e| match !e.is_flat() && e.can_concisely_print_array(id) {
                true if e.flat.is_on => e.not_flat(),
                true => e.filled_array_elements(id, group_id),
                false => e.array_elements(id),
            });
        });
        self.token("]");
    }

    pub(super) fn can_concisely_print_array(&mut self, id: Id) -> bool {
        let is_number = |&it: &Id| {
            let node = self.node(it);
            match node.kind {
                K::Unary => matches!(node.op, T::Plus | T::Minus) && self.kind(node.a) == K::Num,
                kind => kind == K::Num,
            }
        };
        let elements = self.list(id);
        let are_numbers = !elements.is_empty() && elements.iter().all(is_number);
        if are_numbers && self.node(id).has(flag::COMMENT) {
            self.give_up();
        }
        are_numbers
    }

    fn filled_array_elements(&mut self, id: Id, group_id: GroupId) {
        let elements = self.list(id);
        let has_trailing_comma = !self.f.options().trailing_commas.is_none();
        self.start_fill();
        let mut previous_end = 0;
        for (i, &element) in elements.iter().enumerate() {
            if i > 0 {
                self.entry(
                    |e| match is_line_after_element_empty(e.src, previous_end as usize) {
                        true => e.line_of(LineMode::Empty),
                        false => e.line(),
                    },
                );
            }
            self.entry(|e| {
                e.exactly(|e| e.expr(element));
                if i + 1 < elements.len() {
                    e.token(",");
                } else if has_trailing_comma {
                    e.if_breaks(Some(group_id), |e| e.token(","));
                }
            });
            previous_end = self.node(element).end;
        }
        self.end_fill();
    }

    /// `write_array_node`, and the rest element after it.
    fn array_elements(&mut self, id: Id) {
        let node = self.node(id);
        let is_pattern = node.kind == K::ArrayPattern;
        let is_target = node.has(flag::TARGET);
        let first_hole = (self.tree.list_of(node).iter()).find(|&&it| self.kind(it) == K::Hole);
        if first_hole.is_some() && node.has(flag::MULTILINE | flag::COMMENT) {
            return self.give_up();
        }
        self.items(
            id,
            node.start,
            |e, previous, _, _| {
                let end = e.node(previous).end as usize;
                match !e.is_flat() && is_line_after_element_empty(e.src, end) {
                    true if e.is_oxfmt => e.line_of(LineMode::Empty),
                    true => e.line_of(LineMode::SoftOrSpaceEmpty),
                    false => e.line(),
                }
            },
            |e, element| match e.kind(element) {
                K::Hole => {}
                _ if is_pattern => e.pattern(element),
                _ => e.expr(element),
            },
            |e, element, is_last| match e.kind(element) {
                K::Hole => e.token(","),
                K::Rest => {}
                K::Spread if is_target => {}
                _ if is_last => e.trailing_comma(FormatTrailingCommas::ES5),
                _ => e.token(","),
            },
        );
    }
}
