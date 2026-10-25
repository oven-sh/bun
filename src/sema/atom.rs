//! Interned names. The whole program shares one table, which every parser thread fills. A task with
//! `Sharing::Publishes` also adds the texts it first sees during checking. In any other checker
//! such a text becomes a task-local atom (`OwnStore`).

use crate::local::LOCAL;
use crate::session::Session;
use crate::types::{OwnStore, Sharing};
use crate::util::memory::Cells;
use crate::util::{AppendVec, GrowingSlots, SHARDS, spread_hash};
use std::alloc::Global;
use std::sync::atomic::{AtomicU32, Ordering};

/// An interned name. Its number is its index in a list that every parser thread appends to, so it
/// differs from run to run. Never order anything by atom number. Whatever gets iterated is ordered
/// by declaration or by text.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct Atom(pub u32);

impl Atom {
    pub const NONE: Atom = Atom(u32::MAX);

    /// True if it's one of the words binder.go checks an `Identifier` for:
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
    /// True if a task created it and hasn't published it yet.
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

/// Texts of the atoms with constant numbers (`known`), indexed by number.
pub const KNOWN_TEXTS: &[&[u8]] = known::ALL_TEXTS;

/// A single-file interner numbers the texts that aren't in its file from here up. A multi-file
/// interner never reaches this number.
pub const FIRST_ATOM_NOT_IN_FILE: u32 = 1 << 29;

/// Locations of one file's atom texts, so that code reading many atoms avoids a virtual call for
/// each.
#[derive(Copy, Clone, Default)]
pub struct OwnTexts<'a> {
    spans: &'a [(u32, u32)],
    source: &'a [u8],
}

impl<'a> OwnTexts<'a> {
    /// Set in a span's start if the text isn't in the source.
    pub const NOT_IN_SOURCE: u32 = 1 << 31;

    /// `spans` is indexed by atom. Each entry is the text's start in `source` and its length.
    pub fn new(spans: &'a [(u32, u32)], source: &'a [u8]) -> Self {
        // A start with `NOT_IN_SOURCE` set has to be past the end of the source, so `in_source` misses.
        match source.len() <= Self::NOT_IN_SOURCE as usize {
            true => OwnTexts { spans, source },
            false => OwnTexts::default(),
        }
    }

    /// Returns the start and length of `atom`'s text, or `None` if the caller has to ask the
    /// interner.
    #[inline]
    pub fn span_of(&self, atom: Atom) -> Option<(u32, u32)> {
        self.spans.get(atom.0 as usize).copied()
    }

    #[inline]
    pub fn source(&self) -> &'a [u8] {
        self.source
    }

    /// Returns `atom`'s text if it's in the source verbatim, or `None` if the caller has to ask the
    /// interner.
    #[inline]
    pub fn in_source(&self, atom: Atom) -> Option<&'a [u8]> {
        let (start, len) = self.span_of(atom)?;
        self.source
            .get(start as usize..start as usize + len as usize)
    }
}

/// `Intern::number` for an interner that isn't an `Interner`.
pub fn next_interner_number() -> u64 {
    NEXT_NUMBER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

type Texts = AppendVec<Text>;

/// An atom's text. Nearly all texts are short and stored inline in the list. A separate allocation
/// for each would have to be freed one at a time, on a different thread than the one that allocated
/// it.
pub(crate) enum Text {
    Short {
        len: u8,
        bytes: [u8; Text::INLINE_LEN],
    },
    Long(Box<[u8]>),
}

impl Text {
    /// The most bytes that fit without making `Text` larger than `Long` needs.
    const INLINE_LEN: usize = 22;
}

const _: () = assert!(size_of::<Text>() == 24);

impl From<&[u8]> for Text {
    fn from(text: &[u8]) -> Text {
        if text.len() > Text::INLINE_LEN {
            return Text::Long(text.into());
        }
        let mut bytes = [0; Text::INLINE_LEN];
        bytes[..text.len()].copy_from_slice(text);
        Text::Short {
            len: text.len() as u8,
            bytes,
        }
    }
}

impl std::ops::Deref for Text {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        match self {
            Text::Short { len, bytes } => &bytes[..usize::from(*len)],
            Text::Long(text) => text,
        }
    }
}

