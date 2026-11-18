//! `app`

use core::cell::OnceCell;

use bun_core::CStringList;
use bun_jsc::JSGlobalObject;
use bun_ui::protocol::{
    ActivityStep, NotificationCenter, PreferenceValue, Request, SystemEvent, SystemRequest,
    WindowCommand,
};
use bun_ui::queue;
use bun_ui::surfaces;

use crate::generated_bindgen::app::{
    AboutPanelOptions, AppFocusOptions, DesktopApp, DesktopDock, DesktopLoginItemSettings,
    FileIconOptions, LoginItemOptions, RelaunchOptions, js_DesktopApp, js_DesktopCommandLine,
    js_DesktopDock, js_DesktopLoginItemSettings,
};
use crate::menu::{self, Menu, Slot};
use bun_core::Utf8Bytes;
use bun_web::compiled;
use bun_web::trust::{self, Trust};

use crate::generated_bindgen::app::{CompiledScriptsOptions, FramesToTrust, TrustOptions};
use crate::prelude::*;
use crate::session;
use crate::webview::{engine, wire};
use crate::window::{self, Window};
use crate::{
    command_line, cover, dialog, files, notification, os_crypt, paths, power, preferences, process,
    screen, shortcuts, single_instance, text, theme, touch_bar, tray, updater, utility, xdg,
};
use bun_web::net::tls::import_pkcs12;

unsafe extern "C" {
    safe fn Bun__Desktop__defaultLocale(global: &JSGlobalObject) -> bun_core::String;
}

#[derive(Default)]
struct About {
    name: Option<String>,
    version: Option<String>,
    credits: Option<String>,
    copyright: Option<String>,
}

#[derive(Default)]
struct State {
    is_electron: Cell<bool>,
    has_display: Cell<bool>,
    is_ready: Cell<bool>,
    ready: Deferred,
    /// The main script may be waiting at its top level.
    is_awaited: Cell<bool>,
    is_waiting_for_key: Cell<bool>,
    note_about_key: StrongCell,
    /// Gives the text of a module that is part of the program without being compiled.
    source_of: StrongCell,
    is_quitting: Cell<bool>,
    stays_open: Cell<bool>,
    is_hidden: Cell<bool>,
    is_accessory: Cell<bool>,
    badge_count: Cell<f64>,
    badge: RefCell<String>,
    dock_menu: StrongCell,
    relaunch: RefCell<Option<(Vec<String>, CStringList)>>,
    about: RefCell<About>,
    app_path: OnceCell<String>,
    system_locale: OnceCell<String>,
    locale: OnceCell<&'static str>,
    user_agent: RefCell<Option<String>>,
    desktop_name: RefCell<Option<String>>,
    activity: RefCell<String>,
    has_secure_input: Cell<bool>,
    recent_documents: RefCell<Vec<String>>,
}

state!(fn state() -> State);

pub(crate) fn object() -> JSValue {
    js_DesktopApp::CLASS.constructor(heap())
}

pub(crate) fn is_electron() -> bool {
    state().is_electron.get()
}

pub(crate) fn is_ready() -> bool {
    state().is_ready.get()
}

pub(crate) fn ready() -> JSValue {
    state().ready.promise()
}

pub(crate) fn has_display() -> JsResult<bool> {
    Ok(state().has_display.get() || is_headless()?)
}

pub(crate) fn become_electron() -> JsResult<()> {
    state().is_electron.set(true);
    command_line::read(process::arguments()?.get(1..).unwrap_or_default());
    if command_line::switch("enable-sandbox").is_some() && !crate::contents::place::enable_sandbox()
    {
        return Err(unsupported("--enable-sandbox"));
    }
    if let Some(directory) = command_line::value("user-data-dir") {
        paths::set_path("userData", files::absolute(&directory))?;
    }
    later::soon(|_| start_soon());
    Ok(())
}

// ── launching ──

fn start_soon() -> JsResult<()> {
    if bun_ui::is_started() {
        return Ok(());
    }
    queue_microtask(|| match catch(ui())? {
        Ok(_) => Ok(()),
        Err(thrown) if has_listeners(object(), "ready")? => Err(global().throw_value(thrown)),
        Err(thrown) => state().ready.settle(Err(global().throw_value(thrown))),
    })
}

notices_listeners!(DesktopApp, object(), |name: &str| match name {
    "ready" | "open-url" | "open-file" | "activate" => start_soon(),
    "request-answered" => {
        session::report_answers();
        Ok(())
    }
    _ => Ok(()),
});

fn tell_identity() -> JsResult<()> {
    let (id, name) = (paths::identifier()?.into(), paths::app_name()?.into());
    tell_system(SystemCommand::Identity { id, name })
}

pub(crate) fn started() -> JsResult<()> {
    let system = answer((ui()?.system_state)())?;
    state().has_display.set(system.has_display);
    theme::start_with(system.is_dark);
    tell_identity()?;
    if IS_MAC {
        menu::set_default_application_menu()?;
    }
    if is_electron() {
        return queue_microtask(finish_launching);
    }
    state().is_ready.set(true);
    state().ready.resolve(JSValue::UNDEFINED)?;
    queue_microtask(announce_ready)
}

fn announce_ready() -> JsResult<()> {
    announce(object(), "ready", &[object!({})])
}

/// The key of `safeStorage` can only be read asynchronously, and has to be there when the app is ready.
fn finish_launching() -> JsResult<()> {
    if !state().is_awaited.get() && global().bun_vm().is_loading_entry_point() {
        bun_ui::hold();
        let again = |_: &JSGlobalObject| {
            bun_ui::release();
            finish_launching()
        };
        later::after(1., again).detach();
        return Ok(());
    }
    load_key(|| {
        state().is_ready.set(true);
        emit(object(), "will-finish-launching", &[])?;
        paths::make_data_directories()?;
        session::default()?;
        if let Some(port) = command_line::switch("remote-debugging-port") {
            crate::devtools::listen(port.parse().unwrap_or_default())?;
        }
        if command_line::switch("force-renderer-accessibility").is_some() {
            tell(Command::AssumeScreenReader(true))?;
        }
        state().ready.resolve(JSValue::UNDEFINED)?;
        announce_ready()
    })
}

