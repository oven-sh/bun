//! Route patterns: the encoded byte form, static patterns, parts, and parsing errors.

use bun_paths::strings;
use core::fmt;
use core::mem::size_of;

use bun_alloc::{AllocError, Arena};
use bun_collections::array_hash_map::ArrayHashContext;
use bun_core::Output;
use bun_paths::MAX_PATH_BYTES;

use bun_paths::PathBuffer;

use super::*;

/// Route patterns are serialized in a stable byte format so it can be treated
/// as a string, while easily decodable as []Part.
// Copy: bitwise OK — `data` borrows from `pattern_string_arena`; the arena owns it.
#[derive(Copy, Clone)]
pub(crate) struct EncodedPattern {
    // ARENA: backed by `pattern_string_arena` (arena owns the bytes; outlives
    // every `EncodedPattern` — see `RawSlice` invariant in `bun_ptr`).
    pub(crate) data: bun_ptr::RawSlice<u8>,
}

impl EncodedPattern {
    #[inline]
    fn data(&self) -> &[u8] {
        self.data.slice()
    }

    pub(crate) fn pattern_serialized_length(parts: &[Part]) -> usize {
        let mut size: usize = 0;
        for part in parts {
            size += size_of::<u32>() + part.payload().len();
        }
        size
    }

    pub(crate) fn init_from_parts(
        parts: &[Part],
        arena: &Arena,
    ) -> Result<EncodedPattern, AllocError> {
        let len = Self::pattern_serialized_length(parts);
        let slice = arena.alloc_slice_fill_default::<u8>(len);
        {
            let mut fbs = bun_io::FixedBufferStream::new(&mut slice[..]);
            for part in parts {
                part.write_as_serialized(&mut fbs)
                    .expect("unreachable: enough space");
            }
            debug_assert!(fbs.pos == len);
        }
        Ok(EncodedPattern {
            data: bun_ptr::RawSlice::new(slice),
        })
    }

    pub(crate) fn iterate(&self) -> EncodedPatternIterator<'_> {
        EncodedPatternIterator {
            pattern: self.data(),
            offset: 0,
        }
    }

    pub(crate) fn effective_url_hash(&self) -> usize {
        // The strategy is to write all bytes, then hash them. Avoiding
        // multiple hash calls on small chunks. Allocation is not needed
        // since the upper bound is known (file path limits)
        let mut stack_space = [0u8; MAX_PATH_BYTES * 2];
        let mut pos: usize = 0;
        let mut push = |s: &[u8]| {
            stack_space[pos..pos + s.len()].copy_from_slice(s);
            pos += s.len();
        };
        let mut it = self.iterate();
        while let Some(item) = it.next() {
            match item {
                Part::Text(text) => {
                    push(b"/");
                    push(text);
                }
                // param names are not visible
                Part::Param(_) => push(b":"),
                Part::CatchAll(_) => push(b":."),
                Part::CatchAllOptional(_) => push(b":?"),
                // groups are completely unobservable
                Part::Group(_) => continue,
            }
        }
        bun_wyhash::hash(&stack_space[..pos]) as usize
    }

    pub(super) fn matches(&self, path: &[u8], params: &mut MatchedParams) -> bool {
        let mut param_num: usize = 0;
        let mut it = self.iterate();
        let mut i: usize = 1;
        while let Some(part) = it.next() {
            match part {
                Part::Text(expect) => {
                    if path.len() < i + expect.len()
                        || !(path.len() == i + expect.len() || path[i + expect.len()] == b'/')
                    {
                        return false;
                    }
                    if !strings::eql(&path[i..i + expect.len()], expect) {
                        return false;
                    }
                    i += 1 + expect.len();
                }
                Part::Param(name) => {
                    if i > path.len() {
                        return false;
                    }
                    let end = strings::index_of_char_pos(path, b'/', i).unwrap_or(path.len());
                    // Check if we're about to exceed the maximum number of parameters
                    if param_num >= MatchedParams::MAX_COUNT {
                        // TODO: ideally we should throw a nice user message
                        Output::panic(format_args!(
                            "Route pattern matched more than {} parameters. Path: {}",
                            MatchedParams::MAX_COUNT,
                            bstr::BStr::new(path)
                        ));
                    }
                    params.params.resize(param_num + 1).unwrap();
                    params.params.slice()[param_num] = MatchedParamEntry {
                        key: bun_ptr::RawSlice::new(name),
                        value: bun_ptr::RawSlice::new(&path[i..end]),
                    };
                    param_num += 1;
                    i = if end == path.len() { end } else { end + 1 };
                }
                Part::CatchAllOptional(name) | Part::CatchAll(name) => {
                    // Capture remaining path segments as individual parameters
                    if i < path.len() {
                        let mut segment_start = i;
                        while segment_start < path.len() {
                            let segment_end = strings::index_of_char_pos(path, b'/', segment_start)
                                .unwrap_or(path.len());
                            if segment_start < segment_end {
                                // Check if we're about to exceed the maximum number of parameters
                                if param_num >= MatchedParams::MAX_COUNT {
                                    return false;
                                }
                                params.params.resize(param_num + 1).unwrap();
                                params.params.slice()[param_num] = MatchedParamEntry {
                                    key: bun_ptr::RawSlice::new(name),
                                    value: bun_ptr::RawSlice::new(
                                        &path[segment_start..segment_end],
                                    ),
                                };
                                param_num += 1;
                            }
                            segment_start = if segment_end == path.len() {
                                segment_end
                            } else {
                                segment_end + 1
                            };
                        }
                    }
                    return true;
                }
                Part::Group(_) => continue,
            }
        }
        i == path.len()
    }
}

