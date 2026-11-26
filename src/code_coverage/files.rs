use std::sync::{Arc, OnceLock};

use bun_ast::Loader;
use bun_ast::coverage::{Event, Role};
use bun_collections::StringArrayHashMap;
use bun_core::strings::{BOM, contains_char};
use bun_paths::Path;
use bun_sys::{Fd, File};

use crate::find_anchors;
use crate::report::UNKNOWN;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// The name can be relative.
    Disk,
    /// The name can be made up.
    Memory,
    SourceMap,
}

/// What the counters are numbered by.
pub(crate) struct Text {
    pub(crate) path: Box<[u8]>,
    pub(crate) loader: Loader,
    pub(crate) bytes: Box<[u8]>,
    pub(crate) origin: Origin,
    numbers: OnceLock<Vec<(Role, Event, u32)>>,
}

impl Text {
    pub(crate) fn new(path: &[u8], loader: Loader, bytes: &[u8], origin: Origin) -> Arc<Text> {
        Arc::new(Text {
            path: path.into(),
            loader,
            bytes: bytes.into(),
            origin,
            numbers: OnceLock::new(),
        })
    }

    fn numbers(&self) -> &[(Role, Event, u32)] {
        self.numbers.get_or_init(|| {
            let anchors = find_anchors(self.loader, &self.bytes).unwrap_or_default();
            (anchors.all.iter().map(|it| (it.role, it.event, it.counter))).collect()
        })
    }

    /// A plugin or a generator can write other values and comments each time.
    pub(crate) fn is_numbered_like(&self, other: &Text) -> bool {
        self.path == other.path && (self.bytes == other.bytes || self.numbers() == other.numbers())
    }

    /// The best is what the file has `now`, and the next best is what was loaded for it.
    fn rank(&self, now: Option<&[u8]>) -> impl Ord {
        (now == Some(&self.bytes), self.origin != Origin::SourceMap)
    }

    pub(crate) fn update(old: &mut Arc<Text>, new: Arc<Text>) {
        if old.bytes == new.bytes && old.origin != Origin::SourceMap {
            return;
        }
        let now = (old.bytes != new.bytes).then(|| read_if_file(&old.path));
        let now = now.as_ref().and_then(Option::as_deref);
        if old.rank(now) <= new.rank(now) {
            *old = new;
        }
    }
}

/// Plugins and source maps make up names.
pub(crate) fn can_be_on_disk(path: &[u8]) -> bool {
    bun_paths::is_fully_qualified(path) && !contains_char(path, 0)
}

/// Not a pipe, which would block.
pub(crate) fn is_file(path: &[u8]) -> bool {
    can_be_on_disk(path)
        && bun_sys::stat(&Path::from(path))
            .is_ok_and(|it| bun_sys::is_regular_file(it.st_mode as _))
}

/// As the module loader reads it.
pub(crate) fn read(path: &[u8]) -> bun_sys::Result<Vec<u8>> {
    let bytes = File::read_from(Fd::cwd(), path)?;
    Ok(match BOM::detect(&bytes) {
        Some(mark) => mark.remove_and_convert_to_utf8_and_free(bytes),
        None => bytes,
    })
}

pub(crate) fn read_if_file(path: &[u8]) -> Option<Vec<u8>> {
    is_file(path).then(|| read(path).ok())?
}

#[derive(Clone)]
pub(crate) struct Counts {
    pub(crate) text: Arc<Text>,
    pub(crate) counts: Vec<u64>,
}

/// By path. A file can be loaded with one text and then with another.
#[derive(Default)]
pub(crate) struct Files(StringArrayHashMap<Vec<Counts>>);

impl Files {
    pub(crate) fn add(&mut self, new: Counts) {
        let versions = bun_core::handle_oom(self.0.get_or_put(&new.text.path)).value_ptr;
        let is_same = |it: &mut Counts| {
            it.counts.len() == new.counts.len() && it.text.is_numbered_like(&new.text)
        };
        let Some(mut same) = versions.extract_if(.., is_same).next() else {
            return versions.push(new);
        };
        for (sum, count) in same.counts.iter_mut().zip(new.counts) {
            *sum = match count.max(*sum) {
                UNKNOWN => count.min(*sum),
                _ => count.saturating_add(*sum).min(UNKNOWN - 1),
            };
        }
        Text::update(&mut same.text, new.text);
        versions.push(same);
    }

    pub(crate) fn all(&self) -> impl Iterator<Item = &Counts> {
        self.0.values().iter().flatten()
    }

    pub(crate) fn texts_of(&self, path: &[u8]) -> impl Iterator<Item = &[u8]> {
        (self.0.get(path).into_iter().flatten()).map(|it| &*it.text.bytes)
    }

    /// Of each file the last of the best texts, or the build of which the most did not run.
    pub(crate) fn reported(&self) -> impl Iterator<Item = &Counts> {
        self.0.values().iter().filter_map(|versions| {
            let now = versions.get(1).and_then(|it| read_if_file(&it.text.path));
            versions.iter().max_by_key(|Counts { text, counts }| {
                let missed = counts
                    .iter()
                    .map(|&it| u32::from(matches!(it, 0 | UNKNOWN)));
                (
                    text.rank(now.as_deref()),
                    (text.origin == Origin::SourceMap).then(|| (missed.sum::<u32>(), &text.bytes)),
                )
            })
        })
    }
}

fn write_number(out: &mut Vec<u8>, mut number: u64) {
    while number >= 0x80 {
        out.push(number as u8 | 0x80);
        number >>= 7;
    }
    out.push(number as u8);
}

fn read_number(bytes: &mut &[u8]) -> Option<u64> {
    let (mut number, mut shift) = (0, 0);
    loop {
        let byte = *bytes.split_off_first()?;
        number |= u64::from(byte & 0x7F).checked_shl(shift)?;
        shift += 7;
        if byte < 0x80 {
            return Some(number);
        }
    }
}

fn read_bytes<'a>(bytes: &mut &'a [u8]) -> Option<&'a [u8]> {
    let length = usize::try_from(read_number(bytes)?).ok()?;
    bytes.split_off(..length)
}

fn loader_with_number(number: u64) -> Option<Loader> {
    ([Loader::Jsx, Loader::Js, Loader::Ts, Loader::Tsx].into_iter()).find(|&it| it as u64 == number)
}

impl Counts {
    /// For another process.
    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        write_number(out, self.text.loader as u64);
        out.push(self.text.origin as u8);
        for part in [&self.text.path, &self.text.bytes] {
            write_number(out, part.len() as u64);
            out.extend_from_slice(part);
        }
        for &count in &self.counts {
            write_number(out, count);
        }
    }

    pub(crate) fn decode(mut bytes: &[u8]) -> Option<Counts> {
        let loader = loader_with_number(read_number(&mut bytes)?)?;
        let origins = [Origin::Disk, Origin::Memory, Origin::SourceMap];
        let origin = *origins.get(usize::from(*bytes.split_off_first()?))?;
        let (path, text) = (read_bytes(&mut bytes)?, read_bytes(&mut bytes)?);
        let text = Text::new(path, loader, text, origin);
        let mut counts = Vec::with_capacity(bytes.len());
        while !bytes.is_empty() {
            counts.push(read_number(&mut bytes)?);
        }
        Some(Counts { text, counts })
    }
}
