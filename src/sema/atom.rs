//! Interned names. One table for the whole program, filled from every parser thread, and FROZEN WHILE THE PROGRAM IS CHECKED: a text that
//! is new then is an atom of the task that comes upon it (`OwnStore`), and the link step publishes it.

use crate::local::LOCAL;
use crate::types::OwnStore;
use crate::util::{AppendVec, GrowingPlaces, SHARDS, shard_of, spread_hash};

/// A name. Its number is its place in a list that every parser thread adds to, so it is another in every run: atoms have no order.
/// What is gone through goes by declaration or by text.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct Atom(pub u32);

impl Atom {
    pub const NONE: Atom = Atom(u32::MAX);

    /// Whether it is a word binder.go knows an `Identifier` by: `KindFirstFutureReservedWord` to `KindLastFutureReservedWord`,
    /// `await` (`checkContextualIdentifier`), `eval`, `arguments` (`isEvalOrArgumentsIdentifier`).
    #[inline]
    pub fn is_keyword_identifier(self) -> bool {
        self.0.wrapping_sub(known::implements.0) <= known::arguments.0 - known::implements.0
    }
    #[inline]
    pub fn is_none(self) -> bool {
        self == Atom::NONE
    }
    /// Whether a task has created it, and it is not published yet.
    #[inline]
    pub fn is_own(self) -> bool {
        self.0 & LOCAL != 0 && self != Atom::NONE
    }
    #[inline]
    pub fn is_some(self) -> bool {
        self != Atom::NONE
    }
}

impl std::fmt::Debug for Atom {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Atom({})", self.0)
    }
}

pub struct Interner {
    shards: Box<[GrowingPlaces]>,
    texts: AppendVec<Box<[u8]>>,
    /// Which interner it is, of all there have been.
    number: u64,
}

macro_rules! known_atoms {
    ($($name:ident = $text:literal,)*) => {
        /// Names the resolver itself looks for. Interned first, so their numbers are constants.
        #[allow(non_upper_case_globals)]
        pub mod known {
            use super::Atom;
            #[allow(non_camel_case_types)]
            enum Number { $($name),* }
            $(pub const $name: Atom = Atom(Number::$name as u32);)*
            pub(super) const TEXTS: &[&str] = &[$($text),*];
            /// `[Symbol.iterator]` and `[Symbol.asyncIterator]` as names of properties. Interned right after `TEXTS`: no `str`
            /// holds their first byte.
            pub const sym_iterator: Atom = Atom(TEXTS.len() as u32);
            pub const sym_async_iterator: Atom = Atom(TEXTS.len() as u32 + 1);
            /// `InternalSymbolNameGlobal`
            pub const global_augmentation: Atom = Atom(TEXTS.len() as u32 + 2);
        }
    };
}

