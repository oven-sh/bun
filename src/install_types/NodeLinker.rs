//! Lets `options_types`, `cli/bunfig`, and `ini/` name the linker mode
//! without depending on the full package manager.

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum NodeLinker {
    // If workspaces are used: isolated
    // If not: hoisted
    // Used when nodeLinker is absent from package.json/bun.lock/bun.lockb
    #[default]
    Auto,

    Hoisted,
    Isolated,
}

impl NodeLinker {
    pub fn from_str(input: &[u8]) -> Option<NodeLinker> {
        if input == b"hoisted" {
            return Some(NodeLinker::Hoisted);
        }
        if input == b"isolated" {
            return Some(NodeLinker::Isolated);
        }
        None
    }
}

// ══════════════════════════════════════════════════════════════════════════
// npm::Registry constants
// Ground truth: src/install/npm.rs — Registry::DEFAULT_URL / default_url_hash
// `ini` (T3) and `options_types` need the default registry URL without
// pulling in the full `bun_install` package manager.
// ══════════════════════════════════════════════════════════════════════════

pub mod npm {
    /// Type-only stub for `bun_install::npm::Registry`. Only the compile-time
    /// constants live here; the full HTTP/manifest registry client stays in
    /// `bun_install`.
    pub struct Registry;

    impl Registry {
        pub const DEFAULT_URL: &'static str = "https://registry.npmjs.org/";

        /// `bun.Wyhash11.hash(0, strings.withoutTrailingSlash(default_url))`
        /// — i.e. hash of `b"https://registry.npmjs.org"` (no trailing `/`).
        // Computed on use because `bun_wyhash::Wyhash11::hash` is not a
        // `const fn` (only `Wyhash::hash_const` — a different algorithm —
        // exists). Cheap and cold; not worth a cached static.
        #[inline]
        pub fn default_url_hash() -> u64 {
            use bun_wyhash::Wyhash11;
            // strings.withoutTrailingSlash strips exactly one trailing '/'.
            Wyhash11::hash(
                0,
                &Self::DEFAULT_URL.as_bytes()[..Self::DEFAULT_URL.len() - 1],
            )
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// PnpmMatcher
// Ground truth:
// https://github.com/pnpm/pnpm/blob/3abd3946237aa6ba7831552310ec371ddd3616c2/config/matcher/src/index.ts
//
// `ini` (T3) constructs PnpmMatcher from .npmrc `public-hoist-pattern` /
// `hoist-pattern`. Moved down from `bun_install` so the npmrc loader does not
// depend on the full package manager.
//
// Calling `bun_jsc::RegularExpression` (tier-6) directly would invert the
// layering; that edge is broken with link-time `extern "Rust"`
// (`__bun_regex_*`) defined `#[no_mangle]` in `bun_jsc::regular_expression`.
// ══════════════════════════════════════════════════════════════════════════

use core::ptr::NonNull;

use bun_alloc::Arena;
use bun_ast as ast;
use bun_core::escape_reg_exp::escape_reg_exp_for_package_name_matching;
use bun_core::{String as BunString, strings};

// FORWARD_DECL(b0): this tier cannot name `bun_jsc::RegularExpression`, so it
// re-declares the handle. The two ZSTs meet only at the `extern "Rust"`
// boundary below, where both are a bare non-null pointer.
/// The JSC object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`RegularExpression`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// `JSC::Yarr::RegularExpression`. `&Self` is ABI-identical to a
        /// non-null `RegularExpression*` and carries no `noalias`/`readonly` —
        /// Yarr mutates its match state through it.
        pub struct RegularExpression;
    }
}

// `__bun_regex_compile` allocates and hands back the sole owning pointer. One
// `RegularExpression` handle owns exactly that allocation.
bun_opaque::foreign_owned!(sys::RegularExpression, __bun_regex_drop);

// LAYERING: the bodies live `#[no_mangle]` in the higher-tier
// `bun_jsc::regular_expression`; declared `extern "Rust"`, resolved at link time.
// `&sys::RegularExpression` is ABI-identical to the pointer they take.
unsafe extern "Rust" {
    /// Compile `pattern` with no flags. Null ⇔ `error.InvalidRegExp`.
    /// Performs `jsc::initialize(false)` lazily on first call.
    safe fn __bun_regex_compile(pattern: BunString) -> *mut sys::RegularExpression;
    safe fn __bun_regex_matches(regex: &sys::RegularExpression, input: &BunString) -> bool;
    // safe: runs the Yarr destructor + free. Giving the allocation back is not
    // exclusive access, so the receiver is `&`, not `&mut`.
    safe fn __bun_regex_drop(regex: &sys::RegularExpression);
}

/// Owned handle to a JSC `Yarr::RegularExpression`.
///
/// Holds the one ownership unit `__bun_regex_compile` produced; `Drop` gives it
/// back. [`Self::matches`] takes `&self`: Yarr mutates its match state through
/// the same pointer, so there is no `&mut self` to have.
#[repr(transparent)]
pub struct RegularExpression(bun_opaque::ForeignRef<sys::RegularExpression>);

/// Ownership plumbing.
impl RegularExpression {
    /// Adopt the allocation returned by `__bun_regex_compile`.
    ///
    /// # Safety
    /// `ptr` must be live and carry the sole ownership unit, which no other
    /// handle will give back.
    #[inline]
    pub unsafe fn adopt(ptr: NonNull<sys::RegularExpression>) -> Self {
        // SAFETY: caller transfers ownership.
        Self(unsafe { bun_opaque::ForeignRef::adopt(ptr) })
    }

