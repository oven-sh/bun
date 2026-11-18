use bun_engine_text::StringRef;
use bun_engine_vm::{Attributes, CustomGetter, JsBoundFunction, JsFunction, NativeFunction};

use super::prelude::*;

/// `define_object!(Name, "ClassName", TABLE)` declares the type. `Name::create(cx, prototype)` makes the object.
macro_rules! define_object {
    ($name:ident, $class_name:literal, $table:ident) => {
        #[cell(name = $class_name, static_table = $table)]
        struct $name {
            base: JsObject,
        }

        impl $name {
            fn create(cx: &Cx, prototype: Gc<JsObject>) -> Gc<JsObject> {
                let spec = bun_engine_vm::ShapeSpec::of::<$name>();
                let shape = Shape::create_dictionary(cx, Some(cx.global()), prototype.into(), spec);
                let base = JsObjectInit::new(cx, shape);
                type Init = <$name as bun_engine_vm::CellKind>::Init;
                cx.allocate::<$name>(Init { base }).upcast()
            }
        }
    };
}

/// Defines `initialize`, which makes a constructor, its prototype and the shape of its instances. The module has
/// `PROTOTYPE_PROPERTIES`, `call` and `construct`.
macro_rules! define_class {
    (
        $name:ident: $instance:ty, $class_name:literal, length $length:literal, $constructor_table:ident,
        $init_constructor:ident, $init_shape:ident
    ) => {
        define_object!(Prototype, $class_name, PROTOTYPE_PROPERTIES);

        #[cell(name = "Function", static_table = $constructor_table)]
        struct Constructor {
            base: bun_engine_vm::InternalFunction,
        }

        pub(super) fn initialize(cx: &Cx) {
            use bun_engine_vm::{InternalFunction, ShapeSpec};

            let global = cx.global();
            let prototype = Prototype::create(cx, cx.object_prototype());
            let (parent, spec) = (cx.function_prototype(), ShapeSpec::of::<Constructor>());
            let shape = Shape::create_dictionary(cx, Some(global), parent.into(), spec);
            let constructor = cx.allocate::<Constructor>(ConstructorInit {
                base: InternalFunction::init(cx, shape, call, Some(construct)),
            });
            constructor.finish_constructor(cx, $length, names::$name, &prototype);
            let spec = ShapeSpec::of::<$instance>();
            global.$init_shape(Shape::create(cx, Some(global), prototype.into(), spec));
            global.$init_constructor(constructor.upcast());
        }
    };
}

/// Defines `call` for a constructor that needs `new`.
macro_rules! define_throwing_call {
    ($name:literal) => {
        #[native_abi]
        fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
            let message = concat!("calling ", $name, " constructor without new is invalid");
            Err(cx.throw_type_error(message))
        }
    };
}

/// RequireInternalSlot. `this!(cx, value, "Class", "method")` takes a value or what `unwrap_legacy` found.
macro_rules! this {
    ($cx:expr, $this:expr, $class:literal, $method:literal) => {
        Value::from($this).downcast().ok_or_else(|| {
            $cx.throw_type_error(concat!(
                "Intl.",
                $class,
                ".prototype.",
                $method,
                " called on value that's not a ",
                $class
            ))
        })
    };
}

pub(super) const fn getter(name: PropertyName<'static>, getter: CustomGetter) -> StaticProperty {
    let attributes = Attributes::DONT_ENUM
        .union(Attributes::READ_ONLY)
        .union(Attributes::CUSTOM_ACCESSOR);
    StaticProperty::custom(name, attributes, getter, None)
}

/// An anonymous function that calls `function` on `receiver`.
pub(super) fn bind_method(
    cx: &mut Cx,
    receiver: Gc<JsObject>,
    name: PropertyName<'_>,
    length: u32,
    function: NativeFunction,
) -> JsResult<Gc<JsObject>> {
    let cx = cx.in_realm_of(&receiver);
    let target = JsFunction::native(cx, length, &StringRef::retain(name.string()), function);
    let (this, no_name) = (receiver.into(), cx.small_strings.empty());
    let length = Some(length.into());
    let bound = JsBoundFunction::create(cx, target.upcast(), this, &[], length, Some(no_name))?;
    let attributes = Attributes::READ_ONLY | Attributes::DONT_ENUM;
    bound.put_direct(cx, names::name, no_name.into(), attributes);
    Ok(bound.upcast())
}
