//! The words in which [`Services`](super::Services) is asked and answers: TypeScript's flags, and
//! plain values that have no lifetime of the checker in them.

use crate::bind::SymFlags;
use crate::hir::{self, Flags};
use crate::node::{Node, Part};
use crate::program::FileId;
use crate::types::{TypeId, tf};

bitflags::bitflags! {
    /// `ts.TypeFlags`. The names and the meanings are TypeScript's, the numbers are not those of
    /// TypeScript 5.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct TypeFlags: u32 {
        const ANY = tf::ANY;
        const UNKNOWN = tf::UNKNOWN;
        const UNDEFINED = tf::UNDEFINED;
        const NULL = tf::NULL;
        const VOID = tf::VOID;
        const STRING = tf::STRING;
        const NUMBER = tf::NUMBER;
        const BIG_INT = tf::BIGINT;
        /// `boolean`, which is also the `UNION` of `false` and `true`.
        const BOOLEAN = tf::BOOLEAN;
        const ES_SYMBOL = tf::ES_SYMBOL;
        const STRING_LITERAL = tf::STRING_LITERAL;
        const NUMBER_LITERAL = tf::NUMBER_LITERAL;
        const BIG_INT_LITERAL = tf::BIGINT_LITERAL;
        const BOOLEAN_LITERAL = tf::BOOLEAN_LITERAL;
        const UNIQUE_ES_SYMBOL = tf::UNIQUE_ES_SYMBOL;
        /// Always combined with `STRING_LITERAL`, `NUMBER_LITERAL` or `UNION`.
        const ENUM_LITERAL = tf::ENUM_LITERAL;
        /// A computed member of a numeric enum, or an enum without members.
        const ENUM = tf::ENUM;
        /// `object`
        const NON_PRIMITIVE = tf::NON_PRIMITIVE;
        const NEVER = tf::NEVER;
        const TYPE_PARAMETER = tf::TYPE_PARAMETER;
        const OBJECT = tf::OBJECT;
        /// `keyof T`
        const INDEX = tf::INDEX;
        const TEMPLATE_LITERAL = tf::TEMPLATE_LITERAL;
        /// `Uppercase<T>` and the like.
        const STRING_MAPPING = tf::STRING_MAPPING;
        const SUBSTITUTION = tf::SUBSTITUTION;
        /// `T[K]`
        const INDEXED_ACCESS = tf::INDEXED_ACCESS;
        /// `T extends U ? X : Y`
        const CONDITIONAL = tf::CONDITIONAL;
        const UNION = tf::UNION;
        const INTERSECTION = tf::INTERSECTION;

        const ANY_OR_UNKNOWN = tf::ANY | tf::UNKNOWN;
        const NULLABLE = tf::NULLABLE;
        const LITERAL = tf::LITERAL;
        const UNIT = tf::UNIT;
        const FRESHABLE = tf::ENUM | tf::LITERAL;
        const STRING_OR_NUMBER_LITERAL = tf::STRING_LITERAL | tf::NUMBER_LITERAL;
        const STRING_OR_NUMBER_LITERAL_OR_UNIQUE = tf::STRING_LITERAL | tf::NUMBER_LITERAL | tf::UNIQUE_ES_SYMBOL;
        const DEFINITELY_FALSY = tf::STRING_LITERAL | tf::NUMBER_LITERAL | tf::BIGINT_LITERAL | tf::BOOLEAN_LITERAL
            | tf::VOID | tf::UNDEFINED | tf::NULL;
        const POSSIBLY_FALSY = Self::DEFINITELY_FALSY.bits() | tf::STRING | tf::NUMBER | tf::BIGINT | tf::BOOLEAN;
        const INTRINSIC = tf::ANY | tf::UNKNOWN | tf::STRING | tf::NUMBER | tf::BIGINT | tf::BOOLEAN | tf::BOOLEAN_LITERAL
            | tf::ES_SYMBOL | tf::VOID | tf::UNDEFINED | tf::NULL | tf::NEVER | tf::NON_PRIMITIVE;
        const STRING_LIKE = tf::STRING_LIKE;
        const NUMBER_LIKE = tf::NUMBER_LIKE;
        const BIG_INT_LIKE = tf::BIGINT_LIKE;
        const BOOLEAN_LIKE = tf::BOOLEAN_LIKE;
        const ENUM_LIKE = tf::ENUM_LIKE;
        const ES_SYMBOL_LIKE = tf::ES_SYMBOL_LIKE;
        const VOID_LIKE = tf::VOID_LIKE;
        const PRIMITIVE = tf::PRIMITIVE;
        const DEFINITELY_NON_NULLABLE = tf::DEFINITELY_NON_NULLABLE;
        const DISJOINT_DOMAINS = tf::DISJOINT_DOMAINS;
        const UNION_OR_INTERSECTION = tf::UNION_OR_INTERSECTION;
        const STRUCTURED_TYPE = tf::OBJECT | tf::UNION | tf::INTERSECTION;
        const TYPE_VARIABLE = tf::TYPE_VARIABLE;
        const INSTANTIABLE_NON_PRIMITIVE = tf::INSTANTIABLE_NON_PRIMITIVE;
        const INSTANTIABLE_PRIMITIVE = tf::INDEX | tf::TEMPLATE_LITERAL | tf::STRING_MAPPING;
        const INSTANTIABLE = Self::INSTANTIABLE_NON_PRIMITIVE.bits() | Self::INSTANTIABLE_PRIMITIVE.bits();
        const STRUCTURED_OR_INSTANTIABLE = tf::STRUCTURED_OR_INSTANTIABLE;
        const OBJECT_FLAGS_TYPE = tf::ANY | tf::NULLABLE | tf::NEVER | tf::OBJECT | tf::UNION | tf::INTERSECTION;
        const SIMPLIFIABLE = tf::INDEXED_ACCESS | tf::CONDITIONAL;
        const SINGLETON = tf::SINGLETON;
        const NARROWABLE = tf::ANY | tf::UNKNOWN | tf::STRUCTURED_OR_INSTANTIABLE | tf::STRING_LIKE | tf::NUMBER_LIKE
            | tf::BIGINT_LIKE | tf::BOOLEAN_LIKE | tf::ES_SYMBOL | tf::UNIQUE_ES_SYMBOL | tf::NON_PRIMITIVE;
    }
}

