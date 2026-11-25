//! `matchesGlob`, which is minimatch 10.2.6 with the options in Node's lib/internal/fs/glob.js.

mod ast;
mod braces;
mod cache;
mod class;
mod parts;
mod regexp;

use core::mem::MaybeUninit;
use core::ops::Range;

use bun_collections::smallvec::SmallVec;
use bun_core::StackCheck;
use bun_core::vec::BorrowedBuf;

use crate::{
    BACKSLASH, CodeUnits, DOT, Failure, SLASH, Scratch, Unit, byte_at, length_of, scan, unicode,
    win32,
};
use ast::Parsed;
pub use cache::Cache;
use parts::{EMPTY, GLOBSTAR, Globs, Part};
use regexp::RegExp;

const LONGEST_PATTERN: usize = 64 * 1024;
const MOST_GLOBSTARS: usize = 200;
/// About how many bytes the allocator adds to a few small allocations.
const ROUNDED_UP: usize = 32;

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Options {
    pub win32: bool,
    pub ignores_case: bool,
}

/// Why something has been given up.
#[derive(Clone, Copy)]
pub enum Stop {
    TooDeep,
    TooComplex,
    OutOfMemory,
    /// By `goes_on`.
    Interrupted,
}

impl From<Failure> for Stop {
    fn from(_: Failure) -> Self {
        Stop::OutOfMemory
    }
}

pub enum Error {
    TooLong,
    /// The message.
    Syntax(Vec<u16>),
    Stopped(Stop),
}

impl From<Stop> for Error {
    fn from(stop: Stop) -> Self {
        Error::Stopped(stop)
    }
}

/// What a call has spent. A unit is about a nanosecond, or two bytes.
struct Work<'a> {
    done: usize,
    next_check: usize,
    allowed: usize,
    goes_on: &'a mut dyn FnMut() -> bool,
}

impl<'a> Work<'a> {
    const TO_COMPILE: usize = 1 << 26;
    const TO_MATCH: usize = 1 << 28;
    const TO_MATCH_PER_UNIT: usize = 64;
    const BETWEEN_CHECKS: usize = 1 << 18;

    #[inline(always)]
    fn new(allowed: usize, goes_on: &'a mut dyn FnMut() -> bool) -> Self {
        Work {
            done: 0,
            next_check: Self::BETWEEN_CHECKS,
            allowed,
            goes_on,
        }
    }

    #[inline(always)]
    fn note(&mut self, amount: usize) {
        self.done += amount;
    }

    #[inline(always)]
    fn spend(&mut self, amount: usize) -> Result<(), Stop> {
        self.note(amount);
        if self.done < self.next_check {
            return Ok(());
        }
        self.check()
    }

    #[cold]
    fn check(&mut self) -> Result<(), Stop> {
        if self.done > self.allowed {
            return Err(Stop::TooComplex);
        }
        self.next_check = self.done + Self::BETWEEN_CHECKS;
        (self.goes_on)().then_some(()).ok_or(Stop::Interrupted)
    }

    fn check_stack(&self) -> Result<(), Stop> {
        let has_room = StackCheck::init().is_safe_to_recurse();
        has_room.then_some(()).ok_or(Stop::TooDeep)
    }
}

fn try_vec<T>(capacity: usize) -> Result<Vec<T>, Stop> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity)
        .map_err(|_| Stop::OutOfMemory)?;
    Ok(vec)
}

fn is_line_terminator(unit: u16) -> bool {
    matches!(unit, 0xA | 0xD | 0x2028 | 0x2029)
}

