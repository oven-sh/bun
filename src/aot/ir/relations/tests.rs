use crate::builtins::id::BuiltinId;
use crate::ir::builder::{BuilderScratch, Edge, FunctionBuilder};
use crate::ir::generated::{
    ECMAMode, FunctionFlags, FunctionRelations, IteratorKind, IteratorResumeResult,
    RelationSubjectKind, ResumeMode, ValueFate,
};
use crate::ir::ids::{DataId, FunctionId, Id, LayoutId, PropertyKeyId, ValueId, VariableId};
use crate::ir::testing::{build_function, function_with_parameters};
use crate::ir::types::TypeTable;

const ANYTHING: crate::ir::ids::TypeId = TypeTable::ANYTHING;

fn key(index: usize) -> PropertyKeyId {
    PropertyKeyId::new(index)
}

fn number(word: u32) -> String {
    match word {
        u32::MAX => "?".to_owned(),
        word => word.to_string(),
    }
}

fn describe(relations: &FunctionRelations) -> Vec<String> {
    let mut lines = Vec::new();
    for subject in &relations.subjects {
        let mut line = format!("{:?} {}", subject.kind, number(subject.index));
        if subject.kind == RelationSubjectKind::ReadFrom {
            line += &format!(" of {}", subject.source);
        }
        if let Some(key) = subject.key {
            line += &format!(" key {}", key.index());
        }
        for (bit, flag) in ValueFate::NAMES.iter().enumerate() {
            if subject.fate.0 & 1 << bit != 0 {
                line += &format!(" {flag}");
            }
        }
        if subject.results != 0 {
            line += &format!(" results {}", subject.results);
        }
        lines.push(line);
    }
    for store in &relations.stores {
        let mut line = format!("{} into {}", number(store.source), store.target);
        if let Some(key) = store.key {
            line += &format!(" key {}", key.index());
        }
        if let Some(operand) = store.creation_operand {
            line += &format!(" made {operand}");
        }
        if store.is_on_every_path {
            line += " always";
        }
        if store.is_before_target_leaves {
            line += " first";
        }
        lines.push(line);
    }
    for handed in &relations.handed {
        lines.push(format!(
            "{} to {} as {}",
            number(handed.source),
            handed.call,
            handed.argument
        ));
    }
    for operand in &relations.operands {
        lines.push(format!(
            "{} in {} at {}",
            number(operand.source),
            operand.user,
            operand.position
        ));
    }
    lines.push(format!("listed {}", relations.results_fully_listed));
    lines
}

fn relate(parameter_count: usize, fill: impl FnOnce(&mut FunctionBuilder)) -> Vec<String> {
    describe(&build_function(&vec![ANYTHING; parameter_count], fill).relations)
}

fn call(builder: &mut FunctionBuilder, callee: ValueId, arguments: &[ValueId]) -> ValueId {
    builder.call(callee, None, arguments, None, None, None, false, false)
}

#[test]
fn parameter_that_is_returned() {
    let lines = relate(2, |builder| {
        let parameter = builder.parameter(1);
        builder.return_value(Some(parameter));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0",
            "Parameter 1 IsReturned results 1",
            "listed 1"
        ]
    );
}

#[test]
fn return_without_value_lists_undefined() {
    let lines = relate(0, |builder| builder.return_value(None));
    assert_eq!(lines, ["Constant ? IsReturned results 1", "listed 1"]);
}

#[test]
fn member_of_parameter_is_read_and_returned() {
    let lines = relate(1, |builder| {
        let inner = builder.prop_get(builder.parameter(0), key(3), false, false);
        let value = builder.prop_get(inner, key(4), false, false);
        builder.return_value(Some(value));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 HasMembersRead",
            "ReadFrom 1 of 0 key 3 HasMembersRead",
            "ReadFrom 2 of 1 key 4 IsReturned results 1",
            "listed 1",
        ]
    );
}

#[test]
fn path_ends_behind_four_reads() {
    let lines = relate(1, |builder| {
        let mut value = builder.parameter(0);
        for _ in 0..5 {
            value = builder.prop_get(value, key(1), false, false);
        }
        builder.return_value(Some(value));
    });
    assert_eq!(
        lines[4],
        "ReadFrom 4 of 3 key 1 HasMembersRead IsIncomplete"
    );
    assert_eq!(lines[5..], ["listed 0"]);
}

