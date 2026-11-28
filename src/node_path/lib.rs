//! <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js> on the Latin-1 or UTF-16 code units of a JavaScript string.
#![forbid(unsafe_code)]
#![feature(core_io_borrowed_buf, maybe_uninit_as_bytes)]

use core::mem::MaybeUninit;
use core::ops::Range;

use bun_core::AllocError;
use bun_core::strings::CodeUnits;
use bun_core::vec::{BorrowedBuf, BorrowedCursor};
use bun_paths::PathChar;

/// Evaluates `$body` with `$units` bound to the `&[u8]` or `&[u16]` in `$text`.
macro_rules! match_code_units {
    ($text:expr, |$units:ident| $body:expr) => {
        match $text {
            bun_core::strings::CodeUnits::U8($units) => $body,
            bun_core::strings::CodeUnits::U16($units) => $body,
        }
    };
}

mod error;
pub mod fast_path;
pub mod glob;
mod normalize_string;
pub mod posix;
mod scan;
mod unicode;
pub mod utf8;
pub mod win32;

pub use error::{Error, Result};

const SLASH: u8 = b'/';
const BACKSLASH: u8 = b'\\';
const DOT: u8 = b'.';
const COLON: u8 = b':';
/// Stands in for a unit above Latin-1 and for an index out of bounds. No path or glob syntax uses it.
const NOT_SPECIAL: u8 = u8::MAX;

/// `path.posix` or `path.win32`. `Bun::PathPlatform` in Path.h.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Platform {
    Posix,
    Win32,
}

impl Platform {
    #[inline(always)]
    pub const fn new(win32: bool) -> Self {
        if win32 {
            Platform::Win32
        } else {
            Platform::Posix
        }
    }
}

/// `u8` (Latin-1) or `u16` (UTF-16).
pub trait CodeUnit: PathChar + Into<u16> {
    fn to_u8_saturating(self) -> u8;

    /// Panics if `text` is wider than `Self`.
    fn append(to: &mut BorrowedCursor<'_, Self>, text: CodeUnits<'_>);

    fn cast_storage(storage: &mut [MaybeUninit<u16>]) -> &mut [MaybeUninit<Self>];
}

impl CodeUnit for u8 {
    #[inline(always)]
    fn to_u8_saturating(self) -> u8 {
        self
    }

    #[inline(always)]
    fn append(to: &mut BorrowedCursor<'_, u8>, text: CodeUnits<'_>) {
        match text {
            CodeUnits::U8(text) => to.append(text),
            CodeUnits::U16(_) => unreachable!("the buffer is as wide as the widest argument"),
        }
    }

    #[inline(always)]
    fn cast_storage(storage: &mut [MaybeUninit<u16>]) -> &mut [MaybeUninit<u8>] {
        storage.as_bytes_mut()
    }
}

impl CodeUnit for u16 {
    #[inline(always)]
    fn to_u8_saturating(self) -> u8 {
        self.min(u16::from(NOT_SPECIAL)) as u8
    }

    #[inline(always)]
    fn append(to: &mut BorrowedCursor<'_, u16>, text: CodeUnits<'_>) {
        match text {
            CodeUnits::U8(text) => append_latin1_as_utf16(to, text),
            CodeUnits::U16(text) => to.append(text),
        }
    }

    #[inline(always)]
    fn cast_storage(storage: &mut [MaybeUninit<u16>]) -> &mut [MaybeUninit<u16>] {
        storage
    }
}

#[inline(always)]
fn append_latin1_as_utf16(to: &mut BorrowedCursor<'_, u16>, latin1: &[u8]) {
    let mut utf16 = [0; 32];
    for block in latin1.chunks(utf16.len()) {
        let utf16 = &mut utf16[..block.len()];
        bun_core::strings::copy_u8_into_u16(utf16, block);
        to.append(utf16);
    }
}

#[inline(always)]
fn byte_at<U: CodeUnit>(path: &[U], index: usize) -> u8 {
    path.get(index)
        .map_or(NOT_SPECIAL, |unit| unit.to_u8_saturating())
}

