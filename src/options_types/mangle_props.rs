//! Options for property-name mangling (`--mangle-props`).
//!
//! The parser turns each selected property name into an `E::NameOfSymbol`
//! that points at a `Symbol::Kind::MangledProp` symbol. The linker merges the
//! symbols of the same name across files and assigns the short names. This
//! module only decides *which* names are selected.

use core::cell::RefCell;
use core::ptr::NonNull;

use bun_collections::{StringHashMap, StringSet};
use bun_core::String as BunString;

// LAYERING: `bun_jsc::RegularExpression` (Yarr FFI) lives in a higher tier.
// The bodies are defined `#[no_mangle]` in `bun_jsc::regular_expression`;
// declared here as `extern "Rust"` and resolved at link time.
unsafe extern "Rust" {
    /// Compile `pattern` with the given Yarr flag bits. `None` ⇔ the pattern
    /// does not compile.
    fn __bun_regex_compile_with_flags(pattern: &BunString, flags: u16) -> Option<NonNull<()>>;
    fn __bun_regex_matches(regex: NonNull<()>, input: &BunString) -> bool;
    fn __bun_regex_drop(regex: NonNull<()>);
}

/// Yarr flag bits. Same layout as `bun_jsc::regular_expression::Flags`, which
/// is the layout of `JSC::Yarr::Flags`.
pub mod regexp_flags {
    pub const HAS_INDICES: u16 = 1 << 0;
    pub const GLOBAL: u16 = 1 << 1;
    pub const IGNORE_CASE: u16 = 1 << 2;
    pub const MULTILINE: u16 = 1 << 3;
    pub const DOT_ALL: u16 = 1 << 4;
    pub const UNICODE: u16 = 1 << 5;
    pub const UNICODE_SETS: u16 = 1 << 6;
    pub const STICKY: u16 = 1 << 7;

    /// Parse a JS `RegExp.prototype.flags` string. Unknown letters are
    /// ignored. `g` and `d` do not change whether a string matches, so they
    /// are dropped.
    pub fn from_js_flags(flags: &[u8]) -> u16 {
        let mut bits = 0u16;
        for &c in flags {
            bits |= match c {
                b'i' => IGNORE_CASE,
                b'm' => MULTILINE,
                b's' => DOT_ALL,
                b'u' => UNICODE,
                b'v' => UNICODE_SETS,
                b'y' => STICKY,
                _ => 0,
            };
        }
        bits
    }
}

/// Owned, type-erased compiled JSC regex; drops through the shim.
struct CompiledRegExp(NonNull<()>);

impl Drop for CompiledRegExp {
    fn drop(&mut self) {
        // SAFETY: `self.0` was produced by `__bun_regex_compile_with_flags`;
        // runs the JSC destructor + free.
        unsafe { __bun_regex_drop(self.0) }
    }
}

struct CompiledRegExpCacheEntry {
    source: Box<[u8]>,
    flags: u16,
    compiled: Option<CompiledRegExp>,
}

thread_local! {
    /// `Yarr::RegularExpression::match` writes into the shared pattern object,
    /// so one compiled regex must not be used from two threads at once. Each
    /// parse worker compiles its own copy, keyed by (source, flags). A build
    /// has at most two patterns (`include`, `exclude`), so a linear scan is
    /// fine.
    static COMPILED: RefCell<Vec<CompiledRegExpCacheEntry>> = const { RefCell::new(Vec::new()) };
}

/// A JavaScript `RegExp` as (source, flags), compiled lazily per thread.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegExpPattern {
    /// `RegExp.prototype.source`, UTF-8.
    pub source: Box<[u8]>,
    /// Yarr flag bits, see [`regexp_flags`].
    pub flags: u16,
}

impl RegExpPattern {
    pub fn new(source: &[u8], flags: u16) -> Self {
        Self {
            source: source.into(),
            flags,
        }
    }

