use core::marker::PhantomData;
use core::ops::Deref;
use core::ptr::NonNull;

use crate::static_names::ATOMS;
use crate::symbol::{self, StaticSymbol, SymbolRef};
use crate::{
    AllocError, CodeUnit, StaticString, StringImpl, StringRef, Text, atom_table, with_text,
};

pub const MAX_ARRAY_INDEX: u32 = u32::MAX - 1;

/// The value of a canonical decimal integer up to 2^32 - 2.
#[inline]
pub fn parse_array_index(text: Text<'_>) -> Option<u32> {
    fn parse<T: CodeUnit>(units: &[T]) -> Option<u32> {
        let (&first, rest) = units.split_first()?;
        if !first.is_ascii_digit() || (first.is(b'0') && !rest.is_empty()) || rest.len() > 9 {
            return None;
        }
        let mut value = 0u64;
        for &unit in units {
            value = value * 10 + u64::from(unit.digit_value(10)?);
        }
        u32::try_from(value)
            .ok()
            .filter(|&index| index <= MAX_ARRAY_INDEX)
    }
    with_text!(text, |units| parse(units))
}

/// The one string of this thread with its characters. It is Latin-1 if they allow it.
#[derive(Clone)]
#[repr(transparent)]
pub struct Atom(StringRef);

impl Atom {
    #[inline(always)]
    pub fn try_new(text: Text<'_>) -> Result<Atom, AllocError> {
        #[inline(never)]
        fn new<T: CodeUnit>(units: &[T]) -> Result<Atom, AllocError> {
            Atom::add(T::text(units), T::text(units).hash())
        }
        with_text!(text, |units| new(units))
    }

    /// For text whose size no script picks.
    #[inline(always)]
    pub fn new(text: Text<'_>) -> Atom {
        Self::try_new(text).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    /// `hash` is `text.hash()`.
    #[inline(always)]
    pub fn try_with_hash(text: Text<'_>, hash: u32) -> Result<Atom, AllocError> {
        #[inline(never)]
        fn with_hash<T: CodeUnit>(units: &[T], hash: u32) -> Result<Atom, AllocError> {
            Atom::add(T::text(units), hash)
        }
        with_text!(text, |units| with_hash(units, hash))
    }

    #[inline(always)]
    fn add(text: Text<'_>, hash: u32) -> Result<Atom, AllocError> {
        atom_table::add(text, hash, || StringRef::try_narrowed(text)).map(Atom)
    }

    /// Does not copy the characters.
    pub fn from_literal(ascii: &'static str) -> Atom {
        debug_assert!(ascii.is_ascii());
        Self::from_static_latin1(ascii.as_bytes())
    }

    /// Does not copy the characters.
    pub fn from_static_latin1(characters: &'static [u8]) -> Atom {
        let text = Text::Latin1(characters);
        let create = || Ok(StringRef::from_static_units(characters));
        let atom = atom_table::add(text, text.hash(), create);
        Atom(atom.unwrap_or_else(|_| bun_alloc::out_of_memory()))
    }

    /// `string` itself becomes the atom if there is none yet and it may. Of a symbol, the description.
    #[inline]
    pub fn try_from_string(string: &StringImpl) -> Result<Atom, AllocError> {
        if string.is_atom() {
            return Ok(Atom(StringRef::retain(string)));
        }
        Self::from_string_slow(string)
    }

    /// For a string whose size no script picks.
    #[inline]
    pub fn from_string(string: &StringImpl) -> Atom {
        Self::try_from_string(string).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    fn from_string_slow(string: &StringImpl) -> Result<Atom, AllocError> {
        let text = string.text();
        let atom = atom_table::add(text, string.hash(), || {
            // An atom outlives whoever asked for it, and an embedder may lend characters for no longer than that.
            if string.borrows_characters()
                || string.is_static()
                || string.is_symbol()
                || !string.can_become_atom()
                || (!text.is_latin1() && text.fits_latin1())
            {
                StringRef::try_narrowed(text)
            } else {
                Ok(StringRef::retain(string))
            }
        });
        atom.map(Atom)
    }

    pub fn find(text: Text<'_>) -> Option<Atom> {
        atom_table::find(text, text.hash()).map(Atom)
    }

    pub fn find_string(string: &StringImpl) -> Option<Atom> {
        if string.is_atom() {
            return Some(Atom(StringRef::retain(string)));
        }
        atom_table::find(string.text(), string.hash()).map(Atom)
    }

    pub const fn empty() -> Atom {
        Atom(StringRef::empty())
    }

    #[inline(always)]
    pub fn name(&self) -> PropertyName<'_> {
        PropertyName(self.0.as_ptr(), PhantomData)
    }

    #[inline(always)]
    pub fn string(&self) -> &StringRef {
        &self.0
    }

    #[inline(always)]
    pub fn into_string(self) -> StringRef {
        self.0
    }
}

impl Deref for Atom {
    type Target = StringImpl;

