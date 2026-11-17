//! <https://storage.spec.whatwg.org/>, and what reads and writes files.

mod area;
mod file_reader;
mod file_system;

use core::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, Error, JsHeap, JsInterface, JsLocal, JsScope};
use bun_web::client::Client;
use bun_web::convert::Object;
use bun_web::storage::QUOTA;
use bun_web::storage::files::{Kind, Locator};

pub(crate) use self::area::{StorageEvent, WebStorage, listen_to_storage};
pub(crate) use self::file_reader::{FileReader, ProgressEvent, blob_of, read};
pub(crate) use self::file_system::{
    FileSystemDirectoryIterator, FileSystemHandle, FileSystemSyncAccessHandle,
    FileSystemWritableFileStream,
};
use crate::api::core::*;
use crate::api::events::{Event, EventInit, Trusted, dispatch};
use crate::api::realm::{
    Shelf, client_of, hold, promise_for, queue_task, quota_exceeded, realm_of, shelf_of, spawn,
};
use crate::generated_bindgen::storage::*;
use crate::generated_bindgen::window::{NavigatorEverywhere, js_AnyNavigator};

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

/// <https://html.spec.whatwg.org/#domstringlist>
pub(crate) struct DOMStringList(Vec<DomString>);

impl DOMStringList {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, strings: Vec<DomString>) -> &'a DOMStringList {
        js_DOMStringList::create(heap, DOMStringList(strings))
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.0.len() as u32
    }

    pub(crate) fn indexed_get(&self, _: &JsHeap<'_>, index: u32) -> Option<&DomString> {
        self.0.get(index as usize)
    }

    pub(crate) fn contains(&self, string: &DomString) -> bool {
        self.0.contains(string)
    }
}

impl NavigatorEverywhere {
    pub(crate) fn get_storage<'a>(&'a self, heap: &JsHeap<'a>) -> &'a StorageManager {
        let manager = js_StorageManager::create(self.realm(heap), Default::default());
        js_StorageManager::set_scope(manager, js_AnyNavigator::scope(self));
        manager
    }
}

impl StorageManager {
    fn shelf<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Shelf> {
        shelf_of(
            cx,
            js_StorageManager::scope(self).expect("set when it is made"),
        )
        .map_err(|_| {
            cx.heap.type_error(format_args!(
                "The operation is not supported in this context."
            ))
        })
    }

    pub(crate) fn persisted<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let Shelf { storage, bucket } = self.shelf(cx)?;
        Ok(cx
            .promise_resolve(storage.is_persisted(&bucket).into())?
            .to_js())
    }

    pub(crate) fn persist<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let Shelf { storage, bucket } = self.shelf(cx)?;
        storage.persist(&bucket);
        Ok(cx.promise_resolve(JSValue::TRUE)?.to_js())
    }

    pub(crate) fn estimate<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let Shelf { storage, bucket } = self.shelf(cx)?;
        Ok(promise_for(cx, storage.usage(bucket), |cx, usage| {
            let usage = usage.map_err(|_| {
                cx.heap.type_error(format_args!(
                    "Internal error when calculating storage usage."
                ))
            })?;
            let (estimate, details) = (Object::new(cx), Object::new(cx));
            let parts = [
                ("caches", usage.of_caches),
                ("fileSystem", usage.of_files),
                ("indexedDB", usage.of_databases),
            ];
            parts
                .iter()
                .filter(|it| it.1 > 0.0)
                .for_each(|it| details.number(cx, it.0, it.1));
            estimate.number(cx, "quota", QUOTA as f64);
            estimate.number(cx, "usage", parts.iter().map(|it| it.1).sum());
            estimate.set(cx, "usageDetails", details.into_value());
            Ok(estimate.into_value().to_js())
        }))
    }

    pub(crate) fn get_directory<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let Shelf { storage, bucket } = self.shelf(cx).map_err(|_| {
            dom_error(
                &cx.heap,
                DomError::SecurityError,
                "Storage directory access is denied.",
            )
        })?;
        let root = Locator::new(storage, &bucket, Vec::new());
        Ok(file_system::promise_for_file(
            cx,
            root.create_root(),
            |cx, ()| Ok(FileSystemHandle::new(&cx.heap, Kind::Directory, root).to_js()),
        ))
    }
}
