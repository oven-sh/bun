mod leaf_test;
mod tested_field;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::SymbolId;
use bun_sema::hir::{BinOp, Branches, ExprId, ExprKind, UnOp};
use smallvec::SmallVec;

use self::leaf_test::{LeafTest, TypeofName};
use self::tested_field::has_unit_type;
use super::expression::{
    AssignmentTarget, Evaluation, Tail, classify_assignment_target, is_chain_root,
    is_statically_resolved, lower_expression, lower_expression_for_effect, lower_expression_in,
    skip_type_syntax,
};
use super::{FileLowering, FunctionLowering, call, operator, scope};
use crate::ir::{BlockId, Edge, TypeId, TypeTable, ValueId};

pub(in crate::lower) use self::tested_field::{
    TestedField, find_tested_field, is_holder_unchanged, narrow_holder,
};

#[derive(Copy, Clone, Debug)]
pub(crate) struct Split {
    pub(crate) taken: BlockId,
    pub(crate) taken_value: ValueId,
    pub(crate) not_taken: BlockId,
    pub(crate) not_taken_value: ValueId,
}

#[derive(Copy, Clone)]
struct Targets {
    if_true: BlockId,
    if_false: BlockId,
}

#[derive(Copy, Clone)]
enum TestedOperand {
    Local(SymbolId),
    Field(TestedField),
}

fn order_targets(is_negated: bool, if_true: BlockId, if_false: BlockId) -> (BlockId, BlockId) {
    if is_negated {
        (if_false, if_true)
    } else {
        (if_true, if_false)
    }
}

pub(crate) fn lower_condition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    if_true: BlockId,
    if_false: BlockId,
) {
    let position = lowering.file.hir[expression].pos;
    if !lowering.enter_nesting(position) {
        lowering.jump(if_false);
        return;
    }
    lowering.set_position(position);
    if lowering
        .file
        .decisions()
        .is_truthy_without_effects(expression)
    {
        // `if (module)`: nothing is read, so that the test makes no module object.
        let value = lowering.builder.boolean(true);
        branch_on_truthiness(lowering, None, value, if_true, if_false);
    } else if is_statically_resolved(lowering.file, expression) {
        lower_truthiness(lowering, expression, if_true, if_false);
    } else {
        lower_condition_by_kind(lowering, expression, if_true, if_false);
    }
    lowering.leave_nesting();
}

pub(crate) fn split_on_type(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    tested: TypeId,
) -> Split {
    let test = lowering.builder.type_test(value, tested);
    split_on_test(lowering, test)
}

pub(crate) fn split_on_truthiness(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) -> Split {
    let test = lowering.builder.to_boolean(value);
    split_on_test(lowering, test)
}

pub(crate) fn branch_if_nullish(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    if_nullish: BlockId,
) -> ValueId {
    let split = split_on_type(lowering, value, TypeTable::NULLISH);
    jump_if_taken(lowering, split, if_nullish)
}

pub(crate) fn branch_if_undefined(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    if_undefined: BlockId,
) -> ValueId {
    let split = split_on_type(lowering, value, TypeTable::UNDEFINED);
    jump_if_taken(lowering, split, if_undefined)
}

pub(in crate::lower) fn split_expression_on_type(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    tested: Option<ExprId>,
    value: ValueId,
    tested_type: TypeId,
) -> Split {
    let subject = tested.and_then(|expression| find_subject(lowering, expression, value));
    let split = split_on_type(lowering, value, tested_type);
    rebind_on_edges(lowering, subject, split);
    split
}

pub(in crate::lower) fn split_expression_on_truthiness(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    tested: Option<ExprId>,
    value: ValueId,
) -> Split {
    let subject = tested.and_then(|expression| find_subject(lowering, expression, value));
    let split = split_on_truthiness(lowering, value);
    rebind_on_edges(lowering, subject, split);
    split
}

pub(in crate::lower) fn branch_if_expression_nullish(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    tested: ExprId,
    value: ValueId,
    if_nullish: BlockId,
) -> ValueId {
    let split = split_expression_on_type(lowering, Some(tested), value, TypeTable::NULLISH);
    jump_if_taken(lowering, split, if_nullish)
}