#[derive(Copy, Clone)]
pub struct Interner<'s> {
    session: &'s Session,
    /// The atoms numbered `first` and up.
    tables: &'s Tables,
    /// The atoms numbered under `first`. See `over`. Other programs may add to this table
    /// concurrently.
    base: &'s Tables,
    first: u32,
    /// Sequence number of `tables` among all tables ever created. Every `intern` call reads it. In
    /// `Tables` it would be next to the length of `texts`, which every thread writes when it adds
    /// an atom, and that would cause false sharing.
    number: u64,
}

/// Allocated on the regular heap, without a lifetime parameter. They're written through a shared
/// reference, so a lifetime in them would make `Interner<'s>` invariant in `'s`, and it has to be
/// covariant (`assert_covariant`). The session owns them (`Session::keep`), so they outlive every program
/// that refers to them.
struct Tables {
    slots: Box<GrowingSlots<Global, SHARDS>>,
    texts: Texts,
    /// Class of each text (`class_of`), packed at `class::BITS` bits per text.
    classes: Cells<AtomicU32>,
    /// `Interner::in_common`
    is_shared: bool,
}

impl Tables {
    fn new(is_shared: bool) -> Tables {
        Tables {
            slots: Box::default(),
            texts: AppendVec::new(),
            classes: Cells::default(),
            is_shared,
        }
    }

    /// Stores the class of `text`, the text at `index` of `texts`. The thread that adds a text must call this before
    /// any other thread can see the atom. Nearly all texts have class 0, which needs no write.
    fn set_class(&self, index: u32, text: &[u8]) {
        let class = class_of(text);
        if class != 0 {
            let shifted = class << (index % class::PER_CELL * class::BITS);
            (self.classes.cell(index / class::PER_CELL)).fetch_or(shifted, Ordering::Relaxed);
        }
    }

    #[inline]
    fn class(&self, index: u32) -> u32 {
        let cell = self.classes.existing(index / class::PER_CELL);
        let classes = cell.map_or(0, |cell| cell.load(Ordering::Relaxed));
        classes >> (index % class::PER_CELL * class::BITS) & ((1 << class::BITS) - 1)
    }
}

/// Facts about a name that the checker can query without reading its text. A large program's texts don't fit in the CPU
/// cache, but these bits do.
mod class {
    /// The name starts with `SYMBOL_NAME_PREFIX`.
    pub(super) const IS_SYMBOL_NAME: u32 = 1;
    /// The name starts with `PRIVATE_NAME_PREFIX`.
    pub(super) const IS_PRIVATE_SYMBOL_NAME: u32 = 1 << 1;
    /// The name starts with `#`.
    pub(super) const STARTS_WITH_HASH: u32 = 1 << 2;
    /// `is_numeric_literal_name`
    pub(super) const IS_NUMERIC: u32 = 1 << 3;
    pub(super) const BITS: u32 = 4;
    pub(super) const PER_CELL: u32 = u32::BITS / BITS;
}

/// Returns the `class` bits for `text`.
fn class_of(text: &[u8]) -> u32 {
    match text {
        [0xFE, b'@', ..] => class::IS_SYMBOL_NAME,
        [0xFE, b'#', ..] => class::IS_PRIVATE_SYMBOL_NAME,
        [b'#', ..] => class::STARTS_WITH_HASH,
        _ if is_numeric_literal_name(text) => class::IS_NUMERIC,
        _ => 0,
    }
}

/// `isNumericLiteralName`: true if the name round-trips through a number and back to a string.
fn is_numeric_literal_name(text: &[u8]) -> bool {
    // A number's string form starts with a digit or `-`, or is `Infinity` or `NaN`.
    match text.first().copied() {
        Some(b'0'..=b'9') => {
            // An `f64` represents an integer this short exactly, so it prints as the same digits.
            if text.len() <= 15 && text.iter().all(u8::is_ascii_digit) {
                return text[0] != b'0' || text.len() == 1;
            }
        }
        Some(b'-') => {}
        Some(b'I') => return text == b"Infinity",
        Some(b'N') => return text == b"NaN",
        _ => return false,
    }
    std::str::from_utf8(text)
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .is_some_and(|n| number_to_string(n) == text)
}

