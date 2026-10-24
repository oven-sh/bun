use super::super::*;

macro_rules! check_wire_words {
    ($type:ident) => {
        for word in 0..$type::COUNT {
            assert_eq!($type::from_wire(word).map($type::to_wire), Some(word));
        }
        assert_eq!($type::from_wire($type::COUNT), None);
        assert_eq!($type::from_wire(u32::MAX), None);
    };
}

#[test]
fn wire_words_round_trip() {
    check_wire_words!(BuiltinId);
    check_wire_words!(BuiltinClass);
    check_wire_words!(RuntimeModule);
    check_wire_words!(CheckedJSType);
    check_wire_words!(LinkTimeConstant);
    check_wire_words!(BuiltinName);
}

#[test]
fn global_this_is_zero() {
    assert_eq!(BuiltinId::GlobalThis.to_wire(), 0);
    assert_eq!(BuiltinId::GlobalThis.index(), 0);
    assert_eq!(BuiltinId::default(), BuiltinId::GlobalThis);
}

#[test]
fn tokens_round_trip() {
    for id in BuiltinId::ALL {
        assert_eq!(BuiltinId::from_name(id.name()), Some(id));
    }
    for class in BuiltinClass::ALL {
        assert_eq!(BuiltinClass::from_name(class.name()), Some(class));
    }
    for module in RuntimeModule::ALL {
        assert_eq!(RuntimeModule::from_name(module.name()), Some(module));
    }
}

#[test]
fn tokens_spell_paths() {
    assert_eq!(BuiltinId::ArrayPrototypePush.name(), "ArrayPrototypePush");
    let found = BuiltinId::from_name("MathFloor");
    assert_eq!(found, Some(BuiltinId::MathFloor));
    assert_eq!(BuiltinClass::Map.name(), "Map");
    assert_eq!(RuntimeModule::NodeFs.name(), "NodeFs");
}

#[test]
fn unknown_tokens_are_rejected() {
    assert_eq!(BuiltinId::from_name("NoSuchBuiltin"), None);
    assert_eq!(BuiltinId::from_name(""), None);
    assert_eq!(BuiltinId::from_name("Array.prototype.push"), None);
    assert_eq!(BuiltinClass::from_name("NoSuchBuiltin"), None);
    assert_eq!(BuiltinClass::from_name(""), None);
    assert_eq!(RuntimeModule::from_name("NoSuchBuiltin"), None);
    assert_eq!(RuntimeModule::from_name("node:fs"), None);
}

#[test]
fn registry_id_conversions() {
    for word in 0..=RuntimeModule::COUNT {
        let module = RuntimeModule::from_registry_id(word);
        assert_eq!(module, RuntimeModule::from_wire(word));
        assert!(module.is_none_or(|module| module.registry_id() == word));
    }
}

#[test]
fn runtime_functions_round_trip() {
    let functions = runtime_functions();
    assert!(functions.is_sorted_by(|left, right| left.function < right.function));
    for data in functions {
        let word = data.function.to_wire();
        assert_eq!(RuntimeFunction::from_wire(word), Some(data.function));
        let found = runtime_function(data.function).unwrap();
        assert_eq!(
            (found.file, found.export_name),
            (data.file, data.export_name)
        );
    }
    let last = functions.last().unwrap().function;
    assert_eq!(last.to_wire() + 1, RuntimeFunction::COUNT);
}

#[test]
fn runtime_function_ids_have_gaps() {
    assert_eq!(RuntimeFunction::from_wire(0xffff), None);
    assert_eq!(RuntimeFunction::from_wire(RuntimeFunction::COUNT), None);
    assert_eq!(RuntimeFunction::from_wire(u32::MAX), None);
    assert!(runtime_function(RuntimeFunction(0xffff)).is_none());
}

#[test]
fn runtime_function_ids_follow_roles() {
    for data in runtime_functions() {
        let word = data.function.to_wire();
        let is_in_range = match data.role {
            RuntimeFunctionRole::EngineBuiltin => word < 0x10000,
            RuntimeFunctionRole::HostBuiltin => (0x10000..0x20000).contains(&word),
            RuntimeFunctionRole::CompilerFunction | RuntimeFunctionRole::Model => word >= 0x20000,
        };
        assert!(is_in_range, "{}.{}", data.file, data.export_name);
    }
}
