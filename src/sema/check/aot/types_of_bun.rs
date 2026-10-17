use crate::atom::Atom;
use crate::check::Checker;
use crate::hir::{TypeNodeId, TypeNodeKind};
use crate::program::{FileId, Sym};

impl<'p, 's> Checker<'p, 's> {
    pub fn declares_bun_module(&self, file: FileId) -> bool {
        self.files().bun_intrinsics == Some(file)
    }

    pub fn bun_intrinsic(&self, sym: Sym) -> Option<Atom> {
        self.declares_bun_module(sym.file).then(|| self.files().symbol(sym).name)
    }

    pub fn is_safe_validate_result(&self, file: FileId, literal: TypeNodeId) -> bool {
        if !self.declares_bun_module(file) {
            return false;
        }
        let hir = self.hir(file);
        hir.fns.iter().any(|function| {
            function.name.is_some() && self.atoms().bytes(function.name) == b"safeValidate" && matches!(hir[function.ret].kind, TypeNodeKind::Union(members) if hir.ids(members).any(|member| member == literal))
        })
    }
}
