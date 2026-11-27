//! `matchesGlob`: minimatch 10.2.6 with the options of <https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/glob.js#L119-L132>. `bun_glob` has other semantics, and `internal/fs/glob.ts` vendors an older minimatch.

mod ast;
mod braces;
mod budget;
mod cache;
mod class;
mod preprocess;
mod regexp;

use core::mem::MaybeUninit;
use core::ops::Range;

use bun_collections::smallvec::SmallVec;
use bun_core::strings::{self, CodeUnits};
use bun_core::vec::BorrowedBuf;
use bun_core::w;
use bun_paths::PathChar;

use crate::{
    BACKSLASH, CodeUnit, DOT, Platform, SLASH, Scratch, byte_at, dot_segment_len, scan, unicode,
    win32,
};
use ast::MmPattern;
pub use budget::Abort;
use budget::{ALLOCATION_OVERHEAD, Budget, cost, try_with_capacity};
pub use cache::Cache;
use preprocess::{GlobParts, PartId};
use regexp::{Flags, RegExp};

/// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L301>
const MAX_PATTERN_LENGTH: usize = 64 * 1024;
/// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1285>
const MAX_GLOBSTAR_RECURSION: usize = 200;

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Options {
    pub platform: Platform,
    pub nocase: bool,
}

pub enum Error {
    PatternTooLong,
    InvalidRegExp { message: Vec<u16> },
    Aborted(Abort),
}

impl From<Abort> for Error {
    fn from(abort: Abort) -> Self {
        Error::Aborted(abort)
    }
}

fn append_ascii(text: &mut Vec<u16>, ascii: &[u8]) {
    text.extend(ascii.iter().map(|&byte| u16::from(byte)));
}

/// On win32 `\` separates too: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1878-L1902>
#[inline(always)]
fn slash_split<U: CodeUnit>(
    path: &[U],
    platform: Platform,
    mut callback: impl FnMut(Range<usize>),
) {
    let is_win32 = platform == Platform::Win32;
    let other_sep = if is_win32 { BACKSLASH } else { SLASH };
    let mut start = 0;
    for (index, block) in path.chunks(scan::BLOCK).enumerate() {
        let mut separators = scan::either_bits(block, SLASH, other_sep);
        // `/^\/\/[^/]+/`
        if is_win32 && index == 0 && separators & 0b111 == 0b011 && path.len() > 2 {
            callback(0..0);
        }
        while let Some(bit) = separators.lowest_one() {
            separators &= separators - 1;
            let at = index * scan::BLOCK + bit as usize;
            if at != start || at == 0 {
                callback(start..at);
            }
            start = at + 1;
        }
    }
    callback(start..path.len());
}

/// `/^[a-z]:$/i`
#[inline(always)]
fn is_drive<U: CodeUnit>(part: &[U]) -> bool {
    part.len() == win32::DRIVE_LEN && win32::has_drive(part)
}

/// `/[?*]|[+@!]\(.*?\)|\[|\]/`
fn has_glob_magic(text: &[u16]) -> bool {
    let (mut is_open, mut previous) = (false, 0);
    text.iter().any(|&unit| {
        let opens = unit.eq_ascii(b'(') && matches!(previous, b'+' | b'@' | b'!');
        is_open = opens || (is_open && !strings::is_js_line_terminator(unit.into()));
        previous = unit.to_u8_saturating();
        matches!(previous, b'?' | b'*' | b'[' | b']') || (is_open && previous == b')')
    })
}

fn is_latin1(text: &[u16]) -> bool {
    text.iter().all(|&unit| unit <= u8::MAX.into())
}

/// Kept in both widths so that comparing with a path never converts.
struct Literal {
    utf16: Box<[u16]>,
    latin1: Option<Box<[u8]>>,
}

impl Literal {
    fn new(utf16: &[u16]) -> Self {
        Literal {
            utf16: utf16.into(),
            latin1: is_latin1(utf16).then(|| utf16.iter().map(|&unit| unit as u8).collect()),
        }
    }

    fn len(&self) -> usize {
        self.utf16.len()
    }