    /// Adopt a nullable owning pointer; `None` on null.
    #[inline]
    fn adopt_ptr(ptr: *mut sys::RegularExpression) -> Option<Self> {
        // SAFETY: `__bun_regex_compile` returns a fresh allocation or null; it
        // already freed the handle on the invalid-pattern path.
        NonNull::new(ptr).map(|p| unsafe { Self::adopt(p) })
    }

    /// The JSC pointer, still owned by `self`.
    #[inline]
    pub fn as_ptr(&self) -> *mut sys::RegularExpression {
        self.0.as_ptr()
    }

    /// Hand our allocation to a foreign owner. Pairs with a later [`Self::adopt`].
    #[inline]
    pub fn leak(self) -> NonNull<sys::RegularExpression> {
        self.0.leak()
    }

    #[inline]
    fn raw(&self) -> &sys::RegularExpression {
        &self.0
    }
}

/// Matching. `&self`: Yarr mutates through the same pointer.
impl RegularExpression {
    #[inline]
    pub(crate) fn matches(&self, input: &BunString) -> bool {
        __bun_regex_matches(self.raw(), input)
    }
}

/// Compile `pattern` into a Yarr regex via the link-time extern. The single
/// declaration site for `__bun_regex_*`, so higher-tier callers do not
/// duplicate the extern block (one declarer per upward call, per PORTING.md
/// §extern-Rust-ban).
#[inline]
pub(crate) fn compile_regex(pattern: BunString) -> Option<RegularExpression> {
    RegularExpression::adopt_ptr(__bun_regex_compile(pattern))
}

pub struct PnpmMatcher {
    pub matchers: Box<[Matcher]>,
    pub behavior: Behavior,
}

pub struct Matcher {
    pub pattern: Pattern,
    pub is_exclude: bool,
}

pub enum Pattern {
    MatchAll,
    Regex(RegularExpression),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Behavior {
    AllMatchersInclude,
    AllMatchersExclude,
    HasExcludeAndIncludeMatchers,
}

#[derive(Debug, strum::IntoStaticStr)]
pub enum FromExprError {
    OutOfMemory,
    InvalidRegExp,
    UnexpectedExpr,
}
bun_core::impl_tag_error!(FromExprError);

bun_core::oom_from_alloc!(FromExprError);

impl From<CreateMatcherError> for FromExprError {
    fn from(e: CreateMatcherError) -> Self {
        match e {
            CreateMatcherError::OutOfMemory => Self::OutOfMemory,
            CreateMatcherError::InvalidRegExp => Self::InvalidRegExp,
        }
    }
}

bun_core::named_error_set!(FromExprError);

impl PnpmMatcher {
    // `bun_ast::ExprData` exposes the real value-shaped enum
    // (`EString`/`EArray` via `StoreRef<E::*>`). The arena-taking
    // `E::String::slice` / `Expr::as_string_cloned` signatures get a local
    // `bun_alloc::Arena` (PORTING.md §Allocators: AST=bumpalo) used only for
    // transient UTF-16→UTF-8 transcoding inside `slice`/`string_cloned`.
    pub fn from_expr(
        expr: &ast::Expr,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
    ) -> Result<PnpmMatcher, FromExprError> {
        let mut buf: Vec<u8> = Vec::new();
        // Scratch arena for `E::String::slice` / `as_string_cloned`.
        // Freed on return; the patterns are consumed by
        // `create_matcher` before then.
        let arena = Arena::new();

        // bun.jsc.initialize(false) is now performed lazily inside
        // `__bun_regex_compile` (tier-6 owns it).

        let mut matchers: Vec<Matcher> = Vec::new();
        let mut has_include = false;
        let mut has_exclude = false;

        match expr.data {
            ast::ExprData::EString(mut s) => {
                let pattern = s.slice(&arena);
                let matcher = match create_matcher(pattern, &mut buf) {
                    Ok(m) => m,
                    Err(CreateMatcherError::OutOfMemory) => return Err(FromExprError::OutOfMemory),
                    Err(CreateMatcherError::InvalidRegExp) => {
                        log.add_error_fmt_opts(
                            format_args!("Invalid regex: {}", bstr::BStr::new(pattern)),
                            bun_ast::AddErrorOptions {
                                loc: expr.loc,
                                redact_sensitive_information: true,
                                source: Some(source),
                                ..Default::default()
                            },
                        );
                        return Err(FromExprError::InvalidRegExp);
                    }
                };
                has_include = has_include || !matcher.is_exclude;
                has_exclude = has_exclude || matcher.is_exclude;
                matchers.push(matcher);
            }
            ast::ExprData::EArray(patterns) => {
                for pattern_expr in patterns.slice() {
                    if let Some(pattern) = pattern_expr.as_string_cloned(&arena)? {
                        let matcher = match create_matcher(pattern, &mut buf) {
                            Ok(m) => m,
                            Err(CreateMatcherError::OutOfMemory) => {
                                return Err(FromExprError::OutOfMemory);
                            }
                            Err(CreateMatcherError::InvalidRegExp) => {
                                log.add_error_fmt_opts(
                                    format_args!("Invalid regex: {}", bstr::BStr::new(pattern)),
                                    bun_ast::AddErrorOptions {
                                        loc: pattern_expr.loc,
                                        redact_sensitive_information: true,
                                        source: Some(source),
                                        ..Default::default()
                                    },
                                );
                                return Err(FromExprError::InvalidRegExp);
                            }
                        };
                        has_include = has_include || !matcher.is_exclude;
                        has_exclude = has_exclude || matcher.is_exclude;
                        matchers.push(matcher);
                    } else {
                        log.add_error_opts(
                            b"Expected a string",
                            bun_ast::AddErrorOptions {
                                loc: pattern_expr.loc,
                                redact_sensitive_information: true,
                                source: Some(source),
                                ..Default::default()
                            },
                        );
                        return Err(FromExprError::UnexpectedExpr);
                    }
                }
            }
            _ => {
                log.add_error_opts(
                    b"Expected a string or an array of strings",
                    bun_ast::AddErrorOptions {
                        loc: expr.loc,
                        redact_sensitive_information: true,
                        source: Some(source),
                        ..Default::default()
                    },
                );
                return Err(FromExprError::UnexpectedExpr);
            }
        }

        let behavior = if !has_include {
            Behavior::AllMatchersExclude
        } else if !has_exclude {
            Behavior::AllMatchersInclude
        } else {
            Behavior::HasExcludeAndIncludeMatchers
        };

        Ok(PnpmMatcher {
            matchers: matchers.into_boxed_slice(),
            behavior,
        })
    }

