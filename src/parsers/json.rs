//! JSON / JSONC parser: a SIMD structural indexer ([`crate::json_index`]) plus a
//! recursive-descent stage 2 ([`crate::json_stage2`]) over the resulting index.

use bun_ast::G;

use bun_ast as js_ast;
use bun_ast::Indentation;
use bun_ast::{AstArena, E, Expr, JsonView};
use bun_core::{self};

use crate::json_index::{IndexError, StructuralIndex};
use crate::json_stage2::{Parser, to_json_value};

#[derive(Clone, Copy)]
pub struct JSONOptions {
    pub allow_comments: bool,
    pub allow_trailing_commas: bool,
    pub ignore_leading_escape_sequences: bool,
    pub json_warn_duplicate_keys: bool,
    pub was_originally_macro: bool,
    pub guess_indentation: bool,
    pub record_value_locs: bool,
}

impl JSONOptions {
    pub const DEFAULT: JSONOptions = JSONOptions {
        allow_comments: false,
        allow_trailing_commas: false,
        ignore_leading_escape_sequences: false,
        json_warn_duplicate_keys: true,
        was_originally_macro: false,
        guess_indentation: false,
        record_value_locs: false,
    };
}

const JSON_OPTS: JSONOptions = JSONOptions::DEFAULT;

const DOTENV_JSON_OPTS: JSONOptions = JSONOptions {
    allow_trailing_commas: true,
    ignore_leading_escape_sequences: true,
    ..JSONOptions::DEFAULT
};

const TSCONFIG_OPTS: JSONOptions = JSONOptions {
    allow_comments: true,
    allow_trailing_commas: true,
    ..JSONOptions::DEFAULT
};

const MACRO_JSON_OPTS: JSONOptions = JSONOptions {
    allow_comments: true,
    allow_trailing_commas: true,
    json_warn_duplicate_keys: false,
    was_originally_macro: true,
    ..JSONOptions::DEFAULT
};

pub const PACKAGE_JSON_OPTS: JSONOptions = JSONOptions {
    allow_comments: true,
    allow_trailing_commas: true,
    ..JSONOptions::DEFAULT
};

#[inline]
fn empty_object_expr(arena: &AstArena) -> Expr<'_> {
    Expr::allocate(arena, E::Object::default(), bun_ast::Loc { start: 0 })
}

/// A parsed immutable-AST JSON document: the root value plus the [`E::JsonTape`] it borrows.
pub struct ParsedJson<'a> {
    root: E::JsonValue<'a>,
    root_loc: bun_ast::Loc,
    tape: Option<Box<E::JsonTape<'a>>>,
}

/// `root` is only valid until `tape` is dropped.
struct ParseOutput<'a> {
    root: Expr<'a>,
    tape: Option<Box<E::JsonTape<'a>>>,
    indentation: Indentation,
}

/// `contents` is the text of `source`, here and below: the tree borrows the text and can outlive `source`.
fn parse_impl<'a>(
    source: &bun_ast::Source,
    contents: &'a [u8],
    log: &bun_ast::Log,
    arena: &'a AstArena,
    opts: JSONOptions,
    check_len: bool,
) -> crate::Result<ParseOutput<'a>> {
    let tape_alloc = E::TapeAlloc::Global;
    parse_impl_in(source, contents, log, arena, opts, check_len, tape_alloc)
}

fn parse_impl_in<'a>(
    source: &bun_ast::Source,
    contents: &'a [u8],
    log: &bun_ast::Log,
    arena: &'a AstArena,
    opts: JSONOptions,
    check_len: bool,
    tape_alloc: E::TapeAlloc<'a>,
) -> crate::Result<ParseOutput<'a>> {
    let mut opts = opts;
    if opts.json_warn_duplicate_keys && source.path.is_node_module() {
        opts.json_warn_duplicate_keys = false;
    }

    let mut sidx = StructuralIndex::new(contents);
    if let Some(e) = sidx.index_error {
        return Err(report_index_error(e, source, log));
    }
    let log_mark = (log.errors.get(), log.msgs_len());
    let result = run_stage2(
        source, contents, log, arena, &mut sidx, opts, check_len, tape_alloc,
    );

    let drop_stage2_errors = |log: &bun_ast::Log| {
        log.with_msgs(|msgs| {
            let mut i = log_mark.1;
            while i < msgs.len() {
                if msgs[i].kind == bun_ast::Kind::Err {
                    msgs.remove(i);
                } else {
                    i += 1;
                }
            }
        });
        log.errors.set(log_mark.0);
    };
    let min_stage2_err = |log: &bun_ast::Log| {
        log.with_msgs(|msgs| {
            msgs[log_mark.1..]
                .iter()
                .filter(|m| m.kind == bun_ast::Kind::Err)
                .filter_map(|m| m.data.location.as_ref().map(|l| l.offset))
                .min()
        })
    };
    let rejected_comment = |sidx: &StructuralIndex, before: usize| {
        !opts.allow_comments
            && sidx
                .first_comment
                .is_some_and(|r| (r.loc.start as usize) < before)
    };
    if let Some(e) = sidx.index_error {
        let pos = match e {
            IndexError::UnterminatedBlockComment { pos } | IndexError::UnexpectedSlash { pos } => {
                pos
            }
            IndexError::DocumentTooLarge => 0,
        };
        if !rejected_comment(&sidx, pos) {
            let earlier_stage2_err = log.with_msgs(|msgs| {
                msgs[log_mark.1..]
                    .iter()
                    .filter(|m| m.kind == bun_ast::Kind::Err)
                    .filter_map(|m| m.data.location.as_ref())
                    .any(|l| l.offset + l.length.max(1) <= pos)
            });
            if !earlier_stage2_err {
                drop_stage2_errors(log);
                return Err(report_index_error(e, source, log));
            }
            return Err(crate::Error::SyntaxError);
        }
    }
    if !opts.allow_comments
        && let Some(range) = sidx.first_comment
        && min_stage2_err(log).is_none_or(|first_err| first_err as i32 >= range.loc.start)
    {
        drop_stage2_errors(log);
        log.add_error_fmt_opts(
            format_args!("JSON does not support comments"),
            bun_ast::AddErrorOptions {
                source: Some(source),
                loc: range.loc,
                len: range.len,
                ..Default::default()
            },
        );
        return Err(crate::Error::SyntaxError);
    }
    if sidx.index_error.is_some() || (result.is_ok() && log.errors.get() > log_mark.0) {
        return Err(crate::Error::SyntaxError);
    }
    result
}

