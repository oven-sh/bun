//! `Notification`

use std::collections::VecDeque;

use bun_ui::protocol::{PreferenceValue, Reply, Request, SystemRequest};

use crate::generated_bindgen::electron::{
    ElectronPushNotifications, js_ElectronPushNotifications as pushes,
};
use crate::generated_bindgen::system::{NotificationInit, js_DesktopNotification as fields};
use crate::prelude::*;
use crate::{app, paths, process, text};

#[derive(Default)]
struct State {
    shown: RefCell<VecDeque<Root<Notification>>>,
    last: Cell<u32>,
}

state!(fn state() -> State);

pub(crate) fn was_pushed(info: PreferenceValue) -> JsResult<()> {
    let receiver = pushes::CLASS.constructor(heap());
    announce(receiver, "received-apns-notification", &[js(info)?])
}

impl ElectronPushNotifications {
    pub(crate) fn register(_: Cx<'_, '_>) -> JsResult<JSValue> {
        if !IS_MAC {
            return Err(unsupported("pushNotifications"));
        }
        let request = Request::System(SystemRequest::RegisterForPush);
        bun_ui::queue::promise_of(global(), request, |_, reply| match reply {
            Reply::Token(token) => js(token),
            _ => Ok(JSValue::UNDEFINED),
        })
    }

    pub(crate) fn unregister(_: Cx<'_, '_>) -> JsResult<()> {
        tell_system(SystemCommand::UnregisterForPush)
    }
}

#[derive(Default)]
pub(crate) struct Notification {
    tag: String,
    id: String,
    group_id: String,
    title: RefCell<String>,
    subtitle: RefCell<String>,
    body: RefCell<String>,
    reply_placeholder: RefCell<String>,
    sound: RefCell<String>,
    close_button_text: RefCell<String>,
    toast_xml: RefCell<String>,
    urgency: RefCell<String>,
    timeout_type: RefCell<String>,
    silent: Cell<bool>,
    has_reply: Cell<bool>,
}

fn next_tag() -> String {
    state().last.update(|it| it + 1);
    format!("{}-{}", process::id(), state().last.get())
}

fn random_id() -> String {
    let [a, b] = [0x4000_u64, 0x8000 << 48].map(|version| {
        let mask = if version == 0x4000 {
            0xf000
        } else {
            0xc000 << 48
        };
        u64::from_be_bytes(text::random_bytes()) & !mask | version
    });
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        a >> 32,
        a >> 16 & 0xffff,
        a & 0xffff,
        b >> 48,
        b & 0xffff_ffff_ffff
    )
}

fn take(is_wanted: impl Fn(&Notification) -> bool) -> Option<&'static Notification> {
    let mut shown = state().shown.borrow_mut();
    let index = shown.iter().position(|it| is_wanted(it.get()))?;
    shown.remove(index).map(|it| it.get())
}

fn remove_all(is_wanted: impl Fn(&Notification) -> bool) -> JsResult<()> {
    while let Some(found) = take(&is_wanted) {
        tell_system(SystemCommand::DismissNotification(
            found.tag.as_str().into(),
        ))?;
    }
    Ok(())
}

pub(crate) fn activated(tag: &str, action: Option<u32>) -> JsResult<()> {
    match (take(|it| it.tag == tag), action) {
        (None, _) => Ok(()),
        (Some(it), None) => announce(it.to_js(), "click", &[]),
        (Some(it), Some(index)) => emit(
            it.to_js(),
            "action",
            &[
                Event::create().with("actionIndex", index)?.to_js(),
                js(index)?,
            ],
        ),
    }
}

pub(crate) fn show_plain(title: &[u8], body: &[u8]) -> JsResult<()> {
    let (tag, title, body) = (next_tag().into(), Text::lossy(title), Text::lossy(body));
    catch(perform(SystemCommand::Notify {
        tag,
        title,
        body,
        actions: Default::default(),
    }))
    .map(drop)
}

macro_rules! texts {
    ($($name:ident: $getter:ident, $setter:ident;)*) => {$(
        pub(crate) fn $getter(&self) -> String {
            self.$name.borrow().clone()
        }

        pub(crate) fn $setter(&self, value: &[u8]) {
            self.$name.replace(string(value));
        }
    )*};
}

