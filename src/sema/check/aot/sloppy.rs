use crate::bind::FnOwner;
use crate::check::Checker;
use crate::hir::{ExprId, ExprKind, Flags, FnBody, FnId, FnKind, IdList, PatKind, StmtId, StmtKind};
use crate::program::FileId;

impl<'p, 's> Checker<'p, 's> {
    fn starts_with_use_strict(&self, file: FileId, body: IdList<StmtId>) -> bool {
        let hir = self.hir(file);
        for stmt in hir.ids(body) {
            let StmtKind::Expr(e) = hir[stmt].kind else { return false };
            let ExprKind::String(text) = hir[e].kind else { return false };
            let written = hir.text.get(hir[stmt].start as usize..).filter(|_| !hir.text.is_empty());
            if written.is_some_and(|written| !matches!(written.first(), Some(b'"' | b'\''))) {
                return false;
            }
            if self.atoms().bytes(text) == b"use strict" && written.is_none_or(|written| matches!(written.get(..12), Some(b"\"use strict\"" | b"'use strict'"))) {
                return true;
            }
        }
        false
    }

    fn is_commonjs_by_extension(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        if self.files().module(file).is_runtime_commonjs.is_some() || !hir.is_js || hir.has_module_syntax && !hir.is_module_by_decree {
            return false;
        }
        let name = self.files().module(file).file_name();
        if name.ends_with(b".cjs") && (self.is_entry_point(file) || !self.is_reached_by_import(file)) {
            return true;
        }
        (name.ends_with(b".cjs") || name.ends_with(b".js")) && self.is_in_commonjs_package(file)
    }

    pub fn is_unmarked_commonjs(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        if self.files().module(file).is_runtime_commonjs.is_some() || !hir.is_js || hir.has_module_syntax && !hir.is_module_by_decree || !self.files().module(file).file_name().ends_with(b".js") {
            return false;
        }
        self.is_in_commonjs_package(file) || self.starts_with_use_strict(file, hir.body) && !self.is_in_module_package(file)
    }

    pub fn is_sloppy_function(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !(self.files().module(file).is_commonjs() || self.is_commonjs_by_extension(file)) || self.starts_with_use_strict(file, hir.body) {
            return false;
        }
        let mut at = func;
        let mut is_outside_any_class = false;
        while at.is_some() {
            if matches!(bound.fns[at.idx()].owner, FnOwner::Member(_)) || matches!(hir[at].kind, FnKind::Constructor | FnKind::StaticBlock) {
                return false;
            }
            if let FnOwner::Expr(e) = bound.fns[at.idx()].owner
                && !std::mem::replace(&mut is_outside_any_class, true)
                && hir.get_containing_class(hir.node(e)).is_some()
            {
                return false;
            }
            if matches!(hir[at].body, FnBody::Block(body) if self.starts_with_use_strict(file, body)) {
                return false;
            }
            at = bound.fns[at.idx()].enclosing;
        }
        true
    }

    pub fn has_mapped_arguments(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        hir[func].kind != FnKind::Arrow
            && hir[func].params.iter().all(|p| hir[p].default.is_none() && !hir[p].flags.contains(Flags::REST) && matches!(hir[hir[p].pat].kind, PatKind::Ident(_)))
            && self.is_sloppy_function(file, func)
    }

    pub(super) fn arguments_owner(&self, file: FileId, e: ExprId) -> FnId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
        while at.is_some() && hir[at].kind == FnKind::Arrow {
            at = bound.fns[at.idx()].enclosing;
        }
        at
    }
}
