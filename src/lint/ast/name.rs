//! Names.

use super::File;
use crate::span::{Span, Spanned};
use bun_sema::atom::Atom;

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

    /// Escapes are resolved: `a` is `a`.
    #[inline]
    pub fn bytes(self) -> &'a [u8] {
        match self.atom.is_some() {
            true => self.file.atoms.bytes(self.atom),
            false => b"",
        }
    }

    #[inline]
    pub fn atom(self) -> Atom {
        self.atom
    }

    #[inline]
    pub fn is(self, text: &str) -> bool {
        self.bytes() == text.as_bytes()
    }

    /// Whether it is one of `texts`.
    #[inline]
    pub fn is_any(self, texts: &[&str]) -> bool {
        let bytes = self.bytes();
        texts.iter().any(|text| bytes == text.as_bytes())
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
        self.bytes() == other.as_bytes()
    }
}
impl PartialEq<&str> for Name<'_> {
    #[inline]
    fn eq(&self, other: &&str) -> bool {
        self.bytes() == other.as_bytes()
    }
}
impl PartialEq<[u8]> for Name<'_> {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        self.bytes() == other
    }
}
impl PartialEq<&[u8]> for Name<'_> {
    #[inline]
    fn eq(&self, other: &&[u8]) -> bool {
        self.bytes() == *other
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
        let len = match !name.is_empty() && written.starts_with(name) {
            true => name.len(),
            // It is written with escapes, or in quotes.
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
