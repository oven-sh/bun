//! Enums and names: what the initializers of enum members come to, where a `const` enum can be written, and what is said of a
//! name that is found, or is not, in a way that calls for words of its own.
//!
//! 1061 18056, 1066 18033 18055 2474 2477 2478, 2651 (and the 2565 that is decided next to it), 2475 2476, 2397, 1281, 2311 18004,
//! 2690, 2686, 2467 2562, 2844.
//!
//! Follows `computeEnumMemberValues`, `computeEnumMemberValue`, `computeConstantEnumMemberValue`, `evaluateEntity`,
//! `evaluateEnumMember`, `isBlockScopedNameDeclaredBeforeUse`, `checkConstEnumAccess`, `checkElementAccessExpression`,
//! `initializeChecker`, `addUndefinedToGlobalsOrErrorOnRedeclaration`, `getCannotFindNameDiagnosticForName`,
//! `checkAndReportErrorForUsingTypeAsValue`, `maybeMappedType`, `allTypesAssignableToKindEx`,
//! `onSuccessfullyResolvedSymbol`, `checkImportEqualsDeclaration`, `markJsxAliasReferenced` and
//! `checkAndReportErrorForInvalidInitializer` of TypeScript 7.0.2's checker.go, `NewEvaluator` of its evaluator.go and `Resolve` of
//! its nameresolver.go.
//!
//! Comes after the passes that say that a name cannot be found: some of what they say is put in other words here.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, FnOwner, Parent, PatParent, ScopeId, ScopeKind, SymbolId};
use crate::util::FxHashSet;