fn load_key(next: fn() -> JsResult<()>) -> JsResult<()> {
    let does_without = match IS_MAC {
        true => is_headless()? && command_line::switch("use-mock-keychain").is_none(),
        false => {
            is_headless()? || command_line::value("password-store").as_deref() == Some("basic")
        }
    };
    if does_without {
        return queue_microtask(next);
    }
    if os_crypt::is_untouched() {
        state().is_waiting_for_key.set(true);
        later::after(1500., |_| explain_wait_for_key()).detach();
    }
    os_crypt::load(move || {
        state().is_waiting_for_key.set(false);
        next()?;
        // The app has a turn to make a window first.
        if let (true, Some(note)) = (
            is_ready(),
            state().note_about_key.get().and_then(cast::<Window>),
        ) {
            let note = Root::new(note);
            later::soon(move |_| note.get().destroy_now());
        }
        Ok(())
    })
}

pub(crate) fn explain_wait_for_key() -> JsResult<()> {
    if !state().is_waiting_for_key.get() || state().note_about_key.is_some() {
        return Ok(());
    }
    // It would show a password that is typed into it.
    cover::discard()?;
    ui()?;
    if has_display()? {
        let name = paths::app_name()?;
        let note = format!(
            "{name} is waiting for the keychain. It starts when you have answered the prompt."
        );
        state()
            .note_about_key
            .set(keep(dialog::show_note(&note)?.to_js()));
    }
    Ok(())
}

// ── quitting ──

pub(crate) fn quit() -> JsResult<()> {
    if state().is_quitting.get() || !dispatch(object(), "before-quit", &[])? {
        return Ok(());
    }
    state().is_quitting.set(true);
    let windows = window::of_app();
    if windows.is_empty() {
        return all_windows_closed();
    }
    windows.iter().try_for_each(|it| it.get().request_close())
}

fn exit(code: i32) -> JsResult<()> {
    announce(object(), "quit", &[code.into()])?;
    process::exit(code.into())
}

pub(crate) fn close_cancelled() {
    state().is_quitting.set(false);
}

pub(crate) fn all_windows_closed() -> JsResult<()> {
    if state().is_quitting.get() {
        if !dispatch(object(), "will-quit", &[])? {
            close_cancelled();
            return Ok(());
        }
        let code = get(process::object(), "exitCode")?;
        announce(
            object(),
            "quit",
            &[if code.is_undefined_or_null() {
                0.into()
            } else {
                code
            }],
        )?;
        return process::exit(JSValue::UNDEFINED);
    }
    if !has_listeners(object(), "window-all-closed")? {
        return quit();
    }
    if !state().stays_open.replace(true) {
        bun_ui::hold();
    }
    emit(object(), "window-all-closed", &[])?;
    updater::all_windows_closed()
}

pub(crate) fn is_in_applications_folder() -> bool {
    text::contains(&process::executable(), "/Applications/")
}

pub(crate) fn relaunch_with(command: Vec<String>) -> JsResult<()> {
    state()
        .relaunch
        .replace(Some((command, process::environment("")?)));
    process::at_exit(|| {
        single_instance::release();
        if let Some((command, environment)) = state().relaunch.take() {
            process::start(&command, &environment);
        }
    });
    Ok(())
}

// ── what the system says ──

pub(crate) fn window_was_focused() {
    state().is_hidden.set(false);
}

fn continue_activity(step: ActivityStep, kind: &str, info: JSValue, more: &str) -> JsResult<()> {
    let name = js(kind)?;
    match step {
        ActivityStep::WillContinue => announce(object(), "will-continue-activity", &[name]),
        ActivityStep::Failed => announce(object(), "continue-activity-error", &[name, js(more)?]),
        ActivityStep::WasContinued => announce(object(), "activity-was-continued", &[name, info]),
        ActivityStep::WillSave => announce(object(), "update-activity-state", &[name, info]),
        ActivityStep::Continue => {
            cover::end(false, Vec::new())?;
            let details = object!({});
            if !more.is_empty() {
                assign(details, "webpageURL", js(more)?)?;
            }
            let is_left = dispatch(object(), "continue-activity", &[name, info, details])?;
            if is_left && kind == "NSUserActivityTypeBrowsingWeb" {
                tell_system(SystemCommand::OpenUrl(more.into()))?;
            }
            Ok(())
        }
    }
}

fn open(url: &str) -> JsResult<()> {
    cover::end(false, Vec::new())?;
    match url.starts_with("file://") {
        true => announce(object(), "open-file", &[js(files::from_url(url))?]),
        false => announce(object(), "open-url", &[js(url)?]),
    }
}