bitflags::bitflags! {
    /// `ts.ObjectFlags`, those that say what kind of object type a type is.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ObjectFlags: u32 {
        /// The declared type of a class.
        const CLASS = 1 << 0;
        /// The declared type of an interface.
        const INTERFACE = 1 << 1;
        /// A reference to a generic class, interface, array or tuple type.
        const REFERENCE = 1 << 2;
        /// In TypeScript the target of a tuple type has it. Here a tuple type is its own target.
        const TUPLE = 1 << 3;
        const ANONYMOUS = 1 << 4;
        const MAPPED = 1 << 5;
        /// An instantiation of an anonymous or a mapped type.
        const INSTANTIATED = 1 << 6;
        /// The type of an object literal.
        const OBJECT_LITERAL = 1 << 7;
        const EVOLVING_ARRAY = 1 << 8;
        const REVERSE_MAPPED = 1 << 10;
        const JSX_ATTRIBUTES = 1 << 11;
        const JS_LITERAL = 1 << 12;
        const FRESH_LITERAL = 1 << 13;
        const ARRAY_LITERAL = 1 << 14;
        const OBJECT_REST_TYPE = 1 << 22;
        /// The type of `f<T>`.
        const INSTANTIATION_EXPRESSION_TYPE = 1 << 23;
        const SINGLE_SIGNATURE_TYPE = 1 << 27;

        const CLASS_OR_INTERFACE = Self::CLASS.bits() | Self::INTERFACE.bits();
    }
}

