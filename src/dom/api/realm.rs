//! What the realm of an object does for it.

use core::time::Duration;
use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::bindgen::{self, Error, JsHeap, JsInterface as _, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, Strong};
use bun_web::client::Client;
use bun_web::exec::{self, LocalFuture, oneshot, with_realm};
use bun_web::held::Held;
use bun_web::realm::Realm;
use bun_web::storage::Storage;
use bun_web::tasks::{self, Priority, TaskId, Work};

use super::core::global_of;
use super::events::{WindowTarget, swap_top_level};

type Cx<'c, 'a> = &'c mut JsScope<'a>;

pub(crate) fn realm_of<'h>(heap: &'h JsHeap<'_>) -> &'h Realm {
    Realm::of(global_of(heap)).expect("the realm of an interface of the web")
}

pub(crate) fn last_client_of(heap: &JsHeap<'_>) -> Option<Rc<Client>> {
    Realm::of(global_of(heap))?.client()
}

/// Of a document that is fully active, or of a worker.
pub(crate) fn client_of(heap: &JsHeap<'_>) -> Option<Rc<Client>> {
    Realm::of(global_of(heap))
        .filter(|it| !it.has_let_go())?
        .client()
}

/// <https://storage.spec.whatwg.org/#storage-shelf>
pub(crate) struct Shelf {
    pub(crate) storage: Arc<Storage>,
    pub(crate) bucket: Vec<u8>,
}

pub(crate) enum NoShelf {
    Inactive,
    OpaqueOrigin,
}

/// <https://storage.spec.whatwg.org/#obtain-a-local-storage-shelf>
pub(crate) fn shelf_of<'a>(cx: Cx<'_, 'a>, scope: &'a WindowTarget) -> Result<Shelf, NoShelf> {
    let realm = scope.realm(&cx.heap);
    if Realm::of(global_of(realm)).is_none() {
        return Ok(Shelf {
            storage: Storage::of_program(
                scope
                    .host()
                    .storage_directory()
                    .as_ref()
                    .map(String::as_bytes),
            ),
            bucket: Vec::new(),
        });
    }
    let client = client_of(realm).ok_or(NoShelf::Inactive)?;
    if client.origin().is_opaque() {
        Err(NoShelf::OpaqueOrigin)
    } else {
        Ok(Shelf {
            storage: Arc::clone(&client.session.storage),
            bucket: client.bucket(),
        })
    }
}

pub(crate) fn spawn(heap: &JsHeap<'_>, future: impl Future<Output = ()> + 'static) {
    spawn_boxed(heap, Box::pin(future));
}

fn spawn_boxed(heap: &JsHeap<'_>, future: LocalFuture<'static, ()>) {
    match Realm::of(global_of(heap)) {
        Some(realm) => realm.spawn(future),
        None => exec::spawn(future),
    }
}

/// Until the realm stops.
pub(crate) fn hold<T: 'static>(heap: &JsHeap<'_>, value: T) -> Held<T> {
    match Realm::of(global_of(heap)) {
        Some(realm) => realm.hold(value),
        None => Rc::new(Some(value).into()),
    }
}

/// `None` if it takes too long.
pub(crate) fn block_on<T: 'static>(
    cx: Cx<'_, '_>,
    future: impl Future<Output = T> + 'static,
    timeout: Option<Duration>,
) -> Option<T> {
    if cx.heap.is_window() {
        exec::block_pages(cx.global(), future)
    } else {
        exec::park_until(future, timeout)
    }
}

/// Microtasks run after each listener of the events that `steps` dispatch.
pub(crate) fn queue_task<const N: usize>(
    heap: &JsHeap<'_>,
    values: [JSValue; N],
    steps: impl for<'a> FnOnce(Cx<'_, 'a>, [JsLocal<'a>; N]) + 'static,
) {
    queue_task_after(heap, 0.0, values, steps);
}

pub(crate) fn queue_task_after<const N: usize>(
    heap: &JsHeap<'_>,
    milliseconds: f64,
    values: [JSValue; N],
    steps: impl for<'a> FnOnce(Cx<'_, 'a>, [JsLocal<'a>; N]) + 'static,
) -> Option<TaskId> {
    let run = |global: &JSGlobalObject, values: &[JSValue]| {
        let was_at_top_level = swap_top_level(true);
        with_realm(global, |cx| {
            let values = core::array::from_fn(|at| JsLocal::new(&cx.heap, values[at]));
            steps(cx, values);
        });
        swap_top_level(was_at_top_level);
        Ok(())
    };
    match Realm::of(global_of(heap)) {
        Some(realm) => realm.queue_task_after(milliseconds, &values, run),
        None => Some(tasks::post(
            global_of(heap),
            Priority::Host,
            Work::Once(Box::new(run)),
            &values,
        )),
    }
}

/// An object, for a future that its realm has spawned.
pub(crate) struct Kept(exec::Realm, Strong);

impl Kept {
    pub(crate) fn new(cx: Cx<'_, '_>, object: JSValue) -> Kept {
        Kept(exec::Realm::of(cx), Strong::create(object, cx.global()))
    }

    pub(crate) fn enter<R>(&self, steps: impl for<'a> FnOnce(Cx<'_, 'a>, JsLocal<'a>) -> R) -> R {
        self.0.enter(|cx| {
            let object = JsLocal::new(&cx.heap, self.1.get());
            steps(cx, object)
        })
    }

    pub(crate) fn queue_task(&self, steps: impl for<'a> FnOnce(Cx<'_, 'a>, JsLocal<'a>) + 'static) {
        self.0
            .enter(|cx| queue_task(&cx.heap, [self.1.get()], |cx, [object]| steps(cx, object)));
    }

    pub(crate) async fn in_task<T: 'static>(
        &self,
        steps: impl for<'a> FnOnce(Cx<'_, 'a>, JsLocal<'a>) -> T + 'static,
    ) -> Option<T> {
        let (sender, result) = oneshot();
        self.queue_task(|cx, object| sender.send(steps(cx, object)));
        result.await
    }
}

/// It is settled in a task, with what `convert` makes of the result.
pub(crate) fn promise_for<'a, T: 'static>(
    cx: Cx<'_, 'a>,
    future: impl Future<Output = T> + 'static,
    convert: impl for<'b> FnOnce(Cx<'_, 'b>, T) -> bindgen::Result<'b, JSValue> + 'static,
) -> JSValue {
    let promise = cx.heap.create_promise().to_js();
    let kept = Kept::new(cx, promise);
    spawn(&cx.heap, async move {
        let result = future.await;
        kept.queue_task(|cx, promise| {
            let Some(promise) = promise.as_promise() else {
                return;
            };
            let settled = match convert(cx, result) {
                Ok(value) => promise.resolve(cx, value),
                Err(error) => cx
                    .catch(error)
                    .and_then(|reason| promise.reject(cx, reason)),
            };
            exec::report(cx, settled);
        });
    });
    promise
}

pub(crate) fn quota_exceeded<'a>(cx: Cx<'_, 'a>, message: &str) -> Error<'a> {
    quota_exceeded_with(cx, message, None)
}

/// With the quota, and what was requested.
pub(crate) fn quota_exceeded_with<'a>(
    cx: Cx<'_, 'a>,
    message: &str,
    amounts: Option<[f64; 2]>,
) -> Error<'a> {
    let error = super::site::quota_exceeded(
        &cx.heap,
        message.into(),
        amounts.map(|it| it[0]),
        amounts.map(|it| it[1]),
    );
    Error::from_value(JsLocal::new(&cx.heap, error.to_js()))
}
