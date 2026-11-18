//! Names that are compared by identity.

use core::cell::Cell;
use core::mem::ManuallyDrop;
use core::num::NonZeroUsize;
use core::ptr::NonNull;
use std::borrow::Cow;
use std::sync::LazyLock;

use bun_alloc::WTFStringImplStruct as Impl;
use bun_jsc::JSString;
use bun_jsc::bindgen::{self, JsHeap, JsLocal};

use super::atoms::{ALL, Known, TEXTS};
use super::recent::Recent;
use super::string::{DomString, impl_of, impl_to_js, known_to_js};
use crate::name::Name;

macro_rules! atoms {
    ($($name:ident = $text:tt,)*) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        #[repr(u16)]
        pub(crate) enum Known { $($name,)* Other }

        pub(super) const TEXTS: &[&str] = &[$($text),*];
        pub(super) const ALL: &[Known] = &[$(Known::$name),*];

        macro_rules! atom {
            $(($text) => { $crate::api::core::Known::$name };)*
        }
        pub(crate) use atom;
    };
}
pub(super) use atoms;

unsafe extern "C" {
    /// These answer with a reference.
    safe fn Bun__DOM__atomize(string: &Impl) -> NonNull<Impl>;
    fn Bun__DOM__atomizeLatin1(characters: *const u8, length: u32) -> NonNull<Impl>;
    fn Bun__DOM__hashOfLatin1(characters: *const u8, length: u32) -> u32;
}

const SLOTS: usize = (TEXTS.len() * 2).next_power_of_two();

static NAMES: [Name; TEXTS.len()] = {
    let (mut names, mut index) = ([Name::NONE; TEXTS.len()], 0);
    while index < names.len() {
        names[index] = Name::known(TEXTS[index].as_bytes());
        index += 1;
    }
    names
};

static BY_NAME: [u16; SLOTS] = {
    let (mut slots, mut index) = ([Known::Other as u16; SLOTS], 0);
    while index < TEXTS.len() {
        let mut slot = slot_of(NAMES[index]);
        while slots[slot] != Known::Other as u16 {
            slot = (slot + 1) % SLOTS;
        }
        slots[slot] = ALL[index] as u16;
        index += 1;
    }
    slots
};

bitflags::bitflags! {
    /// Of a name for an attribute of an HTML element, in no namespace.
    #[derive(Clone, Copy)]
    pub(crate) struct Meaning: u8 {
        /// It has steps that all elements share.
        const STEPS = 1;
        /// `Reads::Ties`
        const TIE = 1 << 1;
        const HINT = 1 << 2;
        /// `is_read_in_html`
        const READ = 1 << 3;
        /// There is more to it than this says.
        const OTHER = 1 << 4;
    }
}

static MEANINGS: [u8; TEXTS.len() + 1] = {
    let (mut all, mut index) = ([Meaning::OTHER.bits(); TEXTS.len() + 1], 0);
    while index < TEXTS.len() {
        let (text, name) = (TEXTS[index].as_bytes(), NAMES[index]);
        let (mut is_plain, mut at) = (
            !matches!(
                text,
                [] | [b'd', b'a', b't', b'a', b'-', ..]
                    | [b'a', b'r', b'i', b'a', b'-', ..]
                    | b"role"
            ),
            0,
        );
        while at < text.len() {
            is_plain &= matches!(text[at], b'a'..=b'z' | b'-');
            at += 1;
        }
        let has_steps = matches!(
            text,
            b"name"
                | b"slot"
                | b"blocking"
                | b"popover"
                | b"interestfor"
                | b"nonce"
                | b"autofocus"
                | b"elementtiming"
                | [b'o', b'n', ..]
        );
        all[index] = if has_steps { Meaning::STEPS.bits() } else { 0 }
            | if matches!(text, b"id" | b"name" | b"for" | b"form" | b"type" | b"href") {
                Meaning::TIE.bits()
            } else {
                0
            }
            | if crate::hints::can_be_hint_in_html(name) {
                Meaning::HINT.bits()
            } else {
                0
            }
            | if crate::hints::is_read_in_html(name) {
                Meaning::READ.bits()
            } else {
                0
            }
            | if !is_plain || matches!(text, b"style" | b"form") {
                Meaning::OTHER.bits()
            } else {
                0
            };
        index += 1;
    }
    all
};

