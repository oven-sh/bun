//! Types, signatures and type mappers, hash-consed: equal ones have equal ids.
//!
//! An object type records its origin (a declaration, a syntax node, and the mapper for the
//! enclosing type parameters), not its members. The checker resolves the members on demand, once.

use crate::atom::{Atom, Interner};
use crate::hir::{ExprId, FnId, ParamId, TypeNodeId, TypeParamId};
use crate::jitter::{Jitter, Place};
use crate::local::{Found, LOCAL, MaybeLocal};
use crate::program::{FileId, Sym};
use crate::session::{Arena, ArenaVec, Session};
use crate::table::{ById, Frozen};
use crate::util::memory::{Length, Stable};
use crate::util::{
    AppendVec, FxHashMap, FxHasher, GrowingPlaces, InParallel, LocalVec, SharedSort, for_each_mut,
    place_of, shard_among, spread_hash,
};
use bun_alloc::{ArenaBox, vec_from_iter_in};
use bun_threading::Guarded;
use std::alloc::Allocator;
use std::cell::Cell;
use std::hash::{Hash, Hasher};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU16, AtomicU32, AtomicU64, Ordering};

/// A list that is stored once: one block, of its exact size, in the arena of the thread that built
/// it. As wide as `Box<[T]>`. It frees the block when it is dropped, on any thread.
pub type List<'s, T> = ArenaBox<'s, [T]>;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct TypeId(pub u32);
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SigId(pub u32);
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct MapperId(pub u32);
/// An interned list of `IndexComponent`s.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct ComponentsId(pub u32);

/// A list that is stored once, like a `List`. Up to `N` items are in the value itself: they take no
/// block, and they are in the cache line of the record that has the list. It is compared, hashed
/// and visited as the slice that it dereferences to.
pub enum ShortList<T, const N: usize, L> {
    /// Their number, and the items in the first places.
    Inline(u8, [T; N]),
    Spilled(L),
}

/// What the places of a `ShortList` that have no item hold. Nothing reads it.
pub trait BlankItem: Copy {
    const BLANK: Self;
}

impl BlankItem for TypeId {
    const BLANK: TypeId = TypeId(0);
}

impl BlankItem for FileId {
    const BLANK: FileId = FileId(0);
}

impl BlankItem for FnId {
    const BLANK: FnId = FnId(0);
}

impl<A: BlankItem, B: BlankItem> BlankItem for (A, B) {
    const BLANK: (A, B) = (A::BLANK, B::BLANK);
}

/// What a `ShortList` holds of more than `N` items.
pub trait ListBlock<'s, T>: std::ops::DerefMut<Target = [T]> {
    /// A copy of `items`. `arena`: of the calling thread.
    fn block_in(items: &[T], arena: &'s Arena) -> Self;
}

impl<'s, T: Copy> ListBlock<'s, T> for List<'s, T> {
    #[inline]
    fn block_in(items: &[T], arena: &'s Arena) -> Self {
        List::copy_from_slice_in(items, arena)
    }
}

/// A list behind a pointer, half as wide as a `List`. Up to seven ids are in the block that it
/// points to, half a cache line: reading them takes as many steps as reading a `List`. More take
/// one step more.
pub struct ThinList<'s, T>(ArenaBox<'s, ShortList<T, 7, List<'s, T>>>);

impl<T> std::ops::Deref for ThinList<'_, T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        &self.0
    }
}

impl<T> std::ops::DerefMut for ThinList<'_, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.0
    }
}

impl<'s, T: BlankItem> ListBlock<'s, T> for ThinList<'s, T> {
    #[inline]
    fn block_in(items: &[T], arena: &'s Arena) -> Self {
        ThinList(ArenaBox::new_in(
            ShortList::copy_from_slice_in(items, arena),
            arena,
        ))
    }
}

impl<T: BlankItem, const N: usize, L> ShortList<T, N, L> {
    #[inline]
    pub fn empty() -> Self {
        ShortList::Inline(0, [T::BLANK; N])
    }

    /// A copy of `items`. `arena`: of the calling thread.
    #[inline]
    pub fn copy_from_slice_in<'s>(items: &[T], arena: &'s Arena) -> Self
    where
        L: ListBlock<'s, T>,
    {
        const { assert!(N <= u8::MAX as usize) };
        if items.len() > N {
            return ShortList::Spilled(L::block_in(items, arena));
        }
        let mut inline = [T::BLANK; N];
        inline[..items.len()].copy_from_slice(items);
        ShortList::Inline(items.len() as u8, inline)
    }
}

impl<T: BlankItem, const N: usize, L> Default for ShortList<T, N, L> {
    #[inline]
    fn default() -> Self {
        Self::empty()
    }
}

impl<T, const N: usize, L: std::ops::Deref<Target = [T]>> std::ops::Deref for ShortList<T, N, L> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        match self {
            ShortList::Inline(len, items) => &items[..usize::from(*len)],
            ShortList::Spilled(items) => items,
        }
    }
}

impl<T, const N: usize, L: std::ops::DerefMut<Target = [T]>> std::ops::DerefMut
    for ShortList<T, N, L>
{
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        match self {
            ShortList::Inline(len, items) => &mut items[..usize::from(*len)],
            ShortList::Spilled(items) => items,
        }
    }
}

impl<T: PartialEq, const N: usize, L: std::ops::Deref<Target = [T]>> PartialEq
    for ShortList<T, N, L>
{
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}

impl<T: Eq, const N: usize, L: std::ops::Deref<Target = [T]>> Eq for ShortList<T, N, L> {}

impl<T: Hash, const N: usize, L: std::ops::Deref<Target = [T]>> Hash for ShortList<T, N, L> {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        (**self).hash(state);
    }
}

impl<T: std::fmt::Debug, const N: usize, L: std::ops::Deref<Target = [T]>> std::fmt::Debug
    for ShortList<T, N, L>
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        (**self).fmt(f)
    }
}

impl<'v, T, const N: usize, L: std::ops::Deref<Target = [T]>> IntoIterator
    for &'v ShortList<T, N, L>
{
    type Item = &'v T;
    type IntoIter = std::slice::Iter<'v, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

/// How many constituents of a union or an intersection, type arguments of a reference or elements of
/// a tuple, and declarations of a function value are in the record of the type: as many as leave a
/// `TypeRecord` the size of a cache line.
const INLINE_CONSTITUENTS: usize = 7;
const INLINE_TYPE_ARGUMENTS: usize = 3;
const INLINE_DECLARATIONS: usize = 2;

pub type Constituents<'s> = ShortList<TypeId, INLINE_CONSTITUENTS, List<'s, TypeId>>;
pub type GivenTypeArguments<'s> = ShortList<TypeId, INLINE_TYPE_ARGUMENTS, ThinList<'s, TypeId>>;
pub type Declarations<'s> =
    ShortList<(FileId, FnId), INLINE_DECLARATIONS, List<'s, (FileId, FnId)>>;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Intrinsic {
    /// Unknown to the resolver. Behaves like `any`, and propagates.
    Unresolved,
    Any,
    /// `errorType`: the type of an erroneous expression or type node. It has `TypeFlagsAny` and
    /// behaves like `any`, except where `isErrorType` is checked.
    Error,
    /// `autoType`: the declared type of a variable whose type at each reference is determined by
    /// control flow analysis of its assignments. It has `TypeFlagsAny`.
    Auto,
    Unknown,
    Never,
    /// `silentNeverType`: the `never` that a reference is narrowed to from the incomplete type of a
    /// loop under analysis. It has `TypeFlagsNever`, and operations on it yield `silentNeverType`
    /// again and report nothing.
    SilentNever,
    /// `unreachableNeverType`: the control flow type of a reference after an unreachable
    /// assignment, or after a call that never returns. It has `TypeFlagsNever`.
    /// `getFlowTypeOfReference` converts it to the declared type.
    UnreachableNever,
    /// `implicitNeverType`: the element type of `[]` under `strictNullChecks`. It has
    /// `TypeFlagsNever`. `isEmptyLiteralType` recognizes it.
    ImplicitNever,
    /// `uniqueLiteralType`: the type `uniqueLiteralMapper` substitutes for a type parameter. It has
    /// `TypeFlagsNever`, and `createUnionOrIntersectionProperty` does not count it as a `never`.
    UniqueLiteral,
    Void,
    /// `undefinedType`
    Undefined,
    /// The `undefined` of a missing property or element. `missingType`
    Missing,
    /// `undefinedWideningType` without strictNullChecks: the type of the expression `undefined`,
    /// which `getWidenedType` turns into `any`. Under strictNullChecks it is `undefinedType`
    /// (`createWideningType`), and this one is not used.
    UndefinedWidening,
    /// `nullType`
    Null,
    /// `nullWideningType`, likewise.
    NullWidening,
    String,
    Number,
    BigInt,
    Symbol,
    /// `object`
    Object,
    /// `intrinsicMarkerType`: the type of the keyword `intrinsic`. It has `TypeFlagsAny`.
    IntrinsicMarker,
    /// `wildcardType`: the type `getPermissiveInstantiation` substitutes for a type parameter. It
    /// has `TypeFlagsAny`.
    Wildcard,
    /// `nonInferrableAnyType`: the type of a name of a binding pattern, referenced within the
    /// pattern while the type that the pattern implies is computed. It has `TypeFlagsAny` and
    /// `ObjectFlagsContainsWideningType`, also under strictNullChecks.
    NonInferrableAny,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ElemFlags: u128 {
        const REQUIRED = 1;
        const OPTIONAL = 2;
        const REST = 4;
        /// `...T` where `T` is a type parameter.
        const VARIADIC = 8;
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct IndexFlags: u8 {
        const NO_INDEX_SIGNATURES = 1 << 1;
        const NO_REDUCIBLE_CHECK = 1 << 2;
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct AccessFlags: u16 {
        const INCLUDE_UNDEFINED = 1 << 0;
        const NO_INDEX_SIGNATURES = 1 << 1;
        const WRITING = 1 << 2;
        const ALLOW_MISSING = 1 << 4;
        const EXPRESSION_POSITION = 1 << 5;
        const SUPPRESS_NO_IMPLICIT_ANY_ERROR = 1 << 7;
        const CONTEXTUAL = 1 << 8;
    }
}

/// `TupleElementInfo.labeledDeclaration`: the named tuple member or the parameter that labels an
/// element. The file and the position tell it from another one of that name: `getTupleKey` writes
/// the node, so `[x: T]` written twice has two targets.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct LabeledDeclaration {
    pub name: Atom,
    pub file: FileId,
    pub pos: u32,
}

impl LabeledDeclaration {
    /// nil
    pub const NONE: LabeledDeclaration = LabeledDeclaration {
        name: Atom::NONE,
        file: FileId(0),
        pos: 0,
    };
}

impl ElemFlags {
    /// `TupleElementInfo.labeledDeclaration` is stored in the bits above the flags.
    const NAME_SHIFT: u32 = 8;
    const FILE_SHIFT: u32 = 40;
    const POS_SHIFT: u32 = 72;

    /// `name` in `[name: T]`. `NONE`: the element has no label.
    #[inline]
    pub fn label(self) -> Atom {
        match (self.bits() >> Self::NAME_SHIFT) as u32 {
            0 => Atom::NONE,
            label => Atom(label - 1),
        }
    }

    #[inline]
    pub fn labeled_declaration(self) -> LabeledDeclaration {
        LabeledDeclaration {
            name: self.label(),
            file: FileId((self.bits() >> Self::FILE_SHIFT) as u32),
            pos: (self.bits() >> Self::POS_SHIFT) as u32,
        }
    }

    /// The same flags with the label `label`.
    #[inline]
    pub fn with_label(self, label: LabeledDeclaration) -> ElemFlags {
        debug_assert!(!label.name.is_own(), "a label is a declared name");
        let flags = self.bits() & ((1 << Self::NAME_SHIFT) - 1);
        if label.name.is_none() {
            return ElemFlags::from_bits_retain(flags);
        }
        ElemFlags::from_bits_retain(
            flags
                | (u128::from(label.name.0 + 1) << Self::NAME_SHIFT)
                | (u128::from(label.file.0) << Self::FILE_SHIFT)
                | (u128::from(label.pos) << Self::POS_SHIFT),
        )
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum EnumValue {
    String(Atom),
    Number(u64),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum StringMappingKind {
    Uppercase,
    Lowercase,
    Capitalize,
    Uncapitalize,
}

/// `checkObjectLiteral` creates a type on every call: the call that created a type of an object literal.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ObjectLiteralCheck {
    /// `checkExpression`, for the parent of the literal.
    ForParent,
    /// `checkExpressionForMutableLocation`, for `getAssignmentDeclarationInitializerType`.
    ForAssignmentDeclaration,
    /// `checkExpressionCached`, for `getContextualThisParameterType`, where the parent has left no `links.resolvedType`.
    ForThis,
    /// The same for the `this` parameter of this member, or for a type query of `this` in its signature: both are resolved
    /// while the literal is checked.
    ForThisParameter(FnId),
}

/// The syntax node or declaration whose type is an anonymous object type.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Origin {
    /// `{ a: T }`
    TypeLiteral(FileId, TypeNodeId),
    /// `{ [K in T]: U }`
    Mapped(FileId, TypeNodeId),
    /// `{ a: 1 }`, as the type of the expression (`ObjectFlagsObjectLiteral`). The fields after the node:
    /// 1. `ObjectFlagsJSLiteral`.
    /// 2. `isConstContext(node)` when the type was created: its properties are `readonly`. The members are a function of the
    ///    type, so resolving them asks for no contextual type.
    /// 3. The call of `checkObjectLiteral` that created the type.
    /// 4. `CONTAINS_WIDENING_TYPE` and `NON_INFERRABLE_TYPE`, propagated from the member types when the type was created.
    /// 5. `ObjectFlagsFreshLiteral`.
    ObjectLiteral(
        FileId,
        ExprId,
        bool,
        bool,
        ObjectLiteralCheck,
        ObjectFlags,
        bool,
    ),
    /// `getWidenedTypeOfObjectLiteral` of it. The first three fields after the node are the same. The
    /// last one is `ObjectFlagsNonInferrableType`, which widening preserves.
    WidenedLiteral(FileId, ExprId, bool, bool, ObjectLiteralCheck, bool),
    /// The constructor function of a class, with its static members.
    ClassStatic(Sym),
    /// A function declaration with all its overloads, and the namespace merged with it.
    Function(Sym),
    EnumObject(Sym),
    /// A module or namespace, as a value.
    Module(Sym),
    /// The type of the symbol `cloneTypeAsModuleType` creates for an `import * as ns` that does not
    /// resolve to the module itself (`resolveESModuleSymbol`): the properties and index signatures
    /// of `module` (a module, or its `export =` target), no call or construct signatures, and, if
    /// `with_default`, a `default` that overrides theirs and is `module` itself.
    /// `is_default_only`: that `default` and nothing else (`getTypeWithSyntheticDefaultOnly`).
    /// `originating_import`: the alias `ns`. Each such import creates its own symbol, and so its
    /// own type.
    Namespace {
        module: Sym,
        with_default: bool,
        is_default_only: bool,
        originating_import: Sym,
    },
    /// `globalThis`
    GlobalThis,
}

/// `UniqueESSymbolType.symbol`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum UniqueSymbolDeclaration {
    /// A `const`.
    Variable(Sym),
    /// A `readonly` property of a class, an interface or a type literal, which has no `Sym`: `symbol.Declarations[0]`.
    Member(FileId, crate::hir::MemberId),
    /// A property of the global `SymbolConstructor`, identified by its name alone.
    SymbolConstructor,
}

/// `TypeReference.resolvedTypeArguments`. Callers read them through `Checker::type_arguments`
/// (`getTypeArguments`).
#[derive(PartialEq, Eq, Hash, Debug)]
pub enum TypeArguments<'s> {
    /// `createTypeReference`
    Given(GivenTypeArguments<'s>),
    /// `createDeferredTypeReference`
    Deferred(DeferredTypeArguments),
}

const _: () = assert!(size_of::<TypeArguments<'static>>() == 16);

/// `TypeReference.node` and `mapper`: the type reference to a generic class or interface, the array
/// type node or the tuple type node at `node`, in the declaration of a type alias, and the mapper
/// for the type parameters enclosing the node. The resolved type arguments are in
/// `Program::resolved_type_arguments`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct DeferredTypeArguments {
    pub file: FileId,
    pub node: TypeNodeId,
    pub mapper: MapperId,
}

impl<'s> TypeArguments<'s> {
    /// A copy of `actual`. `arena`: of the calling thread.
    #[inline]
    pub fn given_in(actual: &[TypeId], arena: &'s Arena) -> TypeArguments<'s> {
        TypeArguments::Given(ShortList::copy_from_slice_in(actual, arena))
    }

    pub fn deferred_in(
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        _: &'s Arena,
    ) -> TypeArguments<'s> {
        TypeArguments::Deferred(DeferredTypeArguments { file, node, mapper })
    }

    /// `None`: they are deferred.
    #[inline]
    pub fn actual(&self) -> Option<&[TypeId]> {
        match self {
            TypeArguments::Given(actual) => Some(actual),
            TypeArguments::Deferred(_) => None,
        }
    }

    /// `t.AsTypeReference().node != nil`
    #[inline]
    pub fn as_deferred(&self) -> Option<&DeferredTypeArguments> {
        match self {
            TypeArguments::Given(_) => None,
            TypeArguments::Deferred(deferred) => Some(deferred),
        }
    }
}

impl Default for TypeArguments<'_> {
    fn default() -> Self {
        TypeArguments::Given(ShortList::empty())
    }
}

/// A type parameter that has no declaration.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Marker {
    Super,
    Sub,
    Other,
    SuperForCheck,
    SubForCheck,
    /// `getRestrictiveTypeParameter`: the type parameter without a constraint.
    Restrictive(TypeId),
    /// `createTupleTargetType`: `typeParameters` and `thisType`. All targets share them: only a
    /// mapper ever observes them.
    TupleElement(u32),
    TupleThis,
}

#[derive(PartialEq, Eq, Hash, Debug)]
pub enum TypeData<'s> {
    Intrinsic(Intrinsic),
    /// The type of a type reference whose name does not resolve
    /// (`getUnresolvedSymbolForEntityName`, `getTypeFromTypeAliasReference`): an intrinsic type
    /// with `TypeFlagsAny` and an alias. `isErrorType` is true for it, it is not `errorType`, and
    /// it is printed as in the source. `name` is the whole entity name, `A.B.C`.
    UnresolvedName {
        name: Atom,
        args: List<'s, TypeId>,
    },
    StringLit {
        value: Atom,
        fresh: bool,
    },
    NumberLit {
        bits: u64,
        fresh: bool,
    },
    BigIntLit {
        text: Atom,
        negative: bool,
        fresh: bool,
    },
    BoolLit {
        value: bool,
        fresh: bool,
    },
    EnumLit {
        member: Sym,
        value: EnumValue,
        fresh: bool,
    },
    /// A computed member of an enum (the symbol is the member), or an enum without members (the symbol is the enum).
    /// `createComputedEnumType`
    Enum {
        symbol: Sym,
        fresh: bool,
    },
    /// `let a = []` during control flow analysis of a reference to it: an array of the types
    /// assigned to its elements so far.
    /// Only exists during control flow analysis. The final result is an ordinary array.
    EvolvingArray(TypeId),
    /// `UniqueESSymbolType`: the unique symbol of one declaration.
    UniqueSymbol {
        symbol: UniqueSymbolDeclaration,
        name: Atom,
    },
    /// With `IDENTITY`, the type parameter as declared. Otherwise the type parameter of a signature
    /// inside an instantiated type (`cloneTypeParameter`): a distinct type, whose constraint and
    /// default are the declared ones instantiated with the mapper. The mapper maps the type
    /// parameters enclosing the signature, and none of the signature's own.
    TypeParam(FileId, TypeParamId, MapperId),
    /// The `this` type of a class or an interface.
    ThisParam(Sym),
    Marker(Marker),
    /// In the order of `CompareTypes`.
    Union(Constituents<'s>),
    Intersection(Constituents<'s>),
    /// An instance of a class or an interface.
    Ref {
        target: Sym,
        args: TypeArguments<'s>,
    },
    Tuple {
        elems: TypeArguments<'s>,
        flags: List<'s, ElemFlags>,
        readonly: bool,
    },
    Anon {
        origin: Origin,
        mapper: MapperId,
    },
    /// Function-likes that together are one function value: an expression, a function type, or the overloads of a method.
    Fns {
        decls: Declarations<'s>,
        mapper: MapperId,
    },
    /// An object type that was computed: a spread, a rest, `Pick<T, K>`.
    Synth(ArenaBox<'s, Shape<'s>>),
    /// The type for which `{ [P in keyof T]: X }` (`mapped`) yields `source`. `of` is the `T`. Its
    /// members are resolved on demand. `createReverseMappedType`
    ReverseMapped {
        source: TypeId,
        mapped: TypeId,
        of: TypeId,
    },
    /// A deferred `check extends E ? X : Y`.
    Cond {
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        /// `getConditionalTypeInstantiation` created the type for a member of the union that it
        /// distributes over, so its mapper is the `MergedTypeMapper` of
        /// `prependTypeMapping(checkType, t, newMapper)`, of which `mapper` has the pairs. This is
        /// `newMapper`, which has the union. `IDENTITY`: its mapper is not a merged one.
        distributed_over: MapperId,
        /// `forConstraint` of `getConditionalTypeKey`. `getConditionalType` creates a new type
        /// whenever it defers, and `getConditionalTypeInstantiation` caches the result under the
        /// type arguments that it was itself given: those of a union that is distributed over,
        /// those a tail call started with. This field holds those type arguments for a type created
        /// for a constraint, so that two types are identical exactly where they are in tsgo.
        /// `IDENTITY`: it was not created for a constraint.
        for_constraint: MapperId,
    },
    IndexedAccess {
        obj: TypeId,
        index: TypeId,
        /// Read in an expression under noUncheckedIndexedAccess: a value from an index signature
        /// may be missing.
        /// `AccessFlagsIncludeUndefined`, the only access flag that is stored
        /// (`AccessFlagsPersistent`).
        undefined: bool,
    },
    Keyof(TypeId),
    /// `SubstitutionType`: `base`, which is known to satisfy `constraint`. With the constraint
    /// `unknown` it is `NoInfer<base>`.
    Substitution {
        base: TypeId,
        constraint: TypeId,
    },
    Template {
        texts: List<'s, Atom>,
        types: List<'s, TypeId>,
    },
    StringMapping {
        kind: StringMappingKind,
        ty: TypeId,
    },
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct PropFlags: u32 {
        const OPTIONAL = 1;
        const READONLY = 2;
        const METHOD = 4;
        const ACCESSOR = 8;
        const PRIVATE = 16;
        const PROTECTED = 32;
        /// A setter without a getter.
        const WRITE_ONLY = 64;
        /// For a property of a widened object literal: the object literal types in its type are
        /// widened too.
        const WIDEN = 128;
        /// The name looks numeric but is a string: `{ "0": x }`, the elements of a tuple, a mapped
        /// key that is a string literal. It replaces `nameType` and the name node, which
        /// `getLiteralTypeFromProperty` uses.
        const STRING_NAME = 256;
        /// The `children` property synthesized from the body of a JSX element. The parent of its
        /// declaration is the attributes node (`createJsxAttributesTypeFromAttributesProperty`), so
        /// `shouldCheckAsExcessProperty` accepts it like an attribute in the source, unlike a
        /// property copied by a spread. `jsx_attributes_type` sets it only when the attributes type
        /// is fresh.
        const JSX_CHILDREN = 512;
        /// A member of an object literal as `checkObjectLiteral` recreates it when checking under a
        /// pushed contextual type: a symbol with the newly computed type and the `ValueDeclaration`
        /// of the member. The parent of that declaration is the literal, so
        /// `shouldCheckAsExcessProperty` accepts it, unlike a property copied by a spread, which is
        /// also a `PropSource::Copy`.
        const WRITTEN = 1024;
        /// For a property of an object literal type that is no longer fresh: an object literal type
        /// that is its type is not fresh either (`getRegularTypeOfObjectLiteral`,
        /// `transformTypeOfMembers`).
        const REGULAR = 2048;
        /// `OPTIONAL`, but `undefined` is not added to the type of the symbol: the `?` is on a
        /// declaration after `symbol.ValueDeclaration`, which is the one `isOptionalDeclaration`
        /// checks, or on a parameter property, whose type already includes it.
        const WITHOUT_OPTIONALITY = 4096;
        /// `CheckFlags` of the property `createUnionOrIntersectionProperty` creates for a union.
        const READ_PARTIAL = 1 << 13;
        const WRITE_PARTIAL = 1 << 14;
        const HAS_NON_UNIFORM_TYPE = 1 << 15;
        const HAS_LITERAL_TYPE = 1 << 16;
        const ABSTRACT = 1 << 17;
        /// On a member that a class or an interface has inherited: `instantiateSymbol` returned it
        /// itself (`m.MapsThisOnly() && isThisless(symbol)`), and does so for every heir.
        const THISLESS = 1 << 18;
        /// Without any of these a property is accessible everywhere except through `super`
        /// (`checkPropertyAccessibilityAtLocation`). For accessors the accessor in use decides, so
        /// they are inspected.
        const MAY_BE_OUT_OF_REACH = Self::PRIVATE.bits() | Self::PROTECTED.bits() | Self::ABSTRACT.bits() | Self::ACCESSOR.bits();
    }
}

/// The origin of the type of a property.
#[derive(PartialEq, Eq, Hash, Debug)]
pub enum PropSource<'s> {
    /// Synthesized: it has no declaration.
    Type(TypeId),
    /// A property of an object literal.
    Literal(FileId, crate::hir::PropId),
    /// A member of a class, an interface or a type literal, a parameter property, an export of a
    /// module or a namespace, a member of an enum, or a property declared by `f.name = value`,
    /// `this.name = value` or `Object.defineProperty(f, "name", descriptor)`. A late bound symbol
    /// is identified by the symbol the binder created for its first declaration.
    Symbol(Sym),
    /// A property of the given intersection or union: the properties of that name in several of
    /// its constituents. It combines all of them.
    Intersected(TypeId, List<'s, Prop<'s>>),
    /// A property of the given mapped type (`containingType`). Its type is the template of that
    /// type instantiated with `Prop::mapper`: the mapper of the mapped type plus its type parameter
    /// mapped to `keyType`. `type_of_mapped_prop` resolves it on demand (`getTypeOfMappedSymbol`).
    /// As `resolveMappedTypeMembers` creates it, `Prop::mapper` is the mapper of the mapped type alone and `keyType` is in
    /// `Prop::name_type`: see `Types::key_apart`. `Checker::mapper_of_prop` puts the two together.
    /// The flag is `CheckFlagsStripOptional`: `-?` removes `undefined` from the type.
    /// The last field holds the symbols whose `Declarations` it has, those of `modifiersProp`
    /// (`addMemberForKeyTypeWorker`), following the rule of `Copy`.
    /// `None`: it has none.
    Mapped(TypeId, bool, Option<List<'s, Prop<'s>>>),
    /// A symbol derived from others (`createSymbolWithType`, `getSpreadSymbol`, `getSpreadType`):
    /// its own type, and the symbols whose `Declarations` it has, concatenated in order. None of
    /// those is synthesized, a copy or `Intersected`. The flag: it also has the `ValueDeclaration`
    /// and the `Parent` of the first. `Checker::copy_of` creates it.
    Copy(TypeId, List<'s, Prop<'s>>, bool),
    /// A property of the given reverse mapped type (`CheckFlagsReverseMapped`).
    /// `type_of_reverse_mapped_prop` infers its type on demand (`getTypeOfReverseMappedSymbol`).
    /// The second field holds the symbols whose `Declarations` it has, those of the property of the
    /// source, following the rule of `Copy`. It has no `ValueDeclaration`.
    ReverseMapped(TypeId, List<'s, Prop<'s>>),
}

#[derive(PartialEq, Eq, Hash, Debug)]
pub struct Prop<'s> {
    pub name: Atom,
    pub flags: PropFlags,
    pub source: PropSource<'s>,
    /// The mapper to instantiate the type from `source` with.
    pub mapper: MapperId,
    /// `links.nameType` of a symbol that is made from another (`getSpreadSymbol`, `getSpreadType`,
    /// `createSymbolWithType`), where that is a member of an enum: `source` no longer leads to it,
    /// and the name only spells it. `TypeId::UNRESOLVED`: `name`, `STRING_NAME` and `source` tell.
    /// Of a property of a mapped type it can be `keyType` instead: see `Types::key_apart`.
    pub name_type: TypeId,
}

