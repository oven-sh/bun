use bun_sema::bind::{PrivateMembers, PrivateNameId};
use bun_sema::hir::{Flags, MemberId};

use super::{PrivateBinding, PrivateHolder, PrivateTarget, StoredValue, Written};
use crate::lower::{FileLowering, class, layouts};

impl PrivateBinding {
    pub(in crate::lower) fn target(self) -> PrivateTarget {
        match self.members {
            PrivateMembers::Field(member) => PrivateTarget::Field(StoredValue {
                class: self.class,
                member,
                holder: self.presence,
                written: Written::Nowhere,
            }),
            PrivateMembers::AutoAccessor(member) => PrivateTarget::AutoAccessor(member),
            PrivateMembers::Method(member) => PrivateTarget::Method(member),
            PrivateMembers::Accessor { getter, setter } => {
                PrivateTarget::Accessor { getter, setter }
            }
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn resolve_private_name(&mut self, name: PrivateNameId) -> PrivateBinding {
        let declared = *self.bound.private_name(name);
        let transform = self.class_plan(declared.class).transform;
        let is_decorated = class::is_decorated_private_name(self.hir, transform, &declared);
        let presence = if declared.is_static {
            PrivateHolder::ClassObject
        } else {
            let layout = self.own_class_layout(declared.class);
            let own = layouts::own_fields(self, layout);
            let field = match declared.members {
                PrivateMembers::Field(_) => {
                    own.find(layouts::private_key(self, layout, declared.name))
                }
                // Its lowering defines the name with the value.
                PrivateMembers::AutoAccessor(_) if is_decorated => {
                    own.find(layouts::private_key(self, layout, declared.name))
                }
                // A getter and a setter: on the object before its first field.
                PrivateMembers::AutoAccessor(_)
                | PrivateMembers::Method(_)
                | PrivateMembers::Accessor { .. } => own.brand(),
            };
            let field = field.expect("the layout lists the private state of its class");
            PrivateHolder::Instance { layout, field }
        };
        PrivateBinding {
            class: declared.class,
            members: declared.members,
            presence,
            is_decorated,
        }
    }

    pub(in crate::lower) fn resolve_accessor_storage(&mut self, member: MemberId) -> StoredValue {
        let class = self.bound.member_class(member);
        let class = class.expect("an accessor field is a member of a class");
        let holder = if self.hir[member].flags.contains(Flags::STATIC) {
            PrivateHolder::ClassObject
        } else {
            let layout = self.own_class_layout(class);
            let field = layouts::own_fields(self, layout).find_accessor_storage(member);
            let field = field.expect("the layout lists the private state of its class");
            PrivateHolder::Instance { layout, field }
        };
        StoredValue {
            class,
            member,
            holder,
            written: Written::Nowhere,
        }
    }
}
