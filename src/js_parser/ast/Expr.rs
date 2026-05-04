//! Port of `src/js_parser/ast/Expr.zig`.
//!
//! AST crate: arena-allocated nodes (`&'ast mut E::*`) live in `Data::Store`
//! (a typed slab) and are bulk-freed by `Store::reset()`. `Expr<'ast>` and
//! `Data<'ast>` carry the arena lifetime.

use core::fmt;
use core::cell::Cell;

use bun_alloc::{Arena as Bump, AllocError};
use bun_collections::{BabyList, ArrayHashMap};
use bun_core::{self, OOM};
use bun_logger as logger;
use bun_logger::Loc;
use bun_str::{self as strings, ZStr};
use bun_http::MimeType;
use bun_jsc::{self as jsc};

use crate::ast::{self as js_ast, E, G, S, Stmt, Op, Ref, ASTMemoryAllocator, NewStore};

// ───────────────────────────────────────────────────────────────────────────
// Expr
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct Expr<'ast> {
    pub loc: Loc,
    pub data: Data<'ast>,
}

impl<'ast> Expr<'ast> {
    pub const EMPTY: Expr<'static> = Expr {
        data: Data::EMissing(E::Missing {}),
        loc: Loc::EMPTY,
    };

    pub fn is_anonymous_named(expr: Expr<'ast>) -> bool {
        match expr.data {
            Data::EArrow(_) => true,
            Data::EFunction(func) => func.func.name.is_none(),
            Data::EClass(class) => class.class_name.is_none(),
            _ => false,
        }
    }

    pub fn clone(this: Expr<'ast>, bump: &'ast Bump) -> Result<Expr<'ast>, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Expr {
            loc: this.loc,
            data: this.data.clone(bump)?,
        })
    }

    pub fn deep_clone(this: Expr<'ast>, bump: &'ast Bump) -> Result<Expr<'ast>, AllocError> {
        Ok(Expr {
            loc: this.loc,
            data: this.data.deep_clone(bump)?,
        })
    }

    pub fn wrap_in_arrow(this: Expr<'ast>, bump: &'ast Bump) -> Result<Expr<'ast>, bun_core::Error> {
        // TODO(port): narrow error set
        let stmts = bump.alloc_slice_fill_with(1, |_| {
            Stmt::alloc(S::Return { value: Some(this) }, this.loc)
        });

        Ok(Expr::init(
            E::Arrow {
                args: &[],
                body: G::FnBody {
                    loc: this.loc,
                    stmts,
                },
                ..Default::default()
            },
            this.loc,
        ))
    }

    pub fn can_be_inlined_from_property_access(this: Expr<'ast>) -> bool {
        match this.data {
            // if the array has a spread we must keep it
            // https://github.com/oven-sh/bun/issues/2594
            Data::ESpread(_) => false,
            Data::EMissing(_) => false,
            _ => true,
        }
    }

    pub fn can_be_const_value(this: Expr<'ast>) -> bool {
        this.data.can_be_const_value()
    }

    pub fn can_be_moved(expr: Expr<'ast>) -> bool {
        expr.data.can_be_moved()
    }

    pub fn unwrap_inlined(expr: Expr<'ast>) -> Expr<'ast> {
        if let Data::EInlinedEnum(inlined) = expr.data {
            return inlined.value;
        }
        expr
    }

    // TODO(port): move to *_jsc — this fn touches jsc::WebCore::Blob and JSON parsing for macros
    pub fn from_blob(
        blob: &jsc::webcore::Blob,
        bump: &'ast Bump,
        mime_type_: Option<MimeType>,
        log: &mut logger::Log,
        loc: Loc,
    ) -> Result<Expr<'ast>, bun_core::Error> {
        let bytes = blob.shared_view();

        let mime_type = mime_type_.unwrap_or_else(|| MimeType::init(blob.content_type(), None, None));

        if mime_type.category == MimeType::Category::Json {
            let source = &logger::Source::init_path_string(b"fetch.json", bytes);
            let mut out_expr = match bun_json::parse_for_macro(source, log, bump) {
                Ok(e) => e,
                Err(_) => return Err(bun_core::err!("MacroFailed")),
            };
            out_expr.loc = loc;

            match &mut out_expr.data {
                Data::EObject(obj) => {
                    obj.was_originally_macro = true;
                }
                Data::EArray(arr) => {
                    arr.was_originally_macro = true;
                }
                _ => {}
            }

            return Ok(out_expr);
        }

        if mime_type.category.is_text_like() {
            let mut output = bun_str::MutableString::init_empty();
            bun_js_printer::quote_for_json(bytes, &mut output, true)?;
            let mut list = output.into_owned_slice();
            // remove the quotes
            if !list.is_empty() {
                list = &list[1..list.len() - 1];
            }
            return Ok(Expr::init(E::String::init(list), loc));
        }

        Ok(Expr::init(
            E::String {
                data: bun_str::ZigString::init(bytes).to_base64_data_url(bump)?,
                ..Default::default()
            },
            loc,
        ))
    }

    #[inline]
    pub fn init_identifier(ref_: Ref, loc: Loc) -> Expr<'ast> {
        Expr {
            loc,
            data: Data::EIdentifier(E::Identifier::init(ref_)),
        }
    }

    pub fn to_empty(expr: Expr<'ast>) -> Expr<'ast> {
        Expr {
            data: Data::EMissing(E::Missing {}),
            loc: expr.loc,
        }
    }

    pub fn is_empty(expr: Expr<'ast>) -> bool {
        matches!(expr.data, Data::EMissing(_))
    }
}

#[derive(Clone, Copy)]
pub struct Query<'ast> {
    pub expr: Expr<'ast>,
    pub loc: Loc,
    pub i: u32,
}

impl<'ast> Default for Query<'ast> {
    fn default() -> Self {
        Self { expr: Expr::EMPTY, loc: Loc::EMPTY, i: 0 }
    }
}

