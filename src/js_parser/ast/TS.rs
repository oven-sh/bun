use bun_collections::StringArrayHashMap;
use bun_logger::Loc;

use crate::ast::e::EString;
use crate::ast::Ref;

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
pub struct TSNamespaceScope<'arena> {
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
    // LIFETIMES.tsv: ARENA — p.allocator.create(Pair); &pair.map; shared across sibling scopes
    pub exported_members: *mut TSNamespaceMemberMap<'arena>,

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

pub type TSNamespaceMemberMap<'arena> = StringArrayHashMap<TSNamespaceMember<'arena>>;

pub struct TSNamespaceMember<'arena> {
    pub loc: Loc,
    pub data: Data<'arena>,
}

pub enum Data<'arena> {
    /// "namespace ns { export let it }"
    Property,
    /// "namespace ns { export namespace it {} }"
    // LIFETIMES.tsv: ARENA — assigned from ts_namespace.exported_members (parser-arena alloc)
    Namespace(*mut TSNamespaceMemberMap<'arena>),
    /// "enum ns { it }"
    EnumNumber(f64),
    /// "enum ns { it = 'it' }"
    // LIFETIMES.tsv: ARENA — assigned from Expr.Data.e_string payload (AST Expr store)
    EnumString(&'arena EString),
    /// "enum ns { it = something() }"
    EnumProperty,
}

impl<'arena> Data<'arena> {
    pub fn is_enum(&self) -> bool {
        // PORT NOTE: Zig used `inline else` + comptime `@tagName` prefix check ("enum_").
        // Expanded to an explicit match over the enum_* variants.
        matches!(
            self,
            Data::EnumNumber(_) | Data::EnumString(_) | Data::EnumProperty
        )
    }
}

pub use crate::ast::g::Class;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/TS.zig (139 lines)
//   confidence: medium
//   todos:      0
//   notes:      'arena lifetime threaded through TSNamespaceMember/Map/Scope for &'arena EString (per LIFETIMES.tsv); exported_members/namespace kept as *mut per TSV (shared across sibling scopes)
// ──────────────────────────────────────────────────────────────────────────
