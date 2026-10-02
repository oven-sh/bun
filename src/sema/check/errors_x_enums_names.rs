//! Enums and names: what the initializers of enum members come to, where a `const` enum can be written, and what is said of a
//! name that is found, or is not, in a way that calls for words of its own.
//!
//! 1061 18056, 1066 18033 18055 2474 2477 2478, 2651 (and the 2565 that is decided next to it), 2475 2476, 2397, 1281, 2311 18004,
//! 2690, 2686.
//!
//! Follows `computeEnumMemberValues`, `computeEnumMemberValue`, `computeConstantEnumMemberValue`, `evaluateEntity`,
//! `evaluateEnumMember`, `isBlockScopedNameDeclaredBeforeUse`, `checkConstEnumAccess`, `checkElementAccessExpression`,
//! `initializeChecker`, `addUndefinedToGlobalsOrErrorOnRedeclaration`, `getCannotFindNameDiagnosticForName`,
//! `checkAndReportErrorForUsingTypeAsValue`, `maybeMappedType`, `allTypesAssignableToKindEx`,
//! `onSuccessfullyResolvedSymbol`, `checkImportEqualsDeclaration` and `markJsxAliasReferenced` of TypeScript 7.0.2's checker.go,
//! `NewEvaluator` of its evaluator.go and `Resolve` of its nameresolver.go.
//!
//! Comes after the passes that say that a name cannot be found: some of what they say is put in other words here.

use super::decl::{Evaluated, Evaluator};
use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, Parent, ScopeId, ScopeKind, SymbolId};
use crate::util::FxHashSet;

