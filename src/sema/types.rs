//! Types, signatures and type-parameter mappings, hash-consed: equal ones have equal ids.
//!
//! An object type says where it comes from (a declaration, a piece of syntax, and what the type parameters around it
//! stand for), not what is in it. What is in it is asked of the checker, which works it out once.

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
    /// The resolver does not know. Behaves like `any`, and spreads.
    Unresolved,
    Any,
    /// `errorType`: what an expression or a type that is in error has. It has `TypeFlagsAny` and behaves like `any`, except where
    /// `isErrorType` is asked.
    Error,
    /// `autoType`: the declared type of a variable whose type at a place is what control flow finds assigned to it. It has
    /// `TypeFlagsAny`.
    Auto,
    Unknown,
    Never,
    /// `silentNeverType`: the `never` that a reference is narrowed to from the incomplete type of a loop that is being analysed.
    /// It has `TypeFlagsNever`, and what is done to it is `silentNeverType` again and reports nothing.
    SilentNever,
    /// `unreachableNeverType`: what control flow analysis has for a reference past an assignment control does not get to, or past
    /// a call that never returns. It has `TypeFlagsNever`. `getFlowTypeOfReference` turns it into the declared type.
    UnreachableNever,
    /// `implicitNeverType`: what is in `[]` under `strictNullChecks`. It has `TypeFlagsNever`. `isEmptyLiteralType` knows it.
    ImplicitNever,
    Void,
    Undefined,
    /// The `undefined` of a property or an element that is not there. `missingType`
    Missing,
    /// `undefined` written as a type without strictNullChecks: like the plain one, which is then what expressions give
    /// (`undefinedWideningType`), but never widened to `any`. `undefinedType`
    UndefinedDeclared,
    Null,
    /// The same of `null`. `nullType`
    NullDeclared,
    String,
    Number,
    BigInt,
    Symbol,
    /// `object`
    Object,
    /// `intrinsicMarkerType`: what the keyword `intrinsic` is as a type. It has `TypeFlagsAny`.
    IntrinsicMarker,
    /// `wildcardType`: what `getPermissiveInstantiation` puts for a type parameter. It has `TypeFlagsAny`.
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
    /// `TupleElementInfo.labeledDeclaration`, as far as its name goes, is kept above the flags.
    const LABEL_SHIFT: u32 = 8;

    /// `name` in `[name: T]`. `NONE`: the element has no label.
    #[inline]
    pub fn label(self) -> Atom {
        match self.bits() >> Self::LABEL_SHIFT {
            0 => Atom::NONE,
            label => Atom(label - 1),
        }
    }

    /// The same flags, with `label` for a label.
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

/// Syntax or a declaration that an anonymous object type is the type of.
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
    /// `getWidenedTypeOfObjectLiteral` of it. The first two fields after the node are the same. The last one is
    /// `ObjectFlagsNonInferrableType`, which widening keeps.
    WidenedLiteral(FileId, ExprId, bool, bool, bool),
    /// The constructor function of a class, with its static members.
    ClassStatic(Sym),
    /// A function declaration with all its overloads, and the namespace merged with it.
    Function(Sym),
    EnumObject(Sym),
    /// A module or namespace, as a value.
    Module(Sym),
    /// The type of the symbol `cloneTypeAsModuleType` makes for an `import * as ns` that is not the module as it stands
    /// (`resolveESModuleSymbol`): the properties and index signatures of `module` (a module, or what it `export =`s), no call or
    /// construct signatures, and, if `with_default`, over them a `default` that is `module` itself. `originating_import`: the
    /// alias `ns`. Each such import makes a symbol, and so a type, of its own.
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
    /// A property of the global `SymbolConstructor`, which goes by its name alone.
    SymbolConstructor,
}

/// `TypeReference.resolvedTypeArguments`. Whoever wants them asks `Checker::type_arguments` (`getTypeArguments`).
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypeArguments {
    /// `createTypeReference`
    Given(Box<[TypeId]>),
    /// `createDeferredTypeReference`
    Deferred(Box<DeferredTypeArguments>),
}

const _: () = assert!(size_of::<TypeArguments>() == 16);

