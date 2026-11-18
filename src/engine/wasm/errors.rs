//! `CompileError`, `LinkError`, `RuntimeError` and `SuspendError`, which extend `Error`.

use bun_engine_vm::{
    Attributes, ErrorInstance, ErrorType, Message, NativeFunction, SourceAppender, Thrown,
};

use crate::namespace::{Namespace, Slot, shape_for_new_target};
use crate::prelude::*;

macro_rules! classes {
    ($($module:ident: $kind:ident, $name:ident, $class:literal, $constructor:ident, $shape:ident;)*) => {
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub(crate) enum Kind {
            $($kind,)*
        }

        impl Kind {
            fn class(self) -> Class {
                match self {
                    $(Kind::$kind => Class {
                        name: names::$name,
                        constructor: Slot::$constructor,
                        shape: Slot::$shape,
                        create_prototype: $module::Prototype::create,
                        call: $module::call,
                        construct: $module::construct,
                    },)*
                }
            }
        }

        $(mod $module {
            use super::*;

            static_table!(static PROPERTIES = [
                StaticProperty::string(names::name, names::$name).without(Attributes::READ_ONLY),
                StaticProperty::string(names::message, PropertyName::EMPTY)
                    .without(Attributes::READ_ONLY),
                StaticProperty::position_of(names::constructor),
            ]);

            define_object!(Prototype, $class, PROPERTIES);

            #[native_abi]
            pub(super) fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
                let shape = Namespace::of(cx).shape(cx, Slot::$shape);
                from_arguments(cx, frame, shape)
            }

            #[native_abi]
            pub(super) fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
                let shape = shape_for_new_target(cx, frame, Slot::$shape)?;
                from_arguments(cx, frame, shape)
            }
        })*
    };
}

classes! {
    compile_error: Compile, CompileError, "WebAssembly.CompileError", CompileErrorConstructor, CompileErrorShape;
    link_error: Link, LinkError, "WebAssembly.LinkError", LinkErrorConstructor, LinkErrorShape;
    runtime_error: Runtime, RuntimeError, "WebAssembly.RuntimeError", RuntimeErrorConstructor, RuntimeErrorShape;
    suspend_error: Suspend, SuspendError, "WebAssembly.SuspendError", SuspendErrorConstructor, SuspendErrorShape;
}

struct Class {
    name: PropertyName<'static>,
    constructor: Slot,
    shape: Slot,
    create_prototype: fn(&Cx, Value) -> Gc<JsObject>,
    call: NativeFunction,
    construct: NativeFunction,
}

/// The message ends with the text of the expression that the script is at, if one is running.
#[cold]
pub(crate) fn create(cx: &Cx, kind: Kind, message: impl Message) -> Gc<ErrorInstance> {
    let shape = Namespace::of(cx).shape(cx, kind.class().shape);
    let error = ErrorInstance::create(cx, shape, ErrorType::Error, 0, None);
    let appender = SourceAppender::Default;
    error.define_message_with_source(cx, message.into_string(), appender, Value::NULL);
    error
}

#[cold]
pub(crate) fn throw(cx: &Cx, kind: Kind, message: impl Message) -> Thrown {
    cx.throw(create(cx, kind, message).into())
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace, kind: Kind) {
    let (class, global) = (kind.class(), Some(cx.global()));
    let prototype = (class.create_prototype)(cx, cx.error_prototype().into());
    let spec = ShapeSpec::of::<ErrorInstance>();
    let shape = Shape::create(cx, global, prototype.into(), spec);
    namespace.put(class.shape, shape);

    let (parent, spec) = (cx.error_constructor(), ShapeSpec::of::<InternalFunction>());
    let shape = Shape::create_dictionary(cx, global, parent.into(), spec);
    let init = InternalFunction::init(cx, shape, class.call, Some(class.construct));
    let constructor = cx.allocate::<InternalFunction>(init);
    constructor.finish_constructor(cx, 1, class.name, &prototype);
    namespace.put(class.constructor, constructor);
}

/// As the constructor of a NativeError of ECMA-262.
fn from_arguments(cx: &mut Cx, frame: &CallFrame, shape: Gc<Shape>) -> JsResult<Value> {
    let message = match frame.argument(0) {
        Value::UNDEFINED => None,
        message => Some(message.to_string(cx)?),
    };
    let cause = match frame.argument(1).as_object() {
        Some(options) => options.get_if_has_property(cx, names::cause)?,
        None => None,
    };
    let error = ErrorInstance::create(cx, shape, ErrorType::Error, 1, None);
    if let Some(message) = message {
        error.define_message(cx, message);
    }
    if let Some(cause) = cause {
        error.define_cause(cx, cause);
    }
    Ok(error.into())
}
