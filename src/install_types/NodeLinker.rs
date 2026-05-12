//! Extracted from `install/PackageManager/PackageManagerOptions.zig` so
//! `options_types/schema.zig`, `cli/bunfig.zig`, and `ini/` can name the
//! linker mode without depending on the full package manager.

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

// ported from: src/install_types/NodeLinker.zig

// ══════════════════════════════════════════════════════════════════════════
// npm::Registry constants
// Ground truth: src/install/npm.zig — Registry.default_url / default_url_hash
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
        // TODO(port): once bun_wyhash::Wyhash11::hash is `const fn`, fold this
        // back to a `pub const`. For now compute on first use.
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
// Ground truth: src/install/PnpmMatcher.zig
// https://github.com/pnpm/pnpm/blob/3abd3946237aa6ba7831552310ec371ddd3616c2/config/matcher/src/index.ts
//
// `ini` (T3) constructs PnpmMatcher from .npmrc `public-hoist-pattern` /
// `hoist-pattern`. Moved down from `bun_install` so the npmrc loader does not
// depend on the full package manager.
//
// The Zig source calls `jsc.RegularExpression` (tier-6) directly. That edge is
// broken with link-time `extern "Rust"` (`__bun_regex_*`) defined `#[no_mangle]`
// in `bun_jsc::regular_expression`.
// ══════════════════════════════════════════════════════════════════════════

use core::ptr::NonNull;

use bun_alloc::{AllocError, Arena};
use bun_ast as ast;
use bun_core::escape_reg_exp::escape_reg_exp_for_package_name_matching;
use bun_core::{String as BunString, strings};

// LAYERING: `bun_jsc::RegularExpression` (Yarr FFI) lives in a higher tier.
// Zig called it inline. The bodies are defined `#[no_mangle]` in
// `bun_jsc::regular_expression`; declared here as `extern "Rust"` and
// resolved at link time.
unsafe extern "Rust" {
    /// Compile `pattern` with no flags. `None` ⇔ `error.InvalidRegExp`.
    /// Performs `jsc::initialize(false)` lazily on first call.
    fn __bun_regex_compile(pattern: BunString) -> Option<NonNull<()>>;
    fn __bun_regex_matches(regex: NonNull<()>, input: &BunString) -> bool;
    fn __bun_regex_drop(regex: NonNull<()>);
}

/// Owned, type-erased JSC regex; drops through the vtable.
// FORWARD_DECL(b0): bun_jsc::RegularExpression — stored as raw NonNull<()>
// (NOT Box<ZST>: a zero-sized opaque Box is a dangling sentinel that would
// leak the real JSC allocation and skip its destructor).
pub struct RegularExpression(NonNull<()>);

impl RegularExpression {
    #[inline]
    pub fn matches(&self, input: &BunString) -> bool {
        // SAFETY: self.0 was produced by `__bun_regex_compile`.
        unsafe { __bun_regex_matches(self.0, input) }
    }
}

impl Drop for RegularExpression {
    fn drop(&mut self) {
        // SAFETY: self.0 was produced by `__bun_regex_compile`; runs JSC destructor + free.
        unsafe { __bun_regex_drop(self.0) }
    }
}

/// Compile `pattern` into a Yarr regex via the link-time extern. `pub` so
/// higher-tier callers re-use this single declaration site instead of
/// duplicating the `__bun_regex_*` extern block (one declarer per upward call,
/// per PORTING.md §extern-Rust-ban).
#[inline]
pub fn compile_regex(pattern: BunString) -> Option<RegularExpression> {
    // SAFETY: link-time extern; pattern ownership transfers.
    unsafe { __bun_regex_compile(pattern) }.map(RegularExpression)
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
    // B-2 UN-GATED: bun_ast::ExprData now exposes the real value-shaped
    // enum (`EString`/`EArray` via `StoreRef<E::*>`). `match` arms reconciled
    // against the arena-taking `E::String::slice` / `Expr::as_string_cloned`
    // signatures — Zig's `allocator` param maps to a local `bun_alloc::Arena`
    // (PORTING.md §Allocators: AST=bumpalo) used only for transient UTF-16→UTF-8
    // transcoding inside `slice`/`string_cloned`.
    pub fn from_expr(
        expr: &ast::Expr,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
    ) -> Result<PnpmMatcher, FromExprError> {
        let mut buf: Vec<u8> = Vec::new();
        // Scratch arena for `E::String::slice` / `as_string_cloned` (Zig passed
        // `allocator`). Freed on return; the patterns are consumed by
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

        // PORT NOTE: Zig `bun.String.fromBytes(name)`. `from_bytes` not yet on
        // bun_string surface; package names are ASCII so `borrow_utf8` is an
        // equivalent zero-copy borrow for the regex match call.
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

    // Writer.Allocating can only fail with OutOfMemory; Vec::push aborts on
    // OOM under the global mimalloc allocator, so the explicit error mapping
    // from the Zig source collapses. `escape_reg_exp_*` writes through
    // `io::Write` for `Vec<u8>`, which is infallible.
    buf.push(b'^');
    let _ = escape_reg_exp_for_package_name_matching(trimmed, buf);
    buf.push(b'$');

    // PERF(port): was inline `jsc::RegularExpression.init(.cloneUTF8(buf), .none)`
    // — now link-time `__bun_regex_compile` (cold path). The Zig source
    // unconditionally calls `bun.jsc.initialize(false)` before compiling; the
    // extern impl does the same.
    let regex = compile_regex(BunString::clone_utf8(buf.as_slice()))
        .ok_or(CreateMatcherError::InvalidRegExp)?;

    Ok(Matcher {
        pattern: Pattern::Regex(regex),
        is_exclude,
    })
}

// ported from: src/install/PnpmMatcher.zig
