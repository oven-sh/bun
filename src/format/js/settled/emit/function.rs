//! Functions, arrow functions, parameters and type parameters.

use super::assignment::Layout;
use super::*;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Grouped {
    First,
    Last,
}

#[derive(Copy, Clone, Default)]
pub(super) struct ArrowOptions {
    pub(super) assignment_layout: Option<Layout>,
    pub(super) grouped: Option<Grouped>,
    pub(super) caches: bool,
}

#[derive(Copy, Clone, Default)]
pub(super) struct FunctionOptions {
    pub(super) caches: bool,
    /// During a comparison: it's a grouped argument, and its parameters can't break.
    pub(super) is_grouped: bool,
}

#[derive(Copy, Clone)]
pub(super) enum ExprOptions {
    None,
    Arrow(ArrowOptions),
    Function(FunctionOptions),
}

impl ExprOptions {
    pub(super) fn of_arrow(self) -> ArrowOptions {
        match self {
            ExprOptions::Arrow(options) => options,
            _ => ArrowOptions::default(),
        }
    }

    pub(super) fn of_function(self) -> FunctionOptions {
        match self {
            ExprOptions::Function(options) => options,
            _ => FunctionOptions::default(),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(in super::super) enum Part {
    Head,
    Parameters,
    EmptyParameters,
    ReturnType,
    Body,
}

impl Emitter<'_, '_> {
    fn cached(&mut self, caches: bool, key: (Id, Part), write: impl FnOnce(&mut Self)) {
        if !caches {
            return write(self);
        }
        let mut element = self.cache.get(&key).copied();
        if element.is_none() {
            element = self.intern(write);
            self.cache.extend(element.map(|it| (key, it)));
        }
        self.element(element);
    }

    pub(super) fn signature_without_lines(&mut self, content: Interned) {
        let content = format_with(|f| f.write_element(FormatElement::Interned(content)));
        crate::js::print::arrow_function_expression::write_signature_without_lines(
            &content, self.f,
        );
    }

    /// `AstNodes::Function`
    pub(super) fn is_function_node(&self, id: Id) -> bool {
        let node = self.node(id);
        node.kind == K::Fn
            && !matches!(
                self.kind(node.parent),
                K::MethodSignature | K::CallSignature
            )
    }

    pub(super) fn function_body(&mut self, function: Id) {
        self.space();
        self.token("{");
        self.block_content(self.node(function).d);
        self.token("}");
    }

    pub(super) fn function(&mut self, id: Id, options: FunctionOptions) {
        let (node, caches) = (self.node(id), options.caches);
        self.cached(caches, (id, Part::Head), |e| {
            e.token_if(node.has(flag::DECLARE), "declare ");
            e.token_if(node.has(flag::ASYNC), "async ");
            e.token("function");
            e.token_if(node.has(flag::STAR), "*");
            e.space();
            if node.a != NONE {
                e.source_of(node.a);
            }
            e.group_if(e.is_oxfmt, |e| e.type_parameters(node.b, None));
        });
        match caches {
            _ if options.is_grouped => self.group(|e| {
                e.signature_on_one_line(node, |e| e.parameters_and_return_type(id, false));
            }),
            true => self.group(|e| e.exactly(|e| e.parameters_and_return_type(id, true))),
            false => self.grouped_parameters_and_return_type(id),
        }
        match node.d {
            NONE => self.semicolon(),
            _ => self.cached(caches, (id, Part::Body), |e| e.function_body(id)),
        }
    }

    /// During a comparison, for a signature whose soft line breaks are removed.
    fn signature_on_one_line(&mut self, function: &Node, write: impl FnOnce(&mut Self)) {
        self.flat.matches &= self.stays_on_one_line(function);
        self.unbreakable(write);
    }

    /// After `removeLines` the printer still chooses how to lay out a call.
    fn stays_on_one_line(&self, function: &Node) -> bool {
        let params = self.text_of(function.params());
        (self.is_oxfmt && function.kind == K::Arrow)
            || !self.is_on_long_line(self.flat.cursor)
            || (function.c == NONE
                && !strings::contains_char(params.get(1..).unwrap_or_default(), b'('))
    }

    pub(super) fn grouped_parameters_and_return_type(&mut self, id: Id) {
        let node = self.node(id);
        let last = if node.c == NONE {
            node.params()
        } else {
            node.c
        };
        self.group(|e| {
            e.shortcut_in_group(node.params(), last, |e| {
                e.parameters_and_return_type(id, false)
            });
        });
    }

    fn can_group_function_parameters(&self, node: &Node) -> bool {
        node.c != NONE
            && self.node(node.params()).len == 1
            && match *self.list(node.b) {
                [] => true,
                [only] => self.node(only).b == NONE && self.node(only).c == NONE,
                _ => false,
            }
    }

    fn parameters_and_return_type(&mut self, id: Id, caches: bool) {
        let node = self.node(id);
        let parameters =
            |e: &mut Self| e.cached(caches, (id, Part::Parameters), |e| e.formal_parameters(id));
        let return_type = |e: &mut Self| {
            e.cached(caches, (id, Part::ReturnType), |e| {
                e.type_annotation(node.c)
            })
        };
        if self.is_flat() || !self.can_group_function_parameters(node) {
            parameters(self);
            return return_type(self);
        }
        if self.flat.is_on {
            let groups = self.groups_parameters(node.c);
            self.group_if(groups, parameters);
            let before = self.follow.forced_breaks;
            return_type(self);
            self.flat.matches &= groups || before == self.follow.forced_breaks;
            return;
        }
        let (parameters, return_type) = (self.capture(parameters), self.capture(return_type));
        self.captured_parameters_and_return_type(node.c, parameters, return_type);
    }

    /// Of a function type, or of a member of an interface or a type literal.
    pub(super) fn signature(&mut self, id: Id) {
        let node = self.node(id);
        let parameters = |e: &mut Self| {
            e.type_parameters(node.b, None);
            e.formal_parameters(id);
        };
        let return_type = |e: &mut Self| match (node.kind, e.kind(node.parent)) {
            (K::FnType, _) => {
                e.space();
                e.keyword("=>");
                e.ty(node.c);
            }
            (_, K::MethodSignature) => e.group(|e| e.type_annotation(node.c)),
            _ => e.type_annotation(node.c),
        };
        if self.is_flat() || !self.can_group_function_parameters(node) {
            parameters(self);
            return return_type(self);
        }
        if self.flat.is_on {
            let groups = self.groups_parameters(node.c);
            self.group_if(groups, parameters);
            let before = self.follow.forced_breaks;
            return_type(self);
            self.flat.matches &= groups || before == self.follow.forced_breaks;
            return;
        }
        let (parameters, return_type) = (self.capture(parameters), self.capture(return_type));
        self.captured_parameters_and_return_type(node.c, parameters, return_type);
    }

    /// During a comparison, for a function whose parameters can be grouped.
    fn groups_parameters(&mut self, return_type: Id) -> bool {
        let is_object = matches!(self.kind(return_type), K::TypeLiteral | K::Mapped);
        self.flat.matches &=
            is_object || strings::index_of_any(self.text_of(return_type), b"{`/").is_none();
        is_object
    }

    /// The end of `write_parameters_and_return_type`, for a function whose parameters can be grouped.
    fn captured_parameters_and_return_type(
        &mut self,
        ty: Id,
        parameters: Interned,
        return_type: Interned,
    ) {
        let write = |e: &mut Self, groups: bool| {
            e.group_if(groups, |e| e.captured(parameters));
            e.captured(return_type);
        };
        if matches!(self.kind(ty), K::TypeLiteral | K::Mapped) || self.will_break(return_type) {
            return write(self, true);
        }
        if self.will_break(parameters) || !strings::contains_char(self.text_of(ty), b'{') {
            return write(self, false);
        }
        if self
            .node(self.node(self.node(ty).parent).params())
            .has(flag::COMMENT)
        {
            return self.give_up();
        }
        let variants = [
            self.variant(|e| write(e, false)),
            self.variant(|e| write(e, true)),
        ];
        self.best_fitting(&variants, Fallback::FlattestIfStable);
    }

    pub(super) fn can_avoid_parentheses(&self, arrow: &Node) -> bool {
        self.f.options().arrow_parentheses.is_as_needed()
            && arrow.kind == K::Arrow
            && self
                .tree
                .can_avoid_parentheses((arrow.b, arrow.params(), arrow.c))
            && !self.node(arrow.params()).has(flag::COMMENT)
    }

    pub(super) fn should_hug_function_parameters(&self, id: Id, has_no_parentheses: bool) -> bool {
        let [only] = *self.params(id) else {
            return false;
        };
        let param = self.node(only);
        let has_object_type = matches!(self.kind(param.b), K::TypeLiteral | K::Mapped);
        param.flags & (flag::REST | flag::ACCESSIBILITY | flag::OVERRIDE | flag::READONLY) == 0
            && match self.kind(param.a) {
                K::This => has_object_type,
                K::Ident => param.c == NONE && (has_no_parentheses || has_object_type),
                _ => match self.kind(param.c) {
                    K::Object | K::Array => self.node(param.c).len == 0,
                    kind => matches!(kind, K::None | K::Ident),
                },
            }
            && !self.has_comments_around_items(param.parent)
    }

    pub(super) fn has_only_simple_parameters(&self, id: Id, allows_types: bool) -> bool {
        self.params(id).iter().all(|&it| {
            let param = self.node(it);
            !param.has(flag::REST)
                && matches!(self.kind(param.a), K::Ident | K::This)
                && param.c == NONE
                && (allows_types || param.b == NONE)
        })
    }

    fn is_in_test_call(&self, function: Id) -> bool {
        let parent = self.parent(function);
        self.kind(parent) == K::Call && self.is_test_call(parent)
    }

    pub(super) fn formal_parameters(&mut self, id: Id) {
        let node = self.node(id);
        let params = self.list(node.params());
        let Some(&last) = params.last() else {
            return self.token("()");
        };
        if self.can_avoid_parentheses(node) {
            return self.source_of(last);
        }
        self.token("(");
        let hugs = self.should_hug_function_parameters(id, false) && self.node(last).d == NONE;
        if hugs || self.is_in_test_call(id) {
            for (i, &param) in params.iter().enumerate() {
                if i > 0 {
                    self.keyword(",");
                }
                self.formal_parameter(param, hugs);
            }
            return self.token(")");
        }
        let modifiers = flag::ACCESSIBILITY | flag::OVERRIDE | flag::READONLY;
        let has_modifiers = params.iter().any(|&it| self.node(it).has(modifiers));
        let has_rest = self.node(last).has(flag::REST);
        self.soft_block_indent(|e| {
            e.items(
                node.params(),
                e.node(node.params()).start,
                |e, _, next, comment| match e.has_empty_line_before(next, comment) {
                    true => e.line_of(LineMode::Empty),
                    false if has_modifiers => e.hard_line(),
                    false => e.line(),
                },
                |e, param| e.shortcut(param, |e| e.formal_parameter(param, false)),
                |e, _, is_last| match is_last {
                    false => e.token(","),
                    true if has_rest => {}
                    true => e.trailing_comma(FormatTrailingCommas::Arguments),
                },
            );
        });
        self.token(")");
    }

    fn formal_parameter(&mut self, id: Id, is_hugged: bool) {
        let node = self.node(id);
        if node.d == NONE {
            return self.undecorated_parameter(node, is_hugged);
        }
        self.group_if(!self.is_oxfmt, |e| {
            e.group_if(e.is_oxfmt, |e| {
                if e.is_line_break_after_decorator(node.d) {
                    e.expand_parent();
                }
                e.decorators(node.d, false);
            });
            e.group(|e| e.undecorated_parameter(node, true));
        });
    }

    fn undecorated_parameter(&mut self, node: &Node, is_hugged: bool) {
        let pattern = self.kind(node.a);
        if pattern == K::This || node.has(flag::REST) {
            self.token_if(node.has(flag::REST), "...");
            self.pattern(node.a);
            return self.type_annotation(node.b);
        }
        let is_group = pattern != K::Ident || self.is_oxfmt;
        let ty = self.node(node.b);
        let cannot_break = node.c == NONE
            && pattern == K::Ident
            && match ty.kind {
                K::TypeRef => ty.b == NONE,
                kind => matches!(kind, K::None | K::TypeKeyword),
            };
        self.group_if(is_group && !cannot_break && !is_hugged, |e| {
            e.member_modifiers(node);
            e.group_if(is_group && node.c != NONE, |e| {
                e.pattern_without_shortcut(node.a);
                e.token_if(node.has(flag::OPTIONAL), "?");
                e.type_annotation(node.b);
            });
            if node.c != NONE {
                e.space();
                e.keyword("=");
                e.expr(node.c);
            }
        });
    }

    // ───────────────────────────── arrow functions ─────────────────────────────

    pub(super) fn arrow_function(&mut self, id: Id, options: ArrowOptions) {
        self.arrow(id, options, false);
    }

    fn has_complex_signature(&self, id: Id) -> bool {
        let node = self.node(id);
        node.b != NONE
            || !self.has_only_simple_parameters(id, true)
            || (node.c != NONE && !self.params(id).is_empty())
    }

    fn should_add_parens_if_not_break(&self, body: Id) -> bool {
        if self.kind(body) != K::Cond {
            return false;
        }
        let mut leftmost = self.node(body);
        loop {
            leftmost = match leftmost.kind {
                K::Seq => self.node(self.tree.list_of(leftmost).first().copied().unwrap_or(NONE)),
                K::Update if leftmost.has(flag::PREFIX) => return true,
                K::Assign if self.kind(leftmost.a) == K::Object => return true,
                K::Binary
                | K::Logical
                | K::Dot
                | K::Index
                | K::Tagged
                | K::Call
                | K::Cond
                | K::As
                | K::Satisfies
                | K::NonNull
                | K::Assign
                | K::Update => self.node(leftmost.a),
                kind => return kind != K::Object,
            };
        }
    }

    fn arrow(&mut self, id: Id, options: ArrowOptions, is_nested: bool) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        let node = self.node(id);
        let expand_last_arg = options.grouped == Some(Grouped::Last);
        let is_chain = !expand_last_arg && self.kind(node.d) == K::Arrow;
        let (mut tail, mut should_break_chain) = (id, false);
        if is_chain {
            should_break_chain = self.has_complex_signature(tail);
            while self.kind(self.node(tail).d) == K::Arrow {
                tail = self.node(tail).d;
                should_break_chain = should_break_chain || self.has_complex_signature(tail);
            }
        }
        let body = self.node(tail).d;
        let adds_parens = self.should_add_parens_if_not_break(body);
        let comments = match self.kind(body) {
            K::Jsx => &[],
            _ => self.comments_leading(self.node(tail), body),
        };
        let has_own_line_comment = self.has_line_break_after(comments);
        if !comments.is_empty() && matches!(self.kind(body), K::Body | K::Seq | K::Arrow)
            || (self.kind(body) == K::Seq && self.node(tail).has(flag::COMMENT))
        {
            return self.give_up();
        }
        let is_body_on_same_line = match self.kind(body) {
            _ if has_own_line_comment => adds_parens && expand_last_arg && self.is_oxfmt,
            K::Body | K::Seq | K::Array | K::Object | K::Jsx | K::Arrow => true,
            K::Template | K::Tagged => self.is_multiline_template_starting_on_same_line(body),
            _ => adds_parens && (!should_break_chain || (expand_last_arg && self.is_oxfmt)),
        };
        let breaks_with_chain = is_chain && is_body_on_same_line && adds_parens && self.is_oxfmt;
        let format_body = |e: &mut Self| {
            let body = |e: &mut Self| e.arrow_body(tail, options);
            if is_body_on_same_line && !adds_parens {
                e.space();
                return body(e);
            }
            let end = |e: &mut Self| {
                if expand_last_arg {
                    e.trailing_comma(FormatTrailingCommas::All);
                }
                if expand_last_arg || e.kind(node.parent) == K::JsxContainer {
                    e.soft_line();
                }
            };
            if breaks_with_chain {
                e.soft_line_indent_or_space(|e| {
                    e.token_if_fits("(");
                    body(e);
                    e.token_if_fits(")");
                });
                end(e);
            } else if is_body_on_same_line {
                e.space();
                e.group(|e| {
                    e.may_break_unless_flat();
                    e.token_if_fits("(");
                    e.indent(|e| {
                        e.soft_line();
                        body(e);
                    });
                    e.token_if_fits(")");
                    end(e);
                });
            } else {
                e.soft_line_indent_or_space(body);
                end(e);
            }
        };
        if !is_chain {
            // The soft line breaks of these type parameters aren't removed.
            self.flat.matches &= !self.flat.is_following
                || self.is_oxfmt
                || node.b == NONE
                || self.kind(node.parent) != K::Args
                || !self.params(id).is_empty();
            match self.flat.is_on && options.grouped.is_some() {
                true => self.group(|e| {
                    let caches = false;
                    e.signature_on_one_line(node, |e| e.arrow_signature(id, caches, false));
                }),
                false => self.watched_signature(id, |e| {
                    e.arrow_signature(id, options.caches, is_nested);
                }),
            }
            self.space();
            self.token("=>");
            return self.group_if(!is_body_on_same_line || adds_parens, format_body);
        }
        let is_callee = self.is_callee(id);
        let should_indent_signatures = is_callee || options.assignment_layout.is_some();
        let should_print_soft_line = should_indent_signatures
            && options.assignment_layout != Some(Layout::BreakAfterOperator);
        let should_break_signatures = is_callee && (!is_body_on_same_line || breaks_with_chain);
        let is_first_indented = !self.is_oxfmt
            && !matches!(
                self.parent_kind(id),
                K::Call | K::New | K::ImportCall | K::Binary | K::Logical
            );
        let first = |e: &mut Self| e.arrow_signature(id, options.caches, false);
        let rest = |e: &mut Self| {
            let mut current = id;
            while current != tail {
                current = e.node(current).d;
                e.space();
                e.token("=>");
                e.line();
                e.arrow_signature(current, options.caches, false);
            }
        };
        let group_id = self.group_id();
        self.group(|e| {
            e.group_with(should_break_signatures, Some(group_id), |e| {
                e.indent_if(should_indent_signatures, |e| {
                    if should_print_soft_line {
                        e.empty_token();
                        e.soft_line();
                    }
                    e.group_with(should_break_chain, None, |e| {
                        e.indent_if(!should_indent_signatures && is_first_indented, |e| {
                            first(e);
                            e.indent_if(!should_indent_signatures && !is_first_indented, rest);
                        });
                    });
                });
            });
            e.space();
            e.token("=>");
            e.indent_if_group_breaks(group_id, format_body);
            if is_callee {
                e.if_breaks(Some(group_id), |e| {
                    e.soft_line();
                    e.empty_token();
                });
            }
        });
    }

    fn arrow_signature(&mut self, id: Id, caches: bool, should_remove_soft_lines: bool) {
        let node = self.node(id);
        let has_parameters = !self.params(id).is_empty();
        let first = if node.b == NONE {
            node.params()
        } else {
            node.b
        };
        let last = if node.c == NONE {
            node.params()
        } else {
            node.c
        };
        let flattened = |e: &mut Self| {
            e.cached(caches, (id, Part::Parameters), |e| {
                if !has_parameters {
                    if node.c == NONE && caches {
                        e.f.write_element(FormatElement::Nop);
                    }
                    return e.type_annotation(node.c);
                }
                let write = |e: &mut Self| {
                    e.type_parameters(node.b, None);
                    e.formal_parameters(id);
                    e.type_annotation(node.c);
                };
                // After `removeLines` the printer still chooses how to lay out a call.
                let inside = e.slice(e.node(node.params()).start + 1, e.node(last).end);
                match caches && !e.is_oxfmt && strings::contains_char(inside, b'(') {
                    true => e.exactly(write),
                    false => e.shortcut_in_group(first, last, write),
                }
            });
        };
        self.group(|e| {
            e.token_if(node.has(flag::ASYNC), "async ");
            if !has_parameters {
                e.cached(caches, (id, Part::EmptyParameters), |e| {
                    e.type_parameters(node.b, None);
                    e.token("()");
                });
            }
            if should_remove_soft_lines {
                let content = e.capture(flattened);
                e.signature_without_lines(content);
            } else {
                flattened(e);
            }
        });
    }

    fn arrow_body(&mut self, arrow: Id, options: ArrowOptions) {
        let body = self.node(arrow).d;
        match self.kind(body) {
            K::Arrow => self.arrow(body, options, true),
            kind => self.cached(options.caches, (arrow, Part::Body), |e| match kind {
                K::Body => e.function_body(arrow),
                K::Seq => {
                    e.token("(");
                    e.expr(body);
                    e.token(")");
                }
                K::Jsx => e.expr(body),
                _ => {
                    e.leading_comments_of(body, e.comments_leading(e.node(arrow), body));
                    e.expr(body);
                }
            }),
        }
    }

    // ───────────────────────────── type parameters and arguments ─────────────────────────────

    pub(super) fn type_parameter(&mut self, id: Id) {
        let node = self.node(id);
        self.keyword_if(node.has(flag::CONST), "const");
        self.keyword_if(node.has(flag::IN), "in");
        self.keyword_if(node.has(flag::OUT), "out");
        self.source_of(node.a);
        for (operator, ty) in [("extends", node.b), ("=", node.c)] {
            if ty != NONE {
                let group_id = self.group_id();
                self.space();
                self.token(operator);
                self.indented_line_group(group_id);
                self.boundary();
                self.indent_if_group_breaks(group_id, |e| {
                    if e.kind(ty) == K::Union {
                        e.empty_token();
                    }
                    e.ty(ty);
                });
            }
        }
    }

    #[inline]
    pub(super) fn type_parameters(&mut self, id: Id, group_id: Option<GroupId>) {
        match (id, group_id) {
            (NONE, _) => {}
            (_, None) => self.shortcut(id, |e| e.type_parameter_list(id, None)),
            _ => self.type_parameter_list(id, group_id),
        }
    }

    fn type_parameter_list(&mut self, id: Id, group_id: Option<GroupId>) {
        let (params, owner) = (self.list(id), self.node(id).parent);
        if self.is_in_test_call(owner) {
            return self.give_up();
        }
        let needs_comma = self.needs_comma_after_type_parameter
            && self.kind(owner) == K::Arrow
            && matches!(*params, [only] if self.node(only).b == NONE);
        self.group_with(false, group_id, |e| {
            e.token("<");
            e.soft_block_indent(|e| {
                e.items(
                    id,
                    e.node(id).start,
                    |e, _, _, _| e.line(),
                    |e, param| e.shortcut(param, |e| e.type_parameter(param)),
                    |e, _, is_last| match !is_last || needs_comma {
                        true => e.token(","),
                        false => e.trailing_comma(FormatTrailingCommas::ES5),
                    },
                );
            });
            e.token(">");
        });
    }

    #[inline]
    pub(super) fn type_arguments(&mut self, id: Id) {
        if id != NONE {
            self.shortcut(id, |e| e.type_argument_list(id));
        }
    }

    fn type_argument_list(&mut self, id: Id) {
        let args = self.list(id);
        if let [only] = *args
            && self.should_inline_type_argument(id, only)
        {
            self.token("<");
            self.ty(only);
            return self.token(">");
        }
        self.group(|e| {
            e.token("<");
            e.soft_block_indent(|e| e.comma_separated(id, None, Self::ty));
            e.token(">");
        });
    }

    fn should_inline_type_argument(&self, list: Id, only: Id) -> bool {
        let node = self.node(only);
        match node.kind {
            K::TypeLiteral | K::Mapped => return true,
            K::TypeKeyword | K::TemplateType | K::LiteralType => {}
            K::TypeRef if node.b == NONE => {}
            K::Union if self.should_hug_union(only) => {}
            _ => return false,
        }
        let declarator = self.node(self.node(self.node(list).parent).parent);
        let is_annotation =
            declarator.kind == K::Declarator && declarator.b == self.node(list).parent;
        !(is_annotation && self.kind(declarator.c) == K::Arrow)
    }
}
