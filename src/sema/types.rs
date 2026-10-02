//! Types, signatures and type-parameter mappings, hash-consed: equal ones have equal ids, whichever thread made them.
//!
//! An object type says where it comes from (a declaration, a piece of syntax, and what the type parameters around it
//! stand for), not what is in it. What is in it is asked of the checker, which works it out once.

use crate::atom::Atom;
use crate::hir::{ExprId, FnId, TypeNodeId, TypeParamId};
use crate::local::{self, Chunked, Found, LOCAL, MaybeLocal};
use crate::program::{FileId, Sym};
use crate::table::ById;
use crate::util::{AppendVec, GrowingPlaces, SHARDS, shard_of, spread_hash};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct TypeId(pub u32);
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct SigId(pub u32);
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct MapperId(pub u32);
/// An interned list of `IndexComponent`s.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
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
    /// `{ a: 1 }`, as the type of the expression: known to have nothing but what is written (`ObjectFlagsObjectLiteral`). The
    /// third: `ObjectFlagsJSLiteral`. The last: `ObjectFlagsFreshLiteral`. `checkObjectLiteral` makes a type each time it is called.
    /// The fourth: not the one `checkExpressionCached` keeps, but the one `getAssignmentDeclarationInitializerType` gets from
    /// `checkExpressionForMutableLocation`.
    ObjectLiteral(FileId, ExprId, bool, bool, bool),
    /// The same once it is the type of a variable, a result, a type argument: an ordinary object type.
    WidenedLiteral(FileId, ExprId, bool, bool),
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

impl UniqueSymbolDeclaration {
    fn file(self) -> Option<FileId> {
        match self {
            Self::Variable(variable) => Some(variable.file),
            Self::Member(file, _) => Some(file),
            Self::SymbolConstructor => None,
        }
    }
}

/// `TypeReference.resolvedTypeArguments`. Whoever wants them asks `Checker::type_arguments` (`getTypeArguments`).
#[derive(Clone, Debug)]
pub enum TypeArguments {
    /// `createTypeReference`
    Given(Box<[TypeId]>),
    /// `createDeferredTypeReference`
    Deferred(Box<DeferredTypeArguments>),
}

const _: () = assert!(size_of::<TypeArguments>() == 16);

/// `TypeReference.node` and `mapper`: the reference to a generic class or interface, the array type or the tuple type written at
/// `node`, in the declaration of a type alias, and what the type parameters around the node stand for. It is interned by these.
#[derive(Clone, Debug)]
pub struct DeferredTypeArguments {
    pub file: FileId,
    pub node: TypeNodeId,
    pub mapper: MapperId,
    resolved: OnceLock<Box<[TypeId]>>,
}

impl DeferredTypeArguments {
    #[inline]
    pub fn is_resolved(&self) -> bool {
        self.resolved.get().is_some()
    }

    #[inline]
    fn key(&self) -> (FileId, TypeNodeId, MapperId) {
        (self.file, self.node, self.mapper)
    }
}

impl TypeArguments {
    pub fn deferred(file: FileId, node: TypeNodeId, mapper: MapperId) -> TypeArguments {
        TypeArguments::Deferred(Box::new(DeferredTypeArguments {
            file,
            node,
            mapper,
            resolved: OnceLock::new(),
        }))
    }

    /// They, if they are there.
    #[inline]
    pub fn resolved(&self) -> Option<&[TypeId]> {
        match self {
            TypeArguments::Given(given) => Some(given),
            TypeArguments::Deferred(deferred) => {
                deferred.resolved.get().map(|resolved| &resolved[..])
            }
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

impl PartialEq for TypeArguments {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (TypeArguments::Given(a), TypeArguments::Given(b)) => a == b,
            (TypeArguments::Deferred(a), TypeArguments::Deferred(b)) => a.key() == b.key(),
            _ => false,
        }
    }
}

impl Eq for TypeArguments {}

impl std::hash::Hash for TypeArguments {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        match self {
            TypeArguments::Given(given) => std::hash::Hash::hash(given, state),
            TypeArguments::Deferred(deferred) => std::hash::Hash::hash(&deferred.key(), state),
        }
    }
}

