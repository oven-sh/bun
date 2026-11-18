//! <https://w3c.github.io/permissions/>, <https://notifications.spec.whatwg.org/>

use bun_jsc::JSObject;
use bun_web::channel::Serialized;
use bun_web::exec::oneshot;
use bun_web::host::Permission;
use bun_web::realm::Scope;
use bun_web::service;

use super::*;
use crate::api::realm::promise_for;

const LONGEST_VIBRATION: u32 = 10_000;
const MAX_ACTIONS: u32 = 2;
const LARGEST_PERSISTENT: usize = 1 << 20;

const NAMES: &str = "accelerometer background-fetch background-sync camera clipboard-read clipboard-write display-capture geolocation gyroscope \
    idle-detection local-fonts local-network-access magnetometer microphone midi notifications payment-handler periodic-background-sync \
    persistent-storage push screen-wake-lock storage-access window-management";

fn check(realm: &JsHeap<'_>, name: &str) -> Permission {
    let (name, media) = match name {
        "camera" => ("media", Some("video")),
        "microphone" => ("media", Some("audio")),
        "clipboard-write" => ("clipboard-sanitized-write", None),
        other => (other, None),
    };
    let global = WindowTarget::of_realm(realm).filter(|_| client_of(realm).is_some());
    global.map_or(Permission::Denied, |it| {
        it.host()
            .permission_state(name.into(), media.map(Into::into))
    })
}

#[repr(C)]
pub(crate) struct PermissionStatus {
    pub(crate) base: EventTarget,
    name: &'static str,
}

impl PermissionStatus {
    pub(crate) fn get_state<'a>(&'a self, cx: Cx<'_, 'a>) -> &'static [u8] {
        check(self.realm(&cx.heap), self.name).as_bytes()
    }

    pub(crate) fn get_name(&self) -> &'static [u8] {
        self.name.as_bytes()
    }
}

impl Permissions {
    pub(crate) fn query<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        descriptor: JsLocal<'a, JSObject>,
    ) -> Result<'a, JSValue> {
        active_client(&cx.heap, self.realm(&cx.heap))?;
        let name = PermissionDescriptor::from_js(cx.global(), descriptor.to_js(), |given| {
            Ok(DomString::from(given.name))
        })?;
        let name = NAMES.split_ascii_whitespace().find(|it| name.eq_str(it));
        let name = name.ok_or_else(|| {
            cx.heap
                .type_error(format_args!("The name is not that of a permission."))
        })?;
        let status = js_PermissionStatus::create(
            self.realm(&cx.heap),
            PermissionStatus {
                base: Default::default(),
                name,
            },
        );
        Ok(cx.promise_resolve(status.to_js())?.to_js())
    }
}

bun_ui::state!(fn shown() -> Addressees);
thread_local! {
    static LAST_ID: Cell<u32> = const { Cell::new(0) };
}

#[repr(C)]
pub(crate) struct Notification {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_DomNotification::Fields,
    title: DomString,
    lang: DomString,
    body: DomString,
    tag: DomString,
    image: DomString,
    icon: DomString,
    badge: DomString,
    navigate: DomString,
    timestamp: f64,
    id: u32,
    is_persistent: bool,
    dir: NotificationDirection,
    renotify: bool,
    silent: Option<bool>,
    require_interaction: bool,
}

fn is_language_tag(tag: &DomString) -> bool {
    tag.ascii().is_some_and(|it| {
        let is_subtag = |(at, it): (usize, &[u8])| {
            (1..=8).contains(&it.len())
                && it
                    .iter()
                    .all(|it| it.is_ascii_alphabetic() || at > 0 && it.is_ascii_digit())
        };
        bun_core::strings::split(it.as_bytes(), b"-")
            .enumerate()
            .all(is_subtag)
    })
}

fn for_notifications(permission: Permission) -> &'static [u8] {
    if permission == Permission::Prompt {
        b"default"
    } else {
        permission.as_bytes()
    }
}

macro_rules! getters {
    ($($field:ident: $type:ty),* ; $($string:ident)*) => {
        paste::paste! { impl Notification {
            $(pub(crate) fn [<get_ $field>](&self) -> $type {
                self.$field
            })*
            $(pub(crate) fn [<get_ $string>](&self) -> &DomString {
                &self.$string
            })*
        } }
    };
}
getters!(dir: NotificationDirection, timestamp: f64, renotify: bool, silent: Option<bool>, require_interaction: bool; title lang body navigate tag image icon badge);

