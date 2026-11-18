//! What the inspector sees of a `WebContents`.

use std::rc::Rc;

use bun_removable_features::{Feature, is_removed};
use bun_web::host::Logged;

use super::page::Page;
use super::{Contents, of_app, parts};
use crate::devtools::TRIMMED;
use crate::devtools::frontend::Frontend;
use crate::generated_bindgen::contents::js_ElectronWebContents as fields;
use crate::prelude::*;
use crate::value::Value;
use crate::webview::engine::Kind;
use crate::webview::remote::Remote;

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
    Logged(Logged<'a>),
    /// By the browser
    Complaint(&'a str),
    /// By the process that has the page.
    Inspected {
        session: u32,
        method: &'a str,
        params: &'a str,
    },
    /// The page is about to be asked.
    Leaving,
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
    frontend: RefCell<Option<Rc<Frontend>>>,
    opening: Cell<Opening>,
}

/// The app hears of the `WebContents` that is made for the frontend.
#[derive(Clone, Copy, Default, PartialEq)]
enum Opening {
    #[default]
    No,
    Yes,
    CalledOff,
}

pub(crate) fn inspectable() -> impl Iterator<Item = &'static Contents> {
    of_app().filter(|it| it.is_inspectable())
}

/// Of a page, or of a frame that is not in the web engine.
pub(crate) fn around(object: JSValue) -> Option<&'static Contents> {
    (cast(object).map(Page::contents)).or_else(|| cast(object))
}

impl Contents {
    pub(crate) fn is_inspectable(&self) -> bool {
        self.preferences.allows_dev_tools
    }

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

    pub(super) fn frontend(&self) -> Option<Rc<Frontend>> {
        self.inspection.frontend.borrow().clone()
    }

    /// Electron knows about extensions.
    pub(super) fn guest_with_dev_tools(&self) -> Option<&'static Remote> {
        let is_free = self.frontend().is_none()
            && fields::host_of_dev_tools(self).is_none()
            && !is_removed(Feature::Inspector);
        (self.guest()).filter(|it| is_free && it.engine().kind == Kind::Electron)
    }

    pub(super) fn start_dev_tools(&self, options: &Value, panel: Option<&str>) -> JsResult<()> {
        self.check()?;
        if let Some(frontend) = self.frontend() {
            return match options["activate"] {
                Value::Bool(false) => Ok(()),
                _ => frontend.activate(),
            };
        }
        if !self.is_inspectable() {
            return Ok(());
        }
        if is_removed(Feature::Inspector) {
            return warn(TRIMMED);
        }
        if self.inspection.opening.replace(Opening::Yes) == Opening::No {
            let host = fields::host_of_dev_tools(self).filter(|it| !it.is_destroyed());
            let frontend = Frontend::open(self, host, options, panel);
            let opening = self.inspection.opening.take();
            self.inspection.frontend.replace(frontend?);
            if opening == Opening::CalledOff {
                return self.end_dev_tools();
            }
        }
        Ok(())
    }

    pub(crate) fn end_dev_tools(&self) -> JsResult<()> {
        if self.inspection.opening.get() == Opening::Yes {
            self.inspection.opening.set(Opening::CalledOff);
        }
        (self.inspection.frontend.take()).map_or(Ok(()), |it| it.close())
    }

    pub(crate) fn set_inspects(&self, inspected: Option<&Contents>) {
        fields::set_inspects(self, inspected);
    }

    /// If it shows DevTools.
    pub(crate) fn inspects(&self) -> Option<&Contents> {
        fields::inspects(self)
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
