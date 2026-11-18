//! Accesses in the shapes that addressing modes and instructions on memory are made for.

use bun_engine_asm::{Cond, Sign, Size};
use bun_engine_codegen::ir::{Binary, Load, Type, Unary, Value};

use super::super::integers::{SIGNS, width};
use super::super::{Class, Generator};
use super::{Pointer, Purpose, Risk, Spot};
use crate::support::memory::{LINEAR_SIZE, OBJECT_SIZE, Region};

const DISTANCES: [i64; 14] = [
    0, 0, 8, 16, 248, 256, 504, 4088, 4096, 0x7ff8, 0x1_2340, 0x10_0000, 0xff_f008, 0x123_4568,
];

impl Generator<'_> {
    pub(in super::super) fn addressing_statement(&mut self) {
        let can_loop = self.trips * 8 <= self.shape.trips;
        match self.random.below(10) {
            0..3 => self.interleaved_fields(),
            3..6 if can_loop => self.tables_in_loop(),
            3..6 => {
                let (table, sum) = (self.distant_table(), self.known_int(Type::I64));
                let sum = self.use_table(table, sum);
                self.keep_all(&[sum]);
            }
            6 if self.random.one_in(4) => self.show_frame_address(),
            6 => self.chase_links(),
            7 if self.shape.weights.trapping_accesses != 0 => self.access_near_end(),
            _ => {
                let size = self.random.pick(&[1, 2, 4, 8]);
                let spot = self.spot(size, Purpose::Read);
                self.test_in_memory(spot);
            }
        }
    }

    /// Nothing is known of its bits.
    fn show_frame_address(&mut self) {
        let region = self.region(4, Purpose::Read);
        let region = region.segment().map_or(Region::Arguments, |_| region);
        let address = self.root(region).0;
        let low = self.unary(Unary::Wrap, Type::I32, address);
        let shown = self.random.pick(&[address, low]);
        self.observe(&[shown, shown]);
    }

    fn type_of_size(&mut self, size: u32) -> Type {
        let has_floats = self.shape.weights.floats != 0 && self.random.one_in(4);
        match (size, has_floats) {
            (16, _) => Type::V128,
            (8, true) => Type::F64,
            (8, false) => Type::I64,
            (4, true) => Type::F32,
            _ => Type::I32,
        }
    }

    /// Neighbouring fields of objects that may be the same, in any order and with little in between.
    fn interleaved_fields(&mut self) {
        let shift = self.random.pick(&[0, 0, 0, -512, -504, 256, 496, 1024]);
        let objects = [(); 2].map(|()| {
            let object = self.object();
            let base = self.add_distance(object, -shift);
            let base = self.unary(Unary::Opaque, Type::I64, base);
            (base, Pointer::ANY_OBJECT.moved(-shift))
        });
        let size = self.random.pick(&[4, 8, 8]);
        let values: Vec<Value> = (0..3)
            .map(|_| {
                let ty = self.type_of_size(size);
                self.data(ty)
            })
            .collect();
        let (mut place, last) = (8, OBJECT_SIZE - size);
        let mut loaded = Vec::new();
        for _ in 0..self.random.between(2, 9) {
            place = match self.random.below(4) {
                0 => 8 + self.random.below(((last - 8) / size) as usize + 1) as u32 * size,
                1 => (place - size).max(8),
                _ if place == last => 8,
                _ => place + size,
            };
            let (base, pointer) = self.random.pick(&objects);
            let spot = Spot {
                base,
                pointer,
                offset: place as i32 + shift as i32,
                size,
            };
            match self.random.below(16) {
                0..6 => {
                    let ty = self.type_of_size(size);
                    loaded.push(self.load_from(spot, Load::Full, ty));
                }
                6..12 => {
                    let known = if loaded.is_empty() || self.random.flip() {
                        &values
                    } else {
                        &loaded
                    };
                    let value = self.random.pick(known);
                    self.store_to(spot, value, Purpose::Write);
                }
                12 => {
                    let ty = self.type_of_size(size);
                    let constant = self.random.pick(&[0, 0, 1, u64::MAX]);
                    let value = self.function.constant(ty, constant);
                    self.store_to(spot, value, Purpose::Write);
                }
                13 => {
                    let condition = self.unlikely_condition();
                    self.check(condition);
                }
                14 => {
                    let ty = self.int_type();
                    self.fresh_int(ty);
                }
                _ => self.trifle(),
            }
        }
        self.keep_all(&loaded);
    }

    /// The first load gives the address for nothing but what follows, so it may well take the register of its own.
    fn chase_links(&mut self) {
        let mut object = self.object();
        for _ in 0..self.random.between(1, 3) {
            let field = |offset| Spot {
                base: object,
                pointer: Pointer::ANY_OBJECT,
                offset,
                size: 8,
            };
            let order = self.random.pick(&[[0, 8], [8, 0]]);
            let [first, second] =
                order.map(|offset| self.load_from(field(offset), Load::Full, Type::I64));
            let (link, other) = if order[0] == 0 {
                (first, second)
            } else {
                (second, first)
            };
            self.keep_all(&[other]);
            object = link;
        }
        self.keep(object, Class::Pointer(Pointer::ANY_OBJECT));
    }

    /// An address that is some way before a region.
    fn distant_table(&mut self) -> (Value, Pointer) {
        let region = self
            .random
            .pick(&[Region::Arrays, Region::Linear, Region::ReadOnly]);
        let (root, pointer) = self.root(region);
        if self.random.one_in(3) {
            return (root, pointer);
        }
        let distance = self.random.pick(&DISTANCES) * self.random.pick(&[-1, -1, -1, 1]);
        let moved = self.add_distance(root, distance);
        let base = if self.random.one_in(3) {
            moved
        } else {
            self.unary(Unary::Opaque, Type::I64, moved)
        };
        (base, pointer.moved(distance))
    }

    /// One of eight multiples of `scale`, made of three bits of some value.
    fn scaled_bits(&mut self, scale: u32) -> Value {
        let ty = self.int_type();
        let (any, log2) = (self.known_int(ty), i64::from(scale.ilog2()));
        let scaled = match self.random.below(5) {
            0 => {
                let first = self.random.between(0, width(ty) - 3 - log2);
                let shifted = self.binary_constant(Binary::Shr, any, first);
                self.binary_constant(Binary::And, shifted, 7 << log2)
            }
            1 => {
                let top = self.binary_constant(Binary::Shr, any, width(ty) - 3);
                self.binary_constant(Binary::Shl, top, log2)
            }
            2 => {
                let shifted = self.binary_constant(Binary::Shl, any, log2);
                self.binary_constant(Binary::And, shifted, 7 << log2)
            }
            _ => {
                let low = self.binary_constant(Binary::And, any, 7);
                let low = self.unary(Unary::Opaque, ty, low);
                let wide = self.convert_int(low, Type::I64);
                self.scale(wide, scale)
            }
        };
        self.convert_int(scaled, Type::I64)
    }

    fn use_table(&mut self, (table, pointer): (Value, Pointer), mut sum: Value) -> Value {
        let scale = self.random.pick(&[1, 2, 4, 8]);
        let scaled = self.scaled_bits(scale);
        let base = self.commutative(Binary::Add, table, scaled);
        let pointer = pointer.indexed(scale, 8, false);
        for _ in 0..self.random.pick(&[1, 1, 1, 2, 2, 3, 5]) {
            let size = self.random.pick(&[scale, scale, 1, 2, 4, 8, 16]);
            let size = if self.shape.weights.vectors == 0 {
                size.min(8)
            } else {
                size
            };
            let purpose = if pointer.region.is_writable() && self.random.one_in(3) {
                Purpose::Write
            } else {
                Purpose::Read
            };
            let Some(offset) = self.place_in(pointer, size, purpose) else {
                continue;
            };
            let spot = Spot {
                base,
                pointer,
                offset,
                size,
            };
            let loaded = self.load_some_of(spot);
            if purpose == Purpose::Write && size <= 8 {
                let changed = self.binary(Binary::Xor, loaded, sum);
                self.store_to(spot, changed, purpose);
            }
            let stirred = self.binary_constant(Binary::RotateLeft, sum, 5);
            sum = self.binary(Binary::Add, stirred, loaded);
        }
        sum
    }

    fn tables_in_loop(&mut self) {
        let tables: Vec<_> = (0..self.random.between(1, 3))
            .map(|_| self.distant_table())
            .collect();
        let initial = [self.known_int(Type::I64)];
        let results = self.count(&initial, &mut |this, counting| {
            let mut sum = counting.carried[0];
            for _ in 0..this.random.between(1, 4) {
                this.learn(sum, Class::Data(Type::I64));
                let table = this.random.pick(&tables);
                sum = this.use_table(table, sum);
                this.trifle();
            }
            vec![sum]
        });
        self.keep_all(&results);
    }

    /// Compares or tests what is loaded, which nothing else uses.
    fn test_in_memory(&mut self, spot: Spot) {
        let sign = self.random.pick(&SIGNS);
        let (kind, ty) = match spot.size {
            1 => (Load::Narrow(Size::S8, sign), Type::I32),
            2 => (Load::Narrow(Size::S16, sign), Type::I32),
            4 => (Load::Full, Type::I32),
            _ => (Load::Full, Type::I64),
        };
        let bits = i64::from(spot.size) * 8;
        let other = match self.random.below(8) {
            0 => self.load_from(spot, kind, ty),
            1 | 2 => self.known_int(ty),
            3 => self.int_constant(ty),
            4 => {
                let edge = 1i64 << (bits - 1);
                let number = self.random.pick(&[edge, !edge, edge.wrapping_sub(1), -1]);
                let number = number.wrapping_add(self.random.between(-1, 1));
                self.constant(ty, number)
            }
            5 => {
                let bit = self.random.between(0, width(ty) - 1);
                self.constant(ty, 1 << bit)
            }
            _ => {
                let (byte, position) = (self.random.between(0, 255), self.random.below(8));
                self.constant(ty, byte << (position as i64 * 8 % bits))
            }
        };
        let loaded = self.load_from(spot, kind, ty);
        let condition = match self.random.below(8) {
            0 => loaded,
            1..4 => self.commutative(Binary::And, loaded, other),
            _ => {
                let cond = self.random.pick(&Cond::ALL);
                self.compare(cond, loaded, other)
            }
        };
        self.use_as_condition(condition);
    }

    /// Ends just before the end of the data, or a few bytes after it.
    fn access_near_end(&mut self) {
        let size = self.random.pick(&[1, 2, 4, 8]);
        let any = self.known_int(Type::I32);
        let mask = self.random.pick(&[0, 1, 3, 7]);
        let index = self.binary_constant(Binary::And, any, mask);
        let (start, pointer) = self.root(Region::Linear);
        let pointer = Pointer {
            risk: Risk::PastEnd,
            ..pointer
        };
        let (base, pointer) = self.add_index(start, pointer, index, 1, 8, true);
        let slack = self.random.between(0, mask + 2);
        let spot = Spot {
            base,
            pointer,
            offset: (i64::from(LINEAR_SIZE - size) - slack - pointer.least) as i32,
            size,
        };
        if self.random.flip() {
            return self.test_in_memory(spot);
        }
        let loaded = self.load_some_of(spot);
        let part = match self.random.below(4) {
            0 => self.binary_constant(Binary::And, loaded, 0xff),
            1 => self.unary(Unary::SignExtend(Size::S8), Type::I64, loaded),
            2 => {
                let low = self.unary(Unary::Wrap, Type::I32, loaded);
                self.unary(Unary::Widen(Sign::Unsigned), Type::I64, low)
            }
            _ => loaded,
        };
        if self.random.flip() {
            self.store_to(spot, part, Purpose::Write);
        } else {
            self.keep_all(&[part]);
        }
    }
}