/// That atoms come with.
/// A slot has the upper bits of the hash above the `Known`.
static BY_HASH: LazyLock<Box<[u32; SLOTS * 2]>> = LazyLock::new(|| {
    let mut slots = Box::new([Known::Other as u32; SLOTS * 2]);
    for (text, known) in TEXTS.iter().zip(ALL) {
        // SAFETY: the pointer and the length are of one slice.
        let hash = unsafe { Bun__DOM__hashOfLatin1(text.as_ptr(), text.len() as u32) };
        let mut slot = hash as usize % slots.len();
        while slots[slot] != Known::Other as u32 {
            slot = (slot + 1) % slots.len();
        }
        slots[slot] = hash >> 8 << 16 | *known as u32;
    }
    slots
});

const fn slot_of(name: Name) -> usize {
    (name.bits() >> 32) as usize % SLOTS
}

/// The `AtomStringImpl` of each, once it was needed. Empty until the first is.
#[thread_local]
static IMPLS: Cell<&'static [Cell<Option<NonNull<Impl>>>]> = Cell::new(&[]);

fn forget_impls() {
    // SAFETY: the box that was released, which nothing else points to.
    let impls = unsafe { bun_core::heap::take(core::ptr::from_ref(IMPLS.take()).cast_mut()) };
    for string in impls.iter().filter_map(Cell::get) {
        // SAFETY: the reference that `as_impl` has kept.
        unsafe { string.as_ref() }.deref();
    }
}

pub(super) fn forget_cases() {
    LOWERCASED.forget();
    UPPERCASED.forget();
    NAMES_OF_UNKNOWN.forget();
}

/// Short strings that scripts have passed as names.
#[thread_local]
static LOWERCASED: Recent<Option<Lowercased>, 128> = Recent::new();

struct Lowercased {
    of: DomString,
    atom: Atom,
    /// If it is valid for an attribute that has a `key::value`.
    keyed: Name,
}

impl Lowercased {
    #[cold]
    fn new(string: &Impl) -> Lowercased {
        let atom = Atom::from_impl_lowercased(string);
        let keyed = if crate::selector::key::has_values(atom.as_utf8().as_bytes())
            && super::element::is_valid_attribute_name(&atom)
        {
            atom.name()
        } else {
            Name::NONE
        };
        Lowercased {
            of: DomString::from_impl(string),
            atom,
            keyed,
        }
    }
}

#[thread_local]
static UPPERCASED: Recent<Option<(Atom, Atom)>, 64> = Recent::new();

#[thread_local]
static NAMES_OF_UNKNOWN: Recent<Option<(Atom, Name)>, 64> = Recent::new();

impl Known {
    #[inline]
    fn find(name: Name, is_same: impl Fn(&[u8]) -> bool) -> Known {
        let mut slot = slot_of(name);
        loop {
            let index = BY_NAME[slot];
            if index == Known::Other as u16
                || NAMES[index as usize] == name && is_same(TEXTS[index as usize].as_bytes())
            {
                return Known::from_index(index);
            }
            slot = (slot + 1) % SLOTS;
        }
    }

    #[inline]
    pub(crate) fn from_latin1(text: &[u8]) -> Known {
        Known::find(Name::hash(text, false), |it| it == text)
    }