    /// `RegExp.prototype.test(input)` with `lastIndex` 0. A pattern that does
    /// not compile never matches; callers validate the pattern up front
    /// (`bun_jsc::RegularExpression::init`) so this does not happen in
    /// practice.
    pub fn matches(&self, input: &[u8]) -> bool {
        COMPILED.with(|cache| {
            let mut cache = cache.borrow_mut();
            let index = match cache
                .iter()
                .position(|e| e.flags == self.flags && *e.source == *self.source)
            {
                Some(i) => i,
                None => {
                    // SAFETY: link-time extern; Yarr compiles the pattern and
                    // does not retain the `BunString`.
                    let compiled = unsafe {
                        __bun_regex_compile_with_flags(
                            &BunString::borrow_utf8(&self.source),
                            self.flags,
                        )
                    }
                    .map(CompiledRegExp);
                    cache.push(CompiledRegExpCacheEntry {
                        source: self.source.clone(),
                        flags: self.flags,
                        compiled,
                    });
                    cache.len() - 1
                }
            };
            match &cache[index].compiled {
                // SAFETY: `regex.0` was produced by
                // `__bun_regex_compile_with_flags` and stays live until the
                // cache entry drops (thread exit).
                Some(regex) => unsafe {
                    __bun_regex_matches(regex.0, &BunString::borrow_utf8(input))
                },
                None => false,
            }
        })
    }
}

/// One entry of the mangle cache: `mangled == None` means "never mangle this
/// name" (JS `false`), `Some(name)` pins the output name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MangleCacheEntry {
    pub original: Box<[u8]>,
    pub mangled: Option<Box<[u8]>>,
}

/// The mangle cache as it is returned from a build: the input entries in
/// input order, then every newly generated mapping in assignment order.
pub type MangleCache = Vec<MangleCacheEntry>;

/// These names have special meaning in the language. Mangling them would
/// change program behavior or produce invalid syntax, so they are never
/// mangled, whatever the options say.
pub fn is_permanently_reserved_prop(name: &[u8]) -> bool {
    matches!(name, b"__proto__" | b"constructor" | b"prototype")
}

/// `x["0"]` and `x[0]` are the same property. Only the string spelling can be
/// seen by the mangler, so digit-only names are never mangled.
fn is_digits_only(name: &[u8]) -> bool {
    !name.is_empty() && name.iter().all(u8::is_ascii_digit)
}

/// `minify.mangleProps` / `--mangle-props`.
pub struct MangleProps {
    /// A property name must match this pattern to be mangled.
    pub include: RegExpPattern,
    /// A property name that matches this pattern is never mangled, even if it
    /// matches `include` (`--reserve-props`).
    pub exclude: Option<RegExpPattern>,
    /// Exact property names that are never mangled.
    pub reserved: StringSet,
    /// Also mangle property names written as string literals in property
    /// positions: `x["name"]`, `{ "name": 1 }`, `"name" in x`
    /// (`--mangle-quoted`).
    pub quoted: bool,
    /// Input cache. `None` pins nothing. An entry with `mangled: None` is a
    /// name that is never mangled; an entry with `Some(name)` fixes the
    /// output name.
    pub cache: StringHashMap<Option<Box<[u8]>>>,
}

impl MangleProps {
    pub fn new(include: RegExpPattern) -> Self {
        Self {
            include,
            exclude: None,
            reserved: StringSet::new(),
            quoted: false,
            cache: StringHashMap::default(),
        }
    }

    /// Whether `name` is selected for mangling. Pure function of the options
    /// and the name, so the parser can memoize it per file.
    pub fn is_mangled(&self, name: &[u8]) -> bool {
        if is_permanently_reserved_prop(name) || is_digits_only(name) {
            return false;
        }
        if self.reserved.contains(name) {
            return false;
        }
        if let Some(cached) = self.cache.get(name) {
            if cached.is_none() {
                return false;
            }
        }
        if !self.include.matches(name) {
            return false;
        }
        if let Some(exclude) = &self.exclude {
            if exclude.matches(name) {
                return false;
            }
        }
        true
    }
}
