//! <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js> on the code units of a JavaScript string, Latin-1 or UTF-16. [`utf8`] is for callers that have bytes.
#![forbid(unsafe_code)]
#![feature(core_io_borrowed_buf, maybe_uninit_as_bytes)]

use core::mem::MaybeUninit;
use core::ops::Range;

use bun_core::strings::PathByte;
use bun_core::vec::{BorrowedBuf, BorrowedCursor};

pub use bun_core::strings::CodeUnits;

/// `$body` for whichever slice `$text` holds.
macro_rules! of_either_width {
    ($text:expr, |$units:ident| $body:expr) => {
        match $text {
            $crate::CodeUnits::U8($units) => $body,
            $crate::CodeUnits::U16($units) => $body,
        }
    };
}

pub mod glob;
pub mod posix;
mod scan;
mod segments;
pub mod short;
mod unicode;
pub mod utf8;
pub mod win32;

const SLASH: u8 = b'/';
const BACKSLASH: u8 = b'\\';
const DOT: u8 = b'.';
const COLON: u8 = b':';
/// What [`Unit::byte`] makes of a unit above Latin-1, and [`byte_at`] of an index behind the end. It means nothing in a path.
const OTHER: u8 = 0xFF;

/// `u8` (Latin-1) or `u16` (UTF-16).
pub trait Unit: PathByte + Copy + Into<u16> {
    fn byte(self) -> u8;

    /// 16-bit `text` only goes to 16-bit `to`.
    fn append(to: &mut BorrowedCursor<'_, Self>, text: CodeUnits<'_>);

    fn room_in(storage: &mut [MaybeUninit<u16>]) -> &mut [MaybeUninit<Self>];

    #[inline(always)]
    fn is(self, ascii: u8) -> bool {
        self == Self::from_u8(ascii)
    }
}

impl Unit for u8 {
    #[inline(always)]
    fn byte(self) -> u8 {
        self
    }

    #[inline(always)]
    fn append(to: &mut BorrowedCursor<'_, u8>, text: CodeUnits<'_>) {
        match text {
            CodeUnits::U8(text) => to.append(text),
            CodeUnits::U16(_) => unreachable!("the buffer is as wide as the widest operand"),
        }
    }

    #[inline(always)]
    fn room_in(storage: &mut [MaybeUninit<u16>]) -> &mut [MaybeUninit<u8>] {
        storage.as_bytes_mut()
    }
}

impl Unit for u16 {
    #[inline(always)]
    fn byte(self) -> u8 {
        self.min(u16::from(OTHER)) as u8
    }

    #[inline(always)]
    fn append(to: &mut BorrowedCursor<'_, u16>, text: CodeUnits<'_>) {
        match text {
            CodeUnits::U8(text) => append_widened(to, text),
            CodeUnits::U16(text) => to.append(text),
        }
    }

    #[inline(always)]
    fn room_in(storage: &mut [MaybeUninit<u16>]) -> &mut [MaybeUninit<u16>] {
        storage
    }
}

#[inline(never)]
fn append_widened(to: &mut BorrowedCursor<'_, u16>, latin1: &[u8]) {
    let mut wide = [0; 32];
    for block in latin1.chunks(wide.len()) {
        let wide = &mut wide[..block.len()];
        bun_core::strings::copy_u8_into_u16(wide, block);
        to.append(wide);
    }
}

#[inline(always)]
fn byte_at<U: Unit>(path: &[U], index: usize) -> u8 {
    path.get(index).map_or(OTHER, |unit| unit.byte())
}

#[inline(always)]
fn length_of(text: CodeUnits<'_>) -> usize {
    of_either_width!(text, |text| text.len())
}

#[inline(always)]
fn is_wide(text: CodeUnits<'_>) -> bool {
    matches!(text, CodeUnits::U16(_))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// Longer than a string can be.
    TooLong,
    OutOfMemory,
}