/// A type parameter that has no declaration.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
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
        /// `CheckFlags` of what `createUnionOrIntersectionProperty` makes for a union.
        const READ_PARTIAL = 1 << 13;
        const WRITE_PARTIAL = 1 << 14;
        const HAS_NON_UNIFORM_TYPE = 1 << 15;
        const HAS_LITERAL_TYPE = 1 << 16;
    }
}

/// The members that declare a property. Mostly it is one.
#[derive(Clone, Debug)]
pub enum MemberList {
    One((FileId, crate::hir::MemberId)),
    /// Not one.
    Many(Box<[(FileId, crate::hir::MemberId)]>),
}

impl std::ops::Deref for MemberList {
    type Target = [(FileId, crate::hir::MemberId)];
    #[inline]
    fn deref(&self) -> &Self::Target {
        match self {
            MemberList::One(one) => std::slice::from_ref(one),
            MemberList::Many(many) => many,
        }
    }
}

impl From<Vec<(FileId, crate::hir::MemberId)>> for MemberList {
    fn from(list: Vec<(FileId, crate::hir::MemberId)>) -> MemberList {
        if let [one] = list[..] {
            return MemberList::One(one);
        }
        MemberList::Many(list.into_boxed_slice())
    }
}

impl PartialEq for MemberList {
    #[inline]
    fn eq(&self, other: &MemberList) -> bool {
        **self == **other
    }
}

impl Eq for MemberList {}

impl std::hash::Hash for MemberList {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        (**self).hash(state);
    }
}

/// Where the type of a property comes from.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum PropSource {
    /// It is made up: nothing declares it.
    Type(TypeId),
    /// Members of classes, interfaces and type literals that declare it: overloads, a getter and a setter, merged declarations.
    Members(MemberList),
    /// A constructor parameter with a modifier.
    Parameter(FileId, crate::hir::ParamId),
    /// A property of an object literal.
    Literal(FileId, crate::hir::PropId),
    /// An export of a module or a namespace, a static side of an enum.
    Symbol(Sym),
    /// The assignment declarations that declare it: `f.name = value`, `this.name = value`,
    /// `Object.defineProperty(f, "name", descriptor)`. The first one is `symbol.ValueDeclaration`.
    Assigned(FileId, Box<[ExprId]>),
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
    /// Made up. `this`: what it is to be called on. `of`: of the signature of a union, the signatures of the members that it
    /// stands for (`Signature.composite`), first the one it is a clone of: it is declared where that one is
    /// (`createUnionSignature`, `combineUnionOrIntersectionMemberSignatures`).
    Synth {
        type_params: Box<[TypeId]>,
        params: Box<[SigParam]>,
        ret: TypeId,
        this: Option<TypeId>,
        of: Box<[SigId]>,
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
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
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
        /// It only counts without strictNullChecks. An object literal does not say it of its members.
        const CONTAINS_WIDENING_TYPE = 16;
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

impl Provenance {
    fn is_local(&self, file: FileId) -> bool {
        let any = |ids: &[TypeId]| ids.iter().any(MaybeLocal::is_local);
        self.alias
            .as_ref()
            .is_some_and(|(alias, arguments)| alias.file == file || any(arguments))
            || match &self.origin {
                UnionOrigin::None => false,
                UnionOrigin::Union(types) | UnionOrigin::Intersection(types) => any(types),
                UnionOrigin::Keyof(of) => of.is_local(),
            }
    }
}

/// What a type is interned by.
type Made = (TypeData, Option<Box<Provenance>>);

pub struct TypeRecord {
    made: Made,
    /// `Type.flags`: `tf`.
    flags: u32,
    object_flags: ObjectFlags,
    id: TypeId,
    /// See `mark_manifest`.
    manifest: AtomicBool,
}

/// Equal things get equal numbers. What is interned is kept once, in `items`, and found again through tables that are read without a
/// lock.
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

    /// `key_of`: what an item was interned by. `make`: the item for `key`, which it takes over, and the number it gets.
    fn intern<K: std::hash::Hash + Eq>(
        &self,
        key: K,
        key_of: impl Fn(&V) -> &K,
        make: impl FnOnce(K, u32) -> V,
    ) -> u32 {
        self.intern_hashed(spread_hash(&key), key, key_of, make)
    }

    /// `spread`: the hash of `key`.
    fn intern_hashed<K: Eq>(
        &self,
        spread: u64,
        key: K,
        key_of: impl Fn(&V) -> &K,
        make: impl FnOnce(K, u32) -> V,
    ) -> u32 {
        let shard = &self.shards[shard_of(spread)];
        if let Some(id) = shard.find(spread, |i| *key_of(self.items.get(i)) == key) {
            return id;
        }
        let key = std::cell::RefCell::new(Some(key));
        shard.find_or_add(
            spread,
            |i| {
                key.borrow()
                    .as_ref()
                    .is_some_and(|key| key_of(self.items.get(i)) == key)
            },
            || {
                self.items
                    .push_with(|id| make(key.borrow_mut().take().unwrap(), id))
            },
        )
    }
}