    #[inline(always)]
    fn eql<U: CodeUnit>(&self, text: &[U]) -> bool {
        match (U::units(text), &self.latin1) {
            (CodeUnits::U8(text), Some(latin1)) => scan::eql(latin1, text),
            (CodeUnits::U8(_), None) => false,
            (CodeUnits::U16(text), _) => scan::eql(&self.utf16, text),
        }
    }

    #[inline(always)]
    fn is_suffix_of<U: CodeUnit>(&self, text: &[U]) -> bool {
        text.len() >= self.len() && self.eql(&text[text.len() - self.len()..])
    }

    /// `text.toLowerCase().endsWith(this)`
    #[inline(always)]
    fn is_suffix_of_lowercased<U: CodeUnit>(
        &self,
        text: &[U],
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        match U::units(text) {
            CodeUnits::U8(text) => {
                budget.spend_unchecked(self.len());
                let start = text.len().checked_sub(self.len());
                Ok(start.is_some_and(|start| self.eql_lowercased_latin1(&text[start..])))
            }
            CodeUnits::U16(text) => self.is_suffix_of_lowercased_utf16(text, budget),
        }
    }

    #[inline(always)]
    fn eql_lowercased_latin1<U: CodeUnit>(&self, latin1: &[U]) -> bool {
        let to_lower = |unit: U| u16::from(unicode::to_lower_latin1(unit.to_u8_saturating()));
        let mut pairs = latin1.iter().zip(&self.utf16);
        pairs.all(|(&a, &b)| to_lower(a) == b)
    }

    #[inline(never)]
    fn is_suffix_of_lowercased_utf16(
        &self,
        text: &[u16],
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        // A Latin-1 unit is lowercased to one unit, whatever surrounds it.
        if let Some(start) = text.len().checked_sub(self.len())
            && is_latin1(&text[start..])
        {
            budget.spend_unchecked(self.len());
            return Ok(self.eql_lowercased_latin1(&text[start..]));
        }
        let text = unicode::end_to_lower_case(text, self.len());
        budget.spend(cost::CALL * text.len())?;
        Ok(self.is_suffix_of(unicode::to_lower_case(text, &mut Scratch::new())?))
    }
}

/// The last two ASCII units of a text, to reject most alternatives with one comparison.
#[derive(Clone, Copy, Default)]
struct SuffixFilter {
    units: u16,
    mask: u16,
}

impl SuffixFilter {
    #[inline(always)]
    fn new<C: Copy>(text: &[C], code: impl Fn(C) -> u32) -> Self {
        const IGNORE_CASE: u16 = (b'a' ^ b'A' ^ u8::MAX) as u16;
        let from_end = |count| Some(code(text[text.len().checked_sub(count)?]));
        let ascii = |count| from_end(count).filter(|&unit: &u32| unit < 0x80);
        let (units, mask) = match (ascii(2), ascii(1)) {
            (_, None) => (0, 0),
            (None, Some(last)) => (last, IGNORE_CASE),
            (Some(before), Some(last)) => (before << 8 | last, IGNORE_CASE << 8 | IGNORE_CASE),
        };
        SuffixFilter {
            units: units as u16,
            mask,
        }
    }

    #[inline(always)]
    fn may_match(self, other: Self) -> bool {
        (self.units ^ other.units) & self.mask & other.mask == 0
    }
}

/// A Bloom filter of parts, to reject most entries that need a literal part which the path lacks.
#[derive(Clone, Copy)]
struct PartSet(u64);

impl PartSet {
    fn new<'p, U: CodeUnit + 'p>(parts: impl Iterator<Item = &'p [U]>) -> Self {
        const FIBONACCI_MULTIPLIER: u32 = 0x9E37_79B1;
        PartSet(parts.fold(0, |bits, part| {
            let (first, last) = (byte_at(part, 0), byte_at(part, part.len().wrapping_sub(1)));
            let key = u32::from_le_bytes([first, last, part.len() as u8, 0]);
            bits | 1 << (key.wrapping_mul(FIBONACCI_MULTIPLIER) >> (u32::BITS - u64::BITS.ilog2()))
        }))
    }

