use bun_sema::check::aot::ShapeKind;
use smallvec::SmallVec;

use crate::builtins::type_name_of;
use crate::ir::ContentsSlot;
use crate::lower::{CheckerTypeId, FileLowering};

pub(in crate::lower) fn find_contents_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    slot: ContentsSlot,
) -> Option<CheckerTypeId> {
    let mut current = ty;
    let mut visited: SmallVec<[CheckerTypeId; 4]> = SmallVec::new();
    loop {
        current = file.queries.without_nullish(current).ok()?;
        if visited.contains(&current) {
            return None;
        }
        visited.push(current);
        let shape = file.queries.type_shape(current).ok()?;
        current = match shape.kind {
            ShapeKind::Array { element, .. } => {
                return (slot == ContentsSlot::Element).then_some(element);
            }
            ShapeKind::Builtin { class, arguments } => {
                let slots = type_name_of(class)?.type_arguments;
                let index = slots.iter().position(|&entry| entry == Some(slot))?;
                return arguments.get(index).copied();
            }
            ShapeKind::TypeVariable { constraint, .. } => constraint?,
            ShapeKind::Int32 { base } => base,
            _ => return None,
        };
    }
}
