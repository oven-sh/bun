//! The basic URL parser, from the path on.

use bun_highway::url::Scan;

use crate::class::{
    self, C0_CONTROL, FRAGMENT, NUMBER_SIGN, OPAQUE_PATH_SCAN, PATH, PERCENT, QUERY, QUESTION_MARK,
    SPECIAL_QUERY, Set, TAIL_SCAN,
};
use crate::parser::{Parser, Step};
use crate::{Error, Result, Scheme, percent};

pub(crate) fn is_normalized_drive_letter(segment: &[u8]) -> bool {
    matches!(segment, [letter, b':'] if letter.is_ascii_alphabetic())
}

pub(crate) fn starts_with_drive_letter(text: &[u8]) -> bool {
    matches!(
        text,
        [letter, b':' | b'|'] | [letter, b':' | b'|', b'/' | b'\\' | b'?' | b'#', ..]
            if letter.is_ascii_alphabetic()
    )
}

/// The length of the dot that `text` starts with.
#[inline]
fn dot(text: &[u8], set: Set) -> Option<usize> {
    match text {
        [b'.', ..] => Some(1),
        [b'%', b'2', b'e' | b'E', ..] if set & PERCENT == 0 => Some(3),
        _ => None,
    }
}

/// How the bytes of a path are read.
#[derive(Clone, Copy)]
pub(crate) struct PathSyntax {
    /// What to encode. A `?`, a `#` or a `%` that is in it means nothing else.
    pub(crate) set: Set,
    pub(crate) backslash_is_slash: bool,
}

impl PathSyntax {
    #[inline]
    fn is_slash(self, byte: u8) -> bool {
        byte == b'/' || (byte == b'\\' && self.backslash_is_slash)
    }

    #[inline]
    fn ends_segment(self, byte: Option<&u8>) -> bool {
        byte.is_none_or(|&byte| {
            self.is_slash(byte) || class::is_in((QUESTION_MARK | NUMBER_SIGN) & !self.set, byte)
        })
    }

    /// The length of the dot segment that `text` starts with, and whether it has two dots.
    #[inline]
    pub(crate) fn dot_segment(self, text: &[u8]) -> Option<(usize, bool)> {
        let first = dot(text, self.set)?;
        let second = dot(&text[first..], self.set).unwrap_or(0);
        self.ends_segment(text.get(first + second))
            .then_some((first + second, second != 0))
    }
}

impl<'a> Parser<'a> {
    /// `step` is one that [`Self::head`] returns.
    pub(crate) fn tail(&mut self, mut step: Step) -> Result<()> {
        let input = self.source.bytes;
        let syntax = self.path_syntax(PATH);
        let start = match step {
            Step::Start | Step::Authority(_) => return Err(Error::Invalid),
            Step::Segments(at) => self.segment_start(at as usize, syntax)?,
            Step::OpaquePath(at) => {
                let end = self.opaque_path(at as usize)?;
                step = Step::AfterPath(end as u32);
                end + 1
            }
            Step::AfterPath(at) | Step::AfterQuery(at) => at as usize + 1,
            Step::RestOfPath(at) | Step::RestOfQuery(at) | Step::RestOfFragment(at) => at as usize,
        };
        let mut scan = TAIL_SCAN.scan(input, start);
        if let Step::Segments(_) | Step::RestOfPath(_) = step {
            step = Step::AfterPath(self.path(&mut scan, syntax)? as u32);
        }
        if let Step::AfterPath(at) = step {
            self.parts.path_end = self.mark(at as usize);
            step = match input.get(at as usize) {
                Some(b'?') => Step::RestOfQuery(at),
                _ => Step::AfterQuery(at),
            };
        }
        if let Step::RestOfQuery(_) = step {
            step =
                Step::AfterQuery(self.encode_up_to_fragment(&mut scan, self.query_set())? as u32);
        }
        if let Step::AfterQuery(at) = step {
            self.parts.query_end = self.mark(at as usize);
        }
        while self.encode_up_to_fragment(&mut scan, FRAGMENT)? < input.len() {}
        Ok(())
    }

    #[inline]
    pub(crate) fn path_syntax(&self, set: Set) -> PathSyntax {
        PathSyntax {
            set,
            backslash_is_slash: self.is_special(),
        }
    }

    #[inline]
    pub(crate) fn query_set(&self) -> Set {
        if self.is_special() {
            SPECIAL_QUERY
        } else {
            QUERY
        }
    }

    #[inline]
    pub(crate) fn escape(&mut self, start: usize, end: usize) -> Result<()> {
        let bytes = &self.source.bytes[start..end];
        percent::escape_all(self.source.with_bytes(bytes), self.out.interrupt(start)?)?;
        self.out.resume(end);
        Ok(())
    }

    /// Escapes the bytes of `set` that the input has from `start` on. Returns the index behind them.
    fn escape_run(&mut self, start: usize, set: Set) -> Result<usize> {
        let end = start + class::run_length(set, &self.source.bytes[start..]);
        self.escape(start, end)?;
        Ok(end)
    }