const _: () = assert!(size_of::<Prop<'static>>() <= 40);

impl<'s> Prop<'s> {
    /// The last field of `PropSource::Mapped`.
    pub fn declared_by_modifiers_property(&self) -> &[Prop<'s>] {
        match &self.source {
            PropSource::Mapped(_, _, Some(declared)) => declared,
            _ => &[],
        }
    }

    /// A hash that leaves out the lists in the source. Equal properties still have equal hashes, and the property of a
    /// union of a hundred members takes no longer to hash than any other.
    pub fn hash_without_lists<H: Hasher>(&self, hasher: &mut H) {
        (self.name, self.flags, self.mapper, self.name_type).hash(hasher);
        std::mem::discriminant(&self.source).hash(hasher);
        match &self.source {
            PropSource::Type(ty) => ty.hash(hasher),
            PropSource::Literal(file, written) => (file, written).hash(hasher),
            PropSource::Symbol(symbol) => symbol.hash(hasher),
            PropSource::Intersected(of, parts) => (of, parts.len()).hash(hasher),
            PropSource::Mapped(of, strips_optional, _) => (of, strips_optional).hash(hasher),
            PropSource::Copy(ty, declared, _) => (ty, declared.len()).hash(hasher),
            PropSource::ReverseMapped(of, _) => of.hash(hasher),
        }
    }

    /// `hash_without_lists`, as a number.
    pub fn fx_hash_without_lists(&self) -> u64 {
        let mut hasher = FxHasher::default();
        self.hash_without_lists(&mut hasher);
        hasher.finish()
    }
}

/// `ElementWithComputedPropertyName`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum IndexComponent {
    /// A member of an object literal.
    Property(FileId, crate::hir::PropId),
    /// A member of a class, an interface or a type literal.
    Member(FileId, crate::hir::MemberId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct IndexInfo {
    pub key: TypeId,
    pub value: TypeId,
    pub readonly: bool,
    /// It is `enumNumberIndexInfo`, the reverse mapping from a number to the name of a member of an
    /// enum. `keyof` and inference leave it out, in a type that has it from an enum object as well
    /// (`getRestType`).
    pub is_enum_number_index_info: bool,
    /// The index signature that declares it (`getIndexInfosOfIndexSymbol`).
    pub declaration: Option<(FileId, crate::hir::MemberId)>,
    /// The declarations with computed names that it is built from (`getObjectLiteralIndexInfo`):
    /// `TypeStore::components`.
    pub components: ComponentsId,
}

impl IndexInfo {
    /// `newIndexInfo(keyType, valueType, isReadonly, nil, nil)`
    #[inline]
    pub fn new(key: TypeId, value: TypeId, readonly: bool) -> IndexInfo {
        IndexInfo {
            key,
            value,
            readonly,
            is_enum_number_index_info: false,
            declaration: None,
            components: ComponentsId::NONE,
        }
    }
}

/// `InstantiationExpressionType.node`: `f<T>`, or `typeof f<T>` or `typeof import("m").f<T>`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum InstantiationExpression {
    Expr(FileId, ExprId),
    TypeNode(FileId, TypeNodeId),
}

/// The members of an object type.
#[derive(PartialEq, Eq, Hash, Debug)]
pub struct Shape<'s> {
    /// `symbol.Declarations[0]` of a synthesized type that has the symbol of an object literal
    /// (`getSpreadType`, `getWidenedTypeOfObjectLiteral`), or of a binding element (`getRestType`):
    /// the file and the position, by which `CompareTypes` orders, and the object literal, if it is
    /// one.
    pub symbol_declared_at: Option<(FileId, u32, ExprId)>,
    /// `t.symbol` of a type that `getRestType` creates for a destructuring assignment: that of the
    /// type that is destructured.
    pub symbol: Option<Sym>,
    /// In declaration order, own before inherited.
    pub props: ArenaVec<'s, Prop<'s>>,
    pub call: ArenaVec<'s, SigId>,
    pub construct: ArenaVec<'s, SigId>,
    pub index: ArenaVec<'s, IndexInfo>,
    pub literal: Literalness,
    /// For a type that `literal` marks as the type of an expression: `ObjectFlagsFreshLiteral` has
    /// been removed (`getRegularTypeOfObjectLiteral`).
    pub is_regular: bool,
    /// `ObjectFlagsContainsWideningType` for a type `checkObjectLiteral` creates by value: a member
    /// in the source has it, even one that a later spread overrides.
    pub contains_widening_type: bool,
    /// `ObjectFlagsJSLiteral`
    pub is_js_literal: bool,
    /// `ObjectFlagsObjectRestType`
    pub is_object_rest_type: bool,
    /// For a type created by `getInstantiationExpressionType`.
    pub instantiation_expression: Option<InstantiationExpression>,
    /// `t.target` of an instantiation of such a type: `getObjectTypeInstantiation` instantiates
    /// the members of the type as created.
    pub instantiation_target: Option<TypeId>,
    /// For a type created by `createDefaultPropertyWrapperForModule`: `originalSymbol`, the module,
    /// which is the `Parent` of its `default`.
    pub default_of: Option<Sym>,
    /// For a type created by `getSpreadType` or `getRestType`, which create a new type on every
    /// call: the left and the right operand of the spread, or the type that is destructured and
    /// `never`.
    pub created_from: Option<(TypeId, TypeId)>,
    /// The number of types `getSpreadType` had created for the same object literal before this
    /// one. `mapType` iterates over a union of named unions by its origin, which is not the order
    /// of `CompareTypes`.
    pub spread_rank: u32,
    /// The intersection that this has the properties of, and no more. Its signatures and index
    /// signatures are elsewhere: `structured_members`.
    pub properties_of: Option<TypeId>,
    /// For a type created by `getSignatureInstantiation` with `inferredTypeParameters`
    /// (`ObjectFlagsSingleSignatureType`), which creates a new type on every call: the outer type
    /// parameters of the signature's declaration instantiated with `t.mapper`, as a tuple.
    pub single_signature_arguments: Option<TypeId>,
    /// `t.symbol` is nil (`getTypeFromObjectBindingPattern`), or is not a function, a method, a
    /// class, a type literal or an object literal (`getOrCreateTypeFromSignature` for a call
    /// signature). `couldContainTypeVariables` is false whatever the members mention: the type is
    /// never instantiated, and nothing is inferred to it. It has no implicit index signature
    /// (`isObjectTypeWithInferableIndex`).
    pub has_no_instantiable_symbol: bool,
    /// For a type created by `getTypeFromObjectBindingPattern`, which creates a new type on every
    /// call, and for what `getWidenedTypeOfObjectLiteral` makes of it: the file and the position
    /// of the pattern.
    pub pattern_at: Option<(FileId, u32)>,
    /// `t.mapper` of a type that `getObjectTypeInstantiation` instantiates whatever its members
    /// mention: it has the symbol of an object literal (`getSpreadType`,
    /// `getWidenedTypeOfObjectLiteral`), `ObjectFlagsObjectRestType` or
    /// `ObjectFlagsInstantiationExpressionType`. It maps `links.outerTypeParameters` of the
    /// declaration, to themselves in the type as created, and each list of type arguments is a
    /// type of its own. `IDENTITY`: there are none.
    pub mapper: MapperId,
}

/// Whether a synthesized object type is still the type of an object literal expression, or which
/// other distinguishing kind it was created as.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum Literalness {
    #[default]
    No,
    Literal,
    /// An object literal with a spread: its other properties are not known.
    WithSpread,
    /// The properties in the source between two spreads, before they are merged into a
    /// `WithSpread`.
    Written,
    /// The attributes of a JSX element. Names that contain a hyphen are ignored.
    JsxAttributes,
    /// An object literal checked without its context-sensitive functions
    /// (`ObjectFlagsNonInferrableType`). With no members and no symbol, it is such a function
    /// (`anyFunctionType`). With one call signature and nothing else, it is such a function without
    /// context-sensitive parameters, retained for its return type (`returnOnlyType`).
    Partial,
    /// The type implied by a binding pattern, used as the contextual type of its initializer
    /// (`patternForType`). No expression has it.
    Pattern,
    /// The same with computed names that are only known at run time: its other properties are not
    /// known.
    /// `ObjectFlagsObjectLiteralPatternWithComputedProperties`
    PatternWithComputedNames,
    /// The type `import()` yields for a module that gets a synthesized `default`
    /// (`getTypeWithSyntheticDefaultImportType`). Its symbol is a type literal without members, so
    /// `IsEmptyAnonymousObjectType` treats it as `{}`, widened or not.
    SyntheticDefault,
    /// `emptyObjectType`. It has no symbol. A type that `getRestType` or
    /// `getWidenedTypeOfObjectLiteral` creates without members is `No`.
    EmptyObject,
    /// `unknownEmptyObjectType`: the `{}` that `unknown` narrows to when it is neither `null` nor
    /// `undefined`. It has no symbol.
    OfUnknown,
    /// `autoArrayType` where there is no global `Array`. It has no symbol.
    AutoArray,
    /// The type `createEmptyObjectTypeFromStringLiteral` creates for an inference from a string
    /// literal to `keyof T`. It has no symbol.
    OfLiteralKeyof,
    /// `emptyTypeLiteralType`: `{}` written as a type. Its symbol is a type literal without
    /// declarations.
    EmptyTypeLiteral,
}

impl Literalness {
    /// Whether it is the type of an object literal expression itself, not a type derived from it.
    #[inline]
    pub fn is_of_expression(self) -> bool {
        matches!(
            self,
            Literalness::Literal
                | Literalness::WithSpread
                | Literalness::Written
                | Literalness::JsxAttributes
                | Literalness::Partial
        )
    }

    /// `patternForType[t] != nil` for a type that no expression has.
    #[inline]
    pub fn is_of_pattern(self) -> bool {
        matches!(
            self,
            Literalness::Pattern | Literalness::PatternWithComputedNames
        )
    }
}

impl<'s> Shape<'s> {
    /// No members. `arena`: of the calling thread, which is the only one that may add some.
    pub fn new_in(arena: &'s Arena) -> Shape<'s> {
        Shape {
            symbol_declared_at: None,
            symbol: None,
            props: ArenaVec::new_in(arena),
            call: ArenaVec::new_in(arena),
            construct: ArenaVec::new_in(arena),
            index: ArenaVec::new_in(arena),
            literal: Literalness::No,
            is_regular: false,
            contains_widening_type: false,
            is_js_literal: false,
            is_object_rest_type: false,
            instantiation_expression: None,
            instantiation_target: None,
            default_of: None,
            created_from: None,
            spread_rank: 0,
            properties_of: None,
            single_signature_arguments: None,
            has_no_instantiable_symbol: false,
            pattern_at: None,
            mapper: MapperId::IDENTITY,
        }
    }

    pub fn prop(&self, name: Atom) -> Option<&Prop<'s>> {
        self.props.iter().find(|p| p.name == name)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SigParam {
    pub name: Atom,
    pub ty: TypeId,
    pub optional: bool,
    pub rest: bool,
    /// Of a rest parameter: `Signature.minArgumentCount` is beyond its position, so it takes at
    /// least one argument. `combineUnionOrIntersectionMemberSignatures` stores the greater of two
    /// minimum argument counts, and the parameter at that position may be the rest parameter of
    /// the other signature: `((...a: number[]) => void) | ((a: string) => void)`.
    pub is_required_rest: bool,
    /// `symbol.ValueDeclaration`. `None`: a parameter that the checker synthesizes
    /// (`combineUnionOrIntersectionParameters`, `newParameter`) has a name and no declaration.
    pub declaration: Option<(FileId, ParamId)>,
}

impl SigParam {
    /// `ast.IsBindingPattern(symbol.ValueDeclaration.Name())`, or the name is missing.
    #[inline]
    pub fn is_named_by_pattern(&self) -> bool {
        self.name.is_none() && self.declaration.is_some()
    }
}

#[derive(PartialEq, Eq, Hash, Debug)]
pub enum SigData<'s> {
    /// As declared, with `mapper` applied.
    Decl {
        file: FileId,
        func: FnId,
        mapper: MapperId,
    },
    /// The implicit constructor of a class that declares none: `new (...) => instance`.
    /// `base`: the construct signature of the base constructor type that
    /// `getDefaultConstructSignatures` cloned, with the type arguments of the `extends` clause.
    /// `None`: the base constructor type has none.
    DefaultConstruct {
        class: Sym,
        base: Option<SigId>,
        mapper: MapperId,
    },
    /// The construct signature of a class, built from its constructor `func`.
    Construct {
        class: Sym,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    },
    /// Synthesized. `this`: its `this` type. `of`: the first entry is the signature it is a clone
    /// of, whose declaration it shares. With more than one entry it is `Signature.composite`
    /// (`createUnionSignature`, `combineUnionOrIntersectionMemberSignatures`), with `is_union` for
    /// `composite.isUnion`: `ret` is `TypeId::UNRESOLVED`, and `sig_return` resolves it from their
    /// return types.
    Synth {
        type_params: List<'s, TypeId>,
        params: List<'s, SigParam>,
        ret: TypeId,
        this: Option<TypeId>,
        of: List<'s, SigId>,
        is_union: bool,
    },
    /// `sig` with the return type `ret`: a construct signature of an intersection that contains
    /// mixin constructors (`cloneSignature` with `resolvedReturnType` set). `sig` is never one of
    /// these itself.
    WithReturn { sig: SigId, ret: TypeId },
}

/// `TypeFlags`, with the values of types.go: `CompareTypes` orders types of different kinds by them.
pub mod tf {
    pub const ANY: u32 = 1 << 0;
    pub const UNKNOWN: u32 = 1 << 1;
    pub const UNDEFINED: u32 = 1 << 2;
    pub const NULL: u32 = 1 << 3;
    pub const VOID: u32 = 1 << 4;
    pub const STRING: u32 = 1 << 5;
    pub const NUMBER: u32 = 1 << 6;
    pub const BIGINT: u32 = 1 << 7;
    pub const BOOLEAN: u32 = 1 << 8;
    pub const ES_SYMBOL: u32 = 1 << 9;
    pub const STRING_LITERAL: u32 = 1 << 10;
    pub const NUMBER_LITERAL: u32 = 1 << 11;
    pub const BIGINT_LITERAL: u32 = 1 << 12;
    pub const BOOLEAN_LITERAL: u32 = 1 << 13;
    pub const UNIQUE_ES_SYMBOL: u32 = 1 << 14;
    pub const ENUM_LITERAL: u32 = 1 << 15;
    pub const ENUM: u32 = 1 << 16;
    pub const NON_PRIMITIVE: u32 = 1 << 17;
    pub const NEVER: u32 = 1 << 18;
    pub const TYPE_PARAMETER: u32 = 1 << 19;
    pub const OBJECT: u32 = 1 << 20;
    pub const INDEX: u32 = 1 << 21;
    pub const TEMPLATE_LITERAL: u32 = 1 << 22;
    pub const STRING_MAPPING: u32 = 1 << 23;
    pub const SUBSTITUTION: u32 = 1 << 24;
    pub const INDEXED_ACCESS: u32 = 1 << 25;
    pub const CONDITIONAL: u32 = 1 << 26;
    pub const UNION: u32 = 1 << 27;
    pub const INTERSECTION: u32 = 1 << 28;

    pub const NULLABLE: u32 = UNDEFINED | NULL;
    pub const TYPE_VARIABLE: u32 = TYPE_PARAMETER | INDEXED_ACCESS;
    pub const UNION_OR_INTERSECTION: u32 = UNION | INTERSECTION;
    pub const SINGLETON: u32 = ANY
        | UNKNOWN
        | STRING
        | NUMBER
        | BOOLEAN
        | BIGINT
        | ES_SYMBOL
        | VOID
        | NULLABLE
        | NEVER
        | NON_PRIMITIVE;
    pub const LITERAL: u32 = STRING_LITERAL | NUMBER_LITERAL | BIGINT_LITERAL | BOOLEAN_LITERAL;
    pub const UNIT: u32 = ENUM | LITERAL | UNIQUE_ES_SYMBOL | NULLABLE;
    pub const STRING_LIKE: u32 = STRING | STRING_LITERAL | TEMPLATE_LITERAL | STRING_MAPPING;
    pub const NUMBER_LIKE: u32 = NUMBER | NUMBER_LITERAL | ENUM;
    pub const BIGINT_LIKE: u32 = BIGINT | BIGINT_LITERAL;
    pub const BOOLEAN_LIKE: u32 = BOOLEAN | BOOLEAN_LITERAL;
    pub const ENUM_LIKE: u32 = ENUM | ENUM_LITERAL;
    pub const ES_SYMBOL_LIKE: u32 = ES_SYMBOL | UNIQUE_ES_SYMBOL;
    pub const VOID_LIKE: u32 = VOID | UNDEFINED;
    pub const PRIMITIVE: u32 = STRING_LIKE
        | NUMBER_LIKE
        | BIGINT_LIKE
        | BOOLEAN_LIKE
        | ENUM_LIKE
        | ES_SYMBOL_LIKE
        | VOID_LIKE
        | NULL;
    pub const DEFINITELY_NON_NULLABLE: u32 = STRING_LIKE
        | NUMBER_LIKE
        | BIGINT_LIKE
        | BOOLEAN_LIKE
        | ENUM_LIKE
        | ES_SYMBOL_LIKE
        | OBJECT
        | NON_PRIMITIVE;
    pub const DISJOINT_DOMAINS: u32 = NON_PRIMITIVE
        | STRING_LIKE
        | NUMBER_LIKE
        | BIGINT_LIKE
        | BOOLEAN_LIKE
        | ES_SYMBOL_LIKE
        | VOID_LIKE
        | NULL;
    pub const INSTANTIABLE_NON_PRIMITIVE: u32 =
        TYPE_PARAMETER | INDEXED_ACCESS | CONDITIONAL | SUBSTITUTION;
    pub const INSTANTIABLE: u32 =
        INSTANTIABLE_NON_PRIMITIVE | INDEX | TEMPLATE_LITERAL | STRING_MAPPING;
    pub const STRUCTURED_OR_INSTANTIABLE: u32 = OBJECT
        | UNION
        | INTERSECTION
        | INSTANTIABLE_NON_PRIMITIVE
        | INDEX
        | TEMPLATE_LITERAL
        | STRING_MAPPING;

    // The flags accumulated from the constituents while an intersection is built. The last three
    // use bits that the mask omits.
    pub const INCLUDES_MASK: u32 = ANY
        | UNKNOWN
        | PRIMITIVE
        | NEVER
        | OBJECT
        | UNION
        | INTERSECTION
        | NON_PRIMITIVE
        | TEMPLATE_LITERAL
        | STRING_MAPPING;
    pub const INCLUDES_MISSING_TYPE: u32 = TYPE_PARAMETER;
    pub const INCLUDES_EMPTY_OBJECT: u32 = CONDITIONAL;
    pub const INCLUDES_WILDCARD: u32 = INDEXED_ACCESS;
    pub const INCLUDES_UNRESOLVED: u32 = 1 << 30;
    /// `TypeFlagsIncludesError`
    pub const INCLUDES_ERROR: u32 = 1 << 31;
}

bitflags::bitflags! {
    /// The `ObjectFlags` that are derived from a type's constituents, plus five that are specific
    /// to this checker.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ObjectFlags: u16 {
        /// It references a type parameter, so instantiation may change it. Exact, but for
        /// `Shape::has_no_instantiable_symbol`.
        const COULD_CONTAIN_TYPE_VARIABLES = 1;
        /// Is or contains `Unresolved`.
        const HAS_UNRESOLVED = 2;
        /// An intersection, or `ObjectFlagsContainsIntersections`.
        const MAY_BE_REDUCED = 128;
        const HAS_MARKER = 4;
        /// The type implied by a binding pattern counts too.
        const CONTAINS_OBJECT_OR_ARRAY_LITERAL = 8;
        /// Under strictNullChecks only `nonInferrableAnyType` has it. For the type of an object literal,
        /// `Origin::ObjectLiteral` or `Shape::contains_widening_type` stores it.
        const CONTAINS_WIDENING_TYPE = 16;
        /// `ObjectFlagsRequiresWidening`. `getPropagatingFlagsOfTypes` propagates the two to a
        /// reference, a union, an intersection and the type of a literal, and to nothing else.
        const REQUIRES_WIDENING = 8 | 16;
        /// `ObjectFlagsNonInferrableType`
        const NON_INFERRABLE_TYPE = 32;
        /// Is or contains an instantiated anonymous type with a type argument that has
        /// `NON_INFERRABLE_TYPE`. `instantiateAnonymousType` gives it the flag if that is a type
        /// argument of its alias, which only the checker knows where it is the alias of the type
        /// node: `Checker::is_non_inferrable` looks. It propagates like `NON_INFERRABLE_TYPE`.
        const NON_INFERRABLE_BY_ALIAS = 512;
        /// `ObjectFlagsPropagatingFlags`
        const PROPAGATING_FLAGS = 8 | 16 | 32 | 512;
        /// Is or contains a reverse mapped type. `couldContainTypeVariables` is true for every one,
        /// and `instantiateReverseMappedType` instantiates the mapped type it was inferred through,
        /// which references the inferred type parameter. The result is the same type or an
        /// equivalent copy, so `COULD_CONTAIN_TYPE_VARIABLES` is not set for it. But under
        /// `InferenceContext.mapper`, mapping that type parameter fixes it: `fixing_mapper` checks
        /// this flag.
        const HAS_REVERSE_MAPPED = 64;
        /// Is or contains a mapped type with `Provenance::stored_under` for which
        /// `couldContainTypeVariables` holds. Instantiation changes it although it references no
        /// type parameter: `getObjectTypeInstantiation` looks it up under its own key, where
        /// another type is. The same for a conditional type that stores an alias:
        /// `getConditionalTypeInstantiation` looks it up under the key without one. And for a union
        /// with `Provenance::has_other_instantiation`.
        const HAS_OTHER_INSTANTIATION = 256;
        /// An intersection of object types that are their own apparent types: any but a mapped type with type variables,
        /// which `getResolvedApparentTypeOfMappedType` may replace.
        const HAS_ONLY_OWN_APPARENT_TYPES = 1024;
    }
}

/// Distinguishes two types with the same constituents: it is part of a type's interning key, as in
/// `getUnionKey` and `getAliasKey`. `data` does not include it, so a named union is a
/// `TypeData::Union` of its members like any other.
#[derive(PartialEq, Eq, Hash, Debug, Default)]
pub struct Provenance<'s> {
    /// `Type.alias`
    pub alias: Option<(Sym, List<'s, TypeId>)>,
    /// `UnionType.origin`
    pub origin: UnionOrigin<'s>,
    /// `alias` is the enum it is the declared type of: `enumType.flags |= TypeFlagsEnumLiteral`.
    pub is_enum: bool,
    /// For a mapped type that `instantiateConstituent` created: the key under which
    /// `getObjectTypeInstantiation` stores the result of that `instantiateMappedType`. `None`: it
    /// is the key of the type itself, its type arguments and its alias. Also for a result that is
    /// a union of such types and could not contain type variables, and for a mapped type that is
    /// no longer under its key (`InstantiationKey::nesting`).
    pub stored_under: Option<InstantiationKey>,
    /// `ObjectFlagsArrayLiteral`: the clone of a type reference that `createArrayLiteralType`
    /// creates (`cloneTypeReference`), once per reference.
    pub is_array_literal: bool,
    /// `patternForType[t] != nil` for the clone of a tuple type that
    /// `getTypeFromArrayBindingPattern` creates with `includePatternInType`.
    pub is_array_pattern: bool,
    /// `couldContainTypeVariables`, for a union that `getUnionTypeWorker` creates with an alias and
    /// an `origin` of one type, a named union that has every member. `instantiateTypeWorker` does
    /// not return it unchanged, because it compares no alias with `alias`, and `getUnionTypeEx` of
    /// the one type is that type. Also for a union or an intersection with a constituent that has
    /// `ObjectFlags::HAS_OTHER_INSTANTIATION`, if `alias` has no type arguments and is not declared
    /// at the top level of a file (`isNonGenericTopLevelType`).
    pub has_other_instantiation: bool,
}

/// `getTypeInstantiationKey`, for `ObjectType.instantiations` of a mapped type.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct InstantiationKey {
    /// `typeArguments`, as `newMapper`.
    pub type_arguments: MapperId,
    /// `newAlias`, with its type arguments as a tuple. `None`: it is
    /// `instantiateTypeAlias(target.alias, newMapper)`.
    pub alias: Option<(Sym, TypeId)>,
    /// `ObjectFlagsCouldContainTypeVariables` of the type that is stored.
    pub could_contain_type_variables: bool,
    /// How many `getObjectTypeInstantiation` with this key were in progress around the one that
    /// created the type. None of them has found an entry, and each assigns `instantiations[key]`
    /// when it returns: the type that stays under the key is the one with 0.
    pub nesting: u8,
}

#[derive(PartialEq, Eq, Hash, Debug, Default)]
pub enum UnionOrigin<'s> {
    #[default]
    None,
    /// The named unions it was built from, and its remaining members, in the order of
    /// `CompareTypes`.
    Union(List<'s, TypeId>),
    /// The intersection it is the normal form of.
    Intersection(List<'s, TypeId>),
    /// The `keyof T` it is the keys of.
    Keyof(TypeId),
}

/// The interning key of a type.
type Made<'s> = (TypeData<'s>, Option<ArenaBox<'s, Provenance<'s>>>);

/// `TypeData` with its lists borrowed, for `Types::intern_key`: most types that are asked for exist
/// already, and the lists are copied to the arena only if the type is new.
#[derive(Copy, Clone)]
pub enum TypeKey<'a> {
    /// The data of another type.
    Data(&'a TypeData<'a>),
    Union(&'a [TypeId]),
    Intersection(&'a [TypeId]),
    Ref {
        target: Sym,
        args: &'a [TypeId],
    },
    Tuple {
        elems: &'a [TypeId],
        flags: &'a [ElemFlags],
        readonly: bool,
    },
    Fns {
        decls: &'a [(FileId, FnId)],
        mapper: MapperId,
    },
}

impl Hash for TypeKey<'_> {
    /// What `#[derive(Hash)]` writes for the `TypeData`: the discriminant, then the fields.
    fn hash<H: Hasher>(&self, state: &mut H) {
        use std::mem::discriminant;
        let given = discriminant(&TypeArguments::default());
        match *self {
            TypeKey::Data(data) => data.hash(state),
            TypeKey::Union(members) => {
                discriminant(&TypeData::Union(ShortList::empty())).hash(state);
                members.hash(state);
            }
            TypeKey::Intersection(members) => {
                discriminant(&TypeData::Intersection(ShortList::empty())).hash(state);
                members.hash(state);
            }
            TypeKey::Ref { target, args } => {
                let empty = TypeData::Ref {
                    target,
                    args: TypeArguments::default(),
                };
                discriminant(&empty).hash(state);
                target.hash(state);
                given.hash(state);
                args.hash(state);
            }
            TypeKey::Tuple {
                elems,
                flags,
                readonly,
            } => {
                let empty = TypeData::Tuple {
                    elems: TypeArguments::default(),
                    flags: List::empty(),
                    readonly,
                };
                discriminant(&empty).hash(state);
                given.hash(state);
                elems.hash(state);
                flags.hash(state);
                readonly.hash(state);
            }
            TypeKey::Fns { decls, mapper } => {
                let empty = TypeData::Fns {
                    decls: ShortList::empty(),
                    mapper,
                };
                discriminant(&empty).hash(state);
                decls.hash(state);
                mapper.hash(state);
            }
        }
    }
}

impl TypeKey<'_> {
    fn is(self, data: &TypeData) -> bool {
        match (self, data) {
            (TypeKey::Data(key), data) => key == data,
            (TypeKey::Union(key), TypeData::Union(list))
            | (TypeKey::Intersection(key), TypeData::Intersection(list)) => *key == **list,
            (
                TypeKey::Ref { target, args },
                TypeData::Ref {
                    target: of,
                    args: TypeArguments::Given(list),
                },
            ) => target == *of && *args == **list,
            (
                TypeKey::Tuple {
                    elems,
                    flags,
                    readonly,
                },
                TypeData::Tuple {
                    elems: TypeArguments::Given(list),
                    flags: of,
                    readonly: is,
                },
            ) => readonly == *is && *elems == **list && *flags == **of,
            (
                TypeKey::Fns { decls, mapper },
                TypeData::Fns {
                    decls: list,
                    mapper: of,
                },
            ) => mapper == *of && *decls == **list,
            _ => false,
        }
    }

    fn to_data<'s>(self, arena: &'s Arena) -> TypeData<'s> {
        let list = |types: &[TypeId]| ShortList::copy_from_slice_in(types, arena);
        match self {
            TypeKey::Data(data) => data.clone_in(arena),
            TypeKey::Union(members) => TypeData::Union(list(members)),
            TypeKey::Intersection(members) => TypeData::Intersection(list(members)),
            TypeKey::Ref { target, args } => TypeData::Ref {
                target,
                args: TypeArguments::given_in(args, arena),
            },
            TypeKey::Tuple {
                elems,
                flags,
                readonly,
            } => TypeData::Tuple {
                elems: TypeArguments::given_in(elems, arena),
                flags: List::copy_from_slice_in(flags, arena),
                readonly,
            },
            TypeKey::Fns { decls, mapper } => TypeData::Fns {
                decls: ShortList::copy_from_slice_in(decls, arena),
                mapper,
            },
        }
    }

    /// `Follow::mentions_own` of the `TypeData`. The label of an element of a tuple is a declared
    /// name.
    fn mentions_own(self) -> bool {
        match self {
            TypeKey::Data(data) => data.mentions_own(),
            TypeKey::Union(types)
            | TypeKey::Intersection(types)
            | TypeKey::Ref { args: types, .. }
            | TypeKey::Tuple { elems: types, .. } => types.iter().any(MaybeLocal::is_local),
            TypeKey::Fns { mapper, .. } => mapper.is_local(),
        }
    }
}

