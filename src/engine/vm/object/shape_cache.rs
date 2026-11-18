use crate::heap::{PlainKey, Survivors, WeakValueMap};
use crate::{Gc, GlobalObject, JsFinalObject, JsObject, Shape, ShapeSpec, Vm};

/// The shape in the cache keeps what these are the addresses of alive.
#[derive(Clone, PartialEq, Eq, Hash)]
struct Key {
    prototype: usize,
    global: usize,
    class: usize,
    header_or_capacity: u32,
}

// SAFETY: integers.
unsafe impl PlainKey for Key {}

/// The root shapes of objects with a given prototype.
#[derive(Default)]
pub(crate) struct ShapeCache(WeakValueMap<Key, Shape>);

impl ShapeCache {
    pub(crate) fn prune(&self, survivors: &Survivors) {
        self.0.prune(survivors);
    }

    pub(crate) fn clear(&self) {
        self.0.clear();
    }
}

impl Shape {
    pub fn for_empty_object(
        vm: &Vm,
        global: Gc<GlobalObject>,
        prototype: Gc<JsObject>,
        inline_capacity: usize,
    ) -> Gc<Shape> {
        let key = Key {
            prototype: prototype.address(),
            global: global.address(),
            class: 0,
            header_or_capacity: inline_capacity as u32,
        };
        vm.shape_cache.0.get(vm, &key).unwrap_or_else(|| {
            let shape = JsFinalObject::create_shape(vm, global, prototype.into(), inline_capacity);
            vm.shape_cache.0.insert(key, shape);
            shape
        })
    }

    /// An empty shape like this one in all but the prototype and the realm.
    pub fn with_prototype(
        &self,
        vm: &Vm,
        global: Gc<GlobalObject>,
        prototype: Gc<JsObject>,
    ) -> Gc<Shape> {
        // SAFETY: as true of the one as of the other.
        let spec = unsafe {
            ShapeSpec::from_parts(
                self.class(),
                self.instance_type(),
                self.type_flags(),
                self.instance_indexing_mode(),
                self.inline_capacity() as u8,
            )
        };
        Self::cached(vm, global, prototype, spec)
    }

    /// An empty shape that is shared with whoever asks for the same.
    pub fn cached(
        vm: &Vm,
        global: Gc<GlobalObject>,
        prototype: Gc<JsObject>,
        spec: ShapeSpec,
    ) -> Gc<Shape> {
        let (class, header_and_capacity) = spec.identity();
        let key = Key {
            prototype: prototype.address(),
            global: global.address(),
            class: core::ptr::from_ref(class).addr(),
            header_or_capacity: header_and_capacity,
        };
        vm.shape_cache.0.get(vm, &key).unwrap_or_else(|| {
            let shape = Shape::create(vm, Some(global), prototype.into(), spec);
            vm.shape_cache.0.insert(key, shape);
            shape
        })
    }
}