known_atoms! {
    empty = "",
    default = "default",
    export_equals = "export=",
    returned = "return=",
    this = "this",
    undefined = "undefined",
    // `Atom::is_keyword_identifier`: from here to `arguments`.
    implements = "implements",
    interface = "interface",
    let_ = "let",
    package = "package",
    private = "private",
    protected = "protected",
    public = "public",
    r#static = "static",
    r#yield = "yield",
    r#await = "await",
    eval = "eval",
    arguments = "arguments",
    constructor = "constructor",
    prototype = "prototype",
    length = "length",
    then = "then",
    next = "next",
    value = "value",
    done = "done",
    globalThis = "globalThis",
    require = "require",
    module = "module",
    exports = "exports",
    Array = "Array",
    ReadonlyArray = "ReadonlyArray",
    Object = "Object",
    Function = "Function",
    CallableFunction = "CallableFunction",
    NewableFunction = "NewableFunction",
    String = "String",
    Number = "Number",
    Boolean = "Boolean",
    Symbol = "Symbol",
    BigInt = "BigInt",
    RegExp = "RegExp",
    Promise = "Promise",
    PromiseLike = "PromiseLike",
    Iterable = "Iterable",
    Iterator = "Iterator",
    IterableIterator = "IterableIterator",
    IteratorObject = "IteratorObject",
    AsyncIterable = "AsyncIterable",
    AsyncIterator = "AsyncIterator",
    AsyncIterableIterator = "AsyncIterableIterator",
    AsyncIteratorObject = "AsyncIteratorObject",
    Generator = "Generator",
    AsyncGenerator = "AsyncGenerator",
    IArguments = "IArguments",
    TemplateStringsArray = "TemplateStringsArray",
    ImportMeta = "ImportMeta",
    Error = "Error",
    Map = "Map",
    Set = "Set",
    Partial = "Partial",
    Required = "Required",
    Readonly = "Readonly",
    Pick = "Pick",
    Omit = "Omit",
    Record = "Record",
    Exclude = "Exclude",
    Extract = "Extract",
    NonNullable = "NonNullable",
    ReturnType = "ReturnType",
    Parameters = "Parameters",
    ConstructorParameters = "ConstructorParameters",
    InstanceType = "InstanceType",
    Awaited = "Awaited",
    ThisType = "ThisType",
    NoInfer = "NoInfer",
    Uppercase = "Uppercase",
    Lowercase = "Lowercase",
    Capitalize = "Capitalize",
    Uncapitalize = "Uncapitalize",
    isArray = "isArray",
    iterator = "iterator",
    asyncIterator = "asyncIterator",
    JSX = "JSX",
    Element = "Element",
    IntrinsicElements = "IntrinsicElements",
    IntrinsicAttributes = "IntrinsicAttributes",
    IntrinsicClassAttributes = "IntrinsicClassAttributes",
    LibraryManagedAttributes = "LibraryManagedAttributes",
    ElementAttributesProperty = "ElementAttributesProperty",
    ElementChildrenAttribute = "ElementChildrenAttribute",
    ElementClass = "ElementClass",
    ElementType = "ElementType",
    children = "children",
    props = "props",
    string = "string",
    unknown = "unknown",
    number = "number",
    boolean = "boolean",
    bigint = "bigint",
    symbol = "symbol",
    object = "object",
    function = "function",
    push = "push",
    unshift = "unshift",
    call = "call",
    apply = "apply",
    bind = "bind",
    args = "args",
    React = "React",
    r#const = "const",
    global = "global",
    intrinsic = "intrinsic",
    Disposable = "Disposable",
    freeze = "freeze",
    key = "key",
    r#ref = "ref",
    defineProperty = "defineProperty",
    get = "get",
    set = "set",
    writable = "writable",
    anonymous_function = "function=",
    object_literal = "object=",
    computed = "computed=",
    assignment_declaration = "assignment=",
    missing = "missing=",
    constructor_declaration = "constructor=",
    call_signature = "call=",
    construct_signature = "new=",
    index_signature = "index=",
    type_literal = "type=",
    any = "any",
    never = "never",
    void = "void",
    WeakMap = "WeakMap",
    WeakSet = "WeakSet",
    Reflect = "Reflect",
    __esModule = "__esModule",
    async_ = "async",
    AsyncDisposable = "AsyncDisposable",
    tslib = "tslib",
}

/// What the name of a property that a symbol names starts with: `InternalSymbolNamePrefix` and `@`. No text has the byte 0xFE in
/// it, so nothing that is written is such a name.
pub const SYMBOL_NAME_PREFIX: &[u8] = b"\xFE@";

/// The names a thread has come upon lately, with what they are spelled like right there: a file says the same few names over and over, and
/// finding one in what all threads share takes going to three places in memory that are far apart.
struct Recent {
    /// `Interner::number`
    of: u64,
    entries: Vec<RecentEntry>,
}

#[derive(Copy, Clone)]
struct RecentEntry {
    /// See `short`.
    start: (u64, u64, u64),
    end: u32,
    atom: u32,
}

impl Recent {
    /// Of no interner: numbers start at 1. The entries are allocated on first use.
    const EMPTY: Recent = Recent {
        of: 0,
        entries: Vec::new(),
    };
    const LONGEST: usize = 27;
    const BITS: u32 = 11;
    /// Nothing is this long.
    const NOTHING: RecentEntry = RecentEntry {
        start: (0, 0, 0),
        end: u32::MAX,
        atom: 0,
    };
}

/// Up to eight bytes of `text`, from `from` on, as a number. What is not there is zero.
#[inline]
fn word(text: &[u8], from: usize) -> u64 {
    let Some(rest) = text.get(from..) else {
        return 0;
    };
    let len = rest.len();
    if len >= 8 {
        u64::from_le_bytes(rest[..8].try_into().unwrap())
    } else if len >= 4 {
        // The two overlap, and agree where they do.
        let first = u32::from_le_bytes(rest[..4].try_into().unwrap());
        let last = u32::from_le_bytes(rest[len - 4..].try_into().unwrap());
        u64::from(first) | u64::from(last) << ((len - 4) * 8)
    } else if len >= 2 {
        let first = u16::from_le_bytes(rest[..2].try_into().unwrap());
        u64::from(first) | u64::from(rest[len - 1]) << ((len - 1) * 8)
    } else if len == 1 {
        u64::from(rest[0])
    } else {
        0
    }
}

/// A text of at most `Recent::LONGEST` bytes as numbers: the bytes with zeros after them, and in the last byte of all how many there are.
#[inline]
fn short(text: &[u8]) -> ((u64, u64, u64), u32) {
    (
        (word(text, 0), word(text, 8), word(text, 16)),
        word(text, 24) as u32 | (text.len() as u32) << 24,
    )
}

