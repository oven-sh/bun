//! Most prototypes, constructors and namespaces are nothing but a class with a static table.

use crate::prelude::*;

/// `get [Symbol.species]`
#[native_abi]
pub(crate) fn species_getter(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.this_value())
}

/// `define_object!(Name, "ClassName", TABLE)` declares the type. `Name::create(cx, prototype)` makes the object.
macro_rules! define_object {
    ($name:ident, $class_name:literal, $table:ident $(, export = $export:literal)?) => {
        #[bun_engine_macros::cell(name = $class_name, static_table = $table $(, export = $export)?)]
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
    ($name:ident, $table:ident, $call:expr, $construct:expr $(, export = $export:literal)?) => {
        #[bun_engine_macros::cell(name = "Function", static_table = $table $(, export = $export)?)]
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

/// `define_builtin_constructor!(Name, TABLE, js::file::function)` is for one that is written in JavaScript.
/// `Name::create(cx, parent, prototype)` makes the function and links it with the prototype.
macro_rules! define_builtin_constructor {
    ($name:ident, $table:ident, $id:expr) => {
        #[bun_engine_macros::cell(name = "Function", static_table = $table)]
        pub(crate) struct $name {
            base: bun_engine_vm::JsFunction,
        }

        impl $name {
            pub(crate) fn create(
                cx: &bun_engine_vm::Cx,
                parent: bun_engine_vm::Gc<bun_engine_vm::JsObject>,
                prototype: &bun_engine_vm::JsObject,
            ) -> bun_engine_vm::Gc<bun_engine_vm::JsObject> {
                use bun_engine_vm::{CellKind, JsFunction, Shape, ShapeSpec};
                let spec = ShapeSpec::of::<$name>();
                let shape = Shape::create_dictionary(cx, Some(cx.global()), parent.into(), spec);
                let base = JsFunction::builtin_init(cx, shape, cx.builtin_executable($id));
                type Init = <$name as CellKind>::Init;
                let constructor = cx.allocate::<$name>(Init { base });
                constructor.finish_builtin_constructor(cx, prototype);
                constructor.upcast()
            }
        }
    };
}

pub(crate) use {define_builtin_constructor, define_constructor, define_object};