bitflags::bitflags! {
    /// `ts.SymbolFlags`, with TypeScript's numbers.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct SymbolFlags: u32 {
        const FUNCTION_SCOPED_VARIABLE = 1 << 0;
        const BLOCK_SCOPED_VARIABLE = 1 << 1;
        const PROPERTY = 1 << 2;
        const ENUM_MEMBER = 1 << 3;
        const FUNCTION = 1 << 4;
        const CLASS = 1 << 5;
        const INTERFACE = 1 << 6;
        const CONST_ENUM = 1 << 7;
        const REGULAR_ENUM = 1 << 8;
        const VALUE_MODULE = 1 << 9;
        const NAMESPACE_MODULE = 1 << 10;
        const TYPE_LITERAL = 1 << 11;
        const OBJECT_LITERAL = 1 << 12;
        const METHOD = 1 << 13;
        const CONSTRUCTOR = 1 << 14;
        const GET_ACCESSOR = 1 << 15;
        const SET_ACCESSOR = 1 << 16;
        const SIGNATURE = 1 << 17;
        const TYPE_PARAMETER = 1 << 18;
        const TYPE_ALIAS = 1 << 19;
        const EXPORT_VALUE = 1 << 20;
        const ALIAS = 1 << 21;
        const PROTOTYPE = 1 << 22;
        const EXPORT_STAR = 1 << 23;
        const OPTIONAL = 1 << 24;
        const TRANSIENT = 1 << 25;
        const ASSIGNMENT = 1 << 26;
        const MODULE_EXPORTS = 1 << 27;

        const ENUM = Self::REGULAR_ENUM.bits() | Self::CONST_ENUM.bits();
        const VARIABLE = Self::FUNCTION_SCOPED_VARIABLE.bits() | Self::BLOCK_SCOPED_VARIABLE.bits();
        const VALUE = Self::VARIABLE.bits() | Self::PROPERTY.bits() | Self::ENUM_MEMBER.bits() | Self::OBJECT_LITERAL.bits()
            | Self::FUNCTION.bits() | Self::CLASS.bits() | Self::ENUM.bits() | Self::VALUE_MODULE.bits() | Self::METHOD.bits()
            | Self::GET_ACCESSOR.bits() | Self::SET_ACCESSOR.bits();
        const TYPE = Self::CLASS.bits() | Self::INTERFACE.bits() | Self::ENUM.bits() | Self::ENUM_MEMBER.bits()
            | Self::TYPE_LITERAL.bits() | Self::TYPE_PARAMETER.bits() | Self::TYPE_ALIAS.bits();
        const NAMESPACE = Self::VALUE_MODULE.bits() | Self::NAMESPACE_MODULE.bits() | Self::ENUM.bits();
        const MODULE = Self::VALUE_MODULE.bits() | Self::NAMESPACE_MODULE.bits();
        const ACCESSOR = Self::GET_ACCESSOR.bits() | Self::SET_ACCESSOR.bits();
        const PROPERTY_OR_ACCESSOR = Self::PROPERTY.bits() | Self::ACCESSOR.bits();
        const CLASS_MEMBER = Self::METHOD.bits() | Self::ACCESSOR.bits() | Self::PROPERTY.bits();
        const MODULE_MEMBER = Self::VARIABLE.bits() | Self::FUNCTION.bits() | Self::CLASS.bits() | Self::INTERFACE.bits()
            | Self::ENUM.bits() | Self::MODULE.bits() | Self::TYPE_ALIAS.bits() | Self::ALIAS.bits();
    }
}

