//! Errors that several places throw.

use bun_engine_bytecode::{ErrorKind, Specialization, StaticError};
use bun_engine_text::{PropertyName, StringBuilder, StringRef, Text};

use crate::{
    Class, Cx, ErrorInstance, ErrorType, Gc, JsFunction, JsObject, Message, SourceAppender, Thrown,
    Value,
};

pub const TYPE_ERROR: &str = "Type error";
pub const NON_EXTENSIBLE_DEFINE: &str =
    "Attempting to define property on object that is not extensible.";
pub const READ_ONLY_PROPERTY_WRITE: &str = "Attempted to assign to readonly property.";
pub const READ_ONLY_PROPERTY_CHANGE: &str = "Attempting to change value of a readonly property.";
pub const UNABLE_TO_DELETE_PROPERTY: &str = "Unable to delete property.";
pub const UNCONFIGURABLE_CHANGE_ACCESS_MECHANISM: &str =
    "Attempting to change access mechanism for an unconfigurable property.";
pub const UNCONFIGURABLE_CHANGE_CONFIGURABILITY: &str =
    "Attempting to change configurable attribute of unconfigurable property.";
pub const UNCONFIGURABLE_CHANGE_ENUMERABILITY: &str =
    "Attempting to change enumerable attribute of unconfigurable property.";
pub const UNCONFIGURABLE_CHANGE_WRITABILITY: &str =
    "Attempting to change writable attribute of unconfigurable property.";
pub const UNCONFIGURABLE_CHANGE_SETTER: &str =
    "Attempting to change the setter of an unconfigurable property.";
pub const UNCONFIGURABLE_CHANGE_GETTER: &str =
    "Attempting to change the getter of an unconfigurable property.";
pub const PROTOTYPE_NOT_OBJECT_OR_NULL: &str = "Prototype value can only be an object or null";
pub const DEFINE_BEYOND_READ_ONLY_LENGTH: &str =
    "Attempting to define numeric property on array with non-writable length property.";
pub const INVALID_ARRAY_LENGTH: &str = "Invalid array length";
pub const INVALID_ARRAY_SIZE: &str = "Array length must be a positive integer of safe magnitude.";
pub const LENGTH_EXCEEDS_MAXIMUM: &str = "Length exceeded the maximum array length";
pub const SYMBOL_TO_STRING: &str = "Cannot convert a symbol to a string";
pub const ITERATOR_RESULT_NOT_OBJECT: &str = "Iterator result interface is not an object.";
pub const BUFFER_DETACHED_OR_OUT_OF_BOUNDS: &str =
    "Underlying ArrayBuffer has been detached from the view or out-of-bounds";
pub const BUFFER_ALREADY_DETACHED: &str = "Buffer is already detached";
pub const BYTE_OFFSET_EXCEEDS_BUFFER: &str = "byteOffset exceeds source ArrayBuffer byteLength";
pub const CONTENT_TYPES_DIFFER: &str =
    "Content types of source and destination typed arrays are different";
pub const LENGTH_OUT_OF_RANGE_OF_BUFFER: &str = "Length out of range of buffer";
pub const RANGE_OUT_OF_BOUNDS: &str = "Range consisting of offset and length are out of bounds";
pub const SYNTAX_ERROR: &str = "Syntax error";
pub const OUT_OF_MEMORY: &str = "Out of memory";
pub const NOT_ENOUGH_ARGUMENTS: &str = "Not enough arguments";
pub const RESTRICTED_PROPERTY_ACCESS: &str =
    "'arguments', 'callee', and 'caller' cannot be accessed in this context.";

/// Runs no script.
pub fn describe_value(cx: &Cx, value: Value, out: &mut StringBuilder) {
    if let Some(string) = value.as_string() {
        out.push_latin1(b'"');
        string.append_to(out);
        out.push_latin1(b'"');
    } else if let Some(symbol) = value.as_symbol() {
        match symbol.descriptive_string() {
            Ok(description) => out.push_text(description.text()),
            Err(_) => out.push_ascii("Symbol"),
        }
    } else if value.is_callable() {
        out.push_ascii("function");
    } else if let Some(object) = value.as_object() {
        // SAFETY: an inquiry runs no script, so nothing that the caller has borrowed changes.
        let cx = unsafe { Cx::from_global(cx.global()) };
        out.push_text(object.calculated_class_name(cx).text());
    } else {
        match value.primitive_to_string(cx) {
            Ok(string) => string.append_to(out),
            Err(thrown) => cx.discard_unless_termination(thrown),
        }
    }
}

