use bun_engine_text::{
    Atom, Identifier, PropertyName, StringRef, Text, find_private_name, find_well_known_symbol,
};

use super::{Decoder, Writer};
use crate::bytes::Reader;
use crate::cache::format::name;
use crate::function::Origin;

/// For a payload that has its strings with it.
const STRING_LENGTH_LIMIT: usize = 1 << 27;

impl Writer<'_> {
    pub(super) fn is_too_long(&mut self, length: usize) -> bool {
        let is_too_long = length >= STRING_LENGTH_LIMIT && self.has_own_strings;
        self.is_unencodable |= is_too_long;
        is_too_long
    }

    pub(super) fn reference(&mut self, text: Text<'_>, hash: u32) -> u32 {
        if text.is_empty() || self.is_too_long(text.len()) {
            return name::EMPTY;
        }
        name::FIRST_ORDINAL + self.strings.ordinal(text, hash)
    }

    pub(super) fn text(&mut self, text: Text<'_>) {
        let reference = self.reference(text, text.hash());
        self.bytes().number(reference);
    }

    pub(super) fn atom(&mut self, atom: &Atom) {
        let reference = self.reference(atom.text(), atom.name().hash());
        self.bytes().number(reference);
    }

    pub(super) fn identifier(&mut self, identifier: &Identifier) {
        let name = identifier.name();
        if name.is_symbol() {
            return self.symbol(name);
        }
        let reference = self.reference(name.text(), name.hash());
        self.bytes().number(reference);
    }

    #[cold]
    pub(super) fn symbol(&mut self, symbol: PropertyName<'_>) {
        let (prefix, text) = (Text::from_ascii("Symbol."), symbol.text());
        if symbol.is_private() {
            self.bytes().number(name::PRIVATE);
            return self.text(text);
        }
        let key = (text.starts_with(prefix)).then(|| text.slice_from(prefix.len()));
        let key = key.filter(|&key| find_well_known_symbol(key) == Some(symbol));
        self.is_unencodable |= key.is_none();
        self.bytes().number(name::WELL_KNOWN);
        self.text(key.unwrap_or(Text::EMPTY));
    }

    pub(super) fn identifiers(&mut self, identifiers: &[Identifier]) {
        self.list(identifiers, Self::identifier);
    }
}

impl Decoder<'_> {
    #[inline]
    pub(super) fn atom_for(&self, reference: u32) -> Option<Atom> {
        match reference.checked_sub(name::FIRST_ORDINAL) {
            Some(ordinal) => (self.strings)
                .atom(ordinal, |text| self.unit.note_string(text))
                .cloned(),
            None => (reference == name::EMPTY).then(Atom::empty),
        }
    }

    #[inline]
    pub(super) fn atom(&self, reader: &mut Reader<'_>) -> Option<Atom> {
        self.atom_for(reader.number()?)
    }

    pub(super) fn string(&self, reader: &mut Reader<'_>) -> Option<StringRef> {
        let reference = reader.number()?;
        if reference == name::EMPTY {
            return Some(StringRef::empty());
        }
        let string = (self.strings).string(reference.checked_sub(name::FIRST_ORDINAL)?)?;
        self.unit.note_string(string.text());
        Some(string)
    }

    #[inline]
    pub(super) fn identifier(&self, reader: &mut Reader<'_>) -> Option<Identifier> {
        match reader.number()? {
            kind @ (name::PRIVATE | name::WELL_KNOWN) => self.symbol(kind, &self.atom(reader)?),
            reference => self.atom_for(reference).map(Identifier::from),
        }
    }

    #[cold]
    fn symbol(&self, kind: u32, key: &Atom) -> Option<Identifier> {
        if kind == name::WELL_KNOWN {
            return find_well_known_symbol(key.text()).map(PropertyName::to_identifier);
        }
        self.unit.origin.contains(Origin::BUILTIN).then_some(())?;
        find_private_name(key.text(), key.name().hash())
            .map(PropertyName::to_identifier)
            .or_else(|| self.host.private_name(key.text()))
    }

    pub(super) fn identifiers(&self, reader: &mut Reader<'_>) -> Option<Box<[Identifier]>> {
        reader.list(|reader| self.identifier(reader))
    }

    pub(super) fn atoms(&self, reader: &mut Reader<'_>) -> Option<Box<[Atom]>> {
        reader.list(|reader| self.atom(reader))
    }
}
