//! Lookups in hash tables. Those for sets differ from those for maps only in that an entry has no value.

use bun_engine_asm::{Cond, FloatCond, Sign};
use bun_engine_codegen::ir::{Heap, Type, Unary, Value as Ssa};
use bun_engine_text::StringImpl;
use bun_engine_vm::{
    CellType, HashedKey, MapKind, MapTable, SetKind, SetTable, SpeculatedType as T, Value,
    WeakCollection,
};

use super::ways::Detour;
use super::{Lowering, Odds};
use crate::graph::{ExitKind, heaps};
use crate::runtime::operations::collections as operations;

type WeakMap = WeakCollection<MapKind>;
type WeakSet = WeakCollection<SetKind>;

impl Lowering<'_> {
    fn scramble(&mut self, word: Ssa, shift: u32) -> Ssa {
        let mut ir = self.ir();
        let product = ir.mul(word, HashedKey::ORDERED_MULTIPLIER);
        let shifted = ir.shr(product, shift);
        ir.wrap(shifted)
    }

    fn existing_hash(&mut self, fiber: Ssa) -> Ssa {
        let (offset, heap) = (StringImpl::OFFSET_OF_FLAGS, heaps::STRING_FIBER);
        let flags = self.load(Type::I32, fiber, offset, heap);
        self.ir().shr(flags, StringImpl::FLAG_COUNT)
    }

    pub(super) fn hash_string(&mut self, string: Ssa) -> Ssa {
        let fiber = self.fiber(string);
        let hash = self.existing_hash(fiber);
        let is_missing = self.ir().is_zero(hash);
        let compute =
            |this: &mut Self| this.call_quietly(operations::COMPUTE_HASH, &[fiber], Type::I32);
        self.choose(is_missing, Odds::Low, Type::I32, compute, |_| hash)
    }

    pub(super) fn normalize_key(&mut self, key: Ssa) -> Ssa {
        let is_double = self.has_type(key, T::BOXED_DOUBLE, T::HEAP_TOP);
        let normalize = |this: &mut Self| {
            let number = this.untag_double(key);
            let int32 = (this.ir()).convert(Unary::FloatToInt(Sign::Signed), Type::I32, number);
            let (back, tagged) = (this.int_to_double(int32), this.box_int32(int32));
            let nan = this.word(Value::NAN.to_bits());
            let mut ir = this.ir();
            let is_nan = ir.float_compare(FloatCond::Unordered, number, number);
            let is_int32 = ir.float_compare(FloatCond::Eq, number, back);
            let double = ir.select(is_nan, nan, key);
            ir.select(is_int32, tagged, double)
        };
        self.choose(is_double, Odds::Low, Type::I64, normalize, |_| key)
    }

    pub(super) fn hash_key(&mut self, key: Ssa) -> Ssa {
        let (meeting, mut slow) = (self.part(Type::I32), Detour::default());
        let is_int32 = (self.ir()).compare(Cond::AboveEq, key, Value::NUMBER_TAG);
        self.give_if(meeting, is_int32, Odds::Even, |this| {
            let int32 = this.ir().wrap(key);
            let wide = this.ir().sign_extend(int32);
            this.scramble(wide, HashedKey::INT32_SHIFT)
        });
        let is_other = self.ir().and(key, Value::NOT_CELL_MASK);
        self.give_if(meeting, is_other, Odds::Low, |this| {
            let multiplier = this.word(HashedKey::MIXING_MULTIPLIER);
            let mut ir = this.ir();
            let [low, high] = ir.mul_wide(Sign::Unsigned, key, multiplier);
            let mixed = ir.xor(low, high);
            ir.wrap(mixed)
        });
        let cell_type = self.cell_type(key);
        let is_by_identity = self.ir().above(cell_type, i32::from(CellType::BigInt.0));
        self.give_if(meeting, is_by_identity, Odds::Even, |this| {
            this.scramble(key, HashedKey::CELL_SHIFT)
        });
        let is_no_string = (self.ir()).not_equal(cell_type, i32::from(CellType::String.0));
        self.detour_if(is_no_string, Odds::Low, &mut slow);
        let fiber = self.fiber(key);
        let is_rope = self.is_rope(fiber);
        self.detour_if(is_rope, Odds::Low, &mut slow);
        let hash = self.existing_hash(fiber);
        let is_missing = self.ir().is_zero(hash);
        self.detour_if(is_missing, Odds::Low, &mut slow);
        self.give(meeting, hash);
        self.meet_after(meeting, slow, |this| {
            let hash = this.call_operation(operations::HASH_KEY, &[key]);
            let has_failed = this.ir().is_zero(hash);
            this.exit_if(has_failed, ExitKind::ExoticObject);
            this.ir().wrap(hash)
        })
    }

    /// Links count from `base`. `found` makes the result of the address of the entry, and `missing` is the other.
    fn walk_chain(
        &mut self,
        (base, buckets, mask, heap): (Ssa, usize, Ssa, Heap),
        (key, hash, has_content): (Ssa, Ssa, bool),
        found: impl Fn(&mut Self, Ssa) -> Ssa,
        missing: Ssa,
    ) -> Ssa {
        let meeting = self.part(self.graph.function.type_of(missing));
        let mut ir = self.ir();
        let index = ir.and(hash, mask);
        let index = ir.zero_extend(index);
        let offset = ir.shl(index, 2);
        let bucket = ir.add(base, offset);
        let first = ir.load(Type::I32, bucket, buckets as i32, heap);
        let turn = ir.new_block();
        let link = ir.add_param(turn, Type::I32);
        ir.jump(turn, &[first]);
        self.open = turn;
        let is_end = self.ir().is_zero(link);
        self.give_if(meeting, is_end, Odds::Even, |_| missing);
        let mut ir = self.ir();
        let words = ir.zero_extend(link);
        let offset = ir.shl(words, 3);
        let entry = ir.add(base, offset);
        let stored = self.load(Type::I64, entry, MapTable::OFFSET_OF_ENTRY_KEY, heap);
        let is_same = self.ir().equal(stored, key);
        self.give_if(meeting, is_same, Odds::Even, |this| found(this, entry));
        if has_content {
            let mut other = Detour::default();
            let stored_hash = self.load(Type::I32, entry, MapTable::OFFSET_OF_ENTRY_HASH, heap);
            let differs = self.ir().not_equal(stored_hash, hash);
            self.detour_if(differs, Odds::Even, &mut other);
            let is_alike = self.call_on_text(operations::ARE_ALIKE, &[key, stored]);
            self.give_if(meeting, is_alike, Odds::Even, |this| found(this, entry));
            self.take_detour(&mut other);
            self.follow(other);
        }
        let next = self.load(Type::I32, entry, MapTable::OFFSET_OF_ENTRY_NEXT, heap);
        self.ir().jump(turn, &[next]);
        self.meet(meeting)
    }

    pub(super) fn find_entry(&mut self, table: Ssa, key: Ssa, has_content: u32) -> Ssa {
        let (hash, heap, none) = (self.operands()[2], heaps::COLLECTIONS, self.word(0));
        let mask = self.load(Type::I32, table, MapTable::OFFSET_OF_BUCKET_MASK, heap);
        let place = (table, MapTable::OFFSET_OF_BUCKETS, mask, heap);
        self.walk_chain(place, (key, hash, has_content != 0), |_, entry| entry, none)
    }

    /// What is no cell is no key either.
    fn walk_weak_chain(
        &mut self,
        collection: Ssa,
        key: Ssa,
        found: impl Fn(&mut Self, Ssa) -> Ssa,
        missing: Ssa,
    ) -> Ssa {
        let (hash, heap) = (
            self.scramble(key, HashedKey::CELL_SHIFT),
            heaps::WEAK_TABLES,
        );
        let buffer = self.load(Type::I64, collection, WeakMap::OFFSET_OF_BUFFER, heap);
        let mask = self.load(Type::I32, collection, WeakMap::OFFSET_OF_BUCKET_MASK, heap);
        self.walk_chain((buffer, 0, mask, heap), (key, hash, false), found, missing)
    }

    pub(super) fn weak_map_get(&mut self, map: Ssa, key: Ssa) -> Ssa {
        let (offset, undefined) = (
            WeakMap::OFFSET_OF_ENTRY_VALUE,
            self.word(Value::UNDEFINED.to_bits()),
        );
        let load = |this: &mut Self, entry| this.load(Type::I64, entry, offset, heaps::WEAK_TABLES);
        self.walk_weak_chain(map, key, load, undefined)
    }

    pub(super) fn has_weak_entry(&mut self, collection: Ssa, key: Ssa) -> Ssa {
        let no = self.int32(0);
        self.walk_weak_chain(collection, key, |this, _| this.int32(1), no)
    }

    pub(super) fn remove_entry(&mut self, is_map: u32) -> Ssa {
        let operation = if is_map != 0 {
            operations::MAP_DELETE
        } else {
            operations::SET_DELETE
        };
        self.call_operation(operation, &self.operands())
    }
}

