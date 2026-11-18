//! Pointers, and the instructions that go through them.

#[path = "addressing.rs"]
mod addressing;
#[path = "memory_shapes.rs"]
mod shapes;

use bun_engine_asm::{AtomicOp, Cond, Sign, Size};
use bun_engine_codegen::ir::{
    Access, AccessFlags, Binary, Entity, Heap, HeapRange, Load, Op, Slot, Store, Type, Unary, Value,
};

use super::{Class, Generator};
use crate::support::memory::{
    ARGUMENTS_START, CALLEE_TABLE, GRANULE, OBJECT_COUNT, OBJECT_SIZE, OBJECT_TABLE, Region,
    position,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Risk {
    None,
    /// May lead past the end of the data.
    PastEnd,
    Null,
}

/// The distance from the start of the region is `least` plus a multiple of `step`, up to `greatest`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Pointer {
    pub(crate) region: Region,
    least: i64,
    greatest: i64,
    step: u32,
    is_guarded: bool,
    risk: Risk,
}

const WIDEST_ACCESS: u32 = 16;
const NO_STEP: u32 = 1 << 30;

impl Pointer {
    pub(super) const ANY_OBJECT: Self = Self {
        region: Region::Objects,
        least: 0,
        greatest: (OBJECT_SIZE * (OBJECT_COUNT - 1)) as i64,
        step: OBJECT_SIZE,
        is_guarded: false,
        risk: Risk::None,
    };

    fn exactly(region: Region, distance: i64) -> Self {
        Self {
            region,
            least: distance,
            greatest: distance,
            step: NO_STEP,
            is_guarded: false,
            risk: Risk::None,
        }
    }

    pub(super) fn walking(region: Region, least: i64, step: u32, count: u32) -> Self {
        Self::exactly(region, least).indexed(step, count, true)
    }

    pub(super) fn guarded(self) -> Self {
        Self {
            is_guarded: true,
            ..self
        }
    }

    fn moved(self, by: i64) -> Self {
        Self {
            least: self.least + by,
            greatest: self.greatest + by,
            ..self
        }
    }

    fn indexed(self, scale: u32, count: u32, is_guarded: bool) -> Self {
        Self {
            greatest: self.greatest + i64::from(scale) * (i64::from(count) - 1),
            step: self.step.min(1 << scale.trailing_zeros()),
            is_guarded: self.is_guarded || is_guarded,
            ..self
        }
    }

    fn spread(self) -> u32 {
        (self.greatest - self.least) as u32
    }

    pub(super) fn satisfies(self, wanted: Self) -> bool {
        self.region == wanted.region
            && wanted.least <= self.least
            && self.greatest <= wanted.greatest
            && self.step >= wanted.step
            && (self.least - wanted.least) % i64::from(wanted.step) == 0
            && (wanted.is_guarded || !self.is_guarded)
            && (self.risk == Risk::None || self.risk == wanted.risk)
    }
}

/// Bytes that have been accessed.
#[derive(Clone, Copy)]
pub(super) struct Spot {
    base: Value,
    pointer: Pointer,
    offset: i32,
    size: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Purpose {
    Read,
    Write,
    Atomic,
}

const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];

