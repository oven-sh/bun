//! Names.

use super::File;
use crate::span::{Span, Spanned};
use bun_sema::atom::{Atom, KNOWN_TEXTS};

/// The text of an identifier, a property name or a string. Interned: two names of a file compare
/// as numbers.
#[derive(Copy, Clone)]
pub struct Name<'a> {
    file: &'a File<'a>,
    atom: Atom,
}

impl<'a> Name<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, atom: Atom) -> Self {
        Name { file, atom }
    }

    /// Escapes are resolved: `\u0061` is `a`.
    #[inline]
    pub fn bytes(self) -> &'a [u8] {
        match self.file.texts.in_source(self.atom) {
            Some(text) => text,
            None => self.bytes_elsewhere(),
        }
    }

    /// It is not written in the source as it is, or the atoms are not the file's own.
    #[inline(never)]
    fn bytes_elsewhere(self) -> &'a [u8] {
        match KNOWN_TEXTS.get(self.atom.0 as usize) {
            Some(known) => known,
            None if self.atom.is_some() => self.file.atoms.bytes(self.atom),
            None => b"",
        }
    }

    /// Of [`Name::bytes`].
    #[inline]
    pub fn len(self) -> usize {
        match self.file.texts.span_of(self.atom) {
            Some((_, len)) => len as usize,
            None => self.bytes_elsewhere().len(),
        }
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn atom(self) -> Atom {
        self.atom
    }

    #[inline]
    pub fn is(self, text: &str) -> bool {
        self.has(text.as_bytes())
    }

    /// Whether it is one of `texts`.
    #[inline]
    pub fn is_any(self, texts: &[&str]) -> bool {
        let len = self.len();
        (texts.iter()).any(|text| text.len() == len && self.has_all(text.as_bytes()))
    }

    #[inline]
    fn has(self, text: &[u8]) -> bool {
        self.len() == text.len() && self.has_all(text)
    }

    /// Whether its bytes are `text`, which is as long.
    #[inline(never)]
    fn has_all(self, text: &[u8]) -> bool {
        self.bytes() == text
    }
}

impl PartialEq for Name<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.atom == other.atom
    }
}
impl Eq for Name<'_> {}
impl std::hash::Hash for Name<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.atom.0.hash(state);
    }
}
impl PartialEq<str> for Name<'_> {
    #[inline]
    fn eq(&self, other: &str) -> bool {
        self.has(other.as_bytes())
    }
}
impl PartialEq<&str> for Name<'_> {
    #[inline]
    fn eq(&self, other: &&str) -> bool {
        self.has(other.as_bytes())
    }
}
impl PartialEq<[u8]> for Name<'_> {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        self.has(other)
    }
}
impl PartialEq<&[u8]> for Name<'_> {
    #[inline]
    fn eq(&self, other: &&[u8]) -> bool {
        self.has(other)
    }
}
impl std::fmt::Display for Name<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(bstr::BStr::new(self.bytes()), f)
    }
}
impl std::fmt::Debug for Name<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(bstr::BStr::new(self.bytes()), f)
    }
}

/// A name where it is written: the `b` of `a.b`, the `f` of `function f() {}`, a label.
///
/// An identifier that is an expression is an [`Expr`](super::Expr) and one that is bound is a
/// [`Pat`](super::Pat). This is for the names that are neither.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Ident<'a> {
    name: Name<'a>,
    start: u32,
}

impl<'a> Ident<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, atom: Atom, start: u32) -> Self {
        Ident {
            name: Name::new(file, atom),
            start,
        }
    }

    #[inline]
    pub fn name(self) -> Name<'a> {
        self.name
    }

    #[inline]
    pub fn bytes(self) -> &'a [u8] {
        self.name.bytes()
    }

    #[inline]
    pub fn start(self) -> u32 {
        self.start
    }

    /// It is written as a string: `import { "a b" as c }`, `declare module "m"`.
    #[inline]
    pub fn is_string(self) -> bool {
        matches!(
            self.name.file.text().get(self.start as usize),
            Some(b'"' | b'\'')
        )
    }

    pub fn span(self) -> Span {
        let (text, name) = (self.name.file.text(), self.name.bytes());
        let written = text.get(self.start as usize..).unwrap_or_default();
        let len = match !name.is_empty() && !self.is_string() && written.starts_with(name) {
            true => name.len(),
            // It is written with escapes, or in quotes, where it can start with the name and go on: `"\""`.
            false => crate::tokens::token_len(written),
        };
        Span::new(self.start, self.start + len as u32)
    }
}

impl Spanned for Ident<'_> {
    #[inline]
    fn span(&self) -> Span {
        Ident::span(*self)
    }
}
