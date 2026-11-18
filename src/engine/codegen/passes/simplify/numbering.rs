//! Finds the value that already computes an operation.

use core::hash::{Hash, Hasher};

use super::{Simplifier, Tables};
use crate::hash::FastHasher;
use crate::ir::{AccessFlags, Binary, Checked, Function, Heap, Load, Op, State, Type, Value};

#[derive(Clone, Copy)]
struct Entry {
    /// For a load it may be a store to the same bytes.
    value: Value,
    hash: u32,
}

const EMPTY: Entry = Entry {
    value: Value::NONE,
    hash: 0,
};

/// An open hash table. The walk never comes back to a subtree, so what is defined there can be overwritten.
#[derive(Default)]
pub(super) struct Numbering {
    entries: Vec<Entry>,
    occupied: usize,
    additions: usize,
}

/// Adds up small numbers that tell kinds of operations apart.
#[derive(Default)]
struct Kind(u64);

impl Hasher for Kind {
    #[inline(always)]
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, _: &[u8]) {
        unreachable!("kinds are made of small numbers");
    }

    #[inline(always)]
    fn write_u8(&mut self, value: u8) {
        self.write_usize(value.into());
    }

    #[inline(always)]
    fn write_usize(&mut self, value: usize) {
        self.0 = (self.0 << 7) + value as u64;
    }
}

#[inline(always)]
fn hash_pair(kind: impl Hash, ty: Type, high: u32, low: u32) -> u32 {
    const ODD: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut hasher = Kind::default();
    (ty, kind).hash(&mut hasher);
    let pair = u64::from(high) << 32 | u64::from(low);
    let mixed = pair.wrapping_add(hasher.finish().wrapping_mul(ODD));
    ((mixed ^ mixed >> 29).wrapping_mul(ODD) >> 32) as u32
}

fn hash_any(key: impl Hash, ty: Type) -> u32 {
    let mut hasher = FastHasher::default();
    (key, ty).hash(&mut hasher);
    hasher.finish() as u32
}

/// Where an entry can go.
pub(super) struct Vacancy {
    slot: usize,
    hash: u32,
    additions: usize,
}

pub(super) fn unchecked(op: Checked) -> Binary {
    match op {
        Checked::Add => Binary::Add,
        Checked::Sub => Binary::Sub,
        Checked::Mul => Binary::Mul,
    }
}

/// The value depends on the operands alone.
#[inline]
pub(super) fn is_expression(op: &Op) -> bool {
    matches!(
        op,
        Op::Unary(..)
            | Op::Binary(..)
            | Op::Compare(..)
            | Op::FloatCompare(..)
            | Op::Select(_)
            | Op::Wide(..)
            | Op::MulWide(..)
            | Op::Extract(..)
            | Op::VectorUnary(..)
            | Op::VectorBinary(..)
            | Op::VectorTernary(..)
            | Op::VectorShift(..)
            | Op::VectorReduce(..)
            | Op::Shuffle(..)
            | Op::Splat(..)
            | Op::ExtractLane { .. }
            | Op::ReplaceLane { .. }
    )
}

/// What a load that is not atomic reads, and how.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Reading {
    pub(super) kind: Load,
    pub(super) address: Value,
    pub(super) offset: i32,
    pub(super) ty: Type,
}

impl Reading {
    /// The value that a load or a store has to offer.
    #[inline]
    fn offered_by(self, function: &Function, known: Value) -> Option<Value> {
        let (kind, address, offset, value) = match *function.op(known) {
            Op::Load {
                kind,
                address,
                offset,
                ..
            } => (kind, address, offset, known),
            Op::Store {
                args: [stored, address],
                offset,
                ..
            } => (Load::Full, address, offset, stored),
            _ => return None,
        };
        let ty = function.type_of(value);
        (self
            == Self {
                kind,
                address,
                offset,
                ty,
            })
        .then_some(value)
    }
}

/// For a node or the load of a lane: the operation without what does not decide its outcome, and the heap that does.
pub(super) fn key(function: &Function, mut op: Op) -> Option<(Op, Heap)> {
    let reads = match &mut op {
        Op::LoadLane { access, .. } => core::mem::replace(access, Heap::NOTHING.into()).heap(),
        Op::Node { kind, state, .. } | Op::WideNode { kind, state, .. } => {
            let effects = function.node_info(*kind).effects;
            *state = State::NONE;
            effects.at_most_exits().then_some(effects.reads)?
        }
        _ => return None,
    };
    Some((op, reads))
}

fn has_key(function: &Function, known: Value, wanted: &Op) -> bool {
    match (key(function, *function.op(known)), *wanted) {
        (
            Some((
                Op::WideNode {
                    kind, args, data, ..
                },
                _,
            )),
            Op::WideNode {
                kind: same_kind,
                args: same_args,
                data: same_data,
                ..
            },
        ) => {
            (kind, data) == (same_kind, same_data)
                && function.values_in(args) == function.values_in(same_args)
        }
        (key, wanted) => key.is_some_and(|(key, _)| key == wanted),
    }
}

impl Numbering {
    pub(super) fn reset(&mut self, expected: usize) {
        self.entries.clear();
        self.entries
            .resize((2 * expected + 16).next_power_of_two(), EMPTY);
        (self.occupied, self.additions) = (0, 0);
    }

