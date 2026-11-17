//! The document of an `<iframe>`, `<frame>`, `<object>` or `<embed>`, if it is in this process.

use std::rc::Rc;

use bun_ui::protocol::{SurfaceCommand, WebViewCommand};
use bun_ui::surfaces;

use super::load::Initiator;
use super::page::Page;
use super::{
    Contents, Kind, Methods, Start, bind, fields, nothing, object_in, text_at, text_if_any,
};
use crate::contents::inspection::News;
use crate::prelude::*;

pub(super) struct Embedded {
    pub(super) kind: String,
    /// Where it is in the tree.
    pub(super) place: Rc<str>,
    image: u32,
    placement: Cell<Option<([f64; 3], bool)>>,
}

impl Embedded {
    pub(super) fn new(parent: &Page, element: JSValue) -> JsResult<Embedded> {
        let above = parent.contents();
        let sequence = above.item().map_or(0, |it| it.borrow().sequence);
        let (place, index) = (
            above.embedded.as_ref().map_or("", |it| &it.place),
            parent.frames_created.get(),
        );
        parent.frames_created.set(index + 1);
        Ok(Embedded {
            kind: text_of(invoke(element, "kind", &[])?)?,
            place: format!("{place}/{sequence}:{index}").into(),
            image: answer((ui()?.open_web_view)(None.into()))?,
            placement: None.into(),
        })
    }
}

const FOR_ELEMENT: Methods<Contents> = &[
    ("beforeUnload", |it, _| js(it.page().may_be_unloaded()?)),
    ("dispose", |it, _| nothing(it.remove())),
    ("document", |it, _| match it.has_origin_of_embedder() {
        true => it.started_page()?.ask("currentDocument", &[]),
        false => Ok(JSValue::NULL),
    }),
    ("edit", |it, given| it.page().ask("edit", given)),
    ("environmentChanged", |it, _| {
        nothing(it.environment_changed())
    }),
    ("focusedFrame", |it, _| {
        Ok(object_in(Some(it.page().ask("focusedFrame", &[])?))
            .unwrap_or_else(|| it.page().handle()))
    }),
    ("input", |it, given| nothing(it.input(argument(given, 0)))),
    ("isInitial", |it, _| js(it.page().is_initial())),
    ("name", |it, _| js(&**it.context.name.borrow())),
    ("navigate", |it, given| {
        nothing(it.navigate_for_element(
            &text_at(given, 0)?,
            argument(given, 1),
            argument(given, 2),
        ))
    }),
    ("place", |it, given| {
        let size = [0, 1, 2].map(|at| argument(given, at).get_number().unwrap_or_default());
        nothing(it.place(size, argument(given, 3).to_boolean()))
    }),
    ("setInitialUrl", |it, given| {
        nothing(it.page().set_initial_url(&text_at(given, 0)?))
    }),
    ("stop", |it, _| nothing(it.stop_everything())),
    ("window", |it, _| {
        it.embedder()
            .agent()
            .map_or(Ok(JSValue::NULL), |agent| it.window_for(&agent))
    }),
];

/// What the element gets.
pub(super) fn create(parent: &Page, element: JSValue) -> JsResult<JSValue> {
    let frame = Contents::start(
        parent.contents().preferences(),
        Kind::Frame,
        &Start::Framed(parent, element),
    )?;
    let receive = listener(frame, |it, given| it.input(argument(given, 0)))?;
    surfaces::listen_with_script(global(), surfaces::tree_of_image(frame.image()), receive);
    invoke(parent.frames()?, "add", &[frame.to_js()])?;
    parent.contents().notify(News::FramesChanged)?;
    frame.later(Contents::announce_creation);
    bind(
        object!({ "context": frame.to_js(), "image": frame.image() }),
        frame,
        FOR_ELEMENT,
    )
}

impl Contents {
    pub(super) fn embed(&self, parent: &Page, element: JSValue) -> JsResult<()> {
        fields::set_owner(self, Some(parent.owner()));
        fields::set_parent(self, Some(parent.contents()));
        fields::set_embedder(self, Some(parent));
        fields::set_element(self, element);
        self.context
            .name
            .replace(text_of(invoke(element, "name", &[])?)?);
        Ok(())
    }

    fn image(&self) -> u32 {
        self.embedded.as_ref().map_or(0, |it| it.image)
    }

