//! The names and strings of one parse, each as a small number.

use core::num::NonZeroU32;

use bun_engine_text::Text;

use crate::source::Source;
use crate::token::TokenKind;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Name(NonZeroU32);

impl Name {
    const fn new(index: usize) -> Name {
        match NonZeroU32::new(index as u32) {
            Some(index) => Name(index),
            None => panic!("zero is no name"),
        }
    }

    /// Below [`Names::limit`].
    #[inline(always)]
    pub const fn index(self) -> usize {
        self.0.get() as usize
    }

    #[inline(always)]
    pub(crate) const fn from_word(word: u32) -> Option<Name> {
        match NonZeroU32::new(word) {
            Some(index) => Some(Name(index)),
            None => None,
        }
    }

    /// One of the constants.
    pub fn known(index: usize) -> Option<Name> {
        (1..KNOWN.len()).contains(&index).then(|| Name::new(index))
    }

    /// The text of one of the constants.
    #[inline]
    pub fn known_text(index: usize) -> Option<&'static str> {
        KNOWN.get(index).copied()
    }

    /// Whether only the engine can refer to it.
    #[inline(always)]
    pub const fn is_internal(self) -> bool {
        self.index() >= Name::THIS_VALUE.index() && self.index() < KNOWN.len()
    }
}

macro_rules! known_names {
    ($($name:ident = $text:literal,)*) => {
        #[allow(non_camel_case_types, clippy::upper_case_acronyms)]
        enum Position {
            None,
            $($name,)*
        }

        impl Name {
            $(pub const $name: Name = Name::new(Position::$name as usize);)*
        }

        const KNOWN: [&str; Position::None as usize + 1 + [$($text),*].len()] = ["", $($text),*];
    };
}

known_names! {
    // In the order of the keywords of `TokenKind`.
    NULL = "null",
    TRUE = "true",
    FALSE = "false",
    BREAK = "break",
    CASE = "case",
    DEFAULT = "default",
    FOR = "for",
    NEW = "new",
    VAR = "var",
    CONST = "const",
    CONTINUE = "continue",
    FUNCTION = "function",
    RETURN = "return",
    IF = "if",
    THIS = "this",
    DO = "do",
    WHILE = "while",
    SWITCH = "switch",
    WITH = "with",
    THROW = "throw",
    TRY = "try",
    CATCH = "catch",
    FINALLY = "finally",
    DEBUGGER = "debugger",
    ELSE = "else",
    IMPORT = "import",
    EXPORT = "export",
    CLASS = "class",
    EXTENDS = "extends",
    SUPER = "super",
    TYPEOF = "typeof",
    VOID = "void",
    DELETE = "delete",
    INSTANCEOF = "instanceof",
    IN = "in",
    ENUM = "enum",
    LET = "let",
    YIELD = "yield",
    AWAIT = "await",
    // Reserved in strict code.
    IMPLEMENTS = "implements",
    INTERFACE = "interface",
    PACKAGE = "package",
    PRIVATE = "private",
    PROTECTED = "protected",
    PUBLIC = "public",
    STATIC = "static",

    ARGUMENTS = "arguments",
    EVAL = "eval",
    AS = "as",
    ASYNC = "async",
    DEFER = "defer",
    FROM = "from",
    GET = "get",
    META = "meta",
    OF = "of",
    SET = "set",
    TARGET = "target",
    USING = "using",
    CONSTRUCTOR = "constructor",
    PRIVATE_CONSTRUCTOR = "#constructor",
    PROTOTYPE = "prototype",
    PROTO = "__proto__",
    APPLY = "apply",
    CALL = "call",
    CONSTRUCT = "construct",
    EXEC = "exec",
    HAS_OWN_PROPERTY = "hasOwnProperty",
    LENGTH = "length",
    NAME = "name",
    TEST = "test",
    UNDEFINED = "undefined",
    ARRAY = "Array",
    OBJECT = "Object",
    REFLECT = "Reflect",
    DONE = "done",
    NEXT = "next",
    VALUE = "value",
    EMPTY = "",

    // Bindings of the engine. No text of a script is interned as one of these.
    THIS_VALUE = "*this*",
    NEW_TARGET = "*new.target*",
    ACTIVE_FUNCTION = "*function*",
    HOME = "*home*",
    FIELD_INITIALIZER = "*fields*",
    CLASS_HOME = "*class home*",
    CLASS_STATIC_HOME = "*class static home*",
    CLASS_FIELD_INITIALIZER = "*class fields*",
    CLASS_BRAND = "*class brand*",
    DEFAULT_EXPORT = "*default*",
    IMPORT_META = "*import.meta*",
}

