use super::answers::ObjectMemberKind;
use crate::hir::{ExprId, TypeNodeId};
use crate::program::{FileId, Sym};

mod description;
mod lanes;
mod walk;

pub use self::lanes::Lanes;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct TypeIdentity(pub [u64; 2]);

impl TypeIdentity {
    pub fn of_untyped_members<'a>(
        members: impl Iterator<Item = (&'a [u8], ObjectMemberKind)>,
    ) -> TypeIdentity {
        TypeIdentity(description::describe_untyped_members(members))
    }

    pub fn in_file(self, file: FileId) -> TypeIdentity {
        let TypeIdentity([first, second]) = self;
        let mixed = (u64::from(file.0) + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        TypeIdentity([first ^ mixed, second.wrapping_add(mixed.rotate_left(32))])
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum ObjectOrigin {
    Symbol(Sym),
    TypeLiteral { file: FileId, node: TypeNodeId },
    MappedType { file: FileId, node: TypeNodeId },
    ObjectLiteral { file: FileId, expression: ExprId },
    Computed,
}