    /// Of one that has 8-bit characters.
    #[inline]
    fn from_atom(atom: &Impl) -> Known {
        const HASH_AND_FLAGS: usize = 4;
        // SAFETY: `StringImpl::m_hashAndFlags` follows the count, the length and the pointer.
        let (slots, hash_and_flags) = (&**BY_HASH, unsafe {
            core::ptr::from_ref(atom)
                .cast::<u32>()
                .add(HASH_AND_FLAGS)
                .read()
        });
        let mut slot = hash_and_flags as usize >> 8;
        loop {
            let found = slots[slot % slots.len()];
            let known = Known::from_index(found as u16);
            if known == Known::Other
                || found >> 16 == hash_and_flags >> 16
                    && (IMPLS
                        .get()
                        .get(known as usize)
                        .is_some_and(|it| it.get() == Some(atom.into()))
                        || known.has_text_of(atom))
            {
                return known;
            }
            slot += 1;
        }
    }

    /// From now on the address tells.
    #[cold]
    fn has_text_of(self, atom: &Impl) -> bool {
        self.as_str().as_bytes() == atom.latin1_slice() && {
            self.as_impl();
            true
        }
    }

    /// Of `text` in lowercase.
    #[inline]
    pub(crate) fn from_latin1_lowercased(text: &[u8]) -> Known {
        Known::find(Name::hash(text, true), |it| {
            it.len() == text.len()
                && it
                    .iter()
                    .zip(text)
                    .all(|(a, b)| *a == b.to_ascii_lowercase())
        })
    }

    #[inline(always)]
    pub(crate) fn from_index(index: u16) -> Known {
        // SAFETY: the discriminants are `0..=Other`.
        unsafe { core::mem::transmute(index.min(Known::Other as u16)) }
    }

    #[inline(always)]
    pub(crate) fn meaning(self) -> Meaning {
        Meaning::from_bits_retain(MEANINGS[self as usize])
    }

    /// Empty for `Other`.
    #[inline]
    pub(crate) fn as_str(self) -> &'static str {
        TEXTS.get(self as usize).copied().unwrap_or_default()
    }

    fn as_impl(self) -> &'static Impl {
        let string = IMPLS
            .get()
            .get(self as usize)
            .and_then(Cell::get)
            .unwrap_or_else(|| self.atomize());
        // SAFETY: the reference is kept until the thread ends.
        unsafe { string.as_ref() }
    }

    #[cold]
    fn atomize(self) -> NonNull<Impl> {
        if IMPLS.get().is_empty() {
            bun_ui::at_end_of_worker(forget_impls);
            IMPLS.set(bun_core::heap::release(
                TEXTS.iter().map(|_| Cell::new(None)).collect(),
            ));
        }
        let text = self.as_str();
        // SAFETY: the pointer and the length are of one slice.
        let string = unsafe {
            Bun__DOM__atomizeLatin1(text.as_ptr(), super::string::length_of(text.as_bytes()))
        };
        IMPLS.get()[self as usize].set(Some(string));
        string
    }
}

/// A `Known`, shifted and with the lowest bit set, or else an `AtomStringImpl`.
#[derive(PartialEq, Eq, Hash)]
#[repr(transparent)]
pub(crate) struct Atom(NonZeroUsize);

impl Clone for Atom {
    #[inline]
    fn clone(&self) -> Atom {
        if let Some(string) = self.unknown() {
            string.r#ref();
        }
        Atom(self.0)
    }
}

impl Drop for Atom {
    #[inline]
    fn drop(&mut self) {
        if let Some(string) = self.unknown() {
            string.deref();
        }
    }
}

impl From<Known> for Atom {
    #[inline(always)]
    fn from(known: Known) -> Atom {
        Atom::of(known)
    }
}

impl From<&Atom> for Atom {
    #[inline]
    fn from(atom: &Atom) -> Atom {
        atom.clone()
    }
}

impl PartialEq<Known> for Atom {
    #[inline(always)]
    fn eq(&self, known: &Known) -> bool {
        self.0.get() == (*known as usize) << 1 | 1
    }
}

