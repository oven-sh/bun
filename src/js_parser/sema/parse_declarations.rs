//! The part of the parser that only runs for type checking.
//!
//! An ordinary build drops syntax that has no runtime effect: `declare`, overload signatures,
//! namespaces that contain only types, members without a body, type-only imports. The type checker
//! needs all of it. When [`TypeSyntax`](super::TypeSyntax) is present, the parser calls into this
//! file at the points where it would drop something, and saves it instead. It is the same pass over
//! the same tokens: nothing here rewinds the lexer, and nothing reads the source text.
//!
//! Syntax that `bun_ast` can represent is saved as the ordinary node (`S::Class`, `S::Function`,
//! `S::Local`, `S::Enum`, `S::Namespace`), and [`lower`](super::lower) treats it like any other.
//! Syntax it cannot represent becomes a [`Mark`] or a `crate::sema::ts_syntax` node.

use super::Mark;
use super::keep::{TypeMemberParts, modifier_flag};
use crate::Error;
use crate::lexer::{PropertyModifierKeyword, T};
use crate::p::P;
use crate::parser::{PropertyOpts, TypeParameterFlag};
use crate::sema::ts_syntax as ts;
use bun_ast::{E, G, Loc, LocRef, Ref, S, Stmt};
use bun_sema::hir::TypeNodeKind;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    /// The name of a declaration that declares no symbol, because an ordinary build drops it.
    #[cold]
    #[inline(never)]
    pub(crate) fn keep_name(&mut self, loc: bun_ast::Loc, text: &'a [u8]) -> LocRef {
        LocRef {
            loc,
            ref_: self.store_name_in_ref(text),
        }
    }

    /// `parseModuleDeclaration`. `name` is the name of the module: a word, the value of a string,
    /// or `global`.
    #[cold]
    #[inline(never)]
    pub(crate) fn keep_module(
        &mut self,
        loc: bun_ast::Loc,
        name_loc: bun_ast::Loc,
        name: &'a [u8],
        kind: ModuleNameKind,
        body: Option<&'a mut [Stmt]>,
        is_export: bool,
    ) -> Stmt {
        let mut name = self.keep_name(name_loc, name);
        match kind {
            ModuleNameKind::Identifier => {}
            ModuleNameKind::AfterModule => self.note_flag(&mut name.loc, Mark::ModuleKeyword),
            ModuleNameKind::String => self.note_flag(&mut name.loc, Mark::StringName),
            ModuleNameKind::Global => self.note_flag(&mut name.loc, Mark::GlobalName),
        }
        if body.is_none() {
            self.note_flag(&mut name.loc, Mark::NoBody);
        }
        self.s(
            S::Namespace {
                name,
                arg: Ref::NONE,
                stmts: bun_ast::StoreSlice::new_mut(body.unwrap_or_default()),
                is_export,
            },
            loc,
        )
    }

    /// The type parameters of the class whose keyword is at `class_keyword`.
    #[inline]
    pub(crate) fn skip_class_type_parameters(
        &mut self,
        class_keyword: &mut Loc,
    ) -> Result<(), Error> {
        let parameters = self.parse_type_parameters(
            TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                | TypeParameterFlag::ALLOW_CONST_MODIFIER,
        )?;
        self.note_type_parameters(class_keyword, parameters);
        Ok(())
    }

    /// `parseClassElement`: `property`, whose first token is at `start` with full start
    /// `full_start`, ends before the current token. Its modifiers are those pushed since the stack
    /// had `modifiers_base` entries.
    #[inline]
    pub(crate) fn finish_class_member(
        &mut self,
        property: &mut G::Property,
        start: Loc,
        full_start: Loc,
        modifiers_base: usize,
    ) {
        if !self.preserves_type_syntax() {
            return;
        }
        // Notes about a static block are attached to its `{`, those about any other member to its
        // name.
        let named_at = if property.class_static_block.is_some() {
            property
                .class_static_block_mut()
                .map(|block| &mut block.loc)
        } else {
            property.key.as_mut().map(|key| &mut key.loc)
        };
        if let Some(named_at) = named_at {
            self.note_loc(named_at, Mark::MemberStart, start);
            self.finish_member(named_at, full_start);
            self.end_parameter_modifiers(modifiers_base, named_at);
        }
    }

    /// `implemented`, which starts at `start`, is an element of an `implements` clause of the class
    /// whose keyword is at `class_keyword`. `NONE`: it is not of the form `A.B<C>`, which the
    /// parser has already reported.
    pub(crate) fn note_implemented(
        &mut self,
        class_keyword: &mut Loc,
        clause: Mark,
        implemented: ts::TypeId,
        start: Loc,
    ) {
        if SEMA && let Some(syntax) = &mut self.type_syntax {
            let implemented = if implemented.is_some() {
                implemented
            } else {
                syntax.b.add_type(TypeNodeKind::Error, start)
            };
            self.note(class_keyword, clause, implemented.0);
        }
    }

    /// The `this` parameter of the function whose `(` is at `open_parens_loc`, which `bun_ast` has
    /// no field for. Its name is at `name`, its type, if it has one, is the type that was parsed
    /// last, and it ends before the current token.
    #[cold]
    #[inline(never)]
    pub(crate) fn keep_this_parameter(
        &mut self,
        open_parens_loc: &mut Loc,
        mut parameter: ts::Param,
        name: Loc,
        has_type: bool,
    ) {
        parameter.end = self.lexer.full_start();
        if SEMA && let Some(syntax) = &mut self.type_syntax {
            let this = bun_sema::hir::PatKind::Ident(bun_sema::atom::known::this);
            let name_end = Loc {
                start: name.start + b"this".len() as i32,
            };
            parameter.pattern = syntax.b.add_pattern(this, name, name_end);
            if has_type {
                parameter.ty = syntax.last_type_or_error();
            }
            let kept = syntax.b.add_params(&[parameter]).at(0);
            self.note(open_parens_loc, Mark::ThisParameter, kept.0);
        }
    }

    /// `parseModifiersEx`: the word at `loc` was consumed as a modifier of the member being parsed.
    #[inline]
    pub(crate) fn push_member_modifier(
        &mut self,
        opts: &PropertyOpts,
        keyword: PropertyModifierKeyword,
        loc: Loc,
    ) {
        if opts.is_class
            && let Some(flag) = modifier_flag(keyword)
        {
            self.push_statement_modifier(flag, loc);
        }
    }

    /// The same for a word that is a modifier elsewhere and only an error on a member.
    #[cold]
    #[inline(never)]
    pub(crate) fn push_uncommon_member_modifier(&mut self, word: &[u8], loc: Loc) {
        let flag = match word {
            b"const" => ts::Flags::CONST,
            b"default" => ts::Flags::DEFAULT,
            b"export" => ts::Flags::EXPORT,
            b"in" => ts::Flags::IN,
            b"out" => ts::Flags::OUT,
            _ => return,
        };
        self.push_statement_modifier(flag, loc);
    }

    /// `parseIndexSignatureDeclaration`, at the `[` of a class member. `bun_ast` cannot represent
    /// it, so the caller drops the member, and `finish_class_index_signature` takes the result
    /// saved here.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_class_index_signature(&mut self) -> Result<(), Error> {
        let mut member = TypeMemberParts {
            start: self.token_start(),
            ..Default::default()
        };
        self.skip_index_signature(&mut member)?;
        // `parseTypeMemberSemicolon`
        if self.lexer.token == T::TComma {
            self.lexer.next()?;
        } else {
            self.lexer.expect_or_insert_semicolon()?;
        }
        if self.should_save_types()
            && let Some(Ok(built)) = self.build_type_member(&member)
        {
            self.type_syntax_mut().last_index_signature = Some(built);
        }
        Ok(())
    }

    /// The member of the class at `class_keyword` whose first token is at `start`, with full start
    /// `full_start`, was dropped. If it is an index signature, its modifiers are those pushed since
    /// the stack had `modifiers_base` entries, and it ends before the current token.
    #[cold]
    #[inline(never)]
    pub(crate) fn finish_class_index_signature(
        &mut self,
        class_keyword: &mut Loc,
        start: Loc,
        full_start: Loc,
        modifiers_base: usize,
    ) {
        let end = self.lexer.full_start();
        let syntax = self.type_syntax_mut();
        let base = modifiers_base.min(syntax.statement_modifiers.len());
        if let Some(mut kept) = syntax.last_index_signature.take() {
            let modifiers = syntax
                .b
                .ts
                .add_modifiers(&syntax.statement_modifiers[base..]);
            let flags = syntax.statement_modifiers[base..]
                .iter()
                .fold(ts::Flags::empty(), |flags, modifier| flags | modifier.flag);
            let first_modifier = syntax.statement_modifiers.get(base).map(|first| first.loc);
            syntax.b.file[kept.signature].flags |= flags;
            kept.flags |= flags;
            kept.modifiers = modifiers;
            if let Some(first) = first_modifier {
                kept.loc = first;
            }
            (kept.start, kept.full_start, kept.end) = (start, full_start, end);
            let created = syntax.b.member(&kept);
            syntax.class_index_signatures.push(created);
            let payload = syntax.class_index_signatures.len() as u32 - 1;
            syntax
                .notes
                .add(class_keyword, Mark::IndexSignature, payload);
        }
        syntax.statement_modifiers.truncate(base);
    }

    /// `parseExpressionWithTypeArguments` after `implements`, where the names parsed as the type
    /// `kept` continue with `?.`.
    /// `isEntityNameExpression` treats `A?.B` as an entity name, so it is resolved as `A.B`.
    /// Returns false, with nothing consumed, if the expression is anything more than that.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_optional_chain_of_implemented(
        &mut self,
        kept: ts::TypeId,
    ) -> Result<bool, Error> {
        if kept.is_none() {
            return Ok(false);
        }
        let TypeNodeKind::Ref { mut name, args } = self.type_syntax_mut().b.file[kept].kind else {
            return Ok(false);
        };
        if self.lexer.token != T::TQuestionDot || !args.is_empty() {
            return Ok(false);
        }
        let here = self.lexer.snapshot();
        let mut names: Vec<ts::Name> = Vec::new();
        while matches!(self.lexer.token, T::TDot | T::TQuestionDot) {
            self.lexer.next()?;
            if !self.lexer.is_identifier_or_keyword() {
                self.lexer.restore(&here);
                return Ok(false);
            }
            names.push(ts::Name {
                text: bun_ast::StoreStr::new(self.lexer.identifier),
                loc: self.lexer.loc(),
            });
            self.lexer.next()?;
        }
        if matches!(
            self.lexer.token,
            T::TOpenParen
                | T::TOpenBracket
                | T::TExclamation
                | T::TLessThan
                | T::TNoSubstitutionTemplateLiteral
                | T::TTemplateHead
        ) {
            self.lexer.restore(&here);
            return Ok(false);
        }
        let end = self.lexer.full_start();
        let syntax = self.type_syntax_mut();
        for next in names {
            let text = syntax.b.atom(&next.text);
            name = syntax
                .b
                .file
                .append_to_entity_name(name, text, next.loc.start as u32);
        }
        syntax.b.file[kept].kind = TypeNodeKind::Ref { name, args };
        syntax.b.file[kept].end = end.start as u32;
        Ok(true)
    }

    /// Whether the type `kept` has the form `A.B<C>`. True outside of type checking, and where no
    /// type could be parsed.
    #[cold]
    #[inline(never)]
    pub(crate) fn is_saved_entity_name(&self, kept: ts::TypeId) -> bool {
        match &self.type_syntax {
            // `number` is an ordinary name to `parseLeftHandSideExpressionOrHigher`.
            Some(syntax) if kept.is_some() => matches!(
                syntax.b.file[kept].kind,
                TypeNodeKind::Ref { .. } | TypeNodeKind::Keyword(_)
            ),
            _ => true,
        }
    }

    /// The text of the tagged template piece at the lexer's current token. An ordinary build prints
    /// the raw text. The type checker uses the cooked value.
    #[inline]
    pub(crate) fn tagged_template_contents(&mut self) -> E::TemplateContents {
        let raw = self.lexer.raw_template_contents();
        if !self.preserves_type_syntax() {
            return E::TemplateContents::Raw(raw.into());
        }
        let cooked = self.lexer.cooked_template_contents(raw);
        E::TemplateContents::Cooked(E::String::init(self.arena.alloc_slice_copy(&cooked)))
    }

    /// `global { .. }`, with or without `declare`.
    #[cold]
    #[inline(never)]
    pub(crate) fn keep_global(
        &mut self,
        loc: bun_ast::Loc,
        name_loc: bun_ast::Loc,
        body: Option<&'a mut [Stmt]>,
        is_export: bool,
    ) -> Stmt {
        if !self.preserves_type_syntax() {
            return self.s(S::TypeScript::default(), loc);
        }
        self.keep_module(
            loc,
            name_loc,
            b"global",
            ModuleNameKind::Global,
            body,
            is_export,
        )
    }
}

