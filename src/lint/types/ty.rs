//! `ts.Type`

use super::signature::SignatureList;
use super::symbol::SymbolList;
use super::{
    ElementFlags, IndexInfo, IndexKind, Locate, ObjectFlags, SignatureKind, TsSymbol, TypeFacts,
    TypeFlags, TypeFormatFlags,
};
use crate::ast::{File, MappedModifier};
use bun_sema::check::services::{Relation, Structure, TupleInfo, TypeOp, TypeTest};
use bun_sema::types::TypeId;

/// `type.value` of a literal type: a string, a number, or a `PseudoBigInt`.
pub use bun_sema::check::services::LiteralValue as Literal;

/// `ts.Type`
///
/// Two types are `==` where TypeScript has one object: types are interned.
#[derive(Copy, Clone)]
pub struct Type<'a> {
    file: &'a File<'a>,
    id: TypeId,
}

impl PartialEq for Type<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for Type<'_> {}
impl std::hash::Hash for Type<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}
impl std::fmt::Debug for Type<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Type({})", bstr::BStr::new(&self.to_text()))
    }
}

/// A list of types: the constituents of a union, type arguments.
#[derive(Copy, Clone)]
pub struct TypeList<'a> {
    file: &'a File<'a>,
    ids: &'a [TypeId],
    /// The one element, if `ids` is empty.
    one: Option<TypeId>,
}

impl<'a> TypeList<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, ids: &'a [TypeId]) -> Self {
        TypeList {
            file,
            ids,
            one: None,
        }
    }

    /// `[ty]`
    #[inline]
    pub(crate) fn one(ty: Type<'a>) -> Self {
        TypeList {
            file: ty.file,
            ids: &[],
            one: Some(ty.id),
        }
    }

    #[inline]
    pub fn len(self) -> usize {
        self.ids.len() + usize::from(self.one.is_some())
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn get(self, i: usize) -> Option<Type<'a>> {
        let id = self
            .ids
            .get(i)
            .copied()
            .or_else(|| self.one.filter(|_| i == 0))?;
        Some(Type::new(self.file, id))
    }

    #[inline]
    pub fn first(self) -> Option<Type<'a>> {
        self.get(0)
    }

    #[inline]
    pub fn last(self) -> Option<Type<'a>> {
        self.get(self.len().checked_sub(1)?)
    }

    #[inline]
    pub fn iter(self) -> TypeIter<'a> {
        TypeIter {
            file: self.file,
            ids: self.ids.iter(),
            one: self.one,
        }
    }

    #[inline]
    pub fn contains(self, ty: Type<'a>) -> bool {
        self.iter().any(|it| it == ty)
    }
}

impl std::fmt::Debug for TypeList<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}

impl<'a> IntoIterator for TypeList<'a> {
    type Item = Type<'a>;
    type IntoIter = TypeIter<'a>;
    #[inline]
    fn into_iter(self) -> TypeIter<'a> {
        self.iter()
    }
}

#[derive(Clone)]
pub struct TypeIter<'a> {
    file: &'a File<'a>,
    ids: std::slice::Iter<'a, TypeId>,
    one: Option<TypeId>,
}

impl<'a> Iterator for TypeIter<'a> {
    type Item = Type<'a>;
    #[inline]
    fn next(&mut self) -> Option<Type<'a>> {
        let id = self.ids.next().copied().or_else(|| self.one.take())?;
        Some(Type::new(self.file, id))
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let len = self.ids.len() + usize::from(self.one.is_some());
        (len, Some(len))
    }
}
impl DoubleEndedIterator for TypeIter<'_> {
    #[inline]
    fn next_back(&mut self) -> Option<Self::Item> {
        let id = self.ids.next_back().copied().or_else(|| self.one.take())?;
        Some(Type::new(self.file, id))
    }
}
impl ExactSizeIterator for TypeIter<'_> {}