    /// `accept` gives the result, or whether the entry is of no more use.
    #[inline(always)]
    fn probe(
        &self,
        hash: u32,
        mut accept: impl FnMut(Value) -> Result<Value, bool>,
    ) -> Result<Value, Vacancy> {
        const PATIENCE: usize = 64;
        let mask = self.entries.len() - 1;
        let (first, mut free) = (hash as usize & mask, None);
        let additions = self.additions;
        for slot in (first..first + PATIENCE).map(|slot| slot & mask) {
            let entry = self.entries[slot];
            if entry.value.is_none() {
                let slot = free.unwrap_or(slot);
                return Err(Vacancy {
                    slot,
                    hash,
                    additions,
                });
            }
            if entry.hash == hash {
                match accept(entry.value) {
                    Ok(value) => return Ok(value),
                    Err(true) => free = Some(slot),
                    Err(false) => {}
                }
            }
        }
        let slot = free.unwrap_or(first);
        Err(Vacancy {
            slot,
            hash,
            additions,
        })
    }

    #[inline]
    pub(super) fn is_still_vacant(&self, vacancy: &Vacancy) -> bool {
        vacancy.additions == self.additions
    }

    #[inline]
    pub(super) fn add(&mut self, vacancy: &Vacancy, value: Value) {
        debug_assert!(self.is_still_vacant(vacancy));
        self.additions += 1;
        let (entry, hash) = (&mut self.entries[vacancy.slot], vacancy.hash);
        self.occupied += usize::from(entry.value.is_none());
        *entry = Entry { value, hash };
        if self.occupied * 3 > self.entries.len() * 2 {
            self.grow();
        }
    }

    #[cold]
    fn grow(&mut self) {
        let capacity = self.entries.len() * 2;
        let old = core::mem::replace(&mut self.entries, vec![EMPTY; capacity]);
        for entry in old.into_iter().filter(|entry| !entry.value.is_none()) {
            let mut slot = entry.hash as usize & (capacity - 1);
            while !self.entries[slot].value.is_none() {
                slot = (slot + 1) & (capacity - 1);
            }
            self.entries[slot] = entry;
        }
    }
}

impl Simplifier<'_> {
    /// The position of the walk from which on the value is not available.
    #[inline]
    fn end_of_scope(&self, value: Value) -> u32 {
        self.dominators
            .end_of_subtree(self.function.block_of(value))
    }

    /// Also for arithmetic that exits on overflow, which can stand in for the usual kind.
    #[inline(always)]
    pub(super) fn find_expression(&self, wanted: &Op, ty: Type) -> Result<Value, Vacancy> {
        let hash = match *wanted {
            Op::Binary(op, [a, b]) => hash_pair(op, ty, a.0, b.0),
            Op::Checked(op, [a, b], _) => hash_pair(unchecked(op), ty, a.0, b.0),
            Op::Compare(cond, [a, b]) => hash_pair(cond, Type::Void, a.0, b.0),
            Op::Unary(op, a) => hash_pair(op, ty, u32::MAX, a.0),
            _ => hash_any(wanted, ty),
        };
        let accept = |known| self.accept_expression(known, wanted, ty);
        self.tables.numbering.probe(hash, accept)
    }

    fn accept_expression(&self, known: Value, wanted: &Op, ty: Type) -> Result<Value, bool> {
        if self.end_of_scope(known) <= self.position {
            return Err(true);
        }
        let matches = match (self.op(known), *wanted) {
            (Op::Checked(op, args, _), Op::Checked(same, others, _)) => {
                (op, args) == (same, others)
            }
            (Op::Checked(op, args, _), wanted) => Op::Binary(unchecked(op), args) == wanted,
            (Op::Removed | Op::Alias(_), _) => return Err(true),
            (op, wanted) => op == wanted,
        };
        (matches && self.type_of(known) == ty)
            .then_some(known)
            .ok_or(false)
    }

    #[inline(always)]
    pub(super) fn find_reading(&mut self, wanted: Reading, heap: Heap) -> Result<Value, Vacancy> {
        let hash = hash_pair(
            wanted.kind,
            wanted.ty,
            wanted.offset as u32,
            wanted.address.0,
        );
        self.find_unless_written(hash, heap, |function, known| {
            wanted.offered_by(function, known)
        })
    }

    pub(super) fn find_by_key(
        &mut self,
        (wanted, heap): (Op, Heap),
        ty: Type,
    ) -> Result<Value, Vacancy> {
        let hash = match wanted {
            Op::WideNode {
                kind, args, data, ..
            } => hash_any((kind, data, self.function.values_in(args)), ty),
            _ => hash_any(wanted, ty),
        };
        self.find_unless_written(hash, heap, |function, known| {
            (has_key(function, known, &wanted) && function.type_of(known) == ty).then_some(known)
        })
    }

    #[inline(always)]
    fn find_unless_written(
        &mut self,
        hash: u32,
        heap: Heap,
        offer: impl Fn(&Function, Value) -> Option<Value>,
    ) -> Result<Value, Vacancy> {
        /// Outdated entries stay for the sake of other subtrees, where they may still hold.
        const MOST_OUTDATED: u32 = 3;
        let mut outdated = 0;
        let Tables {
            numbering,
            writes,
            values,
            ..
        } = &mut self.tables;
        let function = &*self.function;
        numbering.probe(hash, |known| {
            let end = self.dominators.end_of_subtree(function.block_of(known));
            if end <= self.position {
                return Err(true);
            }
            let op = function.op(known);
            let offered = offer(function, known);
            let offered = offered.ok_or(matches!(op, Op::Removed | Op::Alias(_)))?;
            let is_immutable = matches!(op, Op::Load { access, .. } | Op::LoadLane { access, .. }
                if access.has(AccessFlags::IMMUTABLE));
            if is_immutable || !writes.may_have_changed(function, heap, values[known].mark) {
                return Ok(offered);
            }
            outdated += 1;
            Err(end == self.end_of_subtree || outdated == MOST_OUTDATED)
        })
    }

    #[inline]
    pub(super) fn add_with_time(&mut self, vacancy: &Vacancy, value: Value) {
        self.tables.values[value].mark = self.tables.writes.now();
        self.tables.numbering.add(vacancy, value);
    }
}
