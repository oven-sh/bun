//! <https://w3c.github.io/clipboard-apis/#async-clipboard-api>, and the clipboard of the system.

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{JsList, JsRecord, JsStringImpl};
use bun_jsc::webcore_types::Blob;
use bun_jsc::{JSGlobalObject, Strong};
use bun_ui::protocol::{self, ClipboardPart, Text};
use bun_web::exec::{self, oneshot, settled};
use bun_web::runtime::{create_blob, create_file};

use super::{Clipboard as Which, DataTransfer};
use crate::api::events::{Event, EventInit, Trusted, dispatch};
use crate::api::realm::promise_for;
use crate::api::storage::{blob_of, read};
use crate::api::ui::prelude::*;
use crate::api::{frames, markup};
use crate::generated_bindgen::transfer::*;

const PLAIN_TEXT: &str = "text/plain";
const HTML: &str = "text/html";
const PNG: &str = "image/png";
const SVG: &str = "image/svg+xml";
const MAX_CUSTOM_FORMATS: usize = 100;

/// Types and texts.
type Texts = Vec<(String, String)>;

/// The system takes text, HTML and an image. The other types are known for as long as it has that text.
#[derive(Default)]
struct Written {
    texts: RefCell<Option<Texts>>,
    has_image: Cell<bool>,
    serial: Cell<u32>,
}

bun_ui::state!(fn written() -> Written);

fn find<'t>(texts: &'t Texts, wanted: &str) -> Option<&'t str> {
    texts.iter().find(|it| it.0 == wanted).map(|it| &*it.1)
}

struct Contents {
    texts: Texts,
    paths: protocol::List<Text>,
    png: Option<Vec<u8>>,
}

fn read_system(global: &JSGlobalObject, which: Which) -> Contents {
    let known = written().texts.borrow().clone();
    if bun_ui::loaded().is_none() {
        return Contents {
            texts: known.unwrap_or_default(),
            paths: Default::default(),
            png: None,
        };
    }
    let part = if which == Which::Selection {
        ClipboardPart::Selection
    } else {
        ClipboardPart::Everything
    };
    let found = bun_ui::clipboard::read(global, part)
        .inspect_err(|_| _ = global.clear_exception_except_termination())
        .unwrap_or_default();
    let [text, html] = [&found.text, &found.html].map(|it| it.as_ref().map_or("", |it| &**it));
    let png = found
        .image
        .as_ref()
        .filter(|it| !it.is_empty() && found.files.is_empty())
        .map(|it| it.to_vec());
    let is_still_there = |it: &Texts| {
        find(it, PLAIN_TEXT).unwrap_or("") == text
            && (!text.is_empty() || png.is_some() == written().has_image.get())
    };
    let of_system = || {
        [(PLAIN_TEXT, text), (HTML, html)]
            .into_iter()
            .filter(|it| !it.1.is_empty())
            .map(|(kind, text)| (kind.into(), text.into()))
            .collect()
    };
    Contents {
        texts: known.filter(is_still_there).unwrap_or_else(of_system),
        png,
        paths: found.files,
    }
}

fn write_system<'a>(
    cx: &mut Cx<'a>,
    doc: &'a Doc,
    texts: Texts,
    png: Option<Vec<u8>>,
    which: Which,
) {
    let text = find(&texts, PLAIN_TEXT).or_else(|| png.is_none().then_some(""));
    let [text, html] = [text, find(&texts, HTML).filter(|it| !it.is_empty())]
        .map(|it| it.map(|it| Text::lossy(it.as_bytes())).into());
    if which == Which::General {
        written().has_image.set(png.is_some());
        written().serial.update(|it| it + 1);
        written().texts.replace(Some(texts));
    }
    let contents = protocol::Clipboard {
        text,
        html,
        image: png.map(|it| it[..].into()).into(),
        files: Default::default(),
    };
    if bun_ui::loaded().is_some()
        && bun_ui::clipboard::write(cx.global(), contents, which == Which::Selection).is_err()
    {
        cx.global().clear_exception_except_termination();
    }
    if let Some(ui) = Ui::of(doc).filter(|_| which == Which::General) {
        frames::tree(&cx.heap, ui)
            .iter()
            .for_each(|it| tell_about_change(cx, it));
    }
}