const SYMBOL_FLAGS: [(SymFlags, SymbolFlags); 27] = [
    (SymFlags::FUNCTION_SCOPED_VARIABLE, SymbolFlags::FUNCTION_SCOPED_VARIABLE),
    (SymFlags::BLOCK_SCOPED_VARIABLE, SymbolFlags::BLOCK_SCOPED_VARIABLE),
    (SymFlags::PROPERTY, SymbolFlags::PROPERTY),
    (SymFlags::ENUM_MEMBER, SymbolFlags::ENUM_MEMBER),
    (SymFlags::FUNCTION, SymbolFlags::FUNCTION),
    (SymFlags::CLASS, SymbolFlags::CLASS),
    (SymFlags::INTERFACE, SymbolFlags::INTERFACE),
    (SymFlags::CONST_ENUM, SymbolFlags::CONST_ENUM),
    (SymFlags::REGULAR_ENUM, SymbolFlags::REGULAR_ENUM),
    (SymFlags::VALUE_MODULE, SymbolFlags::VALUE_MODULE),
    (SymFlags::NAMESPACE_MODULE, SymbolFlags::NAMESPACE_MODULE),
    (SymFlags::TYPE_LITERAL, SymbolFlags::TYPE_LITERAL),
    (SymFlags::OBJECT_LITERAL, SymbolFlags::OBJECT_LITERAL),
    (SymFlags::METHOD, SymbolFlags::METHOD),
    (SymFlags::CONSTRUCTOR, SymbolFlags::CONSTRUCTOR),
    (SymFlags::GET_ACCESSOR, SymbolFlags::GET_ACCESSOR),
    (SymFlags::SET_ACCESSOR, SymbolFlags::SET_ACCESSOR),
    (SymFlags::SIGNATURE, SymbolFlags::SIGNATURE),
    (SymFlags::TYPE_PARAMETER, SymbolFlags::TYPE_PARAMETER),
    (SymFlags::TYPE_ALIAS, SymbolFlags::TYPE_ALIAS),
    (SymFlags::EXPORT_VALUE, SymbolFlags::EXPORT_VALUE),
    (SymFlags::ALIAS, SymbolFlags::ALIAS),
    (SymFlags::TRANSIENT, SymbolFlags::TRANSIENT),
    (SymFlags::ASSIGNMENT, SymbolFlags::ASSIGNMENT),
    (SymFlags::MODULE_EXPORTS, SymbolFlags::MODULE_EXPORTS),
    // A parameter is a `FunctionScopedVariable`, which the binder sets too.
    (SymFlags::PARAMETER, SymbolFlags::FUNCTION_SCOPED_VARIABLE),
    (SymFlags::REPLACEABLE_BY_METHOD, SymbolFlags::empty()),
];

impl From<SymFlags> for SymbolFlags {
    fn from(flags: SymFlags) -> SymbolFlags {
        let known = SYMBOL_FLAGS.iter().filter(|it| flags.contains(it.0));
        known.fold(SymbolFlags::empty(), |all, it| all | it.1)
    }
}

impl From<SymbolFlags> for SymFlags {
    fn from(flags: SymbolFlags) -> SymFlags {
        let known = SYMBOL_FLAGS[..25].iter().filter(|it| flags.contains(it.1));
        known.fold(SymFlags::empty(), |all, it| all | it.0)
    }
}

bitflags::bitflags! {
    /// `ts.CheckFlags`, those of a property that the checker has made.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct CheckFlags: u32 {
        /// An instantiation of a declared member.
        const INSTANTIATED = 1 << 0;
        /// A property of a union or an intersection.
        const SYNTHETIC_PROPERTY = 1 << 1;
        /// The same, where all of them are methods.
        const SYNTHETIC_METHOD = 1 << 2;
        const READONLY = 1 << 3;
        /// Some constituents of the union do not have it.
        const READ_PARTIAL = 1 << 4;
        const WRITE_PARTIAL = 1 << 5;
        const HAS_NON_UNIFORM_TYPE = 1 << 6;
        const HAS_LITERAL_TYPE = 1 << 7;
        const CONTAINS_PUBLIC = 1 << 8;
        const CONTAINS_PROTECTED = 1 << 9;
        const CONTAINS_PRIVATE = 1 << 10;
        const CONTAINS_STATIC = 1 << 11;
        /// A property of a mapped type.
        const MAPPED = 1 << 18;
        const STRIP_OPTIONAL = 1 << 19;
        const REVERSE_MAPPED = 1 << 13;

        const SYNTHETIC = Self::SYNTHETIC_PROPERTY.bits() | Self::SYNTHETIC_METHOD.bits();
        const PARTIAL = Self::READ_PARTIAL.bits() | Self::WRITE_PARTIAL.bits();
    }
}

bitflags::bitflags! {
    /// `ts.ModifierFlags`, with TypeScript's numbers.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ModifierFlags: u32 {
        const PUBLIC = 1 << 0;
        const PRIVATE = 1 << 1;
        const PROTECTED = 1 << 2;
        const READONLY = 1 << 3;
        const OVERRIDE = 1 << 4;
        const EXPORT = 1 << 5;
        const ABSTRACT = 1 << 6;
        const AMBIENT = 1 << 7;
        const STATIC = 1 << 8;
        const ACCESSOR = 1 << 9;
        const ASYNC = 1 << 10;
        const DEFAULT = 1 << 11;
        const CONST = 1 << 12;
        const IN = 1 << 13;
        const OUT = 1 << 14;
        const DECORATOR = 1 << 15;
        const DEPRECATED = 1 << 16;

        const ACCESSIBILITY_MODIFIER = Self::PUBLIC.bits() | Self::PRIVATE.bits() | Self::PROTECTED.bits();
        const PARAMETER_PROPERTY_MODIFIER = Self::ACCESSIBILITY_MODIFIER.bits() | Self::READONLY.bits() | Self::OVERRIDE.bits();
        const NON_PUBLIC_ACCESSIBILITY_MODIFIER = Self::PRIVATE.bits() | Self::PROTECTED.bits();
        const EXPORT_DEFAULT = Self::EXPORT.bits() | Self::DEFAULT.bits();
    }
}

