//! A [`Link`] to a host on this thread.

use core::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

use bun_jsc::bindgen::{self, JsHeap, JsInterface};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_ui::value::IntoJs;

use crate::generated_bindgen::host::js_NativeHost;
use crate::host::*;
use crate::tasks::{self, Priority, Work};

/// `owner` is what [`NativeHost::create`] was given.
pub trait Native {
    fn hear(&self, owner: JSValue, notice: Notice) -> JsResult<()>;
    fn answer(&self, owner: JSValue, question: Question) -> JsResult<Option<Answer>>;
    fn request(&self, owner: JSValue, question: Question, reply: Reply<Option<Answer>>) {
        let global = bun_ui::main_global();
        reply(
            global,
            reported(global, self.answer(owner, question)).flatten(),
        );
    }

    fn inspect(&self, _owner: JSValue, _: Logged<'_>) -> JsResult<()> {
        Ok(())
    }

    fn for_blank_frames(&self) -> Option<&'static dyn Native> {
        None
    }
}

pub struct NativeHost {
    native: &'static dyn Native,
    _has_fields: bindgen::Interior,
}

impl NativeHost {
    pub fn create(heap: &JsHeap<'_>, native: &'static dyn Native, owner: JSValue) -> JSValue {
        let host = js_NativeHost::create(
            heap,
            NativeHost {
                native,
                _has_fields: Default::default(),
            },
        );
        js_NativeHost::set_owner(host, owner);
        host.to_js()
    }
}

#[derive(Clone, Copy)]
struct Hooks {
    host: JSValue,
    are_for_blank_frame: bool,
}

impl Hooks {
    fn get(self, global: &JSGlobalObject) -> Option<(&'static dyn Native, JSValue)> {
        let host = NativeHost::from_js(JsHeap::from_global(global), self.host)?;
        let native = match self.are_for_blank_frame {
            true => host.native.for_blank_frames()?,
            false => host.native,
        };
        Some((native, js_NativeHost::owner(host)?))
    }
}

pub(crate) struct JsLink {
    hooks: Hooks,
    notices: Rc<RefCell<VecDeque<Notice>>>,
    /// The answers run scripts of pages, so they wait for a task.
    postponed: Rc<RefCell<VecDeque<Question>>>,
}

fn deliver(global: &JSGlobalObject, hooks: Hooks, notices: &RefCell<VecDeque<Notice>>) {
    loop {
        let Some(notice) = notices.borrow_mut().pop_front() else {
            return;
        };
        if let Some((native, owner)) = hooks.get(global) {
            let _ = bun_ui::report(global, native.hear(owner, notice));
        }
    }
}

fn reported<T>(global: &JSGlobalObject, result: JsResult<T>) -> Option<T> {
    result
        .map_err(|error| bun_ui::report(global, Err(error)))
        .ok()
}

unsafe extern "C" {
    safe fn Bun__DesktopRealm__hasStackLeft(global: &JSGlobalObject) -> bool;
}

/// A page that fills the stack must not make the app fail.
pub fn can_call_host(global: &JSGlobalObject) -> bool {
    VirtualMachine::get().script_allowed() && Bun__DesktopRealm__hasStackLeft(global)
}

impl JsLink {
    /// # Safety
    /// What owns the result keeps `host` alive.
    pub(crate) unsafe fn new(host: JSValue) -> JsLink {
        JsLink {
            hooks: Hooks {
                host,
                are_for_blank_frame: false,
            },
            notices: Rc::default(),
            postponed: Rc::default(),
        }
    }

    /// Delivers the notices. False if the host cannot be asked anything.
    fn catch_up(&self) -> bool {
        let global = bun_ui::main_global();
        let can_run = can_call_host(global) && !global.has_exception();
        if can_run {
            deliver(global, self.hooks, &self.notices);
        }
        can_run
    }

