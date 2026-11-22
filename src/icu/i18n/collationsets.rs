//! The tailored set, and the sets of contractions and expansions. ICU4C: collationsets.cpp

use crate::common::memory::{Appendable, check_oom, try_push};
use crate::common::normalizer2impl::hangul;
use crate::common::sink::{TextBuf, TextSink};
use crate::common::ucharstrie;
use crate::common::uniset::UnicodeSet;
use crate::common::unistr::UString;
use crate::common::utypes::*;
use crate::i18n::collation::{self, CONTRACT_SINGLE_CP_NO_MATCH, CONTRACTION_TAG, PREFIX_TAG};
use crate::i18n::collationdata::CollationData;
use std::cmp::Ordering;
use std::iter::Peekable;
use std::ops::RangeInclusive;

/// An inclusive range of code points.
type Range = (u32, u32);

// In damaged data, context tables can form cycles, and a trie of a hundred units can hold 2^40 strings.
const MAX_DEPTH: u32 = 100;
/// `MAX_INDEX + 1` mappings, each with a prefix and a suffix, in the tailoring and in the base.
const MAX_STRINGS: u64 = 4 * (collation::MAX_INDEX as u64 + 1);
const MAX_UNITS: u64 = 1 << 28;

/// Iterates over the prefixes or suffixes of a prefix or contraction CE32.
fn contexts(d: &CollationData, ce32: u32) -> ucharstrie::Iterator<'static> {
    ucharstrie::Iterator::new(d.contexts.slice(collation::index_from_ce32(ce32) + 2..))
}

/// A set, and the strings that `finish` adds to it, so that they are sorted once.
struct SetContents<'a> {
    set: &'a mut UnicodeSet,
    strings: Vec<Vec<u16>>,
}

impl<'a> SetContents<'a> {
    fn new(set: &'a mut UnicodeSet) -> Self {
        let strings = Vec::new();
        Self { set, strings }
    }

    fn finish(self) {
        self.set.add_strings(self.strings);
    }
}

/// The state of an iteration over nested context tables.
#[derive(Default)]
struct Traversal {
    /// In text order. The tables store prefixes reversed.
    prefix: Vec<u16>,
    suffix: Vec<u16>,
    string_count: u64,
    /// The total length of the prefixes and suffixes.
    unit_count: u64,
}

impl Traversal {
    fn count_strings(&mut self, count: u32, suffix_length: usize) -> Result<(), UErrorCode> {
        self.string_count += u64::from(count);
        self.unit_count += u64::from(count) * (self.prefix.len() + suffix_length) as u64;
        if self.string_count > MAX_STRINGS || self.unit_count > MAX_UNITS {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        Ok(())
    }

    fn set_context(&mut self, tag: u32, context: &[u16]) {
        if tag == PREFIX_TAG {
            self.prefix.assign(context);
            self.prefix.reverse_code_points();
        } else {
            self.suffix.assign(context);
        }
    }

    /// Adds `prefix + c + suffix` for each code point of the range.
    fn add(
        &self,
        contents: &mut SetContents,
        (start, end): Range,
        suffix: &[u16],
    ) -> Result<(), UErrorCode> {
        if self.prefix.is_empty() && suffix.is_empty() {
            contents.set.add_range(start, end);
            return Ok(());
        }
        for c in start..=end {
            let mut string = Vec::new();
            string.add_all(&self.prefix);
            string.add_code_point(c);
            string.add_all(suffix);
            check_oom()?;
            try_push(&mut contents.strings, string)?;
        }
        Ok(())
    }
}

/// Calls `handle` with each range of `data` until it fails.
fn try_for_each_range(
    data: &CollationData,
    mut handle: impl FnMut(Range, u32) -> Result<(), UErrorCode>,
) -> Result<(), UErrorCode> {
    let mut result = Ok(());
    data.trie.enum_ranges(|start, end, ce32| {
        result = handle((start, end), ce32);
        result.is_ok()
    });
    result
}

struct ContractionsAndExpansions<'a> {
    contractions: SetContents<'a>,
    expansions: SetContents<'a>,
    traversal: Traversal,
}