impl Checker<'_> {
    pub(super) fn check_x_enums_names(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.has_errors || hir.kind == FileKind::Json {
            return;
        }
        // `checkEnumDeclaration` and `checkAndReportErrorForUsingTypeAsValue` apply to declaration files too. The other passes only
        // support source files.
        if hir.kind == FileKind::Declaration {
            self.check_x_enum_member_values(file, out);
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
        self.check_x_class_type_parameters_out_of_reach(file, out);
        self.check_x_property_types_against_constructors(file, out);
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
                    ExprKind::Template { exprs, .. } => !exprs.is_empty(),
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
                is_evaluated && !matches!(bound.expr_parent[e.idx()], Parent::None)
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
            if matches!(parent, Parent::None) {
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
            // `checkIdentifier`: a name that cannot be assigned to is in error where it is.
            if let ExprKind::Ident(name) = hir.exprs[i].kind
                && is_written_to(self, file, e)
                && self.symbol_of_identifier(file, e, name).is_none_or(|s| {
                    let flags = self.files().flags(s);
                    !flags.intersects(SymFlags::VARIABLE) || flags.contains(SymFlags::CONST)
                })
            {
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
        // A script has no `globalThis` of its own, of whatever kind.
        if !files.module(file).is_module()
            && let Some(symbol) = bound.lookup(bound.scopes[0].locals, known::globalThis)
        {
            let decls: Vec<(FileId, Decl)> = bound.symbols[symbol.idx()]
                .decls
                .iter()
                .map(|&d| (file, d))
                .collect();
            report_conflicts_with_built_in(self, file, &decls, true, out);
        }
        // Nothing but a type goes by the name of `undefined` for everybody.
        if let Some(&symbol) = files.globals.get(&known::undefined) {
            report_conflicts_with_built_in(
                self,
                file,
                &files.decls(files.canonical(symbol)),
                false,
                out,
            );
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
            if matches!(bound.expr_parent[e.idx()], Parent::None) {
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
                let is_meant = flags.intersects(wanted)
                    || flags.contains(SymFlags::ALIAS)
                        && files
                            .resolve_alias(found)
                            .is_none_or(|target| files.flags(target).intersects(wanted));
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
            if open_parenthesis(hir, e).is_some() {
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
            if members.len() != 1 || scope.is_none() {
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
            let initializer = if open_parenthesis(hir, member.init).is_none() {
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
                files.resolve_name(file, scope, name, meaning) == Some(global)
                    && files
                        .resolve_alias(global)
                        .is_some_and(|target| files.flags(target).intersects(meaning))
            })
        };
        for &(e, scope) in &bound.free_idents {
            if let ExprKind::Ident(name) = hir[e].kind
                && !matches!(bound.expr_parent[e.idx()], Parent::None)
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
        let first_name = |text: &[u8]| {
            files
                .atoms
                .intern(text.split(|&c| c == b'.').next().unwrap_or(text))
        };
        let factory = if hir.jsx_pragmas.factory.is_some() {
            first_name(files.atoms.bytes(hir.jsx_pragmas.factory))
        } else if !options.jsx_factory.is_empty() {
            first_name(options.jsx_factory.as_bytes())
        } else if !options.react_namespace.is_empty() {
            first_name(options.react_namespace.as_bytes())
        } else {
            known::React
        };
        let fragment_factory = if hir.jsx_pragmas.fragment_factory.is_some() {
            first_name(files.atoms.bytes(hir.jsx_pragmas.fragment_factory))
        } else if !options.jsx_fragment_factory.is_empty() {
            first_name(options.jsx_fragment_factory.as_bytes())
        } else {
            factory
        };
        // The scope a tag is written in is not kept: whatever the file declares by the name, wherever, may be what is meant.
        let is_umd_global = |name: Atom| {
            means_umd_global(name, ScopeId(0), SymFlags::VALUE)
                && !bound.symbols.iter().any(|s| {
                    s.name == name && s.flags.intersects(SymFlags::VALUE | SymFlags::ALIAS)
                })
        };
        let of_elements = is_umd_global(factory);
        let of_fragments = of_elements || is_umd_global(fragment_factory);
        if !of_fragments {
            return;
        }
        for (i, x) in hir.exprs.iter().enumerate() {
            let ExprKind::Jsx(jsx) = x.kind else { continue };
            if matches!(bound.expr_parent[i], Parent::None) {
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
                let end = self.end_of_jsx_opening(file, ExprId(i as u32), jsx);
                self.note(x.pos, end, 2686, vec![self.atom_text(looked_up)]);
            } else if of_elements {
                // The name of the tag, which follows the `<`.
                let start = skip_trivia(&hir.text, x.pos as usize + 1);
                out.push(Diagnostic {
                    start: start as u32,
                    code: 2686,
                });
                let rest = hir.text.get(start..).unwrap_or(&[]);
                let length = rest
                    .iter()
                    .position(|&b| {
                        !(b.is_ascii_alphanumeric()
                            || b >= 0x80
                            || matches!(b, b'_' | b'$' | b'.' | b'-' | b':'))
                    })
                    .unwrap_or(rest.len());
                self.note(
                    start as u32,
                    (start + length) as u32,
                    2686,
                    vec![self.atom_text(factory)],
                );
            }
        }
    }

    /// `Resolve`, at what a class extends and at a computed name: 2562 2467. The type parameters of a class or an interface are not
    /// there yet where these are worked out.
    fn check_x_class_type_parameters_out_of_reach(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut roots, mut scopes) = (Vec::new(), Vec::new());
        let classes = hir
            .classes
            .iter()
            .map(|c| (c.type_params, c.extends, c.members));
        let interfaces = hir
            .interfaces
            .iter()
            .map(|i| (i.type_params, ExprId::NONE, i.members));
        for (type_params, extends, members) in classes.chain(interfaces) {
            if type_params.is_empty() {
                continue;
            }
            let keys = members.iter().filter_map(|m| match hir[m].key {
                PropKey::Computed(e) => Some((e, 2467)),
                _ => None,
            });
            for (e, code) in std::iter::once((extends, 2562)).chain(keys) {
                roots.clear();
                scopes.clear();
                types_written_in(hir, bound, e, &mut roots, &mut scopes);
                // A name on its own that means one of those type parameters.
                let mut check = |node: TypeNodeId| {
                    if let TypeNodeKind::Ref { name, .. } = hir[node].kind
                        && name.len() == 1
                        && bound.type_scope[node.idx()].is_some()
                        && let Some(found) = bound.resolve(
                            bound.type_scope[node.idx()],
                            hir.id_at(name, 0),
                            SymFlags::TYPE,
                        )
                        && type_params
                            .iter()
                            .any(|p| bound.type_param_symbol[p.idx()] == found)
                    {
                        out.push(Diagnostic {
                            start: hir[node].pos,
                            code,
                        });
                    }
                };
                for &root in &roots {
                    for_each_type_in(hir, root, &mut check);
                }
                // What is written in the functions and classes in there.
                if !scopes.is_empty() {
                    for t in 0..hir.types.len() {
                        if is_scope_within(bound, bound.type_scope[t], &scopes) {
                            check(TypeNodeId(t as u32));
                        }
                    }
                }
            }
        }
    }

    /// `Resolve`, at a property declaration, and `checkAndReportErrorForInvalidInitializer`: 2844. Where fields are set up by
    /// assignments put in the constructor, a name in the type of one would come to mean what the constructor declares by it.
    fn check_x_property_types_against_constructors(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        if self.p.files.options.emit_standard_class_fields {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, class) in hir.classes.iter().enumerate() {
            // `FindConstructorDeclaration`
            let Some(constructor) = class.members.iter().find(|&m| {
                hir[m].kind == MemberKind::Constructor
                    && !matches!(hir[hir[m].func].body, FnBody::None)
            }) else {
                continue;
            };
            let (own, scope) = (
                bound.class_scope[i],
                bound.fns[hir[constructor].func.idx()].scope,
            );
            if own.is_none() || scope.is_none() {
                continue;
            }
            let locals = bound.scopes[scope.idx()].locals;
            for m in class.members.iter() {
                let member = &hir[m];
                if member.kind != MemberKind::Property || member.flags.contains(Flags::STATIC) {
                    continue;
                }
                for_each_type_in(hir, member.ty, &mut |node: TypeNodeId| {
                    // The name that is looked up, where it is, what it is to mean, and what of that is a value.
                    let (name, start, meaning, as_value) = match hir[node].kind {
                        TypeNodeKind::Typeof { name, expr, .. }
                            if !name.is_empty() && expr.is_some() =>
                        {
                            let mut first = expr;
                            while let ExprKind::Dot { obj, .. } = hir[first].kind {
                                first = obj;
                            }
                            (
                                hir.id_at(name, 0),
                                hir[first].pos,
                                SymFlags::VALUE,
                                SymFlags::VALUE,
                            )
                        }
                        TypeNodeKind::Ref { name, .. } if name.len() == 1 => (
                            hir.id_at(name, 0),
                            hir[node].pos,
                            SymFlags::TYPE,
                            SymFlags::CLASS | SymFlags::ENUM | SymFlags::ENUM_MEMBER,
                        ),
                        TypeNodeKind::Ref { name, .. } if name.len() > 1 => (
                            hir.id_at(name, 0),
                            hir[node].pos,
                            SymFlags::NAMESPACE,
                            SymFlags::VALUE_MODULE | SymFlags::ENUM,
                        ),
                        _ => return,
                    };
                    let has = |table, wanted| {
                        bound
                            .lookup(table, name)
                            .is_some_and(|s| bound.symbols[s.idx()].flags.intersects(wanted))
                    };
                    if !has(locals, as_value) {
                        return;
                    }
                    // Found before the property is reached: a parameter of a function type, say.
                    let mut at = bound.type_scope[node.idx()];
                    while at.is_some() && at != own {
                        if has(bound.scopes[at.idx()].locals, meaning | SymFlags::ALIAS) {
                            return;
                        }
                        at = bound.scopes[at.idx()].parent;
                    }
                    if at.is_none() {
                        return;
                    }
                    // `resolveEntityName`: a namespace is first looked for with nothing to be said, and again only if there is none.
                    if meaning == SymFlags::NAMESPACE
                        && self
                            .files()
                            .resolve_name(file, own, name, meaning)
                            .is_some()
                    {
                        return;
                    }
                    out.retain(|d| d.start != start || !is_name_not_found(d.code));
                    out.push(Diagnostic { start, code: 2844 });
                    let property =
                        self.source_text(file, member.pos, self.end_of_member_name(file, m));
                    self.note(start, 0, 2844, vec![property, self.atom_text(name)]);
                });
            }
        }
    }
}

// ───────────────────────────── constant expressions ─────────────────────────────

/// What a constant expression comes to. Which string makes no difference to what is said.
#[derive(Copy, Clone, PartialEq)]
enum Value {
    Number(f64),
    String,
}

/// `evaluator.Result`, less what only matters to what is emitted.
#[derive(Copy, Clone, Default)]
struct Evaluated {
    value: Option<Value>,
    is_syntactically_string: bool,
    resolved_other_files: bool,
}

impl Evaluated {
    fn number(n: f64) -> Evaluated {
        Evaluated {
            value: Some(Value::Number(n)),
            ..Evaluated::default()
        }
    }
}

/// The `location` of `evaluate`, and what is declared before or after it.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Location {
    Member(FileId, EnumMemberId),
    Variable(FileId, VarDeclId),
    Expr(FileId, ExprId),
}

impl Location {
    fn file(self) -> FileId {
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
                Some(Value::Number(n)) => Some(n + 1.0),
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
            if !matches!(before.value, Some(Value::Number(_))) || before.resolved_other_files {
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
        let token_len = source
            .iter()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.'))
            .count();
        let is_bigint =
            source.first().is_some_and(u8::is_ascii_digit) && source[token_len - 1] == b'n';
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
                    && let Value::Number(n) = value
                    && !n.is_finite()
                {
                    let code = if n.is_nan() { 2478 } else { 2477 };
                    self.error(file, start, code);
                    let end = self.c.error_end_of(file, initializer);
                    self.c.note(start, end, code, Vec::new());
                }
                if self.c.p.files.options.isolated_modules
                    && value == Value::String
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
                    }
                }
            }
        }
        result
    }

    /// `evaluate` of evaluator.go. Parentheses are not kept, and nothing else is looked through.
    fn evaluate(&mut self, file: FileId, e: ExprId, location: Location) -> Evaluated {
        if self.c.is_stack_low() {
            self.gave_up = true;
            return Evaluated::default();
        }
        let hir = self.c.hir(file);
        match hir[e].kind {
            // A `PrefixUnaryExpression`, which `typeof`, `void` and `delete` are not.
            ExprKind::Unary {
                op:
                    op @ (UnOp::Plus
                    | UnOp::Minus
                    | UnOp::BitNot
                    | UnOp::Not
                    | UnOp::PreInc
                    | UnOp::PreDec),
                operand,
            } => {
                let result = self.evaluate(file, operand, location);
                let value = match (op, result.value) {
                    (UnOp::Plus, Some(Value::Number(n))) => Some(Value::Number(n)),
                    (UnOp::Minus, Some(Value::Number(n))) => Some(Value::Number(-n)),
                    (UnOp::BitNot, Some(Value::Number(n))) => {
                        Some(Value::Number(f64::from(!to_int32(n))))
                    }
                    _ => None,
                };
                Evaluated {
                    value,
                    is_syntactically_string: false,
                    resolved_other_files: result.resolved_other_files,
                }
            }
            ExprKind::Binary { op, left, right } => {
                self.evaluate_binary(file, Some(op), left, right, location)
            }
            // An assignment is a `BinaryExpression` with an operator that gives nothing.
            ExprKind::Assign { target, value, .. } => {
                self.evaluate_binary(file, None, target, value, location)
            }
            ExprKind::String(_) => Evaluated {
                value: Some(Value::String),
                is_syntactically_string: true,
                resolved_other_files: false,
            },
            // `evaluateTemplateExpression`
            ExprKind::Template { exprs, .. } => {
                let mut resolved_other_files = false;
                for span in hir.ids(exprs) {
                    let result = self.evaluate(file, span, location);
                    if result.value.is_none() {
                        return Evaluated {
                            value: None,
                            is_syntactically_string: true,
                            resolved_other_files: false,
                        };
                    }
                    resolved_other_files |= result.resolved_other_files;
                }
                Evaluated {
                    value: Some(Value::String),
                    is_syntactically_string: true,
                    resolved_other_files,
                }
            }
            ExprKind::Number(n) => Evaluated::number(hir.numbers[n as usize]),
            ExprKind::Ident(_) | ExprKind::Index { .. } => self.evaluate_entity(file, e, location),
            ExprKind::Dot { .. } if is_entity_name_expression(self.c, file, e) => {
                self.evaluate_entity(file, e, location)
            }
            _ => Evaluated::default(),
        }
    }

    fn evaluate_binary(
        &mut self,
        file: FileId,
        op: Option<BinOp>,
        left: ExprId,
        right: ExprId,
        location: Location,
    ) -> Evaluated {
        let (l, r) = (
            self.evaluate(file, left, location),
            self.evaluate(file, right, location),
        );
        let value = match (l.value, r.value, op) {
            (Some(Value::Number(a)), Some(Value::Number(b)), Some(op)) => {
                number_operation(op, a, b).map(Value::Number)
            }
            (Some(_), Some(_), Some(BinOp::Add)) => Some(Value::String),
            _ => None,
        };
        Evaluated {
            value,
            is_syntactically_string: (l.is_syntactically_string || r.is_syntactically_string)
                && op == Some(BinOp::Add),
            resolved_other_files: l.resolved_other_files || r.resolved_other_files,
        }
    }

    /// `evaluateEntity`
    fn evaluate_entity(&mut self, file: FileId, e: ExprId, location: Location) -> Evaluated {
        let (hir, files) = (self.c.hir(file), self.c.files());
        if let ExprKind::Index { obj, index, .. } = hir[e].kind {
            let name = match hir[index].kind {
                ExprKind::String(name) => name,
                ExprKind::Template { exprs, texts } if exprs.is_empty() => hir.id_at(texts, 0),
                _ => return Evaluated::default(),
            };
            // Neither `(a)["b"]` nor `a[("b")]`. There is no text to go by where a file only declares.
            let before = text_before(hir, hir[index].pos);
            let is_plain = before.is_empty()
                || before
                    .strip_suffix(b"[")
                    .is_some_and(|before| !trim_trivia_end(before).ends_with(b")"));
            if !is_plain
                || open_parenthesis(hir, index).is_some()
                || open_parenthesis(hir, obj).is_some()
                || !is_entity_name_expression(self.c, file, obj)
            {
                return Evaluated::default();
            }
            if let Some(root) = self.resolve_entity_name(file, obj, SymFlags::VALUE, location)
                && files.flags(root).contains(SymFlags::ENUM)
                && let Some(member) = files.export(root, name)
                && files.flags(member).contains(SymFlags::ENUM_MEMBER)
            {
                return self.evaluate_enum_member(file, e, member, location);
            }
            return Evaluated::default();
        }
        let Some(symbol) = self.resolve_entity_name(file, e, SymFlags::VALUE, location) else {
            return Evaluated::default();
        };
        // `Infinity` and `NaN`, unless they are somebody's own.
        if let ExprKind::Ident(name) = hir[e].kind
            && let Some(n) = match files.atoms.bytes(name) {
                b"Infinity" => Some(f64::INFINITY),
                b"NaN" => Some(f64::NAN),
                _ => None,
            }
            && files.global(name, SymFlags::VALUE) == Some(symbol)
        {
            return Evaluated::number(n);
        }
        let flags = files.flags(symbol);
        if flags.contains(SymFlags::ENUM_MEMBER) {
            return self.evaluate_enum_member(file, e, symbol, location);
        }
        // `isConstantVariable`, declared by name, its type left to its initializer.
        if flags.intersects(SymFlags::VARIABLE)
            && flags.contains(SymFlags::CONST)
            && let Some((of, pat)) =
                files
                    .decls(symbol)
                    .into_iter()
                    .find_map(|(of, decl)| match decl {
                        Decl::Var(pat) => Some((of, pat)),
                        _ => None,
                    })
            && let PatParent::Var(d) = self.c.bound(of).pat_parent[pat.idx()]
        {
            let declaration = &self.c.hir(of)[d];
            let declared = Location::Variable(of, d);
            if declaration.ty.is_none()
                && declaration.init.is_some()
                && declared != location
                && !self.variables.contains(&(of, d))
                && is_declared_before_use(self.c, declared, location)
            {
                self.variables.push((of, d));
                let result = self.evaluate(of, declaration.init, declared);
                self.variables.pop();
                if location.file() != of {
                    return Evaluated {
                        value: result.value,
                        is_syntactically_string: false,
                        resolved_other_files: true,
                    };
                }
                return result;
            }
        }
        Evaluated::default()
    }

    /// `evaluateEnumMember`
    fn evaluate_enum_member(
        &mut self,
        file: FileId,
        e: ExprId,
        symbol: Sym,
        location: Location,
    ) -> Evaluated {
        let declaration =
            self.c
                .files()
                .decls(symbol)
                .into_iter()
                .find_map(|(of, decl)| match decl {
                    Decl::EnumMember(member) => Some((of, member)),
                    _ => None,
                });
        let start = self.c.start_inside_parentheses(file, e);
        let Some((of, member)) =
            declaration.filter(|&(of, member)| Location::Member(of, member) != location)
        else {
            self.error(file, start, 2565);
            if file == self.file {
                let end = self.c.end_inside_parentheses(file, e);
                self.c
                    .explain_to(start, end, 2565, |c| vec![c.symbol_to_string(symbol)]);
            }
            return Evaluated::default();
        };
        if !is_declared_before_use(self.c, Location::Member(of, member), location) {
            self.error(file, start, 2651);
            if file == self.file {
                let end = self.c.end_inside_parentheses(file, e);
                self.c.note(start, end, 2651, Vec::new());
            }
            return Evaluated::number(0.0);
        }
        let value = self.enum_member_value(of, member);
        self.unsure |= self.unsure_members.contains(&(of, member));
        value
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
                                    s.name == name && s.flags.intersects(meaning | SymFlags::ALIAS)
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
                    && self.c.bound(file).expr_symbol[obj.idx()].is_none()
                    && !files.globals.contains_key(&known::globalThis) =>
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

/// `toInt32` of jsnum.go
fn to_int32(n: f64) -> i32 {
    if !n.is_finite() {
        return 0;
    }
    (n.trunc() % 4294967296.0) as i64 as i32
}

/// The operators `evaluate` knows, on numbers.
fn number_operation(op: BinOp, a: f64, b: f64) -> Option<f64> {
    let shift = to_int32(b) as u32 & 31;
    Some(match op {
        BinOp::BitOr => f64::from(to_int32(a) | to_int32(b)),
        BinOp::BitAnd => f64::from(to_int32(a) & to_int32(b)),
        BinOp::BitXor => f64::from(to_int32(a) ^ to_int32(b)),
        BinOp::Shr => f64::from(to_int32(a) >> shift),
        BinOp::UShr => f64::from(to_int32(a) as u32 >> shift),
        BinOp::Shl => f64::from(to_int32(a) << shift),
        BinOp::Mul => a * b,
        BinOp::Div => a / b,
        BinOp::Add => a + b,
        BinOp::Sub => a - b,
        BinOp::Rem => a % b,
        // `Exponentiate` of jsnum.go
        BinOp::Pow if (a == 1.0 || a == -1.0) && b.is_infinite() || a == 1.0 && b.is_nan() => {
            f64::NAN
        }
        BinOp::Pow => a.powf(b),
        _ => return None,
    })
}

fn is_ambient_enum(hir: &hir::File, en: EnumId) -> bool {
    hir[en].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration
}

/// `IsEntityNameExpression`, of `e` less the parentheses around it.
fn is_entity_name_expression(c: &Checker<'_>, file: FileId, mut e: ExprId) -> bool {
    let hir = c.hir(file);
    loop {
        match hir[e].kind {
            ExprKind::Ident(_) => return true,
            ExprKind::Dot {
                obj,
                name,
                name_pos,
                ..
            } if open_parenthesis(hir, obj).is_none()
                && !is_after_parenthesis(hir, name_pos)
                && !c.files().atoms.bytes(name).starts_with(b"#") =>
            {
                e = obj
            }
            _ => return false,
        }
    }
}

/// Whether the `.name` whose name is at `name_pos` follows a parenthesis: `(a).name`. Of the parentheses in what is only declared
/// nothing else is kept than the text.
fn is_after_parenthesis(hir: &hir::File, name_pos: u32) -> bool {
    let before = text_before(hir, name_pos);
    let before = before
        .strip_suffix(b"?.")
        .or_else(|| before.strip_suffix(b"."))
        .unwrap_or(before);
    trim_trivia_end(before).ends_with(b")")
}

/// `IsStringLiteralLike`
fn is_string_literal_like(hir: &hir::File, e: ExprId) -> bool {
    open_parenthesis(hir, e).is_none()
        && match hir[e].kind {
            ExprKind::String(_) => true,
            ExprKind::Template { exprs, .. } => exprs.is_empty(),
            _ => false,
        }
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
        && open_parenthesis(c.hir(file), e).is_none()
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
        Parent::Key(owner) if owner.is_some() => Parent::Expr(owner),
        // The name of a method or an accessor is part of the function; that of a property is worked out where the class is.
        Parent::Expr(key) if matches!(bound.expr_parent[key.idx()], Parent::MemberKey) => {
            match hir
                .members
                .iter()
                .position(|m| m.key == PropKey::Computed(key))
            {
                Some(m) if hir.members[m].func.is_some() => Parent::FnBody(hir.members[m].func),
                Some(m) => c.outward(file, Parent::MemberInit(MemberId(m as u32))),
                // Of a method of an object literal.
                None => Parent::MemberKey,
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
            Parent::None | Parent::MemberKey => return true,
            Parent::Key(owner) if owner.is_none() => return true,
            _ => {}
        }
        parent = step_out(c, file, parent);
    }
}

/// `GetImmediatelyInvokedFunctionExpression(f) != nil`
fn is_immediately_invoked(c: &Checker<'_>, file: FileId, f: FnId) -> bool {
    let (hir, bound) = (c.hir(file), c.bound(file));
    let FnOwner::Expr(e) = bound.fns[f.idx()].owner else {
        return false;
    };
    matches!(hir[f].kind, FnKind::Expr | FnKind::Arrow)
        && matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Call(call) if hir[call].callee == e))
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
                    && (!is_immediately_invoked(c, file, f)
                        || hir[f].flags.intersects(Flags::ASYNC | Flags::GENERATOR))
                {
                    return false;
                }
            }
            Parent::File | Parent::Module(_) | Parent::None | Parent::MemberKey => return false,
            Parent::Key(owner) if owner.is_none() => return false,
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
                if hir[f].kind != FnKind::StaticBlock && !is_immediately_invoked(c, file, f) {
                    return true;
                }
            }
            Parent::MemberInit(m) if !hir[m].flags.contains(Flags::STATIC) => return true,
            Parent::File | Parent::Module(_) => return false,
            Parent::None | Parent::MemberKey => return true,
            Parent::Key(owner) if owner.is_none() => return true,
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

