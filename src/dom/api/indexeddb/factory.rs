//! <https://w3c.github.io/IndexedDB/#factory-interface>

use std::sync::Arc;

use bun_web::exec::oneshot;

use super::request::error_event;
use super::*;
use crate::api::events::WindowTarget;
use crate::api::realm::{NoShelf, Shelf, promise_for, shelf_of};
use crate::api::window::{Window, WorkerGlobalScope};

fn factory_for<'a>(heap: &JsHeap<'a>, scope: &'a WindowTarget) -> &'a IDBFactory {
    let factory = js_IDBFactory::create(scope.realm(heap), Default::default());
    js_IDBFactory::set_scope(factory, Some(scope));
    factory
}

impl Window {
    pub(crate) fn get_indexed_db<'a>(&'a self, heap: &JsHeap<'a>) -> &'a IDBFactory {
        factory_for(heap, self)
    }
}

impl WorkerGlobalScope {
    pub(crate) fn get_indexed_db<'a>(&'a self, heap: &JsHeap<'a>) -> &'a IDBFactory {
        factory_for(heap, self)
    }
}

fn fail<'a>(cx: Cx<'_, 'a>, request: JsLocal<'a>, error: Error<'a>) {
    let request = handle::<IDBRequest>(request);
    if let Ok(error) = cx.catch(error) {
        request.settle(Err(error));
        dispatch_along(cx, &[request], error_event(&cx.heap));
    }
}

async fn schema_or_failure(request: &Kept, turn: &stored::Turn) -> Option<Arc<stored::Schema>> {
    let failure = match turn.schema().await {
        Ok(schema) => return Some(schema),
        Err(failure) => failure,
    };
    let report = request.in_task(move |cx, request| {
        let error = error_of(cx, failure);
        fail(cx, request, error);
    });
    report.await.and(None)
}

async fn until_alone(
    request: &Kept,
    turn: &stored::Turn,
    old_version: u64,
    new_version: Option<u64>,
) {
    if turn.announce(new_version).await {
        let block = request.in_task(move |cx, request| {
            dispatch_along(
                cx,
                &[handle::<IDBRequest>(request)],
                IDBVersionChangeEvent::new(&cx.heap, atom!("blocked"), old_version, new_version),
            );
        });
        block.await;
    }
    turn.until_unused().await;
}

fn succeed<'a>(cx: Cx<'_, 'a>, request: JsLocal<'a>, result: JSValue, event: &'a Event) {
    let request = handle::<IDBRequest>(request);
    request.settle(Ok(result));
    dispatch_along(cx, &[request], event);
}

/// <https://w3c.github.io/IndexedDB/#open-a-database-connection>
async fn open(
    request: Kept,
    database: stored::Database,
    name: DomString,
    version: Option<u64>,
) -> Option<()> {
    let turn = database.take_turn().await?;
    let mut schema = schema_or_failure(&request, &turn).await?;
    let (old_version, version) = (
        schema.version,
        version.unwrap_or_else(|| schema.version.max(1)),
    );
    if version < old_version {
        let refuse = request.in_task(move |cx, request| {
            let error = cx.heap.dom_exception(DomError::VersionError, format_args!("The requested version ({version}) is less than the existing version ({old_version})."));
            fail(cx, request, error);
        });
        return refuse.await;
    }
    if version == old_version {
        let (id, connection) = IDBDatabase::connect(&turn);
        let finish = request.in_task(move |cx, request| {
            let db = IDBDatabase::new(&cx.heap, name, id, connection, &schema);
            succeed(
                cx,
                request,
                db.to_js(),
                Event::new(&cx.heap, atom!("success"), EventInit::default()),
            );
        });
        return finish.await;
    }
    until_alone(&request, &turn, old_version, Some(version)).await;
    schema = schema_or_failure(&request, &turn).await?;
    let (id, connection) = IDBDatabase::connect(&turn);
    let (transaction, started) =
        connection.begin(stored::Mode::VersionChange, schema.tables().collect());
    if let Some(started) = started
        && let Err(failure) = started.await?
    {
        let report = request.in_task(move |cx, request| {
            let error = error_of(cx, failure);
            fail(cx, request, error);
        });
        return report.await;
    }
    let (sender, finished) = oneshot();
    request.queue_task(move |cx, request| {
        let db = IDBDatabase::new(&cx.heap, name, id, connection, &schema);
        IDBTransaction::upgrade(cx, db, handle(request), version, transaction, sender);
    });
    finished.await
}

