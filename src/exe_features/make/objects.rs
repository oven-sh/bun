//! The object files of a link, by the names the linker's map gives them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// Reads each archive once.
#[derive(Default)]
pub(super) struct Objects {
    archives: HashMap<PathBuf, Option<Rc<[u8]>>>,
}

/// The bytes of an object file: a file of its own, or part of an archive.
pub(super) struct Object {
    file: Rc<[u8]>,
    range: core::ops::Range<usize>,
}

impl Object {
    pub(super) fn bytes(&self) -> &[u8] {
        &self.file[self.range.clone()]
    }
}

impl Object {
    pub(super) fn read(path: &Path) -> Option<Object> {
        let file: Rc<[u8]> = std::fs::read(path).ok()?.into();
        Some(Object {
            range: 0..file.len(),
            file,
        })
    }
}

impl Objects {
    /// `name` is a path, or `archive(member)`. Relative to the current directory, which is the one the link ran in.
    pub(super) fn get(&mut self, name: &str) -> Option<Object> {
        // The longest `….a(` or `….rlib(`: a member's name may hold parentheses of its own.
        let archive = name.strip_suffix(')').and_then(|inner| {
            let at = [".a(", ".rlib("]
                .into_iter()
                .filter_map(|end| inner.rfind(end).map(|i| i + end.len()))
                .max()?;
            Some((&inner[..at - 1], &inner[at..]))
        });
        let Some((archive, member)) = archive else {
            return Object::read(Path::new(name));
        };
        let file = self
            .archives
            .entry(PathBuf::from(archive))
            .or_insert_with(|| std::fs::read(Path::new(archive)).ok().map(Into::into))
            .clone()?;
        let range = member_of(&file, member)?;
        Some(Object { file, range })
    }
}

/// None as well if there are two of that name: the map does not say which it means.
fn member_of(ar: &[u8], wanted: &str) -> Option<core::ops::Range<usize>> {
    let text = |range: core::ops::Range<usize>| core::str::from_utf8(&ar[range]).ok();
    let mut found: Option<core::ops::Range<usize>> = None;
    let mut long_names = 0..0;
    let mut at = 8;
    while at + 60 <= ar.len() {
        let id = text(at..at + 16)?.trim_end();
        let size: usize = text(at + 48..at + 58)?.trim().parse().ok()?;
        let body = at + 60;
        if let Some(length) = id.strip_prefix("#1/").and_then(|n| n.parse::<usize>().ok()) {
            // BSD: the name precedes the contents
            if crate::bytes::fixed_name(&ar[body..body + length]) == wanted.as_bytes()
                && found.replace(body + length..body + size).is_some()
            {
                return None;
            }
        } else if id == "//" {
            long_names = body..body + size;
        } else if id != "/" && id != "/SYM64/" {
            let name = match id.strip_prefix('/').and_then(|n| n.parse::<usize>().ok()) {
                Some(offset) => {
                    let names = &ar[long_names.clone()][offset..];
                    core::str::from_utf8(&names[..names.iter().position(|&b| b == b'\n')?]).ok()?
                }
                None => id,
            };
            if name.strip_suffix('/').unwrap_or(name) == wanted
                && found.replace(body..body + size).is_some()
            {
                return None;
            }
        }
        at = body + size + (size & 1);
    }
    found
}
