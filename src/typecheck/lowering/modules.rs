// Imports and exports: the tokens decide, as in the reference. Bun's tree says only which statement starts.
use super::{Lowerer, Lowering, token_is_identifier_or_keyword};
use crate::ast::{Kind, ModifierListId, NodeFactory, NodeFlags, NodeId, NodeListId, TokenFlags};
use crate::diagnostics;
use bun_ast::Expr;

impl<'t> Lowerer<'t, '_> {
    // parseExportAssignment: `export default` before an expression
    pub(super) fn lower_export_assignment(&mut self, value: &'t Expr) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::ExportKeyword)?;
        let save_context_flags = self.context_flags;
        let save_has_await_identifier = self.statement_has_await_identifier;
        self.set_context_flags(NodeFlags::AWAIT_CONTEXT, true);
        self.expect(Kind::DefaultKeyword)?;
        let expression = self.lower_assignment_expression(value)?;
        self.parse_semicolon()?;
        self.context_flags = save_context_flags;
        self.statement_has_await_identifier = save_has_await_identifier;
        let result =
            self.b
                .new_export_assignment(ModifierListId::NIL, false, NodeId::NIL, expression);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseModuleSpecifier: Bun takes a string or a template without substitutions.
    fn lower_module_specifier(&mut self) -> Lowering<NodeId> {
        if self.token == Kind::NoSubstitutionTemplateLiteral
            && self
                .scanner
                .token_flags()
                .intersects(TokenFlags::IS_INVALID)
        {
            self.re_scan_template_token(false);
        }
        if self.token == Kind::StringLiteral || self.token == Kind::NoSubstitutionTemplateLiteral {
            return self.parse_literal_expression();
        }
        Err(self.out_of_step("a module specifier"))
    }

    // parseModuleExportName
    fn lower_module_export_name(&mut self) -> Lowering<NodeId> {
        if self.token == Kind::StringLiteral {
            return self.parse_literal_expression();
        }
        self.create_identifier()
    }

    fn can_parse_module_export_name(&self) -> bool {
        token_is_identifier_or_keyword(self.token) || self.token == Kind::StringLiteral
    }

    // parseImportOrExportSpecifier: whether it is type-only, the property name, the name
    fn lower_import_or_export_specifier(&mut self) -> Lowering<(bool, NodeId, NodeId)> {
        let mut is_type_only = false;
        let mut property_name = NodeId::NIL;
        let mut can_parse_as_keyword = true;
        let starts_with_type =
            self.token != Kind::StringLiteral && self.scanner.token_value() == b"type";
        let mut name = self.lower_module_export_name()?;
        if starts_with_type {
            // If the first token of an import specifier is 'type', there are a lot of possibilities, especially if we see 'as' afterwards.
            if self.token == Kind::AsKeyword {
                // { type as ...? }
                let first_as = self.create_identifier()?;
                if self.token == Kind::AsKeyword {
                    // { type as as ...? }
                    let second_as = self.create_identifier()?;
                    if self.can_parse_module_export_name() {
                        // { type as as something }
                        is_type_only = true;
                        property_name = first_as;
                        name = self.lower_module_export_name()?;
                        can_parse_as_keyword = false;
                    } else {
                        // { type as as }
                        property_name = name;
                        name = second_as;
                        can_parse_as_keyword = false;
                    }
                } else if self.can_parse_module_export_name() {
                    // { type as something }
                    property_name = name;
                    can_parse_as_keyword = false;
                    name = self.lower_module_export_name()?;
                } else {
                    // { type as }
                    is_type_only = true;
                    name = first_as;
                }
            } else if self.can_parse_module_export_name() {
                // { type something ...? }
                is_type_only = true;
                name = self.lower_module_export_name()?;
            }
        }
        if can_parse_as_keyword && self.token == Kind::AsKeyword {
            property_name = name;
            self.expect(Kind::AsKeyword)?;
            name = self.lower_module_export_name()?;
        }
        Ok((is_type_only, property_name, name))
    }

    // parseBracketedList(PCImportOrExportSpecifiers, ...) with parseImportSpecifier or parseExportSpecifier
    fn lower_specifier_list(&mut self, is_import: bool) -> Lowering<NodeListId> {
        self.expect(Kind::OpenBraceToken)?;
        let pos = self.node_pos();
        let mut nodes: Vec<NodeId> = Vec::new();
        while self.token != Kind::CloseBraceToken {
            if !self.can_parse_module_export_name() {
                return Err(self.out_of_step("a specifier of an import or export clause"));
            }
            let specifier_pos = self.node_pos();
            let jsdoc = self.jsdoc_scanner_info();
            let (is_type_only, property_name, name) = self.lower_import_or_export_specifier()?;
            let node = if is_import {
                if self.b.kind(name) != Kind::Identifier {
                    return Err(self.out_of_step("the name of an import specifier"));
                }
                let node = self
                    .b
                    .new_import_specifier(is_type_only, property_name, name);
                self.finish(node, specifier_pos)
            } else {
                let node = self
                    .b
                    .new_export_specifier(is_type_only, property_name, name);
                self.finish(node, specifier_pos);
                self.with_jsdoc(node, jsdoc);
                node
            };
            nodes.push(node);
            if !self.optional(Kind::CommaToken) {
                break;
            }
        }
        let end = self.node_pos();
        let list = self.new_list(pos, end, &nodes);
        self.expect(Kind::CloseBraceToken)?;
        Ok(list)
    }

    // tryParseImportAttributes and parseImportAttributes: Bun reads them on the line of the module specifier, with string values.
    fn lower_import_attributes(&mut self) -> Lowering<NodeId> {
        if (self.token != Kind::WithKeyword && self.token != Kind::AssertKeyword)
            || self.has_preceding_line_break()
        {
            return Ok(NodeId::NIL);
        }
        let token = self.token;
        if token == Kind::AssertKeyword {
            self.parse_error_at_current_token(
                diagnostics::IMPORT_ASSERTIONS_HAVE_BEEN_REPLACED_BY_IMPORT_ATTRIBUTES_USE_WITH_INSTEAD_OF_ASSERT,
                &[],
            );
        }
        let pos = self.node_pos();
        self.next_token();
        self.expect(Kind::OpenBraceToken)?;
        let multi_line = self.has_preceding_line_break();
        let elements_pos = self.node_pos();
        let mut elements: Vec<NodeId> = Vec::new();
        while self.token != Kind::CloseBraceToken {
            // parseImportAttribute
            let attribute_pos = self.node_pos();
            let name = if self.token == Kind::StringLiteral {
                self.parse_literal_expression()?
            } else {
                self.create_identifier()?
            };
            self.expect(Kind::ColonToken)?;
            if self.token != Kind::StringLiteral {
                return Err(self.out_of_step("the value of an import attribute"));
            }
            let value = self.parse_literal_expression()?;
            let attribute = self.b.new_import_attribute(name, value);
            elements.push(self.finish(attribute, attribute_pos));
            if !self.optional(Kind::CommaToken) {
                break;
            }
        }
        let elements_end = self.node_pos();
        let elements = self.new_list(elements_pos, elements_end, &elements);
        self.expect(Kind::CloseBraceToken)?;
        let node = self.b.new_import_attributes(token, elements, multi_line);
        Ok(self.finish(node, pos))
    }

    // parseImportDeclarationOrImportEqualsDeclaration
    pub(super) fn lower_import_declaration(&mut self) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::ImportKeyword)?;
        let after_import_pos = self.node_pos();
        // We don't parse the identifier here in await context, instead we will report a grammar error in the checker.
        let save_has_await_identifier = self.statement_has_await_identifier;
        let mut identifier = NodeId::NIL;
        let mut is_type = false;
        let mut is_defer = false;
        if self.is_identifier() {
            is_type = self.scanner.token_value() == b"type";
            is_defer = self.scanner.token_value() == b"defer";
            identifier = self.create_identifier()?;
        }
        let mut phase_modifier = Kind::Unknown;
        if is_type
            && (self.token != Kind::FromKeyword
                || self.is_identifier()
                    && self.look_ahead(|this| {
                        this.next_token();
                        this.token == Kind::FromKeyword || this.token == Kind::EqualsToken
                    }))
            && (self.is_identifier()
                || self.token == Kind::AsteriskToken
                || self.token == Kind::OpenBraceToken)
        {
            phase_modifier = Kind::TypeKeyword;
            identifier = NodeId::NIL;
            if self.is_identifier() {
                identifier = self.create_identifier()?;
            }
        } else if is_defer {
            let should_parse_as_defer_modifier = if self.token == Kind::FromKeyword {
                !self.look_ahead(|this| this.next_token() == Kind::StringLiteral)
            } else {
                self.token != Kind::CommaToken && self.token != Kind::EqualsToken
            };
            if should_parse_as_defer_modifier {
                phase_modifier = Kind::DeferKeyword;
                identifier = NodeId::NIL;
                if self.is_identifier() {
                    identifier = self.create_identifier()?;
                }
            }
        }
        if !identifier.is_nil()
            && self.token != Kind::CommaToken
            && self.token != Kind::FromKeyword
            && phase_modifier != Kind::DeferKeyword
        {
            return Err(self.unsupported("an import equals declaration"));
        }
        // tryParseImportClause
        let mut import_clause = NodeId::NIL;
        if !identifier.is_nil()
            || self.token == Kind::AsteriskToken
            || self.token == Kind::OpenBraceToken
        {
            import_clause =
                self.lower_import_clause(identifier, after_import_pos, phase_modifier)?;
            self.expect(Kind::FromKeyword)?;
        }
        // import clause is always parsed in an Await context
        self.statement_has_await_identifier = save_has_await_identifier;
        let module_specifier = self.lower_module_specifier()?;
        let attributes = self.lower_import_attributes()?;
        self.parse_semicolon()?;
        let result = self.b.new_import_declaration(
            ModifierListId::NIL,
            import_clause,
            module_specifier,
            attributes,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseImportClause, parseNamespaceImport and parseNamedImports
    fn lower_import_clause(
        &mut self,
        identifier: NodeId,
        pos: i32,
        phase_modifier: Kind,
    ) -> Lowering<NodeId> {
        // If there was no default import or if there is comma token after default import parse namespace or named imports
        let mut named_bindings = NodeId::NIL;
        let save_has_await_identifier = self.statement_has_await_identifier;
        if identifier.is_nil() || self.optional(Kind::CommaToken) {
            let bindings_pos = self.node_pos();
            let bindings = if self.token == Kind::AsteriskToken {
                self.next_token();
                self.expect(Kind::AsKeyword)?;
                let name = self.create_identifier()?;
                self.b.new_namespace_import(name)
            } else {
                let imports = self.lower_specifier_list(true)?;
                self.b.new_named_imports(imports)
            };
            named_bindings = self.finish(bindings, bindings_pos);
        }
        let result = self
            .b
            .new_import_clause(phase_modifier, identifier, named_bindings);
        self.finish(result, pos);
        self.statement_has_await_identifier = save_has_await_identifier;
        Ok(result)
    }

    // parseExportDeclaration, from the `export` that parseDeclarationWorker reads
    pub(super) fn lower_export_declaration(&mut self) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::ExportKeyword)?;
        let save_context_flags = self.context_flags;
        let save_has_await_identifier = self.statement_has_await_identifier;
        self.set_context_flags(NodeFlags::AWAIT_CONTEXT, true);
        let mut export_clause = NodeId::NIL;
        let mut module_specifier = NodeId::NIL;
        let namespace_export_pos = self.node_pos();
        if self.optional(Kind::AsteriskToken) {
            if self.optional(Kind::AsKeyword) {
                // parseNamespaceExport
                let export_name = self.lower_module_export_name()?;
                let namespace_export = self.b.new_namespace_export(export_name);
                export_clause = self.finish(namespace_export, namespace_export_pos);
            }
            self.expect(Kind::FromKeyword)?;
            module_specifier = self.lower_module_specifier()?;
        } else {
            // parseNamedExports
            let exports = self.lower_specifier_list(false)?;
            let named_exports = self.b.new_named_exports(exports);
            export_clause = self.finish(named_exports, namespace_export_pos);
            // If we don't have a 'from' keyword, see if we have a string literal such that ASI won't take effect.
            if self.token == Kind::FromKeyword
                || self.token == Kind::StringLiteral && !self.has_preceding_line_break()
            {
                self.expect(Kind::FromKeyword)?;
                module_specifier = self.lower_module_specifier()?;
            }
        }
        let attributes = if module_specifier.is_nil() {
            NodeId::NIL
        } else {
            self.lower_import_attributes()?
        };
        self.parse_semicolon()?;
        self.context_flags = save_context_flags;
        self.statement_has_await_identifier = save_has_await_identifier;
        let result = self.b.new_export_declaration(
            ModifierListId::NIL,
            false,
            export_clause,
            module_specifier,
            attributes,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }
}
