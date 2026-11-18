//! https://wicg.github.io/observable/
//!
//! An error that leaves a step is a termination or a stack overflow, unless the step says otherwise.

mod convert;
mod observer;

use core::cell::Cell;

use bun_jsc::bindgen::{
    Callable, ClassStructure, JsHeap, JsInterface as _, JsLocal, JsScope, Result,
};
use bun_jsc::{AbortSignal, JSValue};

use crate::api::core::{Atom, EventTarget, List};
use crate::api::events::{is_fully_active, report_exception};
use crate::generated_bindgen::core::{
    AddEventListenerOptionsOrBoolean, DesktopAddEventListenerOptions as AddEventListenerOptions,
};
use crate::generated_bindgen::observable::*;
pub(crate) use convert::ObservedIteration;
pub(crate) use observer::InternalObserver;
use observer::{Handler, Steps};

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Callback<'a> = JsLocal<'a, Callable>;
type Signal<'a> = JsLocal<'a, AbortSignal>;

fn invoke<'a>(cx: Cx<'_, 'a>, callback: JSValue, arguments: &[JSValue]) -> Result<'a, JSValue> {
    Ok(callback.call(cx.global(), JSValue::UNDEFINED, arguments)?)
}

fn reporting<'a, T>(cx: Cx<'_, 'a>, result: Result<'a, T>) -> Result<'a, ()> {
    if let Err(error) = result {
        let error = cx.catch(error)?;
        report_exception(cx, error);
    }
    Ok(())
}

fn invoke_reporting<'a>(
    cx: Cx<'_, 'a>,
    callback: JSValue,
    arguments: &[JSValue],
) -> Result<'a, ()> {
    let result = invoke(cx, callback, arguments);
    reporting(cx, result)
}

fn signal_in<'a>(heap: &JsHeap<'a>, value: Option<JSValue>) -> Option<Signal<'a>> {
    JsLocal::new(heap, value?).as_abort_signal()
}

fn signal_of<'a>(
    heap: &JsHeap<'a>,
    options: &SubscribeOptions<'a>,
) -> Result<'a, Option<Signal<'a>>> {
    if options.signal.is_undefined() {
        return Ok(None);
    }
    options
        .signal
        .as_abort_signal()
        .map(Some)
        .ok_or_else(|| heap.type_error(format_args!("The signal is not an 'AbortSignal'.")))
}

pub(crate) struct Subscriber {
    is_active: Cell<bool>,
}