/// With their types.
fn files_in<'a>(
    cx: &Cx<'a>,
    doc: &'a Doc,
    contents: &mut Contents,
) -> impl Iterator<Item = (DomString, JSValue)> {
    let (global, png) = (global_of(doc.heap(&cx.heap)), contents.png.take());
    let files = contents
        .paths
        .iter()
        .filter_map(move |it| bun_web::convert::file_at(global, it.as_bytes()));
    let image = png.into_iter().map(move |it| {
        create_file(
            global,
            it,
            b"image.png",
            PNG.as_bytes(),
            host::time_of_day(),
        )
    });
    files
        .chain(image)
        .map(|it| (host::type_of_file(it).unwrap_or_default(), it))
}

pub(super) fn read_into<'a>(cx: &mut Cx<'a>, doc: &'a Doc, data: &'a DataTransfer, which: Which) {
    let mut contents = read_system(cx.global(), which);
    contents
        .texts
        .iter()
        .for_each(|(kind, text)| data.put(&cx.heap, kind, DomString::from_utf8(text)));
    files_in(cx, doc, &mut contents)
        .for_each(|(kind, file)| _ = data.add(&cx.heap, kind, DomString::default(), Some(file)));
}

pub(crate) fn write_from<'a>(cx: &mut Cx<'a>, doc: &'a Doc, data: &'a DataTransfer, which: Which) {
    let texts = data
        .items()
        .iter()
        .filter(|it| it.file().is_none())
        .map(|it| {
            (
                it.format.to_utf8().into_owned(),
                it.text.to_utf8().into_owned(),
            )
        });
    write_system(cx, doc, texts.collect(), None, which);
}

pub(crate) fn can_paste(heap: &JsHeap<'_>) -> bool {
    let Contents { texts, paths, png } = read_system(global_of(heap), Which::General);
    !texts.is_empty() || !paths.is_empty() || png.is_some()
}

// ───────────────────────────── ClipboardItem ─────────────────────────────

fn is_custom(kind: &str) -> bool {
    let is_token = |it: &[u8]| {
        !it.is_empty()
            && !it
                .iter()
                .any(|it| it.is_ascii_whitespace() || matches!(it, b'/' | b';'))
    };
    let parts = kind
        .strip_prefix("web ")
        .and_then(|it| bun_core::strings::split_once_char(it.as_bytes(), b'/'));
    parts.is_some_and(|(kind, subtype)| is_token(kind) && is_token(subtype))
}

fn is_supported(kind: &str) -> bool {
    matches!(kind, PLAIN_TEXT | HTML | PNG | SVG) || is_custom(kind)
}

pub(crate) struct ClipboardItem {
    types: Vec<DomString>,
    style: PresentationStyle,
    /// `Written::serial` when it was read from the clipboard.
    read_at: Option<u32>,
    _interior: bindgen::Interior,
}

/// What `value`, a promise, gives.
async fn blob_for(
    realm: exec::Realm,
    value: exec::Settled,
    kind: String,
) -> Result<Strong, Strong> {
    let value = value.await?;
    realm.enter(|cx| {
        if value.get().as_class_ref::<Blob>().is_some() {
            return Ok(value);
        }
        match DomString::from_js(cx, JsLocal::new(&cx.heap, value.get())) {
            Ok(text) => Ok(Strong::create(
                create_blob(
                    cx.global(),
                    text.to_utf8().into_owned().into(),
                    kind.as_bytes(),
                ),
                cx.global(),
            )),
            Err(error) => Err(Strong::create(exec::caught(cx, error).to_js(), cx.global())),
        }
    })
}

