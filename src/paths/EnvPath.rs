use std::borrow::Cow;

use bun_alloc::AllocError;
use bun_core::strings;

use crate::DELIMITER;

fn trim_path_delimiters(input: &[u8]) -> &[u8] {
    let mut trimmed = input;
    while !trimmed.is_empty() && trimmed[0] == DELIMITER {
        trimmed = &trimmed[1..];
    }
    while !trimmed.is_empty() && trimmed[trimmed.len() - 1] == DELIMITER {
        trimmed = &trimmed[0..trimmed.len() - 1];
    }
    trimmed
}

#[derive(Default)]
pub struct EnvPath {
    buf: Vec<u8>,
}

/// Input accepted by [`EnvPath::append`].
///
/// Raw slices are trimmed; anything else is assumed already-trimmed and has
/// `.slice()` called on it.
pub trait EnvPathInput {
    fn as_trimmed(&self) -> &[u8];
}

impl EnvPathInput for [u8] {
    fn as_trimmed(&self) -> &[u8] {
        strings::without_trailing_slash(trim_path_delimiters(self))
    }
}

// "assume already trimmed" — blanket over all const params so callers may pass
// any `&Path<u8, KIND, SEP, CHECK>` (e.g. `PathComponentBuilder.apply()`).
impl<const KIND: u8, const SEP_OPT: u8, const CHECK: u8> EnvPathInput
    for crate::Path<u8, KIND, SEP_OPT, CHECK>
{
    fn as_trimmed(&self) -> &[u8] {
        self.slice()
    }
}

impl EnvPath {
    pub fn init_capacity(capacity: usize) -> Result<Self, AllocError> {
        // `Vec::with_capacity` aborts on OOM under the global mimalloc allocator.
        Ok(Self {
            buf: Vec::with_capacity(capacity),
        })
    }

    pub fn slice(&self) -> &[u8] {
        self.buf.as_slice()
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }

    pub fn append<I: EnvPathInput + ?Sized>(&mut self, input: &I) -> Result<(), AllocError> {
        let trimmed: &[u8] = input.as_trimmed();

        if trimmed.is_empty() {
            return Ok(());
        }

        if !self.buf.is_empty() {
            self.buf.reserve(trimmed.len() + 1);
            self.buf.push(DELIMITER);
            self.buf.extend_from_slice(trimmed);
        } else {
            self.buf.extend_from_slice(trimmed);
        }
        Ok(())
    }

    pub fn path_component_builder(&mut self) -> PathComponentBuilder<'_> {
        PathComponentBuilder {
            env_path: self,
            path_buf: crate::AutoAbsPath::init(),
        }
    }
}

pub struct PathComponentBuilder<'a> {
    env_path: &'a mut EnvPath,
    path_buf: crate::AutoAbsPath,
}

impl<'a> PathComponentBuilder<'a> {
    pub fn append(&mut self, component: &[u8]) {
        let _ = self.path_buf.append(component); // OOM/capacity: fire-and-forget
    }

    pub fn apply(self) -> Result<(), AllocError> {
        self.env_path.append(&self.path_buf)?;
        Ok(())
    }
}

/// macOS and Windows take `Node_Modules` for `node_modules` by default.
fn is_name(name: &[u8], expected: &[u8]) -> bool {
    if cfg!(any(target_os = "macos", windows)) {
        strings::eql_case_insensitive_asciii_check_length(name, expected)
    } else {
        name == expected
    }
}

/// Splits the last name off `path`.
fn split_last_name(path: &[u8]) -> (&[u8], &[u8]) {
    let separators: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };
    match strings::last_index_of_any(path, separators) {
        Some(i) => (&path[..i], &path[i + 1..]),
        None => (b"", path),
    }
}

/// `dir` of a `PATH` entry `dir/node_modules/.bin`: where an install links the commands of the packages in `dir`.
pub fn bin_dir_parent(entry: &[u8]) -> Option<&[u8]> {
    let (rest, bin) = split_last_name(strings::without_trailing_slash(entry));
    let (dir, node_modules) = split_last_name(rest);
    (is_name(bin, b".bin") && is_name(node_modules, b"node_modules")).then_some(dir)
}

/// Whether `dir` is `ancestor` or below it.
pub fn is_inside(dir: &[u8], ancestor: &[u8]) -> bool {
    let ancestor = match ancestor {
        [root] if *root == crate::SEP => b"",
        _ => strings::without_trailing_slash(ancestor),
    };
    dir.strip_prefix(ancestor)
        .is_some_and(|rest| rest.first().is_none_or(|&c| c == crate::SEP))
}

/// A `PATH` on which bun looks up a program that it runs itself, such as the shell of a script or `git`.
/// A lookup skips the `node_modules/.bin` entries, because any installed package can link a command there.
#[derive(Clone, Copy)]
pub struct ToolPath<'a>(&'a [u8]);

impl<'a> ToolPath<'a> {
    pub fn new(path: &'a [u8]) -> Self {
        Self(path)
    }

    pub fn is_skipped(entry: &[u8]) -> bool {
        bin_dir_parent(entry).is_some()
    }

    /// With the skipped entries, for a log line.
    pub fn as_bytes(self) -> &'a [u8] {
        self.0
    }

    /// The entries that a lookup searches. Borrows when none is skipped.
    pub fn without_bin_dirs(self) -> Cow<'a, [u8]> {
        if !strings::split(self.0, &[DELIMITER]).any(Self::is_skipped) {
            return Cow::Borrowed(self.0);
        }
        let mut kept: Vec<u8> = Vec::with_capacity(self.0.len());
        let mut entries =
            strings::split(self.0, &[DELIMITER]).filter(|entry| !Self::is_skipped(entry));
        if let Some(first) = entries.next() {
            kept.extend_from_slice(first);
        }
        for entry in entries {
            kept.push(DELIMITER);
            kept.extend_from_slice(entry);
        }
        Cow::Owned(kept)
    }
}
