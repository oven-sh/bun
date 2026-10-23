use super::super::*;
use super::{all_ids, name};
use crate::ir::WellKnownSymbol;
use bun_core::strings;

const POSITIONS: [IntrinsicPosition; 3] = [
    IntrinsicPosition::Call,
    IntrinsicPosition::Value,
    IntrinsicPosition::Member,
];

fn native_call_kinds() -> impl Iterator<Item = NativeCallKind> {
    intrinsic_names().filter_map(|name| match intrinsic_of(name, IntrinsicPosition::Call) {
        Some(Intrinsic::NativeCall(kind)) => Some(kind),
        Some(_) | None => None,
    })
}

fn split_binding_text(text: &str) -> Option<(BuiltinName, BuiltinName)> {
    let (_, kind_and_key) = strings::split_once_char(text.as_bytes(), b':')?;
    let (_, key) = strings::split_once_char(kind_and_key, b':')?;
    let (file, symbol) = strings::split_once_char(key, b':')?;
    Some((find_name(file)?, find_name(symbol)?))
}

// Native code makes these from host functions of its own and hands them to the library, so no text names them.
const HANDED_OVER_BY_NATIVE_CODE: [BuiltinId; 9] = [
    BuiltinId::NativeNewCppFunctionBunProcessCppJsFunctionDrainMicrotaskQueue,
    BuiltinId::NativeNewCppFunctionBunProcessCppJsFunction_emitWarning,
    BuiltinId::NativeNewCppFunctionBunProcessCppJsFunction_throwValue,
    BuiltinId::NativeNewCppFunctionBunProcessCppProcess_functionEmitHelper,
    BuiltinId::NativeNewCppFunctionBunProcessCppProcess_functionWriteWarning,
    BuiltinId::NativeNewCppFunctionErrorCodeCppNodeError_proto_toString,
    BuiltinId::NativeNewCppFunctionJSDirectStreamControllerCppJsWebStreamsHandler_onDirectEndOfTickFlush,
    BuiltinId::NativeNewCppFunctionJSEventListenerCppJsFunctionEmitUncaughtException,
    BuiltinId::NativeNewCppFunctionNodeModuleModuleCppJsFunctionSetCJSWrapperItem,
];

fn is_named_by_text(id: &BuiltinId) -> bool {
    entry(*id).kind == BuiltinKind::NativeBinding && !HANDED_OVER_BY_NATIVE_CODE.contains(id)
}

fn is_binding_of(found: Option<Intrinsic>, id: BuiltinId) -> bool {
    matches!(found, Some(Intrinsic::NativeBinding(binding)) if binding == id)
}

#[test]
fn intrinsic_names_ascend() {
    let names: Vec<BuiltinName> = intrinsic_names().collect();
    assert!(!names.is_empty());
    assert!(names.is_sorted_by(|left, right| left < right));
    for name in names {
        assert!(name.0 < BuiltinName::COUNT);
        assert!(!is_symbol_name(name), "{name:?}");
        let mut positions = POSITIONS.into_iter();
        assert!(positions.any(|position| intrinsic_of(name, position).is_some()));
    }
}

#[test]
fn other_names_have_no_intrinsic() {
    let listed: Vec<BuiltinName> = intrinsic_names().collect();
    let push = name("push");
    assert!(listed.binary_search(&push).is_err());
    for position in POSITIONS {
        assert!(intrinsic_of(push, position).is_none());
    }
}

#[test]
fn position_is_part_of_key() {
    let is_object = name("isObject");
    assert!(matches!(
        intrinsic_of(is_object, IntrinsicPosition::Call),
        Some(Intrinsic::IsObject)
    ));
    assert!(intrinsic_of(is_object, IntrinsicPosition::Value).is_none());
    assert!(intrinsic_of(is_object, IntrinsicPosition::Member).is_none());
}

#[test]
fn prepended_callees_are_table_names() {
    for name in intrinsic_names() {
        for position in POSITIONS {
            if let Some(Intrinsic::PrependArgument { callee, .. }) = intrinsic_of(name, position) {
                assert!(callee.0 < BuiltinName::COUNT, "{name:?}");
            }
        }
    }
}

