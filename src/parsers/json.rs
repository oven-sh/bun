//! JSON / JSONC parser.
//!
//! Two stages (see [`crate::json_index`] and [`crate::json_stage2`]):
//!
//!   1. a batched SIMD **structural indexer** (Highway, simdjson-style) finds
//!      every token boundary in one pass over the document
//!   2. a recursive-descent parser over the index array builds the compact
//!      immutable row AST (`E::ObjectJSON` / `E::ArrayJSON` on an
//!      [`E::JsonTape`]), taking strings zero-copy out of the source whenever
//!      stage 1 proved they contain no escape and no control character
//!
//! That row AST is the only thing the parser builds. Entry points either
//! return it as a [`ParsedJson`] (`*_immutable`, registry, JSONC) or
//! deep-convert it into the classic `E::Object` / `E::Array` tree at their
//! boundary ([`materialize`]) for the callers that mutate, print, or splice
//! the result into a JavaScript AST.
//!
//! This file owns the public entry points (one per option preset / caller
//! family), the option type, the `.env`/`--define` auto-quote path,
//! materialization, and the `PackageJSONVersionChecker` helper.
//!
//! Supported beyond strict JSON: comments and trailing commas (gated by
//! [`JSONOptions`]), single-quoted strings, hex/octal/binary/underscore
//! numeric literals, `\x`/`\v` escapes, BOM and exotic unicode whitespace
//! between tokens, duplicate-key warnings, and indentation guessing.

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
    /// Record each property value's / array item's start location into the
    /// document's [`E::JsonTape`]. Only the classic-output driver asks for
    /// this: [`materialize`] then carries every exact location into the
    /// classic tree without re-scanning the source. The immutable AST
    /// itself never stores per-value locations.
    pub record_value_locs: bool,
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
        record_value_locs: false,
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

/// A parsed immutable-AST JSON document (`E::ObjectJSON` / `E::ArrayJSON`
/// containers): the root expression plus the [`E::JsonTape`] that owns every
/// row and decoded string of the document. Everything reachable from `root`
/// borrows the tape and the source it was parsed from, so keep all three
/// alive together.
pub struct ParsedJson {
    pub root: Expr,
    pub tape: Option<Box<E::JsonTape>>,
}

/// Everything a full parse produces beyond the root expression.
struct ParseOutput {
    root: Expr,
    /// `Some` only for a [`E::TapeAlloc::Global`] parse: see
    /// [`ParsedJson::tape`]. An arena-mode tape belongs to the arena.
    tape: Option<Box<E::JsonTape>>,
    is_ascii_only: bool,
    indentation: Indentation,
}

/// Build the structural index, run stage 2, release the index.
fn parse_impl(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    opts: JSONOptions,
    check_len: bool,
) -> Result<ParseOutput, bun_core::Error> {
    parse_impl_in(source, log, opts, check_len, E::TapeAlloc::Global)
}

/// [`parse_impl`] with the allocator the document's [`E::JsonTape`] lives
/// in: the global heap (returned in [`ParseOutput::tape`], dropped by its
/// owner) or a caller's arena (nothing to return, nothing ever runs `Drop`).
fn parse_impl_in(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    opts: JSONOptions,
    check_len: bool,
    tape_alloc: E::TapeAlloc,
) -> Result<ParseOutput, bun_core::Error> {
    let contents: &[u8] = &source.contents;

    let mut sidx = StructuralIndex::new(contents);
    let log_mark = (log.errors, log.warnings, log.msgs.len());
    let result = run_stage2(source, log, &mut sidx, opts, check_len, tape_alloc);

    // Index-layer errors take precedence: the index stream was truncated at
    // the offending byte, so whatever stage 2 logged about the truncated
    // document is noise. Only the index error is reported.
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
    sidx: &mut StructuralIndex<'s>,
    opts: JSONOptions,
    check_len: bool,
    tape_alloc: E::TapeAlloc,
) -> Result<ParseOutput, bun_core::Error> {
    let mut parser = Parser::new(source, log, sidx, opts, tape_alloc);
    let root = parser.parse_value()?;
    if check_len && !parser.at_trailing_end() {
        return Err(parser.unexpected_here());
    }
    let is_ascii_only = parser.is_ascii_only;
    // The root borrows the tape: take ownership before the parser drops it.
    let tape = parser.take_tape();
    drop(parser);
    let is_ascii_only = is_ascii_only
        && sidx.flags & (json_index::FLAG_HAS_BACKSLASH_IN_STRING | json_index::FLAG_HAS_NON_ASCII)
            == 0;
    Ok(ParseOutput {
        root,
        tape,
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
        IndexError::DocumentTooLarge => {
            log.add_error_fmt_opts(
                format_args!("JSON document is too large to parse (2 GiB maximum)"),
                bun_ast::AddErrorOptions {
                    source: Some(source),
                    loc: bun_ast::Loc { start: 0 },
                    ..Default::default()
                },
            );
        }
    }
    bun_core::err!("SyntaxError")
}

/// Indentation guesser: the first line (after a run of newlines) that
/// starts with a space or a tab determines the guess.
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

/// Parse JSON into the classic `E::Object` / `E::Array` AST.
///
/// `FORCE_UTF8` is accepted for source compatibility and ignored: every
/// string is stored as UTF-8 (WTF-8 for the lone surrogates JSON escapes
/// can produce), which the printer and `to_js` both handle.
#[inline]
pub fn parse<const FORCE_UTF8: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    Ok(parse_classic(source, log, bump, JSON_OPTS, false)?.root)
}

/// Parse JSON into the classic AST. Identical to [`parse`] — every string
/// is UTF-8 either way — and kept as the spelling its callers use.
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
    Ok(parse_classic(source, log, bump, JSON_OPTS, CHECK_LEN)?.root)
}

