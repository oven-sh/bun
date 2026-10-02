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
            self.check_x_mapped_types_meant(file);
            return;
        }
        self.check_x_const_enum_accesses(file);
        self.check_x_built_in_global_names(file);
        self.check_x_names_from_other_files(file);
        self.check_x_words_for_missing_names(file);
        self.check_x_mapped_types_meant(file);
        self.check_x_umd_globals(file);
    }

    // ───────────────────────────── `const` enums ─────────────────────────────

    /// `checkConstEnumAccess`: 2475, of every expression that is the object a `const` enum would be if there were one.
    /// `checkElementAccessExpression`: 2476.
    fn check_x_const_enum_accesses(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.exprs.len() {
            let parent = bound.expr_parent[i];
            if bound.is_unchecked(i) {
                continue;
            }
            let e = ExprId(i as u32);
            match hir.exprs[i].kind {
                ExprKind::Index { obj, index, .. } => {
                    let object = self.type_of_expr(file, obj);
                    let object = if self.is_union(object) {
                        self.non_nullable(object)
                    } else {
                        object
                    };
                    if is_const_enum_object_type(self, object)
                        && !is_string_literal_like(hir, index)
                    {
                        if let Some(start) =
                            open_parenthesis(hir, index).or_else(|| error_start(self, file, index))
                        {
                            self.error_at((file, start, self.error_end_of(file, index)), 2476, &[]);
                        }
                        // It is in error, and what is in error can be anything.
                        continue;
                    }
                }
                ExprKind::Ident(_)
                | ExprKind::Dot { .. }
                | ExprKind::Call(_)
                | ExprKind::Cond { .. }
                | ExprKind::Assign { .. }
                | ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                    ..
                }
                | ExprKind::NonNull(_)
                | ExprKind::Satisfies { .. }
                | ExprKind::As { .. }
                | ExprKind::AsConst(_)
                | ExprKind::Await(_) => {}
                _ => continue,
            }
            let ty = self.type_of_expr(file, e);
            if !is_const_enum_object_type(self, ty) {
                continue;
            }
            // `typeof E.A` is made of names, not of property accesses.
            let in_type_query = bound.is_in_type_query(e);
            let is_object_of_access = !in_type_query
                && matches!(parent, Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e));
            let own = error_start(self, file, e);
            let Some(open) = open_parenthesis(hir, e) else {
                let ok = is_object_of_access
                    || in_type_query && !matches!(parent, Parent::Expr(_))
                    || matches!(hir.exprs[i].kind, ExprKind::Ident(_))
                        && matches!(parent, Parent::Stmt(s) if s.is_some() && matches!(hir[s].kind, StmtKind::ExportAssign(_) | StmtKind::ExportDefault(_)));
                if !ok && let Some(start) = own {
                    let end = self.error_end_inside_parentheses(file, e);
                    self.error_at((file, start, end), 2475, &[]);
                }
                continue;
            };
            // Each pair of parentheses is an expression of that type too, and only the outermost is where `e` seems to be.
            self.reported
                .extend(own.map(|start| Reported::bare((file, start, 0), 2475)));
            if let Some(start) = own {
                let end = self.error_end_inside_parentheses(file, e);
                self.note(start, end, 2475, &[]);
            }
            let inside = self.start_inside_parentheses(file, e) as usize;
            let mut at = open as usize;
            let mut is_outermost = true;
            while at < inside && hir.text.get(at) == Some(&b'(') {
                if !(is_outermost && is_object_of_access) {
                    let end = self.end_of_expr_from(file, e, at as u32);
                    self.error_at((file, at as u32, end), 2475, &[]);
                }
                is_outermost = false;
                at = skip_trivia(&hir.text, at + 1);
            }
        }
    }

    // ───────────────────────────── names that are taken ─────────────────────────────

    /// `initializeChecker`, `addUndefinedToGlobalsOrErrorOnRedeclaration`: 2397
    fn check_x_built_in_global_names(&mut self, file: FileId) {
        let (bound, files) = (self.bound(file), self.files());
        let report = |c: &mut Self, decl: Decl| {
            let range = c.error_range_of_declaration(file, decl);
            c.reported
                .extend(range.map(|(start, _)| Reported::bare((file, start, 0), 2397)));
        };
        // A script has no `globalThis` of its own, of whatever kind.
        if !files.module(file).is_module()
            && let Some(symbol) = bound.lookup(bound.scopes[0].locals, known::globalThis)
        {
            for &decl in bound.symbols[symbol.idx()].decls.iter() {
                report(self, decl);
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
                    report(self, decl);
                }
            }
        }
    }

    // ───────────────────────────── names that are found after all ─────────────────────────────

    /// The names nothing in the file declares that mean what another file adds to an enum or a namespace they are written in.
    /// `Resolve`, at an enum declaration: 1281.
    fn check_x_names_from_other_files(&mut self, file: FileId) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        if hir.enums.is_empty() && hir.modules.is_empty() {
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
                self.reported
                    .retain(|d| d.start != start || !is_name_not_found(d.code));
                if let ScopeKind::Enum(en) = s.kind
                    && files.options.isolated_modules
                    && !hir[en].flags.contains(Flags::AMBIENT)
                    && files.decls(found).first().is_some_and(|d| d.0 != file)
                {
                    let option = if files.options.verbatim_module_syntax {
                        "verbatimModuleSyntax"
                    } else {
                        "isolatedModules"
                    };
                    let name = self.atom_text(name);
                    let qualified = format!("{}.{name}", self.atom_text(hir[en].name));
                    self.error_at(
                        (file, start, 0),
                        1281,
                        &[
                            Arg::Text(&name),
                            Arg::Text(&option.to_owned()),
                            Arg::Text(&qualified),
                        ],
                    );
                }
                break;
            }
        }
    }

    // ───────────────────────────── names that are not found ─────────────────────────────

    /// `getCannotFindNameDiagnosticForName`: 2311 18004, where nothing more telling is known than that the name cannot be found.
    fn check_x_words_for_missing_names(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.reported.iter().any(|d| is_name_not_found(d.code)) {
            return;
        }
        for &(e, _) in &bound.free_idents {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            let start = hir[e].pos;
            let parent = bound.expr_parent[e.idx()];
            let is_shorthand = |parent: Parent| matches!(parent, Parent::Prop(p) if hir[p].kind == PropKind::Shorthand);
            let names_shorthand_property = match parent {
                // `{ a = 1 }`
                Parent::Expr(x)
                    if matches!(hir[x].kind, ExprKind::Assign { op: None, target, .. } if target == e)
                        && is_shorthand(bound.expr_parent[x.idx()]) =>
                {
                    // `checkShorthandPropertyAssignment`: outside a destructuring pattern only the initializer is checked.
                    if !self.is_assignment_target(file, x) {
                        self.reported
                            .retain(|d| d.start != start || !is_name_not_found(d.code));
                        continue;
                    }
                    true
                }
                Parent::Expr(_) => false,
                _ => is_shorthand(parent),
            };
            let Some(said) = self
                .reported
                .iter()
                .position(|d| d.start == start && d.code == 2304)
            else {
                continue;
            };
            if is_parenthesized(hir, e) {
                continue;
            }
            if self.files().atoms.bytes(name) == b"await"
                && matches!(parent, Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Call(_)))
            {
                self.reported[said].code = 2311;
            } else if names_shorthand_property {
                self.reported[said].code = 18004;
                self.note(start, 0, 18004, &[Arg::Atom(name)]);
            }
        }
    }

    /// `checkAndReportErrorForUsingTypeAsValue` with `maybeMappedType`: 2690 replaces the 2693 at `K` in `{ [K]: T }` and in
    /// `{ a: T = K }`, where `{ [P in K]: T }` may have been meant. `onFailedToResolveSymbol` stops at the first handler that reports
    /// and does not run for a name that resolves to a value, so a `K` without a 2693 is left alone.
    fn check_x_mapped_types_meant(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.reported.iter().any(|d| d.code == 2693) {
            return;
        }
        for i in 0..hir.types.len() {
            let TypeNodeKind::Object(members) = hir.types[i].kind else {
                continue;
            };
            let scope = bound.type_scope[i];
            if members.len() != 1 || bound.is_unchecked_type(i) {
                continue;
            }
            let member = &hir[members.at(0)];
            if member.kind != MemberKind::Property {
                continue;
            }
            // Only a computed property name and the property signature may lie between the identifier and the type literal:
            // `[(K)]` and `= (K)` do not qualify.
            let key = match member.key {
                PropKey::Computed(e) if text_before(hir, hir[e].pos).ends_with(b"[") => e,
                _ => ExprId::NONE,
            };
            let initializer = if !is_parenthesized(hir, member.init) {
                member.init
            } else {
                ExprId::NONE
            };
            for e in [key, initializer] {
                if e.is_none() {
                    continue;
                }
                let ExprKind::Ident(name) = hir[e].kind else {
                    continue;
                };
                let start = hir[e].pos;
                if !self
                    .reported
                    .iter()
                    .any(|d| d.start == start && d.code == 2693)
                    || !self.is_union_of_property_names(file, scope, name)
                {
                    continue;
                }
                for d in self.reported.iter_mut() {
                    if d.start == start && d.code == 2693 {
                        d.code = 2690;
                    }
                }
                let name = self.atom_text(name);
                let parameter = if name == "K" { "P" } else { "K" };
                self.note(start, 0, 2690, &[Arg::Text(&name), Arg::Text(parameter)]);
            }
        }
    }

    /// What `checkAndReportErrorForUsingTypeAsValue` and `maybeMappedType` require of the symbol: `name` resolves to a type that is
    /// not a value, and its declared type is a union of types assignable to `string` or `number`.
    fn is_union_of_property_names(&mut self, file: FileId, scope: ScopeId, name: Atom) -> bool {
        let files = self.files();
        // The error for a primitive type name is reported before any symbol is resolved.
        if is_primitive_type_name(files.atoms.bytes(name)) {
            return false;
        }
        let Some(symbol) = files
            .resolve_name(file, scope, name, SymFlags::TYPE)
            .and_then(|s| files.resolve_alias_if_needed(s))
        else {
            return false;
        };
        let flags = files.flags(symbol);
        if flags.intersects(SymFlags::VALUE) || !flags.intersects(SymFlags::TYPE) {
            return false;
        }
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
        // NEEDS: `Options::allow_umd_global_access` (`allowUmdGlobalAccess`), see requests/X-enums_names.md
        if files.options.allow_umd_global_access || !files.module(file).is_module() {
            return;
        }
        // `getSymbol`: an alias is found by what it stands for.
        let means_umd_global = |name: Atom, scope: ScopeId, meaning: SymFlags| {
            umd_global(files, name).is_some_and(|global| {
                let flags = files.symbol_flags(global);
                files.resolve_name(file, scope, name, meaning) == Some(global)
                    && flags != SymFlags::all()
                    && flags.intersects(meaning)
            })
        };
        for &(e, scope) in &bound.free_idents {
            if let ExprKind::Ident(name) = hir[e].kind
                && !bound.is_unchecked(e.idx())
                && means_umd_global(name, scope, SymFlags::VALUE)
            {
                self.error_at((file, hir[e].pos, 0), 2686, &[]);
            }
        }
        // `import a = N.b`
        for (i, import) in hir.import_equals.iter().enumerate() {
            let ImportEqualsTarget::Entity(names) = import.target else {
                continue;
            };
            let scope = bound.import_equals_scope[i];
            let Some(first) = hir.texts(names).next() else {
                continue;
            };
            if scope.is_none()
                || !means_umd_global(first, scope, SymFlags::VALUE | SymFlags::NAMESPACE)
            {
                continue;
            }
            // `checkImportEqualsDeclaration`: the first name is looked up as a value only once what is imported is known to be one.
            let path: Vec<Atom> = hir.texts(names).collect();
            let meaning = if path.len() == 1 {
                SymFlags::NAMESPACE
            } else {
                SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
            };
            let is_value = files
                .resolve_entity(file, scope, &path, meaning)
                .and_then(|target| files.resolve_alias_if_needed(target))
                .is_some_and(|target| files.flags(target).intersects(SymFlags::VALUE));
            if !is_value {
                continue;
            }
            // It is written after the `=`.
            let text = &hir.text[..];
            let equals = skip_trivia(
                text,
                import.name_pos as usize + files.atoms.bytes(import.name).len(),
            );
            if text.get(equals) != Some(&b'=') {
                continue;
            }
            let start = skip_trivia(text, equals + 1);
            if text[start..].starts_with(files.atoms.bytes(first)) {
                self.error_at((file, start as u32, 0), 2686, &[]);
            }
        }
        // `export { N }`, `export type { N }`: it is declared in a module, so that it is not the module's own is not what is wrong.
        for (i, export) in hir.exports.iter().enumerate() {
            let scope = bound.export_scope[i];
            if export.spec.is_some() || scope.is_none() {
                continue;
            }
            for s in export.items.iter() {
                let item = &hir[s];
                if means_umd_global(
                    item.local,
                    scope,
                    SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
                ) {
                    self.reported
                        .retain(|d| d.start != item.local_pos || d.code != 2661);
                    self.error_at((file, item.local_pos, 0), 2686, &[]);
                }
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

/// `isConstEnumObjectType`
#[inline]
fn is_const_enum_object_type(c: &Checker<'_>, ty: TypeId) -> bool {
    match *c.data(ty) {
        TypeData::Anon {
            origin: Origin::EnumObject(symbol),
            ..
        } => is_const_enum(c, symbol),
        _ => false,
    }
}

/// Whether every enum among the declarations of `symbol` is `const`, and there is one.
fn is_const_enum(c: &Checker<'_>, symbol: Sym) -> bool {
    let mut is_enum = false;
    for (file, decl) in c.files().decls(symbol) {
        if let Decl::Enum(en) = decl {
            if !c.hir(file)[en].flags.contains(Flags::CONST) {
                return false;
            }
            is_enum = true;
        }
    }
    is_enum
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

/// What is said of a name that means nothing where it is written.
fn is_name_not_found(code: u32) -> bool {
    matches!(
        code,
        2304 | 2503
            | 2552
            | 2583
            | 2584
            | 2585
            | 2591
            | 2592
            | 2593
            | 2662
            | 2663
            | 2689
            | 2693
            | 2702
            | 2708
            | 2709
            | 2713
            | 2749
            | 2833
            | 2863
            | 2868
    )
}

// ───────────────────────────── where things are written ─────────────────────────────

/// What is written before `pos`, up to the end of the last token. Nothing where the text is not kept.
fn text_before(hir: &hir::File, pos: u32) -> &[u8] {
    trim_trivia_end(hir.text.get(..pos as usize).unwrap_or(&[]))
}

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
