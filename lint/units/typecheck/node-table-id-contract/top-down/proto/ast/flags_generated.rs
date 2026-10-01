// Generated from internal/ast/nodeflags.go (typescript-go 89d5d5b). Do not edit.
bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub struct NodeFlags: u32 {
        const LET = 1 << 0;
        const CONST = 1 << 1;
        const USING = 1 << 2;
        const REPARSED = 1 << 3;
        const SYNTHESIZED = 1 << 4;
        const OPTIONAL_CHAIN = 1 << 5;
        const EXPORT_CONTEXT = 1 << 6;
        const CONTAINS_THIS = 1 << 7;
        const HAS_IMPLICIT_RETURN = 1 << 8;
        const HAS_EXPLICIT_RETURN = 1 << 9;
        const DISALLOW_IN_CONTEXT = 1 << 10;
        const YIELD_CONTEXT = 1 << 11;
        const DECORATOR_CONTEXT = 1 << 12;
        const AWAIT_CONTEXT = 1 << 13;
        const DISALLOW_CONDITIONAL_TYPES_CONTEXT = 1 << 14;
        const THIS_NODE_HAS_ERROR = 1 << 15;
        const JAVA_SCRIPT_FILE = 1 << 16;
        const THIS_NODE_OR_ANY_SUB_NODES_HAS_ERROR = 1 << 17;
        const HAS_ASYNC_FUNCTIONS = 1 << 18;
        const POSSIBLY_CONTAINS_DYNAMIC_IMPORT = 1 << 19;
        const POSSIBLY_CONTAINS_IMPORT_META = 1 << 20;
        const HAS_JSDOC = 1 << 21;
        const JSDOC = 1 << 22;
        const AMBIENT = 1 << 23;
        const IN_WITH_STATEMENT = 1 << 24;
        const JSON_FILE = 1 << 25;
        const POSSIBLY_CONTAINS_DEPRECATED_TAG = 1 << 26;
        const UNREACHABLE = 1 << 27;
        const REPARSER_TRANSFORMED_LITERAL = 1 << 28;
        const BLOCK_SCOPED = Self::LET.bits() | Self::CONST.bits() | Self::USING.bits();
        const CONSTANT = Self::CONST.bits() | Self::USING.bits();
        const AWAIT_USING = Self::CONST.bits() | Self::USING.bits();
        const REACHABILITY_CHECK_FLAGS = Self::HAS_IMPLICIT_RETURN.bits() | Self::HAS_EXPLICIT_RETURN.bits();
        const REACHABILITY_AND_EMIT_FLAGS = Self::REACHABILITY_CHECK_FLAGS.bits() | Self::HAS_ASYNC_FUNCTIONS.bits();
        const CONTEXT_FLAGS = Self::DISALLOW_IN_CONTEXT.bits() | Self::DISALLOW_CONDITIONAL_TYPES_CONTEXT.bits() | Self::YIELD_CONTEXT.bits() | Self::DECORATOR_CONTEXT.bits() | Self::AWAIT_CONTEXT.bits() | Self::JAVA_SCRIPT_FILE.bits() | Self::IN_WITH_STATEMENT.bits() | Self::AMBIENT.bits();
        const TYPE_EXCLUDES_FLAGS = Self::YIELD_CONTEXT.bits() | Self::AWAIT_CONTEXT.bits();
        const PERMANENTLY_SET_INCREMENTAL_FLAGS = Self::POSSIBLY_CONTAINS_DYNAMIC_IMPORT.bits() | Self::POSSIBLY_CONTAINS_IMPORT_META.bits();
        const IDENTIFIER_HAS_EXTENDED_UNICODE_ESCAPE = Self::CONTAINS_THIS.bits();
        const IDENTIFIER_IS_IN_JSDOC_NAMESPACE = Self::HAS_ASYNC_FUNCTIONS.bits();
        const NESTED_NAMESPACE = Self::OPTIONAL_CHAIN.bits();
    }
}

// Generated from internal/ast/tokenflags.go (typescript-go 89d5d5b). Do not edit.
bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub struct TokenFlags: u32 {
        const PRECEDING_LINE_BREAK = 1 << 0;
        const PRECEDING_JSDOC_COMMENT = 1 << 1;
        const UNTERMINATED = 1 << 2;
        const EXTENDED_UNICODE_ESCAPE = 1 << 3;
        const SCIENTIFIC = 1 << 4;
        const OCTAL = 1 << 5;
        const HEX_SPECIFIER = 1 << 6;
        const BINARY_SPECIFIER = 1 << 7;
        const OCTAL_SPECIFIER = 1 << 8;
        const CONTAINS_SEPARATOR = 1 << 9;
        const UNICODE_ESCAPE = 1 << 10;
        const CONTAINS_INVALID_ESCAPE = 1 << 11;
        const HEX_ESCAPE = 1 << 12;
        const CONTAINS_LEADING_ZERO = 1 << 13;
        const CONTAINS_INVALID_SEPARATOR = 1 << 14;
        const PRECEDING_JSDOC_LEADING_ASTERISKS = 1 << 15;
        const SINGLE_QUOTE = 1 << 16;
        const PRECEDING_JSDOC_WITH_DEPRECATED = 1 << 17;
        const PRECEDING_JSDOC_WITH_SEE_OR_LINK = 1 << 18;
        const BINARY_OR_OCTAL_SPECIFIER = Self::BINARY_SPECIFIER.bits() | Self::OCTAL_SPECIFIER.bits();
        const WITH_SPECIFIER = Self::HEX_SPECIFIER.bits() | Self::BINARY_OR_OCTAL_SPECIFIER.bits();
        const STRING_LITERAL_FLAGS = Self::UNTERMINATED.bits() | Self::HEX_ESCAPE.bits() | Self::UNICODE_ESCAPE.bits() | Self::EXTENDED_UNICODE_ESCAPE.bits() | Self::CONTAINS_INVALID_ESCAPE.bits() | Self::SINGLE_QUOTE.bits();
        const NUMERIC_LITERAL_FLAGS = Self::SCIENTIFIC.bits() | Self::OCTAL.bits() | Self::CONTAINS_LEADING_ZERO.bits() | Self::WITH_SPECIFIER.bits() | Self::CONTAINS_SEPARATOR.bits() | Self::CONTAINS_INVALID_SEPARATOR.bits();
        const TEMPLATE_LITERAL_LIKE_FLAGS = Self::UNTERMINATED.bits() | Self::HEX_ESCAPE.bits() | Self::UNICODE_ESCAPE.bits() | Self::EXTENDED_UNICODE_ESCAPE.bits() | Self::CONTAINS_INVALID_ESCAPE.bits();
        const REGULAR_EXPRESSION_LITERAL_FLAGS = Self::UNTERMINATED.bits();
        const IS_INVALID = Self::OCTAL.bits() | Self::CONTAINS_LEADING_ZERO.bits() | Self::CONTAINS_INVALID_SEPARATOR.bits() | Self::CONTAINS_INVALID_ESCAPE.bits();
    }
}