/// `UnionOrigin` with its list borrowed. The variants are in the same order: it is hashed like one.
#[derive(Copy, Clone, Hash)]
pub enum OriginKey<'a> {
    None,
    Union(&'a [TypeId]),
    Intersection(&'a [TypeId]),
    Keyof(TypeId),
}

impl<'a> From<&'a UnionOrigin<'a>> for OriginKey<'a> {
    fn from(origin: &'a UnionOrigin<'a>) -> Self {
        match origin {
            UnionOrigin::None => OriginKey::None,
            UnionOrigin::Union(types) => OriginKey::Union(types),
            UnionOrigin::Intersection(types) => OriginKey::Intersection(types),
            UnionOrigin::Keyof(ty) => OriginKey::Keyof(*ty),
        }
    }
}

/// `Provenance` with its lists borrowed. The fields are in the same order: it is hashed like one.
#[derive(Copy, Clone, Hash)]
pub struct ProvenanceKey<'a> {
    pub alias: Option<(Sym, &'a [TypeId])>,
    pub origin: OriginKey<'a>,
    pub is_enum: bool,
    pub stored_under: Option<InstantiationKey>,
    pub is_array_literal: bool,
    pub is_array_pattern: bool,
    pub has_other_instantiation: bool,
}

impl ProvenanceKey<'_> {
    fn is_default(self) -> bool {
        self.alias.is_none()
            && matches!(self.origin, OriginKey::None)
            && !self.is_enum
            && self.stored_under.is_none()
            && !self.is_array_literal
            && !self.is_array_pattern
            && !self.has_other_instantiation
    }

    fn is(self, provenance: &Provenance) -> bool {
        let is_same_alias = match (self.alias, &provenance.alias) {
            (None, None) => true,
            (Some((alias, arguments)), Some((of, list))) => alias == *of && *arguments == **list,
            _ => false,
        };
        let is_same_origin = match (self.origin, &provenance.origin) {
            (OriginKey::None, UnionOrigin::None) => true,
            (OriginKey::Union(key), UnionOrigin::Union(list))
            | (OriginKey::Intersection(key), UnionOrigin::Intersection(list)) => *key == **list,
            (OriginKey::Keyof(key), UnionOrigin::Keyof(ty)) => key == *ty,
            _ => false,
        };
        is_same_alias
            && is_same_origin
            && self.is_enum == provenance.is_enum
            && self.stored_under == provenance.stored_under
            && self.is_array_literal == provenance.is_array_literal
            && self.is_array_pattern == provenance.is_array_pattern
            && self.has_other_instantiation == provenance.has_other_instantiation
    }

    /// `Follow::mentions_own` of the `Provenance`.
    fn mentions_own(self) -> bool {
        let any = |types: &[TypeId]| types.iter().any(MaybeLocal::is_local);
        self.alias.is_some_and(|(_, arguments)| any(arguments))
            || match self.origin {
                OriginKey::None => false,
                OriginKey::Union(types) | OriginKey::Intersection(types) => any(types),
                OriginKey::Keyof(ty) => ty.is_local(),
            }
            || self.stored_under.mentions_own()
    }

    fn to_provenance<'s>(self, arena: &'s Arena) -> Provenance<'s> {
        let list = |types: &[TypeId]| List::copy_from_slice_in(types, arena);
        Provenance {
            alias: self
                .alias
                .map(|(alias, arguments)| (alias, list(arguments))),
            origin: match self.origin {
                OriginKey::None => UnionOrigin::None,
                OriginKey::Union(types) => UnionOrigin::Union(list(types)),
                OriginKey::Intersection(types) => UnionOrigin::Intersection(list(types)),
                OriginKey::Keyof(ty) => UnionOrigin::Keyof(ty),
            },
            is_enum: self.is_enum,
            stored_under: self.stored_under,
            is_array_literal: self.is_array_literal,
            is_array_pattern: self.is_array_pattern,
            has_other_instantiation: self.has_other_instantiation,
        }
    }
}

/// What `getUnionTypeEx`, `getIntersectionTypeEx` and `createTypeReferenceEx` set on a type only if they create it: the
/// first request decides. A bit set. A record has it from the start: `Types::as_first_request`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct FirstRequest(u8);

impl FirstRequest {
    pub const NONE: FirstRequest = FirstRequest(0);
    /// `ObjectFlagsFromTypeNode`
    pub const FROM_TYPE_NODE: FirstRequest = FirstRequest(1);
    /// No `ObjectFlagsPrimitiveUnion`, although every member is primitive.
    pub const WITHOUT_PRIMITIVE_UNION: FirstRequest = FirstRequest(1 << 1);
    /// `ObjectFlagsIsConstrainedTypeVariable`, or a request that has decided against it.
    pub const CONSTRAINED_TYPE_VARIABLE: FirstRequest = FirstRequest(1 << 2);
    pub const NO_CONSTRAINED_TYPE_VARIABLE: FirstRequest = FirstRequest(1 << 3);

    #[inline]
    fn has(self, flag: FirstRequest) -> bool {
        self.0 & flag.0 != 0
    }
}

pub struct TypeRecord<'s> {
    created: Made<'s>,
    /// `Type.flags`: `tf`.
    flags: u32,
    object_flags: ObjectFlags,
    /// A union or an intersection without type variables whose alias type arguments could contain
    /// some: `type Brand<T> = number & {}`. `instantiateTypeWithAlias` instantiates it, and
    /// `couldContainTypeVariables` is false for it.
    has_type_variables_in_alias_only: bool,
    /// See `Types::mark_from_type_node`.
    is_from_type_node: AtomicBool,
    /// See `Types::mark_ordered_by_id`.
    is_ordered_by_id: AtomicBool,
    /// See `Types::set_constrained_type_variable`: 0 until then, 1 for false, 2 for true.
    constrained_type_variable: std::sync::atomic::AtomicU8,
    /// `FirstRequest::WITHOUT_PRIMITIVE_UNION`
    is_without_primitive_union: bool,
    /// See `Types::mark_sorted_run`.
    is_sorted_run: AtomicBool,
    id: TypeId,
}

const _: () = assert!(size_of::<TypeRecord<'static>>() <= 64);

type MapperRecord<'s> = (Mapping<'s>, ObjectFlags);

/// Where a type comes in `Types::content_order`. Computed once, from the interning key, when the type is created. No id is
/// in it, so it is the same in every task, at every thread count and in every run.
#[derive(Copy, Clone)]
struct Rank {
    /// One more than the greatest height of a type that the key mentions, itself or through a mapper, a signature, an alias
    /// or an origin, and 1 if it mentions none. So a type comes after every type that it is made of.
    height: u32,
    /// The last piece of syntax that the key mentions, itself or through the types in it: the number of a file above the
    /// number of a node or a symbol in the file. 0 if it mentions none. tsgo creates a type when it comes to the syntax
    /// that asks for it, so of two types the one that mentions later syntax is mostly the one with the higher id.
    place: u64,
    /// A hash of the key in which a type counts as its own `content`, a mapper, a signature and a list of components as
    /// what they hold, an atom as its text, and a symbol or a node as its file and its number in the file.
    content: u64,
}

impl Rank {
    /// Of an id that has no type.
    const NONE: Rank = Rank {
        height: 0,
        place: 0,
        content: 0,
    };
}

/// What is asked of a type most often. A record is read for its `TypeData`.
#[derive(Copy, Clone)]
struct TypeSummary {
    flags: u32,
    object_flags: ObjectFlags,
    class: InstantiationClass,
    member_flags: u32,
    is_module_object: bool,
}

impl TypeSummary {
    /// Of an id that has no type.
    const NOTHING: TypeSummary = TypeSummary {
        flags: 0,
        object_flags: ObjectFlags::empty(),
        class: InstantiationClass::Unchanged,
        member_flags: 0,
        is_module_object: false,
    };

    /// What `Summaries::facts` has from the start.
    #[inline]
    fn facts(&self) -> u8 {
        match self.is_module_object {
            true => fact::IS_MODULE_OBJECT,
            false => 0,
        }
    }
}

/// The bits of `Summaries::facts`. A fact is written whole: the bit that says it is known together
/// with its value.
mod fact {
    /// Set when the type is created: see `Types::is_module_object`.
    pub(super) const IS_MODULE_OBJECT: u8 = 1 << 7;
    pub(super) const KNOWS_COULD_CONTAIN_TYPE_VARIABLES: u8 = 1;
    pub(super) const COULD_CONTAIN_TYPE_VARIABLES: u8 = 1 << 1;
    pub(super) const KNOWS_GENERIC_OBJECT_FLAGS: u8 = 1 << 2;
    pub(super) const IS_GENERIC_OBJECT_TYPE: u8 = 1 << 3;
    pub(super) const IS_GENERIC_INDEX_TYPE: u8 = 1 << 4;
    pub(super) const KNOWS_HAS_GENERIC_ARGUMENTS: u8 = 1 << 5;
    pub(super) const HAS_GENERIC_ARGUMENTS: u8 = 1 << 6;
}

/// `TypeRecord::summary` of the types of a store, by index: a column for each field, so that what is
/// read fills the cache lines.
///
/// The cells are atomic because `set` writes to one that `reserve` has added. `Relaxed` is enough for all of them: a thread
/// gets the id of a type through something that orders what its creator wrote before (`AppendVec`).
struct Summaries<L: Length, A: Allocator + Clone> {
    flags: Stable<AtomicU32, L, A>,
    /// `ObjectFlags::bits`
    object_flags: Stable<AtomicU16, L, A>,
    /// An `InstantiationClass` as a number.
    class: Stable<AtomicU8, L, A>,
    /// See `Types::member_flags`, and `HAS_FRESH_LITERAL` for the three bits beside the flags.
    member_flags: Stable<AtomicU32, L, A>,
    /// What the checker has found out about the type since it was created, and one bit that is set
    /// at once: `fact`. See `Types::add_facts` for what may be here. What was found out about a
    /// task-local type is not published with it.
    facts: Stable<AtomicU8, L, A>,
    /// The fields of `Rank`. Empty unless `TypeStore::orders_by_content`.
    heights: Stable<AtomicU32, L, A>,
    places: Stable<AtomicU64, L, A>,
    contents: Stable<AtomicU64, L, A>,
}

impl<L: Length, A: Allocator + Clone> Summaries<L, A> {
    fn new_in(alloc: A) -> Self {
        Summaries {
            flags: Stable::new_in(alloc.clone()),
            object_flags: Stable::new_in(alloc.clone()),
            member_flags: Stable::new_in(alloc.clone()),
            facts: Stable::new_in(alloc.clone()),
            heights: Stable::new_in(alloc.clone()),
            places: Stable::new_in(alloc.clone()),
            contents: Stable::new_in(alloc.clone()),
            class: Stable::new_in(alloc),
        }
    }

    #[inline]
    fn len(&self) -> u32 {
        self.class.len()
    }

    #[inline(always)]
    fn flags(&self, index: u32) -> u32 {
        self.flags.get(index).load(Ordering::Relaxed)
    }

    #[inline(always)]
    fn object_flags(&self, index: u32) -> ObjectFlags {
        ObjectFlags::from_bits_retain(self.object_flags.get(index).load(Ordering::Relaxed))
    }

    #[inline(always)]
    fn class(&self, index: u32) -> InstantiationClass {
        InstantiationClass::of_number(self.class.get(index).load(Ordering::Relaxed))
    }

    #[inline(always)]
    fn member_flags(&self, index: u32) -> u32 {
        self.member_flags.get(index).load(Ordering::Relaxed)
    }

    #[inline(always)]
    fn facts(&self, index: u32) -> &AtomicU8 {
        self.facts.get(index)
    }

    /// Only if every `push` had a rank.
    #[inline]
    fn rank(&self, index: u32) -> Rank {
        Rank {
            height: self.heights.get(index).load(Ordering::Relaxed),
            place: self.places.get(index).load(Ordering::Relaxed),
            content: self.contents.get(index).load(Ordering::Relaxed),
        }
    }

    /// Returns the index. One thread at a time: the columns are added to one after the other.
    /// `rank`: `Some` iff `TypeStore::orders_by_content`.
    #[inline]
    fn push(&self, summary: TypeSummary, rank: Option<Rank>) -> u32 {
        if let Some(rank) = rank {
            self.heights.push(AtomicU32::new(rank.height));
            self.places.push(AtomicU64::new(rank.place));
            self.contents.push(AtomicU64::new(rank.content));
        }
        self.flags.push(AtomicU32::new(summary.flags));
        (self.object_flags).push(AtomicU16::new(summary.object_flags.bits()));
        (self.member_flags).push(AtomicU32::new(summary.member_flags));
        self.facts.push(AtomicU8::new(summary.facts()));
        self.class.push(AtomicU8::new(summary.class as u8))
    }

    /// Adds `count` summaries, each of which `set` fills in once, and returns the index of the first. One thread at a
    /// time, like `push`. Every summary has a rank.
    fn reserve(&self, count: u32) -> u32 {
        let first = self.len();
        let (nothing, no_rank) = (TypeSummary::NOTHING, Rank::NONE);
        for _ in 0..count {
            self.push(nothing, Some(no_rank));
        }
        first
    }

    /// `index` comes from `reserve`, and no other thread has got it so far.
    fn set(&self, index: u32, summary: TypeSummary, rank: Rank) {
        let order = Ordering::Relaxed;
        self.heights.get(index).store(rank.height, order);
        self.places.get(index).store(rank.place, order);
        self.contents.get(index).store(rank.content, order);
        self.flags.get(index).store(summary.flags, order);
        (self.object_flags.get(index)).store(summary.object_flags.bits(), order);
        (self.member_flags.get(index)).store(summary.member_flags, order);
        self.facts.get(index).store(summary.facts(), order);
        self.class.get(index).store(summary.class as u8, order);
    }
}

/// What `instantiateTypeWithAlias` does with a type.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum InstantiationClass {
    /// Neither the type nor its alias type arguments could contain type variables.
    Unchanged,
    /// Looked up in the mapper.
    TypeParameter,
    Other,
}

impl InstantiationClass {
    /// The reverse of `as u8`.
    #[inline(always)]
    fn of_number(number: u8) -> InstantiationClass {
        match number {
            0 => InstantiationClass::Unchanged,
            1 => InstantiationClass::TypeParameter,
            _ => InstantiationClass::Other,
        }
    }
}

/// In `Summaries::member_flags`, beside the flags, none of which is one of these bits. See
/// `Types::has_fresh_literal`.
const HAS_FRESH_LITERAL: u32 = 1 << 29;
/// The type itself is an object type other than a mapped type or an evolving array type.
const IS_PLAIN_OBJECT: u32 = 1 << 30;
/// The type itself is a mapped type.
const IS_MAPPED_TYPE: u32 = 1 << 31;

impl TypeRecord<'_> {
    /// `member_flags_of`: `Summaries::member_flags` of a constituent.
    fn summary(&self, member_flags_of: impl Fn(TypeId) -> u32) -> TypeSummary {
        TypeSummary {
            flags: self.flags,
            object_flags: self.object_flags,
            class: self.instantiation_class(),
            is_module_object: matches!(
                self.created.0,
                TypeData::Anon {
                    origin: Origin::Module(_) | Origin::Namespace { .. },
                    ..
                }
            ),
            member_flags: match &self.created.0 {
                TypeData::Union(members) | TypeData::Intersection(members) => {
                    let all = members
                        .iter()
                        .fold(0, |flags, &member| flags | member_flags_of(member));
                    all & !(IS_PLAIN_OBJECT | IS_MAPPED_TYPE)
                }
                TypeData::Anon {
                    origin: Origin::Mapped(..),
                    ..
                } => self.flags | IS_MAPPED_TYPE,
                TypeData::Ref { .. }
                | TypeData::Tuple { .. }
                | TypeData::Anon { .. }
                | TypeData::Fns { .. }
                | TypeData::Synth(_)
                | TypeData::ReverseMapped { .. } => self.flags | IS_PLAIN_OBJECT,
                TypeData::StringLit { fresh: true, .. }
                | TypeData::NumberLit { fresh: true, .. }
                | TypeData::BigIntLit { fresh: true, .. }
                | TypeData::BoolLit { fresh: true, .. }
                | TypeData::EnumLit { fresh: true, .. }
                | TypeData::Enum { fresh: true, .. } => self.flags | HAS_FRESH_LITERAL,
                _ => self.flags,
            },
        }
    }

    fn instantiation_class(&self) -> InstantiationClass {
        let is_changed =
            ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES | ObjectFlags::HAS_OTHER_INSTANTIATION;
        if !self.object_flags.intersects(is_changed) && !self.has_type_variables_in_alias_only {
            return InstantiationClass::Unchanged;
        }
        match self.created.0 {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => {
                InstantiationClass::TypeParameter
            }
            _ => InstantiationClass::Other,
        }
    }
}

/// A record of one of the four kinds that `intern_record` creates.
trait Record: Sized {
    /// Whether the two have one interning key.
    fn is_same(&self, other: &Self) -> bool;
    /// What an id without a record stands for. It owns no memory.
    fn hole() -> Self;
}

impl Record for List<'_, IndexComponent> {
    fn is_same(&self, other: &Self) -> bool {
        **self == **other
    }
    fn hole() -> Self {
        List::empty()
    }
}

impl Record for MapperRecord<'_> {
    fn is_same(&self, other: &Self) -> bool {
        self.0 == other.0
    }
    fn hole() -> Self {
        (Mapping::empty(), ObjectFlags::empty())
    }
}

impl Record for SigData<'_> {
    fn is_same(&self, other: &Self) -> bool {
        self == other
    }
    fn hole() -> Self {
        SigData::WithReturn {
            sig: SigId(u32::MAX),
            ret: TypeId::UNRESOLVED,
        }
    }
}

impl Record for TypeRecord<'_> {
    fn is_same(&self, other: &Self) -> bool {
        self.created == other.created
    }
    fn hole() -> Self {
        TypeRecord {
            created: (TypeData::Intrinsic(Intrinsic::Unresolved), None),
            flags: 0,
            object_flags: ObjectFlags::empty(),
            has_type_variables_in_alias_only: false,
            is_from_type_node: AtomicBool::new(false),
            is_ordered_by_id: AtomicBool::new(false),
            constrained_type_variable: AtomicU8::new(0),
            is_without_primitive_union: false,
            is_sorted_run: AtomicBool::new(false),
            id: TypeId::UNRESOLVED,
        }
    }
}

/// The published records of one kind. `find` is lock-free and writes nothing.
///
/// `items` is read-only during a step: `add` is for the merge step.
///
/// `placed` is for a store that `shares_records`: tasks add to it while others read.
/// - A task reserves many ids at a time (`reserve`), under a lock, and then gives them to its records one by one. One
///   counter for all threads would be written by every creation. And the ids of two threads would alternate, so that
///   in every table keyed by them a cache line had cells of several threads.
/// - An id is final from the start, and says nothing about when its record was created. So nothing may follow the order of
///   ids: such a store `orders_by_content`.
/// - There is one record for a key at any time (`place`), so there is nothing to merge.
struct Interned<'s, V> {
    shards: Box<[GrowingPlaces<&'s Session>; INDEX_SHARDS], &'s Session>,
    items: AppendVec<V, &'s Session>,
    /// The records with the ids from `first_placed` on. An id that no record has got yet has an empty one.
    placed: AppendVec<OnceLock<V>, &'s Session>,
    /// More than any id: nothing is placed.
    first_placed: u32,
}

/// As many as threads can usefully fill at a barrier, and no more: see `shard_among`.
const INDEX_SHARDS: usize = 8;

impl<'s, V: Record> Interned<'s, V> {
    fn new_in(session: &'s Session) -> Self {
        let shards = std::array::from_fn(|_| GrowingPlaces::new_in(session));
        Interned {
            shards: Box::new_in(shards, session),
            items: AppendVec::new_in(session),
            placed: AppendVec::new_in(session),
            first_placed: u32::MAX,
        }
    }

    #[inline]
    fn shard(&self, spread: u64) -> &GrowingPlaces<&'s Session> {
        &self.shards[shard_among(spread, INDEX_SHARDS)]
    }

    /// The record with the id `id`, which is published.
    #[inline(always)]
    fn get(&self, id: u32) -> &V {
        match id.checked_sub(self.first_placed) {
            None => self.items.get(id),
            // Nobody has the id of an empty one. Whoever had would get a hole, for good.
            Some(at) => self.placed.get(at).get_or_init(V::hole),
        }
    }

    /// `spread`: the hash of the key being looked up.
    #[inline]
    fn find(&self, spread: u64, is_it: impl Fn(&V) -> bool) -> Option<u32> {
        let (shard, is_it) = (self.shard(spread), |i| is_it(self.get(i)));
        match self.first_placed {
            u32::MAX => shard.find_frozen(spread, is_it),
            _ => shard.find(spread, is_it),
        }
    }

    /// From now on nothing is added to `items`, and tasks `reserve` and `place`.
    fn place_from_here(&mut self) {
        self.first_placed = self.items.len();
    }

    /// `count` ids that nobody else has. Returns the first. One thread at a time.
    fn reserve(&self, count: u32) -> u32 {
        let first = self.first_placed + self.placed.len();
        for _ in 0..count {
            self.placed.push(OnceLock::new());
        }
        first
    }

    /// Publishes `record`, in which every id is published, unless another thread has published an equal one since the
    /// caller looked. Returns the id of the one that is published. `id`: from `reserve`, for this record alone. `spread`:
    /// its lookup hash.
    ///
    /// Under the lock of the shard of the index, so of two threads with one key one adds its id and the other finds it. The
    /// record of the other stays where it is, and nothing refers to it.
    fn place(&self, spread: u64, id: u32, record: V) -> u32 {
        let placed = (self.placed.get(id - self.first_placed)).get_or_init(|| record);
        self.shard(spread)
            .find_or_add(spread, |other| placed.is_same(self.get(other)), || id)
    }

    /// For `put`.
    fn halves(
        &self,
    ) -> (
        &[GrowingPlaces<&'s Session>],
        &AppendVec<V, &'s Session>,
        u32,
    ) {
        (&self.shards[..], &self.items, 0)
    }

    /// Assigns the next id to `item`, which must not be present yet. `spread`: its lookup hash.
    fn add(&self, spread: u64, item: V) -> u32 {
        self.shard(spread)
            .find_or_add(spread, |_| false, || self.items.push(item))
    }
}

crate::packed_ids!(TypeId, SigId, MapperId, ComponentsId);

impl MaybeLocal for Atom {
    #[inline]
    fn is_local(&self) -> bool {
        self.is_own()
    }
}

// ───────────────────────────── task-local records ─────────────────────────────

/// The kinds of records.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Atom,
    Components,
    Mapper,
    Sig,
    Type,
}

const KINDS: [Kind; 5] = [
    Kind::Atom,
    Kind::Components,
    Kind::Mapper,
    Kind::Sig,
    Kind::Type,
];

/// A set of indices.
struct Bits(Vec<u64>);

impl Bits {
    fn with_len(len: usize) -> Bits {
        Bits(vec![0; len.div_ceil(64)])
    }

    #[inline]
    fn has(&self, index: usize) -> bool {
        (self.0.get(index / 64)).is_some_and(|word| word >> (index % 64) & 1 != 0)
    }

    #[inline]
    fn set(&mut self, index: usize) {
        if index / 64 >= self.0.len() {
            self.0.resize(index / 64 + 1, 0);
        }
        self.0[index / 64] |= 1 << (index % 64);
    }
}

/// The task-local records of one kind. Their ids have `LOCAL` set, above the index bits.
struct Own<V> {
    /// They never move.
    records: LocalVec<V>,
    /// Lookup index for the task-local records, and for the published records the task has looked
    /// up before.
    found: Found,
    /// A bit for each record: whether it is bound. It references a node or a symbol of a file that
    /// nothing imports, or a record that does. Never published, so the HIR of such a file can be
    /// freed with its task. Empty for atoms.
    bound: LocalVec<Cell<u64>>,
    /// The ids that were looked up last, each at a position that its hash determines: the tag of the
    /// hash in the upper half and the id plus one in the lower half, like a slot of `Places`. Half
    /// to two thirds of all lookups find a record, mostly one of a few: this stays in the cache of
    /// the processor, `found` does not. Allocated by the first lookup.
    recent: std::cell::OnceCell<Box<[Cell<u64>]>>,
}

const RECENT: usize = 2048;

impl<V> Own<V> {
    fn new() -> Self {
        Own {
            records: LocalVec::new(),
            found: Found::default(),
            bound: LocalVec::new(),
            recent: std::cell::OnceCell::new(),
        }
    }

    /// The slot of `recent` for a hash. The tag is its low half, so the position is taken from the
    /// other half.
    #[inline]
    fn recent(&self, spread: u64) -> &Cell<u64> {
        let recent = self
            .recent
            .get_or_init(|| (0..RECENT).map(|_| Cell::new(0)).collect());
        &recent[(spread >> 32) as usize & (RECENT - 1)]
    }

    #[inline]
    fn push(&self, record: V, is_bound: bool) {
        let index = self.records.push(record);
        if index.is_multiple_of(64) {
            self.bound.push(Cell::new(0));
        }
        if is_bound {
            let word = self.bound.get(index / 64);
            word.set(word.get() | 1 << (index % 64));
        }
    }

    #[inline]
    fn is_bound(&self, index: u32) -> bool {
        self.bound.get(index / 64).get() >> (index % 64) & 1 != 0
    }
}

const KIND_SHIFT: u32 = 29;

/// What a task has to do with the records that tasks publish while others run: `TypeStore::shares_records`.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Sharing {
    /// No task of the program publishes any.
    Off,
    /// It finds those of the others. What it creates is its own.
    Finds,
    /// It publishes what it creates, when it creates it, unless that is bound.
    Publishes,
}

/// Where a new record goes.
#[derive(Copy, Clone)]
enum Home {
    /// To the task's own records.
    Own { is_bound: bool },
    /// To the published ones, under this id.
    Published(u32),
}

impl Home {
    /// The id of the record. `own`: the one that it has among the task's own.
    #[inline]
    fn id(self, own: u32) -> u32 {
        match self {
            Home::Own { .. } => own,
            Home::Published(id) => id,
        }
    }
}

/// All task-local records: atoms, lists of index components, mappers, signatures, types. A field of
/// `Task`. No other task sees it. At the end of the task `finish` extracts the records the task
/// publishes, and the rest is dropped with the task.
pub struct OwnStore<'s> {
    /// Of the thread that runs the task: for the lists of the records, which may be published.
    arena: &'s Arena,
    atoms: Own<List<'s, u8>>,
    components: Own<List<'s, IndexComponent>>,
    mappers: Own<MapperRecord<'s>>,
    sigs: Own<SigData<'s>>,
    types: Own<TypeRecord<'s>>,
    /// Every record, in creation order: the kind in the bits above the index. The records a record
    /// references come before it.
    log: LocalVec<u32>,
    /// Whether anything will read what the task publishes. If not, there is no `log`.
    is_read_later: bool,
    /// The files that the task has visited and that nothing imports, indexed by `FileId`. No other
    /// task can reference a node or a symbol of such a file. Empty: nothing is bound.
    unimported_files: Bits,
    /// See `Types::creation_order`.
    has_ordered_by_own_id: Cell<bool>,
    /// See `Types::is_unresolved_name`.
    has_unresolved_names: Cell<bool>,
    /// See `Types::as_first_request`.
    first_request: Cell<FirstRequest>,
    sharing: Sharing,
    /// `Sharing::Publishes`, by kind: the ids that the task has reserved and not used, from the first to before the second.
    ids: [Cell<(u32, u32)>; 5],
    /// .. and how many it has used.
    published: [Cell<u32>; 5],
    jitter: Jitter,
    /// How many times the task has come by a `Place`.
    times_at_a_place: Cell<u64>,
    summaries: Summaries<Cell<u32>, std::alloc::Global>,
}

impl<'s> OwnStore<'s> {
    /// `arena`: of the thread that runs the task.
    pub fn new_in(arena: &'s Arena) -> Self {
        OwnStore {
            arena,
            atoms: Own::new(),
            components: Own::new(),
            mappers: Own::new(),
            sigs: Own::new(),
            types: Own::new(),
            summaries: Summaries::new_in(std::alloc::Global),
            log: LocalVec::new(),
            is_read_later: true,
            unimported_files: Bits(Vec::new()),
            has_ordered_by_own_id: Cell::new(false),
            has_unresolved_names: Cell::new(false),
            first_request: Cell::new(FirstRequest::NONE),
            sharing: Sharing::Off,
            ids: Default::default(),
            published: Default::default(),
            jitter: Jitter::default(),
            times_at_a_place: Cell::new(0),
        }
    }