pub(crate) struct EncodedPatternIterator<'a> {
    pattern: &'a [u8],
    offset: usize,
}

impl<'a> EncodedPatternIterator<'a> {
    fn read_with_size(&self) -> (Part<'a>, usize) {
        let header = SerializedHeader(u32::from_le_bytes(
            self.pattern[self.offset..self.offset + size_of::<u32>()]
                .try_into()
                .unwrap(),
        ));
        let payload = &self.pattern
            [self.offset + size_of::<u32>()..self.offset + size_of::<u32>() + header.len()];
        let part = match header.tag() {
            PartTag::Text => Part::Text(payload),
            PartTag::Param => Part::Param(payload),
            PartTag::CatchAllOptional => Part::CatchAllOptional(payload),
            PartTag::CatchAll => Part::CatchAll(payload),
            PartTag::Group => Part::Group(payload),
        };
        (part, size_of::<u32>() + header.len())
    }
}

impl<'a> Iterator for EncodedPatternIterator<'a> {
    type Item = Part<'a>;
    fn next(&mut self) -> Option<Part<'a>> {
        if self.offset >= self.pattern.len() {
            return None;
        }
        let (part, len) = self.read_with_size();
        self.offset += len;
        Some(part)
    }
}

/// Hash context for DynamicRouteMap — hashes/compares by effective URL.
#[derive(Default, Clone, Copy)]
pub(crate) struct EffectiveUrlContext;
impl ArrayHashContext<EncodedPattern> for EffectiveUrlContext {
    fn hash(&self, p: &EncodedPattern) -> u32 {
        p.effective_url_hash() as u32 // @truncate
    }
    fn eql(&self, a: &EncodedPattern, b: &EncodedPattern, _: usize) -> bool {
        a.effective_url_hash() == b.effective_url_hash()
    }
}

/// Wrapper around a slice to provide same interface to be used in `insert`
/// but with the allocation being backed by a plain string, which each
/// part separated by slashes.
pub(crate) struct StaticPattern {
    // ARENA: backed by `pattern_string_arena` (arena owns the bytes; outlives
    // every `StaticPattern` — see `RawSlice` invariant in `bun_ptr`).
    pub route_path: bun_ptr::RawSlice<u8>,
}

impl StaticPattern {
    #[inline]
    pub(super) fn route_path(&self) -> &[u8] {
        self.route_path.slice()
    }

    pub(super) fn iterate(&self) -> StaticPatternIterator<'_> {
        StaticPatternIterator {
            pattern: self.route_path(),
            offset: 0,
        }
    }
}

