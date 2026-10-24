use super::queries::Queries;
use crate::atom::known;
use crate::bind::{PatParent, SymFlags};
use crate::hir::{FnId, PatId, ResolutionMode};
use crate::program::{FileId, Sym};
use crate::types::{PropFlags, SigId, TypeId};
use crate::util::FxHashMap;
use smallvec::SmallVec;
use std::rc::Rc;

pub(super) type DeclaredSignatures = FxHashMap<FnId, SmallVec<[SigId; 1]>>;

const MAX_DEPTH: u32 = 3;

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn find_declared_parameter_type(&mut self, name: PatId) -> TypeId {
        let PatParent::Param(parameter) = self.bound().pat_parent[name.idx()] else {
            return TypeId::ANY;
        };
        let function = self.bound().param_fn[parameter.idx()];
        if function == FnId::NONE {
            return TypeId::ANY;
        }
        let mut written = self.hir()[function].params.iter();
        let Some(index) = written.position(|other| other == parameter) else {
            return TypeId::ANY;
        };
        let declared = self.declared_signatures();
        let Some(signatures) = declared.get(&function) else {
            return TypeId::ANY;
        };
        let mut parts: SmallVec<[TypeId; 4]> = SmallVec::new();
        for &signature in signatures {
            let signature = self.c.erased_sig(signature);
            let parameters = self.c.sig_params(signature);
            let Some(parameter) = parameters.get(index).filter(|it| !it.rest) else {
                return TypeId::ANY;
            };
            if self.c.has_type_variables(parameter.ty) {
                return TypeId::ANY;
            }
            parts.push(parameter.ty);
            if parameter.optional {
                parts.push(TypeId::UNDEFINED);
            }
        }
        match self.c.union(&parts) {
            TypeId::UNKNOWN => TypeId::ANY,
            declared => declared,
        }
    }

    fn declared_signatures(&mut self) -> Rc<DeclaredSignatures> {
        if let Some(known) = &self.memo.declared_signatures {
            return Rc::clone(known);
        }
        let mut signatures = DeclaredSignatures::default();
        if let Some(declaration) = self.find_own_declaration() {
            self.pair_exports(declaration, &mut signatures);
        }
        let signatures = Rc::new(signatures);
        self.memo.declared_signatures = Some(Rc::clone(&signatures));
        signatures
    }

    fn find_own_declaration(&self) -> Option<FileId> {
        let imports = &self.files().module(self.file).imports;
        let key = (known::own_declaration, ResolutionMode::None);
        imports.get(&key).copied()
    }

    fn pair_exports(&mut self, declaration: FileId, signatures: &mut DeclaredSignatures) {
        let files = self.files();
        let written_module = files.file_symbol(self.file);
        let declared_module = files.file_symbol(declaration);
        let declared_exports = files.exports_of_module(declared_module);
        for &(name, written) in files.exports_of_module(written_module) {
            let declared = declared_exports.iter().find(|export| export.0 == name);
            let Some(&(_, declared)) = declared else {
                continue;
            };
            let (Some(written), Some(declared)) = (
                self.find_exported_value(written),
                self.find_exported_value(declared),
            ) else {
                continue;
            };
            let written = self.c.type_of_symbol(written);
            let declared = self.c.type_of_symbol(declared);
            self.pair_types(written, declared, 0, signatures);
        }
    }

    fn find_exported_value(&self, export: Sym) -> Option<Sym> {
        let files = self.files();
        let value = files.resolve_alias_if_needed(export)?;
        files
            .flags(value)
            .intersects(SymFlags::VALUE)
            .then_some(value)
    }

    fn pair_types(
        &mut self,
        written: TypeId,
        declared: TypeId,
        depth: u32,
        signatures: &mut DeclaredSignatures,
    ) {
        if depth == MAX_DEPTH || self.c.is_stack_low() {
            return;
        }
        if self.c.is_any(written) || self.c.is_any(declared) {
            return;
        }
        for is_construct in [false, true] {
            let &[written] = &self.c.signatures(written, is_construct)[..] else {
                continue;
            };
            let declared = self.c.signatures(declared, is_construct);
            if declared.is_empty() {
                continue;
            }
            if let Some((file, function, _)) = self.c.sig_decl(written)
                && file == self.file
            {
                let entry = signatures.entry(function);
                entry.or_insert_with(|| SmallVec::from_slice(&declared));
            }
            if is_construct {
                let written = self.c.sig_return(written);
                let declared = self.c.sig_return(declared[0]);
                self.pair_types(written, declared, depth + 1, signatures);
            }
        }
        let Some(members) = self.c.members(written) else {
            return;
        };
        let mapper = members.mapper;
        for method in members.shape().props.iter() {
            if !method.flags.contains(PropFlags::METHOD) {
                continue;
            }
            let Some((counterpart, declared_mapper)) =
                self.c.get_property_of_type(declared, method.name)
            else {
                continue;
            };
            let written = self.c.type_of_prop(method, mapper);
            let declared = self.c.type_of_prop(counterpart, declared_mapper);
            self.pair_types(written, declared, depth + 1, signatures);
        }
    }
}