#[test]
fn parameter_is_stored_into_parameter() {
    let lines = relate(2, |builder| {
        let (object, value) = (builder.parameter(0), builder.parameter(1));
        builder.prop_set(object, key(7), ECMAMode::Strict, value, false);
        builder.return_value(None);
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 HasMembersWritten",
            "Parameter 1",
            "Constant ? IsReturned results 1",
            "1 into 0 key 7 always first",
            "listed 1",
        ]
    );
}

#[test]
fn store_behind_departure_of_target_is_not_first() {
    let lines = relate(3, |builder| {
        let (object, value, callee) = (
            builder.parameter(0),
            builder.parameter(1),
            builder.parameter(2),
        );
        call(builder, callee, &[object]);
        builder.prop_set(object, key(7), ECMAMode::Strict, value, false);
        builder.return_value(None);
    });
    assert!(
        lines.contains(&"1 into 0 key 7 always".to_owned()),
        "{lines:?}"
    );
}

#[test]
fn store_on_one_side_of_branch_is_not_on_every_path() {
    let lines = relate(3, |builder| {
        let (object, value, condition) = (
            builder.parameter(0),
            builder.parameter(1),
            builder.parameter(2),
        );
        let test = builder.to_boolean(condition);
        let (stores, leaves) = (builder.create_block(None), builder.create_block(None));
        builder.branch(test, Edge::to(stores), Edge::to(leaves));
        builder.seal(stores);
        builder.switch_to(stores);
        builder.prop_set(object, key(7), ECMAMode::Strict, value, false);
        builder.jump(Edge::to(leaves));
        builder.seal(leaves);
        builder.switch_to(leaves);
        builder.return_value(None);
    });
    assert!(
        lines.contains(&"1 into 0 key 7 first".to_owned()),
        "{lines:?}"
    );
}

#[test]
fn operands_of_call_are_handed_on() {
    let lines = relate(2, |builder| {
        let (callee, argument) = (builder.parameter(0), builder.parameter(1));
        let result = call(builder, callee, &[argument]);
        builder.return_value(Some(result));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 IsCalled",
            "Parameter 1",
            "CallResult 2 IsReturned results 1",
            "0 to 2 as 0",
            "1 to 2 as 2",
            "listed 1",
        ]
    );
}

#[test]
fn operand_that_is_no_subject_has_no_row() {
    let lines = relate(1, |builder| {
        let unknown = builder.get_module_variable(VariableId::new(0));
        let callee = builder.parameter(0);
        call(builder, callee, &[unknown]);
        builder.return_value(Some(unknown));
    });
    assert_eq!(lines, ["Parameter 0 IsCalled", "0 to 2 as 0", "listed 0"]);
}

#[test]
fn object_made_here_holds_parameter() {
    let lines = relate(1, |builder| {
        let object = builder.new_object(LayoutId::new(0), &[0], None, &[builder.parameter(0)]);
        let unknown = builder.get_module_variable(VariableId::new(0));
        builder.prop_define(object, key(2), unknown);
        let finished = builder.finish_object(object);
        builder.return_value(Some(finished));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0",
            "Allocation 1 IsReturned HasMembersWritten results 1",
            "0 into 1 made 1 always first",
            "? into 1 key 2 always first",
            "listed 1",
        ]
    );
}

#[test]
fn member_defined_on_what_is_given_is_no_plain_store() {
    let lines = relate(2, |builder| {
        let (object, value) = (builder.parameter(0), builder.parameter(1));
        builder.prop_define(object, key(7), value);
        builder.return_value(None);
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 HasMembersDeletedOrDefined",
            "Parameter 1",
            "Constant ? IsReturned results 1",
            "1 into 0 key 7 always first",
            "listed 1",
        ]
    );
}

