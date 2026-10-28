use super::builder::{BuilderScratch, Edge, FunctionBuilder, Handler};
use super::declared::DeclaredType;
use super::generated::{BlockRole, Function, FunctionFlags};
use super::ids::{BlockId, Id, LayoutId, StringId, TypeId};
use super::print::Printer;
use super::program::Program;
use super::types::{Type, TypeTable};
use crate::builtins::id::BuiltinClass;

pub fn layout(index: usize) -> LayoutId {
    LayoutId::new(index)
}

pub fn string(index: usize) -> StringId {
    StringId::new(index)
}

pub fn array_of(contents: TypeId) -> Type {
    Type::class(BuiltinClass::Array, &[contents])
}

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

pub fn create_builder(parameters: &[TypeId]) -> FunctionBuilder {
    let function = function_with_parameters(FunctionFlags::default(), parameters);
    FunctionBuilder::new(function, BuilderScratch::default())
}

pub fn create_blocks<const COUNT: usize>(builder: &mut FunctionBuilder) -> [BlockId; COUNT] {
    [(); COUNT].map(|()| builder.create_block(None))
}

pub fn create_catch_handler(builder: &mut FunctionBuilder) -> Handler {
    builder.create_handler(BlockRole::CatchHandler, None, None)
}

pub fn enter_block(builder: &mut FunctionBuilder, handler: Option<Handler>) -> BlockId {
    let block = builder.create_block(handler);
    builder.jump(Edge::to(block));
    builder.seal(block);
    builder.switch_to(block);
    block
}

pub fn print_with(program: &Program, print: impl FnOnce(&mut Printer<'_>)) -> String {
    let mut out = String::new();
    print(&mut Printer::new(program.name_tables(), &mut out));
    out
}

pub fn build_function(parameters: &[TypeId], fill: impl FnOnce(&mut FunctionBuilder)) -> Function {
    let mut builder = create_builder(parameters);
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