pub(in crate::lower) fn try_lower_test_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<ValueId> {
    match leaf_test::classify_test(lowering, expression) {
        LeafTest::Type {
            operand,
            is_typeof,
            tested,
            is_negated,
        } => {
            let value = lower_tested_operand(lowering, operand, is_typeof);
            lowering.set_position(lowering.file.hir[expression].pos);
            let test = lowering.builder.type_test(value, tested);
            Some(match is_negated {
                true => lowering.builder.logical_not(test),
                false => test,
            })
        }
        LeafTest::TypeofObject { .. } => Some(lower_condition_as_value(lowering, expression)),
        LeafTest::Truthiness | LeafTest::NumberQuestion { .. } | LeafTest::Comparison { .. } => {
            None
        }
    }
}

fn split_on_test(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, test: ValueId) -> Split {
    let taken = lowering.create_block();
    let not_taken = lowering.create_block();
    let taken_value = lowering.builder.add_edge_result(taken);
    let not_taken_value = lowering.builder.add_edge_result(not_taken);
    lowering.builder.branch(
        test,
        Edge::with_proofs(taken, &[0]),
        Edge::with_proofs(not_taken, &[0]),
    );
    lowering.builder.seal(taken);
    lowering.builder.seal(not_taken);
    Split {
        taken,
        taken_value,
        not_taken,
        not_taken_value,
    }
}

fn jump_if_taken(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    split: Split,
    on_taken: BlockId,
) -> ValueId {
    lowering.builder.switch_to(split.taken);
    lowering.jump(on_taken);
    lowering.builder.switch_to(split.not_taken);
    split.not_taken_value
}

fn finish_split(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    split: Split,
    on_taken: BlockId,
    on_not_taken: BlockId,
) {
    lowering.builder.switch_to(split.taken);
    lowering.jump(on_taken);
    lowering.builder.switch_to(split.not_taken);
    lowering.jump(on_not_taken);
}

fn tested_identifier(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Option<ExprId> {
    let inner = skip_type_syntax(file, expression);
    match file.hir[inner].kind {
        ExprKind::Ident(_) => Some(inner),
        ExprKind::Assign {
            op: None, target, ..
        } => match classify_assignment_target(file, target) {
            AssignmentTarget::Identifier { identifier, .. } => Some(identifier),
            _ => None,
        },
        ExprKind::Missing
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::TaggedTemplate(_)
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::Call(_)
        | ExprKind::New(_)
        | ExprKind::Unary { .. }
        | ExprKind::Binary { .. }
        | ExprKind::Assign { op: Some(_), .. }
        | ExprKind::Cond { .. }
        | ExprKind::Spread(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => None,
    }
}

fn find_subject(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    value: ValueId,
) -> Option<SymbolId> {
    let identifier = tested_identifier(lowering.file, expression)?;
    let symbol = scope::find_tested_local(lowering, identifier)?;
    (scope::lower_identifier(lowering, identifier) == value).then_some(symbol)
}

fn rebind_on_edges(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: Option<SymbolId>,
    split: Split,
) {
    let Some(symbol) = subject else {
        return;
    };
    lowering.builder.switch_to(split.taken);
    scope::rebind_local(lowering, symbol, split.taken_value);
    lowering.builder.switch_to(split.not_taken);
    scope::rebind_local(lowering, symbol, split.not_taken_value);
}

fn lower_condition_by_kind(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    if_true: BlockId,
    if_false: BlockId,
) {
    let hir = lowering.file.hir;
    match hir[expression].kind {
        ExprKind::Unary {
            op: UnOp::Not,
            operand,
        } => lower_condition(lowering, operand, if_false, if_true),
        ExprKind::Binary {
            op: op @ (BinOp::And | BinOp::Or),
            ..
        } => lower_logical_condition(lowering, expression, op, if_true, if_false),
        ExprKind::Binary {
            op: BinOp::Nullish,
            left,
            right,
        } => lower_nullish_condition(lowering, expression, left, right, if_true, if_false),
        ExprKind::Binary {
            op: BinOp::Comma,
            left,
            right,
        } => {
            lower_expression_for_effect(lowering, left);
            lower_condition(lowering, right, if_true, if_false);
        }
        ExprKind::Cond { .. } => {
            lower_conditional_condition(lowering, expression, if_true, if_false);
        }
        ExprKind::Satisfies { expr: operand, .. }
        | ExprKind::AsConst(operand)
        | ExprKind::NonNull(operand)
        | ExprKind::Instantiation { expr: operand, .. } => {
            lower_condition(lowering, operand, if_true, if_false);
        }
        ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_)
            if is_chain_root(lowering.file, expression) =>
        {
            lower_chain_condition(lowering, expression, if_true, if_false);
        }
        _ => lower_leaf_test(lowering, expression, if_true, if_false),
    }
}

fn lower_logical_condition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    op: BinOp,
    if_true: BlockId,
    if_false: BlockId,
) {
    let operands = collect_logical_operands(lowering.file, expression, op);
    let Some((&last, leading)) = operands.split_last() else {
        unreachable!("a logical condition has a left operand");
    };
    for &operand in leading {
        let next = lowering.create_block();
        let (on_true, on_false) = if op == BinOp::And {
            (next, if_false)
        } else {
            (if_true, next)
        };
        lower_condition(lowering, operand, on_true, on_false);
        lowering.continue_in(next);
    }
    lower_condition(lowering, last, if_true, if_false);
}

