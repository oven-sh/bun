//! Enums and names: where a `const` enum may be used, and the specialized diagnostics for names
//! that resolve, or fail to resolve, in particular ways.
//!
//! 2475 2476, 2397, 1281, 2311 18004, 2690, 2686; at a JSX tag and at the first name of an import
//! alias also 2448 2449 2450, 2372 2373.
//!
//! Follows `isBlockScopedNameDeclaredBeforeUse`, `checkConstEnumAccess`,
//! `checkElementAccessExpression`, `initializeChecker`,
//! `addUndefinedToGlobalsOrErrorOnRedeclaration`, `getCannotFindNameDiagnosticForName`,
//! `checkAndReportErrorForUsingTypeAsValue`, `maybeMappedType`, `allTypesAssignableToKindEx`,
//! `onSuccessfullyResolvedSymbol`, `checkImportEqualsDeclaration` and `markJsxAliasReferenced` of
//! TypeScript 7.0.2's checker.go and `Resolve` of its nameresolver.go.
//!
//! Runs after the passes that report unresolved names: some of their diagnostics are reworded here.

use super::errors_names_and_exports::is_valid_type_only_alias_use_site;
use super::*;
use crate::bind::{Decl, ScopeId, ScopeKind};
use crate::program::SymbolTable;

/// `isInRightSideOfImportOrExportAssignment`
fn is_in_right_side_of_import_or_export_assignment(hir: &hir::File, mut node: Node) -> bool {
    while hir.kind(hir.parent(node)) == Kind::QualifiedName {
        node = hir.parent(node);
    }
    let parent = hir.parent(node);
    match hir.kind(parent) {
        // Its other identifier is its name.
        Kind::ImportEqualsDeclaration => hir.name(parent) != node,
        Kind::ExportAssignment => hir.expression(parent) == node,
        _ => false,
    }
}

impl Checker<'_, '_> {
    pub(super) fn check_x_enums_names(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.has_errors || hir.kind == FileKind::Json {
            return;
        }
        // `checkEnumDeclaration`, `initializeChecker` and `checkAndReportErrorForUsingTypeAsValue` apply to declaration files too. The
        // other passes only support source files.
        if hir.kind == FileKind::Declaration {
            self.check_x_built_in_global_names(file);
            return;
        }
        self.check_x_built_in_global_names(file);
        self.check_x_names_from_other_files(file);
        self.check_x_umd_globals(file);
        self.check_x_jsx_factories(file);
    }

    // ───────────────────────────── `const` enums ─────────────────────────────

    /// `checkConstEnumAccess` for `e` and for each parenthesized expression around it, which has
    /// the same type.
    pub(super) fn check_const_enum_access(&mut self, file: FileId, e: ExprId, ty: TypeId) {
        let (hir, files) = (self.hir(file), self.files());
        let TypeData::Anon {
            origin: Origin::EnumObject(symbol),
            ..
        } = *self.data(ty)
        else {
            return;
        };
        // `resolveName(node, GetFirstIdentifier(node).Text(), SymbolFlagsAlias, nil, false, true)`
        let first = first_identifier(hir, e);
        let resolves_to_import = match hir[first].kind {
            ExprKind::Ident(name) if files.options.verbatim_module_syntax => {
                let scope = self.enclosing_scope_of_expr(file, first);
                let lookup = &mut |table: SymbolTable, held: Option<Sym>, meaning: SymFlags| {
                    // `excludeGlobals`
                    let is_global = matches!(table, SymbolTable::Globals);
                    held.filter(|&held| !is_global && files.means(held, meaning))
                };
                let found = files.resolve_with(file, scope, name, SymFlags::ALIAS, false, lookup);
                matches!(found, Ok(Some(_)))
            }
            _ => false,
        };
        let flag_name = super::errors_modules::isolated_modules_like_flag_name(files);
        let mut node = hir.node(e);
        loop {
            let parent = hir.parent(node);
            // The other children of a `TypeQuery` are types.
            let ok = matches!(
                hir.kind(parent),
                Kind::PropertyAccessExpression | Kind::ElementAccessExpression
            ) && hir.expression(parent) == node
                || matches!(hir.kind(node), Kind::Identifier | Kind::QualifiedName)
                    && is_in_right_side_of_import_or_export_assignment(hir, node)
                || matches!(hir.kind(parent), Kind::TypeQuery | Kind::ExportSpecifier);
            if !ok {
                self.error(file, node, 2475, &[]);
            }
            // Imports of ambient `const` enums are checked in `checkAliasSymbol`.
            if (files.options.isolated_modules_reported
                || files.options.verbatim_module_syntax && ok && !resolves_to_import)
                && self.aliases_is_ambient_const_enum(symbol)
                && !is_valid_type_only_alias_use_site(hir, node)
            {
                self.error(file, node, 2748, &[Arg::Bytes(flag_name)]);
            }
            if hir.kind(parent) != Kind::ParenthesizedExpression {
                break;
            }
            node = parent;
        }
    }