/// `ModuleDeclaration.Name()`, `NodeFlagsGlobalAugmentation`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ModuleNameKind {
    Identifier,
    /// An identifier, of a declaration whose `Keyword` is `module`.
    AfterModule,
    String,
    Global,
}

// ───────────────────────────── import and export declarations ─────────────────────────────

/// The parts parsed so far of the import or export declaration being parsed. The parser's own
/// functions parse it (`t_import`, `t_export`, `parse_specifiers_tolerant`, `parse_path_tolerant`)
/// and record their current token here.
pub(crate) struct ModuleSyntax {
    is_in_ambient_module: bool,
    /// Position of the token after `import`.
    clause_loc: Loc,
    /// End of the last token parsed of the import clause.
    clause_end: Loc,
    is_type_only: bool,
    is_deferred: bool,
    /// Of `import name from`, `import name = ..`.
    default_name: Option<ts::Name>,
    /// Position of the `*` of `* as name`, or of `export *`.
    star_loc: Option<Loc>,
    /// The name after `* as`.
    star_name: Option<ts::ModuleExportName>,
    /// Position of the token after `*`, or after `as`.
    star_name_loc: Loc,
    /// `None` without `{ }`.
    specifiers: Option<ts::Span<ts::Specifier>>,
    module: Option<ts::ModuleSpecifier>,
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    /// Called before a statement that starts with `import` or `export` is parsed.
    /// `end_module_syntax` follows, whatever the outcome.
    #[inline]
    pub(crate) fn begin_module_syntax(&mut self, opts: &crate::parser::ParseStatementOptions) {
        if self.preserves_type_syntax() {
            self.type_syntax_mut().module_syntax.push(ModuleSyntax {
                is_in_ambient_module: opts.scope.is_namespace() && opts.is_typescript_declare,
                clause_loc: Loc::EMPTY,
                clause_end: Loc::EMPTY,
                is_type_only: false,
                is_deferred: false,
                default_name: None,
                star_loc: None,
                star_name: None,
                star_name_loc: Loc::EMPTY,
                specifiers: None,
                module: None,
            });
        }
    }