impl From<Flags> for ModifierFlags {
    /// The modifiers among the flags of a node of the HIR.
    fn from(flags: Flags) -> ModifierFlags {
        const MODIFIERS: [(Flags, ModifierFlags); 15] = [
            (Flags::PUBLIC, ModifierFlags::PUBLIC),
            (Flags::PRIVATE, ModifierFlags::PRIVATE),
            (Flags::PROTECTED, ModifierFlags::PROTECTED),
            (Flags::READONLY, ModifierFlags::READONLY),
            (Flags::OVERRIDE, ModifierFlags::OVERRIDE),
            (Flags::EXPORT, ModifierFlags::EXPORT),
            (Flags::ABSTRACT, ModifierFlags::ABSTRACT),
            (Flags::AMBIENT, ModifierFlags::AMBIENT),
            (Flags::STATIC, ModifierFlags::STATIC),
            (Flags::ACCESSOR, ModifierFlags::ACCESSOR),
            (Flags::ASYNC, ModifierFlags::ASYNC),
            (Flags::DEFAULT, ModifierFlags::DEFAULT),
            (Flags::CONST, ModifierFlags::CONST),
            (Flags::IN, ModifierFlags::IN),
            (Flags::OUT, ModifierFlags::OUT),
        ];
        let known = MODIFIERS.iter().filter(|it| flags.contains(it.0));
        known.fold(ModifierFlags::empty(), |all, it| all | it.1)
    }
}

bitflags::bitflags! {
    /// `ts.NodeFlags`, those that rules look at.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct NodeFlags: u32 {
        const LET = 1 << 0;
        const CONST = 1 << 1;
        const USING = 1 << 2;
        const AWAIT_USING = Self::CONST.bits() | Self::USING.bits();
        /// `namespace a {}`, not `module a {}`.
        const NAMESPACE = 1 << 5;
        const OPTIONAL_CHAIN = 1 << 6;
        /// `declare global {}`
        const GLOBAL_AUGMENTATION = 1 << 11;
        const AMBIENT = 1 << 25;
        const IN_WITH_STATEMENT = 1 << 26;
        const BLOCK_SCOPED = Self::LET.bits() | Self::CONST.bits() | Self::USING.bits();
    }
}

bitflags::bitflags! {
    /// `ts.ElementFlags`: the kind of an element of a tuple type.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ElementFlags: u8 {
        /// `T`
        const REQUIRED = 1 << 0;
        /// `T?`
        const OPTIONAL = 1 << 1;
        /// `...T[]`
        const REST = 1 << 2;
        /// `...T`
        const VARIADIC = 1 << 3;
        const FIXED = Self::REQUIRED.bits() | Self::OPTIONAL.bits();
        const VARIABLE = Self::REST.bits() | Self::VARIADIC.bits();
        const NON_REQUIRED = Self::OPTIONAL.bits() | Self::REST.bits() | Self::VARIADIC.bits();
        const NON_REST = Self::REQUIRED.bits() | Self::OPTIONAL.bits() | Self::VARIADIC.bits();
    }
}

