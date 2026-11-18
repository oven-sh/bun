//! Files, the clipboard, and what is dragged.

pub(crate) mod clipboard;
pub(crate) mod entries;

use core::cell::Cell;

use bun_core::strings;
use bun_jsc::JSObject;
use bun_jsc::bindgen::Callable;

use crate::api::ui::prelude::*;
pub(crate) use crate::generated_bindgen::transfer::{DataTransferItemList, FileList};
use crate::generated_bindgen::transfer::{
    js_DataTransfer, js_DataTransferItem, js_DataTransferItemList, js_FileList,
};

slots!(
    FileList = js_FileList {
        transfer: DataTransfer,
    }
);

impl FileList {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        files: impl IntoIterator<Item = JSValue>,
    ) -> &'a FileList {
        let (this, list) = (
            js_FileList::create(heap, Default::default()),
            List::new(heap),
        );
        files.into_iter().for_each(|it| list.push(heap, it));
        js_FileList::set_files(this, list.to_js());
        this
    }

    pub(crate) fn files(&self) -> impl Iterator<Item = JSValue> {
        let dragged = self
            .transfer()
            .filter(|it| it.is_readable())
            .map(|it| it.items().iter().filter_map(DataTransferItem::file));
        js_FileList::files(self)
            .map(List::from_value)
            .into_iter()
            .flat_map(List::values)
            .chain(dragged.into_iter().flatten())
    }

    pub(crate) fn names(&self) -> impl Iterator<Item = DomString> {
        unsafe extern "C" {
            safe fn Bun__DOM__nameOfFile(file: JSValue) -> bun_core::String;
        }
        let names = self.files().map(Bun__DOM__nameOfFile);
        names.map(|name| {
            if name.is_utf16() {
                DomString::from_utf16(name.utf16())
            } else {
                DomString::from_latin1(name.latin1())
            }
        })
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.files().count() as u32
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<JSValue> {
        self.files().nth(index as usize)
    }

    pub(crate) fn item(&self, index: u32) -> JSValue {
        self.indexed_get(index).unwrap_or(JSValue::NULL)
    }

    pub(crate) fn serialize<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        _: bool,
    ) -> bindgen::Result<'a, JSValue> {
        Ok(cx
            .heap
            .create_array(self.files(), |heap, it| Ok(JsLocal::new(heap, it)))?
            .to_js())
    }

    pub(crate) fn deserialize<'a>(
        cx: &mut Cx<'a>,
        clone: JsLocal<'a>,
    ) -> bindgen::Result<'a, &'a FileList> {
        Ok(FileList::new(
            &cx.heap,
            List::from_script(&cx.heap, clone.to_js()).values(),
        ))
    }
}

/// <https://html.spec.whatwg.org/#drag-data-store-mode>
#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Mode {
    #[default]
    ReadWrite,
    ReadOnly,
    /// Only the types can be read.
    Protected,
    Disabled,
}

macro_rules! keywords {
    ($name:ident { $($variant:ident = $text:literal,)+ }) => {
        #[derive(Clone, Copy, Default, PartialEq, Eq)]
        pub(crate) enum $name {
            #[default]
            $($variant,)+
        }

        impl $name {
            fn from_name(name: &DomString) -> Option<$name> {
                [$($name::$variant),+].into_iter().find(|it| name.eq_str(it.name()))
            }

            fn name(self) -> &'static str {
                match self {
                    $($name::$variant => $text,)+
                }
            }
        }
    };
}
keywords!(DropEffect { None = "none", Copy = "copy", Link = "link", Move = "move", });
keywords!(EffectAllowed {
    None = "none",
    Copy = "copy",
    CopyLink = "copyLink",
    CopyMove = "copyMove",
    Link = "link",
    LinkMove = "linkMove",
    Move = "move",
    All = "all",
    Uninitialized = "uninitialized",
});

impl EffectAllowed {
    pub(crate) fn allows(self, effect: DropEffect) -> bool {
        use EffectAllowed::*;
        matches!(
            (self, effect),
            (All | Uninitialized, _)
                | (Copy | CopyLink | CopyMove, DropEffect::Copy)
                | (Link | CopyLink | LinkMove, DropEffect::Link)
                | (Move | CopyMove | LinkMove, DropEffect::Move)
        )
    }
}

pub(crate) struct DataTransferItem {
    format: DomString,
    text: DomString,
    _interior: bun_jsc::bindgen::Interior,
}