crate::packed_ids!(TypeId, SigId, MapperId, ComponentsId);

/// The types, signatures and mappers that mention the file at hand: see `local`.
#[derive(Default)]
struct LocalStore {
    types: Chunked<TypeRecord>,
    sigs: Chunked<SigData>,
    mappers: Chunked<(Mapping, ObjectFlags)>,
    components: Chunked<Box<[IndexComponent]>>,
    found_types: Found,
    found_sigs: Found,
    found_mappers: Found,
    found_components: Found,
}

thread_local! {
    static LOCAL_STORE: std::cell::UnsafeCell<LocalStore> = Default::default();
}

/// What is in it does not move, and is there until `TypeStore::end_local`.
#[inline]
fn local_store() -> &'static LocalStore {
    // SAFETY: it is the thread's own. It is only changed through `local_store_mut`, by functions of this file that hold no reference to the
    // store itself meanwhile, only to what is in it, which stays where it is.
    LOCAL_STORE.with(|store| unsafe { &*store.get() })
}

/// # Safety
/// No reference from `local_store` or from here may be in use, other than to what is in the lists.
#[inline]
#[allow(clippy::mut_from_ref)]
unsafe fn local_store_mut() -> &'static mut LocalStore {
    // SAFETY: see above.
    LOCAL_STORE.with(|store| unsafe { &mut *store.get() })
}

// Out of line: what is shared is looked up in thousands of places, each of which would carry a copy.
#[inline(never)]
fn local_record<'a>(id: TypeId) -> &'a TypeRecord {
    local_store().types.get((id.0 & !LOCAL) as usize)
}

#[inline(never)]
fn local_mapper<'a>(id: MapperId) -> &'a (Mapping, ObjectFlags) {
    local_store().mappers.get((id.0 & !LOCAL) as usize)
}

#[inline(never)]
fn local_sig<'a>(id: SigId) -> &'a SigData {
    local_store().sigs.get((id.0 & !LOCAL) as usize)
}

#[inline(never)]
fn local_components<'a>(id: ComponentsId) -> &'a [IndexComponent] {
    &local_store().components.get((id.0 & !LOCAL) as usize)[..]
}

impl MaybeLocal for Atom {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}

fn is_prop_local(prop: &Prop, file: FileId) -> bool {
    prop.mapper.is_local()
        || match &prop.source {
            PropSource::Type(t) => t.is_local(),
            PropSource::Members(members) => members.iter().any(|m| m.0 == file),
            PropSource::Parameter(f, _)
            | PropSource::Literal(f, _)
            | PropSource::Assigned(f, _) => *f == file,
            PropSource::Symbol(sym) => sym.file == file,
            PropSource::Intersected(t, props)
            | PropSource::Copy(t, props, _)
            | PropSource::ReverseMapped(t, props) => {
                t.is_local() || props.iter().any(|p| is_prop_local(p, file))
            }
            PropSource::Mapped(t, ..) => {
                t.is_local()
                    || prop
                        .declared_by_modifiers_property()
                        .iter()
                        .any(|p| is_prop_local(p, file))
            }
        }
}