    #[inline(always)]
    fn may_contain(self, other: Self) -> bool {
        other.0 & !self.0 == 0
    }
}

enum PartMatcher {
    Literal(Literal),
    /// `*`, `*.js` or `??.js`. `ext` is in lower case if `nocase`.
    Suffix {
        exact_len: Option<usize>,
        ext: Literal,
        nocase: bool,
    },
    Outlined(OutlinedMatcher),
}

/// The matchers that are not inlined into the loop over parts.
enum OutlinedMatcher {
    StarDotStar,
    DotStar,
    RegExp(Box<RegExp>),
}

impl PartMatcher {
    /// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1790-L1815>
    fn parse(glob: &[u16], nocase: bool, budget: &mut Budget<'_>) -> Result<Self, Error> {
        let may_be_magic =
            |unit: &u16| matches!(unit.to_u8_saturating(), b'?' | b'*' | b'[' | b'(');
        if !glob.iter().any(may_be_magic) {
            return Ok(PartMatcher::Literal(Literal::new(glob)));
        }
        let leading =
            |text: &[u16], ascii| text.iter().take_while(|unit| unit.eq_ascii(ascii)).count();
        let is_dot_stars = |text: &[u16]| match text.strip_prefix(w!(".*")) {
            Some(rest) => leading(rest, b'*') == rest.len(),
            None => false,
        };
        let (stars, qmarks) = (leading(glob, b'*'), leading(glob, b'?'));
        let rest = &glob[stars + qmarks..];
        let is_special = |unit: &u16| {
            let byte = unit.to_u8_saturating();
            matches!(byte, b'+' | b'@' | b'!' | b'?' | b'*' | b'[' | b'(')
        };
        if stars + qmarks != 0 && !rest.iter().any(is_special) {
            let mut scratch = Scratch::new();
            let ext = if nocase {
                unicode::to_lower_case(rest, &mut scratch).map_err(Abort::from)?
            } else {
                rest
            };
            return Ok(PartMatcher::Suffix {
                exact_len: (qmarks != 0).then_some(glob.len()),
                ext: Literal::new(ext),
                nocase: nocase && !rest.is_empty(),
            });
        }
        if stars != 0 && is_dot_stars(rest) {
            return Ok(PartMatcher::Outlined(OutlinedMatcher::StarDotStar));
        }
        if is_dot_stars(glob) {
            return Ok(PartMatcher::Outlined(OutlinedMatcher::DotStar));
        }
        let checkpoint = budget.bytes_in_use();
        Ok(match ast::to_mm_pattern(glob, budget)? {
            MmPattern::Literal(text) => PartMatcher::Literal(Literal::new(&text)),
            MmPattern::RegExp {
                source,
                needs_unicode,
            } => {
                let flags = Flags {
                    ignore_case: nocase,
                    unicode: needs_unicode,
                };
                budget.settle_memory(checkpoint, size_of_val(&source[..]))?;
                let regexp = RegExp::compile(&source, flags, budget)?;
                PartMatcher::Outlined(OutlinedMatcher::RegExp(Box::new(regexp)))
            }
        })
    }

    fn as_literal(&self) -> Option<&[u16]> {
        match self {
            PartMatcher::Literal(literal) => Some(&literal.utf16),
            _ => None,
        }
    }

    fn suffix_filter(&self) -> SuffixFilter {
        match self {
            PartMatcher::Literal(suffix) | PartMatcher::Suffix { ext: suffix, .. } => {
                SuffixFilter::new(&suffix.utf16, u32::from)
            }
            PartMatcher::Outlined(OutlinedMatcher::RegExp(regexp)) => {
                SuffixFilter::new(regexp.last_literal(), u32::from)
            }
            PartMatcher::Outlined(_) => SuffixFilter::default(),
        }
    }

