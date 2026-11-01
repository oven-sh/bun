use super::declares_type_alone;
use crate::bind::BindingInitializer;
use crate::check::Checker;
use crate::hir::{ExprId, ExprKind, Flags, FnId, FnKind, Func, StmtKind, has_body};
use crate::program::{FileId, Sym};
use crate::types::{Origin, PropFlags, SigId, TypeData, TypeId};
use smallvec::SmallVec;

fn is_constructible_function(function: &Func) -> bool {
    let is_ordinary_function = matches!(function.kind, FnKind::Decl | FnKind::Expr);
    is_ordinary_function
        && has_body(function)
        && !function.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
}

impl Checker<'_, '_> {
    fn returns_own_constructions_only(
        &mut self,
        file: FileId,
        function: FnId,
        binding: Sym,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let returns = bound.ids(bound.fns[function.idx()].returns);
        let values: SmallVec<[ExprId; 4]> = returns
            .filter_map(|statement| match hir[statement].kind {
                StmtKind::Return(value) if value.is_some() => Some(value),
                _ => None,
            })
            .collect();
        values.into_iter().all(|value| {
            let ExprKind::New(site) = hir[self.skip_outer_expressions(file, value)].kind else {
                return false;
            };
            let callee = self.skip_outer_expressions(file, hir[site].callee);
            self.find_callee_binding(file, callee) == Some(binding)
        })
    }

    fn find_callee_binding(&mut self, file: FileId, callee: ExprId) -> Option<Sym> {
        let ExprKind::Ident(name) = self.hir(file)[callee].kind else {
            return None;
        };
        let symbol = self.symbol_of_identifier(file, callee, name)?;
        self.resolve_alias(symbol).symbol()
    }

    fn find_function_of_binding(&self, symbol: Sym) -> Option<(FileId, FnId)> {
        let declarations = self.files().decls_of(symbol);
        let mut values = declarations
            .iter()
            .filter(|&&(_, declaration)| !declares_type_alone(declaration));
        let (Some(&(file, declaration)), None) = (values.next(), values.next()) else {
            return None;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !bound.runtime.is_computed() {
            return None;
        }
        let binding = bound.declared_symbol(declaration);
        if !bound.is_stable_binding(binding) {
            return None;
        }
        match bound.binding_initializer(hir, binding) {
            BindingInitializer::Function(function) => Some((file, function)),
            BindingInitializer::Expression(value) => {
                if let ExprKind::Fn(function) = hir[value].kind {
                    Some((file, function))
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn is_declared_in_compiled_files(&mut self, object_type: TypeId) -> bool {
        if self.is_stack_low() {
            return false;
        }
        match self.data(object_type) {
            TypeData::Ref { target, .. } => {
                let declarations = self.files().decls_of(*target);
                let mut files = declarations.iter().map(|&(file, _)| file);
                !declarations.is_empty() && files.all(|file| self.is_compiled_file(file))
            }
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, _),
                ..
            } => self.is_compiled_file(*file),
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            } => match self.mapped_modifiers_type(object_type) {
                Some(modified) => self.is_declared_in_compiled_files(modified),
                None => false,
            },
            TypeData::Intersection(parts) => parts
                .iter()
                .all(|&part| self.is_declared_in_compiled_files(part)),
            _ => false,
        }
    }

    fn type_behind_mapped_types(&mut self, mapped: TypeId) -> TypeId {
        if self.is_stack_low() || self.mapped_origin(mapped).is_none() {
            return mapped;
        }
        match self.mapped_modifiers_type(mapped) {
            Some(source) if source != mapped => self.type_behind_mapped_types(source),
            _ => mapped,
        }
    }

    pub(in crate::check) fn has_other_optional_members_than_mapped_type(
        &mut self,
        object_type: TypeId,
    ) -> bool {
        if self.is_stack_low() {
            return false;
        }
        if let TypeData::Intersection(parts) = self.data(object_type) {
            return parts
                .iter()
                .any(|&part| self.has_other_optional_members_than_mapped_type(part));
        }
        if self.combined_mapped_optionality(object_type) == 0 {
            return false;
        }
        let source = self.type_behind_mapped_types(object_type);
        let Some(members) = self.members(object_type) else {
            return false;
        };
        members.shape().props.iter().any(|member| {
            let is_optional = member.flags.contains(PropFlags::OPTIONAL);
            self.get_property_of_type(source, member.name)
                .is_some_and(|(mapped, _)| {
                    mapped.flags.contains(PropFlags::OPTIONAL) != is_optional
                })
        })
    }

    pub(in crate::check) fn type_constructed_by_function(
        &mut self,
        file: FileId,
        callee: ExprId,
        signature: Option<SigId>,
    ) -> Option<TypeId> {
        if !self.is_in_compile_build(file) {
            return None;
        }
        let signature = signature?;
        let (of, function, _) = self.sig_decl(signature)?;
        let declared = self.hir(of)[function];
        if !is_constructible_function(&declared) || declared.this_ty(self.hir(of)).is_none() {
            return None;
        }
        let binding = self.find_callee_binding(file, callee)?;
        if self.find_function_of_binding(binding) != Some((of, function)) {
            return None;
        }
        if !self.returns_own_constructions_only(of, function, binding) {
            return None;
        }
        let constructed = self.sig_this_type(signature)?;
        let is_ordinary_object = self.is_declared_in_compiled_files(constructed)
            && self.signatures(constructed, false).is_empty()
            && self.signatures(constructed, true).is_empty();
        is_ordinary_object.then_some(constructed)
    }
}
