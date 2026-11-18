//! The document of an `<iframe>`, `<frame>`, `<object>` or `<embed>`, if it is in this process.

use std::rc::Rc;

use bun_ui::protocol::{SurfaceCommand, WebViewCommand};
use bun_ui::surfaces;
use bun_web::host::{Owner, ToFrame, Wish};
use bun_web::page::News as ForElement;

use super::load::Initiator;
use super::page::Page;
use super::{Contents, Kind, Start, fields};
use crate::contents::inspection::News;
use crate::prelude::*;

pub(super) struct Embedded {
    /// What the page that has the element calls it.
    pub(super) number: u32,
    pub(super) kind: String,
    element: RefCell<Owner>,
    /// Where it is in the tree.
    pub(super) place: Rc<str>,
    pub(super) image: u32,
    placement: Cell<Option<([f64; 3], bool)>>,
}

impl Embedded {
    pub(super) fn new(parent: &Page, number: u32, element: &Owner) -> JsResult<Embedded> {
        let above = parent.contents();
        let sequence = above.item().map_or(0, |it| it.borrow().sequence);
        let (place, index) = (
            above.embedded.as_ref().map_or("", |it| &it.place),
            parent.frames_created.get(),
        );
        parent.frames_created.set(index + 1);
        Ok(Embedded {
            number,
            kind: element.kind.clone(),
            element: element.clone().into(),
            place: format!("{place}/{sequence}:{index}").into(),
            image: answer((ui()?.open_web_view)(None.into()))?,
            placement: None.into(),
        })
    }
}

pub(super) fn create(parent: &Page, number: u32, element: &Owner) -> JsResult<()> {
    if parent.numbered()?.get(global(), js(number)?)?.is_object() {
        return Ok(());
    }
    let frame = Contents::start(
        parent.contents().preferences(),
        Kind::Frame,
        &Start::Framed(parent, number, element),
    )?;
    frame.listen_to(surfaces::tree_of_image(frame.image()));
    (parent.numbered()?).set(global(), js(number)?, frame.to_js())?;
    invoke(parent.frames()?, "add", &[frame.to_js()])?;
    parent.contents().notify(News::FramesChanged)?;
    frame.later(Contents::announce_creation);
    Ok(())
}

pub(super) fn obey(parent: &Page, number: u32, message: ToFrame) -> JsResult<()> {
    let Some(it) = parent.with_number::<Contents>(number)? else {
        return Ok(());
    };
    match message {
        ToFrame::OwnerChanged(element) => {
            if let Some(it) = &it.embedded {
                let kind = it.kind.clone();
                it.element.replace(Owner { kind, ..*element });
            }
            Ok(())
        }
        ToFrame::SetInitialUrl(url) => it.page().set_initial_url(&url),
        ToFrame::Navigate {
            url,
            srcdoc,
            referrer_policy,
            blob,
        } => it.navigate_for_element(Wish {
            url,
            srcdoc,
            blob,
            referrer_policy: Some(referrer_policy),
            ..Default::default()
        }),
        ToFrame::Place {
            size: [width, height],
            scale,
            is_visible,
        } => it.place([width, height, scale], is_visible),
        ToFrame::Stop => it.stop_loading(),
        ToFrame::Remove => {
            parent.numbered()?.remove(global(), js(number)?)?;
            it.remove()
        }
    }
}

impl Contents {
    pub(super) fn embed(&self, parent: &Page) {
        fields::set_owner(self, Some(parent.owner()));
        fields::set_parent(self, Some(parent.contents()));
        fields::set_embedder(self, Some(parent));
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

    pub(super) fn tell_element(&self, news: ForElement) -> JsResult<()> {
        (self.embedded.as_ref()).map_or(Ok(()), |it| {
            (self.embedder()).tell(|page| page.tell_frame(it.number, news))
        })
    }

    pub(super) fn element(&self) -> Owner {
        let element = self.embedded.as_ref();
        element.map_or_else(Owner::default, |it| it.element.borrow().clone())
    }

    pub(super) fn is_indexed(&self) -> bool {
        (self.embedded.as_ref()).is_some_and(|it| it.element.borrow().is_indexed)
    }

    /// The page that has the element, and the number.
    pub(crate) fn place_of_element(&self) -> Option<[u32; 2]> {
        (self.embedded.as_ref()).map(|it| [self.embedder().id, it.number])
    }

    fn announce_creation(&self) -> JsResult<()> {
        if self.is_destroyed.get() {
            return Ok(());
        }
        self.announce_frame()?;
        let element = self.element();
        let source = element.src.unwrap_or_default();
        if (source.is_empty() || source.starts_with("about:blank"))
            && element.kind.ends_with("frame")
            && !element.has_srcdoc
        {
            self.announce_empty_document()?;
        }
        Ok(())
    }

    fn navigate_for_element(&self, wish: Wish) -> JsResult<()> {
        let (page, parent) = (self.page(), self.embedder());
        let is_initial = page.is_initial();
        if wish.url.starts_with("javascript:") {
            if !self.has_origin_of_embedder() {
                return if is_initial {
                    self.tell_element(ForElement::Finished { fires_load: true })
                } else {
                    Ok(())
                };
            }
            self.tell_element(ForElement::Loading)?;
            let wish = Wish {
                url: wish.url,
                fires_load_otherwise: Some(is_initial),
                ..Default::default()
            };
            return self.started_page()?.navigate_for(parent, wish);
        }
        let replaces = is_initial || !page.is_loaded.get();
        let wish = Wish { replaces, ..wish };
        match is_initial {
            true => self.wish(page, wish, Initiator::of(parent), None),
            false => self.navigate(parent, wish, None),
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
        self.size.set(Some(bun_web::input::Extent {
            size: [width, height],
            scale,
        }));
        self.tell_surface(SurfaceCommand::Bounds(Some(bounds).into()))
    }

    /// `area` is what a frame in it has changed, outside of a rendering of the page.
    pub(super) fn painted(&self, scale: f64, area: JSValue) -> JsResult<()> {
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
            scale: finite(scale),
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
