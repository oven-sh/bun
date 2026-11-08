use bun_sema::check::aot::{ClassRef, FunctionRef};
use bun_sema::hir::MemberKind;
use bun_sema::types::SigId as SignatureId;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::sync::Arc;

use super::{FileLowering, class};
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, FunctionRole, FunctionSyntax, SourceRange,
};
use crate::ir::{Body, DeclaredType, FunctionId, FunctionKey};

pub(in crate::lower) type FunctionTypes = SmallVec<[FunctionId; 2]>;

#[derive(Default)]
pub(in crate::lower) struct FunctionTypeState {
    declared: Vec<FunctionId>,
    classes: FxHashMap<ClassRef, FunctionId>,
    asked_for: Option<FunctionTypes>,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn begin_list_of_function_types(&mut self) {
        self.types.function_types.asked_for = Some(FunctionTypes::new());
    }

    pub(in crate::lower) fn take_list_of_function_types(&mut self) -> Option<FunctionTypes> {
        self.types.function_types.asked_for.take()
    }

    fn list_function_type(&mut self, function_type: FunctionId) -> FunctionId {
        if let Some(asked_for) = &mut self.types.function_types.asked_for {
            asked_for.push(function_type);
        }
        function_type
    }

    pub(in crate::lower) fn find_function_type(
        &mut self,
        signatures: &[SignatureId],
    ) -> Option<FunctionId> {
        let declaration = self.queries.declaration_of_signatures(signatures)?;
        let function_type = self.declare_signature(declaration);
        Some(self.list_function_type(function_type))
    }

    pub(in crate::lower) fn find_class_function_type(&mut self, class: ClassRef) -> FunctionId {
        let function_type = self.declare_class_function_type(class);
        self.list_function_type(function_type)
    }

    pub(in crate::lower) fn declare_function_type_again(&mut self, function_type: FunctionId) {
        match self.function_key(function_type) {
            FunctionKey::Signature(declaration) => {
                self.declare_signature(declaration);
            }
            key => {
                debug_assert!(matches!(key, FunctionKey::ClassSignature(_)));
                self.reference_function(key);
                self.add_declared(function_type);
            }
        }
    }

    fn declare_class_function_type(&mut self, class: ClassRef) -> FunctionId {
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

    pub(in crate::lower) fn define_signatures(&mut self) {
        let mut declared = core::mem::take(&mut self.types.function_types.declared);
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
            self.fragment
                .define_function(function_type, Arc::clone(&signature));
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
