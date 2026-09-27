use crate::Loc;
use bun_alloc::AstAlloc;
use bun_collections::StringArrayHashMap;
use bun_collections::array_hash_map::StringContext;

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
// The `EnumString` payload is a `StoreRef<EString>` (AST-store back-pointer)
// rather than an arena-borrowed reference, matching the rest of the AST crate.
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
    pub property_accesses: StringArrayHashMap<Ref, StringContext, AstAlloc>,

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

pub type TSNamespaceMemberMap = StringArrayHashMap<TSNamespaceMember, StringContext, AstAlloc>;

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
    EnumString(crate::nodes::StoreRef<EString>),
    /// "enum ns { it = something() }"
    EnumProperty,
}

impl Data {
    pub fn is_enum(&self) -> bool {
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

/// How the parser emits `design:*` metadata for legacy decorators. This is
/// tsconfig's `emitDecoratorMetadata` widened with the effective
/// `strictNullChecks` value, because tsc's type serializer reads both.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub enum DecoratorMetadata {
    /// `emitDecoratorMetadata` is off.
    #[default]
    Off = 0,
    /// `emitDecoratorMetadata` is on and `strictNullChecks` is off.
    Loose = 1,
    /// `emitDecoratorMetadata` is on and `strictNullChecks` is on.
    Strict = 2,
}

impl DecoratorMetadata {
    pub const fn new(emit_decorator_metadata: bool, strict_null_checks: bool) -> Self {
        match (emit_decorator_metadata, strict_null_checks) {
            (false, _) => Self::Off,
            (true, false) => Self::Loose,
            (true, true) => Self::Strict,
        }
    }

    #[inline]
    pub const fn is_on(self) -> bool {
        !matches!(self, Self::Off)
    }

    #[inline]
    pub const fn strict_null_checks(self) -> bool {
        matches!(self, Self::Strict)
    }
}

#[derive(Clone, Default)]
pub enum Metadata {
    #[default]
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
    // A heap `Vec` is used here because `Metadata` is lifetime-free.
    // Decorator metadata is rare and the lists are tiny.
    MDot(Vec<Ref>),
}

impl Metadata {
    pub const DEFAULT: Self = Metadata::MNone;

    // the logic in finish_union, merge_union, finish_intersection and merge_intersection is
    // translated from:
    // https://github.com/microsoft/TypeScript/blob/e0a324b0503be479f2b33fd2e17c6e86c94d1297/src/compiler/transformers/typeSerializer.ts#L402
    //
    // `strict_null_checks` is tsc's `strictNullChecks`. With it off, `null` and
    // `undefined` are elided from a union or intersection. With it on they
    // serialize to `void 0` like `void` does, so `string | undefined` is two
    // different constituents and becomes `Object`.

    /// Whether this constituent serializes to `void 0` when it is compared
    /// with another constituent. `MNever` is handled before any comparison.
    fn is_void_like(&self) -> bool {
        matches!(
            self,
            Metadata::MNull | Metadata::MUndefined | Metadata::MVoid
        )
    }

    /// Return the final union type if possible, or return None to continue merging.
    ///
    /// If the current type is MNever (or MNull / MUndefined without strict null
    /// checks) assign the current type to MNone and return None to ensure it's
    /// always replaced by the next type.
    /// `load_name`: closure form of `p.load_name_from_ref` to avoid coupling Metadata to P.
    pub fn finish_union<'b, F: Fn(Ref) -> &'b [u8]>(
        &mut self,
        strict_null_checks: bool,
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

            Metadata::MUnknown | Metadata::MAny | Metadata::MObject => Some(Metadata::MObject),

            Metadata::MNever => {
                *current = Metadata::MNone;
                None
            }

            Metadata::MNull | Metadata::MUndefined if !strict_null_checks => {
                *current = Metadata::MNone;
                None
            }

            _ => None,
        }
    }

    pub fn merge_union(&mut self, strict_null_checks: bool, left: Self) {
        let result = self;
        if !matches!(left, Metadata::MNone) {
            if core::mem::discriminant(result) != core::mem::discriminant(&left) {
                *result = match result {
                    Metadata::MNever => left,

                    // both sides are `void 0`
                    Metadata::MNull | Metadata::MUndefined | Metadata::MVoid
                        if left.is_void_like() =>
                    {
                        left
                    }

                    Metadata::MNull | Metadata::MUndefined if !strict_null_checks => left,

                    _ => Metadata::MObject,
                };
            } else {
                // Reshaped for borrowck — copy Ref out before reassigning *result
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
    /// If the current type is MUnknown (or MNull / MUndefined without strict
    /// null checks) assign the current type to MNone and return None to ensure
    /// it's always replaced by the next type.
    pub fn finish_intersection<'b, F: Fn(Ref) -> &'b [u8]>(
        &mut self,
        strict_null_checks: bool,
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

            Metadata::MUnknown => {
                *current = Metadata::MNone;
                None
            }

            Metadata::MNull | Metadata::MUndefined if !strict_null_checks => {
                *current = Metadata::MNone;
                None
            }

            _ => None,
        }
    }

    pub fn merge_intersection(&mut self, strict_null_checks: bool, left: Self) {
        let result = self;
        if !matches!(left, Metadata::MNone) {
            if core::mem::discriminant(result) != core::mem::discriminant(&left) {
                *result = match result {
                    Metadata::MUnknown => left,

                    // ensure MNever is the final type
                    Metadata::MNever => Metadata::MNever,

                    // both sides are `void 0`
                    Metadata::MNull | Metadata::MUndefined | Metadata::MVoid
                        if left.is_void_like() =>
                    {
                        left
                    }

                    Metadata::MNull | Metadata::MUndefined if !strict_null_checks => left,

                    _ => Metadata::MObject,
                };
            } else {
                // Reshaped for borrowck — copy Ref out before reassigning *result
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
