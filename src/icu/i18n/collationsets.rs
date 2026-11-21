//! The contractions and expansions of the root collation. ICU4C: collationsets.cpp

use crate::common::memory::{Appendable, check_oom, try_push};
use crate::common::sink::{TextBuf, TextSink};
use crate::common::ucharstrie;
use crate::common::uniset::UnicodeSet;
use crate::common::unistr::UString;
use crate::common::utypes::*;
use crate::i18n::collation::{self, CONTRACTION_TAG, PREFIX_TAG};
use crate::i18n::collationdata::CollationData;

/// An inclusive range of code points.
type Range = (u32, u32);

// In damaged data, context tables can form cycles, and a trie of a hundred units can hold 2^40 strings.
const MAX_DEPTH: u32 = 100;
const MAX_UNITS: usize = 1 << 22;

struct Collector<'a> {
    data: &'a CollationData,
    expanding_code_points: &'a mut UnicodeSet,
    contractions: Vec<Vec<u16>>,
    expansions: Vec<Vec<u16>>,
    /// In text order. The tables store prefixes reversed.
    prefix: Vec<u16>,
    suffix: Vec<u16>,
    unit_count: usize,
}

impl Collector<'_> {
    fn handle_ce32(&mut self, range: Range, mut ce32: u32, depth: u32) -> Result<(), UErrorCode> {
        if collation::has_ce32_tag(ce32, collation::DIGIT_TAG) {
            ce32 = self.data.ce32s.at(collation::index_from_ce32(ce32));
        }
        if !collation::is_special_ce32(ce32) {
            return Ok(());
        }
        match collation::tag_from_ce32(ce32) {
            collation::LATIN_EXPANSION_TAG
            | collation::EXPANSION32_TAG
            | collation::EXPANSION_TAG
            | collation::HANGUL_TAG => {
                if !self.prefix.is_empty() || !self.suffix.is_empty() {
                    return self.add_strings(range, |this| &mut this.expansions);
                }
                self.expanding_code_points.add_range(range.0, range.1);
                Ok(())
            }
            PREFIX_TAG | CONTRACTION_TAG => self.handle_table(range, ce32, depth + 1),
            _ => Ok(()),
        }
    }

    fn handle_table(&mut self, range: Range, ce32: u32, depth: u32) -> Result<(), UErrorCode> {
        if depth > MAX_DEPTH {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        let (tag, index) = (
            collation::tag_from_ce32(ce32),
            collation::index_from_ce32(ce32),
        );
        self.handle_ce32(range, self.data.default_ce32(index), depth)?;
        let mut contexts = ucharstrie::Iterator::new(self.data.contexts.slice(index + 2..));
        while contexts.next() {
            self.set_context(tag, contexts.get_string());
            self.add_strings(range, |this| &mut this.contractions)?;
            // Prefix mappings always count as expansions.
            if !self.prefix.is_empty() {
                self.add_strings(range, |this| &mut this.expansions)?;
            }
            self.handle_ce32(range, contexts.get_value() as u32, depth)?;
        }
        self.set_context(tag, &[]);
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
    fn add_strings(
        &mut self,
        (start, end): Range,
        to: fn(&mut Self) -> &mut Vec<Vec<u16>>,
    ) -> Result<(), UErrorCode> {
        for c in start..=end {
            let mut string = Vec::new();
            string.add_all(&self.prefix);
            string.add_code_point(c);
            string.add_all(&self.suffix);
            self.unit_count += string.len();
            if self.unit_count > MAX_UNITS {
                return Err(U_INVALID_FORMAT_ERROR);
            }
            check_oom()?;
            try_push(to(self), string)?;
        }
        Ok(())
    }
}

/// Includes the prefix mappings. Requires data without a base.
pub(crate) fn add_contractions_and_expansions(
    data: &CollationData,
    contractions: &mut UnicodeSet,
    expansions: &mut UnicodeSet,
) -> Result<(), UErrorCode> {
    let mut collector = Collector {
        data,
        expanding_code_points: expansions,
        contractions: Vec::new(),
        expansions: Vec::new(),
        prefix: Vec::new(),
        suffix: Vec::new(),
        unit_count: 0,
    };
    let mut result = Ok(());
    data.trie.enum_ranges(|start, end, ce32| {
        result = collector.handle_ce32((start, end), ce32, 0);
        result.is_ok()
    });
    contractions.add_strings(collector.contractions);
    collector
        .expanding_code_points
        .add_strings(collector.expansions);
    result
}