/// `getAssignmentTargetKind(e) != AssignmentKindNone`
fn is_written_to(c: &Checker<'_>, file: FileId, e: ExprId) -> bool {
    if let Parent::Expr(p) = c.bound(file).expr_parent[e.idx()] {
        match c.hir(file)[p].kind {
            ExprKind::Assign {
                op: Some(_),
                target,
                ..
            } if target == e => return true,
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => return true,
            _ => {}
        }
    }
    c.is_assignment_target(file, e)
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

const FUNCTION_SCOPED_VARIABLE: u16 = 1 << 0;
const BLOCK_SCOPED_VARIABLE: u16 = 1 << 1;
const FUNCTION: u16 = 1 << 2;
const CLASS: u16 = 1 << 3;
const INTERFACE: u16 = 1 << 4;
const CONST_ENUM: u16 = 1 << 5;
const REGULAR_ENUM: u16 = 1 << 6;
const VALUE_MODULE: u16 = 1 << 7;
const NAMESPACE_MODULE: u16 = 1 << 8;
const TYPE_ALIAS: u16 = 1 << 9;
const ALIAS: u16 = 1 << 10;
const VALUE: u16 = FUNCTION_SCOPED_VARIABLE
    | BLOCK_SCOPED_VARIABLE
    | FUNCTION
    | CLASS
    | CONST_ENUM
    | REGULAR_ENUM
    | VALUE_MODULE;
const TYPE: u16 = CLASS | INTERFACE | CONST_ENUM | REGULAR_ENUM | TYPE_ALIAS;

/// 2397 for the declarations among `decls` that are in `file`. They are gone through as they would have been put in one table
/// (`declareSymbolEx`, `mergeSymbol`): what is refused there does not declare the name that is built in.
fn report_conflicts_with_built_in(
    c: &Checker<'_>,
    file: FileId,
    decls: &[(FileId, Decl)],
    types_too: bool,
    out: &mut Vec<Diagnostic>,
) {
    let mut flags = 0;
    for &(of, decl) in decls {
        let Some((includes, excludes, start, is_type)) = what_is_declared(c, of, decl) else {
            continue;
        };
        if flags & excludes != 0 {
            continue;
        }
        flags |= includes;
        if of == file && (types_too || !is_type) {
            out.push(Diagnostic { start, code: 2397 });
        }
    }
}

/// What a declaration at the top of a file makes of its name, what that does not go with, where an error about the declaration
/// starts, and `IsTypeDeclaration`.
fn what_is_declared(c: &Checker<'_>, file: FileId, decl: Decl) -> Option<(u16, u16, u32, bool)> {
    let (hir, bound) = (c.hir(file), c.bound(file));
    Some(match decl {
        Decl::Var(pat) => {
            let mut root = pat;
            let d = loop {
                match bound.pat_parent[root.idx()] {
                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                    PatParent::Var(d) => break d,
                    _ => return None,
                }
            };
            if hir[d].kind == VarKind::Var {
                (
                    FUNCTION_SCOPED_VARIABLE,
                    VALUE & !FUNCTION_SCOPED_VARIABLE,
                    hir[pat].pos,
                    false,
                )
            } else {
                (BLOCK_SCOPED_VARIABLE, VALUE, hir[pat].pos, false)
            }
        }
        Decl::Fn(f) => (
            FUNCTION,
            VALUE & !(FUNCTION | VALUE_MODULE | CLASS),
            hir[f].name_pos,
            false,
        ),
        Decl::Class(k) => (
            CLASS,
            (VALUE | TYPE) & !(VALUE_MODULE | INTERFACE | FUNCTION),
            hir[k].name_pos,
            true,
        ),
        Decl::Interface(i) => (
            INTERFACE,
            TYPE & !(INTERFACE | CLASS),
            hir[i].name_pos,
            true,
        ),
        Decl::Alias(a) => (TYPE_ALIAS, TYPE, hir[a].name_pos, true),
        Decl::Enum(en) if hir[en].flags.contains(Flags::CONST) => (
            CONST_ENUM,
            (VALUE | TYPE) & !CONST_ENUM,
            hir[en].name_pos,
            true,
        ),
        Decl::Enum(en) => (
            REGULAR_ENUM,
            (VALUE | TYPE) & !(REGULAR_ENUM | VALUE_MODULE),
            hir[en].name_pos,
            true,
        ),
        Decl::Module(m) if is_instantiated(hir, m) => (
            VALUE_MODULE,
            VALUE & !(FUNCTION | CLASS | REGULAR_ENUM | VALUE_MODULE),
            hir[m].name_pos,
            false,
        ),
        Decl::Module(m) => (NAMESPACE_MODULE, 0, hir[m].name_pos, false),
        // An error about `import a = b` is about all of it.
        Decl::ImportEquals(i) => {
            let statement = (0..hir.stmts.len() as u32)
                .map(StmtId)
                .find(|&s| matches!(hir[s].kind, StmtKind::ImportEquals(x) if x == i))?;
            (ALIAS, ALIAS, hir[statement].pos, false)
        }
        _ => return None,
    })
}

/// Whether there is more to the namespace than types.
fn is_instantiated(hir: &hir::File, m: ModuleId) -> bool {
    hir.ids(hir[m].body).any(|s| match hir[s].kind {
        StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Empty | StmtKind::Import(_) => {
            false
        }
        StmtKind::Module(inner) => is_instantiated(hir, inner),
        StmtKind::ExportNamed(e) => !hir[e].type_only,
        _ => true,
    })
}

// ───────────────────────────── what is written in what ─────────────────────────────

/// The types written in the expression `e`: those that are part of it itself go to `roots`; of the functions and classes in it,
/// the scopes go to `scopes`.
fn types_written_in(
    hir: &hir::File,
    bound: &Bound,
    e: ExprId,
    roots: &mut Vec<TypeNodeId>,
    scopes: &mut Vec<ScopeId>,
) {
    if e.is_none() {
        return;
    }
    match hir[e].kind {
        ExprKind::Template { exprs, .. } | ExprKind::Array(exprs) => {
            for x in hir.ids(exprs) {
                types_written_in(hir, bound, x, roots, scopes);
            }
        }
        ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => {
            let call = &hir[call];
            roots.extend(hir.ids(call.type_args));
            types_written_in(hir, bound, call.callee, roots, scopes);
            for x in hir.ids(call.args) {
                types_written_in(hir, bound, x, roots, scopes);
            }
        }
        ExprKind::Object(props) => {
            for p in props.iter() {
                if let PropKey::Computed(key) = hir[p].key {
                    types_written_in(hir, bound, key, roots, scopes);
                }
                types_written_in(hir, bound, hir[p].value, roots, scopes);
            }
        }
        ExprKind::Fn(f) => scopes.push(bound.fns[f.idx()].scope),
        ExprKind::Class(k) => scopes.push(bound.class_scope[k.idx()]),
        ExprKind::Dot { obj: x, .. }
        | ExprKind::Unary { operand: x, .. }
        | ExprKind::Spread(x)
        | ExprKind::Await(x)
        | ExprKind::AsConst(x)
        | ExprKind::NonNull(x)
        | ExprKind::ImportCall(x)
        | ExprKind::Yield { value: x, .. } => types_written_in(hir, bound, x, roots, scopes),
        ExprKind::Index {
            obj: a, index: b, ..
        }
        | ExprKind::Binary {
            left: a, right: b, ..
        }
        | ExprKind::Assign {
            target: a,
            value: b,
            ..
        } => {
            types_written_in(hir, bound, a, roots, scopes);
            types_written_in(hir, bound, b, roots, scopes);
        }
        ExprKind::Cond { test, yes, no } => {
            for x in [test, yes, no] {
                types_written_in(hir, bound, x, roots, scopes);
            }
        }
        ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
            roots.push(ty);
            types_written_in(hir, bound, expr, roots, scopes);
        }
        ExprKind::Jsx(jsx) => {
            let jsx = &hir[jsx];
            roots.extend(hir.ids(jsx.type_args));
            types_written_in(hir, bound, jsx.tag, roots, scopes);
            for p in jsx.attrs.iter() {
                types_written_in(hir, bound, hir[p].value, roots, scopes);
            }
            for x in hir.ids(jsx.children) {
                types_written_in(hir, bound, x, roots, scopes);
            }
        }
        _ => {}
    }
}