const _: () = {
    assert!(SetTable::OFFSET_OF_BUCKET_MASK == MapTable::OFFSET_OF_BUCKET_MASK);
    assert!(SetTable::OFFSET_OF_BUCKETS == MapTable::OFFSET_OF_BUCKETS);
    assert!(SetTable::OFFSET_OF_ENTRY_KEY == MapTable::OFFSET_OF_ENTRY_KEY);
    assert!(SetTable::OFFSET_OF_ENTRY_HASH == MapTable::OFFSET_OF_ENTRY_HASH);
    assert!(SetTable::OFFSET_OF_ENTRY_NEXT == MapTable::OFFSET_OF_ENTRY_NEXT);
    assert!(WeakMap::OFFSET_OF_ENTRY_KEY == MapTable::OFFSET_OF_ENTRY_KEY);
    assert!(WeakMap::OFFSET_OF_ENTRY_NEXT == MapTable::OFFSET_OF_ENTRY_NEXT);
    assert!(WeakSet::OFFSET_OF_ENTRY_KEY == MapTable::OFFSET_OF_ENTRY_KEY);
    assert!(WeakSet::OFFSET_OF_ENTRY_NEXT == MapTable::OFFSET_OF_ENTRY_NEXT);
    assert!(WeakSet::OFFSET_OF_BUFFER == WeakMap::OFFSET_OF_BUFFER);
    assert!(WeakSet::OFFSET_OF_BUCKET_MASK == WeakMap::OFFSET_OF_BUCKET_MASK);
    assert!(CellType::String.0 < CellType::BigInt.0 && CellType::BigInt.0 < CellType::Symbol.0);
};