impl Checker<'_> {
    pub(super) fn check_x_enums_names(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.has_errors || hir.kind == FileKind::Json {
            return;
        }
        // `checkEnumDeclaration`, `initializeChecker` and `checkAndReportErrorForUsingTypeAsValue` apply to declaration files too. The
        // other passes only support source files.
        if hir.kind == FileKind::Declaration {
            self.check_x_enum_member_values(file, out);
            self.check_x_built_in_global_names(file, out);
            self.check_x_mapped_types_meant(file, out);
            return;
        }
        self.check_x_enum_member_values(file, out);
        self.check_x_const_enum_accesses(file, out);
        self.check_x_built_in_global_names(file, out);
        self.check_x_names_from_other_files(file, out);
        self.check_x_words_for_missing_names(file, out);
        self.check_x_mapped_types_meant(file, out);
        self.check_x_umd_globals(file, out);
    }

    // ───────────────────────────── the values of enum members ─────────────────────────────

    /// `checkEnumDeclaration`, as far as the values of the members go, and the other places `evaluate` is called from:
    /// `checkTemplateExpression`, and `checkBinaryLikeExpression` for what something is shifted by.
    fn check_x_enum_member_values(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What is evaluated besides the members, in the order it is written.
        let by_kind = self.exprs_by_kind(file);
        let mut evaluated: Vec<ExprId> = Vec::new();
        for tag in [ExprTag::Template, ExprTag::Binary, ExprTag::Assign] {
            evaluated.extend(by_kind.of(tag).iter().copied().filter(|&e| {
                let is_evaluated = match hir[e].kind {
                    ExprKind::Template { exprs, .. } => {
                        !exprs.is_empty()
                            && !matches!(bound.expr_parent[e.idx()], Parent::Expr(p)
                                if matches!(hir[p].kind, ExprKind::TaggedTemplate(c) if hir[c].template == e))
                    }
                    ExprKind::Binary {
                        op: BinOp::Shl | BinOp::Shr | BinOp::UShr,
                        right,
                        ..
                    }
                    | ExprKind::Assign {
                        op: Some(BinOp::Shl | BinOp::Shr | BinOp::UShr),
                        value: right,
                        ..
                    } => !matches!(hir[right].kind, ExprKind::Number(_)),
                    _ => false,
                };
                is_evaluated && !bound.is_unchecked(e.idx())
            }));
        }
        if evaluated.is_empty() && hir.enums.is_empty() {
            return;
        }
        evaluated.sort_unstable();
        let mut values = EnumValues {
            c: self,
            file,
            computed: FxHashSet::default(),
            values: FxHashMap::default(),
            variables: Vec::new(),
            errors: Vec::new(),
            unsure: false,
            unsure_members: FxHashSet::default(),
            gave_up: false,
        };
        for i in 0..hir.enums.len() {
            if bound.enum_symbol[i].is_some() {
                values.compute_enum_member_values(file, EnumId(i as u32));
            }
        }
        for e in evaluated {
            match hir[e].kind {
                ExprKind::Template { .. } => {
                    values.evaluate(file, e, Location::Expr(file, e));
                }
                ExprKind::Binary { left, right, .. }
                | ExprKind::Assign {
                    target: left,
                    value: right,
                    ..
                } => {
                    // Only once both operands have passed for numbers, `null` and `undefined` aside (`checkNonNullType`).
                    let (l, r) = (
                        values.c.type_of_expr(file, left),
                        values.c.type_of_expr(file, right),
                    );
                    if !values.c.is_known(l) || !values.c.is_known(r) {
                        continue;
                    }
                    let (l, r) = (values.c.non_nullable(l), values.c.non_nullable(r));
                    let numeric = values.c.union(&[TypeId::NUMBER, TypeId::BIGINT]);
                    if values.c.is_assignable(l, numeric) && values.c.is_assignable(r, numeric) {
                        values.evaluate(file, right, Location::Expr(file, right));
                    }
                }
                _ => {}
            }
        }
        out.append(&mut values.errors);
    }

    // ───────────────────────────── `const` enums ─────────────────────────────

    /// `checkConstEnumAccess`: 2475, of every expression that is the object a `const` enum would be if there were one.
    /// `checkElementAccessExpression`: 2476.
    fn check_x_const_enum_accesses(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
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
                        && !self.is_uncertain(file, obj)
                        && !is_string_literal_like(hir, index)
                    {
                        if let Some(start) =
                            open_parenthesis(hir, index).or_else(|| error_start(self, file, index))
                        {
                            out.push(Diagnostic { start, code: 2476 });
                            self.note(start, self.error_end_of(file, index), 2476, Vec::new());
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
            if !is_const_enum_object_type(self, ty) || self.is_uncertain(file, e) {
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
                    out.push(Diagnostic { start, code: 2475 });
                    let end = self.error_end_inside_parentheses(file, e);
                    self.note(start, end, 2475, Vec::new());
                }
                continue;
            };
            // Each pair of parentheses is an expression of that type too, and only the outermost is where `e` seems to be.
            out.extend(own.map(|start| Diagnostic { start, code: 2475 }));
            if let Some(start) = own {
                let end = self.error_end_inside_parentheses(file, e);
                self.note(start, end, 2475, Vec::new());
            }
            let inside = self.start_inside_parentheses(file, e) as usize;
            let mut at = open as usize;
            let mut is_outermost = true;
            while at < inside && hir.text.get(at) == Some(&b'(') {
                if !(is_outermost && is_object_of_access) {
                    out.push(Diagnostic {
                        start: at as u32,
                        code: 2475,
                    });
                    let end = self.end_of_expr_from(file, e, at as u32);
                    self.note(at as u32, end, 2475, Vec::new());
                }
                is_outermost = false;
                at = skip_trivia(&hir.text, at + 1);
            }
        }
    }

    // ───────────────────────────── names that are taken ─────────────────────────────

    /// `initializeChecker`, `addUndefinedToGlobalsOrErrorOnRedeclaration`: 2397
    fn check_x_built_in_global_names(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (bound, files) = (self.bound(file), self.files());
        let mut report = |decl: Decl| {
            let range = self.error_range_of_declaration(file, decl);
            out.extend(range.map(|(start, _)| Diagnostic { start, code: 2397 }));
        };
        // A script has no `globalThis` of its own, of whatever kind.
        if !files.module(file).is_module()
            && let Some(symbol) = bound.lookup(bound.scopes[0].locals, known::globalThis)
        {
            for &decl in bound.symbols[symbol.idx()].decls.iter() {
                report(decl);
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
                    report(decl);
                }
            }
        }
    }

    // ───────────────────────────── names that are found after all ─────────────────────────────

    /// The names nothing in the file declares that mean what another file adds to an enum or a namespace they are written in.
    /// `Resolve`, at an enum declaration: 1281.
    fn check_x_names_from_other_files(&self, file: FileId, out: &mut Vec<Diagnostic>) {
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
                    SymFlags::VALUE.difference(SymFlags::ENUM_MEMBER)
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
                out.retain(|d| d.start != start || !is_name_not_found(d.code));
                if let ScopeKind::Enum(en) = s.kind
                    && files.options.isolated_modules
                    && !hir[en].flags.contains(Flags::AMBIENT)
                    && files.decls(found).first().is_some_and(|d| d.0 != file)
                {
                    out.push(Diagnostic { start, code: 1281 });
                    let option = if files.options.verbatim_module_syntax {
                        "verbatimModuleSyntax"
                    } else {
                        "isolatedModules"
                    };
                    let name = self.atom_text(name);
                    let qualified = format!("{}.{name}", self.atom_text(hir[en].name));
                    self.note(start, 0, 1281, vec![name, option.to_owned(), qualified]);
                }
                break;
            }
        }
    }

    // ───────────────────────────── names that are not found ─────────────────────────────

    /// `getCannotFindNameDiagnosticForName`: 2311 18004, where nothing more telling is known than that the name cannot be found.
    fn check_x_words_for_missing_names(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !out.iter().any(|d| is_name_not_found(d.code)) {
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
                        out.retain(|d| d.start != start || !is_name_not_found(d.code));
                        continue;
                    }
                    true
                }
                Parent::Expr(_) => false,
                _ => is_shorthand(parent),
            };
            let Some(said) = out.iter().position(|d| d.start == start && d.code == 2304) else {
                continue;
            };
            if is_parenthesized(hir, e) {
                continue;
            }
            if self.files().atoms.bytes(name) == b"await"
                && matches!(parent, Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Call(_)))
            {
                out[said].code = 2311;
            } else if names_shorthand_property {
                out[said].code = 18004;
                self.note(start, 0, 18004, vec![self.atom_text(name)]);
            }
        }
    }

    /// `checkAndReportErrorForUsingTypeAsValue` with `maybeMappedType`: 2690 replaces the 2693 at `K` in `{ [K]: T }` and in
    /// `{ a: T = K }`, where `{ [P in K]: T }` may have been meant. `onFailedToResolveSymbol` stops at the first handler that reports
    /// and does not run for a name that resolves to a value, so a `K` without a 2693 is left alone.
    fn check_x_mapped_types_meant(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !out.iter().any(|d| d.code == 2693) {
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
                if !out.iter().any(|d| d.start == start && d.code == 2693)
                    || !self.is_union_of_property_names(file, scope, name)
                {
                    continue;
                }
                for d in out.iter_mut() {
                    if d.start == start && d.code == 2693 {
                        d.code = 2690;
                    }
                }
                let name = self.atom_text(name);
                let parameter = if name == "K" { "P" } else { "K" };
                self.note(start, 0, 2690, vec![name, parameter.to_owned()]);
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
    fn check_x_umd_globals(&self, file: FileId, out: &mut Vec<Diagnostic>) {
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
                out.push(Diagnostic {
                    start: hir[e].pos,
                    code: 2686,
                });
            }
        }
        // `import a = N.b`
        for (i, import) in hir.import_equals.iter().enumerate() {
            let ImportEqualsTarget::Entity(names) = import.target else {
                continue;
            };
            let scope = bound.import_equals_scope[i];
            let Some(first) = hir.ids(names).next() else {
                continue;
            };
            if scope.is_none()
                || !means_umd_global(first, scope, SymFlags::VALUE | SymFlags::NAMESPACE)
            {
                continue;
            }
            // `checkImportEqualsDeclaration`: the first name is looked up as a value only once what is imported is known to be one.
            let path: Vec<Atom> = hir.ids(names).collect();
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
                out.push(Diagnostic {
                    start: start as u32,
                    code: 2686,
                });
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
                    out.retain(|d| d.start != item.local_pos || d.code != 2661);
                    out.push(Diagnostic {
                        start: item.local_pos,
                        code: 2686,
                    });
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
                out.push(Diagnostic {
                    start: x.pos,
                    code: 2686,
                });
                let looked_up = if is_umd_global(fragment_factory) {
                    fragment_factory
                } else {
                    factory
                };
                let end = hir[jsx].opening_end;
                self.note(x.pos, end, 2686, vec![self.atom_text(looked_up)]);
            } else if of_elements {
                // The name of the tag, which follows the `<`.
                let start = skip_trivia(&hir.text, x.pos as usize + 1);
                out.push(Diagnostic {
                    start: start as u32,
                    code: 2686,
                });
                self.note(
                    start as u32,
                    jsx_tag_name_end(&hir.text, start) as u32,
                    2686,
                    vec![self.atom_text(factory)],
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

/// The values of the members of the enums that have been asked about, as `enumMemberLinks` has them.
struct EnumValues<'c, 'p> {
    c: &'c mut Checker<'p>,
    /// The file whose errors are wanted.
    file: FileId,
    /// `NodeCheckFlagsEnumValuesComputed`: the declarations that have been gone through, or are being.
    computed: FxHashSet<(FileId, EnumId)>,
    values: FxHashMap<(FileId, EnumMemberId), Evaluated>,
    /// The constants whose initializers are being evaluated.
    variables: Vec<(FileId, VarDeclId)>,
    errors: Vec<Diagnostic>,
    /// Since it was last reset, a name could not be followed to what it means for want of something that is not kept here.
    unsure: bool,
    /// The members whose values rest on such a name. Nothing is said of them, nor of a member for coming after one.
    unsure_members: FxHashSet<(FileId, EnumMemberId)>,
    /// Something was left unevaluated for lack of room: nothing more is said.
    gave_up: bool,
}

impl EnumValues<'_, '_> {
    fn error(&mut self, file: FileId, start: u32, code: u32) {
        if file == self.file && !self.gave_up {
            self.errors.push(Diagnostic { start, code });
        }
    }

    /// `error`, at the name of a member of an enum.
    fn error_at_name(&mut self, file: FileId, start: u32, code: u32) {
        if file == self.file && !self.gave_up {
            self.errors.push(Diagnostic { start, code });
            let end = self.c.end_of_name_at(file, start);
            self.c.note(start, end, code, Vec::new());
        }
    }

    /// `computeEnumMemberValues`
    fn compute_enum_member_values(&mut self, file: FileId, en: EnumId) {
        if !self.computed.insert((file, en)) {
            return;
        }
        let mut auto_value = Some(0.0);
        let mut previous = EnumMemberId::NONE;
        for member in self.c.hir(file)[en].members.iter() {
            let result = self.compute_enum_member_value(file, en, member, auto_value, previous);
            self.values.insert((file, member), result);
            auto_value = match result.value {
                Some(EnumValue::Number(n)) => Some(f64::from_bits(n) + 1.0),
                _ => None,
            };
            previous = member;
        }
    }

    /// `getEnumMemberValue`. A member that is asked about while it is on its way to a value has none.
    fn enum_member_value(&mut self, file: FileId, member: EnumMemberId) -> Evaluated {
        let owner = self.c.bound(file).enum_member_owner[member.idx()];
        if owner.is_some() {
            self.compute_enum_member_values(file, owner);
        }
        self.values
            .get(&(file, member))
            .copied()
            .unwrap_or_default()
    }

    /// `computeEnumMemberValue`
    fn compute_enum_member_value(
        &mut self,
        file: FileId,
        en: EnumId,
        member: EnumMemberId,
        auto_value: Option<f64>,
        previous: EnumMemberId,
    ) -> Evaluated {
        let hir = self.c.hir(file);
        self.check_enum_member_name(file, member);
        if hir[member].init.is_some() {
            return self.compute_constant_enum_member_value(file, en, member);
        }
        // What an ambient enum that is not `const` does not say is worked out elsewhere.
        if is_ambient_enum(hir, en) && !hir[en].flags.contains(Flags::CONST) {
            return Evaluated::default();
        }
        // One more than the member before, which has to be a number then.
        let Some(auto_value) = auto_value else {
            if self.unsure_members.contains(&(file, previous)) {
                self.unsure_members.insert((file, member));
            } else {
                self.error_at_name(file, hir[member].pos, 1061);
            }
            return Evaluated::default();
        };
        if self.c.p.files.options.isolated_modules
            && previous.is_some()
            && hir[previous].init.is_some()
        {
            let before = self.enum_member_value(file, previous);
            if !matches!(before.value, Some(EnumValue::Number(_))) || before.resolved_other_files {
                self.error_at_name(file, hir[member].pos, 18056);
            }
        }
        Evaluated::number(auto_value)
    }

    /// The name checks at the top of `computeEnumMemberValue`: 1164 for `[e]`, 2452 for a bigint or a numeric name. Plain errors:
    /// parse errors do not silence them.
    fn check_enum_member_name(&mut self, file: FileId, member: EnumMemberId) {
        let hir = self.c.hir(file);
        let (name, pos) = (hir[member].name, hir[member].pos);
        let source = hir.text.get(pos as usize..).unwrap_or_default();
        // `IsComputedNonLiteralName`: `["a"]` and `[1]` are named by their literal, any other `[e]` has no name.
        if source.first() == Some(&b'[') && (name.is_none() || name == known::empty) {
            self.error_at_name(file, pos, 1164);
            return;
        }
        let is_bigint = is_bigint_literal_at(hir, pos);
        let is_numeric = name.is_some()
            && self.c.is_numeric_name(name)
            && !matches!(
                self.c.files().atoms.bytes(name),
                b"Infinity" | b"-Infinity" | b"NaN"
            );
        if is_bigint || is_numeric {
            self.error_at_name(file, pos, 2452);
        }
    }

    /// `computeConstantEnumMemberValue`
    fn compute_constant_enum_member_value(
        &mut self,
        file: FileId,
        en: EnumId,
        member: EnumMemberId,
    ) -> Evaluated {
        let hir = self.c.hir(file);
        let is_const = hir[en].flags.contains(Flags::CONST);
        let initializer = hir[member].init;
        let outer = std::mem::take(&mut self.unsure);
        let result = self.evaluate(file, initializer, Location::Member(file, member));
        if std::mem::replace(&mut self.unsure, outer) {
            self.unsure_members.insert((file, member));
            return result;
        }
        if file != self.file || matches!(hir[initializer].kind, ExprKind::Missing) {
            return result;
        }
        let Some(start) = start_of_enum_initializer(self.c, file, member) else {
            return result;
        };
        match result.value {
            Some(value) => {
                if is_const
                    && let EnumValue::Number(n) = value
                    && !f64::from_bits(n).is_finite()
                {
                    let code = if f64::from_bits(n).is_nan() {
                        2478
                    } else {
                        2477
                    };
                    self.error(file, start, code);
                    let end = self.c.error_end_of(file, initializer);
                    self.c.note(start, end, code, Vec::new());
                }
                if self.c.p.files.options.isolated_modules
                    && matches!(value, EnumValue::String(_))
                    && !result.is_syntactically_string
                {
                    self.error(file, start, 18055);
                    let name = format!(
                        "{}.{}",
                        self.c.atom_text(hir[en].name),
                        self.c.atom_text(hir[member].name)
                    );
                    let end = self.c.error_end_of(file, initializer);
                    self.c.note(start, end, 18055, vec![name]);
                }
            }
            None if is_const => {
                self.error(file, start, 2474);
                let end = self.c.error_end_of(file, initializer);
                self.c.note(start, end, 2474, Vec::new());
            }
            None if is_ambient_enum(hir, en) => {
                self.error(file, start, 1066);
                let end = self.c.error_end_of(file, initializer);
                self.c.note(start, end, 1066, Vec::new());
            }
            None => {
                let ty = self.c.type_of_expr(file, initializer);
                if self.c.is_known(ty) && !self.c.is_uncertain(file, initializer) {
                    // What a comparison that was cut short answered is not to be told.
                    let gave_up_before = std::mem::take(&mut self.c.relation_gave_up);
                    let fits = self.c.is_assignable(ty, TypeId::NUMBER);
                    let is_sure = !self.c.relation_gave_up && !self.c.timed_out();
                    self.c.relation_gave_up |= gave_up_before;
                    if !fits && is_sure {
                        self.error(file, start, 18033);
                        let end = self.c.error_end_of(file, initializer);
                        let relation = super::relate::Relation::Assignable;
                        self.c.explain_to(start, end, 18033, |c| {
                            let lines =
                                c.relation_lines(ty, TypeId::NUMBER, relation, Some(18033), 0);
                            match lines.into_iter().next() {
                                Some(head) if head.code == 18033 => head.args,
                                _ => {
                                    let (given, wanted) =
                                        c.type_names_for_error_display(ty, TypeId::NUMBER);
                                    vec![given, wanted]
                                }
                            }
                        });
                        self.c.explain_chain(start, 18033, |c| {
                            c.relation_chain_under(ty, TypeId::NUMBER, relation, 18033)
                        });
                        self.c.relate(start, 18033, |c| {
                            c.assignability_related(ty, TypeId::NUMBER)
                        });
                    }
                }
            }
        }
        result
    }

    /// `resolveEntityName(e, meaning, ignoreErrors)`, of `a` and of `a.b.c`, in what is evaluated for `location`.
    fn resolve_entity_name(
        &mut self,
        file: FileId,
        e: ExprId,
        meaning: SymFlags,
        location: Location,
    ) -> Option<Sym> {
        let (hir, files) = (self.c.hir(file), self.c.files());
        let symbol = match hir[e].kind {
            ExprKind::Ident(name) => {
                let bound = self.c.bound(file);
                let local = bound.expr_symbol[e.idx()];
                let found = if local.is_some() {
                    Some(files.sym(file, local))
                } else if let Some(scope) = self.scope_of_free_name(file, e) {
                    files.resolve_name(file, scope, name, meaning)
                } else {
                    self.unsure = true;
                    return None;
                };
                // `Resolve`, at an enum declaration: of what the symbol of the enum exports only the members are in scope, for what
                // a member can mean. Past anything else the search goes on outside: `enum E { E, F = E.E }`.
                let left_behind = match (found, location) {
                    (Some(found), _) if files.flags(found).contains(SymFlags::ENUM_MEMBER) => {
                        if local.is_none() || meaning.intersects(SymFlags::ENUM_MEMBER) {
                            SymbolId::NONE
                        } else {
                            bound.symbols[local.idx()].parent
                        }
                    }
                    (Some(found), Location::Member(of, member)) if of == file => {
                        let around = bound.enum_symbol[bound.enum_member_owner[member.idx()].idx()];
                        let parent = files.symbol(found).parent;
                        if parent.is_some()
                            && files.sym(found.file, parent) == files.sym(file, around)
                        {
                            around
                        } else {
                            SymbolId::NONE
                        }
                    }
                    _ => SymbolId::NONE,
                };
                let found = if left_behind.is_some() {
                    let outside = bound
                        .scopes
                        .iter()
                        .find(|s| matches!(s.kind, ScopeKind::Enum(_)) && s.symbol == left_behind)?
                        .parent;
                    files.resolve_name(file, outside, name, meaning)
                } else {
                    found
                };
                match found {
                    Some(found) if files.flags(found).intersects(meaning | SymFlags::ALIAS) => {
                        found
                    }
                    // Something else by the name is nearer, and the scope the name is written in is not kept: whether a namespace
                    // further out is meant cannot be told, if there is one at all.
                    Some(_) => {
                        self.unsure |= !matches!(location, Location::Expr(..))
                            && (files.global(name, meaning).is_some()
                                || bound.symbols.iter().any(|s| {
                                    s.name == name
                                        && s.flags.intersects(meaning | SymFlags::ALIAS)
                                        && !s.flags.contains(SymFlags::TRANSIENT)
                                }));
                        return None;
                    }
                    // What declares it may be among what was given up on.
                    None => {
                        self.unsure |= hir.syntax_errors > 0;
                        return None;
                    }
                }
            }
            // `globalThis`, which exports what is global.
            ExprKind::Dot { obj, name, .. }
                if matches!(hir[obj].kind, ExprKind::Ident(known::globalThis))
                    && self.c.bound(file).expr_symbol[obj.idx()].is_none() =>
            {
                files.global(name, meaning)?
            }
            ExprKind::Dot { obj, name, .. } => {
                let namespace =
                    self.resolve_entity_name(file, obj, SymFlags::NAMESPACE, location)?;
                files.namespace_member(namespace, name)?
            }
            _ => return None,
        };
        // An alias is followed to what has the meaning.
        let symbol = if files.flags(symbol).intersects(meaning) {
            symbol
        } else if let Some(target) = files.resolve_alias(symbol) {
            target
        } else {
            self.unsure = true;
            return None;
        };
        files.flags(symbol).intersects(meaning).then_some(symbol)
    }

    /// The scope the name `e`, which nothing in its file declares as a value, is written in.
    fn scope_of_free_name(&self, file: FileId, e: ExprId) -> Option<ScopeId> {
        let free = &self.c.bound(file).free_idents;
        let at = free.binary_search_by_key(&e, |f| f.0).ok()?;
        Some(free[at].1)
    }
}

impl<'p> Evaluator<'p> for EnumValues<'_, 'p> {
    fn checker(&mut self) -> &mut Checker<'p> {
        self.c
    }

    fn give_up(&mut self) {
        self.gave_up = true;
    }

    fn resolve_entity_name(&mut self, file: FileId, e: ExprId, location: Location) -> Option<Sym> {
        self.resolve_entity_name(file, e, SymFlags::VALUE, location)
    }

    fn enter_variable(&mut self, file: FileId, d: VarDeclId) -> bool {
        let is_new = !self.variables.contains(&(file, d));
        if is_new {
            self.variables.push((file, d));
        }
        is_new
    }

    fn leave_variable(&mut self) {
        self.variables.pop();
    }

    fn report(&mut self, file: FileId, e: ExprId, code: u32, symbol: Sym) {
        let start = self.c.start_inside_parentheses(file, e);
        self.error(file, start, code);
        if file == self.file {
            let end = self.c.end_inside_parentheses(file, e);
            if code == 2565 {
                self.c
                    .explain_to(start, end, code, |c| vec![c.symbol_to_string(symbol)]);
            } else {
                self.c.note(start, end, code, Vec::new());
            }
        }
    }

    fn enum_member_value_at(
        &mut self,
        file: FileId,
        member: EnumMemberId,
        _: Location,
    ) -> Evaluated {
        let value = self.enum_member_value(file, member);
        self.unsure |= self.unsure_members.contains(&(file, member));
        value
    }
}

fn is_ambient_enum(hir: &hir::File, en: EnumId) -> bool {
    hir[en].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration
}

// ───────────────────────────── before and after ─────────────────────────────

/// `isBlockScopedNameDeclaredBeforeUse`, of a member of an enum or of a variable declared by name.
pub(super) fn is_declared_before_use(
    c: &Checker<'_>,
    declaration: Location,
    usage: Location,
) -> bool {
    let file = usage.file();
    // Between files there is no telling.
    if declaration.file() != file || is_in_ambient_or_type_node(c, usage) {
        return true;
    }
    if position(c, declaration) <= position(c, usage) {
        return match declaration {
            // `isImmediatelyUsedInInitializerOfBlockScopedVariable`
            Location::Variable(_, d) => !is_in_initializer_of(c, usage, d),
            _ => true,
        };
    }
    // `export = x` only says what is to be had.
    if let Location::Expr(_, e) = usage
        && let Parent::Stmt(s) = c.bound(file).expr_parent[e.idx()]
        && s.is_some()
        && matches!(c.hir(file)[s].kind, StmtKind::ExportAssign(_))
        && !is_parenthesized(c.hir(file), e)
    {
        return true;
    }
    is_use_deferred(c, usage, declaration)
}

fn position(c: &Checker<'_>, location: Location) -> u32 {
    match location {
        Location::Member(file, member) => c.hir(file)[member].pos,
        Location::Variable(file, d) => {
            let hir = c.hir(file);
            hir[hir[d].pat].pos
        }
        Location::Expr(file, e) => c.start_of(file, e),
    }
}

/// What `location` is directly in, for going outwards from.
fn parent_of_location(c: &Checker<'_>, location: Location) -> Parent {
    match location {
        Location::Member(_, member) => Parent::EnumInit(member),
        Location::Variable(_, d) => Parent::VarInit(d),
        Location::Expr(file, e) => step_out(c, file, Parent::Expr(e)),
    }
}

/// What is around what `parent` stands for, enums and the names of properties and members included.
fn step_out(c: &Checker<'_>, file: FileId, parent: Parent) -> Parent {
    let (hir, bound) = (c.hir(file), c.bound(file));
    match parent {
        Parent::EnumInit(member) => {
            let owner = bound.enum_member_owner[member.idx()];
            let statement = (0..hir.stmts.len() as u32)
                .map(StmtId)
                .find(|&s| matches!(hir[s].kind, StmtKind::Enum(en) if en == owner));
            Parent::Stmt(statement.unwrap_or(StmtId::NONE))
        }
        Parent::PropKey(owner, _) if owner.is_some() => Parent::Expr(owner),
        // The name of a method or an accessor is part of the function; that of a property is worked out where the class is.
        Parent::Expr(key)
            if matches!(
                bound.expr_parent[key.idx()],
                Parent::MemberKey(_) | Parent::MethodKey(_)
            ) =>
        {
            match hir
                .members
                .iter()
                .position(|m| m.key == PropKey::Computed(key))
            {
                Some(m) if hir.members[m].func.is_some() => Parent::FnBody(hir.members[m].func),
                Some(m) => c.outward(file, Parent::MemberInit(MemberId(m as u32))),
                // Of a method of an object literal.
                None => bound.expr_parent[key.idx()],
            }
        }
        _ => c.outward(file, parent),
    }
}

/// `isInAmbientOrTypeNode`. Where the way out is lost track of, it is taken to be.
fn is_in_ambient_or_type_node(c: &Checker<'_>, usage: Location) -> bool {
    let file = usage.file();
    let (hir, bound) = (c.hir(file), c.bound(file));
    let mut parent = parent_of_location(c, usage);
    loop {
        match parent {
            // What is in something ambient says so itself.
            Parent::EnumInit(member) => {
                return is_ambient_enum(hir, bound.enum_member_owner[member.idx()]);
            }
            Parent::VarInit(d) if hir[d].flags.contains(Flags::AMBIENT) => return true,
            Parent::Stmt(s)
                if s.is_some()
                    && matches!(hir[s].kind, StmtKind::Class(k) if hir[k].flags.contains(Flags::AMBIENT)) =>
            {
                return true;
            }
            Parent::Module(m) => return hir[m].flags.contains(Flags::AMBIENT),
            Parent::File => return hir.kind == FileKind::Declaration,
            Parent::None | Parent::MemberKey(_) | Parent::MethodKey(_) => return true,
            Parent::PatKey(_) => return true,
            _ => {}
        }
        parent = step_out(c, file, parent);
    }
}

/// `isSameScopeDescendentOf(usage, declaration, ..)`: `usage` is in the declaration `d`, with no function in between that runs later.
fn is_in_initializer_of(c: &Checker<'_>, usage: Location, d: VarDeclId) -> bool {
    let file = usage.file();
    let (hir, bound) = (c.hir(file), c.bound(file));
    let mut parent = parent_of_location(c, usage);
    loop {
        match parent {
            Parent::VarInit(x) if x == d => return true,
            Parent::FnBody(_) | Parent::ParamDefault(_) => {
                let f = match parent {
                    Parent::FnBody(f) => f,
                    Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                    _ => unreachable!(),
                };
                if hir[f].kind != FnKind::StaticBlock
                    && (!c.is_immediately_invoked(file, f)
                        || hir[f].flags.intersects(Flags::ASYNC | Flags::GENERATOR))
                {
                    return false;
                }
            }
            Parent::File
            | Parent::Module(_)
            | Parent::None
            | Parent::MemberKey(_)
            | Parent::MethodKey(_) => return false,
            Parent::PatKey(_) => return false,
            _ => {}
        }
        parent = step_out(c, file, parent);
    }
}

/// `isUsedInFunctionOrInstanceProperty`, of what is no member of a class and is declared further down: by the time the use is
/// reached it may be there after all. Where the way out is lost track of, it is taken to be.
fn is_use_deferred(c: &Checker<'_>, usage: Location, declaration: Location) -> bool {
    let file = usage.file();
    let (hir, bound) = (c.hir(file), c.bound(file));
    // To get out to a function the declaration is in is to have got past the block it is declared in.
    let container = match step_out(c, file, parent_of_location(c, declaration)) {
        Parent::Stmt(s) if s.is_some() => c.enclosing_fn(file, Parent::Stmt(s)),
        _ => None,
    };
    let encloses_declaration = |f: FnId| {
        let mut at = container;
        while let Some(g) = at {
            if g == f {
                return true;
            }
            let outer = bound.fns[g.idx()].enclosing;
            at = outer.is_some().then_some(outer);
        }
        false
    };
    let mut parent = parent_of_location(c, usage);
    loop {
        match parent {
            Parent::FnBody(_) | Parent::ParamDefault(_) => {
                let f = match parent {
                    Parent::FnBody(f) => f,
                    Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                    _ => unreachable!(),
                };
                if encloses_declaration(f) {
                    return false;
                }
                if hir[f].kind != FnKind::StaticBlock && !c.is_immediately_invoked(file, f) {
                    return true;
                }
            }
            Parent::MemberInit(m) if !hir[m].flags.contains(Flags::STATIC) => return true,
            Parent::File | Parent::Module(_) => return false,
            Parent::None | Parent::MemberKey(_) | Parent::MethodKey(_) => return true,
            Parent::PatKey(_) => return true,
            _ => {}
        }
        parent = step_out(c, file, parent);
    }
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

/// Whether the parenthesis that opens at `open` closes before `end`. `None`: it cannot be told.
fn closes_before(text: &[u8], open: usize, end: usize) -> Option<bool> {
    let mut depth = 0u32;
    let mut at = open;
    while at < end {
        match text[at] {
            b'(' => depth += 1,
            b')' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(true);
                }
            }
            quote @ (b'"' | b'\'') => {
                at += 1;
                while *text.get(at)? != quote {
                    at += if text[at] == b'\\' { 2 } else { 1 };
                }
            }
            b'`' => return None,
            b'/' if skip_trivia(text, at) > at => {
                at = skip_trivia(text, at);
                continue;
            }
            _ => {}
        }
        at += 1;
    }
    Some(false)
}

/// `GetErrorRangeForNode`, of the initializer of `member`, parentheses and all. `None`: it cannot be told.
fn start_of_enum_initializer(c: &Checker<'_>, file: FileId, member: EnumMemberId) -> Option<u32> {
    let hir = c.hir(file);
    let text = &hir.text[..];
    let initializer = hir[member].init;
    // Past the name, to what follows the `=`.
    let mut at = hir[member].pos as usize;
    match *text.get(at)? {
        quote @ (b'"' | b'\'') => {
            at += 1;
            while *text.get(at)? != quote {
                at += if text[at] == b'\\' { 2 } else { 1 };
            }
            at += 1;
        }
        b'[' => at += text[at..].iter().position(|&b| b == b']')? + 1,
        _ => {
            while !matches!(*text.get(at)?, b'=' | b'/') && !text[at].is_ascii_whitespace() {
                at += 1;
            }
        }
    }
    at = skip_trivia(text, at);
    if text.get(at) != Some(&b'=') {
        return None;
    }
    let start = skip_trivia(text, at + 1);
    let is_in_parentheses = is_parenthesized(hir, initializer) && text.get(start) == Some(&b'(');
    match hir[initializer].kind {
        // `(a satisfies T)` or `(a) satisfies T`: the parentheses are noted the same way.
        ExprKind::Satisfies { .. } => {
            let keyword = error_start(c, file, initializer)?;
            if is_in_parentheses && !closes_before(text, start, keyword as usize)? {
                Some(start as u32)
            } else {
                Some(keyword)
            }
        }
        ExprKind::Fn(f)
            if !is_in_parentheses && hir[f].kind == FnKind::Expr && hir[f].name.is_some() =>
        {
            Some(hir[f].name_pos)
        }
        ExprKind::Class(k) if !is_in_parentheses && hir[k].name.is_some() => Some(hir[k].name_pos),
        _ => Some(start as u32),
    }
}