/// Calls `f` with `node` and with every type written in it.
fn for_each_type_in(hir: &hir::File, node: TypeNodeId, f: &mut dyn FnMut(TypeNodeId)) {
    if node.is_none() {
        return;
    }
    f(node);
    match hir[node].kind {
        TypeNodeKind::Ref { args: types, .. }
        | TypeNodeKind::Typeof { args: types, .. }
        | TypeNodeKind::Import { args: types, .. }
        | TypeNodeKind::Template { types, .. }
        | TypeNodeKind::Union(types)
        | TypeNodeKind::Intersection(types) => {
            for t in hir.ids(types) {
                for_each_type_in(hir, t, f);
            }
        }
        TypeNodeKind::Array(t)
        | TypeNodeKind::Keyof(t)
        | TypeNodeKind::Readonly(t)
        | TypeNodeKind::Predicate { ty: t, .. } => for_each_type_in(hir, t, f),
        TypeNodeKind::Tuple(elems) => {
            for e in elems.iter() {
                for_each_type_in(hir, hir[e].ty, f);
            }
        }
        TypeNodeKind::Cond {
            check,
            extends,
            yes,
            no,
        } => {
            for t in [check, extends, yes, no] {
                for_each_type_in(hir, t, f);
            }
        }
        TypeNodeKind::IndexedAccess { obj, index } => {
            for_each_type_in(hir, obj, f);
            for_each_type_in(hir, index, f);
        }
        TypeNodeKind::Mapped(m) => {
            for t in [hir[hir[m].param].constraint, hir[m].name_ty, hir[m].ty] {
                for_each_type_in(hir, t, f);
            }
        }
        TypeNodeKind::Infer(p) => for_each_type_in(hir, hir[p].constraint, f),
        TypeNodeKind::Fn(func) => for_each_type_in_signature(hir, func, f),
        TypeNodeKind::Object(members) => {
            for m in members.iter() {
                for_each_type_in(hir, hir[m].ty, f);
                if hir[m].func.is_some() {
                    for_each_type_in_signature(hir, hir[m].func, f);
                }
            }
        }
        _ => {}
    }
}

