//! The basic URL parser, up to where the path starts.

use crate::components::{Components, State};
use crate::input::Source;
use crate::output::Output;
use crate::path::{is_normalized_drive_letter, starts_with_drive_letter};
use crate::record::View;
use crate::scheme::scan_scheme;
use crate::{Error, Punycode, Result, Scheme};

/// What the parser reads next, and the index in the input where it does.
#[derive(Clone, Copy)]
pub(crate) enum Step {
    Start,
    Authority(u32),
    /// At the first segment to add. The output has a slash before it.
    Segments(u32),
    /// Anywhere behind a slash that the input has.
    RestOfPath(u32),
    OpaquePath(u32),
    /// At a `?`, a `#` or the end.
    AfterPath(u32),
    RestOfQuery(u32),
    /// At a `#` or the end.
    AfterQuery(u32),
    RestOfFragment(u32),
}

/// Fails on a tab or a newline, for the caller to take them out and start over.
pub(crate) struct Parser<'a> {
    pub(crate) source: Source<'a>,
    pub(crate) punycode: Punycode,
    pub(crate) out: Output<'a>,
    pub(crate) parts: Components,
    /// If it has failed, it would have without tabs and newlines too.
    pub(crate) failure_is_final: bool,
}

impl<'a> Parser<'a> {
    #[inline]
    pub(crate) fn new(source: Source<'a>, punycode: Punycode, parts: Components) -> Parser<'a> {
        Parser {
            source,
            punycode,
            out: Output::new(source.bytes),
            parts,
            failure_is_final: false,
        }
    }

    #[inline]
    pub(crate) fn mark(&self, at: usize) -> u32 {
        self.out.position(at) as u32
    }

    #[inline]
    pub(crate) fn is_special(&self) -> bool {
        self.parts.scheme.is_special()
    }

    #[inline]
    pub(crate) fn is_slash(&self, at: usize) -> bool {
        match self.source.bytes.get(at) {
            Some(b'/') => true,
            Some(b'\\') => self.is_special(),
            _ => false,
        }
    }

    /// Reads what comes before the path. Only a tab or a newline can make the parser fail after that.
    pub(crate) fn head(&mut self, mut step: Step, base: Option<&View<'a>>) -> Result<Step> {
        if let Step::Start = step {
            step = self.start(base)?;
        }
        match step {
            Step::Authority(at) => self.authority(at as usize),
            step => Ok(step),
        }
    }

    #[inline]
    fn start(&mut self, base: Option<&View<'a>>) -> Result<Step> {
        if base.is_some_and(|base| !self.out.has_room_for(base.text)) {
            return Err(Error::OutOfMemory);
        }
        let input = self.source.bytes;
        let (colon, has_uppercase) = scan_scheme(input);
        match (input.get(colon), base) {
            (Some(b':'), _) if colon != 0 => {}
            (Some(b'\t' | b'\n' | b'\r'), _) => return Err(Error::Invalid),
            (_, Some(base)) => return self.no_scheme(base),
            (_, None) => {
                self.failure_is_final = true;
                return Err(Error::Invalid);
            }
        }
        let name = &input[..colon];
        let scheme = if has_uppercase {
            Scheme::of_any_case(name)
        } else {
            Scheme::of(name)
        };
        self.parts.scheme = scheme;
        self.parts.scheme_end = colon as u32;
        self.parts.state = State::Hierarchical;

        let at = colon + 1;
        let has_two_slashes = input[at..].starts_with(b"//");
        match (scheme, base.filter(|base| base.parts.scheme == scheme)) {
            (Scheme::File, base) => self.file(at, base),
            (Scheme::Other, _) => {
                if has_uppercase {
                    let out = self.out.interrupt(0)?;
                    out.extend(name)?;
                    out.make_ascii_lowercase();
                    self.out.resume(colon);
                }
                if has_two_slashes {
                    return Ok(Step::Authority(at as u32 + 2));
                }
                self.parts.set_empty_authority(at as u32);
                if input[at..].starts_with(b"/.//") {
                    self.parts.path_start += 2;
                }
                if self.is_slash(at) {
                    return Ok(Step::Segments(self.parts.path_start + 1));
                }
                self.parts.state = State::OpaquePath;
                Ok(Step::OpaquePath(at as u32))
            }
            (_, Some(base)) if !has_two_slashes => self.relative(at, base),
            _ => Ok(self.special_authority(at)),
        }
    }

    fn no_scheme(&mut self, base: &View<'a>) -> Result<Step> {
        if base.has_opaque_path() {
            return match self.source.bytes.first() {
                Some(b'#') => Ok(self.keep_query(0, base)),
                _ => Err(Error::Invalid),
            };
        }
        match base.parts.scheme {
            Scheme::File => self.file(0, Some(base)),
            _ => self.relative(0, base),
        }
    }

    /// Makes the output the scheme, which is special, and two slashes where the input has got to `at`.
    fn special_prefix(&mut self, at: usize) {
        let prefix = self.parts.scheme.prefix();
        self.parts.scheme_end = (prefix.len() - "://".len()) as u32;
        if self.source.bytes[..at] != *prefix {
            self.out.start_with(prefix, at);
        }
    }

    fn special_authority(&mut self, mut at: usize) -> Step {
        while self.is_slash(at) {
            at += 1;
        }
        self.special_prefix(at);
        Step::Authority(at as u32)
    }

    /// Takes the first `length` bytes of `base` for the input before `at`.
    fn inherit(&mut self, base: &View<'a>, length: u32, at: usize) {
        self.parts = base.parts;
        self.out.start_with(&base.text[..length as usize], at);
    }

    fn keep_query(&mut self, at: usize, base: &View<'a>) -> Step {
        self.inherit(base, base.parts.query_end, at);
        Step::AfterQuery(at as u32)
    }

    fn relative(&mut self, at: usize, base: &View<'a>) -> Result<Step> {
        self.parts = base.parts;
        if !self.is_slash(at) {
            return self.keep_path(at, base);
        }
        if !self.is_slash(at + 1) {
            self.inherit(base, base.parts.authority_end(), at);
            return self.path_start(at);
        }
        if self.is_special() {
            return Ok(self.special_authority(at));
        }
        self.inherit(base, base.parts.scheme_end + 1, at);
        Ok(Step::Authority(at as u32 + 2))
    }

    /// For input that has no slash at `at`.
    fn keep_path(&mut self, at: usize, base: &View<'a>) -> Result<Step> {
        match self.source.bytes.get(at) {
            None | Some(b'#') => return Ok(self.keep_query(at, base)),
            Some(b'?') => {
                self.inherit(base, base.parts.path_end, at);
                return Ok(Step::AfterPath(at as u32));
            }
            Some(_) => {}
        }
        let path = base.path();
        let is_file = base.parts.scheme == Scheme::File;
        if is_file && starts_with_drive_letter(&self.source.bytes[at..]) {
            self.inherit(base, base.parts.path_start + 1, at);
        } else if path.is_empty() || (is_file && is_normalized_drive_letter(&path[1..])) {
            self.inherit(base, base.parts.path_end, at);
            self.out.replace(at, at, b"/")?;
        } else {
            let last_slash = bun_highway::last_index_of_slash(path).unwrap_or(0);
            self.inherit(base, base.parts.path_start + last_slash as u32 + 1, at);
        }
        Ok(Step::Segments(at as u32))
    }

    /// `base` is a file URL.
    fn file(&mut self, at: usize, base: Option<&View<'a>>) -> Result<Step> {
        self.parts.scheme = Scheme::File;
        self.parts.state = State::Hierarchical;
        if self.is_slash(at) && self.is_slash(at + 1) {
            return self.file_host(at + 2);
        }
        let Some(base) = base else {
            self.special_prefix(at);
            self.parts.set_empty_authority(self.mark(at));
            return self.path_start(at);
        };
        if !self.is_slash(at) {
            return self.keep_path(at, base);
        }
        let keeps_drive = !starts_with_drive_letter(&self.source.bytes[at + 1..])
            && matches!(base.path(), [b'/', letter, b':'] | [b'/', letter, b':', b'/', ..] if letter.is_ascii_alphabetic());
        let drive_length = if keeps_drive { "/c:".len() as u32 } else { 0 };
        self.inherit(base, base.parts.path_start + drive_length, at);
        self.first_slash(at)
    }

    fn file_host(&mut self, start: usize) -> Result<Step> {
        self.special_prefix(start);
        self.parts.set_empty_authority(self.mark(start));
        if starts_with_drive_letter(&self.source.bytes[start..]) {
            return self.path_start(start);
        }
        let (end, traits) = self.scan_host(start);
        self.host_of_file(start, end, traits)?;
        self.parts.host_end = self.mark(end);
        self.path_start(end)
    }

    #[inline]
    pub(crate) fn path_start(&mut self, at: usize) -> Result<Step> {
        self.parts.path_start = self.mark(at);
        if !self.is_special() && !self.is_slash(at) {
            return Ok(Step::AfterPath(at as u32));
        }
        self.first_slash(at)
    }

    /// Sees to it that the output has a `/` here.
    #[inline]
    pub(crate) fn first_slash(&mut self, at: usize) -> Result<Step> {
        if self.source.bytes.get(at) == Some(&b'/') {
            return Ok(Step::Segments(at as u32 + 1));
        }
        let segments = at + usize::from(self.is_slash(at));
        self.out.replace(at, segments, b"/")?;
        Ok(Step::Segments(segments as u32))
    }
}
