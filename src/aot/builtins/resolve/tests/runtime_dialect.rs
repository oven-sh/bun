use super::*;
use crate::builtins::table::{
    BuiltinKind, Conversion, ErrorKind, IntrinsicPosition, RuntimeFunction,
};
use crate::ir::{Opcode, WellKnownSymbol};
use bstr::BStr;
use bun_core::strings;

case_tests! {
    operation: RUNTIME, "$toLength(x);", |case| {
        let found = case.intrinsic("$toLength");
        assert!(matches!(found, Some(Intrinsic::Operation(Opcode::ToLength))), "{found:?}");
    };
    type_test: RUNTIME, "$isObject(x); $isCallable(x);", |case| {
        let is_object = case.intrinsic("$isObject");
        assert!(matches!(is_object, Some(Intrinsic::IsObject)), "{is_object:?}");
        let is_callable = case.intrinsic("$isCallable");
        assert!(matches!(is_callable, Some(Intrinsic::IsCallable)), "{is_callable:?}");
    };
    position_selects_entry: RUNTIME, "$isArray(x); const a = $isArray;", |case| {
        let call = case.intrinsic_at("$isArray", 0);
        assert!(matches!(call, Some(Intrinsic::Builtin(BuiltinId::ArrayIsArray))), "{call:?}");
        let value = case.intrinsic_at("$isArray", 1);
        let is_constant_of_realm = matches!(value, Some(Intrinsic::Builtin(BuiltinId::LinkTimeConstantIsArray)));
        assert!(is_constant_of_realm, "{value:?}");
    };
    construct_global: RUNTIME, "new $Promise(g);", |case| {
        let found = case.intrinsic("$Promise");
        assert!(matches!(found, Some(Intrinsic::Builtin(BuiltinId::Promise))), "{found:?}");
        assert!(case.mentions(BuiltinId::Promise));
    };
    erased_call: RUNTIME, "$debug(\"x\");", |case| {
        let found = case.intrinsic("$debug");
        assert!(matches!(found, Some(Intrinsic::Erased)), "{found:?}");
    };
    conversion_and_throw: RUNTIME, "$toNumber(x); $throwTypeError(\"m\");", |case| {
        let conversion = case.intrinsic("$toNumber");
        let is_to_number = matches!(conversion, Some(Intrinsic::Conversion(Conversion::ToNumber)));
        assert!(is_to_number, "{conversion:?}");
        let throw = case.intrinsic("$throwTypeError");
        assert!(matches!(throw, Some(Intrinsic::Throw(ErrorKind::TypeError))), "{throw:?}");
    };
    replaced_global_changes_nothing: RUNTIME, "$throwTypeError(\"m\");", |case| {
        assert!(!case.mentions(BuiltinId::TypeError));
        assert!(case.resolved.mentioned().is_empty());
    };
    program_dialect_has_no_intrinsics: PROGRAM, "$isObject(x); f.$call(t); x.$$iterator;", |case| {
        assert_unresolved(case, "$isObject");
        assert_unresolved(case, "f.$call");
        assert_unresolved(case, "x.$$iterator");
    };
    bound_name_is_not_intrinsic: RUNTIME, "function f($isObject) { $isObject(x); }", |case|
        assert_unresolved(case, "$isObject");
    unknown_name_is_not_intrinsic: RUNTIME, "$notAnIntrinsic;", |case|
        assert_unresolved(case, "$notAnIntrinsic");
    other_position_is_not_intrinsic: RUNTIME, "const a = $isObject;", |case|
        assert_unresolved(case, "$isObject");
    native_call_callee_has_no_answer: RUNTIME, "const a = $cpp;", |case|
        assert_unresolved(case, "$cpp");
}

#[test]
fn member_intrinsics() {
    with_case(RUNTIME, "f.$call(t, 1);", |case| {
        let found = case.intrinsic("f.$call");
        let is_call = matches!(
            found,
            Some(Intrinsic::Call {
                is_never_inlined: false
            })
        );
        assert!(is_call, "{found:?}");
    });
    with_case(RUNTIME, "o.$then;", |case| {
        let found = case.intrinsic("o.$then");
        assert!(matches!(found, Some(Intrinsic::PrivateName)), "{found:?}");
    });
    with_case(RUNTIME, "Math.$call;", |case| {
        let found = case.intrinsic("Math.$call");
        assert!(matches!(found, Some(Intrinsic::Call { .. })), "{found:?}");
    });
}

