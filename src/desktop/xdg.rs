//! Desktop entries and default applications, as freedesktop.org has them.

use crate::generated_bindgen::app::LoginItemOptions;
use crate::prelude::*;
use crate::{files, paths, process, text};

fn value(text: &str) -> String {
    text::escape(text, |it| match it {
        '\\' => Some("\\\\"),
        '\n' => Some("\\n"),
        '\r' => Some("\\r"),
        _ => None,
    })
}

/// For the `Exec` key, which is unescaped twice.
fn exec(command: &[String]) -> String {
    let quote = |argument: &String| {
        let escaped = text::escape(argument, |it| match it {
            '\\' => Some("\\\\"),
            '"' => Some("\\\""),
            '`' => Some("\\`"),
            '$' => Some("\\$"),
            '%' => Some("%%"),
            _ => None,
        });
        format!("\"{escaped}\"")
    };
    value(&command.iter().map(quote).collect::<Vec<_>>().join(" "))
}

fn write_entry(file: &str, exec: &str, more: &str) -> JsResult<()> {
    let (name, icon) = (value(&paths::app_name()?), paths::identifier()?);
    let entry =
        format!("[Desktop Entry]\nType=Application\nName={name}\nExec={exec}\nIcon={icon}\n{more}");
    files::or_throw(files::make_directory(
        files::parent(file).unwrap_or("/"),
        0o755,
    ))?;
    files::or_throw(files::write(file, entry.as_bytes(), 0o644))
}

fn installed_entry() -> JsResult<String> {
    Ok(paths::identifier()? + ".desktop")
}

fn autostart_entry() -> JsResult<String> {
    Ok(files::join(&[
        &paths::path("appData")?,
        "autostart",
        &installed_entry()?,
    ]))
}

fn handler_entry(scheme: &str) -> JsResult<String> {
    Ok(format!("{}.{scheme}-handler.desktop", paths::identifier()?))
}

fn own_applications() -> JsResult<String> {
    let data = paths::variable_or_in_home("XDG_DATA_HOME", &[".local", "share"])?;
    Ok(files::join(&[&data, "applications"]))
}

fn list(variable: &str, otherwise: &str) -> JsResult<Vec<String>> {
    let all = process::variable(variable)?;
    let parts = text::split(all.as_deref().unwrap_or(otherwise), ":");
    Ok(parts
        .filter(|it| !it.is_empty())
        .map(String::from)
        .collect())
}

fn applications() -> JsResult<Vec<String>> {
    let shared = list("XDG_DATA_DIRS", "/usr/local/share:/usr/share")?;
    let shared = shared.iter().map(|it| files::join(&[it, "applications"]));
    Ok(core::iter::once(own_applications()?)
        .chain(shared)
        .collect())
}

fn find_entry(applications: &[String], entry: &str) -> Option<String> {
    (applications.iter().map(|it| files::join(&[it, entry]))).find(|it| files::exists(it))
}

fn is_installed(entry: &str) -> JsResult<bool> {
    Ok(find_entry(&applications()?, entry).is_some())
}

fn read_key(file: &str, group: &str, key: &str) -> Option<String> {
    let contents = files::read_text(file)?;
    let lines = text::split(text::split_once(&contents, &format!("[{group}]"))?.1, "\n");
    let mut lines = lines.take_while(|it| !it.starts_with('['));
    lines.find_map(|it| Some(it.strip_prefix(key)?.strip_prefix('=')?.trim().to_owned()))
}

