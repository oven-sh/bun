use super::handlers::emit_call;
use super::references::IdMapStorage;
use crate::builtins::id::BuiltinId;
use crate::ir::body::{BlockView, Body, StreamError, TargetView};
use crate::ir::builder::Edge;
use crate::ir::declared::{DeclaredType, Mapped, PositionFlags};
use crate::ir::generated::{
    BlockFrequency, BlockRole, FunctionReferenceKind, IllTypedCause, InternalErrorKind,
    ModuleReferenceKind, Opcode, RuntimeErrorKind, TemplateString, TerminatorKind,
};
use crate::ir::ids::{
    ABSENT_WORD, BlockId, DataId, EvalScopeId, ExpectedResultId, FunctionId, Id, LayoutId,
    ModuleFailureId, ModuleId, PropertyKeyId, StringId, TypeId, TypeSiteId, ValueId, VariableId,
};
use crate::ir::references::Reference;
use crate::ir::testing::{build_function, create_blocks};
use crate::ir::types::TypeTable;

const REMAP_OFFSET: usize = 100;
const REMAPPED_ID_COUNT: usize = 100;

type Target = (BlockId, Vec<ValueId>, Vec<u32>);

fn value(index: usize) -> ValueId {
    ValueId::new(index)
}

fn block(index: usize) -> BlockId {
    BlockId::new(index)
}

fn describe_target(target: TargetView<'_>) -> Target {
    (
        target.block,
        target.arguments().collect(),
        target.proofs.to_vec(),
    )
}

fn build_guarded_body() -> Body {
    let function = build_function(&[TypeTable::ANYTHING], |builder| {
        let object = builder.parameter(0);
        let variable = builder.create_variable(Some(TypeTable::NUMBER));
        let initial = builder.integer(1);
        builder.write_variable(variable, initial);
        let handler = builder.create_handler(BlockRole::IterationCleanup, Some(object), None);
        let covered = builder.create_block(Some(handler));
        let [taken, not_taken] = create_blocks(builder);
        let narrowed = builder.add_edge_result(taken);
        builder.set_frequency(covered, BlockFrequency::Unlikely);
        builder.jump(Edge::to(covered));
        builder.seal(covered);

        builder.switch_to(covered);
        builder.set_position(Some(9));
        let read = builder.prop_get(object, PropertyKeyId::new(7), false, true);
        builder.write_variable(variable, read);
        builder.branch(read, Edge::with_proofs(taken, &[0]), Edge::to(not_taken));
        builder.set_position(None);
        builder.seal(taken);
        builder.seal(not_taken);
        builder.seal(handler.block());

        builder.switch_to(taken);
        builder.return_value(Some(narrowed));
        builder.switch_to(not_taken);
        builder.return_value(None);
        builder.switch_to(handler.block());
        let thrown = builder.read_variable(variable);
        builder.throw(thrown);
    });
    function.body
}

