use crate::ast::base::{Ref, RefExt as _};
use crate::ast::binding::Binding;
use crate::ast::expr::Expr;
use crate::{flags, ExprNodeIndex};
// Re-exported so callers can spell `js_ast::b::ArrayBinding` (Zig: `B.Array.Item`).
pub use crate::ArrayBinding;

/// B is for Binding! Bindings are on the left side of variable
/// declarations (s_local), which is how destructuring assignments
/// are represented in memory. Consider a basic example.
///
///     let hello = world;
///         ^       ^
///         |       E.Identifier
///         B.Identifier
///
/// Bindings can be nested
///
///                B.Array
///                | B.Identifier
///                | |
///     let { foo: [ bar ] } = ...
///         ----------------
///         B.Object
// Zig: `union(Binding.Tag)` — tag enum lives on `Binding::Tag`.
// PORT NOTE: arena ptrs are raw `*mut` in Phase A (LIFETIMES.tsv: ARENA → raw);
// 'bump threaded crate-wide in Phase B (`&'bump mut T`).
#[derive(Copy, Clone)]
pub enum B {
    // let x = ...
    BIdentifier(*mut Identifier),
    // let [a, b] = ...
    BArray(*mut Array),
    // let { a, b: c } = ...
    BObject(*mut Object),
    // this is used to represent array holes
    BMissing(Missing),
}

impl Default for B {
    fn default() -> Self {
        B::BMissing(Missing {})
    }
}

// ── Layout guards ─────────────────────────────────────────────────────────
// Three pointer variants (8 bytes each) + one ZST → repr(Rust) packs the
// discriminant into the pointer word's padding for `B` = 16. `Binding` =
// `B` (16, align 8) + `Loc` (i32) → 20 → 24. Unlike `expr::Data`/`stmt::Data`
// these payloads are still raw `*mut T` (no NonNull niche), but the enum
// itself has spare discriminant values so `Option<B>` stays 16 — the niche
// assert below locks that in. Converting to `StoreRef<T>` (NonNull) is the
// follow-up that also drops the `unsafe { &*ptr }` boilerplate at ~60 match
// sites; it does not change these sizes.
const _: () = assert!(core::mem::size_of::<B>() == 16);
const _: () = assert!(core::mem::size_of::<super::binding::Binding>() == 24);
const _: () = assert!(
    core::mem::size_of::<Option<B>>() == core::mem::size_of::<B>(),
    "B lost its niche — check for #[repr] or oversized inline payload"
);

pub struct Identifier {
    pub r#ref: Ref,
}

pub struct Property {
    pub flags: flags::PropertySet,
    pub key: ExprNodeIndex,
    pub value: Binding,
    pub default_value: Option<Expr>,
}
// TODO(port): partial defaults — Zig only defaults `flags`/`default_value`; `key`/`value` have none, so no `impl Default`.

pub struct Object {
    pub properties: crate::StoreSlice<Property>,
    pub is_single_line: bool,
}
// Zig: `pub const Property = B.Property;` — inherent associated type alias.
// TODO(port): inherent associated types are unstable; callers use `B::Property` directly.
// TODO(port): partial defaults — Zig only defaults `is_single_line`; `properties` has none, so no `impl Default`.

pub struct Array {
    pub items: crate::StoreSlice<ArrayBinding>,
    pub has_spread: bool,
    pub is_single_line: bool,
}
// Zig: `pub const Item = ArrayBinding;` — inherent associated type alias.
// TODO(port): inherent associated types are unstable; callers use `ArrayBinding` directly.
// TODO(port): partial defaults — Zig only defaults `has_spread`/`is_single_line`; `items` has none, so no `impl Default`.

#[derive(Default, Copy, Clone)]
pub struct Missing {}

// Ergonomic slice accessors so P-helpers can `for item in arr.items()`.
// `&mut self` establishes uniqueness for the `slice_mut()` SAFETY contract
// (single-threaded parser; arena slice valid for `'a`).
impl Array {
    #[inline]
    pub fn items(&self) -> &[ArrayBinding] { self.items.slice() }
    #[inline]
    pub fn items_mut(&mut self) -> &mut [ArrayBinding] {
        // SAFETY: exclusive via `&mut self`; arena-owned slice valid for self's lifetime.
        unsafe { self.items.slice_mut() }
    }
}
impl Object {
    #[inline]
    pub fn properties(&self) -> &[Property] { self.properties.slice() }
    #[inline]
    pub fn properties_mut(&mut self) -> &mut [Property] {
        // SAFETY: exclusive via `&mut self`; arena-owned slice valid for self's lifetime.
        unsafe { self.properties.slice_mut() }
    }
}

