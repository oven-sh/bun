use super::{lower_runtime_module, terminator_operands};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{BlockRole, ErrorKind, TerminatorKind};
use crate::ir::{Opcode, TypeTable, ValueId};

#[test]
fn type_test_intrinsic_passes_local_on_both_edges() {
    let module = lower_runtime_module(
        "export function probe(x: any) { if ($isObject(x)) return x; return x; }",
    );
    let probe = module.function("probe");
    let test = probe.only(Opcode::TypeTest);
    assert_eq!(test.operands(), [probe.parameter(0)], "{probe}");
    assert_eq!(test.types(), [TypeTable::OBJECT], "{probe}");
    assert_eq!(probe.count(Opcode::ToBoolean), 0, "{probe}");

    let branch = probe.block(test.block).terminator();
    for target in branch.targets() {
        assert_eq!(target.proofs, [0], "{probe}");
        assert_eq!(target.arguments().len(), 0, "{probe}");
    }
    let targets = probe.branch_targets(test);
    let mut edge_results = targets.map(|target| {
        assert_eq!(target.parameter_count(), 1, "{probe}");
        target.first_parameter
    });
    edge_results.sort_unstable();

    let returns = probe.terminators(TerminatorKind::Return);
    let returned = returns
        .iter()
        .flat_map(|(_, returned)| terminator_operands(*returned));
    let mut returned: Vec<ValueId> = returned.map(|value| probe.skip_requests(value)).collect();
    returned.sort_unstable();
    assert_eq!(returned, edge_results, "{probe}");
}

#[test]
fn other_intrinsic_call_is_tested_for_truthiness() {
    let module = lower_runtime_module(
        "export function probe(x: any) { if ($isConstructor(x)) return 1; return 2; }",
    );
    let probe = module.function("probe");
    let tested = probe.only(Opcode::ToBoolean).operands()[0];
    let tested = probe.definition(probe.skip_requests(tested));
    assert_eq!(tested.value.opcode, Opcode::IsConstructor, "{probe}");
    assert_eq!(probe.count(Opcode::TypeTest), 0, "{probe}");
}

#[test]
fn throw_with_constant_message() {
    let module = lower_runtime_module(
        "export function probeType() { $throwTypeError(\"m\"); }
export function probeRange() { $throwRangeError(\"m\"); }
",
    );
    let kinds = [
        ("probeType", ErrorKind::TypeError),
        ("probeRange", ErrorKind::RangeError),
    ];
    for (name, kind) in kinds {
        let probe = module.function(name);
        let thrown = probe.only(Opcode::ThrowNewError);
        let expected = [kind.to_wire(), probe.string("m").to_word()];
        assert_eq!(thrown.value.fields, expected, "{probe}");
        let end = probe.block(thrown.block).terminator();
        assert_eq!(end.kind, TerminatorKind::Unreachable, "{probe}");
        assert_eq!(probe.count(Opcode::Construct), 0, "{probe}");
        let returns = probe.terminators(TerminatorKind::Return);
        assert!(returns.is_empty(), "{probe}");
    }
}

#[test]
fn throw_with_computed_message() {
    let module =
        lower_runtime_module("export function probe(x: any) { $throwTypeError(\"a\" + x); }");
    let probe = module.function("probe");
    let constructor = probe.only_builtin(BuiltinId::TypeError);
    let error = probe.only(Opcode::Construct);
    assert_eq!(error.operands().len(), 2, "{probe}");
    assert_eq!(error.operands()[0], constructor.id(), "{probe}");
    let (_, thrown) = probe.only_terminator(TerminatorKind::Throw);
    assert_eq!(terminator_operands(thrown), [error.id()], "{probe}");
    assert_eq!(probe.count(Opcode::ThrowNewError), 0, "{probe}");
}

#[test]
fn if_abrupt_close_iterator() {
    let module = lower_runtime_module(
        "export function probe(iterator: any, f: any) {
  $ifAbruptCloseIterator(iterator, f());
  return 1;
}
",
    );
    let probe = module.function("probe");
    let guarded = probe.call_of(probe.parameter(1));
    let cleanup = probe.block(guarded.block).handler();
    let cleanup = cleanup.expect("the second argument is evaluated under a handler");
    let cleanup = probe.block(cleanup.block);
    assert_eq!(cleanup.role, BlockRole::CleanupHandler, "{probe}");
    let exception = cleanup
        .values()
        .next()
        .expect("the handler takes the exception");
    assert_eq!(exception.opcode, Opcode::CatchException, "{probe}");

    let method = probe.only(Opcode::PropGet);
    assert_eq!(method.operands(), [probe.parameter(0)], "{probe}");
    assert_eq!(method.keys(), [probe.text_key("return")], "{probe}");
    let ignored = probe.block(method.block).handler();
    let ignored = ignored.expect("what closing the iterator throws is caught");
    let ignored = probe.block(ignored.block);
    assert_eq!(ignored.role, BlockRole::CatchHandler, "{probe}");
    let close = probe.call_of(probe.value_unless_nullish(method.id()));
    assert_eq!(close.operands()[1..], [probe.parameter(0)], "{probe}");

    let (_, rethrown) = probe.only_terminator(TerminatorKind::Rethrow);
    assert_eq!(terminator_operands(rethrown), [exception.id], "{probe}");
    let (after, _) = probe.only_terminator(TerminatorKind::Return);
    assert!(after.handler().is_none(), "{probe}");
}
