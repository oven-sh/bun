use crate::atom::{Atom, known};
use crate::check::Checker;
use crate::program::{Files, Sym};
use crate::types::{Origin, TypeData, TypeId};

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum DiagnosticSubject {
    #[default]
    None,
    ModuleSpecifier(Atom),
    MemberContainer(Sym),
}

impl DiagnosticSubject {
    pub fn or(self, other: DiagnosticSubject) -> DiagnosticSubject {
        match self {
            DiagnosticSubject::None => other,
            DiagnosticSubject::ModuleSpecifier(_) | DiagnosticSubject::MemberContainer(_) => self,
        }
    }
}

pub fn containers_completed_by_bun_types(files: &Files<'_>) -> [Option<Sym>; 3] {
    let bun_module = files
        .atoms
        .lookup(b"bun")
        .and_then(|specifier| files.try_find_ambient_module(specifier));
    let import_meta = files
        .global_type_symbol(known::ImportMeta)
        .map(|symbol| files.canonical(symbol));
    let error_constructor = files
        .atoms
        .lookup(b"ErrorConstructor")
        .and_then(|name| files.global_type_symbol(name))
        .map(|symbol| files.canonical(symbol));
    [bun_module, import_meta, error_constructor]
}

impl Checker<'_, '_> {
    pub(in crate::check) fn member_container(&self, symbol: Sym) -> DiagnosticSubject {
        DiagnosticSubject::MemberContainer(self.files().canonical(symbol))
    }

    pub(in crate::check) fn member_container_of_type(&self, ty: TypeId) -> DiagnosticSubject {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => self.member_container(target),
            TypeData::Anon {
                origin: Origin::Module(module) | Origin::Namespace { module, .. },
                ..
            } => self.member_container(module),
            _ => DiagnosticSubject::None,
        }
    }
}