bitflags::bitflags! {
    /// `ts.TypeFormatFlags`, those that change what `typeToString` prints.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct TypeFormatFlags: u32 {
        const NO_TRUNCATION = 1 << 0;
        /// `Array<T>` for `T[]`.
        const WRITE_ARRAY_AS_GENERIC_TYPE = 1 << 1;
        const USE_STRUCTURAL_FALLBACK = 1 << 3;
        const WRITE_TYPE_ARGUMENTS_OF_SIGNATURE = 1 << 5;
        const USE_FULLY_QUALIFIED_TYPE = 1 << 6;
        const SUPPRESS_ANY_RETURN_TYPE = 1 << 8;
        const MULTILINE_OBJECT_LITERALS = 1 << 10;
        const WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL = 1 << 11;
        const USE_TYPE_OF_FUNCTION = 1 << 12;
        const OMIT_PARAMETER_MODIFIERS = 1 << 13;
        const USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE = 1 << 14;
        const USE_SINGLE_QUOTES_FOR_STRING_LITERAL_TYPE = 1 << 28;
        const NO_TYPE_REDUCTION = 1 << 29;
        const ALLOW_UNIQUE_ES_SYMBOL_TYPE = 1 << 20;
        const IN_TYPE_ALIAS = 1 << 23;
    }
}

impl TypeFormatFlags {
    /// What `typeToString(type)` uses when it is given no flags.
    pub const DEFAULT: TypeFormatFlags =
        TypeFormatFlags::ALLOW_UNIQUE_ES_SYMBOL_TYPE.union(TypeFormatFlags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE);
}

bitflags::bitflags! {
    /// `TypeFacts`, those that are asked for from outside the checker.
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct TypeFacts: u8 {
        const TRUTHY = 1 << 0;
        const FALSY = 1 << 1;
        /// `x == undefined`, `x == null` can be true.
        const EQ_UNDEFINED_OR_NULL = 1 << 2;
        const IS_UNDEFINED = 1 << 3;
        const IS_NULL = 1 << 4;
        const IS_UNDEFINED_OR_NULL = Self::IS_UNDEFINED.bits() | Self::IS_NULL.bits();
    }
}

/// `ts.SignatureKind`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum SignatureKind {
    Call,
    Construct,
}

/// `ts.IndexKind`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum IndexKind {
    String,
    Number,
}

/// `ts.TypePredicateKind`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypePredicateKind {
    /// `this is T`
    This,
    /// `x is T`
    Identifier,
    /// `asserts this`, `asserts this is T`
    AssertsThis,
    /// `asserts x`, `asserts x is T`
    AssertsIdentifier,
}

/// `ts.UnionReduction`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum UnionReduction {
    None,
    Literal,
    Subtype,
}

/// A node of a file of the program, as TypeScript's syntax tree has it.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct NodeRef {
    pub file: FileId,
    pub node: Node,
}

/// A node of the file at hand, named by what the HIR stores for it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Row {
    File,
    Node(Node),
    Expr(hir::ExprId),
    /// The expression with the parentheses around it.
    Parenthesized(hir::ExprId),
    Stmt(hir::StmtId),
    Type(hir::TypeNodeId),
    Pat(hir::PatId),
    PatProp(hir::PatPropId),
    PatElem(hir::PatElemId),
    Fn(hir::FnId),
    Class(hir::ClassId),
    Param(hir::ParamId),
    TypeParam(hir::TypeParamId),
    Member(hir::MemberId),
    Prop(hir::PropId),
    VarDecl(hir::VarDeclId),
    Case(hir::CaseId),
    EnumMember(hir::EnumMemberId),
    ImportSpec(hir::ImportSpecId),
    ExportSpec(hir::ExportSpecId),
    TupleElem(hir::TupleElemId),
    Name(hir::NameId),
    /// The innermost node that starts at this offset and is a name or a literal.
    NameAt(u32),
}

/// A [`Row`], or a node that is derived from one: its name, its body.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Location {
    pub row: Row,
    pub part: Option<Part>,
}

impl From<Row> for Location {
    #[inline]
    fn from(row: Row) -> Location {
        Location { row, part: None }
    }
}

impl Location {
    #[inline]
    pub fn part(row: Row, part: Part) -> Location {
        Location {
            row,
            part: Some(part),
        }
    }
}

/// What the checker calls a symbol, for as long as a [`Services`](super::Services) lives: equal
/// numbers are the same symbol.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SymbolRef(pub u32);

/// A child of a node that has a name in TypeScript's syntax tree.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Child {
    /// `node.name`
    Name,
    /// `node.propertyName`
    PropertyName,
    /// `node.expression`
    Expression,
    /// `node.initializer`
    Initializer,
    /// `node.type`
    Type,
    /// `node.body`
    Body,
}