    // ───────────────────────────── reserved names ─────────────────────────────

    /// `initializeChecker`, `addUndefinedToGlobalsOrErrorOnRedeclaration`: 2397
    fn check_x_built_in_global_names(&mut self, file: FileId) {
        let (bound, files) = (self.bound(file), self.files());
        let report = |c: &mut Self, decl: Decl, name: Atom| {
            if let Some((start, _)) = c.error_range_of_declaration(file, decl) {
                c.error_at((file, start, 0), 2397, &[Arg::Atom(name)]);
            }
        };
        // A script cannot declare `globalThis`, with any meaning.
        if !files.module(file).is_module()
            && let Some(symbol) = bound.lookup(bound.scopes[0].locals, known::globalThis)
        {
            for &decl in bound.symbols[symbol.idx()].decls.iter() {
                report(self, decl, known::globalThis);
            }
        }
        if let Some(&symbol) = files.globals.get(known::undefined) {
            for &(of, decl) in files.decls_of(files.canonical(symbol)).iter() {
                // `IsTypeDeclaration`
                let is_type = matches!(
                    decl,
                    Decl::Class(_) | Decl::Interface(_) | Decl::Alias(_) | Decl::Enum(_)
                );
                if of == file && !is_type {
                    report(self, decl, known::undefined);
                }
            }
        }
    }

    // ───────────────────────────── names that resolve after all ─────────────────────────────

