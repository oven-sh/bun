//! Hash-consed types, signatures and type mappers. Equal ones have equal ids.
//!
//! An object type records its origin (a declaration, a syntax node, and the mapper for the
//! enclosing type parameters), not its members. The checker resolves the members on demand, once.

use crate::atom::{Atom, Interner};
use crate::hir::{ExprId, FnId, ParamId, TypeNodeId, TypeParamId};
use crate::local::{HashIndex, LOCAL, MaybeLocal};
use crate::program::{FileId, Sym};
use crate::session::{Arena, ArenaVec, Session};
use crate::table::{ById, Frozen};
use crate::util::memory::{OWN, Placeholder, Placeholders, Segmented};
use crate::util::{
    FxHashMap, FxHasher, LocalVec, SharedSort, Window, Windowed, WindowedSlots, spread_in_window,
    spread_of,
};
use bun_alloc::{ArenaBox, vec_from_iter_in};
use bun_threading::Guarded;
use smallvec::SmallVec;
use std::cell::{Cell, RefCell};
use std::hash::{Hash, Hasher};
use std::hint::cold_path;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU16, AtomicU32, AtomicU64, Ordering};

/// A list that's stored once, as one exactly sized block in the arena of the thread that built it.
/// It's as wide as `Box<[T]>`. Dropping it frees the block, on any thread.
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

/// A fixed-size list like `List`, with up to `N` items stored inline. Inline items don't need an
/// allocation and share a cache line with the record that owns the list. Equality, hashing and
/// visiting all use the slice it dereferences to.
pub enum ShortList<T, const N: usize, L> {
    /// Item count, then the items. Unused slots are padding.
    Inline(u8, [T; N]),
    Spilled(L),
}

/// Filler value for the unused slots of a `ShortList`. It's never read.
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

/// Out-of-line storage for a `ShortList` with more than `N` items.
pub trait ListBlock<'s, T>: std::ops::DerefMut<Target = [T]> {
    /// Copies `items` into `arena`, which must belong to the calling thread.
    fn block_in(items: &[T], arena: &'s Arena) -> Self;
}

impl<'s, T: Copy> ListBlock<'s, T> for List<'s, T> {
    #[inline]
    fn block_in(items: &[T], arena: &'s Arena) -> Self {
        List::copy_from_slice_in(items, arena)
    }
}

/// A list behind a thin pointer, half as wide as a `List`. The allocation it points to is half a
/// cache line and stores up to seven ids inline, so reading them costs one dereference, the same as
/// a `List`. A longer list costs two.
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

    /// Copies `items` into `arena`, which must belong to the calling thread.
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
            ShortList::Spilled(items) => {
                cold_path();
                items
            }
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

/// Inline capacities for the constituents of a union or intersection, the type arguments of a
/// reference or elements of a tuple, and the declarations of a function value. They're as large as
/// possible while a `TypeRecord` still occupies one cache line.
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
    /// again without reporting anything.
    SilentNever,
    /// `unreachableNeverType`: the control flow type of a reference after an unreachable
    /// assignment, or after a call that never returns. It has `TypeFlagsNever`.
    /// `getFlowTypeOfReference` converts it to the declared type.
    UnreachableNever,
    /// `implicitNeverType`: the element type of `[]` under `strictNullChecks`. It has
    /// `TypeFlagsNever`. `isEmptyLiteralType` recognizes it.
    ImplicitNever,
    /// `uniqueLiteralType`: the type `uniqueLiteralMapper` substitutes for a type parameter. It has
    /// `TypeFlagsNever`, and `createUnionOrIntersectionProperty` doesn't count it as a `never`.
    UniqueLiteral,
    Void,
    /// `undefinedType`
    Undefined,
    /// The `undefined` of a missing property or element. `missingType`
    Missing,
    /// `undefinedWideningType` without strictNullChecks: the type of the expression `undefined`,
    /// which `getWidenedType` turns into `any`. Under strictNullChecks it's `undefinedType`
    /// (`createWideningType`), and this one isn't used.
    UndefinedWidening,
    /// `nullType`
    Null,
    /// `nullWideningType`, which works the same way.
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
    /// `nonInferrableAnyType`: the type of a binding pattern's name when it's referenced within the
    /// pattern while the pattern's implied type is being computed. It has `TypeFlagsAny` and
    /// `ObjectFlagsContainsWideningType`, even under strictNullChecks.
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
/// element. The file and the position distinguish it from another one with the same name.
/// `getTupleKey` writes the node, so `[x: T]` written twice has two targets.
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

    /// Returns `name` in `[name: T]`, or `NONE` if the element has no label.
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

    /// Returns the same flags with `label` as the label.
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

/// `checkObjectLiteral` creates a type on every call. This identifies the call that created an object literal's type.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ObjectLiteralCheck {
    /// `checkExpression`, for the parent of the literal.
    ForParent,
    /// `checkExpressionForMutableLocation`, for `getAssignmentDeclarationInitializerType`.
    ForAssignmentDeclaration,
    /// `checkExpressionCached`, for `getContextualThisParameterType`, where the parent has left no `links.resolvedType`.
    ForThis,
    /// The same for the `this` parameter of this member, or for a type query of `this` in its signature. Both are
    /// resolved while the literal is being checked.
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
    /// 2. `isConstContext(node)` when the type was created. If true, its properties are `readonly`. The members are a
    ///    function of the type, so resolving them doesn't request a contextual type.
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
    /// The type of the symbol `cloneTypeAsModuleType` creates for an `import * as ns` that doesn't
    /// resolve to the module itself (`resolveESModuleSymbol`): the properties and index signatures
    /// of `module` (a module, or its `export =` target), no call or construct signatures, and, if
    /// `with_default`, a `default` that overrides theirs and is `module` itself.
    /// With `is_default_only` it has only that `default` (`getTypeWithSyntheticDefaultOnly`).
    /// `originating_import` is the alias `ns`. Each such import creates its own symbol, and so its
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
    /// A `readonly` property of a class, an interface or a type literal. It has no `Sym`, so this is
    /// `symbol.Declarations[0]`.
    Member(FileId, crate::hir::MemberId),
    /// A property of the global `SymbolConstructor`, identified only by its name.
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
    /// Copies `actual` into `arena`, which must belong to the calling thread.
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

    /// Returns `None` if they're deferred.
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
    /// `createTupleTargetType`: `typeParameters` and `thisType`. All targets share them, because only
    /// a mapper ever observes them.
    TupleElement(u32),
    TupleThis,
}

#[derive(PartialEq, Eq, Hash, Debug)]
pub enum TypeData<'s> {
    Intrinsic(Intrinsic),
    /// The type of a type reference whose name doesn't resolve
    /// (`getUnresolvedSymbolForEntityName`, `getTypeFromTypeAliasReference`): an intrinsic type
    /// with `TypeFlagsAny` and an alias. `isErrorType` is true for it, but it isn't `errorType`, and
    /// it's printed as written in the source. `name` is the whole entity name, `A.B.C`.
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
    /// Sorted by `CompareTypes`.
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
        /// `newMapper`, which has the union. `IDENTITY` means its mapper isn't a merged one.
        distributed_over: MapperId,
        /// `forConstraint` of `getConditionalTypeKey`. `getConditionalType` creates a new type
        /// whenever it defers, and `getConditionalTypeInstantiation` caches the result under the
        /// type arguments that it was itself given: those of a union that is distributed over,
        /// those a tail call started with. This field holds those type arguments for a type created
        /// for a constraint, so that two types are identical exactly where they are in tsgo.
        /// `IDENTITY` means it wasn't created for a constraint.
        for_constraint: MapperId,
    },
    IndexedAccess {
        obj: TypeId,
        index: TypeId,
        /// Read in an expression under noUncheckedIndexedAccess, so a value from an index signature
        /// may be missing.
        /// `AccessFlagsIncludeUndefined`, the only access flag that's stored
        /// (`AccessFlagsPersistent`).
        undefined: bool,
    },
    Keyof(TypeId),
    /// `SubstitutionType`: `base`, which is known to satisfy `constraint`. With the constraint
    /// `unknown` it's `NoInfer<base>`.
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
        /// For a property of a widened object literal. The object literal types in its type are
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
        const DECLARED_IN_LITERAL = 1024;
        /// For a property of an object literal type that's no longer fresh. If the property's type is
        /// an object literal type, that type isn't fresh either (`getRegularTypeOfObjectLiteral`,
        /// `transformTypeOfMembers`).
        const REGULAR = 2048;
        /// `OPTIONAL`, but `undefined` isn't added to the symbol's type. The `?` is on a declaration
        /// after `symbol.ValueDeclaration`, which is the one `isOptionalDeclaration` checks, or on a
        /// parameter property, whose type already includes it.
        const WITHOUT_OPTIONALITY = 4096;
        /// `CheckFlags` of the property `createUnionOrIntersectionProperty` creates for a union.
        const READ_PARTIAL = 1 << 13;
        const WRITE_PARTIAL = 1 << 14;
        const HAS_NON_UNIFORM_TYPE = 1 << 15;
        const HAS_LITERAL_TYPE = 1 << 16;
        const ABSTRACT = 1 << 17;
        /// Set on a member that a class or an interface inherited, if `instantiateSymbol` returned the
        /// member itself (`m.MapsThisOnly() && isThisless(symbol)`). It then does so for every heir.
        const THISLESS = 1 << 18;
        /// A property without any of these is accessible everywhere except through `super`
        /// (`checkPropertyAccessibilityAtLocation`). For accessors it depends on which accessor is
        /// used, so they're always inspected.
        const MAY_BE_OUT_OF_REACH = Self::PRIVATE.bits() | Self::PROTECTED.bits() | Self::ABSTRACT.bits() | Self::ACCESSOR.bits();
    }
}

/// Where a property's type comes from.
#[derive(PartialEq, Eq, Hash, Debug)]
pub enum PropSource<'s> {
    /// Synthesized, with no declaration.
    Type(TypeId),
    /// A property of an object literal.
    Literal(FileId, crate::hir::PropId),
    /// A member of a class, an interface or a type literal, a parameter property, an export of a
    /// module or a namespace, a member of an enum, or a property declared by `f.name = value`,
    /// `this.name = value` or `Object.defineProperty(f, "name", descriptor)`. A late bound symbol
    /// is identified by the symbol the binder created for its first declaration.
    Symbol(Sym),
    /// A property of the given intersection or union. It combines the properties of that name from
    /// several of its constituents.
    Intersected(TypeId, List<'s, Prop<'s>>),
    /// A property of the given mapped type (`containingType`). Its type is that type's template
    /// instantiated with `Prop::mapper`, which is the mapped type's mapper plus its type parameter
    /// mapped to `keyType`. `type_of_mapped_prop` resolves it on demand (`getTypeOfMappedSymbol`).
    /// `resolveMappedTypeMembers` may instead store only the mapped type's mapper in `Prop::mapper`
    /// and put `keyType` in `Prop::name_type` (see `Types::separate_key`). `Checker::mapper_of_prop`
    /// combines them.
    /// The flag is `CheckFlagsStripOptional`: `-?` removes `undefined` from the type.
    /// The last field holds the symbols whose `Declarations` it has, those of `modifiersProp`
    /// (`addMemberForKeyTypeWorker`), following the same rule as `Copy`, or `None` if it has none.
    Mapped(TypeId, bool, Option<List<'s, Prop<'s>>>),
    /// A symbol derived from others (`createSymbolWithType`, `getSpreadSymbol`, `getSpreadType`):
    /// its own type, and the symbols whose `Declarations` it has, concatenated in order. None of
    /// those is synthesized, a copy or `Intersected`. The flag means it also has the first one's
    /// `ValueDeclaration` and `Parent`. `Checker::copy_of` creates it.
    Copy(TypeId, List<'s, Prop<'s>>, bool),
    /// A property of the given reverse mapped type (`CheckFlagsReverseMapped`).
    /// `type_of_reverse_mapped_prop` infers its type on demand (`getTypeOfReverseMappedSymbol`).
    /// The second field holds the symbols whose `Declarations` it has, those of the source's
    /// property, following the same rule as `Copy`. It has no `ValueDeclaration`.
    ReverseMapped(TypeId, List<'s, Prop<'s>>),
}

#[derive(PartialEq, Eq, Hash, Debug)]
pub struct Prop<'s> {
    pub name: Atom,
    pub flags: PropFlags,
    pub source: PropSource<'s>,
    /// The mapper to instantiate the type from `source` with.
    pub mapper: MapperId,
    /// `links.nameType` of a symbol made from another one (`getSpreadSymbol`, `getSpreadType`,
    /// `createSymbolWithType`), if it's an enum member. `source` no longer leads to it, and the name
    /// is only its spelling. `TypeId::UNRESOLVED` means `name`, `STRING_NAME` and `source` determine
    /// it. For a mapped type's property this can be `keyType` instead. See `Types::separate_key`.
    pub name_type: TypeId,
}

