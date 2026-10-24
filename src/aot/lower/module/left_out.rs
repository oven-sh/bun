#[cfg(test)]
mod tests;

use bun_sema::hir::{self, ClassId, StmtId, StmtKind, VarDeclId};
use bun_sema::program::FileId;
use rustc_hash::FxHashSet;

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Declaration {
    Declarator(VarDeclId),
    Class(ClassId),
    Statement(StmtId),
}

/// One declarator of `const a = f(), b = 1` can go while the other stays, so a declarator is named by itself.
#[derive(Default, Clone)]
pub struct LeftOutDeclarations(FxHashSet<(FileId, Declaration)>);

impl LeftOutDeclarations {
    /// The same declarations under the numbers that another program gives the files.
    pub fn in_other_program(
        &self,
        file_of: &dyn Fn(FileId) -> Option<FileId>,
    ) -> LeftOutDeclarations {
        let renumbered = (self.0.iter()).filter_map(|&(file, id)| Some((file_of(file)?, id)));
        LeftOutDeclarations(renumbered.collect())
    }

    pub fn leave_out_declarator(&mut self, file: FileId, declarator: VarDeclId) {
        self.0.insert((file, Declaration::Declarator(declarator)));
    }

    pub fn leave_out_class(&mut self, file: FileId, class: ClassId) {
        self.0.insert((file, Declaration::Class(class)));
    }

    pub fn leave_out_statement(&mut self, file: FileId, hir: &hir::File<'_>, statement: StmtId) {
        match hir[statement].kind {
            StmtKind::Var(declarators) => {
                let declarators = declarators.iter().map(Declaration::Declarator);
                self.0
                    .extend(declarators.map(|declarator| (file, declarator)));
            }
            StmtKind::Class(class) => self.leave_out_class(file, class),
            _ => {
                self.0.insert((file, Declaration::Statement(statement)));
            }
        }
    }

    pub fn is_declarator_left_out(&self, file: FileId, declarator: VarDeclId) -> bool {
        self.0
            .contains(&(file, Declaration::Declarator(declarator)))
    }

    pub fn is_class_left_out(&self, file: FileId, class: ClassId) -> bool {
        self.0.contains(&(file, Declaration::Class(class)))
    }

    pub fn is_statement_left_out(&self, file: FileId, statement: StmtId) -> bool {
        self.0.contains(&(file, Declaration::Statement(statement)))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