pub(crate) fn handle(event: SystemEvent) -> JsResult<()> {
    match event {
        SystemEvent::Theme { is_dark } => theme::set_dark(is_dark),
        SystemEvent::Settings(it) => theme::settings_changed(it),
        SystemEvent::OpenUrls(urls) => urls.iter().try_for_each(|it| open(it)),
        SystemEvent::Activate {
            has_visible_windows,
        } => announce(object(), "activate", &[has_visible_windows.into()]),
        SystemEvent::Quit => {
            // Apps put off quitting to clean up, which is no reason to interrupt a logout.
            later::after(5000., |_| tell_system(SystemCommand::CancelQuit)).detach();
            quit()
        }
        SystemEvent::BecameActive => announce(object(), "did-become-active", &[]),
        SystemEvent::ResignedActive => announce(object(), "did-resign-active", &[]),
        SystemEvent::SessionEnded => {
            announce(object(), "session-end", &[])?;
            exit(0)
        }
        SystemEvent::Suspend => emit(power::monitor(), "suspend", &[]),
        SystemEvent::Resume => emit(power::monitor(), "resume", &[]),
        SystemEvent::Thermal(it) => power::thermal_state_changed(it),
        SystemEvent::DisplayAdded(id) => screen::changed("display-added", id),
        SystemEvent::DisplayRemoved(id) => screen::changed("display-removed", id),
        SystemEvent::DisplayChanged(id) => screen::changed("display-metrics-changed", id),
        SystemEvent::AccessibilityChanged {
            is_active,
            has_screen_reader,
        } => {
            let had_screen_reader = surfaces::has_screen_reader();
            surfaces::accessibility_changed(is_active, has_screen_reader)?;
            crate::contents::process::statics_changed()?;
            if had_screen_reader == has_screen_reader {
                return Ok(());
            }
            if has_screen_reader {
                cover::end(false, Vec::new())?;
            }
            announce(
                object(),
                "accessibility-support-changed",
                &[has_screen_reader.into()],
            )
        }
        SystemEvent::Observed { name, object, info } => preferences::observed(&name, &object, info),
        SystemEvent::TouchBar {
            item,
            value,
            is_selected,
        } => touch_bar::was_touched(item, value, is_selected),
        SystemEvent::Pushed(info) => notification::was_pushed(info),
        SystemEvent::Activity {
            step,
            kind,
            info,
            detail,
        } => continue_activity(step, &kind, js(info)?, &detail),
        SystemEvent::Notification { tag, action } => notification::activated(&tag, action.get()),
        SystemEvent::HotKey(id) => shortcuts::pressed(id),
        SystemEvent::Menu { item, is_by_key } => menu::chosen(item, is_by_key),
        SystemEvent::Tray { id, event, at } => tray::handle(id, event, at),
    }
}

// ── members ──

fn scheme_of(protocol: JsLocal<'_>) -> JsResult<String> {
    let scheme = text_of(protocol.to_js())?;
    let is_valid = protocol.to_js().is_string()
        && scheme.starts_with(|it: char| it.is_ascii_alphabetic())
        && scheme
            .bytes()
            .all(|it| it.is_ascii_alphanumeric() || matches!(it, b'+' | b'.' | b'-'));
    if is_valid {
        Ok(scheme)
    } else {
        Err(invalid_value("protocol", &scheme, "is not a URL scheme"))
    }
}

fn command(path: Option<&[u8]>, arguments: impl Iterator<Item = String>) -> JsResult<Vec<String>> {
    let mut command = match path.filter(|it| !it.is_empty()) {
        Some(path) => vec![string(path)],
        None => paths::launch_command()?,
    };
    command.extend(arguments);
    Ok(command)
}

type Texts = Vec<bun_core::Utf8Bytes<'static>>;

fn strings<T: core::borrow::Borrow<bun_core::Utf8Bytes<'static>>>(
    all: Option<impl IntoIterator<Item = T>>,
) -> impl Iterator<Item = String> {
    all.into_iter().flatten().map(|it| string(it.borrow()))
}

fn preference(key: &str) -> JsResult<Option<PreferenceValue>> {
    if IS_MAC {
        preferences::read(key)
    } else {
        Ok(None)
    }
}

fn system_locale() -> JsResult<&'static str> {
    if let Some(known) = state().system_locale.get() {
        return Ok(known);
    }
    let locale = match preference("AppleLocale")? {
        Some(PreferenceValue::Text(it)) => {
            text::escape(text::before(&it, "@"), |it| (it == '_').then_some("-"))
        }
        _ => string(&Bun__Desktop__defaultLocale(global()).to_utf8()),
    };
    Ok(state().system_locale.get_or_init(|| locale))
}

pub(crate) fn path() -> JsResult<&'static str> {
    DesktopApp::path()
}

pub(crate) fn locale() -> JsResult<&'static str> {
    let chosen = command_line::value("lang").and_then(|it| translation_for(&it));
    if let Some(locale) = chosen.or_else(|| state().locale.get().copied()) {
        return Ok(locale);
    }
    let first = languages()?.iter().find_map(|it| translation_for(it));
    Ok(state().locale.get_or_init(|| first.unwrap_or("en-US")))
}

pub(crate) fn country() -> JsResult<String> {
    let mut subtags = text::split(system_locale()?, "-")
        .skip(1)
        .take_while(|it| it.len() > 1);
    let region =
        subtags.find(|it| it.len() == 2 || (it.len() == 3 && it.as_bytes()[0].is_ascii_digit()));
    Ok(region.unwrap_or_default().to_ascii_uppercase())
}

pub(crate) fn languages() -> JsResult<Vec<String>> {
    let chosen = match preference("AppleLanguages")? {
        Some(PreferenceValue::Array(all)) => all.into_vec(),
        _ => Vec::new(),
    };
    let chosen = chosen.into_iter().filter_map(|it| match it {
        PreferenceValue::Text(it) => Some(it.into_string()),
        _ => None,
    });
    let chosen: Vec<String> = chosen.collect();
    Ok(if chosen.is_empty() {
        vec![system_locale()?.into()]
    } else {
        chosen
    })
}

/// The one among those that Chromium is translated to.
fn translation_for(tag: &str) -> Option<&'static str> {
    const LANGUAGES: &str = "af am ar bg bn ca cs da de el et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv \
        ml mr ms nb nl pl ro ru sk sl sr sv sw ta te th tr uk ur vi";
    let tag = text::escape(tag, |it| (it == '_').then_some("-")).to_ascii_lowercase();
    let (language, rest) = text::split_once(&tag, "-").unwrap_or((&tag, ""));
    let has =
        |any_of: &str| text::split(rest, "-").any(|it| text::split(any_of, " ").any(|of| of == it));
    Some(match language {
        "en" if IS_MAC && has("gb au ie in nz sg za") => "en-GB",
        "en" if IS_MAC || rest.is_empty() || has("us lr ph") => "en-US",
        "en" => "en-GB",
        "es" if rest.is_empty() || has("es") => "es",
        "es" => "es-419",
        "pt" if rest.is_empty() || has("br") => "pt-BR",
        "pt" => "pt-PT",
        "zh" if has("hant") || !has("hans") && has("hk mo tw") => "zh-TW",
        "zh" => "zh-CN",
        "no" => "nb",
        "tl" => "fil",
        "iw" => "he",
        _ => text::split(LANGUAGES, " ").find(|it| *it == language)?,
    })
}

