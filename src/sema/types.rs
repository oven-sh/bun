//! Types, signatures and type-parameter mappings, hash-consed: equal ones have equal ids, whichever thread made them.
//!
//! An object type says where it comes from (a declaration, a piece of syntax, and what the type parameters around it
//! stand for), not what is in it. What is in it is asked of the checker, which works it out once.

use crate::atom::Atom;
use crate::hir::{ExprId, FnId, TypeNodeId, TypeParamId};
use crate::program::{FileId, Sym};
use crate::util::{AppendVec, GrowingPlaces, SHARDS, shard_of, spread_hash};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct TypeId(pub u32);
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct SigId(pub u32);
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct MapperId(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Intrinsic {
    /// The resolver does not know. Behaves like `any`, and spreads.
    Unresolved,
    Any,
    Unknown,
    Never,
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
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ElemFlags: u8 {
        const REQUIRED = 1;
        const OPTIONAL = 2;
        const REST = 4;
        /// `...T` where `T` is a type parameter.
        const VARIADIC = 8;
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
    /// `{ a: 1 }`, as the type of the expression: known to have nothing but what is written.
    ObjectLiteral(FileId, ExprId),
    /// The same once it is the type of a variable, a result, a type argument: an ordinary object type.
    WidenedLiteral(FileId, ExprId),
    /// The constructor function of a class, with its static members.
    ClassStatic(Sym),
    /// A function declaration with all its overloads, and the namespace merged with it.
    Function(Sym),
    EnumObject(Sym),
    /// A module or namespace, as a value.
    Module(Sym),
    /// What `import * as ns` names when it is not the module as it stands (`resolveESModuleSymbol`, `cloneTypeAsModuleType`):
    /// the properties and index signatures of `module` (a module, or what it `export =`s), no call or construct signatures,
    /// and, if `with_default`, over them a `default` that is `module` itself.
    Namespace {
        module: Sym,
        with_default: bool,
    },
    /// `globalThis`
    GlobalThis,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypeData {
    Intrinsic(Intrinsic),
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
    /// The symbol one declaration holds. `id` tells declarations of a file apart.
    UniqueSymbol {
        file: FileId,
        id: u32,
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
    /// `NoInfer<T>`, for as long as `T` mentions type parameters: `T`, but nothing is inferred to it.
    NoInfer(TypeId),
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
    }
}

/// Where the type of a property comes from.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum PropSource {
    Type(TypeId),
    /// Members of classes, interfaces and type literals that declare it: overloads, a getter and a setter, merged declarations.
    Members(Box<[(FileId, crate::hir::MemberId)]>),
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
    Mapped(TypeId, bool),
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct Prop {
    pub name: Atom,
    pub flags: PropFlags,
    pub source: PropSource,
    /// What to instantiate the type `source` gives with.
    pub mapper: MapperId,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct IndexInfo {
    pub key: TypeId,
    pub value: TypeId,
    pub readonly: bool,
}

/// What is in an object type.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Default)]
pub struct Shape {
    /// In declaration order, own before inherited.
    pub props: Vec<Prop>,
    pub call: Vec<SigId>,
    pub construct: Vec<SigId>,
    pub index: Vec<IndexInfo>,
    pub literal: Literalness,
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

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct SigParam {
    pub name: Atom,
    pub ty: TypeId,
    pub optional: bool,
    pub rest: bool,
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
    /// `base`: which of the construct signatures of what it extends it takes after.
    DefaultConstruct {
        class: Sym,
        base: u32,
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
        const HAS_MARKER = 4;
    }
}

pub struct TypeRecord {
    pub data: TypeData,
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
        let spread = spread_hash(&key);
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
            |i| spread_hash(key_of(self.items.get(i))),
        )
    }
}

pub type Mapping = Box<[(TypeId, TypeId)]>;

pub struct TypeStore {
    types: Interned<TypeRecord>,
    sigs: Interned<SigData>,
    mappers: Interned<(Mapping, TypeFlags)>,
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
}

impl TypeId {
    /// `false | true`
    pub const BOOLEAN: TypeId = TypeId(WELL_KNOWN.len() as u32);
    /// `{}`
    pub const EMPTY_OBJECT: TypeId = TypeId(WELL_KNOWN.len() as u32 + 1);

    /// `undefined` and `null` come in kinds that flags, facts and relations do not tell apart: the ordinary one of the kind.
    #[inline]
    pub fn plain(self) -> TypeId {
        match self {
            TypeId::MISSING | TypeId::UNDEFINED_DECLARED => TypeId::UNDEFINED,
            TypeId::NULL_DECLARED => TypeId::NULL,
            ty => ty,
        }
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
        assert_eq!(store.mapper(Vec::new()), MapperId::IDENTITY);
        store
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &TypeData {
        &self.types.items.get(id.0).data
    }

    /// The members of a union, nothing for `never`, and any other type on its own.
    #[inline]
    pub fn parts(&self, id: TypeId) -> &[TypeId] {
        let record = self.types.items.get(id.0);
        match &record.data {
            TypeData::Union(members) => members,
            TypeData::Intrinsic(Intrinsic::Never) => &[],
            _ => std::slice::from_ref(&record.id),
        }
    }

    #[inline]
    pub fn flags(&self, id: TypeId) -> TypeFlags {
        self.types.items.get(id.0).flags
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
                    | (self.mappers.items.get(around.0).1 & TypeFlags::HAS_UNRESOLVED)
            }
            TypeData::ThisParam(_) => TypeFlags::HAS_TYPE_VARIABLES,
            TypeData::Marker(_) => TypeFlags::HAS_TYPE_VARIABLES | TypeFlags::HAS_MARKER,
            TypeData::Union(t) | TypeData::Intersection(t) => all(t),
            TypeData::Ref { args, .. } | TypeData::LazyAlias { args, .. } => all(args),
            TypeData::Tuple { elems, .. } => all(elems),
            // Whoever makes one leaves the mapper out unless there are type parameters around the origin.
            TypeData::Anon { mapper, .. }
            | TypeData::Fns { mapper, .. }
            | TypeData::Cond { mapper, .. } => self.mappers.items.get(mapper.0).1,
            TypeData::Synth(shape) => {
                let mut flags = TypeFlags::empty();
                for p in &shape.props {
                    if let PropSource::Type(t) = p.source {
                        flags |= self.flags(t);
                    }
                    flags |= self.mappers.items.get(p.mapper.0).1;
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
            TypeData::Keyof(t) | TypeData::NoInfer(t) | TypeData::StringMapping { ty: t, .. } => {
                self.flags(*t)
            }
            TypeData::Template { types, .. } => all(types),
            _ => TypeFlags::empty(),
        }
    }

    pub fn sig_flags(&self, sig: SigId) -> TypeFlags {
        match self.sig(sig) {
            SigData::Decl { mapper, .. }
            | SigData::DefaultConstruct { mapper, .. }
            | SigData::Construct { mapper, .. } => self.mappers.items.get(mapper.0).1,
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

    pub fn intern(&self, data: TypeData) -> TypeId {
        TypeId(self.types.intern(
            data,
            |record| &record.data,
            |data, id| TypeRecord {
                flags: self.flags_of(&data),
                data,
                id: TypeId(id),
                manifest: AtomicBool::new(false),
            },
        ))
    }

    /// `ObjectFlagsFromTypeNode`, `ObjectFlagsArrayLiteral`: `id` was made by a type node or an array literal, not by
    /// instantiation. `made_before` is `len()` from just before it was interned: a type that was there already stays what it
    /// was first made as (`createTypeReferenceEx`).
    pub fn mark_manifest(&self, id: TypeId, made_before: u32) {
        if id.0 >= made_before {
            self.types
                .items
                .get(id.0)
                .manifest
                .store(true, Ordering::Relaxed);
        }
    }

    #[inline]
    pub fn is_manifest(&self, id: TypeId) -> bool {
        self.types.items.get(id.0).manifest.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn sig(&self, id: SigId) -> &SigData {
        self.sigs.items.get(id.0)
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
        SigId(self.sigs.intern(data, |data| data, |data, _| data))
    }

    /// `pairs` need not be sorted. A parameter mapped to itself stays: it says that the origin depends on it.
    pub fn mapper(&self, mut pairs: Vec<(TypeId, TypeId)>) -> MapperId {
        pairs.sort_unstable_by_key(|p| p.0);
        pairs.dedup_by_key(|p| p.0);
        let key: Mapping = pairs.into_boxed_slice();
        MapperId(self.mappers.intern(
            key,
            |mapper| &mapper.0,
            |key, _| {
                let flags = key
                    .iter()
                    .fold(TypeFlags::empty(), |f, p| f | self.flags(p.1));
                (key, flags)
            },
        ))
    }

    #[inline]
    pub fn mapping(&self, id: MapperId) -> &[(TypeId, TypeId)] {
        &self.mappers.items.get(id.0).0
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
