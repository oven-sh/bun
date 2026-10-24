use bun_core::strings::contains;

use super::{
    MODULE_IMPORTER, MODULE_PATH, Operation, Probe, find_library_path, lower_files,
    lower_runtime_module,
};
use crate::builtins::id::BuiltinId;
use crate::builtins::table;
use crate::ir::generated::{FunctionReferenceKind, TerminatorKind};
use crate::ir::{Id, Opcode, PropertyKeyId, Reference};

#[track_caller]
fn read_of<'a>(probe: Probe<'a>, key: PropertyKeyId) -> Operation<'a> {
    let mut reads = probe.all(Opcode::PropGet);
    reads.retain(|read| read.keys() == [key]);
    let [read] = reads[..] else {
        panic!("expected one read of {key}:\n{probe}");
    };
    read
}

fn is_never_inlined(call: &Operation<'_>) -> bool {
    contains(call.text().as_bytes(), b"isNeverInlined")
}

#[test]
fn callee_under_type_syntax_is_intrinsic() {
    let module = lower_runtime_module(
        "export function probe(f: any, t: any) { return (f.$call as any)(t, 1); }",
    );
    let probe = module.function("probe");
    let one = probe.only(Opcode::Integer);
    assert_eq!(one.integer(), 1, "{probe}");
    let call = probe.only(Opcode::Call);
    let expected = [probe.parameter(0), probe.parameter(1), one.id()];
    assert_eq!(call.operands(), expected, "{probe}");
    assert!(call.keys().is_empty(), "{probe}");
    assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
    assert!(!probe.has_string("$call"), "{probe}");
}

#[test]
fn only_call_no_inline_is_never_inlined() {
    let module = lower_runtime_module(
        "export function probeMarked(f: any) { return $callNoInline(f, undefined, 1); }
export function probePlain(f: any) { return [$call(f, undefined, 1), f.$call(undefined, 1)]; }
",
    );
    let marked = module.function("probeMarked");
    let call = marked.only(Opcode::Call);
    assert_eq!(call.operands().len(), 3, "{marked}");
    assert_eq!(call.operands()[0], marked.parameter(0), "{marked}");
    assert!(is_never_inlined(&call), "{marked}");

    let plain = module.function("probePlain");
    let calls = plain.all(Opcode::Call);
    assert_eq!(calls.len(), 2, "{plain}");
    for call in &calls {
        assert_eq!(call.operands()[0], plain.parameter(0), "{plain}");
        assert!(!is_never_inlined(call), "{plain}");
    }
}

#[test]
fn apply_calls_original_function() {
    let module = lower_runtime_module(
        "export function probe(f: any, t: any, a: any) { return f.$apply(t, a); }",
    );
    let probe = module.function("probe");
    let apply = probe.only_builtin(BuiltinId::FunctionPrototypeApply);
    let [f, t, a] = [0, 1, 2].map(|index| probe.parameter(index));
    let call = probe.only(Opcode::Call);
    assert_eq!(call.operands(), [apply.id(), f, t, a], "{probe}");
    assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
}

#[test]
fn builtin_function_is_called_on_holder() {
    let module =
        lower_runtime_module("export function probe(a: any, b: any) { return $min(a, b); }");
    let probe = module.function("probe");
    let holder = table::entry(BuiltinId::MathMin).holder;
    let holder = holder.expect("a member of the table has a holder");
    let [function, this] = probe.all(Opcode::Builtin)[..] else {
        panic!("expected the function and its holder:\n{probe}");
    };
    let expected = [Reference::Builtin(BuiltinId::MathMin)];
    assert_eq!(function.references(), expected, "{probe}");
    assert_eq!(this.references(), [Reference::Builtin(holder)], "{probe}");
    let [a, b] = [0, 1].map(|index| probe.parameter(index));
    let expected = [function.id(), this.id(), a, b];
    assert_eq!(probe.only(Opcode::Call).operands(), expected, "{probe}");
    assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
}

#[test]
fn builtin_is_constructed_with_one_argument() {
    let module =
        lower_runtime_module("export function probe(n: any) { return $newArrayWithSize(n); }");
    let probe = module.function("probe");
    let constructor = probe.only_builtin(BuiltinId::Array);
    let expected = [constructor.id(), probe.parameter(0)];
    let made = probe.only(Opcode::Construct);
    assert_eq!(made.operands(), expected, "{probe}");
}