impl Notification {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        title: DomString,
        options: &NotificationOptions<'a>,
    ) -> Result<'a, &'a Self> {
        if realm_of(&cx.heap).scope() == Scope::ServiceWorker {
            return Err(cx.heap.type_error(format_args!(
                "Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."
            )));
        }
        if !options.actions.is_empty() {
            return Err(cx.heap.type_error(format_args!(
                "Actions are only supported for persistent notifications."
            )));
        }
        let id = LAST_ID.get() + 1;
        LAST_ID.set(id);
        let this = Notification::new(cx, structure, title, options, id)?;
        match WindowTarget::of_realm(&cx.heap)
            .filter(|_| Notification::permission(&cx.heap) == Permission::Granted)
        {
            Some(global) => {
                shown().add(cx, id, this.to_js());
                global.host().show_notification(
                    id,
                    this.title.to_utf8().into(),
                    this.body.to_utf8().into(),
                    this.silent == Some(true),
                );
            }
            None => queue_task(&cx.heap, [this.to_js()], |cx, [this]| {
                emit(cx, this, atom!("error"))
            }),
        }
        Ok(this)
    }

    /// For a service worker.
    #[optimize(size)]
    pub(crate) fn persistent<'a>(
        cx: Cx<'_, 'a>,
        title: DomString,
        options: &NotificationOptions<'a>,
    ) -> Result<'a, service::Notification> {
        let it = Notification::new(
            cx,
            js_DomNotification::CLASS.structure(&cx.heap),
            title,
            options,
            0,
        )?;
        let [title, body, tag, lang, image, icon, badge, navigate] = [
            &it.title,
            &it.body,
            &it.tag,
            &it.lang,
            &it.image,
            &it.icon,
            &it.badge,
            &it.navigate,
        ]
        .map(|it| it.to_utf8().into_owned());
        let [data, actions, vibrate] = [
            js_DomNotification::data(it),
            js_DomNotification::actions(it),
            js_DomNotification::vibrate(it),
        ]
        .map(|it| Serialized::new(cx.global(), it.unwrap_or(JSValue::NULL), &[], &[]));
        let values = [data?, actions?, vibrate?];
        let texts = [&title, &body, &tag, &lang, &image, &icon, &badge, &navigate].map(String::len);
        if texts
            .into_iter()
            .chain(values.iter().map(Serialized::size))
            .sum::<usize>()
            > LARGEST_PERSISTENT
        {
            return Err(cx.heap.type_error(format_args!(
                "The notification is larger than {LARGEST_PERSISTENT} bytes."
            )));
        }
        let (timestamp, direction, renotifies, is_silent, requires_interaction) = (
            it.timestamp,
            it.dir as u8,
            it.renotify,
            it.silent,
            it.require_interaction,
        );
        Ok(service::Notification {
            id: 0,
            title,
            body,
            tag,
            lang,
            urls: [image, icon, badge, navigate],
            timestamp,
            direction,
            renotifies,
            is_silent,
            requires_interaction,
            tells_of_closing: false,
            values,
        })
    }

    #[optimize(size)]
    pub(crate) fn restore<'a>(cx: Cx<'_, 'a>, it: &service::Notification) -> Result<'a, JSValue> {
        let ([title, body, tag, lang], [image, icon, badge, navigate]) = (
            [&it.title, &it.body, &it.tag, &it.lang].map(|it| DomString::from_utf8(it)),
            it.urls.each_ref().map(|it| DomString::from_utf8(it)),
        );
        let dir = [
            NotificationDirection::Auto,
            NotificationDirection::Ltr,
            NotificationDirection::Rtl,
        ][usize::from(it.direction)];
        let (timestamp, id, renotify, silent, require_interaction) = (
            it.timestamp,
            it.id,
            it.renotifies,
            it.is_silent,
            it.requires_interaction,
        );
        let this = Notification {
            base: Default::default(),
            fields: Default::default(),
            title,
            lang,
            body,
            tag,
            image,
            icon,
            badge,
            navigate,
            timestamp,
            id,
            is_persistent: true,
            dir,
            renotify,
            silent,
            require_interaction,
        };
        let (this, [data, actions, vibrate]) =
            (js_DomNotification::create(&cx.heap, this), &it.values);
        let list = |cx: Cx<'_, 'a>, it: &Serialized| -> Result<'a, JSValue> {
            let items = it.deserialize(cx.global(), &[])?;
            let count = items.get_length(cx.global())? as u32;
            let each = (0..count)
                .map(|at| items.get_index(cx.global(), at))
                .collect::<bun_jsc::JsResult<Vec<_>>>()?;
            let list = frozen(&cx.heap, each);
            items.ensure_still_alive();
            list
        };
        js_DomNotification::set_data(this, data.deserialize(cx.global(), &[])?);
        js_DomNotification::set_actions(this, list(cx, actions)?);
        js_DomNotification::set_vibrate(this, list(cx, vibrate)?);
        Ok(this.to_js())
    }

    #[optimize(size)]
    fn new<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        title: DomString,
        options: &NotificationOptions<'a>,
        id: u32,
    ) -> Result<'a, &'a Self> {
        let is_silent = options.silent == Some(true);
        let refusals = [
            (
                is_silent && options.vibrate.is_some(),
                "Silent notifications must not specify vibration patterns.",
            ),
            (
                options.renotify && options.tag.is_empty(),
                "Notifications which set the renotify flag must specify a tag.",
            ),
        ];
        if let Some((_, message)) = refusals.into_iter().find(|it| it.0) {
            return Err(cx.heap.type_error(format_args!("{message}")));
        }
        let data = crate::api::performance::clone_detail(cx, options.data)?;
        let [image, icon, badge, navigate] = [
            &options.image,
            &options.icon,
            &options.badge,
            &options.navigate,
        ]
        .map(|it| {
            it.as_ref()
                .and_then(|it| parse_url(&cx.heap, it))
                .unwrap_or_default()
        });
        let this = structure.create(
            &cx.heap,
            Notification {
                base: Default::default(),
                fields: Default::default(),
                title,
                lang: Some(&options.lang)
                    .filter(|it| is_language_tag(it))
                    .cloned()
                    .unwrap_or_default(),
                body: options.body.clone(),
                tag: options.tag.clone(),
                image,
                icon,
                badge,
                navigate,
                timestamp: options
                    .timestamp
                    .map_or_else(|| bun_core::time::milli_timestamp() as f64, |it| it as f64),
                id,
                is_persistent: false,
                dir: options.dir,
                renotify: options.renotify,
                silent: options.silent,
                require_interaction: options.require_interaction,
            },
        );
        let pattern = match &options.vibrate {
            None => &[],
            Some(VibratePattern::Once(it)) => core::slice::from_ref(it),
            Some(VibratePattern::Pattern(it)) => &it[..],
        };
        js_DomNotification::set_data(this, data);
        js_DomNotification::set_vibrate(
            this,
            frozen(
                &cx.heap,
                pattern
                    .iter()
                    .map(|it| JSValue::js_number((*it).min(LONGEST_VIBRATION).into())),
            )?,
        );
        let actions = cx.heap.create_array(
            options.actions.iter().take(MAX_ACTIONS as usize),
            |heap, it| {
                let action = heap.create_empty_object();
                NotificationAction::from_js(global_of(heap), it.to_js(), |it| {
                    let [icon, navigate] = [&it.icon, &it.navigate]
                        .map(|it| it.as_ref().and_then(|it| parse_url(heap, it)));
                    for (name, value) in [
                        ("action", Some(it.action)),
                        ("icon", icon),
                        ("navigate", navigate),
                        ("title", Some(it.title.into())),
                    ] {
                        value.into_iter().for_each(|it| {
                            action.to_js().put(
                                global_of(heap),
                                name.as_bytes(),
                                it.to_js(heap).to_js(),
                            )
                        });
                    }
                    Ok(())
                })?;
                Ok(action.as_value())
            },
        )?;
        let actions = cx.heap.freeze_array(actions)?.to_js();
        js_DomNotification::set_actions(this, actions);
        Ok(this)
    }

    fn permission(heap: &JsHeap<'_>) -> Permission {
        if realm_of(heap).is_secure_context() {
            check(heap, "notifications")
        } else {
            Permission::Denied
        }
    }

    pub(crate) fn get_permission(cx: Cx<'_, '_>) -> &'static [u8] {
        for_notifications(Notification::permission(&cx.heap))
    }

    pub(crate) fn get_max_actions() -> u32 {
        MAX_ACTIONS
    }

    pub(crate) fn request_permission<'a>(
        cx: Cx<'_, 'a>,
        callback: Option<JsLocal<'a, Callable>>,
    ) -> Result<'a, JSValue> {
        let (sender, answer) = oneshot();
        if let Some(global) = WindowTarget::of_realm(&cx.heap) {
            global.host().permission("notifications".into(), |_, it| {
                sender.send(Permission::parse(it.as_bytes()).unwrap_or_default())
            });
        }
        let callback = callback.map(|it| bun_jsc::Strong::create(it.to_js(), cx.global()));
        Ok(promise_for(cx, answer, move |cx, answer| {
            let state = cx
                .heap
                .create_latin1_string(for_notifications(answer.unwrap_or_default()))
                .to_js();
            if let Some(Err(error)) =
                callback.map(|it| it.get().call(cx.global(), JSValue::UNDEFINED, &[state]))
            {
                report_exception(cx, error.into());
            }
            Ok(state)
        }))
    }

    pub(crate) fn close<'a>(&'a self, cx: Cx<'_, 'a>) {
        if self.is_persistent {
            client_of(self.realm(&cx.heap)).into_iter().for_each(|it| {
                it.call_service_workers(0, service::Call::CloseNotification(self.id))
            });
        } else if let Some(global) = WindowTarget::of_realm(self.realm(&cx.heap)) {
            global.host().close_notification(self.id);
        }
    }
}

fn emit<'a>(cx: Cx<'_, 'a>, notification: JsLocal<'a>, name: Known) {
    if let Some(notification) = Notification::from_js(&cx.heap, notification.to_js()) {
        fire(
            cx,
            notification,
            name,
            EventInit {
                cancelable: name == atom!("click"),
                ..Default::default()
            },
        );
    }
}

pub(crate) fn fire_at_notification(id: u32, name: &str) {
    let name = Atom::new(name).known();
    shown().queue_task(id, move |cx, it| emit(cx, it, name));
    if name == atom!("close") {
        shown().remove(id);
    }
}