const _: () = assert!(size_of::<Prop<'static>>() <= 40);

impl<'s> Prop<'s> {
    /// Returns the last field of `PropSource::Mapped`.
    pub fn declared_by_modifiers_property(&self) -> &[Prop<'s>] {
        match &self.source {
            PropSource::Mapped(_, _, Some(declared)) => declared,
            _ => &[],
        }
    }

    /// Hashes the property without the items of the lists in `source`. Equal properties still have equal hashes, and
    /// hashing a property of a hundred-member union costs the same as hashing any other.
    pub fn hash_without_lists<H: Hasher>(&self, hasher: &mut H) {
        (self.name, self.flags, self.mapper, self.name_type).hash(hasher);
        std::mem::discriminant(&self.source).hash(hasher);
        match &self.source {
            PropSource::Type(ty) => ty.hash(hasher),
            PropSource::Literal(file, property_id) => (file, property_id).hash(hasher),
            PropSource::Symbol(symbol) => symbol.hash(hasher),
            PropSource::Intersected(containing_type, parts) => {
                (containing_type, parts.len()).hash(hasher)
            }
            PropSource::Mapped(containing_type, strips_optional, _) => {
                (containing_type, strips_optional).hash(hasher)
            }
            PropSource::Copy(ty, declared, _) => (ty, declared.len()).hash(hasher),
            PropSource::ReverseMapped(containing_type, _) => containing_type.hash(hasher),
        }
    }

    /// Returns the `FxHasher` hash from `hash_without_lists`.
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
    /// True for `enumNumberIndexInfo`, the reverse mapping from a number to an enum member's name.
    /// `keyof` and inference skip it, even in a type that got it from an enum object
    /// (`getRestType`).
    pub is_enum_number_index_info: bool,
    /// The index signature that declares it (`getIndexInfosOfIndexSymbol`).
    pub declaration: Option<(FileId, crate::hir::MemberId)>,
    /// The declarations with computed names that it's built from (`getObjectLiteralIndexInfo`). See
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
    /// the file and the position, which `CompareTypes` sorts by, and the object literal, if it is
    /// one.
    pub symbol_declared_at: Option<(FileId, u32, ExprId)>,
    /// `t.symbol` of a type that `getRestType` creates for a destructuring assignment. It's the
    /// destructured type's symbol.
    pub symbol: Option<Sym>,
    /// In declaration order, own before inherited.
    pub props: ArenaVec<'s, Prop<'s>>,
    pub call: ArenaVec<'s, SigId>,
    pub construct: ArenaVec<'s, SigId>,
    pub index: ArenaVec<'s, IndexInfo>,
    pub literal: Literalness,
    /// For a type that `literal` marks as the type of an expression. True if
    /// `ObjectFlagsFreshLiteral` has been removed (`getRegularTypeOfObjectLiteral`).
    pub is_regular: bool,
    /// `ObjectFlagsContainsWideningType` for a type `checkObjectLiteral` creates by value. True if a
    /// member in the source has it, even one that a later spread overrides.
    pub contains_widening_type: bool,
    /// `ObjectFlagsJSLiteral`
    pub is_js_literal: bool,
    /// `ObjectFlagsObjectRestType`
    pub is_object_rest_type: bool,
    /// For a type created by `getInstantiationExpressionType`.
    pub instantiation_expression: Option<InstantiationExpression>,
    /// `t.target` of an instantiation of such a type. `getObjectTypeInstantiation` instantiates the
    /// members of the type as created.
    pub instantiation_target: Option<TypeId>,
    /// For a type created by `createDefaultPropertyWrapperForModule`: `originalSymbol`, the module,
    /// which is the `Parent` of its `default`.
    pub default_of: Option<Sym>,
    /// For a type created by `getSpreadType` or `getRestType`, which create a new type on every
    /// call: the spread's left and right operands, or the destructured type and `never`.
    pub created_from: Option<(TypeId, TypeId)>,
    /// The number of types `getSpreadType` had created for the same object literal before this
    /// one. `mapType` iterates over a union of named unions by its origin, which isn't the order
    /// of `CompareTypes`.
    pub spread_rank: u32,
    /// The intersection whose properties this has. It has nothing else of the intersection. The
    /// signatures and index signatures are elsewhere (see `structured_members`).
    pub properties_of: Option<TypeId>,
    /// For a type created by `getSignatureInstantiation` with `inferredTypeParameters`
    /// (`ObjectFlagsSingleSignatureType`), which creates a new type on every call: the outer type
    /// parameters of the signature's declaration instantiated with `t.mapper`, as a tuple.
    pub single_signature_arguments: Option<TypeId>,
    /// `t.symbol` is nil (`getTypeFromObjectBindingPattern`), or isn't a function, a method, a
    /// class, a type literal or an object literal (`getOrCreateTypeFromSignature` for a call
    /// signature). `couldContainTypeVariables` is false no matter what the members mention, so the
    /// type is never instantiated, and nothing is inferred to it. It has no implicit index signature
    /// (`isObjectTypeWithInferableIndex`).
    pub has_no_instantiable_symbol: bool,
    /// For a type created by `getTypeFromObjectBindingPattern`, which creates a new type on every
    /// call, and for the `getWidenedTypeOfObjectLiteral` of such a type: the pattern's file and
    /// position.
    pub pattern_at: Option<(FileId, u32)>,
    /// `t.mapper` of a type that `getObjectTypeInstantiation` instantiates no matter what its members
    /// mention, because it has the symbol of an object literal (`getSpreadType`,
    /// `getWidenedTypeOfObjectLiteral`), `ObjectFlagsObjectRestType` or
    /// `ObjectFlagsInstantiationExpressionType`. It maps the declaration's
    /// `links.outerTypeParameters`, to themselves in the type as created, and each list of type
    /// arguments is a distinct type. `IDENTITY` means there are none.
    pub mapper: MapperId,
}

/// The resolved members of an object type. The other `Shape` fields only distinguish one synthesized type from another,
/// and are read from the type itself.
#[derive(Debug)]
#[repr(C)]
pub struct Listed<'s> {
    /// This field and the next five are documented on `Shape`.
    pub props: List<'s, Prop<'s>>,
    pub call: List<'s, SigId>,
    pub construct: List<'s, SigId>,
    pub index: List<'s, IndexInfo>,
    /// `TypeId::UNRESOLVED` means none.
    properties_of: TypeId,
    pub literal: Literalness,
    /// True if `Shape::symbol_declared_at` was `Some`.
    pub has_symbol_declared_at: bool,
    /// True if the `Shape` was plain (`Shape::is_plain`).
    is_plain: bool,
}

impl<'s> From<Shape<'s>> for Listed<'s> {
    fn from(shape: Shape<'s>) -> Listed<'s> {
        Listed {
            is_plain: shape.is_plain(),
            props: shape.props.into(),
            call: shape.call.into(),
            construct: shape.construct.into(),
            index: shape.index.into(),
            properties_of: shape.properties_of.unwrap_or(TypeId::UNRESOLVED),
            literal: shape.literal,
            has_symbol_declared_at: shape.symbol_declared_at.is_some(),
        }
    }
}

impl<'s> Listed<'s> {
    #[inline]
    pub fn properties_of(&self) -> Option<TypeId> {
        (self.properties_of != TypeId::UNRESOLVED).then_some(self.properties_of)
    }

    pub fn prop(&self, name: Atom) -> Option<&Prop<'s>> {
        self.props.iter().find(|p| p.name == name)
    }

    /// True if this was built from a `Shape` equal to `shape`. `shape` must be plain (`Shape::is_plain`).
    pub fn was_built_from(&self, shape: &Shape<'s>) -> bool {
        debug_assert!(shape.is_plain());
        self.is_plain
            && self.props[..] == shape.props[..]
            && self.call[..] == shape.call[..]
            && self.construct[..] == shape.construct[..]
            && self.index[..] == shape.index[..]
    }
}

/// Records whether a synthesized object type is still the type of an object literal expression, or
/// which other distinguishing kind it was created as.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum Literalness {
    #[default]
    No,
    Literal,
    /// An object literal with a spread, so its other properties aren't known.
    WithSpread,
    /// The properties in the source between two spreads, before they are merged into a
    /// `WithSpread`.
    Written,
    /// The attributes of a JSX element. Names that contain a hyphen are ignored.
    JsxAttributes,
    /// An object literal checked without its context-sensitive functions
    /// (`ObjectFlagsNonInferrableType`). With no members and no symbol, it's such a function
    /// (`anyFunctionType`). With one call signature and nothing else, it's such a function without
    /// context-sensitive parameters, retained for its return type (`returnOnlyType`).
    Partial,
    /// The type implied by a binding pattern, used as the contextual type of its initializer
    /// (`patternForType`). No expression has it.
    Pattern,
    /// The same with computed names that are only known at run time, so its other properties aren't
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
    /// `unknownEmptyObjectType`: the `{}` that `unknown` narrows to when it's neither `null` nor
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
    /// True if it's the type of an object literal expression itself, not a type derived from one.
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
    /// Returns a shape with no members. `arena` must belong to the calling thread, which is the only
    /// one that may add members.
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

    /// True if every field except the four lists still has its `new_in` value. The destructuring lists every field, so
    /// adding a field without updating this function is a compile error.
    fn is_plain(&self) -> bool {
        let Shape {
            symbol_declared_at,
            symbol,
            props: _,
            call: _,
            construct: _,
            index: _,
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
            mapper,
        } = self;
        let flags = [
            is_regular,
            contains_widening_type,
            is_js_literal,
            is_object_rest_type,
            has_no_instantiable_symbol,
        ];
        symbol_declared_at.is_none()
            && symbol.is_none()
            && *literal == Literalness::No
            && flags.iter().all(|&&flag| !flag)
            && instantiation_expression.is_none()
            && instantiation_target.is_none()
            && default_of.is_none()
            && created_from.is_none()
            && *spread_rank == 0
            && properties_of.is_none()
            && single_signature_arguments.is_none()
            && pattern_at.is_none()
            && *mapper == MapperId::IDENTITY
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SigParam {
    pub name: Atom,
    pub ty: TypeId,
    pub optional: bool,
    pub rest: bool,
    /// For a rest parameter. True if `Signature.minArgumentCount` is beyond its position, so it takes
    /// at least one argument. `combineUnionOrIntersectionMemberSignatures` stores the greater of two
    /// minimum argument counts, and the parameter at that position may be the rest parameter of
    /// the other signature: `((...a: number[]) => void) | ((a: string) => void)`.
    pub is_required_rest: bool,
    /// `symbol.ValueDeclaration`, or `None` for a parameter that the checker synthesizes
    /// (`combineUnionOrIntersectionParameters`, `newParameter`), which has a name but no declaration.
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
    /// `base` is the construct signature of the base constructor type that
    /// `getDefaultConstructSignatures` cloned, with the `extends` clause's type arguments, or `None`
    /// if the base constructor type has none.
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
    /// Synthesized. `this` is its `this` type. The first entry of `of` is the signature it's a clone
    /// of, whose declaration it shares. With more than one entry, `of` is `Signature.composite`
    /// (`createUnionSignature`, `combineUnionOrIntersectionMemberSignatures`) and `is_union` is
    /// `composite.isUnion`. Then `ret` is `TypeId::UNRESOLVED`, and `sig_return` resolves it from
    /// their return types.
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

/// `TypeFlags`, with the same values as in types.go, because `CompareTypes` orders types of different kinds by them.
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
        /// It references a type parameter, so instantiation may change it. Exact, except for
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
        /// `NON_INFERRABLE_TYPE`. `instantiateAnonymousType` gives it the flag if that's a type
        /// argument of its alias. If the alias is the type node's, only the checker knows it, so
        /// `Checker::is_non_inferrable` checks. It propagates like `NON_INFERRABLE_TYPE`.
        const NON_INFERRABLE_BY_ALIAS = 512;
        /// `ObjectFlagsPropagatingFlags`
        const PROPAGATING_FLAGS = 8 | 16 | 32 | 512;
        /// Is or contains a reverse mapped type. `couldContainTypeVariables` is true for every one,
        /// and `instantiateReverseMappedType` instantiates the mapped type it was inferred through,
        /// which references the inferred type parameter. The result is the same type or an
        /// equivalent copy, so `COULD_CONTAIN_TYPE_VARIABLES` isn't set for it. But under
        /// `InferenceContext.mapper`, mapping that type parameter fixes it, so `fixing_mapper` checks
        /// this flag.
        const HAS_REVERSE_MAPPED = 64;
        /// Is or contains a mapped type with `Provenance::stored_under` for which
        /// `couldContainTypeVariables` holds. Instantiation changes it even though it references no
        /// type parameter, because `getObjectTypeInstantiation` looks it up under its own key, which
        /// has another type. The same goes for a conditional type that stores an alias, because
        /// `getConditionalTypeInstantiation` looks it up under the key without one, and for a union
        /// with `Provenance::has_other_instantiation`.
        const HAS_OTHER_INSTANTIATION = 256;
        /// An intersection of object types that are each their own apparent type. That covers every object type except
        /// a mapped type with type variables, which `getResolvedApparentTypeOfMappedType` may replace. They don't all
        /// have the same apparent type (`can_become_one_reference`).
        const HAS_ONLY_OWN_APPARENT_TYPES = 1024;
    }
}

/// Distinguishes two types with the same constituents. It's part of a type's interning key, as in
/// `getUnionKey` and `getAliasKey`. `data` doesn't include it, so a named union is a
/// `TypeData::Union` of its members like any other.
#[derive(PartialEq, Eq, Hash, Debug, Default)]
pub struct Provenance<'s> {
    /// `Type.alias`
    pub alias: Option<(Sym, List<'s, TypeId>)>,
    /// `UnionType.origin`
    pub origin: UnionOrigin<'s>,
    /// True if `alias` is the enum whose declared type this is (`enumType.flags |= TypeFlagsEnumLiteral`).
    pub is_enum: bool,
    /// For a mapped type that `instantiateConstituent` created: the key under which
    /// `getObjectTypeInstantiation` stores the result of that `instantiateMappedType`. `None` means
    /// it's the type's own key: its type arguments and its alias. Also for a result that's a union
    /// of such types and couldn't contain type variables, and for a mapped type that's no longer
    /// under its key (`InstantiationKey::nesting`).
    pub stored_under: Option<InstantiationKey>,
    /// `ObjectFlagsArrayLiteral`: the clone of a type reference that `createArrayLiteralType`
    /// creates (`cloneTypeReference`), once per reference.
    pub is_array_literal: bool,
    /// `patternForType[t] != nil` for the clone of a tuple type that
    /// `getTypeFromArrayBindingPattern` creates with `includePatternInType`.
    pub is_array_pattern: bool,
    /// `couldContainTypeVariables`, for a union that `getUnionTypeWorker` creates with an alias and
    /// an `origin` of one type, a named union that has every member. `instantiateTypeWorker` doesn't
    /// return it unchanged, because it doesn't compare any alias with `alias`, and `getUnionTypeEx`
    /// of the one type is that type. Also for a union or an intersection with a constituent that has
    /// `ObjectFlags::HAS_OTHER_INSTANTIATION`, if `alias` has no type arguments and isn't declared at
    /// the top level of a file (`isNonGenericTopLevelType`).
    pub has_other_instantiation: bool,
}

/// `getTypeInstantiationKey`, for `ObjectType.instantiations` of a mapped type.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct InstantiationKey {
    /// `typeArguments`, as `newMapper`.
    pub type_arguments: MapperId,
    /// `newAlias`, with its type arguments as a tuple. `None` means it's
    /// `instantiateTypeAlias(target.alias, newMapper)`.
    pub alias: Option<(Sym, TypeId)>,
    /// `ObjectFlagsCouldContainTypeVariables` of the stored type.
    pub could_contain_type_variables: bool,
    /// Number of `getObjectTypeInstantiation` calls with this key that were further up the stack
    /// from the one that created the type. None of them found an entry, and each assigns
    /// `instantiations[key]` when it returns, so the type that stays under the key is the one with 0.
    pub nesting: u8,
}

#[derive(PartialEq, Eq, Hash, Debug, Default)]
pub enum UnionOrigin<'s> {
    #[default]
    None,
    /// The named unions it was built from, and its remaining members, sorted by `CompareTypes`.
    Union(List<'s, TypeId>),
    /// The intersection it is the normal form of.
    Intersection(List<'s, TypeId>),
    /// The `keyof T` it is the keys of.
    Keyof(TypeId),
}

/// The interning key of a type.
type OwnedTypeKey<'s> = (TypeData<'s>, Option<ArenaBox<'s, Provenance<'s>>>);

/// `TypeData` with its lists borrowed, for `Types::intern_key`. Most requested types already exist,
/// and the lists are copied to the arena only if the type is new.
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
    /// Hashes what `#[derive(Hash)]` hashes for the `TypeData`: the discriminant, then the fields.
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
                    target: data_target,
                    args: TypeArguments::Given(list),
                },
            ) => target == *data_target && *args == **list,
            (
                TypeKey::Tuple {
                    elems,
                    flags,
                    readonly,
                },
                TypeData::Tuple {
                    elems: TypeArguments::Given(list),
                    flags: data_flags,
                    readonly: data_readonly,
                },
            ) => readonly == *data_readonly && *elems == **list && *flags == **data_flags,
            (
                TypeKey::Fns { decls, mapper },
                TypeData::Fns {
                    decls: list,
                    mapper: data_mapper,
                },
            ) => mapper == *data_mapper && *decls == **list,
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

    /// Same result as `Follow::is_bound` on the `TypeData` for this key.
    fn is_bound(self, own: &OwnStore) -> bool {
        match self {
            TypeKey::Data(data) => data.is_bound(own),
            TypeKey::Union(types) | TypeKey::Intersection(types) => types.is_bound(own),
            TypeKey::Tuple { elems, flags, .. } => elems.is_bound(own) || flags.is_bound(own),
            TypeKey::Ref { target, args } => target.is_bound(own) || args.is_bound(own),
            TypeKey::Fns { decls, mapper } => {
                decls.iter().any(|decl| decl.0.is_bound(own)) || mapper.is_bound(own)
            }
        }
    }

    /// Same result as `Follow::mentions_own` on the `TypeData` for this key. Tuple `flags` are
    /// skipped because an element's label is always a declared name, never a task-local atom.
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

