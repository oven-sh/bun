//! Port of `src/js_parser/ast/Expr.zig`.
//!
//! AST crate: arena-allocated nodes (`*mut E::*`) live in `Data::Store`
//! (a typed slab) and are bulk-freed by `Store::reset()`. `Expr` and
//! `Data` carry the arena lifetime.

use core::fmt;

use crate::Loc;
use bun_alloc::{AllocError, Arena as Bump};
use bun_collections::{ArrayHashMap, VecExt};
use bun_core::{self};
use bun_core::{ZStr, strings};

use crate::{DebugOnlyDisabler, E, G, Op, Ref, S, Stmt};
use bun_alloc::ArenaVecExt as _;
// Re-export so downstream crates can name `ast::expr::StoreRef` (the Zig path
// was `Expr.Data.Store` / `*E.Foo`; some callers route through `expr::`).
pub use crate::StoreRef;

use crate::StoreStr as Str;

// ───────────────────────────────────────────────────────────────────────────
// Expr
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct Expr {
    pub loc: Loc,
    pub data: Data,
}

impl Default for Expr {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl Expr {
    pub const EMPTY: Expr = Expr {
        data: Data::EMissing(E::Missing {}),
        loc: Loc::EMPTY,
    };
}

impl Expr {
    pub fn is_anonymous_named(&self) -> bool {
        match self.data {
            Data::EArrow(_) => true,
            Data::EFunction(func) => func.func.name.is_none(),
            Data::EClass(class) => class.class_name.is_none(),
            _ => false,
        }
    }

    pub fn can_be_inlined_from_property_access(&self) -> bool {
        match self.data {
            // if the array has a spread we must keep it
            // https://github.com/oven-sh/bun/issues/2594
            Data::ESpread(_) => false,
            Data::EMissing(_) => false,
            _ => true,
        }
    }

    pub fn can_be_const_value(&self) -> bool {
        self.data.can_be_const_value()
    }

    pub fn can_be_moved(&self) -> bool {
        self.data.can_be_moved()
    }

    pub fn unwrap_inlined(self) -> Expr {
        if let Data::EInlinedEnum(inlined) = self.data {
            return inlined.value;
        }
        self
    }

    #[inline]
    pub fn init_identifier(ref_: Ref, loc: Loc) -> Expr {
        Expr {
            loc,
            data: Data::EIdentifier(E::Identifier::init(ref_)),
        }
    }

    pub fn to_empty(self) -> Expr {
        Expr {
            data: Data::EMissing(E::Missing {}),
            loc: self.loc,
        }
    }

    /// Zig: `Expr.Data.Store.reset()`. Associated wrapper so downstream crates
    /// can call `crate::Expr::data_store_reset()` without naming the
    /// thread-local Store module path.
    #[inline]
    pub fn data_store_reset() {
        data::Store::reset();
    }

    /// Zig: `Expr.Data.Store.create()`.
    #[inline]
    pub fn data_store_create() {
        data::Store::create();
    }

    /// Zig: `Expr.Data.Store.assert()` — debug-only re-entrancy guard.
    #[inline]
    pub fn data_store_assert() {
        crate::DebugOnlyDisabler::<Expr>::assert();
    }
}

impl Expr {
    pub fn clone_in(&self, bump: &Bump) -> Result<Expr, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Expr {
            loc: self.loc,
            data: Data::clone_in(self.data, bump)?,
        })
    }

    pub fn deep_clone(&self, bump: &Bump) -> Result<Expr, AllocError> {
        let _g = bun_alloc::ast_alloc::DetachAstHeap::new();
        self.deep_clone_no_detach(bump)
    }
    #[inline]
    fn deep_clone_no_detach(&self, bump: &Bump) -> Result<Expr, AllocError> {
        Ok(Expr {
            loc: self.loc,
            data: self.data.deep_clone_no_detach(bump)?,
        })
    }

    pub fn wrap_in_arrow(this: Expr, bump: &Bump) -> Result<Expr, bun_core::Error> {
        // TODO(port): narrow error set
        let stmts: &mut [Stmt] = bump.alloc_slice_fill_with(1, |_| {
            Stmt::alloc(S::Return { value: Some(this) }, this.loc)
        });

        Ok(Expr::init(
            E::Arrow {
                body: G::FnBody {
                    loc: this.loc,
                    stmts: crate::StoreSlice::new_mut(stmts),
                },
                ..Default::default()
            },
            this.loc,
        ))
    }

    // `Expr::fromBlob` (Zig) is JSC-tier — it parses JSON via `bun_parsers` and
    // reads `jsc::webcore::Blob`. Lives at its sole call site:
    // `bun_js_parser_jsc::macro_::expr_from_blob`.
}

#[derive(Clone, Copy)]
pub struct Query {
    pub expr: Expr,
    pub loc: Loc,
    pub i: u32,
}

impl Default for Query {
    fn default() -> Self {
        Self {
            expr: Expr::EMPTY,
            loc: Loc::EMPTY,
            i: 0,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ── live Expr accessor surface (round-E unblock) ───────────────────────────
// Subset of the gated impl below; bodies adapted to the live `E::Object` /
// `E::EString` surface added this round. The full set/get_path/rope helpers
// stay gated.
impl Expr {
    #[inline]
    pub fn is_array(&self) -> bool {
        matches!(self.data, Data::EArray(_))
    }
    #[inline]
    pub fn is_object(&self) -> bool {
        matches!(self.data, Data::EObject(_))
    }
    #[inline]
    pub fn is_string(&self) -> bool {
        matches!(self.data, Data::EString(_))
    }

    /// Making this comptime bloats the binary and doesn't seem to impact
    /// runtime performance.
    pub fn as_property(&self, name: &[u8]) -> Option<Query> {
        let Data::EObject(obj) = &self.data else {
            return None;
        };
        if obj.properties.len_u32() == 0 {
            return None;
        }
        obj.as_property(name)
    }

    pub fn get(&self, name: &[u8]) -> Option<Expr> {
        self.as_property(name).map(|q| q.expr)
    }

    pub fn get_object(&self, name: &[u8]) -> Option<Expr> {
        self.as_property(name)
            .and_then(|q| q.expr.is_object().then_some(q.expr))
    }

    pub fn as_array(&self) -> Option<ArrayIterator> {
        match &self.data {
            Data::EArray(array) => {
                if array.items.len_u32() == 0 {
                    return None;
                }
                Some(ArrayIterator {
                    array: *array,
                    index: 0,
                })
            }
            _ => None,
        }
    }

    #[inline]
    pub fn as_utf8_string_literal(&self) -> Option<&[u8]> {
        if let Data::EString(s) = &self.data {
            debug_assert!(s.next.is_none());
            return Some(&s.data);
        }
        None
    }

    #[inline]
    pub fn as_string<'b>(&self, bump: &'b Bump) -> Option<&'b [u8]> {
        match &self.data {
            Data::EString(str) => Some(str.string(bump).expect("OOM")),
            _ => None,
        }
    }

    #[inline]
    pub fn as_string_cloned<'b>(&self, bump: &'b Bump) -> Result<Option<&'b [u8]>, AllocError> {
        match &self.data {
            Data::EString(str) => Ok(Some(str.string_cloned(bump)?)),
            _ => Ok(None),
        }
    }

    // TODO(b2-ast-round-C): gated on `EString::string_z` (E.rs:1666 block) which
    // needs `bun_core::ZStr` bump-arena constructors. Only caller
    // (`get_string_cloned_z`) is likewise gated.

    #[inline]
    pub fn as_string_z<'b>(&self, bump: &'b Bump) -> Result<Option<&'b ZStr>, AllocError> {
        match &self.data {
            Data::EString(str) => Ok(Some(str.string_z(bump)?)),
            _ => Ok(None),
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self.data {
            Data::EBoolean(b) | Data::EBranchBoolean(b) => Some(b.value),
            _ => None,
        }
    }

    pub fn as_number(&self) -> Option<f64> {
        match self.data {
            Data::ENumber(n) => Some(n.value),
            _ => None,
        }
    }
}

// Expr — property/object/string accessor methods.
// TODO(b2-ast-round-C): these call into `E::Object::as_property` / `EString`
// methods that need `bun_core::utf16_eql_string`/`to_utf8_alloc` (track-A
// blocked_on) and `Vec::deep_clone`. Types are real; bodies un-gate with
// the parser round once those land.

