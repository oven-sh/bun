use std::rc::Rc;

use super::{Error, Options, Pattern};
use crate::CodeUnits;

const SETS: usize = 256;
const WAYS: usize = 4;
const MOST_BYTES: usize = 4 << 20;

struct Entry {
    /// The units of the text, in either width.
    key: Box<[u8]>,
    is_wide: bool,
    options: Options,
    pattern: Pattern,
    size: usize,
}

#[inline(always)]
fn bytes_of(text: CodeUnits<'_>) -> &[u8] {
    of_either_width!(text, |text| bun_core::slice_as_bytes(text))
}

impl Entry {
    #[inline(always)]
    fn is_of(&self, text: CodeUnits<'_>, options: Options) -> bool {
        self.options == options
            && self.is_wide == crate::is_wide(text)
            && crate::scan::equal(&self.key, bytes_of(text))
    }
}

/// The patterns that have been compiled lately.
pub struct Cache {
    last: Option<Rc<Entry>>,
    /// Empty, or [`SETS`].
    sets: Vec<[Option<Rc<Entry>>; WAYS]>,
    size: usize,
    insertions: usize,
}

impl Cache {
    pub const fn new() -> Self {
        Cache {
            last: None,
            sets: Vec::new(),
            size: 0,
            insertions: 0,
        }
    }

    /// `matchesGlob(path, pattern)`. `goes_on` is asked now and then.
    #[inline(always)]
    pub fn matches(
        &mut self,
        path: CodeUnits<'_>,
        pattern: CodeUnits<'_>,
        options: Options,
        goes_on: &mut dyn FnMut() -> bool,
    ) -> Result<bool, Error> {
        let entry = match &self.last {
            Some(last) if last.is_of(pattern, options) => last,
            _ => self.make_last(pattern, options, goes_on)?,
        };
        Ok(entry.pattern.matches(path, goes_on)?)
    }

    #[inline(never)]
    fn make_last(
        &mut self,
        text: CodeUnits<'_>,
        options: Options,
        goes_on: &mut dyn FnMut() -> bool,
    ) -> Result<&Entry, Error> {
        let key = bytes_of(text);
        let set = bun_wyhash::hash(key) as usize % SETS;
        let mut known = self.sets.get(set).into_iter().flatten().flatten();
        if let Some(entry) = known.find(|entry| entry.is_of(text, options)) {
            return Ok(self.last.insert(Rc::clone(entry)));
        }
        let pattern = Pattern::compile(text, options, goes_on)?;
        let entry = Rc::new(Entry {
            key: key.into(),
            is_wide: crate::is_wide(text),
            options,
            size: size_of::<Entry>() + key.len() + pattern.size(),
            pattern,
        });
        if entry.size <= MOST_BYTES {
            self.keep(Rc::clone(&entry), set);
        }
        Ok(self.last.insert(entry))
    }

    fn keep(&mut self, entry: Rc<Entry>, set: usize) {
        if self.size + entry.size > MOST_BYTES {
            self.sets.clear();
            self.size = 0;
        }
        self.sets.resize_with(SETS, Default::default);
        self.insertions += 1;
        self.size += entry.size;
        let set = &mut self.sets[set];
        let way = set.iter().position(Option::is_none);
        let replaced = set[way.unwrap_or(self.insertions % WAYS)].replace(entry);
        self.size -= replaced.map_or(0, |replaced| replaced.size);
    }
}