impl ClipboardItem {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        items: JsRecord<'a, JsStringImpl<'a>, JsLocal<'a>>,
        options: &ClipboardItemOptions,
    ) -> bindgen::Result<'a, &'a Self> {
        let (types, values): (Vec<_>, Vec<_>) = items
            .iter()
            .map(|(kind, value)| (DomString::from(kind), value.to_js()))
            .unzip();
        if types.is_empty() {
            return Err(heap.type_error(format_args!("Empty dictionary argument")));
        }
        let this = structure.create(
            heap,
            ClipboardItem {
                types,
                style: options.presentation_style,
                read_at: None,
                _interior: Default::default(),
            },
        );
        js_ClipboardItem::set_values(
            this,
            List::from_fn(heap, values.len() as u32, |it| values[it as usize]).to_js(),
        );
        Ok(this)
    }

    pub(crate) fn supports(kind: &DomString) -> bool {
        is_supported(&kind.to_utf8())
    }

    pub(crate) fn get_types(&self) -> impl Iterator<Item = &DomString> {
        self.types.iter()
    }

    pub(crate) fn get_presentation_style(&self) -> PresentationStyle {
        self.style
    }

    fn blob<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        index: usize,
    ) -> impl Future<Output = Result<Strong, Strong>> + use<> {
        let value = js_ClipboardItem::values(self).map_or(JSValue::UNDEFINED, |it| {
            List::from_value(it).get(index as u32)
        });
        let value = JsLocal::new(&cx.heap, value);
        blob_for(
            exec::Realm::of(cx),
            settled(cx, value),
            self.types[index].to_utf8().into_owned(),
        )
    }

    pub(crate) fn get_type<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        kind: &DomString,
    ) -> bindgen::Result<'a, JSValue> {
        let Some(index) = self.types.iter().position(|it| *it == *kind) else {
            return Err(dom_error(
                &cx.heap,
                DomError::NotFoundError,
                "The type was not found.",
            ));
        };
        if self.read_at.is_some_and(|it| it != written().serial.get()) {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The clipboard has changed.",
            ));
        }
        let blob = self.blob(cx, index);
        Ok(promise_for(cx, blob, |cx, blob| {
            blob.map(|it| it.get())
                .map_err(|it| bindgen::Error::from_value(JsLocal::new(&cx.heap, it.get())))
        }))
    }
}

// ───────────────────────────── Clipboard ─────────────────────────────

#[repr(C)]
#[derive(Default)]
pub(crate) struct Clipboard {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_Clipboard::Fields,
    has_missed_change: Cell<bool>,
}

slots!(
    Clipboard = js_Clipboard {
        window: WindowTarget,
    }
);

#[derive(Clone, Copy)]
enum Access {
    Read,
    Write,
}

enum Failure {
    Refused(DomError, &'static str),
    Thrown(Strong),
}

const DENIED: Failure = Failure::Refused(DomError::NotAllowedError, "Permission denied.");

async fn contents_of(
    items: Vec<(String, impl Future<Output = Result<Strong, Strong>>)>,
) -> Result<(Texts, Option<Vec<u8>>), Failure> {
    let (mut texts, mut png) = (Texts::new(), None);
    for (kind, blob) in items {
        let blob = blob_of(blob.await.map_err(Failure::Thrown)?.get()).ok_or(Failure::Refused(
            DomError::DataError,
            "Failed to read the blob.",
        ))?;
        let essence =
            bun_core::strings::split_once_char(&blob.mime, b';').map_or(&blob.mime[..], |it| it.0);
        if !is_supported(&kind)
            || essence != kind.as_bytes()
                && kind.strip_prefix("web ").map(str::as_bytes) != Some(&blob.mime[..])
        {
            return Err(Failure::Refused(
                DomError::NotAllowedError,
                "The type is not supported, or does not match the type of the blob.",
            ));
        }
        let bytes = read(blob.data)
            .await
            .map_err(|_| Failure::Refused(DomError::DataError, "Failed to read the blob."))?;
        if kind != PNG {
            texts.push((kind, Text::lossy(&bytes).to_string()));
        } else if bytes.starts_with(b"\x89PNG") {
            png = Some(bytes.to_vec());
        } else {
            return Err(Failure::Refused(
                DomError::DataError,
                "Failed to decode the image.",
            ));
        }
    }
    Ok((texts, png))
}

impl Clipboard {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, window: &'a WindowTarget) -> &'a Clipboard {
        let this = js_Clipboard::create(heap, Clipboard::default());
        this.set_window(Some(window));
        window
            .doc()
            .and_then(Ui::of)
            .into_iter()
            .for_each(|it| it.set_clipboard(Some(this)));
        this
    }