/// `slashSplit`
#[inline(always)]
fn split<U: Unit>(path: &[U], win32: bool, mut take: impl FnMut(Range<usize>)) {
    let other = if win32 { BACKSLASH } else { SLASH };
    let mut start = 0;
    for (index, block) in path.chunks(scan::BLOCK).enumerate() {
        let mut separators = scan::either_bits(block, SLASH, other);
        if win32 && index == 0 && separators & 0b111 == 0b011 && path.len() > 2 {
            take(0..0);
        }
        while let Some(bit) = separators.lowest_one() {
            separators &= separators - 1;
            let at = index * scan::BLOCK + bit as usize;
            if at != start || at == 0 {
                take(start..at);
            }
            start = at + 1;
        }
    }
    take(start..path.len());
}

/// `/^[a-z]:$/i`
#[inline(always)]
fn is_drive<U: Unit>(name: &[U]) -> bool {
    name.len() == 2 && win32::has_drive(name)
}

/// `/[?*]|[+@!]\(.*?\)|\[|\]/.test(text)`
fn looks_like_magic(text: &[u16]) -> bool {
    let (mut is_open, mut before) = (false, 0);
    text.iter().any(|&unit| {
        let opens = unit.is(b'(') && matches!(before, b'+' | b'@' | b'!');
        is_open = opens || (is_open && !is_line_terminator(unit));
        before = unit.byte();
        matches!(before, b'?' | b'*' | b'[' | b']') || (is_open && before == b')')
    })
}

struct Text {
    utf16: Box<[u16]>,
    latin1: Option<Box<[u8]>>,
}

impl Text {
    fn new(utf16: &[u16]) -> Self {
        Text {
            utf16: utf16.into(),
            latin1: utf16.iter().map(|&unit| u8::try_from(unit).ok()).collect(),
        }
    }

    #[inline(always)]
    fn is<U: Unit>(&self, other: &[U]) -> bool {
        match (U::units(other), &self.latin1) {
            (CodeUnits::U8(other), Some(latin1)) => scan::equal(latin1, other),
            (CodeUnits::U8(_), None) => false,
            (CodeUnits::U16(other), _) => scan::equal(&self.utf16, other),
        }
    }

    #[inline(always)]
    fn ends<U: Unit>(&self, other: &[U]) -> bool {
        let start = other.len().checked_sub(self.utf16.len());
        start.is_some_and(|start| self.is(&other[start..]))
    }

    /// `other.toLowerCase().endsWith(this)`
    #[inline(always)]
    fn ends_lowered<U: Unit>(&self, other: &[U], work: &mut Work<'_>) -> Result<bool, Stop> {
        match U::units(other) {
            CodeUnits::U8(other) => {
                work.note(self.utf16.len());
                let start = other.len().checked_sub(self.utf16.len());
                Ok(start.is_some_and(|start| {
                    let mut pairs = other[start..].iter().zip(&self.utf16);
                    pairs.all(|(&a, &b)| u16::from(unicode::lower_latin1(a)) == b)
                }))
            }
            CodeUnits::U16(other) => self.ends_lowered_utf16(other, work),
        }
    }

    #[inline(never)]
    fn ends_lowered_utf16(&self, other: &[u16], work: &mut Work<'_>) -> Result<bool, Stop> {
        work.spend(8 * other.len())?;
        Ok(self.ends(unicode::lowered(other, &mut Scratch::new())?))
    }
}

/// The last two units of a text, as far as they are ASCII, without what tells the cases of a letter apart.
#[derive(Clone, Copy, Default)]
struct Ending {
    units: u16,
    known: u16,
}

impl Ending {
    #[inline(always)]
    fn of<C: Copy>(text: &[C], code: impl Fn(C) -> u32) -> Self {
        let from_end = |count| Some(code(text[text.len().checked_sub(count)?]));
        let ascii = |count| from_end(count).filter(|&unit: &u32| unit < 0x80);
        let (units, known) = match (ascii(2), ascii(1)) {
            (_, None) => (0, 0),
            (None, Some(last)) => (last, 0xDF),
            (Some(before), Some(last)) => (before << 8 | last, 0xDFDF),
        };
        Ending {
            units: units as u16,
            known,
        }
    }