#[cold]
#[inline(never)]
fn create_about(
    cx: &Cx,
    value: Value,
    message: &str,
    appender: SourceAppender,
) -> Gc<ErrorInstance> {
    let mut text = StringBuilder::new();
    describe_value(cx, value, &mut text);
    text.push_latin1(b' ');
    text.push_ascii(message);
    match text.finish() {
        Ok(text) => ErrorInstance::with_source(cx, ErrorType::TypeError, text, appender, value),
        Err(_) => ErrorInstance::out_of_memory(cx, OUT_OF_MEMORY.into_string()),
    }
}

macro_rules! errors_about_values {
    ($($create:ident, $throw:ident, $message:literal, $appender:ident;)*) => {$(
        #[cold]
        pub fn $create(cx: &Cx, value: Value) -> Gc<ErrorInstance> {
            create_about(cx, value, $message, SourceAppender::$appender)
        }

        #[cold]
        #[inline(never)]
        pub fn $throw(cx: &Cx, value: Value) -> Thrown {
            cx.throw($create(cx, value).into())
        }
    )*};
}

errors_about_values! {
    create_not_a_function, throw_not_a_function, "is not a function", NotAFunction;
    create_not_a_constructor, throw_not_a_constructor, "is not a constructor", Default;
    create_not_an_object, throw_not_an_object, "is not an object", Default;
    create_invalid_in_parameter, throw_invalid_in_parameter, "is not an Object.", In;
    create_instanceof_not_a_function, throw_instanceof_not_a_function, " is not a function", InstanceofNotAFunction;
    create_has_instance_not_a_function, throw_has_instance_not_a_function,
        "[Symbol.hasInstance] is not a function, undefined, or null", HasInstanceNotAFunction;
    create_invalid_prototype, throw_invalid_prototype, "is not an object or null", InvalidPrototype;
}

/// For an instruction whose callee cannot be called in that way.
#[cold]
#[inline(never)]
pub fn throw_failed_call(cx: &Cx, callee: Value, specialization: Specialization) -> Thrown {
    let (message, appender) = match specialization {
        Specialization::Call => ("is not a function", SourceAppender::FailedCall),
        Specialization::Construct => ("is not a constructor", SourceAppender::FailedConstruct),
    };
    cx.throw(create_about(cx, callee, message, appender).into())
}

/// From a frame that `new` has made for a function which is no constructor.
#[cold]
pub(crate) fn throw_entered_as_constructor(cx: &Cx, callee: Gc<JsObject>) -> Thrown {
    match callee.downcast::<JsFunction>() {
        Some(function) if !function.is_native() => {
            let cx = cx.in_realm_of_caller(0);
            throw_failed_call(cx, callee.into(), Specialization::Construct)
        }
        _ => throw_not_a_constructor(cx.in_realm_of_caller(1), callee.into()),
    }
}

/// `check_this`
#[cold]
pub fn throw_this_is_not_bound(cx: &Cx) -> Thrown {
    let cx = if cx.is_leaving_constructor() {
        cx.in_realm_of_caller(1)
    } else {
        cx
    };
    cx.throw_reference_error(
        "'super()' must be called in derived constructor before accessing |this| or returning non-object.",
    )
}

pub fn error_type_of(kind: ErrorKind) -> ErrorType {
    match kind {
        ErrorKind::TypeError => ErrorType::TypeError,
        ErrorKind::RangeError | ErrorKind::OutOfMemory => ErrorType::RangeError,
        ErrorKind::ReferenceError => ErrorType::ReferenceError,
        ErrorKind::SyntaxError => ErrorType::SyntaxError,
    }
}

