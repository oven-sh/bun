//! <https://w3c.github.io/clipboard-apis/#async-clipboard-api>, and the clipboard of the system.

use core::cell::{Cell, RefCell};

use bun_jsc::Strong;
use bun_jsc::bindgen::{JsList, JsRecord, JsStringImpl};
use bun_jsc::webcore_types::Blob;
use bun_ui::protocol::{self, ClipboardPart, Text};
use bun_web::channel::LooseBitmap;
use bun_web::exec::{self, oneshot, settled};
use bun_web::host::{ChosenFile, Clipped};
use bun_web::remote::is_page_process;
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
    /// How often this process has been about to write.
    attempts: Cell<u32>,
    serial: Cell<u32>,
    types: RefCell<Vec<String>>,
}

bun_ui::state!(fn written() -> Written);

fn find<'t>(texts: &'t Texts, wanted: &str) -> Option<&'t str> {
    texts.iter().find(|it| it.0 == wanted).map(|it| &*it.1)
}

fn read_system(doc: &Doc, which: Which) -> Clipped {
    let is_selection = which == Which::Selection;
    if is_page_process() {
        doc.last_window()
            .map(|it| it.host().read_clipboard(is_selection))
            .unwrap_or_default()
    } else {
        read_here(is_selection)
    }
}

#[unsafe(export_name = "__bun_dom_read_clipboard")]
fn read_here(is_selection: bool) -> Clipped {
    let (global, known) = (bun_ui::main_global(), written().texts.borrow().clone());
    if bun_ui::loaded().is_none() {
        return Clipped {
            texts: known.unwrap_or_default(),
            ..Default::default()
        };
    }
    let part = if is_selection {
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
    Clipped {
        texts: known.filter(is_still_there).unwrap_or_else(of_system),
        png,
        files: found
            .files
            .iter()
            .map(|it| ChosenFile(it.to_string()))
            .collect(),
    }
}

fn types_of(texts: &Texts) -> impl Iterator<Item = String> {
    texts
        .iter()
        .filter(|it| !is_custom(&it.0))
        .map(|it| it.0.clone())
}

fn announce<'a>(cx: &mut Cx<'a>, doc: &'a Doc, types: Vec<String>) {
    written().serial.update(|it| it + 1);
    written().types.replace(types);
    if let Some(ui) = Ui::of(doc) {
        frames::tree(&cx.heap, ui)
            .iter()
            .for_each(|it| tell_about_change(cx, it));
    }
}

fn write_system<'a>(cx: &mut Cx<'a>, doc: &'a Doc, texts: Texts, which: Which) {
    let (types, is_selection) = (types_of(&texts).collect(), which == Which::Selection);
    match is_page_process() {
        true => doc
            .last_window()
            .map_or((), |it| it.host().write_clipboard(texts, is_selection)),
        false => write_texts_here(texts, is_selection),
    }
    if !is_selection {
        announce(cx, doc, types);
    }
}

/// A promise.
fn write_image<'a>(cx: &mut Cx<'a>, doc: &'a Doc, texts: Texts, image: LooseBitmap) -> JSValue {
    let (types, (sender, is_written)) = (types_of(&texts).chain([PNG.into()]).collect(), oneshot());
    match is_page_process() {
        true => doc.last_window().map_or((), |it| {
            it.host()
                .write_image_to_clipboard(texts, image, |_, ()| sender.send(()))
        }),
        false => write_image_here(texts, image, Box::new(|| sender.send(()))),
    }
    let doc = Strong::create(doc.to_js(), cx.global());
    promise_for(cx, is_written, move |cx, _| {
        if let Some(doc) = Doc::from_value(doc.get()) {
            announce(cx, doc, types);
        }
        Ok(JSValue::UNDEFINED)
    })
}

#[unsafe(export_name = "__bun_dom_write_clipboard")]
fn write_texts_here(texts: Texts, is_selection: bool) {
    written()
        .attempts
        .update(|it| it + u32::from(!is_selection));
    write_here(texts, None, is_selection);
}

#[unsafe(export_name = "__bun_dom_write_image_to_clipboard")]
fn write_image_here(texts: Texts, image: LooseBitmap, then: Box<dyn FnOnce()>) {
    written().attempts.update(|it| it + 1);
    let attempt = written().attempts.get();
    exec::spawn(async move {
        if let Some(png) = image
            .into_png()
            .await
            .filter(|_| written().attempts.get() == attempt)
        {
            write_here(texts, Some(png), false);
        }
        then();
    });
}

