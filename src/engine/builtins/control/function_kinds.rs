//! `GeneratorFunction`, `AsyncFunction`, `AsyncGeneratorFunction` and what hangs on them.

use bun_engine_text::PropertyName;
use bun_engine_vm::{
    Attributes, DynamicFunctionKind, JsAsyncGenerator, JsFunction, JsGenerator, RealmSlot,
    create_dynamic_function,
};

use super::async_generator::AsyncGeneratorPrototype;
use super::instance_shape;
use crate::js;
use crate::prelude::*;

const fn link(name: PropertyName<'static>, slot: RealmSlot) -> StaticProperty {
    StaticProperty::realm_slot(name, slot).with(Attributes::READ_ONLY)
}

static_table!(static NO_PROPERTIES = []);

macro_rules! function_kinds {
    ($($module:ident: $name:ident, $class_name:literal, $kind:ident, $prototype:ident, [$($instances:ident)?]
        $(, export = $export:literal)?;)*) => {$(
        mod $module {
            use super::*;

            static_table!(static PROPERTIES = [
                StaticProperty::made(names::constructor, create_constructor).with(Attributes::READ_ONLY),
                $(link(names::prototype, RealmSlot::$instances),)?
                StaticProperty::string(symbols::toStringTag, names::$name),
            ]);

            define_object!(Prototype, $class_name, PROPERTIES $(, export = $export)?);
            define_constructor!(Constructor, NO_PROPERTIES, call, construct);

            fn create_constructor(cx: &Cx, prototype: &JsObject) -> Value {
                Constructor::create(cx, cx.function_constructor(), 1, names::$name, prototype).into()
            }

            #[native_abi]
            fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
                create(cx, frame, DynamicFunctionKind::$kind, Value::UNDEFINED)
            }

            #[native_abi]
            fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
                create(cx, frame, DynamicFunctionKind::$kind, frame.new_target())
            }
        }
    )*};
}

function_kinds! {
    generator_function: GeneratorFunction, "GeneratorFunction", Generator, generator_function_prototype,
        [generator_prototype];
    async_function: AsyncFunction, "AsyncFunction", Async, async_function_prototype, [],
        export = "engine_class_AsyncFunctionPrototype";
    async_generator_function: AsyncGeneratorFunction, "AsyncGeneratorFunction", AsyncGenerator,
        async_generator_function_prototype, [async_generator_prototype];
}

fn create(
    cx: &mut Cx,
    frame: &CallFrame,
    kind: DynamicFunctionKind,
    new_target: Value,
) -> JsResult<Value> {
    create_dynamic_function(cx, kind, &frame.callee(), new_target, frame.arguments())
        .map(Into::into)
}

static_table!(static GENERATOR_PROTOTYPE_PROPERTIES = [
    StaticProperty::builtin(names::next, js::generator_prototype::next),
    StaticProperty::builtin(names::r#return, js::generator_prototype::r#return),
    StaticProperty::builtin(names::throw, js::generator_prototype::throw),
    link(names::constructor, RealmSlot::generator_function_prototype),
    StaticProperty::string(symbols::toStringTag, names::Generator),
]);

define_object!(
    GeneratorPrototype,
    "Generator",
    GENERATOR_PROTOTYPE_PROPERTIES
);

pub(super) fn initialize_generators(cx: &Cx) {
    let global = cx.global();
    let functions = generator_function::Prototype::create(cx, cx.function_prototype().into());
    let instances = GeneratorPrototype::create(cx, cx.iterator_prototype().into());
    global.init_generator_function_shape(instance_shape::<JsFunction>(cx, functions.into()));
    global.init_generator_function_prototype(functions);
    global.init_generator_shape(instance_shape::<JsGenerator>(cx, instances.into()));
    global.init_generator_prototype(instances);
}

pub(super) fn initialize_async_functions(cx: &Cx) {
    let global = cx.global();
    let functions = async_function::Prototype::create(cx, cx.function_prototype().into());
    global.init_async_function_shape(instance_shape::<JsFunction>(cx, functions.into()));
    global.init_async_function_prototype(functions);
}

pub(super) fn initialize_async_generators(cx: &Cx) {
    let global = cx.global();
    let functions = async_generator_function::Prototype::create(cx, cx.function_prototype().into());
    let instances = AsyncGeneratorPrototype::create(cx, cx.async_iterator_prototype().into());
    global.init_async_generator_function_shape(instance_shape::<JsFunction>(cx, functions.into()));
    global.init_async_generator_function_prototype(functions);
    global.init_async_generator_shape(instance_shape::<JsAsyncGenerator>(cx, instances.into()));
    global.init_async_generator_prototype(instances);
}
