use super::table::{self, BuiltinId};

pub fn returns_first_argument(builtin: BuiltinId) -> bool {
    matches!(
        table::canonical_id(builtin),
        BuiltinId::ObjectAssign
            | BuiltinId::ObjectDefineProperties
            | BuiltinId::ObjectDefineProperty
            | BuiltinId::ObjectFreeze
            | BuiltinId::ObjectPreventExtensions
            | BuiltinId::ObjectSeal
            | BuiltinId::ObjectSetPrototypeOf
    )
}
