//! What the inspector sees of a `WebContents`.

use std::rc::Rc;

use super::page::Page;
use super::{Contents, of_app, parts};
use crate::prelude::*;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Stage {
    Interactive,
    Complete,
}

#[derive(Clone, Copy)]
pub(crate) enum News<'a> {
    DocumentCreated,
    NavigatedWithinDocument(&'a str),
    Reached(Stage),
    Console(&'a str, &'a [JSValue]),
    Exception {
        text: &'a str,
        url: &'a str,
        line: u32,
        column: u32,
        error: JSValue,
    },
    FramesChanged,
    GuestCommitted,
    Destroyed,
}

pub(crate) struct Observer {
    dismisses_dialogs: bool,
    hear: Box<dyn Fn(News<'_>) -> JsResult<()>>,
}

impl Observer {
    pub(crate) fn new(
        dismisses_dialogs: bool,
        hear: impl Fn(News<'_>) -> JsResult<()> + 'static,
    ) -> Rc<Observer> {
        Rc::new(Observer {
            dismisses_dialogs,
            hear: Box::new(hear),
        })
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct EmulatedMedia {
    pub(crate) is_dark: Option<bool>,
    pub(crate) reduces_motion: Option<bool>,
    pub(crate) increases_contrast: Option<bool>,
    pub(crate) forces_colors: Option<bool>,
    pub(crate) reduces_transparency: Option<bool>,
}

#[derive(Default)]
pub(super) struct Inspection {
    observers: RefCell<Vec<Rc<Observer>>>,
    pub(super) has_network: Cell<bool>,
    media: Cell<Option<EmulatedMedia>>,
    pub(super) seems_focused: Cell<bool>,
}

pub(crate) fn inspectable() -> impl Iterator<Item = &'static Contents> {
    of_app()
}

/// Of a page, or of a frame that is not in the web engine.
pub(crate) fn around(object: JSValue) -> Option<&'static Contents> {
    (cast(object).map(Page::contents)).or_else(|| cast(object))
}

impl Contents {
    pub(crate) fn observe(&self, observer: &Rc<Observer>) {
        (self.inspection.observers.borrow_mut()).push(Rc::clone(observer));
    }

    pub(crate) fn unobserve(&self, observer: &Rc<Observer>) {
        (self.inspection.observers.borrow_mut()).retain(|it| !Rc::ptr_eq(it, observer));
    }

    pub(crate) fn notify(&self, news: News<'_>) -> JsResult<()> {
        let all = self.inspection.observers.borrow().clone();
        all.iter().try_for_each(|it| (it.hear)(news))
    }

    pub(super) fn has_observers(&self) -> bool {
        !self.inspection.observers.borrow().is_empty()
    }

    pub(super) fn dismisses_dialogs(&self) -> bool {
        (self.inspection.observers.borrow().iter()).any(|it| it.dismisses_dialogs)
    }

    pub(crate) fn inspect_network(&self, is_on: bool) {
        self.inspection.has_network.set(is_on);
    }

    pub(super) fn emulated_media(&self) -> EmulatedMedia {
        (self.inspection.media.get())
            .or_else(|| self.owner().inspection.media.get())
            .unwrap_or_default()
    }

    pub(crate) fn emulate_media(&self, media: Option<EmulatedMedia>) -> JsResult<()> {
        self.inspection.media.set(media);
        self.environment_changed()
    }

    pub(crate) fn emulate_focus(&self, is_on: bool) -> JsResult<()> {
        self.inspection.seems_focused.set(is_on);
        self.environment_changed()
    }

    /// It is not known yet which engine will have its page.
    pub(crate) fn is_undecided(&self) -> JsResult<bool> {
        Ok(self.guest().is_none()
            && !self.has_shown_trusted.get()
            && self.is_for_guest("about:blank")?)
    }

    pub(crate) fn name(&self) -> String {
        self.context.name.borrow().clone()
    }

    pub(crate) fn contents_of_opener(&self) -> JsResult<JSValue> {
        match self.opener_for_app()? {
            opener if opener.is_object() => parts::contents_of_frame(opener),
            _ => Ok(JSValue::UNDEFINED),
        }
    }
}
