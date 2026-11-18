//! Paths and small files.

use bun_core::ZBox;
use bun_paths::resolve_path::{self, platform};
use bun_sys::{Fd, File, O};

use crate::prelude::*;
use crate::realm::{self, Module};

pub(crate) fn join(parts: &[&str]) -> String {
    let parts: Vec<&[u8]> = parts.iter().map(|it| it.as_bytes()).collect();
    string(resolve_path::join_spill::<platform::Auto>(
        &mut Vec::new(),
        &parts,
    ))
}

pub(crate) fn absolute(path: &str) -> String {
    let directory = bun_sys::getcwd_alloc().map(|it| it.as_bytes().to_vec());
    let (directory, parts) = (directory.unwrap_or_else(|_| b"/".into()), [path.as_bytes()]);
    string(resolve_path::join_abs_string_spill::<platform::Auto>(
        &directory,
        &mut Vec::new(),
        &parts,
    ))
}

pub(crate) fn is_absolute(path: &str) -> bool {
    bun_paths::is_absolute(path.as_bytes())
}

pub(crate) fn parent(path: &str) -> Option<&str> {
    bun_paths::dirname(path.as_bytes()).map(|it| &path[..it.len()])
}

pub(crate) fn name(path: &str) -> &str {
    core::str::from_utf8(bun_paths::basename(path.as_bytes())).unwrap_or(path)
}

pub(crate) fn exists(path: &str) -> bool {
    bun_sys::exists(path.as_bytes())
}

pub(crate) fn is_directory(path: &str) -> bool {
    bun_sys::directory_exists_at(Fd::cwd(), &ZBox::from_bytes(path.as_bytes())).unwrap_or(false)
}

pub(crate) fn read(path: &str) -> Option<Vec<u8>> {
    File::read_from(Fd::cwd(), path.as_bytes()).ok()
}

pub(crate) fn read_text(path: &str) -> Option<String> {
    read(path).map(|it| string(&it))
}

pub(crate) fn parse_json(text: &[u8]) -> JsResult<JSValue> {
    use bun_jsc::StringJsc as _;
    bun_core::String::clone_utf8(text).to_js_by_parse_json(global())
}

pub(crate) fn read_json(path: &str) -> JsResult<Option<JSValue>> {
    let parsed = read(path).map(|it| catch(parse_json(&it))).transpose()?;
    Ok(parsed.and_then(Result::ok).filter(|it| it.is_object()))
}

pub(crate) fn write(path: &str, contents: &[u8], mode: bun_sys::Mode) -> bun_sys::Result<()> {
    let flags = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC;
    File::openat(Fd::cwd(), path.as_bytes(), flags, mode)?.write_all(contents)
}

/// It survives a power cut.
#[cfg(windows)]
pub(crate) fn write_for_good(
    path: &str,
    contents: &[u8],
    mode: bun_sys::Mode,
) -> bun_sys::Result<()> {
    let flags = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC;
    let file = File::openat(Fd::cwd(), path.as_bytes(), flags, mode)?;
    file.write_all(contents)?;
    bun_sys::fsync(file.handle())
}

pub(crate) fn append(path: &str, contents: &[u8]) -> bun_sys::Result<()> {
    let flags = O::WRONLY | O::APPEND | O::CLOEXEC;
    File::openat(Fd::cwd(), path.as_bytes(), flags, 0)?.write_all(contents)
}

pub(crate) fn make_directory(path: &str, mode: bun_sys::Mode) -> bun_sys::Result<()> {
    bun_sys::mkdir_recursive_at_mode(Fd::cwd(), path.as_bytes(), mode)
}

pub(crate) fn remove(path: &str) {
    let _ = bun_sys::unlink(&ZBox::from_bytes(path.as_bytes()));
}

pub(crate) fn or_throw<T>(result: bun_sys::Result<T>) -> JsResult<T> {
    use bun_jsc::SysErrorJsc as _;
    result.map_err(|error| error.throw(global()))
}

pub(crate) fn to_url(path: &str) -> String {
    let url = bun_url::whatwg::file_url_from_string(&bun_core::String::clone_utf8(path.as_bytes()));
    string(&url.to_utf8())
}

pub(crate) fn from_url(url: &str) -> String {
    let path = bun_url::whatwg::path_from_file_url(&bun_core::String::clone_utf8(url.as_bytes()));
    string(&path.to_utf8())
}

pub(crate) fn real_path(path: &str) -> Option<String> {
    let mut buffer = bun_paths::path_buffer_pool::get();
    bun_sys::realpath(&ZBox::from_bytes(path.as_bytes()), &mut buffer)
        .ok()
        .map(string)
}

pub(crate) fn is_inside(path: &str, directory: &str) -> bool {
    let is_separator = |it: char| it == '/' || (cfg!(windows) && it == '\\');
    (path.strip_prefix(directory.trim_end_matches(is_separator)))
        .is_some_and(|it| it.len() > 1 && it.starts_with(is_separator))
}

pub(crate) fn rename(from: &str, to: &str) -> bun_sys::Result<()> {
    let [from, to] = [from, to].map(|it| ZBox::from_bytes(it.as_bytes()));
    bun_sys::renameat(Fd::cwd(), &from, Fd::cwd(), &to)
}

/// Also to another file system.
pub(crate) fn move_to(from: &str, to: &str) -> bool {
    let [from, to] = [from, to].map(|it| ZBox::from_bytes(it.as_bytes()));
    bun_sys::move_file_z(Fd::cwd(), &from, Fd::cwd(), &to).is_ok()
}

pub(crate) fn names_in(directory: &str) -> Vec<String> {
    let Ok(directory) = bun_sys::Dir::open(directory.as_bytes()) else {
        return Vec::new();
    };
    let (mut entries, mut names) = (bun_sys::dir_iterator::iterate(directory.fd()), Vec::new());
    while let Ok(Some(entry)) = entries.next() {
        names.push(string(entry.name.slice_u8()));
    }
    names
}

pub(crate) fn remove_all(directory: &str) {
    let _ = bun_sys::Dir::cwd().delete_tree(directory.as_bytes());
}

/// It may be in the executable.
pub(crate) fn read_with_node(path: &str) -> JsResult<Vec<u8>> {
    let read = invoke(
        realm::require(global(), Module::Fs)?,
        "readFileSync",
        &[js(path)?],
    )?;
    Ok(read
        .as_array_buffer(global())
        .map(|it| it.byte_slice().to_vec())
        .unwrap_or_default())
}
