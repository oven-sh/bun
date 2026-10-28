use crate::ir::declared::DeclaredType;
use crate::ir::entry_parameters::EntryPosition;
use crate::ir::generated::{EntryParameter, Function, FunctionFlags};
use crate::ir::ids::TypeId;
use crate::ir::testing::function_with_parameters;
use crate::ir::types::TypeTable;

fn create_function(flags: FunctionFlags) -> Function {
    let parameters = [TypeTable::BOOLEAN, TypeTable::BIGINT];
    let captures = [TypeTable::NUMBER, TypeTable::STRING];
    let mut function = function_with_parameters(flags, &parameters);
    function.captures = captures.map(DeclaredType::from_compiler).to_vec();
    function.this_type = DeclaredType::from_compiler(TypeTable::OBJECT);
    function
}

fn create_constructor() -> Function {
    create_function(FunctionFlags::HAS_THIS | FunctionFlags::HAS_NEW_TARGET)
}

fn positions_of(function: &Function) -> Vec<EntryPosition> {
    let indexes = 0..function.entry_parameter_count();
    indexes
        .map(|index| {
            function
                .entry_parameter(index)
                .expect("an index below the count")
        })
        .collect()
}

#[test]
fn entry_parameters_are_ordered() {
    let function = create_function(FunctionFlags::ALL);
    let expected = [
        EntryPosition::new(EntryParameter::Capture, 0),
        EntryPosition::new(EntryParameter::Capture, 1),
        EntryPosition::single(EntryParameter::This),
        EntryPosition::single(EntryParameter::Callee),
        EntryPosition::single(EntryParameter::NewTarget),
        EntryPosition::single(EntryParameter::ArgumentCount),
        EntryPosition::new(EntryParameter::Parameter, 0),
        EntryPosition::new(EntryParameter::Parameter, 1),
        EntryPosition::single(EntryParameter::HiddenRest),
    ];
    assert_eq!(function.entry_parameter_count(), expected.len());
    assert_eq!(positions_of(&function), expected);
    assert_eq!(function.entry_parameter(expected.len()), None);
}

#[test]
fn parameters_without_flag_are_absent() {
    let expected = [
        EntryPosition::new(EntryParameter::Capture, 0),
        EntryPosition::new(EntryParameter::Capture, 1),
        EntryPosition::single(EntryParameter::This),
        EntryPosition::single(EntryParameter::NewTarget),
        EntryPosition::new(EntryParameter::Parameter, 0),
        EntryPosition::new(EntryParameter::Parameter, 1),
    ];
    assert_eq!(positions_of(&create_constructor()), expected);

    let flags_without_entry_parameter = FunctionFlags::IS_ASYNC
        | FunctionFlags::IS_GENERATOR
        | FunctionFlags::IS_SLOPPY
        | FunctionFlags::HAS_REST_PARAMETER
        | FunctionFlags::IS_CHECKED;
    let function = create_function(flags_without_entry_parameter);
    assert_eq!(function.entry_parameter_count(), 4);
    assert_eq!(
        function_with_parameters(FunctionFlags::default(), &[]).entry_parameter_count(),
        0
    );
}

#[test]
fn entry_parameter_types_follow_declarations() {
    let function = create_function(FunctionFlags::ALL);
    let positions = positions_of(&function);
    let types: Vec<TypeId> = positions
        .into_iter()
        .map(|position| function.entry_parameter_type(position))
        .collect();
    let expected = [
        TypeTable::NUMBER,
        TypeTable::STRING,
        TypeTable::OBJECT,
        TypeTable::FUNCTION,
        TypeTable::ANYTHING,
        TypeTable::UINT32,
        TypeTable::BOOLEAN,
        TypeTable::BIGINT,
        TypeTable::ARRAY,
    ];
    assert_eq!(types, expected);
}

#[test]
fn undeclared_this_is_anything() {
    let function = function_with_parameters(FunctionFlags::HAS_THIS, &[]);
    let this = EntryPosition::single(EntryParameter::This);
    assert_eq!(function.entry_parameter(0), Some(this));
    assert_eq!(function.entry_parameter_type(this), TypeTable::ANYTHING);
}

#[test]
fn entry_parameter_index_inverts_entry_parameter() {
    for function in [create_function(FunctionFlags::ALL), create_constructor()] {
        for (index, position) in positions_of(&function).into_iter().enumerate() {
            assert_eq!(function.entry_parameter_index(position), Some(index));
        }
    }
}

#[test]
fn absent_entry_parameter_has_no_index() {
    let index_in = |function: &Function, kind: EntryParameter, index: u32| {
        function.entry_parameter_index(EntryPosition::new(kind, index))
    };
    let constructor = create_constructor();
    assert_eq!(index_in(&constructor, EntryParameter::Callee, 0), None);
    assert_eq!(
        index_in(&constructor, EntryParameter::ArgumentCount, 0),
        None
    );
    assert_eq!(index_in(&constructor, EntryParameter::HiddenRest, 0), None);
    assert_eq!(index_in(&constructor, EntryParameter::Capture, 2), None);
    assert_eq!(index_in(&constructor, EntryParameter::Parameter, 2), None);
    assert_eq!(index_in(&constructor, EntryParameter::This, 1), None);

    let plain = create_function(FunctionFlags::default());
    assert_eq!(plain.entry_parameter_count(), 4);
    assert_eq!(index_in(&plain, EntryParameter::This, 0), None);
    assert_eq!(index_in(&plain, EntryParameter::NewTarget, 0), None);
    assert_eq!(index_in(&plain, EntryParameter::Parameter, 0), Some(2));
}

#[test]
fn order_is_declaration_order_of_schema() {
    let function = create_function(FunctionFlags::ALL);
    let positions = positions_of(&function);
    let mut kinds: Vec<EntryParameter> = positions.iter().map(|position| position.kind).collect();
    kinds.dedup();
    assert_eq!(kinds, EntryParameter::ALL);
}

#[test]
fn single_parameter_is_present_with_flag() {
    for kind in EntryParameter::ALL {
        let flag = kind.present_with();
        if flag.is_empty() {
            continue;
        }
        let function = function_with_parameters(flag, &[]);
        assert_eq!(positions_of(&function), [EntryPosition::single(kind)]);
    }
}