fn set_accessory(is_accessory: bool) -> JsResult<()> {
    state().is_accessory.set(is_accessory);
    bun_ui::set_accessory(global(), is_accessory)
}

fn set_badge(text: &str) -> JsResult<()> {
    let (text, app_id) = (text.into(), paths::identifier()?.into());
    tell_system(SystemCommand::Badge { text, app_id })
}

fn set_identifier(id: &str) -> JsResult<()> {
    paths::manifest()?.identifier.replace(Some(id.into()));
    if bun_ui::is_started() {
        tell_identity()
    } else {
        Ok(())
    }
}

fn file_icon(path: &str, side: u32) -> JsResult<JSValue> {
    let png = if IS_MAC {
        answer((ui()?.file_icon)(path.into(), side))?.into_vec()
    } else {
        Vec::new()
    };
    Ok(NativeImage::from_bytes(png).to_js(global()))
}

pub(crate) fn activate(steals_focus: bool) -> JsResult<()> {
    if IS_MAC {
        return tell_system(SystemCommand::Activate { steals_focus });
    }
    for window in window::of_app() {
        if window.get().is_on_screen()? {
            return window.get().take_focus();
        }
    }
    Ok(())
}

pub(crate) fn hide() -> JsResult<()> {
    state().is_hidden.set(true);
    tell_system(SystemCommand::Hide)
}

pub(crate) fn show_about_panel() -> JsResult<JSValue> {
    let about = state().about.borrow();
    let version = about
        .version
        .as_ref()
        .unwrap_or(&paths::manifest()?.version);
    let lines = [
        Some(format!("Version {version}")),
        about.credits.clone(),
        about.copyright.clone(),
    ];
    let lines: Vec<String> = lines
        .into_iter()
        .flatten()
        .filter(|it| !it.is_empty())
        .collect();
    let name = about.name.clone().map_or_else(paths::app_name, Ok)?;
    drop(about);
    dialog::inform(name, lines.join("\n"))
}

pub(crate) fn set_user_agent(value: String) {
    state().user_agent.replace(Some(value));
}

pub(crate) fn user_agent() -> JsResult<String> {
    if let Some(chosen) = &*state().user_agent.borrow() {
        return Ok(chosen.clone());
    }
    let system = if IS_MAC {
        "Macintosh; Intel Mac OS X 10_15_7"
    } else {
        "X11; Linux x86_64"
    };
    let name = text::escape(&paths::app_name()?, |it| {
        (!it.is_ascii_graphic()).then_some("")
    });
    let (version, bun) = (
        &paths::manifest()?.version,
        bun_core::Global::package_json_version,
    );
    let versions = get(process::object(), "versions")?;
    let (chrome, electron) = (
        text_of(get(versions, "chrome")?)?,
        text_of(get(versions, "electron")?)?,
    );
    Ok(format!(
        "Mozilla/5.0 ({system}) AppleWebKit/537.36 (KHTML, like Gecko) {name}/{version} Chrome/{chrome} \
         Electron/{electron} Bun/{bun} Safari/537.36"
    ))
}

impl DesktopApp {
    pub(crate) fn nothing() {}

    pub(crate) fn no() -> bool {
        false
    }

    pub(crate) fn get_name(_: Cx<'_, '_>) -> JsResult<String> {
        paths::app_name()
    }

    pub(crate) fn set_name(_: Cx<'_, '_>, name: &[u8]) -> JsResult<()> {
        paths::manifest()?.name.replace(string(name));
        Ok(())
    }

    pub(crate) fn get_is_packaged() -> bool {
        paths::resources().is_some()
    }

    pub(crate) fn get_identifier(_: Cx<'_, '_>) -> JsResult<String> {
        paths::identifier()
    }

    pub(crate) fn get_badge_count_property(_: Cx<'_, '_>) -> JsResult<Option<f64>> {
        Ok(Some(Self::get_badge_count()))
    }

    pub(crate) fn set_badge_count_property(cx: Cx<'_, '_>, count: Option<f64>) -> JsResult<()> {
        Self::set_badge_count(cx, count).map(drop)
    }

    pub(crate) fn get_application_menu(_: &JsHeap<'_>) -> JSValue {
        menu::application_menu().map_or(JSValue::NULL, Menu::to_js)
    }

    pub(crate) fn set_application_menu(_: Cx<'_, '_>, menu: Option<&Menu>) -> JsResult<()> {
        menu::set_application_menu(menu)
    }

    pub(crate) fn get_dock(_: &JsHeap<'_>) -> JSValue {
        if IS_MAC {
            js_DesktopDock::CLASS.constructor(heap())
        } else {
            JSValue::UNDEFINED
        }
    }

    pub(crate) fn get_command_line(_: &JsHeap<'_>) -> JSValue {
        js_DesktopCommandLine::CLASS.constructor(heap())
    }

    pub(crate) fn get_user_agent_fallback(_: Cx<'_, '_>) -> JsResult<String> {
        user_agent()
    }

