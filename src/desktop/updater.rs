//! `autoUpdater` and `app.moveToApplicationsFolder()`, for an app bundle. The feeds and the errors are Squirrel.Mac's.

use bun_ui::protocol::{Request, SystemRequest};
use bun_web::exec::blocking;
use bun_web::headers::HeaderList;

use crate::bundle::{self, Refusal};
use crate::generated_bindgen::electron::{ElectronAutoUpdater, js_ElectronAutoUpdater};
use crate::prelude::*;
use crate::session::load::from_record;
use crate::session::updates::{read_url, save_url};
use crate::text::random_bytes;
use crate::value::Value;
use crate::webview::wire;
use crate::{app, files, paths, process, task, window};

const LATER: &str = "Update check failed. The server sent an invalid response. Try again later.";

#[derive(Clone)]
struct Feed {
    url: String,
    headers: HeaderList,
    lists_releases: bool,
}

#[derive(Default)]
struct State {
    feed: RefCell<Option<Feed>>,
    /// What the signature of an update has to satisfy.
    requirement: RefCell<String>,
    /// The directory that has it.
    staged: RefCell<Option<String>>,
    is_checking: Cell<bool>,
    relaunches: Cell<bool>,
    waits_for_windows: Cell<bool>,
    moved_to: RefCell<Option<String>>,
    for_exit: RefCell<Option<ForExit>>,
}

/// No script runs then.
struct ForExit {
    log: String,
    prompt: String,
}

state!(fn state() -> State);

struct Failure {
    message: String,
    kind: Option<(&'static str, i32)>,
}

impl Failure {
    fn of_updater(code: i32, message: &str) -> Failure {
        Failure {
            message: message.into(),
            kind: Some(("SQRLUpdaterErrorDomain", code)),
        }
    }

