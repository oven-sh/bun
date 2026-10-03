//! Types, signatures and type mappers, hash-consed: equal ones have equal ids.
//!
//! An object type records its origin (a declaration, a syntax node, and the mapper for the
//! enclosing type parameters), not its members. The checker resolves the members on demand, once.

use crate::atom::{Atom, Interner};
use crate::hir::{ExprId, FnId, TypeNodeId, TypeParamId};
use crate::local::{Chunked, Found, LOCAL, MaybeLocal};
use crate::program::{FileId, Sym};
use crate::table::ById;
use crate::util::{
    AppendVec, FxHashMap, GrowingPlaces, InParallel, SHARDS, for_each_mut, shard_of, spread_hash,
};
use std::cell::{Cell, UnsafeCell};
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct TypeId(pub u32);
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SigId(pub u32);
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct MapperId(pub u32);
/// An interned list of `IndexComponent`s.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct ComponentsId(pub u32);

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
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ElemFlags: u32 {
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
    pub struct AccessFlags: u8 {
        const INCLUDE_UNDEFINED = 1 << 0;
        const NO_INDEX_SIGNATURES = 1 << 1;
        const WRITING = 1 << 2;
        const ALLOW_MISSING = 1 << 4;
        const EXPRESSION_POSITION = 1 << 5;
        const SUPPRESS_NO_IMPLICIT_ANY_ERROR = 1 << 7;
    }
}

impl ElemFlags {
    /// The name of `TupleElementInfo.labeledDeclaration` is stored in the bits above the flags.
    const LABEL_SHIFT: u32 = 8;

    /// `name` in `[name: T]`. `NONE`: the element has no label.
    #[inline]
    pub fn label(self) -> Atom {
        match self.bits() >> Self::LABEL_SHIFT {
            0 => Atom::NONE,
            label => Atom(label - 1),
        }
    }