#[test]
fn result_of_operator_lists_its_operands() {
    let lines = relate(1, |builder| {
        let one = builder.integer(1);
        let unused = builder.integer(2);
        let sum = builder.add(builder.parameter(0), one);
        builder.return_value(Some(sum));
        let _ = unused;
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 IsConvertedToPrimitive",
            "Constant 1 IsConvertedToPrimitive",
            "Computed 3 IsReturned results 1",
            "0 in 2 at 0",
            "1 in 2 at 1",
            "listed 1",
        ]
    );
}

#[test]
fn operand_of_operator_that_is_no_subject_has_no_row() {
    let lines = relate(1, |builder| {
        let unknown = builder.get_module_variable(VariableId::new(0));
        let sum = builder.add(builder.parameter(0), unknown);
        builder.return_value(Some(sum));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 IsConvertedToPrimitive",
            "Computed 2 IsReturned results 1",
            "0 in 1 at 0",
            "listed 1",
        ]
    );
}

#[test]
fn values_that_meet_keep_their_own_fates() {
    let lines = relate(3, |builder| {
        let test = builder.to_boolean(builder.parameter(2));
        let (left, right, joined) = (
            builder.create_block(None),
            builder.create_block(None),
            builder.create_block(None),
        );
        let met = builder.add_parameter(joined, None);
        builder.branch(test, Edge::to(left), Edge::to(right));
        builder.seal(left);
        builder.seal(right);
        builder.switch_to(left);
        builder.jump(Edge::with_arguments(joined, &[builder.parameter(0)]));
        builder.switch_to(right);
        builder.jump(Edge::with_arguments(joined, &[builder.parameter(1)]));
        builder.seal(joined);
        builder.switch_to(joined);
        builder.return_value(Some(met));
    });
    assert_eq!(
        lines[..2],
        [
            "Parameter 0 IsReturned results 1",
            "Parameter 1 IsReturned results 1"
        ]
    );
    assert_eq!(lines.last().unwrap(), "listed 1");
}

#[test]
fn stored_in_variable_and_thrown() {
    let lines = relate(2, |builder| {
        builder.put_module_variable(VariableId::new(0), builder.parameter(0));
        builder.throw(builder.parameter(1));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 IsStoredInVariable",
            "Parameter 1 IsThrown",
            "listed 1"
        ]
    );
}

#[test]
fn activation_of_coroutine_keeps_its_parameters() {
    let header = function_with_parameters(FunctionFlags::IS_ASYNC, &[ANYTHING]);
    let mut builder = FunctionBuilder::new(header, BuilderScratch::default());
    builder.return_value(None);
    let lines = describe(&builder.finish().0.relations);
    assert_eq!(lines[0], "Parameter 0 IsStoredInUnknownObject");
}

fn relate_reads_of_one_parameter(number_of_reads: usize) -> Vec<String> {
    relate(1, |builder| {
        let mut last = builder.parameter(0);
        for index in 0..number_of_reads {
            last = builder.prop_get(builder.parameter(0), key(index), false, false);
        }
        builder.return_value(Some(last));
    })
}

#[test]
fn larger_function_has_room_for_more() {
    let lines = relate_reads_of_one_parameter(70);
    assert_eq!(lines.len(), 72);
    assert_eq!(lines[0], "Parameter 0 HasMembersRead");
    assert_eq!(lines[71], "listed 1");
}

#[test]
fn what_does_not_fit_is_left_out_and_said() {
    let lines = relate_reads_of_one_parameter(4200);
    assert_eq!(lines.len(), 4097);
    assert_eq!(lines[0], "Parameter 0 HasMembersRead IsIncomplete");
    assert_eq!(lines[4096], "listed 0");
}

#[test]
fn write_that_keeps_no_operand_has_row() {
    let lines = relate(1, |builder| {
        let object = builder.new_object(LayoutId::new(0), &[], None, &[]);
        builder.copy_data_properties(object, builder.parameter(0), &[], &[]);
        builder.return_value(Some(object));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 HasMembersRead HasKeysEnumerated",
            "Allocation 1 IsReturned HasMembersWritten results 1",
            "ReadFrom 2 of 0 IsIncomplete",
            "? into 1 always first",
            "listed 1",
        ]
    );
}

