//! <https://w3c.github.io/IndexedDB/#object-store-interface> and <https://w3c.github.io/IndexedDB/#index-interface>

use super::request::Wants;
use super::*;

#[derive(Clone)]
pub(super) struct Source {
    pub(super) store: Rc<Store>,
    pub(super) index: Option<Rc<Index>>,
}

impl Source {
    pub(super) fn table(&self) -> Table {
        self.index.as_ref().map_or(self.store.table, |it| it.table)
    }

    pub(super) fn key<'k>(&self, entry: &'k [u8]) -> &'k [u8] {
        if self.index.is_some() {
            key::split(entry).0
        } else {
            entry
        }
    }

    pub(super) fn primary_key<'k>(&self, entry: &'k [u8]) -> &'k [u8] {
        if self.index.is_some() {
            key::split(entry).1
        } else {
            entry
        }
    }

    pub(super) fn direction(&self, direction: IDBCursorDirection) -> Direction {
        let direction = Direction::from(direction);
        Direction {
            skips_duplicates: direction.skips_duplicates && self.index.is_some(),
            ..direction
        }
    }

    fn name(&self) -> &RefCell<Key> {
        self.index.as_ref().map_or(&self.store.name, |it| &it.name)
    }
}

pub(crate) struct IDBSource {
    pub(super) source: Source,
    pub(crate) _interior: bun_jsc::bindgen::Interior,
}

type Requested<'a> = Result<'a, &'a IDBRequest>;

impl IDBSource {
    pub(super) fn transaction(&self) -> &IDBTransaction {
        js_IDBSource::transaction(self).expect("a transaction")
    }