/// `UnionOrigin` with its list borrowed. The variants are in the same order, so it hashes like one.
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

/// `Provenance` with its lists borrowed. The fields are in the same order, so it hashes like one.
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
            (Some((alias, arguments)), Some((data_alias, list))) => {
                alias == *data_alias && *arguments == **list
            }
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

    /// Same result as `Follow::is_bound` on the `Provenance` for this key.
    fn is_bound(self, own: &OwnStore) -> bool {
        (self.alias)
            .is_some_and(|(alias, arguments)| alias.is_bound(own) || arguments.is_bound(own))
            || match self.origin {
                OriginKey::None => false,
                OriginKey::Union(types) | OriginKey::Intersection(types) => types.is_bound(own),
                OriginKey::Keyof(ty) => ty.is_bound(own),
            }
            || self.stored_under.is_bound(own)
    }

    /// Same result as `Follow::mentions_own` on the `Provenance` for this key.
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

/// Flags that `getUnionTypeEx`, `getIntersectionTypeEx` and `createTypeReferenceEx` set on a type only when they create
/// it, so the first request for the type decides them. A record is created with them already set
/// (`Types::as_first_request`).
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct FirstRequest(u8);

impl FirstRequest {
    pub const NONE: FirstRequest = FirstRequest(0);
    /// `ObjectFlagsFromTypeNode`
    pub const FROM_TYPE_NODE: FirstRequest = FirstRequest(1);
    /// `ObjectFlagsPrimitiveUnion` isn't set even though every member is primitive.
    pub const WITHOUT_PRIMITIVE_UNION: FirstRequest = FirstRequest(1 << 1);
    /// `ObjectFlagsIsConstrainedTypeVariable` is set. With `NO_CONSTRAINED_TYPE_VARIABLE`, the
    /// request decided that it isn't.
    pub const CONSTRAINED_TYPE_VARIABLE: FirstRequest = FirstRequest(1 << 2);
    pub const NO_CONSTRAINED_TYPE_VARIABLE: FirstRequest = FirstRequest(1 << 3);

    #[inline]
    fn has(self, flag: FirstRequest) -> bool {
        self.0 & flag.0 != 0
    }
}

pub struct TypeRecord<'s> {
    created: OwnedTypeKey<'s>,
    /// `Type.flags`. See `tf`.
    flags: u32,
    object_flags: ObjectFlags,
    /// A union or an intersection without type variables whose alias type arguments could contain
    /// some: `type Brand<T> = number & {}`. `instantiateTypeWithAlias` instantiates it, and
    /// `couldContainTypeVariables` is false for it.
    has_type_variables_in_alias_only: bool,
    /// See `Types::mark_from_type_node`.
    is_from_type_node: AtomicBool,
    /// See `Types::set_constrained_type_variable`: 0 until then, 1 for false, 2 for true.
    constrained_type_variable: std::sync::atomic::AtomicU8,
    /// `FirstRequest::WITHOUT_PRIMITIVE_UNION`
    is_without_primitive_union: bool,
    id: TypeId,
}

const _: () = assert!(size_of::<TypeRecord<'static>>() <= 64);

type MapperRecord<'s> = (Mapping<'s>, ObjectFlags);

const _: () = assert!(LOCAL == OWN);

/// Published records of one kind, indexed by id.
type PublishedRecords<'s, T> = Segmented<'s, T, AtomicU32, &'s Session>;

/// One task's records of one kind, indexed by id without the `LOCAL` bit. It's layered over the
/// published records of that kind so that `get_layered` accepts both task-local and published ids.
type TaskRecords<'s, T> = Segmented<'s, T, Cell<u32>, &'s Arena>;

/// A type's position in `Types::content_order`. Computed from the interning key the first time something asks for it,
/// which never happens for most types. It contains no ids, so it's the same in every task, at every thread count and in
/// every run.
#[derive(Copy, Clone)]
struct Rank {
    /// One more than the greatest height of any type the key mentions, directly or through a mapper, a signature, an
    /// alias or an origin. 1 if it mentions none. So a type sorts after every type it's built from.
    height: u32,
    /// The last piece of syntax the key mentions, directly or through the types in it: the file number in the high 32
    /// bits, the number of a node or symbol in that file in the low 32. 0 if it mentions none. tsgo creates a type when
    /// it reaches the syntax that needs it, so of two types, the one that mentions later syntax usually has the
    /// higher id there.
    last_syntax: u64,
    /// A hash of the key with every id replaced by what it refers to: a type by its own `content`, a mapper, a
    /// signature or a component list by its contents, an atom by its text, and a symbol or node by its file and its
    /// number in the file.
    content: u64,
}

impl Rank {
    /// The rank hasn't been computed. A computed rank has a height of at least 1.
    const NONE: Rank = Rank {
        height: 0,
        last_syntax: 0,
        content: 0,
    };
}

/// The facts about a type that are read most often. The record itself is read for its `TypeData`.
#[derive(Copy, Clone)]
struct TypeSummary {
    flags: u32,
    object_flags: ObjectFlags,
    class: InstantiationClass,
    member_flags: u32,
    is_module_object: bool,
}

impl TypeSummary {
    /// Placeholder for an id with no type.
    const NOTHING: TypeSummary = TypeSummary {
        flags: 0,
        object_flags: ObjectFlags::empty(),
        class: InstantiationClass::Unchanged,
        member_flags: 0,
        is_module_object: false,
    };

    /// Returns the initial value of `Summary::facts`.
    #[inline]
    fn facts(&self) -> u8 {
        match self.is_module_object {
            true => fact::IS_MODULE_OBJECT,
            false => 0,
        }
    }
}

/// Bits of `Summary::facts`. A fact's "known" bit and its value are written together, in one store.
mod fact {
    /// Set when the type is created. See `Types::is_module_object`.
    pub(super) const IS_MODULE_OBJECT: u8 = 1 << 7;
    pub(super) const COULD_CONTAIN_TYPE_VARIABLES_COMPUTED: u8 = 1;
    pub(super) const COULD_CONTAIN_TYPE_VARIABLES: u8 = 1 << 1;
    pub(super) const GENERIC_OBJECT_FLAGS_COMPUTED: u8 = 1 << 2;
    pub(super) const IS_GENERIC_OBJECT_TYPE: u8 = 1 << 3;
    pub(super) const IS_GENERIC_INDEX_TYPE: u8 = 1 << 4;
    pub(super) const HAS_GENERIC_ARGUMENTS_COMPUTED: u8 = 1 << 5;
    pub(super) const HAS_GENERIC_ARGUMENTS: u8 = 1 << 6;
}

/// A type's `TypeRecord::summary` and its `Rank`. Two per cache line.
///
/// The fields are atomic because `set` writes to a `Summary` that `TypeStore::reserve_ids` has already added to the
/// shared table. `Relaxed` is enough for the fields `set` writes, because a thread only gets a type's id through
/// something that orders the creator's earlier writes before the read (see `AppendVec`). The rank is written later, by
/// any thread. See `set_rank`.
struct Summary {
    flags: AtomicU32,
    /// See `Types::member_flags`. The top three bits aren't type flags (see `HAS_FRESH_LITERAL`).
    member_flags: AtomicU32,
    /// `ObjectFlags::bits`
    object_flags: AtomicU16,
    /// An `InstantiationClass` as a `u8`.
    class: AtomicU8,
    /// Facts the checker has learned about the type since it was created, plus one bit set at
    /// creation. See `fact` for the bits and `Types::add_facts` for what may be stored here. Facts
    /// learned about a task-local type aren't published with it.
    facts: AtomicU8,
    /// The three `Rank` fields.
    height: AtomicU32,
    last_syntax: AtomicU64,
    content: AtomicU64,
}

const _: () = assert!(size_of::<Summary>() == 32);

impl Summary {
    /// The type has no rank yet.
    #[inline]
    fn new(summary: TypeSummary) -> Summary {
        let rank = Rank::NONE;
        Summary {
            flags: AtomicU32::new(summary.flags),
            member_flags: AtomicU32::new(summary.member_flags),
            object_flags: AtomicU16::new(summary.object_flags.bits()),
            class: AtomicU8::new(summary.class as u8),
            facts: AtomicU8::new(summary.facts()),
            height: AtomicU32::new(rank.height),
            last_syntax: AtomicU64::new(rank.last_syntax),
            content: AtomicU64::new(rank.content),
        }
    }

    /// Must be called before any other thread can get the type's id.
    fn set(&self, summary: TypeSummary) {
        let order = Ordering::Relaxed;
        self.flags.store(summary.flags, order);
        self.member_flags.store(summary.member_flags, order);
        self.object_flags.store(summary.object_flags.bits(), order);
        self.class.store(summary.class as u8, order);
        self.facts.store(summary.facts(), order);
    }

    /// Returns `None` if the rank hasn't been computed.
    #[inline]
    fn rank(&self) -> Option<Rank> {
        match self.height.load(Ordering::Acquire) {
            0 => None,
            height => Some(Rank {
                height,
                last_syntax: self.last_syntax.load(Ordering::Relaxed),
                content: self.content.load(Ordering::Relaxed),
            }),
        }
    }

    /// Any thread may call this at any time, because every thread computes the same rank for a type. The height is
    /// stored last, so a thread that reads it also reads the rest.
    fn set_rank(&self, rank: Rank) {
        self.last_syntax.store(rank.last_syntax, Ordering::Relaxed);
        self.content.store(rank.content, Ordering::Relaxed);
        self.height.store(rank.height, Ordering::Release);
    }
}

/// How `instantiateTypeWithAlias` handles a type.
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
    /// Inverse of `as u8`.
    #[inline(always)]
    fn from_u8(number: u8) -> InstantiationClass {
        match number {
            0 => InstantiationClass::Unchanged,
            1 => InstantiationClass::TypeParameter,
            _ => InstantiationClass::Other,
        }
    }
}

/// One of three extra bits in `Summary::member_flags`, which no type flag uses. See
/// `Types::has_fresh_literal`.
const HAS_FRESH_LITERAL: u32 = 1 << 29;
/// The type itself is an object type other than a mapped type or an evolving array type.
const IS_PLAIN_OBJECT: u32 = 1 << 30;
/// The type itself is a mapped type.
const IS_MAPPED_TYPE: u32 = 1 << 31;

impl TypeRecord<'_> {
    /// `member_flags_of` must return a constituent's `Summary::member_flags`.
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
    /// True if both records have the same interning key.
    fn is_same(&self, other: &Self) -> bool;
    /// Placeholder for an id with no record. It doesn't own any memory.
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
            constrained_type_variable: AtomicU8::new(0),
            is_without_primitive_union: false,
            id: TypeId::UNRESOLVED,
        }
    }
}

/// The published records of one kind. `find` is lock-free and doesn't write.
///
/// `add` is for the constants, before the first task. After `TypeStore::share_records`, tasks add records while other
/// tasks read:
/// - A task reserves a range of ids under a lock (`reserve`), then assigns them to its records one at a time. A single
///   counter shared by all threads would be written on every creation. Ids from different threads would also
///   interleave, so every table keyed by id would have cells from several threads in one cache line.
/// - An id is final as soon as it's assigned, and doesn't reflect when its record was created. So nothing may depend on
///   id order, which is why types are ordered by `Types::content_order`.
/// - `publish_record` keeps at most one record per key at any time, so there's nothing to merge.
struct Interned<'s, V> {
    index: Box<WindowedSlots<&'s Session>, &'s Session>,
    /// Arena-allocated so that a task can borrow them for as long as it may live (see `Segmented::get_layered`). The
    /// slot for an id at or above `first_published_id` contains `Record::hole` until `publish_record` fills it.
    items: &'s PublishedRecords<'s, V>,
    /// First id that `publish_record` may fill. `u32::MAX` until `start_publishing` is called.
    first_published_id: u32,
}

impl<'s, V: Record> Interned<'s, V> {
    fn new_in(session: &'s Session) -> Self {
        let items = PublishedRecords::new_in(session);
        Interned {
            index: Box::new_in(WindowedSlots::new_in(session), session),
            items: session.arena().alloc(items),
            first_published_id: u32::MAX,
        }
    }

    /// Returns the record for `id`, which must be a published id.
    #[inline(always)]
    fn get(&self, id: u32) -> &V {
        self.items.get(id)
    }

    /// `spread` is the hash of the key being looked up.
    #[inline]
    fn find(&self, spread: u64, is_match: impl Fn(&V) -> bool) -> Option<u32> {
        let is_match = |i| is_match(self.get(i));
        match self.first_published_id {
            u32::MAX => self.index.find_frozen(spread, is_match),
            _ => self.index.find(spread, is_match),
        }
    }

    /// After this call, tasks add records with `reserve` and `publish_record`, and nothing else may add to
    /// `items`.
    fn start_publishing(&mut self) {
        self.first_published_id = self.items.len();
    }

    /// Reserves `count` consecutive ids for the caller.
    fn reserve(&self, count: u32) -> Placeholders<'s> {
        self.items.add_placeholders(count, V::hole)
    }

    /// Publishes `record` unless another thread has published an equal one since the caller's lookup. Returns the id of
    /// the published record. Every id in `record` must be published. `id` must come from `reserve` and be used for this
    /// record only. `spread` is the record's lookup hash.
    ///
    /// The index lookup and insert run under the shard's lock, so if two threads race on the same key, one adds its id
    /// and the other thread finds it. The losing thread's record stays in its slot, and nothing refers to it.
    fn publish_record(&self, spread: u64, id: Placeholder<'s>, record: V) -> u32 {
        let (id, stored_record) = (id.index(), self.items.replace(id, record));
        (self.index).find_or_add(
            spread,
            |other| stored_record.is_same(self.get(other)),
            || id,
        )
    }

    /// Assigns the next id to `item`, which must not be present yet. `spread` is its lookup hash.
    fn add(&self, spread: u64, item: V) -> u32 {
        (self.index).find_or_add(spread, |_| false, || self.items.push(item))
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
struct Own<'s, V> {
    /// They never move.
    records: TaskRecords<'s, V>,
    /// Lookup index for the task-local records.
    found: HashIndex,
    /// One bit per record, set if the record is bound. A bound record references a node or a symbol
    /// of a file that nothing imports, or a record that does. It's never published, so the HIR of
    /// such a file can be freed with its task. Empty for atoms.
    bound: LocalVec<Cell<u64>>,
}

impl<'s, V> Own<'s, V> {
    /// `published` contains the published records of the same kind. Pass `None` if `get_layered`
    /// doesn't need to find them. `arena` must be `OwnStore::arena`.
    fn new_in(arena: &'s Arena, published: Option<&'s PublishedRecords<'s, V>>) -> Self {
        let mut records = TaskRecords::new_in(arena);
        if let Some(published) = published {
            records.layer_over(published.elements());
        }
        Own {
            records,
            found: HashIndex::default(),
            bound: LocalVec::new(),
        }
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

    fn clear(&mut self) {
        let Own {
            records,
            found,
            bound,
        } = self;
        records.clear();
        found.clear();
        bound.clear();
    }

    #[cfg(test)]
    fn is_like_new(&self) -> bool {
        let Own {
            records,
            found,
            bound,
        } = self;
        records.len() == 0 && found.is_like_new() && bound.len() == 0
    }
}

/// Controls whether a task publishes the records it creates.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Sharing {
    /// The task finds records that other tasks publish. Records it creates stay task-local.
    Finds,
    /// The task publishes each record as it creates it, unless the record is bound.
    Publishes,
}