    fn ui(&self) -> Option<&Ui> {
        Ui::of(self.window()?.doc()?)
    }

    /// `then` runs with the result of `prepare`, once it is allowed.
    fn with_access<'a, T: 'static>(
        &'a self,
        cx: &mut Cx<'a>,
        access: Access,
        prepare: impl Future<Output = Result<T, Failure>> + 'static,
        then: impl for<'b> FnOnce(&mut Cx<'b>, &'b Doc, T) -> bindgen::Result<'b, JSValue> + 'static,
    ) -> bindgen::Result<'a, JSValue> {
        let (Some(ui), Some(window)) = (self.ui(), self.window()) else {
            return Ok(JSValue::UNDEFINED);
        };
        let (feature, permission) = match access {
            Access::Read => ("clipboard-read", "clipboard-read"),
            Access::Write => ("clipboard-write", "clipboard-sanitized-write"),
        };
        if !host::allows_feature(ui, feature) {
            return Err(dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "The permissions policy does not allow it.",
            ));
        }
        let ((sender, answer), doc) = (oneshot(), Strong::create(ui.doc().to_js(), cx.global()));
        window
            .host()
            .permission(permission.into(), |_, it| sender.send(it));
        let steps = async {
            if answer.await.is_none_or(|it| it != "granted") {
                Err(DENIED)
            } else {
                prepare.await
            }
        };
        Ok(promise_for(cx, steps, move |cx, result| match result {
            Ok(it) => {
                Doc::from_value(doc.get()).map_or(Ok(JSValue::UNDEFINED), |doc| then(cx, doc, it))
            }
            Err(Failure::Refused(error, message)) => Err(dom_error(&cx.heap, error, message)),
            Err(Failure::Thrown(reason)) => Err(bindgen::Error::from_value(JsLocal::new(
                &cx.heap,
                reason.get(),
            ))),
        }))
    }

    pub(crate) fn read_text<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, JSValue> {
        self.with_access(cx, Access::Read, async { Ok(()) }, |cx, _, ()| {
            let contents = read_system(cx.global(), Which::General);
            Ok(
                DomString::from_utf8(find(&contents.texts, PLAIN_TEXT).unwrap_or(""))
                    .to_js(&cx.heap)
                    .to_js(),
            )
        })
    }

    pub(crate) fn write_text<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        data: &DomString,
    ) -> bindgen::Result<'a, JSValue> {
        let texts = vec![(PLAIN_TEXT.into(), data.to_utf8().into_owned())];
        self.with_access(cx, Access::Write, async { Ok(texts) }, |cx, doc, texts| {
            write_system(cx, doc, texts, None, Which::General);
            Ok(JSValue::UNDEFINED)
        })
    }

    pub(crate) fn read<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        formats: &ClipboardUnsanitizedFormats,
    ) -> bindgen::Result<'a, JSValue> {
        let keeps_scripts = match formats.unsanitized.as_deref() {
            None | Some([]) => false,
            Some([only]) if only.as_ref() == HTML.as_bytes() => true,
            Some(_) => {
                return Err(dom_error(
                    &cx.heap,
                    DomError::NotAllowedError,
                    "Only text/html can be read unsanitized.",
                ));
            }
        };
        self.with_access(cx, Access::Read, async { Ok(()) }, move |cx, doc, ()| {
            let mut contents = read_system(cx.global(), Which::General);
            let (mut types, values) = (Vec::new(), List::new(&cx.heap));
            for (kind, text) in &contents.texts {
                let text = DomString::from_utf8(text);
                let text = if kind == SVG || kind == HTML && !keeps_scripts {
                    markup::without_scripts(cx, doc, &text)?
                } else {
                    text
                };
                types.push(DomString::from_utf8(kind));
                values.push(&cx.heap, text.to_js(&cx.heap).to_js());
            }
            for (kind, file) in files_in(cx, doc, &mut contents) {
                types.push(kind);
                values.push(&cx.heap, file);
            }
            let item = (!types.is_empty()).then(|| {
                let item = js_ClipboardItem::create(
                    &cx.heap,
                    ClipboardItem {
                        types,
                        style: PresentationStyle::Unspecified,
                        read_at: Some(written().serial.get()),
                        _interior: Default::default(),
                    },
                );
                js_ClipboardItem::set_values(item, values.to_js());
                item.to_js()
            });
            Ok(cx
                .heap
                .create_array(item, |heap, it| Ok(JsLocal::new(heap, it)))?
                .to_js())
        })
    }

    pub(crate) fn write<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        data: JsList<'a, &'a ClipboardItem>,
    ) -> bindgen::Result<'a, JSValue> {
        if data.len() > 1 {
            return Err(dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "Support for multiple ClipboardItems is not implemented.",
            ));
        }
        let mut items = Vec::new();
        for item in data.iter() {
            items.extend(
                item.types
                    .iter()
                    .enumerate()
                    .map(|(index, kind)| (kind.to_utf8().into_owned(), item.blob(cx, index))),
            );
        }
        if items.iter().filter(|it| is_custom(&it.0)).count() > MAX_CUSTOM_FORMATS {
            return Err(dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "Too many custom formats.",
            ));
        }
        self.with_access(
            cx,
            Access::Write,
            contents_of(items),
            |cx, doc, (texts, png)| {
                write_system(cx, doc, texts, png, Which::General);
                Ok(JSValue::UNDEFINED)
            },
        )
    }
}

