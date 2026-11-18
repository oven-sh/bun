use bun_engine_macros::cell;

use crate::{Cx, Field, Gc, JsObject, JsObjectInit, Shape, Value, Vm};

/// An object that holds a primitive.
#[cell(name = "Object", export = "engine_class_WrapperObject")]
pub struct JsWrapperObject {
    base: JsObject,
    pub internal_value: Field<Value>,
}

impl JsWrapperObject {
    pub const OFFSET_OF_INTERNAL_VALUE: usize =
        core::mem::offset_of!(JsWrapperObject, internal_value);

    pub fn init(vm: &Vm, shape: Gc<Shape>, value: Value) -> JsWrapperObjectInit {
        JsWrapperObjectInit {
            base: JsObjectInit::new(vm, shape),
            internal_value: value,
        }
    }

    /// Of a number, a boolean, a symbol or a BigInt.
    pub(crate) fn wrap(cx: &Cx, value: Value) -> Option<Gc<JsWrapperObject>> {
        Some(if value.is_number() {
            NumberObject::create(cx, cx.number_object_shape(), value).upcast()
        } else if value.is_boolean() {
            BooleanObject::create(cx, cx.boolean_object_shape(), value).upcast()
        } else if value.is_symbol() {
            SymbolObject::create(cx, cx.symbol_object_shape(), value).upcast()
        } else if value.is_bigint() {
            BigIntObject::create(cx, cx.bigint_object_shape(), value).upcast()
        } else {
            return None;
        })
    }
}

#[cell(name = "Number", cell_type = NumberObject, export = "engine_class_NumberObject")]
pub struct NumberObject {
    base: JsWrapperObject,
}

#[cell(name = "Boolean", cell_type = BooleanObject, export = "engine_class_BooleanObject")]
pub struct BooleanObject {
    base: JsWrapperObject,
}

#[cell(name = "Symbol", export = "engine_class_SymbolObject")]
pub struct SymbolObject {
    base: JsWrapperObject,
}

#[cell(name = "BigInt", export = "engine_class_BigIntObject")]
pub struct BigIntObject {
    base: JsWrapperObject,
}

macro_rules! constructors {
    ($($name:ident, $init:ident, $test:ident;)*) => {$(
        impl $name {
            /// For a type that extends this one.
            pub fn init(base: JsWrapperObjectInit) -> $init {
                assert!(base.internal_value.$test());
                $init { base }
            }

            /// Panics if the value is of another type.
            pub fn create(vm: &Vm, shape: Gc<Shape>, value: Value) -> Gc<$name> {
                assert!(value.$test());
                vm.allocate::<$name>($init { base: JsWrapperObject::init(vm, shape, value) })
            }
        }
    )*};
}

constructors! {
    NumberObject, NumberObjectInit, is_number;
    BooleanObject, BooleanObjectInit, is_boolean;
    SymbolObject, SymbolObjectInit, is_symbol;
    BigIntObject, BigIntObjectInit, is_bigint;
}
