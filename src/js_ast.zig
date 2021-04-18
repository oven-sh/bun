const std = @import("std");
const logger = @import("logger.zig");

pub const NodeIndex = u32;
pub const NodeIndexNone = 4294967293;

pub const DataIndex = u16;
pub const DataIndexNone = 65533;

pub const BindingNodeIndex = NodeIndex;
pub const StmtNodeIndex = NodeIndex;
pub const ExprNodeIndex = NodeIndex;

pub const Comment = struct { text: []u8 };

pub const FnBody = struct {
    loc: logger.Loc,
    stmts: []StmtNodeIndex,
};

pub const Fn = struct {
    name: NodeIndex = NodeIndexNone,
    open_parens_loc: logger.Loc,
    args: []Arg,
    body: FnBody,

    is_async: bool,
    is_generator: bool,
    has_rest_arg: bool,
    has_if_scope: bool,

    // This is true if the function is a method
    is_unique_formal_parameters: bool,
};

pub const BindingType = enum {
    b_missing,
    b_identifier,
    b_array,
    b_object,
};

pub const Property = struct {
    pub const Kind = enum {
        normal,
        get,
        set,
        spread,
    };

    key: NodeIndex,
    value: NodeIndex = NodeIndexNone,
    initializer: Kind = Kind.normal,
    is_computed: bool,
    is_method: bool,
    is_static: bool,
    was_shorthand: bool,
};

pub const Arg = struct {
    ts_decorators: []NodeIndex,
    binding: Binding,
    default: NodeIndex = NodeIndexNone,

    // "constructor(public x: boolean) {}"
    is_typescript_ctor_field: bool,
};

pub const Try = struct {};
pub const Binding = struct {};

pub const Class = struct {
    class_keyword: logger.Range,
    ts_decorators: []NodeIndex,
    name: logger.Loc,
    extends: NodeIndex = NodeIndexNone,
    body_loc: logger.Loc,
    properties: []Property,
};

pub const Expr = struct {
    pub const Array = struct {
        items: []ExprNodeIndex,
        comma_after_spread: logger.Loc,
        is_parenthesized: bool,
    };

    pub const Unary = struct {
        op: Op.Code,
    };

    // TODO: THIS IS WHERE YOU LEFT OFF!
    // pub const Binary = {}
};

pub const Op = struct {
    // If you add a new token, remember to add it to "OpTable" too
    const Code = enum {
        // Prefix
        un_pos,
        un_neg,
        un_cpl,
        un_not,
        un_void,
        un_typeof,
        un_delete,

        // Prefix update
        un_pre_dec,
        un_pre_inc,

        // Postfix update
        un_post_dec,
        un_post_inc,

        // Left-associative
        bin_add,
        bin_sub,
        bin_mul,
        bin_div,
        bin_rem,
        bin_pow,
        bin_lt,
        bin_le,
        bin_gt,
        bin_ge,
        bin_in,
        bin_instanceof,
        bin_shl,
        bin_shr,
        bin_u_shr,
        bin_loose_eq,
        bin_loose_ne,
        bin_strict_eq,
        bin_strict_ne,
        bin_nullish_coalescing,
        bin_logical_or,
        bin_logical_and,
        bin_bitwise_or,
        bin_bitwise_and,
        bin_bitwise_xor,

        // Non-associative
        bin_comma,

        // Right-associative
        bin_assign,
        bin_add_assign,
        bin_sub_assign,
        bin_mul_assign,
        bin_div_assign,
        bin_rem_assign,
        bin_pow_assign,
        bin_shl_assign,
        bin_shr_assign,
        bin_u_shr_assign,
        bin_bitwise_or_assign,
        bin_bitwise_and_assign,
        bin_bitwise_xor_assign,
        bin_nullish_coalescing_assign,
        bin_logical_or_assign,
        bin_logical_and_assign,
    };

    const Level = enum {
        lowest,
        comma,
        spread,
        yield,
        assign,
        conditional,
        nullish_coalescing,
        logical_or,
        logical_and,
        bitwise_or,
        bitwise_xor,
        bitwise_and,
        equals,
        compare,
        shift,
        add,
        multiply,
        exponentiation,
        prefix,
        postfix,
        new,
        call,
        member,
    };

    text: string,
    level: Level,
    is_keyword: bool,

    const Table = []Op{
        // Prefix
        .{ "+", Level.prefix, false },
        .{ "-", Level.prefix, false },
        .{ "~", Level.prefix, false },
        .{ "!", Level.prefix, false },
        .{ "void", Level.prefix, true },
        .{ "typeof", Level.prefix, true },
        .{ "delete", Level.prefix, true },

        // Prefix update
        .{ "--", Level.prefix, false },
        .{ "++", Level.prefix, false },

        // Postfix update
        .{ "--", Level.postfix, false },
        .{ "++", Level.postfix, false },

        // Left-associative
        .{ "+", Level.add, false },
        .{ "-", Level.add, false },
        .{ "*", Level.multiply, false },
        .{ "/", Level.multiply, false },
        .{ "%", Level.multiply, false },
        .{ "**", Level.exponentiation, false }, // Right-associative
        .{ "<", Level.compare, false },
        .{ "<=", Level.compare, false },
        .{ ">", Level.compare, false },
        .{ ">=", Level.compare, false },
        .{ "in", Level.compare, true },
        .{ "instanceof", Level.compare, true },
        .{ "<<", Level.shift, false },
        .{ ">>", Level.shift, false },
        .{ ">>>", Level.shift, false },
        .{ "==", Level.equals, false },
        .{ "!=", Level.equals, false },
        .{ "===", Level.equals, false },
        .{ "!==", Level.equals, false },
        .{ "??", Level.nullish_coalescing, false },
        .{ "||", Level.logical_or, false },
        .{ "&&", Level.logical_and, false },
        .{ "|", Level.bitwise_or, false },
        .{ "&", Level.bitwise_and, false },
        .{ "^", Level.bitwise_xor, false },

        // Non-associative
        .{ ",", LComma, false },

        // Right-associative
        .{ "=", Level.assign, false },
        .{ "+=", Level.assign, false },
        .{ "-=", Level.assign, false },
        .{ "*=", Level.assign, false },
        .{ "/=", Level.assign, false },
        .{ "%=", Level.assign, false },
        .{ "**=", Level.assign, false },
        .{ "<<=", Level.assign, false },
        .{ ">>=", Level.assign, false },
        .{ ">>>=", Level.assign, false },
        .{ "|=", Level.assign, false },
        .{ "&=", Level.assign, false },
        .{ "^=", Level.assign, false },
        .{ "??=", Level.assign, false },
        .{ "||=", Level.assign, false },
        .{ "&&=", Level.assign, false },
    };
};

