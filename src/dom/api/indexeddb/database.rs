//! <https://w3c.github.io/IndexedDB/#database-interface>

use core::mem::ManuallyDrop;

use bun_collections::HashMap;
use bun_jsc::{Strong, Weak};
use bun_web::exec::{Thread, with_js};
use bun_web::storage::indexed::Notice;

use super::*;
use crate::order::Order as _;

#[repr(C)]
pub(crate) struct IDBDatabase {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_IDBDatabase::Fields,
    id: u32,
    name: DomString,
    pub(super) version: Cell<u64>,
    pub(super) stores: RefCell<Vec<Rc<Store>>>,
    connection: Held<stored::Connection>,
    /// While it is open and something listens.
    itself: Cell<Option<Held<Strong>>>,
}

thread_local! {
    static OPEN: ManuallyDrop<RefCell<HashMap<u32, Weak<()>>>> = bun_ui::lasting(|| drop(OPEN.with(|it| it.take())));
    static LAST_ID: Cell<u32> = const { Cell::new(0) };
}

impl Drop for IDBDatabase {
    fn drop(&mut self) {
        OPEN.with(|it| it.borrow_mut().remove(&self.id));
    }
}

fn deliver(id: u32, notice: Notice) {
    let Some(db) = OPEN.with(|it| it.borrow().get(&id)?.get()) else {
        return;
    };
    with_js(|cx| {
        let db = handle::<IDBDatabase>(JsLocal::new(&cx.heap, db));
        queue_task(db.realm(&cx.heap), [db.to_js()], |cx, [db]| {
            handle::<IDBDatabase>(db).hear(cx, notice)
        });
    });
}

