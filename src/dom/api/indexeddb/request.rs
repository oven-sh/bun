//! <https://w3c.github.io/IndexedDB/#request-api> and <https://w3c.github.io/IndexedDB/#database-operations>

use super::source::Source;
use super::*;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Wants {
    Key,
    Value,
    Record,
}

pub(super) enum Operation {
    Put {
        store: Rc<Store>,
        key: Option<Key>,
        value: Box<[u8]>,
        indexes: Rc<[Rc<Index>]>,
        index_keys: Vec<IndexKeys>,
        replaces: bool,
    },
    Delete {
        store: Table,
        range: KeyRange,
        indexes: Vec<Table>,
    },
    Clear(Vec<Table>),
    Get {
        source: Source,
        range: KeyRange,
        wants: Wants,
    },
    GetAll {
        source: Source,
        range: KeyRange,
        wants: Wants,
        direction: Direction,
        limit: usize,
    },
    Count(Table, KeyRange),
    Iterate {
        count: u32,
        target: Option<Vec<u8>>,
    },
    FillIndex(Table, Rc<Index>),
}

#[repr(C)]
#[derive(Default)]
pub(crate) struct IDBRequest {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_IDBRequest::Fields,
    is_done: Cell<bool>,
    /// No script is told about it, unless it fails.
    pub(super) is_hidden: bool,
    operation: Cell<Option<Operation>>,
}

impl IDBRequest {
    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        source: Option<JSValue>,
        transaction: &IDBTransaction,
    ) -> &'a IDBRequest {
        let this = js_IDBRequest::create(
            transaction.realm(heap),
            IDBRequest {
                is_hidden: source.is_none(),
                ..Default::default()
            },
        );
        js_IDBRequest::set_source(this, source.unwrap_or(JSValue::NULL));
        js_IDBRequest::set_transaction(this, Some(transaction));
        this
    }

    pub(super) fn prepare(&self, operation: Operation) {
        self.is_done.set(false);
        self.operation.set(Some(operation));
    }

    pub(super) fn settle(&self, outcome: core::result::Result<JSValue, JSValue>) {
        self.is_done.set(true);
        js_IDBRequest::set_result(self, outcome.unwrap_or(JSValue::UNDEFINED));
        js_IDBRequest::set_error(self, outcome.err().unwrap_or(JSValue::NULL));
    }

    fn require_done<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        if self.is_done.get() {
            Ok(())
        } else {
            Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The request has not finished.",
            ))
        }
    }

    pub(crate) fn get_result<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        self.require_done(heap)
            .map(|()| js_IDBRequest::result(self).unwrap_or(JSValue::UNDEFINED))
    }

    pub(crate) fn get_error<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> Result<'a, Option<JsLocal<'a, bun_jsc::JSObject>>> {
        self.require_done(heap)
            .map(|()| JsLocal::new(heap, js_IDBRequest::error(self)?).as_any_object())
    }

    pub(crate) fn get_ready_state(&self) -> IDBRequestReadyState {
        if self.is_done.get() {
            IDBRequestReadyState::Done
        } else {
            IDBRequestReadyState::Pending
        }
    }

    pub(super) fn run<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        transaction: &'a IDBTransaction,
    ) -> Result<'a, JSValue> {
        match self.operation.take().expect("it is in the queue") {
            Operation::Put {
                store,
                key,
                value,
                indexes,
                index_keys,
                replaces,
            } => {
                let Some(key) = key else {
                    return put_with_generated_key(
                        cx,
                        transaction,
                        &store,
                        value,
                        &indexes,
                        index_keys,
                    );
                };
                transaction.stored(cx, |it| {
                    if let Some(number) = key::as_number(&key).filter(|_| store.auto_increments) {
                        it.update_key_generator(store.table, number)?;
                    }
                    it.put(store.table, &key, value, &index_keys, replaces)
                })?;
                value_of_key(&cx.heap, &key)
            }
            Operation::Delete {
                store,
                range,
                indexes,
            } => transaction
                .stored(cx, |it| it.delete(store, &range, &indexes))
                .map(|()| JSValue::UNDEFINED),
            Operation::Clear(tables) => transaction
                .stored(cx, |it| {
                    tables.iter().try_for_each(|table| it.clear(*table))
                })
                .map(|()| JSValue::UNDEFINED),
            Operation::Count(table, range) => transaction
                .stored(cx, |it| it.count(table, &range))
                .map(|it| JSValue::js_number(it as f64)),
            Operation::Get {
                source,
                range,
                wants,
            } => {
                let forward = Direction {
                    is_forward: true,
                    skips_duplicates: false,
                };
                match transaction.stored(cx, |it| {
                    it.iterate(source.table(), &range, forward, None, None, 1)
                })? {
                    None => Ok(JSValue::UNDEFINED),
                    Some(entry) if wants == Wants::Key => {
                        value_of_key(&cx.heap, source.primary_key(&entry))
                    }
                    Some(entry) => {
                        transaction.read(cx, source.store.table, source.primary_key(&entry))
                    }
                }
            }
            Operation::GetAll {
                source,
                range,
                wants,
                direction,
                limit,
            } => {
                let entries = transaction
                    .stored(cx, |it| it.select(source.table(), &range, direction, limit))?;
                let values = transaction.stored(cx, |it| match (wants, &source.index) {
                    (Wants::Key, _) => Ok(Default::default()),
                    (_, None) => it.read_adjacent(source.store.table, &entries),
                    (_, Some(_)) => it.read(
                        source.store.table,
                        entries.iter().map(|it| source.primary_key(it)),
                    ),
                })?;
                let (array, mut values) = (
                    JSValue::create_empty_array(cx.global(), entries.len())?,
                    values.iter(),
                );
                for (entry, at) in entries.iter().zip(0..) {
                    let item = match values
                        .next()
                        .map(|it| JSValue::deserialize(it, cx.global()))
                        .transpose()?
                    {
                        None => value_of_key(&cx.heap, source.primary_key(entry))?,
                        Some(value) if wants == Wants::Value => value,
                        Some(value) => {
                            let record = js_IDBRecord::create(&cx.heap, Default::default());
                            js_IDBRecord::set_value(record, value);
                            js_IDBRecord::set_key(record, value_of_key(&cx.heap, entry)?);
                            js_IDBRecord::set_primary_key(
                                record,
                                value_of_key(&cx.heap, source.primary_key(entry))?,
                            );
                            record.to_js()
                        }
                    };
                    array.put_index(cx.global(), at, item)?;
                }
                Ok(array)
            }
            Operation::Iterate { count, target } => js_IDBRequest::cursor(self)
                .expect("a cursor")
                .move_on(cx, transaction, count, target.as_deref()),
            Operation::FillIndex(store, index) => {
                let forward = Direction {
                    is_forward: true,
                    skips_duplicates: false,
                };
                for key in transaction.stored(cx, |it| {
                    it.select(store, &KeyRange::all(), forward, usize::MAX)
                })? {
                    let value = transaction.read(cx, store, &key)?;
                    let keys = index.keys_for(cx, value)?;
                    transaction.stored(cx, |it| it.add_to_index(&keys, &key))?;
                }
                Ok(JSValue::UNDEFINED)
            }
        }
    }
}

