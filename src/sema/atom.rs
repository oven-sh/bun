//! Interned names. One table for the whole program, filled from every parser thread, and frozen
//! while the program is checked: a text first seen during checking becomes a task-local atom of the
//! task that encounters it (`OwnStore`), and the merge at the barrier publishes it.

use crate::local::LOCAL;
use crate::session::{ArenaBox, Session};
use crate::types::OwnStore;
use crate::util::{AppendVec, GrowingPlaces, SHARDS, shard_of, spread_hash};

/// A name. Its number is its index in a list that every parser thread appends to, so it differs
/// from run to run: atoms have no order.
/// Anything that is iterated over is ordered by declaration or by text.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct Atom(pub u32);

impl Atom {
    pub const NONE: Atom = Atom(u32::MAX);

    /// Whether it is one of the words binder.go checks an `Identifier` for:
    /// `KindFirstFutureReservedWord` to `KindLastFutureReservedWord`, `await`
    /// (`checkContextualIdentifier`), `eval`, `arguments` (`isEvalOrArgumentsIdentifier`).
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

type Texts<'s> = AppendVec<ArenaBox<'s, [u8]>, &'s Session>;

pub struct Interner<'s> {
    /// A text is in the arena of the thread that first interns it.
    session: &'s Session,
    shards: Box<[GrowingPlaces<&'s Session>; SHARDS], &'s Session>,
    texts: Texts<'s>,
    /// Sequence number of this interner among all that have been created.
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
            /// `[Symbol.iterator]` and `[Symbol.asyncIterator]` as property names. Interned right
            /// after `TEXTS`, because a `str` cannot contain their first byte.
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
    SymbolConstructor = "SymbolConstructor",
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

/// Prefix of the name of a symbol-keyed property: `InternalSymbolNamePrefix` and `@`. No text
/// contains the byte 0xFE, so no name in the source is such a name.
pub const SYMBOL_NAME_PREFIX: &[u8] = b"\xFE@";

/// Per-thread cache of recently seen names, with the spelling stored inline: a file repeats the
/// same few names, and a lookup in the shared table touches three distant memory locations.
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
    /// Belongs to no interner: interner numbers start at 1. The entries are allocated on first use.
    const EMPTY: Recent = Recent {
        of: 0,
        entries: Vec::new(),
    };
    const LONGEST: usize = 27;
    const BITS: u32 = 11;
    /// No text has this length.
    const NOTHING: RecentEntry = RecentEntry {
        start: (0, 0, 0),
        end: u32::MAX,
        atom: 0,
    };
}

/// Up to eight bytes of `text`, starting at `from`, as an integer. Missing bytes are zero.
#[inline]
fn word(text: &[u8], from: usize) -> u64 {
    let Some(rest) = text.get(from..) else {
        return 0;
    };
    let len = rest.len();
    if len >= 8 {
        u64::from_le_bytes(rest[..8].try_into().unwrap())
    } else if len >= 4 {
        // The two reads overlap and agree on the shared bytes.
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

/// A text of at most `Recent::LONGEST` bytes as integers: the bytes padded with zeros, with the
/// length in the very last byte.
#[inline]
fn short(text: &[u8]) -> ((u64, u64, u64), u32) {
    (
        (word(text, 0), word(text, 8), word(text, 16)),
        word(text, 24) as u32 | (text.len() as u32) << 24,
    )
}

/// The lookup key of a text.
#[inline]
pub(crate) fn hash_of(text: &[u8]) -> u64 {
    if text.len() > Recent::LONGEST {
        spread_hash(text)
    } else {
        spread_hash(&short(text))
    }
}

thread_local! {
    static RECENT: std::cell::RefCell<Recent> = const { std::cell::RefCell::new(Recent::EMPTY) };
}

/// The calling thread's cache of recently interned atoms. A pool thread outlives a check, so the
/// check owns the cache: a thread holds one only while it works for the check.
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

    /// Installs the cache on the calling thread. Returns the previous one.
    pub fn install(self) -> RecentAtoms {
        RecentAtoms(RECENT.replace(self.0))
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

/// An `Interner` for those who cannot name the lifetime of its session, in which it is invariant.
pub trait Intern: Sync {
    fn intern(&self, text: &[u8]) -> Atom;
    fn bytes(&self, atom: Atom) -> &[u8];
    /// See `Interner::number`.
    fn number(&self) -> u64;
}

impl Intern for Interner<'_> {
    #[inline]
    fn intern(&self, text: &[u8]) -> Atom {
        Interner::intern(self, text)
    }
    #[inline]
    fn bytes(&self, atom: Atom) -> &[u8] {
        Interner::bytes(self, atom)
    }
    #[inline]
    fn number(&self) -> u64 {
        Interner::number(self)
    }
}

impl<'s> Interner<'s> {
    pub fn new_in(session: &'s Session) -> Self {
        let shards = std::array::from_fn(|_| GrowingPlaces::new_in(session));
        let this = Interner {
            session,
            shards: Box::new_in(shards, session),
            texts: AppendVec::new_in(session),
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

    /// For the merge at the barrier.
    pub(crate) fn halves(&self) -> (&[GrowingPlaces<&'s Session>], &Texts<'s>) {
        (&self.shards[..], &self.texts)
    }

    pub fn session(&self) -> &'s Session {
        self.session
    }

    /// Sequence number of this interner among all that have been created: data cached for one
    /// interner is invalid for another.
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
        RECENT.with_borrow_mut(|recent| {
            // Nothing in this scope re-enters it.
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
            || {
                let text = ArenaBox::copy_from_slice_in(text, self.session.arena());
                self.texts.push(text)
            },
        ))
    }

    /// The atom of `text`, if it has been interned.
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

    /// The name of the property `[Symbol.name]` (`getPropertyNameForKnownSymbolName`). Given
    /// `name@id`, the name of the property keyed by a `unique symbol`
    /// (`getESSymbolLikeTypeForNode`).
    pub fn symbol_name(&self, name: &[u8]) -> Atom {
        self.intern(&[SYMBOL_NAME_PREFIX, name].concat())
    }

    /// `isLateBoundName`
    #[inline]
    pub fn is_symbol_name(&self, atom: Atom) -> bool {
        atom.is_some() && self.bytes(atom).starts_with(SYMBOL_NAME_PREFIX)
    }

    /// `EscapeInternalSymbolName`: the byte that no text contains is printed as `__`.
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

/// The published atoms and the task-local ones, which is everything a task can see.
/// `Checker::atoms` creates one.
#[derive(Copy, Clone)]
pub struct Atoms<'p, 's> {
    published: &'p Interner<'s>,
    own: &'p OwnStore<'s>,
}

impl<'p, 's> Atoms<'p, 's> {
    #[inline(always)]
    pub fn new(published: &'p Interner<'s>, own: &OwnStore<'s>) -> Atoms<'p, 's> {
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

/// The number whose decimal notation is `text`.
pub fn parse_number(text: &[u8]) -> Option<f64> {
    bun_core::fmt::parse_f64(text)
}

/// `String(n)`, which is the property name of a number.
pub fn number_to_string(n: f64) -> Vec<u8> {
    bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], n).to_vec()
}
