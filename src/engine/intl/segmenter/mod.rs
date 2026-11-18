//! `Intl.Segmenter`

mod evident;

use core::cell::{OnceCell, RefCell};
use core::ops::Range;
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_text::{CodeUnit, StringRef, with_text};
use bun_icu::break_iterator::{BreakIterator, BreakRules, Kind, MAX_TEXT_LENGTH};
use evident::{follows_boundary_closely, grapheme_around, grapheme_end, last_boundary};

use crate::error::IcuResult;
use crate::locale_resolver::ResolvedLocale;
use crate::{AvailableLocales, Cache, Error, LanguageTag, Result};

option_enum! {
    #[derive(Default)]
    pub enum Granularity: "granularity must be either \"grapheme\", \"word\", or \"sentence\"" {
        #[default]
        Grapheme = "grapheme",
        Word = "word",
        Sentence = "sentence",
    }
}

const ESTIMATED_RULES_SIZE: usize = 6 << 10;
const ESTIMATED_ITERATOR_SIZE: usize = 2 << 10;

/// Those with the same locale and granularity are one.
#[derive(Clone)]
pub struct Segmenter(Rc<Shared>);

struct Shared {
    locale: ResolvedLocale,
    granularity: Granularity,
    rules: OnceCell<BreakRules>,
}

impl Segmenter {
    pub fn new(
        cache: &Cache,
        requested: &[LanguageTag],
        granularity: Granularity,
    ) -> Result<Segmenter> {
        let locale = ResolvedLocale::new(cache, AvailableLocales::general(), requested)?;
        cache.segmenters.find_or_insert(
            |it| it.0.granularity == granularity && it.0.locale == locale,
            || {
                cache.note_allocation(ESTIMATED_RULES_SIZE);
                Ok(Segmenter(Rc::new(Shared {
                    locale: locale.clone(),
                    granularity,
                    rules: OnceCell::new(),
                })))
            },
        )
    }

    pub fn locale(&self) -> &LanguageTag {
        self.0.locale.tag()
    }

    pub fn granularity(&self) -> Granularity {
        self.0.granularity
    }

    pub fn segment(&self, string: StringRef) -> Result<Segments> {
        if string.len() > MAX_TEXT_LENGTH {
            return Err(Error::OutOfMemory);
        }
        let input = Rc::new(Input {
            segmenter: self.clone(),
            string,
            units: OnceCell::new(),
        });
        Ok(Segments {
            iterator: RefCell::new(None),
            walker: SegmentIterator::new(input),
            walked: RefCell::default(),
        })
    }

    fn rules(&self) -> Result<&BreakRules> {
        self.0.rules.get_or_try_init(|| {
            let kind = match self.0.granularity {
                Granularity::Grapheme => Kind::Grapheme,
                Granularity::Word => Kind::Word,
                Granularity::Sentence => Kind::Sentence,
            };
            BreakRules::open(kind, &self.0.locale.icu_locale(&[])?)
                .or_type_error("failed to initialize Segmenter")
        })
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Segment {
    pub range: Range<usize>,
    /// Of `Granularity::Word`.
    pub is_word_like: Option<bool>,
}

impl Segment {
    fn grapheme(range: Range<usize>) -> Segment {
        Segment {
            range,
            is_word_like: None,
        }
    }
}

struct Input {
    segmenter: Segmenter,
    string: StringRef,
    /// The copy that break iterators read.
    units: OnceCell<Arc<Vec<u16>>>,
}

impl Input {
    fn iterator<'a>(
        &self,
        slot: &'a mut Option<BreakIterator>,
        failure: &'static str,
    ) -> Result<&'a mut BreakIterator> {
        if let Some(iterator) = slot {
            return Ok(iterator);
        }
        let units = self.units.get_or_try_init(|| {
            let mut units = Vec::new();
            (units.try_reserve_exact(self.string.len())).map_err(|_| Error::OutOfMemory)?;
            with_text!(self.string.text(), |text| units
                .extend(text.iter().map(|unit| unit.to_u16())));
            Ok::<_, Error>(Arc::new(units))
        })?;
        let iterator = self.segmenter.rules()?.iterate(Arc::clone(units));
        Ok(slot.insert(iterator.or_type_error(failure)?))
    }

    fn segment(&self, range: Range<usize>, at_end: &mut BreakIterator) -> Segment {
        let is_word = self.segmenter.granularity() == Granularity::Word;
        Segment {
            range,
            is_word_like: is_word.then(|| at_end.follows_word()),
        }
    }

    /// Whether no break iterator is needed.
    fn is_plain(&self) -> bool {
        self.segmenter.granularity() == Granularity::Grapheme && self.string.is_latin1()
    }
}

/// The result of `segment`.
pub struct Segments {
    /// Jumps to a position, which takes the longer the further that is from a boundary.
    iterator: RefCell<Option<BreakIterator>>,
    walker: SegmentIterator,
    walked: RefCell<Walked>,
}

