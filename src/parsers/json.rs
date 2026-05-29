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

    // Zig: std.HashMap(u64, void, IdentityContext, 80)
    // TODO(port): identity-hash u64 set with 80% max-load — verify bun_collections has an
    // identity-hasher variant; otherwise add one. Using HashMap<u64, ()> for now.
    pub(super) type HashMap = bun_collections::HashMap<u64, ()>;

    // Zig used a threadlocal SinglyLinkedList<HashMap> as a freelist.
    // PORT NOTE: reshaped for borrowck — Rust thread_local + Vec<HashMap> freelist;
    // a borrowed Node* across calls is replaced by an owned HashMap moved out/in.
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
    Ty: js_ast::ExprInit, // TODO(port): bound to whatever trait Expr::init accepts
{
    // Zig had: if @typeInfo(Type) == .pointer => @compileError — Rust's type system
    // already prevents passing a reference where a value is expected; no runtime check needed.

    #[cfg(debug_assertions)]
    {
        // TODO(port): the Zig code asserted, when Ty == E.Object, that every property
        // has key.is_some(), value.is_some(), initializer.is_none(). Requires
        // specialization or a method on the ExprInit trait.
    }

    Expr::init(t, loc)
}

pub struct JSONLikeParser<'a, 'bump> {
    pub lexer: js_lexer::Lexer<'a, 'bump>,
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
        // TODO(port): narrow error set
        Self::init_with_list_allocator(opts, bump, bump, source_, log)
    }

    pub(crate) fn init_with_list_allocator(
        opts: js_lexer::JSONOptions,
        bump: &'bump Bump,
        list_bump: &'bump Bump,
        source_: &'a bun_ast::Source,
        log: &'a mut bun_ast::Log,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        Expr::data_store_assert();
        Stmt::data_store_assert();
        // TODO(port): Zig calls Expr.Data.Store.assert() / Stmt.Data.Store.assert();
        // map to whatever the typed-arena store assertion becomes in bun_js_parser.

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

    #[inline(never)]
    pub fn parse_expr(
        &mut self,
        maybe_auto_quote: bool,
        force_utf8: bool,
    ) -> Result<Expr, bun_core::Error> {
        if !self.stack_check.is_safe_to_recurse() {
            // Zig: `bun.throwStackOverflow()`.
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
                // PORT NOTE: Zig grew an `ArrayList(Expr)` in `list_allocator` and
                // `moveFromList`-ed it. The Rust `Vec` is `Vec`-backed (global
                // allocator), so build a `Vec<Expr>` directly and hand it off.
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
                    exprs.push(item); // PERF(port): Zig used `catch unreachable` (OOM crash)
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
                // PORT NOTE: see TOpenBracket note — `Vec` is `Vec`-backed.
                let mut properties: Vec<G::Property> = Vec::new();
                // errdefer properties.deinit() — dropped automatically on `?`.

                // PORT NOTE: reshaped for borrowck — Zig used `void`/`*Node` when
                // json_warn_duplicate_keys is false; Rust uses Option to keep one code path.
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
                // PORT NOTE: Zig `defer` — scopeguard runs on both success and error paths.

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
                    // Zig copied the `E.String` by value; `EString` is intentionally
                    // not `Clone` (rope `next` would alias) — `shallow_clone` is the
                    // explicit field-copy that matches the Zig struct copy.
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
                    // PERF(port): Zig used `catch unreachable` (OOM crash)
                }

                if self.lexer.has_newline_before {
                    is_single_line = false;
                }
                self.lexer.expect(T::TCloseBrace)?;
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
        // TODO(port): narrow error set
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

pub struct PackageJSONVersionChecker<'a, 'bump> {
    pub lexer: js_lexer::Lexer<'a, 'bump>,
    pub source: &'a bun_ast::Source,
    // PORT NOTE — Stacked Borrows: no separate `log` field; route through
    // `self.lexer.log_mut()` (single provenance chain — see `JSONLikeParser`).
    pub bump: &'bump Bump,
    pub depth: usize,
    pub stack_check: StackCheck,

    pub found_version_buf: [u8; 1024],
    pub found_name_buf: [u8; 1024],

    // PORT NOTE: reshaped for borrowck — Zig stored `found_name: []const u8` as a
    // self-referential slice into `found_name_buf`. Rust stores the length instead;
    // use `.found_name()` / `.found_version()` accessors.
    found_name_len: usize,
    found_version_len: usize,

    pub has_found_name: bool,
    pub has_found_version: bool,

    pub name_loc: bun_ast::Loc,
}

// Zig: const opts = if (LEXER_DEBUGGER_WORKAROUND) JSONOptions{} else JSONOptions{ is_json=true, json_warn_duplicate_keys=false, allow_trailing_commas=true, allow_comments=true }
// TODO(port): wire as const-generic params on the lexer type once js_lexer::NewLexer is ported.
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
        // TODO(port): narrow error set
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
            // Zig: `bun.throwStackOverflow()`.
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
        // TODO(port): narrow error set
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

// Spec json.zig:557-565 — `Array.child == u8` → `E::String` (not `E::Array`).
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

// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn parse<const FORCE_UTF8: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    let mut parser = JSONLikeParser::init(JSON_OPTS, bump, source, log)?;
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: empty_object_data(),
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_string_data(),
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_object_data(),
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_array_data(),
                });
            }
        }
        _ => {}
    }

    parser.parse_expr(false, FORCE_UTF8)
}