    /// Before anything is created.
    pub fn set_sharing(&mut self, sharing: Sharing) {
        debug_assert!(self.is_empty());
        self.sharing = sharing;
    }

    pub fn set_jitter(&mut self, jitter: Jitter) {
        self.jitter = jitter;
    }

    /// `task`: a number that no other task has, so that no two tasks wait alike.
    pub(crate) fn count_places_from(&self, task: u64) {
        self.times_at_a_place.set(task << 24);
    }

    #[inline]
    pub fn jitter(&self) -> Jitter {
        self.jitter
    }

    /// `Jitter::wait_at`. What a task does there is the same in every run with one seed.
    #[inline]
    pub(crate) fn wait_at(&self, place: Place) {
        if self.jitter.seed != 0 {
            let times = self.times_at_a_place.get().wrapping_add(1);
            self.times_at_a_place.set(times);
            self.jitter.wait_at(place, times);
        }
    }

    #[inline]
    pub fn sharing(&self) -> Sharing {
        self.sharing
    }

    /// The task is about to publish an atom. For `created`.
    #[inline]
    pub(crate) fn count_published_atom(&self) {
        let published = &self.published[Kind::Atom as usize];
        published.set(published.get() + 1);
    }

    /// The task is about to visit `file`, which nothing imports. From now on every record that
    /// references `file` is bound.
    pub fn add_unimported_file(&mut self, file: FileId) {
        self.unimported_files.set(file.0 as usize);
    }

    /// Before anything is created. `false`: `finish` will be given no marks.
    pub fn set_is_read_later(&mut self, is_read_later: bool) {
        debug_assert!(self.is_empty());
        self.is_read_later = is_read_later;
    }

    /// Nothing has been created.
    pub fn is_empty(&self) -> bool {
        self.lengths() == [0; 5]
    }

    #[inline]
    fn log(&self, kind: Kind, index: u32) {
        if self.is_read_later {
            self.log.push((kind as u32) << KIND_SHIFT | index);
        }
    }

    /// The text of a task-local atom.
    #[inline]
    pub(crate) fn atom_bytes(&self, atom: Atom) -> &[u8] {
        self.atoms.records.get(atom.0 & !LOCAL)
    }

    /// The task-local atom for `text`, if there is one. `spread`: the hash of `text`.
    #[inline]
    pub(crate) fn find_atom(&self, spread: u64, text: &[u8]) -> Option<Atom> {
        let is_it = |id: u32| **self.atoms.records.get(id & !LOCAL) == *text;
        self.atoms.found.find(spread, is_it).map(Atom)
    }

    /// The atom for `text`, which is not published.
    pub(crate) fn intern_atom(&self, spread: u64, text: &[u8]) -> Atom {
        if let Some(atom) = self.find_atom(spread, text) {
            return atom;
        }
        let text = List::copy_from_slice_in(text, self.arena);
        let index = self.atoms.records.push(text);
        self.log(Kind::Atom, index);
        self.atoms.found.add(spread, index | LOCAL);
        Atom(index | LOCAL)
    }
}

/// Accessor for the records of one kind.
type Of<'s, V> = for<'a> fn(&'a OwnStore<'s>) -> &'a Own<V>;

/// Looks up `key` among the task-local records and the published ones, or else creates a new
/// record.
/// `is_it`: whether a record matches `key`. `make`: builds the record for `key`, given the id that it
/// has if it is task-local, and returns where it goes (`Types::home_of`). `mentions_own`: whether
/// `key` is known to reference a task-local record, which no published record does. It is asked once
/// the task-local records have been searched.
#[inline]
fn intern_record<'s, V: Record, K>(
    (published, own, kind): (&Interned<'s, V>, &OwnStore<'s>, Kind),
    of: Of<'s, V>,
    (spread, key): (u64, K),
    mentions_own: impl FnOnce(&K) -> bool,
    is_it: impl Fn(&V, &K) -> bool,
    make: impl FnOnce(K, u32) -> (V, Home),
) -> u32 {
    let mine = of(own);
    let is_record = |id: u32| {
        let record = if id & LOCAL == 0 {
            published.get(id)
        } else {
            mine.records.get(id & !LOCAL)
        };
        is_it(record, &key)
    };
    let recent = mine.recent(spread);
    let held = recent.get();
    if held != 0 && (held >> 32) as u32 == spread as u32 && is_record(held as u32 - 1) {
        return held as u32 - 1;
    }
    let remember = |id: u32| recent.set(place_of(spread, id));
    let vacancy = match mine.found.find_or_vacancy(spread, is_record) {
        Ok(id) => {
            remember(id);
            return id;
        }
        Err(vacancy) => vacancy,
    };
    let find_published = || published.find(spread, |record| is_it(record, &key));
    let known = if mentions_own(&key) {
        assert!(
            !CHECKS_THE_LOOKUPS_IT_SKIPS || find_published().is_none(),
            "a published record equals a key that references a task-local record"
        );
        None
    } else {
        find_published()
    };
    let id = match known {
        Some(id) => id,
        None => {
            let index = mine.records.len();
            match make(key, index | LOCAL) {
                (record, Home::Own { is_bound }) => {
                    own.log(kind, index);
                    mine.push(record, is_bound);
                    index | LOCAL
                }
                (record, Home::Published(id)) => {
                    let id = published.place(spread, id, record);
                    own.wait_at(Place::RecordPublished);
                    id
                }
            }
        }
    };
    mine.found.fill(vacancy, spread, id);
    remember(id);
    id
}

/// `false`: a type or a signature that the task does not have is looked up among the published
/// ones whatever its key references.
const SKIPS_LOOKUPS_OF_OWN_KEYS: bool = true;

/// `true`: a lookup that `intern_record` skips is made all the same, and must find nothing.
const CHECKS_THE_LOOKUPS_IT_SKIPS: bool = false;

/// The pairs of a mapper, in order (`is_in_order`). Three quarters or more of all mappers have at most
/// three.
pub type Mapping<'s> = ShortList<(TypeId, TypeId), 3, List<'s, (TypeId, TypeId)>>;

/// The interning key of a mapper.
struct Pairs<'a>(&'a [(TypeId, TypeId)]);

impl std::hash::Hash for Pairs<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        state.write_usize(self.0.len());
        for pair in self.0 {
            state.write_u64(u64::from(pair.0.0) << 32 | u64::from(pair.1.0));
        }
    }
}

/// Whether the type parameters are sorted by id without duplicates. That order makes equal sets of
/// pairs intern as one mapper and lets `map` search. The merge step re-sorts the pairs: `follow`
/// does not preserve the order of ids.
#[inline]
fn is_in_order(pairs: &[(TypeId, TypeId)]) -> bool {
    pairs.is_sorted_by(|a, b| a.0.arrival_order() < b.0.arrival_order())
}

/// The shared store: the published types, signatures, type mappers and lists of index components.
/// Read-only during a step: a lookup is lock-free and writes nothing. Task-local records are in the
/// task's `OwnStore`. `link`, at the barrier, is the only writer, but for `Types::add_facts`.
///
/// - A record consists of its interning key and flags computed from the key, so it does not depend
///   on which task created it.
/// - Published ids are deterministic for a given program: `link` numbers the new records by (task,
///   index in the task's creation order). A task-local id sorts after every published one
///   (`LOCAL`), in the task's creation order. So the order of ids is creation order, as in tsgo.
/// - A new record never equals a published one. If everything it references were published, the
///   lookup would have found it, and a new record that it references is in no published record. So
///   duplicates exist only between the tasks of one step, and `link` merges them.
/// - Anything that changes the behaviour of a type is in its interning key, or is computed from the
///   key.
///
/// In a store that `shares_records`, tasks add records too, at any time, and `link` has nothing to do: see `Interned`. The
/// second and the third point do not hold there.
pub struct TypeStore<'s> {
    session: &'s Session,
    types: Interned<'s, TypeRecord<'s>>,
    summaries: Summaries<std::sync::atomic::AtomicU32, &'s Session>,
    sigs: Interned<'s, SigData<'s>>,
    mappers: Interned<'s, MapperRecord<'s>>,
    components: Interned<'s, List<'s, IndexComponent>>,
    /// The string literal types, regular and fresh, indexed by their value. There is one for nearly
    /// every string in a program. They are not in the hash index of `types`.
    string_literals: [ById<Atom, TypeId, Frozen, &'s Session>; 2],
    /// See `Types::is_unresolved_name`.
    has_unresolved_names: AtomicBool,
    /// `Some`: `Types::creation_order` is `Types::content_order`, and every type has a `Rank`. It has the texts of the
    /// published atoms, which a rank is made of.
    texts: Option<Interner<'s>>,
    /// `reserve_ids`: what tasks have given back, by kind. The lock is also held while ids are reserved.
    spare_ids: Guarded<[Vec<(u32, u32)>; 5]>,
}

/// See `Types::first_new_type_id`: how many types the task had created, its own and published ones.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct NewTypes {
    own: u32,
    published: u32,
}

/// The shared store together with the task-local store, which is all that a task sees.
/// `Checker::types` creates one.
#[derive(Copy, Clone)]
pub struct Types<'p, 's> {
    published: &'p TypeStore<'s>,
    own: &'p OwnStore<'s>,
}

