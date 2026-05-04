use core::cell::RefCell;

use bumpalo::Bump;
use bumpalo::collections::Vec as BumpVec;

use bun_core::{self, StackCheck};
use bun_logger as logger;
use bun_js_parser::js_lexer;
use bun_js_parser::js_lexer::T;
use bun_js_parser::js_ast;
use bun_js_parser::js_ast::{E, G, Stmt, ExprNodeList};
use bun_js_parser::js_printer;
use bun_js_parser::js_printer::options::Indentation;
use bun_collections::BabyList;

pub use bun_js_parser::js_ast::Expr;

const LEXER_DEBUGGER_WORKAROUND: bool = false;

// ──────────────────────────────────────────────────────────────────────────
// HashMapPool
// ──────────────────────────────────────────────────────────────────────────

mod hash_map_pool {
    use super::*;

    // Zig: std.HashMap(u64, void, IdentityContext, 80)
    // TODO(port): identity-hash u64 set with 80% max-load — verify bun_collections has an
    // identity-hasher variant; otherwise add one. Using HashMap<u64, ()> for now.
    pub type HashMap = bun_collections::HashMap<u64, ()>;

    // Zig used a threadlocal SinglyLinkedList<HashMap> as a freelist.
    // PORT NOTE: reshaped for borrowck — Rust thread_local + Vec<HashMap> freelist;
    // a borrowed Node* across calls is replaced by an owned HashMap moved out/in.
    thread_local! {
        static LIST: RefCell<Vec<HashMap>> = const { RefCell::new(Vec::new()) };
    }

    pub fn get() -> HashMap {
        LIST.with_borrow_mut(|list| {
            if let Some(mut map) = list.pop() {
                map.clear();
                map
            } else {
                HashMap::default()
            }
        })
    }

    pub fn release(map: HashMap) {
        LIST.with_borrow_mut(|list| list.push(map));
    }
}

// ──────────────────────────────────────────────────────────────────────────

fn new_expr<Ty>(t: Ty, loc: logger::Loc) -> Expr
where
    Ty: js_ast::ExprInit, // TODO(port): bound to whatever trait Expr::init accepts
{
    // Zig had: if @typeInfo(Type) == .pointer => @compileError — Rust's type system
    // already prevents passing a reference where a value is expected; no runtime check needed.

    #[cfg(debug_assertions)]
    {
        // TODO(port): the Zig code asserted, when Ty == E.Object, that every property
        // has key.is_some(), value.is_some(), initializer.is_none(). Requires
        // specialization or a method on the ExprInit trait; deferring to Phase B.
    }

    Expr::init(t, loc)
}

// ──────────────────────────────────────────────────────────────────────────
// JSONLikeParser
// ──────────────────────────────────────────────────────────────────────────
//
// Zig defines two layers:
//   fn JSONLikeParser(comptime opts: JSONOptions) type   — wrapper
//   fn JSONLikeParser_(comptime ...8 bools...) type      — "hack fixes using LLDB"
//
// In Rust the wrapper collapses: stable Rust cannot use a struct as a const
// generic param (adt_const_params is unstable), so we expose the 8-bool form
// directly as the canonical type. Each instantiation site below spells out the
// flags. // TODO(port): if adt_const_params stabilizes, switch to
// `<const OPTS: js_lexer::JSONOptions>`.

// TODO(port): Lexer type — Zig: `js_lexer.NewLexer(opts)`. Assumed Rust shape:
// `js_lexer::Lexer<const IS_JSON, const ALLOW_COMMENTS, ...>` or
// `js_lexer::Lexer<const OPTS: JSONOptions>`. Placeholder alias; Phase B wires.
type LexerFor<
    const IS_JSON: bool,
    const ALLOW_COMMENTS: bool,
    const ALLOW_TRAILING_COMMAS: bool,
    const IGNORE_LEADING_ESCAPE_SEQUENCES: bool,
    const IGNORE_TRAILING_ESCAPE_SEQUENCES: bool,
    const JSON_WARN_DUPLICATE_KEYS: bool,
    const WAS_ORIGINALLY_MACRO: bool,
    const GUESS_INDENTATION: bool,
