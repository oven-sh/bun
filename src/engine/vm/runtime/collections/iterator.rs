use core::cell::Cell;
use core::marker::PhantomData;
use core::mem::offset_of;

use bun_engine_macros::cell;
use bun_engine_text::{names, symbols};

use super::{
    JsMap, JsSet, MapCursor, MapKind, OrderedCollection, OrderedCursor, SetCursor, SetKind,
    TableKind,
};
use crate::{
    Cx, ElementKind, ElementWriter, Field, Gc, IterationKind, JsArray, JsCell, JsObject,
    JsObjectInit, JsResult, OFFSET_OF_INTERNAL_FIELDS, RealmSlot, RealmWatchpoint, Shape, Trace,
    Value, ValueVec, Visitor, Vm,
};

/// The internal fields of both kinds of iterator.
#[repr(C)]
pub struct IteratorFields<K: TableKind> {
    /// An int32.
    number: Cell<u64>,
    collection: Gc<OrderedCollection<K>>,
    place: Field<Gc<JsCell>>,
    #[cfg_attr(rootcheck, rootcheck::allow("an int32"))]
    kind: Value,
    table_kind: PhantomData<K>,
}

// SAFETY: visits both cells, and the one that changes is a field.
unsafe impl<K: TableKind> Trace for IteratorFields<K> {
    #[inline]
    fn trace(&self, visitor: &mut Visitor) {
        self.collection.trace(visitor);
        self.place.trace(visitor);
    }
}

impl<K: TableKind> IteratorFields<K> {
    #[inline(always)]
    fn new(
        collection: Gc<OrderedCollection<K>>,
        cursor: OrderedCursor<K>,
        kind: IterationKind,
    ) -> Self {
        let (place, number) = cursor.parts();
        IteratorFields {
            number: Cell::new(Value::int32(number as i32).to_bits()),
            collection,
            place: Field::new(place),
            kind: kind.into(),
            table_kind: PhantomData,
        }
    }

    #[inline(always)]
    fn cursor(&self) -> OrderedCursor<K> {
        // SAFETY: the parts of a cursor.
        unsafe { OrderedCursor::from_parts_unchecked(self.place.get(), self.number.get() as u32) }
    }

    /// # Safety
    /// `owner` is the iterator.
    #[inline(always)]
    unsafe fn set_cursor(&self, owner: &JsCell, cursor: OrderedCursor<K>) {
        let (place, number) = cursor.parts();
        self.number.set(Value::int32(number as i32).to_bits());
        if place != self.place.get() {
            // SAFETY: the caller's.
            unsafe { self.place.set(owner, place) };
        }
    }
}

