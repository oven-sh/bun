use crate::atom::{Atom, known};
use crate::bind::SymFlags;
use crate::check::Checker;
use crate::program::{Files, Sym};
use crate::types::{Origin, Prop, PropSource, TypeData, TypeId};

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

pub fn containers_completed_by_bun_types(files: &Files<'_>) -> [Option<Sym>; 4] {
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
    let node_namespace = files
        .atoms
        .lookup(b"NodeJS")
        .and_then(|name| files.global(name, SymFlags::NAMESPACE))
        .map(|symbol| files.canonical(symbol));
    [bun_module, import_meta, error_constructor, node_namespace]
}

impl Checker<'_, '_> {
    /// True if the member is there by the brought declarations alone, whoever has declared what it is a member of:
    /// `fetch.preconnect`. What several files declare is one symbol that lies in the file of its first declaration.
    pub(in crate::check) fn is_prop_brought(&self, prop: &Prop<'_>) -> bool {
        let PropSource::Symbol(symbol) = prop.source else {
            return false;
        };
        let files = self.files();
        let declarations = files.decls_of(files.canonical(symbol));
        !declarations.is_empty() && declarations.iter().all(|&(of, _)| files.is_brought(of))
    }

    pub(in crate::check) fn member_container(&self, symbol: Sym) -> DiagnosticSubject {
        let container = self.files().canonical(symbol);
        self.files().keep_tree(container.file);
        DiagnosticSubject::MemberContainer(container)
    }

    pub(in crate::check) fn member_container_of_type(&self, ty: TypeId) -> DiagnosticSubject {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => self.member_container(target),
            TypeData::Anon {
                origin:
                    Origin::Module(module) | Origin::Namespace { module, .. } | Origin::Function(module),
                ..
            } => self.member_container(module),
            _ => DiagnosticSubject::None,
        }
    }
}