/// Where a new record goes.
enum Destination<'s> {
    /// The task's own records.
    Own { is_bound: bool },
    /// The published records, under this id.
    Published(Placeholder<'s>),
}

impl Destination<'_> {
    /// Returns the record's id. `own` is its id if it's task-local.
    #[inline]
    fn id(&self, own: u32) -> u32 {
        match self {
            Destination::Own { .. } => own,
            Destination::Published(id) => id.index(),
        }
    }
}

/// All task-local records: atoms, lists of index components, mappers, signatures, types. A field of
/// `Task`. No other task sees it. A record that the task publishes is created in the shared store
/// instead, and these are dropped with the task.
pub struct OwnStore<'s> {
    /// Arena of the thread that runs the task. Records and their lists are allocated from it, and
    /// the lists may be published.
    arena: &'s Arena,
    atoms: Own<'s, List<'s, u8>>,
    components: Own<'s, List<'s, IndexComponent>>,
    mappers: Own<'s, MapperRecord<'s>>,
    sigs: Own<'s, SigData<'s>>,
    types: Own<'s, TypeRecord<'s>>,
    /// The files that the task has visited and that nothing imports, indexed by `FileId`. No other
    /// task can reference a node or a symbol of such a file. If it's empty, nothing is bound.
    unimported_files: Bits,
    /// See `Types::is_unresolved_name`.
    has_unresolved_names: Cell<bool>,
    /// See `Types::as_first_request`.
    first_request: Cell<FirstRequest>,
    sharing: Sharing,
    /// Ids the task has reserved but not used yet, by pool (`ID_POOLS`). Only used with
    /// `Sharing::Publishes`.
    ids: [Cell<Placeholders<'s>>; ID_POOLS],
    /// Number of ids the task has used for published records, by kind.
    published: [Cell<u32>; 5],
    /// Files the task has visited, indexed by `FileId`.
    visited_files: Bits,
    /// By kind, the records this task published that reference a node or symbol in one of `visited_files`, directly or
    /// through another record. Indexed by id.
    of_visited_files: [RefCell<Bits>; 5],
    summaries: TaskRecords<'s, Summary>,
}

impl<'s> OwnStore<'s> {
    /// `arena` must belong to the thread that runs the task. `published` is the store the task
    /// reads besides its own records, and the only store a `Types` may pair with this one.
    pub fn new_in(arena: &'s Arena, published: &TypeStore<'s>) -> Self {
        let mut summaries = TaskRecords::new_in(arena);
        summaries.layer_over(published.summaries.elements());
        OwnStore {
            arena,
            atoms: Own::new_in(arena, None),
            components: Own::new_in(arena, Some(published.components.items)),
            mappers: Own::new_in(arena, Some(published.mappers.items)),
            sigs: Own::new_in(arena, Some(published.sigs.items)),
            types: Own::new_in(arena, Some(published.types.items)),
            summaries,
            unimported_files: Bits(Vec::new()),
            has_unresolved_names: Cell::new(false),
            first_request: Cell::new(FirstRequest::NONE),
            sharing: Sharing::Finds,
            ids: Default::default(),
            published: Default::default(),
            visited_files: Bits(Vec::new()),
            of_visited_files: std::array::from_fn(|_| RefCell::new(Bits(Vec::new()))),
        }
    }

    /// Must be called before the task creates anything.
    pub fn set_sharing(&mut self, sharing: Sharing) {
        debug_assert!(self.is_empty());
        self.sharing = sharing;
    }

    #[inline]
    pub fn sharing(&self) -> Sharing {
        self.sharing
    }

    /// Counts an atom the task is about to publish, so that `created` includes it.
    #[inline]
    pub(crate) fn count_published_atom(&self) {
        let published = &self.published[Kind::Atom as usize];
        published.set(published.get() + 1);
    }

    /// Resets the store to what `new_in` returned. The record tables keep their addresses and
    /// part of their memory.
    pub fn clear(&mut self) {
        // Destructures every field, so adding a field without handling it here is a compile error.
        let OwnStore {
            arena: _,
            atoms,
            components,
            mappers,
            sigs,
            types,
            unimported_files,
            has_unresolved_names,
            first_request,
            sharing,
            ids,
            published,
            visited_files,
            of_visited_files,
            summaries,
        } = self;
        atoms.clear();
        components.clear();
        mappers.clear();
        sigs.clear();
        types.clear();
        summaries.clear();
        unimported_files.0.clear();
        has_unresolved_names.set(false);
        first_request.set(FirstRequest::NONE);
        *sharing = Sharing::Finds;
        *ids = Default::default();
        *published = Default::default();
        visited_files.0.clear();
        for records in of_visited_files {
            records.get_mut().0.clear();
        }
    }

    /// True if the store is in the state that `new_in` returns.
    #[cfg(test)]
    pub(crate) fn is_like_new(&self) -> bool {
        let OwnStore {
            arena: _,
            atoms,
            components,
            mappers,
            sigs,
            types,
            unimported_files,
            has_unresolved_names,
            first_request,
            sharing,
            ids,
            published,
            visited_files,
            of_visited_files,
            summaries,
        } = self;
        let has_no_ids = |ids: &Cell<Placeholders<'s>>| {
            let taken = ids.take();
            let is_empty = taken.is_empty();
            ids.set(taken);
            is_empty
        };
        atoms.is_like_new()
            && components.is_like_new()
            && mappers.is_like_new()
            && sigs.is_like_new()
            && types.is_like_new()
            && summaries.len() == 0
            && unimported_files.0.is_empty()
            && !has_unresolved_names.get()
            && first_request.get() == FirstRequest::NONE
            && *sharing == Sharing::Finds
            && ids.iter().all(has_no_ids)
            && published.iter().all(|count| count.get() == 0)
            && visited_files.0.is_empty()
            && (of_visited_files.iter()).all(|records| records.borrow().0.is_empty())
    }

    /// Call this before the task visits `file`.
    pub fn add_visited_file(&mut self, file: FileId) {
        self.visited_files.set(file.0 as usize);
    }

    /// Call this before the task visits `file`, which nothing imports. From now on every record that
    /// references `file` is bound.
    pub fn add_unimported_file(&mut self, file: FileId) {
        self.unimported_files.set(file.0 as usize);
    }

    /// True if nothing has been created.
    pub fn is_empty(&self) -> bool {
        self.lengths() == [0; 5]
    }

    /// Returns a task-local atom's text.
    #[inline]
    pub(crate) fn atom_bytes(&self, atom: Atom) -> &[u8] {
        self.atoms.records.get(atom.0 & !LOCAL)
    }

    /// Returns the task-local atom for `text`, if there is one. `spread` is the hash of `text`.
    #[inline]
    pub(crate) fn find_atom(&self, spread: u64, text: &[u8]) -> Option<Atom> {
        let is_match = |id: u32| **self.atoms.records.get(id & !LOCAL) == *text;
        self.atoms.found.find(spread, is_match).map(Atom)
    }

    /// Returns the task-local atom for `text`, creating it if needed. `text` must not be published.
    pub(crate) fn intern_atom(&self, spread: u64, text: &[u8]) -> Atom {
        if let Some(atom) = self.find_atom(spread, text) {
            return atom;
        }
        let text = List::copy_from_slice_in(text, self.arena);
        let index = self.atoms.records.push(text);
        self.atoms.found.add(spread, index | LOCAL);
        Atom(index | LOCAL)
    }
}

/// Accessor for the records of one kind.
type OwnAccessor<'s, V> = for<'a> fn(&'a OwnStore<'s>) -> &'a Own<'s, V>;

/// Looks up `key` among the task-local records and the published ones, or else creates a new
/// record.
/// - `is_match` returns true if a record matches `key`.
/// - `make` builds the record for `key` and returns it with its destination (`Types::destination_of`). Its
///   second argument is the id the record gets if it's task-local, its third what `is_bound` returned.
/// - `is_bound` returns `Follow::is_bound` of the record for `key`.
/// - `mentions_own` returns true if `key` is known to reference a task-local record. No published
///   record does.
///
/// A bound record is never published, and a task with `Sharing::Publishes` keeps only its bound
/// records. So for that task the key determines which of the two indexes can contain the record,
/// and only that index is searched.
#[inline]
fn intern_record<'s, V: Record, K>(
    (published, own): (&Interned<'s, V>, &OwnStore<'s>),
    records_of: OwnAccessor<'s, V>,
    (spread, key): (u64, K),
    is_bound: impl FnOnce(&K) -> bool,
    mentions_own: impl FnOnce(&K) -> bool,
    is_match: impl Fn(&V, &K) -> bool,
    make: impl FnOnce(K, u32, bool) -> (V, Destination<'s>),
) -> u32 {
    let mine = records_of(own);
    let (key_is_bound, keeps_all) = (is_bound(&key), own.sharing != Sharing::Publishes);
    let mut vacancy = None;
    if key_is_bound || keeps_all {
        let is_record = |id: u32| is_match(mine.records.get_layered(id), &key);
        match mine.found.find_or_vacancy(spread, is_record) {
            Ok(id) => return id,
            Err(free) => vacancy = Some(free),
        }
    }
    let find_published = || published.find(spread, |record| is_match(record, &key));
    let known = if key_is_bound || keeps_all && mentions_own(&key) {
        None
    } else {
        find_published()
    };
    if let Some(id) = known {
        return id;
    }
    let index = mine.records.len();
    match make(key, index | LOCAL, key_is_bound) {
        (record, Destination::Own { is_bound }) => {
            debug_assert_eq!(is_bound, key_is_bound);
            mine.push(record, is_bound);
            match vacancy {
                Some(vacancy) => mine.found.fill(vacancy, spread, index | LOCAL),
                None => mine.found.add(spread, index | LOCAL),
            }
            index | LOCAL
        }
        (record, Destination::Published(id)) => {
            debug_assert!(!key_is_bound);

            published.publish_record(spread, id, record)
        }
    }
}

/// A mapper's pairs, sorted (`Survey::is_in_order`). At least three quarters of all mappers have three
/// pairs or fewer.
pub type Mapping<'s> = ShortList<(TypeId, TypeId), 3, List<'s, (TypeId, TypeId)>>;

/// The results of one pass over a mapper's pairs.
struct Survey {
    /// The mapper's lookup hash. Its window is the youngest type's window.
    spread: u64,
    /// True if the type parameters are sorted by id without duplicates. That order makes equal sets of pairs intern as
    /// one mapper and lets `map` search.
    is_in_order: bool,
    /// True if one of the types is task-local.
    mentions_own: bool,
}

#[inline]
fn survey(pairs: &[(TypeId, TypeId)]) -> Survey {
    let mut hasher = FxHasher::default();
    hasher.write_usize(pairs.len());
    let (mut youngest, mut all, mut is_in_order) = (0, 0, true);
    let mut before = None;
    for pair in pairs {
        hasher.write_u64(u64::from(pair.0.0) << 32 | u64::from(pair.1.0));
        youngest = youngest.max(pair.0.0).max(pair.1.0);
        all |= pair.0.0 | pair.1.0;
        is_in_order &= before.is_none_or(|before| before < pair.0.arrival_order());
        before = Some(pair.0.arrival_order());
    }
    Survey {
        spread: spread_of(Window::of_type(youngest), hasher.finish()),
        is_in_order,
        mentions_own: all & LOCAL != 0,
    }
}

/// Returns the window of the youngest of `types`.
#[inline]
fn window_of_youngest(types: &[TypeId]) -> Option<Window> {
    types.iter().map(|it| it.0).max().map(Window::of_type)
}

/// Returns the window of `mapper`. An instantiation is younger than what it instantiates, and so is its mapper. With
/// the identity mapper, nothing is instantiated, and the window is the one `declared` returns.
#[inline]
fn window_of_mapper(mapper: MapperId, declared: impl FnOnce() -> Window) -> Window {
    match mapper == MapperId::IDENTITY {
        true => declared(),
        false => Window::of_mapper(mapper.0),
    }
}

#[inline]
fn window_of_symbol(symbol: Sym) -> Window {
    Window::of_file_index(symbol.file.0, symbol.id.0)
}

#[inline]
fn window_of_reference(target: Sym, args: &[TypeId]) -> Window {
    window_of_youngest(args).unwrap_or_else(|| window_of_symbol(target))
}

#[inline]
fn window_of_functions(decls: &[(FileId, FnId)], mapper: MapperId) -> Window {
    window_of_mapper(mapper, || match decls.first() {
        Some(first) => Window::of_file_index(first.0.0, first.1.0),
        None => Window::of_type(0),
    })
}

impl Windowed for [IndexComponent] {
    #[inline]
    fn window(&self) -> Window {
        Window::of_hash(self)
    }
}

impl Windowed for SigData<'_> {
    #[inline]
    fn window(&self) -> Window {
        match *self {
            SigData::Decl { file, func, mapper }
            | SigData::Construct {
                file, func, mapper, ..
            } => window_of_mapper(mapper, || Window::of_file_index(file.0, func.0)),
            SigData::DefaultConstruct { class, mapper, .. } => {
                window_of_mapper(mapper, || window_of_symbol(class))
            }
            SigData::WithReturn { ret, .. } => Window::of_type(ret.0),
            SigData::Synth { .. } => Window::of_hash(self),
        }
    }
}

impl Windowed for TypeData<'_> {
    #[inline]
    fn window(&self) -> Window {
        let list =
            |types: &[TypeId]| window_of_youngest(types).unwrap_or_else(|| Window::of_type(0));
        match self {
            TypeData::Ref {
                target,
                args: TypeArguments::Given(args),
            } => window_of_reference(*target, args),
            TypeData::ThisParam(symbol) => window_of_symbol(*symbol),
            TypeData::TypeParam(file, param, mapper) => {
                window_of_mapper(*mapper, || Window::of_file_index(file.0, param.0))
            }
            TypeData::Cond {
                file, node, mapper, ..
            } => window_of_mapper(*mapper, || Window::of_file_index(file.0, node.0)),
            TypeData::Anon { mapper, .. } => window_of_mapper(*mapper, || Window::of_hash(self)),
            TypeData::Fns { decls, mapper } => window_of_functions(decls, *mapper),
            TypeData::Union(members) | TypeData::Intersection(members) => list(members),
            TypeData::Tuple {
                elems: TypeArguments::Given(elems),
                ..
            } => list(elems),
            TypeData::IndexedAccess { obj, index, .. } => Window::of_type(obj.0.max(index.0)),
            TypeData::Substitution { base, constraint } => {
                Window::of_type(base.0.max(constraint.0))
            }
            TypeData::ReverseMapped { source, mapped, of } => {
                Window::of_type(source.0.max(mapped.0).max(of.0))
            }
            TypeData::Keyof(operand)
            | TypeData::StringMapping { ty: operand, .. }
            | TypeData::EvolvingArray(operand) => Window::of_type(operand.0),
            TypeData::StringLit { value, .. } => Window::of_atom(value.0),
            _ => Window::of_hash(self),
        }
    }
}

impl Windowed for OwnedTypeKey<'_> {
    #[inline]
    fn window(&self) -> Window {
        self.0.window()
    }
}

