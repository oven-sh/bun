use super::function::ExprOptions;
use super::*;
use crate::js::settled::parser::has_preferred_quotes;
use crate::js::utils::number::format_trimmed_number;

impl Emitter<'_, '_> {
    #[inline]
    pub(super) fn expr(&mut self, id: Id) {
        let node = self.node(id);
        match node.kind {
            K::Ident if node.op == T::Ident => self.source(node.start, node.end),
            K::This | K::Null | K::Bool | K::Super | K::PrivateName | K::Meta => {
                self.source(node.start, node.end);
            }
            K::Str => self.string(id),
            _ => self.compound_expr(id),
        }
    }

    fn compound_expr(&mut self, id: Id) {
        let needs_parentheses = self.needs_parentheses(id);
        self.token_if(needs_parentheses, "(");
        self.shortcut(id, |e| e.bare_expr(id, ExprOptions::None));
        self.token_if(needs_parentheses, ")");
    }

    /// For an expression whose line breaks may belong to the group around it, or whose label matters.
    pub(super) fn expr_without_shortcut(&mut self, id: Id) {
        self.expr_with(id, ExprOptions::None);
    }

    pub(super) fn expr_with(&mut self, id: Id, options: ExprOptions) {
        let needs_parentheses = self.needs_parentheses(id);
        self.token_if(needs_parentheses, "(");
        self.bare_expr(id, options);
        self.token_if(needs_parentheses, ")");
    }

