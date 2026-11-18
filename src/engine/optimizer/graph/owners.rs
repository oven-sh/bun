//! Memory that belongs to a cell without being a part of it.

use bun_engine_codegen::ir::{Binary, Heap, Op, Unary, Value as Ssa};
use bun_engine_vm::SpeculatedType;
use smallvec::SmallVec;

use super::{Gives, Graph, Kind, heaps};

pub(crate) struct Owned {
    /// What has been found in the owner.
    pub(crate) pointer: Ssa,
    pub(crate) owner: Ssa,
    pub(crate) may_be_freed: bool,
}

impl Graph {
    pub(crate) fn what_is_at(&self, address: Ssa) -> Option<Owned> {
        const MOST_TERMS: usize = 32;
        let mut terms: SmallVec<[Ssa; 8]> = smallvec::smallvec![address];
        for position in 0..MOST_TERMS {
            let pointer = self.root(*terms.get(position)?);
            let (owner, heap) = match *self.function.op(pointer) {
                Op::Binary(Binary::Add, both) => {
                    terms.extend(both);
                    continue;
                }
                Op::Load {
                    address, access, ..
                } => (address, access.heap()),
                _ => match self.kind(pointer) {
                    Some(Kind::MakeRoom | Kind::GrowSlots | Kind::SearchForStore) => {
                        (self.operand(pointer, 0), heaps::STORAGE)
                    }
                    _ => continue,
                },
            };
            if [heaps::STORAGE, heaps::VIEW_VECTOR].contains(&heap) {
                return Some(Owned {
                    pointer,
                    owner,
                    may_be_freed: heap == heaps::VIEW_VECTOR,
                });
            }
        }
        None
    }

    /// Whether what is at the address can be loaded only below a check, though nothing ties it to one. The code of a
    /// function says which registers have scopes.
    pub(crate) fn is_loose(&self, address: Ssa, heap: Heap) -> bool {
        let function = &self.function;
        let is_at_hand = match (function.op(address), self.kind(address)) {
            (_, Some(kind)) => matches!(kind.gives(), Gives::Value(_)),
            (Op::Param(_), _) => function.block_of(address) == function.entries()[0].block,
            (Op::Load { access, .. }, _) => heaps::holds_values(function, access.heap()),
            _ => false,
        };
        is_at_hand
            && !SpeculatedType::CELL.contains(self.inherent_type(address))
            && !function.may_alias(heap, heaps::SCOPE_SLOTS)
            && heap != heaps::OTHER_FIELDS
    }

    /// What is known of memory is filed under this. The length stays with the object when the storage is replaced.
    pub(crate) fn holder(&self, address: Ssa, heap: Heap) -> Ssa {
        if heap == heaps::PUBLIC_LENGTH {
            self.object_at(address)
        } else {
            self.root(address)
        }
    }

    /// Where in the coroutine of the frame the value has been restored from, and still is.
    pub(crate) fn where_saved(&self, value: Ssa) -> Option<(Ssa, i32)> {
        match *self.function.op(value) {
            Op::Load {
                address,
                offset,
                access,
                ..
            } if access.heap() == heaps::SAVED_REGISTERS => Some((self.root(address), offset)),
            _ => None,
        }
    }

    pub(crate) fn is_saved_in(&self, value: Ssa, coroutine: Ssa, offset: i32) -> bool {
        self.where_saved(value) == Some((self.root(coroutine), offset))
    }

    /// The object that has the address in its cell or in its storage.
    pub(crate) fn object_at(&self, address: Ssa) -> Ssa {
        let storage = self.what_is_at(address).filter(|it| !it.may_be_freed);
        let mut object = self.root(storage.map_or(address, |it| it.owner));
        while let Op::Binary(Binary::Add, [first, second]) = *self.function.op(object) {
            let is_offset = matches!(
                self.function.op(first),
                Op::Binary(Binary::Shl | Binary::Mul, _) | Op::Unary(Unary::Widen(_), _)
            );
            object = self.root(if is_offset { second } else { first });
        }
        object
    }
}