fn run_stage2<'a>(
    source: &bun_ast::Source,
    contents: &'a [u8],
    log: &bun_ast::Log,
    arena: &'a AstArena,
    sidx: &mut StructuralIndex<'a>,
    opts: JSONOptions,
    check_len: bool,
    tape_alloc: E::TapeAlloc<'a>,
) -> crate::Result<ParseOutput<'a>> {
    let mut parser = Parser::new(source, contents, log, arena, sidx, opts, tape_alloc);
    let root = parser.parse_value()?;
    if check_len && !parser.at_trailing_end() {
        return Err(parser.unexpected_here());
    }
    let tape = parser.take_tape();
    drop(parser);
    Ok(ParseOutput {
        root,
        tape,
        indentation: if opts.guess_indentation {
            guess_indentation(contents)
        } else {
            Indentation::default()
        },
    })
}

#[cold]
fn report_index_error(
    err: IndexError,
    source: &bun_ast::Source,
    log: &bun_ast::Log,
) -> crate::Error {
    match err {
        IndexError::UnterminatedBlockComment { .. } => {
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
    crate::Error::SyntaxError
}

pub fn guess_indentation(s: &[u8]) -> Indentation {
    let mut i = 0;
    while i < s.len() {
        if s[i] == b'"' || s[i] == b'\'' {
            let q = s[i];
            i += 1;
            while i < s.len() && s[i] != q {
                i += if s[i] == b'\\' { 2 } else { 1 };
            }
            i += 1;
            continue;
        }
        if s[i] == b'/' && s.get(i + 1) == Some(&b'/') {
            i += 2;
            while i < s.len() && s[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if s[i] == b'/' && s.get(i + 1) == Some(&b'*') {
            let Some(close) = bun_core::strings::index_of(&s[i + 2..], b"*/") else {
                return Indentation::default();
            };
            i += 2 + close + 2;
            continue;
        }
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

/// Parse JSON into the classic `E::Object` / `E::Array` AST, with every string stored as UTF-8.
pub fn parse_utf8<'a>(
    source: &'a bun_ast::Source<'_>,
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr(bump));
    }
    Ok(parse_classic(source, &source.contents, log, bump, JSON_OPTS, false)?.root)
}

/// [`parse_utf8`], with nothing but whitespace after the value.
pub fn parse_utf8_document<'a>(
    path: &[u8],
    contents: &'a [u8],
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    if contents.is_empty() {
        return Ok(empty_object_expr(bump));
    }
    let source = bun_ast::Source::init_path_string(path, contents);
    Ok(parse_classic(&source, contents, log, bump, JSON_OPTS, true)?.root)
}

fn parse_classic<'a>(
    source: &bun_ast::Source,
    contents: &'a [u8],
    log: &bun_ast::Log,
    bump: &'a AstArena,
    opts: JSONOptions,
    check_len: bool,
) -> crate::Result<ParseOutput<'a>> {
    let opts = JSONOptions {
        record_value_locs: true,
        ..opts
    };
    let mut out = parse_impl(source, contents, log, bump, opts, check_len)?;
    out.root = match materialize_impl(&out.root, contents, bump, opts.was_originally_macro) {
        Ok(root) => root,
        Err(e) => {
            log.add_error_fmt_opts(
                format_args!("JSON document is too deeply nested"),
                bun_ast::AddErrorOptions {
                    source: Some(source),
                    loc: out.root.loc,
                    ..Default::default()
                },
            );
            return Err(e);
        }
    };
    out.tape = None;
    Ok(out)
}

impl<'a> ParsedJson<'a> {
    pub fn root(&self) -> JsonView<'_, '_> {
        JsonView::from_json_value(&self.root, self.root_loc)
    }

    pub fn root_expr<'s>(&'s self, arena: &'s AstArena) -> Expr<'s> {
        Expr::from_json_value(arena, &self.root, self.root_loc)
    }

    /// Its strings point into the source text or the tape, and its objects and arrays into the arena.
    pub fn into_tape(self) -> Option<Box<E::JsonTape<'a>>> {
        self.tape
    }
}

impl ParsedJson<'_> {
    /// Strict JSON.
    pub fn parse_json<'a>(
        source: &'a bun_ast::Source,
        log: &bun_ast::Log,
        arena: &'a AstArena,
    ) -> crate::Result<ParsedJson<'a>> {
        parse_to_rows(source, log, arena, JSON_OPTS, false)
    }

    /// JSONC (comments and trailing commas).
    pub fn parse_jsonc<'a>(
        source: &'a bun_ast::Source,
        log: &bun_ast::Log,
        arena: &'a AstArena,
    ) -> crate::Result<ParsedJson<'a>> {
        parse_to_rows(source, log, arena, TSCONFIG_OPTS, false)
    }

    /// JSONC, with nothing but whitespace and comments after the value.
    pub fn parse_jsonc_document<'a>(
        source: &'a bun_ast::Source,
        log: &bun_ast::Log,
        arena: &'a AstArena,
    ) -> crate::Result<ParsedJson<'a>> {
        parse_to_rows(source, log, arena, TSCONFIG_OPTS, true)
    }

    /// package.json (comments & trailing commas allowed).
    pub fn parse_package_json<'a>(
        source: &'a bun_ast::Source,
        log: &bun_ast::Log,
        arena: &'a AstArena,
    ) -> crate::Result<ParsedJson<'a>> {
        parse_to_rows(source, log, arena, PACKAGE_JSON_OPTS, false)
    }

    /// A document fetched from an npm registry: strict JSON with no duplicate-key warnings.
    pub fn parse_npm_manifest<'a>(
        source: &'a bun_ast::Source,
        log: &bun_ast::Log,
        arena: &'a AstArena,
    ) -> crate::Result<ParsedJson<'a>> {
        const MANIFEST_OPTS: JSONOptions = JSONOptions {
            json_warn_duplicate_keys: false,
            ..JSONOptions::DEFAULT
        };
        parse_to_rows(source, log, arena, MANIFEST_OPTS, false)
    }
}

/// [`ParsedJson::parse_json`], with the whole document (tape included) allocated in `arena`.
pub fn parse_json_into_arena<'a>(
    source: &'a bun_ast::Source<'_>,
    log: &bun_ast::Log,
    arena: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    parse_to_rows_in(source, log, JSON_OPTS, arena)
}