/// A function from a type to a type.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypeOp {
    /// `getApparentType`
    Apparent,
    /// `getBaseConstraintOfType`
    BaseConstraint,
    /// `getConstraintOfTypeParameter`
    ConstraintOfTypeParameter,
    /// `getDefaultFromTypeParameter`
    DefaultOfTypeParameter,
    /// `getAwaitedType`
    Awaited,
    /// `getPromisedTypeOfPromise`
    PromisedTypeOfPromise,
    /// `getWidenedType`
    Widened,
    /// `getWidenedLiteralType`
    WidenedLiteral,
    /// `getBaseTypeOfLiteralType`
    BaseTypeOfLiteral,
    /// `getRegularTypeOfLiteralType`
    Regular,
    /// `getFreshTypeOfLiteralType`
    Fresh,
    /// `getNonNullableType`
    NonNullable,
    /// `getReducedType`
    Reduced,
    /// `getReducedApparentType`
    ReducedApparent,
    /// `getIndexType`: `keyof T`
    Keyof,
    /// `removeDefinitelyFalsyTypes`
    RemoveDefinitelyFalsy,
    /// `extractDefinitelyFalsyTypes`
    ExtractDefinitelyFalsy,
    /// `reference.target`
    Target,
    /// `InterfaceType.thisType`
    ThisType,
    /// The element type of what `for (.. of ..)` iterates over.
    Iterated,
    /// The same for `for await`.
    AsyncIterated,
    /// `getNonOptionalType`, `removeMissingType`: without the `undefined` of a `?`.
    NonOptional,
}

/// A property of a type that is true or false.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypeTest {
    /// `isArrayType`: `T[]`, `readonly T[]`
    Array,
    /// `isReadonlyArrayType`
    ReadonlyArray,
    /// `isTupleType`
    Tuple,
    /// `isArrayLikeType`
    ArrayLike,
    /// `isErrorType`
    Error,
    /// The checker gave up: a cycle or a limit. It has `TypeFlags::ANY`, and nothing should be
    /// reported for it.
    Unresolved,
    /// `isThisTypeParameter`
    ThisTypeParameter,
    /// `isFreshLiteralType`
    FreshLiteral,
    /// `isThenableType` of the checker
    Thenable,
    /// `type.isClassOrInterface()`
    ClassOrInterface,
    /// `isNonDeferredTypeReference`
    NonDeferredTypeReference,
    /// `isEmptyAnonymousObjectType`: `{}`
    EmptyAnonymousObject,
    /// `isGenericType`
    Generic,
}

/// A relation between two types.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Relation {
    Assignable,
    Identical,
    Subtype,
    StrictSubtype,
    Comparable,
}

/// A function from a symbol to a symbol.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum SymbolOp {
    /// `getAliasedSymbol`
    Aliased,
    /// `getImmediateAliasedSymbol`
    ImmediateAliased,
    /// `getExportSymbolOfSymbol`
    ExportSymbol,
    /// `symbol.parent`
    Parent,
    /// `getMergedSymbol`
    Merged,
}

/// A list of symbols that belongs to a symbol.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum SymbolTable {
    /// `getExportsOfModule`
    ExportsOfModule,
    /// `symbol.exports`
    Exports,
    /// `symbol.members`
    Members,
}

/// `type.value` of a literal type.
#[derive(Copy, Clone, PartialEq, Debug)]
pub enum LiteralValue<'a> {
    String(&'a [u8]),
    Number(f64),
    /// `PseudoBigInt`
    BigInt { negative: bool, base10: &'a [u8] },
}

/// What a type is made of, where that is not a list of types.
#[derive(Copy, Clone, PartialEq, Debug)]
pub enum Structure<'a> {
    /// `check extends extends ? .. : ..`
    Conditional {
        check: TypeId,
        extends: TypeId,
        /// `root.isDistributive`
        is_distributive: bool,
    },
    /// `object[index]`
    IndexedAccess { object: TypeId, index: TypeId },
    /// `keyof ty`
    Index { ty: TypeId },
    /// `{ [type_parameter in constraint as name_type]: template }`
    Mapped {
        type_parameter: TypeId,
        constraint: TypeId,
        name_type: Option<TypeId>,
        template: TypeId,
        readonly: hir::MappedModifier,
        optional: hir::MappedModifier,
    },
    /// `` `${types[0]}..` ``, with one more text than types.
    TemplateLiteral {
        texts: &'a [&'a [u8]],
        types: &'a [TypeId],
    },
    /// `Uppercase<ty>`
    StringMapping { ty: TypeId },
    Substitution { base: TypeId, constraint: TypeId },
    Other,
}

