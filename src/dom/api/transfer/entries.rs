//! <https://wicg.github.io/entries-api/>, for the files that have been dropped.

use bun_jsc::bindgen::Callable;

use crate::api::ui::prelude::*;
use crate::generated_bindgen::transfer::*;

pub(crate) struct FileSystemEntry {
    name: DomString,
    _interior: bindgen::Interior,
}

impl FileSystemEntry {
    pub(super) fn of<'a>(heap: &JsHeap<'a>, file: JSValue, name: DomString) -> &'a FileSystemEntry {
        let state = FileSystemEntry {
            name,
            _interior: Default::default(),
        };
        let this: &FileSystemEntry = match bun_web::convert::is_directory(global_of(heap), file) {
            true => js_FileSystemDirectoryEntry::create(heap, state),
            false => js_FileSystemFileEntry::create(heap, state),
        };
        js_FileSystemEntry::set_file(this, file);
        this
    }

    pub(crate) fn get_is_file(&self) -> bool {
        self.is_a::<FileSystemFileEntry>()
    }

    pub(crate) fn get_is_directory(&self) -> bool {
        self.is_a::<FileSystemDirectoryEntry>()
    }

    pub(crate) fn get_name(&self) -> &DomString {
        &self.name
    }

    pub(crate) fn get_full_path(&self) -> DomString {
        DomString::concat(&[&"/".into(), &self.name])
    }
}

impl FileSystemFileEntry {
    pub(crate) fn file<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        success: JsLocal<'a, Callable>,
        _: Option<JsLocal<'a, Callable>>,
    ) {
        host::call_back_soon(
            heap,
            success.to_js(),
            js_FileSystemEntry::file(self).unwrap_or(JSValue::NULL),
        );
    }
}

impl FileSystemDirectoryEntry {
    pub(crate) fn create_reader<'a>(&'a self, heap: &JsHeap<'a>) -> &'a FileSystemDirectoryReader {
        js_FileSystemDirectoryReader::create(self.realm(heap), Default::default())
    }
}

impl FileSystemDirectoryReader {
    pub(crate) fn read_entries<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        success: JsLocal<'a, Callable>,
        _: Option<JsLocal<'a, Callable>>,
    ) -> bindgen::Result<'a, ()> {
        host::call_back_soon(
            heap,
            success.to_js(),
            JSValue::create_empty_array(global_of(self.realm(heap)), 0)?,
        );
        Ok(())
    }
}