/// What `@` makes of a name in the source of a built-in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum NameKind {
    Ordinary,
    /// `@name`
    Private,
    /// `@@name`
    WellKnownSymbol,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
enum Storage {
    #[default]
    Source,
    Latin1,
    Utf16,
}

#[derive(Clone, Copy)]
struct Entry {
    start: u32,
    length: u32,
    /// Past the end of the table if it has none.
    slot: u32,
    storage: Storage,
    kind: NameKind,
}

/// A short text is in there as it is, with its length and kind in the last byte. Of another, `head` has the hash in
/// its lower half and `tail` has the length, the kind and whether it is wide.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Key {
    head: u64,
    tail: u64,
}

#[derive(Clone, Copy, Default)]
struct Slot {
    /// The upper half of `head` has where a text is that is not short: `Entry::start`.
    key: Key,
    name: u32,
    kind: TokenKind,
    storage: Storage,
}

/// What it takes to make the key of a short text.
pub(crate) type Chunk = [u8; 16];

pub(crate) const LONGEST_SHORT: usize = size_of::<Chunk>() - 1;
const SHORT: u64 = 1 << 63;
const WIDE: u64 = 1 << 34;
const INITIAL_SLOTS: usize = 512;
/// A literal that is longer is not worth looking up.
const LONGEST_INTERNED_LITERAL: usize = 64;

/// By length: which bits of a chunk are text, and the last byte.
static SHORT_SHAPES: [[u64; 4]; LONGEST_SHORT + 1] = {
    let mut shapes = [[0; 4]; LONGEST_SHORT + 1];
    let mut length = 0;
    while length <= LONGEST_SHORT {
        let mask = (1u128 << (8 * length)) - 1;
        let last = SHORT | (length as u64) << 56;
        shapes[length] = [mask as u64, (mask >> 64) as u64, last, 0];
        length += 1;
    }
    shapes
};

#[inline(always)]
fn words(chunk: &Chunk) -> (u64, u64) {
    let both = u128::from_le_bytes(*chunk);
    (both as u64, (both >> 64) as u64)
}

#[inline(always)]
fn mix(hash: u64, chunk: &Chunk) -> u64 {
    let (head, tail) = words(chunk);
    let product = u128::from(head ^ hash) * u128::from(tail ^ 0x8bb8_4b93_962e_acc9);
    product as u64 ^ (product >> 64) as u64
}

impl Key {
    /// Of the first `length` bytes of `chunk`.
    #[inline(always)]
    pub(crate) fn short(chunk: &Chunk, length: usize) -> Key {
        let (head, tail) = words(chunk);
        let [head_mask, tail_mask, last, _] = SHORT_SHAPES[length];
        Key {
            head: head & head_mask,
            tail: tail & tail_mask | last,
        }
    }

    #[inline(always)]
    fn narrow(characters: &[u8], kind: NameKind) -> Key {
        let Some(last) = characters.last_chunk() else {
            let mut chunk = Chunk::default();
            chunk[..characters.len()].copy_from_slice(characters);
            let mut key = Key::short(&chunk, characters.len());
            key.tail |= (kind as u64) << 60;
            return key;
        };
        let (chunks, _) = characters.as_chunks();
        Key {
            head: mix(chunks.iter().fold(0x2d35_8dcc_aa6c_78a5, mix), last) >> 32,
            tail: (kind as u64) << 32 | characters.len() as u64,
        }
    }