    #[inline]
    pub(crate) fn end_module_syntax(&mut self) -> Option<ModuleSyntax> {
        if !self.preserves_type_syntax() {
            return None;
        }
        self.type_syntax_mut().module_syntax.pop()
    }

    /// The declaration being parsed. `None` in an ordinary build.
    #[inline]
    fn module_syntax_mut(&mut self) -> Option<&mut ModuleSyntax> {
        if !TYPESCRIPT {
            return None;
        }
        self.type_syntax.as_mut()?.module_syntax.last_mut()
    }

    /// `parseIdentifier`, before the token is consumed. A missing name is empty and is positioned
    /// at the end of the previous token.
    pub(crate) fn identifier_syntax(&self) -> ts::Name {
        if self.lexer.token == T::TIdentifier || !self.is_tolerant() {
            ts::Name {
                text: bun_ast::StoreStr::new(self.lexer.identifier),
                loc: self.lexer.loc(),
            }
        } else {
            ts::Name {
                text: bun_ast::StoreStr::EMPTY,
                loc: self.lexer.full_start(),
            }
        }
    }

    /// At the token after `import`.
    #[inline]
    pub(crate) fn note_import_clause(&mut self) {
        let loc = self.lexer.loc();
        if let Some(kept) = self.module_syntax_mut() {
            kept.clause_loc = loc;
            kept.clause_end = loc;
        }
    }