> = js_lexer::Lexer; // TODO(port): thread const generics through to js_lexer::NewLexer

pub struct JSONLikeParser<
    'a,
    'bump,
    const IS_JSON: bool,
    const ALLOW_COMMENTS: bool,
    const ALLOW_TRAILING_COMMAS: bool,
    const IGNORE_LEADING_ESCAPE_SEQUENCES: bool,
    const IGNORE_TRAILING_ESCAPE_SEQUENCES: bool,
    const JSON_WARN_DUPLICATE_KEYS: bool,
    const WAS_ORIGINALLY_MACRO: bool,
    const GUESS_INDENTATION: bool,
> {
    pub lexer: LexerFor<
        IS_JSON,
        ALLOW_COMMENTS,
        ALLOW_TRAILING_COMMAS,
        IGNORE_LEADING_ESCAPE_SEQUENCES,
        IGNORE_TRAILING_ESCAPE_SEQUENCES,
        JSON_WARN_DUPLICATE_KEYS,
        WAS_ORIGINALLY_MACRO,
        GUESS_INDENTATION,
    >,
    pub log: &'a mut logger::Log,
    pub bump: &'bump Bump,
    pub list_bump: &'bump Bump,
    pub stack_check: StackCheck,
}

impl<
        'a,
        'bump,
        const IS_JSON: bool,
        const ALLOW_COMMENTS: bool,
        const ALLOW_TRAILING_COMMAS: bool,
        const IGNORE_LEADING_ESCAPE_SEQUENCES: bool,
        const IGNORE_TRAILING_ESCAPE_SEQUENCES: bool,
        const JSON_WARN_DUPLICATE_KEYS: bool,
        const WAS_ORIGINALLY_MACRO: bool,
        const GUESS_INDENTATION: bool,
    >
    JSONLikeParser<
        'a,
        'bump,
        IS_JSON,
        ALLOW_COMMENTS,
        ALLOW_TRAILING_COMMAS,
        IGNORE_LEADING_ESCAPE_SEQUENCES,
        IGNORE_TRAILING_ESCAPE_SEQUENCES,
        JSON_WARN_DUPLICATE_KEYS,
        WAS_ORIGINALLY_MACRO,
        GUESS_INDENTATION,
    >
{
    pub fn init(
        bump: &'bump Bump,
        source_: &logger::Source,
        log: &'a mut logger::Log,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        Self::init_with_list_allocator(bump, bump, source_, log)
    }

    pub fn init_with_list_allocator(
        bump: &'bump Bump,
        list_bump: &'bump Bump,
        source_: &logger::Source,
        log: &'a mut logger::Log,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        Expr::data_store_assert();
        Stmt::data_store_assert();
        // TODO(port): Zig calls Expr.Data.Store.assert() / Stmt.Data.Store.assert();
        // map to whatever the typed-arena store assertion becomes in bun_js_parser.

        Ok(Self {
            lexer: js_lexer::Lexer::init(log, source_, bump)?,
            bump,
            log,
            list_bump,
            stack_check: StackCheck::init(),
        })
    }

    #[inline]
    pub fn source(&self) -> &logger::Source {
        &self.lexer.source
    }

    pub fn parse_expr<const MAYBE_AUTO_QUOTE: bool, const FORCE_UTF8: bool>(
        &mut self,
    ) -> Result<Expr, bun_core::Error> {
        if !self.stack_check.is_safe_to_recurse() {
            bun_core::throw_stack_overflow()?;
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
                if FORCE_UTF8 {
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
                let mut exprs: BumpVec<'bump, Expr> = BumpVec::new_in(self.list_bump);
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

                    let item = self.parse_expr::<false, FORCE_UTF8>()?;
                    exprs.push(item); // PERF(port): Zig used `catch unreachable` (OOM crash)
                }

                if self.lexer.has_newline_before {
                    is_single_line = false;
                }
                self.lexer.expect(T::TCloseBracket)?;
                Ok(new_expr(
                    E::Array {
                        items: ExprNodeList::move_from_list(&mut exprs),
                        is_single_line,
                        was_originally_macro: WAS_ORIGINALLY_MACRO,
                    },
                    loc,
                ))
            }
            T::TOpenBrace => {
                self.lexer.next()?;
                let mut is_single_line = !self.lexer.has_newline_before;
                let mut properties: BumpVec<'bump, G::Property> = BumpVec::new_in(self.list_bump);
                // errdefer properties.deinit() — dropped automatically on `?`.

                // PORT NOTE: reshaped for borrowck — Zig used `void`/`*Node` when
                // JSON_WARN_DUPLICATE_KEYS is false; Rust uses Option to keep one code path.
                let mut duplicates: Option<hash_map_pool::HashMap> = if JSON_WARN_DUPLICATE_KEYS {
                    Some(hash_map_pool::get())
                } else {
                    None
                };
                let duplicates_guard = scopeguard::guard(&mut duplicates, |d| {
                    if JSON_WARN_DUPLICATE_KEYS {
                        if let Some(map) = d.take() {
                            hash_map_pool::release(map);
                        }
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

                    let str = if FORCE_UTF8 {
                        self.lexer.to_utf8_e_string()?
                    } else {
                        self.lexer.to_e_string()?
                    };

                    let key_range = self.lexer.range();
                    let key = new_expr(str.clone(), key_range.loc);
                    // TODO(port): E::String may not be Clone; Zig copied the value type.
                    self.lexer.expect(T::TStringLiteral)?;

                    if JSON_WARN_DUPLICATE_KEYS {
                        let hash_key = str.hash();
                        // SAFETY-NOTE: duplicates is Some when JSON_WARN_DUPLICATE_KEYS.
                        let dup = duplicates_guard
                            .as_mut()
                            .unwrap()
                            .insert(hash_key, ())
                            .is_some();

                        // Warn about duplicate keys
                        if dup {
                            self.log
                                .add_range_warning_fmt(
                                    &self.lexer.source,
                                    key_range,
                                    self.bump,
                                    format_args!(
                                        "Duplicate key \"{}\" in object literal",
                                        bstr::BStr::new(str.string(self.bump)?)
                                    ),
                                )
                                .expect("unreachable");
                        }
                    }

                    self.lexer.expect(T::TColon)?;
                    let value = self.parse_expr::<false, FORCE_UTF8>()?;
                    properties.push(G::Property {
                        key: Some(key),
                        value: Some(value),
                        kind: js_ast::G::property::Kind::Normal,
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
                        properties: G::Property::List::move_from_list(&mut properties),
                        is_single_line,
                        was_originally_macro: WAS_ORIGINALLY_MACRO,
                    },
                    loc,
                ))
            }
            _ => {
                if MAYBE_AUTO_QUOTE {
                    self.lexer = js_lexer::Lexer::init_json(self.log, self.source(), self.bump)?;
                    // TODO(port): borrowck — self.log/self.source borrowed while assigning
                    // self.lexer; may need to capture into locals first.
                    self.lexer.parse_string_literal(0)?;
                    return self.parse_expr::<false, FORCE_UTF8>();
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
            if !ALLOW_TRAILING_COMMAS {
                self.log
                    .add_range_error(
                        &self.lexer.source,
                        comma_range,
                        "JSON does not support trailing commas",
                    )
                    .expect("unreachable");
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
    pub lexer: js_lexer::Lexer, // TODO(port): NewLexer(opts) — see PKG_JSON_OPTS below
    pub source: &'a logger::Source,
    pub log: &'a mut logger::Log,
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

    pub name_loc: logger::Loc,
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

impl<'a, 'bump> PackageJSONVersionChecker<'a, 'bump> {
    pub fn init(
        bump: &'bump Bump,
        source: &'a logger::Source,
        log: &'a mut logger::Log,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Self {
            lexer: js_lexer::Lexer::init(log, source, bump)?,
            bump,
            log,
            source,
            depth: 0,
            stack_check: StackCheck::init(),
            found_version_buf: [0; 1024],
            found_name_buf: [0; 1024],
            found_name_len: 0,
            found_version_len: 0,
            has_found_name: false,
            has_found_version: false,
            name_loc: logger::Loc::EMPTY,
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
            bun_core::throw_stack_overflow()?;
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
                // PORT NOTE: Zig `defer p.depth -= 1` — wrap body in a closure so `?`
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
                                // TODO(port): Zig matched on `.e_string` tag and read
                                // `.e_string.data` directly; map to whatever accessor the
                                // ported Expr.Data exposes.
                                if !self.has_found_name && key_s.data() == b"name" {
                                    let len = val_s.data().len().min(self.found_name_buf.len());

                                    self.found_name_buf[..len]
                                        .copy_from_slice(&val_s.data()[..len]);
                                    self.found_name_len = len;
                                    self.has_found_name = true;
                                    self.name_loc = value.loc;
                                } else if !self.has_found_version && key_s.data() == b"version" {
                                    let len = val_s.data().len().min(self.found_version_buf.len());
                                    self.found_version_buf[..len]
                                        .copy_from_slice(&val_s.data()[..len]);
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
                self.log
                    .add_range_error(
                        self.source,
                        comma_range,
                        "JSON does not support trailing commas",
                    )
                    .expect("unreachable");
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
// Zig `toAST` switches on `@typeInfo(Type)` to recursively convert any value
// into a `js_ast.Expr`. Rust has no `@typeInfo`; this becomes a trait with
// per-type impls. Struct/enum/union arms require a derive macro.

pub trait ToAst {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error>;
}

impl ToAst for bool {
    fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
        Ok(Expr {
            data: js_ast::expr::Data::EBoolean(E::Boolean { value: *self }),
            loc: logger::Loc::default(),
        })
    }
}

macro_rules! impl_to_ast_int {
    ($($t:ty),*) => {$(
        impl ToAst for $t {
            fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
                Ok(Expr {
                    data: js_ast::expr::Data::ENumber(E::Number { value: *self as f64 }),
                    loc: logger::Loc::default(),
                })
            }
        }
    )*};
}
impl_to_ast_int!(i8, i16, i32, i64, isize, u8, u16, u32, u64, usize);

macro_rules! impl_to_ast_float {
    ($($t:ty),*) => {$(
        impl ToAst for $t {
            fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
                Ok(Expr {
                    data: js_ast::expr::Data::ENumber(E::Number { value: *self as f64 }),
                    loc: logger::Loc::default(),
                })
            }
        }
    )*};
}
impl_to_ast_float!(f32, f64);

impl ToAst for [u8] {
    fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
        Ok(Expr::init(E::String::init(self), logger::Loc::EMPTY))
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
        for (_i, ex) in self.iter().enumerate() {
            exprs.push(ex.to_ast(bump)?);
        }
        Ok(Expr::init(
            E::Array {
                items: ExprNodeList::from_slice(exprs.into_bump_slice()),
                ..Default::default()
            },
            logger::Loc::EMPTY,
        ))
    }
}

impl<T: ToAst, const N: usize> ToAst for [T; N] {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        self.as_slice().to_ast(bump)
    }
}

impl<T: ToAst> ToAst for Option<T> {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        match self {
            Some(v) => v.to_ast(bump),
            None => Ok(Expr {
                data: js_ast::expr::Data::ENull(E::Null {}),
                loc: logger::Loc::default(),
            }),
        }
    }
}

impl ToAst for () {
    fn to_ast(&self, _bump: &Bump) -> Result<Expr, bun_core::Error> {
        Ok(Expr {
            data: js_ast::expr::Data::ENull(E::Null {}),
            loc: logger::Loc::default(),
        })
    }
}

impl ToAst for bun_core::Error {
    fn to_ast(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        self.name().as_bytes().to_ast(bump)
    }
}

// TODO(port): proc-macro — Zig's `.@"struct"` arm iterates `@typeInfo(Type).Struct.fields`
// and emits an `E.Object` keyed by field name. Provide `#[derive(ToAst)]` in Phase B that
// expands to:
//   impl ToAst for Foo {
//     fn to_ast(&self, bump: &Bump) -> Result<Expr, _> {
//       let mut properties = BabyList::<G::Property>::with_capacity(bump, N);
//       properties.push_assume_capacity(G::Property {
//         key: Some(Expr::init(E::String { data: b"field_name" }, Loc::EMPTY)),
//         value: Some(self.field_name.to_ast(bump)?),
//         ..Default::default()
//       });
//       ...
//       Ok(Expr::init(E::Object { properties, is_single_line: N <= 1, .. }, Loc::EMPTY))
//     }
//   }
//
// TODO(port): proc-macro — Zig's `.@"enum"` arm validates the discriminant via
// `intToEnum` (returns null on failure) then emits `@tagName(value)` as a string.
// Map to `#[derive(strum::IntoStaticStr)]` + `<&'static str>::from(*self).as_bytes().to_ast()`.
//
// TODO(port): proc-macro — Zig's `.@"union"` arm (tagged union) constructs a
// single-field anonymous struct `{ <variant_name>: payload }` and recurses.
// In Rust this is the natural shape of `enum` payloads; the derive should emit
// `match self { Variant(v) => /* { "Variant": v } */ }`.

pub fn to_ast<Ty: ToAst + ?Sized>(bump: &Bump, value: &Ty) -> Result<Expr, bun_core::Error> {
    value.to_ast(bump)
}

// ──────────────────────────────────────────────────────────────────────────
// Parser type aliases
// ──────────────────────────────────────────────────────────────────────────
//
// TODO(port): verify js_lexer::JSONOptions field defaults. The aliases below
// assume all-false defaults except where the Zig literal sets a field. (The Zig
// `JSONParserForMacro` explicitly setting `json_warn_duplicate_keys = false`
// suggests the default may be `true` — adjust JSONParser/DotEnvJSONParser/
// TSConfigParser if so.)

// JSONLikeParser<'a,'bump, IS_JSON, ALLOW_COMMENTS, ALLOW_TRAILING_COMMAS,
//   IGNORE_LEADING_ESC, IGNORE_TRAILING_ESC, JSON_WARN_DUP_KEYS,
//   WAS_ORIGINALLY_MACRO, GUESS_INDENTATION>

type JSONParser<'a, 'bump> =
    JSONLikeParser<'a, 'bump, true, false, false, false, false, false, false, false>;

type DotEnvJSONParser<'a, 'bump> =
    JSONLikeParser<'a, 'bump, true, false, true, true, true, false, false, false>;

type TSConfigParser<'a, 'bump> =
    JSONLikeParser<'a, 'bump, true, true, true, false, false, false, false, false>;

type JSONParserForMacro<'a, 'bump> =
    JSONLikeParser<'a, 'bump, true, true, true, false, false, false, true, false>;

type PackageJSONParser<'a, 'bump> =
    JSONLikeParser<'a, 'bump, true, true, true, false, false, false, false, false>;

// ──────────────────────────────────────────────────────────────────────────

// TODO(port): these were `var` (mutable file-scope) in Zig because Expr.Data
// stores `*E.Object` etc. Kept as `static mut` to preserve identity; access
// must be `unsafe`. Phase B: prefer `Expr::Data` constructors that don't need
// a backing static (e.g. inline empty-object sentinel).
static mut EMPTY_OBJECT: E::Object = E::Object::EMPTY;
static mut EMPTY_ARRAY: E::Array = E::Array::EMPTY;
static mut EMPTY_STRING: E::String = E::String::EMPTY;

#[inline]
fn empty_string_data() -> js_ast::expr::Data {
    // SAFETY: EMPTY_STRING is never mutated after init; treated as &'static.
    js_ast::expr::Data::EString(unsafe { core::ptr::addr_of_mut!(EMPTY_STRING) })
}
#[inline]
fn empty_object_data() -> js_ast::expr::Data {
    // SAFETY: see above.
    js_ast::expr::Data::EObject(unsafe { core::ptr::addr_of_mut!(EMPTY_OBJECT) })
}
#[inline]
fn empty_array_data() -> js_ast::expr::Data {
    // SAFETY: see above.
    js_ast::expr::Data::EArray(unsafe { core::ptr::addr_of_mut!(EMPTY_ARRAY) })
}

// ──────────────────────────────────────────────────────────────────────────

/// Parse JSON
/// This leaves UTF-16 strings as UTF-16 strings
/// The JavaScript Printer will handle escaping strings if necessary
pub fn parse<const FORCE_UTF8: bool>(
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    let mut parser = JSONParser::init(bump, source, log)?;
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_string_data() });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_array_data() });
            }
        }
        _ => {}
    }

    parser.parse_expr::<false, FORCE_UTF8>()
}