impl B {
    // Zig: `union(Binding.Tag)` — Phase B should ensure `Binding::Tag` discriminants
    // match this enum's variant order so `tag()` stays a transmute/match.
    pub fn tag(&self) -> super::binding::Tag {
        use super::binding::Tag;
        match self {
            B::BIdentifier(_) => Tag::BIdentifier,
            B::BArray(_) => Tag::BArray,
            B::BObject(_) => Tag::BObject,
            B::BMissing(_) => Tag::BMissing,
        }
    }

    /// This hash function is currently only used for React Fast Refresh transform.
    /// This doesn't include the `is_single_line` properties, as they only affect whitespace.
    pub fn write_to_hasher<H, S>(&self, hasher: &mut H, symbol_table: &mut S)
    where
        H: bun_core::Hasher + ?Sized,
        S: crate::ast::base::SymbolTable + ?Sized,
        // PORT NOTE: `symbol_table: anytype` — forwarded to `Ref::get_symbol` and
        // `Expr::Data::write_to_hasher`; bound mirrors `Expr::Data::write_to_hasher`.
    {
        // Local mirror of `bun.writeAnyToHasher` for arbitrary `Copy` POD —
        // `bun_core::write_any_to_hasher` is bound by `AsBytes` (ints only) and
        // we cannot impl that trait for tuples/`Tag` from this crate-file scope.
        // Mirrors Zig `hasher.update(std.mem.asBytes(&thing))`.
        #[inline(always)]
        fn raw<H: bun_core::Hasher + ?Sized, T: Copy>(h: &mut H, v: T) {
            // SAFETY: `T: Copy` ⇒ no drop glue / no interior refs; we read
            // exactly size_of::<T> initialized bytes from `v`'s stack slot.
            h.update(unsafe {
                core::slice::from_raw_parts(
                    core::ptr::addr_of!(v).cast::<u8>(),
                    core::mem::size_of::<T>(),
                )
            });
        }
        match self {
            B::BIdentifier(id) => {
                // SAFETY: arena-owned `B::Identifier` valid for parser arena lifetime.
                let ref_ = unsafe { (**id).r#ref };
                // SAFETY: `original_name` is an arena-owned slice valid for the
                // parser/AST arena that `symbol_table` borrows from.
                let original_name = ref_.get_symbol(symbol_table).original_name.slice();
                raw(hasher, (self.tag(), original_name.len()));
            }
            B::BArray(array) => {
                // SAFETY: arena-owned `B::Array` valid for parser arena lifetime.
                let array = unsafe { &**array };
                raw(hasher, (self.tag(), array.has_spread, array.items().len()));
                for item in array.items().iter() {
                    raw(hasher, (item.default_value.is_some(),));
                    if let Some(default) = &item.default_value {
                        default.data.write_to_hasher(hasher, symbol_table);
                    }
                    item.binding.data.write_to_hasher(hasher, symbol_table);
                }
            }
            B::BObject(object) => {
                // SAFETY: arena-owned `B::Object` valid for parser arena lifetime.
                let object = unsafe { &**object };
                raw(hasher, (self.tag(), object.properties().len()));
                for property in object.properties().iter() {
                    raw(hasher, (property.default_value.is_some(), property.flags));
                    if let Some(default) = &property.default_value {
                        default.data.write_to_hasher(hasher, symbol_table);
                    }
                    property.key.data.write_to_hasher(hasher, symbol_table);
                    property.value.data.write_to_hasher(hasher, symbol_table);
                }
            }
            B::BMissing(_) => {}
        }
    }
}

// Keep `Binding` referenced (it's the conceptual tag-host of `B`).
#[allow(dead_code)]
type _BindingTagHost = Binding;

pub use crate::ast::g::Class;

// ported from: src/js_parser/ast/B.zig