    fn emit(&self) -> JsResult<()> {
        let error = global().take_error(error(format_args!("{}", self.message)));
        if let Some((domain, code)) = self.kind {
            assign(error, "code", code.into())?;
            assign(error, "domain", js(domain)?)?;
        }
        emit(object(), "error", &[error, js(&*self.message)?])
    }
}

impl From<String> for Failure {
    fn from(message: String) -> Failure {
        Failure {
            message,
            kind: None,
        }
    }
}

impl From<Refusal> for Failure {
    fn from(refusal: Refusal) -> Failure {
        let (domain, code, message) = refusal.describe();
        Failure {
            message,
            kind: Some((domain, code)),
        }
    }
}

fn object() -> JSValue {
    js_ElectronAutoUpdater::CLASS.constructor(heap())
}

fn cache() -> JsResult<String> {
    let name = format!("{}.ShipIt", paths::identifier()?);
    Ok(files::join(&[&paths::home()?, "Library/Caches", &name]))
}

/// Returns what the last one has printed.
fn run_as_root(prompt: &str, commands: &[&[&str]]) -> Result<String, String> {
    let command = |it: &&[&str]| it.iter().map(|it| Text::from(*it)).collect();
    let ui = bun_ui::loaded().ok_or_else(String::new)?;
    let said = (ui.run_as_root)(prompt.into(), commands.iter().map(command).collect());
    said.get().map(Text::into_string).map_err(Text::into_string)
}

async fn find_update(feed: &Feed) -> Result<Option<Value>, Failure> {
    let (status, body) = read_url(&feed.url, feed.headers.clone()).await?;
    if bundle::own().is_some_and(|it| bundle::is_on_read_only_volume(&it)) {
        return Err(Failure::of_updater(
            8,
            "Cannot update while running on a read-only volume. Please move the application and try again.",
        ));
    }
    match status {
        204 => return Ok(None),
        200..=299 => {}
        _ => return Err(Failure::of_updater(5, LATER)),
    }
    let mut update = Value::parse(&body).ok_or_else(|| Failure::of_updater(7, LATER))?;
    if let Some(current) = update["currentRelease"].as_text()
        && feed.lists_releases
    {
        let running = paths::manifest().map_or("", |it| &it.version);
        if !bundle::is_newer(current, running) {
            return Ok(None);
        }
        let mut releases = update["releases"].items().iter();
        if let Some(release) = releases.find(|it| it["version"].is(current)) {
            update = release["updateTo"].clone();
        }
    }
    if update["url"].text().is_empty() {
        return Err(Failure::of_updater(
            6,
            "Update check failed. The server sent an invalid JSON response. Try again later.",
        ));
    }
    Ok(Some(update))
}

async fn stage(update: &Value, directory: &str) -> Result<(), Failure> {
    let unprepared = || Failure::of_updater(3, "Could not prepare the update");
    files::make_directory(directory, 0o700).map_err(|_| unprepared())?;
    let archive = bundle::archive_in(directory);
    let (status, size, digest) = save_url(update["url"].text(), &archive).await?;
    if !(200..=299).contains(&status) {
        return Err(Failure::of_updater(
            5,
            "Update download failed. The server sent an invalid response. Try again later.",
        ));
    }
    let digest = bun_core::fmt::bytes_to_hex_lower_string(&digest);
    if (update["size"].as_number()).is_some_and(|it| it != size as f64)
        || (update["sha256"].as_text()).is_some_and(|it| !it.eq_ignore_ascii_case(&digest))
    {
        return Err(Failure::of_updater(
            9,
            "Update download failed. It is not what the server has described. Try again later.",
        ));
    }
    let (directory, requirement) = (directory.to_owned(), state().requirement.borrow().clone());
    let bundle = bundle::own().unwrap_or_default();
    let unpacked = blocking(move || bundle::unpack(&directory, &bundle, &requirement));
    Ok(unpacked.await.ok_or_else(unprepared)??)
}

async fn check(feed: Feed, cache: String) -> JsResult<()> {
    announce(object(), "checking-for-update", &[])?;
    let directory = format!("{cache}/update.{:x}", u64::from_ne_bytes(random_bytes()));
    let found = async {
        let Some(update) = find_update(&feed).await? else {
            return Ok(None);
        };
        task::report(announce(object(), "update-available", &[]));
        stage(&update, &directory).await?;
        Ok::<_, Failure>(Some(update))
    };
    let found = found.await;
    state().is_checking.set(false);
    if let Ok(Some(_)) = &found {
        state().staged.replace(Some(directory));
        finish_at_exit()?;
    }
    let staged = state().staged.borrow().clone().unwrap_or_default();
    for name in files::names_in(&cache) {
        let other = format!("{cache}/{name}");
        if name.starts_with("update.") && staged != other {
            in_background(move || files::remove_all(&other), |()| Ok(()));
        }
    }
    let update = match found {
        Err(failure) => return failure.emit(),
        Ok(None) => return announce(object(), "update-not-available", &[]),
        Ok(Some(update)) => update,
    };
    let date = bun_core::String::clone_utf8(update["pub_date"].text().as_bytes());
    let date = bun_jsc::bun_string_jsc::parse_date(&date, global())?;
    let details = [
        js(update["notes"].text())?,
        js(update["name"].text())?,
        JSValue::from_date_number(global(), if date.is_nan() { 0. } else { date }),
        js(update["url"].text())?,
    ];
    announce(object(), "update-downloaded", &details)
}

fn install(staged: &str, bundle: &str, it: &ForExit) {
    let needs_root = bundle::is_beyond_user(bundle);
    if !files::exists(staged) || (needs_root && !state().relaunches.get()) {
        return;
    }
    bundle::log(&it.log, "Beginning installation");
    let result = if needs_root {
        let (executable, id) = (process::executable(), process::id().to_string());
        let said = run_as_root(&it.prompt, &[&[&executable, bundle::INSTALL, staged, &id]]);
        said.and_then(|it| if it == "done" { Ok(()) } else { Err(it) })
    } else {
        bundle::install(
            staged,
            &state().requirement.take(),
            process::id(),
            bundle::user(),
            false,
        )
        .map_err(|it| it.describe_for_log())
    };
    match result {
        Ok(()) => bundle::log(&it.log, "Installation completed successfully"),
        Err(why) => bundle::log(&it.log, &format!("Installation error: {why}")),
    }
    files::remove_all(staged);
}

/// The system lets an app change its own bundle, so this is done while it is still there.
fn finish_at_exit() -> JsResult<()> {
    state().for_exit.replace(Some(ForExit {
        log: files::join(&[&cache()?, "ShipIt_stderr.log"]),
        prompt: format!("{} is trying to install an update.", paths::app_name()?),
    }));
    process::at_exit(|| {
        let (Some(it), Some(bundle)) = (state().for_exit.take(), bundle::own()) else {
            return;
        };
        if let Some(destination) = state().moved_to.take() {
            match bundle::image_with(&bundle) {
                Some(device) => bundle::run_when_gone(&["hdiutil", "detach"], &device),
                None => bundle::remove(&bundle),
            }
            return bundle::run_when_gone(&["open"], &destination);
        }
        if let Some(staged) = state().staged.take() {
            install(&staged, &bundle, &it);
        }
        if state().relaunches.get() {
            bundle::run_when_gone(&["open"], &bundle);
        }
    });
    Ok(())
}

pub(crate) fn all_windows_closed() -> JsResult<()> {
    match state().waits_for_windows.take() {
        true => quit_and_install(),
        false => Ok(()),
    }
}

fn quit_and_install() -> JsResult<()> {
    announce(object(), "before-quit-for-update", &[])?;
    let has_update = state().staged.borrow().is_some();
    state().relaunches.set(has_update);
    let windows = window::of_app();
    if !windows.is_empty() {
        state().waits_for_windows.set(true);
        return windows.iter().try_for_each(|it| it.get().request_close());
    }
    if has_update {
        return app::quit();
    }
    match IS_MAC || bundle::own().is_some() {
        true => Failure::from("No update available, can't quit and install".to_owned()).emit(),
        false => Ok(()),
    }
}

impl ElectronAutoUpdater {
    pub(crate) fn set_feed_url<'a>(
        _: Cx<'a, '_>,
        options: JsLocal<'a>,
        headers: JsLocal<'a>,
    ) -> JsResult<()> {
        let bundle = bundle::own();
        if !IS_MAC && bundle.is_none() {
            return Ok(());
        }
        let options = match wire::data_from_js(options.to_js())? {
            url if url.as_text().is_some() => {
                record! { "url": url, "headers": wire::data_from_js(headers.to_js())? }
            }
            options if options.is_object() => options,
            _ => {
                return Err(type_error(format_args!(
                    "Expected an options object with a 'url' property to be provided"
                )));
            }
        };
        if options["url"].text().is_empty() {
            return Err(type_error(format_args!(
                "Expected options object to contain a 'url' string property in setFeedUrl call"
            )));
        }
        let kind = options["serverType"].as_text().unwrap_or("default");
        if !matches!(kind, "default" | "json") {
            return Err(error(format_args!(
                "Expected serverType to be 'default' or 'json'"
            )));
        }
        if let Some(bundle) = bundle.filter(|_| state().requirement.borrow().is_empty()) {
            let requirement = bundle::requirement(&bundle);
            state().requirement.replace(requirement.unwrap_or_default());
        }
        if state().requirement.borrow().is_empty() {
            return Err(error(format_args!(
                "Could not get code signature for running application"
            )));
        }
        let mut headers = from_record(&options["headers"]);
        headers.set(b"accept", b"application/json");
        state().feed.replace(Some(Feed {
            url: options["url"].text().into(),
            headers,
            lists_releases: kind == "json",
        }));
        Ok(())
    }