/// The arguments of a function that takes any number of paths. One is asked for when, and only if, Node looks at it.
pub trait Paths<'p>: Copy {
    type Error: From<Failure>;
    fn count(self) -> usize;
    /// The same text each time.
    fn get(self, index: usize) -> Result<CodeUnits<'p>, Self::Error>;
}

impl<'p> Paths<'p> for &[CodeUnits<'p>] {
    type Error = Failure;

    #[inline(always)]
    fn count(self) -> usize {
        self.len()
    }

    #[inline(always)]
    fn get(self, index: usize) -> Result<CodeUnits<'p>, Failure> {
        Ok(self[index])
    }
}

/// A path that a function has made.
pub enum Answer<'s> {
    /// The operand with that index.
    Operand(usize),
    /// That range of it.
    Part(usize, Range<usize>),
    Text(CodeUnits<'s>),
    Upwards(Upwards<'s>),
}

impl Answer<'static> {
    const HERE: Self = Answer::Text(CodeUnits::U8(b"."));
}

pub enum Resolved<'s> {
    Answer(Answer<'s>),
    /// It takes the working directory of the drive with that letter, or of the process.
    Needs(Option<u8>),
}

/// ".." `count` times, at least once, with `separator` between them, and then `rest`.
pub struct Upwards<'s> {
    count: usize,
    separator: u8,
    rest: CodeUnits<'s>,
}

impl Upwards<'_> {
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.count * 3 - 1 + length_of(self.rest)
    }

    #[inline(always)]
    pub fn is_wide(&self) -> bool {
        is_wide(self.rest)
    }

    /// `U` is `u16` if it [`is_wide`](Self::is_wide).
    #[inline(always)]
    pub fn write<U: Unit>(&self, mut to: BorrowedCursor<'_, U>) {
        let dot = U::from_u8(DOT);
        to.append(&[dot, dot]);
        for _ in 1..self.count {
            to.append(&[U::from_u8(self.separator), dot, dot]);
        }
        U::append(&mut to, self.rest);
    }

    pub fn written<'s>(&self, scratch: &'s mut Scratch) -> Result<&'s [u16], Failure> {
        let mut text = scratch.room(self.len())?;
        self.write(text.unfilled());
        Ok(text.into_filled())
    }
}

/// What `relative` answers: ".." `upwards` times, and then the range `rest` of `to`.
struct Relative {
    upwards: usize,
    rest: Range<usize>,
}

impl Relative {
    const SAME: Self = Relative::down(0..0);

    #[inline(always)]
    const fn down(rest: Range<usize>) -> Self {
        Relative { upwards: 0, rest }
    }

    /// `is_operand`: `to` is the second operand.
    #[inline(always)]
    fn answer(self, separator: u8, to: CodeUnits<'_>, is_operand: bool) -> Answer<'_> {
        if self.upwards == 0 && is_operand {
            return Answer::Part(1, self.rest);
        }
        let rest = of_either_width!(to, |to| PathByte::units(&to[self.rest]));
        if self.upwards == 0 {
            return Answer::Text(rest);
        }
        Answer::Upwards(Upwards {
            count: self.upwards,
            separator,
            rest,
        })
    }
}

/// Where a path of any length is put together.
#[repr(C, align(64))]
pub struct Scratch {
    short: [MaybeUninit<u16>; SHORT],
    long: Vec<u16>,
}

const SHORT: usize = 512;
/// What a function asks for beyond the length of the string that Node makes.
const SLACK: usize = 4;

impl Scratch {
    #[inline(always)]
    pub fn new() -> Self {
        Scratch {
            short: [const { MaybeUninit::uninit() }; SHORT],
            long: Vec::new(),
        }
    }

    #[inline(always)]
    fn room<U: Unit>(&mut self, length: usize) -> Result<BorrowedBuf<'_, U>, Failure> {
        let size = (length * size_of::<U>()).div_ceil(size_of::<u16>());
        let storage = if size <= SHORT {
            &mut self.short[..]
        } else {
            long_storage(&mut self.long, length, size)?
        };
        Ok(BorrowedBuf::from(U::room_in(storage)))
    }