/// `TypeReference.node` and `mapper`: the reference to a generic class or interface, the array type or the tuple type written at
/// `node`, in the declaration of a type alias, and what the type parameters around the node stand for. What they resolve to is in
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
    pub fn given(&self) -> Option<&[TypeId]> {
        match self {
            TypeArguments::Given(given) => Some(given),
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
    fn from(given: Box<[TypeId]>) -> Self {
        TypeArguments::Given(given)
    }
}

impl From<Vec<TypeId>> for TypeArguments {
    fn from(given: Vec<TypeId>) -> Self {
        TypeArguments::Given(given.into())
    }
}

impl From<&[TypeId]> for TypeArguments {
    fn from(given: &[TypeId]) -> Self {
        TypeArguments::Given(given.into())
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
    /// `getRestrictiveTypeParameter`: the type parameter, extending nothing.
    Restrictive(TypeId),
    /// `createTupleTargetType`: `typeParameters` and `thisType`. All targets share them: nothing but a mapper ever sees them.
    TupleElement(u32),
    TupleThis,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypeData {
    Intrinsic(Intrinsic),
    /// What a reference to a type name that does not resolve has (`getUnresolvedSymbolForEntityName`, `getTypeFromTypeAliasReference`):
    /// an intrinsic type with `TypeFlagsAny` and an alias. `isErrorType` holds for it, it is not `errorType`, and it is printed as
    /// it is written. `name` is the whole entity name, `A.B.C`.
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
    /// `let a = []` on the way to a place where it is read: an array of what has been put in it so far.
    /// Only while control flow is followed; what comes out is an ordinary array.
    EvolvingArray(TypeId),
    /// `UniqueESSymbolType`: the symbol one declaration holds.
    UniqueSymbol {
        symbol: UniqueSymbolDeclaration,
        name: Atom,
    },
    /// With `IDENTITY`, the type parameter as declared. Otherwise that of a signature found in something instantiated
    /// (`cloneTypeParameter`): another type, whose constraint and default are the declared ones with the mapper filled in.
    /// The mapper says what the type parameters around the signature stand for there, and nothing of the signature's own.
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
    /// What `{ [P in keyof T]: X }` (`mapped`) was made from to come out as `source`; `of` is the `T`. Its members are worked
    /// out when asked for. `createReverseMappedType`
    ReverseMapped {
        source: TypeId,
        mapped: TypeId,
        of: TypeId,
    },
    /// `check extends E ? X : Y` that cannot be decided yet.
    Cond {
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        /// `forConstraint` of `getConditionalTypeKey`. `getConditionalType` makes a new type whenever it defers, and
        /// `getConditionalTypeInstantiation` keeps what it returns under the type arguments IT was given: those of a union that is
        /// distributed over, those a tail call began with. These are they, for a type that was made for a constraint, so that it is
        /// the same type as another exactly where it is in tsgo. `IDENTITY`: it was not made for a constraint.
        for_constraint: MapperId,
    },
    IndexedAccess {
        obj: TypeId,
        index: TypeId,
        /// Read in an expression under noUncheckedIndexedAccess: what an index signature gives may be missing.
        /// `AccessFlagsIncludeUndefined`, the one access flag that is kept (`AccessFlagsPersistent`).
        undefined: bool,
    },
    Keyof(TypeId),
    /// `SubstitutionType`: `base`, which is known to be a `constraint`. With the constraint `unknown` it is `NoInfer<base>`.
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
        /// Of a widened object literal: the object literals in its type are widened too.
        const WIDEN = 128;
        /// The name looks like a number but is a string: `{ "0": x }`, the elements of a tuple, a mapped key that is a string
        /// literal. It stands for `nameType` and the name node, which `getLiteralTypeFromProperty` goes by.
        const STRING_NAME = 256;
        /// The `children` property synthesized from the body of a JSX element. The parent of its declaration is the attributes node
        /// (`createJsxAttributesTypeFromAttributesProperty`), so `shouldCheckAsExcessProperty` accepts it like a written attribute,
        /// unlike a property copied by a spread. `jsx_attributes_type` sets it only when the attributes type is fresh.
        const JSX_CHILDREN = 512;
        /// A member of an object literal as `checkObjectLiteral` makes it anew in a check under a pushed contextual type: a symbol with
        /// the type just found and the `ValueDeclaration` of the member. The parent of that is the literal, so
        /// `shouldCheckAsExcessProperty` accepts it, unlike a property a spread brought along, which is a `PropSource::Copy` too.
        const WRITTEN = 1024;
        /// Of an object literal type that is no longer fresh: nor is an object literal that is its type
        /// (`getRegularTypeOfObjectLiteral`, `transformTypeOfMembers`).
        const REGULAR = 2048;
        /// `OPTIONAL`, and yet `undefined` is not added to the type of the symbol: the `?` is on a declaration after
        /// `symbol.ValueDeclaration`, the one `isOptionalDeclaration` is asked about, or on a parameter property, whose type has it.
        const WITHOUT_OPTIONALITY = 4096;
        /// `CheckFlags` of what `createUnionOrIntersectionProperty` makes for a union.
        const READ_PARTIAL = 1 << 13;
        const WRITE_PARTIAL = 1 << 14;
        const HAS_NON_UNIFORM_TYPE = 1 << 15;
        const HAS_LITERAL_TYPE = 1 << 16;
        const ABSTRACT = 1 << 17;
        /// Without any of these a property is within reach from everywhere but through `super`
        /// (`checkPropertyAccessibilityAtLocation`). Of accessors the one in use has the say, so they are looked at.
        const MAY_BE_OUT_OF_REACH = Self::PRIVATE.bits() | Self::PROTECTED.bits() | Self::ABSTRACT.bits() | Self::ACCESSOR.bits();
    }
}

/// Where the type of a property comes from.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum PropSource {
    /// It is made up: nothing declares it.
    Type(TypeId),
    /// A property of an object literal.
    Literal(FileId, crate::hir::PropId),
    /// A member of a class, an interface or a type literal, a parameter property, an export of a module or a namespace, a member of an
    /// enum, what `f.name = value`, `this.name = value` or `Object.defineProperty(f, "name", descriptor)` declare. A late bound symbol
    /// goes by the symbol the binder gave the first of its declarations.
    Symbol(Sym),
    /// Of the intersection given: the properties of that name that several of its members have. It is all of them at once.
    Intersected(TypeId, Box<[Prop]>),
    /// A property of the mapped type given (`containingType`). Its type is the template of that type instantiated with
    /// `Prop::mapper`: the mapper of the mapped type plus its type parameter mapped to `keyType`. `type_of_mapped_prop` resolves it
    /// on demand (`getTypeOfMappedSymbol`). The flag is `CheckFlagsStripOptional`: `-?` removes `undefined` from the type.
    /// Last, the symbols whose `Declarations` it has, those of `modifiersProp` (`addMemberForKeyTypeWorker`), by the rule of `Copy`.
    /// `None`: it has none.
    Mapped(TypeId, bool, Option<std::sync::Arc<[Prop]>>),
    /// A symbol made from others (`createSymbolWithType`, `getSpreadSymbol`, `getSpreadType`): its
    /// own type, and the symbols whose `Declarations` it has, one after the other. None of those is made up, a copy or
    /// `Intersected`. The flag: it has the `ValueDeclaration` and the `Parent` of the first as well. `Checker::copy_of` makes it.
    Copy(TypeId, Box<[Prop]>, bool),
    /// A property of the reverse mapped type given (`CheckFlagsReverseMapped`). `type_of_reverse_mapped_prop` infers its type on demand
    /// (`getTypeOfReverseMappedSymbol`). Then the symbols whose `Declarations` it has, those of the property of the source, by the
    /// rule of `Copy`. It has no `ValueDeclaration`.
    ReverseMapped(TypeId, Box<[Prop]>),
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct Prop {
    pub name: Atom,
    pub flags: PropFlags,
    pub source: PropSource,
    /// What to instantiate the type `source` gives with.
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
    /// The declarations with computed names that it is made from (`getObjectLiteralIndexInfo`): `TypeStore::components`.
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

/// What is in an object type.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Default)]
pub struct Shape {
    /// `symbol.Declarations[0]` of a made-up type that keeps the symbol of an object literal (`getWidenedTypeOfObjectLiteral`), or has
    /// that of a binding element (`getRestType`, where there is an index signature): the file and the position. `CompareTypes`
    /// orders by it.
    pub symbol_declared_at: Option<(FileId, u32)>,
    /// In declaration order, own before inherited.
    pub props: Vec<Prop>,
    pub call: Vec<SigId>,
    pub construct: Vec<SigId>,
    pub index: Vec<IndexInfo>,
    pub literal: Literalness,
    /// Of what `literal` says is of an expression: `ObjectFlagsFreshLiteral` is gone (`getRegularTypeOfObjectLiteral`).
    pub is_regular: bool,
    /// `ObjectFlagsContainsWideningType`, of what `checkObjectLiteral` makes by value: a member that is written has it, be it one that
    /// what is spread after it replaces.
    pub contains_widening_type: bool,
    /// `ObjectFlagsJSLiteral`
    pub is_js_literal: bool,
    /// Of what `getInstantiationExpressionType` makes.
    pub instantiation_expression: Option<InstantiationExpression>,
    /// Of what `createDefaultPropertyWrapperForModule` makes: `originalSymbol`, the module, which is the `Parent` of its `default`.
    pub default_of: Option<Sym>,
    /// Of what `getSpreadType` makes, which is a new type each time: the left and the right it was made of.
    pub spread_of: Option<(TypeId, TypeId)>,
    /// How many types the outermost `getSpreadType` had made before this one. `mapType` goes through a union of named unions by its
    /// origin, which is not the order of `CompareTypes`.
    pub spread_rank: u32,
    /// Of what `getSignatureInstantiation` makes with `inferredTypeParameters` (`ObjectFlagsSingleSignatureType`), which is a new type
    /// each time: the outer type parameters of the declaration of the signature under `t.mapper`, as a tuple.
    pub single_signature_arguments: Option<TypeId>,
}

/// Whether a made-up object type is still the type of an object literal expression, or what else it was made as that tells.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum Literalness {
    #[default]
    No,
    Literal,
    /// With something spread into it: what else it has is not known.
    WithSpread,
    /// The properties written between two spreads, on their way into a `WithSpread`.
    Written,
    /// The attributes of a JSX element. Names with a hyphen in them are nobody's business.
    JsxAttributes,
    /// An object literal looked at without the functions in it that wait for the types of their parameters
    /// (`ObjectFlagsNonInferrableType`). With nothing in it, such a function (`anyFunctionType`); with one call signature and
    /// nothing else, such a function that has no such parameters, kept for what it returns (`returnOnlyType`).
    Partial,
    /// What a binding pattern implies, as what its initializer is expected to be (`patternForType`). No expression has it.
    Pattern,
    /// The same with computed names that are only known when it runs: what else it takes is not known.
    /// `ObjectFlagsObjectLiteralPatternWithComputedProperties`
    PatternWithComputedNames,
    /// What `import()` gives for a module that gets a `default` made up (`getTypeWithSyntheticDefaultImportType`). Its symbol
    /// is a type literal without members, so it counts as `{}` wherever `IsEmptyAnonymousObjectType` is asked, widened or not.
    SyntheticDefault,
    /// `unknownEmptyObjectType`: the `{}` that `unknown` is where it is neither `null` nor `undefined`. It has no symbol.
    OfUnknown,
    /// `autoArrayType` where there is no global `Array`. It has no symbol.
    AutoArray,
    /// What `createEmptyObjectTypeFromStringLiteral` makes for an inference from a string literal to `keyof T`. It has no symbol.
    OfLiteralKeyof,
}

impl Literalness {
    /// Whether it is the type of an object literal expression as it stands, which nothing has been made of yet.
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
    /// `symbol.ValueDeclaration != nil`. A parameter that the checker makes up (`combineUnionOrIntersectionParameters`,
    /// `newParameter`) has a name and no declaration.
    pub has_declaration: bool,
}

impl SigParam {
    /// `getNameableDeclarationAtPosition`: what a tuple element made of this parameter is labelled with. `name` is `NONE` for a
    /// pattern (`isValidDeclarationForTupleLabel`).
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
    /// The constructor a class without one has: `new (...) => instance`.
    /// `base`: the construct signature of the base constructor type that `getDefaultConstructSignatures` cloned, with the type
    /// arguments of the `extends` clause. `None`: the base constructor type has none.
    DefaultConstruct {
        class: Sym,
        base: Option<SigId>,
        mapper: MapperId,
    },
    /// The construct signature of a class made from its constructor `func`.
    Construct {
        class: Sym,
        file: FileId,
        func: FnId,
        mapper: MapperId,
    },
    /// Made up. `this`: what it is to be called on. `of`: first the signature it is a clone of: it is declared where that one is.
    /// With more than one it is `Signature.composite` (`createUnionSignature`, `combineUnionOrIntersectionMemberSignatures`), with
    /// `is_union` for `composite.isUnion`: `ret` is `TypeId::UNRESOLVED`, and `sig_return` resolves it from what they return.
    Synth {
        type_params: Box<[TypeId]>,
        params: Box<[SigParam]>,
        ret: TypeId,
        this: Option<TypeId>,
        of: Box<[SigId]>,
        is_union: bool,
    },
    /// `sig`, but returning `ret`: a construct signature of an intersection with mixin constructors in it (`cloneSignature`
    /// with `resolvedReturnType` set). `sig` is never one of these itself.
    WithReturn { sig: SigId, ret: TypeId },
}

/// `ObjectFlags`, with the values of types.go: between types of different kinds they are the order of `CompareTypes`.
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

    // What is gathered of the members while an intersection is made. The last three use bits the mask leaves out.
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
    /// `ObjectFlags`, those that follow from what the type is made of, and three of ours.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ObjectFlags: u8 {
        /// Exact: it mentions a type parameter, so instantiating it may change it.
        const COULD_CONTAIN_TYPE_VARIABLES = 1;
        /// Is or contains `Unresolved`.
        const HAS_UNRESOLVED = 2;
        /// An intersection, or `ObjectFlagsContainsIntersections`.
        const MAY_BE_REDUCED = 128;
        const HAS_MARKER = 4;
        /// What a binding pattern implies counts too.
        const CONTAINS_OBJECT_OR_ARRAY_LITERAL = 8;
        /// Only meaningful without strictNullChecks. The flags of an interned object literal type do not include it:
        /// `Origin::ObjectLiteral` stores it, and `Checker::contains_widening_type` reads it there.
        const CONTAINS_WIDENING_TYPE = 16;
        /// `ObjectFlagsNonInferrableType`. Only stored in `Origin::ObjectLiteral`. `Checker::is_non_inferrable` computes it for
        /// every other type.
        const NON_INFERRABLE_TYPE = 32;
        /// Is or contains a reverse mapped type. `couldContainTypeVariables` holds of every one, and `instantiateReverseMappedType`
        /// instantiates the mapped type it was inferred through, which mentions the type parameter that was inferred. The result is
        /// the same type or a twin, so `COULD_CONTAIN_TYPE_VARIABLES` is not set for it. But under `InferenceContext.mapper`, mapping
        /// that type parameter FIXES it: `fixing_mapper` asks for this flag.
        const HAS_REVERSE_MAPPED = 64;
    }
}

