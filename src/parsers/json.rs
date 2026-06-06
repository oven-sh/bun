use core::cell::RefCell;

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};

use bun_core::{self, StackCheck};
// JSON-only lexer subset lives in this crate (`json_lexer.rs`).
use crate::json_lexer as js_lexer;
use crate::json_lexer::T;
use bun_ast as js_ast;
use bun_ast::Indentation;
use bun_ast::{E, ExprNodeList, G, Stmt};
use bun_collections::VecExt;

use bun_ast::Expr;

const LEXER_DEBUGGER_WORKAROUND: bool = false;

// ──────────────────────────────────────────────────────────────────────────
// HashMapPool
// ──────────────────────────────────────────────────────────────────────────

mod hash_map_pool {
    use super::*;

    // Keys are pre-hashed (`EString::hash()`), so identity hashing avoids
    // re-hashing the hash.
    pub(super) type HashMap =
        bun_collections::HashMap<u64, (), bun_collections::IdentityContext<u64>>;

    // thread_local + Vec<HashMap> freelist; an owned HashMap is moved out/in
    // rather than borrowed across calls.
    thread_local! {
        static LIST: RefCell<Vec<HashMap>> = const { RefCell::new(Vec::new()) };
    }

    pub(super) fn get() -> HashMap {
        LIST.with_borrow_mut(|list| {
            if let Some(mut map) = list.pop() {
                map.clear();
                map
            } else {
                HashMap::default()
            }
        })
    }

    pub(super) fn release(map: HashMap) {
        LIST.with_borrow_mut(|list| list.push(map));
    }
}

// ──────────────────────────────────────────────────────────────────────────

fn new_expr<Ty>(t: Ty, loc: bun_ast::Loc) -> Expr
where
    Ty: js_ast::ExprInit,
{
    // For Ty == E.Object, every property must have key != null, value != null,
    // initializer == null. Rust has no specialization, so that check lives in
    // `debug_assert_json_object_shape`, called at the (single) E::Object
    // construction site below.
    Expr::init(t, loc)
}

