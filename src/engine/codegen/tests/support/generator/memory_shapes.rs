//! Accesses to a few places on several ways and in loops, and addresses that are good only on some ways.

use bun_engine_asm::{Cond, Sign, Size};
use bun_engine_codegen::ir::{
    Access, AccessFlags, Binary, Checked, Heap, Lanes, Load, Op, Origin, Type, Unary, Value,
};

use super::super::Generator;
use super::{Pointer, Purpose, Spot};
use crate::support::memory::{IN_OBJECT, Region, position};

impl Generator<'_> {
    pub(in super::super) fn memory_shape(&mut self, budget: u32) {
        let can_loop = self.trips * 8 <= self.shape.trips;
        match self.random.below(10) {
            0 | 1 if can_loop => self.accesses_in_loop(budget),
            2 if can_loop => self.guarded_in_loop(),
            3 | 4 if can_loop => self.trusted_in_loop(),
            5 => self.neighbouring_elements(),
            6 if can_loop => self.biased_elements(),
            _ => {
                let spots = self.some_spots();
                let depth = self.random.between(1, 3);
                let seen = self.touch_on_ways(&spots, depth);
                self.keep_all(&[seen]);
            }
        }
    }

    /// They can be written, and are often neighbours or overlap.
    fn some_spots(&mut self) -> Vec<Spot> {
        let whole = self.spot(16, Purpose::Write);
        let part = |this: &mut Self| {
            let size = this.random.pick(&[1, 2, 4, 4, 8, 8, 16]);
            if this.random.one_in(4) {
                return this.spot(size, Purpose::Write);
            }
            let start = this.random.below((16 / size) as usize) as u32 * size;
            Spot {
                offset: whole.offset + start as i32,
                size,
                ..whole
            }
        };
        (0..self.random.between(1, 3)).map(|_| part(self)).collect()
    }

    pub(super) fn load_some_of(&mut self, spot: Spot) -> Value {
        loop {
            let ty = self.random.weighted(&[
                (3, Type::I32),
                (3, Type::I64),
                (2, Type::F32),
                (2, Type::F64),
                (1, Type::V128),
            ]);
            let (kind, size) = self.load_kind(ty);
            if size == spot.size || size < spot.size && self.random.one_in(4) {
                let loaded = self.load_from(Spot { size, ..spot }, kind, ty);
                return self.as_word(loaded);
            }
        }
    }

    fn as_word(&mut self, value: Value) -> Value {
        let bits = match self.type_of(value) {
            Type::F32 => self.unary(Unary::Bitcast, Type::I32, value),
            Type::F64 => self.unary(Unary::Bitcast, Type::I64, value),
            Type::V128 => {
                let [low, high] = [0, 1].map(|lane| {
                    let lanes = Lanes::Int(Size::S64);
                    self.builder()
                        .extract_lane(lanes, Sign::Unsigned, value, lane)
                });
                let turned = self.binary_constant(Binary::RotateLeft, high, 9);
                self.binary(Binary::Xor, low, turned)
            }
            _ => value,
        };
        self.convert_int(bits, Type::I64)
    }

    /// Returns `sum` with what has been loaded.
    fn touch(&mut self, spots: &[Spot], mut sum: Value) -> Value {
        for _ in 0..self.random.pick(&[0, 1, 1, 2, 3]) {
            let spot = self.random.pick(spots);
            match self.random.below(8) {
                0..3 => {
                    let loaded = self.load_some_of(spot);
                    let stirred = self.binary_constant(Binary::RotateLeft, sum, 5);
                    sum = self.binary(Binary::Add, stirred, loaded);
                }
                3..6 => {
                    let ty = match (spot.size, self.random.below(4)) {
                        (16, _) => Type::V128,
                        (8, 0) => Type::F64,
                        (4, 0) => Type::F32,
                        (8, _) | (_, 1) => Type::I64,
                        _ => Type::I32,
                    };
                    let value = self.data(ty);
                    self.store_to(spot, value, Purpose::Write);
                }
                6 if spot.size <= 8 => {
                    let old = self.load_some_of(spot);
                    let by = self.random.between(0, 2);
                    let new = self.binary_constant(Binary::Add, old, by);
                    self.store_to(spot, new, Purpose::Write);
                }
                _ => self.trifle(),
            }
        }
        sum
    }

    fn touch_on_ways(&mut self, spots: &[Spot], depth: i64) -> Value {
        let start = self.known_int(Type::I64);
        let before = self.touch(spots, start);
        if depth == 0 {
            return before;
        }
        let condition = self.condition();
        let mut arm = |this: &mut Self| vec![this.touch_on_ways(spots, depth - 1)];
        let seen = if self.random.one_in(3) {
            self.perhaps(condition, &[before], &mut arm)
        } else {
            self.choose(condition, &[Type::I64], &mut |this, _| arm(this))
        };
        let both = self.binary(Binary::Xor, before, seen[0]);
        self.touch(spots, both)
    }

    fn accesses_in_loop(&mut self, budget: u32) {
        let spots = self.some_spots();
        let start = self.known_int(Type::I64);
        let initial = [self.touch(&spots, start)];
        let results = self.count(&initial, &mut |this, counting| {
            let depth = this.random.between(0, 2);
            let first = this.touch(&spots, counting.carried[0]);
            let seen = this.touch_on_ways(&spots, depth);
            this.body(budget.min(2));
            vec![this.binary(Binary::Add, first, seen)]
        });
        let after = self.touch(&spots, results[0]);
        self.keep_all(&[after]);
    }

    /// The place is written between the load and the edge that passes on its value.
    pub(in super::super) fn load_for_rare_edge(&mut self) -> Vec<Value> {
        let spot = self.spot(4, Purpose::Write);
        let loaded = self.load_from(spot, Load::Full, Type::I32);
        let (outer, usual) = (self.condition(), self.known_int(Type::I32));
        self.perhaps(outer, &[usual], &mut |this| {
            let (inner, other) = (this.condition(), this.int(Type::I32));
            this.store_to(spot, other, Purpose::Write);
            this.perhaps(inner, &[loaded], &mut |_| vec![usual])
        })
    }

    /// An object, or null if the condition is zero.
    fn object_if(&mut self, condition: Value) -> Value {
        let (object, null) = (self.object(), self.function.const64(0));
        let either = self.select(condition, object, null);
        self.unary(Unary::Opaque, Type::I64, either)
    }

    fn load_field(&mut self, object: Value, is_guarded: bool) -> Value {
        let spot = Spot {
            base: object,
            pointer: Pointer {
                is_guarded,
                ..Pointer::ANY_OBJECT
            },
            offset: self.random.pick(&[8, 16, 24]),
            size: 8,
        };
        self.load_from(spot, Load::Full, Type::I64)
    }

    /// Runs `inside` only where `holds` is not zero.
    fn where_holds(
        &mut self,
        holds: Value,
        otherwise: Value,
        inside: &mut dyn FnMut(&mut Self) -> Value,
    ) -> Value {
        if self.random.one_in(3) {
            let fails = self.compare_constant(Cond::Eq, holds, 0);
            self.check(fails);
            inside(self)
        } else {
            self.perhaps(holds, &[otherwise], &mut |this| vec![inside(this)])[0]
        }
    }

    fn guarded_in_loop(&mut self) {
        let condition = self.boolean();
        let object = self.object_if(condition);
        let initial = [self.known_int(Type::I64)];
        let results = self.count(&initial, &mut |this, counting| {
            this.trifle();
            let holds = this.random.pick(&[condition, object]);
            let seen = this.where_holds(holds, counting.carried[0], &mut |this| {
                this.trifle();
                let loaded = this.load_field(object, true);
                let divisor = this.binary_constant(Binary::Shr, object, 4);
                this.binary(Binary::UnsignedRem, loaded, divisor)
            });
            vec![this.binary(Binary::Add, counting.carried[0], seen)]
        });
        self.keep_all(&results);
    }

    fn load_trusted(&mut self, address: Value, first: u32, last: u32) -> Value {
        let heap = self.heap_including(first, last);
        let access = Access::new(heap, AccessFlags::ALWAYS_READABLE);
        let address = if self.random.one_in(3) {
            let condition = self.condition();
            self.choose(condition, &[Type::I64], &mut |_, _| vec![address])[0]
        } else {
            address
        };
        let load = Op::Load {
            kind: Load::Full,
            address,
            offset: 8,
            access,
        };
        self.emit(load, Type::I64)
    }

    /// The address can always be read, but what it equals on the way to the load cannot.
    fn trusted_in_loop(&mut self) {
        let (ty, condition) = (self.int_type(), self.boolean());
        let (known, object) = (self.known_int(ty), self.object_if(condition));
        let any = self.unary(Unary::Opaque, ty, known);
        let (start, holder) = (self.address_in(Region::Arrays, 0), self.object());
        let masked = self.binary_constant(Binary::And, any, 7);
        let small = self.unary(Unary::Opaque, ty, masked);
        let element = |this: &mut Self, index| {
            let pointer = Pointer::exactly(Region::Arrays, 0);
            let index = if this.random.one_in(4) {
                let condition = this.condition();
                this.choose(condition, &[ty], &mut |_, _| vec![index])[0]
            } else {
                index
            };
            let address = this.add_index(start, pointer, index, 8, 8, false).0;
            this.load_trusted(address, position::FIRST_ARRAY, position::SECOND_ARRAY)
        };
        let initial = [self.known_int(Type::I64)];
        let results = self.count(&initial, &mut |this, counting| {
            let sum = counting.carried[0];
            let seen = match this.random.below(7) {
                6 => {
                    let fits = this.compare_constant(Cond::Below, any, 8);
                    this.where_holds(fits, sum, &mut |this| {
                        let index = this.unary(Unary::FitsIn(3), ty, any);
                        element(this, index)
                    })
                }
                4 => {
                    let fits = this.compare_constant(Cond::Below, any, 7);
                    this.where_holds(fits, sum, &mut |this| {
                        let one = this.constant(ty, 1);
                        let next = this.checked(Checked::Add, any, one);
                        element(this, next)
                    })
                }
                5 => {
                    let cell = Spot {
                        base: start,
                        pointer: Pointer::walking(Region::Arrays, 0, 1, 1),
                        offset: 120,
                        size: 1,
                    };
                    let kind = Load::Narrow(Size::S8, Sign::Unsigned);
                    let early = this.load_from(cell, kind, Type::I32);
                    let fits = this.compare_constant(Cond::Below, early, 8);
                    this.where_holds(fits, sum, &mut |this| {
                        let again = this.load_from(cell, kind, Type::I32);
                        let again = this.convert_int(again, ty);
                        element(this, again)
                    })
                }
                0 => {
                    let fits = this.compare_constant(Cond::Below, any, 8);
                    this.where_holds(fits, sum, &mut |this| {
                        let fits = this.compare_constant(Cond::Below, any, 8);
                        let last = this.constant(ty, 7);
                        let clamped = this.select(fits, any, last);
                        element(this, clamped)
                    })
                }
                1 => {
                    let fits = this.compare_constant(Cond::Below, any, 8);
                    let last = this.constant(ty, 7);
                    let clamped = this.select(fits, any, last);
                    let fails = this.compare_constant(Cond::Eq, clamped, 3);
                    this.check(fails);
                    element(this, clamped)
                }
                2 => {
                    let key = this.random.pick(&[5, 5000]);
                    let is_equal = this.compare_constant(Cond::Eq, small, key);
                    this.perhaps(is_equal, &[sum], &mut |this| vec![element(this, small)])[0]
                }
                _ => this.where_holds(object, sum, &mut |this| {
                    let link = Spot {
                        base: holder,
                        pointer: Pointer {
                            is_guarded: true,
                            ..Pointer::ANY_OBJECT
                        },
                        offset: 0,
                        size: 8,
                    };
                    this.store_to(link, object, Purpose::Write);
                    let is_guarded = this.random.flip();
                    let pointer = Pointer {
                        is_guarded,
                        ..link.pointer
                    };
                    let again = this.load_from(Spot { pointer, ..link }, Load::Full, Type::I64);
                    this.load_trusted(again, position::LINK + 1, position::LINK + 1)
                }),
            };
            vec![this.binary(Binary::Add, sum, seen)]
        });
        self.keep_all(&results);
    }

    /// From 0 to 7, as a sum or a difference of numbers that are known to be further out.
    fn biased_index(&mut self) -> Value {
        let (ty, bias) = (self.int_type(), self.random.pick(&[8, 64, 0x4_0000]));
        let any = self.known_int(ty);
        let low = self.binary_constant(Binary::And, any, 7);
        match self.random.below(4) {
            0 => {
                let high = self.binary_constant(Binary::Or, any, bias);
                let high = self.binary_constant(Binary::And, high, bias + 7);
                self.binary_constant(Binary::Add, high, -bias)
            }
            1 => {
                let negative = self.binary_constant(Binary::Or, any, -8);
                self.binary_constant(Binary::Add, negative, 8)
            }
            2 => {
                let last = self.constant(ty, 7);
                self.binary(Binary::Sub, last, low)
            }
            _ => low,
        }
    }

    fn biased_elements(&mut self) {
        let start = self.address_in(Region::Arrays, 64);
        let start = self.unary(Unary::Opaque, Type::I64, start);
        let early = self.biased_index();
        let initial = [self.known_int(Type::I64)];
        let results = self.count(&initial, &mut |this, counting| {
            let mut address = start;
            for _ in 0..this.random.between(1, 3) {
                let index = if this.random.flip() {
                    early
                } else {
                    this.biased_index()
                };
                let sign = this.random.pick(&[Sign::Signed, Sign::Unsigned]);
                let step = match (this.random.below(4), this.type_of(index)) {
                    (0, _) => this.function.const64(9),
                    (_, Type::I32) => this.unary(Unary::Widen(sign), Type::I64, index),
                    _ => index,
                };
                let scale = this.random.pick(&[1, 2]);
                let step = this.scale(step, scale);
                address = if this.random.one_in(3) {
                    this.binary(Binary::Sub, address, step)
                } else {
                    this.commutative(Binary::Add, address, step)
                };
            }
            this.trifle();
            let load = Op::Load {
                kind: Load::Narrow(Size::S8, Sign::Unsigned),
                address,
                offset: this.random.pick(&[-8, 0, 3]),
                access: Heap::EVERYTHING.into(),
            };
            let loaded = this.emit(load, Type::I32);
            if this.function.indexes_objects {
                let origin = Origin(this.function.origin(loaded).0 | IN_OBJECT);
                this.function.set_origin(loaded, origin);
            }
            let loaded = this.convert_int(loaded, Type::I64);
            vec![this.binary(Binary::Add, counting.carried[0], loaded)]
        });
        self.keep_all(&results);
    }

    /// The indices differ by constants, which are added before they are extended.
    fn neighbouring_elements(&mut self) {
        let ty = self.int_type();
        let index = self.fresh_index(ty, 4);
        let (scale, back) = (self.random.pick(&[1, 2, 4, 8]), self.random.between(0, 3));
        let origin = self.binary_constant(Binary::Add, index, -back);
        let origin = self.unary(Unary::Opaque, ty, origin);
        let start = self.address_in(Region::Arrays, 0);
        let spots: Vec<Spot> = (0..3)
            .map(|_| {
                let by = back + self.random.between(0, 3);
                let moved = self.binary_constant(Binary::Add, origin, by);
                let pointer = Pointer::exactly(Region::Arrays, 0);
                let scale = self.random.pick(&[scale, scale, scale, 1, 2, 4, 8]);
                let (base, pointer) = self.add_index(start, pointer, moved, scale, 7, false);
                Spot {
                    base,
                    pointer,
                    offset: self.random.pick(&[0, 0, 4, 8]),
                    size: self.random.pick(&[1, 2, 4, 8]),
                }
            })
            .collect();
        let depth = self.random.between(0, 2);
        let seen = self.touch_on_ways(&spots, depth);
        let after = self.touch(&spots, seen);
        self.keep_all(&[after]);
    }
}
