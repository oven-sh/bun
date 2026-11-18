//! <https://w3c.github.io/IndexedDB/>

mod cursor;
mod database;
mod factory;
pub(crate) mod keys;
mod request;
mod source;
mod transaction;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{self, Error, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_web::held::Held;
use bun_web::storage::indexed::{self as stored, Direction, Failure, IndexKeys, Table};
use bun_web::storage::key::{self, Key, KeyRange};

pub(crate) use self::cursor::IDBCursor;
pub(crate) use self::database::IDBDatabase;
pub(crate) use self::keys::IDBKeyRange;
use self::keys::*;
use self::request::Operation;
pub(crate) use self::request::{IDBRequest, IDBVersionChangeEvent};
pub(crate) use self::source::IDBSource;
pub(crate) use self::transaction::IDBTransaction;
use crate::api::core::*;
use crate::api::events::{Event, EventFlags, EventInit, Trusted, dispatch_along};
use crate::api::realm::{Kept, hold, queue_task, spawn};
use crate::api::storage::DOMStringList;
use crate::generated_bindgen::indexeddb::*;
use crate::order::Order as _;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

struct Index {
    table: Table,
    name: RefCell<Key>,
    key_path: KeyPath,
    is_unique: bool,
    is_multi_entry: bool,
    is_deleted: Cell<bool>,
}

struct Store {
    table: Table,
    name: RefCell<Key>,
    key_path: Option<KeyPath>,
    auto_increments: bool,
    indexes: RefCell<Rc<[Rc<Index>]>>,
    is_deleted: Cell<bool>,
}

impl Index {
    fn keys_for<'a>(&self, cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, IndexKeys> {
        Ok(IndexKeys {
            table: self.table,
            is_unique: self.is_unique,
            keys: self
                .key_path
                .extract_for_index(cx, value, self.is_multi_entry)?,
        })
    }
}

impl Store {
    fn indexes(&self) -> Rc<[Rc<Index>]> {
        Rc::clone(&self.indexes.borrow())
    }

    fn index(&self, name: &[u8]) -> Option<Rc<Index>> {
        self.indexes
            .borrow()
            .iter()
            .find(|it| **it.name.borrow() == *name)
            .cloned()
    }

    fn tables_of_indexes(&self) -> Vec<Table> {
        self.indexes.borrow().iter().map(|it| it.table).collect()
    }

    fn tables(&self) -> Vec<Table> {
        let mut tables = self.tables_of_indexes();
        tables.push(self.table);
        tables
    }
}

impl From<&stored::StoreSchema> for Store {
    fn from(it: &stored::StoreSchema) -> Store {
        let index = |it: &stored::IndexSchema| {
            let (name, key_path) = (Key::clone(&it.name).into(), KeyPath::parse(&it.key_path));
            Rc::new(Index {
                table: it.table,
                name,
                key_path,
                is_unique: it.is_unique,
                is_multi_entry: it.is_multi_entry,
                is_deleted: false.into(),
            })
        };
        Store {
            table: it.table,
            name: Key::clone(&it.name).into(),
            key_path: it.key_path.as_ref().map(KeyPath::parse),
            auto_increments: it.auto_increments,
            indexes: RefCell::new(it.indexes.iter().map(index).collect()),
            is_deleted: false.into(),
        }
    }
}

impl From<&Store> for stored::StoreSchema {
    fn from(it: &Store) -> stored::StoreSchema {
        let index = |it: &Rc<Index>| stored::IndexSchema {
            table: it.table,
            name: Key::clone(&it.name.borrow()),
            key_path: Key::clone(&it.key_path.encoded),
            is_unique: it.is_unique,
            is_multi_entry: it.is_multi_entry,
        };
        stored::StoreSchema {
            table: it.table,
            name: Key::clone(&it.name.borrow()),
            key_path: it.key_path.as_ref().map(|it| Key::clone(&it.encoded)),
            auto_increments: it.auto_increments,
            indexes: it.indexes.borrow().iter().map(index).collect(),
        }
    }
}

/// <https://w3c.github.io/IndexedDB/#create-a-sorted-name-list>
fn sorted_names<'a, 'n>(
    heap: &JsHeap<'a>,
    names: impl Iterator<Item = &'n RefCell<Key>>,
) -> &'a DOMStringList {
    let mut names: Vec<_> = names.map(|it| Key::clone(&it.borrow())).collect();
    names.order_by(Ord::cmp);
    DOMStringList::new(heap, names.iter().map(|it| string_of_key(it)).collect())
}

impl From<IDBCursorDirection> for Direction {
    fn from(it: IDBCursorDirection) -> Direction {
        use IDBCursorDirection::*;
        Direction {
            is_forward: matches!(it, Next | Nextunique),
            skips_duplicates: matches!(it, Nextunique | Prevunique),
        }
    }
}

fn error_of<'a>(cx: Cx<'_, 'a>, failure: Failure) -> Error<'a> {
    let (code, message) = match failure {
        Failure::KeyExists => (
            DomError::ConstraintError,
            "Key already exists in the object store.",
        ),
        Failure::IndexKeyExists => (
            DomError::ConstraintError,
            "At least one key does not satisfy the uniqueness requirements.",
        ),
        Failure::NoKeyLeft => (
            DomError::ConstraintError,
            "The key generator has run out of keys.",
        ),
        Failure::Erased => (DomError::AbortError, "The database was deleted."),
        Failure::Sql(error) if error.is_lack_of_space() => {
            return crate::api::realm::quota_exceeded(cx, "There is not enough space.");
        }
        Failure::Sql(_) => (
            DomError::UnknownError,
            "Internal error of the backing store.",
        ),
    };
    dom_error(&cx.heap, code, message)
}

fn aborted(heap: &JsHeap<'_>, message: &str) -> JSValue {
    heap.create_dom_exception(DomError::AbortError, format_args!("{message}"))
        .to_js()
}

fn serialize<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, Box<[u8]>> {
    Ok(value
        .serialize(
            cx.global(),
            bun_jsc::SerializedFlags {
                for_cross_process_transfer: false,
                for_storage: true,
            },
        )
        .map(|it| bun_web::net::body::concat(&[it.data()]))?
        .into())
}

/// Of what this module has handed to a task.
fn handle<T: JsInterface>(value: JsLocal<'_>) -> &T {
    // SAFETY: it is one, and `value` is on the stack.
    unsafe { T::from_js_unchecked(value.to_js()) }
}