/// [`parse_json_into_arena`] for the JSONC dialect (comments, trailing commas).
pub fn parse_jsonc_into_arena<'a>(
    source: &'a bun_ast::Source<'_>,
    log: &bun_ast::Log,
    arena: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    parse_to_rows_in(source, log, TSCONFIG_OPTS, arena)
}

fn parse_to_rows<'a>(
    source: &'a bun_ast::Source,
    log: &bun_ast::Log,
    arena: &'a AstArena,
    opts: JSONOptions,
    check_len: bool,
) -> crate::Result<ParsedJson<'a>> {
    if source.contents.is_empty() {
        let mut tape = Box::new(E::JsonTape::empty());
        let root = arena.alloc_node(
            // SAFETY: the tape's own pointer; `ParsedJson` keeps it alive, and
            // an empty span never dereferences it anyway.
            unsafe { E::ObjectJSON::new(tape.root_ptr(), 0, 0, true, bun_ast::Loc::EMPTY) },
        );
        return Ok(ParsedJson {
            root: E::JsonValue::Object(root.into()),
            root_loc: bun_ast::Loc { start: 0 },
            tape: Some(tape),
        });
    }
    let out = parse_impl(source, &source.contents, log, arena, opts, check_len)?;
    Ok(ParsedJson {
        root: to_json_value(out.root.data),
        root_loc: out.root.loc,
        tape: out.tape,
    })
}

fn parse_to_rows_in<'a>(
    source: &'a bun_ast::Source<'_>,
    log: &bun_ast::Log,
    opts: JSONOptions,
    arena: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    let tape_alloc = E::TapeAlloc::Arena(arena.heap());
    if source.contents.is_empty() {
        let tape = arena.alloc(E::JsonTape::empty_in(tape_alloc));
        return Ok(Expr::allocate(
            arena,
            // SAFETY: the arena-allocated tape's own pointer; it lives until the
            // arena resets, and an empty span never dereferences it anyway.
            unsafe { E::ObjectJSON::new(tape.root_ptr(), 0, 0, true, bun_ast::Loc::EMPTY) },
            bun_ast::Loc { start: 0 },
        ));
    }
    Ok(parse_impl_in(
        source,
        &source.contents,
        log,
        arena,
        opts,
        false,
        tape_alloc,
    )?
    .root)
}

/// Parse package.json (comments & trailing commas allowed) into the classic `E::Object` AST.
pub fn parse_package_json_utf8<'a>(
    source: &'a bun_ast::Source<'_>,
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr(bump));
    }
    Ok(parse_classic(
        source,
        &source.contents,
        log,
        bump,
        PACKAGE_JSON_OPTS,
        false,
    )?
    .root)
}

#[derive(Default)]
pub struct JsonResult<'a> {
    pub root: Expr<'a>,
    pub indentation: Indentation,
}

/// package.json with runtime options, into the classic AST plus the document's guessed indentation.
pub fn parse_package_json_utf8_with_opts<'a>(
    opts: JSONOptions,
    source: &'a bun_ast::Source<'_>,
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<JsonResult<'a>> {
    if source.contents.is_empty() {
        return Ok(JsonResult {
            root: empty_object_expr(bump),
            ..Default::default()
        });
    }
    let out = parse_classic(source, &source.contents, log, bump, opts, false)?;
    Ok(JsonResult {
        root: out.root,
        indentation: out.indentation,
    })
}

/// The strings of the result are in `bump`: `json` belongs to an object that the next macro can free.
pub fn parse_for_macro<'a>(
    json: &[u8],
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    if json.is_empty() {
        return Ok(empty_object_expr(bump));
    }
    let contents: &[u8] = bump.alloc_slice_copy(json);
    let source = bun_ast::Source::init_path_string(b"fetch.json", contents);
    Ok(parse_classic(&source, contents, log, bump, MACRO_JSON_OPTS, false)?.root)
}

/// `tsconfig.json` / `.jsonc` (comments, trailing commas) into the classic `E::Object` AST.
#[inline]
pub fn parse_ts_config<'a>(
    source: &'a bun_ast::Source<'_>,
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    if source.contents.is_empty() {
        return Ok(empty_object_expr(bump));
    }
    Ok(parse_classic(source, &source.contents, log, bump, TSCONFIG_OPTS, false)?.root)
}

/// `.env` / `--define` values: JSON, keywords, or an implicitly-quoted string.
pub fn parse_env_json<'a>(
    contents: &'a [u8],
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    if contents.is_empty() {
        return Ok(empty_object_expr(bump));
    }

    if contents.len() >= 2 && contents[0] == b'\\' && matches!(contents[1], b'"' | b'\'') {
        let quote = contents[1];
        let mut unescaped: Vec<u8> = Vec::with_capacity(contents.len());
        unescaped.extend_from_slice(&contents[1..]);
        let n = unescaped.len();
        if n >= 3 && unescaped[n - 2] == b'\\' && unescaped[n - 1] == quote {
            unescaped.truncate(n - 2);
            unescaped.push(quote);
        }
        let rewritten: &[u8] = bump.alloc_slice_copy(&unescaped);
        let rw_source = bun_ast::Source::init_path_string("", rewritten);
        return Ok(parse_classic(&rw_source, rewritten, log, bump, DOTENV_JSON_OPTS, false)?.root);
    }

    let mut source = bun_ast::Source::init_path_string(b"defines.json", contents);
    source.path.namespace = b"internal";
    let source = &source;
    match contents[0] {
        b'{' | b'[' | b'0'..=b'9' | b'"' | b'\'' => {
            Ok(parse_classic(source, contents, log, bump, DOTENV_JSON_OPTS, false)?.root)
        }
        b'-' | b'.' if leads_a_number(contents) => {
            Ok(parse_classic(source, contents, log, bump, DOTENV_JSON_OPTS, false)?.root)
        }
        _ => {
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
            parse_auto_quoted_string(source, contents, log, bump)
        }
    }
}

fn leads_a_number(contents: &[u8]) -> bool {
    let after_sign = if contents[0] == b'-' {
        match skip_ws_and_comments(contents, 1) {
            Some(p) => &contents[p..],
            None => return false,
        }
    } else {
        contents
    };
    match after_sign.first() {
        Some(b'0'..=b'9') => true,
        Some(b'.') => matches!(after_sign.get(1), Some(b'0'..=b'9')),
        _ => false,
    }
}

