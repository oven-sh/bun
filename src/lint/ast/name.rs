//! Names.

use super::File;
use crate::span::{Span, Spanned};
use bun_sema::atom::{Atom, KNOWN_TEXTS};

/// The text of an identifier, a property name or a string. It's interned, so comparing two names from the same file is
/// an integer comparison.
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
            None => self.bytes_slow(),
        }
    }

    /// The slow path: the name doesn't appear verbatim in the source, or the atoms aren't the file's own.
    #[inline(never)]
    fn bytes_slow(self) -> &'a [u8] {
        match KNOWN_TEXTS.get(self.atom.0 as usize) {
            Some(known) => known,
            None if self.atom.is_some() => self.file.atoms.bytes(self.atom),
            None => b"",
        }
    }

    /// The length of [`Name::bytes`].
    #[inline]
    pub fn len(self) -> usize {
        match self.file.texts.span_of(self.atom) {
            Some((_, len)) => len as usize,
            None => self.bytes_slow().len(),
        }
    }

    #[inline]
    pub fn atom(self) -> Atom {
        self.atom
    }

    #[inline]
    pub fn is(self, text: &str) -> bool {
        self.has(text.as_bytes())
    }

    /// True if it's one of `texts`.
    #[inline]
    pub fn is_any(self, texts: &[&str]) -> bool {
        match self.file.texts.span_of(self.atom) {
            Some(_) => texts.iter().any(|text| self.has(text.as_bytes())),
            None => self.is_any_slow(texts),
        }
    }

    #[inline(never)]
    fn is_any_slow(self, texts: &[&str]) -> bool {
        let bytes = self.bytes_slow();
        texts.iter().any(|text| bytes == text.as_bytes())
    }

    #[inline]
    fn has(self, text: &[u8]) -> bool {
        let texts = &self.file.texts;
        let may_have = match texts.span_of(self.atom) {
            Some((_, len)) if len as usize != text.len() => false,
            Some((start, _)) => match (texts.source().get(start as usize), text.first()) {
                (Some(first), Some(wanted)) => first == wanted,
                _ => true,
            },
            None => true,
        };
        may_have && self.has_all(text)
    }

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

/// A name at a position in the source: the `b` of `a.b`, the `f` of `function f() {}`, a label.
///
/// An identifier expression is an [`Expr`](super::Expr) and a binding identifier is a [`Pat`](super::Pat). This is for
/// names that are neither.
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

    /// True if it's written as a string: `import { "a b" as c }`, `declare module "m"`.
    #[inline]
    pub fn is_string(self) -> bool {
        matches!(
            self.name.file.text().get(self.start as usize),
            Some(b'"' | b'\'')
        )
    }

    pub fn span(self) -> Span {
        let len = match self.len_if_plain() {
            Some(len) => len,
            None => self.source_len() as u32,
        };
        Span::new(self.start, self.start + len)
    }

    /// The name's length, if a cheap check shows the source here matches the name byte for byte: it's at most 16 bytes
    /// long, or this is its first occurrence in the file.
    #[inline]
    fn len_if_plain(self) -> Option<u32> {
        let texts = &self.name.file.texts;
        let chunk = |at: u32| -> Option<&[u8; 16]> {
            let chunk = texts.source().get(at as usize..at as usize + 16)?;
            chunk.try_into().ok()
        };
        let (first, len) = texts.span_of(self.name.atom)?;
        let here = chunk(self.start)?;
        if first != self.start {
            let differ = u128::from_le_bytes(*here) ^ u128::from_le_bytes(*chunk(first)?);
            if differ.trailing_zeros() / 8 < len {
                return None;
            }
        }
        (len != 0 && !matches!(here[0], b'"' | b'\'')).then_some(len)
    }

    #[inline(never)]
    fn source_len(self) -> usize {
        let (text, name) = (self.name.file.text(), self.name.bytes());
        let source_text = text.get(self.start as usize..).unwrap_or_default();
        match !name.is_empty() && !self.is_string() && source_text.starts_with(name) {
            true => name.len(),
            // It's written with escapes or in quotes. A quoted name can start with its own value and continue, like
            // `"\""`.
            false => crate::tokens::token_len(source_text),
        }
    }
}

impl Spanned for Ident<'_> {
    #[inline]
    fn span(&self) -> Span {
        Ident::span(*self)
    }
}