/// The `...args` of `join` and `resolve`. An argument is only loaded if Node reads it.
pub trait PathArgs: Copy {
    type Error: From<Error>;
    type Guard;
    fn len(self) -> usize;
    /// Loading an argument again gives the same text, and never a wider one.
    fn load(self, index: usize) -> Result<Self::Guard, Self::Error>;
    fn units(guard: &Self::Guard) -> CodeUnits<'_>;
}

impl<'p> PathArgs for &[CodeUnits<'p>] {
    type Error = Error;
    type Guard = CodeUnits<'p>;

    #[inline(always)]
    fn len(self) -> usize {
        <[_]>::len(self)
    }

    #[inline(always)]
    fn load(self, index: usize) -> Result<CodeUnits<'p>> {
        Ok(self[index])
    }

    #[inline(always)]
    fn units<'a>(guard: &'a CodeUnits<'p>) -> CodeUnits<'a> {
        *guard
    }
}

/// The path that a function returns.
pub enum Output<'s> {
    Arg(usize),
    ArgSlice(usize, Range<usize>),
    Built(CodeUnits<'s>),
    DotDots(DotDots<'s>),
}

impl Output<'static> {
    const DOT: Self = Output::Built(CodeUnits::U8(b"."));
}

pub enum ResolveStep<T> {
    Done(T),
    NeedsCwd,
    NeedsDriveCwd(u8),
}

impl<T> ResolveStep<T> {
    #[inline(always)]
    pub fn try_map<R, E>(self, map: impl FnOnce(T) -> Result<R, E>) -> Result<ResolveStep<R>, E> {
        Ok(match self {
            ResolveStep::Done(output) => ResolveStep::Done(map(output)?),
            ResolveStep::NeedsCwd => ResolveStep::NeedsCwd,
            ResolveStep::NeedsDriveCwd(letter) => ResolveStep::NeedsDriveCwd(letter),
        })
    }

    /// For a call that was given a `cwd`.
    #[inline(always)]
    pub fn unwrap_done(self) -> T {
        match self {
            ResolveStep::Done(output) => output,
            _ => unreachable!("resolve needs one cwd at most"),
        }
    }
}

/// `count` times "..", joined by `separator`, then `rest`.
pub struct DotDots<'s> {
    count: usize,
    separator: u8,
    rest: CodeUnits<'s>,
}

impl DotDots<'_> {
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.count * "../".len() - "/".len() + self.rest.len()
    }

    #[inline(always)]
    pub fn is_16bit(&self) -> bool {
        self.rest.is_16bit()
    }

    /// Panics if `U` is `u8` and this [`is_16bit`](Self::is_16bit).
    #[inline(always)]
    pub fn write<U: CodeUnit>(&self, mut to: BorrowedCursor<'_, U>) {
        let dot = U::from_u8(DOT);
        to.append(&[dot, dot]);
        for _ in 1..self.count {
            to.append(&[U::from_u8(self.separator), dot, dot]);
        }
        U::append(&mut to, self.rest);
    }

    pub fn to_utf16_in<'s>(&self, scratch: &'s mut Scratch) -> Result<&'s [u16]> {
        let mut text = scratch.buffer(self.len())?;
        self.write(text.unfilled());
        Ok(text.into_filled())
    }
}

/// The result of `relative(from, to)`: `dotdots` times "..", then `to[rest]`.
struct Relative {
    dotdots: usize,
    rest: Range<usize>,
}

/// Where the resolved `to` of `relative(from, to)` is.
#[derive(Clone, Copy)]
enum Origin {
    Arg,
    Scratch,
}

impl Relative {
    const EMPTY: Self = Relative::slice_of_to(0..0);
    const INDEX_OF_TO: usize = 1;

    #[inline(always)]
    const fn slice_of_to(rest: Range<usize>) -> Self {
        Relative { dotdots: 0, rest }
    }

    #[inline(always)]
    fn into_output(self, separator: u8, to: CodeUnits<'_>, origin: Origin) -> Output<'_> {
        match (self.dotdots, origin) {
            (0, Origin::Arg) => Output::ArgSlice(Self::INDEX_OF_TO, self.rest),
            (0, Origin::Scratch) => Output::Built(to.slice(self.rest)),
            (count, _) => Output::DotDots(DotDots {
                count,
                separator,
                rest: to.slice(self.rest),
            }),
        }
    }
}

/// Storage to build a path of any length in.
#[repr(C, align(64))]
pub struct Scratch {
    inline: [MaybeUninit<u16>; INLINE_CAPACITY],
    heap: Vec<u16>,
}

const INLINE_CAPACITY: usize = 512;

impl Scratch {
    #[inline(always)]
    pub fn new() -> Self {
        Scratch {
            inline: [const { MaybeUninit::uninit() }; INLINE_CAPACITY],
            heap: Vec::new(),
        }
    }