    /// At the name of `import name from` or `import name = ..`.
    #[inline]
    pub(crate) fn note_default_import(&mut self) {
        let name = ts::Name {
            text: bun_ast::StoreStr::new(self.lexer.identifier),
            loc: self.lexer.loc(),
        };
        let end = self.lexer.range().end();
        if let Some(kept) = self.module_syntax_mut() {
            kept.default_name = Some(name);
            kept.clause_end = end;
        }
    }

    /// The word that `note_default_import` treated as a name is the modifier `type`.
    #[inline]
    pub(crate) fn note_type_only_import(&mut self) {
        if let Some(kept) = self.module_syntax_mut() {
            kept.is_type_only = true;
            kept.default_name = None;
        }
    }

    /// The word that `note_default_import` treated as a name is the modifier `defer`.
    #[inline]
    pub(crate) fn note_deferred_import(&mut self) {
        if let Some(kept) = self.module_syntax_mut() {
            kept.is_deferred = true;
            kept.default_name = None;
        }
    }

    /// After `export type`, at a `{` or a `*`.
    #[inline]
    pub(crate) fn note_type_only_export(&mut self) {
        if let Some(kept) = self.module_syntax_mut() {
            kept.is_type_only = true;
        }
    }

    /// At the `*` of `import * as name`, `export *` or `export * as name`.
    #[inline]
    pub(crate) fn note_star(&mut self) {
        let loc = self.lexer.loc();
        if let Some(kept) = self.module_syntax_mut() {
            kept.star_loc = Some(loc);
        }
    }