fn collect_logical_operands(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    op: BinOp,
) -> SmallVec<[ExprId; 8]> {
    let mut operands = SmallVec::new();
    let mut current = expression;
    while let ExprKind::Binary {
        op: current_op,
        left,
        right,
    } = file.hir[current].kind
    {
        if current_op != op || (current != expression && is_statically_resolved(file, current)) {
            break;
        }
        if !file.decisions().is_dead_expr(right) {
            operands.push(right);
        }
        current = left;
    }
    operands.push(current);
    operands.reverse();
    operands
}

fn lower_nullish_condition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    left: ExprId,
    right: ExprId,
    if_true: BlockId,
    if_false: BlockId,
) {
    if lowering.file.decisions().is_dead_expr(right) {
        lower_truthiness(lowering, expression, if_true, if_false);
        return;
    }
    let value = lower_expression(lowering, left);
    lowering.set_position(lowering.file.hir[expression].pos);
    let right_block = lowering.create_block();
    let present = branch_if_expression_nullish(lowering, left, value, right_block);
    branch_on_truthiness(lowering, Some(left), present, if_true, if_false);
    lowering.continue_in(right_block);
    lower_condition(lowering, right, if_true, if_false);
}

fn lower_conditional_condition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    if_true: BlockId,
    if_false: BlockId,
) {
    let (hir, decisions) = (lowering.file.hir, lowering.file.decisions());
    let mut current = expression;
    while let ExprKind::Cond { test, branches } = hir[current].kind {
        if current != expression && is_statically_resolved(lowering.file, current) {
            break;
        }
        let Branches { yes, no } = hir.branches(branches);
        if decisions.is_dead_expr(yes) {
            lower_expression_for_effect(lowering, test);
            current = no;
            continue;
        }
        if decisions.is_dead_expr(no) {
            lower_expression_for_effect(lowering, test);
            current = yes;
            break;
        }
        let yes_block = lowering.create_block();
        let no_block = lowering.create_block();
        lower_condition(lowering, test, yes_block, no_block);
        lowering.continue_in(yes_block);
        lower_condition(lowering, yes, if_true, if_false);
        lowering.continue_in(no_block);
        current = no;
    }
    lower_condition(lowering, current, if_true, if_false);
}

fn lower_chain_condition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    if_true: BlockId,
    if_false: BlockId,
) {
    let exit = lowering.create_block();
    let value = lower_expression_in(lowering, expression, Evaluation::in_chain(exit, Tail::No));
    lowering.set_position(lowering.file.hir[expression].pos);
    branch_on_truthiness(lowering, None, value, if_true, if_false);
    lowering.continue_in(exit);
    lowering.jump(if_false);
}

fn lower_truthiness(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    if_true: BlockId,
    if_false: BlockId,
) {
    let value = lower_expression(lowering, expression);
    lowering.set_position(lowering.file.hir[expression].pos);
    branch_on_truthiness(lowering, Some(expression), value, if_true, if_false);
}

fn branch_on_truthiness(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    tested: Option<ExprId>,
    value: ValueId,
    if_true: BlockId,
    if_false: BlockId,
) {
    let split = split_expression_on_truthiness(lowering, tested, value);
    finish_split(lowering, split, if_true, if_false);
}

