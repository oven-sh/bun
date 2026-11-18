//! The functions that settle promises.

use bun_engine_bytecode::Visibility;
use bun_engine_macros::{cell, native_abi};
use bun_engine_text::{StringRef, names};

use crate::call::native_not_a_constructor;
use crate::vm::Root;
use crate::{
    CallFrame, Cx, FieldArray, Gc, Intrinsic, JsFinalObject, JsFunction, JsObject, JsPromise,
    JsResult, NativeExecutable, NativeFunction, PromiseReaction, PromiseStatus, Value, Visitor,
};

/// A native function without a name that has two values to itself.
#[cell(name = "Function")]
pub struct JsFunctionWithFields {
    base: JsFunction,
    pub fields: FieldArray<Value, 2>,
}

fn executable_for(cx: &Cx, length: u32, function: NativeFunction) -> Gc<NativeExecutable> {
    NativeExecutable::shared(
        cx,
        length,
        StringRef::empty(),
        function,
        native_not_a_constructor,
        Intrinsic::None,
        Visibility::Public,
    )
}

impl JsFunctionWithFields {
    pub fn new(
        cx: &Cx,
        length: u32,
        function: NativeFunction,
        fields: [Value; 2],
    ) -> Gc<JsFunctionWithFields> {
        Self::create(cx, executable_for(cx, length, function), fields)
    }

    #[inline(always)]
    pub fn create(
        cx: &Cx,
        executable: Gc<NativeExecutable>,
        fields: [Value; 2],
    ) -> Gc<JsFunctionWithFields> {
        cx.allocate::<JsFunctionWithFields>(JsFunctionWithFieldsInit {
            base: JsFunction::native_init(cx, cx.function_with_fields_shape(), executable),
            fields,
        })
    }

    /// Those of the function that is running. Panics if it is not one of these.
    #[inline]
    pub fn fields_of_callee(frame: &CallFrame) -> [Value; 2] {
        let callee = frame.callee().cast::<JsFunctionWithFields>();
        [callee.fields().at(0), callee.fields().at(1)]
    }
}

#[derive(Clone, Copy)]
enum Resolver {
    FirstResolve,
    FirstReject,
    Resolve,
    Reject,
}

pub(super) struct ResolverExecutables([Root<NativeExecutable>; 4]);

impl Default for ResolverExecutables {
    fn default() -> ResolverExecutables {
        ResolverExecutables([const { Root::new() }; 4])
    }
}

impl ResolverExecutables {
    pub(super) fn visit(&self, visitor: &mut Visitor) {
        self.0.iter().for_each(|it| it.visit(visitor));
    }
}

impl Resolver {
    #[inline(always)]
    fn create(self, cx: &Cx, fields: [Value; 2]) -> Gc<JsFunctionWithFields> {
        let root = &cx.services.control.resolver_executables.0[self as usize];
        let executable = root.get().unwrap_or_else(|| self.create_executable(cx));
        JsFunctionWithFields::create(cx, executable, fields)
    }

    #[cold]
    #[inline(never)]
    fn create_executable(self, cx: &Cx) -> Gc<NativeExecutable> {
        let functions: [NativeFunction; 4] = [first_resolve, first_reject, resolve, reject];
        let executable = executable_for(cx, 1, functions[self as usize]);
        cx.services.control.resolver_executables.0[self as usize].set(Some(executable));
        executable
    }
}

impl JsPromise {
    /// Calls `resolve`.
    pub fn create_resolve_function(&self, cx: &Cx) -> Gc<JsFunction> {
        (Resolver::FirstResolve.create(cx, [self.into(), Value::UNDEFINED])).upcast()
    }

    /// Calls `reject`.
    pub fn create_reject_function(&self, cx: &Cx) -> Gc<JsFunction> {
        (Resolver::FirstReject.create(cx, [self.into(), Value::UNDEFINED])).upcast()
    }
}

impl JsPromise {
    pub fn invoke_then(cx: &mut Cx, this: Value, arguments: &[Value]) -> JsResult<Value> {
        let then = this.get(cx, names::then)?;
        if !then.is_callable() {
            return Err(cx.throw_type_error("|this|.then is not a function"));
        }
        cx.call(then, this, arguments)
    }

    /// What thenFinally and catchFinally return, given what the callback has returned.
    pub fn pass_on_after(
        cx: &mut Cx,
        constructor: Gc<JsObject>,
        returned: Value,
        status: PromiseStatus,
        value: Value,
    ) -> JsResult<Value> {
        let promise = JsPromise::resolve_with_constructor(cx, constructor, returned)?;
        let pass_on: NativeFunction = match status {
            PromiseStatus::Rejected => throw_reason,
            _ => return_value,
        };
        let pass_on = JsFunctionWithFields::new(cx, 0, pass_on, [value, Value::UNDEFINED]);
        Self::invoke_then(cx, promise.into(), &[pass_on.into()])
    }
}

