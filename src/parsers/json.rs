//! JSON / JSONC parser.
//!
//! Two stages (see [`crate::json_index`] and [`crate::json_stage2`]):
//!
//!   1. a batched SIMD **structural indexer** (Highway, simdjson-style) finds
//!      every token boundary in one pass over the document
//!   2. a recursive-descent parser over the index array builds the `Expr` AST,
//!      taking strings zero-copy out of the source whenever stage 1 proved
//!      they contain no escape and no control character
//!
//! This file owns the public entry points (one per option preset / caller
//! family), the option type, the `.env`/`--define` auto-quote path, and the
//! `PackageJSONVersionChecker` helper.
//!
//! Supported beyond strict JSON, matching the previous lexer: comments and
//! trailing commas (gated by [`JSONOptions`]), single-quoted strings,
//! hex/octal/binary/underscore numeric literals, `\x`/`\v` escapes, BOM and
//! exotic unicode whitespace between tokens, duplicate-key warnings, and
//! indentation guessing.

use bun_alloc::Arena as Bump;

use bun_ast as js_ast;
use bun_ast::Indentation;
use bun_ast::{E, Expr};
use bun_collections::VecExt;
use bun_core::{self};

use crate::json_index::{self, IndexError, StructuralIndex};
use crate::json_stage2::Parser;

// ──────────────────────────────────────────────────────────────────────────
// JSONOptions
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct JSONOptions {
    /// Enable JSON-specific warnings/errors.
    pub is_json: bool,
    /// tsconfig.json supports comments & trailing commas.
    pub allow_comments: bool,
    pub allow_trailing_commas: bool,
    /// Loading JSON-in-JSON may start like `\"\"` — technically invalid; we
    /// parse from the first value of the string.
    pub ignore_leading_escape_sequences: bool,
    pub ignore_trailing_escape_sequences: bool,
    pub json_warn_duplicate_keys: bool,
    /// Mark as originally for a macro to enable inlining.
    pub was_originally_macro: bool,
    pub guess_indentation: bool,
    /// Produce the JSON-only compact containers (`E::ObjectSimple` /
    /// `E::ArraySimple`: 32-byte property rows whose leaves are inline
    /// `E::JsonValue`s, not `Expr` nodes) instead of `E::Object` /
    /// `E::Array`. Only for entry points whose consumers understand them
    /// (see the `E::ObjectSimple` docs); requires `force_utf8` strings.
    pub simple_objects: bool,
}

impl JSONOptions {
    pub const DEFAULT: JSONOptions = JSONOptions {
        is_json: false,
        allow_comments: false,
        allow_trailing_commas: false,
        ignore_leading_escape_sequences: false,
        ignore_trailing_escape_sequences: false,
        json_warn_duplicate_keys: true,
        was_originally_macro: false,
        guess_indentation: false,
        simple_objects: false,
    };
}

impl Default for JSONOptions {
    fn default() -> Self {
        Self::DEFAULT
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Option presets (one per entry point family)
// ──────────────────────────────────────────────────────────────────────────

const JSON_OPTS: JSONOptions = JSONOptions {
    is_json: true,
    ..JSONOptions::DEFAULT
};

const DOTENV_JSON_OPTS: JSONOptions = JSONOptions {
    is_json: true,
    allow_trailing_commas: true,
    ignore_leading_escape_sequences: true,
    ignore_trailing_escape_sequences: true,
    ..JSONOptions::DEFAULT
};

const TSCONFIG_OPTS: JSONOptions = JSONOptions {
    is_json: true,
    allow_comments: true,
    allow_trailing_commas: true,
    ..JSONOptions::DEFAULT
};

const MACRO_JSON_OPTS: JSONOptions = JSONOptions {
    is_json: true,
    allow_comments: true,
    allow_trailing_commas: true,
    json_warn_duplicate_keys: false,
    was_originally_macro: true,
    ..JSONOptions::DEFAULT
};

const PACKAGE_JSON_OPTS: JSONOptions = JSONOptions {
    is_json: true,
    allow_comments: true,
    allow_trailing_commas: true,
    ..JSONOptions::DEFAULT
};

// ──────────────────────────────────────────────────────────────────────────
// Shared driver
// ──────────────────────────────────────────────────────────────────────────

// Never mutated — `RacyCell` only because
// `StoreRef::from_raw` wants a `*mut T` and the payload types are `!Sync`.
static EMPTY_OBJECT: bun_core::RacyCell<E::Object> = bun_core::RacyCell::new(E::Object::EMPTY);

#[inline]
fn empty_object_expr() -> Expr {
    // EMPTY_OBJECT is a never-mutated static; `StoreRef::from_raw` checks
    // non-null and the static trivially outlives any Store reset.
    Expr {
        loc: bun_ast::Loc { start: 0 },
        data: js_ast::expr::Data::EObject(js_ast::StoreRef::from_raw(EMPTY_OBJECT.get())),
    }
}

/// Everything a full parse produces beyond the root expression.
struct ParseOutput {
    root: Expr,
    is_ascii_only: bool,
    indentation: Indentation,
}

/// Build the structural index, run stage 2, release the index.
fn parse_impl(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
    opts: JSONOptions,
    force_utf8: bool,
    check_len: bool,
) -> Result<ParseOutput, bun_core::Error> {
    let contents: &[u8] = &source.contents;

    let mut sidx = StructuralIndex::new(contents);
    let log_mark = (log.errors, log.warnings, log.msgs.len());
    let result = run_stage2(source, log, bump, &mut sidx, opts, force_utf8, check_len);

    // Index-layer errors take precedence: the index stream was truncated at
    // the offending byte, so whatever stage 2 logged about the truncated
    // document is noise. The old parser surfaced these before parsing at
    // all, with nothing else in the log.
    let drop_stage2_msgs = |log: &mut bun_ast::Log| {
        log.errors = log_mark.0;
        log.warnings = log_mark.1;
        log.msgs.truncate(log_mark.2);
    };
    if let Some(e) = sidx.index_error {
        drop_stage2_msgs(log);
        return Err(report_index_error(e, source, log));
    }
    // Comments are detected by the indexer (the index contains nothing for
    // their bytes) so a single stage 2 serves both modes.
    if !opts.allow_comments
        && let Some(range) = sidx.first_comment
    {
        drop_stage2_msgs(log);
        log.add_error_fmt_opts(
            format_args!("JSON does not support comments"),
            bun_ast::AddErrorOptions {
                source: Some(source),
                loc: range.loc,
                len: range.len,
                ..Default::default()
            },
        );
        return Err(bun_core::err!("SyntaxError"));
    }
    result
}

fn run_stage2<'s>(
    source: &'s bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
    sidx: &mut StructuralIndex<'s>,
    opts: JSONOptions,
    force_utf8: bool,
    check_len: bool,
) -> Result<ParseOutput, bun_core::Error> {
    debug_assert!(
        !opts.simple_objects || force_utf8,
        "simple_objects requires force_utf8 string handling"
    );
    let mut parser = Parser::new(source, log, bump, sidx, opts, force_utf8);
    let root = if opts.simple_objects {
        parser.parse_value::<true>()?
    } else {
        parser.parse_value::<false>()?
    };
    if check_len && !parser.at_trailing_end() {
        return Err(parser.unexpected_here());
    }
    let is_ascii_only = parser.is_ascii_only;
    drop(parser);
    let is_ascii_only = is_ascii_only
        && sidx.flags & (json_index::FLAG_HAS_BACKSLASH_IN_STRING | json_index::FLAG_HAS_NON_ASCII)
            == 0;
    Ok(ParseOutput {
        root,
        is_ascii_only,
        indentation: if opts.guess_indentation {
            guess_indentation(&source.contents)
        } else {
            Indentation::default()
        },
    })
}

#[cold]
fn report_index_error(
    err: IndexError,
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
) -> bun_core::Error {
    match err {
        IndexError::UnterminatedBlockComment => {
            log.add_error_fmt_opts(
                format_args!("Expected \"*/\" to terminate multi-line comment"),
                bun_ast::AddErrorOptions {
                    source: Some(source),
                    loc: bun_ast::usize2loc(source.contents.len()),
                    ..Default::default()
                },
            );
        }
        IndexError::UnexpectedSlash { pos } => {
            log.add_error_fmt_opts(
                format_args!("Unsupported syntax: Operators are not allowed in JSON"),
                bun_ast::AddErrorOptions {
                    source: Some(source),
                    loc: bun_ast::usize2loc(pos + 1),
                    ..Default::default()
                },
            );
        }
    }
    bun_core::err!("SyntaxError")
}

/// Port of the old lexer's indentation guesser: the first line (after a run
/// of newlines) that starts with a space or a tab determines the guess.
fn guess_indentation(s: &[u8]) -> Indentation {
    let mut i = 0;
    while i < s.len() {
        if s[i] == b'\n' {
            i += 1;
            while i < s.len() && (s[i] == b'\n' || s[i] == b'\r') {
                i += 1;
            }
            if i < s.len() && (s[i] == b' ' || s[i] == b'\t') {
                let character = if s[i] == b' ' {
                    bun_ast::IndentationCharacter::Space
                } else {
                    bun_ast::IndentationCharacter::Tab
                };
                let ch = s[i];
                let mut count = 0;
                while i < s.len() && s[i] == ch {
                    i += 1;
                    count += 1;
                }
                return Indentation {
                    character,
                    scalar: count,
                    ..Indentation::default()
                };
            }
            continue;
        }
        i += 1;
    }
    Indentation::default()
}

// ──────────────────────────────────────────────────────────────────────────
// Entry points
// ──────────────────────────────────────────────────────────────────────────

/// Parse JSON.
/// This leaves UTF-16 strings as UTF-16 strings (the printer handles both).
#[inline]
pub fn parse<const FORCE_UTF8: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    Ok(parse_impl(source, log, bump, JSON_OPTS, FORCE_UTF8, false)?.root)
}