fn lower_leaf_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    if_true: BlockId,
    if_false: BlockId,
) {
    match leaf_test::classify_test(lowering, expression) {
        LeafTest::Truthiness => lower_truthiness(lowering, expression, if_true, if_false),
        LeafTest::Type {
            operand,
            is_typeof,
            tested,
            is_negated,
        } => {
            let value = lower_tested_operand(lowering, operand, is_typeof);
            lowering.set_position(lowering.file.hir[expression].pos);
            let split = split_expression_on_type(lowering, Some(operand), value, tested);
            let (passed, failed) = order_targets(is_negated, if_true, if_false);
            finish_split(lowering, split, passed, failed);
        }
        LeafTest::TypeofObject {
            operand,
            is_negated,
        } => {
            let (passed, failed) = order_targets(is_negated, if_true, if_false);
            lower_typeof_object(lowering, expression, operand, passed, failed);
        }
        LeafTest::NumberQuestion { question, operand } => {
            let value = call::lower_operand_of_question(lowering, expression, operand);
            lowering.set_position(lowering.file.hir[expression].pos);
            let split = split_expression_on_type(lowering, Some(operand), value, TypeTable::NUMBER);
            lowering.builder.switch_to(split.not_taken);
            lowering.jump(if_false);
            lowering.builder.switch_to(split.taken);
            let number = split.taken_value;
            let answer = call::emit_number_question(lowering, expression, question, number);
            branch_on_truthiness(lowering, None, answer, if_true, if_false);
        }
        LeafTest::Comparison { op, left, right } => {
            let targets = Targets { if_true, if_false };
            lower_comparison(lowering, expression, op, left, right, targets);
        }
    }
}

fn lower_tested_operand(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operand: ExprId,
    is_typeof: bool,
) -> ValueId {
    if is_typeof {
        operator::lower_typeof_operand(lowering, operand)
    } else {
        lower_expression(lowering, operand)
    }
}

fn lower_typeof_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    operand: ExprId,
    passed: BlockId,
    failed: BlockId,
) {
    let value = operator::lower_typeof_operand(lowering, operand);
    lowering.set_position(lowering.file.hir[expression].pos);
    let first = split_expression_on_type(lowering, Some(operand), value, TypeTable::FUNCTION);
    let remaining = jump_if_taken(lowering, first, failed);
    let types = &mut lowering.file.fragment.types;
    let object_or_null = types.union(TypeTable::OBJECT, TypeTable::NULL);
    let second = split_expression_on_type(lowering, Some(operand), remaining, object_or_null);
    finish_split(lowering, second, passed, failed);
}

