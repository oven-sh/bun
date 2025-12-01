// This function is taken from the official TypeScript compiler source code:
// https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
pub fn canFollowTypeArgumentsInExpression(p: anytype) bool {
    return switch (p.lexer.token) {
        // These are the only tokens can legally follow a type argument list. So we
        // definitely want to treat them as type arg lists.
        .t_open_paren, // foo<x>(
        .t_no_substitution_template_literal, // foo<T> `...`
        // foo<T> `...${100}...`
        .t_template_head,
        => true,

        // A type argument list followed by `<` never makes sense, and a type argument list followed
        // by `>` is ambiguous with a (re-scanned) `>>` operator, so we disqualify both. Also, in
        // this context, `+` and `-` are unary operators, not binary operators.
        .t_less_than,
        .t_greater_than,
        .t_plus,
        .t_minus,
        // TypeScript always sees "t_greater_than" instead of these tokens since
        // their scanner works a little differently than our lexer. So since
        // "t_greater_than" is forbidden above, we also forbid these too.
        .t_greater_than_equals,
        .t_greater_than_greater_than,
        .t_greater_than_greater_than_equals,
        .t_greater_than_greater_than_greater_than,
        .t_greater_than_greater_than_greater_than_equals,
        => false,

        // We favor the type argument list interpretation when it is immediately followed by
        // a line break, a binary operator, or something that can't start an expression.
        else => p.lexer.has_newline_before or isBinaryOperator(p) or !isStartOfExpression(p),
    };
}

pub const Metadata = union(enum) {
    m_none: void,

    m_never: void,
    m_unknown: void,
    m_any: void,
    m_void: void,
    m_null: void,
    m_undefined: void,
    m_function: void,
    m_array: void,
    m_boolean: void,
    m_string: void,
    m_object: void,
    m_number: void,
    m_bigint: void,
    m_symbol: void,
    m_promise: void,
    m_identifier: Ref,
    m_dot: List(Ref),

    pub const default: @This() = .m_none;

    // the logic in finishUnion, mergeUnion, finishIntersection and mergeIntersection is
    // translated from:
    // https://github.com/microsoft/TypeScript/blob/e0a324b0503be479f2b33fd2e17c6e86c94d1297/src/compiler/transformers/typeSerializer.ts#L402

    /// Return the final union type if possible, or return null to continue merging.
    ///
    /// If the current type is m_never, m_null, or m_undefined assign the current type
    /// to m_none and return null to ensure it's always replaced by the next type.
    pub fn finishUnion(current: *@This(), p: anytype) ?@This() {
        return switch (current.*) {
            .m_identifier => |ref| {
                if (strings.eqlComptime(p.loadNameFromRef(ref), "Object")) {
                    return .m_object;
                }
                return null;
            },

            .m_unknown,
            .m_any,
            .m_object,
            => .m_object,

            .m_never,
            .m_null,
            .m_undefined,
            => {
                current.* = .m_none;
                return null;
            },

            else => null,
        };
    }

    pub fn mergeUnion(result: *@This(), left: @This()) void {
        if (left != .m_none) {
            if (std.meta.activeTag(result.*) != std.meta.activeTag(left)) {
                result.* = switch (result.*) {
                    .m_never,
                    .m_undefined,
                    .m_null,
                    => left,

                    else => .m_object,
                };
            } else {
                switch (result.*) {
                    .m_identifier => |ref| {
                        if (!ref.eql(left.m_identifier)) {
                            result.* = .m_object;
                        }
                    },
                    else => {},
                }
            }
        } else {
            // always take the next value if left is m_none
        }
    }

    /// Return the final intersection type if possible, or return null to continue merging.
    ///
    /// If the current type is m_unknown, m_null, or m_undefined assign the current type
    /// to m_none and return null to ensure it's always replaced by the next type.
    pub fn finishIntersection(current: *@This(), p: anytype) ?@This() {
        return switch (current.*) {
            .m_identifier => |ref| {
                if (strings.eqlComptime(p.loadNameFromRef(ref), "Object")) {
                    return .m_object;
                }
                return null;
            },

            // ensure m_never is the final type
            .m_never => .m_never,

            .m_any,
            .m_object,
            => .m_object,

            .m_unknown,
            .m_null,
            .m_undefined,
            => {
                current.* = .m_none;
                return null;
            },

            else => null,
        };
    }

    pub fn mergeIntersection(result: *@This(), left: @This()) void {
        if (left != .m_none) {
            if (std.meta.activeTag(result.*) != std.meta.activeTag(left)) {
                result.* = switch (result.*) {
                    .m_unknown,
                    .m_undefined,
                    .m_null,
                    => left,

                    // ensure m_never is the final type
                    .m_never => .m_never,

                    else => .m_object,
                };
            } else {
                switch (result.*) {
                    .m_identifier => |ref| {
                        if (!ref.eql(left.m_identifier)) {
                            result.* = .m_object;
                        }
                    },
                    else => {},
                }
            }
        } else {
            // make sure intersection of only m_unknown serializes to "undefined"
            // instead of "Object"
            if (result.* == .m_unknown) {
                result.* = .m_undefined;
            }
        }
    }
};

