//! Electron's `clipboard`

use core::ffi::c_char;

use bun_jsc::bindgen::JsRecord;
use bun_jsc::{JSGlobalObject, JSString};
use bun_ui::clipboard;
use bun_ui::protocol::{self, ClipboardPart as Part};

use crate::files;
use crate::generated_bindgen::electron::{js_ElectronClipboard, js_ElectronClipboardItem as items};
use crate::prelude::*;

unsafe extern "C" {
    fn Bun__Desktop__createBlob(
        global: &JSGlobalObject,
        bytes: *const u8,
        length: usize,
        kind: *const c_char,
    ) -> JSValue;
}

fn blob(bytes: &[u8], kind: &str) -> JSValue {
    let kind = bun_core::ZBox::from_bytes(kind);
    // SAFETY: both are copied.
    unsafe { Bun__Desktop__createBlob(global(), bytes.as_ptr(), bytes.len(), kind.as_ptr()) }
}

#[derive(Default)]
pub(crate) struct ClipboardItem {
    types: RefCell<Vec<String>>,
}

impl ClipboardItem {
    fn add(&self, kind: String, value: JSValue) -> JsResult<()> {
        if items::values(self).is_none() {
            items::set_values(self, array(&[])?);
        }
        self.types.borrow_mut().push(kind);
        items::values(self).map_or(Ok(()), |it| it.push(global(), value))
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        given: JsRecord<'a, JsLocal<'a, JSString>, JsLocal<'a>>,
    ) -> JsResult<&'a Self> {
        let item = structure.create(&cx.heap, ClipboardItem::default());
        given
            .iter()
            .try_for_each(|(kind, value)| item.add(text_of(kind.to_js())?, value.to_js()))?;
        Ok(item)
    }

    pub(crate) fn get_types(&self) -> Vec<String> {
        self.types.borrow().clone()
    }

    fn promise_of(&self, kind: String) -> JsResult<JSValue> {
        let index = self.types.borrow().iter().position(|it| *it == kind);
        let (Some(index), Some(values)) = (index, items::values(self)) else {
            return Err(error(format_args!(
                "The type '{kind}' was not found in the ClipboardItem"
            )));
        };
        let result = Deferred::new();
        let promise = result.promise();
        then(
            values.get_index(global(), index as u32)?,
            move |value| match value {
                Ok(text) if text.is_string() => {
                    result.resolve(blob(&text.to_utf8(global())?, &kind))
                }
                Ok(value) => result.resolve(value),
                Err(thrown) => result.settle(Err(global().throw_value(thrown))),
            },
        )?;
        Ok(promise)
    }

    pub(crate) fn get_type(&self, _: Cx<'_, '_>, kind: &[u8]) -> JsResult<JSValue> {
        self.promise_of(string(kind))
    }
}

pub(crate) struct Clipboard {
    is_selection: Cell<bool>,
}

struct Write {
    item: Root<ClipboardItem>,
    types: Vec<String>,
    contents: protocol::Clipboard,
    is_selection: bool,
    result: Deferred,
}

impl Write {
    fn take(&mut self, kind: &str, bytes: JSValue) -> JsResult<()> {
        let text = || {
            bytes
                .as_array_buffer(global())
                .map(|it| Text::lossy(it.slice()))
                .into()
        };
        match kind {
            "text/html" => self.contents.html = text(),
            "text/plain" | "text/uri-list" => self.contents.text = text(),
            _ => {
                self.contents.image =
                    Maybe::Yes(NativeImage::with(global(), bytes, |it| it.png(global()))?.into())
            }
        }
        Ok(())
    }

    fn fail(self, thrown: JSValue) -> JsResult<()> {
        self.result.settle(Err(global().throw_value(thrown)))
    }

