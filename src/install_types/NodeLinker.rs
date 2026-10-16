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

use core::cell::OnceCell;
use core::ptr::NonNull;

use bun_alloc::Arena;
use bun_ast as ast;
use bun_core::escape_reg_exp::escape_reg_exp_for_package_name_matching;
use bun_core::{String as BunString, strings};

// LAYERING: `bun_jsc::RegularExpression` (Yarr FFI) lives in a higher tier.
// The bodies are defined `#[no_mangle]` in
// `bun_jsc::regular_expression`; declared here as `extern "Rust"` and
// resolved at link time.
unsafe extern "Rust" {
    /// Compile `pattern` with no flags. `None` ⇔ the pattern does not compile.
    /// Initializes JSC first (idempotent), so it must only run from
    /// [`RegularExpression::matches`]; see the type's docs.
    fn __bun_regex_compile(pattern: &BunString) -> Option<NonNull<()>>;
    fn __bun_regex_matches(regex: NonNull<()>, input: &BunString) -> bool;
    fn __bun_regex_drop(regex: NonNull<()>);
}

/// Owned, type-erased compiled JSC regex; drops through the vtable.
// FORWARD_DECL(b0): bun_jsc::RegularExpression — stored as raw NonNull<()>
// (NOT Box<ZST>: a zero-sized opaque Box is a dangling sentinel that would
// leak the real JSC allocation and skip its destructor).
struct CompiledRegularExpression(NonNull<()>);

impl Drop for CompiledRegularExpression {
    fn drop(&mut self) {
        // SAFETY: self.0 was produced by `__bun_regex_compile`; runs JSC destructor + free.
        unsafe { __bun_regex_drop(self.0) }
    }
}

/// A package-name pattern, compiled on first use.
///
/// Matchers are built while bunfig.toml / .npmrc load, before the command
/// initializes JSC. `__bun_regex_compile` initializes JSC, and the first
/// `jsc::initialize` of the process fixes JSC's options, so compiling here
/// would drop the options the command passes later (`bun -p` needs eval mode
/// to keep the script's completion value, `bun test --isolate` its JIT
/// thresholds). Only the install linker matches, so compiling there leaves
/// the first call to the command.
pub struct RegularExpression {
    /// The anchored pattern built by [`create_matcher`].
    source: Box<[u8]>,
    /// `None` if the pattern failed to compile; it then never matches. The
    /// escaping in [`create_matcher`] leaves Yarr's pattern size limit as the
    /// only way to fail.
    compiled: OnceCell<Option<CompiledRegularExpression>>,
}

impl RegularExpression {
    fn matches(&self, input: &BunString) -> bool {
        let compiled = self.compiled.get_or_init(|| {
            // SAFETY: link-time extern; Yarr compiles the pattern and does not retain it.
            unsafe { __bun_regex_compile(&BunString::borrow_utf8(&self.source)) }
                .map(CompiledRegularExpression)
        });
        match compiled {
            // SAFETY: `regex.0` was produced by `__bun_regex_compile` and stays
            // live until `regex` drops.
            Some(regex) => unsafe { __bun_regex_matches(regex.0, input) },
            None => false,
        }
    }
}

pub struct PnpmMatcher {
    pub matchers: Box<[Matcher]>,
    pub behavior: Behavior,
}

pub struct Matcher {
    pub(crate) pattern: Pattern,
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
    UnexpectedExpr,
}
bun_core::impl_tag_error!(FromExprError);

bun_core::oom_from_alloc!(FromExprError);

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
        // Scratch arena for `E::String::slice` / `as_string_cloned`.
        // Freed on return; `create_matcher` copies the patterns before then.
        let arena = Arena::new();

        let mut matchers: Vec<Matcher> = Vec::new();
        let mut has_include = false;
        let mut has_exclude = false;

        match expr.data {
            ast::ExprData::EString(mut s) => {
                let matcher = create_matcher(s.slice(&arena));
                has_include = has_include || !matcher.is_exclude;
                has_exclude = has_exclude || matcher.is_exclude;
                matchers.push(matcher);
            }
            ast::ExprData::EArray(patterns) => {
                for pattern_expr in patterns.slice() {
                    if let Some(pattern) = pattern_expr.as_string_cloned(&arena)? {
                        let matcher = create_matcher(pattern);
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

pub fn create_matcher(raw: &[u8]) -> Matcher {
    let mut trimmed = strings::trim(raw, &strings::WHITESPACE_CHARS);

    let mut is_exclude = false;
    if strings::starts_with_char(trimmed, b'!') {
        is_exclude = true;
        trimmed = &trimmed[1..];
    }

    if trimmed == b"*" {
        return Matcher {
            pattern: Pattern::MatchAll,
            is_exclude,
        };
    }

    // `escape_reg_exp_*` writes through `io::Write` for `Vec<u8>`, which is
    // infallible.
    let mut source: Vec<u8> = Vec::with_capacity(trimmed.len() + 2);
    source.push(b'^');
    let _ = escape_reg_exp_for_package_name_matching(trimmed, &mut source);
    source.push(b'$');

    Matcher {
        pattern: Pattern::Regex(RegularExpression {
            source: source.into_boxed_slice(),
            compiled: OnceCell::new(),
        }),
        is_exclude,
    }
}