fn put_with_generated_key<'a>(
    cx: Cx<'_, 'a>,
    transaction: &'a IDBTransaction,
    store: &Store,
    mut value: Box<[u8]>,
    indexes: &[Rc<Index>],
    mut index_keys: Vec<IndexKeys>,
) -> Result<'a, JSValue> {
    let (number, mut key) = (
        transaction.stored(cx, |it| it.generate_key(store.table))?,
        Vec::new(),
    );
    key::push_number(&mut key, number);
    if let Some(key_path) = &store.key_path {
        let copy = JSValue::deserialize(&value, cx.global())?;
        key_path.inject(cx.global(), copy, number)?;
        value = serialize(cx, copy)?;
        index_keys = indexes
            .iter()
            .map(|it| it.keys_for(cx, copy))
            .collect::<Result<'a, _>>()?;
    }
    transaction.stored(cx, |it| {
        it.put(store.table, &key.into(), value, &index_keys, false)
    })?;
    Ok(JSValue::js_number(number))
}

#[repr(C)]
pub(crate) struct IDBVersionChangeEvent {
    pub(crate) base: Event,
    old_version: u64,
    new_version: Option<u64>,
}

impl IDBVersionChangeEvent {
    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        name: Known,
        old_version: u64,
        new_version: Option<u64>,
    ) -> &'a Event {
        js_IDBVersionChangeEvent::create(
            heap,
            IDBVersionChangeEvent {
                base: Event::base(name, EventInit::default(), Trusted::Yes),
                old_version,
                new_version,
            },
        )
    }

    pub(crate) fn constructor(
        name: Atom,
        init: &IDBVersionChangeEventInit,
    ) -> IDBVersionChangeEvent {
        let base = Event::base(
            name,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        IDBVersionChangeEvent {
            base,
            old_version: init.old_version,
            new_version: init.new_version,
        }
    }

    pub(crate) fn get_old_version(&self) -> u64 {
        self.old_version
    }

    pub(crate) fn get_new_version(&self) -> Option<u64> {
        self.new_version
    }
}

pub(super) fn error_event<'a>(heap: &JsHeap<'a>) -> &'a Event {
    Event::new(
        heap,
        atom!("error"),
        EventInit {
            bubbles: true,
            cancelable: true,
            composed: false,
        },
    )
}
