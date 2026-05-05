//! https://github.com/pnpm/pnpm/blob/3abd3946237aa6ba7831552310ec371ddd3616c2/config/matcher/src/index.ts

use core::ptr::{null_mut, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_alloc::AllocError;
use bun_js_parser::ast;
use bun_logger as logger;
use bun_str::{strings, String as BunString};

// FORWARD_DECL(b0): bun_jsc::RegularExpression — opaque heap-allocated JSC regex.
// Stored as raw NonNull<()> (NOT Box<ZST> — Box over a zero-sized opaque is a dangling
// sentinel that would leak the real JSC allocation and skip its destructor).
// All construct / match / drop go through the registered vtable (tier-6 owns impl).
pub struct RegexVTable {
    /// Compile a pattern (flags are always `None` at every install call site).
    /// Performs jsc::initialize(false) lazily on first call.
    pub compile: unsafe fn(pattern: BunString) -> Option<NonNull<()>>,
    pub matches: unsafe fn(regex: NonNull<()>, input: &BunString) -> bool,
    pub drop: unsafe fn(regex: NonNull<()>),
}

/// Hook: bun_runtime::init writes a `&'static RegexVTable`. Null = JSC unavailable
/// (e.g. `bun install` standalone path) → regex matchers compile to MatchAll fallback.
pub static REGEX_VTABLE: AtomicPtr<RegexVTable> = AtomicPtr::new(null_mut());

#[inline]
fn regex_vtable() -> Option<&'static RegexVTable> {
    let p = REGEX_VTABLE.load(Ordering::Acquire);
    if p.is_null() { None } else { Some(unsafe { &*p }) }
}

/// Erased owned JSC regex; drops through the vtable.
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
            // SAFETY: self.0 was produced by vt.compile; drop runs JSC destructor + free.
            unsafe { (vt.drop)(self.0) }
        }
    }
}

#[inline]
fn compile_regex(pattern: BunString) -> Option<RegularExpression> {
    let vt = regex_vtable()?;
    // SAFETY: vtable registered once at startup.
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
    fn from(_: AllocError) -> Self {
        Self::OutOfMemory
    }
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

        // jsc::initialize(false) is now performed lazily inside REGEX_COMPILE_HOOK (tier-6).

        let mut matchers: Vec<Matcher> = Vec::new();

        let mut has_include = false;
        let mut has_exclude = false;

        match &expr.data {
            ast::ExprData::EString(s) => {
                let pattern = s.slice();
                let matcher = match create_matcher(pattern, &mut buf) {
                    Ok(m) => m,
                    Err(CreateMatcherError::OutOfMemory) => return Err(FromExprError::OutOfMemory),
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
                                    format_args!("Invalid regex: {}", bstr::BStr::new(&pattern)),
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

        let behavior: Behavior = if !has_include {
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
                        Pattern::MatchAll => {
                            return true;
                        }
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
                        Pattern::MatchAll => {
                            return false;
                        }
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
    fn from(_: AllocError) -> Self {
        Self::OutOfMemory
    }
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
        return Ok(Matcher {
            pattern: Pattern::MatchAll,
            is_exclude,
        });
    }

    // Writer.Allocating can only fail with OutOfMemory; Vec::push aborts on OOM (global mimalloc).
    buf.push(b'^');
    strings::escape_reg_exp_for_package_name_matching(trimmed, buf);
    buf.push(b'$');

    // PERF(port): was inline jsc::RegularExpression::init — now indirect via REGEX_COMPILE_HOOK.
    let regex = compile_regex(BunString::clone_utf8(buf.as_slice()))
        .ok_or(CreateMatcherError::InvalidRegExp)?;

    Ok(Matcher {
        pattern: Pattern::Regex(regex),
        is_exclude,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PnpmMatcher.zig (204 lines)
//   confidence: medium
//   todos:      1
//   notes:      ast::ExprData variant names + logger::ErrorOpts shape are guesses; RegularExpression::init return type assumed Result<Box<_>, _>
// ──────────────────────────────────────────────────────────────────────────