impl Notification {
    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        it: &NotificationInit<'a>,
    ) -> JsResult<&'a Self> {
        let or = |it: &Option<bun_core::Utf8Bytes<'_>>, otherwise: &[u8]| {
            string(it.as_deref().unwrap_or(otherwise))
        };
        let notification = Notification {
            tag: next_tag(),
            id: it.id.as_deref().map_or_else(random_id, string),
            group_id: or(&it.group_id, b""),
            title: or(&it.title, b"").into(),
            subtitle: or(&it.subtitle, b"").into(),
            body: or(&it.body, b"").into(),
            reply_placeholder: or(&it.reply_placeholder, b"").into(),
            sound: or(&it.sound, b"").into(),
            close_button_text: or(&it.close_button_text, b"").into(),
            toast_xml: or(&it.toast_xml, b"").into(),
            urgency: or(&it.urgency, b"").into(),
            timeout_type: or(&it.timeout_type, b"").into(),
            silent: it.silent.into(),
            has_reply: it.has_reply.into(),
        };
        let notification = structure.create(&cx.heap, notification);
        fields::set_actions(
            notification,
            it.actions.map_or_else(|| array(&[]), |it| Ok(it.to_js()))?,
        );
        Ok(notification)
    }

    /// UNUserNotificationCenter serves apps that have a bundle.
    pub(crate) fn is_supported() -> bool {
        !IS_MAC || paths::resources().is_some()
    }

    pub(crate) fn get_history(_: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved(array(
            &state()
                .shown
                .borrow()
                .iter()
                .map(|it| it.get().to_js())
                .collect::<Vec<_>>(),
        )?)
    }

    pub(crate) fn remove<'a>(_: Cx<'a, '_>, id: JsLocal<'a>) -> JsResult<()> {
        let ids = if id.to_js().is_array() {
            texts_of(id.to_js())?
        } else {
            vec![text_of(id.to_js())?]
        };
        remove_all(|it| ids.contains(&it.id))
    }

    pub(crate) fn remove_all(_: Cx<'_, '_>) -> JsResult<()> {
        remove_all(|_| true)
    }

    pub(crate) fn remove_group(_: Cx<'_, '_>, group: &[u8]) -> JsResult<()> {
        remove_all(|it| it.group_id.as_bytes() == group)
    }

    pub(crate) fn get_id(&self) -> &str {
        &self.id
    }

    pub(crate) fn get_group_id(&self) -> &str {
        &self.group_id
    }

    texts! {
        title: get_title, set_title;
        subtitle: get_subtitle, set_subtitle;
        body: get_body, set_body;
        reply_placeholder: get_reply_placeholder, set_reply_placeholder;
        sound: get_sound, set_sound;
        close_button_text: get_close_button_text, set_close_button_text;
        toast_xml: get_toast_xml, set_toast_xml;
        urgency: get_urgency, set_urgency;
        timeout_type: get_timeout_type, set_timeout_type;
    }

    pub(crate) fn get_silent(&self) -> bool {
        self.silent.get()
    }

    pub(crate) fn set_silent(&self, is_silent: bool) {
        self.silent.set(is_silent);
    }

    pub(crate) fn get_has_reply(&self) -> bool {
        self.has_reply.get()
    }

    pub(crate) fn set_has_reply(&self, has_reply: bool) {
        self.has_reply.set(has_reply);
    }

    fn present(&self) -> JsResult<()> {
        let mut actions = Vec::new();
        if let Some(all) = fields::actions(self).filter(|it| it.is_array()) {
            let mut all = all.array_iterator(global())?;
            while let Some(action) = all.next()? {
                let label = if action.is_object() {
                    get(action, "text")?
                } else {
                    JSValue::UNDEFINED
                };
                actions.push(if label.is_undefined_or_null() {
                    Text::new()
                } else {
                    text_of(label)?.into()
                });
            }
        }
        take(|it| same(it, self));
        let mut shown = state().shown.borrow_mut();
        // Not every platform says when one went away.
        if shown.len() == 256 {
            shown.pop_front();
        }
        shown.push_back(Root::new(self));
        drop(shown);
        let (subtitle, body) = (self.get_subtitle(), self.get_body());
        perform(SystemCommand::Notify {
            tag: self.tag.as_str().into(),
            title: self.get_title().into(),
            body: if subtitle.is_empty() {
                body
            } else {
                format!("{subtitle}\n{body}")
            }
            .into(),
            actions: actions.into(),
        })
    }

    pub(crate) fn show(&self, _: Cx<'_, '_>) -> JsResult<()> {
        match catch(self.present())? {
            Ok(()) => announce(self.to_js(), "show", &[]),
            Err(thrown) if app::is_electron() => {
                announce(self.to_js(), "failed", &[js(message_of(thrown)?)?])
            }
            Err(thrown) => Err(global().throw_value(thrown)),
        }
    }

    pub(crate) fn close(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if take(|it| same(it, self)).is_none() {
            return Ok(());
        }
        tell_system(SystemCommand::DismissNotification(self.tag.as_str().into()))?;
        announce(self.to_js(), "close", &[])
    }
}
