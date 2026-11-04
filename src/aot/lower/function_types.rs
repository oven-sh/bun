use bun_sema::check::aot::{ClassRef, FunctionRef};
use bun_sema::hir::{FnBody, MemberKind};
use bun_sema::types::SigId as SignatureId;
use rustc_hash::FxHashMap;
use std::sync::Arc;

use super::context::SourceKind;
use super::{FileLowering, class};
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, FunctionRole, FunctionSyntax, SourceRange,
};
use crate::ir::{Body, DeclaredType, FunctionId, FunctionKey, Mapped, PositionFlags};

#[derive(Default)]
pub(in crate::lower) struct FunctionTypeState {
    declared: Vec<FunctionId>,
    classes: FxHashMap<ClassRef, FunctionId>,
    parameters: FxHashMap<FunctionId, Vec<DeclaredType>>,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn find_function_type(
        &mut self,
        signatures: &[SignatureId],
    ) -> Option<FunctionId> {
        let declaration = match signatures {
            &[signature] => self.queries.signature_declaration(signature)?,
            overloads => self.queries.first_overload(overloads)?,
        };
        Some(self.declare_signature(declaration))
    }

    pub(in crate::lower) fn find_class_function_type(&mut self, class: ClassRef) -> FunctionId {
        if let Some(&function_type) = self.types.function_types.classes.get(&class) {
            return function_type;
        }
        let function_type = match find_explicit_constructor(self, class) {
            Some(constructor) => self.declare_signature(constructor),
            None => {
                let function_type = self.reference_function(FunctionKey::ClassSignature(class));
                self.add_declared(function_type);
                function_type
            }
        };
        let memo = &mut self.types.function_types.classes;
        memo.insert(class, function_type);
        function_type
    }

    fn add_declared(&mut self, function_type: FunctionId) -> bool {
        let declared = &mut self.types.function_types.declared;
        match declared.binary_search(&function_type) {
            Ok(_) => false,
            Err(position) => {
                declared.insert(position, function_type);
                true
            }
        }
    }

    // The link step puts a function with a body below its own signature. What runs behind an overload is declared elsewhere.
    fn declare_signature(&mut self, declaration: FunctionRef) -> FunctionId {
        let function_type = self.reference_function(FunctionKey::Signature(declaration));
        if self.add_declared(function_type)
            && let Some(implementation) = self.queries.overload_implementation(declaration)
        {
            let implementation = self.reference_function(FunctionKey::Source(implementation));
            self.fragment
                .add_function_type_edge(implementation, function_type);
        }
        function_type
    }

    // The library calls a callback with the argument types it declares. Callers are not checked, so the types are predictions.
    pub(in crate::lower) fn collect_function_type_parameters(&mut self) {
        if self.source == SourceKind::Program || !self.is_checked() {
            return;
        }
        for function_type in self.types.function_types.declared.clone() {
            let FunctionKey::Signature(declaration) = self.function_key(function_type) else {
                continue;
            };
            let is_declared_here = declaration.file == self.file
                && matches!(self.hir[declaration.function].body, FnBody::None);
            if !is_declared_here {
                continue;
            }
            let shape = self.queries.function_signature(declaration);
            if shape.has_type_parameters {
                continue;
            }
            let mut parameters = Vec::with_capacity(shape.parameters.len());
            for parameter in shape.parameters.iter().take_while(|it| !it.is_rest) {
                let ty = self.create_member_position(parameter.types).ty;
                let expected = Mapped::expected(ty);
                parameters.push(DeclaredType::new(expected, None, PositionFlags::default()));
            }
            let types = &self.fragment.types;
            let names_layout = |it: &DeclaredType| !types.get(it.ty).layouts.is_empty();
            if parameters.iter().any(names_layout) {
                let known = &mut self.types.function_types.parameters;
                known.insert(function_type, parameters);
            }
        }
    }

    pub(in crate::lower) fn define_signatures(&mut self) {
        let mut declared = core::mem::take(&mut self.types.function_types.declared);
        let mut parameters = core::mem::take(&mut self.types.function_types.parameters);
        declared.sort_unstable_by_key(|&function_type| self.function_key(function_type));
        let signature = Arc::new(Function {
            name: None,
            module: self.module_id(),
            position: 0,
            text: SourceRange::default(),
            kind: FunctionKind::Plain,
            role: FunctionRole::Signature,
            flags: FunctionFlags::default(),
            length: 0,
            syntax: FunctionSyntax::default(),
            enclosing_runtime_function: None,
            captures: Vec::new(),
            this_type: DeclaredType::untyped(),
            parameters: Vec::new(),
            results: vec![DeclaredType::untyped()],
            body: Body::default(),
            function_types: Vec::new(),
            builtin_members: Vec::new(),
        });
        for function_type in declared {
            let signature = match parameters.remove(&function_type) {
                Some(parameters) => Arc::new(Function {
                    parameters,
                    ..Function::clone(&signature)
                }),
                None => Arc::clone(&signature),
            };
            self.fragment.define_function(function_type, signature);
        }
    }
}

pub(in crate::lower) fn find_explicit_constructor(
    file: &FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
) -> Option<FunctionRef> {
    let hir = file.queries.files().hir(class.file);
    let constructor = class::runtime_members(hir, class.class)
        .find(|&member| hir.runtime_member_kind(member) == MemberKind::Constructor)?;
    Some(FunctionRef {
        file: class.file,
        function: hir[constructor].func,
    })
}
