use super::{lower_runtime_module, terminator_operands};
use crate::builtins::id::{BuiltinId, CheckedJSType};
use crate::ir::generated::{EntryParameter, FunctionFlags, TerminatorKind};
use crate::ir::{EntryPosition, Id, Opcode, TypeId, TypeTable, ValueId};

#[test]
fn object_and_callable_tests_are_type_tests() {
    let module = lower_runtime_module(
        "export function probe(value: unknown) {
  return [$isObject(value), $isCallable(value), $isUndefinedOrNull(value)];
}
",
    );
    let probe = module.function("probe");
    let tests = probe.all(Opcode::TypeTest);
    let tested: Vec<TypeId> = tests.iter().flat_map(|test| test.types()).collect();
    let expected = [TypeTable::OBJECT, TypeTable::FUNCTION, TypeTable::NULLISH];
    assert_eq!(tested, expected, "{probe}");
    for test in &tests {
        assert_eq!(test.operands(), [probe.parameter(0)], "{probe}");
    }
    assert_eq!(probe.count(Opcode::Call), 0, "{probe}");
    assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
    let branches = probe.terminators(TerminatorKind::Branch);
    assert!(branches.is_empty(), "{probe}");
}

#[test]
fn js_type_test_names_first_and_last_type() {
    let module = lower_runtime_module("export function probe(x: any) { return $isMap(x); }");
    let probe = module.function("probe");
    let map = CheckedJSType::JSMapType.to_wire();
    let expected = [probe.parameter(0).to_word(), map, map];
    let test = probe.only(Opcode::HasJSType);
    assert_eq!(test.value.fields, expected, "{probe}");
    assert_eq!(probe.count(Opcode::Call), 0, "{probe}");
}

#[test]
fn literal_payload_is_encoded() {
    let module = lower_runtime_module(
        "export function probeNumber(o: any) { return $getInternalField(o, 1); }
export function probeConstant(o: any) { return $getProxyInternalField(o, $proxyFieldHandler); }
",
    );
    for name in ["probeNumber", "probeConstant"] {
        let probe = module.function(name);
        let read = probe.only(Opcode::GetInternalField);
        let [object] = read.operands()[..] else {
            panic!("the index is no operand:\n{probe}");
        };
        assert_eq!(probe.skip_requests(object), probe.parameter(0), "{probe}");
        assert_eq!(read.value.fields, [object.to_word(), 1], "{probe}");
        assert_eq!(probe.count(Opcode::Integer), 0, "{probe}");
        assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
    }
}

#[test]
fn result_at_reads_multi_result_operation() {
    let module = lower_runtime_module(
        "export function probe(map: any, table: any, entry: any) {
  const step = $mapNext(map, table, entry);
  return [$resultAt(step, $mapNextResultHasEntry), $resultAt(step, $mapNextResultValue)];
}
",
    );
    let probe = module.function("probe");
    let step = probe.only(Opcode::MapNext).id().to_word();
    let reads = probe.all(Opcode::ResultAt);
    let fields: Vec<&[u32]> = reads.iter().map(|read| read.value.fields).collect();
    assert_eq!(fields, [[step, 0], [step, 3]], "{probe}");
}

#[test]
fn operands_are_claimed_by_kind() {
    let module = lower_runtime_module(
        "export function probeTyped(a: any, f: any) { return $getContiguousIndex(a, f()); }
export function probeUntyped(value: any) { return $isConstructor(value); }
",
    );
    let typed = module.function("probeTyped");
    let index = typed.call_of(typed.parameter(1));
    let [array_claim, index_claim] = typed.demanded_conversions()[..] else {
        panic!("expected a claim of each operand:\n{typed}");
    };
    assert!(index.id() < array_claim.id(), "{typed}");
    assert_eq!(array_claim.operands(), [typed.parameter(0)], "{typed}");
    assert_eq!(array_claim.types(), [TypeTable::ARRAY], "{typed}");
    assert_eq!(index_claim.operands(), [index.id()], "{typed}");
    let read = typed.only(Opcode::GetContiguousIndex);
    let expected = [array_claim.id(), index_claim.id()];
    assert_eq!(read.operands(), expected, "{typed}");

    let untyped = module.function("probeUntyped");
    let test = untyped.only(Opcode::IsConstructor);
    assert_eq!(test.operands(), [untyped.parameter(0)], "{untyped}");
    assert!(untyped.demanded_conversions().is_empty(), "{untyped}");
}

#[test]
fn operation_without_result_is_undefined() {
    let module = lower_runtime_module(
        "export function probe(a: any, v: any) { return $putContiguousIndex(a, 0, v); }",
    );
    let probe = module.function("probe");
    let store = probe.only(Opcode::PutContiguousIndex);
    assert_eq!(store.operands()[2], probe.parameter(1), "{probe}");
    let (_, returned) = probe.only_terminator(TerminatorKind::Return);
    let [returned] = terminator_operands(returned)[..] else {
        panic!("the function returns a value:\n{probe}");
    };
    let returned = probe.definition(probe.skip_requests(returned));
    assert_eq!(returned.value.opcode, Opcode::Undefined, "{probe}");
}

