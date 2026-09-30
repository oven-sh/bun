// Port of internal/ast/checkflags.go.
use crate::ast::flags::define_flags;

define_flags!(CheckFlags: u32 {
    INSTANTIATED = 1 << 0, // Instantiated symbol
    SYNTHETIC_PROPERTY = 1 << 1, // Property in union or intersection type
    SYNTHETIC_METHOD = 1 << 2, // Method in union or intersection type
    READONLY = 1 << 3, // Readonly transient symbol
    READ_PARTIAL = 1 << 4, // Synthetic property present in some but not all constituents
    WRITE_PARTIAL = 1 << 5, // Synthetic property present in some but only satisfied by an index signature in others
    HAS_NON_UNIFORM_TYPE = 1 << 6, // Synthetic property with non-uniform type in constituents
    HAS_LITERAL_TYPE = 1 << 7, // Synthetic property with at least one literal type in constituents
    CONTAINS_PUBLIC = 1 << 8, // Synthetic property with public constituent(s)
    CONTAINS_PROTECTED = 1 << 9, // Synthetic property with protected constituent(s)
    CONTAINS_PRIVATE = 1 << 10, // Synthetic property with private constituent(s)
    CONTAINS_STATIC = 1 << 11, // Synthetic property with static constituent(s)
    LATE = 1 << 12, // Late-bound symbol for a computed property with a dynamic name
    REVERSE_MAPPED = 1 << 13, // Property of reverse-inferred homomorphic mapped type
    OPTIONAL_PARAMETER = 1 << 14, // Optional parameter
    REST_PARAMETER = 1 << 15, // Rest parameter
    DEFERRED_TYPE = 1 << 16, // Calculation of the type of this symbol is deferred due to processing costs, should be fetched with `getTypeOfSymbolWithDeferredType`
    HAS_NEVER_TYPE = 1 << 17, // Synthetic property with at least one never type in constituents
    MAPPED = 1 << 18, // Property of mapped type
    STRIP_OPTIONAL = 1 << 19, // Strip optionality in mapped property
    UNRESOLVED = 1 << 20, // Unresolved type alias symbol
    IS_DISCRIMINANT_COMPUTED = 1 << 21, // IsDiscriminant flags has been computed
    IS_DISCRIMINANT = 1 << 22, // Discriminant property
    INDEX_SYMBOL = 1 << 23, // Synthetic property created from index signature
    SYNTHETIC = Self::SYNTHETIC_PROPERTY.0 | Self::SYNTHETIC_METHOD.0,
    NON_UNIFORM_AND_LITERAL = Self::HAS_NON_UNIFORM_TYPE.0 | Self::HAS_LITERAL_TYPE.0,
    PARTIAL = Self::READ_PARTIAL.0 | Self::WRITE_PARTIAL.0,
});
