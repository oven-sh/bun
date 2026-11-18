//! From bytes to a record.

use bun_engine_text::{AllocError, MAX_LENGTH};

use crate::buffer::Buffer;
use crate::canonical::{self, Outcome};
use crate::components::Components;
use crate::input::{Encoding, Source, Transcoder};
use crate::parser::{Parser, Step};
use crate::record::{OwnedStorage, Record, Storage, View};
use crate::{Error, Result, Url};

/// Whether a label of an ASCII domain that starts with `xn--` has to be valid for UTS #46. The URL Standard does not
/// ask for it. The `URL` class does.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Punycode {
    Unchecked,
    Checked,
}

/// `share` makes the result if it is a part of `source`.
#[inline(always)]
pub(crate) fn parse<'a, S: OwnedStorage>(
    source: Source<'a>,
    base: Option<&Record<impl Storage>>,
    punycode: Punycode,
    share: impl FnOnce(&'a [u8]) -> core::result::Result<S, AllocError>,
) -> Result<Record<S>> {
    if source.bytes.len() > MAX_LENGTH {
        return Err(Error::OutOfMemory);
    }
    match canonical::recognize(source.bytes, punycode) {
        Outcome::Canonical(parts) => {
            let text = share(source.bytes)?;
            Ok(Record { text, parts })
        }
        Outcome::LacksPath(parts) => {
            let text = with_slash(source.bytes)?;
            Ok(Record { text, parts })
        }
        Outcome::Unfinished(parts, mut step) => {
            let untrimmed_length = source.bytes.len();
            let source = source.trimmed();
            if source.bytes.len() != untrimmed_length {
                step = Step::Start;
            }
            if base.is_none() && !may_start_with_scheme(source) {
                return Err(Error::Invalid);
            }
            Parser::new(source, punycode, parts).run(step, base, || share(source.bytes))
        }
    }
}

/// For trimmed input. It turns the path of a file away at once.
#[inline(always)]
fn may_start_with_scheme(source: Source<'_>) -> bool {
    source.bytes.first().is_some_and(u8::is_ascii_alphabetic)
}

#[inline(never)]
fn with_slash<S: OwnedStorage>(href: &[u8]) -> core::result::Result<S, AllocError> {
    S::concat([href, b"/"])
}

#[cold]
fn parse_cleaned_up<S: OwnedStorage>(
    source: Source<'_>,
    base: Option<&View<'_>>,
    punycode: Punycode,
) -> Result<Record<S>> {
    let (mut transcoder, mut storage) = (Transcoder::new(), Buffer::new());
    let source = transcoder
        .well_formed(source)?
        .without_tab_or_newline(&mut storage)?;
    let mut parser = Parser::new(source, punycode, Components::INVALID);
    let step = parser.head(Step::Start, base)?;
    parser.tail(step)?;
    parser.finish()
}

impl<'a> Parser<'a> {
    #[inline(never)]
    fn run<S: OwnedStorage>(
        &mut self,
        step: Step,
        base: Option<&'a Record<impl Storage>>,
        share_input: impl FnOnce() -> core::result::Result<S, AllocError>,
    ) -> Result<Record<S>> {
        let base = base.and_then(Record::view);
        if self.source.is_well_formed() {
            match self
                .head(step, base.as_ref())
                .and_then(|step| self.tail(step))
            {
                Ok(()) if self.out.is_input() => {
                    let (text, parts) = (share_input()?, self.parts);
                    return Ok(Record { text, parts });
                }
                Ok(()) => return self.finish(),
                Err(Error::Invalid) if self.should_retry() => {}
                Err(error) => return Err(error),
            }
        }
        parse_cleaned_up(self.source, base.as_ref(), self.punycode)
    }

    /// After a failure.
    #[inline]
    fn should_retry(&self) -> bool {
        !self.failure_is_final && self.source.has_tab_or_newline()
    }

    #[inline(always)]
    fn finish<S: OwnedStorage>(&self) -> Result<Record<S>> {
        Ok(Record {
            text: S::concat(self.out.pieces(self.source.bytes.len()))?,
            parts: self.parts,
        })
    }
}

#[inline(always)]
pub(crate) fn can_parse(source: Source<'_>, base: Option<&Url>, punycode: Punycode) -> bool {
    canonical::has_canonical_authority(source.bytes, punycode)
        || can_parse_in_full(source.bytes, source.encoding, base, punycode)
}

#[inline(never)]
fn can_parse_in_full(
    bytes: &[u8],
    encoding: Encoding,
    base: Option<&Url>,
    punycode: Punycode,
) -> bool {
    let base = base.and_then(Record::view);
    let base = base.as_ref();
    let source = Source::new(bytes, encoding).trimmed();
    if base.is_none() && !may_start_with_scheme(source) {
        return false;
    }
    let mut parser = Parser::new(source, punycode, Components::INVALID);
    match parser.head(Step::Start, base) {
        Ok(Step::Segments(at) | Step::OpaquePath(at))
            if matches!(source.bytes.get(at as usize), Some(b'\t' | b'\n' | b'\r')) => {}
        Err(Error::Invalid) if parser.should_retry() => {}
        outcome => return outcome.is_ok(),
    }
    source
        .without_tab_or_newline(&mut Buffer::new())
        .is_ok_and(|source| {
            Parser::new(source, punycode, Components::INVALID)
                .head(Step::Start, base)
                .is_ok()
        })
}
