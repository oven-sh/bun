//! Import and export declarations.

use super::stmt::Start;
use super::{ListKind, Parser, ctx, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::Atom;
use bun_sema::hir::*;

/// A name in an import or export specifier.
#[derive(Copy, Clone)]
struct ExportName {
    text: Atom,
    pos: u32,
    token: T,
}

/// `ImportSpecifier`, `ExportSpecifier`
struct Specifier {
    start: u32,
    is_type_only: bool,
    property_name: Option<ExportName>,
    name: ExportName,
    end: u32,
}

impl Parser<'_> {
    /// `parseModuleSpecifier`, and the import attributes after it: the text, which is recorded as a
    /// reference to that module.
    /// `is_type_only`: after `import type` or `export type`, the only declarations whose
    /// `resolution-mode` is honored.
    fn module_specifier(
        &mut self,
        kind: SpecifierKind,
        is_export: bool,
        is_type_only: bool,
    ) -> (Atom, ResolutionMode) {
        if self.token() != T::String {
            self.refuse(Refusal::Reported);
            return (Atom::NONE, ResolutionMode::None);
        }
        let (spec, pos) = (self.lx.atom, self.pos());
        self.next();
        let mut mode = ResolutionMode::None;
        // After an import, `with` can be on the next line. After an export it starts a statement
        // there.
        if self.token() == T::With && !(is_export && self.newline_before() && !self.is_ecmascript) {
            mode = self.import_attributes(false);
        } else if self.token() == T::Assert && !self.newline_before() {
            // An error of the native parser.
            match self.options.dialect.typescript_5 {
                true => self.flag(
                    DiagnosticKind::Grammar,
                    2880,
                    (self.lx.start, self.lx.end),
                    &[],
                ),
                false => self.report(),
            }
            mode = self.import_attributes(false);
        }
        if !is_type_only {
            mode = ResolutionMode::None;
        }
        self.f.specifier_uses.push(SpecifierUse {
            spec,
            pos,
            kind,
            mode,
        });
        (spec, mode)
    }

    /// `parseImportAttributes`, at `with`: they are kept as an object literal. Returns
    /// `getResolutionModeOverride`. `is_in_type`: in `import("a", { with: { .. } })`, where a colon
    /// follows the keyword.
    pub(crate) fn import_attributes(&mut self, is_in_type: bool) -> ResolutionMode {
        let keyword = self.pos();
        self.next();
        if is_in_type {
            self.expect(T::Colon);
        }
        let open = self.pos();
        self.expect(T::OpenBrace);
        let base = self.s.props.len();
        let mut mode = ResolutionMode::None;
        while self.is_in_list(T::CloseBrace) {
            let pos = self.pos();
            let token = self.token();
            if token != T::String
                && (!token.is_identifier_or_keyword() || token == T::PrivateIdentifier)
            {
                self.fail();
                break;
            }
            let key = self.lx.atom;
            self.next();
            self.expect(T::Colon);
            if self.token() != T::String {
                self.refuse(Refusal::Reported);
            }
            let text = self.lx.atom;
            let value = self.add_expr(ExprKind::String(text), self.lx.start, self.lx.end);
            self.next();
            if self.lx.text_of(key) == b"resolution-mode" {
                mode = match self.lx.text_of(text) {
                    b"import" => ResolutionMode::Import,
                    b"require" => ResolutionMode::Require,
                    _ => ResolutionMode::None,
                };
            }
            self.s.props.push(Prop {
                kind: PropKind::Init,
                key: PropKey::Name(key),
                name_kind: NameKind::Identifier,
                value,
                pos,
                start: pos,
                end: self.prev_end(),
                postfix_token: 0,
            });
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.expect(T::CloseBrace);
        // Only if it is the only attribute.
        if self.s.props.len() != base + 1 {
            mode = ResolutionMode::None;
        }
        let props = take_span!(self, props, base);
        let object = self.finish_expr(ExprKind::Object(props), open);
        self.f.import_attributes.push((keyword, object));
        mode
    }

    /// `canParseModuleExportName`
    fn can_parse_module_export_name(&self) -> bool {
        self.token().is_identifier_or_keyword() || self.token() == T::String
    }

    /// `parseModuleExportName`
    fn module_export_name(&mut self) -> ExportName {
        if !self.can_parse_module_export_name() {
            self.fail();
        }
        let name = ExportName {
            text: self.lx.atom,
            pos: self.pos(),
            token: self.token(),
        };
        self.next();
        name
    }

    /// `parseImportOrExportSpecifier`
    fn import_or_export_specifier(&mut self) -> Specifier {
        let start = self.pos();
        let (mut is_type_only, mut property_name, mut can_parse_as) = (false, None, true);
        let mut name = self.module_export_name();
        if name.token == T::Type || name.token == T::TypeOf && self.is_flow {
            // "If the first token of an import specifier is 'type', there are a lot of
            // possibilities"
            if self.token() == T::As {
                let first_as = self.module_export_name();
                if self.token() == T::As {
                    let second_as = self.module_export_name();
                    can_parse_as = false;
                    if self.can_parse_module_export_name() {
                        // "{ type as as something }"
                        is_type_only = true;
                        property_name = Some(first_as);
                        name = self.module_export_name();
                    } else {
                        // "{ type as as }"
                        property_name = Some(name);
                        name = second_as;
                    }
                } else if self.can_parse_module_export_name() {
                    // "{ type as something }"
                    property_name = Some(name);
                    can_parse_as = false;
                    name = self.module_export_name();
                } else {
                    // "{ type as }"
                    is_type_only = true;
                    name = first_as;
                }
            } else if self.can_parse_module_export_name() {
                // "{ type something ...? }"
                is_type_only = true;
                name = self.module_export_name();
            }
        }
        if can_parse_as && self.token() == T::As {
            property_name = Some(name);
            self.next();
            name = self.module_export_name();
        }
        Specifier {
            start,
            is_type_only,
            property_name,
            name,
            end: self.prev_end(),
        }
    }

    /// `parseImportDeclarationOrImportEqualsDeclaration`
    pub(crate) fn import_declaration_or_import_equals(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
    ) -> StmtId {
        self.next();
        let clause_start = self.pos();
        let mut identifier = None;
        if self.is_identifier() || self.token() == T::TypeOf && self.is_flow {
            identifier = Some((self.lx.atom, self.pos(), self.token()));
            self.next();
        }
        let (mut type_only, mut is_deferred) = (false, false);
        if let Some((_, _, T::Type | T::TypeOf)) = identifier {
            let is_modifier = (self.token() != T::From
                || self.is_identifier() && matches!(self.peek(), T::From | T::Equals))
                && (self.is_identifier() || matches!(self.token(), T::Asterisk | T::OpenBrace));
            if is_modifier {
                type_only = true;
                identifier = None;
                if self.is_identifier() {
                    identifier = Some((self.lx.atom, self.pos(), self.token()));
                    self.next();
                }
            }
        } else if let Some((name, _, token)) = identifier
            // For Babel `source` is a phase too. It is kept like `defer`: the text tells them apart.
            && (token == T::Defer
                || self.options.dialect.babel && self.lx.text_of(name) == b"source")
        {
            is_deferred = match self.token() {
                T::From => self.peek() != T::String,
                token => !matches!(token, T::Comma | T::Equals),
            };
            if is_deferred {
                // Only `import source x from "a"`.
                if token != T::Defer && !self.is_identifier() {
                    self.report();
                }
                identifier = None;
                if self.is_identifier() {
                    identifier = Some((self.lx.atom, self.pos(), self.token()));
                    self.next();
                }
            }
        }
        if let Some((name, name_pos, _)) = identifier
            && !matches!(self.token(), T::Comma | T::From)
        {
            return self.import_equals(start, base, flags, (name, name_pos), type_only);
        }
        // The checker reports them.
        let modifiers = self.take_modifiers(base);
        // `parseImportClause`
        let (mut default, mut default_pos) = (Atom::NONE, 0);
        if let Some((name, pos, _)) = identifier {
            (default, default_pos) = (name, pos);
        }
        let (mut namespace, mut namespace_pos, mut namespace_start) = (Atom::NONE, 0, 0);
        let specs = self.s.import_specs.len();
        let mut has_named_imports = false;
        let declaration = ImportId(self.f.imports.len() as u32);
        let has_clause = identifier.is_some() || matches!(self.token(), T::Asterisk | T::OpenBrace);
        if has_clause && (identifier.is_none() || self.eat(T::Comma)) {
            if self.token() == T::Asterisk {
                // `parseNamespaceImport`
                namespace_start = self.pos();
                self.next();
                self.expect(T::As);
                (namespace, namespace_pos) = (self.lx.atom, self.pos());
                if !self.is_identifier() {
                    self.fail();
                }
                self.next();
            } else {
                has_named_imports = true;
                let has_list = self.expect(T::OpenBrace);
                let lists = self.enter_list(ListKind::ImportOrExportSpecifiers);
                while has_list
                    && self.is_in_list(T::CloseBrace)
                    && self.is_at_element(ListKind::ImportOrExportSpecifiers)
                {
                    let element = self.full_start();
                    let specifier = self.import_or_export_specifier();
                    let name = specifier.name;
                    // The local name is an identifier that is not reserved.
                    if name.token == T::String || name.token.is_reserved_word() {
                        self.refuse(Refusal::Reported);
                    }
                    if specifier.is_type_only {
                        self.js_error((specifier.start, specifier.end), 8006, b"import...type");
                    }
                    let imported = specifier.property_name.unwrap_or(name);
                    self.s.import_specs.push(ImportSpec {
                        start: specifier.start,
                        imported: imported.text,
                        local: name.text,
                        pos: name.pos,
                        type_only: specifier.is_type_only,
                        imported_pos: imported.pos,
                        end: specifier.end,
                        import: declaration,
                    });
                    if !self.eat(T::Comma)
                        && !self.goes_on_without_comma(ListKind::ImportOrExportSpecifiers, element)
                    {
                        break;
                    }
                }
                self.lists = lists;
                if has_list {
                    self.expect(T::CloseBrace);
                }
            }
        }
        if is_deferred && !has_clause {
            self.report();
        }
        let clause_end = match has_clause {
            true => self.prev_end(),
            false => clause_start,
        };
        if has_clause {
            self.expect(T::From);
        }
        let kind = match has_clause {
            true => SpecifierKind::Import,
            false => SpecifierKind::SideEffect,
        };
        let (spec, mode) = self.module_specifier(kind, false, type_only);
        self.semicolon();
        // The reference notes the names in this order.
        for index in specs..self.s.import_specs.len() {
            let ImportSpec { local, pos, .. } = self.s.import_specs[index];
            self.note_identifier(local, pos);
        }
        if default.is_some() {
            self.note_identifier(default, default_pos);
        }
        if namespace.is_some() {
            self.note_identifier(namespace, namespace_pos);
        }
        let named = take_span!(self, import_specs, specs);
        let declaration = self.f.add_import(Import {
            spec,
            default,
            default_pos,
            namespace,
            namespace_pos,
            clause_start,
            clause_end,
            namespace_start,
            named,
            has_named_imports,
            type_only,
            is_deferred,
            mode,
            stmt: StmtId::NONE,
        });
        let statement = self.add_stmt(StmtKind::Import(declaration), start, modifiers);
        self.f[declaration].stmt = statement;
        statement
    }

    /// `parseImportEqualsDeclaration`, at the `=`.
    fn import_equals(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
        (name, name_pos): (Atom, u32),
        type_only: bool,
    ) -> StmtId {
        self.expect(T::Equals);
        let mut flags = flags & (Flags::EXPORT | Flags::AMBIENT) | self.ambient();
        if type_only {
            flags |= Flags::TYPE_ONLY;
        }
        // `parseModuleReference`
        let target = if self.token() == T::Require && self.peek() == T::OpenParen {
            self.next();
            self.next();
            if self.token() != T::String {
                self.refuse(Refusal::Reported);
            }
            let (spec, pos) = (self.lx.atom, self.pos());
            self.next();
            self.expect(T::CloseParen);
            self.f.specifier_uses.push(SpecifierUse {
                spec,
                pos,
                kind: SpecifierKind::Require,
                mode: ResolutionMode::None,
            });
            ImportEqualsTarget::Require(spec)
        } else {
            let names = self.s.names.len();
            loop {
                let part = self.identifier();
                self.s.names.push(part);
                if !self.eat(T::Dot) {
                    break;
                }
            }
            let written = self.s.names.get(names..).unwrap_or_default();
            let entity = self.f.entity_name(written.iter().copied());
            self.s.names.truncate(names);
            ImportEqualsTarget::Entity(entity)
        };
        self.semicolon();
        self.note_identifier(name, name_pos);
        let declaration = self.f.add_import_equals(ImportEquals {
            name,
            name_pos,
            target,
            expression: ExprId::NONE,
            flags,
            stmt: StmtId::NONE,
        });
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::ImportEquals(declaration), start, modifiers);
        self.f[declaration].stmt = statement;
        statement
    }

    /// `parseExportDeclaration`, after `export`.
    pub(crate) fn export_declaration(&mut self, start: Start, base: usize) -> StmtId {
        // The checker reports them. In Flow: `declare`
        let modifiers = self.take_modifiers(base);
        let type_only = self.eat(T::Type);
        if self.token() == T::Asterisk {
            let star_pos = self.pos();
            self.next();
            let (mut alias, mut alias_pos) = (Atom::NONE, self.pos());
            if self.eat(T::As) {
                let name = self.module_export_name();
                (alias, alias_pos) = (name.text, name.pos);
            }
            self.expect(T::From);
            let (spec, mode) = self.module_specifier(SpecifierKind::Import, true, type_only);
            self.semicolon();
            if alias.is_some() {
                self.note_identifier(alias, alias_pos);
            }
            let kind = StmtKind::ExportStar {
                spec,
                alias,
                type_only,
                mode,
                star_pos,
                alias_pos,
            };
            return self.add_stmt(kind, start, modifiers);
        }
        let declaration = ExportId(self.f.exports.len() as u32);
        let specs = self.s.export_specs.len();
        let has_list = self.expect(T::OpenBrace);
        let mut has_unusual_local = false;
        let lists = self.enter_list(ListKind::ImportOrExportSpecifiers);
        while has_list
            && self.is_in_list(T::CloseBrace)
            && self.is_at_element(ListKind::ImportOrExportSpecifiers)
        {
            let element = self.full_start();
            let specifier = self.import_or_export_specifier();
            let local = specifier.property_name.unwrap_or(specifier.name);
            has_unusual_local |= local.token == T::String || local.token.is_reserved_word();
            if specifier.is_type_only {
                self.js_error((specifier.start, specifier.end), 8006, b"export...type");
            }
            self.s.export_specs.push(ExportSpec {
                start: specifier.start,
                local: local.text,
                exported: specifier.name.text,
                pos: specifier.name.pos,
                type_only: specifier.is_type_only,
                local_pos: local.pos,
                end: specifier.end,
                export: declaration,
            });
            if !self.eat(T::Comma)
                && !self.goes_on_without_comma(ListKind::ImportOrExportSpecifiers, element)
            {
                break;
            }
        }
        self.lists = lists;
        if has_list {
            self.expect(T::CloseBrace);
        }
        let has_module_specifier = self.token() == T::From;
        let (spec, mode) = match has_module_specifier {
            true => {
                self.next();
                self.module_specifier(SpecifierKind::Import, true, type_only)
            }
            false => (Atom::NONE, ResolutionMode::None),
        };
        // Without `from` a local name is a reference.
        if has_unusual_local && !has_module_specifier {
            self.refuse(Refusal::Reported);
        }
        self.semicolon();
        let items = take_span!(self, export_specs, specs);
        let declaration = self.f.add_export(Export {
            spec,
            has_module_specifier,
            items,
            type_only,
            mode,
            stmt: StmtId::NONE,
        });
        let statement = self.add_stmt(StmtKind::ExportNamed(declaration), start, modifiers);
        self.f[declaration].stmt = statement;
        statement
    }

    /// `parseExportAssignment`, at the `default` or the `=` after `export`.
    pub(crate) fn export_assignment(&mut self, start: Start, base: usize) -> StmtId {
        let modifiers = self.take_modifiers(base);
        let is_export_equals = self.token() == T::Equals;
        self.next();
        // `parseExportAssignment` has `setAwaitContext(true)`.
        let saved = match self.is_ecmascript {
            true => self.enter_context(0, ctx::DISALLOW_IN),
            false => self.enter_context(ctx::AWAIT, ctx::DISALLOW_IN),
        };
        let expression = self.assignment_expression();
        self.context = saved;
        self.semicolon();
        let kind = match is_export_equals {
            true => StmtKind::ExportAssign(expression),
            false => StmtKind::ExportDefault(expression),
        };
        self.add_stmt(kind, start, modifiers)
    }

    /// `parseNamespaceExportDeclaration`, at the `as` after `export`.
    pub(crate) fn namespace_export_declaration(&mut self, start: Start, base: usize) -> StmtId {
        let modifiers = self.take_modifiers(base);
        self.next();
        self.expect(T::Namespace);
        let (name, _) = self.identifier();
        self.semicolon();
        self.add_stmt(StmtKind::ExportAsNamespace(name), start, modifiers)
    }
}