    /// `Resolve`, at an enum declaration: 1281.
    fn check_x_names_from_other_files(&mut self, file: FileId) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        if !files.options.isolated_modules || hir.enums.is_empty() {
            return;
        }
        for &(e, scope) in &bound.free_idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            let mut at = scope;
            while at.is_some() {
                let s = &bound.scopes[at.idx()];
                at = s.parent;
                if s.symbol.is_none()
                    || matches!(s.kind, ScopeKind::File)
                    || !bound.symbols[s.symbol.idx()]
                        .flags
                        .contains(SymFlags::MERGED)
                {
                    continue;
                }
                // In an enum only its members are in scope; in a namespace, all but the members of an enum it is merged with
                // (`SymbolFlagsModuleMember`).
                let expected = if matches!(s.kind, ScopeKind::Enum(_)) {
                    SymFlags::ENUM_MEMBER
                } else {
                    SymFlags::VALUE.intersection(SymFlags::MODULE_MEMBER)
                };
                let Some(found) = files.export(files.sym(file, s.symbol), name) else {
                    continue;
                };
                let flags = files.flags(found);
                // `getSymbol`: an alias is matched by the meaning of its target, and an unresolved
                // alias matches any meaning.
                let is_intended = files.symbol_flags(found).intersects(expected);
                if !is_intended || flags.contains(SymFlags::EXPORT_ONLY) {
                    continue;
                }
                let start = hir[e].pos;
                if let ScopeKind::Enum(en) = s.kind
                    && !hir[en].flags.contains(Flags::AMBIENT)
                    && files.decls(found).first().is_some_and(|d| d.0 != file)
                {
                    let option = super::errors_modules::isolated_modules_like_flag_name(files);
                    let (of, member) = (self.atoms().bytes(hir[en].name), self.atoms().bytes(name));
                    let qualified = [of, b".", member].concat();
                    self.error_at(
                        (file, start, 0),
                        1281,
                        &[Arg::Atom(name), Arg::Bytes(option), Arg::Bytes(&qualified)],
                    );
                }
                break;
            }
        }
    }

    // ───────────────────────────── unresolved names ─────────────────────────────

    /// `maybeMappedType`
    pub(super) fn maybe_mapped_type(&mut self, file: FileId, mut node: Node, symbol: Sym) -> bool {
        let hir = self.hir(file);
        loop {
            node = hir.parent(node);
            if !matches!(
                hir.kind(node),
                Kind::ComputedPropertyName | Kind::PropertySignature
            ) {
                break;
            }
        }
        if !matches!(hir.data(node), NodeData::Type(t) if matches!(hir[t].kind, TypeNodeKind::Object(members) if members.len() == 1))
        {
            return false;
        }
        let Some(symbol) = self.files().resolve_alias_if_needed(symbol) else {
            return false;
        };
        let ty = self.declared_type(symbol);
        if !self.is_union(ty) {
            return false;
        }
        // `allTypesAssignableToKindEx(t, TypeFlagsStringOrNumberLiteral, strict)`. Strict mode rejects `any`, `unknown`, `void`,
        // `undefined` and `null` by flag, so every kind of `undefined` and `null` counts.
        for &part in self.parts(ty) {
            if self.is_any(part) || part == TypeId::UNKNOWN || self.is_nullish(part) {
                return false;
            }
            if !self.is_assignable(part, TypeId::NUMBER)
                && !self.is_assignable(part, TypeId::STRING)
            {
                return false;
            }
        }
        true
    }

    // ───────────────────────────── names that resolve where they must not be used
    // ─────────────────────────────

    /// `onSuccessfullyResolvedSymbol`: 2686, the UMD global name of a module is only for scripts.
    fn check_x_umd_globals(&mut self, file: FileId) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        for &(e, scope) in &bound.free_idents {
            if let ExprKind::Ident(name) = hir[e].kind
                && !bound.is_unchecked(e.idx())
                && resolves_to_umd_global(files, file, scope, name, SymFlags::VALUE)
            {
                self.error_at((file, hir[e].pos, 0), 2686, &[Arg::Atom(name)]);
            }
        }
    }

    /// `markJsxAliasReferenced`, where a name it looks up resolves: the JSX factory at every tag
    /// name, and at an opening fragment the fragment factory too.
    fn check_x_jsx_factories(&mut self, file: FileId) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let options = &files.options;
        // `jsxFactoryRefErr`: otherwise `Resolve` reports nothing.
        if hir.jsx.is_empty() || options.jsx != crate::resolve::JsxEmit::React {
            return;
        }
        // `getJsxNamespaceContainerForImplicitImport`
        let path = files.module(file).file_name();
        let implicit_import = crate::program::jsx_runtime_of(options, hir, &files.atoms)
            .filter(|_| path.ends_with(b".tsx") || path.ends_with(b".jsx"))
            .and_then(|spec| files.module_of_specifier(file, self.atoms().intern(&spec)));
        if implicit_import.is_some() {
            return;
        }
        let (factory, fragment_factory) = (
            super::errors_jsx::jsx_namespace(files, self.atoms(), hir, false),
            super::errors_jsx::jsx_namespace(files, self.atoms(), hir, true),
        );
        let looks_up_fragment_factory =
            fragment_factory != factory && self.atoms().bytes(fragment_factory) != b"null";
        let index = self.exprs_by_kind(file);
        for &e in index.of(ExprTag::Jsx) {
            let ExprKind::Jsx(jsx) = hir[e].kind else {
                continue;
            };
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            let scope = bound.expr_scope.get(&e).copied().unwrap_or(ScopeId(0));
            let is_opening_fragment = hir[jsx].tag.is_none();
            let jsx_factory_location = if is_opening_fragment {
                hir.node(e).with(Part::Opening)
            } else {
                hir.node(hir[jsx].tag)
            };
            let names = [
                (is_opening_fragment && looks_up_fragment_factory).then_some(fragment_factory),
                Some(factory),
            ];
            for name in names.into_iter().flatten() {
                let meaning = SymFlags::VALUE;
                if let Some(result) = files.resolve_name(file, scope, name, meaning) {
                    self.on_successfully_resolved_symbol(
                        file,
                        jsx_factory_location,
                        scope,
                        result,
                        meaning,
                    );
                }
            }
        }
    }

    /// `onSuccessfullyResolvedSymbol` for `result`, which a name looked up from `scope` resolved
    /// to, at an `error_location` that is not an identifier expression: those are checked by the
    /// passes over the identifiers of a file. 1361 and 1362 at a tag name are reported by
    /// `check_type_only_jsx_factory`; the first name of an import alias is a valid use site.
    pub(super) fn on_successfully_resolved_symbol(
        &mut self,
        file: FileId,
        error_location: Node,
        scope: ScopeId,
        result: Sym,
        meaning: SymFlags,
    ) {
        let (hir, files) = (self.hir(file), self.files());
        let classes_and_enums = SymFlags::CLASS | SymFlags::ENUM;
        if meaning.intersects(SymFlags::BLOCK_SCOPED_VARIABLE)
            || meaning.intersects(classes_and_enums) && meaning.contains(SymFlags::VALUE)
        {
            let export_or_local_symbol = files.export_symbol_of_value_symbol_if_exported(result);
            if files
                .flags(export_or_local_symbol)
                .intersects(SymFlags::BLOCK_SCOPED_VARIABLE | classes_and_enums)
            {
                self.check_resolved_block_scoped_variable(
                    file,
                    export_or_local_symbol,
                    error_location,
                );
            }
        }
        if !meaning.contains(SymFlags::VALUE) {
            return;
        }
        let name = files.symbol(result).name;
        if resolves_to_umd_global(files, file, scope, name, meaning) {
            self.error(file, error_location, 2686, &[Arg::Atom(name)]);
        }
        let associated_declaration =
            associated_declaration_for_containing_initializer_or_binding_name(hir, error_location);
        if associated_declaration.is_some() {
            self.check_reference_in_parameter(file, error_location, result, associated_declaration);
        }
        self.aliases_import_hiding_global_value(file, result, meaning);
    }
}

