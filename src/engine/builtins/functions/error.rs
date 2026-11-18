use bun_engine_bytecode::Visibility;
use bun_engine_text::{PropertyName, StringRef};
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::{
    Attributes, ErrorInstance, ErrorType, IteratorRecord, JsFunction, RealmSlot,
    define_captured_stack, errors, options,
};

use crate::prelude::*;

const fn text(name: PropertyName<'static>, value: PropertyName<'static>) -> StaticProperty {
    StaticProperty::string(name, value).without(Attributes::READ_ONLY)
}

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::toString, to_string, 0),
    text(names::name, names::Error),
    text(names::message, PropertyName::EMPTY),
    StaticProperty::realm_slot(names::constructor, RealmSlot::error_constructor),
]);

define_object!(
    ErrorPrototype,
    "Object",
    PROTOTYPE_PROPERTIES,
    export = "engine_class_ErrorPrototype"
);

static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
    StaticProperty::position_of(names::stackTraceLimit).without(Attributes::DONT_ENUM),
    StaticProperty::function(names::captureStackTrace, capture_stack_trace, 0),
    StaticProperty::function(names::isError, is_error, 1).with_intrinsic(Intrinsic::ErrorIsError),
]);

#[cell(name = "Function", static_table = CONSTRUCTOR_PROPERTIES)]
struct ErrorConstructor {
    base: InternalFunction,
}

fn shape_with(cx: &Cx, prototype: Gc<JsObject>) -> Gc<Shape> {
    let spec = ShapeSpec::of::<ErrorInstance>();
    Shape::create(cx, Some(cx.global()), prototype.into(), spec)
}

fn initialize_prototype(cx: &Cx) {
    let prototype = ErrorPrototype::create(cx, cx.object_prototype().into());
    cx.global().init_error_prototype(prototype);
    cx.global().init_error_shape(shape_with(cx, prototype));
}

fn initialize_constructor(cx: &Cx) {
    let (parent, spec) = (cx.function_prototype(), ShapeSpec::of::<ErrorConstructor>());
    let shape = Shape::create_dictionary(cx, Some(cx.global()), parent.into(), spec);
    let base = InternalFunction::init(cx, shape, call, Some(construct));
    let constructor = cx.allocate::<ErrorConstructor>(ErrorConstructorInit { base });
    constructor.finish_constructor(cx, 1, names::Error, &cx.error_prototype());
    let limit = options().default_error_stack_trace_limit.into();
    constructor.put_direct(cx, names::stackTraceLimit, limit, Attributes::NONE);
    cx.global().init_error_constructor(constructor.upcast());
}

macro_rules! derived_errors {
    ($($module:ident: $error_type:ident, $length:literal, $create:ident, $shape:ident, $constructor:ident;)*) => {
        $(mod $module {
            use super::*;

            const TYPE: ErrorType = ErrorType::$error_type;

            static_table!(static PROPERTIES = [
                text(names::name, TYPE.name()),
                text(names::message, PropertyName::EMPTY),
                StaticProperty::realm_slot(names::constructor, RealmSlot::$constructor),
            ]);

            define_object!(Prototype, "Object", PROPERTIES);

            pub(super) fn initialize_prototype(cx: &Cx) {
                let prototype = Prototype::create(cx, cx.error_prototype().into());
                cx.global().${concat(init_, $shape)}(shape_with(cx, prototype));
            }

            pub(super) fn initialize_constructor(cx: &Cx) {
                let (parent, spec) = (cx.error_constructor(), ShapeSpec::of::<InternalFunction>());
                let shape = Shape::create_dictionary(cx, Some(cx.global()), parent.into(), spec);
                let init = InternalFunction::init(cx, shape, call, Some(construct));
                let constructor = cx.allocate::<InternalFunction>(init);
                let prototype = cx.$shape().prototype().cast::<JsObject>();
                constructor.finish_constructor(cx, $length, TYPE.name(), &prototype);
                cx.global().${concat(init_, $constructor)}(constructor.upcast());
            }

            #[native_abi]
            fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
                $create(cx, frame, cx.$shape(), TYPE)
            }

            #[native_abi]
            fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
                let shape = shape_for_new_target(cx, frame, TYPE)?;
                $create(cx, frame, shape, TYPE)
            }
        })*

        pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
            match slot {
                RealmSlot::error_prototype | RealmSlot::error_shape => initialize_prototype(cx),
                RealmSlot::error_constructor => initialize_constructor(cx),
                RealmSlot::private_make_type_error => initialize_make_type_error(cx),
                $(
                    RealmSlot::$shape => $module::initialize_prototype(cx),
                    RealmSlot::$constructor => $module::initialize_constructor(cx),
                )*
                _ => return false,
            }
            true
        }
    };
}