/// Parse JSON, eagerly transcoding every string to UTF-8.
/// Use when the result may be re-printed as JSON (not as JavaScript).
pub fn parse_utf8(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    parse_utf8_impl::<false>(source, log, bump)
}

#[inline]
pub fn parse_utf8_impl<const CHECK_LEN: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    Ok(parse_impl(source, log, bump, JSON_OPTS, true, CHECK_LEN)?.root)
}

/// Parse a JSON document fetched from a registry/HTTP API (npm package
/// manifests): strict JSON, strings forced to UTF-8, and **no duplicate-key
/// warnings** — these documents are machine-generated, the warnings are never
/// surfaced to anyone, and computing them costs a measurable fraction of
/// every manifest parse. Containers are the compact read-only simple AST
/// (`E::ObjectSimple` / `E::ArraySimple` — see `JSONOptions::simple_objects`).
pub fn parse_utf8_registry(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    const REGISTRY_OPTS: JSONOptions = JSONOptions {
        is_json: true,
        json_warn_duplicate_keys: false,
        simple_objects: true,
        ..JSONOptions::DEFAULT
    };
    Ok(parse_impl(source, log, bump, REGISTRY_OPTS, true, false)?.root)
}

/// Parse package.json (comments & trailing commas allowed, strings UTF-8).
/// Deliberately the full `E::Object` AST: these callers (install, `bun pm pkg`,
/// lockfile, init) mutate and re-print the tree, which the read-only simple
/// containers cannot represent.
pub fn parse_package_json_utf8(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    Ok(parse_impl(source, log, bump, PACKAGE_JSON_OPTS, true, false)?.root)
}

#[derive(Default)]
pub struct JsonResult {
    pub root: Expr,
    pub indentation: Indentation,
}

/// Compile-time-options spelling kept for existing call sites; reifies the
/// flags into a runtime [`JSONOptions`] and forwards.
#[inline]
pub fn parse_package_json_utf8_with_opts<
    const IS_JSON: bool,
    const ALLOW_COMMENTS: bool,
    const ALLOW_TRAILING_COMMAS: bool,
    const IGNORE_LEADING_ESCAPE_SEQUENCES: bool,
    const IGNORE_TRAILING_ESCAPE_SEQUENCES: bool,
    const JSON_WARN_DUPLICATE_KEYS: bool,
    const WAS_ORIGINALLY_MACRO: bool,
    const GUESS_INDENTATION: bool,
>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<JsonResult, bun_core::Error> {
    parse_package_json_utf8_with_opts_rt(
        JSONOptions {
            is_json: IS_JSON,
            allow_comments: ALLOW_COMMENTS,
            allow_trailing_commas: ALLOW_TRAILING_COMMAS,
            ignore_leading_escape_sequences: IGNORE_LEADING_ESCAPE_SEQUENCES,
            ignore_trailing_escape_sequences: IGNORE_TRAILING_ESCAPE_SEQUENCES,
            json_warn_duplicate_keys: JSON_WARN_DUPLICATE_KEYS,
            simple_objects: false,
            was_originally_macro: WAS_ORIGINALLY_MACRO,
            guess_indentation: GUESS_INDENTATION,
        },
        source,
        log,
        bump,
    )
}

/// Runtime-options entry point. Prefer this over the const-generic shim above
/// for new code.
pub fn parse_package_json_utf8_with_opts_rt(
    opts: JSONOptions,
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<JsonResult, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(JsonResult {
            root: empty_object_expr(),
            indentation: Indentation::default(),
        });
    }
    let out = parse_impl(source, log, bump, opts, true, false)?;
    Ok(JsonResult {
        root: out.root,
        indentation: out.indentation,
    })
}

pub fn parse_for_macro(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    Ok(parse_impl(source, log, bump, MACRO_JSON_OPTS, false, false)?.root)
}

pub struct JSONParseResult {
    pub expr: Expr,
    pub tag: JSONParseResultTag,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum JSONParseResultTag {
    Expr,
    Ascii,
    Empty,
}

pub fn parse_for_bundling(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<JSONParseResult, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(JSONParseResult {
            expr: empty_object_expr(),
            tag: JSONParseResultTag::Empty,
        });
    }
    let out = parse_impl(source, log, bump, JSON_OPTS, false, false)?;
    Ok(JSONParseResult {
        tag: if out.is_ascii_only {
            JSONParseResultTag::Ascii
        } else {
            JSONParseResultTag::Expr
        },
        expr: out.root,
    })
}

