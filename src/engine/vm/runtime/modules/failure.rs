//! An error is told which module it is about, and from which stage it is.

use bun_engine_text::{PropertyName, private_names};

use crate::{
    AbstractModuleRecord, Attributes, Cx, ErrorInstance, ErrorType, JsResult, LineColumn,
    ModuleKeyRef, Value, Vm, anchor,
};

#[derive(Clone, Copy)]
pub(super) enum FailureKind {
    Instantiation,
    Evaluation,
}

const KEY: PropertyName<'static> = private_names::moduleFailureModuleKey;
const TYPE: PropertyName<'static> = private_names::moduleFailureModuleType;
const KIND: PropertyName<'static> = private_names::moduleFailureKind;

pub(super) fn note(vm: &Vm, error: Value, module: ModuleKeyRef<'_>, kind: FailureKind) {
    if let Some(error) = error.downcast::<ErrorInstance>() {
        for (name, value) in [
            (KEY, Value::from_name(vm, module.name)),
            (TYPE, Value::int32(module.module_type as i32)),
            (KIND, Value::int32(kind as i32)),
        ] {
            error.put_direct(vm, name, value, Attributes::NONE);
        }
    }
}

pub(super) fn note_on_pending(cx: &Cx, module: &AbstractModuleRecord, kind: FailureKind) {
    if let Some(exception) = cx.exception() {
        let module = anchor!(module);
        let key = ModuleKeyRef::new(module.key().name(), module.module_type());
        note(cx, exception.value(), key, kind);
    }
}

/// From the point of view of `module`, so is any failure of another one.
pub(super) fn is_evaluation_error(
    cx: &Cx,
    error: &ErrorInstance,
    module: ModuleKeyRef<'_>,
) -> JsResult<bool> {
    let differs = |name, own: i32| error.get_direct(name).map(|it| it != Value::int32(own));
    if differs(KIND, FailureKind::Evaluation as i32) == Some(false)
        || differs(TYPE, module.module_type as i32) == Some(true)
    {
        return Ok(true);
    }
    match error.get_direct(KEY) {
        Some(key) => Ok(!key.strict_equals(cx, Value::from_name(cx, module.name))?),
        None => Ok(false),
    }
}

/// Each importer of what could not be fetched gets an error of its own.
pub(super) fn duplicate(cx: &mut Cx, error: Value) -> JsResult<Value> {
    let Some(error) = error.downcast::<ErrorInstance>() else {
        return Ok(error);
    };
    let message = error.sanitized_message(cx)?;
    let copy = match error.error_type() {
        ErrorType::TypeError => ErrorInstance::new(cx, ErrorType::TypeError, message),
        other => ErrorInstance::with_info(cx, other, message, LineColumn::default(), None, None),
    };
    for name in [KEY, TYPE, KIND] {
        if let Some(value) = error.get_direct(name) {
            copy.put_direct(cx, name, value, Attributes::NONE);
        }
    }
    Ok(copy.into())
}