#[native_abi]
fn return_value(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(JsFunctionWithFields::fields_of_callee(frame)[0])
}

#[native_abi]
fn throw_reason(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Err(cx.throw(JsFunctionWithFields::fields_of_callee(frame)[0]))
}

#[native_abi]
fn first_resolve(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let [promise, _] = JsFunctionWithFields::fields_of_callee(frame);
    promise.cast::<JsPromise>().resolve(cx, frame.argument(0))?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn first_reject(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let [promise, _] = JsFunctionWithFields::fields_of_callee(frame);
    promise.cast::<JsPromise>().reject(cx, frame.argument(0));
    Ok(Value::UNDEFINED)
}

/// CreateResolvingFunctions for a promise that follows a thenable, or for a `PromiseReaction` in place of one. Each has
/// the target and, until one of them is called, the other.
pub(super) fn create_resolving_functions(cx: &Cx, target: Value) -> [Value; 2] {
    let resolve = Resolver::Resolve.create(cx, [target, Value::NULL]);
    let reject = Resolver::Reject.create(cx, [target, resolve.into()]);
    resolve.fields().set(1, reject.into());
    [resolve.into(), reject.into()]
}

fn take_target(frame: &CallFrame) -> Option<Value> {
    let callee = frame.callee().cast::<JsFunctionWithFields>();
    let other = callee.fields().at(1).downcast::<JsFunctionWithFields>()?;
    callee.fields().set(1, Value::NULL);
    other.fields().set(1, Value::NULL);
    Some(callee.fields().at(0))
}

#[native_abi]
fn resolve(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(target) = take_target(frame) {
        let resolution = frame.argument(0);
        match target.downcast::<JsPromise>() {
            Some(promise) => promise.resolve_promise(cx, resolution)?,
            None => (target.cast::<PromiseReaction>().describe()).resolve(cx, resolution)?,
        }
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn reject(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(target) = take_target(frame) {
        let reason = frame.argument(0);
        match target.downcast::<JsPromise>() {
            Some(promise) => promise.reject_promise(cx, reason),
            None => target.cast::<PromiseReaction>().describe().queue(
                cx,
                &cx.global(),
                PromiseStatus::Rejected,
                reason,
            ),
        }
    }
    Ok(Value::UNDEFINED)
}

#[derive(Clone, Copy)]
pub struct PromiseCapability {
    pub promise: Gc<JsObject>,
    pub resolve: Gc<JsObject>,
    pub reject: Gc<JsObject>,
}

impl PromiseCapability {
    /// NewPromiseCapability
    #[inline(always)]
    pub fn new(cx: &mut Cx, constructor: Value) -> JsResult<PromiseCapability> {
        if constructor == cx.promise_constructor().into() {
            let promise = JsPromise::new(cx);
            return Ok(PromiseCapability {
                promise: promise.upcast(),
                resolve: promise.create_resolve_function(cx).upcast(),
                reject: promise.create_reject_function(cx).upcast(),
            });
        }
        Self::of_other_constructor(cx, constructor)
    }

    #[inline(never)]
    fn of_other_constructor(cx: &mut Cx, constructor: Value) -> JsResult<PromiseCapability> {
        if !constructor.is_constructor() {
            return Err(cx.throw_type_error("argument is not a constructor"));
        }
        let executor = JsFunctionWithFields::new(cx, 2, execute, [Value::UNDEFINED; 2]);
        let promise = cx.construct(constructor, &[executor.into()], constructor)?;
        let callable = |index, message: &'static str| {
            let function = executor.fields().at(index).as_object();
            (function.filter(|it| it.is_callable())).ok_or_else(|| cx.throw_type_error(message))
        };
        Ok(PromiseCapability {
            promise,
            resolve: callable(0, "executor did not take a resolve function")?,
            reject: callable(1, "executor did not take a reject function")?,
        })
    }

    /// What `Promise.withResolvers` returns.
    #[inline]
    pub fn to_object(self, cx: &Cx) -> Gc<JsObject> {
        let values = [self.resolve, self.reject, self.promise].map(Value::from);
        JsFinalObject::create_with_values(cx, cx.promise_capability_shape(), &values).upcast()
    }
}

#[native_abi]
fn execute(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let callee = frame.callee().cast::<JsFunctionWithFields>();
    if !callee.fields().at(0).is_undefined() {
        return Err(cx.throw_type_error("resolve function is already set"));
    }
    if !callee.fields().at(1).is_undefined() {
        return Err(cx.throw_type_error("reject function is already set"));
    }
    callee.fields().set(0, frame.argument(0));
    callee.fields().set(1, frame.argument(1));
    Ok(Value::UNDEFINED)
}
