//! `nativeTheme`

use bun_ui::protocol::{SystemSettings, Theme};
use bun_web::host::Palette;

use crate::generated_bindgen::system::{DesktopNativeTheme, js_DesktopNativeTheme};
use crate::prelude::*;
use crate::webview::engine::{self, Order};
use crate::window;

#[derive(Default)]
struct State {
    is_dark: Cell<bool>,
    source: Cell<Theme>,
    settings: Cell<Option<SystemSettings>>,
}

state!(fn state() -> State);

const SOURCES: [(&str, Theme); 3] = [
    ("system", Theme::System),
    ("light", Theme::Light),
    ("dark", Theme::Dark),
];

pub(crate) fn object() -> JSValue {
    js_DesktopNativeTheme::CLASS.constructor(heap())
}

notices_listeners!(DesktopNativeTheme, object(), |_: &str| ui());

pub(crate) fn start_with(is_dark: bool) {
    state().is_dark.set(is_dark);
}

pub(crate) fn is_dark() -> JsResult<bool> {
    ui().map(|_| state().is_dark.get())
}

/// The hook `useColorScheme()`.
pub(crate) fn hook() -> JsResult<JSValue> {
    let subscribe = function(JSValue::UNDEFINED, |_, arguments| {
        let listener = argument(arguments, 0);
        invoke(object(), "on", &[js("updated")?, listener])?;
        function(listener, |listener, _| {
            invoke(object(), "off", &[js("updated")?, listener])
        })
    })?;
    let read = function(JSValue::UNDEFINED, |_, _| {
        js(if is_dark()? { "dark" } else { "light" })
    })?;
    function(array(&[subscribe, read])?, |both, _| {
        bun_ui::dom::use_store(both.get_index(global(), 0)?, both.get_index(global(), 1)?)
    })
}

pub(crate) fn source() -> Theme {
    state().source.get()
}

pub(crate) fn as_order() -> JsResult<Order> {
    Ok(Order::Theme {
        is_dark: is_dark()?,
        reduces_motion: reduces_motion()?,
        increases_contrast: increases_contrast()?,
        forces_colors: forces_colors()?,
        reduces_transparency: settings()?.reduced_transparency,
    })
}

fn updated() -> JsResult<()> {
    window::theme_changed()?;
    if let Some(engine) = engine::running() {
        engine.send(as_order()?);
    }
    emit(object(), "updated", &[])
}

pub(crate) fn set_dark(is_dark: bool) -> JsResult<()> {
    if state().is_dark.replace(is_dark) == is_dark {
        Ok(())
    } else {
        updated()
    }
}

pub(crate) fn settings() -> JsResult<SystemSettings> {
    if let Some(known) = state().settings.get() {
        return Ok(known);
    }
    let settings = if IS_MAC || IS_WINDOWS {
        answer((ui()?.system_settings)())?
    } else {
        let overlays = crate::process::variable("BUN_DESKTOP_OVERLAY_SCROLLBARS")?;
        SystemSettings {
            overlay_scrollbars: Some(overlays.as_deref() == Some("1")).into(),
            ..Default::default()
        }
    };
    state().settings.set(Some(settings));
    Ok(settings)
}

pub(crate) fn reduces_motion() -> JsResult<bool> {
    Ok(answer((ui()?.system_state)())?.reduces_motion)
}

pub(crate) fn forces_colors() -> JsResult<bool> {
    Ok(crate::command_line::switch("force-high-contrast").is_some()
        || (IS_WINDOWS && settings()?.more_contrast))
}

pub(crate) fn increases_contrast() -> JsResult<bool> {
    Ok(forces_colors()? || settings()?.more_contrast)
}

pub(crate) fn palette() -> JsResult<Option<Palette>> {
    let settings = settings()?;
    Ok(settings.palette.get().map(|colors| Palette {
        colors,
        is_for_contrast: settings.more_contrast,
    }))
}

pub(crate) fn settings_changed(mut now: SystemSettings) -> JsResult<()> {
    if now.overlay_scrollbars.get().is_none() {
        now.overlay_scrollbars = settings()?.overlay_scrollbars;
    }
    let before = state().settings.replace(Some(now));
    if let Some(before) = before.filter(|_| IS_WINDOWS) {
        crate::preferences::colors_may_have_changed(&before, &now)?;
    }
    updated()
}

impl DesktopNativeTheme {
    pub(crate) fn get_theme_source() -> &'static str {
        SOURCES[source() as usize].0
    }

    pub(crate) fn set_theme_source(_: Cx<'_, '_>, name: &[u8]) -> JsResult<()> {
        let Some(&(_, source)) = SOURCES.iter().find(|it| it.0.as_bytes() == name) else {
            return Err(unknown_value(
                "themeSource",
                &string(name),
                "must be \"system\", \"light\" or \"dark\"",
            ));
        };
        state().source.set(source);
        set_dark(answer((ui()?.set_theme)(source))?)
    }

    pub(crate) fn get_should_use_dark_colors(_: Cx<'_, '_>) -> JsResult<bool> {
        is_dark()
    }

    pub(crate) fn get_should_use_high_contrast_colors(_: Cx<'_, '_>) -> JsResult<bool> {
        increases_contrast()
    }

    pub(crate) fn get_should_use_inverted_color_scheme(_: Cx<'_, '_>) -> JsResult<bool> {
        Ok(settings()?.inverted_colors)
    }

    pub(crate) fn get_prefers_reduced_transparency(_: Cx<'_, '_>) -> JsResult<bool> {
        Ok(settings()?.reduced_transparency)
    }

    pub(crate) fn get_should_use_dark_colors_for_system_integrated_ui(
        _: Cx<'_, '_>,
    ) -> JsResult<bool> {
        settings()?.has_dark_shell.get().map_or_else(is_dark, Ok)
    }

    pub(crate) fn get_in_forced_colors_mode(_: Cx<'_, '_>) -> JsResult<bool> {
        forces_colors()
    }
}
