//! `systemPreferences`

use bun_jsc::Strong;
use bun_ui::protocol::{
    Media, NotificationCenter as Center, Preference, PreferenceCommand, PreferenceValue as Value,
    Question, Reply, Request, SystemRequest, SystemSettings,
};
use bun_ui::queue;

use crate::generated_bindgen::system::{
    DesktopNativeTheme, DesktopSystemPreferences, js_DesktopSystemPreferences,
};
use crate::prelude::*;
use crate::text::{contains, split};
use crate::{power, theme};

#[derive(Default)]
struct State {
    observed: RefCell<Vec<String>>,
    subscriptions: RefCell<Vec<(u32, String, Strong)>>,
    last_subscription: Cell<u32>,
}

state!(fn state() -> State);

pub(crate) fn read(key: &str) -> JsResult<Option<Value>> {
    Ok(answer((bun_ui::renderer(global())?.preference)(key.into()))?.get())
}

fn change(command: PreferenceCommand) -> JsResult<()> {
    bun_ui::check(
        global(),
        (bun_ui::renderer(global())?.change_preference)(command),
    )
}

pub(crate) fn observe(center: Center, name: &str) -> JsResult<()> {
    if state().observed.borrow().iter().any(|it| it == name) {
        return Ok(());
    }
    state().observed.borrow_mut().push(name.into());
    tell_system(SystemCommand::Observe {
        center,
        name: name.into(),
    })
}

pub(crate) fn observed(name: &str, object: &str, info: Value) -> JsResult<()> {
    power::observed(name)?;
    let subscribed = state()
        .subscriptions
        .borrow()
        .iter()
        .filter(|it| it.1 == name)
        .map(|it| it.2.get())
        .collect::<Vec<_>>();
    let (mut callbacks, info) = (array(&subscribed)?.array_iterator(global())?, js(info)?);
    while let Some(callback) = callbacks.next()? {
        call(callback, &[js(name)?, info, js(object)?])?;
    }
    Ok(())
}

pub(crate) fn colors_may_have_changed(
    before: &SystemSettings,
    now: &SystemSettings,
) -> JsResult<()> {
    let object = js_DesktopSystemPreferences::CLASS.constructor(heap());
    if let Some(accent) = now.accent.get().filter(|_| now.accent != before.accent) {
        announce(
            object,
            "accent-color-changed",
            &[js(format!("{accent:08X}"))?],
        )?;
    }
    if now.palette != before.palette {
        announce(object, "color-changed", &[])?;
    }
    Ok(())
}

fn subscribe(center: Center, name: &[u8], callback: JsLocal<'_, Callable>) -> JsResult<u32> {
    let name = string(name);
    if IS_MAC {
        observe(center, &name)?;
    }
    state().last_subscription.update(|it| it + 1);
    state().subscriptions.borrow_mut().push((
        state().last_subscription.get(),
        name,
        keep(callback.to_js()),
    ));
    Ok(state().last_subscription.get())
}

fn ask(question: Question) -> JsResult<Option<u32>> {
    Ok(answer((bun_ui::renderer(global())?.answer)(question))?.get())
}

fn media(kind: &[u8]) -> JsResult<Media> {
    match kind {
        b"microphone" => Ok(Media::Microphone),
        b"camera" => Ok(Media::Camera),
        b"screen" => Ok(Media::Screen),
        _ => Err(error(format_args!("Invalid media type"))),
    }
}

/// `words` are those of the name of a property of `NSColor`.
fn color(words: &str) -> JsResult<Option<String>> {
    let capitalize = |it: &str| it[..1].to_ascii_uppercase() + &it[1..];
    let mut words = split(words, "-");
    let first = words.next().unwrap_or_default();
    color_named(&format!(
        "{first}{}Color",
        words.map(capitalize).collect::<String>()
    ))
}

fn color_named(name: &str) -> JsResult<Option<String>> {
    ui()?;
    Ok(ask(Question::Color(name.into()))?.map(|it| format!("#{it:08X}")))
}

pub(crate) fn property_list(value: JSValue) -> JsResult<Value> {
    match value.is_object() && !value.is_array() {
        true => bun_ui::preferences::from_js(global(), value, 0),
        false => Ok(Value::Dictionary(Default::default())),
    }
}

pub(crate) fn post(
    center: Center,
    name: &[u8],
    object: &[u8],
    info: JSValue,
    is_urgent: bool,
) -> JsResult<()> {
    tell_system(SystemCommand::Post {
        center,
        name: Text::lossy(name),
        object: Text::lossy(object),
        info: property_list(info)?,
        is_urgent,
    })
}

