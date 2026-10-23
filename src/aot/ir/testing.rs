use super::builder::{BuilderScratch, FunctionBuilder};
use super::declared::DeclaredType;
use super::generated::{Function, FunctionFlags};
use super::ids::TypeId;
use super::types::TypeTable;

pub fn function_with_parameters(flags: FunctionFlags, parameters: &[TypeId]) -> Function {
    let declare = |&ty: &TypeId| DeclaredType {
        ty,
        ..DeclaredType::untyped()
    };
    Function {
        flags,
        this_type: DeclaredType::untyped(),
        parameters: parameters.iter().map(declare).collect(),
        results: vec![DeclaredType::untyped()],
        ..Function::default()
    }
}

pub fn build_function(parameters: &[TypeId], fill: impl FnOnce(&mut FunctionBuilder)) -> Function {
    let function = function_with_parameters(FunctionFlags::default(), parameters);
    let mut builder = FunctionBuilder::new(function, BuilderScratch::default());
    fill(&mut builder);
    let (function, _) = builder.finish();
    assert_eq!(function.body.check_stream(), Ok(()));
    function
}

#[test]
fn function_with_parameters_declares_header_only() {
    let parameters = [TypeTable::NUMBER, TypeTable::STRING];
    let function = function_with_parameters(FunctionFlags::IS_ASYNC, &parameters);
    assert_eq!(function.flags, FunctionFlags::IS_ASYNC);
    let declared_types = function.parameters.iter().map(|declared| declared.ty);
    assert_eq!(declared_types.collect::<Vec<_>>(), parameters);
    assert_eq!(function.this_type, DeclaredType::untyped());
    assert_eq!(function.results, [DeclaredType::untyped()]);
    assert!(function.captures.is_empty());
    assert!(function.body.code.is_empty());
}

#[test]
fn build_function_finishes_filled_body() {
    let function = build_function(&[TypeTable::NUMBER], |builder| {
        let parameter = builder.parameter(0);
        builder.return_value(Some(parameter));
    });
    let declared_types = function.parameters.iter().map(|declared| declared.ty);
    assert_eq!(declared_types.collect::<Vec<_>>(), [TypeTable::NUMBER]);
    assert_eq!(function.body.block_count, 1);
    assert_eq!(function.body.value_count, 1);
    assert!(!function.body.code.is_empty());
}
