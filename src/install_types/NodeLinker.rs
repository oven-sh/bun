//! Extracted from `install/PackageManager/PackageManagerOptions.zig` so
//! `options_types/schema.zig`, `cli/bunfig.zig`, and `ini/` can name the
//! linker mode without depending on the full package manager.

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum NodeLinker {
    // If workspaces are used: isolated
    // If not: hoisted
    // Used when nodeLinker is absent from package.json/bun.lock/bun.lockb
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_types/NodeLinker.zig (25 lines)
//   confidence: high
//   todos:      0
//   notes:      variant names PascalCased; if @tagName is used elsewhere add #[derive(strum::IntoStaticStr)] with serialize attrs
// ──────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════
// MOVE-IN (CYCLEBREAK b0): npm::Registry constants
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
        pub const DEFAULT_URL: &'static [u8] = b"https://registry.npmjs.org/";

        /// `bun.Wyhash11.hash(0, strings.withoutTrailingSlash(default_url))`
        /// — i.e. hash of `b"https://registry.npmjs.org"` (no trailing `/`).
        // TODO(port): once bun_wyhash::Wyhash11::hash is `const fn`, fold this
        // back to a `pub const`. For now compute on first use.
        #[inline]
        pub fn default_url_hash() -> u64 {
            use bun_wyhash::Wyhash11;
            // strings.withoutTrailingSlash strips exactly one trailing '/'.
            Wyhash11::hash(0, &Self::DEFAULT_URL[..Self::DEFAULT_URL.len() - 1])
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// MOVE-IN (CYCLEBREAK b0): PnpmMatcher
// Ground truth: src/install/PnpmMatcher.zig
// https://github.com/pnpm/pnpm/blob/3abd3946237aa6ba7831552310ec371ddd3616c2/config/matcher/src/index.ts
//
// `ini` (T3) constructs PnpmMatcher from .npmrc `public-hoist-pattern` /
// `hoist-pattern`. Moved down from `bun_install` so the npmrc loader does not
// depend on the full package manager.
//
// The Zig source calls `jsc.RegularExpression` (tier-6) directly. That edge is
// broken with a one-shot vtable hook (PORTING.md §Dispatch / debug-hook):
// `bun_runtime::init()` registers REGEX_VTABLE; until then regex patterns
// degrade to `Pattern::MatchAll` (only reachable in `bun install` standalone
// where JSC is uninitialised anyway).
// ══════════════════════════════════════════════════════════════════════════

use core::ptr::{null_mut, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_alloc::AllocError;
// Expr/ExprData moved down from `bun_js_parser` → `bun_logger::ast` per
// CYCLEBREAK §→logger; install_types (≤T3) may depend on logger.
use bun_logger::{self as logger, ast};
use bun_str::{strings, String as BunString};

/// Erased `bun_jsc::RegularExpression` vtable. Registered once at startup by
/// `bun_runtime`; `compile` performs `jsc::initialize(false)` lazily.
pub struct RegexVTable {
    /// Compile `pattern` with no flags. `None` ⇔ `error.InvalidRegExp`.
    pub compile: unsafe fn(pattern: BunString) -> Option<NonNull<()>>,
    pub matches: unsafe fn(regex: NonNull<()>, input: &BunString) -> bool,
    pub drop: unsafe fn(regex: NonNull<()>),
}

/// Hook: tier-6 writes a leaked `&'static RegexVTable`. Null = JSC unavailable.
pub static REGEX_VTABLE: AtomicPtr<RegexVTable> = AtomicPtr::new(null_mut());

#[inline]
fn regex_vtable() -> Option<&'static RegexVTable> {
    let p = REGEX_VTABLE.load(Ordering::Acquire);
    if p.is_null() { None } else { Some(unsafe { &*p }) }
}

/// Owned, type-erased JSC regex; drops through the vtable.
// FORWARD_DECL(b0): bun_jsc::RegularExpression — stored as raw NonNull<()>
// (NOT Box<ZST>: a zero-sized opaque Box is a dangling sentinel that would
// leak the real JSC allocation and skip its destructor).
pub struct RegularExpression(NonNull<()>);

impl RegularExpression {
    #[inline]
    pub fn matches(&self, input: &BunString) -> bool {
        match regex_vtable() {
            // SAFETY: self.0 was produced by vt.compile.
            Some(vt) => unsafe { (vt.matches)(self.0, input) },
            None => false,
        }
    }
}

impl Drop for RegularExpression {
    fn drop(&mut self) {
        if let Some(vt) = regex_vtable() {
            // SAFETY: self.0 was produced by vt.compile; runs JSC destructor + free.
            unsafe { (vt.drop)(self.0) }
        }
    }
}

#[inline]
fn compile_regex(pattern: BunString) -> Option<RegularExpression> {
    let vt = regex_vtable()?;
    // SAFETY: vtable registered once at startup; pattern ownership transfers.
    unsafe { (vt.compile)(pattern) }.map(RegularExpression)
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

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FromExprError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidRegExp")]
    InvalidRegExp,
    #[error("UnexpectedExpr")]
    UnexpectedExpr,
}

impl From<AllocError> for FromExprError {
    fn from(_: AllocError) -> Self { Self::OutOfMemory }
}

impl From<CreateMatcherError> for FromExprError {
    fn from(e: CreateMatcherError) -> Self {
        match e {
            CreateMatcherError::OutOfMemory => Self::OutOfMemory,
            CreateMatcherError::InvalidRegExp => Self::InvalidRegExp,
        }
    }
}

impl From<FromExprError> for bun_core::Error {
    fn from(e: FromExprError) -> Self {
        match e {
            FromExprError::OutOfMemory => bun_core::err!(OutOfMemory),
            FromExprError::InvalidRegExp => bun_core::err!(InvalidRegExp),
            FromExprError::UnexpectedExpr => bun_core::err!(UnexpectedExpr),
        }
    }
}

impl PnpmMatcher {
    pub fn from_expr(
        expr: &ast::Expr,
        log: &mut logger::Log,
        source: &logger::Source,
    ) -> Result<PnpmMatcher, FromExprError> {
        let mut buf: Vec<u8> = Vec::new();

        // bun.jsc.initialize(false) is now performed lazily inside
        // REGEX_VTABLE.compile (tier-6 owns it).

        let mut matchers: Vec<Matcher> = Vec::new();
        let mut has_include = false;
        let mut has_exclude = false;

        match &expr.data {
            ast::ExprData::EString(s) => {
                let pattern = s.slice();
                let matcher = match create_matcher(pattern, &mut buf) {
                    Ok(m) => m,
                    Err(CreateMatcherError::OutOfMemory) => {
                        return Err(FromExprError::OutOfMemory)
                    }
                    Err(CreateMatcherError::InvalidRegExp) => {
                        log.add_error_fmt_opts(
                            format_args!("Invalid regex: {}", bstr::BStr::new(pattern)),
                            logger::ErrorOpts {
                                loc: expr.loc,
                                redact_sensitive_information: true,
                                source: Some(source),
                                ..Default::default()
                            },
                        )?;
                        return Err(FromExprError::InvalidRegExp);
                    }
                };
                has_include = has_include || !matcher.is_exclude;
                has_exclude = has_exclude || matcher.is_exclude;
                matchers.push(matcher);
            }
            ast::ExprData::EArray(patterns) => {
                for pattern_expr in patterns.slice() {
                    if let Some(pattern) = pattern_expr.as_string_cloned()? {
                        let matcher = match create_matcher(&pattern, &mut buf) {
                            Ok(m) => m,
                            Err(CreateMatcherError::OutOfMemory) => {
                                return Err(FromExprError::OutOfMemory)
                            }
                            Err(CreateMatcherError::InvalidRegExp) => {
                                log.add_error_fmt_opts(
                                    format_args!(
                                        "Invalid regex: {}",
                                        bstr::BStr::new(&pattern)
                                    ),
                                    logger::ErrorOpts {
                                        loc: pattern_expr.loc,
                                        redact_sensitive_information: true,
                                        source: Some(source),
                                        ..Default::default()
                                    },
                                )?;
                                return Err(FromExprError::InvalidRegExp);
                            }
                        };
                        has_include = has_include || !matcher.is_exclude;
                        has_exclude = has_exclude || matcher.is_exclude;
                        matchers.push(matcher);
                    } else {
                        log.add_error_opts(
                            "Expected a string",
                            logger::ErrorOpts {
                                loc: pattern_expr.loc,
                                redact_sensitive_information: true,
                                source: Some(source),
                                ..Default::default()
                            },
                        )?;
                        return Err(FromExprError::UnexpectedExpr);
                    }
                }
            }
            _ => {
                log.add_error_opts(
                    "Expected a string or an array of strings",
                    logger::ErrorOpts {
                        loc: expr.loc,
                        redact_sensitive_information: true,
                        source: Some(source),
                        ..Default::default()
                    },
                )?;
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

        let name_str = BunString::from_bytes(name);

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

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum CreateMatcherError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidRegExp")]
    InvalidRegExp,
}

impl From<AllocError> for CreateMatcherError {
    fn from(_: AllocError) -> Self { Self::OutOfMemory }
}

impl From<CreateMatcherError> for bun_core::Error {
    fn from(e: CreateMatcherError) -> Self {
        match e {
            CreateMatcherError::OutOfMemory => bun_core::err!(OutOfMemory),
            CreateMatcherError::InvalidRegExp => bun_core::err!(InvalidRegExp),
        }
    }
}

fn create_matcher(raw: &[u8], buf: &mut Vec<u8>) -> Result<Matcher, CreateMatcherError> {
    buf.clear();

    let mut trimmed = strings::trim(raw, strings::WHITESPACE_CHARS);

    let mut is_exclude = false;
    if strings::starts_with_char(trimmed, b'!') {
        is_exclude = true;
        trimmed = &trimmed[1..];
    }

    if trimmed == b"*" {
        return Ok(Matcher { pattern: Pattern::MatchAll, is_exclude });
    }

    // Writer.Allocating can only fail with OutOfMemory; Vec::push aborts on
    // OOM under the global mimalloc allocator, so the explicit error mapping
    // from the Zig source collapses.
    buf.push(b'^');
    strings::escape_reg_exp_for_package_name_matching(trimmed, buf);
    buf.push(b'$');

    // PERF(port): was inline `jsc::RegularExpression.init(.cloneUTF8(buf), .none)`
    // — now indirect through REGEX_VTABLE (cold path, vtable per PORTING.md §Dispatch).
    let regex = compile_regex(BunString::clone_utf8(buf.as_slice()))
        .ok_or(CreateMatcherError::InvalidRegExp)?;

    Ok(Matcher { pattern: Pattern::Regex(regex), is_exclude })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS (move-in additions)
//   source:     src/install/PnpmMatcher.zig (204 lines)
//               src/install/npm.zig (Registry.default_url / default_url_hash)
//   confidence: medium
//   todos:      2
//   notes:      ast::Expr/ExprData imported from bun_logger (post-CYCLEBREAK
//               home); jsc::RegularExpression erased behind REGEX_VTABLE hook
//               (tier-6 registers in bun_runtime::init — Pass C).
// ──────────────────────────────────────────────────────────────────────────
