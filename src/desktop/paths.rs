//! What the app is called, and where it keeps its files.

use core::cell::OnceCell;

use crate::prelude::*;
use crate::{files, process, text};

pub(crate) struct Manifest {
    pub(crate) name: RefCell<String>,
    pub(crate) version: String,
    pub(crate) identifier: RefCell<Option<String>>,
    pub(crate) root: String,
}

#[derive(Default)]
struct Paths {
    resources: OnceCell<Option<String>>,
    manifest: OnceCell<Manifest>,
    overridden: RefCell<Vec<(String, String)>>,
}

state!(fn paths() -> Paths);

unsafe extern "C" {
    safe fn Bun__Desktop__resourcesPath() -> bun_core::String;
}

/// `None` unless `bun compile --desktop` made the program.
pub(crate) fn resources() -> Option<&'static str> {
    let find =
        || Some(string(&Bun__Desktop__resourcesPath().to_utf8())).filter(|it| !it.is_empty());
    paths().resources.get_or_init(find).as_deref()
}

fn member(object: JSValue, name: &str) -> JsResult<Option<String>> {
    if !object.is_object() {
        return Ok(None);
    }
    let value = get(object, name)?;
    value.is_string().then(|| text_of(value)).transpose()
}

fn read_manifest() -> JsResult<Manifest> {
    let manifest =
        |name: Option<String>, version: Option<String>, identifier, root: &str| Manifest {
            name: RefCell::new(name.unwrap_or_else(|| "Bun".into())),
            version: version.unwrap_or_else(|| "0.0.0".into()),
            identifier: RefCell::new(identifier),
            root: root.into(),
        };
    if let Some(resources) = resources() {
        let json = files::read_json(&files::join(&[resources, "desktop.json"]))?
            .unwrap_or(JSValue::UNDEFINED);
        let name =
            member(json, "name")?.unwrap_or_else(|| files::name(&process::executable()).into());
        let (version, identifier) = (member(json, "version")?, member(json, "identifier")?);
        return Ok(manifest(Some(name), version, identifier, resources));
    }
    let main = process::main_script();
    let start = files::parent(&main).unwrap_or("/");
    for directory in core::iter::successors(Some(start), |it| files::parent(it)) {
        let Some(json) = files::read_json(&files::join(&[directory, "package.json"]))? else {
            continue;
        };
        let desktop = get(json, "desktop")?;
        let unscoped = member(json, "name")?.map(|it| files::name(&it).to_owned());
        let name = member(desktop, "name")?
            .or(member(json, "productName")?)
            .or(unscoped);
        let version = member(desktop, "version")?.or(member(json, "version")?);
        return Ok(manifest(
            name,
            version,
            member(desktop, "identifier")?,
            directory,
        ));
    }
    Ok(manifest(None, None, None, start))
}

pub(crate) fn manifest() -> JsResult<&'static Manifest> {
    let known = &paths().manifest;
    if let Some(manifest) = known.get() {
        return Ok(manifest);
    }
    let manifest = read_manifest()?;
    Ok(known.get_or_init(|| manifest))
}

pub(crate) fn app_name() -> JsResult<String> {
    Ok(manifest()?.name.borrow().clone())
}

fn file_name() -> JsResult<String> {
    let is_reserved = |it| {
        matches!(
            it,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\x1f'
        )
    };
    Ok(text::escape(&app_name()?, |it| {
        is_reserved(it).then_some("-")
    }))
}

/// The same as `default_identifier` in src/runtime/cli/desktop_bundle.rs.
pub(crate) fn identifier() -> JsResult<String> {
    if let Some(identifier) = &*manifest()?.identifier.borrow() {
        return Ok(identifier.clone());
    }
    let spaced = text::escape(&app_name()?.to_lowercase(), |it| {
        (!it.is_ascii_alphanumeric()).then_some(" ")
    });
    let words: Vec<&str> = spaced.split_ascii_whitespace().collect();
    let words = if words.is_empty() {
        "app".into()
    } else {
        words.join("-")
    };
    Ok(format!("sh.bun.app.{words}"))
}

pub(crate) fn home() -> JsResult<String> {
    Ok(process::variable("HOME")?.unwrap_or_else(process::home_of_user))
}