impl Subscriber {
    fn new<'a>(heap: &JsHeap<'a>) -> &'a Subscriber {
        let subscriber = js_Subscriber::create(
            heap,
            Subscriber {
                is_active: Cell::new(true),
            },
        );
        js_Subscriber::set_signal(subscriber, heap.create_abort_signal().to_js());
        js_Subscriber::set_teardowns(subscriber, List::new(heap).to_js());
        js_Subscriber::set_observers(subscriber, List::new(heap).to_js());
        subscriber
    }

    fn signal<'a>(&self, heap: &JsHeap<'a>) -> Signal<'a> {
        signal_in(heap, js_Subscriber::signal(self)).unwrap_or_else(|| heap.create_abort_signal())
    }

    /// It is replaced, not changed, so it can be walked while scripts run.
    fn observers(&self) -> List<'_> {
        List::from_value(js_Subscriber::observers(self).unwrap_or_default())
    }

    fn teardowns(&self) -> List<'_> {
        List::from_value(js_Subscriber::teardowns(self).unwrap_or_default())
    }

    fn join<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        observer: &'a InternalObserver,
        signal: Option<Signal<'a>>,
    ) {
        let old = self.observers();
        let new = List::from_fn(&cx.heap, old.len() + 1, |at| {
            if at < old.len() {
                old.get(at)
            } else {
                observer.to_js()
            }
        });
        js_Subscriber::set_observers(self, new.to_js());
        if let Some(signal) = signal {
            let leave =
                cx.heap
                    .create_callback(Subscriber::leave, [self.to_js(), observer.to_js()], 0);
            signal.add_algorithm(cx, leave);
        }
    }

    fn leave<'a>(
        cx: Cx<'_, 'a>,
        [this, observer]: [JsLocal<'a>; 2],
        _: u64,
        reason: &[JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        if let Some(this) =
            Subscriber::from_js(&cx.heap, this.to_js()).filter(|it| it.is_active.get())
        {
            let left = List::new(&cx.heap);
            this.observers()
                .values()
                .filter(|it| *it != observer.to_js())
                .for_each(|it| left.push(&cx.heap, it));
            js_Subscriber::set_observers(this, left.to_js());
            if left.is_empty() {
                this.close(cx, first_of(reason))?;
            }
        }
        Ok(JSValue::UNDEFINED)
    }

    /// https://wicg.github.io/observable/#close-a-subscription
    #[optimize(size)]
    fn close<'a>(&'a self, cx: Cx<'_, 'a>, reason: JSValue) -> Result<'a, ()> {
        if !self.is_active.replace(false) {
            return Ok(());
        }
        self.signal(&cx.heap).abort(cx, reason);
        let teardowns = self.teardowns();
        for at in (0..teardowns.len()).rev() {
            if is_fully_active(self.realm(&cx.heap)) {
                invoke_reporting(cx, teardowns.get(at), &[])?;
            }
        }
        teardowns.clear(&cx.heap);
        Ok(())
    }

    #[optimize(size)]
    fn notify<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        mut run: impl FnMut(Cx<'_, 'a>, &'a InternalObserver) -> Result<'a, ()>,
    ) -> Result<'a, ()> {
        cx.check_stack()?;
        let observers = self.observers();
        if !self.is_active.get() {
            js_Subscriber::set_observers(self, List::new(&cx.heap).to_js());
        }
        for observer in observers.values() {
            if let Some(observer) = InternalObserver::from_js(&cx.heap, observer) {
                run(cx, observer)?;
            }
        }
        Ok(())
    }

    #[optimize(size)]
    fn send<'a>(&'a self, cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, ()> {
        if !self.is_active.get() || !is_fully_active(self.realm(&cx.heap)) {
            return Ok(());
        }
        self.notify(cx, |cx, observer| observer.next(cx, value))
    }

    #[optimize(size)]
    fn fail<'a>(&'a self, cx: Cx<'_, 'a>, error: JSValue) -> Result<'a, ()> {
        if !self.is_active.get() {
            report_exception(cx, error);
        } else if is_fully_active(self.realm(&cx.heap)) {
            self.close(cx, error)?;
            self.notify(cx, |cx, observer| observer.error(cx, error))?;
        }
        Ok(())
    }

    fn fail_on<'a>(&'a self, cx: Cx<'_, 'a>, result: Result<'a, ()>) -> Result<'a, ()> {
        result.or_else(|error| {
            let error = cx.catch(error)?;
            self.fail(cx, error)
        })
    }

    pub(crate) fn next<'a>(&'a self, cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, ()> {
        self.send(cx, value.to_js())
    }

    pub(crate) fn error<'a>(&'a self, cx: Cx<'_, 'a>, error: JsLocal<'a>) -> Result<'a, ()> {
        self.fail(cx, error.to_js())
    }

    #[optimize(size)]
    pub(crate) fn complete<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        if self.is_active.get() && is_fully_active(self.realm(&cx.heap)) {
            self.close(cx, JSValue::UNDEFINED)?;
            self.notify(cx, |cx, observer| observer.complete(cx))?;
        }
        Ok(())
    }

    pub(crate) fn add_teardown<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        teardown: Callback<'a>,
    ) -> Result<'a, ()> {
        self.on_teardown(cx, teardown.to_js())
    }

    fn on_teardown<'a>(&'a self, cx: Cx<'_, 'a>, teardown: JSValue) -> Result<'a, ()> {
        if !is_fully_active(self.realm(&cx.heap)) {
            return Ok(());
        }
        if !self.is_active.get() {
            return invoke_reporting(cx, teardown, &[]);
        }
        self.teardowns().push(&cx.heap, teardown);
        Ok(())
    }

    pub(crate) fn get_active(&self) -> bool {
        self.is_active.get()
    }
}