    #[inline(always)]
    fn differs_from(self, other: Self) -> bool {
        (self.units ^ other.units) & self.known & other.known != 0
    }
}

/// What a name is to be like.
enum Test {
    Literal(Text),
    /// `*`, `*.js`, or `??.js` which has a `length`. The end is in lower case if case is ignored.
    End {
        length: Option<usize>,
        end: Text,
        ignores_case: bool,
    },
    Other(Other),
}

/// The tests that are not worth being inlined.
enum Other {
    /// `*.*`
    StarDotStar,
    /// `.*`
    DotStar,
    RegExp(RegExp),
}

impl Test {
    /// `parse`
    fn of(glob: &[u16], ignores_case: bool, work: &mut Work<'_>) -> Result<Self, Error> {
        let leading = |text: &[u16], ascii| text.iter().take_while(|unit| unit.is(ascii)).count();
        let is_dot_stars = |text: &[u16]| {
            byte_at(text, 0) == DOT && text.len() > 1 && 1 + leading(&text[1..], b'*') == text.len()
        };
        let (stars, marks) = (leading(glob, b'*'), leading(glob, b'?'));
        let rest = &glob[stars + marks..];
        let is_special =
            |unit: &u16| matches!(unit.byte(), b'+' | b'@' | b'!' | b'?' | b'*' | b'[' | b'(');
        if stars + marks != 0 && !rest.iter().any(is_special) {
            let mut scratch = Scratch::new();
            let end = if ignores_case {
                unicode::lowered(rest, &mut scratch).map_err(Stop::from)?
            } else {
                rest
            };
            return Ok(Test::End {
                length: (marks != 0).then_some(glob.len()),
                end: Text::new(end),
                ignores_case: ignores_case && !rest.is_empty(),
            });
        }
        if stars != 0 && is_dot_stars(rest) {
            return Ok(Test::Other(Other::StarDotStar));
        }
        if is_dot_stars(glob) {
            return Ok(Test::Other(Other::DotStar));
        }
        Ok(match ast::parse(glob, work)? {
            Parsed::Literal(text) => Test::Literal(Text::new(&text)),
            Parsed::RegExp { source, is_unicode } => {
                let regexp = RegExp::compile(&source, ignores_case, is_unicode, work)?;
                Test::Other(Other::RegExp(regexp))
            }
        })
    }

    fn literal(&self) -> Option<&[u16]> {
        match self {
            Test::Literal(text) => Some(&text.utf16),
            _ => None,
        }
    }

    /// Of each name that passes.
    fn ending(&self) -> Ending {
        match self {
            Test::Literal(text) | Test::End { end: text, .. } => Ending::of(&text.utf16, u32::from),
            Test::Other(Other::RegExp(regexp)) => Ending::of(regexp.last_literal(), u32::from),
            Test::Other(_) => Ending::default(),
        }
    }

    fn size(&self) -> usize {
        size_of::<Self>()
            + ROUNDED_UP
            + match self {
                Test::Literal(text) | Test::End { end: text, .. } => 3 * text.utf16.len(),
                Test::Other(Other::RegExp(regexp)) => regexp.size(),
                Test::Other(_) => 0,
            }
    }

    #[inline(always)]
    fn passes<U: Unit>(&self, name: &[U], work: &mut Work<'_>) -> Result<bool, Stop> {
        let is_visible = name.first().is_some_and(|first| !first.is(DOT));
        Ok(match self {
            Test::Literal(text) => {
                work.note(text.utf16.len() / 8);
                text.is(name)
            }
            Test::End { length, .. }
                if !is_visible || length.is_some_and(|it| it != name.len()) =>
            {
                false
            }
            Test::End {
                end,
                ignores_case: false,
                ..
            } => {
                work.note(end.utf16.len() / 8);
                end.ends(name)
            }
            Test::End { end, .. } => end.ends_lowered(name, work)?,
            Test::Other(other) => other.passes(name, work)?,
        })
    }
}

