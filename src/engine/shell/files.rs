//! Paths, `file:` URLs and the sources that come from them.

use std::fmt::Write;

use bun_engine_vm::{SourceCode, SourceProvider, SourceProviderRef, SourceType};

use crate::prelude::*;

const SCHEME: &str = "file://";

pub(crate) fn is_absolute(path: &str) -> bool {
    std::path::Path::new(path).is_absolute()
}

pub(crate) fn is_dotted_relative(path: &str) -> bool {
    path.starts_with("./") || path.starts_with("../")
}

pub(crate) fn is_file_url(url: &str) -> bool {
    url.starts_with(SCHEME)
}

fn push_encoded(url: &mut String, text: &str, also: &[u8]) {
    for byte in text.bytes() {
        if byte <= b' ' || byte >= 0x7f || b"\"<>`{}".contains(&byte) || also.contains(&byte) {
            let _ = write!(url, "%{byte:02X}");
        } else {
            url.push(char::from(byte));
        }
    }
}

fn without_dot_segments(path: &str) -> String {
    let mut segments = Vec::new();
    let mut rest = path.split('/').skip(1).peekable();
    while let Some(segment) = rest.next() {
        if segment == ".." {
            segments.pop();
        }
        if !matches!(segment, "." | "..") {
            segments.push(segment);
        } else if rest.peek().is_none() {
            segments.push("");
        }
    }
    format!("/{}", segments.join("/"))
}

/// `path` is absolute.
pub(crate) fn url_of_path(path: &str) -> String {
    let mut encoded = String::new();
    if !path.starts_with('/') {
        encoded.push('/');
    }
    push_encoded(&mut encoded, &path.replace('\\', "/"), b"%?#");
    format!("{SCHEME}{}", without_dot_segments(&encoded))
}

/// `base` is a `file:` URL.
pub(crate) fn resolve(base: &str, relative: &str) -> String {
    if is_file_url(relative) {
        return relative.to_owned();
    }
    let (relative, suffix) = relative.split_at(relative.find(['?', '#']).unwrap_or(relative.len()));
    let base = base[SCHEME.len()..].split(['?', '#']).next().unwrap_or("/");
    let mut path = if relative.starts_with('/') {
        String::new()
    } else if relative.is_empty() {
        base.to_owned()
    } else {
        base[..base.rfind('/').map_or(0, |slash| slash + 1)].to_owned()
    };
    push_encoded(&mut path, relative, b"");
    let mut url = format!("{SCHEME}{}", without_dot_segments(&path));
    push_encoded(&mut url, suffix, b"");
    url
}

pub(crate) fn path_of_url(url: &str) -> String {
    let path = url.strip_prefix(SCHEME).unwrap_or(url);
    let path = path.split(['?', '#']).next().unwrap_or_default().as_bytes();
    let (mut bytes, mut at) = (Vec::new(), 0);
    while let Some(&byte) = path.get(at) {
        let digit = |index: usize| char::from(*path.get(index)?).to_digit(16);
        match (byte, digit(at + 1), digit(at + 2)) {
            (b'%', Some(high), Some(low)) => {
                bytes.push((high * 16 + low) as u8);
                at += 3;
            }
            _ => {
                bytes.push(byte);
                at += 1;
            }
        }
    }
    let path = String::from_utf8_lossy(&bytes).into_owned();
    if cfg!(windows) {
        return path.trim_start_matches('/').replace('/', "\\");
    }
    path
}

pub(crate) fn url_of_working_directory() -> String {
    let directory = std::env::current_dir().unwrap_or_default();
    let mut url = url_of_path(&directory.to_string_lossy());
    if !url.ends_with('/') {
        url.push('/');
    }
    url
}

pub(crate) fn absolute_url(path: &str) -> String {
    if is_absolute(path) {
        return url_of_path(path);
    }
    resolve(&url_of_working_directory(), path)
}

/// UTF-8, or else Latin-1.
pub(crate) fn decode(bytes: &[u8]) -> StringRef {
    match StringRef::try_from_utf8(bytes) {
        Ok(Some(string)) => string,
        _ => StringRef::from_latin1(bytes),
    }
}

pub(crate) fn read(path: &str) -> Option<Vec<u8>> {
    let bytes = std::fs::read(path).ok();
    if bytes.is_none() {
        eprintln!("Could not open file: {path}");
    }
    bytes
}

/// For something may be put in front of it.
pub(crate) fn comment_out_hashbang(code: &mut [u8]) {
    if code.starts_with(b"#!") {
        code[..2].fill(b'/');
    }
}

pub(crate) fn read_code(path: &str) -> Option<Vec<u8>> {
    let mut bytes = read(path)?;
    comment_out_hashbang(&mut bytes);
    Some(bytes)
}

pub(crate) fn origin(url: &str) -> SourceProviderRef {
    let url = Some(StringRef::from_str(url));
    SourceProvider::build(StringRef::empty(), url, SourceType::Program).finish()
}

/// `name` is what errors call it.
pub(crate) fn source(
    text: StringRef,
    origin: Option<&SourceProvider>,
    name: Option<&str>,
    source_type: SourceType,
) -> SourceCode {
    let provider = SourceProvider::build(text, name.map(StringRef::from_str), source_type);
    SourceCode::whole(provider.origin(origin).finish())
}

pub(crate) fn source_at(path: &str, bytes: &[u8], source_type: SourceType) -> SourceCode {
    let origin = origin(&absolute_url(path));
    source(decode(bytes), Some(&origin), Some(path), source_type)
}
