use crate::StoreRef;
use crate::base::Ref;
use crate::binding::Binding;
use crate::expr::Expr;
use crate::{ArrayBinding, ExprNodeIndex, flags};

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
#[derive(Copy, Clone, bun_core::EnumTag)]
#[enum_tag(existing = super::binding::Tag)]
pub enum B<'a> {
    // let x = ...
    BIdentifier(StoreRef<'a, Identifier>),
    // let [a, b] = ...
    BArray(StoreRef<'a, Array<'a>>),
    // let { a, b: c } = ...
    BObject(StoreRef<'a, Object<'a>>),
    // this is used to represent array holes
    BMissing(Missing),
}

impl Default for B<'_> {
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

pub struct Property<'a> {
    pub flags: flags::PropertySet,
    pub key: ExprNodeIndex<'a>,
    pub value: Binding<'a>,
    pub default_value: Option<Expr<'a>>,
}
// No `impl Default` on purpose: only `flags`/`default_value` have sensible
// defaults; `key`/`value` do not, so every constructor must supply them.

pub struct Object<'a> {
    pub properties: crate::StoreSlice<'a, Property<'a>>,
    pub is_single_line: bool,
    pub close_brace_loc: crate::Loc,
}
// No `impl Default` on purpose: only `is_single_line`/`close_brace_loc` have
// sensible defaults; `properties` does not, so every constructor must supply it.

pub struct Array<'a> {
    pub items: crate::StoreSlice<'a, ArrayBinding<'a>>,
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
impl<'a> Array<'a> {
    #[inline]
    pub fn items(&self) -> &[ArrayBinding<'a>] {
        self.items.slice()
    }
    #[inline]
    pub fn items_mut(&mut self) -> &mut [ArrayBinding<'a>] {
        self.items.slice_mut()
    }
}
impl<'a> Object<'a> {
    #[inline]
    pub fn properties(&self) -> &[Property<'a>] {
        self.properties.slice()
    }
    #[inline]
    pub fn properties_mut(&mut self) -> &mut [Property<'a>] {
        self.properties.slice_mut()
    }
}

impl B<'_> {
    /// This hash function is currently only used for React Fast Refresh transform.
    /// This doesn't include the `is_single_line` properties, as they only affect whitespace.
    pub fn write_to_hasher<H, S>(&self, hasher: &mut H, symbol_table: &S)
    where
        H: bun_core::Hasher + ?Sized,
        S: crate::base::SymbolTable + ?Sized,
        // `symbol_table: anytype` — forwarded to `Ref::get_symbol` and
        // `Expr::Data::write_to_hasher`; bound mirrors `Expr::Data::write_to_hasher`.
    {
        // Each scalar is fed on its own: a tuple of them would have padding.
        use bun_core::write_any_to_hasher as raw;
        match self {
            B::BIdentifier(id) => {
                let ref_ = id.r#ref;
                let original_name = ref_.get_symbol(symbol_table).original_name.slice();
                raw(hasher, self.tag() as u8);
                raw(hasher, original_name.len());
                hasher.update(original_name);
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