/// What looks a name up without owning it.
pub(crate) trait AtomKey {
    fn bits(&self) -> usize;
}

impl AtomKey for Known {
    #[inline(always)]
    fn bits(&self) -> usize {
        (*self as usize) << 1 | 1
    }
}

impl AtomKey for &Atom {
    #[inline(always)]
    fn bits(&self) -> usize {
        self.0.get()
    }
}

impl Atom {
    pub(crate) const EMPTY: Atom = Atom::of(Known::Empty);

    #[inline(always)]
    pub(crate) const fn of(known: Known) -> Atom {
        debug_assert!(known as u16 != Known::Other as u16);
        Atom(NonZeroUsize::MIN.saturating_add((known as usize) << 1))
    }

    #[inline(always)]
    pub(crate) fn is(&self, key: &impl AtomKey) -> bool {
        self.0.get() == key.bits()
    }

    /// The same for the same names, while they are alive.
    #[inline(always)]
    pub(crate) fn identity(&self) -> usize {
        self.0.get()
    }

    #[inline(always)]
    fn unknown(&self) -> Option<&Impl> {
        // SAFETY: `self` holds a reference.
        (self.0.get() & 1 == 0).then(|| unsafe { &*(self.0.get() as *const Impl) })
    }

    pub(crate) fn new(text: &str) -> Atom {
        match text.is_ascii() {
            true => Atom::from_latin1(text.as_bytes()),
            false => Atom::from_string(&DomString::from_utf8(text)),
        }
    }

    #[inline]
    pub(crate) fn from_latin1(text: &[u8]) -> Atom {
        match Known::from_latin1(text) {
            // SAFETY: the pointer and the length are of one slice.
            Known::Other => Atom(
                unsafe { Bun__DOM__atomizeLatin1(text.as_ptr(), super::string::length_of(text)) }
                    .expose_provenance(),
            ),
            known => known.into(),
        }
    }

    #[inline]
    pub(crate) fn from_impl(string: &Impl) -> Atom {
        if !string.is_8bit() {
            return Atom::from_wide(string);
        }
        match if string.is_atom() {
            Known::from_atom(string)
        } else {
            Known::from_latin1(string.latin1_slice())
        } {
            Known::Other => Atom::from_unknown(string),
            known => known.into(),
        }
    }

    /// For looking something up.
    #[inline]
    pub(crate) fn with_impl<R>(string: &Impl, read: impl FnOnce(&Atom) -> R) -> R {
        let (borrowed, owned);
        read(match string.is_8bit() && string.is_atom() {
            true => {
                borrowed = ManuallyDrop::new(match Known::from_atom(string) {
                    Known::Other => Atom(NonNull::from(string).expose_provenance()),
                    known => known.into(),
                });
                &borrowed
            }
            false => {
                owned = Atom::from_impl(string);
                &owned
            }
        })
    }

    /// In ASCII lowercase.
    #[inline]
    pub(crate) fn from_impl_lowercased(string: &Impl) -> Atom {
        if string.is_8bit() {
            match Known::from_latin1_lowercased(string.latin1_slice()) {
                Known::Other if string.latin1_slice().iter().any(u8::is_ascii_uppercase) => {}
                Known::Other => return Atom::from_unknown(string),
                known => return known.into(),
            }
        }
        Atom::from_string(&DomString::from_impl(string).to_ascii_lowercase())
    }

    #[inline]
    fn from_unknown(string: &Impl) -> Atom {
        if !string.is_atom() {
            return Atom(Bun__DOM__atomize(string).expose_provenance());
        }
        string.r#ref();
        Atom(NonNull::from(string).expose_provenance())
    }

    #[cold]
    fn from_wide(string: &Impl) -> Atom {
        match string
            .utf16_slice()
            .iter()
            .map(|it| u8::try_from(*it).ok())
            .collect::<Option<Vec<u8>>>()
        {
            Some(latin1) => Atom::from_latin1(&latin1),
            None => Atom::from_unknown(string),
        }
    }

