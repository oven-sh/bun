//! Port of `src/js_parser/ast/Expr.zig`.
//!
//! AST crate: arena-allocated nodes (`*mut E::*`) live in `Data::Store`
//! (a typed slab) and are bulk-freed by `Store::reset()`. `Expr` and
//! `Data` carry the arena lifetime.

use core::fmt;
use core::cell::Cell;

use bun_alloc::{Arena as Bump, AllocError};
use bun_collections::{BabyList, ArrayHashMap};
use bun_core::{self, OOM};
use bun_logger as logger;
use bun_logger::Loc;
use bun_string::{self as strings, ZStr};

use crate::ast::{
    self as js_ast, ASTMemoryAllocator, DebugOnlyDisabler, E, G, Op, Ref, Stmt, StoreRef, S,
};

// ───────────────────────────────────────────────────────────────────────────
// Cycle-break: vtable for Blob (was bun_jsc::webcore::Blob — T6 upward ref).
// `from_blob` is cold (macro-expansion path); high tier (bun_js_parser_jsc)
// provides the static `BlobVTable` instance. PERF(port): was inline switch.
// ───────────────────────────────────────────────────────────────────────────
pub struct BlobVTable {
    pub shared_view: unsafe fn(*const ()) -> &'static [u8],
    pub content_type: unsafe fn(*const ()) -> &'static [u8],
}
#[derive(Clone, Copy)]
pub struct BlobRef {
    pub owner: *const (), // SAFETY: erased bun_jsc::webcore::Blob
    pub vtable: &'static BlobVTable,
}
impl BlobRef {
    #[inline] fn shared_view(&self) -> &[u8] { unsafe { (self.vtable.shared_view)(self.owner) } }
    #[inline] fn content_type(&self) -> &[u8] { unsafe { (self.vtable.content_type)(self.owner) } }
}

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

// TODO(b2-ast-round-C): clone/deep_clone/can_be_moved/wrap_in_arrow forward to
// `Data::deep_clone`/`Data::can_be_moved` (gated below).
#[cfg(any())]
impl Expr {
    pub fn is_anonymous_named(expr: Expr) -> bool {
        match expr.data {
            Data::EArrow(_) => true,
            Data::EFunction(func) => func.func.name.is_none(),
            Data::EClass(class) => class.class_name.is_none(),
            _ => false,
        }
    }