impl Generator<'_> {
    fn region(&mut self, size: u32, purpose: Purpose) -> Region {
        let region = match self.random.below(12) {
            0..3 => Region::Objects,
            3..6 => Region::Arrays,
            6 | 7 => Region::Linear,
            8 => self.random.pick(&[Region::ReadOnly, Region::Arguments]),
            9 => Region::Reserved,
            _ if self.shape.slots == 0 => Region::Objects,
            _ => Region::Slot(Slot::from_index(
                self.random.below(self.shape.slots as usize),
            )),
        };
        if self.suits(region, size, purpose) {
            region
        } else {
            Region::Arrays
        }
    }

    fn suits(&self, region: Region, size: u32, purpose: Purpose) -> bool {
        let is_aligned = match region {
            Region::Slot(slot) => self.function.slots()[slot].alignment >= size,
            _ => true,
        };
        region.size(&self.function) >= size
            && (purpose == Purpose::Read || region.is_writable())
            && (purpose != Purpose::Atomic || is_aligned)
    }

    pub(super) fn class_of_pointer(&mut self) -> Pointer {
        let region = self.region(8, Purpose::Read);
        let pointer = match region {
            Region::Objects => Pointer::ANY_OBJECT,
            Region::Slot(_) | Region::Reserved => Pointer::exactly(region, 0),
            _ => {
                let step = self.random.pick(&[1, 4, 8, 16]);
                Pointer::exactly(region, 0).indexed(step, 48 / step, false)
            }
        };
        Pointer {
            is_guarded: self.random.flip(),
            ..pointer
        }
    }

    /// Whether the value, if it is an address in the frame, is that of a byte of its region.
    pub(super) fn can_be_shown(&self, class: Class) -> bool {
        match class {
            Class::Pointer(pointer) if pointer.region.segment().is_some() => {
                pointer.least >= 0 && pointer.greatest < pointer.region.size(&self.function).into()
            }
            _ => class.has_determined_bits(),
        }
    }

    fn root(&mut self, region: Region) -> (Value, Pointer) {
        let frame_pointer = self.registers.frame_pointer;
        match region {
            Region::Slot(slot) => (
                self.function.slot_address(slot),
                Pointer::exactly(region, 0),
            ),
            Region::Reserved => {
                let size = self.function.reserved_frame_bytes;
                (
                    self.function.pinned(frame_pointer),
                    Pointer::exactly(region, size.into()),
                )
            }
            Region::Arguments => {
                let distance = -i64::from(ARGUMENTS_START);
                (
                    self.function.pinned(frame_pointer),
                    Pointer::exactly(region, distance),
                )
            }
            Region::Objects if self.random.percent(60) => (self.object(), Pointer::ANY_OBJECT),
            _ if self.random.flip() => {
                let distance = self.layout.data_start().wrapping_sub(self.start_of(region)) as i64;
                (
                    self.function.pinned(self.registers.pinned[0]),
                    Pointer::exactly(region, distance),
                )
            }
            _ => {
                let distance = self.random.pick(&[0, 0, 8, 32]);
                let address = self.start_of(region) as i64 + distance;
                (
                    self.function.const64(address),
                    Pointer::exactly(region, distance),
                )
            }
        }
    }

    pub(super) fn object(&mut self) -> Value {
        let class = Class::Pointer(Pointer::ANY_OBJECT);
        if self.random.percent(60)
            && let Some((found, _)) = self.find(|known| known.satisfies(class))
        {
            return found;
        }
        let object = match self.random.below(6) {
            0 | 1 if self.depth < 3 => {
                self.depth += 1;
                let from = self.object();
                self.depth -= 1;
                let spot = Spot {
                    base: from,
                    pointer: Pointer::ANY_OBJECT,
                    offset: 0,
                    size: 8,
                };
                self.load_from(spot, Load::Full, Type::I64)
            }
            2 => self.load_from_table(OBJECT_TABLE, OBJECT_COUNT),
            3 => {
                let index = self.value_of(Class::Index {
                    ty: Type::I64,
                    below: OBJECT_COUNT,
                    is_guarded: false,
                });
                let scaled = self.scale(index, OBJECT_SIZE);
                let first = self.function.pinned(self.registers.pinned[0]);
                self.commutative(Binary::Add, first, scaled)
            }
            4 if self.shape.weights.patchpoints != 0 => self.object_from_patchpoint(),
            _ => {
                let address = self.layout.object(self.random.next());
                return self.function.const64(address as i64);
            }
        };
        self.keep(object, class)
    }

    fn load_from_table(&mut self, table: u32, count: u32) -> Value {
        let index = self.value_of(Class::Index {
            ty: Type::I32,
            below: count,
            is_guarded: false,
        });
        let (start, pointer) = self.root(Region::ReadOnly);
        let (base, pointer) = self.add_index(start, pointer, index, 8, count, false);
        let offset = (i64::from(table) - pointer.least) as i32;
        self.load_from(
            Spot {
                base,
                pointer,
                offset,
                size: 8,
            },
            Load::Full,
            Type::I64,
        )
    }

    pub(super) fn fresh_callee(&mut self, signature: usize) -> Value {
        let [first, second] = [0, 1].map(|variant| self.layout.callees[2 * signature + variant]);
        let callee = match self.random.below(3) {
            0 => {
                let address = self.random.pick(&[first, second]);
                return self.function.const64(address as i64);
            }
            1 => self.load_from_table(CALLEE_TABLE + 16 * signature as u32, 2),
            _ => {
                let condition = self.condition();
                let [first, second] = [first, second].map(|at| self.function.const64(at as i64));
                self.select(condition, first, second)
            }
        };
        self.keep(callee, Class::Callee(signature))
    }

    fn scale(&mut self, index: Value, scale: u32) -> Value {
        if scale == 1 {
            index
        } else if scale.is_power_of_two() && self.random.percent(75) {
            self.binary_constant(Binary::Shl, index, scale.trailing_zeros().into())
        } else {
            self.binary_constant(Binary::Mul, index, scale.into())
        }
    }

    fn add_index(
        &mut self,
        base: Value,
        pointer: Pointer,
        index: Value,
        scale: u32,
        count: u32,
        is_guarded: bool,
    ) -> (Value, Pointer) {
        let sign = self
            .random
            .pick(&[Sign::Unsigned, Sign::Unsigned, Sign::Signed]);
        let scaled = if self.type_of(index) == Type::I64 {
            self.scale(index, scale)
        } else if self.random.one_in(4) {
            let narrow = self.scale(index, scale);
            self.unary(Unary::Widen(sign), Type::I64, narrow)
        } else {
            let wide = self.unary(Unary::Widen(sign), Type::I64, index);
            self.scale(wide, scale)
        };
        (
            self.commutative(Binary::Add, base, scaled),
            pointer.indexed(scale, count, is_guarded),
        )
    }

    fn add_distance(&mut self, base: Value, distance: i64) -> Value {
        if self.random.one_in(5) {
            self.binary_constant(Binary::Sub, base, -distance)
        } else {
            let distance = self.function.const64(distance);
            self.commutative(Binary::Add, base, distance)
        }
    }

    /// Leaves room for an access of `size` bytes, aligned to `alignment`.
    fn derive(
        &mut self,
        base: Value,
        pointer: Pointer,
        size: u32,
        alignment: u32,
    ) -> (Value, Pointer) {
        let room = (pointer.region.size(&self.function) - pointer.spread()).saturating_sub(size);
        match self.random.below(8) {
            0..3 => {
                let distance = match self.random.below(8) {
                    0..4 => self.random.between(-4, 8) * 8,
                    4 => self.random.between(-300, 300),
                    5 => self.random.between(-40_000, 40_000),
                    6 => self.random.between(-0x100_0000, 0x100_0000),
                    _ => self.random.pick(&[-1, 1]) * (0x7ff0_0000 - pointer.least.abs()),
                };
                (self.add_distance(base, distance), pointer.moved(distance))
            }
            3..6 => {
                let scale = match pointer.region {
                    Region::Objects => OBJECT_SIZE,
                    _ => self.random.pick(&[1, 2, 4, 8, 8, 16, 3, 12]) * alignment,
                };
                let most = room / scale + 1;
                let ty = self.int_type();
                let class = Class::Index {
                    ty,
                    below: most,
                    is_guarded: true,
                };
                let found = self.find(|known| known.satisfies(class));
                let (index, count, is_guarded) = match found {
                    Some((
                        index,
                        Class::Index {
                            below, is_guarded, ..
                        },
                    )) => (index, below, is_guarded),
                    _ => (self.fresh_index(ty, most), most, false),
                };
                self.add_index(base, pointer, index, scale, count, is_guarded)
            }
            6 => {
                let unit = if pointer.region == Region::Objects {
                    OBJECT_SIZE
                } else {
                    8.max(alignment)
                };
                let distance = self.random.below((room / unit) as usize + 1) as u32 * unit;
                let other = self.add_distance(base, distance.into());
                let condition = self.condition();
                let either = if distance == 0 {
                    pointer
                } else {
                    pointer.indexed(distance, 2, false)
                };
                (self.select(condition, base, other), either)
            }
            _ => (self.unary(Unary::Opaque, Type::I64, base), pointer),
        }
    }

    pub(super) fn fresh_pointer_for(&mut self, wanted: Pointer) -> Value {
        if Pointer::ANY_OBJECT.satisfies(wanted) {
            return self.object();
        }
        let (root, pointer) = self.root(wanted.region);
        let mut address = self.add_distance(root, wanted.least - pointer.least);
        if wanted.spread() != 0 && self.random.flip() {
            let (ty, count) = (self.int_type(), wanted.spread() / wanted.step + 1);
            let index = self.value_of(Class::Index {
                ty,
                below: count,
                is_guarded: false,
            });
            address = self
                .add_index(address, wanted, index, wanted.step, 1, false)
                .0;
        }
        self.keep(
            address,
            Class::Pointer(Pointer {
                is_guarded: false,
                ..wanted
            }),
        )
    }

    /// The offsets from the least value of the pointer at which the access is allowed.
    fn place_in(&mut self, pointer: Pointer, size: u32, purpose: Purpose) -> Option<i32> {
        let extent = match pointer.risk {
            Risk::PastEnd => GRANULE as u32,
            _ => pointer.region.size(&self.function),
        };
        let mut room = extent.checked_sub(pointer.spread() + size)?;
        if pointer.risk == Risk::PastEnd && !self.random.one_in(20) {
            room = room.min(24);
        }
        let mut start = self.random.below(room as usize + 1) as u32;
        if purpose == Purpose::Atomic || self.random.percent(80) {
            start -= start % size;
        }
        if purpose == Purpose::Atomic && !pointer.step.is_multiple_of(size) {
            return None;
        }
        let touches_link = start % OBJECT_SIZE < 8 || start % OBJECT_SIZE + size > OBJECT_SIZE;
        if pointer.region == Region::Objects && purpose != Purpose::Read && touches_link {
            start = start / OBJECT_SIZE * OBJECT_SIZE + size.max(8);
        }
        i32::try_from(i64::from(start) - pointer.least).ok()
    }

    fn spot(&mut self, size: u32, purpose: Purpose) -> Spot {
        if !self.scope.spots.is_empty() && self.random.percent(45) {
            let recent = self
                .scope
                .spots
                .len()
                .saturating_sub(self.random.pick(&[1, 3, 100]));
            let known = self.random.pick(&self.scope.spots[recent..]);
            let start = known.pointer.least + i64::from(known.offset);
            let is_link =
                known.pointer.region == Region::Objects && !(8..=24).contains(&(start % 32));
            let is_allowed = purpose == Purpose::Read
                || purpose == Purpose::Write
                    && known.pointer.region.is_writable()
                    && !is_link
                    && (known.pointer.region != Region::Objects
                        || start % 32 + i64::from(known.size) <= 32);
            if size <= known.size && is_allowed && self.random.percent(75) {
                let shift = if self.random.one_in(4) {
                    self.random.below((known.size - size) as usize + 1)
                } else {
                    0
                };
                return Spot {
                    offset: known.offset + shift as i32,
                    size,
                    ..known
                };
            }
            if self.suits(known.pointer.region, size, purpose)
                && let Some(offset) = self.place_in(known.pointer, size, purpose)
            {
                return self.remember(Spot {
                    offset,
                    size,
                    ..known
                });
            }
        }
        let region = self.region(size, purpose);
        let alignment = if purpose == Purpose::Atomic { size } else { 1 };
        let is_candidate =
            |known| matches!(known, Class::Pointer(pointer) if pointer.region == region);
        if self.random.flip()
            && let Some((base, Class::Pointer(pointer))) = self.find(is_candidate)
            && let Some(offset) = self.place_in(pointer, size, purpose)
        {
            return self.remember(Spot {
                base,
                pointer,
                offset,
                size,
            });
        }
        loop {
            let (mut base, mut pointer) = self.root(region);
            if self.depth < 3 {
                self.depth += 1;
                for _ in 0..self.random.pick(&[0, 1, 1, 2, 3]) {
                    (base, pointer) = self.derive(base, pointer, size, alignment);
                    self.learn(base, Class::Pointer(pointer));
                }
                self.depth -= 1;
            }
            if let Some(offset) = self.place_in(pointer, size, purpose) {
                return self.remember(Spot {
                    base,
                    pointer,
                    offset,
                    size,
                });
            }
        }
    }

    fn remember(&mut self, spot: Spot) -> Spot {
        self.scope.spots.push(spot);
        spot
    }

    /// One that includes the positions, more likely a narrow one.
    pub(super) fn heap_including(&mut self, first: u32, last: u32) -> Heap {
        let includes = |&&(range, _): &&(HeapRange, Heap)| range.start <= first && last < range.end;
        let count = self.heaps.iter().filter(includes).count();
        let has_many = self.heaps.len() > 100;
        let chosen = if self.random.percent(70) && !has_many {
            0
        } else {
            self.random.below(count)
        };
        self.heaps.iter().filter(includes).nth(chosen).unwrap().1
    }

    fn heap_of(&mut self, spot: Spot) -> Heap {
        let Spot {
            pointer,
            offset,
            size,
            ..
        } = spot;
        let start = (pointer.least + i64::from(offset)) as u32;
        let (first, last) = match pointer.region {
            Region::Objects if start % OBJECT_SIZE + size > OBJECT_SIZE => {
                (position::LINK, position::LINK + 3)
            }
            Region::Objects => (
                pointer.region.position_at(start),
                pointer.region.position_at(start + size - 1),
            ),
            region => (
                region.position_at(start),
                region.position_at(start + pointer.spread() + size - 1),
            ),
        };
        self.heap_including(first, last)
    }

    fn access(&mut self, spot: Spot, purpose: Purpose) -> Access {
        let mut flags = AccessFlags::empty();
        let may_trap = self.shape.weights.trapping_accesses != 0 && self.random.one_in(10);
        flags.set(
            AccessFlags::TRAPS,
            spot.pointer.risk != Risk::None || may_trap,
        );
        flags.set(AccessFlags::ATOMIC, purpose == Purpose::Atomic);
        if purpose == Purpose::Read {
            let is_safe = !spot.pointer.is_guarded && !flags.contains(AccessFlags::TRAPS);
            flags.set(
                AccessFlags::ALWAYS_READABLE,
                is_safe && self.random.one_in(3),
            );
            flags.set(
                AccessFlags::IMMUTABLE,
                !spot.pointer.region.is_writable() && self.random.percent(70),
            );
        }
        Access::new(self.heap_of(spot), flags)
    }

    fn load_from(&mut self, spot: Spot, kind: Load, ty: Type) -> Value {
        let access = self.access(spot, Purpose::Read);
        self.emit(
            Op::Load {
                kind,
                address: spot.base,
                offset: spot.offset,
                access,
            },
            ty,
        )
    }

    fn store_to(&mut self, spot: Spot, value: Value, purpose: Purpose) {
        let kind = if spot.size == self.type_of(value).bytes() {
            Store::Full
        } else {
            Store::Narrow(SIZES[spot.size.trailing_zeros() as usize])
        };
        let access = self.access(spot, purpose);
        self.emit(
            Op::Store {
                kind,
                args: [value, spot.base],
                offset: spot.offset,
                access,
            },
            Type::Void,
        );
    }

    fn load_kind(&mut self, ty: Type) -> (Load, u32) {
        let sign = self.random.pick(&[Sign::Signed, Sign::Unsigned]);
        let size = self.random.pick(&SIZES);
        match ty {
            Type::I32 if size < Size::S32 => (Load::Narrow(size, sign), size.bytes().into()),
            Type::V128 => match self.random.below(6) {
                0 if size < Size::S64 => (Load::VectorExtend(size, sign), 8),
                1 => (Load::VectorSplat(size), size.bytes().into()),
                2 if size >= Size::S32 => (Load::VectorZero(size), size.bytes().into()),
                _ => (Load::Full, WIDEST_ACCESS),
            },
            _ => (Load::Full, ty.bytes()),
        }
    }

    pub(super) fn load(&mut self, ty: Type) -> Value {
        let (kind, size) = self.load_kind(ty);
        let spot = self.spot(size, Purpose::Read);
        self.load_from(spot, kind, ty)
    }

    pub(super) fn load_as(&mut self, kind: Load, ty: Type) -> Value {
        let size = match kind {
            Load::Narrow(size, _) | Load::VectorZero(size) | Load::VectorSplat(size) => {
                size.bytes().into()
            }
            Load::VectorExtend(..) => 8,
            Load::Full => ty.bytes(),
        };
        let spot = self.spot(size, Purpose::Read);
        self.load_from(spot, kind, ty)
    }

    pub(super) fn load_trusting(&mut self, index: Value, count: u32) -> Value {
        let region = self
            .random
            .pick(&[Region::Arrays, Region::Linear, Region::ReadOnly]);
        let (start, pointer) = self.root(region);
        let (address, pointer) = self.add_index(start, pointer, index, 8, count, false);
        let (offset, size) = (self.place_in(pointer, 8, Purpose::Read).unwrap(), 8);
        let spot = self.remember(Spot {
            base: address,
            pointer,
            offset,
            size,
        });
        let mut flags = AccessFlags::ALWAYS_READABLE;
        flags.set(AccessFlags::IMMUTABLE, !region.is_writable());
        let (kind, access) = (Load::Full, Access::new(self.heap_of(spot), flags));
        self.emit(
            Op::Load {
                kind,
                address,
                offset,
                access,
            },
            Type::I64,
        )
    }

    pub(super) fn store_somewhere(&mut self, value: Value) {
        let size = self.store_size(self.type_of(value));
        let spot = self.spot(size, Purpose::Write);
        self.store_to(spot, value, Purpose::Write);
    }

    pub(super) fn load_narrow(&mut self, size: Size, sign: Sign) -> Value {
        let spot = self.spot(size.bytes().into(), Purpose::Read);
        self.load_from(spot, Load::Narrow(size, sign), Type::I32)
    }

    pub(super) fn load_lane(&mut self, vector: Value) -> Value {
        let lanes = self.random.pick(&SIZES);
        let lane = self.random.below(16 / usize::from(lanes.bytes())) as u8;
        let spot = self.spot(lanes.bytes().into(), Purpose::Read);
        let access = self.access(spot, Purpose::Read);
        let args = [vector, spot.base];
        self.emit(
            Op::LoadLane {
                lanes,
                lane,
                args,
                offset: spot.offset,
                access,
            },
            Type::V128,
        )
    }

    fn store_size(&mut self, ty: Type) -> u32 {
        let narrow = u32::from(self.random.pick(&SIZES).bytes());
        if ty.is_int() && self.random.flip() {
            narrow.min(ty.bytes())
        } else {
            ty.bytes()
        }
    }

    fn store(&mut self) {
        let ty = self.data_type();
        let size = self.store_size(ty);
        let value = if size < ty.bytes() && self.random.one_in(3) {
            self.with_irrelevant_upper_bits(ty, size * 8)
        } else {
            self.data(ty)
        };
        if ty == Type::V128 && self.random.one_in(4) {
            let lanes = self.random.pick(&SIZES);
            let lane = self.random.below(16 / usize::from(lanes.bytes())) as u8;
            let spot = self.spot(lanes.bytes().into(), Purpose::Write);
            let access = self.access(spot, Purpose::Write);
            let args = [value, spot.base];
            self.emit(
                Op::StoreLane {
                    lanes,
                    lane,
                    args,
                    offset: spot.offset,
                    access,
                },
                Type::Void,
            );
        } else {
            let spot = self.spot(size, Purpose::Write);
            self.store_to(spot, value, Purpose::Write);
        }
    }

    fn load_change_store(&mut self) {
        let ty = self.int_type();
        let (kind, size) = self.load_kind(ty);
        let spot = self.spot(size, Purpose::Write);
        let old = self.load_from(spot, kind, ty);
        if self.random.one_in(4) {
            self.learn(old, Class::Data(ty));
        }
        let new = match self.random.below(10) {
            0 => self.unary(Unary::Neg, ty, old),
            1 => self.binary_constant(Binary::Xor, old, -1),
            2 => old,
            3 => {
                let op = self.random.pick(&[Binary::Shl, Binary::Shr, Binary::Sar]);
                let amount = self.int(Type::I32);
                self.binary(op, old, amount)
            }
            4 => {
                let operand = self.int(ty);
                self.binary(Binary::Sub, old, operand)
            }
            _ => {
                let op = self.random.pick(&[
                    Binary::Add,
                    Binary::Add,
                    Binary::And,
                    Binary::Or,
                    Binary::Xor,
                ]);
                let operand = self.int(ty);
                self.commutative(op, old, operand)
            }
        };
        self.store_to(spot, new, Purpose::Write);
    }

    fn adjacent_stores(&mut self) {
        let whole = self.spot(8, Purpose::Write);
        let size = self.random.pick(&[1, 2, 4]);
        let mut offsets: Vec<u32> = (0..8).step_by(size as usize).collect();
        if self.random.flip() {
            self.random.shuffle(&mut offsets);
        }
        for offset in offsets {
            let value = if self.random.percent(80) {
                self.int_constant(Type::I32)
            } else {
                self.int(Type::I32)
            };
            let part = Spot {
                offset: whole.offset + offset as i32,
                size,
                ..whole
            };
            self.store_to(part, value, Purpose::Write);
        }
    }

    pub(super) fn access_statement(&mut self) {
        match self.random.below(16) {
            0..6 => {
                let ty = self.data_type();
                let loaded = self.load(ty);
                self.keep(loaded, Class::Data(ty));
            }
            6..11 => self.store(),
            11..13 => self.load_change_store(),
            13 => self.adjacent_stores(),
            14 => {
                let (from, to) = (self.object(), self.object());
                let spot = Spot {
                    base: from,
                    pointer: Pointer::ANY_OBJECT,
                    offset: 0,
                    size: 8,
                };
                self.store_to(spot, to, Purpose::Write);
            }
            _ => {
                let region = self.region(8, Purpose::Read);
                let (base, pointer) = self.root(region);
                let distance = self.random.between(-2, 2) * 8;
                let other = self.add_distance(base, distance);
                self.learn(other, Class::Pointer(pointer.moved(distance)));
                let (result, ty) = if self.random.flip() {
                    (self.binary(Binary::Sub, other, base), Type::I64)
                } else {
                    let cond = self.random.pick(&[Cond::Eq, Cond::Ne]);
                    (self.compare(cond, other, base), Type::I32)
                };
                self.keep(result, Class::Data(ty));
            }
        }
    }

    /// Later statements find the spot again.
    pub(super) fn trapping_access(&mut self) {
        let (base, pointer) = if self.random.one_in(4) {
            let (object, null) = (self.object(), self.function.const64(0));
            let is_null = self.unlikely_condition();
            let pointer = Pointer {
                risk: Risk::Null,
                ..Pointer::ANY_OBJECT
            };
            (self.select(is_null, null, object), pointer)
        } else {
            let count = self.random.pick(&[16, 64, 64, 96, 128, 128, 256]);
            let index = self.value_of(Class::Index {
                ty: Type::I32,
                below: count,
                is_guarded: true,
            });
            let (start, pointer) = self.root(Region::Linear);
            let pointer = Pointer {
                risk: Risk::PastEnd,
                ..pointer
            };
            self.add_index(start, pointer, index, 1, count, true)
        };
        self.learn(base, Class::Pointer(pointer));
        let ty = self.data_type();
        if self.random.flip() {
            let (kind, size) = self.load_kind(ty);
            let offset = self.place_in(pointer, size, Purpose::Read).unwrap();
            let spot = self.remember(Spot {
                base,
                pointer,
                offset,
                size,
            });
            let loaded = self.load_from(spot, kind, ty);
            self.keep(loaded, Class::Data(ty));
        } else {
            let (value, size) = (self.data(ty), self.store_size(ty));
            let offset = self.place_in(pointer, size, Purpose::Write).unwrap();
            let spot = self.remember(Spot {
                base,
                pointer,
                offset,
                size,
            });
            self.store_to(spot, value, Purpose::Write);
        }
    }

    fn atomic_operand(&mut self, ty: Type, size: Size) -> Value {
        if size < ty.width().size() && self.random.flip() {
            self.with_irrelevant_upper_bits(ty, size.bits().into())
        } else {
            self.int(ty)
        }
    }

    pub(super) fn atomic_statement(&mut self) {
        let ty = self.int_type();
        let size = self.random.pick(&SIZES).min(ty.width().size());
        let kind = self.random.below(6);
        if kind == 0 {
            let [reads, writes] = [(); 2].map(|()| {
                let some = self.random.pick(&self.heaps).1;
                self.random.pick(&[Heap::NOTHING, Heap::EVERYTHING, some])
            });
            return self.builder().fence(reads, writes);
        }
        let spot = self.spot(size.bytes().into(), Purpose::Atomic);
        let access = self.access(spot, Purpose::Atomic);
        let (result, ty) = match kind {
            1 => {
                let sign = self
                    .random
                    .pick(&[Sign::Unsigned, Sign::Unsigned, Sign::Signed]);
                let kind = if size < Size::S32 {
                    Load::Narrow(size, sign)
                } else {
                    Load::Full
                };
                let ty = size.width().into();
                (
                    self.emit(
                        Op::Load {
                            kind,
                            address: spot.base,
                            offset: spot.offset,
                            access,
                        },
                        ty,
                    ),
                    ty,
                )
            }
            2 => {
                let value = self.int(ty);
                return self.store_to(spot, value, Purpose::Atomic);
            }
            3 => {
                let address = self.add_distance(spot.base, spot.offset.into());
                let expected = if self.random.flip() && size == ty.width().size() {
                    self.load_from(spot, Load::Full, ty)
                } else {
                    self.int(ty)
                };
                let replacement = self.atomic_operand(ty, size);
                let old = self.builder().atomic_compare_exchange(
                    size,
                    expected,
                    replacement,
                    address,
                    access,
                );
                (old, ty)
            }
            _ => {
                use AtomicOp::*;
                let op = self.random.pick(&[Add, Sub, And, Or, Xor, Exchange]);
                let address = self.add_distance(spot.base, spot.offset.into());
                let operand = self.atomic_operand(ty, size);
                (
                    self.builder()
                        .atomic_update(op, size, operand, address, access),
                    ty,
                )
            }
        };
        if !self.random.one_in(4) {
            self.keep(result, Class::Data(ty));
        }
    }

    /// The address of eight bytes, and a heap that includes them.
    pub(super) fn word_address(&mut self, writes: bool) -> (Value, Heap) {
        let purpose = if writes {
            Purpose::Write
        } else {
            Purpose::Read
        };
        loop {
            let spot = self.spot(8, purpose);
            if spot.pointer.risk == Risk::None {
                return (
                    self.add_distance(spot.base, spot.offset.into()),
                    self.heap_of(spot),
                );
            }
        }
    }

    pub(super) fn initialize_frame(&mut self) {
        let slots = self.function.slots().keys().map(Region::Slot);
        for region in slots.chain([Region::Reserved]) {
            let (size, mut start) = (region.size(&self.function), 0);
            while start < size {
                let ty = if size - start >= 8 {
                    Type::I64
                } else {
                    Type::I32
                };
                let (base, pointer) = self.root(region);
                let offset = (i64::from(start) - pointer.least) as i32;
                let value = self.known_int(ty);
                self.store_to(
                    Spot {
                        base,
                        pointer,
                        offset,
                        size: ty.bytes(),
                    },
                    value,
                    Purpose::Write,
                );
                start += ty.bytes();
            }
        }
    }

    pub(super) fn address_in(&mut self, region: Region, distance: i64) -> Value {
        let address = self.start_of(region) as i64 + distance;
        self.function.const64(address)
    }
}