    pub(super) fn require_existing<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        match self.source.store.is_deleted.get()
            || self
                .source
                .index
                .as_ref()
                .is_some_and(|it| it.is_deleted.get())
        {
            true => Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The object store or index has been deleted.",
            )),
            false => Ok(()),
        }
    }

    fn require_readable<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        self.require_existing(heap)
            .and_then(|()| self.transaction().require_active(heap))
    }

    fn require_writable<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        self.require_existing(heap)
            .and_then(|()| self.transaction().require_writable(heap))
    }

    fn require_upgrade<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        match self.transaction().is_upgrade() {
            true => self.require_readable(heap),
            false => Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The database is not running a version change transaction.",
            )),
        }
    }

    /// Converting the query can run scripts.
    fn request<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        query: JsLocal<'a>,
        is_required: bool,
        operation: impl FnOnce(Source, KeyRange) -> Operation,
    ) -> Requested<'a> {
        let range = range_of(cx, query, is_required)?;
        self.require_readable(&cx.heap)?;
        Ok(self.transaction().request(
            &cx.heap,
            self.to_js(),
            operation(self.source.clone(), range),
        ))
    }

    fn get_one<'a>(&'a self, cx: Cx<'_, 'a>, query: JsLocal<'a>, wants: Wants) -> Requested<'a> {
        self.require_readable(&cx.heap)?;
        self.request(cx, query, true, |source, range| Operation::Get {
            source,
            range,
            wants,
        })
    }

    fn get_several<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &IDBGetAllOptions<'a>,
        wants: Wants,
    ) -> Requested<'a> {
        let (direction, limit) = (
            self.source.direction(options.direction),
            options
                .count
                .filter(|it| *it > 0)
                .map_or(usize::MAX, |it| it as usize),
        );
        self.request(cx, options.query, false, |source, range| {
            Operation::GetAll {
                source,
                range,
                wants,
                direction,
                limit,
            }
        })
    }

    /// <https://w3c.github.io/IndexedDB/#create-request-to-retrieve-multiple-items>
    fn get_by_query_or_options<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        given: JsLocal<'a>,
        count: Option<u32>,
        wants: Wants,
    ) -> Requested<'a> {
        self.require_readable(&cx.heap)?;
        let options = match is_potentially_key_or_range(&cx.heap, given) {
            true => IDBGetAllOptions {
                count,
                direction: IDBCursorDirection::Next,
                query: given,
            },
            false => {
                let (count, direction, query) =
                    IDBGetAllOptions::from_js(cx.global(), given.to_js(), |it| {
                        Ok((it.count, it.direction, it.query.to_js()))
                    })?;
                IDBGetAllOptions {
                    count,
                    direction,
                    query: JsLocal::new(&cx.heap, query),
                }
            }
        };
        self.get_several(cx, &options, wants)
    }

    fn new_cursor<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        query: JsLocal<'a>,
        direction: IDBCursorDirection,
        has_value: bool,
    ) -> Requested<'a> {
        self.require_readable(&cx.heap)?;
        let range = range_of(cx, query, false)?;
        self.require_readable(&cx.heap)?;
        Ok(IDBCursor::open(&cx.heap, self, range, direction, has_value))
    }

    /// `expected` is the key that has to be in the value.
    pub(super) fn store_record<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        source: JSValue,
        value: JsLocal<'a>,
        mut key: Option<Key>,
        replaces: bool,
        expected: Option<&[u8]>,
    ) -> Requested<'a> {
        let (store, transaction) = (&self.source.store, self.transaction());
        let (value, indexes) = (transaction.clone_value(cx, value)?, store.indexes());
        let copy = if store.key_path.is_some() || !indexes.is_empty() {
            JSValue::deserialize(&value, cx.global())?
        } else {
            JSValue::UNDEFINED
        };
        if let Some(key_path) = &store.key_path {
            match key_path.extract(cx, copy)? {
                Extracted::Key(found) if expected.is_none_or(|it| *it == *found) => {
                    key = Some(found.into())
                }
                Extracted::Failure
                    if store.auto_increments
                        && expected.is_none()
                        && key_path.can_inject(cx.global(), copy)? => {}
                _ => {
                    return Err(dom_error(
                        &cx.heap,
                        DomError::DataError,
                        "Evaluating the key path of the object store did not yield the key.",
                    ));
                }
            }
        }
        let awaits_key = key.is_none() && store.key_path.is_some();
        let index_keys = if awaits_key {
            Vec::new()
        } else {
            indexes
                .iter()
                .map(|it| it.keys_for(cx, copy))
                .collect::<Result<'a, _>>()?
        };
        Ok(transaction.request(
            &cx.heap,
            source,
            Operation::Put {
                store: Rc::clone(store),
                key,
                value,
                indexes,
                index_keys,
                replaces,
            },
        ))
    }
}