    fn wide(units: &[u16]) -> Key {
        Key {
            head: u64::from(Text::Utf16(units).hash()),
            tail: WIDE | units.len() as u64,
        }
    }

    #[inline(always)]
    fn is_short(self) -> bool {
        self.tail & SHORT != 0
    }

    fn length(self) -> usize {
        if self.is_short() {
            (self.tail >> 56) as usize & LONGEST_SHORT
        } else {
            self.tail as u32 as usize
        }
    }

    /// The upper bits of the product are the ones that all of the key has gone into.
    #[inline(always)]
    fn hash(self) -> usize {
        (self.head ^ self.tail.rotate_left(29))
            .wrapping_mul(0x9e37_79b9_7f4a_7c15)
            .swap_bytes() as usize
    }
}

impl Slot {
    /// The key that finds it.
    fn key(self) -> Key {
        let mut key = self.key;
        if !key.is_short() {
            key.head &= u64::from(u32::MAX);
        }
        key
    }
}

/// `a` and `b` have the same length, which is no less than that of a chunk.
#[inline(always)]
fn are_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() > 2 * size_of::<Chunk>() {
        return a == b;
    }
    a.first_chunk::<16>() == b.first_chunk() && a.last_chunk::<16>() == b.last_chunk()
}

pub struct Names {
    slots: Vec<Slot>,
    entries: Vec<Entry>,
    /// How many more names the table takes.
    room: usize,
    latin1: Vec<u8>,
    utf16: Vec<u16>,
}

impl Default for Names {
    fn default() -> Names {
        let mut names = Names::unallocated();
        names.allocate(INITIAL_SLOTS);
        names
    }
}

impl Names {
    /// Takes the place of one that is lent out.
    pub(crate) const fn unallocated() -> Names {
        Names {
            slots: Vec::new(),
            entries: Vec::new(),
            room: 0,
            latin1: Vec::new(),
            utf16: Vec::new(),
        }
    }

    /// The constants go in first, so they are found whichever of the others are taken out. Returns the old table.
    fn allocate(&mut self, size: usize) -> Vec<Slot> {
        let old = core::mem::replace(&mut self.slots, vec![Slot::default(); size]);
        for (index, text) in KNOWN[..Name::THIS_VALUE.index()].iter().enumerate().skip(1) {
            self.put(Slot {
                key: Key::narrow(text.as_bytes(), NameKind::Ordinary),
                name: index as u32,
                kind: TokenKind::of_name(Name::new(index)),
                storage: Storage::Latin1,
            });
        }
        self.room = size / 2 - KNOWN.len();
        old
    }

    fn put(&mut self, slot: Slot) -> usize {
        let mask = self.slots.len() - 1;
        let mut index = slot.key().hash() & mask;
        while self.slots[index].name != 0 {
            index = (index + 1) & mask;
        }
        self.slots[index] = slot;
        index
    }

    pub(crate) fn clear(&mut self) {
        for entry in self.entries.drain(..) {
            if let Some(slot) = self.slots.get_mut(entry.slot as usize) {
                *slot = Slot::default();
            }
        }
        self.room = self.slots.len() / 2 - KNOWN.len();
        self.latin1.clear();
        self.utf16.clear();
    }

    /// One more than the greatest index of a name.
    #[inline]
    pub fn limit(&self) -> usize {
        KNOWN.len() + self.entries.len()
    }

    #[inline]
    fn entry(&self, name: Name) -> Option<&Entry> {
        self.entries.get(name.index().wrapping_sub(KNOWN.len()))
    }

    /// Without the `@`.
    #[inline]
    pub fn text<'a>(&'a self, name: Name, source: Text<'a>) -> Text<'a> {
        let Some(entry) = self.entry(name) else {
            return Text::Latin1(KNOWN[name.index()].as_bytes());
        };
        let range = entry.start as usize..entry.start as usize + entry.length as usize;
        match entry.storage {
            Storage::Source => source.slice(range),
            Storage::Latin1 => Text::Latin1(&self.latin1[range]),
            Storage::Utf16 => Text::Utf16(&self.utf16[range]),
        }
    }