    /// The same flags with the label `label`.
    #[inline]
    pub fn with_label(self, label: Atom) -> ElemFlags {
        debug_assert!(!label.is_own(), "a label is a declared name");
        let flags = self.bits() & ((1 << Self::LABEL_SHIFT) - 1);
        if label.is_none() || label.0 >= (u32::MAX >> Self::LABEL_SHIFT) {
            return ElemFlags::from_bits_retain(flags);
        }
        ElemFlags::from_bits_retain(flags | ((label.0 + 1) << Self::LABEL_SHIFT))
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

/// The syntax node or declaration whose type is an anonymous object type.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Origin {
    /// `{ a: T }`
    TypeLiteral(FileId, TypeNodeId),
    /// `{ [K in T]: U }`
    Mapped(FileId, TypeNodeId),
    /// `{ a: 1 }`, as the type of the expression (`ObjectFlagsObjectLiteral`). `checkObjectLiteral` creates a type on every call. The
    /// fields after the node:
    /// 1. `ObjectFlagsJSLiteral`.
    /// 2. The type was created for `getAssignmentDeclarationInitializerType` by `checkExpressionForMutableLocation`, not by
    ///    `checkExpressionCached`.
    /// 3. `CONTAINS_WIDENING_TYPE` and `NON_INFERRABLE_TYPE`, propagated from the member types when the type was created.
    /// 4. `ObjectFlagsFreshLiteral`.
    ObjectLiteral(FileId, ExprId, bool, bool, ObjectFlags, bool),
    /// `getWidenedTypeOfObjectLiteral` of it. The first two fields after the node are the same. The
    /// last one is `ObjectFlagsNonInferrableType`, which widening preserves.
    WidenedLiteral(FileId, ExprId, bool, bool, bool),
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
    /// `originating_import`: the alias `ns`. Each such import creates its own symbol, and so its
    /// own type.
    Namespace {
        module: Sym,
        with_default: bool,
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
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypeArguments {
    /// `createTypeReference`
    Given(Box<[TypeId]>),
    /// `createDeferredTypeReference`
    Deferred(Box<DeferredTypeArguments>),
}

const _: () = assert!(size_of::<TypeArguments>() == 16);

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

impl TypeArguments {
    pub fn deferred(file: FileId, node: TypeNodeId, mapper: MapperId) -> TypeArguments {
        TypeArguments::Deferred(Box::new(DeferredTypeArguments { file, node, mapper }))
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

impl Default for TypeArguments {
    fn default() -> Self {
        TypeArguments::Given(Box::default())
    }
}

impl From<Box<[TypeId]>> for TypeArguments {
    fn from(actual: Box<[TypeId]>) -> Self {
        TypeArguments::Given(actual)
    }
}

impl From<Vec<TypeId>> for TypeArguments {
    fn from(actual: Vec<TypeId>) -> Self {
        TypeArguments::Given(actual.into())
    }
}

impl From<&[TypeId]> for TypeArguments {
    fn from(actual: &[TypeId]) -> Self {
        TypeArguments::Given(actual.into())
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

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypeData {
    Intrinsic(Intrinsic),
    /// The type of a type reference whose name does not resolve
    /// (`getUnresolvedSymbolForEntityName`, `getTypeFromTypeAliasReference`): an intrinsic type
    /// with `TypeFlagsAny` and an alias. `isErrorType` is true for it, it is not `errorType`, and
    /// it is printed as in the source. `name` is the whole entity name, `A.B.C`.
    UnresolvedName {
        name: Atom,
        args: Box<[TypeId]>,
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
    Union(Box<[TypeId]>),
    Intersection(Box<[TypeId]>),
    /// An instance of a class or an interface.
    Ref {
        target: Sym,
        args: TypeArguments,
    },
    Tuple {
        elems: TypeArguments,
        flags: Box<[ElemFlags]>,
        readonly: bool,
    },
    Anon {
        origin: Origin,
        mapper: MapperId,
    },
    /// Function-likes that together are one function value: an expression, a function type, or the overloads of a method.
    Fns {
        decls: Box<[(FileId, FnId)]>,
        mapper: MapperId,
    },
    /// An object type that was computed: a spread, a rest, `Pick<T, K>`.
    Synth(Box<Shape>),
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
        texts: Box<[Atom]>,
        types: Box<[TypeId]>,
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
        /// Without any of these a property is accessible everywhere except through `super`
        /// (`checkPropertyAccessibilityAtLocation`). For accessors the accessor in use decides, so
        /// they are inspected.
        const MAY_BE_OUT_OF_REACH = Self::PRIVATE.bits() | Self::PROTECTED.bits() | Self::ABSTRACT.bits() | Self::ACCESSOR.bits();
    }
}

/// The origin of the type of a property.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum PropSource {
    /// Synthesized: it has no declaration.
    Type(TypeId),
    /// A property of an object literal.
    Literal(FileId, crate::hir::PropId),
    /// A member of a class, an interface or a type literal, a parameter property, an export of a
    /// module or a namespace, a member of an enum, or a property declared by `f.name = value`,
    /// `this.name = value` or `Object.defineProperty(f, "name", descriptor)`. A late bound symbol
    /// is identified by the symbol the binder created for its first declaration.
    Symbol(Sym),
    /// A property of the given intersection: the properties of that name in several of its
    /// constituents. It combines all of them.
    Intersected(TypeId, Box<[Prop]>),
    /// A property of the given mapped type (`containingType`). Its type is the template of that
    /// type instantiated with `Prop::mapper`: the mapper of the mapped type plus its type parameter
    /// mapped to `keyType`. `type_of_mapped_prop` resolves it on demand (`getTypeOfMappedSymbol`).
    /// The flag is `CheckFlagsStripOptional`: `-?` removes `undefined` from the type.
    /// The last field holds the symbols whose `Declarations` it has, those of `modifiersProp`
    /// (`addMemberForKeyTypeWorker`), following the rule of `Copy`.
    /// `None`: it has none.
    Mapped(TypeId, bool, Option<std::sync::Arc<[Prop]>>),
    /// A symbol derived from others (`createSymbolWithType`, `getSpreadSymbol`, `getSpreadType`):
    /// its own type, and the symbols whose `Declarations` it has, concatenated in order. None of
    /// those is synthesized, a copy or `Intersected`. The flag: it also has the `ValueDeclaration`
    /// and the `Parent` of the first. `Checker::copy_of` creates it.
    Copy(TypeId, Box<[Prop]>, bool),
    /// A property of the given reverse mapped type (`CheckFlagsReverseMapped`).
    /// `type_of_reverse_mapped_prop` infers its type on demand (`getTypeOfReverseMappedSymbol`).
    /// The second field holds the symbols whose `Declarations` it has, those of the property of the
    /// source, following the rule of `Copy`. It has no `ValueDeclaration`.
    ReverseMapped(TypeId, Box<[Prop]>),
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct Prop {
    pub name: Atom,
    pub flags: PropFlags,
    pub source: PropSource,
    /// The mapper to instantiate the type from `source` with.
    pub mapper: MapperId,
}

const _: () = assert!(size_of::<Prop>() <= 40);

impl Prop {
    /// The last field of `PropSource::Mapped`.
    pub fn declared_by_modifiers_property(&self) -> &[Prop] {
        match &self.source {
            PropSource::Mapped(_, _, Some(declared)) => declared,
            _ => &[],
        }
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

impl IndexComponent {
    #[inline]
    pub fn file(self) -> FileId {
        match self {
            IndexComponent::Property(file, _) | IndexComponent::Member(file, _) => file,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct IndexInfo {
    pub key: TypeId,
    pub value: TypeId,
    pub readonly: bool,
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
#[derive(Clone, PartialEq, Eq, Hash, Debug, Default)]
pub struct Shape {
    /// `symbol.Declarations[0]` of a synthesized type that preserves the symbol of an object
    /// literal (`getWidenedTypeOfObjectLiteral`), or has the symbol of a binding element
    /// (`getRestType`, when there is an index signature): the file and the position. `CompareTypes`
    /// orders by it.
    pub symbol_declared_at: Option<(FileId, u32)>,
    /// In declaration order, own before inherited.
    pub props: Vec<Prop>,
    pub call: Vec<SigId>,
    pub construct: Vec<SigId>,
    pub index: Vec<IndexInfo>,
    pub literal: Literalness,
    /// For a type that `literal` marks as the type of an expression: `ObjectFlagsFreshLiteral` has
    /// been removed (`getRegularTypeOfObjectLiteral`).
    pub is_regular: bool,
    /// `ObjectFlagsContainsWideningType` for a type `checkObjectLiteral` creates by value: a member
    /// in the source has it, even one that a later spread overrides.
    pub contains_widening_type: bool,
    /// `ObjectFlagsJSLiteral`
    pub is_js_literal: bool,
    /// For a type created by `getInstantiationExpressionType`.
    pub instantiation_expression: Option<InstantiationExpression>,
    /// For a type created by `createDefaultPropertyWrapperForModule`: `originalSymbol`, the module,
    /// which is the `Parent` of its `default`.
    pub default_of: Option<Sym>,
    /// For a type created by `getSpreadType`, which creates a new type on every call: its left and
    /// right operands.
    pub spread_of: Option<(TypeId, TypeId)>,
    /// The number of types the outermost `getSpreadType` had created before this one. `mapType`
    /// iterates over a union of named unions by its origin, which is not the order of
    /// `CompareTypes`.
    pub spread_rank: u32,
    /// For a type created by `getSignatureInstantiation` with `inferredTypeParameters`
    /// (`ObjectFlagsSingleSignatureType`), which creates a new type on every call: the outer type
    /// parameters of the signature's declaration instantiated with `t.mapper`, as a tuple.
    pub single_signature_arguments: Option<TypeId>,
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
    /// (`ObjectFlagsNonInferrableType`). With no members, it is such a function
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
    /// `unknownEmptyObjectType`: the `{}` that `unknown` narrows to when it is neither `null` nor
    /// `undefined`. It has no symbol.
    OfUnknown,
    /// `autoArrayType` where there is no global `Array`. It has no symbol.
    AutoArray,
    /// The type `createEmptyObjectTypeFromStringLiteral` creates for an inference from a string
    /// literal to `keyof T`. It has no symbol.
    OfLiteralKeyof,
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
}

impl Shape {
    pub fn prop(&self, name: Atom) -> Option<&Prop> {
        self.props.iter().find(|p| p.name == name)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SigParam {
    pub name: Atom,
    pub ty: TypeId,
    pub optional: bool,
    pub rest: bool,
    /// `symbol.ValueDeclaration != nil`. A parameter that the checker synthesizes
    /// (`combineUnionOrIntersectionParameters`, `newParameter`) has a name and no declaration.
    pub has_declaration: bool,
}

impl SigParam {
    /// `getNameableDeclarationAtPosition`: the label of a tuple element created from this
    /// parameter. `name` is `NONE` for a pattern (`isValidDeclarationForTupleLabel`).
    #[inline]
    pub fn label(&self) -> Atom {
        if self.has_declaration {
            self.name
        } else {
            Atom::NONE
        }
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum SigData {
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
        type_params: Box<[TypeId]>,
        params: Box<[SigParam]>,
        ret: TypeId,
        this: Option<TypeId>,
        of: Box<[SigId]>,
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
    /// The `ObjectFlags` that are derived from a type's constituents, plus three that are specific
    /// to this checker.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ObjectFlags: u8 {
        /// Exact: it references a type parameter, so instantiation may change it.
        const COULD_CONTAIN_TYPE_VARIABLES = 1;
        /// Is or contains `Unresolved`.
        const HAS_UNRESOLVED = 2;
        /// An intersection, or `ObjectFlagsContainsIntersections`.
        const MAY_BE_REDUCED = 128;
        const HAS_MARKER = 4;
        /// The type implied by a binding pattern counts too.
        const CONTAINS_OBJECT_OR_ARRAY_LITERAL = 8;
        /// Only meaningful without strictNullChecks. The flags of an interned object literal type do not include it:
        /// `Origin::ObjectLiteral` stores it, and `Checker::contains_widening_type` reads it there.
        const CONTAINS_WIDENING_TYPE = 16;
        /// `ObjectFlagsNonInferrableType`. Only stored in `Origin::ObjectLiteral`. `Checker::is_non_inferrable` computes it for
        /// every other type.
        const NON_INFERRABLE_TYPE = 32;
        /// Is or contains a reverse mapped type. `couldContainTypeVariables` is true for every one,
        /// and `instantiateReverseMappedType` instantiates the mapped type it was inferred through,
        /// which references the inferred type parameter. The result is the same type or an
        /// equivalent copy, so `COULD_CONTAIN_TYPE_VARIABLES` is not set for it. But under
        /// `InferenceContext.mapper`, mapping that type parameter fixes it: `fixing_mapper` checks
        /// this flag.
        const HAS_REVERSE_MAPPED = 64;
    }
}

/// Distinguishes two types with the same constituents: it is part of a type's interning key, as in
/// `getUnionKey` and `getAliasKey`. `data` does not include it, so a named union is a
/// `TypeData::Union` of its members like any other.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Default)]
pub struct Provenance {
    /// `Type.alias`
    pub alias: Option<(Sym, Box<[TypeId]>)>,
    /// `UnionType.origin`
    pub origin: UnionOrigin,
    /// `alias` is the enum it is the declared type of: `enumType.flags |= TypeFlagsEnumLiteral`.
    pub is_enum: bool,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum UnionOrigin {
    #[default]
    None,
    /// The named unions it was built from, and its remaining members, in the order of
    /// `CompareTypes`.
    Union(Box<[TypeId]>),
    /// The intersection it is the normal form of.
    Intersection(Box<[TypeId]>),
    /// The `keyof T` it is the keys of.
    Keyof(TypeId),
}

/// The interning key of a type.
type Made = (TypeData, Option<Box<Provenance>>);

pub struct TypeRecord {
    created: Made,
    /// `Type.flags`: `tf`.
    flags: u32,
    object_flags: ObjectFlags,
    /// See `Types::mark_from_type_node`.
    is_from_type_node: AtomicBool,
    /// See `Types::mark_ordered_by_id`.
    is_ordered_by_id: AtomicBool,
    id: TypeId,
}

type MapperRecord = (Mapping, ObjectFlags);

/// The published records of one kind. Read-only during a step: `find` is lock-free and writes
/// nothing. `add` is for the merge step.
struct Interned<V> {
    shards: Box<[GrowingPlaces]>,
    items: AppendVec<V>,
}

impl<V> Interned<V> {
    fn new() -> Self {
        Interned {
            shards: (0..SHARDS).map(|_| GrowingPlaces::default()).collect(),
            items: AppendVec::new(),
        }
    }

    /// `spread`: the hash of the key being looked up.
    #[inline]
    fn find(&self, spread: u64, is_it: impl Fn(&V) -> bool) -> Option<u32> {
        self.shards[shard_of(spread)].find_frozen(spread, |i| is_it(self.items.get(i)))
    }

    /// For `put`.
    fn halves(&self) -> (&[GrowingPlaces], &AppendVec<V>) {
        (&self.shards, &self.items)
    }

    /// Assigns the next id to `item`, which must not be present yet. `spread`: its lookup hash.
    fn add(&self, spread: u64, item: V) -> u32 {
        self.shards[shard_of(spread)].find_or_add(spread, |_| false, || self.items.push(item))
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
#[derive(Default)]
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
    records: Chunked<V>,
    /// Lookup index for the task-local records, and for the published records the task has looked
    /// up before.
    found: Found,
    /// Which records are bound: they reference a node or a symbol of a file that nothing imports,
    /// or a record that does. Never published, so the HIR of such a file can be freed with its
    /// task.
    bound: Bits,
}

impl<V> Default for Own<V> {
    fn default() -> Self {
        Own {
            records: Chunked::default(),
            found: Found::default(),
            bound: Bits::default(),
        }
    }
}

#[derive(Default)]
struct Stores {
    atoms: Own<Box<[u8]>>,
    components: Own<Box<[IndexComponent]>>,
    mappers: Own<MapperRecord>,
    sigs: Own<SigData>,
    types: Own<TypeRecord>,
    /// Every record, in creation order: the kind in the bits above the index. The records a record
    /// references come before it.
    log: Vec<u32>,
    /// The files that the task has visited and that nothing imports, indexed by `FileId`. No other
    /// task can reference a node or a symbol of such a file. Empty: nothing is bound.
    unimported_files: Bits,
}

const KIND_SHIFT: u32 = 29;

/// All task-local records: atoms, lists of index components, mappers, signatures, types. A field of
/// `Task`. No other task sees it. At the end of the task `finish` extracts the records the task
/// publishes, and the rest is dropped with the task.
#[derive(Default)]
pub struct OwnStore {
    stores: UnsafeCell<Stores>,
    /// See `Types::creation_order`.
    has_ordered_by_own_id: Cell<bool>,
    /// See `Types::is_unresolved_name`.
    has_unresolved_names: Cell<bool>,
}

impl OwnStore {
    /// The task is about to visit `file`, which nothing imports. From now on every record that
    /// references `file` is bound.
    pub fn add_unimported_file(&self, file: FileId) {
        // SAFETY: no reference to the stores is in use.
        let stores = unsafe { self.stores_mut() };
        stores.unimported_files.set(file.0 as usize);
    }

    /// Nothing has been created.
    pub fn is_empty(&self) -> bool {
        self.stores().log.is_empty()
    }

    #[inline(always)]
    fn stores(&self) -> &Stores {
        // SAFETY: the task runs on one thread. The stores are only mutated through `stores_mut`, by
        // functions of this file that hold no reference to the stores themselves in the meantime,
        // only to records, which never move.
        unsafe { &*self.stores.get() }
    }

    /// # Safety
    /// No reference from `stores` or from here may be in use, other than to records.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    unsafe fn stores_mut(&self) -> &mut Stores {
        // SAFETY: see above.
        unsafe { &mut *self.stores.get() }
    }

    /// The text of a task-local atom.
    #[inline]
    pub(crate) fn atom_bytes(&self, atom: Atom) -> &[u8] {
        self.stores().atoms.records.get((atom.0 & !LOCAL) as usize)
    }

    /// The task-local atom for `text`, if there is one. `spread`: the hash of `text`.
    #[inline]
    pub(crate) fn find_atom(&self, spread: u64, text: &[u8]) -> Option<Atom> {
        let atoms = &self.stores().atoms;
        let is_it = |id: u32| **atoms.records.get((id & !LOCAL) as usize) == *text;
        atoms.found.find(spread, is_it).map(Atom)
    }

    /// The atom for `text`, which is not published.
    pub(crate) fn intern_atom(&self, spread: u64, text: &[u8]) -> Atom {
        if let Some(atom) = self.find_atom(spread, text) {
            return atom;
        }
        // SAFETY: no reference to the stores is in use.
        let stores = unsafe { self.stores_mut() };
        let index = stores.atoms.records.push(text.into()) as u32;
        stores.log.push((Kind::Atom as u32) << KIND_SHIFT | index);
        stores.atoms.found.add(spread, index | LOCAL);
        Atom(index | LOCAL)
    }
}

/// Accessor for the records of one kind in `Stores`.
type Of<V> = fn(&Stores) -> &Own<V>;
type OfMut<V> = fn(&mut Stores) -> &mut Own<V>;

/// Looks up `key` among the task-local records and the published ones, or else creates a new
/// task-local record.
/// `is_it`: whether a record matches `key`. `make`: builds the record for `key`, and returns
/// whether it is bound.
#[inline]
fn intern_record<V, K>(
    (published, own, kind): (&Interned<V>, &OwnStore, Kind),
    (of, of_mut): (Of<V>, OfMut<V>),
    (spread, key): (u64, K),
    is_it: impl Fn(&V, &K) -> bool,
    make: impl FnOnce(K, u32) -> (V, bool),
) -> u32 {
    let mine = of(own.stores());
    if let Some(id) = mine.found.find(spread, |id| {
        let record = if id & LOCAL == 0 {
            published.items.get(id)
        } else {
            mine.records.get((id & !LOCAL) as usize)
        };
        is_it(record, &key)
    }) {
        return id;
    }
    let id = match published.find(spread, |record| is_it(record, &key)) {
        Some(id) => id,
        None => {
            let index = mine.records.len() as u32;
            let (record, is_bound) = make(key, index | LOCAL);
            // SAFETY: no reference to the stores is in use.
            let stores = unsafe { own.stores_mut() };
            stores.log.push((kind as u32) << KIND_SHIFT | index);
            let mine = of_mut(stores);
            mine.records.push(record);
            if is_bound {
                mine.bound.set(index as usize);
            }
            index | LOCAL
        }
    };
    // SAFETY: no reference to the stores is in use.
    of_mut(unsafe { own.stores_mut() }).found.add(spread, id);
    id
}

pub type Mapping = Box<[(TypeId, TypeId)]>;

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
/// task's `OwnStore`. `link`, at the barrier, is the only writer.
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
pub struct TypeStore {
    types: Interned<TypeRecord>,
    sigs: Interned<SigData>,
    mappers: Interned<MapperRecord>,
    components: Interned<Box<[IndexComponent]>>,
    /// The string literal types, regular and fresh, indexed by their value. There is one for nearly
    /// every string in a program. They are not in the hash index of `types`.
    string_literals: [ById<Atom, TypeId>; 2],
    /// See `Types::is_unresolved_name`.
    has_unresolved_names: AtomicBool,
}

/// The shared store together with the task-local store, which is all that a task sees.
/// `Checker::types` creates one.
#[derive(Copy, Clone)]
pub struct Types<'p> {
    published: &'p TypeStore,
    own: &'p OwnStore,
}

macro_rules! well_known {
    ($($name:ident = $data:expr,)*) => {
        impl TypeId {
            well_known!(@consts 0u32; $($name,)*);
        }
        const WELL_KNOWN: &[TypeData] = &[$($data),*];
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
    /// `{}`
    pub const EMPTY_OBJECT: TypeId = TypeId(WELL_KNOWN.len() as u32 + 1);
    /// `unknownEmptyObjectType`, see `Literalness::OfUnknown`
    pub const UNKNOWN_EMPTY_OBJECT: TypeId = TypeId(WELL_KNOWN.len() as u32 + 2);

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
        )
    }

    /// `TypeFlagsNever`: `neverType`, `silentNeverType`, `unreachableNeverType` or `implicitNeverType`.
    #[inline]
    pub fn is_never(self) -> bool {
        matches!(
            self,
            TypeId::NEVER
                | TypeId::SILENT_NEVER
                | TypeId::UNREACHABLE_NEVER
                | TypeId::IMPLICIT_NEVER
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

impl Default for TypeStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TypeStore {
    pub fn new() -> Self {
        let store = TypeStore {
            types: Interned::new(),
            sigs: Interned::new(),
            mappers: Interned::new(),
            components: Interned::new(),
            string_literals: Default::default(),
            has_unresolved_names: AtomicBool::new(false),
        };
        let publish = |data: TypeData| store.publish_constant(data);
        for (i, data) in WELL_KNOWN.iter().enumerate() {
            assert_eq!(publish(data.clone()).0 as usize, i);
        }
        assert_eq!(
            publish(TypeData::Union(Box::new([TypeId::FALSE, TypeId::TRUE]))),
            TypeId::BOOLEAN
        );
        assert_eq!(
            publish(TypeData::Synth(Box::default())),
            TypeId::EMPTY_OBJECT
        );
        assert_eq!(
            publish(TypeData::Synth(Box::new(Shape {
                literal: Literalness::OfUnknown,
                ..Shape::default()
            }))),
            TypeId::UNKNOWN_EMPTY_OBJECT
        );
        let no_pairs = (Mapping::default(), ObjectFlags::empty());
        assert_eq!(
            store.mappers.add(spread_hash(&Pairs(&[])), no_pairs),
            MapperId::IDENTITY.0
        );
        let no_components: Box<[IndexComponent]> = Box::default();
        assert_eq!(
            (store.components).add(spread_hash(&no_components), no_components),
            ComponentsId::NONE.0
        );
        store
    }

    /// Publishes a type whose id is known to every task of the program. Called before the first
    /// step, on one thread. Everything it references is published.
    pub fn publish_constant(&self, data: TypeData) -> TypeId {
        let created = (data, None);
        let spread = spread_hash(&created);
        if let Some(id) = self.types.find(spread, |record| record.created == created) {
            return TypeId(id);
        }
        let own = OwnStore::default();
        let record = Types::new(self, &own).new_record(created, self.types.items.len());
        TypeId(self.types.add(spread, record))
    }
}

impl<'p> Types<'p> {
    #[inline(always)]
    pub fn new(published: &'p TypeStore, own: &OwnStore) -> Types<'p> {
        // SAFETY: task-local records never move and live as long as the task, and no reference that
        // a task returns outlives it: `finish` takes `&mut OwnStore`. So a reference to a
        // task-local record is returned like one to a published record.
        let own = unsafe { &*std::ptr::from_ref(own) };
        Types { published, own }
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &'p TypeData {
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
                | Intrinsic::ImplicitNever,
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
        self.record(id).flags
    }

    #[inline]
    pub fn object_flags(&self, id: TypeId) -> ObjectFlags {
        self.record(id).object_flags
    }

    #[inline]
    pub fn get_with_flags(&self, id: TypeId) -> (&'p TypeData, ObjectFlags) {
        let record = self.record(id);
        (&record.created.0, record.object_flags)
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
                | Intrinsic::Wildcard => tf::ANY,
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
                | Intrinsic::ImplicitNever => tf::NEVER,
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
            TypeData::Union(members) if members[..] == [TypeId::FALSE, TypeId::TRUE] => {
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
            // `createWideningType`
            TypeData::Intrinsic(Intrinsic::NullWidening | Intrinsic::UndefinedWidening) => {
                ObjectFlags::CONTAINS_WIDENING_TYPE
            }
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
            TypeData::Union(t) | TypeData::Intersection(t) => all(t),
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => match args {
                TypeArguments::Given(actual) => all(actual),
                // `couldContainTypeVariables`: `t.AsTypeReference().node != nil`. `createDeferredTypeReference` sets no propagating
                // flags.
                TypeArguments::Deferred(deferred) => {
                    self.mapper_record(deferred.mapper).1.difference(
                        ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL
                            | ObjectFlags::CONTAINS_WIDENING_TYPE,
                    )
                }
            },
            TypeData::Anon {
                origin: Origin::ObjectLiteral(..),
                mapper,
            } => self.mapper_record(*mapper).1 | ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL,
            // The mapper is omitted at creation unless the origin has enclosing type parameters.
            TypeData::Anon { mapper, .. }
            | TypeData::Fns { mapper, .. }
            | TypeData::Cond { mapper, .. } => self.mapper_record(*mapper).1,
            TypeData::Synth(shape) => {
                let is_plain = matches!(
                    shape.literal,
                    Literalness::No | Literalness::OfUnknown | Literalness::AutoArray
                );
                let mut flags = if is_plain {
                    ObjectFlags::empty()
                } else {
                    ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL
                };
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
                        flags |= of_type;
                    }
                    flags |= self.mapper_record(p.mapper).1;
                }
                for i in &shape.index {
                    flags |= self.object_flags(i.key) | self.object_flags(i.value);
                }
                for &s in shape.call.iter().chain(&shape.construct) {
                    flags |= self.sig_flags(s);
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
                    | (created_with & (ObjectFlags::HAS_UNRESOLVED | ObjectFlags::HAS_MARKER))
                    | ObjectFlags::HAS_REVERSE_MAPPED
            }
            TypeData::IndexedAccess { obj, index, .. } => {
                self.object_flags(*obj) | self.object_flags(*index)
            }
            // `couldContainTypeVariables`: instantiating one resolves it.
            TypeData::Substitution { base, constraint } => {
                self.object_flags(*base)
                    | self.object_flags(*constraint)
                    | ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
            }
            TypeData::Keyof(t) | TypeData::StringMapping { ty: t, .. } => self.object_flags(*t),
            TypeData::Template { types, .. } => all(types),
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
    fn record(&self, id: TypeId) -> &'p TypeRecord {
        if id.0 & LOCAL == 0 {
            self.published.types.items.get(id.0)
        } else {
            (self.own.stores().types.records).get((id.0 & !LOCAL) as usize)
        }
    }

    #[inline(always)]
    fn mapper_record(&self, id: MapperId) -> &'p MapperRecord {
        if id.0 & LOCAL == 0 {
            self.published.mappers.items.get(id.0)
        } else {
            (self.own.stores().mappers.records).get((id.0 & !LOCAL) as usize)
        }
    }

    fn new_record(&self, created: Made, id: u32) -> TypeRecord {
        let data = &created.0;
        let may_be_reduced = match data {
            TypeData::Intersection(_) => true,
            TypeData::Union(members) => members
                .iter()
                .any(|&member| matches!(self.get(member), TypeData::Intersection(_))),
            _ => false,
        };
        let mut flags = self.object_flags_of(data);
        // `getObjectTypeInstantiation`: for a target with alias type arguments no outer type
        // parameter is omitted.
        if !matches!(data, TypeData::Union(_) | TypeData::Intersection(_))
            && let Some((_, type_arguments)) = created.1.as_ref().and_then(|p| p.alias.as_ref())
            && type_arguments.iter().any(|&t| {
                self.object_flags(t)
                    .contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES)
            })
        {
            flags |= ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES;
        }
        // Unlike the others, it is not propagated from the type's constituents.
        flags.set(ObjectFlags::MAY_BE_REDUCED, may_be_reduced);
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
        TypeRecord {
            flags: Self::flags_of(&created),
            object_flags: flags,
            is_from_type_node: AtomicBool::new(false),
            is_ordered_by_id: AtomicBool::new(is_ordered_by_id),
            created,
            id: TypeId(id),
        }
    }

    /// The creation order of `a` and `b`, which is the order of their ids, as in tsgo. For the
    /// places where tsgo compares ids: the final tie-break of `CompareTypes`, `t.id >= lastTypeId`
    /// in `isDeeplyNestedType`, the swap of an identity comparison in `getRelationKey`.
    ///
    /// Between two published types it is final. If either is task-local, it is this task's order:
    /// the merge step may assign the two ids in the opposite order, because one of them may be
    /// merged with the record of a lower task. See `mark_ordered_by_id`.
    #[inline]
    pub fn creation_order(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        if (a.0 | b.0) & LOCAL != 0 {
            self.own.has_ordered_by_own_id.set(true);
        }
        a.0.cmp(&b.0)
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

    pub fn intern(&self, data: TypeData) -> TypeId {
        if let TypeData::StringLit { value, fresh } = data
            && !value.is_own()
            && let Some(id) = self.published.string_literals[usize::from(fresh)].get(&value)
        {
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
        self.intern_new((data, None))
    }

    /// `intern` for a type that has an alias or an origin.
    pub fn intern_with(&self, data: TypeData, provenance: Provenance) -> TypeId {
        if provenance == Provenance::default() {
            return self.intern(data);
        }
        self.intern_new((data, Some(Box::new(provenance))))
    }

    #[inline]
    pub fn provenance(&self, id: TypeId) -> Option<&'p Provenance> {
        self.record(id).created.1.as_deref()
    }

    fn intern_new(&self, created: Made) -> TypeId {
        TypeId(intern_record(
            (&self.published.types, self.own, Kind::Type),
            (|stores| &stores.types, |stores| &mut stores.types),
            (spread_hash(&created), created),
            |record, created| record.created == *created,
            |created, id| {
                if matches!(created.0, TypeData::UnresolvedName { .. }) {
                    self.own.has_unresolved_names.set(true);
                }
                let is_bound = created.is_bound(self.own);
                (self.new_record(created, id), is_bound)
            },
        ))
    }

    /// For `mark_from_type_node`: a lower bound for the id of every type that the task creates from
    /// now on.
    #[inline]
    pub fn first_new_type_id(&self) -> TypeId {
        TypeId(self.own.stores().types.records.len() as u32 | LOCAL)
    }

    /// `ObjectFlagsFromTypeNode`, `ObjectFlagsArrayLiteral`: `id` is the type of a type node or an
    /// array literal. `first_new_type_id` was taken before it was resolved. `createTypeReferenceEx`
    /// sets the flags only on a type that it creates: one that an instantiation created earlier is
    /// unchanged. If two tasks of a step create the type, the record of the lower task is
    /// published, with its flag.
    pub fn mark_from_type_node(&self, id: TypeId, first_new_type_id: TypeId) {
        if id.0 & LOCAL == 0 {
            return;
        }
        // Not tsgo's rule: a bound type gets the flag even if an instantiation created it earlier.
        let index = (id.0 & !LOCAL) as usize;
        if id.0 >= first_new_type_id.0 || self.own.stores().types.bound.has(index) {
            let record = self.record(id);
            record.is_from_type_node.store(true, Ordering::Relaxed);
        }
    }

    #[inline]
    pub fn is_from_type_node(&self, id: TypeId) -> bool {
        self.record(id).is_from_type_node.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn sig(&self, id: SigId) -> &'p SigData {
        if id.0 & LOCAL == 0 {
            self.published.sigs.items.get(id.0)
        } else {
            (self.own.stores().sigs.records).get((id.0 & !LOCAL) as usize)
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

    pub fn intern_sig(&self, mut data: SigData) -> SigId {
        // A clone of a clone takes everything except its return type from the original.
        if let SigData::WithReturn { sig, .. } = &mut data
            && let SigData::WithReturn { sig: inner, .. } = self.sig(*sig)
        {
            *sig = *inner;
        }
        SigId(intern_record(
            (&self.published.sigs, self.own, Kind::Sig),
            (|stores| &stores.sigs, |stores| &mut stores.sigs),
            (spread_hash(&data), data),
            |record, data| record == data,
            |data, _| {
                let is_bound = data.is_bound(self.own);
                (data, is_bound)
            },
        ))
    }

    /// `IndexInfo.components`
    #[inline]
    pub fn components(&self, id: ComponentsId) -> &'p [IndexComponent] {
        if id.0 & LOCAL == 0 {
            &self.published.components.items.get(id.0)[..]
        } else {
            &(self.own.stores().components.records).get((id.0 & !LOCAL) as usize)[..]
        }
    }

    pub fn intern_components(&self, list: &[IndexComponent]) -> ComponentsId {
        if list.is_empty() {
            return ComponentsId::NONE;
        }
        ComponentsId(intern_record(
            (&self.published.components, self.own, Kind::Components),
            (|stores| &stores.components, |stores| &mut stores.components),
            (spread_hash(list), list),
            |record, list| **record == **list,
            |list, _| {
                let list: Box<[IndexComponent]> = list.into();
                let is_bound = list.is_bound(self.own);
                (list, is_bound)
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
            (|stores| &stores.mappers, |stores| &mut stores.mappers),
            (spread_hash(&Pairs(pairs)), pairs),
            |record, pairs| *record.0 == **pairs,
            |pairs, _| {
                let flags =
                    (pairs.iter()).fold(ObjectFlags::empty(), |f, p| f | self.object_flags(p.1));
                let pairs = Mapping::from(pairs);
                let is_bound = pairs.is_bound(self.own);
                ((pairs, flags), is_bound)
            },
        ))
    }

    #[inline]
    pub fn mapping(&self, id: MapperId) -> &'p [(TypeId, TypeId)] {
        &self.mapper_record(id).0
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
        let stores = own.stores();
        if stores.unimported_files.0.is_empty() {
            return false;
        }
        let mut visitor = IsBound {
            stores,
            is_bound: false,
        };
        self.visit(&mut visitor);
        visitor.is_bound
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
    ($name:ident { $($field:ident),* $(,)? }) => {
        impl $crate::types::Follow for $name {
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
    ($name:ident { $($pattern:pat => ($($field:ident),*)),* $(,)? }) => {
        impl $crate::types::Follow for $name {
            fn visit<V: $crate::types::Visitor>(&self, visitor: &mut V) {
                visitor.plain(&std::mem::discriminant(self));
                match self {
                    $($pattern => {
                        $($crate::types::Follow::visit($field, visitor);)*
                    })*
                }
            }
            #[allow(unused_variables)]
            fn follow(&mut self, link: &$crate::types::Link) {
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

impl<T: Follow + Clone> Follow for std::sync::Arc<[T]> {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        self[..].visit(visitor);
    }
    /// It may be shared, so it is recreated if anything in it changes.
    fn follow(&mut self, link: &Link) {
        let mut mentions_own = MentionsOwn(false);
        self.visit(&mut mentions_own);
        if mentions_own.0 {
            let mut followed = self.to_vec();
            followed.follow(link);
            *self = followed.into();
        }
    }
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
    TypeNodeId,
    TypeParamId,
    crate::hir::MemberId,
    crate::hir::PropId,
    Intrinsic,
    StringMappingKind,
    PropFlags,
    ObjectFlags,
    Literalness,
);

/// The label is a declared name, so it is published and needs no remapping
/// (`ElemFlags::with_label`). It is reported as an atom.
impl Follow for ElemFlags {
    #[inline]
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.plain(&self.with_label(Atom::NONE).bits());
        visitor.atom(self.label());
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
    Origin::ObjectLiteral(a, b, c, d, e, f) => (a, b, c, d, e, f),
    Origin::WidenedLiteral(a, b, c, d, e) => (a, b, c, d, e),
    Origin::ClassStatic(a) => (a),
    Origin::Function(a) => (a),
    Origin::EnumObject(a) => (a),
    Origin::Module(a) => (a),
    Origin::Namespace { module, with_default, originating_import } => (module, with_default, originating_import),
    Origin::GlobalThis => (),
});
follow_enum!(UniqueSymbolDeclaration {
    UniqueSymbolDeclaration::Variable(a) => (a),
    UniqueSymbolDeclaration::Member(a, b) => (a, b),
    UniqueSymbolDeclaration::SymbolConstructor => (),
});
follow_enum!(TypeArguments {
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
follow_enum!(TypeData {
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
    TypeData::Cond { file, node, mapper, for_constraint } => (file, node, mapper, for_constraint),
    TypeData::IndexedAccess { obj, index, undefined } => (obj, index, undefined),
    TypeData::Keyof(a) => (a),
    TypeData::Substitution { base, constraint } => (base, constraint),
    TypeData::Template { texts, types } => (texts, types),
    TypeData::StringMapping { kind, ty } => (kind, ty),
});
follow_enum!(PropSource {
    PropSource::Type(a) => (a),
    PropSource::Literal(a, b) => (a, b),
    PropSource::Symbol(a) => (a),
    PropSource::Intersected(a, b) => (a, b),
    PropSource::Mapped(a, b, c) => (a, b, c),
    PropSource::Copy(a, b, c) => (a, b, c),
    PropSource::ReverseMapped(a, b) => (a, b),
});
follow_struct!(Prop {
    name,
    flags,
    source,
    mapper
});
follow_enum!(IndexComponent {
    IndexComponent::Property(a, b) => (a, b),
    IndexComponent::Member(a, b) => (a, b),
});
follow_struct!(IndexInfo {
    key,
    value,
    readonly,
    declaration,
    components
});
follow_enum!(InstantiationExpression {
    InstantiationExpression::Expr(a, b) => (a, b),
    InstantiationExpression::TypeNode(a, b) => (a, b),
});
follow_struct!(Shape {
    symbol_declared_at,
    props,
    call,
    construct,
    index,
    literal,
    is_regular,
    contains_widening_type,
    is_js_literal,
    instantiation_expression,
    default_of,
    spread_of,
    spread_rank,
    single_signature_arguments
});
follow_struct!(SigParam {
    name,
    ty,
    optional,
    rest,
    has_declaration
});
follow_enum!(SigData {
    SigData::Decl { file, func, mapper } => (file, func, mapper),
    SigData::DefaultConstruct { class, base, mapper } => (class, base, mapper),
    SigData::Construct { class, file, func, mapper } => (class, file, func, mapper),
    SigData::Synth { type_params, params, ret, this, of, is_union } => (type_params, params, ret, this, of, is_union),
    SigData::WithReturn { sig, ret } => (sig, ret),
});
follow_struct!(Provenance {
    alias,
    origin,
    is_enum
});
follow_enum!(UnionOrigin {
    UnionOrigin::None => (),
    UnionOrigin::Union(a) => (a),
    UnionOrigin::Intersection(a) => (a),
    UnionOrigin::Keyof(a) => (a),
});

/// See `Follow::is_bound`.
struct IsBound<'a> {
    stores: &'a Stores,
    is_bound: bool,
}

impl Visitor for IsBound<'_> {
    /// An atom is a text. It references nothing.
    #[inline]
    fn atom(&mut self, _: Atom) {}
    #[inline]
    fn components(&mut self, id: ComponentsId) {
        self.is_bound |=
            id.is_local() && self.stores.components.bound.has((id.0 & !LOCAL) as usize);
    }
    #[inline]
    fn mapper(&mut self, id: MapperId) {
        self.is_bound |= id.is_local() && self.stores.mappers.bound.has((id.0 & !LOCAL) as usize);
    }
    #[inline]
    fn sig(&mut self, id: SigId) {
        self.is_bound |= id.is_local() && self.stores.sigs.bound.has((id.0 & !LOCAL) as usize);
    }
    #[inline]
    fn ty(&mut self, id: TypeId) {
        self.is_bound |= id.is_local() && self.stores.types.bound.has((id.0 & !LOCAL) as usize);
    }
    #[inline]
    fn file(&mut self, file: FileId) {
        self.is_bound |= self.stores.unimported_files.has(file.0 as usize);
    }
    #[inline]
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

/// Whether a task-local id is referenced.
struct MentionsOwn(bool);

impl Visitor for MentionsOwn {
    fn atom(&mut self, atom: Atom) {
        self.0 |= atom.is_local();
    }
    fn components(&mut self, id: ComponentsId) {
        self.0 |= id.is_local();
    }
    fn mapper(&mut self, id: MapperId) {
        self.0 |= id.is_local();
    }
    fn sig(&mut self, id: SigId) {
        self.0 |= id.is_local();
    }
    fn ty(&mut self, id: TypeId) {
        self.0 |= id.is_local();
    }
    fn file(&mut self, _: FileId) {}
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

// ───────────────────────────── the end of a task ─────────────────────────────

/// Which task-local records of one task are published. The entries that the task publishes are the
/// roots: `Follow::mark`.
pub struct Marks([Bits; 5]);

impl Marks {
    pub fn new(own: &OwnStore) -> Marks {
        let stores = own.stores();
        Marks([
            Bits::with_len(stores.atoms.records.len()),
            Bits::with_len(stores.components.records.len()),
            Bits::with_len(stores.mappers.records.len()),
            Bits::with_len(stores.sigs.records.len()),
            Bits::with_len(stores.types.records.len()),
        ])
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

    /// Hashes `items` as a set: the result does not depend on their order. `kind`: that of the
    /// record.
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
    match &created.0 {
        data @ TypeData::Union(members) => {
            content.plain(&std::mem::discriminant(data));
            content.unordered(members);
        }
        data => data.visit(&mut content),
    }
    content.plain(&created.1.is_some());
    if let Some(provenance) = &created.1 {
        let Provenance {
            alias,
            origin,
            is_enum,
        } = &**provenance;
        alias.visit(&mut content);
        match origin {
            UnionOrigin::Union(types) => {
                content.plain(&std::mem::discriminant(origin));
                content.unordered(types);
            }
            origin => origin.visit(&mut content),
        }
        is_enum.visit(&mut content);
    }
    content.lanes.0
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
pub struct OwnRecords {
    atoms: Taken<Box<[u8]>>,
    components: Taken<Box<[IndexComponent]>>,
    mappers: Taken<MapperRecord>,
    sigs: Taken<SigData>,
    types: Taken<TypeRecord>,
}

fn take<V>(own: &mut Own<V>, marks: &Bits, hashes: &[ContentHash]) -> Taken<V> {
    let mut taken = Taken {
        len: own.records.len(),
        ..Taken::default()
    };
    own.records.drain(|index, record| {
        if marks.has(index) {
            taken.records.push((index as u32, hashes[index], record));
        }
    });
    *own = Own::default();
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

impl OwnStore {
    /// Runs at the end of the task. `marks`: the records referenced by the entries that the task
    /// publishes. Three passes over the creation log. A record that is not published costs only a
    /// test.
    pub fn finish(&mut self, mut marks: Marks) -> OwnRecords {
        let stores = self.stores.get_mut();
        let entry = |entry: u32| {
            let index = (entry & ((1 << KIND_SHIFT) - 1)) as usize;
            (KINDS[(entry >> KIND_SHIFT) as usize], index)
        };
        // Backwards: the records a record references are older than it.
        for &it in stores.log.iter().rev() {
            let (kind, index) = entry(it);
            if !marks.0[kind as usize].has(index) {
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
        let mut hashes: [Vec<ContentHash>; 5] = [
            vec![[0; 2]; stores.atoms.records.len()],
            vec![[0; 2]; stores.components.records.len()],
            vec![[0; 2]; stores.mappers.records.len()],
            vec![[0; 2]; stores.sigs.records.len()],
            vec![[0; 2]; stores.types.records.len()],
        ];
        for &it in &stores.log {
            let (kind, index) = entry(it);
            if !marks.0[kind as usize].has(index) {
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
            hashes[kind as usize][index] = hash;
        }
        stores.log = Vec::new();
        stores.unimported_files = Bits::default();
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
                    let first = *first.entry(hash).or_insert(place(t, position));
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
/// the merged records, remapped.
fn put<V: Send + Sync>(
    (shards, items): (&[GrowingPlaces], &AppendVec<V>),
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
            added: vec![Vec::new(); SHARDS],
            later: Vec::new(),
        })
        .collect();
    for_each_mut(&mut work, in_parallel, &|it| {
        for (id, _, record) in std::mem::take(&mut it.task.records) {
            let record = match settle(record, it.link, id) {
                Placed::Indexed(record, spread) => {
                    it.added[shard_of(spread)].push((spread, id));
                    record
                }
                Placed::NotIndexed(record) => record,
                Placed::Later(record) => {
                    it.later.push((id, record));
                    continue;
                }
            };
            // SAFETY: the id is in the range that was reserved, and no other record has it.
            unsafe { items.write(id, record) };
        }
    });
    {
        let work = &work;
        in_parallel(SHARDS, &|shard| {
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
fn check_joined<V>(items: &AppendVec<V>, joined: Vec<(u32, V)>, is_same: impl Fn(&V, &V) -> bool) {
    for (id, record) in joined {
        assert!(
            is_same(&record, items.get(id)),
            "two records with one content hash differ"
        );
    }
}

impl TypeStore {
    /// Runs at the barrier, before the tables are published. `tasks`: the records the tasks of the
    /// step publish, in task order. Assigns every record its published id, writes the records into
    /// the shared stores, and returns the `Link` of each task, for `Follow::follow`, and counts.
    /// `sort`: `Checker::sort_types`, for a union whose order depended on task-local ids.
    pub fn link(
        &self,
        atoms: &Interner,
        mut tasks: Vec<OwnRecords>,
        in_parallel: InParallel<'_>,
        sort: &dyn Fn(&mut [TypeId]),
    ) -> (Vec<Link>, LinkCounts) {
        fn of<'a, V>(
            tasks: &'a mut [OwnRecords],
            kind: fn(&mut OwnRecords) -> &mut Taken<V>,
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
                atoms.halves().1.len(),
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
            texts.push((task.atoms, link));
            components.push((task.components, link));
            mappers.push((task.mappers, link));
            sigs.push((task.sigs, link));
            types.push((task.types, link));
        }
        let (_, joined) = put(atoms.halves(), texts, in_parallel, &|text, _, _| {
            let spread = crate::atom::hash_of(&text);
            Placed::Indexed(text, spread)
        });
        check_joined(atoms.halves().1, joined, |a, b| a == b);
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
        check_joined(&self.components.items, joined, |a, b| a == b);
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
        check_joined(&self.mappers.items, joined, |a, b| a == b);
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
        check_joined(&self.sigs.items, joined, |a, b| a == b);
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
            self.types.shards[shard_of(spread)].extend(1, std::iter::once((spread, id)));
        }
        check_joined(&self.types.items, joined, |a, b| a.created == b.created);
        (links, counts)
    }
}
