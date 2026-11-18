//! Futures on the thread of the app. None of them keeps the process alive.

use core::future::Future;
use core::pin::Pin;
use core::task::{Context, Poll, Waker};
use core::time::Duration;
use std::rc::Rc;

use bun_jsc::Strong;
use bun_web::exec::{self, Either};

use crate::prelude::*;

pub(crate) use bun_web::exec::{LocalFuture, Receiver, Sender, oneshot};

pub(crate) fn report(result: JsResult<()>) {
    let _ = bun_ui::report(global(), result);
}

/// It runs up to where it first waits before this returns.
pub(crate) fn spawn(future: impl Future<Output = ()> + 'static) {
    exec::spawn_background(future);
}

pub(crate) async fn sleep(milliseconds: u64) {
    exec::sleep(Duration::from_millis(milliseconds)).await;
}

/// `None` if the time is up first.
pub(crate) async fn within<T>(milliseconds: u64, future: impl Future<Output = T>) -> Option<T> {
    match exec::race(future, sleep(milliseconds)).await {
        Either::First(value) => Some(value),
        Either::Second(()) => None,
    }
}

/// It is cancelled when it is dropped.
pub(crate) struct Timer {
    _cancel: Sender<()>,
}

impl Timer {
    pub(crate) fn new(milliseconds: u64, work: impl FnOnce() + 'static) -> Timer {
        Timer::of(milliseconds, Box::new(work))
    }

    fn of(milliseconds: u64, work: Box<dyn FnOnce()>) -> Timer {
        let (sender, cancelled) = oneshot();
        spawn(async move {
            if within(milliseconds, cancelled).await.is_none() {
                work();
            }
        });
        Timer { _cancel: sender }
    }
}

/// `await value`
pub(crate) fn settled(value: JSValue) -> impl Future<Output = Result<Strong, Strong>> {
    exec::with_js(|cx| exec::settled(cx, JsLocal::new(&cx.heap, value)))
}

/// `await` of what may have been thrown at once.
pub(crate) fn outcome(result: JsResult<JSValue>) -> impl Future<Output = Result<Strong, Strong>> {
    let caught = catch(result).map(|it| it.map(keep).map_err(keep));
    async {
        match caught {
            Ok(Ok(value)) => settled(value.get()).await,
            Ok(Err(thrown)) => Err(thrown),
            Err(_) => core::future::pending().await,
        }
    }
}

/// An `async function`.
pub(crate) fn promise(future: impl Future<Output = JsResult<JSValue>> + 'static) -> JSValue {
    let result = Deferred::new();
    let promise = result.promise();
    spawn(async move {
        let value = future.await;
        report(result.settle(value));
    });
    promise
}

/// The process waits for it.
pub(crate) fn busy_promise(future: impl Future<Output = JsResult<JSValue>> + 'static) -> JSValue {
    let (done, is_done) = oneshot::<()>();
    exec::spawn(async {
        let _ = is_done.await;
    });
    promise(async {
        let result = future.await;
        drop(done);
        result
    })
}

/// For what fails because of the system, when a page has asked for it.
pub(crate) fn or_warning<T>(result: JsResult<T>) -> Option<T> {
    match catch(result) {
        Ok(Ok(value)) => return Some(value),
        Ok(Err(thrown)) => report(message_of(thrown).and_then(|it| warn(&it))),
        Err(error) => report(Err(error)),
    }
    None
}

pub(crate) fn throw(thrown: &Strong) -> bun_jsc::JsError {
    global().throw_value(thrown.get())
}

struct Slot<T> {
    value: Option<T>,
    wakers: Vec<Waker>,
}

/// A result that several may wait for.
pub(crate) struct Later<T>(Rc<RefCell<Slot<T>>>);

impl<T> Clone for Later<T> {
    fn clone(&self) -> Self {
        Later(Rc::clone(&self.0))
    }
}

impl<T> Default for Later<T> {
    fn default() -> Self {
        Later(Rc::new(RefCell::new(Slot {
            value: None,
            wakers: Vec::new(),
        })))
    }
}

impl<T: 'static> Later<T> {
    pub(crate) fn of(future: impl Future<Output = T> + 'static) -> Self {
        let later = Later::default();
        let result = later.clone();
        spawn(async move { result.set(future.await) });
        later
    }

    /// The first one counts.
    pub(crate) fn set(&self, value: T) {
        let mut slot = self.0.borrow_mut();
        slot.value.get_or_insert(value);
        slot.wakers.drain(..).for_each(Waker::wake);
    }

    pub(crate) fn is(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

impl<T: Clone> Future for Later<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let mut slot = self.0.borrow_mut();
        if slot.value.is_none() {
            slot.wakers.push(cx.waker().clone());
        }
        slot.value.clone().map_or(Poll::Pending, Poll::Ready)
    }
}

/// Steps that run one after the other.
#[derive(Default)]
pub(crate) struct Sequence(RefCell<Option<Later<()>>>);

impl Sequence {
    /// The steps that there are now.
    pub(crate) async fn finished(&self) {
        let last = self.0.borrow().clone();
        if let Some(last) = last {
            last.await;
        }
    }

    pub(crate) fn add(&self, step: impl Future<Output = ()> + 'static) {
        let done = Later::default();
        let before = self.0.replace(Some(done.clone()));
        spawn(async move {
            if let Some(before) = before {
                before.await;
            }
            step.await;
            done.set(());
        });
    }
}