    #[inline]
    pub fn length(&self, name: Name) -> u32 {
        match self.entry(name) {
            Some(entry) => entry.length,
            None => KNOWN[name.index()].len() as u32,
        }
    }

    #[inline]
    pub fn kind(&self, name: Name) -> NameKind {
        self.entry(name)
            .map_or(NameKind::Ordinary, |entry| entry.kind)
    }

    /// Where the text is in the source, if it is there as it is.
    #[inline]
    pub fn source_start(&self, name: Name) -> Option<u32> {
        self.entry(name)
            .filter(|entry| entry.storage == Storage::Source)
            .map(|entry| entry.start)
    }

    /// The index, and what it is in strict code, if it is where it is looked for first.
    #[inline(always)]
    pub(crate) fn find_at_once(&self, key: Key) -> Option<(u32, TokenKind)> {
        let slot = (self.slots).get(key.hash() & self.slots.len().wrapping_sub(1))?;
        (slot.key == key).then_some((slot.name, slot.kind))
    }

    /// `key` is that of a short text at `start` in the source.
    #[inline(always)]
    pub(crate) fn intern_short(&mut self, key: Key, start: usize) -> Name {
        match self.find(key, |slot| slot.key == key) {
            Ok(name) => name,
            Err(slot) => self.insert(key, slot, start, Storage::Source, NameKind::Ordinary),
        }
    }

    /// A range of the source that has only Latin-1 characters.
    #[inline]
    pub(crate) fn intern_narrow(
        &mut self,
        source: Source<'_>,
        start: usize,
        end: usize,
        kind: NameKind,
    ) -> Name {
        let characters = &source.bytes[start..end];
        let key = Key::narrow(characters, kind);
        match self.find_narrow(source, key, characters) {
            Ok(name) => name,
            Err(slot) => self.insert(key, slot, start, Storage::Source, kind),
        }
    }

    #[inline]
    pub(crate) fn intern_source(&mut self, source: Source<'_>, start: usize, end: usize) -> Name {
        if let Text::Utf16(units) = source.text
            && !Text::Utf16(&units[start..end]).fits_latin1()
        {
            return self.intern_wide(source, start, &units[start..end]);
        }
        match source.bytes[start..].first_chunk() {
            Some(chunk) if end - start <= LONGEST_SHORT => {
                self.intern_short(Key::short(chunk, end - start), start)
            }
            _ => self.intern_narrow(source, start, end, NameKind::Ordinary),
        }
    }

    fn intern_wide(&mut self, source: Source<'_>, start: usize, units: &[u16]) -> Name {
        let key = Key::wide(units);
        match self.find_wide(source, key, units) {
            Ok(name) => name,
            Err(slot) => self.insert(key, slot, start, Storage::Source, NameKind::Ordinary),
        }
    }

    /// A text that is not in the source as it is.
    pub(crate) fn intern_text(&mut self, source: Source<'_>, text: Text<'_>) -> Name {
        let (storage, start) = self.store(text);
        let (key, found) = if storage == Storage::Latin1 {
            let characters = &self.latin1[start..];
            let key = Key::narrow(characters, NameKind::Ordinary);
            (key, self.find_narrow(source, key, characters))
        } else {
            let key = Key::wide(&self.utf16[start..]);
            (key, self.find_wide(source, key, &self.utf16[start..]))
        };
        match found {
            Ok(name) if storage == Storage::Latin1 => {
                self.latin1.truncate(start);
                name
            }
            Ok(name) => {
                self.utf16.truncate(start);
                name
            }
            Err(slot) => self.insert(key, slot, start, storage, NameKind::Ordinary),
        }
    }