/// JSON objects must have every property fully keyed/valued with no
/// initializer.
#[inline]
fn debug_assert_json_object_shape(properties: &[G::Property]) {
    if cfg!(debug_assertions) {
        for prop in properties {
            // json should never have an initializer set
            debug_assert!(prop.initializer.is_none());
            debug_assert!(prop.key.is_some());
            debug_assert!(prop.value.is_some());
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSONLikeParser
// ──────────────────────────────────────────────────────────────────────────
//
// A *single* concrete type carrying `JSONOptions` at runtime. An earlier
// version used 8 struct-level `const bool` generics plus 2 more on `parse_expr`; that
// gave a 2^10 monomorphization surface (6+ live combos in-tree, more once
// downstream crates pick their own), each re-emitted in every crate that
// touched a new combo. The body is I/O-bound on lexer reads and the option
// branches are perfectly predicted, so a runtime `opts` field costs nothing
// measurable while letting `parse_expr` be `#[inline(never)]` and emitted
// exactly once in `bun_parsers`. (benches: startup/npm-script.)
//
// `crate::json_lexer::Lexer` already carries a runtime `JSONOptions` (the JSON
// token loop is small enough that const-generic specialisation buys nothing), so
// the parser simply reuses the same struct.

pub struct JSONLikeParser<'a, 'bump> {
    pub lexer: js_lexer::Lexer<'a, 'bump>,
    // Stacked Borrows: a second log pointer stored here
    // would alias the lexer's `*mut Log`; a
    // live `&'a mut Log` field would invalidate the lexer's SharedReadWrite tag
    // on first use (UB on the next lexer error). All log writes route through
    // `self.lexer.log_mut()` instead — single provenance chain.
    pub bump: &'bump Bump,
    pub list_bump: &'bump Bump,
    pub stack_check: StackCheck,
    /// Runtime parse options. Replaces the former 8 struct-level const-bool
    /// generics; see module note above for why this is a runtime field.
    pub opts: js_lexer::JSONOptions,
}

impl<'a, 'bump> JSONLikeParser<'a, 'bump>
where
    // `json_lexer::Lexer` requires `'bump: 'a` (escape-decoded identifiers
    // are bump-alloc'd but stored in `&'a` fields).
    'bump: 'a,
{
    pub(crate) fn init(
        opts: js_lexer::JSONOptions,
        bump: &'bump Bump,
        source_: &'a bun_ast::Source,
        log: &'a mut bun_ast::Log,
    ) -> Result<Self, bun_core::Error> {
        Self::init_with_list_allocator(opts, bump, bump, source_, log)
    }

    pub(crate) fn init_with_list_allocator(
        opts: js_lexer::JSONOptions,
        bump: &'bump Bump,
        list_bump: &'bump Bump,
        source_: &'a bun_ast::Source,
        log: &'a mut bun_ast::Log,
    ) -> Result<Self, bun_core::Error> {
        Expr::data_store_assert();
        Stmt::data_store_assert();
        Ok(Self {
            lexer: js_lexer::Lexer::init(log, source_, bump, opts)?,
            bump,
            list_bump,
            stack_check: StackCheck::init(),
            opts,
        })
    }

    #[inline]
    pub(crate) fn source(&self) -> &bun_ast::Source {
        self.lexer.source
    }

    /// Recursive-descent JSON expression parser.
    ///
    /// `#[inline(never)]` + no const generics: this is the hot body that the
    /// old 10-const-bool surface monomorphized N ways across downstream
    /// crates. One copy lives in `bun_parsers`; callers link to it.
    /// `maybe_auto_quote` / `force_utf8` are runtime — both branches are
    /// perfectly predicted (set once per top-level call, constant across the
    /// recursion).
    #[inline(never)]
    pub fn parse_expr(
        &mut self,
        maybe_auto_quote: bool,
        force_utf8: bool,
    ) -> Result<Expr, bun_core::Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(bun_core::err!("StackOverflow"));
        }

        let loc = self.lexer.loc();

        match self.lexer.token {
            T::TFalse => {
                self.lexer.next()?;
                Ok(new_expr(E::Boolean { value: false }, loc))
            }
            T::TTrue => {
                self.lexer.next()?;
                Ok(new_expr(E::Boolean { value: true }, loc))
            }
            T::TNull => {
                self.lexer.next()?;
                Ok(new_expr(E::Null {}, loc))
            }
            T::TStringLiteral => {
                let mut str: E::String = self.lexer.to_e_string()?;
                if force_utf8 {
                    str.to_utf8(self.bump).expect("unreachable");
                }

                self.lexer.next()?;
                Ok(new_expr(str, loc))
            }
            T::TNumericLiteral => {
                let value = self.lexer.number;
                self.lexer.next()?;
                Ok(new_expr(E::Number { value }, loc))
            }
            T::TMinus => {
                self.lexer.next()?;
                let value = self.lexer.number;
                self.lexer.expect(T::TNumericLiteral)?;
                Ok(new_expr(E::Number { value: -value }, loc))
            }
            T::TOpenBracket => {
                self.lexer.next()?;
                let mut is_single_line = !self.lexer.has_newline_before;
                // Build a `Vec<Expr>` (global allocator) directly and hand it off.
                let mut exprs: Vec<Expr> = Vec::new();
                // errdefer exprs.deinit() — dropped automatically on `?`.

                while self.lexer.token != T::TCloseBracket {
                    if !exprs.is_empty() {
                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }

                        if !self.parse_maybe_trailing_comma(T::TCloseBracket)? {
                            break;
                        }

                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }
                    }

                    let item = self.parse_expr(false, force_utf8)?;
                    exprs.push(item);
                }

                if self.lexer.has_newline_before {
                    is_single_line = false;
                }
                self.lexer.expect(T::TCloseBracket)?;
                Ok(new_expr(
                    E::Array {
                        items: ExprNodeList::move_from_list(exprs),
                        is_single_line,
                        was_originally_macro: self.opts.was_originally_macro,
                        ..Default::default()
                    },
                    loc,
                ))
            }
            T::TOpenBrace => {
                self.lexer.next()?;
                let mut is_single_line = !self.lexer.has_newline_before;
                // see TOpenBracket note — `Vec` is `Vec`-backed.
                let mut properties: Vec<G::Property> = Vec::new();
                // errdefer properties.deinit() — dropped automatically on `?`.

                // Option keeps one code path whether or not
                // json_warn_duplicate_keys is set.
                let warn_dup = self.opts.json_warn_duplicate_keys;
                let mut duplicates: Option<hash_map_pool::HashMap> = if warn_dup {
                    Some(hash_map_pool::get())
                } else {
                    None
                };
                let mut duplicates_guard = scopeguard::guard(&mut duplicates, |d| {
                    if let Some(map) = d.take() {
                        hash_map_pool::release(map);
                    }
                });
                // scopeguard runs on both success and error paths.

                while self.lexer.token != T::TCloseBrace {
                    if !properties.is_empty() {
                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }
                        if !self.parse_maybe_trailing_comma(T::TCloseBrace)? {
                            break;
                        }
                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }
                    }

                    let str = if force_utf8 {
                        self.lexer.to_utf8_e_string()?
                    } else {
                        self.lexer.to_e_string()?
                    };

                    let key_range = self.lexer.range();
                    // `EString` is intentionally not `Clone` (rope `next` would
                    // alias) — `shallow_clone` is the explicit field-copy.
                    let key = new_expr(str.shallow_clone(), key_range.loc);
                    self.lexer.expect(T::TStringLiteral)?;

                    if let Some(dup_map) = duplicates_guard.as_mut() {
                        let hash_key = str.hash();
                        let dup = dup_map.insert(hash_key, ()).is_some();

                        // Warn about duplicate keys
                        if dup {
                            // Route through the lexer's single `*mut Log` —
                            // see struct note re: Stacked Borrows.
                            let source = self.lexer.source;
                            let key_text = str.string(self.bump)?;
                            self.lexer.log_mut().add_range_warning_fmt(
                                Some(source),
                                key_range,
                                format_args!(
                                    "Duplicate key \"{}\" in object literal",
                                    bstr::BStr::new(key_text)
                                ),
                            )
                        }
                    }

                    self.lexer.expect(T::TColon)?;
                    let value = self.parse_expr(false, force_utf8)?;
                    properties.push(G::Property {
                        key: Some(key),
                        value: Some(value),
                        kind: js_ast::G::PropertyKind::Normal,
                        initializer: None,
                        ..Default::default()
                    });
                }

                if self.lexer.has_newline_before {
                    is_single_line = false;
                }
                self.lexer.expect(T::TCloseBrace)?;
                debug_assert_json_object_shape(&properties);
                Ok(new_expr(
                    E::Object {
                        properties: G::PropertyList::move_from_list(properties),
                        is_single_line,
                        was_originally_macro: self.opts.was_originally_macro,
                        ..Default::default()
                    },
                    loc,
                ))
            }
            _ => {
                if maybe_auto_quote {
                    // borrowck — capture `source` (a `&'a Source`,
                    // Copy) and the lexer's `*mut Log` before reassigning
                    // `self.lexer`. The new lexer is built over the *same* raw
                    // log pointer so there is still exactly one provenance
                    // chain (see struct note); the temporary `&mut *log_ptr`
                    // ends as soon as `init_json` stores it back as `*mut`.
                    let source = self.lexer.source;
                    let log_ptr = self.lexer.log_ptr();
                    // SAFETY: `log_ptr` is the sole handle to the `Log`; the
                    // old lexer is being replaced and holds no live borrow.
                    self.lexer = js_lexer::Lexer::init_json(
                        unsafe { &mut *log_ptr },
                        source,
                        self.bump,
                        self.opts,
                    )?;
                    self.lexer.parse_string_literal(0)?;
                    return self.parse_expr(false, force_utf8);
                }

                self.lexer.unexpected()?;
                Err(bun_core::err!("ParserError"))
            }
        }
    }

    pub fn parse_maybe_trailing_comma(&mut self, closer: T) -> Result<bool, bun_core::Error> {
        let comma_range = self.lexer.range();
        self.lexer.expect(T::TComma)?;

        if self.lexer.token == closer {
            if !self.opts.allow_trailing_commas {
                let source = self.lexer.source;
                self.lexer.log_mut().add_range_error(
                    Some(source),
                    comma_range,
                    b"JSON does not support trailing commas",
                );
            }
            return Ok(false);
        }

        Ok(true)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PackageJSONVersionChecker
// ──────────────────────────────────────────────────────────────────────────
//
// This is a special JSON parser that stops as soon as it finds
// {
//    "name": "NAME_IN_HERE",
//    "version": "VERSION_IN_HERE",
// }
// and then returns the name and version.
// More precisely, it stops as soon as it finds a top-level "name" and "version" property which are strings
// In most cases, it should perform zero heap allocations because it does not create arrays or objects (It just skips them)

pub struct PackageJSONVersionChecker<'a, 'bump> {
    pub lexer: js_lexer::Lexer<'a, 'bump>,
    pub source: &'a bun_ast::Source,
    // Stacked Borrows: no separate `log` field; route through
    // `self.lexer.log_mut()` (single provenance chain — see `JSONLikeParser`).
    pub bump: &'bump Bump,
    pub depth: usize,
    pub stack_check: StackCheck,

    pub found_version_buf: [u8; 1024],
    pub found_name_buf: [u8; 1024],

    // Stores lengths rather than self-referential slices into the bufs;
    // use `.found_name()` / `.found_version()` accessors.
    found_name_len: usize,
    found_version_len: usize,

    pub has_found_name: bool,
    pub has_found_version: bool,

    pub name_loc: bun_ast::Loc,
}

const PKG_JSON_OPTS: js_lexer::JSONOptions = if LEXER_DEBUGGER_WORKAROUND {
    js_lexer::JSONOptions::DEFAULT
} else {
    js_lexer::JSONOptions {
        is_json: true,
        json_warn_duplicate_keys: false,
        allow_trailing_commas: true,
        allow_comments: true,
        ..js_lexer::JSONOptions::DEFAULT
    }
};

impl<'a, 'bump> PackageJSONVersionChecker<'a, 'bump>
where
    'bump: 'a,
{
    pub fn init(
        bump: &'bump Bump,
        source: &'a bun_ast::Source,
        log: &'a mut bun_ast::Log,
    ) -> Result<Self, bun_core::Error> {
        Ok(Self {
            lexer: js_lexer::Lexer::init(log, source, bump, PKG_JSON_OPTS)?,
            bump,
            source,
            depth: 0,
            stack_check: StackCheck::init(),
            found_version_buf: [0; 1024],
            found_name_buf: [0; 1024],
            found_name_len: 0,
            found_version_len: 0,
            has_found_name: false,
            has_found_version: false,
            name_loc: bun_ast::Loc::EMPTY,
        })
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
        if !self.stack_check.is_safe_to_recurse() {
            return Err(bun_core::err!("StackOverflow"));
        }

        let loc = self.lexer.loc();

        if self.has_found_name && self.has_found_version {
            return Ok(new_expr(E::Missing {}, loc));
        }

        match self.lexer.token {
            T::TFalse => {
                self.lexer.next()?;
                Ok(new_expr(E::Boolean { value: false }, loc))
            }
            T::TTrue => {
                self.lexer.next()?;
                Ok(new_expr(E::Boolean { value: true }, loc))
            }
            T::TNull => {
                self.lexer.next()?;
                Ok(new_expr(E::Null {}, loc))
            }
            T::TStringLiteral => {
                let str: E::String = self.lexer.to_e_string()?;

                self.lexer.next()?;
                Ok(new_expr(str, loc))
            }
            T::TNumericLiteral => {
                let value = self.lexer.number;
                self.lexer.next()?;
                Ok(new_expr(E::Number { value }, loc))
            }
            T::TMinus => {
                self.lexer.next()?;
                let value = self.lexer.number;
                self.lexer.expect(T::TNumericLiteral)?;
                Ok(new_expr(E::Number { value: -value }, loc))
            }
            T::TOpenBracket => {
                self.lexer.next()?;
                let mut has_exprs = false;

                while self.lexer.token != T::TCloseBracket {
                    if has_exprs {
                        if !self.parse_maybe_trailing_comma(T::TCloseBracket)? {
                            break;
                        }
                    }

                    let _ = self.parse_expr()?;
                    has_exprs = true;
                }

                self.lexer.expect(T::TCloseBracket)?;
                Ok(new_expr(E::Missing {}, loc))
            }
            T::TOpenBrace => {
                self.lexer.next()?;
                self.depth += 1;
                // Wrap body in a closure so `?`
                // returns here and depth is decremented exactly once on every exit path
                // (Ok, Err, early break). scopeguard cannot hold `&mut self.depth` while
                // the body re-borrows `&mut self`.
                let result = (|| -> Result<Expr, bun_core::Error> {
                    let mut has_properties = false;
                    while self.lexer.token != T::TCloseBrace {
                        if has_properties {
                            if !self.parse_maybe_trailing_comma(T::TCloseBrace)? {
                                break;
                            }
                        }

                        let str = self.lexer.to_e_string()?;
                        let key_range = self.lexer.range();

                        let key = new_expr(str, key_range.loc);
                        self.lexer.expect(T::TStringLiteral)?;

                        self.lexer.expect(T::TColon)?;

                        let value = self.parse_expr()?;

                        if self.depth == 1 {
                            // if you have multiple "name" fields in the package.json....
                            // first one wins
                            if let (Some(key_s), Some(val_s)) =
                                (key.data.as_e_string(), value.data.as_e_string())
                            {
                                // `as_e_string()` returns `StoreRef<EString>` which
                                // derefs to the payload, so `.data` is the raw byte
                                // slice.
                                if !self.has_found_name && key_s.data == b"name" {
                                    let len = val_s.data.len().min(self.found_name_buf.len());

                                    self.found_name_buf[..len].copy_from_slice(&val_s.data[..len]);
                                    self.found_name_len = len;
                                    self.has_found_name = true;
                                    self.name_loc = value.loc;
                                } else if !self.has_found_version && key_s.data == b"version" {
                                    let len = val_s.data.len().min(self.found_version_buf.len());
                                    self.found_version_buf[..len]
                                        .copy_from_slice(&val_s.data[..len]);
                                    self.found_version_len = len;
                                    self.has_found_version = true;
                                }
                            }
                        }

                        if self.has_found_name && self.has_found_version {
                            return Ok(new_expr(E::Missing {}, loc));
                        }

                        has_properties = true;
                    }

                    self.lexer.expect(T::TCloseBrace)?;
                    Ok(new_expr(E::Missing {}, loc))
                })();

                self.depth -= 1;
                result
            }
            _ => {
                self.lexer.unexpected()?;
                Err(bun_core::err!("ParserError"))
            }
        }
    }

    pub fn parse_maybe_trailing_comma(&mut self, closer: T) -> Result<bool, bun_core::Error> {
        let comma_range = self.lexer.range();
        self.lexer.expect(T::TComma)?;

        if self.lexer.token == closer {
            if !PKG_JSON_OPTS.allow_trailing_commas {
                self.lexer.log_mut().add_range_error(
                    Some(self.source),
                    comma_range,
                    b"JSON does not support trailing commas",
                );
            }
            return Ok(false);
        }

        Ok(true)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// toAST
// ──────────────────────────────────────────────────────────────────────────
//
// Recursively converts a value into a `js_ast.Expr` via a trait with
// per-type impls. Struct/enum/union support would require a derive macro.

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
                    data: js_ast::expr::Data::ENumber(E::Number { value: *self as f64 }),
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
                    data: js_ast::expr::Data::ENumber(E::Number { value: *self as f64 }),
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

// Struct/enum/union conversion would need a derive macro, and no current call
// site converts a struct/enum value — only the primitive/slice impls above are
// used.

// ──────────────────────────────────────────────────────────────────────────
// Parser option presets
// ──────────────────────────────────────────────────────────────────────────
//
// With the const-generic surface collapsed (see `JSONLikeParser` note), these
// are plain `JSONOptions` constants fed to the one concrete parser.
//
// `json_warn_duplicate_keys: bool = true` is the DEFAULT; the first four
// presets do not override it.

const JSON_OPTS: js_lexer::JSONOptions = js_lexer::JSONOptions {
    is_json: true,
    ..js_lexer::JSONOptions::DEFAULT
};

const DOTENV_JSON_OPTS: js_lexer::JSONOptions = js_lexer::JSONOptions {
    is_json: true,
    allow_trailing_commas: true,
    ignore_leading_escape_sequences: true,
    ignore_trailing_escape_sequences: true,
    ..js_lexer::JSONOptions::DEFAULT
};

const TSCONFIG_OPTS: js_lexer::JSONOptions = js_lexer::JSONOptions {
    is_json: true,
    allow_comments: true,
    allow_trailing_commas: true,
    ..js_lexer::JSONOptions::DEFAULT
};

const MACRO_JSON_OPTS: js_lexer::JSONOptions = js_lexer::JSONOptions {
    is_json: true,
    allow_comments: true,
    allow_trailing_commas: true,
    json_warn_duplicate_keys: false,
    was_originally_macro: true,
    ..js_lexer::JSONOptions::DEFAULT
};

const PACKAGE_JSON_OPTS: js_lexer::JSONOptions = js_lexer::JSONOptions {
    is_json: true,
    allow_comments: true,
    allow_trailing_commas: true,
    ..js_lexer::JSONOptions::DEFAULT
};

// ──────────────────────────────────────────────────────────────────────────

// Never mutated — `RacyCell` only because
// `StoreRef::from_raw` wants a `*mut T` and the payload types are `!Sync`.
static EMPTY_OBJECT: bun_core::RacyCell<E::Object> = bun_core::RacyCell::new(E::Object::EMPTY);
static EMPTY_ARRAY: bun_core::RacyCell<E::Array> = bun_core::RacyCell::new(E::Array::EMPTY);
static EMPTY_STRING: bun_core::RacyCell<E::String> = bun_core::RacyCell::new(E::String::EMPTY);

#[inline]
fn empty_string_data() -> js_ast::expr::Data {
    // EMPTY_STRING is a never-mutated static; `StoreRef::from_raw` checks
    // non-null and the static trivially outlives any Store reset.
    js_ast::expr::Data::EString(js_ast::StoreRef::from_raw(EMPTY_STRING.get()))
}
#[inline]
fn empty_object_data() -> js_ast::expr::Data {
    js_ast::expr::Data::EObject(js_ast::StoreRef::from_raw(EMPTY_OBJECT.get()))
}
#[inline]
fn empty_array_data() -> js_ast::expr::Data {
    js_ast::expr::Data::EArray(js_ast::StoreRef::from_raw(EMPTY_ARRAY.get()))
}

/// Shared fast-path prologue for every JSON entry point: empty input parses
/// as an empty object (consistent with how disabled JS files are handled),
/// and two-byte `""`/`''`/`{}`/`[]` inputs skip the lexer entirely.
///
/// Note: the two-byte arms compare a one-byte slice (`contents[0..1]`)
/// against two-byte literals, so they never match. This mirrors the Zig
/// reference (`json.zig` does the same with `eqlComptime`) — kept as-is to
/// preserve behavior, since "fixing" it would accept `''` in strict JSON.
#[inline]
fn empty_source_fast_path(source: &bun_ast::Source) -> Option<Expr> {
    let expr = |data| {
        Some(Expr {
            loc: bun_ast::Loc { start: 0 },
            data,
        })
    };
    match source.contents.len() {
        0 => expr(empty_object_data()),
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                expr(empty_string_data())
            } else if &source.contents[0..1] == b"{}" {
                expr(empty_object_data())
            } else if &source.contents[0..1] == b"[]" {
                expr(empty_array_data())
            } else {
                None
            }
        }
        _ => None,
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// Parse JSON
/// This leaves UTF-16 strings as UTF-16 strings
/// The JavaScript Printer will handle escaping strings if necessary
//
// `FORCE_UTF8` stays a const generic at the *public* boundary so existing
// call sites (`json::parse::<true>(…)`) keep compiling, but the body is a
// trivial forward into the single non-generic `parse_expr`. The wrapper
// monomorphizes to a few instructions; no large body is duplicated.
#[inline]
pub fn parse<const FORCE_UTF8: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if let Some(expr) = empty_source_fast_path(source) {
        return Ok(expr);
    }

    let mut parser = JSONLikeParser::init(JSON_OPTS, bump, source, log)?;

    parser.parse_expr(false, FORCE_UTF8)
}

/// Parse Package JSON
/// Allow trailing commas & comments.
/// This eagerly transcodes UTF-16 strings into UTF-8 strings
/// Use this when the text may need to be reprinted to disk as JSON (and not as JavaScript)
/// Eagerly converting UTF-8 to UTF-16 can cause a performance issue
pub fn parse_package_json_utf8(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if let Some(expr) = empty_source_fast_path(source) {
        return Ok(expr);
    }

    let mut parser = JSONLikeParser::init(PACKAGE_JSON_OPTS, bump, source, log)?;
    debug_assert!(!parser.source().contents.is_empty());

    parser.parse_expr(false, true)
}

#[derive(Default)]
pub struct JsonResult {
    pub root: Expr,
    pub indentation: Indentation,
}

// The 8-bool
// const-generic spelling is kept *only* as a back-compat shim for existing
// call sites in downstream crates; it immediately reifies the flags into a
// runtime `JSONOptions` and forwards to the single non-generic body below.
// Each monomorphized shim is a handful of instructions — the heavy
// `parse_expr` body is shared.
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
        js_lexer::JSONOptions {
            is_json: IS_JSON,
            allow_comments: ALLOW_COMMENTS,
            allow_trailing_commas: ALLOW_TRAILING_COMMAS,
            ignore_leading_escape_sequences: IGNORE_LEADING_ESCAPE_SEQUENCES,
            ignore_trailing_escape_sequences: IGNORE_TRAILING_ESCAPE_SEQUENCES,
            json_warn_duplicate_keys: JSON_WARN_DUPLICATE_KEYS,
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
    opts: js_lexer::JSONOptions,
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<JsonResult, bun_core::Error> {
    if let Some(root) = empty_source_fast_path(source) {
        return Ok(JsonResult {
            root,
            indentation: Indentation::default(),
        });
    }

    let mut parser = JSONLikeParser::init(opts, bump, source, log)?;
    debug_assert!(!parser.source().contents.is_empty());

    let root = parser.parse_expr(false, true)?;

    Ok(JsonResult {
        root,
        indentation: if opts.guess_indentation {
            parser.lexer.indent_info.guess
        } else {
            Indentation::default()
        },
    })
}

/// Parse Package JSON
/// Allow trailing commas & comments.
/// This eagerly transcodes UTF-16 strings into UTF-8 strings
/// Use this when the text may need to be reprinted to disk as JSON (and not as JavaScript)
/// Eagerly converting UTF-8 to UTF-16 can cause a performance issue
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
    if let Some(expr) = empty_source_fast_path(source) {
        return Ok(expr);
    }

    let mut parser = JSONLikeParser::init(JSON_OPTS, bump, source, log)?;
    debug_assert!(!parser.source().contents.is_empty());

    let result = parser.parse_expr(false, true)?;
    if CHECK_LEN {
        if parser.lexer.end >= source.contents.len() {
            return Ok(result);
        }
        parser.lexer.unexpected()?;
        return Err(bun_core::err!("ParserError"));
    }
    Ok(result)
}

pub fn parse_for_macro(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if let Some(expr) = empty_source_fast_path(source) {
        return Ok(expr);
    }

    let mut parser = JSONLikeParser::init(MACRO_JSON_OPTS, bump, source, log)?;

    parser.parse_expr(false, false)
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
    if let Some(expr) = empty_source_fast_path(source) {
        return Ok(JSONParseResult {
            expr,
            tag: if source.contents.is_empty() {
                JSONParseResultTag::Empty
            } else {
                JSONParseResultTag::Expr
            },
        });
    }

    let mut parser = JSONLikeParser::init(JSON_OPTS, bump, source, log)?;
    let result = parser.parse_expr(false, true)?;
    Ok(JSONParseResult {
        tag: if !LEXER_DEBUGGER_WORKAROUND && parser.lexer.is_ascii_only {
            JSONParseResultTag::Ascii
        } else {
            JSONParseResultTag::Expr
        },
        expr: result,
    })
}

// threadlocal var env_json_auto_quote_buffer: MutableString = undefined;
// threadlocal var env_json_auto_quote_buffer_loaded: bool = false;
pub fn parse_env_json(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if let Some(expr) = empty_source_fast_path(source) {
        return Ok(expr);
    }

    let mut parser = JSONLikeParser::init(DOTENV_JSON_OPTS, bump, source, log)?;

    match source.contents[0] {
        b'{' | b'[' | b'0'..=b'9' | b'"' | b'\'' => parser.parse_expr(false, false),
        _ => match parser.lexer.token {
            T::TTrue => Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: js_ast::expr::Data::EBoolean(E::Boolean { value: true }),
            }),
            T::TFalse => Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: js_ast::expr::Data::EBoolean(E::Boolean { value: false }),
            }),
            T::TNull => Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: js_ast::expr::Data::ENull(E::Null {}),
            }),
            T::TIdentifier => {
                if parser.lexer.identifier == b"undefined" {
                    return Ok(Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: js_ast::expr::Data::EUndefined(E::Undefined {}),
                    });
                }

                parser.parse_expr(true, false)
            }
            _ => parser.parse_expr(true, false),
        },
    }
}

