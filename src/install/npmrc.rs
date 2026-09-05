//! The user-level `.npmrc`: its path, and line-preserving edits for `bun login` / `bun logout`.

use bun_core::{ZStr, strings};
use bun_paths::resolve_path::{self, platform};
use bun_paths::{PathBuffer, path_buffer_pool};
use bun_sys::{self, Fd, File, O};
use bun_url::URL;

use crate::bun_json as JSON;

/// `$XDG_CONFIG_HOME/.npmrc` when that file exists, else `$HOME/.npmrc`. Shared by the reader and `bun login`.
pub fn user_npmrc_path(buf: &mut PathBuffer) -> Option<&ZStr> {
    let parts = [b"./.npmrc" as &[u8]];
    let mut len: usize = 0;
    if let Some(xdg_dir) = bun_core::env_var::XDG_CONFIG_HOME.get_not_empty() {
        let p =
            resolve_path::join_abs_string_buf_z::<platform::Auto>(xdg_dir, &mut buf[..], &parts);
        if bun_sys::exists_z(p) {
            len = p.len();
        }
    }
    if len == 0 {
        if let Some(home_dir) = bun_core::env_var::HOME.get_not_empty() {
            len = resolve_path::join_abs_string_buf_z::<platform::Auto>(
                home_dir,
                &mut buf[..],
                &parts,
            )
            .len();
        }
    }
    if len == 0 {
        return None;
    }
    // SAFETY: `join_abs_string_buf_z` wrote the NUL at `len`.
    Some(ZStr::from_buf(&buf[..], len))
}

/// npm's "nerf dart" for a registry: `//host[:port]/path/`, host lowercased.
pub fn registry_key(registry_href: &[u8]) -> Vec<u8> {
    let url = URL::parse(registry_href);
    let mut key = Vec::with_capacity(url.host.len() + url.pathname.len() + 3);
    key.extend_from_slice(b"//");
    key.extend_from_slice(url.host);
    key[2..].make_ascii_lowercase();
    let pathname = bun_core::without_trailing_slash(url.pathname);
    if !strings::starts_with_char(pathname, b'/') {
        key.push(b'/');
    }
    key.extend_from_slice(pathname);
    if !strings::ends_with_char(&key, b'/') {
        key.push(b'/');
    }
    key
}

/// `//host/path/:_authToken`
pub fn auth_token_key(registry_href: &[u8]) -> Vec<u8> {
    let mut key = registry_key(registry_href);
    key.extend_from_slice(b":_authToken");
    key
}

/// `@scope:registry`
pub fn scope_registry_key(scope: &[u8]) -> Vec<u8> {
    let scope = strings::trim_leading_char(scope, b'@');
    let mut key = Vec::with_capacity(scope.len() + b"@:registry".len());
    key.push(b'@');
    key.extend_from_slice(scope);
    key.extend_from_slice(b":registry");
    key
}

/// `key = value` on one ini line. `None` for blank lines, comments and lines without `=`.
fn split_key_value(line: &[u8]) -> Option<(&[u8], &[u8])> {
    let trimmed = strings::trim(line, &strings::WHITESPACE_CHARS);
    if trimmed.is_empty() || trimmed[0] == b';' || trimmed[0] == b'#' {
        return None;
    }
    let (key, value) = strings::split_once_char(trimmed, b'=')?;
    Some((
        strings::trim(key, &strings::WHITESPACE_CHARS),
        strings::trim(value, &strings::WHITESPACE_CHARS),
    ))
}

/// The ini reader JSON-parses a `"..."` / `'...'` value; do the same so escapes decode alike.
fn unquote(value: &[u8]) -> Vec<u8> {
    let double = strings::starts_with_char(value, b'"') && strings::ends_with_char(value, b'"');
    let single = strings::starts_with_char(value, b'\'') && strings::ends_with_char(value, b'\'');
    if value.len() < 2 || !(double || single) {
        return value.to_vec();
    }
    if single {
        return value[1..value.len() - 1].to_vec();
    }
    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string("???", value);
    match JSON::ParsedJson::parse_json(&source, &mut log) {
        Ok(parsed) => match parsed.root.as_utf8_string_literal() {
            Some(text) => text.to_vec(),
            None => value[1..value.len() - 1].to_vec(),
        },
        Err(_) => value[1..value.len() - 1].to_vec(),
    }
}

