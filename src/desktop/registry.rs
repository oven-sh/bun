//! Handlers of protocols and login items, as the registry of Windows has them.

use crate::generated_bindgen::app::LoginItemOptions;
use crate::paths;
use crate::prelude::*;
use crate::win32::{command_line, registry};

const RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

fn application_for(scheme: &str) -> JsResult<Option<bun_ui::protocol::Application>> {
    Ok(answer((ui()?.application_for)(format!("{scheme}:").into()))?.get())
}

pub(crate) fn name_of_handler(scheme: &str) -> JsResult<Option<String>> {
    Ok(application_for(scheme)?.map(|it| it.name.into_string()))
}

/// The name and the executable.
pub(crate) fn handler_of(scheme: &str) -> JsResult<Option<[String; 2]>> {
    Ok(application_for(scheme)?.map(|it| [it.name.into_string(), it.path.into_string()]))
}

fn class_of(scheme: &str) -> String {
    format!("Software\\Classes\\{scheme}")
}

/// The key, and what it has if that command handles it.
fn entry_for(scheme: &str, command: &[String]) -> [String; 2] {
    [
        class_of(scheme) + "\\shell\\open\\command",
        command_line(command) + " \"%1\"",
    ]
}

pub(crate) fn handle(scheme: &str, command: &[String], _: bool) -> JsResult<bool> {
    let (class, [key, value]) = (class_of(scheme), entry_for(scheme, command));
    // A single letter is a drive.
    Ok(scheme.len() > 1
        && registry::set_text(&class, "", &format!("URL:{scheme}"))
        && registry::set_text(&class, "URL Protocol", "")
        && registry::set_text(&key, "", &value))
}

pub(crate) fn handles(scheme: &str, command: &[String]) -> JsResult<bool> {
    let [key, value] = entry_for(scheme, command);
    Ok(registry::text(&key, "") == Some(value))
}

pub(crate) fn stop_handling(scheme: &str, command: &[String]) -> JsResult<bool> {
    Ok(!handles(scheme, command)? || registry::remove_all(&class_of(scheme)))
}

/// The user can turn it off in the settings of the system.
fn is_approved(name: &str) -> bool {
    registry::bytes(APPROVED, name).is_none_or(|it| it.first().is_none_or(|it| it & 1 == 0))
}

pub(crate) fn login_item(command: &[String]) -> JsResult<JSValue> {
    let (name, program) = (paths::identifier()?, command_line(&command[..1]));
    let items = array(&[])?;
    let mut launches = false;
    for (name, value) in registry::texts(RUN) {
        let Some(rest) = value.strip_prefix(&program) else {
            continue;
        };
        launches |= is_approved(&name);
        let item = object!({
            "name": &*name,
            "path": &*command[0],
            "args": rest.split_ascii_whitespace().map(|it| it.trim_matches('"')).collect::<Vec<_>>(),
            "scope": "user",
            "enabled": is_approved(&name),
        });
        items.push(global(), item)?;
    }
    Ok(object!({
        "executableWillLaunchAtLogin": launches,
        "launchItems": items,
        "openAtLogin": registry::text(RUN, &name) == Some(command_line(command)),
        "wasOpenedAtLogin": false,
    }))
}

pub(crate) fn set_login_item(settings: &LoginItemOptions, command: &[String]) -> JsResult<()> {
    const TURNED_OFF: [u8; 12] = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let name = (settings.name.as_deref()).map_or_else(paths::identifier, |it| Ok(string(it)))?;
    registry::remove(APPROVED, &name);
    match (settings.open_at_login, settings.enabled) {
        (false, _) => registry::remove(RUN, &name),
        (true, is_enabled) => {
            if registry::set_text(RUN, &name, &command_line(command)) && is_enabled == Some(false) {
                registry::set_bytes(APPROVED, &name, &TURNED_OFF);
            }
        }
    }
    Ok(())
}