    fn memory_cost(&self) -> usize {
        size_of::<Self>()
            + ALLOCATION_OVERHEAD
            + match self {
                PartMatcher::Literal(literal) | PartMatcher::Suffix { ext: literal, .. } => {
                    (size_of::<u16>() + size_of::<u8>()) * literal.len()
                }
                PartMatcher::Outlined(OutlinedMatcher::RegExp(regexp)) => regexp.memory_cost(),
                PartMatcher::Outlined(_) => 0,
            }
    }

    #[inline(always)]
    fn test<U: CodeUnit>(&self, part: &[U], budget: &mut Budget<'_>) -> Result<bool, Abort> {
        let is_empty_or_starts_with_dot = part.first().is_none_or(|first| first.eq_ascii(DOT));
        Ok(match self {
            PartMatcher::Literal(literal) => {
                budget.spend_unchecked(cost::vector_scan(literal.len()));
                literal.eql(part)
            }
            PartMatcher::Suffix { exact_len, .. }
                if is_empty_or_starts_with_dot || exact_len.is_some_and(|it| it != part.len()) =>
            {
                false
            }
            PartMatcher::Suffix {
                ext, nocase: false, ..
            } => {
                budget.spend_unchecked(cost::vector_scan(ext.len()));
                ext.is_suffix_of(part)
            }
            PartMatcher::Suffix { ext, .. } => ext.is_suffix_of_lowercased(part, budget)?,
            PartMatcher::Outlined(matcher) => matcher.test(part, budget)?,
        })
    }
}

impl OutlinedMatcher {
    #[inline(never)]
    fn test<U: CodeUnit>(&self, part: &[U], budget: &mut Budget<'_>) -> Result<bool, Abort> {
        let starts_with_dot = byte_at(part, 0) == DOT;
        Ok(match self {
            OutlinedMatcher::StarDotStar => {
                budget.spend_unchecked(cost::vector_scan(part.len()));
                !starts_with_dot && scan::index_of(part, DOT).is_some()
            }
            OutlinedMatcher::DotStar => starts_with_dot && dot_segment_len::<U, SLASH>(part) == 0,
            OutlinedMatcher::RegExp(regexp) => regexp.test(part, budget)?,
        })
    }
}

/// An index into [`Minimatch::matchers`], or [`GLOBSTAR`].
type MatcherId = u32;
const GLOBSTAR: MatcherId = MatcherId::MAX;

fn push_matcher(matchers: &mut Vec<PartMatcher>, matcher: PartMatcher) -> MatcherId {
    matchers.push(matcher);
    (matchers.len() - 1) as MatcherId
}

/// The parts between two `**`.
struct BodySegment {
    /// A range of [`SetEntry::pattern`].
    parts: Range<usize>,
    /// The segment starts at least this many parts before the tail.
    min_remaining: usize,
}

/// One element of `Minimatch.set`.
struct SetEntry {
    pattern: Box<[MatcherId]>,
    drive: Option<Drive>,
    first_and_last_globstar: Option<(usize, usize)>,
    body_segments: Box<[BodySegment]>,
    suffix_filter: SuffixFilter,
    /// Those after the drive, which is compared ignoring case.
    literals: PartSet,
}

const MAX_BYTES_PER_PART: usize =
    (size_of::<MatcherId>() + size_of::<BodySegment>()).next_power_of_two();

#[derive(Clone, Copy)]
struct Drive {
    index_after: u8,
    letter: u8,
}

/// The index of `C:` in the parts of `//?/C:/`.
const UNC_DRIVE_INDEX: u8 = 3;

/// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1625-L1630>
#[inline(always)]
fn find_drive<'p, U: CodeUnit>(part: impl Fn(usize) -> Option<&'p [U]>) -> Option<Drive> {
    let drive_at = |index: u8| {
        Some(Drive {
            index_after: index + 1,
            letter: byte_at(part(index.into()).filter(|part| is_drive(part))?, 0),
        })
    };
    drive_at(0).or_else(|| match (part(0)?, part(1)?, part(2)?) {
        ([], [], [mark]) if mark.eq_ascii(b'?') => drive_at(UNC_DRIVE_INDEX),
        _ => None,
    })
}

