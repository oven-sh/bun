use super::{ShapeKind, TypeShape};
use crate::check::aot::answers::GaveUp;
use crate::check::aot::queries::Queries;
use crate::types::TypeId;
use crate::util::FxHashSet;
use smallvec::SmallVec;

#[derive(Copy, Clone)]
enum BooleanMembers {
    Absent,
    Literal { value: bool, index: usize },
    Both,
}

struct FlattenedUnion {
    members: SmallVec<[TypeId; 8]>,
    seen: FxHashSet<TypeId>,
    booleans: BooleanMembers,
}

impl FlattenedUnion {
    fn new() -> FlattenedUnion {
        FlattenedUnion {
            members: SmallVec::new(),
            seen: FxHashSet::default(),
            booleans: BooleanMembers::Absent,
        }
    }

    fn add_boolean_literal(&mut self, member: TypeId, value: bool) {
        match self.booleans {
            BooleanMembers::Absent => {
                let index = self.members.len();
                self.booleans = BooleanMembers::Literal { value, index };
                self.members.push(member);
            }
            BooleanMembers::Literal {
                value: first,
                index,
            } => {
                if first != value {
                    self.members[index] = TypeId::BOOLEAN;
                    self.booleans = BooleanMembers::Both;
                }
            }
            BooleanMembers::Both => {}
        }
    }

    fn add_boolean(&mut self) {
        match self.booleans {
            BooleanMembers::Absent => self.members.push(TypeId::BOOLEAN),
            BooleanMembers::Literal { index, .. } => self.members[index] = TypeId::BOOLEAN,
            BooleanMembers::Both => {}
        }
        self.booleans = BooleanMembers::Both;
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn shape_of_union(&mut self, members: &[TypeId]) -> Result<TypeShape<'c>, GaveUp> {
        let mut flattened = FlattenedUnion::new();
        for &member in members {
            self.add_union_member(&mut flattened, member)?;
        }
        match flattened.members[..] {
            [] => Ok(TypeShape::undeclared(ShapeKind::Never)),
            [TypeId::BOOLEAN] => Ok(TypeShape::undeclared(ShapeKind::Boolean)),
            [only] => self.type_shape(only),
            _ => Ok(TypeShape::undeclared(ShapeKind::Union(
                self.list(&flattened.members),
            ))),
        }
    }

    fn add_union_member(
        &mut self,
        flattened: &mut FlattenedUnion,
        member: TypeId,
    ) -> Result<(), GaveUp> {
        let member = member.plain();
        if !flattened.seen.insert(member) {
            return Ok(());
        }
        match self.type_shape(member)?.kind {
            ShapeKind::Never => {}
            ShapeKind::Union(nested) => {
                for &inner in nested {
                    self.add_union_member(flattened, inner)?;
                }
            }
            ShapeKind::BooleanLiteral(value) => flattened.add_boolean_literal(member, value),
            ShapeKind::Boolean => flattened.add_boolean(),
            _ => flattened.members.push(member),
        }
        Ok(())
    }
}
