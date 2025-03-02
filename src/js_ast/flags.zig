//! Flag sets used throughout the JavaScript AST
//! Contains enum sets for Property, Function, Class, Module, and JSXElement flags

const std = @import("std");
const logger = @import("../logger.zig");

pub const JSXElement = enum {
    is_key_after_spread,
    has_any_dynamic,
    pub const Bitset = std.enums.EnumSet(JSXElement);
};

pub const Property = enum {
    is_computed,
    is_method,
    is_static,
    was_shorthand,
    is_spread,

    pub inline fn init(fields: Fields) Set {
        return Set.init(fields);
    }

    pub const None = Set{};
    pub const Fields = std.enums.EnumFieldStruct(Property, bool, false);
    pub const Set = std.enums.EnumSet(Property);
};

pub const Function = enum {
    is_async,
    is_generator,
    has_rest_arg,
    has_if_scope,

    is_forward_declaration,

    /// This is true if the function is a method
    is_unique_formal_parameters,

    /// Only applicable to function statements.
    is_export,

    pub inline fn init(fields: Fields) Set {
        return Set.init(fields);
    }

    pub const None = Set{};
    pub const Fields = std.enums.EnumFieldStruct(Function, bool, false);
    pub const Set = std.enums.EnumSet(Function);
};

// Based on references in js_ast.zig re-export file, we also need Class and Module flags
// These will need to be extracted from the original js_ast.zig file
pub const Class = enum {
    has_extends,
    is_typescript_declare,
    is_export,

    pub inline fn init(fields: Fields) Set {
        return Set.init(fields);
    }

    pub const None = Set{};
    pub const Fields = std.enums.EnumFieldStruct(Class, bool, false);
    pub const Set = std.enums.EnumSet(Class);
};

pub const Module = enum {
    is_esm,
    is_cjs,
    has_import_meta,
    has_top_level_await,
    is_typescript_file,

    pub inline fn init(fields: Fields) Set {
        return Set.init(fields);
    }

    pub const None = Set{};
    pub const Fields = std.enums.EnumFieldStruct(Module, bool, false);
    pub const Set = std.enums.EnumSet(Module);
};