pub fn parse_package_json_utf8(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    let len = source.contents.len();

    match len {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: empty_object_data(),
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_string_data(),
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_object_data(),
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_array_data(),
                });
            }
        }
        _ => {}
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
    // TODO(port): narrow error set
    let len = source.contents.len();

    match len {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(JsonResult {
                root: Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_object_data(),
                },
                indentation: Indentation::default(),
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(JsonResult {
                    root: Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: empty_string_data(),
                    },
                    indentation: Indentation::default(),
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(JsonResult {
                    root: Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: empty_object_data(),
                    },
                    indentation: Indentation::default(),
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(JsonResult {
                    root: Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: empty_array_data(),
                    },
                    indentation: Indentation::default(),
                });
            }
        }
        _ => {}
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

pub fn parse_utf8(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    parse_utf8_impl::<false>(source, log, bump)
}

#[inline]
pub fn parse_utf8_impl<const CHECK_LEN: bool>(
    source: &bun_ast::Source,
    log: &mut bun_ast::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    let len = source.contents.len();

    match len {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: empty_object_data(),
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_string_data(),
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_object_data(),
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_array_data(),
                });
            }
        }
        _ => {}
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
    // TODO(port): narrow error set
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: empty_object_data(),
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_string_data(),
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_object_data(),
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_array_data(),
                });
            }
        }
        _ => {}
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
    // TODO(port): narrow error set
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(JSONParseResult {
                expr: Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_object_data(),
                },
                tag: JSONParseResultTag::Empty,
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(JSONParseResult {
                    expr: Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: empty_string_data(),
                    },
                    tag: JSONParseResultTag::Expr,
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(JSONParseResult {
                    expr: Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: empty_object_data(),
                    },
                    tag: JSONParseResultTag::Expr,
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(JSONParseResult {
                    expr: Expr {
                        loc: bun_ast::Loc { start: 0 },
                        data: empty_array_data(),
                    },
                    tag: JSONParseResultTag::Expr,
                });
            }
        }
        _ => {}
    }

    // NOTE: Zig passes `source.*` (by value) here, unlike every other call site.
    // TODO(port): verify whether JSONParser::init wants by-ref or by-value source.
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
    // TODO(port): narrow error set
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: empty_object_data(),
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_string_data(),
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_object_data(),
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_array_data(),
                });
            }
        }
        _ => {}
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
    // TODO(port): narrow error set
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr {
                loc: bun_ast::Loc { start: 0 },
                data: empty_object_data(),
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_string_data(),
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_object_data(),
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: empty_array_data(),
                });
            }
        }
        _ => {}
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
        // Zig: Expr.Data.Store.create(); Stmt.Data.Store.create(); defer { ..reset() }.
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
        // TODO(port): Zig accessed writer.ctx.buffer.list.items.ptr[0..written+1].
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

// ported from: src/interchange/json.zig