#[test]
fn computed_key_of_read_is_its_operand() {
    let lines = relate(2, |builder| {
        let element = builder.elem_get(builder.parameter(0), builder.parameter(1));
        builder.return_value(Some(element));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 HasMembersRead",
            "Parameter 1 IsConvertedToPrimitive",
            "ReadFrom 2 of 0 IsReturned results 1",
            "1 in 2 at 1",
            "listed 1",
        ]
    );
}

#[test]
fn capture_is_handed_to_function_of_closure() {
    let lines = relate(1, |builder| {
        let closure = builder.new_closure(FunctionId::new(1), &[builder.parameter(0)]);
        builder.return_value(Some(closure));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0",
            "Allocation 1 IsReturned results 1",
            "0 to 1 as 0",
            "listed 1"
        ]
    );
}

#[test]
fn field_of_environment_is_read_and_stored_without_flags() {
    let lines = relate(2, |builder| {
        let (environment, value) = (builder.parameter(0), builder.parameter(1));
        builder.put_environment_field(environment, LayoutId::new(0), 1, value);
        let read = builder.get_environment_field(environment, LayoutId::new(0), 0);
        builder.return_value(Some(read));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0",
            "Parameter 1",
            "ReadFrom 3 of 0 IsReturned results 1",
            "1 into 0 always first",
            "listed 1",
        ]
    );
}

#[test]
fn step_of_iteration_reads_out_of_what_is_iterated() {
    let lines = relate(1, |builder| {
        let iterator =
            builder.iterator_open(builder.parameter(0), IteratorKind::Sync, None, false, false);
        let step = builder.iterator_resume(
            iterator,
            None,
            IteratorKind::Sync,
            ResumeMode::Next,
            None,
            false,
        );
        let value = builder.result_at(step, IteratorResumeResult::Value as u32);
        builder.return_value(Some(value));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 HasMembersRead IsIterated",
            "ReadFrom 2 of 0 IsReturned results 1",
            "listed 1",
        ]
    );
}

#[test]
fn whether_iteration_is_done_is_no_subject() {
    let lines = relate(1, |builder| {
        let iterator =
            builder.iterator_open(builder.parameter(0), IteratorKind::Sync, None, false, false);
        let step = builder.iterator_resume(
            iterator,
            None,
            IteratorKind::Sync,
            ResumeMode::Next,
            None,
            false,
        );
        let done = builder.result_at(step, IteratorResumeResult::Done as u32);
        builder.return_value(Some(done));
    });
    assert_eq!(lines.last().unwrap(), "listed 0");
}

#[test]
fn object_made_again_behind_store_has_not_been_through_it() {
    let lines = relate(1, |builder| {
        let first = builder.new_object(LayoutId::new(0), &[], None, &[]);
        let (turn, leave) = (builder.create_block(None), builder.create_block(None));
        let object = builder.add_parameter(turn, None);
        let result = builder.add_parameter(leave, None);
        builder.jump(Edge::with_arguments(turn, &[first]));
        builder.switch_to(turn);
        let one = builder.integer(1);
        builder.prop_set(object, key(5), ECMAMode::Strict, one, false);
        let second = builder.new_object(LayoutId::new(0), &[], None, &[]);
        let test = builder.to_boolean(builder.parameter(0));
        builder.branch(
            test,
            Edge::with_arguments(turn, &[second]),
            Edge::with_arguments(leave, &[second]),
        );
        builder.seal(turn);
        builder.seal(leave);
        builder.switch_to(leave);
        builder.return_value(Some(result));
    });
    let stores: Vec<&String> = lines
        .iter()
        .filter(|line| line.contains(" into "))
        .collect();
    assert_eq!(stores, ["3 into 1 key 5", "3 into 2 key 5"]);
}

#[test]
fn operand_that_may_also_be_no_subject_has_marker_beside_its_rows() {
    let lines = relate(2, |builder| {
        let test = builder.to_boolean(builder.parameter(1));
        let (left, right, joined) = (
            builder.create_block(None),
            builder.create_block(None),
            builder.create_block(None),
        );
        let met = builder.add_parameter(joined, None);
        builder.branch(test, Edge::to(left), Edge::to(right));
        builder.seal(left);
        builder.seal(right);
        builder.switch_to(left);
        builder.jump(Edge::with_arguments(joined, &[builder.parameter(1)]));
        builder.switch_to(right);
        let unknown = builder.get_module_variable(VariableId::new(0));
        builder.jump(Edge::with_arguments(joined, &[unknown]));
        builder.seal(joined);
        builder.switch_to(joined);
        let callee = builder.parameter(0);
        call(builder, callee, &[met]);
        builder.return_value(None);
    });
    let handed: Vec<&String> = lines.iter().filter(|line| line.contains(" to ")).collect();
    assert_eq!(handed, ["0 to 5 as 0", "1 to 5 as 2", "? to 5 as 2"]);
}