    #[inline(always)]
    fn deref(&self) -> &StringImpl {
        &self.0
    }
}

/// An atom or a symbol: what names a property or a binding. Equal if and only if identical.
#[derive(Clone)]
#[repr(transparent)]
pub struct Identifier(StringRef);

impl Identifier {
    #[inline]
    pub fn new(text: Text<'_>) -> Identifier {
        Atom::new(text).into()
    }

    pub fn from_literal(ascii: &'static str) -> Identifier {
        Atom::from_literal(ascii).into()
    }

    pub fn from_index(index: u32) -> Identifier {
        Self::try_from_index(index).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    pub fn try_from_index(index: u32) -> Result<Identifier, AllocError> {
        let mut digits = [0; 10];
        let mut start = digits.len();
        let mut rest = index;
        loop {
            start -= 1;
            digits[start] = b'0' + (rest % 10) as u8;
            rest /= 10;
            if rest == 0 {
                return Atom::try_new(Text::Latin1(&digits[start..])).map(Into::into);
            }
        }
    }

    #[inline(always)]
    pub fn name(&self) -> PropertyName<'_> {
        PropertyName(self.0.as_ptr(), PhantomData)
    }

    #[inline(always)]
    pub fn string(&self) -> &StringRef {
        &self.0
    }

    #[inline(always)]
    pub fn into_string(self) -> StringRef {
        self.0
    }
}

impl From<Atom> for Identifier {
    #[inline(always)]
    fn from(atom: Atom) -> Identifier {
        Identifier(atom.0)
    }
}

impl From<SymbolRef> for Identifier {
    #[inline(always)]
    fn from(symbol: SymbolRef) -> Identifier {
        Identifier(symbol.into_string())
    }
}

/// A borrowed [`Identifier`].
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct PropertyName<'a>(NonNull<StringImpl>, PhantomData<&'a StringImpl>);

impl<'a> PropertyName<'a> {
    pub const EMPTY: PropertyName<'static> =
        PropertyName::from_static_atom(&crate::string_impl::EMPTY);

    pub(crate) const fn from_static_atom(atom: &'static StaticString) -> PropertyName<'static> {
        PropertyName(atom.as_ptr(), PhantomData)
    }

    pub(crate) const fn from_static_symbol(symbol: &'static StaticSymbol) -> PropertyName<'static> {
        PropertyName(symbol.as_ptr(), PhantomData)
    }

    /// What `hash` returns, at compile time.
    ///
    /// # Safety
    /// The pointer of one of `names`, `symbols` or `private_names`.
    pub const unsafe fn hash_of_static(name: *const core::ffi::c_void) -> u32 {
        // SAFETY: the field of a `StaticString`. The identity hash of a static symbol is that of its description.
        unsafe {
            name.byte_add(StringImpl::OFFSET_OF_FLAGS)
                .cast::<u32>()
                .read()
                >> StringImpl::FLAG_COUNT
        }
    }

    /// `None` unless the string is an atom or a symbol.
    #[inline(always)]
    pub fn from_string(string: &'a StringImpl) -> Option<PropertyName<'a>> {
        (string.is_atom() || string.is_symbol())
            .then(|| PropertyName(NonNull::from_ref(string), PhantomData))
    }

    /// # Safety
    /// An atom of this thread or a symbol, alive for `'a`.
    #[inline(always)]
    pub const unsafe fn from_raw(string: NonNull<StringImpl>) -> PropertyName<'a> {
        PropertyName(string, PhantomData)
    }

    #[inline(always)]
    pub const fn as_ptr(self) -> NonNull<StringImpl> {
        self.0
    }

    #[inline(always)]
    pub fn address(self) -> usize {
        self.0.addr().get()
    }

    #[inline(always)]
    pub fn string(self) -> &'a StringImpl {
        // SAFETY: borrowed for `'a`.
        unsafe { self.0.as_ref() }
    }

    /// The characters of an atom, the description of a symbol.
    #[inline(always)]
    pub fn text(self) -> Text<'a> {
        self.string().text()
    }

