use std::sync::{Arc, OnceLock};

use bun_ast::Loader;
use bun_ast::coverage::{Event, Role};
use bun_collections::StringArrayHashMap;
use bun_core::strings::BOM;
use bun_sys::{Fd, File};

use crate::find_anchors;
use crate::report::UNKNOWN;

/// What the counters are numbered by.
pub(crate) struct Text {
    pub(crate) path: Box<[u8]>,
    pub(crate) loader: Loader,
    pub(crate) bytes: Box<[u8]>,
    numbers: OnceLock<Vec<(Role, Event, u32)>>,
}

impl Text {
    pub(crate) fn new(path: &[u8], loader: Loader, bytes: &[u8]) -> Arc<Text> {
        Arc::new(Text {
            path: path.into(),
            loader,
            bytes: bytes.into(),
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

    /// What the file has now stays.
    pub(crate) fn update(old: &mut Arc<Text>, new: Arc<Text>) {
        if old.bytes != new.bytes && !read(&old.path).is_ok_and(|now| *now == *old.bytes) {
            *old = new;
        }
    }
}

/// As the module loader reads it.
pub(crate) fn read(path: &[u8]) -> bun_sys::Result<Vec<u8>> {
    let bytes = File::read_from(Fd::cwd(), path)?;
    Ok(match BOM::detect(&bytes) {
        Some(mark) => mark.remove_and_convert_to_utf8_and_free(bytes),
        None => bytes,
    })
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

    /// Of each file the text that it has now, or else the one that was loaded last.
    pub(crate) fn reported(&self) -> impl Iterator<Item = &Counts> {
        self.0.values().iter().filter_map(|versions| {
            let (last, others) = versions.split_last()?;
            let now = others.first().and_then(|it| read(&it.text.path).ok());
            let is_current = |it: &&Counts| now.as_deref() == Some(&it.text.bytes);
            versions.iter().rfind(is_current).or(Some(last))
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

pub(crate) fn loader_with_number(number: u64) -> Option<Loader> {
    ([Loader::Jsx, Loader::Js, Loader::Ts, Loader::Tsx].into_iter()).find(|&it| it as u64 == number)
}

impl Counts {
    /// For another process.
    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        write_number(out, self.text.loader as u64);
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
        let text = Text::new(read_bytes(&mut bytes)?, loader, read_bytes(&mut bytes)?);
        let mut counts = Vec::with_capacity(bytes.len());
        while !bytes.is_empty() {
            counts.push(read_number(&mut bytes)?);
        }
        Some(Counts { text, counts })
    }
}