/// Parse Package JSON
/// Allow trailing commas & comments.
/// This eagerly transcodes UTF-16 strings into UTF-8 strings
/// Use this when the text may need to be reprinted to disk as JSON (and not as JavaScript)
/// Eagerly converting UTF-8 to UTF-16 can cause a performance issue
pub fn parse_package_json_utf8(
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    let len = source.contents.len();

    match len {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_string_data() });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_array_data() });
            }
        }
        _ => {}
    }

    let mut parser = PackageJSONParser::init(bump, source, log)?;
    debug_assert!(!parser.source().contents.is_empty());

    parser.parse_expr::<false, true>()
}

pub struct JsonResult {
    pub root: Expr,
    pub indentation: Indentation,
}

impl Default for JsonResult {
    fn default() -> Self {
        Self { root: Expr::default(), indentation: Indentation::default() }
    }
}

// TODO(port): Zig signature takes `comptime opts: js_lexer.JSONOptions`. Stable
// Rust cannot use a struct const-generic; callers must spell out the 8 bools.
// Provide a thin wrapper per call site, or wait for adt_const_params.
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
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<JsonResult, bun_core::Error> {
    // TODO(port): narrow error set
    let len = source.contents.len();

    match len {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(JsonResult {
                root: Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() },
                indentation: Indentation::default(),
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(JsonResult {
                    root: Expr { loc: logger::Loc { start: 0 }, data: empty_string_data() },
                    indentation: Indentation::default(),
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(JsonResult {
                    root: Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() },
                    indentation: Indentation::default(),
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(JsonResult {
                    root: Expr { loc: logger::Loc { start: 0 }, data: empty_array_data() },
                    indentation: Indentation::default(),
                });
            }
        }
        _ => {}
    }

    let mut parser = JSONLikeParser::<
        IS_JSON,
        ALLOW_COMMENTS,
        ALLOW_TRAILING_COMMAS,
        IGNORE_LEADING_ESCAPE_SEQUENCES,
        IGNORE_TRAILING_ESCAPE_SEQUENCES,
        JSON_WARN_DUPLICATE_KEYS,
        WAS_ORIGINALLY_MACRO,
        GUESS_INDENTATION,
    >::init(bump, source, log)?;
    debug_assert!(!parser.source().contents.is_empty());

    let root = parser.parse_expr::<false, true>()?;

    Ok(JsonResult {
        root,
        indentation: if GUESS_INDENTATION {
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
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    parse_utf8_impl::<false>(source, log, bump)
}

pub fn parse_utf8_impl<const CHECK_LEN: bool>(
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    let len = source.contents.len();

    match len {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_string_data() });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_array_data() });
            }
        }
        _ => {}
    }

    let mut parser = JSONParser::init(bump, source, log)?;
    debug_assert!(!parser.source().contents.is_empty());

    let result = parser.parse_expr::<false, true>()?;
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
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_string_data() });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_array_data() });
            }
        }
        _ => {}
    }

    let mut parser = JSONParserForMacro::init(bump, source, log)?;

    parser.parse_expr::<false, false>()
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
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<JSONParseResult, bun_core::Error> {
    // TODO(port): narrow error set
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(JSONParseResult {
                expr: Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() },
                tag: JSONParseResultTag::Empty,
            });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(JSONParseResult {
                    expr: Expr { loc: logger::Loc { start: 0 }, data: empty_string_data() },
                    tag: JSONParseResultTag::Expr,
                });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(JSONParseResult {
                    expr: Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() },
                    tag: JSONParseResultTag::Expr,
                });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(JSONParseResult {
                    expr: Expr { loc: logger::Loc { start: 0 }, data: empty_array_data() },
                    tag: JSONParseResultTag::Expr,
                });
            }
        }
        _ => {}
    }

    // NOTE: Zig passes `source.*` (by value) here, unlike every other call site.
    // TODO(port): verify whether JSONParser::init wants by-ref or by-value source.
    let mut parser = JSONParser::init(bump, source, log)?;
    let result = parser.parse_expr::<false, true>()?;
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
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_string_data() });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_array_data() });
            }
        }
        _ => {}
    }

    let mut parser = DotEnvJSONParser::init(bump, source, log)?;

    match source.contents[0] {
        b'{' | b'[' | b'0'..=b'9' | b'"' | b'\'' => parser.parse_expr::<false, false>(),
        _ => match parser.lexer.token {
            T::TTrue => Ok(Expr {
                loc: logger::Loc { start: 0 },
                data: js_ast::expr::Data::EBoolean(E::Boolean { value: true }),
            }),
            T::TFalse => Ok(Expr {
                loc: logger::Loc { start: 0 },
                data: js_ast::expr::Data::EBoolean(E::Boolean { value: false }),
            }),
            T::TNull => Ok(Expr {
                loc: logger::Loc { start: 0 },
                data: js_ast::expr::Data::ENull(E::Null {}),
            }),
            T::TIdentifier => {
                if parser.lexer.identifier == b"undefined" {
                    return Ok(Expr {
                        loc: logger::Loc { start: 0 },
                        data: js_ast::expr::Data::EUndefined(E::Undefined {}),
                    });
                }

                parser.parse_expr::<true, false>()
            }
            _ => parser.parse_expr::<true, false>(),
        },
    }
}