#[test]
fn what_is_read_out_of_computed_value_stands_behind_it() {
    let lines = relate(2, |builder| {
        let sum = builder.add(builder.parameter(0), builder.parameter(1));
        let length = builder.prop_get(sum, key(1), false, false);
        builder.return_value(Some(length));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 IsConvertedToPrimitive",
            "Parameter 1 IsConvertedToPrimitive",
            "Computed 2 HasMembersRead",
            "ReadFrom 3 of 2 key 1 IsReturned results 1",
            "0 in 2 at 0",
            "1 in 2 at 1",
            "listed 1",
        ]
    );
}

#[test]
fn store_that_lands_in_one_of_two_is_sure_of_neither() {
    let lines = relate(4, |builder| {
        let test = builder.to_boolean(builder.parameter(2));
        let (left, right, joined) = (
            builder.create_block(None),
            builder.create_block(None),
            builder.create_block(None),
        );
        let object = builder.add_parameter(joined, None);
        builder.branch(test, Edge::to(left), Edge::to(right));
        builder.seal(left);
        builder.seal(right);
        builder.switch_to(left);
        builder.jump(Edge::with_arguments(joined, &[builder.parameter(0)]));
        builder.switch_to(right);
        builder.jump(Edge::with_arguments(joined, &[builder.parameter(1)]));
        builder.seal(joined);
        builder.switch_to(joined);
        builder.prop_set(
            object,
            key(7),
            ECMAMode::Strict,
            builder.parameter(3),
            false,
        );
        builder.return_value(None);
    });
    let stores: Vec<&String> = lines
        .iter()
        .filter(|line| line.contains(" into "))
        .collect();
    assert_eq!(stores, ["3 into 0 key 7", "3 into 1 key 7"]);
}

#[test]
fn store_behind_allocation_in_its_block_holds_in_loop() {
    let lines = relate(1, |builder| {
        let (turn, leave) = (builder.create_block(None), builder.create_block(None));
        builder.jump(Edge::to(turn));
        builder.switch_to(turn);
        let object = builder.new_object(LayoutId::new(0), &[], None, &[]);
        builder.prop_set(
            object,
            key(5),
            ECMAMode::Strict,
            builder.parameter(0),
            false,
        );
        let test = builder.to_boolean(builder.parameter(0));
        builder.branch(test, Edge::to(turn), Edge::to(leave));
        builder.seal(turn);
        builder.seal(leave);
        builder.switch_to(leave);
        builder.return_value(Some(object));
    });
    let stores: Vec<&String> = lines
        .iter()
        .filter(|line| line.contains(" into "))
        .collect();
    assert_eq!(stores, ["0 into 1 key 5 always first"]);
}

#[test]
fn store_in_later_block_of_loop_claims_nothing() {
    let lines = relate(1, |builder| {
        let (turn, stores, leave) = (
            builder.create_block(None),
            builder.create_block(None),
            builder.create_block(None),
        );
        builder.jump(Edge::to(turn));
        builder.switch_to(turn);
        let object = builder.new_object(LayoutId::new(0), &[], None, &[]);
        builder.jump(Edge::to(stores));
        builder.seal(stores);
        builder.switch_to(stores);
        builder.prop_set(
            object,
            key(5),
            ECMAMode::Strict,
            builder.parameter(0),
            false,
        );
        let test = builder.to_boolean(builder.parameter(0));
        builder.branch(test, Edge::to(turn), Edge::to(leave));
        builder.seal(turn);
        builder.seal(leave);
        builder.switch_to(leave);
        builder.return_value(Some(object));
    });
    let stores: Vec<&String> = lines
        .iter()
        .filter(|line| line.contains(" into "))
        .collect();
    assert_eq!(stores, ["0 into 1 key 5"]);
}