/// What `xdg-mime query default` prints, which takes a hundred times as long.
fn default_application(kind: &str) -> JsResult<Option<String>> {
    let applications = applications()?;
    let find = |file: String, group| {
        let entries = read_key(&file, group, kind)?;
        let mut entries = text::split(&entries, ";").filter(|it| !it.is_empty());
        entries
            .find(|it| find_entry(&applications, it).is_some())
            .map(String::from)
    };
    let desktops = list("XDG_CURRENT_DESKTOP", "")?;
    let lists = desktops
        .iter()
        .map(|it| it.to_lowercase() + "-mimeapps.list");
    let lists: Vec<String> = lists.chain(["mimeapps.list".into()]).collect();
    let mut directories = vec![paths::path("appData")?];
    directories.extend(list("XDG_CONFIG_DIRS", "/etc/xdg")?);
    let chosen = directories
        .iter()
        .chain(&applications)
        .find_map(|directory| {
            (lists.iter())
                .find_map(|list| find(files::join(&[directory, list]), "Default Applications"))
        });
    Ok(chosen.or_else(|| {
        (applications.iter())
            .find_map(|it| find(files::join(&[it, "mimeinfo.cache"]), "MIME Cache"))
    }))
}

fn kind_of(scheme: &str) -> String {
    format!("x-scheme-handler/{scheme}")
}

pub(crate) fn name_of_handler(scheme: &str) -> JsResult<Option<String>> {
    let (entry, applications) = (default_application(&kind_of(scheme))?, applications()?);
    let file = entry.and_then(|it| find_entry(&applications, &it));
    Ok(file.and_then(|it| read_key(&it, "Desktop Entry", "Name")))
}

/// The name and the executable.
pub(crate) fn handler_of(scheme: &str) -> JsResult<Option<[String; 2]>> {
    let entry = default_application(&kind_of(scheme))?;
    let (applications, search) = (applications()?, process::variable("PATH")?);
    let find = || {
        let file = find_entry(&applications, &entry?)?;
        let command = read_key(&file, "Desktop Entry", "Exec")?;
        let program = match command.strip_prefix('"') {
            Some(quoted) => text::before(quoted, "\""),
            None => text::before(&command, " "),
        };
        let mut found = bun_paths::path_buffer_pool::get();
        let path = bun_which::which(&mut found, search?.as_bytes(), b"", program.as_bytes())?;
        Some([
            read_key(&file, "Desktop Entry", "Name")?,
            string(path.as_bytes()),
        ])
    };
    Ok(find())
}

fn set_default_application(entry: &str, kind: &str) -> JsResult<bool> {
    process::run(&["xdg-mime", "default", entry, kind])
}

pub(crate) fn handle(scheme: &str, command: &[String], is_usual: bool) -> JsResult<bool> {
    let (kind, installed) = (kind_of(scheme), installed_entry()?);
    if is_usual && is_installed(&installed)? {
        return set_default_application(&installed, &kind);
    }
    let entry = handler_entry(scheme)?;
    write_entry(
        &files::join(&[&own_applications()?, &entry]),
        &format!("{} %u", exec(command)),
        &format!("NoDisplay=true\nMimeType={kind};\n"),
    )?;
    set_default_application(&entry, &kind)
}

pub(crate) fn handles(scheme: &str, _: &[String]) -> JsResult<bool> {
    let entry = default_application(&kind_of(scheme))?;
    Ok(entry == Some(handler_entry(scheme)?) || entry == Some(installed_entry()?))
}

pub(crate) fn stop_handling(scheme: &str, command: &[String]) -> JsResult<bool> {
    let handles = handles(scheme, command)?;
    if handles {
        files::remove(&files::join(&[
            &own_applications()?,
            &handler_entry(scheme)?,
        ]));
    }
    Ok(handles)
}

pub(crate) fn login_item(_: &[String]) -> JsResult<JSValue> {
    let opens = files::exists(&autostart_entry()?);
    Ok(object!({
        "executableWillLaunchAtLogin": opens,
        "openAtLogin": opens,
        "wasOpenedAtLogin": false,
    }))
}

pub(crate) fn set_login_item(settings: &LoginItemOptions, command: &[String]) -> JsResult<()> {
    if !settings.open_at_login {
        files::remove(&autostart_entry()?);
        return Ok(());
    }
    write_entry(&autostart_entry()?, &exec(command), "")
}
