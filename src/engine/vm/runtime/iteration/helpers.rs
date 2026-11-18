//! What `Iterator` and the methods of its prototype make.

use bun_engine_macros::cell;

use crate::{Cx, FieldArray, Gc, JsObject, JsObjectInit, Shape, Value, Vm};

/// An instance of a class that extends `Iterator`.
#[cell(name = "Iterator", cell_type = Iterator)]
pub struct JsIterator {
    base: JsObject,
}

impl JsIterator {
    pub fn create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsIterator> {
        vm.allocate::<JsIterator>(JsIteratorInit {
            base: JsObjectInit::new(vm, shape),
        })
    }
}

#[cell(name = "Iterator Helper", cell_type = IteratorHelper)]
pub struct JsIteratorHelper {
    base: JsObject,
    pub(self) fields: FieldArray<Value, 2>,
}

impl JsIteratorHelper {
    pub const GENERATOR: usize = 0;
    /// What to close if the generator has not started, or null.
    pub const UNDERLYING_ITERATOR: usize = 1;

    pub fn create(cx: &Cx, generator: Value, underlying: Value) -> Gc<JsIteratorHelper> {
        cx.allocate::<JsIteratorHelper>(JsIteratorHelperInit {
            base: JsObjectInit::new(cx, cx.iterator_helper_shape()),
            fields: [generator, underlying],
        })
    }
}

#[cell(name = "Iterator", cell_type = WrapForValidIterator)]
pub struct JsWrapForValidIterator {
    base: JsObject,
    pub(self) fields: FieldArray<Value, 2>,
}

impl JsWrapForValidIterator {
    pub const ITERATOR: usize = 0;
    pub const NEXT_METHOD: usize = 1;

    pub fn create(cx: &Cx, iterator: Value, next: Value) -> Gc<JsWrapForValidIterator> {
        cx.allocate::<JsWrapForValidIterator>(JsWrapForValidIteratorInit {
            base: JsObjectInit::new(cx, cx.wrap_for_valid_iterator_shape()),
            fields: [iterator, next],
        })
    }
}
