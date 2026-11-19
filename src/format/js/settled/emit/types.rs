use super::*;

impl Emitter<'_, '_> {
    #[inline]
    pub(super) fn type_annotation(&mut self, ty: Id) {
        if ty != NONE {
            self.keyword(":");
            self.ty(ty);
        }
    }

    #[inline]
    pub(super) fn ty(&mut self, id: Id) {
        let node = self.node(id);
        match node.kind {
            K::TypeKeyword => self.source(node.start, node.end),
            K::TypeRef if node.b == NONE => self.entity_name(node.a),
            _ => self.compound_type(id),
        }
    }

    fn entity_name(&mut self, id: Id) {
        let node = self.node(id);
        if node.kind != K::QualifiedName {
            return self.source(node.start, node.end);
        }
        self.entity_name(node.a);
        self.token(".");
        self.source_of(node.b);
    }

    fn compound_type(&mut self, id: Id) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        let node = self.node(id);
        let needs_parentheses = self.type_needs_parentheses(id, node);
        self.token_if(needs_parentheses, "(");
        match node.kind == K::TypeLiteral && self.should_hug_type_literal(id) {
            true => self.object_like(id),
            false => self.shortcut(id, |e| e.bare_type(id)),
        }
        self.token_if(needs_parentheses, ")");
    }

    fn bare_type(&mut self, id: Id) {
        let node = self.node(id);
        match node.kind {
            K::TypeRef => {
                self.entity_name(node.a);
                self.type_arguments(node.b);
            }
            K::LiteralType => self.expr_without_shortcut(node.a),
            K::ArrayType => {
                self.ty(node.a);
                self.token("[]");
            }
            K::Union => self.union_type(id, false),
            K::Intersection => self.group(|e| e.intersection_types(id)),
            K::TypeLiteral => self.object_like(id),
            K::FnType => self.group_if(node.op == T::New, |e| {
                e.token_if(node.has(flag::ABSTRACT), "abstract ");
                e.keyword_if(node.op == T::New, "new");
                e.group(|e| e.signature(id));
            }),
            K::IndexedAccess => {
                self.ty(node.a);
                self.token("[");
                self.ty(node.b);
                self.token("]");
            }
            K::TypeOperator => {
                self.keyword(match node.op {
                    T::Keyof => "keyof",
                    T::Readonly => "readonly",
                    _ => "unique",
                });
                self.ty(node.a);
            }
            K::TypeQuery => {
                self.token("typeof ");
                self.entity_name(node.a);
                self.type_arguments(node.b);
            }
            K::Tuple => self.tuple_type(id),
            K::Conditional => self.conditional_like(id, false),
            K::Infer => {
                self.keyword("infer");
                self.type_parameter(node.a);
            }
            K::Mapped => self.mapped_type(id),
            K::TemplateType => self.template_like(id),
            K::Predicate => {
                self.token_if(node.has(flag::ASSERTS), "asserts ");
                self.source_of(node.a);
                if node.b != NONE {
                    self.space();
                    self.keyword("is");
                    self.ty(node.b);
                }
            }
            K::ImportType => {
                self.token_if(node.has(flag::TYPEOF), "typeof ");
                self.token("import(");
                self.string(node.a);
                self.token(")");
                if node.b != NONE {
                    self.token(".");
                    self.entity_name(node.b);
                }
                self.type_arguments(node.c);
            }
            K::NamedElement => {
                self.token_if(node.has(flag::REST), "...");
                self.source_of(node.a);
                self.token_if(node.has(flag::OPTIONAL), "?");
                self.type_annotation(node.b);
            }
            K::RestType => {
                self.token("...");
                self.ty(node.a);
            }
            K::OptionalType => {
                self.ty(node.a);
                self.token("?");
            }
            _ => self.give_up(),
        }
    }

    pub(super) fn should_hug_union(&self, id: Id) -> bool {
        let mut objects = 0;
        self.list(id).iter().all(|&it| {
            let node = self.node(it);
            match node.kind {
                K::TypeLiteral | K::TypeRef => {
                    objects += 1;
                    node.kind == K::TypeRef || node.len > 0 || !node.has(flag::COMMENT)
                }
                kind => kind == K::TypeKeyword && matches!(node.op, T::Void | T::Null),
            }
        }) && objects == 1
            && !self.has_comments_around_items(id)
    }

    fn union_members(&mut self, id: Id) {
        let node = self.node(id);
        let types = self.tree.list_of(node);
        for (i, &ty) in types.iter().enumerate() {
            if i > 0 {
                self.line();
                self.token("| ");
            }
            self.align(2, |e| e.ty(ty));
            if node.has(flag::COMMENT) {
                self.comments_after_union_member(node, ty, types.get(i + 1));
            }
        }
    }

    pub(super) fn union_type(&mut self, id: Id, is_indented_by_parent: bool) {
        let node = self.node(id);
        let types = self.tree.list_of(node);
        if self.should_hug_union(id) {
            for (i, &ty) in types.iter().enumerate() {
                self.token_if(i > 0, " | ");
                self.ty(ty);
            }
            return;
        }
        let parent = self.node(node.parent);
        let needs_parentheses = self.type_needs_parentheses(id, node);
        let is_one_of_several_elements = parent.kind == K::Tuple && parent.len > 1;
        let should_indent = match parent.kind {
            K::Tuple | K::TypeArgs => false,
            K::Conditional => self.is_oxfmt || (parent.c != id && parent.d != id),
            _ => !is_indented_by_parent,
        };
        let printed = |e: &mut Self| {
            e.group_if(!e.is_oxfmt, |e| {
                match should_indent && e.is_oxfmt {
                    true => e.if_breaks(None, |e| {
                        e.line();
                        e.token("| ");
                    }),
                    false => e.token_if_breaks("| "),
                }
                e.union_members(id);
            });
        };
        let content = |e: &mut Self| {
            if needs_parentheses {
                e.indent(|e| {
                    if !e.is_oxfmt {
                        e.soft_line();
                    }
                    printed(e);
                });
                e.soft_line();
            } else if is_one_of_several_elements {
                e.indent(|e| {
                    e.if_breaks(None, |e| {
                        e.token("(");
                        e.soft_line();
                    });
                    printed(e);
                });
                e.soft_line();
                e.token_if_breaks(")");
            } else {
                printed(e);
            }
        };
        if self.is_oxfmt {
            let is_indented = should_indent && !needs_parentheses;
            self.group(|e| e.indent_if(is_indented, |e| e.group(content)));
        } else if needs_parentheses || is_one_of_several_elements {
            self.group(content);
        } else if should_indent {
            self.group(|e| {
                e.indent(|e| {
                    e.soft_line();
                    printed(e);
                });
            });
        } else {
            printed(self);
        }
    }

    fn intersection_types(&mut self, id: Id) {
        let (mut is_previous_object, mut is_chain_indented) = (false, false);
        for (i, &ty) in self.list(id).iter().enumerate() {
            let is_object = matches!(self.kind(ty), K::TypeLiteral | K::Mapped);
            if i == 0 {
                self.ty(ty);
            } else if !is_previous_object && !is_object {
                self.indent(|e| {
                    e.token(" &");
                    e.line();
                    e.ty(ty);
                });
            } else {
                is_chain_indented |= is_previous_object != is_object && i > 1;
                self.token(" & ");
                self.indent_if(is_chain_indented, |e| e.ty(ty));
            }
            is_previous_object = is_object;
        }
    }

    fn tuple_type(&mut self, id: Id) {
        self.token("[");
        if self.node(id).len > 0 {
            self.group(|e| {
                e.soft_block_indent(|e| {
                    e.comma_separated_nodes(id, Some(FormatTrailingCommas::ES5), Self::ty);
                });
            });
        }
        self.token("]");
    }

    fn mapped_type(&mut self, id: Id) {
        let node = self.node(id);
        let mode = if !self.preserves_expanded_objects() {
            GroupMode::Flat
        } else if self.source_text().has_line_terminator_after(node.start + 1) {
            GroupMode::Expand
        } else {
            GroupMode::StaysExpanded
        };
        self.token("{");
        self.start_group_of(mode, None);
        self.soft_block_indent_with_space(self.has_bracket_spacing(), |e| {
            e.token_if(node.op == T::Plus, "+");
            e.token_if(node.op == T::Minus, "-");
            e.keyword_if(node.has(flag::READONLY), "readonly");
            e.group(|e| {
                e.token("[");
                e.soft_block_indent(|e| {
                    e.source_of(node.a);
                    e.token(" in ");
                    e.ty(node.b);
                    if node.c != NONE {
                        e.token(" as ");
                        e.ty(node.c);
                    }
                });
                e.token("]");
            });
            e.token_if(node.has(flag::IN), "+");
            e.token_if(node.has(flag::OUT), "-");
            e.token_if(node.has(flag::OPTIONAL), "?");
            e.type_annotation(node.d);
            if e.has_semicolons {
                e.token_if_breaks(";");
            }
        });
        self.end_group();
        self.token("}");
    }

    pub(super) fn index_signature(&mut self, id: Id) {
        let node = self.node(id);
        self.keyword_if(node.has(flag::STATIC), "static");
        self.keyword_if(node.has(flag::READONLY), "readonly");
        self.token("[");
        self.group(|e| {
            e.soft_block_indent(|e| {
                e.source_of(e.node(node.a).a);
                e.type_annotation(e.node(node.a).b);
            });
        });
        self.token("]");
        self.type_annotation(node.b);
    }

    /// The members of an interface or a type literal.
    pub(super) fn signatures(&mut self, owner: Id) {
        self.items(
            owner,
            self.node(owner).start,
            |e, _, next, comment| match e.has_empty_line_before(next, comment) {
                true => e.line_of(LineMode::Empty),
                false => e.line(),
            },
            |e, member| e.shortcut(member, |e| e.type_member(member)),
            |e, _, is_last| match (e.has_semicolons, is_last) {
                (true, false) => e.token(";"),
                (true, true) => e.token_if_breaks(";"),
                (false, false) => e.token_if_fits(";"),
                (false, true) => {}
            },
        );
    }

    fn type_member(&mut self, id: Id) {
        let node = self.node(id);
        match node.kind {
            K::PropertySignature => {
                self.token_if(node.has(flag::READONLY), "readonly ");
                self.key(id);
                self.token_if(node.has(flag::OPTIONAL), "?");
                self.type_annotation(node.b);
            }
            K::IndexSignature => self.index_signature(id),
            K::CallSignature => self.group_if(node.op == T::New, |e| {
                e.keyword_if(node.op == T::New, "new");
                e.group(|e| e.signature(node.b));
            }),
            _ => self.group(|e| {
                e.method_prefix(node);
                e.key(id);
                e.token_if(node.has(flag::OPTIONAL), "?");
                e.signature(node.b);
            }),
        }
    }
}