fn number(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Flag(it)) => u8::from(*it).into(),
        Some(Value::Number(it)) => *it,
        Some(Value::Text(it)) => it.trim().parse().unwrap_or(0.),
        _ => 0.,
    }
}

impl DesktopSystemPreferences {
    pub(crate) fn get_animation_settings(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let system = answer((ui()?.system_state)())?;
        Ok(object!({
            "prefersReducedMotion": system.reduces_motion,
            "scrollAnimationsEnabledBySystem": !system.reduces_motion,
            "shouldRenderRichAnimation": !system.reduces_motion && !system.saves_power,
        }))
    }

    pub(crate) fn is_trusted_accessibility_client(_: Cx<'_, '_>, prompts: bool) -> JsResult<bool> {
        Ok(!IS_MAC || answer((ui()?.is_trusted_for_accessibility)(prompts))?)
    }

    pub(crate) fn ask_for_media_access(_: Cx<'_, '_>, kind: &[u8]) -> JsResult<JSValue> {
        let kind = media(if kind == b"screen" { b"" } else { kind })?;
        if !IS_MAC {
            return resolved(JSValue::FALSE);
        }
        let request = Request::System(SystemRequest::AskForAccess(kind));
        queue::promise_of(global(), request, |_, reply| {
            js(matches!(reply, Reply::Agreed(true)))
        })
    }

