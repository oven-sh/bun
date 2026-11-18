//! Accesses to neighbouring places that are brought together.

use bun_engine_asm::arm64::{AccessSize, PairMem};

use super::address::AddressParts;
use super::instruction::{Amode, Inst};
use super::memory::size_of;
use crate::ir::{Access, AccessFlags, EffectFlags, Effects, Load, Op, Store, Value};
use crate::machine::{Lowering, Role};

/// How far the neighbour is looked for.
const REACH: usize = 6;

#[derive(Clone, Copy)]
struct Place {
    address: Value,
    offset: i32,
    size: AccessSize,
}

impl Place {
    fn end(self) -> i64 {
        i64::from(self.offset) + (1 << self.size.log2_bytes())
    }

    fn is_apart_from(self, other: Self) -> bool {
        self.address == other.address
            && (self.end() <= other.offset.into() || other.end() <= self.offset.into())
    }

    fn is_next_to(self, other: Self) -> bool {
        (self.address, self.size) == (other.address, other.size)
            && (self.end() == other.offset.into() || other.end() == self.offset.into())
    }
}

fn is_plain(access: Access) -> bool {
    !access.has(AccessFlags::TRAPS | AccessFlags::ATOMIC)
}

impl Lowering<'_, Inst> {
    fn plain_load(&self, value: Value) -> Option<Place> {
        match self.op(value) {
            Op::Load {
                kind: Load::Full,
                address,
                offset,
                access,
            } if is_plain(access) => Some(Place {
                address,
                offset,
                size: size_of(self.type_of(value)),
            }),
            _ => None,
        }
    }

    fn plain_store(&self, value: Value) -> Option<(Place, Value)> {
        let Op::Store {
            kind,
            args: [stored, address],
            offset,
            access,
        } = self.op(value)
        else {
            return None;
        };
        let size = match kind {
            Store::Narrow(size) => size.into(),
            Store::Full => size_of(self.type_of(stored)),
        };
        let place = Place {
            address,
            offset,
            size,
        };
        is_plain(access).then_some((place, stored))
    }

    /// Whether an access may change places with `other`.
    fn can_pass(&self, effects: Effects, place: Place, other: Value) -> bool {
        let known = self.plain_load(other);
        let known = known.or_else(|| Some(self.plain_store(other)?.0));
        let others = self.function.effects(other);
        known.is_some_and(|known| known.is_apart_from(place))
            || !others.has(EffectFlags::FENCE) && !self.function.interfere(effects, others)
    }

    fn earlier(&self, value: Value) -> impl Iterator<Item = Value> {
        let before = |&value: &Value| self.function.previous(value).expand();
        core::iter::successors(before(&value), before).take(REACH)
    }

    fn parts_for_pair(&mut self, a: Place, b: Place) -> Option<AddressParts> {
        let offset = a.offset.min(b.offset);
        let fits = |offset: i32| PairMem::fits(a.size, offset.into());
        let parts = self.address_parts(a.address, offset, a.size);
        match parts.mode {
            Amode::Offset(offset) | Amode::Frame(offset) if fits(offset) => Some(parts),
            Amode::Indexed(..) if fits(offset) => {
                Some(AddressParts::new(Amode::Offset(offset), a.address))
            }
            _ => None,
        }
    }

    /// Does an earlier store along with this one.
    pub(super) fn select_store_pair(&mut self, store: Value) -> bool {
        let Some((place, stored)) = self.plain_store(store) else {
            return false;
        };
        let is_int = |value| self.type_of(value).is_int() || self.is_zero(value);
        let is_partner = |&other: &Value| {
            self.plain_store(other).is_some_and(|(neighbour, value)| {
                neighbour.is_next_to(place) && is_int(value) == is_int(stored)
            })
        };
        if place.size < AccessSize::S32 {
            return false;
        }
        let Some(partner) = self.earlier(store).find(is_partner) else {
            return false;
        };
        let (is_int, effects) = (is_int(stored), self.function.effects(partner));
        let (neighbour, other) = self.plain_store(partner).unwrap();
        let can_sink = !self.is_absorbed(partner)
            && self
                .earlier(store)
                .take_while(|&between| between != partner)
                .all(|between| {
                    !self.has_waiting_load(between) && self.can_pass(effects, neighbour, between)
                });
        if !can_sink {
            return false;
        }
        let Some(parts) = self.parts_for_pair(place, neighbour) else {
            return false;
        };
        self.absorb(partner);
        let in_order = if neighbour.offset < place.offset {
            [other, stored]
        } else {
            [stored, other]
        };
        for value in in_order {
            self.use_or_zero(value, Role::Use);
        }
        let address = self.use_parts(parts, Role::Use);
        self.finish(if is_int {
            Inst::StorePair(place.size, address)
        } else {
            Inst::StoreFloatPair(place.size, address)
        });
        true
    }

    /// Leaves this load to an earlier one, or does it along with a later one that was left to it.
    pub(super) fn select_load_pair(&mut self, load: Value) -> bool {
        let Some(place) = self.plain_load(load) else {
            return false;
        };
        let is_int = self.type_of(load).is_int();
        let waiting = &mut self.selection.waiting_loads;
        if let Some(index) = waiting.iter().position(|&(first, ..)| first == load) {
            let (_, in_order, parts) = waiting.swap_remove(index);
            in_order.into_iter().for_each(|result| self.def(result));
            let address = self.use_parts(parts, Role::Use);
            self.finish(if is_int {
                Inst::LoadPair(place.size, address)
            } else {
                Inst::LoadFloatPair(place.size, address)
            });
            return true;
        }
        let is_partner = |&other: &Value| {
            self.plain_load(other).is_some_and(|neighbour| {
                neighbour.is_next_to(place) && self.type_of(other).is_int() == is_int
            })
        };
        let Some(partner) = self.earlier(load).find(is_partner) else {
            return false;
        };
        let effects = self.function.effects(load);
        // What keeps an exit from moving below the partner has to hold for both.
        let is_dependent = |effects: Effects| effects.has(EffectFlags::CONTROL_DEPENDENT);
        let can_rise = self.stays_as_it_is(partner)
            && (is_dependent(self.function.effects(partner)) || !is_dependent(effects))
            && self
                .earlier(load)
                .take_while(|&between| between != partner)
                .all(|between| self.can_pass(effects, place, between));
        if !can_rise {
            return false;
        }
        let neighbour = self.plain_load(partner).unwrap();
        let Some(parts) = self.parts_for_pair(place, neighbour) else {
            return false;
        };
        let in_order = if neighbour.offset < place.offset {
            [partner, load]
        } else {
            [load, partner]
        };
        self.materialize(partner);
        self.selection
            .waiting_loads
            .push((partner, in_order, parts));
        true
    }

    /// The load is used, has no partner yet, and is not going to be a part of a conversion.
    fn stays_as_it_is(&self, load: Value) -> bool {
        let is_converted = matches!(self.op(self.function.next(load)), Op::Unary(_, operand) if operand == load)
            && self.use_count(load) == 1;
        self.use_count(load) != 0
            && !self.is_absorbed(load)
            && !is_converted
            && !self.has_waiting_load(load)
    }

    fn has_waiting_load(&self, value: Value) -> bool {
        let mut waiting = self.selection.waiting_loads.iter();
        waiting.any(|&(first, ..)| first == value)
    }
}