fn parse_auto_quoted_string<'a>(
    source: &bun_ast::Source,
    contents: &'a [u8],
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    let loc = bun_ast::Loc { start: 0 };

    let mut needs_decode = false;
    let mut i = 0;
    while i < contents.len() {
        match contents[i] {
            b'\\' => {
                needs_decode = true;
                i += 2;
            }
            c if c >= 0x80 => {
                needs_decode = true;
                i += 1;
            }
            _ => i += 1,
        }
    }
    let body = contents;
    if !needs_decode {
        return Ok(Expr::allocate(bump, E::String::init(body), loc));
    }
    let opts = DOTENV_JSON_OPTS;
    match crate::json_stage2::decode_auto_quoted(source, log, bump, body, opts) {
        Ok(s) => Ok(Expr::allocate(bump, s, loc)),
        Err(e) => Err(e),
    }
}

/// Extracts the top-level `name` and `version` strings from a package.json.
pub struct PackageJSONVersionChecker<'a> {
    source: &'a bun_ast::Source<'a>,
    log: &'a bun_ast::Log,

    pub(crate) found_version_buf: [u8; 1024],
    pub(crate) found_name_buf: [u8; 1024],
    found_name_len: usize,
    found_version_len: usize,
    pub has_found_name: bool,
    pub has_found_version: bool,
}