/// `throw_static`
#[cold]
pub fn throw_static(cx: &Cx, error: StaticError, name: PropertyName<'_>) -> Thrown {
    let cx = match error {
        StaticError::DerivedConstructorResult => cx.in_realm_of_caller(1),
        _ => cx,
    };
    let (error_type, message) = (error_type_of(error.kind()), error.message());
    match error.message_around_name() {
        Some((before, after)) if !name.text().is_empty() => {
            throw_naming(cx, error_type, before, name, after, message)
        }
        _ => cx.throw_error(error_type, message),
    }
}

/// With the text of the expression that failed.
#[cold]
#[inline(never)]
pub fn throw_type_error_with_source(cx: &Cx, message: impl Message) -> Thrown {
    let (message, appender) = (message.into_string(), SourceAppender::Default);
    let error_type = ErrorType::TypeError;
    cx.throw(ErrorInstance::with_source(cx, error_type, message, appender, Value::NULL).into())
}

pub(crate) fn throw_invalid_apply_parameter(cx: &Cx) -> Thrown {
    let message = "second argument to Function.prototype.apply must be an Array-like object";
    throw_type_error_with_source(cx, message)
}

#[cold]
pub fn throw_called_without_new(cx: &Cx, constructor: &str) -> Thrown {
    cx.throw_type_error(format_args!(
        "calling {constructor} constructor without new is invalid"
    ))
}

/// `fallback` is for when there is no memory to put the name in.
#[cold]
pub fn create_naming(
    cx: &Cx,
    error_type: ErrorType,
    before: &str,
    name: PropertyName<'_>,
    after: &str,
    fallback: &'static str,
) -> Gc<ErrorInstance> {
    let (before, after) = (Text::from_ascii(before), Text::from_ascii(after));
    let text = StringRef::try_concat(&[before, name.text(), after]);
    let text = text.unwrap_or_else(|_| fallback.into_string());
    ErrorInstance::new(cx, error_type, Some(text))
}

#[cold]
#[inline(never)]
pub fn throw_naming(
    cx: &Cx,
    error_type: ErrorType,
    before: &str,
    name: PropertyName<'_>,
    after: &str,
    fallback: &'static str,
) -> Thrown {
    cx.throw(create_naming(cx, error_type, before, name, after, fallback).into())
}

pub fn create_undefined_variable(cx: &Cx, name: PropertyName<'_>) -> Gc<ErrorInstance> {
    let (before, after, fallback) = if name.is_private() {
        let fallback = "Can't find private variable";
        ("Can't find private variable: PrivateSymbol.", "", fallback)
    } else {
        ("", " is not defined", "Variable is not defined")
    };
    create_naming(cx, ErrorType::ReferenceError, before, name, after, fallback)
}

#[cold]
pub fn throw_undefined_variable(cx: &Cx, name: PropertyName<'_>) -> Thrown {
    cx.throw(create_undefined_variable(cx, name).into())
}

pub fn throw_uninitialized_variable(cx: &Cx, name: PropertyName<'_>) -> Thrown {
    let fallback = "Cannot access uninitialized variable.";
    if name.is_symbol() || name.text().is_empty() {
        return cx.throw_reference_error(fallback);
    }
    let (before, after) = ("Cannot access '", "' before initialization.");
    throw_naming(cx, ErrorType::ReferenceError, before, name, after, fallback)
}

/// `accessor` is `getter` or `setter`.
pub fn wrong_receiver_message(class: Text<'_>, name: Text<'_>, accessor: &str) -> StringRef {
    let ascii = Text::from_ascii;
    let parts = [
        ascii("The "),
        class,
        ascii("."),
        name,
        ascii(" "),
        ascii(accessor),
        ascii(" can only be used on instances of "),
        class,
    ];
    StringRef::try_concat(&parts).unwrap_or_default()
}

#[cold]
pub fn throw_getter_type_error(cx: &Cx, class: &Class, name: PropertyName<'_>) -> Thrown {
    let message = wrong_receiver_message(class.name_literal().text(), name.text(), "getter");
    let error = ErrorInstance::new(cx, ErrorType::TypeError, Some(message));
    error.set_native_getter_type_error();
    cx.throw(error.into())
}

#[cold]
pub fn throw_setter_type_error(cx: &Cx, class: &Class, name: PropertyName<'_>) -> Thrown {
    let class = class.name_literal().text();
    cx.throw_type_error(wrong_receiver_message(class, name.text(), "setter"))
}