impl<'ast> Expr<'ast> {
    pub fn has_any_property_named(expr: &Expr<'ast>, names: &'static [&'static [u8]]) -> bool {
        let Data::EObject(obj) = &expr.data else { return false };
        if obj.properties.len() == 0 {
            return false;
        }

        for prop in obj.properties.slice() {
            if prop.value.is_none() {
                continue;
            }
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else { continue };
            if strings::strings::eql_any(&key_str.data, names) {
                return true;
            }
        }

        false
    }

    // toJS alias deleted — `to_js` lives in `bun_js_parser_jsc::expr_jsc` extension trait.
    // TODO(port): move to *_jsc

    #[inline]
    pub fn is_array(this: &Expr<'ast>) -> bool {
        matches!(this.data, Data::EArray(_))
    }

    #[inline]
    pub fn is_object(this: &Expr<'ast>) -> bool {
        matches!(this.data, Data::EObject(_))
    }

    pub fn get(expr: &Expr<'ast>, name: &[u8]) -> Option<Expr<'ast>> {
        expr.as_property(name).map(|query| query.expr)
    }

    /// Only use this for pretty-printing JSON. Do not use in transpiler.
    ///
    /// This does not handle edgecases like `-1` or stringifying arbitrary property lookups.
    pub fn get_by_index(
        expr: &Expr<'ast>,
        index: u32,
        index_str: &[u8],
        bump: &'ast Bump,
    ) -> Option<Expr<'ast>> {
        match &expr.data {
            Data::EArray(array) => {
                if index >= array.items.len() {
                    return None;
                }
                Some(array.items.slice()[index as usize])
            }
            Data::EObject(object) => {
                for prop in object.properties.slice_const() {
                    let Some(key) = &prop.key else { continue };
                    match &key.data {
                        Data::EString(str) => {
                            if str.eql_slice(index_str) {
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
                if str.len() > index {
                    let slice = str.slice(bump);
                    // TODO: this is not correct since .length refers to UTF-16 code units and not UTF-8 bytes
                    // However, since this is only used in the JSON prettifier for `bun pm view`, it's not a blocker for shipping.
                    if slice.len() > index as usize {
                        return Some(Expr::init(
                            E::String {
                                data: &slice[index as usize..][..1],
                                ..Default::default()
                            },
                            expr.loc,
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
    // explicitly because get_by_index allocates an E.String slice into &'ast Bump.
    pub fn get_path_may_be_index(expr: &Expr<'ast>, bump: &'ast Bump, name: &[u8]) -> Option<Expr<'ast>> {
        if name.is_empty() {
            return None;
        }

        if let Some(idx) = strings::strings::index_of_any(name, b"[.") {
            match name[idx] {
                b'[' => {
                    let end_idx = strings::strings::index_of_char(name, b']')?;
                    let mut base_expr = *expr;
                    if idx > 0 {
                        let key = &name[..idx];
                        base_expr = base_expr.get(key)?;
                    }

                    let index_str = &name[idx + 1..end_idx];
                    // std.fmt.parseInt(u32, index_str, 10) — parse ASCII digits directly from &[u8];
                    // do NOT route through core::str::from_utf8 (path segments are bytes, not UTF-8).
                    let index: u32 = 'parse: {
                        if index_str.is_empty() {
                            return None;
                        }
                        let mut acc: u32 = 0;
                        for &b in index_str {
                            let d = b.wrapping_sub(b'0');
                            if d > 9 {
                                return None;
                            }
                            acc = match acc.checked_mul(10).and_then(|a| a.checked_add(d as u32)) {
                                Some(v) => v,
                                None => return None,
                            };
                        }
                        break 'parse acc;
                    };
                    let rest: &[u8] = if name.len() > end_idx { &name[end_idx + 1..] } else { b"" };
                    let result = base_expr.get_by_index(index, index_str, bump)?;
                    if !rest.is_empty() {
                        return result.get_path_may_be_index(bump, rest);
                    }
                    return Some(result);
                }
                b'.' => {
                    let key = &name[..idx];
                    let sub_expr = expr.get(key)?;
                    let subpath: &[u8] = if name.len() > idx { &name[idx + 1..] } else { b"" };
                    if !subpath.is_empty() {
                        return sub_expr.get_path_may_be_index(bump, subpath);
                    }
                    return Some(sub_expr);
                }
                _ => unreachable!(),
            }
        }

        expr.get(name)
    }

    /// Don't use this if you care about performance.
    ///
    /// Sets the value of a property, creating it if it doesn't exist.
    /// `expr` must be an object.
    pub fn set(expr: &mut Expr<'ast>, bump: &'ast Bump, name: &[u8], value: Expr<'ast>) -> Result<(), AllocError> {
        debug_assert!(expr.is_object());
        let Data::EObject(obj) = &mut expr.data else { unreachable!() };
        for i in 0..obj.properties.len() as usize {
            let prop = &mut obj.properties.ptr_mut()[i];
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else { continue };
            if key_str.eql_slice(name) {
                prop.value = Some(value);
                return Ok(());
            }
        }

        obj.properties.append(
            bump,
            G::Property {
                key: Some(Expr::init(E::String { data: name, ..Default::default() }, Loc::EMPTY)),
                value: Some(value),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Don't use this if you care about performance.
    ///
    /// Sets the value of a property to a string, creating it if it doesn't exist.
    /// `expr` must be an object.
    pub fn set_string(
        expr: &mut Expr<'ast>,
        bump: &'ast Bump,
        name: &[u8],
        value: &'ast [u8],
    ) -> Result<(), AllocError> {
        debug_assert!(expr.is_object());
        let Data::EObject(obj) = &mut expr.data else { unreachable!() };
        for i in 0..obj.properties.len() as usize {
            let prop = &mut obj.properties.ptr_mut()[i];
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else { continue };
            if key_str.eql_slice(name) {
                prop.value = Some(Expr::init(E::String { data: value, ..Default::default() }, Loc::EMPTY));
                return Ok(());
            }
        }

        obj.properties.append(
            bump,
            G::Property {
                key: Some(Expr::init(E::String { data: name, ..Default::default() }, Loc::EMPTY)),
                value: Some(Expr::init(E::String { data: value, ..Default::default() }, Loc::EMPTY)),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn get_object(expr: &Expr<'ast>, name: &[u8]) -> Option<Expr<'ast>> {
        if let Some(query) = expr.as_property(name) {
            if query.expr.is_object() {
                return Some(query.expr);
            }
        }
        None
    }

    pub fn get_boolean(expr: &Expr<'ast>, name: &[u8]) -> Option<bool> {
        if let Some(query) = expr.as_property(name) {
            match query.expr.data {
                Data::EBoolean(b) | Data::EBranchBoolean(b) => return Some(b.value),
                _ => {}
            }
        }
        None
    }

    pub fn get_string(
        expr: &Expr<'ast>,
        bump: &'ast Bump,
        name: &[u8],
    ) -> Result<Option<(&'ast [u8], Loc)>, AllocError> {
        if let Some(q) = expr.as_property(name) {
            if let Some(str) = q.expr.as_string(bump) {
                return Ok(Some((str, q.expr.loc)));
            }
        }
        Ok(None)
    }

    pub fn get_number(expr: &Expr<'ast>, name: &[u8]) -> Option<(f64, Loc)> {
        if let Some(q) = expr.as_property(name) {
            if let Some(num) = q.expr.as_number() {
                return Some((num, q.expr.loc));
            }
        }
        None
    }

    pub fn get_string_cloned(
        expr: &Expr<'ast>,
        bump: &'ast Bump,
        name: &[u8],
    ) -> Result<Option<&'ast [u8]>, AllocError> {
        match expr.as_property(name) {
            Some(q) => q.expr.as_string_cloned(bump),
            None => Ok(None),
        }
    }

    pub fn get_string_cloned_z(
        expr: &Expr<'ast>,
        bump: &'ast Bump,
        name: &[u8],
    ) -> Result<Option<&'ast ZStr>, AllocError> {
        match expr.as_property(name) {
            Some(q) => q.expr.as_string_z(bump),
            None => Ok(None),
        }
    }

    pub fn get_array(expr: &Expr<'ast>, name: &[u8]) -> Option<ArrayIterator<'ast, '_>> {
        // TODO(port): lifetime of returned iterator borrows `expr`
        expr.as_property(name).and_then(|q| q.expr.as_array_owned())
    }

    pub fn get_rope(self_: &Expr<'ast>, rope: &E::object::Rope<'ast>) -> Option<E::object::RopeQuery<'ast>> {
        if let Some(existing) = self_.get(rope.head.data.as_e_string().unwrap().data) {
            match &existing.data {
                Data::EArray(array) => {
                    if let Some(next) = rope.next {
                        if let Some(end) = array.items.last() {
                            return end.get_rope(next);
                        }
                    }
                    return Some(E::object::RopeQuery { expr: existing, rope });
                }
                Data::EObject(_) => {
                    if let Some(next) = rope.next {
                        if let Some(end) = existing.get_rope(next) {
                            return Some(end);
                        }
                    }
                    return Some(E::object::RopeQuery { expr: existing, rope });
                }
                _ => {
                    return Some(E::object::RopeQuery { expr: existing, rope });
                }
            }
        }
        None
    }

    // Making this comptime bloats the binary and doesn't seem to impact runtime performance.
    pub fn as_property(expr: &Expr<'ast>, name: &[u8]) -> Option<Query<'ast>> {
        let Data::EObject(obj) = &expr.data else { return None };
        if obj.properties.len() == 0 {
            return None;
        }
        obj.as_property(name)
    }

    pub fn as_property_string_map(
        expr: &Expr<'ast>,
        name: &[u8],
        bump: &'ast Bump,
    ) -> Option<Box<ArrayHashMap<&'ast [u8], &'ast [u8]>>> {
        let Data::EObject(obj_) = &expr.data else { return None };
        if obj_.properties.len() == 0 {
            return None;
        }
        let query = obj_.as_property(name)?;
        let Data::EObject(obj) = &query.expr.data else { return None };

        let mut count: usize = 0;
        for prop in obj.properties.slice() {
            let Some(key) = prop.key.as_ref().and_then(|k| k.as_string(bump)) else { continue };
            let Some(value) = prop.value.as_ref().and_then(|v| v.as_string(bump)) else { continue };
            count += (key.len() > 0 && value.len() > 0) as usize;
        }

        if count == 0 {
            return None;
        }
        let mut map = ArrayHashMap::<&[u8], &[u8]>::default();
        if map.reserve(count).is_err() {
            return None;
        }

        for prop in obj.properties.slice() {
            let Some(key) = prop.key.as_ref().and_then(|k| k.as_string(bump)) else { continue };
            let Some(value) = prop.value.as_ref().and_then(|v| v.as_string(bump)) else { continue };

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

pub struct ArrayIterator<'ast, 'a> {
    pub array: &'a E::Array<'ast>,
    pub index: u32,
}

impl<'ast, 'a> ArrayIterator<'ast, 'a> {
    pub fn next(&mut self) -> Option<Expr<'ast>> {
        if self.index >= self.array.items.len() {
            return None;
        }
        let result = self.array.items.ptr()[self.index as usize];
        self.index += 1;
        Some(result)
    }
}

impl<'ast> Expr<'ast> {
    pub fn as_array<'a>(expr: &'a Expr<'ast>) -> Option<ArrayIterator<'ast, 'a>> {
        let Data::EArray(array) = &expr.data else { return None };
        if array.items.len() == 0 {
            return None;
        }
        Some(ArrayIterator { array, index: 0 })
    }

    // Helper for owned-expr iteration (used by get_array above where the expr is by-value)
    // TODO(port): lifetime — Zig returns iterator borrowing arena ptr, not &Expr
    fn as_array_owned(self) -> Option<ArrayIterator<'ast, 'ast>> {
        match self.data {
            Data::EArray(array) => {
                if array.items.len() == 0 {
                    return None;
                }
                Some(ArrayIterator { array, index: 0 })
            }
            _ => None,
        }
    }

    #[inline]
    pub fn as_utf8_string_literal(expr: &Expr<'ast>) -> Option<&'ast [u8]> {
        if let Data::EString(s) = &expr.data {
            debug_assert!(s.next.is_none());
            return Some(s.data);
        }
        None
    }

    #[inline]
    pub fn as_string_literal(expr: &Expr<'ast>, bump: &'ast Bump) -> Option<&'ast [u8]> {
        let Data::EString(s) = &expr.data else { return None };
        s.string(bump).ok()
    }

    #[inline]
    pub fn is_string(expr: &Expr<'ast>) -> bool {
        matches!(expr.data, Data::EString(_))
    }

    #[inline]
    pub fn as_string(expr: &Expr<'ast>, bump: &'ast Bump) -> Option<&'ast [u8]> {
        match &expr.data {
            Data::EString(str) => Some(str.string(bump).expect("OOM")),
            _ => None,
        }
    }

    #[inline]
    pub fn as_string_hash(
        expr: &Expr<'ast>,
        bump: &'ast Bump,
        hash_fn: fn(&[u8]) -> u64,
    ) -> Result<Option<u64>, AllocError> {
        match &expr.data {
            Data::EString(str) => {
                if str.is_utf8() {
                    return Ok(Some(hash_fn(str.data)));
                }
                let utf8_str = str.string(bump)?;
                // PERF(port): was arena alloc + free; bump-allocated, freed on reset
                Ok(Some(hash_fn(utf8_str)))
            }
            _ => Ok(None),
        }
    }

    #[inline]
    pub fn as_string_cloned(expr: &Expr<'ast>, bump: &'ast Bump) -> Result<Option<&'ast [u8]>, AllocError> {
        match &expr.data {
            Data::EString(str) => Ok(Some(str.string_cloned(bump)?)),
            _ => Ok(None),
        }
    }

    #[inline]
    pub fn as_string_z(expr: &Expr<'ast>, bump: &'ast Bump) -> Result<Option<&'ast ZStr>, AllocError> {
        match &expr.data {
            Data::EString(str) => Ok(Some(str.string_z(bump)?)),
            _ => Ok(None),
        }
    }

    pub fn as_bool(expr: &Expr<'ast>) -> Option<bool> {
        match expr.data {
            Data::EBoolean(b) | Data::EBranchBoolean(b) => Some(b.value),
            _ => None,
        }
    }

    pub fn as_number(expr: &Expr<'ast>) -> Option<f64> {
        match expr.data {
            Data::ENumber(n) => Some(n.value),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EFlags {
    None,
    TsDecorator,
}

struct Serializable<'ast> {
    type_: Tag,
    object: &'static [u8],
    value: Data<'ast>,
    loc: Loc,
}

impl<'ast> Expr<'ast> {
    pub fn is_missing(a: &Expr<'ast>) -> bool {
        matches!(a.data, Data::EMissing(_))
    }

    // The goal of this function is to "rotate" the AST if it's possible to use the
    // left-associative property of the operator to avoid unnecessary parentheses.
    //
    // When using this, make absolutely sure that the operator is actually
    // associative. For example, the "-" operator is not associative for
    // floating-point numbers.
    pub fn join_with_left_associative_op<const OP: Op::Code>(
        a: Expr<'ast>,
        b: Expr<'ast>,
    ) -> Expr<'ast> {
        // PERF(port): was comptime monomorphization — profile in Phase B
        // "(a, b) op c" => "a, b op c"
        if let Data::EBinary(comma) = a.data {
            if comma.op == Op::Code::BinComma {
                comma.right = Self::join_with_left_associative_op::<OP>(comma.right, b);
            }
        }

        // "a op (b op c)" => "(a op b) op c"
        // "a op (b op (c op d))" => "((a op b) op c) op d"
        if let Data::EBinary(binary) = b.data {
            if binary.op == OP {
                return Self::join_with_left_associative_op::<OP>(
                    Self::join_with_left_associative_op::<OP>(a, binary.left),
                    binary.right,
                );
            }
        }

        // "a op b" => "a op b"
        // "(a op b) op c" => "(a op b) op c"
        Expr::init(E::Binary { op: OP, left: a, right: b }, a.loc)
    }

    pub fn join_with_comma(a: Expr<'ast>, b: Expr<'ast>) -> Expr<'ast> {
        if a.is_missing() {
            return b;
        }
        if b.is_missing() {
            return a;
        }
        Expr::init(
            E::Binary { op: Op::Code::BinComma, left: a, right: b },
            a.loc,
        )
    }

    pub fn join_all_with_comma(all: &mut [Expr<'ast>]) -> Expr<'ast> {
        debug_assert!(!all.is_empty());
        match all.len() {
            1 => all[0],
            2 => Expr::join_with_comma(all[0], all[1]),
            _ => {
                let mut expr = all[0];
                for i in 1..all.len() {
                    expr = Expr::join_with_comma(expr, all[i]);
                }
                expr
            }
        }
    }

    pub fn join_all_with_comma_callback<C>(
        all: &mut [Expr<'ast>],
        ctx: C,
        callback: fn(ctx: &C, expr: Expr<'ast>) -> Option<Expr<'ast>>,
    ) -> Option<Expr<'ast>> {
        match all.len() {
            0 => None,
            1 => callback(&ctx, all[0]),
            2 => {
                let result = Expr::join_with_comma(
                    callback(&ctx, all[0]).unwrap_or(Expr {
                        data: Data::EMissing(E::Missing {}),
                        loc: all[0].loc,
                    }),
                    callback(&ctx, all[1]).unwrap_or(Expr {
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
                let mut expr = callback(&ctx, all[0]).unwrap_or(Expr {
                    data: Data::EMissing(E::Missing {}),
                    loc: all[0].loc,
                });

                while i < all.len() {
                    expr = Expr::join_with_comma(
                        expr,
                        callback(&ctx, all[i]).unwrap_or(Expr {
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

    // TODO(port): jsonStringify protocol — replace with serde or custom trait in Phase B
    pub fn json_stringify(self_: &Expr<'ast>, writer: &mut impl fmt::Write) -> fmt::Result {
        let _ = (self_, writer);
        // writer.write(Serializable { type_: self_.data.tag(), object: b"expr", value: self_.data, loc: self_.loc })
        todo!("jsonStringify")
    }

    pub fn extract_numeric_values_in_safe_range(left: Data<'ast>, right: Data<'ast>) -> Option<[f64; 2]> {
        let l_value = left.extract_numeric_value()?;
        let r_value = right.extract_numeric_value()?;

        // Check for NaN and return null if either value is NaN
        if l_value.is_nan() || r_value.is_nan() {
            return None;
        }

        if l_value.is_infinite() || r_value.is_infinite() {
            return Some([l_value, r_value]);
        }

        if l_value > jsc::MAX_SAFE_INTEGER || r_value > jsc::MAX_SAFE_INTEGER {
            return None;
        }
        if l_value < jsc::MIN_SAFE_INTEGER || r_value < jsc::MIN_SAFE_INTEGER {
            return None;
        }

        Some([l_value, r_value])
    }

    pub fn extract_numeric_values(left: Data<'ast>, right: Data<'ast>) -> Option<[f64; 2]> {
        Some([
            left.extract_numeric_value()?,
            right.extract_numeric_value()?,
        ])
    }

    pub fn extract_string_values(
        left: Data<'ast>,
        right: Data<'ast>,
        bump: &'ast Bump,
    ) -> Option<[&'ast mut E::String<'ast>; 2]> {
        let l_string = left.extract_string_value()?;
        let r_string = right.extract_string_value()?;
        l_string.resolve_rope_if_needed(bump);
        r_string.resolve_rope_if_needed(bump);

        if l_string.is_utf8() != r_string.is_utf8() {
            return None;
        }

        Some([l_string, r_string])
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Static state
// ───────────────────────────────────────────────────────────────────────────

// TODO(port): icount is a global mutable usize — needs atomic or thread_local
pub static ICOUNT: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);

// We don't need to dynamically allocate booleans
static TRUE_BOOL: E::Boolean = E::Boolean { value: true };
static FALSE_BOOL: E::Boolean = E::Boolean { value: false };
static BOOL_VALUES: [&E::Boolean; 2] = [&FALSE_BOOL, &TRUE_BOOL];

// ───────────────────────────────────────────────────────────────────────────
// Expr::allocate / Expr::init — comptime-type dispatch → trait
// ───────────────────────────────────────────────────────────────────────────

/// Trait implemented by every `E::*` payload type to construct an `Expr`.
///
/// Replaces Zig's `comptime Type: type` switch in `Expr.init` / `Expr.allocate`.
pub trait IntoExprData<'ast>: Sized {
    /// Construct `Data` using the thread-local `Data::Store` arena (Zig: `Expr.init`).
    fn into_data_store(self) -> Data<'ast>;
    /// Construct `Data` using a caller-supplied arena (Zig: `Expr.allocate`).
    /// Be careful to free the memory (or use an allocator that does it for you).
    fn into_data_alloc(self, bump: &'ast Bump) -> Data<'ast>;
}

macro_rules! impl_into_expr_data_boxed {
    ($($ty:ident => $variant:ident),* $(,)?) => {
        $(
            impl<'ast> IntoExprData<'ast> for E::$ty<'ast> {
                fn into_data_store(self) -> Data<'ast> {
                    Data::$variant(Store::append(self))
                }
                fn into_data_alloc(self, bump: &'ast Bump) -> Data<'ast> {
                    Data::$variant(bump.alloc(self))
                }
            }
        )*
    };
}

macro_rules! impl_into_expr_data_inline {
    ($($ty:ident => $variant:ident),* $(,)?) => {
        $(
            impl<'ast> IntoExprData<'ast> for E::$ty {
                fn into_data_store(self) -> Data<'ast> { Data::$variant(self) }
                fn into_data_alloc(self, _bump: &'ast Bump) -> Data<'ast> { Data::$variant(self) }
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

// E::Identifier — Zig copies fields explicitly (normalization)
impl<'ast> IntoExprData<'ast> for E::Identifier {
    fn into_data_store(self) -> Data<'ast> {
        Data::EIdentifier(E::Identifier {
            ref_: self.ref_,
            must_keep_due_to_with_stmt: self.must_keep_due_to_with_stmt,
            can_be_removed_if_unused: self.can_be_removed_if_unused,
            call_can_be_unwrapped_if_unused: self.call_can_be_unwrapped_if_unused,
        })
    }
    fn into_data_alloc(self, _bump: &'ast Bump) -> Data<'ast> {
        self.into_data_store()
    }
}

impl<'ast> IntoExprData<'ast> for E::ImportIdentifier {
    fn into_data_store(self) -> Data<'ast> {
        Data::EImportIdentifier(E::ImportIdentifier {
            ref_: self.ref_,
            was_originally_identifier: self.was_originally_identifier,
        })
    }
    fn into_data_alloc(self, _bump: &'ast Bump) -> Data<'ast> {
        self.into_data_store()
    }
}

impl<'ast> IntoExprData<'ast> for E::CommonJSExportIdentifier {
    fn into_data_store(self) -> Data<'ast> {
        Data::ECommonjsExportIdentifier(E::CommonJSExportIdentifier {
            ref_: self.ref_,
            base: self.base,
        })
    }
    fn into_data_alloc(self, _bump: &'ast Bump) -> Data<'ast> {
        // Zig's allocate() variant only sets .ref; init() also sets .base.
        // We follow init() semantics here (superset).
        Data::ECommonjsExportIdentifier(E::CommonJSExportIdentifier {
            ref_: self.ref_,
            ..Default::default()
        })
    }
}

// E::String — special debug assert + boxed
impl<'ast> IntoExprData<'ast> for E::String<'ast> {
    fn into_data_store(self) -> Data<'ast> {
        #[cfg(debug_assertions)]
        {
            // Sanity check: assert string is not a null ptr
            if !self.data.is_empty() && self.is_utf8() {
                debug_assert!(self.data.as_ptr() as usize > 0);
            }
        }
        Data::EString(Store::append(self))
    }
    fn into_data_alloc(self, bump: &'ast Bump) -> Data<'ast> {
        #[cfg(debug_assertions)]
        {
            if !self.data.is_empty() && self.is_utf8() {
                debug_assert!(self.data.as_ptr() as usize > 0);
            }
        }
        Data::EString(bump.alloc(self))
    }
}

// *E.String — Zig allows passing a pointer to copy from
impl<'ast> IntoExprData<'ast> for &E::String<'ast> {
    fn into_data_store(self) -> Data<'ast> {
        Data::EString(Store::append(self.clone()))
    }
    fn into_data_alloc(self, bump: &'ast Bump) -> Data<'ast> {
        Data::EString(bump.alloc(self.clone()))
    }
}

impl<'ast> Expr<'ast> {
    /// When the lifetime of an Expr.Data's pointer must exist longer than reset() is called, use this function.
    /// Be careful to free the memory (or use an allocator that does it for you)
    /// Also, prefer Expr.init or Expr.alloc when possible. This will be slower.
    pub fn allocate<T: IntoExprData<'ast>>(bump: &'ast Bump, st: T, loc: Loc) -> Expr<'ast> {
        ICOUNT.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        Store::assert();
        Expr { loc, data: st.into_data_alloc(bump) }
    }

    pub fn init<T: IntoExprData<'ast>>(st: T, loc: Loc) -> Expr<'ast> {
        ICOUNT.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        Store::assert();
        Expr { loc, data: st.into_data_store() }
    }
}

pub type Disabler = bun_core::DebugOnlyDisabler<Expr<'static>>;

impl<'ast> Expr<'ast> {
    /// If this returns true, then calling this expression captures the target of
    /// the property access as "this" when calling the function in the property.
    #[inline]
    pub fn is_property_access(this: &Expr<'ast>) -> bool {
        this.has_value_for_this_in_call()
    }

    #[inline]
    pub fn is_primitive_literal(this: &Expr<'ast>) -> bool {
        this.data.tag().is_primitive_literal()
    }

    #[inline]
    pub fn is_ref(this: &Expr<'ast>, ref_: Ref) -> bool {
        match &this.data {
            Data::EImportIdentifier(import_identifier) => import_identifier.ref_.eql(ref_),
            Data::EIdentifier(ident) => ident.ref_.eql(ref_),
            _ => false,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Tag
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::IntoStaticStr)]
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
    pub fn is_primitive_literal(tag: Tag) -> bool {
        matches!(
            tag,
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

    pub fn is_array(self) -> bool { matches!(self, Tag::EArray) }
    pub fn is_unary(self) -> bool { matches!(self, Tag::EUnary) }
    pub fn is_binary(self) -> bool { matches!(self, Tag::EBinary) }
    pub fn is_this(self) -> bool { matches!(self, Tag::EThis) }
    pub fn is_class(self) -> bool { matches!(self, Tag::EClass) }
    pub fn is_boolean(self) -> bool { matches!(self, Tag::EBoolean | Tag::EBranchBoolean) }
    pub fn is_super(self) -> bool { matches!(self, Tag::ESuper) }
    pub fn is_null(self) -> bool { matches!(self, Tag::ENull) }
    pub fn is_undefined(self) -> bool { matches!(self, Tag::EUndefined) }
    pub fn is_new(self) -> bool { matches!(self, Tag::ENew) }
    pub fn is_new_target(self) -> bool { matches!(self, Tag::ENewTarget) }
    pub fn is_function(self) -> bool { matches!(self, Tag::EFunction) }
    pub fn is_import_meta(self) -> bool { matches!(self, Tag::EImportMeta) }
    pub fn is_call(self) -> bool { matches!(self, Tag::ECall) }
    pub fn is_dot(self) -> bool { matches!(self, Tag::EDot) }
    pub fn is_index(self) -> bool { matches!(self, Tag::EIndex) }
    pub fn is_arrow(self) -> bool { matches!(self, Tag::EArrow) }
    pub fn is_identifier(self) -> bool { matches!(self, Tag::EIdentifier) }
    pub fn is_import_identifier(self) -> bool { matches!(self, Tag::EImportIdentifier) }
    pub fn is_private_identifier(self) -> bool { matches!(self, Tag::EPrivateIdentifier) }
    pub fn is_jsx_element(self) -> bool { matches!(self, Tag::EJsxElement) }
    pub fn is_missing(self) -> bool { matches!(self, Tag::EMissing) }
    pub fn is_number(self) -> bool { matches!(self, Tag::ENumber) }
    pub fn is_big_int(self) -> bool { matches!(self, Tag::EBigInt) }
    pub fn is_object(self) -> bool { matches!(self, Tag::EObject) }
    pub fn is_spread(self) -> bool { matches!(self, Tag::ESpread) }
    pub fn is_string(self) -> bool { matches!(self, Tag::EString) }
    pub fn is_template(self) -> bool { matches!(self, Tag::ETemplate) }
    pub fn is_reg_exp(self) -> bool { matches!(self, Tag::ERegExp) }
    pub fn is_await(self) -> bool { matches!(self, Tag::EAwait) }
    pub fn is_yield(self) -> bool { matches!(self, Tag::EYield) }
    pub fn is_if(self) -> bool { matches!(self, Tag::EIf) }
    pub fn is_require_resolve_string(self) -> bool { matches!(self, Tag::ERequireResolveString) }
    pub fn is_import(self) -> bool { matches!(self, Tag::EImport) }
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

impl<'ast> Expr<'ast> {
    pub fn is_boolean(a: &Expr<'ast>) -> bool {
        match &a.data {
            Data::EBoolean(_) | Data::EBranchBoolean(_) => true,
            Data::EIf(ex) => ex.yes.is_boolean() && ex.no.is_boolean(),
            Data::EUnary(ex) => ex.op == Op::Code::UnNot || ex.op == Op::Code::UnDelete,
            Data::EBinary(ex) => match ex.op {
                Op::Code::BinStrictEq
                | Op::Code::BinStrictNe
                | Op::Code::BinLooseEq
                | Op::Code::BinLooseNe
                | Op::Code::BinLt
                | Op::Code::BinGt
                | Op::Code::BinLe
                | Op::Code::BinGe
                | Op::Code::BinInstanceof
                | Op::Code::BinIn => true,
                Op::Code::BinLogicalOr => ex.left.is_boolean() && ex.right.is_boolean(),
                Op::Code::BinLogicalAnd => ex.left.is_boolean() && ex.right.is_boolean(),
                _ => false,
            },
            _ => false,
        }
    }

    pub fn assign(a: Expr<'ast>, b: Expr<'ast>) -> Expr<'ast> {
        Expr::init(
            E::Binary { op: Op::Code::BinAssign, left: a, right: b },
            a.loc,
        )
    }

    #[inline]
    pub fn at<T: IntoExprData<'ast>>(expr: &Expr<'ast>, t: T) -> Expr<'ast> {
        Expr::init(t, expr.loc)
    }

    // Wraps the provided expression in the "!" prefix operator. The expression
    // will potentially be simplified to avoid generating unnecessary extra "!"
    // operators. For example, calling this with "!!x" will return "!x" instead
    // of returning "!!!x".
    pub fn not(expr: &Expr<'ast>, bump: &'ast Bump) -> Expr<'ast> {
        expr.maybe_simplify_not(bump).unwrap_or_else(|| {
            Expr::init(
                E::Unary {
                    op: Op::Code::UnNot,
                    value: *expr,
                    ..Default::default()
                },
                expr.loc,
            )
        })
    }

    #[inline]
    pub fn has_value_for_this_in_call(expr: &Expr<'ast>) -> bool {
        matches!(expr.data, Data::EDot(_) | Data::EIndex(_))
    }

    /// The given "expr" argument should be the operand of a "!" prefix operator
    /// (i.e. the "x" in "!x"). This returns a simplified expression for the
    /// whole operator (i.e. the "!x") if it can be simplified, or false if not.
    /// It's separate from "Not()" above to avoid allocation on failure in case
    /// that is undesired.
    pub fn maybe_simplify_not(expr: &Expr<'ast>, bump: &'ast Bump) -> Option<Expr<'ast>> {
        match &expr.data {
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
                if un.op == Op::Code::UnNot && un.value.known_primitive() == PrimitiveType::Boolean {
                    return Some(un.value);
                }
            }
            Data::EBinary(ex) => {
                // TODO: evaluate whether or not it is safe to do this mutation since it's modifying in-place.
                // Make sure that these transformations are all safe for special values.
                // For example, "!(a < b)" is not the same as "a >= b" if a and/or b are
                // NaN (or undefined, or null, or possibly other problem cases too).
                match ex.op {
                    Op::Code::BinLooseEq => {
                        // "!(a == b)" => "a != b"
                        ex.op = Op::Code::BinLooseNe;
                        return Some(*expr);
                    }
                    Op::Code::BinLooseNe => {
                        // "!(a != b)" => "a == b"
                        ex.op = Op::Code::BinLooseEq;
                        return Some(*expr);
                    }
                    Op::Code::BinStrictEq => {
                        // "!(a === b)" => "a !== b"
                        ex.op = Op::Code::BinStrictNe;
                        return Some(*expr);
                    }
                    Op::Code::BinStrictNe => {
                        // "!(a !== b)" => "a === b"
                        ex.op = Op::Code::BinStrictEq;
                        return Some(*expr);
                    }
                    Op::Code::BinComma => {
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

    pub fn to_string_expr_without_side_effects(expr: &Expr<'ast>, bump: &'ast Bump) -> Option<Expr<'ast>> {
        let unwrapped = expr.unwrap_inlined();
        let slice: Option<&[u8]> = match &unwrapped.data {
            Data::ENull(_) => Some(b"null"),
            Data::EString(_) => return Some(*expr),
            Data::EUndefined(_) => Some(b"undefined"),
            Data::EBoolean(data) | Data::EBranchBoolean(data) => {
                Some(if data.value { b"true" } else { b"false" })
            }
            Data::EBigInt(bigint) => Some(bigint.value),
            Data::ENumber(num) => num.to_string(bump),
            Data::ERegExp(regexp) => Some(regexp.value),
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
            },
            _ => None,
        };
        slice.map(|s| Expr::init(E::String::init(s), expr.loc))
    }

    pub fn is_optional_chain(self_: &Expr<'ast>) -> bool {
        match &self_.data {
            Data::EDot(d) => d.optional_chain.is_some(),
            Data::EIndex(i) => i.optional_chain.is_some(),
            Data::ECall(c) => c.optional_chain.is_some(),
            _ => false,
        }
    }

    #[inline]
    pub fn known_primitive(self_: &Expr<'ast>) -> PrimitiveType {
        self_.data.known_primitive()
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PrimitiveType
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug, enumset::EnumSetType)]
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
            | PrimitiveType::String
        // for our purposes, bigint is dynamic
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
/// (`&'ast mut E::*`), inline variants are stored by value.
// TODO(port): `&'ast mut T` payloads make `Data` non-`Copy`; Zig copies the
// pointer freely. Phase B may need `*mut T` (raw arena ptr) or `Cell` interior
// mutability to recover `Copy` while preserving in-place mutation semantics.
pub enum Data<'ast> {
    EArray(&'ast mut E::Array<'ast>),
    EUnary(&'ast mut E::Unary<'ast>),
    EBinary(&'ast mut E::Binary<'ast>),
    EClass(&'ast mut E::Class<'ast>),

    ENew(&'ast mut E::New<'ast>),
    EFunction(&'ast mut E::Function<'ast>),
    ECall(&'ast mut E::Call<'ast>),
    EDot(&'ast mut E::Dot<'ast>),
    EIndex(&'ast mut E::Index<'ast>),
    EArrow(&'ast mut E::Arrow<'ast>),

    EJsxElement(&'ast mut E::JSXElement<'ast>),
    EObject(&'ast mut E::Object<'ast>),
    ESpread(&'ast mut E::Spread<'ast>),
    ETemplate(&'ast mut E::Template<'ast>),
    ERegExp(&'ast mut E::RegExp<'ast>),
    EAwait(&'ast mut E::Await<'ast>),
    EYield(&'ast mut E::Yield<'ast>),
    EIf(&'ast mut E::If<'ast>),
    EImport(&'ast mut E::Import<'ast>),

    EIdentifier(E::Identifier),
    EImportIdentifier(E::ImportIdentifier),
    EPrivateIdentifier(E::PrivateIdentifier),
    ECommonjsExportIdentifier(E::CommonJSExportIdentifier),

    EBoolean(E::Boolean),
    EBranchBoolean(E::Boolean),
    ENumber(E::Number),
    EBigInt(&'ast mut E::BigInt<'ast>),
    EString(&'ast mut E::String<'ast>),

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

    EInlinedEnum(&'ast mut E::InlinedEnum<'ast>),

    ENameOfSymbol(&'ast mut E::NameOfSymbol),
}

const _: () = assert!(core::mem::size_of::<Data<'_>>() == 24); // Do not increase the size of Expr

impl<'ast> Data<'ast> {
    pub fn tag(&self) -> Tag {
        match self {
            Data::EArray(_) => Tag::EArray,
            Data::EUnary(_) => Tag::EUnary,
            Data::EBinary(_) => Tag::EBinary,
            Data::EClass(_) => Tag::EClass,
            Data::ENew(_) => Tag::ENew,
            Data::EFunction(_) => Tag::EFunction,
            Data::ECall(_) => Tag::ECall,
            Data::EDot(_) => Tag::EDot,
            Data::EIndex(_) => Tag::EIndex,
            Data::EArrow(_) => Tag::EArrow,
            Data::EJsxElement(_) => Tag::EJsxElement,
            Data::EObject(_) => Tag::EObject,
            Data::ESpread(_) => Tag::ESpread,
            Data::ETemplate(_) => Tag::ETemplate,
            Data::ERegExp(_) => Tag::ERegExp,
            Data::EAwait(_) => Tag::EAwait,
            Data::EYield(_) => Tag::EYield,
            Data::EIf(_) => Tag::EIf,
            Data::EImport(_) => Tag::EImport,
            Data::EIdentifier(_) => Tag::EIdentifier,
            Data::EImportIdentifier(_) => Tag::EImportIdentifier,
            Data::EPrivateIdentifier(_) => Tag::EPrivateIdentifier,
            Data::ECommonjsExportIdentifier(_) => Tag::ECommonjsExportIdentifier,
            Data::EBoolean(_) => Tag::EBoolean,
            Data::EBranchBoolean(_) => Tag::EBranchBoolean,
            Data::ENumber(_) => Tag::ENumber,
            Data::EBigInt(_) => Tag::EBigInt,
            Data::EString(_) => Tag::EString,
            Data::ERequireString(_) => Tag::ERequireString,
            Data::ERequireResolveString(_) => Tag::ERequireResolveString,
            Data::ERequireCallTarget => Tag::ERequireCallTarget,
            Data::ERequireResolveCallTarget => Tag::ERequireResolveCallTarget,
            Data::EMissing(_) => Tag::EMissing,
            Data::EThis(_) => Tag::EThis,
            Data::ESuper(_) => Tag::ESuper,
            Data::ENull(_) => Tag::ENull,
            Data::EUndefined(_) => Tag::EUndefined,
            Data::ENewTarget(_) => Tag::ENewTarget,
            Data::EImportMeta(_) => Tag::EImportMeta,
            Data::EImportMetaMain(_) => Tag::EImportMetaMain,
            Data::ERequireMain => Tag::ERequireMain,
            Data::ESpecial(_) => Tag::ESpecial,
            Data::EInlinedEnum(_) => Tag::EInlinedEnum,
            Data::ENameOfSymbol(_) => Tag::ENameOfSymbol,
        }
    }

    // Zig: `pub fn as(data: Data, comptime tag: Tag) ?@FieldType(Data, @tagName(tag))`
    // Rust has no field-by-tag reflection. Provide concrete accessors as needed.
    // TODO(port): generate per-variant `as_*` accessors via macro in Phase B.
    pub fn as_e_string(&self) -> Option<&E::String<'ast>> {
        if let Data::EString(s) = self { Some(s) } else { None }
    }
    pub fn as_e_identifier(&self) -> Option<E::Identifier> {
        if let Data::EIdentifier(i) = self { Some(*i) } else { None }
    }
    pub fn as_e_inlined_enum(&self) -> Option<&E::InlinedEnum<'ast>> {
        if let Data::EInlinedEnum(i) = self { Some(i) } else { None }
    }

    pub fn clone(this: Data<'ast>, bump: &'ast Bump) -> Result<Data<'ast>, bun_core::Error> {
        // TODO(port): narrow error set
        macro_rules! shallow {
            ($variant:ident, $el:expr) => {{
                let item = bump.alloc((**$el).clone());
                return Ok(Data::$variant(item));
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

    pub fn deep_clone(this: Data<'ast>, bump: &'ast Bump) -> Result<Data<'ast>, AllocError> {
        match &this {
            Data::EArray(el) => {
                let items = el.items.deep_clone(bump)?;
                let item = bump.alloc(E::Array {
                    items,
                    comma_after_spread: el.comma_after_spread,
                    was_originally_macro: el.was_originally_macro,
                    is_single_line: el.is_single_line,
                    is_parenthesized: el.is_parenthesized,
                    close_bracket_loc: el.close_bracket_loc,
                });
                Ok(Data::EArray(item))
            }
            Data::EUnary(el) => {
                let item = bump.alloc(E::Unary {
                    op: el.op,
                    value: el.value.deep_clone(bump)?,
                    flags: el.flags,
                });
                Ok(Data::EUnary(item))
            }
            Data::EBinary(el) => {
                let item = bump.alloc(E::Binary {
                    op: el.op,
                    left: el.left.deep_clone(bump)?,
                    right: el.right.deep_clone(bump)?,
                });
                Ok(Data::EBinary(item))
            }
            Data::EClass(el) => {
                let mut properties = bumpalo::collections::Vec::with_capacity_in(el.properties.len(), bump);
                for prop in el.properties.iter() {
                    properties.push(prop.deep_clone(bump)?);
                }
                let properties = properties.into_bump_slice();

                let item = bump.alloc(E::Class {
                    class_keyword: el.class_keyword,
                    ts_decorators: el.ts_decorators.deep_clone(bump)?,
                    class_name: el.class_name,
                    extends: match &el.extends {
                        Some(e) => Some(e.deep_clone(bump)?),
                        None => None,
                    },
                    body_loc: el.body_loc,
                    close_brace_loc: el.close_brace_loc,
                    properties,
                    has_decorators: el.has_decorators,
                });
                Ok(Data::EClass(item))
            }
            Data::ENew(el) => {
                let item = bump.alloc(E::New {
                    target: el.target.deep_clone(bump)?,
                    args: el.args.deep_clone(bump)?,
                    can_be_unwrapped_if_unused: el.can_be_unwrapped_if_unused,
                    close_parens_loc: el.close_parens_loc,
                });
                Ok(Data::ENew(item))
            }
            Data::EFunction(el) => {
                let item = bump.alloc(E::Function {
                    func: el.func.deep_clone(bump)?,
                });
                Ok(Data::EFunction(item))
            }
            Data::ECall(el) => {
                let item = bump.alloc(E::Call {
                    target: el.target.deep_clone(bump)?,
                    args: el.args.deep_clone(bump)?,
                    optional_chain: el.optional_chain,
                    is_direct_eval: el.is_direct_eval,
                    close_paren_loc: el.close_paren_loc,
                    can_be_unwrapped_if_unused: el.can_be_unwrapped_if_unused,
                    was_jsx_element: el.was_jsx_element,
                });
                Ok(Data::ECall(item))
            }
            Data::EDot(el) => {
                let item = bump.alloc(E::Dot {
                    target: el.target.deep_clone(bump)?,
                    name: el.name,
                    name_loc: el.name_loc,
                    optional_chain: el.optional_chain,
                    can_be_removed_if_unused: el.can_be_removed_if_unused,
                    call_can_be_unwrapped_if_unused: el.call_can_be_unwrapped_if_unused,
                });
                Ok(Data::EDot(item))
            }
            Data::EIndex(el) => {
                let item = bump.alloc(E::Index {
                    target: el.target.deep_clone(bump)?,
                    index: el.index.deep_clone(bump)?,
                    optional_chain: el.optional_chain,
                });
                Ok(Data::EIndex(item))
            }
            Data::EArrow(el) => {
                let mut args = bumpalo::collections::Vec::with_capacity_in(el.args.len(), bump);
                for i in 0..el.args.len() {
                    args.push(el.args[i].deep_clone(bump)?);
                }
                let args = args.into_bump_slice();
                let item = bump.alloc(E::Arrow {
                    args,
                    body: el.body,
                    is_async: el.is_async,
                    has_rest_arg: el.has_rest_arg,
                    prefer_expr: el.prefer_expr,
                });
                Ok(Data::EArrow(item))
            }
            Data::EJsxElement(el) => {
                let item = bump.alloc(E::JSXElement {
                    tag: match &el.tag {
                        Some(tag) => Some(tag.deep_clone(bump)?),
                        None => None,
                    },
                    properties: el.properties.deep_clone(bump)?,
                    children: el.children.deep_clone(bump)?,
                    key_prop_index: el.key_prop_index,
                    flags: el.flags,
                    close_tag_loc: el.close_tag_loc,
                });
                Ok(Data::EJsxElement(item))
            }
            Data::EObject(el) => {
                let item = bump.alloc(E::Object {
                    properties: el.properties.deep_clone(bump)?,
                    comma_after_spread: el.comma_after_spread,
                    is_single_line: el.is_single_line,
                    is_parenthesized: el.is_parenthesized,
                    was_originally_macro: el.was_originally_macro,
                    close_brace_loc: el.close_brace_loc,
                });
                Ok(Data::EObject(item))
            }
            Data::ESpread(el) => {
                let item = bump.alloc(E::Spread {
                    value: el.value.deep_clone(bump)?,
                });
                Ok(Data::ESpread(item))
            }
            Data::ETemplate(el) => {
                let item = bump.alloc(E::Template {
                    tag: match &el.tag {
                        Some(tag) => Some(tag.deep_clone(bump)?),
                        None => None,
                    },
                    parts: el.parts,
                    head: el.head,
                });
                Ok(Data::ETemplate(item))
            }
            Data::ERegExp(el) => {
                let item = bump.alloc(E::RegExp {
                    value: el.value,
                    flags_offset: el.flags_offset,
                });
                Ok(Data::ERegExp(item))
            }
            Data::EAwait(el) => {
                let item = bump.alloc(E::Await {
                    value: el.value.deep_clone(bump)?,
                });
                Ok(Data::EAwait(item))
            }
            Data::EYield(el) => {
                let item = bump.alloc(E::Yield {
                    value: match &el.value {
                        Some(value) => Some(value.deep_clone(bump)?),
                        None => None,
                    },
                    is_star: el.is_star,
                });
                Ok(Data::EYield(item))
            }
            Data::EIf(el) => {
                let item = bump.alloc(E::If {
                    test_: el.test_.deep_clone(bump)?,
                    yes: el.yes.deep_clone(bump)?,
                    no: el.no.deep_clone(bump)?,
                });
                Ok(Data::EIf(item))
            }
            Data::EImport(el) => {
                let item = bump.alloc(E::Import {
                    expr: el.expr.deep_clone(bump)?,
                    options: el.options.deep_clone(bump)?,
                    import_record_index: el.import_record_index,
                });
                Ok(Data::EImport(item))
            }
            Data::EBigInt(el) => {
                let item = bump.alloc(E::BigInt { value: el.value });
                Ok(Data::EBigInt(item))
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
                Ok(Data::EString(item))
            }
            Data::EInlinedEnum(el) => {
                let item = bump.alloc(E::InlinedEnum {
                    value: el.value,
                    comment: el.comment,
                });
                Ok(Data::EInlinedEnum(item))
            }
            _ => Ok(this),
        }
    }

    /// `hasher` should be something with 'pub fn update([]const u8) void';
    /// symbol table is passed to serialize `Ref` as an identifier names instead of a nondeterministic numbers
    pub fn write_to_hasher<H: bun_core::Hasher, S: js_ast::SymbolTable>(
        this: &Data<'ast>,
        hasher: &mut H,
        symbol_table: &S,
    ) {
        bun_core::write_any_to_hasher(hasher, &this.tag());
        match this {
            Data::ENameOfSymbol(e) => {
                let symbol = e.ref_.get_symbol(symbol_table);
                hasher.update(symbol.original_name);
            }
            Data::EArray(e) => {
                bun_core::write_any_to_hasher(
                    hasher,
                    &(
                        e.is_single_line,
                        e.is_parenthesized,
                        e.was_originally_macro,
                        e.items.len(),
                    ),
                );
                for item in e.items.slice() {
                    item.data.write_to_hasher(hasher, symbol_table);
                }
            }
            Data::EUnary(e) => {
                // SAFETY: e.flags is a bitflags-like packed u8
                bun_core::write_any_to_hasher(hasher, &e.flags.bits());
                bun_core::write_any_to_hasher(hasher, &(e.op,));
                e.value.data.write_to_hasher(hasher, symbol_table);
            }
            Data::EBinary(e) => {
                bun_core::write_any_to_hasher(hasher, &(e.op,));
                e.left.data.write_to_hasher(hasher, symbol_table);
                e.right.data.write_to_hasher(hasher, symbol_table);
            }
            Data::EClass(_) => {}
            Data::ENew(_) | Data::ECall(_) => {}
            Data::EFunction(_) => {}
            Data::EDot(e) => {
                bun_core::write_any_to_hasher(hasher, &(e.optional_chain, e.name.len()));
                e.target.data.write_to_hasher(hasher, symbol_table);
                hasher.update(e.name);
            }
            Data::EIndex(e) => {
                bun_core::write_any_to_hasher(hasher, &(e.optional_chain,));
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
                bun_core::write_any_to_hasher(hasher, &(e.is_star, e.value.is_some()));
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
            Data::EIdentifier(e) => {
                let symbol = e.ref_.get_symbol(symbol_table);
                hasher.update(symbol.original_name);
            }
            Data::EImportIdentifier(e) => {
                let symbol = e.ref_.get_symbol(symbol_table);
                hasher.update(symbol.original_name);
            }
            Data::EPrivateIdentifier(e) => {
                let symbol = e.ref_.get_symbol(symbol_table);
                hasher.update(symbol.original_name);
            }
            Data::ECommonjsExportIdentifier(e) => {
                let symbol = e.ref_.get_symbol(symbol_table);
                hasher.update(symbol.original_name);
            }
            Data::EBoolean(e) | Data::EBranchBoolean(e) => {
                bun_core::write_any_to_hasher(hasher, &e.value);
            }
            Data::ENumber(e) => {
                bun_core::write_any_to_hasher(hasher, &e.value);
            }
            Data::EBigInt(e) => {
                hasher.update(e.value);
            }
            Data::ERegExp(e) => {
                hasher.update(e.value);
            }
            Data::EString(e) => {
                let mut next: Option<&E::String<'ast>> = Some(e);
                if let Some(current) = next {
                    if current.is_utf8() {
                        hasher.update(current.data);
                    } else {
                        hasher.update(bun_core::reinterpret_slice::<u8, _>(current.slice16()));
                    }
                    next = current.next.as_deref();
                    let _ = next;
                    hasher.update(b"\x00");
                }
            }
            Data::ERequireString(e) => {
                bun_core::write_any_to_hasher(hasher, &e.import_record_index); // preferably, i'd like to write the filepath
            }
            Data::ERequireResolveString(e) => {
                bun_core::write_any_to_hasher(hasher, &e.import_record_index);
            }
            Data::EImportMetaMain(e) => {
                bun_core::write_any_to_hasher(hasher, &e.inverted);
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

    /// "const values" here refers to expressions that can participate in constant
    /// inlining, as they have no side effects on instantiation, and there would be
    /// no observable difference if duplicated. This is a subset of canBeMoved()
    pub fn can_be_const_value(this: &Data<'ast>) -> bool {
        match this {
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
    pub fn can_be_moved(data: &Data<'ast>) -> bool {
        match data {
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

            Data::ETemplate(template) => template.tag.is_none() && template.parts.len() == 0,

            Data::EArray(array) => array.was_originally_macro,
            Data::EObject(object) => object.was_originally_macro,

            // TODO: experiment with allowing some e_binary, e_unary, e_if as movable
            _ => false,
        }
    }

    pub fn is_safe_to_string(data: &Data<'ast>) -> bool {
        match data {
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

    pub fn known_primitive(data: &Data<'ast>) -> PrimitiveType {
        match data {
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
                    Op::Code::BinStrictEq
                    | Op::Code::BinStrictNe
                    | Op::Code::BinLooseEq
                    | Op::Code::BinLooseNe
                    | Op::Code::BinLt
                    | Op::Code::BinGt
                    | Op::Code::BinLe
                    | Op::Code::BinGe
                    | Op::Code::BinInstanceof
                    | Op::Code::BinIn => break 'brk PrimitiveType::Boolean,
                    Op::Code::BinLogicalOr | Op::Code::BinLogicalAnd => {
                        break 'brk binary.left.data.merge_known_primitive(&binary.right.data)
                    }

                    Op::Code::BinNullishCoalescing => {
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

                    Op::Code::BinAdd => {
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

                    Op::Code::BinSub
                    | Op::Code::BinSubAssign
                    | Op::Code::BinMul
                    | Op::Code::BinMulAssign
                    | Op::Code::BinDiv
                    | Op::Code::BinDivAssign
                    | Op::Code::BinRem
                    | Op::Code::BinRemAssign
                    | Op::Code::BinPow
                    | Op::Code::BinPowAssign
                    | Op::Code::BinBitwiseAnd
                    | Op::Code::BinBitwiseAndAssign
                    | Op::Code::BinBitwiseOr
                    | Op::Code::BinBitwiseOrAssign
                    | Op::Code::BinBitwiseXor
                    | Op::Code::BinBitwiseXorAssign
                    | Op::Code::BinShl
                    | Op::Code::BinShlAssign
                    | Op::Code::BinShr
                    | Op::Code::BinShrAssign
                    | Op::Code::BinUShr
                    | Op::Code::BinUShrAssign => break 'brk PrimitiveType::Mixed, // Can be number or bigint (or an exception)

                    Op::Code::BinAssign | Op::Code::BinComma => {
                        break 'brk binary.right.data.known_primitive()
                    }

                    _ => {}
                }

                PrimitiveType::Unknown
            }

            Data::EUnary(unary) => match unary.op {
                Op::Code::UnVoid => PrimitiveType::Undefined,
                Op::Code::UnTypeof => PrimitiveType::String,
                Op::Code::UnNot | Op::Code::UnDelete => PrimitiveType::Boolean,
                Op::Code::UnPos => PrimitiveType::Number, // Cannot be bigint because that throws an exception
                Op::Code::UnNeg | Op::Code::UnCpl => match unary.value.data.known_primitive() {
                    PrimitiveType::Bigint => PrimitiveType::Bigint,
                    PrimitiveType::Unknown | PrimitiveType::Mixed => PrimitiveType::Mixed,
                    _ => PrimitiveType::Number, // Can be number or bigint
                },
                Op::Code::UnPreDec
                | Op::Code::UnPreInc
                | Op::Code::UnPostDec
                | Op::Code::UnPostInc => PrimitiveType::Mixed, // Can be number or bigint

                _ => PrimitiveType::Unknown,
            },

            Data::EInlinedEnum(inlined) => inlined.value.data.known_primitive(),

            _ => PrimitiveType::Unknown,
        }
    }

    pub fn merge_known_primitive(lhs: &Data<'ast>, rhs: &Data<'ast>) -> PrimitiveType {
        lhs.known_primitive().merge(rhs.known_primitive())
    }

    /// Returns true if the result of the "typeof" operator on this expression is
    /// statically determined and this expression has no side effects (i.e. can be
    /// removed without consequence).
    #[inline]
    pub fn to_typeof(data: &Data<'ast>) -> Option<&'static [u8]> {
        data.tag().typeof_()
    }

    pub fn to_number(data: &Data<'ast>) -> Option<f64> {
        match data {
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

    pub fn to_finite_number(data: &Data<'ast>) -> Option<f64> {
        match data {
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

    pub fn extract_numeric_value(data: &Data<'ast>) -> Option<f64> {
        match data {
            Data::ENumber(n) => Some(n.value),
            Data::EInlinedEnum(inlined) => match &inlined.value.data {
                Data::ENumber(num) => Some(num.value),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn extract_string_value(data: Data<'ast>) -> Option<&'ast mut E::String<'ast>> {
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
    pub fn is_string_value(self_: &Data<'ast>) -> bool {
        matches!(self_, Data::EString(_))
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
    pub const TRUE: Equality = Equality { ok: true, equal: true, is_require_main_and_module: false };
    pub const FALSE: Equality = Equality { ok: true, equal: false, is_require_main_and_module: false };
    pub const UNKNOWN: Equality = Equality { ok: false, equal: false, is_require_main_and_module: false };
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum EqlKind {
    Loose,
    Strict,
}

impl<'ast> Data<'ast> {
    // Returns "equal, ok". If "ok" is false, then nothing is known about the two
    // values. If "ok" is true, the equality or inequality of the two values is
    // stored in "equal".
    pub fn eql<P, const KIND: EqlKind>(
        left: &Data<'ast>,
        right: &Data<'ast>,
        p: &mut P,
    ) -> Equality
    where
        P: js_ast::ParserLike<'ast>, // TODO(port): trait abstraction for `p.allocator` / `p.module_ref`
    {
        // https://dorey.github.io/JavaScript-Equality-Table/
        match left {
            Data::EInlinedEnum(inlined) => {
                return inlined.value.data.eql::<P, KIND>(right, p);
            }

            Data::ENull(_) | Data::EUndefined(_) => {
                let right_tag = right.tag();
                let ok = matches!(right_tag, Tag::ENull | Tag::EUndefined)
                    || right_tag.is_primitive_literal();

                if KIND == EqlKind::Loose {
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
                    return Equality { ok: true, equal: l.value == r.value, ..Default::default() };
                }
                Data::ENumber(num) => {
                    if KIND == EqlKind::Strict {
                        // "true === 1" is false
                        // "false === 0" is false
                        return Equality::FALSE;
                    }
                    return Equality {
                        ok: true,
                        equal: if l.value { num.value == 1.0 } else { num.value == 0.0 },
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
                    return Equality { ok: true, equal: l.value == r.value, ..Default::default() };
                }
                Data::EInlinedEnum(r) => {
                    if let Data::ENumber(rn) = &r.value.data {
                        return Equality { ok: true, equal: l.value == rn.value, ..Default::default() };
                    }
                }
                Data::EBoolean(r) | Data::EBranchBoolean(r) => {
                    if KIND == EqlKind::Loose {
                        return Equality {
                            ok: true,
                            // "1 == true" is true
                            // "0 == false" is true
                            equal: if r.value { l.value == 1.0 } else { l.value == 0.0 },
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
                    if strings::strings::eql_long(l.value, r.value, true) {
                        return Equality::TRUE;
                    }
                    // 0x0000n == 0n is true
                    return Equality { ok: false, ..Default::default() };
                } else {
                    return Equality {
                        ok: matches!(right, Data::ENull(_) | Data::EUndefined(_)),
                        equal: false,
                        ..Default::default()
                    };
                }
            }
            Data::EString(l) => match right {
                Data::EString(r) => {
                    r.resolve_rope_if_needed(p.allocator());
                    l.resolve_rope_if_needed(p.allocator());
                    return Equality {
                        ok: true,
                        equal: r.eql_estring(l),
                        ..Default::default()
                    };
                }
                Data::EInlinedEnum(inlined) => {
                    if let Data::EString(r) = &inlined.value.data {
                        r.resolve_rope_if_needed(p.allocator());
                        l.resolve_rope_if_needed(p.allocator());
                        return Equality {
                            ok: true,
                            equal: r.eql_estring(l),
                            ..Default::default()
                        };
                    }
                }
                Data::ENull(_) | Data::EUndefined(_) => {
                    return Equality::FALSE;
                }
                Data::ENumber(r) => {
                    if KIND == EqlKind::Loose {
                        l.resolve_rope_if_needed(p.allocator());
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
            },

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

/// Typed slab arena for boxed `E::*` payloads. Thread-local; bulk-freed by
/// `reset()`.
pub struct Store;

// TODO(port): NewStore(&.{ ...types... }, 512) is a Zig comptime type-list
// generator. In Rust this becomes `js_ast::NewStore` parameterized over a
// macro-generated type list. Phase B: define `StoreType` via macro.
pub type StoreType = js_ast::NewStore<512>;

thread_local! {
    pub static STORE_INSTANCE: Cell<Option<*mut StoreType>> = const { Cell::new(None) };
    pub static STORE_MEMORY_ALLOCATOR: Cell<Option<*mut ASTMemoryAllocator>> = const { Cell::new(None) };
    pub static STORE_DISABLE_RESET: Cell<bool> = const { Cell::new(false) };
}

impl Store {
    pub fn create() {
        if STORE_INSTANCE.get().is_some() || STORE_MEMORY_ALLOCATOR.get().is_some() {
            return;
        }
        STORE_INSTANCE.set(Some(StoreType::init()));
    }

    pub fn reset() {
        if STORE_DISABLE_RESET.get() || STORE_MEMORY_ALLOCATOR.get().is_some() {
            return;
        }
        // SAFETY: instance is non-null when memory_allocator is None and create() was called
        unsafe { (*STORE_INSTANCE.get().unwrap()).reset() };
    }

    pub fn deinit() {
        if STORE_INSTANCE.get().is_none() || STORE_MEMORY_ALLOCATOR.get().is_some() {
            return;
        }
        // SAFETY: checked is_some above
        unsafe { (*STORE_INSTANCE.get().unwrap()).deinit() };
        STORE_INSTANCE.set(None);
    }

    #[inline]
    pub fn assert() {
        #[cfg(any(debug_assertions, feature = "asan"))]
        {
            if STORE_INSTANCE.get().is_none() && STORE_MEMORY_ALLOCATOR.get().is_none() {
                unreachable!("Store must be init'd");
            }
        }
    }

    /// create || reset
    pub fn begin() {
        if STORE_MEMORY_ALLOCATOR.get().is_some() {
            return;
        }
        if STORE_INSTANCE.get().is_none() {
            Self::create();
            return;
        }
        if !STORE_DISABLE_RESET.get() {
            // SAFETY: checked is_some above
            unsafe { (*STORE_INSTANCE.get().unwrap()).reset() };
        }
    }

    pub fn append<'ast, T: 'ast>(value: T) -> &'ast mut T {
        if let Some(allocator) = STORE_MEMORY_ALLOCATOR.get() {
            // SAFETY: ASTMemoryAllocator outlives 'ast by contract
            return unsafe { (*allocator).append(value) };
        }
        Disabler::assert();
        // SAFETY: instance is non-null (assert() guards in debug); slab returns
        // stable addresses for the lifetime of the store (until reset()).
        unsafe { (*STORE_INSTANCE.get().unwrap()).append(value) }
    }
}

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
    if !strings::strings::is_all_ascii(str) {
        return f64::NAN;
    }
    // TODO(port): move to *_sys
    unsafe extern "C" {
        fn JSC__jsToNumber(ptr: *const u8, len: usize) -> f64;
    }
    // SAFETY: str is valid for len bytes; JSC__jsToNumber reads only.
    unsafe { JSC__jsToNumber(str.as_ptr(), str.len()) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Expr.zig (3247 lines)
//   confidence: medium
//   todos:      18
//   notes:      `&'ast mut` payloads break `Copy` on Data/Expr — Phase B likely needs raw arena ptrs; comptime-type init/allocate collapsed to IntoExprData trait; toJS aliases deleted per *_jsc rule; get_path_may_be_index now takes &'ast Bump (Zig used default_allocator).
// ──────────────────────────────────────────────────────────────────────────
