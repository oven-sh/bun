use crate::ir::generated::{Primitives, TypeFlags};

impl Primitives {
    pub const BOOLEAN: Primitives = Primitives(Primitives::FALSE.0 | Primitives::TRUE.0);
    pub const NULLISH: Primitives = Primitives(Primitives::UNDEFINED.0 | Primitives::NULL.0);
    pub const OBSERVABLE: Primitives = Primitives(Primitives::ALL.0 & !Primitives::ABSENT.0);
}

impl TypeFlags {
    pub const ANY_OBJECT_OR_FUNCTION: TypeFlags =
        TypeFlags(TypeFlags::ANY_OBJECT.0 | TypeFlags::ANY_FUNCTION.0);
}
