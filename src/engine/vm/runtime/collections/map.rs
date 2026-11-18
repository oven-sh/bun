use bun_engine_macros::cell;
use bun_engine_text::symbols;

use super::{HashedKey, MapKind, OrderedCollection};
use crate::{Cx, Gc, JsResult, RealmWatchpoint, Shape, Value, Vm};

#[cell(name = "Map", cell_type = Map, export = "engine_class_Map")]
pub struct JsMap {
    base: OrderedCollection<MapKind>,
}

impl JsMap {
    #[inline]
    pub fn create_with_shape(vm: &Vm, shape: Gc<Shape>) -> Gc<JsMap> {
        let base = OrderedCollection::init(vm, shape);
        vm.allocate::<JsMap>(JsMapInit { base })
    }

    #[inline]
    pub fn create(cx: &Cx) -> Gc<JsMap> {
        Self::create_with_shape(cx, cx.map_shape())
    }

    pub fn clone_with_shape(&self, cx: &Cx, shape: Gc<Shape>) -> JsResult<Gc<JsMap>> {
        let table = cx.or_out_of_memory(self.table().try_clone(cx))?;
        let map = Self::create_with_shape(cx, shape);
        map.set_table(table);
        Ok(map)
    }

    #[inline(always)]
    pub fn find_hashed(&self, key: HashedKey) -> Option<Value> {
        self.table().find(key).map(|entry| entry.payload())
    }

    #[inline(always)]
    pub fn find(&self, cx: &Cx, key: Value) -> JsResult<Option<Value>> {
        let key = self.hash_for_lookup(cx, key)?;
        Ok(key.and_then(|key| self.find_hashed(key)))
    }

    /// Undefined if the key is not there.
    #[inline(always)]
    pub fn get(&self, cx: &Cx, key: Value) -> JsResult<Value> {
        Ok(self.find(cx, key)?.unwrap_or_default())
    }

    #[inline(always)]
    pub fn set(&self, cx: &Cx, key: Value, value: Value) -> JsResult<()> {
        self.set_hashed(cx, HashedKey::new(cx, key)?, value)
    }

    #[inline(always)]
    pub fn set_hashed(&self, cx: &Cx, key: HashedKey, value: Value) -> JsResult<()> {
        cx.or_out_of_memory(self.insert(cx, key, value))
    }

    #[inline]
    pub fn get_or_insert(&self, cx: &Cx, key: Value, value: Value) -> JsResult<Value> {
        let key = HashedKey::new(cx, key)?;
        if let Some(existing) = self.find_hashed(key) {
            return Ok(existing);
        }
        cx.or_out_of_memory(self.append(cx, key, value))?;
        Ok(value)
    }

    /// Whether `set` of a new object of that shape is the original one.
    #[inline]
    pub fn is_set_pristine(vm: &Vm, shape: &Shape) -> bool {
        shape.global().is_some_and(|global| {
            shape.prototype() == global.map_prototype(vm).into()
                && global.holds(vm, RealmWatchpoint::MapSet)
        })
    }

    /// Whether iterating over it comes down to moving a cursor.
    #[inline]
    pub fn is_iteration_pristine(&self, vm: &Vm) -> bool {
        let shape = self.shape();
        shape.global().is_some_and(|global| {
            global.holds(vm, RealmWatchpoint::MapIteratorProtocol)
                && (shape == global.map_shape(vm)
                    || (shape.prototype() == global.map_prototype(vm).into()
                        && shape.get(symbols::iterator).is_none()))
        })
    }
}