#[test]
fn native_calls_have_call_position() {
    for name in intrinsic_names() {
        for position in [IntrinsicPosition::Value, IntrinsicPosition::Member] {
            let found = intrinsic_of(name, position);
            assert!(!matches!(found, Some(Intrinsic::NativeCall(_))), "{name:?}");
        }
    }
    let mut kinds: Vec<NativeCallKind> = native_call_kinds().collect();
    kinds.sort_unstable();
    let expected = [
        NativeCallKind::Cpp,
        NativeCallKind::Rust,
        NativeCallKind::NewCppFunction,
        NativeCallKind::NewRustFunction,
        NativeCallKind::Bindgen,
    ];
    assert_eq!(kinds, expected);
}

#[test]
fn symbol_keys_have_member_position_and_no_other_meaning() {
    let iterator = intrinsic_of(name("iterator"), IntrinsicPosition::Member);
    assert!(matches!(
        iterator,
        Some(Intrinsic::SymbolKey(WellKnownSymbol::Iterator))
    ));
    for name in intrinsic_names() {
        for position in [IntrinsicPosition::Call, IntrinsicPosition::Value] {
            let found = intrinsic_of(name, position);
            assert!(!matches!(found, Some(Intrinsic::SymbolKey(_))), "{name:?}");
        }
        if let Some(Intrinsic::SymbolKey(symbol)) = intrinsic_of(name, IntrinsicPosition::Member) {
            assert_eq!(text_of_name(name), text_of_name(name_of_symbol(symbol)));
        }
    }
}

#[test]
fn linked_functions_are_in_table() {
    for name in intrinsic_names() {
        for position in POSITIONS {
            if let Some(Intrinsic::LinkedFunction(function)) = intrinsic_of(name, position) {
                assert!(runtime_function(function).is_some(), "{name:?}");
            }
        }
    }
}

#[test]
fn resolves_prefixed_globals_by_name() {
    assert!(matches!(
        prefixed_global(name("Array")),
        Some(Intrinsic::Builtin(BuiltinId::Array))
    ));
    assert!(matches!(
        prefixed_global(name("Promise")),
        Some(Intrinsic::Builtin(BuiltinId::Promise))
    ));
    assert!(prefixed_global(name("isObject")).is_none());
    assert!(prefixed_global(name("Math")).is_none());
}

#[test]
fn resolves_native_bindings_by_whole_key() {
    let mut binding_count = 0;
    for id in all_ids().filter(is_named_by_text) {
        let Some((file, symbol)) = split_binding_text(&text_of(id)) else {
            panic!("{} is not native:<kind>:<file>:<symbol>", text_of(id));
        };
        let found = native_call_kinds().map(|kind| native_binding(kind, file, symbol));
        let matching_count = found.filter(|&found| is_binding_of(found, id)).count();
        assert_eq!(matching_count, 1, "{}", text_of(id));
        binding_count += 1;
    }
    assert!(binding_count > 0);
}

#[test]
fn no_key_finds_what_native_code_hands_over() {
    for id in HANDED_OVER_BY_NATIVE_CODE {
        assert_eq!(
            entry(id).kind,
            BuiltinKind::NativeBinding,
            "{}",
            text_of(id)
        );
        let Some((file, symbol)) = split_binding_text(&text_of(id)) else {
            continue;
        };
        let mut found = native_call_kinds().map(|kind| native_binding(kind, file, symbol));
        assert!(
            !found.any(|found| is_binding_of(found, id)),
            "{}",
            text_of(id)
        );
    }
}

#[test]
fn partial_native_binding_key_finds_nothing() {
    let id = all_ids().find(is_named_by_text).unwrap();
    let (file, symbol) = split_binding_text(&text_of(id)).unwrap();
    for kind in native_call_kinds() {
        assert!(native_binding(kind, file, file).is_none());
        assert!(native_binding(kind, symbol, file).is_none());
    }
}

#[test]
fn native_bindings_are_hidden_roots() {
    for id in all_ids().filter(|&id| entry(id).kind == BuiltinKind::NativeBinding) {
        assert_eq!(entry(id).holder, None, "{}", text_of(id));
        assert!(members(id).is_empty(), "{}", text_of(id));
    }
}