slots!(
    DataTransferItem = js_DataTransferItem {
        transfer: DataTransfer,
    }
);

impl DataTransferItem {
    fn file(&self) -> Option<JSValue> {
        js_DataTransferItem::file(self)
    }

    fn is_text_in(&self, format: &DomString) -> bool {
        self.file().is_none() && self.format == *format
    }

    fn mode(&self) -> Mode {
        self.transfer()
            .filter(|it| it.items().contains(self))
            .map_or(Mode::Disabled, |it| it.mode.get())
    }

    pub(crate) fn get_kind(&self) -> Known {
        match self.file() {
            _ if self.mode() == Mode::Disabled => atom!(""),
            Some(_) => atom!("file"),
            None => atom!("string"),
        }
    }

    pub(crate) fn get_type(&self) -> DomString {
        if self.mode() == Mode::Disabled {
            DomString::default()
        } else {
            self.format.clone()
        }
    }

    pub(crate) fn get_as_string<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        callback: Option<JsLocal<'a, Callable>>,
    ) {
        if let Some(callback) =
            callback.filter(|_| self.file().is_none() && self.mode() <= Mode::ReadOnly)
        {
            let text = self.text.to_js(&cx.heap).to_js();
            host::call_back_soon(&cx.heap, callback.to_js(), text);
        }
    }

    pub(crate) fn get_as_file(&self) -> JSValue {
        self.file()
            .filter(|_| self.mode() <= Mode::ReadOnly)
            .unwrap_or(JSValue::NULL)
    }

    pub(crate) fn webkit_get_as_entry<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> Option<&'a entries::FileSystemEntry> {
        Some(self.get_as_file())
            .filter(|it| !it.is_null())
            .map(|it| entries::FileSystemEntry::of(self.realm(heap), it, name_of_file(it)))
    }
}

slots!(
    DataTransferItemList = js_DataTransferItemList {
        transfer: DataTransfer,
    }
);

impl DataTransferItemList {
    fn items(&self) -> Refs<'_, DataTransferItem> {
        self.transfer()
            .filter(|it| it.mode.get() != Mode::Disabled)
            .map(DataTransfer::items)
            .unwrap_or_default()
    }

    fn writable(&self) -> Option<&DataTransfer> {
        self.transfer()
            .filter(|it| it.mode.get() == Mode::ReadWrite)
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.items().len() as u32
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<&DataTransferItem> {
        self.items().get(index as usize)
    }

    pub(crate) fn add_file<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        file: JsLocal<'a, JSObject>,
    ) -> bindgen::Result<'a, Option<&'a DataTransferItem>> {
        let Some(format) = host::type_of_file(file.to_js()) else {
            return Err(cx.heap.type_error(format_args!(
                "Failed to execute 'add': parameter 1 is not of type 'File'."
            )));
        };
        Ok(self.writable().map(|it| {
            it.add(
                &cx.heap,
                format.to_ascii_lowercase(),
                DomString::default(),
                Some(file.to_js()),
            )
        }))
    }

    pub(crate) fn add_text<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        data: DomString,
        format: &DomString,
    ) -> bindgen::Result<'a, Option<&'a DataTransferItem>> {
        let (Some(transfer), format) = (self.writable(), format.to_ascii_lowercase()) else {
            return Ok(None);
        };
        if transfer.items().iter().any(|it| it.is_text_in(&format)) {
            return Err(dom_error(
                heap,
                DomError::NotSupportedError,
                "An item already exists for this type.",
            ));
        }
        Ok(Some(transfer.add(heap, format, data, None)))
    }

    pub(crate) fn remove<'a>(&'a self, heap: &JsHeap<'a>, index: u32) -> bindgen::Result<'a, ()> {
        let transfer = self.writable().ok_or_else(|| {
            dom_error(
                heap,
                DomError::InvalidStateError,
                "The list is not writable.",
            )
        })?;
        if let Some(removed) = transfer.items().get(index as usize) {
            transfer.keep(heap, |it| !core::ptr::eq(it, removed));
        }
        Ok(())
    }

    pub(crate) fn clear(&self, heap: &JsHeap<'_>) {
        if let Some(it) = self.writable() {
            it.keep(heap, |_| false);
        }
    }
}

