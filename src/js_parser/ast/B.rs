use crate::ast::{ArrayBinding, Binding, Expr, ExprNodeIndex, Flags, G, Ref};
use bun_core::write_any_to_hasher;

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
pub enum B<'a> {
    // let x = ...
    BIdentifier(&'a mut Identifier),
    // let [a, b] = ...
    BArray(&'a mut Array<'a>),
    // let { a, b: c } = ...
    BObject(&'a mut Object<'a>),
    // this is used to represent array holes
    BMissing(Missing),
}

pub struct Identifier {
    pub r#ref: Ref,
}

pub struct Property {
    pub flags: Flags::Property::Set,
    pub key: ExprNodeIndex,
    pub value: Binding,
    pub default_value: Option<Expr>,
}

impl Default for Property {
    fn default() -> Self {
        Self {
            flags: Flags::Property::NONE,
            key: ExprNodeIndex::default(),
            value: Binding::default(),
            default_value: None,
        }
    }
}

pub struct Object<'a> {
    pub properties: &'a mut [Property],
    pub is_single_line: bool,
}
// Zig: `pub const Property = B.Property;` — inherent associated type alias.
// TODO(port): inherent associated types are unstable; callers use `B::Property` directly.

impl<'a> Default for Object<'a> {
    fn default() -> Self {
        Self { properties: &mut [], is_single_line: false }
    }
}

pub struct Array<'a> {
    pub items: &'a mut [ArrayBinding],
    pub has_spread: bool,
    pub is_single_line: bool,
}
// Zig: `pub const Item = ArrayBinding;` — inherent associated type alias.
// TODO(port): inherent associated types are unstable; callers use `ArrayBinding` directly.

impl<'a> Default for Array<'a> {
    fn default() -> Self {
        Self { items: &mut [], has_spread: false, is_single_line: false }
    }
}

#[derive(Default)]
pub struct Missing {}

impl<'a> B<'a> {
    // TODO(port): `union(Binding.Tag)` — Phase B should ensure `Binding::Tag` discriminants
    // match this enum's variant order so `tag()` stays a transmute/match.
    fn tag(&self) -> Binding::Tag {
        match self {
            B::BIdentifier(_) => Binding::Tag::BIdentifier,
            B::BArray(_) => Binding::Tag::BArray,
            B::BObject(_) => Binding::Tag::BObject,
            B::BMissing(_) => Binding::Tag::BMissing,
        }
    }

    /// This hash function is currently only used for React Fast Refresh transform.
    /// This doesn't include the `is_single_line` properties, as they only affect whitespace.
    pub fn write_to_hasher<H: core::hash::Hasher, S>(&self, hasher: &mut H, symbol_table: S)
    where
        S: Copy,
        // TODO(port): `symbol_table: anytype` — only forwarded to `Ref::get_symbol` and
        // `Expr::Data::write_to_hasher`; bound by whatever trait those settle on in Phase B.
    {
        match self {
            B::BIdentifier(id) => {
                let original_name = id.r#ref.get_symbol(symbol_table).original_name;
                write_any_to_hasher(hasher, (self.tag(), original_name.len()));
            }
            B::BArray(array) => {
                write_any_to_hasher(hasher, (self.tag(), array.has_spread, array.items.len()));
                for item in array.items.iter() {
                    write_any_to_hasher(hasher, (item.default_value.is_some(),));
                    if let Some(default) = &item.default_value {
                        default.data.write_to_hasher(hasher, symbol_table);
                    }
                    item.binding.data.write_to_hasher(hasher, symbol_table);
                }
            }
            B::BObject(object) => {
                write_any_to_hasher(hasher, (self.tag(), object.properties.len()));
                for property in object.properties.iter() {
                    write_any_to_hasher(
                        hasher,
                        (property.default_value.is_some(), property.flags),
                    );
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

pub use crate::ast::G::Class;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/B.zig (104 lines)
//   confidence: medium
//   todos:      4
//   notes:      arena lifetimes <'a> per LIFETIMES.tsv; nested type aliases (Object::Property, Array::Item) dropped pending inherent-assoc-types; symbol_table anytype left as unbounded generic
// ──────────────────────────────────────────────────────────────────────────