    /// `parseNamespaceImport`, at the token after `as`.
    #[inline]
    pub(crate) fn note_namespace_import_name(&mut self) {
        if self.preserves_type_syntax() {
            let ts::Name { text, loc } = self.identifier_syntax();
            let end = if text.is_empty() {
                loc
            } else {
                self.lexer.range().end()
            };
            if let Some(kept) = self.module_syntax_mut() {
                kept.clause_end = end;
                kept.star_name_loc = loc;
                kept.star_name = Some(ts::ModuleExportName {
                    text,
                    loc,
                    end,
                    is_string: false,
                });
            }
        }
    }

    /// `parseExportDeclaration`, at the token after `export *`, or at the name after `export * as`,
    /// whose text is `alias`.
    #[inline]
    pub(crate) fn note_namespace_export(&mut self, alias: Option<&'a [u8]>) {
        let range = self.lexer.range();
        let is_string = self.lexer.token == T::TStringLiteral;
        if let Some(kept) = self.module_syntax_mut() {
            kept.star_name_loc = range.loc;
            kept.star_name = alias.map(|text| ts::ModuleExportName {
                text: bun_ast::StoreStr::new(text),
                loc: range.loc,
                end: range.end(),
                is_string,
            });
        }
    }

    /// `parseNamedImports`, `parseNamedExports`: the specifiers between the braces. Without a `{`
    /// the list is missing and empty.
    pub(crate) fn keep_specifiers(&mut self, specifiers: &[ts::Specifier]) {
        let end = self.lexer.full_start();
        let Some(syntax) = &mut self.type_syntax else {
            return;
        };
        if syntax.module_syntax.is_empty() {
            return;
        }
        let specifiers = syntax.b.ts.add_specifiers(specifiers);
        if let Some(kept) = syntax.module_syntax.last_mut() {
            kept.specifiers = Some(specifiers);
            kept.clause_end = end;
        }
    }

    /// `parseModuleSpecifier`: it is at `loc`. `text`: its value, if it is a string. `expression`:
    /// the expression in its place, if not.
    pub(crate) fn keep_module_specifier(
        &mut self,
        text: Option<&'a [u8]>,
        expression: Option<bun_ast::Expr>,
        loc: Loc,
    ) {
        if let Some(kept) = self.module_syntax_mut() {
            kept.module = Some(ts::ModuleSpecifier {
                text: text.map(bun_ast::StoreStr::new),
                loc,
                mode: ts::ResolutionMode::None,
                expression,
                attributes: None,
            });
        }
    }