    /// The value of a literal, which is not compared with other names.
    #[inline]
    pub(crate) fn literal_in_source(
        &mut self,
        source: Source<'_>,
        start: usize,
        end: usize,
    ) -> Name {
        if end - start <= LONGEST_INTERNED_LITERAL {
            return self.intern_source(source, start, end);
        }
        self.add_entry(
            start,
            end - start,
            usize::MAX,
            Storage::Source,
            NameKind::Ordinary,
        )
    }

    pub(crate) fn literal(&mut self, source: Source<'_>, text: Text<'_>) -> Name {
        if text.len() <= LONGEST_INTERNED_LITERAL {
            return self.intern_text(source, text);
        }
        let (storage, start) = self.store(text);
        self.add_entry(start, text.len(), usize::MAX, storage, NameKind::Ordinary)
    }

    fn store(&mut self, text: Text<'_>) -> (Storage, usize) {
        let (latin1, utf16) = (self.latin1.len(), self.utf16.len());
        match text {
            Text::Latin1(characters) => self.latin1.extend_from_slice(characters),
            Text::Utf16(units) if text.fits_latin1() => {
                self.latin1.extend(units.iter().map(|&unit| unit as u8));
            }
            Text::Utf16(units) => {
                self.utf16.extend_from_slice(units);
                return (Storage::Utf16, utf16);
            }
        }
        (Storage::Latin1, latin1)
    }

    #[inline(always)]
    fn find_narrow(&self, source: Source<'_>, key: Key, characters: &[u8]) -> Result<Name, usize> {
        if key.is_short() {
            return self.find(key, |slot| slot.key == key);
        }
        self.find(key, |slot| {
            slot.key.tail == key.tail && slot.key.head as u32 == key.head as u32 && {
                let storage = match slot.storage {
                    Storage::Source => source.bytes,
                    Storage::Latin1 | Storage::Utf16 => &self.latin1,
                };
                let start = (slot.key.head >> 32) as usize;
                are_equal(&storage[start..][..characters.len()], characters)
            }
        })
    }

    fn find_wide(&self, source: Source<'_>, key: Key, units: &[u16]) -> Result<Name, usize> {
        self.find(key, |slot| {
            slot.key() == key
                && self.text(Name::new(slot.name as usize), source.text) == Text::Utf16(units)
        })
    }

    /// The name, or the slot for it.
    #[inline(always)]
    fn find(&self, key: Key, is_it: impl Fn(&Slot) -> bool) -> Result<Name, usize> {
        let mask = self.slots.len().wrapping_sub(1);
        let mut index = key.hash() & mask;
        loop {
            let slot = &self.slots[index];
            let Some(name) = Name::from_word(slot.name) else {
                return Err(index);
            };
            if is_it(slot) {
                return Ok(name);
            }
            index = (index + 1) & mask;
        }
    }

    #[inline(never)]
    fn insert(
        &mut self,
        mut key: Key,
        slot: usize,
        start: usize,
        storage: Storage,
        kind: NameKind,
    ) -> Name {
        let name = self.add_entry(start, key.length(), slot, storage, kind);
        if !key.is_short() {
            key.head |= (start as u64) << 32;
        }
        self.slots[slot] = Slot {
            key,
            name: name.index() as u32,
            kind: TokenKind::Identifier,
            storage,
        };
        self.room -= 1;
        if self.room == 0 {
            self.grow();
        }
        name
    }

    #[inline]
    fn add_entry(
        &mut self,
        start: usize,
        length: usize,
        slot: usize,
        storage: Storage,
        kind: NameKind,
    ) -> Name {
        let name = Name::new(self.limit());
        self.entries.push(Entry {
            start: start as u32,
            length: length as u32,
            slot: slot as u32,
            storage,
            kind,
        });
        name
    }

    #[cold]
    fn grow(&mut self) {
        let factor = if self.slots.len() < 1 << 13 { 4 } else { 2 };
        for slot in self.allocate(self.slots.len() * factor) {
            if let Some(index) = (slot.name as usize).checked_sub(KNOWN.len()) {
                self.entries[index].slot = self.put(slot) as u32;
                self.room -= 1;
            }
        }
    }
}