    pub fn is_match(&self, name: &[u8]) -> bool {
        if self.matchers.is_empty() {
            return false;
        }

        // Package names are ASCII, so
        // `borrow_utf8` is a zero-copy borrow for the regex match.
        let name_str = BunString::borrow_utf8(name);

        match self.behavior {
            Behavior::AllMatchersInclude => {
                for matcher in self.matchers.iter() {
                    match &matcher.pattern {
                        Pattern::MatchAll => return true,
                        Pattern::Regex(regex) => {
                            if regex.matches(&name_str) {
                                return true;
                            }
                        }
                    }
                }
                false
            }
            Behavior::AllMatchersExclude => {
                for matcher in self.matchers.iter() {
                    match &matcher.pattern {
                        Pattern::MatchAll => return false,
                        Pattern::Regex(regex) => {
                            if regex.matches(&name_str) {
                                return false;
                            }
                        }
                    }
                }
                true
            }
            Behavior::HasExcludeAndIncludeMatchers => {
                let mut matches = false;
                for matcher in self.matchers.iter() {
                    match &matcher.pattern {
                        Pattern::MatchAll => {
                            matches = !matcher.is_exclude;
                        }
                        Pattern::Regex(regex) => {
                            if regex.matches(&name_str) {
                                matches = !matcher.is_exclude;
                            }
                        }
                    }
                }
                matches
            }
        }
    }
}

#[derive(Debug, strum::IntoStaticStr)]
pub enum CreateMatcherError {
    OutOfMemory,
    InvalidRegExp,
}
bun_core::impl_tag_error!(CreateMatcherError);

bun_core::oom_from_alloc!(CreateMatcherError);

bun_core::named_error_set!(CreateMatcherError);

pub fn create_matcher(raw: &[u8], buf: &mut Vec<u8>) -> Result<Matcher, CreateMatcherError> {
    buf.clear();

    let mut trimmed = strings::trim(raw, &strings::WHITESPACE_CHARS);

    let mut is_exclude = false;
    if strings::starts_with_char(trimmed, b'!') {
        is_exclude = true;
        trimmed = &trimmed[1..];
    }

    if trimmed == b"*" {
        return Ok(Matcher {
            pattern: Pattern::MatchAll,
            is_exclude,
        });
    }

    // Vec::push aborts on
    // OOM under the global mimalloc allocator, so no error mapping is needed.
    // `escape_reg_exp_*` writes through
    // `io::Write` for `Vec<u8>`, which is infallible.
    buf.push(b'^');
    let _ = escape_reg_exp_for_package_name_matching(trimmed, buf);
    buf.push(b'$');

    // `__bun_regex_compile` is a link-time extern (cold path) and performs
    // `jsc::initialize(false)` before compiling.
    let regex = compile_regex(BunString::clone_utf8(buf.as_slice()))
        .ok_or(CreateMatcherError::InvalidRegExp)?;

    Ok(Matcher {
        pattern: Pattern::Regex(regex),
        is_exclude,
    })
}
