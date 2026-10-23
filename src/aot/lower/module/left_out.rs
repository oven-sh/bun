#[cfg(test)]
mod tests;

use bun_sema::hir::{self, ClassId, StmtId, StmtKind, VarDeclId};
use bun_sema::program::FileId;
use rustc_hash::FxHashSet;

/// One declarator of `const a = f(), b = 1` can go while the other stays, so a declarator is named by itself.
#[derive(Default, Clone)]
pub struct LeftOutDeclarations {
    declarators: FxHashSet<(FileId, VarDeclId)>,
    classes: FxHashSet<(FileId, ClassId)>,
    statements: FxHashSet<(FileId, StmtId)>,
}

impl LeftOutDeclarations {
    pub fn leave_out_declarator(&mut self, file: FileId, declarator: VarDeclId) {
        self.declarators.insert((file, declarator));
    }

    pub fn leave_out_class(&mut self, file: FileId, class: ClassId) {
        self.classes.insert((file, class));
    }

    pub fn leave_out_statement(&mut self, file: FileId, hir: &hir::File<'_>, statement: StmtId) {
        match hir[statement].kind {
            StmtKind::Var(declarators) => {
                self.declarators
                    .extend(declarators.iter().map(|declarator| (file, declarator)));
            }
            StmtKind::Class(class) => self.leave_out_class(file, class),
            _ => {
                self.statements.insert((file, statement));
            }
        }
    }

    pub fn is_declarator_left_out(&self, file: FileId, declarator: VarDeclId) -> bool {
        self.declarators.contains(&(file, declarator))
    }

    pub fn is_class_left_out(&self, file: FileId, class: ClassId) -> bool {
        self.classes.contains(&(file, class))
    }

    pub fn is_statement_left_out(&self, file: FileId, statement: StmtId) -> bool {
        self.statements.contains(&(file, statement))
    }

    pub fn is_empty(&self) -> bool {
        self.declarators.is_empty() && self.classes.is_empty() && self.statements.is_empty()
    }
}
