use bun_engine_text::names;

use crate::{
    Attributes, Cx, FunctionExecutable, Gc, JsCell, JsFinalObject, JsFunction, JsObject, JsResult,
    Shape, ShapeSpec, Value, WatchpointState, errors,
};

/// `new_class`: the part of ClassDefinitionEvaluation that comes before the elements. Returns the constructor and the
/// prototype.
///
/// # Safety
/// As for `JsFunction::create`.
pub unsafe fn new_class(
    cx: &mut Cx,
    executable: Gc<FunctionExecutable>,
    scope: Gc<JsCell>,
    heritage: Option<Value>,
    name: Option<Value>,
) -> JsResult<(Gc<JsFunction>, Gc<JsObject>)> {
    let global = cx.global();
    let mut shape = JsFunction::shape_for(cx, &global, &executable);
    let parent = match heritage {
        None => cx.object_prototype().into(),
        Some(Value::NULL) => Value::NULL,
        Some(heritage) => {
            let Some(superclass) = heritage.as_object().filter(|it| it.is_constructor()) else {
                return Err(cx.throw_type_error("The superclass is not a constructor."));
            };
            let parent = superclass.get(cx, names::prototype)?;
            if !parent.is_object() && !parent.is_null() {
                return Err(errors::throw_invalid_prototype(cx, parent));
            }
            shape = shape.with_prototype(cx, global, superclass);
            parent
        }
    };
    // Most definitions are evaluated once, and nothing would share the shapes on the way to the last method.
    let prototype = if executable.singleton_watchpoints().state() == WatchpointState::Clear {
        let capacity = JsFinalObject::DEFAULT_INLINE_CAPACITY;
        let spec = ShapeSpec::of::<JsFinalObject>().with_inline_capacity(capacity);
        let shape = Shape::create_dictionary(cx, Some(global), parent, spec);
        JsFinalObject::create(cx, shape).upcast()
    } else {
        cx.new_object_with_prototype(parent.as_object())
    };
    // SAFETY: the caller's.
    let constructor = unsafe { JsFunction::create_with_shape(cx, executable, scope, shape) };
    let attributes = Attributes::DONT_ENUM;
    prototype.put_direct(cx, names::constructor, constructor.into(), attributes);
    constructor.put_direct(cx, names::prototype, prototype.into(), Attributes::CONSTANT);
    if let Some(name) = name {
        constructor.set_function_name(cx, name)?;
    }
    Ok((constructor, prototype))
}
