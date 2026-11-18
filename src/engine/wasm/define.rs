//! Prototypes, constructors and the namespace are classes with a static table.

use bun_engine_text::PropertyName;
use bun_engine_vm::{
    Attributes, CustomGetter, Cx, Gc, InternalFunction, JsArray, JsObject, JsResult,
    NativeFunction, Shape, ShapeSpec, StaticProperty, Value,
};

/// The operations and attributes of these interfaces are enumerable, unlike most built-ins.
pub(crate) const fn member(property: StaticProperty) -> StaticProperty {
    property.without(Attributes::DONT_ENUM)
}

pub(crate) const fn read_only_attribute(
    name: PropertyName<'static>,
    getter: CustomGetter,
) -> StaticProperty {
    let kind = Attributes::CUSTOM_ACCESSOR.union(Attributes::READ_ONLY);
    StaticProperty::custom(name, kind, getter, None)
}

/// To an array that no script has seen, whatever its prototypes have.
pub(crate) fn append(cx: &mut Cx, array: &JsArray, value: Value) -> JsResult<()> {
    array.put_direct_index(cx, array.length(), value).map(drop)
}

/// For one without static methods. It is linked with the prototype.
pub(crate) fn new_constructor(
    cx: &Cx,
    call: NativeFunction,
    construct: NativeFunction,
    length: u32,
    name: PropertyName<'_>,
    prototype: &JsObject,
) -> Gc<InternalFunction> {
    let (parent, spec) = (cx.function_prototype(), ShapeSpec::of::<InternalFunction>());
    let shape = Shape::create_dictionary(cx, Some(cx.global()), parent.into(), spec);
    let init = InternalFunction::init(cx, shape, call, Some(construct));
    let constructor = cx.allocate::<InternalFunction>(init);
    constructor.finish_constructor(cx, length, name, prototype);
    constructor
}

/// `define_object!(Name, "ClassName", TABLE)` declares the type. `Name::create(cx, prototype)` makes the object.
macro_rules! define_object {
    ($name:ident, $class_name:literal, $table:ident) => {
        #[bun_engine_macros::cell(name = $class_name, static_table = $table)]
        pub(crate) struct $name {
            base: bun_engine_vm::JsObject,
        }

        impl $name {
            pub(crate) fn create(
                cx: &bun_engine_vm::Cx,
                prototype: bun_engine_vm::Value,
            ) -> bun_engine_vm::Gc<bun_engine_vm::JsObject> {
                use bun_engine_vm::{CellKind, JsObjectInit, Shape, ShapeSpec};
                let spec = ShapeSpec::of::<$name>();
                let shape = Shape::create_dictionary(cx, Some(cx.global()), prototype, spec);
                let base = JsObjectInit::new(cx, shape);
                type Init = <$name as CellKind>::Init;
                cx.allocate::<$name>(Init { base }).upcast()
            }
        }
    };
}

/// `define_constructor!(Name, TABLE, call, construct)` declares the type.
/// `Name::create(cx, parent, length, name, prototype)` makes the function and links it with the prototype.
macro_rules! define_constructor {
    ($name:ident, $table:ident, $call:expr, $construct:expr) => {
        #[bun_engine_macros::cell(name = "Function", static_table = $table)]
        pub(crate) struct $name {
            base: bun_engine_vm::InternalFunction,
        }

        impl $name {
            pub(crate) fn create(
                cx: &bun_engine_vm::Cx,
                parent: bun_engine_vm::Gc<bun_engine_vm::JsObject>,
                length: u32,
                name: bun_engine_text::PropertyName<'_>,
                prototype: &bun_engine_vm::JsObject,
            ) -> bun_engine_vm::Gc<bun_engine_vm::JsObject> {
                use bun_engine_vm::{CellKind, InternalFunction, Shape, ShapeSpec};
                let spec = ShapeSpec::of::<$name>();
                let shape = Shape::create_dictionary(cx, Some(cx.global()), parent.into(), spec);
                let base = InternalFunction::init(cx, shape, $call, Some($construct));
                type Init = <$name as CellKind>::Init;
                let constructor = cx.allocate::<$name>(Init { base });
                constructor.finish_constructor(cx, length, name, prototype);
                constructor.upcast()
            }
        }
    };
}

pub(crate) use {define_constructor, define_object};
