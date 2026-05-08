//! https://github.com/pnpm/pnpm/blob/3abd3946237aa6ba7831552310ec371ddd3616c2/config/matcher/src/index.ts

use bun_alloc::{AllocError, Arena};
use bun_js_parser::ast;
use bun_logger as logger;
use bun_string::{escape_reg_exp, strings, String as BunString};

// LAYERING: `bun_jsc::RegularExpression` (Yarr FFI) lives in a higher tier.
// The link-time extern + erased wrapper are declared **once** in
// `bun_install_types::NodeLinker` (lower tier on the install→jsc cycle); we
// re-import rather than re-declaring so the workspace has exactly one
// `__bun_regex_*` declarer.
pub use bun_install_types::NodeLinker::{compile_regex, RegularExpression};

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
    // PORT NOTE: Zig signature took `std.mem.Allocator param`; the Rust AST
    // accessors (`EString::slice` / `Expr::as_string_cloned`) need a `&Bump` for
    // UTF-16→UTF-8 conversion / rope flattening, so the param surfaces as `bump`.
    pub fn from_expr(
        bump: &Arena,
        expr: &ast::Expr,
        log: &mut logger::Log,
        source: &logger::Source,
    ) -> Result<PnpmMatcher, FromExprError> {
        let mut buf: Vec<u8> = Vec::new();

        // jsc::initialize(false) is now performed lazily inside `__bun_regex_compile` (tier-6).

        let mut matchers: Vec<Matcher> = Vec::new();

        let mut has_include = false;
        let mut has_exclude = false;

        match expr.data {
            ast::ExprData::EString(mut s) => {
                // PORT NOTE: Zig `e_string.slice(allocator)` = resolve_rope + string();
                // the gated Rust `EString::slice` is not live yet, so inline both calls.
                s.resolve_rope_if_needed(bump);
                let pattern = s.string(bump).expect("OOM");
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
                    if let Some(pattern) = pattern_expr.as_string_cloned(bump)? {
                        let matcher = match create_matcher(pattern, &mut buf) {
                            Ok(m) => m,
                            Err(CreateMatcherError::OutOfMemory) => {
                                return Err(FromExprError::OutOfMemory)
                            }
                            Err(CreateMatcherError::InvalidRegExp) => {
                                log.add_error_fmt_opts(
                                    format_args!("Invalid regex: {}", bstr::BStr::new(pattern)),
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
                            b"Expected a string",
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
                    b"Expected a string or an array of strings",
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

        let name_str = BunString::borrow_utf8(name);

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

#[derive(Debug, strum::IntoStaticStr)]
pub enum CreateMatcherError {
    OutOfMemory,
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

    // Writer.Allocating can only fail with OutOfMemory; Vec::push aborts on OOM (global mimalloc).
    buf.push(b'^');
    // io::Write on &mut Vec<u8> is infallible.
    let _ = escape_reg_exp::escape_reg_exp_for_package_name_matching(trimmed, buf);
    buf.push(b'$');

    // PERF(port): was inline jsc::RegularExpression::init — now link-time
    // `__bun_regex_compile`. Zig unconditionally `bun.jsc.initialize(false)`s,
    // so valid patterns always compile; the extern impl does the same.
    let regex = compile_regex(BunString::clone_utf8(buf.as_slice()))
        .ok_or(CreateMatcherError::InvalidRegExp)?;

    Ok(Matcher {
        pattern: Pattern::Regex(regex),
        is_exclude,
    })
}

// ported from: src/install/PnpmMatcher.zig