/// Compiles only if `Interner<'s>` is covariant in `'s`, which lets an interner that outlives a
/// program serve as that program's interner.
fn assert_covariant<'short, 'long: 'short>(atoms: Interner<'long>) -> Interner<'short> {
    atoms
}
const _: fn(Interner<'static>) -> Interner<'static> = assert_covariant;

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
            pub(super) const ALL_TEXTS: &[&[u8]] = &[
                $($text.as_bytes(),)*
                b"\xFE@iterator",
                b"\xFE@asyncIterator",
                b"\xFEglobal",
            ];
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
    // `Atom::is_keyword_identifier` covers the range from here to `arguments`.
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
    // Names that lint rules look for.
    callee = "callee",
    caller = "caller",
    __proto__ = "__proto__",
    __iterator__ = "__iterator__",
    hasOwnProperty = "hasOwnProperty",
    isPrototypeOf = "isPrototypeOf",
    propertyIsEnumerable = "propertyIsEnumerable",
    NaN = "NaN",
    console = "console",
    Infinity = "Infinity",
    window = "window",
    self_ = "self",
    Math = "Math",
    JSON = "JSON",
    Atomics = "Atomics",
    Intl = "Intl",
    Temporal = "Temporal",
    process = "process",
    Buffer = "Buffer",
    parseInt = "parseInt",
    alert = "alert",
    confirm = "confirm",
    prompt = "prompt",
    setTimeout = "setTimeout",
    setInterval = "setInterval",
    execScript = "execScript",
}

/// Name prefix of a symbol-keyed property: `InternalSymbolNamePrefix` and `@`. Source text never
/// contains the byte 0xFE, so no name in the source collides with one.
pub const SYMBOL_NAME_PREFIX: &[u8] = b"\xFE@";

/// Name prefix of a property that a class declares as `#x` (`GetSymbolNameForPrivateIdentifier`):
/// `InternalSymbolNamePrefix` and `#`. The string key `"#x"` is a different name.
pub const PRIVATE_NAME_PREFIX: &[u8] = b"\xFE#";

/// `SymbolName`: returns the `#x` of a private name, which is stored as `\xFE#x@<class>`. Returns
/// any other name unchanged.
pub fn written_name(name: &[u8]) -> &[u8] {
    if !name.starts_with(PRIVATE_NAME_PREFIX) {
        return name;
    }
    let private_name = &name[1..];
    &private_name
        [..bun_core::strings::index_of_char_usize(private_name, b'@').unwrap_or(private_name.len())]
}

/// Per-thread cache of recently seen names, with the text stored inline. A file repeats the same
/// few names, and a lookup in the shared table touches three distant memory locations.
struct Recent {
    /// `Interner::number`
    interner_number: u64,
    entries: Vec<RecentEntry>,
}

#[derive(Copy, Clone)]
struct RecentEntry {
    /// See `pack_short`.
    start: (u64, u64, u64),
    end: u32,
    atom: u32,
}

impl Recent {
    /// Doesn't belong to any interner, since interner numbers start at 1. The entries are allocated
    /// on first use.
    const EMPTY: Recent = Recent {
        interner_number: 0,
        entries: Vec::new(),
    };
    const MAX_PACKED_LEN: usize = 27;
    const BITS: u32 = 11;
    /// No text has this length.
    const EMPTY_ENTRY: RecentEntry = RecentEntry {
        start: (0, 0, 0),
        end: u32::MAX,
        atom: 0,
    };
}