impl SetEntry {
    fn new(pattern: Vec<MatcherId>, drive: Option<Drive>, matchers: &[PartMatcher]) -> Self {
        let matcher = |&id: &MatcherId| matchers.get(id as usize);
        let suffix_filter =
            (pattern.last().and_then(matcher)).map_or_default(PartMatcher::suffix_filter);
        let after_drive = &pattern[drive.map_or(0, |drive| drive.index_after.into())..];
        let literals = PartSet::new(
            after_drive
                .iter()
                .filter_map(|id| matcher(id)?.as_literal()),
        );
        let is_globstar = |id: &MatcherId| *id == GLOBSTAR;
        let first = pattern.iter().position(is_globstar);
        let first_and_last_globstar = first.zip(pattern.iter().rposition(is_globstar));
        let mut body_segments = Vec::new();
        if let Some((first, last)) = first_and_last_globstar
            && first + 1 < last
        {
            let mut start = first + 1;
            for segment in pattern[start..last].split(is_globstar) {
                body_segments.push(BodySegment {
                    parts: start..start + segment.len(),
                    min_remaining: segment.len(),
                });
                start += segment.len() + 1;
            }
            // Upstream sums the lengths of the leading segments, not the trailing ones: https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1701-L1719
            let mut sum = 0;
            for index in 0..body_segments.len() {
                let mirrored = body_segments.len() - 1 - index;
                body_segments[mirrored].min_remaining += sum;
                sum += body_segments[index].parts.len();
            }
        }
        SetEntry {
            pattern: pattern.into(),
            drive,
            first_and_last_globstar,
            body_segments: body_segments.into(),
            suffix_filter,
            literals,
        }
    }

    fn memory_cost(&self) -> usize {
        size_of::<Self>()
            + ALLOCATION_OVERHEAD
            + size_of_val(&*self.pattern)
            + size_of_val(&*self.body_segments)
    }
}

struct Minimatch {
    platform: Platform,
    empty: bool,
    matchers: Box<[PartMatcher]>,
    set: Box<[SetEntry]>,
}

impl Minimatch {
    /// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1281-L1368>
    fn compile(
        pattern: CodeUnits<'_>,
        Options { platform, nocase }: Options,
        should_continue: &mut dyn FnMut() -> bool,
    ) -> Result<Self, Error> {
        if pattern.len() > MAX_PATTERN_LENGTH {
            return Err(Error::PatternTooLong);
        }
        let budget = &mut Budget::to_compile(should_continue);
        let empty = pattern.is_empty();
        let mut pattern: Vec<u16> = match pattern {
            CodeUnits::U8(latin1) => latin1.iter().map(|&unit| unit.into()).collect(),
            CodeUnits::U16(utf16) => utf16.to_vec(),
        };
        strings::replace_char_in_place(&mut pattern, BACKSLASH, SLASH);
        let glob_set = braces::brace_expand(pattern, budget)?;
        let GlobParts { texts, globs } = preprocess::preprocess(glob_set.iter(), platform, budget)?;
        let text = |part: PartId| texts[part as usize];

        let mut matchers = Vec::new();
        let mut matcher_of_part = vec![None; texts.len()];
        let mut set = Vec::with_capacity(globs.len());
        for glob in &globs {
            budget.spend(cost::build(glob.len()))?;
            budget.charge_memory(size_of::<SetEntry>() + MAX_BYTES_PER_PART * glob.len())?;
            let no_magic_root_len = if platform == Platform::Win32 && nocase {
                no_magic_root_len(glob, text)
            } else {
                0
            };
            let mut pattern = Vec::with_capacity(glob.len());
            for (index, &part) in glob.iter().enumerate() {
                let compiled = &mut matcher_of_part[part as usize];
                pattern.push(if index < no_magic_root_len {
                    budget.spend(cost::build(text(part).len()))?;
                    let matcher = PartMatcher::Literal(Literal::new(text(part)));
                    budget.charge_memory(matcher.memory_cost())?;
                    push_matcher(&mut matchers, matcher)
                } else if part == preprocess::GLOBSTAR {
                    GLOBSTAR
                } else if let Some(compiled) = *compiled {
                    compiled
                } else {
                    budget.spend(cost::build(text(part).len()))?;
                    let checkpoint = budget.bytes_in_use();
                    let matcher = PartMatcher::parse(text(part), nocase, budget)?;
                    budget.settle_memory(checkpoint, matcher.memory_cost())?;
                    *compiled.insert(push_matcher(&mut matchers, matcher))
                });
            }
            let mut drive = None;
            if platform == Platform::Win32 {
                // The "?" of `//?/C:/` is not a wildcard.
                if let [preprocess::EMPTY, preprocess::EMPTY, mark, ..] = glob[..]
                    && let [_, _, ref mut mark_matcher, drive_matcher, ..] = pattern[..]
                    && text(mark) == w!("?")
                    && (matchers.get(drive_matcher as usize))
                        .and_then(PartMatcher::as_literal)
                        .is_some_and(is_drive)
                {
                    let matcher = PartMatcher::Literal(Literal::new(text(mark)));
                    *mark_matcher = push_matcher(&mut matchers, matcher);
                }
                drive = find_drive(|at| matchers.get(*pattern.get(at)? as usize)?.as_literal());
            }
            set.push(SetEntry::new(pattern, drive, &matchers));
        }
        Ok(Minimatch {
            platform,
            empty,
            matchers: matchers.into(),
            set: set.into(),
        })
    }