pub fn parse_ts_config<const FORCE_UTF8: bool>(
    source: &logger::Source,
    log: &mut logger::Log,
    bump: &Bump,
) -> Result<Expr, bun_core::Error> {
    // TODO(port): narrow error set
    match source.contents.len() {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
        }
        // This is a fast pass I guess
        2 => {
            if &source.contents[0..1] == b"\"\"" || &source.contents[0..1] == b"''" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_string_data() });
            } else if &source.contents[0..1] == b"{}" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_object_data() });
            } else if &source.contents[0..1] == b"[]" {
                return Ok(Expr { loc: logger::Loc { start: 0 }, data: empty_array_data() });
            }
        }
        _ => {}
    }

    let mut parser = TSConfigParser::init(bump, source, log)?;

    parser.parse_expr::<false, FORCE_UTF8>()
}

// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn expect_printed_json(_contents: &[u8], expected: &[u8]) -> Result<(), bun_core::Error> {
        Expr::data_store_create();
        Stmt::data_store_create();
        // TODO(port): Expr.Data.Store.create / reset — map to typed-arena API.
        let _reset = scopeguard::guard((), |_| {
            Expr::data_store_reset();
            Stmt::data_store_reset();
        });

        let mut contents = vec![0u8; _contents.len() + 1];
        contents[.._contents.len()].copy_from_slice(_contents);
        *contents.last_mut().unwrap() = b';';
        let mut log = logger::Log::init();

        let source = logger::Source::init_path_string("source.json", &contents);
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
            js_printer::PrintJsonOptions { mangled_props: None },
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/interchange/json.zig (1044 lines)
//   confidence: medium
//   todos:      35
//   notes:      8-bool const-generic stands in for comptime JSONOptions; toAST -> ToAst trait (struct/enum/union arms need derive macro); verify JSONOptions defaults for type aliases; Zig fast-path slices [0..1] against 2-byte literals (preserved verbatim — likely upstream bug).
// ──────────────────────────────────────────────────────────────────────────