// ───────────────────────────── constant expressions ─────────────────────────────

/// The `location` of `evaluate`, and what is declared before or after it.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Location {
    Member(FileId, EnumMemberId),
    Variable(FileId, VarDeclId),
    Expr(FileId, ExprId),
}

impl Location {
    pub(super) fn file(self) -> FileId {
        match self {
            Location::Member(file, _) | Location::Variable(file, _) | Location::Expr(file, _) => {
                file
            }
        }
    }
}

pub(super) fn is_ambient_enum(hir: &hir::File, en: EnumId) -> bool {
    hir[en].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration
}

// ───────────────────────────── declaration order ─────────────────────────────

/// `isBlockScopedNameDeclaredBeforeUse`
pub(super) fn is_declared_before_use(
    c: &mut Checker<'_, '_>,
    declaration: Location,
    usage: Location,
) -> bool {
    let (file, node) = (usage.file(), |location: Location| match location {
        Location::Member(file, member) => c.hir(file).node(member),
        Location::Variable(file, d) => c.hir(file).node(d),
        Location::Expr(file, e) => c.hir(file).node(e),
    });
    let (declared, used) = (node(declaration), node(usage));
    // The order across files is undetermined.
    declaration.file() != file || c.is_block_scoped_name_declared_before_use(file, declared, used)
}