/// What a text is found by.
#[inline]
pub(crate) fn hash_of(text: &[u8]) -> u64 {
    if text.len() > Recent::LONGEST {
        spread_hash(text)
    } else {
        spread_hash(&short(text))
    }
}

thread_local! {
    static RECENT: std::cell::UnsafeCell<Recent> = const { std::cell::UnsafeCell::new(Recent::EMPTY) };
}

/// The calling thread's cache of recently interned atoms. A thread of a pool outlives a check, so the cache is owned by the check: a
/// thread has one for as long as it works for the check.
pub struct RecentAtoms(Recent);

impl Default for RecentAtoms {
    fn default() -> Self {
        RecentAtoms(Recent::EMPTY)
    }
}

impl RecentAtoms {
    /// Takes the cache from the calling thread.
    pub fn take() -> RecentAtoms {
        RecentAtoms::default().install()
    }

    /// Gives the cache to the calling thread. Returns the one it had.
    pub fn install(self) -> RecentAtoms {
        // SAFETY: it is the thread's own, and nothing in here gets back here.
        RECENT.with(|recent| RecentAtoms(std::mem::replace(unsafe { &mut *recent.get() }, self.0)))
    }
}

/// From 1 on.
static NEXT_NUMBER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

impl crate::table::Id for Atom {
    #[inline]
    fn number(self) -> u32 {
        self.0
    }
    #[inline]
    fn from_number(number: u32) -> Self {
        Atom(number)
    }
    #[inline]
    fn local_number(self) -> Option<u32> {
        self.is_own().then_some(self.0 & !LOCAL)
    }
}

impl Default for Interner {
    fn default() -> Self {
        Self::new()
    }
}

impl Interner {
    pub fn new() -> Self {
        let this = Interner {
            shards: (0..SHARDS).map(|_| GrowingPlaces::default()).collect(),
            texts: AppendVec::new(),
            number: NEXT_NUMBER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        };
        for (i, text) in known::TEXTS.iter().enumerate() {
            let atom = this.intern(text.as_bytes());
            assert_eq!(atom.0 as usize, i);
        }
        assert_eq!(this.symbol_name(b"iterator"), known::sym_iterator);
        assert_eq!(
            this.symbol_name(b"asyncIterator"),
            known::sym_async_iterator
        );
        assert_eq!(this.intern(b"\xFEglobal"), known::global_augmentation);
        this
    }

    /// For the link step.
    pub(crate) fn halves(&self) -> (&[GrowingPlaces], &AppendVec<Box<[u8]>>) {
        (&self.shards, &self.texts)
    }

    /// Which interner it is, of all there have been: what is remembered of one says nothing of another.
    #[inline]
    pub fn number(&self) -> u64 {
        self.number
    }

    pub fn intern(&self, text: &[u8]) -> Atom {
        if text.len() > Recent::LONGEST {
            return self.intern_shared(hash_of(text), text);
        }
        let (start, end) = short(text);
        let spread = spread_hash(&(start, end));
        RECENT.with(|recent| {
            // SAFETY: it is the thread's own, and nothing in here gets back here.
            let recent = unsafe { &mut *recent.get() };
            if recent.of != self.number {
                recent.of = self.number;
                match recent.entries.is_empty() {
                    true => recent.entries = vec![Recent::NOTHING; 1 << Recent::BITS],
                    false => recent.entries.fill(Recent::NOTHING),
                }
            }
            let entry = &mut recent.entries[(spread >> (64 - Recent::BITS)) as usize];
            if entry.start == start && entry.end == end {
                return Atom(entry.atom);
            }
            let atom = self.intern_shared(spread, text);
            *entry = RecentEntry {
                start,
                end,
                atom: atom.0,
            };
            atom
        })
    }

    fn intern_shared(&self, spread: u64, text: &[u8]) -> Atom {
        let shard = &self.shards[shard_of(spread)];
        if let Some(atom) = shard.find(spread, |i| &**self.texts.get(i) == text) {
            return Atom(atom);
        }
        Atom(shard.find_or_add(
            spread,
            |i| &**self.texts.get(i) == text,
            || self.texts.push(Box::from(text)),
        ))
    }

    /// The atom of `text`, if anything interned it.
    pub fn lookup(&self, text: &[u8]) -> Option<Atom> {
        let spread = hash_of(text);
        self.shards[shard_of(spread)]
            .find(spread, |i| &**self.texts.get(i) == text)
            .map(Atom)
    }

    #[inline]
    pub fn bytes(&self, atom: Atom) -> &[u8] {
        debug_assert!(!atom.is_own(), "only `Atoms` knows a task's own");
        self.texts.get(atom.0)
    }