/// Shared driver for the classic-output (`E::Object` / `E::Array`) entry
/// points: parse into the immutable AST — the only form stage 2 builds — and
/// [`materialize`] the classic tree the caller expects at the boundary, with
/// every node's exact source location. The document's row tape dies here;
/// everything was copied out of it (into the AST store, and `bump` for
/// decoded strings).
fn parse_classic(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
    opts: JSONOptions,
    check_len: bool,
) -> Result<ParseOutput, bun_core::Error> {
    // Record every value's start location in the tape so the classic tree
    // gets exact locations without re-scanning the source.
    let opts = JSONOptions {
        record_value_locs: true,
        ..opts
    };
    let mut out = parse_impl(source, log, opts, check_len)?;
    out.root = materialize_impl(&out.root, source, bump, opts.was_originally_macro);
    // The classic tree borrows nothing from the row tape: drop it.
    out.tape = None;
    Ok(out)
}

/// Parse a JSON document fetched from a registry/HTTP API (npm package
/// manifests): strict JSON, strings forced to UTF-8, and **no duplicate-key
/// warnings** — these documents are machine-generated, the warnings are never
/// surfaced to anyone, and computing them costs a measurable fraction of
/// every manifest parse. Containers are the compact read-only immutable AST
/// (`E::ObjectJSON` / `E::ArrayJSON` — see `JSONOptions::immutable`).
pub fn parse_utf8_registry(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
) -> Result<ParsedJson, bun_core::Error> {
    const REGISTRY_OPTS: JSONOptions = JSONOptions {
        is_json: true,
        json_warn_duplicate_keys: false,
        ..JSONOptions::DEFAULT
    };
    parse_immutable(source, log, REGISTRY_OPTS)
}

/// package.json (comments & trailing commas allowed), as the document's
/// rows. See [`ParsedJson`].
pub fn parse_package_json_utf8_immutable(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
) -> Result<ParsedJson, bun_core::Error> {
    parse_immutable(source, log, PACKAGE_JSON_OPTS)
}

/// Strict JSON, as the document's rows. See [`ParsedJson`].
pub fn parse_utf8_immutable(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
) -> Result<ParsedJson, bun_core::Error> {
    parse_immutable(source, log, JSON_OPTS)
}

/// The tsconfig/`.jsonc` dialect (comments, trailing commas), as the
/// document's rows. See [`ParsedJson`].
pub fn parse_ts_config_immutable(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
) -> Result<ParsedJson, bun_core::Error> {
    parse_immutable(source, log, TSCONFIG_OPTS)
}

/// Strict JSON, as the document's rows, with the whole document — its
/// [`E::JsonTape`] included — allocated in `arena`. For callers whose AST
/// lifetime *is* an arena and that never run `Drop` (the bundler / module
/// loader): nothing is returned to free, the arena's bulk free is the free,
/// and everything reachable from the root is valid until the arena resets.
pub fn parse_utf8_immutable_in(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    arena: &Bump,
) -> Result<Expr, bun_core::Error> {
    parse_immutable_in(source, log, JSON_OPTS, arena)
}

/// [`parse_utf8_immutable_in`] for the tsconfig/`.jsonc` dialect (comments,
/// trailing commas).
pub fn parse_ts_config_immutable_in(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    arena: &Bump,
) -> Result<Expr, bun_core::Error> {
    parse_immutable_in(source, log, TSCONFIG_OPTS, arena)
}

/// Shared driver for the immutable-AST entry points. No arena: the document's
/// [`E::JsonTape`] owns everything the parse allocates and is returned to
/// the caller.
fn parse_immutable(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    opts: JSONOptions,
) -> Result<ParsedJson, bun_core::Error> {
    if source.contents.is_empty() {
        // Empty input parses as `{}`, like the classic entry points: a
        // rowless object backed by an empty tape, so consumers checking for
        // an `EObjectJSON` root see one.
        let tape = Box::new(E::JsonTape::empty());
        let root = Expr::init(
            E::ObjectJSON::new(&tape, 0, 0, true, bun_ast::Loc::EMPTY),
            bun_ast::Loc { start: 0 },
        );
        return Ok(ParsedJson {
            root,
            tape: Some(tape),
        });
    }
    let out = parse_impl(source, log, opts, false)?;
    Ok(ParsedJson {
        root: out.root,
        tape: out.tape,
    })
}

/// [`parse_immutable`], with the tape (and every buffer in it) inside `arena`.
fn parse_immutable_in(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    opts: JSONOptions,
    arena: &Bump,
) -> Result<Expr, bun_core::Error> {
    let tape_alloc = E::TapeAlloc::Arena(core::ptr::NonNull::from(arena));
    if source.contents.is_empty() {
        // See `parse_immutable`: an empty document is an empty object.
        let tape = arena.alloc(E::JsonTape::empty_in(tape_alloc));
        return Ok(Expr::init(
            E::ObjectJSON::new(tape, 0, 0, true, bun_ast::Loc::EMPTY),
            bun_ast::Loc { start: 0 },
        ));
    }
    Ok(parse_impl_in(source, log, opts, false, tape_alloc)?.root)
}

