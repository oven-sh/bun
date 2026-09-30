// Port of internal/ast/modifierflags.go.
use crate::ast::flags::define_flags;

define_flags!(ModifierFlags: u32 {
    // Syntactic/JSDoc modifiers
    PUBLIC = 1 << 0, // Property/Method
    PRIVATE = 1 << 1, // Property/Method
    PROTECTED = 1 << 2, // Property/Method
    READONLY = 1 << 3, // Property/Method
    OVERRIDE = 1 << 4, // Override method
    // Syntactic-only modifiers
    EXPORT = 1 << 5, // Declarations
    ABSTRACT = 1 << 6, // Class/Method/ConstructSignature
    AMBIENT = 1 << 7, // Declarations (declare keyword)
    STATIC = 1 << 8, // Property/Method
    ACCESSOR = 1 << 9, // Property
    ASYNC = 1 << 10, // Property/Method/Function
    DEFAULT = 1 << 11, // Function/Class (export default declaration)
    CONST = 1 << 12, // Const enum
    IN = 1 << 13, // Contravariance modifier
    OUT = 1 << 14, // Covariance modifier
    DECORATOR = 1 << 15, // Contains a decorator
    // JSDoc-only modifiers
    DEPRECATED = 1 << 16, // Deprecated tag
    // Cache-only JSDoc-modifiers. Should match order of Syntactic/JSDoc modifiers, above.
    JSDOC_PUBLIC = 1 << 23, // if this value changes, `selectEffectiveModifierFlags` must change accordingly
    JSDOC_PRIVATE = 1 << 24,
    JSDOC_PROTECTED = 1 << 25,
    JSDOC_READONLY = 1 << 26,
    JSDOC_OVERRIDE = 1 << 27,
    HAS_COMPUTED_JSDOC_MODIFIERS = 1 << 28, // Indicates the computed modifier flags include modifiers from JSDoc.
    HAS_COMPUTED_FLAGS = 1 << 29, // Modifier flags have been computed
    SYNTACTIC_OR_JSDOC_MODIFIERS = Self::PUBLIC.0 | Self::PRIVATE.0 | Self::PROTECTED.0
        | Self::READONLY.0 | Self::OVERRIDE.0,
    SYNTACTIC_ONLY_MODIFIERS = Self::EXPORT.0 | Self::AMBIENT.0 | Self::ABSTRACT.0 | Self::STATIC.0
        | Self::ACCESSOR.0 | Self::ASYNC.0 | Self::DEFAULT.0 | Self::CONST.0 | Self::IN.0
        | Self::OUT.0 | Self::DECORATOR.0,
    SYNTACTIC_MODIFIERS = Self::SYNTACTIC_OR_JSDOC_MODIFIERS.0 | Self::SYNTACTIC_ONLY_MODIFIERS.0,
    JSDOC_CACHE_ONLY_MODIFIERS = Self::JSDOC_PUBLIC.0 | Self::JSDOC_PRIVATE.0
        | Self::JSDOC_PROTECTED.0 | Self::JSDOC_READONLY.0 | Self::JSDOC_OVERRIDE.0,
    JSDOC_ONLY_MODIFIERS = Self::DEPRECATED.0,
    NON_CACHE_ONLY_MODIFIERS = Self::SYNTACTIC_OR_JSDOC_MODIFIERS.0
        | Self::SYNTACTIC_ONLY_MODIFIERS.0 | Self::JSDOC_ONLY_MODIFIERS.0,
    ACCESSIBILITY_MODIFIER = Self::PUBLIC.0 | Self::PRIVATE.0 | Self::PROTECTED.0,
    // Accessibility modifiers and 'readonly' can be attached to a parameter in a constructor to make it a property.
    PARAMETER_PROPERTY_MODIFIER = Self::ACCESSIBILITY_MODIFIER.0 | Self::READONLY.0
        | Self::OVERRIDE.0,
    NON_PUBLIC_ACCESSIBILITY_MODIFIER = Self::PRIVATE.0 | Self::PROTECTED.0,
    TYPE_SCRIPT_MODIFIER = Self::AMBIENT.0 | Self::PUBLIC.0 | Self::PRIVATE.0 | Self::PROTECTED.0
        | Self::READONLY.0 | Self::ABSTRACT.0 | Self::CONST.0 | Self::OVERRIDE.0 | Self::IN.0
        | Self::OUT.0,
    EXPORT_DEFAULT = Self::EXPORT.0 | Self::DEFAULT.0,
    ALL = Self::EXPORT.0 | Self::AMBIENT.0 | Self::PUBLIC.0 | Self::PRIVATE.0 | Self::PROTECTED.0
        | Self::STATIC.0 | Self::READONLY.0 | Self::ABSTRACT.0 | Self::ACCESSOR.0 | Self::ASYNC.0
        | Self::DEFAULT.0 | Self::CONST.0 | Self::DEPRECATED.0 | Self::OVERRIDE.0 | Self::IN.0
        | Self::OUT.0 | Self::DECORATOR.0,
    MODIFIER = Self::ALL.0 & !Self::DECORATOR.0,
    JAVA_SCRIPT = Self::EXPORT.0 | Self::STATIC.0 | Self::ACCESSOR.0 | Self::ASYNC.0
        | Self::DEFAULT.0,
});