    /// `parseImportAttributes`, after the module specifier: `object` is the attributes as an object
    /// literal, and `keyword_loc` the position of `with`.
    pub(crate) fn keep_import_attributes(&mut self, keyword_loc: Loc, object: bun_ast::Expr) {
        if let Some(ModuleSyntax {
            module: Some(module),
            ..
        }) = self.module_syntax_mut()
        {
            module.attributes = Some(ts::ImportAttributes {
                keyword_loc,
                object,
            });
        }
    }

    /// `end_module_syntax` for a declaration of which only the module specifier is needed.
    pub(crate) fn end_module_specifier(&mut self) -> Option<ts::ModuleSpecifier> {
        self.end_module_syntax()?.module
    }

    /// `getResolutionModeOverride` for the attribute `key: value` that was just parsed.
    /// `is_string_key`: `key` is a string literal.
    /// `literal_end`: the end of the first token of `value`, if that token is a string.
    pub(crate) fn resolution_mode_of_attribute(
        &self,
        key: &bun_ast::Expr,
        is_string_key: bool,
        value: &bun_ast::Expr,
        literal_end: Option<Loc>,
    ) -> ts::ResolutionMode {
        use bun_ast::ExprData;
        // `IsStringLiteralLike(value)`: the string is the whole expression.
        if !is_string_key || literal_end != Some(self.lexer.full_start()) {
            return ts::ResolutionMode::None;
        }
        match (&key.data, &value.data) {
            (ExprData::EString(key), ExprData::EString(value))
                if key.eql_comptime(b"resolution-mode") =>
            {
                if value.eql_comptime(b"import") {
                    ts::ResolutionMode::Import
                } else if value.eql_comptime(b"require") {
                    ts::ResolutionMode::Require
                } else {
                    ts::ResolutionMode::None
                }
            }
            _ => ts::ResolutionMode::None,
        }
    }

    /// The resolution mode specified by the import attributes after the module specifier.
    pub(crate) fn keep_resolution_mode(&mut self, mode: ts::ResolutionMode) {
        if let Some(ModuleSyntax {
            module: Some(module),
            ..
        }) = self.module_syntax_mut()
        {
            module.mode = mode;
        }
    }

    /// `stmt` is the result of parsing the statement whose `import` is at `loc`.
    #[inline]
    pub(crate) fn keep_import(&mut self, kept: Option<ModuleSyntax>, stmt: Stmt, loc: Loc) -> Stmt {
        match kept {
            Some(kept) => self.emit_import(&kept, stmt, loc),
            None => stmt,
        }
    }

    #[cold]
    #[inline(never)]
    fn emit_import(&mut self, kept: &ModuleSyntax, stmt: Stmt, loc: Loc) -> Stmt {
        // `import(..)` and `import.meta` start an expression. `import a = b` is already saved.
        let Some(module) = kept.module else {
            return stmt;
        };
        let namespace = kept.star_loc.map(|star_loc| ts::NamespaceImport {
            star_loc,
            name: match kept.star_name {
                Some(name) => ts::Name {
                    text: name.text,
                    loc: name.loc,
                },
                None => ts::Name {
                    text: bun_ast::StoreStr::EMPTY,
                    loc: kept.star_name_loc,
                },
            },
        });
        // `tryParseImportClause`: without a clause there is nothing for a modifier to apply to.
        let has_clause =
            kept.default_name.is_some() || namespace.is_some() || kept.specifiers.is_some();
        let import = self.type_syntax_mut().b.ts.add_import(ts::Import {
            clause_loc: kept.clause_loc,
            clause_end: kept.clause_end,
            is_type_only: kept.is_type_only,
            is_deferred: kept.is_deferred && has_clause,
            default_name: kept.default_name,
            namespace,
            specifiers: kept.specifiers,
            module,
            is_in_ambient_module: kept.is_in_ambient_module,
        });
        self.emit_statement(ts::StatementData::Import(import), loc);
        self.type_script_statement(loc)
    }

    /// Called before the entity name of `import a = b.c`. Pass the result to `keep_import_equals`.
    #[inline]
    pub(crate) fn begin_entity_name(&self) -> usize {
        match &self.type_syntax {
            Some(syntax) if SEMA => syntax.name_stack.len(),
            _ => 0,
        }
    }

