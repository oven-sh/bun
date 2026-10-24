use crate::bind::{Binding, Decl, Parent, PatParent};
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

    pub(super) fn check_export_early_errors(&mut self, file: FileId) {
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