    #[inline(always)]
    pub fn is_symbol(self) -> bool {
        self.string().is_symbol()
    }

    #[inline]
    pub fn is_private(self) -> bool {
        symbol::flags(self.string()).is_some_and(|flags| flags.is_private())
    }

    /// Private, and unlike a property in that it belongs to a proxy itself and is left alone by `Object.freeze`.
    #[inline]
    pub fn is_private_element(self) -> bool {
        symbol::flags(self.string())
            .is_some_and(|flags| flags.is_private() && !flags.passes_through_proxies())
    }

    #[inline]
    pub fn symbol_flags(self) -> Option<symbol::SymbolFlags> {
        symbol::flags(self.string())
    }

    #[inline(always)]
    pub fn hash(self) -> u32 {
        symbol::identity_hash(self.string())
    }

    #[inline(always)]
    pub fn as_index(self) -> Option<u32> {
        if self.string().is_array_index_atom() {
            parse_array_index(self.text())
        } else {
            None
        }
    }

    /// Below `STATIC_ATOM_COUNT` for the atoms of `names` and those of one Latin-1 character.
    #[inline]
    pub fn static_atom_index(self) -> Option<usize> {
        let offset = self.address().wrapping_sub(ATOMS.as_ptr().addr());
        (offset < size_of_val(&ATOMS)).then_some(offset / size_of::<StaticString>())
    }

    #[inline(always)]
    pub fn to_identifier(self) -> Identifier {
        Identifier(StringRef::retain(self.string()))
    }

    #[inline]
    pub fn to_atom(self) -> Option<Atom> {
        (!self.is_symbol()).then(|| Atom(StringRef::retain(self.string())))
    }

    #[inline]
    pub fn to_symbol(self) -> Option<SymbolRef> {
        SymbolRef::from_string(self.string())
    }
}

impl<'a> From<&'a Identifier> for PropertyName<'a> {
    #[inline(always)]
    fn from(identifier: &'a Identifier) -> PropertyName<'a> {
        identifier.name()
    }
}

impl<'a> From<&'a Atom> for PropertyName<'a> {
    #[inline(always)]
    fn from(atom: &'a Atom) -> PropertyName<'a> {
        atom.name()
    }
}

macro_rules! impl_identity {
    ($($type:ty, |$this:ident| $name:expr;)*) => {$(
        impl PartialEq for $type {
            #[inline(always)]
            fn eq(&self, other: &Self) -> bool {
                let address = |$this: &Self| $name.address();
                address(self) == address(other)
            }
        }

        impl Eq for $type {}

        impl core::hash::Hash for $type {
            #[inline(always)]
            fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
                let $this = self;
                state.write_u32($name.hash());
            }
        }

        impl core::fmt::Display for $type {
            fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                let $this = self;
                $name.text().fmt(formatter)
            }
        }

        impl core::fmt::Debug for $type {
            fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                let $this = self;
                $name.text().fmt(formatter)
            }
        }
    )*};
}

impl_identity! {
    Atom, |this| this.name();
    Identifier, |this| this.name();
    SymbolRef, |this| this.name();
    PropertyName<'_>, |this| (*this);
}

impl PartialEq<PropertyName<'_>> for Identifier {
    #[inline(always)]
    fn eq(&self, other: &PropertyName<'_>) -> bool {
        self.name() == *other
    }
}

impl PartialEq<PropertyName<'_>> for Atom {
    #[inline(always)]
    fn eq(&self, other: &PropertyName<'_>) -> bool {
        self.name() == *other
    }
}

impl hashbrown::Equivalent<Identifier> for PropertyName<'_> {
    #[inline(always)]
    fn equivalent(&self, key: &Identifier) -> bool {
        *key == *self
    }
}