    pub(crate) fn set_user_agent_fallback(value: &[u8]) {
        set_user_agent(string(value));
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn get_running_under_arm64_translation() -> bool {
        let (mut is_translated, mut size) = (0i32, size_of::<i32>());
        // SAFETY: it writes no more than `size` bytes.
        unsafe {
            libc::sysctlbyname(
                c"sysctl.proc_translated".as_ptr(),
                (&raw mut is_translated).cast(),
                &raw mut size,
                core::ptr::null_mut(),
                0,
            )
        };
        is_translated == 1
    }

    #[cfg(not(target_os = "macos"))]
    pub(crate) fn get_running_under_arm64_translation() -> bool {
        false
    }

    pub(crate) fn get_accessibility_support_enabled() -> bool {
        surfaces::has_screen_reader()
    }

    pub(crate) fn set_accessibility_support_enabled(
        _: Cx<'_, '_>,
        is_enabled: bool,
    ) -> JsResult<()> {
        tell(Command::AssumeScreenReader(is_enabled))
    }

    pub(crate) fn set_accessibility_support_features(
        _: Cx<'_, '_>,
        features: Texts,
    ) -> JsResult<()> {
        tell(Command::AssumeScreenReader(
            features.into_iter().next().is_some(),
        ))
    }

    pub(crate) fn get_accessibility_support_features() -> &'static [&'static str] {
        match surfaces::has_screen_reader() {
            true => &[
                "nativeAPIs",
                "webContents",
                "inlineTextBoxes",
                "extendedProperties",
                "screenReader",
            ],
            false => &[],
        }
    }

    pub(crate) fn when_ready(_: Cx<'_, '_>) -> JsResult<JSValue> {
        state().is_awaited.set(true);
        if !is_electron() {
            start_soon()?;
        }
        Ok(ready())
    }

    pub(crate) fn is_ready() -> bool {
        is_ready()
    }

    /// The name, the paths and the switches are final: what `ready` waits for can begin while the app is being loaded.
    pub(crate) fn prepare(_: Cx<'_, '_>) -> JsResult<()> {
        start_soon()?;
        load_key(|| Ok(()))
    }

    pub(crate) fn quit(_: Cx<'_, '_>) -> JsResult<()> {
        quit()
    }

    pub(crate) fn exit(_: Cx<'_, '_>, code: i32) -> JsResult<()> {
        exit(code)
    }

    pub(crate) fn relaunch(_: Cx<'_, '_>, options: Option<&RelaunchOptions>) -> JsResult<()> {
        let arguments: Vec<String> = match options.and_then(|it| it.args.as_ref()) {
            Some(given) => strings(Some(given)).collect(),
            None => {
                let before = if is_electron() && Self::get_is_packaged() {
                    1
                } else {
                    2
                };
                process::arguments()?.into_iter().skip(before).collect()
            }
        };
        relaunch_with(command(
            options.and_then(|it| it.exec_path.as_deref()),
            arguments.into_iter(),
        )?)
    }

    pub(crate) fn focus(_: Cx<'_, '_>, options: Option<&AppFocusOptions>) -> JsResult<()> {
        activate(options.is_some_and(|it| it.steal))
    }

    pub(crate) fn hide(_: Cx<'_, '_>) -> JsResult<()> {
        hide()
    }

    pub(crate) fn show(_: Cx<'_, '_>) -> JsResult<()> {
        state().is_hidden.set(false);
        tell_system(SystemCommand::Activate {
            steals_focus: false,
        })
    }

    pub(crate) fn is_hidden(_: Cx<'_, '_>) -> JsResult<bool> {
        if IS_MAC {
            answer((ui()?.is_hidden)())
        } else {
            Ok(state().is_hidden.get())
        }
    }

    pub(crate) fn is_active() -> bool {
        window::focused().is_some()
    }

