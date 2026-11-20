//! Imports and exports.

use super::*;

impl Emitter<'_, '_> {
    fn specifier(&mut self, id: Id) {
        let node = self.node(id);
        self.token_if(node.has(flag::TYPE_ONLY), "type ");
        self.source_of(node.a);
        if node.b != NONE {
            self.space();
            self.keyword("as");
            self.source_of(node.b);
        }
    }

    fn specifiers(&mut self, id: Id, are_alone: bool) {
        let has_space = self.has_bracket_spacing();
        self.token("{");
        match *self.list(id) {
            [] => {}
            [only] if are_alone && !self.node(id).has(flag::COMMENT) => {
                self.token_if(has_space, " ");
                self.specifier(only);
                self.token_if(has_space, " ");
            }
            _ => self.group(|e| {
                e.soft_block_indent_with_space(has_space, |e| {
                    e.comma_separated(id, Some(FormatTrailingCommas::ES5), Self::specifier);
                });
            }),
        }
        self.token("}");
    }

    fn source_and_semicolon(&mut self, source: Id) {
        self.string(source);
        if let [value] = *self.list(self.node(source).parent) {
            let has_space = self.has_bracket_spacing();
            self.token(" with {");
            self.token_if(has_space, " ");
            self.token("type: ");
            self.string(value);
            self.token_if(has_space, " ");
            self.token("}");
        }
        self.semicolon();
    }

    pub(super) fn import_declaration(&mut self, id: Id) {
        let node = self.node(id);
        if (node.has(flag::COMMENT) || node.len > 0) && self.f.options().sort_imports.is_some() {
            return self.give_up();
        }
        self.token("import ");
        self.token_if(node.has(flag::TYPE_ONLY), "type ");
        if node.a != NONE {
            self.source_of(node.a);
            if node.b != NONE || self.node(node.c).len > 0 {
                self.keyword(",");
            }
        }
        if node.b != NONE {
            self.token("* as ");
            self.source_of(node.b);
        } else if node.c != NONE && (node.a == NONE || self.node(node.c).len > 0) {
            self.specifiers(node.c, node.a == NONE);
        }
        self.token_if(node.op != T::Str, " from ");
        self.source_and_semicolon(node.d);
    }

    pub(super) fn export_named_declaration(&mut self, id: Id) {
        let node = self.node(id);
        self.token("export ");
        self.token_if(node.has(flag::TYPE_ONLY), "type ");
        self.specifiers(node.c, true);
        if node.d == NONE {
            return self.semicolon();
        }
        self.space();
        self.keyword("from");
        self.source_and_semicolon(node.d);
    }

    pub(super) fn export_all_declaration(&mut self, id: Id) {
        let node = self.node(id);
        self.keyword("export");
        self.token_if(node.has(flag::TYPE_ONLY), "type ");
        self.keyword("*");
        if node.a != NONE {
            self.keyword("as");
            self.source_of(node.a);
            self.space();
        }
        self.keyword("from");
        self.source_and_semicolon(node.d);
    }

    pub(super) fn export_default_declaration(&mut self, id: Id) {
        let value = self.node(id).a;
        self.token("export default ");
        if self.node(value).has(flag::DECLARATION) || self.kind(value) == K::Interface {
            return self.statement(value);
        }
        self.expr(value);
        self.semicolon();
    }

    pub(super) fn exported_declaration(&mut self, id: Id) {
        let declaration = self.node(id).a;
        self.keyword("export");
        self.statement(declaration);
        if self.kind(declaration) == K::Var {
            self.semicolon();
        }
    }
}