impl Other {
    #[inline(never)]
    fn passes<U: Unit>(&self, name: &[U], work: &mut Work<'_>) -> Result<bool, Stop> {
        let is_hidden = byte_at(name, 0) == DOT;
        Ok(match self {
            Other::StarDotStar => {
                work.note(name.len() / 8);
                !is_hidden && scan::first(name, DOT).is_some()
            }
            Other::DotStar => is_hidden && crate::leading_dots::<U, SLASH>(name) == 0,
            Other::RegExp(regexp) => regexp.test(name, work)?,
        })
    }
}

/// What is between two `**`.
struct Section {
    /// Of `Alternative::tests`.
    tests: Range<usize>,
    /// How many names from the end it has to start at the latest.
    reserve: usize,
}

struct Alternative {
    /// Indices of `Pattern::tests`, or [`ANY_DEPTH`].
    tests: Box<[u32]>,
    drive: Option<Drive>,
    /// The indices of the first and the last `**`.
    globstars: Option<(usize, usize)>,
    sections: Box<[Section]>,
    /// That of the last test.
    ending: Ending,
}

const ANY_DEPTH: u32 = u32::MAX;

/// The one in `C:/` or in `//?/C:/`.
#[derive(Clone, Copy)]
struct Drive {
    /// The index of the name that follows.
    behind: u8,
    letter: u8,
}

#[inline(always)]
fn drive_among<'n, U: Unit + 'n>(name: impl Fn(usize) -> Option<&'n [U]>) -> Option<Drive> {
    let drive_at = |at: u8| {
        Some(Drive {
            behind: at + 1,
            letter: name(at.into()).filter(|name| is_drive(name))?[0].byte(),
        })
    };
    drive_at(0).or_else(|| match (name(0)?, name(1)?, name(2)?) {
        ([], [], [mark]) if mark.is(b'?') => drive_at(3),
        _ => None,
    })
}

impl Alternative {
    fn new(tests: Vec<u32>, drive: Option<Drive>, ending: Ending) -> Self {
        let is_globstar = |test: &u32| *test == ANY_DEPTH;
        let first = tests.iter().position(is_globstar);
        let globstars = first.zip(tests.iter().rposition(is_globstar));
        let mut sections = Vec::new();
        if let Some((first, last)) = globstars.filter(|(first, last)| first + 1 < *last) {
            let mut start = first + 1;
            for section in tests[start..last].split(is_globstar) {
                sections.push(Section {
                    tests: start..start + section.len(),
                    reserve: section.len(),
                });
                start += section.len() + 1;
            }
            // It is the lengths of the first sections that minimatch adds up, not those of the last.
            let mut sum = 0;
            for index in 0..sections.len() {
                let mirrored = sections.len() - 1 - index;
                sections[mirrored].reserve += sum;
                sum += sections[index].tests.len();
            }
        }
        Alternative {
            tests: tests.into(),
            drive,
            globstars,
            sections: sections.into(),
            ending,
        }
    }
}

struct Pattern {
    win32: bool,
    is_empty: bool,
    tests: Box<[Test]>,
    alternatives: Box<[Alternative]>,
}