fn for_each_type_in_signature(hir: &hir::File, func: FnId, f: &mut dyn FnMut(TypeNodeId)) {
    let func = &hir[func];
    for p in func.type_params.iter() {
        for_each_type_in(hir, hir[p].constraint, f);
        for_each_type_in(hir, hir[p].default, f);
    }
    for_each_type_in(hir, func.this_ty, f);
    for p in func.params.iter() {
        for_each_type_in(hir, hir[p].ty, f);
    }
    for_each_type_in(hir, func.ret, f);
}

/// Whether `scope` is one of `any_of`, or in one.
fn is_scope_within(bound: &Bound, mut scope: ScopeId, any_of: &[ScopeId]) -> bool {
    while scope.is_some() {
        if any_of.contains(&scope) {
            return true;
        }
        scope = bound.scopes[scope.idx()].parent;
    }
    false
}

// ───────────────────────────── where things are written ─────────────────────────────

/// Where the outermost parenthesis around `e` opens, if it is in any.
fn open_parenthesis(hir: &hir::File, e: ExprId) -> Option<u32> {
    hir.parens
        .binary_search_by_key(&e.0, |p| p.0.0)
        .ok()
        .map(|at| hir.parens[at].1)
}

/// Past white space and comments.
fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(b) if b.is_ascii_whitespace() => at += 1,
            Some(b'/') if text.get(at + 1) == Some(&b'/') => {
                while at < text.len() && text[at] != b'\n' {
                    at += 1;
                }
            }
            Some(b'/') if text.get(at + 1) == Some(&b'*') => {
                match text[at + 2..].windows(2).position(|w| w == b"*/") {
                    Some(end) => at += end + 4,
                    None => return text.len(),
                }
            }
            _ => return at,
        }
    }
}

/// `text` less the white space and the `/* */` comments it ends with.
fn trim_trivia_end(mut text: &[u8]) -> &[u8] {
    loop {
        text = text.trim_ascii_end();
        let Some(rest) = text.strip_suffix(b"*/") else {
            return text;
        };
        match rest.windows(2).rposition(|w| w == b"/*") {
            Some(open) => text = &text[..open],
            None => return text,
        }
    }
}

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
    let is_in_parentheses =
        open_parenthesis(hir, initializer).is_some() && text.get(start) == Some(&b'(');
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