    fn go_on(mut self) -> JsResult<()> {
        let Some(kind) = self.types.pop() else {
            let written = clipboard::write(global(), self.contents, self.is_selection);
            return self.result.settle(written.map(|()| JSValue::UNDEFINED));
        };
        then(
            self.item.get().promise_of(kind.clone())?,
            move |blob| match blob
                .map_or_else(|it| Ok(Err(it)), |it| catch(invoke(it, "bytes", &[])))?
            {
                Err(thrown) => self.fail(thrown),
                Ok(bytes) => then(bytes, move |bytes| {
                    match bytes.map_or_else(|it| Ok(Err(it)), |it| catch(self.take(&kind, it)))? {
                        Err(thrown) => self.fail(thrown),
                        Ok(()) => self.go_on(),
                    }
                }),
            },
        )
    }
}

impl Clipboard {
    pub(crate) fn create() -> JSValue {
        let clipboard = js_ElectronClipboard::create(
            heap(),
            Clipboard {
                is_selection: false.into(),
            },
        );
        if cfg!(target_os = "linux") {
            let selection = js_ElectronClipboard::create(
                heap(),
                Clipboard {
                    is_selection: true.into(),
                },
            );
            js_ElectronClipboard::set_selection(clipboard, selection.to_js());
        }
        clipboard.to_js()
    }

    fn contents(&self, part: Part) -> JsResult<protocol::Clipboard> {
        clipboard::read(
            global(),
            if self.is_selection.get() {
                Part::Selection
            } else {
                part
            },
        )
    }

    fn set_text(&self, text: &[u8]) -> JsResult<()> {
        let contents = protocol::Clipboard {
            text: Maybe::Yes(Text::lossy(text)),
            ..Default::default()
        };
        clipboard::write(global(), contents, self.is_selection.get())
    }

    pub(crate) fn get_selection(&self) -> JSValue {
        js_ElectronClipboard::selection(self).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn clear(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.set_text(b"")
    }

    pub(crate) fn has(&self, _: Cx<'_, '_>, kind: &[u8]) -> JsResult<JSValue> {
        resolved(
            clipboard::formats(&self.contents(Part::Everything)?).any(|it| it.as_bytes() == kind),
        )
    }

    pub(crate) fn read_text(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved(self.contents(Part::Text)?.text.get().unwrap_or_default())
    }

    pub(crate) fn write_text(&self, _: Cx<'_, '_>, text: &[u8]) -> JsResult<JSValue> {
        self.set_text(text)?;
        resolved(JSValue::UNDEFINED)
    }

    pub(crate) fn read(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let (contents, item) = (
            self.contents(Part::Everything)?,
            items::create(heap(), ClipboardItem::default()),
        );
        for kind in clipboard::formats(&contents) {
            let value = match kind {
                "text/plain" => js(contents.text.as_ref())?,
                "text/html" => js(contents.html.as_ref())?,
                "text/uri-list" => js(contents
                    .files
                    .iter()
                    .map(|it| files::to_url(it))
                    .collect::<Vec<_>>()
                    .join("\r\n"))?,
                _ => blob(contents.image.as_ref().map_or(&[], |it| it), kind),
            };
            item.add(kind.into(), value)?;
        }
        resolved(array(
            &[item.to_js()][..usize::from(items::values(item).is_some())],
        )?)
    }

    pub(crate) fn write<'a>(
        &self,
        _: Cx<'a, '_>,
        given: JsList<'a, &'a ClipboardItem>,
    ) -> JsResult<JSValue> {
        let Some(item) = given.iter().next() else {
            self.set_text(b"")?;
            return resolved(JSValue::UNDEFINED);
        };
        let all = item.get_types();
        let first = |is_wanted: fn(&str) -> bool| all.iter().find(|it| is_wanted(it)).cloned();
        let text = first(|it| it == "text/plain").or_else(|| first(|it| it == "text/uri-list"));
        let types = [
            text,
            first(|it| it == "text/html"),
            first(|it| it.starts_with("image/")),
        ];
        let result = Deferred::new();
        let promise = result.promise();
        let (item, types, contents) = (
            Root::new(item),
            types.into_iter().flatten().collect(),
            Default::default(),
        );
        Write {
            item,
            types,
            contents,
            is_selection: self.is_selection.get(),
            result,
        }
        .go_on()?;
        Ok(promise)
    }
}