    pub(crate) fn get_feed_url() -> String {
        (state().feed.borrow().as_ref()).map_or_else(String::new, |it| it.url.clone())
    }

    pub(crate) fn check_for_updates(_: Cx<'_, '_>) -> JsResult<()> {
        let Some(feed) = state().feed.borrow().clone() else {
            return match IS_MAC || bundle::own().is_some() {
                true => Failure::from("Update URL is not set".to_owned()).emit(),
                false => Ok(()),
            };
        };
        if state().is_checking.replace(true) {
            let failure = Failure {
                message: "The command is disabled and cannot be executed".into(),
                kind: Some(("RACCommandErrorDomain", 1)),
            };
            later::soon(move |_| failure.emit());
            return Ok(());
        }
        let cache = cache()?;
        later::soon(|_| {
            task::spawn(async { task::report(check(feed, cache).await) });
            Ok(())
        });
        Ok(())
    }

    pub(crate) fn quit_and_install(_: Cx<'_, '_>) -> JsResult<()> {
        quit_and_install()
    }
}

fn trash(path: &str) -> JsResult<()> {
    let request = Request::System(SystemRequest::Trash(path.into()));
    bun_ui::queue::request_and_wait(global(), request).map(drop)
}

pub(crate) fn move_to_applications(conflict_handler: JSValue) -> JsResult<bool> {
    let bundle = bundle::own().ok_or_else(|| unsupported("moveToApplicationsFolder"))?;
    if app::is_in_applications_folder() {
        return Ok(true);
    }
    let directory = match IS_MAC {
        true => "/Applications".into(),
        false => files::join(&[&paths::home()?, "Applications"]),
    };
    let destination = files::join(&[&directory, files::name(&bundle)]);
    let goes_on = |conflict: &str| {
        if !conflict_handler.is_callable() {
            return Ok(true);
        }
        match call(conflict_handler, &[js(conflict)?])? {
            answer if answer.is_boolean() => Ok(answer.to_boolean()),
            _ => Err(error(format_args!(
                "Invalid conflict handler return type, expected boolean."
            ))),
        }
    };
    let exists = files::exists(&destination);
    if exists && bundle::is_running(&destination, process::id()) {
        if !goes_on("existsAndRunning")? {
            return Ok(false);
        }
        perform(SystemCommand::OpenPath((&*destination).into()))?;
        later::soon(|_| app::quit());
        return Ok(true);
    }
    if exists && !goes_on("exists")? {
        return Ok(false);
    }
    let can_copy = bundle::is_writable(&directory);
    if !can_copy || (exists && !bundle::is_writable(&destination)) {
        let name = paths::app_name()?;
        let prompt = format!("{name} is trying to move to the Applications folder.");
        // Root neither runs nor reads what is in this bundle, which the user can change.
        let [remove, make] = ["rm", "install"].map(bundle::tool);
        let user = bundle::user().to_string();
        let steps: [&[&str]; 2] = [
            &[&remove, "-rf", &destination],
            &[&make, "-d", "-o", &user, "-m", "755", &destination],
        ];
        ui()?;
        match run_as_root(&prompt, &steps[..if can_copy { 1 } else { 2 }]) {
            Ok(_) if can_copy || bundle::is_writable(&destination) => {}
            Err(why) if why == "cancelled" => {
                return Err(error(format_args!(
                    "User rejected the authorization request"
                )));
            }
            _ => {
                return Err(error(format_args!(
                    "Failed to copy to applications directory during authorized install"
                )));
            }
        }
    } else if exists && catch(trash(&destination))?.is_err() {
        return Err(error(format_args!("Failed to delete existing application")));
    }
    let copied = match can_copy {
        true => bundle::copy_to(&bundle, &directory),
        false => bundle::copy_to(&format!("{bundle}/Contents"), &destination),
    };
    if copied.is_err() {
        return Err(error(format_args!(
            "Failed to copy current bundle to the applications folder"
        )));
    }
    state().moved_to.replace(Some(destination));
    finish_at_exit()?;
    later::soon(|_| app::quit());
    Ok(true)
}