// ───────────────────────────── kinds of types and symbols ─────────────────────────────

/// `onSuccessfullyResolvedSymbol`: whether `name`, resolved from `scope` of `file`, a module, is
/// the UMD global name of a module, which is only for scripts.
pub(super) fn resolves_to_umd_global(
    files: &Files,
    file: FileId,
    scope: ScopeId,
    name: Atom,
    meaning: SymFlags,
) -> bool {
    !files.options.allow_umd_global_access
        && files.module(file).is_module()
        && umd_global(files, name).is_some_and(|global| {
            // `getSymbol`: an alias is matched by the meaning of its target.
            let flags = files.symbol_flags(global);
            files.resolve_name(file, scope, name, meaning) == Some(global)
                && flags != SymFlags::all()
                && flags.intersects(meaning)
        })
}

/// `Resolve`: `associatedDeclarationForContainingInitializerOrBindingName` of a name looked up from
/// `location`. `NONE`: it has none, or it is `withinDeferredContext` by then.
fn associated_declaration_for_containing_initializer_or_binding_name(
    hir: &hir::File,
    mut location: Node,
) -> Node {
    let mut last_location = Node::NONE;
    while location.is_some() {
        if get_is_deferred_context(hir, location, last_location) {
            return Node::NONE;
        }
        match hir.kind(location) {
            Kind::Decorator => {
                if hir.kind(hir.parent(location)) == Kind::Parameter {
                    location = hir.parent(location);
                }
                let parent = hir.kind(hir.parent(location));
                if parent.is_class_element() || parent == Kind::ClassDeclaration {
                    location = hir.parent(location);
                }
            }
            Kind::Parameter | Kind::BindingElement
                if last_location.is_some()
                    && (last_location == hir.initializer(location)
                        || last_location == hir.name(location)
                            && matches!(
                                hir.kind(last_location),
                                Kind::ObjectBindingPattern | Kind::ArrayBindingPattern
                            ))
                    && hir.kind(hir.get_root_declaration(location)) == Kind::Parameter =>
            {
                return location;
            }
            _ => {}
        }
        last_location = location;
        location = hir.parent(location);
    }
    Node::NONE
}

/// `getIsDeferredContext`
fn get_is_deferred_context(hir: &hir::File, location: Node, last_location: Node) -> bool {
    let kind = hir.kind(location);
    let is_in_name = last_location.is_some() && last_location == hir.name(location);
    if !matches!(kind, Kind::ArrowFunction | Kind::FunctionExpression) {
        return kind == Kind::TypeQuery
            || (kind.is_function_like_declaration()
                || kind == Kind::PropertyDeclaration && !hir.is_static(location))
                && !is_in_name;
    }
    !is_in_name
        && (hir
            .flags(location)
            .intersects(Flags::ASYNC | Flags::GENERATOR)
            || hir
                .get_immediately_invoked_function_expression(location)
                .is_none())
}

/// The global symbol named `name`, if it is declared only by `export as namespace name`.
fn umd_global(files: &Files, name: Atom) -> Option<Sym> {
    let symbol = *files.globals.get(name)?;
    (files.flags(symbol).contains(SymFlags::ALIAS)
        && files
            .decls(symbol)
            .iter()
            .all(|d| matches!(d.1, Decl::UmdGlobal(_))))
    .then_some(symbol)
}

const PRIMITIVE_TYPE_NAMES: [&[u8]; 6] = [
    b"any", b"string", b"number", b"boolean", b"never", b"unknown",
];

/// `isPrimitiveTypeName`
pub(super) fn is_primitive_type_name(name: &[u8]) -> bool {
    PRIMITIVE_TYPE_NAMES.contains(&name)
}

// ───────────────────────────── source positions ─────────────────────────────