fn first_of(values: &[JsLocal<'_>]) -> JSValue {
    values.first().map_or(JSValue::UNDEFINED, |it| it.to_js())
}

/// The subscribe callback.
#[derive(Clone, Copy)]
enum Start {
    Callback,
    Iterable,
    AsyncIterable,
    Promise,
    Event {
        capture: bool,
        passive: Option<bool>,
    },
    Operator(Steps, u64),
}

pub(crate) struct Observable {
    start: Start,
    /// Its fields are written through a shared reference.
    _fields: core::cell::Cell<()>,
}

impl Observable {
    fn new<'a>(
        heap: &JsHeap<'a>,
        start: Start,
        source: JSValue,
        argument: JSValue,
    ) -> &'a Observable {
        let observable = js_Observable::create(
            heap,
            Observable {
                start,
                _fields: Default::default(),
            },
        );
        js_Observable::set_source(observable, source);
        js_Observable::set_argument(observable, argument);
        observable
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Observable>,
        callback: Callback<'a>,
    ) -> &'a Observable {
        let observable = structure.create(
            heap,
            Observable {
                start: Start::Callback,
                _fields: Default::default(),
            },
        );
        js_Observable::set_source(observable, callback.to_js());
        observable
    }

    /// https://wicg.github.io/observable/#dom-eventtarget-when
    /// https://wicg.github.io/observable/#observable-subscribe-to-an-observable
    #[optimize(size)]
    fn subscribe_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        observer: &'a InternalObserver,
        signal: Option<Signal<'a>>,
    ) -> Result<'a, ()> {
        if !is_fully_active(self.realm(&cx.heap)) {
            return Ok(());
        }
        cx.check_stack()?;
        let current =
            js_Observable::subscriber(self).and_then(|it| Subscriber::from_js(&cx.heap, it));
        if let Some(subscriber) = current.filter(|it| it.is_active.get()) {
            subscriber.join(cx, observer, signal);
            return Ok(());
        }
        let subscriber = Subscriber::new(&cx.heap);
        js_Observable::set_subscriber(self, subscriber.to_js());
        subscriber.join(cx, observer, signal);
        let result = self.start(cx, subscriber);
        subscriber.fail_on(cx, result)
    }

    /// What it throws is for the subscriber.
    fn start<'a>(&'a self, cx: Cx<'_, 'a>, subscriber: &'a Subscriber) -> Result<'a, ()> {
        let [source, argument] = [js_Observable::source(self), js_Observable::argument(self)]
            .map(|it| it.unwrap_or(JSValue::UNDEFINED));
        let (steps, amount) = match self.start {
            Start::Callback => return invoke(cx, source, &[subscriber.to_js()]).map(drop),
            Start::Iterable => return convert::iterate(cx, source, subscriber),
            Start::AsyncIterable => return convert::iterate_asynchronously(cx, source, subscriber),
            Start::Promise => return convert::react(cx, source, subscriber),
            Start::Event { capture, passive } => {
                let (target, event) = (
                    EventTarget::from_js(&cx.heap, source),
                    JsLocal::new(&cx.heap, argument).as_string(),
                );
                let (Some(target), Some(event), true) = (target, event, subscriber.is_active.get())
                else {
                    return Ok(());
                };
                let listener = cx.heap.create_callback(
                    forward_event,
                    [subscriber.to_js(), JSValue::UNDEFINED],
                    0,
                );
                let options = AddEventListenerOptions {
                    capture,
                    passive,
                    once: false,
                    signal: JsLocal::new(&cx.heap, subscriber.signal(&cx.heap).to_js()),
                };
                let (event, listener) = (
                    Atom::from_js_string(&cx.heap, event)?,
                    JsLocal::new(&cx.heap, listener.to_js()).as_any_object(),
                );
                return target.add_event_listener(
                    &cx.heap,
                    &event,
                    listener,
                    Some(AddEventListenerOptionsOrBoolean::Options(options)),
                );
            }
            Start::Operator(steps, amount) => (steps, amount),
        };
        let signal = subscriber.signal(&cx.heap);
        let observer = InternalObserver::new(&cx.heap, steps, subscriber.to_js(), argument, amount);
        match steps {
            Steps::TakeUntil => {
                let stop = InternalObserver::new(
                    &cx.heap,
                    Steps::Notifier,
                    subscriber.to_js(),
                    JSValue::UNDEFINED,
                    0,
                );
                if let Some(notifier) = Observable::from_js(&cx.heap, argument) {
                    notifier.subscribe_with(cx, stop, Some(signal))?;
                }
                if !subscriber.is_active.get() {
                    return Ok(());
                }
            }
            Steps::Take if amount == 0 => return subscriber.complete(cx),
            Steps::Inspect => observer.start_inspecting(cx, signal)?,
            Steps::Finally => subscriber.on_teardown(cx, argument)?,
            _ => {}
        }
        match Observable::from_js(&cx.heap, source) {
            Some(source) => source.subscribe_with(cx, observer, Some(signal)),
            None => Ok(()),
        }
    }

    pub(crate) fn from<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, &'a Observable> {
        convert::to_observable(cx, value.to_js())
    }

    pub(crate) fn subscribe<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        observer: Option<ObserverUnion<'a>>,
        options: &SubscribeOptions<'a>,
    ) -> Result<'a, ()> {
        let handlers = match observer {
            Some(ObserverUnion::Callback(next)) => [Some(next), None, None],
            Some(ObserverUnion::Observer(it)) => [it.next, it.error, it.complete],
            None => [None; 3],
        };
        let observer = InternalObserver::new(
            &cx.heap,
            Steps::Script,
            JSValue::UNDEFINED,
            Handler::list(&cx.heap, &handlers),
            0,
        );
        let signal = signal_of(&cx.heap, options)?;
        self.subscribe_with(cx, observer, signal)
    }

    fn operator<'a>(&self, heap: &JsHeap<'a>, steps: Steps, argument: JSValue) -> &'a Observable {
        Observable::new(heap, Start::Operator(steps, 0), self.to_js(), argument)
    }

    pub(crate) fn take_until<'a>(
        &self,
        cx: Cx<'_, 'a>,
        value: JsLocal<'a>,
    ) -> Result<'a, &'a Observable> {
        let notifier = convert::to_observable(cx, value.to_js())?;
        Ok(self.operator(&cx.heap, Steps::TakeUntil, notifier.to_js()))
    }

    pub(crate) fn take<'a>(&self, heap: &JsHeap<'a>, amount: u64) -> &'a Observable {
        Observable::new(
            heap,
            Start::Operator(Steps::Take, amount),
            self.to_js(),
            JSValue::UNDEFINED,
        )
    }

    pub(crate) fn drop_values<'a>(&self, heap: &JsHeap<'a>, amount: u64) -> &'a Observable {
        Observable::new(
            heap,
            Start::Operator(Steps::Drop, amount),
            self.to_js(),
            JSValue::UNDEFINED,
        )
    }

    pub(crate) fn inspect<'a>(
        &self,
        heap: &JsHeap<'a>,
        inspector: Option<ObservableInspectorUnion<'a>>,
    ) -> &'a Observable {
        let handlers = match inspector {
            Some(ObservableInspectorUnion::Callback(next)) => [Some(next), None, None, None, None],
            Some(ObservableInspectorUnion::Inspector(it)) => {
                [it.next, it.error, it.complete, it.subscribe, it.abort]
            }
            None => [None; 5],
        };
        self.operator(heap, Steps::Inspect, Handler::list(heap, &handlers))
    }

    #[optimize(size)]
    fn consume<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        steps: Steps,
        callback: JSValue,
        initial: JSValue,
        options: &SubscribeOptions<'a>,
    ) -> Result<'a, JSValue> {
        let (given, promise, controller) = (
            signal_of(&cx.heap, options)?,
            cx.heap.create_promise(),
            cx.heap.create_abort_signal(),
        );
        let signal = given.map_or(controller, |given| {
            cx.heap.create_dependent_signal(&[controller, given])
        });
        let reject =
            cx.heap
                .create_callback(reject_promise, [promise.to_js(), JSValue::UNDEFINED], 0);
        signal.add_algorithm(cx, reject);
        if !signal.is_aborted() {
            let observer = InternalObserver::new(&cx.heap, steps, promise.to_js(), callback, 0);
            js_InternalObserver::set_controller(observer, controller.to_js());
            if !initial.is_undefined() {
                js_InternalObserver::set_state(observer, initial);
            }
            self.subscribe_with(cx, observer, Some(signal))?;
        }
        Ok(promise.to_js())
    }

    pub(crate) fn to_array<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &SubscribeOptions<'a>,
    ) -> Result<'a, JSValue> {
        let values = JSValue::create_empty_array(cx.global(), 0)?;
        self.consume(cx, Steps::ToArray, JSValue::UNDEFINED, values, options)
    }

    pub(crate) fn first<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &SubscribeOptions<'a>,
    ) -> Result<'a, JSValue> {
        self.consume(
            cx,
            Steps::First,
            JSValue::UNDEFINED,
            JSValue::UNDEFINED,
            options,
        )
    }

    pub(crate) fn last<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &SubscribeOptions<'a>,
    ) -> Result<'a, JSValue> {
        self.consume(
            cx,
            Steps::Last,
            JSValue::UNDEFINED,
            JSValue::UNDEFINED,
            options,
        )
    }

    pub(crate) fn reduce<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        reducer: Callback<'a>,
        initial: JsLocal<'a>,
        options: &SubscribeOptions<'a>,
    ) -> Result<'a, JSValue> {
        self.consume(cx, Steps::Reduce, reducer.to_js(), initial.to_js(), options)
    }
}

