mod legacy;
mod metadata;
mod plan;
mod standard;

use bun_sema::hir::MemberId;

use crate::ir::ValueId;

pub(in crate::lower) use self::legacy::{
    apply_legacy_decorators, has_legacy_decorators, move_decorated_fields,
};
pub(in crate::lower) use self::plan::plan_standard_elements;
pub(in crate::lower) use self::standard::{
    emit_initializer_run, emit_standard_decorations, emit_value_initializer_run,
    get_initializer_list,
};

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
        match (self.kind, self.is_static) {
            (
                DecoratedKind::Method
                | DecoratedKind::Getter
                | DecoratedKind::Setter
                | DecoratedKind::Accessor,
                true,
            ) => DecorationGroup::StaticMethod,
            (
                DecoratedKind::Method
                | DecoratedKind::Getter
                | DecoratedKind::Setter
                | DecoratedKind::Accessor,
                false,
            ) => DecorationGroup::InstanceMethod,
            (DecoratedKind::Field, true) => DecorationGroup::StaticField,
            (DecoratedKind::Field, false) => DecorationGroup::InstanceField,
        }
    }
}

#[derive(Copy, Clone, Default, Debug)]
pub(in crate::lower) struct StandardDecorationResult {
    pub(in crate::lower) decorated_class: Option<ValueId>,
    pub(in crate::lower) class_initializers: Option<ValueId>,
}
