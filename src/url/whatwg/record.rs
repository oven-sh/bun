use core::ops::Range;
use std::borrow::Cow;

use bun_engine_text::{AllocError, CodeUnit, MAX_LENGTH, StringRef, StringWriter};

use crate::Scheme;
use crate::components::{Components, State};

mod sealed {
    pub trait Sealed {}
}

/// What holds the characters of a [`Record`].
pub trait Storage: sealed::Sealed {
    fn bytes(&self) -> &[u8];
}

pub(crate) trait OwnedStorage: Storage + Sized {
    fn concat<const N: usize>(pieces: [&[u8]; N]) -> Result<Self, AllocError>;
}

impl sealed::Sealed for Option<StringRef> {}
impl sealed::Sealed for Cow<'_, [u8]> {}
impl sealed::Sealed for &[u8] {}

impl Storage for Option<StringRef> {
    #[inline]
    fn bytes(&self) -> &[u8] {
        self.as_ref()
            .and_then(|string| u8::units(string.text()))
            .unwrap_or_default()
    }
}

impl Storage for Cow<'_, [u8]> {
    #[inline]
    fn bytes(&self) -> &[u8] {
        self
    }
}

impl Storage for &[u8] {
    #[inline]
    fn bytes(&self) -> &[u8] {
        self
    }
}

#[inline(always)]
pub(crate) fn concat<const N: usize>(pieces: [&[u8]; N]) -> Result<StringRef, AllocError> {
    let mut writer = StringWriter::try_new(pieces.iter().map(|piece| piece.len()).sum())?;
    for piece in pieces {
        if !piece.is_empty() {
            writer.push_slice(piece);
        }
    }
    Ok(writer.finish())
}

impl OwnedStorage for Option<StringRef> {
    #[inline(always)]
    fn concat<const N: usize>(pieces: [&[u8]; N]) -> Result<Self, AllocError> {
        concat(pieces).map(Some)
    }
}

impl OwnedStorage for Cow<'_, [u8]> {
    fn concat<const N: usize>(pieces: [&[u8]; N]) -> Result<Self, AllocError> {
        let length = pieces.iter().map(|piece| piece.len()).sum();
        let mut bytes = Vec::new();
        if length > MAX_LENGTH || bytes.try_reserve_exact(length).is_err() {
            return Err(AllocError);
        }
        for piece in pieces {
            bytes.extend_from_slice(piece);
        }
        Ok(Cow::Owned(bytes))
    }
}

/// The serialization of a URL record, and where its parts are. Every part of an invalid URL is empty or `None`.
#[derive(Clone)]
#[repr(C)]
pub struct Record<S> {
    pub(crate) text: S,
    pub(crate) parts: Components,
}

pub(crate) type View<'a> = Record<&'a [u8]>;

impl<S: Storage> Record<S> {
    #[inline]
    pub fn is_valid(&self) -> bool {
        self.parts.state != State::Invalid
    }

    /// ASCII, as all parts are.
    #[inline]
    pub fn href(&self) -> &[u8] {
        if self.is_valid() {
            self.text.bytes()
        } else {
            &[]
        }
    }

    #[inline]
    pub(crate) fn view(&self) -> Option<View<'_>> {
        self.is_valid().then(|| Record {
            text: self.text.bytes(),
            parts: self.parts,
        })
    }

    #[inline]
    pub(crate) fn slice(&self, range: Range<u32>) -> &[u8] {
        &self.href()[range.start as usize..range.end as usize]
    }

    #[inline]
    pub(crate) fn slice_from(&self, start: u32) -> &[u8] {
        &self.href()[start as usize..]
    }

    #[inline]
    pub fn scheme(&self) -> Scheme {
        self.parts.scheme
    }

    /// Without the colon.
    #[inline]
    pub fn scheme_name(&self) -> &[u8] {
        self.slice(0..self.parts.scheme_end)
    }

    /// With the colon.
    #[inline]
    pub fn protocol(&self) -> &[u8] {
        self.slice(0..self.parts.scheme_end + u32::from(self.is_valid()))
    }

    #[inline]
    pub fn has_credentials(&self) -> bool {
        self.parts.has_credentials()
    }

    /// Percent-encoded.
    #[inline]
    pub fn username(&self) -> &[u8] {
        let end = self.parts.username_end;
        self.slice(end.min(self.parts.scheme_end + 3)..end)
    }

    /// Percent-encoded.
    #[inline]
    pub fn password(&self) -> &[u8] {
        match self.slice(self.parts.username_end..self.parts.host_start) {
            [b':', password @ .., b'@'] => password,
            _ => &[],
        }
    }

    /// Without the port.
    #[inline]
    pub fn hostname(&self) -> &[u8] {
        self.slice(self.parts.host_start..self.parts.host_end)
    }

    /// With the port.
    #[inline]
    pub fn host(&self) -> &[u8] {
        self.slice(self.parts.host_start..self.parts.authority_end())
    }

    /// `None` stands for the default port too.
    #[inline]
    pub fn port(&self) -> Option<u16> {
        self.parts.port()
    }

    /// The digits of [`Self::port`].
    #[inline]
    pub fn port_text(&self) -> &[u8] {
        let port = self.slice(self.parts.host_end..self.parts.authority_end());
        port.get(1..).unwrap_or_default()
    }

    #[inline]
    pub fn has_opaque_path(&self) -> bool {
        self.parts.state == State::OpaquePath
    }

    /// The index in [`Self::href`].
    #[inline]
    pub fn path_start(&self) -> usize {
        self.parts.path_start as usize
    }

    #[inline]
    pub fn path(&self) -> &[u8] {
        self.slice(self.parts.path_start..self.parts.path_end)
    }

    #[inline]
    pub fn query(&self) -> Option<&[u8]> {
        self.query_with_question_mark().get(1..)
    }

    /// Empty if there is no query.
    #[inline]
    pub fn query_with_question_mark(&self) -> &[u8] {
        self.slice(self.parts.path_end..self.parts.query_end)
    }

    /// The `search` getter: a lone `?` does not show.
    #[inline]
    pub fn search(&self) -> &[u8] {
        unless_only_delimiter(self.query_with_question_mark())
    }

    #[inline]
    pub fn fragment(&self) -> Option<&[u8]> {
        self.slice_from(self.parts.query_end).get(1..)
    }

    /// The `hash` getter: a lone `#` does not show.
    #[inline]
    pub fn hash(&self) -> &[u8] {
        unless_only_delimiter(self.slice_from(self.parts.query_end))
    }

    /// In two pieces: what is before `end`, around the credentials.
    #[inline]
    pub(crate) fn without_credentials(&self, end: u32) -> [&[u8]; 2] {
        let host_start = self.parts.host_start;
        [
            self.slice(0..host_start.min(self.parts.scheme_end + 3)),
            self.slice(host_start..end),
        ]
    }
}

#[inline]
fn unless_only_delimiter(part: &[u8]) -> &[u8] {
    if part.len() > 1 { part } else { &[] }
}