/// Up to eight bytes of `text`, starting at `from`, as an integer. Missing bytes are zero.
#[inline]
pub fn word(text: &[u8], from: usize) -> u64 {
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

/// Packs a text of at most `Recent::MAX_PACKED_LEN` bytes into integers: the bytes padded with zeros, with
/// the length in the last byte.
#[inline]
fn pack_short(text: &[u8]) -> ((u64, u64, u64), u32) {
    (
        (word(text, 0), word(text, 8), word(text, 16)),
        word(text, 24) as u32 | (text.len() as u32) << 24,
    )
}

/// The lookup key of a text.
#[inline]
pub(crate) fn hash_of(text: &[u8]) -> u64 {
    if text.len() > Recent::MAX_PACKED_LEN {
        spread_hash(text)
    } else {
        spread_hash(&pack_short(text))
    }
}

thread_local! {
    static RECENT: std::cell::RefCell<Recent> = const { std::cell::RefCell::new(Recent::EMPTY) };
}

/// The calling thread's cache of recently interned atoms. A pool thread outlives a check, so the
/// check owns the cache, and a thread only has one installed while it works for that check.
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

/// Starts at 1.
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

/// An `Interner` for code that can't name its session's lifetime.
// No `impl` marks a method `#[inline]`. An inline method that's only reached through `&dyn Intern`
// would be compiled again in every crate that builds the vtable.
pub trait Intern: Sync {
    fn intern(&self, text: &[u8]) -> Atom;
    /// Returns `text`'s atom if it has one, without interning. A single-file interner only finds
    /// texts that are in the file.
    fn find(&self, text: &[u8]) -> Option<Atom>;
    fn bytes(&self, atom: Atom) -> &[u8];
    /// See `Interner::number`.
    fn number(&self) -> u64;
    /// Returns the calling thread's interner, which saves the thread lookup on every call.
    fn for_current_thread(&self) -> &dyn Intern;
    /// Empty unless this is a single-file interner.
    fn own_texts(&self) -> OwnTexts<'_> {
        OwnTexts::default()
    }
}

impl Intern for Interner<'_> {
    fn intern(&self, text: &[u8]) -> Atom {
        Interner::intern(self, text)
    }
    fn find(&self, text: &[u8]) -> Option<Atom> {
        self.lookup(text)
    }
    fn bytes(&self, atom: Atom) -> &[u8] {
        Interner::bytes(self, atom)
    }
    fn number(&self) -> u64 {
        Interner::number(self)
    }
    fn for_current_thread(&self) -> &dyn Intern {
        self
    }
}

/// One interner per thread, for work where atoms never cross threads. Only the thread that interns
/// a text writes or reads it.
pub struct InternerPerThread<'s> {
    all: Box<[Interner<'s>]>,
    /// The first interner's `Interner::number`.
    number: u64,
    /// How many threads have been assigned an interner.
    threads: std::sync::atomic::AtomicUsize,
}

thread_local! {
    /// The `InternerPerThread::number` this thread used last, and the index of the thread's
    /// interner in it.
    static OWN: std::cell::Cell<(u64, usize)> = const { std::cell::Cell::new((0, 0)) };
}

impl<'s> InternerPerThread<'s> {
    /// Creates one interner per session. `sessions` must not be empty. If there are more threads
    /// than sessions, threads share interners.
    pub fn new_in(sessions: &'s [Session]) -> Self {
        let all: Box<[Interner<'s>]> = sessions.iter().map(Interner::new_in).collect();
        InternerPerThread {
            number: all.first().map_or(0, Interner::number),
            all,
            threads: Default::default(),
        }
    }

    /// The calling thread's interner.
    #[inline]
    fn own(&self) -> &Interner<'s> {
        let (owner_number, at) = OWN.get();
        match self.all.get(at) {
            Some(own) if owner_number == self.number => own,
            _ => self.assign(),
        }
    }

    #[cold]
    #[inline(never)]
    fn assign(&self) -> &Interner<'s> {
        let thread_index = self
            .threads
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let at = thread_index % self.all.len();
        OWN.set((self.number, at));
        &self.all[at]
    }
}

impl Intern for InternerPerThread<'_> {
    fn intern(&self, text: &[u8]) -> Atom {
        self.own().intern(text)
    }
    fn find(&self, text: &[u8]) -> Option<Atom> {
        self.own().lookup(text)
    }
    fn bytes(&self, atom: Atom) -> &[u8] {
        self.own().bytes(atom)
    }
    fn number(&self) -> u64 {
        self.own().number()
    }
    fn for_current_thread(&self) -> &dyn Intern {
        self.own()
    }
}

