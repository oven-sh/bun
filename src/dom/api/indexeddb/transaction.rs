//! <https://w3c.github.io/IndexedDB/#transaction>

use bun_web::exec::{Receiver, Sender};

use super::factory::finish_upgrade;
use super::request::error_event;
use super::source::Source;
use super::*;
use crate::api::events::after_microtasks;

const UNHEARD_REQUESTS_IN_A_TASK: u32 = 256;

struct Before {
    version: u64,
    stores: Vec<(Rc<Store>, Key, Vec<(Rc<Index>, Key)>)>,
}

#[repr(C)]
pub(crate) struct IDBTransaction {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_IDBTransaction::Fields,
    mode: IDBTransactionMode,
    durability: IDBTransactionDurability,
    /// Empty for an upgrade.
    scope: Vec<Rc<Store>>,
    stored: Held<stored::Transaction>,
    is_new: Cell<bool>,
    has_started: Cell<bool>,
    is_active: Cell<bool>,
    is_committing: Cell<bool>,
    is_finished: Cell<bool>,
    is_step_queued: Cell<bool>,
    /// For an upgrade: what to go back to, and who waits for the request to be done.
    upgrade: Cell<Option<Box<(Before, Sender<()>)>>>,
}

impl IDBTransaction {
    fn begin<'a>(
        heap: &JsHeap<'a>,
        db: &'a IDBDatabase,
        scope: Vec<Rc<Store>>,
        mode: IDBTransactionMode,
        durability: IDBTransactionDurability,
        stored: stored::Transaction,
    ) -> &'a IDBTransaction {
        let made = IDBTransaction {
            base: Default::default(),
            fields: Default::default(),
            mode,
            durability,
            scope,
            stored: hold(heap, stored),
            is_new: true.into(),
            has_started: true.into(),
            is_active: true.into(),
            is_committing: false.into(),
            is_finished: false.into(),
            is_step_queued: false.into(),
            upgrade: None.into(),
        };
        let this = js_IDBTransaction::create(heap, made);
        js_IDBTransaction::set_db(this, Some(db));
        db.transactions(heap).push(heap, this.to_js());
        this
    }

    pub(super) fn new<'a>(
        cx: Cx<'_, 'a>,
        db: &'a IDBDatabase,
        scope: Vec<Rc<Store>>,
        mode: IDBTransactionMode,
        durability: IDBTransactionDurability,
        (stored, started): (
            stored::Transaction,
            Option<Receiver<core::result::Result<(), Failure>>>,
        ),
    ) -> &'a IDBTransaction {
        /// <https://w3c.github.io/IndexedDB/#cleanup-indexed-database-transactions>
        fn clean_up<'a>(
            cx: Cx<'_, 'a>,
            [this, _]: [JsLocal<'a>; 2],
            _: u64,
            _: &[JsLocal<'a>],
        ) -> Result<'a, JSValue> {
            let this = handle::<IDBTransaction>(this);
            if this.is_new.take() {
                this.is_active.set(false);
                this.proceed(&cx.heap);
            }
            Ok(JSValue::UNDEFINED)
        }
        db.transactions(&cx.heap)
            .values()
            .filter_map(|it| IDBTransaction::from_js(&cx.heap, it))
            .for_each(|it| it.catch_up(&cx.heap));
        let this = IDBTransaction::begin(&cx.heap, db, scope, mode, durability, stored);
        let callback = cx
            .heap
            .create_callback(clean_up, [this.to_js(), JSValue::UNDEFINED], 0)
            .to_js();
        after_microtasks(cx, callback);
        bun_web::tasks::after_microtasks(cx.global(), callback);
        if let Some(started) = started {
            this.has_started.set(false);
            let kept = Kept::new(cx, this.to_js());
            spawn(&cx.heap, async move {
                let Some(started) = started.await else { return };
                kept.queue_task(move |cx, this| {
                    let this = handle::<IDBTransaction>(this);
                    this.has_started.set(true);
                    match started {
                        Ok(()) => this.step_unless_busy(cx),
                        Err(failure) => this.fail(cx, failure),
                    }
                });
            });
        }
        this
    }

    /// <https://w3c.github.io/IndexedDB/#upgrade-a-database>
    pub(super) fn upgrade<'a>(
        cx: Cx<'_, 'a>,
        db: &'a IDBDatabase,
        request: &'a IDBRequest,
        version: u64,
        stored: stored::Transaction,
        finished: Sender<()>,
    ) {
        let this = IDBTransaction::begin(
            &cx.heap,
            db,
            Vec::new(),
            IDBTransactionMode::Versionchange,
            IDBTransactionDurability::Default,
            stored,
        );
        let name = |it: &RefCell<Key>| Key::clone(&it.borrow());
        let remember = |it: &Rc<Store>| {
            (
                Rc::clone(it),
                name(&it.name),
                it.indexes()
                    .iter()
                    .map(|it| (Rc::clone(it), name(&it.name)))
                    .collect(),
            )
        };
        let before = Before {
            version: db.version.replace(version),
            stores: db.stores.borrow().iter().map(remember).collect(),
        };
        let event = IDBVersionChangeEvent::new(
            &cx.heap,
            atom!("upgradeneeded"),
            before.version,
            Some(version),
        );
        this.upgrade.set(Some(Box::new((before, finished))));
        js_IDBDatabase::set_upgrade(db, Some(this));
        js_IDBTransaction::set_opener(this, Some(request));
        js_IDBRequest::set_transaction(request, Some(this));
        request.settle(Ok(db.to_js()));
        this.fire(cx, event, &[request], None);
    }

    pub(super) fn db(&self) -> &IDBDatabase {
        js_IDBTransaction::db(self).expect("a connection")
    }

    pub(super) fn is_upgrade(&self) -> bool {
        self.mode == IDBTransactionMode::Versionchange
    }

    pub(super) fn require_unfinished<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        if self.is_finished.get() {
            Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The transaction has finished.",
            ))
        } else {
            Ok(())
        }
    }

    pub(super) fn require_active<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        if self.is_active.get() {
            Ok(())
        } else {
            Err(dom_error(
                heap,
                DomError::TransactionInactiveError,
                "The transaction is not active.",
            ))
        }
    }

    pub(super) fn require_writable<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        self.require_active(heap)?;
        if self.mode == IDBTransactionMode::Readonly {
            Err(dom_error(
                heap,
                DomError::ReadonlyError,
                "The transaction is read-only.",
            ))
        } else {
            Ok(())
        }
    }

    pub(super) fn stored<'a, R>(
        &self,
        cx: Cx<'_, 'a>,
        steps: impl FnOnce(&mut stored::Transaction) -> core::result::Result<R, Failure>,
    ) -> Result<'a, R> {
        let result = self
            .stored
            .borrow_mut()
            .as_mut()
            .map_or(Err(Failure::Erased), steps);
        result.map_err(|it| error_of(cx, it))
    }

    pub(super) fn read<'a>(&self, cx: Cx<'_, 'a>, store: Table, key: &[u8]) -> Result<'a, JSValue> {
        let values = self.stored(cx, |it| it.read(store, [key]))?;
        Ok(JSValue::deserialize(
            values.iter().next().unwrap_or_default(),
            cx.global(),
        )?)
    }

    /// <https://w3c.github.io/IndexedDB/#clone-a-value>
    pub(super) fn clone_value<'a>(
        &self,
        cx: Cx<'_, 'a>,
        value: JsLocal<'a>,
    ) -> Result<'a, Box<[u8]>> {
        self.is_active.set(false);
        let cloned = serialize(cx, value.to_js());
        self.is_active.set(!self.is_finished.get());
        cloned.and_then(|it| self.require_active(&cx.heap).map(|()| it))
    }

    pub(super) fn enqueue(&self, request: &IDBRequest, operation: Operation) {
        request.prepare(operation);
        match js_IDBTransaction::last(self) {
            Some(last) => js_IDBRequest::set_next(last, Some(request)),
            None => js_IDBTransaction::set_first(self, Some(request)),
        }
        js_IDBTransaction::set_last(self, Some(request));
    }

    /// <https://w3c.github.io/IndexedDB/#asynchronously-execute-a-request>
    pub(super) fn request<'a>(
        &self,
        heap: &JsHeap<'a>,
        source: JSValue,
        operation: Operation,
    ) -> &'a IDBRequest {
        let request = IDBRequest::new(heap, Some(source), self);
        self.enqueue(request, operation);
        request
    }

    pub(super) fn schedule(&self, heap: &JsHeap<'_>, operation: Operation) {
        self.enqueue(IDBRequest::new(heap, None, self), operation);
    }

    fn dequeue(&self) -> Option<&IDBRequest> {
        let first = js_IDBTransaction::first(self)?;
        let next = js_IDBRequest::next(first);
        js_IDBTransaction::set_first(self, next);
        js_IDBRequest::set_next(first, None);
        if next.is_none() {
            js_IDBTransaction::set_last(self, None);
        }
        Some(first)
    }

    fn is_busy(&self) -> bool {
        !self.has_started.get()
            || self.is_active.get()
            || self.is_finished.get()
            || self.is_step_queued.get()
    }

    fn proceed(&self, heap: &JsHeap<'_>) {
        if !self.is_busy() {
            self.is_step_queued.set(true);
            queue_task(self.realm(heap), [self.to_js()], |cx, [this]| {
                handle::<IDBTransaction>(this).step(cx)
            });
        }
    }

    /// The news that it has started may be on its way, and must not be overtaken.
    fn catch_up(&self, heap: &JsHeap<'_>) {
        if !self.has_started.get()
            && self
                .stored
                .borrow()
                .as_ref()
                .is_some_and(stored::Transaction::has_started)
        {
            self.has_started.set(true);
            self.proceed(heap);
        }
    }

    fn step_unless_busy<'a>(&'a self, cx: Cx<'_, 'a>) {
        if !self.is_busy() {
            self.step(cx);
        }
    }

    /// It is active meanwhile.
    fn fire<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        event: &'a Event,
        path: &[&'a EventTarget],
        error: Option<JSValue>,
    ) {
        self.is_active.set(!self.is_committing.get());
        let was_not_canceled = dispatch_along(cx, path, event);
        if self.is_active.take() && event.has(EventFlags::LISTENER_THREW) {
            self.abort_with(
                &cx.heap,
                aborted(&cx.heap, "An exception was thrown in an event handler."),
            );
        } else if let Some(error) = error.filter(|_| was_not_canceled) {
            self.abort_with(&cx.heap, error);
        }
        if js_IDBTransaction::first(self).is_none() {
            self.is_committing.set(true);
        }
        self.proceed(&cx.heap);
    }

    fn step<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.is_step_queued.set(false);
        for _ in 0..UNHEARD_REQUESTS_IN_A_TASK {
            if self.is_finished.get() {
                return;
            }
            let Some(request) = js_IDBTransaction::first(self) else {
                return self.store(cx);
            };
            let mark = self
                .stored
                .borrow()
                .as_ref()
                .map_or(0, stored::Transaction::mark);
            let path: [&EventTarget; 3] = [request, self, self.db()];
            match request.run(cx, self).map_err(|it| cx.catch(it)) {
                _ if self.is_finished.get() => return,
                Err(Err(_)) => return,
                Err(Ok(error)) if request.is_hidden || self.is_committing.get() => {
                    return self.abort_with(&cx.heap, error);
                }
                Err(Ok(error)) => {
                    self.dequeue();
                    self.stored
                        .borrow_mut()
                        .iter_mut()
                        .for_each(|it| it.roll_back(mark));
                    request.settle(Err(error));
                    return self.fire(cx, error_event(&cx.heap), &path, Some(error));
                }
                Ok(result) => {
                    self.dequeue();
                    request.settle(Ok(result));
                    if !request.is_hidden
                        && path.iter().any(|it| it.has_listeners(atom!("success")))
                    {
                        return self.fire(
                            cx,
                            Event::new(&cx.heap, atom!("success"), EventInit::default()),
                            &path,
                            None,
                        );
                    }
                }
            }
        }
        self.proceed(&cx.heap);
    }

    /// <https://w3c.github.io/IndexedDB/#commit-a-transaction>
    fn store<'a>(&'a self, cx: Cx<'_, 'a>) {
        let Some(stored) = self.stored.take() else {
            return;
        };
        if !stored.has_written() && !self.is_upgrade() {
            return self.finish(&cx.heap, true, stored.abort());
        }
        self.is_step_queued.set(true);
        self.is_committing.set(true);
        let kept = Kept::new(cx, self.to_js());
        let (schema, is_strict) = (
            self.is_upgrade().then(|| self.db().schema()),
            self.durability == IDBTransactionDurability::Strict,
        );
        spawn(&cx.heap, async move {
            let (result, place) = stored.commit(schema, is_strict).await;
            kept.queue_task(move |cx, this| {
                let this = handle::<IDBTransaction>(this);
                match result {
                    _ if this.is_finished.get() => {}
                    Ok(()) => {
                        this.is_finished.set(true);
                        this.announce_end(cx, true, place);
                    }
                    Err(failure) => this.fail(cx, failure),
                }
            });
        });
    }

    fn finish(&self, heap: &JsHeap<'_>, is_committed: bool, place: Option<stored::Place>) {
        self.is_finished.set(true);
        self.is_active.set(false);
        queue_task(self.realm(heap), [self.to_js()], move |cx, [this]| {
            handle::<IDBTransaction>(this).announce_end(cx, is_committed, place)
        });
    }

    fn announce_end<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        is_committed: bool,
        place: Option<stored::Place>,
    ) {
        let db = self.db();
        if self.is_upgrade() {
            js_IDBDatabase::set_upgrade(db, None);
        }
        db.transactions(&cx.heap).remove(&cx.heap, self.to_js());
        drop(place);
        let opener = js_IDBTransaction::opener(self);
        if let (Some(request), Some(upgrade)) = (opener, self.upgrade.take()) {
            queue_task(
                &cx.heap,
                [request.to_js(), db.to_js()],
                move |cx, [request, db]| {
                    finish_upgrade(cx, request, handle(db), is_committed);
                    upgrade.1.send(());
                },
            );
        }
        match is_committed {
            true => dispatch_along(
                cx,
                &[self, db],
                Event::new(&cx.heap, atom!("complete"), EventInit::default()),
            ),
            false => dispatch_along(
                cx,
                &[self, db],
                Event::new(
                    &cx.heap,
                    atom!("abort"),
                    EventInit {
                        bubbles: true,
                        ..Default::default()
                    },
                ),
            ),
        };
        opener.inspect(|it| js_IDBRequest::set_transaction(it, None));
    }

    fn fail<'a>(&'a self, cx: Cx<'_, 'a>, failure: Failure) {
        let error = error_of(cx, failure);
        if let Ok(error) = cx.catch(error) {
            self.abort_with(&cx.heap, error);
        }
    }

    /// <https://w3c.github.io/IndexedDB/#abort-an-upgrade-transaction>
    fn undo_upgrade(&self, before: &Before) {
        let db = self.db();
        for store in db.stores.take() {
            store.is_deleted.set(true);
            store
                .indexes
                .take()
                .iter()
                .for_each(|it| it.is_deleted.set(true));
        }
        for (store, name, indexes) in &before.stores {
            store.is_deleted.set(false);
            store.name.replace(Key::clone(name));
            store
                .indexes
                .replace(indexes.iter().map(|it| Rc::clone(&it.0)).collect());
            for (index, name) in indexes {
                index.is_deleted.set(false);
                index.name.replace(Key::clone(name));
            }
        }
        db.stores
            .replace(before.stores.iter().map(|it| Rc::clone(&it.0)).collect());
        db.version.set(before.version);
    }

    /// <https://w3c.github.io/IndexedDB/#abort-a-transaction>
    pub(super) fn abort_with(&self, heap: &JsHeap<'_>, error: JSValue) {
        if self.is_finished.get() {
            return;
        }
        let place = self.stored.take().and_then(stored::Transaction::abort);
        let upgrade = self.upgrade.take();
        upgrade.iter().for_each(|it| self.undo_upgrade(&it.0));
        self.upgrade.set(upgrade);
        js_IDBTransaction::set_error(self, error);
        while let Some(request) = self.dequeue() {
            if !request.is_hidden {
                queue_task(
                    self.realm(heap),
                    [request.to_js(), self.to_js()],
                    |cx, [request, this]| {
                        let (request, this) = (
                            handle::<IDBRequest>(request),
                            handle::<IDBTransaction>(this),
                        );
                        request.settle(Err(aborted(
                            &cx.heap,
                            "The transaction was aborted, so the request cannot be fulfilled.",
                        )));
                        dispatch_along(cx, &[request, this, this.db()], error_event(&cx.heap));
                    },
                );
            }
        }
        self.finish(heap, false, place);
    }

    pub(super) fn handle_of<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        store: Rc<Store>,
    ) -> &'a IDBObjectStore {
        let handles =
            js_IDBTransaction::stores(self).map_or_else(|| List::new(heap), List::from_value);
        js_IDBTransaction::set_stores(self, handles.to_js());
        let known = handles
            .values()
            .filter_map(|it| IDBObjectStore::from_js(heap, it))
            .find(|it| Rc::ptr_eq(&it.source.store, &store));
        known.unwrap_or_else(|| {
            let made = js_IDBObjectStore::create(
                self.realm(heap),
                IDBSource {
                    source: Source { store, index: None },
                    _interior: Default::default(),
                },
            );
            js_IDBSource::set_transaction(made, Some(self));
            handles.push(heap, made.to_js());
            made
        })
    }

    pub(crate) fn get_object_store_names<'a>(&self, heap: &JsHeap<'a>) -> &'a DOMStringList {
        if self.is_upgrade() {
            self.db().get_object_store_names(heap)
        } else {
            sorted_names(heap, self.scope.iter().map(|it| &it.name))
        }
    }

    pub(crate) fn get_mode(&self) -> IDBTransactionMode {
        self.mode
    }

    pub(crate) fn get_durability(&self) -> IDBTransactionDurability {
        self.durability
    }

    pub(crate) fn object_store<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: &DomString,
    ) -> Result<'a, &'a IDBObjectStore> {
        self.require_unfinished(heap)?;
        let store = self
            .db()
            .store(&key_of_string(name))
            .filter(|store| self.is_upgrade() || self.scope.iter().any(|it| Rc::ptr_eq(it, store)));
        Ok(self.handle_of(
            heap,
            store.ok_or_else(|| {
                dom_error(
                    heap,
                    DomError::NotFoundError,
                    "The specified object store was not found.",
                )
            })?,
        ))
    }

    pub(crate) fn commit<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        if !self.is_active.take() {
            return Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The transaction is not active.",
            ));
        }
        self.is_committing.set(true);
        self.proceed(heap);
        Ok(())
    }

    pub(crate) fn abort<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        if self.is_finished.get() || self.is_committing.get() {
            return Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The transaction has finished.",
            ));
        }
        self.abort_with(heap, JSValue::NULL);
        Ok(())
    }
}