derived_errors! {
    eval: EvalError, 1, create_native, eval_error_shape, eval_error_constructor;
    range: RangeError, 1, create_native, range_error_shape, range_error_constructor;
    reference: ReferenceError, 1, create_native, reference_error_shape, reference_error_constructor;
    syntax: SyntaxError, 1, create_native, syntax_error_shape, syntax_error_constructor;
    r#type: TypeError, 1, create_native, type_error_shape, type_error_constructor;
    uri: UriError, 1, create_native, uri_error_shape, uri_error_constructor;
    aggregate: AggregateError, 2, create_aggregate, aggregate_error_shape, aggregate_error_constructor;
    suppressed: SuppressedError, 3, create_suppressed, suppressed_error_shape, suppressed_error_constructor;
}

fn shape_for_new_target(
    cx: &mut Cx,
    frame: &CallFrame,
    error_type: ErrorType,
) -> JsResult<Gc<Shape>> {
    cx.shape_from_new_target(frame.new_target(), &frame.callee(), |global, vm| {
        global.shape_for_error(vm, error_type)
    })
}

struct Details {
    message: Option<Gc<JsString>>,
    cause: Option<Value>,
}

impl Details {
    #[inline]
    fn read(cx: &mut Cx, message: Value, options: Value) -> JsResult<Details> {
        let message = match message {
            Value::UNDEFINED => None,
            message => Some(message.to_string(cx)?),
        };
        let cause = match options.as_object() {
            Some(options) => options.get_if_has_property(cx, names::cause)?,
            None => None,
        };
        Ok(Details { message, cause })
    }

    /// The stack trace starts with the caller of the running function, or with that of `below`.
    #[inline]
    fn create(
        self,
        cx: &Cx,
        shape: Gc<Shape>,
        error_type: ErrorType,
        below: Option<Gc<JsObject>>,
    ) -> Gc<ErrorInstance> {
        let error = ErrorInstance::create(cx, shape, error_type, 1, below);
        if let Some(message) = self.message {
            error.define_message(cx, message);
        }
        if let Some(cause) = self.cause {
            error.define_cause(cx, cause);
        }
        error
    }
}

fn create_native(
    cx: &mut Cx,
    frame: &CallFrame,
    shape: Gc<Shape>,
    error_type: ErrorType,
) -> JsResult<Value> {
    let details = Details::read(cx, frame.argument(0), frame.argument(1))?;
    Ok(details.create(cx, shape, error_type, None).into())
}

fn create_aggregate(
    cx: &mut Cx,
    frame: &CallFrame,
    shape: Gc<Shape>,
    error_type: ErrorType,
) -> JsResult<Value> {
    let details = Details::read(cx, frame.argument(1), frame.argument(2))?;
    let errors = IteratorRecord::for_iterable(cx, frame.argument(0))?.to_array(cx)?;
    let error = details.create(cx, shape, error_type, None);
    error.define_errors(cx, errors);
    Ok(error.into())
}

fn create_suppressed(
    cx: &mut Cx,
    frame: &CallFrame,
    shape: Gc<Shape>,
    error_type: ErrorType,
) -> JsResult<Value> {
    let details = Details::read(cx, frame.argument(2), Value::UNDEFINED)?;
    let error = details.create(cx, shape, error_type, None);
    error.define_error_and_suppressed(cx, frame.argument(0), frame.argument(1));
    Ok(error.into())
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create_native(cx, frame, cx.error_shape(), ErrorType::Error)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let shape = shape_for_new_target(cx, frame, ErrorType::Error)?;
    let subclass = (frame.new_target().as_object()).filter(|&it| it != frame.callee());
    let details = Details::read(cx, frame.argument(0), frame.argument(1))?;
    Ok(details.create(cx, shape, ErrorType::Error, subclass).into())
}

#[native_abi]
fn capture_stack_trace(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(object) = frame.argument(0).as_object() else {
        let message = "captureStackTrace expects the first argument to be an object";
        return Err(cx.throw_type_error(message));
    };
    let below = frame.argument(1).as_object().filter(|it| it.is_callable());
    define_captured_stack(cx, object, below)?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn is_error(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.argument(0).is::<ErrorInstance>().into())
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(this) = frame.this_value().as_object() else {
        return Err(cx.throw_type_error(errors::TYPE_ERROR));
    };
    let name = match this.get(cx, names::name)? {
        Value::UNDEFINED => JsString::from_name(cx, names::Error),
        name => name.to_string(cx)?,
    };
    let message = match this.get(cx, names::message)? {
        Value::UNDEFINED => cx.small_strings.empty(),
        message => message.to_string(cx)?,
    };
    if name.is_empty() {
        return Ok(message.into());
    }
    if message.is_empty() {
        return Ok(name.into());
    }
    let separator = JsString::from_name(cx, names::colonAndSpace);
    JsString::concat3(cx, name, separator, message).map(Into::into)
}

fn initialize_make_type_error(cx: &Cx) {
    cx.global()
        .init_private_make_type_error(JsFunction::native_with(
            cx,
            0,
            &StringRef::from_literal("makeTypeError"),
            make_type_error,
            native_not_a_constructor,
            Intrinsic::None,
            Visibility::Private,
        ));
}

#[native_abi]
fn make_type_error(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let details = Details::read(cx, frame.argument(0), Value::UNDEFINED)?;
    let error = details.create(cx, cx.type_error_shape(), ErrorType::TypeError, None);
    Ok(error.into())
}