/// Parse package.json (comments & trailing commas allowed, strings UTF-8).
/// Classic `E::Object` AST: these callers (install, `bun pm pkg`, lockfile,
/// init) mutate and re-print the tree, which the read-only immutable containers
/// cannot represent. Parsed immutable and [`materialize`]d.
pub fn parse_package_json_utf8(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    Ok(parse_classic(source, log, bump, PACKAGE_JSON_OPTS, false)?.root)
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
            was_originally_macro: WAS_ORIGINALLY_MACRO,
            guess_indentation: GUESS_INDENTATION,
            record_value_locs: false,
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
            ..Default::default()
        });
    }
    let out = parse_classic(source, log, bump, opts, false)?;
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
    Ok(parse_classic(source, log, bump, MACRO_JSON_OPTS, false)?.root)
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
    let out = parse_classic(source, log, bump, JSON_OPTS, false)?;
    Ok(JSONParseResult {
        tag: if out.is_ascii_only {
            JSONParseResultTag::Ascii
        } else {
            JSONParseResultTag::Expr
        },
        expr: out.root,
    })
}

/// `tsconfig.json` / `.jsonc` (the dialect: comments, trailing commas).
///
/// Classic `E::Object` AST — the tsconfig walker, bunfig, and the bundler's
/// `.jsonc` module loader pattern-match `Expr` nodes (and the first two
/// report diagnostics with per-value `Loc`s), so the immutable parse is
/// [`materialize`]d at this boundary with every location intact.
/// `FORCE_UTF8` is accepted for source compatibility and ignored (see
/// [`parse`]).
#[inline]
pub fn parse_ts_config<const FORCE_UTF8: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr());
    }
    Ok(parse_classic(source, log, bump, TSCONFIG_OPTS, false)?.root)
}

/// `Bun.JSONC.parse`: the same dialect as tsconfig (comments, trailing
/// commas), but producing the compact JSON-only containers
/// (`E::ObjectJSON` — see `JSONOptions::immutable`). The only
/// consumer is `Expr::to_js`, which understands them.
pub fn parse_jsonc(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
) -> Result<ParsedJson, bun_core::Error> {
    parse_immutable(source, log, TSCONFIG_OPTS)
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
            Ok(parse_classic(source, log, bump, DOTENV_JSON_OPTS, false)?.root)
        }
        // `-1`, `.5`, `-.5`: a sign or dot starts JSON only when a number
        // follows; `-foo` / `.foo` are implicitly quoted strings.
        b'-' | b'.' if leads_a_number(contents) => {
            Ok(parse_classic(source, log, bump, DOTENV_JSON_OPTS, false)?.root)
        }
        _ => {
            // Keyword fast paths: the first token alone decides (no EOF
            // required after it).
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

/// Does a `.env`/`--define` value starting with `-` or `.` begin a numeric
/// literal (`-1`, `.5`, `-.5`)? Anything else is an implicitly quoted
/// string, like every other non-JSON first byte.
fn leads_a_number(contents: &[u8]) -> bool {
    let after_sign = if contents[0] == b'-' {
        &contents[1..]
    } else {
        contents
    };
    match after_sign.first() {
        Some(b'0'..=b'9') => true,
        Some(b'.') => matches!(after_sign.get(1), Some(b'0'..=b'9')),
        _ => false,
    }
}

/// The `.env`/`--define` "auto quote" path: lex the whole input as a string
/// literal with no quote character (terminated by a newline or EOF),
/// decoding escape sequences — the JS lexer's
/// `parse_string_literal_inner::<0>` contract.
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
// This runs once per installed package (`verify_package_json_name_and_
// version`), so it does the least work a parse can: the immutable AST, read
// straight off the document's row tape — no classic nodes, no arena, and
// nothing outliving the call but the two copied strings.

pub struct PackageJSONVersionChecker<'a> {
    source: &'a bun_ast::Source,
    log: &'a mut bun_ast::Log,

    pub found_version_buf: [u8; 1024],
    pub found_name_buf: [u8; 1024],
    found_name_len: usize,
    found_version_len: usize,
    pub has_found_name: bool,
    pub has_found_version: bool,
}