pub const ArrayBinding = struct {
    binding: BindingNodeIndex,
    default_value: ExprNodeIndex = NodeIndexNone,
};

pub const Node = struct {
    pub const Tag = enum {
        s_block,
        s_comment,
        s_debugger,
        s_directive,
        s_empty,
        s_type_script,
        s_export_clause,
        s_export_from,
        s_export_default,
        s_export_star,
        s_export_equals,
        s_lazy_export,
        s_expr,
        s_enum,
        s_namespace,
        s_function,
        s_class,
        s_label,
        s_if,
        s_for,
        s_for_in,
        s_for_of,
        s_do_while,
        s_while,
        s_with,
        s_try,
        s_switch,
        s_import,
        s_return,
        s_throw,
        s_local,
        s_break,
        s_continue,

        e_array,
        e_unary,
        e_binary,
        e_boolean,
        e_super,
        e_null,
        e_undefined,
        e_this,
        e_new,
        e_new_target,
        e_import_meta,
        e_call,
        e_dot,
        e_index,
        e_arrow,
        e_function,
        e_class,
        e_identifier,
        e_import_identifier,
        e_private_identifier,
        ejsx_element,
        e_missing,
        e_number,
        e_big_int,
        e_object,
        e_spread,
        e_string,
        e_template,
        e_reg_exp,
        e_await,
        e_yield,
        e_if,
        e_require,
        e_require_resolve,
        e_import,
    };

    // Source code location of the AST node.
    loc: logger.Loc,
    // this is relatively common.
    is_single_line: bool,

    //
    child: NodeIndex = NodeIndexNone,
    extra_data: ?[]NodeIndex,
    data_index: u16,
};

pub const AST = struct {
    node_tags: std.ArrayList(Node.Tag),
};

pub const Span = struct {
    text: []u8,
    range: logger.Range,
};

pub const ExportsKind = enum {
// This file doesn't have any kind of export, so it's impossible to say what
// kind of file this is. An empty file is in this category, for example.
none,

// The exports are stored on "module" and/or "exports". Calling "require()"
// on this module returns "module.exports". All imports to this module are
// allowed but may return undefined.
cjs,

// All export names are known explicitly. Calling "require()" on this module
// generates an exports object (stored in "exports") with getters for the
// export names. Named imports to this module are only allowed if they are
// in the set of export names.
esm,

// Some export names are known explicitly, but others fall back to a dynamic
// run-time object. This is necessary when using the "export * from" syntax
// with either a CommonJS module or an external module (i.e. a module whose
// export names are not known at compile-time).
//
// Calling "require()" on this module generates an exports object (stored in
// "exports") with getters for the export names. All named imports to this
// module are allowed. Direct named imports reference the corresponding export
// directly. Other imports go through property accesses on "exports".
esm_with_dyn };

pub fn isDynamicExport(exp: ExportsKind) bool {
    return kind == .cjs || kind == .esm_with_dyn;
}
