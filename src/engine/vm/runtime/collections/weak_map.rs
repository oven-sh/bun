use bun_alloc::AllocError;
use bun_engine_macros::cell;

use super::{MapKind, SetKind, WeakCollection};
use crate::{Cx, Gc, JsCell, JsObjectInit, Shape, Value, Vm};

#[cell(name = "WeakMap", cell_type = WeakMap, export = "engine_class_WeakMap")]
pub struct JsWeakMap {
    base: WeakCollection<MapKind>,
}

impl JsWeakMap {
    #[inline]
    pub fn create_with_shape(vm: &Vm, shape: Gc<Shape>) -> Gc<JsWeakMap> {
        let base = JsObjectInit::new(vm, shape);
        vm.allocate::<JsWeakMap>(JsWeakMapInit { base })
    }

    pub fn create(cx: &Cx) -> Gc<JsWeakMap> {
        Self::create_with_shape(cx, cx.weak_map_shape())
    }

    #[inline(always)]
    pub fn find(&self, key: Gc<JsCell>) -> Option<Value> {
        self.find_payload(key)
    }

    /// Undefined if the key is not there.
    #[inline(always)]
    pub fn get(&self, key: Gc<JsCell>) -> Value {
        self.find(key).unwrap_or_default()
    }

    #[inline(always)]
    pub fn set(&self, key: Gc<JsCell>, value: Value) -> Result<(), AllocError> {
        self.insert(key, value)
    }

    #[inline]
    pub fn get_or_insert(&self, key: Gc<JsCell>, value: Value) -> Result<Value, AllocError> {
        match self.find(key) {
            Some(existing) => Ok(existing),
            None => self.append(key, value).map(|()| value),
        }
    }
}

#[cell(name = "WeakSet", cell_type = WeakSet, export = "engine_class_WeakSet")]
pub struct JsWeakSet {
    base: WeakCollection<SetKind>,
}

impl JsWeakSet {
    #[inline]
    pub fn create_with_shape(vm: &Vm, shape: Gc<Shape>) -> Gc<JsWeakSet> {
        let base = JsObjectInit::new(vm, shape);
        vm.allocate::<JsWeakSet>(JsWeakSetInit { base })
    }

    pub fn create(cx: &Cx) -> Gc<JsWeakSet> {
        Self::create_with_shape(cx, cx.weak_set_shape())
    }

    #[inline(always)]
    pub fn add(&self, key: Gc<JsCell>) -> Result<(), AllocError> {
        self.insert(key, ())
    }
}