    /// Returns the index of the next `#` that is not in `set`, or of the end.
    #[inline(always)]
    pub(crate) fn encode_up_to_fragment(&mut self, scan: &mut Scan<'a>, set: Set) -> Result<usize> {
        while let Some(at) = scan.next() {
            match self.source.bytes[at] {
                byte if class::is_in(set, byte) => scan.skip_to(self.escape_run(at, set)?),
                b'#' => return Ok(at),
                b'\t' | b'\n' | b'\r' => return Err(Error::Invalid),
                _ => {}
            }
        }
        Ok(self.source.bytes.len())
    }

    /// Returns where the path ends, which `scan` has passed.
    #[inline(always)]
    pub(crate) fn path(&mut self, scan: &mut Scan<'a>, syntax: PathSyntax) -> Result<usize> {
        let input = self.source.bytes;
        let end = loop {
            let Some(at) = scan.next() else {
                break input.len();
            };
            let byte = input[at];
            if class::is_in(syntax.set, byte) {
                scan.skip_to(self.escape_run(at, syntax.set)?);
                continue;
            }
            match byte {
                b'?' | b'#' => break at,
                b'\t' | b'\n' | b'\r' => return Err(Error::Invalid),
                b'\\' if syntax.backslash_is_slash => {
                    self.out.replace(at, at + 1, b"/")?;
                    scan.skip_to(self.segment_start(at + 1, syntax)?);
                }
                b'.' | b'%' if input[at - 1] == b'/' => {
                    scan.skip_to(self.segment_start(at, syntax)?);
                }
                _ => {}
            }
        };
        if !self.parts.has_host() {
            self.tell_path_from_authority(end)?;
        }
        Ok(end)
    }

    /// Resolves the dot segments at `at`, and returns where the segment behind them starts.
    #[inline(always)]
    pub(crate) fn segment_start(&mut self, at: usize, syntax: PathSyntax) -> Result<usize> {
        match self.source.bytes[at..] {
            [b'.' | b'%', ..] | [_, b'|', ..] => self.peculiar_segment_start(at, syntax),
            _ => Ok(at),
        }
    }

    fn peculiar_segment_start(&mut self, mut at: usize, syntax: PathSyntax) -> Result<usize> {
        let input = self.source.bytes;
        while let Some((length, has_two_dots)) = syntax.dot_segment(&input[at..]) {
            self.out.interrupt(at)?;
            if has_two_dots {
                self.shorten_path(at);
            }
            at += length;
            at += usize::from(input.get(at).is_some_and(|&byte| syntax.is_slash(byte)));
            self.out.resume(at);
        }
        if let [letter, b'|', rest @ ..] = &input[at..]
            && self.parts.scheme == Scheme::File
            && letter.is_ascii_alphabetic()
            && !class::is_in(syntax.set, b'|')
            && syntax.ends_segment(rest.first())
            && self.mark(at) == self.parts.path_start + 1
        {
            self.out.replace(at + 1, at + 2, b":")?;
        }
        Ok(at)
    }

    /// The output is interrupted at `at`.
    fn shorten_path(&mut self, at: usize) {
        let start = self.parts.path_start as usize;
        let is_drive = self.parts.scheme == Scheme::File
            && self.out.position(at) - start == "/c:/".len()
            && is_normalized_drive_letter(&[self.out.byte(start + 1), self.out.byte(start + 2)]);
        if !is_drive {
            self.out.drop_last_segment(start);
        }
    }

    /// A path that starts with two slashes has `/.` before it if there is no host.
    fn tell_path_from_authority(&mut self, end: usize) -> Result<()> {
        let start = self.parts.path_start as usize;
        let is_ambiguous = self.out.position(end) - start >= 2 && self.out.byte(start + 1) == b'/';
        let is_guarded = self.parts.path_start != self.parts.host_end;
        if is_ambiguous && !is_guarded {
            self.out.flatten(end)?.insert(start, b"/.")?;
            self.parts.path_start += 2;
        } else if is_guarded && !is_ambiguous {
            self.out.flatten(end)?.remove(start - 2, 2);
            self.parts.path_start -= 2;
        }
        Ok(())
    }

    /// Returns where the path ends.
    fn opaque_path(&mut self, start: usize) -> Result<usize> {
        let input = self.source.bytes;
        let mut scan = OPAQUE_PATH_SCAN.scan(input, start);
        while let Some(at) = scan.next() {
            match input[at] {
                b'?' | b'#' => return Ok(at),
                b'\t' | b'\n' | b'\r' => return Err(Error::Invalid),
                b' ' if matches!(input.get(at + 1), Some(b'?' | b'#')) => {
                    self.escape(at, at + 1)?
                }
                b' ' => {}
                _ => scan.skip_to(self.escape_run(at, C0_CONTROL)?),
            }
        }
        Ok(input.len())
    }
}
