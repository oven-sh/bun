use bun_sema::bind::{PrivateMembers, PrivateNameId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, Flags, MemberId};

use super::{AccessorStorage, PrivateBinding, PrivateHolder};
use crate::ir::LayoutId;
use crate::lower::{FileLowering, class, layouts};

fn get_class_layout(file: &mut FileLowering<'_, '_, '_, '_>, class: ClassId) -> LayoutId {
    let reference = ClassRef {
        file: file.file,
        class,
    };
    layouts::class_layout(file, reference)
}

pub(in crate::lower) fn resolve_private_name(
    file: &mut FileLowering<'_, '_, '_, '_>,
    name: PrivateNameId,
) -> PrivateBinding {
    let declared = *file.bound.private_name(name);
    let transform = class::class_plan(file, declared.class).transform;
    let is_decorated = class::is_decorated_private_name(file.hir, transform, &declared);
    let holder = if declared.is_static {
        PrivateHolder::ClassObject
    } else {
        let layout = get_class_layout(file, declared.class);
        let own = layouts::own_fields(file, layout);
        let field = match declared.members {
            PrivateMembers::Field(_) | PrivateMembers::AutoAccessor(_) => {
                own.find(layouts::private_key(file, layout, declared.name))
            }
            PrivateMembers::Method(_) | PrivateMembers::Accessor { .. } => own.brand(),
        };
        let field = field.expect("the layout lists the private state of its class");
        PrivateHolder::Instance { layout, field }
    };
    PrivateBinding {
        class: declared.class,
        members: declared.members,
        holder,
        is_decorated,
    }
}

pub(in crate::lower) fn resolve_accessor_storage(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member: MemberId,
) -> AccessorStorage {
    let class = file.bound.member_class(member);
    let class = class.expect("an accessor field is a member of a class");
    let holder = if file.hir[member].flags.contains(Flags::STATIC) {
        PrivateHolder::ClassObject
    } else {
        let layout = get_class_layout(file, class);
        let field = layouts::own_fields(file, layout).find_accessor_storage(member);
        let field = field.expect("the layout lists the private state of its class");
        PrivateHolder::Instance { layout, field }
    };
    AccessorStorage {
        class,
        member,
        holder,
    }
}