    fn memory_cost(&self) -> usize {
        let of_matchers = self.matchers.iter().map(PartMatcher::memory_cost);
        let of_set = self.set.iter().map(SetEntry::memory_cost);
        of_matchers.chain(of_set).sum()
    }

    /// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1887-L1929>
    #[inline(always)]
    fn matches(
        &self,
        path: CodeUnits<'_>,
        should_continue: &mut dyn FnMut() -> bool,
    ) -> Result<bool, Abort> {
        if self.empty {
            return Ok(path.is_empty());
        }
        let budget = &mut Budget::to_match(path.len(), should_continue);
        match_code_units!(path, |path| self.matches_units(path, budget))
    }

    #[inline(never)]
    fn matches_units<U: CodeUnit>(
        &self,
        path: &[U],
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        let suffix = match path.last().map(|last| last.to_u8_saturating()) {
            // The last part may be dropped or cancel another.
            Some(DOT | SLASH | BACKSLASH) => SuffixFilter::default(),
            _ => SuffixFilter::new(path, |unit| unit.to_u8_saturating().into()),
        };
        let may_match = |entry: &SetEntry| entry.suffix_filter.may_match(suffix);
        let Some(first) = self.set.iter().position(may_match) else {
            return Ok(false);
        };

        let mut inline = [MaybeUninit::uninit(); INLINE_PARTS];
        let mut heap;
        let mut parts = BorrowedBuf::from(if max_parts(path.len()) <= INLINE_PARTS {
            &mut inline[..]
        } else {
            heap = try_with_capacity(count_parts(path, self.platform))?;
            heap.spare_capacity_mut()
        });
        let mut any_starts_with_dot = false;
        slash_split(path, self.platform, |part| {
            any_starts_with_dot |= byte_at(path, part.start) == DOT;
            parts
                .unfilled()
                .append(&[(part.start as u32, part.end as u32)]);
        });
        let parts = parts.into_filled_mut();
        budget.spend(cost::STEP * parts.len())?;

        let file = SplitPath {
            path,
            platform: self.platform,
            matchers: &self.matchers,
            any_starts_with_dot,
        };
        // `levelTwoFileOptimize` mutates the array, so only `set[0]` looks for the drive before it ran.
        let drive_before = file.drive(parts);
        let (parts, drive_after) = if any_starts_with_dot {
            let parts = file.level_two_file_optimize(parts);
            (parts, file.drive(parts))
        } else {
            (&*parts, drive_before)
        };
        let mut part_set = None;
        for (index, entry) in self.set.iter().enumerate().skip(first) {
            let drive = if index == 0 {
                drive_before
            } else {
                drive_after
            };
            if may_match(entry)
                && (index == first
                    || (part_set.get_or_insert_with(|| file.part_set(parts)))
                        .may_contain(entry.literals))
                && file.match_one(parts, entry, drive, budget)?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// The length of the `windowsNoMagicRoot`.
fn no_magic_root_len<'t>(glob: &[PartId], text: impl Fn(PartId) -> &'t [u16]) -> usize {
    let has_magic = |at: usize| glob.get(at).is_some_and(|&it| has_glob_magic(text(it)));
    let is_qmark = |at: usize| glob.get(at).is_some_and(|&it| text(it) == w!("?"));
    match *glob {
        [preprocess::EMPTY, preprocess::EMPTY, ..]
            if (is_qmark(2) || !has_magic(2)) && !has_magic(3) =>
        {
            4
        }
        [first, ..] if win32::has_drive(text(first)) => 1,
        _ => 0,
    }
}

/// `(start, end)` in the path.
type PartRange = (u32, u32);

const INLINE_PARTS: usize = 160;

/// `//a/` has four parts.
const fn max_parts(path_len: usize) -> usize {
    path_len / 2 + 2
}

#[inline(never)]
fn count_parts<U: CodeUnit>(path: &[U], platform: Platform) -> usize {
    let mut count = 0;
    slash_split(path, platform, |_| count += 1);
    count
}

struct SplitPath<'p, U> {
    path: &'p [U],
    platform: Platform,
    matchers: &'p [PartMatcher],
    /// As of before `level_two_file_optimize`.
    any_starts_with_dot: bool,
}

impl<'p, U: CodeUnit> SplitPath<'p, U> {
    #[inline(always)]
    fn text(&self, (start, end): PartRange) -> &'p [U] {
        &self.path[start as usize..end as usize]
    }