// ───────────────────────────── clipboardchange ─────────────────────────────

fn tell_about_change<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let Some(clipboard) = ui
        .clipboard()
        .filter(|it| it.has_listeners(atom!("clipboardchange")))
    else {
        return;
    };
    let has_focus = ui.is_focused.get() && ui.focused_frame().is_none();
    clipboard.has_missed_change.set(!has_focus);
    if has_focus {
        host::queue_task(cx, ui.doc(), [clipboard.to_js()], |cx, [clipboard]| {
            let Some(clipboard) = Clipboard::from_value(clipboard) else {
                return;
            };
            let contents = read_system(cx.global(), Which::General);
            let kinds = contents
                .texts
                .iter()
                .map(|it| &*it.0)
                .filter(|it| !is_custom(it))
                .chain(contents.png.as_ref().map(|_| PNG));
            let base = Event::base(atom!("clipboardchange"), EventInit::default(), Trusted::Yes);
            let event = js_ClipboardChangeEvent::create(
                clipboard.realm(&cx.heap),
                ClipboardChangeEvent {
                    base,
                    fields: Default::default(),
                    types: kinds.map(DomString::from_utf8).collect(),
                },
            );
            let Ok(id) =
                JSValue::from_uint64_no_truncate(cx.global(), written().serial.get().into())
            else {
                return;
            };
            js_ClipboardChangeEvent::set_change_id(event, id);
            dispatch(cx, clipboard, event);
        });
    }
}

pub(crate) fn window_got_focus<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if ui.clipboard().is_some_and(|it| it.has_missed_change.get()) {
        tell_about_change(cx, ui);
    }
}

#[repr(C)]
pub(crate) struct ClipboardChangeEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_ClipboardChangeEvent::Fields,
    types: Vec<DomString>,
}

impl ClipboardChangeEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &ClipboardChangeEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let id = if init.change_id.is_undefined() {
            JSValue::from_uint64_no_truncate(global_of(heap), 0)?
        } else {
            init.change_id.to_js()
        };
        if !id.is_big_int() {
            return Err(
                heap.type_error(format_args!("The provided value is not of type 'bigint'."))
            );
        }
        let base = Event::base(
            name,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        let this = structure.create(
            heap,
            ClipboardChangeEvent {
                base,
                fields: Default::default(),
                types: init.types.iter().map(DomString::from).collect(),
            },
        );
        js_ClipboardChangeEvent::set_change_id(this, id);
        Ok(this)
    }

    pub(crate) fn get_types(&self) -> impl Iterator<Item = &DomString> {
        self.types.iter()
    }
}