pub(crate) fn temporary() -> JsResult<String> {
    for name in &["TMPDIR", "TMP", "TEMP"][usize::from(cfg!(windows))..] {
        if let Some(mut path) = process::variable(name)? {
            if files::parent(&path).is_some() && path.ends_with(std::path::MAIN_SEPARATOR) {
                path.pop();
            }
            return Ok(path);
        }
    }
    Ok("/tmp".into())
}

fn in_home(parts: &[&str]) -> JsResult<String> {
    Ok(files::join(&[&home()?, &files::join(parts)]))
}

pub(crate) fn variable_or_in_home(variable: &str, parts: &[&str]) -> JsResult<String> {
    process::variable(variable)?.map_or_else(|| in_home(parts), Ok)
}

fn user_directory(variable: &str, fallback: &str) -> JsResult<String> {
    if IS_MAC {
        return in_home(&[fallback]);
    }
    let config =
        files::read_text(&files::join(&[&path("appData")?, "user-dirs.dirs"])).unwrap_or_default();
    let start = format!("XDG_{variable}_DIR=\"");
    let found =
        text::split(&config, "\n").find_map(|line| line.strip_prefix(&start)?.strip_suffix('"'));
    match found.map(|it| (it, it.strip_prefix("$HOME"))) {
        Some((_, Some(rest))) => Ok(home()? + rest),
        Some((found, None)) => Ok(found.into()),
        None if variable == "DESKTOP" => in_home(&[fallback]),
        None => home(),
    }
}

pub(crate) fn path(name: &str) -> JsResult<String> {
    if let Some((_, path)) = paths().overridden.borrow().iter().find(|it| it.0 == name) {
        return Ok(path.clone());
    }
    #[cfg(windows)]
    if let Some(path) = crate::win32::known_folder(name) {
        return Ok(path);
    }
    let below = |name: &str, rest: &str| Ok(files::join(&[&path(name)?, rest]));
    match name {
        "home" => home(),
        "appData" if IS_MAC => in_home(&["Library", "Application Support"]),
        "appData" => variable_or_in_home("XDG_CONFIG_HOME", &[".config"]),
        "userData" => below("appData", &file_name()?),
        "sessionData" => path("userData"),
        "cache" if IS_MAC => in_home(&["Library", "Caches"]),
        "cache" => variable_or_in_home("XDG_CACHE_HOME", &[".cache"]),
        "logs" if IS_MAC => in_home(&["Library", "Logs", &file_name()?]),
        "logs" => below("userData", "logs"),
        "crashDumps" => below("userData", "Crashpad"),
        "temp" => temporary(),
        "exe" | "module" => Ok(process::executable()),
        "resources" | "assets" => Ok(manifest()?.root.clone()),
        "desktop" => user_directory("DESKTOP", "Desktop"),
        "documents" => user_directory("DOCUMENTS", "Documents"),
        "downloads" => user_directory("DOWNLOAD", "Downloads"),
        "music" => user_directory("MUSIC", "Music"),
        "pictures" => user_directory("PICTURES", "Pictures"),
        "videos" => user_directory("VIDEOS", "Movies"),
        _ if crate::app::is_electron() => Err(error(format_args!("Failed to get '{name}' path"))),
        _ => Err(invalid_value("name", name, "is not the name of a path")),
    }
}

pub(crate) fn is_set(name: &str) -> bool {
    paths().overridden.borrow().iter().any(|it| it.0 == name)
}

pub(crate) fn make_data_directories() -> JsResult<()> {
    for name in ["userData", "sessionData"] {
        let _ = files::make_directory(&path(name)?, 0o700);
    }
    Ok(())
}

pub(crate) fn set_path(name: &str, path: String) -> JsResult<()> {
    if !files::is_absolute(&path) {
        return Err(match crate::app::is_electron() {
            true => error(format_args!("Path must be absolute")),
            false => invalid_value("path", &path, "must be absolute"),
        });
    }
    let mut overridden = paths().overridden.borrow_mut();
    overridden.retain(|it| it.0 != name);
    overridden.push((name.into(), path));
    Ok(())
}

/// What starts this app again.
pub(crate) fn launch_command() -> JsResult<Vec<String>> {
    if resources().is_some() {
        return Ok(vec![
            process::variable("APPIMAGE")?.unwrap_or_else(process::executable),
        ]);
    }
    let mut command = vec![process::executable()];
    command.extend(texts_of(get(process::object(), "execArgv")?)?);
    command.push(process::main_script());
    Ok(command)
}