/// `ts.TupleType`: `reference.target` of a tuple type.
#[derive(Copy, Clone, Debug)]
pub struct TupleTarget<'a> {
    info: TupleInfo<'a>,
}

impl<'a> TupleTarget<'a> {
    /// `target.elementFlags`, one for each type argument.
    #[inline]
    pub fn element_flags(self) -> &'a [ElementFlags] {
        self.info.element_flags
    }

    /// `target.combinedFlags`: all of them.
    #[inline]
    pub fn combined_flags(self) -> ElementFlags {
        self.info.combined_flags
    }

    /// `target.readonly`
    #[inline]
    pub fn readonly(self) -> bool {
        self.info.readonly
    }

    /// `target.minLength`: the number of required elements.
    #[inline]
    pub fn min_length(self) -> usize {
        self.info.min_length as usize
    }

    /// `target.fixedLength`: the number of elements before the first `...`.
    #[inline]
    pub fn fixed_length(self) -> usize {
        self.info.fixed_length as usize
    }

    /// `target.hasRestElement`
    #[inline]
    pub fn has_rest_element(self) -> bool {
        self.info.combined_flags.intersects(ElementFlags::VARIABLE)
    }
}

/// The parts of a type that is neither a union, an intersection nor an object type.
#[derive(Copy, Clone, Debug)]
pub enum TypeStructure<'a> {
    /// `ts.ConditionalType`: `checkType extends extendsType ? .. : ..`
    Conditional {
        check_type: Type<'a>,
        extends_type: Type<'a>,
        /// `root.isDistributive`
        is_distributive: bool,
        /// `checker.getTypeFromTypeNode(root.node.trueType)`, which is not instantiated.
        root_true_type: Type<'a>,
        /// `checker.getTypeFromTypeNode(root.node.falseType)`
        root_false_type: Type<'a>,
    },
    /// `ts.IndexedAccessType`: `objectType[indexType]`
    IndexedAccess {
        object_type: Type<'a>,
        index_type: Type<'a>,
    },
    /// `ts.IndexType`: `keyof type`
    Index {
        ty: Type<'a>,
    },
    /// `ts.MappedType`: `{ [typeParameter in constraintType as nameType]: templateType }`
    Mapped {
        type_parameter: Type<'a>,
        constraint_type: Type<'a>,
        name_type: Option<Type<'a>>,
        template_type: Type<'a>,
        /// `getMappedTypeModifiers`
        readonly: MappedModifier,
        optional: MappedModifier,
    },
    /// `ts.TemplateLiteralType`. There is one more text than types.
    TemplateLiteral {
        texts: &'a [&'a [u8]],
        types: TypeList<'a>,
    },
    /// `ts.StringMappingType`: `Uppercase<type>`
    StringMapping {
        ty: Type<'a>,
    },
    /// `ts.SubstitutionType`
    Substitution {
        base_type: Type<'a>,
        constraint: Type<'a>,
    },
    Other,
}