#[test]
fn private_global_is_read_from_global_object() {
    let module = lower_runtime_module("export function probe() { return $createFIFO(); }");
    let probe = module.function("probe");
    let global = probe.only_builtin(BuiltinId::GlobalThis);
    let read = probe.only(Opcode::PropGet);
    assert_eq!(read.operands(), [global.id()], "{probe}");
    assert_eq!(read.keys(), [probe.private_key("createFIFO")], "{probe}");
    assert_eq!(probe.only(Opcode::Call).operands(), [read.id()], "{probe}");
}

#[test]
fn optional_private_member_tests_receiver() {
    let module = lower_runtime_module(
        "export function probeRead(o: any) { return o?.$fastPath; }
export function probeCall(o: any) { return o?.$fastPath(); }
export function probeReadInChain(o: any) { return o?.$fastPath.n; }
export function probeCallInChain(o: any) { return o?.$fastPath().n; }
",
    );
    for name in [
        "probeRead",
        "probeCall",
        "probeReadInChain",
        "probeCallInChain",
    ] {
        let probe = module.function(name);
        let branches = probe.terminators(TerminatorKind::Branch);
        assert_eq!(branches.len(), 1, "{probe}");
        let receiver = probe.value_unless_nullish(probe.parameter(0));
        let read = read_of(probe, probe.private_key("fastPath"));
        assert_eq!(read.operands(), [receiver], "{probe}");
    }
    for name in ["probeCall", "probeCallInChain"] {
        let probe = module.function(name);
        let receiver = probe.value_unless_nullish(probe.parameter(0));
        let key = probe.private_key("fastPath");
        let call = probe.only(Opcode::Call);
        let read = read_of(probe, key);
        assert_eq!(call.operands(), [read.id(), receiver], "{probe}");
        assert_eq!(call.keys(), [key], "{probe}");
    }
    let probe = module.function("probeReadInChain");
    let base = read_of(probe, probe.private_key("fastPath"));
    let read = read_of(probe, probe.text_key("n"));
    assert_eq!(read.operands(), [base.id()], "{probe}");

    let probe = module.function("probeCallInChain");
    let base = probe.only(Opcode::Call);
    let read = read_of(probe, probe.text_key("n"));
    assert_eq!(read.operands(), [base.id()], "{probe}");
}

#[test]
fn optional_function_call_has_one_branch() {
    let module = lower_runtime_module(
        "export function probeCall(f: any, t: any) { return f?.$call(t); }
export function probeApply(f: any, t: any, a: any) { return f?.$apply(t, a); }
",
    );
    let probe = module.function("probeCall");
    let branches = probe.terminators(TerminatorKind::Branch);
    assert_eq!(branches.len(), 1, "{probe}");
    let function = probe.value_unless_nullish(probe.parameter(0));
    let expected = [function, probe.parameter(1)];
    assert_eq!(probe.only(Opcode::Call).operands(), expected, "{probe}");

    let probe = module.function("probeApply");
    let branches = probe.terminators(TerminatorKind::Branch);
    assert_eq!(branches.len(), 1, "{probe}");
    let function = probe.value_unless_nullish(probe.parameter(0));
    let apply = probe.only(Opcode::Builtin);
    let expected = [apply.id(), function, probe.parameter(1), probe.parameter(2)];
    assert_eq!(probe.only(Opcode::Call).operands(), expected, "{probe}");
}

#[test]
fn spread_after_this_argument_is_list_call() {
    let module = lower_runtime_module(
        "export function probe(f: any, t: any, a: any) { return f.$call(t, ...a); }",
    );
    let probe = module.function("probe");
    let [f, t, a] = [0, 1, 2].map(|index| probe.parameter(index));
    let list = probe.only(Opcode::NewArray);
    assert!(list.operands().is_empty(), "{probe}");
    let spread = probe.only(Opcode::AppendSpread);
    assert_eq!(spread.operands(), [list.id(), a], "{probe}");
    let call = probe.only(Opcode::CallList);
    assert_eq!(call.operands(), [f, t, list.id()], "{probe}");
    assert_eq!(probe.count(Opcode::Call), 0, "{probe}");
    assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
}

#[test]
fn spread_after_prepended_argument_is_gathered() {
    let module = lower_runtime_module(
        "export function probe(...args: any[]) { return $ERR_INVALID_ARG_TYPE(...args); }",
    );
    let probe = module.function("probe");
    let function = probe.only(Opcode::PropGet);
    let key = probe.private_key("makeErrorWithCode");
    assert_eq!(function.keys(), [key], "{probe}");
    let prepended = probe.only(Opcode::Integer);
    let list = probe.only(Opcode::NewArray);
    assert_eq!(list.operands(), [prepended.id()], "{probe}");
    let spread = probe.only(Opcode::AppendSpread);
    assert_eq!(spread.operands()[0], list.id(), "{probe}");
    let gathered = probe.skip_requests(spread.operands()[1]);
    assert_eq!(gathered, probe.parameter(0), "{probe}");
    let call = probe.only(Opcode::CallList);
    assert_eq!(call.operands(), [function.id(), list.id()], "{probe}");
}