    pub(super) fn embedder(&self) -> &'static Page {
        fields::embedder(self.itself()).expect("a frame has one")
    }

    fn has_origin_of_embedder(&self) -> bool {
        self.page().origin_key() == self.embedder().origin_key()
    }

    pub(crate) fn ask_element(&self, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        object_in(fields::element(self))
            .map_or(Ok(JSValue::UNDEFINED), |it| invoke(it, method, arguments))
    }

    pub(super) fn tell_element(&self, method: &str, arguments: &[JSValue]) -> JsResult<()> {
        self.ask_element(method, arguments).map(drop)
    }

    pub(super) fn attribute(&self, name: &str) -> JsResult<Option<String>> {
        if self.is_frame() {
            text_if_any(self.ask_element("attribute", &[js(name)?])?)
        } else {
            Ok(None)
        }
    }

    fn announce_creation(&self) -> JsResult<()> {
        if self.is_destroyed.get() {
            return Ok(());
        }
        self.announce_frame()?;
        let source = self.attribute("src")?.unwrap_or_default();
        if (source.is_empty() || source.starts_with("about:blank"))
            && self
                .embedded
                .as_ref()
                .is_some_and(|it| it.kind.ends_with("frame"))
            && self.attribute("srcdoc")?.is_none()
        {
            self.announce_empty_document()?;
        }
        Ok(())
    }

    /// What the document gets.
    fn navigate_for_element(
        &self,
        url: &str,
        srcdoc: JSValue,
        referrer_policy: JSValue,
    ) -> JsResult<()> {
        let (page, parent) = (self.page(), self.embedder());
        let is_initial = page.is_initial();
        if url.starts_with("javascript:") {
            if !self.has_origin_of_embedder() {
                return if is_initial {
                    self.tell_element("finished", &[JSValue::TRUE])
                } else {
                    Ok(())
                };
            }
            self.tell_element("loading", &[])?;
            let finish = listener(self, move |it, _| {
                it.tell_element("finished", &[is_initial.into()])
            })?;
            return self.started_page()?.navigate_for(
                parent,
                url,
                object!({ "noDocument": finish }),
            );
        }
        let replaces = is_initial || !page.is_loaded.get();
        let options =
            object!({ "replace": replaces, "srcdoc": srcdoc, "referrerPolicy": referrer_policy });
        match is_initial {
            true => self.wish(page, url, options, Initiator::of(parent)),
            false => self.navigate(parent, url, options).map(drop),
        }
    }

    fn place(&self, size: [f64; 3], is_visible: bool) -> JsResult<()> {
        let now = Some((size, is_visible));
        if self
            .embedded
            .as_ref()
            .is_none_or(|it| it.placement.replace(now) == now)
        {
            return Ok(());
        }
        let [width, height, scale] = size;
        let bounds = Rect {
            x: 0.,
            y: 0.,
            width: finite(width),
            height: finite(height),
        };
        self.tell_surface(SurfaceCommand::Bounds(Some(bounds).into()))?;
        self.handle(object!({ "s": self.surface, "t": "resize", "width": width, "height": height, "scale": scale, "isQuiet": true }))
    }

    /// `area` is what a frame in it has changed, outside of a rendering of the page.
    pub(super) fn painted(&self, scale: JSValue, area: JSValue) -> JsResult<()> {
        if self
            .embedded
            .as_ref()
            .and_then(|it| it.placement.get())
            .is_none_or(|it| !it.1)
        {
            return Ok(());
        }
        let command = WebViewCommand::Mirror {
            surface: self.surface,
            scale: finite(scale.get_number().unwrap_or(1.)),
            area: super::api::rectangle(area)?.into(),
        };
        tell(Command::WebView {
            id: self.image(),
            command,
        })?;
        self.parent()
            .filter(|it| area.is_object() && it.is_frame())
            .map_or(Ok(()), |it| it.painted(scale, object!({})))
    }

    fn remove(&self) -> JsResult<()> {
        if self.is_destroyed.get() {
            return Ok(());
        }
        invoke(self.embedder().frames()?, "delete", &[self.to_js()])?;
        self.destroy_now()?;
        self.embedder().contents().notify(News::FramesChanged)?;
        surfaces::ignore(surfaces::tree_of_image(self.image()));
        tell(Command::WebView {
            id: self.image(),
            command: WebViewCommand::Close,
        })
    }
}
