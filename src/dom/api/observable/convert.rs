//! https://wicg.github.io/observable/#observable-convert-to-an-observable

use bun_jsc::bindgen::CommonProperty;

use super::*;

fn get<'a>(cx: Cx<'_, 'a>, value: JSValue, property: CommonProperty) -> Result<'a, JSValue> {
    JsLocal::new(&cx.heap, value)
        .get(cx, property)
        .map(JsLocal::to_js)
}

/// https://tc39.es/ecma262/#sec-getmethod
fn get_method<'a>(
    cx: Cx<'_, 'a>,
    value: JSValue,
    property: CommonProperty,
) -> Result<'a, Option<JSValue>> {
    let method = get(cx, value, property)?;
    if method.is_undefined_or_null() {
        Ok(None)
    } else {
        callable(cx, method).map(Some)
    }
}

fn callable<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, JSValue> {
    if value.is_callable() {
        Ok(value)
    } else {
        Err(cx
            .heap
            .type_error(format_args!("The provided callback is not a function.")))
    }
}

fn object_from<'a>(cx: Cx<'_, 'a>, method: &str, result: JSValue) -> Result<'a, JSValue> {
    if result.is_object() {
        Ok(result)
    } else {
        Err(cx
            .heap
            .type_error(format_args!("Expected {method} to return an object.")))
    }
}

#[optimize(size)]
pub(super) fn to_observable<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, &'a Observable> {
    if let Some(observable) = Observable::from_js(&cx.heap, value) {
        return Ok(observable);
    }
    let start = if !value.is_object() {
        None
    } else if get_method(cx, value, CommonProperty::AsyncIterator)?.is_some() {
        Some(Start::AsyncIterable)
    } else if get_method(cx, value, CommonProperty::Iterator)?.is_some() {
        Some(Start::Iterable)
    } else {
        value.as_promise().map(|_| Start::Promise)
    };
    let start = start.ok_or_else(|| {
        cx.heap
            .type_error(format_args!("Cannot convert value to an Observable."))
    })?;
    Ok(Observable::new(&cx.heap, start, value, JSValue::UNDEFINED))
}

pub(crate) struct ObservedIteration {
    is_async: bool,
    is_done: Cell<bool>,
}

impl ObservedIteration {
    /// `None` if nobody wants the values any more.
    #[optimize(size)]
    fn begin<'a>(
        cx: Cx<'_, 'a>,
        value: JSValue,
        subscriber: &'a Subscriber,
        is_async: bool,
    ) -> Result<'a, Option<&'a ObservedIteration>> {
        if !subscriber.is_active.get() {
            return Ok(None);
        }
        let method = match if is_async {
            get_method(cx, value, CommonProperty::AsyncIterator)?
        } else {
            None
        } {
            Some(method) => method,
            None => get(cx, value, CommonProperty::Iterator).and_then(|it| callable(cx, it))?,
        };
        let iterator = method.call(cx.global(), value, &[])?;
        let iterator = object_from(cx, "the iterator method", iterator)?;
        let next = get(cx, iterator, CommonProperty::Next)?;
        if !subscriber.is_active.get() {
            return Ok(None);
        }
        let iteration = js_ObservedIteration::create(
            &cx.heap,
            ObservedIteration {
                is_async,
                is_done: Cell::new(false),
            },
        );
        js_ObservedIteration::set_subscriber(iteration, subscriber.to_js());
        js_ObservedIteration::set_iterator(iteration, iterator);
        if !is_async {
            js_ObservedIteration::set_next(iteration, next);
        }
        let close =
            cx.heap
                .create_callback(ObservedIteration::aborted, [iteration.to_js(), iterator], 0);
        subscriber.signal(&cx.heap).add_algorithm(cx, close);
        Ok(Some(iteration))
    }

    fn call_return<'a>(
        &self,
        cx: Cx<'_, 'a>,
        iterator: JSValue,
        reason: JSValue,
    ) -> Result<'a, Option<JSValue>> {
        let Some(close) = get_method(cx, iterator, CommonProperty::Return)? else {
            return Ok(None);
        };
        Ok(Some(close.call(
            cx.global(),
            iterator,
            &[reason][..usize::from(self.is_async)],
        )?))
    }

    #[optimize(size)]
    fn aborted<'a>(
        cx: Cx<'_, 'a>,
        [this, iterator]: [JsLocal<'a>; 2],
        _: u64,
        reason: &[JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        let Some(this) =
            ObservedIteration::from_js(&cx.heap, this.to_js()).filter(|it| !it.is_done.get())
        else {
            return Ok(JSValue::UNDEFINED);
        };
        let result = this.call_return(cx, iterator.to_js(), first_of(reason));
        if !this.is_async {
            let result =
                result.and_then(|it| it.map(|it| object_from(cx, "return()", it)).transpose());
            return reporting(cx, result).map(|()| JSValue::UNDEFINED);
        }
        let Some(result) = result.transpose() else {
            return Ok(JSValue::UNDEFINED);
        };
        let (returned, checked) = (promise_for(cx, result)?, cx.heap.create_promise());
        let captured = [checked.to_js(), JSValue::UNDEFINED];
        returned.react(
            &cx.heap,
            Some(cx.heap.create_callback(check_returned, captured, 0)),
            Some(cx.heap.create_callback(reject_promise, captured, 0)),
        );
        Ok(JSValue::UNDEFINED)
    }

    fn call_next<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let iterator = js_ObservedIteration::iterator(self).unwrap_or(JSValue::UNDEFINED);
        let next = match js_ObservedIteration::next(self) {
            Some(next) => next,
            None => get(cx, iterator, CommonProperty::Next)
                .inspect(|it| js_ObservedIteration::set_next(self, *it))?,
        };
        Ok(callable(cx, next)?.call(cx.global(), iterator, &[])?)
    }

    /// `None` at the end.
    fn value_of<'a>(&self, cx: Cx<'_, 'a>, result: JSValue) -> Result<'a, Option<JSValue>> {
        self.is_done.set(true);
        let result = object_from(cx, "next()", result)?;
        if get(cx, result, CommonProperty::Done)?.to_boolean() {
            return Ok(None);
        }
        let value = get(cx, result, CommonProperty::Value)?;
        self.is_done.set(false);
        Ok(Some(value))
    }

    fn step<'a>(&'a self, cx: Cx<'_, 'a>, subscriber: &'a Subscriber) -> Result<'a, ()> {
        if subscriber.is_active.get() {
            let result = self.call_next(cx);
            let [fulfilled, rejected] = [false, true].map(|it| {
                cx.heap.create_callback(
                    ObservedIteration::stepped,
                    [self.to_js(), subscriber.to_js()],
                    it.into(),
                )
            });
            promise_for(cx, result)?.react(&cx.heap, Some(fulfilled), Some(rejected));
        }
        Ok(())
    }

    #[optimize(size)]
    fn stepped<'a>(
        cx: Cx<'_, 'a>,
        [this, subscriber]: [JsLocal<'a>; 2],
        is_rejected: u64,
        result: &[JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        let (Some(this), Some(subscriber)) = (
            ObservedIteration::from_js(&cx.heap, this.to_js()),
            Subscriber::from_js(&cx.heap, subscriber.to_js()),
        ) else {
            return Ok(JSValue::UNDEFINED);
        };
        let result = if is_rejected == 0 {
            this.value_of(cx, first_of(result))
                .and_then(|value| match value {
                    Some(value) => subscriber
                        .send(cx, value)
                        .and_then(|()| this.step(cx, subscriber)),
                    None => subscriber.complete(cx),
                })
        } else {
            this.is_done.set(true);
            subscriber.fail(cx, first_of(result))
        };
        subscriber.fail_on(cx, result).map(|()| JSValue::UNDEFINED)
    }
}

