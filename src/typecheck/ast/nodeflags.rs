// Port of internal/ast/nodeflags.go.
use crate::ast::flags::define_flags;

define_flags!(NodeFlags: u32 {
    LET = 1 << 0, // Variable declaration
    CONST = 1 << 1, // Variable declaration
    USING = 1 << 2, // Variable declaration
    REPARSED = 1 << 3, // Node was synthesized during parsing
    SYNTHESIZED = 1 << 4, // Node was synthesized during transformation
    OPTIONAL_CHAIN = 1 << 5, // Chained MemberExpression rooted to a pseudo-OptionalExpression
    EXPORT_CONTEXT = 1 << 6, // Export context (initialized by binding)
    CONTAINS_THIS = 1 << 7, // Interface contains references to "this"
    HAS_IMPLICIT_RETURN = 1 << 8, // If function implicitly returns on one of codepaths (initialized by binding)
    HAS_EXPLICIT_RETURN = 1 << 9, // If function has explicit reachable return on one of codepaths (initialized by binding)
    DISALLOW_IN_CONTEXT = 1 << 10, // If node was parsed in a context where 'in-expressions' are not allowed
    YIELD_CONTEXT = 1 << 11, // If node was parsed in the 'yield' context created when parsing a generator
    DECORATOR_CONTEXT = 1 << 12, // If node was parsed as part of a decorator
    AWAIT_CONTEXT = 1 << 13, // If node was parsed in the 'await' context created when parsing an async function
    DISALLOW_CONDITIONAL_TYPES_CONTEXT = 1 << 14, // If node was parsed in a context where conditional types are not allowed
    THIS_NODE_HAS_ERROR = 1 << 15, // If the parser encountered an error when parsing the code that created this node
    JAVA_SCRIPT_FILE = 1 << 16, // If node was parsed in a JavaScript
    THIS_NODE_OR_ANY_SUB_NODES_HAS_ERROR = 1 << 17, // If this node or any of its children had an error
    HAS_ASYNC_FUNCTIONS = 1 << 18, // If the file has async functions (initialized by binding)
    // Set when the parser encounters a dynamic import expression or 'import.meta', to avoid walking the tree when the flags are not set; an approximation, because once set the flags never get cleared.
    POSSIBLY_CONTAINS_DYNAMIC_IMPORT = 1 << 19,
    POSSIBLY_CONTAINS_IMPORT_META = 1 << 20,
    HAS_JSDOC = 1 << 21, // If node has preceding JSDoc comment(s)
    JSDOC = 1 << 22, // If node was parsed inside jsdoc
    AMBIENT = 1 << 23, // If node was inside an ambient context -- a declaration file, or inside something with the `declare` modifier.
    IN_WITH_STATEMENT = 1 << 24, // If any ancestor of node was the `statement` of a WithStatement (not the `expression`)
    JSON_FILE = 1 << 25, // If node was parsed in a Json
    POSSIBLY_CONTAINS_DEPRECATED_TAG = 1 << 26, // Set during parse if comment text contains '@deprecated'; must confirm via JSDoc lookup
    UNREACHABLE = 1 << 27, // If node is unreachable according to the binder
    REPARSER_TRANSFORMED_LITERAL = 1 << 28, // If node was transformed during parsing, making its' naive text source not match the AST
    BLOCK_SCOPED = Self::LET.0 | Self::CONST.0 | Self::USING.0,
    CONSTANT = Self::CONST.0 | Self::USING.0,
    AWAIT_USING = Self::CONST.0 | Self::USING.0, // Variable declaration (NOTE: on a single node these flags would otherwise be mutually exclusive)
    REACHABILITY_CHECK_FLAGS = Self::HAS_IMPLICIT_RETURN.0 | Self::HAS_EXPLICIT_RETURN.0,
    REACHABILITY_AND_EMIT_FLAGS = Self::REACHABILITY_CHECK_FLAGS.0 | Self::HAS_ASYNC_FUNCTIONS.0,
    // Parsing context flags
    CONTEXT_FLAGS = Self::DISALLOW_IN_CONTEXT.0 | Self::DISALLOW_CONDITIONAL_TYPES_CONTEXT.0
        | Self::YIELD_CONTEXT.0 | Self::DECORATOR_CONTEXT.0 | Self::AWAIT_CONTEXT.0
        | Self::JAVA_SCRIPT_FILE.0 | Self::IN_WITH_STATEMENT.0 | Self::AMBIENT.0,
    // Exclude these flags when parsing a Type
    TYPE_EXCLUDES_FLAGS = Self::YIELD_CONTEXT.0 | Self::AWAIT_CONTEXT.0,
    // Represents all flags that are potentially set once and never cleared on SourceFiles which get re-used in between incremental parses. See the comment above on `PossiblyContainsDynamicImport` and `PossiblyContainsImportMeta`.
    PERMANENTLY_SET_INCREMENTAL_FLAGS = Self::POSSIBLY_CONTAINS_DYNAMIC_IMPORT.0
        | Self::POSSIBLY_CONTAINS_IMPORT_META.0,
    // The following flags repurpose other NodeFlags as different meanings for Identifier nodes
    IDENTIFIER_HAS_EXTENDED_UNICODE_ESCAPE = Self::CONTAINS_THIS.0, // Indicates whether the identifier contains an extended unicode escape sequence
    IDENTIFIER_IS_IN_JSDOC_NAMESPACE = Self::HAS_ASYNC_FUNCTIONS.0, // Indicates the identifier is the innermost name of a JSDoc namespace declaration
    // The following flag repurposes other NodeFlags for ModuleDeclaration nodes
    NESTED_NAMESPACE = Self::OPTIONAL_CHAIN.0, // If ModuleDeclaration is a nested namespace (e.g. inner part of A.B.C)
});