impl Pattern {
    fn compile(
        pattern: CodeUnits<'_>,
        options: Options,
        goes_on: &mut dyn FnMut() -> bool,
    ) -> Result<Self, Error> {
        if length_of(pattern) > LONGEST_PATTERN {
            return Err(Error::TooLong);
        }
        let work = &mut Work::new(Work::TO_COMPILE, goes_on);
        let mut pattern: Vec<u16> = match pattern {
            CodeUnits::U8(latin1) => latin1.iter().map(|&unit| unit.into()).collect(),
            CodeUnits::U16(utf16) => utf16.to_vec(),
        };
        let is_empty = pattern.is_empty();
        crate::replace(&mut pattern, BACKSLASH, SLASH);
        let expanded = braces::expand(pattern, work)?;
        let Globs { texts, globs } = Globs::of(expanded.iter(), options.win32, work)?;

        let mut tests = Vec::new();
        let mut test_of_part = vec![None; texts.len()];
        let mut alternatives = Vec::with_capacity(globs.len());
        for glob in &globs {
            work.spend(64 + 2 * glob.len())?;
            let text = |part: Part| texts[part as usize];
            let literal_root = if options.win32 && options.ignores_case {
                length_of_root(glob, text)
            } else {
                0
            };
            let mut of_glob = Vec::with_capacity(glob.len());
            for (at, &part) in glob.iter().enumerate() {
                let known = &mut test_of_part[part as usize];
                of_glob.push(if at < literal_root {
                    work.spend(64 + 2 * text(part).len())?;
                    tests.push(Test::Literal(Text::new(text(part))));
                    tests.len() as u32 - 1
                } else if part == GLOBSTAR {
                    ANY_DEPTH
                } else if let Some(known) = *known {
                    known
                } else {
                    work.spend(64 + 2 * text(part).len())?;
                    tests.push(Test::of(text(part), options.ignores_case, work)?);
                    *known.insert(tests.len() as u32 - 1)
                });
            }
            let mut drive = None;
            if options.win32 {
                let literal = |test: u32| tests.get(test as usize).and_then(Test::literal);
                if let [EMPTY, EMPTY, mark, _, ..] = glob[..]
                    && text(mark) == [u16::from(b'?')]
                    && literal(of_glob[3]).is_some_and(is_drive)
                {
                    tests.push(Test::Literal(Text::new(text(mark))));
                    of_glob[2] = tests.len() as u32 - 1;
                }
                drive = drive_among(|at| tests.get(*of_glob.get(at)? as usize)?.literal());
            }
            let last = of_glob.last().and_then(|&last| tests.get(last as usize));
            let ending = last.map_or_default(Test::ending);
            alternatives.push(Alternative::new(of_glob, drive, ending));
        }
        Ok(Pattern {
            win32: options.win32,
            is_empty,
            tests: tests.into(),
            alternatives: alternatives.into(),
        })
    }

    /// About how many bytes it takes.
    fn size(&self) -> usize {
        let of_alternative = |it: &Alternative| {
            size_of_val(it) + size_of_val(&*it.tests) + size_of_val(&*it.sections) + ROUNDED_UP
        };
        self.tests.iter().map(Test::size).sum::<usize>()
            + self.alternatives.iter().map(of_alternative).sum::<usize>()
    }

    #[inline(always)]
    fn matches(
        &self,
        path: CodeUnits<'_>,
        goes_on: &mut dyn FnMut() -> bool,
    ) -> Result<bool, Stop> {
        if self.is_empty {
            return Ok(length_of(path) == 0);
        }
        let allowed = Work::TO_MATCH + Work::TO_MATCH_PER_UNIT * length_of(path);
        let work = &mut Work::new(allowed, goes_on);
        of_either_width!(path, |path| self.matches_units(path, work))
    }

