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
        TypeIdentity([
            first,
            ((u64::from(file.0) + 1) << 32) | (second & 0xFFFF_FFFF),
        ])
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
