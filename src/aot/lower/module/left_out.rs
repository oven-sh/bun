#[cfg(test)]
mod tests;

use bun_sema::bind::SymbolId;
use bun_sema::hir::{self, ClassId, MemberId, StmtId, StmtKind, VarDeclId};
use bun_sema::program::FileId;
use rustc_hash::FxHashSet;

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Declaration {
    Declarator(VarDeclId),
    Class(ClassId),
    Statement(StmtId),
    // Not left out, where the class itself is: the check of what it extends, the conversion of a computed key to a property key.
    HeritageCheck(ClassId),
    KeyConversion(MemberId),
    // Not left out by itself: the variable of an enum or of the value of a module of data, whose object nothing that the program can run gets hold of.
    ObjectNeverHandedOn(SymbolId),
}

/// One declarator of `const a = f(), b = 1` can go while the other stays, so a declarator is named by itself.
#[derive(Default, Clone, PartialEq, Eq)]
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

    pub fn keep_heritage_check(&mut self, file: FileId, class: ClassId) {
        self.0.insert((file, Declaration::HeritageCheck(class)));
    }

    pub fn keep_key_conversion(&mut self, file: FileId, member: MemberId) {
        self.0.insert((file, Declaration::KeyConversion(member)));
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

    pub fn note_object_never_handed_on(&mut self, file: FileId, variable: SymbolId) {
        self.0
            .insert((file, Declaration::ObjectNeverHandedOn(variable)));
    }

    /// Nothing stores to the object, so each member holds what it was made with.
    pub fn is_object_never_handed_on(&self, file: FileId, variable: SymbolId) -> bool {
        self.0
            .contains(&(file, Declaration::ObjectNeverHandedOn(variable)))
    }

    pub fn is_declarator_left_out(&self, file: FileId, declarator: VarDeclId) -> bool {
        self.0
            .contains(&(file, Declaration::Declarator(declarator)))
    }

    pub fn is_class_left_out(&self, file: FileId, class: ClassId) -> bool {
        self.0.contains(&(file, Declaration::Class(class)))
    }

    pub fn is_heritage_check_kept(&self, file: FileId, class: ClassId) -> bool {
        self.0.contains(&(file, Declaration::HeritageCheck(class)))
    }

    pub fn is_key_conversion_kept(&self, file: FileId, member: MemberId) -> bool {
        self.0.contains(&(file, Declaration::KeyConversion(member)))
    }

    pub fn is_statement_left_out(&self, file: FileId, statement: StmtId) -> bool {
        self.0.contains(&(file, Declaration::Statement(statement)))
    }
}