/// What tells apart two types that are made of the same: it is part of what a type is interned by, as in `getUnionKey` and
/// `getAliasKey`. `data` says nothing of it, so a union that has a name is a `TypeData::Union` of its members like any other.
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
    /// The named unions it was made of, and the rest of its members, in the order of `CompareTypes`.
    Union(Box<[TypeId]>),
    /// The intersection it is the normal form of.
    Intersection(Box<[TypeId]>),
    /// The `keyof T` it is the keys of.
    Keyof(TypeId),
}

/// What a type is interned by.
type Made = (TypeData, Option<Box<Provenance>>);

pub struct TypeRecord {
    made: Made,
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

/// The published records of one kind. Frozen during a step: `find` takes no lock and writes nothing. `add` is for the link step.
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

    /// `spread`: the hash of what is looked for.
    #[inline]
    fn find(&self, spread: u64, is_it: impl Fn(&V) -> bool) -> Option<u32> {
        self.shards[shard_of(spread)].find_frozen(spread, |i| is_it(self.items.get(i)))
    }

    /// For `put`.
    fn halves(&self) -> (&[GrowingPlaces], &AppendVec<V>) {
        (&self.shards, &self.items)
    }

    /// `item`, which is not there yet, gets the next id. `spread`: the hash it is found by.
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

// ───────────────────────────── what a task creates ─────────────────────────────

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

/// The records of one kind that one task has created. Their ids have `LOCAL` set, above the index.
struct Own<V> {
    /// They never move.
    records: Chunked<V>,
    /// Finds the task's own records, and the published ones that it has looked up before.
    found: Found,
    /// Which are BOUND: they mention a node or a symbol of a file that nothing imports, or a record that does. Never published, so the
    /// tree of such a file can be freed with its task.
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
    /// Every record, in creation order: the kind above the index. What a record mentions comes before it.
    log: Vec<u32>,
    /// The files that the task has gone through and that nothing imports, by `FileId`. No other task can mention a node or a symbol of such
    /// a file. Empty: nothing is bound.
    unimported_files: Bits,
}

const KIND_SHIFT: u32 = 29;

/// EVERYTHING THAT ONE TASK HAS CREATED: atoms, lists of index components, mappers, signatures, types. A field of `Task`. No other task
/// sees it. At the end of the task `finish` takes out what the task publishes, and the rest is dropped with the task.
#[derive(Default)]
pub struct OwnStore {
    stores: UnsafeCell<Stores>,
    /// See `Types::creation_order`.
    has_ordered_by_own_id: Cell<bool>,
    /// See `Types::is_unresolved_name`.
    has_unresolved_names: Cell<bool>,
}

impl OwnStore {
    /// The task is about to go through `file`, which nothing imports. From now on whatever mentions `file` is bound.
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
        // SAFETY: the task is on one thread. The stores are only changed through `stores_mut`, by functions of this file that hold no
        // reference to the stores themselves meanwhile, only to records, which stay where they are.
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