pub fn isTSArrowFnJSX(p: anytype) !bool {
    const old_lexer = p.lexer;

    try p.lexer.next();
    // Look ahead to see if this should be an arrow function instead
    var is_ts_arrow_fn = false;

    if (p.lexer.token == .t_const) {
        try p.lexer.next();
    }
    if (p.lexer.token == .t_identifier) {
        try p.lexer.next();
        if (p.lexer.token == .t_comma or p.lexer.token == .t_equals) {
            is_ts_arrow_fn = true;
        } else if (p.lexer.token == .t_extends) {
            try p.lexer.next();
            is_ts_arrow_fn = p.lexer.token != .t_equals and p.lexer.token != .t_greater_than and p.lexer.token != .t_slash;
        }
    }

    // Restore the lexer
    p.lexer.restore(&old_lexer);
    return is_ts_arrow_fn;
}

// This function is taken from the official TypeScript compiler source code:
// https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
fn isBinaryOperator(p: anytype) bool {
    return switch (p.lexer.token) {
        .t_in => p.allow_in,

        .t_question_question,
        .t_bar_bar,
        .t_ampersand_ampersand,
        .t_bar,
        .t_caret,
        .t_ampersand,
        .t_equals_equals,
        .t_exclamation_equals,
        .t_equals_equals_equals,
        .t_exclamation_equals_equals,
        .t_less_than,
        .t_greater_than,
        .t_less_than_equals,
        .t_greater_than_equals,
        .t_instanceof,
        .t_less_than_less_than,
        .t_greater_than_greater_than,
        .t_greater_than_greater_than_greater_than,
        .t_plus,
        .t_minus,
        .t_asterisk,
        .t_slash,
        .t_percent,
        .t_asterisk_asterisk,
        => true,
        .t_identifier => p.lexer.isContextualKeyword("as") or p.lexer.isContextualKeyword("satisfies"),
        else => false,
    };
}

// This function is taken from the official TypeScript compiler source code:
// https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
fn isStartOfLeftHandSideExpression(p: anytype) bool {
    return switch (p.lexer.token) {
        .t_this,
        .t_super,
        .t_null,
        .t_true,
        .t_false,
        .t_numeric_literal,
        .t_big_integer_literal,
        .t_string_literal,
        .t_no_substitution_template_literal,
        .t_template_head,
        .t_open_paren,
        .t_open_bracket,
        .t_open_brace,
        .t_function,
        .t_class,
        .t_new,
        .t_slash,
        .t_slash_equals,
        .t_identifier,
        => true,
        .t_import => lookAheadNextTokenIsOpenParenOrLessThanOrDot(p),
        else => isIdentifier(p),
    };
}

fn lookAheadNextTokenIsOpenParenOrLessThanOrDot(p: anytype) bool {
    const old_lexer = p.lexer;
    const old_log_disabled = p.lexer.is_log_disabled;
    p.lexer.is_log_disabled = true;
    defer {
        p.lexer.restore(&old_lexer);
        p.lexer.is_log_disabled = old_log_disabled;
    }
    p.lexer.next() catch {};

    return switch (p.lexer.token) {
        .t_open_paren, .t_less_than, .t_dot => true,
        else => false,
    };
}