/// Whether `data` mentions `file`, which is the one at hand, or anything that does.
fn is_type_local(data: &TypeData, file: FileId) -> bool {
    let any = |ids: &[TypeId]| ids.iter().any(MaybeLocal::is_local);
    let arguments = |arguments: &TypeArguments| match arguments {
        TypeArguments::Given(given) => any(given),
        TypeArguments::Deferred(deferred) => deferred.file == file || deferred.mapper.is_local(),
    };
    match data {
        TypeData::Intrinsic(_)
        | TypeData::StringLit { .. }
        | TypeData::NumberLit { .. }
        | TypeData::BigIntLit { .. }
        | TypeData::BoolLit { .. } => false,
        TypeData::Marker(marker) => matches!(marker, Marker::Restrictive(t) if t.is_local()),
        TypeData::UnresolvedName { args, .. } => any(args),
        TypeData::EnumLit { member: sym, .. }
        | TypeData::Enum { symbol: sym, .. }
        | TypeData::ThisParam(sym) => sym.file == file,
        TypeData::UniqueSymbol { symbol, .. } => symbol.file() == Some(file),
        TypeData::TypeParam(f, _, mapper)
        | TypeData::Cond {
            file: f, mapper, ..
        } => *f == file || mapper.is_local(),
        TypeData::EvolvingArray(t) | TypeData::Keyof(t) | TypeData::StringMapping { ty: t, .. } => {
            t.is_local()
        }
        TypeData::Substitution { base, constraint } => base.is_local() || constraint.is_local(),
        TypeData::Union(t) | TypeData::Intersection(t) => any(t),
        TypeData::Ref { target: sym, args } => sym.file == file || arguments(args),
        TypeData::Tuple { elems, .. } => arguments(elems),
        TypeData::Anon { origin, mapper } => {
            mapper.is_local()
                || match origin {
                    Origin::TypeLiteral(f, _)
                    | Origin::Mapped(f, _)
                    | Origin::ObjectLiteral(f, ..)
                    | Origin::WidenedLiteral(f, ..) => *f == file,
                    Origin::ClassStatic(sym)
                    | Origin::Function(sym)
                    | Origin::EnumObject(sym)
                    | Origin::Module(sym) => sym.file == file,
                    Origin::Namespace {
                        module,
                        originating_import,
                        ..
                    } => module.file == file || originating_import.file == file,
                    Origin::GlobalThis => false,
                }
        }
        TypeData::Fns { decls, mapper } => mapper.is_local() || decls.iter().any(|d| d.0 == file),
        TypeData::Synth(shape) => {
            shape.symbol_declared_at.is_some_and(|at| at.0 == file)
                || shape.default_of.is_some_and(|module| module.file == file)
                || shape
                    .spread_of
                    .is_some_and(|(left, right)| left.is_local() || right.is_local())
                || matches!(
                    shape.instantiation_expression,
                    Some(InstantiationExpression::Expr(f, _) | InstantiationExpression::TypeNode(f, _))
                        if f == file
                )
                || shape.props.iter().any(|p| is_prop_local(p, file))
                || shape.index.iter().any(|i| {
                    i.key.is_local()
                        || i.value.is_local()
                        || i.components.is_local()
                        || i.declaration
                            .is_some_and(|declaration| declaration.0 == file)
                })
                || shape
                    .call
                    .iter()
                    .chain(&shape.construct)
                    .any(MaybeLocal::is_local)
        }
        TypeData::ReverseMapped { source, mapped, of } => {
            source.is_local() || mapped.is_local() || of.is_local()
        }
        TypeData::IndexedAccess { obj, index, .. } => obj.is_local() || index.is_local(),
        TypeData::Template { types, .. } => any(types),
    }
}