impl<'a> PackageJSONVersionChecker<'a> {
    pub fn init(source: &'a bun_ast::Source<'a>, log: &'a bun_ast::Log) -> Self {
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

    #[inline]
    pub fn has_errors(&self) -> bool {
        self.log.has_errors()
    }

    #[inline]
    pub fn found_name(&self) -> &[u8] {
        &self.found_name_buf[..self.found_name_len]
    }

    #[inline]
    pub fn found_version(&self) -> &[u8] {
        &self.found_version_buf[..self.found_version_len]
    }

    /// Parse the document and record its first top-level string-valued `name` and `version`.
    pub fn parse(&mut self) -> crate::Result<()> {
        let arena = AstArena::new();
        let parsed = parse_to_rows(self.source, self.log, &arena, PKG_JSON_CHECKER_OPTS, false)?;
        let Some(obj) = parsed.root().as_e_object_json() else {
            return Ok(());
        };
        for row in obj.properties() {
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
    json_warn_duplicate_keys: false,
    allow_trailing_commas: true,
    allow_comments: true,
    ..JSONOptions::DEFAULT
};

/// Location of the first byte of the value of the property whose key string token starts at `key_loc`.
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

/// [`property_value_loc`] with the key's location as the fallback.
#[inline]
pub(crate) fn property_value_loc_or_key(contents: &[u8], key_loc: bun_ast::Loc) -> bun_ast::Loc {
    property_value_loc(contents, key_loc).unwrap_or(key_loc)
}

/// Location of the first byte of item `index` of the array whose `[` is at `array_loc`.
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

/// Source location of a property's value, re-scanning `contents` when it only carries its key's.
pub fn value_loc_of_property(
    contents: &[u8],
    key_loc: bun_ast::Loc,
    value_loc: bun_ast::Loc,
) -> bun_ast::Loc {
    if value_loc != key_loc {
        return value_loc;
    }
    property_value_loc_or_key(contents, key_loc)
}

/// Where an immutable-AST JSON value sits in its document, so its source location can be recovered.
#[derive(Clone, Copy)]
pub enum ValueLocation<'p> {
    Property(bun_ast::Loc),
    ArrayItem(&'p ValueLocation<'p>, usize),
}

impl ValueLocation<'_> {
    /// First byte of the value, falling back to the nearest key/container location.
    /// Iterates instead of recursing so deeply nested arrays can't overflow the stack.
    pub fn resolve(&self, contents: &[u8]) -> bun_ast::Loc {
        let mut indices: Vec<usize> = Vec::new();
        let mut cur = self;
        let key_loc = loop {
            match cur {
                ValueLocation::Property(key_loc) => break *key_loc,
                ValueLocation::ArrayItem(array, index) => {
                    indices.push(*index);
                    cur = array;
                }
            }
        };
        let mut loc = property_value_loc_or_key(contents, key_loc);
        for &index in indices.iter().rev() {
            loc = array_item_loc(contents, loc, index).unwrap_or(loc);
        }
        loc
    }
}

/// Location of the item after the one starting at `item_loc`; `None` past the last item.
pub fn array_next_item_loc(contents: &[u8], item_loc: bun_ast::Loc) -> Option<bun_ast::Loc> {
    let p = array_next_item(contents, usize::try_from(item_loc.start).ok()?)?;
    Some(bun_ast::usize2loc(p))
}

fn array_first_item(contents: &[u8], start: usize) -> Option<usize> {
    if *contents.get(start)? != b'[' {
        return None;
    }
    let p = skip_ws_and_comments(contents, start + 1)?;
    (!matches!(contents[p], b']' | b',')).then_some(p)
}

fn array_next_item(contents: &[u8], item: usize) -> Option<usize> {
    let p = skip_json_value(contents, item)?;
    let p = skip_ws_and_comments(contents, p)?;
    if contents[p] != b',' {
        return None;
    }
    let p = skip_ws_and_comments(contents, p + 1)?;
    (!matches!(contents[p], b']' | b',')).then_some(p)
}

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

pub(crate) fn skip_ws_and_comments(contents: &[u8], mut p: usize) -> Option<usize> {
    use bun_core::strings;
    while p < contents.len() {
        let b = contents[p];
        match b {
            b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C => p += 1,
            b'/' => match contents.get(p + 1) {
                Some(b'/') => {
                    p += 2;
                    while p < contents.len()
                        && !matches!(contents[p], b'\n' | b'\r')
                        && !crate::json_index::is_ls_ps(contents, p)
                    {
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
        _ => {
            let mut q = p;
            if contents[q] == b'-' {
                q = skip_ws_and_comments(contents, q + 1)?;
            }
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

/// Deep-convert an immutable-AST document into the classic `E::Object` / `E::Array` tree.
pub fn materialize<'a>(
    root: &Expr<'a>,
    source: &'a bun_ast::Source<'_>,
    log: &bun_ast::Log,
    bump: &'a AstArena,
) -> crate::Result<Expr<'a>> {
    materialize_impl(root, &source.contents, bump, false).inspect_err(|_| {
        log.add_error_fmt_opts(
            format_args!("Document is too deeply nested"),
            bun_ast::AddErrorOptions {
                source: Some(source),
                loc: root.loc,
                ..Default::default()
            },
        );
    })
}

fn materialize_impl<'a>(
    root: &Expr<'a>,
    contents: &'a [u8],
    bump: &'a AstArena,
    was_originally_macro: bool,
) -> crate::Result<Expr<'a>> {
    let m = Materializer {
        contents,
        bump,
        was_originally_macro,
        stack_check: bun_core::StackCheck::init(),
        overflowed: core::cell::Cell::new(false),
    };
    let out = m.expr(root, root.loc);
    if m.overflowed.get() {
        return Err(crate::Error::StackOverflow);
    }
    Ok(out)
}

struct Materializer<'a> {
    contents: &'a [u8],
    bump: &'a AstArena,
    was_originally_macro: bool,
    stack_check: bun_core::StackCheck,
    overflowed: core::cell::Cell<bool>,
}

impl<'a> Materializer<'a> {
    fn expr(&self, e: &Expr<'a>, loc: bun_ast::Loc) -> Expr<'a> {
        match &e.data {
            js_ast::expr::Data::EObjectJSON(o) => {
                Expr::allocate(self.bump, self.object(o.get()), loc)
            }
            js_ast::expr::Data::EArrayJSON(a) => {
                Expr::allocate(self.bump, self.array(a.get(), loc), loc)
            }
            js_ast::expr::Data::EString(s) => Expr::allocate(
                self.bump,
                E::EString::init(self.rehome(s.get().data).slice()),
                loc,
            ),
            _ => Expr { data: e.data, loc },
        }
    }

    fn object(&self, o: &E::ObjectJSON<'a>) -> E::Object<'a> {
        if !self.stack_check.is_safe_to_recurse() {
            self.overflowed.set(true);
            return E::Object::default();
        }
        let rows = o.properties();
        let mut properties = G::PropertyList::with_capacity_in(rows.len(), self.bump);
        let value_locs = o.value_locs();
        for (i, row) in rows.iter().enumerate() {
            let key = Expr::allocate(
                self.bump,
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
            properties.push(
                self.bump,
                G::Property {
                    flags: E::own_key_property_flags(&key),
                    key: Some(key),
                    value: Some(self.json_value(&row.value, value_loc)),
                    kind: G::PropertyKind::Normal,
                    initializer: None,
                    ..Default::default()
                },
            );
        }
        E::Object {
            properties,
            is_single_line: o.is_single_line,
            was_originally_macro: self.was_originally_macro,
            close_brace_loc: o.close_brace_loc,
            ..Default::default()
        }
    }

    fn array(&self, a: &E::ArrayJSON<'a>, loc: bun_ast::Loc) -> E::Array<'a> {
        if !self.stack_check.is_safe_to_recurse() {
            self.overflowed.set(true);
            return E::Array::default();
        }
        let rows = a.items();
        let mut items = js_ast::ExprNodeList::with_capacity_in(rows.len(), self.bump);
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
            items.push(self.bump, self.json_value(item, item_loc));
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

    fn json_value(&self, value: &E::JsonValue<'a>, loc: bun_ast::Loc) -> Expr<'a> {
        match value {
            E::JsonValue::Object(o) => Expr::allocate(self.bump, self.object(o.get()), loc),
            E::JsonValue::Array(a) => Expr::allocate(self.bump, self.array(a.get(), loc), loc),
            E::JsonValue::String(s) => {
                Expr::allocate(self.bump, E::EString::init(self.rehome(*s).slice()), loc)
            }
            _ => Expr::from_json_value(self.bump, value, loc),
        }
    }

    fn rehome(&self, bytes: E::Str<'a>) -> E::Str<'a> {
        let source = self.contents.as_ptr_range();
        let p = bytes.slice().as_ptr();
        if source.contains(&p) {
            return bytes;
        }
        E::Str::new(self.bump.alloc_slice_copy(bytes.slice()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_ast::expr::Data;

    /// `'static` stands for the life of the value and of the text.
    struct Parsed {
        root: Option<Expr<'static>>,
        errors: usize,
        warnings: usize,
        first_msg: String,
        _bump: AstArena,
        _tape: Option<Box<E::JsonTape<'static>>>,
    }

    fn run(contents: &[u8], which: Which) -> Parsed {
        let log = bun_ast::Log::init();
        let arena = AstArena::new();
        let source = bun_ast::Source::init_path_string("fixture.json", contents);
        // SAFETY: `root` points into the chunks of `arena`, into the tape and into `contents`. The
        // result keeps the first two, and the tests that read `root` keep the last.
        let (bump, source) = unsafe {
            core::mem::transmute::<
                (&AstArena, &bun_ast::Source<'_>),
                (&'static AstArena, &'static bun_ast::Source<'static>),
            >((&arena, &source))
        };
        let mut tape = None;
        let mut keep_tape = |p: ParsedJson<'static>| {
            let root = Expr::from_json_value(bump, &p.root, p.root_loc);
            tape = p.into_tape();
            root
        };
        let r = match which {
            Which::Utf8 => parse_utf8(source, &log, bump),
            Which::TsConfig => parse_ts_config(source, &log, bump),
            Which::Env => parse_env_json(&source.contents, &log, bump),
            Which::PackageJson => parse_package_json_utf8(source, &log, bump),
            Which::Jsonc => ParsedJson::parse_jsonc(source, &log, bump).map(&mut keep_tape),
            Which::JsoncDocument => {
                ParsedJson::parse_jsonc_document(source, &log, bump).map(&mut keep_tape)
            }
            Which::Immutable => {
                parse_to_rows(source, &log, bump, JSONOptions::DEFAULT, false).map(&mut keep_tape)
            }
        };
        let first_msg = log
            .msgs
            .take()
            .first()
            .map(|m| String::from_utf8_lossy(&m.data.text).into_owned())
            .unwrap_or_default();
        Parsed {
            root: r.ok(),
            errors: log.errors.get() as usize,
            warnings: log.warnings.get() as usize,
            first_msg,
            _bump: arena,
            _tape: tape,
        }
    }

    #[derive(Clone, Copy)]
    enum Which {
        Utf8,
        TsConfig,
        Env,
        PackageJson,
        Jsonc,
        JsoncDocument,
        Immutable,
    }

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
        for which in [Which::Utf8, Which::TsConfig] {
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
    fn jsonc_document_is_one_value() {
        for src in [
            "{} // c",
            "{} /* c */ \n",
            "\u{FEFF}{}\u{FEFF}",
            "// c\n[1,]\n\t",
            "\"semi\"",
            "1 ",
            "null\u{2028}",
        ] {
            let p = run(src.as_bytes(), Which::JsoncDocument);
            assert!(
                p.root.is_some() && p.errors == 0,
                "{src:?}: {}",
                p.first_msg
            );
        }
        for src in [
            "{} x",
            "{} {}",
            "{},",
            "[] 1",
            "\"semi\": false",
            "1 2",
            "true false",
            "{}\0",
            "{} /* c",
            "{} /",
        ] {
            let p = run(src.as_bytes(), Which::JsoncDocument);
            assert!(p.root.is_none() && p.errors > 0, "{src:?} is accepted");
        }
        for src in ["{} x", "\"semi\": false", "{}\0"] {
            assert!(run(src.as_bytes(), Which::Jsonc).root.is_some(), "{src:?}");
        }
    }

    #[test]
    fn parses_across_block_boundaries() {
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
        for doc in ["[1 // x\n]", "[1// x\n]", "{\"a\": 1 /* c */}"] {
            expect_error(doc, "JSON does not support comments");
        }
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
        let p = run(br"[\u0074rue, \u0066alse, \u006eull]", Which::Utf8);
        assert_eq!(p.errors, 0, "{}", p.first_msg);
        let mut got = String::new();
        to_json_string(p.root.as_ref().unwrap(), &mut got);
        assert_eq!(got, "[true,false,null]");
        let p = run(
            "[\u{a0}\\u0074rue, \u{feff}\\u006eull]".as_bytes(),
            Which::Utf8,
        );
        assert_eq!(p.errors, 0, "{}", p.first_msg);
        let mut got = String::new();
        to_json_string(p.root.as_ref().unwrap(), &mut got);
        assert_eq!(got, "[true,null]");
    }

    #[test]
    fn minus_separated_from_its_digits() {
        for (doc, want) in [
            ("[- 5]", -5.0),
            ("[-\u{a0}5]", -5.0),
            ("[-\u{feff}.5]", -0.5),
            ("[- /* x */ 5]", -5.0),
            ("[-\u{a0}/* x */\u{a0}5e1]", -50.0),
            ("[\u{feff}-\u{a0}5]", -5.0),
            ("[1, -\u{a0}5]", -5.0),
        ] {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert_eq!(p.errors, 0, "{doc}: {}", p.first_msg);
            let Data::EArray(a) = &p.root.as_ref().unwrap().data else {
                panic!()
            };
            let Data::ENumber(n) = &a.items.last().unwrap().data else {
                panic!("{doc}")
            };
            assert_eq!(n.value(), want, "{doc}");
        }
        for (doc, found) in [
            ("[- ]", "\"]\""),
            ("[-\u{a0}true]", "true"),
            ("[- , 1]", "\",\""),
            ("[-]", "\"]\""),
            ("[-\u{feff}]", "\"]\""),
            ("- \u{a0}", "end of file"),
        ] {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert!(p.errors > 0, "{doc}");
            assert!(
                p.first_msg.contains("Expected number") && p.first_msg.contains(found),
                "{doc}: {}",
                p.first_msg
            );
        }
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
        let p = run(br#"{"a":{"a":1},"b":{"a":2}}"#, Which::Utf8);
        assert_eq!(p.warnings, 0);
        let many: String = (0..200).map(|i| format!("\"k{i}\":{i},")).collect();
        let p = run(format!("{{{many}\"k7\":1}}").as_bytes(), Which::Utf8);
        assert_eq!(p.warnings, 1);
        for doc in [
            "{\"a\":1,\"a\":2} // x",
            "{\"a\":1,\"a\":2} /* x",
            "{\"a\":1,\"a\":2 // x",
            "{\"a\":1,\"a\":2 /* x",
        ] {
            let p = run(doc.as_bytes(), Which::Utf8);
            assert!(p.errors > 0, "{doc}");
            assert_eq!(p.warnings, 1, "{doc}");
            assert!(p.first_msg.contains("Duplicate key"), "{}", p.first_msg);
        }
    }

    #[test]
    fn indentation_skips_block_comments() {
        let i = guess_indentation(b"/* c\n   x */\n{\n\t\"a\": 1\n}");
        assert!(matches!(i.character, bun_ast::IndentationCharacter::Tab));
        assert_eq!(i.scalar, 1);
        let i = guess_indentation(b"{\"a\": \"/*\",\n  \"b\": 2}");
        assert!(matches!(i.character, bun_ast::IndentationCharacter::Space));
        assert_eq!(i.scalar, 2);
        let i = guess_indentation(b"// don't edit\n{\n  \"a\": 1}");
        assert!(matches!(i.character, bun_ast::IndentationCharacter::Space));
        assert_eq!(i.scalar, 2);
    }

    #[test]
    fn duplicate_key_warnings_skipped_under_node_modules() {
        let doc = br#"{"a":1,"b":2,"a":3}"#;
        let sep = std::path::MAIN_SEPARATOR;
        for (path, warnings) in [
            (
                format!("{sep}app{sep}node_modules{sep}dep{sep}package.json"),
                0usize,
            ),
            (format!("{sep}app{sep}package.json"), 1),
        ] {
            let arena = AstArena::new();
            let log = bun_ast::Log::init();
            let source = bun_ast::Source::init_path_string(path.as_str(), &doc[..]);
            let parsed = ParsedJson::parse_package_json(&source, &log, &arena).unwrap();
            assert!(parsed.root().as_e_object_json().is_some());
            assert_eq!(log.warnings.get() as usize, warnings, "{path}");
        }
    }

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
        let jsonc = "// c\n{\"a\": [1, 2,], /* x */ \"b\": 'sq', } ";
        assert_eq!(canon(jsonc, Which::TsConfig), canon(jsonc, Which::Jsonc));
    }

    #[test]
    fn materialize_matches_the_classic_entry_points() {
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
            (
                "// c\n{\"a\": [1, 2,], /* x */ \"b\": 'sq', }",
                Which::TsConfig,
                Which::Jsonc,
            ),
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
                let source = bun_ast::Source::init_path_string("fixture.json", doc.as_bytes());
                let bump = AstArena::new();
                let mlog = bun_ast::Log::init();
                // SAFETY: `materialize` does not write to the document.
                let rows =
                    unsafe { core::mem::transmute::<Expr<'static>, Expr<'_>>(p.root.unwrap()) };
                let root = materialize(&rows, &source, &mlog, &bump).unwrap();
                (root.loc, canon_full(&root))
            };
            assert_eq!(full, materialized, "materialized tree differs for {doc:?}");
        }
    }

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
                    assert_eq!(array_item_loc(src, e.loc, a.items.len()), None);
                }
                _ => {}
            }
        }
        let docs: [&str; 7] = [
            r#"{"a":1,"b" : "two", "es\"cé\\" :  [1, "x", {"y":null}, true, ["", -2]], "c":{"d":3}}"#,
            "{\n  // line\n  \"a\" /* k */ : // v\n   42,\n  \"arr\": [ /* a */ 1,\n     [2], // b\n   {'z': 'q'},\n  ],\n}",
            "{\"\u{e9}k\":\u{a0}\u{feff} 1,\"l\":\u{a0}[\u{a0}1\u{a0},\u{a0}2]}",
            "{\"a\": // c\r 1, \"b\": [0, // d\u{2028} 2]}",
            "[- 5, 1, -\u{a0}2, /* c */ - /* d */ 3]",
            "[]",
            "[ [ ] , { } , \"]\" ]",
        ];
        for doc in docs {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert_eq!(p.errors, 0, "fixture must parse: {doc:?}");
            walk(doc.as_bytes(), p.root.as_ref().unwrap());
        }
        let doc = b"{\"k\" /* : 9 */ : /* x */ 42}";
        let key_loc = bun_ast::usize2loc(1);
        let value_loc = property_value_loc(doc, key_loc).unwrap();
        assert_eq!(value_loc.start as usize, 25);
        assert_eq!(&doc[value_loc.start as usize..][..2], b"42");
        assert_eq!(property_value_loc(b"{\"k\", 1}", key_loc), None);
        assert_eq!(property_value_loc(b"{\"k\"", key_loc), None);
        assert_eq!(array_item_loc(b"{}", bun_ast::usize2loc(0), 0), None);
    }

    #[test]
    fn json_reads_tape_and_materialized_tree_alike() {
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

        fn describe(e: JsonView<'_, '_>, bump: &AstArena, out: &mut std::string::String) {
            use std::fmt::Write;
            match e.tag_name() {
                "null" => out.push_str("null"),
                "boolean" => write!(out, "{}", e.as_bool().unwrap()).unwrap(),
                "number" => write!(out, "{}", e.as_number().unwrap()).unwrap(),
                "string" => {
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

        fn probe(doc: &[u8], which: Which) -> std::string::String {
            use std::fmt::Write;
            let p = run(doc, which);
            let bump = &p._bump;
            let root = JsonView::from(p.root.as_ref().unwrap());
            let mut out = std::string::String::new();

            assert!(root.is_object());
            assert!(!root.is_array());
            assert!(root.get(b"missing").is_none());
            assert!(root.as_array().is_none());

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
                describe(q.value, bump, &mut out);
                out.push('\n');
            }

            writeln!(
                out,
                "bool={:?}",
                root.get(b"private").and_then(|e| e.as_bool())
            )
            .unwrap();
            writeln!(out, "num={:?}", root.get(b"count").unwrap().as_number()).unwrap();
            writeln!(
                out,
                "str={:?}",
                root.get(b"name")
                    .and_then(|e| e.as_string(bump))
                    .map(|s| std::string::String::from_utf8_lossy(s).into_owned())
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
            writeln!(out, "count={}", root.property_count()).unwrap();

            let deps = root.get(b"deps").unwrap();
            assert!(deps.is_object());
            out.push_str("deps.a=");
            describe(deps.get(b"a").unwrap(), bump, &mut out);
            out.push('\n');

            let mut pairs: Vec<(std::string::String, std::string::String)> = Vec::new();
            deps.for_each_property(|key, _loc, value| {
                if let Some(v) = value.as_utf8_string_literal() {
                    pairs.push((
                        std::string::String::from_utf8_lossy(key).into_owned(),
                        std::string::String::from_utf8_lossy(v).into_owned(),
                    ));
                }
            });
            writeln!(out, "deps_map={pairs:?}").unwrap();

            out.push_str("files=[");
            for item in root.get(b"files").unwrap().as_array().unwrap() {
                describe(item, bump, &mut out);
                out.push(',');
            }
            out.push_str("]\n");
            assert!(root.get(b"empty_arr").unwrap().as_array().is_none());
            assert!(root.get(b"empty_obj").unwrap().as_array().is_none());

            for item in root.get(b"files").unwrap().as_array().unwrap() {
                if let Some(mut nested) = item.as_array() {
                    out.push_str("files[5][0]=");
                    describe(nested.next().unwrap(), bump, &mut out);
                    out.push('\n');
                }
            }

            out
        }

        let full = probe(doc, Which::Utf8);
        let immutable = probe(doc, Which::Immutable);
        assert_eq!(full, immutable);
        let name_key_offset = bun_core::strings::index_of(doc, b"\"name\"").unwrap();
        assert!(
            full.starts_with(&format!("name@{name_key_offset}=\"pkg\"\n")),
            "{full:?}"
        );
        assert!(full.contains("bool=Some(true)\n"));
        assert!(full.contains("num=Some(42.5)\n"));
        assert!(
            full.contains("deps_map=[(\"a\", \"^1\"), (\"b\", \"~2.0\"), (\"empty\", \"\")]\n")
        );
        assert!(full.contains("files=[\"lib\",3,true,null,{object},[array],]\n"));
        assert!(full.contains("files[5][0]=\"nested\"\n"));
        assert!(full.contains("deps.a=\"^1\"\n"));
    }

    #[test]
    fn duplicate_key_detection_with_nested_large_objects() {
        let many: String = (0..60).map(|i| format!("\"k{i}\":{i},")).collect();
        let inner = format!("{{{}\"inner\":0}}", many.clone());
        let doc = format!("{{{many}\"nest\":{inner},\"k3\":true}}");
        let p = run(doc.as_bytes(), Which::Utf8);
        assert_eq!(p.errors, 0);
        assert_eq!(p.warnings, 1, "outer duplicate after a nested large object");
        assert!(
            p.first_msg.contains("Duplicate key \"k3\""),
            "{}",
            p.first_msg
        );

        let p = run(
            format!("{{\"a\":{inner},\"b\":{inner}}}").as_bytes(),
            Which::Utf8,
        );
        assert_eq!(p.errors, 0);
        assert_eq!(p.warnings, 0);

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
        let p = run(b"{\"a\": [1,\n2]}", Which::Utf8);
        let Data::EObject(o) = &p.root.as_ref().unwrap().data else {
            panic!()
        };
        assert!(o.is_single_line);
        let Data::EArray(a) = &o.properties[0].value.as_ref().unwrap().data else {
            panic!()
        };
        assert!(!a.is_single_line);
        for doc in [
            "{\"a\": 1 /* x\n*/, \"b\": 2}",
            "{\"a\": 1\n/* x */, \"b\": 2}",
            "{\"a\":1/*\nX/* */,\"b\":2}",
            "{\"x\":\"/*\",\"a\":1,\n\"b\":2}",
        ] {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert_eq!(p.errors, 0, "{doc:?}: {}", p.first_msg);
            let Data::EObject(o) = &p.root.as_ref().unwrap().data else {
                panic!()
            };
            assert!(!o.is_single_line, "{doc:?}");
        }
        for doc in ["[1 /*/\n*/ ]", "{\"a\":1,\n\u{a0}\"b\":2}", "[\u{a0}\n1]"] {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert_eq!(p.errors, 0, "{doc:?}: {}", p.first_msg);
            let root = p.root.as_ref().unwrap();
            let single = match &root.data {
                Data::EObject(o) => o.is_single_line,
                Data::EArray(a) => a.is_single_line,
                _ => panic!(),
            };
            assert!(!single, "{doc:?}");
        }
        for doc in [
            "{\"a\":1/* X/* */,\"b\":2}",
            "{\"x\":\"/*\",\"a\":1/* c */,\"b\":2}",
        ] {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert_eq!(p.errors, 0, "{doc:?}: {}", p.first_msg);
            let Data::EObject(o) = &p.root.as_ref().unwrap().data else {
                panic!()
            };
            assert!(o.is_single_line, "{doc:?}");
        }
        for doc in [
            "\u{feff}// c\n{\"a\": 1}",
            "\u{feff}/* x */[1]",
            "{\u{a0}/* x */ \"a\": 1}",
            "[1,\u{a0} // c\n2]",
            "[\u{a0}/* a */\u{a0}1\u{a0}/* b */]",
        ] {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert_eq!(p.errors, 0, "{doc:?}: {}", p.first_msg);
        }
        for doc in [
            "{\"a\": 1 /* x */, \"b\": true /* y */ , \"c\": null // z\n}",
            "[1 /* a */, 2.5 // b\n, -3 /* c */ ]",
        ] {
            let p = run(doc.as_bytes(), Which::TsConfig);
            assert_eq!(p.errors, 0, "{doc:?}: {}", p.first_msg);
        }
        let p = run(b"[1,\n]", Which::TsConfig);
        let Data::EArray(a) = &p.root.as_ref().unwrap().data else {
            panic!()
        };
        assert!(!a.is_single_line);
        let p = run(b"{\"a\":1,\n}", Which::TsConfig);
        let Data::EObject(o) = &p.root.as_ref().unwrap().data else {
            panic!()
        };
        assert!(!o.is_single_line);
        let doc = b"{\"a\": [1, 2] }";
        let p = run(doc, Which::Utf8);
        let Data::EObject(o) = &p.root.as_ref().unwrap().data else {
            panic!()
        };
        assert_eq!(o.close_brace_loc.start as usize, doc.len() - 1);
        let Data::EArray(a) = &o.properties[0].value.as_ref().unwrap().data else {
            panic!()
        };
        assert_eq!(doc[a.close_bracket_loc.start as usize], b']');
    }

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
        expect_error("[@] /* unterminated", "Decorators are not allowed in JSON");
        expect_error("[1 /* never", "terminate multi-line comment");
        expect_error("[1] // c\n /2", "JSON does not support comments");
        expect_error("[@] 1/2", "Decorators are not allowed in JSON");
        expect_error("/ [1]", "Operators are not allowed in JSON");
    }

    #[test]
    fn deep_nesting_does_not_overflow() {
        let depth = 200_000;
        let mut s = String::with_capacity(depth * 2);
        for _ in 0..depth {
            s.push('[');
        }
        let p = run(s.as_bytes(), Which::Utf8);
        assert!(p.root.is_none());
        assert!(p.first_msg.contains("too deeply nested"), "{}", p.first_msg);
    }

    #[test]
    fn env_json() {
        for (src, want) in [
            ("production", "production"),
            ("hello world", "hello world"),
            ("*{box-sizing:border-box}", "*{box-sizing:border-box}"),
            ("a\\nb", "a\nb"),
            ("first line\nsecond", "first line\nsecond"),
            ("(\nrest", "(\nrest"),
            ("*\nrest", "*\nrest"),
            ("a\\nb\nc", "a\nb\nc"),
            ("caf\u{e9}\tx\nrest", "caf\u{e9}\tx\nrest"),
            ("-abc", "-abc"),
            (".env-like", ".env-like"),
            (r#"\"hello\""#, "hello"),
        ] {
            let p = run(src.as_bytes(), Which::Env);
            assert_eq!(p.errors, 0, "{src}: {}", p.first_msg);
            assert_eq!(root_string(&p), want, "{src}");
        }
        for (src, want) in [("-1", -1.0), (".5", 0.5), ("-.25", -0.25), ("- 5", -5.0)] {
            let p = run(src.as_bytes(), Which::Env);
            let Some(Data::ENumber(n)) = p.root.as_ref().map(|r| &r.data) else {
                panic!("{src}: expected a number ({})", p.first_msg);
            };
            assert_eq!(n.value(), want, "{src}");
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

    #[test]
    fn package_json_version_checker() {
        let log = bun_ast::Log::init();
        let source = bun_ast::Source::init_path_string(
            "package.json",
            br#"{"private": true, "name": "my-pkg", "scripts": {"x": "y"}, "version": "1.2.3"}"#
                .as_slice(),
        );
        let mut checker = PackageJSONVersionChecker::init(&source, &log);
        checker.parse().unwrap();
        assert!(checker.has_found_name && checker.has_found_version);
        assert_eq!(checker.found_name(), b"my-pkg");
        assert_eq!(checker.found_version(), b"1.2.3");
        let source = bun_ast::Source::init_path_string(
            "package.json",
            br#"{"version": {"x": 1}, "name": 1, "name": "n2", "version": "9.9.9"}"#.as_slice(),
        );
        let log = bun_ast::Log::init();
        let mut checker = PackageJSONVersionChecker::init(&source, &log);
        checker.parse().unwrap();
        assert_eq!(
            (checker.found_name(), checker.found_version()),
            (b"n2".as_slice(), b"9.9.9".as_slice())
        );
        let source = bun_ast::Source::init_path_string("package.json", b"".as_slice());
        let log = bun_ast::Log::init();
        let mut checker = PackageJSONVersionChecker::init(&source, &log);
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
