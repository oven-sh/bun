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

// LAYERING: `bun_jsc::RegExpMatcher` (Yarr FFI) lives in a higher tier. The
// bodies are defined `#[no_mangle]` in `bun_jsc::regular_expression`; declared
// here as `extern "Rust"` and resolved at link time.
unsafe extern "Rust" {
    /// Compile a JavaScript RegExp from its `source` and `flags` strings.
    /// `None` ⇔ the pattern or the flags do not compile.
    fn __bun_regexp_matcher_create(pattern: &BunString, flags: &BunString) -> Option<NonNull<()>>;
    fn __bun_regexp_matcher_matches(matcher: NonNull<()>, input: &BunString) -> bool;
    fn __bun_regexp_matcher_destroy(matcher: NonNull<()>);
}

/// Owned, type-erased compiled JSC regex; drops through the shim.
struct CompiledRegExp(NonNull<()>);

impl Drop for CompiledRegExp {
    fn drop(&mut self) {
        // SAFETY: `self.0` was produced by `__bun_regexp_matcher_create`; runs
        // the JSC destructor + free.
        unsafe { __bun_regexp_matcher_destroy(self.0) }
    }
}

struct CompiledRegExpCacheEntry {
    pattern: RegExpPattern,
    compiled: Option<CompiledRegExp>,
}

/// A build has at most two patterns (`include`, `exclude`). A long-lived
/// process (`--watch`, a dev server) can see many builds with different
/// patterns, so the cache is cleared when it grows past this.
const COMPILED_CACHE_LIMIT: usize = 16;

thread_local! {
    /// A compiled matcher holds the interpreter's scratch memory, so one
    /// matcher must not be used from two threads at once. Each parse worker
    /// compiles its own copy, keyed by (source, flags).
    static COMPILED: RefCell<Vec<CompiledRegExpCacheEntry>> = const { RefCell::new(Vec::new()) };
}

/// A JavaScript `RegExp` as (source, flags), compiled lazily per thread.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegExpPattern {
    /// `RegExp.prototype.source`, UTF-8.
    pub source: Box<[u8]>,
    /// `RegExp.prototype.flags` (`"iu"`), ASCII. Every flag keeps its
    /// JavaScript meaning.
    pub flags: Box<[u8]>,
}

impl RegExpPattern {
    pub fn new(source: &[u8], flags: &[u8]) -> Self {
        Self {
            source: source.into(),
            flags: flags.into(),
        }
    }

    /// `RegExp.prototype.test(input)` with `lastIndex` 0. A pattern that does
    /// not compile never matches; callers validate the pattern up front
    /// (`bun_jsc::RegExpMatcher::validate`) so this does not happen in
    /// practice.
    pub fn matches(&self, input: &[u8]) -> bool {
        COMPILED.with(|cache| {
            let mut cache = cache.borrow_mut();
            let index = match cache.iter().position(|e| e.pattern == *self) {
                Some(i) => i,
                None => {
                    if cache.len() >= COMPILED_CACHE_LIMIT {
                        cache.clear();
                    }
                    // SAFETY: link-time extern; Yarr compiles the pattern and
                    // does not retain the `BunString`s.
                    let compiled = unsafe {
                        __bun_regexp_matcher_create(
                            &BunString::borrow_utf8(&self.source),
                            &BunString::borrow_utf8(&self.flags),
                        )
                    }
                    .map(CompiledRegExp);
                    cache.push(CompiledRegExpCacheEntry {
                        pattern: self.clone(),
                        compiled,
                    });
                    cache.len() - 1
                }
            };
            match &cache[index].compiled {
                // SAFETY: `matcher.0` was produced by
                // `__bun_regexp_matcher_create` and stays live until the cache
                // entry drops.
                Some(matcher) => unsafe {
                    __bun_regexp_matcher_matches(matcher.0, &BunString::borrow_utf8(input))
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

/// The mangle cache as it is returned from a build: the input entries sorted
/// by name, then every newly generated mapping in assignment order.
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
