use crate::atom::Atom;
use crate::check::Checker;
use crate::program::{FileId, Sym};

impl<'p, 's> Checker<'p, 's> {
    pub fn declares_module_bun(&self, file: FileId) -> bool {
        self.files().intrinsics_of_bun == Some(file)
    }

    pub fn intrinsic_of_bun(&self, sym: Sym) -> Option<Atom> {
        self.declares_module_bun(sym.file).then(|| self.files().symbol(sym).name)
    }
}
