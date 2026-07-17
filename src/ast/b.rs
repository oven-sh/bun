use crate::StoreRef;
use crate::base::Ref;
use crate::binding::Binding;
use crate::expr::Expr;
use crate::{ExprNodeIndex, flags};
// Re-exported so callers can spell `js_ast::b::ArrayBinding`.
pub use crate::ArrayBinding;

/// B is for Binding! Bindings are on the left side of variable
/// declarations (s_local), which is how destructuring assignments
/// are represented in memory. Consider a basic example.
///
/// ```text
/// let hello = world;
///     ^       ^
///     |       E.Identifier
///     B.Identifier
/// ```
///
/// Bindings can be nested
///
/// ```text
///            B.Array
///            | B.Identifier
///            | |
/// let { foo: [ bar ] } = ...
///     ----------------
///     B.Object
/// ```
// The tag enum lives on `Binding::Tag`.
// Arena values are referenced via `StoreRef<T>` (LIFETIMES.tsv: ARENA)
// rather than a threaded `&'bump mut T`.
#[derive(Copy, Clone, bun_core::EnumTag)]
#[enum_tag(existing = super::binding::Tag)]
pub enum B {
    // let x = ...
    BIdentifier(StoreRef<Identifier>),
    // let [a, b] = ...
    BArray(StoreRef<Array>),
    // let { a, b: c } = ...
    BObject(StoreRef<Object>),
    // this is used to represent array holes
    BMissing(Missing),
}

impl Default for B {
    fn default() -> Self {
        B::BMissing(Missing {})
    }
}

// ── Layout guards ─────────────────────────────────────────────────────────
// Three `StoreRef<T>` variants (8 B align 4) + one ZST → 1-byte discriminant
// + 8-byte payload = 9, align(4) rounds to 12. `Binding` = `B` (12, align 4)
// + `Loc` (i32) → 16. `Option<B>` niche-packs via spare discriminant values.
const _: () = assert!(core::mem::size_of::<B>() == 12);
const _: () = assert!(core::mem::align_of::<B>() == 4);
const _: () = assert!(core::mem::size_of::<super::binding::Binding>() == 16);
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
// No `impl Default` on purpose: only `flags`/`default_value` have sensible
// defaults; `key`/`value` do not, so every constructor must supply them.

pub struct Object {
    pub properties: crate::StoreSlice<Property>,
    pub is_single_line: bool,
}
// No `impl Default` on purpose: only `is_single_line` has a sensible default;
// `properties` does not, so every constructor must supply it.

pub struct Array {
    pub items: crate::StoreSlice<ArrayBinding>,
    pub has_spread: bool,
    pub is_single_line: bool,
}
// No `impl Default` on purpose: only `has_spread`/`is_single_line` have
// sensible defaults; `items` does not, so every constructor must supply it.

#[derive(Default, Copy, Clone)]
pub struct Missing {}

// Ergonomic slice accessors so P-helpers can `for item in arr.items()`.
// `&mut self` establishes uniqueness for the `slice_mut()` SAFETY contract
// (single-threaded parser; arena slice valid for `'a`).
impl Array {
    #[inline]
    pub fn items(&self) -> &[ArrayBinding] {
        self.items.slice()
    }
    #[inline]
    pub fn items_mut(&mut self) -> &mut [ArrayBinding] {
        self.items.slice_mut()
    }
}
impl Object {
    #[inline]
    pub fn properties(&self) -> &[Property] {
        self.properties.slice()
    }
    #[inline]
    pub fn properties_mut(&mut self) -> &mut [Property] {
        self.properties.slice_mut()
    }
}

impl B {
    /// This hash function is currently only used for React Fast Refresh transform.
    /// This doesn't include the `is_single_line` properties, as they only affect whitespace.
    pub fn write_to_hasher<H, S>(&self, hasher: &mut H, symbol_table: &mut S)
    where
        H: bun_core::Hasher + ?Sized,
        S: crate::base::SymbolTable + ?Sized,
        // `symbol_table: anytype` — forwarded to `Ref::get_symbol` and
        // `Expr::Data::write_to_hasher`; bound mirrors `Expr::Data::write_to_hasher`.
    {
        // Local mirror of `bun.writeAnyToHasher`. Rust tuples have
        // *uninitialized* padding bytes (e.g. `(Tag /*u8*/, usize)` has 7 on
        // 64-bit), so forming a `&[u8]` over them is UB. Instead we feed each
        // scalar field individually and bound on `NoUninit` so the compiler
        // proves every byte is initialized — same pattern as
        // `expr::Data::write_to_hasher`. The hash is only used in-process for
        // React Fast Refresh.
        #[inline(always)]
        fn raw<H: bun_core::Hasher + ?Sized, T: bun_core::NoUninit>(h: &mut H, v: T) {
            h.update(bun_core::bytes_of(&v));
        }
        match self {
            B::BIdentifier(id) => {
                let ref_ = id.r#ref;
                // `original_name` is an arena-owned slice valid for the
                // parser/AST arena that `symbol_table` borrows from.
                let original_name = ref_.get_symbol(symbol_table).original_name.slice();
                raw(hasher, self.tag() as u8);
                raw(hasher, original_name.len());
            }
            B::BArray(array) => {
                raw(hasher, self.tag() as u8);
                raw(hasher, array.has_spread);
                raw(hasher, array.items().len());
                for item in array.items().iter() {
                    raw(hasher, item.default_value.is_some());
                    if let Some(default) = &item.default_value {
                        default.data.write_to_hasher(hasher, symbol_table);
                    }
                    item.binding.data.write_to_hasher(hasher, symbol_table);
                }
            }
            B::BObject(object) => {
                raw(hasher, self.tag() as u8);
                raw(hasher, object.properties().len());
                for property in object.properties().iter() {
                    raw(hasher, property.default_value.is_some());
                    raw(hasher, property.flags.as_u8());
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
type _BindingTagHost = Binding;

pub use crate::g::Class;
