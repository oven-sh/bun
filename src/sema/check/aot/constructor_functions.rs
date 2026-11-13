use super::answers::ObjectMemberKind;
use super::class_stores::BindingStoreKind;
use super::declares_type_alone;
use crate::atom::Atom;
use crate::bind::{Binding, BindingInitializer, Bound, Decl, FnOwner, Parent, SymbolId};
use crate::check::Checker;
use crate::hir::{self, ExprId, ExprKind, Flags, FnId, FnKind, Func, PatKind, StmtKind, has_body};
use crate::program::{FileId, Sym};
use crate::session::vec_from_iter_in;
use crate::types::{
    ConstructedBy, MapperId, Origin, Prop, PropFlags, PropSource, Shape, SigId, TypeData, TypeId,
};
use crate::util::FxHashSet;
use smallvec::SmallVec;

fn is_constructible_function(function: &Func) -> bool {
    let is_ordinary_function = matches!(function.kind, FnKind::Decl | FnKind::Expr);
    is_ordinary_function
        && has_body(function)
        && !function.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
}

fn find_bindings_of_function(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> SmallVec<[SymbolId; 2]> {
    let mut bindings = SmallVec::new();
    bindings.extend(bound.declared_symbol(Decl::Fn(function)).some());
    if let FnOwner::Expr(expression) = bound.fns[function.idx()].owner
        && let Parent::VarInit(variable) = bound.parent_of_expr(expression)
        && matches!(hir[hir[variable].pat].kind, PatKind::Ident(_))
    {
        bindings.extend(bound.declared_symbol(Decl::Var(hir[variable].pat)).some());
    }
    bindings
}

impl Checker<'_, '_> {
    fn returns_this_or_own_constructions(&self, file: FileId, function: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let bindings = find_bindings_of_function(hir, bound, function);
        let mut returns = bound.ids(bound.fns[function.idx()].returns);
        returns.all(|statement| {
            let StmtKind::Return(value) = hir[statement].kind else {
                return true;
            };
            let Some(value) = value.some() else {
                return true;
            };
            if self.is_dead_statement(file, statement) {
                return true;
            }
            match hir[hir.skip_type_assertions(value)].kind {
                ExprKind::This => true,
                ExprKind::New(site) => {
                    let callee = hir.skip_type_assertions(hir[site].callee);
                    matches!(hir[callee].kind, ExprKind::Ident(_))
                        && matches!(
                            bound.binding(callee),
                            Binding::Symbol(symbol) if bindings.contains(&symbol)
                        )
                }
                _ => false,
            }
        })
    }

    /// `getInferredClassType`
    fn compute_instance_type_of_constructor_function(
        &mut self,
        file: FileId,
        function: FnId,
    ) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !bound.runtime.is_computed() {
            return None;
        }
        let stores = self.written_stores(file);
        let mut members: Vec<(Atom, PropFlags)> = Vec::new();
        let mut given_this: SmallVec<[FnId; 8]> = SmallVec::new();
        given_this.push(function);
        for binding in find_bindings_of_function(hir, bound, function) {
            if !bound.is_stable_binding(binding) {
                continue;
            }
            for store in stores.binding_stores_of(binding) {
                let flags = match store.kind {
                    BindingStoreKind::Static => continue,
                    BindingStoreKind::Prototype(ObjectMemberKind::Method) => PropFlags::METHOD,
                    BindingStoreKind::Prototype(
                        ObjectMemberKind::Field
                        | ObjectMemberKind::Getter
                        | ObjectMemberKind::Setter
                        | ObjectMemberKind::GetterAndSetter,
                    ) => PropFlags::empty(),
                };
                members.push((store.name, flags));
                if let ExprKind::Fn(method) = hir[store.value].kind {
                    given_this.push(method);
                }
            }
        }
        for holder in given_this {
            let stored = stores.names_stored_into_this_of(holder).iter();
            members.extend(stored.map(|&(_, name)| (name, PropFlags::empty())));
        }
        let mut listed = FxHashSet::default();
        members.retain(|member| listed.insert(member.0));
        if members.is_empty() {
            return None;
        }
        let arena = self.arena;
        let props = members.into_iter().map(|(name, flags)| Prop {
            name,
            flags,
            source: PropSource::Type(TypeId::ANY),
            mapper: MapperId::IDENTITY,
            name_type: TypeId::UNRESOLVED,
        });
        Some(self.synth(Shape {
            props: vec_from_iter_in(props, arena),
            constructed_by: ConstructedBy(Some((file, function))),
            ..Shape::new_in(arena)
        }))
    }

    fn instance_type_by_signature(&mut self, site: FileId, signature: SigId) -> Option<TypeId> {
        let (file, function, _) = self.sig_decl(signature)?;
        if !self.is_out_of_sight_of_checked_files(site)
            || !self.is_out_of_sight_of_checked_files(file)
        {
            return None;
        }
        let declared = self.hir(file)[function];
        if !is_constructible_function(&declared) || declared.this_ty(self.hir(file)).is_some() {
            return None;
        }
        let known = &self.flow_memo.instance_types_of_constructor_functions;
        if let Some(&known) = known.get(&(file, function)) {
            return known;
        }
        let instance = self.compute_instance_type_of_constructor_function(file, function);
        let known = &mut self.flow_memo.instance_types_of_constructor_functions;
        known.insert((file, function), instance);
        instance
    }

    pub(in crate::check) fn instance_type_of_constructor_function(
        &mut self,
        site: FileId,
        constructor: TypeId,
    ) -> Option<TypeId> {
        if !self.is_out_of_sight_of_checked_files(site) {
            return None;
        }
        let &[signature] = &self.signatures(constructor, false)[..] else {
            return None;
        };
        self.instance_type_by_signature(site, signature)
    }

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
        if !is_constructible_function(&declared) {
            return None;
        }
        if declared.this_ty(self.hir(of)).is_none() {
            let instance = self.instance_type_by_signature(file, signature)?;
            return self
                .returns_this_or_own_constructions(of, function)
                .then_some(instance);
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