    #[inline(always)]
    fn starts_with_dot(&self, (start, end): PartRange) -> bool {
        start != end && self.path[start as usize].eq_ascii(DOT)
    }

    #[inline(always)]
    fn drive(&self, parts: &[PartRange]) -> Option<Drive> {
        match self.platform {
            Platform::Posix => None,
            Platform::Win32 => self.find_drive(parts),
        }
    }

    #[inline(never)]
    fn part_set(&self, parts: &[PartRange]) -> PartSet {
        PartSet::new(parts.iter().map(|&part| self.text(part)))
    }

    #[inline(never)]
    fn find_drive(&self, parts: &[PartRange]) -> Option<Drive> {
        find_drive(|at| Some(self.text(*parts.get(at)?)))
    }

    /// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1431-L1465>
    #[inline(never)]
    fn level_two_file_optimize<'r>(&self, parts: &'r mut [PartRange]) -> &'r [PartRange] {
        let dots = |part: PartRange| dot_segment_len::<U, SLASH>(self.text(part));
        let cancels_with_dotdot = |part: PartRange| match self.text(part) {
            [] => false,
            [a, b] if a.eq_ascii(b'*') && b.eq_ascii(b'*') => false,
            text => dots(part) == 0 && !(self.platform == Platform::Win32 && is_drive(text)),
        };
        let mut written = 0;
        for read in 0..parts.len() {
            let part = parts[read];
            match dots(part) {
                1 if read != 0 && read + 1 != parts.len() => {}
                2 if written != 0 && cancels_with_dotdot(parts[written - 1]) => written -= 1,
                _ => {
                    parts[written] = part;
                    written += 1;
                }
            }
        }
        match parts[..written] {
            [] => &[(0, 0)],
            [first, last] if dots(first) == 1 && (last.0 == last.1 || dots(last) == 1) => {
                &parts[..1]
            }
            _ => &parts[..written],
        }
    }

    /// `#matchOne`: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1753-L1786>
    #[inline(always)]
    fn match_parts(
        &self,
        parts: &[PartRange],
        pattern: &[MatcherId],
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        match parts.get(pattern.len()..) {
            Some([]) => {}
            Some([(start, end)]) if start == end => {}
            _ => return Ok(false),
        }
        budget.spend(cost::STEP * pattern.len())?;
        // Mismatches tend to be near the end.
        for (&part, &matcher) in parts.iter().zip(pattern).rev() {
            if !self.matchers[matcher as usize].test(self.text(part), budget)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// `matchOne` and `#matchGlobstar`: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1621-L1721>
    #[inline(always)]
    fn match_one(
        &self,
        mut parts: &[PartRange],
        entry: &SetEntry,
        drive: Option<Drive>,
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        budget.spend_unchecked(cost::STEP);
        let pattern = &entry.pattern[..];
        let mut pattern_start = 0;
        // Upstream writes the drive of the path into the cached pattern, which affects later calls. This does not.
        if let (Some(drive), Some(pattern_drive)) = (drive, entry.drive)
            && drive.letter.eq_ignore_ascii_case(&pattern_drive.letter)
        {
            parts = &parts[drive.index_after.into()..];
            pattern_start = pattern_drive.index_after.into();
        }
        let Some((first, last)) = entry.first_and_last_globstar else {
            return self.match_parts(parts, &pattern[pattern_start..], budget);
        };
        let (head, tail) = (&pattern[pattern_start..first], &pattern[last + 1..]);
        let Some((file_head, parts)) = parts.split_at_checked(head.len()) else {
            return Ok(false);
        };
        let Some(mut tail_start) = parts.len().checked_sub(tail.len()) else {
            return Ok(false);
        };
        if !self.match_parts(file_head, head, budget)? {
            return Ok(false);
        }
        if !self.match_parts(&parts[tail_start..], tail, budget)? {
            let has_trailing_slash = parts.last().is_some_and(|last| last.0 == last.1);
            if !has_trailing_slash
                || tail_start == 0
                || !self.match_parts(&parts[tail_start - 1..], tail, budget)?
            {
                return Ok(false);
            }
            tail_start -= 1;
        }
        budget.spend_unchecked(parts.len());
        if !entry.body_segments.is_empty() {
            return self.match_globstar_body_sections(parts, tail_start, entry, budget);
        }
        let starts_with_dot = |&part| self.starts_with_dot(part);
        Ok(!parts.is_empty()
            && !(self.any_starts_with_dot && parts[..tail_start].iter().any(starts_with_dot)))
    }

    /// Iterative, and tries each segment at each part once: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1724-L1752>
    #[inline(never)]
    fn match_globstar_body_sections(
        &self,
        parts: &[PartRange],
        tail_start: usize,
        entry: &SetEntry,
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        let segments = &entry.body_segments;
        let last_dot_part = if self.any_starts_with_dot {
            parts.iter().rposition(|&part| self.starts_with_dot(part))
        } else {
            None
        };
        let max_depth = segments.len().min(MAX_GLOBSTAR_RECURSION + 1);
        let mut file_index = SmallVec::<[usize; 8]>::from_elem(0, max_depth);
        let mut failed_before = SmallVec::<[usize; 8]>::from_elem(0, max_depth);
        let mut depth = 0;
        loop {
            let (segment, start) = (&segments[depth], file_index[depth]);
            if start + segment.min_remaining > tail_start {
                return Ok(false);
            }
            let body = &entry.pattern[segment.parts.clone()];
            let end = start + body.len();
            if depth < MAX_GLOBSTAR_RECURSION
                && self.match_parts(&parts[start..end], body, budget)?
            {
                if depth + 1 == segments.len() {
                    if last_dot_part.is_none_or(|index| index < end) && end < parts.len() {
                        return Ok(true);
                    }
                } else if end >= failed_before[depth + 1] {
                    depth += 1;
                    file_index[depth] = end;
                    continue;
                }
            }
            // `**` swallows one more part. If that starts with a dot, the previous `**` has to.
            while self.starts_with_dot(parts[file_index[depth]]) {
                failed_before[depth] = file_index[depth] + 1;
                if depth == 0 {
                    return Ok(false);
                }
                depth -= 1;
            }
            file_index[depth] += 1;
        }
    }
}
