//! https://wicg.github.io/observable/#internal-observer

use super::*;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Steps {
    Script,
    Forward,
    TakeUntil,
    Notifier,
    Map,
    Filter,
    Take,
    Drop,
    FlatMap,
    FlatMapInner,
    SwitchMap,
    SwitchMapInner,
    Inspect,
    Catch,
    Finally,
    ToArray,
    ForEach,
    Every,
    First,
    Last,
    Find,
    Some,
    Reduce,
}

#[derive(Clone, Copy)]
pub(super) enum Handler {
    Next,
    Error,
    Complete,
    Subscribe,
    Abort,
}

impl Handler {
    pub(super) fn list(heap: &JsHeap<'_>, handlers: &[Option<Callback<'_>>]) -> JSValue {
        List::from_fn(heap, handlers.len() as u32, |at| {
            handlers[at as usize].map_or(JSValue::UNDEFINED, JsLocal::to_js)
        })
        .to_js()
    }
}

/// The target is a subscriber or a promise. The callback of an inner observer is the outer one.
pub(crate) struct InternalObserver {
    steps: Steps,
    /// The index of the next value, or how many are left to take or drop.
    count: Cell<u64>,
    has_inner: Cell<bool>,
    is_source_complete: Cell<bool>,
    wants_abort: Cell<bool>,
}