#[derive(Default)]
pub(crate) struct DataTransfer {
    mode: Cell<Mode>,
    drop_effect: Cell<DropEffect>,
    effect_allowed: Cell<EffectAllowed>,
    /// Where the pointer is on the drag image.
    hot_spot: Cell<[i32; 2]>,
}

slots!(DataTransfer = js_DataTransfer { list: DataTransferItemList, files: FileList, drag_image: Element, } [items: DataTransferItem,]);

fn trimmed_lowercase(format: &DomString) -> String {
    format.to_utf8().trim_ascii().to_ascii_lowercase()
}

fn normalized(format: &DomString) -> DomString {
    match &*trimmed_lowercase(format) {
        "url" => "text/uri-list".into(),
        it if it == "text" || it.starts_with("text/plain;") => "text/plain".into(),
        it if it.starts_with("text/uri-list;") => "text/uri-list".into(),
        it => it.into(),
    }
}

impl DataTransfer {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, mode: Mode) -> &'a DataTransfer {
        js_DataTransfer::create(
            heap,
            DataTransfer {
                mode: mode.into(),
                ..Default::default()
            },
        )
    }

    pub(crate) fn constructor() -> DataTransfer {
        DataTransfer::default()
    }

    fn is_readable(&self) -> bool {
        self.mode.get() <= Mode::ReadOnly
    }

    fn add<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        format: DomString,
        text: DomString,
        file: Option<JSValue>,
    ) -> &'a DataTransferItem {
        let item = js_DataTransferItem::create(
            self.realm(heap),
            DataTransferItem {
                format,
                text,
                _interior: Default::default(),
            },
        );
        item.set_transfer(Some(self));
        js_DataTransferItem::set_file(item, file.unwrap_or_default());
        self.set_items(self.items().with(heap, item));
        js_DataTransfer::set_types(self, JSValue::ZERO);
        item
    }

    fn keep(&self, heap: &JsHeap<'_>, test: impl Fn(&DataTransferItem) -> bool) {
        if !self.items().iter().all(&test) {
            self.set_items(Refs::collect(
                heap,
                self.items().iter().filter(|it| test(it)),
            ));
            js_DataTransfer::set_types(self, JSValue::ZERO);
        }
    }

    fn text_in(&self, format: &DomString) -> DomString {
        self.items()
            .iter()
            .find(|it| it.is_text_in(format))
            .map(|it| it.text.clone())
            .unwrap_or_default()
    }

    fn replace<'a>(&'a self, heap: &JsHeap<'a>, format: DomString, text: DomString) {
        self.keep(heap, |it| !it.is_text_in(&format));
        self.add(heap, format, text, None);
    }

    pub(crate) fn set_mode(&self, mode: Mode) {
        self.mode.set(mode);
    }

    pub(crate) fn put<'a>(&'a self, heap: &JsHeap<'a>, format: &str, text: DomString) {
        self.replace(heap, format.into(), text);
    }

    pub(crate) fn stored(&self, format: &str) -> DomString {
        self.text_in(&format.into())
    }

    pub(crate) fn discard(&self, heap: &JsHeap<'_>, format: &str) {
        let format = format.into();
        self.keep(heap, |it| !it.is_text_in(&format));
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.items().is_empty()
    }

    pub(crate) fn drop_effect(&self) -> DropEffect {
        self.drop_effect.get()
    }

    pub(crate) fn set_drop_effect(&self, effect: DropEffect) {
        self.drop_effect.set(effect);
    }

    pub(crate) fn effect_allowed(&self) -> EffectAllowed {
        self.effect_allowed.get()
    }

    pub(crate) fn set_effect_allowed(&self, effect: EffectAllowed) {
        self.effect_allowed.set(effect);
    }

    pub(crate) fn get_drop_effect_name(&self) -> DomString {
        self.drop_effect().name().into()
    }

    pub(crate) fn set_drop_effect_name(&self, name: &DomString) {
        if let Some(it) = DropEffect::from_name(name) {
            self.set_drop_effect(it);
        }
    }

    pub(crate) fn get_effect_allowed_name(&self) -> DomString {
        self.effect_allowed().name().into()
    }

    pub(crate) fn set_effect_allowed_name(&self, name: &DomString) {
        if let Some(it) =
            EffectAllowed::from_name(name).filter(|_| self.mode.get() == Mode::ReadWrite)
        {
            self.set_effect_allowed(it);
        }
    }

    pub(crate) fn get_items<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DataTransferItemList {
        self.list().unwrap_or_else(|| {
            let list = js_DataTransferItemList::create(self.realm(heap), Default::default());
            list.set_transfer(Some(self));
            self.set_list(Some(list));
            list
        })
    }

    pub(crate) fn get_files<'a>(&'a self, heap: &JsHeap<'a>) -> &'a FileList {
        self.files().unwrap_or_else(|| {
            let files = js_FileList::create(self.realm(heap), Default::default());
            files.set_transfer(Some(self));
            self.set_files(Some(files));
            files
        })
    }

    pub(crate) fn get_types<'a>(&'a self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JSValue> {
        let heap = self.realm(heap);
        let frozen = |types: Vec<DomString>| {
            Ok(heap
                .freeze_array(heap.create_array(types, |heap, it| Ok(it.to_js(heap).as_value()))?)?
                .to_js())
        };
        if self.mode.get() == Mode::Disabled {
            return frozen(Vec::new());
        }
        if let Some(types) = js_DataTransfer::types(self) {
            return Ok(types);
        }
        let of_texts = self
            .items()
            .iter()
            .filter(|it| it.file().is_none())
            .map(|it| it.format.clone());
        let types = frozen(
            of_texts
                .chain(
                    self.items()
                        .iter()
                        .any(|it| it.file().is_some())
                        .then(|| "Files".into()),
                )
                .collect(),
        )?;
        js_DataTransfer::set_types(self, types);
        Ok(types)
    }

    pub(crate) fn get_data(&self, format: &DomString) -> DomString {
        if !self.is_readable() {
            return DomString::default();
        }
        let text = self.text_in(&normalized(format));
        if trimmed_lowercase(format) != "url" {
            return text;
        }
        let text = text.to_utf8();
        let url = strings::tokenize_any(text.as_bytes(), b"\r\n").find(|it| it[0] != b'#');
        url.and_then(|it| str::from_utf8(it).ok())
            .unwrap_or_default()
            .into()
    }

    pub(crate) fn set_data<'a>(&'a self, heap: &JsHeap<'a>, format: &DomString, data: DomString) {
        if self.mode.get() == Mode::ReadWrite {
            self.replace(heap, normalized(format), data);
        }
    }

    pub(crate) fn clear_data(&self, heap: &JsHeap<'_>, format: Option<&DomString>) {
        if self.mode.get() == Mode::ReadWrite {
            let format = format.map(normalized);
            self.keep(heap, |it| {
                it.file().is_some() || format.as_ref().is_some_and(|only| it.format != *only)
            });
        }
    }

    pub(crate) fn choose_drag_image(&self, image: &Element, x: i32, y: i32) {
        if self.mode.get() == Mode::ReadWrite {
            self.set_drag_image(Some(image));
            self.hot_spot.set([x, y]);
        }
    }

    pub(crate) fn hot_spot(&self) -> [i32; 2] {
        self.hot_spot.get()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Clipboard {
    General,
    /// What the middle button pastes.
    Selection,
}

fn name_of_file(file: JSValue) -> DomString {
    file.as_class_ref::<bun_jsc::webcore_types::Blob>()
        .map(|it| DomString::from_utf8(&it.name.get().to_string()))
        .unwrap_or_default()
}

/// Of files that are dragged into the window, if there are any.
pub(crate) fn of_chosen_files<'a>(
    cx: &mut Cx<'a>,
    doc: &'a Doc,
    files: &[bun_web::host::ChosenFile],
) -> Option<&'a DataTransfer> {
    let heap = doc.heap(&cx.heap);
    files.first()?;
    let data = DataTransfer::new(heap, Mode::ReadWrite);
    for file in files
        .iter()
        .filter_map(|it| bun_web::convert::file_at(global_of(heap), it.0.as_bytes()))
    {
        data.add(
            heap,
            host::type_of_file(file).unwrap_or_default(),
            DomString::default(),
            Some(file),
        );
    }
    Some(data)
}

pub(crate) fn read_clipboard<'a>(
    cx: &mut Cx<'a>,
    doc: &'a Doc,
    clipboard: Clipboard,
) -> &'a DataTransfer {
    let data = DataTransfer::new(doc.heap(&cx.heap), Mode::ReadWrite);
    clipboard::read_into(cx, doc, data, clipboard);
    data.set_mode(Mode::ReadOnly);
    data
}

pub(crate) use clipboard::write_from as write_clipboard;