#[test]
fn prepended_argument_comes_before_written_arguments() {
    let module = lower_runtime_module(
        "export function probe(a: any, b: any, c: any) { return $ERR_INVALID_ARG_TYPE(a, b, c); }",
    );
    let probe = module.function("probe");
    let function = probe.only(Opcode::PropGet);
    let prepended = probe.only(Opcode::Integer);
    let [a, b, c] = [0, 1, 2].map(|index| probe.parameter(index));
    let expected = [function.id(), prepended.id(), a, b, c];
    assert_eq!(probe.only(Opcode::Call).operands(), expected, "{probe}");
    assert_eq!(probe.count(Opcode::NewArray), 0, "{probe}");
}

#[test]
fn native_binding_has_no_arguments() {
    let module = lower_runtime_module(
        "export function probe() { return $cpp(\"JSMIMEParams.cpp\", \"createJSMIMEBinding\"); }",
    );
    let probe = module.function("probe");
    let binding = probe.only(Opcode::NativeBinding);
    let expected = Reference::Builtin(BuiltinId::NativeCppJSMIMEParamsCppCreateJSMIMEBinding);
    assert_eq!(binding.references(), [expected], "{probe}");
    assert!(binding.operands().is_empty(), "{probe}");
    assert_eq!(probe.count(Opcode::String), 0, "{probe}");
    assert_eq!(probe.count(Opcode::Call), 0, "{probe}");
    assert!(!probe.has_string("JSMIMEParams.cpp"), "{probe}");
}

#[test]
fn erased_calls_emit_nothing() {
    let module = lower_runtime_module(
        "export function probe(table: any, key: any) {
  $assert(table[key], \"Missing \" + key);
  $debug(\"Missing \", table[key]);
  return table[key];
}
",
    );
    let probe = module.function("probe");
    assert_eq!(probe.count(Opcode::ElemGet), 1, "{probe}");
    for opcode in [Opcode::Add, Opcode::Strcat, Opcode::Call, Opcode::PropGet] {
        assert_eq!(probe.count(opcode), 0, "{probe}");
    }
    assert!(!probe.has_string("Missing "), "{probe}");
}

#[test]
fn linked_function_of_other_file_is_called_by_closure() {
    let module = lower_runtime_module(
        "export function probe(target: any, source: any) {
  return $flatIntoArray(target, source, 0, 0, 1);
}
",
    );
    let probe = module.function("probe");
    let closure = probe.only(Opcode::NewClosure);
    assert!(closure.operands().is_empty(), "{probe}");
    let [Reference::Function(function, FunctionReferenceKind::Closure)] = closure.references()[..]
    else {
        panic!("a closure names its function:\n{probe}");
    };
    let key = probe.fragment.function_keys[function.index()];
    assert_ne!(key.home_file(), probe.fragment.file, "{probe}");

    let operands = probe.only(Opcode::Call).operands();
    assert_eq!(operands.len(), 6, "{probe}");
    let expected = [closure.id(), probe.parameter(0), probe.parameter(1)];
    assert_eq!(operands[..3], expected, "{probe}");
    assert_eq!(probe.count(Opcode::CallDirect), 0, "{probe}");
    assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
}

#[test]
fn linked_function_of_same_file_is_called_directly() {
    let library_path = find_library_path("flatIntoArray");
    let files = lower_files(&[
        MODULE_IMPORTER,
        (
            MODULE_PATH,
            "export function load(a: any) { return $flatIntoArray(a); }",
        ),
        (
            library_path.as_str(),
            "$linkTimeConstant;
export function flatIntoArray(target: any) { return target; }
export function flat(a: any) { return $flatIntoArray(a); }
",
        ),
    ]);
    let probe = files.function("flat");
    let linked = files.function("flatIntoArray");
    assert_eq!(linked.fragment.file, probe.fragment.file);
    let call = probe.only(Opcode::CallDirect);
    let expected = Reference::Function(linked.id, FunctionReferenceKind::Call);
    assert_eq!(call.references(), [expected], "{probe}");
    assert_eq!(call.operands(), [probe.parameter(0)], "{probe}");
    assert_eq!(probe.count(Opcode::NewClosure), 0, "{probe}");
    assert_eq!(probe.count(Opcode::Call), 0, "{probe}");
}
