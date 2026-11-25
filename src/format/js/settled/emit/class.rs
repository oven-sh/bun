//! Classes, interfaces, enums, type aliases and namespaces.

use super::*;

impl Emitter<'_, '_> {
    fn is_bare_qualified_name(&self, ty: Id) -> bool {
        let node = self.node(ty);
        node.b == NONE && self.kind(node.a) == K::QualifiedName
    }

    fn heritage_types(&mut self, types: &[Id]) {
        for (i, &ty) in types.iter().enumerate() {
            if i > 0 {
                self.token(",");
                self.line();
            }
            if self.kind(self.node(self.node(ty).a).a) == K::QualifiedName {
                return self.give_up();
            }
            self.ty(ty);
        }
    }

    /// `implements A, B` of a class, `extends A, B` of an interface
    fn heritage_clause(
        &mut self,
        keyword: &'static str,
        types: &[Id],
        has_multiple: bool,
        is_grouped: bool,
    ) {
        if types.is_empty() {
            return;
        }
        if has_multiple {
            self.line();
            self.token(keyword);
            return self.group(|e| e.soft_line_indent_or_space(|e| e.heritage_types(types)));
        }
        match is_grouped {
            true => self.line(),
            false => self.space(),
        }
        self.group_if(is_grouped, |e| {
            e.keyword(keyword);
            e.heritage_types(types);
        });
    }

    /// With a line after each of them.
    pub(super) fn decorators(&mut self, id: Id, keeps_empty_lines: bool) {
        for (i, &e) in self.list(id).iter().enumerate() {
            let before = self.slice(0, self.node(e).start - 1).trim_ascii_end().len();
            if i > 0 && keeps_empty_lines && self.source_text().lines_after(before as u32) > 1 {
                self.line_of(LineMode::Empty);
            }
            self.token("@");
            self.expr(e);
            self.line();
        }
    }

    pub(super) fn is_line_break_after_decorator(&self, id: Id) -> bool {
        (self.list(id).iter()).any(|&it| {
            self.source_text()
                .has_line_terminator_after(self.node(it).end)
        })
    }

    #[inline]
    pub(super) fn member_decorators(&mut self, member: &Node) {
        if member.d != NONE {
            let should_expand = self.is_line_break_after_decorator(member.d);
            self.group_with(should_expand, None, |e| e.decorators(member.d, e.is_oxfmt));
        }
    }

    pub(super) fn class(&mut self, id: Id) {
        let node = self.node(id);
        let (extends, implements) = (self.node(node.c), self.tree.list_of(node));
        let parent = self.node(node.parent);
        if node.c != NONE && parent.kind == K::Assign {
            return self.give_up();
        }
        self.keyword_if(node.has(flag::DECLARE), "declare");
        self.keyword_if(node.has(flag::ABSTRACT), "abstract");
        self.token("class");
        let has_multiple = usize::from(node.c != NONE) + implements.len() > 1;
        let is_grouped = has_multiple
            || match (node.c, implements) {
                (NONE, &[only]) => self.is_bare_qualified_name(only),
                (NONE, _) => false,
                _ => extends.b == NONE && matches!(self.kind(extends.a), K::Dot | K::Index),
            };
        let head = |e: &mut Self| {
            if node.a != NONE {
                e.space();
                e.source_of(node.a);
            }
            e.type_parameters(node.b, None);
        };
        let heritage = |e: &mut Self| {
            if node.c != NONE {
                match is_grouped {
                    true => e.line(),
                    false => e.space(),
                }
                e.group_if(is_grouped, |e| {
                    e.keyword("extends");
                    e.expr(extends.a);
                    e.type_arguments(extends.b);
                });
            }
            e.heritage_clause("implements", implements, has_multiple, is_grouped);
        };
        if is_grouped {
            let group_id = self.group_id();
            self.group_with(false, Some(group_id), |e| {
                head(e);
                e.indent(heritage);
            });
            if self.node(node.d).len > 0 {
                self.if_breaks(Some(group_id), Self::hard_line);
            }
        } else {
            head(self);
            heritage(self);
        }
        self.space();
        self.class_body(node.d);
    }

    fn class_body(&mut self, id: Id) {
        self.token("{");
        match self.node(id).len {
            0 => _ = self.block_content(id),
            _ => self.block_indent(|e| {
                e.items(
                    id,
                    e.node(id).start,
                    |e, _, next, comment| match e.has_empty_line_before(next, comment) {
                        true => e.line_of(LineMode::Empty),
                        false => e.hard_line(),
                    },
                    |e, member| e.shortcut(member, |e| e.class_member(member)),
                    |_, _, _| {},
                );
            }),
        }
        self.token("}");
    }

    fn class_member(&mut self, id: Id) {
        let node = self.node(id);
        match node.kind {
            K::Field => {
                self.assignment_like(id);
                if !self.has_semicolons && self.field_may_need_semicolon(node) {
                    self.give_up();
                }
                self.semicolon();
            }
            K::Method => {
                self.member_decorators(node);
                self.member_modifiers(node);
                self.method_prefix(node);
                self.key(id);
                self.token_if(node.has(flag::OPTIONAL), "?");
                self.grouped_parameters_with_return_type_for_method(node.b);
                match self.node(node.b).d {
                    NONE => self.semicolon(),
                    _ => self.function_body(node.b),
                }
            }
            K::StaticBlock => {
                self.keyword("static");
                self.token("{");
                self.block_content(node.a);
                self.token("}");
            }
            _ => {
                self.index_signature(id);
                self.semicolon();
            }
        }
    }

