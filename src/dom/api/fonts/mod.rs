//! <https://drafts.csswg.org/css-font-loading/>

mod host;
mod set;

pub(crate) use crate::generated_bindgen::fonts::FontFace;
pub(crate) use set::{
    FontFaceSet, FontFaceSetLoadEvent, document_loaded, fonts_of_worker, load_requested_fonts,
};

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result};
use bun_jsc::{JSPromise, JSValue};

use crate::api::core::{Doc, DomError, List, dom_error, seams};
use crate::font_face::{self, Data, Descriptor, Source};
use crate::generated_bindgen::fonts::*;
use crate::values::{Out, text, write_string};

pub(crate) struct AnyFontFace {
    face: RefCell<Rc<font_face::FontFace>>,
    status: Cell<FontFaceLoadStatus>,
    /// For as long as it may have to be registered again.
    data: RefCell<Option<Data>>,
    /// <https://drafts.csswg.org/css-font-loading/#css-connected>
    is_css_connected: bool,
    order: Cell<u32>,
    /// For each of the sets.
    registered: RefCell<Vec<Option<u32>>>,
}

fn promise<'a>(heap: &JsHeap<'a>, field: Option<JSValue>) -> JsLocal<'a, JSPromise> {
    field
        .and_then(|it| JsLocal::new(heap, it).as_promise())
        .expect("set when it is made")
}

fn parse_descriptor(descriptor: Descriptor, value: &[u8]) -> Option<Out> {
    let quoted = || descriptor.parse(&crate::prelude::written(|out| write_string(value, out)));
    let has_more_spaces = !value.starts_with(b"\"")
        && !value.starts_with(b"'")
        && bun_core::strings::split(value, b" ").any(<[u8]>::is_empty);
    match descriptor {
        Descriptor::Family => descriptor
            .parse(value)
            .filter(|_| !has_more_spaces)
            .or_else(quoted),
        _ => descriptor.parse(value),
    }
}

impl FontFace {
    fn new(face: Rc<font_face::FontFace>, is_css_connected: bool) -> AnyFontFace {
        let (face, status, order) = (
            face.into(),
            FontFaceLoadStatus::Unloaded.into(),
            i32::MAX as u32,
        );
        AnyFontFace {
            face,
            status,
            data: RefCell::default(),
            is_css_connected,
            order: order.into(),
            registered: RefCell::default(),
        }
    }

    fn init<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Self {
        let loaded = heap.create_promise();
        loaded.mark_as_handled();
        js_AnyFontFace::set_loaded(self, loaded.to_js());
        js_AnyFontFace::set_sets(self, List::new(heap).to_js());
        self
    }