macro_rules! well_known {
    ($($name:ident = $data:expr,)*) => {
        impl TypeId {
            well_known!(@consts 0u32; $($name,)*);
        }
        const WELL_KNOWN: &[TypeData<'static>] = &[$($data),*];
    };
    (@consts $n:expr; $name:ident, $($rest:ident,)*) => {
        pub const $name: TypeId = TypeId($n);
        well_known!(@consts $n + 1u32; $($rest,)*);
    };
    (@consts $n:expr;) => {};
}

well_known! {
    UNRESOLVED = TypeData::Intrinsic(Intrinsic::Unresolved),
    ANY = TypeData::Intrinsic(Intrinsic::Any),
    UNKNOWN = TypeData::Intrinsic(Intrinsic::Unknown),
    NEVER = TypeData::Intrinsic(Intrinsic::Never),
    VOID = TypeData::Intrinsic(Intrinsic::Void),
    UNDEFINED = TypeData::Intrinsic(Intrinsic::Undefined),
    MISSING = TypeData::Intrinsic(Intrinsic::Missing),
    UNDEFINED_WIDENING = TypeData::Intrinsic(Intrinsic::UndefinedWidening),
    NULL = TypeData::Intrinsic(Intrinsic::Null),
    NULL_WIDENING = TypeData::Intrinsic(Intrinsic::NullWidening),
    STRING = TypeData::Intrinsic(Intrinsic::String),
    NUMBER = TypeData::Intrinsic(Intrinsic::Number),
    BIGINT = TypeData::Intrinsic(Intrinsic::BigInt),
    SYMBOL = TypeData::Intrinsic(Intrinsic::Symbol),
    OBJECT = TypeData::Intrinsic(Intrinsic::Object),
    FALSE = TypeData::BoolLit { value: false, fresh: false },
    TRUE = TypeData::BoolLit { value: true, fresh: false },
    FRESH_FALSE = TypeData::BoolLit { value: false, fresh: true },
    FRESH_TRUE = TypeData::BoolLit { value: true, fresh: true },
    MARKER_SUPER = TypeData::Marker(Marker::Super),
    MARKER_SUB = TypeData::Marker(Marker::Sub),
    MARKER_OTHER = TypeData::Marker(Marker::Other),
    // `markerSuperTypeForCheck`, `markerSubTypeForCheck`: `checkTypeParameterDeferred` verifies an `in` / `out` annotation with these.
    MARKER_SUPER_FOR_CHECK = TypeData::Marker(Marker::SuperForCheck),
    MARKER_SUB_FOR_CHECK = TypeData::Marker(Marker::SubForCheck),
    SILENT_NEVER = TypeData::Intrinsic(Intrinsic::SilentNever),
    UNREACHABLE_NEVER = TypeData::Intrinsic(Intrinsic::UnreachableNever),
    IMPLICIT_NEVER = TypeData::Intrinsic(Intrinsic::ImplicitNever),
    AUTO = TypeData::Intrinsic(Intrinsic::Auto),
    ERROR = TypeData::Intrinsic(Intrinsic::Error),
    INTRINSIC_MARKER = TypeData::Intrinsic(Intrinsic::IntrinsicMarker),
    WILDCARD = TypeData::Intrinsic(Intrinsic::Wildcard),
    NON_INFERRABLE_ANY = TypeData::Intrinsic(Intrinsic::NonInferrableAny),
    UNIQUE_LITERAL = TypeData::Intrinsic(Intrinsic::UniqueLiteral),
}

impl TypeId {
    /// The id as a number, for set operations: sort to deduplicate, binary search for membership.
    /// The id types do not implement `Ord`, so that a list stored in id order cannot be created by
    /// accident: `follow` does not preserve that order, so the merge step has to re-sort such a
    /// list. For creation order: `Types::creation_order`.
    #[inline]
    pub fn arrival_order(self) -> u32 {
        self.0
    }

    /// `false | true`
    pub const BOOLEAN: TypeId = TypeId(WELL_KNOWN.len() as u32);
    /// `emptyObjectType`, see `Literalness::EmptyObject`
    pub const EMPTY_OBJECT: TypeId = TypeId(WELL_KNOWN.len() as u32 + 1);
    /// `unknownEmptyObjectType`, see `Literalness::OfUnknown`
    pub const UNKNOWN_EMPTY_OBJECT: TypeId = TypeId(WELL_KNOWN.len() as u32 + 2);
    /// `emptyTypeLiteralType`, see `Literalness::EmptyTypeLiteral`
    pub const EMPTY_TYPE_LITERAL: TypeId = TypeId(WELL_KNOWN.len() as u32 + 3);

    /// `undefined` and `null` have variants that flags, facts and relations do not distinguish:
    /// returns the ordinary variant.
    #[inline]
    pub fn plain(self) -> TypeId {
        match self {
            TypeId::MISSING | TypeId::UNDEFINED_WIDENING => TypeId::UNDEFINED,
            TypeId::NULL_WIDENING => TypeId::NULL,
            ty => ty,
        }
    }

    /// `TypeFlagsAny`
    #[inline]
    pub fn is_any(self) -> bool {
        matches!(
            self,
            TypeId::ANY
                | TypeId::ERROR
                | TypeId::AUTO
                | TypeId::INTRINSIC_MARKER
                | TypeId::WILDCARD
                | TypeId::NON_INFERRABLE_ANY
        )
    }

    /// `TypeFlagsNever`: `neverType`, `silentNeverType`, `unreachableNeverType`,
    /// `implicitNeverType` or `uniqueLiteralType`.
    #[inline]
    pub fn is_never(self) -> bool {
        matches!(
            self,
            TypeId::NEVER
                | TypeId::SILENT_NEVER
                | TypeId::UNREACHABLE_NEVER
                | TypeId::IMPLICIT_NEVER
                | TypeId::UNIQUE_LITERAL
        )
    }

    /// `TypeFlagsUndefined`
    #[inline]
    pub fn is_undefined(self) -> bool {
        self.plain() == TypeId::UNDEFINED
    }

    /// `TypeFlagsNull`
    #[inline]
    pub fn is_null(self) -> bool {
        self.plain() == TypeId::NULL
    }
}

impl MapperId {
    pub const IDENTITY: MapperId = MapperId(0);
}

impl ComponentsId {
    /// The empty list.
    pub const NONE: ComponentsId = ComponentsId(0);
}

impl<'s> TypeStore<'s> {
    pub fn new_in(session: &'s Session) -> Self {
        Self::with_order_in(session, None)
    }

    /// `new_in`, for a store in which `Types::creation_order` is `Types::content_order`. `atoms`: of the program.
    pub fn ordered_by_content_in(session: &'s Session, atoms: Interner<'s>) -> Self {
        Self::with_order_in(session, Some(atoms))
    }

    fn with_order_in(session: &'s Session, texts: Option<Interner<'s>>) -> Self {
        let store = TypeStore {
            session,
            types: Interned::new_in(session),
            summaries: Summaries::new_in(session),
            sigs: Interned::new_in(session),
            mappers: Interned::new_in(session),
            components: Interned::new_in(session),
            string_literals: [ById::new_in(session), ById::new_in(session)],
            has_unresolved_names: AtomicBool::new(false),
            texts,
            spare_ids: Guarded::default(),
        };
        // First: the flags of a type are those of its mapper too.
        let no_pairs = (Mapping::empty(), ObjectFlags::empty());
        assert_eq!(
            store.mappers.add(spread_hash(&Pairs(&[])), no_pairs),
            MapperId::IDENTITY.0
        );
        let arena = session.arena();
        let publish = |data: TypeData<'s>| store.publish_constant(data);
        for (i, data) in WELL_KNOWN.iter().enumerate() {
            assert_eq!(publish(data.clone_in(arena)).0 as usize, i);
        }
        let booleans = ShortList::copy_from_slice_in(&[TypeId::FALSE, TypeId::TRUE], arena);
        assert_eq!(publish(TypeData::Union(booleans)), TypeId::BOOLEAN);
        let synth = |shape| TypeData::Synth(ArenaBox::new_in(shape, arena));
        assert_eq!(
            publish(synth(Shape {
                literal: Literalness::EmptyObject,
                ..Shape::new_in(arena)
            })),
            TypeId::EMPTY_OBJECT
        );
        assert_eq!(
            publish(synth(Shape {
                literal: Literalness::OfUnknown,
                ..Shape::new_in(arena)
            })),
            TypeId::UNKNOWN_EMPTY_OBJECT
        );
        assert_eq!(
            publish(synth(Shape {
                literal: Literalness::EmptyTypeLiteral,
                ..Shape::new_in(arena)
            })),
            TypeId::EMPTY_TYPE_LITERAL
        );
        let no_components = List::<IndexComponent>::empty();
        assert_eq!(
            (store.components).add(spread_hash(&no_components), no_components),
            ComponentsId::NONE.0
        );
        store
    }

    /// Publishes a type whose id is known to every task of the program. Called before the first
    /// step, on one thread. Everything it references is published.
    pub fn publish_constant(&self, data: TypeData<'s>) -> TypeId {
        debug_assert!(!self.shares_records());
        let created = (data, None);
        let spread = spread_hash(&created);
        if let Some(id) = self.types.find(spread, |record| record.created == created) {
            return TypeId(id);
        }
        let own = OwnStore::new_in(self.session.arena());
        let record = Types::new(self, &own).new_record(created, self.types.items.len());
        let id = TypeId(self.types.add(spread, record));
        self.summarize_types(self.types.items.len());
        id
    }

    /// Adds to `summaries` those of the types with an id less than `below`, which are all stored.
    /// Between steps, on one thread.
    fn summarize_types(&self, below: u32) {
        // For the ranks. Everything that a published record references is published.
        let own = (self.orders_by_content() && self.summaries.len() < below)
            .then(|| OwnStore::new_in(self.session.arena()));
        let types = own.as_ref().map(|own| Types::new(self, own));
        for id in self.summaries.len()..below {
            // What a record references has a lower id.
            let record = self.types.items.get(id);
            let summary = record.summary(|member| {
                debug_assert!(member.0 < id);
                self.summaries.member_flags(member.0)
            });
            let rank = types.map(|types| types.rank_of_type(&record.created));
            self.summaries.push(summary, rank);
        }
    }

    /// See `Types::creation_order`.
    #[inline]
    pub fn orders_by_content(&self) -> bool {
        self.texts.is_some()
    }

    /// From now on a task with `Sharing::Publishes` publishes a record when it creates it: see `Interned`. After the last
    /// `publish_constant`, before the first task. Only for a store that `orders_by_content`. `link` has nothing to do then.
    pub fn share_records(&mut self) {
        debug_assert!(self.orders_by_content());
        self.components.place_from_here();
        self.mappers.place_from_here();
        self.sigs.place_from_here();
        self.types.place_from_here();
    }

    #[inline]
    pub fn shares_records(&self) -> bool {
        self.types.first_placed != u32::MAX
    }

    /// See `Program::release`.
    pub fn release(&mut self) {
        *self.spare_ids.get_mut() = Default::default();
    }

    /// The id of the next record of the kind `kind` that the task of `own` publishes.
    #[inline]
    fn next_id(&self, kind: Kind, own: &OwnStore<'s>) -> u32 {
        let ids = &own.ids[kind as usize];
        let (mut next, mut end) = ids.get();
        if next == end {
            (next, end) = self.reserve_ids(kind);
            own.wait_at(Place::IdsTaken);
        }
        ids.set((next + 1, end));
        let published = &own.published[kind as usize];
        published.set(published.get() + 1);
        next
    }

    /// Ids that no other task has, from the first to before the second: what a task has given back, or new ones.
    #[cold]
    #[inline(never)]
    fn reserve_ids(&self, kind: Kind) -> (u32, u32) {
        let mut spare = self.spare_ids.lock();
        if let Some(ids) = spare[kind as usize].pop() {
            return ids;
        }
        // Under the lock, so that the ids are consecutive, and a type and its summary have one index.
        let count = IDS_RESERVED_AT_A_TIME[kind as usize];
        let first = match kind {
            Kind::Atom => 0,
            Kind::Components => self.components.reserve(count),
            Kind::Mapper => self.mappers.reserve(count),
            Kind::Sig => self.sigs.reserve(count),
            Kind::Type => {
                let first = self.types.reserve(count);
                let of_summaries = self.summaries.reserve(count);
                debug_assert_eq!(first, of_summaries);
                first
            }
        };
        (first, first + count)
    }

    /// At the end of a task: the ids that it has reserved and not used are for the next one.
    pub fn take_back_ids(&self, own: &OwnStore<'s>) {
        if own.sharing != Sharing::Publishes {
            return;
        }
        let mut spare = self.spare_ids.lock();
        for (ids, spare) in own.ids.iter().zip(spare.iter_mut()) {
            let (next, end) = ids.replace((0, 0));
            if next != end {
                spare.push((next, end));
            }
        }
    }
}

/// `TypeStore::reserve_ids`, in the order of `KINDS`. Atoms are numbered one by one: a task creates few.
const IDS_RESERVED_AT_A_TIME: [u32; 5] = [0, 32, 512, 256, 1024];

impl<'p, 's> Types<'p, 's> {
    #[inline(always)]
    pub fn new(published: &'p TypeStore<'s>, own: &OwnStore<'s>) -> Types<'p, 's> {
        // SAFETY: task-local records never move and live as long as the task, and no reference that
        // a task returns outlives it: `finish` takes `&mut OwnStore`. So a reference to a
        // task-local record is returned like one to a published record.
        let own = unsafe { &*std::ptr::from_ref(own) };
        Types { published, own }
    }

    /// A copy of `items` to store in a type, a signature or a value of a table.
    #[inline]
    pub fn list<T: Copy>(&self, items: &[T]) -> List<'s, T> {
        List::copy_from_slice_in(items, self.own.arena)
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &'p TypeData<'s> {
        &self.record(id).created.0
    }

    /// `t.AsTypeReference().node != nil`: the components of the deferred type reference `id`,
    /// resolved or not.
    #[inline]
    pub fn deferred(&self, id: TypeId) -> Option<&'p DeferredTypeArguments> {
        match self.get(id) {
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => args.as_deferred(),
            _ => None,
        }
    }

    /// The members of a union, an empty list for `never`, and any other type as a single element.
    #[inline]
    pub fn parts(&self, id: TypeId) -> &'p [TypeId] {
        let record = self.record(id);
        match &record.created.0 {
            TypeData::Union(members) => members,
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::UniqueLiteral,
            ) => &[],
            _ => std::slice::from_ref(&record.id),
        }
    }

    /// Most programs have no `TypeData::UnresolvedName`, which is known without inspecting the
    /// type.
    #[inline]
    pub fn is_unresolved_name(&self, id: TypeId) -> bool {
        let published = &self.published.has_unresolved_names;
        (self.own.has_unresolved_names.get() || published.load(Ordering::Relaxed))
            && matches!(self.get(id), TypeData::UnresolvedName { .. })
    }

    #[inline]
    pub fn flags(&self, id: TypeId) -> u32 {
        if id.0 & LOCAL == 0 {
            self.published.summaries.flags(id.0)
        } else {
            self.own.summaries.flags(id.0 & !LOCAL)
        }
    }

    #[inline]
    pub fn object_flags(&self, id: TypeId) -> ObjectFlags {
        if id.0 & LOCAL == 0 {
            self.published.summaries.object_flags(id.0)
        } else {
            self.own.summaries.object_flags(id.0 & !LOCAL)
        }
    }

    #[inline]
    pub fn instantiation_class(&self, id: TypeId) -> InstantiationClass {
        if id.0 & LOCAL == 0 {
            self.published.summaries.class(id.0)
        } else {
            self.own.summaries.class(id.0 & !LOCAL)
        }
    }

    /// `Type.flags` of everything that `maybeTypeOfKind` gets to in `id`, taken together: of a
    /// union or an intersection, the `member_flags` of its constituents, without its own flags. Of
    /// any other type, its flags.
    #[inline]
    pub fn member_flags(&self, id: TypeId) -> u32 {
        self.member_flags_and_more(id) & !(HAS_FRESH_LITERAL | IS_PLAIN_OBJECT | IS_MAPPED_TYPE)
    }

    /// Whether `id` is a fresh literal type, or there is one in it where `member_flags` looks.
    #[inline]
    pub fn has_fresh_literal(&self, id: TypeId) -> bool {
        self.member_flags_and_more(id) & HAS_FRESH_LITERAL != 0
    }

    /// Whether `id` is an object type other than a mapped type or an evolving array type.
    #[inline]
    pub fn is_plain_object(&self, id: TypeId) -> bool {
        self.member_flags_and_more(id) & IS_PLAIN_OBJECT != 0
    }

    #[inline]
    pub fn is_mapped_type(&self, id: TypeId) -> bool {
        self.member_flags_and_more(id) & IS_MAPPED_TYPE != 0
    }

    /// Whether `id` is an object type other than an evolving array type.
    #[inline]
    pub fn is_object_type(&self, id: TypeId) -> bool {
        self.member_flags_and_more(id) & (IS_PLAIN_OBJECT | IS_MAPPED_TYPE) != 0
    }

    #[inline]
    fn member_flags_and_more(&self, id: TypeId) -> u32 {
        if id.0 & LOCAL == 0 {
            self.published.summaries.member_flags(id.0)
        } else {
            self.own.summaries.member_flags(id.0 & !LOCAL)
        }
    }

    /// `flags`, worked out from the record of the type.
    #[inline]
    pub fn flags_of_record(&self, id: TypeId) -> u32 {
        Self::flags_of(&self.record(id).created)
    }

    /// `Relaxed` is enough, here and in `add_facts`: a fact is in one byte and is written whole, so
    /// a reader sees all of it or nothing, and nothing else is read on the strength of it.
    #[inline]
    fn facts(&self, id: TypeId) -> u8 {
        if id.0 & LOCAL == 0 {
            (self.published.summaries.facts(id.0)).load(Ordering::Relaxed)
        } else {
            (self.own.summaries.facts(id.0 & !LOCAL)).load(Ordering::Relaxed)
        }
    }

    /// Only for a function of the interning key of `id` and of the program that is computed without
    /// resolving anything: no type, signature or mapper is created for it, no query is made and no
    /// counter moves. Then a task cannot tell whether it reads the fact or computes it, so it does
    /// not matter which task has written it, or when, into a published type too.
    #[inline]
    fn add_facts(&self, id: TypeId, facts: u8) {
        if id.0 & LOCAL == 0 {
            (self.published.summaries.facts(id.0)).fetch_or(facts, Ordering::Relaxed);
        } else {
            let known = self.own.summaries.facts(id.0 & !LOCAL);
            known.store(known.load(Ordering::Relaxed) | facts, Ordering::Relaxed);
        }
    }

    /// Whether `id` is the type of a module or of a namespace as a value.
    #[inline]
    pub fn is_module_object(&self, id: TypeId) -> bool {
        self.facts(id) & fact::IS_MODULE_OBJECT != 0
    }

    /// `ObjectFlagsCouldContainTypeVariables`, if `ObjectFlagsCouldContainTypeVariablesComputed`.
    #[inline]
    pub fn could_contain_type_variables(&self, id: TypeId) -> Option<bool> {
        let facts = self.facts(id);
        (facts & fact::KNOWS_COULD_CONTAIN_TYPE_VARIABLES != 0)
            .then_some(facts & fact::COULD_CONTAIN_TYPE_VARIABLES != 0)
    }

    /// See `add_facts`.
    #[inline]
    pub fn set_could_contain_type_variables(&self, id: TypeId, could_contain: bool) {
        let value = match could_contain {
            true => fact::COULD_CONTAIN_TYPE_VARIABLES,
            false => 0,
        };
        self.add_facts(id, fact::KNOWS_COULD_CONTAIN_TYPE_VARIABLES | value);
    }

    /// `ObjectFlagsIsGenericObjectType` and `ObjectFlagsIsGenericIndexType`, if
    /// `set_generic_object_flags` has been called.
    #[inline]
    pub fn generic_object_flags(&self, id: TypeId) -> Option<(bool, bool)> {
        let facts = self.facts(id);
        (facts & fact::KNOWS_GENERIC_OBJECT_FLAGS != 0).then_some((
            facts & fact::IS_GENERIC_OBJECT_TYPE != 0,
            facts & fact::IS_GENERIC_INDEX_TYPE != 0,
        ))
    }

    /// See `add_facts`: not for a type in which `getGenericObjectFlags` gets to a mapped type, whose
    /// constraint type it resolves.
    #[inline]
    pub fn set_generic_object_flags(&self, id: TypeId, (object, index): (bool, bool)) {
        let mut facts = fact::KNOWS_GENERIC_OBJECT_FLAGS;
        if object {
            facts |= fact::IS_GENERIC_OBJECT_TYPE;
        }
        if index {
            facts |= fact::IS_GENERIC_INDEX_TYPE;
        }
        self.add_facts(id, facts);
    }

    /// `Checker::has_generic_arguments`, if `set_has_generic_arguments` has been called.
    #[inline]
    pub fn has_generic_arguments(&self, id: TypeId) -> Option<bool> {
        let facts = self.facts(id);
        (facts & fact::KNOWS_HAS_GENERIC_ARGUMENTS != 0)
            .then_some(facts & fact::HAS_GENERIC_ARGUMENTS != 0)
    }

    /// See `add_facts`.
    #[inline]
    pub fn set_has_generic_arguments(&self, id: TypeId, has_generic_arguments: bool) {
        let value = match has_generic_arguments {
            true => fact::HAS_GENERIC_ARGUMENTS,
            false => 0,
        };
        self.add_facts(id, fact::KNOWS_HAS_GENERIC_ARGUMENTS | value);
    }

    /// Where a record of the kind `kind` goes that the task is about to create.
    #[inline]
    fn home_of(&self, kind: Kind, is_bound: bool) -> Home {
        match is_bound || self.own.sharing != Sharing::Publishes {
            true => Home::Own { is_bound },
            false => Home::Published(self.published.next_id(kind, self.own)),
        }
    }

    /// `new_record` for a type that `intern_record` creates, and where it goes. `own_id`: its id if that is to the task's
    /// own. Its summary is stored here: whoever finds the type may ask for that at once.
    fn new_record_of_task(&self, created: Made<'s>, own_id: u32) -> (TypeRecord<'s>, Home) {
        let home = self.home_of(Kind::Type, created.is_bound(self.own));
        let record = self.new_record(created, home.id(own_id));
        let summary = record.summary(|member| self.member_flags_and_more(member));
        let is_unresolved_name = matches!(record.created.0, TypeData::UnresolvedName { .. });
        match home {
            Home::Own { .. } => {
                let orders_by_content = self.published.orders_by_content();
                let rank = orders_by_content.then(|| self.rank_of_type(&record.created));
                let index = self.own.summaries.push(summary, rank);
                debug_assert_eq!(index | LOCAL, own_id);
                if is_unresolved_name {
                    self.own.has_unresolved_names.set(true);
                }
            }
            Home::Published(id) => {
                let rank = self.rank_of_type(&record.created);
                self.published.summaries.set(id, summary, rank);
                if is_unresolved_name {
                    let has_unresolved_names = &self.published.has_unresolved_names;
                    has_unresolved_names.store(true, Ordering::Relaxed);
                }
            }
        }
        (record, home)
    }

    /// `Type.flags`
    fn flags_of(created: &Made) -> u32 {
        match &created.0 {
            TypeData::UnresolvedName { .. } => tf::ANY,
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::Unresolved
                | Intrinsic::Any
                | Intrinsic::Error
                | Intrinsic::Auto
                | Intrinsic::IntrinsicMarker
                | Intrinsic::Wildcard
                | Intrinsic::NonInferrableAny => tf::ANY,
                Intrinsic::Unknown => tf::UNKNOWN,
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening => {
                    tf::UNDEFINED
                }
                Intrinsic::Null | Intrinsic::NullWidening => tf::NULL,
                Intrinsic::Void => tf::VOID,
                Intrinsic::String => tf::STRING,
                Intrinsic::Number => tf::NUMBER,
                Intrinsic::BigInt => tf::BIGINT,
                Intrinsic::Symbol => tf::ES_SYMBOL,
                Intrinsic::Object => tf::NON_PRIMITIVE,
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::UniqueLiteral => tf::NEVER,
            },
            TypeData::StringLit { .. } => tf::STRING_LITERAL,
            TypeData::NumberLit { .. } => tf::NUMBER_LITERAL,
            TypeData::BigIntLit { .. } => tf::BIGINT_LITERAL,
            TypeData::BoolLit { .. } => tf::BOOLEAN_LITERAL,
            TypeData::UniqueSymbol { .. } => tf::UNIQUE_ES_SYMBOL,
            TypeData::EnumLit {
                value: EnumValue::String(_),
                ..
            } => tf::ENUM_LITERAL | tf::STRING_LITERAL,
            TypeData::EnumLit {
                value: EnumValue::Number(_),
                ..
            } => tf::ENUM_LITERAL | tf::NUMBER_LITERAL,
            TypeData::Enum { .. } => tf::ENUM,
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => {
                tf::TYPE_PARAMETER
            }
            TypeData::Keyof(_) => tf::INDEX,
            TypeData::Template { .. } => tf::TEMPLATE_LITERAL,
            TypeData::StringMapping { .. } => tf::STRING_MAPPING,
            TypeData::Substitution { .. } => tf::SUBSTITUTION,
            TypeData::IndexedAccess { .. } => tf::INDEXED_ACCESS,
            TypeData::Cond { .. } => tf::CONDITIONAL,
            // `getUnionTypeFromSortedList`: two boolean literal types, fresh or not.
            TypeData::Union(members)
                if members.len() == 2
                    && members.iter().all(|it| {
                        let literals = [
                            TypeId::FALSE,
                            TypeId::TRUE,
                            TypeId::FRESH_FALSE,
                            TypeId::FRESH_TRUE,
                        ];
                        literals.contains(it)
                    }) =>
            {
                tf::UNION | tf::BOOLEAN
            }
            TypeData::Union(_) if created.1.as_ref().is_some_and(|p| p.is_enum) => {
                tf::UNION | tf::ENUM_LITERAL
            }
            TypeData::Union(_) => tf::UNION,
            TypeData::Intersection(_) => tf::INTERSECTION,
            _ => tf::OBJECT,
        }
    }

    fn object_flags_of(&self, data: &TypeData) -> ObjectFlags {
        let all = |ids: &[TypeId]| {
            ids.iter()
                .fold(ObjectFlags::empty(), |f, &t| f | self.object_flags(t))
        };
        match data {
            TypeData::Intrinsic(Intrinsic::Unresolved) => ObjectFlags::HAS_UNRESOLVED,
            TypeData::Intrinsic(Intrinsic::Auto | Intrinsic::SilentNever) => {
                ObjectFlags::NON_INFERRABLE_TYPE
            }
            // `createWideningType`
            TypeData::Intrinsic(
                Intrinsic::NullWidening
                | Intrinsic::UndefinedWidening
                | Intrinsic::NonInferrableAny,
            ) => ObjectFlags::CONTAINS_WIDENING_TYPE,
            // A type parameter whose constraint depends on an unresolved type is flagged as such. A
            // marker in its mapper is not propagated: `reportUnreliableMapper` is applied to the
            // parameter, not to the contents of its mapper.
            TypeData::TypeParam(_, _, around) => {
                ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
                    | (self.mapper_record(*around).1 & ObjectFlags::HAS_UNRESOLVED)
            }
            TypeData::ThisParam(_)
            | TypeData::Marker(
                Marker::Restrictive(_) | Marker::TupleElement(_) | Marker::TupleThis,
            ) => ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES,
            TypeData::Marker(_) => {
                ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES | ObjectFlags::HAS_MARKER
            }
            // `instantiateType` returns a type with `TypeFlagsAny` unchanged, regardless of its
            // alias type arguments.
            TypeData::UnresolvedName { .. } => ObjectFlags::empty(),
            // `getPropagatingFlagsOfTypes(types, TypeFlagsNullable)`
            TypeData::Union(t) | TypeData::Intersection(t) => {
                t.iter().fold(ObjectFlags::empty(), |f, &t| {
                    let object_flags = self.object_flags(t);
                    if self.flags(t) & tf::NULLABLE != 0 {
                        f | object_flags.difference(ObjectFlags::PROPAGATING_FLAGS)
                    } else {
                        f | object_flags
                    }
                })
            }
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => match args {
                TypeArguments::Given(actual) => all(actual),
                // `couldContainTypeVariables`: `t.AsTypeReference().node != nil`. `createDeferredTypeReference` sets no propagating
                // flags.
                TypeArguments::Deferred(deferred) => (self.mapper_record(deferred.mapper).1)
                    .difference(ObjectFlags::PROPAGATING_FLAGS),
            },
            TypeData::Anon {
                origin: Origin::ObjectLiteral(.., object_flags, _),
                mapper,
            } => {
                let stored = ObjectFlags::CONTAINS_WIDENING_TYPE | ObjectFlags::NON_INFERRABLE_TYPE;
                (self.mapper_record(*mapper).1).difference(ObjectFlags::PROPAGATING_FLAGS)
                    | ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL
                    | (*object_flags & stored)
            }
            // The mapper is omitted at creation unless the origin has enclosing type parameters.
            TypeData::Anon { mapper, .. } | TypeData::Fns { mapper, .. } => {
                let type_arguments = self.mapper_record(*mapper).1;
                let mut flags = type_arguments.difference(ObjectFlags::PROPAGATING_FLAGS);
                let non_inferrable =
                    ObjectFlags::NON_INFERRABLE_TYPE | ObjectFlags::NON_INFERRABLE_BY_ALIAS;
                if type_arguments.intersects(non_inferrable) {
                    flags |= ObjectFlags::NON_INFERRABLE_BY_ALIAS;
                }
                if let TypeData::Anon {
                    origin: Origin::WidenedLiteral(.., true),
                    ..
                } = data
                {
                    flags |= ObjectFlags::NON_INFERRABLE_TYPE;
                }
                flags
            }
            TypeData::Cond { mapper, .. } => {
                (self.mapper_record(*mapper).1).difference(ObjectFlags::PROPAGATING_FLAGS)
            }
            TypeData::Synth(shape) => {
                let is_plain = matches!(
                    shape.literal,
                    Literalness::No
                        | Literalness::EmptyObject
                        | Literalness::OfUnknown
                        | Literalness::AutoArray
                        | Literalness::EmptyTypeLiteral
                );
                let mut flags = if is_plain {
                    ObjectFlags::empty()
                } else {
                    ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL
                };
                let mut of_properties = ObjectFlags::empty();
                for p in &shape.props {
                    if let PropSource::Type(t)
                    | PropSource::Copy(t, ..)
                    | PropSource::ReverseMapped(t, _) = p.source
                    {
                        let mut of_type = self.object_flags(t);
                        // `getWidenedProperty` widens it when the property is read.
                        if p.flags.contains(PropFlags::WIDEN) {
                            of_type.remove(ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL);
                        }
                        of_properties |= of_type;
                    }
                    flags |= self.mapper_record(p.mapper).1;
                    if let Some(key) = self.key_apart(p) {
                        flags |= self.object_flags(key);
                    }
                }
                flags |= of_properties;
                for i in &shape.index {
                    flags |= self.object_flags(i.key) | self.object_flags(i.value);
                }
                for &s in shape.call.iter().chain(&shape.construct) {
                    flags |= self.sig_flags(s);
                }
                flags |=
                    (self.mapper_record(shape.mapper).1).difference(ObjectFlags::PROPAGATING_FLAGS);
                let non_inferrable =
                    ObjectFlags::NON_INFERRABLE_TYPE | ObjectFlags::NON_INFERRABLE_BY_ALIAS;
                flags.remove(non_inferrable);
                match shape.literal {
                    Literalness::Partial => flags |= ObjectFlags::NON_INFERRABLE_TYPE,
                    // `createJsxAttributesTypeFromAttributesProperty`
                    Literalness::JsxAttributes => flags |= of_properties & non_inferrable,
                    _ => {}
                }
                flags.set(
                    ObjectFlags::CONTAINS_WIDENING_TYPE,
                    shape.contains_widening_type,
                );
                if is_plain {
                    flags.remove(ObjectFlags::REQUIRES_WIDENING);
                }
                if shape.has_no_instantiable_symbol {
                    flags.remove(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES);
                }
                flags
            }
            // `mapped` and `of` always reference the inferred type parameter, which does not make
            // the inferred type generic. Instantiating one whose source is unchanged yields the
            // same type, or a copy with the same members (`instantiateReverseMappedType`). An
            // unresolved type in them makes its members unresolved, and a marker in them is still
            // encountered.
            TypeData::ReverseMapped { source, mapped, of } => {
                let created_with = self.object_flags(*mapped) | self.object_flags(*of);
                self.object_flags(*source)
                    .difference(ObjectFlags::PROPAGATING_FLAGS)
                    | (created_with & (ObjectFlags::HAS_UNRESOLVED | ObjectFlags::HAS_MARKER))
                    | ObjectFlags::HAS_REVERSE_MAPPED
            }
            TypeData::IndexedAccess { obj, index, .. } => (self.object_flags(*obj)
                | self.object_flags(*index))
            .difference(ObjectFlags::PROPAGATING_FLAGS),
            // `couldContainTypeVariables`: instantiating one resolves it.
            TypeData::Substitution { base, constraint } => {
                (self.object_flags(*base) | self.object_flags(*constraint))
                    .difference(ObjectFlags::PROPAGATING_FLAGS)
                    | ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
            }
            TypeData::Keyof(t) | TypeData::StringMapping { ty: t, .. } => {
                (self.object_flags(*t)).difference(ObjectFlags::PROPAGATING_FLAGS)
            }
            TypeData::Template { types, .. } => {
                all(types).difference(ObjectFlags::PROPAGATING_FLAGS)
            }
            _ => ObjectFlags::empty(),
        }
    }

    pub fn sig_flags(&self, sig: SigId) -> ObjectFlags {
        match self.sig(sig) {
            SigData::Decl { mapper, .. }
            | SigData::DefaultConstruct { mapper, .. }
            | SigData::Construct { mapper, .. } => self.mapper_record(*mapper).1,
            SigData::Synth {
                params,
                ret,
                this,
                of,
                ..
            } => {
                let mut flags = params
                    .iter()
                    .fold(self.object_flags(*ret), |f, p| f | self.object_flags(p.ty));
                if let Some(this) = this {
                    flags |= self.object_flags(*this);
                }
                of.iter().fold(flags, |f, &part| f | self.sig_flags(part))
            }
            SigData::WithReturn { sig, ret } => self.sig_flags(*sig) | self.object_flags(*ret),
        }
    }

    #[inline(always)]
    fn record(&self, id: TypeId) -> &'p TypeRecord<'s> {
        if id.0 & LOCAL == 0 {
            self.published.types.get(id.0)
        } else {
            self.own.types.records.get(id.0 & !LOCAL)
        }
    }

    #[inline(always)]
    fn mapper_record(&self, id: MapperId) -> &'p MapperRecord<'s> {
        if id.0 & LOCAL == 0 {
            self.published.mappers.get(id.0)
        } else {
            self.own.mappers.records.get(id.0 & !LOCAL)
        }
    }

    /// Whether a union or an intersection with `key` and `origin` takes
    /// `ObjectFlags::HAS_OTHER_INSTANTIATION` from a constituent.
    pub fn has_constituent_with_other_instantiation(
        &self,
        key: TypeKey<'_>,
        origin: OriginKey<'_>,
    ) -> bool {
        let members: &[TypeId] = match key {
            TypeKey::Data(TypeData::Union(members) | TypeData::Intersection(members)) => {
                &members[..]
            }
            TypeKey::Union(members) | TypeKey::Intersection(members) => members,
            _ => &[],
        };
        let of_origin: &[TypeId] = match origin {
            OriginKey::Union(types) | OriginKey::Intersection(types) => types,
            OriginKey::None | OriginKey::Keyof(_) => &[],
        };
        members.iter().chain(of_origin).any(|&t| {
            self.object_flags(t)
                .contains(ObjectFlags::HAS_OTHER_INSTANTIATION)
        })
    }

    fn new_record(&self, created: Made<'s>, id: u32) -> TypeRecord<'s> {
        let data = &created.0;
        let may_be_reduced = match data {
            TypeData::Intersection(_) => true,
            TypeData::Union(members) => members
                .iter()
                .any(|&member| self.flags(member) & tf::INTERSECTION != 0),
            _ => false,
        };
        let is_own_apparent_type = |&member: &TypeId| match self.get(member) {
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            } => !(self.object_flags(member)).contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES),
            TypeData::Ref { .. }
            | TypeData::Tuple { .. }
            | TypeData::Anon { .. }
            | TypeData::Fns { .. }
            | TypeData::Synth(_)
            | TypeData::ReverseMapped { .. } => true,
            _ => false,
        };
        let has_only_own_apparent_types = matches!(data, TypeData::Intersection(members) if members.iter().all(is_own_apparent_type));
        let mut flags = self.object_flags_of(data);
        let has_type_variables_in_alias = (created.1.as_ref())
            .and_then(|provenance| provenance.alias.as_ref())
            .is_some_and(|(_, type_arguments)| {
                type_arguments.iter().any(|&t| {
                    self.object_flags(t)
                        .contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES)
                })
            });
        let is_union_or_intersection =
            matches!(data, TypeData::Union(_) | TypeData::Intersection(_));
        // `getObjectTypeInstantiation`: for a target with alias type arguments no outer type
        // parameter is omitted.
        if has_type_variables_in_alias && !is_union_or_intersection {
            flags |= ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES;
        }
        if let Some(provenance) = created.1.as_deref() {
            // `instantiateTypeWorker` instantiates a union through its origin.
            if let UnionOrigin::Union(types) | UnionOrigin::Intersection(types) = &provenance.origin
            {
                for &t in types.iter() {
                    flags |= self.object_flags(t) & ObjectFlags::HAS_OTHER_INSTANTIATION;
                }
            }
            if let Some(key) = provenance.stored_under {
                flags.set(
                    ObjectFlags::HAS_OTHER_INSTANTIATION,
                    key.could_contain_type_variables,
                );
            }
            // `isNonGenericTopLevelType`, see `has_other_instantiation`. Nothing asks it of a result
            // of `getObjectTypeInstantiation`, which sets the flag from the type arguments.
            if is_union_or_intersection
                && (provenance.alias.as_ref()).is_some_and(|alias| alias.1.is_empty())
            {
                flags.remove(ObjectFlags::HAS_OTHER_INSTANTIATION);
            }
            if provenance.has_other_instantiation {
                flags |= ObjectFlags::HAS_OTHER_INSTANTIATION;
            }
            if provenance.alias.is_some() && matches!(data, TypeData::Cond { .. }) {
                flags |= ObjectFlags::HAS_OTHER_INSTANTIATION;
            }
            // `createArrayLiteralType`, `getTypeFromArrayBindingPattern`
            if provenance.is_array_literal || provenance.is_array_pattern {
                flags |= ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL;
            }
        }
        // Unlike the others, these two are not propagated from the type's constituents.
        flags.set(ObjectFlags::MAY_BE_REDUCED, may_be_reduced);
        flags.set(
            ObjectFlags::HAS_ONLY_OWN_APPARENT_TYPES,
            has_only_own_apparent_types,
        );
        // See `mark_ordered_by_id`.
        let has_ordered_by_id = |list: &[TypeId]| {
            let is_ordered_by_id =
                |t: &TypeId| self.record(*t).is_ordered_by_id.load(Ordering::Relaxed);
            list.iter().any(|t| t.is_local() && is_ordered_by_id(t))
        };
        let is_ordered_by_id = matches!(data, TypeData::Union(members) if has_ordered_by_id(members))
            || matches!(
                created.1.as_deref(),
                Some(Provenance { origin: UnionOrigin::Union(types), .. }) if has_ordered_by_id(types)
            );
        let first_request = self.own.first_request.get();
        let constrained_type_variable =
            if first_request.has(FirstRequest::CONSTRAINED_TYPE_VARIABLE) {
                2
            } else {
                u8::from(first_request.has(FirstRequest::NO_CONSTRAINED_TYPE_VARIABLE))
            };
        TypeRecord {
            flags: Self::flags_of(&created),
            object_flags: flags,
            has_type_variables_in_alias_only: has_type_variables_in_alias
                && is_union_or_intersection
                && !flags.contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES),
            is_from_type_node: AtomicBool::new(first_request.has(FirstRequest::FROM_TYPE_NODE)),
            is_ordered_by_id: AtomicBool::new(is_ordered_by_id),
            constrained_type_variable: std::sync::atomic::AtomicU8::new(constrained_type_variable),
            is_without_primitive_union: first_request.has(FirstRequest::WITHOUT_PRIMITIVE_UNION),
            is_sorted_run: AtomicBool::new(false),
            created,
            id: TypeId(id),
        }
    }

    /// A type that `create` creates has `flags` from the start. `create` asks for one type and evaluates nothing: whatever
    /// else it created would get them too. A type that exists is unchanged.
    #[inline]
    pub fn as_first_request(&self, flags: FirstRequest, create: impl FnOnce() -> TypeId) -> TypeId {
        let around = self.own.first_request.replace(flags);
        let id = create();
        self.own.first_request.set(around);
        id
    }

    /// The creation order of `a` and `b`, which is the order of their ids, as in tsgo. For the
    /// places where tsgo compares ids: the final tie-break of `CompareTypes`, `t.id >= lastTypeId`
    /// in `isDeeplyNestedType`, the swap of an identity comparison in `getRelationKey`.
    ///
    /// Between two published types it is final. If either is task-local, it is this task's order:
    /// the merge step may assign the two ids in the opposite order, because one of them may be
    /// merged with the record of a lower task. See `mark_ordered_by_id`.
    ///
    /// If the store `orders_by_content` it is `content_order`, which is final between any two types: nothing is marked.
    #[inline]
    pub fn creation_order(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        if self.published.orders_by_content() {
            return self.content_order(a, b);
        }
        if (a.0 | b.0) & LOCAL != 0 {
            self.own.has_ordered_by_own_id.set(true);
        }
        a.0.cmp(&b.0)
    }

    /// `a.id >= b.id` in `isDeeplyNestedType`, which takes a higher id for a sign of a newer instantiation, one that a
    /// recursion has caused. In `content_order` only the heights count for that: the instantiations of a recursion that goes
    /// from one literal type to the next have one height, and the hash would count about every other one of them.
    #[inline]
    pub fn is_created_no_earlier(&self, a: TypeId, b: TypeId) -> bool {
        match self.published.orders_by_content() {
            true => self.rank(a).height >= self.rank(b).height,
            false => self.creation_order(a, b).is_ge(),
        }
    }

    /// Only if the store `orders_by_content`.
    #[inline]
    fn rank(&self, id: TypeId) -> Rank {
        if id.0 & LOCAL == 0 {
            self.published.summaries.rank(id.0)
        } else {
            self.own.summaries.rank(id.0 & !LOCAL)
        }
    }

    /// By `Rank`: the height, then the hash. A function of the program, where the order of ids is a function of who has
    /// created what first. It is a total order: two types with one rank are ordered by what their keys say.
    fn content_order(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        if a == b {
            return std::cmp::Ordering::Equal;
        }
        let (x, y) = (self.rank(a), self.rank(b));
        (x.height.cmp(&y.height))
            .then_with(|| x.place.cmp(&y.place))
            .then_with(|| x.content.cmp(&y.content))
            .then_with(|| self.compare_contents(a, b))
    }

    /// The keys of `a` and `b`, written out, are compared item by item. Where both mention a type, those two are compared by
    /// `content_order`: they are lower than `a` and `b`, so this ends. Two keys that are equal all the way are one key, for
    /// which a task sees one type.
    #[cold]
    fn compare_contents(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        let (x, y) = (self.said_by(a), self.said_by(b));
        let mut order = x.len().cmp(&y.len());
        for pair in x.iter().zip(&y) {
            if order.is_ne() {
                break;
            }
            order = match pair {
                (Said::Word(x), Said::Word(y)) => x.cmp(y),
                (Said::Type(x), Said::Type(y)) => self.content_order(*x, *y),
                (Said::Word(_), Said::Type(_)) => std::cmp::Ordering::Less,
                (Said::Type(_), Said::Word(_)) => std::cmp::Ordering::Greater,
            };
        }
        // So that it is an order whatever happens.
        order.then_with(|| a.0.cmp(&b.0))
    }

    fn said_by(&self, id: TypeId) -> Vec<Said> {
        let mut saying = Saying {
            types: *self,
            said: Vec::new(),
        };
        self.record(id).created.visit(&mut saying);
        saying.said
    }

    /// The text of an atom, published or not. `Atom::NONE` has none.
    fn text(&self, atom: Atom) -> &'p [u8] {
        if atom.is_none() {
            return &[];
        }
        if atom.is_own() {
            return self.own.atom_bytes(atom);
        }
        (self.published.texts.as_ref()).map_or(&[][..], |texts| texts.bytes(atom))
    }

    fn rank_of_type(&self, created: &Made) -> Rank {
        let mut ranking = Ranking::new(*self);
        visit_type_as_content(created, &mut ranking);
        // `getFreshTypeOfLiteralType` creates the fresh type from the regular one, which its key does not mention.
        if let TypeData::BigIntLit { fresh: true, .. } = created.0 {
            ranking.height = ranking.height.max(1);
        }
        Rank {
            height: ranking.height + 1,
            place: ranking.place,
            content: ranking.lanes.0[0],
        }
    }

    /// Whether `creation_order` has been called with a task-local type since the last call to this
    /// function.
    #[inline]
    pub fn take_has_ordered_by_own_id(&self) -> bool {
        self.own.has_ordered_by_own_id.replace(false)
    }

    /// The position of `id` among the members of a union was decided using `creation_order` of
    /// task-local types. Every union created with such a member, however it is created, is marked
    /// too (`new_record`), and the merge step re-sorts its members and its origin by the published
    /// ids.
    pub fn mark_ordered_by_id(&self, id: TypeId) {
        if id.0 & LOCAL != 0 {
            let record = self.record(id);
            record.is_ordered_by_id.store(true, Ordering::Relaxed);
        }
    }

    /// See `mark_ordered_by_id`. Never for a published type.
    #[inline]
    pub fn is_ordered_by_id(&self, id: TypeId) -> bool {
        id.0 & LOCAL != 0 && self.record(id).is_ordered_by_id.load(Ordering::Relaxed)
    }

    /// The members of the union `id` can be merged with those of another union instead of being
    /// sorted again. See `Checker::add_in_order` for what that takes. It holds for good: it depends
    /// on the members alone, and the merge step, where it sorts them again, sorts the same set. So
    /// any task may note it at any time, in a published record too, and it is published with the
    /// record. A union without the mark may be such a union as well: it is sorted the long way.
    #[inline]
    pub fn mark_sorted_run(&self, id: TypeId) {
        let record = self.record(id);
        if !record.is_sorted_run.load(Ordering::Relaxed) {
            record.is_sorted_run.store(true, Ordering::Relaxed);
        }
    }

    #[inline]
    pub fn is_sorted_run(&self, id: TypeId) -> bool {
        self.record(id).is_sorted_run.load(Ordering::Relaxed)
    }

    /// `Shape::has_no_instantiable_symbol` is part of the identity of a type only where it makes a
    /// difference: to `couldContainTypeVariables`, or, for a type without signatures, to
    /// `isObjectTypeWithInferableIndex`.
    fn drop_flag_without_effect(&self, data: &mut TypeData<'s>) {
        let TypeData::Synth(shape) = data else {
            return;
        };
        if !shape.has_no_instantiable_symbol || shape.call.is_empty() && shape.construct.is_empty()
        {
            return;
        }
        shape.has_no_instantiable_symbol = false;
        let flags = self.object_flags_of(data);
        if let TypeData::Synth(shape) = data {
            shape.has_no_instantiable_symbol =
                flags.contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES);
        }
    }

    pub fn intern(&self, mut data: TypeData<'s>) -> TypeId {
        self.drop_flag_without_effect(&mut data);
        let shares_records = self.published.shares_records();
        let literal = match data {
            TypeData::StringLit { value, fresh } if !value.is_own() => {
                Some((value, &self.published.string_literals[usize::from(fresh)]))
            }
            _ => None,
        };
        if let Some((value, known)) = literal
            && let Some(id) = known.get(&value)
        {
            // Another task may have added it a moment ago, see below. What it wrote before comes with it.
            if shares_records {
                std::sync::atomic::fence(Ordering::Acquire);
            }
            return id;
        }
        // `getFreshTypeOfLiteralType` creates the fresh type from the regular one, and bigint
        // literal types are ordered by creation.
        if let TypeData::BigIntLit {
            text,
            negative,
            fresh: true,
        } = data
        {
            let regular = TypeData::BigIntLit {
                text,
                negative,
                fresh: false,
            };
            self.intern_new((regular, None));
        }
        let id = self.intern_new((data, None));
        if let Some((value, known)) = literal
            && shares_records
            && !id.is_local()
        {
            known.insert(value, id);
        }
        id
    }

    /// `intern` for a type that has an alias or an origin.
    pub fn intern_with(&self, data: TypeData<'s>, provenance: Provenance<'s>) -> TypeId {
        if provenance == Provenance::default() {
            return self.intern(data);
        }
        self.intern_new((data, Some(ArenaBox::new_in(provenance, self.own.arena))))
    }

    /// `intern` for a type with lists. Nothing is allocated if the type exists.
    #[inline]
    pub fn intern_key(&self, key: TypeKey<'_>) -> TypeId {
        self.intern_borrowed(key, None)
    }

    /// `intern_with`, likewise.
    pub fn intern_key_with(&self, key: TypeKey<'_>, provenance: &ProvenanceKey<'_>) -> TypeId {
        self.intern_borrowed(key, (!provenance.is_default()).then_some(provenance))
    }

    fn intern_borrowed(&self, key: TypeKey<'_>, provenance: Option<&ProvenanceKey<'_>>) -> TypeId {
        let key = (key, provenance);
        // They have no lists, and `intern` treats them specially.
        if let (TypeKey::Data(data), None) = key
            && matches!(
                data,
                TypeData::StringLit { .. } | TypeData::BigIntLit { .. }
            )
        {
            return self.intern(data.clone_in(self.own.arena));
        }
        let spread = spread_hash(&key);
        TypeId(intern_record(
            (&self.published.types, self.own, Kind::Type),
            |own| &own.types,
            (spread, key),
            |(data, provenance)| {
                SKIPS_LOOKUPS_OF_OWN_KEYS
                    && (data.mentions_own() || provenance.is_some_and(|it| it.mentions_own()))
            },
            |record, (data, provenance)| {
                data.is(&record.created.0)
                    && match (provenance, &record.created.1) {
                        (None, None) => true,
                        (Some(provenance), Some(of)) => provenance.is(of),
                        _ => false,
                    }
            },
            |(data, provenance), id| {
                let arena = self.own.arena;
                let provenance =
                    provenance.map(|it| ArenaBox::new_in(it.to_provenance(arena), arena));
                let created: Made<'s> = (data.to_data(arena), provenance);
                debug_assert_eq!(spread_hash(&created), spread);
                self.new_record_of_task(created, id)
            },
        ))
    }

    #[inline]
    pub fn provenance(&self, id: TypeId) -> Option<&'p Provenance<'s>> {
        self.record(id).created.1.as_deref()
    }

    /// `t.objectFlags&ObjectFlagsArrayLiteral != 0`
    #[inline]
    pub fn is_array_literal(&self, id: TypeId) -> bool {
        self.provenance(id)
            .is_some_and(|provenance| provenance.is_array_literal)
    }

    /// See `Provenance::is_array_pattern`.
    #[inline]
    pub fn is_array_pattern(&self, id: TypeId) -> bool {
        self.provenance(id)
            .is_some_and(|provenance| provenance.is_array_pattern)
    }

    fn intern_new(&self, created: Made<'s>) -> TypeId {
        TypeId(intern_record(
            (&self.published.types, self.own, Kind::Type),
            |own| &own.types,
            (spread_hash(&created), created),
            |created| SKIPS_LOOKUPS_OF_OWN_KEYS && created.mentions_own(),
            |record, created| record.created == *created,
            |created, id| self.new_record_of_task(created, id),
        ))
    }

    /// For `is_new_since`, and to see whether the task has created a type between two calls.
    #[inline]
    pub fn first_new_type_id(&self) -> NewTypes {
        NewTypes {
            own: self.own.types.records.len(),
            published: self.own.published[Kind::Type as usize].get(),
        }
    }

    /// `ObjectFlagsFromTypeNode`: `id` is the type of a type node. `first_new_type_id` was taken
    /// before it was resolved. `createTypeReferenceEx`
    /// sets the flags only on a type that it creates: one that an instantiation created earlier is
    /// unchanged. If two tasks of a step create the type, the record of the lower task is
    /// published, with its flag.
    pub fn mark_from_type_node(&self, id: TypeId, first_new_type_id: NewTypes) {
        if id.0 & LOCAL == 0 {
            return;
        }
        // Not tsgo's rule: a bound type gets the flag even if an instantiation created it earlier.
        if self.is_new_since(id, first_new_type_id) || self.own.types.is_bound(id.0 & !LOCAL) {
            let record = self.record(id);
            record.is_from_type_node.store(true, Ordering::Relaxed);
        }
    }

    #[inline]
    pub fn is_from_type_node(&self, id: TypeId) -> bool {
        self.record(id).is_from_type_node.load(Ordering::Relaxed)
    }

    /// `ObjectFlagsIsConstrainedTypeVariable`: `getIntersectionTypeEx` has it for the intersection
    /// `id`. It sets the flags only on a type that it creates, so the first request decides. A
    /// published type is unchanged.
    pub fn set_constrained_type_variable(&self, id: TypeId, is_constrained: bool) {
        if id.0 & LOCAL != 0 {
            let state = &self.record(id).constrained_type_variable;
            if state.load(Ordering::Relaxed) == 0 {
                state.store(1 + u8::from(is_constrained), Ordering::Relaxed);
            }
        }
    }

    /// `None`: no request has decided.
    #[inline]
    pub fn is_constrained_type_variable(&self, id: TypeId) -> Option<bool> {
        match (self.record(id).constrained_type_variable).load(Ordering::Relaxed) {
            0 => None,
            state => Some(state == 2),
        }
    }

    /// Whether the task has created `id` since `first_new_type_id` was taken.
    #[inline]
    pub fn is_new_since(&self, id: TypeId, first_new_type_id: NewTypes) -> bool {
        id.0 & LOCAL != 0 && id.0 & !LOCAL >= first_new_type_id.own
    }

    /// `FirstRequest::WITHOUT_PRIMITIVE_UNION`
    #[inline]
    pub fn is_without_primitive_union(&self, id: TypeId) -> bool {
        self.record(id).is_without_primitive_union
    }

    #[inline]
    pub fn sig(&self, id: SigId) -> &'p SigData<'s> {
        if id.0 & LOCAL == 0 {
            self.published.sigs.get(id.0)
        } else {
            self.own.sigs.records.get(id.0 & !LOCAL)
        }
    }

    /// The signature that `sig` is transitively a clone of: the one that has the declaration
    /// (`Signature.declaration`).
    pub fn sig_origin(&self, mut sig: SigId) -> SigId {
        loop {
            match self.sig(sig) {
                SigData::WithReturn { sig: inner, .. } => sig = *inner,
                SigData::Synth { of, .. } if !of.is_empty() => sig = of[0],
                _ => return sig,
            }
        }
    }

    pub fn intern_sig(&self, mut data: SigData<'s>) -> SigId {
        // A clone of a clone takes everything except its return type from the original.
        if let SigData::WithReturn { sig, .. } = &mut data
            && let SigData::WithReturn { sig: inner, .. } = self.sig(*sig)
        {
            *sig = *inner;
        }
        SigId(intern_record(
            (&self.published.sigs, self.own, Kind::Sig),
            |own| &own.sigs,
            (spread_hash(&data), data),
            |data| SKIPS_LOOKUPS_OF_OWN_KEYS && data.mentions_own(),
            |record, data| record == data,
            |data, _| {
                let home = self.home_of(Kind::Sig, data.is_bound(self.own));
                (data, home)
            },
        ))
    }

    /// `IndexInfo.components`
    #[inline]
    pub fn components(&self, id: ComponentsId) -> &'p [IndexComponent] {
        if id.0 & LOCAL == 0 {
            &self.published.components.get(id.0)[..]
        } else {
            &self.own.components.records.get(id.0 & !LOCAL)[..]
        }
    }

    pub fn intern_components(&self, list: &[IndexComponent]) -> ComponentsId {
        if list.is_empty() {
            return ComponentsId::NONE;
        }
        ComponentsId(intern_record(
            (&self.published.components, self.own, Kind::Components),
            |own| &own.components,
            (spread_hash(list), list),
            |_| false,
            |record, list| **record == **list,
            |list, _| {
                let list = self.list(list);
                let home = self.home_of(Kind::Components, list.is_bound(self.own));
                (list, home)
            },
        ))
    }

    /// `pairs` need not be sorted. A parameter mapped to itself is preserved: it records that the
    /// origin depends on it.
    pub fn mapper(&self, mut pairs: Vec<(TypeId, TypeId)>) -> MapperId {
        if pairs.is_empty() {
            return MapperId::IDENTITY;
        }
        if !is_in_order(&pairs) {
            // Stable, so that `dedup_by_key` keeps the first of two pairs for one parameter. It must not depend on the other ids.
            pairs.sort_by_key(|p| p.0.arrival_order());
            pairs.dedup_by_key(|p| p.0);
        }
        self.mapper_in_order(&pairs)
    }

    /// The same for borrowed pairs. Nothing is allocated for sorted pairs whose mapper already
    /// exists.
    pub fn mapper_of(&self, pairs: &[(TypeId, TypeId)]) -> MapperId {
        if pairs.is_empty() {
            MapperId::IDENTITY
        } else if is_in_order(pairs) {
            self.mapper_in_order(pairs)
        } else {
            self.mapper(pairs.to_vec())
        }
    }

    fn mapper_in_order(&self, pairs: &[(TypeId, TypeId)]) -> MapperId {
        MapperId(intern_record(
            (&self.published.mappers, self.own, Kind::Mapper),
            |own| &own.mappers,
            (spread_hash(&Pairs(pairs)), pairs),
            |pairs| pairs.iter().any(MaybeLocal::is_local),
            |record, pairs| *record.0 == **pairs,
            |pairs, _| {
                let flags =
                    (pairs.iter()).fold(ObjectFlags::empty(), |f, p| f | self.object_flags(p.1));
                let pairs = Mapping::copy_from_slice_in(pairs, self.own.arena);
                let home = self.home_of(Kind::Mapper, pairs.is_bound(self.own));
                ((pairs, flags), home)
            },
        ))
    }

    #[inline]
    pub fn mapping(&self, id: MapperId) -> &'p [(TypeId, TypeId)] {
        &self.mapper_record(id).0
    }

    /// The flags of the types that `id` maps to.
    #[inline]
    pub fn mapper_flags(&self, id: MapperId) -> ObjectFlags {
        self.mapper_record(id).1
    }

    #[inline]
    pub fn map(&self, id: MapperId, param: TypeId) -> Option<TypeId> {
        let mapping = self.mapping(id);
        if mapping.len() <= 4 {
            return mapping.iter().find(|p| p.0 == param).map(|p| p.1);
        }
        mapping
            .binary_search_by_key(&param.arrival_order(), |p| p.0.arrival_order())
            .ok()
            .map(|i| mapping[i].1)
    }

    /// `keyType` of `prop`, if `prop` is a property of a mapped type that has it in `Prop::name_type`. Then `Prop::mapper`
    /// is the mapper of the mapped type, which says so: with the key in it, it is another one. `None`: any other
    /// property, or `Prop::mapper` has the key.
    ///
    /// A mapped type of 300 keys would otherwise create 300 mappers, for the few properties whose types are asked for.
    /// The two forms stand for each other one to one, so two properties are equal in one form if they are in the other:
    /// - The key is apart as long as the mapper is what `resolveMappedTypeMembers` gave the property.
    /// - Whatever composes that mapper with another composes `Checker::mapper_of_prop`. If that gives another mapper, the
    ///   property gets it, and `Prop::name_type` is what it was before there was this form.
    #[inline]
    pub fn key_apart(&self, prop: &Prop) -> Option<TypeId> {
        match prop.source {
            PropSource::Mapped(of, ..) if prop.name_type != TypeId::UNRESOLVED => {
                match *self.get(of) {
                    TypeData::Anon { mapper, .. } if mapper == prop.mapper => Some(prop.name_type),
                    _ => None,
                }
            }
            _ => None,
        }
    }
}