#[inline]
pub fn parse_ts_config<const FORCE_UTF8: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    if let Some(expr) = empty_source_fast_path(source) {
        return Ok(expr);
    }

    let mut parser = JSONLikeParser::init(TSCONFIG_OPTS, bump, source, log)?;

    parser.parse_expr(false, FORCE_UTF8)
}

// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    // `bun_js_printer` is a sibling crate; reachable here only as a dev-dep so
    // the JSON-round-trip test can print without `bun_parsers → bun_js_printer`
    // appearing in the main dep graph.
    use bun_js_printer as js_printer;

    fn expect_printed_json(_contents: &[u8], expected: &[u8]) -> Result<(), bun_core::Error> {
        // RAII: `StoreResetGuard` resets both thread-local AST stores on every
        // exit path (including `?`).
        let _store_scope = js_ast::StoreResetGuard::new();

        let mut contents = vec![0u8; _contents.len() + 1];
        contents[.._contents.len()].copy_from_slice(_contents);
        *contents.last_mut().unwrap() = b';';
        let mut log = bun_ast::Log::init();

        let source = bun_ast::Source::init_path_string("source.json", &contents);
        let bump = Bump::new();
        let expr = parse::<false>(&source, &mut log, &bump)?;

        if !log.msgs.is_empty() {
            bun_core::Output::panic(format_args!(
                "--FAIL--\nExpr {:?}\nLog: {}\n--FAIL--",
                expr,
                bstr::BStr::new(&log.msgs[0].data.text)
            ));
        }

        let buffer_writer = js_printer::BufferWriter::init();
        let mut writer = js_printer::BufferPrinter::init(buffer_writer);
        let written = js_printer::print_json(
            &mut writer,
            expr,
            &source,
            js_printer::PrintJsonOptions {
                mangled_props: None,
            },
        )?;
        let buf = writer.ctx.buffer.as_slice();
        let mut js = &buf[0..written + 1];

        if js.len() > 1 {
            while js[js.len() - 1] == b'\n' {
                js = &js[0..js.len() - 1];
            }

            if js[js.len() - 1] == b';' {
                js = &js[0..js.len() - 1];
            }
        }

        assert_eq!(expected, js);
        Ok(())
    }
}
