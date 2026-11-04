#[cfg(test)]
mod tests;

use super::table::{self, BuiltinId};
use bun_sema::bind::StaticReferent;
use bun_sema::check::aot::{NamedValue, PrototypeOperation};

pub fn prototype_operation_of(builtin: BuiltinId) -> Option<PrototypeOperation> {
    match table::canonical_id(builtin) {
        BuiltinId::ObjectSetPrototypeOf | BuiltinId::ReflectSetPrototypeOf => {
            Some(PrototypeOperation::SetPrototype {
                object: 0,
                parent: 1,
            })
        }
        BuiltinId::ObjectCreate => Some(PrototypeOperation::CreateObject { parent: 0 }),
        BuiltinId::NodeUtilInherits => Some(PrototypeOperation::LinkClasses {
            child: 0,
            parent: 1,
        }),
        BuiltinId::PrivateGlobalsToClass => Some(PrototypeOperation::LinkClasses {
            child: 0,
            parent: 2,
        }),
        BuiltinId::ObjectAssign => Some(PrototypeOperation::CopyProperties { target: 0 }),
        BuiltinId::FunctionPrototypeCall | BuiltinId::FunctionPrototypeApply => {
            Some(PrototypeOperation::CallFunction { receiver: 0 })
        }
        _ => None,
    }
}

#[allow(clippy::needless_pass_by_value)] // taken apart
pub fn named_value_of<M>(referent: StaticReferent<BuiltinId, M>) -> Option<NamedValue> {
    match referent {
        StaticReferent::Class(class) => Some(NamedValue::Class(class)),
        StaticReferent::Function(function) => Some(NamedValue::Function(function)),
        StaticReferent::Builtin(builtin) => {
            prototype_operation_of(builtin).map(NamedValue::PrototypeOperation)
        }
        StaticReferent::Namespace(_) | StaticReferent::Unknown(_) => None,
    }
}