pub(in crate::lower) fn find_typeof_operand(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<ExprId> {
    leaf_test::find_typeof_operand(lowering, expression)
}

/// `switch (typeof operand)` over written names.
pub(in crate::lower) fn jump_by_typeof(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operand: ExprId,
    value: ValueId,
    cases: &[(Atom, BlockId)],
    otherwise: BlockId,
) {
    let find_target = |name: Atom| cases.iter().find(|case| case.0 == name).map(|case| case.1);
    let mut remaining = value;
    if let Some(on_object) = find_target(known::object) {
        let on_function = find_target(known::function).unwrap_or(otherwise);
        let split =
            split_expression_on_type(lowering, Some(operand), remaining, TypeTable::FUNCTION);
        remaining = jump_if_taken(lowering, split, on_function);
        let types = &mut lowering.file.fragment.types;
        let object_or_null = types.union(TypeTable::OBJECT, TypeTable::NULL);
        let split = split_expression_on_type(lowering, Some(operand), remaining, object_or_null);
        remaining = jump_if_taken(lowering, split, on_object);
    }
    let mut seen: SmallVec<[Atom; 8]> = SmallVec::new();
    for &(name, target) in cases {
        let Some(TypeofName::Type(tested)) = leaf_test::typeof_name(name) else {
            continue;
        };
        let is_tested_above = name == known::function && find_target(known::object).is_some();
        if is_tested_above || seen.contains(&name) {
            continue;
        }
        seen.push(name);
        let split = split_expression_on_type(lowering, Some(operand), remaining, tested);
        remaining = jump_if_taken(lowering, split, target);
    }
    lowering.jump(otherwise);
}

fn lower_comparison(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    op: BinOp,
    left: ExprId,
    right: ExprId,
    targets: Targets,
) {
    let left_value = lower_expression(lowering, left);
    let left_field = find_compared_field(lowering, op, left, right);
    let right_value = lower_expression(lowering, right);
    let left_field = left_field.filter(|&field| is_holder_unchanged(lowering, field));
    let right_field = find_compared_field(lowering, op, right, left);
    lowering.set_position(lowering.file.hir[expression].pos);
    let left_subject = find_subject(lowering, left, left_value);
    let right_subject = find_subject(lowering, right, right_value);
    let right_subject = right_subject.filter(|&symbol| Some(symbol) != left_subject);
    let subjects = [
        select_tested_operand(left_subject, left_field),
        select_tested_operand(right_subject, right_field),
    ];
    let comparison = operator::emit_comparison(lowering, op, left_value, right_value);
    let (on_taken, on_not_taken) =
        order_targets(comparison.is_negated, targets.if_true, targets.if_false);
    if let [None, None] = subjects {
        let (taken, not_taken) = (Edge::to(on_taken), Edge::to(on_not_taken));
        lowering.builder.branch(comparison.test, taken, not_taken);
        return;
    }
    let (taken, not_taken) = split_on_comparison(lowering, comparison.test, subjects);
    lowering.builder.switch_to(taken);
    lowering.jump(on_taken);
    lowering.builder.switch_to(not_taken);
    lowering.jump(on_not_taken);
}

fn find_compared_field(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    op: BinOp,
    tested: ExprId,
    other: ExprId,
) -> Option<TestedField> {
    if !matches!(op, BinOp::EqEqEq | BinOp::NotEqEq) {
        return None;
    }
    find_tested_field(lowering, tested).filter(|_| has_unit_type(lowering.file, other))
}

fn select_tested_operand(
    local: Option<SymbolId>,
    field: Option<TestedField>,
) -> Option<TestedOperand> {
    match (local, field) {
        (Some(symbol), _) => Some(TestedOperand::Local(symbol)),
        (None, Some(field)) => Some(TestedOperand::Field(field)),
        (None, None) => None,
    }
}

fn narrow_tested_operand(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operand: TestedOperand,
    narrowed: ValueId,
) {
    match operand {
        TestedOperand::Local(symbol) => scope::rebind_local(lowering, symbol, narrowed),
        TestedOperand::Field(field) => {
            narrow_holder(lowering, field, narrowed);
        }
    }
}

fn split_on_comparison(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    test: ValueId,
    subjects: [Option<TestedOperand>; 2],
) -> (BlockId, BlockId) {
    let taken = lowering.create_block();
    let not_taken = lowering.create_block();
    let mut proofs: SmallVec<[u32; 2]> = SmallVec::new();
    let mut splits: SmallVec<[(TestedOperand, Split); 2]> = SmallVec::new();
    for (operand, subject) in (0u32..).zip(subjects) {
        let Some(subject) = subject else {
            continue;
        };
        let split = Split {
            taken,
            taken_value: lowering.builder.add_edge_result(taken),
            not_taken,
            not_taken_value: lowering.builder.add_edge_result(not_taken),
        };
        proofs.push(operand);
        splits.push((subject, split));
    }
    lowering.builder.branch(
        test,
        Edge::with_proofs(taken, &proofs),
        Edge::with_proofs(not_taken, &proofs),
    );
    lowering.builder.seal(taken);
    lowering.builder.seal(not_taken);
    lowering.builder.switch_to(taken);
    for &(subject, split) in &splits {
        narrow_tested_operand(lowering, subject, split.taken_value);
    }
    let taken_end = lowering.builder.current_block();
    lowering.builder.switch_to(not_taken);
    for &(subject, split) in &splits {
        narrow_tested_operand(lowering, subject, split.not_taken_value);
    }
    let not_taken_end = lowering.builder.current_block();
    (taken_end, not_taken_end)
}

fn lower_condition_as_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let passed = lowering.create_block();
    let failed = lowering.create_block();
    let join = lowering.create_block();
    let result = lowering.builder.create_variable(None);
    lower_condition(lowering, expression, passed, failed);
    for (block, outcome) in [(passed, true), (failed, false)] {
        lowering.continue_in(block);
        let value = lowering.builder.boolean(outcome);
        lowering.builder.write_variable(result, value);
        lowering.jump(join);
    }
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}