// This function is taken from the official TypeScript compiler source code:
// https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
fn isIdentifier(p: anytype) bool {
    if (p.lexer.token == .t_identifier) {
        // If we have a 'yield' keyword, and we're in the [yield] context, then 'yield' is
        // considered a keyword and is not an identifier.
        if (p.fn_or_arrow_data_parse.allow_yield != .allow_ident and strings.eqlComptime(p.lexer.identifier, "yield")) {
            return false;
        }

        // If we have an 'await' keyword, and we're in the [await] context, then 'await' is
        // considered a keyword and is not an identifier.
        if (p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(p.lexer.identifier, "await")) {
            return false;
        }

        return true;
    }

    return false;
}

fn isStartOfExpression(p: anytype) bool {
    if (isStartOfLeftHandSideExpression(p))
        return true;

    switch (p.lexer.token) {
        .t_plus,
        .t_minus,
        .t_tilde,
        .t_exclamation,
        .t_delete,
        .t_typeof,
        .t_void,
        .t_plus_plus,
        .t_minus_minus,
        .t_less_than,
        .t_private_identifier,
        .t_at,
        => return true,
        else => {
            if (p.lexer.token == .t_identifier and (strings.eqlComptime(p.lexer.identifier, "await") or strings.eqlComptime(p.lexer.identifier, "yield"))) {
                // Yield/await always starts an expression.  Either it is an identifier (in which case
                // it is definitely an expression).  Or it's a keyword (either because we're in
                // a generator or async function, or in strict mode (or both)) and it started a yield or await expression.
                return true;
            }

            // Error tolerance.  If we see the start of some binary operator, we consider
            // that the start of an expression.  That way we'll parse out a missing identifier,
            // give a good message about an identifier being missing, and then consume the
            // rest of the binary expression.
            if (isBinaryOperator(p)) {
                return true;
            }

            return isIdentifier(p);
        },
    }

    unreachable;
}

pub const Identifier = struct {
    pub const StmtIdentifier = enum {
        s_type,

        s_namespace,

        s_abstract,

        s_module,

        s_interface,

        s_declare,
    };
    pub fn forStr(str: string) ?StmtIdentifier {
        switch (str.len) {
            "type".len => return if (strings.eqlComptimeIgnoreLen(str, "type"))
                .s_type
            else
                null,
            "interface".len => {
                if (strings.eqlComptime(str, "interface")) {
                    return .s_interface;
                } else if (strings.eqlComptime(str, "namespace")) {
                    return .s_namespace;
                } else {
                    return null;
                }
            },
            "abstract".len => {
                if (strings.eqlComptime(str, "abstract")) {
                    return .s_abstract;
                } else {
                    return null;
                }
            },
            "declare".len => {
                if (strings.eqlComptime(str, "declare")) {
                    return .s_declare;
                } else {
                    return null;
                }
            },
            "module".len => {
                if (strings.eqlComptime(str, "module")) {
                    return .s_module;
                } else {
                    return null;
                }
            },
            else => return null,
        }
    }
    pub const IMap = bun.ComptimeStringMap(Kind, .{
        .{ "unique", .unique },
        .{ "abstract", .abstract },
        .{ "asserts", .asserts },

        .{ "keyof", .prefix_keyof },
        .{ "readonly", .prefix_readonly },

        .{ "any", .primitive_any },
        .{ "never", .primitive_never },
        .{ "unknown", .primitive_unknown },
        .{ "undefined", .primitive_undefined },
        .{ "object", .primitive_object },
        .{ "number", .primitive_number },
        .{ "string", .primitive_string },
        .{ "boolean", .primitive_boolean },
        .{ "bigint", .primitive_bigint },
        .{ "symbol", .primitive_symbol },

        .{ "infer", .infer },
    });
    pub const Kind = enum {
        normal,
        unique,
        abstract,
        asserts,
        prefix_keyof,
        prefix_readonly,
        primitive_any,
        primitive_never,
        primitive_unknown,
        primitive_undefined,
        primitive_object,
        primitive_number,
        primitive_string,
        primitive_boolean,
        primitive_bigint,
        primitive_symbol,
        infer,
    };
};

pub const SkipTypeOptions = enum {
    is_return_type,
    is_index_signature,
    allow_tuple_labels,
    disallow_conditional_types,

    pub const Bitset = std.enums.EnumSet(@This());
    pub const empty = Bitset.initEmpty();
};

const string = []const u8;

const bun = @import("bun");
const strings = bun.strings;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const Ref = js_parser.Ref;
const TypeScript = js_parser.TypeScript;

const std = @import("std");
const List = std.ArrayListUnmanaged;