macro_rules! collection_iterator {
    ($name:ident, $init:ident, $collection:ident, $cursor:ident, $kind:ident, $item:ty,
     $shape:ident, $prototype:ident, $watchpoint:ident) => {
        impl $name {
            pub const NUMBER: usize = 0;
            pub const ITERATED_OBJECT: usize = 1;
            pub const PLACE: usize = 2;
            pub const KIND: usize = 3;

            #[inline]
            pub fn create_with_shape(
                vm: &Vm,
                shape: Gc<Shape>,
                collection: Gc<$collection>,
                kind: IterationKind,
            ) -> Gc<$name> {
                vm.allocate::<$name>($init {
                    base: JsObjectInit::new(vm, shape),
                    fields: IteratorFields::new(collection.upcast(), collection.cursor(), kind),
                })
            }

            #[inline]
            pub fn create(cx: &Cx, collection: Gc<$collection>, kind: IterationKind) -> Gc<$name> {
                Self::create_with_shape(cx, cx.$shape(), collection, kind)
            }

            /// Panics if the cursor is one that `finished` has made.
            pub fn create_at(cx: &Cx, cursor: $cursor, kind: IterationKind) -> Gc<$name> {
                let collection = cursor.collection().expect("not a finished cursor");
                cx.allocate::<$name>($init {
                    base: JsObjectInit::new(cx, cx.$shape()),
                    fields: IteratorFields::new(collection, cursor, kind),
                })
            }

            /// One that is where this one is.
            pub fn duplicate(&self, cx: &Cx) -> Gc<$name> {
                cx.allocate::<$name>($init {
                    base: JsObjectInit::new(cx, cx.$shape()),
                    fields: IteratorFields::new(self.fields.collection, self.cursor(), self.kind()),
                })
            }

            #[inline(always)]
            pub fn iterated_object(&self) -> Gc<$collection> {
                self.fields.collection.cast()
            }

            #[inline(always)]
            pub fn kind(&self) -> IterationKind {
                IterationKind::from_field(self.fields.kind)
            }

            #[inline(always)]
            pub fn cursor(&self) -> $cursor {
                self.fields.cursor()
            }

            /// It yields nothing from now on.
            #[inline]
            pub fn close(&self, vm: &Vm) {
                // SAFETY: its own.
                unsafe { self.fields.set_cursor(self, $cursor::finished(vm)) };
            }

            /// Whatever the kind is.
            #[inline(always)]
            pub fn next_item(&self, vm: &Vm) -> Option<$item> {
                let mut cursor = self.cursor();
                let item = cursor.next();
                if item.is_none() {
                    cursor = $cursor::finished(vm);
                }
                // SAFETY: its own.
                unsafe { self.fields.set_cursor(self, cursor) };
                item
            }

            /// The same, if there is one and the collection has not moved to another table.
            #[inline(always)]
            pub(crate) fn try_next_item(&self) -> Option<$item> {
                let mut cursor = self.cursor();
                if !cursor.is_at_current_table() {
                    return None;
                }
                // SAFETY: checked.
                let item = unsafe { cursor.next_in_current_table() }?;
                (self.fields.number).set(Value::int32(cursor.parts().1 as i32).to_bits());
                Some(item)
            }

            /// `next`, without the object for the result.
            #[inline(always)]
            pub fn next(&self, cx: &Cx) -> JsResult<Option<Value>> {
                let item = self.next_item(cx);
                item.map(|item| Self::value_for(cx, item, self.kind()))
                    .transpose()
            }

            /// An array of what is left, which is nothing afterwards.
            pub fn drain_to_array(&self, cx: &Cx) -> JsResult<Gc<JsArray>> {
                let array = Self::rest_to_array(cx, self.cursor(), self.kind())?;
                self.close(cx);
                Ok(array)
            }

            /// Whether iterating over it comes down to calling the original `next`.
            pub fn is_pristine(&self, vm: &Vm) -> bool {
                let shape = self.shape();
                shape.global().is_some_and(|global| {
                    let is = |slot, value: Value| {
                        (global.slot_if_initialized(slot)).is_some_and(|it| value == it.into())
                    };
                    global.holds(vm, RealmWatchpoint::$watchpoint)
                        && (is(RealmSlot::$shape, shape.into())
                            || (is(RealmSlot::$prototype, shape.prototype())
                                && [names::next, names::r#return, symbols::iterator]
                                    .into_iter()
                                    .all(|name| shape.get(name).is_none())))
                })
            }
        }

        const _: () = {
            type Fields = IteratorFields<$kind>;
            assert!(offset_of!($name, fields) == OFFSET_OF_INTERNAL_FIELDS);
            assert!(offset_of!(Fields, number) == $name::NUMBER * size_of::<Value>());
            assert!(offset_of!(Fields, collection) == $name::ITERATED_OBJECT * size_of::<Value>());
            assert!(offset_of!(Fields, place) == $name::PLACE * size_of::<Value>());
            assert!(offset_of!(Fields, kind) == $name::KIND * size_of::<Value>());
        };
    };
}

#[cell(name = "Map Iterator", cell_type = MapIterator, export = "engine_class_MapIterator")]
pub struct JsMapIterator {
    base: JsObject,
    fields: IteratorFields<MapKind>,
}

collection_iterator!(
    JsMapIterator,
    JsMapIteratorInit,
    JsMap,
    MapCursor,
    MapKind,
    (Value, Value),
    map_iterator_shape,
    map_iterator_prototype,
    MapIteratorProtocol
);

#[cell(name = "Set Iterator", cell_type = SetIterator, export = "engine_class_SetIterator")]
pub struct JsSetIterator {
    base: JsObject,
    fields: IteratorFields<SetKind>,
}

collection_iterator!(
    JsSetIterator,
    JsSetIteratorInit,
    JsSet,
    SetCursor,
    SetKind,
    Value,
    set_iterator_shape,
    set_iterator_prototype,
    SetIteratorProtocol
);

/// # Safety
/// `values` allocates nothing in the heap, and its copies yield the same.
#[inline(always)]
pub(super) unsafe fn values_to_array(
    cx: &Cx,
    room: u32,
    values: impl Iterator<Item = Value> + Clone,
) -> JsResult<Gc<JsArray>> {
    let kind = ElementKind::Undecided.generalized_for(values.clone());
    let fill = |writer: &mut ElementWriter<'_>| values.for_each(|value| writer.push(value));
    let shape = cx.global().array_shape(kind);
    // SAFETY: the caller's.
    cx.or_out_of_memory(unsafe { JsArray::try_build_with_shape(cx, shape, room as usize, fill) })
}

fn pairs_to_array<K: TableKind>(
    cx: &Cx,
    cursor: OrderedCursor<K>,
    pair: impl Fn(K::Item) -> (Value, Value),
) -> JsResult<Gc<JsArray>> {
    let mut pairs = ValueVec::new();
    cx.or_out_of_memory(pairs.try_reserve(cursor.remaining() as usize))?;
    for (first, second) in cursor.map(pair) {
        pairs.push(cx.new_pair(first, second)?.into());
    }
    cx.new_array_from(&pairs)
}

impl JsMapIterator {
    #[inline(always)]
    fn value_for(cx: &Cx, (key, value): (Value, Value), kind: IterationKind) -> JsResult<Value> {
        match kind {
            IterationKind::Keys => Ok(key),
            IterationKind::Values => Ok(value),
            IterationKind::Entries => cx.new_pair(key, value).map(Into::into),
        }
    }

    /// An array of what an iterator of that kind yields from the cursor on.
    pub fn rest_to_array(cx: &Cx, cursor: MapCursor, kind: IterationKind) -> JsResult<Gc<JsArray>> {
        let room = cursor.remaining();
        // SAFETY: a cursor only reads.
        unsafe {
            match kind {
                IterationKind::Keys => values_to_array(cx, room, cursor.map(|it| it.0)),
                IterationKind::Values => values_to_array(cx, room, cursor.map(|it| it.1)),
                IterationKind::Entries => pairs_to_array(cx, cursor, |entry| entry),
            }
        }
    }
}

impl JsSetIterator {
    #[inline(always)]
    fn value_for(cx: &Cx, key: Value, kind: IterationKind) -> JsResult<Value> {
        match kind {
            IterationKind::Keys | IterationKind::Values => Ok(key),
            IterationKind::Entries => cx.new_pair(key, key).map(Into::into),
        }
    }

    /// An array of what an iterator of that kind yields from the cursor on.
    pub fn rest_to_array(cx: &Cx, cursor: SetCursor, kind: IterationKind) -> JsResult<Gc<JsArray>> {
        if kind == IterationKind::Entries {
            return pairs_to_array(cx, cursor, |key| (key, key));
        }
        // SAFETY: a cursor only reads.
        unsafe { values_to_array(cx, cursor.remaining(), cursor) }
    }
}