#[test]
fn value_asked_about_is_handed_to_method_of_constructor() {
    let lines = relate(2, |builder| {
        let answer = builder.instance_of(builder.parameter(0), builder.parameter(1));
        builder.return_value(Some(answer));
    });
    assert_eq!(
        lines[..2],
        [
            "Parameter 0 IsHandedToUnknownCode HasMembersRead",
            "Parameter 1 HasMembersRead IsIncomplete",
        ]
    );
}

#[test]
fn contents_go_where_nobody_follows_them_out_of_operation_without_listed_result() {
    let lines = relate(1, |builder| {
        let field = builder.get_internal_field(builder.parameter(0), 0);
        builder.return_value(Some(field));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 HasMembersRead",
            "ReadFrom 1 of 0 IsIncomplete",
            "listed 0"
        ]
    );
}

#[test]
fn what_is_stored_into_built_in_object_is_kept() {
    let lines = relate(1, |builder| {
        let global = builder.builtin(BuiltinId::GlobalThis);
        builder.prop_set(
            global,
            key(1),
            ECMAMode::Sloppy,
            builder.parameter(0),
            false,
        );
        builder.return_value(None);
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 IsStoredInUnknownObject",
            "Constant ? IsReturned results 1",
            "listed 1"
        ]
    );
}

#[test]
fn what_is_stored_into_computed_object_is_kept() {
    let lines = relate(2, |builder| {
        let prototype = builder.get_class_prototype(builder.parameter(1), LayoutId::new(0));
        builder.prop_set(
            prototype,
            key(1),
            ECMAMode::Strict,
            builder.parameter(0),
            false,
        );
        builder.return_value(None);
    });
    assert_eq!(lines[0], "Parameter 0 IsStoredInUnknownObject");
}

#[test]
fn copy_is_born_with_what_original_holds() {
    let lines = relate(1, |builder| {
        let copy = builder.copy_object(builder.parameter(0), &[], &[]);
        builder.return_value(Some(copy));
    });
    assert_eq!(
        lines,
        [
            "Parameter 0 HasMembersRead HasKeysEnumerated",
            "Allocation 1 IsReturned results 1",
            "ReadFrom 1 of 0",
            "2 into 1 always first",
            "listed 1",
        ]
    );
}

#[test]
fn copy_of_what_is_no_subject_is_born_with_what_nobody_lists() {
    let lines = relate(0, |builder| {
        let unknown = builder.get_module_variable(VariableId::new(0));
        let copy = builder.copy_object(unknown, &[], &[]);
        builder.return_value(Some(copy));
    });
    assert_eq!(
        lines,
        [
            "Allocation 1 IsReturned results 1",
            "? into 0 always first",
            "listed 1"
        ]
    );
}

#[test]
fn literal_of_constants_is_born_with_what_nobody_lists() {
    let lines = relate(0, |builder| {
        let literal = builder.data(DataId::new(0));
        builder.return_value(Some(literal));
    });
    assert_eq!(
        lines,
        [
            "Allocation 0 IsReturned results 1",
            "? into 0 always first",
            "listed 1"
        ]
    );
}

#[test]
fn values_that_meet_may_be_subjects_far_apart() {
    let lines = relate(1, |builder| {
        let first = builder.new_object(LayoutId::new(0), &[], None, &[]);
        let mut last = first;
        for _ in 0..130 {
            last = builder.new_object(LayoutId::new(0), &[], None, &[]);
        }
        let test = builder.to_boolean(builder.parameter(0));
        let (left, right, joined) = (
            builder.create_block(None),
            builder.create_block(None),
            builder.create_block(None),
        );
        let met = builder.add_parameter(joined, None);
        builder.branch(test, Edge::to(left), Edge::to(right));
        builder.seal(left);
        builder.seal(right);
        builder.switch_to(left);
        builder.jump(Edge::with_arguments(joined, &[first]));
        builder.switch_to(right);
        builder.jump(Edge::with_arguments(joined, &[last]));
        builder.seal(joined);
        builder.switch_to(joined);
        builder.return_value(Some(met));
    });
    let returned: Vec<&String> = lines
        .iter()
        .filter(|line| line.contains("IsReturned"))
        .collect();
    assert_eq!(
        returned,
        [
            "Allocation 1 IsReturned results 1",
            "Allocation 131 IsReturned results 1"
        ]
    );
    assert_eq!(lines.last().unwrap(), "listed 1");
}