/// `tsconfig.json` / `.jsonc` / `Bun.JSONC.parse`.
///
/// Deliberately the full `E::Object` AST: the resolver's tsconfig walker warns
/// with the `Loc` of individual `paths` array elements (`E::JsonValue` has no
/// per-value `Loc`), and the bundler's JSONC loader / bunfig need `Expr` nodes.
#[inline]
pub fn parse_ts_config<const FORCE_UTF8: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    Ok(parse_impl(source, log, bump, TSCONFIG_OPTS, FORCE_UTF8, false)?.root)
}

/// `Bun.JSONC.parse`: the same dialect as tsconfig (comments, trailing
/// commas), but producing the compact JSON-only containers
/// (`E::ObjectSimple` — see `JSONOptions::simple_objects`). The only
/// consumer is `Expr::to_js`, which understands them.
pub fn parse_jsonc(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    const JSONC_OPTS: JSONOptions = JSONOptions {
        simple_objects: true,
        ..TSCONFIG_OPTS
    };
    Ok(parse_impl(source, log, bump, JSONC_OPTS, true, false)?.root)
}

/// `.env` / `--define` values: JSON if it looks like JSON, `true/false/null/
/// undefined` keywords, otherwise the whole value is treated as one
/// implicitly-quoted string (with escape sequences).
pub fn parse_env_json(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    let contents: &[u8] = &source.contents;
    if contents.is_empty() {
        return Ok(empty_object_expr());
    }

    match contents[0] {
        b'{' | b'[' | b'0'..=b'9' | b'"' | b'\'' => {
            Ok(parse_impl(source, log, bump, DOTENV_JSON_OPTS, false, false)?.root)
        }
        _ => {
            // Keyword fast paths: the first token decides (matching the old
            // lexer, which did not require EOF after it).
            let word_len = contents
                .iter()
                .position(|c| !c.is_ascii_alphanumeric() && *c != b'_' && *c != b'$')
                .unwrap_or(contents.len());
            match &contents[..word_len] {
                b"true" => {
                    return Ok(Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: js_ast::expr::Data::EBoolean(E::Boolean { value: true }),
                    });
                }
                b"false" => {
                    return Ok(Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: js_ast::expr::Data::EBoolean(E::Boolean { value: false }),
                    });
                }
                b"null" => {
                    return Ok(Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: js_ast::expr::Data::ENull(E::Null {}),
                    });
                }
                b"undefined" => {
                    return Ok(Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: js_ast::expr::Data::EUndefined(E::Undefined {}),
                    });
                }
                _ => {}
            }
            // Auto-quote: the entire value is an implicitly-quoted string.
            parse_auto_quoted_string(source, log, bump)
        }
    }
}

/// The `.env`/`--define` "auto quote" path: lex the whole input as a string
/// literal with no quote character (terminated by a newline or EOF), decoding
/// escape sequences. Port of `parse_string_literal_inner::<0>` +
/// `to_e_string`.
fn parse_auto_quoted_string(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    let contents: &[u8] = &source.contents;
    let loc = bun_ast::Loc { start: 0 };

    // Find the end (an unescaped newline) and whether decoding is needed.
    let mut needs_decode = false;
    let mut end = contents.len();
    let mut i = 0;
    while i < contents.len() {
        let c = contents[i];
        match c {
            b'\\' => {
                needs_decode = true;
                i += 2;
            }
            b'\n' => {
                end = i;
                break;
            }
            b'\r' => {
                return log_string_error(source, log, b"Unterminated string literal");
            }
            c if c < 0x20 => {
                return log_string_error(source, log, b"Syntax Error");
            }
            c if c >= 0x80 => {
                needs_decode = true;
                i += 1;
            }
            _ => i += 1,
        }
    }
    let body = &contents[..end.min(contents.len())];
    if !needs_decode {
        return Ok(Expr::allocate(bump, E::String::init(body), loc));
    }
    // Decode through the same escape decoder as real strings.
    let opts = DOTENV_JSON_OPTS;
    match crate::json_stage2::decode_auto_quoted(source, log, bump, body, opts) {
        Ok(s) => Ok(Expr::allocate(bump, s, loc)),
        Err(e) => Err(e),
    }
}

#[cold]
fn log_string_error(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    msg: &[u8],
) -> Result<Expr, bun_core::Error> {
    log.add_error_fmt_opts(
        format_args!("{}", bstr::BStr::new(msg)),
        bun_ast::AddErrorOptions {
            source: Some(source),
            loc: bun_ast::Loc { start: 0 },
            ..Default::default()
        },
    );
    Err(bun_core::err!("SyntaxError"))
}

// ──────────────────────────────────────────────────────────────────────────
// PackageJSONVersionChecker
// ──────────────────────────────────────────────────────────────────────────
//
// Extracts the top-level `name` and `version` strings from a package.json.
// (The old implementation was a dedicated early-exit lexer walk; package.json
// files are small enough that a regular parse is well within the noise of the
// surrounding file I/O, so this is now a thin wrapper over the real parser.)

pub struct PackageJSONVersionChecker<'a, 'bump> {
    source: &'a bun_ast::Source,
    log: &'a mut bun_ast::Log,
    bump: &'bump Bump,

    pub found_version_buf: [u8; 1024],
    pub found_name_buf: [u8; 1024],
    found_name_len: usize,
    found_version_len: usize,
    pub has_found_name: bool,
    pub has_found_version: bool,
    pub name_loc: bun_ast::Loc,
}

impl<'a, 'bump> PackageJSONVersionChecker<'a, 'bump> {
    pub fn init(
        bump: &'bump Bump,
        source: &'a bun_ast::Source,
        log: &'a mut bun_ast::Log,
    ) -> Result<Self, bun_core::Error> {
        Ok(Self {
            source,
            log,
            bump,
            found_version_buf: [0; 1024],
            found_name_buf: [0; 1024],
            found_name_len: 0,
            found_version_len: 0,
            has_found_name: false,
            has_found_version: false,
            name_loc: bun_ast::Loc::EMPTY,
        })
    }

    /// The caller's `Log` is exclusively borrowed by the checker; this is how
    /// it reads the error count back.
    #[inline]
    pub fn has_errors(&self) -> bool {
        self.log.errors > 0
    }

    #[inline]
    pub fn found_name(&self) -> &[u8] {
        &self.found_name_buf[..self.found_name_len]
    }

    #[inline]
    pub fn found_version(&self) -> &[u8] {
        &self.found_version_buf[..self.found_version_len]
    }