fn is_sig_local(data: &SigData, file: FileId) -> bool {
    match data {
        SigData::Decl {
            file: f, mapper, ..
        } => *f == file || mapper.is_local(),
        SigData::DefaultConstruct {
            class,
            base,
            mapper,
        } => class.file == file || base.is_local() || mapper.is_local(),
        SigData::Construct {
            class,
            file: f,
            mapper,
            ..
        } => class.file == file || *f == file || mapper.is_local(),
        SigData::Synth {
            type_params,
            params,
            ret,
            this,
            of,
        } => {
            ret.is_local()
                || this.is_local()
                || type_params.iter().any(MaybeLocal::is_local)
                || params.iter().any(|p| p.ty.is_local())
                || of.iter().any(MaybeLocal::is_local)
        }
        SigData::WithReturn { sig, ret } => sig.is_local() || ret.is_local(),
    }
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

/// Whether the parameters come in order, each of them once.
#[inline]
fn is_in_order(pairs: &[(TypeId, TypeId)]) -> bool {
    pairs.is_sorted_by(|a, b| a.0 < b.0)
}

pub struct TypeStore {
    types: Interned<TypeRecord>,
    sigs: Interned<SigData>,
    mappers: Interned<(Mapping, ObjectFlags)>,
    components: Interned<Box<[IndexComponent]>>,
    /// The types of string literals, regular and fresh, by what they say. There is one for nearly every string in a program.
    string_literals: [ById<Atom, TypeId>; 2],
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
        };
        for (i, data) in WELL_KNOWN.iter().enumerate() {
            assert_eq!(store.intern(data.clone()).0 as usize, i);
        }
        assert_eq!(
            store.intern(TypeData::Union(Box::new([TypeId::FALSE, TypeId::TRUE]))),
            TypeId::BOOLEAN
        );
        assert_eq!(
            store.intern(TypeData::Synth(Box::default())),
            TypeId::EMPTY_OBJECT
        );
        assert_eq!(
            store.intern(TypeData::Synth(Box::new(Shape {
                literal: Literalness::OfUnknown,
                ..Shape::default()
            }))),
            TypeId::UNKNOWN_EMPTY_OBJECT
        );
        assert_eq!(store.mapper_in_order(&[]), MapperId::IDENTITY);
        assert_eq!(
            store
                .components
                .intern(Box::default(), |list| list, |list, _| list),
            ComponentsId::NONE.0
        );
        store
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &TypeData {
        &self.record(id).made.0
    }

    /// `t.AsTypeReference().node != nil`: what the deferred type reference `id` is made of, resolved or not.
    #[inline]
    pub fn deferred(&self, id: TypeId) -> Option<&DeferredTypeArguments> {
        match self.get(id) {
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => args.as_deferred(),
            _ => None,
        }
    }

    /// `d.resolvedTypeArguments`, of a reference or a tuple type, if they are there.
    #[inline]
    pub fn resolved_type_arguments(&self, id: TypeId) -> Option<&[TypeId]> {
        match self.get(id) {
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => args.resolved(),
            _ => None,
        }
    }

    /// `d.resolvedTypeArguments = ..`, unless it has them. What it has.
    pub fn resolve_deferred(&self, id: TypeId, resolved: Box<[TypeId]>) -> &[TypeId] {
        match self.deferred(id) {
            Some(deferred) => deferred.resolved.get_or_init(|| resolved),
            None => &[],
        }
    }

    /// The members of a union, nothing for `never`, and any other type on its own.
    #[inline]
    pub fn parts(&self, id: TypeId) -> &[TypeId] {
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

    #[inline]
    pub fn flags(&self, id: TypeId) -> u32 {
        self.record(id).flags
    }

    #[inline]
    pub fn object_flags(&self, id: TypeId) -> ObjectFlags {
        self.record(id).object_flags
    }

    #[inline]
    pub fn get_with_flags(&self, id: TypeId) -> (&TypeData, ObjectFlags) {
        let record = self.record(id);
        (&record.made.0, record.object_flags)
    }

    pub fn len(&self) -> u32 {
        self.types.items.len()
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
                        flags |= self.object_flags(t);
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
    fn record(&self, id: TypeId) -> &TypeRecord {
        if id.0 & LOCAL == 0 {
            self.types.items.get(id.0)
        } else {
            local_record(id)
        }
    }

    #[inline(always)]
    fn mapper_record(&self, id: MapperId) -> &(Mapping, ObjectFlags) {
        if id.0 & LOCAL == 0 {
            self.mappers.items.get(id.0)
        } else {
            local_mapper(id)
        }
    }

    /// The file at hand is done: what mentions it goes.
    pub fn end_local() {
        // SAFETY: nothing is being interned or looked at.
        let store = unsafe { local_store_mut() };
        store.types.clear();
        store.sigs.clear();
        store.mappers.clear();
        store.components.clear();
        store.found_types.clear();
        store.found_sigs.clear();
        store.found_mappers.clear();
        store.found_components.clear();
    }

    /// `work`, by a store of its own: what mentions the file at hand is numbered in terms of the store it was made for.
    pub fn apart_from_what_is_local<R>(work: impl FnOnce() -> R) -> R {
        // SAFETY: nothing is being interned. What is in the lists stays where it is.
        let kept = std::mem::take(unsafe { local_store_mut() });
        let result = work();
        // SAFETY: as above, and nothing that `work` made is left.
        *unsafe { local_store_mut() } = kept;
        result
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
        TypeRecord {
            flags: Self::flags_of(&made),
            object_flags: flags,
            made,
            id: TypeId(id),
            manifest: AtomicBool::new(false),
        }
    }

    pub fn intern(&self, data: TypeData) -> TypeId {
        if let TypeData::StringLit { value, fresh } = data {
            let known = &self.string_literals[usize::from(fresh)];
            if let Some(id) = known.get(&value) {
                return id;
            }
            let id = self
                .types
                .items
                .push_with(|id| self.new_record((data, None), id));
            // Of two threads that get here at once one has made a type nothing will ever refer to.
            return known.insert(value, TypeId(id));
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
    pub fn provenance(&self, id: TypeId) -> Option<&Provenance> {
        self.record(id).made.1.as_deref()
    }

    fn intern_made(&self, made: Made) -> TypeId {
        let spread = spread_hash(&made);
        if !local::is_any_on() {
            return TypeId(self.types.intern_hashed(
                spread,
                made,
                |record| &record.made,
                |made, id| self.new_record(made, id),
            ));
        }
        self.intern_with_local(spread, made)
    }

    #[inline(never)]
    fn intern_with_local(&self, spread: u64, made: Made) -> TypeId {
        // Where it was last found or put by this thread, which is nowhere unless the thread has a file at hand.
        let store = local_store();
        if let Some(id) = store.found_types.find(spread, |id| {
            let record = if id & LOCAL == 0 {
                self.types.items.get(id)
            } else {
                store.types.get((id & !LOCAL) as usize)
            };
            record.made == made
        }) {
            return TypeId(id);
        }
        let file = local::file();
        let is_local = file != u32::MAX
            && (is_type_local(&made.0, FileId(file))
                || made.1.as_ref().is_some_and(|p| p.is_local(FileId(file))));
        let id = if is_local {
            let id = store.types.len() as u32 | LOCAL;
            let record = self.new_record(made, id);
            // SAFETY: no reference to the store is in use.
            unsafe { local_store_mut() }.types.push(record);
            id
        } else {
            self.types.intern_hashed(
                spread,
                made,
                |record| &record.made,
                |made, id| self.new_record(made, id),
            )
        };
        if file != u32::MAX {
            // SAFETY: no reference to the store is in use.
            unsafe { local_store_mut() }.found_types.add(spread, id);
        }
        TypeId(id)
    }

    /// `ObjectFlagsFromTypeNode`, `ObjectFlagsArrayLiteral`: `id` was made by a type node or an array literal, not by
    /// instantiation. `made_before` is `len()` from just before it was interned: a type that was there already stays what it
    /// was first made as (`createTypeReferenceEx`).
    pub fn mark_manifest(&self, id: TypeId, made_before: u32) {
        if id.0 >= made_before {
            self.record(id).manifest.store(true, Ordering::Relaxed);
        }
    }

    #[inline]
    pub fn is_manifest(&self, id: TypeId) -> bool {
        self.record(id).manifest.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn sig(&self, id: SigId) -> &SigData {
        if id.0 & LOCAL == 0 {
            self.sigs.items.get(id.0)
        } else {
            local_sig(id)
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
        if !local::is_any_on() {
            return SigId(self.sigs.intern(data, |data| data, |data, _| data));
        }
        let spread = spread_hash(&data);
        // As in `intern_with_local`.
        let store = local_store();
        if let Some(id) = store.found_sigs.find(spread, |id| {
            let known = if id & LOCAL == 0 {
                self.sigs.items.get(id)
            } else {
                store.sigs.get((id & !LOCAL) as usize)
            };
            *known == data
        }) {
            return SigId(id);
        }
        let file = local::file();
        let id = if file != u32::MAX && is_sig_local(&data, FileId(file)) {
            // SAFETY: no reference to the store is in use.
            unsafe { local_store_mut() }.sigs.push(data) as u32 | LOCAL
        } else {
            self.sigs
                .intern_hashed(spread, data, |data| data, |data, _| data)
        };
        if file != u32::MAX {
            // SAFETY: no reference to the store is in use.
            unsafe { local_store_mut() }.found_sigs.add(spread, id);
        }
        SigId(id)
    }

    /// `IndexInfo.components`
    #[inline]
    pub fn components(&self, id: ComponentsId) -> &[IndexComponent] {
        if id.0 & LOCAL == 0 {
            &self.components.items.get(id.0)[..]
        } else {
            local_components(id)
        }
    }

    pub fn intern_components(&self, list: &[IndexComponent]) -> ComponentsId {
        if list.is_empty() {
            return ComponentsId::NONE;
        }
        let list: Box<[IndexComponent]> = list.into();
        if !local::is_any_on() {
            return ComponentsId(self.components.intern(list, |list| list, |list, _| list));
        }
        let spread = spread_hash(&list);
        // As in `intern_with_local`.
        let store = local_store();
        if let Some(id) = store.found_components.find(spread, |id| {
            let known = if id & LOCAL == 0 {
                self.components.items.get(id)
            } else {
                store.components.get((id & !LOCAL) as usize)
            };
            *known == list
        }) {
            return ComponentsId(id);
        }
        let file = local::file();
        let id = if file != u32::MAX && list.iter().any(|component| component.file().0 == file) {
            // SAFETY: no reference to the store is in use.
            unsafe { local_store_mut() }.components.push(list) as u32 | LOCAL
        } else {
            self.components
                .intern_hashed(spread, list, |list| list, |list, _| list)
        };
        if file != u32::MAX {
            // SAFETY: no reference to the store is in use.
            unsafe { local_store_mut() }
                .found_components
                .add(spread, id);
        }
        ComponentsId(id)
    }

    /// `pairs` need not be sorted. A parameter mapped to itself stays: it says that the origin depends on it.
    pub fn mapper(&self, mut pairs: Vec<(TypeId, TypeId)>) -> MapperId {
        if pairs.is_empty() {
            return MapperId::IDENTITY;
        }
        if !is_in_order(&pairs) {
            pairs.sort_unstable_by_key(|p| p.0);
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
        let spread = spread_hash(&Pairs(pairs));
        if !local::is_any_on() {
            return MapperId(self.shared_mapper(spread, pairs));
        }
        // Where it was last found or put by this thread, which is nowhere unless the thread has a file at hand.
        let store = local_store();
        if let Some(id) = store.found_mappers.find(spread, |id| {
            let record = if id & LOCAL == 0 {
                self.mappers.items.get(id)
            } else {
                store.mappers.get((id & !LOCAL) as usize)
            };
            *record.0 == *pairs
        }) {
            return MapperId(id);
        }
        if !local::is_on() {
            return MapperId(self.shared_mapper(spread, pairs));
        }
        let id = if pairs.iter().any(|p| p.0.is_local() || p.1.is_local()) {
            let record = (Mapping::from(pairs), self.flags_of_pairs(pairs));
            // SAFETY: no reference to the store is in use.
            unsafe { local_store_mut() }.mappers.push(record) as u32 | LOCAL
        } else {
            self.shared_mapper(spread, pairs)
        };
        // SAFETY: no reference to the store is in use.
        unsafe { local_store_mut() }.found_mappers.add(spread, id);
        MapperId(id)
    }

    /// The number of the mapper among those all threads share. `spread`: the hash of `pairs`.
    fn shared_mapper(&self, spread: u64, pairs: &[(TypeId, TypeId)]) -> u32 {
        let is_it = |id: u32| *self.mappers.items.get(id).0 == *pairs;
        let shard = &self.mappers.shards[shard_of(spread)];
        if let Some(id) = shard.find(spread, is_it) {
            return id;
        }
        shard.find_or_add(spread, is_it, || {
            self.mappers
                .items
                .push((Mapping::from(pairs), self.flags_of_pairs(pairs)))
        })
    }

    fn flags_of_pairs(&self, pairs: &[(TypeId, TypeId)]) -> ObjectFlags {
        pairs
            .iter()
            .fold(ObjectFlags::empty(), |f, p| f | self.object_flags(p.1))
    }

    #[inline]
    pub fn mapping(&self, id: MapperId) -> &[(TypeId, TypeId)] {
        &self.mapper_record(id).0
    }

    #[inline]
    pub fn map(&self, id: MapperId, param: TypeId) -> Option<TypeId> {
        let mapping = self.mapping(id);
        if mapping.len() <= 4 {
            return mapping.iter().find(|p| p.0 == param).map(|p| p.1);
        }
        mapping
            .binary_search_by_key(&param, |p| p.0)
            .ok()
            .map(|i| mapping[i].1)
    }
}