    fn field_may_need_semicolon(&self, field: &Node) -> bool {
        let members = self.list(field.parent);
        let after = members.partition_point(|&it| self.node(it).start <= field.start);
        let next = self.node(members.get(after).copied().unwrap_or(NONE));
        matches!(self.node(field.a).op, T::Static | T::Get | T::Set)
            || next.kind == K::IndexSignature
            || next.has(flag::COMPUTED)
            || matches!(self.node(next.a).op, T::In | T::Instanceof)
            || (next.kind == K::Method && self.node(next.b).has(flag::STAR))
    }

    pub(super) fn grouped_parameters_with_return_type_for_method(&mut self, function: Id) {
        self.type_parameters(self.node(function).b, None);
        let params = self.params(function);
        let modifiers = flag::ACCESSIBILITY | flag::OVERRIDE | flag::READONLY;
        match params.len() > 1 && params.iter().any(|&it| self.node(it).has(modifiers)) {
            true => self.group(|e| e.group_with(true, None, |e| e.formal_parameters(function))),
            false => self.grouped_parameters_and_return_type(function),
        }
    }

    pub(super) fn interface_declaration(&mut self, id: Id) {
        let node = self.node(id);
        let extends = self.tree.list_of(node);
        let is_grouped = match *extends {
            [] => false,
            [only] => self.is_bare_qualified_name(only),
            _ => true,
        };
        self.group(|e| {
            e.token_if(node.has(flag::DECLARE), "declare ");
            e.keyword("interface");
            e.group_if(is_grouped, |e| {
                e.source_of(node.a);
                e.type_parameters(node.b, None);
                e.indent_if(is_grouped, |e| {
                    e.heritage_clause("extends", extends, extends.len() > 1, is_grouped);
                });
            });
            e.space();
            e.token("{");
            match e.node(node.c).len {
                0 => _ = e.block_content(node.c),
                _ => e.block_indent(|e| e.signatures(node.c)),
            }
            e.token("}");
        });
    }

    pub(super) fn type_alias_declaration(&mut self, id: Id) {
        let node = self.node(id);
        let ty = self.node(node.c);
        let is_generic = |id: Id| {
            let node = self.node(id);
            node.b != NONE
                && (node.kind == K::TypeRef || (node.kind == K::FnType && node.op != T::New))
        };
        let breaks_after_operator = match ty.kind {
            K::Union => !self.is_oxfmt && !self.should_hug_union(node.c),
            K::Conditional => is_generic(ty.a) || is_generic(ty.b),
            _ => false,
        };
        let params = self.list(node.b);
        let has_bound = |&it: &Id| self.node(it).b != NONE || self.node(it).c != NONE;
        let breaks_left_side =
            !breaks_after_operator && params.len() > 1 && params.iter().any(has_bound);
        self.group(|e| {
            e.group_if(!breaks_left_side, |e| {
                e.token_if(node.has(flag::DECLARE), "declare ");
                e.token("type ");
                e.source_of(node.a);
                e.type_parameters(node.b, None);
            });
            e.space();
            e.token("=");
            if breaks_after_operator {
                e.group(|e| {
                    e.soft_line_indent_or_space(|e| match ty.kind {
                        K::Union => e.shortcut(node.c, |e| e.union_type(node.c, true)),
                        _ => e.ty(node.c),
                    });
                });
            } else if breaks_left_side {
                e.space();
                e.group(|e| e.ty(node.c));
            } else if e.is_oxfmt && ty.kind == K::Union {
                e.space();
                e.ty(node.c);
            } else {
                let group_id = e.group_id();
                e.indented_line_group(group_id);
                e.boundary();
                e.indent_if_group_breaks(group_id, |e| e.ty(node.c));
            }
        });
        self.semicolon();
    }

    pub(super) fn enum_declaration(&mut self, id: Id) {
        let node = self.node(id);
        if node.len == 0 {
            return self.give_up();
        }
        self.token_if(node.has(flag::DECLARE), "declare ");
        self.token_if(node.has(flag::CONST), "const ");
        self.keyword("enum");
        self.source_of(node.a);
        self.space();
        self.token("{");
        self.block_indent(|e| {
            e.comma_separated_nodes(id, Some(FormatTrailingCommas::ES5), |e, member| {
                e.key(member);
                if e.node(member).b != NONE {
                    e.space();
                    e.keyword("=");
                    e.expr(e.node(member).b);
                }
            });
        });
        self.token("}");
    }

    pub(super) fn module_declaration(&mut self, id: Id) {
        let node = self.node(id);
        self.token_if(node.has(flag::DECLARE), "declare ");
        match node.op {
            T::Global => self.token("global"),
            T::Module => {
                self.keyword("module");
                self.string(node.a);
            }
            _ => {
                self.keyword("namespace");
                self.source_of(node.a);
            }
        }
        self.space();
        self.token("{");
        self.block_content(node.b);
        self.token("}");
    }
}