    /// An empty buffer with a capacity of exactly `len`.
    #[inline(always)]
    fn buffer<U: CodeUnit>(&mut self, len: usize) -> Result<BorrowedBuf<'_, U>> {
        let storage_len = (len * size_of::<U>()).div_ceil(size_of::<u16>());
        let storage = if storage_len <= INLINE_CAPACITY {
            &mut self.inline[..]
        } else {
            heap_storage(&mut self.heap, len, storage_len)?
        };
        Ok(BorrowedBuf::from(&mut U::cast_storage(storage)[..len]))
    }

    #[inline(always)]
    fn copy_of<U: CodeUnit>(&mut self, text: &[U]) -> Result<&mut [U]> {
        let mut copy = self.buffer(text.len())?;
        copy.unfilled().append(text);
        Ok(copy.into_filled_mut())
    }
}

#[cold]
#[inline(never)]
fn heap_storage(
    heap: &mut Vec<u16>,
    len: usize,
    storage_len: usize,
) -> Result<&mut [MaybeUninit<u16>]> {
    if len > bun_core::String::max_length() + win32::PADDING {
        return Err(Error::StringTooLong);
    }
    heap.try_reserve_exact(storage_len)
        .map_err(|_| AllocError)?;
    Ok(heap.spare_capacity_mut())
}

fn to_utf16_in<'s>(text: CodeUnits<'s>, scratch: &'s mut Scratch) -> Result<&'s [u16]> {
    match text {
        CodeUnits::U16(text) => Ok(text),
        CodeUnits::U8(latin1) => {
            let mut utf16 = scratch.buffer(latin1.len())?;
            append_latin1_as_utf16(&mut utf16.unfilled(), latin1);
            Ok(utf16.into_filled())
        }
    }
}

/// The buffer that some paths need with a separator after each.
#[derive(Clone, Copy, Default)]
struct JoinedSize {
    len: usize,
    is_16bit: bool,
}

impl JoinedSize {
    #[inline(always)]
    fn add(&mut self, path: CodeUnits<'_>) {
        self.len += path.len() + 1;
        self.is_16bit |= path.is_16bit();
    }

    #[inline(always)]
    fn of_non_empty<P: PathArgs>(paths: P) -> Result<Self, P::Error> {
        let mut size = JoinedSize::default();
        for index in 0..paths.len() {
            let path = paths.load(index)?;
            let path = P::units(&path);
            if !path.is_empty() {
                size.add(path);
            }
        }
        Ok(size)
    }
}

/// Appends the non-empty `paths[start..]` joined by `separator`. Returns the length of the first.
#[inline(always)]
fn append_joined<U: CodeUnit, P: PathArgs>(
    to: &mut BorrowedCursor<'_, U>,
    paths: P,
    start: usize,
    separator: u8,
) -> Result<usize, P::Error> {
    let mut first_len = 0;
    for index in start..paths.len() {
        let path = paths.load(index)?;
        let path = P::units(&path);
        if path.is_empty() {
            continue;
        }
        if first_len == 0 {
            first_len = path.len();
        } else {
            to.append(&[U::from_u8(separator)]);
        }
        U::append(to, path);
    }
    Ok(first_len)
}

/// The result of `parse`, as ranges of the path.
pub struct ParsedRanges {
    pub root: Range<usize>,
    pub dir: Range<usize>,
    pub base: Range<usize>,
    pub ext: Range<usize>,
    pub name: Range<usize>,
}

#[inline(always)]
fn is_sep<U: CodeUnit, const WIN32: bool>(unit: U) -> bool {
    unit.eq_ascii(SLASH) | (WIN32 & unit.eq_ascii(BACKSLASH))
}

