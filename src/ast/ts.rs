use crate::Loc;
use bun_collections::StringArrayHashMap;

use crate::base::Ref;
use crate::e::String as EString;

/// This is for TypeScript "enum" and "namespace" blocks. Each block can
/// potentially be instantiated multiple times. The exported members of each
/// block are merged into a single namespace while the non-exported code is
/// still scoped to just within that block:
///
///    let x = 1;
///    namespace Foo {
///      let x = 2;
///      export let y = 3;
///    }
///    namespace Foo {
///      console.log(x); // 1
///      console.log(y); // 3
///    }
///
/// Doing this also works inside an enum:
///
///    enum Foo {
///      A = 3,
///      B = A + 1,
///    }
///    enum Foo {
///      C = A + 2,
///    }
///    console.log(Foo.B) // 4
///    console.log(Foo.C) // 5
///
/// This is a form of identifier lookup that works differently than the
/// hierarchical scope-based identifier lookup in JavaScript. Lookup now needs
/// to search sibling scopes in addition to parent scopes. This is accomplished
/// by sharing the map of exported members between all matching sibling scopes.
// PORT NOTE: 'arena lifetime dropped — `EnumString` payload uses *const EString
// (LIFETIMES.tsv ARENA → raw ptr in Phase A; Phase B threads 'bump crate-wide).
pub struct TSNamespaceScope {
    /// This is specific to this namespace block. It's the argument of the
    /// immediately-invoked function expression that the namespace block is
    /// compiled into:
    ///
    ///   var ns;
    ///   (function (ns2) {
    ///     ns2.x = 123;
    ///   })(ns || (ns = {}));
    ///
    /// This variable is "ns2" in the above example. It's the symbol to use when
    /// generating property accesses off of this namespace when it's in scope.
    pub arg_ref: Ref,

    /// This is shared between all sibling namespace blocks
    // LIFETIMES.tsv: ARENA — p.arena.create(Pair); &pair.map; shared across
    // sibling scopes. `StoreRef` (arena back-pointer with safe `Deref`) so
    // callers don't open-code `unsafe { &mut *exported_members }` at every use.
    pub exported_members: crate::nodes::StoreRef<TSNamespaceMemberMap>,

    /// This is a lazily-generated map of identifiers that actually represent
    /// property accesses to this namespace's properties. For example:
    ///
    ///   namespace x {
    ///     export let y = 123
    ///   }
    ///   namespace x {
    ///     export let z = y
    ///   }
    ///
    /// This should be compiled into the following code:
    ///
    ///   var x;
    ///   (function(x2) {
    ///     x2.y = 123;
    ///   })(x || (x = {}));
    ///   (function(x3) {
    ///     x3.z = x3.y;
    ///   })(x || (x = {}));
    ///
    /// When we try to find the symbol "y", we instead return one of these lazily
    /// generated proxy symbols that represent the property access "x3.y". This
    /// map is unique per namespace block because "x3" is the argument symbol that
    /// is specific to that particular namespace block.
    // Zig default: `= .{}` — callers should init with `StringArrayHashMap::default()`.
    pub property_accesses: StringArrayHashMap<Ref>,

    /// Even though enums are like namespaces and both enums and namespaces allow
    /// implicit references to properties of sibling scopes, they behave like
    /// separate, er, namespaces. Implicit references only work namespace-to-
    /// namespace and enum-to-enum. They do not work enum-to-namespace. And I'm
    /// not sure what's supposed to happen for the namespace-to-enum case because
    /// the compiler crashes: https://github.com/microsoft/TypeScript/issues/46891.
    /// So basically these both work:
    ///
    ///   enum a { b = 1 }
    ///   enum a { c = b }
    ///
    ///   namespace x { export let y = 1 }
    ///   namespace x { export let z = y }
    ///
    /// This doesn't work:
    ///
    ///   enum a { b = 1 }
    ///   namespace a { export let c = b }
    ///
    /// And this crashes the TypeScript compiler:
    ///
    ///   namespace a { export let b = 1 }
    ///   enum a { c = b }
    ///
    /// Therefore we only allow enum/enum and namespace/namespace interactions.
    pub is_enum_scope: bool,
}

pub type TSNamespaceMemberMap = StringArrayHashMap<TSNamespaceMember>;

pub struct TSNamespaceMember {
    pub loc: Loc,
    pub data: Data,
}

#[derive(Clone, Copy)]
pub enum Data {
    /// "namespace ns { export let it }"
    Property,
    /// "namespace ns { export namespace it {} }"
    // LIFETIMES.tsv: ARENA — assigned from ts_namespace.exported_members (parser-arena alloc)
    Namespace(crate::nodes::StoreRef<TSNamespaceMemberMap>),
    /// "enum ns { it }"
    EnumNumber(f64),
    /// "enum ns { it = 'it' }"
    // LIFETIMES.tsv: ARENA — assigned from Expr.Data.e_string payload (AST Expr store).
    // TODO(port): &'bump EString once 'bump threaded crate-wide.
    EnumString(crate::nodes::StoreRef<EString>),
    /// "enum ns { it = something() }"
    EnumProperty,
}

