//! Enums and names: where a `const` enum can be written, and what is said of a name that is found, or is not, in a way that calls
//! for words of its own.
//!
//! 2475 2476, 2397, 1281, 2311 18004, 2690, 2686.
//!
//! Follows `isBlockScopedNameDeclaredBeforeUse`, `checkConstEnumAccess`, `checkElementAccessExpression`,
//! `initializeChecker`, `addUndefinedToGlobalsOrErrorOnRedeclaration`, `getCannotFindNameDiagnosticForName`,
//! `checkAndReportErrorForUsingTypeAsValue`, `maybeMappedType`, `allTypesAssignableToKindEx`,
//! `onSuccessfullyResolvedSymbol`, `checkImportEqualsDeclaration` and `markJsxAliasReferenced` of TypeScript 7.0.2's checker.go
//! and `Resolve` of its nameresolver.go.
//!
//! Comes after the passes that say that a name cannot be found: some of what they say is put in other words here.

use super::*;
use crate::bind::{Decl, Parent, ScopeId, ScopeKind};

impl Checker<'_> {
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
    }

    // ───────────────────────────── `const` enums ─────────────────────────────

    /// `checkConstEnumAccess`, of `e` and of each pair of parentheses around it, which is an expression of that type too.
    pub(super) fn check_const_enum_access(&mut self, file: FileId, e: ExprId, ty: TypeId) {
        let (hir, bound, options) = (self.hir(file), self.bound(file), &self.p.files.options);
        let parent = bound.expr_parent[e.idx()];
        // `typeof E.A` is made of names, not of property accesses.
        let in_type_query = bound.is_in_type_query(e);
        let is_object_of_access = !in_type_query
            && matches!(parent, Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e));
        // From the outside in: where each starts and ends.
        let own = error_start(self, file, e);
        let mut levels: Vec<(u32, u32)> = Vec::new();
        if let Some(open) = open_parenthesis(hir, e) {
            let inside = self.start_inside_parentheses(file, e) as usize;
            let mut at = open as usize;
            while at < inside && hir.text.get(at) == Some(&b'(') {
                levels.push((at as u32, self.end_of_expr_from(file, e, at as u32)));
                at = skip_trivia(&hir.text, at + 1);
            }
        }
        let is_parenthesized = !levels.is_empty();
        levels.extend(own.map(|start| (start, self.error_end_inside_parentheses(file, e))));
        // Only the outermost is where `e` seems to be, and only a name is at the right of an import or an export assignment.
        let is_ok = |level: usize| {
            level == 0
                && (is_object_of_access
                    || !is_parenthesized
                        && (in_type_query && !matches!(parent, Parent::Expr(_))
                            || matches!(hir[e].kind, ExprKind::Ident(_))
                                && matches!(parent, Parent::Stmt(s) if s.is_some() && matches!(hir[s].kind, StmtKind::ExportAssign(_) | StmtKind::ExportDefault(_)))))
        };
        let is_ambient = matches!(*self.data(ty), TypeData::Anon { origin: Origin::EnumObject(sym), .. } if self.xa_is_ambient_const_enum(sym))
            && !super::errors_modules::is_valid_type_only_alias_use_site(hir, hir.node(e));
        // Imports of ambient `const` enums are checked in `checkAliasSymbol`.
        let local = bound.expr_symbol[first_identifier(hir, e).idx()];
        let is_import =
            local.is_some() && bound.symbols[local.idx()].flags.contains(SymFlags::ALIAS);
        let flag_name = super::errors_x_modules::isolated_modules_like_flag_name(self.files());
        for (level, &(start, end)) in levels.iter().enumerate() {
            if !is_ok(level) {
                self.error_at((file, start, end), 2475, &[]);
            }
            if is_ambient
                && (options.isolated_modules_said
                    || options.verbatim_module_syntax && is_ok(level) && !is_import)
            {
                self.error_at((file, start, end), 2748, &[Arg::Bytes(flag_name)]);
            }
        }
    }

    // ───────────────────────────── names that are taken ─────────────────────────────

    /// `initializeChecker`, `addUndefinedToGlobalsOrErrorOnRedeclaration`: 2397
    fn check_x_built_in_global_names(&mut self, file: FileId) {
        let (bound, files) = (self.bound(file), self.files());
        let report = |c: &mut Self, decl: Decl, name: Atom| {
            if let Some((start, _)) = c.error_range_of_declaration(file, decl) {
                c.error_at((file, start, 0), 2397, &[Arg::Atom(name)]);
            }
        };
        // A script has no `globalThis` of its own, of whatever kind.
        if !files.module(file).is_module()
            && let Some(symbol) = bound.lookup(bound.scopes[0].locals, known::globalThis)
        {
            for &decl in bound.symbols[symbol.idx()].decls.iter() {
                report(self, decl, known::globalThis);
            }
        }
        if let Some(&symbol) = files.globals.get(&known::undefined) {
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

    // ───────────────────────────── names that are found after all ─────────────────────────────

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
                let wanted = if matches!(s.kind, ScopeKind::Enum(_)) {
                    SymFlags::ENUM_MEMBER
                } else {
                    SymFlags::VALUE.intersection(SymFlags::MODULE_MEMBER)
                };
                let Some(found) = files.export(files.sym(file, s.symbol), name) else {
                    continue;
                };
                let flags = files.flags(found);
                // `getSymbol`: an alias is found by what it stands for, and one that leads nowhere by anything.
                let is_meant = files.symbol_flags(found).intersects(wanted);
                if !is_meant || flags.contains(SymFlags::EXPORT_ONLY) {
                    continue;
                }
                let start = hir[e].pos;
                if let ScopeKind::Enum(en) = s.kind
                    && !hir[en].flags.contains(Flags::AMBIENT)
                    && files.decls(found).first().is_some_and(|d| d.0 != file)
                {
                    let option = super::errors_x_modules::isolated_modules_like_flag_name(files);
                    let (of, member) = (files.atoms.bytes(hir[en].name), files.atoms.bytes(name));
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

    // ───────────────────────────── names that are not found ─────────────────────────────

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
        if !self.is_known(ty) || !self.is_union(ty) {
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

    // ───────────────────────────── names that are found where they should not be looked for ─────────────────────────────

    /// `onSuccessfullyResolvedSymbol`: 2686, the name a module goes by globally is for scripts.
    fn check_x_umd_globals(&mut self, file: FileId) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let means_umd_global = |name: Atom, scope: ScopeId, meaning: SymFlags| {
            means_umd_global(files, file, scope, name, meaning)
        };
        for &(e, scope) in &bound.free_idents {
            if let ExprKind::Ident(name) = hir[e].kind
                && !bound.is_unchecked(e.idx())
                && means_umd_global(name, scope, SymFlags::VALUE)
            {
                self.error_at((file, hir[e].pos, 0), 2686, &[Arg::Atom(name)]);
            }
        }
        // `markJsxAliasReferenced`: what elements are made with is looked up at every tag, of a fragment what fragments are made with too.
        let options = &files.options;
        if hir.jsx.is_empty()
            || options.jsx != crate::resolve::JsxEmit::React
            || crate::program::jsx_runtime_of(options, hir, &files.atoms).is_some()
        {
            return;
        }
        let (factory, fragment_factory) = (
            super::errors_jsx::jsx_namespace(files, hir, false),
            super::errors_jsx::jsx_namespace(files, hir, true),
        );
        // The scope a tag is written in is not kept: whatever the file declares by the name, wherever, may be what is meant.
        let is_umd_global = |name: Atom| {
            means_umd_global(name, ScopeId(0), SymFlags::VALUE)
                && !bound.symbols.iter().any(|s| {
                    s.name == name
                        && s.flags.intersects(SymFlags::VALUE | SymFlags::ALIAS)
                        && !s.flags.intersects(SymFlags::CLASS_MEMBER)
                        && !s.flags.contains(SymFlags::TRANSIENT)
                })
        };
        let of_elements = is_umd_global(factory);
        let of_fragments = of_elements || is_umd_global(fragment_factory);
        if !of_fragments {
            return;
        }
        for (i, x) in hir.exprs.iter().enumerate() {
            let ExprKind::Jsx(jsx) = x.kind else { continue };
            if bound.is_unchecked(i) {
                continue;
            }
            if hir[jsx].tag.is_none() {
                let looked_up = if is_umd_global(fragment_factory) {
                    fragment_factory
                } else {
                    factory
                };
                let end = hir[jsx].opening_end;
                self.error_at((file, x.pos, end), 2686, &[Arg::Atom(looked_up)]);
            } else if of_elements {
                // The name of the tag, which follows the `<`.
                let start = skip_trivia(&hir.text, x.pos as usize + 1);
                self.error_at(
                    (
                        file,
                        start as u32,
                        jsx_tag_name_end(&hir.text, start) as u32,
                    ),
                    2686,
                    &[Arg::Atom(factory)],
                );
            }
        }
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

// ───────────────────────────── before and after ─────────────────────────────

/// `isBlockScopedNameDeclaredBeforeUse`
pub(super) fn is_declared_before_use(
    c: &mut Checker<'_>,
    declaration: Location,
    usage: Location,
) -> bool {
    let (file, node) = (usage.file(), |location: Location| match location {
        Location::Member(file, member) => c.hir(file).node(member),
        Location::Variable(file, d) => c.hir(file).node(d),
        Location::Expr(file, e) => c.hir(file).node(e),
    });
    let (declared, used) = (node(declaration), node(usage));
    // Between files there is no telling.
    declaration.file() != file || c.is_block_scoped_name_declared_before_use(file, declared, used)
}

// ───────────────────────────── kinds of types and symbols ─────────────────────────────

/// `onSuccessfullyResolvedSymbol`: whether `name`, looked for from `scope` of `file`, a module, is the name a module goes by globally,
/// which is for scripts.
pub(super) fn means_umd_global(
    files: &Files,
    file: FileId,
    scope: ScopeId,
    name: Atom,
    meaning: SymFlags,
) -> bool {
    !files.options.allow_umd_global_access
        && files.module(file).is_module()
        && umd_global(files, name).is_some_and(|global| {
            // `getSymbol`: an alias is found by what it stands for.
            let flags = files.symbol_flags(global);
            files.resolve_name(file, scope, name, meaning) == Some(global)
                && flags != SymFlags::all()
                && flags.intersects(meaning)
        })
}

/// What goes by `name` globally, if that is nothing but `export as namespace name`.
fn umd_global(files: &Files, name: Atom) -> Option<Sym> {
    let symbol = *files.globals.get(&name)?;
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

// ───────────────────────────── where things are written ─────────────────────────────

/// `GetErrorRangeForNode`, of `e` less the parentheses around it: where an error about it starts. `None`: it cannot be told.
fn error_start(c: &Checker<'_>, file: FileId, e: ExprId) -> Option<u32> {
    let hir = c.hir(file);
    match hir[e].kind {
        // The keyword is pointed at.
        ExprKind::Satisfies { ty, .. } => {
            let before = trim_trivia_end(hir.text.get(..hir[ty].pos as usize)?);
            before
                .ends_with(b"satisfies")
                .then(|| before.len() as u32 - 9)
        }
        // `<T>e`
        ExprKind::As { expr, ty } if hir[ty].pos < c.start_of(file, expr) => {
            let before = trim_trivia_end(hir.text.get(..hir[ty].pos as usize)?);
            before.ends_with(b"<").then(|| before.len() as u32 - 1)
        }
        ExprKind::As { expr, .. } => Some(c.start_of(file, expr)),
        // The name, of what has one.
        ExprKind::Fn(f) if hir[f].kind == FnKind::Expr && hir[f].name.is_some() => {
            Some(hir[f].name_pos)
        }
        ExprKind::Class(k) if hir[k].name.is_some() => Some(hir[k].name_pos),
        _ => Some(c.start_inside_parentheses(file, e)),
    }
}