    #[inline(always)]
    fn copy_of<U: Unit>(&mut self, text: &[U]) -> Result<&mut [U], Failure> {
        let mut copy = self.room(text.len())?;
        copy.unfilled().append(text);
        Ok(copy.into_filled_mut())
    }
}

#[cold]
#[inline(never)]
fn long_storage(
    long: &mut Vec<u16>,
    length: usize,
    size: usize,
) -> Result<&mut [MaybeUninit<u16>], Failure> {
    if length > bun_core::String::max_length() + SLACK {
        return Err(Failure::TooLong);
    }
    long.try_reserve_exact(size)
        .map_err(|_| Failure::OutOfMemory)?;
    Ok(long.spare_capacity_mut())
}

fn widened<'s>(text: CodeUnits<'s>, scratch: &'s mut Scratch) -> Result<&'s [u16], Failure> {
    match text {
        CodeUnits::U16(text) => Ok(text),
        CodeUnits::U8(latin1) => {
            let mut wide = scratch.room(latin1.len())?;
            append_widened(&mut wide.unfilled(), latin1);
            Ok(wide.into_filled())
        }
    }
}

/// The room that some paths take, each with a separator.
#[derive(Clone, Copy, Default)]
struct Extent {
    length: usize,
    is_wide: bool,
}

impl Extent {
    #[inline(always)]
    fn add(&mut self, path: CodeUnits<'_>) {
        self.length += length_of(path) + 1;
        self.is_wide |= is_wide(path);
    }

    /// Of those that are not empty.
    #[inline(always)]
    fn of<'p, P: Paths<'p>>(paths: P) -> Result<Self, P::Error> {
        let mut extent = Extent::default();
        for index in 0..paths.count() {
            let path = paths.get(index)?;
            if length_of(path) != 0 {
                extent.add(path);
            }
        }
        Ok(extent)
    }
}

/// Those from `start` on that are not empty, with `separator` between them.
#[inline(always)]
fn append_joined<'p, U: Unit, P: Paths<'p>>(
    to: &mut BorrowedCursor<'_, U>,
    paths: P,
    start: usize,
    separator: u8,
) -> Result<(), P::Error> {
    let before = to.written();
    for index in start..paths.count() {
        let path = paths.get(index)?;
        if length_of(path) == 0 {
            continue;
        }
        if to.written() != before {
            to.append(&[U::from_u8(separator)]);
        }
        U::append(to, path);
    }
    Ok(())
}

#[inline(always)]
fn replace<U: Unit>(path: &mut [U], from: u8, to: u8) {
    for unit in path {
        *unit = if unit.is(from) { U::from_u8(to) } else { *unit };
    }
}

/// `process.cwd()` in the other spelling: with backslashes for `win32`, and else with slashes and from the first of them on.
pub fn respell<'s, U: Unit>(
    directory: &[U],
    win32: bool,
    scratch: &'s mut Scratch,
) -> Result<&'s [U], Failure> {
    let copy = scratch.copy_of(directory)?;
    if win32 {
        replace(copy, SLASH, BACKSLASH);
        return Ok(copy);
    }
    replace(copy, BACKSLASH, SLASH);
    // `slice(-1)` if there is none.
    let start = scan::first(copy, SLASH).unwrap_or_else(|| copy.len().saturating_sub(1));
    Ok(&copy[start..])
}

/// What `parse` answers, as ranges of the path.
pub struct Parsed {
    pub root: Range<usize>,
    pub dir: Range<usize>,
    pub base: Range<usize>,
    pub ext: Range<usize>,
    pub name: Range<usize>,
}

#[inline(always)]
fn is_separator<U: Unit, const WIN32: bool>(unit: U) -> bool {
    unit.is(SLASH) | (WIN32 & unit.is(BACKSLASH))
}

