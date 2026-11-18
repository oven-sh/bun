//! What an instruction does besides producing its value.

use super::entities::{Heap, Value};
use super::function::Function;
use super::op::{Access, AccessFlags, Op, Unary};

/// Two heaps may share memory if their ranges overlap.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct HeapRange {
    pub start: u32,
    pub end: u32,
}

impl HeapRange {
    pub const EMPTY: Self = Self { start: 0, end: 0 };
    pub const ALL: Self = Self {
        start: 0,
        end: u32::MAX,
    };

    #[inline]
    pub fn is_empty(self) -> bool {
        self.start >= self.end
    }

    #[inline]
    pub fn overlaps(self, other: Self) -> bool {
        self.start.max(other.start) < self.end.min(other.end)
    }

    /// The least range that covers both.
    #[inline]
    pub fn hull(self, other: Self) -> Self {
        if self.is_empty() {
            other
        } else if other.is_empty() {
            self
        } else {
            Self {
                start: self.start.min(other.start),
                end: self.end.max(other.end),
            }
        }
    }
}

impl Heap {
    pub const EVERYTHING: Self = Self(0);
    pub const NOTHING: Self = Self(1);

    /// For a client that adds its first heaps in a fixed order.
    pub const fn at(index: u32) -> Self {
        Self(index)
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct EffectFlags: u8 {
        /// Control may leave the function here, to code that can read all memory.
        const EXITS = 1 << 0;
        /// Valid only under the branches and checks that precede it.
        const CONTROL_DEPENDENT = 1 << 1;
        const FENCE = 1 << 2;
        const ENDS_BLOCK = 1 << 3;
        const READS_VARIABLE = 1 << 4;
        const WRITES_VARIABLE = 1 << 5;
        /// Stays even if nothing else says so.
        const KEPT = 1 << 6;
        /// Gives another value than an instruction that looks the same.
        const DISTINCT = 1 << 7;
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Effects {
    pub reads: Heap,
    pub writes: Heap,
    pub flags: EffectFlags,
}

impl Effects {
    pub const NONE: Self = Self::with_flags(EffectFlags::empty());
    /// Of a call that may do anything.
    pub const CALL: Self = Self {
        reads: Heap::EVERYTHING,
        writes: Heap::EVERYTHING,
        flags: EffectFlags::EXITS
            .union(EffectFlags::CONTROL_DEPENDENT)
            .union(EffectFlags::FENCE),
    };

    #[inline]
    pub const fn with_flags(flags: EffectFlags) -> Self {
        Self {
            reads: Heap::NOTHING,
            writes: Heap::NOTHING,
            flags,
        }
    }

    #[inline]
    pub fn has(self, flags: EffectFlags) -> bool {
        self.flags.intersects(flags)
    }

    #[inline]
    pub fn writes_memory(self) -> bool {
        self.writes != Heap::NOTHING
    }

    /// Cannot be removed when its value is not used.
    #[inline]
    pub fn must_execute(self) -> bool {
        const KEEPING: EffectFlags = EffectFlags::EXITS
            .union(EffectFlags::FENCE)
            .union(EffectFlags::ENDS_BLOCK)
            .union(EffectFlags::WRITES_VARIABLE)
            .union(EffectFlags::KEPT);
        self.writes_memory() || self.has(KEEPING)
    }

    /// Changes nothing, gives the same again, and goes on with the next instruction unless it leaves the function.
    #[inline]
    pub fn at_most_exits(self) -> bool {
        const HARMLESS: EffectFlags = EffectFlags::EXITS.union(EffectFlags::CONTROL_DEPENDENT);
        !self.writes_memory() && HARMLESS.contains(self.flags)
    }

    fn of_access(access: Access, reads: bool, writes: bool) -> Self {
        let heap_if = |wanted: bool| if wanted { access.heap() } else { Heap::NOTHING };
        let mut effects = Self {
            reads: heap_if(reads),
            writes: heap_if(writes),
            flags: EffectFlags::CONTROL_DEPENDENT,
        };
        if access.flags().is_empty() {
            return effects;
        }
        if access.has(AccessFlags::IMMUTABLE) {
            effects.reads = Heap::NOTHING;
        }
        if access.has(AccessFlags::ALWAYS_READABLE) {
            effects.flags = EffectFlags::empty();
        }
        if access.has(AccessFlags::TRAPS) {
            effects.flags |= EffectFlags::EXITS;
        }
        if access.has(AccessFlags::ATOMIC) {
            effects = Self {
                reads: Heap::EVERYTHING,
                writes: Heap::EVERYTHING,
                flags: effects.flags | EffectFlags::FENCE,
            };
        }
        effects
    }
}

impl Function {
    #[inline]
    pub fn effects(&self, value: Value) -> Effects {
        match *self.op(value) {
            Op::Binary(op, _) if op.is_partial() && self.type_of(value).is_int() => {
                Effects::with_flags(EffectFlags::CONTROL_DEPENDENT)
            }
            Op::Unary(Unary::FitsIn(_), _) => Effects::with_flags(EffectFlags::CONTROL_DEPENDENT),
            Op::Load { access, .. } | Op::LoadLane { access, .. } => {
                Effects::of_access(access, true, false)
            }
            Op::Store { access, .. } | Op::StoreLane { access, .. } => {
                Effects::of_access(access, false, true)
            }
            Op::AtomicUpdate { access, .. } | Op::AtomicCompareExchange { access, .. } => {
                Effects::of_access(access, true, true)
            }
            Op::Fence { reads, writes } => Effects {
                reads,
                writes,
                flags: EffectFlags::FENCE,
            },
            Op::Check(..) | Op::Checked(..) => Effects::with_flags(EffectFlags::EXITS),
            Op::Patchpoint(patchpoint) => self.patchpoint(patchpoint).effects,
            Op::Node { kind, .. } | Op::WideNode { kind, .. } => self.node_info(kind).effects,
            Op::GetVariable(_) => Effects::with_flags(EffectFlags::READS_VARIABLE),
            Op::SetVariable(..) => Effects::with_flags(EffectFlags::WRITES_VARIABLE),
            Op::Jump | Op::Branch(_) | Op::Switch(..) | Op::JumpTable(..) | Op::Unreachable => {
                Effects::with_flags(EffectFlags::ENDS_BLOCK)
            }
            Op::Return(_) => Effects::with_flags(EffectFlags::ENDS_BLOCK | EffectFlags::EXITS),
            _ => Effects::NONE,
        }
    }

    #[inline]
    pub fn may_alias(&self, a: Heap, b: Heap) -> bool {
        self.heap_range(a).overlaps(self.heap_range(b))
    }

    /// Whether the order of two instructions matters, apart from one using the value of the other.
    pub fn interfere(&self, a: Effects, b: Effects) -> bool {
        self.constrains(a, b) || self.constrains(b, a)
    }

    fn constrains(&self, a: Effects, b: Effects) -> bool {
        const LEAVES: EffectFlags = EffectFlags::EXITS.union(EffectFlags::ENDS_BLOCK);
        const VARIABLES: EffectFlags =
            EffectFlags::READS_VARIABLE.union(EffectFlags::WRITES_VARIABLE);
        a.has(LEAVES) && (b.has(EffectFlags::CONTROL_DEPENDENT) || b.must_execute())
            || a.has(EffectFlags::WRITES_VARIABLE) && b.has(VARIABLES)
            || a.has(EffectFlags::FENCE) && b.has(EffectFlags::FENCE)
            || self.may_alias(a.writes, b.writes)
            || self.may_alias(a.writes, b.reads)
    }
}