    /// The text of an atom of the task.
    #[inline]
    pub(crate) fn atom_bytes(&self, atom: Atom) -> &[u8] {
        self.stores().atoms.records.get((atom.0 & !LOCAL) as usize)
    }

    /// The atom of the task for `text`, if it has one. `spread`: the hash of `text`.
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

/// Where `Stores` has the records of one kind.
type Of<V> = fn(&Stores) -> &Own<V>;
type OfMut<V> = fn(&mut Stores) -> &mut Own<V>;

/// `key` among the task's own records and the published ones, or else as a new record of the task.
/// `is_it`: whether a record is what `key` stands for. `make`: the record for `key`, and whether it is bound.
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

/// What a mapper is found by.
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

/// Whether the type parameters are in the order of their ids, each of them once. That order makes equal sets of pairs intern as one
/// mapper and lets `map` search. The link step sorts the pairs again: `follow` does not keep the order of ids.
#[inline]
fn is_in_order(pairs: &[(TypeId, TypeId)]) -> bool {
    pairs.is_sorted_by(|a, b| a.0.arrival_order() < b.0.arrival_order())
}

/// THE PUBLISHED types, signatures, type mappers and lists of index components. FROZEN DURING A STEP: a lookup takes no lock and writes
/// nothing. What a task creates is in its `OwnStore`. `link`, at the barrier, is the only writer.
///
/// - A record is its interning key and flags computed from the key, so it says nothing about who created it.
/// - PUBLISHED IDS ARE A FUNCTION OF THE PROGRAM: `link` numbers the new records by (task, index in the task's creation order). An own id
///   comes after every published one (`LOCAL`), in the task's creation order. So the order of ids is creation order, as in tsgo.
/// - A NEW RECORD NEVER EQUALS A PUBLISHED ONE. If everything it mentions were published, the lookup would have found it, and something
///   new that it mentions is in no published record. So duplicates exist only between the tasks of one step, and `link` joins them.
/// - Whatever changes the behaviour of a type is in its interning key, or is computed from the key.
pub struct TypeStore {
    types: Interned<TypeRecord>,
    sigs: Interned<SigData>,
    mappers: Interned<MapperRecord>,
    components: Interned<Box<[IndexComponent]>>,
    /// The types of string literals, regular and fresh, by what they say. There is one for nearly every string in a program. They are
    /// not in the hash index of `types`.
    string_literals: [ById<Atom, TypeId>; 2],
    /// See `Types::is_unresolved_name`.
    has_unresolved_names: AtomicBool,
}

/// THE PUBLISHED STORE AND THE TASK'S OWN, which is all that a task sees. `Checker::types` makes one.
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
    UNDEFINED_DECLARED = TypeData::Intrinsic(Intrinsic::UndefinedDeclared),
    NULL = TypeData::Intrinsic(Intrinsic::Null),
    NULL_DECLARED = TypeData::Intrinsic(Intrinsic::NullDeclared),
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
    /// The id as a number, for set operations: sort to deduplicate, binary search for membership. The id types have no `Ord`, so that a
    /// list that is STORED in the order of ids cannot come about unnoticed: `follow` does not keep that order, so the link step has to
    /// sort such a list again. For creation order: `Types::creation_order`.
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

