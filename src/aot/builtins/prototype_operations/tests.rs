use super::*;
use bun_sema::bind::{NamespaceReferent, UnknownReferent};
use bun_sema::check::aot::{ClassRef, FunctionRef};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::FileId;

type Referent = StaticReferent<BuiltinId, ()>;

#[test]
fn operands_are_positions_of_arguments() {
    let set_prototype = PrototypeOperation::SetPrototype {
        object: 0,
        parent: 1,
    };
    let call_function = PrototypeOperation::CallFunction { receiver: 0 };
    let cases = [
        (BuiltinId::ObjectSetPrototypeOf, set_prototype),
        (BuiltinId::ReflectSetPrototypeOf, set_prototype),
        (
            BuiltinId::ObjectCreate,
            PrototypeOperation::CreateObject { parent: 0 },
        ),
        (
            BuiltinId::NodeUtilInherits,
            PrototypeOperation::LinkClasses {
                child: 0,
                parent: 1,
            },
        ),
        (
            BuiltinId::PrivateGlobalsToClass,
            PrototypeOperation::LinkClasses {
                child: 0,
                parent: 2,
            },
        ),
        (
            BuiltinId::ObjectAssign,
            PrototypeOperation::CopyProperties { target: 0 },
        ),
        (BuiltinId::FunctionPrototypeCall, call_function),
        (BuiltinId::FunctionPrototypeApply, call_function),
    ];
    for (builtin, operation) in cases {
        let found = prototype_operation_of(builtin);
        assert_eq!(found, Some(operation), "{builtin:?}");
    }
}

#[test]
fn other_builtins_are_no_operations() {
    let builtins = [
        BuiltinId::Object,
        BuiltinId::ObjectPrototype,
        BuiltinId::ObjectDefineProperty,
        BuiltinId::ObjectKeys,
        BuiltinId::ReflectGet,
        BuiltinId::FunctionPrototypeToString,
        BuiltinId::PrivateGlobalsInherits,
        BuiltinId::NodeUtil,
    ];
    for builtin in builtins {
        assert_eq!(prototype_operation_of(builtin), None, "{builtin:?}");
    }
}

#[test]
fn declarations_and_operations_are_named_values() {
    let class = ClassRef {
        file: FileId(1),
        class: ClassId(2),
    };
    let function = FunctionRef {
        file: FileId(3),
        function: FnId(4),
    };
    let create = PrototypeOperation::CreateObject { parent: 0 };
    let found = named_value_of(Referent::Class(class));
    assert_eq!(found, Some(NamedValue::Class(class)));
    let found = named_value_of(Referent::Function(function));
    assert_eq!(found, Some(NamedValue::Function(function)));
    let found = named_value_of(Referent::Builtin(BuiltinId::ObjectCreate));
    assert_eq!(found, Some(NamedValue::PrototypeOperation(create)));
}

#[test]
fn other_referents_are_no_named_values() {
    let referents = [
        Referent::Builtin(BuiltinId::ObjectKeys),
        Referent::Namespace(NamespaceReferent::Module(())),
        Referent::Unknown(UnknownReferent::FreeName),
    ];
    for referent in referents {
        assert_eq!(named_value_of(referent), None, "{referent:?}");
    }
}