impl IDBReading {
    pub(crate) fn get_name<'a>(&self, _: &JsHeap<'a>) -> Result<'a, DomString> {
        Ok(string_of_key(&self.source.name().borrow()))
    }

    pub(crate) fn set_name<'a>(&self, heap: &JsHeap<'a>, name: &DomString) -> Result<'a> {
        self.require_upgrade(heap)?;
        let name = key_of_string(name);
        let is_taken = if self.source.index.is_some() {
            self.source.store.index(&name).is_some()
        } else {
            self.transaction().db().store(&name).is_some()
        };
        if is_taken && name != *self.source.name().borrow() {
            return Err(dom_error(
                heap,
                DomError::ConstraintError,
                "The name is already in use.",
            ));
        }
        self.source.name().replace(name);
        Ok(())
    }

    pub(crate) fn get_key_path<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        let Some(key_path) = self
            .source
            .index
            .as_ref()
            .map_or(self.source.store.key_path.as_ref(), |it| Some(&it.key_path))
        else {
            return Ok(JSValue::NULL);
        };
        let value = js_IDBSource::key_path(self)
            .map_or_else(|| value_of_key(heap, &key_path.encoded), Ok)?;
        js_IDBSource::set_key_path(self, value);
        Ok(value)
    }

    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, query: JsLocal<'a>) -> Requested<'a> {
        self.get_one(cx, query, Wants::Value)
    }

    pub(crate) fn get_key<'a>(&'a self, cx: Cx<'_, 'a>, query: JsLocal<'a>) -> Requested<'a> {
        self.get_one(cx, query, Wants::Key)
    }

    pub(crate) fn get_all<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        given: JsLocal<'a>,
        count: Option<u32>,
    ) -> Requested<'a> {
        self.get_by_query_or_options(cx, given, count, Wants::Value)
    }

    pub(crate) fn get_all_keys<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        given: JsLocal<'a>,
        count: Option<u32>,
    ) -> Requested<'a> {
        self.get_by_query_or_options(cx, given, count, Wants::Key)
    }

    pub(crate) fn get_all_records<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &IDBGetAllOptions<'a>,
    ) -> Requested<'a> {
        self.require_readable(&cx.heap)?;
        self.get_several(cx, options, Wants::Record)
    }

    pub(crate) fn count<'a>(&'a self, cx: Cx<'_, 'a>, query: JsLocal<'a>) -> Requested<'a> {
        self.require_readable(&cx.heap)?;
        self.request(cx, query, false, |source, range| {
            Operation::Count(source.table(), range)
        })
    }

    pub(crate) fn open_cursor<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        query: JsLocal<'a>,
        direction: IDBCursorDirection,
    ) -> Requested<'a> {
        self.new_cursor(cx, query, direction, true)
    }

    pub(crate) fn open_key_cursor<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        query: JsLocal<'a>,
        direction: IDBCursorDirection,
    ) -> Requested<'a> {
        self.new_cursor(cx, query, direction, false)
    }
}