/// Returns the same window as the `OwnedTypeKey` with this key.
impl Windowed for (TypeKey<'_>, Option<&ProvenanceKey<'_>>) {
    #[inline]
    fn window(&self) -> Window {
        let list =
            |types: &[TypeId]| window_of_youngest(types).unwrap_or_else(|| Window::of_type(0));
        match self.0 {
            TypeKey::Data(data) => data.window(),
            TypeKey::Union(members) | TypeKey::Intersection(members) => list(members),
            TypeKey::Ref { target, args } => window_of_reference(target, args),
            TypeKey::Tuple { elems, .. } => list(elems),
            TypeKey::Fns { decls, mapper } => window_of_functions(decls, mapper),
        }
    }
}

macro_rules! windowed_by {
    ($($key:ty: |$it:ident| $window:expr;)*) => {$(
        impl Windowed for $key {
            #[inline]
            fn window(&self) -> Window {
                let $it = self;
                $window
            }
        }
    )*};
}
windowed_by! {
    FileId: |it| Window::of_file_index(it.0, 0);
    (FileId, TypeNodeId): |it| Window::of_file_index(it.0.0, it.1.0);
    (FileId, crate::node::Node): |it| Window::of_file_index(it.0.0, 0);
    (FileId, TypeNodeId, MapperId): |it| window_of_mapper(it.2, || Window::of_file_index(it.0.0, it.1.0));
    (TypeId, Atom): |it| Window::of_type(it.0.0);
    (TypeId, TypeId): |it| Window::of_type(it.0.0.max(it.1.0));
    (TypeId, TypeId, TypeId): |it| Window::of_type(it.0.0.max(it.1.0).max(it.2.0));
    (TypeId, MapperId): |it| Window::of_mapper(it.1.0);
    (MapperId, MapperId): |it| Window::of_mapper(it.0.0.max(it.1.0));
}

/// Sorts `pairs` (`Survey::is_in_order`) and removes duplicates, keeping the first pair for each type
/// parameter. Returns the number of pairs kept, which are at the start of `pairs`.
fn put_in_order(pairs: &mut [(TypeId, TypeId)]) -> usize {
    // The sort must be stable, so that which of two pairs for the same parameter is kept doesn't
    // depend on the other ids.
    pairs.sort_by_key(|pair| pair.0.arrival_order());
    let mut kept = 0;
    for at in 0..pairs.len() {
        if kept == 0 || pairs[kept - 1].0 != pairs[at].0 {
            pairs[kept] = pairs[at];
            kept += 1;
        }
    }
    kept
}

/// The shared store: the published types, signatures, type mappers and lists of index components.
/// A lookup is lock-free and doesn't write. Tasks add records at any time (see `Interned`). The records that a task
/// doesn't publish are in its `OwnStore`.
///
/// - A record consists of its interning key and flags computed from the key, so it doesn't depend
///   on which task created it.
/// - Anything that changes a type's behavior is in its interning key, or is computed from the key.
pub struct TypeStore<'s> {
    session: &'s Session,
    types: Interned<'s, TypeRecord<'s>>,
    /// Arena-allocated, like `Interned::items`.
    summaries: &'s PublishedRecords<'s, Summary>,
    sigs: Interned<'s, SigData<'s>>,
    mappers: Interned<'s, MapperRecord<'s>>,
    components: Interned<'s, List<'s, IndexComponent>>,
    /// The string literal types, regular and fresh, indexed by their value. There is one for nearly
    /// every string in a program. They aren't in the hash index of `types`.
    string_literals: [ById<Atom, TypeId, Frozen, &'s Session>; 2],
    /// See `Types::is_unresolved_name`.
    has_unresolved_names: AtomicBool,
    /// Provides the text of published atoms, which ranks are computed from.
    texts: Interner<'s>,
    /// Id ranges that tasks have returned, by pool, for `reserve_ids` to hand out again. The lock
    /// is also held while new ids are reserved.
    spare_ids: Guarded<[Vec<Placeholders<'s>>; ID_POOLS]>,
}

/// Number of types a task had created at some point, task-local and published. See
/// `Types::first_new_type_id`.
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
    /// Returns the id as a number, for set operations: sort to deduplicate, binary search for
    /// membership. The id types don't implement `Ord`, so that nothing depends on id order by
    /// accident, because which of two types gets the lower id depends on timing. To order types, use
    /// `Types::content_order`.
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

    /// Returns the ordinary variant of `undefined` or `null`. They have variants that flags, facts
    /// and relations don't distinguish.
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
    /// `texts` must be the program's interner.
    pub fn new_in(session: &'s Session, texts: Interner<'s>) -> Self {
        let summaries = PublishedRecords::new_in(session);
        let store = TypeStore {
            session,
            types: Interned::new_in(session),
            summaries: session.arena().alloc(summaries),
            sigs: Interned::new_in(session),
            mappers: Interned::new_in(session),
            components: Interned::new_in(session),
            string_literals: [ById::new_in(session), ById::new_in(session)],
            has_unresolved_names: AtomicBool::new(false),
            texts,
            spare_ids: Guarded::default(),
        };
        // The identity mapper comes first, because a type's flags include its mapper's.
        let no_pairs = (Mapping::empty(), ObjectFlags::empty());
        assert_eq!(
            store.mappers.add(survey(&[]).spread, no_pairs),
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
            (store.components).add(spread_in_window(&no_components[..]), no_components),
            ComponentsId::NONE.0
        );
        store
    }

    /// Publishes a type whose id every task of the program knows. Call it before the first step, on
    /// one thread. Everything it references must be published.
    pub fn publish_constant(&self, data: TypeData<'s>) -> TypeId {
        debug_assert!(!self.shares_records());
        let created = (data, None);
        let spread = spread_in_window(&created);
        if let Some(id) = self.types.find(spread, |record| record.created == created) {
            return TypeId(id);
        }
        let own = OwnStore::new_in(self.session.arena(), self);
        let record = Types::new(self, &own).new_record(created, self.types.items.len());
        let id = TypeId(self.types.add(spread, record));
        self.summarize_types(self.types.items.len());
        id
    }

    /// Adds the summaries of the types with ids below `below`, which are all stored, to `summaries`.
    /// Runs before the first task, on one thread.
    fn summarize_types(&self, below: u32) {
        for id in self.summaries.len()..below {
            // A record only references records with lower ids.
            let record = self.types.items.get(id);
            let summary = record.summary(|member| {
                debug_assert!(member.0 < id);
                (self.summaries.get(member.0).member_flags).load(Ordering::Relaxed)
            });
            self.summaries.push(Summary::new(summary));
        }
    }

    /// After this call, a task with `Sharing::Publishes` publishes each record as it creates it (see `Interned`). Call it
    /// after the last `publish_constant` and before the first task.
    pub fn share_records(&mut self) {
        self.components.start_publishing();
        self.mappers.start_publishing();
        self.sigs.start_publishing();
        self.types.start_publishing();
    }

    fn shares_records(&self) -> bool {
        self.types.first_published_id != u32::MAX
    }

    /// See `Program::release`.
    pub fn release(&mut self) {
        *self.spare_ids.get_mut() = Default::default();
    }

    /// Returns the id for the next `kind` record that `own`'s task publishes. `class` is `class_of_type` for a type and
    /// 0 for any other kind.
    #[inline]
    fn next_id(&self, kind: Kind, class: usize, own: &OwnStore<'s>) -> Placeholder<'s> {
        let pool = kind as usize + class;
        let mut ids = own.ids[pool].take();
        if ids.is_empty() {
            ids = self.reserve_ids(kind, pool);
        }
        let next = ids.take_first();
        own.ids[pool].set(ids);
        let published = &own.published[kind as usize];
        published.set(published.get() + 1);
        next.expect("every reserved range has at least one id")
    }

    /// Reserves a range of ids for one task: a range that another task returned, or else new ids.
    #[cold]
    #[inline(never)]
    fn reserve_ids(&self, kind: Kind, pool: usize) -> Placeholders<'s> {
        let mut spare = self.spare_ids.lock();
        if let Some(ids) = spare[pool].pop() {
            return ids;
        }
        let next = match kind {
            Kind::Atom => return Placeholders::default(),
            Kind::Components => self.components.items.len(),
            Kind::Mapper => self.mappers.items.len(),
            Kind::Sig => self.sigs.items.len(),
            Kind::Type => self.types.items.len(),
        };
        // Reserving under the lock keeps the ids consecutive and keeps a type and its summary at the same index. The
        // first range is cut short so that every later one starts at a multiple of its length.
        let count = ID_RANGE_LENS[kind as usize];
        let count = count - next % count;
        match kind {
            Kind::Atom => Placeholders::default(),
            Kind::Components => self.components.reserve(count),
            Kind::Mapper => self.mappers.reserve(count),
            Kind::Sig => self.sigs.reserve(count),
            Kind::Type => {
                let ids = self.types.reserve(count);
                let nothing = || Summary::new(TypeSummary::NOTHING);
                let summaries = self.summaries.add_placeholders(count, nothing);
                debug_assert_eq!(ids.first(), summaries.first());
                ids
            }
        }
    }

    /// Called at the end of a task. Makes the ids it reserved but didn't use available to later
    /// tasks.
    pub fn reclaim_ids(&self, own: &OwnStore<'s>) {
        if own.sharing != Sharing::Publishes {
            return;
        }
        let mut spare = self.spare_ids.lock();
        for (ids, spare) in own.ids.iter().zip(spare.iter_mut()) {
            let left = ids.take();
            if !left.is_empty() {
                spare.push(left);
            }
        }
    }
}

/// Number of ids `TypeStore::reserve_ids` reserves per call, in `KINDS` order. Atoms are numbered one at a time because
/// a task creates few of them.
const ID_RANGE_LENS: [u32; 5] = [0, 32, 512, 256, 1024];

/// Number of id ranges a task has at a time: one per kind, except that types, the last kind, have one per class
/// (`class_of_type`).
const ID_POOLS: usize = KINDS.len() + 6;

/// Returns the id pool class of a type. Most tables keyed by type only have entries for one sort of type: type
/// parameters, unions, intersections or references. A reserved id range covers exactly one page of cells in those
/// tables. So each range only contains one sort of type, and a table only touches the pages for the sorts it stores.
#[inline]
fn class_of_type(data: &TypeData) -> usize {
    match data {
        TypeData::TypeParam(..) | TypeData::ThisParam(_) => 1,
        TypeData::Union(_) => 2,
        TypeData::Intersection(_) => 3,
        TypeData::Ref { .. } | TypeData::Tuple { .. } => 4,
        TypeData::Anon { .. }
        | TypeData::Fns { .. }
        | TypeData::Synth(_)
        | TypeData::ReverseMapped { .. } => 5,
        TypeData::Cond { .. } | TypeData::IndexedAccess { .. } | TypeData::Keyof(_) => 6,
        _ => 0,
    }
}

impl<'p, 's> Types<'p, 's> {
    #[inline(always)]
    pub fn new(published: &'p TypeStore<'s>, own: &OwnStore<'s>) -> Types<'p, 's> {
        // SAFETY: task-local records never move and live as long as the task, and no reference that
        // a task returns outlives it, because `finish` takes `&mut OwnStore`. So a reference to a
        // task-local record can be returned like one to a published record.
        let own = unsafe { &*std::ptr::from_ref(own) };
        debug_assert!((own.types.records).is_layered_over(published.types.items.elements()));
        Types { published, own }
    }

    /// Returns a copy of `items` to store in a type, a signature or a table value.
    #[inline]
    pub fn list<T: Copy>(&self, items: &[T]) -> List<'s, T> {
        List::copy_from_slice_in(items, self.own.arena)
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &'p TypeData<'s> {
        &self.record(id).created.0
    }

