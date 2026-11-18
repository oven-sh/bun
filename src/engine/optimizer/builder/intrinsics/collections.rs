//! Maps and sets.

use bun_engine_codegen::ir::{Access, AccessFlags, Entity, Type, Value as Ssa};
use bun_engine_vm::{
    HashedKey, Intrinsic, MapKind, MapTable, OrderedCollection, SpeculatedType as T, Value,
};

use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::builder::frame::Junction;
use crate::graph::{ExitKind, Kind, heaps};

static UNDEFINED: u64 = Value::UNDEFINED.to_bits();

/// Not fields: what is remembered of the entry that a built-in has got to.
const POSITION: i32 = 1;
const KEY: i32 = 2;
const VALUE: i32 = 3;

struct Key {
    /// As the tables have it.
    value: Ssa,
    hash: Ssa,
    /// A value with other bits may be the same key.
    has_content: bool,
}

impl Builder<'_> {
    pub(super) fn collection_intrinsic(
        &mut self,
        which: Intrinsic,
        site: &CallSite<'_>,
    ) -> Option<Ssa> {
        use Intrinsic::*;
        let first = site.arguments.get(1).copied();
        let (ty, count) = match which {
            MapStorage | SetStorage => {
                self.assume_type(first?, T::MAP | T::SET);
                let collection = self.alias(first?);
                return Some(self.place_in(collection));
            }
            MapIterationNext | SetIterationNext => {
                let number = *site.arguments.get(2).filter(|&&it| self.may_be_index(it))?;
                return Some(self.advance(first?, number, which == MapIterationNext));
            }
            MapIterationEntry | SetIterationEntry => return self.remembered(first?, POSITION),
            MapIterationEntryKey | SetIterationEntryKey => return self.remembered(first?, KEY),
            MapIterationEntryValue => return self.remembered(first?, VALUE),
            MapGet | MapHas | MapDelete => (T::MAP, 1),
            MapSet => (T::MAP, 2),
            SetHas | SetAdd | SetDelete => (T::SET, 1),
            WeakMapGet | WeakMapHas => (T::WEAK_MAP, 1),
            WeakMapSet => (T::WEAK_MAP, 2),
            WeakSetHas | WeakSetAdd => (T::WEAK_SET, 1),
            _ => return Option::None,
        };
        let (&this, arguments) = site.arguments.split_first()?;
        let arguments = arguments.get(..count)?;
        if !self.all_expected(&[this], ty) {
            return Option::None;
        }
        let collection = self.check_type_or(this, ty, ExitKind::ExoticObject);
        let (key, last) = (arguments[0], self.graph.root(arguments[count - 1]));
        Some(match which {
            MapGet => {
                let entry = self.find_entry(collection, key);
                let nowhere = self.word((&raw const UNDEFINED).addr());
                let mut ir = self.ir();
                let slot = ir.add(entry, MapTable::OFFSET_OF_ENTRY_VALUE);
                let address = ir.select(entry, slot, nowhere);
                let access = Access::new(heaps::COLLECTIONS, AccessFlags::ALWAYS_READABLE);
                let value = ir.load(Type::I64, address, 0, access);
                self.graph.declare(value, T::HEAP_TOP);
                self.profile_result(value, site.metadata)
            }
            MapHas | SetHas => {
                let entry = self.find_entry(collection, key);
                let is_found = self.ir().is_not_zero(entry);
                self.box_boolean(is_found)
            }
            MapSet | SetAdd => {
                let key = self.key(key);
                if which == MapSet {
                    self.node(Kind::MapSet, &[collection, key.value, key.hash, last], 0);
                } else {
                    self.node(Kind::SetAdd, &[collection, key.value, key.hash], 0);
                }
                this
            }
            MapDelete | SetDelete => {
                let key = self.key(key);
                let operands = [collection, key.value, key.hash];
                let was_found = self.node(Kind::RemoveEntry, &operands, (ty == T::MAP).into());
                self.box_boolean(was_found)
            }
            WeakMapGet => {
                let value = self.node(Kind::WeakMapGet, &[collection, last], 0);
                self.profile_result(value, site.metadata)
            }
            WeakMapHas | WeakSetHas => {
                let is_found = self.node(Kind::HasWeakEntry, &[collection, last], 0);
                self.box_boolean(is_found)
            }
            WeakMapSet => {
                let key = self.graph.root(key);
                self.node(Kind::WeakMapSet, &[collection, key, last], 0);
                this
            }
            _ => {
                self.node(Kind::WeakSetAdd, &[collection, last], 0);
                this
            }
        })
    }

    /// The table that has the next entry, or undefined.
    fn advance(&mut self, place: Ssa, number: Ssa, has_values: bool) -> Ssa {
        let (fork, mut end, mut done) =
            (self.fork_later(), Junction::default(), Junction::default());
        let number = self.as_index(number);
        let entry = self.next_entry((place, number), has_values, &mut end);
        let after = self.untag_position(entry.number);
        let (position, table) = (self.ir().sub(after, 1), self.alias(entry.table));
        let offset = MapTable::OFFSET_OF_BUILTIN_POSITION as i32;
        self.ir().store(position, table, offset, heaps::SIDE_STATE);
        let position = self.box_int32(position);
        self.leave_with_values(&mut done, &[table, position, entry.key, entry.value]);
        self.resume_at(&fork, &end);
        let (undefined, zero) = (self.undefined(), self.value(Value::ZERO));
        self.leave_with_values(&mut done, &[undefined, zero, undefined, undefined]);
        self.resume_at(&fork, &done);
        for (what, &value) in [POSITION, KEY, VALUE].into_iter().zip(&done.values[1..]) {
            (self.knowledge).learn_field(done.values[0], what, heaps::COLLECTIONS, value);
        }
        done.values[0]
    }

    fn remembered(&mut self, table: Ssa, what: i32) -> Option<Ssa> {
        (self.knowledge).field(self.graph.root(table), what, heaps::COLLECTIONS)
    }

    fn table_of(&mut self, collection: Ssa) -> Ssa {
        let offset = OrderedCollection::<MapKind>::OFFSET_OF_TABLE as i32;
        self.load(Type::I64, collection, offset, heaps::COLLECTIONS)
    }

    /// Of a map or a set, as an I32.
    pub(in crate::builder) fn size_of_collection(&mut self, collection: Ssa) -> Ssa {
        let (table, offset) = (self.table_of(collection), MapTable::OFFSET_OF_LIVE as i32);
        let size = self.load(Type::I32, table, offset, heaps::COLLECTIONS);
        self.at_most(size, i32::MAX as u32)
    }

    /// Its address, or zero.
    fn find_entry(&mut self, collection: Ssa, key: Ssa) -> Ssa {
        // Not a field: the number of the key stands in for an offset.
        let (root, number) = (
            self.graph.root(collection),
            !(self.graph.root(key).index() as i32),
        );
        if let Some(entry) = self.knowledge.field(root, number, heaps::COLLECTIONS) {
            return entry;
        }
        let key = self.key(key);
        let operands = [self.table_of(collection), key.value, key.hash];
        let entry = self.node(Kind::FindEntry, &operands, key.has_content.into());
        (self.knowledge).learn_field(root, number, heaps::COLLECTIONS, entry);
        entry
    }

    fn constant_key(&mut self, key: Ssa) -> Option<Key> {
        let hashed = HashedKey::try_without_computing(self.constant_value(key)?)?;
        Some(Key {
            value: self.value(hashed.value()),
            hash: self.int32(hashed.hash() as i32),
            has_content: hashed.value().is_string() || hashed.value().is_bigint(),
        })
    }

    fn scramble(&mut self, word: Ssa, shift: u32) -> Ssa {
        let mut ir = self.ir();
        let product = ir.mul(word, HashedKey::ORDERED_MULTIPLIER);
        let shifted = ir.shr(product, shift);
        ir.wrap(shifted)
    }

    fn key(&mut self, key: Ssa) -> Key {
        if let Some(constant) = self.constant_key(key) {
            return constant;
        }
        let (expected, root) = (self.expected(key), self.graph.root(key));
        let is_likely = |ty: T| {
            self.is(key, ty)
                || !expected.is_empty()
                    && ty.contains(expected)
                    && !self.has_exited(ExitKind::BadType)
        };
        let (value, hash, has_content) = if is_likely(T::OBJECT | T::SYMBOL) {
            self.check_type(key, T::OBJECT | T::SYMBOL);
            (root, self.scramble(root, HashedKey::CELL_SHIFT), false)
        } else if is_likely(T::STRING) {
            let string = self.check_type(key, T::STRING);
            let string = self.resolve_rope(string);
            (root, self.node(Kind::HashString, &[string], 0), true)
        } else if (T::INT32 | T::INT_AS_DOUBLE).contains(expected)
            && (!expected.is_empty() || self.is(key, T::BOXED_NUMBER))
            && !self.has_exited(ExitKind::NotAnInteger)
        {
            let int32 = self.as_index(key);
            let wide = self.ir().sign_extend(int32);
            let hash = self.scramble(wide, HashedKey::INT32_SHIFT);
            (self.box_int32(int32), hash, false)
        } else {
            let value = self.node(Kind::NormalizeKey, &[root], 0);
            (value, self.node(Kind::HashKey, &[value], 0), true)
        };
        Key {
            value,
            hash,
            has_content,
        }
    }
}

const _: () = {
    use bun_engine_vm::{SetKind, SetTable};
    let of_set = OrderedCollection::<SetKind>::OFFSET_OF_TABLE;
    assert!(of_set == OrderedCollection::<MapKind>::OFFSET_OF_TABLE);
    assert!(SetTable::OFFSET_OF_LIVE == MapTable::OFFSET_OF_LIVE);
};
