use bun_engine_vm::{Attributes, CustomGetter, NativeFunction};

use super::prelude::*;

/// `define_object!(Name, "ClassName", TABLE)` declares the type. `Name::create(cx)` makes the object.
macro_rules! define_object {
    ($name:ident, $class_name:literal, $table:ident) => {
        #[bun_engine_macros::cell(name = $class_name, static_table = $table)]
        struct $name {
            base: JsObject,
        }

        impl $name {
            fn create(cx: &Cx) -> Gc<JsObject> {
                use bun_engine_vm::{CellKind, JsObjectInit, Shape, ShapeSpec};

                let (parent, spec) = (cx.object_prototype(), ShapeSpec::of::<$name>());
                let shape = Shape::create_dictionary(cx, Some(cx.global()), parent.into(), spec);
                let base = JsObjectInit::new(cx, shape);
                type Init = <$name as CellKind>::Init;
                cx.allocate::<$name>(Init { base }).upcast()
            }
        }
    };
}

/// Makes a value type an `Instance`, and defines `initialize`, which makes the constructor, its prototype and the shape of
/// the instances. The module has `CONSTRUCTOR_PROPERTIES`, `PROTOTYPE_PROPERTIES` and `construct`. `Name in Slot` stores the
/// value in another type, and is followed by a method of `Instance`.
macro_rules! define_class {
    (
        $name:ident, $prototype_name:literal, length $length:literal, $value_of:ident,
        $shape:ident, $init_shape:ident, $init_constructor:ident
    ) => {
        define_class!(
            $name in $name, $prototype_name, length $length, $value_of,
            $shape, $init_shape, $init_constructor, {}
        );
    };
    (
        $name:ident in $slot:ty, $prototype_name:literal, length $length:literal, $value_of:ident,
        $shape:ident, $init_shape:ident, $init_constructor:ident, { $($override:item)? }
    ) => {
        #[bun_engine_macros::cell(name = "Object")]
        struct Object {
            base: JsObject,
            value: $slot,
        }

        impl Instance for $name {
            const CLASS_NAME: &'static str = stringify!($name);
            const VALUE_OF: Error = Error::$value_of;

            #[inline(always)]
            fn of(object: &JsObject) -> Option<$name> {
                let is_instance = object.class().is(<Object as bun_engine_vm::CellKind>::CLASS);
                is_instance.then(|| super::instance::Slot::load(&Gc::from(object).cast::<Object>().value))
            }

            #[inline(always)]
            fn shape(
                global: &bun_engine_vm::GlobalObject,
                vm: &bun_engine_vm::Vm,
            ) -> Gc<bun_engine_vm::Shape> {
                global.$shape(vm)
            }

            #[inline(always)]
            fn allocate(self, cx: &Cx, shape: Gc<bun_engine_vm::Shape>) -> Gc<JsObject> {
                let base = bun_engine_vm::JsObjectInit::new(cx, shape);
                let value = self.into();
                cx.allocate::<Object>(ObjectInit { base, value }).upcast()
            }

            $($override)?
        }

        define_object!(Prototype, $prototype_name, PROTOTYPE_PROPERTIES);

        #[bun_engine_macros::cell(name = "Function", static_table = CONSTRUCTOR_PROPERTIES)]
        struct Constructor {
            base: bun_engine_vm::InternalFunction,
        }

        #[native_abi]
        fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
            Err(cx.throw_type_error(concat!(
                "calling ",
                stringify!($name),
                " constructor without new is invalid"
            )))
        }

        pub(super) fn initialize(cx: &Cx) {
            use bun_engine_vm::{InternalFunction, Shape, ShapeSpec};

            let (global, prototype) = (cx.global(), Prototype::create(cx));
            let (parent, spec) = (cx.function_prototype(), ShapeSpec::of::<Constructor>());
            let shape = Shape::create_dictionary(cx, Some(global), parent.into(), spec);
            let constructor = cx.allocate::<Constructor>(ConstructorInit {
                base: InternalFunction::init(cx, shape, call, Some(construct)),
            });
            constructor.finish_constructor(cx, $length, names::$name, &prototype);
            let spec = ShapeSpec::of::<Object>();
            global.$init_shape(Shape::create(cx, Some(global), prototype.into(), spec));
            global.$init_constructor(constructor.upcast());
        }
    };
}

pub(super) const fn function(
    name: PropertyName<'static>,
    function: NativeFunction,
    length: u32,
) -> StaticProperty {
    StaticProperty::function(name, function, length)
}

pub(super) const fn getter(name: PropertyName<'static>, getter: CustomGetter) -> StaticProperty {
    let attributes = Attributes::DONT_ENUM
        .union(Attributes::READ_ONLY)
        .union(Attributes::CUSTOM_ACCESSOR);
    StaticProperty::custom(name, attributes, getter, None)
}