#[test]
fn what_comes_round_outer_loop_reaches_inner_loop() {
    let lines = relate(3, |builder| {
        let (outer, inner) = (builder.create_block(None), builder.create_block(None));
        let (after, leave) = (builder.create_block(None), builder.create_block(None));
        let carried = builder.add_parameter(outer, None);
        let turned = builder.add_parameter(inner, None);
        let result = builder.add_parameter(leave, None);
        builder.jump(Edge::with_arguments(outer, &[builder.parameter(0)]));
        builder.switch_to(outer);
        builder.jump(Edge::with_arguments(inner, &[carried]));
        builder.switch_to(inner);
        let test = builder.to_boolean(builder.parameter(2));
        builder.branch(
            test,
            Edge::with_arguments(inner, &[turned]),
            Edge::to(after),
        );
        builder.seal(inner);
        builder.seal(after);
        builder.switch_to(after);
        let test = builder.to_boolean(builder.parameter(2));
        let next = builder.parameter(1);
        builder.branch(
            test,
            Edge::with_arguments(outer, &[next]),
            Edge::with_arguments(leave, &[turned]),
        );
        builder.seal(outer);
        builder.seal(leave);
        builder.switch_to(leave);
        builder.return_value(Some(result));
    });
    assert_eq!(
        lines[..2],
        [
            "Parameter 0 IsReturned results 1",
            "Parameter 1 IsReturned results 1"
        ]
    );
    assert_eq!(lines.last().unwrap(), "listed 1");
}

#[test]
fn chain_of_operators_is_kept_with_its_end() {
    let lines = relate(1, |builder| {
        let (mut sum, mut unused) = (builder.parameter(0), builder.parameter(0));
        for _ in 0..40 {
            let one = builder.integer(1);
            sum = builder.add(sum, one);
        }
        for _ in 0..3 {
            let two = builder.integer(2);
            unused = builder.add(unused, two);
        }
        builder.return_value(Some(sum));
        let _ = unused;
    });
    let count_of = |kind: &str| lines.iter().filter(|line| line.starts_with(kind)).count();
    assert_eq!((count_of("Constant"), count_of("Computed")), (40, 40));
}

#[test]
fn departure_of_another_subject_is_none_of_target() {
    let lines = relate(4, |builder| {
        let (object, value) = (builder.parameter(0), builder.parameter(1));
        let (callee, other) = (builder.parameter(2), builder.parameter(3));
        call(builder, callee, &[other]);
        builder.prop_set(object, key(7), ECMAMode::Strict, value, false);
        call(builder, callee, &[object]);
        builder.return_value(None);
    });
    assert!(
        lines.contains(&"1 into 0 key 7 always first".to_owned()),
        "{lines:?}"
    );
}

#[test]
fn scratch_of_another_function_changes_nothing() {
    let build = |number_of_turns: usize, scratch: BuilderScratch| {
        let header = function_with_parameters(FunctionFlags::default(), &[ANYTHING, ANYTHING]);
        let mut builder = FunctionBuilder::new(header, scratch);
        let (object, callee) = (builder.parameter(0), builder.parameter(1));
        let mut last = object;
        for index in 0..number_of_turns {
            last = builder.prop_get(object, key(index), false, false);
            builder.prop_set(object, key(index), ECMAMode::Strict, last, false);
            call(&mut builder, callee, &[last]);
        }
        builder.return_value(Some(last));
        builder.finish()
    };
    for (first, second) in [(300, 3), (3, 200), (200, 60), (60, 300)] {
        let (_, scratch) = build(first, BuilderScratch::default());
        let (recycled, _) = build(second, scratch);
        let (fresh, _) = build(second, BuilderScratch::default());
        assert_eq!(recycled.relations, fresh.relations);
    }
}