impl IDBObjectStore {
    pub(crate) fn get_index_names<'a>(&self, heap: &JsHeap<'a>) -> &'a DOMStringList {
        sorted_names(
            heap,
            self.source
                .store
                .indexes
                .borrow()
                .iter()
                .filter(|_| !self.source.store.is_deleted.get())
                .map(|it| &it.name),
        )
    }

    pub(crate) fn get_auto_increment(&self) -> bool {
        self.source.store.auto_increments
    }

    /// <https://w3c.github.io/IndexedDB/#add-or-put>
    fn add_or_put<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: JsLocal<'a>,
        key: JsLocal<'a>,
        replaces: bool,
    ) -> Requested<'a> {
        self.require_writable(&cx.heap)?;
        let key = match (self.source.store.key_path.is_some(), key.is_undefined()) {
            (true, false) => {
                return Err(dom_error(
                    &cx.heap,
                    DomError::DataError,
                    "The object store uses in-line keys and the key parameter was provided.",
                ));
            }
            (false, false) => Some(key_of(cx, key)?.into()),
            (false, true) if !self.source.store.auto_increments => {
                return Err(dom_error(
                    &cx.heap,
                    DomError::DataError,
                    "The object store uses out-of-line keys and has no key generator and the key parameter was not provided.",
                ));
            }
            _ => None,
        };
        self.require_writable(&cx.heap)?;
        self.store_record(cx, self.to_js(), value, key, replaces, None)
    }

    pub(crate) fn put<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: JsLocal<'a>,
        key: JsLocal<'a>,
    ) -> Requested<'a> {
        self.add_or_put(cx, value, key, true)
    }

    pub(crate) fn add<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: JsLocal<'a>,
        key: JsLocal<'a>,
    ) -> Requested<'a> {
        self.add_or_put(cx, value, key, false)
    }

    pub(crate) fn delete<'a>(&'a self, cx: Cx<'_, 'a>, query: JsLocal<'a>) -> Requested<'a> {
        self.require_writable(&cx.heap)?;
        self.request(cx, query, true, |Source { store, .. }, range| {
            Operation::Delete {
                store: store.table,
                range,
                indexes: store.tables_of_indexes(),
            }
        })
    }

    pub(crate) fn clear<'a>(&'a self, heap: &JsHeap<'a>) -> Requested<'a> {
        self.require_writable(heap)?;
        Ok(self.transaction().request(
            heap,
            self.to_js(),
            Operation::Clear(self.source.store.tables()),
        ))
    }

    fn find_index<'a>(&self, heap: &JsHeap<'a>, name: &DomString) -> Result<'a, Rc<Index>> {
        self.source
            .store
            .index(&key_of_string(name))
            .ok_or_else(|| {
                dom_error(
                    heap,
                    DomError::NotFoundError,
                    "The specified index was not found.",
                )
            })
    }

    fn handle_of<'a>(&'a self, heap: &JsHeap<'a>, index: Rc<Index>) -> &'a IDBIndex {
        let handles = js_IDBSource::indexes(self).map_or_else(|| List::new(heap), List::from_value);
        js_IDBSource::set_indexes(self, handles.to_js());
        let known = handles
            .values()
            .filter_map(|it| IDBIndex::from_js(heap, it))
            .find(|it| Rc::ptr_eq(it.index(), &index));
        known.unwrap_or_else(|| {
            let made = js_IDBIndex::create(
                self.realm(heap),
                IDBSource {
                    source: Source {
                        store: Rc::clone(&self.source.store),
                        index: Some(index),
                    },
                    _interior: Default::default(),
                },
            );
            js_IDBSource::set_transaction(made, Some(self.transaction()));
            js_IDBSource::set_object_store(made, Some(self));
            handles.push(heap, made.to_js());
            made
        })
    }

    pub(crate) fn index<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: &DomString,
    ) -> Result<'a, &'a IDBIndex> {
        self.require_existing(heap)?;
        self.transaction().require_unfinished(heap)?;
        Ok(self.handle_of(heap, self.find_index(heap, name)?))
    }

    pub(crate) fn create_index<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: &DomString,
        key_path: IDBNames<'a>,
        options: &IDBIndexParameters,
    ) -> Result<'a, &'a IDBIndex> {
        self.require_upgrade(heap)?;
        let (store, name, key_path) = (
            &self.source.store,
            key_of_string(name),
            KeyPath::from_js(heap, key_path)?,
        );
        if store.index(&name).is_some() {
            return Err(dom_error(
                heap,
                DomError::ConstraintError,
                "An index with the specified name already exists.",
            ));
        }
        key_path.validate(heap)?;
        if options.multi_entry && key_path.is_list {
            return Err(dom_error(
                heap,
                DomError::InvalidAccessError,
                "The key path of a multiEntry index is an array.",
            ));
        }
        let (is_unique, is_multi_entry) = (options.unique, options.multi_entry);
        let index = Rc::new(Index {
            table: Table::unique(),
            name: name.into(),
            key_path,
            is_unique,
            is_multi_entry,
            is_deleted: false.into(),
        });
        store
            .indexes
            .replace(store.indexes().iter().chain([&index]).cloned().collect());
        self.transaction()
            .schedule(heap, Operation::FillIndex(store.table, Rc::clone(&index)));
        Ok(self.handle_of(heap, index))
    }

    pub(crate) fn delete_index<'a>(&self, heap: &JsHeap<'a>, name: &DomString) -> Result<'a> {
        self.require_upgrade(heap)?;
        let (store, index) = (&self.source.store, self.find_index(heap, name)?);
        index.is_deleted.set(true);
        store.indexes.replace(
            store
                .indexes()
                .iter()
                .filter(|it| !Rc::ptr_eq(it, &index))
                .cloned()
                .collect(),
        );
        self.transaction()
            .schedule(heap, Operation::Clear(vec![index.table]));
        Ok(())
    }
}

impl IDBIndex {
    fn index(&self) -> &Rc<Index> {
        self.source.index.as_ref().expect("an index")
    }

    pub(crate) fn get_multi_entry(&self) -> bool {
        self.index().is_multi_entry
    }

    pub(crate) fn get_unique(&self) -> bool {
        self.index().is_unique
    }
}