impl InternalObserver {
    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        steps: Steps,
        target: JSValue,
        callback: JSValue,
        count: u64,
    ) -> &'a InternalObserver {
        let [has_inner, is_source_complete, wants_abort] = [false, false, true].map(Cell::new);
        let observer = js_InternalObserver::create(
            heap,
            InternalObserver {
                steps,
                count: Cell::new(count),
                has_inner,
                is_source_complete,
                wants_abort,
            },
        );
        js_InternalObserver::set_target(observer, target);
        js_InternalObserver::set_callback(observer, callback);
        observer
    }

    fn target(&self) -> JSValue {
        js_InternalObserver::target(self).unwrap_or(JSValue::UNDEFINED)
    }

    fn callback(&self) -> JSValue {
        js_InternalObserver::callback(self).unwrap_or(JSValue::UNDEFINED)
    }

    fn handler(&self, handler: Handler) -> Option<JSValue> {
        Some(List::from_value(self.callback()).get(handler as u32)).filter(|it| !it.is_undefined())
    }

    fn next_index(&self) -> JSValue {
        JSValue::js_number(self.count.replace(self.count.get() + 1) as f64)
    }

    fn call<'a>(&self, cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, JSValue> {
        invoke(cx, self.callback(), &[value, self.next_index()])
    }

    pub(super) fn next<'a>(&'a self, cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, ()> {
        if let Some(subscriber) = Subscriber::from_js(&cx.heap, self.target()) {
            let result = self.operate(cx, subscriber, value);
            return subscriber.fail_on(cx, result);
        }
        if self.steps == Steps::Script {
            return self
                .handler(Handler::Next)
                .map_or(Ok(()), |next| invoke_reporting(cx, next, &[value]));
        }
        let (outcome, reason) = match self.consume(cx, value) {
            Ok(None) => return Ok(()),
            Ok(Some(result)) => (Ok(result), JSValue::UNDEFINED),
            Err(error) => cx.catch(error).map(|it| (Err(it), it))?,
        };
        self.settle(cx, outcome)?;
        signal_in(&cx.heap, js_InternalObserver::controller(self))
            .into_iter()
            .for_each(|it| it.abort(cx, reason));
        Ok(())
    }

    /// What it throws is for the subscriber.
    fn operate<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        subscriber: &'a Subscriber,
        value: JSValue,
    ) -> Result<'a, ()> {
        match self.steps {
            Steps::Notifier => subscriber.complete(cx),
            Steps::Map => {
                let mapped = self.call(cx, value)?;
                subscriber.send(cx, mapped)
            }
            Steps::Filter if !self.call(cx, value)?.to_boolean() => Ok(()),
            Steps::Take => {
                subscriber.send(cx, value)?;
                self.count.set(self.count.get().wrapping_sub(1));
                if self.count.get() == 0 {
                    subscriber.complete(cx)
                } else {
                    Ok(())
                }
            }
            Steps::Drop if self.count.get() > 0 => {
                self.count.set(self.count.get() - 1);
                Ok(())
            }
            Steps::FlatMap if self.has_inner.replace(true) => {
                self.queue(&cx.heap).push(&cx.heap, value);
                Ok(())
            }
            Steps::FlatMap => {
                self.open(cx, value, Steps::FlatMapInner, subscriber.signal(&cx.heap))
            }
            Steps::SwitchMap => {
                if self.has_inner.replace(true) {
                    signal_in(&cx.heap, js_InternalObserver::controller(self))
                        .into_iter()
                        .for_each(|it| it.abort(cx, JSValue::UNDEFINED));
                }
                let controller = cx.heap.create_abort_signal();
                js_InternalObserver::set_controller(self, controller.to_js());
                let signal = cx
                    .heap
                    .create_dependent_signal(&[controller, subscriber.signal(&cx.heap)]);
                self.open(cx, value, Steps::SwitchMapInner, signal)
            }
            Steps::Inspect => {
                self.tap(cx, Handler::Next, &[value])?;
                subscriber.send(cx, value)
            }
            _ => subscriber.send(cx, value),
        }
    }

    fn queue<'a>(&self, heap: &JsHeap<'a>) -> List<'a> {
        js_InternalObserver::state(self).map_or_else(
            || {
                let queue = List::new(heap);
                js_InternalObserver::set_state(self, queue.to_js());
                queue
            },
            List::from_value,
        )
    }

    #[optimize(size)]
    fn open<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: JSValue,
        steps: Steps,
        signal: Signal<'a>,
    ) -> Result<'a, ()> {
        let mapped = if steps == Steps::Forward {
            invoke(cx, self.callback(), &[value])?
        } else {
            self.call(cx, value)?
        };
        let inner = convert::to_observable(cx, mapped)?;
        inner.subscribe_with(
            cx,
            InternalObserver::new(&cx.heap, steps, self.target(), self.to_js(), 0),
            Some(signal),
        )
    }

    fn tap<'a>(&self, cx: Cx<'_, 'a>, handler: Handler, arguments: &[JSValue]) -> Result<'a, ()> {
        let Some(handler) = self.handler(handler) else {
            return Ok(());
        };
        invoke(cx, handler, arguments)
            .map(drop)
            .inspect_err(|_| self.wants_abort.set(false))
    }

    pub(super) fn start_inspecting<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        signal: Signal<'a>,
    ) -> Result<'a, ()> {
        self.tap(cx, Handler::Subscribe, &[])?;
        if let Some(abort) = self.handler(Handler::Abort) {
            let algorithm =
                cx.heap
                    .create_callback(InternalObserver::aborted, [self.to_js(), abort], 0);
            signal.add_algorithm(cx, algorithm);
        }
        Ok(())
    }

    #[optimize(size)]
    fn aborted<'a>(
        cx: Cx<'_, 'a>,
        [this, abort]: [JsLocal<'a>; 2],
        _: u64,
        reason: &[JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        if InternalObserver::from_js(&cx.heap, this.to_js()).is_some_and(|it| it.wants_abort.get())
        {
            invoke_reporting(cx, abort.to_js(), &[first_of(reason)])?;
        }
        Ok(JSValue::UNDEFINED)
    }

    /// `Some` is what the promise is resolved with. What it throws rejects it.
    #[optimize(size)]
    fn consume<'a>(&self, cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, Option<JSValue>> {
        let state = js_InternalObserver::state(self);
        Ok(match self.steps {
            Steps::ToArray => state
                .map_or(Ok(()), |all| all.push(cx.global(), value))
                .map(|()| None)?,
            Steps::ForEach => self.call(cx, value).map(|_| None)?,
            Steps::Every => (!self.call(cx, value)?.to_boolean()).then_some(JSValue::FALSE),
            Steps::Find => self.call(cx, value)?.to_boolean().then_some(value),
            Steps::Some => self.call(cx, value)?.to_boolean().then_some(JSValue::TRUE),
            Steps::First => Some(value),
            steps => {
                let index = self.next_index();
                let kept = match state.filter(|_| steps == Steps::Reduce) {
                    Some(sum) => invoke(cx, self.callback(), &[sum, value, index])?,
                    None => value,
                };
                js_InternalObserver::set_state(self, kept);
                None
            }
        })
    }

    fn settle<'a>(
        &self,
        cx: Cx<'_, 'a>,
        outcome: core::result::Result<JSValue, JSValue>,
    ) -> Result<'a, ()> {
        let Some(promise) = JsLocal::new(&cx.heap, self.target()).as_promise() else {
            return Ok(());
        };
        match outcome {
            Ok(value) => promise.resolve(cx, value),
            Err(reason) => promise.reject(cx, reason),
        }
    }

    pub(super) fn error<'a>(&'a self, cx: Cx<'_, 'a>, error: JSValue) -> Result<'a, ()> {
        let Some(subscriber) = Subscriber::from_js(&cx.heap, self.target()) else {
            if self.steps != Steps::Script {
                return self.settle(cx, Err(error));
            }
            let Some(handler) = self.handler(Handler::Error) else {
                report_exception(cx, error);
                return Ok(());
            };
            return invoke_reporting(cx, handler, &[error]);
        };
        let result = match self.steps {
            Steps::Notifier => subscriber.complete(cx),
            Steps::Catch => self.open(cx, error, Steps::Forward, subscriber.signal(&cx.heap)),
            Steps::Inspect => {
                self.wants_abort.set(false);
                self.tap(cx, Handler::Error, &[error])
                    .and_then(|()| subscriber.fail(cx, error))
            }
            _ => subscriber.fail(cx, error),
        };
        subscriber.fail_on(cx, result)
    }

    #[optimize(size)]
    pub(super) fn complete<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        let Some(subscriber) = Subscriber::from_js(&cx.heap, self.target()) else {
            return self.finish(cx);
        };
        let result = match self.steps {
            Steps::Notifier => Ok(()),
            Steps::FlatMap | Steps::SwitchMap => {
                self.is_source_complete.set(true);
                if self.has_inner.get() {
                    Ok(())
                } else {
                    subscriber.complete(cx)
                }
            }
            Steps::FlatMapInner | Steps::SwitchMapInner => {
                let Some(outer) = InternalObserver::from_js(&cx.heap, self.callback()) else {
                    return Ok(());
                };
                match js_InternalObserver::state(outer)
                    .map(List::from_value)
                    .filter(|it| !it.is_empty())
                {
                    Some(queue) => {
                        let value = queue.get(0);
                        queue.remove_range(&cx.heap, 0, 1);
                        outer.open(cx, value, self.steps, subscriber.signal(&cx.heap))
                    }
                    None => {
                        outer.has_inner.set(false);
                        if outer.is_source_complete.get() {
                            subscriber.complete(cx)
                        } else {
                            Ok(())
                        }
                    }
                }
            }
            Steps::Inspect => {
                self.wants_abort.set(false);
                self.tap(cx, Handler::Complete, &[])
                    .and_then(|()| subscriber.complete(cx))
            }
            _ => subscriber.complete(cx),
        };
        subscriber.fail_on(cx, result)
    }

    fn finish<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        let outcome = match (self.steps, js_InternalObserver::state(self)) {
            (Steps::Script, _) => {
                return self
                    .handler(Handler::Complete)
                    .map_or(Ok(()), |complete| invoke_reporting(cx, complete, &[]));
            }
            (_, Some(state)) => Ok(state),
            (Steps::Every, _) => Ok(JSValue::TRUE),
            (Steps::Some, _) => Ok(JSValue::FALSE),
            (Steps::First | Steps::Last, _) => {
                Err(cx.heap.range_error(format_args!("No values in Observable")))
            }
            (Steps::Reduce, _) => Err(cx.heap.type_error(format_args!(
                "Reduce of empty Observable with no initial value"
            ))),
            _ => Ok(JSValue::UNDEFINED),
        };
        let outcome = match outcome {
            Ok(value) => Ok(value),
            Err(error) => Err(cx.catch(error)?),
        };
        self.settle(cx, outcome)
    }
}
