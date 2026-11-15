mod legacy;
mod metadata;
mod plan;
mod standard;

use bun_sema::hir::MemberId;

use crate::ir::ValueId;

pub(in crate::lower) use self::legacy::{has_legacy_decorators, move_decorated_fields};
pub(in crate::lower) use self::plan::{InitializerLists, plan_decorations};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum DecoratedKind {
    Method,
    Getter,
    Setter,
    Accessor,
    Field,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(in crate::lower) enum DecorationGroup {
    StaticMethod,
    InstanceMethod,
    StaticField,
    InstanceField,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) struct ValueInitializers {
    pub(in crate::lower) value: u32,
    pub(in crate::lower) extra: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) struct Decoration {
    pub(in crate::lower) member: MemberId,
    pub(in crate::lower) kind: DecoratedKind,
    pub(in crate::lower) is_static: bool,
    pub(in crate::lower) is_private: bool,
    pub(in crate::lower) initializers: Option<ValueInitializers>,
}

impl Decoration {
    pub(in crate::lower) fn group(self) -> DecorationGroup {
        use DecoratedKind::{Accessor, Field, Getter, Method, Setter};
        match (self.kind, self.is_static) {
            (Method | Getter | Setter | Accessor, true) => DecorationGroup::StaticMethod,
            (Method | Getter | Setter | Accessor, false) => DecorationGroup::InstanceMethod,
            (Field, true) => DecorationGroup::StaticField,
            (Field, false) => DecorationGroup::InstanceField,
        }
    }
}

#[derive(Copy, Clone, Default, Debug)]
pub(in crate::lower) struct StandardDecorationResult {
    pub(in crate::lower) decorated_class: Option<ValueId>,
    pub(in crate::lower) class_initializers: Option<ValueId>,
}
