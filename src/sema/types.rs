//! Types, signatures and type-parameter mappings, hash-consed: equal ones have equal ids, whichever thread made them.
//!
//! An object type says where it comes from (a declaration, a piece of syntax, and what the type parameters around it
//! stand for), not what is in it. What is in it is asked of the checker, which works it out once.

use crate::atom::Atom;
use crate::hir::{ExprId, FnId, TypeNodeId, TypeParamId};
use crate::local::{self, Chunked, Found, LOCAL, MaybeLocal};
use crate::program::{FileId, Sym};
use crate::table::{ById, Id};
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

/// `TypeReference.target`, of a deferred type reference.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum DeferredTarget {
    /// A generic class or interface.
    Declared(Sym),
    /// `getArrayOrTupleTargetType`. `readonly`: `isReadonlyTypeOperator(node.Parent)`.
    ArrayOrTuple { readonly: bool },
}

/// `createDeferredTypeReference`: a reference to a generic class or interface, an array type or a tuple type, written at `node` in
/// the declaration of a type alias. Its type arguments are resolved when they are first asked for (`getTypeArguments`).
/// `mapper`: what the type parameters around the node stand for. It is interned by all but `resolved`.
pub struct DeferredReference {
    pub file: FileId,
    pub node: TypeNodeId,
    pub mapper: MapperId,
    pub target: DeferredTarget,
    /// `resolvedTypeArguments`, as the `TypeData::Ref` or `TypeData::Tuple` that has them. `TypeStore::get` gives this once it is
    /// there, so a reference that is resolved is one like any other, with a number of its own.
    resolved: OnceLock<TypeData>,
}

impl DeferredReference {
    pub fn new(file: FileId, node: TypeNodeId, mapper: MapperId, target: DeferredTarget) -> Self {
        DeferredReference {
            file,
            node,
            mapper,
            target,
            resolved: OnceLock::new(),
        }
    }

    #[inline]
    pub fn is_resolved(&self) -> bool {
        self.resolved.get().is_some()
    }

    #[inline]
    fn key(&self) -> (FileId, TypeNodeId, MapperId, DeferredTarget) {
        (self.file, self.node, self.mapper, self.target)
    }
}

impl Clone for DeferredReference {
    fn clone(&self) -> Self {
        DeferredReference {
            file: self.file,
            node: self.node,
            mapper: self.mapper,
            target: self.target,
            resolved: self.resolved.clone(),
        }
    }
}

impl PartialEq for DeferredReference {
    fn eq(&self, other: &Self) -> bool {
        self.key() == other.key()
    }
}

impl Eq for DeferredReference {}

impl std::hash::Hash for DeferredReference {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        std::hash::Hash::hash(&self.key(), state);
    }
}

