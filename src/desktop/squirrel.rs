//! `autoUpdater` for an app that Squirrel.Windows has installed.

use crate::generated_bindgen::electron::{ElectronAutoUpdater, js_ElectronAutoUpdater};
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::value::Value;
use crate::webview::wire;
use crate::{app, files, process};

#[derive(Default)]
struct State {
    feed: RefCell<String>,
    has_update: Cell<bool>,
    is_running: Cell<bool>,
}

state!(fn state() -> State);

fn object() -> JSValue {
    js_ElectronAutoUpdater::CLASS.constructor(heap())
}

fn fail(message: &str) -> JsResult<()> {
    let error = global().take_error(error(format_args!("{message}")));
    emit(object(), "error", &[error, js(message)?])
}

fn updater() -> String {
    files::join(&[&process::executable(), "../../Update.exe"])
}

/// `next` gets what it has printed.
fn run(arguments: [&str; 2], next: impl Fn(&str) -> JsResult<()> + 'static) -> JsResult<()> {
    if state().is_running.replace(true) {
        return fail("AutoUpdater process is already running");
    }
    let done = procedure(move |it| {
        state().is_running.set(false);
        let failure = argument(it, 0);
        if failure.is_empty_or_undefined_or_null() {
            return next(&text_of(argument(it, 1))?);
        }
        let signal = get(failure, "signal")?;
        let how = match signal.is_string() {
            true => signal,
            false => get(failure, "code")?,
        };
        let [how, said] = [how, argument(it, 2)].map(text_of);
        fail(&format!("Command failed: {}\n{}", how?, said?))
    })?;
    let how = object!({ "windowsHide": true, "maxBuffer": f64::INFINITY });
    invoke(
        realm::require(global(), Module::ChildProcess)?,
        "execFile",
        &[js(updater())?, js(arguments)?, how, done],
    )
    .map(drop)
}

fn found(feed: String, printed: &str) -> JsResult<()> {
    let last = crate::text::split(printed.trim(), "\n").last();
    let release = match last.filter(|it| !it.is_empty()) {
        None => None,
        Some(line) => match Value::parse(line.as_bytes()) {
            Some(it) => it["releasesToApply"].items().last().cloned(),
            None => return fail(&format!("Invalid result:\n{printed}")),
        },
    };
    let Some(release) = release else {
        return emit(object(), "update-not-available", &[]);
    };
    emit(object(), "update-available", &[])?;
    run(["--update", &feed.clone()], move |_| {
        state().has_update.set(true);
        let now = bun_core::time::milli_timestamp() as f64;
        let details = [
            js(release["releaseNotes"].text())?,
            js(release["version"].text())?,
            JSValue::from_date_number(global(), now),
            js(&*feed)?,
            procedure(|_| quit_and_install())?,
        ];
        announce(object(), "update-downloaded", &details)
    })
}

fn quit_and_install() -> JsResult<()> {
    if !state().has_update.get() {
        return fail("No update available, can't quit and install");
    }
    let name = files::name(&process::executable()).to_owned();
    let command = [updater(), "--processStartAndWait".into(), name];
    process::start(&command, &process::environment("")?);
    app::quit()
}

pub(crate) fn all_windows_closed() -> JsResult<()> {
    Ok(())
}

pub(crate) fn move_to_applications(_: JSValue) -> JsResult<bool> {
    Err(unsupported("moveToApplicationsFolder"))
}

impl ElectronAutoUpdater {
    pub(crate) fn set_feed_url<'a>(
        _: Cx<'a, '_>,
        options: JsLocal<'a>,
        _: JsLocal<'a>,
    ) -> JsResult<()> {
        let options = wire::data_from_js(options.to_js())?;
        let Some(url) = options.as_text().or_else(|| options["url"].as_text()) else {
            return Err(type_error(match options.is_object() {
                true => format_args!(
                    "Expected options object to contain a 'url' string property in setFeedUrl call"
                ),
                false => {
                    format_args!("Expected an options object with a 'url' property to be provided")
                }
            }));
        };
        state().feed.replace(url.into());
        Ok(())
    }

    pub(crate) fn get_feed_url() -> String {
        state().feed.borrow().clone()
    }

    pub(crate) fn check_for_updates(_: Cx<'_, '_>) -> JsResult<()> {
        let feed = Self::get_feed_url();
        if feed.is_empty() {
            return fail("Update URL is not set");
        }
        if !files::exists(&updater()) {
            return fail("Can not find Squirrel");
        }
        emit(object(), "checking-for-update", &[])?;
        run(["--checkForUpdate", &feed.clone()], move |it| {
            found(feed.clone(), it)
        })
    }

    pub(crate) fn quit_and_install(_: Cx<'_, '_>) -> JsResult<()> {
        quit_and_install()
    }
}