impl Data {
    pub fn is_enum(&self) -> bool {
        // PORT NOTE: Zig used `inline else` + comptime `@tagName` prefix check ("enum_").
        // Expanded to an explicit match over the enum_* variants.
        matches!(
            self,
            Data::EnumNumber(_) | Data::EnumString(_) | Data::EnumProperty
        )
    }
}

// ── TypeScript::Metadata ───────────────────────────────────────────────────
// Decorator-metadata type tag attached to `G.Property` / `G.FnArg` / `G.Fn`.
// Data-only; the parser-state predicates that depend on `P` stay in
// `bun_js_parser::typescript`.

#[derive(Clone)]
pub enum Metadata {
    MNone,

    MNever,
    MUnknown,
    MAny,
    MVoid,
    MNull,
    MUndefined,
    MFunction,
    MArray,
    MBoolean,
    MString,
    MObject,
    MNumber,
    MBigint,
    MSymbol,
    MPromise,
    MIdentifier(Ref),
    // TODO(port): Zig used `std.ArrayListUnmanaged(Ref)`. This is an AST crate;
    // if this list is arena-backed in practice, switch to
    // `bun_alloc::ArenaVec<'bump, Ref>`.
    MDot(Vec<Ref>),
}

impl Default for Metadata {
    fn default() -> Self {
        Metadata::MNone
    }
}

impl Metadata {
    pub const DEFAULT: Self = Metadata::MNone;

    // the logic in finish_union, merge_union, finish_intersection and merge_intersection is
    // translated from:
    // https://github.com/microsoft/TypeScript/blob/e0a324b0503be479f2b33fd2e17c6e86c94d1297/src/compiler/transformers/typeSerializer.ts#L402

    /// Return the final union type if possible, or return None to continue merging.
    ///
    /// If the current type is MNever, MNull, or MUndefined assign the current type
    /// to MNone and return None to ensure it's always replaced by the next type.
    /// `load_name`: closure form of `p.load_name_from_ref` to avoid coupling Metadata to P.
    pub fn finish_union<'b, F: Fn(Ref) -> &'b [u8]>(&mut self, load_name: F) -> Option<Self> {
        let current = self;
        match current {
            Metadata::MIdentifier(r) => {
                if load_name(*r) == b"Object" {
                    return Some(Metadata::MObject);
                }
                None
            }

            Metadata::MUnknown | Metadata::MAny | Metadata::MObject => Some(Metadata::MObject),

            Metadata::MNever | Metadata::MNull | Metadata::MUndefined => {
                *current = Metadata::MNone;
                None
            }

            _ => None,
        }
    }

    pub fn merge_union(&mut self, left: Self) {
        let result = self;
        if !matches!(left, Metadata::MNone) {
            if core::mem::discriminant(result) != core::mem::discriminant(&left) {
                *result = match result {
                    Metadata::MNever | Metadata::MUndefined | Metadata::MNull => left,

                    _ => Metadata::MObject,
                };
            } else {
                // PORT NOTE: reshaped for borrowck — copy Ref out before reassigning *result
                if let Metadata::MIdentifier(r) = result {
                    let r = *r;
                    if let Metadata::MIdentifier(l) = left {
                        if !r.eql(l) {
                            *result = Metadata::MObject;
                        }
                    }
                }
            }
        } else {
            // always take the next value if left is MNone
        }
    }

    /// Return the final intersection type if possible, or return None to continue merging.
    ///
    /// If the current type is MUnknown, MNull, or MUndefined assign the current type
    /// to MNone and return None to ensure it's always replaced by the next type.
    pub fn finish_intersection<'b, F: Fn(Ref) -> &'b [u8]>(
        &mut self,
        load_name: F,
    ) -> Option<Self> {
        let current = self;
        match current {
            Metadata::MIdentifier(r) => {
                if load_name(*r) == b"Object" {
                    return Some(Metadata::MObject);
                }
                None
            }

            // ensure MNever is the final type
            Metadata::MNever => Some(Metadata::MNever),

            Metadata::MAny | Metadata::MObject => Some(Metadata::MObject),

            Metadata::MUnknown | Metadata::MNull | Metadata::MUndefined => {
                *current = Metadata::MNone;
                None
            }

            _ => None,
        }
    }

    pub fn merge_intersection(&mut self, left: Self) {
        let result = self;
        if !matches!(left, Metadata::MNone) {
            if core::mem::discriminant(result) != core::mem::discriminant(&left) {
                *result = match result {
                    Metadata::MUnknown | Metadata::MUndefined | Metadata::MNull => left,

                    // ensure MNever is the final type
                    Metadata::MNever => Metadata::MNever,

                    _ => Metadata::MObject,
                };
            } else {
                // PORT NOTE: reshaped for borrowck — copy Ref out before reassigning *result
                if let Metadata::MIdentifier(r) = result {
                    let r = *r;
                    if let Metadata::MIdentifier(l) = left {
                        if !r.eql(l) {
                            *result = Metadata::MObject;
                        }
                    }
                }
            }
        } else {
            // make sure intersection of only MUnknown serializes to "undefined"
            // instead of "Object"
            if matches!(result, Metadata::MUnknown) {
                *result = Metadata::MUndefined;
            }
        }
    }
}

// Zig file ends with `pub const Class = G.Class;` — re-export.
pub use crate::g::Class;

// ported from: src/js_parser/ast/TS.zig