impl ContractionsAndExpansions<'_> {
    /// Visits the mappings of the data, then those of the base for untailored code points.
    fn for_data(&mut self, data: &CollationData) -> Result<(), UErrorCode> {
        let Some(base) = data.base else {
            return try_for_each_range(data, |range, ce32| self.handle_ce32(data, range, ce32, 0));
        };
        let mut tailored = UnicodeSet::new();
        try_for_each_range(data, |range, ce32| {
            if ce32 != collation::FALLBACK_CE32 {
                tailored.add_range(range.0, range.1);
            }
            self.handle_ce32(data, range, ce32, 0)
        })?;
        let mut excluded = tailored.ranges().peekable();
        try_for_each_range(base, |range, ce32| {
            for_each_part_outside(range, &mut excluded, |part| {
                self.handle_ce32(base, part, ce32, 0)
            })
        })
    }

    fn handle_ce32(
        &mut self,
        d: &CollationData,
        range: Range,
        ce32: u32,
        depth: u32,
    ) -> Result<(), UErrorCode> {
        let ce32 = d.final_ce32(ce32);
        if !collation::is_special_ce32(ce32) {
            return Ok(());
        }
        match collation::tag_from_ce32(ce32) {
            // With a prefix, `handle_table` has added the strings already.
            collation::LATIN_EXPANSION_TAG
            | collation::EXPANSION32_TAG
            | collation::EXPANSION_TAG
            | collation::HANGUL_TAG
                if self.traversal.prefix.is_empty() =>
            {
                (self.traversal).add(&mut self.expansions, range, &self.traversal.suffix)
            }
            PREFIX_TAG | CONTRACTION_TAG => self.handle_table(d, range, ce32, depth + 1),
            _ => Ok(()),
        }
    }

    fn handle_table(
        &mut self,
        d: &CollationData,
        range: Range,
        ce32: u32,
        depth: u32,
    ) -> Result<(), UErrorCode> {
        if depth > MAX_DEPTH {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        let tag = collation::tag_from_ce32(ce32);
        if tag == PREFIX_TAG || ce32 & CONTRACT_SINGLE_CP_NO_MATCH == 0 {
            let default = d.default_ce32(collation::index_from_ce32(ce32));
            self.handle_ce32(d, range, default, depth)?;
        }
        let mut contexts = contexts(d, ce32);
        while contexts.next() {
            let traversal = &mut self.traversal;
            traversal.set_context(tag, contexts.get_string());
            traversal.count_strings(range.1 - range.0 + 1, traversal.suffix.len())?;
            traversal.add(&mut self.contractions, range, &traversal.suffix)?;
            // Prefix mappings always count as expansions.
            if !traversal.prefix.is_empty() {
                traversal.add(&mut self.expansions, range, &traversal.suffix)?;
            }
            self.handle_ce32(d, range, contexts.get_value() as u32, depth)?;
        }
        self.traversal.set_context(tag, &[]);
        Ok(())
    }
}

/// Calls `handle` for each part of the range outside `excluded`. Successive calls must pass ascending ranges.
fn for_each_part_outside(
    (mut start, end): Range,
    excluded: &mut Peekable<impl Iterator<Item = RangeInclusive<u32>>>,
    mut handle: impl FnMut(Range) -> Result<(), UErrorCode>,
) -> Result<(), UErrorCode> {
    while let Some(skipped) = excluded.peek().filter(|skipped| *skipped.start() <= end) {
        if start < *skipped.start() {
            handle((start, *skipped.start() - 1))?;
        }
        if *skipped.end() >= end {
            return Ok(()); // `skipped` may overlap the next range too.
        }
        start = start.max(*skipped.end() + 1);
        excluded.next();
    }
    handle((start, end))
}

/// Includes the prefix mappings.
pub(crate) fn add_contractions_and_expansions(
    data: &CollationData,
    contractions: &mut UnicodeSet,
    expansions: &mut UnicodeSet,
) -> Result<(), UErrorCode> {
    let mut collector = ContractionsAndExpansions {
        contractions: SetContents::new(contractions),
        expansions: SetContents::new(expansions),
        traversal: Traversal::default(),
    };
    collector.for_data(data)?;
    collector.contractions.finish();
    collector.expansions.finish();
    Ok(())
}

struct TailoredSet<'a> {
    data: &'a CollationData,
    base: &'a CollationData,
    tailored: SetContents<'a>,
    traversal: Traversal,
}