    pub(crate) fn get_version(_: Cx<'_, '_>) -> JsResult<&'static str> {
        Ok(&paths::manifest()?.version)
    }

    pub(crate) fn get_app_path(_: Cx<'_, '_>) -> JsResult<&'static str> {
        path()
    }

    fn path() -> JsResult<&'static str> {
        let root = &paths::manifest()?.root;
        if !is_electron() || !Self::get_is_packaged() {
            return Ok(root);
        }
        Ok(state().app_path.get_or_init(|| {
            let found = ["app.asar", "app"].map(|it| files::join(&[root, it]));
            let found = found.into_iter().find(|it| files::exists(it));
            let path = found.unwrap_or_else(|| root.clone());
            compiled::set_app_path(path.as_bytes());
            path
        }))
    }

    pub(crate) fn get_path(_: Cx<'_, '_>, name: &[u8]) -> JsResult<String> {
        if name == b"userData" && !paths::is_set("userData") {
            paths::make_data_directories()?;
        }
        paths::path(&string(name))
    }

    pub(crate) fn set_path(_: Cx<'_, '_>, name: &[u8], path: &[u8]) -> JsResult<()> {
        paths::set_path(&string(name), string(path))
    }

    pub(crate) fn set_app_logs_path(_: Cx<'_, '_>, path: Option<&[u8]>) -> JsResult<()> {
        if let Some(path) = path {
            paths::set_path("logs", string(path))?;
        }
        files::or_throw(files::make_directory(&paths::path("logs")?, 0o777))
    }

    pub(crate) fn is_in_applications_folder() -> bool {
        is_in_applications_folder()
    }

    pub(crate) fn move_to_applications_folder<'a>(
        _: Cx<'a, '_>,
        options: JsLocal<'a>,
    ) -> JsResult<bool> {
        updater::move_to_applications(match options.to_js() {
            options if options.is_object() => get(options, "conflictHandler")?,
            _ => JSValue::UNDEFINED,
        })
    }

    pub(crate) fn get_locale(_: Cx<'_, '_>) -> JsResult<&'static str> {
        locale()
    }

    pub(crate) fn get_system_locale(_: Cx<'_, '_>) -> JsResult<&'static str> {
        system_locale()
    }

    pub(crate) fn get_locale_country_code(_: Cx<'_, '_>) -> JsResult<String> {
        country()
    }

    pub(crate) fn get_preferred_system_languages(_: Cx<'_, '_>) -> JsResult<Vec<String>> {
        languages()
    }

    pub(crate) fn set_app_user_model_id(_: Cx<'_, '_>, id: &[u8]) -> JsResult<()> {
        set_identifier(&string(id))
    }

    pub(crate) fn set_desktop_name(_: Cx<'_, '_>, name: &[u8]) -> JsResult<()> {
        state().desktop_name.replace(Some(string(name)));
        set_identifier(&string(name.strip_suffix(b".desktop").unwrap_or(name)))
    }

    pub(crate) fn get_desktop_name(_: Cx<'_, '_>) -> JsResult<JSValue> {
        bun_ui::value::or_undefined(state().desktop_name.borrow().as_deref(), global())
    }

    pub(crate) fn set_activation_policy(_: Cx<'_, '_>, policy: &[u8]) -> JsResult<()> {
        set_accessory(policy != b"regular")
    }

    pub(crate) fn set_badge_count(_: Cx<'_, '_>, count: Option<f64>) -> JsResult<bool> {
        state().badge_count.set(count.unwrap_or(0.));
        match count {
            None => set_badge("•"),
            Some(0.) => set_badge(""),
            Some(count) => set_badge(&count.to_string()),
        }
        .map(|()| true)
    }

    pub(crate) fn get_badge_count() -> f64 {
        state().badge_count.get()
    }

    pub(crate) fn add_recent_document(_: Cx<'_, '_>, path: &[u8]) -> JsResult<()> {
        let path = files::absolute(&string(path));
        let mut recent = state().recent_documents.borrow_mut();
        recent.retain(|it| *it != path);
        recent.insert(0, path.clone());
        drop(recent);
        tell_system(SystemCommand::AddRecentDocument(path.into()))
    }

    pub(crate) fn clear_recent_documents(_: Cx<'_, '_>) -> JsResult<()> {
        clear_recent_documents()
    }

    pub(crate) fn get_recent_documents() -> Vec<String> {
        state().recent_documents.borrow().clone()
    }

    pub(crate) fn set_about_panel_options(options: &AboutPanelOptions) {
        let own = |it: &Option<bun_core::Utf8Bytes<'static>>| it.as_deref().map(string);
        state().about.replace(About {
            name: own(&options.application_name),
            version: own(&options.application_version),
            credits: own(&options.credits),
            copyright: own(&options.copyright),
        });
    }

    pub(crate) fn show_about_panel(_: Cx<'_, '_>) -> JsResult<JSValue> {
        show_about_panel()
    }

    pub(crate) fn show_emoji_panel(_: Cx<'_, '_>) -> JsResult<()> {
        window::focused().map_or(Ok(()), |it| it.tell(WindowCommand::CharacterPalette))
    }

    pub(crate) fn is_emoji_panel_supported() -> bool {
        IS_MAC
    }

    pub(crate) fn request_single_instance_lock<'a>(
        _: Cx<'a, '_>,
        data: JsLocal<'a>,
    ) -> JsResult<bool> {
        single_instance::request(if data.is_undefined() {
            object!({})
        } else {
            data.to_js()
        })
    }

    pub(crate) fn has_single_instance_lock() -> bool {
        single_instance::is_held()
    }

    pub(crate) fn release_single_instance_lock() {
        single_instance::release();
    }

    pub(crate) fn set_as_default_protocol_client<'a>(
        _: Cx<'a, '_>,
        protocol: JsLocal<'a>,
        path: Option<&[u8]>,
        arguments: Option<Texts>,
    ) -> JsResult<bool> {
        let scheme = scheme_of(protocol)?;
        if IS_MAC {
            let request = Request::System(SystemRequest::RegisterUrlScheme(scheme.into()));
            queue::request(global(), request, |_, reply| match reply {
                bun_ui::protocol::Reply::Failed(reason) => warn(&reason),
                _ => Ok(()),
            })?;
            return Ok(true);
        }
        let (kind, installed) = (
            format!("x-scheme-handler/{scheme}"),
            xdg::installed_entry()?,
        );
        if path.is_none() && xdg::is_installed(&installed)? {
            return xdg::set_default_application(&installed, &kind);
        }
        let command = command(path, strings(arguments.filter(|_| path.is_some())))?;
        let entry = xdg::handler_entry(&scheme)?;
        xdg::write_entry(
            &files::join(&[&xdg::own_applications()?, &entry]),
            &format!("{} %u", xdg::exec(&command)),
            &format!("NoDisplay=true\nMimeType={kind};\n"),
        )?;
        xdg::set_default_application(&entry, &kind)
    }

    pub(crate) fn is_default_protocol_client<'a>(
        _: Cx<'a, '_>,
        protocol: JsLocal<'a>,
    ) -> JsResult<bool> {
        let scheme = scheme_of(protocol)?;
        if IS_MAC {
            let found = answer((ui()?.application_for)(format!("{scheme}://").into()))?.get();
            return Ok(found.map(|it| it.bundle.into_string()) == Some(paths::identifier()?));
        }
        let entry = xdg::default_application(&format!("x-scheme-handler/{scheme}"))?;
        Ok(entry == Some(xdg::handler_entry(&scheme)?) || entry == Some(xdg::installed_entry()?))
    }

    pub(crate) fn remove_as_default_protocol_client<'a>(
        cx: Cx<'a, '_>,
        protocol: JsLocal<'a>,
    ) -> JsResult<bool> {
        if IS_MAC || !Self::is_default_protocol_client(cx, protocol)? {
            return Ok(false);
        }
        files::remove(&files::join(&[
            &xdg::own_applications()?,
            &xdg::handler_entry(&scheme_of(protocol)?)?,
        ]));
        Ok(true)
    }

    pub(crate) fn get_application_name_for_protocol(_: Cx<'_, '_>, url: &[u8]) -> JsResult<String> {
        let url = string(url);
        let name = match IS_MAC {
            true => answer((ui()?.application_for)(url.into()))?
                .get()
                .map(|it| it.name.into_string()),
            false => xdg::name_of_default_application(&format!(
                "x-scheme-handler/{}",
                text::before(&url, ":")
            ))?,
        };
        Ok(name.unwrap_or_default())
    }

    pub(crate) fn get_application_info_for_protocol(
        _: Cx<'_, '_>,
        url: &[u8],
    ) -> JsResult<JSValue> {
        let found = match IS_MAC {
            true => (answer((ui()?.application_for)(Text::lossy(url)))?.get())
                .map(|it| [it.name.into_string(), it.path.into_string()]),
            false => xdg::handler_of(text::before(&string(url), ":"))?,
        };
        let Some([name, path]) = found else {
            return Err(error(format_args!(
                "Unable to retrieve installation path to app"
            )));
        };
        resolved(object!({ "name": name, "path": &*path, "icon": file_icon(&path, 64)? }))
    }

    pub(crate) fn get_file_icon(
        _: Cx<'_, '_>,
        path: &[u8],
        options: Option<&FileIconOptions>,
    ) -> JsResult<JSValue> {
        let is_small = options.is_some_and(|it| it.size.as_deref() == Some(b"small"));
        resolved(file_icon(&string(path), if is_small { 32 } else { 64 })?)
    }

    pub(crate) fn get_login_item_settings(_: Cx<'_, '_>) -> JsResult<JSValue> {
        if IS_MAC {
            return Ok(js_DesktopLoginItemSettings::create(heap(), Default::default()).to_js());
        }
        let opens = files::exists(&xdg::autostart_entry()?);
        Ok(object!({
            "executableWillLaunchAtLogin": opens,
            "openAtLogin": opens,
            "wasOpenedAtLogin": false,
        }))
    }

    pub(crate) fn set_login_item_settings(
        _: Cx<'_, '_>,
        settings: &LoginItemOptions,
    ) -> JsResult<()> {
        if IS_MAC {
            return perform(SystemCommand::OpenAtLogin(settings.open_at_login));
        }
        let (path, arguments) = (settings.path.as_deref(), strings(settings.args.as_ref()));
        if !settings.open_at_login {
            files::remove(&xdg::autostart_entry()?);
            return Ok(());
        }
        let command = command(path, arguments)?;
        xdg::write_entry(&xdg::autostart_entry()?, &xdg::exec(&command), "")
    }

    pub(crate) fn get_fonts(_: Cx<'_, '_>) -> JsResult<Vec<Text>> {
        Ok(answer((bun_ui::renderer(global())?.font_families)())?.into_vec())
    }

    pub(crate) fn disable_hardware_acceleration() {
        command_line::set("disable-gpu", "");
    }

    pub(crate) fn is_hardware_acceleration_enabled() -> bool {
        command_line::switch("disable-gpu").is_none()
    }

    pub(crate) fn get_gpu_feature_status(_: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(
            object!({ "gpu_compositing": "enabled", "webgl": "unavailable_off", "webgpu": "unavailable_off" }),
        )
    }

    pub(crate) fn get_gpu_info(_: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved(object!({ "auxAttributes": object!({}), "gpuDevice": array(&[])? }))
    }

    pub(crate) fn get_app_metrics(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let own = object!({
            "pid": process::id(),
            "type": "Browser",
            "cpu": process::cpu_usage()?,
            "creationTime": process::creation_time(),
            "memory": process::memory()?,
        });
        let all = array(&[own])?;
        for (id, creation_time) in crate::contents::process::ids() {
            let tab = utility::metrics(js(id)?, "", creation_time)?;
            tab.put(global(), b"type", js("Tab")?);
            for name in ["name", "serviceName"] {
                tab.delete_property(global(), name)?;
            }
            all.push(global(), tab)?;
        }
        utility::add_metrics_to(all)?;
        if let Some(engine) = engine::running() {
            all.push(
                global(),
                utility::metrics(engine.pid()?, "Web Engine", engine.creation_time)?,
            )?;
            engine.measure();
            (engine.metrics.borrow().items().iter())
                .try_for_each(|it| all.push(global(), js(it)?))?;
        }
        Ok(all)
    }

    pub(crate) fn enable_sandbox(_: Cx<'_, '_>) -> JsResult<()> {
        if is_ready() {
            return Err(error(format_args!(
                "app.enableSandbox() can only be called before app is ready"
            )));
        }
        match crate::contents::place::enable_sandbox() {
            true => Ok(()),
            false => Err(unsupported("enableSandbox")),
        }
    }

    pub(crate) fn set_user_activity<'a>(
        _: Cx<'a, '_>,
        kind: &[u8],
        info: JsLocal<'a>,
        url: Option<&[u8]>,
    ) -> JsResult<()> {
        state().activity.replace(string(kind));
        tell_system(SystemCommand::BeginActivity {
            kind: Text::lossy(kind),
            info: preferences::property_list(info.to_js())?,
            url: Text::lossy(url.unwrap_or_default()),
        })
    }

    pub(crate) fn update_current_activity<'a>(
        _: Cx<'a, '_>,
        kind: &[u8],
        info: JsLocal<'a>,
    ) -> JsResult<()> {
        if state().activity.borrow().as_bytes() != kind {
            return Ok(());
        }
        let info = preferences::property_list(info.to_js())?;
        tell_system(SystemCommand::UpdateActivity(info))
    }

    pub(crate) fn resign_current_activity(_: Cx<'_, '_>) -> JsResult<()> {
        tell_system(SystemCommand::ResignActivity)
    }

    pub(crate) fn set_secure_keyboard_entry_enabled(_: Cx<'_, '_>, on: bool) -> JsResult<()> {
        state().has_secure_input.set(on);
        tell_system(SystemCommand::SecureInput(on))
    }

    pub(crate) fn is_secure_keyboard_entry_enabled() -> bool {
        state().has_secure_input.get()
    }

    pub(crate) fn get_current_activity_type() -> String {
        state().activity.borrow().clone()
    }

    pub(crate) fn invalidate_current_activity(_: Cx<'_, '_>) -> JsResult<()> {
        if state().activity.take().is_empty() {
            return Ok(());
        }
        tell_system(SystemCommand::InvalidateActivity)
    }

    pub(crate) fn get_jump_list_settings(_: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(object!({ "minItems": 0, "removedItems": array(&[])? }))
    }

    pub(crate) fn set_jump_list() -> &'static str {
        "error"
    }

    pub(crate) fn start_accessing_security_scoped_resource(_: Cx<'_, '_>) -> JsResult<JSValue> {
        procedure(|_| Ok(()))
    }

    pub(crate) fn resolve_proxy<'a>(cx: Cx<'a, '_>, url: JsLocal<'a>) -> JsResult<JSValue> {
        session::default()?.resolve_proxy(cx, text_of(url.to_js())?.as_bytes())
    }

    pub(crate) fn set_proxy<'a>(_: Cx<'a, '_>, _: JsLocal<'a>) -> JsResult<JSValue> {
        resolved(JSValue::UNDEFINED)
    }

    pub(crate) fn set_web_engine<'a>(_: Cx<'a, '_>, engine: JsLocal<'a>) -> JsResult<()> {
        engine::choose(engine.to_js())
    }

    pub(crate) fn set_compiled_scripts<'a>(
        _: Cx<'a, '_>,
        roots: JsLocal<'a, JSObject>,
        options: &CompiledScriptsOptions<'a>,
    ) -> JsResult<()> {
        let mut pairs = Vec::new();
        for url in texts_of(roots.to_js().keys(global())?)? {
            let directory = text_of(get_by_value(global(), roots.to_js(), js(&*url)?)?)?;
            pairs.push((url.as_bytes().into(), directory.as_bytes().into()));
        }
        compiled::extend(
            pairs.into_iter(),
            options.exclusive,
            options.source.is_some(),
        );
        if let Some(source) = options.source {
            state().source_of.set(keep(source.to_js()));
        }
        crate::contents::process::statics_changed()
    }

    pub(crate) fn import_certificate<'a>(
        _: Cx<'a, '_>,
        options: JsLocal<'a>,
        callback: JsLocal<'a>,
    ) -> JsResult<()> {
        let options = wire::data_from_js(options.to_js())?;
        let path = options["certificate"].display();
        let password = bun_core::ZBox::from_bytes(options["password"].text().as_bytes());
        let callback = keep(callback.to_js());
        in_background(
            move || files::read(&path).is_some_and(|it| import_pkcs12(&it, &password)),
            move |is_imported| {
                call(callback.get(), &[if is_imported { 0 } else { -702 }.into()]).map(drop)
            },
        );
        Ok(())
    }

    pub(crate) fn trust_origins(origins: Vec<Utf8Bytes<'static>>, options: &TrustOptions) {
        let owned = |list: &[Utf8Bytes<'_>]| list.iter().map(|it| (**it).into()).collect();
        trust::extend(Trust {
            origins: origins.into_iter().map(|it| (*it).into()).collect(),
            except: owned(options.except.as_deref().unwrap_or_default()),
            except_when_loaded: owned(options.except_when_loaded.as_deref().unwrap_or_default()),
            in_frames: match &options.in_frames {
                Some(FramesToTrust::Urls(urls)) => owned(urls),
                _ => Vec::new(),
            },
            in_all_frames: matches!(options.in_frames, Some(FramesToTrust::All(true))),
            injected_scripts: options.injected_scripts,
        });
        crate::task::report(crate::contents::process::statics_changed());
    }
}