/// What a walker has found since it was last put somewhere else.
#[derive(Default)]
struct Walked {
    start: usize,
    /// Twice the end of each segment, and one more if it is like a word.
    ends: Vec<u32>,
}

impl Walked {
    fn range(&self) -> Range<usize> {
        self.start..self.ends.last().map_or(self.start, |&end| end as usize / 2)
    }
}

impl Segments {
    /// `index` is a result of ToIntegerOrInfinity.
    pub fn containing(&self, index: f64) -> Result<Option<Segment>> {
        let input = &self.walker.input;
        if !(0.0..input.string.len() as f64).contains(&index) {
            return Ok(None);
        }
        let (index, text) = (index as usize, input.string.text());
        let granularity = input.segmenter.granularity();
        if granularity == Granularity::Grapheme
            && let Some(range) = grapheme_around(text, index)
        {
            return Ok(Some(Segment::grapheme(range)));
        }
        if follows_boundary_closely(text, index, granularity) {
            self.jump_to(index).map(Some)
        } else {
            self.walk_to(index)
        }
    }

    fn jump_to(&self, index: usize) -> Result<Segment> {
        let input = &self.walker.input;
        let mut iterator = self.iterator.borrow_mut();
        let iterator = input.iterator(&mut iterator, "failed to initialize Segments")?;
        iterator.following(index);
        let start = iterator.previous().unwrap_or(0);
        let end = iterator.next().unwrap_or(input.string.len());
        Ok(input.segment(start..end, iterator))
    }

    fn walk_to(&self, index: usize) -> Result<Option<Segment>> {
        let input = &self.walker.input;
        let granularity = input.segmenter.granularity();
        let walked = &mut *self.walked.borrow_mut();
        let known = walked.range();
        if !known.contains(&index) {
            let floor = if index < known.start { 0 } else { known.end };
            let boundary = last_boundary(input.string.text(), floor..index, granularity);
            if boundary.is_some() || index < known.start {
                let segment = boundary.map(|at| self.jump_to(at)).transpose()?;
                walked.start = segment.map_or(0, |it| it.range.start);
                walked.ends.clear();
                self.walker.state.borrow_mut().position = walked.start;
            }
        }
        while walked.range().end <= index {
            walked.ends.try_reserve(1).map_err(|_| Error::OutOfMemory)?;
            let Some(segment) = self.walker.next()? else {
                return Ok(None);
            };
            let is_word_like = segment.is_word_like == Some(true);
            (walked.ends).push(segment.range.end as u32 * 2 + u32::from(is_word_like));
        }
        let at = walked
            .ends
            .partition_point(|&end| end as usize / 2 <= index);
        let (before, end) = (walked.ends[..at].last(), walked.ends[at]);
        Ok(Some(Segment {
            range: before.map_or(walked.start, |&it| it as usize / 2)..end as usize / 2,
            is_word_like: (granularity == Granularity::Word).then_some(end % 2 == 1),
        }))
    }

    /// Of what it remembers of the segments that have been asked for.
    pub fn remembered_size(&self) -> usize {
        self.walked.borrow().ends.capacity() * size_of::<u32>()
    }

    /// Of what it can come to own.
    pub fn estimated_size(&self) -> usize {
        let input = &self.walker.input;
        match input.is_plain() {
            true => 0,
            false => input.string.len() * size_of::<u16>() + 2 * ESTIMATED_ITERATOR_SIZE,
        }
    }

    pub fn iterate(&self) -> SegmentIterator {
        SegmentIterator::new(Rc::clone(&self.walker.input))
    }
}

pub struct SegmentIterator {
    input: Rc<Input>,
    state: RefCell<IteratorState>,
}

#[derive(Default)]
struct IteratorState {
    position: usize,
    iterator: Option<BreakIterator>,
    /// Where `iterator` stands.
    iterator_position: usize,
}

impl SegmentIterator {
    fn new(input: Rc<Input>) -> SegmentIterator {
        SegmentIterator {
            input,
            state: RefCell::default(),
        }
    }

    /// Of what it can come to own.
    pub fn estimated_size(&self) -> usize {
        match self.input.is_plain() {
            true => 0,
            false => ESTIMATED_ITERATOR_SIZE,
        }
    }

    pub fn next(&self) -> Result<Option<Segment>> {
        let state = &mut *self.state.borrow_mut();
        let (start, length) = (state.position, self.input.string.len());
        if start >= length {
            state.iterator = None;
            return Ok(None);
        }
        if self.input.segmenter.granularity() == Granularity::Grapheme
            && let Some(end) = grapheme_end(self.input.string.text(), start)
        {
            state.position = end;
            return Ok(Some(Segment::grapheme(start..end)));
        }
        let failure = "failed to initialize SegmentIterator";
        let iterator = self.input.iterator(&mut state.iterator, failure)?;
        let end = if state.iterator_position == start {
            iterator.next()
        } else {
            iterator.following(start)
        };
        let end = end.unwrap_or(length);
        (state.position, state.iterator_position) = (end, end);
        Ok(Some(self.input.segment(start..end, iterator)))
    }
}
