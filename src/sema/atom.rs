//! Interned names. One table for the whole program, filled from every parser thread.

use crate::util::{AppendVec, GrowingPlaces, SHARDS, shard_of, spread_hash};

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Atom(pub u32);

impl Atom {
    pub const NONE: Atom = Atom(u32::MAX);
    #[inline]
    pub fn is_none(self) -> bool {
        self == Atom::NONE
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
}

macro_rules! known_atoms {
    ($($name:ident = $text:literal,)*) => {
        /// Names the resolver itself looks for. Interned first, so their numbers are constants.
        #[allow(non_upper_case_globals)]
        pub mod known {
            use super::Atom;
            known_atoms!(@consts 0u32; $($name,)*);
            pub(super) const TEXTS: &[&str] = &[$($text),*];
            /// `[Symbol.iterator]` and `[Symbol.asyncIterator]` as names of properties. Interned right after `TEXTS`: no `str`
            /// holds their first byte.
            pub const sym_iterator: Atom = Atom(TEXTS.len() as u32);
            pub const sym_async_iterator: Atom = Atom(TEXTS.len() as u32 + 1);
        }
    };
    (@consts $n:expr; $name:ident, $($rest:ident,)*) => {
        pub const $name: Atom = Atom($n);
        known_atoms!(@consts $n + 1u32; $($rest,)*);
    };
    (@consts $n:expr;) => {};
}

known_atoms! {
    empty = "",
    default = "default",
    export_equals = "export=",
    returned = "return=",
    this = "this",
    undefined = "undefined",
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
    eval = "eval",
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
}

/// What the name of a property that a symbol names starts with: `InternalSymbolNamePrefix` and `@`. No text has the byte 0xFE in
/// it, so nothing that is written is such a name.
pub const SYMBOL_NAME_PREFIX: &[u8] = b"\xFE@";

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
        this
    }

    pub fn intern(&self, text: &[u8]) -> Atom {
        let spread = spread_hash(text);
        let shard = &self.shards[shard_of(spread)];
        if let Some(atom) = shard.find(spread, |i| &**self.texts.get(i) == text) {
            return Atom(atom);
        }
        Atom(shard.find_or_add(
            spread,
            |i| &**self.texts.get(i) == text,
            || self.texts.push(Box::from(text)),
            |i| spread_hash(&**self.texts.get(i)),
        ))
    }

    #[inline]
    pub fn intern_str(&self, text: &str) -> Atom {
        self.intern(text.as_bytes())
    }

    /// The atom of `text`, if anything interned it.
    pub fn lookup(&self, text: &[u8]) -> Option<Atom> {
        let spread = spread_hash(text);
        self.shards[shard_of(spread)]
            .find(spread, |i| &**self.texts.get(i) == text)
            .map(Atom)
    }

    #[inline]
    pub fn bytes(&self, atom: Atom) -> &[u8] {
        self.texts.get(atom.0)
    }

    /// The name of the property `[Symbol.name]` (`getPropertyNameForKnownSymbolName`). Given `name@id`, that of the property a
    /// `unique symbol` names (`getESSymbolLikeTypeForNode`).
    pub fn symbol_name(&self, name: &[u8]) -> Atom {
        self.intern(&[SYMBOL_NAME_PREFIX, name].concat())
    }

    /// The same, if anything interned it.
    pub fn lookup_symbol_name(&self, name: &[u8]) -> Option<Atom> {
        self.lookup(&[SYMBOL_NAME_PREFIX, name].concat())
    }

    /// `isLateBoundName`
    #[inline]
    pub fn is_symbol_name(&self, atom: Atom) -> bool {
        atom.is_some() && self.bytes(atom).starts_with(SYMBOL_NAME_PREFIX)
    }

    /// `EscapeInternalSymbolName`: the byte that no text has reads `__`.
    pub fn text(&self, atom: Atom) -> std::borrow::Cow<'_, str> {
        if atom.is_none() {
            return std::borrow::Cow::Borrowed("<none>");
        }
        match self.bytes(atom) {
            [0xFE, rest @ ..] => {
                std::borrow::Cow::Owned(format!("__{}", String::from_utf8_lossy(rest)))
            }
            bytes => String::from_utf8_lossy(bytes),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_atoms_have_their_text() {
        let i = Interner::new();
        assert_eq!(i.bytes(known::Promise), b"Promise");
        assert_eq!(i.intern(b"length"), known::length);
        let a = i.intern(b"somethingElse");
        assert_eq!(i.intern(b"somethingElse"), a);
        assert_eq!(i.bytes(a), b"somethingElse");
    }

    #[test]
    fn nothing_written_is_the_name_of_a_symbol() {
        let i = Interner::new();
        assert_eq!(i.bytes(known::sym_iterator), b"\xFE@iterator");
        assert_eq!(
            i.lookup_symbol_name(b"asyncIterator"),
            Some(known::sym_async_iterator)
        );
        assert!(i.is_symbol_name(known::sym_iterator));
        let written = i.intern(b"__@iterator");
        assert_ne!(written, known::sym_iterator);
        assert!(!i.is_symbol_name(written));
        assert_eq!(i.text(known::sym_iterator), "__@iterator");
    }
}

/// `String(n)`, which is the name a number goes by as a property.
pub fn number_to_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".to_owned()
    } else if n.is_infinite() {
        if n > 0.0 {
            "Infinity".to_owned()
        } else {
            "-Infinity".to_owned()
        }
    } else if n == 0.0 {
        "0".to_owned()
    } else if n.abs() >= 1e21 || n.abs() < 1e-6 {
        let text = format!("{n:e}");
        match text.split_once('e') {
            Some((mantissa, exponent)) if !exponent.starts_with('-') => {
                format!("{mantissa}e+{exponent}")
            }
            _ => text,
        }
    } else {
        format!("{n}")
    }
}