/// The length of the "." or ".." segment that `path` starts with, 0 if it starts with neither.
#[inline(always)]
fn dot_segment_len<U: CodeUnit, const SEPARATOR: u8>(path: &[U]) -> usize {
    let ends_at = |at: usize| at == path.len() || path[at].eq_ascii(SEPARATOR);
    if byte_at(path, 0) != DOT {
        0
    } else if ends_at(1) {
        1
    } else if path[1].eq_ascii(DOT) && ends_at(2) {
        2
    } else {
        0
    }
}

/// At least `root_end`.
#[inline(always)]
fn len_without_trailing_sep<U: CodeUnit, const WIN32: bool>(path: &[U], root_end: usize) -> usize {
    let mut end = path.len();
    while end > root_end && is_sep::<U, WIN32>(path[end - 1]) {
        end -= 1;
    }
    end
}

#[inline(always)]
fn last_index_of_sep_in<U: CodeUnit, const WIN32: bool>(
    path: &[U],
    within: Range<usize>,
) -> Option<usize> {
    let start = within.start;
    scan::last_index_of_any_sep::<U, WIN32>(&path[within]).map(|at| start + at)
}

#[inline(always)]
fn basename<U: CodeUnit, const WIN32: bool>(path: &[U], root_end: usize) -> Range<usize> {
    let end = len_without_trailing_sep::<U, WIN32>(path, root_end);
    last_index_of_sep_in::<U, WIN32>(path, root_end..end).map_or(root_end, |at| at + 1)..end
}

/// `basename(path, suffix)`, given `base = basename(path)`.
#[inline(always)]
fn without_suffix<U: CodeUnit, S: CodeUnit>(
    path: &[U],
    base: Range<usize>,
    suffix: &[S],
) -> Range<usize> {
    if suffix.is_empty() || suffix.len() > path.len() {
        return base;
    }
    if suffix.len() < base.len() {
        let stem_end = base.end - suffix.len();
        let has_suffix = scan::eql(&path[stem_end..base.end], suffix);
        return base.start..if has_suffix { stem_end } else { base.end };
    }
    if scan::eql(path, suffix) {
        return 0..0;
    }
    // basename("/x/b/", "ab") is "b/": https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1519-L1520
    let unmatched = suffix.len() - base.len();
    if unmatched != 0 && scan::eql(&path[base.clone()], &suffix[unmatched..]) {
        return base.start..path.len();
    }
    base
}

#[inline(always)]
fn extname<U: CodeUnit, const WIN32: bool>(path: &[U], root_end: usize) -> Range<usize> {
    let end = len_without_trailing_sep::<U, WIN32>(path, root_end);
    let tail = &path[root_end..end];
    let starts_segment = |at: usize| at == 0 || is_sep::<U, WIN32>(tail[at - 1]);
    let ends_dotdot = |dot: usize| {
        dot + 1 == tail.len() && tail[dot - 1].eq_ascii(DOT) && starts_segment(dot - 1)
    };
    match scan::last_index_of_any_sep_or_dot::<U, WIN32>(tail) {
        Some(dot) if tail[dot].eq_ascii(DOT) && !starts_segment(dot) && !ends_dotdot(dot) => {
            root_end + dot..end
        }
        _ => 0..0,
    }
}

/// `initial_start_part` is what Node's `startPart` is until it finds a separator.
#[inline(always)]
fn parse<U: CodeUnit, const WIN32: bool>(
    path: &[U],
    root_end: usize,
    initial_start_part: usize,
) -> ParsedRanges {
    let end = len_without_trailing_sep::<U, WIN32>(path, root_end);
    let separator = last_index_of_sep_in::<U, WIN32>(path, root_end..end);
    let start = separator.map_or(root_end, |at| at + 1);
    let base = &path[start..end];
    let is_dotdot = base.len() == 2
        && base[0].eq_ascii(DOT)
        && base[1].eq_ascii(DOT)
        && (separator.is_some() || start == initial_start_part);
    let ext_start = match scan::last_index_of_any_sep_or_dot::<U, WIN32>(&path[root_end..end]) {
        Some(at) if root_end + at > start && !is_dotdot => root_end + at,
        _ => end,
    };
    ParsedRanges {
        root: 0..root_end,
        dir: 0..separator.unwrap_or(root_end),
        base: start..end,
        ext: ext_start..end,
        name: start..ext_start,
    }
}