impl Expr {
    pub fn has_any_property_named(&self, names: &'static [&'static [u8]]) -> bool {
        let Data::EObject(obj) = &self.data else {
            return false;
        };
        if obj.properties.len_u32() == 0 {
            return false;
        }

        for prop in obj.properties.slice() {
            if prop.value.is_none() {
                continue;
            }
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else {
                continue;
            };
            if bun_core::eql_any_comptime(&key_str.data, names) {
                return true;
            }
        }

        false
    }

    // toJS alias deleted — `to_js` lives in `bun_js_parser_jsc::expr_jsc` extension trait.
    // TODO(port): move to *_jsc

    /// Only use this for pretty-printing JSON. Do not use in transpiler.
    ///
    /// This does not handle edgecases like `-1` or stringifying arbitrary property lookups.
    pub fn get_by_index(&self, index: u32, index_str: &[u8], bump: &Bump) -> Option<Expr> {
        match &self.data {
            Data::EArray(array) => {
                if index >= array.items.len_u32() {
                    return None;
                }
                Some(array.items.slice()[index as usize])
            }
            Data::EObject(object) => {
                for prop in object.properties.slice_const() {
                    let Some(key) = &prop.key else { continue };
                    match &key.data {
                        Data::EString(str) => {
                            if str.eql_bytes(index_str) {
                                return prop.value;
                            }
                        }
                        Data::ENumber(num) => {
                            if num.to_u32() == index {
                                return prop.value;
                            }
                        }
                        _ => {}
                    }
                }
                None
            }
            Data::EString(str) => {
                let mut str = *str;
                if str.len() > index as usize {
                    let slice = str.slice(bump);
                    // TODO: this is not correct since .length refers to UTF-16 code units and not UTF-8 bytes
                    // However, since this is only used in the JSON prettifier for `bun pm view`, it's not a blocker for shipping.
                    if slice.len() > index as usize {
                        return Some(Expr::init(
                            E::String {
                                data: Str::new(&slice[index as usize..][..1]),
                                ..Default::default()
                            },
                            self.loc,
                        ));
                    }
                }
                None
            }
            _ => None,
        }
    }

    /// This supports lookups like:
    /// - `foo`
    /// - `foo.bar`
    /// - `foo[123]`
    /// - `foo[123].bar`
    /// - `foo[123].bar[456]`
    /// - `foo[123].bar[456].baz`
    /// - `foo[123].bar[456].baz.qux` // etc.
    ///
    /// This is not intended for use by the transpiler, instead by pretty printing JSON.
    // PORT NOTE: Zig passed `bun.default_allocator` to getByIndex; Rust threads the arena
    // explicitly because get_by_index allocates an E.String slice into &Bump.
    pub fn get_path_may_be_index(&self, bump: &Bump, name: &[u8]) -> Option<Expr> {
        if name.is_empty() {
            return None;
        }

        if let Some(idx) = bun_core::index_of_any(name, b"[.") {
            let idx = idx as usize;
            match name[idx] {
                b'[' => {
                    let end_idx = bun_core::index_of_char(name, b']')? as usize;
                    let mut base_expr = *self;
                    if idx > 0 {
                        let key = &name[..idx];
                        base_expr = base_expr.get(key)?;
                    }

                    let index_str: &[u8] = &name[idx + 1..end_idx];
                    // std.fmt.parseInt(u32, index_str, 10) — path segments are bytes, not UTF-8.
                    let index: u32 = bun_core::parse_unsigned(index_str, 10).ok()?;
                    let rest: &[u8] = if name.len() > end_idx {
                        &name[end_idx + 1..]
                    } else {
                        b""
                    };
                    let result = base_expr.get_by_index(index, index_str, bump)?;
                    if !rest.is_empty() {
                        return result.get_path_may_be_index(bump, rest);
                    }
                    return Some(result);
                }
                b'.' => {
                    let key = &name[..idx];
                    let sub_expr = self.get(key)?;
                    let subpath: &[u8] = if name.len() > idx {
                        &name[idx + 1..]
                    } else {
                        b""
                    };
                    if !subpath.is_empty() {
                        return sub_expr.get_path_may_be_index(bump, subpath);
                    }
                    return Some(sub_expr);
                }
                _ => unreachable!(),
            }
        }

        self.get(name)
    }

    /// Don't use this if you care about performance.
    ///
    /// Sets the value of a property, creating it if it doesn't exist.
    /// `self` must be an object.
    pub fn set(&mut self, _bump: &Bump, name: &[u8], value: Expr) -> Result<(), AllocError> {
        debug_assert!(self.is_object());
        let Data::EObject(obj) = &mut self.data else {
            unreachable!()
        };
        for i in 0..obj.properties.len_u32() as usize {
            let prop = &mut obj.properties.slice_mut()[i];
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else {
                continue;
            };
            if key_str.eql_bytes(name) {
                prop.value = Some(value);
                return Ok(());
            }
        }

        VecExt::append(
            &mut obj.properties,
            G::Property {
                key: Some(Expr::init(
                    E::String {
                        data: Str::new(name),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                )),
                value: Some(value),
                ..Default::default()
            },
        );
        Ok(())
    }

    /// Don't use this if you care about performance.
    ///
    /// Sets the value of a property to a string, creating it if it doesn't exist.
    /// `expr` must be an object.
    pub fn set_string(
        expr: &mut Expr,
        _bump: &Bump,
        name: &[u8],
        value: &[u8],
    ) -> Result<(), AllocError> {
        debug_assert!(expr.is_object());
        let Data::EObject(obj) = &mut expr.data else {
            unreachable!()
        };
        for i in 0..obj.properties.len_u32() as usize {
            let prop = &mut obj.properties.slice_mut()[i];
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else {
                continue;
            };
            if key_str.eql_bytes(name) {
                prop.value = Some(Expr::init(
                    E::String {
                        data: Str::new(value),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ));
                return Ok(());
            }
        }

        VecExt::append(
            &mut obj.properties,
            G::Property {
                key: Some(Expr::init(
                    E::String {
                        data: Str::new(name),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                )),
                value: Some(Expr::init(
                    E::String {
                        data: Str::new(value),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                )),
                ..Default::default()
            },
        );
        Ok(())
    }

    pub fn get_boolean(expr: &Expr, name: &[u8]) -> Option<bool> {
        if let Some(query) = expr.as_property(name) {
            match query.expr.data {
                Data::EBoolean(b) | Data::EBranchBoolean(b) => return Some(b.value),
                _ => {}
            }
        }
        None
    }

    pub fn get_string<'b>(
        &self,
        bump: &'b Bump,
        name: &[u8],
    ) -> Result<Option<(&'b [u8], Loc)>, AllocError> {
        let expr = self;
        if let Some(q) = expr.as_property(name) {
            if let Some(str) = q.expr.as_string(bump) {
                return Ok(Some((str, q.expr.loc)));
            }
        }
        Ok(None)
    }

    pub fn get_number(&self, name: &[u8]) -> Option<(f64, Loc)> {
        if let Some(q) = self.as_property(name) {
            if let Some(num) = q.expr.as_number() {
                return Some((num, q.expr.loc));
            }
        }
        None
    }

    pub fn get_string_cloned<'b>(
        &self,
        bump: &'b Bump,
        name: &[u8],
    ) -> Result<Option<&'b [u8]>, AllocError> {
        match self.as_property(name) {
            Some(q) => q.expr.as_string_cloned(bump),
            None => Ok(None),
        }
    }

    pub fn get_string_cloned_z<'b>(
        expr: &Expr,
        bump: &'b Bump,
        name: &[u8],
    ) -> Result<Option<&'b ZStr>, AllocError> {
        match expr.as_property(name) {
            Some(q) => q.expr.as_string_z(bump),
            None => Ok(None),
        }
    }

    // PORT NOTE: `Query` holds `expr` by value (Copy). The iterator stores the
    // `StoreRef<E::Array>` directly (Copy, arena-backed) so no lifetime is tied
    // to a local temporary — `StoreRef::Deref` re-borrows the arena slot on use.
    pub fn get_array(&self, name: &[u8]) -> Option<ArrayIterator> {
        let q = self.as_property(name)?;
        match q.expr.data {
            Data::EArray(array) => {
                if array.items.len_u32() == 0 {
                    return None;
                }
                Some(ArrayIterator { array, index: 0 })
            }
            _ => None,
        }
    }

    pub fn get_rope<'a>(&self, rope: &'a E::Rope) -> Option<E::RopeQuery<'a>> {
        if let Some(existing) = self.get(&rope.head.data.as_e_string().unwrap().data) {
            match &existing.data {
                Data::EArray(array) => {
                    if let Some(next) = rope.next_ref() {
                        let array = *array;
                        if let Some(end) = array.items.last() {
                            return end.get_rope(next);
                        }
                    }
                    return Some(E::RopeQuery {
                        expr: existing,
                        rope,
                    });
                }
                Data::EObject(_) => {
                    if let Some(next) = rope.next_ref() {
                        if let Some(end) = existing.get_rope(next) {
                            return Some(end);
                        }
                    }
                    return Some(E::RopeQuery {
                        expr: existing,
                        rope,
                    });
                }
                _ => {
                    return Some(E::RopeQuery {
                        expr: existing,
                        rope,
                    });
                }
            }
        }
        None
    }

    pub fn as_property_string_map<'b>(
        expr: &Expr,
        name: &[u8],
        bump: &'b Bump,
    ) -> Option<Box<ArrayHashMap<&'b [u8], &'b [u8]>>> {
        let Data::EObject(obj_) = &expr.data else {
            return None;
        };
        if obj_.properties.len_u32() == 0 {
            return None;
        }
        let query = obj_.as_property(name)?;
        let Data::EObject(obj) = &query.expr.data else {
            return None;
        };

        let mut count: usize = 0;
        for prop in obj.properties.slice() {
            let Some(key) = prop.key.as_ref().and_then(|k| k.as_string(bump)) else {
                continue;
            };
            let Some(value) = prop.value.as_ref().and_then(|v| v.as_string(bump)) else {
                continue;
            };
            count += (key.len() > 0 && value.len() > 0) as usize;
        }

        if count == 0 {
            return None;
        }
        let mut map = ArrayHashMap::<&'b [u8], &'b [u8]>::default();
        if map.ensure_total_capacity(count).is_err() {
            return None;
        }

        for prop in obj.properties.slice() {
            let Some(key) = prop.key.as_ref().and_then(|k| k.as_string(bump)) else {
                continue;
            };
            let Some(value) = prop.value.as_ref().and_then(|v| v.as_string(bump)) else {
                continue;
            };

            if !(key.len() > 0 && value.len() > 0) {
                continue;
            }

            // PERF(port): was assume_capacity
            map.insert(key, value);
        }

        Some(Box::new(map))
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ArrayIterator
// ───────────────────────────────────────────────────────────────────────────

pub struct ArrayIterator {
    /// Arena-backed handle (`StoreRef` invariant: pointee lives until arena
    /// reset). Stored by value so the iterator carries no borrowed lifetime.
    pub array: StoreRef<E::Array>,
    pub index: u32,
}

impl ArrayIterator {
    pub fn next(&mut self) -> Option<Expr> {
        if self.index >= self.array.items.len_u32() {
            return None;
        }
        let result = self.array.items.slice()[self.index as usize];
        self.index += 1;
        Some(result)
    }
}

// TODO(b2-ast-round-C): same as above (string/array accessors).
// PORT NOTE: the Phase-A draft of `as_array`/`is_string`/`as_utf8_string_literal`/
// `as_string`/`as_string_cloned`/`as_bool`/`as_number` duplicated the live `&self`
// implementations above (lines ~231-315) with worse signatures (`expr: &Expr`,
// raw-ptr returns). Those drafts were dropped during un-gating; only the methods
// without a live counterpart remain.
impl Expr {
    #[inline]
    pub fn as_string_literal<'b>(&self, bump: &'b Bump) -> Option<&'b [u8]> {
        let Data::EString(s) = &self.data else {
            return None;
        };
        s.string(bump).ok()
    }

    /// `as_string_hash` for JSON-parsed trees (always UTF-8, no rope) where no
    /// `Bump` is in scope. Debug-asserts the UTF-8 invariant; release falls
    /// back to a transient arena for the UTF-16 path.
    #[inline]
    pub fn as_string_hash_utf8(
        &self,
        hash_fn: fn(&[u8]) -> u64,
    ) -> Result<Option<u64>, AllocError> {
        match &self.data {
            Data::EString(str) if str.is_utf8() => Ok(Some(hash_fn(&str.data))),
            Data::EString(_) => {
                debug_assert!(
                    false,
                    "as_string_hash_utf8: UTF-16 EString from JSON parser"
                );
                let bump = Bump::new();
                self.as_string_hash(&bump, hash_fn)
            }
            _ => Ok(None),
        }
    }

    #[inline]
    pub fn as_string_hash(
        &self,
        bump: &Bump,
        hash_fn: fn(&[u8]) -> u64,
    ) -> Result<Option<u64>, AllocError> {
        match &self.data {
            Data::EString(str) => {
                if str.is_utf8() {
                    return Ok(Some(hash_fn(&str.data)));
                }
                let utf8_str = str.string(bump)?;
                // PERF(port): was arena alloc + free; bump-allocated, freed on reset
                Ok(Some(hash_fn(utf8_str)))
            }
            _ => Ok(None),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EFlags {
    None,
    TsDecorator,
}

#[allow(dead_code)] // see gated `json_stringify` below
struct Serializable {
    type_: Tag,
    object: &'static [u8],
    value: Data,
    loc: Loc,
}

// `is_missing` lives in the `init`/`allocate` impl block below (round-A hoist).
impl Expr {
    /// The goal of this function is to "rotate" the AST if it's possible to use the
    /// left-associative property of the operator to avoid unnecessary parentheses.
    ///
    /// When using this, make absolutely sure that the operator is actually
    /// associative. For example, the "-" operator is not associative for
    /// floating-point numbers.
    //
    // PERF(port): Zig took `comptime op: Op.Code`. `Op::Code` does not derive
    // `ConstParamTy` (Op.rs owns the enum); pass at runtime here. Revisit once
    // `Code` gains `ConstParamTy` — call sites are a handful of literal ops.
    pub fn join_with_left_associative_op(op: Op::Code, a: Expr, b: Expr) -> Expr {
        // "(a, b) op c" => "a, b op c"
        if let Data::EBinary(mut comma) = a.data {
            if comma.op == crate::OpCode::BinComma {
                comma.right = Self::join_with_left_associative_op(op, comma.right, b);
            }
        }

        // "a op (b op c)" => "(a op b) op c"
        // "a op (b op (c op d))" => "((a op b) op c) op d"
        if let Data::EBinary(binary) = b.data {
            if binary.op == op {
                return Self::join_with_left_associative_op(
                    op,
                    Self::join_with_left_associative_op(op, a, binary.left),
                    binary.right,
                );
            }
        }

        // "a op b" => "a op b"
        // "(a op b) op c" => "(a op b) op c"
        Expr::init(
            E::Binary {
                op,
                left: a,
                right: b,
            },
            a.loc,
        )
    }

    // PORT NOTE: Zig threaded `_: std.mem.Allocator` (unused) so the caller's
    // arena reached `Expr.init`. The Rust port uses the thread-local
    // `data::Store` and drops the parameter.
    pub fn join_with_comma(self, b: Expr) -> Expr {
        if self.is_missing() {
            return b;
        }
        if b.is_missing() {
            return self;
        }
        Expr::init(
            E::Binary {
                op: crate::OpCode::BinComma,
                left: self,
                right: b,
            },
            self.loc,
        )
    }

    pub fn join_all_with_comma(all: &[Expr]) -> Expr {
        debug_assert!(!all.is_empty());
        match all.len() {
            1 => all[0],
            2 => Expr::join_with_comma(all[0], all[1]),
            _ => {
                let mut expr = all[0];
                for it in &all[1..] {
                    expr = Expr::join_with_comma(expr, *it);
                }
                expr
            }
        }
    }

    // PORT NOTE: Zig threaded `ctx: anytype` and called `callback(ctx, ...)` on
    // each element. Rust passes `ctx` by `&mut` so a single `&mut P` (the parser
    // state) can be reborrowed for each callback invocation without `Copy`.
    pub fn join_all_with_comma_callback<C: ?Sized>(
        all: &[Expr],
        ctx: &mut C,
        callback: fn(ctx: &mut C, expr: Expr) -> Option<Expr>,
    ) -> Option<Expr> {
        match all.len() {
            0 => None,
            1 => callback(ctx, all[0]),
            2 => {
                let result = Expr::join_with_comma(
                    callback(ctx, all[0]).unwrap_or(Expr {
                        data: Data::EMissing(E::Missing {}),
                        loc: all[0].loc,
                    }),
                    callback(ctx, all[1]).unwrap_or(Expr {
                        data: Data::EMissing(E::Missing {}),
                        loc: all[1].loc,
                    }),
                );
                if result.is_missing() {
                    return None;
                }
                Some(result)
            }
            _ => {
                let mut i: usize = 1;
                let mut expr = callback(ctx, all[0]).unwrap_or(Expr {
                    data: Data::EMissing(E::Missing {}),
                    loc: all[0].loc,
                });

                while i < all.len() {
                    expr = Expr::join_with_comma(
                        expr,
                        callback(ctx, all[i]).unwrap_or(Expr {
                            data: Data::EMissing(E::Missing {}),
                            loc: all[i].loc,
                        }),
                    );
                    i += 1;
                }

                if expr.is_missing() {
                    return None;
                }
                Some(expr)
            }
        }
    }

    pub fn extract_numeric_values_in_safe_range(left: &Data, right: &Data) -> Option<[f64; 2]> {
        let l_value = left.extract_numeric_value()?;
        let r_value = right.extract_numeric_value()?;

        // Check for NaN and return null if either value is NaN
        if l_value.is_nan() || r_value.is_nan() {
            return None;
        }

        if l_value.is_infinite() || r_value.is_infinite() {
            return Some([l_value, r_value]);
        }

        if l_value > crate::math::MAX_SAFE_INTEGER || r_value > crate::math::MAX_SAFE_INTEGER {
            return None;
        }
        if l_value < crate::math::MIN_SAFE_INTEGER || r_value < crate::math::MIN_SAFE_INTEGER {
            return None;
        }

        Some([l_value, r_value])
    }

    pub fn extract_numeric_values(left: &Data, right: &Data) -> Option<[f64; 2]> {
        Some([
            left.extract_numeric_value()?,
            right.extract_numeric_value()?,
        ])
    }

    pub fn extract_string_values(
        left: &Data,
        right: &Data,
        bump: &Bump,
    ) -> Option<[crate::StoreRef<E::String>; 2]> {
        let mut l_string = Data::extract_string_value(*left)?;
        let mut r_string = Data::extract_string_value(*right)?;
        // `extract_string_value` returns the arena `StoreRef`; mutate via DerefMut.
        l_string.resolve_rope_if_needed(bump);
        r_string.resolve_rope_if_needed(bump);

        if l_string.is_utf8() != r_string.is_utf8() {
            return None;
        }

        Some([l_string, r_string])
    }
}

// TODO(port): jsonStringify protocol — replace with serde or custom trait in
// Phase B. Kept gated; `Serializable` is its payload shape.

impl Expr {
    // PORT NOTE: Zig's `jsonStringify` fed `Serializable` to `std.json.stringify`.
    // The Rust port emits the same shape directly (no serde dependency).
    pub fn json_stringify(self_: &Expr, writer: &mut impl fmt::Write) -> fmt::Result {
        let tag: &'static str = self_.data.tag().into();
        write!(
            writer,
            "{{\"type\":\"{}\",\"object\":\"expr\",\"loc\":{}}}",
            tag, self_.loc.start
        )
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Static state
// ───────────────────────────────────────────────────────────────────────────

// Zig: `pub var icount: usize = 0;` — a plain non-atomic global, never read
// (debug counter). Kept for parity but **debug-only**: in release the
// `lock xadd` per node was a contended cache line bouncing across the bundler
// worker pool on every Expr allocation. Zig's increment is a non-atomic store
// (i.e. racy garbage under threads) so a debug-gated atomic is strictly more
// faithful than the old unconditional one.
#[cfg(debug_assertions)]
pub static ICOUNT: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);

// PORT NOTE: Zig `expr.zig` declares `true_bool`/`false_bool`/`bool_values`
// statics but never references them — `E.Boolean` is stored by value in
// `Data.e_boolean` (both `allocate` and `init` arms), not as a pointer to a
// pooled singleton. Dropped here; the comment "We don't need to dynamically
// allocate booleans" already holds because `E::Boolean` is inline in `Data`.

// ───────────────────────────────────────────────────────────────────────────
// Expr::allocate / Expr::init — comptime-type dispatch → trait
// ───────────────────────────────────────────────────────────────────────────

/// Trait implemented by every `E::*` payload type to construct an `Expr`.
///
/// Replaces Zig's `comptime Type: type` switch in `Expr.init` / `Expr.allocate`.
pub trait IntoExprData: Sized {
    /// Construct `Data` using the thread-local `Data::Store` arena (Zig: `Expr.init`).
    fn into_data_store(self) -> Data;
    /// Construct `Data` using a caller-supplied arena (Zig: `Expr.allocate`).
    /// Be careful to free the memory (or use an arena that does it for you).
    fn into_data_alloc(self, bump: &Bump) -> Data;
}

macro_rules! impl_into_expr_data_boxed {
    ($($ty:ident => $variant:ident),* $(,)?) => {
        $(
            impl IntoExprData for E::$ty {
                #[inline]
                fn into_data_store(self) -> Data {
                    Data::$variant(data::Store::append(self))
                }
                #[inline]
                fn into_data_alloc(self, bump: &Bump) -> Data {
                    Data::$variant(StoreRef::from_bump(bump.alloc(self)))
                }
            }
        )*
    };
}

macro_rules! impl_into_expr_data_inline {
    ($($ty:ident => $variant:ident),* $(,)?) => {
        $(
            impl IntoExprData for E::$ty {
                #[inline]
                fn into_data_store(self) -> Data { Data::$variant(self) }
                #[inline]
                fn into_data_alloc(self, _bump: &Bump) -> Data { Data::$variant(self) }
            }
        )*
    };
}

impl_into_expr_data_boxed! {
    NameOfSymbol => ENameOfSymbol,
    Array => EArray,
    Class => EClass,
    Unary => EUnary,
    Binary => EBinary,
    New => ENew,
    Function => EFunction,
    Call => ECall,
    Dot => EDot,
    Index => EIndex,
    Arrow => EArrow,
    JSXElement => EJsxElement,
    BigInt => EBigInt,
    Object => EObject,
    Spread => ESpread,
    Template => ETemplate,
    RegExp => ERegExp,
    Await => EAwait,
    Yield => EYield,
    If => EIf,
    Import => EImport,
    InlinedEnum => EInlinedEnum,
}

impl_into_expr_data_inline! {
    This => EThis,
    Boolean => EBoolean,
    Super => ESuper,
    Null => ENull,
    Undefined => EUndefined,
    NewTarget => ENewTarget,
    ImportMeta => EImportMeta,
    PrivateIdentifier => EPrivateIdentifier,
    Missing => EMissing,
    Number => ENumber,
    RequireResolveString => ERequireResolveString,
    RequireString => ERequireString,
}

// E::Identifier — Zig copies fields explicitly (normalization). With the
// packed-flag layout the struct is a single `Ref`, so the copy is trivial.
impl IntoExprData for E::Identifier {
    #[inline]
    fn into_data_store(self) -> Data {
        Data::EIdentifier(self)
    }
    #[inline]
    fn into_data_alloc(self, _bump: &Bump) -> Data {
        Data::EIdentifier(self)
    }
}

impl IntoExprData for E::ImportIdentifier {
    #[inline]
    fn into_data_store(self) -> Data {
        Data::EImportIdentifier(self)
    }
    #[inline]
    fn into_data_alloc(self, _bump: &Bump) -> Data {
        Data::EImportIdentifier(self)
    }
}

impl IntoExprData for E::CommonJSExportIdentifier {
    #[inline]
    fn into_data_store(self) -> Data {
        Data::ECommonjsExportIdentifier(self)
    }
    #[inline]
    fn into_data_alloc(self, _bump: &Bump) -> Data {
        // Packed layout collapses Zig's init()/allocate() distinction — `base`
        // rides inside `ref_`, so a single-word copy carries both regardless.
        Data::ECommonjsExportIdentifier(self)
    }
}

// E::EString — special debug assert + boxed
impl IntoExprData for E::EString {
    #[inline]
    fn into_data_store(self) -> Data {
        #[cfg(debug_assertions)]
        {
            // Sanity check: assert string is not a null ptr
            if !self.data.is_empty() && self.is_utf8() {
                debug_assert!(self.data.as_ptr() as usize > 0);
            }
        }
        Data::EString(data::Store::append(self))
    }
    fn into_data_alloc(self, bump: &Bump) -> Data {
        #[cfg(debug_assertions)]
        {
            if !self.data.is_empty() && self.is_utf8() {
                debug_assert!(self.data.as_ptr() as usize > 0);
            }
        }
        Data::EString(StoreRef::from_bump(bump.alloc(self)))
    }
}

// *E.String — Zig allows passing a pointer to copy from. `EString` derives no
// `Clone` (rope `next` ptr); Zig copies the struct bytes. Mirror with a
// shallow field-copy.
impl IntoExprData for &E::EString {
    #[inline]
    fn into_data_store(self) -> Data {
        Data::EString(data::Store::append(self.shallow_clone()))
    }
    #[inline]
    fn into_data_alloc(self, bump: &Bump) -> Data {
        Data::EString(StoreRef::from_bump(bump.alloc(self.shallow_clone())))
    }
}

impl Expr {
    /// When the lifetime of an Expr.Data's pointer must exist longer than reset() is called, use this function.
    /// Be careful to free the memory (or use an arena that does it for you)
    /// Also, prefer Expr.init or Expr.alloc when possible. This will be slower.
    #[inline]
    pub fn allocate<T: IntoExprData>(bump: &Bump, st: T, loc: Loc) -> Expr {
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        data::Store::assert();
        Expr {
            loc,
            data: st.into_data_alloc(bump),
        }
    }

    #[inline]
    pub fn init<T: IntoExprData>(st: T, loc: Loc) -> Expr {
        #[cfg(debug_assertions)]
        ICOUNT.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        data::Store::assert();
        Expr {
            loc,
            data: st.into_data_store(),
        }
    }

    // Trivial predicates kept live (round-A `is_missing` callers in G.rs/B.rs).
    #[inline]
    pub fn is_missing(&self) -> bool {
        matches!(self.data, Data::EMissing(_))
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        matches!(self.data, Data::EMissing(_))
    }
    #[inline]
    pub fn assign(a: Expr, b: Expr) -> Expr {
        Expr::init(
            E::Binary {
                op: crate::OpCode::BinAssign,
                left: a,
                right: b,
            },
            a.loc,
        )
    }
}

pub type Disabler = DebugOnlyDisabler<Expr>;

impl Expr {
    #[inline]
    pub fn is_primitive_literal(&self) -> bool {
        Tag::is_primitive_literal(self.data.tag())
    }

    #[inline]
    pub fn is_ref(this: &Expr, ref_: Ref) -> bool {
        match this.data {
            Data::EImportIdentifier(ii) => ii.ref_.eql(ref_),
            Data::EIdentifier(i) => i.ref_.eql(ref_),
            _ => false,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Tag
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
#[repr(u8)]
pub enum Tag {
    EArray,
    EUnary,
    EBinary,
    EClass,
    ENew,
    EFunction,
    ECall,
    EDot,
    EIndex,
    EArrow,
    EJsxElement,
    EObject,
    ESpread,
    ETemplate,
    ERegExp,
    EAwait,
    EYield,
    EIf,
    EImport,
    EIdentifier,
    EImportIdentifier,
    EPrivateIdentifier,
    ECommonjsExportIdentifier,
    EBoolean,
    /// Like e_boolean, but produced by `feature()` from `bun:bundle`.
    /// This tag ensures feature() can only be used directly in conditional
    /// contexts (if statements, ternaries). Invalid usage is caught during
    /// the visit phase when this expression appears outside a branch condition.
    EBranchBoolean,
    ENumber,
    EBigInt,
    EString,
    ERequireString,
    ERequireResolveString,
    ERequireCallTarget,
    ERequireResolveCallTarget,
    EMissing,
    EThis,
    ESuper,
    ENull,
    EUndefined,
    ENewTarget,
    EImportMeta,
    EImportMetaMain,
    ERequireMain,
    ESpecial,
    EInlinedEnum,
    ENameOfSymbol,
}

impl Tag {
    // object, regex and array may have had side effects
    pub fn is_primitive_literal(self) -> bool {
        matches!(
            self,
            Tag::ENull
                | Tag::EUndefined
                | Tag::EString
                | Tag::EBoolean
                | Tag::EBranchBoolean
                | Tag::ENumber
                | Tag::EBigInt
        )
    }

    pub fn typeof_(tag: Tag) -> Option<&'static [u8]> {
        Some(match tag {
            Tag::EArray | Tag::EObject | Tag::ENull | Tag::ERegExp => b"object",
            Tag::EUndefined => b"undefined",
            Tag::EBoolean | Tag::EBranchBoolean => b"boolean",
            Tag::ENumber => b"number",
            Tag::EBigInt => b"bigint",
            Tag::EString => b"string",
            Tag::EClass | Tag::EFunction | Tag::EArrow => b"function",
            _ => return None,
        })
    }

    // TODO(port): jsonStringify — serde or custom JSON writer
    pub fn json_stringify(self_: Tag, writer: &mut impl fmt::Write) -> fmt::Result {
        writer.write_str(<&'static str>::from(self_))
    }

    pub fn is_array(self) -> bool {
        matches!(self, Tag::EArray)
    }
    pub fn is_unary(self) -> bool {
        matches!(self, Tag::EUnary)
    }
    pub fn is_binary(self) -> bool {
        matches!(self, Tag::EBinary)
    }
    pub fn is_this(self) -> bool {
        matches!(self, Tag::EThis)
    }
    pub fn is_class(self) -> bool {
        matches!(self, Tag::EClass)
    }
    pub fn is_boolean(self) -> bool {
        matches!(self, Tag::EBoolean | Tag::EBranchBoolean)
    }
    pub fn is_super(self) -> bool {
        matches!(self, Tag::ESuper)
    }
    pub fn is_null(self) -> bool {
        matches!(self, Tag::ENull)
    }
    pub fn is_undefined(self) -> bool {
        matches!(self, Tag::EUndefined)
    }
    pub fn is_new(self) -> bool {
        matches!(self, Tag::ENew)
    }
    pub fn is_new_target(self) -> bool {
        matches!(self, Tag::ENewTarget)
    }
    pub fn is_function(self) -> bool {
        matches!(self, Tag::EFunction)
    }
    pub fn is_import_meta(self) -> bool {
        matches!(self, Tag::EImportMeta)
    }
    pub fn is_call(self) -> bool {
        matches!(self, Tag::ECall)
    }
    pub fn is_dot(self) -> bool {
        matches!(self, Tag::EDot)
    }
    pub fn is_index(self) -> bool {
        matches!(self, Tag::EIndex)
    }
    pub fn is_arrow(self) -> bool {
        matches!(self, Tag::EArrow)
    }
    pub fn is_identifier(self) -> bool {
        matches!(self, Tag::EIdentifier)
    }
    pub fn is_import_identifier(self) -> bool {
        matches!(self, Tag::EImportIdentifier)
    }
    pub fn is_private_identifier(self) -> bool {
        matches!(self, Tag::EPrivateIdentifier)
    }
    pub fn is_jsx_element(self) -> bool {
        matches!(self, Tag::EJsxElement)
    }
    pub fn is_missing(self) -> bool {
        matches!(self, Tag::EMissing)
    }
    pub fn is_number(self) -> bool {
        matches!(self, Tag::ENumber)
    }
    pub fn is_big_int(self) -> bool {
        matches!(self, Tag::EBigInt)
    }
    pub fn is_object(self) -> bool {
        matches!(self, Tag::EObject)
    }
    pub fn is_spread(self) -> bool {
        matches!(self, Tag::ESpread)
    }
    pub fn is_string(self) -> bool {
        matches!(self, Tag::EString)
    }
    pub fn is_template(self) -> bool {
        matches!(self, Tag::ETemplate)
    }
    pub fn is_reg_exp(self) -> bool {
        matches!(self, Tag::ERegExp)
    }
    pub fn is_await(self) -> bool {
        matches!(self, Tag::EAwait)
    }
    pub fn is_yield(self) -> bool {
        matches!(self, Tag::EYield)
    }
    pub fn is_if(self) -> bool {
        matches!(self, Tag::EIf)
    }
    pub fn is_require_resolve_string(self) -> bool {
        matches!(self, Tag::ERequireResolveString)
    }
    pub fn is_import(self) -> bool {
        matches!(self, Tag::EImport)
    }
}

impl fmt::Display for Tag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Tag::EString => "string",
            Tag::EArray => "array",
            Tag::EUnary => "unary",
            Tag::EBinary => "binary",
            Tag::EBoolean | Tag::EBranchBoolean => "boolean",
            Tag::ESuper => "super",
            Tag::ENull => "null",
            Tag::EUndefined => "undefined",
            Tag::ENew => "new",
            Tag::EFunction => "function",
            Tag::ENewTarget => "new target",
            Tag::EImportMeta => "import.meta",
            Tag::ECall => "call",
            Tag::EDot => "dot",
            Tag::EIndex => "index",
            Tag::EArrow => "arrow",
            Tag::EIdentifier => "identifier",
            Tag::EImportIdentifier => "import identifier",
            Tag::EPrivateIdentifier => "#privateIdentifier",
            Tag::EJsxElement => "<jsx>",
            Tag::EMissing => "<missing>",
            Tag::ENumber => "number",
            Tag::EBigInt => "BigInt",
            Tag::EObject => "object",
            Tag::ESpread => "...",
            Tag::ETemplate => "template",
            Tag::ERegExp => "regexp",
            Tag::EAwait => "await",
            Tag::EYield => "yield",
            Tag::EIf => "if",
            Tag::ERequireResolveString => "require_or_require_resolve",
            Tag::EImport => "import",
            Tag::EThis => "this",
            Tag::EClass => "class",
            Tag::ERequireString => "require",
            other => <&'static str>::from(*other),
        })
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Expr methods (continued)
// ───────────────────────────────────────────────────────────────────────────

impl Expr {
    pub fn is_boolean(&self) -> bool {
        match self.data {
            Data::EBoolean(_) | Data::EBranchBoolean(_) => true,
            Data::EIf(ex) => ex.yes.is_boolean() && ex.no.is_boolean(),
            Data::EUnary(ex) => ex.op == crate::OpCode::UnNot || ex.op == crate::OpCode::UnDelete,
            Data::EBinary(ex) => match ex.op {
                crate::OpCode::BinStrictEq
                | crate::OpCode::BinStrictNe
                | crate::OpCode::BinLooseEq
                | crate::OpCode::BinLooseNe
                | crate::OpCode::BinLt
                | crate::OpCode::BinGt
                | crate::OpCode::BinLe
                | crate::OpCode::BinGe
                | crate::OpCode::BinInstanceof
                | crate::OpCode::BinIn => true,
                crate::OpCode::BinLogicalOr => ex.left.is_boolean() && ex.right.is_boolean(),
                crate::OpCode::BinLogicalAnd => ex.left.is_boolean() && ex.right.is_boolean(),
                _ => false,
            },
            _ => false,
        }
    }

    // `assign` lives in the `init`/`allocate` impl block above (round-A hoist).

    #[inline]
    pub fn at<T: IntoExprData>(&self, t: T) -> Expr {
        Expr::init(t, self.loc)
    }

    // Wraps the provided expression in the "!" prefix operator. The expression
    // will potentially be simplified to avoid generating unnecessary extra "!"
    // operators. For example, calling this with "!!x" will return "!x" instead
    // of returning "!!!x".
    pub fn not(&self, bump: &Bump) -> Expr {
        self.maybe_simplify_not(bump).unwrap_or_else(|| {
            Expr::init(
                E::Unary {
                    op: crate::OpCode::UnNot,
                    value: *self,
                    flags: E::UnaryFlags::empty(),
                },
                self.loc,
            )
        })
    }

    #[inline]
    pub fn has_value_for_this_in_call(&self) -> bool {
        matches!(self.data, Data::EDot(_) | Data::EIndex(_))
    }

    #[inline]
    pub fn is_property_access(&self) -> bool {
        self.has_value_for_this_in_call()
    }

    /// The given "expr" argument should be the operand of a "!" prefix operator
    /// (i.e. the "x" in "!x"). This returns a simplified expression for the
    /// whole operator (i.e. the "!x") if it can be simplified, or false if not.
    /// It's separate from "Not()" above to avoid allocation on failure in case
    /// that is undesired.
    pub fn maybe_simplify_not(&self, bump: &Bump) -> Option<Expr> {
        let expr = self;
        match expr.data {
            Data::ENull(_) | Data::EUndefined(_) => {
                return Some(expr.at(E::Boolean { value: true }));
            }
            Data::EBoolean(b) | Data::EBranchBoolean(b) => {
                return Some(expr.at(E::Boolean { value: !b.value }));
            }
            Data::ENumber(n) => {
                return Some(expr.at(E::Boolean {
                    value: n.value == 0.0 || n.value.is_nan(),
                }));
            }
            Data::EBigInt(b) => {
                return Some(expr.at(E::Boolean {
                    value: b.value == b"0",
                }));
            }
            Data::EFunction(_) | Data::EArrow(_) | Data::ERegExp(_) => {
                return Some(expr.at(E::Boolean { value: false }));
            }
            // "!!!a" => "!a"
            Data::EUnary(un) => {
                if un.op == crate::OpCode::UnNot
                    && un.value.known_primitive() == PrimitiveType::Boolean
                {
                    return Some(un.value);
                }
            }
            Data::EBinary(mut ex) => {
                // TODO: evaluate whether or not it is safe to do this mutation since it's modifying in-place.
                // Make sure that these transformations are all safe for special values.
                // For example, "!(a < b)" is not the same as "a >= b" if a and/or b are
                // NaN (or undefined, or null, or possibly other problem cases too).
                //
                // PORT: Zig captured `*E.Binary` and wrote through it; `StoreRef` is a
                // `Copy` `NonNull` handle, so copying it out of the (immutable) `Data`
                // and `DerefMut`-ing reaches the same arena slot.
                match ex.op {
                    crate::OpCode::BinLooseEq => {
                        // "!(a == b)" => "a != b"
                        ex.op = crate::OpCode::BinLooseNe;
                        return Some(*expr);
                    }
                    crate::OpCode::BinLooseNe => {
                        // "!(a != b)" => "a == b"
                        ex.op = crate::OpCode::BinLooseEq;
                        return Some(*expr);
                    }
                    crate::OpCode::BinStrictEq => {
                        // "!(a === b)" => "a !== b"
                        ex.op = crate::OpCode::BinStrictNe;
                        return Some(*expr);
                    }
                    crate::OpCode::BinStrictNe => {
                        // "!(a !== b)" => "a === b"
                        ex.op = crate::OpCode::BinStrictEq;
                        return Some(*expr);
                    }
                    crate::OpCode::BinComma => {
                        // "!(a, b)" => "a, !b"
                        ex.right = ex.right.not(bump);
                        return Some(*expr);
                    }
                    _ => {}
                }
            }
            Data::EInlinedEnum(inlined) => {
                return inlined.value.maybe_simplify_not(bump);
            }
            _ => {}
        }

        None
    }

    pub fn to_string_expr_without_side_effects(&self, bump: &Bump) -> Option<Expr> {
        let expr = self;
        let unwrapped = expr.unwrap_inlined();
        let slice: Option<&[u8]> = match unwrapped.data {
            Data::ENull(_) => Some(b"null"),
            Data::EString(_) => return Some(*expr),
            Data::EUndefined(_) => Some(b"undefined"),
            Data::EBoolean(data) | Data::EBranchBoolean(data) => {
                Some(if data.value { b"true" } else { b"false" })
            }
            Data::EBigInt(bigint) => Some(bigint.value.slice()),
            Data::ENumber(num) => num.to_string(bump).map(|s| s.slice()),
            Data::ERegExp(regexp) => Some(regexp.value.slice()),
            Data::EDot(dot) => 'brk: {
                // This is dumb but some JavaScript obfuscators use this to generate string literals
                if dot.name == b"constructor" {
                    break 'brk match dot.target.data {
                        Data::EString(_) => Some(b"function String() { [native code] }".as_slice()),
                        Data::ERegExp(_) => Some(b"function RegExp() { [native code] }".as_slice()),
                        _ => None,
                    };
                }
                None
            }
            _ => None,
        };
        slice.map(|s| {
            Expr::init(
                E::String {
                    data: s.into(),
                    ..Default::default()
                },
                expr.loc,
            )
        })
    }

    pub fn is_optional_chain(&self) -> bool {
        match self.data {
            Data::EDot(d) => d.optional_chain.is_some(),
            Data::EIndex(i) => i.optional_chain.is_some(),
            Data::ECall(c) => c.optional_chain.is_some(),
            _ => false,
        }
    }

    #[inline]
    pub fn known_primitive(&self) -> PrimitiveType {
        self.data.known_primitive()
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PrimitiveType
// ───────────────────────────────────────────────────────────────────────────

// EnumSetType derives Clone/Copy/PartialEq/Eq itself.
#[derive(Debug, enumset::EnumSetType)]
pub enum PrimitiveType {
    Unknown,
    Mixed,
    Null,
    Undefined,
    Boolean,
    Number,
    String,
    Bigint,
}

impl PrimitiveType {
    pub const STATIC: enumset::EnumSet<PrimitiveType> = enumset::enum_set!(
        PrimitiveType::Mixed
            | PrimitiveType::Null
            | PrimitiveType::Undefined
            | PrimitiveType::Boolean
            | PrimitiveType::Number
            | PrimitiveType::String // for our purposes, bigint is dynamic
                                    // it is technically static though
                                    // | PrimitiveType::Bigint
    );

    #[inline]
    pub fn is_static(this: PrimitiveType) -> bool {
        Self::STATIC.contains(this)
    }

    pub fn merge(left_known: PrimitiveType, right_known: PrimitiveType) -> PrimitiveType {
        if right_known == PrimitiveType::Unknown || left_known == PrimitiveType::Unknown {
            return PrimitiveType::Unknown;
        }
        if left_known == right_known {
            left_known
        } else {
            PrimitiveType::Mixed
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Data
// ───────────────────────────────────────────────────────────────────────────

/// Tagged union of expression payloads. Pointer variants are arena-allocated
/// `StoreRef<E::*>` (thin `NonNull` into `expr::data::Store` / a bump arena);
/// inline variants are stored by value. `StoreRef` is `Copy` + `Deref`, so
/// `Data` is `Copy` and `let Data::EBinary(b) = data; b.op` works (matching
/// Zig's `data.e_binary.op`).
#[derive(Clone, Copy, bun_core::EnumTag)]
#[enum_tag(existing = Tag)]
pub enum Data {
    EArray(StoreRef<E::Array>),
    EUnary(StoreRef<E::Unary>),
    EBinary(StoreRef<E::Binary>),
    EClass(StoreRef<E::Class>),

    ENew(StoreRef<E::New>),
    EFunction(StoreRef<E::Function>),
    ECall(StoreRef<E::Call>),
    EDot(StoreRef<E::Dot>),
    EIndex(StoreRef<E::Index>),
    EArrow(StoreRef<E::Arrow>),

    EJsxElement(StoreRef<E::JSXElement>),
    EObject(StoreRef<E::Object>),
    ESpread(StoreRef<E::Spread>),
    ETemplate(StoreRef<E::Template>),
    ERegExp(StoreRef<E::RegExp>),
    EAwait(StoreRef<E::Await>),
    EYield(StoreRef<E::Yield>),
    EIf(StoreRef<E::If>),
    EImport(StoreRef<E::Import>),

    EIdentifier(E::Identifier),
    EImportIdentifier(E::ImportIdentifier),
    EPrivateIdentifier(E::PrivateIdentifier),
    ECommonjsExportIdentifier(E::CommonJSExportIdentifier),

    EBoolean(E::Boolean),
    EBranchBoolean(E::Boolean),
    ENumber(E::Number),
    EBigInt(StoreRef<E::BigInt>),
    EString(StoreRef<E::EString>),

    ERequireString(E::RequireString),
    ERequireResolveString(E::RequireResolveString),
    ERequireCallTarget,
    ERequireResolveCallTarget,

    EMissing(E::Missing),
    EThis(E::This),
    ESuper(E::Super),
    ENull(E::Null),
    EUndefined(E::Undefined),
    ENewTarget(E::NewTarget),
    EImportMeta(E::ImportMeta),

    EImportMetaMain(E::ImportMetaMain),
    ERequireMain,

    /// Covers some exotic AST node types under one namespace, since the
    /// places this is found it all follows similar handling.
    ESpecial(E::Special),

    EInlinedEnum(StoreRef<E::InlinedEnum>),

    ENameOfSymbol(StoreRef<E::NameOfSymbol>),
}

// ── Layout guards ─────────────────────────────────────────────────────────
// Zig: `bun.assert_eql(@sizeOf(Data), 24)` (Expr.zig:2189). Rust packs the
// identifier-family flags into `Ref`'s spare bits (see `E::Identifier` doc),
// so every inline payload is ≤ 8 bytes; with the repr(Rust) discriminant
// that rounds to 16. `Expr` = `Data` (16, align 8) + `Loc` (i32) → 20 → 24
// after tail padding — 25% smaller than the Zig layout, which is the
// structural noalias-shrink win this port targets.
//
// The `Option<Data>` assert proves Rust's niche optimization fires: the enum
// has spare discriminant values (47 variants < 256, and every pointer variant
// contributes a NonNull niche), so `None` packs into an unused bit-pattern
// rather than adding a word. If a future variant adds `#[repr(C)]`/`#[repr(u32)]`
// or a nullable `*mut T` payload, this assert catches the size regression.
const _: () = assert!(core::mem::size_of::<Data>() == 16); // Do not increase the size of Expr
const _: () = assert!(core::mem::size_of::<Expr>() == 24);
const _: () = assert!(
    core::mem::size_of::<Option<Data>>() == core::mem::size_of::<Data>(),
    "expr::Data lost its niche — check for #[repr] or nullable-ptr payload"
);
const _: () = assert!(
    core::mem::size_of::<Option<Expr>>() == core::mem::size_of::<Expr>(),
    "Expr lost its niche — Option<Expr> is used in G::Property/B::Property/etc."
);
// Inline-payload ceilings (regress any of these and `Data` grows past 16):
const _: () = assert!(core::mem::size_of::<E::Identifier>() == 8);
const _: () = assert!(core::mem::size_of::<E::ImportIdentifier>() == 8);
const _: () = assert!(core::mem::size_of::<E::CommonJSExportIdentifier>() == 8);
const _: () = assert!(core::mem::size_of::<E::PrivateIdentifier>() == 8);
const _: () = assert!(core::mem::size_of::<E::Number>() <= 8);
const _: () = assert!(core::mem::size_of::<E::Special>() <= 8);
const _: () = assert!(core::mem::size_of::<E::RequireString>() <= 8);
const _: () = assert!(core::mem::size_of::<E::NewTarget>() <= 8);
const _: () = assert!(core::mem::size_of::<StoreRef<E::Binary>>() == core::mem::size_of::<usize>());

// Zig field-style union accessors (`data.e_string`, `data.e_object`). The
// match arms in this file use these heavily; keeping them as inherent methods
// avoids rewriting ~25 sites. Returns `Option<StoreRef<T>>` (Copy).
impl Data {
    #[inline]
    pub fn e_string(&self) -> Option<StoreRef<E::EString>> {
        if let Data::EString(s) = *self {
            Some(s)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_string_mut(&mut self) -> Option<&mut E::EString> {
        if let Data::EString(s) = self {
            Some(&mut **s)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_object(&self) -> Option<StoreRef<E::Object>> {
        if let Data::EObject(o) = *self {
            Some(o)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_array(&self) -> Option<StoreRef<E::Array>> {
        if let Data::EArray(a) = *self {
            Some(a)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_array_mut(&mut self) -> Option<&mut E::Array> {
        if let Data::EArray(a) = self {
            Some(&mut **a)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_object_mut(&mut self) -> Option<&mut E::Object> {
        if let Data::EObject(o) = self {
            Some(&mut **o)
        } else {
            None
        }
    }
    #[inline]
    pub fn as_e_string(&self) -> Option<StoreRef<E::EString>> {
        self.e_string()
    }
    /// Zig: `data.e_array` field-access. Mirrors `e_array()`; provided under
    /// the `as_*` name for downstream crates ported from `.e_array.*`.
    #[inline]
    pub fn as_e_array(&self) -> Option<StoreRef<E::Array>> {
        self.e_array()
    }
    /// Zig: `data.e_object` field-access. Panics if not an object — callers
    /// gate with `is_object()` / `is_e_object()` first (mirrors Zig union
    /// access).
    #[inline]
    pub fn as_e_object(&self) -> StoreRef<E::Object> {
        self.e_object()
            .expect("ExprData::as_e_object on non-object")
    }
    /// Zig: `data.e_object` field-access (mutable).
    #[inline]
    pub fn as_e_object_mut(&mut self) -> &mut E::Object {
        self.e_object_mut()
            .expect("ExprData::as_e_object_mut on non-object")
    }
    /// Zig: `data == .e_object`.
    #[inline]
    pub fn is_e_object(&self) -> bool {
        matches!(self, Data::EObject(_))
    }
    /// Zig: `data.e_number` field-access. `E::Number` is an inline (non-Store)
    /// payload, so this returns it by value.
    #[inline]
    pub fn as_e_number(&self) -> Option<E::Number> {
        if let Data::ENumber(n) = *self {
            Some(n)
        } else {
            None
        }
    }
    /// Zig: `data == .e_string`.
    #[inline]
    pub fn is_e_string(&self) -> bool {
        matches!(self, Data::EString(_))
    }
    /// Zig: `data == .e_number`.
    #[inline]
    pub fn is_e_number(&self) -> bool {
        matches!(self, Data::ENumber(_))
    }

    // ── Remaining StoreRef<E::*> field-style accessors ──────────────────
    // visitExpr / maybe.rs port from Zig's `data.e_dot.*` etc., which are
    // unchecked union field reads. Rust callers `.unwrap()` (or pattern-match)
    // — the `Option` is the cheapest sound encoding of Zig's UB-on-mismatch.
    #[inline]
    pub fn e_unary(&self) -> Option<StoreRef<E::Unary>> {
        if let Data::EUnary(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_unary_mut(&mut self) -> Option<&mut E::Unary> {
        if let Data::EUnary(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_binary(&self) -> Option<StoreRef<E::Binary>> {
        if let Data::EBinary(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_binary_mut(&mut self) -> Option<&mut E::Binary> {
        if let Data::EBinary(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_class(&self) -> Option<StoreRef<E::Class>> {
        if let Data::EClass(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_class_mut(&mut self) -> Option<&mut E::Class> {
        if let Data::EClass(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_new(&self) -> Option<StoreRef<E::New>> {
        if let Data::ENew(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_new_mut(&mut self) -> Option<&mut E::New> {
        if let Data::ENew(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_function(&self) -> Option<StoreRef<E::Function>> {
        if let Data::EFunction(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_function_mut(&mut self) -> Option<&mut E::Function> {
        if let Data::EFunction(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_call(&self) -> Option<StoreRef<E::Call>> {
        if let Data::ECall(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_call_mut(&mut self) -> Option<&mut E::Call> {
        if let Data::ECall(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_dot(&self) -> Option<StoreRef<E::Dot>> {
        if let Data::EDot(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_dot_mut(&mut self) -> Option<&mut E::Dot> {
        if let Data::EDot(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_index(&self) -> Option<StoreRef<E::Index>> {
        if let Data::EIndex(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_index_mut(&mut self) -> Option<&mut E::Index> {
        if let Data::EIndex(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_arrow(&self) -> Option<StoreRef<E::Arrow>> {
        if let Data::EArrow(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_arrow_mut(&mut self) -> Option<&mut E::Arrow> {
        if let Data::EArrow(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_jsx_element(&self) -> Option<StoreRef<E::JSXElement>> {
        if let Data::EJsxElement(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_jsx_element_mut(&mut self) -> Option<&mut E::JSXElement> {
        if let Data::EJsxElement(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_spread(&self) -> Option<StoreRef<E::Spread>> {
        if let Data::ESpread(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_spread_mut(&mut self) -> Option<&mut E::Spread> {
        if let Data::ESpread(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_template(&self) -> Option<StoreRef<E::Template>> {
        if let Data::ETemplate(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_template_mut(&mut self) -> Option<&mut E::Template> {
        if let Data::ETemplate(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_reg_exp(&self) -> Option<StoreRef<E::RegExp>> {
        if let Data::ERegExp(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_await(&self) -> Option<StoreRef<E::Await>> {
        if let Data::EAwait(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_await_mut(&mut self) -> Option<&mut E::Await> {
        if let Data::EAwait(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_yield(&self) -> Option<StoreRef<E::Yield>> {
        if let Data::EYield(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_yield_mut(&mut self) -> Option<&mut E::Yield> {
        if let Data::EYield(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_if(&self) -> Option<StoreRef<E::If>> {
        if let Data::EIf(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_if_mut(&mut self) -> Option<&mut E::If> {
        if let Data::EIf(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_import(&self) -> Option<StoreRef<E::Import>> {
        if let Data::EImport(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_import_mut(&mut self) -> Option<&mut E::Import> {
        if let Data::EImport(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_big_int(&self) -> Option<StoreRef<E::BigInt>> {
        if let Data::EBigInt(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_inlined_enum(&self) -> Option<StoreRef<E::InlinedEnum>> {
        if let Data::EInlinedEnum(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_name_of_symbol(&self) -> Option<StoreRef<E::NameOfSymbol>> {
        if let Data::ENameOfSymbol(v) = *self {
            Some(v)
        } else {
            None
        }
    }

    // ── Inline (by-value) payload accessors ─────────────────────────────
    // These variants store the payload directly (no `StoreRef`); return
    // `Option<E::X>` by value — all are `Copy`.
    #[inline]
    pub fn e_identifier(&self) -> Option<E::Identifier> {
        if let Data::EIdentifier(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_import_identifier(&self) -> Option<E::ImportIdentifier> {
        if let Data::EImportIdentifier(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_private_identifier(&self) -> Option<E::PrivateIdentifier> {
        if let Data::EPrivateIdentifier(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_commonjs_export_identifier(&self) -> Option<E::CommonJSExportIdentifier> {
        if let Data::ECommonjsExportIdentifier(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_boolean(&self) -> Option<E::Boolean> {
        if let Data::EBoolean(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_number(&self) -> Option<E::Number> {
        if let Data::ENumber(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_require_string(&self) -> Option<E::RequireString> {
        if let Data::ERequireString(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_require_resolve_string(&self) -> Option<E::RequireResolveString> {
        if let Data::ERequireResolveString(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_import_meta_main(&self) -> Option<E::ImportMetaMain> {
        if let Data::EImportMetaMain(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_special(&self) -> Option<E::Special> {
        if let Data::ESpecial(v) = *self {
            Some(v)
        } else {
            None
        }
    }
}

impl Data {
    /// Human-readable variant name for diagnostics (`"string"`, `"object"`, …).
    #[inline]
    pub fn tag_name(&self) -> &'static str {
        self.tag().into()
    }

    // Zig: `pub fn as(data: Data, comptime tag: Tag) ?@FieldType(Data, @tagName(tag))`
    // Rust has no field-by-tag reflection. Per-variant `as_*` accessors live
    // alongside the enum decl above (`e_string`/`e_object`/...).
    pub fn as_e_identifier(&self) -> Option<E::Identifier> {
        if let Data::EIdentifier(i) = self {
            Some(*i)
        } else {
            None
        }
    }
    pub fn as_e_inlined_enum(&self) -> Option<StoreRef<E::InlinedEnum>> {
        if let Data::EInlinedEnum(i) = *self {
            Some(i)
        } else {
            None
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Data — heavy transform/analysis methods (clone/deep_clone/fold/etc).
// TODO(b2-ast-round-C): these reference `Vec::deep_clone`/`E::*::Clone`
// surfaces, `bun_core::write_any_to_hasher`, and parser-state types that land
// with `P.rs`/`Parser.rs`. The *types* (`Data`/`Expr`/`Tag`/`Store`) are real;
// only these method bodies wait. The round-B verify gate covers what's live.

impl Data {
    /// Shallow clone: re-allocate the boxed payload (so the caller owns a fresh
    /// arena slot) but don't recurse into children. Zig: `Data.clone`.
    ///
    /// PORT NOTE: the `E::*` payloads do not derive `Clone` (they hold raw arena
    /// pointers / `Vec`). Zig copied struct bytes (`el.*`); we mirror that
    /// with a `core::ptr::read` of the payload, which is sound because every
    /// payload is `Copy`-shaped (no `Drop`, no owned heap state — `Vec`
    /// stores a raw pointer + len/cap into the arena).
    pub fn clone_in(this: Data, bump: &Bump) -> Result<Data, bun_core::Error> {
        // TODO(port): narrow error set
        macro_rules! shallow {
            ($variant:ident, $el:expr) => {{
                // SAFETY: `$el` is a `StoreRef<T>` deref to a live arena `T`; `T` is
                // POD-shaped (no `Drop`). `ptr::read` performs a bitwise copy ==
                // Zig's `el.*` struct copy.
                let copied = unsafe { core::ptr::read($el.as_ptr()) };
                let item = bump.alloc(copied);
                return Ok(Data::$variant(StoreRef::from_bump(item)));
            }};
        }
        match &this {
            Data::EArray(el) => shallow!(EArray, el),
            Data::EUnary(el) => shallow!(EUnary, el),
            Data::EBinary(el) => shallow!(EBinary, el),
            Data::EClass(el) => shallow!(EClass, el),
            Data::ENew(el) => shallow!(ENew, el),
            Data::EFunction(el) => shallow!(EFunction, el),
            Data::ECall(el) => shallow!(ECall, el),
            Data::EDot(el) => shallow!(EDot, el),
            Data::EIndex(el) => shallow!(EIndex, el),
            Data::EArrow(el) => shallow!(EArrow, el),
            Data::EJsxElement(el) => shallow!(EJsxElement, el),
            Data::EObject(el) => shallow!(EObject, el),
            Data::ESpread(el) => shallow!(ESpread, el),
            Data::ETemplate(el) => shallow!(ETemplate, el),
            Data::ERegExp(el) => shallow!(ERegExp, el),
            Data::EAwait(el) => shallow!(EAwait, el),
            Data::EYield(el) => shallow!(EYield, el),
            Data::EIf(el) => shallow!(EIf, el),
            Data::EImport(el) => shallow!(EImport, el),
            Data::EBigInt(el) => shallow!(EBigInt, el),
            Data::EString(el) => shallow!(EString, el),
            Data::EInlinedEnum(el) => shallow!(EInlinedEnum, el),
            _ => Ok(this),
        }
    }

    /// Deep-clone this subtree into `bump`.
    ///
    /// Nodes go into `bump`; embedded `AstVec`s (`items`/`properties`/…)
    /// allocate via `AstAlloc`, which reads `thread_heap()`. If a per-parse
    /// `ASTMemoryAllocator` scope is active that heap is `reset()` while the
    /// cloned tree (e.g. `WorkspacePackageJSONCache`) still references the
    /// buffers — UAF. This entry point installs a [`DetachAstHeap`] guard so
    /// those vecs land on global mimalloc. The guard is installed once here
    /// and at [`Expr::deep_clone`]; the recursive body goes through
    /// `*_no_detach` so we don't pay 3 TLS ops per node.
    pub fn deep_clone(&self, bump: &Bump) -> Result<Data, AllocError> {
        let _g = bun_alloc::ast_alloc::DetachAstHeap::new();
        self.deep_clone_no_detach(bump)
    }

    fn deep_clone_no_detach(&self, bump: &Bump) -> Result<Data, AllocError> {
        let this = *self;
        match &this {
            Data::EArray(el) => {
                let items = el
                    .items
                    .try_deep_clone_with(|e| e.deep_clone_no_detach(bump))?;
                let item = bump.alloc(E::Array {
                    items,
                    comma_after_spread: el.comma_after_spread,
                    was_originally_macro: el.was_originally_macro,
                    is_single_line: el.is_single_line,
                    is_parenthesized: el.is_parenthesized,
                    close_bracket_loc: el.close_bracket_loc,
                });
                Ok(Data::EArray(StoreRef::from_bump(item)))
            }
            Data::EUnary(el) => {
                let item = bump.alloc(E::Unary {
                    op: el.op,
                    value: el.value.deep_clone_no_detach(bump)?,
                    flags: el.flags,
                });
                Ok(Data::EUnary(StoreRef::from_bump(item)))
            }
            Data::EBinary(el) => {
                let item = bump.alloc(E::Binary {
                    op: el.op,
                    left: el.left.deep_clone_no_detach(bump)?,
                    right: el.right.deep_clone_no_detach(bump)?,
                });
                Ok(Data::EBinary(StoreRef::from_bump(item)))
            }
            Data::EClass(el) => {
                // `properties` is an arena-owned `StoreSlice<Property>` (Zig: `[]Property`).
                let src_props: &[G::Property] = el.properties.slice();
                let mut properties = bun_alloc::ArenaVec::with_capacity_in(src_props.len(), bump);
                for prop in src_props.iter() {
                    properties.push(prop.deep_clone(bump)?);
                }
                let properties = crate::StoreSlice::new_mut(properties.into_bump_slice_mut());

                let item = bump.alloc(E::Class {
                    class_keyword: el.class_keyword,
                    ts_decorators: el
                        .ts_decorators
                        .try_deep_clone_with(|e| e.deep_clone_no_detach(bump))?,
                    class_name: el.class_name,
                    extends: match &el.extends {
                        Some(e) => Some(e.deep_clone_no_detach(bump)?),
                        None => None,
                    },
                    body_loc: el.body_loc,
                    close_brace_loc: el.close_brace_loc,
                    properties,
                    has_decorators: el.has_decorators,
                    should_lower_standard_decorators: el.should_lower_standard_decorators,
                });
                Ok(Data::EClass(StoreRef::from_bump(item)))
            }
            Data::ENew(el) => {
                let item = bump.alloc(E::New {
                    target: el.target.deep_clone_no_detach(bump)?,
                    args: el
                        .args
                        .try_deep_clone_with(|e| e.deep_clone_no_detach(bump))?,
                    can_be_unwrapped_if_unused: el.can_be_unwrapped_if_unused,
                    close_parens_loc: el.close_parens_loc,
                });
                Ok(Data::ENew(StoreRef::from_bump(item)))
            }
            Data::EFunction(el) => {
                let item = bump.alloc(E::Function {
                    func: el.func.deep_clone(bump)?,
                });
                Ok(Data::EFunction(StoreRef::from_bump(item)))
            }
            Data::ECall(el) => {
                let item = bump.alloc(E::Call {
                    target: el.target.deep_clone_no_detach(bump)?,
                    args: el
                        .args
                        .try_deep_clone_with(|e| e.deep_clone_no_detach(bump))?,
                    optional_chain: el.optional_chain,
                    is_direct_eval: el.is_direct_eval,
                    close_paren_loc: el.close_paren_loc,
                    can_be_unwrapped_if_unused: el.can_be_unwrapped_if_unused,
                    was_jsx_element: el.was_jsx_element,
                });
                Ok(Data::ECall(StoreRef::from_bump(item)))
            }
            Data::EDot(el) => {
                let item = bump.alloc(E::Dot {
                    target: el.target.deep_clone_no_detach(bump)?,
                    name: el.name,
                    name_loc: el.name_loc,
                    optional_chain: el.optional_chain,
                    can_be_removed_if_unused: el.can_be_removed_if_unused,
                    call_can_be_unwrapped_if_unused: el.call_can_be_unwrapped_if_unused,
                });
                Ok(Data::EDot(StoreRef::from_bump(item)))
            }
            Data::EIndex(el) => {
                let item = bump.alloc(E::Index {
                    target: el.target.deep_clone_no_detach(bump)?,
                    index: el.index.deep_clone_no_detach(bump)?,
                    optional_chain: el.optional_chain,
                });
                Ok(Data::EIndex(StoreRef::from_bump(item)))
            }
            Data::EArrow(el) => {
                let mut args = bun_alloc::ArenaVec::with_capacity_in(el.args.len(), bump);
                for i in 0..el.args.len() {
                    args.push(el.args[i].deep_clone(bump)?);
                }
                let item = bump.alloc(E::Arrow {
                    args: crate::StoreSlice::new(args.into_bump_slice()),
                    body: G::FnBody {
                        loc: el.body.loc,
                        stmts: el.body.stmts,
                    },
                    is_async: el.is_async,
                    has_rest_arg: el.has_rest_arg,
                    prefer_expr: el.prefer_expr,
                });
                Ok(Data::EArrow(StoreRef::from_bump(item)))
            }
            Data::EJsxElement(el) => {
                let item = bump.alloc(E::JSXElement {
                    tag: match &el.tag {
                        Some(tag) => Some(tag.deep_clone_no_detach(bump)?),
                        None => None,
                    },
                    properties: el.properties.try_deep_clone_with(|p| p.deep_clone(bump))?,
                    children: el
                        .children
                        .try_deep_clone_with(|e| e.deep_clone_no_detach(bump))?,
                    key_prop_index: el.key_prop_index,
                    flags: el.flags,
                    close_tag_loc: el.close_tag_loc,
                });
                Ok(Data::EJsxElement(StoreRef::from_bump(item)))
            }
            Data::EObject(el) => {
                let item = bump.alloc(E::Object {
                    properties: el.properties.try_deep_clone_with(|p| p.deep_clone(bump))?,
                    comma_after_spread: el.comma_after_spread,
                    is_single_line: el.is_single_line,
                    is_parenthesized: el.is_parenthesized,
                    was_originally_macro: el.was_originally_macro,
                    close_brace_loc: el.close_brace_loc,
                });
                Ok(Data::EObject(StoreRef::from_bump(item)))
            }
            Data::ESpread(el) => {
                let item = bump.alloc(E::Spread {
                    value: el.value.deep_clone_no_detach(bump)?,
                });
                Ok(Data::ESpread(StoreRef::from_bump(item)))
            }
            Data::ETemplate(el) => {
                let item = bump.alloc(E::Template {
                    tag: match &el.tag {
                        Some(tag) => Some(tag.deep_clone_no_detach(bump)?),
                        None => None,
                    },
                    parts: el.parts,
                    // `TemplateContents` is POD-shaped; Zig copied `el.head` by
                    // value. `shallow_clone` is the safe field-wise copy.
                    head: el.head.shallow_clone(),
                });
                Ok(Data::ETemplate(StoreRef::from_bump(item)))
            }
            Data::ERegExp(el) => {
                let item = bump.alloc(E::RegExp {
                    value: el.value,
                    flags_offset: el.flags_offset,
                });
                Ok(Data::ERegExp(StoreRef::from_bump(item)))
            }
            Data::EAwait(el) => {
                let item = bump.alloc(E::Await {
                    value: el.value.deep_clone_no_detach(bump)?,
                });
                Ok(Data::EAwait(StoreRef::from_bump(item)))
            }
            Data::EYield(el) => {
                let item = bump.alloc(E::Yield {
                    value: match &el.value {
                        Some(value) => Some(value.deep_clone_no_detach(bump)?),
                        None => None,
                    },
                    is_star: el.is_star,
                });
                Ok(Data::EYield(StoreRef::from_bump(item)))
            }
            Data::EIf(el) => {
                let item = bump.alloc(E::If {
                    test_: el.test_.deep_clone_no_detach(bump)?,
                    yes: el.yes.deep_clone_no_detach(bump)?,
                    no: el.no.deep_clone_no_detach(bump)?,
                });
                Ok(Data::EIf(StoreRef::from_bump(item)))
            }
            Data::EImport(el) => {
                let item = bump.alloc(E::Import {
                    expr: el.expr.deep_clone_no_detach(bump)?,
                    options: el.options.deep_clone_no_detach(bump)?,
                    import_record_index: el.import_record_index,
                });
                Ok(Data::EImport(StoreRef::from_bump(item)))
            }
            Data::EBigInt(el) => {
                let item = bump.alloc(E::BigInt { value: el.value });
                Ok(Data::EBigInt(StoreRef::from_bump(item)))
            }
            Data::EString(el) => {
                let item = bump.alloc(E::String {
                    data: el.data,
                    prefer_template: el.prefer_template,
                    next: el.next,
                    end: el.end,
                    rope_len: el.rope_len,
                    is_utf16: el.is_utf16,
                });
                Ok(Data::EString(StoreRef::from_bump(item)))
            }
            Data::EInlinedEnum(el) => {
                let item = bump.alloc(E::InlinedEnum {
                    value: el.value,
                    comment: el.comment,
                });
                Ok(Data::EInlinedEnum(StoreRef::from_bump(item)))
            }
            _ => Ok(this),
        }
    }
} // end `impl Data` (clone_in/deep_clone)

impl Data {
    /// `hasher` should be something with `fn update(&[u8])`;
    /// symbol table is passed to serialize `Ref` as identifier names instead of nondeterministic numbers.
    ///
    /// Port of `Expr.Data.writeToHasher`. Zig fed raw bytes of anonymous tuples
    /// (`std.mem.asBytes(&.{a, b, c})`) — including padding, which is undefined
    /// in both languages. The Rust port hashes each scalar individually so the
    /// output is deterministic (this is only consumed by React Refresh signature
    /// generation; byte-for-byte parity with Zig is not required, only stability).
    pub fn write_to_hasher<H, S>(&self, hasher: &mut H, symbol_table: &mut S)
    where
        H: bun_core::Hasher + ?Sized,
        S: crate::base::SymbolTable + ?Sized,
    {
        // Local mirror of `bun.writeAnyToHasher` for padding-free POD —
        // `bun_core::write_any_to_hasher` is bound by `AsBytes` (ints only) and
        // we cannot extend that trait from this crate-file scope. `NoUninit`
        // bound lets `bytemuck::bytes_of` view the value's bytes safely
        // (mirrors Zig `hasher.update(std.mem.asBytes(&thing))`).
        #[inline(always)]
        fn raw<H: bun_core::Hasher + ?Sized, T: bytemuck::NoUninit>(h: &mut H, v: T) {
            h.update(bytemuck::bytes_of(&v));
        }
        #[inline(always)]
        fn name_of<H: bun_core::Hasher + ?Sized, S: crate::base::SymbolTable + ?Sized>(
            h: &mut H,
            symbol_table: &mut S,
            r: Ref,
        ) {
            let sym = r.get_symbol(symbol_table);
            // SAFETY: `original_name` is an arena-owned slice valid for the
            // parser/AST arena that `symbol_table` borrows from.
            h.update(sym.original_name.slice());
        }

        raw(hasher, self.tag() as u8);
        match self {
            Data::ENameOfSymbol(e) => name_of(hasher, symbol_table, e.ref_),
            Data::EArray(e) => {
                raw(hasher, e.is_single_line);
                raw(hasher, e.is_parenthesized);
                raw(hasher, e.was_originally_macro);
                raw(hasher, e.items.len_u32());
                for item in e.items.slice() {
                    item.data.write_to_hasher(hasher, symbol_table);
                }
            }
            Data::EUnary(e) => {
                raw(hasher, e.flags.bits());
                raw(hasher, e.op as u8);
                e.value.data.write_to_hasher(hasher, symbol_table);
            }
            Data::EBinary(e) => {
                raw(hasher, e.op as u8);
                e.left.data.write_to_hasher(hasher, symbol_table);
                e.right.data.write_to_hasher(hasher, symbol_table);
            }
            Data::EClass(_) => {}
            Data::ENew(_) | Data::ECall(_) => {}
            Data::EFunction(_) => {}
            Data::EDot(e) => {
                // Encode `Option<#[repr(u8)] OptionalChain>` as its niche byte
                // (Some(Start)=0, Some(Continuation)=1, None=2) — same bytes
                // the prior raw-byte reinterpretation produced.
                raw(hasher, e.optional_chain.map_or(2u8, |c| c as u8));
                raw(hasher, e.name.len());
                e.target.data.write_to_hasher(hasher, symbol_table);
                hasher.update(&e.name);
            }
            Data::EIndex(e) => {
                raw(hasher, e.optional_chain.map_or(2u8, |c| c as u8));
                e.target.data.write_to_hasher(hasher, symbol_table);
                e.index.data.write_to_hasher(hasher, symbol_table);
            }
            Data::EArrow(_) => {}
            Data::EJsxElement(_e) => {
                // autofix
            }
            Data::EObject(_e) => {
                // autofix
            }
            Data::ESpread(e) => {
                e.value.data.write_to_hasher(hasher, symbol_table);
            }
            Data::EAwait(e) => {
                e.value.data.write_to_hasher(hasher, symbol_table);
            }
            Data::EYield(e) => {
                // TODO(port): Zig hashed the raw bytes of `.{ e.is_star, e.value }` (the full
                // `?Expr` optional, including loc/data pointer). Rust `Option<Expr>` layout is
                // not byte-compatible, so we hash the discriminant here and recurse below.
                raw(hasher, e.is_star);
                raw(hasher, e.value.is_some());
                if let Some(value) = &e.value {
                    value.data.write_to_hasher(hasher, symbol_table);
                }
            }
            Data::ETemplate(_e) => {
                // autofix
            }
            Data::EIf(_e) => {
                // autofix
            }
            Data::EImport(_e) => {
                // autofix
            }
            Data::EIdentifier(e) => name_of(hasher, symbol_table, e.ref_),
            Data::EImportIdentifier(e) => name_of(hasher, symbol_table, e.ref_),
            Data::EPrivateIdentifier(e) => name_of(hasher, symbol_table, e.ref_),
            Data::ECommonjsExportIdentifier(e) => name_of(hasher, symbol_table, e.ref_),
            Data::EBoolean(e) | Data::EBranchBoolean(e) => {
                raw(hasher, e.value);
            }
            Data::ENumber(e) => {
                raw(hasher, e.value);
            }
            Data::EBigInt(e) => {
                hasher.update(&e.value);
            }
            Data::ERegExp(e) => {
                hasher.update(&e.value);
            }
            Data::EString(e) => {
                // PORT NOTE: Zig declared `var next: ?*E.String = e;` and tested `if (next)`
                // — i.e. it only ever hashes the *first* rope segment (the `next = current.next`
                // store is dead). Preserved here.
                let current: &E::String = e;
                if current.is_utf8() {
                    hasher.update(&current.data);
                } else {
                    hasher.update(bytemuck::cast_slice::<u16, u8>(current.slice16()));
                }
                hasher.update(b"\x00");
            }
            Data::ERequireString(e) => {
                raw(hasher, e.import_record_index); // preferably, i'd like to write the filepath
            }
            Data::ERequireResolveString(e) => {
                raw(hasher, e.import_record_index);
            }
            Data::EImportMetaMain(e) => {
                raw(hasher, e.inverted);
            }
            Data::EInlinedEnum(e) => {
                // pretend there is no comment
                e.value.data.write_to_hasher(hasher, symbol_table);
            }
            // no data
            Data::ERequireCallTarget
            | Data::ERequireResolveCallTarget
            | Data::EMissing(_)
            | Data::EThis(_)
            | Data::ESuper(_)
            | Data::ENull(_)
            | Data::EUndefined(_)
            | Data::ENewTarget(_)
            | Data::ERequireMain
            | Data::EImportMeta(_)
            | Data::ESpecial(_) => {}
        }
    }
}

impl Data {
    /// "const values" here refers to expressions that can participate in constant
    /// inlining, as they have no side effects on instantiation, and there would be
    /// no observable difference if duplicated. This is a subset of canBeMoved()
    pub fn can_be_const_value(&self) -> bool {
        match self {
            Data::ENumber(_)
            | Data::EBoolean(_)
            | Data::EBranchBoolean(_)
            | Data::ENull(_)
            | Data::EUndefined(_)
            | Data::EInlinedEnum(_) => true,
            Data::EString(str) => str.next.is_none(),
            Data::EArray(array) => array.was_originally_macro,
            Data::EObject(object) => object.was_originally_macro,
            _ => false,
        }
    }

    /// Expressions that can be moved are those that do not have side
    /// effects on their own. This is used to determine what can be moved
    /// outside of a module wrapper (__esm/__commonJS).
    pub fn can_be_moved(&self) -> bool {
        match self {
            // TODO: identifiers can be removed if unused, however code that
            // moves expressions around sometimes does so incorrectly when
            // doing destructures. test case: https://github.com/oven-sh/bun/issues/14027
            // Data::EIdentifier(id) => id.can_be_removed_if_unused,
            Data::EClass(class) => class.can_be_moved(),

            Data::EArrow(_)
            | Data::EFunction(_)
            | Data::ENumber(_)
            | Data::EBoolean(_)
            | Data::EBranchBoolean(_)
            | Data::ENull(_)
            | Data::EUndefined(_)
            // | Data::ERegExp(_)
            | Data::EBigInt(_)
            | Data::EString(_)
            | Data::EInlinedEnum(_)
            | Data::EImportMeta(_) => true,

            Data::ETemplate(template) => template.tag.is_none() && template.parts().len() == 0,

            Data::EArray(array) => array.was_originally_macro,
            Data::EObject(object) => object.was_originally_macro,

            // TODO: experiment with allowing some e_binary, e_unary, e_if as movable
            _ => false,
        }
    }

    pub fn is_safe_to_string(&self) -> bool {
        match self {
            // rope strings can throw when toString is called.
            Data::EString(str) => str.next.is_none(),

            Data::ENumber(_)
            | Data::EBoolean(_)
            | Data::EBranchBoolean(_)
            | Data::EUndefined(_)
            | Data::ENull(_) => true,
            // BigInt is deliberately excluded as a large enough BigInt could throw an out of memory error.
            //
            _ => false,
        }
    }

    pub fn known_primitive(&self) -> PrimitiveType {
        match self {
            Data::EBigInt(_) => PrimitiveType::Bigint,
            Data::EBoolean(_) | Data::EBranchBoolean(_) => PrimitiveType::Boolean,
            Data::ENull(_) => PrimitiveType::Null,
            Data::ENumber(_) => PrimitiveType::Number,
            Data::EString(_) => PrimitiveType::String,
            Data::EUndefined(_) => PrimitiveType::Undefined,
            Data::ETemplate(t) => {
                if t.tag.is_none() {
                    PrimitiveType::String
                } else {
                    PrimitiveType::Unknown
                }
            }
            Data::EIf(e_if) => e_if.yes.data.merge_known_primitive(&e_if.no.data),
            Data::EBinary(binary) => 'brk: {
                match binary.op {
                    crate::OpCode::BinStrictEq
                    | crate::OpCode::BinStrictNe
                    | crate::OpCode::BinLooseEq
                    | crate::OpCode::BinLooseNe
                    | crate::OpCode::BinLt
                    | crate::OpCode::BinGt
                    | crate::OpCode::BinLe
                    | crate::OpCode::BinGe
                    | crate::OpCode::BinInstanceof
                    | crate::OpCode::BinIn => break 'brk PrimitiveType::Boolean,
                    crate::OpCode::BinLogicalOr | crate::OpCode::BinLogicalAnd => {
                        break 'brk binary.left.data.merge_known_primitive(&binary.right.data);
                    }

                    crate::OpCode::BinNullishCoalescing => {
                        let left = binary.left.data.known_primitive();
                        let right = binary.right.data.known_primitive();
                        if left == PrimitiveType::Null || left == PrimitiveType::Undefined {
                            break 'brk right;
                        }

                        if left != PrimitiveType::Unknown {
                            if left != PrimitiveType::Mixed {
                                break 'brk left; // Definitely not null or undefined
                            }

                            if right != PrimitiveType::Unknown {
                                break 'brk PrimitiveType::Mixed; // Definitely some kind of primitive
                            }
                        }
                    }

                    crate::OpCode::BinAdd => {
                        let left = binary.left.data.known_primitive();
                        let right = binary.right.data.known_primitive();

                        if left == PrimitiveType::String || right == PrimitiveType::String {
                            break 'brk PrimitiveType::String;
                        }

                        if left == PrimitiveType::Bigint || right == PrimitiveType::Bigint {
                            break 'brk PrimitiveType::Bigint;
                        }

                        let left_ok = !matches!(
                            left,
                            PrimitiveType::Unknown | PrimitiveType::Mixed | PrimitiveType::Bigint
                        );
                        let right_ok = !matches!(
                            right,
                            PrimitiveType::Unknown | PrimitiveType::Mixed | PrimitiveType::Bigint
                        );
                        if left_ok && right_ok {
                            break 'brk PrimitiveType::Number;
                        }

                        break 'brk PrimitiveType::Mixed; // Can be number or bigint or string (or an exception)
                    }

                    crate::OpCode::BinSub
                    | crate::OpCode::BinSubAssign
                    | crate::OpCode::BinMul
                    | crate::OpCode::BinMulAssign
                    | crate::OpCode::BinDiv
                    | crate::OpCode::BinDivAssign
                    | crate::OpCode::BinRem
                    | crate::OpCode::BinRemAssign
                    | crate::OpCode::BinPow
                    | crate::OpCode::BinPowAssign
                    | crate::OpCode::BinBitwiseAnd
                    | crate::OpCode::BinBitwiseAndAssign
                    | crate::OpCode::BinBitwiseOr
                    | crate::OpCode::BinBitwiseOrAssign
                    | crate::OpCode::BinBitwiseXor
                    | crate::OpCode::BinBitwiseXorAssign
                    | crate::OpCode::BinShl
                    | crate::OpCode::BinShlAssign
                    | crate::OpCode::BinShr
                    | crate::OpCode::BinShrAssign
                    | crate::OpCode::BinUShr
                    | crate::OpCode::BinUShrAssign => break 'brk PrimitiveType::Mixed, // Can be number or bigint (or an exception)

                    crate::OpCode::BinAssign | crate::OpCode::BinComma => {
                        break 'brk binary.right.data.known_primitive();
                    }

                    _ => {}
                }

                PrimitiveType::Unknown
            }

            Data::EUnary(unary) => match unary.op {
                crate::OpCode::UnVoid => PrimitiveType::Undefined,
                crate::OpCode::UnTypeof => PrimitiveType::String,
                crate::OpCode::UnNot | crate::OpCode::UnDelete => PrimitiveType::Boolean,
                crate::OpCode::UnPos => PrimitiveType::Number, // Cannot be bigint because that throws an exception
                crate::OpCode::UnNeg | crate::OpCode::UnCpl => {
                    match unary.value.data.known_primitive() {
                        PrimitiveType::Bigint => PrimitiveType::Bigint,
                        PrimitiveType::Unknown | PrimitiveType::Mixed => PrimitiveType::Mixed,
                        _ => PrimitiveType::Number, // Can be number or bigint
                    }
                }
                crate::OpCode::UnPreDec
                | crate::OpCode::UnPreInc
                | crate::OpCode::UnPostDec
                | crate::OpCode::UnPostInc => PrimitiveType::Mixed, // Can be number or bigint

                _ => PrimitiveType::Unknown,
            },

            Data::EInlinedEnum(inlined) => inlined.value.data.known_primitive(),

            _ => PrimitiveType::Unknown,
        }
    }

    pub fn merge_known_primitive(&self, rhs: &Data) -> PrimitiveType {
        PrimitiveType::merge(self.known_primitive(), rhs.known_primitive())
    }

    /// Returns true if the result of the "typeof" operator on this expression is
    /// statically determined and this expression has no side effects (i.e. can be
    /// removed without consequence).
    #[inline]
    pub fn to_typeof(&self) -> Option<&'static [u8]> {
        Tag::typeof_(self.tag())
    }

    pub fn to_number(&self) -> Option<f64> {
        match self {
            Data::ENull(_) => Some(0.0),
            Data::EUndefined(_) => Some(f64::NAN),
            Data::EString(str) => {
                if str.next.is_some() {
                    return None;
                }
                if !str.is_utf8() {
                    return None;
                }
                // +'1' => 1
                Some(string_to_equivalent_number_value(str.slice8()))
            }
            Data::EBoolean(b) | Data::EBranchBoolean(b) => Some(if b.value { 1.0 } else { 0.0 }),
            Data::ENumber(n) => Some(n.value),
            Data::EInlinedEnum(inlined) => match &inlined.value.data {
                Data::ENumber(num) => Some(num.value),
                Data::EString(str) => {
                    if str.next.is_some() {
                        return None;
                    }
                    if !str.is_utf8() {
                        return None;
                    }
                    // +'1' => 1
                    Some(string_to_equivalent_number_value(str.slice8()))
                }
                _ => None,
            },
            _ => None,
        }
    }

    pub fn to_finite_number(&self) -> Option<f64> {
        match self {
            Data::EBoolean(b) | Data::EBranchBoolean(b) => Some(if b.value { 1.0 } else { 0.0 }),
            Data::ENumber(n) => {
                if n.value.is_finite() {
                    Some(n.value)
                } else {
                    None
                }
            }
            Data::EInlinedEnum(inlined) => match &inlined.value.data {
                Data::ENumber(num) => {
                    if num.value.is_finite() {
                        Some(num.value)
                    } else {
                        None
                    }
                }
                _ => None,
            },
            _ => None,
        }
    }

    pub fn extract_numeric_value(&self) -> Option<f64> {
        match self {
            Data::ENumber(n) => Some(n.value),
            Data::EInlinedEnum(inlined) => match &inlined.value.data {
                Data::ENumber(num) => Some(num.value),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn extract_string_value(data: Data) -> Option<crate::StoreRef<E::String>> {
        match data {
            Data::EString(s) => Some(s),
            Data::EInlinedEnum(inlined) => match inlined.value.data {
                Data::EString(str) => Some(str),
                _ => None,
            },
            _ => None,
        }
    }

    // toJS alias deleted — see `bun_js_parser_jsc::expr_jsc::DataJsc` extension trait.
    // TODO(port): move to *_jsc

    #[inline]
    pub fn is_string_value(&self) -> bool {
        matches!(self, Data::EString(_))
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Equality
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct Equality {
    pub equal: bool,
    pub ok: bool,

    /// This extra flag is unfortunately required for the case of visiting the expression
    /// `require.main === module` (and any combination of !==, ==, !=, either ordering)
    ///
    /// We want to replace this with the dedicated import_meta_main node, which:
    /// - Stops this module from having p.require_ref, allowing conversion to ESM
    /// - Allows us to inline `import.meta.main`'s value, if it is known (bun build --compile)
    pub is_require_main_and_module: bool,
}

impl Equality {
    pub const TRUE: Equality = Equality {
        ok: true,
        equal: true,
        is_require_main_and_module: false,
    };
    pub const FALSE: Equality = Equality {
        ok: true,
        equal: false,
        is_require_main_and_module: false,
    };
    pub const UNKNOWN: Equality = Equality {
        ok: false,
        equal: false,
        is_require_main_and_module: false,
    };
}

// `adt_const_params` (enum const-generic) is nightly-only. Lower to a sealed
// ZST trait per the round-A `PlatformT` pattern; callers use
// `Data::eql::<P, LooseEql>(...)` / `<P, StrictEql>`.
pub trait EqlKindT: Copy {
    const STRICT: bool;
}
#[derive(Clone, Copy)]
pub struct LooseEql;
impl EqlKindT for LooseEql {
    const STRICT: bool = false;
}
#[derive(Clone, Copy)]
pub struct StrictEql;
impl EqlKindT for StrictEql {
    const STRICT: bool = true;
}

/// Minimal parser surface needed by `Data::eql` — Zig wrote `p: anytype` and
/// touched only `p.arena` + `p.module_ref`. Kept separate from
/// `ast::p::ParserLike` so this file does not grow that trait (out of scope);
/// blanket-impl'd for every `P<...>` instantiation below.
pub trait EqlParser {
    fn arena(&self) -> &Bump;
    fn module_ref(&self) -> Ref;
}
// `impl EqlParser for P<...>` lives in `bun_js_parser` (next to `P`).

impl Data {
    // Returns "equal, ok". If "ok" is false, then nothing is known about the two
    // values. If "ok" is true, the equality or inequality of the two values is
    // stored in "equal".
    pub fn eql<P: EqlParser, K: EqlKindT>(left: &Data, right: &Data, p: &mut P) -> Equality {
        // https://dorey.github.io/JavaScript-Equality-Table/
        match left {
            Data::EInlinedEnum(inlined) => {
                return Data::eql::<P, K>(&inlined.value.data, right, p);
            }

            Data::ENull(_) | Data::EUndefined(_) => {
                let right_tag = right.tag();
                let ok = matches!(right_tag, Tag::ENull | Tag::EUndefined)
                    || right_tag.is_primitive_literal();

                if !K::STRICT {
                    return Equality {
                        equal: matches!(right_tag, Tag::ENull | Tag::EUndefined),
                        ok,
                        ..Default::default()
                    };
                }

                return Equality {
                    equal: right_tag == left.tag(),
                    ok,
                    ..Default::default()
                };
            }
            Data::EBoolean(l) | Data::EBranchBoolean(l) => match right {
                Data::EBoolean(r) | Data::EBranchBoolean(r) => {
                    return Equality {
                        ok: true,
                        equal: l.value == r.value,
                        ..Default::default()
                    };
                }
                Data::ENumber(num) => {
                    if K::STRICT {
                        // "true === 1" is false
                        // "false === 0" is false
                        return Equality::FALSE;
                    }
                    return Equality {
                        ok: true,
                        equal: if l.value {
                            num.value == 1.0
                        } else {
                            num.value == 0.0
                        },
                        ..Default::default()
                    };
                }
                Data::ENull(_) | Data::EUndefined(_) => {
                    return Equality::FALSE;
                }
                _ => {}
            },
            Data::ENumber(l) => match right {
                Data::ENumber(r) => {
                    return Equality {
                        ok: true,
                        equal: l.value == r.value,
                        ..Default::default()
                    };
                }
                Data::EInlinedEnum(r) => {
                    if let Data::ENumber(rn) = &r.value.data {
                        return Equality {
                            ok: true,
                            equal: l.value == rn.value,
                            ..Default::default()
                        };
                    }
                }
                Data::EBoolean(r) | Data::EBranchBoolean(r) => {
                    if !K::STRICT {
                        return Equality {
                            ok: true,
                            // "1 == true" is true
                            // "0 == false" is true
                            equal: if r.value {
                                l.value == 1.0
                            } else {
                                l.value == 0.0
                            },
                            ..Default::default()
                        };
                    }
                    // "1 === true" is false
                    // "0 === false" is false
                    return Equality::FALSE;
                }
                Data::ENull(_) | Data::EUndefined(_) => {
                    // "(not null or undefined) == undefined" is false
                    return Equality::FALSE;
                }
                _ => {}
            },
            Data::EBigInt(l) => {
                if let Data::EBigInt(r) = right {
                    if bun_core::immutable::eql_long(&l.value, &r.value, true) {
                        return Equality::TRUE;
                    }
                    // 0x0000n == 0n is true
                    return Equality {
                        ok: false,
                        ..Default::default()
                    };
                } else {
                    return Equality {
                        ok: matches!(right, Data::ENull(_) | Data::EUndefined(_)),
                        equal: false,
                        ..Default::default()
                    };
                }
            }
            Data::EString(l) => {
                // `StoreRef<EString>` is a Copy pointer; rebind mutably so
                // `DerefMut` gives `&mut EString` for in-place rope flattening
                // (Zig wrote through `*E.String` here).
                let mut l = *l;
                match right {
                    Data::EString(r) => {
                        let mut r = *r;
                        r.resolve_rope_if_needed(p.arena());
                        l.resolve_rope_if_needed(p.arena());
                        return Equality {
                            ok: true,
                            equal: r.eql_string(&l),
                            ..Default::default()
                        };
                    }
                    Data::EInlinedEnum(inlined) => {
                        if let Data::EString(r) = inlined.value.data {
                            let mut r = r;
                            r.resolve_rope_if_needed(p.arena());
                            l.resolve_rope_if_needed(p.arena());
                            return Equality {
                                ok: true,
                                equal: r.eql_string(&l),
                                ..Default::default()
                            };
                        }
                    }
                    Data::ENull(_) | Data::EUndefined(_) => {
                        return Equality::FALSE;
                    }
                    Data::ENumber(r) => {
                        if !K::STRICT {
                            l.resolve_rope_if_needed(p.arena());
                            if r.value == 0.0 && (l.is_blank() || l.eql_comptime(b"0")) {
                                return Equality::TRUE;
                            }
                            if r.value == 1.0 && l.eql_comptime(b"1") {
                                return Equality::TRUE;
                            }
                            // the string could still equal 0 or 1 but it could be hex, binary, octal, ...
                            return Equality::UNKNOWN;
                        } else {
                            return Equality::FALSE;
                        }
                    }
                    _ => {}
                }
            }

            _ => {
                // Do not need to check left because e_require_main is
                // always re-ordered to the right side.
                if matches!(right, Data::ERequireMain) {
                    if let Some(id) = left.as_e_identifier() {
                        if id.ref_.eql(p.module_ref()) {
                            return Equality {
                                ok: true,
                                equal: true,
                                is_require_main_and_module: true,
                            };
                        }
                    }
                }
            }
        }

        Equality::UNKNOWN
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Store
// ───────────────────────────────────────────────────────────────────────────

// `new_store!` emits `pub mod expr_store { pub struct Store; ... }`.
// Type list mirrors Zig's `Data.Store = NewStore(&.{ E.Array, ... }, 512)`
// (Expr.zig:2550-2580).
crate::new_store!(
    expr_store,
    [
        E::Array,
        E::Unary,
        E::Binary,
        E::Class,
        E::New,
        E::Function,
        E::Call,
        E::Dot,
        E::Index,
        E::Arrow,
        E::JSXElement,
        E::Number,
        E::Object,
        E::Spread,
        E::TemplatePart,
        E::Template,
        E::RegExp,
        E::Await,
        E::Yield,
        E::If,
        E::Import,
        E::PrivateIdentifier,
        E::BigInt,
        E::EString,
        E::InlinedEnum,
        E::NameOfSymbol,
    ],
    512
);

pub mod data {
    use super::*;
    crate::thread_local_ast_store!(expr_store::Store, "Expr");
}

/// Compatibility shim: Phase-A draft callers in this file used `Store::method()`
/// (impl-on-struct namespace). Forward to the real `data::Store` module.
pub use data::Store;

// ───────────────────────────────────────────────────────────────────────────
// StoredData / helpers
// ───────────────────────────────────────────────────────────────────────────

// Zig: `pub fn StoredData(tag: Tag) type` — comptime type-level function.
// Rust cannot return types from runtime tags. Callers should match on `Data`
// directly.
// TODO(port): if needed, expose as a macro mapping Tag → payload type.

fn string_to_equivalent_number_value(str: &[u8]) -> f64 {
    // +"" -> 0
    if str.is_empty() {
        return 0.0;
    }
    if !bun_core::is_all_ascii(str) {
        return f64::NAN;
    }
    // TODO(port): move to *_sys
    unsafe extern "C" {
        // NOT `safe fn`: callee dereferences `ptr` for `len` bytes — caller must
        // guarantee the (ptr,len) pair is a valid readable range.
        fn JSC__jsToNumber(ptr: *const u8, len: usize) -> f64;
    }
    // SAFETY: `str` is a live `&[u8]`, so `as_ptr()` is non-null and readable for
    // exactly `str.len()` bytes for the duration of this call; the C++ side reads
    // only (no mutation, no retention past return).
    unsafe { JSC__jsToNumber(str.as_ptr(), str.len()) }
}

// ported from: src/js_parser/ast/Expr.zig