pub(crate) fn source_of(url: JSValue) -> JsResult<JSValue> {
    (state().source_of.get()).map_or(Ok(JSValue::UNDEFINED), |it| call(it, &[url]))
}

pub(crate) fn clear_recent_documents() -> JsResult<()> {
    state().recent_documents.take();
    if IS_MAC {
        tell_system(SystemCommand::SendAction("clearRecentDocuments:".into()))
    } else {
        Ok(())
    }
}

impl DesktopLoginItemSettings {
    pub(crate) fn get_open_at_login(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        answer((ui()?.opens_at_login)())
    }

    pub(crate) fn get_status(&self, cx: Cx<'_, '_>) -> JsResult<&'static str> {
        Ok(if self.get_open_at_login(cx)? {
            "enabled"
        } else {
            "not-registered"
        })
    }
}

impl DesktopDock {
    pub(crate) fn download_finished(_: Cx<'_, '_>, path: &[u8]) -> JsResult<()> {
        let (center, name) = (
            NotificationCenter::Distributed,
            b"com.apple.DownloadFileFinished",
        );
        preferences::post(center, name, path, JSValue::UNDEFINED, false)
    }

    pub(crate) fn set_icon<'a>(_: Cx<'a, '_>, image: JsLocal<'a>) -> JsResult<()> {
        let icon = match image.to_js().is_null() {
            true => Default::default(),
            false => NativeImage::with(global(), image.to_js(), |it| it.icon(global()))?,
        };
        tell_system(SystemCommand::DockIcon(icon))
    }

    pub(crate) fn set_badge(_: Cx<'_, '_>, text: &[u8]) -> JsResult<()> {
        state().badge.replace(string(text));
        set_badge(&string(text))
    }

    pub(crate) fn get_badge() -> String {
        state().badge.borrow().clone()
    }

    pub(crate) fn bounce(_: Cx<'_, '_>, kind: Option<&[u8]>) -> JsResult<i32> {
        answer((ui()?.bounce)(kind == Some(b"critical")))
    }

    pub(crate) fn cancel_bounce(_: Cx<'_, '_>, id: i32) -> JsResult<()> {
        tell_system(SystemCommand::CancelBounce(id))
    }

    pub(crate) fn hide(_: Cx<'_, '_>) -> JsResult<()> {
        set_accessory(true)
    }

    pub(crate) fn show(_: Cx<'_, '_>) -> JsResult<JSValue> {
        set_accessory(false)?;
        resolved(JSValue::UNDEFINED)
    }

    pub(crate) fn is_visible() -> bool {
        !state().is_accessory.get()
    }

    pub(crate) fn set_menu(_: Cx<'_, '_>, menu: Option<&Menu>) -> JsResult<()> {
        state()
            .dock_menu
            .set(keep(menu.map_or(JSValue::NULL, Menu::to_js)));
        menu::attach(Slot::Dock, menu)
    }

    pub(crate) fn get_menu(_: &JsHeap<'_>) -> JSValue {
        state().dock_menu.get().unwrap_or(JSValue::NULL)
    }
}