#[test]
fn symbol_key_member() {
    with_case(RUNTIME, "x.$$iterator;", |case| {
        let found = case.intrinsic("x.$$iterator");
        let is_iterator = matches!(found, Some(Intrinsic::SymbolKey(WellKnownSymbol::Iterator)));
        assert!(is_iterator, "{found:?}");
    });
    with_case(RUNTIME, "x.$iterator; x.iterator;", |case| {
        assert_unresolved(case, "x.$iterator");
        assert_unresolved(case, "x.iterator");
    });
}

#[test]
fn originals_are_locked() {
    with_case(RUNTIME, "new $Promise(g); $Promise.resolve;", |case| {
        for original in case.exprs("$Promise") {
            let found = case.resolved.builtin_of_expression(original);
            assert_eq!(found, Some(BuiltinId::Promise));
        }
        assert_builtin(case, "$Promise.resolve", BuiltinId::PromiseResolve);
        let location = table::entry(BuiltinId::PromiseResolve).mutability;
        assert_eq!(location, Mutability::AlwaysLocked);
        assert_mutability(case, "$Promise.resolve", location);
    });
    with_case(PROGRAM, "Promise.resolve;", |case| {
        assert_mutability(case, "Promise.resolve", Mutability::ConstantUnlessWritten);
    });
}

#[test]
fn prefixed_global() {
    with_case(RUNTIME, "Array;", |case| {
        let found = case.intrinsic("Array");
        assert!(
            matches!(found, Some(Intrinsic::Builtin(BuiltinId::Array))),
            "{found:?}"
        );
        assert!(case.mentions(BuiltinId::Array));
    });
    with_case(PROGRAM, "Array;", |case| {
        assert_builtin(case, "Array", BuiltinId::Array);
        assert!(case.intrinsic("Array").is_none());
    });
    with_case(RUNTIME, "Math;", |case| {
        assert_builtin(case, "Math", BuiltinId::Math)
    });
}

struct NativeBinding {
    id: BuiltinId,
    callee: BuiltinName,
    file: &'static [u8],
    symbol: &'static [u8],
}

fn find_native_binding(id: BuiltinId) -> Option<NativeBinding> {
    let entry = table::entry(id);
    if entry.holder.is_some() {
        return None;
    }
    let (_, kind_and_key) = strings::split_once_char(table::text_of_name(entry.name), b':')?;
    let (_, key) = strings::split_once_char(kind_and_key, b':')?;
    let (file, symbol) = strings::split_once_char(key, b':')?;
    let (file_name, symbol_name) = (table::find_name(file)?, table::find_name(symbol)?);
    let callee = table::intrinsic_names().find(|&name| {
        let Some(Intrinsic::NativeCall(kind)) = table::intrinsic_of(name, IntrinsicPosition::Call)
        else {
            return false;
        };
        let found = table::native_binding(kind, file_name, symbol_name);
        matches!(found, Some(Intrinsic::NativeBinding(binding)) if binding == id)
    })?;
    Some(NativeBinding {
        id,
        callee,
        file,
        symbol,
    })
}

#[test]
fn native_binding() {
    let mut ids = BuiltinId::ALL.into_iter();
    let id = ids
        .find(|&id| table::entry(id).kind == BuiltinKind::NativeBinding)
        .unwrap();
    let binding = find_native_binding(id).unwrap();
    let callee = format!("${}", BStr::new(table::text_of_name(binding.callee)));
    let (file, symbol) = (BStr::new(binding.file), BStr::new(binding.symbol));
    let call = format!("{callee}(\"{file}\", \"{symbol}\")");
    with_case(RUNTIME, &format!("{call};"), |case| {
        assert_unresolved(case, &callee);
        let found = case.intrinsic(&call);
        let is_binding = matches!(found, Some(Intrinsic::NativeBinding(id)) if id == binding.id);
        assert!(is_binding, "{found:?}");
        assert!(case.mentions(binding.id));
    });
    with_case(PROGRAM, &format!("{call};"), |case| {
        assert_unresolved(case, &call);
        assert!(!case.mentions(binding.id));
    });
}

fn find_linked_function() -> Option<(BuiltinName, RuntimeFunction)> {
    table::intrinsic_names().find_map(|name| {
        match table::intrinsic_of(name, IntrinsicPosition::Call) {
            Some(Intrinsic::LinkedFunction(function)) => Some((name, function)),
            Some(_) | None => None,
        }
    })
}

#[test]
fn linked_function_is_called() {
    let (name, function) = find_linked_function().unwrap();
    let source = format!("${}(x);", BStr::new(table::text_of_name(name)));
    with_case(RUNTIME, &source, |case| {
        assert!(
            case.resolved
                .called_functions()
                .any(|called| called == function)
        );
        assert!(case.resolved.mentioned().is_empty());
    });
    with_case(PROGRAM, &source, |case| {
        assert_eq!(case.resolved.called_functions().count(), 0);
    });
}