impl TailoredSet<'_> {
    fn for_data(&mut self) -> Result<(), UErrorCode> {
        let (data, base) = (self.data, self.base);
        try_for_each_range(data, |(start, end), ce32| match data.final_ce32(ce32) {
            collation::FALLBACK_CE32 => Ok(()),
            ce32 => (start..=end)
                .try_for_each(|c| self.compare(c, ce32, base.final_ce32(base.ce32(c)), 0)),
        })
    }

    fn compare(
        &mut self,
        c: u32,
        mut ce32: u32,
        mut base_ce32: u32,
        depth: u32,
    ) -> Result<(), UErrorCode> {
        let (data, base) = (self.data, self.base);
        if depth == MAX_DEPTH {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        for tag in [PREFIX_TAG, CONTRACTION_TAG] {
            let (has_table, base_has_table) = (
                collation::has_ce32_tag(ce32, tag),
                collation::has_ce32_tag(base_ce32, tag),
            );
            match (has_table, base_has_table) {
                (true, true) => self.compare_contexts(c, tag, ce32, base_ce32, depth + 1)?,
                (true, false) => self.add_contexts(c, tag, data, ce32)?,
                (false, true) => self.add_contexts(c, tag, base, base_ce32)?,
                (false, false) => {}
            }
            // The flag does not count if only the base has a contraction.
            let without_context = |d: &CollationData, ce32: u32| {
                if has_table && tag == CONTRACTION_TAG && ce32 & CONTRACT_SINGLE_CP_NO_MATCH != 0 {
                    collation::NO_CE32
                } else {
                    d.final_ce32(d.default_ce32(collation::index_from_ce32(ce32)))
                }
            };
            if has_table {
                ce32 = without_context(data, ce32);
            }
            if base_has_table {
                base_ce32 = without_context(base, base_ce32);
            }
        }
        if self.differs(c, ce32, base_ce32) {
            (self.traversal).add(&mut self.tailored, (c, c), &self.traversal.suffix)?;
        }
        Ok(())
    }

    /// Compares the mappings without context. A base mapping with `OFFSET_TAG` always counts as different.
    fn differs(&self, c: u32, ce32: u32, base_ce32: u32) -> bool {
        let (data, base) = (self.data, self.base);
        let tag_of =
            |ce32: u32| collation::is_special_ce32(ce32).then(|| collation::tag_from_ce32(ce32));
        let expansion = |ce32: u32| {
            let index = collation::index_from_ce32(ce32);
            index..index + collation::length_from_ce32(ce32)
        };
        tag_of(ce32) != tag_of(base_ce32)
            || match tag_of(ce32) {
                Some(collation::OFFSET_TAG) => true,
                Some(collation::EXPANSION32_TAG) => (data.ce32s.slice(expansion(ce32)).iter())
                    .ne(base.ce32s.slice(expansion(base_ce32)).iter()),
                Some(collation::EXPANSION_TAG) => (data.ces.slice(expansion(ce32)).iter())
                    .ne(base.ces.slice(expansion(base_ce32)).iter()),
                Some(collation::HANGUL_TAG) => {
                    let (jamos, length) = hangul::decompose(c);
                    jamos
                        .iter()
                        .take(length)
                        .any(|&jamo| self.tailored.set.contains(u32::from(jamo)))
                }
                _ => ce32 != base_ce32,
            }
    }

    // ICU4C: collationsets.cpp, TailoredSet::comparePrefixes, TailoredSet::compareContractions
    fn compare_contexts(
        &mut self,
        c: u32,
        tag: u32,
        ce32: u32,
        base_ce32: u32,
        depth: u32,
    ) -> Result<(), UErrorCode> {
        let (mut tailored_contexts, mut base_contexts) =
            (contexts(self.data, ce32), contexts(self.base, base_ce32));
        // Sorts after every context.
        let sentinel: &[u16] = if tag == PREFIX_TAG {
            &[0xffff]
        } else {
            &[0xffff, 0xffff]
        };
        let (mut has_tailored, mut has_base) = (tailored_contexts.next(), base_contexts.next());
        while has_tailored || has_base {
            let context = if has_tailored {
                tailored_contexts.get_string()
            } else {
                sentinel
            };
            let base_context = if has_base {
                base_contexts.get_string()
            } else {
                sentinel
            };
            let (ce32, base_ce32) = (
                tailored_contexts.get_value() as u32,
                base_contexts.get_value() as u32,
            );
            let order = context.cmp(base_context);
            match order {
                Ordering::Less => self.add_context(c, tag, self.data, context, ce32)?,
                Ordering::Greater => {
                    self.add_context(c, tag, self.base, base_context, base_ce32)?
                }
                Ordering::Equal => {
                    self.traversal.count_strings(1, context.len())?;
                    self.traversal.set_context(tag, context);
                    self.compare(c, ce32, base_ce32, depth)?;
                    self.traversal.set_context(tag, &[]);
                }
            }
            if order.is_le() {
                has_tailored = tailored_contexts.next();
            }
            if order.is_ge() {
                has_base = base_contexts.next();
            }
        }
        Ok(())
    }

    fn add_contexts(
        &mut self,
        c: u32,
        tag: u32,
        d: &CollationData,
        ce32: u32,
    ) -> Result<(), UErrorCode> {
        let mut contexts = contexts(d, ce32);
        while contexts.next() {
            let ce32 = contexts.get_value() as u32;
            self.add_context(c, tag, d, contexts.get_string(), ce32)?;
        }
        Ok(())
    }

    fn add_context(
        &mut self,
        c: u32,
        tag: u32,
        d: &CollationData,
        context: &[u16],
        ce32: u32,
    ) -> Result<(), UErrorCode> {
        if tag == CONTRACTION_TAG {
            self.traversal.count_strings(1, context.len())?;
            return self.traversal.add(&mut self.tailored, (c, c), context);
        }
        self.traversal.set_context(tag, context);
        let ce32 = d.final_ce32(ce32);
        if collation::has_ce32_tag(ce32, CONTRACTION_TAG) {
            self.add_contexts(c, CONTRACTION_TAG, d, ce32)?;
        }
        self.add_context(c, CONTRACTION_TAG, d, &[], ce32)?;
        self.traversal.set_context(tag, &[]);
        Ok(())
    }
}

pub(crate) fn tailored_set(data: &CollationData) -> Result<UnicodeSet, UErrorCode> {
    let mut set = UnicodeSet::new();
    if let Some(base) = data.base {
        let mut collector = TailoredSet {
            data,
            base,
            tailored: SetContents::new(&mut set),
            traversal: Traversal::default(),
        };
        collector.for_data()?;
        collector.tailored.finish();
    }
    Ok(set)
}