fn collect_from_blocks<T>(body: &Body, read: impl FnMut(BlockView<'_>) -> T) -> Vec<T> {
    body.blocks().map(read).collect()
}

#[test]
fn written_stream_is_well_formed() {
    let body = build_guarded_body();
    assert_eq!(body.check_stream(), Ok(()));
    assert_eq!((body.block_count, body.value_count), (6, 5));
    assert_eq!(Body::default().check_stream(), Ok(()));
}

#[test]
fn views_decode_block_heads() {
    let body = build_guarded_body();
    let ids = collect_from_blocks(&body, |view| view.id);
    assert_eq!(ids, [0, 1, 2, 3, 4, 5].map(block));
    let first_parameters = collect_from_blocks(&body, |view| view.first_parameter);
    assert_eq!(first_parameters, [0, 2, 3, 3, 4, 4].map(value));
    let first_values = collect_from_blocks(&body, |view| view.first_value());
    assert_eq!(first_values, [1, 2, 3, 4, 4, 5].map(value));
    let parameter_counts = collect_from_blocks(&body, |view| view.parameter_count());
    assert_eq!(parameter_counts, [1, 0, 0, 1, 0, 1]);
    let value_counts = collect_from_blocks(&body, |view| view.value_count());
    assert_eq!(value_counts, [1, 1, 0, 0, 0, 0]);

    let ordinary = BlockRole::Ordinary;
    let roles = collect_from_blocks(&body, |view| view.role);
    let cleanup = BlockRole::IterationCleanup;
    assert_eq!(
        roles,
        [ordinary, ordinary, ordinary, ordinary, ordinary, cleanup]
    );
    let subjects = collect_from_blocks(&body, |view| view.subject);
    assert_eq!(subjects, [None, None, None, None, None, Some(value(0))]);
    let (normal, unlikely) = (BlockFrequency::Normal, BlockFrequency::Unlikely);
    let frequencies = collect_from_blocks(&body, |view| view.frequency);
    assert_eq!(
        frequencies,
        [normal, unlikely, unlikely, normal, normal, normal]
    );
}

#[test]
fn views_decode_parameter_types() {
    let body = build_guarded_body();
    let parameter_types: Vec<Vec<Option<TypeId>>> =
        collect_from_blocks(&body, |view| view.parameter_types().collect());
    let expected: [&[Option<TypeId>]; 6] = [
        &[Some(TypeTable::ANYTHING)],
        &[],
        &[],
        &[None],
        &[],
        &[Some(TypeTable::NUMBER)],
    ];
    assert_eq!(parameter_types, expected);
}

#[test]
fn views_decode_handlers() {
    let body = build_guarded_body();
    let handlers = collect_from_blocks(&body, |view| view.handler().map(describe_target));
    let expected: [Option<Target>; 6] = [
        None,
        Some((block(5), vec![value(1)], Vec::new())),
        Some((block(5), vec![value(2)], Vec::new())),
        None,
        None,
        None,
    ];
    assert_eq!(handlers, expected);
}

#[test]
fn views_decode_values() {
    let body = build_guarded_body();
    let values = body.blocks().flat_map(|view| view.values());
    let values: Vec<(ValueId, Opcode, Option<u32>, &[u32])> = values
        .map(|view| (view.id, view.opcode, view.position, view.fields))
        .collect();
    let expected: [(ValueId, Opcode, Option<u32>, &[u32]); 2] = [
        (value(1), Opcode::Integer, None, &[1, 0]),
        (value(2), Opcode::PropGet, Some(9), &[2, 0, 7]),
    ];
    assert_eq!(values, expected);
}

#[test]
fn views_decode_terminators() {
    let body = build_guarded_body();
    let terminators = collect_from_blocks(&body, |view| {
        let terminator = view.terminator();
        (
            terminator.kind,
            terminator.position,
            terminator.fields.to_vec(),
        )
    });
    let expected = [
        (TerminatorKind::Jump, None, Vec::new()),
        (TerminatorKind::Jump, Some(9), Vec::new()),
        (TerminatorKind::Branch, Some(9), vec![2]),
        (TerminatorKind::Return, None, vec![3]),
        (TerminatorKind::Return, None, vec![ABSENT_WORD]),
        (TerminatorKind::Throw, None, vec![4]),
    ];
    assert_eq!(terminators, expected);
}

#[test]
fn views_decode_targets() {
    let body = build_guarded_body();
    let target_counts = collect_from_blocks(&body, |view| view.terminator().target_count());
    assert_eq!(target_counts, [1, 1, 2, 0, 0, 0]);
    let targets = body.blocks().flat_map(|view| view.terminator().targets());
    let targets: Vec<Target> = targets.map(describe_target).collect();
    let expected: [Target; 4] = [
        (block(1), Vec::new(), Vec::new()),
        (block(2), Vec::new(), Vec::new()),
        (block(3), Vec::new(), vec![0]),
        (block(4), Vec::new(), Vec::new()),
    ];
    assert_eq!(targets, expected);
}

fn error_after_blocks() -> Result<(), StreamError> {
    Err(StreamError {
        kind: InternalErrorKind::ListOutOfBounds,
        block: None,
        value: None,
    })
}

#[test]
fn stream_disagrees_with_counts() {
    let body = build_guarded_body();
    let (block_count, value_count) = (body.block_count, body.value_count);

    let mut with_trailing_word = body.clone();
    with_trailing_word.code.push(0);
    assert_eq!(with_trailing_word.check_stream(), error_after_blocks());

    for value_count in [value_count - 1, value_count + 1] {
        let mut changed = body.clone();
        changed.value_count = value_count;
        assert_eq!(changed.check_stream(), error_after_blocks());
    }

    let mut without_last_block = body.clone();
    without_last_block.block_count = block_count - 1;
    assert_eq!(without_last_block.check_stream(), error_after_blocks());

    let mut with_missing_block = body;
    with_missing_block.block_count = block_count + 1;
    let in_missing_block = StreamError {
        kind: InternalErrorKind::ListOutOfBounds,
        block: Some(BlockId::from_word(block_count)),
        value: None,
    };
    assert_eq!(with_missing_block.check_stream(), Err(in_missing_block));

    let values_without_blocks = Body {
        value_count: 1,
        ..Body::default()
    };
    assert_eq!(values_without_blocks.check_stream(), error_after_blocks());
}

fn declare_every_part(offset: usize) -> DeclaredType {
    let site = Some(TypeSiteId::new(70 + offset));
    let mapped = Mapped::checked(TypeId::new(60 + offset));
    DeclaredType::new(mapped, site, PositionFlags::IS_INT32_PROMISE)
}

fn build_body_with_references(offset: usize) -> Body {
    let string = |index: usize| StringId::new(index + offset);
    let ty = |index: usize| TypeId::new(index + offset);
    let function_id = |index: usize| FunctionId::new(index + offset);
    let module = |index: usize| ModuleId::new(index + offset);
    let template_strings = [
        TemplateString {
            cooked: Some(string(22)),
            raw: string(23),
        },
        TemplateString {
            cooked: None,
            raw: string(24),
        },
    ];
    let function = build_function(&[ty(5)], |builder| {
        let operand = builder.parameter(0);
        builder.prop_get(operand, PropertyKeyId::new(20 + offset), true, true);
        builder.new_object(
            LayoutId::new(30 + offset),
            &[0, 1],
            None,
            &[operand, operand],
        );
        builder.new_closure(function_id(40), &[operand]);
        builder.call_direct(function_id(41), &[operand]);
        builder.import_module(module(50), module(51));
        builder.convert(operand, declare_every_part(offset), IllTypedCause::None);
        let from_compiler = DeclaredType::from_compiler(ty(63));
        builder.convert(operand, from_compiler, IllTypedCause::None);
        builder.check(operand, ty(64), None);
        builder.builtin(BuiltinId::GlobalThis);
        builder.get_module_variable(VariableId::new(80 + offset));
        builder.direct_eval(EvalScopeId::new(82 + offset), operand, operand, None, &[]);
        builder.data(DataId::new(83 + offset));
        let expected_result = ExpectedResultId::new(84 + offset);
        let (name, expected_result) = (Some(string(21)), Some(expected_result));
        builder.call(operand, None, &[], None, name, expected_result, true, true);
        builder.new_template_object(&template_strings);
        builder.throw_module_failure(ModuleFailureId::new(81 + offset), false);
        let next = builder.create_block(None);
        builder.switch_string(operand, &[string(25)], &[Edge::to(next)], Edge::to(next));
        builder.seal(next);
        builder.switch_to(next);
        builder.return_value(None);
    });
    function.body
}

fn expected_references(offset: usize) -> Vec<Reference> {
    let string = |index: usize| Reference::String(StringId::new(index + offset));
    let ty = |index: usize| Reference::Type(TypeId::new(index + offset));
    vec![
        ty(5),
        Reference::PropertyKey(PropertyKeyId::new(20 + offset)),
        Reference::Layout(LayoutId::new(30 + offset)),
        Reference::Function(FunctionId::new(40 + offset), FunctionReferenceKind::Closure),
        Reference::Function(FunctionId::new(41 + offset), FunctionReferenceKind::Call),
        Reference::Module(ModuleId::new(50 + offset), ModuleReferenceKind::Target),
        Reference::Module(ModuleId::new(51 + offset), ModuleReferenceKind::Referrer),
        ty(60),
        Reference::TypeSite(TypeSiteId::new(70 + offset)),
        ty(63),
        ty(64),
        Reference::Builtin(BuiltinId::GlobalThis),
        Reference::Variable(VariableId::new(80 + offset)),
        Reference::EvalScope(EvalScopeId::new(82 + offset)),
        Reference::Data(DataId::new(83 + offset)),
        string(21),
        Reference::ExpectedResult(ExpectedResultId::new(84 + offset)),
        string(22),
        string(23),
        string(24),
        Reference::ModuleFailure(ModuleFailureId::new(81 + offset)),
        string(25),
    ]
}

fn collect_references(body: &Body) -> Vec<Reference> {
    let mut references = Vec::new();
    body.for_each_reference(&mut |reference| references.push(reference));
    references
}

#[test]
fn references_follow_stream_order() {
    let body = build_body_with_references(0);
    assert_eq!(collect_references(&body), expected_references(0));
}

#[test]
fn absent_optionals_are_no_references() {
    let function = build_function(&[], |builder| {
        let operand = builder.undefined();
        builder.to_object(operand, None);
        builder.new_runtime_error(RuntimeErrorKind::ConstantAssignment, None);
        emit_call(builder, operand);
        let next = builder.create_block(None);
        builder.add_parameter(next, None);
        builder.jump(Edge::with_arguments(next, &[operand]));
        builder.seal(next);
        builder.switch_to(next);
        builder.return_value(None);
    });
    assert!(collect_references(&function.body).is_empty());
}

#[test]
fn remap_changes_exactly_reference_words() {
    let mut body = build_body_with_references(0);
    let storage = IdMapStorage::new(REMAPPED_ID_COUNT, |_| REMAP_OFFSET);
    body.remap_ids(&storage.as_id_map());
    assert_eq!(body, build_body_with_references(REMAP_OFFSET));
    assert_eq!(collect_references(&body), expected_references(REMAP_OFFSET));
}

#[test]
fn remap_of_body_without_references_changes_nothing() {
    let function = build_function(&[], |builder| {
        let left = builder.integer(REMAP_OFFSET as i64);
        let right = builder.builtin(BuiltinId::GlobalThis);
        let sum = builder.add(left, right);
        builder.return_value(Some(sum));
    });
    let mut body = function.body.clone();
    body.remap_ids(&IdMapStorage::new(0, |_| REMAP_OFFSET).as_id_map());
    assert_eq!(body, function.body);
}