    /// `parseEntityName`, at each name of it, before the token is consumed.
    #[inline]
    pub(crate) fn push_entity_name(&mut self) {
        if self.preserves_type_syntax() {
            let name = self.identifier_syntax();
            self.type_syntax_mut().name_stack.push(name);
        }
    }

    /// `parseExternalModuleReference`, at the string in `require("module")`. `None` in an ordinary build.
    #[inline]
    pub(crate) fn external_module_reference(&mut self) -> Option<ts::ModuleReference> {
        if !self.preserves_type_syntax() {
            return None;
        }
        Some(ts::ModuleReference::External {
            text: self.string_token_text(),
            loc: self.lexer.loc(),
            expression: None,
        })
    }

    /// `parseImportEqualsDeclaration`, whose `import` is at `loc`. `external`: the argument of
    /// `require( )`. Without it, the names pushed since `names_base` are the entity name.
    #[cold]
    #[inline(never)]
    pub(crate) fn keep_import_equals(
        &mut self,
        names_base: usize,
        external: Option<ts::ModuleReference>,
        loc: Loc,
    ) -> Stmt {
        let syntax = self.type_syntax_mut();
        let reference = match external {
            Some(external) => external,
            None => ts::ModuleReference::EntityName(
                syntax.b.add_names(&syntax.name_stack[names_base..]),
            ),
        };
        syntax.name_stack.truncate(names_base);
        let missing = ts::Name {
            text: bun_ast::StoreStr::EMPTY,
            loc,
        };
        let (name, is_type_only, is_in_ambient_module) = match syntax.module_syntax.last() {
            Some(kept) => (
                kept.default_name.unwrap_or(missing),
                kept.is_type_only,
                kept.is_in_ambient_module,
            ),
            None => (missing, false, false),
        };
        let import = syntax.b.ts.add_import_equals(ts::ImportEquals {
            name,
            is_type_only,
            reference,
            is_in_ambient_module,
        });
        self.emit_statement(ts::StatementData::ImportEquals(import), loc);
        self.type_script_statement(loc)
    }

    /// `stmt` is the result of parsing the statement whose `export` is at `loc`.
    #[inline]
    pub(crate) fn keep_export(&mut self, kept: Option<ModuleSyntax>, stmt: Stmt, loc: Loc) -> Stmt {
        match kept {
            Some(kept) => self.emit_export(&kept, stmt, loc),
            None => stmt,
        }
    }

    #[cold]
    #[inline(never)]
    fn emit_export(&mut self, kept: &ModuleSyntax, stmt: Stmt, loc: Loc) -> Stmt {
        let clause = match (kept.star_loc, kept.specifiers) {
            (Some(star_loc), _) => ts::ExportClause::Star {
                star_loc,
                alias: kept.star_name,
                alias_loc: kept.star_name_loc,
            },
            (None, Some(specifiers)) => ts::ExportClause::Named(specifiers),
            // `export` is a modifier, or the keyword of another kind of statement.
            (None, None) => return stmt,
        };
        // `checkExportSpecifier`, `checkModuleExportName`: without a module specifier, a string
        // name refers to nothing that could be exported.
        if let (ts::ExportClause::Named(specifiers), None) = (clause, kept.module) {
            for specifier in specifiers.iter() {
                if let Some(name) = self.type_syntax_mut().b.ts[specifier].property_name
                    && name.is_string
                {
                    let range = bun_ast::Range {
                        loc: name.loc,
                        len: name.end.start - name.loc.start,
                    };
                    self.lexer.ts_grammar_error(range, 1003);
                }
            }
        }
        let export = self.type_syntax_mut().b.ts.add_export(ts::Export {
            is_type_only: kept.is_type_only,
            clause,
            module: kept.module,
        });
        self.emit_statement(ts::StatementData::Export(export), loc);
        self.type_script_statement(loc)
    }

    /// `parseNamespaceExportDeclaration`: `export as namespace name`, whose `export` is at `loc`.
    pub(crate) fn keep_namespace_export_declaration(&mut self, name: ts::Name, loc: Loc) -> Stmt {
        if !self.preserves_type_syntax() {
            return self.s(S::TypeScript::default(), loc);
        }
        self.emit_statement(ts::StatementData::ExportAsNamespace(name), loc);
        self.type_script_statement(loc)
    }
}
