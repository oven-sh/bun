use super::*;

impl Emitter<'_, '_> {
    pub(super) fn statement(&mut self, id: Id) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        let node = self.node(id);
        match node.kind {
            K::ExprStmt => self.expression_statement(id),
            K::Var => self.variable_declaration(id),
            K::Return => self.return_or_throw("return", node.a),
            K::If => self.if_statement(id),
            K::Fn => self.function(id, Default::default()),
            K::Class => self.class(id),
            K::Throw => self.return_or_throw("throw", node.a),
            K::Block => self.block(id),
            K::Directive => self.directive(node.a),
            K::Empty => self.token(";"),
            K::Break | K::Continue | K::Debugger => {
                self.token(match node.kind {
                    K::Break => "break",
                    K::Continue => "continue",
                    _ => "debugger",
                });
                if node.a != NONE {
                    self.space();
                    self.source_of(node.a);
                }
                self.semicolon();
            }
            K::Labeled => {
                self.source_of(node.a);
                self.keyword(":");
                self.statement(node.b);
            }
            K::Decorated => {
                self.expand_parent();
                self.decorators(node.a, false);
                if self.kind(node.b) != K::Class {
                    self.hard_line();
                }
                self.statement(node.b);
            }
            K::For => self.for_statement(id),
            K::ForIn | K::ForOf => self.group(|e| {
                e.keyword("for");
                e.keyword_if(node.has(flag::ASYNC), "await");
                e.token("(");
                e.for_head(node.a);
                e.space();
                e.keyword(if node.kind == K::ForIn { "in" } else { "of" });
                e.expr(node.b);
                e.token(")");
                e.statement_body(node.c, false);
            }),
            K::While => self.group(|e| {
                e.keyword("while");
                e.token("(");
                e.condition(node.a);
                e.token(")");
                e.statement_body(node.b, false);
            }),
            K::DoWhile => {
                self.group(|e| {
                    e.token("do");
                    e.statement_body(node.a, false);
                });
                match self.kind(node.a) {
                    K::Block => self.space(),
                    _ => self.hard_line(),
                }
                self.keyword("while");
                self.token("(");
                self.condition(node.b);
                self.token(")");
                self.semicolon();
            }
            K::Switch => self.switch_statement(id),
            K::Try => self.try_statement(id),
            K::Import => self.import_declaration(id),
            K::ExportNamed => self.export_named_declaration(id),
            K::ExportAll => self.export_all_declaration(id),
            K::ExportDefault => self.export_default_declaration(id),
            K::Export => self.exported_declaration(id),
            K::TypeAlias => self.type_alias_declaration(id),
            K::Interface => self.interface_declaration(id),
            K::Enum => self.enum_declaration(id),
            K::Module => self.module_declaration(id),
            _ => self.give_up(),
        }
    }

    fn directive(&mut self, string: Id) {
        let text = self.text_of(string);
        let content = text
            .get(1..text.len().saturating_sub(1))
            .unwrap_or_default();
        if text.first() != Some(&self.quote) && strings::index_of_any(content, b"\"'").is_none() {
            return self.give_up();
        }
        self.source_of(string);
        self.semicolon();
    }

    fn expression_statement(&mut self, id: Id) {
        let node = self.node(id);
        if !self.has_semicolons {
            let first = self.src.get(node.start as usize);
            let needs_semicolon = self.kind(node.a) == K::Arrow
                || matches!(first, Some(b'(' | b'[' | b'`' | b'+' | b'-' | b'/' | b'<'));
            if needs_semicolon || self.has_parentheses_on_left_edge(node.a) {
                return self.give_up();
            }
        }
        self.expr(node.a);
        self.semicolon();
    }

    /// Counts those that an operand in a chain like `a | b | c` would have if it were printed on its own.
    fn has_parentheses_on_left_edge(&self, mut id: Id) -> bool {
        while id != NONE {
            if self.needs_parentheses(id) {
                return true;
            }
            let node = self.node(id);
            id = match node.kind {
                K::Seq => self.tree.list_of(node).first().copied().unwrap_or(NONE),
                K::Fn | K::Class => NONE,
                _ => node.a,
            };
        }
        false
    }

    fn return_or_throw(&mut self, keyword: &'static str, argument: Id) {
        self.token(keyword);
        if argument != NONE {
            self.space();
            let comments = self.comments_leading(self.node(self.node(argument).parent), argument);
            match self.kind(argument) {
                K::Jsx => self.expr(argument),
                K::Seq | K::Assign if !comments.is_empty() => self.give_up(),
                _ if self.has_line_break_after(comments) => {
                    self.token("(");
                    self.block_indent(|e| {
                        e.leading_comments_of(argument, comments);
                        e.expr(argument);
                    });
                    self.token(")");
                }
                K::Binary | K::Logical => self.in_parentheses_if_breaks(argument),
                _ => self.expr(argument),
            }
        }
        self.semicolon();
    }

    pub(super) fn in_parentheses_if_breaks(&mut self, argument: Id) {
        self.group(|e| {
            e.token_if_breaks("(");
            e.soft_block_indent(|e| e.expr(argument));
            e.token_if_breaks(")");
        });
    }

    fn condition(&mut self, test: Id) {
        let comments = self.comments_leading(self.node(self.node(test).parent), test);
        if !comments.is_empty() && self.kind(test) != K::Jsx {
            return self.group(|e| {
                e.soft_block_indent(|e| {
                    e.leading_comments_of(test, comments);
                    e.expr_without_shortcut(test);
                });
            });
        }
        let operand_of_not = |id: Id| {
            let node = self.node(id);
            (node.kind == K::Unary && node.op == T::Bang).then_some(node.a)
        };
        let is_negated_logical = operand_of_not(test)
            .is_some_and(|it| self.kind(operand_of_not(it).unwrap_or(it)) == K::Logical);
        match is_negated_logical && !self.is_oxfmt {
            true => self.expr(test),
            false => self.grouped_condition(test),
        }
    }

    fn grouped_condition(&mut self, test: Id) {
        if self.node(test).has(flag::PARENS) || matches!(self.kind(test), K::Ident | K::Assign) {
            return self.group(|e| e.soft_block_indent(|e| e.expr(test)));
        }
        self.flat.has_group = true;
        self.shortcut(test, |e| {
            e.group(|e| e.soft_block_indent(|e| e.expr_without_shortcut(test)));
        });
    }

    fn statement_body(&mut self, body: Id, force_space: bool) {
        match self.kind(body) {
            K::Empty => self.token(";"),
            K::Block => {
                self.space();
                self.block(body);
            }
            _ if force_space => {
                self.space();
                self.statement(body);
            }
            _ => self.soft_line_indent_or_space(|e| e.shortcut(body, |e| e.statement(body))),
        }
    }

    fn if_statement(&mut self, id: Id) {
        let node = self.node(id);
        self.group(|e| {
            e.token("if (");
            e.condition(node.a);
            e.token(")");
            e.statement_body(node.b, false);
        });
        if node.c == NONE {
            return;
        }
        match self.kind(node.b) {
            K::Block => self.space(),
            _ => self.hard_line(),
        }
        self.token("else");
        self.group(|e| e.statement_body(node.c, e.kind(node.c) == K::If));
    }

    fn for_head(&mut self, id: Id) {
        match self.kind(id) {
            K::None => {}
            K::Var => self.shortcut(id, |e| e.variable_declaration(id)),
            _ => self.expr(id),
        }
    }

    fn for_statement(&mut self, id: Id) {
        let node = self.node(id);
        self.group(|e| {
            e.keyword("for");
            if (node.a, node.b, node.c) == (NONE, NONE, NONE) {
                e.token("(;;)");
            } else {
                e.token("(");
                e.group(|e| {
                    e.soft_block_indent(|e| {
                        e.for_head(node.a);
                        e.token(";");
                        e.line();
                        e.for_head(node.b);
                        e.token(";");
                        if node.c != NONE {
                            e.line();
                            e.expr(node.c);
                        }
                    });
                });
                e.token(")");
            }
            e.statement_body(node.d, false);
        });
    }

    /// `owner` has braces around a list of statements, or it's a `case` that has statements.
    pub(in crate::js::settled) fn hole_of(&self, owner: Id) -> Hole {
        let node = self.node(owner);
        if node.kind == K::Case {
            let head_end = if node.a == NONE {
                node.start
            } else {
                self.node(node.a).end
            };
            let first = self
                .list(owner)
                .first()
                .map_or(node.end, |&it| self.node(it).start);
            let comments = self.comments_between(head_end, first);
            let start = comments.first().map_or(first, |it| it.start);
            return Hole {
                start,
                end: node.end,
                owner,
            };
        }
        let content = self.slice(node.start + 1, node.end - 1);
        let start = node.end - 1 - content.trim_ascii_start().len() as u32;
        let end = node.start + 1 + content.trim_ascii_end().len() as u32;
        Hole { start, end, owner }
    }

    fn hole(&mut self, owner: Id) {
        let hole = self.hole_of(owner);
        self.holes.push(hole);
        match self.flat.is_on {
            true => self.source(hole.start, hole.end),
            false => super::super::write_placeholder(self.f),
        }
    }

    /// Writes what's between the braces of `id`. Returns false if that's nothing.
    pub(super) fn block_content(&mut self, id: Id) -> bool {
        let node = self.node(id);
        if node.len == 0 && !node.has(flag::COMMENT) {
            return false;
        }
        self.block_indent(|e| e.hole(id));
        true
    }

    pub(super) fn block(&mut self, id: Id) {
        self.token("{");
        if !self.block_content(id) {
            let parent = self.node(self.node(id).parent);
            let collapses = match parent.kind {
                K::None => return self.give_up(),
                K::For | K::While | K::DoWhile => true,
                K::Catch => self.node(parent.parent).c == NONE,
                K::Body => self.is_oxfmt,
                _ => false,
            };
            if !collapses {
                self.hard_line();
            }
        }
        self.token("}");
    }

    fn switch_statement(&mut self, id: Id) {
        let node = self.node(id);
        self.keyword("switch");
        self.token("(");
        self.grouped_condition(node.a);
        self.token(")");
        self.space();
        self.token("{");
        if node.len == 0 {
            return self.give_up();
        }
        self.block_indent(|e| {
            e.items(
                id,
                e.node(node.a).end,
                |e, previous, _, _| match e.is_next_line_empty(e.node(previous).end) {
                    true => e.line_of(LineMode::Empty),
                    false => e.hard_line(),
                },
                Self::switch_case,
                |_, _, _| {},
            );
        });
        self.token("}");
    }

    fn switch_case(&mut self, id: Id) {
        let node = self.node(id);
        match node.a {
            NONE => self.token("default:"),
            test => {
                self.keyword("case");
                self.expr(test);
                self.token(":");
            }
        }
        match *self.list(id) {
            [] => {}
            [only] if self.kind(only) == K::Block => {
                if self.node(only).has(flag::UNSURE) {
                    return self.give_up();
                }
                self.space();
                self.block(only);
            }
            _ => self.indent(|e| {
                e.hard_line();
                if e.flat.matches {
                    e.hole(id);
                }
            }),
        }
    }

    fn try_statement(&mut self, id: Id) {
        let node = self.node(id);
        self.keyword("try");
        self.block(node.a);
        if node.b != NONE {
            let handler = self.node(node.b);
            self.space();
            self.keyword("catch");
            if handler.a != NONE {
                self.token("(");
                self.pattern(self.node(handler.a).a);
                self.type_annotation(self.node(handler.a).b);
                self.token(")");
                self.space();
            }
            self.block(handler.b);
        }
        if node.c != NONE {
            self.space();
            self.keyword("finally");
            self.block(node.c);
        }
    }

    pub(super) fn variable_declaration(&mut self, id: Id) {
        let node = self.node(id);
        let parent = self.node(node.parent);
        let is_in_loop = matches!(parent.kind, K::For | K::ForIn | K::ForOf);
        let is_in_head = is_in_loop && parent.a == id;
        let is_parent_for_loop = is_in_head || (is_in_loop && self.is_oxfmt);
        self.keyword_if(node.has(flag::DECLARE), "declare");
        let declarators = self.tree.list_of(node);
        let has_value = |&it: &Id| self.node(it).c != NONE;
        let has_any_value = declarators.iter().any(has_value);
        let is_simple = declarators.len() == 1 && has_any_value && !node.has(flag::COMMENT);
        let first = declarators
            .first()
            .map_or(node.start, |&it| self.node(it).start);
        if declarators.len() > 1 && strings::contains_char(self.slice(node.start, first), b'/') {
            return self.give_up();
        }
        self.group_if(!is_simple, |e| {
            e.token(match node.op {
                T::Const => "const ",
                T::Let => "let ",
                T::Using => "using ",
                T::Await => "await using ",
                _ => "var ",
            });
            match *declarators {
                [only] => e.assignment_like(only),
                _ => e.indent(|e| {
                    for (i, &declarator) in declarators.iter().enumerate() {
                        if i > 0 {
                            e.token(",");
                            match !is_parent_for_loop && has_any_value {
                                true => e.hard_line(),
                                false => e.line(),
                            }
                        }
                        e.shortcut(declarator, |e| e.assignment_like(declarator));
                    }
                }),
            }
            if !is_in_head && parent.kind != K::Export {
                e.semicolon();
            }
        });
    }
}