    /// `t.AsTypeReference().node != nil`: returns the components of the deferred type reference `id`,
    /// whether or not it's resolved.
    #[inline]
    pub fn deferred(&self, id: TypeId) -> Option<&'p DeferredTypeArguments> {
        match self.get(id) {
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => args.as_deferred(),
            _ => None,
        }
    }

    /// Returns a union's members, an empty list for `never`, and any other type as a single element.
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

    /// Most programs have no `TypeData::UnresolvedName`, and then this returns false without
    /// inspecting the type.
    #[inline]
    pub fn is_unresolved_name(&self, id: TypeId) -> bool {
        let published = &self.published.has_unresolved_names;
        (self.own.has_unresolved_names.get() || published.load(Ordering::Relaxed))
            && matches!(self.get(id), TypeData::UnresolvedName { .. })
    }

    #[inline]
    pub fn flags(&self, id: TypeId) -> u32 {
        (self.own.summaries.get_layered(id.0).flags).load(Ordering::Relaxed)
    }

    #[inline]
    pub fn object_flags(&self, id: TypeId) -> ObjectFlags {
        let bits = &self.own.summaries.get_layered(id.0).object_flags;
        ObjectFlags::from_bits_retain(bits.load(Ordering::Relaxed))
    }

    #[inline]
    pub fn instantiation_class(&self, id: TypeId) -> InstantiationClass {
        let number = &self.own.summaries.get_layered(id.0).class;
        InstantiationClass::from_u8(number.load(Ordering::Relaxed))
    }

    /// Returns `Type.flags` ORed together for every type that `maybeTypeOfKind` visits in `id`. For
    /// a union or an intersection that's the `member_flags` of its constituents, without its own
    /// flags. For any other type it's the type's flags.
    #[inline]
    pub fn member_flags(&self, id: TypeId) -> u32 {
        self.member_flags_and_more(id) & !(HAS_FRESH_LITERAL | IS_PLAIN_OBJECT | IS_MAPPED_TYPE)
    }

    /// True if `id` is a fresh literal type or contains one among the types `member_flags` covers.
    #[inline]
    pub fn has_fresh_literal(&self, id: TypeId) -> bool {
        self.member_flags_and_more(id) & HAS_FRESH_LITERAL != 0
    }

    /// True if `id` is an object type other than a mapped type or an evolving array type.
    #[inline]
    pub fn is_plain_object(&self, id: TypeId) -> bool {
        self.member_flags_and_more(id) & IS_PLAIN_OBJECT != 0
    }

    #[inline]
    pub fn is_mapped_type(&self, id: TypeId) -> bool {
        self.member_flags_and_more(id) & IS_MAPPED_TYPE != 0
    }

    /// True if `id` is an object type other than an evolving array type.
    #[inline(always)]
    pub fn is_object_type(&self, id: TypeId) -> bool {
        self.member_flags_and_more(id) & (IS_PLAIN_OBJECT | IS_MAPPED_TYPE) != 0
    }

    #[inline]
    fn member_flags_and_more(&self, id: TypeId) -> u32 {
        (self.own.summaries.get_layered(id.0).member_flags).load(Ordering::Relaxed)
    }

    /// `Relaxed` is enough here and in `add_facts`. A fact lives in one byte and is written in one
    /// store, so a reader sees all of it or none of it, and doesn't read any other memory based on
    /// it.
    #[inline]
    fn facts(&self, id: TypeId) -> u8 {
        self.facts_cell(id).load(Ordering::Relaxed)
    }

    #[inline]
    fn facts_cell(&self, id: TypeId) -> &'p AtomicU8 {
        &self.own.summaries.get_layered(id.0).facts
    }

    /// Only for a fact that's a function of `id`'s interning key and the program, and is computed
    /// without resolving anything. Computing it must not create a type, signature or mapper, run a
    /// query or advance a counter. A task then can't tell whether it read the fact or computed it,
    /// so it doesn't matter which task wrote it or when, even into a published type.
    #[inline]
    fn add_facts(&self, id: TypeId, facts: u8) {
        let known = self.facts_cell(id);
        if id.0 & LOCAL == 0 {
            known.fetch_or(facts, Ordering::Relaxed);
        } else {
            known.store(known.load(Ordering::Relaxed) | facts, Ordering::Relaxed);
        }
    }

    /// True if `id` is the type of a module or namespace used as a value.
    #[inline]
    pub fn is_module_object(&self, id: TypeId) -> bool {
        self.facts(id) & fact::IS_MODULE_OBJECT != 0
    }

    /// Returns `ObjectFlagsCouldContainTypeVariables`, or `None` if
    /// `ObjectFlagsCouldContainTypeVariablesComputed` isn't set.
    #[inline]
    pub fn could_contain_type_variables(&self, id: TypeId) -> Option<bool> {
        let facts = self.facts(id);
        (facts & fact::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED != 0)
            .then_some(facts & fact::COULD_CONTAIN_TYPE_VARIABLES != 0)
    }

    /// See `add_facts`.
    #[inline]
    pub fn set_could_contain_type_variables(&self, id: TypeId, could_contain: bool) {
        let value = match could_contain {
            true => fact::COULD_CONTAIN_TYPE_VARIABLES,
            false => 0,
        };
        self.add_facts(id, fact::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED | value);
    }

    /// Returns `ObjectFlagsIsGenericObjectType` and `ObjectFlagsIsGenericIndexType`, or `None` if
    /// `set_generic_object_flags` hasn't been called.
    #[inline]
    pub fn generic_object_flags(&self, id: TypeId) -> Option<(bool, bool)> {
        let facts = self.facts(id);
        (facts & fact::GENERIC_OBJECT_FLAGS_COMPUTED != 0).then_some((
            facts & fact::IS_GENERIC_OBJECT_TYPE != 0,
            facts & fact::IS_GENERIC_INDEX_TYPE != 0,
        ))
    }

    /// See `add_facts`. Don't call this for a type in which `getGenericObjectFlags` reaches a
    /// mapped type, because it resolves the mapped type's constraint type.
    #[inline]
    pub fn set_generic_object_flags(&self, id: TypeId, (object, index): (bool, bool)) {
        let mut facts = fact::GENERIC_OBJECT_FLAGS_COMPUTED;
        if object {
            facts |= fact::IS_GENERIC_OBJECT_TYPE;
        }
        if index {
            facts |= fact::IS_GENERIC_INDEX_TYPE;
        }
        self.add_facts(id, facts);
    }

    /// Returns `Checker::has_generic_arguments`, or `None` if `set_has_generic_arguments` hasn't
    /// been called.
    #[inline]
    pub fn has_generic_arguments(&self, id: TypeId) -> Option<bool> {
        let facts = self.facts(id);
        (facts & fact::HAS_GENERIC_ARGUMENTS_COMPUTED != 0)
            .then_some(facts & fact::HAS_GENERIC_ARGUMENTS != 0)
    }

    /// See `add_facts`.
    #[inline]
    pub fn set_has_generic_arguments(&self, id: TypeId, has_generic_arguments: bool) {
        let value = match has_generic_arguments {
            true => fact::HAS_GENERIC_ARGUMENTS,
            false => 0,
        };
        self.add_facts(id, fact::HAS_GENERIC_ARGUMENTS_COMPUTED | value);
    }

    /// Returns the destination of `record`, a `kind` record the task is about to create. `class` is the same as for
    /// `TypeStore::next_id`. `is_bound` is `record.is_bound(self.own)`.
    #[inline]
    fn destination_of(
        &self,
        kind: Kind,
        class: usize,
        record: &impl Follow,
        is_bound: bool,
    ) -> Destination<'s> {
        debug_assert_eq!(is_bound, record.is_bound(self.own));
        if is_bound || self.own.sharing != Sharing::Publishes {
            return Destination::Own { is_bound };
        }
        let id = self.published.next_id(kind, class, self.own);
        if record.is_of_visited_file(self.own) {
            let mut records = self.own.of_visited_files[kind as usize].borrow_mut();
            records.set(id.index() as usize);
        }
        Destination::Published(id)
    }

    /// Calls `new_record` for a type that `intern_record` creates, and returns the record with its destination.
    /// `own_id` is the type's id if it stays task-local. `is_bound` is the same as for `destination_of`. The summary is
    /// stored here, before the record is published, because a task that finds the type may read its summary
    /// immediately.
    fn new_record_of_task(
        &self,
        created: OwnedTypeKey<'s>,
        own_id: u32,
        is_bound: bool,
    ) -> (TypeRecord<'s>, Destination<'s>) {
        let class = class_of_type(&created.0);
        let home = self.destination_of(Kind::Type, class, &created, is_bound);
        let record = self.new_record(created, home.id(own_id));
        let summary = record.summary(|member| self.member_flags_and_more(member));
        let is_unresolved_name = matches!(record.created.0, TypeData::UnresolvedName { .. });
        match &home {
            Destination::Own { .. } => {
                let index = self.own.summaries.push(Summary::new(summary));
                debug_assert_eq!(index | LOCAL, own_id);
                if is_unresolved_name {
                    self.own.has_unresolved_names.set(true);
                }
            }
            Destination::Published(id) => {
                (self.published.summaries.get(id.index())).set(summary);
                if is_unresolved_name {
                    cold_path();
                    let has_unresolved_names = &self.published.has_unresolved_names;
                    has_unresolved_names.store(true, Ordering::Relaxed);
                }
            }
        }
        (record, home)
    }

    /// `Type.flags`
    fn flags_of(created: &OwnedTypeKey) -> u32 {
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
            // marker in its mapper isn't propagated, because `reportUnreliableMapper` is applied to
            // the parameter, not to the contents of its mapper.
            TypeData::TypeParam(_, _, enclosing_mapper) => {
                ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
                    | (self.mapper_record(*enclosing_mapper).1 & ObjectFlags::HAS_UNRESOLVED)
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
                // `couldContainTypeVariables`: `t.AsTypeReference().node != nil`. `createDeferredTypeReference` doesn't
                // set any propagating flags.
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
                let mut property_flags = ObjectFlags::empty();
                for p in &shape.props {
                    if let PropSource::Type(t)
                    | PropSource::Copy(t, ..)
                    | PropSource::ReverseMapped(t, _) = p.source
                    {
                        let mut type_flags = self.object_flags(t);
                        // `getWidenedProperty` widens it when the property is read.
                        if p.flags.contains(PropFlags::WIDEN) {
                            type_flags.remove(ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL);
                        }
                        property_flags |= type_flags;
                    }
                    flags |= self.mapper_record(p.mapper).1;
                    if let Some(key) = self.separate_key(p) {
                        flags |= self.object_flags(key);
                    }
                }
                flags |= property_flags;
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
                    Literalness::JsxAttributes => flags |= property_flags & non_inferrable,
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
            // `mapped` and `of` always reference the inferred type parameter, which doesn't make
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
        self.own.types.records.get_layered(id.0)
    }

    #[inline(always)]
    fn mapper_record(&self, id: MapperId) -> &'p MapperRecord<'s> {
        self.own.mappers.records.get_layered(id.0)
    }

    /// True if a union or an intersection with `key` and `origin` gets
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
        let origin_types: &[TypeId] = match origin {
            OriginKey::Union(types) | OriginKey::Intersection(types) => types,
            OriginKey::None | OriginKey::Keyof(_) => &[],
        };
        members.iter().chain(origin_types).any(|&t| {
            self.object_flags(t)
                .contains(ObjectFlags::HAS_OTHER_INSTANTIATION)
        })
    }

    /// True if the members of an intersection are references to one target, and all but one at most are deferred.
    /// `getTypeWithThisArgument` recreates every reference, so with the same type arguments they become one type:
    /// the apparent type of `A & [number]` is `[number]` after `type A = [number]`. The type arguments aren't
    /// resolved here.
    pub fn can_become_one_reference(&self, members: &[TypeId]) -> bool {
        let has_target_of_first = |&member: &TypeId| match (self.get(members[0]), self.get(member))
        {
            (TypeData::Ref { target: a, .. }, TypeData::Ref { target: b, .. }) => a == b,
            (
                TypeData::Tuple {
                    flags: a,
                    readonly: a_readonly,
                    ..
                },
                TypeData::Tuple {
                    flags: b,
                    readonly: b_readonly,
                    ..
                },
            ) => a_readonly == b_readonly && **a == **b,
            _ => false,
        };
        let is_given = |&&member: &&TypeId| self.deferred(member).is_none();
        members.iter().all(has_target_of_first) && members.iter().filter(is_given).count() <= 1
    }

    fn new_record(&self, created: OwnedTypeKey<'s>, id: u32) -> TypeRecord<'s> {
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
        let has_only_own_apparent_types = matches!(data, TypeData::Intersection(members) if members.iter().all(is_own_apparent_type) && !self.can_become_one_reference(members));
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
        // `getObjectTypeInstantiation` doesn't omit any outer type parameter for a target with alias
        // type arguments.
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
            // `isNonGenericTopLevelType`, see `has_other_instantiation`. It's never called on a result
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
        // Unlike the other flags, these two aren't propagated from the type's constituents.
        flags.set(ObjectFlags::MAY_BE_REDUCED, may_be_reduced);
        flags.set(
            ObjectFlags::HAS_ONLY_OWN_APPARENT_TYPES,
            has_only_own_apparent_types,
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
            constrained_type_variable: std::sync::atomic::AtomicU8::new(constrained_type_variable),
            is_without_primitive_union: first_request.has(FirstRequest::WITHOUT_PRIMITIVE_UNION),
            created,
            id: TypeId(id),
        }
    }

    /// Runs `create` so that a type it creates has `flags` set from the start. `create` must request one type and
    /// evaluate nothing else, because any other type it created would get the flags too. A type that already exists is
    /// unchanged.
    #[inline]
    pub fn as_first_request(&self, flags: FirstRequest, create: impl FnOnce() -> TypeId) -> TypeId {
        let previous = self.own.first_request.replace(flags);
        let id = create();
        self.own.first_request.set(previous);
        id
    }

    /// Compares `a.id` with `b.id` for `isDeeplyNestedType`, which treats a higher id as a sign of a newer instantiation,
    /// one caused by recursion. Only the heights are compared. The instantiations of a recursion
    /// that steps from one literal type to the next all have the same height, and comparing their hashes would count
    /// only about half of them. The caller orders two types with the same height.
    #[inline]
    pub fn nesting_order(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        self.rank(a).height.cmp(&self.rank(b).height)
    }

    #[inline]
    fn rank(&self, id: TypeId) -> Rank {
        match self.own.summaries.get_layered(id.0).rank() {
            Some(rank) => rank,
            None => self.rank_on_first_use(id),
        }
    }

    /// Computes and stores the rank of `id`, after the ranks of the types its key mentions. Uses a list instead of
    /// recursion, because a program can nest a key to any depth.
    #[cold]
    #[inline(never)]
    fn rank_on_first_use(&self, id: TypeId) -> Rank {
        let mut unranked: SmallVec<[TypeId; 16]> = SmallVec::new();
        unranked.push(id);
        let mut last = Rank::NONE;
        while let Some(&next) = unranked.last() {
            let summary = self.own.summaries.get_layered(next.0);
            // Every type has flags. An id that's reserved but not used yet doesn't, and it has no rank.
            let known = match summary.flags.load(Ordering::Relaxed) {
                0 => Some(Rank::NONE),
                _ => summary.rank(),
            };
            if let Some(known) = known {
                last = known;
                unranked.pop();
                continue;
            }
            match self.rank_of_type(&self.record(next).created) {
                Ok(rank) => summary.set_rank(rank),
                Err(mentioned) => unranked.extend(mentioned),
            }
        }
        last
    }

    /// The order used where tsgo compares ids: the final tie-break of `CompareTypes`, and the swap of an identity
    /// comparison in `getRelationKey`. Orders types by `Rank`: height, then last syntax, then hash. The result depends
    /// only on the program, whereas id order depends on which task created what first. It's a total order, because two
    /// types with equal ranks are ordered by `compare_contents`.
    pub fn content_order(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        if a == b {
            return std::cmp::Ordering::Equal;
        }
        let (x, y) = (self.rank(a), self.rank(b));
        (x.height.cmp(&y.height))
            .then_with(|| x.last_syntax.cmp(&y.last_syntax))
            .then_with(|| x.content.cmp(&y.content))
            .then_with(|| self.compare_contents(a, b))
    }

    /// Compares the written-out keys of `a` and `b` item by item. Where both keys mention a type, those types are
    /// compared with `content_order`. Their heights are lower than `a`'s and `b`'s, so the recursion terminates. Two
    /// keys that are equal throughout are the same key, and a task sees only one type per key.
    #[cold]
    fn compare_contents(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        let (x, y) = (self.written_key(a), self.written_key(b));
        let mut order = x.len().cmp(&y.len());
        for pair in x.iter().zip(&y) {
            if order.is_ne() {
                break;
            }
            order = match pair {
                (KeyItem::Word(x), KeyItem::Word(y)) => x.cmp(y),
                (KeyItem::Type(x), KeyItem::Type(y)) => self.content_order(*x, *y),
                (KeyItem::Word(_), KeyItem::Type(_)) => std::cmp::Ordering::Less,
                (KeyItem::Type(_), KeyItem::Word(_)) => std::cmp::Ordering::Greater,
            };
        }
        // Equal keys shouldn't reach this point. The id tie-break keeps this a total order if they
        // do.
        order.then_with(|| a.0.cmp(&b.0))
    }

    fn written_key(&self, id: TypeId) -> Vec<KeyItem> {
        let mut writer = KeyWriter {
            types: *self,
            key_items: Vec::new(),
        };
        self.record(id).created.visit(&mut writer);
        writer.key_items
    }

    /// Returns an atom's text, published or task-local. Empty for `Atom::NONE`.
    fn text(&self, atom: Atom) -> &'p [u8] {
        if atom.is_none() {
            return &[];
        }
        if atom.is_own() {
            return self.own.atom_bytes(atom);
        }
        self.published.texts.bytes(atom)
    }

    /// Returns `Err` with the types that `created` mentions and that have no rank yet, if there are any.
    fn rank_of_type(&self, created: &OwnedTypeKey) -> Result<Rank, Unranked> {
        let mut ranking = Ranking::new(*self);
        visit_type_as_content(created, &mut ranking);
        if !ranking.unranked.is_empty() {
            return Err(ranking.unranked);
        }
        Ok(Rank {
            height: ranking.height + 1,
            last_syntax: ranking.last_syntax,
            content: ranking.content.0,
        })
    }

    /// `Shape::has_no_instantiable_symbol` is part of a type's identity only where it makes a
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
        let literal = match data {
            TypeData::StringLit { value, fresh } if !value.is_own() => {
                Some((value, &self.published.string_literals[usize::from(fresh)]))
            }
            _ => None,
        };
        if let Some((value, known)) = literal
            && let Some(id) = known.get(&value)
        {
            // Another task may have just inserted it (see below). The fence makes that task's earlier writes visible.
            std::sync::atomic::fence(Ordering::Acquire);
            return id;
        }
        let id = self.intern_new((data, None));
        if let Some((value, known)) = literal
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

    /// `intern` for a type with lists. Doesn't allocate if the type exists.
    #[inline]
    pub fn intern_key(&self, key: TypeKey<'_>) -> TypeId {
        self.intern_borrowed(key, None)
    }

    /// `intern_with` for a type with lists. Doesn't allocate if the type exists.
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
        let spread = spread_in_window(&key);
        TypeId(intern_record(
            (&self.published.types, self.own),
            |own| &own.types,
            (spread, key),
            |(data, provenance)| {
                data.is_bound(self.own) || provenance.is_some_and(|it| it.is_bound(self.own))
            },
            |(data, provenance)| {
                data.mentions_own() || provenance.is_some_and(|it| it.mentions_own())
            },
            |record, (data, provenance)| {
                data.is(&record.created.0)
                    && match (provenance, &record.created.1) {
                        (None, None) => true,
                        (Some(provenance), Some(record_provenance)) => {
                            provenance.is(record_provenance)
                        }
                        _ => false,
                    }
            },
            |(data, provenance), id, is_bound| {
                let arena = self.own.arena;
                let provenance =
                    provenance.map(|it| ArenaBox::new_in(it.to_provenance(arena), arena));
                let created: OwnedTypeKey<'s> = (data.to_data(arena), provenance);
                debug_assert_eq!(spread_in_window(&created), spread);
                self.new_record_of_task(created, id, is_bound)
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

    fn intern_new(&self, created: OwnedTypeKey<'s>) -> TypeId {
        TypeId(intern_record(
            (&self.published.types, self.own),
            |own| &own.types,
            (spread_in_window(&created), created),
            |created| created.is_bound(self.own),
            |created| created.mentions_own(),
            |record, created| record.created == *created,
            |created, id, is_bound| self.new_record_of_task(created, id, is_bound),
        ))
    }

    /// Returns a snapshot for `is_new_since`. Comparing two snapshots shows whether the task
    /// created a type in between.
    #[inline]
    pub fn first_new_type_id(&self) -> NewTypes {
        NewTypes {
            own: self.own.types.records.len(),
            published: self.own.published[Kind::Type as usize].get(),
        }
    }

    /// `ObjectFlagsFromTypeNode`: `id` is the type of a type node. `first_new_type_id` was taken
    /// before the node was resolved. `createTypeReferenceEx` sets the flags only on a type that it
    /// creates, so a type that an instantiation created earlier is unchanged.
    pub fn mark_from_type_node(&self, id: TypeId, first_new_type_id: NewTypes) {
        if id.0 & LOCAL == 0 {
            return;
        }
        // Unlike in tsgo, a bound type gets the flag even if an instantiation created it earlier.
        if self.is_new_since(id, first_new_type_id) || self.own.types.is_bound(id.0 & !LOCAL) {
            let record = self.record(id);
            record.is_from_type_node.store(true, Ordering::Relaxed);
        }
    }

    #[inline]
    pub fn is_from_type_node(&self, id: TypeId) -> bool {
        self.record(id).is_from_type_node.load(Ordering::Relaxed)
    }

    /// Records whether `getIntersectionTypeEx` requested `ObjectFlagsIsConstrainedTypeVariable` for
    /// the intersection `id`. It sets the flags only on a type that it creates, so the first request
    /// decides. A published type is unchanged.
    pub fn set_constrained_type_variable(&self, id: TypeId, is_constrained: bool) {
        if id.0 & LOCAL != 0 {
            let state = &self.record(id).constrained_type_variable;
            if state.load(Ordering::Relaxed) == 0 {
                state.store(1 + u8::from(is_constrained), Ordering::Relaxed);
            }
        }
    }

    /// Returns `None` if no request has decided yet.
    #[inline]
    pub fn is_constrained_type_variable(&self, id: TypeId) -> Option<bool> {
        match (self.record(id).constrained_type_variable).load(Ordering::Relaxed) {
            0 => None,
            state => Some(state == 2),
        }
    }

    /// True if the task has created `id` since `first_new_type_id` was taken.
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
        self.own.sigs.records.get_layered(id.0)
    }

    /// Returns the signature that `sig` is transitively a clone of, which is the one that has the
    /// declaration (`Signature.declaration`).
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
            (&self.published.sigs, self.own),
            |own| &own.sigs,
            (spread_in_window(&data), data),
            |data| data.is_bound(self.own),
            |data| data.mentions_own(),
            |record, data| record == data,
            |data, _, is_bound| {
                let home = self.destination_of(Kind::Sig, 0, &data, is_bound);
                (data, home)
            },
        ))
    }

    /// `IndexInfo.components`
    #[inline]
    pub fn components(&self, id: ComponentsId) -> &'p [IndexComponent] {
        &self.own.components.records.get_layered(id.0)[..]
    }

    pub fn intern_components(&self, list: &[IndexComponent]) -> ComponentsId {
        if list.is_empty() {
            return ComponentsId::NONE;
        }
        ComponentsId(intern_record(
            (&self.published.components, self.own),
            |own| &own.components,
            (spread_in_window(list), list),
            |list| list.is_bound(self.own),
            |_| false,
            |record, list| **record == **list,
            |list, _, is_bound| {
                let list = self.list(list);
                let home = self.destination_of(Kind::Components, 0, &list, is_bound);
                (list, home)
            },
        ))
    }

    /// `pairs` need not be sorted. A parameter mapped to itself is preserved, because it records that
    /// the origin depends on it.
    pub fn mapper(&self, mut pairs: Vec<(TypeId, TypeId)>) -> MapperId {
        if pairs.is_empty() {
            return MapperId::IDENTITY;
        }
        let found = survey(&pairs);
        if found.is_in_order {
            return self.mapper_in_order(&pairs, &found);
        }
        let len = put_in_order(&mut pairs);
        self.mapper_in_order(&pairs[..len], &survey(&pairs[..len]))
    }

    /// The same for borrowed pairs. Doesn't allocate for sorted pairs whose mapper already exists.
    pub fn mapper_of(&self, pairs: &[(TypeId, TypeId)]) -> MapperId {
        if pairs.is_empty() {
            return MapperId::IDENTITY;
        }
        let found = survey(pairs);
        if found.is_in_order {
            return self.mapper_in_order(pairs, &found);
        }
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::from_slice(pairs);
        let len = put_in_order(&mut pairs);
        self.mapper_in_order(&pairs[..len], &survey(&pairs[..len]))
    }

    /// `found` is `survey(pairs)`.
    fn mapper_in_order(&self, pairs: &[(TypeId, TypeId)], found: &Survey) -> MapperId {
        MapperId(intern_record(
            (&self.published.mappers, self.own),
            |own| &own.mappers,
            (found.spread, pairs),
            // Only a task-local type can be bound.
            |pairs| found.mentions_own && pairs.is_bound(self.own),
            |_| found.mentions_own,
            |record, pairs| *record.0 == **pairs,
            |pairs, _, is_bound| {
                let flags =
                    (pairs.iter()).fold(ObjectFlags::empty(), |f, p| f | self.object_flags(p.1));
                let pairs = Mapping::copy_from_slice_in(pairs, self.own.arena);
                let home = self.destination_of(Kind::Mapper, 0, &pairs, is_bound);
                ((pairs, flags), home)
            },
        ))
    }

    #[inline]
    pub fn mapping(&self, id: MapperId) -> &'p [(TypeId, TypeId)] {
        &self.mapper_record(id).0
    }

    /// Returns the flags of the types that `id` maps to.
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

    /// Returns `keyType` of `prop` if `prop` is a mapped type's property that stores the key in `Prop::name_type`
    /// instead of in its mapper. In that form `Prop::mapper` is the mapped type's own mapper, and that's how the form
    /// is recognized, because a mapper that includes the key is a different mapper. Returns `None` for any other
    /// property, and when `Prop::mapper` includes the key.
    ///
    /// Without this form, a mapped type with 300 keys would create 300 mappers, even though only a few properties ever
    /// have their types requested. The forms map one to one, so properties that are equal in one form are equal in the
    /// other form:
    /// - The key stays separate as long as the mapper is the one `resolveMappedTypeMembers` stored in the property.
    /// - Code that composes that mapper with another one composes `Checker::mapper_of_prop` instead. If the result is a
    ///   different mapper, the property gets it, and `Prop::name_type` reverts to its ordinary meaning.
    #[inline]
    pub fn separate_key(&self, prop: &Prop) -> Option<TypeId> {
        match prop.source {
            PropSource::Mapped(mapped_type, ..) if prop.name_type != TypeId::UNRESOLVED => {
                match *self.get(mapped_type) {
                    TypeData::Anon { mapper, .. } if mapper == prop.mapper => Some(prop.name_type),
                    _ => None,
                }
            }
            _ => None,
        }
    }
}