    fn of_rule<'a>(heap: &JsHeap<'a>, face: Rc<font_face::FontFace>) -> &'a Self {
        js_FontFace::create(heap, FontFace::new(face, true)).init(heap)
    }

    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        family: &[u8],
        source: FontSource<'a>,
        given: &FontFaceDescriptors<'_>,
    ) -> Result<'a, &'a Self> {
        use Descriptor::*;
        let doc = seams::current_document(cx)?;
        let (mut invalid, mut sources) = (None, Rc::default());
        if let FontSource::Text(src) = source {
            match crate::sheet::descriptor("font-face", b"src", src) {
                Some(src) => {
                    sources = Source::parse_list(&src, doc.base_url().to_utf8().as_bytes())
                }
                None => invalid = Some(src),
            }
        }
        let mut face = font_face::FontFace::of_script(sources);
        let all = [
            (Family, Some(family)),
            (Style, given.style),
            (Weight, given.weight),
            (Stretch, given.stretch),
            (UnicodeRange, given.unicode_range),
            (Variant, given.variant),
            (FeatureSettings, given.feature_settings),
            (VariationSettings, given.variation_settings),
            (Display, given.display),
            (AscentOverride, given.ascent_override),
            (DescentOverride, given.descent_override),
            (LineGapOverride, given.line_gap_override),
            (SizeAdjust, given.size_adjust),
        ];
        for (descriptor, value) in all.into_iter().filter_map(|it| Some((it.0, it.1?))) {
            let parsed = parse_descriptor(descriptor, value);
            invalid = parsed.as_ref().map_or(Some(value), |_| invalid);
            face.set(descriptor, &parsed.unwrap_or_default());
        }
        let made = structure
            .create(&cx.heap, FontFace::new(face.into(), false))
            .init(&cx.heap);
        match (invalid, source) {
            (Some(value), _) => made.fail(
                cx,
                DomError::SyntaxError,
                &format!("Failed to set '{}' as a property value.", text(value)),
            ),
            (None, FontSource::Binary(bytes)) => {
                made.status.set(FontFaceLoadStatus::Loading);
                let bytes = bytes.with_bytes(&cx.heap, |it| it.into());
                host::decode(
                    cx,
                    [made.to_js(), doc.to_js()],
                    bytes,
                    |cx, this, _, bytes| {
                        let is_font = this.accept(cx, Data::Bytes(bytes));
                        this.finish(
                            cx,
                            is_font.ok_or((
                                DomError::SyntaxError,
                                "Invalid font data in ArrayBuffer.",
                            )),
                        );
                    },
                );
            }
            _ => {}
        }
        Ok(made)
    }

    fn sets(&self) -> List<'_> {
        List::from_value(js_AnyFontFace::sets(self).expect("set when it is made"))
    }

    fn each_set(&self) -> impl Iterator<Item = &FontFaceSet> {
        // SAFETY: the list has sets.
        self.sets()
            .values()
            .map(|it| unsafe { FontFaceSet::from_js_unchecked(it) })
    }

    /// Tells the renderer which of the pages have it. Fails if it is not a font.
    fn publish<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
    ) -> core::result::Result<(), bun_ui::protocol::Text> {
        const NOWHERE: u32 = u32::MAX;
        let (Some(data), face) = (self.data.borrow().clone(), Rc::clone(&self.face.borrow()))
        else {
            return Ok(());
        };
        if self.sets().is_empty() {
            return face.register(&data, NOWHERE, 0).map(font_face::unregister);
        }
        self.each_set()
            .enumerate()
            .filter(|it| it.1.is_in_use())
            .try_for_each(|(index, set)| {
                let id = face.register(&data, set.scope(), self.order.get())?;
                self.registered.borrow_mut()[index]
                    .replace(id)
                    .into_iter()
                    .for_each(font_face::unregister);
                set.fonts_changed(cx);
                Ok(())
            })
    }

    /// An installed font may be gone by now. The pages that have the face keep it as it was.
    fn publish_again<'a>(&'a self, cx: &mut JsScope<'a>) {
        if self.publish(cx).is_err() {
            self.data.take();
        }
    }

    fn accept<'a>(&'a self, cx: &mut JsScope<'a>, data: Data) -> bool {
        self.data.replace(Some(data));
        let is_font = self.publish(cx).is_ok();
        if !is_font || self.is_css_connected {
            self.data.take();
        }
        is_font
    }

    fn fail<'a>(&'a self, cx: &mut JsScope<'a>, code: DomError, message: &str) {
        self.status.set(FontFaceLoadStatus::Error);
        let reason = self
            .realm(&cx.heap)
            .create_dom_exception(code, format_args!("{message}"))
            .to_js();
        _ = promise(&cx.heap, js_AnyFontFace::loaded(self)).reject(cx, reason);
    }

    /// <https://drafts.csswg.org/css-font-loading/#font-face-load>
    fn start_loading<'a>(&'a self, cx: &mut JsScope<'a>, doc: &'a Doc) {
        if self.status.get() == FontFaceLoadStatus::Unloaded {
            self.status.set(FontFaceLoadStatus::Loading);
            self.each_set().for_each(|it| it.started(cx, self));
            self.try_sources(cx, doc, 0);
        }
    }

    fn try_sources<'a>(&'a self, cx: &mut JsScope<'a>, doc: &'a Doc, first: usize) {
        let sources = Rc::clone(&self.face.borrow().sources);
        for (index, source) in sources.iter().enumerate().skip(first) {
            match source {
                Source::Url(url) => {
                    return host::fetch(
                        cx,
                        self,
                        doc,
                        url,
                        move |cx, this, doc, bytes| match bytes
                            .is_some_and(|it| this.accept(cx, Data::Bytes(it)))
                        {
                            true => this.finish(cx, Ok(())),
                            false => this.try_sources(cx, doc, index + 1),
                        },
                    );
                }
                Source::Local(name) if self.accept(cx, Data::Local(Rc::clone(name))) => {
                    return self.finish(cx, Ok(()));
                }
                Source::Local(_) => {}
            }
        }
        self.finish(
            cx,
            Err((DomError::NetworkError, "A network error occurred.")),
        );
    }

    fn finish<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        result: core::result::Result<(), (DomError, &str)>,
    ) {
        match result {
            Ok(()) => {
                self.status.set(FontFaceLoadStatus::Loaded);
                _ = promise(&cx.heap, js_AnyFontFace::loaded(self)).resolve(cx, self.to_js());
            }
            Err((code, message)) => self.fail(cx, code, message),
        }
        self.each_set().for_each(|it| it.finished(cx, self));
    }

    pub(crate) fn get_status(&self) -> FontFaceLoadStatus {
        self.status.get()
    }

    pub(crate) fn load<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        let doc = seams::current_document(cx)?;
        self.start_loading(cx, doc);
        Ok(promise(&cx.heap, js_AnyFontFace::loaded(self)).to_js())
    }
}

impl FontDescriptor {
    pub(crate) fn get<'a>(&self, _: &mut JsScope<'a>, descriptor: Descriptor) -> Result<'a, Out> {
        Ok(self.face.borrow().get(descriptor).into())
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        descriptor: Descriptor,
        value: &[u8],
    ) -> Result<'a, ()> {
        let refuse = || {
            dom_error(
                &cx.heap,
                DomError::SyntaxError,
                &format!("Failed to set '{}' as a property value.", text(value)),
            )
        };
        let parsed = parse_descriptor(descriptor, value).ok_or_else(refuse)?;
        Rc::make_mut(&mut self.face.borrow_mut()).set(descriptor, &parsed);
        FontFace::from_js(&cx.heap, self.to_js())
            .into_iter()
            .for_each(|it| it.publish_again(cx));
        Ok(())
    }
}