    pub fn parse_expr(&mut self) -> Result<Expr, bun_core::Error> {
        if self.source.contents.is_empty() {
            return Ok(empty_object_expr());
        }
        let root = parse_impl(
            self.source,
            self.log,
            self.bump,
            PKG_JSON_CHECKER_OPTS,
            true,
            false,
        )?
        .root;
        if let js_ast::expr::Data::EObject(obj) = &root.data {
            for prop in obj.properties.iter() {
                let (Some(key), Some(value)) = (&prop.key, &prop.value) else {
                    continue;
                };
                let (Some(key_s), Some(val_s)) = (key.data.as_e_string(), value.data.as_e_string())
                else {
                    continue;
                };
                if !self.has_found_name && key_s.data == b"name" {
                    let len = val_s.data.len().min(self.found_name_buf.len());
                    self.found_name_buf[..len].copy_from_slice(&val_s.data[..len]);
                    self.found_name_len = len;
                    self.has_found_name = true;
                    self.name_loc = value.loc;
                } else if !self.has_found_version && key_s.data == b"version" {
                    let len = val_s.data.len().min(self.found_version_buf.len());
                    self.found_version_buf[..len].copy_from_slice(&val_s.data[..len]);
                    self.found_version_len = len;
                    self.has_found_version = true;
                }
                if self.has_found_name && self.has_found_version {
                    break;
                }
            }
        }
        Ok(root)
    }
}

const PKG_JSON_CHECKER_OPTS: JSONOptions = JSONOptions {
    is_json: true,
    json_warn_duplicate_keys: false,
    allow_trailing_commas: true,
    allow_comments: true,
    ..JSONOptions::DEFAULT
};

// ──────────────────────────────────────────────────────────────────────────
// toAST
// ──────────────────────────────────────────────────────────────────────────
//
// Recursively converts a value into a `js_ast.Expr` via a trait with
// per-type impls. Struct/enum/union support would require a derive macro.

use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::{ExprNodeList, G};

pub trait ToAst {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error>;
}

impl ToAst for bool {
    fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
        Ok(Expr {
            data: js_ast::expr::Data::EBoolean(E::Boolean { value: *self }),
            loc: bun_ast::Loc::default(),
        })
    }
}

macro_rules! impl_to_ast_int {
    ($($t:ty),*) => {$(
        impl ToAst for $t {
            fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
                Ok(Expr {
                    data: js_ast::expr::Data::ENumber(E::Number::new(*self as f64)),
                    loc: bun_ast::Loc::default(),
                })
            }
        }
    )*};
}
// `u8` is intentionally omitted so the generic `impl<T: ToAst> for [T]`
// / `[T; N]` does NOT match byte arrays — byte slices/arrays emit
// `E::String`, not `E::Array`. See dedicated `[u8]` / `[u8; N]` impls below.
impl_to_ast_int!(i8, i16, i32, i64, isize, u16, u32, u64, usize);

macro_rules! impl_to_ast_float {
    ($($t:ty),*) => {$(
        impl ToAst for $t {
            fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
                Ok(Expr {
                    data: js_ast::expr::Data::ENumber(E::Number::new(*self as f64)),
                    loc: bun_ast::Loc::default(),
                })
            }
        }
    )*};
}
impl_to_ast_float!(f32, f64);

impl ToAst for [u8] {
    fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
        Ok(Expr::init(E::String::init(self), bun_ast::Loc::EMPTY))
    }
}

impl<T: ToAst> ToAst for &T {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        (**self).to_ast(bump)
    }
}

impl<T: ToAst> ToAst for [T] {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        let mut exprs = BumpVec::with_capacity_in(self.len(), bump);
        for ex in self.iter() {
            exprs.push(ex.to_ast(bump)?);
        }
        Ok(Expr::init(
            E::Array {
                items: ExprNodeList::from_slice(exprs.into_bump_slice()),
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        ))
    }
}

impl<T: ToAst, const N: usize> ToAst for [T; N] {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        self.as_slice().to_ast(bump)
    }
}

// Byte arrays emit `E::String` (not `E::Array`).
impl<const N: usize> ToAst for [u8; N] {
    fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
        Ok(Expr::init(
            E::String::init(self.as_slice()),
            bun_ast::Loc::EMPTY,
        ))
    }
}

impl<T: ToAst> ToAst for Option<T> {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        match self {
            Some(v) => v.to_ast(bump),
            None => Ok(Expr {
                data: js_ast::expr::Data::ENull(E::Null {}),
                loc: bun_ast::Loc::default(),
            }),
        }
    }
}

impl ToAst for () {
    fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
        Ok(Expr {
            data: js_ast::expr::Data::ENull(E::Null {}),
            loc: bun_ast::Loc::default(),
        })
    }
}

impl ToAst for bun_core::Error {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        self.name().as_bytes().to_ast(bump)
    }
}

// The G import is used by stage 2 via this module's re-export surface; keep
// the type mentioned so the import isn't flagged.
#[allow(dead_code)]
fn _g_property_size_assert(p: &G::Property) -> usize {
    core::mem::size_of_val(p)
}

// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use bun_ast::expr::Data;

    // ── helpers ──────────────────────────────────────────────────────────

    struct Parsed {
        root: Option<Expr>,
        errors: usize,
        warnings: usize,
        first_msg: String,
        // Keep the arena alive for the AST's lifetime.
        _bump: Box<Bump>,
        _scope: js_ast::StoreResetGuard,
    }

    fn run(contents: &[u8], which: Which) -> Parsed {
        bun_ast::initialize_store_or_reset();
        let scope = js_ast::StoreResetGuard::new();
        let mut log = bun_ast::Log::init();
        let bump = Box::new(Bump::new());
        let source = bun_ast::Source::init_path_string("fixture.json", contents);
        let r = match which {
            Which::Utf8 => parse_utf8(&source, &mut log, &bump),
            Which::Plain => parse::<false>(&source, &mut log, &bump),
            Which::TsConfig => parse_ts_config::<true>(&source, &mut log, &bump),
            Which::Env => parse_env_json(&source, &mut log, &bump),
            Which::PackageJson => parse_package_json_utf8(&source, &mut log, &bump),
            Which::Jsonc => parse_jsonc(&source, &mut log, &bump),
            Which::Simple => parse_package_json_utf8_with_opts_rt(
                JSONOptions {
                    is_json: true,
                    simple_objects: true,
                    ..JSONOptions::DEFAULT
                },
                &source,
                &mut log,
                &bump,
            )
            .map(|r| r.root),
        };
        let first_msg = log
            .msgs
            .first()
            .map(|m| String::from_utf8_lossy(&m.data.text).into_owned())
            .unwrap_or_default();
        Parsed {
            root: r.ok(),
            errors: log.errors as usize,
            warnings: log.warnings as usize,
            first_msg,
            _bump: bump,
            _scope: scope,
        }
    }

    #[derive(Clone, Copy)]
    enum Which {
        Utf8,
        Plain,
        TsConfig,
        Env,
        PackageJson,
        /// `Bun.JSONC.parse`'s entry: tsconfig dialect + `simple_objects`.
        Jsonc,
        /// Strict JSON + `simple_objects` (what a registry-manifest caller
        /// would use).
        Simple,
    }

    /// Render the parsed AST as compact JSON (object keys in source order,
    /// last duplicate wins is NOT applied — duplicates appear as parsed).
    /// Only for test assertions.
    fn json_value_to_string(v: &E::JsonValue, out: &mut String) {
        match v {
            E::JsonValue::Null => out.push_str("null"),
            E::JsonValue::Boolean(b) => out.push_str(if *b { "true" } else { "false" }),
            E::JsonValue::Number(n) => {
                let tmp = Expr::init(*n, bun_ast::Loc::EMPTY);
                to_json_string(&tmp, out);
            }
            E::JsonValue::String(s) => {
                write_json_string(&std::string::String::from_utf8_lossy(s.slice()), out)
            }
            E::JsonValue::Object(o) => {
                out.push('{');
                for (i, p) in o.get().properties().iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_json_string(&std::string::String::from_utf8_lossy(p.key.slice()), out);
                    out.push(':');
                    json_value_to_string(&p.value, out);
                }
                out.push('}');
            }
            E::JsonValue::Array(a) => {
                out.push('[');
                for (i, item) in a.get().items().iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    json_value_to_string(item, out);
                }
                out.push(']');
            }
        }
    }

    fn to_json_string(e: &Expr, out: &mut String) {
        use std::fmt::Write;
        match &e.data {
            Data::EObjectSimple(o) => {
                out.push('{');
                for (i, p) in o.get().properties().iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_json_string(&std::string::String::from_utf8_lossy(p.key.slice()), out);
                    out.push(':');
                    json_value_to_string(&p.value, out);
                }
                out.push('}');
            }
            Data::EArraySimple(a) => {
                out.push('[');
                for (i, item) in a.get().items().iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    json_value_to_string(item, out);
                }
                out.push(']');
            }
            Data::ENull(_) => out.push_str("null"),
            Data::EBoolean(b) => out.push_str(if b.value { "true" } else { "false" }),
            Data::ENumber(n) => {
                let v = n.value();
                if v == 0.0 && v.is_sign_negative() {
                    out.push_str("-0");
                } else if v.fract() == 0.0 && v.is_finite() && v.abs() < 1e15 {
                    write!(out, "{}", v as i64).unwrap();
                } else {
                    write!(out, "{v}").unwrap();
                }
            }
            Data::EString(s) => write_json_string(&estring_to_string(s), out),
            Data::EArray(a) => {
                out.push('[');
                for (i, item) in a.items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    to_json_string(item, out);
                }
                out.push(']');
            }
            Data::EObject(o) => {
                out.push('{');
                for (i, prop) in o.properties.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    let k = prop.key.as_ref().unwrap().data.as_e_string().unwrap();
                    write_json_string(&estring_to_string(&k), out);
                    out.push(':');
                    to_json_string(prop.value.as_ref().unwrap(), out);
                }
                out.push('}');
            }
            _ => panic!("unexpected node kind in JSON output"),
        }
    }

    fn write_json_string(s: &str, out: &mut String) {
        use std::fmt::Write;
        out.push('"');
        for c in s.chars() {
            match c {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                c if (c as u32) < 0x20 => write!(out, "\\u{:04x}", c as u32).unwrap(),
                c => out.push(c),
            }
        }
        out.push('"');
    }

    fn estring_to_string(s: &E::String) -> String {
        if s.is_utf16 {
            String::from_utf16(s.slice16()).expect("invalid utf16 in EString")
        } else {
            String::from_utf8(s.data.to_vec()).expect("invalid utf8 in EString")
        }
    }

    #[track_caller]
    fn expect_error(input: &str, msg_contains: &str) {
        let p = run(input.as_bytes(), Which::Utf8);
        assert!(
            p.root.is_none() || p.errors > 0,
            "expected an error for {input:?}, got none"
        );
        assert!(
            p.first_msg.contains(msg_contains),
            "expected error containing {msg_contains:?} for {input:?}, got {:?}",
            p.first_msg
        );
    }

    #[track_caller]
    fn assert_parses_to(input: &str, expected_compact_json: &str) {
        for which in [Which::Utf8, Which::Plain, Which::TsConfig] {
            let p = run(input.as_bytes(), which);
            let Some(root) = &p.root else {
                panic!("failed to parse (first error: {:?}): {input}", p.first_msg)
            };
            assert_eq!(
                p.errors, 0,
                "unexpected error {:?} for {input}",
                p.first_msg
            );
            let mut got = String::new();
            to_json_string(root, &mut got);
            assert_eq!(got, expected_compact_json, "input: {input}");
        }
    }

    fn root_string(p: &Parsed) -> String {
        match &p.root.as_ref().unwrap().data {
            Data::EString(s) => estring_to_string(s),
            _ => panic!("expected a string"),
        }
    }

    // ── strict JSON ──────────────────────────────────────────────────────
    //
    // (The broad randomized differential against `JSON.parse` lives in
    // test/js/bun/jsonc/jsonc-differential.test.ts, where it exercises the
    // real binary.)

    #[test]
    fn parses_basics() {
        assert_parses_to("{}", "{}");
        assert_parses_to("[]", "[]");
        assert_parses_to("0", "0");
        assert_parses_to("-0", "-0");
        assert_parses_to("123", "123");
        assert_parses_to("3.5", "3.5");
        assert_parses_to("1e10", "10000000000");
        assert_parses_to("1E-2", "0.01");
        assert_parses_to("true", "true");
        assert_parses_to("false", "false");
        assert_parses_to("null", "null");
        assert_parses_to("\"\"", "\"\"");
        assert_parses_to("\"hello\"", "\"hello\"");
        assert_parses_to(
            "\"he\\\"llo\\n\\t\\u00e9\\\\\"",
            "\"he\\\"llo\\n\\u0009é\\\\\"",
        );
        assert_parses_to(r#""\ud83d\ude00""#, "\"😀\"");
        assert_parses_to("\"日本 🎉\"", "\"日本 🎉\"");
        assert_parses_to("[1,2,3]", "[1,2,3]");
        assert_parses_to("[[[[1]]]]", "[[[[1]]]]");
        assert_parses_to(
            "{\"a\":1,\"b\":[true,false,null],\"c\":{\"d\":\"e\"}}",
            "{\"a\":1,\"b\":[true,false,null],\"c\":{\"d\":\"e\"}}",
        );
        assert_parses_to("{ \"sp\" : [ 1 , 2 ] }", "{\"sp\":[1,2]}");
        assert_parses_to(
            "{\n  \"p\": {\n    \"m\": \"l\"\n  }\n}",
            "{\"p\":{\"m\":\"l\"}}",
        );
    }

    #[test]
    fn parses_across_block_boundaries() {
        // Strings, escapes and tokens straddling the 64-byte SIMD block size.
        for pad in 50..=70usize {
            let key = "a".repeat(pad);
            let val = "b".repeat(pad);
            let src = format!("{{\"{key}\": \"x\", \"k\": \"{val}\\n\"}}");
            let expected = format!("{{\"{key}\":\"x\",\"k\":\"{val}\\n\"}}");
            assert_parses_to(&src, &expected);
            let src = format!("[\"{}\\\\\"]", "y".repeat(pad));
            let expected = format!("[\"{}\\\\\"]", "y".repeat(pad));
            assert_parses_to(&src, &expected);
            let src = format!("[{}1]", " ".repeat(pad));
            assert_parses_to(&src, "[1]");
        }
    }

    // ── JSONC / lenient extensions ───────────────────────────────────────

    #[test]
    fn jsonc_comments_and_trailing_commas() {
        let src = r#"
// leading comment
{
  /* block
     comment */
  "a": 1, // line comment
  "b": [1, 2, /* inline */ 3,],
  "c": { "d": "e", }, // trailing comma in object
}
"#;
        let p = run(src.as_bytes(), Which::TsConfig);
        assert_eq!(p.errors, 0, "{}", p.first_msg);
        let mut got = String::new();
        to_json_string(p.root.as_ref().unwrap(), &mut got);
        assert_eq!(got, r#"{"a":1,"b":[1,2,3],"c":{"d":"e"}}"#);
    }

    #[test]
    fn comments_rejected_in_plain_json() {
        let p = run(b"{\"a\": 1} // nope", Which::Utf8);
        assert!(p.errors > 0);
        assert!(
            p.first_msg.contains("JSON does not support comments"),
            "{}",
            p.first_msg
        );
        expect_error("{\"a\": /* x */ 1}", "JSON does not support comments");
    }

    #[test]
    fn trailing_comma_rejected_in_plain_json() {
        let p = run(b"[1, 2,]", Which::Utf8);
        assert!(
            p.first_msg
                .contains("JSON does not support trailing commas"),
            "{}",
            p.first_msg
        );
    }

    #[test]
    fn single_quoted_strings() {
        for which in [Which::Utf8, Which::TsConfig] {
            let p = run("{'key': 'va\"lé'}".as_bytes(), which);
            assert_eq!(p.errors, 0, "{}", p.first_msg);
            let mut got = String::new();
            to_json_string(p.root.as_ref().unwrap(), &mut got);
            assert_eq!(got, "{\"key\":\"va\\\"lé\"}");
        }
    }

    #[test]
    fn lenient_numbers() {
        for (src, want) in [
            ("[0x10]", 16.0),
            ("[0X10]", 16.0),
            ("[0b101]", 5.0),
            ("[0o17]", 15.0),
            ("[017]", 15.0),
            ("[018]", 18.0),
            ("[1_000_000]", 1e6),
            ("[.5]", 0.5),
            ("[5.]", 5.0),
            ("[- 5]", -5.0),
            ("[1e400]", f64::INFINITY),
        ] {
            let p = run(src.as_bytes(), Which::Utf8);
            assert_eq!(p.errors, 0, "{src}: {}", p.first_msg);
            let Data::EArray(a) = &p.root.as_ref().unwrap().data else {
                panic!()
            };
            let Data::ENumber(n) = &a.items[0].data else {
                panic!("{src}")
            };
            assert_eq!(n.value(), want, "{src}");
        }
    }

    #[test]
    fn exotic_whitespace_and_bom() {
        // BOM at the start, NBSP / FF / VT / LS between tokens.
        for src in [
            "\u{FEFF}{\"a\": 1}",
            "{\u{00a0}\"a\"\u{00a0}:\u{00a0}1\u{00a0},\u{00a0}\"b\":2\u{00a0}}",
            "{\x0b\"a\"\x0c:\u{2028}1\u{2029}}",
            "\u{FEFF}\u{FEFF}[1]",
        ] {
            let p = run(src.as_bytes(), Which::Utf8);
            assert_eq!(p.errors, 0, "{src:?}: {}", p.first_msg);
        }
    }

    #[test]
    fn escaped_keyword_identifiers() {
        // Yes, the old lexer accepted `true`.
        let p = run(br#"[true, false, null]"#, Which::Utf8);
        assert_eq!(p.errors, 0, "{}", p.first_msg);
        let mut got = String::new();
        to_json_string(p.root.as_ref().unwrap(), &mut got);
        assert_eq!(got, "[true,false,null]");
    }

    #[test]
    fn duplicate_key_warnings() {
        let p = run(br#"{"a":1,"b":2,"a":3}"#, Which::Utf8);
        assert_eq!(p.errors, 0);
        assert_eq!(p.warnings, 1, "exactly one duplicate-key warning");
        assert!(
            p.first_msg.contains("Duplicate key \"a\""),
            "{}",
            p.first_msg
        );
        // Same key in different (nested) objects: no warning.
        let p = run(br#"{"a":{"a":1},"b":{"a":2}}"#, Which::Utf8);
        assert_eq!(p.warnings, 0);
        // Lots of keys (the map-based path) still detects.
        let many: String = (0..200).map(|i| format!("\"k{i}\":{i},")).collect();
        let p = run(format!("{{{many}\"k7\":1}}").as_bytes(), Which::Utf8);
        assert_eq!(p.warnings, 1);
    }

    /// The compact containers must be semantically identical to the full
    /// AST: same canonical JSON, same warnings, same errors, on every shape
    /// the parser supports.
    #[test]
    fn simple_objects_match_the_full_ast() {
        let mut generated = std::string::String::from("{");
        for i in 0..120 {
            if i > 0 {
                generated.push(',');
            }
            generated.push_str(&format!(
                "\"k{i}\":[{i}, -1.5e3, \"s{i}\", \"esc\\n\\u00e9{i}\", true, false, null, {{\"n\": {{\"deep\": [\"x{i}\"]}}}}]"
            ));
        }
        generated.push('}');
        let docs: Vec<&str> = vec![
            "{}",
            "[]",
            "null",
            "  42.5e-3 ",
            "\"plain\"",
            "\"esc\\u00e9\\n\\\\\"",
            r#"{"a": 1, "b": [true, null, "x"], "c": {"d": "é🚀", "e": ""}}"#,
            r#"{"dup": 1, "dup": 2, "big": {"x": [1,2,3,4,5,6,7,8,9,10]}}"#,
            "\u{FEFF}{\"bom\": 1}",
            &generated,
        ];
        // The AST store is reset by the next `run()`, so each tree must be
        // serialized before the other parse happens.
        fn canon(
            doc: &str,
            which: Which,
        ) -> (
            Option<std::string::String>,
            usize,
            usize,
            std::string::String,
        ) {
            let p = run(doc.as_bytes(), which);
            let root = p.root.as_ref().map(|r| {
                let mut s = std::string::String::new();
                to_json_string(r, &mut s);
                s
            });
            (root, p.errors, p.warnings, p.first_msg)
        }
        for doc in docs {
            let (fr, fe, fw, fm) = canon(doc, Which::Utf8);
            let (sr, se, sw, sm) = canon(doc, Which::Simple);
            assert_eq!((fe, fw, &fm), (se, sw, &sm), "log differs for {doc:?}");
            if fr != sr {
                let (a, b) = (fr.unwrap_or_default(), sr.unwrap_or_default());
                let i = a
                    .bytes()
                    .zip(b.bytes())
                    .position(|(x, y)| x != y)
                    .unwrap_or(a.len().min(b.len()));
                panic!(
                    "values differ at byte {i}:\n full: ...{}\n simple: ...{}",
                    &a[i.saturating_sub(40)..(i + 40).min(a.len())],
                    &b[i.saturating_sub(40)..(i + 40).min(b.len())],
                );
            }
        }
        // The JSONC entry (comments + trailing commas + single quotes) too.
        let jsonc = "// c\n{\"a\": [1, 2,], /* x */ \"b\": 'sq', } ";
        assert_eq!(canon(jsonc, Which::TsConfig), canon(jsonc, Which::Jsonc));
    }

    /// The generic `Expr` accessors (`get`, `as_property`, `as_array`,
    /// `as_string`, ...) must observe the same document through a
    /// `Which::Simple` root — where leaf values are materialized out of the
    /// row tape on demand — as through the full AST.
    #[test]
    fn simple_objects_expr_accessor_materialization() {
        let doc: &[u8] = br#"{
            "name": "pkg",
            "version": "1.2.3",
            "private": true,
            "count": 42.5,
            "nothing": null,
            "deps": {"a": "^1", "b": "~2.0", "empty": ""},
            "files": ["lib", 3, true, null, {"k": "v"}, ["nested"]],
            "empty_obj": {},
            "empty_arr": []
        }"#;

        fn describe(e: &Expr, bump: &Bump, out: &mut std::string::String) {
            match &e.data {
                Data::ENull(_) => out.push_str("null"),
                Data::EBoolean(b) => out.push_str(if b.value { "true" } else { "false" }),
                Data::ENumber(n) => {
                    use std::fmt::Write;
                    write!(out, "{}", n.value()).unwrap();
                }
                Data::EString(_) => {
                    // Both string accessors must agree on a materialized leaf.
                    assert_eq!(e.as_utf8_string_literal(), e.as_string(bump));
                    out.push('"');
                    out.push_str(&std::string::String::from_utf8_lossy(
                        e.as_string(bump).unwrap(),
                    ));
                    out.push('"');
                }
                _ if e.is_object() => out.push_str("{object}"),
                _ if e.is_array() => out.push_str("[array]"),
                _ => panic!("unexpected node kind"),
            }
        }

        // Walk the document through the generic accessors only and render
        // everything they returned; both parse modes must agree byte-for-byte.
        fn probe(doc: &[u8], which: Which) -> std::string::String {
            use std::fmt::Write;
            let p = run(doc, which);
            let bump: &Bump = &p._bump;
            let root = p.root.unwrap();
            let mut out = std::string::String::new();

            assert!(root.is_object());
            assert!(!root.is_array());
            assert!(root.get(b"missing").is_none());
            assert!(root.as_array().is_none());

            // as_property: value kind + the key's Loc.
            for key in [
                &b"name"[..],
                b"version",
                b"private",
                b"count",
                b"nothing",
                b"deps",
                b"files",
                b"empty_obj",
                b"empty_arr",
            ] {
                let q = root.as_property(key).unwrap();
                write!(
                    out,
                    "{}@{}=",
                    std::str::from_utf8(key).unwrap(),
                    q.loc.start
                )
                .unwrap();
                describe(&q.expr, bump, &mut out);
                out.push('\n');
            }

            // Typed property getters.
            writeln!(out, "bool={:?}", Expr::get_boolean(&root, b"private")).unwrap();
            writeln!(out, "num={:?}", root.get_number(b"count").map(|(n, _)| n)).unwrap();
            writeln!(
                out,
                "str={:?}",
                root.get_string(bump, b"name")
                    .unwrap()
                    .map(|(s, _)| std::string::String::from_utf8_lossy(s).into_owned())
            )
            .unwrap();
            writeln!(
                out,
                "get_object(deps)={}",
                root.get_object(b"deps").is_some()
            )
            .unwrap();
            writeln!(
                out,
                "get_object(name)={}",
                root.get_object(b"name").is_some()
            )
            .unwrap();
            writeln!(
                out,
                "has_any={} {}",
                root.has_any_property_named(&[b"zzz", b"private"]),
                root.has_any_property_named(&[b"zzz"])
            )
            .unwrap();

            // Nested object access through a materialized container.
            let deps = root.get(b"deps").unwrap();
            assert!(deps.is_object());
            out.push_str("deps.a=");
            describe(&deps.get(b"a").unwrap(), bump, &mut out);
            out.push('\n');

            // as_property_string_map over the nested object (empty values are
            // skipped by the full-AST implementation; simple must match).
            let map = Expr::as_property_string_map(&root, b"deps", bump).unwrap();
            let mut pairs: Vec<(std::string::String, std::string::String)> = map
                .iter()
                .map(|(k, v)| {
                    (
                        std::string::String::from_utf8_lossy(k).into_owned(),
                        std::string::String::from_utf8_lossy(v).into_owned(),
                    )
                })
                .collect();
            pairs.as_mut_slice().sort();
            writeln!(out, "deps_map={pairs:?}").unwrap();

            // Array iteration: every item is materialized in order.
            let mut iter = root.get_array(b"files").unwrap();
            out.push_str("files=[");
            while let Some(item) = iter.next() {
                describe(&item, bump, &mut out);
                out.push(',');
            }
            out.push_str("]\n");
            // `as_array` on the property's value behaves the same way.
            assert!(root.get(b"files").unwrap().as_array().is_some());
            // Empty containers: same `None` contract as the full AST.
            assert!(root.get(b"empty_arr").unwrap().as_array().is_none());
            assert!(root.get_array(b"empty_obj").is_none());

            // Path lookups (object key, array index, nested object key).
            for path in [
                &b"deps.a"[..],
                b"files[0]",
                b"files[4]",
                b"files[5][0]",
                b"files[99]",
                b"deps.zzz",
            ] {
                write!(out, "{}=", std::str::from_utf8(path).unwrap()).unwrap();
                match root.get_path_may_be_index(bump, path) {
                    Some(e) => describe(&e, bump, &mut out),
                    None => out.push_str("none"),
                }
                out.push('\n');
            }

            out
        }

        let full = probe(doc, Which::Utf8);
        let simple = probe(doc, Which::Simple);
        assert_eq!(full, simple);
        // Sanity-check the probe itself against fixed expectations so a bug
        // shared by both modes can't cancel out.
        // The reported `Query::loc` is the key's location in the source.
        let name_key_offset = doc.windows(6).position(|w| w == b"\"name\"").unwrap();
        assert!(
            full.starts_with(&format!("name@{name_key_offset}=\"pkg\"\n")),
            "{full:?}"
        );
        assert!(full.contains("bool=Some(true)\n"));
        assert!(full.contains("num=Some(42.5)\n"));
        assert!(full.contains("deps_map=[(\"a\", \"^1\"), (\"b\", \"~2.0\")]\n"));
        assert!(full.contains("files=[\"lib\",3,true,null,{object},[array],]\n"));
        assert!(full.contains("files[4]={object}\n"));
        assert!(full.contains("files[5][0]=\"nested\"\n"));
        assert!(full.contains("deps.a=\"^1\"\n"));
        assert!(full.contains("files[99]=none\n"));
    }

    #[test]
    fn duplicate_key_detection_with_nested_large_objects() {
        // A large object (spilled to the hash-map path) containing another
        // large object as one of its later values. The inner object must not
        // disturb the outer object's membership state: a duplicate of an
        // early outer key appearing *after* the nested object must still be
        // reported, and inner keys that match outer keys must not be.
        let many: String = (0..60).map(|i| format!("\"k{i}\":{i},")).collect();
        let inner = format!("{{{}\"inner\":0}}", many.clone());
        // Outer: 60 unique keys, then a big nested value, then "k3" again.
        let doc = format!("{{{many}\"nest\":{inner},\"k3\":true}}");
        let p = run(doc.as_bytes(), Which::Utf8);
        assert_eq!(p.errors, 0);
        assert_eq!(p.warnings, 1, "outer duplicate after a nested large object");
        assert!(
            p.first_msg.contains("Duplicate key \"k3\""),
            "{}",
            p.first_msg
        );

        // Sibling large objects with identical key sets: no warnings.
        let p = run(
            format!("{{\"a\":{inner},\"b\":{inner}}}").as_bytes(),
            Which::Utf8,
        );
        assert_eq!(p.errors, 0);
        assert_eq!(p.warnings, 0);

        // Duplicates in the inner and the outer large object are each
        // reported, independently.
        let dup_inner = format!("{{{}\"y\":1,\"y\":2}}", many.clone());
        let p = run(
            format!("{{{many}\"nest\":{dup_inner},\"x\":1,\"x\":2}}").as_bytes(),
            Which::Utf8,
        );
        assert_eq!(p.errors, 0);
        assert_eq!(
            p.warnings, 2,
            "one for the inner \"y\", one for the outer \"x\""
        );
    }

    #[test]
    fn is_single_line_matches_source_layout() {
        let p = run(b"{\"a\":1}", Which::Utf8);
        let Data::EObject(o) = &p.root.as_ref().unwrap().data else {
            panic!()
        };
        assert!(o.is_single_line);
        let p = run(b"{\n\"a\":1\n}", Which::Utf8);
        let Data::EObject(o) = &p.root.as_ref().unwrap().data else {
            panic!()
        };
        assert!(!o.is_single_line);
        // Newline inside a nested value does not affect the outer object.
        let p = run(b"{\"a\": [1,\n2]}", Which::Utf8);
        let Data::EObject(o) = &p.root.as_ref().unwrap().data else {
            panic!()
        };
        assert!(o.is_single_line);
        let Data::EArray(a) = &o.properties[0].value.as_ref().unwrap().data else {
            panic!()
        };
        assert!(!a.is_single_line);
    }

    // ── errors ───────────────────────────────────────────────────────────

    #[test]
    fn error_messages() {
        expect_error("   ", "Unexpected end of file");
        expect_error("{", "Expected \"}\" but found end of file");
        expect_error("[1", "Expected \"]\" but found end of file");
        expect_error("\"abc", "Unterminated string literal");
        expect_error("\"ab\ncd\"", "Unterminated string literal");
        expect_error("\"ab\tcd\"", "Syntax Error");
        expect_error("{\"a\" 1}", "Expected \":\" but found \"1\"");
        expect_error("{1: 2}", "Expected string but found \"1\"");
        expect_error("[truthy]", "Unexpected truthy");
        expect_error("[truex]", "Unexpected truex");
        expect_error("nul", "Unexpected nul");
        expect_error("[1n]", "Syntax Error");
        expect_error("[123abc]", "Syntax Error");
        expect_error("[@]", "Decorators are not allowed in JSON");
        expect_error("[;]", "Semicolons are not allowed in JSON");
        expect_error("[1 + 2]", "Operators are not allowed in JSON");
        expect_error("[\"a\\q\"]", "Syntax Error");
        expect_error("[\"\\u12\"]", "Syntax Error");
        expect_error("{\"a\": }", "Unexpected }");
        expect_error("{\"a\": 1/2}", "Operators are not allowed in JSON");
        expect_error("[1] /* unterminated", "terminate multi-line comment");
    }

    #[test]
    fn deep_nesting_does_not_overflow() {
        let depth = 200_000;
        let mut s = String::with_capacity(depth * 2);
        for _ in 0..depth {
            s.push('[');
        }
        let p = run(s.as_bytes(), Which::Utf8);
        // Either a graceful syntax error or a stack-depth error — never a crash.
        assert!(p.root.is_none());
    }

    // ── env / auto-quote entry point ─────────────────────────────────────

    #[test]
    fn env_json() {
        for (src, want) in [
            ("production", "production"),
            ("hello world", "hello world"),
            ("*{box-sizing:border-box}", "*{box-sizing:border-box}"),
            ("a\\nb", "a\nb"),
            ("first line\nsecond", "first line"),
        ] {
            let p = run(src.as_bytes(), Which::Env);
            assert_eq!(p.errors, 0, "{src}: {}", p.first_msg);
            assert_eq!(root_string(&p), want, "{src}");
        }
        let p = run(b"true", Which::Env);
        assert!(matches!(
            p.root.as_ref().unwrap().data,
            Data::EBoolean(E::Boolean { value: true })
        ));
        let p = run(b"undefined", Which::Env);
        assert!(matches!(p.root.as_ref().unwrap().data, Data::EUndefined(_)));
        let p = run(b"\"quoted\"", Which::Env);
        assert_eq!(root_string(&p), "quoted");
        let p = run(b"{\"a\": [1]}", Which::Env);
        assert_eq!(p.errors, 0);
    }

    // ── package.json helpers ─────────────────────────────────────────────

    #[test]
    fn package_json_version_checker() {
        bun_ast::initialize_store_or_reset();
        let _scope = js_ast::StoreResetGuard::new();
        let mut log = bun_ast::Log::init();
        let bump = Bump::new();
        let source = bun_ast::Source::init_path_string(
            "package.json",
            br#"{"private": true, "name": "my-pkg", "scripts": {"x": "y"}, "version": "1.2.3"}"#
                .as_slice(),
        );
        let mut checker = PackageJSONVersionChecker::init(&bump, &source, &mut log).unwrap();
        checker.parse_expr().unwrap();
        assert!(checker.has_found_name && checker.has_found_version);
        assert_eq!(checker.found_name(), b"my-pkg");
        assert_eq!(checker.found_version(), b"1.2.3");
    }

    #[test]
    fn indentation_guess() {
        let p = guess_indentation(b"{\n    \"a\": 1\n}");
        assert_eq!(p.scalar, 4);
        assert!(matches!(p.character, bun_ast::IndentationCharacter::Space));
        let p = guess_indentation(b"{\n\t\"a\": 1\n}");
        assert_eq!(p.scalar, 1);
        assert!(matches!(p.character, bun_ast::IndentationCharacter::Tab));
    }

    #[test]
    fn empty_input_is_empty_object() {
        let p = run(b"", Which::PackageJson);
        assert!(matches!(p.root.as_ref().unwrap().data, Data::EObject(_)));
        assert_eq!(p.errors, 0);
    }
}