pub(crate) struct StaticPatternIterator<'a> {
    pattern: &'a [u8],
    offset: usize,
}

impl<'a> StaticPatternIterator<'a> {
    fn read_with_size(&self) -> (Part<'a>, usize) {
        let next_i = strings::index_of_char_pos(self.pattern, b'/', self.offset + 1)
            .unwrap_or(self.pattern.len());
        let text = &self.pattern[self.offset + 1..next_i];
        (Part::Text(text), text.len() + 1)
    }
}

impl<'a> Iterator for StaticPatternIterator<'a> {
    type Item = Part<'a>;
    fn next(&mut self) -> Option<Part<'a>> {
        if self.offset >= self.pattern.len() {
            return None;
        }
        let (part, len) = self.read_with_size();
        self.offset += len;
        Some(part)
    }
}

/// A part of a URL pattern
#[derive(Copy, Clone, bun_core::EnumTag)]
#[enum_tag(existing = PartTag)]
pub(crate) enum Part<'a> {
    /// Does not contain slashes. One per slash.
    Text(&'a [u8]),
    Param(&'a [u8]),
    /// Must be the last part of the pattern
    CatchAllOptional(&'a [u8]),
    /// Must be the last part of the pattern
    CatchAll(&'a [u8]),
    /// Does not affect URL matching, but does affect hierarchy.
    Group(&'a [u8]),
}

#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u8)]
enum PartTag {
    Text = 0,
    Param = 1,
    CatchAllOptional = 2,
    CatchAll = 3,
    Group = 4,
}

/// `packed struct(u32) { tag: u3, len: u29 }`
#[repr(transparent)]
#[derive(Copy, Clone)]
struct SerializedHeader(u32);

impl SerializedHeader {
    #[inline]
    fn new(tag: PartTag, len: u32) -> Self {
        debug_assert!(len < (1 << 29));
        Self((tag as u32) | (len << 3))
    }
    #[inline]
    fn tag(self) -> PartTag {
        // tag is written from PartTag, which is in range 0..=4
        match (self.0 & 0b111) as u8 {
            0 => PartTag::Text,
            1 => PartTag::Param,
            2 => PartTag::CatchAllOptional,
            3 => PartTag::CatchAll,
            4 => PartTag::Group,
            _ => unreachable!(),
        }
    }
    #[inline]
    fn len(self) -> usize {
        (self.0 >> 3) as usize
    }
}

impl<'a> Part<'a> {
    #[inline]
    fn payload(&self) -> &'a [u8] {
        match *self {
            Part::Text(t)
            | Part::Param(t)
            | Part::CatchAllOptional(t)
            | Part::CatchAll(t)
            | Part::Group(t) => t,
        }
    }

    pub(crate) fn write_as_serialized(&self, writer: &mut impl bun_io::Write) -> crate::Result<()> {
        if let Part::Text(text) = self {
            debug_assert!(!text.is_empty());
            debug_assert!(strings::index_of_char(text, b'/').is_none());
        }
        let payload = self.payload();
        let header =
            SerializedHeader::new(self.tag(), u32::try_from(payload.len()).expect("int cast"));
        writer.write_all(&header.0.to_le_bytes())?;
        writer.write_all(payload)?;
        Ok(())
    }

    pub(crate) fn eql(&self, b: &Part<'_>) -> bool {
        if self.tag() != b.tag() {
            return false;
        }
        strings::eql(self.payload(), b.payload())
    }

    pub(super) fn to_string_for_internal_use(&self, w: &mut impl fmt::Write) -> fmt::Result {
        match self {
            Part::Text(text) => write!(w, "/{}", bstr::BStr::new(text)),
            Part::Param(param_name) => write!(w, "/:{}", bstr::BStr::new(param_name)),
            Part::Group(label) => write!(w, "/({})", bstr::BStr::new(label)),
            Part::CatchAll(param_name) => write!(w, "/:*{}", bstr::BStr::new(param_name)),
            Part::CatchAllOptional(param_name) => write!(w, "/:*?{}", bstr::BStr::new(param_name)),
        }
    }
}

impl fmt::Display for Part<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Part \"")?;
        self.to_string_for_internal_use(f)?;
        f.write_str("\"")
    }
}