    #[inline(never)]
    fn matches_units<U: Unit>(&self, path: &[U], work: &mut Work<'_>) -> Result<bool, Stop> {
        // Otherwise the last name is the last one that counts.
        let ending = match path.last().map(|last| last.byte()) {
            Some(DOT | SLASH | BACKSLASH) => Ending::default(),
            _ => Ending::of(path, |unit| unit.byte().into()),
        };
        let is_possible = |it: &Alternative| !it.ending.differs_from(ending);
        let Some(first) = self.alternatives.iter().position(is_possible) else {
            return Ok(false);
        };

        let mut few = [MaybeUninit::uninit(); FEW_NAMES];
        let mut many;
        let mut names = BorrowedBuf::from(if path.len() / 2 + 2 <= FEW_NAMES {
            &mut few[..]
        } else {
            many = try_vec(count_names(path, self.win32))?;
            many.spare_capacity_mut()
        });
        let mut has_hidden = false;
        split(path, self.win32, |name| {
            has_hidden |= byte_at(path, name.start) == DOT;
            names
                .unfilled()
                .append(&[(name.start as u32, name.end as u32)]);
        });
        let names = names.into_filled_mut();
        work.spend(4 * names.len())?;

        let file = File {
            path,
            tests: &self.tests,
            has_hidden,
        };
        let drive = |names: &[Name]| if self.win32 { file.drive(names) } else { None };
        // The first alternative looks for it before the path has been simplified.
        let drive_for_first = drive(names);
        let (names, drive_for_others) = if has_hidden {
            let names = file.simplified(names, self.win32);
            (names, drive(names))
        } else {
            (&*names, drive_for_first)
        };
        let mut drive = if first == 0 {
            drive_for_first
        } else {
            drive_for_others
        };
        for alternative in &self.alternatives[first..] {
            if is_possible(alternative) && file.matches(names, alternative, drive, work)? {
                return Ok(true);
            }
            drive = drive_for_others;
        }
        Ok(false)
    }
}

#[inline(never)]
fn count_names<U: Unit>(path: &[U], win32: bool) -> usize {
    let mut count = 0;
    split(path, win32, |_| count += 1);
    count
}

/// How many parts at the start are taken as they are with `windowsNoMagicRoot`.
fn length_of_root<'t>(glob: &[Part], text: impl Fn(Part) -> &'t [u16]) -> usize {
    let is_plain = |at: usize| !glob.get(at).is_some_and(|&it| looks_like_magic(text(it)));
    let is_mark = |at: usize| glob.get(at).is_some_and(|&it| text(it) == [b'?'.into()]);
    match *glob {
        [EMPTY, EMPTY, ..] if (is_mark(2) || is_plain(2)) && is_plain(3) => 4,
        [first, ..] if win32::has_drive(text(first)) => 1,
        _ => 0,
    }
}

/// Where it starts and ends. No string is too long for that.
type Name = (u32, u32);

const FEW_NAMES: usize = 160;

struct File<'f, U> {
    path: &'f [U],
    tests: &'f [Test],
    /// A name starts with a dot, or did before the path was simplified.
    has_hidden: bool,
}