// Generated from internal/ast/modifierflags.go (typescript-go 89d5d5b). Do not edit.
bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
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
        const JSDOC_PUBLIC = 1 << 23;
        const JSDOC_PRIVATE = 1 << 24;
        const JSDOC_PROTECTED = 1 << 25;
        const JSDOC_READONLY = 1 << 26;
        const JSDOC_OVERRIDE = 1 << 27;
        const HAS_COMPUTED_JSDOC_MODIFIERS = 1 << 28;
        const HAS_COMPUTED_FLAGS = 1 << 29;
        const SYNTACTIC_OR_JSDOC_MODIFIERS = Self::PUBLIC.bits() | Self::PRIVATE.bits() | Self::PROTECTED.bits() | Self::READONLY.bits() | Self::OVERRIDE.bits();
        const SYNTACTIC_ONLY_MODIFIERS = Self::EXPORT.bits() | Self::AMBIENT.bits() | Self::ABSTRACT.bits() | Self::STATIC.bits() | Self::ACCESSOR.bits() | Self::ASYNC.bits() | Self::DEFAULT.bits() | Self::CONST.bits() | Self::IN.bits() | Self::OUT.bits() | Self::DECORATOR.bits();
        const SYNTACTIC_MODIFIERS = Self::SYNTACTIC_OR_JSDOC_MODIFIERS.bits() | Self::SYNTACTIC_ONLY_MODIFIERS.bits();
        const JSDOC_CACHE_ONLY_MODIFIERS = Self::JSDOC_PUBLIC.bits() | Self::JSDOC_PRIVATE.bits() | Self::JSDOC_PROTECTED.bits() | Self::JSDOC_READONLY.bits() | Self::JSDOC_OVERRIDE.bits();
        const JSDOC_ONLY_MODIFIERS = Self::DEPRECATED.bits();
        const NON_CACHE_ONLY_MODIFIERS = Self::SYNTACTIC_OR_JSDOC_MODIFIERS.bits() | Self::SYNTACTIC_ONLY_MODIFIERS.bits() | Self::JSDOC_ONLY_MODIFIERS.bits();
        const ACCESSIBILITY_MODIFIER = Self::PUBLIC.bits() | Self::PRIVATE.bits() | Self::PROTECTED.bits();
        const PARAMETER_PROPERTY_MODIFIER = Self::ACCESSIBILITY_MODIFIER.bits() | Self::READONLY.bits() | Self::OVERRIDE.bits();
        const NON_PUBLIC_ACCESSIBILITY_MODIFIER = Self::PRIVATE.bits() | Self::PROTECTED.bits();
        const TYPE_SCRIPT_MODIFIER = Self::AMBIENT.bits() | Self::PUBLIC.bits() | Self::PRIVATE.bits() | Self::PROTECTED.bits() | Self::READONLY.bits() | Self::ABSTRACT.bits() | Self::CONST.bits() | Self::OVERRIDE.bits() | Self::IN.bits() | Self::OUT.bits();
        const EXPORT_DEFAULT = Self::EXPORT.bits() | Self::DEFAULT.bits();
        const ALL = Self::EXPORT.bits() | Self::AMBIENT.bits() | Self::PUBLIC.bits() | Self::PRIVATE.bits() | Self::PROTECTED.bits() | Self::STATIC.bits() | Self::READONLY.bits() | Self::ABSTRACT.bits() | Self::ACCESSOR.bits() | Self::ASYNC.bits() | Self::DEFAULT.bits() | Self::CONST.bits() | Self::DEPRECATED.bits() | Self::OVERRIDE.bits() | Self::IN.bits() | Self::OUT.bits() | Self::DECORATOR.bits();
        const MODIFIER = Self::ALL.bits() & !Self::DECORATOR.bits();
        const JAVA_SCRIPT = Self::EXPORT.bits() | Self::STATIC.bits() | Self::ACCESSOR.bits() | Self::ASYNC.bits() | Self::DEFAULT.bits();
    }
}
