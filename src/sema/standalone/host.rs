//! What the command line tools ask of the system: files and the environment through `bun_sys` and
//! `bun_core`, the searches of `str` with Bun's, and what they print.

use bun_core::{Fd, ZBox, strings};
use std::io::Write;
use std::path::{Path, PathBuf};

/// `println!`, which does not panic when nobody reads.
#[macro_export]
macro_rules! output_line {
    () => {
        $crate::host::write_output(format_args!("\n"))
    };
    ($($arguments:tt)*) => {
        $crate::host::write_output(format_args!("{}\n", format_args!($($arguments)*)))
    };
}

/// `print!`
#[macro_export]
macro_rules! output {
    ($($arguments:tt)*) => {
        $crate::host::write_output(format_args!($($arguments)*))
    };
}

/// `eprintln!`
#[macro_export]
macro_rules! error_line {
    ($($arguments:tt)*) => {
        $crate::host::write_error(format_args!("{}\n", format_args!($($arguments)*)))
    };
}

pub use crate::{error_line, output, output_line};

pub fn write_output(text: std::fmt::Arguments<'_>) {
    let _ = std::io::stdout().write_fmt(text);
}

pub fn write_error(text: std::fmt::Arguments<'_>) {
    let _ = std::io::stderr().write_fmt(text);
}

/// Bytes as text, to print them.
pub fn text(bytes: &[u8]) -> String {
    bstr::BStr::new(bytes).to_string()
}

/// What went wrong, as `std::io::Error` says it. To say it as Bun does takes native code.
pub fn describe(error: &bun_sys::Error) -> String {
    std::io::Error::from_raw_os_error(i32::from(error.errno)).to_string()
}

fn bytes_of(path: &Path) -> &[u8] {
    path.as_os_str().as_encoded_bytes()
}

pub fn read(path: impl AsRef<Path>) -> bun_sys::Result<Vec<u8>> {
    bun_sys::File::read_from(Fd::cwd(), bytes_of(path.as_ref()))
}

pub fn read_text(path: impl AsRef<Path>) -> bun_sys::Result<String> {
    read(path).map(|it| text(&it))
}

pub fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> bun_sys::Result<()> {
    let path = ZBox::from_bytes(bytes_of(path.as_ref()));
    bun_sys::File::write_file(Fd::cwd(), &path, contents.as_ref())
}

pub fn remove(path: impl AsRef<Path>) -> bun_sys::Result<()> {
    bun_sys::unlink(&ZBox::from_bytes(bytes_of(path.as_ref())))
}

/// Makes the directory at `path`, and those that it is in.
pub fn make_directories(path: impl AsRef<Path>) -> bun_sys::Result<()> {
    bun_sys::mkdir_recursive(bytes_of(path.as_ref()))
}

/// The paths of what is in the directory at `path`, in no particular order. Nothing if it cannot be listed.
pub fn list(path: impl AsRef<Path>) -> Vec<PathBuf> {
    let path = path.as_ref();
    let Ok(directory) = bun_sys::open_dir_at(Fd::cwd(), bytes_of(path)) else {
        return Vec::new();
    };
    let directory = bun_sys::Dir::from_fd(directory);
    let mut entries = bun_sys::iterate_dir(directory.fd());
    let mut found = Vec::new();
    while let Ok(Some(entry)) = entries.next() {
        found.push(path.join(text(entry.name.slice_u8())));
    }
    found
}

/// `path` without links, from the root.
pub fn real_path(path: impl AsRef<Path>) -> bun_sys::Result<PathBuf> {
    let path = ZBox::from_bytes(bytes_of(path.as_ref()));
    let mut buffer = bun_paths::path_buffer_pool::get();
    bun_sys::realpath(&path, &mut buffer).map(|it| PathBuf::from(text(it)))
}

/// The environment variable `name`.
pub fn variable(name: &str) -> Option<String> {
    bun_core::getenv_z(&ZBox::from_bytes(name)).map(text)
}

/// Bytes as the system takes them.
#[cfg(unix)]
pub fn os_text(bytes: &[u8]) -> std::ffi::OsString {
    std::os::unix::ffi::OsStringExt::from_vec(bytes.to_vec())
}

#[cfg(not(unix))]
pub fn os_text(bytes: &[u8]) -> std::ffi::OsString {
    text(bytes).into()
}

/// To run the `program` that is in `PATH`.
// Bun starts programs with native code, which these tools are linked without.
#[allow(clippy::disallowed_types)]
pub fn command(program: &str) -> std::process::Command {
    std::process::Command::new(program)
}

// The searches of `str`, for what is not empty. It is text too, so the text can be cut there.

/// `str::find`
pub fn find(text: &str, what: &str) -> Option<usize> {
    strings::index_of(text.as_bytes(), what.as_bytes())
}

pub fn contains(text: &str, what: &str) -> bool {
    what.is_empty() || strings::contains(text.as_bytes(), what.as_bytes())
}

/// `str::split`
pub fn split<'a>(text: &'a str, at: &'a str) -> impl Iterator<Item = &'a str> {
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let text = rest?;
        let found = find(text, at);
        rest = found.map(|found| &text[found + at.len()..]);
        Some(&text[..found.unwrap_or(text.len())])
    })
}

/// `str::split_once`
pub fn split_once<'a>(text: &'a str, at: &str) -> Option<(&'a str, &'a str)> {
    find(text, at).map(|found| (&text[..found], &text[found + at.len()..]))
}

/// `str::rsplit_once`
pub fn rsplit_once<'a>(text: &'a str, at: &str) -> Option<(&'a str, &'a str)> {
    strings::last_index_of(text.as_bytes(), at.as_bytes())
        .map(|found| (&text[..found], &text[found + at.len()..]))
}

/// `str::lines`
pub fn lines(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = text;
    std::iter::from_fn(move || match split_once(rest, "\n") {
        Some((line, after)) => {
            rest = after;
            Some(line.strip_suffix('\r').unwrap_or(line))
        }
        None if rest.is_empty() => None,
        None => Some(std::mem::take(&mut rest)),
    })
}

/// `str::replace`
pub fn replace(text: &str, what: &str, with: &str) -> String {
    split(text, what).collect::<Vec<_>>().join(with)
}