/// npm's `ini.safe`: the reader ends an unquoted value at `;` or `#`, so such values are written as JSON strings.
fn quote_if_needed(value: &[u8]) -> Vec<u8> {
    let needs_quotes = value.is_empty()
        || strings::index_of_any(value, b";#=\"\r\n").is_some()
        || strings::starts_with_char(value, b'[')
        || strings::trim(value, &strings::WHITESPACE_CHARS).len() != value.len();
    if !needs_quotes {
        return value.to_vec();
    }
    let mut out = Vec::with_capacity(value.len() + 2);
    out.push(b'"');
    for &byte in value {
        if byte == b'"' || byte == b'\\' {
            out.push(b'\\');
        }
        out.push(byte);
    }
    out.push(b'"');
    out
}

/// A `.npmrc` as lines. Edits touch only the lines for their key; the ini reader keeps the last duplicate, so does `get`/`set`.
pub struct Npmrc {
    lines: Vec<Vec<u8>>,
    crlf: bool,
}

impl Npmrc {
    /// A missing file loads as empty.
    pub fn load(path: &ZStr) -> bun_sys::Maybe<Npmrc> {
        let bytes = match File::openat(Fd::cwd(), path.as_bytes(), O::RDONLY | O::CLOEXEC, 0) {
            Ok(file) => file.read_to_end()?,
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => {
                return Ok(Npmrc {
                    lines: Vec::new(),
                    crlf: false,
                });
            }
            Err(err) => return Err(err),
        };

        let crlf = strings::contains(&bytes, b"\r\n");
        let mut lines: Vec<Vec<u8>> = strings::split(&bytes, b"\n")
            .map(|line| strings::trim_suffix(line, b"\r").to_vec())
            .collect();
        // a trailing newline yields one empty tail element
        if lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }

        Ok(Npmrc { lines, crlf })
    }

    /// Where the first `[section]` starts; the reader only reads registry keys before it.
    fn root_end(&self) -> usize {
        self.lines
            .iter()
            .position(|line| {
                let trimmed = strings::trim(line, &strings::WHITESPACE_CHARS);
                strings::starts_with_char(trimmed, b'[') && strings::ends_with_char(trimmed, b']')
            })
            .unwrap_or(self.lines.len())
    }

    fn position(&self, key: &[u8]) -> Option<usize> {
        self.lines[..self.root_end()]
            .iter()
            .rposition(|line| split_key_value(line).is_some_and(|(k, _)| k == key))
    }

    pub fn get(&self, key: &[u8]) -> Option<Vec<u8>> {
        let line = &self.lines[self.position(key)?];
        split_key_value(line).map(|(_, v)| unquote(v))
    }

    pub fn set(&mut self, key: &[u8], value: &[u8]) {
        let value = quote_if_needed(value);
        let mut line = Vec::with_capacity(key.len() + value.len() + 1);
        line.extend_from_slice(key);
        line.push(b'=');
        line.extend_from_slice(&value);
        match self.position(key) {
            Some(i) => self.lines[i] = line,
            None => {
                let at = self.root_end();
                self.lines.insert(at, line);
            }
        }
    }

    /// Returns whether any line was removed.
    pub fn remove(&mut self, key: &[u8]) -> bool {
        let root_end = self.root_end();
        let before = self.lines.len();
        let mut i = 0;
        self.lines.retain(|line| {
            let keep = i >= root_end || !split_key_value(line).is_some_and(|(k, _)| k == key);
            i += 1;
            keep
        });
        self.lines.len() != before
    }

    pub fn save(&self, path: &ZStr) -> bun_sys::Maybe<()> {
        let newline: &[u8] = if self.crlf { b"\r\n" } else { b"\n" };
        let mut bytes: Vec<u8> = Vec::new();
        for line in &self.lines {
            bytes.extend_from_slice(line);
            bytes.extend_from_slice(newline);
        }

        // Write through a symlinked `.npmrc` (dotfile managers) instead of replacing the link.
        let mut real_buf = path_buffer_pool::get();
        let target: Vec<u8> = match bun_sys::realpath(path, &mut real_buf) {
            Ok(real) => real.to_vec(),
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => follow_dangling_links(path)?,
            Err(err) => return Err(err),
        };
        let target: &[u8] = &target;
        let dir_path = bun_paths::dirname(target).unwrap_or(b".");
        let dir_fd = bun_sys::open_dir_absolute(dir_path)?;
        let _close_dir = bun_sys::CloseOnDrop::new(dir_fd);

        let mut random = [0u8; 8];
        bun_boringssl_sys::rand_bytes(&mut random);
        let mut tmpname_buf = [0u8; 64];
        let tmpname: &ZStr = {
            use std::io::Write as _;
            let mut cursor: &mut [u8] = &mut tmpname_buf[..];
            let start_len = cursor.len();
            write!(
                cursor,
                ".npmrc-{}.tmp\0",
                bun_core::fmt::HexBytes::<true>(&random)
            )
            .expect("64 bytes fit the fixed-width name");
            let written = start_len - cursor.len();
            ZStr::from_buf(&tmpname_buf, written - 1)
        };

        // 0600: the file holds a credential.
        let mut tmpfile = bun_sys::Tmpfile::create_with_mode(dir_fd, tmpname, 0o600)?;
        let _close = bun_sys::CloseOnDrop::new(tmpfile.fd);
        if let Err(err) = File::borrow(&tmpfile.fd)
            .write_all(&bytes)
            .and_then(|()| fsync(tmpfile.fd))
        {
            let _ = bun_sys::unlinkat(dir_fd, tmpname);
            return Err(err);
        }
        let basename = bun_paths::basename(target);
        let mut dest_buf = [0u8; 256];
        let dest: &ZStr = if basename.len() < dest_buf.len() {
            dest_buf[..basename.len()].copy_from_slice(basename);
            ZStr::from_buf(&dest_buf, basename.len())
        } else {
            let _ = bun_sys::unlinkat(dir_fd, tmpname);
            return Err(bun_sys::Error::from_code(
                bun_sys::E::ENAMETOOLONG,
                bun_sys::Tag::rename,
            ));
        };
        if let Err(err) = tmpfile.finish(dest) {
            let _ = bun_sys::unlinkat(dir_fd, tmpname);
            return Err(err);
        }
        Ok(())
    }
}

#[cfg(windows)]
fn fsync(fd: Fd) -> bun_sys::Maybe<()> {
    bun_sys::sys_uv::fsync(fd)
}

#[cfg(not(windows))]
fn fsync(fd: Fd) -> bun_sys::Maybe<()> {
    bun_sys::fsync(fd)
}

/// The final path of a symlink chain whose last target does not exist yet.
fn follow_dangling_links(path: &ZStr) -> bun_sys::Maybe<Vec<u8>> {
    let mut current = path_buffer_pool::get();
    let mut current_len = path.len();
    current[..=current_len].copy_from_slice(path.as_bytes_with_nul());
    let mut link_buf = path_buffer_pool::get();
    let mut joined = path_buffer_pool::get();
    for _ in 0..40 {
        // SAFETY: `current[current_len]` is the NUL the copy or `join_abs_string_buf_z` wrote (then swapped in).
        let current_z = ZStr::from_buf(&current[..], current_len);
        match bun_sys::readlink(current_z, &mut link_buf[..]) {
            Ok(len) => {
                let parent = bun_paths::dirname(&current[..current_len]).unwrap_or(b".");
                let link = &link_buf[..len];
                current_len = resolve_path::join_abs_string_buf_z::<platform::Auto>(
                    parent,
                    &mut joined[..],
                    &[link],
                )
                .len();
                core::mem::swap(&mut current, &mut joined);
            }
            // not a link, or the link's parent is gone: this is the final path
            Err(err) if matches!(err.get_errno(), bun_sys::E::EINVAL | bun_sys::E::ENOENT) => {
                return Ok(current[..current_len].to_vec());
            }
            Err(err) => return Err(err),
        }
    }
    Err(
        bun_sys::Error::from_code(bun_sys::E::ELOOP, bun_sys::Tag::readlink)
            .with_path(path.as_bytes()),
    )
}