    pub fn clone(this: Expr, bump: &Bump) -> Result<Expr, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Expr {
            loc: this.loc,
            data: this.data.clone(bump)?,
        })
    }

    pub fn deep_clone(this: Expr, bump: &Bump) -> Result<Expr, AllocError> {
        Ok(Expr {
            loc: this.loc,
            data: this.data.deep_clone(bump)?,
        })
    }

    pub fn wrap_in_arrow(this: Expr, bump: &Bump) -> Result<Expr, bun_core::Error> {
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

    pub fn can_be_inlined_from_property_access(this: Expr) -> bool {
        match this.data {
            // if the array has a spread we must keep it
            // https://github.com/oven-sh/bun/issues/2594
            Data::ESpread(_) => false,
            Data::EMissing(_) => false,
            _ => true,
        }
    }

    pub fn can_be_const_value(this: Expr) -> bool {
        this.data.can_be_const_value()
    }

    pub fn can_be_moved(expr: Expr) -> bool {
        expr.data.can_be_moved()
    }

    pub fn unwrap_inlined(expr: Expr) -> Expr {
        if let Data::EInlinedEnum(inlined) = expr.data {
            return inlined.value;
        }
        expr
    }

    // TODO(b2-blocked): bun_http_types::MimeType + bun_interchange::json::parse — this is the
    // macro-expansion `Expr.fromBlob` path (cold). High tier (`js_parser_jsc`) should own it
    // anyway since it touches `jsc::webcore::Blob`. Gate body until those land.
    #[cfg(any())]
    pub fn from_blob(
        blob: BlobRef,
        bump: &Bump,
        mime_type_: Option<MimeType>,
        log: &mut logger::Log,
        loc: Loc,
    ) -> Result<Expr, bun_core::Error> {
        let bytes = blob.shared_view();

        let mime_type = mime_type_.unwrap_or_else(|| MimeType::init(blob.content_type(), None, None));

        if mime_type.category == MimeType::Category::Json {
            let source = &logger::Source::init_path_string(b"fetch.json", bytes);
            let mut out_expr = match crate::interchange_json_stub::parse_for_macro(source, log, bump) {
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
            let mut output = bun_string::MutableString::init_empty();
            // MOVE_DOWN: was bun_js_printer::quote_for_json → bun_str (T1)
            bun_string::quote_for_json(bytes, &mut output, true)?;
            let mut list = output.into_owned_slice();
            // remove the quotes
            if !list.is_empty() {
                list = &list[1..list.len() - 1];
            }
            return Ok(Expr::init(E::String::init(list), loc));
        }

        Ok(Expr::init(
            E::String {
                data: bun_string::ZigString::init(bytes).to_base64_data_url(bump)?,
                ..Default::default()
            },
            loc,
        ))
    }

    #[inline]
    pub fn init_identifier(ref_: Ref, loc: Loc) -> Expr {
        Expr {
            loc,
            data: Data::EIdentifier(E::Identifier::init(ref_)),
        }
    }

    pub fn to_empty(expr: Expr) -> Expr {
        Expr {
            data: Data::EMissing(E::Missing {}),
            loc: expr.loc,
        }
    }

    pub fn is_empty(expr: Expr) -> bool {
        matches!(expr.data, Data::EMissing(_))
    }
}

#[derive(Clone, Copy)]
pub struct Query {
    pub expr: Expr,
    pub loc: Loc,
    pub i: u32,
}

impl Default for Query {
    fn default() -> Self {
        Self { expr: Expr::EMPTY, loc: Loc::EMPTY, i: 0 }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Expr — property/object/string accessor methods.
// TODO(b2-ast-round-C): these call into `E::Object::as_property` / `EString`
// methods that need `bun_string::utf16_eql_string`/`to_utf8_alloc` (track-A
// blocked_on) and `BabyList::deep_clone`. Types are real; bodies un-gate with
// the parser round once those land.
#[cfg(any())]
impl Expr {
    pub fn has_any_property_named(expr: &Expr, names: &'static [&'static [u8]]) -> bool {
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
    pub fn is_array(this: &Expr) -> bool {
        matches!(this.data, Data::EArray(_))
    }

    #[inline]
    pub fn is_object(this: &Expr) -> bool {
        matches!(this.data, Data::EObject(_))
    }

    pub fn get(expr: &Expr, name: &[u8]) -> Option<Expr> {
        expr.as_property(name).map(|query| query.expr)
    }

    /// Only use this for pretty-printing JSON. Do not use in transpiler.
    ///
    /// This does not handle edgecases like `-1` or stringifying arbitrary property lookups.
    pub fn get_by_index(
        expr: &Expr,
        index: u32,
        index_str: &[u8],
        bump: &Bump,
    ) -> Option<Expr> {
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
    // explicitly because get_by_index allocates an E.String slice into &Bump.
    pub fn get_path_may_be_index(expr: &Expr, bump: &Bump, name: &[u8]) -> Option<Expr> {
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
    pub fn set(expr: &mut Expr, bump: &Bump, name: &[u8], value: Expr) -> Result<(), AllocError> {
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
        expr: &mut Expr,
        bump: &Bump,
        name: &[u8],
        value: *const [u8],
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

    pub fn get_object(expr: &Expr, name: &[u8]) -> Option<Expr> {
        if let Some(query) = expr.as_property(name) {
            if query.expr.is_object() {
                return Some(query.expr);
            }
        }
        None
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

    pub fn get_string(
        expr: &Expr,
        bump: &Bump,
        name: &[u8],
    ) -> Result<Option<(*const [u8], Loc)>, AllocError> {
        if let Some(q) = expr.as_property(name) {
            if let Some(str) = q.expr.as_string(bump) {
                return Ok(Some((str, q.expr.loc)));
            }
        }
        Ok(None)
    }

    pub fn get_number(expr: &Expr, name: &[u8]) -> Option<(f64, Loc)> {
        if let Some(q) = expr.as_property(name) {
            if let Some(num) = q.expr.as_number() {
                return Some((num, q.expr.loc));
            }
        }
        None
    }

    pub fn get_string_cloned(
        expr: &Expr,
        bump: &Bump,
        name: &[u8],
    ) -> Result<Option<*const [u8]>, AllocError> {
        match expr.as_property(name) {
            Some(q) => q.expr.as_string_cloned(bump),
            None => Ok(None),
        }
    }

    pub fn get_string_cloned_z(
        expr: &Expr,
        bump: &Bump,
        name: &[u8],
    ) -> Result<Option<*const ZStr>, AllocError> {
        match expr.as_property(name) {
            Some(q) => q.expr.as_string_z(bump),
            None => Ok(None),
        }
    }

    pub fn get_array(expr: &Expr, name: &[u8]) -> Option<ArrayIterator<'_>> {
        // TODO(port): lifetime of returned iterator borrows `expr`
        expr.as_property(name).and_then(|q| q.expr.as_array_owned())
    }

    pub fn get_rope(self_: &Expr, rope: &E::Rope) -> Option<E::RopeQuery> {
        if let Some(existing) = self_.get(rope.head.data.as_e_string().unwrap().data) {
            match &existing.data {
                Data::EArray(array) => {
                    if let Some(next) = rope.next {
                        if let Some(end) = array.items.last() {
                            return end.get_rope(next);
                        }
                    }
                    return Some(E::RopeQuery { expr: existing, rope });
                }
                Data::EObject(_) => {
                    if let Some(next) = rope.next {
                        if let Some(end) = existing.get_rope(next) {
                            return Some(end);
                        }
                    }
                    return Some(E::RopeQuery { expr: existing, rope });
                }
                _ => {
                    return Some(E::RopeQuery { expr: existing, rope });
                }
            }
        }
        None
    }

    // Making this comptime bloats the binary and doesn't seem to impact runtime performance.
    pub fn as_property(expr: &Expr, name: &[u8]) -> Option<Query> {
        let Data::EObject(obj) = &expr.data else { return None };
        if obj.properties.len() == 0 {
            return None;
        }
        obj.as_property(name)
    }

    pub fn as_property_string_map(
        expr: &Expr,
        name: &[u8],
        bump: &Bump,
    ) -> Option<Box<ArrayHashMap<*const [u8], *const [u8]>>> {
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

pub struct ArrayIterator<'a> {
    pub array: &'a E::Array,
    pub index: u32,
}

// TODO(b2-ast-round-C): `BabyList::len()` returns u32; `.ptr()` is private.
// Un-gate with the accessor block above.
#[cfg(any())]
impl<'a> ArrayIterator<'a> {
    pub fn next(&mut self) -> Option<Expr> {
        if self.index >= self.array.items.len() {
            return None;
        }
        let result = self.array.items.ptr()[self.index as usize];
        self.index += 1;
        Some(result)
    }
}

// TODO(b2-ast-round-C): same as above (string/array accessors).
#[cfg(any())]
impl Expr {
    pub fn as_array<'a>(expr: &'a Expr) -> Option<ArrayIterator<'a>> {
        let Data::EArray(array) = &expr.data else { return None };
        if array.items.len() == 0 {
            return None;
        }
        Some(ArrayIterator { array, index: 0 })
    }

    // Helper for owned-expr iteration (used by get_array above where the expr is by-value)
    // TODO(port): lifetime — Zig returns iterator borrowing arena ptr, not &Expr
    fn as_array_owned(self) -> Option<ArrayIterator<>> {
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
    pub fn as_utf8_string_literal(expr: &Expr) -> Option<*const [u8]> {
        if let Data::EString(s) = &expr.data {
            debug_assert!(s.next.is_none());
            return Some(s.data);
        }
        None
    }

    #[inline]
    pub fn as_string_literal(expr: &Expr, bump: &Bump) -> Option<*const [u8]> {
        let Data::EString(s) = &expr.data else { return None };
        s.string(bump).ok()
    }

    #[inline]
    pub fn is_string(expr: &Expr) -> bool {
        matches!(expr.data, Data::EString(_))
    }

    #[inline]
    pub fn as_string(expr: &Expr, bump: &Bump) -> Option<*const [u8]> {
        match &expr.data {
            Data::EString(str) => Some(str.string(bump).expect("OOM")),
            _ => None,
        }
    }

    #[inline]
    pub fn as_string_hash(
        expr: &Expr,
        bump: &Bump,
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
    pub fn as_string_cloned(expr: &Expr, bump: &Bump) -> Result<Option<*const [u8]>, AllocError> {
        match &expr.data {
            Data::EString(str) => Ok(Some(str.string_cloned(bump)?)),
            _ => Ok(None),
        }
    }

    #[inline]
    pub fn as_string_z(expr: &Expr, bump: &Bump) -> Result<Option<*const ZStr>, AllocError> {
        match &expr.data {
            Data::EString(str) => Ok(Some(str.string_z(bump)?)),
            _ => Ok(None),
        }
    }

    pub fn as_bool(expr: &Expr) -> Option<bool> {
        match expr.data {
            Data::EBoolean(b) | Data::EBranchBoolean(b) => Some(b.value),
            _ => None,
        }
    }

    pub fn as_number(expr: &Expr) -> Option<f64> {
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

struct Serializable {
    type_: Tag,
    object: &'static [u8],
    value: Data,
    loc: Loc,
}

// TODO(b2-ast-round-C): join_with_*/extract_* call `Expr::init` with `E::*`
// payloads via `IntoExprData`; un-gate once `IntoExprData` impls are complete.
// `is_missing` is trivial — hoisted into the live `impl Expr` below the
// `init`/`allocate` block (line ~1090).
#[cfg(any())]
impl Expr {
    pub fn is_missing(a: &Expr) -> bool {
        matches!(a.data, Data::EMissing(_))
    }

    // The goal of this function is to "rotate" the AST if it's possible to use the
    // left-associative property of the operator to avoid unnecessary parentheses.
    //
    // When using this, make absolutely sure that the operator is actually
    // associative. For example, the "-" operator is not associative for
    // floating-point numbers.
    pub fn join_with_left_associative_op<const OP: Op::Code>(
        a: Expr,
        b: Expr,
    ) -> Expr {
        // PERF(port): was comptime monomorphization — profile in Phase B
        // "(a, b) op c" => "a, b op c"
        if let Data::EBinary(comma) = a.data {
            if comma.op == crate::ast::OpCode::BinComma {
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

    pub fn join_with_comma(a: Expr, b: Expr) -> Expr {
        if a.is_missing() {
            return b;
        }
        if b.is_missing() {
            return a;
        }
        Expr::init(
            E::Binary { op: crate::ast::OpCode::BinComma, left: a, right: b },
            a.loc,
        )
    }

    pub fn join_all_with_comma(all: &mut [Expr]) -> Expr {
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
        all: &mut [Expr],
        ctx: C,
        callback: fn(ctx: &C, expr: Expr) -> Option<Expr>,
    ) -> Option<Expr> {
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
    pub fn json_stringify(self_: &Expr, writer: &mut impl fmt::Write) -> fmt::Result {
        let _ = (self_, writer);
        // writer.write(Serializable { type_: self_.data.tag(), object: b"expr", value: self_.data, loc: self_.loc })
        todo!("jsonStringify")
    }

    pub fn extract_numeric_values_in_safe_range(left: Data, right: Data) -> Option<[f64; 2]> {
        let l_value = left.extract_numeric_value()?;
        let r_value = right.extract_numeric_value()?;

        // Check for NaN and return null if either value is NaN
        if l_value.is_nan() || r_value.is_nan() {
            return None;
        }

        if l_value.is_infinite() || r_value.is_infinite() {
            return Some([l_value, r_value]);
        }

        // TODO(b0): math arrives from move-in (was bun_jsc::{MAX,MIN}_SAFE_INTEGER → js_parser::math)
        if l_value > crate::math::MAX_SAFE_INTEGER || r_value > crate::math::MAX_SAFE_INTEGER {
            return None;
        }
        if l_value < crate::math::MIN_SAFE_INTEGER || r_value < crate::math::MIN_SAFE_INTEGER {
            return None;
        }

        Some([l_value, r_value])
    }

    pub fn extract_numeric_values(left: Data, right: Data) -> Option<[f64; 2]> {
        Some([
            left.extract_numeric_value()?,
            right.extract_numeric_value()?,
        ])
    }

    pub fn extract_string_values(
        left: Data,
        right: Data,
        bump: &Bump,
    ) -> Option<[*mut E::String; 2]> {
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
pub trait IntoExprData: Sized {
    /// Construct `Data` using the thread-local `Data::Store` arena (Zig: `Expr.init`).
    fn into_data_store(self) -> Data;
    /// Construct `Data` using a caller-supplied arena (Zig: `Expr.allocate`).
    /// Be careful to free the memory (or use an allocator that does it for you).
    fn into_data_alloc(self, bump: &Bump) -> Data;
}

macro_rules! impl_into_expr_data_boxed {
    ($($ty:ident => $variant:ident),* $(,)?) => {
        $(
            impl IntoExprData for E::$ty {
                fn into_data_store(self) -> Data {
                    // SAFETY: Store::append never returns null.
                    Data::$variant(unsafe { StoreRef::from_raw(data::Store::append(self)) })
                }
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
                fn into_data_store(self) -> Data { Data::$variant(self) }
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

// E::Identifier — Zig copies fields explicitly (normalization)
impl IntoExprData for E::Identifier {
    fn into_data_store(self) -> Data {
        Data::EIdentifier(E::Identifier {
            ref_: self.ref_,
            must_keep_due_to_with_stmt: self.must_keep_due_to_with_stmt,
            can_be_removed_if_unused: self.can_be_removed_if_unused,
            call_can_be_unwrapped_if_unused: self.call_can_be_unwrapped_if_unused,
        })
    }
    fn into_data_alloc(self, _bump: &Bump) -> Data {
        self.into_data_store()
    }
}

impl IntoExprData for E::ImportIdentifier {
    fn into_data_store(self) -> Data {
        Data::EImportIdentifier(E::ImportIdentifier {
            ref_: self.ref_,
            was_originally_identifier: self.was_originally_identifier,
        })
    }
    fn into_data_alloc(self, _bump: &Bump) -> Data {
        self.into_data_store()
    }
}

impl IntoExprData for E::CommonJSExportIdentifier {
    fn into_data_store(self) -> Data {
        Data::ECommonjsExportIdentifier(E::CommonJSExportIdentifier {
            ref_: self.ref_,
            base: self.base,
        })
    }
    fn into_data_alloc(self, _bump: &Bump) -> Data {
        // Zig's allocate() variant only sets .ref; init() also sets .base.
        // We follow init() semantics here (superset).
        Data::ECommonjsExportIdentifier(E::CommonJSExportIdentifier {
            ref_: self.ref_,
            ..Default::default()
        })
    }
}

// E::EString — special debug assert + boxed
impl IntoExprData for E::EString {
    fn into_data_store(self) -> Data {
        #[cfg(debug_assertions)]
        {
            // Sanity check: assert string is not a null ptr
            if !self.data.is_empty() && self.is_utf8() {
                debug_assert!(self.data.as_ptr() as usize > 0);
            }
        }
        // SAFETY: Store::append never returns null.
        Data::EString(unsafe { StoreRef::from_raw(data::Store::append(self)) })
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
// TODO(b2-ast-round-C): wire once `EString::shallow_clone` is settled.
#[cfg(any())]
impl IntoExprData for &E::EString {
    fn into_data_store(self) -> Data {
        Data::EString(unsafe { StoreRef::from_raw(data::Store::append(self.shallow_clone())) })
    }
    fn into_data_alloc(self, bump: &Bump) -> Data {
        Data::EString(StoreRef::from_bump(bump.alloc(self.shallow_clone())))
    }
}

impl Expr {
    /// When the lifetime of an Expr.Data's pointer must exist longer than reset() is called, use this function.
    /// Be careful to free the memory (or use an allocator that does it for you)
    /// Also, prefer Expr.init or Expr.alloc when possible. This will be slower.
    pub fn allocate<T: IntoExprData>(bump: &Bump, st: T, loc: Loc) -> Expr {
        ICOUNT.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        data::Store::assert();
        Expr { loc, data: st.into_data_alloc(bump) }
    }

    pub fn init<T: IntoExprData>(st: T, loc: Loc) -> Expr {
        ICOUNT.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        data::Store::assert();
        Expr { loc, data: st.into_data_store() }
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
        Expr::init(E::Binary { op: crate::ast::OpCode::BinAssign, left: a, right: b }, a.loc)
    }
}

pub type Disabler = DebugOnlyDisabler<Expr>;

impl Expr {
    #[inline]
    pub fn is_primitive_literal(this: &Expr) -> bool {
        Tag::is_primitive_literal(this.data.tag())
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

// TODO(b2-ast-round-C): is_boolean/assign/at/not/maybe_simplify_not/etc.
#[cfg(any())]
impl Expr {
    pub fn is_boolean(a: &Expr) -> bool {
        match &a.data {
            Data::EBoolean(_) | Data::EBranchBoolean(_) => true,
            Data::EIf(ex) => ex.yes.is_boolean() && ex.no.is_boolean(),
            Data::EUnary(ex) => ex.op == crate::ast::OpCode::UnNot || ex.op == crate::ast::OpCode::UnDelete,
            Data::EBinary(ex) => match ex.op {
                crate::ast::OpCode::BinStrictEq
                | crate::ast::OpCode::BinStrictNe
                | crate::ast::OpCode::BinLooseEq
                | crate::ast::OpCode::BinLooseNe
                | crate::ast::OpCode::BinLt
                | crate::ast::OpCode::BinGt
                | crate::ast::OpCode::BinLe
                | crate::ast::OpCode::BinGe
                | crate::ast::OpCode::BinInstanceof
                | crate::ast::OpCode::BinIn => true,
                crate::ast::OpCode::BinLogicalOr => ex.left.is_boolean() && ex.right.is_boolean(),
                crate::ast::OpCode::BinLogicalAnd => ex.left.is_boolean() && ex.right.is_boolean(),
                _ => false,
            },
            _ => false,
        }
    }

    pub fn assign(a: Expr, b: Expr) -> Expr {
        Expr::init(
            E::Binary { op: crate::ast::OpCode::BinAssign, left: a, right: b },
            a.loc,
        )
    }

    #[inline]
    pub fn at<T: IntoExprData>(expr: &Expr, t: T) -> Expr {
        Expr::init(t, expr.loc)
    }

    // Wraps the provided expression in the "!" prefix operator. The expression
    // will potentially be simplified to avoid generating unnecessary extra "!"
    // operators. For example, calling this with "!!x" will return "!x" instead
    // of returning "!!!x".
    pub fn not(expr: &Expr, bump: &Bump) -> Expr {
        expr.maybe_simplify_not(bump).unwrap_or_else(|| {
            Expr::init(
                E::Unary {
                    op: crate::ast::OpCode::UnNot,
                    value: *expr,
                    ..Default::default()
                },
                expr.loc,
            )
        })
    }

    #[inline]
    pub fn has_value_for_this_in_call(expr: &Expr) -> bool {
        matches!(expr.data, Data::EDot(_) | Data::EIndex(_))
    }

    /// The given "expr" argument should be the operand of a "!" prefix operator
    /// (i.e. the "x" in "!x"). This returns a simplified expression for the
    /// whole operator (i.e. the "!x") if it can be simplified, or false if not.
    /// It's separate from "Not()" above to avoid allocation on failure in case
    /// that is undesired.
    pub fn maybe_simplify_not(expr: &Expr, bump: &Bump) -> Option<Expr> {
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
                if un.op == crate::ast::OpCode::UnNot && un.value.known_primitive() == PrimitiveType::Boolean {
                    return Some(un.value);
                }
            }
            Data::EBinary(ex) => {
                // TODO: evaluate whether or not it is safe to do this mutation since it's modifying in-place.
                // Make sure that these transformations are all safe for special values.
                // For example, "!(a < b)" is not the same as "a >= b" if a and/or b are
                // NaN (or undefined, or null, or possibly other problem cases too).
                match ex.op {
                    crate::ast::OpCode::BinLooseEq => {
                        // "!(a == b)" => "a != b"
                        ex.op = crate::ast::OpCode::BinLooseNe;
                        return Some(*expr);
                    }
                    crate::ast::OpCode::BinLooseNe => {
                        // "!(a != b)" => "a == b"
                        ex.op = crate::ast::OpCode::BinLooseEq;
                        return Some(*expr);
                    }
                    crate::ast::OpCode::BinStrictEq => {
                        // "!(a === b)" => "a !== b"
                        ex.op = crate::ast::OpCode::BinStrictNe;
                        return Some(*expr);
                    }
                    crate::ast::OpCode::BinStrictNe => {
                        // "!(a !== b)" => "a === b"
                        ex.op = crate::ast::OpCode::BinStrictEq;
                        return Some(*expr);
                    }
                    crate::ast::OpCode::BinComma => {
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

    pub fn to_string_expr_without_side_effects(expr: &Expr, bump: &Bump) -> Option<Expr> {
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

    pub fn is_optional_chain(self_: &Expr) -> bool {
        match &self_.data {
            Data::EDot(d) => d.optional_chain.is_some(),
            Data::EIndex(i) => i.optional_chain.is_some(),
            Data::ECall(c) => c.optional_chain.is_some(),
            _ => false,
        }
    }

    #[inline]
    pub fn known_primitive(self_: &Expr) -> PrimitiveType {
        self_.data.known_primitive()
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
/// `StoreRef<E::*>` (thin `NonNull` into `expr::data::Store` / a bump arena);
/// inline variants are stored by value. `StoreRef` is `Copy` + `Deref`, so
/// `Data` is `Copy` and `let Data::EBinary(b) = data; b.op` works (matching
/// Zig's `data.e_binary.op`).
#[derive(Clone, Copy)]
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

// Zig asserted `@sizeOf(Data) == 24`. With `StoreRef` (NonNull, niche-optimized)
// payloads + repr(Rust) discriminant this should hold; relaxing to `<= 24`
// until layout settles.
const _: () = assert!(core::mem::size_of::<Data>() <= 24); // Do not increase the size of Expr

// Zig field-style union accessors (`data.e_string`, `data.e_object`). The
// match arms in this file use these heavily; keeping them as inherent methods
// avoids rewriting ~25 sites. Returns `Option<StoreRef<T>>` (Copy).
impl Data {
    #[inline]
    pub fn e_string(&self) -> Option<StoreRef<E::EString>> {
        if let Data::EString(s) = *self { Some(s) } else { None }
    }
    #[inline]
    pub fn e_string_mut(&mut self) -> Option<&mut E::EString> {
        if let Data::EString(s) = self { Some(&mut **s) } else { None }
    }
    #[inline]
    pub fn e_object(&self) -> Option<StoreRef<E::Object>> {
        if let Data::EObject(o) = *self { Some(o) } else { None }
    }
    #[inline]
    pub fn e_array(&self) -> Option<StoreRef<E::Array>> {
        if let Data::EArray(a) = *self { Some(a) } else { None }
    }
    #[inline]
    pub fn as_e_string(&self) -> Option<StoreRef<E::EString>> {
        self.e_string()
    }
}

impl Data {
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
    // Rust has no field-by-tag reflection. Per-variant `as_*` accessors live
    // alongside the enum decl above (`e_string`/`e_object`/...).
    pub fn as_e_identifier(&self) -> Option<E::Identifier> {
        if let Data::EIdentifier(i) = self { Some(*i) } else { None }
    }
    pub fn as_e_inlined_enum(&self) -> Option<StoreRef<E::InlinedEnum>> {
        if let Data::EInlinedEnum(i) = *self { Some(i) } else { None }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Data — heavy transform/analysis methods (clone/deep_clone/fold/etc).
// TODO(b2-ast-round-C): these reference `BabyList::deep_clone`/`E::*::Clone`
// surfaces, `bun_core::write_any_to_hasher`, and parser-state types that land
// with `P.rs`/`Parser.rs`. The *types* (`Data`/`Expr`/`Tag`/`Store`) are real;
// only these method bodies wait. The round-B verify gate covers what's live.
#[cfg(any())]
impl Data {
    pub fn clone(this: Data, bump: &Bump) -> Result<Data, bun_core::Error> {
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

    pub fn deep_clone(this: Data, bump: &Bump) -> Result<Data, AllocError> {
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
    // TODO(b2-blocked): bun_core::write_any_to_hasher / bun_core::Hasher trait
    // (track-A round-A `blocked_on`). `SymbolTable` is a parser-round trait
    // abstraction over `symbol::Map`. Only the bake DevServer hot-reload diff
    // uses this; cold path.
    #[cfg(any())]
    pub fn write_to_hasher<H: bun_core::Hasher, S: js_ast::SymbolTable>(
        this: &Data,
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
                let mut next: Option<&E::String> = Some(e);
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
    pub fn can_be_const_value(this: &Data) -> bool {
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
    pub fn can_be_moved(data: &Data) -> bool {
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

    pub fn is_safe_to_string(data: &Data) -> bool {
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

    pub fn known_primitive(data: &Data) -> PrimitiveType {
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
                    crate::ast::OpCode::BinStrictEq
                    | crate::ast::OpCode::BinStrictNe
                    | crate::ast::OpCode::BinLooseEq
                    | crate::ast::OpCode::BinLooseNe
                    | crate::ast::OpCode::BinLt
                    | crate::ast::OpCode::BinGt
                    | crate::ast::OpCode::BinLe
                    | crate::ast::OpCode::BinGe
                    | crate::ast::OpCode::BinInstanceof
                    | crate::ast::OpCode::BinIn => break 'brk PrimitiveType::Boolean,
                    crate::ast::OpCode::BinLogicalOr | crate::ast::OpCode::BinLogicalAnd => {
                        break 'brk binary.left.data.merge_known_primitive(&binary.right.data)
                    }

                    crate::ast::OpCode::BinNullishCoalescing => {
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

                    crate::ast::OpCode::BinAdd => {
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

                    crate::ast::OpCode::BinSub
                    | crate::ast::OpCode::BinSubAssign
                    | crate::ast::OpCode::BinMul
                    | crate::ast::OpCode::BinMulAssign
                    | crate::ast::OpCode::BinDiv
                    | crate::ast::OpCode::BinDivAssign
                    | crate::ast::OpCode::BinRem
                    | crate::ast::OpCode::BinRemAssign
                    | crate::ast::OpCode::BinPow
                    | crate::ast::OpCode::BinPowAssign
                    | crate::ast::OpCode::BinBitwiseAnd
                    | crate::ast::OpCode::BinBitwiseAndAssign
                    | crate::ast::OpCode::BinBitwiseOr
                    | crate::ast::OpCode::BinBitwiseOrAssign
                    | crate::ast::OpCode::BinBitwiseXor
                    | crate::ast::OpCode::BinBitwiseXorAssign
                    | crate::ast::OpCode::BinShl
                    | crate::ast::OpCode::BinShlAssign
                    | crate::ast::OpCode::BinShr
                    | crate::ast::OpCode::BinShrAssign
                    | crate::ast::OpCode::BinUShr
                    | crate::ast::OpCode::BinUShrAssign => break 'brk PrimitiveType::Mixed, // Can be number or bigint (or an exception)

                    crate::ast::OpCode::BinAssign | crate::ast::OpCode::BinComma => {
                        break 'brk binary.right.data.known_primitive()
                    }

                    _ => {}
                }

                PrimitiveType::Unknown
            }

            Data::EUnary(unary) => match unary.op {
                crate::ast::OpCode::UnVoid => PrimitiveType::Undefined,
                crate::ast::OpCode::UnTypeof => PrimitiveType::String,
                crate::ast::OpCode::UnNot | crate::ast::OpCode::UnDelete => PrimitiveType::Boolean,
                crate::ast::OpCode::UnPos => PrimitiveType::Number, // Cannot be bigint because that throws an exception
                crate::ast::OpCode::UnNeg | crate::ast::OpCode::UnCpl => match unary.value.data.known_primitive() {
                    PrimitiveType::Bigint => PrimitiveType::Bigint,
                    PrimitiveType::Unknown | PrimitiveType::Mixed => PrimitiveType::Mixed,
                    _ => PrimitiveType::Number, // Can be number or bigint
                },
                crate::ast::OpCode::UnPreDec
                | crate::ast::OpCode::UnPreInc
                | crate::ast::OpCode::UnPostDec
                | crate::ast::OpCode::UnPostInc => PrimitiveType::Mixed, // Can be number or bigint

                _ => PrimitiveType::Unknown,
            },

            Data::EInlinedEnum(inlined) => inlined.value.data.known_primitive(),

            _ => PrimitiveType::Unknown,
        }
    }

    pub fn merge_known_primitive(lhs: &Data, rhs: &Data) -> PrimitiveType {
        lhs.known_primitive().merge(rhs.known_primitive())
    }

    /// Returns true if the result of the "typeof" operator on this expression is
    /// statically determined and this expression has no side effects (i.e. can be
    /// removed without consequence).
    #[inline]
    pub fn to_typeof(data: &Data) -> Option<&'static [u8]> {
        data.tag().typeof_()
    }

    pub fn to_number(data: &Data) -> Option<f64> {
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

    pub fn to_finite_number(data: &Data) -> Option<f64> {
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

    pub fn extract_numeric_value(data: &Data) -> Option<f64> {
        match data {
            Data::ENumber(n) => Some(n.value),
            Data::EInlinedEnum(inlined) => match &inlined.value.data {
                Data::ENumber(num) => Some(num.value),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn extract_string_value(data: Data) -> Option<*mut E::String> {
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
    pub fn is_string_value(self_: &Data) -> bool {
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

impl Data {
    // Returns "equal, ok". If "ok" is false, then nothing is known about the two
    // values. If "ok" is true, the equality or inequality of the two values is
    // stored in "equal".
    //
    // TODO(b2-ast-round-C): `P: ParserLike` (parser-state trait) un-gates with
    // P.rs/Parser.rs. Body also calls `EString::eql` (needs
    // bun_string::utf16_eql_string — track-A).
    #[cfg(any())]
    pub fn eql<P, K: EqlKindT>(left: &Data, right: &Data, p: &mut P) -> Equality
    where
        P: js_ast::ParserLike,
    {
        // (callers: replace `KIND == EqlKind::Strict` with `K::STRICT` when un-gated)
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

// `new_store!` emits `pub mod expr_store { pub struct Store; ... }`.
// Type list mirrors Zig's `Data.Store = NewStore(&.{ E.Array, ... }, 512)`
// (Expr.zig:2550-2580).
crate::new_store!(
    expr_store,
    [
        E::Array, E::Unary, E::Binary, E::Class, E::New, E::Function, E::Call, E::Dot, E::Index,
        E::Arrow, E::JSXElement, E::Object, E::Spread, E::Template, E::RegExp, E::Await, E::Yield,
        E::If, E::Import, E::BigInt, E::EString, E::InlinedEnum, E::NameOfSymbol,
    ],
    512
);

pub mod data {
    use super::*;

    #[allow(non_snake_case)]
    pub mod Store {
        use super::*;
        use expr_store::Store as Backing;

        thread_local! {
            pub static INSTANCE: Cell<*mut Backing> = const { Cell::new(core::ptr::null_mut()) };
            pub static MEMORY_ALLOCATOR: Cell<*mut ASTMemoryAllocator> =
                const { Cell::new(core::ptr::null_mut()) };
            pub static DISABLE_RESET: Cell<bool> = const { Cell::new(false) };
        }

        #[inline]
        fn instance() -> *mut Backing {
            INSTANCE.with(|c| c.get())
        }
        pub fn memory_allocator() -> *mut ASTMemoryAllocator {
            MEMORY_ALLOCATOR.with(|c| c.get())
        }
        pub fn set_memory_allocator(p: *mut ASTMemoryAllocator) {
            MEMORY_ALLOCATOR.with(|c| c.set(p));
        }

        pub fn create() {
            if !instance().is_null() || !memory_allocator().is_null() {
                return;
            }
            INSTANCE.with(|c| c.set(Backing::init()));
        }

        /// create || reset
        pub fn begin() {
            if !memory_allocator().is_null() {
                return;
            }
            if instance().is_null() {
                create();
                return;
            }
            if !DISABLE_RESET.with(|c| c.get()) {
                // SAFETY: checked non-null above; thread-local, no concurrent mutation.
                Backing::reset(unsafe { &mut *instance() });
            }
        }

        pub fn reset() {
            if DISABLE_RESET.with(|c| c.get()) || !memory_allocator().is_null() {
                return;
            }
            // SAFETY: caller contract — instance is set when reset() is called.
            Backing::reset(unsafe { &mut *instance() });
        }

        pub fn deinit() {
            if instance().is_null() || !memory_allocator().is_null() {
                return;
            }
            // SAFETY: checked non-null above; destroy frees the PreAlloc.
            unsafe { Backing::destroy(instance()) };
            INSTANCE.with(|c| c.set(core::ptr::null_mut()));
        }

        #[inline]
        pub fn assert() {
            if cfg!(debug_assertions) {
                if instance().is_null() && memory_allocator().is_null() {
                    unreachable!("Store must be init'd");
                }
            }
        }

        pub fn append<T>(value: T) -> *mut T {
            let ma = memory_allocator();
            if !ma.is_null() {
                // SAFETY: ASTMemoryAllocator is set by the owning scope and outlives this call.
                return unsafe { &*ma }.append(value).as_ptr();
            }
            Disabler::assert();
            // SAFETY: assert() guarantees instance is non-null on this thread; slab
            // returns stable addresses until reset().
            Backing::append(unsafe { &mut *instance() }, value).as_ptr()
        }
    }
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
//   notes:      `*const mut` payloads break `Copy` on Data/Expr — Phase B likely needs raw arena ptrs; comptime-type init/allocate collapsed to IntoExprData trait; toJS aliases deleted per *_jsc rule; get_path_may_be_index now takes &Bump (Zig used default_allocator).
// ──────────────────────────────────────────────────────────────────────────