pub(super) fn finish_upgrade<'a>(
    cx: Cx<'_, 'a>,
    request: JsLocal<'a>,
    db: &'a IDBDatabase,
    is_committed: bool,
) {
    if is_committed && !db.is_closed() {
        return succeed(
            cx,
            request,
            db.to_js(),
            Event::new(&cx.heap, atom!("success"), EventInit::default()),
        );
    }
    db.close();
    let error = dom_error(
        &cx.heap,
        DomError::AbortError,
        "The version change transaction was aborted, or the connection was closed.",
    );
    fail(cx, request, error);
}

/// <https://w3c.github.io/IndexedDB/#delete-a-database>
async fn delete(request: Kept, database: stored::Database) -> Option<()> {
    let turn = database.take_turn().await?;
    let old_version = schema_or_failure(&request, &turn).await?.version;
    until_alone(&request, &turn, old_version, None).await;
    let erased = turn.erase().await;
    let finish = request.in_task(move |cx, request| match erased {
        Ok(()) => succeed(
            cx,
            request,
            JSValue::UNDEFINED,
            IDBVersionChangeEvent::new(&cx.heap, atom!("success"), old_version, None),
        ),
        Err(failure) => {
            let error = error_of(cx, failure);
            fail(cx, request, error);
        }
    });
    finish.await
}

impl IDBFactory {
    fn shelf<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Shelf> {
        shelf_of(cx, js_IDBFactory::scope(self).expect("set when it is made")).map_err(
            |it| match it {
                NoShelf::Inactive => dom_error(
                    &cx.heap,
                    DomError::InvalidStateError,
                    "The context is not active.",
                ),
                NoShelf::OpaqueOrigin => dom_error(
                    &cx.heap,
                    DomError::SecurityError,
                    "Access to the Indexed Database API is denied in this context.",
                ),
            },
        )
    }

    fn start<'a, F: Future<Output = Option<()>> + 'static>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &DomString,
        steps: impl FnOnce(Kept, stored::Database) -> F,
    ) -> Result<'a, &'a IDBOpenDBRequest> {
        let shelf = self.shelf(cx)?;
        let request = js_IDBOpenDBRequest::create(&cx.heap, IDBRequest::default());
        let future = steps(
            Kept::new(cx, request.to_js()),
            shelf.storage.database(&shelf.bucket, key_of_string(name)),
        );
        spawn(&cx.heap, async { future.await.unwrap_or_default() });
        Ok(request)
    }

    pub(crate) fn open<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &DomString,
        version: Option<u64>,
    ) -> Result<'a, &'a IDBOpenDBRequest> {
        if version == Some(0) {
            return Err(cx
                .heap
                .type_error(format_args!("The version provided must not be 0.")));
        }
        self.start(cx, name, |request, database| {
            open(request, database, name.clone(), version)
        })
    }

    pub(crate) fn delete_database<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &DomString,
    ) -> Result<'a, &'a IDBOpenDBRequest> {
        self.start(cx, name, delete)
    }

    pub(crate) fn databases<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let shelf = self.shelf(cx)?;
        Ok(promise_for(
            cx,
            shelf.storage.databases(shelf.bucket),
            |cx, found| {
                let found = found.map_err(|it| error_of(cx, it.into()))?;
                let describe = |heap: &JsHeap<'_>, (name, version): (Key, u64)| {
                    let info = heap.create_empty_object().to_js();
                    info.put(
                        global_of(heap),
                        b"name",
                        string_of_key(&name).to_js(heap).to_js(),
                    );
                    info.put(
                        global_of(heap),
                        b"version",
                        JSValue::js_number(version as f64),
                    );
                    info
                };
                Ok(bindgen::to_js::array(&cx.heap, found, |heap, it| {
                    Ok(JsLocal::new(heap, describe(heap, it)))
                })?
                .to_js())
            },
        ))
    }

    pub(crate) fn cmp<'a>(
        &self,
        cx: Cx<'_, 'a>,
        first: JsLocal<'a>,
        second: JsLocal<'a>,
    ) -> Result<'a, i16> {
        Ok(key_of(cx, first)?.cmp(&key_of(cx, second)?) as i16)
    }
}