    /// The name of the property `[Symbol.name]` (`getPropertyNameForKnownSymbolName`). Given `name@id`, that of the property a
    /// `unique symbol` names (`getESSymbolLikeTypeForNode`).
    pub fn symbol_name(&self, name: &[u8]) -> Atom {
        self.intern(&[SYMBOL_NAME_PREFIX, name].concat())
    }

    /// `isLateBoundName`
    #[inline]
    pub fn is_symbol_name(&self, atom: Atom) -> bool {
        atom.is_some() && self.bytes(atom).starts_with(SYMBOL_NAME_PREFIX)
    }

    /// `EscapeInternalSymbolName`: the byte that no text has reads `__`.
    #[cfg(feature = "baselines")]
    pub fn text(&self, atom: Atom) -> std::borrow::Cow<'_, str> {
        if atom.is_none() {
            return std::borrow::Cow::Borrowed("<none>");
        }
        as_text(self.bytes(atom))
    }
}

#[cfg(feature = "baselines")]
fn as_text(bytes: &[u8]) -> std::borrow::Cow<'_, str> {
    match bytes {
        [0xFE, rest @ ..] => {
            std::borrow::Cow::Owned(format!("__{}", String::from_utf8_lossy(rest)))
        }
        bytes => String::from_utf8_lossy(bytes),
    }
}

/// THE PUBLISHED ATOMS AND THE TASK'S OWN, which is all that a task sees. `Checker::atoms` makes one.
#[derive(Copy, Clone)]
pub struct Atoms<'p> {
    published: &'p Interner,
    own: &'p OwnStore,
}

impl<'p> Atoms<'p> {
    #[inline(always)]
    pub fn new(published: &'p Interner, own: &OwnStore) -> Atoms<'p> {
        // SAFETY: as in `Types::new`.
        let own = unsafe { &*std::ptr::from_ref(own) };
        Atoms { published, own }
    }

    #[inline]
    fn find_published(&self, spread: u64, text: &[u8]) -> Option<Atom> {
        let texts = &self.published.texts;
        (self.published.shards[shard_of(spread)])
            .find_frozen(spread, |i| &**texts.get(i) == text)
            .map(Atom)
    }

    pub fn intern(&self, text: &[u8]) -> Atom {
        let spread = hash_of(text);
        match self.find_published(spread, text) {
            Some(atom) => atom,
            None => self.own.intern_atom(spread, text),
        }
    }

    /// The atom of `text`, if it is published or the task has created it.
    pub fn lookup(&self, text: &[u8]) -> Option<Atom> {
        let spread = hash_of(text);
        self.find_published(spread, text)
            .or_else(|| self.own.find_atom(spread, text))
    }

    #[inline]
    pub fn bytes(&self, atom: Atom) -> &'p [u8] {
        if atom.is_own() {
            self.own.atom_bytes(atom)
        } else {
            self.published.bytes(atom)
        }
    }

    /// See `Interner::symbol_name`.
    pub fn symbol_name(&self, name: &[u8]) -> Atom {
        self.intern(&[SYMBOL_NAME_PREFIX, name].concat())
    }

    /// `isLateBoundName`
    #[inline]
    pub fn is_symbol_name(&self, atom: Atom) -> bool {
        atom.is_some() && self.bytes(atom).starts_with(SYMBOL_NAME_PREFIX)
    }

    /// See `Interner::text`.
    #[cfg(feature = "baselines")]
    pub fn text(&self, atom: Atom) -> std::borrow::Cow<'p, str> {
        if atom.is_none() {
            return std::borrow::Cow::Borrowed("<none>");
        }
        as_text(self.bytes(atom))
    }
}

/// The number `text` is the decimal notation of.
pub fn parse_number(text: &[u8]) -> Option<f64> {
    core::str::from_utf8(text).ok()?.parse().ok()
}

/// `String(n)`, which is the name a number goes by as a property.
pub fn number_to_string(n: f64) -> Vec<u8> {
    use std::io::Write;
    let mut text = Vec::new();
    if n.is_nan() {
        text.extend_from_slice(b"NaN");
    } else if n.is_infinite() {
        text.extend_from_slice(if n > 0.0 { b"Infinity" } else { b"-Infinity" });
    } else if n == 0.0 {
        text.push(b'0');
    } else if n.abs() >= 1e21 || n.abs() < 1e-6 {
        // Writing to a `Vec` does not fail.
        let _ = write!(text, "{n:e}");
        if let Some(e) = bun_core::strings::index_of_char_usize(&text, b'e')
            && text.get(e + 1) != Some(&b'-')
        {
            text.insert(e + 1, b'+');
        }
    } else {
        let _ = write!(text, "{n}");
    }
    text
}