#[test]
fn conversions() {
    let module = lower_runtime_module(
        "export function probeNumber(x: any) { return $toNumber(x); }
export function probeString(x: any) { return $toString(x); }
export function probeKey(x: any) { return $toPropertyKey(x); }
",
    );
    let conversions = [
        ("probeNumber", Opcode::ToNumber),
        ("probeString", Opcode::ToString),
        ("probeKey", Opcode::ToPropertyKey),
    ];
    for (name, opcode) in conversions {
        let probe = module.function(name);
        let converted = probe.only(opcode);
        assert_eq!(converted.operands(), [probe.parameter(0)], "{probe}");
        assert_eq!(probe.count(Opcode::Call), 0, "{probe}");
    }
}

#[test]
fn array_push_defines_element_at_length() {
    let module =
        lower_runtime_module("export function probe(a: any, v: any) { $arrayPush(a, v); }");
    let probe = module.function("probe");
    let array = probe.only_demanded_conversion();
    assert_eq!(array.operands(), [probe.parameter(0)], "{probe}");
    assert_eq!(array.types(), [TypeTable::OBJECT], "{probe}");
    let length = probe.only(Opcode::PropGet);
    assert_eq!(length.operands(), [array.id()], "{probe}");
    assert_eq!(length.keys(), [probe.text_key("length")], "{probe}");
    let expected = [array.id(), length.id(), probe.parameter(1)];
    let define = probe.only(Opcode::ElemDefine);
    assert_eq!(define.operands(), expected, "{probe}");
    assert_eq!(probe.count(Opcode::Call), 0, "{probe}");
}

#[test]
fn put_by_val_direct_defines_element() {
    let module = lower_runtime_module(
        "export function probe(o: any, k: any, v: any) { $putByValDirect(o, k, v); }",
    );
    let probe = module.function("probe");
    let object = probe.only_demanded_conversion();
    assert_eq!(object.operands(), [probe.parameter(0)], "{probe}");
    let expected = [object.id(), probe.parameter(1), probe.parameter(2)];
    let define = probe.only(Opcode::ElemDefine);
    assert_eq!(define.operands(), expected, "{probe}");
    assert_eq!(probe.count(Opcode::ElemSet), 0, "{probe}");
}

#[test]
fn argument_intrinsics_read_entry_parameters() {
    let module = lower_runtime_module(
        "export function probe(a: any) { return [$argumentCount(), $argument(0), $argument(2)]; }",
    );
    let probe = module.function("probe");
    let flags = probe.function.flags;
    assert!(flags.contains(FunctionFlags::HAS_ARGUMENT_COUNT), "{probe}");
    assert!(!flags.contains(FunctionFlags::HAS_HIDDEN_REST), "{probe}");
    assert_eq!(probe.function.parameters.len(), 3, "{probe}");
    assert_eq!(probe.function.length, 1, "{probe}");
    let count = EntryPosition::single(EntryParameter::ArgumentCount);
    let count = probe.function.entry_parameter_index(count);
    let count = ValueId::new(count.expect("the function takes the count"));
    let expected = [count, probe.parameter(0), probe.parameter(2)];
    let elements = probe.only(Opcode::NewArray).operands();
    let elements: Vec<ValueId> = elements
        .iter()
        .map(|&value| probe.skip_requests(value))
        .collect();
    assert_eq!(elements, expected, "{probe}");
    assert_eq!(probe.count(Opcode::CreateUnmappedArguments), 0, "{probe}");
}

#[test]
fn arguments_object_holds_undeclared_parameters() {
    let module =
        lower_runtime_module("export function probe(a: any) { return [arguments, $argument(1)]; }");
    let probe = module.function("probe");
    let flags = probe.function.flags;
    assert!(flags.contains(FunctionFlags::HAS_HIDDEN_REST), "{probe}");
    let arguments = probe.only(Opcode::CreateUnmappedArguments);
    let expected = [probe.parameter(0), probe.parameter(1)];
    assert_eq!(arguments.operands()[2..], expected, "{probe}");
}

#[test]
fn promise_status_is_compared_with_peeked_status() {
    let module =
        lower_runtime_module("export function probe(p: any) { return $isPromisePending(p); }");
    let probe = module.function("probe");
    let global = probe.only_builtin(BuiltinId::GlobalThis);
    let peek = probe.only(Opcode::PropGet);
    assert_eq!(peek.operands(), [global.id()], "{probe}");
    let key = probe.private_key("peekPromiseStatus");
    assert_eq!(peek.keys(), [key], "{probe}");
    let status = probe.only(Opcode::Call);
    let expected = [peek.id(), probe.parameter(0)];
    assert_eq!(status.operands(), expected, "{probe}");
    let pending = probe.only(Opcode::Integer);
    assert_eq!(pending.integer(), 0, "{probe}");
    let expected = [status.id(), pending.id()];
    assert_eq!(probe.only(Opcode::StrictEq).operands(), expected, "{probe}");
}