impl<'a> PackageJSONVersionChecker<'a> {
    pub fn init(source: &'a bun_ast::Source, log: &'a mut bun_ast::Log) -> Self {
        Self {
            source,
            log,
            found_version_buf: [0; 1024],
            found_name_buf: [0; 1024],
            found_name_len: 0,
            found_version_len: 0,
            has_found_name: false,
            has_found_version: false,
        }
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

    /// Parse the document and record its first top-level `name` and
    /// `version` properties whose values are strings.
    pub fn parse(&mut self) -> Result<(), bun_core::Error> {
        let parsed = parse_immutable(self.source, self.log, PKG_JSON_CHECKER_OPTS)?;
        let js_ast::expr::Data::EObjectJSON(obj) = &parsed.root.data else {
            return Ok(());
        };
        for row in obj.get().properties() {
            let Some(value) = row.value.as_str() else {
                continue;
            };
            if !self.has_found_name && row.key.slice() == b"name" {
                let len = value.len().min(self.found_name_buf.len());
                self.found_name_buf[..len].copy_from_slice(&value[..len]);
                self.found_name_len = len;
                self.has_found_name = true;
            } else if !self.has_found_version && row.key.slice() == b"version" {
                let len = value.len().min(self.found_version_buf.len());
                self.found_version_buf[..len].copy_from_slice(&value[..len]);
                self.found_version_len = len;
                self.has_found_version = true;
            }
            if self.has_found_name && self.has_found_version {
                break;
            }
        }
        Ok(())
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

// ──────────────────────────────────────────────────────────────────────────
// Source-location recovery
// ──────────────────────────────────────────────────────────────────────────
//
// The immutable JSON AST (`E::ObjectJSON` / `E::ArrayJSON`) stores no
// per-value locations: a property row records only its key's location and
// containers their own. Two consumers recover a *value*'s location by
// re-scanning the source it was parsed from:
//
//   - error reporters that point at a value or array item (strictly
//     cold-path work — a diagnostic is about to be printed — so the linear
//     scans don't matter), via `property_value_loc` / `array_item_loc`;
//   - [`materialize`], which re-derives the exact `Loc` of every classic
//     node with one forward sweep per container.

/// Location of the first byte of the value of the property whose key string
/// token starts at `key_loc` (= [`E::PropertyJSON::key_loc`], the opening
/// quote): the key token, then any whitespace/comments, the `:`, and any
/// whitespace/comments after it are skipped.
///
/// `contents` must be the bytes the property was parsed from. Returns `None`
/// when they aren't (the bytes at `key_loc` don't look like `"key" : value`)
/// or `key_loc` is empty, so callers can fall back to the key's location.
pub fn property_value_loc(contents: &[u8], key_loc: bun_ast::Loc) -> Option<bun_ast::Loc> {
    let key_start = usize::try_from(key_loc.start).ok()?;
    let after_key = skip_string_token(contents, key_start)?;
    let colon = skip_ws_and_comments(contents, after_key)?;
    if contents[colon] != b':' {
        return None;
    }
    let value = skip_ws_and_comments(contents, colon + 1)?;
    Some(bun_ast::usize2loc(value))
}

/// [`property_value_loc`] with the key's location as the fallback: the
/// diagnostic-site spelling every consumer of the immutable AST wants
/// (`None` only means the bytes don't match, where the key is the best
/// location available).
#[inline]
pub fn property_value_loc_or_key(contents: &[u8], key_loc: bun_ast::Loc) -> bun_ast::Loc {
    property_value_loc(contents, key_loc).unwrap_or(key_loc)
}

/// Sibling of [`property_value_loc`] for array items: the location of the
/// first byte of item `index` of the array whose `[` is at `array_loc`
/// (= the `E::ArrayJSON` expression's `loc`). `None` if the array's source
/// has fewer than `index + 1` items (or `contents`/`array_loc` don't match).
///
/// Linear in the array's source extent: a caller visiting every item should
/// sweep with [`array_first_item`] / [`array_next_item`] instead.
pub fn array_item_loc(
    contents: &[u8],
    array_loc: bun_ast::Loc,
    index: usize,
) -> Option<bun_ast::Loc> {
    let mut p = array_first_item(contents, usize::try_from(array_loc.start).ok()?)?;
    for _ in 0..index {
        p = array_next_item(contents, p)?;
    }
    Some(bun_ast::usize2loc(p))
}

/// Exact source location of a property's value for a diagnostic, given the
/// value `Expr` a property lookup or [`Expr::for_each_property`] returned:
/// a node from the mutable tree carries its own location; a value
/// materialized from an immutable row carries its *key's*, so the value's
/// first byte is recovered from the source (cold path).
pub fn value_loc_of_property(contents: &[u8], key_loc: bun_ast::Loc, value: &Expr) -> bun_ast::Loc {
    if value.loc != key_loc {
        return value.loc;
    }
    property_value_loc_or_key(contents, key_loc)
}

/// Where an immutable-AST JSON value sits in its document, so its exact
/// source location can be recovered on a (cold) diagnostic path — the rows
/// store no per-value `Loc`. Parents chain by reference; nothing is
/// re-scanned unless a diagnostic actually fires.
#[derive(Clone, Copy)]
pub enum ValueLocation<'p> {
    /// The value of the property whose key token starts at this `Loc`.
    Property(bun_ast::Loc),
    /// Item `index` of the array whose own position is the parent.
    ArrayItem(&'p ValueLocation<'p>, usize),
}

impl ValueLocation<'_> {
    /// First byte of the value, falling back to the nearest key/container
    /// location when the source cannot be re-scanned.
    pub fn resolve(&self, contents: &[u8]) -> bun_ast::Loc {
        match self {
            ValueLocation::Property(key_loc) => property_value_loc_or_key(contents, *key_loc),
            ValueLocation::ArrayItem(array, index) => {
                let array_loc = array.resolve(contents);
                array_item_loc(contents, array_loc, *index).unwrap_or(array_loc)
            }
        }
    }
}

/// Sibling of [`array_item_loc`] for visiting every item: the location of
/// the item after the one starting at `item_loc`, in one forward step.
/// `None` past the last item (or when the bytes don't match).
pub fn array_next_item_loc(contents: &[u8], item_loc: bun_ast::Loc) -> Option<bun_ast::Loc> {
    let p = array_next_item(contents, usize::try_from(item_loc.start).ok()?)?;
    Some(bun_ast::usize2loc(p))
}

/// Byte offset of the first byte of the first item of the array whose `[` is
/// at `start`. `None` for an empty array or non-matching bytes.
fn array_first_item(contents: &[u8], start: usize) -> Option<usize> {
    if *contents.get(start)? != b'[' {
        return None;
    }
    let p = skip_ws_and_comments(contents, start + 1)?;
    (!matches!(contents[p], b']' | b',')).then_some(p)
}

/// Byte offset of the first byte of the item after the one starting at
/// `item`: the item's value, any whitespace/comments, the `,`, and any
/// whitespace/comments after it are skipped. `None` past the last item.
fn array_next_item(contents: &[u8], item: usize) -> Option<usize> {
    let p = skip_json_value(contents, item)?;
    let p = skip_ws_and_comments(contents, p)?;
    if contents[p] != b',' {
        return None;
    }
    let p = skip_ws_and_comments(contents, p + 1)?;
    (!matches!(contents[p], b']' | b',')).then_some(p)
}

/// Byte offset just past the string token whose opening `"` / `'` is at
/// `start`. `None` if `start` isn't a quote or the string is unterminated.
fn skip_string_token(contents: &[u8], start: usize) -> Option<usize> {
    let quote = *contents.get(start)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let mut p = start + 1;
    while p < contents.len() {
        match contents[p] {
            b'\\' => p += 2,
            b if b == quote => return Some(p + 1),
            _ => p += 1,
        }
    }
    None
}

/// First byte offset at/after `from` that isn't whitespace (including the
/// exotic unicode whitespace the parser skips between tokens) or part of a
/// `//` / `/* */` comment. `None` at end of input or in an unterminated
/// block comment.
fn skip_ws_and_comments(contents: &[u8], mut p: usize) -> Option<usize> {
    use bun_core::strings;
    while p < contents.len() {
        let b = contents[p];
        match b {
            b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C => p += 1,
            b'/' => match contents.get(p + 1) {
                Some(b'/') => {
                    p += 2;
                    while p < contents.len() && contents[p] != b'\n' {
                        p += 1;
                    }
                }
                Some(b'*') => {
                    let end = strings::index_of(&contents[p + 2..], b"*/")?;
                    p += 2 + end + 2;
                }
                _ => return Some(p),
            },
            _ if b >= 0x80 => {
                // A multi-byte codepoint: only exotic whitespace is skipped.
                let iterator = strings::CodepointIterator::init(&contents[p..]);
                let mut cursor = strings::Cursor::default();
                if !iterator.next(&mut cursor)
                    || !crate::json_stage2::is_exotic_whitespace(cursor.c)
                {
                    return Some(p);
                }
                p += (cursor.width as usize).max(1);
            }
            _ => return Some(p),
        }
    }
    None
}

/// Byte offset just past the JSON/JSONC value starting at `p` (a string,
/// container, or primitive token).
fn skip_json_value(contents: &[u8], p: usize) -> Option<usize> {
    match *contents.get(p)? {
        b'"' | b'\'' => skip_string_token(contents, p),
        open @ (b'{' | b'[') => {
            let close = if open == b'{' { b'}' } else { b']' };
            let mut depth = 0usize;
            let mut q = p;
            while q < contents.len() {
                match contents[q] {
                    b'"' | b'\'' => q = skip_string_token(contents, q)?,
                    b'/' if matches!(contents.get(q + 1), Some(b'/' | b'*')) => {
                        q = skip_ws_and_comments(contents, q)?;
                    }
                    b'{' | b'[' => {
                        depth += 1;
                        q += 1;
                    }
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            // Containers of mixed kinds nest, so only the
                            // matching closer can bring `depth` back to 0.
                            debug_assert_eq!(contents[q], close);
                            return Some(q + 1);
                        }
                        q += 1;
                    }
                    _ => q += 1,
                }
            }
            None
        }
        // A primitive token (number, `true`/`false`/`null`): everything up
        // to the next delimiter, whitespace, or comment.
        _ => {
            let mut q = p;
            while q < contents.len() {
                match contents[q] {
                    b',' | b']' | b'}' | b':' => break,
                    b'/' if matches!(contents.get(q + 1), Some(b'/' | b'*')) => break,
                    b if b.is_ascii_whitespace() || b >= 0x80 => break,
                    _ => q += 1,
                }
            }
            (q > p).then_some(q)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Materialization: immutable AST → classic AST
// ──────────────────────────────────────────────────────────────────────────

/// Deep-convert an immutable-AST document (`E::ObjectJSON` / `E::ArrayJSON`)
/// into the classic `E::Object` / `E::Array` tree, indistinguishable from a
/// classic parse of the same `source`:
///
/// - every property value, array item, and nested container carries its
///   exact source [`Loc`](bun_ast::Loc) again, recovered by re-scanning
///   `source` from the locations the immutable AST does keep (a property's key,
///   a container's opening bracket). One forward pass per container — see
///   the "Cold-path source-location recovery" section above. If the bytes
///   don't match (a caller passed the wrong source) the key's / container's
///   location is used instead, never a bogus one.
/// - strings that don't borrow `source` (escape-decoded into the document's
///   [`E::JsonTape`], which a caller materializing at a boundary is about to
///   drop) are copied into `bump`, exactly where the classic parser put them.
///
/// Everything else (`is_single_line`, closing-bracket locations, property
/// order and duplicates) is preserved. A non-container root is returned
/// unchanged apart from the string re-homing.
///
/// This is the boundary for consumers that genuinely need the classic tree —
/// to mutate it and print it back, or to splice it into a JavaScript AST.
/// Everything that just *reads* JSON should stay on the immutable containers.
pub fn materialize(root: &Expr, source: &bun_ast::Source, bump: &Bump) -> Expr {
    materialize_impl(root, source, bump, false)
}

/// [`materialize`] with the one parse option a classic container records
/// that the immutable containers don't.
fn materialize_impl(
    root: &Expr,
    source: &bun_ast::Source,
    bump: &Bump,
    was_originally_macro: bool,
) -> Expr {
    Materializer {
        contents: &source.contents,
        bump,
        was_originally_macro,
    }
    .expr(root, root.loc)
}

struct Materializer<'a> {
    contents: &'a [u8],
    bump: &'a Bump,
    /// `E::Object::was_originally_macro` of every materialized container
    /// (the immutable containers don't store it; it is an option of the parse).
    was_originally_macro: bool,
}

impl Materializer<'_> {
    fn expr(&self, e: &Expr, loc: bun_ast::Loc) -> Expr {
        match &e.data {
            js_ast::expr::Data::EObjectJSON(o) => Expr::init(self.object(o.get()), loc),
            js_ast::expr::Data::EArrayJSON(a) => Expr::init(self.array(a.get(), loc), loc),
            // The root of a scalar document can be a string that borrows the
            // tape (an escaped literal); everything else is inline or in the
            // Store and survives the tape. Immutable-AST strings are always
            // UTF-8, so `init` rebuilds the node losslessly.
            js_ast::expr::Data::EString(s) => {
                Expr::init(E::EString::init(self.rehome(s.get().data).slice()), loc)
            }
            _ => Expr { data: e.data, loc },
        }
    }