/// `TupleType`: what the target of a tuple type knows.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct TupleInfo<'a> {
    pub element_flags: &'a [ElementFlags],
    /// The number of required elements.
    pub min_length: u32,
    /// The number of elements before the first that is `VARIABLE`.
    pub fixed_length: u32,
    /// All of `element_flags`.
    pub combined_flags: ElementFlags,
    pub readonly: bool,
}

/// `ts.IndexInfo`
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct IndexInfoData {
    pub key_type: TypeId,
    pub ty: TypeId,
    pub is_readonly: bool,
    pub declaration: Option<NodeRef>,
}

/// `ts.TypePredicate`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct TypePredicateData<'a> {
    pub kind: TypePredicateKind,
    pub parameter_name: &'a [u8],
    pub parameter_index: Option<u32>,
    pub ty: Option<TypeId>,
}

/// What a `ts.Symbol` has as fields.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SymbolInfo<'a> {
    /// `symbol.escapedName`. Where TypeScript begins an internal name with `__`, this begins with
    /// the byte 0xFE.
    pub name: &'a [u8],
    pub flags: SymbolFlags,
    pub check_flags: CheckFlags,
    /// The symbol of the binder, if it is one of the file at hand.
    pub local: Option<crate::bind::SymbolId>,
}

/// What a `ts.Signature` has as fields.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SignatureInfo<'a> {
    pub parameters: &'a [SymbolRef],
    pub type_parameters: &'a [TypeId],
    pub this_parameter: Option<SymbolRef>,
    pub declaration: Option<NodeRef>,
    pub min_argument_count: u32,
    /// `signatureHasRestParameter`
    pub has_rest_parameter: bool,
}

/// What a `ts.SourceFile` and the `ts.Program` know about a file.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct FileInfo<'a> {
    /// `sourceFile.fileName`
    pub file_name: &'a [u8],
    /// `program.isSourceFileDefaultLibrary`
    pub is_default_library: bool,
    /// `program.isSourceFileFromExternalLibrary`
    pub is_from_external_library: bool,
    pub is_declaration_file: bool,
    pub is_javascript: bool,
    /// `isExternalModule`
    pub is_external_module: bool,
    /// `program.sourceFileToPackageName`: the name of the package in `node_modules` that it is
    /// part of.
    pub package_name: Option<&'a [u8]>,
}

/// `ts.CompilerOptions`, as far as rules read them. What `strict` implies is resolved.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct CompilerOptions {
    pub strict_null_checks: bool,
    pub strict_function_types: bool,
    pub strict_bind_call_apply: bool,
    pub strict_property_initialization: bool,
    pub strict_builtin_iterator_return: bool,
    pub no_implicit_any: bool,
    pub no_implicit_this: bool,
    pub no_implicit_returns: bool,
    pub no_implicit_override: bool,
    pub use_unknown_in_catch_variables: bool,
    pub no_unchecked_indexed_access: bool,
    pub no_property_access_from_index_signature: bool,
    pub no_fallthrough_cases_in_switch: bool,
    pub exact_optional_property_types: bool,
    pub isolated_modules: bool,
    pub isolated_declarations: bool,
    pub verbatim_module_syntax: bool,
    pub erasable_syntax_only: bool,
    pub experimental_decorators: bool,
    pub emit_decorator_metadata: bool,
    pub allow_synthetic_default_imports: bool,
    pub es_module_interop: bool,
    pub use_define_for_class_fields: bool,
    pub allow_js: bool,
    pub check_js: bool,
    pub resolve_json_module: bool,
    pub preserve_const_enums: bool,
    pub target: crate::resolve::ScriptTarget,
    pub module: crate::resolve::ModuleKind,
}