impl std::fmt::Debug for DeferredReference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(&self.key(), f)
    }
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
    /// A type parameter that is nobody's, put for a real one to see how a generic type varies with it.
    Marker(u8),
    /// In the order of `CompareTypes`.
    Union(Box<[TypeId]>),
    Intersection(Box<[TypeId]>),
    /// An instance of a class or an interface.
    Ref {
        target: Sym,
        args: Box<[TypeId]>,
    },
    Tuple {
        elems: Box<[TypeId]>,
        flags: Box<[ElemFlags]>,
        readonly: bool,
    },
    /// A reference to a type alias that was in the middle of being resolved: `type J = string | J[]`.
    LazyAlias {
        sym: Sym,
        args: Box<[TypeId]>,
    },
    /// A deferred type reference whose type arguments have not been resolved. See `DeferredReference`.
    Deferred(Box<DeferredReference>),
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
    pub struct PropFlags: u16 {
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
    /// A symbol made from others (`createSymbolWithType`, `getSpreadSymbol`, `getSpreadType`, `resolveReverseMappedTypeMembers`): its
    /// own type, and the symbols whose `Declarations` it has, one after the other. None of those is made up, a copy or
    /// `Intersected`. The flag: it has the `ValueDeclaration` and the `Parent` of the first as well. `Checker::copy_of` makes it.
    Copy(TypeId, Box<[Prop]>, bool),
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

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct TypeFlags: u8 {
        /// Mentions a type parameter, so instantiating it may change it.
        const HAS_TYPE_VARIABLES = 1;
        /// Is or contains `Unresolved`.
        const HAS_UNRESOLVED = 2;
        /// An intersection, or a union with one among its members.
        const MAY_BE_REDUCED = 128;
        const HAS_MARKER = 4;
        /// The type of an object literal expression, or what a binding pattern implies, is somewhere in it.
        const HAS_OBJECT_LITERAL = 8;
        /// A union or an intersection with a `LazyAlias` among its members, or with another such type among them.
        const HAS_LAZY_MEMBER = 16;
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

/// A type without provenance has the hash of its data, which `TypeParts` has too.
fn spread_hash_of(made: &Made) -> u64 {
    match &made.1 {
        None => spread_hash(&made.0),
        Some(provenance) => spread_hash(&(&made.0, provenance)),
    }
}

pub struct TypeRecord {
    made: Made,
    pub flags: TypeFlags,
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
    mappers: Chunked<(Mapping, TypeFlags)>,
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
fn local_mapper<'a>(id: MapperId) -> &'a (Mapping, TypeFlags) {
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
            PropSource::Intersected(t, props) | PropSource::Copy(t, props, _) => {
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
    match data {
        TypeData::Intrinsic(_)
        | TypeData::StringLit { .. }
        | TypeData::NumberLit { .. }
        | TypeData::BigIntLit { .. }
        | TypeData::BoolLit { .. }
        | TypeData::Marker(_) => false,
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
        TypeData::Ref { target: sym, args } | TypeData::LazyAlias { sym, args } => {
            sym.file == file || any(args)
        }
        TypeData::Tuple { elems, .. } => any(elems),
        TypeData::Deferred(reference) => {
            reference.file == file
                || reference.mapper.is_local()
                || matches!(reference.target, DeferredTarget::Declared(sym) if sym.file == file)
        }
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

/// What a type of some kinds is made of, for whoever has it in lists of their own. See `TypeStore::intern_parts`.
#[derive(Copy, Clone)]
pub enum TypeParts<'a> {
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

impl TypeParts<'_> {
    fn is(self, data: &TypeData) -> bool {
        match (self, data) {
            (TypeParts::Union(parts), TypeData::Union(known))
            | (TypeParts::Intersection(parts), TypeData::Intersection(known)) => *parts == **known,
            (
                TypeParts::Ref { target, args },
                TypeData::Ref {
                    target: known_target,
                    args: known,
                },
            ) => target == *known_target && *args == **known,
            (
                TypeParts::Tuple {
                    elems,
                    flags,
                    readonly,
                },
                TypeData::Tuple {
                    elems: known,
                    flags: known_flags,
                    readonly: known_readonly,
                },
            ) => readonly == *known_readonly && *elems == **known && *flags == **known_flags,
            (
                TypeParts::Fns { decls, mapper },
                TypeData::Fns {
                    decls: known,
                    mapper: known_mapper,
                },
            ) => mapper == *known_mapper && *decls == **known,
            _ => false,
        }
    }

    fn to_data(self) -> TypeData {
        match self {
            TypeParts::Union(parts) => TypeData::Union(parts.into()),
            TypeParts::Intersection(parts) => TypeData::Intersection(parts.into()),
            TypeParts::Ref { target, args } => TypeData::Ref {
                target,
                args: args.into(),
            },
            TypeParts::Tuple {
                elems,
                flags,
                readonly,
            } => TypeData::Tuple {
                elems: elems.into(),
                flags: flags.into(),
                readonly,
            },
            TypeParts::Fns { decls, mapper } => TypeData::Fns {
                decls: decls.into(),
                mapper,
            },
        }
    }
}

/// What `to_data` gives is hashed the same: which kind it is, then the fields in the order they are declared in.
impl std::hash::Hash for TypeParts<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        use std::hash::Hash;
        /// `empty`: a type of the kind. A box of nothing is not allocated.
        #[inline]
        fn kind<H: std::hash::Hasher>(empty: TypeData, state: &mut H) {
            std::mem::discriminant(&empty).hash(state);
        }
        match *self {
            TypeParts::Union(parts) => {
                kind(TypeData::Union(Box::default()), state);
                parts.hash(state);
            }
            TypeParts::Intersection(parts) => {
                kind(TypeData::Intersection(Box::default()), state);
                parts.hash(state);
            }
            TypeParts::Ref { target, args } => {
                let empty = TypeData::Ref {
                    target,
                    args: Box::default(),
                };
                kind(empty, state);
                target.hash(state);
                args.hash(state);
            }
            TypeParts::Tuple {
                elems,
                flags,
                readonly,
            } => {
                let empty = TypeData::Tuple {
                    elems: Box::default(),
                    flags: Box::default(),
                    readonly,
                };
                kind(empty, state);
                elems.hash(state);
                flags.hash(state);
                readonly.hash(state);
            }
            TypeParts::Fns { decls, mapper } => {
                let empty = TypeData::Fns {
                    decls: Box::default(),
                    mapper,
                };
                kind(empty, state);
                decls.hash(state);
                mapper.hash(state);
            }
        }
    }
}

pub struct TypeStore {
    types: Interned<TypeRecord>,
    sigs: Interned<SigData>,
    mappers: Interned<(Mapping, TypeFlags)>,
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
    MARKER_SUPER = TypeData::Marker(0),
    MARKER_SUB = TypeData::Marker(1),
    MARKER_OTHER = TypeData::Marker(2),
    // `markerSuperTypeForCheck`, `markerSubTypeForCheck`: `checkTypeParameterDeferred` verifies an `in` / `out` annotation with these.
    MARKER_SUPER_FOR_CHECK = TypeData::Marker(3),
    MARKER_SUB_FOR_CHECK = TypeData::Marker(4),
    SILENT_NEVER = TypeData::Intrinsic(Intrinsic::SilentNever),
    UNREACHABLE_NEVER = TypeData::Intrinsic(Intrinsic::UnreachableNever),
    AUTO = TypeData::Intrinsic(Intrinsic::Auto),
    ERROR = TypeData::Intrinsic(Intrinsic::Error),
    INTRINSIC_MARKER = TypeData::Intrinsic(Intrinsic::IntrinsicMarker),
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

    /// `TypeFlagsAny`: `anyType`, `errorType`, `autoType` or `intrinsicMarkerType`.
    #[inline]
    pub fn is_any(self) -> bool {
        matches!(
            self,
            TypeId::ANY | TypeId::ERROR | TypeId::AUTO | TypeId::INTRINSIC_MARKER
        )
    }

    /// `TypeFlagsNever`: `neverType`, `silentNeverType` or `unreachableNeverType`.
    #[inline]
    pub fn is_never(self) -> bool {
        matches!(
            self,
            TypeId::NEVER | TypeId::SILENT_NEVER | TypeId::UNREACHABLE_NEVER
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

    /// For each kind of thing that is kept: what it is, how many there are, and how many bytes they take, what they point to included.
    pub fn sizes(&self) -> Vec<(String, usize, usize)> {
        fn shape_bytes(shape: &Shape) -> usize {
            shape.props.capacity() * size_of::<Prop>()
                + shape.props.iter().map(prop_bytes).sum::<usize>()
                + (shape.call.capacity() + shape.construct.capacity()) * 4
                + shape.index.capacity() * size_of::<IndexInfo>()
        }
        fn prop_bytes(prop: &Prop) -> usize {
            match &prop.source {
                PropSource::Members(MemberList::Many(m)) => m.len() * 8,
                PropSource::Assigned(_, e) => e.len() * 4,
                PropSource::Intersected(_, props) | PropSource::Copy(_, props, _) => {
                    props.len() * size_of::<Prop>() + props.iter().map(prop_bytes).sum::<usize>()
                }
                _ => 0,
            }
        }
        let mut kinds: std::collections::BTreeMap<&'static str, (usize, usize)> =
            Default::default();
        for i in 0..self.types.items.len() {
            let (name, payload) = match &self.types.items.get(i).made.0 {
                TypeData::Union(t) => ("type: union", t.len() * 4),
                TypeData::Intersection(t) => ("type: intersection", t.len() * 4),
                TypeData::Ref { args, .. } => ("type: reference", args.len() * 4),
                TypeData::LazyAlias { args, .. } => ("type: lazy alias", args.len() * 4),
                TypeData::Deferred(_) => {
                    ("type: deferred reference", size_of::<DeferredReference>())
                }
                TypeData::Tuple { elems, flags, .. } => (
                    "type: tuple",
                    elems.len() * 4 + flags.len() * size_of::<ElemFlags>(),
                ),
                TypeData::Anon { .. } => ("type: anonymous object", 0),
                TypeData::Fns { decls, .. } => ("type: functions", decls.len() * 8),
                TypeData::Synth(shape) => (
                    "type: made-up object",
                    size_of::<Shape>() + shape_bytes(shape),
                ),
                TypeData::Template { texts, types } => {
                    ("type: template", texts.len() * 4 + types.len() * 4)
                }
                TypeData::Cond { .. } => ("type: conditional", 0),
                TypeData::IndexedAccess { .. } => ("type: indexed access", 0),
                TypeData::TypeParam(..) => ("type: type parameter", 0),
                _ => ("type: other", 0),
            };
            let row = kinds.entry(name).or_default();
            row.0 += 1;
            row.1 += size_of::<TypeRecord>() + payload + 8;
        }
        let mut out: Vec<(String, usize, usize)> = kinds
            .into_iter()
            .map(|(name, (count, bytes))| (name.to_owned(), count, bytes))
            .collect();
        let (mut count, mut bytes) = (0, 0);
        for i in 0..self.sigs.items.len() {
            count += 1;
            bytes += size_of::<SigData>()
                + 8
                + match self.sigs.items.get(i) {
                    SigData::Synth {
                        type_params,
                        params,
                        of,
                        ..
                    } => {
                        type_params.len() * 4 + params.len() * size_of::<SigParam>() + of.len() * 4
                    }
                    _ => 0,
                };
        }
        out.push(("signatures".to_owned(), count, bytes));
        let (mut count, mut bytes) = (0, 0);
        for i in 0..self.mappers.items.len() {
            count += 1;
            bytes += size_of::<(Mapping, TypeFlags)>() + 8 + self.mappers.items.get(i).0.len() * 8;
        }
        out.push(("mappers".to_owned(), count, bytes));
        out
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &TypeData {
        Self::resolved_data(&self.record(id).made.0)
    }

    /// `data`, or what a deferred type reference has been resolved to.
    #[inline(always)]
    fn resolved_data(data: &TypeData) -> &TypeData {
        match data {
            TypeData::Deferred(reference) => reference.resolved.get().unwrap_or(data),
            _ => data,
        }
    }

    /// `t.AsTypeReference().node != nil`: the deferred type reference that `id` is, resolved or not.
    #[inline]
    pub fn deferred(&self, id: TypeId) -> Option<&DeferredReference> {
        match &self.record(id).made.0 {
            TypeData::Deferred(reference) => Some(&**reference),
            _ => None,
        }
    }

    /// `d.resolvedTypeArguments = ..`, unless it has them.
    pub fn resolve_deferred(&self, id: TypeId, resolved: TypeData) {
        if let Some(reference) = self.deferred(id) {
            let _ = reference.resolved.set(resolved);
        }
    }

    /// The members of a union, nothing for `never`, and any other type on its own.
    #[inline]
    pub fn parts(&self, id: TypeId) -> &[TypeId] {
        let record = self.record(id);
        match &record.made.0 {
            TypeData::Union(members) => members,
            TypeData::Intrinsic(
                Intrinsic::Never | Intrinsic::SilentNever | Intrinsic::UnreachableNever,
            ) => &[],
            _ => std::slice::from_ref(&record.id),
        }
    }

    #[inline]
    pub fn flags(&self, id: TypeId) -> TypeFlags {
        self.record(id).flags
    }

    #[inline]
    pub fn get_with_flags(&self, id: TypeId) -> (&TypeData, TypeFlags) {
        let record = self.record(id);
        (Self::resolved_data(&record.made.0), record.flags)
    }

    pub fn len(&self) -> u32 {
        self.types.items.len()
    }

    fn flags_of(&self, data: &TypeData) -> TypeFlags {
        let all = |ids: &[TypeId]| {
            ids.iter()
                .fold(TypeFlags::empty(), |f, &t| f | self.flags(t))
        };
        match data {
            TypeData::Intrinsic(Intrinsic::Unresolved) => TypeFlags::HAS_UNRESOLVED,
            // One whose constraint rests on something unknown says so. A marker in there does not show:
            // `reportUnreliableMapper` is asked about the parameter, not about what is in its mapper.
            TypeData::TypeParam(_, _, around) => {
                TypeFlags::HAS_TYPE_VARIABLES
                    | (self.mapper_record(*around).1 & TypeFlags::HAS_UNRESOLVED)
            }
            TypeData::ThisParam(_) => TypeFlags::HAS_TYPE_VARIABLES,
            TypeData::Marker(_) => TypeFlags::HAS_TYPE_VARIABLES | TypeFlags::HAS_MARKER,
            // `instantiateType` leaves what has `TypeFlagsAny` as it is, whatever its alias type arguments are.
            TypeData::UnresolvedName { .. } => TypeFlags::empty(),
            TypeData::Union(t) | TypeData::Intersection(t) => all(t),
            TypeData::Ref { args, .. } | TypeData::LazyAlias { args, .. } => all(args),
            TypeData::Tuple { elems, .. } => all(elems),
            TypeData::Anon {
                origin: Origin::ObjectLiteral(..),
                mapper,
            } => self.mapper_record(*mapper).1 | TypeFlags::HAS_OBJECT_LITERAL,
            // Whoever makes one leaves the mapper out unless there are type parameters around the origin.
            TypeData::Anon { mapper, .. }
            | TypeData::Fns { mapper, .. }
            | TypeData::Cond { mapper, .. } => self.mapper_record(*mapper).1,
            // `couldContainTypeVariables`: `t.AsTypeReference().node != nil`. `createDeferredTypeReference` sets no propagating flags.
            TypeData::Deferred(reference) => self
                .mapper_record(reference.mapper)
                .1
                .difference(TypeFlags::HAS_OBJECT_LITERAL),
            TypeData::Synth(shape) => {
                let is_plain = matches!(
                    shape.literal,
                    Literalness::No | Literalness::OfUnknown | Literalness::AutoArray
                );
                let mut flags = if is_plain {
                    TypeFlags::empty()
                } else {
                    TypeFlags::HAS_OBJECT_LITERAL
                };
                for p in &shape.props {
                    if let PropSource::Type(t) | PropSource::Copy(t, ..) = p.source {
                        flags |= self.flags(t);
                    }
                    flags |= self.mapper_record(p.mapper).1;
                }
                for i in &shape.index {
                    flags |= self.flags(i.key) | self.flags(i.value);
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
                let made_with = self.flags(*mapped) | self.flags(*of);
                self.flags(*source)
                    | (made_with & (TypeFlags::HAS_UNRESOLVED | TypeFlags::HAS_MARKER))
            }
            TypeData::IndexedAccess { obj, index, .. } => self.flags(*obj) | self.flags(*index),
            // `couldContainTypeVariables`: instantiating one resolves it.
            TypeData::Substitution { base, constraint } => {
                self.flags(*base) | self.flags(*constraint) | TypeFlags::HAS_TYPE_VARIABLES
            }
            TypeData::Keyof(t) | TypeData::StringMapping { ty: t, .. } => self.flags(*t),
            TypeData::Template { types, .. } => all(types),
            _ => TypeFlags::empty(),
        }
    }

    pub fn sig_flags(&self, sig: SigId) -> TypeFlags {
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
                    .fold(self.flags(*ret), |f, p| f | self.flags(p.ty));
                if let Some(this) = this {
                    flags |= self.flags(*this);
                }
                of.iter().fold(flags, |f, &part| f | self.sig_flags(part))
            }
            SigData::WithReturn { sig, ret } => self.sig_flags(*sig) | self.flags(*ret),
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
    fn mapper_record(&self, id: MapperId) -> &(Mapping, TypeFlags) {
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

    fn new_record(&self, made: Made, id: u32) -> TypeRecord {
        let data = &made.0;
        let may_be_reduced = match data {
            TypeData::Intersection(_) => true,
            TypeData::Union(members) => members
                .iter()
                .any(|&member| matches!(self.get(member), TypeData::Intersection(_))),
            _ => false,
        };
        let mut flags = self.flags_of(data);
        // `getObjectTypeInstantiation`: of a target with alias type arguments no outer type parameter is left out.
        if !matches!(data, TypeData::Union(_) | TypeData::Intersection(_))
            && let Some((_, type_arguments)) = made.1.as_ref().and_then(|p| p.alias.as_ref())
            && type_arguments
                .iter()
                .any(|&t| self.flags(t).contains(TypeFlags::HAS_TYPE_VARIABLES))
        {
            flags |= TypeFlags::HAS_TYPE_VARIABLES;
        }
        // Unlike the others, it is not handed on by what the type is made of.
        flags.set(TypeFlags::MAY_BE_REDUCED, may_be_reduced);
        let has_lazy_member = match &data {
            TypeData::Union(members) | TypeData::Intersection(members) => {
                members.iter().any(|&member| {
                    let (of_member, member_flags) = self.get_with_flags(member);
                    matches!(of_member, TypeData::LazyAlias { .. })
                        || member_flags.contains(TypeFlags::HAS_LAZY_MEMBER)
                })
            }
            _ => false,
        };
        flags.set(TypeFlags::HAS_LAZY_MEMBER, has_lazy_member);
        TypeRecord {
            flags,
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
        let spread = spread_hash_of(&made);
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

    /// `intern` of the type made of `parts`. Nothing is allocated if this thread has met the type since it took the file at hand or, with no
    /// file at hand, if the type is there.
    pub fn intern_parts(&self, parts: TypeParts<'_>) -> TypeId {
        let spread = spread_hash(&parts);
        if local::is_any_on() {
            let store = local_store();
            if let Some(id) = store.found_types.find(spread, |id| {
                let record = if id & LOCAL == 0 {
                    self.types.items.get(id)
                } else {
                    store.types.get((id & !LOCAL) as usize)
                };
                record.made.1.is_none() && parts.is(&record.made.0)
            }) {
                return TypeId(id);
            }
            if local::is_on() {
                return self.intern(parts.to_data());
            }
        }
        let known = self.types.shards[shard_of(spread)].find(spread, |id| {
            let record = self.types.items.get(id);
            record.made.1.is_none() && parts.is(&record.made.0)
        });
        match known {
            Some(id) => TypeId(id),
            None => self.intern(parts.to_data()),
        }
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

    fn flags_of_pairs(&self, pairs: &[(TypeId, TypeId)]) -> TypeFlags {
        pairs
            .iter()
            .fold(TypeFlags::empty(), |f, p| f | self.flags(p.1))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parts_are_found_like_the_type_they_make() {
        let store = TypeStore::new();
        let target = Sym {
            file: FileId(3),
            id: crate::bind::SymbolId(4),
        };
        let types = [TypeId::STRING, TypeId::NUMBER];
        let flags = [ElemFlags::REQUIRED, ElemFlags::OPTIONAL];
        let decls = [(FileId(3), FnId(5))];
        let all = [
            TypeParts::Union(&types),
            TypeParts::Intersection(&types),
            TypeParts::Ref {
                target,
                args: &types,
            },
            TypeParts::Ref { target, args: &[] },
            TypeParts::Tuple {
                elems: &types,
                flags: &flags,
                readonly: true,
            },
            TypeParts::Fns {
                decls: &decls,
                mapper: MapperId::IDENTITY,
            },
        ];
        for parts in all {
            assert_eq!(spread_hash(&parts), spread_hash(&parts.to_data()));
            let made = store.intern_parts(parts);
            assert_eq!(store.intern(parts.to_data()), made);
            assert_eq!(store.intern_parts(parts), made);
        }
    }
}