impl IDBDatabase {
    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        name: DomString,
        id: u32,
        connection: stored::Connection,
        schema: &stored::Schema,
    ) -> &'a IDBDatabase {
        let made = IDBDatabase {
            base: Default::default(),
            fields: Default::default(),
            id,
            name,
            version: schema.version.into(),
            stores: RefCell::new(schema.stores.iter().map(|it| Rc::new(it.into())).collect()),
            connection: hold(heap, connection),
            itself: None.into(),
        };
        let this = js_IDBDatabase::create(heap, made);
        OPEN.with(|it| {
            it.borrow_mut()
                .insert(id, Weak::create_passive(this.to_js(), global_of(heap)))
        });
        this
    }

    /// For [`new`](Self::new).
    pub(super) fn connect(turn: &stored::Turn) -> (u32, stored::Connection) {
        let (id, thread) = (LAST_ID.get() + 1, Thread::current());
        LAST_ID.set(id);
        (
            id,
            turn.connect(move |notice| thread.post(move || deliver(id, notice))),
        )
    }

    pub(super) fn is_closed(&self) -> bool {
        self.connection.borrow().is_none()
    }

    pub(crate) fn listener_added(&self, heap: &JsHeap<'_>) {
        if !self.is_closed() {
            self.itself.set(Some(hold(
                self.realm(heap),
                Strong::create(self.to_js(), global_of(heap)),
            )));
        }
    }

    fn hear<'a>(&'a self, cx: Cx<'_, 'a>, notice: Notice) {
        if self.is_closed() {
            return;
        }
        match notice {
            Notice::VersionChange {
                new_version,
                handled,
            } => {
                dispatch_along(
                    cx,
                    &[self],
                    IDBVersionChangeEvent::new(
                        &cx.heap,
                        atom!("versionchange"),
                        self.version.get(),
                        new_version,
                    ),
                );
                handled.send(!self.is_closed());
            }
            Notice::Erased => {
                let error = aborted(&cx.heap, "The connection was closed.");
                self.transactions(&cx.heap)
                    .values()
                    .filter_map(|it| IDBTransaction::from_js(&cx.heap, it))
                    .for_each(|it| it.abort_with(&cx.heap, error));
                self.close();
                let fire = |cx: Cx<'_, '_>, [db]: [JsLocal<'_>; 1]| {
                    _ = dispatch_along(
                        cx,
                        &[handle::<IDBDatabase>(JsLocal::new(&cx.heap, db.to_js()))],
                        Event::new(&cx.heap, atom!("close"), EventInit::default()),
                    )
                };
                queue_task(&cx.heap, [self.to_js()], move |cx, db| fire(cx, db));
            }
        }
    }

    pub(super) fn transactions<'a>(&self, heap: &JsHeap<'a>) -> List<'a> {
        let list =
            js_IDBDatabase::transactions(self).map_or_else(|| List::new(heap), List::from_value);
        js_IDBDatabase::set_transactions(self, list.to_js());
        list
    }

    pub(super) fn store(&self, name: &[u8]) -> Option<Rc<Store>> {
        self.stores
            .borrow()
            .iter()
            .find(|it| **it.name.borrow() == *name)
            .cloned()
    }

    pub(super) fn schema(&self) -> stored::Schema {
        stored::Schema {
            version: self.version.get(),
            stores: self
                .stores
                .borrow()
                .iter()
                .map(|it| (&**it).into())
                .collect(),
        }
    }

    fn find_store<'a>(&self, heap: &JsHeap<'a>, name: &DomString) -> Result<'a, Rc<Store>> {
        self.store(&key_of_string(name)).ok_or_else(|| {
            dom_error(
                heap,
                DomError::NotFoundError,
                "The specified object store was not found.",
            )
        })
    }

    fn active_upgrade<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a IDBTransaction> {
        let upgrade = js_IDBDatabase::upgrade(self).ok_or_else(|| {
            dom_error(
                heap,
                DomError::InvalidStateError,
                "The database is not running a version change transaction.",
            )
        })?;
        upgrade.require_active(heap).map(|()| upgrade)
    }

    pub(crate) fn get_name(&self, _: &JsHeap<'_>) -> &DomString {
        &self.name
    }

    pub(crate) fn get_version(&self) -> u64 {
        self.version.get()
    }

    pub(crate) fn get_object_store_names<'a>(&self, heap: &JsHeap<'a>) -> &'a DOMStringList {
        sorted_names(heap, self.stores.borrow().iter().map(|it| &it.name))
    }

    pub(crate) fn create_object_store<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: &DomString,
        options: &IDBObjectStoreParameters<'a>,
    ) -> Result<'a, &'a IDBObjectStore> {
        let (upgrade, name) = (self.active_upgrade(heap)?, key_of_string(name));
        let key_path = options
            .key_path
            .map(|it| KeyPath::from_js(heap, it))
            .transpose()?;
        key_path.iter().try_for_each(|it| it.validate(heap))?;
        if self.store(&name).is_some() {
            return Err(dom_error(
                heap,
                DomError::ConstraintError,
                "An object store with the specified name already exists.",
            ));
        }
        if options.auto_increment
            && key_path
                .as_ref()
                .is_some_and(|it| it.is_list || it.is_empty_string())
        {
            return Err(dom_error(
                heap,
                DomError::InvalidAccessError,
                "The autoIncrement option was set but the key path is empty or an array.",
            ));
        }
        let (auto_increments, indexes) = (options.auto_increment, Default::default());
        let store = Rc::new(Store {
            table: Table::unique(),
            name: name.into(),
            key_path,
            auto_increments,
            indexes,
            is_deleted: false.into(),
        });
        self.stores.borrow_mut().push(Rc::clone(&store));
        Ok(upgrade.handle_of(heap, store))
    }

    pub(crate) fn delete_object_store<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: &DomString,
    ) -> Result<'a> {
        let (upgrade, store) = (self.active_upgrade(heap)?, self.find_store(heap, name)?);
        store.is_deleted.set(true);
        self.stores
            .borrow_mut()
            .retain(|it| !Rc::ptr_eq(it, &store));
        upgrade.schedule(heap, Operation::Clear(store.tables()));
        Ok(())
    }

    pub(crate) fn transaction<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        names: IDBNames<'a>,
        mode: IDBTransactionMode,
        options: &IDBTransactionOptions,
    ) -> Result<'a, &'a IDBTransaction> {
        let heap = &cx.heap;
        if js_IDBDatabase::upgrade(self).is_some() {
            return Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "A version change transaction is running.",
            ));
        }
        let connection = self.connection.borrow();
        let connection_or_error = connection.as_ref().ok_or_else(|| {
            dom_error(
                heap,
                DomError::InvalidStateError,
                "The database connection is closing.",
            )
        });
        let (open, mut scope) = (
            connection_or_error?,
            strings_of(heap, names)?
                .iter()
                .map(|it| self.find_store(heap, it))
                .collect::<Result<'a, Vec<_>>>()?,
        );
        scope.order_by_key(Rc::as_ptr);
        scope.dedup_by_key(|it| Rc::as_ptr(it));
        let stored_mode = match mode {
            _ if scope.is_empty() => {
                return Err(dom_error(
                    heap,
                    DomError::InvalidAccessError,
                    "The storeNames parameter was empty.",
                ));
            }
            IDBTransactionMode::Readonly => stored::Mode::ReadOnly,
            IDBTransactionMode::Readwrite => stored::Mode::ReadWrite,
            IDBTransactionMode::Versionchange => {
                return Err(heap.type_error(format_args!(
                    "The mode provided ('versionchange') is not valid."
                )));
            }
        };
        let begun = open.begin(
            stored_mode,
            scope.iter().flat_map(|it| it.tables()).collect(),
        );
        drop(connection);
        Ok(IDBTransaction::new(
            cx,
            self,
            scope,
            mode,
            options.durability,
            begun,
        ))
    }

    pub(crate) fn close(&self) {
        drop((self.connection.take(), self.itself.take()));
    }
}