// ───────────────────────────── references between records: `visit` ─────────────────────────────

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
    /// Reports the number of a `crate::table::Handle`. Two copies of the same value have different
    /// numbers.
    #[inline]
    fn handle(&mut self, handle: u32) {
        self.plain(&handle);
    }
}

/// A value that can reference an atom, a list of index components, a mapper, a signature or a type:
/// the data of a record, a key or a value of a table. Each type is described once, by
/// `follow_struct!` or `follow_enum!`, with every field named, so that adding a field without
/// listing it there is a compile error.
pub trait Follow {
    fn visit<V: Visitor>(&self, visitor: &mut V);

    /// True if it references a node or symbol of a file the task has visited, or a record published by this task that
    /// does.
    fn is_of_visited_file(&self, own: &OwnStore) -> bool {
        let mut visitor = IsOfVisitedFile {
            own,
            is_of_visited_file: false,
        };
        self.visit(&mut visitor);
        visitor.is_of_visited_file
    }

    /// True if it references a node or a symbol of a file that nothing imports, or a task-local
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

    /// True if it references a task-local record.
    #[inline]
    fn mentions_own(&self) -> bool {
        let mut visitor = MentionsOwn(false);
        self.visit(&mut visitor);
        visitor.0
    }
}

/// For types that don't reference anything. `visit` reports the whole value as data to hash.
macro_rules! has_no_references {
    ($($name:ty),* $(,)?) => {$(
        impl $crate::types::Follow for $name {
            #[inline]
            fn visit<V: $crate::types::Visitor>(&self, visitor: &mut V) {
                visitor.plain(self);
            }
        }
    )*};
}

/// `follow_struct!(Name { every, field })`
macro_rules! follow_struct {
    ($name:ident $(<$lifetime:lifetime>)? { $($field:ident),* $(,)? }) => {
        impl $crate::types::Follow for $name $(<$lifetime>)? {
            fn visit<V: $crate::types::Visitor>(&self, visitor: &mut V) {
                let $name { $($field),* } = self;
                $($crate::types::Follow::visit($field, visitor);)*
            }
        }
    };
}
pub(crate) use follow_struct;

/// `follow_enum!(Name { Name::A(x, y) => (x, y), Name::B { z } => (z), Name::C => () })`. List every variant, without
/// `..`.
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
        }
    };
}

macro_rules! follow_id {
    ($($name:ident: $visit:ident;)*) => {$(
        impl Follow for $name {
            #[inline]
            fn visit<V: Visitor>(&self, visitor: &mut V) {
                visitor.$visit(*self);
            }
        }
    )*};
}

follow_id! {
    Atom: atom;
    ComponentsId: components;
    MapperId: mapper;
    SigId: sig;
    TypeId: ty;
}

impl Follow for FileId {
    #[inline]
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.file(*self);
    }
}

impl Follow for Sym {
    #[inline]
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.file(self.file);
        visitor.plain(&self.id);
    }
}

impl<T: Follow> Follow for Option<T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.plain(&self.is_some());
        if let Some(it) = self {
            it.visit(visitor);
        }
    }
}

impl<T: Follow> Follow for Box<T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        (**self).visit(visitor);
    }
}

impl<T: Follow> Follow for [T] {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.plain(&self.len());
        for it in self {
            it.visit(visitor);
        }
    }
}

impl<T: Follow + ?Sized> Follow for ArenaBox<'_, T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        (**self).visit(visitor);
    }
}

impl<T: Follow> Follow for ArenaVec<'_, T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
}

impl<T: Follow, const N: usize, L: std::ops::DerefMut<Target = [T]>> Follow for ShortList<T, N, L> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        (**self).visit(visitor);
    }
}

impl<T: Follow> Follow for Box<[T]> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
}

impl<T: Follow> Follow for Vec<T> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
}

/// Bytes don't reference any record.
impl Follow for &[u8] {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
}

impl<K: Follow + Hash + Eq, T: Follow> Follow for FxHashMap<K, T> {
    /// Visits the entries in arbitrary order, so don't use it for a content hash.
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        for (key, value) in self {
            key.visit(visitor);
            value.visit(visitor);
        }
    }
}