    fn object(&self, o: &E::ObjectJSON) -> E::Object {
        let rows = o.properties();
        let mut properties: G::PropertyList =
            Vec::with_capacity_in(rows.len(), bun_alloc::AstAlloc);
        // Exact value locations: recorded by the parse when the entry point
        // asked for them (`record_value_locs`); recovered from the source
        // otherwise (an immutable parse materialized after the fact).
        let value_locs = o.value_locs();
        for (i, row) in rows.iter().enumerate() {
            let key = Expr::init(
                E::String {
                    data: self.rehome(row.key),
                    ..Default::default()
                },
                row.key_loc,
            );
            let value_loc = match value_locs {
                Some(locs) => locs[i],
                None => property_value_loc_or_key(self.contents, row.key_loc),
            };
            properties.push(G::Property {
                key: Some(key),
                value: Some(self.json_value(&row.value, value_loc)),
                kind: G::PropertyKind::Normal,
                initializer: None,
                ..Default::default()
            });
        }
        E::Object {
            properties,
            is_single_line: o.is_single_line,
            was_originally_macro: self.was_originally_macro,
            close_brace_loc: o.close_brace_loc,
            ..Default::default()
        }
    }

    fn array(&self, a: &E::ArrayJSON, loc: bun_ast::Loc) -> E::Array {
        let rows = a.items();
        let mut items: js_ast::ExprNodeList =
            Vec::with_capacity_in(rows.len(), bun_alloc::AstAlloc);
        // Exact item locations: recorded by the parse when asked for
        // (`record_value_locs`); otherwise one forward sweep over the
        // array's source, falling back to the array's own location.
        let item_locs = a.item_locs();
        let mut cursor = match item_locs {
            Some(_) => None,
            None => usize::try_from(loc.start)
                .ok()
                .and_then(|start| array_first_item(self.contents, start)),
        };
        for (i, item) in rows.iter().enumerate() {
            let item_loc = match item_locs {
                Some(locs) => locs[i],
                None => cursor.map_or(loc, bun_ast::usize2loc),
            };
            items.push(self.json_value(item, item_loc));
            if item_locs.is_none() {
                cursor = cursor.and_then(|p| array_next_item(self.contents, p));
            }
        }
        E::Array {
            items,
            is_single_line: a.is_single_line,
            was_originally_macro: self.was_originally_macro,
            close_bracket_loc: a.close_bracket_loc,
            ..Default::default()
        }
    }