    #[cold]
    fn postpone(&self, question: Question) {
        let mut postponed = self.postponed.borrow_mut();
        postponed.push_back(question);
        if postponed.len() == 1 {
            let (postponed, hooks) = (Rc::clone(&self.postponed), self.hooks);
            let work = move |global: &JSGlobalObject, _: &[JSValue]| {
                for question in postponed.take() {
                    let asked = hooks.get(global).map(|it| it.0.answer(it.1, question));
                    asked.and_then(|it| reported(global, it));
                }
                Ok(())
            };
            let work = Work::Once(Box::new(work));
            tasks::post(bun_ui::main_global(), Priority::Host, work, &[hooks.host]);
        }
    }
}

impl Link for JsLink {
    fn tell(&self, notice: Notice) {
        let mut notices = self.notices.borrow_mut();
        notices.push_back(notice);
        if notices.len() == 1 {
            let (notices, hooks) = (Rc::clone(&self.notices), self.hooks);
            let work = move |global: &JSGlobalObject, _: &[JSValue]| {
                deliver(global, hooks, &notices);
                Ok(())
            };
            let work = Work::Once(Box::new(work));
            tasks::post(bun_ui::main_global(), Priority::Host, work, &[hooks.host]);
        }
    }

    fn ask(&self, question: Question) -> Option<Answer> {
        let global = bun_ui::main_global();
        let (native, owner) = self.hooks.get(global)?;
        let can_run = question.is_answered_without_scripts() || self.catch_up();
        if (!can_run || !self.postponed.borrow().is_empty()) && question.has_to_arrive() {
            self.postpone(question);
            return None;
        }
        reported(global, can_run.then(|| native.answer(owner, question))?)?
    }

    fn request(&self, question: Question, reply: Reply<Option<Answer>>) {
        let global = bun_ui::main_global();
        match (self.hooks.get(global)).filter(|_| self.catch_up()) {
            Some((native, owner)) => native.request(owner, question, reply),
            None => reply(global, None),
        }
    }

    fn for_blank_frame(&self) -> Box<dyn Link> {
        Box::new(JsLink {
            hooks: Hooks {
                are_for_blank_frame: true,
                ..self.hooks
            },
            notices: Rc::default(),
            postponed: Rc::default(),
        })
    }

    fn inspect(&self, it: Logged<'_>) {
        let global = bun_ui::main_global();
        if let Some((native, owner)) = self.hooks.get(global)
            && native.inspect(owner, it).is_err()
        {
            global.clear_exception_except_termination();
        }
    }
}

impl IntoJs for Rect {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(
            bun_ui::object!(global, { "x": self.x, "y": self.y, "width": self.width, "height": self.height }),
        )
    }
}

impl IntoJs for Box<ContextMenu> {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let can = &self.edit_flags;
        let flags = bun_ui::object!(global, {
            "canUndo": can.can_undo,
            "canRedo": can.can_redo,
            "canCut": can.can_cut,
            "canCopy": can.can_copy,
            "canPaste": can.can_paste,
            "canDelete": can.can_cut,
            "canSelectAll": true,
            "canEditRichly": can.can_edit_richly,
        });
        Ok(bun_ui::object!(global, {
            "x": self.x,
            "y": self.y,
            "pageURL": self.page_url,
            "linkURL": self.link_url,
            "linkText": self.link_text,
            "srcURL": self.src_url,
            "mediaType": self.media_type.as_bytes(),
            "hasImageContents": self.media_type == MediaType::Image,
            "altText": self.alt_text,
            "titleText": self.title_text,
            "selectionText": self.selection_text,
            "isEditable": self.is_editable,
            "inputFieldType": self.input_field_type,
            "formControlType": self.form_control_type,
            "editFlags": flags,
            "spellcheckEnabled": !self.misspelled_word.is_empty(),
            "misspelledWord": self.misspelled_word,
            "dictionarySuggestions": self.suggestions,
        }))
    }
}
