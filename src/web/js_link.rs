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

unsafe extern "C" {
    /// What a page is given for `host`.
    #[link_name = "Bun__RealmBridge__link"]
    pub safe fn link_to(host: JSValue) -> JSValue;
}

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
}

pub struct NativeHost {
    native: &'static dyn Native,
    _has_fields: bindgen::Interior,
}

impl NativeHost {
    /// What is said with JS values goes to its properties.
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

    fn of(global: &JSGlobalObject, hooks: JSValue) -> Option<(&'static dyn Native, JSValue)> {
        let host = NativeHost::from_js(JsHeap::from_global(global), hooks)?;
        Some((host.native, js_NativeHost::owner(host)?))
    }
}

pub(crate) struct JsLink {
    hooks: JSValue,
    notices: Rc<RefCell<VecDeque<Notice>>>,
}

fn deliver(global: &JSGlobalObject, hooks: JSValue, notices: &RefCell<VecDeque<Notice>>) {
    loop {
        let Some(notice) = notices.borrow_mut().pop_front() else {
            return;
        };
        if let Some((native, owner)) = NativeHost::of(global, hooks) {
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
pub(crate) fn can_call_host(global: &JSGlobalObject) -> bool {
    VirtualMachine::get().script_allowed() && Bun__DesktopRealm__hasStackLeft(global)
}

impl JsLink {
    /// # Safety
    /// What owns the result keeps `hooks` alive.
    pub(crate) unsafe fn new(hooks: JSValue) -> JsLink {
        JsLink {
            hooks,
            notices: Rc::default(),
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
}

impl Link for JsLink {
    fn tell(&self, notice: Notice) {
        let mut notices = self.notices.borrow_mut();
        notices.push_back(notice);
        if notices.len() == 1 {
            let notices = Rc::clone(&self.notices);
            let work = move |global: &JSGlobalObject, values: &[JSValue]| {
                deliver(global, values[0], &notices);
                Ok(())
            };
            let work = Work::Once(Box::new(work));
            tasks::post(bun_ui::main_global(), Priority::Host, work, &[self.hooks]);
        }
    }

    fn ask(&self, question: Question) -> Option<Answer> {
        let global = bun_ui::main_global();
        let (native, owner) = NativeHost::of(global, self.hooks)
            .filter(|_| self.catch_up() || question.is_answered_without_scripts())?;
        reported(global, native.answer(owner, question))?
    }

    fn request(&self, question: Question, reply: Reply<Option<Answer>>) {
        let global = bun_ui::main_global();
        match NativeHost::of(global, self.hooks).filter(|_| self.catch_up()) {
            Some((native, owner)) => native.request(owner, question, reply),
            None => reply(global, None),
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
            "mediaType": self.media_type,
            "hasImageContents": self.media_type == "image",
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

impl IntoJs for Serialized {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::ArrayBuffer::create_uint8_array(global, &self.0)
    }
}

impl IntoJs for HistoryEntry {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(bun_ui::object!(global, {
            "key": self.key,
            "id": self.id,
            "url": self.url,
            "state": self.state,
            "navigationState": self.navigation_state,
            "scroll": self.scroll,
            "restoresScroll": self.restores_scroll,
        }))
    }
}

impl HistoryEntry {
    pub fn from_script(global: &JSGlobalObject, value: JSValue) -> Option<HistoryEntry> {
        let read = || -> JsResult<HistoryEntry> {
            let member = |name| -> JsResult<_> {
                Ok(value
                    .get(global, name)?
                    .filter(|it| !it.is_undefined_or_null()))
            };
            let text = |name| -> JsResult<String> {
                let text = member(name)?.map(|it| it.to_utf8(global)).transpose()?;
                Ok(bstr::BStr::new(text.as_deref().unwrap_or_default()).to_string())
            };
            let bytes = |name| -> JsResult<_> {
                let buffer = member(name)?.and_then(|it| it.as_array_buffer(global));
                Ok(buffer.map(|it| Serialized(it.byte_slice().into())))
            };
            let at = |pair: JSValue, index| pair.get_index(global, index)?.to_number(global);
            Ok(HistoryEntry {
                key: text("key")?,
                id: text("id")?,
                url: text("url")?,
                state: bytes("state")?,
                navigation_state: bytes("navigationState")?,
                scroll: (member("scroll")?.map(|it| JsResult::Ok([at(it, 0)?, at(it, 1)?])))
                    .transpose()?,
                restores_scroll: member("restoresScroll")?.is_none_or(JSValue::to_boolean),
                controls: Default::default(),
                is_of_document: false,
            })
        };
        value.is_object().then(|| reported(global, read()))?
    }
}