    fn bare_expr(&mut self, id: Id, options: ExprOptions) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        let node = self.node(id);
        match node.kind {
            K::Dot | K::Index => self.member_expression(id),
            K::Call => self.call_expression(id),
            K::Ident | K::This | K::Null | K::Bool | K::Super | K::PrivateName | K::Meta => {
                self.source(node.start, node.end);
            }
            K::Str => self.string(id),
            K::Num => self.number(id),
            K::Object if node.has(flag::TARGET) => self.object_pattern(id),
            K::Object => self.object_like(id),
            K::Array if node.has(flag::TARGET) => self.array_pattern(id),
            K::Array => self.array(id),
            K::Arrow => self.arrow_function(id, options.of_arrow()),
            K::Fn => self.function(id, options.of_function()),
            K::Binary | K::Logical => self.binary(id),
            K::Unary => {
                let len = match node.op {
                    T::Typeof | T::Delete => 6,
                    T::Void => 4,
                    _ => 1,
                };
                self.source(node.start, node.start + len);
                if len > 1 {
                    self.space();
                }
                self.expr(node.a);
            }
            K::Update => {
                let operator = if node.op == T::PlusPlus { "++" } else { "--" };
                self.token_if(node.has(flag::PREFIX), operator);
                self.expr(node.a);
                self.token_if(!node.has(flag::PREFIX), operator);
            }
            K::Assign if node.has(flag::TARGET) => {
                self.expr(node.a);
                self.space();
                self.keyword("=");
                self.expr(node.b);
            }
            K::Assign => self.assignment_like(id),
            K::Cond => self.conditional_like(id, false),
            K::Await => self.await_expression(id),
            K::Template => self.template_literal(id),
            K::New => self.new_expression(id),
            K::As | K::Satisfies => self.as_or_satisfies(id),
            K::NonNull => {
                self.expr(node.a);
                self.token("!");
            }
            K::Spread => {
                self.token("...");
                self.expr(node.a);
            }
            K::Jsx => self.jsx_element(id),
            K::Regex => self.wide_source(node.start, node.end),
            K::BigInt => match self.text_of(id).iter().any(u8::is_ascii_uppercase) {
                true => self.give_up(),
                false => self.source(node.start, node.end),
            },
            K::Tagged => {
                self.expr(node.a);
                self.type_arguments(node.b);
                self.boundary();
                self.expr(node.c);
            }
            K::Class => self.class(id),
            K::Seq => self.sequence(id),
            K::Yield => {
                self.token("yield");
                self.token_if(node.has(flag::STAR), "*");
                if node.a != NONE {
                    self.space();
                    match self.is_binaryish(node.a) && self.is_oxfmt {
                        true => self.in_parentheses_if_breaks(node.a),
                        false => self.expr(node.a),
                    }
                }
            }
            K::ImportCall => self.import_expression(id),
            _ => self.give_up(),
        }
    }

    #[inline]
    pub(super) fn string(&mut self, id: Id) {
        let node = self.node(id);
        let is_plain =
            self.src.get(node.start as usize) == Some(&self.quote) && !node.has(flag::ESCAPE);
        if !is_plain && !has_preferred_quotes(self.text_of(id), self.quote) {
            return self.give_up();
        }
        self.wide_source(node.start, node.end);
    }

    pub(super) fn number(&mut self, id: Id) {
        let text = self.text_of(id);
        match *format_trimmed_number(text) == *text {
            true => self.source_of(id),
            false => self.give_up(),
        }
    }

    fn await_expression(&mut self, id: Id) {
        let node = self.node(id);
        let inner = |e: &mut Self| {
            e.keyword("await");
            e.expr(node.a);
        };
        let parent = self.node(node.parent);
        let is_callee_or_object = parent.a == id
            && match parent.kind {
                K::Dot | K::Index | K::Call => true,
                K::New => self.is_oxfmt,
                _ => false,
            };
        if !is_callee_or_object {
            return inner(self);
        }
        let is_in_await = self.kind(self.left_edge_end(id).1) == K::Await;
        self.group_if(!is_in_await, |e| e.soft_block_indent(inner));
    }

    fn as_or_satisfies(&mut self, id: Id) {
        let node = self.node(id);
        let inner = |e: &mut Self| {
            e.expr(node.a);
            e.space();
            e.keyword(if node.kind == K::As {
                "as"
            } else {
                "satisfies"
            });
            e.ty(node.b);
        };
        let parent = self.node(node.parent);
        let is_callee_or_object = parent.a == id
            && match parent.kind {
                K::Dot | K::Index | K::Call => true,
                K::New => !self.is_oxfmt,
                _ => false,
            };
        match is_callee_or_object {
            true => self.group(|e| e.soft_block_indent(inner)),
            false => inner(self),
        }
    }

    // ───────────────────────────── templates ─────────────────────────────

    fn template_literal(&mut self, id: Id) {
        match self.may_have_embedded_language(id) {
            true => self.give_up(),
            false => self.template_like(id),
        }
    }

    pub(super) fn template_like(&mut self, id: Id) {
        self.boundary();
        self.token("`");
        let parts = self.list(id);
        let width = self.f.options().indent_width.value().max(1);
        let mut indentation = 0;
        for (i, &part) in parts.iter().enumerate().step_by(2) {
            let quasi = self.node(part);
            let substitution = parts.get(i + 1);
            let end = quasi.end - if substitution.is_some() { 2 } else { 1 };
            let raw = self.slice(quasi.start + 1, end);
            let (Some(&e), Some(&next)) = (substitution, parts.get(i + 2)) else {
                self.quasi(quasi.start + 1, end);
                break;
            };
            self.quasi(quasi.start + 1, end);
            if self.flat.is_on {
                self.flat_substitution(e);
                continue;
            }
            if let Some(line_break) = strings::last_index_of_char(raw, b'\n') {
                indentation = 0;
                for byte in raw.get(line_break + 1..).unwrap_or_default() {
                    match byte {
                        b'\t' => indentation += width - indentation % width,
                        b' ' => indentation += 1,
                        _ => break,
                    }
                }
            }
            let is_at_start_of_line = indentation == 0 && raw.last() == Some(&b'\n');
            let has_line_break = self.has_newline(quasi.end, self.node(next).start);
            self.substitution(e, has_line_break, is_at_start_of_line, indentation);
        }
        self.token("`");
    }

    fn quasi(&mut self, start: u32, end: u32) {
        match self.is_flat() {
            true if self.flat.is_following => self.text(self.slice(start, end)),
            true => self.source(start, end),
            false => self.text(self.slice(start, end)),
        }
    }

    fn substitution_content(&mut self, id: Id) {
        match self.kind(id) >= K::TypeKeyword {
            true => self.ty(id),
            false => self.expr(id),
        }
    }

    fn flat_substitution(&mut self, id: Id) {
        self.group(|e| {
            e.token("${");
            e.unbreakable(|e| e.substitution_content(id));
            e.token("}");
        });
    }

    fn substitution(&mut self, id: Id, has_line_break: bool, starts_line: bool, indentation: u32) {
        let content = self.intern(|e| e.substitution_content(id));
        let breaks = has_line_break || content.is_some_and(|it| it.will_break(self.f));
        let inner = |e: &mut Self| {
            if !breaks {
                let content = e.capture(|e| e.element(content));
                return e.without_soft_lines(content);
            }
            let mut stripped = id;
            while e.kind(stripped) == K::NonNull {
                stripped = e.node(stripped).a;
            }
            let is_indented = matches!(e.kind(stripped), K::Dot | K::Index)
                || matches!(
                    e.kind(id),
                    K::Cond | K::Seq | K::As | K::Satisfies | K::Binary | K::Logical | K::Ident
                );
            match is_indented {
                true => e.soft_block_indent(|e| e.element(content)),
                false => e.element(content),
            }
        };
        let width = self.f.options().indent_width.value().max(1);
        self.group(|e| {
            e.token("${");
            if starts_line {
                e.dedent(DedentMode::Root, inner);
            } else if indentation == 0 {
                inner(e);
            } else {
                e.dedent(DedentMode::Root, |e| {
                    e.align(indentation % width, |e| {
                        for _ in 0..indentation / width {
                            e.f.write_element(FormatElement::Tag(Tag::StartIndent));
                        }
                        inner(e);
                        for _ in 0..indentation / width {
                            e.f.write_element(FormatElement::Tag(Tag::EndIndent));
                        }
                    });
                });
            }
            e.boundary();
            e.token("}");
        });
    }
}