impl<'f, U: Unit> File<'f, U> {
    #[inline(always)]
    fn text_of(&self, (start, end): Name) -> &'f [U] {
        &self.path[start as usize..end as usize]
    }

    #[inline(always)]
    fn is_hidden(&self, name: Name) -> bool {
        name.0 != name.1 && self.path[name.0 as usize].is(DOT)
    }

    #[inline(never)]
    fn drive(&self, names: &[Name]) -> Option<Drive> {
        drive_among(|at| Some(self.text_of(*names.get(at)?)))
    }

    /// `levelTwoFileOptimize`
    #[inline(never)]
    fn simplified<'n>(&self, names: &'n mut [Name], win32: bool) -> &'n [Name] {
        let dots = |name: Name| crate::leading_dots::<U, SLASH>(self.text_of(name));
        let can_be_left = |name: Name| match self.text_of(name) {
            [] => false,
            [a, b] if a.is(b'*') && b.is(b'*') => false,
            text => dots(name) == 0 && !(win32 && is_drive(text)),
        };
        let mut written = 0;
        for read in 0..names.len() {
            let name = names[read];
            match dots(name) {
                1 if read != 0 && read + 1 != names.len() => {}
                2 if written != 0 && can_be_left(names[written - 1]) => written -= 1,
                _ => {
                    names[written] = name;
                    written += 1;
                }
            }
        }
        match names[..written] {
            [] => &[(0, 0)],
            [first, last] if dots(first) == 1 && (last.0 == last.1 || dots(last) == 1) => {
                &names[..1]
            }
            _ => &names[..written],
        }
    }

    /// Whether there are as many `names` as `tests`, or one more that is empty, and each passes its test.
    #[inline(always)]
    fn pass(&self, names: &[Name], tests: &[u32], work: &mut Work<'_>) -> Result<bool, Stop> {
        match names.get(tests.len()..) {
            Some([]) => {}
            Some([(start, end)]) if start == end => {}
            _ => return Ok(false),
        }
        work.spend(4 * tests.len())?;
        // The alternatives of a glob tend to differ at the end.
        for (&name, &test) in names.iter().zip(tests).rev() {
            if !self.tests[test as usize].passes(self.text_of(name), work)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// `matchOne`
    #[inline(always)]
    fn matches(
        &self,
        mut names: &[Name],
        alternative: &Alternative,
        drive: Option<Drive>,
        work: &mut Work<'_>,
    ) -> Result<bool, Stop> {
        work.note(4);
        let tests = &alternative.tests[..];
        let mut first_test = 0;
        if let (Some(drive), Some(other)) = (drive, alternative.drive)
            && drive.letter.eq_ignore_ascii_case(&other.letter)
        {
            (names, first_test) = (&names[drive.behind.into()..], other.behind.into());
        }
        let Some((first, last)) = alternative.globstars else {
            return self.pass(names, &tests[first_test..], work);
        };
        let (head, tail) = (&tests[first_test..first], &tests[last + 1..]);
        let Some((at_head, names)) = names.split_at_checked(head.len()) else {
            return Ok(false);
        };
        let Some(mut between) = names.len().checked_sub(tail.len()) else {
            return Ok(false);
        };
        if !self.pass(&names[between..], tail, work)? {
            let ends_with_separator = names.last().is_some_and(|last| last.0 == last.1);
            if !ends_with_separator
                || between == 0
                || !self.pass(&names[between - 1..], tail, work)?
            {
                return Ok(false);
            }
            between -= 1;
        }
        if !self.pass(at_head, head, work)? {
            return Ok(false);
        }
        work.note(names.len());
        if !alternative.sections.is_empty() {
            return self.has_sections(names, between, alternative, work);
        }
        let is_hidden = |&name| self.is_hidden(name);
        Ok(!names.is_empty() && !(self.has_hidden && names[..between].iter().any(is_hidden)))
    }

    /// `#matchGlobStarBodySections`. The first `between` of `names` are not those of the tail.
    #[inline(never)]
    fn has_sections(
        &self,
        names: &[Name],
        between: usize,
        alternative: &Alternative,
        work: &mut Work<'_>,
    ) -> Result<bool, Stop> {
        let sections = &alternative.sections;
        let last_hidden = names.iter().rposition(|&name| self.is_hidden(name));
        // For each section, the next name at which to try it. It has failed at all before, and each is tried once.
        let mut next = SmallVec::<[usize; 8]>::from_elem(0, sections.len().min(MOST_GLOBSTARS + 1));
        let mut failed_up_to = SmallVec::<[usize; 8]>::from_elem(0, next.len());
        let mut depth = 0;
        loop {
            let (section, at) = (&sections[depth], next[depth]);
            if at + section.reserve > between {
                return Ok(false);
            }
            let tests = &alternative.tests[section.tests.clone()];
            let behind = at + tests.len();
            if depth < MOST_GLOBSTARS && self.pass(&names[at..behind], tests, work)? {
                if depth + 1 == sections.len() {
                    if last_hidden.is_none_or(|hidden| hidden < behind) && behind < names.len() {
                        return Ok(true);
                    }
                } else if behind >= failed_up_to[depth + 1] {
                    depth += 1;
                    next[depth] = behind;
                    continue;
                }
            }
            // `**` takes one more name. If it cannot, the one before it does.
            while self.is_hidden(names[next[depth]]) {
                failed_up_to[depth] = next[depth] + 1;
                if depth == 0 {
                    return Ok(false);
                }
                depth -= 1;
            }
            next[depth] += 1;
        }
    }
}
