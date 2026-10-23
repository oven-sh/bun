use bun_sema::check::aot::{ClassRef, FunctionRef};
use bun_sema::hir::MemberKind;
use bun_sema::types::SigId as SignatureId;
use rustc_hash::FxHashMap;
use std::sync::Arc;

use super::{FileLowering, class};
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, FunctionRelations, FunctionRole, SourceRange,
};
use crate::ir::{Body, DeclaredType, FunctionId, FunctionKey};

#[derive(Default)]
pub(in crate::lower) struct FunctionTypeState {
    declared: Vec<FunctionId>,
    classes: FxHashMap<ClassRef, FunctionId>,
}

pub(in crate::lower) fn find_function_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    signatures: &[SignatureId],
) -> Option<FunctionId> {
    let declaration = match signatures {
        &[signature] => file.queries.signature_declaration(signature)?,
        overloads => file.queries.first_overload(overloads)?,
    };
    Some(declare_signature(file, declaration))
}

pub(in crate::lower) fn find_class_function_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
) -> FunctionId {
    if let Some(&function_type) = file.types.function_types.classes.get(&class) {
        return function_type;
    }
    let function_type = match find_explicit_constructor(file, class) {
        Some(constructor) => declare_signature(file, constructor),
        None => {
            let function_type = file.reference_function(FunctionKey::ClassSignature(class));
            add_declared(file, function_type);
            function_type
        }
    };
    file.types
        .function_types
        .classes
        .insert(class, function_type);
    function_type
}

fn find_explicit_constructor(
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

fn add_declared(file: &mut FileLowering<'_, '_, '_, '_>, function_type: FunctionId) -> bool {
    let declared = &mut file.types.function_types.declared;
    match declared.binary_search(&function_type) {
        Ok(_) => false,
        Err(position) => {
            declared.insert(position, function_type);
            true
        }
    }
}

// The link step puts a function with a body below its own signature. What runs behind an overload is declared elsewhere.
fn declare_signature(
    file: &mut FileLowering<'_, '_, '_, '_>,
    declaration: FunctionRef,
) -> FunctionId {
    let function_type = file.reference_function(FunctionKey::Signature(declaration));
    if add_declared(file, function_type)
        && let Some(implementation) = file.queries.overload_implementation(declaration)
    {
        let implementation = file.reference_function(FunctionKey::Source(implementation));
        file.fragment
            .add_function_type_edge(implementation, function_type);
    }
    function_type
}

pub(in crate::lower) fn define_signatures(file: &mut FileLowering<'_, '_, '_, '_>) {
    let mut declared = core::mem::take(&mut file.types.function_types.declared);
    declared.sort_unstable_by_key(|&function_type| file.function_key(function_type));
    let signature = Arc::new(Function {
        name: None,
        module: file.module_id(),
        position: 0,
        text: SourceRange::default(),
        kind: FunctionKind::Plain,
        role: FunctionRole::Signature,
        flags: FunctionFlags::default(),
        length: 0,
        enclosing_runtime_function: None,
        captures: Vec::new(),
        this_type: DeclaredType::untyped(),
        parameters: Vec::new(),
        results: vec![DeclaredType::untyped()],
        body: Body::default(),
        function_types: Vec::new(),
        builtin_members: Vec::new(),
        relations: FunctionRelations::default(),
    });
    for function_type in declared {
        file.fragment
            .define_function(function_type, Arc::clone(&signature));
    }
}