    /// `undefined` and `null` come in kinds that flags, facts and relations do not tell apart: the ordinary one of the kind.
    #[inline]
    pub fn plain(self) -> TypeId {
        match self {
            TypeId::MISSING | TypeId::UNDEFINED_DECLARED => TypeId::UNDEFINED,
            TypeId::NULL_DECLARED => TypeId::NULL,
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

    /// A type that every task of the program knows by its id. BEFORE THE FIRST STEP, on one thread. What it mentions is published.
    pub fn publish_constant(&self, data: TypeData) -> TypeId {
        let made = (data, None);
        let spread = spread_hash(&made);
        if let Some(id) = self.types.find(spread, |record| record.made == made) {
            return TypeId(id);
        }
        let own = OwnStore::default();
        let record = Types::new(self, &own).new_record(made, self.types.items.len());
        TypeId(self.types.add(spread, record))
    }
}

impl<'p> Types<'p> {
    #[inline(always)]
    pub fn new(published: &'p TypeStore, own: &OwnStore) -> Types<'p> {
        // SAFETY: the records of a task never move and live as long as the task, and nothing that a task hands out outlives it: `finish`
        // takes `&mut OwnStore`. So a reference to an own record is handed out like one to a published record.
        let own = unsafe { &*std::ptr::from_ref(own) };
        Types { published, own }
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &'p TypeData {
        &self.record(id).made.0
    }

    /// `t.AsTypeReference().node != nil`: what the deferred type reference `id` is made of, resolved or not.
    #[inline]
    pub fn deferred(&self, id: TypeId) -> Option<&'p DeferredTypeArguments> {
        match self.get(id) {
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => args.as_deferred(),
            _ => None,
        }
    }

    /// The members of a union, nothing for `never`, and any other type on its own.
    #[inline]
    pub fn parts(&self, id: TypeId) -> &'p [TypeId] {
        let record = self.record(id);
        match &record.made.0 {
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

    /// Most programs have no `TypeData::UnresolvedName`, which is known without a look at the type.
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
        (&record.made.0, record.object_flags)
    }

    /// `Type.flags`
    fn flags_of(made: &Made) -> u32 {
        match &made.0 {
            TypeData::UnresolvedName { .. } => tf::ANY,
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::Unresolved
                | Intrinsic::Any
                | Intrinsic::Error
                | Intrinsic::Auto
                | Intrinsic::IntrinsicMarker
                | Intrinsic::Wildcard => tf::ANY,
                Intrinsic::Unknown => tf::UNKNOWN,
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedDeclared => {
                    tf::UNDEFINED
                }
                Intrinsic::Null | Intrinsic::NullDeclared => tf::NULL,
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
            TypeData::Union(_) if made.1.as_ref().is_some_and(|p| p.is_enum) => {
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
            TypeData::Intrinsic(Intrinsic::Null | Intrinsic::Undefined) => {
                ObjectFlags::CONTAINS_WIDENING_TYPE
            }
            // One whose constraint rests on something unknown says so. A marker in there does not show:
            // `reportUnreliableMapper` is asked about the parameter, not about what is in its mapper.
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
            // `instantiateType` leaves what has `TypeFlagsAny` as it is, whatever its alias type arguments are.
            TypeData::UnresolvedName { .. } => ObjectFlags::empty(),
            TypeData::Union(t) | TypeData::Intersection(t) => all(t),
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => match args {
                TypeArguments::Given(given) => all(given),
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
            // Whoever makes one leaves the mapper out unless there are type parameters around the origin.
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
            // `mapped` and `of` always mention the parameter that was inferred, which does not make what was inferred generic.
            // Instantiating one whose source stays the same gives itself, or a twin with the same members
            // (`instantiateReverseMappedType`). What is unknown in them makes its members unknown, and a marker in them is met on
            // the way.
            TypeData::ReverseMapped { source, mapped, of } => {
                let made_with = self.object_flags(*mapped) | self.object_flags(*of);
                self.object_flags(*source)
                    | (made_with & (ObjectFlags::HAS_UNRESOLVED | ObjectFlags::HAS_MARKER))
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

    fn new_record(&self, made: Made, id: u32) -> TypeRecord {
        let data = &made.0;
        let may_be_reduced = match data {
            TypeData::Intersection(_) => true,
            TypeData::Union(members) => members
                .iter()
                .any(|&member| matches!(self.get(member), TypeData::Intersection(_))),
            _ => false,
        };
        let mut flags = self.object_flags_of(data);
        // `getObjectTypeInstantiation`: of a target with alias type arguments no outer type parameter is left out.
        if !matches!(data, TypeData::Union(_) | TypeData::Intersection(_))
            && let Some((_, type_arguments)) = made.1.as_ref().and_then(|p| p.alias.as_ref())
            && type_arguments.iter().any(|&t| {
                self.object_flags(t)
                    .contains(ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES)
            })
        {
            flags |= ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES;
        }
        // Unlike the others, it is not handed on by what the type is made of.
        flags.set(ObjectFlags::MAY_BE_REDUCED, may_be_reduced);
        // See `mark_ordered_by_id`.
        let has_ordered_by_id = |list: &[TypeId]| {
            let is_ordered_by_id =
                |t: &TypeId| self.record(*t).is_ordered_by_id.load(Ordering::Relaxed);
            list.iter().any(|t| t.is_local() && is_ordered_by_id(t))
        };
        let is_ordered_by_id = matches!(data, TypeData::Union(members) if has_ordered_by_id(members))
            || matches!(
                made.1.as_deref(),
                Some(Provenance { origin: UnionOrigin::Union(types), .. }) if has_ordered_by_id(types)
            );
        TypeRecord {
            flags: Self::flags_of(&made),
            object_flags: flags,
            is_from_type_node: AtomicBool::new(false),
            is_ordered_by_id: AtomicBool::new(is_ordered_by_id),
            made,
            id: TypeId(id),
        }
    }

    /// The order in which `a` and `b` were created, which is the order of their ids, as in tsgo. For what tsgo reads off its ids: the last
    /// resort of `CompareTypes`, `t.id >= lastTypeId` in `isDeeplyNestedType`, the swap of an identity comparison in `getRelationKey`.
    ///
    /// Between two published types it is final. With an own type in it, it is this task's order: the link step may give the two ids in
    /// the other order, because one of them may be joined with the record of a lower task. See `mark_ordered_by_id`.
    #[inline]
    pub fn creation_order(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        if (a.0 | b.0) & LOCAL != 0 {
            self.own.has_ordered_by_own_id.set(true);
        }
        a.0.cmp(&b.0)
    }

    /// Whether `creation_order` has been asked about an own type since this was last called.
    #[inline]
    pub fn take_has_ordered_by_own_id(&self) -> bool {
        self.own.has_ordered_by_own_id.replace(false)
    }

    /// Where `id` stands among the members of a union has been decided with the help of `creation_order` of own types. Every union that is
    /// created with such a member, however it is created, gets the mark too (`new_record`), and the link step sorts its members and
    /// its origin again, by the published ids.
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
        // `getFreshTypeOfLiteralType` makes the fresh type from the regular one, and bigint literal types are ordered by creation.
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
            self.intern_made((regular, None));
        }
        self.intern_made((data, None))
    }

    /// `intern` of a type that has an alias or an origin.
    pub fn intern_with(&self, data: TypeData, provenance: Provenance) -> TypeId {
        if provenance == Provenance::default() {
            return self.intern(data);
        }
        self.intern_made((data, Some(Box::new(provenance))))
    }

    #[inline]
    pub fn provenance(&self, id: TypeId) -> Option<&'p Provenance> {
        self.record(id).made.1.as_deref()
    }

    fn intern_made(&self, made: Made) -> TypeId {
        TypeId(intern_record(
            (&self.published.types, self.own, Kind::Type),
            (|stores| &stores.types, |stores| &mut stores.types),
            (spread_hash(&made), made),
            |record, made| record.made == *made,
            |made, id| {
                if matches!(made.0, TypeData::UnresolvedName { .. }) {
                    self.own.has_unresolved_names.set(true);
                }
                let is_bound = made.is_bound(self.own);
                (self.new_record(made, id), is_bound)
            },
        ))
    }

    /// For `mark_from_type_node`: every type that the task creates from now on has an id that is not below this.
    #[inline]
    pub fn made_before(&self) -> TypeId {
        TypeId(self.own.stores().types.records.len() as u32 | LOCAL)
    }

    /// `ObjectFlagsFromTypeNode`, `ObjectFlagsArrayLiteral`: `id` is the type of a type node or an array literal. `made_before` is from
    /// before it was resolved. `createTypeReferenceEx` sets the flags only on a type that it creates: one that an instantiation created
    /// earlier stays as it is. Where two tasks of a step create the type, the record of the lower task is published, with its flag.
    pub fn mark_from_type_node(&self, id: TypeId, made_before: TypeId) {
        if id.0 & LOCAL == 0 {
            return;
        }
        // NOT tsgo's rule: a type that is bound gets the flag even if an instantiation created it earlier.
        let index = (id.0 & !LOCAL) as usize;
        if id.0 >= made_before.0 || self.own.stores().types.bound.has(index) {
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

    /// The signature `sig` is a clone of, all the way down: the one to ask for the declaration (`Signature.declaration`).
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
        // A clone of a clone has everything but what it returns from the first.
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

    /// `pairs` need not be sorted. A parameter mapped to itself stays: it says that the origin depends on it.
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

    /// The same of pairs that are somebody else's. Nothing is allocated for pairs in order whose mapper is there already.
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

// ───────────────────────────── what mentions what: `visit` and `follow` ─────────────────────────────

/// What `Follow::visit` shows of a value: every id, every file, and everything else as something to hash.
pub trait Visitor {
    fn atom(&mut self, atom: Atom);
    fn components(&mut self, id: ComponentsId);
    fn mapper(&mut self, id: MapperId);
    fn sig(&mut self, id: SigId);
    fn ty(&mut self, id: TypeId);
    /// A node or a symbol of `file` is mentioned.
    fn file(&mut self, file: FileId);
    fn plain<T: Hash + ?Sized>(&mut self, value: &T);
}

/// What can mention an atom, a list of index components, a mapper, a signature or a type: the data of a record, a key or a value of a
/// table. Each type is described ONCE, by `follow_struct!` or `follow_enum!`, with every field named: a new field is a compile error.
pub trait Follow {
    fn visit<V: Visitor>(&self, visitor: &mut V);

    /// Replaces every own id (`LOCAL`) by the published id that the link step has given its record. At the barrier, on any thread.
    fn follow(&mut self, link: &Link);

    /// Whether it mentions a node or a symbol of a file that nothing imports, or an own record that does. Such a thing is never published.
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

    /// Marks the own records that it mentions. `OwnStore::finish` adds what those mention.
    #[inline]
    fn mark(&self, marks: &mut Marks) {
        self.visit(marks);
    }
}

/// For types that mention nothing: `visit` shows the whole value as something to hash.
macro_rules! follows_nothing {
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
pub(crate) use follows_nothing;

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
    /// It may be shared, so it is made anew if anything in it changes.
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

follows_nothing!(
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

/// The label is a declared name, so it is published and follows nothing (`ElemFlags::with_label`). It is shown as an atom.
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
    /// An atom is a text. It mentions nothing.
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

/// Whether an own id is mentioned.
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

/// Which own records of ONE task are published. The entries that the task publishes are the roots: `Follow::mark`.
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

/// 128 bits that stand for what a record is made of, whichever task made it.
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

/// Computes the content hash of one record. A published id counts as its number, an own id as the content hash of its record.
struct Content<'a> {
    lanes: Lanes,
    /// By kind and index. What a record mentions is older, so it has its hash.
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

    /// `items` as a set: in whatever order they are, the result is the same. `kind`: that of the record.
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

/// The content hash of a type. A union is a set, and so is an origin that is a union: two tasks may have sorted members that tie in
/// `compare_types` differently. See `Types::mark_ordered_by_id`.
fn content_of_type(made: &Made, of: &[Vec<ContentHash>; 5]) -> ContentHash {
    let mut content = Content::new(of, Kind::Type);
    match &made.0 {
        data @ TypeData::Union(members) => {
            content.plain(&std::mem::discriminant(data));
            content.unordered(members);
        }
        data => data.visit(&mut content),
    }
    content.plain(&made.1.is_some());
    if let Some(provenance) = &made.1 {
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

/// Into how many parts the link step divides the records by their content hash. One thread groups the records of one part.
const HASH_PARTS: usize = 64;

/// A step that publishes fewer records than this is linked on one thread.
const FEW_RECORDS: usize = 4096;

/// The published records of one kind and one task.
struct Taken<V> {
    /// How many records of the kind the task had: the length of its link.
    len: usize,
    /// The index in the task's store, the content hash, the record. In creation order.
    records: Vec<(u32, ContentHash, V)>,
    /// The positions in `records`, by the part of the hash, in order within a part.
    positions: Vec<u32>,
    /// Where in `positions` each part begins, and where the last ends.
    parts: [u32; HASH_PARTS + 1],
    /// IN A DEBUG BUILD, after `number`: the records that were joined with another, with the id of that one. See `check_joined`.
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

/// WHAT ONE TASK PUBLISHES of what it has created. A field of `Finished`.
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
    /// AT THE END OF THE TASK. `marks`: what the entries that the task publishes mention. Three passes over the creation log, and a
    /// record that is not published costs nothing but a test.
    pub fn finish(&mut self, mut marks: Marks) -> OwnRecords {
        let stores = self.stores.get_mut();
        let entry = |entry: u32| {
            let index = (entry & ((1 << KIND_SHIFT) - 1)) as usize;
            (KINDS[(entry >> KIND_SHIFT) as usize], index)
        };
        // Backwards: what a record mentions is older than the record.
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
                Kind::Type => stores.types.records.get(index).made.visit(&mut marks),
            }
        }
        // Forwards: what a record mentions has its hash.
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
                Kind::Type => content_of_type(&stores.types.records.get(index).made, &hashes),
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

// ───────────────────────────── the link step ─────────────────────────────

/// For ONE task: the published id of each of its own records, by index. `u32::MAX`: the record is not published.
#[derive(Default)]
pub struct Link {
    atoms: Box<[u32]>,
    components: Box<[u32]>,
    mappers: Box<[u32]>,
    sigs: Box<[u32]>,
    types: Box<[u32]>,
}

/// What one link step has done, by kind.
#[derive(Copy, Clone, Default)]
pub struct LinkCounts {
    /// How many records the tasks of the step publish, before any are joined.
    pub linked: [usize; KINDS.len()],
    /// How many of them were joined with the record of a lower task.
    pub joined: [usize; KINDS.len()],
}

impl LinkCounts {
    pub const NAMES: [&str; KINDS.len()] =
        ["atoms", "components", "mappers", "signatures", "types"];
}

/// GROUP, NUMBER, LINK, for one kind. `tasks` in task order. Of the records that have one content hash the one with the lowest
/// (task, index) stays, and those that stay are numbered from `first_free` on, in that order. Returns the link of each task for the
/// kind. Afterwards `records` holds the records that stay, with the new id in place of the index.
/// No stage depends on timing: a part of the hashes, or a task, is one thread's alone.
fn number<V: Send + Sync>(
    tasks: &mut [&mut Taken<V>],
    first_free: u32,
    in_parallel: InParallel<'_>,
) -> Vec<Box<[u32]>> {
    // Nothing that is published mentions an own record of the kind.
    if tasks.iter().all(|task| task.records.is_empty()) {
        return tasks.iter().map(|_| Box::default()).collect();
    }
    let place = |task: usize, position: usize| (task as u64) << 32 | position as u64;
    // GROUP: for each record, the place of the first record with its hash.
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
    // NUMBER: the rank of each record that stays among those of its task, then where the ids of each task begin.
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

/// What `put` is to do with a record, which has been followed.
enum Placed<V> {
    /// It is found by this hash.
    Indexed(V, u64),
    /// It is found in some other way.
    NotIndexed(V),
    /// It cannot be finished before the others are in place.
    Later(V),
}

/// FOLLOW, for one kind: puts the records that stay into the published store, at their ids. Returns those that are `Later`, in the order
/// of their ids: the caller writes them. With them, for `check_joined`, the records that were joined, followed.
fn put<V: Send + Sync>(
    (shards, items): (&[GrowingPlaces], &AppendVec<V>),
    tasks: Vec<(Taken<V>, &Link)>,
    in_parallel: InParallel<'_>,
    settle: &(dyn Fn(V, &Link, u32) -> Placed<V> + Sync),
) -> (Vec<(u32, V)>, Vec<(u32, V)>) {
    struct Work<'a, V> {
        task: Taken<V>,
        link: &'a Link,
        /// What goes into the index, by shard.
        added: Vec<Vec<(u64, u32)>>,
        later: Vec<(u32, V)>,
    }
    let count: usize = tasks.iter().map(|(task, _)| task.records.len()).sum();
    if count == 0 {
        return (Vec::new(), Vec::new());
    }
    // SAFETY: every id that `number` has given out is written below, or by the caller if it is `Later`.
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

/// IN A DEBUG BUILD: a record that was joined with another is the same as that one. Otherwise two contents have one content hash.
fn check_joined<V>(items: &AppendVec<V>, joined: Vec<(u32, V)>, is_same: impl Fn(&V, &V) -> bool) {
    for (id, record) in joined {
        assert!(
            is_same(&record, items.get(id)),
            "two records with one content hash differ"
        );
    }
}

impl TypeStore {
    /// AT THE BARRIER, before the tables are published. `tasks`: what the tasks of the step publish, in task order. Gives every record
    /// its published id, puts the records into the published stores, and returns the link of each task, for `Follow::follow`, and counts.
    /// `sort`: `Checker::sort_types`, for a union whose order rested on own ids.
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
        // Handing a stage to the pool costs more than the stage. The ids are the same: no stage depends on who runs it.
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
        // `number` has left the records that stay.
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
                record.made.follow(link);
                record.id = TypeId(id);
                if matches!(record.made.0, TypeData::UnresolvedName { .. }) {
                    self.has_unresolved_names.store(true, Ordering::Relaxed);
                }
                if *record.is_ordered_by_id.get_mut() {
                    return Placed::Later(record);
                }
                match record.made {
                    (TypeData::StringLit { value, fresh }, None) => {
                        self.string_literals[usize::from(fresh)].insert(value, TypeId(id));
                        Placed::NotIndexed(record)
                    }
                    _ => {
                        let spread = spread_hash(&record.made);
                        Placed::Indexed(record, spread)
                    }
                }
            },
        );
        // On one thread, by ascending id: what such a union is made of is in place, and `sort` looks at it.
        for (id, mut record) in later {
            *record.is_ordered_by_id.get_mut() = false;
            if let TypeData::Union(members) = &mut record.made.0 {
                sort(members);
            }
            if let Some(provenance) = &mut record.made.1
                && let UnionOrigin::Union(types) = &mut provenance.origin
            {
                sort(types);
            }
            let spread = spread_hash(&record.made);
            // SAFETY: `put` has reserved the id and left it to be written here.
            unsafe { self.types.items.write(id, record) };
            self.types.shards[shard_of(spread)].extend(1, std::iter::once((spread, id)));
        }
        check_joined(&self.types.items, joined, |a, b| a.made == b.made);
        (links, counts)
    }
}