macro_rules! follow_tuple {
    ($(($($name:ident $index:tt),*);)*) => {$(
        impl<$($name: Follow),*> Follow for ($($name,)*) {
            #[inline]
            fn visit<V: Visitor>(&self, visitor: &mut V) {
                $(self.$index.visit(visitor);)*
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

/// The label is a declared name, so it's published and needs no remapping
/// (`ElemFlags::with_label`). It's reported as an atom.
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
follow_struct!(Listed<'_> {
    props,
    call,
    construct,
    index,
    properties_of,
    literal,
    has_symbol_declared_at,
    is_plain
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

/// `Clone` for values that own arena memory. The copy is allocated in `arena`, which must belong to
/// the calling thread, and has that arena's lifetime, regardless of the original's.
pub trait CloneIn {
    /// `Self` with another lifetime.
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

/// `clone_in_enum!(Name { A(x, y), B { z }, C })`. List every variant.
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
clone_in_struct!(Listed {
    props,
    call,
    construct,
    index,
    properties_of,
    literal,
    has_symbol_declared_at,
    is_plain
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

/// See `Follow::is_of_visited_file`.
struct IsOfVisitedFile<'a, 's> {
    own: &'a OwnStore<'s>,
    is_of_visited_file: bool,
}

impl IsOfVisitedFile<'_, '_> {
    #[inline]
    fn id(&mut self, kind: Kind, id: u32) {
        if id & LOCAL == 0 {
            let records = self.own.of_visited_files[kind as usize].borrow();
            self.is_of_visited_file |= records.has(id as usize);
        }
    }
}

impl Visitor for IsOfVisitedFile<'_, '_> {
    #[inline]
    fn atom(&mut self, _: Atom) {}
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
        self.is_of_visited_file |= self.own.visited_files.has(file.0 as usize);
    }
    #[inline]
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

/// See `Follow::is_bound`.
struct IsBound<'a, 's> {
    own: &'a OwnStore<'s>,
    is_bound: bool,
}

impl Visitor for IsBound<'_, '_> {
    /// An atom is only text, so it doesn't reference anything.
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

/// A multiply-and-fold hash of a record's content, independent of the task that created it.
#[derive(Copy, Clone)]
struct ContentHash(u64);

#[inline]
fn fold(a: u64, b: u64) -> u64 {
    let product = u128::from(a) * u128::from(b);
    product as u64 ^ (product >> 64) as u64
}

impl ContentHash {
    const START: ContentHash = ContentHash(0x243f_6a88_85a3_08d3);

    #[inline]
    fn add(&mut self, word: u64) {
        self.0 = fold(self.0 ^ word, 0x9e37_79b9_7f4a_7c15);
    }
}

impl Hasher for ContentHash {
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
        self.0
    }
}

/// A visitor that hashes everything it visits.
trait Hashing: Visitor {
    /// Hashes `items` as a set, so the result doesn't depend on their order.
    fn unordered<T: Follow>(&mut self, items: &[T]);
}

/// Visits a type's key for a hash that doesn't depend on ids. A union is visited as a set.
fn visit_type_as_content<V: Hashing>(created: &OwnedTypeKey, content: &mut V) {
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
    /// Becomes `Rank::content`.
    content: ContentHash,
    /// Greatest height of any type visited.
    height: u32,
    /// Running maximum for `Rank::last_syntax`.
    last_syntax: u64,
    /// The file from the last `file` call. The `plain` value after a file is the number of a node or symbol in it.
    file: Option<FileId>,
    /// The types visited that have no rank. If there are any, the other fields are meaningless.
    unranked: Unranked,
}

type Unranked = SmallVec<[TypeId; 4]>;

impl<'p, 's> Ranking<'p, 's> {
    fn new(types: Types<'p, 's>) -> Ranking<'p, 's> {
        Ranking {
            types,
            content: ContentHash::START,
            height: 0,
            last_syntax: 0,
            file: None,
            unranked: SmallVec::new(),
        }
    }
}

/// A `Hasher` that captures the first number `Hash` writes.
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
            sum = sum.wrapping_add(one.content.0);
            self.height = self.height.max(one.height);
            self.last_syntax = self.last_syntax.max(one.last_syntax);
            self.unranked.extend(one.unranked);
        }
        self.content.add(items.len() as u64);
        self.content.add(sum);
    }
}

/// Only types have a stored `Rank`. Mappers, signatures and component lists are walked recursively.
impl Visitor for Ranking<'_, '_> {
    #[inline]
    fn atom(&mut self, atom: Atom) {
        let text = crate::atom::hash_of(self.types.text(atom));
        self.content.add(text ^ u64::from(atom.is_none()));
    }
    fn components(&mut self, id: ComponentsId) {
        self.types.components(id).visit(self);
    }
    /// Pairs are stored in type parameter id order, which a rank must not depend on, so they're
    /// hashed as a set.
    fn mapper(&mut self, id: MapperId) {
        let pairs = self.types.mapping(id);
        self.unordered(pairs);
    }
    fn sig(&mut self, id: SigId) {
        self.types.sig(id).visit(self);
    }
    #[inline]
    fn ty(&mut self, id: TypeId) {
        let Some(rank) = self.types.own.summaries.get_layered(id.0).rank() else {
            self.unranked.push(id);
            return;
        };
        self.content.add(rank.content);
        self.height = self.height.max(rank.height);
        self.last_syntax = self.last_syntax.max(rank.last_syntax);
    }
    #[inline]
    fn file(&mut self, file: FileId) {
        self.content.add(u64::from(file.0));
        self.file = Some(file);
    }
    #[inline]
    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut self.content);
        if let Some(file) = self.file.take() {
            let mut number = FirstNumber(None);
            value.hash(&mut number);
            // File numbers start at 1 here so that a real position is never 0.
            let syntax_position = (u64::from(file.0) + 1) << 32 | number.finish();
            self.last_syntax = self.last_syntax.max(syntax_position);
        }
    }
}

/// One item of a type's written-out key, for `Types::compare_contents`.
enum KeyItem {
    Word(u64),
    Type(TypeId),
}

/// Writes out a key as a list of `KeyItem`. As in `Rank::content`, the words never contain an id.
struct KeyWriter<'p, 's> {
    types: Types<'p, 's>,
    key_items: Vec<KeyItem>,
}

/// A `Hasher` that records what `Hash` writes as words.
struct WordWriter<'a>(&'a mut Vec<KeyItem>);

impl Hasher for WordWriter<'_> {
    fn write(&mut self, bytes: &[u8]) {
        self.0.push(KeyItem::Word(bytes.len() as u64));
        for chunk in bytes.chunks(8) {
            let mut word = [0; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            self.0.push(KeyItem::Word(u64::from_le_bytes(word)));
        }
    }
    fn finish(&self) -> u64 {
        0
    }
}

impl Visitor for KeyWriter<'_, '_> {
    fn atom(&mut self, atom: Atom) {
        self.key_items
            .push(KeyItem::Word(u64::from(atom.is_none())));
        WordWriter(&mut self.key_items).write(self.types.text(atom));
    }
    fn components(&mut self, id: ComponentsId) {
        self.types.components(id).visit(self);
    }
    /// Pairs are stored in type parameter id order, so they're re-sorted by `content_order`.
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
        self.key_items.push(KeyItem::Type(id));
    }
    fn file(&mut self, file: FileId) {
        self.key_items.push(KeyItem::Word(u64::from(file.0)));
    }
    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut WordWriter(&mut self.key_items));
    }
}

impl<'s> OwnStore<'s> {
    /// Returns the number of task-local records of each kind, in `KINDS` order.
    pub(crate) fn lengths(&self) -> [usize; 5] {
        [
            self.atoms.records.len() as usize,
            self.components.records.len() as usize,
            self.mappers.records.len() as usize,
            self.sigs.records.len() as usize,
            self.types.records.len() as usize,
        ]
    }

    /// Number of records of each kind the task has created, task-local or published, in `KINDS` order. Callers compare
    /// two results to tell whether a computation created a record.
    #[inline]
    pub(crate) fn created(&self) -> [usize; 5] {
        let mut created = self.lengths();
        for (count, published) in created.iter_mut().zip(&self.published) {
            *count += published.get() as usize;
        }
        created
    }
}

/// Skipped under Miri, which can't run mimalloc (foreign code).
#[cfg(all(test, not(miri)))]
mod tests {
    use super::*;
    use crate::util::spread_hash;

    type Fat<'s> = ShortList<TypeId, 3, List<'s, TypeId>>;
    type Thin<'s> = ShortList<TypeId, 3, ThinList<'s, TypeId>>;

    fn ids(len: u32) -> Vec<TypeId> {
        (0..len).map(|i| TypeId(i + 10)).collect()
    }

    #[test]
    fn short_list_stores_up_to_n_items_inline() {
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
    fn short_list_compares_and_hashes_like_its_items() {
        let session = Session::new();
        let arena = session.arena();
        for len in [0, 1, 3, 4] {
            let items = ids(len);
            let list = Fat::copy_from_slice_in(&items, arena);
            // Neither the contents of unused slots nor inline vs. spilled storage affects equality
            // or the hash.
            let mut inline_items = [TypeId(7); 3];
            let inline = (len <= 3).then(|| {
                inline_items[..items.len()].copy_from_slice(&items);
                Fat::Inline(len as u8, inline_items)
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
    fn short_list_clone_is_independent() {
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
    fn short_list_is_visited_like_its_items() {
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
    fn borrowed_key_mentions_the_same_records_as_the_type() {
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
        // Put the task-local type at each position, in lists short enough to be inline and in lists that spill.
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

    /// Calls `make` twice, each time with a new store that orders by content. `make` creates two types, and on the
    /// first call it's asked to create their components in the opposite order. Returns the two types' order by rank and
    /// by `compare_contents`, after asserting that both orders are the same in both calls and that swapping the
    /// arguments reverses them.
    fn orders_of(
        make: impl Fn(Types<'_, '_>, &Interner<'_>, bool) -> (TypeId, TypeId),
    ) -> [std::cmp::Ordering; 2] {
        let orders = [true, false].map(|is_reversed| {
            let session = Session::new();
            let atoms = Interner::new_in(&session);
            let store = TypeStore::new_in(&session, atoms);
            let own = OwnStore::new_in(session.arena(), &store);
            let types = Types::new(&store, &own);
            let (a, b) = make(types, &atoms, is_reversed);
            assert_ne!(a, b);
            let orders = [types.content_order(a, b), types.compare_contents(a, b)];
            let reverse = [types.content_order(b, a), types.compare_contents(b, a)];
            assert_eq!(orders.map(std::cmp::Ordering::reverse), reverse);
            assert!(orders.iter().all(|order| order.is_ne()));
            orders
        });
        assert_eq!(orders[0], orders[1]);
        orders[0]
    }

    /// Returns `(first(), second())`, but calls `second` first if `is_reversed`.
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
    fn type_sorts_after_its_components() {
        let session = Session::new();
        let store = TypeStore::new_in(&session, Interner::new_in(&session));
        let own = OwnStore::new_in(session.arena(), &store);
        let types = Types::new(&store, &own);
        // Create outer types before inner ones where possible: `keyof keyof number` is created before `keyof string`.
        let keyof_number = types.intern(TypeData::Keyof(TypeId::NUMBER));
        let outer = types.intern(TypeData::Keyof(keyof_number));
        let keyof_string = types.intern(TypeData::Keyof(TypeId::STRING));
        for (part, whole) in [
            (TypeId::NUMBER, keyof_number),
            (keyof_number, outer),
            (TypeId::NUMBER, outer),
            (keyof_string, outer),
        ] {
            assert!(types.content_order(part, whole).is_lt());
            assert!(types.content_order(whole, part).is_gt());
            assert!(types.nesting_order(whole, part).is_gt());
            assert!(types.nesting_order(part, whole).is_lt());
        }
        // Same height.
        assert!(types.nesting_order(keyof_string, keyof_number).is_eq());
        assert!(types.content_order(outer, outer).is_eq());
    }

    #[test]
    fn equal_height_types_sort_by_latest_syntax() {
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
            // Same, with the syntax mentioned indirectly, through a type in the key.
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
    fn keys_differing_in_one_type_sort_like_those_types() {
        fn inner(types: Types<'_, '_>, is_reversed: bool) -> (TypeId, TypeId) {
            both(
                is_reversed,
                || types.intern(TypeData::Keyof(TypeId::STRING)),
                || types.intern(TypeData::Keyof(TypeId::NUMBER)),
            )
        }
        let [inner_order, _] = orders_of(|types, _, is_reversed| inner(types, is_reversed));
        let [_, by_keys] = orders_of(|types, _, is_reversed| {
            let (a, b) = inner(types, is_reversed);
            both(
                !is_reversed,
                || types.intern(TypeData::Keyof(a)),
                || types.intern(TypeData::Keyof(b)),
            )
        });
        assert_eq!(by_keys, inner_order);
    }

    #[test]
    fn atoms_are_ranked_by_their_text() {
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
    fn mapper_rank_ignores_pair_order() {
        orders_of(|types, _, is_reversed| {
            let parameter = |number, mapper| {
                types.intern(TypeData::TypeParam(FileId(0), TypeParamId(number), mapper))
            };
            // A mapper stores its pairs sorted by type parameter id.
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
    fn union_rank_ignores_member_order() {
        let session = Session::new();
        let store = TypeStore::new_in(&session, Interner::new_in(&session));
        let own = OwnStore::new_in(session.arena(), &store);
        let types = Types::new(&store, &own);
        let rank_of = |members: [TypeId; 3]| {
            let members = ShortList::copy_from_slice_in(&members, session.arena());
            members.iter().for_each(|&member| _ = types.rank(member));
            let rank = types.rank_of_type(&(TypeData::Union(members), None));
            rank.map(|rank| (rank.height, rank.content)).ok()
        };
        let [a, b, c] = [TypeId::STRING, TypeId::NUMBER, TypeId::NULL];
        assert_eq!(rank_of([a, b, c]), rank_of([c, a, b]));
        assert_ne!(rank_of([a, b, c]), rank_of([a, b, TypeId::UNDEFINED]));
    }

    fn sharing_store<'s>(session: &'s Session, atoms: Interner<'s>) -> TypeStore<'s> {
        let mut store = TypeStore::new_in(session, atoms);
        store.share_records();
        store
    }

    fn own_store<'s>(
        session: &'s Session,
        store: &TypeStore<'s>,
        sharing: Sharing,
    ) -> OwnStore<'s> {
        let mut own = OwnStore::new_in(session.arena(), store);
        own.set_sharing(sharing);
        own
    }

    #[test]
    fn threads_that_create_the_same_types_get_the_same_ids() {
        const COUNT: usize = 3000;
        let session = Session::new();
        let store = sharing_store(&session, Interner::new_in(&session));
        // Enough types to need more than one reserved id range. Each type is built from the
        // previous one.
        let create = || {
            let own = own_store(&session, &store, Sharing::Publishes);
            let types = Types::new(&store, &own);
            let mut created = vec![TypeId::STRING];
            for at in 0..COUNT {
                created.push(types.intern(TypeData::Keyof(created[at])));
            }
            store.reclaim_ids(&own);
            created
        };
        let all: Vec<Vec<TypeId>> = std::thread::scope(|scope| {
            #[expect(
                clippy::needless_collect,
                reason = "every thread must start before the first join"
            )]
            let threads: Vec<_> = (0..8).map(|_| scope.spawn(create)).collect();
            (threads.into_iter())
                .map(|thread| thread.join().unwrap())
                .collect()
        });
        assert!(all.iter().all(|created| *created == all[0]));
        // No type has a rank yet. Every thread asks for the rank of the last one, which needs all the others.
        let rank_of_last = || {
            let own = own_store(&session, &store, Sharing::Finds);
            let rank = Types::new(&store, &own).rank(all[0][COUNT]);
            (rank.height, rank.last_syntax, rank.content)
        };
        let ranks: Vec<(u32, u64, u64)> = std::thread::scope(|scope| {
            #[expect(
                clippy::needless_collect,
                reason = "every thread must start before the first join"
            )]
            let threads: Vec<_> = (0..8).map(|_| scope.spawn(rank_of_last)).collect();
            (threads.into_iter())
                .map(|thread| thread.join().unwrap())
                .collect()
        });
        assert_eq!(ranks[0].0 as usize, COUNT + 1);
        assert!(ranks.iter().all(|rank| *rank == ranks[0]));
        let own = own_store(&session, &store, Sharing::Finds);
        let types = Types::new(&store, &own);
        for at in 0..COUNT {
            let (operand, ty) = (all[0][at], all[0][at + 1]);
            assert!(!ty.is_local());
            assert!(matches!(*types.get(ty), TypeData::Keyof(it) if it == operand));
            assert_eq!(types.flags(ty), tf::INDEX);
            assert_eq!(types.rank(ty).height as usize, at + 2);
            assert_eq!(types.intern(TypeData::Keyof(operand)), ty);
        }
        assert_eq!(own.created(), [0; 5]);
    }

    #[test]
    fn bound_records_are_not_published() {
        let session = Session::new();
        let store = sharing_store(&session, Interner::new_in(&session));
        let mut own = own_store(&session, &store, Sharing::Publishes);
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
        // Two task-local types and one task-local mapper, plus two published types and one
        // published mapper.
        assert_eq!(own.lengths(), [0, 0, 1, 0, 2]);
        assert_eq!(own.created(), [0, 0, 2, 0, 4]);
    }

    #[test]
    fn task_that_only_finds_keeps_its_records_local() {
        let session = Session::new();
        let store = sharing_store(&session, Interner::new_in(&session));
        let publishing = own_store(&session, &store, Sharing::Publishes);
        let published = Types::new(&store, &publishing).intern(TypeData::Keyof(TypeId::STRING));
        let own = own_store(&session, &store, Sharing::Finds);
        let types = Types::new(&store, &own);
        assert_eq!(types.intern(TypeData::Keyof(TypeId::STRING)), published);
        assert!(types.intern(TypeData::Keyof(TypeId::NUMBER)).is_local());
    }

    #[test]
    fn next_task_reuses_returned_ids() {
        let session = Session::new();
        let store = sharing_store(&session, Interner::new_in(&session));
        let create = |operand: TypeId| {
            let own = own_store(&session, &store, Sharing::Publishes);
            let created = Types::new(&store, &own).intern(TypeData::Keyof(operand));
            store.reclaim_ids(&own);
            created
        };
        let first = create(TypeId::STRING);
        assert_eq!(create(TypeId::NUMBER).0, first.0 + 1);
        assert_eq!(create(TypeId::STRING), first);
        assert_eq!(create(TypeId::BIGINT).0, first.0 + 2);
    }

    #[test]
    fn string_literal_type_and_atom_are_published_immediately() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let store = sharing_store(&session, atoms);
        let create = || {
            let own = own_store(&session, &store, Sharing::Publishes);
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
