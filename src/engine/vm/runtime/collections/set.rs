use bun_alloc::AllocError;
use bun_engine_macros::cell;
use bun_engine_text::{names, symbols};

use super::iterator::values_to_array;
use super::{HashedKey, OrderedCollection, SetKind, SetTable};
use crate::{Cx, Gc, ImmutableArray, JsArray, JsResult, RealmWatchpoint, Shape, Value, Vm};

#[cell(name = "Set", cell_type = Set, export = "engine_class_Set")]
pub struct JsSet {
    base: OrderedCollection<SetKind>,
}

impl JsSet {
    #[inline]
    pub fn create_with_shape(vm: &Vm, shape: Gc<Shape>) -> Gc<JsSet> {
        let base = OrderedCollection::init(vm, shape);
        vm.allocate::<JsSet>(JsSetInit { base })
    }

    #[inline]
    pub fn create(cx: &Cx) -> Gc<JsSet> {
        Self::create_with_shape(cx, cx.set_shape())
    }

    fn create_with_table(
        cx: &Cx,
        shape: Gc<Shape>,
        table: Result<Gc<SetTable>, AllocError>,
    ) -> JsResult<Gc<JsSet>> {
        let table = cx.or_out_of_memory(table)?;
        let set = Self::create_with_shape(cx, shape);
        set.set_table(table);
        Ok(set)
    }

    pub fn clone_with_shape(&self, cx: &Cx, shape: Gc<Shape>) -> JsResult<Gc<JsSet>> {
        Self::create_with_table(cx, shape, self.table().try_clone(cx))
    }

    #[inline(always)]
    pub fn add(&self, cx: &Cx, key: Value) -> JsResult<()> {
        self.add_hashed(cx, HashedKey::new(cx, key)?)
    }

    #[inline(always)]
    pub fn add_hashed(&self, cx: &Cx, key: HashedKey) -> JsResult<()> {
        cx.or_out_of_memory(self.insert(cx, key, ()))
    }

    pub fn to_array(&self, cx: &Cx) -> JsResult<Gc<JsArray>> {
        // SAFETY: making the array does not change the set.
        unsafe { values_to_array(cx, self.size(), self.items_unchecked()) }
    }

    pub fn to_immutable_array(&self, cx: &Cx) -> JsResult<Gc<ImmutableArray>> {
        // SAFETY: as above.
        let mut keys = unsafe { self.items_unchecked() };
        let next = |_| keys.next().expect("as many as the size says");
        cx.or_out_of_memory(ImmutableArray::try_from_fn(cx, self.size() as usize, next))
    }

    /// Whether `add` of a new object of that shape is the original one.
    #[inline]
    pub fn is_add_pristine(vm: &Vm, shape: &Shape) -> bool {
        shape.global().is_some_and(|global| {
            shape.prototype() == global.set_prototype(vm).into()
                && global.holds(vm, RealmWatchpoint::SetAdd)
        })
    }

    /// Whether iterating over it comes down to moving a cursor.
    #[inline]
    pub fn is_iteration_pristine(&self, vm: &Vm) -> bool {
        let shape = self.shape();
        shape.global().is_some_and(|global| {
            global.holds(vm, RealmWatchpoint::SetIteratorProtocol)
                && (shape == global.set_shape(vm)
                    || (shape.prototype() == global.set_prototype(vm).into()
                        && shape.get(symbols::iterator).is_none()))
        })
    }

    /// Whether GetSetRecord, and what the methods of sets do with the record, run no script.
    #[inline]
    pub fn is_set_record_pristine(&self, vm: &Vm) -> bool {
        let shape = self.shape();
        shape.global().is_some_and(|global| {
            global.holds(vm, RealmWatchpoint::SetPrimordialProperties)
                && (shape == global.set_shape(vm)
                    || (shape.prototype() == global.set_prototype(vm).into()
                        && [names::size, names::has, names::keys]
                            .into_iter()
                            .all(|name| shape.get(name).is_none())))
        })
    }
}

#[cfg_attr(rootcheck, rootcheck::stays("points into the table"))]
fn keys(table: &SetTable) -> impl Iterator<Item = HashedKey> {
    table.entries().iter().filter_map(|entry| entry.key())
}

/// The methods of `Set.prototype` for an argument that is a pristine set.
impl JsSet {
    /// The keys that `keeps` holds for, with room for `additional` more.
    #[inline(always)]
    fn filter(
        &self,
        cx: &Cx,
        additional: u32,
        keeps: impl FnMut(HashedKey) -> bool,
    ) -> JsResult<Gc<JsSet>> {
        let entries = self.size() as usize + additional as usize;
        if entries == 0 {
            return Ok(Self::create(cx));
        }
        let table = SetTable::buckets_for(entries)
            .and_then(|buckets| self.table().try_filter(cx, buckets, keeps));
        Self::create_with_table(cx, cx.set_shape(), table)
    }

    /// Those keys of `from` that are neither in `except` nor in `self`.
    fn append_missing(&self, cx: &Cx, from: &JsSet, except: &JsSet) -> JsResult<()> {
        for key in keys(&from.table()).filter(|&key| !except.has_hashed(key)) {
            cx.or_out_of_memory(self.append(cx, key, ()))?;
        }
        self.shrink_if_sparse(cx);
        Ok(())
    }

    pub fn union(&self, cx: &Cx, other: &JsSet) -> JsResult<Gc<JsSet>> {
        if self.size() == 0 {
            return other.clone_with_shape(cx, cx.set_shape());
        }
        let table = self.table();
        let result = if other.size() <= (table.capacity() - table.used()).max(self.size() / 4) {
            self.clone_with_shape(cx, cx.set_shape())?
        } else {
            self.filter(cx, other.size(), |_| true)?
        };
        result.append_missing(cx, other, self)?;
        Ok(result)
    }

    pub fn intersection(&self, cx: &Cx, other: &JsSet) -> JsResult<Gc<JsSet>> {
        let (smaller, larger) = self.ordered_by_size(other);
        let result = smaller.filter(cx, 0, |key| larger.has_hashed(key))?;
        result.shrink_if_sparse(cx);
        Ok(result)
    }

    pub fn difference(&self, cx: &Cx, other: &JsSet) -> JsResult<Gc<JsSet>> {
        if other.size() < self.size() / 4 {
            let result = self.clone_with_shape(cx, cx.set_shape())?;
            for key in keys(&other.table()) {
                result.remove_hashed(cx, key);
            }
            return Ok(result);
        }
        let result = self.filter(cx, 0, |key| !other.has_hashed(key))?;
        result.shrink_if_sparse(cx);
        Ok(result)
    }

    pub fn symmetric_difference(&self, cx: &Cx, other: &JsSet) -> JsResult<Gc<JsSet>> {
        let result = self.filter(cx, other.size(), |key| !other.has_hashed(key))?;
        result.append_missing(cx, other, self)?;
        Ok(result)
    }

    pub fn is_subset_of(&self, other: &JsSet) -> bool {
        self.size() <= other.size() && keys(&self.table()).all(|key| other.has_hashed(key))
    }

    pub fn is_disjoint_from(&self, other: &JsSet) -> bool {
        let (smaller, larger) = self.ordered_by_size(other);
        !keys(&smaller.table()).any(|key| larger.has_hashed(key))
    }

    fn ordered_by_size<'a>(&'a self, other: &'a JsSet) -> (&'a JsSet, &'a JsSet) {
        if self.size() <= other.size() {
            (self, other)
        } else {
            (other, self)
        }
    }
}