/// 1 if `path` starts with the segment ".", 2 if with "..", and else 0.
#[inline(always)]
fn leading_dots<U: Unit, const SEPARATOR: u8>(path: &[U]) -> usize {
    let ends_at = |at: usize| at == path.len() || path[at].is(SEPARATOR);
    if byte_at(path, 0) != DOT {
        0
    } else if ends_at(1) {
        1
    } else if path[1].is(DOT) && ends_at(2) {
        2
    } else {
        0
    }
}

/// `path.len()` less the separators at its end, but at least `root`.
#[inline(always)]
fn end_of_names<U: Unit, const WIN32: bool>(path: &[U], root: usize) -> usize {
    let mut end = path.len();
    while end > root && is_separator::<U, WIN32>(path[end - 1]) {
        end -= 1;
    }
    end
}

#[inline(always)]
fn last_separator<U: Unit, const WIN32: bool>(path: &[U], within: Range<usize>) -> Option<usize> {
    let start = within.start;
    scan::last_separator::<U, WIN32>(&path[within]).map(|at| start + at)
}

/// The last name behind `root`. If there is none, it is empty and starts there.
#[inline(always)]
fn last_name<U: Unit, const WIN32: bool>(path: &[U], root: usize) -> Range<usize> {
    let end = end_of_names::<U, WIN32>(path, root);
    last_separator::<U, WIN32>(path, root..end).map_or(root, |at| at + 1)..end
}

/// `basename(path, suffix)`, where `name` is `basename(path)`.
#[inline(always)]
fn without_suffix<U: Unit, S: Unit>(path: &[U], name: Range<usize>, suffix: &[S]) -> Range<usize> {
    if suffix.is_empty() || suffix.len() > path.len() {
        return name;
    }
    if suffix.len() < name.len() {
        let stem = name.end - suffix.len();
        let has_suffix = scan::equal(&path[stem..name.end], suffix);
        return name.start..if has_suffix { stem } else { name.end };
    }
    if scan::equal(path, suffix) {
        return 0..0;
    }
    // Node has not seen where the name ends when it runs out before the suffix does.
    let unmatched = suffix.len() - name.len();
    if unmatched != 0 && scan::equal(&path[name.clone()], &suffix[unmatched..]) {
        return name.start..path.len();
    }
    name
}

/// From the last dot of the last name behind `root`, unless the name starts with it or is "..".
#[inline(always)]
fn extension<U: Unit, const WIN32: bool>(path: &[U], root: usize) -> Range<usize> {
    let end = end_of_names::<U, WIN32>(path, root);
    let names = &path[root..end];
    let starts_name = |at: usize| at == 0 || is_separator::<U, WIN32>(names[at - 1]);
    match scan::last_separator_or_dot::<U, WIN32>(names) {
        Some(dot)
            if names[dot].is(DOT)
                && !starts_name(dot)
                && !(dot + 1 == names.len() && names[dot - 1].is(DOT) && starts_name(dot - 1)) =>
        {
            root + dot..end
        }
        _ => 0..0,
    }
}

/// `parse` of a path whose root is `..root`. `start_at_root` is where Node takes a name that is right behind the root to start.
#[inline(always)]
fn parse<U: Unit, const WIN32: bool>(path: &[U], root: usize, start_at_root: usize) -> Parsed {
    let end = end_of_names::<U, WIN32>(path, root);
    let separator = last_separator::<U, WIN32>(path, root..end);
    let start = separator.map_or(root, |at| at + 1);
    let name = &path[start..end];
    let is_parent = name.len() == 2
        && name[0].is(DOT)
        && name[1].is(DOT)
        && (separator.is_some() || start == start_at_root);
    let dot = match scan::last_separator_or_dot::<U, WIN32>(&path[root..end]) {
        Some(at) if root + at > start && !is_parent => root + at,
        _ => end,
    };
    Parsed {
        root: 0..root,
        dir: 0..separator.unwrap_or(root),
        base: start..end,
        ext: dot..end,
        name: start..dot,
    }
}