impl<'s> Interner<'s> {
    /// For a single program, or for code that has no program.
    pub fn new_in(session: &'s Session) -> Self {
        Self::with_known_atoms(session, false)
    }

    /// Shared by several programs, which may add names to it concurrently while they load. A
    /// program isn't type-checked with it directly. The checker assumes that no other program adds
    /// atoms (`Atoms::find_published`, `TypeStore::link`), so each program layers its own interner
    /// on top with `over`.
    pub fn in_common(session: &'s Session) -> Self {
        Self::with_known_atoms(session, true)
    }

    fn with_known_atoms(session: &'s Session, is_shared: bool) -> Self {
        let tables = session.keep(Tables::new(is_shared));
        let this = Interner {
            session,
            tables,
            base: tables,
            first: 0,
            number: next_interner_number(),
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
        debug_assert!((KNOWN_TEXTS.iter().zip(0..)).all(|(text, i)| this.bytes(Atom(i)) == *text));
        this
    }

    /// Layers a private interner over `base`, which must be `in_common`. It sees the atoms that
    /// `base` has right now, with the same numbers, and numbers its own after them. No other
    /// interner sees those.
    pub fn over(session: &'s Session, base: Interner<'s>) -> Interner<'s> {
        assert!(base.tables.is_shared);
        let Tables { slots, texts, .. } = base.tables;
        Interner {
            session,
            tables: session.keep(Tables::new(false)),
            base: base.tables,
            // Texts are pushed under their shard's lock. With all shards locked, every text before
            // this length is complete.
            first: slots.with_all_locked(|| texts.len()),
            number: next_interner_number(),
        }
    }