pub(crate) struct ParsedPattern<'a> {
    pub parts: &'a [Part<'a>],
    pub kind: ParsedPatternKind,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum ParsedPatternKind {
    /// Can be navigated to. Pages can have children, which allows having
    /// nested routes exactly how Remix allows them.
    Page,
    /// Is not considered when resolving navigations, but is still a valid
    /// node in the route tree.
    Layout,
    /// Another file related to a route
    Extra,
}

// `Part` stored in `Route` borrows from the router's own `pattern_string_arena`.
// Rust cannot express that self-referential borrow, so `to_owned_part` detaches
// the lifetime when storing into `Route`.
impl<'a> Part<'a> {
    /// Detach the borrow lifetime so this `Part` can be stored in `Route`.
    ///
    /// # Safety
    /// Every payload slice must point into `FrameworkRouter::pattern_string_arena`
    /// (or other storage that outlives the owning `FrameworkRouter`).
    #[allow(unsafe_op_in_unsafe_fn)]
    pub(super) unsafe fn to_owned_part(self) -> Part<'static> {
        // Variant-by-variant detach (no bitcast). `d` stays `unsafe fn` so a
        // safe-signature wrapper does not hide the lifetime-widen.
        #[inline(always)]
        unsafe fn d(s: &[u8]) -> &'static [u8] {
            // SAFETY: (`Interned::assume` — Population B, holder-backed) every
            // payload slice points into `FrameworkRouter::pattern_string_arena`,
            // which is owned by the `FrameworkRouter` and freed only on
            // router drop/reset — strictly after every `Route` holding a
            // `Part<'static>` is gone. NOT process-lifetime; a `'bump`
            // parameter on `Part` would model this more precisely.
            unsafe { bun_ptr::Interned::assume(s) }.as_bytes()
        }
        match self {
            Part::Text(s) => Part::Text(d(s)),
            Part::Param(s) => Part::Param(d(s)),
            Part::CatchAllOptional(s) => Part::CatchAllOptional(d(s)),
            Part::CatchAll(s) => Part::CatchAll(d(s)),
            Part::Group(s) => Part::Group(d(s)),
        }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum PatternParseError {
    #[error("InvalidRoutePattern")]
    InvalidRoutePattern,
}

impl From<PatternParseError> for crate::Error {
    fn from(e: PatternParseError) -> Self {
        match e {
            PatternParseError::InvalidRoutePattern => crate::Error::InvalidRoutePattern,
        }
    }
}

/// Stack-allocated structure that is written to from end to start.
/// Used as a staging area for building pattern strings.
pub(crate) struct PatternBuffer {
    pub(crate) bytes: PathBuffer,
    // On Windows MAX_PATH_BYTES = 32767*3+1 = 98302
    // (> u16::MAX), so u32 is required; u16 would truncate the initial index
    // to 32766 and `slice()` would return ~64 KiB of trailing zero bytes.
    pub(crate) i: u32,
}

impl PatternBuffer {
    pub(crate) const EMPTY: PatternBuffer = PatternBuffer {
        bytes: PathBuffer::ZEROED,
        i: core::mem::size_of::<PathBuffer>() as u32,
    };

    pub(crate) fn prepend(&mut self, chunk: &[u8]) {
        debug_assert!(self.i as usize >= chunk.len());
        self.i -= u32::try_from(chunk.len()).expect("int cast");
        self.slice_mut()[..chunk.len()].copy_from_slice(chunk);
    }

    pub(crate) fn prepend_part(&mut self, part: Part) {
        match part {
            Part::Text(text) => {
                debug_assert!(text.is_empty() || text[0] != b'/');
                self.prepend(text);
                self.prepend(b"/");
            }
            Part::Param(name) | Part::CatchAll(name) | Part::CatchAllOptional(name) => {
                self.prepend(name);
                self.prepend(b"/:");
            }
            Part::Group(_) => {}
        }
    }

    pub(crate) fn slice(&self) -> &[u8] {
        &self.bytes[self.i as usize..]
    }

    fn slice_mut(&mut self) -> &mut [u8] {
        &mut self.bytes[self.i as usize..]
    }
}
