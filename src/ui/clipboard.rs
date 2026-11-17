//! `clipboard`

use core::cell::RefCell;

use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, JsClass as _, JsResult};

use crate::generated_bindgen::clipboard::ClipboardData;
use crate::image::NativeImage;
use crate::protocol::{Clipboard, ClipboardPart, Command, List, Maybe, SystemCommand, Text};

// Without a display, there is only this one.
crate::state!(fn own() -> RefCell<Clipboard>);

pub fn read(global: &JSGlobalObject, part: ClipboardPart) -> JsResult<Clipboard> {
    if !crate::is_headless(global)? {
        return (crate::start(global)?.read_clipboard)(part).or_throw(global);
    }
    Ok(match part {
        ClipboardPart::Selection => Clipboard::default(),
        _ => own().borrow().clone(),
    })
}

pub fn write(global: &JSGlobalObject, contents: Clipboard, is_selection: bool) -> JsResult<()> {
    if !crate::is_headless(global)? {
        let command = SystemCommand::WriteClipboard {
            contents,
            is_selection,
        };
        return crate::perform(global, Command::System(command));
    }
    if !is_selection {
        own().replace(contents);
    }
    Ok(())
}

type Kind<'a> = Option<&'a [u8]>;

fn is_selection(kind: Kind<'_>) -> bool {
    kind == Some(b"selection")
}

fn part(kind: Kind<'_>, otherwise: ClipboardPart) -> ClipboardPart {
    if is_selection(kind) {
        ClipboardPart::Selection
    } else {
        otherwise
    }
}

fn read_all(global: &JSGlobalObject, kind: Kind<'_>) -> JsResult<Clipboard> {
    read(global, part(kind, ClipboardPart::Everything))
}

fn png(global: &JSGlobalObject, image: JSValue) -> JsResult<List<u8>> {
    NativeImage::with(global, image, |it| it.png(global).map(List::from))
}

pub fn module(heap: &JsHeap<'_>) -> JSValue {
    crate::generated_bindgen::clipboard::js_UiClipboard::CLASS.constructor(heap)
}

pub fn formats(it: &Clipboard) -> impl Iterator<Item = &'static str> + use<> {
    let has = |text: &Maybe<Text>| text.as_ref().is_some_and(|it| !it.is_empty());
    let formats = [
        (has(&it.text), "text/plain"),
        (has(&it.html), "text/html"),
        (!it.files.is_empty(), "text/uri-list"),
        (it.image.as_ref().is_some(), "image/png"),
    ];
    formats.into_iter().filter(|it| it.0).map(|it| it.1)
}

impl crate::generated_bindgen::clipboard::UiClipboard {
    pub(crate) fn read_text(cx: &mut JsScope<'_>, kind: Kind<'_>) -> JsResult<Text> {
        let contents = read(cx.global(), part(kind, ClipboardPart::Text))?;
        Ok(contents.text.get().unwrap_or_default())
    }

    pub(crate) fn read_image(cx: &mut JsScope<'_>, kind: Kind<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let bytes = read_all(global, kind)?.image.get().unwrap_or_default();
        Ok(NativeImage::from_bytes(bytes.into_vec()).to_js(global))
    }

    pub(crate) fn read_html(cx: &mut JsScope<'_>, kind: Kind<'_>) -> JsResult<Text> {
        Ok(read_all(cx.global(), kind)?.html.get().unwrap_or_default())
    }

    pub(crate) fn read_file_paths(cx: &mut JsScope<'_>, kind: Kind<'_>) -> JsResult<List<Text>> {
        Ok(read_all(cx.global(), kind)?.files)
    }

    pub(crate) fn write_data(
        cx: &mut JsScope<'_>,
        data: &ClipboardData<'_>,
        kind: Kind<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        let image = data.image.map(|it| png(global, it.to_js())).transpose()?;
        let text = data.text.or_else(|| image.is_none().then_some(b""));
        let contents = Clipboard {
            text: text.map(Text::lossy).into(),
            html: data.html.map(Text::lossy).into(),
            image: image.into(),
            files: List::new(),
        };
        write(global, contents, is_selection(kind))
    }

    pub(crate) fn write_text(cx: &mut JsScope<'_>, text: &[u8], kind: Kind<'_>) -> JsResult<()> {
        let contents = Clipboard {
            text: Maybe::Yes(Text::lossy(text)),
            ..Clipboard::default()
        };
        write(cx.global(), contents, is_selection(kind))
    }

    pub(crate) fn write_image(
        cx: &mut JsScope<'_>,
        image: JsLocal<'_>,
        kind: Kind<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        let contents = Clipboard {
            image: Maybe::Yes(png(global, image.to_js())?),
            ..Clipboard::default()
        };
        write(global, contents, is_selection(kind))
    }

    pub(crate) fn available_formats(
        cx: &mut JsScope<'_>,
        kind: Kind<'_>,
    ) -> JsResult<Vec<&'static str>> {
        Ok(formats(&read_all(cx.global(), kind)?).collect())
    }

    pub(crate) fn clear(cx: &mut JsScope<'_>, kind: Kind<'_>) -> JsResult<()> {
        Self::write_text(cx, b"", kind)
    }
}
