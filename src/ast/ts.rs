use crate::Loc;
use bun_alloc::AstAlloc;
use bun_collections::StringArrayHashMap;
use bun_collections::array_hash_map::StringContext;

use crate::base::Ref;
use crate::e::String as EString;
use crate::nodes::{StoreRef, StoreSlice, StoreStr};

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

/// A type annotation, as far as `emitDecoratorMetadata` tells types apart. Every other type is `MObject`.
#[derive(Clone, Copy, Default)]
pub enum Metadata {
    /// There is no annotation.
    #[default]
    MNone,

    MNever,
    MUnknown,
    MAny,
    /// `void`, `asserts x`
    MVoid,
    MNull,
    MUndefined,
    MFunction,
    MTuple,
    /// `boolean`, `true`, `x is T`
    MBoolean,
    MString,
    MObject,
    MNumber,
    MBigint,
    MSymbol,
    /// `T[]`
    MArray(StoreRef<Metadata>),
    /// `A.B<T>`
    MReference(StoreRef<TypeReference>),
    MUnion(StoreSlice<Metadata>),
    MIntersection(StoreSlice<Metadata>),
    /// `A extends B ? C : D` is `[C, D]`.
    MConditional(StoreSlice<Metadata>),
    MParenthesized(StoreRef<Metadata>),
    /// `readonly T`
    MReadonly(StoreRef<Metadata>),
}

pub struct TypeReference {
    /// `A.B` is `[A, B]`.
    pub name: StoreSlice<TypeReferenceName>,
    /// `MNone` if there are no type arguments.
    pub first_type_argument: Metadata,
}

#[derive(Clone, Copy)]
pub struct TypeReferenceName {
    pub text: StoreStr,
    pub loc: Loc,
}

impl Metadata {
    /// `SkipTypeParentheses`
    pub fn skip_parentheses(mut self) -> Metadata {
        while let Metadata::MParenthesized(inner) = self {
            self = *inner;
        }
        self
    }

    /// `GetRestParameterElementType`
    pub fn rest_parameter_element_type(self) -> Metadata {
        match self {
            Metadata::MArray(element) => *element,
            Metadata::MReference(reference) => reference.first_type_argument,
            _ => Metadata::MNone,
        }
    }
}

/// What `serializeTypeReferenceNode` emits for each group of TypeScript's `TypeReferenceSerializationKind`.
#[derive(Clone, Copy)]
pub enum TypeReferenceKind {
    /// The name may or may not be a value when the code runs.
    Unknown,
    /// The name is a class, or a variable that can be constructed.
    TypeWithConstructSignatureAndValue,
    VoidNullableOrNeverType,
    /// `Number` for `NumberLikeType`
    Global(&'static [u8]),
}

/// The type checker's answer for one type reference.
#[derive(Clone, Copy)]
pub struct CheckedTypeReference {
    /// Of the first identifier of its name.
    pub loc: Loc,
    pub kind: TypeReferenceKind,
    /// The metadata keeps the import that declares the first identifier.
    pub keeps_import: bool,
}
