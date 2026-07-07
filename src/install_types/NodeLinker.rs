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
// Default registry constants
// Single source of truth for the default registry URL and its hash;
// `bun_install::npm::registry` re-exports them. `ini` (T3) and
// `options_types` need them without pulling in the full package manager.
// ══════════════════════════════════════════════════════════════════════════

pub mod registry_defaults {
    pub const DEFAULT_URL: &str = "https://registry.npmjs.org/";

    /// `bun.Wyhash11.hash(0, strings.withoutTrailingSlash(default_url))`
    /// — i.e. hash of `b"https://registry.npmjs.org"` (no trailing `/`).
    pub static DEFAULT_URL_HASH: std::sync::LazyLock<u64> = std::sync::LazyLock::new(|| {
        use bun_wyhash::Wyhash11;
        // strings.withoutTrailingSlash strips exactly one trailing '/'.
        Wyhash11::hash(0, &DEFAULT_URL.as_bytes()[..DEFAULT_URL.len() - 1])
    });
}

// ══════════════════════════════════════════════════════════════════════════
// PnpmMatcher
// Ground truth:
// https://github.com/pnpm/pnpm/blob/3abd3946237aa6ba7831552310ec371ddd3616c2/config/matcher/src/index.ts
//
// `ini` (T3) constructs PnpmMatcher from .npmrc `public-hoist-pattern` /
// `hoist-pattern`. Moved down from `bun_install` so the npmrc loader does not
// depend on the full package manager.
// ══════════════════════════════════════════════════════════════════════════

use bun_alloc::Arena;
use bun_ast as ast;
use bun_core::strings;

/// Anchored wildcard matcher. The pnpm hoist-pattern escape
/// (`escape_reg_exp_for_package_name_matching`) produces regexes that are
/// literal byte runs joined by `.*`, so matching reduces to ordered
/// substring search over the literal runs split on `*`.
pub struct WildcardPattern {
    segments: Box<[Box<[u8]>]>,
}

impl WildcardPattern {
    fn compile(pattern: &[u8]) -> WildcardPattern {
        WildcardPattern {
            segments: pattern
                .split(|&b| b == b'*')
                .map(<Box<[u8]>>::from)
                .collect(),
        }
    }

    pub(crate) fn matches(&self, name: &[u8]) -> bool {
        let segs = &self.segments;
        if segs.len() == 1 {
            return name == &*segs[0];
        }
        let first = &*segs[0];
        let last = &*segs[segs.len() - 1];
        if name.len() < first.len() + last.len()
            || !name.starts_with(first)
            || !name.ends_with(last)
        {
            return false;
        }
        let mut window = &name[first.len()..name.len() - last.len()];
        for seg in &segs[1..segs.len() - 1] {
            if seg.is_empty() {
                continue;
            }
            match strings::index_of(window, seg) {
                Some(i) => window = &window[i + seg.len()..],
                None => return false,
            }
        }
        true
    }
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
    Wildcard(WildcardPattern),
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
        // Scratch arena for `E::String::slice` / `as_string_cloned`.
        // Freed on return; the patterns are consumed by
        // `create_matcher` before then.
        let arena = Arena::new();

        let mut matchers: Vec<Matcher> = Vec::new();
        let mut has_include = false;
        let mut has_exclude = false;

        match expr.data {
            ast::ExprData::EString(mut s) => {
                let pattern = s.slice(&arena);
                let matcher = create_matcher(pattern);
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

        match self.behavior {
            Behavior::AllMatchersInclude => {
                for matcher in self.matchers.iter() {
                    match &matcher.pattern {
                        Pattern::MatchAll => return true,
                        Pattern::Wildcard(p) => {
                            if p.matches(name) {
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
                        Pattern::Wildcard(p) => {
                            if p.matches(name) {
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
                        Pattern::Wildcard(p) => {
                            if p.matches(name) {
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

    Matcher {
        pattern: Pattern::Wildcard(WildcardPattern::compile(trimmed)),
        is_exclude,
    }
}
