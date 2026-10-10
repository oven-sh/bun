//! Import and export declarations.

use super::stmt::Start;
use super::{ListKind, Parser, ctx, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

/// A name in an import or export specifier.
#[derive(Copy, Clone)]
pub(super) struct ExportName {
    pub(super) text: Atom,
    pub(super) pos: u32,
    pub(super) token: T,
}

/// `ImportSpecifier`, `ExportSpecifier`
pub(super) struct Specifier {
    pub(super) start: u32,
    pub(super) is_type_only: bool,
    pub(super) property_name: Option<ExportName>,
    /// Where `property_name` ends, if an `as` that is no name follows it.
    property_name_end: u32,
    pub(super) name: ExportName,
    pub(super) end: u32,
}

/// The ranges of the imports and exports that are no statement of the file or of a module block.
fn misplaced_declarations(f: &FileBuilder) -> Vec<core::ops::Range<u32>> {
    let mut is_well_placed = vec![false; f.stmts.len()];
    let lists = std::iter::once(f.body).chain(f.modules.iter().map(|it| it.body));
    for statement in lists.flat_map(|list| f.ids(list)) {
        if let Some(it) = is_well_placed.get_mut(statement.idx()) {
            *it = true;
        }
    }
    let mut misplaced = Vec::new();
    for (statement, is_well_placed) in f.stmts.iter().zip(is_well_placed) {
        if !is_well_placed
            && matches!(
                statement.kind,
                StmtKind::Import(_)
                    | StmtKind::ImportEquals(_)
                    | StmtKind::ExportNamed(_)
                    | StmtKind::ExportStar { .. }
            )
        {
            misplaced.push(statement.start..statement.loc.end);
        }
    }
    misplaced
}

/// "The parser expected to find a '}' to match the '{' token here.", at `open`: for the last error of
/// the parser, whether it is about that `}` or not.
fn relate_to_open_brace(diagnostics: &mut [Diagnostic], open: u32) {
    let mut errors = diagnostics.iter_mut();
    if let Some(last) = errors.rfind(|it| it.kind == DiagnosticKind::Parse)
        && last.code == 1005
    {
        let at = (open, Diagnostic::NO_LENGTH);
        let texts = [T::OpenBrace.text(), T::CloseBrace.text()];
        last.related
            .push(Diagnostic::new(DiagnosticKind::Parse, at, 1007, &texts));
    }
}

impl<const GENERAL: bool> Parser<'_, GENERAL> {
    /// Whether the text is read as acorn or Babel read it: what TypeScript's parser leaves to the
    /// checker is an error of their parsers.
    #[inline]
    fn is_read_as_by_other_parsers(&self) -> bool {
        self.is_ecmascript || self.options.dialect.babel
    }

    /// `parseModuleSpecifier`, and the import attributes after it: the text, which is recorded as a
    /// reference to that module. `NONE`: it is no string.
    /// `is_type_only`: after `import type` or `export type`, the only declarations whose
    /// `resolution-mode` is honored.
    fn module_specifier(
        &mut self,
        kind: SpecifierKind,
        is_export: bool,
        is_type_only: bool,
    ) -> (Atom, ResolutionMode) {
        if self.token() != T::String {
            self.expression_as_module_specifier(is_export);
            return (Atom::NONE, ResolutionMode::None);
        }
        let (spec, pos) = (self.lx.atom, self.pos());
        self.next();
        let mut mode = self.import_attributes_of_declaration(is_export);
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

    /// `parseModuleSpecifier` at a token that is no string, and the import attributes after it: "We
    /// allow arbitrary expressions here".
    #[cold]
    #[inline(never)]
    fn expression_as_module_specifier(&mut self, is_export: bool) {
        if self.is_read_as_by_other_parsers() {
            return self.refuse(Refusal::Reported);
        }
        let at = self.pos();
        let declarations = (self.f.imports.len(), self.f.exports.len());
        // `parseExportDeclaration` has `setAwaitContext(true)`.
        let saved = self.context;
        if is_export {
            self.context |= ctx::AWAIT;
        }
        let expression = self.expression();
        self.context = saved;
        if self.has_failed() {
            return;
        }
        self.string_literal_expected(expression, at);
        self.f.specifier_expressions.push(expression);
        self.after_expressions_of_declaration(at, declarations);
        self.import_attributes_of_declaration(is_export);
        if is_export {
            // The declaration is the next statement that is added.
            let statement = StmtId(self.f.stmts.len() as u32);
            self.f
                .exports_from_expressions
                .push((statement, expression));
        }
    }

    /// `checkExternalImportOrExportDeclaration`, of what is from `at` on in the place of a module
    /// specifier. Whether it is there: nothing is reported about a missing one.
    pub(super) fn string_literal_expected(&mut self, expression: ExprId, at: u32) -> bool {
        let is_missing = matches!(
            self.f.exprs.get(expression.idx()),
            Some(Expr {
                kind: ExprKind::Missing,
                ..
            })
        ) && !self.is_parenthesized(expression);
        if !is_missing {
            self.flag(DiagnosticKind::Checker, 1141, (at, self.prev_end()), &[]);
        }
        !is_missing
    }

    /// After the statements of the file. `checkGrammarModuleElementContext` returns before
    /// `checkExternalImportOrExportDeclaration` for a declaration that is no statement of the file
    /// or of a module block: what `string_literal_expected` has flagged in one is taken back.
    #[cold]
    #[inline(never)]
    pub(crate) fn forget_specifiers_of_misplaced_declarations(&mut self) {
        let misplaced = misplaced_declarations(&self.f);
        self.f.diagnostics.retain(|it| {
            it.kind != DiagnosticKind::Checker
                || it.code != 1141
                || !misplaced.iter().any(|range| range.contains(&it.start))
        });
    }

    /// After the expressions from `from` on that an import or export declaration has where strings
    /// belong. `declarations`: how many imports and exports the file had before them.
    #[cold]
    #[inline(never)]
    fn after_expressions_of_declaration(&mut self, from: u32, declarations: (usize, usize)) {
        // The specifiers of the declaration hold the index that it was going to get.
        let has_declarations = declarations != (self.f.imports.len(), self.f.exports.len());
        // For an `await` that is a name, `reparseTopLevelAwait` parses the names of an import again
        // too.
        let top_level = ctx::TOP_LEVEL | ctx::AWAIT;
        let written = (from as usize)..(self.prev_end() as usize);
        let written = self.lx.src.get(written).unwrap_or_default();
        let has_await =
            self.context & top_level == top_level && bun_core::strings::contains(written, b"await");
        if has_declarations || has_await {
            self.refuse(Refusal::Unsupported);
        }
    }

    /// `tryParseImportAttributes`, and what `parseExportDeclaration` has in its place.
    #[inline]
    pub(super) fn import_attributes_of_declaration(&mut self, is_export: bool) -> ResolutionMode {
        // After an import, `with` can be on the next line. After an export it starts a statement
        // there.
        if self.token() == T::With && !(is_export && self.newline_before() && !self.is_ecmascript) {
            return self.import_attributes_after_specifier(is_export);
        }
        if self.token() == T::Assert && !self.newline_before() {
            // An error of the native parser.
            match self.options.dialect.typescript_5 {
                true => self.flag(
                    DiagnosticKind::Grammar,
                    2880,
                    (self.lx.start, self.lx.end),
                    &[],
                ),
                false => self.error_and_go_on(2880, self.range_of_token(), &[]),
            }
            return self.import_attributes_after_specifier(is_export);
        }
        ResolutionMode::None
    }

    /// `parseImportAttributes`, at the keyword after a module specifier.
    fn import_attributes_after_specifier(&mut self, is_export: bool) -> ResolutionMode {
        // `parseExportDeclaration` has `setAwaitContext(true)`.
        let saved = self.context;
        if is_export && !self.is_ecmascript {
            self.context |= ctx::AWAIT;
        }
        let mode = self.import_attributes(false);
        self.context = saved;
        mode
    }

    /// `parseImportAttributes`, at `with`: they are kept as an object literal. Returns
    /// `getResolutionModeOverride`. `is_in_type`: in `import("a", { with: { .. } })`, where a colon
    /// follows the keyword, and where a token that is reported can be in the place of the keyword.
    pub(crate) fn import_attributes(&mut self, is_in_type: bool) -> ResolutionMode {
        let keyword = self.pos();
        if !is_in_type || matches!(self.token(), T::With | T::Assert) {
            self.next();
        }
        if is_in_type {
            self.expect(T::Colon);
        }
        let open = self.pos();
        if !self.expect(T::OpenBrace) {
            // `parseEmptyNodeList`
            let object = self.add_expr(ExprKind::Object(Span::EMPTY), open, open);
            self.f.import_attributes.push((keyword, object));
            return ResolutionMode::None;
        }
        let declarations = (self.f.imports.len(), self.f.exports.len());
        let base = self.s.props.len();
        let (mut mode, mut has_only_strings) = (ResolutionMode::None, true);
        let lists = self.enter_list(ListKind::ImportAttributes);
        while self.is_in_list(T::CloseBrace) && self.is_at_element(ListKind::ImportAttributes) {
            // `parseImportAttribute`
            let (pos, element, token) = (self.pos(), self.full_start(), self.token());
            // `tokenIsIdentifierOrKeyword` is true of a private name.
            if token != T::String
                && (!token.is_identifier_or_keyword()
                    || token == T::PrivateIdentifier && self.is_read_as_by_other_parsers())
            {
                self.fail();
                break;
            }
            let key = self.lx.atom;
            self.next_after_name();
            self.expect(T::Colon);
            // The checker reports all but a string.
            let is_at_string = self.token() == T::String;
            let value = self.assignment_expression();
            // A template without substitutions is one too.
            let text = match self.f.exprs.get(value.idx()).map(|it| it.kind) {
                Some(ExprKind::String(text)) => Some(text),
                _ => None,
            };
            has_only_strings &= is_at_string && text.is_some();
            if token == T::String && self.lx.text_of(key) == b"resolution-mode" {
                // `IsStringLiteralLike`
                let text = text.filter(|_| !self.is_parenthesized(value));
                mode = match text.map(|it| self.lx.text_of(it)) {
                    Some(b"import") => ResolutionMode::Import,
                    Some(b"require") => ResolutionMode::Require,
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
            if !self.eat(T::Comma)
                && !self.goes_on_without_comma(ListKind::ImportAttributes, element)
            {
                break;
            }
        }
        self.leave_list(lists);
        if !self.eat(T::CloseBrace) {
            self.unclosed_import_attributes(open);
        }
        if !has_only_strings && !self.has_failed() {
            // In a TypeScript file Prettier asks typescript-estree, which takes any expression.
            match self.is_ecmascript {
                true => self.refuse(Refusal::Reported),
                false if is_in_type => {}
                false => self.after_expressions_of_declaration(open, declarations),
            }
        }
        // Only if it is the only attribute.
        if self.s.props.len() != base + 1 {
            mode = ResolutionMode::None;
        }
        let props = take_span!(self, props, base);
        let object = self.finish_expr(ExprKind::Object(props), open);
        self.f.import_attributes.push((keyword, object));
        mode
    }

    /// The ends of `parseImportAttributes` and of the braces around them in `parseImportType`, at
    /// another token than the `}` for the `{` at `open`.
    #[cold]
    #[inline(never)]
    pub(crate) fn unclosed_import_attributes(&mut self, open: u32) {
        if !self.recovers() {
            return self.fail();
        }
        self.expected(T::CloseBrace);
        relate_to_open_brace(&mut self.f.diagnostics, open);
    }

    /// Leaves the await context that the top level is. `statementHasAwaitIdentifier` is restored
    /// after the names that an import declares, after `import a = b` and after `export as namespace
    /// a`: `reparseTopLevelAwait` parses no statement again for an `await` in them. Returns the
    /// context to restore.
    #[inline(always)]
    fn leave_await_context_of_top_level(&mut self) -> u32 {
        let saved = self.context;
        if saved & ctx::TOP_LEVEL != 0 && !self.is_ecmascript {
            self.context = saved & !ctx::AWAIT;
        }
        saved
    }

    /// `parseIdentifier`: the name, which is not noted, and where the node is.
    #[inline]
    pub(super) fn identifier_of_declaration(&mut self) -> (Atom, u32) {
        if !self.is_identifier() {
            return self.missing_name();
        }
        let name = (self.lx.atom, self.pos());
        self.next_after_name();
        name
    }

    /// `canParseModuleExportName`
    fn can_parse_module_export_name(&self) -> bool {
        self.token().is_identifier_or_keyword() || self.token() == T::String
    }

    /// `parseModuleExportName`
    fn module_export_name(&mut self) -> ExportName {
        if !self.can_parse_module_export_name() {
            let (text, pos) = self.missing_name();
            return ExportName {
                text,
                pos,
                token: T::Identifier,
            };
        }
        let name = ExportName {
            text: self.lx.atom,
            pos: self.pos(),
            token: self.token(),
        };
        self.next_after_name();
        name
    }

    /// `parseImportOrExportSpecifier`, but for the error about the name.
    pub(super) fn import_or_export_specifier(&mut self) -> Specifier {
        let start = self.pos();
        let (mut is_type_only, mut property_name, mut can_parse_as) = (false, None, true);
        let mut property_name_end = 0;
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
            property_name_end = self.prev_end();
            self.next();
            name = self.module_export_name();
        }
        Specifier {
            start,
            is_type_only,
            property_name,
            property_name_end,
            name,
            end: self.prev_end(),
        }
    }

    /// The ends of `parseImportOrExportSpecifier` and of `parseImportSpecifier`, for a name that is
    /// more than an identifier. `imported`: the name in the other module.
    #[cold]
    #[inline(never)]
    pub(super) fn unusual_name_of_import_specifier(
        &mut self,
        specifier: &Specifier,
        imported: &mut ExportName,
    ) {
        let name = specifier.name;
        // "disallowKeywords && ast.IsKeyword(p.token) && !p.isIdentifier()"
        let is_identifier = match name.token {
            T::String => false,
            T::Yield if !self.is_ecmascript => !self.has_context(ctx::YIELD),
            T::Await if !self.is_ecmascript => !self.has_context(ctx::AWAIT),
            token => !token.is_reserved_word(),
        };
        if !is_identifier {
            self.error_and_go_on(1003, (name.pos, specifier.end), &[]);
        }
        // `ImportSpec::is_name_missing`
        if name.token == T::String && specifier.property_name.is_none() {
            imported.text = known::empty;
        }
    }

    /// For a local name of an export specifier that is more than an identifier. What is reported
    /// about it if no `from` follows the specifiers is pushed on the stack of ids: its range.
    #[cold]
    #[inline(never)]
    fn unusual_local_of_export_specifier(&mut self, specifier: &Specifier) {
        let local = specifier.property_name.unwrap_or(specifier.name);
        let is_reported = match self.is_read_as_by_other_parsers() {
            // It is a reference.
            true => local.token == T::String || local.token.is_reserved_word(),
            // `checkModuleExportName(node.PropertyName(), hasModuleSpecifier)`
            false => local.token == T::String && specifier.property_name.is_some(),
        };
        if is_reported {
            self.s.ids.extend([local.pos, specifier.property_name_end]);
        }
    }

    /// Pops what `unusual_local_of_export_specifier` has pushed from `base` on, and reports it.
    #[cold]
    #[inline(never)]
    fn report_locals_of_export(&mut self, base: usize, has_module_specifier: bool) {
        if !has_module_specifier && self.is_read_as_by_other_parsers() {
            self.refuse(Refusal::Reported);
        } else if !has_module_specifier {
            for index in (base..self.s.ids.len()).step_by(2) {
                let start = self.s.ids.get(index).copied();
                let end = self.s.ids.get(index + 1).copied();
                if let (Some(start), Some(end)) = (start, end) {
                    self.flag(DiagnosticKind::Grammar, 1003, (start, end), &[]);
                }
            }
        }
        self.s.ids.truncate(base);
    }

    /// `parseImportDeclarationOrImportEqualsDeclaration`
    pub(crate) fn import_declaration_or_import_equals(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
    ) -> StmtId {
        self.next();
        let saved = self.leave_await_context_of_top_level();
        let clause_start = self.pos();
        let mut identifier = None;
        if self.is_identifier() || self.token() == T::TypeOf && self.is_flow {
            identifier = Some((self.lx.atom, self.pos(), self.token()));
            self.next_after_name();
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
                    self.next_after_name();
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
                    self.next_after_name();
                }
            }
        }
        if let Some((name, name_pos, _)) = identifier
            && !is_deferred
            && !matches!(self.token(), T::Comma | T::From)
        {
            let statement = self.import_equals(start, base, flags, (name, name_pos), type_only);
            self.context = saved;
            return statement;
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
                (namespace, namespace_pos) = self.identifier_of_declaration();
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
                    let mut imported = specifier.property_name.unwrap_or(name);
                    if name.token != T::Identifier {
                        self.unusual_name_of_import_specifier(&specifier, &mut imported);
                    }
                    if specifier.is_type_only {
                        self.js_error((specifier.start, specifier.end), 8006, b"import...type");
                    }
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
                self.leave_list(lists);
                if has_list {
                    self.expect(T::CloseBrace);
                }
            }
        }
        self.context = saved;
        // `tryParseImportClause`: without a clause there is nothing that the modifier is of.
        if is_deferred && !has_clause {
            match self.is_read_as_by_other_parsers() {
                true => self.report(),
                false => is_deferred = false,
            }
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
        let mut expression = ExprId::NONE;
        // `parseModuleReference`
        let target = if self.token() == T::Require && self.peek() == T::OpenParen {
            // `parseExternalModuleReference`
            self.next();
            self.next();
            let mut spec = Atom::NONE;
            if self.token() == T::String {
                spec = self.lx.atom;
                self.f.specifier_uses.push(SpecifierUse {
                    spec,
                    pos: self.pos(),
                    kind: SpecifierKind::Require,
                    mode: ResolutionMode::None,
                });
                self.next();
            } else {
                expression = self.expression_as_required_module();
            }
            self.expect(T::CloseParen);
            ImportEqualsTarget::Require(spec)
        } else {
            // `parseEntityName`
            let names = self.s.names.len();
            let first = self.identifier_of_declaration();
            self.note_identifier(first.0, first.1);
            self.s.names.push(first);
            while self.eat(T::Dot) {
                let Some(part) = self.right_side_of_dot_in_module_reference() else {
                    break;
                };
                self.s.names.push(part);
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
            expression,
            flags,
            stmt: StmtId::NONE,
        });
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::ImportEquals(declaration), start, modifiers);
        self.f[declaration].stmt = statement;
        statement
    }

    /// `parseModuleSpecifier` in `parseExternalModuleReference`, at a token that is no string.
    /// `NONE`: it is missing.
    #[cold]
    #[inline(never)]
    fn expression_as_required_module(&mut self) -> ExprId {
        if self.is_read_as_by_other_parsers() {
            self.refuse(Refusal::Reported);
            return ExprId::NONE;
        }
        let at = self.pos();
        let expression = self.expression();
        if self.has_failed() {
            return ExprId::NONE;
        }
        if self.string_literal_expected(expression, at) {
            return expression;
        }
        // Nothing stands for it.
        if self.f.exprs.len() == expression.idx() + 1 {
            self.f.exprs.pop();
        }
        ExprId::NONE
    }

    /// `parseRightSideOfDot` in the `parseEntityName` of `parseModuleReference`, where a reserved
    /// word is no name. `None`: at a `<`, before which `parseEntityName` ends.
    #[inline]
    fn right_side_of_dot_in_module_reference(&mut self) -> Option<(Atom, u32)> {
        if !self.is_identifier() || self.newline_before() {
            return self.right_side_of_dot_in_module_reference_in_general();
        }
        let name = (self.lx.atom, self.pos());
        self.note_identifier(name.0, name.1);
        self.next_after_name();
        Some(name)
    }

    #[cold]
    #[inline(never)]
    fn right_side_of_dot_in_module_reference_in_general(&mut self) -> Option<(Atom, u32)> {
        let token = self.token();
        // "The entity is part of a JSDoc-style generic."
        if token == T::LessThan {
            self.fail_unless_recovering();
            return None;
        }
        // A name on the next line that a word follows on its line starts the next statement.
        let is_next_statement = self.newline_before()
            && token.is_identifier_or_keyword()
            && self.is_followed_by_word_on_same_line();
        if token == T::PrivateIdentifier && !is_next_statement {
            self.next();
        }
        if token == T::PrivateIdentifier || is_next_statement {
            let at = self.full_start();
            self.error(1003, (at, Diagnostic::NO_LENGTH), &[]);
            return Some((known::empty, at));
        }
        let name = self.identifier_of_declaration();
        self.note_identifier(name.0, name.1);
        Some(name)
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
        let unusual_locals = self.s.ids.len();
        let lists = self.enter_list(ListKind::ImportOrExportSpecifiers);
        while has_list
            && self.is_in_list(T::CloseBrace)
            && self.is_at_element(ListKind::ImportOrExportSpecifiers)
        {
            let element = self.full_start();
            let specifier = self.import_or_export_specifier();
            let local = specifier.property_name.unwrap_or(specifier.name);
            if local.token != T::Identifier {
                self.unusual_local_of_export_specifier(&specifier);
            }
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
        self.leave_list(lists);
        if has_list {
            self.expect(T::CloseBrace);
        }
        // "If we don't have a 'from' keyword, see if we have a string literal such that ASI won't
        // take effect."
        let has_module_specifier =
            self.token() == T::From || self.token() == T::String && !self.newline_before();
        if self.s.ids.len() != unusual_locals {
            self.report_locals_of_export(unusual_locals, has_module_specifier);
        }
        let (spec, mode) = match has_module_specifier {
            true => {
                self.expect(T::From);
                self.module_specifier(SpecifierKind::Import, true, type_only)
            }
            false => (Atom::NONE, ResolutionMode::None),
        };
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
        let saved = self.leave_await_context_of_top_level();
        let (name, _) = self.identifier();
        self.context = saved;
        self.semicolon();
        self.add_stmt(StmtKind::ExportAsNamespace(name), start, modifiers)
    }
}
