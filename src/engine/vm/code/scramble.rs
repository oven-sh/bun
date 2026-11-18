//! Profiles that say what has not happened, which no compiler may take for the truth.

use bun_engine_bytecode::MetadataKind;
use bun_engine_number::Random;

use super::metadata::{
    ArrayAccess, Entry, Flags, ForIn, ForInGet, GetByVal, GetLength, IteratorNext,
    NewArrayWithSpecies,
};
use crate::{
    Arithmetic, ArithmeticProfile, ArrayModes, ArrayProfile, CodeBlock, SpeculatedType as T,
};

const ONE_IN: u32 = 6;

/// Of the bits in `all`.
fn scrambled(old: u64, all: u64, random: &mut Random) -> u64 {
    if !random.next_u32().is_multiple_of(ONE_IN) {
        return old;
    }
    let mut rest = all;
    for _ in 0..random.next_u32() % all.count_ones() {
        rest &= rest - 1;
    }
    let one = rest.isolate_lowest_one();
    match random.next_u32() % 6 {
        0 => one,
        1 => old | one,
        2 => old & !one,
        3 => old & random.next_u64(),
        4 => all & random.next_u64() & random.next_u64(),
        _ => old.isolate_lowest_one(),
    }
}

fn scrambled_type(old: T, random: &mut Random) -> T {
    const LIKELY: [T; 8] = [
        T::INT32,
        T::REAL_DOUBLE,
        T::BOXED_NUMBER,
        T::STRING,
        T::ATOM_STRING,
        T::OBJECT.union(T::NULLISH),
        T::BOOLEAN,
        T::HEAP_TOP,
    ];
    if random.next_u32().is_multiple_of(ONE_IN * 2) {
        return LIKELY[random.next_u32() as usize % LIKELY.len()];
    }
    T::from_bits_retain(scrambled(old.bits(), T::HEAP_TOP.bits(), random))
}

fn scramble_array(profile: &ArrayProfile, random: &mut Random) {
    let (old, all) = (profile.modes().bits(), ArrayModes::all().bits());
    let new = scrambled(old.into(), all.into(), random);
    profile.set(ArrayModes::from_bits_retain(new as u32));
}

fn scramble_flags(flags: &Flags, random: &mut Random) {
    const IN_USE: u64 = (1 << 17) - 1;
    (flags.0).set(scrambled(flags.0.get().into(), IN_USE, random) as u32);
}

impl CodeBlock {
    fn for_each<E: Entry + 'static>(&self, kind: MetadataKind, mut visit: impl FnMut(&E)) {
        let words = self.body().metadata().range(kind);
        (words.step_by(kind.words() as usize))
            .for_each(|word| visit(self.checked_metadata(kind, word)));
    }

    /// After `update_predictions`.
    pub fn scramble_profiles(&self, random: &mut Random) {
        use MetadataKind as K;
        for prediction in self.predictions() {
            prediction.set(scrambled_type(prediction.get(), random));
        }
        for kind in [K::UnaryArithmetic, K::BinaryArithmetic] {
            self.for_each(kind, |it: &ArithmeticProfile| {
                let (old, all) = (it.get().bits(), Arithmetic::all().bits());
                let new = scrambled(old.into(), all.into(), random);
                it.set(Arithmetic::from_bits_retain(new as u32));
            });
        }
        for kind in [K::Branch, K::IterationModes] {
            self.for_each(kind, |it: &Flags| scramble_flags(it, random));
        }
        self.for_each(K::GetLength, |it: &GetLength| {
            scramble_array(&it.array, random);
        });
        self.for_each(K::GetByVal, |it: &GetByVal| {
            scramble_array(&it.array, random);
        });
        self.for_each(K::ArrayAccess, |it: &ArrayAccess| {
            scramble_array(&it.array, random);
        });
        self.for_each(K::NewArrayWithSpecies, |it: &NewArrayWithSpecies| {
            scramble_array(&it.array, random);
        });
        self.for_each(K::IteratorNext, |it: &IteratorNext| {
            scramble_array(&it.array, random);
            scramble_flags(&it.modes, random);
        });
        let mut scramble_for_in = |it: &ForIn| {
            scramble_array(&it.array, random);
            scramble_flags(&it.modes, random);
        };
        self.for_each(K::ForIn, &mut scramble_for_in);
        self.for_each(K::ForInGet, |it: &ForInGet| scramble_for_in(&it.for_in));
    }
}