macro_rules! type_ops {
    ($($(#[$doc:meta])* $name:ident $op:ident;)*) => {
        $($(#[$doc])*
        pub fn $name(self) -> Type<'a> {
            self.op(TypeOp::$op).unwrap_or(self)
        })*
    };
}

macro_rules! optional_type_ops {
    ($($(#[$doc:meta])* $name:ident $op:ident;)*) => {
        $($(#[$doc])*
        pub fn $name(self) -> Option<Type<'a>> {
            self.op(TypeOp::$op)
        })*
    };
}

macro_rules! type_tests {
    ($($(#[$doc:meta])* $name:ident $test:ident;)*) => {
        $($(#[$doc])*
        pub fn $name(self) -> bool {
            self.file.query(|q| q.type_test(TypeTest::$test, self.id))
        })*
    };
}

macro_rules! flag_tests {
    ($($(#[$doc:meta])* $name:ident $flags:ident;)*) => {
        $($(#[$doc])*
        #[inline]
        pub fn $name(self) -> bool {
            self.flags().intersects(TypeFlags::$flags)
        })*
    };
}

impl<'a> Type<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: TypeId) -> Self {
        Type { file, id }
    }

    #[inline]
    fn list(self, ids: &'a [TypeId]) -> TypeList<'a> {
        TypeList::new(self.file, ids)
    }

    #[inline]
    fn op(self, op: TypeOp) -> Option<Type<'a>> {
        let id = self.file.query(|q| q.type_op(op, self.id))?;
        Some(Type::new(self.file, id))
    }

    /// The number of the type in the checker. It means nothing after the file is linted.
    #[inline]
    pub fn id(self) -> TypeId {
        self.id
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    // ───────────────────────────── fields ─────────────────────────────

    /// `type.flags`, `type.getFlags()`. Of the type itself: a union has `UNION`, not the flags of
    /// its constituents. For those, [`utils::get_type_flags`](super::utils::get_type_flags).
    pub fn flags(self) -> TypeFlags {
        self.file.query(|q| q.type_flags(self.id))
    }

    /// `tsutils.isTypeFlagSet(type, flags)`: of the type itself.
    #[inline]
    pub fn has_flags(self, flags: TypeFlags) -> bool {
        self.flags().intersects(flags)
    }

    /// `type.objectFlags`. Empty for what is not an object type.
    pub fn object_flags(self) -> ObjectFlags {
        self.file.query(|q| q.object_flags(self.id))
    }

    /// `type.symbol`, `type.getSymbol()`
    pub fn symbol(self) -> Option<TsSymbol<'a>> {
        let id = self.file.query(|q| q.symbol_of_type(self.id))?;
        Some(TsSymbol::new(self.file, id))
    }

    /// `type.getSymbol()`
    #[inline]
    pub fn get_symbol(self) -> Option<TsSymbol<'a>> {
        self.symbol()
    }

    /// `type.aliasSymbol`: the type alias that it was written as.
    pub fn alias_symbol(self) -> Option<TsSymbol<'a>> {
        let id = self.file.query(|q| q.alias_symbol(self.id))?;
        Some(TsSymbol::new(self.file, id))
    }

    /// `type.aliasTypeArguments`. Empty where TypeScript has `undefined`.
    pub fn alias_type_arguments(self) -> TypeList<'a> {
        self.list(self.file.query(|q| q.alias_type_arguments(self.id)))
    }

    /// `type.types` of a union or an intersection. Empty for any other type.
    ///
    /// See [`tsutils::union_constituents`](super::tsutils::union_constituents), which yields the
    /// type itself if it is not a union.
    pub fn types(self) -> TypeList<'a> {
        self.list(self.file.query(|q| q.constituents(self.id)))
    }

    /// `type.value` of a string, number or bigint literal type, also of a member of an enum.
    pub fn value(self) -> Option<Literal<'a>> {
        self.file.query(|q| q.literal_value(self.id))
    }

    /// `type.value` of a string literal type.
    pub fn string_value(self) -> Option<&'a [u8]> {
        match self.value()? {
            Literal::String(value) => Some(value),
            _ => None,
        }
    }

    /// `type.value` of a number literal type.
    pub fn number_value(self) -> Option<f64> {
        match self.value()? {
            Literal::Number(value) => Some(value),
            _ => None,
        }
    }

    /// `type.intrinsicName`: `"any"`, `"error"`, `"unknown"`, `"string"`, `"true"`, `"false"`, ..
    pub fn intrinsic_name(self) -> Option<&'static str> {
        self.file.query(|q| q.intrinsic_name(self.id))
    }

    /// `reference.target`: the generic class or interface that it is an instantiation of, which
    /// for a type that has no type arguments is the type itself. A tuple type is its own target
    /// here: see [`Type::tuple_target`].
    pub fn target(self) -> Option<Type<'a>> {
        self.op(TypeOp::Target)
    }

    /// `type.target === other.target`
    pub fn has_same_target_as(self, other: Type<'a>) -> bool {
        match (self.is_tuple_type(), other.is_tuple_type()) {
            (true, true) => self
                .file
                .query(|q| q.is_related(Relation::SameTupleTarget, self.id, other.id)),
            (false, false) => self.target().is_some() && self.target() == other.target(),
            _ => false,
        }
    }

    /// `reference.target` of a tuple type.
    pub fn tuple_target(self) -> Option<TupleTarget<'a>> {
        let info = self.file.query(|q| q.tuple_info(self.id))?;
        Some(TupleTarget { info })
    }

    /// `checkType`, `objectType`, `templateType` and the like.
    pub fn structure(self) -> TypeStructure<'a> {
        let ty = |id: TypeId| Type::new(self.file, id);
        match self.file.query(|q| q.structure(self.id)) {
            Structure::Conditional {
                check,
                extends,
                is_distributive,
                root_true_type,
                root_false_type,
            } => TypeStructure::Conditional {
                check_type: ty(check),
                extends_type: ty(extends),
                is_distributive,
                root_true_type: ty(root_true_type),
                root_false_type: ty(root_false_type),
            },
            Structure::IndexedAccess { object, index } => TypeStructure::IndexedAccess {
                object_type: ty(object),
                index_type: ty(index),
            },
            Structure::Index { ty: of } => TypeStructure::Index { ty: ty(of) },
            Structure::Mapped {
                type_parameter,
                constraint,
                name_type,
                template,
                readonly,
                optional,
            } => TypeStructure::Mapped {
                type_parameter: ty(type_parameter),
                constraint_type: ty(constraint),
                name_type: name_type.map(ty),
                template_type: ty(template),
                readonly,
                optional,
            },
            Structure::TemplateLiteral { texts, types } => TypeStructure::TemplateLiteral {
                texts,
                types: self.list(types),
            },
            Structure::StringMapping { ty: of } => TypeStructure::StringMapping { ty: ty(of) },
            Structure::Substitution { base, constraint } => TypeStructure::Substitution {
                base_type: ty(base),
                constraint: ty(constraint),
            },
            Structure::Other => TypeStructure::Other,
        }
    }

    // ───────────────────────────── what kind of type it is ─────────────────────────────

    flag_tests! {
        /// `type.isUnion()`. `boolean` and an enum with several members are unions.
        is_union UNION;
        /// `type.isIntersection()`
        is_intersection INTERSECTION;
        /// `type.isUnionOrIntersection()`
        is_union_or_intersection UNION_OR_INTERSECTION;
        /// `type.isStringLiteral()`
        is_string_literal STRING_LITERAL;
        /// `type.isNumberLiteral()`
        is_number_literal NUMBER_LITERAL;
        /// `type.isTypeParameter()`
        is_type_parameter TYPE_PARAMETER;
    }

    /// `type.isLiteral()`: a string, number or bigint literal type. Not `true` and `false`.
    #[inline]
    pub fn is_literal(self) -> bool {
        self.flags()
            .intersects(TypeFlags::STRING_OR_NUMBER_LITERAL | TypeFlags::BIG_INT_LITERAL)
    }

    /// `type.isClassOrInterface()`: the declared type of a class or an interface.
    pub fn is_class_or_interface(self) -> bool {
        self.object_flags()
            .intersects(ObjectFlags::CLASS_OR_INTERFACE)
    }

    /// `type.isClass()`
    pub fn is_class(self) -> bool {
        self.object_flags().intersects(ObjectFlags::CLASS)
    }

    type_tests! {
        /// `checker.isArrayType(type)`: `T[]` or `readonly T[]`.
        is_array_type Array;
        /// `readonly T[]`, `ReadonlyArray<T>`
        is_readonly_array_type ReadonlyArray;
        /// `checker.isTupleType(type)`
        is_tuple_type Tuple;
        /// `checker.isArrayLikeType(type)`
        is_array_like_type ArrayLike;
        /// `tsutils.isIntrinsicErrorType(type)`: the type of what is in error. It has
        /// [`TypeFlags::ANY`].
        is_error Error;
        /// The checker gave up on it: a cycle or a limit. It has [`TypeFlags::ANY`]. TypeScript
        /// has no such type, so there is nothing to report for it.
        is_unresolved Unresolved;
        /// `isThisTypeParameter(type)`: the `this` type of a class or an interface.
        is_this_type_parameter ThisTypeParameter;
        /// `isFreshLiteralType(type)`
        is_fresh_literal FreshLiteral;
        /// `isNonDeferredTypeReference(type)`
        is_non_deferred_type_reference NonDeferredTypeReference;
        /// `isEmptyAnonymousObjectType(type)`: `{}`
        is_empty_anonymous_object_type EmptyAnonymousObject;
    }

    /// `isArrayOrTupleType(type)`
    pub fn is_array_or_tuple_type(self) -> bool {
        self.is_array_type() || self.is_tuple_type()
    }

    /// `hasTypeFacts(type, facts)`: some value of the type has one of them.
    pub fn has_type_facts(self, facts: TypeFacts) -> bool {
        self.file.query(|q| q.has_type_facts(self.id, facts))
    }

    /// `checker.isNullableType(type)`: `undefined` or `null` is among its values.
    pub fn is_nullable_type(self) -> bool {
        self.has_type_facts(TypeFacts::IS_UNDEFINED_OR_NULL)
    }

    // ───────────────────────────── relations ─────────────────────────────

    /// `checker.isTypeAssignableTo(type, target)`
    pub fn is_assignable_to(self, target: Type<'a>) -> bool {
        self.file
            .query(|q| q.is_related(Relation::Assignable, self.id, target.id))
    }

    /// `isTypeIdenticalTo(type, other)`
    pub fn is_identical_to(self, other: Type<'a>) -> bool {
        self.file
            .query(|q| q.is_related(Relation::Identical, self.id, other.id))
    }

    /// `isTypeSubtypeOf(type, target)`
    pub fn is_subtype_of(self, target: Type<'a>) -> bool {
        self.file
            .query(|q| q.is_related(Relation::Subtype, self.id, target.id))
    }

    /// `isTypeStrictSubtypeOf(type, target)`
    pub fn is_strict_subtype_of(self, target: Type<'a>) -> bool {
        self.file
            .query(|q| q.is_related(Relation::StrictSubtype, self.id, target.id))
    }

    /// `isTypeComparableTo(type, target)`
    pub fn is_comparable_to(self, target: Type<'a>) -> bool {
        self.file
            .query(|q| q.is_related(Relation::Comparable, self.id, target.id))
    }

    /// The order in which TypeScript lists the constituents of a union. The numbers of types have
    /// no order.
    pub fn compare(self, other: Type<'a>) -> std::cmp::Ordering {
        let order = self.file.query(|q| q.compare_types(self.id, other.id));
        order.unwrap_or(std::cmp::Ordering::Equal)
    }

    // ───────────────────────────── types made from it ─────────────────────────────

    type_ops! {
        /// `checker.getApparentType(type)`: `String` for `string`, the constraint for a type
        /// parameter.
        get_apparent_type Apparent;
        /// `checker.getWidenedType(type)`
        get_widened_type Widened;
        /// `getWidenedLiteralType(type)`: `string` for `"a"`, also in a union.
        get_widened_literal_type WidenedLiteral;
        /// `checker.getBaseTypeOfLiteralType(type)`
        get_base_type_of_literal_type BaseTypeOfLiteral;
        /// `getRegularTypeOfLiteralType(type)`
        get_regular_type_of_literal_type Regular;
        /// `getFreshTypeOfLiteralType(type)`
        get_fresh_type_of_literal_type Fresh;
        /// `checker.getNonNullableType(type)`, `type.getNonNullableType()`
        get_non_nullable_type NonNullable;
        /// `getReducedType(type)`
        get_reduced_type Reduced;
        /// `getReducedApparentType(type)`
        get_reduced_apparent_type ReducedApparent;
        /// `getIndexType(type)`: `keyof type`
        get_index_type Keyof;
        /// `removeDefinitelyFalsyTypes(type)`
        remove_definitely_falsy_types RemoveDefinitelyFalsy;
        /// `extractDefinitelyFalsyTypes(type)`
        extract_definitely_falsy_types ExtractDefinitelyFalsy;
        /// `removeMissingType(type, true)`: without the `undefined` that a `?` adds.
        get_non_optional_type NonOptional;
    }

    optional_type_ops! {
        /// `checker.getBaseConstraintOfType(type)`. `None`: it is not a type variable, or it has
        /// no constraint.
        get_base_constraint_of_type BaseConstraint;
        /// `type.getConstraint()`, which is `checker.getBaseConstraintOfType(type)`.
        get_constraint BaseConstraint;
        /// `getConstraintOfTypeParameter(type)`: the constraint as it is declared.
        get_constraint_of_type_parameter ConstraintOfTypeParameter;
        /// `type.getDefault()`
        get_default DefaultOfTypeParameter;
        /// `checker.getAwaitedType(type)`
        get_awaited_type Awaited;
        /// `getPromisedTypeOfPromise(type)`
        get_promised_type_of_promise PromisedTypeOfPromise;
        /// `InterfaceType.thisType`
        this_type ThisType;
        /// `getModifiersTypeFromMappedType(type)`, `type.modifiersType`: the `T` of
        /// `{ [P in keyof T]: .. }`.
        get_modifiers_type_from_mapped_type ModifiersTypeOfMapped;
        /// The type of `x` in `for (const x of value)`.
        get_iterated_type Iterated;
        /// The type of `x` in `for await (const x of value)`.
        get_async_iterated_type AsyncIterated;
    }

    /// `checker.getTypeArguments(type)`, of a reference to a class, an interface, an array or a
    /// tuple type. As in TypeScript the `this` type can follow the arguments that are written.
    pub fn get_type_arguments(self) -> TypeList<'a> {
        self.list(self.file.query(|q| q.type_arguments(self.id)))
    }

    /// `checker.getBaseTypes(type)`, `type.getBaseTypes()`: what the class or the interface
    /// extends. Empty unless [`Type::is_class_or_interface`].
    pub fn get_base_types(self) -> TypeList<'a> {
        self.list(self.file.query(|q| q.base_types(self.id)))
    }

    /// `getIndexedAccessTypeOrUndefined(type, index)`. `in_expression`:
    /// `AccessFlags.ExpressionPosition`, which adds `undefined` under `noUncheckedIndexedAccess`.
    pub fn get_indexed_access_type(self, index: Type<'a>, in_expression: bool) -> Option<Type<'a>> {
        let id = self
            .file
            .query(|q| q.indexed_access_type(self.id, index.id, in_expression))?;
        Some(Type::new(self.file, id))
    }

    /// `getAssignmentReducedType(type, assigned)`
    pub fn get_assignment_reduced_type(self, assigned: Type<'a>) -> Type<'a> {
        Type::new(
            self.file,
            self.file
                .query(|q| q.assignment_reduced_type(self.id, assigned.id)),
        )
    }

    /// `getTypeWithDefault(type, defaultExpression)`
    pub fn get_type_with_default(self, default: impl Locate<'a>) -> Type<'a> {
        let default = default.locate(self.file).raw();
        Type::new(
            self.file,
            self.file.query(|q| q.type_with_default(self.id, default)),
        )
    }

    // ───────────────────────────── members ─────────────────────────────

    /// `type.getProperties()`, `checker.getPropertiesOfType(type)`
    pub fn get_properties(self) -> SymbolList<'a> {
        SymbolList::new(
            self.file,
            self.file.query(|q| q.properties_of_type(self.id)),
        )
    }

    /// `type.getProperty(name)`, `checker.getPropertyOfType(type, name)`
    pub fn get_property(self, name: &[u8]) -> Option<TsSymbol<'a>> {
        let id = self.file.query(|q| q.property_of_type(self.id, name))?;
        Some(TsSymbol::new(self.file, id))
    }

    /// `checker.getTypeOfPropertyOfType(type, name)`
    pub fn get_type_of_property(self, name: &[u8]) -> Option<Type<'a>> {
        let id = self
            .file
            .query(|q| q.type_of_property_of_type(self.id, name))?;
        Some(Type::new(self.file, id))
    }

    /// `getTypeOfPropertyOrIndexSignatureOfType(type, name)`
    pub fn get_type_of_property_or_index_signature(self, name: &[u8]) -> Option<Type<'a>> {
        let id = self
            .file
            .query(|q| q.type_of_property_or_index_signature_of_type(self.id, name))?;
        Some(Type::new(self.file, id))
    }

    /// `checker.getIndexInfosOfType(type)`
    pub fn get_index_infos(self) -> impl ExactSizeIterator<Item = IndexInfo<'a>> + 'a {
        let file = self.file;
        let infos = file.query(|q| q.index_infos_of_type(self.id));
        infos.iter().map(move |&info| IndexInfo::new(file, info))
    }

    /// `checker.getIndexInfoOfType(type, kind)`: the index signature whose key is exactly `string`
    /// or `number`.
    pub fn get_index_info(self, kind: IndexKind) -> Option<IndexInfo<'a>> {
        let key = match kind {
            IndexKind::String => TypeId::STRING,
            IndexKind::Number => TypeId::NUMBER,
        };
        self.get_index_infos()
            .find(|info| info.key_type().id == key)
    }

    /// `getApplicableIndexInfo(type, keyType)`: the index signature that a key of that type reads.
    pub fn get_applicable_index_info(self, key: Type<'a>) -> Option<IndexInfo<'a>> {
        let info = self
            .file
            .query(|q| q.applicable_index_info(self.id, key.id))?;
        Some(IndexInfo::new(self.file, info))
    }

    /// `type.getStringIndexType()`
    pub fn get_string_index_type(self) -> Option<Type<'a>> {
        self.get_index_info(IndexKind::String).map(|info| info.ty())
    }

    /// `type.getNumberIndexType()`
    pub fn get_number_index_type(self) -> Option<Type<'a>> {
        self.get_index_info(IndexKind::Number).map(|info| info.ty())
    }

    /// `checker.getSignaturesOfType(type, kind)`
    pub fn get_signatures(self, kind: SignatureKind) -> SignatureList<'a> {
        SignatureList::new(
            self.file,
            self.file.query(|q| q.signatures_of_type(self.id, kind)),
        )
    }

    /// `type.getCallSignatures()`
    pub fn get_call_signatures(self) -> SignatureList<'a> {
        self.get_signatures(SignatureKind::Call)
    }

    /// `type.getConstructSignatures()`
    pub fn get_construct_signatures(self) -> SignatureList<'a> {
        self.get_signatures(SignatureKind::Construct)
    }

    // ───────────────────────────── printing ─────────────────────────────

    /// `checker.typeToString(type)`
    pub fn to_text(self) -> Vec<u8> {
        self.file
            .query(|q| q.type_to_string(self.id, None, TypeFormatFlags::DEFAULT))
    }

    /// `checker.typeToString(type, enclosingDeclaration, flags)`
    pub fn to_text_with(
        self,
        enclosing: Option<super::TsNode<'a>>,
        flags: TypeFormatFlags,
    ) -> Vec<u8> {
        let enclosing = enclosing.map(|node| node.raw());
        self.file
            .query(|q| q.type_to_string(self.id, enclosing, flags))
    }
}
