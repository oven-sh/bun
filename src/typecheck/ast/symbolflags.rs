// Port of internal/ast/symbolflags.go.
use crate::ast::flags::define_flags;

define_flags!(SymbolFlags: u32 {
    FUNCTION_SCOPED_VARIABLE = 1 << 0, // Variable (var) or parameter
    BLOCK_SCOPED_VARIABLE = 1 << 1, // A block-scoped variable (let or const)
    PROPERTY = 1 << 2, // Property or enum member
    ENUM_MEMBER = 1 << 3, // Enum member
    FUNCTION = 1 << 4, // Function
    CLASS = 1 << 5, // Class
    INTERFACE = 1 << 6, // Interface
    CONST_ENUM = 1 << 7, // Const enum
    REGULAR_ENUM = 1 << 8, // Enum
    VALUE_MODULE = 1 << 9, // Instantiated module
    NAMESPACE_MODULE = 1 << 10, // Uninstantiated module
    TYPE_LITERAL = 1 << 11, // Type Literal or mapped type
    OBJECT_LITERAL = 1 << 12, // Object Literal
    METHOD = 1 << 13, // Method
    CONSTRUCTOR = 1 << 14, // Constructor
    GET_ACCESSOR = 1 << 15, // Get accessor
    SET_ACCESSOR = 1 << 16, // Set accessor
    SIGNATURE = 1 << 17, // Call, construct, or index signature
    TYPE_PARAMETER = 1 << 18, // Type parameter
    TYPE_ALIAS = 1 << 19, // Type alias
    EXPORT_VALUE = 1 << 20, // Exported value marker (see comment in declareModuleMember in binder)
    ALIAS = 1 << 21, // An alias for another symbol (see comment in isAliasSymbolDeclaration in checker)
    PROTOTYPE = 1 << 22, // Prototype property (no source representation)
    EXPORT_STAR = 1 << 23, // Export * declaration
    OPTIONAL = 1 << 24, // Optional property
    TRANSIENT = 1 << 25, // Transient symbol (created during type check)
    ASSIGNMENT = 1 << 26, // Assignment to property on function acting as declaration (eg `func.prop = 1`)
    MODULE_EXPORTS = 1 << 27, // Symbol for CommonJS `module` of `module.exports`
    CONST_ENUM_ONLY_MODULE = 1 << 28, // Module contains only const enums or other modules with only const enums
    REPLACEABLE_BY_METHOD = 1 << 29,
    GLOBAL_LOOKUP = 1 << 30, // Flag to signal this is a global lookup
    ALL = (1 << 30) - 1, // All flags except SymbolFlagsGlobalLookup
    ENUM = Self::REGULAR_ENUM.0 | Self::CONST_ENUM.0,
    VARIABLE = Self::FUNCTION_SCOPED_VARIABLE.0 | Self::BLOCK_SCOPED_VARIABLE.0,
    VALUE = Self::VARIABLE.0 | Self::PROPERTY.0 | Self::ENUM_MEMBER.0 | Self::OBJECT_LITERAL.0
        | Self::FUNCTION.0 | Self::CLASS.0 | Self::ENUM.0 | Self::VALUE_MODULE.0 | Self::METHOD.0
        | Self::GET_ACCESSOR.0 | Self::SET_ACCESSOR.0,
    TYPE = Self::CLASS.0 | Self::INTERFACE.0 | Self::ENUM.0 | Self::ENUM_MEMBER.0
        | Self::TYPE_LITERAL.0 | Self::TYPE_PARAMETER.0 | Self::TYPE_ALIAS.0,
    NAMESPACE = Self::VALUE_MODULE.0 | Self::NAMESPACE_MODULE.0 | Self::ENUM.0,
    MODULE = Self::VALUE_MODULE.0 | Self::NAMESPACE_MODULE.0,
    ACCESSOR = Self::GET_ACCESSOR.0 | Self::SET_ACCESSOR.0,
    // Variables can be redeclared, but can not redeclare a block-scoped declaration with the same name, or any other value that is not a variable, e.g. ValueModule or Class
    FUNCTION_SCOPED_VARIABLE_EXCLUDES = Self::VALUE.0 & !Self::FUNCTION_SCOPED_VARIABLE.0,
    // Block-scoped declarations are not allowed to be re-declared they can not merge with anything in the value space
    BLOCK_SCOPED_VARIABLE_EXCLUDES = Self::VALUE.0,
    PARAMETER_EXCLUDES = Self::VALUE.0,
    PROPERTY_EXCLUDES = Self::VALUE.0 & !(Self::PROPERTY.0 | Self::ACCESSOR.0),
    ENUM_MEMBER_EXCLUDES = Self::VALUE.0 | Self::TYPE.0,
    FUNCTION_EXCLUDES = Self::VALUE.0 & !(Self::FUNCTION.0 | Self::VALUE_MODULE.0 | Self::CLASS.0),
    CLASS_EXCLUDES = (Self::VALUE.0 | Self::TYPE.0) & !(Self::VALUE_MODULE.0 | Self::INTERFACE.0
        | Self::FUNCTION.0), // class-interface mergability done in checker.ts
    INTERFACE_EXCLUDES = Self::TYPE.0 & !(Self::INTERFACE.0 | Self::CLASS.0),
    REGULAR_ENUM_EXCLUDES = (Self::VALUE.0 | Self::TYPE.0) & !(Self::REGULAR_ENUM.0
        | Self::VALUE_MODULE.0), // regular enums merge only with regular enums and modules
    CONST_ENUM_EXCLUDES = (Self::VALUE.0 | Self::TYPE.0) & !Self::CONST_ENUM.0, // const enums merge only with const enums
    VALUE_MODULE_EXCLUDES = Self::VALUE.0 & !(Self::FUNCTION.0 | Self::CLASS.0
        | Self::REGULAR_ENUM.0 | Self::VALUE_MODULE.0),
    NAMESPACE_MODULE_EXCLUDES = 0,
    METHOD_EXCLUDES = Self::VALUE.0 & !Self::METHOD.0,
    GET_ACCESSOR_EXCLUDES = Self::VALUE.0 & !(Self::SET_ACCESSOR.0 | Self::PROPERTY.0),
    SET_ACCESSOR_EXCLUDES = Self::VALUE.0 & !(Self::GET_ACCESSOR.0 | Self::PROPERTY.0),
    ACCESSOR_EXCLUDES = Self::VALUE.0 & !Self::PROPERTY.0,
    TYPE_PARAMETER_EXCLUDES = Self::TYPE.0 & !Self::TYPE_PARAMETER.0,
    TYPE_ALIAS_EXCLUDES = Self::TYPE.0,
    ALIAS_EXCLUDES = Self::ALIAS.0,
    MODULE_MEMBER = Self::VARIABLE.0 | Self::FUNCTION.0 | Self::CLASS.0 | Self::INTERFACE.0
        | Self::ENUM.0 | Self::MODULE.0 | Self::TYPE_ALIAS.0 | Self::ALIAS.0,
    EXPORT_HAS_LOCAL = Self::FUNCTION.0 | Self::CLASS.0 | Self::ENUM.0 | Self::VALUE_MODULE.0,
    BLOCK_SCOPED = Self::BLOCK_SCOPED_VARIABLE.0 | Self::CLASS.0 | Self::ENUM.0,
    PROPERTY_OR_ACCESSOR = Self::PROPERTY.0 | Self::ACCESSOR.0,
    CLASS_MEMBER = Self::METHOD.0 | Self::ACCESSOR.0 | Self::PROPERTY.0,
    EXPORT_SUPPORTS_DEFAULT_MODIFIER = Self::CLASS.0 | Self::FUNCTION.0 | Self::INTERFACE.0,
    EXPORT_DOES_NOT_SUPPORT_DEFAULT_MODIFIER = !Self::EXPORT_SUPPORTS_DEFAULT_MODIFIER.0,
    LATE_BINDING_CONTAINER = Self::CLASS.0 | Self::INTERFACE.0 | Self::TYPE_LITERAL.0
        | Self::OBJECT_LITERAL.0 | Self::FUNCTION.0,
});
