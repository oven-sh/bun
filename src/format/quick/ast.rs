//! The kinds and flags of the JavaScript tree. How nodes are laid out: arena.rs

use crate::{Quick, Words};

#[allow(non_upper_case_globals)]
pub(crate) mod k {
    pub(crate) const None: i32 = 0;
    pub(crate) const Program: i32 = 1;
    // leaves
    pub(crate) const Identifier: i32 = 2;
    pub(crate) const PrivateName: i32 = 3;
    pub(crate) const StringLiteral: i32 = 4;
    pub(crate) const NumericLiteral: i32 = 5;
    pub(crate) const BigIntLiteral: i32 = 6;
    pub(crate) const BooleanLiteral: i32 = 7;
    pub(crate) const NullLiteral: i32 = 8;
    pub(crate) const RegExpLiteral: i32 = 9;
    pub(crate) const TemplateElement: i32 = 10;
    pub(crate) const ThisExpression: i32 = 11;
    pub(crate) const Super: i32 = 12;
    pub(crate) const DirectiveLiteral: i32 = 14;
    pub(crate) const EmptyStatement: i32 = 15;
    pub(crate) const DebuggerStatement: i32 = 16;
    pub(crate) const JSXText: i32 = 17;
    pub(crate) const JSXIdentifier: i32 = 18;
    pub(crate) const JSXEmptyExpression: i32 = 19;
    pub(crate) const JSXOpeningFragment: i32 = 20;
    pub(crate) const JSXClosingFragment: i32 = 21;
    // expressions
    pub(crate) const TemplateLiteral: i32 = 27;
    pub(crate) const TaggedTemplateExpression: i32 = 28;
    pub(crate) const ArrayExpression: i32 = 29;
    pub(crate) const ObjectExpression: i32 = 30;
    pub(crate) const ObjectProperty: i32 = 31;
    pub(crate) const ObjectMethod: i32 = 32;
    pub(crate) const SpreadElement: i32 = 33;
    pub(crate) const RestElement: i32 = 34;
    pub(crate) const FunctionExpression: i32 = 35;
    pub(crate) const FunctionDeclaration: i32 = 36;
    pub(crate) const ArrowFunctionExpression: i32 = 37;
    pub(crate) const ClassExpression: i32 = 38;
    pub(crate) const ClassDeclaration: i32 = 39;
    pub(crate) const ClassBody: i32 = 40;
    pub(crate) const ClassMethod: i32 = 41;
    pub(crate) const ClassProperty: i32 = 42;
    pub(crate) const StaticBlock: i32 = 43;
    pub(crate) const UnaryExpression: i32 = 44;
    pub(crate) const UpdateExpression: i32 = 45;
    pub(crate) const BinaryExpression: i32 = 46;
    pub(crate) const LogicalExpression: i32 = 47;
    pub(crate) const AssignmentExpression: i32 = 48;
    pub(crate) const ConditionalExpression: i32 = 49;
    pub(crate) const CallExpression: i32 = 50;
    pub(crate) const NewExpression: i32 = 51;
    pub(crate) const ImportExpression: i32 = 52;
    pub(crate) const MemberExpression: i32 = 53;
    pub(crate) const SequenceExpression: i32 = 54;
    pub(crate) const YieldExpression: i32 = 55;
    pub(crate) const AwaitExpression: i32 = 56;
    pub(crate) const MetaProperty: i32 = 57;
    pub(crate) const ParenthesizedExpression: i32 = 58;
    pub(crate) const AssignmentPattern: i32 = 59;
    pub(crate) const ArrayPattern: i32 = 60;
    pub(crate) const ObjectPattern: i32 = 61;
    pub(crate) const Decorator: i32 = 62;
    // statements
    pub(crate) const ExpressionStatement: i32 = 66;
    pub(crate) const BlockStatement: i32 = 67;
    pub(crate) const WithStatement: i32 = 68;
    pub(crate) const ReturnStatement: i32 = 69;
    pub(crate) const ThrowStatement: i32 = 70;
    pub(crate) const LabeledStatement: i32 = 71;
    pub(crate) const BreakStatement: i32 = 72;
    pub(crate) const ContinueStatement: i32 = 73;
    pub(crate) const IfStatement: i32 = 74;
    pub(crate) const SwitchStatement: i32 = 75;
    pub(crate) const SwitchCase: i32 = 76;
    pub(crate) const TryStatement: i32 = 77;
    pub(crate) const CatchClause: i32 = 78;
    pub(crate) const WhileStatement: i32 = 79;
    pub(crate) const DoWhileStatement: i32 = 80;
    pub(crate) const ForStatement: i32 = 81;
    pub(crate) const ForInStatement: i32 = 82;
    pub(crate) const ForOfStatement: i32 = 83;
    pub(crate) const VariableDeclaration: i32 = 84;
    pub(crate) const VariableDeclarator: i32 = 85;
    pub(crate) const Directive: i32 = 86;
    // modules
    pub(crate) const ImportDeclaration: i32 = 87;
    pub(crate) const ImportSpecifier: i32 = 88;
    pub(crate) const ImportDefaultSpecifier: i32 = 89;
    pub(crate) const ImportNamespaceSpecifier: i32 = 90;
    pub(crate) const ImportAttribute: i32 = 91;
    pub(crate) const ExportNamedDeclaration: i32 = 92;
    pub(crate) const ExportSpecifier: i32 = 93;
    pub(crate) const ExportNamespaceSpecifier: i32 = 94;
    pub(crate) const ExportDefaultDeclaration: i32 = 96;
    pub(crate) const ExportAllDeclaration: i32 = 97;
    // JSX
    pub(crate) const JSXElement: i32 = 98;
    pub(crate) const JSXFragment: i32 = 99;
    pub(crate) const JSXOpeningElement: i32 = 100;
    pub(crate) const JSXClosingElement: i32 = 101;
    pub(crate) const JSXAttribute: i32 = 102;
    pub(crate) const JSXSpreadAttribute: i32 = 103;
    pub(crate) const JSXExpressionContainer: i32 = 104;
    pub(crate) const JSXSpreadChild: i32 = 105;
    pub(crate) const JSXNamespacedName: i32 = 106;
    pub(crate) const JSXMemberExpression: i32 = 107;
    /// the root of a text that is one expression: code in HTML
    pub(crate) const JsExpressionRoot: i32 = 109;
    // ---- types. A kind that TypeScript and Flow both have stands for the node of either (TSUnionType, UnionTypeAnnotation):
    // Prettier prints the pair alike nearly everywhere, and where it does not, mode.rs knows which language is running.
    /// `: T`, and `=> T` of a function type
    pub(crate) const TypeAnnotation: i32 = 120;
    /// any, string, this, null .. (TK_*)
    pub(crate) const KeywordType: i32 = 121;
    /// TSTypeReference, GenericTypeAnnotation
    pub(crate) const TypeReference: i32 = 122;
    /// TSQualifiedName, QualifiedTypeIdentifier, QualifiedTypeofIdentifier
    pub(crate) const QualifiedName: i32 = 123;
    pub(crate) const UnionType: i32 = 124;
    pub(crate) const IntersectionType: i32 = 125;
    pub(crate) const ArrayType: i32 = 126;
    pub(crate) const TupleType: i32 = 127;
    /// TSNamedTupleMember, TupleTypeLabeledElement
    pub(crate) const NamedTupleMember: i32 = 128;
    /// TSRestType, TupleTypeSpreadElement
    pub(crate) const RestType: i32 = 129;
    pub(crate) const OptionalType: i32 = 130;
    /// TSFunctionType, FunctionTypeAnnotation
    pub(crate) const FunctionType: i32 = 131;
    pub(crate) const ConstructorType: i32 = 132;
    /// TSCallSignatureDeclaration
    pub(crate) const CallSignature: i32 = 133;
    pub(crate) const ConstructSignature: i32 = 134;
    pub(crate) const MethodSignature: i32 = 135;
    pub(crate) const PropertySignature: i32 = 136;
    pub(crate) const IndexSignature: i32 = 137;
    /// TSTypeLiteral, ObjectTypeAnnotation
    pub(crate) const TypeLiteral: i32 = 138;
    pub(crate) const InterfaceBody: i32 = 139;
    pub(crate) const MappedType: i32 = 140;
    /// TSTypeOperator, KeyofTypeAnnotation, TypeOperator
    pub(crate) const TypeOperator: i32 = 141;
    /// also OptionalIndexedAccessType
    pub(crate) const IndexedAccessType: i32 = 142;
    pub(crate) const ConditionalType: i32 = 143;
    pub(crate) const InferType: i32 = 144;
    /// TSTypeQuery, TypeofTypeAnnotation
    pub(crate) const TypeQuery: i32 = 145;
    pub(crate) const TypePredicate: i32 = 146;
    /// TSLiteralType, StringLiteralTypeAnnotation ..
    pub(crate) const LiteralType: i32 = 147;
    pub(crate) const TemplateLiteralType: i32 = 148;
    pub(crate) const ImportType: i32 = 149;
    pub(crate) const TypeParameterDeclaration: i32 = 150;
    pub(crate) const TypeParameterInstantiation: i32 = 151;
    pub(crate) const TypeParameter: i32 = 152;
    // expressions with types
    /// TSAsExpression, AsExpression, AsConstExpression
    pub(crate) const AsExpression: i32 = 153;
    pub(crate) const SatisfiesExpression: i32 = 154;
    pub(crate) const NonNullExpression: i32 = 155;
    pub(crate) const TypeAssertion: i32 = 156;
    pub(crate) const InstantiationExpression: i32 = 157;
    // declarations
    /// TSTypeAliasDeclaration, TypeAlias, DeclareTypeAlias
    pub(crate) const TypeAlias: i32 = 158;
    /// TSInterfaceDeclaration, InterfaceDeclaration, DeclareInterface
    pub(crate) const InterfaceDeclaration: i32 = 159;
    /// TSInterfaceHeritage, TSClassImplements, InterfaceExtends, ClassImplements
    pub(crate) const Heritage: i32 = 160;
    pub(crate) const EnumDeclaration: i32 = 161;
    pub(crate) const EnumBody: i32 = 162;
    pub(crate) const EnumMember: i32 = 163;
    pub(crate) const ModuleDeclaration: i32 = 164;
    pub(crate) const ModuleBlock: i32 = 165;
    pub(crate) const ExportAssignment: i32 = 166;
    pub(crate) const NamespaceExportDeclaration: i32 = 167;
    pub(crate) const ImportEqualsDeclaration: i32 = 168;
    pub(crate) const ExternalModuleReference: i32 = 169;
    pub(crate) const ParameterProperty: i32 = 170;
    pub(crate) const TSDeclareFunction: i32 = 171;
    /// `?T`; in TypeScript, where these come from JSDoc, also `!T` and `T!` (NT_..)
    pub(crate) const NullableType: i32 = 172;
    // Flow only
    pub(crate) const ObjectTypeProperty: i32 = 173;
    pub(crate) const ObjectTypeIndexer: i32 = 174;
    pub(crate) const ObjectTypeCallProperty: i32 = 175;
    pub(crate) const ObjectTypeInternalSlot: i32 = 176;
    pub(crate) const ObjectTypeSpreadProperty: i32 = 177;
    pub(crate) const ObjectTypeMappedTypeProperty: i32 = 178;
    pub(crate) const FunctionTypeParam: i32 = 179;
    pub(crate) const Variance: i32 = 180;
    pub(crate) const TypeCastExpression: i32 = 181;
    /// InferredPredicate, or DeclaredPredicate if it has a value
    pub(crate) const Predicate: i32 = 182;
    pub(crate) const OpaqueType: i32 = 183;
    pub(crate) const DeclareFunction: i32 = 184;
    pub(crate) const DeclareClass: i32 = 185;
    pub(crate) const DeclareModuleExports: i32 = 186;
    /// InterfaceTypeAnnotation
    pub(crate) const InterfaceType: i32 = 187;
    pub(crate) const ComponentDeclaration: i32 = 188;
    pub(crate) const DeclareComponent: i32 = 189;
    pub(crate) const ComponentTypeAnnotation: i32 = 190;
    pub(crate) const ComponentParameter: i32 = 191;
    pub(crate) const ComponentTypeParameter: i32 = 192;
    pub(crate) const HookDeclaration: i32 = 193;
    pub(crate) const DeclareHook: i32 = 194;
    pub(crate) const HookTypeAnnotation: i32 = 195;
    pub(crate) const MatchExpression: i32 = 196;
    pub(crate) const MatchStatement: i32 = 197;
    pub(crate) const MatchExpressionCase: i32 = 198;
    pub(crate) const MatchStatementCase: i32 = 199;
    pub(crate) const MatchOrPattern: i32 = 200;
    pub(crate) const MatchAsPattern: i32 = 201;
    pub(crate) const MatchWildcardPattern: i32 = 202;
    pub(crate) const MatchLiteralPattern: i32 = 203;
    pub(crate) const MatchUnaryPattern: i32 = 204;
    pub(crate) const MatchIdentifierPattern: i32 = 205;
    pub(crate) const MatchInstancePattern: i32 = 206;
    pub(crate) const MatchInstanceObjectPattern: i32 = 207;
    pub(crate) const MatchMemberPattern: i32 = 208;
    pub(crate) const MatchBindingPattern: i32 = 209;
    pub(crate) const MatchObjectPattern: i32 = 210;
    pub(crate) const MatchObjectPatternProperty: i32 = 211;
    pub(crate) const MatchRestPattern: i32 = 212;
    pub(crate) const MatchArrayPattern: i32 = 213;
    pub(crate) const RecordDeclaration: i32 = 214;
    pub(crate) const RecordDeclarationBody: i32 = 215;
    pub(crate) const RecordDeclarationProperty: i32 = 216;
    pub(crate) const RecordExpression: i32 = 217;
    // A statement that fast.rs has read and printed in one go. The sub-kind is the kind of node that the parser would have made, and start
    // and end are those of that node. No children; two numbers: where the text to print stands, and its length.
    pub(crate) const Ready: i32 = 218;
    // The same for a statement with blocks in it, which the parser has read: `it("a", () => { .. });`, `if (a) { .. } else { .. }`.
    // One list: the blocks. Behind it pairs of numbers, one more than there are blocks: the text in front of each block, without the
    // `{`, and the text behind the last one.
    pub(crate) const ReadyWrap: i32 = 219;
    // A comment that stands alone on its lines in front of a statement or a member of a class: an item of the list like the others, which is what it
    // is printed as. Start and end are those of the comment. One number: its flags (CF_BLOCK ..).
    pub(crate) const ReadyComment: i32 = 220;
    // The statements and comments at the start of a program of which stands.rs has found that they are printed as they stand, at column 0. Start and end are those of the text.
    pub(crate) const ReadyLines: i32 = 221;
}
// ---- flags (bits 8..23 of word 0)
/// was wrapped in parentheses in the source
pub(crate) const F_PAREN: i32 = 1 << 8;
/// has leading comments
pub(crate) const F_LEADING: i32 = 1 << 9;
/// has trailing comments
pub(crate) const F_TRAILING: i32 = 1 << 10;
/// has dangling comments
pub(crate) const F_DANGLING: i32 = 1 << 11;
pub(crate) const F_COMMENTS: i32 = F_LEADING | F_TRAILING | F_DANGLING;
/// the text has bytes outside 0x20..0x7e: its width is not its length
pub(crate) const F_SLOW_TEXT: i32 = 1 << 12;
pub(crate) const F_COMPUTED: i32 = 1 << 13;
pub(crate) const F_SHORTHAND: i32 = 1 << 14;
pub(crate) const F_STATIC: i32 = 1 << 15;
pub(crate) const F_ASYNC: i32 = 1 << 16;
pub(crate) const F_GENERATOR: i32 = 1 << 17;
/// `?.` right here
pub(crate) const F_OPTIONAL: i32 = 1 << 18;
/// Optional{Member,Call}Expression of Babel: part of an optional chain
pub(crate) const F_CHAIN: i32 = 1 << 19;
/// UpdateExpression; also delegate of yield, await of for-of, self_closing, tail
pub(crate) const F_PREFIX: i32 = 1 << 20;
/// a string with a backslash, an identifier with an escape
pub(crate) const F_ESCAPE: i32 = 1 << 21;
/// a string whose content has a quote character
pub(crate) const F_QUOTE: i32 = 1 << 22;
/// kind specific, see the users
pub(crate) const F_EXTRA: i32 = 1 << 23;
// Ready, ReadyWrap: whether the line behind it is empty has been looked at, and it is
/// K.Ready: the text is the source, and it is indented as its lists say (word 6). So it can grow by what follows it in the source, if that stands too.
pub(crate) const F_STANDS: i32 = F_ASYNC;
/// K.Ready: the text is more than one line; the last one is as long as word 7 says
pub(crate) const F_LINES: i32 = F_COMPUTED;
/// K.Ready with F_LINES: where the lines are broken was decided for the column of word 6, and for no other
pub(crate) const F_DECIDED: i32 = F_OPTIONAL;
/// K.ReadyWrap: the first text stays on its line whether it fits or not. K.Ready: `<a />`, in which there is no group and nothing to break.
pub(crate) const F_ANY_WIDTH: i32 = F_CHAIN;
pub(crate) const F_NEXT_LINE_KNOWN: i32 = F_PREFIX;
pub(crate) const F_NEXT_LINE_EMPTY: i32 = F_QUOTE;
pub(crate) const F_DELEGATE: i32 = F_PREFIX;
pub(crate) const F_AWAIT: i32 = F_PREFIX;
pub(crate) const F_SELF_CLOSING: i32 = F_PREFIX;
pub(crate) const F_TAIL: i32 = F_PREFIX;
/// ClassProperty with `accessor`
pub(crate) const F_ACCESSOR: i32 = F_PREFIX;
/// ArrowFunctionExpression
pub(crate) const F_EXPR_BODY: i32 = F_PREFIX;
// Identifier, ObjectPattern, ArrayPattern, RestElement, AssignmentPattern: the two words at EXT_AT[kind] hold something
// (a type annotation, a list of decorators). The words are only there if the parser runs for TypeScript or Flow.
pub(crate) const F_EXT: i32 = F_STATIC;
/// `!` of a ClassProperty or VariableDeclarator
pub(crate) const F_DEFINITE: i32 = F_CHAIN;
/// EnumDeclaration, TypeParameter
pub(crate) const F_CONST: i32 = F_EXTRA;
/// TypePredicate
pub(crate) const F_ASSERTS: i32 = F_EXTRA;
/// TypeParameter
pub(crate) const F_IN: i32 = F_PREFIX;
/// TypeParameter
pub(crate) const F_OUT: i32 = F_STATIC;
/// TypeLiteral of Flow: {| |}
pub(crate) const F_EXACT: i32 = F_EXTRA;
/// TypeLiteral, TupleType, EnumBody of Flow: `...` at the end
pub(crate) const F_INEXACT: i32 = F_PREFIX;
/// ObjectTypeProperty, ObjectTypeInternalSlot
pub(crate) const F_METHOD: i32 = F_ASYNC;
/// ObjectTypeProperty
pub(crate) const F_PROTO: i32 = F_EXTRA;
/// FunctionTypeParam, ComponentTypeParameter
pub(crate) const F_REST: i32 = F_PREFIX;
/// FunctionTypeParam
pub(crate) const F_THIS: i32 = F_STATIC;
/// TypeParameter of Flow: `T extends B`, not `T: B`
pub(crate) const F_EXTENDS_BOUND: i32 = F_COMPUTED;
// (the bit of generators, because few nodes of plain JavaScript have it: print_node() takes a slower way for all that do)
/// JSXText: it is known to be blanks and at least one line feed
pub(crate) const F_BLANK: i32 = F_EXTRA;
/// .. and more than one line feed
pub(crate) const F_BLANK_LINE: i32 = F_SHORTHAND;
/// JSXElement, JSXFragment: the child before it, but for text, is `{}`, maybe with a comment in it
pub(crate) const F_AFTER_EMPTY: i32 = F_EXTRA;
/// a type: printed as it is in the source, because of a "prettier-ignore" that belongs to another node
pub(crate) const F_IGNORED: i32 = F_GENERATOR;
// sub-kinds of methods: the two low bits of the sub-kind
pub(crate) const M_METHOD: i32 = 0;
pub(crate) const M_GET: i32 = 1;
pub(crate) const M_SET: i32 = 2;
pub(crate) const M_CONSTRUCTOR: i32 = 3;
pub(crate) const M_MASK: i32 = 3;
// sub-kinds of VariableDeclaration: the three low bits
pub(crate) const V_VAR: i32 = 0;
pub(crate) const V_LET: i32 = 1;
pub(crate) const V_CONST: i32 = 2;
pub(crate) const V_USING: i32 = 3;
pub(crate) const V_AWAIT_USING: i32 = 4;
pub(crate) const V_MASK: i32 = 7;
// phases of an import: the two low bits
pub(crate) const P_NONE: i32 = 0;
pub(crate) const P_DEFER: i32 = 1;
pub(crate) const P_SOURCE: i32 = 2;
pub(crate) const P_MODULE: i32 = 3;
pub(crate) const P_MASK: i32 = 3;
// import_kind and export_kind: bits 2 and 3 of the sub-kind of declarations and specifiers
pub(crate) const IK_SHIFT: i32 = 2;
pub(crate) const IK_TYPE: i32 = 1;
pub(crate) const IK_TYPEOF: i32 = 2;
pub(crate) const IK_MASK: i32 = 3;
// modifiers, in the sub-kind of class members, signatures, parameter properties and declarations
pub(crate) const MOD_PUBLIC: i32 = 4;
pub(crate) const MOD_PROTECTED: i32 = 8;
pub(crate) const MOD_PRIVATE: i32 = 12;
pub(crate) const MOD_ACCESSIBILITY: i32 = 12;
pub(crate) const MOD_ABSTRACT: i32 = 16;
pub(crate) const MOD_OVERRIDE: i32 = 32;
pub(crate) const MOD_READONLY: i32 = 64;
pub(crate) const MOD_DECLARE: i32 = 128;
// ModuleDeclaration: the two low bits
pub(crate) const MK_NAMESPACE: i32 = 0;
pub(crate) const MK_MODULE: i32 = 1;
pub(crate) const MK_GLOBAL: i32 = 2;
// KeywordType
#[allow(non_upper_case_globals)]
pub(crate) mod type_keyword {
    pub(crate) const Any: i32 = 1;
    pub(crate) const BigInt: i32 = 2;
    pub(crate) const Boolean: i32 = 3;
    pub(crate) const Intrinsic: i32 = 4;
    pub(crate) const Never: i32 = 5;
    pub(crate) const Null: i32 = 6;
    pub(crate) const Number: i32 = 7;
    pub(crate) const Object: i32 = 8;
    pub(crate) const String: i32 = 9;
    pub(crate) const Symbol: i32 = 10;
    pub(crate) const Undefined: i32 = 11;
    pub(crate) const Unknown: i32 = 12;
    pub(crate) const Void: i32 = 13;
    pub(crate) const This: i32 = 14;
    pub(crate) const Mixed: i32 = 15;
    pub(crate) const Empty: i32 = 16;
    /// `*`
    pub(crate) const All: i32 = 17;
}
// NullableType
pub(crate) const NT_NULLABLE: i32 = 0;
pub(crate) const NT_NON_NULLABLE: i32 = 1;
pub(crate) const NT_NON_NULLABLE_POSTFIX: i32 = 2;
// TypeOperator
pub(crate) const TO_KEYOF: i32 = 1;
pub(crate) const TO_UNIQUE: i32 = 2;
pub(crate) const TO_READONLY: i32 = 3;
pub(crate) const TO_RENDERS: i32 = 4;
pub(crate) const TO_RENDERS_MAYBE: i32 = 5;
pub(crate) const TO_RENDERS_STAR: i32 = 6;
// Variance
pub(crate) const VA_PLUS: i32 = 1;
pub(crate) const VA_MINUS: i32 = 2;
pub(crate) const VA_READONLY: i32 = 3;
pub(crate) const VA_WRITEONLY: i32 = 4;
pub(crate) const VA_IN: i32 = 5;
pub(crate) const VA_OUT: i32 = 6;
// TypePredicate of Flow
pub(crate) const TP_ASSERTS: i32 = 1;
pub(crate) const TP_IMPLIES: i32 = 2;
// EnumBody of Flow: the type behind `of`
pub(crate) const EB_NONE: i32 = 0;
pub(crate) const EB_BOOLEAN: i32 = 1;
pub(crate) const EB_NUMBER: i32 = 2;
pub(crate) const EB_BIGINT: i32 = 3;
pub(crate) const EB_STRING: i32 = 4;
pub(crate) const EB_SYMBOL: i32 = 5;
// MappedType: `readonly` in the two low bits, `?` in the next two
pub(crate) const MT_NONE: i32 = 0;
pub(crate) const MT_PLAIN: i32 = 1;
pub(crate) const MT_PLUS: i32 = 2;
pub(crate) const MT_MINUS: i32 = 3;
pub(crate) const FN_TYPE_PARAMETERS: i32 = 8;
pub(crate) const FN_RETURN_TYPE: i32 = 9;
pub(crate) const FN_PREDICATE: i32 = 10;
// classes and interfaces
pub(crate) const CL_ID: i32 = 4;
pub(crate) const CL_SUPER: i32 = 5;
pub(crate) const CL_BODY: i32 = 6;
pub(crate) const CL_IMPLEMENTS: i32 = 8;
pub(crate) const CL_TYPE_PARAMETERS: i32 = 9;
pub(crate) const CL_SUPER_TYPE_ARGUMENTS: i32 = 10;
pub(crate) const CL_EXTENDS: i32 = 11;
pub(crate) const CL_MIXINS: i32 = 12;
// ---- how many children a kind has: single children, then lists, then more single children, then more lists;
// four bits for each number
pub(crate) static SHAPE: [u16; 222] = [
    0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 3, 16,
    16, 2, 802, 1, 1, 802, 802, 802, 8739, 8739, 16, 802, 530, 16, 1, 1, 2, 2, 2, 3, 273, 273, 273,
    2, 16, 1, 1, 2, 1, 2, 16, 16, 1, 1, 2, 1, 1, 32, 2, 1, 1, 2, 1, 1, 3, 17, 17, 3, 2, 2, 2, 4, 3,
    3, 16, 2, 1, 33, 2, 1, 1, 2, 34, 2, 1, 1, 1, 18, 18, 18, 273, 1, 2, 1, 1, 1, 2, 2, 1, 1, 1, 18,
    16, 0, 16, 0, 2, 2, 2, 2, 1, 0, 2, 2, 16, 16, 1, 16, 3, 2, 1, 802, 802, 802, 802, 802, 2, 17,
    16, 16, 4, 1, 2, 4, 1, 2, 2, 1, 32, 529, 16, 16, 4, 2, 2, 1, 2, 2, 3, 8739, 2, 2, 16, 2, 2, 32,
    1, 1, 2, 273, 17, 802, 1, 3, 4, 1, 2, 1, 4, 2, 0, 2, 1, 6, 2, 8739, 1, 8739, 802, 802, 802, 2,
    2, 802, 1, 802, 17, 17, 3, 3, 16, 2, 0, 1, 1, 1, 2, 17, 2, 1, 17, 2, 1, 17, 8739, 16, 3, 3, 0,
    16, 0, 0,
];
// Where the two extra words of a binding stand (see F_EXT): type_annotation, decorators.
pub(crate) static EXT_AT: [u8; 222] = [
    0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 0,
    0, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 5, 5, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
impl Quick {
    // ---- making the larger nodes
    pub(crate) fn ast_adopt(&mut self, l: i32, n: i32) {
        let count = self.n.at(l);
        let mut i: i32 = 1;
        while i <= count {
            self.n.put(self.n.at(l + i) + 3, n);
            i += 1;
        }
    }

    /// Puts `child` into the field at n + at.
    pub(crate) fn set_child(&mut self, n: i32, at: i32, child: i32) {
        self.n.put(n + at, child);
        self.n.put(child + 3, n);
    }

    pub(crate) fn set_list(&mut self, n: i32, at: i32, list: i32) {
        self.n.put(n + at, list);
        self.ast_adopt(list, n);
    }

    pub(crate) fn function_node(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        id: i32,
        body: i32,
        params: i32,
        decorators: i32,
        type_parameters: i32,
        return_type: i32,
    ) -> i32 {
        let n = self.node_raw(head, start, end, 7);
        self.n.put(n + 4, id);
        self.n.put(n + 5, body);
        self.n.put(n + 6, params);
        self.n.put(n + 7, decorators);
        self.n.put(n + 8, type_parameters);
        self.n.put(n + 9, return_type);
        self.n.put(n + 10, 0);
        self.n.put(id + 3, n);
        self.n.put(body + 3, n);
        self.n.put(type_parameters + 3, n);
        self.n.put(return_type + 3, n);
        self.ast_adopt(params, n);
        if decorators != 0 {
            self.ast_adopt(decorators, n);
        }
        return n;
    }

    /// The typed fields are 0; fill them with set_child() and set_list().
    pub(crate) fn class_node(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        id: i32,
        super_class: i32,
        body: i32,
        decorators: i32,
    ) -> i32 {
        let n = self.node_raw(head, start, end, 9);
        self.n.put(n + 4, id);
        self.n.put(n + 5, super_class);
        self.n.put(n + 6, body);
        self.n.put(n + 7, decorators);
        self.n.put(n + 8, 0);
        self.n.put(n + 9, 0);
        self.n.put(n + 10, 0);
        self.n.put(n + 11, 0);
        self.n.put(n + 12, 0);
        self.n.put(id + 3, n);
        self.n.put(super_class + 3, n);
        self.n.put(body + 3, n);
        if decorators != 0 {
            self.ast_adopt(decorators, n);
        }
        return n;
    }

    /// CallExpression, NewExpression, ImportExpression, JSXOpeningElement, ExternalModuleReference.
    pub(crate) fn call_node(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        callee: i32,
        args: i32,
        type_arguments: i32,
    ) -> i32 {
        let n = self.node_raw(head, start, end, 3);
        self.n.put(n + 4, callee);
        self.n.put(n + 5, args);
        self.n.put(n + 6, type_arguments);
        self.n.put(callee + 3, n);
        self.n.put(type_arguments + 3, n);
        self.ast_adopt(args, n);
        return n;
    }

    pub(crate) fn class_property_node(
        &mut self,
        head: i32,
        start: i32,
        end: i32,
        key: i32,
        value: i32,
        decorators: i32,
        type_annotation: i32,
        variance: i32,
    ) -> i32 {
        let n = self.node_raw(head, start, end, 5);
        self.n.put(n + 4, key);
        self.n.put(n + 5, value);
        self.n.put(n + 6, decorators);
        self.n.put(n + 7, type_annotation);
        self.n.put(n + 8, variance);
        self.n.put(key + 3, n);
        self.n.put(value + 3, n);
        self.n.put(type_annotation + 3, n);
        self.n.put(variance + 3, n);
        if decorators != 0 {
            self.ast_adopt(decorators, n);
        }
        return n;
    }
}
