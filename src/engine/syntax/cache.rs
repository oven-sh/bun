//! What it takes to parse a function again without the functions inside it.

use crate::names::Name;
use crate::options::FunctionFlags;

/// Belongs to one source. It can be dropped at any time.
#[derive(Default)]
pub struct SourceCache {
    pub(crate) outline: Outline,
    /// `Source::bytes` of a source in UTF-16.
    pub(crate) narrowed: Vec<u8>,
}

/// An ordinary function in strict code that a tool has looked at: not async, no generator, outside any class, and
/// without a direct `eval`.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct KnownFunction {
    pub parameters_start: u32,
    pub end: u32,
    pub length: u32,
}

/// A name in the source.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct KnownCapture {
    pub start: u32,
    pub length: u32,
    pub may_be_assigned: bool,
}

impl SourceCache {
    pub fn is_empty(&self) -> bool {
        self.outline.is_empty() && self.narrowed.is_empty()
    }

    /// For the inner functions of a function, which are all in one scope. `captures` has every variable of that scope
    /// that any of them refers to.
    pub fn add_known(
        &mut self,
        source_length: usize,
        functions: &[KnownFunction],
        captures: &[KnownCapture],
    ) {
        let outline = &mut self.outline;
        outline.source_length = source_length;
        outline.entries.reserve(functions.len());
        outline.told_captures = captures.into();
        outline.first_told = functions.first().map_or(0, |it| it.parameters_start);
        for function in functions {
            let summary = Summary {
                end: function.end,
                length: function.length,
                flags: FunctionFlags::STRICT,
                traits: Traits::TOLD,
            };
            outline.add(function.parameters_start, summary);
        }
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub(crate) struct Traits: u8 {
        /// The initializer of a field.
        const INITIALIZER = 1 << 0;
        /// A scope inside a function, of which there is nothing to sum up.
        const SCOPE = 1 << 1;
        const ARROW = 1 << 2;
        const CONTAINS_EVAL = 1 << 3;
        const TAGGED_TEMPLATE = 1 << 4;
        const PRIVATE_NAMES = 1 << 5;
        const HIDDEN_FROM_PARAMETERS = 1 << 6;
        /// See [`SourceCache::add_known`]. Nothing is known of what is inside.
        const TOLD = 1 << 7;

        /// Tells apart what starts at one offset.
        const PART = Self::INITIALIZER.bits() | Self::SCOPE.bits();
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Summary {
    pub(crate) end: u32,
    pub(crate) length: u32,
    pub(crate) flags: FunctionFlags,
    pub(crate) traits: Traits,
}

/// A binding that an inner function refers to.
#[derive(Clone, Copy)]
pub(crate) struct Captured(u32);

impl Captured {
    const IMPLICIT: u32 = 1 << 31;

    /// By its place among those that the scope declares.
    pub(crate) fn declared(index: u32, is_written: bool) -> Captured {
        Captured(index << 1 | u32::from(is_written))
    }

    /// A constant of [`Name`].
    pub(crate) fn implicit(name: Name, is_written: bool) -> Captured {
        Captured(Self::IMPLICIT | Self::declared(name.index() as u32, is_written).0)
    }

    pub(crate) fn binding(self) -> Result<usize, Name> {
        let index = (self.0 & !Self::IMPLICIT) >> 1;
        match Name::from_word(index) {
            Some(name) if self.0 & Self::IMPLICIT != 0 => Err(name),
            _ => Ok(index as usize),
        }
    }

    pub(crate) fn is_written(self) -> bool {
        self.0 & 1 != 0
    }
}

struct Entry {
    start: u32,
    summary: Summary,
    /// They start where those of the entry before end.
    end_of_captured: u32,
    /// The index of another entry of the bucket plus one, or zero.
    next: u32,
}

/// So many units of the source share a bucket.
const BUCKET_SHIFT: u32 = 7;

/// If it has a function that is not `TOLD`, it has all that is inside too.
#[derive(Default)]
pub(crate) struct Outline {
    buckets: Vec<u32>,
    entries: Vec<Entry>,
    captured: Vec<Captured>,
    pub(crate) told_captures: Box<[KnownCapture]>,
    /// Where the first function starts that is `TOLD`, or zero.
    pub(crate) first_told: u32,
    source_length: usize,
    is_of_module: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct Found(usize);

impl Outline {
    /// Before a parse. What is a comment in a script is none in a module.
    pub(crate) fn prepare(&mut self, source_length: usize, is_module: bool) {
        if self.is_of_module != is_module {
            *self = Outline::default();
        }
        (self.source_length, self.is_of_module) = (source_length, is_module);
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// `part` is empty for a function, which starts with its parameters.
    #[inline]
    pub(crate) fn find(&self, start: u32, part: Traits) -> Option<Found> {
        let mut link = *self.buckets.get((start >> BUCKET_SHIFT) as usize)?;
        loop {
            let index = (link as usize).wrapping_sub(1);
            let entry = self.entries.get(index)?;
            if entry.start == start && entry.summary.traits & Traits::PART == part {
                return Some(Found(index));
            }
            link = entry.next;
        }
    }

    #[inline]
    pub(crate) fn summary(&self, found: Found) -> Summary {
        self.entries[found.0].summary
    }

    fn end_of_captured(&self, entries: usize) -> usize {
        (self.entries[..entries].last()).map_or(0, |entry| entry.end_of_captured as usize)
    }

    pub(crate) fn captured(&self, found: Found) -> &[Captured] {
        &self.captured[self.end_of_captured(found.0)..self.end_of_captured(found.0 + 1)]
    }

    /// For the next entry.
    #[inline]
    pub(crate) fn note(&mut self, captured: Captured) {
        self.captured.push(captured);
    }

    pub(crate) fn has_notes(&self) -> bool {
        self.captured.len() > self.end_of_captured(self.entries.len())
    }

    #[inline]
    pub(crate) fn add(&mut self, start: u32, summary: Summary) {
        if self.buckets.is_empty() {
            self.buckets = vec![0; (self.source_length >> BUCKET_SHIFT) + 1];
        }
        let link = self.entries.len() as u32 + 1;
        let bucket = &mut self.buckets[(start >> BUCKET_SHIFT) as usize];
        self.entries.push(Entry {
            start,
            summary,
            end_of_captured: self.captured.len() as u32,
            next: core::mem::replace(bucket, link),
        });
    }

    #[inline(always)]
    pub(crate) fn len(&self) -> u32 {
        self.entries.len() as u32
    }

    /// Drops the notes too.
    pub(crate) fn truncate(&mut self, len: u32) {
        for entry in self.entries.drain(len as usize..).rev() {
            self.buckets[(entry.start >> BUCKET_SHIFT) as usize] = entry.next;
        }
        self.captured.truncate(self.end_of_captured(len as usize));
    }
}
