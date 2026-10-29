use super::expressions::is_reached;
use crate::bind::{Binding, BindingKind, Decl, Parent, PatParent};
use crate::check::*;

impl Checker<'_, '_> {
    pub(super) fn check_redeclaration_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for entry in bound.runtime.early_redeclarations() {
            let code =
                if is_default_export(hir, entry.earlier) && is_default_export(hir, entry.later) {
                    2528
                } else if is_block_scoped(hir, bound, entry.earlier)
                    || is_block_scoped(hir, bound, entry.later)
                {
                    2451
                } else {
                    2300
                };
            match self.new_diagnostic_for_declaration_name(file, entry.later, code) {
                Some(diagnostic) => {
                    self.add_diagnostic(diagnostic.with_class(DiagnosticClass::EarlyError));
                }
                None => {
                    debug_assert!(false, "a redeclaration has no name to report on");
                    self.early_error_at((file, 0, 0), 2528, &[]);
                }
            }
        }
    }

    // In TypeScript an import may share its name with another declaration, because one of the two may be a type. Only the
    // file that is imported from says whether it is. Where both are there when the program runs, the name is declared twice.
    pub(super) fn check_import_redeclaration_early_errors(&mut self, file: FileId) {
        if self.hir(file).is_js {
            return;
        }
        let (files, hir, bound) = (self.files(), self.hir(file), self.bound(file));
        let is_kept_import = |decl: &Decl| {
            matches!(
                decl,
                Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_)
            ) && !files.is_type_only_import_or_export_declaration(file, *decl)
        };
        let is_import = |decl: &Decl| {
            matches!(
                decl,
                Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_)
            )
        };
        let is_value = |flags: SymFlags| flags.intersects(SymFlags::VALUE);
        for redeclaration in bound.redeclarations.iter() {
            let mut earlier = bound.symbol(redeclaration.symbol).decls.iter();
            let (Some(&earlier), true) = (
                earlier.find(|earlier| is_kept_import(earlier)),
                is_kept_import(&redeclaration.decl),
            ) else {
                continue;
            };
            let sym = files.sym(file, redeclaration.symbol);
            if self.flags_of_alias_target(sym).is_some_and(is_value) {
                for decl in [earlier, redeclaration.decl] {
                    let (start, end) = self.get_error_range_for_node(file, hir.node(decl));
                    self.early_error_at((file, start, end), 2300, &[Arg::Sym(sym)]);
                }
            }
        }
        for (&decl, &sym) in self.symbols_of_alias_declarations(file).iter() {
            if !is_kept_import(&decl) {
                continue;
            }
            let values = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
            let mut others = files.symbol(sym).decls.iter();
            let is_declared_again = files.flags(sym).intersects(values)
                && others.any(|other| {
                    !is_import(other) && !self.is_erased_syntax(file, hir.node(*other))
                });
            if !is_declared_again {
                continue;
            }
            if self.flags_of_alias_target(sym).is_some_and(is_value) {
                let (start, end) = self.get_error_range_for_node(file, hir.node(decl));
                self.early_error_at((file, start, end), 2440, &[Arg::Sym(sym)]);
            }
        }
    }

    // `bun build` refuses a file that assigns to a `const` or `using` binding or to an import, wherever the assignment stands.
    pub(super) fn check_constant_assignment_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for store in bound.runtime.stores() {
            let ExprKind::Ident(name) = hir[store.target].kind else {
                continue;
            };
            let code = match bound.binding_kind(store.symbol) {
                BindingKind::Const => 2588,
                BindingKind::Import => 2632,
                _ => continue,
            };
            let at = self.span_of_token(file, hir[store.target].pos);
            self.early_error_at(at, code, &[Arg::Atom(name)]);
        }
    }

    // `bun build` refuses a file that assigns to a member of `import * as star` or deletes one.
    pub(super) fn check_namespace_member_assignment_early_errors(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.imports.iter().any(|import| import.namespace.is_some()) {
            return;
        }
        let star_of = |e: ExprId| {
            let (ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. }) =
                hir[e].kind
            else {
                return None;
            };
            let obj = hir.skip_type_assertions(obj);
            let (ExprKind::Ident(name), Chain::No) = (hir[obj].kind, chain) else {
                return None;
            };
            let Binding::Symbol(symbol) = bound.binding(obj) else {
                return None;
            };
            let is_star = |decl: &Decl| matches!(decl, Decl::ImportNamespace(_));
            let declarations = bound.symbol(symbol).decls;
            declarations.iter().any(is_star).then_some((obj, name))
        };
        let index = self.exprs_by_kind(file);
        let members = index
            .of(ExprTag::Dot)
            .iter()
            .chain(index.of(ExprTag::Index));
        let mut targets: Vec<(ExprId, u32)> = members
            .filter(|e| is_reached(bound, **e) && bound.get_assignment_target(hir, **e).is_some())
            .map(|&e| (e, 2540))
            .collect();
        for &e in index.of(ExprTag::Unary) {
            if let ExprKind::Unary {
                op: UnOp::Delete,
                operand,
            } = hir[e].kind
                && is_reached(bound, e)
            {
                targets.push((hir.skip_type_assertions(operand), 2704));
            }
        }
        for (e, code) in targets {
            let Some((star, star_name)) = star_of(e) else {
                continue;
            };
            let (at, name) = match hir[e].kind {
                ExprKind::Dot { name, .. } => (hir.name_pos(e), Some(name)),
                ExprKind::Index { index, .. } => match hir[index].kind {
                    ExprKind::String(name) => (hir[index].pos, Some(name)),
                    _ => (hir[star].pos, None),
                },
                _ => continue,
            };
            let at = self.span_of_token(file, at);
            match name {
                Some(name) if code == 2540 => self.early_error_at(at, code, &[Arg::Atom(name)]),
                Some(_) => self.early_error_at(at, code, &[]),
                None => self.early_error_at(at, 2632, &[Arg::Atom(star_name)]),
            };
        }
    }

    pub(super) fn check_export_early_errors(&mut self, file: FileId) {
        self.check_local_export_names(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.is_js {
            return;
        }
        for export in hir.exports.iter() {
            if export.has_module_specifier
                || export.type_only
                || matches!(bound.parent_of_stmt(export.stmt), Parent::None)
            {
                continue;
            }
            for item in export.items.iter() {
                let spec = &hir[item];
                if spec.type_only {
                    continue;
                }
                match bound.exported_binding(item) {
                    Binding::Free => {
                        let at = (file, spec.local_pos, 0);
                        self.early_error_at(at, 2661, &[Arg::Atom(spec.local)]);
                    }
                    Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) => {}
                }
            }
        }
    }
}

fn is_default_export(hir: &hir::File<'_>, decl: Decl) -> bool {
    match decl {
        Decl::ExportExpr(s) => matches!(hir[s].kind, StmtKind::ExportDefault(_)),
        Decl::Fn(f) => hir[f].flags.contains(Flags::DEFAULT),
        Decl::Class(c) => hir[c].flags.contains(Flags::DEFAULT),
        Decl::ExportSpec(x) => hir[x].exported == known::default,
        _ => false,
    }
}

fn is_block_scoped(hir: &hir::File<'_>, bound: &Bound<'_>, decl: Decl) -> bool {
    match decl {
        Decl::Class(_) => true,
        Decl::Var(pat) | Decl::Require(pat) => matches!(
            root_declaration(bound, pat),
            PatParent::Var(d) if hir[d].kind != VarKind::Var
        ),
        _ => false,
    }
}