// ───────────────────────────── references between records: `visit` and `follow`
// ─────────────────────────────

/// Receives what `Follow::visit` reports for a value: every id, every file, and everything else as
/// data to hash.
pub trait Visitor {
    fn atom(&mut self, atom: Atom);
    fn components(&mut self, id: ComponentsId);
    fn mapper(&mut self, id: MapperId);
    fn sig(&mut self, id: SigId);
    fn ty(&mut self, id: TypeId);
    /// A node or a symbol of `file` is referenced.
    fn file(&mut self, file: FileId);
    fn plain<T: Hash + ?Sized>(&mut self, value: &T);
}

/// A value that can reference an atom, a list of index components, a mapper, a signature or a type:
/// the data of a record, a key or a value of a table. Each type is described once, by
/// `follow_struct!` or `follow_enum!`, with every field named: a new field is a compile error.
pub trait Follow {
    fn visit<V: Visitor>(&self, visitor: &mut V);

    /// Replaces every task-local id (`LOCAL`) with the published id that the merge step assigned to
    /// its record. Runs at the barrier, on any thread.
    fn follow(&mut self, link: &Link);

    /// Whether it references a node or a symbol of a file that nothing imports, or a task-local
    /// record that does. Such a value is never published.
    fn is_bound(&self, own: &OwnStore) -> bool {
        if own.unimported_files.0.is_empty() {
            return false;
        }
        let mut visitor = IsBound {
            own,
            is_bound: false,
        };
        self.visit(&mut visitor);
        visitor.is_bound
    }

    /// Whether it references a task-local record.
    #[inline]
    fn mentions_own(&self) -> bool {
        let mut visitor = MentionsOwn(false);
        self.visit(&mut visitor);
        visitor.0
    }

    /// Marks the task-local records that it references. `OwnStore::finish` adds the records those
    /// reference.
    #[inline]
    fn mark(&self, marks: &mut Marks) {
        self.visit(marks);
    }
}

/// For types that reference nothing: `visit` reports the whole value as data to hash.
macro_rules! has_no_references {
    ($($name:ty),* $(,)?) => {$(
        impl $crate::types::Follow for $name {
            #[inline]
            fn visit<V: $crate::types::Visitor>(&self, visitor: &mut V) {
                visitor.plain(self);
            }
            #[inline]
            fn follow(&mut self, _: &$crate::types::Link) {}
        }
    )*};
}
pub(crate) use has_no_references;

/// `follow_struct!(Name { every, field })`
macro_rules! follow_struct {
    ($name:ident $(<$lifetime:lifetime>)? { $($field:ident),* $(,)? }) => {
        impl $crate::types::Follow for $name $(<$lifetime>)? {
            fn visit<V: $crate::types::Visitor>(&self, visitor: &mut V) {
                let $name { $($field),* } = self;
                $($crate::types::Follow::visit($field, visitor);)*
            }
            fn follow(&mut self, link: &$crate::types::Link) {
                let $name { $($field),* } = self;
                $($crate::types::Follow::follow($field, link);)*
            }
        }
    };
}
pub(crate) use follow_struct;

/// `follow_enum!(Name { Name::A(x, y) => (x, y), Name::B { z } => (z), Name::C => () })`: every variant, without `..`.
macro_rules! follow_enum {
    ($name:ident $(<$lifetime:lifetime>)? { $($pattern:pat => ($($field:ident),*)),* $(,)? }) => {
        impl $crate::types::Follow for $name $(<$lifetime>)? {
            fn visit<V: $crate::types::Visitor>(&self, visitor: &mut V) {
                visitor.plain(&std::mem::discriminant(self));
                match self {
                    $($pattern => {
                        $($crate::types::Follow::visit($field, visitor);)*
                    })*
                }
            }
            fn follow(&mut self, link: &$crate::types::Link) {
                // No variant may have a field.
                let _ = link;
                match self {
                    $($pattern => {
                        $($crate::types::Follow::follow($field, link);)*
                    })*
                }
            }
        }
    };
}

macro_rules! follow_id {
    ($($name:ident: $visit:ident, $links:ident;)*) => {$(
        impl Follow for $name {
            #[inline]
            fn visit<V: Visitor>(&self, visitor: &mut V) {
                visitor.$visit(*self);
            }
            #[inline]
            fn follow(&mut self, link: &Link) {
                if self.is_local() {
                    self.0 = link.$links[(self.0 & !LOCAL) as usize];
                    debug_assert!(self.0 != u32::MAX, "it was not marked");
                }
            }
        }
    )*};
}

follow_id! {
    Atom: atom, atoms;
    ComponentsId: components, components;
    MapperId: mapper, mappers;
    SigId: sig, sigs;
    TypeId: ty, types;
}

impl Follow for FileId {
    #[inline]
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.file(*self);
    }
    #[inline]
    fn follow(&mut self, _: &Link) {}
}

impl Follow for Sym {
    #[inline]
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.file(self.file);
        visitor.plain(&self.id);
    }
    #[inline]
    fn follow(&mut self, _: &Link) {}
}

impl<T: Follow> Follow for Option<T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.plain(&self.is_some());
        if let Some(it) = self {
            it.visit(visitor);
        }
    }
    fn follow(&mut self, link: &Link) {
        if let Some(it) = self {
            it.follow(link);
        }
    }
}

impl<T: Follow> Follow for Box<T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        (**self).visit(visitor);
    }
    fn follow(&mut self, link: &Link) {
        (**self).follow(link);
    }
}

impl<T: Follow> Follow for [T] {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.plain(&self.len());
        for it in self {
            it.visit(visitor);
        }
    }
    fn follow(&mut self, link: &Link) {
        for it in self {
            it.follow(link);
        }
    }
}

impl<T: Follow + ?Sized> Follow for ArenaBox<'_, T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        (**self).visit(visitor);
    }
    fn follow(&mut self, link: &Link) {
        (**self).follow(link);
    }
}

impl<T: Follow> Follow for ArenaVec<'_, T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
    fn follow(&mut self, link: &Link) {
        self[..].follow(link);
    }
}

impl<T: Follow, const N: usize, L: std::ops::DerefMut<Target = [T]>> Follow for ShortList<T, N, L> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        (**self).visit(visitor);
    }
    fn follow(&mut self, link: &Link) {
        (**self).follow(link);
    }
}

impl<T: Follow> Follow for Box<[T]> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
    fn follow(&mut self, link: &Link) {
        self[..].follow(link);
    }
}

impl<T: Follow> Follow for Vec<T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
    fn follow(&mut self, link: &Link) {
        self[..].follow(link);
    }
}

/// Bytes mention no record.
impl Follow for &[u8] {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
    fn follow(&mut self, _: &Link) {}
}

impl<K: Follow + Hash + Eq, T: Follow> Follow for FxHashMap<K, T> {
    /// In no particular order: not for a content hash.
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        for (key, value) in self {
            key.visit(visitor);
            value.visit(visitor);
        }
    }
    fn follow(&mut self, link: &Link) {
        *self = (std::mem::take(self).into_iter())
            .map(|(mut key, mut value)| {
                key.follow(link);
                value.follow(link);
                (key, value)
            })
            .collect();
    }
}

macro_rules! follow_tuple {
    ($(($($name:ident $index:tt),*);)*) => {$(
        impl<$($name: Follow),*> Follow for ($($name,)*) {
            #[inline]
            fn visit<V: Visitor>(&self, visitor: &mut V) {
                $(self.$index.visit(visitor);)*
            }
            #[inline]
            fn follow(&mut self, link: &Link) {
                $(self.$index.follow(link);)*
            }
        }
    )*};
}

follow_tuple! {
    (A 0, B 1);
    (A 0, B 1, C 2);
    (A 0, B 1, C 2, D 3);
}

has_no_references!(
    (),
    bool,
    u8,
    u32,
    u64,
    usize,
    ExprId,
    FnId,
    ParamId,
    TypeNodeId,
    TypeParamId,
    crate::hir::MemberId,
    crate::hir::PropId,
    crate::node::Node,
    Intrinsic,
    StringMappingKind,
    PropFlags,
    ObjectFlags,
    ObjectLiteralCheck,
    Literalness,
);

/// The label is a declared name, so it is published and needs no remapping
/// (`ElemFlags::with_label`). It is reported as an atom.
impl Follow for ElemFlags {
    #[inline]
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        let label = self.labeled_declaration();
        visitor.plain(&self.with_label(LabeledDeclaration::NONE).bits());
        visitor.atom(label.name);
        if label.name.is_some() {
            visitor.file(label.file);
            visitor.plain(&label.pos);
        }
    }
    #[inline]
    fn follow(&mut self, _: &Link) {}
}

follow_enum!(EnumValue {
    EnumValue::String(a) => (a),
    EnumValue::Number(a) => (a),
});
follow_enum!(Origin {
    Origin::TypeLiteral(a, b) => (a, b),
    Origin::Mapped(a, b) => (a, b),
    Origin::ObjectLiteral(a, b, c, d, e, f, g) => (a, b, c, d, e, f, g),
    Origin::WidenedLiteral(a, b, c, d, e, f) => (a, b, c, d, e, f),
    Origin::ClassStatic(a) => (a),
    Origin::Function(a) => (a),
    Origin::EnumObject(a) => (a),
    Origin::Module(a) => (a),
    Origin::Namespace { module, with_default, is_default_only, originating_import } => (module, with_default, is_default_only, originating_import),
    Origin::GlobalThis => (),
});
follow_enum!(UniqueSymbolDeclaration {
    UniqueSymbolDeclaration::Variable(a) => (a),
    UniqueSymbolDeclaration::Member(a, b) => (a, b),
    UniqueSymbolDeclaration::SymbolConstructor => (),
});
follow_enum!(TypeArguments<'_> {
    TypeArguments::Given(a) => (a),
    TypeArguments::Deferred(a) => (a),
});
follow_struct!(DeferredTypeArguments { file, node, mapper });
follow_enum!(Marker {
    Marker::Super => (),
    Marker::Sub => (),
    Marker::Other => (),
    Marker::SuperForCheck => (),
    Marker::SubForCheck => (),
    Marker::Restrictive(a) => (a),
    Marker::TupleElement(a) => (a),
    Marker::TupleThis => (),
});
follow_enum!(TypeData<'_> {
    TypeData::Intrinsic(a) => (a),
    TypeData::UnresolvedName { name, args } => (name, args),
    TypeData::StringLit { value, fresh } => (value, fresh),
    TypeData::NumberLit { bits, fresh } => (bits, fresh),
    TypeData::BigIntLit { text, negative, fresh } => (text, negative, fresh),
    TypeData::BoolLit { value, fresh } => (value, fresh),
    TypeData::EnumLit { member, value, fresh } => (member, value, fresh),
    TypeData::Enum { symbol, fresh } => (symbol, fresh),
    TypeData::EvolvingArray(a) => (a),
    TypeData::UniqueSymbol { symbol, name } => (symbol, name),
    TypeData::TypeParam(a, b, c) => (a, b, c),
    TypeData::ThisParam(a) => (a),
    TypeData::Marker(a) => (a),
    TypeData::Union(a) => (a),
    TypeData::Intersection(a) => (a),
    TypeData::Ref { target, args } => (target, args),
    TypeData::Tuple { elems, flags, readonly } => (elems, flags, readonly),
    TypeData::Anon { origin, mapper } => (origin, mapper),
    TypeData::Fns { decls, mapper } => (decls, mapper),
    TypeData::Synth(a) => (a),
    TypeData::ReverseMapped { source, mapped, of } => (source, mapped, of),
    TypeData::Cond { file, node, mapper, distributed_over, for_constraint } => (file, node, mapper, distributed_over, for_constraint),
    TypeData::IndexedAccess { obj, index, undefined } => (obj, index, undefined),
    TypeData::Keyof(a) => (a),
    TypeData::Substitution { base, constraint } => (base, constraint),
    TypeData::Template { texts, types } => (texts, types),
    TypeData::StringMapping { kind, ty } => (kind, ty),
});
follow_enum!(PropSource<'_> {
    PropSource::Type(a) => (a),
    PropSource::Literal(a, b) => (a, b),
    PropSource::Symbol(a) => (a),
    PropSource::Intersected(a, b) => (a, b),
    PropSource::Mapped(a, b, c) => (a, b, c),
    PropSource::Copy(a, b, c) => (a, b, c),
    PropSource::ReverseMapped(a, b) => (a, b),
});
follow_struct!(Prop<'_> {
    name,
    flags,
    source,
    mapper,
    name_type
});
follow_enum!(IndexComponent {
    IndexComponent::Property(a, b) => (a, b),
    IndexComponent::Member(a, b) => (a, b),
});
follow_struct!(IndexInfo {
    key,
    value,
    readonly,
    is_enum_number_index_info,
    declaration,
    components
});
follow_enum!(InstantiationExpression {
    InstantiationExpression::Expr(a, b) => (a, b),
    InstantiationExpression::TypeNode(a, b) => (a, b),
});
follow_struct!(Shape<'_> {
    symbol_declared_at,
    symbol,
    props,
    call,
    construct,
    index,
    literal,
    is_regular,
    contains_widening_type,
    is_js_literal,
    is_object_rest_type,
    instantiation_expression,
    instantiation_target,
    default_of,
    created_from,
    spread_rank,
    properties_of,
    single_signature_arguments,
    has_no_instantiable_symbol,
    pattern_at,
    mapper
});
follow_struct!(SigParam {
    name,
    ty,
    optional,
    rest,
    is_required_rest,
    declaration
});
follow_enum!(SigData<'_> {
    SigData::Decl { file, func, mapper } => (file, func, mapper),
    SigData::DefaultConstruct { class, base, mapper } => (class, base, mapper),
    SigData::Construct { class, file, func, mapper } => (class, file, func, mapper),
    SigData::Synth { type_params, params, ret, this, of, is_union } => (type_params, params, ret, this, of, is_union),
    SigData::WithReturn { sig, ret } => (sig, ret),
});
follow_struct!(Provenance<'_> {
    alias,
    origin,
    is_enum,
    stored_under,
    is_array_literal,
    is_array_pattern,
    has_other_instantiation
});
follow_struct!(InstantiationKey {
    type_arguments,
    alias,
    could_contain_type_variables,
    nesting
});
follow_enum!(UnionOrigin<'_> {
    UnionOrigin::None => (),
    UnionOrigin::Union(a) => (a),
    UnionOrigin::Intersection(a) => (a),
    UnionOrigin::Keyof(a) => (a),
});

// ───────────────────────────── copies ─────────────────────────────

/// `Clone` for what owns memory of an arena. The copy is allocated in `arena`, which is that of the
/// calling thread, and has the lifetime of that arena, whatever that of the original is.
pub trait CloneIn {
    /// `Self`, for another lifetime.
    type In<'t>;
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t>;
}

macro_rules! clone_in_is_copy {
    ($($name:ty),* $(,)?) => {$(
        impl CloneIn for $name {
            type In<'t> = $name;
            #[inline]
            fn clone_in(&self, _: &Arena) -> $name {
                *self
            }
        }
    )*};
}
clone_in_is_copy!(
    bool,
    u8,
    u32,
    u64,
    Atom,
    TypeId,
    SigId,
    MapperId,
    FileId,
    Sym,
    ExprId,
    FnId,
    TypeNodeId,
    TypeParamId,
    crate::hir::PropId,
    Intrinsic,
    EnumValue,
    UniqueSymbolDeclaration,
    Marker,
    Origin,
    StringMappingKind,
    ElemFlags,
    PropFlags,
    IndexInfo,
    SigParam,
    Literalness,
    InstantiationExpression,
    DeferredTypeArguments,
    InstantiationKey,
);

impl<T: CloneIn> CloneIn for Option<T> {
    type In<'t> = Option<T::In<'t>>;
    #[inline]
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        self.as_ref().map(|it| it.clone_in(arena))
    }
}

impl<A: CloneIn, B: CloneIn> CloneIn for (A, B) {
    type In<'t> = (A::In<'t>, B::In<'t>);
    #[inline]
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        (self.0.clone_in(arena), self.1.clone_in(arena))
    }
}

impl<A: CloneIn, B: CloneIn, C: CloneIn> CloneIn for (A, B, C) {
    type In<'t> = (A::In<'t>, B::In<'t>, C::In<'t>);
    #[inline]
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        (
            self.0.clone_in(arena),
            self.1.clone_in(arena),
            self.2.clone_in(arena),
        )
    }
}

impl<T: CloneIn> CloneIn for ArenaBox<'_, T> {
    type In<'t> = ArenaBox<'t, T::In<'t>>;
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        ArenaBox::new_in((**self).clone_in(arena), arena)
    }
}

impl<T: CloneIn> CloneIn for [T] {
    type In<'t> = List<'t, T::In<'t>>;
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        List::from_iter_in(self.iter().map(|it| it.clone_in(arena)), arena)
    }
}

impl<T: CloneIn> CloneIn for List<'_, T> {
    type In<'t> = List<'t, T::In<'t>>;
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        self[..].clone_in(arena)
    }
}

impl<T: CloneIn> CloneIn for ArenaVec<'_, T> {
    type In<'t> = ArenaVec<'t, T::In<'t>>;
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        vec_from_iter_in(self.iter().map(|it| it.clone_in(arena)), arena)
    }
}