fn promise_for<'a>(
    cx: Cx<'_, 'a>,
    result: Result<'a, JSValue>,
) -> Result<'a, JsLocal<'a, bun_jsc::JSPromise>> {
    result
        .and_then(|it| cx.promise_resolve(it))
        .or_else(|error| {
            let (error, promise) = (cx.catch(error)?, cx.heap.create_promise());
            promise.mark_as_handled();
            promise.reject(cx, error).map(|()| promise)
        })
}

fn check_returned<'a>(
    cx: Cx<'_, 'a>,
    [checked, _]: [JsLocal<'a>; 2],
    _: u64,
    result: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    if let (Err(error), Some(checked)) = (
        object_from(cx, "return()", first_of(result)),
        checked.as_promise(),
    ) {
        let error = cx.catch(error)?;
        checked.reject(cx, error)?;
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn iterate<'a>(
    cx: Cx<'_, 'a>,
    value: JSValue,
    subscriber: &'a Subscriber,
) -> Result<'a, ()> {
    let Some(iteration) = ObservedIteration::begin(cx, value, subscriber, false)? else {
        return Ok(());
    };
    while subscriber.is_active.get() && is_fully_active(subscriber.realm(&cx.heap)) {
        iteration.is_done.set(true);
        let result = iteration.call_next(cx)?;
        match iteration.value_of(cx, result)? {
            Some(value) => subscriber.send(cx, value)?,
            None => return subscriber.complete(cx),
        }
    }
    Ok(())
}

pub(super) fn iterate_asynchronously<'a>(
    cx: Cx<'_, 'a>,
    value: JSValue,
    subscriber: &'a Subscriber,
) -> Result<'a, ()> {
    ObservedIteration::begin(cx, value, subscriber, true)?
        .map_or(Ok(()), |it| it.step(cx, subscriber))
}

pub(super) fn react<'a>(
    cx: Cx<'_, 'a>,
    promise: JSValue,
    subscriber: &'a Subscriber,
) -> Result<'a, ()> {
    if let Some(promise) = JsLocal::new(&cx.heap, promise).as_promise() {
        let [fulfilled, rejected] = [false, true].map(|it| {
            cx.heap
                .create_callback(settled, [subscriber.to_js(), JSValue::UNDEFINED], it.into())
        });
        promise.react(&cx.heap, Some(fulfilled), Some(rejected));
    }
    Ok(())
}

fn settled<'a>(
    cx: Cx<'_, 'a>,
    [subscriber, _]: [JsLocal<'a>; 2],
    is_rejected: u64,
    result: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    if let Some(subscriber) = Subscriber::from_js(&cx.heap, subscriber.to_js()) {
        if is_rejected == 0 {
            subscriber.send(cx, first_of(result))?;
            subscriber.complete(cx)?;
        } else {
            subscriber.fail(cx, first_of(result))?;
        }
    }
    Ok(JSValue::UNDEFINED)
}