    #[inline]
    pub(crate) fn from_string(string: &DomString) -> Atom {
        Atom::from_impl(string.as_impl())
    }

    #[inline]
    pub(crate) fn from_js_string<'a>(
        heap: &JsHeap<'a>,
        string: JsLocal<'a, JSString>,
    ) -> bindgen::Result<'a, Atom> {
        Ok(Atom::from_impl(impl_of(heap, string)?))
    }

    #[inline]
    pub(crate) fn from_js_string_lowercased<'a>(
        heap: &JsHeap<'a>,
        string: JsLocal<'a, JSString>,
    ) -> bindgen::Result<'a, Atom> {
        Atom::with_lowercased(heap, string, Atom::clone)
    }

    /// `run` does not come back here.
    #[inline]
    pub(crate) fn with_lowercased<'a, R>(
        heap: &JsHeap<'a>,
        string: JsLocal<'a, JSString>,
        run: impl FnOnce(&Atom) -> R,
    ) -> bindgen::Result<'a, R> {
        Atom::with_lowercased_and_keyed(heap, string, |atom, _| run(atom))
    }

    /// `run` also gets `Lowercased::keyed`.
    #[inline]
    pub(super) fn with_lowercased_and_keyed<'a, R>(
        heap: &JsHeap<'a>,
        string: JsLocal<'a, JSString>,
        run: impl FnOnce(&Atom, Name) -> R,
    ) -> bindgen::Result<'a, R> {
        let string = impl_of(heap, string)?;
        let slot = &mut LOWERCASED.borrow_mut()[((core::ptr::from_ref(string).addr() as u64)
            .wrapping_mul(0x9e37_79b9_7f4a_7c15)
            >> 57) as usize];
        let long;
        let found = match slot {
            Some(known) if core::ptr::eq(known.of.as_impl(), string) => known,
            _ if string.length() > 32 => {
                long = Lowercased::new(string);
                &long
            }
            _ => slot.insert(Lowercased::new(string)),
        };
        Ok(run(&found.atom, found.keyed))
    }

    #[inline(always)]
    pub(crate) fn known(&self) -> Known {
        if self.0.get() & 1 == 0 {
            Known::Other
        } else {
            Known::from_index((self.0.get() >> 1) as u16)
        }
    }

    #[inline]
    pub(crate) fn as_known(&self) -> Option<&'static str> {
        self.unknown().is_none().then(|| self.known().as_str())
    }

    #[inline]
    pub(crate) fn as_impl(&self) -> &Impl {
        self.unknown().unwrap_or_else(|| self.known().as_impl())
    }

    #[inline]
    pub(crate) fn name(&self) -> Name {
        match self.unknown() {
            None => NAMES[self.0.get() >> 1],
            Some(_) => self.name_of_unknown(),
        }
    }

    fn name_of_unknown(&self) -> Name {
        match &mut NAMES_OF_UNKNOWN.borrow_mut()[self.0.get().wrapping_mul(0x9e37_79b9) >> 16 & 63]
        {
            Some((atom, name)) if atom == self => *name,
            slot => {
                slot.insert((self.clone(), Name::new(self.as_utf8().as_bytes())))
                    .1
            }
        }
    }

    #[inline]
    pub(crate) fn as_utf8(&self) -> Cow<'_, str> {
        match self.unknown() {
            None => Cow::Borrowed(self.known().as_str()),
            Some(it) if it.is_8bit() && it.latin1_slice().is_ascii() => {
                // SAFETY: ASCII is UTF-8.
                Cow::Borrowed(unsafe { core::str::from_utf8_unchecked(it.latin1_slice()) })
            }
            Some(it) => Cow::Owned(DomString::from_impl(it).to_utf8().into_owned()),
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        *self == Known::Empty
    }

    pub(crate) fn to_dom_string(&self) -> DomString {
        DomString::from_impl(self.as_impl())
    }

    #[inline]
    pub(crate) fn to_js<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        self.unknown().map_or_else(
            || known_to_js(heap, self.known(), false),
            |it| impl_to_js(heap, it),
        )
    }

    pub(crate) fn to_ascii_lowercase(&self) -> Atom {
        Atom::from_impl_lowercased(self.as_impl())
    }

    pub(crate) fn to_ascii_uppercase(&self) -> Atom {
        let bits = self.identity();
        match &mut UPPERCASED.borrow_mut()[(bits >> 1 ^ bits >> 7) % 64] {
            Some((known, uppercased)) if known == self => uppercased.clone(),
            slot => slot
                .insert((
                    self.clone(),
                    Atom::from_string(&self.to_dom_string().to_ascii_uppercase()),
                ))
                .1
                .clone(),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) enum Ns {
    None,
    Html,
    Svg,
    MathMl,
    XLink,
    Xml,
    Xmlns,
    Other(Atom),
}

impl Ns {
    const URIS: [(Ns, Known); 6] = [
        (Ns::Html, Known::UriOfHtml),
        (Ns::Svg, Known::UriOfSvg),
        (Ns::MathMl, Known::UriOfMathMl),
        (Ns::XLink, Known::UriOfXLink),
        (Ns::Xml, Known::UriOfXml),
        (Ns::Xmlns, Known::UriOfXmlns),
    ];

    /// The empty string is no namespace.
    pub(crate) fn from_uri(uri: Option<&Atom>) -> Ns {
        let Some(uri) = uri.filter(|it| !it.is_empty()) else {
            return Ns::None;
        };
        Ns::URIS
            .iter()
            .find(|it| it.1 == uri.known())
            .map_or_else(|| Ns::Other(uri.clone()), |it| it.0.clone())
    }

    fn known_uri(&self) -> Option<Known> {
        Ns::URIS.iter().find(|it| it.0 == *self).map(|it| it.1)
    }

    /// Empty for none.
    pub(crate) fn as_utf8(&self) -> Cow<'_, str> {
        match self {
            Ns::Other(uri) => uri.as_utf8(),
            known => Cow::Borrowed(known.known_uri().map_or("", Known::as_str)),
        }
    }

    pub(crate) fn uri(&self) -> Option<Atom> {
        match self {
            Ns::Other(uri) => Some(uri.clone()),
            known => known.known_uri().map(Atom::of),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct QualName {
    pub(crate) ns: Ns,
    pub(crate) prefix: Option<Atom>,
    pub(crate) local: Atom,
}

impl QualName {
    pub(crate) fn known_without_namespace(&self) -> Known {
        if self.ns == Ns::None {
            self.local.known()
        } else {
            Known::Other
        }
    }

    /// In no namespace.
    #[inline]
    pub(crate) fn plain(local: impl Into<Atom>) -> QualName {
        QualName {
            ns: Ns::None,
            prefix: None,
            local: local.into(),
        }
    }

    #[inline]
    pub(crate) fn html(local: impl Into<Atom>) -> QualName {
        QualName {
            ns: Ns::Html,
            prefix: None,
            local: local.into(),
        }
    }

    /// A parser has checked it.
    #[inline]
    pub(crate) fn parsed(ns: Ns, prefix: Option<Atom>, local: Atom) -> QualName {
        QualName { ns, prefix, local }
    }

    pub(crate) fn qualified(&self) -> Atom {
        qualified(self.prefix.as_ref(), &self.local)
    }
}

pub(crate) fn qualified(prefix: Option<&Atom>, local: &Atom) -> Atom {
    let Some(prefix) = prefix else {
        return local.clone();
    };
    Atom::from_string(&DomString::concat(&[
        &prefix.to_dom_string(),
        &":".into(),
        &local.to_dom_string(),
    ]))
}