impl<T: BlankItem> CloneIn for ThinList<'_, T> {
    type In<'t> = ThinList<'t, T>;
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        ThinList::block_in(self, arena)
    }
}

impl<T: Copy, const N: usize, L: CloneIn> CloneIn for ShortList<T, N, L> {
    type In<'t> = ShortList<T, N, L::In<'t>>;
    fn clone_in<'t>(&self, arena: &'t Arena) -> Self::In<'t> {
        match self {
            ShortList::Inline(len, items) => ShortList::Inline(*len, *items),
            ShortList::Spilled(items) => ShortList::Spilled(items.clone_in(arena)),
        }
    }
}

/// `clone_in_struct!(Name { every, field })`
macro_rules! clone_in_struct {
    ($name:ident { $($field:ident),* $(,)? }) => {
        impl CloneIn for $name<'_> {
            type In<'t> = $name<'t>;
            fn clone_in<'t>(&self, arena: &'t Arena) -> $name<'t> {
                let $name { $($field),* } = self;
                $name { $($field: $field.clone_in(arena)),* }
            }
        }
    };
}

/// `clone_in_enum!(Name { A(x, y), B { z }, C })`: every variant.
macro_rules! clone_in_enum {
    ($name:ident { $($variant:ident $(($($item:ident),*))? $({ $($field:ident),* })?),* $(,)? }) => {
        impl CloneIn for $name<'_> {
            type In<'t> = $name<'t>;
            fn clone_in<'t>(&self, arena: &'t Arena) -> $name<'t> {
                let _ = arena;
                match self {
                    $($name::$variant $(($($item),*))? $({ $($field),* })? =>
                        $name::$variant
                            $(($($item.clone_in(arena)),*))?
                            $({ $($field: $field.clone_in(arena)),* })?,)*
                }
            }
        }
    };
}

clone_in_enum!(TypeArguments {
    Given(a),
    Deferred(a)
});
clone_in_enum!(TypeData {
    Intrinsic(a),
    UnresolvedName { name, args },
    StringLit { value, fresh },
    NumberLit { bits, fresh },
    BigIntLit { text, negative, fresh },
    BoolLit { value, fresh },
    EnumLit { member, value, fresh },
    Enum { symbol, fresh },
    EvolvingArray(a),
    UniqueSymbol { symbol, name },
    TypeParam(a, b, c),
    ThisParam(a),
    Marker(a),
    Union(a),
    Intersection(a),
    Ref { target, args },
    Tuple { elems, flags, readonly },
    Anon { origin, mapper },
    Fns { decls, mapper },
    Synth(a),
    ReverseMapped { source, mapped, of },
    Cond { file, node, mapper, distributed_over, for_constraint },
    IndexedAccess { obj, index, undefined },
    Keyof(a),
    Substitution { base, constraint },
    Template { texts, types },
    StringMapping { kind, ty },
});
clone_in_enum!(PropSource {
    Type(a),
    Literal(a, b),
    Symbol(a),
    Intersected(a, b),
    Mapped(a, b, c),
    Copy(a, b, c),
    ReverseMapped(a, b),
});
clone_in_struct!(Prop {
    name,
    flags,
    source,
    mapper,
    name_type
});
clone_in_struct!(Shape {
    symbol_declared_at,
    symbol,
    props,
    call,
    construct,
    index,
    literal,
    is_regular,
    contains_widening_type,
    is_js_literal,
    is_object_rest_type,
    instantiation_expression,
    instantiation_target,
    default_of,
    created_from,
    spread_rank,
    properties_of,
    single_signature_arguments,
    has_no_instantiable_symbol,
    pattern_at,
    mapper
});
clone_in_enum!(SigData {
    Decl { file, func, mapper },
    DefaultConstruct { class, base, mapper },
    Construct { class, file, func, mapper },
    Synth { type_params, params, ret, this, of, is_union },
    WithReturn { sig, ret },
});
clone_in_struct!(Provenance {
    alias,
    origin,
    is_enum,
    stored_under,
    is_array_literal,
    is_array_pattern,
    has_other_instantiation
});
clone_in_enum!(UnionOrigin {
    None,
    Union(a),
    Intersection(a),
    Keyof(a)
});

/// See `Follow::is_bound`.
struct IsBound<'a, 's> {
    own: &'a OwnStore<'s>,
    is_bound: bool,
}

impl Visitor for IsBound<'_, '_> {
    /// An atom is a text. It references nothing.
    #[inline]
    fn atom(&mut self, _: Atom) {}
    #[inline]
    fn components(&mut self, id: ComponentsId) {
        self.is_bound |= id.is_local() && self.own.components.is_bound(id.0 & !LOCAL);
    }
    #[inline]
    fn mapper(&mut self, id: MapperId) {
        self.is_bound |= id.is_local() && self.own.mappers.is_bound(id.0 & !LOCAL);
    }
    #[inline]
    fn sig(&mut self, id: SigId) {
        self.is_bound |= id.is_local() && self.own.sigs.is_bound(id.0 & !LOCAL);
    }
    #[inline]
    fn ty(&mut self, id: TypeId) {
        self.is_bound |= id.is_local() && self.own.types.is_bound(id.0 & !LOCAL);
    }
    #[inline]
    fn file(&mut self, file: FileId) {
        self.is_bound |= self.own.unimported_files.has(file.0 as usize);
    }
    #[inline]
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

/// See `Follow::mentions_own`.
struct MentionsOwn(bool);

impl Visitor for MentionsOwn {
    #[inline]
    fn atom(&mut self, atom: Atom) {
        self.0 |= atom.is_own();
    }
    #[inline]
    fn components(&mut self, id: ComponentsId) {
        self.0 |= id.is_local();
    }
    #[inline]
    fn mapper(&mut self, id: MapperId) {
        self.0 |= id.is_local();
    }
    #[inline]
    fn sig(&mut self, id: SigId) {
        self.0 |= id.is_local();
    }
    #[inline]
    fn ty(&mut self, id: TypeId) {
        self.0 |= id.is_local();
    }
    #[inline]
    fn file(&mut self, _: FileId) {}
    #[inline]
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

// ───────────────────────────── the end of a task ─────────────────────────────

/// Which task-local records of one task are published. The entries that the task publishes are the
/// roots: `Follow::mark`.
pub struct Marks([Bits; 5]);

impl Marks {
    pub fn new(own: &OwnStore) -> Marks {
        Marks(own.lengths().map(Bits::with_len))
    }

    #[inline]
    fn add(&mut self, kind: Kind, id: u32) {
        if id & LOCAL != 0 {
            self.0[kind as usize].set((id & !LOCAL) as usize);
        }
    }
}

impl Visitor for Marks {
    #[inline]
    fn atom(&mut self, atom: Atom) {
        if atom.is_own() {
            self.add(Kind::Atom, atom.0);
        }
    }
    #[inline]
    fn components(&mut self, id: ComponentsId) {
        self.add(Kind::Components, id.0);
    }
    #[inline]
    fn mapper(&mut self, id: MapperId) {
        self.add(Kind::Mapper, id.0);
    }
    #[inline]
    fn sig(&mut self, id: SigId) {
        self.add(Kind::Sig, id.0);
    }
    #[inline]
    fn ty(&mut self, id: TypeId) {
        self.add(Kind::Type, id.0);
    }
    #[inline]
    fn file(&mut self, _: FileId) {}
    #[inline]
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

/// A 128-bit hash of the content of a record, independent of the task that created it.
type ContentHash = [u64; 2];

/// Two lanes of multiply and fold, with different constants.
#[derive(Copy, Clone)]
struct Lanes(ContentHash);

#[inline]
fn fold(a: u64, b: u64) -> u64 {
    let product = u128::from(a) * u128::from(b);
    product as u64 ^ (product >> 64) as u64
}

impl Lanes {
    const START: Lanes = Lanes([0x243f_6a88_85a3_08d3, 0x1319_8a2e_0370_7344]);

    #[inline]
    fn add(&mut self, word: u64) {
        self.0[0] = fold(self.0[0] ^ word, 0x9e37_79b9_7f4a_7c15);
        self.0[1] = fold(self.0[1].rotate_left(23) ^ word, 0xc2b2_ae3d_27d4_eb4f);
    }
}

impl Hasher for Lanes {
    fn write(&mut self, bytes: &[u8]) {
        let (words, rest) = bytes.as_chunks::<8>();
        for word in words {
            self.add(u64::from_le_bytes(*word));
        }
        let mut last = [0; 8];
        last[..rest.len()].copy_from_slice(rest);
        self.add(u64::from_le_bytes(last) ^ (bytes.len() as u64) << 56);
    }
    #[inline]
    fn write_u8(&mut self, i: u8) {
        self.add(u64::from(i));
    }
    #[inline]
    fn write_u32(&mut self, i: u32) {
        self.add(u64::from(i));
    }
    #[inline]
    fn write_u64(&mut self, i: u64) {
        self.add(i);
    }
    #[inline]
    fn write_usize(&mut self, i: usize) {
        self.add(i as u64);
    }
    fn finish(&self) -> u64 {
        self.0[0]
    }
}

/// Computes the content hash of one record. A published id is hashed as its number, a task-local id
/// as the content hash of its record.
struct Content<'a> {
    lanes: Lanes,
    /// Indexed by kind and index. The records a record references are older, so their hashes are
    /// already computed.
    of: &'a [Vec<ContentHash>; 5],
}

impl<'a> Content<'a> {
    fn new(of: &'a [Vec<ContentHash>; 5], kind: Kind) -> Content<'a> {
        let mut lanes = Lanes::START;
        lanes.add(kind as u64);
        Content { lanes, of }
    }

    #[inline]
    fn id(&mut self, kind: Kind, id: u32) {
        if id & LOCAL == 0 {
            self.lanes.add(u64::from(id));
        } else {
            let [a, b] = self.of[kind as usize][(id & !LOCAL) as usize];
            // No number of a published id has the high half set.
            self.lanes.add(a | 1 << 63);
            self.lanes.add(b);
        }
    }
}

/// A visitor that hashes what it is shown.
trait Hashing: Visitor {
    /// Hashes `items` as a set: the result does not depend on their order.
    fn unordered<T: Follow>(&mut self, items: &[T]);
}

impl Hashing for Content<'_> {
    fn unordered<T: Follow>(&mut self, items: &[T]) {
        let mut sum = [0u64; 2];
        for item in items {
            let mut one = Content {
                lanes: Lanes::START,
                of: self.of,
            };
            item.visit(&mut one);
            sum[0] = sum[0].wrapping_add(one.lanes.0[0]);
            sum[1] = sum[1].wrapping_add(one.lanes.0[1]);
        }
        self.lanes.add(items.len() as u64);
        self.lanes.add(sum[0]);
        self.lanes.add(sum[1]);
    }
}

impl Visitor for Content<'_> {
    #[inline]
    fn atom(&mut self, atom: Atom) {
        if atom.is_own() {
            self.id(Kind::Atom, atom.0);
        } else {
            self.lanes.add(u64::from(atom.0));
        }
    }
    #[inline]
    fn components(&mut self, id: ComponentsId) {
        self.id(Kind::Components, id.0);
    }
    #[inline]
    fn mapper(&mut self, id: MapperId) {
        self.id(Kind::Mapper, id.0);
    }
    #[inline]
    fn sig(&mut self, id: SigId) {
        self.id(Kind::Sig, id.0);
    }
    #[inline]
    fn ty(&mut self, id: TypeId) {
        self.id(Kind::Type, id.0);
    }
    #[inline]
    fn file(&mut self, file: FileId) {
        self.lanes.add(u64::from(file.0));
    }
    #[inline]
    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut self.lanes);
    }
}

/// The content hash of a type. A union is hashed as a set, and so is an origin that is a union: two
/// tasks may have sorted members that tie in `compare_types` differently. See
/// `Types::mark_ordered_by_id`.
fn content_of_type(created: &Made, of: &[Vec<ContentHash>; 5]) -> ContentHash {
    let mut content = Content::new(of, Kind::Type);
    visit_type_as_content(created, &mut content);
    content.lanes.0
}

/// See `content_of_type`.
fn visit_type_as_content<V: Hashing>(created: &Made, content: &mut V) {
    match &created.0 {
        data @ TypeData::Union(members) => {
            content.plain(&std::mem::discriminant(data));
            content.unordered(members);
        }
        data => data.visit(content),
    }
    content.plain(&created.1.is_some());
    if let Some(provenance) = &created.1 {
        let Provenance {
            alias,
            origin,
            is_enum,
            stored_under,
            is_array_literal,
            is_array_pattern,
            has_other_instantiation,
        } = &**provenance;
        alias.visit(content);
        match origin {
            UnionOrigin::Union(types) => {
                content.plain(&std::mem::discriminant(origin));
                content.unordered(types);
            }
            origin => origin.visit(content),
        }
        is_enum.visit(content);
        stored_under.visit(content);
        is_array_literal.visit(content);
        is_array_pattern.visit(content);
        has_other_instantiation.visit(content);
    }
}

/// Computes a `Rank`.
struct Ranking<'p, 's> {
    types: Types<'p, 's>,
    /// The first lane is `Rank::content`.
    lanes: Lanes,
    /// The greatest height of a type that it was shown.
    height: u32,
    /// `Rank::place` so far.
    place: u64,
    /// The file that it was shown last. What follows a file is the number of a node or a symbol in it.
    file: Option<FileId>,
}

impl<'p, 's> Ranking<'p, 's> {
    fn new(types: Types<'p, 's>) -> Ranking<'p, 's> {
        Ranking {
            types,
            lanes: Lanes::START,
            height: 0,
            place: 0,
            file: None,
        }
    }
}

/// The first number that `Hash` writes.
struct FirstNumber(Option<u32>);

impl Hasher for FirstNumber {
    fn write(&mut self, bytes: &[u8]) {
        if self.0.is_none() {
            let mut number = [0; 4];
            let len = bytes.len().min(4);
            number[..len].copy_from_slice(&bytes[..len]);
            self.0 = Some(u32::from_le_bytes(number));
        }
    }
    fn finish(&self) -> u64 {
        u64::from(self.0.unwrap_or(0))
    }
}

impl Hashing for Ranking<'_, '_> {
    fn unordered<T: Follow>(&mut self, items: &[T]) {
        let mut sum = 0u64;
        for item in items {
            let mut one = Ranking::new(self.types);
            item.visit(&mut one);
            sum = sum.wrapping_add(one.lanes.0[0]);
            self.height = self.height.max(one.height);
            self.place = self.place.max(one.place);
        }
        self.lanes.add(items.len() as u64);
        self.lanes.add(sum);
    }
}

/// Only a type has a `Rank` of its own. What else has an id is walked in place.
impl Visitor for Ranking<'_, '_> {
    #[inline]
    fn atom(&mut self, atom: Atom) {
        let text = crate::atom::hash_of(self.types.text(atom));
        self.lanes.add(text ^ u64::from(atom.is_none()));
    }
    fn components(&mut self, id: ComponentsId) {
        self.types.components(id).visit(self);
    }
    /// The pairs are stored in the order of the ids of the type parameters.
    fn mapper(&mut self, id: MapperId) {
        let pairs = self.types.mapping(id);
        self.unordered(pairs);
    }
    fn sig(&mut self, id: SigId) {
        self.types.sig(id).visit(self);
    }
    #[inline]
    fn ty(&mut self, id: TypeId) {
        let rank = self.types.rank(id);
        self.lanes.add(rank.content);
        self.height = self.height.max(rank.height);
        self.place = self.place.max(rank.place);
    }
    #[inline]
    fn file(&mut self, file: FileId) {
        self.lanes.add(u64::from(file.0));
        self.file = Some(file);
    }
    #[inline]
    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut self.lanes);
        if let Some(file) = self.file.take() {
            let mut number = FirstNumber(None);
            value.hash(&mut number);
            // A file counts from 1: no place is 0.
            let place = (u64::from(file.0) + 1) << 32 | number.finish();
            self.place = self.place.max(place);
        }
    }
}

/// A part of the key of a type, written out for `Types::compare_contents`.
enum Said {
    Word(u64),
    Type(TypeId),
}

/// Writes out a key. As in `Rank::content`, nothing in the words is an id.
struct Saying<'p, 's> {
    types: Types<'p, 's>,
    said: Vec<Said>,
}

/// What `Hash` writes, as words.
struct Spelling<'a>(&'a mut Vec<Said>);

impl Hasher for Spelling<'_> {
    fn write(&mut self, bytes: &[u8]) {
        self.0.push(Said::Word(bytes.len() as u64));
        for chunk in bytes.chunks(8) {
            let mut word = [0; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            self.0.push(Said::Word(u64::from_le_bytes(word)));
        }
    }
    fn finish(&self) -> u64 {
        0
    }
}

impl Visitor for Saying<'_, '_> {
    fn atom(&mut self, atom: Atom) {
        self.said.push(Said::Word(u64::from(atom.is_none())));
        Spelling(&mut self.said).write(self.types.text(atom));
    }
    fn components(&mut self, id: ComponentsId) {
        self.types.components(id).visit(self);
    }
    /// The pairs are stored in the order of the ids of the type parameters.
    fn mapper(&mut self, id: MapperId) {
        let types = self.types;
        let mut pairs = types.mapping(id).to_vec();
        pairs.shared_sort_by(|x, y| types.content_order(x.0, y.0));
        pairs.visit(self);
    }
    fn sig(&mut self, id: SigId) {
        self.types.sig(id).visit(self);
    }
    fn ty(&mut self, id: TypeId) {
        self.said.push(Said::Type(id));
    }
    fn file(&mut self, file: FileId) {
        self.said.push(Said::Word(u64::from(file.0)));
    }
    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut Spelling(&mut self.said));
    }
}

/// The number of parts into which the merge step partitions the records by content hash. One thread
/// groups the records of one part.
const HASH_PARTS: usize = 64;

/// A step that publishes fewer records than this is merged on one thread.
const FEW_RECORDS: usize = 4096;

/// The published records of one kind and one task.
struct Taken<V> {
    /// The number of records of the kind the task had, which is the length of its `Link` array.
    len: usize,
    /// The index in the task's store, the content hash, the record. In creation order.
    records: Vec<(u32, ContentHash, V)>,
    /// The positions in `records`, grouped by hash part, in order within a part.
    positions: Vec<u32>,
    /// The start of each part in `positions`, and the end of the last.
    parts: [u32; HASH_PARTS + 1],
    /// In a debug build, after `number`: the records that were merged with another record, each
    /// with the id of that record. See `check_joined`.
    joined: Vec<(u32, V)>,
}

impl<V> Taken<V> {
    fn map<U>(self, mut of: impl FnMut(V) -> U) -> Taken<U> {
        let records = self.records.into_iter();
        let joined = self.joined.into_iter();
        Taken {
            len: self.len,
            records: records
                .map(|(index, hash, record)| (index, hash, of(record)))
                .collect(),
            positions: self.positions,
            parts: self.parts,
            joined: joined.map(|(id, record)| (id, of(record))).collect(),
        }
    }
}

impl<V> Default for Taken<V> {
    fn default() -> Self {
        Taken {
            len: 0,
            records: Vec::new(),
            positions: Vec::new(),
            parts: [0; HASH_PARTS + 1],
            joined: Vec::new(),
        }
    }
}

/// The task-local records that one task publishes. A field of `Finished`.
#[derive(Default)]
pub struct OwnRecords<'s> {
    atoms: Taken<List<'s, u8>>,
    components: Taken<List<'s, IndexComponent>>,
    mappers: Taken<MapperRecord<'s>>,
    sigs: Taken<SigData<'s>>,
    types: Taken<TypeRecord<'s>>,
}

fn take<V>(own: &mut Own<V>, marks: &Bits, hashes: &[ContentHash]) -> Taken<V> {
    let mut taken = Taken {
        len: own.records.len() as usize,
        ..Taken::default()
    };
    own.records.drain(|index, record| {
        if marks.has(index as usize) {
            taken.records.push((index, hashes[index as usize], record));
        }
    });
    own.found.clear();
    own.bound.clear();
    // A counting sort by the part.
    let part = |record: &(u32, ContentHash, V)| (record.1[0] >> (64 - HASH_PARTS.ilog2())) as usize;
    for record in &taken.records {
        taken.parts[part(record) + 1] += 1;
    }
    for i in 0..HASH_PARTS {
        taken.parts[i + 1] += taken.parts[i];
    }
    let mut next = taken.parts;
    taken.positions = vec![0; taken.records.len()];
    for (position, record) in taken.records.iter().enumerate() {
        let at = &mut next[part(record)];
        taken.positions[*at as usize] = position as u32;
        *at += 1;
    }
    taken
}

impl<'s> OwnStore<'s> {
    /// The number of records of each kind, in the order of `KINDS`.
    pub(crate) fn lengths(&self) -> [usize; 5] {
        [
            self.atoms.records.len() as usize,
            self.components.records.len() as usize,
            self.mappers.records.len() as usize,
            self.sigs.records.len() as usize,
            self.types.records.len() as usize,
        ]
    }

    /// How many records of each kind the task has created, in the order of `KINDS`. For who wants to know whether a
    /// computation has created one.
    #[inline]
    pub(crate) fn created(&self) -> [usize; 5] {
        let mut created = self.lengths();
        for (count, published) in created.iter_mut().zip(&self.published) {
            *count += published.get() as usize;
        }
        created
    }

    /// Runs at the end of the task. `marks`: the records referenced by the entries that the task
    /// publishes. Three passes over the creation log. A record that is not published costs only a
    /// test.
    pub fn finish(&mut self, mut marks: Marks) -> OwnRecords<'s> {
        let stores = self;
        let entry = |at: u32| {
            let entry = *stores.log.get(at);
            let index = entry & ((1 << KIND_SHIFT) - 1);
            (KINDS[(entry >> KIND_SHIFT) as usize], index)
        };
        // Backwards: the records a record references are older than it.
        for at in (0..stores.log.len()).rev() {
            let (kind, index) = entry(at);
            if !marks.0[kind as usize].has(index as usize) {
                continue;
            }
            match kind {
                Kind::Atom => {}
                Kind::Components => stores.components.records.get(index).visit(&mut marks),
                Kind::Mapper => stores.mappers.records.get(index).0.visit(&mut marks),
                Kind::Sig => stores.sigs.records.get(index).visit(&mut marks),
                Kind::Type => stores.types.records.get(index).created.visit(&mut marks),
            }
        }
        // Forwards: the records a record references already have their hashes.
        let mut hashes: [Vec<ContentHash>; 5] = stores.lengths().map(|len| vec![[0; 2]; len]);
        for at in 0..stores.log.len() {
            let (kind, index) = entry(at);
            if !marks.0[kind as usize].has(index as usize) {
                continue;
            }
            let mut content = Content::new(&hashes, kind);
            let hash = match kind {
                Kind::Atom => {
                    content.plain(&**stores.atoms.records.get(index));
                    content.lanes.0
                }
                Kind::Components => {
                    stores.components.records.get(index).visit(&mut content);
                    content.lanes.0
                }
                // The pairs are in the order of the ids of the type parameters, which two tasks may have created in different orders.
                Kind::Mapper => {
                    content.unordered(&stores.mappers.records.get(index).0);
                    content.lanes.0
                }
                Kind::Sig => {
                    stores.sigs.records.get(index).visit(&mut content);
                    content.lanes.0
                }
                Kind::Type => content_of_type(&stores.types.records.get(index).created, &hashes),
            };
            hashes[kind as usize][index as usize] = hash;
        }
        stores.log.clear();
        stores.unimported_files.0.clear();
        let [atoms, components, mappers, sigs, types] = &marks.0;
        OwnRecords {
            atoms: take(&mut stores.atoms, atoms, &hashes[0]),
            components: take(&mut stores.components, components, &hashes[1]),
            mappers: take(&mut stores.mappers, mappers, &hashes[2]),
            sigs: take(&mut stores.sigs, sigs, &hashes[3]),
            types: take(&mut stores.types, types, &hashes[4]),
        }
    }
}

// ───────────────────────────── the merge step ─────────────────────────────

/// For one task: the published id of each of its task-local records, by index. `u32::MAX`: the
/// record is not published.
#[derive(Default)]
pub struct Link {
    atoms: Box<[u32]>,
    components: Box<[u32]>,
    mappers: Box<[u32]>,
    sigs: Box<[u32]>,
    types: Box<[u32]>,
}

/// Statistics of one merge step, by kind.
#[derive(Copy, Clone, Default)]
pub struct LinkCounts {
    /// The number of records the tasks of the step publish, before any are merged.
    pub linked: [usize; KINDS.len()],
    /// The number of them that were merged with the record of a lower task.
    pub joined: [usize; KINDS.len()],
}

impl LinkCounts {
    pub const NAMES: [&str; KINDS.len()] =
        ["atoms", "components", "mappers", "signatures", "types"];
}

/// GROUP, NUMBER, LINK, for one kind. `tasks` is in task order. Among the records with the same
/// content hash the one with the lowest (task, index) survives, and the survivors are numbered from
/// `first_free` on, in that order. Returns the `Link` array of each task for the kind. Afterwards
/// `records` holds the survivors, with the new id in place of the index.
/// No stage depends on timing: each hash part, or each task, is processed by exactly one thread.
fn number<V: Send + Sync>(
    tasks: &mut [&mut Taken<V>],
    first_free: u32,
    in_parallel: InParallel<'_>,
) -> Vec<Box<[u32]>> {
    // Nothing that is published references a task-local record of the kind.
    if tasks.iter().all(|task| task.records.is_empty()) {
        return tasks.iter().map(|_| Box::default()).collect();
    }
    let place = |task: usize, position: usize| (task as u64) << 32 | position as u64;
    // GROUP: for each record, the `place` of the first record with the same hash.
    let firsts: Vec<Vec<AtomicU64>> = (tasks.iter())
        .map(|task| (0..task.records.len()).map(|_| AtomicU64::new(0)).collect())
        .collect();
    {
        let tasks: &[&mut Taken<V>] = tasks;
        in_parallel(HASH_PARTS, &|part| {
            let mut first: FxHashMap<ContentHash, u64> = FxHashMap::default();
            for (t, task) in tasks.iter().enumerate() {
                let (from, to) = (task.parts[part] as usize, task.parts[part + 1] as usize);
                for &position in &task.positions[from..to] {
                    let position = position as usize;
                    let hash = task.records[position].1;
                    let first = *first.entry(hash).or_insert_with(|| place(t, position));
                    firsts[t][position].store(first, Ordering::Relaxed);
                }
            }
        });
    }
    // NUMBER: the rank of each surviving record among those of its task, then the first id of each
    // task.
    struct Ranks {
        task: usize,
        ranks: Vec<u32>,
        count: u32,
    }
    let mut ranks: Vec<Ranks> = (0..tasks.len())
        .map(|task| Ranks {
            task,
            ranks: Vec::new(),
            count: 0,
        })
        .collect();
    for_each_mut(&mut ranks, in_parallel, &|it| {
        let (task, mut count) = (it.task, 0);
        it.ranks = (firsts[task].iter().enumerate())
            .map(|(position, first)| {
                let rank = count;
                count += u32::from(first.load(Ordering::Relaxed) == place(task, position));
                rank
            })
            .collect();
        it.count = count;
    });
    let mut next = first_free;
    let begins: Vec<u32> = (ranks.iter())
        .map(|it| {
            next += it.count;
            next - it.count
        })
        .collect();
    // LINK
    let mut links: Vec<(usize, &mut Taken<V>, Box<[u32]>)> = (tasks.iter_mut().enumerate())
        .map(|(t, task)| (t, &mut **task, Box::default()))
        .collect();
    for_each_mut(&mut links, in_parallel, &|(t, task, link)| {
        let mut ids = vec![u32::MAX; task.len].into_boxed_slice();
        let mut stay = Vec::with_capacity(ranks[*t].count as usize);
        let records = std::mem::take(&mut task.records);
        for (position, mut record) in records.into_iter().enumerate() {
            let first = firsts[*t][position].load(Ordering::Relaxed);
            let (of, at) = ((first >> 32) as usize, first as u32 as usize);
            let id = begins[of] + ranks[of].ranks[at];
            ids[record.0 as usize] = id;
            record.0 = id;
            if first == place(*t, position) {
                stay.push(record);
            } else if cfg!(debug_assertions) {
                task.joined.push((id, record.2));
            }
        }
        task.records = stay;
        *link = ids;
    });
    links.into_iter().map(|it| it.2).collect()
}

/// What `put` must do with a record, after `follow` has been applied to it.
enum Placed<V> {
    /// It is indexed under this hash.
    Indexed(V, u64),
    /// It is not in the hash index: it is looked up some other way.
    NotIndexed(V),
    /// It cannot be completed until the other records are stored.
    Later(V),
}