    pub fn session(&self) -> &'s Session {
        self.session
    }

    /// Sequence number of this interner among all interners ever created. Data cached for one
    /// interner is invalid for another.
    #[inline]
    pub fn number(&self) -> u64 {
        self.number
    }

    pub fn intern(&self, text: &[u8]) -> Atom {
        if text.len() > Recent::MAX_PACKED_LEN {
            return self.intern_shared(hash_of(text), text);
        }
        let (start, end) = pack_short(text);
        let spread = spread_hash(&(start, end));
        RECENT.with_borrow_mut(|recent| {
            // Nothing in this closure borrows `RECENT` again.
            if recent.interner_number != self.number {
                recent.interner_number = self.number;
                match recent.entries.is_empty() {
                    true => recent.entries = vec![Recent::EMPTY_ENTRY; 1 << Recent::BITS],
                    false => recent.entries.fill(Recent::EMPTY_ENTRY),
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
        if let Some(atom) = self.find_in_base(spread, text) {
            return atom;
        }
        let Tables { slots, texts, .. } = self.tables;
        let matches = |i: u32| &**texts.get(i - self.first) == text;
        if let Some(atom) = slots.find(spread, matches) {
            return Atom(atom);
        }
        let add = || {
            let index = texts.push(text.into());
            self.tables.set_class(index, text);
            self.first + index
        };
        Atom(slots.find_or_add(spread, matches, add))
    }

    /// Returns the stored class of `atom`'s text.
    #[inline]
    fn class(&self, atom: Atom) -> u32 {
        match atom.0.checked_sub(self.first) {
            Some(own) => self.tables.class(own),
            None => self.base.class(atom.0),
        }
    }

    #[inline]
    fn find_in_base(&self, spread: u64, text: &[u8]) -> Option<Atom> {
        if self.first == 0 {
            return None;
        }
        let Tables { slots, texts, .. } = self.base;
        let matches = |i: u32| i < self.first && &**texts.get(i) == text;
        slots.find(spread, matches).map(Atom)
    }

    /// Returns `text`'s atom if it has been interned.
    pub fn lookup(&self, text: &[u8]) -> Option<Atom> {
        let spread = hash_of(text);
        let Tables { slots, texts, .. } = self.tables;
        let matches = |i: u32| &**texts.get(i - self.first) == text;
        let own = || slots.find(spread, matches).map(Atom);
        self.find_in_base(spread, text).or_else(own)
    }

    #[inline]
    pub fn bytes(&self, atom: Atom) -> &[u8] {
        debug_assert!(!atom.is_own(), "only `Atoms` can read a task-local atom");
        match atom.0.checked_sub(self.first) {
            Some(own) => self.tables.texts.get(own),
            None => self.base.texts.get(atom.0),
        }
    }

    /// Returns the property name for `[Symbol.name]` (`getPropertyNameForKnownSymbolName`). Given
    /// `name@id`, returns the name of the property keyed by a `unique symbol`
    /// (`getESSymbolLikeTypeForNode`).
    pub fn symbol_name(&self, name: &[u8]) -> Atom {
        self.intern(&[SYMBOL_NAME_PREFIX, name].concat())
    }
}

#[cfg(feature = "baselines")]
fn as_text(bytes: &[u8]) -> std::borrow::Cow<'_, str> {
    match bytes {
        [0xFE, rest @ ..] => std::borrow::Cow::Owned(format!("__{}", bstr::BStr::new(rest))),
        bytes => std::borrow::Cow::Owned(crate::messages::text(bytes)),
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
        // SAFETY: same as in `Types::new`.
        let own = unsafe { &*std::ptr::from_ref(own) };
        Atoms { published, own }
    }

    #[inline]
    fn find_published(&self, spread: u64, text: &[u8]) -> Option<Atom> {
        let Interner { tables, first, .. } = self.published;
        let matches = |i: u32| &**tables.texts.get(i - first) == text;
        // Other tasks may be adding atoms concurrently.
        let own = || tables.slots.find(spread, matches);
        let base = self.published.find_in_base(spread, text);
        base.or_else(|| own().map(Atom))
    }

    pub fn intern(&self, text: &[u8]) -> Atom {
        let spread = hash_of(text);
        match self.find_published(spread, text) {
            Some(atom) => atom,
            None if self.own.sharing() == Sharing::Publishes => {
                self.own.count_published_atom();

                self.published.intern_shared(spread, text)
            }
            None => self.own.intern_atom(spread, text),
        }
    }

    /// Returns `text`'s atom if it's published or this task created it.
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

    /// Returns `class_of` for `atom`'s text.
    #[inline]
    fn class(&self, atom: Atom) -> u32 {
        if atom.is_own() {
            return class_of(self.bytes(atom));
        }
        self.published.class(atom)
    }

    /// `isLateBoundName`
    #[inline]
    pub fn is_symbol_name(&self, atom: Atom) -> bool {
        atom.is_some() && self.class(atom) & class::IS_SYMBOL_NAME != 0
    }

    /// `IsPrivateIdentifierSymbol`: true if the name starts with `PRIVATE_NAME_PREFIX`.
    #[inline]
    pub fn is_private_symbol_name(&self, atom: Atom) -> bool {
        self.class(atom) & class::IS_PRIVATE_SYMBOL_NAME != 0
    }

    /// True if the name starts with `PRIVATE_NAME_PREFIX` or `#`.
    #[inline]
    pub fn is_private_name(&self, atom: Atom) -> bool {
        self.class(atom) & (class::IS_PRIVATE_SYMBOL_NAME | class::STARTS_WITH_HASH) != 0
    }

    /// `isNumericLiteralName`
    #[inline]
    pub fn is_numeric_name(&self, atom: Atom) -> bool {
        self.class(atom) & class::IS_NUMERIC != 0
    }

    /// `EscapeInternalSymbolName`: prints the 0xFE prefix byte as `__`.
    #[cfg(feature = "baselines")]
    pub fn text(&self, atom: Atom) -> std::borrow::Cow<'p, str> {
        if atom.is_none() {
            return std::borrow::Cow::Borrowed("<none>");
        }
        as_text(self.bytes(atom))
    }
}

/// `String(n)`, which is a number's property name.
pub fn number_to_string(n: f64) -> Vec<u8> {
    bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], n).to_vec()
}