macro_rules! members {
    (operators { $($operator:ident $steps:ident)* } consumers { $($consumer:ident $consuming:ident)* }) => {
        impl Observable {
            $(pub(crate) fn $operator<'a>(&self, heap: &JsHeap<'a>, callback: Callback<'a>) -> &'a Observable {
                self.operator(heap, Steps::$steps, callback.to_js())
            })*
            $(pub(crate) fn $consumer<'a>(&'a self, cx: Cx<'_, 'a>, callback: Callback<'a>, options: &SubscribeOptions<'a>) -> Result<'a, JSValue> {
                self.consume(cx, Steps::$consuming, callback.to_js(), JSValue::UNDEFINED, options)
            })*
        }
    };
}

members! {
    operators { map Map filter Filter flat_map FlatMap switch_map SwitchMap catch Catch finally Finally }
    consumers { for_each ForEach every Every find Find some Some }
}

fn forward_event<'a>(
    cx: Cx<'_, 'a>,
    [subscriber, _]: [JsLocal<'a>; 2],
    _: u64,
    event: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    if let Some(subscriber) = Subscriber::from_js(&cx.heap, subscriber.to_js()) {
        subscriber.send(cx, first_of(event))?;
    }
    Ok(JSValue::UNDEFINED)
}

fn reject_promise<'a>(
    cx: Cx<'_, 'a>,
    [promise, _]: [JsLocal<'a>; 2],
    _: u64,
    reason: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    if let Some(promise) = promise.as_promise() {
        promise.reject(cx, first_of(reason))?;
    }
    Ok(JSValue::UNDEFINED)
}

impl ObservableTarget {
    pub(crate) fn when<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        event: JsLocal<'a, bun_jsc::JSString>,
        options: &ObservableEventListenerOptions,
    ) -> &'a Observable {
        Observable::new(
            heap,
            Start::Event {
                capture: options.capture,
                passive: options.passive,
            },
            self.to_js(),
            event.to_js(),
        )
    }
}