/// FOLLOW, for one kind: writes the surviving records into the shared store, at their ids. Returns
/// those that are `Later`, in id order: the caller writes them. Also returns, for `check_joined`,
/// the merged records, remapped. `first` is the id of the first element of `items`.
fn put<V: Send + Sync, A: Allocator + Clone + Sync>(
    (shards, items, first): (&[GrowingPlaces<A>], &AppendVec<V, A>, u32),
    tasks: Vec<(Taken<V>, &Link)>,
    in_parallel: InParallel<'_>,
    settle: &(dyn Fn(V, &Link, u32) -> Placed<V> + Sync),
) -> (Vec<(u32, V)>, Vec<(u32, V)>) {
    struct Work<'a, V> {
        task: Taken<V>,
        link: &'a Link,
        /// The entries to add to the index, by shard.
        added: Vec<Vec<(u64, u32)>>,
        later: Vec<(u32, V)>,
    }
    let count: usize = tasks.iter().map(|(task, _)| task.records.len()).sum();
    if count == 0 {
        return (Vec::new(), Vec::new());
    }
    // SAFETY: every id that `number` assigned is written below, or by the caller if it is `Later`.
    unsafe { items.reserve(count as u32) };
    let mut work: Vec<Work<'_, V>> = (tasks.into_iter())
        .map(|(task, link)| Work {
            task,
            link,
            added: vec![Vec::new(); shards.len()],
            later: Vec::new(),
        })
        .collect();
    for_each_mut(&mut work, in_parallel, &|it| {
        for (id, _, record) in std::mem::take(&mut it.task.records) {
            let record = match settle(record, it.link, id) {
                Placed::Indexed(record, spread) => {
                    it.added[shard_among(spread, shards.len())].push((spread, id));
                    record
                }
                Placed::NotIndexed(record) => record,
                Placed::Later(record) => {
                    it.later.push((id, record));
                    continue;
                }
            };
            // SAFETY: the id is in the range that was reserved, and no other record has it.
            unsafe { items.write(id - first, record) };
        }
    });
    {
        let work = &work;
        in_parallel(shards.len(), &|shard| {
            let count = work.iter().map(|it| it.added[shard].len()).sum();
            let added = work.iter().flat_map(|it| it.added[shard].iter().copied());
            shards[shard].extend(count, added);
        });
    }
    let mut joined = Vec::new();
    for it in &mut work {
        for (id, record) in std::mem::take(&mut it.task.joined) {
            if let Placed::Indexed(record, _) | Placed::NotIndexed(record) =
                settle(record, it.link, id)
            {
                joined.push((id, record));
            }
        }
    }
    (work.into_iter().flat_map(|it| it.later).collect(), joined)
}

/// In a debug build: a record that was merged with another must equal it. Otherwise two different
/// contents have the same content hash.
fn check_joined<V, A: Allocator + Clone>(
    (_, items, first): (&[GrowingPlaces<A>], &AppendVec<V, A>, u32),
    joined: Vec<(u32, V)>,
    is_same: impl Fn(&V, &V) -> bool,
) {
    for (id, record) in joined {
        assert!(
            is_same(&record, items.get(id - first)),
            "two records with one content hash differ"
        );
    }
}

impl<'s> TypeStore<'s> {
    /// Runs at the barrier, before the tables are published. `tasks`: the records the tasks of the
    /// step publish, in task order. Assigns every record its published id, writes the records into
    /// the shared stores, and returns the `Link` of each task, for `Follow::follow`, and counts.
    /// `sort`: `Checker::sort_types`, for a union whose order depended on task-local ids.
    pub fn link(
        &self,
        atoms: &Interner<'s>,
        mut tasks: Vec<OwnRecords<'s>>,
        in_parallel: InParallel<'_>,
        sort: &dyn Fn(&mut [TypeId]),
    ) -> (Vec<Link>, LinkCounts) {
        fn of<'a, 's, V>(
            tasks: &'a mut [OwnRecords<'s>],
            kind: for<'x> fn(&'x mut OwnRecords<'s>) -> &'x mut Taken<V>,
        ) -> Vec<&'a mut Taken<V>> {
            tasks.iter_mut().map(kind).collect()
        }
        let count = |tasks: &[OwnRecords]| {
            let sum = |of: fn(&OwnRecords) -> usize| tasks.iter().map(of).sum::<usize>();
            [
                sum(|it| it.atoms.records.len()),
                sum(|it| it.components.records.len()),
                sum(|it| it.mappers.records.len()),
                sum(|it| it.sigs.records.len()),
                sum(|it| it.types.records.len()),
            ]
        };
        let linked = count(&tasks);
        let all: usize = linked.iter().sum();
        if all == 0 {
            let links = tasks.iter().map(|_| Link::default()).collect();
            return (links, LinkCounts::default());
        }
        debug_assert!(
            !self.shares_records(),
            "what is not published at once is bound"
        );
        // Dispatching a stage to the pool costs more than the stage itself. The ids are the same:
        // no stage depends on which thread runs it.
        let on_this_thread: InParallel<'_> = &|count, work| (0..count).for_each(work);
        let in_parallel = if all < FEW_RECORDS {
            on_this_thread
        } else {
            in_parallel
        };
        let mut links = [
            number(
                &mut of(&mut tasks, |it| &mut it.atoms),
                atoms.halves().2 + atoms.halves().1.len(),
                in_parallel,
            ),
            number(
                &mut of(&mut tasks, |it| &mut it.components),
                self.components.items.len(),
                in_parallel,
            ),
            number(
                &mut of(&mut tasks, |it| &mut it.mappers),
                self.mappers.items.len(),
                in_parallel,
            ),
            number(
                &mut of(&mut tasks, |it| &mut it.sigs),
                self.sigs.items.len(),
                in_parallel,
            ),
            number(
                &mut of(&mut tasks, |it| &mut it.types),
                self.types.items.len(),
                in_parallel,
            ),
        ]
        .map(Vec::into_iter);
        // `number` has left only the surviving records.
        let stay = count(&tasks);
        let counts = LinkCounts {
            linked,
            joined: std::array::from_fn(|kind| linked[kind] - stay[kind]),
        };
        let links: Vec<Link> = (0..tasks.len())
            .map(|_| {
                let [atoms, components, mappers, sigs, types] = &mut links;
                Link {
                    atoms: atoms.next().unwrap(),
                    components: components.next().unwrap(),
                    mappers: mappers.next().unwrap(),
                    sigs: sigs.next().unwrap(),
                    types: types.next().unwrap(),
                }
            })
            .collect();
        let (mut texts, mut components, mut mappers, mut sigs, mut types) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for (task, link) in tasks.into_iter().zip(&links) {
            // The texts of the interner are not in an arena: see `atom::Tables`.
            texts.push((task.atoms.map(|text| crate::atom::Text::from(&*text)), link));
            components.push((task.components, link));
            mappers.push((task.mappers, link));
            sigs.push((task.sigs, link));
            types.push((task.types, link));
        }
        let (_, joined) = put(atoms.halves(), texts, in_parallel, &|text, _, id| {
            atoms.set_class(Atom(id), &text);
            let spread = crate::atom::hash_of(&text);
            Placed::Indexed(text, spread)
        });
        check_joined(atoms.halves(), joined, |a, b| **a == **b);
        let (_, joined) = put(
            self.components.halves(),
            components,
            in_parallel,
            &|mut list, link, _| {
                list.follow(link);
                let spread = spread_hash(&list);
                Placed::Indexed(list, spread)
            },
        );
        check_joined(self.components.halves(), joined, |a, b| a == b);
        let (_, joined) = put(
            self.mappers.halves(),
            mappers,
            in_parallel,
            &|(mut pairs, flags), link, _| {
                pairs.follow(link);
                pairs.sort_unstable_by_key(|pair| pair.0.arrival_order());
                let spread = spread_hash(&Pairs(&pairs));
                Placed::Indexed((pairs, flags), spread)
            },
        );
        check_joined(self.mappers.halves(), joined, |a, b| a == b);
        let (_, joined) = put(
            self.sigs.halves(),
            sigs,
            in_parallel,
            &|mut data, link, _| {
                data.follow(link);
                let spread = spread_hash(&data);
                Placed::Indexed(data, spread)
            },
        );
        check_joined(self.sigs.halves(), joined, |a, b| a == b);
        let (later, joined) = put(
            self.types.halves(),
            types,
            in_parallel,
            &|mut record, link, id| {
                record.created.follow(link);
                record.id = TypeId(id);
                if matches!(record.created.0, TypeData::UnresolvedName { .. }) {
                    self.has_unresolved_names.store(true, Ordering::Relaxed);
                }
                if *record.is_ordered_by_id.get_mut() {
                    return Placed::Later(record);
                }
                match record.created {
                    (TypeData::StringLit { value, fresh }, None) => {
                        self.string_literals[usize::from(fresh)].insert(value, TypeId(id));
                        Placed::NotIndexed(record)
                    }
                    _ => {
                        let spread = spread_hash(&record.created);
                        Placed::Indexed(record, spread)
                    }
                }
            },
        );
        // On one thread, in ascending id order: the constituents of such a union are already
        // stored, and `sort` reads them.
        for (id, mut record) in later {
            self.summarize_types(id);
            *record.is_ordered_by_id.get_mut() = false;
            if let TypeData::Union(members) = &mut record.created.0 {
                sort(members);
            }
            if let Some(provenance) = &mut record.created.1
                && let UnionOrigin::Union(types) = &mut provenance.origin
            {
                sort(types);
            }
            let spread = spread_hash(&record.created);
            // SAFETY: `put` has reserved the id and left it to be written here.
            unsafe { self.types.items.write(id, record) };
            (self.types.shard(spread)).extend(1, std::iter::once((spread, id)));
        }
        check_joined(self.types.halves(), joined, |a, b| a.created == b.created);
        self.summarize_types(self.types.items.len());
        (links, counts)
    }
}

/// mimalloc is foreign code, which Miri does not run.
#[cfg(all(test, not(miri)))]
mod tests {
    use super::*;

    type Fat<'s> = ShortList<TypeId, 3, List<'s, TypeId>>;
    type Thin<'s> = ShortList<TypeId, 3, ThinList<'s, TypeId>>;

    fn ids(len: u32) -> Vec<TypeId> {
        (0..len).map(|i| TypeId(i + 10)).collect()
    }

    #[test]
    fn a_short_list_holds_up_to_its_limit_itself() {
        let session = Session::new();
        let arena = session.arena();
        assert!(Fat::empty().is_empty() && Thin::default().is_empty());
        for len in [0, 1, 2, 3, 4, 7, 8, 300] {
            let items = ids(len);
            let (fat, thin) = (
                Fat::copy_from_slice_in(&items, arena),
                Thin::copy_from_slice_in(&items, arena),
            );
            assert_eq!(matches!(fat, ShortList::Inline(..)), len <= 3);
            assert_eq!(matches!(thin, ShortList::Inline(..)), len <= 3);
            assert_eq!((&*fat, &*thin), (&items[..], &items[..]));
            assert!((&fat).into_iter().eq(&items) && (&thin).into_iter().eq(&items));
            assert_eq!(format!("{fat:?}"), format!("{items:?}"));
        }
    }

    #[test]
    fn a_short_list_is_compared_and_hashed_as_its_items() {
        let session = Session::new();
        let arena = session.arena();
        for len in [0, 1, 3, 4] {
            let items = ids(len);
            let list = Fat::copy_from_slice_in(&items, arena);
            // What the places without an item hold does not count, nor where the items are.
            let mut places = [TypeId(7); 3];
            let inline = (len <= 3).then(|| {
                places[..items.len()].copy_from_slice(&items);
                Fat::Inline(len as u8, places)
            });
            let spilled = Fat::Spilled(List::copy_from_slice_in(&items, arena));
            for other in inline.into_iter().chain([spilled]) {
                assert!(list == other);
                assert_eq!(spread_hash(&list), spread_hash(&other));
            }
            assert_eq!(spread_hash(&list), spread_hash(&items[..]));
            assert!(list != Fat::copy_from_slice_in(&ids(len + 1), arena));
        }
    }

    #[test]
    fn a_copy_of_a_short_list_is_its_own() {
        let session = Session::new();
        let arena = session.arena();
        for len in [0, 3, 4, 7, 8] {
            let items = ids(len);
            let mut list = Thin::copy_from_slice_in(&items, arena);
            let copy = list.clone_in(arena);
            list.iter_mut().for_each(|item| item.0 += 1);
            assert_eq!(*copy, *items);
            let mut pairs = list.iter().zip(&items);
            assert!(pairs.all(|(now, before)| now.0 == before.0 + 1));
            assert_eq!(list.len(), items.len());
        }
    }

    #[test]
    fn a_short_list_is_visited_as_its_items() {
        let session = Session::new();
        let arena = session.arena();
        for len in [1, 3, 4, 8] {
            for own in 0..=len {
                let mut items = ids(len);
                if let Some(item) = items.get_mut(own as usize) {
                    item.0 |= LOCAL;
                }
                let is_mentioned = own < len;
                assert_eq!(
                    Fat::copy_from_slice_in(&items, arena).mentions_own(),
                    is_mentioned
                );
                assert_eq!(
                    Thin::copy_from_slice_in(&items, arena).mentions_own(),
                    is_mentioned
                );
            }
        }
    }

    #[test]
    fn a_borrowed_key_mentions_what_the_type_mentions() {
        let session = Session::new();
        let arena = session.arena();
        let target = Sym {
            file: FileId(0),
            id: crate::bind::SymbolId(1),
        };
        let plain = ProvenanceKey {
            alias: None,
            origin: OriginKey::None,
            is_enum: false,
            stored_under: None,
            is_array_literal: false,
            is_array_pattern: false,
            has_other_instantiation: false,
        };
        let under = InstantiationKey {
            type_arguments: MapperId::IDENTITY,
            alias: None,
            could_contain_type_variables: false,
            nesting: 0,
        };
        let check = |key: TypeKey<'_>, is_mentioned: bool| {
            let data = key.to_data(arena);
            assert_eq!(key.mentions_own(), is_mentioned);
            assert_eq!(data.mentions_own(), is_mentioned);
            assert_eq!(TypeKey::Data(&data).mentions_own(), is_mentioned);
        };
        let check_provenance = |key: ProvenanceKey<'_>, is_mentioned: bool| {
            assert_eq!(key.mentions_own(), is_mentioned);
            assert_eq!(key.to_provenance(arena).mentions_own(), is_mentioned);
        };
        // The task-local type in each place of a list that is in the record, and of one that is not.
        for len in [3, 5, 9] {
            let flags = vec![ElemFlags::REQUIRED; len as usize];
            for own in 0..=len {
                let mut types = ids(len);
                if let Some(ty) = types.get_mut(own as usize) {
                    ty.0 |= LOCAL;
                }
                let (types, is_mentioned) = (&types[..], own < len);
                check(TypeKey::Union(types), is_mentioned);
                check(TypeKey::Intersection(types), is_mentioned);
                let args = types;
                check(TypeKey::Ref { target, args }, is_mentioned);
                check(
                    TypeKey::Tuple {
                        elems: types,
                        flags: &flags,
                        readonly: false,
                    },
                    is_mentioned,
                );
                let alias = Some((target, types));
                check_provenance(ProvenanceKey { alias, ..plain }, is_mentioned);
                for origin in [OriginKey::Union(types), OriginKey::Intersection(types)] {
                    check_provenance(ProvenanceKey { origin, ..plain }, is_mentioned);
                }
            }
        }
        check_provenance(plain, false);
        for (number, is_mentioned) in [(5, false), (LOCAL | 5, true)] {
            let decls = &[(FileId(0), FnId(0))];
            let mapper = MapperId(number);
            check(TypeKey::Fns { decls, mapper }, is_mentioned);
            let origin = OriginKey::Keyof(TypeId(number));
            check_provenance(ProvenanceKey { origin, ..plain }, is_mentioned);
            for key in [
                InstantiationKey {
                    type_arguments: mapper,
                    ..under
                },
                InstantiationKey {
                    alias: Some((target, TypeId(number))),
                    ..under
                },
            ] {
                let stored_under = Some(key);
                let key = ProvenanceKey {
                    stored_under,
                    ..plain
                };
                check_provenance(key, is_mentioned);
            }
            assert_eq!(Atom(number).mentions_own(), is_mentioned);
            assert_eq!(SigId(number).mentions_own(), is_mentioned);
            assert_eq!(ComponentsId(number).mentions_own(), is_mentioned);
        }
        assert!(!Atom::NONE.mentions_own());
    }

    /// Calls `make` with a new store that orders by content, twice. It creates two types: the first time it is told to
    /// create what they are made of in the opposite order. Returns the order of the two by rank and by what their keys
    /// say, after it has made sure that both are the same both times, and the reverse for the reverse.
    fn orders_of(
        make: impl Fn(Types<'_, '_>, &Interner<'_>, bool) -> (TypeId, TypeId),
    ) -> [std::cmp::Ordering; 2] {
        let orders = [true, false].map(|is_reversed| {
            let session = Session::new();
            let atoms = Interner::new_in(&session);
            let store = TypeStore::ordered_by_content_in(&session, atoms);
            let own = OwnStore::new_in(session.arena());
            let types = Types::new(&store, &own);
            let (a, b) = make(types, &atoms, is_reversed);
            assert_ne!(a, b);
            let orders = [types.creation_order(a, b), types.compare_contents(a, b)];
            let reverse = [types.creation_order(b, a), types.compare_contents(b, a)];
            assert_eq!(orders.map(std::cmp::Ordering::reverse), reverse);
            assert!(orders.iter().all(|order| order.is_ne()));
            orders
        });
        assert_eq!(orders[0], orders[1]);
        orders[0]
    }

    /// `first()` and `second()`, called in the opposite order if `is_reversed`.
    fn both<T>(is_reversed: bool, first: impl FnOnce() -> T, second: impl FnOnce() -> T) -> (T, T) {
        if is_reversed {
            let second = second();
            return (first(), second);
        }
        let first = first();
        (first, second())
    }

    #[test]
    fn content_order_does_not_depend_on_which_type_was_created_first() {
        orders_of(|types, _, is_reversed| {
            both(
                is_reversed,
                || types.intern(TypeData::Keyof(TypeId::STRING)),
                || types.intern(TypeData::Keyof(TypeId::NUMBER)),
            )
        });
    }

    #[test]
    fn a_type_comes_after_what_it_is_made_of() {
        let session = Session::new();
        let store = TypeStore::ordered_by_content_in(&session, Interner::new_in(&session));
        let own = OwnStore::new_in(session.arena());
        let types = Types::new(&store, &own);
        // The outer ones first, as far as that goes: `keyof keyof number` is older than `keyof string`.
        let of_number = types.intern(TypeData::Keyof(TypeId::NUMBER));
        let outer = types.intern(TypeData::Keyof(of_number));
        let of_string = types.intern(TypeData::Keyof(TypeId::STRING));
        for (part, whole) in [
            (TypeId::NUMBER, of_number),
            (of_number, outer),
            (TypeId::NUMBER, outer),
            (of_string, outer),
        ] {
            assert!(types.creation_order(part, whole).is_lt());
            assert!(types.creation_order(whole, part).is_gt());
            assert!(types.is_created_no_earlier(whole, part));
            assert!(!types.is_created_no_earlier(part, whole));
        }
        // Of one height.
        assert!(types.is_created_no_earlier(of_string, of_number));
        assert!(types.is_created_no_earlier(of_number, of_string));
        assert!(types.creation_order(outer, outer).is_eq());
    }

    #[test]
    fn of_two_types_of_one_height_the_one_that_mentions_later_syntax_comes_later() {
        fn this_of(types: Types<'_, '_>, (file, symbol): (u32, u32)) -> TypeId {
            types.intern(TypeData::ThisParam(Sym {
                file: FileId(file),
                id: crate::bind::SymbolId(symbol),
            }))
        }
        for (earlier, later) in [((0, 3), (0, 7)), ((0, 7), (1, 0)), ((2, 300), (2, 301))] {
            let [by_rank, _] = orders_of(|types, _, is_reversed| {
                both(
                    is_reversed,
                    || this_of(types, earlier),
                    || this_of(types, later),
                )
            });
            assert!(by_rank.is_lt());
            // Through a type that the key mentions.
            let [by_rank, _] = orders_of(|types, _, is_reversed| {
                both(
                    is_reversed,
                    || types.intern(TypeData::Keyof(this_of(types, earlier))),
                    || types.intern(TypeData::Keyof(this_of(types, later))),
                )
            });
            assert!(by_rank.is_lt());
        }
    }

    #[test]
    fn keys_that_differ_in_a_type_are_ordered_as_the_two_types() {
        fn inner(types: Types<'_, '_>, is_reversed: bool) -> (TypeId, TypeId) {
            both(
                is_reversed,
                || types.intern(TypeData::Keyof(TypeId::STRING)),
                || types.intern(TypeData::Keyof(TypeId::NUMBER)),
            )
        }
        let [of_inner, _] = orders_of(|types, _, is_reversed| inner(types, is_reversed));
        let [_, by_keys] = orders_of(|types, _, is_reversed| {
            let (a, b) = inner(types, is_reversed);
            both(
                !is_reversed,
                || types.intern(TypeData::Keyof(a)),
                || types.intern(TypeData::Keyof(b)),
            )
        });
        assert_eq!(by_keys, of_inner);
    }

    #[test]
    fn an_atom_counts_as_its_text() {
        let pairs: [[&[u8]; 2]; 2] = [[b"left", b"right"], [b"a text of more than a word", b"a"]];
        for texts in pairs {
            orders_of(|types, atoms, is_reversed| {
                let (a, b) = both(
                    is_reversed,
                    || atoms.intern(texts[0]),
                    || atoms.intern(texts[1]),
                );
                let literal = |value| {
                    types.intern(TypeData::StringLit {
                        value,
                        fresh: false,
                    })
                };
                (literal(a), literal(b))
            });
        }
    }

    #[test]
    fn a_mapper_counts_as_its_pairs_in_any_order() {
        orders_of(|types, _, is_reversed| {
            let parameter = |number, mapper| {
                types.intern(TypeData::TypeParam(FileId(0), TypeParamId(number), mapper))
            };
            // A mapper stores its pairs in the order of the ids of the type parameters.
            let (p, q) = both(
                is_reversed,
                || parameter(0, MapperId::IDENTITY),
                || parameter(1, MapperId::IDENTITY),
            );
            let one = types.mapper(vec![(p, TypeId::STRING), (q, TypeId::NUMBER)]);
            let other = types.mapper(vec![(p, TypeId::NUMBER), (q, TypeId::STRING)]);
            (parameter(2, one), parameter(2, other))
        });
    }

    #[test]
    fn a_union_has_one_rank_however_its_members_are_ordered() {
        let session = Session::new();
        let store = TypeStore::ordered_by_content_in(&session, Interner::new_in(&session));
        let own = OwnStore::new_in(session.arena());
        let types = Types::new(&store, &own);
        let rank_of = |members: [TypeId; 3]| {
            let members = ShortList::copy_from_slice_in(&members, session.arena());
            let rank = types.rank_of_type(&(TypeData::Union(members), None));
            (rank.height, rank.content)
        };
        let [a, b, c] = [TypeId::STRING, TypeId::NUMBER, TypeId::NULL];
        assert_eq!(rank_of([a, b, c]), rank_of([c, a, b]));
        assert_ne!(rank_of([a, b, c]), rank_of([a, b, TypeId::UNDEFINED]));
    }

    #[test]
    fn a_published_type_keeps_its_rank() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let store = TypeStore::ordered_by_content_in(&session, atoms);
        let mut own = OwnStore::new_in(session.arena());
        let types = Types::new(&store, &own);
        let inner = types.intern(TypeData::Keyof(TypeId::STRING));
        let outer = types.intern(TypeData::Keyof(inner));
        let ranks = [inner, outer].map(|ty| (types.rank(ty).height, types.rank(ty).content));
        let mut marks = Marks::new(&own);
        outer.visit(&mut marks);
        let taken = own.finish(marks);
        let on_this_thread: InParallel<'_> = &|count, work| (0..count).for_each(work);
        let (links, _) = store.link(&atoms, vec![taken], on_this_thread, &|_| {});
        let (mut inner, mut outer) = (inner, outer);
        inner.follow(&links[0]);
        outer.follow(&links[0]);
        assert!(!inner.is_local() && !outer.is_local());
        let own = OwnStore::new_in(session.arena());
        let types = Types::new(&store, &own);
        let published = [inner, outer].map(|ty| (types.rank(ty).height, types.rank(ty).content));
        assert_eq!(published, ranks);
    }

    fn sharing_store<'s>(session: &'s Session, atoms: Interner<'s>) -> TypeStore<'s> {
        let mut store = TypeStore::ordered_by_content_in(session, atoms);
        store.share_records();
        store
    }

    fn own_store(session: &Session, sharing: Sharing) -> OwnStore<'_> {
        let mut own = OwnStore::new_in(session.arena());
        own.set_sharing(sharing);
        own
    }

    #[test]
    fn threads_that_create_the_same_types_get_the_same_ids() {
        const COUNT: usize = 3000;
        let session = Session::new();
        let store = sharing_store(&session, Interner::new_in(&session));
        // More than one block of ids, each type made of the one before.
        let create = || {
            let own = own_store(&session, Sharing::Publishes);
            let types = Types::new(&store, &own);
            let mut created = vec![TypeId::STRING];
            for at in 0..COUNT {
                created.push(types.intern(TypeData::Keyof(created[at])));
            }
            store.take_back_ids(&own);
            created
        };
        let all: Vec<Vec<TypeId>> = std::thread::scope(|scope| {
            let threads: Vec<_> = (0..8).map(|_| scope.spawn(create)).collect();
            (threads.into_iter())
                .map(|thread| thread.join().unwrap())
                .collect()
        });
        assert!(all.iter().all(|created| *created == all[0]));
        let own = own_store(&session, Sharing::Finds);
        let types = Types::new(&store, &own);
        for at in 0..COUNT {
            let (of, ty) = (all[0][at], all[0][at + 1]);
            assert!(!ty.is_local());
            assert!(matches!(*types.get(ty), TypeData::Keyof(it) if it == of));
            assert_eq!(types.flags(ty), tf::INDEX);
            assert_eq!(types.rank(ty).height as usize, at + 2);
            assert_eq!(types.intern(TypeData::Keyof(of)), ty);
        }
        assert_eq!(own.created(), [0; 5]);
    }

    #[test]
    fn what_is_bound_is_not_published() {
        let session = Session::new();
        let store = sharing_store(&session, Interner::new_in(&session));
        let mut own = own_store(&session, Sharing::Publishes);
        own.add_unimported_file(FileId(3));
        let types = Types::new(&store, &own);
        let this_of = |file| {
            let id = crate::bind::SymbolId(7);
            types.intern(TypeData::ThisParam(Sym { file, id }))
        };
        let (bound, free) = (this_of(FileId(3)), this_of(FileId(2)));
        assert!(bound.is_local() && !free.is_local());
        assert!(types.intern(TypeData::Keyof(bound)).is_local());
        assert!(!types.intern(TypeData::Keyof(free)).is_local());
        let pairs = |to| vec![(free, to)];
        assert!(types.mapper(pairs(bound)).is_local());
        assert!(!types.mapper(pairs(TypeId::STRING)).is_local());
        // Two types and a mapper of its own, two types and a mapper that are published.
        assert_eq!(own.lengths(), [0, 0, 1, 0, 2]);
        assert_eq!(own.created(), [0, 0, 2, 0, 4]);
    }

    #[test]
    fn a_task_that_only_finds_keeps_what_it_creates() {
        let session = Session::new();
        let store = sharing_store(&session, Interner::new_in(&session));
        let publishing = own_store(&session, Sharing::Publishes);
        let published = Types::new(&store, &publishing).intern(TypeData::Keyof(TypeId::STRING));
        let own = own_store(&session, Sharing::Finds);
        let types = Types::new(&store, &own);
        assert_eq!(types.intern(TypeData::Keyof(TypeId::STRING)), published);
        assert!(types.intern(TypeData::Keyof(TypeId::NUMBER)).is_local());
    }

    #[test]
    fn the_ids_that_a_task_gives_back_are_used_by_the_next() {
        let session = Session::new();
        let store = sharing_store(&session, Interner::new_in(&session));
        let create = |of: TypeId| {
            let own = own_store(&session, Sharing::Publishes);
            let created = Types::new(&store, &own).intern(TypeData::Keyof(of));
            store.take_back_ids(&own);
            created
        };
        let first = create(TypeId::STRING);
        assert_eq!(create(TypeId::NUMBER).0, first.0 + 1);
        assert_eq!(create(TypeId::STRING), first);
        assert_eq!(create(TypeId::BIGINT).0, first.0 + 2);
    }

    #[test]
    fn a_string_literal_type_and_its_atom_are_published_at_once() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let store = sharing_store(&session, atoms);
        let create = || {
            let own = own_store(&session, Sharing::Publishes);
            let value = crate::atom::Atoms::new(&atoms, &own).intern(b"not in any file");
            assert!(!value.is_own());
            let fresh = false;
            Types::new(&store, &own).intern(TypeData::StringLit { value, fresh })
        };
        let first = create();
        assert!(!first.is_local());
        assert_eq!(create(), first);
    }
}