    pub(crate) fn get_media_access_status(_: Cx<'_, '_>, kind: &[u8]) -> JsResult<&'static str> {
        Ok(match ask(Question::Access(media(kind)?))? {
            Some(0) => "not-determined",
            Some(1) => "restricted",
            Some(2) => "denied",
            Some(3) | None => "granted",
            Some(_) => "unknown",
        })
    }

    pub(crate) fn can_prompt_touch_id(_: Cx<'_, '_>) -> JsResult<bool> {
        Ok(ask(Question::CanAuthenticate)? == Some(1))
    }

    pub(crate) fn prompt_touch_id(_: Cx<'_, '_>, reason: &[u8]) -> JsResult<JSValue> {
        if reason.is_empty() {
            return Err(error(format_args!("reason must be non-empty")));
        }
        if !IS_MAC {
            return Err(unsupported("promptTouchID"));
        }
        let request = Request::System(SystemRequest::Authenticate(Text::lossy(reason)));
        queue::promise_of(global(), request, |_, _| Ok(JSValue::UNDEFINED))
    }

    pub(crate) fn get_accent_color(_: Cx<'_, '_>) -> JsResult<String> {
        Ok(theme::settings()?
            .accent
            .get()
            .map(|it| format!("{it:08X}"))
            .unwrap_or_default())
    }

    pub(crate) fn get_color(_: Cx<'_, '_>, name: &[u8]) -> JsResult<String> {
        const NAMES: &str = " control-background control control-text disabled-control-text find-highlight grid \
            header-text highlight keyboard-focus-indicator label link placeholder-text quaternary-label \
            scrubber-textured-background secondary-label selected-content-background selected-control \
            selected-control-text selected-menu-item-text selected-text-background selected-text separator shadow \
            tertiary-label text-background text under-page-background unemphasized-selected-content-background \
            unemphasized-selected-text-background unemphasized-selected-text window-background window-frame-text ";
        let name = string(name);
        if IS_WINDOWS {
            return color_named(&name)?.ok_or_else(|| error(format_args!("Unknown color: {name}")));
        }
        if contains(&name, " ") || !contains(NAMES, &format!(" {name} ")) {
            return Err(error(format_args!("Unknown color: {name}")));
        }
        color(&name)?.ok_or_else(|| unsupported("getColor"))
    }

    pub(crate) fn get_system_color(_: Cx<'_, '_>, name: &[u8]) -> JsResult<String> {
        let [light, dark] = match name {
            b"blue" => ["#007AFFFF", "#0A84FFFF"],
            b"brown" => ["#A2845EFF", "#AC8E68FF"],
            b"gray" => ["#8E8E93FF", "#98989DFF"],
            b"green" => ["#28CD41FF", "#32D74BFF"],
            b"orange" => ["#FF9500FF", "#FF9F0AFF"],
            b"pink" => ["#FF2D55FF", "#FF375FFF"],
            b"purple" => ["#AF52DEFF", "#BF5AF2FF"],
            b"red" => ["#FF3B30FF", "#FF453AFF"],
            b"yellow" => ["#FFCC00FF", "#FFD60AFF"],
            _ => {
                return Err(error(format_args!(
                    "Unknown system color: {}",
                    string(name)
                )));
            }
        };
        let usual = if theme::is_dark()? { dark } else { light };
        Ok(color(&format!("system-{}", string(name)))?.unwrap_or_else(|| usual.into()))
    }

    pub(crate) fn get_effective_appearance(_: Cx<'_, '_>) -> JsResult<&'static str> {
        Ok(if theme::is_dark()? { "dark" } else { "light" })
    }

    pub(crate) fn get_accessibility_display_should_reduce_transparency(
        cx: Cx<'_, '_>,
    ) -> JsResult<bool> {
        DesktopNativeTheme::get_prefers_reduced_transparency(cx)
    }

    pub(crate) fn is_swipe_tracking_from_scroll_events_enabled(_: Cx<'_, '_>) -> JsResult<bool> {
        Ok(IS_MAC
            && read("AppleEnableSwipeNavigateWithScrolls")?.is_none_or(|it| number(Some(&it)) > 0.))
    }

    pub(crate) fn get_user_default(_: Cx<'_, '_>, key: &[u8], kind: &[u8]) -> JsResult<JSValue> {
        let value = if IS_MAC { read(&string(key))? } else { None };
        match (kind, value) {
            (b"boolean", Some(Value::Text(it)))
                if ["yes", "true"]
                    .iter()
                    .any(|yes| it.eq_ignore_ascii_case(yes)) =>
            {
                js(true)
            }
            (b"boolean", value) => js(number(value.as_ref()) > 0.),
            (b"array", Some(it @ Value::Array(_)))
            | (b"dictionary", Some(it @ Value::Dictionary(_))) => js(it),
            (b"array", _) => array(&[]),
            (b"dictionary", _) => Ok(object!({})),
            (b"string" | b"url", None) => js(""),
            (b"string" | b"url", Some(it)) => js(text_of(js(it)?)?),
            (_, value) => js(number(value.as_ref())),
        }
    }

    pub(crate) fn set_user_default<'a>(
        _: Cx<'a, '_>,
        key: &[u8],
        _: JsLocal<'a>,
        value: JsLocal<'a>,
    ) -> JsResult<()> {
        let value = bun_ui::preferences::from_js(global(), value.to_js(), 0)?;
        change(PreferenceCommand::Set(Preference {
            key: Text::lossy(key),
            value,
        }))
    }

    pub(crate) fn remove_user_default(_: Cx<'_, '_>, key: &[u8]) -> JsResult<()> {
        change(PreferenceCommand::Remove(Text::lossy(key)))
    }

    pub(crate) fn register_defaults<'a>(
        _: Cx<'a, '_>,
        defaults: JsLocal<'a, JSObject>,
    ) -> JsResult<()> {
        match bun_ui::preferences::from_js(global(), defaults.to_js(), 0)? {
            Value::Dictionary(all) => all
                .into_iter()
                .try_for_each(|it| change(PreferenceCommand::SetDefault(it))),
            _ => Ok(()),
        }
    }

    pub(crate) fn subscribe_local_notification<'a>(
        _: Cx<'a, '_>,
        name: &[u8],
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<u32> {
        subscribe(Center::Local, name, callback)
    }

    pub(crate) fn subscribe_notification<'a>(
        _: Cx<'a, '_>,
        name: &[u8],
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<u32> {
        subscribe(Center::Distributed, name, callback)
    }

    pub(crate) fn subscribe_workspace_notification<'a>(
        _: Cx<'a, '_>,
        name: &[u8],
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<u32> {
        subscribe(Center::Workspace, name, callback)
    }

    pub(crate) fn post_notification<'a>(
        _: Cx<'a, '_>,
        name: &[u8],
        info: JsLocal<'a>,
        is_urgent: bool,
    ) -> JsResult<()> {
        post(Center::Distributed, name, b"", info.to_js(), is_urgent)
    }

    pub(crate) fn post_local_notification<'a>(
        _: Cx<'a, '_>,
        name: &[u8],
        info: JsLocal<'a>,
    ) -> JsResult<()> {
        post(Center::Local, name, b"", info.to_js(), false)
    }

    pub(crate) fn post_workspace_notification<'a>(
        _: Cx<'a, '_>,
        name: &[u8],
        info: JsLocal<'a>,
    ) -> JsResult<()> {
        post(Center::Workspace, name, b"", info.to_js(), false)
    }

    pub(crate) fn unsubscribe(id: u32) {
        state().subscriptions.borrow_mut().retain(|it| it.0 != id);
    }
}