    /// One row value at its recovered location; nested containers recurse.
    fn json_value(&self, value: &E::JsonValue, loc: bun_ast::Loc) -> Expr {
        match value {
            E::JsonValue::Object(o) => Expr::init(self.object(o.get()), loc),
            E::JsonValue::Array(a) => Expr::init(self.array(a.get(), loc), loc),
            E::JsonValue::String(s) => Expr::init(E::EString::init(self.rehome(*s).slice()), loc),
            _ => Expr::from_json_value(value, loc),
        }
    }

    /// `bytes`, but never borrowing the document's tape: a slice of the
    /// source is returned as-is (the common, zero-copy case) and anything
    /// else — escape-decoded bytes the tape owns — is copied into the arena
    /// the classic tree's strings belong to.
    fn rehome(&self, bytes: E::Str) -> E::Str {
        let source = self.contents.as_ptr_range();
        let p = bytes.slice().as_ptr();
        if source.contains(&p) {
            return bytes;
        }
        E::Str::new(self.bump.alloc_slice_copy(bytes.slice()))
    }
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
        // Keep the arena and the row tape alive for the AST's lifetime.
        _bump: Box<Bump>,
        _tape: Option<Box<E::JsonTape>>,
        _scope: js_ast::StoreResetGuard,
    }

    fn run(contents: &[u8], which: Which) -> Parsed {
        bun_ast::initialize_store_or_reset();
        let scope = js_ast::StoreResetGuard::new();
        let mut log = bun_ast::Log::init();
        let bump = Box::new(Bump::new());
        let source = bun_ast::Source::init_path_string("fixture.json", contents);
        let mut tape = None;
        let r = match which {
            Which::Utf8 => parse_utf8(&source, &mut log, &bump),
            Which::Plain => parse::<false>(&source, &mut log, &bump),
            Which::TsConfig => parse_ts_config::<true>(&source, &mut log, &bump),
            Which::Env => parse_env_json(&source, &mut log, &bump),
            Which::PackageJson => parse_package_json_utf8(&source, &mut log, &bump),
            Which::Jsonc => parse_jsonc(&source, &mut log).map(|p| {
                tape = p.tape;
                p.root
            }),
            Which::Immutable => parse_immutable(
                &source,
                &mut log,
                JSONOptions {
                    is_json: true,
                    ..JSONOptions::DEFAULT
                },
            )
            .map(|mut p| {
                tape = p.tape.take();
                p.root
            }),
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
            _tape: tape,
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
        /// `Bun.JSONC.parse`'s entry: tsconfig dialect + `immutable`.
        Jsonc,
        /// Strict JSON + `immutable` (what a registry-manifest caller
        /// would use).
        Immutable,
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
            Data::EObjectJSON(o) => {
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
            Data::EArrayJSON(a) => {
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
    // test/js/bun/jsonc/jsonc.test.ts, where it exercises the real binary.)

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
        // Keywords, including the `\uXXXX`-escaped spelling that
        // `parse_escaped_identifier` accepts.
        let p = run(br"[\u0074rue, \u0066alse, \u006eull]", Which::Utf8);
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

    /// One parse, two output shapes: the compact row containers
    /// (`immutable`) and the classic tree the classic-output entry
    /// points materialize from them must be semantically identical — same
    /// canonical JSON, same warnings, same errors — on every shape the
    /// parser supports.
    #[test]
    fn immutable_rows_match_the_materialized_tree() {
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
            let (sr, se, sw, sm) = canon(doc, Which::Immutable);
            assert_eq!((fe, fw, &fm), (se, sw, &sm), "log differs for {doc:?}");
            if fr != sr {
                let (a, b) = (fr.unwrap_or_default(), sr.unwrap_or_default());
                let i = a
                    .bytes()
                    .zip(b.bytes())
                    .position(|(x, y)| x != y)
                    .unwrap_or(a.len().min(b.len()));
                panic!(
                    "values differ at byte {i}:\n full: ...{}\n immutable: ...{}",
                    &a[i.saturating_sub(40)..(i + 40).min(a.len())],
                    &b[i.saturating_sub(40)..(i + 40).min(b.len())],
                );
            }
        }
        // The JSONC entry (comments + trailing commas + single quotes) too.
        let jsonc = "// c\n{\"a\": [1, 2,], /* x */ \"b\": 'sq', } ";
        assert_eq!(canon(jsonc, Which::TsConfig), canon(jsonc, Which::Jsonc));
    }

    /// A standalone `json::materialize` over a row tree must produce a
    /// classic tree *indistinguishable* from what the classic-output entry
    /// points return for the same document (they materialize at their own
    /// boundary): no immutable nodes left, identical canonical JSON, and the
    /// exact same `loc` and `is_single_line` on **every** node (keys,
    /// values, array items, nested containers), across comments, escapes,
    /// trailing commas, and exotic whitespace.
    #[test]
    fn materialize_matches_the_classic_entry_points() {
        // Canonical JSON + every node of a classic tree in pre-order as
        // (loc, leaf text or container shape).
        type Nodes = Vec<(i32, std::string::String)>;
        fn canon_full(root: &Expr) -> (std::string::String, Nodes) {
            fn nodes(e: &Expr, out: &mut Nodes) {
                let label = match &e.data {
                    Data::EObject(o) => format!("{{:{}", o.is_single_line),
                    Data::EArray(a) => format!("[:{}", a.is_single_line),
                    Data::EObjectJSON(_) | Data::EArrayJSON(_) => {
                        panic!("immutable node in a materialized/full tree")
                    }
                    _ => {
                        let mut s = std::string::String::new();
                        to_json_string(e, &mut s);
                        s
                    }
                };
                out.push((e.loc.start, label));
                match &e.data {
                    Data::EObject(o) => {
                        for prop in o.properties.iter() {
                            nodes(prop.key.as_ref().unwrap(), out);
                            nodes(prop.value.as_ref().unwrap(), out);
                        }
                    }
                    Data::EArray(a) => {
                        for item in a.items.iter() {
                            nodes(item, out);
                        }
                    }
                    _ => {}
                }
            }
            let mut s = std::string::String::new();
            to_json_string(root, &mut s);
            let mut n = Vec::new();
            nodes(root, &mut n);
            (s, n)
        }
        let mut deep = std::string::String::from("1");
        for _ in 0..40 {
            deep = format!("{{\"k\": [{deep}]}}");
        }
        let mut generated = std::string::String::from("{");
        for i in 0..120 {
            if i > 0 {
                generated.push(',');
            }
            generated.push_str(&format!(
                "\"k{i}\": [{i}, -1.5e3,\"s{i}\" , \"esc\\n\\u00e9{i}\", true, false, null, {{\"n\": {{\"deep\": [\"x{i}\"]}}}}]"
            ));
        }
        generated.push('}');
        let docs: Vec<(&str, Which, Which)> = vec![
            ("{}", Which::Utf8, Which::Immutable),
            ("[]", Which::Utf8, Which::Immutable),
            ("\"leaf\"", Which::Utf8, Which::Immutable),
            ("\"l\\u00e9af\\n\"", Which::Utf8, Which::Immutable),
            ("-3.25e2", Which::Utf8, Which::Immutable),
            (
                r#"{"a": 1, "b": [true, null, "x", [], {}], "c": {"d": "é🚀", "e": ""}, "es\ncé": -0}"#,
                Which::Utf8,
                Which::Immutable,
            ),
            (
                "[0, -1.5e3, \"s\", {\"n\": {\"deep\": [\"x\"]}},\n[\n1\n]\n]",
                Which::Utf8,
                Which::Immutable,
            ),
            (&deep, Which::Utf8, Which::Immutable),
            (&generated, Which::Utf8, Which::Immutable),
            // JSONC: comments, trailing commas, single quotes.
            (
                "// c\n{\"a\": [1, 2,], /* x */ \"b\": 'sq', }",
                Which::TsConfig,
                Which::Jsonc,
            ),
            // Comments and exotic unicode whitespace in every gap a value
            // location is recovered across.
            (
                "{\n  // line\n  \"a\" /* k */ : // v\n   42,\n  \"arr\": [ /* a */ 1,\n     [2], // b\n   {'z': 'q'},\n  ],\n}",
                Which::TsConfig,
                Which::Jsonc,
            ),
            (
                "{\"\u{e9}k\":\u{a0}\u{feff} 1,\"l\":\u{a0}[\u{a0}1\u{a0},\u{a0}2]}",
                Which::TsConfig,
                Which::Jsonc,
            ),
        ];
        for (doc, full_which, immutable_which) in docs {
            let full = {
                let p = run(doc.as_bytes(), full_which);
                let root = p.root.unwrap();
                (root.loc, canon_full(&root))
            };
            let materialized = {
                let p = run(doc.as_bytes(), immutable_which);
                // The same bytes `run` parsed, for the location re-scan.
                let source = bun_ast::Source::init_path_string("fixture.json", doc.as_bytes());
                let bump = Bump::new();
                let root = materialize(p.root.as_ref().unwrap(), &source, &bump);
                (root.loc, canon_full(&root))
            };
            assert_eq!(full, materialized, "materialized tree differs for {doc:?}");
        }
    }

    /// Cold-path value-location recovery: for every property and array item
    /// of a document, re-scanning the source from the locations the immutable
    /// AST keeps must land exactly on the location the classic tree records
    /// for the value, across whitespace, comments, escapes, and exotic
    /// unicode whitespace.
    #[test]
    fn value_location_recovery() {
        fn walk(src: &[u8], e: &Expr) {
            match &e.data {
                Data::EObject(o) => {
                    for prop in o.properties.iter() {
                        let key = prop.key.unwrap();
                        let value = prop.value.unwrap();
                        assert_eq!(
                            property_value_loc(src, key.loc),
                            Some(value.loc),
                            "value loc of the key at byte {} of {:?}",
                            key.loc.start,
                            std::string::String::from_utf8_lossy(src),
                        );
                        walk(src, &value);
                    }
                }
                Data::EArray(a) => {
                    for (i, item) in a.items.iter().enumerate() {
                        assert_eq!(
                            array_item_loc(src, e.loc, i),
                            Some(item.loc),
                            "loc of item {i} of the array at byte {} of {:?}",
                            e.loc.start,
                            std::string::String::from_utf8_lossy(src),
                        );
                        walk(src, item);
                    }
                    // One past the end is "no such item", not a bogus loc.
                    assert_eq!(array_item_loc(src, e.loc, a.items.len()), None);
                }
                _ => {}
            }
        }
        let docs: [&str; 5] = [
            r#"{"a":1,"b" : "two", "es\"cé\\" :  [1, "x", {"y":null}, true, ["", -2]], "c":{"d":3}}"#,
            // Multiline JSONC: line + block comments on both sides of `:`
            // and between array items, trailing commas.
            "{\n  // line\n  \"a\" /* k */ : // v\n   42,\n  \"arr\": [ /* a */ 1,\n     [2], // b\n   {'z': 'q'},\n  ],\n}",
            // Exotic unicode whitespace (NBSP, BOM) in the gaps.
            "{\"\u{e9}k\":\u{a0}\u{feff} 1,\"l\":\u{a0}[\u{a0}1\u{a0},\u{a0}2]}",
            "[]",
            "[ [ ] , { } , \"]\" ]",
        ];
        for doc in docs {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert_eq!(p.errors, 0, "fixture must parse: {doc:?}");
            walk(doc.as_bytes(), p.root.as_ref().unwrap());
        }
        // Hand-positioned: the recovered loc is the value's first byte.
        let doc = b"{\"k\" /* : 9 */ : /* x */ 42}";
        let key_loc = bun_ast::usize2loc(1);
        let value_loc = property_value_loc(doc, key_loc).unwrap();
        assert_eq!(value_loc.start as usize, 25);
        assert_eq!(&doc[value_loc.start as usize..][..2], b"42");
        // Mismatched source (no `:` after the key token): None, never a
        // bogus location.
        assert_eq!(property_value_loc(b"{\"k\", 1}", key_loc), None);
        assert_eq!(property_value_loc(b"{\"k\"", key_loc), None);
        assert_eq!(array_item_loc(b"{}", bun_ast::usize2loc(0), 0), None);
    }

    /// The generic `Expr` accessors (`get`, `as_property`, `as_array`,
    /// `as_string`, ...) must observe the same document through a
    /// `Which::Immutable` root — where leaf values are wrapped into `Expr`s
    /// out of the row tape on demand — as through the classic tree.
    #[test]
    fn immutable_expr_accessor_materialization() {
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
            // skipped by the full-AST implementation; immutable must match).
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
            // Empty containers: same `None` contract as the classic AST.
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
        let immutable = probe(doc, Which::Immutable);
        assert_eq!(full, immutable);
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
        let source = bun_ast::Source::init_path_string(
            "package.json",
            br#"{"private": true, "name": "my-pkg", "scripts": {"x": "y"}, "version": "1.2.3"}"#
                .as_slice(),
        );
        let mut checker = PackageJSONVersionChecker::init(&source, &mut log);
        checker.parse().unwrap();
        assert!(checker.has_found_name && checker.has_found_version);
        assert_eq!(checker.found_name(), b"my-pkg");
        assert_eq!(checker.found_version(), b"1.2.3");
        // Non-string `name`/`version` values are skipped, not coerced; later
        // string-valued duplicates win, exactly like the classic walk.
        let source = bun_ast::Source::init_path_string(
            "package.json",
            br#"{"version": {"x": 1}, "name": 1, "name": "n2", "version": "9.9.9"}"#.as_slice(),
        );
        let mut log = bun_ast::Log::init();
        let mut checker = PackageJSONVersionChecker::init(&source, &mut log);
        checker.parse().unwrap();
        assert_eq!(
            (checker.found_name(), checker.found_version()),
            (b"n2".as_slice(), b"9.9.9".as_slice())
        );
        // Empty input parses to an empty object: nothing found, no error.
        let source = bun_ast::Source::init_path_string("package.json", b"".as_slice());
        let mut log = bun_ast::Log::init();
        let mut checker = PackageJSONVersionChecker::init(&source, &mut log);
        checker.parse().unwrap();
        assert!(!checker.has_found_name && !checker.has_errors());
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