fn write_here(texts: Texts, png: Option<Vec<u8>>, is_selection: bool) {
    let text = find(&texts, PLAIN_TEXT).or_else(|| png.is_none().then_some(""));
    let [text, html] = [text, find(&texts, HTML).filter(|it| !it.is_empty())]
        .map(|it| it.map(|it| Text::lossy(it.as_bytes())).into());
    if !is_selection {
        written().has_image.set(png.is_some());
        written().texts.replace(Some(texts));
    }
    let contents = protocol::Clipboard {
        text,
        html,
        image: png.map(|it| it[..].into()).into(),
        files: Default::default(),
    };
    if bun_ui::loaded().is_some()
        && bun_ui::clipboard::write(bun_ui::main_global(), contents, is_selection).is_err()
    {
        bun_ui::main_global().clear_exception_except_termination();
    }
}

/// With their types.
fn files_in<'a>(
    cx: &Cx<'a>,
    doc: &'a Doc,
    contents: &mut Clipped,
) -> impl Iterator<Item = (DomString, JSValue)> {
    let (global, png) = (global_of(doc.heap(&cx.heap)), contents.png.take());
    let files = contents
        .files
        .iter()
        .filter_map(move |it| bun_web::convert::file_at(global, it.0.as_bytes()));
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
    let mut contents = read_system(doc, which);
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
    write_system(cx, doc, texts.collect(), which);
}

/// The host of a page process corrects it.
#[unsafe(export_name = "__bun_dom_can_paste")]
pub(crate) fn can_paste() -> bool {
    is_page_process() || {
        let Clipped { texts, files, png } = read_here(false);
        !texts.is_empty() || !files.is_empty() || png.is_some()
    }
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
) -> Result<(Texts, Option<LooseBitmap>), Failure> {
    let (mut texts, mut image) = (Texts::new(), None);
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
        } else {
            let decoded = if bytes.starts_with(b"\x89PNG") {
                LooseBitmap::decode(bytes.to_vec()).await
            } else {
                None
            };
            image = Some(decoded.ok_or(Failure::Refused(
                DomError::DataError,
                "Failed to decode the image.",
            ))?);
        }
    }
    Ok((texts, image))
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

    /// Whether it is granted, and the document that asks.
    fn ask_for<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        access: Access,
    ) -> bindgen::Result<'a, Option<(exec::Receiver<bool>, Strong)>> {
        let (Some(ui), Some(window)) = (self.ui(), self.window()) else {
            return Ok(None);
        };
        let (feature, permission) = match access {
            Access::Read => (
                bun_web::permissions_policy::Feature::ClipboardRead,
                "clipboard-read",
            ),
            Access::Write => (
                bun_web::permissions_policy::Feature::ClipboardWrite,
                "clipboard-sanitized-write",
            ),
        };
        if !host::allows_feature(ui, feature) {
            return Err(dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "The permissions policy does not allow it.",
            ));
        }
        if !ui.is_focused.get() {
            return Err(dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "Document is not focused.",
            ));
        }
        let ((sender, answer), doc) = (oneshot(), Strong::create(ui.doc().to_js(), cx.global()));
        window
            .host()
            .permission(permission.into(), |_, it| sender.send(it == "granted"));
        Ok(Some((answer, doc)))
    }

    /// `then` runs with the result of `prepare`, once it is allowed.
    fn with_access<'a, T: 'static>(
        &'a self,
        cx: &mut Cx<'a>,
        access: Access,
        prepare: impl Future<Output = Result<T, Failure>> + 'static,
        then: impl for<'b> FnOnce(&mut Cx<'b>, &'b Doc, T) -> bindgen::Result<'b, JSValue> + 'static,
    ) -> bindgen::Result<'a, JSValue> {
        let Some((is_granted, doc)) = self.ask_for(cx, access)? else {
            return Ok(JSValue::UNDEFINED);
        };
        let steps = async {
            if is_granted.await == Some(true) {
                prepare.await
            } else {
                Err(DENIED)
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
        self.with_access(cx, Access::Read, async { Ok(()) }, |cx, doc, ()| {
            let contents = read_system(doc, Which::General);
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
            write_system(cx, doc, texts, Which::General);
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
            let mut contents = Clipped {
                files: Vec::new(),
                ..read_system(doc, Which::General)
            };
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
            |cx, doc, (texts, image)| {
                Ok(match image {
                    Some(image) => write_image(cx, doc, texts, image),
                    None => {
                        write_system(cx, doc, texts, Which::General);
                        JSValue::UNDEFINED
                    }
                })
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
            let types = match is_page_process() {
                true => written()
                    .types
                    .borrow()
                    .iter()
                    .map(|it| DomString::from_utf8(it))
                    .collect(),
                false => {
                    let contents = read_here(false);
                    contents
                        .texts
                        .iter()
                        .map(|it| &*it.0)
                        .filter(|it| !is_custom(it))
                        .chain(contents.png.as_ref().map(|_| PNG))
                        .map(DomString::from_utf8)
                        .collect()
                }
            };
            let base = Event::base(atom!("clipboardchange"), EventInit::default(), Trusted::Yes);
            let event = js_ClipboardChangeEvent::create(
                clipboard.realm(&cx.heap),
                ClipboardChangeEvent {
                    base,
                    fields: Default::default(),
                    types,
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
