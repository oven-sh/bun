//! ** IMPORTANT **
//! ** When making changes to the JavaScript Parser that impact runtime behavior or fix bugs **
//! ** you must also increment the `expected_version` in RuntimeTranspilerCache.zig **
//! ** IMPORTANT **

const debug = Output.scoped(.JSParser, false);
pub const ExprListLoc = struct {
    list: ExprNodeList,
    loc: logger.Loc,
};

pub const locModuleScope = logger.Loc{ .start = -100 };

const DeferredImportNamespace = struct {
    namespace: LocRef,
    import_record_id: u32,
};

pub const SkipTypeParameterResult = enum {
    did_not_skip_anything,
    could_be_type_cast,
    definitely_type_parameters,
};

pub const TypeParameterFlag = packed struct(u8) {
    /// TypeScript 4.7
    allow_in_out_variance_annotations: bool = false,

    /// TypeScript 5.0
    allow_const_modifier: bool = false,

    /// Allow "<>" without any type parameters
    allow_empty_type_parameters: bool = false,

    _: u5 = 0,
};

const JSXImport = enum {
    jsx,
    jsxDEV,
    jsxs,
    Fragment,
    createElement,

    pub const Symbols = struct {
        jsx: ?LocRef = null,
        jsxDEV: ?LocRef = null,
        jsxs: ?LocRef = null,
        Fragment: ?LocRef = null,
        createElement: ?LocRef = null,

        pub fn get(noalias this: *const Symbols, name: []const u8) ?Ref {
            if (strings.eqlComptime(name, "jsx")) return if (this.jsx) |jsx| jsx.ref.? else null;
            if (strings.eqlComptime(name, "jsxDEV")) return if (this.jsxDEV) |jsx| jsx.ref.? else null;
            if (strings.eqlComptime(name, "jsxs")) return if (this.jsxs) |jsxs| jsxs.ref.? else null;
            if (strings.eqlComptime(name, "Fragment")) return if (this.Fragment) |Fragment| Fragment.ref.? else null;
            if (strings.eqlComptime(name, "createElement")) return if (this.createElement) |createElement| createElement.ref.? else null;
            return null;
        }

        pub fn getWithTag(noalias this: *const Symbols, tag: JSXImport) ?Ref {
            return switch (tag) {
                .jsx => if (this.jsx) |jsx| jsx.ref.? else null,
                .jsxDEV => if (this.jsxDEV) |jsx| jsx.ref.? else null,
                .jsxs => if (this.jsxs) |jsxs| jsxs.ref.? else null,
                .Fragment => if (this.Fragment) |Fragment| Fragment.ref.? else null,
                .createElement => if (this.createElement) |createElement| createElement.ref.? else null,
            };
        }

        pub fn runtimeImportNames(noalias this: *const Symbols, buf: *[3]string) []const string {
            var i: usize = 0;
            if (this.jsxDEV != null) {
                bun.assert(this.jsx == null); // we should never end up with this in the same file
                buf[0] = "jsxDEV";
                i += 1;
            }

            if (this.jsx != null) {
                bun.assert(this.jsxDEV == null); // we should never end up with this in the same file
                buf[0] = "jsx";
                i += 1;
            }

            if (this.jsxs != null) {
                buf[i] = "jsxs";
                i += 1;
            }

            if (this.Fragment != null) {
                buf[i] = "Fragment";
                i += 1;
            }

            return buf[0..i];
        }
        pub fn sourceImportNames(noalias this: *const Symbols) []const string {
            return if (this.createElement != null) &[_]string{"createElement"} else &[_]string{};
        }
    };
};

pub const arguments_str: string = "arguments";

// Dear reader,
// There are some things you should know about this file to make it easier for humans to read
// "P" is the internal parts of the parser
// "p.e" allocates a new Expr
// "p.b" allocates a new Binding
// "p.s" allocates a new Stmt
// We do it this way so if we want to refactor how these are allocated in the future, we only have to modify one function to change it everywhere
// Everything in JavaScript is either an Expression, a Binding, or a Statement.
//   Expression:  foo(1)
//    Statement:  let a = 1;
//      Binding:  a
// While the names for Expr, Binding, and Stmt are directly copied from esbuild, those were likely inspired by Go's parser.
// which is another example of a very fast parser.

const ScopeOrderList = std.ArrayListUnmanaged(?ScopeOrder);

// kept as a static reference
const exports_string_name: string = "exports";

const MacroRefData = struct {
    import_record_id: u32,
    // if name is null the macro is imported as a namespace import
    // import * as macros from "./macros.js" with {type: "macro"};
    name: ?string = null,
};

const MacroRefs = std.AutoArrayHashMap(Ref, MacroRefData);

const Substitution = union(enum) {
    success: Expr,
    failure: Expr,
    continue_: Expr,
};

/// Concatenate two `E.String`s, mutating BOTH inputs
/// unless `has_inlined_enum_poison` is set.
///
/// Currently inlined enum poison refers to where mutation would cause output
/// bugs due to inlined enum values sharing `E.String`s. If a new use case
/// besides inlined enums comes up to set this to true, please rename the
/// variable and document it.
fn joinStrings(left: *const E.String, right: *const E.String, has_inlined_enum_poison: bool) E.String {
    var new = if (has_inlined_enum_poison)
        // Inlined enums can be shared by multiple call sites. In
        // this case, we need to ensure that the ENTIRE rope is
        // cloned. In other situations, the lhs doesn't have any
        // other owner, so it is fine to mutate `lhs.data.end.next`.
        //
        // Consider the following case:
        //   const enum A {
        //     B = "a" + "b",
        //     D = B + "d",
        //   };
        //   console.log(A.B, A.D);
        left.cloneRopeNodes()
    else
        left.*;

    // Similarly, the right side has to be cloned for an enum rope too.
    //
    // Consider the following case:
    //   const enum A {
    //     B = "1" + "2",
    //     C = ("3" + B) + "4",
    //   };
    //   console.log(A.B, A.C);
    const rhs_clone = Expr.Data.Store.append(E.String, if (has_inlined_enum_poison)
        right.cloneRopeNodes()
    else
        right.*);

    new.push(rhs_clone);
    new.prefer_template = new.prefer_template or rhs_clone.prefer_template;

    return new;
}

/// Transforming the left operand into a string is not safe if it comes from a
/// nested AST node.
const FoldStringAdditionKind = enum {
    // "x" + "y" -> "xy"
    // 1 + "y" -> "1y"
    normal,
    // a + "x" + "y" -> a + "xy"
    // a + 1 + "y" -> a + 1 + y
    nested_left,
};

// NOTE: unlike esbuild's js_ast_helpers.FoldStringAddition, this does mutate
// the input AST in the case of rope strings
fn foldStringAddition(l: Expr, r: Expr, allocator: std.mem.Allocator, kind: FoldStringAdditionKind) ?Expr {
    // "See through" inline enum constants
    // TODO: implement foldAdditionPreProcess to fold some more things :)
    var lhs = l.unwrapInlined();
    var rhs = r.unwrapInlined();

    if (kind != .nested_left) {
        // See comment on `FoldStringAdditionKind` for examples
        switch (rhs.data) {
            .e_string, .e_template => {
                if (lhs.toStringExprWithoutSideEffects(allocator)) |str| {
                    lhs = str;
                }
            },
            else => {},
        }
    }

    switch (lhs.data) {
        .e_string => |left| {
            if (rhs.toStringExprWithoutSideEffects(allocator)) |str| {
                rhs = str;
            }

            if (left.isUTF8()) {
                switch (rhs.data) {
                    // "bar" + "baz" => "barbaz"
                    .e_string => |right| {
                        if (right.isUTF8()) {
                            const has_inlined_enum_poison =
                                l.data == .e_inlined_enum or
                                r.data == .e_inlined_enum;

                            return Expr.init(E.String, joinStrings(
                                left,
                                right,
                                has_inlined_enum_poison,
                            ), lhs.loc);
                        }
                    },
                    // "bar" + `baz${bar}` => `barbaz${bar}`
                    .e_template => |right| {
                        if (right.head.isUTF8()) {
                            return Expr.init(E.Template, E.Template{
                                .parts = right.parts,
                                .head = .{ .cooked = joinStrings(
                                    left,
                                    &right.head.cooked,
                                    l.data == .e_inlined_enum,
                                ) },
                            }, l.loc);
                        }
                    },
                    else => {
                        // other constant-foldable ast nodes would have been converted to .e_string
                    },
                }

                // "'x' + `y${z}`" => "`xy${z}`"
                if (rhs.data == .e_template and rhs.data.e_template.tag == null) {}
            }

            if (left.len() == 0 and rhs.knownPrimitive() == .string) {
                return rhs;
            }

            return null;
        },

        .e_template => |left| {
            // "`${x}` + 0" => "`${x}` + '0'"
            if (rhs.toStringExprWithoutSideEffects(allocator)) |str| {
                rhs = str;
            }

            if (left.tag == null) {
                switch (rhs.data) {
                    // `foo${bar}` + "baz" => `foo${bar}baz`
                    .e_string => |right| {
                        if (right.isUTF8()) {
                            // Mutation of this node is fine because it will be not
                            // be shared by other places. Note that e_template will
                            // be treated by enums as strings, but will not be
                            // inlined unless they could be converted into
                            // .e_string.
                            if (left.parts.len > 0) {
                                const i = left.parts.len - 1;
                                const last = left.parts[i];
                                if (last.tail.isUTF8()) {
                                    left.parts[i].tail = .{ .cooked = joinStrings(
                                        &last.tail.cooked,
                                        right,
                                        r.data == .e_inlined_enum,
                                    ) };
                                    return lhs;
                                }
                            } else {
                                if (left.head.isUTF8()) {
                                    left.head = .{ .cooked = joinStrings(
                                        &left.head.cooked,
                                        right,
                                        r.data == .e_inlined_enum,
                                    ) };
                                    return lhs;
                                }
                            }
                        }
                    },
                    // `foo${bar}` + `a${hi}b` => `foo${bar}a${hi}b`
                    .e_template => |right| {
                        if (right.tag == null and right.head.isUTF8()) {
                            if (left.parts.len > 0) {
                                const i = left.parts.len - 1;
                                const last = left.parts[i];
                                if (last.tail.isUTF8() and right.head.isUTF8()) {
                                    left.parts[i].tail = .{ .cooked = joinStrings(
                                        &last.tail.cooked,
                                        &right.head.cooked,
                                        r.data == .e_inlined_enum,
                                    ) };

                                    left.parts = if (right.parts.len == 0)
                                        left.parts
                                    else
                                        std.mem.concat(
                                            allocator,
                                            E.TemplatePart,
                                            &.{ left.parts, right.parts },
                                        ) catch bun.outOfMemory();
                                    return lhs;
                                }
                            } else {
                                if (left.head.isUTF8() and right.head.isUTF8()) {
                                    left.head = .{ .cooked = joinStrings(
                                        &left.head.cooked,
                                        &right.head.cooked,
                                        r.data == .e_inlined_enum,
                                    ) };
                                    left.parts = right.parts;
                                    return lhs;
                                }
                            }
                        }
                    },
                    else => {
                        // other constant-foldable ast nodes would have been converted to .e_string
                    },
                }
            }
        },

        else => {
            // other constant-foldable ast nodes would have been converted to .e_string
        },
    }

    if (rhs.data.as(.e_string)) |right| {
        if (right.len() == 0 and lhs.knownPrimitive() == .string) {
            return lhs;
        }
    }

    return null;
}

// If we are currently in a hoisted child of the module scope, relocate these
// declarations to the top level and return an equivalent assignment statement.
// Make sure to check that the declaration kind is "var" before calling this.
// And make sure to check that the returned statement is not the zero value.
//
// This is done to make some transformations non-destructive
// Without relocating vars to the top level, simplifying this:
// if (false) var foo = 1;
// to nothing is unsafe
// Because "foo" was defined. And now it's not.
pub const RelocateVars = struct {
    pub const Mode = enum { normal, for_in_or_for_of };

    stmt: ?Stmt = null,
    ok: bool = false,
};

pub const VisitArgsOpts = struct {
    body: []Stmt = &([_]Stmt{}),
    has_rest_arg: bool = false,

    // This is true if the function is an arrow function or a method
    is_unique_formal_parameters: bool = false,
};

pub fn ExpressionTransposer(
    comptime ContextType: type,
    comptime StateType: type,
    comptime visitor: fn (noalias ptr: *ContextType, arg: Expr, state: StateType) Expr,
) type {
    return struct {
        pub const Context = ContextType;
        pub const This = @This();

        context: *Context,

        pub fn init(c: *Context) This {
            return .{ .context = c };
        }

        pub fn maybeTransposeIf(self: *This, arg: Expr, state: StateType) Expr {
            switch (arg.data) {
                .e_if => |ex| {
                    return Expr.init(E.If, .{
                        .yes = self.maybeTransposeIf(ex.yes, state),
                        .no = self.maybeTransposeIf(ex.no, state),
                        .test_ = ex.test_,
                    }, arg.loc);
                },
                else => {
                    return visitor(self.context, arg, state);
                },
            }
        }

        pub fn transposeKnownToBeIf(self: *This, arg: Expr, state: StateType) Expr {
            return Expr.init(E.If, .{
                .yes = self.maybeTransposeIf(arg.data.e_if.yes, state),
                .no = self.maybeTransposeIf(arg.data.e_if.no, state),
                .test_ = arg.data.e_if.test_,
            }, arg.loc);
        }
    };
}

pub fn locAfterOp(e: E.Binary) logger.Loc {
    if (e.left.loc.start < e.right.loc.start) {
        return e.right.loc;
    } else {
        // handle the case when we have transposed the operands
        return e.left.loc;
    }
}

pub const TransposeState = struct {
    is_await_target: bool = false,
    is_then_catch_target: bool = false,
    is_require_immediately_assigned_to_decl: bool = false,
    loc: logger.Loc = logger.Loc.Empty,
    import_record_tag: ?ImportRecord.Tag = null,
    import_loader: ?bun.options.Loader = null,
    import_options: Expr = Expr.empty,
};

pub const JSXTag = struct {
    pub const TagType = enum { fragment, tag };
    pub const Data = union(TagType) {
        fragment: u8,
        tag: Expr,

        pub fn asExpr(d: *const Data) ?ExprNodeIndex {
            switch (d.*) {
                .tag => |tag| {
                    return tag;
                },
                else => {
                    return null;
                },
            }
        }
    };
    data: Data,
    range: logger.Range,
    /// Empty string for fragments.
    name: string,

    pub fn parse(comptime P: type, p: *P) anyerror!JSXTag {
        const loc = p.lexer.loc();

        // A missing tag is a fragment
        if (p.lexer.token == .t_greater_than) {
            return JSXTag{
                .range = logger.Range{ .loc = loc, .len = 0 },
                .data = Data{ .fragment = 1 },
                .name = "",
            };
        }

        // The tag is an identifier
        var name = p.lexer.identifier;
        var tag_range = p.lexer.range();
        try p.lexer.expectInsideJSXElementWithName(.t_identifier, "JSX element name");

        // Certain identifiers are strings
        // <div
        // <button
        // <Hello-:Button
        if (strings.containsComptime(name, "-:") or (p.lexer.token != .t_dot and name[0] >= 'a' and name[0] <= 'z')) {
            return JSXTag{
                .data = Data{ .tag = p.newExpr(E.String{
                    .data = name,
                }, loc) },
                .range = tag_range,
                .name = name,
            };
        }

        // Otherwise, this is an identifier
        // <Button>
        var tag = p.newExpr(E.Identifier{ .ref = try p.storeNameInRef(name) }, loc);

        // Parse a member expression chain
        // <Button.Red>
        while (p.lexer.token == .t_dot) {
            try p.lexer.nextInsideJSXElement();
            const member_range = p.lexer.range();
            const member = p.lexer.identifier;
            try p.lexer.expectInsideJSXElement(.t_identifier);

            if (strings.indexOfChar(member, '-')) |index| {
                try p.log.addError(p.source, logger.Loc{ .start = member_range.loc.start + @as(i32, @intCast(index)) }, "Unexpected \"-\"");
                return error.SyntaxError;
            }

            var _name = try p.allocator.alloc(u8, name.len + 1 + member.len);
            bun.copy(u8, _name, name);
            _name[name.len] = '.';
            bun.copy(u8, _name[name.len + 1 .. _name.len], member);
            name = _name;
            tag_range.len = member_range.loc.start + member_range.len - tag_range.loc.start;
            tag = p.newExpr(E.Dot{ .target = tag, .name = member, .name_loc = member_range.loc }, loc);
        }

        return JSXTag{ .data = Data{ .tag = tag }, .range = tag_range, .name = name };
    }
};

pub const TypeScript = struct {
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
            if (p.lexer.token == .t_comma) {
                is_ts_arrow_fn = true;
            } else if (p.lexer.token == .t_extends) {
                try p.lexer.next();
                is_ts_arrow_fn = p.lexer.token != .t_equals and p.lexer.token != .t_greater_than;
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
};

pub const ImportScanner = struct {
    stmts: []Stmt = &.{},
    kept_import_equals: bool = false,
    removed_import_equals: bool = false,

    pub fn scan(
        comptime P: type,
        p: *P,
        stmts: []Stmt,
        will_transform_to_common_js: bool,
        comptime hot_module_reloading_transformations: bool,
        hot_module_reloading_context: if (hot_module_reloading_transformations) *ConvertESMExportsForHmr else void,
    ) !ImportScanner {
        var scanner = ImportScanner{};
        var stmts_end: usize = 0;
        const allocator = p.allocator;
        const is_typescript_enabled: bool = comptime P.parser_features.typescript;

        for (stmts) |_stmt| {
            var stmt = _stmt; // copy
            switch (stmt.data) {
                .s_import => |import_ptr| {
                    var st = import_ptr.*;
                    defer import_ptr.* = st;

                    const record: *ImportRecord = &p.import_records.items[st.import_record_index];

                    if (record.path.isMacro()) {
                        record.is_unused = true;
                        record.path.is_disabled = true;
                        continue;
                    }

                    // The official TypeScript compiler always removes unused imported
                    // symbols. However, we deliberately deviate from the official
                    // TypeScript compiler's behavior doing this in a specific scenario:
                    // we are not bundling, symbol renaming is off, and the tsconfig.json
                    // "importsNotUsedAsValues" setting is present and is not set to
                    // "remove".
                    //
                    // This exists to support the use case of compiling partial modules for
                    // compile-to-JavaScript languages such as Svelte. These languages try
                    // to reference imports in ways that are impossible for esbuild to know
                    // about when esbuild is only given a partial module to compile. Here
                    // is an example of some Svelte code that might use esbuild to convert
                    // TypeScript to JavaScript:
                    //
                    //   <script lang="ts">
                    //     import Counter from './Counter.svelte';
                    //     export let name: string = 'world';
                    //   </script>
                    //   <main>
                    //     <h1>Hello {name}!</h1>
                    //     <Counter />
                    //   </main>
                    //
                    // Tools that use esbuild to compile TypeScript code inside a Svelte
                    // file like this only give esbuild the contents of the <script> tag.
                    // These tools work around this missing import problem when using the
                    // official TypeScript compiler by hacking the TypeScript AST to
                    // remove the "unused import" flags. This isn't possible in esbuild
                    // because esbuild deliberately does not expose an AST manipulation
                    // API for performance reasons.
                    //
                    // We deviate from the TypeScript compiler's behavior in this specific
                    // case because doing so is useful for these compile-to-JavaScript
                    // languages and is benign in other cases. The rationale is as follows:
                    //
                    //   * If "importsNotUsedAsValues" is absent or set to "remove", then
                    //     we don't know if these imports are values or types. It's not
                    //     safe to keep them because if they are types, the missing imports
                    //     will cause run-time failures because there will be no matching
                    //     exports. It's only safe keep imports if "importsNotUsedAsValues"
                    //     is set to "preserve" or "error" because then we can assume that
                    //     none of the imports are types (since the TypeScript compiler
                    //     would generate an error in that case).
                    //
                    //   * If we're bundling, then we know we aren't being used to compile
                    //     a partial module. The parser is seeing the entire code for the
                    //     module so it's safe to remove unused imports. And also we don't
                    //     want the linker to generate errors about missing imports if the
                    //     imported file is also in the bundle.
                    //
                    //   * If identifier minification is enabled, then using esbuild as a
                    //     partial-module transform library wouldn't work anyway because
                    //     the names wouldn't match. And that means we're minifying so the
                    //     user is expecting the output to be as small as possible. So we
                    //     should omit unused imports.
                    //
                    var did_remove_star_loc = false;
                    const keep_unused_imports = !p.options.features.trim_unused_imports;
                    // TypeScript always trims unused imports. This is important for
                    // correctness since some imports might be fake (only in the type
                    // system and used for type-only imports).
                    if (!keep_unused_imports) {
                        var found_imports = false;
                        var is_unused_in_typescript = true;

                        if (st.default_name) |default_name| {
                            found_imports = true;
                            const symbol = p.symbols.items[default_name.ref.?.innerIndex()];

                            // TypeScript has a separate definition of unused
                            if (is_typescript_enabled and p.ts_use_counts.items[default_name.ref.?.innerIndex()] != 0) {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if (symbol.use_count_estimate == 0) {
                                st.default_name = null;
                            }
                        }

                        // Remove the star import if it's unused
                        if (st.star_name_loc) |_| {
                            found_imports = true;
                            const symbol = p.symbols.items[st.namespace_ref.innerIndex()];

                            // TypeScript has a separate definition of unused
                            if (is_typescript_enabled and p.ts_use_counts.items[st.namespace_ref.innerIndex()] != 0) {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if (symbol.use_count_estimate == 0) {
                                // Make sure we don't remove this if it was used for a property
                                // access while bundling
                                var has_any = false;

                                if (p.import_items_for_namespace.get(st.namespace_ref)) |entry| {
                                    if (entry.count() > 0) {
                                        has_any = true;
                                    }
                                }

                                if (!has_any) {
                                    st.star_name_loc = null;
                                    did_remove_star_loc = true;
                                }
                            }
                        }

                        // Remove items if they are unused
                        if (st.items.len > 0) {
                            found_imports = true;
                            var items_end: usize = 0;
                            for (st.items) |item| {
                                const ref = item.name.ref.?;
                                const symbol: Symbol = p.symbols.items[ref.innerIndex()];

                                // TypeScript has a separate definition of unused
                                if (is_typescript_enabled and p.ts_use_counts.items[ref.innerIndex()] != 0) {
                                    is_unused_in_typescript = false;
                                }

                                // Remove the symbol if it's never used outside a dead code region
                                if (symbol.use_count_estimate != 0) {
                                    st.items[items_end] = item;
                                    items_end += 1;
                                }
                            }

                            st.items = st.items[0..items_end];
                        }

                        // -- Original Comment --
                        // Omit this statement if we're parsing TypeScript and all imports are
                        // unused. Note that this is distinct from the case where there were
                        // no imports at all (e.g. "import 'foo'"). In that case we want to keep
                        // the statement because the user is clearly trying to import the module
                        // for side effects.
                        //
                        // This culling is important for correctness when parsing TypeScript
                        // because a) the TypeScript compiler does this and we want to match it
                        // and b) this may be a fake module that only exists in the type system
                        // and doesn't actually exist in reality.
                        //
                        // We do not want to do this culling in JavaScript though because the
                        // module may have side effects even if all imports are unused.
                        // -- Original Comment --

                        // jarred: I think, in this project, we want this behavior, even in JavaScript.
                        // I think this would be a big performance improvement.
                        // The less you import, the less code you transpile.
                        // Side-effect imports are nearly always done through identifier-less imports
                        // e.g. `import 'fancy-stylesheet-thing/style.css';`
                        // This is a breaking change though. We can make it an option with some guardrail
                        // so maybe if it errors, it shows a suggestion "retry without trimming unused imports"
                        if ((is_typescript_enabled and found_imports and is_unused_in_typescript and !p.options.preserve_unused_imports_ts) or
                            (!is_typescript_enabled and p.options.features.trim_unused_imports and found_imports and st.star_name_loc == null and st.items.len == 0 and st.default_name == null))
                        {
                            // internal imports are presumed to be always used
                            // require statements cannot be stripped
                            if (!record.is_internal and !record.was_originally_require) {
                                record.is_unused = true;
                                continue;
                            }
                        }
                    }

                    const namespace_ref = st.namespace_ref;
                    const convert_star_to_clause = !p.options.bundle and (p.symbols.items[namespace_ref.innerIndex()].use_count_estimate == 0);

                    if (convert_star_to_clause and !keep_unused_imports) {
                        st.star_name_loc = null;
                    }

                    record.contains_default_alias = record.contains_default_alias or st.default_name != null;

                    const existing_items: ImportItemForNamespaceMap = p.import_items_for_namespace.get(namespace_ref) orelse
                        ImportItemForNamespaceMap.init(allocator);

                    if (p.options.bundle) {
                        if (st.star_name_loc != null and existing_items.count() > 0) {
                            const sorted = try allocator.alloc(string, existing_items.count());
                            defer allocator.free(sorted);
                            for (sorted, existing_items.keys()) |*result, alias| {
                                result.* = alias;
                            }
                            strings.sortDesc(sorted);
                            p.named_imports.ensureUnusedCapacity(p.allocator, sorted.len) catch bun.outOfMemory();

                            // Create named imports for these property accesses. This will
                            // cause missing imports to generate useful warnings.
                            //
                            // It will also improve bundling efficiency for internal imports
                            // by still converting property accesses off the namespace into
                            // bare identifiers even if the namespace is still needed.
                            for (sorted) |alias| {
                                const item = existing_items.get(alias).?;
                                p.named_imports.put(
                                    p.allocator,
                                    item.ref.?,
                                    js_ast.NamedImport{
                                        .alias = alias,
                                        .alias_loc = item.loc,
                                        .namespace_ref = namespace_ref,
                                        .import_record_index = st.import_record_index,
                                    },
                                ) catch bun.outOfMemory();

                                const name: LocRef = item;
                                const name_ref = name.ref.?;

                                // Make sure the printer prints this as a property access
                                var symbol: *Symbol = &p.symbols.items[name_ref.innerIndex()];

                                symbol.namespace_alias = G.NamespaceAlias{
                                    .namespace_ref = namespace_ref,
                                    .alias = alias,
                                    .import_record_index = st.import_record_index,
                                    .was_originally_property_access = st.star_name_loc != null and existing_items.contains(symbol.original_name),
                                };

                                // Also record these automatically-generated top-level namespace alias symbols
                                p.declared_symbols.append(p.allocator, .{
                                    .ref = name_ref,
                                    .is_top_level = true,
                                }) catch unreachable;
                            }
                        }

                        p.named_imports.ensureUnusedCapacity(
                            p.allocator,
                            st.items.len + @as(usize, @intFromBool(st.default_name != null)) + @as(usize, @intFromBool(st.star_name_loc != null)),
                        ) catch bun.outOfMemory();

                        if (st.star_name_loc) |loc| {
                            record.contains_import_star = true;
                            p.named_imports.putAssumeCapacity(
                                namespace_ref,
                                js_ast.NamedImport{
                                    .alias_is_star = true,
                                    .alias = "",
                                    .alias_loc = loc,
                                    .namespace_ref = Ref.None,
                                    .import_record_index = st.import_record_index,
                                },
                            );
                        }

                        if (st.default_name) |default| {
                            record.contains_default_alias = true;
                            p.named_imports.putAssumeCapacity(
                                default.ref.?,
                                .{
                                    .alias = "default",
                                    .alias_loc = default.loc,
                                    .namespace_ref = namespace_ref,
                                    .import_record_index = st.import_record_index,
                                },
                            );
                        }

                        for (st.items) |item| {
                            const name: LocRef = item.name;
                            const name_ref = name.ref.?;

                            p.named_imports.putAssumeCapacity(
                                name_ref,
                                js_ast.NamedImport{
                                    .alias = item.alias,
                                    .alias_loc = name.loc,
                                    .namespace_ref = namespace_ref,
                                    .import_record_index = st.import_record_index,
                                },
                            );
                        }
                    } else {
                        // ESM requires live bindings
                        // CommonJS does not require live bindings
                        // We load ESM in browsers & in Bun.js
                        // We have to simulate live bindings for cases where the code is bundled
                        // We do not know at this stage whether or not the import statement is bundled
                        // This keeps track of the `namespace_alias` incase, at printing time, we determine that we should print it with the namespace
                        for (st.items) |item| {
                            record.contains_default_alias = record.contains_default_alias or strings.eqlComptime(item.alias, "default");

                            const name: LocRef = item.name;
                            const name_ref = name.ref.?;

                            try p.named_imports.put(p.allocator, name_ref, js_ast.NamedImport{
                                .alias = item.alias,
                                .alias_loc = name.loc,
                                .namespace_ref = namespace_ref,
                                .import_record_index = st.import_record_index,
                            });

                            // Make sure the printer prints this as a property access
                            var symbol: *Symbol = &p.symbols.items[name_ref.innerIndex()];
                            if (record.contains_import_star or st.star_name_loc != null)
                                symbol.namespace_alias = G.NamespaceAlias{
                                    .namespace_ref = namespace_ref,
                                    .alias = item.alias,
                                    .import_record_index = st.import_record_index,
                                    .was_originally_property_access = st.star_name_loc != null and existing_items.contains(symbol.original_name),
                                };
                        }

                        if (record.was_originally_require) {
                            var symbol = &p.symbols.items[namespace_ref.innerIndex()];
                            symbol.namespace_alias = G.NamespaceAlias{
                                .namespace_ref = namespace_ref,
                                .alias = "",
                                .import_record_index = st.import_record_index,
                                .was_originally_property_access = false,
                            };
                        }
                    }

                    try p.import_records_for_current_part.append(allocator, st.import_record_index);

                    record.contains_import_star = record.contains_import_star or st.star_name_loc != null;
                    record.contains_default_alias = record.contains_default_alias or st.default_name != null;

                    for (st.items) |*item| {
                        record.contains_default_alias = record.contains_default_alias or strings.eqlComptime(item.alias, "default");
                        record.contains_es_module_alias = record.contains_es_module_alias or strings.eqlComptime(item.alias, "__esModule");
                    }
                },

                .s_function => |st| {
                    if (st.func.flags.contains(.is_export)) {
                        if (st.func.name) |name| {
                            const original_name = p.symbols.items[name.ref.?.innerIndex()].original_name;
                            try p.recordExport(name.loc, original_name, name.ref.?);
                        } else {
                            try p.log.addRangeError(p.source, logger.Range{ .loc = st.func.open_parens_loc, .len = 2 }, "Exported functions must have a name");
                        }
                    }
                },
                .s_class => |st| {
                    if (st.is_export) {
                        if (st.class.class_name) |name| {
                            try p.recordExport(name.loc, p.symbols.items[name.ref.?.innerIndex()].original_name, name.ref.?);
                        } else {
                            try p.log.addRangeError(p.source, logger.Range{ .loc = st.class.body_loc, .len = 0 }, "Exported classes must have a name");
                        }
                    }
                },
                .s_local => |st| {
                    if (st.is_export) {
                        for (st.decls.slice()) |decl| {
                            p.recordExportedBinding(decl.binding);
                        }
                    }

                    // Remove unused import-equals statements, since those likely
                    // correspond to types instead of values
                    if (st.was_ts_import_equals and !st.is_export and st.decls.len > 0) {
                        var decl = st.decls.ptr[0];

                        // Skip to the underlying reference
                        var value = decl.value;
                        if (decl.value != null) {
                            while (true) {
                                if (@as(Expr.Tag, value.?.data) == .e_dot) {
                                    value = value.?.data.e_dot.target;
                                } else {
                                    break;
                                }
                            }
                        }

                        // Is this an identifier reference and not a require() call?
                        if (value) |val| {
                            if (@as(Expr.Tag, val.data) == .e_identifier) {
                                // Is this import statement unused?
                                if (@as(Binding.Tag, decl.binding.data) == .b_identifier and p.symbols.items[decl.binding.data.b_identifier.ref.innerIndex()].use_count_estimate == 0) {
                                    p.ignoreUsage(val.data.e_identifier.ref);

                                    scanner.removed_import_equals = true;
                                    continue;
                                } else {
                                    scanner.kept_import_equals = true;
                                }
                            }
                        }
                    }
                },
                .s_export_default => |st| {
                    // This is defer'd so that we still record export default for identifiers
                    defer {
                        if (st.default_name.ref) |ref| {
                            p.recordExport(st.default_name.loc, "default", ref) catch {};
                        }
                    }

                    // Rewrite this export to be:
                    // exports.default =
                    // But only if it's anonymous
                    if (!hot_module_reloading_transformations and will_transform_to_common_js and P != bun.bundle_v2.AstBuilder) {
                        const expr = st.value.toExpr();
                        var export_default_args = try p.allocator.alloc(Expr, 2);
                        export_default_args[0] = p.@"module.exports"(expr.loc);
                        export_default_args[1] = expr;
                        stmt = p.s(S.SExpr{ .value = p.callRuntime(expr.loc, "__exportDefault", export_default_args) }, expr.loc);
                    }
                },
                .s_export_clause => |st| {
                    for (st.items) |item| {
                        try p.recordExport(item.alias_loc, item.alias, item.name.ref.?);
                    }
                },
                .s_export_star => |st| {
                    try p.import_records_for_current_part.append(allocator, st.import_record_index);

                    if (st.alias) |alias| {
                        // "export * as ns from 'path'"
                        try p.named_imports.put(p.allocator, st.namespace_ref, js_ast.NamedImport{
                            .alias = null,
                            .alias_is_star = true,
                            .alias_loc = alias.loc,
                            .namespace_ref = Ref.None,
                            .import_record_index = st.import_record_index,
                            .is_exported = true,
                        });
                        try p.recordExport(alias.loc, alias.original_name, st.namespace_ref);
                        var record = &p.import_records.items[st.import_record_index];
                        record.contains_import_star = true;
                    } else {
                        // "export * from 'path'"
                        try p.export_star_import_records.append(allocator, st.import_record_index);
                    }
                },
                .s_export_from => |st| {
                    try p.import_records_for_current_part.append(allocator, st.import_record_index);
                    p.named_imports.ensureUnusedCapacity(p.allocator, st.items.len) catch unreachable;
                    for (st.items) |item| {
                        const ref = item.name.ref orelse p.panic("Expected export from item to have a name {any}", .{st});
                        // Note that the imported alias is not item.Alias, which is the
                        // exported alias. This is somewhat confusing because each
                        // SExportFrom statement is basically SImport + SExportClause in one.
                        try p.named_imports.put(p.allocator, ref, js_ast.NamedImport{
                            .alias_is_star = false,
                            .alias = item.original_name,
                            .alias_loc = item.name.loc,
                            .namespace_ref = st.namespace_ref,
                            .import_record_index = st.import_record_index,
                            .is_exported = true,
                        });
                        try p.recordExport(item.name.loc, item.alias, ref);

                        var record = &p.import_records.items[st.import_record_index];
                        if (strings.eqlComptime(item.original_name, "default")) {
                            record.contains_default_alias = true;
                        } else if (strings.eqlComptime(item.original_name, "__esModule")) {
                            record.contains_es_module_alias = true;
                        }
                    }
                },
                else => {},
            }

            if (hot_module_reloading_transformations) {
                try hot_module_reloading_context.convertStmt(p, stmt);
            } else {
                stmts[stmts_end] = stmt;
                stmts_end += 1;
            }
        }

        if (!hot_module_reloading_transformations)
            scanner.stmts = stmts[0..stmts_end];

        return scanner;
    }
};

/// We must prevent collisions from generated names with user's names.
///
/// When transpiling for the runtime, we want to avoid adding a pass over all
/// the symbols in the file (we do this in the bundler since there is more than
/// one file, and user symbols from different files may collide with each
/// other).
///
/// This makes sure that there's the lowest possible chance of having a generated name
/// collide with a user's name. This is the easiest way to do so
pub inline fn generatedSymbolName(name: []const u8) []const u8 {
    comptime {
        const hash = std.hash.Wyhash.hash(0, name);
        const hash_str = std.fmt.comptimePrint("_{}", .{bun.fmt.truncatedHash32(@intCast(hash))});
        return name ++ hash_str;
    }
}

pub const ExprOrLetStmt = struct {
    stmt_or_expr: js_ast.StmtOrExpr,
    decls: []G.Decl = &([_]G.Decl{}),
};

const FunctionKind = enum { stmt, expr };

pub const AsyncPrefixExpression = enum(u2) {
    none,
    is_yield,
    is_async,
    is_await,

    const map = bun.ComptimeStringMap(AsyncPrefixExpression, .{
        .{ "yield", .is_yield },
        .{ "await", .is_await },
        .{ "async", .is_async },
    });

    pub fn find(ident: string) AsyncPrefixExpression {
        return map.get(ident) orelse .none;
    }
};

pub const IdentifierOpts = packed struct(u8) {
    assign_target: js_ast.AssignTarget = js_ast.AssignTarget.none,
    is_delete_target: bool = false,
    was_originally_identifier: bool = false,
    is_call_target: bool = false,
    _padding: u3 = 0,
};

pub fn statementCaresAboutScope(stmt: Stmt) bool {
    return switch (stmt.data) {
        .s_block,
        .s_empty,
        .s_debugger,
        .s_expr,
        .s_if,
        .s_for,
        .s_for_in,
        .s_for_of,
        .s_do_while,
        .s_while,
        .s_with,
        .s_try,
        .s_switch,
        .s_return,
        .s_throw,
        .s_break,
        .s_continue,
        .s_directive,
        .s_label,
        => false,

        .s_local => |local| local.kind != .k_var,
        else => true,
    };
}

pub const ExprIn = struct {
    // This tells us if there are optional chain expressions (EDot, EIndex, or
    // ECall) that are chained on to this expression. Because of the way the AST
    // works, chaining expressions on to this expression means they are our
    // parent expressions.
    //
    // Some examples:
    //
    //   a?.b.c  // EDot
    //   a?.b[c] // EIndex
    //   a?.b()  // ECall
    //
    // Note that this is false if our parent is a node with a OptionalChain
    // value of OptionalChainStart. That means it's the start of a new chain, so
    // it's not considered part of this one.
    //
    // Some examples:
    //
    //   a?.b?.c   // EDot
    //   a?.b?.[c] // EIndex
    //   a?.b?.()  // ECall
    //
    // Also note that this is false if our parent is a node with a OptionalChain
    // value of OptionalChainNone. That means it's outside parentheses, which
    // means it's no longer part of the chain.
    //
    // Some examples:
    //
    //   (a?.b).c  // EDot
    //   (a?.b)[c] // EIndex
    //   (a?.b)()  // ECall
    //
    has_chain_parent: bool = false,

    // If our parent is an ECall node with an OptionalChain value of
    // OptionalChainStart, then we will need to store the value for the "this" of
    // that call somewhere if the current expression is an optional chain that
    // ends in a property access. That's because the value for "this" will be
    // used twice: once for the inner optional chain and once for the outer
    // optional chain.
    //
    // Example:
    //
    //   // Original
    //   a?.b?.();
    //
    //   // Lowered
    //   var _a;
    //   (_a = a == null ? void 0 : a.b) == null ? void 0 : _a.call(a);
    //
    // In the example above we need to store "a" as the value for "this" so we
    // can substitute it back in when we call "_a" if "_a" is indeed present.
    // See also "thisArgFunc" and "thisArgWrapFunc" in "exprOut".
    store_this_arg_for_parent_optional_chain: bool = false,

    // Certain substitutions of identifiers are disallowed for assignment targets.
    // For example, we shouldn't transform "undefined = 1" into "void 0 = 1". This
    // isn't something real-world code would do but it matters for conformance
    // tests.
    assign_target: js_ast.AssignTarget = js_ast.AssignTarget.none,

    // Currently this is only used when unwrapping a call to `require()`
    // with `__toESM()`.
    is_immediately_assigned_to_decl: bool = false,

    property_access_for_method_call_maybe_should_replace_with_undefined: bool = false,
};

// This function exists to tie all of these checks together in one place
// This can sometimes show up on benchmarks as a small thing.
pub fn isEvalOrArguments(name: string) bool {
    return strings.eqlComptime(name, "eval") or strings.eqlComptime(name, "arguments");
}

pub const PrependTempRefsOpts = struct {
    fn_body_loc: ?logger.Loc = null,
    kind: StmtsKind = StmtsKind.none,
};

pub const StmtsKind = enum {
    none,
    loop_body,
    switch_stmt,
    fn_body,
};

fn notimpl() noreturn {
    Output.panic("Not implemented yet!!", .{});
}

const ExprBindingTuple = struct {
    expr: ?ExprNodeIndex = null,
    binding: ?Binding = null,
};

pub const TempRef = struct {
    ref: Ref,
    value: ?Expr = null,
};

const ImportNamespaceCallOrConstruct = struct {
    ref: Ref,
    is_construct: bool = false,
};

pub const ThenCatchChain = struct {
    next_target: js_ast.Expr.Data,
    has_multiple_args: bool = false,
    has_catch: bool = false,
};

pub const ParsedPath = struct {
    loc: logger.Loc,
    text: string,
    is_macro: bool,
    import_tag: ImportRecord.Tag = .none,
    loader: ?bun.options.Loader = null,
};

const StrictModeFeature = enum {
    with_statement,
    delete_bare_name,
    for_in_var_init,
    eval_or_arguments,
    reserved_word,
    legacy_octal_literal,
    legacy_octal_escape,
    if_else_function_stmt,
};

const InvalidLoc = struct {
    loc: logger.Loc,
    kind: Tag = Tag.unknown,

    pub const Tag = enum {
        spread,
        parentheses,
        getter,
        setter,
        method,
        unknown,
    };

    pub fn addError(loc: InvalidLoc, log: *logger.Log, source: *const logger.Source) void {
        @branchHint(.cold);
        const text = switch (loc.kind) {
            .spread => "Unexpected trailing comma after rest element",
            .parentheses => "Unexpected parentheses in binding pattern",
            .getter => "Unexpected getter in binding pattern",
            .setter => "Unexpected setter in binding pattern",
            .method => "Unexpected method in binding pattern",
            .unknown => "Invalid binding pattern",
        };
        log.addError(source, loc.loc, text) catch unreachable;
    }
};
pub const LocList = ListManaged(InvalidLoc);
pub const StmtList = ListManaged(Stmt);

// This hash table is used every time we parse function args
// Rather than allocating a new hash table each time, we can just reuse the previous allocation

pub const StringVoidMap = struct {
    allocator: Allocator,
    map: bun.StringHashMapUnmanaged(void) = bun.StringHashMapUnmanaged(void){},

    /// Returns true if the map already contained the given key.
    pub fn getOrPutContains(this: *StringVoidMap, key: string) bool {
        const entry = this.map.getOrPut(this.allocator, key) catch unreachable;
        return entry.found_existing;
    }

    pub fn contains(this: *StringVoidMap, key: string) bool {
        return this.map.contains(key);
    }

    fn init(allocator: Allocator) anyerror!StringVoidMap {
        return StringVoidMap{ .allocator = allocator };
    }

    pub fn reset(noalias this: *StringVoidMap) void {
        // We must reset or the hash table will contain invalid pointers
        this.map.clearRetainingCapacity();
    }

    pub inline fn get(allocator: Allocator) *Node {
        return Pool.get(allocator);
    }

    pub inline fn release(node: *Node) void {
        Pool.release(node);
    }

    pub const Pool = ObjectPool(StringVoidMap, init, true, 32);
    pub const Node = Pool.Node;
};

const StringBoolMap = bun.StringHashMapUnmanaged(bool);
const RefMap = std.HashMapUnmanaged(Ref, void, RefCtx, 80);

const RefRefMap = std.HashMapUnmanaged(Ref, Ref, RefCtx, 80);

pub const ScopeOrder = struct {
    loc: logger.Loc,
    scope: *js_ast.Scope,
};

pub const ParenExprOpts = struct {
    async_range: logger.Range = logger.Range.None,
    is_async: bool = false,
    force_arrow_fn: bool = false,
};

pub const AwaitOrYield = enum(u3) {
    allow_ident,
    allow_expr,
    forbid_all,
};

/// This is function-specific information used during parsing. It is saved and
/// restored on the call stack around code that parses nested functions and
/// arrow expressions.
pub const FnOrArrowDataParse = struct {
    async_range: logger.Range = logger.Range.None,
    needs_async_loc: logger.Loc = logger.Loc.Empty,
    allow_await: AwaitOrYield = AwaitOrYield.allow_ident,
    allow_yield: AwaitOrYield = AwaitOrYield.allow_ident,
    allow_super_call: bool = false,
    allow_super_property: bool = false,
    is_top_level: bool = false,
    is_constructor: bool = false,
    is_typescript_declare: bool = false,

    has_argument_decorators: bool = false,
    has_decorators: bool = false,

    is_return_disallowed: bool = false,
    is_this_disallowed: bool = false,

    has_async_range: bool = false,
    arrow_arg_errors: DeferredArrowArgErrors = DeferredArrowArgErrors{},
    track_arrow_arg_errors: bool = false,

    // In TypeScript, forward declarations of functions have no bodies
    allow_missing_body_for_type_script: bool = false,

    // Allow TypeScript decorators in function arguments
    allow_ts_decorators: bool = false,

    pub fn i() FnOrArrowDataParse {
        return FnOrArrowDataParse{ .allow_await = AwaitOrYield.forbid_all };
    }
};

// This is function-specific information used during visiting. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
pub const FnOrArrowDataVisit = struct {
    // super_index_ref: ?*Ref = null,

    is_arrow: bool = false,
    is_async: bool = false,
    is_inside_loop: bool = false,
    is_inside_switch: bool = false,
    is_outside_fn_or_arrow: bool = false,

    // This is used to silence unresolvable imports due to "require" calls inside
    // a try/catch statement. The assumption is that the try/catch statement is
    // there to handle the case where the reference to "require" crashes.
    try_body_count: i32 = 0,
};

/// This is function-specific information used during visiting. It is saved and
/// restored on the call stack around code that parses nested functions (but not
/// nested arrow functions).
pub const FnOnlyDataVisit = struct {
    // This is a reference to the magic "arguments" variable that exists inside
    // functions in JavaScript. It will be non-nil inside functions and nil
    // otherwise.
    arguments_ref: ?Ref = null,

    // Arrow functions don't capture the value of "this" and "arguments". Instead,
    // the values are inherited from the surrounding context. If arrow functions
    // are turned into regular functions due to lowering, we will need to generate
    // local variables to capture these values so they are preserved correctly.
    this_capture_ref: ?Ref = null,
    arguments_capture_ref: ?Ref = null,

    /// This is a reference to the enclosing class name if there is one. It's used
    /// to implement "this" and "super" references. A name is automatically generated
    /// if one is missing so this will always be present inside a class body.
    class_name_ref: ?*Ref = null,

    /// If true, we're inside a static class context where "this" expressions
    /// should be replaced with the class name.
    should_replace_this_with_class_name_ref: bool = false,

    // If we're inside an async arrow function and async functions are not
    // supported, then we will have to convert that arrow function to a generator
    // function. That means references to "arguments" inside the arrow function
    // will have to reference a captured variable instead of the real variable.
    is_inside_async_arrow_fn: bool = false,

    // If false, disallow "new.target" expressions. We disallow all "new.target"
    // expressions at the top-level of the file (i.e. not inside a function or
    // a class field). Technically since CommonJS files are wrapped in a function
    // you can use "new.target" in node as an alias for "undefined" but we don't
    // support that.
    is_new_target_allowed: bool = false,

    // If false, the value for "this" is the top-level module scope "this" value.
    // That means it's "undefined" for ECMAScript modules and "exports" for
    // CommonJS modules. We track this information so that we can substitute the
    // correct value for these top-level "this" references at compile time instead
    // of passing the "this" expression through to the output and leaving the
    // interpretation up to the run-time behavior of the generated code.
    //
    // If true, the value for "this" is nested inside something (either a function
    // or a class declaration). That means the top-level module scope "this" value
    // has been shadowed and is now inaccessible.
    is_this_nested: bool = false,
};

// Due to ES6 destructuring patterns, there are many cases where it's
// impossible to distinguish between an array or object literal and a
// destructuring assignment until we hit the "=" operator later on.
// This object defers errors about being in one state or the other
// until we discover which state we're in.
pub const DeferredErrors = struct {
    // These are errors for expressions
    invalid_expr_default_value: ?logger.Range = null,
    invalid_expr_after_question: ?logger.Range = null,
    array_spread_feature: ?logger.Range = null,

    pub fn isEmpty(self: *DeferredErrors) bool {
        return self.invalid_expr_default_value == null and self.invalid_expr_after_question == null and self.array_spread_feature == null;
    }

    pub fn mergeInto(self: *DeferredErrors, to: *DeferredErrors) void {
        to.invalid_expr_default_value = self.invalid_expr_default_value orelse to.invalid_expr_default_value;
        to.invalid_expr_after_question = self.invalid_expr_after_question orelse to.invalid_expr_after_question;
        to.array_spread_feature = self.array_spread_feature orelse to.array_spread_feature;
    }

    const None = DeferredErrors{
        .invalid_expr_default_value = null,
        .invalid_expr_after_question = null,
        .array_spread_feature = null,
    };
};

pub const ImportClause = struct {
    items: []js_ast.ClauseItem = &([_]js_ast.ClauseItem{}),
    is_single_line: bool = false,
    had_type_only_imports: bool = false,
};

pub const PropertyOpts = struct {
    async_range: logger.Range = logger.Range.None,
    declare_range: logger.Range = logger.Range.None,
    is_async: bool = false,
    is_generator: bool = false,

    // Class-related options
    is_static: bool = false,
    is_class: bool = false,
    class_has_extends: bool = false,
    allow_ts_decorators: bool = false,
    is_ts_abstract: bool = false,
    ts_decorators: []Expr = &[_]Expr{},
    has_argument_decorators: bool = false,
    has_class_decorators: bool = false,
};

pub const ScanPassResult = struct {
    pub const ParsePassSymbolUse = struct { ref: Ref, used: bool = false, import_record_index: u32 };
    pub const NamespaceCounter = struct { count: u16, import_record_index: u32 };
    pub const ParsePassSymbolUsageMap = bun.StringArrayHashMap(ParsePassSymbolUse);
    import_records: ListManaged(ImportRecord),
    named_imports: js_ast.Ast.NamedImports,
    used_symbols: ParsePassSymbolUsageMap,
    import_records_to_keep: ListManaged(u32),
    approximate_newline_count: usize = 0,

    pub fn init(allocator: Allocator) ScanPassResult {
        return .{
            .import_records = ListManaged(ImportRecord).init(allocator),
            .named_imports = .{},
            .used_symbols = ParsePassSymbolUsageMap.init(allocator),
            .import_records_to_keep = ListManaged(u32).init(allocator),
            .approximate_newline_count = 0,
        };
    }

    pub fn reset(scan_pass: *ScanPassResult) void {
        scan_pass.named_imports.clearRetainingCapacity();
        scan_pass.import_records.clearRetainingCapacity();
        scan_pass.used_symbols.clearRetainingCapacity();
        scan_pass.approximate_newline_count = 0;
    }
};

const FindLabelSymbolResult = struct { ref: Ref, is_loop: bool, found: bool = false };

const FindSymbolResult = struct {
    ref: Ref,
    declare_loc: ?logger.Loc = null,
    is_inside_with_scope: bool = false,
};
pub const ExportClauseResult = struct {
    clauses: []js_ast.ClauseItem = &([_]js_ast.ClauseItem{}),
    is_single_line: bool = false,
    had_type_only_exports: bool = false,
};

pub const DeferredTsDecorators = struct {
    values: []js_ast.Expr,

    // If this turns out to be a "declare class" statement, we need to undo the
    // scopes that were potentially pushed while parsing the decorator arguments.
    scope_index: usize,
};

const LexicalDecl = enum(u8) { forbid, allow_all, allow_fn_inside_if, allow_fn_inside_label };

pub const ParseClassOptions = struct {
    ts_decorators: []Expr = &[_]Expr{},
    allow_ts_decorators: bool = false,
    is_type_script_declare: bool = false,
};

pub const ParseStatementOptions = struct {
    ts_decorators: ?DeferredTsDecorators = null,
    lexical_decl: LexicalDecl = .forbid,
    is_module_scope: bool = false,
    is_namespace_scope: bool = false,
    is_export: bool = false,
    is_using_statement: bool = false,
    is_name_optional: bool = false, // For "export default" pseudo-statements,
    is_typescript_declare: bool = false,
    is_for_loop_init: bool = false,

    pub fn hasDecorators(self: *ParseStatementOptions) bool {
        const decs = self.ts_decorators orelse return false;
        return decs.values.len > 0;
    }
};

var e_missing_data = E.Missing{};
var s_missing = S.Empty{};
var nullExprData = Expr.Data{ .e_missing = e_missing_data };
var nullStmtData = Stmt.Data{ .s_empty = s_missing };
pub const Prefill = struct {
    pub const HotModuleReloading = struct {
        pub var DebugEnabledArgs = [_]Expr{
            Expr{ .data = .{ .e_boolean = E.Boolean{ .value = true } }, .loc = logger.Loc.Empty },
        };
        pub var DebugDisabled = [_]Expr{
            Expr{ .data = .{ .e_boolean = E.Boolean{ .value = false } }, .loc = logger.Loc.Empty },
        };
        pub var ActivateString = E.String{
            .data = "activate",
        };
        pub var ActivateIndex = E.Index{
            .index = .{
                .data = .{
                    .e_string = &ActivateString,
                },
                .loc = logger.Loc.Empty,
            },
            .target = undefined,
        };
    };
    pub const StringLiteral = struct {
        pub const Key = [3]u8{ 'k', 'e', 'y' };
        pub const Children = [_]u8{ 'c', 'h', 'i', 'l', 'd', 'r', 'e', 'n' };
        pub const Filename = [_]u8{ 'f', 'i', 'l', 'e', 'N', 'a', 'm', 'e' };
        pub const LineNumber = [_]u8{ 'l', 'i', 'n', 'e', 'N', 'u', 'm', 'b', 'e', 'r' };
        pub const ColumnNumber = [_]u8{ 'c', 'o', 'l', 'u', 'm', 'n', 'N', 'u', 'm', 'b', 'e', 'r' };
    };
    pub const Value = struct {
        pub const EThis = E.This{};
        pub const Zero = E.Number{ .value = 0.0 };
    };
    pub const String = struct {
        pub var Key = E.String{ .data = &Prefill.StringLiteral.Key };
        pub var Children = E.String{ .data = &Prefill.StringLiteral.Children };
        pub var Filename = E.String{ .data = &Prefill.StringLiteral.Filename };
        pub var LineNumber = E.String{ .data = &Prefill.StringLiteral.LineNumber };
        pub var ColumnNumber = E.String{ .data = &Prefill.StringLiteral.ColumnNumber };

        pub var @"$$typeof" = E.String{ .data = "$$typeof" };
        pub var @"type" = E.String{ .data = "type" };
        pub var ref = E.String{ .data = "ref" };
        pub var props = E.String{ .data = "props" };
        pub var _owner = E.String{ .data = "_owner" };
        pub var REACT_ELEMENT_TYPE = E.String{ .data = "react.element" };
    };
    pub const Data = struct {
        pub var BMissing = B{ .b_missing = BMissing_ };
        pub var BMissing_ = B.Missing{};

        pub var EMissing = Expr.Data{ .e_missing = EMissing_ };
        pub var EMissing_ = E.Missing{};

        pub var SEmpty = Stmt.Data{ .s_empty = SEmpty_ };
        pub var SEmpty_ = S.Empty{};

        pub var Filename = Expr.Data{ .e_string = &Prefill.String.Filename };
        pub var LineNumber = Expr.Data{ .e_string = &Prefill.String.LineNumber };
        pub var ColumnNumber = Expr.Data{ .e_string = &Prefill.String.ColumnNumber };
        pub var @"$$typeof" = Expr.Data{ .e_string = &Prefill.String.@"$$typeof" };
        pub var key = Expr.Data{ .e_string = &Prefill.String.Key };
        pub var @"type" = Expr.Data{ .e_string = &Prefill.String.type };
        pub var ref = Expr.Data{ .e_string = &Prefill.String.ref };
        pub var props = Expr.Data{ .e_string = &Prefill.String.props };
        pub var _owner = Expr.Data{ .e_string = &Prefill.String._owner };
        pub var REACT_ELEMENT_TYPE = Expr.Data{ .e_string = &Prefill.String.REACT_ELEMENT_TYPE };
        pub const This = Expr.Data{ .e_this = E.This{} };
        pub const Zero = Expr.Data{ .e_number = Value.Zero };
    };
};

const ReactJSX = struct {
    hoisted_elements: std.ArrayHashMapUnmanaged(Ref, G.Decl, bun.ArrayIdentityContext, false) = .{},
};

var keyExprData = Expr.Data{ .e_string = &Prefill.String.Key };
var nullExprValueData = E.Null{};
var falseExprValueData = E.Boolean{ .value = false };
var nullValueExpr = Expr.Data{ .e_null = nullExprValueData };
var falseValueExpr = Expr.Data{ .e_boolean = E.Boolean{ .value = false } };

pub const ImportOrRequireScanResults = struct {
    import_records: List(ImportRecord),
};

pub const JSXTransformType = enum {
    none,
    react,
};

const ParserFeatures = struct {
    typescript: bool = false,
    jsx: JSXTransformType = .none,
    scan_only: bool = false,
};

pub const ImportItemForNamespaceMap = bun.StringArrayHashMap(LocRef);

pub const KnownGlobal = enum {
    WeakSet,
    WeakMap,
    Date,
    Set,
    Map,
    Headers,
    Response,
    TextEncoder,
    TextDecoder,

    pub const map = bun.ComptimeEnumMap(KnownGlobal);

    pub noinline fn maybeMarkConstructorAsPure(noalias e: *E.New, symbols: []const Symbol) void {
        const id = if (e.target.data == .e_identifier) e.target.data.e_identifier.ref else return;
        const symbol = &symbols[id.innerIndex()];
        if (symbol.kind != .unbound)
            return;

        const constructor = map.get(symbol.original_name) orelse return;

        switch (constructor) {
            .WeakSet, .WeakMap => {
                const n = e.args.len;

                if (n == 0) {
                    // "new WeakSet()" is pure
                    e.can_be_unwrapped_if_unused = true;

                    return;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].data) {
                        .e_null, .e_undefined => {
                            // "new WeakSet(null)" is pure
                            // "new WeakSet(void 0)" is pure
                            e.can_be_unwrapped_if_unused = true;
                        },
                        .e_array => |array| {
                            if (array.items.len == 0) {
                                // "new WeakSet([])" is pure
                                e.can_be_unwrapped_if_unused = true;
                            } else {
                                // "new WeakSet([x])" is impure because an exception is thrown if "x" is not an object
                            }
                        },
                        else => {
                            // "new WeakSet(x)" is impure because the iterator for "x" could have side effects
                        },
                    }
                }
            },
            .Date => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Date()" is pure
                    e.can_be_unwrapped_if_unused = true;

                    return;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].knownPrimitive()) {
                        .null, .undefined, .boolean, .number, .string => {
                            // "new Date('')" is pure
                            // "new Date(0)" is pure
                            // "new Date(null)" is pure
                            // "new Date(true)" is pure
                            // "new Date(false)" is pure
                            // "new Date(undefined)" is pure
                            e.can_be_unwrapped_if_unused = true;
                        },
                        else => {
                            // "new Date(x)" is impure because the argument could be a string with side effects

                        },
                    }
                }
            },

            .Set => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Set()" is pure
                    e.can_be_unwrapped_if_unused = true;
                    return;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].data) {
                        .e_array, .e_null, .e_undefined => {
                            // "new Set([a, b, c])" is pure
                            // "new Set(null)" is pure
                            // "new Set(void 0)" is pure
                            e.can_be_unwrapped_if_unused = true;
                        },
                        else => {
                            // "new Set(x)" is impure because the iterator for "x" could have side effects
                        },
                    }
                }
            },

            .Headers => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Headers()" is pure
                    e.can_be_unwrapped_if_unused = true;

                    return;
                }
            },

            .Response => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Response()" is pure
                    e.can_be_unwrapped_if_unused = true;

                    return;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].knownPrimitive()) {
                        .null, .undefined, .boolean, .number, .string => {
                            // "new Response('')" is pure
                            // "new Response(0)" is pure
                            // "new Response(null)" is pure
                            // "new Response(true)" is pure
                            // "new Response(false)" is pure
                            // "new Response(undefined)" is pure

                            e.can_be_unwrapped_if_unused = true;
                        },
                        else => {
                            // "new Response(x)" is impure
                        },
                    }
                }
            },
            .TextDecoder, .TextEncoder => {
                const n = e.args.len;

                if (n == 0) {
                    // "new TextEncoder()" is pure
                    // "new TextDecoder()" is pure
                    e.can_be_unwrapped_if_unused = true;

                    return;
                }

                // We _could_ validate the encoding argument
                // But let's not bother
            },

            .Map => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Map()" is pure
                    e.can_be_unwrapped_if_unused = true;
                    return;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].data) {
                        .e_null, .e_undefined => {
                            // "new Map(null)" is pure
                            // "new Map(void 0)" is pure
                            e.can_be_unwrapped_if_unused = true;
                        },
                        .e_array => |array| {
                            var all_items_are_arrays = true;
                            for (array.items.slice()) |item| {
                                if (item.data != .e_array) {
                                    all_items_are_arrays = false;
                                    break;
                                }
                            }

                            if (all_items_are_arrays) {
                                // "new Map([[a, b], [c, d]])" is pure
                                e.can_be_unwrapped_if_unused = true;
                            }
                        },
                        else => {
                            // "new Map(x)" is impure because the iterator for "x" could have side effects
                        },
                    }
                }
            },
        }
    }
};

pub const MacroState = struct {
    refs: MacroRefs,
    prepend_stmts: *ListManaged(Stmt) = undefined,
    imports: std.AutoArrayHashMap(i32, Ref),

    pub fn init(allocator: Allocator) MacroState {
        return MacroState{
            .refs = MacroRefs.init(allocator),
            .prepend_stmts = undefined,
            .imports = std.AutoArrayHashMap(i32, Ref).init(allocator),
        };
    }
};

pub const Jest = struct {
    expect: Ref = Ref.None,
    describe: Ref = Ref.None,
    @"test": Ref = Ref.None,
    it: Ref = Ref.None,
    beforeEach: Ref = Ref.None,
    afterEach: Ref = Ref.None,
    beforeAll: Ref = Ref.None,
    afterAll: Ref = Ref.None,
    jest: Ref = Ref.None,
};

// workaround for https://github.com/ziglang/zig/issues/10903
fn NewParser(
    comptime parser_features: ParserFeatures,
) type {
    return NewParser_(
        parser_features.typescript,
        parser_features.jsx,
        parser_features.scan_only,
    );
}
pub fn NewParser_(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    const js_parser_features: ParserFeatures = .{
        .typescript = parser_feature__typescript,
        .jsx = parser_feature__jsx,
        .scan_only = parser_feature__scan_only,
    };

    // P is for Parser!
    return struct {
        const js_parser_jsx = js_parser_features.jsx;
        pub const is_typescript_enabled = js_parser_features.typescript;
        pub const is_jsx_enabled = js_parser_jsx != .none;
        pub const only_scan_imports_and_do_not_visit = js_parser_features.scan_only;
        const ImportRecordList = if (only_scan_imports_and_do_not_visit) *std.ArrayList(ImportRecord) else std.ArrayList(ImportRecord);
        const NamedImportsType = if (only_scan_imports_and_do_not_visit) *js_ast.Ast.NamedImports else js_ast.Ast.NamedImports;
        const NeedsJSXType = if (only_scan_imports_and_do_not_visit) bool else void;
        pub const track_symbol_usage_during_parse_pass = only_scan_imports_and_do_not_visit and is_typescript_enabled;
        const ParsePassSymbolUsageType = if (track_symbol_usage_during_parse_pass) *ScanPassResult.ParsePassSymbolUsageMap else void;

        pub const parser_features: ParserFeatures = js_parser_features;
        const P = @This();
        pub const jsx_transform_type: JSXTransformType = js_parser_jsx;
        pub const allow_macros = FeatureFlags.is_macro_enabled;
        const MacroCallCountType = if (allow_macros) u32 else u0;

        const skipTypescript_zig = @import("ast/skipTypescript.zig").SkipTypescript(P);
        pub const skipTypescriptReturnType = skipTypescript_zig.skipTypescriptReturnType;
        pub const skipTypescriptReturnTypeWithMetadata = skipTypescript_zig.skipTypescriptReturnTypeWithMetadata;
        pub const skipTypeScriptType = skipTypescript_zig.skipTypeScriptType;
        pub const skipTypeScriptTypeWithMetadata = skipTypescript_zig.skipTypeScriptTypeWithMetadata;
        pub const skipTypeScriptBinding = skipTypescript_zig.skipTypeScriptBinding;
        pub const skipTypescriptFnArgs = skipTypescript_zig.skipTypescriptFnArgs;
        pub const skipTypeScriptParenOrFnType = skipTypescript_zig.skipTypeScriptParenOrFnType;
        pub const skipTypeScriptTypeWithOpts = skipTypescript_zig.skipTypeScriptTypeWithOpts;
        pub const skipTypeScriptObjectType = skipTypescript_zig.skipTypeScriptObjectType;
        pub const skipTypeScriptTypeParameters = skipTypescript_zig.skipTypeScriptTypeParameters;
        pub const skipTypeScriptTypeStmt = skipTypescript_zig.skipTypeScriptTypeStmt;
        pub const skipTypeScriptInterfaceStmt = skipTypescript_zig.skipTypeScriptInterfaceStmt;
        pub const skipTypeScriptTypeArguments = skipTypescript_zig.skipTypeScriptTypeArguments;
        pub const trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking = skipTypescript_zig.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking;
        pub const trySkipTypeScriptTypeArgumentsWithBacktracking = skipTypescript_zig.trySkipTypeScriptTypeArgumentsWithBacktracking;
        pub const trySkipTypeScriptArrowReturnTypeWithBacktracking = skipTypescript_zig.trySkipTypeScriptArrowReturnTypeWithBacktracking;
        pub const trySkipTypeScriptArrowArgsWithBacktracking = skipTypescript_zig.trySkipTypeScriptArrowArgsWithBacktracking;
        pub const trySkipTypeScriptConstraintOfInferTypeWithBacktracking = skipTypescript_zig.trySkipTypeScriptConstraintOfInferTypeWithBacktracking;

        const parse_zig = @import("ast/parse.zig").Parse(P);
        pub const parsePrefix = parse_zig.parsePrefix;
        pub const parseSuffix = parse_zig.parseSuffix;
        pub const parseStmt = parse_zig.parseStmt;
        pub const parseProperty = parse_zig.parseProperty;
        pub const parseFn = parse_zig.parseFn;
        pub const parseFnStmt = parse_zig.parseFnStmt;
        pub const parseFnExpr = parse_zig.parseFnExpr;
        pub const parseFnBody = parse_zig.parseFnBody;
        pub const parseArrowBody = parse_zig.parseArrowBody;
        pub const parseJSXElement = parse_zig.parseJSXElement;
        pub const parseImportExpr = parse_zig.parseImportExpr;
        pub const parseImportClause = parse_zig.parseImportClause;
        pub const parseExportClause = parse_zig.parseExportClause;
        pub const parseExprOrBindings = parse_zig.parseExprOrBindings;
        pub const parseExpr = parse_zig.parseExpr;
        pub const parseExprWithFlags = parse_zig.parseExprWithFlags;
        pub const parseExprCommon = parse_zig.parseExprCommon;
        pub const parseYieldExpr = parse_zig.parseYieldExpr;
        pub const parseClass = parse_zig.parseClass;
        pub const parseTemplateParts = parse_zig.parseTemplateParts;
        pub const parseStringLiteral = parse_zig.parseStringLiteral;
        pub const parseCallArgs = parse_zig.parseCallArgs;
        pub const parseJSXPropValueIdentifier = parse_zig.parseJSXPropValueIdentifier;
        pub const parseParenExpr = parse_zig.parseParenExpr;
        pub const parseLabelName = parse_zig.parseLabelName;
        pub const parseClassStmt = parse_zig.parseClassStmt;
        pub const parseClauseAlias = parse_zig.parseClauseAlias;
        pub const parseExprOrLetStmt = parse_zig.parseExprOrLetStmt;
        pub const parseBinding = parse_zig.parseBinding;
        pub const parsePropertyBinding = parse_zig.parsePropertyBinding;
        pub const parseAndDeclareDecls = parse_zig.parseAndDeclareDecls;
        pub const parsePath = parse_zig.parsePath;
        pub const parseStmtsUpTo = parse_zig.parseStmtsUpTo;
        pub const parseAsyncPrefixExpr = parse_zig.parseAsyncPrefixExpr;
        pub const parseTypeScriptDecorators = parse_zig.parseTypeScriptDecorators;
        pub const parseTypeScriptNamespaceStmt = parse_zig.parseTypeScriptNamespaceStmt;
        pub const parseTypeScriptImportEqualsStmt = parse_zig.parseTypeScriptImportEqualsStmt;
        pub const parseTypescriptEnumStmt = parse_zig.parseTypescriptEnumStmt;

        macro: MacroState = undefined,
        allocator: Allocator,
        options: Parser.Options,
        log: *logger.Log,
        define: *Define,
        source: *const logger.Source,
        lexer: js_lexer.Lexer,
        allow_in: bool = false,
        allow_private_identifiers: bool = false,

        has_top_level_return: bool = false,
        latest_return_had_semicolon: bool = false,
        has_import_meta: bool = false,
        has_es_module_syntax: bool = false,
        top_level_await_keyword: logger.Range = logger.Range.None,
        fn_or_arrow_data_parse: FnOrArrowDataParse = FnOrArrowDataParse{},
        fn_or_arrow_data_visit: FnOrArrowDataVisit = FnOrArrowDataVisit{},
        fn_only_data_visit: FnOnlyDataVisit = FnOnlyDataVisit{},
        allocated_names: List(string) = .{},
        // allocated_names: ListManaged(string) = ListManaged(string).init(bun.default_allocator),
        // allocated_names_pool: ?*AllocatedNamesPool.Node = null,
        latest_arrow_arg_loc: logger.Loc = logger.Loc.Empty,
        forbid_suffix_after_as_loc: logger.Loc = logger.Loc.Empty,
        current_scope: *js_ast.Scope = undefined,
        scopes_for_current_part: List(*js_ast.Scope) = .{},
        symbols: ListManaged(js_ast.Symbol) = undefined,
        ts_use_counts: List(u32) = .{},
        exports_ref: Ref = Ref.None,
        require_ref: Ref = Ref.None,
        module_ref: Ref = Ref.None,
        filename_ref: Ref = Ref.None,
        dirname_ref: Ref = Ref.None,
        import_meta_ref: Ref = Ref.None,
        hmr_api_ref: Ref = Ref.None,
        scopes_in_order_visitor_index: usize = 0,
        has_classic_runtime_warned: bool = false,
        macro_call_count: MacroCallCountType = 0,

        hoisted_ref_for_sloppy_mode_block_fn: RefRefMap = .{},

        /// Used for transforming export default -> module.exports
        has_export_default: bool = false,
        has_export_keyword: bool = false,

        // Used for forcing CommonJS
        has_with_scope: bool = false,

        is_file_considered_to_have_esm_exports: bool = false,

        has_called_runtime: bool = false,

        legacy_cjs_import_stmts: std.ArrayList(Stmt),

        injected_define_symbols: List(Ref) = .{},
        symbol_uses: SymbolUseMap = .{},
        declared_symbols: DeclaredSymbol.List = .{},
        declared_symbols_for_reuse: DeclaredSymbol.List = .{},
        runtime_imports: RuntimeImports = RuntimeImports{},

        /// Used with unwrap_commonjs_packages
        imports_to_convert_from_require: List(DeferredImportNamespace) = .{},
        unwrap_all_requires: bool = false,

        commonjs_named_exports: js_ast.Ast.CommonJSNamedExports = .{},
        commonjs_named_exports_deoptimized: bool = false,
        commonjs_module_exports_assigned_deoptimized: bool = false,
        commonjs_named_exports_needs_conversion: u32 = std.math.maxInt(u32),
        had_commonjs_named_exports_this_visit: bool = false,
        commonjs_replacement_stmts: StmtNodeList = &.{},

        parse_pass_symbol_uses: ParsePassSymbolUsageType = undefined,

        /// Used by commonjs_at_runtime
        has_commonjs_export_names: bool = false,

        stack_check: bun.StackCheck,

        /// When this flag is enabled, we attempt to fold all expressions that
        /// TypeScript would consider to be "constant expressions". This flag is
        /// enabled inside each enum body block since TypeScript requires numeric
        /// constant folding in enum definitions.
        ///
        /// We also enable this flag in certain cases in JavaScript files such as when
        /// parsing "const" declarations at the top of a non-ESM file, but we still
        /// reuse TypeScript's notion of "constant expressions" for our own convenience.
        ///
        /// As of TypeScript 5.0, a "constant expression" is defined as follows:
        ///
        ///   An expression is considered a constant expression if it is
        ///
        ///   * a number or string literal,
        ///   * a unary +, -, or ~ applied to a numeric constant expression,
        ///   * a binary +, -, *, /, %, **, <<, >>, >>>, |, &, ^ applied to two numeric constant expressions,
        ///   * a binary + applied to two constant expressions whereof at least one is a string,
        ///   * a template expression where each substitution expression is a constant expression,
        ///   * a parenthesized constant expression,
        ///   * a dotted name (e.g. x.y.z) that references a const variable with a constant expression initializer and no type annotation,
        ///   * a dotted name that references an enum member with an enum literal type, or
        ///   * a dotted name indexed by a string literal (e.g. x.y["z"]) that references an enum member with an enum literal type.
        ///
        /// More detail: https://github.com/microsoft/TypeScript/pull/50528. Note that
        /// we don't implement certain items in this list. For example, we don't do all
        /// number-to-string conversions since ours might differ from how JavaScript
        /// would do it, which would be a correctness issue.
        ///
        /// This flag is also set globally when minify_syntax is enabled, in which this means
        /// we always fold constant expressions.
        should_fold_typescript_constant_expressions: bool = false,

        emitted_namespace_vars: RefMap = RefMap{},
        is_exported_inside_namespace: RefRefMap = .{},
        local_type_names: StringBoolMap = StringBoolMap{},

        // This is the reference to the generated function argument for the namespace,
        // which is different than the reference to the namespace itself:
        //
        //   namespace ns {
        //   }
        //
        // The code above is transformed into something like this:
        //
        //   var ns1;
        //   (function(ns2) {
        //   })(ns1 or (ns1 = {}));
        //
        // This variable is "ns2" not "ns1". It is only used during the second
        // "visit" pass.
        enclosing_namespace_arg_ref: ?Ref = null,

        jsx_imports: JSXImport.Symbols = .{},

        /// only applicable when `.options.features.react_fast_refresh` is set.
        /// populated before visit pass starts.
        react_refresh: ReactRefresh = .{},

        /// only applicable when `.options.features.server_components` is
        /// configured to wrap exports. populated before visit pass starts.
        server_components_wrap_ref: Ref = Ref.None,

        jest: Jest = .{},

        // Imports (both ES6 and CommonJS) are tracked at the top level
        import_records: ImportRecordList,
        import_records_for_current_part: List(u32) = .{},
        export_star_import_records: List(u32) = .{},
        import_symbol_property_uses: SymbolPropertyUseMap = .{},

        // These are for handling ES6 imports and exports
        esm_import_keyword: logger.Range = logger.Range.None,
        esm_export_keyword: logger.Range = logger.Range.None,
        enclosing_class_keyword: logger.Range = logger.Range.None,
        import_items_for_namespace: std.AutoHashMapUnmanaged(Ref, ImportItemForNamespaceMap) = .{},
        is_import_item: RefMap = .{},
        named_imports: NamedImportsType,
        named_exports: js_ast.Ast.NamedExports,
        import_namespace_cc_map: Map(ImportNamespaceCallOrConstruct, bool) = .{},

        // When we're only scanning the imports
        // If they're using the automatic JSX runtime
        // We won't know that we need to import JSX robustly because we don't track
        // symbol counts. Instead, we ask:
        // "Did we parse anything that looked like JSX"?
        // If yes, then automatically add the JSX import.
        needs_jsx_import: NeedsJSXType,

        // The parser does two passes and we need to pass the scope tree information
        // from the first pass to the second pass. That's done by tracking the calls
        // to pushScopeForParsePass() and popScope() during the first pass in
        // scopesInOrder.
        //
        // Then, when the second pass calls pushScopeForVisitPass() and popScope(),
        // we consume entries from scopesInOrder and make sure they are in the same
        // order. This way the second pass can efficiently use the same scope tree
        // as the first pass without having to attach the scope tree to the AST.
        //
        // We need to split this into two passes because the pass that declares the
        // symbols must be separate from the pass that binds identifiers to declared
        // symbols to handle declaring a hoisted "var" symbol in a nested scope and
        // binding a name to it in a parent or sibling scope.
        scopes_in_order: ScopeOrderList = .{},
        scope_order_to_visit: []ScopeOrder = &.{},

        // These properties are for the visit pass, which runs after the parse pass.
        // The visit pass binds identifiers to declared symbols, does constant
        // folding, substitutes compile-time variable definitions, and lowers certain
        // syntactic constructs as appropriate.
        stmt_expr_value: Expr.Data,
        call_target: Expr.Data,
        delete_target: Expr.Data,
        loop_body: Stmt.Data,
        module_scope: *js_ast.Scope = undefined,
        module_scope_directive_loc: logger.Loc = .{},
        is_control_flow_dead: bool = false,

        /// We must be careful to avoid revisiting nodes that have scopes.
        is_revisit_for_substitution: bool = false,

        method_call_must_be_replaced_with_undefined: bool = false,

        // Inside a TypeScript namespace, an "export declare" statement can be used
        // to cause a namespace to be emitted even though it has no other observable
        // effect. This flag is used to implement this feature.
        //
        // Specifically, namespaces should be generated for all of the following
        // namespaces below except for "f", which should not be generated:
        //
        //   namespace a { export declare const a }
        //   namespace b { export declare let [[b]] }
        //   namespace c { export declare function c() }
        //   namespace d { export declare class d {} }
        //   namespace e { export declare enum e {} }
        //   namespace f { export declare namespace f {} }
        //
        // The TypeScript compiler compiles this into the following code (notice "f"
        // is missing):
        //
        //   var a; (function (a_1) {})(a or (a = {}));
        //   var b; (function (b_1) {})(b or (b = {}));
        //   var c; (function (c_1) {})(c or (c = {}));
        //   var d; (function (d_1) {})(d or (d = {}));
        //   var e; (function (e_1) {})(e or (e = {}));
        //
        // Note that this should not be implemented by declaring symbols for "export
        // declare" statements because the TypeScript compiler doesn't generate any
        // code for these statements, so these statements are actually references to
        // global variables. There is one exception, which is that local variables
        // *should* be declared as symbols because they are replaced with. This seems
        // like very arbitrary behavior but it's what the TypeScript compiler does,
        // so we try to match it.
        //
        // Specifically, in the following code below "a" and "b" should be declared
        // and should be substituted with "ns.a" and "ns.b" but the other symbols
        // shouldn't. References to the other symbols actually refer to global
        // variables instead of to symbols that are exported from the namespace.
        // This is the case as of TypeScript 4.3. I assume this is a TypeScript bug:
        //
        //   namespace ns {
        //     export declare const a
        //     export declare let [[b]]
        //     export declare function c()
        //     export declare class d { }
        //     export declare enum e { }
        //     console.log(a, b, c, d, e)
        //   }
        //
        // The TypeScript compiler compiles this into the following code:
        //
        //   var ns;
        //   (function (ns) {
        //       console.log(ns.a, ns.b, c, d, e);
        //   })(ns or (ns = {}));
        //
        // Relevant issue: https://github.com/evanw/esbuild/issues/1158
        has_non_local_export_declare_inside_namespace: bool = false,

        // This helps recognize the "await import()" pattern. When this is present,
        // warnings about non-string import paths will be omitted inside try blocks.
        await_target: ?js_ast.Expr.Data = null,

        to_expr_wrapper_namespace: Binding2ExprWrapper.Namespace,
        to_expr_wrapper_hoisted: Binding2ExprWrapper.Hoisted,

        // This helps recognize the "import().catch()" pattern. We also try to avoid
        // warning about this just like the "try { await import() }" pattern.
        then_catch_chain: ThenCatchChain,

        // Temporary variables used for lowering
        temp_refs_to_declare: List(TempRef) = .{},
        temp_ref_count: i32 = 0,

        // When bundling, hoisted top-level local variables declared with "var" in
        // nested scopes are moved up to be declared in the top-level scope instead.
        // The old "var" statements are turned into regular assignments instead. This
        // makes it easier to quickly scan the top-level statements for "var" locals
        // with the guarantee that all will be found.
        relocated_top_level_vars: List(js_ast.LocRef) = .{},

        // ArrowFunction is a special case in the grammar. Although it appears to be
        // a PrimaryExpression, it's actually an AssignmentExpression. This means if
        // a AssignmentExpression ends up producing an ArrowFunction then nothing can
        // come after it other than the comma operator, since the comma operator is
        // the only thing above AssignmentExpression under the Expression rule:
        //
        //   AssignmentExpression:
        //     ArrowFunction
        //     ConditionalExpression
        //     LeftHandSideExpression = AssignmentExpression
        //     LeftHandSideExpression AssignmentOperator AssignmentExpression
        //
        //   Expression:
        //     AssignmentExpression
        //     Expression , AssignmentExpression
        //
        after_arrow_body_loc: logger.Loc = logger.Loc.Empty,
        import_transposer: ImportTransposer,
        require_transposer: RequireTransposer,
        require_resolve_transposer: RequireResolveTransposer,

        const_values: js_ast.Ast.ConstValuesMap = .{},

        // These are backed by stack fallback allocators in _parse, and are uninitialized until then.
        binary_expression_stack: ListManaged(BinaryExpressionVisitor) = undefined,
        binary_expression_simplify_stack: ListManaged(SideEffects.BinaryExpressionSimplifyVisitor) = undefined,

        /// We build up enough information about the TypeScript namespace hierarchy to
        /// be able to resolve scope lookups and property accesses for TypeScript enum
        /// and namespace features. Each JavaScript scope object inside a namespace
        /// has a reference to a map of exported namespace members from sibling scopes.
        ///
        /// In addition, there is a map from each relevant symbol reference to the data
        /// associated with that namespace or namespace member: "ref_to_ts_namespace_member".
        /// This gives enough info to be able to resolve queries into the namespace.
        ref_to_ts_namespace_member: std.AutoHashMapUnmanaged(Ref, js_ast.TSNamespaceMember.Data) = .{},
        /// When visiting expressions, namespace metadata is associated with the most
        /// recently visited node. If namespace metadata is present, "tsNamespaceTarget"
        /// will be set to the most recently visited node (as a way to mark that this
        /// node has metadata) and "tsNamespaceMemberData" will be set to the metadata.
        ts_namespace: RecentlyVisitedTSNamespace = .{},
        top_level_enums: std.ArrayListUnmanaged(Ref) = .{},

        scopes_in_order_for_enum: std.AutoArrayHashMapUnmanaged(logger.Loc, []ScopeOrder) = .{},

        // If this is true, then all top-level statements are wrapped in a try/catch
        will_wrap_module_in_try_catch_for_using: bool = false,

        /// Used for react refresh, it must be able to insert `const _s = $RefreshSig$();`
        nearest_stmt_list: ?*ListManaged(Stmt) = null,

        const RecentlyVisitedTSNamespace = struct {
            expr: Expr.Data = Expr.empty.data,
            map: ?*js_ast.TSNamespaceMemberMap = null,

            const ExpressionData = union(enum) {
                ref: Ref,
                ptr: *E.Dot,
            };
        };

        /// use this instead of checking p.source.index
        /// because when not bundling, p.source.index is `0`
        pub inline fn isSourceRuntime(p: *const P) bool {
            return p.options.bundle and p.source.index.isRuntime();
        }

        pub fn transposeImport(noalias p: *P, arg: Expr, state: *const TransposeState) Expr {
            // The argument must be a string
            if (arg.data.as(.e_string)) |str| {
                // Ignore calls to import() if the control flow is provably dead here.
                // We don't want to spend time scanning the required files if they will
                // never be used.
                if (p.is_control_flow_dead) {
                    return p.newExpr(E.Null{}, arg.loc);
                }

                const import_record_index = p.addImportRecord(.dynamic, arg.loc, str.slice(p.allocator));

                if (state.import_record_tag) |tag| {
                    p.import_records.items[import_record_index].tag = tag;
                }

                p.import_records.items[import_record_index].handles_import_errors = (state.is_await_target and p.fn_or_arrow_data_visit.try_body_count != 0) or state.is_then_catch_target;
                p.import_records_for_current_part.append(p.allocator, import_record_index) catch unreachable;

                return p.newExpr(E.Import{
                    .expr = arg,
                    .import_record_index = @intCast(import_record_index),
                    .options = state.import_options,
                }, state.loc);
            }

            if (p.options.warn_about_unbundled_modules) {
                // Use a debug log so people can see this if they want to
                const r = js_lexer.rangeOfIdentifier(p.source, state.loc);
                p.log.addRangeDebug(p.source, r, "This \"import\" expression cannot be bundled because the argument is not a string literal") catch unreachable;
            }

            return p.newExpr(E.Import{
                .expr = arg,
                .options = state.import_options,
                .import_record_index = std.math.maxInt(u32),
            }, state.loc);
        }

        pub fn transposeRequireResolve(noalias p: *P, arg: Expr, require_resolve_ref: Expr) Expr {
            // The argument must be a string
            if (arg.data == .e_string) {
                return p.transposeRequireResolveKnownString(arg);
            }

            if (p.options.warn_about_unbundled_modules) {
                // Use a debug log so people can see this if they want to
                const r = js_lexer.rangeOfIdentifier(p.source, arg.loc);
                p.log.addRangeDebug(p.source, r, "This \"require.resolve\" expression cannot be bundled because the argument is not a string literal") catch unreachable;
            }

            const args = p.allocator.alloc(Expr, 1) catch unreachable;
            args[0] = arg;

            return p.newExpr(E.Call{
                .target = require_resolve_ref,
                .args = ExprNodeList.init(args),
            }, arg.loc);
        }

        pub inline fn transposeRequireResolveKnownString(noalias p: *P, arg: Expr) Expr {
            bun.assert(arg.data == .e_string);

            // Ignore calls to import() if the control flow is provably dead here.
            // We don't want to spend time scanning the required files if they will
            // never be used.
            if (p.is_control_flow_dead) {
                return p.newExpr(E.Null{}, arg.loc);
            }

            const import_record_index = p.addImportRecord(.require_resolve, arg.loc, arg.data.e_string.string(p.allocator) catch unreachable);
            p.import_records.items[import_record_index].handles_import_errors = p.fn_or_arrow_data_visit.try_body_count != 0;
            p.import_records_for_current_part.append(p.allocator, import_record_index) catch unreachable;

            return p.newExpr(
                E.RequireResolveString{
                    .import_record_index = import_record_index,
                    // .leading_interior_comments = arg.getString().
                },
                arg.loc,
            );
        }

        pub fn transposeRequire(noalias p: *P, arg: Expr, state: *const TransposeState) Expr {
            if (!p.options.features.allow_runtime) {
                const args = p.allocator.alloc(Expr, 1) catch bun.outOfMemory();
                args[0] = arg;
                return p.newExpr(
                    E.Call{
                        .target = p.valueForRequire(arg.loc),
                        .args = ExprNodeList.init(args),
                    },
                    arg.loc,
                );
            }

            switch (arg.data) {
                .e_string => |str| {
                    // Ignore calls to require() if the control flow is provably dead here.
                    // We don't want to spend time scanning the required files if they will
                    // never be used.
                    if (p.is_control_flow_dead) {
                        return Expr{ .data = nullExprData, .loc = arg.loc };
                    }

                    str.resolveRopeIfNeeded(p.allocator);
                    const pathname = str.string(p.allocator) catch unreachable;
                    const path = fs.Path.init(pathname);

                    const handles_import_errors = p.fn_or_arrow_data_visit.try_body_count != 0;

                    // For unwrapping CommonJS into ESM to fully work
                    // we must also unwrap requires into imports.
                    const should_unwrap_require = p.options.features.unwrap_commonjs_to_esm and
                        (p.unwrap_all_requires or
                            if (path.packageName()) |pkg| p.options.features.shouldUnwrapRequire(pkg) else false) and
                        // We cannot unwrap a require wrapped in a try/catch because
                        // import statements cannot be wrapped in a try/catch and
                        // require cannot return a promise.
                        !handles_import_errors;

                    if (should_unwrap_require) {
                        const import_record_index = p.addImportRecordByRangeAndPath(.stmt, p.source.rangeOfString(arg.loc), path);
                        p.import_records.items[import_record_index].handles_import_errors = handles_import_errors;

                        // Note that this symbol may be completely removed later.
                        var path_name = fs.PathName.init(path.text);
                        const name = path_name.nonUniqueNameString(p.allocator) catch bun.outOfMemory();
                        const namespace_ref = p.newSymbol(.other, name) catch bun.outOfMemory();

                        p.imports_to_convert_from_require.append(p.allocator, .{
                            .namespace = .{
                                .ref = namespace_ref,
                                .loc = arg.loc,
                            },
                            .import_record_id = import_record_index,
                        }) catch bun.outOfMemory();
                        p.import_items_for_namespace.put(p.allocator, namespace_ref, ImportItemForNamespaceMap.init(p.allocator)) catch bun.outOfMemory();
                        p.recordUsage(namespace_ref);

                        if (!state.is_require_immediately_assigned_to_decl) {
                            return p.newExpr(E.Identifier{
                                .ref = namespace_ref,
                            }, arg.loc);
                        }

                        return p.newExpr(
                            E.RequireString{
                                .import_record_index = import_record_index,
                                .unwrapped_id = @as(u32, @intCast(p.imports_to_convert_from_require.items.len - 1)),
                            },
                            arg.loc,
                        );
                    }

                    const import_record_index = p.addImportRecordByRangeAndPath(.require, p.source.rangeOfString(arg.loc), path);
                    p.import_records.items[import_record_index].handles_import_errors = handles_import_errors;
                    p.import_records_for_current_part.append(p.allocator, import_record_index) catch unreachable;

                    return p.newExpr(E.RequireString{ .import_record_index = import_record_index }, arg.loc);
                },
                else => {
                    p.recordUsageOfRuntimeRequire();
                    const args = p.allocator.alloc(Expr, 1) catch unreachable;
                    args[0] = arg;
                    return p.newExpr(
                        E.Call{
                            .target = p.valueForRequire(arg.loc),
                            .args = ExprNodeList.init(args),
                        },
                        arg.loc,
                    );
                },
            }
        }

        pub inline fn shouldUnwrapCommonJSToESM(p: *const P) bool {
            return p.options.features.unwrap_commonjs_to_esm;
        }

        fn isBindingUsed(noalias p: *P, binding: Binding, default_export_ref: Ref) bool {
            switch (binding.data) {
                .b_identifier => |ident| {
                    if (default_export_ref.eql(ident.ref)) return true;
                    if (p.named_imports.contains(ident.ref))
                        return true;

                    for (p.named_exports.values()) |named_export| {
                        if (named_export.ref.eql(ident.ref))
                            return true;
                    }

                    const symbol: *const Symbol = &p.symbols.items[ident.ref.innerIndex()];
                    return symbol.use_count_estimate > 0;
                },
                .b_array => |array| {
                    for (array.items) |item| {
                        if (isBindingUsed(p, item.binding, default_export_ref)) {
                            return true;
                        }
                    }

                    return false;
                },
                .b_object => |obj| {
                    for (obj.properties) |prop| {
                        if (isBindingUsed(p, prop.value, default_export_ref)) {
                            return true;
                        }
                    }

                    return false;
                },
                .b_missing => return false,
            }
        }

        pub fn treeShake(noalias p: *P, parts: *[]js_ast.Part, merge: bool) void {
            var parts_: []js_ast.Part = parts.*;
            defer {
                if (merge and parts_.len > 1) {
                    var first_none_part: usize = parts_.len;
                    var stmts_count: usize = 0;
                    for (parts_, 0..) |part, i| {
                        if (part.tag == .none) {
                            stmts_count += part.stmts.len;
                            first_none_part = @min(i, first_none_part);
                        }
                    }

                    if (first_none_part < parts_.len) {
                        const stmts_list = p.allocator.alloc(Stmt, stmts_count) catch unreachable;
                        var stmts_remain = stmts_list;

                        for (parts_) |part| {
                            if (part.tag == .none) {
                                bun.copy(Stmt, stmts_remain, part.stmts);
                                stmts_remain = stmts_remain[part.stmts.len..];
                            }
                        }

                        parts_[first_none_part].stmts = stmts_list;

                        parts_ = parts_[0 .. first_none_part + 1];
                    }
                }

                parts.* = parts_;
            }
            const default_export_ref =
                if (p.named_exports.get("default")) |default_| default_.ref else Ref.None;

            while (parts_.len > 1) {
                var parts_end: usize = 0;
                const last_end = parts_.len;

                for (parts_) |part| {
                    const is_dead = part.can_be_removed_if_unused and can_remove_part: {
                        for (part.stmts) |stmt| {
                            switch (stmt.data) {
                                .s_local => |local| {
                                    if (local.is_export) break :can_remove_part false;
                                    for (local.decls.slice()) |decl| {
                                        if (isBindingUsed(p, decl.binding, default_export_ref))
                                            break :can_remove_part false;
                                    }
                                },
                                .s_if => |if_statement| {
                                    const result = SideEffects.toBoolean(p, if_statement.test_.data);
                                    if (!(result.ok and result.side_effects == .no_side_effects and !result.value)) {
                                        break :can_remove_part false;
                                    }
                                },
                                .s_while => |while_statement| {
                                    const result = SideEffects.toBoolean(p, while_statement.test_.data);
                                    if (!(result.ok and result.side_effects == .no_side_effects and !result.value)) {
                                        break :can_remove_part false;
                                    }
                                },
                                .s_for => |for_statement| {
                                    if (for_statement.test_) |expr| {
                                        const result = SideEffects.toBoolean(p, expr.data);
                                        if (!(result.ok and result.side_effects == .no_side_effects and !result.value)) {
                                            break :can_remove_part false;
                                        }
                                    }
                                },
                                .s_function => |func| {
                                    if (func.func.flags.contains(.is_export)) break :can_remove_part false;
                                    if (func.func.name) |name| {
                                        const symbol: *const Symbol = &p.symbols.items[name.ref.?.innerIndex()];

                                        if (name.ref.?.eql(default_export_ref) or
                                            symbol.use_count_estimate > 0 or
                                            p.named_exports.contains(symbol.original_name) or
                                            p.named_imports.contains(name.ref.?) or
                                            p.is_import_item.get(name.ref.?) != null)
                                        {
                                            break :can_remove_part false;
                                        }
                                    }
                                },
                                .s_import,
                                .s_export_clause,
                                .s_export_from,
                                .s_export_default,
                                => break :can_remove_part false,

                                .s_class => |class| {
                                    if (class.is_export) break :can_remove_part false;
                                    if (class.class.class_name) |name| {
                                        const symbol: *const Symbol = &p.symbols.items[name.ref.?.innerIndex()];

                                        if (name.ref.?.eql(default_export_ref) or
                                            symbol.use_count_estimate > 0 or
                                            p.named_exports.contains(symbol.original_name) or
                                            p.named_imports.contains(name.ref.?) or
                                            p.is_import_item.get(name.ref.?) != null)
                                        {
                                            break :can_remove_part false;
                                        }
                                    }
                                },

                                else => break :can_remove_part false,
                            }
                        }
                        break :can_remove_part true;
                    };

                    if (is_dead) {
                        p.clearSymbolUsagesFromDeadPart(&part);

                        continue;
                    }

                    parts_[parts_end] = part;
                    parts_end += 1;
                }

                parts_.len = parts_end;
                if (last_end == parts_.len) {
                    break;
                }
            }
        }

        const ImportTransposer = ExpressionTransposer(P, *const TransposeState, P.transposeImport);
        const RequireTransposer = ExpressionTransposer(P, *const TransposeState, P.transposeRequire);
        const RequireResolveTransposer = ExpressionTransposer(P, Expr, P.transposeRequireResolve);

        const Binding2ExprWrapper = struct {
            pub const Namespace = Binding.ToExpr(P, P.wrapIdentifierNamespace);
            pub const Hoisted = Binding.ToExpr(P, P.wrapIdentifierHoisting);
        };

        fn clearSymbolUsagesFromDeadPart(noalias p: *P, part: *const js_ast.Part) void {
            const symbol_use_refs = part.symbol_uses.keys();
            const symbol_use_values = part.symbol_uses.values();
            var symbols = p.symbols.items;

            for (symbol_use_refs, symbol_use_values) |ref, prev| {
                symbols[ref.innerIndex()].use_count_estimate -|= prev.count_estimate;
            }
            const declared_refs = part.declared_symbols.refs();
            for (declared_refs) |declared| {
                symbols[declared.innerIndex()].use_count_estimate = 0;
            }
        }

        pub fn s(noalias _: *const P, t: anytype, loc: logger.Loc) Stmt {
            const Type = @TypeOf(t);
            if (!is_typescript_enabled and (Type == S.TypeScript or Type == *S.TypeScript)) {
                @compileError("Attempted to use TypeScript syntax in a non-TypeScript environment");
            }

            // Output.print("\nStmt: {s} - {d}\n", .{ @typeName(@TypeOf(t)), loc.start });
            if (@typeInfo(Type) == .pointer) {
                // ExportFrom normally becomes import records during the visiting pass
                // However, we skip the visiting pass in this mode
                // So we must generate a minimum version of it here.
                if (comptime only_scan_imports_and_do_not_visit) {
                    // if (@TypeOf(t) == *S.ExportFrom) {
                    //     switch (call.target.data) {
                    //         .e_identifier => |ident| {
                    //             // is this a require("something")
                    //             if (strings.eqlComptime(p.loadNameFromRef(ident.ref), "require") and call.args.len == 1 and std.meta.activeTag(call.args[0].data) == .e_string) {
                    //                 _ = p.addImportRecord(.require, loc, call.args[0].data.e_string.string(p.allocator) catch unreachable);
                    //             }
                    //         },
                    //         else => {},
                    //     }
                    // }
                }

                return Stmt.init(std.meta.Child(Type), t, loc);
            } else {
                return Stmt.alloc(Type, t, loc);
            }
        }

        fn computeCharacterFrequency(p: *P) ?js_ast.CharFreq {
            if (!p.options.features.minify_identifiers or p.isSourceRuntime()) {
                return null;
            }

            // Add everything in the file to the histogram
            var freq: js_ast.CharFreq = .{
                .freqs = [_]i32{0} ** 64,
            };

            freq.scan(p.source.contents, 1);

            // Subtract out all comments
            for (p.lexer.all_comments.items) |comment_range| {
                freq.scan(p.source.textForRange(comment_range), -1);
            }

            // Subtract out all import paths
            for (p.import_records.items) |record| {
                freq.scan(record.path.text, -1);
            }

            const ScopeVisitor = struct {
                pub fn visit(symbols: []const js_ast.Symbol, char_freq: *js_ast.CharFreq, scope: *js_ast.Scope) void {
                    var iter = scope.members.iterator();

                    while (iter.next()) |entry| {
                        const symbol: *const Symbol = &symbols[entry.value_ptr.ref.innerIndex()];

                        if (symbol.slotNamespace() != .must_not_be_renamed) {
                            char_freq.scan(symbol.original_name, -@as(i32, @intCast(symbol.use_count_estimate)));
                        }
                    }

                    if (scope.label_ref) |ref| {
                        const symbol = &symbols[ref.innerIndex()];

                        if (symbol.slotNamespace() != .must_not_be_renamed) {
                            char_freq.scan(symbol.original_name, -@as(i32, @intCast(symbol.use_count_estimate)) - 1);
                        }
                    }

                    for (scope.children.slice()) |child| {
                        visit(symbols, char_freq, child);
                    }
                }
            };
            ScopeVisitor.visit(p.symbols.items, &freq, p.module_scope);

            // TODO: mangledProps

            return freq;
        }

        pub fn newExpr(noalias p: *P, t: anytype, loc: logger.Loc) Expr {
            const Type = @TypeOf(t);

            comptime {
                if (jsx_transform_type == .none) {
                    if (Type == E.JSXElement or Type == *E.JSXElement) {
                        @compileError("JSXElement is not supported in this environment");
                    }
                }
            }

            // Output.print("\nExpr: {s} - {d}\n", .{ @typeName(@TypeOf(t)), loc.start });
            if (@typeInfo(Type) == .pointer) {
                if (comptime only_scan_imports_and_do_not_visit) {
                    if (Type == *E.Call) {
                        const call: *E.Call = t;
                        switch (call.target.data) {
                            .e_identifier => |ident| {
                                // is this a require("something")
                                if (strings.eqlComptime(p.loadNameFromRef(ident.ref), "require") and call.args.len == 1 and std.meta.activeTag(call.args.ptr[0].data) == .e_string) {
                                    _ = p.addImportRecord(.require, loc, call.args.first_().data.e_string.string(p.allocator) catch unreachable);
                                }
                            },
                            else => {},
                        }
                    }
                }
                return Expr.init(std.meta.Child(Type), t.*, loc);
            } else {
                if (comptime only_scan_imports_and_do_not_visit) {
                    if (Type == E.Call) {
                        const call: E.Call = t;
                        switch (call.target.data) {
                            .e_identifier => |ident| {
                                // is this a require("something")
                                if (strings.eqlComptime(p.loadNameFromRef(ident.ref), "require") and call.args.len == 1 and std.meta.activeTag(call.args.ptr[0].data) == .e_string) {
                                    _ = p.addImportRecord(.require, loc, call.args.first_().data.e_string.string(p.allocator) catch unreachable);
                                }
                            },
                            else => {},
                        }
                    }
                }
                return Expr.init(Type, t, loc);
            }
        }

        pub fn b(p: *P, t: anytype, loc: logger.Loc) Binding {
            if (@typeInfo(@TypeOf(t)) == .pointer) {
                return Binding.init(t, loc);
            } else {
                return Binding.alloc(p.allocator, t, loc);
            }
        }

        pub fn findSymbol(noalias p: *P, loc: logger.Loc, name: string) !FindSymbolResult {
            return findSymbolWithRecordUsage(p, loc, name, true);
        }

        pub fn findSymbolWithRecordUsage(noalias p: *P, loc: logger.Loc, name: string, comptime record_usage: bool) !FindSymbolResult {
            var declare_loc: logger.Loc = logger.Loc.Empty;
            var is_inside_with_scope = false;
            // This function can show up in profiling.
            // That's part of why we do this.
            // Instead of rehashing `name` for every scope, we do it just once.
            const hash = Scope.getMemberHash(name);
            const allocator = p.allocator;

            const ref: Ref = brk: {
                var current: ?*Scope = p.current_scope;

                var did_forbid_arguments = false;

                while (current) |scope| : (current = current.?.parent) {
                    // Track if we're inside a "with" statement body
                    if (scope.kind == .with) {
                        is_inside_with_scope = true;
                    }

                    // Forbid referencing "arguments" inside class bodies
                    if (scope.forbid_arguments and !did_forbid_arguments and strings.eqlComptime(name, "arguments")) {
                        const r = js_lexer.rangeOfIdentifier(p.source, loc);
                        p.log.addRangeErrorFmt(p.source, r, allocator, "Cannot access \"{s}\" here", .{name}) catch unreachable;
                        did_forbid_arguments = true;
                    }

                    // Is the symbol a member of this scope?
                    if (scope.getMemberWithHash(name, hash)) |member| {
                        declare_loc = member.loc;
                        break :brk member.ref;
                    }

                    // Is the symbol a member of this scope's TypeScript namespace?
                    if (scope.ts_namespace) |ts_namespace| {
                        if (ts_namespace.exported_members.get(name)) |member| {
                            if (member.data.isEnum() == ts_namespace.is_enum_scope) {
                                declare_loc = member.loc;
                                // If this is an identifier from a sibling TypeScript namespace, then we're
                                // going to have to generate a property access instead of a simple reference.
                                // Lazily-generate an identifier that represents this property access.
                                const gop = try ts_namespace.property_accesses.getOrPut(p.allocator, name);
                                if (!gop.found_existing) {
                                    const ref = try p.newSymbol(.other, name);
                                    gop.value_ptr.* = ref;
                                    p.symbols.items[ref.inner_index].namespace_alias = .{
                                        .namespace_ref = ts_namespace.arg_ref,
                                        .alias = name,
                                    };
                                    break :brk ref;
                                }
                                break :brk gop.value_ptr.*;
                            }
                        }
                    }
                }

                // Allocate an "unbound" symbol
                p.checkForNonBMPCodePoint(loc, name);
                if (comptime !record_usage) {
                    return FindSymbolResult{
                        .ref = Ref.None,
                        .declare_loc = loc,
                        .is_inside_with_scope = is_inside_with_scope,
                    };
                }

                const gpe = p.module_scope.getOrPutMemberWithHash(allocator, name, hash) catch unreachable;

                // I don't think this happens?
                if (gpe.found_existing) {
                    const existing = gpe.value_ptr.*;
                    declare_loc = existing.loc;
                    break :brk existing.ref;
                }

                const _ref = p.newSymbol(.unbound, name) catch unreachable;

                gpe.key_ptr.* = name;
                gpe.value_ptr.* = js_ast.Scope.Member{ .ref = _ref, .loc = loc };

                declare_loc = loc;

                break :brk _ref;
            };

            // If we had to pass through a "with" statement body to get to the symbol
            // declaration, then this reference could potentially also refer to a
            // property on the target object of the "with" statement. We must not rename
            // it or we risk changing the behavior of the code.
            if (is_inside_with_scope) {
                p.symbols.items[ref.innerIndex()].must_not_be_renamed = true;
            }

            // Track how many times we've referenced this symbol
            if (comptime record_usage) p.recordUsage(ref);

            return FindSymbolResult{
                .ref = ref,
                .declare_loc = declare_loc,
                .is_inside_with_scope = is_inside_with_scope,
            };
        }

        pub fn recordExportedBinding(noalias p: *P, binding: Binding) void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |ident| {
                    p.recordExport(binding.loc, p.symbols.items[ident.ref.innerIndex()].original_name, ident.ref) catch unreachable;
                },
                .b_array => |array| {
                    for (array.items) |prop| {
                        p.recordExportedBinding(prop.binding);
                    }
                },
                .b_object => |obj| {
                    for (obj.properties) |prop| {
                        p.recordExportedBinding(prop.value);
                    }
                },
            }
        }

        pub fn recordExport(noalias p: *P, loc: logger.Loc, alias: string, ref: Ref) !void {
            if (p.named_exports.get(alias)) |name| {
                // Duplicate exports are an error
                var notes = try p.allocator.alloc(logger.Data, 1);
                notes[0] = logger.Data{
                    .text = try std.fmt.allocPrint(p.allocator, "\"{s}\" was originally exported here", .{alias}),
                    .location = logger.Location.initOrNull(p.source, js_lexer.rangeOfIdentifier(p.source, name.alias_loc)),
                };
                try p.log.addRangeErrorFmtWithNotes(
                    p.source,
                    js_lexer.rangeOfIdentifier(p.source, loc),
                    p.allocator,
                    notes,
                    "Multiple exports with the same name \"{s}\"",
                    .{std.mem.trim(u8, alias, "\"'")},
                );
            } else if (!p.isDeoptimizedCommonJS()) {
                try p.named_exports.put(p.allocator, alias, js_ast.NamedExport{ .alias_loc = loc, .ref = ref });
            }
        }

        pub fn isDeoptimizedCommonJS(noalias p: *P) bool {
            return p.commonjs_named_exports_deoptimized and p.commonjs_named_exports.count() > 0;
        }

        pub fn recordUsage(noalias p: *P, ref: Ref) void {
            if (p.is_revisit_for_substitution) return;
            // The use count stored in the symbol is used for generating symbol names
            // during minification. These counts shouldn't include references inside dead
            // code regions since those will be culled.
            if (!p.is_control_flow_dead) {
                if (comptime Environment.allow_assert) assert(p.symbols.items.len > ref.innerIndex());
                p.symbols.items[ref.innerIndex()].use_count_estimate += 1;
                var result = p.symbol_uses.getOrPut(p.allocator, ref) catch unreachable;
                if (!result.found_existing) {
                    result.value_ptr.* = Symbol.Use{ .count_estimate = 1 };
                } else {
                    result.value_ptr.count_estimate += 1;
                }
            }

            // The correctness of TypeScript-to-JavaScript conversion relies on accurate
            // symbol use counts for the whole file, including dead code regions. This is
            // tracked separately in a parser-only data structure.
            if (is_typescript_enabled) {
                p.ts_use_counts.items[ref.innerIndex()] += 1;
            }
        }

        pub fn logArrowArgErrors(noalias p: *P, errors: *DeferredArrowArgErrors) void {
            if (errors.invalid_expr_await.len > 0) {
                const r = errors.invalid_expr_await;
                p.log.addRangeError(p.source, r, "Cannot use an \"await\" expression here") catch unreachable;
            }

            if (errors.invalid_expr_yield.len > 0) {
                const r = errors.invalid_expr_yield;
                p.log.addRangeError(p.source, r, "Cannot use a \"yield\" expression here") catch unreachable;
            }
        }

        pub fn keyNameForError(noalias p: *P, key: js_ast.Expr) string {
            switch (key.data) {
                .e_string => {
                    return key.data.e_string.string(p.allocator) catch unreachable;
                },
                .e_private_identifier => |private| {
                    return p.loadNameFromRef(private.ref);
                },
                else => {
                    return "property";
                },
            }
        }

        /// This function is very very hot.
        pub fn handleIdentifier(noalias p: *P, loc: logger.Loc, ident: E.Identifier, original_name: ?string, opts: IdentifierOpts) Expr {
            const ref = ident.ref;

            if (p.options.features.inlining) {
                if (p.const_values.get(ref)) |replacement| {
                    p.ignoreUsage(ref);
                    return replacement;
                }
            }

            // Create an error for assigning to an import namespace
            if ((opts.assign_target != .none or opts.is_delete_target) and p.symbols.items[ref.innerIndex()].kind == .import) {
                const r = js_lexer.rangeOfIdentifier(p.source, loc);
                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot assign to import \"{s}\"", .{
                    p.symbols.items[ref.innerIndex()].original_name,
                }) catch unreachable;
            }

            // Substitute an EImportIdentifier now if this has a namespace alias
            if (opts.assign_target == .none and !opts.is_delete_target) {
                const symbol = &p.symbols.items[ref.inner_index];
                if (symbol.namespace_alias) |ns_alias| {
                    if (p.ref_to_ts_namespace_member.get(ns_alias.namespace_ref)) |ts_member_data| {
                        if (ts_member_data == .namespace) {
                            if (ts_member_data.namespace.get(ns_alias.alias)) |member| {
                                switch (member.data) {
                                    .enum_number => |num| return p.wrapInlinedEnum(
                                        .{ .loc = loc, .data = .{ .e_number = .{ .value = num } } },
                                        p.symbols.items[ref.inner_index].original_name,
                                    ),

                                    .enum_string => |str| return p.wrapInlinedEnum(
                                        .{ .loc = loc, .data = .{ .e_string = str } },
                                        p.symbols.items[ref.inner_index].original_name,
                                    ),

                                    .namespace => |map| {
                                        const expr = p.newExpr(E.Dot{
                                            .target = p.newExpr(E.Identifier.init(ns_alias.namespace_ref), loc),
                                            .name = ns_alias.alias,
                                            .name_loc = loc,
                                        }, loc);
                                        p.ts_namespace = .{
                                            .expr = expr.data,
                                            .map = map,
                                        };
                                        return expr;
                                    },

                                    else => {},
                                }
                            }
                        }
                    }

                    return p.newExpr(E.ImportIdentifier{
                        .ref = ident.ref,
                        .was_originally_identifier = true,
                    }, loc);
                }
            }

            // Substitute an EImportIdentifier now if this is an import item
            if (p.is_import_item.contains(ref)) {
                return p.newExpr(
                    E.ImportIdentifier{ .ref = ref, .was_originally_identifier = opts.was_originally_identifier },
                    loc,
                );
            }

            if (is_typescript_enabled) {
                if (p.ref_to_ts_namespace_member.get(ref)) |member_data| {
                    switch (member_data) {
                        .enum_number => |num| return p.wrapInlinedEnum(
                            .{ .loc = loc, .data = .{ .e_number = .{ .value = num } } },
                            p.symbols.items[ref.inner_index].original_name,
                        ),

                        .enum_string => |str| return p.wrapInlinedEnum(
                            .{ .loc = loc, .data = .{ .e_string = str } },
                            p.symbols.items[ref.inner_index].original_name,
                        ),

                        .namespace => |map| {
                            const expr: Expr = .{
                                .data = .{ .e_identifier = ident },
                                .loc = loc,
                            };

                            p.ts_namespace = .{
                                .expr = expr.data,
                                .map = map,
                            };

                            return expr;
                        },

                        else => {},
                    }
                }

                // Substitute a namespace export reference now if appropriate
                if (p.is_exported_inside_namespace.get(ref)) |ns_ref| {
                    const name = p.symbols.items[ref.innerIndex()].original_name;

                    p.recordUsage(ns_ref);
                    const prop = p.newExpr(E.Dot{
                        .target = p.newExpr(E.Identifier.init(ns_ref), loc),
                        .name = name,
                        .name_loc = loc,
                    }, loc);

                    if (p.ts_namespace.expr == .e_identifier and
                        p.ts_namespace.expr.e_identifier.ref.eql(ident.ref))
                    {
                        p.ts_namespace.expr = prop.data;
                    }

                    return prop;
                }
            }

            if (original_name) |name| {
                const result = p.findSymbol(loc, name) catch unreachable;
                var id_clone = ident;
                id_clone.ref = result.ref;
                return p.newExpr(id_clone, loc);
            }

            return .{
                .data = .{ .e_identifier = ident },
                .loc = loc,
            };
        }

        pub fn generateImportStmt(
            noalias p: *P,
            import_path: string,
            imports: anytype,
            parts: *ListManaged(js_ast.Part),
            symbols: anytype,
            additional_stmt: ?Stmt,
            comptime suffix: string,
            comptime is_internal: bool,
        ) anyerror!void {
            const allocator = p.allocator;
            const import_record_i = p.addImportRecordByRange(.stmt, logger.Range.None, import_path);
            var import_record: *ImportRecord = &p.import_records.items[import_record_i];
            if (comptime is_internal)
                import_record.path.namespace = "runtime";
            import_record.is_internal = is_internal;
            const import_path_identifier = try import_record.path.name.nonUniqueNameString(allocator);
            var namespace_identifier = try allocator.alloc(u8, import_path_identifier.len + suffix.len);
            const clause_items = try allocator.alloc(js_ast.ClauseItem, imports.len);
            var stmts = try allocator.alloc(Stmt, 1 + if (additional_stmt != null) @as(usize, 1) else @as(usize, 0));
            var declared_symbols = DeclaredSymbol.List{};
            try declared_symbols.ensureTotalCapacity(allocator, imports.len + 1);
            bun.copy(u8, namespace_identifier, suffix);
            bun.copy(u8, namespace_identifier[suffix.len..], import_path_identifier);

            const namespace_ref = try p.newSymbol(.other, namespace_identifier);
            declared_symbols.appendAssumeCapacity(.{
                .ref = namespace_ref,
                .is_top_level = true,
            });
            try p.module_scope.generated.push(allocator, namespace_ref);
            for (imports, clause_items) |alias, *clause_item| {
                const ref = symbols.get(alias) orelse unreachable;
                const alias_name = if (@TypeOf(symbols) == RuntimeImports) RuntimeImports.all[alias] else alias;
                clause_item.* = js_ast.ClauseItem{
                    .alias = alias_name,
                    .original_name = alias_name,
                    .alias_loc = logger.Loc{},
                    .name = LocRef{ .ref = ref, .loc = logger.Loc{} },
                };
                declared_symbols.appendAssumeCapacity(.{ .ref = ref, .is_top_level = true });

                // ensure every e_import_identifier holds the namespace
                if (p.options.features.hot_module_reloading) {
                    const symbol = &p.symbols.items[ref.inner_index];
                    if (symbol.namespace_alias == null) {
                        symbol.namespace_alias = .{
                            .namespace_ref = namespace_ref,
                            .alias = alias_name,
                            .import_record_index = import_record_i,
                        };
                    }
                }

                try p.is_import_item.put(allocator, ref, {});
                try p.named_imports.put(allocator, ref, js_ast.NamedImport{
                    .alias = alias_name,
                    .alias_loc = logger.Loc{},
                    .namespace_ref = namespace_ref,
                    .import_record_index = import_record_i,
                });
            }

            stmts[0] = p.s(
                S.Import{
                    .namespace_ref = namespace_ref,
                    .items = clause_items,
                    .import_record_index = import_record_i,
                    .is_single_line = true,
                },
                logger.Loc{},
            );
            if (additional_stmt) |add| {
                stmts[1] = add;
            }

            var import_records = try allocator.alloc(@TypeOf(import_record_i), 1);
            import_records[0] = import_record_i;

            // This import is placed in a part before the main code, however
            // the bundler ends up re-ordering this to be after... The order
            // does not matter as ESM imports are always hoisted.
            parts.append(js_ast.Part{
                .stmts = stmts,
                .declared_symbols = declared_symbols,
                .import_record_indices = bun.BabyList(u32).init(import_records),
                .tag = .runtime,
            }) catch unreachable;
        }

        pub fn generateReactRefreshImport(
            noalias p: *P,
            parts: *ListManaged(js_ast.Part),
            import_path: []const u8,
            clauses: []const ReactRefreshImportClause,
        ) !void {
            switch (p.options.features.hot_module_reloading) {
                inline else => |hmr| try p.generateReactRefreshImportHmr(parts, import_path, clauses, hmr),
            }
        }

        const ReactRefreshImportClause = struct {
            name: []const u8,
            enabled: bool,
            ref: Ref,
        };

        fn generateReactRefreshImportHmr(
            noalias p: *P,
            parts: *ListManaged(js_ast.Part),
            import_path: []const u8,
            clauses: []const ReactRefreshImportClause,
            comptime hot_module_reloading: bool,
        ) !void {
            // If `hot_module_reloading`, we are going to generate a require call:
            //
            //     const { $RefreshSig$, $RefreshReg$ } = require("react-refresh/runtime")`
            //
            // Otherwise we are going to settle on an import statement. Using
            // require is fine in HMR bundling because `react-refresh` itself is
            // already a CommonJS module, and it will actually be more efficient
            // at runtime this way.
            const allocator = p.allocator;
            const import_record_index = p.addImportRecordByRange(.stmt, logger.Range.None, import_path);

            const Item = if (hot_module_reloading) B.Object.Property else js_ast.ClauseItem;

            const len = 1 + @as(usize, @intFromBool(p.react_refresh.register_used)) +
                @as(usize, @intFromBool(p.react_refresh.signature_used));
            var items = try List(Item).initCapacity(allocator, len);

            const stmts = try allocator.alloc(Stmt, 1);
            var declared_symbols = DeclaredSymbol.List{};
            try declared_symbols.ensureTotalCapacity(allocator, len);

            const namespace_ref = try p.newSymbol(.other, "RefreshRuntime");
            declared_symbols.appendAssumeCapacity(.{
                .ref = namespace_ref,
                .is_top_level = true,
            });
            try p.module_scope.generated.push(allocator, namespace_ref);

            for (clauses) |entry| {
                if (entry.enabled) {
                    items.appendAssumeCapacity(if (hot_module_reloading) .{
                        .key = p.newExpr(E.String{ .data = entry.name }, logger.Loc.Empty),
                        .value = p.b(B.Identifier{ .ref = entry.ref }, logger.Loc.Empty),
                    } else .{
                        .alias = entry.name,
                        .original_name = entry.name,
                        .alias_loc = logger.Loc{},
                        .name = LocRef{ .ref = entry.ref, .loc = logger.Loc{} },
                    });
                    declared_symbols.appendAssumeCapacity(.{ .ref = entry.ref, .is_top_level = true });
                    try p.module_scope.generated.push(allocator, entry.ref);
                    try p.is_import_item.put(allocator, entry.ref, {});
                    try p.named_imports.put(allocator, entry.ref, .{
                        .alias = entry.name,
                        .alias_loc = logger.Loc.Empty,
                        .namespace_ref = namespace_ref,
                        .import_record_index = import_record_index,
                    });
                }
            }

            stmts[0] = p.s(if (hot_module_reloading)
                S.Local{
                    .kind = .k_const,
                    .decls = try Decl.List.fromSlice(p.allocator, &.{.{
                        .binding = p.b(B.Object{
                            .properties = items.items,
                        }, logger.Loc.Empty),
                        .value = p.newExpr(E.RequireString{
                            .import_record_index = import_record_index,
                        }, logger.Loc.Empty),
                    }}),
                }
            else
                S.Import{
                    .namespace_ref = namespace_ref,
                    .items = items.items,
                    .import_record_index = import_record_index,
                    .is_single_line = false,
                }, logger.Loc.Empty);

            try parts.append(.{
                .stmts = stmts,
                .declared_symbols = declared_symbols,
                .import_record_indices = try bun.BabyList(u32).fromSlice(allocator, &.{import_record_index}),
                .tag = .runtime,
            });
        }

        pub fn substituteSingleUseSymbolInStmt(noalias p: *P, stmt: Stmt, ref: Ref, replacement: Expr) bool {
            const expr: *Expr = brk: {
                switch (stmt.data) {
                    .s_expr => |exp| {
                        break :brk &exp.value;
                    },
                    .s_throw => |throw| {
                        break :brk &throw.value;
                    },
                    .s_return => |ret| {
                        if (ret.value) |*value| {
                            break :brk value;
                        }
                    },
                    .s_if => |if_stmt| {
                        break :brk &if_stmt.test_;
                    },
                    .s_switch => |switch_stmt| {
                        break :brk &switch_stmt.test_;
                    },
                    .s_local => |local| {
                        if (local.decls.len > 0) {
                            var first: *Decl = &local.decls.ptr[0];
                            if (first.value) |*value| {
                                if (first.binding.data == .b_identifier) {
                                    break :brk value;
                                }
                            }
                        }
                    },
                    else => {},
                }

                return false;
            };

            // Only continue trying to insert this replacement into sub-expressions
            // after the first one if the replacement has no side effects:
            //
            //   // Substitution is ok
            //   let replacement = 123;
            //   return x + replacement;
            //
            //   // Substitution is not ok because "fn()" may change "x"
            //   let replacement = fn();
            //   return x + replacement;
            //
            //   // Substitution is not ok because "x == x" may change "x" due to "valueOf()" evaluation
            //   let replacement = [x];
            //   return (x == x) + replacement;
            //
            const replacement_can_be_removed = p.exprCanBeRemovedIfUnused(&replacement);
            switch (p.substituteSingleUseSymbolInExpr(expr.*, ref, replacement, replacement_can_be_removed)) {
                .success => |result| {
                    if (result.data == .e_binary or result.data == .e_unary or result.data == .e_if) {
                        const prev_substituting = p.is_revisit_for_substitution;
                        p.is_revisit_for_substitution = true;
                        defer p.is_revisit_for_substitution = prev_substituting;
                        // O(n^2) and we will need to think more carefully about
                        // this once we implement syntax compression
                        expr.* = p.visitExpr(result);
                    } else {
                        expr.* = result;
                    }

                    return true;
                },
                else => {},
            }

            return false;
        }

        fn substituteSingleUseSymbolInExpr(
            noalias p: *P,
            expr: Expr,
            ref: Ref,
            replacement: Expr,
            replacement_can_be_removed: bool,
        ) Substitution {
            outer: {
                switch (expr.data) {
                    .e_identifier => |ident| {
                        if (ident.ref.eql(ref) or p.symbols.items[ident.ref.innerIndex()].link.eql(ref)) {
                            p.ignoreUsage(ref);
                            return .{ .success = replacement };
                        }
                    },
                    .e_new => |new| {
                        switch (p.substituteSingleUseSymbolInExpr(new.target, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                new.target = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                new.target = result;
                                return .{ .failure = expr };
                            },
                        }

                        if (replacement_can_be_removed) {
                            for (new.args.slice()) |*arg| {
                                switch (p.substituteSingleUseSymbolInExpr(arg.*, ref, replacement, replacement_can_be_removed)) {
                                    .continue_ => {},
                                    .success => |result| {
                                        arg.* = result;
                                        return .{ .success = expr };
                                    },
                                    .failure => |result| {
                                        arg.* = result;
                                        return .{ .failure = expr };
                                    },
                                }
                            }
                        }
                    },
                    .e_spread => |spread| {
                        switch (p.substituteSingleUseSymbolInExpr(spread.value, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                spread.value = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                spread.value = result;
                                return .{ .failure = expr };
                            },
                        }
                    },
                    .e_await => |await_expr| {
                        switch (p.substituteSingleUseSymbolInExpr(await_expr.value, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                await_expr.value = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                await_expr.value = result;
                                return .{ .failure = expr };
                            },
                        }
                    },
                    .e_yield => |yield| {
                        switch (p.substituteSingleUseSymbolInExpr(yield.value orelse Expr{ .data = .{ .e_missing = .{} }, .loc = expr.loc }, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                yield.value = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                yield.value = result;
                                return .{ .failure = expr };
                            },
                        }
                    },
                    .e_import => |import| {
                        switch (p.substituteSingleUseSymbolInExpr(import.expr, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                import.expr = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                import.expr = result;
                                return .{ .failure = expr };
                            },
                        }

                        // The "import()" expression has side effects but the side effects are
                        // always asynchronous so there is no way for the side effects to modify
                        // the replacement value. So it's ok to reorder the replacement value
                        // past the "import()" expression assuming everything else checks out.

                        if (replacement_can_be_removed and p.exprCanBeRemovedIfUnused(&import.expr)) {
                            return .{ .continue_ = expr };
                        }
                    },
                    .e_unary => |e| {
                        switch (e.op) {
                            .un_pre_inc, .un_post_inc, .un_pre_dec, .un_post_dec, .un_delete => {
                                // Do not substitute into an assignment position
                            },
                            else => {
                                switch (p.substituteSingleUseSymbolInExpr(e.value, ref, replacement, replacement_can_be_removed)) {
                                    .continue_ => {},
                                    .success => |result| {
                                        e.value = result;
                                        return .{ .success = expr };
                                    },
                                    .failure => |result| {
                                        e.value = result;
                                        return .{ .failure = expr };
                                    },
                                }
                            },
                        }
                    },
                    .e_dot => |e| {
                        switch (p.substituteSingleUseSymbolInExpr(e.target, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                e.target = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                e.target = result;
                                return .{ .failure = expr };
                            },
                        }
                    },
                    .e_binary => |e| {
                        // Do not substitute into an assignment position
                        if (e.op.binaryAssignTarget() == .none) {
                            switch (p.substituteSingleUseSymbolInExpr(e.left, ref, replacement, replacement_can_be_removed)) {
                                .continue_ => {},
                                .success => |result| {
                                    e.left = result;

                                    return .{ .success = expr };
                                },
                                .failure => |result| {
                                    e.left = result;
                                    return .{ .failure = expr };
                                },
                            }
                        } else if (!p.exprCanBeRemovedIfUnused(&e.left)) {
                            // Do not reorder past a side effect in an assignment target, as that may
                            // change the replacement value. For example, "fn()" may change "a" here:
                            //
                            //   let a = 1;
                            //   foo[fn()] = a;
                            //
                            return .{ .failure = expr };
                        } else if (e.op.binaryAssignTarget() == .update and !replacement_can_be_removed) {
                            // If this is a read-modify-write assignment and the replacement has side
                            // effects, don't reorder it past the assignment target. The assignment
                            // target is being read so it may be changed by the side effect. For
                            // example, "fn()" may change "foo" here:
                            //
                            //   let a = fn();
                            //   foo += a;
                            //
                            return .{ .failure = expr };
                        }

                        // If we get here then it should be safe to attempt to substitute the
                        // replacement past the left operand into the right operand.
                        switch (p.substituteSingleUseSymbolInExpr(e.right, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                e.right = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                e.right = result;
                                return .{ .failure = expr };
                            },
                        }
                    },
                    .e_if => |e| {
                        switch (p.substituteSingleUseSymbolInExpr(expr.data.e_if.test_, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                e.test_ = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                e.test_ = result;
                                return .{ .failure = expr };
                            },
                        }

                        // Do not substitute our unconditionally-executed value into a branch
                        // unless the value itself has no side effects
                        if (replacement_can_be_removed) {
                            // Unlike other branches in this function such as "a && b" or "a?.[b]",
                            // the "a ? b : c" form has potential code evaluation along both control
                            // flow paths. Handle this by allowing substitution into either branch.
                            // Side effects in one branch should not prevent the substitution into
                            // the other branch.

                            const yes = p.substituteSingleUseSymbolInExpr(e.yes, ref, replacement, replacement_can_be_removed);
                            if (yes == .success) {
                                e.yes = yes.success;
                                return .{ .success = expr };
                            }

                            const no = p.substituteSingleUseSymbolInExpr(e.no, ref, replacement, replacement_can_be_removed);
                            if (no == .success) {
                                e.no = no.success;
                                return .{ .success = expr };
                            }

                            // Side effects in either branch should stop us from continuing to try to
                            // substitute the replacement after the control flow branches merge again.
                            if (yes != .continue_ or no != .continue_) {
                                return .{ .failure = expr };
                            }
                        }
                    },
                    .e_index => |index| {
                        switch (p.substituteSingleUseSymbolInExpr(index.target, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                index.target = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                index.target = result;
                                return .{ .failure = expr };
                            },
                        }

                        // Do not substitute our unconditionally-executed value into a branch
                        // unless the value itself has no side effects
                        if (replacement_can_be_removed or index.optional_chain == null) {
                            switch (p.substituteSingleUseSymbolInExpr(index.index, ref, replacement, replacement_can_be_removed)) {
                                .continue_ => {},
                                .success => |result| {
                                    index.index = result;
                                    return .{ .success = expr };
                                },
                                .failure => |result| {
                                    index.index = result;
                                    return .{ .failure = expr };
                                },
                            }
                        }
                    },

                    .e_call => |e| {
                        // Don't substitute something into a call target that could change "this"
                        switch (replacement.data) {
                            .e_dot, .e_index => {
                                if (e.target.data == .e_identifier and e.target.data.e_identifier.ref.eql(ref)) {
                                    break :outer;
                                }
                            },
                            else => {},
                        }

                        switch (p.substituteSingleUseSymbolInExpr(e.target, ref, replacement, replacement_can_be_removed)) {
                            .continue_ => {},
                            .success => |result| {
                                e.target = result;
                                return .{ .success = expr };
                            },
                            .failure => |result| {
                                e.target = result;
                                return .{ .failure = expr };
                            },
                        }

                        // Do not substitute our unconditionally-executed value into a branch
                        // unless the value itself has no side effects
                        if (replacement_can_be_removed or e.optional_chain == null) {
                            for (e.args.slice()) |*arg| {
                                switch (p.substituteSingleUseSymbolInExpr(arg.*, ref, replacement, replacement_can_be_removed)) {
                                    .continue_ => {},
                                    .success => |result| {
                                        arg.* = result;
                                        return .{ .success = expr };
                                    },
                                    .failure => |result| {
                                        arg.* = result;
                                        return .{ .failure = expr };
                                    },
                                }
                            }
                        }
                    },

                    .e_array => |e| {
                        for (e.items.slice()) |*item| {
                            switch (p.substituteSingleUseSymbolInExpr(item.*, ref, replacement, replacement_can_be_removed)) {
                                .continue_ => {},
                                .success => |result| {
                                    item.* = result;
                                    return .{ .success = expr };
                                },
                                .failure => |result| {
                                    item.* = result;
                                    return .{ .failure = expr };
                                },
                            }
                        }
                    },

                    .e_object => |e| {
                        for (e.properties.slice()) |*property| {
                            // Check the key

                            if (property.flags.contains(.is_computed)) {
                                switch (p.substituteSingleUseSymbolInExpr(property.key.?, ref, replacement, replacement_can_be_removed)) {
                                    .continue_ => {},
                                    .success => |result| {
                                        property.key = result;
                                        return .{ .success = expr };
                                    },
                                    .failure => |result| {
                                        property.key = result;
                                        return .{ .failure = expr };
                                    },
                                }

                                // Stop now because both computed keys and property spread have side effects
                                return .{ .failure = expr };
                            }

                            // Check the value
                            if (property.value) |value| {
                                switch (p.substituteSingleUseSymbolInExpr(value, ref, replacement, replacement_can_be_removed)) {
                                    .continue_ => {},
                                    .success => |result| {
                                        if (result.data == .e_missing) {
                                            property.value = null;
                                        } else {
                                            property.value = result;
                                        }
                                        return .{ .success = expr };
                                    },
                                    .failure => |result| {
                                        if (result.data == .e_missing) {
                                            property.value = null;
                                        } else {
                                            property.value = result;
                                        }
                                        return .{ .failure = expr };
                                    },
                                }
                            }
                        }
                    },

                    .e_template => |e| {
                        if (e.tag) |*tag| {
                            switch (p.substituteSingleUseSymbolInExpr(tag.*, ref, replacement, replacement_can_be_removed)) {
                                .continue_ => {},
                                .success => |result| {
                                    tag.* = result;
                                    return .{ .success = expr };
                                },
                                .failure => |result| {
                                    tag.* = result;
                                    return .{ .failure = expr };
                                },
                            }
                        }

                        for (e.parts) |*part| {
                            switch (p.substituteSingleUseSymbolInExpr(part.value, ref, replacement, replacement_can_be_removed)) {
                                .continue_ => {},
                                .success => |result| {
                                    part.value = result;

                                    // todo: mangle template parts

                                    return .{ .success = expr };
                                },
                                .failure => |result| {
                                    part.value = result;
                                    return .{ .failure = expr };
                                },
                            }
                        }
                    },
                    else => {},
                }
            }

            // If both the replacement and this expression have no observable side
            // effects, then we can reorder the replacement past this expression
            if (replacement_can_be_removed and p.exprCanBeRemovedIfUnused(&expr)) {
                return .{ .continue_ = expr };
            }

            const tag: Expr.Tag = @as(Expr.Tag, expr.data);

            // We can always reorder past primitive values
            if (tag.isPrimitiveLiteral()) {
                return .{ .continue_ = expr };
            }

            // Otherwise we should stop trying to substitute past this point
            return .{ .failure = expr };
        }

        pub fn prepareForVisitPass(noalias p: *P) anyerror!void {
            {
                var i: usize = 0;
                p.scope_order_to_visit = try p.allocator.alloc(ScopeOrder, p.scopes_in_order.items.len);
                for (p.scopes_in_order.items) |item| {
                    if (item) |_item| {
                        p.scope_order_to_visit[i] = _item;
                        i += 1;
                    }
                }
                p.scope_order_to_visit.len = i;
            }

            p.is_file_considered_to_have_esm_exports =
                !p.top_level_await_keyword.isEmpty() or !p.esm_export_keyword.isEmpty() or
                p.options.module_type == .esm;

            try p.pushScopeForVisitPass(js_ast.Scope.Kind.entry, locModuleScope);
            p.fn_or_arrow_data_visit.is_outside_fn_or_arrow = true;
            p.module_scope = p.current_scope;
            p.has_es_module_syntax = p.has_es_module_syntax or p.esm_import_keyword.len > 0 or p.esm_export_keyword.len > 0 or p.top_level_await_keyword.len > 0;

            if (p.lexer.jsx_pragma.jsx()) |factory| {
                p.options.jsx.factory = options.JSX.Pragma.memberListToComponentsIfDifferent(p.allocator, p.options.jsx.factory, factory.text) catch unreachable;
            }

            if (p.lexer.jsx_pragma.jsxFrag()) |fragment| {
                p.options.jsx.fragment = options.JSX.Pragma.memberListToComponentsIfDifferent(p.allocator, p.options.jsx.fragment, fragment.text) catch unreachable;
            }

            if (p.lexer.jsx_pragma.jsxImportSource()) |import_source| {
                p.options.jsx.classic_import_source = import_source.text;
                p.options.jsx.package_name = p.options.jsx.classic_import_source;
                p.options.jsx.setImportSource(p.allocator);
            }

            if (p.lexer.jsx_pragma.jsxRuntime()) |runtime| {
                if (options.JSX.RuntimeMap.get(runtime.text)) |jsx_runtime| {
                    p.options.jsx.runtime = jsx_runtime.runtime;
                    if (jsx_runtime.development) |dev| {
                        p.options.jsx.development = dev;
                    }
                } else {
                    // make this a warning instead of an error because we don't support "preserve" right now
                    try p.log.addRangeWarningFmt(p.source, runtime.range, p.allocator, "Unsupported JSX runtime: \"{s}\"", .{runtime.text});
                }
            }

            // ECMAScript modules are always interpreted as strict mode. This has to be
            // done before "hoistSymbols" because strict mode can alter hoisting (!).
            if (p.esm_import_keyword.len > 0) {
                p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_import);
            } else if (p.esm_export_keyword.len > 0) {
                p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_export);
            } else if (p.top_level_await_keyword.len > 0) {
                p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_top_level_await);
            }

            p.hoistSymbols(p.module_scope);

            var generated_symbols_count: u32 = 3;

            if (p.options.features.react_fast_refresh) {
                generated_symbols_count += 3;
            }

            if (is_jsx_enabled) {
                generated_symbols_count += 7;

                if (p.options.jsx.development) generated_symbols_count += 1;
            }

            try p.module_scope.generated.ensureUnusedCapacity(p.allocator, generated_symbols_count * 3);
            try p.module_scope.members.ensureUnusedCapacity(p.allocator, generated_symbols_count * 3 + p.module_scope.members.count());

            p.exports_ref = try p.declareCommonJSSymbol(.hoisted, "exports");
            p.module_ref = try p.declareCommonJSSymbol(.hoisted, "module");

            p.require_ref = try p.declareCommonJSSymbol(.unbound, "require");
            p.dirname_ref = try p.declareCommonJSSymbol(.unbound, "__dirname");
            p.filename_ref = try p.declareCommonJSSymbol(.unbound, "__filename");

            if (p.options.features.inject_jest_globals) {
                p.jest.describe = try p.declareCommonJSSymbol(.unbound, "describe");
                p.jest.@"test" = try p.declareCommonJSSymbol(.unbound, "test");
                p.jest.jest = try p.declareCommonJSSymbol(.unbound, "jest");
                p.jest.it = try p.declareCommonJSSymbol(.unbound, "it");
                p.jest.expect = try p.declareCommonJSSymbol(.unbound, "expect");
                p.jest.beforeEach = try p.declareCommonJSSymbol(.unbound, "beforeEach");
                p.jest.afterEach = try p.declareCommonJSSymbol(.unbound, "afterEach");
                p.jest.beforeAll = try p.declareCommonJSSymbol(.unbound, "beforeAll");
                p.jest.afterAll = try p.declareCommonJSSymbol(.unbound, "afterAll");
            }

            if (p.options.features.react_fast_refresh) {
                p.react_refresh.create_signature_ref = try p.declareGeneratedSymbol(.other, "$RefreshSig$");
                p.react_refresh.register_ref = try p.declareGeneratedSymbol(.other, "$RefreshReg$");
            }

            switch (p.options.features.server_components) {
                .none, .client_side => {},
                .wrap_exports_for_client_reference => {
                    p.server_components_wrap_ref = try p.declareGeneratedSymbol(.other, "registerClientReference");
                },
                // TODO: these wrapping modes.
                .wrap_anon_server_functions => {},
                .wrap_exports_for_server_reference => {},
            }

            if (p.options.features.hot_module_reloading) {
                p.hmr_api_ref = try p.declareCommonJSSymbol(.unbound, "hmr");
            }
        }

        fn ensureRequireSymbol(p: *P) void {
            if (p.runtime_imports.__require != null) return;
            const static_symbol = generatedSymbolName("__require");
            p.runtime_imports.__require = declareSymbolMaybeGenerated(p, .other, logger.Loc.Empty, static_symbol, true) catch bun.outOfMemory();
            p.runtime_imports.put("__require", p.runtime_imports.__require.?);
        }

        pub fn resolveCommonJSSymbols(p: *P) void {
            if (!p.options.features.allow_runtime)
                return;

            p.ensureRequireSymbol();
        }

        fn willUseRenamer(p: *P) bool {
            return p.options.bundle or p.options.features.minify_identifiers;
        }

        fn hoistSymbols(noalias p: *P, scope: *js_ast.Scope) void {
            if (!scope.kindStopsHoisting()) {
                var iter = scope.members.iterator();
                const allocator = p.allocator;
                var symbols = p.symbols.items;

                defer {
                    if (comptime Environment.allow_assert) {
                        // we call `.newSymbol` in this function
                        // we need to avoid using a potentially re-sized array
                        // so we assert that the array is in sync
                        assert(symbols.ptr == p.symbols.items.ptr);
                        assert(symbols.len == p.symbols.items.len);
                    }
                }

                // Check for collisions that would prevent to hoisting "var" symbols up to the enclosing function scope
                if (scope.parent) |parent_scope| {
                    nextMember: while (iter.next()) |res| {
                        var value = res.value_ptr.*;
                        var symbol: *Symbol = &symbols[value.ref.innerIndex()];

                        const name = symbol.original_name;
                        var hash: ?u64 = null;

                        if (parent_scope.kind == .catch_binding and symbol.kind != .hoisted) {
                            hash = Scope.getMemberHash(name);
                            if (parent_scope.getMemberWithHash(name, hash.?)) |existing_member| {
                                p.log.addSymbolAlreadyDeclaredError(
                                    p.allocator,
                                    p.source,
                                    symbol.original_name,
                                    value.loc,
                                    existing_member.loc,
                                ) catch unreachable;
                                continue;
                            }
                        }

                        if (!symbol.isHoisted()) {
                            continue;
                        }

                        var __scope = scope.parent;
                        if (comptime Environment.allow_assert)
                            assert(__scope != null);

                        var is_sloppy_mode_block_level_fn_stmt = false;
                        const original_member_ref = value.ref;

                        if (p.willUseRenamer() and symbol.kind == .hoisted_function) {
                            // Block-level function declarations behave like "let" in strict mode
                            if (scope.strict_mode != .sloppy_mode) {
                                continue;
                            }

                            // In sloppy mode, block level functions behave like "let" except with
                            // an assignment to "var", sort of. This code:
                            //
                            //   if (x) {
                            //     f();
                            //     function f() {}
                            //   }
                            //   f();
                            //
                            // behaves like this code:
                            //
                            //   if (x) {
                            //     let f2 = function() {}
                            //     var f = f2;
                            //     f2();
                            //   }
                            //   f();
                            //
                            const hoisted_ref = p.newSymbol(.hoisted, symbol.original_name) catch unreachable;
                            symbols = p.symbols.items;
                            scope.generated.push(p.allocator, hoisted_ref) catch unreachable;
                            p.hoisted_ref_for_sloppy_mode_block_fn.put(p.allocator, value.ref, hoisted_ref) catch unreachable;
                            value.ref = hoisted_ref;
                            symbol = &symbols[hoisted_ref.innerIndex()];
                            is_sloppy_mode_block_level_fn_stmt = true;
                        }

                        if (hash == null) hash = Scope.getMemberHash(name);

                        while (__scope) |_scope| {
                            const scope_kind = _scope.kind;

                            // Variable declarations hoisted past a "with" statement may actually end
                            // up overwriting a property on the target of the "with" statement instead
                            // of initializing the variable. We must not rename them or we risk
                            // causing a behavior change.
                            //
                            //   var obj = { foo: 1 }
                            //   with (obj) { var foo = 2 }
                            //   assert(foo === undefined)
                            //   assert(obj.foo === 2)
                            //
                            if (scope_kind == .with) {
                                symbol.must_not_be_renamed = true;
                            }

                            if (_scope.getMemberWithHash(name, hash.?)) |member_in_scope| {
                                var existing_symbol: *Symbol = &symbols[member_in_scope.ref.innerIndex()];
                                const existing_kind = existing_symbol.kind;

                                // We can hoist the symbol from the child scope into the symbol in
                                // this scope if:
                                //
                                //   - The symbol is unbound (i.e. a global variable access)
                                //   - The symbol is also another hoisted variable
                                //   - The symbol is a function of any kind and we're in a function or module scope
                                //
                                // Is this unbound (i.e. a global access) or also hoisted?
                                if (existing_kind == .unbound or existing_kind == .hoisted or
                                    (Symbol.isKindFunction(existing_kind) and (scope_kind == .entry or scope_kind == .function_body)))
                                {
                                    // Silently merge this symbol into the existing symbol
                                    symbol.link = member_in_scope.ref;
                                    const entry = _scope.getOrPutMemberWithHash(p.allocator, name, hash.?) catch unreachable;
                                    entry.value_ptr.* = member_in_scope;
                                    entry.key_ptr.* = name;
                                    continue :nextMember;
                                }

                                // Otherwise if this isn't a catch identifier, it's a collision
                                if (existing_kind != .catch_identifier and existing_kind != .arguments) {

                                    // An identifier binding from a catch statement and a function
                                    // declaration can both silently shadow another hoisted symbol
                                    if (symbol.kind != .catch_identifier and symbol.kind != .hoisted_function) {
                                        if (!is_sloppy_mode_block_level_fn_stmt) {
                                            const r = js_lexer.rangeOfIdentifier(p.source, value.loc);
                                            var notes = allocator.alloc(logger.Data, 1) catch unreachable;
                                            notes[0] =
                                                logger.rangeData(
                                                    p.source,
                                                    r,
                                                    std.fmt.allocPrint(
                                                        allocator,
                                                        "{s} was originally declared here",
                                                        .{name},
                                                    ) catch unreachable,
                                                );

                                            p.log.addRangeErrorFmtWithNotes(p.source, js_lexer.rangeOfIdentifier(p.source, member_in_scope.loc), allocator, notes, "{s} has already been declared", .{name}) catch unreachable;
                                        } else if (_scope == scope.parent) {
                                            // Never mind about this, turns out it's not needed after all
                                            _ = p.hoisted_ref_for_sloppy_mode_block_fn.remove(original_member_ref);
                                        }
                                    }
                                    continue :nextMember;
                                }

                                // If this is a catch identifier, silently merge the existing symbol
                                // into this symbol but continue hoisting past this catch scope
                                existing_symbol.link = value.ref;
                                const entry = _scope.getOrPutMemberWithHash(p.allocator, name, hash.?) catch unreachable;
                                entry.value_ptr.* = value;
                                entry.key_ptr.* = name;
                            }

                            if (_scope.kindStopsHoisting()) {
                                const entry = _scope.getOrPutMemberWithHash(allocator, name, hash.?) catch unreachable;
                                entry.value_ptr.* = value;
                                entry.key_ptr.* = name;
                                break;
                            }

                            __scope = _scope.parent;
                        }
                    }
                }
            }

            {
                const children = scope.children.slice();
                for (children) |child| {
                    p.hoistSymbols(child);
                }
            }
        }

        inline fn nextScopeInOrderForVisitPass(p: *P) ScopeOrder {
            const head = p.scope_order_to_visit[0];
            p.scope_order_to_visit = p.scope_order_to_visit[1..p.scope_order_to_visit.len];
            return head;
        }

        pub fn pushScopeForVisitPass(noalias p: *P, kind: js_ast.Scope.Kind, loc: logger.Loc) anyerror!void {
            const order = p.nextScopeInOrderForVisitPass();

            // Sanity-check that the scopes generated by the first and second passes match
            if (bun.Environment.allow_assert and
                order.loc.start != loc.start or order.scope.kind != kind)
            {
                p.log.level = .verbose;

                p.log.addDebugFmt(p.source, loc, p.allocator, "Expected this scope (.{s})", .{@tagName(kind)}) catch bun.outOfMemory();
                p.log.addDebugFmt(p.source, order.loc, p.allocator, "Found this scope (.{s})", .{@tagName(order.scope.kind)}) catch bun.outOfMemory();

                p.panic("Scope mismatch while visiting", .{});
            }

            p.current_scope = order.scope;

            try p.scopes_for_current_part.append(p.allocator, order.scope);
        }

        pub fn pushScopeForParsePass(noalias p: *P, comptime kind: js_ast.Scope.Kind, loc: logger.Loc) !usize {
            var parent: *Scope = p.current_scope;
            const allocator = p.allocator;
            var scope = try allocator.create(Scope);

            scope.* = Scope{
                .kind = kind,
                .label_ref = null,
                .parent = parent,
                .generated = .{},
            };

            try parent.children.push(allocator, scope);
            scope.strict_mode = parent.strict_mode;

            p.current_scope = scope;

            if (comptime kind == .with) {
                // "with" statements change the default from ESModule to CommonJS at runtime.
                // "with" statements are not allowed in strict mode.
                if (p.options.features.commonjs_at_runtime) {
                    p.has_with_scope = true;
                }
            }

            if (comptime Environment.isDebug) {
                // Enforce that scope locations are strictly increasing to help catch bugs
                // where the pushed scopes are mismatched between the first and second passes
                if (p.scopes_in_order.items.len > 0) {
                    var last_i = p.scopes_in_order.items.len - 1;
                    while (p.scopes_in_order.items[last_i] == null and last_i > 0) {
                        last_i -= 1;
                    }

                    if (p.scopes_in_order.items[last_i]) |prev_scope| {
                        if (prev_scope.loc.start >= loc.start) {
                            p.log.level = .verbose;
                            p.log.addDebugFmt(p.source, prev_scope.loc, p.allocator, "Previous Scope", .{}) catch bun.outOfMemory();
                            p.log.addDebugFmt(p.source, loc, p.allocator, "Next Scope", .{}) catch bun.outOfMemory();
                            p.panic("Scope location {d} must be greater than {d}", .{ loc.start, prev_scope.loc.start });
                        }
                    }
                }
            }

            // Copy down function arguments into the function body scope. That way we get
            // errors if a statement in the function body tries to re-declare any of the
            // arguments.
            if (comptime kind == js_ast.Scope.Kind.function_body) {
                if (comptime Environment.allow_assert)
                    assert(parent.kind == js_ast.Scope.Kind.function_args);

                var iter = scope.parent.?.members.iterator();
                while (iter.next()) |entry| {
                    // Don't copy down the optional function expression name. Re-declaring
                    // the name of a function expression is allowed.
                    const value = entry.value_ptr.*;
                    const adjacent_kind = p.symbols.items[value.ref.innerIndex()].kind;
                    if (adjacent_kind != .hoisted_function) {
                        try scope.members.put(allocator, entry.key_ptr.*, value);
                    }
                }
            }

            // Remember the length in case we call popAndDiscardScope() later
            const scope_index = p.scopes_in_order.items.len;
            try p.scopes_in_order.append(allocator, ScopeOrder{ .loc = loc, .scope = scope });
            // Output.print("\nLoc: {d}\n", .{loc.start});
            return scope_index;
        }

        // Note: do not write to "p.log" in this function. Any errors due to conversion
        // from expression to binding should be written to "invalidLog" instead. That
        // way we can potentially keep this as an expression if it turns out it's not
        // needed as a binding after all.
        fn convertExprToBinding(noalias p: *P, expr: ExprNodeIndex, invalid_loc: *LocList) ?Binding {
            switch (expr.data) {
                .e_missing => {
                    return null;
                },
                .e_identifier => |ex| {
                    return p.b(B.Identifier{ .ref = ex.ref }, expr.loc);
                },
                .e_array => |ex| {
                    if (ex.comma_after_spread) |spread| {
                        invalid_loc.append(.{
                            .loc = spread,
                            .kind = .spread,
                        }) catch unreachable;
                    }

                    if (ex.is_parenthesized) {
                        invalid_loc.append(.{
                            .loc = p.source.rangeOfOperatorBefore(expr.loc, "(").loc,
                            .kind = .parentheses,
                        }) catch unreachable;
                    }

                    // p.markSyntaxFeature(Destructing)
                    var items = List(js_ast.ArrayBinding).initCapacity(p.allocator, ex.items.len) catch unreachable;
                    var is_spread = false;
                    for (ex.items.slice(), 0..) |_, i| {
                        var item = ex.items.ptr[i];
                        if (item.data == .e_spread) {
                            is_spread = true;
                            item = item.data.e_spread.value;
                        }
                        const res = p.convertExprToBindingAndInitializer(&item, invalid_loc, is_spread);

                        items.appendAssumeCapacity(js_ast.ArrayBinding{
                            // It's valid for it to be missing
                            // An example:
                            //      Promise.all(promises).then(([, len]) => true);
                            //                                   ^ Binding is missing there
                            .binding = res.binding orelse p.b(B.Missing{}, item.loc),
                            .default_value = res.expr,
                        });
                    }

                    return p.b(B.Array{
                        .items = items.items,
                        .has_spread = is_spread,
                        .is_single_line = ex.is_single_line,
                    }, expr.loc);
                },
                .e_object => |ex| {
                    if (ex.comma_after_spread) |sp| {
                        invalid_loc.append(.{ .loc = sp, .kind = .spread }) catch unreachable;
                    }

                    if (ex.is_parenthesized) {
                        invalid_loc.append(.{ .loc = p.source.rangeOfOperatorBefore(expr.loc, "(").loc, .kind = .parentheses }) catch unreachable;
                    }
                    // p.markSyntaxFeature(compat.Destructuring, p.source.RangeOfOperatorAfter(expr.Loc, "{"))

                    var properties = List(B.Property).initCapacity(p.allocator, ex.properties.len) catch unreachable;
                    for (ex.properties.slice()) |*item| {
                        if (item.flags.contains(.is_method) or item.kind == .get or item.kind == .set) {
                            invalid_loc.append(.{
                                .loc = item.key.?.loc,
                                .kind = if (item.flags.contains(.is_method))
                                    InvalidLoc.Tag.method
                                else if (item.kind == .get)
                                    InvalidLoc.Tag.getter
                                else
                                    InvalidLoc.Tag.setter,
                            }) catch unreachable;
                            continue;
                        }
                        const value = &item.value.?;
                        const tup = p.convertExprToBindingAndInitializer(value, invalid_loc, false);
                        const initializer = tup.expr orelse item.initializer;
                        const is_spread = item.kind == .spread or item.flags.contains(.is_spread);
                        properties.appendAssumeCapacity(B.Property{
                            .flags = Flags.Property.init(.{
                                .is_spread = is_spread,
                                .is_computed = item.flags.contains(.is_computed),
                            }),
                            .key = item.key orelse p.newExpr(E.Missing{}, expr.loc),
                            .value = tup.binding orelse p.b(B.Missing{}, expr.loc),
                            .default_value = initializer,
                        });
                    }

                    return p.b(B.Object{
                        .properties = properties.items,
                        .is_single_line = ex.is_single_line,
                    }, expr.loc);
                },
                else => {
                    invalid_loc.append(.{ .loc = expr.loc, .kind = .unknown }) catch unreachable;
                    return null;
                },
            }

            return null;
        }

        pub fn convertExprToBindingAndInitializer(noalias p: *P, _expr: *ExprNodeIndex, invalid_log: *LocList, is_spread: bool) ExprBindingTuple {
            var initializer: ?ExprNodeIndex = null;
            var expr = _expr;
            // zig syntax is sometimes painful
            switch (expr.*.data) {
                .e_binary => |bin| {
                    if (bin.op == .bin_assign) {
                        initializer = bin.right;
                        expr = &bin.left;
                    }
                },
                else => {},
            }

            const bind = p.convertExprToBinding(expr.*, invalid_log);
            if (initializer) |initial| {
                const equalsRange = p.source.rangeOfOperatorBefore(initial.loc, "=");
                if (is_spread) {
                    p.log.addRangeError(p.source, equalsRange, "A rest argument cannot have a default initializer") catch unreachable;
                } else {
                    // p.markSyntaxFeature();
                }
            }
            return ExprBindingTuple{ .binding = bind, .expr = initializer };
        }

        pub const BinaryExpressionVisitor = struct {
            e: *E.Binary,
            loc: logger.Loc,
            in: ExprIn,

            /// Input for visiting the left child
            left_in: ExprIn,

            /// "Local variables" passed from "checkAndPrepare" to "visitRightAndFinish"
            is_stmt_expr: bool = false,

            pub fn visitRightAndFinish(
                v: *BinaryExpressionVisitor,
                p: *P,
            ) Expr {
                var e_ = v.e;
                const is_call_target = @as(Expr.Tag, p.call_target) == .e_binary and e_ == p.call_target.e_binary;
                // const is_stmt_expr = @as(Expr.Tag, p.stmt_expr_value) == .e_binary and expr.data.e_binary == p.stmt_expr_value.e_binary;
                const was_anonymous_named_expr = e_.right.isAnonymousNamed();

                // Mark the control flow as dead if the branch is never taken
                switch (e_.op) {
                    .bin_logical_or => {
                        const side_effects = SideEffects.toBoolean(p, e_.left.data);
                        if (side_effects.ok and side_effects.value) {
                            // "true || dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    .bin_logical_and => {
                        const side_effects = SideEffects.toBoolean(p, e_.left.data);
                        if (side_effects.ok and !side_effects.value) {
                            // "false && dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    .bin_nullish_coalescing => {
                        const side_effects = SideEffects.toNullOrUndefined(p, e_.left.data);
                        if (side_effects.ok and !side_effects.value) {
                            // "notNullOrUndefined ?? dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    else => {
                        e_.right = p.visitExpr(e_.right);
                    },
                }

                // Always put constants on the right for equality comparisons to help
                // reduce the number of cases we have to check during pattern matching. We
                // can only reorder expressions that do not have any side effects.
                switch (e_.op) {
                    .bin_loose_eq, .bin_loose_ne, .bin_strict_eq, .bin_strict_ne => {
                        if (SideEffects.isPrimitiveToReorder(e_.left.data) and !SideEffects.isPrimitiveToReorder(e_.right.data)) {
                            const _left = e_.left;
                            const _right = e_.right;
                            e_.left = _right;
                            e_.right = _left;
                        }
                    },
                    else => {},
                }

                switch (e_.op) {
                    .bin_comma => {
                        // "(1, 2)" => "2"
                        // "(sideEffects(), 2)" => "(sideEffects(), 2)"
                        if (p.options.features.minify_syntax) {
                            e_.left = SideEffects.simplifyUnusedExpr(p, e_.left) orelse return e_.right;
                        }
                    },
                    .bin_loose_eq => {
                        const equality = e_.left.data.eql(e_.right.data, p, .loose);
                        if (equality.ok) {
                            if (equality.is_require_main_and_module) {
                                p.ignoreUsageOfRuntimeRequire();
                                p.ignoreUsage(p.module_ref);
                                return p.valueForImportMetaMain(false, v.loc);
                            }

                            return p.newExpr(
                                E.Boolean{ .value = equality.equal },
                                v.loc,
                            );
                        }

                        if (p.options.features.minify_syntax) {
                            // "x == void 0" => "x == null"
                            if (e_.left.data == .e_undefined) {
                                e_.left.data = .{ .e_null = E.Null{} };
                            } else if (e_.right.data == .e_undefined) {
                                e_.right.data = .{ .e_null = E.Null{} };
                            }
                        }

                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string

                    },
                    .bin_strict_eq => {
                        const equality = e_.left.data.eql(e_.right.data, p, .strict);
                        if (equality.ok) {
                            if (equality.is_require_main_and_module) {
                                p.ignoreUsage(p.module_ref);
                                p.ignoreUsageOfRuntimeRequire();
                                return p.valueForImportMetaMain(false, v.loc);
                            }

                            return p.newExpr(E.Boolean{ .value = equality.equal }, v.loc);
                        }

                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string
                    },
                    .bin_loose_ne => {
                        const equality = e_.left.data.eql(e_.right.data, p, .loose);
                        if (equality.ok) {
                            if (equality.is_require_main_and_module) {
                                p.ignoreUsage(p.module_ref);
                                p.ignoreUsageOfRuntimeRequire();
                                return p.valueForImportMetaMain(true, v.loc);
                            }

                            return p.newExpr(E.Boolean{ .value = !equality.equal }, v.loc);
                        }
                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string

                        // "x != void 0" => "x != null"
                        if (@as(Expr.Tag, e_.right.data) == .e_undefined) {
                            e_.right = p.newExpr(E.Null{}, e_.right.loc);
                        }
                    },
                    .bin_strict_ne => {
                        const equality = e_.left.data.eql(e_.right.data, p, .strict);
                        if (equality.ok) {
                            if (equality.is_require_main_and_module) {
                                p.ignoreUsage(p.module_ref);
                                p.ignoreUsageOfRuntimeRequire();
                                return p.valueForImportMetaMain(true, v.loc);
                            }

                            return p.newExpr(E.Boolean{ .value = !equality.equal }, v.loc);
                        }
                    },
                    .bin_nullish_coalescing => {
                        const nullorUndefined = SideEffects.toNullOrUndefined(p, e_.left.data);
                        if (nullorUndefined.ok) {
                            if (!nullorUndefined.value) {
                                return e_.left;
                            } else if (nullorUndefined.side_effects == .no_side_effects) {
                                // "(null ?? fn)()" => "fn()"
                                // "(null ?? this.fn)" => "this.fn"
                                // "(null ?? this.fn)()" => "(0, this.fn)()"
                                if (is_call_target and e_.right.hasValueForThisInCall()) {
                                    return Expr.joinWithComma(Expr{ .data = .{ .e_number = .{ .value = 0.0 } }, .loc = e_.left.loc }, e_.right, p.allocator);
                                }

                                return e_.right;
                            }
                        }
                    },
                    .bin_logical_or => {
                        const side_effects = SideEffects.toBoolean(p, e_.left.data);
                        if (side_effects.ok and side_effects.value) {
                            return e_.left;
                        } else if (side_effects.ok and side_effects.side_effects == .no_side_effects) {
                            // "(0 || fn)()" => "fn()"
                            // "(0 || this.fn)" => "this.fn"
                            // "(0 || this.fn)()" => "(0, this.fn)()"
                            if (is_call_target and e_.right.hasValueForThisInCall()) {
                                return Expr.joinWithComma(Expr{ .data = Prefill.Data.Zero, .loc = e_.left.loc }, e_.right, p.allocator);
                            }

                            return e_.right;
                        }
                    },
                    .bin_logical_and => {
                        const side_effects = SideEffects.toBoolean(p, e_.left.data);
                        if (side_effects.ok) {
                            if (!side_effects.value) {
                                return e_.left;
                            } else if (side_effects.side_effects == .no_side_effects) {
                                // "(1 && fn)()" => "fn()"
                                // "(1 && this.fn)" => "this.fn"
                                // "(1 && this.fn)()" => "(0, this.fn)()"
                                if (is_call_target and e_.right.hasValueForThisInCall()) {
                                    return Expr.joinWithComma(Expr{ .data = Prefill.Data.Zero, .loc = e_.left.loc }, e_.right, p.allocator);
                                }

                                return e_.right;
                            }
                        }
                    },
                    .bin_add => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = vals[0] + vals[1] }, v.loc);
                            }

                            // "'abc' + 'xyz'" => "'abcxyz'"
                            if (foldStringAddition(e_.left, e_.right, p.allocator, .normal)) |res| {
                                return res;
                            }

                            // "(x + 'abc') + 'xyz'" => "'abcxyz'"
                            if (e_.left.data.as(.e_binary)) |left| {
                                if (left.op == .bin_add) {
                                    if (foldStringAddition(left.right, e_.right, p.allocator, .nested_left)) |result| {
                                        return p.newExpr(E.Binary{
                                            .left = left.left,
                                            .right = result,
                                            .op = .bin_add,
                                        }, e_.left.loc);
                                    }
                                }
                            }
                        }
                    },
                    .bin_sub => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = vals[0] - vals[1] }, v.loc);
                            }
                        }
                    },
                    .bin_mul => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = vals[0] * vals[1] }, v.loc);
                            }
                        }
                    },
                    .bin_div => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = vals[0] / vals[1] }, v.loc);
                            }
                        }
                    },
                    .bin_rem => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                const fmod = @extern(*const fn (f64, f64) callconv(.C) f64, .{ .name = "fmod" });
                                return p.newExpr(
                                    // Use libc fmod here to be consistent with what JavaScriptCore does
                                    // https://github.com/oven-sh/WebKit/blob/7a0b13626e5db69aa5a32d037431d381df5dfb61/Source/JavaScriptCore/runtime/MathCommon.cpp#L574-L597
                                    E.Number{ .value = if (comptime Environment.isNative) fmod(vals[0], vals[1]) else std.math.mod(f64, vals[0], vals[1]) catch 0 },
                                    v.loc,
                                );
                            }
                        }
                    },
                    .bin_pow => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = JSC.math.pow(vals[0], vals[1]) }, v.loc);
                            }
                        }
                    },
                    .bin_shl => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                const left = floatToInt32(vals[0]);
                                const right: u8 = @intCast(@as(u32, @bitCast(floatToInt32(vals[1]))) % 32);
                                const result: i32 = @bitCast(std.math.shl(i32, left, right));
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt(result),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_shr => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                const left = floatToInt32(vals[0]);
                                const right: u8 = @intCast(@as(u32, @bitCast(floatToInt32(vals[1]))) % 32);
                                const result: i32 = @bitCast(std.math.shr(i32, left, right));
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt(result),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_u_shr => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                const left: u32 = @bitCast(floatToInt32(vals[0]));
                                const right: u8 = @intCast(@as(u32, @bitCast(floatToInt32(vals[1]))) % 32);
                                const result: u32 = std.math.shr(u32, left, right);
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt(result),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_bitwise_and => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt((floatToInt32(vals[0]) & floatToInt32(vals[1]))),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_bitwise_or => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt((floatToInt32(vals[0]) | floatToInt32(vals[1]))),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_bitwise_xor => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt((floatToInt32(vals[0]) ^ floatToInt32(vals[1]))),
                                }, v.loc);
                            }
                        }
                    },
                    // ---------------------------------------------------------------------------------------------------
                    .bin_assign => {
                        // Optionally preserve the name
                        if (e_.left.data == .e_identifier) {
                            e_.right = p.maybeKeepExprSymbolName(e_.right, p.symbols.items[e_.left.data.e_identifier.ref.innerIndex()].original_name, was_anonymous_named_expr);
                        }
                    },
                    .bin_nullish_coalescing_assign, .bin_logical_or_assign => {
                        // Special case `{}.field ??= value` to minify to `value`
                        // This optimization is specifically to target this pattern in HMR:
                        //    `import.meta.hot.data.etc ??= init()`
                        if (e_.left.data.as(.e_dot)) |dot| {
                            if (dot.target.data.as(.e_object)) |obj| {
                                if (obj.properties.len == 0) {
                                    if (!bun.strings.eqlComptime(dot.name, "__proto__"))
                                        return e_.right;
                                }
                            }
                        }
                    },
                    else => {},
                }

                return Expr{ .loc = v.loc, .data = .{ .e_binary = e_ } };
            }

            pub fn checkAndPrepare(v: *BinaryExpressionVisitor, p: *P) ?Expr {
                var e_ = v.e;
                switch (e_.left.data) {
                    // Special-case private identifiers
                    .e_private_identifier => |_private| {
                        if (e_.op == .bin_in) {
                            var private = _private;
                            const name = p.loadNameFromRef(private.ref);
                            const result = p.findSymbol(e_.left.loc, name) catch unreachable;
                            private.ref = result.ref;

                            // Unlike regular identifiers, there are no unbound private identifiers
                            const kind: Symbol.Kind = p.symbols.items[result.ref.innerIndex()].kind;
                            if (!Symbol.isKindPrivate(kind)) {
                                const r = logger.Range{ .loc = e_.left.loc, .len = @as(i32, @intCast(name.len)) };
                                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Private name \"{s}\" must be declared in an enclosing class", .{name}) catch unreachable;
                            }

                            e_.right = p.visitExpr(e_.right);
                            e_.left = .{ .data = .{ .e_private_identifier = private }, .loc = e_.left.loc };

                            // privateSymbolNeedsToBeLowered
                            return Expr{ .loc = v.loc, .data = .{ .e_binary = e_ } };
                        }
                    },
                    else => {},
                }

                v.is_stmt_expr = p.stmt_expr_value == .e_binary and p.stmt_expr_value.e_binary == e_;

                v.left_in = ExprIn{
                    .assign_target = e_.op.binaryAssignTarget(),
                };

                return null;
            }
        };

        pub fn forbidLexicalDecl(noalias p: *const P, loc: logger.Loc) anyerror!void {
            try p.log.addError(p.source, loc, "Cannot use a declaration in a single-statement context");
        }

        /// If we attempt to parse TypeScript syntax outside of a TypeScript file
        /// make it a compile error
        pub inline fn markTypeScriptOnly(noalias _: *const P) void {
            if (comptime !is_typescript_enabled) {
                @compileError("This function can only be used in TypeScript");
            }

            // explicitly mark it as unreachable in the hopes that the function doesn't exist at all
            if (!is_typescript_enabled) {
                unreachable;
            }
        }

        pub fn logExprErrors(noalias p: *P, noalias errors: *DeferredErrors) void {
            if (errors.invalid_expr_default_value) |r| {
                p.log.addRangeError(
                    p.source,
                    r,
                    "Unexpected \"=\"",
                ) catch unreachable;
            }

            if (errors.invalid_expr_after_question) |r| {
                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Unexpected {s}", .{p.source.contents[r.loc.i()..r.endI()]}) catch unreachable;
            }

            // if (errors.array_spread_feature) |err| {
            //     p.markSyntaxFeature(compat.ArraySpread, errors.arraySpreadFeature)
            // }
        }

        pub fn popAndDiscardScope(noalias p: *P, scope_index: usize) void {
            // Move up to the parent scope
            const to_discard = p.current_scope;
            const parent = to_discard.parent orelse unreachable;

            p.current_scope = parent;

            // Truncate the scope order where we started to pretend we never saw this scope
            p.scopes_in_order.shrinkRetainingCapacity(scope_index);

            var children = parent.children;
            // Remove the last child from the parent scope
            const last = children.len - 1;
            if (children.slice()[last] != to_discard) {
                p.panic("Internal error", .{});
            }

            _ = children.pop();
        }

        pub fn processImportStatement(p: *P, stmt_: S.Import, path: ParsedPath, loc: logger.Loc, was_originally_bare_import: bool) anyerror!Stmt {
            const is_macro = FeatureFlags.is_macro_enabled and (path.is_macro or js_ast.Macro.isMacroPath(path.text));
            var stmt = stmt_;
            if (is_macro) {
                const id = p.addImportRecord(.stmt, path.loc, path.text);
                p.import_records.items[id].path.namespace = js_ast.Macro.namespace;
                p.import_records.items[id].is_unused = true;

                if (stmt.default_name) |name_loc| {
                    const name = p.loadNameFromRef(name_loc.ref.?);
                    const ref = try p.declareSymbol(.other, name_loc.loc, name);
                    try p.is_import_item.put(p.allocator, ref, {});
                    try p.macro.refs.put(ref, .{
                        .import_record_id = id,
                        .name = "default",
                    });
                }

                if (stmt.star_name_loc) |star| {
                    const name = p.loadNameFromRef(stmt.namespace_ref);
                    const ref = try p.declareSymbol(.other, star, name);
                    stmt.namespace_ref = ref;
                    try p.macro.refs.put(ref, .{ .import_record_id = id });
                }

                for (stmt.items) |item| {
                    const name = p.loadNameFromRef(item.name.ref.?);
                    const ref = try p.declareSymbol(.other, item.name.loc, name);
                    try p.is_import_item.put(p.allocator, ref, {});
                    try p.macro.refs.put(ref, .{
                        .import_record_id = id,
                        .name = item.alias,
                    });
                }

                return p.s(S.Empty{}, loc);
            }

            const macro_remap = if (comptime allow_macros)
                p.options.macro_context.getRemap(path.text)
            else
                null;

            stmt.import_record_index = p.addImportRecord(.stmt, path.loc, path.text);
            p.import_records.items[stmt.import_record_index].was_originally_bare_import = was_originally_bare_import;

            if (stmt.star_name_loc) |star| {
                const name = p.loadNameFromRef(stmt.namespace_ref);

                stmt.namespace_ref = try p.declareSymbol(.import, star, name);

                if (comptime track_symbol_usage_during_parse_pass) {
                    p.parse_pass_symbol_uses.put(name, .{
                        .ref = stmt.namespace_ref,
                        .import_record_index = stmt.import_record_index,
                    }) catch unreachable;
                }

                // TODO: not sure how to handle macro remappings for namespace imports
            } else {
                var path_name = fs.PathName.init(path.text);
                const name = try strings.append(p.allocator, "import_", try path_name.nonUniqueNameString(p.allocator));
                stmt.namespace_ref = try p.newSymbol(.other, name);
                var scope: *Scope = p.current_scope;
                try scope.generated.push(p.allocator, stmt.namespace_ref);
            }

            var item_refs = ImportItemForNamespaceMap.init(p.allocator);
            const count_excluding_namespace = @as(u16, @intCast(stmt.items.len)) +
                @as(u16, @intCast(@intFromBool(stmt.default_name != null)));

            try item_refs.ensureUnusedCapacity(count_excluding_namespace);
            // Even though we allocate ahead of time here
            // we cannot use putAssumeCapacity because a symbol can have existing links
            // those may write to this hash table, so this estimate may be innaccurate
            try p.is_import_item.ensureUnusedCapacity(p.allocator, count_excluding_namespace);
            var remap_count: u32 = 0;
            // Link the default item to the namespace
            if (stmt.default_name) |*name_loc| outer: {
                const name = p.loadNameFromRef(name_loc.ref.?);
                const ref = try p.declareSymbol(.import, name_loc.loc, name);
                name_loc.ref = ref;
                try p.is_import_item.put(p.allocator, ref, {});

                // ensure every e_import_identifier holds the namespace
                if (p.options.features.hot_module_reloading) {
                    const symbol = &p.symbols.items[ref.inner_index];
                    if (symbol.namespace_alias == null) {
                        symbol.namespace_alias = .{
                            .namespace_ref = stmt.namespace_ref,
                            .alias = "default",
                            .import_record_index = stmt.import_record_index,
                        };
                    }
                }

                if (macro_remap) |*remap| {
                    if (remap.get("default")) |remapped_path| {
                        const new_import_id = p.addImportRecord(.stmt, path.loc, remapped_path);
                        try p.macro.refs.put(ref, .{
                            .import_record_id = new_import_id,
                            .name = "default",
                        });

                        p.import_records.items[new_import_id].path.namespace = js_ast.Macro.namespace;
                        p.import_records.items[new_import_id].is_unused = true;
                        if (comptime only_scan_imports_and_do_not_visit) {
                            p.import_records.items[new_import_id].is_internal = true;
                            p.import_records.items[new_import_id].path.is_disabled = true;
                        }
                        stmt.default_name = null;
                        remap_count += 1;
                        break :outer;
                    }
                }

                if (comptime track_symbol_usage_during_parse_pass) {
                    p.parse_pass_symbol_uses.put(name, .{
                        .ref = ref,
                        .import_record_index = stmt.import_record_index,
                    }) catch unreachable;
                }

                if (comptime ParsePassSymbolUsageType != void) {
                    p.parse_pass_symbol_uses.put(name, .{
                        .ref = ref,
                        .import_record_index = stmt.import_record_index,
                    }) catch unreachable;
                }

                item_refs.putAssumeCapacity(name, name_loc.*);
            }
            var end: usize = 0;

            for (stmt.items) |item_| {
                var item = item_;
                const name = p.loadNameFromRef(item.name.ref orelse unreachable);
                const ref = try p.declareSymbol(.import, item.name.loc, name);
                item.name.ref = ref;

                try p.is_import_item.put(p.allocator, ref, {});
                p.checkForNonBMPCodePoint(item.alias_loc, item.alias);

                // ensure every e_import_identifier holds the namespace
                if (p.options.features.hot_module_reloading) {
                    const symbol = &p.symbols.items[ref.inner_index];
                    if (symbol.namespace_alias == null) {
                        symbol.namespace_alias = .{
                            .namespace_ref = stmt.namespace_ref,
                            .alias = item.alias,
                            .import_record_index = stmt.import_record_index,
                        };
                    }
                }

                if (macro_remap) |*remap| {
                    if (remap.get(item.alias)) |remapped_path| {
                        const new_import_id = p.addImportRecord(.stmt, path.loc, remapped_path);
                        try p.macro.refs.put(ref, .{
                            .import_record_id = new_import_id,
                            .name = item.alias,
                        });

                        p.import_records.items[new_import_id].path.namespace = js_ast.Macro.namespace;
                        p.import_records.items[new_import_id].is_unused = true;
                        if (comptime only_scan_imports_and_do_not_visit) {
                            p.import_records.items[new_import_id].is_internal = true;
                            p.import_records.items[new_import_id].path.is_disabled = true;
                        }
                        remap_count += 1;
                        continue;
                    }
                }

                if (comptime track_symbol_usage_during_parse_pass) {
                    p.parse_pass_symbol_uses.put(name, .{
                        .ref = ref,
                        .import_record_index = stmt.import_record_index,
                    }) catch unreachable;
                }

                item_refs.putAssumeCapacity(item.alias, item.name);
                stmt.items[end] = item;
                end += 1;
            }
            stmt.items = stmt.items[0..end];

            // If we remapped the entire import away
            // i.e. import {graphql} "react-relay"

            if (remap_count > 0 and stmt.items.len == 0 and stmt.default_name == null) {
                p.import_records.items[stmt.import_record_index].path.namespace = js_ast.Macro.namespace;
                p.import_records.items[stmt.import_record_index].is_unused = true;

                if (comptime only_scan_imports_and_do_not_visit) {
                    p.import_records.items[stmt.import_record_index].path.is_disabled = true;
                    p.import_records.items[stmt.import_record_index].is_internal = true;
                }

                return p.s(S.Empty{}, loc);
            } else if (remap_count > 0) {
                item_refs.shrinkAndFree(stmt.items.len + @as(usize, @intFromBool(stmt.default_name != null)));
            }

            if (path.import_tag != .none or path.loader != null) {
                try p.validateAndSetImportType(&path, &stmt);
            }

            // Track the items for this namespace
            try p.import_items_for_namespace.put(p.allocator, stmt.namespace_ref, item_refs);
            return p.s(stmt, loc);
        }

        fn validateAndSetImportType(p: *P, path: *const ParsedPath, stmt: *S.Import) !void {
            @branchHint(.cold);

            if (path.loader) |loader| {
                p.import_records.items[stmt.import_record_index].loader = loader;

                if (loader == .sqlite or loader == .sqlite_embedded) {
                    for (stmt.items) |*item| {
                        if (!(strings.eqlComptime(item.alias, "default") or strings.eqlComptime(item.alias, "db"))) {
                            try p.log.addError(
                                p.source,
                                item.name.loc,
                                "sqlite imports only support the \"default\" or \"db\" imports",
                            );
                            break;
                        }
                    }
                } else if (loader == .file or loader == .text) {
                    for (stmt.items) |*item| {
                        if (!(strings.eqlComptime(item.alias, "default"))) {
                            try p.log.addError(
                                p.source,
                                item.name.loc,
                                "This loader type only supports the \"default\" import",
                            );
                            break;
                        }
                    }
                }
            } else if (path.import_tag == .bake_resolve_to_ssr_graph) {
                p.import_records.items[stmt.import_record_index].tag = path.import_tag;
            }
        }

        pub fn createDefaultName(p: *P, loc: logger.Loc) !js_ast.LocRef {
            const identifier = try std.fmt.allocPrint(p.allocator, "{s}_default", .{try p.source.path.name.nonUniqueNameString(p.allocator)});

            const name = js_ast.LocRef{ .loc = loc, .ref = try p.newSymbol(Symbol.Kind.other, identifier) };

            var scope = p.current_scope;

            try scope.generated.push(p.allocator, name.ref.?);

            return name;
        }

        pub fn newSymbol(p: *P, kind: Symbol.Kind, identifier: string) !Ref {
            const inner_index: Ref.Int = @truncate(p.symbols.items.len);
            try p.symbols.append(Symbol{
                .kind = kind,
                .original_name = identifier,
            });

            if (is_typescript_enabled) {
                try p.ts_use_counts.append(p.allocator, 0);
            }

            return Ref{
                .inner_index = inner_index,
                .source_index = @intCast(p.source.index.get()),
                .tag = .symbol,
            };
        }

        pub fn defaultNameForExpr(p: *P, expr: Expr, loc: logger.Loc) LocRef {
            switch (expr.data) {
                .e_function => |func_container| {
                    if (func_container.func.name) |_name| {
                        if (_name.ref) |ref| {
                            return LocRef{ .loc = loc, .ref = ref };
                        }
                    }
                },
                .e_identifier => |ident| {
                    return LocRef{ .loc = loc, .ref = ident.ref };
                },
                .e_import_identifier => |ident| {
                    if (!allow_macros or (allow_macros and !p.macro.refs.contains(ident.ref))) {
                        return LocRef{ .loc = loc, .ref = ident.ref };
                    }
                },
                .e_class => |class| {
                    if (class.class_name) |_name| {
                        if (_name.ref) |ref| {
                            return LocRef{ .loc = loc, .ref = ref };
                        }
                    }
                },
                else => {},
            }

            return createDefaultName(p, loc) catch unreachable;
        }

        pub fn discardScopesUpTo(p: *P, scope_index: usize) void {
            // Remove any direct children from their parent
            const scope = p.current_scope;
            var children = scope.children;
            defer scope.children = children;

            for (p.scopes_in_order.items[scope_index..]) |_child| {
                const child = _child orelse continue;

                if (child.scope.parent == p.current_scope) {
                    var i: usize = children.len - 1;
                    while (i >= 0) {
                        if (children.mut(i).* == child.scope) {
                            _ = children.orderedRemove(i);
                            break;
                        }
                        i -= 1;
                    }
                }
            }

            // Truncate the scope order where we started to pretend we never saw this scope
            p.scopes_in_order.shrinkRetainingCapacity(scope_index);
        }

        pub fn defineExportedNamespaceBinding(
            p: *P,
            exported_members: *js_ast.TSNamespaceMemberMap,
            binding: Binding,
        ) !void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |id| {
                    const name = p.symbols.items[id.ref.inner_index].original_name;
                    try exported_members.put(p.allocator, name, .{
                        .loc = binding.loc,
                        .data = .property,
                    });
                    try p.ref_to_ts_namespace_member.put(
                        p.allocator,
                        id.ref,
                        .property,
                    );
                },
                .b_object => |obj| {
                    for (obj.properties) |prop| {
                        try p.defineExportedNamespaceBinding(exported_members, prop.value);
                    }
                },
                .b_array => |obj| {
                    for (obj.items) |prop| {
                        try p.defineExportedNamespaceBinding(exported_members, prop.binding);
                    }
                },
            }
        }

        pub fn forbidInitializers(p: *P, decls: []G.Decl, comptime loop_type: string, is_var: bool) anyerror!void {
            switch (decls.len) {
                0 => {},
                1 => {
                    if (decls[0].value) |value| {
                        if (is_var) {

                            // This is a weird special case. Initializers are allowed in "var"
                            // statements with identifier bindings.
                            return;
                        }

                        try p.log.addError(p.source, value.loc, comptime std.fmt.comptimePrint("for-{s} loop variables cannot have an initializer", .{loop_type}));
                    }
                },
                else => {
                    try p.log.addError(p.source, decls[0].binding.loc, comptime std.fmt.comptimePrint("for-{s} loops must have a single declaration", .{loop_type}));
                },
            }
        }

        pub fn requireInitializers(noalias p: *P, comptime kind: S.Local.Kind, decls: []G.Decl) anyerror!void {
            const what = switch (kind) {
                .k_await_using, .k_using => "declaration",
                .k_const => "constant",
                else => @compileError("unreachable"),
            };

            for (decls) |*decl| {
                if (decl.value == null) {
                    switch (decl.binding.data) {
                        .b_identifier => |ident| {
                            const r = js_lexer.rangeOfIdentifier(p.source, decl.binding.loc);
                            try p.log.addRangeErrorFmt(p.source, r, p.allocator, "The " ++ what ++ " \"{s}\" must be initialized", .{
                                p.symbols.items[ident.ref.innerIndex()].original_name,
                            });
                            // return;/
                        },
                        else => {
                            try p.log.addError(p.source, decl.binding.loc, "This " ++ what ++ " must be initialized");
                        },
                    }
                }
            }
        }

        // Generate a TypeScript namespace object for this namespace's scope. If this
        // namespace is another block that is to be merged with an existing namespace,
        // use that earlier namespace's object instead.
        pub fn getOrCreateExportedNamespaceMembers(p: *P, name: []const u8, is_export: bool, is_enum_scope: bool) *js_ast.TSNamespaceScope {
            const map = brk: {

                // Merge with a sibling namespace from the same scope
                if (p.current_scope.members.get(name)) |existing_member| {
                    if (p.ref_to_ts_namespace_member.get(existing_member.ref)) |member_data| {
                        if (member_data == .namespace)
                            break :brk member_data.namespace;
                    }
                }

                // Merge with a sibling namespace from a different scope
                if (is_export) {
                    if (p.current_scope.ts_namespace) |ns| {
                        if (ns.exported_members.get(name)) |member| {
                            if (member.data == .namespace)
                                break :brk member.data.namespace;
                        }
                    }
                }

                break :brk null;
            };

            if (map) |existing| {
                return bun.create(p.allocator, js_ast.TSNamespaceScope, .{
                    .exported_members = existing,
                    .is_enum_scope = is_enum_scope,
                    .arg_ref = Ref.None,
                });
            }

            // Otherwise, generate a new namespace object
            // Batch the allocation of the namespace object and the map into a single allocation.
            const Pair = struct {
                map: js_ast.TSNamespaceMemberMap,
                scope: js_ast.TSNamespaceScope,
            };

            var pair = p.allocator.create(Pair) catch bun.outOfMemory();
            pair.map = .{};
            pair.scope = .{
                .exported_members = &pair.map,
                .is_enum_scope = is_enum_scope,
                .arg_ref = Ref.None,
            };

            return &pair.scope;
        }
        // TODO:
        pub fn checkForNonBMPCodePoint(_: *P, _: logger.Loc, _: string) void {}

        pub fn markStrictModeFeature(p: *P, feature: StrictModeFeature, r: logger.Range, detail: string) anyerror!void {
            const can_be_transformed = feature == StrictModeFeature.for_in_var_init;
            const text = switch (feature) {
                .with_statement => "With statements",
                .delete_bare_name => "\"delete\" of a bare identifier",
                .for_in_var_init => "Variable initializers within for-in loops",
                .eval_or_arguments => try std.fmt.allocPrint(p.allocator, "Declarations with the name \"{s}\"", .{detail}),
                .reserved_word => try std.fmt.allocPrint(p.allocator, "\"{s}\" is a reserved word and", .{detail}),
                .legacy_octal_literal => "Legacy octal literals",
                .legacy_octal_escape => "Legacy octal escape sequences",
                .if_else_function_stmt => "Function declarations inside if statements",
                // else => {
                //     text = "This feature";
                // },
            };

            const scope = p.current_scope;
            if (p.isStrictMode()) {
                var why: string = "";
                var where: logger.Range = logger.Range.None;
                switch (scope.strict_mode) {
                    .implicit_strict_mode_import => {
                        where = p.esm_import_keyword;
                    },
                    .implicit_strict_mode_export => {
                        where = p.esm_export_keyword;
                    },
                    .implicit_strict_mode_top_level_await => {
                        where = p.top_level_await_keyword;
                    },
                    .implicit_strict_mode_class => {
                        why = "All code inside a class is implicitly in strict mode";
                        where = p.enclosing_class_keyword;
                    },
                    else => {},
                }
                if (why.len == 0) {
                    why = try std.fmt.allocPrint(p.allocator, "This file is implicitly in strict mode because of the \"{s}\" keyword here", .{p.source.textForRange(where)});
                }
                var notes = try p.allocator.alloc(logger.Data, 1);
                notes[0] = logger.rangeData(p.source, where, why);
                try p.log.addRangeErrorWithNotes(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} cannot be used in strict mode", .{text}), notes);
            } else if (!can_be_transformed and p.isStrictModeOutputFormat()) {
                try p.log.addRangeError(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} cannot be used with the ESM output format due to strict mode", .{text}));
            }
        }

        pub inline fn isStrictMode(p: *P) bool {
            return p.current_scope.strict_mode != .sloppy_mode;
        }

        pub inline fn isStrictModeOutputFormat(p: *P) bool {
            return p.options.bundle and p.options.output_format.isESM();
        }

        pub fn declareCommonJSSymbol(p: *P, comptime kind: Symbol.Kind, comptime name: string) !Ref {
            const name_hash = comptime Scope.getMemberHash(name);
            const member = p.module_scope.getMemberWithHash(name, name_hash);

            // If the code declared this symbol using "var name", then this is actually
            // not a collision. For example, node will let you do this:
            //
            //   var exports;
            //   module.exports.foo = 123;
            //   console.log(exports.foo);
            //
            // This works because node's implementation of CommonJS wraps the entire
            // source file like this:
            //
            //   (function(require, exports, module, __filename, __dirname) {
            //     var exports;
            //     module.exports.foo = 123;
            //     console.log(exports.foo);
            //   })
            //
            // Both the "exports" argument and "var exports" are hoisted variables, so
            // they don't collide.
            if (member) |_member| {
                if (p.symbols.items[_member.ref.innerIndex()].kind == .hoisted and kind == .hoisted and !p.has_es_module_syntax) {
                    return _member.ref;
                }
            }

            // Create a new symbol if we didn't merge with an existing one above
            const ref = try p.newSymbol(kind, name);

            if (member == null) {
                try p.module_scope.members.put(p.allocator, name, Scope.Member{ .ref = ref, .loc = logger.Loc.Empty });
                return ref;
            }

            // If the variable was declared, then it shadows this symbol. The code in
            // this module will be unable to reference this symbol. However, we must
            // still add the symbol to the scope so it gets minified (automatically-
            // generated code may still reference the symbol).
            try p.module_scope.generated.push(p.allocator, ref);
            return ref;
        }

        fn declareGeneratedSymbol(p: *P, kind: Symbol.Kind, comptime name: string) !Ref {
            // The bundler runs the renamer, so it is ok to not append a hash
            if (p.options.bundle) {
                return try declareSymbolMaybeGenerated(p, kind, logger.Loc.Empty, name, true);
            }

            return try declareSymbolMaybeGenerated(p, kind, logger.Loc.Empty, generatedSymbolName(name), true);
        }

        pub fn declareSymbol(p: *P, kind: Symbol.Kind, loc: logger.Loc, name: string) !Ref {
            return try @call(bun.callmod_inline, declareSymbolMaybeGenerated, .{ p, kind, loc, name, false });
        }

        pub fn declareSymbolMaybeGenerated(p: *P, kind: Symbol.Kind, loc: logger.Loc, name: string, comptime is_generated: bool) !Ref {
            // p.checkForNonBMPCodePoint(loc, name)
            if (comptime !is_generated) {
                // Forbid declaring a symbol with a reserved word in strict mode
                if (p.isStrictMode() and name.ptr != arguments_str.ptr and js_lexer.StrictModeReservedWords.has(name)) {
                    try p.markStrictModeFeature(.reserved_word, js_lexer.rangeOfIdentifier(p.source, loc), name);
                }
            }

            // Allocate a new symbol
            var ref = try p.newSymbol(kind, name);

            const scope = p.current_scope;
            const entry = try scope.members.getOrPut(p.allocator, name);
            if (entry.found_existing) {
                const existing = entry.value_ptr.*;
                var symbol: *Symbol = &p.symbols.items[existing.ref.innerIndex()];

                if (comptime !is_generated) {
                    switch (scope.canMergeSymbols(symbol.kind, kind, is_typescript_enabled)) {
                        .forbidden => {
                            try p.log.addSymbolAlreadyDeclaredError(p.allocator, p.source, symbol.original_name, loc, existing.loc);
                            return existing.ref;
                        },

                        .keep_existing => {
                            ref = existing.ref;
                        },

                        .replace_with_new => {
                            symbol.link = ref;

                            // If these are both functions, remove the overwritten declaration
                            if (kind.isFunction() and symbol.kind.isFunction()) {
                                symbol.remove_overwritten_function_declaration = true;
                            }
                        },

                        .become_private_get_set_pair => {
                            ref = existing.ref;
                            symbol.kind = .private_get_set_pair;
                        },

                        .become_private_static_get_set_pair => {
                            ref = existing.ref;
                            symbol.kind = .private_static_get_set_pair;
                        },

                        .overwrite_with_new => {},
                    }
                } else {
                    p.symbols.items[ref.innerIndex()].link = existing.ref;
                }
            }
            entry.key_ptr.* = name;
            entry.value_ptr.* = js_ast.Scope.Member{ .ref = ref, .loc = loc };
            if (comptime is_generated) {
                try p.module_scope.generated.push(p.allocator, ref);
            }
            return ref;
        }

        pub fn validateFunctionName(p: *P, func: G.Fn, kind: FunctionKind) void {
            if (func.name) |name| {
                const original_name = p.symbols.items[name.ref.?.innerIndex()].original_name;

                if (func.flags.contains(.is_async) and strings.eqlComptime(original_name, "await")) {
                    p.log.addRangeError(
                        p.source,
                        js_lexer.rangeOfIdentifier(p.source, name.loc),
                        "An async function cannot be named \"await\"",
                    ) catch unreachable;
                } else if (kind == .expr and func.flags.contains(.is_generator) and strings.eqlComptime(original_name, "yield")) {
                    p.log.addRangeError(
                        p.source,
                        js_lexer.rangeOfIdentifier(p.source, name.loc),
                        "An generator function expression cannot be named \"yield\"",
                    ) catch unreachable;
                }
            }
        }

        pub fn declareBinding(p: *P, kind: Symbol.Kind, binding: *BindingNodeIndex, opts: *ParseStatementOptions) anyerror!void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |bind| {
                    if (!opts.is_typescript_declare or (opts.is_namespace_scope and opts.is_export)) {
                        bind.ref = try p.declareSymbol(kind, binding.loc, p.loadNameFromRef(bind.ref));
                    }
                },
                .b_array => |bind| {
                    for (bind.items) |*item| {
                        p.declareBinding(kind, &item.binding, opts) catch unreachable;
                    }
                },
                .b_object => |bind| {
                    for (bind.properties) |*prop| {
                        p.declareBinding(kind, &prop.value, opts) catch unreachable;
                    }
                },
            }
        }

        pub fn storeNameInRef(p: *P, name: string) !Ref {
            if (comptime track_symbol_usage_during_parse_pass) {
                if (p.parse_pass_symbol_uses.getPtr(name)) |res| {
                    res.used = true;
                }
            }

            if (@intFromPtr(p.source.contents.ptr) <= @intFromPtr(name.ptr) and (@intFromPtr(name.ptr) + name.len) <= (@intFromPtr(p.source.contents.ptr) + p.source.contents.len)) {
                return Ref.initSourceEnd(.{
                    .source_index = @intCast(@intFromPtr(name.ptr) - @intFromPtr(p.source.contents.ptr)),
                    .inner_index = @intCast(name.len),
                    .tag = .source_contents_slice,
                });
            } else {
                const inner_index: u31 = @intCast(p.allocated_names.items.len);
                try p.allocated_names.append(p.allocator, name);
                return Ref.init(
                    inner_index,
                    p.source.index.get(),
                    false,
                );
            }
        }

        pub fn loadNameFromRef(p: *P, ref: Ref) string {
            return switch (ref.tag) {
                .symbol => p.symbols.items[ref.innerIndex()].original_name,
                .source_contents_slice => p.source.contents[ref.sourceIndex() .. ref.sourceIndex() + ref.innerIndex()],
                .allocated_name => p.allocated_names.items[ref.innerIndex()],
                else => @panic("Internal error: JS parser tried to load an invalid name from a Ref"),
            };
        }

        pub inline fn addImportRecord(p: *P, kind: ImportKind, loc: logger.Loc, name: string) u32 {
            return p.addImportRecordByRange(kind, p.source.rangeOfString(loc), name);
        }

        pub fn addImportRecordByRange(p: *P, kind: ImportKind, range: logger.Range, name: string) u32 {
            return p.addImportRecordByRangeAndPath(kind, range, fs.Path.init(name));
        }

        pub fn addImportRecordByRangeAndPath(p: *P, kind: ImportKind, range: logger.Range, path: fs.Path) u32 {
            const index = p.import_records.items.len;
            const record = ImportRecord{
                .kind = kind,
                .range = range,
                .path = path,
            };
            p.import_records.append(record) catch unreachable;
            return @as(u32, @intCast(index));
        }

        pub fn popScope(noalias p: *P) void {
            const current_scope = p.current_scope;
            // We cannot rename anything inside a scope containing a direct eval() call
            if (current_scope.contains_direct_eval) {
                var iter = current_scope.members.iterator();
                while (iter.next()) |member| {

                    // Using direct eval when bundling is not a good idea in general because
                    // esbuild must assume that it can potentially reach anything in any of
                    // the containing scopes. We try to make it work but this isn't possible
                    // in some cases.
                    //
                    // For example, symbols imported using an ESM import are a live binding
                    // to the underlying symbol in another file. This is emulated during
                    // scope hoisting by erasing the ESM import and just referencing the
                    // underlying symbol in the flattened bundle directly. However, that
                    // symbol may have a different name which could break uses of direct
                    // eval:
                    //
                    //   // Before bundling
                    //   import { foo as bar } from './foo.js'
                    //   console.log(eval('bar'))
                    //
                    //   // After bundling
                    //   let foo = 123 // The contents of "foo.js"
                    //   console.log(eval('bar'))
                    //
                    // There really isn't any way to fix this. You can't just rename "foo" to
                    // "bar" in the example above because there may be a third bundled file
                    // that also contains direct eval and imports the same symbol with a
                    // different conflicting import alias. And there is no way to store a
                    // live binding to the underlying symbol in a variable with the import's
                    // name so that direct eval can access it:
                    //
                    //   // After bundling
                    //   let foo = 123 // The contents of "foo.js"
                    //   const bar = /* cannot express a live binding to "foo" here */
                    //   console.log(eval('bar'))
                    //
                    // Technically a "with" statement could potentially make this work (with
                    // a big hit to performance), but they are deprecated and are unavailable
                    // in strict mode. This is a non-starter since all ESM code is strict mode.
                    //
                    // So while we still try to obey the requirement that all symbol names are
                    // pinned when direct eval is present, we make an exception for top-level
                    // symbols in an ESM file when bundling is enabled. We make no guarantee
                    // that "eval" will be able to reach these symbols and we allow them to be
                    // renamed or removed by tree shaking.
                    // if (p.currentScope.parent == null and p.has_es_module_syntax) {
                    //     continue;
                    // }

                    p.symbols.items[member.value_ptr.ref.innerIndex()].must_not_be_renamed = true;
                }
            }

            p.current_scope = current_scope.parent orelse p.panic("Internal error: attempted to call popScope() on the topmost scope", .{});
        }

        pub fn markExprAsParenthesized(noalias _: *P, expr: *Expr) void {
            switch (expr.data) {
                .e_array => |ex| {
                    ex.is_parenthesized = true;
                },
                .e_object => |ex| {
                    ex.is_parenthesized = true;
                },
                else => {
                    return;
                },
            }
        }

        pub fn panic(p: *P, comptime fmt: string, args: anytype) noreturn {
            @branchHint(.cold);
            p.panicLoc(fmt, args, null);
        }

        pub fn panicLoc(p: *P, comptime fmt: string, args: anytype, loc: ?logger.Loc) noreturn {
            var panic_buffer = p.allocator.alloc(u8, 32 * 1024) catch unreachable;
            var panic_stream = std.io.fixedBufferStream(panic_buffer);

            // panic during visit pass leaves the lexer at the end, which
            // would make this location absolutely useless.
            const location = loc orelse p.lexer.loc();
            if (location.start < p.lexer.source.contents.len and !location.isEmpty()) {
                p.log.addRangeErrorFmt(
                    p.source,
                    .{ .loc = location },
                    p.allocator,
                    "panic here",
                    .{},
                ) catch bun.outOfMemory();
            }

            p.log.level = .verbose;
            p.log.print(panic_stream.writer()) catch unreachable;

            Output.panic(fmt ++ "\n{s}", args ++ .{panic_buffer[0..panic_stream.pos]});
        }

        pub fn jsxStringsToMemberExpression(p: *P, loc: logger.Loc, parts: []const []const u8) !Expr {
            const result = try p.findSymbol(loc, parts[0]);

            const value = p.handleIdentifier(
                loc,
                E.Identifier{
                    .ref = result.ref,
                    .must_keep_due_to_with_stmt = result.is_inside_with_scope,
                    .can_be_removed_if_unused = true,
                },
                parts[0],
                .{
                    .was_originally_identifier = true,
                },
            );
            if (parts.len > 1) {
                return p.memberExpression(loc, value, parts[1..]);
            }

            return value;
        }

        fn memberExpression(p: *P, loc: logger.Loc, initial_value: Expr, parts: []const []const u8) Expr {
            var value = initial_value;

            for (parts) |part| {
                if (p.maybeRewritePropertyAccess(
                    loc,
                    value,
                    part,
                    loc,
                    .{
                        .is_call_target = false,
                        .assign_target = .none,
                        // .is_template_tag = false,
                        .is_delete_target = false,
                    },
                )) |rewrote| {
                    value = rewrote;
                } else {
                    value = p.newExpr(
                        E.Dot{
                            .target = value,
                            .name = part,
                            .name_loc = loc,

                            .can_be_removed_if_unused = p.options.features.dead_code_elimination,
                        },
                        loc,
                    );
                }
            }

            return value;
        }

        pub fn willNeedBindingPattern(noalias p: *const P) bool {
            return switch (p.lexer.token) {
                // "[a] = b;"
                .t_equals => true,
                // "for ([a] in b) {}"
                .t_in => !p.allow_in,
                // "for ([a] of b) {}"
                .t_identifier => !p.allow_in and p.lexer.isContextualKeyword("of"),
                else => false,
            };
        }

        pub fn appendPart(noalias p: *P, parts: *ListManaged(js_ast.Part), stmts: []Stmt) anyerror!void {
            // Reuse the memory if possible
            // This is reusable if the last part turned out to be dead
            p.symbol_uses.clearRetainingCapacity();
            p.declared_symbols.clearRetainingCapacity();
            p.scopes_for_current_part.clearRetainingCapacity();
            p.import_records_for_current_part.clearRetainingCapacity();
            p.import_symbol_property_uses.clearRetainingCapacity();

            p.had_commonjs_named_exports_this_visit = false;

            const allocator = p.allocator;
            var opts = PrependTempRefsOpts{};
            var partStmts = ListManaged(Stmt).fromOwnedSlice(allocator, stmts);

            try p.visitStmtsAndPrependTempRefs(&partStmts, &opts);

            // Insert any relocated variable statements now
            if (p.relocated_top_level_vars.items.len > 0) {
                var already_declared = RefMap{};
                var already_declared_allocator_stack = std.heap.stackFallback(1024, allocator);
                const already_declared_allocator = already_declared_allocator_stack.get();
                defer if (already_declared_allocator_stack.fixed_buffer_allocator.end_index >= 1023) already_declared.deinit(already_declared_allocator);

                for (p.relocated_top_level_vars.items) |*local| {
                    // Follow links because "var" declarations may be merged due to hoisting
                    while (local.ref != null) {
                        var symbol = &p.symbols.items[local.ref.?.innerIndex()];
                        if (!symbol.hasLink()) {
                            break;
                        }
                        local.ref = symbol.link;
                    }
                    const ref = local.ref orelse continue;
                    const declaration_entry = try already_declared.getOrPut(already_declared_allocator, ref);
                    if (!declaration_entry.found_existing) {
                        const decls = try allocator.alloc(G.Decl, 1);
                        decls[0] = Decl{
                            .binding = p.b(B.Identifier{ .ref = ref }, local.loc),
                        };
                        try partStmts.append(p.s(S.Local{ .decls = G.Decl.List.init(decls) }, local.loc));
                        try p.declared_symbols.append(p.allocator, .{ .ref = ref, .is_top_level = true });
                    }
                }
                p.relocated_top_level_vars.clearRetainingCapacity();
            }

            if (partStmts.items.len > 0) {
                const final_stmts = partStmts.items;

                try parts.append(js_ast.Part{
                    .stmts = final_stmts,
                    .symbol_uses = p.symbol_uses,
                    .import_symbol_property_uses = p.import_symbol_property_uses,
                    .declared_symbols = p.declared_symbols.toOwnedSlice(),
                    .import_record_indices = bun.BabyList(u32).init(
                        p.import_records_for_current_part.toOwnedSlice(
                            p.allocator,
                        ) catch unreachable,
                    ),
                    .scopes = try p.scopes_for_current_part.toOwnedSlice(p.allocator),
                    .can_be_removed_if_unused = p.stmtsCanBeRemovedIfUnused(final_stmts),
                    .tag = if (p.had_commonjs_named_exports_this_visit) js_ast.Part.Tag.commonjs_named_export else .none,
                });
                p.symbol_uses = .{};
                p.import_symbol_property_uses = .{};
                p.had_commonjs_named_exports_this_visit = false;
            } else if (p.declared_symbols.len() > 0 or p.symbol_uses.count() > 0) {
                // if the part is dead, invalidate all the usage counts
                p.clearSymbolUsagesFromDeadPart(&.{ .stmts = undefined, .declared_symbols = p.declared_symbols, .symbol_uses = p.symbol_uses });
                p.declared_symbols.clearRetainingCapacity();
                p.import_records_for_current_part.clearRetainingCapacity();
            }
        }

        fn bindingCanBeRemovedIfUnused(p: *P, binding: Binding) bool {
            if (!p.options.features.dead_code_elimination) return false;
            return bindingCanBeRemovedIfUnusedWithoutDCECheck(p, binding);
        }

        fn bindingCanBeRemovedIfUnusedWithoutDCECheck(p: *P, binding: Binding) bool {
            switch (binding.data) {
                .b_array => |bi| {
                    for (bi.items) |*item| {
                        if (!p.bindingCanBeRemovedIfUnusedWithoutDCECheck(item.binding)) {
                            return false;
                        }

                        if (item.default_value) |*default| {
                            if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(default)) {
                                return false;
                            }
                        }
                    }
                },
                .b_object => |bi| {
                    for (bi.properties) |*property| {
                        if (!property.flags.contains(.is_spread) and !p.exprCanBeRemovedIfUnusedWithoutDCECheck(&property.key)) {
                            return false;
                        }

                        if (!p.bindingCanBeRemovedIfUnusedWithoutDCECheck(property.value)) {
                            return false;
                        }

                        if (property.default_value) |*default| {
                            if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(default)) {
                                return false;
                            }
                        }
                    }
                },
                else => {},
            }

            return true;
        }

        fn stmtsCanBeRemovedIfUnused(p: *P, stmts: []Stmt) bool {
            if (!p.options.features.dead_code_elimination) return false;
            return stmtsCanBeRemovedifUnusedWithoutDCECheck(p, stmts);
        }

        fn stmtsCanBeRemovedifUnusedWithoutDCECheck(p: *P, stmts: []Stmt) bool {
            for (stmts) |stmt| {
                switch (stmt.data) {
                    // These never have side effects
                    .s_function, .s_empty => {},

                    // Let these be removed if they are unused. Note that we also need to
                    // check if the imported file is marked as "sideEffects: false" before we
                    // can remove a SImport statement. Otherwise the import must be kept for
                    // its side effects.
                    .s_import => {},

                    .s_class => |st| {
                        if (!p.classCanBeRemovedIfUnused(&st.class)) {
                            return false;
                        }
                    },

                    .s_expr => |st| {
                        if (st.does_not_affect_tree_shaking) {
                            // Expressions marked with this are automatically generated and have
                            // no side effects by construction.
                            continue;
                        }

                        if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(&st.value)) {
                            return false;
                        }
                    },

                    .s_local => |st| {
                        // "await" is a side effect because it affects code timing
                        if (st.kind == .k_await_using) return false;

                        for (st.decls.slice()) |*decl| {
                            if (!p.bindingCanBeRemovedIfUnusedWithoutDCECheck(decl.binding)) {
                                return false;
                            }

                            if (decl.value) |*decl_value| {
                                if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(decl_value)) {
                                    return false;
                                } else if (st.kind == .k_using) {
                                    // "using" declarations are only side-effect free if they are initialized to null or undefined
                                    if (decl_value.data != .e_null and decl_value.data != .e_undefined) {
                                        return false;
                                    }
                                }
                            }
                        }
                    },

                    .s_try => |try_| {
                        if (!p.stmtsCanBeRemovedifUnusedWithoutDCECheck(try_.body) or (try_.finally != null and !p.stmtsCanBeRemovedifUnusedWithoutDCECheck(try_.finally.?.stmts))) {
                            return false;
                        }
                    },

                    // Exports are tracked separately, so this isn't necessary
                    .s_export_clause, .s_export_from => {},

                    .s_export_default => |st| {
                        switch (st.value) {
                            .stmt => |s2| {
                                switch (s2.data) {
                                    .s_expr => |s_expr| {
                                        if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(&s_expr.value)) {
                                            return false;
                                        }
                                    },

                                    // These never have side effects
                                    .s_function => {},

                                    .s_class => {
                                        if (!p.classCanBeRemovedIfUnused(&s2.data.s_class.class)) {
                                            return false;
                                        }
                                    },
                                    else => {
                                        Output.panic("Unexpected type in export default: {any}", .{s2});
                                    },
                                }
                            },
                            .expr => |*exp| {
                                if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(exp)) {
                                    return false;
                                }
                            },
                        }
                    },

                    else => {
                        // Assume that all statements not explicitly special-cased here have side
                        // effects, and cannot be removed even if unused
                        return false;
                    },
                }
            }

            return true;
        }

        pub fn deoptimizeCommonJSNamedExports(p: *P) void {
            // exists for debugging
            p.commonjs_named_exports_deoptimized = true;
        }

        pub fn maybeKeepExprSymbolName(p: *P, expr: Expr, original_name: string, was_anonymous_named_expr: bool) Expr {
            return if (was_anonymous_named_expr) p.keepExprSymbolName(expr, original_name) else expr;
        }

        pub fn valueForThis(p: *P, loc: logger.Loc) ?Expr {
            // Substitute "this" if we're inside a static class property initializer
            if (p.fn_only_data_visit.should_replace_this_with_class_name_ref) {
                if (p.fn_only_data_visit.class_name_ref) |ref| {
                    p.recordUsage(ref.*);
                    return p.newExpr(E.Identifier{ .ref = ref.* }, loc);
                }
            }

            // oroigianlly was !=- modepassthrough
            if (!p.fn_only_data_visit.is_this_nested) {
                if (p.has_es_module_syntax and p.commonjs_named_exports.count() == 0) {
                    // In an ES6 module, "this" is supposed to be undefined. Instead of
                    // doing this at runtime using "fn.call(undefined)", we do it at
                    // compile time using expression substitution here.
                    return Expr{ .loc = loc, .data = nullValueExpr };
                } else {
                    // In a CommonJS module, "this" is supposed to be the same as "exports".
                    // Instead of doing this at runtime using "fn.call(module.exports)", we
                    // do it at compile time using expression substitution here.
                    p.recordUsage(p.exports_ref);
                    p.deoptimizeCommonJSNamedExports();
                    return p.newExpr(E.Identifier{ .ref = p.exports_ref }, loc);
                }
            }

            return null;
        }

        pub fn isValidAssignmentTarget(p: *P, expr: Expr) bool {
            return switch (expr.data) {
                .e_identifier => |ident| !isEvalOrArguments(p.loadNameFromRef(ident.ref)),
                .e_dot => |e| e.optional_chain == null,
                .e_index => |e| e.optional_chain == null,
                .e_array => |e| !e.is_parenthesized,
                .e_object => |e| !e.is_parenthesized,
                else => false,
            };
        }

        const astVisit = @import("ast/visit.zig").Visit(P);
        pub const visitStmtsAndPrependTempRefs = astVisit.visitStmtsAndPrependTempRefs;
        pub const recordDeclaredSymbol = astVisit.recordDeclaredSymbol;
        pub const visitExpr = astVisit.visitExpr;
        pub const visitExprInOut = astVisit.visitExprInOut;
        pub const visitFunc = astVisit.visitFunc;
        pub const visitArgs = astVisit.visitArgs;
        pub const visitTSDecorators = astVisit.visitTSDecorators;
        pub const visitDecls = astVisit.visitDecls;
        pub const visitBindingAndExprForMacro = astVisit.visitBindingAndExprForMacro;
        pub const visitDecl = astVisit.visitDecl;
        pub const visitForLoopInit = astVisit.visitForLoopInit;
        pub const visitBinding = astVisit.visitBinding;
        pub const visitLoopBody = astVisit.visitLoopBody;
        pub const visitSingleStmtBlock = astVisit.visitSingleStmtBlock;
        pub const visitSingleStmt = astVisit.visitSingleStmt;
        pub const visitClass = astVisit.visitClass;
        pub const visitStmts = astVisit.visitStmts;
        pub const visitAndAppendStmt = astVisit.visitAndAppendStmt;

        /// This is only allowed to be called if allow_runtime is true
        /// If --target=bun, this does nothing.
        pub fn recordUsageOfRuntimeRequire(p: *P) void {
            // target bun does not have __require
            if (p.options.features.auto_polyfill_require) {
                bun.assert(p.options.features.allow_runtime);

                p.ensureRequireSymbol();
                p.recordUsage(p.runtimeIdentifierRef(logger.Loc.Empty, "__require"));
            }
        }

        pub fn ignoreUsageOfRuntimeRequire(p: *P) void {
            if (p.options.features.auto_polyfill_require) {
                bun.assert(p.runtime_imports.__require != null);
                p.ignoreUsage(p.runtimeIdentifierRef(logger.Loc.Empty, "__require"));
                p.symbols.items[p.require_ref.innerIndex()].use_count_estimate -|= 1;
            }
        }

        pub inline fn valueForRequire(p: *P, loc: logger.Loc) Expr {
            bun.assert(!p.isSourceRuntime());
            return Expr{
                .data = .{
                    .e_require_call_target = {},
                },
                .loc = loc,
            };
        }

        inline fn valueForImportMetaMain(p: *P, inverted: bool, loc: logger.Loc) Expr {
            if (p.options.import_meta_main_value) |known| {
                return .{ .loc = loc, .data = .{ .e_boolean = .{ .value = if (inverted) !known else known } } };
            } else {
                // Node.js does not have import.meta.main, so we end up lowering
                // this to `require.main === module`, but with the ESM format,
                // both `require` and `module` are not present, so the code
                // generation we need is:
                //
                //     import { createRequire } from "node:module";
                //     var __require = createRequire(import.meta.url);
                //     var import_meta_main = __require.main === __require.module;
                //
                // The printer can handle this for us, but we need to reference
                // a handle to the `__require` function.
                if (p.options.lower_import_meta_main_for_node_js) {
                    p.recordUsageOfRuntimeRequire();
                }

                return .{
                    .loc = loc,
                    .data = .{ .e_import_meta_main = .{ .inverted = inverted } },
                };
            }
        }

        pub fn keepExprSymbolName(_: *P, _value: Expr, _: string) Expr {
            return _value;
            // var start = p.expr_list.items.len;
            // p.expr_list.ensureUnusedCapacity(2) catch unreachable;
            // p.expr_list.appendAssumeCapacity(_value);
            // p.expr_list.appendAssumeCapacity(p.newExpr(E.String{
            //     .utf8 = name,
            // }, _value.loc));

            // var value = p.callRuntime(_value.loc, "ℹ", p.expr_list.items[start..p.expr_list.items.len]);
            // // Make sure tree shaking removes this if the function is never used
            // value.getCall().can_be_unwrapped_if_unused = true;
            // return value;
        }

        pub fn isSimpleParameterList(args: []G.Arg, has_rest_arg: bool) bool {
            if (has_rest_arg) {
                return false;
            }

            for (args) |arg| {
                if (@as(Binding.Tag, arg.binding.data) != .b_identifier or arg.default != null) {
                    return false;
                }
            }

            return true;
        }

        // This one is never called in places that haven't already checked if DCE is enabled.
        pub fn classCanBeRemovedIfUnused(p: *P, class: *G.Class) bool {
            if (class.extends) |*extends| {
                if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(extends)) {
                    return false;
                }
            }

            for (class.properties) |*property| {
                if (property.kind == .class_static_block) {
                    if (!p.stmtsCanBeRemovedifUnusedWithoutDCECheck(property.class_static_block.?.stmts.slice())) {
                        return false;
                    }
                    continue;
                }

                if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(&(property.key orelse unreachable))) {
                    return false;
                }

                if (property.value) |*val| {
                    if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(val)) {
                        return false;
                    }
                }

                if (property.initializer) |*val| {
                    if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(val)) {
                        return false;
                    }
                }
            }

            return true;
        }

        // TODO:
        // When React Fast Refresh is enabled, anything that's a JSX component should not be removable
        // This is to improve the reliability of fast refresh between page loads.
        pub fn exprCanBeRemovedIfUnused(p: *P, expr: *const Expr) bool {
            if (!p.options.features.dead_code_elimination) return false;

            return exprCanBeRemovedIfUnusedWithoutDCECheck(p, expr);
        }

        fn exprCanBeRemovedIfUnusedWithoutDCECheck(p: *P, expr: *const Expr) bool {
            switch (expr.data) {
                .e_null,
                .e_undefined,
                .e_missing,
                .e_boolean,
                .e_number,
                .e_big_int,
                .e_string,
                .e_this,
                .e_reg_exp,
                .e_function,
                .e_arrow,
                .e_import_meta,
                => {
                    return true;
                },

                .e_inlined_enum => |e| return p.exprCanBeRemovedIfUnusedWithoutDCECheck(&e.value),

                .e_dot => |ex| {
                    return ex.can_be_removed_if_unused;
                },
                .e_class => |ex| {
                    return p.classCanBeRemovedIfUnused(ex);
                },
                .e_identifier => |ex| {
                    bun.assert(!ex.ref.isSourceContentsSlice()); // was not visited

                    if (ex.must_keep_due_to_with_stmt) {
                        return false;
                    }

                    // Unbound identifiers cannot be removed because they can have side effects.
                    // One possible side effect is throwing a ReferenceError if they don't exist.
                    // Another one is a getter with side effects on the global object:
                    //
                    //   Object.defineProperty(globalThis, 'x', {
                    //     get() {
                    //       sideEffect();
                    //     },
                    //   });
                    //
                    // Be very careful about this possibility. It's tempting to treat all
                    // identifier expressions as not having side effects but that's wrong. We
                    // must make sure they have been declared by the code we are currently
                    // compiling before we can tell that they have no side effects.
                    //
                    // Note that we currently ignore ReferenceErrors due to TDZ access. This is
                    // incorrect but proper TDZ analysis is very complicated and would have to
                    // be very conservative, which would inhibit a lot of optimizations of code
                    // inside closures. This may need to be revisited if it proves problematic.
                    if (ex.can_be_removed_if_unused or p.symbols.items[ex.ref.innerIndex()].kind != .unbound) {
                        return true;
                    }
                },
                .e_commonjs_export_identifier, .e_import_identifier => {

                    // References to an ES6 import item are always side-effect free in an
                    // ECMAScript environment.
                    //
                    // They could technically have side effects if the imported module is a
                    // CommonJS module and the import item was translated to a property access
                    // (which esbuild's bundler does) and the property has a getter with side
                    // effects.
                    //
                    // But this is very unlikely and respecting this edge case would mean
                    // disabling tree shaking of all code that references an export from a
                    // CommonJS module. It would also likely violate the expectations of some
                    // developers because the code *looks* like it should be able to be tree
                    // shaken.
                    //
                    // So we deliberately ignore this edge case and always treat import item
                    // references as being side-effect free.
                    return true;
                },
                .e_if => |ex| {
                    return p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.test_) and
                        (p.isSideEffectFreeUnboundIdentifierRef(
                            ex.yes,
                            ex.test_,
                            true,
                        ) or
                            p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.yes)) and
                        (p.isSideEffectFreeUnboundIdentifierRef(
                            ex.no,
                            ex.test_,
                            false,
                        ) or p.exprCanBeRemovedIfUnusedWithoutDCECheck(
                            &ex.no,
                        ));
                },
                .e_array => |ex| {
                    for (ex.items.slice()) |*item| {
                        if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(item)) {
                            return false;
                        }
                    }

                    return true;
                },
                .e_object => |ex| {
                    for (ex.properties.slice()) |*property| {

                        // The key must still be evaluated if it's computed or a spread
                        if (property.kind == .spread or (property.flags.contains(.is_computed) and !property.key.?.isPrimitiveLiteral()) or property.flags.contains(.is_spread)) {
                            return false;
                        }

                        if (property.value) |*val| {
                            if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(val)) {
                                return false;
                            }
                        }
                    }
                    return true;
                },
                .e_call => |ex| {
                    // A call that has been marked "__PURE__" can be removed if all arguments
                    // can be removed. The annotation causes us to ignore the target.
                    if (ex.can_be_unwrapped_if_unused) {
                        for (ex.args.slice()) |*arg| {
                            if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(arg)) {
                                return false;
                            }
                        }
                        return true;
                    }
                },
                .e_new => |ex| {

                    // A call that has been marked "__PURE__" can be removed if all arguments
                    // can be removed. The annotation causes us to ignore the target.
                    if (ex.can_be_unwrapped_if_unused) {
                        for (ex.args.slice()) |*arg| {
                            if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(arg)) {
                                return false;
                            }
                        }

                        return true;
                    }
                },
                .e_unary => |ex| {
                    switch (ex.op) {
                        // These operators must not have any type conversions that can execute code
                        // such as "toString" or "valueOf". They must also never throw any exceptions.
                        .un_void, .un_not => {
                            return p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.value);
                        },

                        // The "typeof" operator doesn't do any type conversions so it can be removed
                        // if the result is unused and the operand has no side effects. However, it
                        // has a special case where if the operand is an identifier expression such
                        // as "typeof x" and "x" doesn't exist, no reference error is thrown so the
                        // operation has no side effects.
                        //
                        // Note that there *is* actually a case where "typeof x" can throw an error:
                        // when "x" is being referenced inside of its TDZ (temporal dead zone). TDZ
                        // checks are not yet handled correctly by bun or esbuild, so this possibility is
                        // currently ignored.
                        .un_typeof => {
                            if (ex.value.data == .e_identifier) {
                                return true;
                            }

                            return p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.value);
                        },

                        else => {},
                    }
                },
                .e_binary => |ex| {
                    switch (ex.op) {
                        // These operators must not have any type conversions that can execute code
                        // such as "toString" or "valueOf". They must also never throw any exceptions.
                        .bin_strict_eq,
                        .bin_strict_ne,
                        .bin_comma,
                        .bin_nullish_coalescing,
                        => return p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.left) and p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.right),

                        // Special-case "||" to make sure "typeof x === 'undefined' || x" can be removed
                        .bin_logical_or => return p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.left) and
                            (p.isSideEffectFreeUnboundIdentifierRef(ex.right, ex.left, false) or p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.right)),

                        // Special-case "&&" to make sure "typeof x !== 'undefined' && x" can be removed
                        .bin_logical_and => return p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.left) and
                            (p.isSideEffectFreeUnboundIdentifierRef(ex.right, ex.left, true) or p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.right)),

                        // For "==" and "!=", pretend the operator was actually "===" or "!==". If
                        // we know that we can convert it to "==" or "!=", then we can consider the
                        // operator itself to have no side effects. This matters because our mangle
                        // logic will convert "typeof x === 'object'" into "typeof x == 'object'"
                        // and since "typeof x === 'object'" is considered to be side-effect free,
                        // we must also consider "typeof x == 'object'" to be side-effect free.
                        .bin_loose_eq, .bin_loose_ne => return SideEffects.canChangeStrictToLoose(
                            ex.left.data,
                            ex.right.data,
                        ) and
                            p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.left) and p.exprCanBeRemovedIfUnusedWithoutDCECheck(&ex.right),
                        else => {},
                    }
                },
                .e_template => |templ| {
                    if (templ.tag == null) {
                        for (templ.parts) |part| {
                            if (!p.exprCanBeRemovedIfUnusedWithoutDCECheck(&part.value) or part.value.knownPrimitive() == .unknown) {
                                return false;
                            }
                        }

                        return true;
                    }
                },
                else => {},
            }

            return false;
        }

        // // This is based on exprCanBeRemoved
        // // The main difference: identifiers, functions, arrow functions cause it to return false
        // pub fn exprCanBeHoistedForJSX(p: *P, expr: *const Expr) bool {
        //     if (comptime jsx_transform_type != .react) {
        //         unreachable;
        //     }

        //     switch (expr.data) {
        //         .e_null,
        //         .e_undefined,
        //         .e_missing,
        //         .e_boolean,
        //         .e_number,
        //         .e_big_int,
        //         .e_string,
        //         .e_reg_exp,
        //         => {
        //             return true;
        //         },

        //         .e_dot => |ex| {
        //             return ex.can_be_removed_if_unused;
        //         },
        //         .e_import_identifier => {

        //             // References to an ES6 import item are always side-effect free in an
        //             // ECMAScript environment.
        //             //
        //             // They could technically have side effects if the imported module is a
        //             // CommonJS module and the import item was translated to a property access
        //             // (which esbuild's bundler does) and the property has a getter with side
        //             // effects.
        //             //
        //             // But this is very unlikely and respecting this edge case would mean
        //             // disabling tree shaking of all code that references an export from a
        //             // CommonJS module. It would also likely violate the expectations of some
        //             // developers because the code *looks* like it should be able to be tree
        //             // shaken.
        //             //
        //             // So we deliberately ignore this edge case and always treat import item
        //             // references as being side-effect free.
        //             return true;
        //         },
        //         .e_if => |ex| {
        //             return p.exprCanBeHoistedForJSX(&ex.test_) and
        //                 (p.isSideEffectFreeUnboundIdentifierRef(
        //                 ex.yes,
        //                 ex.test_,
        //                 true,
        //             ) or
        //                 p.exprCanBeHoistedForJSX(&ex.yes)) and
        //                 (p.isSideEffectFreeUnboundIdentifierRef(
        //                 ex.no,
        //                 ex.test_,
        //                 false,
        //             ) or p.exprCanBeHoistedForJSX(
        //                 &ex.no,
        //             ));
        //         },
        //         .e_array => |ex| {
        //             for (ex.items.slice()) |*item| {
        //                 if (!p.exprCanBeHoistedForJSX(item)) {
        //                     return false;
        //                 }
        //             }

        //             return true;
        //         },
        //         .e_object => |ex| {
        //             // macros disable this because macros get inlined
        //             // so it's sort of the opposite of the purpose of this function
        //             if (ex.was_originally_macro)
        //                 return false;

        //             for (ex.properties.slice()) |*property| {

        //                 // The key must still be evaluated if it's computed or a spread
        //                 if (property.kind == .spread or property.flags.contains(.is_computed) or property.flags.contains(.is_spread)) {
        //                     return false;
        //                 }

        //                 if (property.value) |*val| {
        //                     if (!p.exprCanBeHoistedForJSX(val)) {
        //                         return false;
        //                     }
        //                 }
        //             }
        //             return true;
        //         },
        //         .e_call => |ex| {

        //             // A call that has been marked "__PURE__" can be removed if all arguments
        //             // can be removed. The annotation causes us to ignore the target.
        //             if (ex.can_be_unwrapped_if_unused) {
        //                 for (ex.args.slice()) |*arg| {
        //                     if (!p.exprCanBeHoistedForJSX(arg)) {
        //                         return false;
        //                     }
        //                 }
        //                 return true;
        //             }
        //         },
        //         .e_new => |ex| {

        //             // A call that has been marked "__PURE__" can be removed if all arguments
        //             // can be removed. The annotation causes us to ignore the target.
        //             if (ex.can_be_unwrapped_if_unused) {
        //                 for (ex.args.slice()) |*arg| {
        //                     if (!p.exprCanBeHoistedForJSX(arg)) {
        //                         return false;
        //                     }
        //                 }

        //                 return true;
        //             }
        //         },
        //         .e_unary => |ex| {
        //             switch (ex.op) {
        //                 // These operators must not have any type conversions that can execute code
        //                 // such as "toString" or "valueOf". They must also never throw any exceptions.
        //                 .un_void, .un_not => {
        //                     return p.exprCanBeHoistedForJSX(&ex.value);
        //                 },

        //                 // The "typeof" operator doesn't do any type conversions so it can be removed
        //                 // if the result is unused and the operand has no side effects. However, it
        //                 // has a special case where if the operand is an identifier expression such
        //                 // as "typeof x" and "x" doesn't exist, no reference error is thrown so the
        //                 // operation has no side effects.
        //                 //
        //                 // Note that there *is* actually a case where "typeof x" can throw an error:
        //                 // when "x" is being referenced inside of its TDZ (temporal dead zone). TDZ
        //                 // checks are not yet handled correctly by bun or esbuild, so this possibility is
        //                 // currently ignored.
        //                 .un_typeof => {
        //                     if (ex.value.data == .e_identifier) {
        //                         return true;
        //                     }

        //                     return p.exprCanBeHoistedForJSX(&ex.value);
        //                 },

        //                 else => {},
        //             }
        //         },
        //         .e_binary => |ex| {
        //             switch (ex.op) {
        //                 // These operators must not have any type conversions that can execute code
        //                 // such as "toString" or "valueOf". They must also never throw any exceptions.
        //                 .bin_strict_eq,
        //                 .bin_strict_ne,
        //                 .bin_comma,
        //                 .bin_nullish_coalescing,
        //                 => return p.exprCanBeHoistedForJSX(&ex.left) and p.exprCanBeHoistedForJSX(&ex.right),

        //                 // Special-case "||" to make sure "typeof x === 'undefined' || x" can be removed
        //                 .bin_logical_or => return p.exprCanBeHoistedForJSX(&ex.left) and
        //                     (p.isSideEffectFreeUnboundIdentifierRef(ex.right, ex.left, false) or p.exprCanBeHoistedForJSX(&ex.right)),

        //                 // Special-case "&&" to make sure "typeof x !== 'undefined' && x" can be removed
        //                 .bin_logical_and => return p.exprCanBeHoistedForJSX(&ex.left) and
        //                     (p.isSideEffectFreeUnboundIdentifierRef(ex.right, ex.left, true) or p.exprCanBeHoistedForJSX(&ex.right)),

        //                 // For "==" and "!=", pretend the operator was actually "===" or "!==". If
        //                 // we know that we can convert it to "==" or "!=", then we can consider the
        //                 // operator itself to have no side effects. This matters because our mangle
        //                 // logic will convert "typeof x === 'object'" into "typeof x == 'object'"
        //                 // and since "typeof x === 'object'" is considered to be side-effect free,
        //                 // we must also consider "typeof x == 'object'" to be side-effect free.
        //                 .bin_loose_eq, .bin_loose_ne => return SideEffects.canChangeStrictToLoose(
        //                     ex.left.data,
        //                     ex.right.data,
        //                 ) and
        //                     p.exprCanBeHoistedForJSX(&ex.left) and p.exprCanBeHoistedForJSX(&ex.right),
        //                 else => {},
        //             }
        //         },
        //         .e_template => |templ| {
        //             if (templ.tag == null) {
        //                 for (templ.parts) |part| {
        //                     if (!p.exprCanBeHoistedForJSX(&part.value) or part.value.knownPrimitive() == .unknown) {
        //                         return false;
        //                     }
        //                 }
        //             }

        //             return true;
        //         },
        //         else => {},

        //         // These may reference variables from an upper scope
        //         // it's possible to detect that, but we are cutting scope for now
        //         // .e_function,
        //         // .e_arrow,
        //         // .e_this,
        //     }

        //     return false;
        // }

        fn isSideEffectFreeUnboundIdentifierRef(p: *P, value: Expr, guard_condition: Expr, is_yes_branch: bool) bool {
            if (value.data != .e_identifier or
                p.symbols.items[value.data.e_identifier.ref.innerIndex()].kind != .unbound or
                guard_condition.data != .e_binary)
                return false;

            const binary = guard_condition.data.e_binary.*;

            switch (binary.op) {
                .bin_strict_eq, .bin_strict_ne, .bin_loose_eq, .bin_loose_ne => {
                    // typeof x !== 'undefined'
                    var typeof: Expr.Data = binary.left.data;
                    var compare: Expr.Data = binary.right.data;
                    // typeof 'undefined' !== x
                    if (typeof == .e_string) {
                        typeof = binary.right.data;
                        compare = binary.left.data;
                    }

                    // this order because Expr.Data Tag is not a pointer
                    // so it should be slightly faster to compare
                    if (compare != .e_string or
                        typeof != .e_unary)
                        return false;
                    const unary = typeof.e_unary.*;

                    if (unary.op != .un_typeof or unary.value.data != .e_identifier)
                        return false;

                    const id = value.data.e_identifier.ref;
                    const id2 = unary.value.data.e_identifier.ref;
                    return ((compare.e_string.eqlComptime("undefined") == is_yes_branch) ==
                        (binary.op == .bin_strict_ne or binary.op == .bin_loose_ne)) and
                        id.eql(id2);
                },
                else => return false,
            }
        }

        pub fn jsxImportAutomatic(p: *P, loc: logger.Loc, is_static: bool) Expr {
            return p.jsxImport(
                if (is_static and !p.options.jsx.development and FeatureFlags.support_jsxs_in_jsx_transform)
                    .jsxs
                else if (p.options.jsx.development)
                    .jsxDEV
                else
                    .jsx,
                loc,
            );
        }

        pub fn jsxImport(p: *P, kind: JSXImport, loc: logger.Loc) Expr {
            switch (kind) {
                inline else => |field| {
                    const ref: Ref = brk: {
                        if (p.jsx_imports.getWithTag(kind) == null) {
                            const symbol_name = @tagName(field);

                            const loc_ref = LocRef{
                                .loc = loc,
                                .ref = (p.declareGeneratedSymbol(.other, symbol_name) catch unreachable),
                            };

                            p.module_scope.generated.push(p.allocator, loc_ref.ref.?) catch unreachable;
                            p.is_import_item.put(p.allocator, loc_ref.ref.?, {}) catch unreachable;
                            @field(p.jsx_imports, @tagName(field)) = loc_ref;
                            break :brk loc_ref.ref.?;
                        }

                        break :brk p.jsx_imports.getWithTag(kind).?;
                    };

                    p.recordUsage(ref);
                    return p.handleIdentifier(
                        loc,
                        E.Identifier{
                            .ref = ref,
                            .can_be_removed_if_unused = true,
                            .call_can_be_unwrapped_if_unused = true,
                        },
                        null,
                        .{
                            .was_originally_identifier = true,
                        },
                    );
                },
            }
        }

        pub fn selectLocalKind(p: *P, kind: S.Local.Kind) S.Local.Kind {
            // Use "var" instead of "let" and "const" if the variable declaration may
            // need to be separated from the initializer. This allows us to safely move
            // this declaration into a nested scope.
            if ((p.options.bundle or p.will_wrap_module_in_try_catch_for_using) and
                p.current_scope.parent == null and !kind.isUsing())
            {
                return .k_var;
            }

            // Optimization: use "let" instead of "const" because it's shorter. This is
            // only done when bundling because assigning to "const" is only an error when bundling.
            if (p.options.bundle and kind == .k_const and p.options.features.minify_syntax) {
                return .k_let;
            }

            return kind;
        }

        pub fn maybeRelocateVarsToTopLevel(p: *P, decls: []const G.Decl, mode: RelocateVars.Mode) RelocateVars {
            // Only do this when the scope is not already top-level and when we're not inside a function.
            if (p.current_scope == p.module_scope) {
                return .{ .ok = false };
            }

            var scope = p.current_scope;
            while (!scope.kindStopsHoisting()) {
                if (comptime Environment.allow_assert) assert(scope.parent != null);
                scope = scope.parent.?;
            }

            if (scope != p.module_scope) {
                return .{ .ok = false };
            }

            var value: Expr = Expr{ .loc = logger.Loc.Empty, .data = Expr.Data{ .e_missing = E.Missing{} } };

            for (decls) |decl| {
                const binding = Binding.toExpr(
                    &decl.binding,
                    p.to_expr_wrapper_hoisted,
                );
                if (decl.value) |decl_value| {
                    value = value.joinWithComma(Expr.assign(binding, decl_value), p.allocator);
                } else if (mode == .for_in_or_for_of) {
                    value = value.joinWithComma(binding, p.allocator);
                }
            }

            if (value.data == .e_missing) {
                return .{ .ok = true };
            }

            return .{ .stmt = p.s(S.SExpr{ .value = value }, value.loc), .ok = true };
        }

        // EDot nodes represent a property access. This function may return an
        // expression to replace the property access with. It assumes that the
        // target of the EDot expression has already been visited.
        pub fn maybeRewritePropertyAccess(
            p: *P,
            loc: logger.Loc,
            target: js_ast.Expr,
            name: string,
            name_loc: logger.Loc,
            identifier_opts: IdentifierOpts,
        ) ?Expr {
            sw: switch (target.data) {
                .e_identifier => |id| {
                    // Rewrite property accesses on explicit namespace imports as an identifier.
                    // This lets us replace them easily in the printer to rebind them to
                    // something else without paying the cost of a whole-tree traversal during
                    // module linking just to rewrite these EDot expressions.
                    if (p.options.bundle) {
                        if (p.import_items_for_namespace.getPtr(id.ref)) |import_items| {
                            const ref = (import_items.get(name) orelse brk: {
                                // Generate a new import item symbol in the module scope
                                const new_item = LocRef{
                                    .loc = name_loc,
                                    .ref = p.newSymbol(.import, name) catch unreachable,
                                };
                                p.module_scope.generated.push(p.allocator, new_item.ref.?) catch unreachable;

                                import_items.put(name, new_item) catch unreachable;
                                p.is_import_item.put(p.allocator, new_item.ref.?, {}) catch unreachable;

                                var symbol = &p.symbols.items[new_item.ref.?.innerIndex()];

                                // Mark this as generated in case it's missing. We don't want to
                                // generate errors for missing import items that are automatically
                                // generated.
                                symbol.import_item_status = .generated;

                                break :brk new_item;
                            }).ref.?;

                            // Undo the usage count for the namespace itself. This is used later
                            // to detect whether the namespace symbol has ever been "captured"
                            // or whether it has just been used to read properties off of.
                            //
                            // The benefit of doing this is that if both this module and the
                            // imported module end up in the same module group and the namespace
                            // symbol has never been captured, then we don't need to generate
                            // any code for the namespace at all.
                            p.ignoreUsage(id.ref);

                            // Track how many times we've referenced this symbol
                            p.recordUsage(ref);

                            return p.handleIdentifier(
                                name_loc,
                                E.Identifier{ .ref = ref },
                                name,
                                .{
                                    .assign_target = identifier_opts.assign_target,
                                    .is_call_target = identifier_opts.is_call_target,
                                    .is_delete_target = identifier_opts.is_delete_target,

                                    // If this expression is used as the target of a call expression, make
                                    // sure the value of "this" is preserved.
                                    .was_originally_identifier = false,
                                },
                            );
                        }
                    }

                    if (!p.is_control_flow_dead and id.ref.eql(p.module_ref)) {
                        // Rewrite "module.require()" to "require()" for Webpack compatibility.
                        // See https://github.com/webpack/webpack/pull/7750 for more info.
                        // This also makes correctness a little easier.
                        if (identifier_opts.is_call_target and strings.eqlComptime(name, "require")) {
                            p.ignoreUsage(p.module_ref);
                            return p.valueForRequire(name_loc);
                        } else if (!p.commonjs_named_exports_deoptimized and strings.eqlComptime(name, "exports")) {
                            if (identifier_opts.assign_target != .none) {
                                p.commonjs_module_exports_assigned_deoptimized = true;
                            }

                            // Detect if we are doing
                            //
                            //  module.exports = {
                            //    foo: "bar"
                            //  }
                            //
                            //  Note that it cannot be any of these:
                            //
                            //  module.exports += { };
                            //  delete module.exports = {};
                            //  module.exports()
                            if (!(identifier_opts.is_call_target or identifier_opts.is_delete_target) and
                                identifier_opts.assign_target == .replace and
                                p.stmt_expr_value == .e_binary and
                                p.stmt_expr_value.e_binary.op == .bin_assign)
                            {
                                if (
                                // if it's not top-level, don't do this
                                p.module_scope != p.current_scope or
                                    // if you do
                                    //
                                    // exports.foo = 123;
                                    // module.exports = {};
                                    //
                                    // that's a de-opt.
                                    p.commonjs_named_exports.count() > 0 or

                                    // anything which is not module.exports = {} is a de-opt.
                                    p.stmt_expr_value.e_binary.right.data != .e_object or
                                    p.stmt_expr_value.e_binary.left.data != .e_dot or
                                    !strings.eqlComptime(p.stmt_expr_value.e_binary.left.data.e_dot.name, "exports") or
                                    p.stmt_expr_value.e_binary.left.data.e_dot.target.data != .e_identifier or
                                    !p.stmt_expr_value.e_binary.left.data.e_dot.target.data.e_identifier.ref.eql(p.module_ref))
                                {
                                    p.deoptimizeCommonJSNamedExports();
                                    return null;
                                }

                                const props: []const G.Property = p.stmt_expr_value.e_binary.right.data.e_object.properties.slice();
                                for (props) |prop| {
                                    // if it's not a trivial object literal, de-opt
                                    if (prop.kind != .normal or
                                        prop.key == null or
                                        prop.key.?.data != .e_string or
                                        prop.flags.contains(Flags.Property.is_method) or
                                        prop.flags.contains(Flags.Property.is_computed) or
                                        prop.flags.contains(Flags.Property.is_spread) or
                                        prop.flags.contains(Flags.Property.is_static) or
                                        // If it creates a new scope, we can't do this optimization right now
                                        // Our scope order verification stuff will get mad
                                        // But we should let you do module.exports = { bar: foo(), baz: 123 }
                                        // just not module.exports = { bar: function() {}  }
                                        // just not module.exports = { bar() {}  }
                                        switch (prop.value.?.data) {
                                            .e_commonjs_export_identifier, .e_import_identifier, .e_identifier => false,
                                            .e_call => |call| switch (call.target.data) {
                                                .e_commonjs_export_identifier, .e_import_identifier, .e_identifier => false,
                                                else => |call_target| !@as(Expr.Tag, call_target).isPrimitiveLiteral(),
                                            },
                                            else => !prop.value.?.isPrimitiveLiteral(),
                                        })
                                    {
                                        p.deoptimizeCommonJSNamedExports();
                                        return null;
                                    }
                                } else {
                                    // empty object de-opts because otherwise the statement becomes
                                    // <empty space> = {};
                                    p.deoptimizeCommonJSNamedExports();
                                    return null;
                                }

                                var stmts = std.ArrayList(Stmt).initCapacity(p.allocator, props.len * 2) catch unreachable;
                                var decls = p.allocator.alloc(Decl, props.len) catch unreachable;
                                var clause_items = p.allocator.alloc(js_ast.ClauseItem, props.len) catch unreachable;

                                for (props) |prop| {
                                    const key = prop.key.?.data.e_string.string(p.allocator) catch unreachable;
                                    const visited_value = p.visitExpr(prop.value.?);
                                    const value = SideEffects.simplifyUnusedExpr(p, visited_value) orelse visited_value;

                                    // We are doing `module.exports = { ... }`
                                    // lets rewrite it to a series of what will become export assignments
                                    const named_export_entry = p.commonjs_named_exports.getOrPut(p.allocator, key) catch unreachable;
                                    if (!named_export_entry.found_existing) {
                                        const new_ref = p.newSymbol(
                                            .other,
                                            std.fmt.allocPrint(p.allocator, "${any}", .{bun.fmt.fmtIdentifier(key)}) catch unreachable,
                                        ) catch unreachable;
                                        p.module_scope.generated.push(p.allocator, new_ref) catch unreachable;
                                        named_export_entry.value_ptr.* = .{
                                            .loc_ref = LocRef{
                                                .loc = name_loc,
                                                .ref = new_ref,
                                            },
                                            .needs_decl = false,
                                        };
                                    }
                                    const ref = named_export_entry.value_ptr.loc_ref.ref.?;
                                    // module.exports = {
                                    //   foo: "bar",
                                    //   baz: "qux",
                                    // }
                                    // ->
                                    // exports.foo = "bar", exports.baz = "qux"
                                    // Which will become
                                    // $foo = "bar";
                                    // $baz = "qux";
                                    // export { $foo as foo, $baz as baz }

                                    decls[0] = .{
                                        .binding = p.b(B.Identifier{ .ref = ref }, prop.key.?.loc),
                                        .value = value,
                                    };
                                    // we have to ensure these are known to be top-level
                                    p.declared_symbols.append(p.allocator, .{
                                        .ref = ref,
                                        .is_top_level = true,
                                    }) catch unreachable;
                                    p.had_commonjs_named_exports_this_visit = true;
                                    clause_items[0] = js_ast.ClauseItem{
                                        // We want the generated name to not conflict
                                        .alias = key,
                                        .alias_loc = prop.key.?.loc,
                                        .name = named_export_entry.value_ptr.loc_ref,
                                    };

                                    stmts.appendSlice(
                                        &[_]Stmt{
                                            p.s(
                                                S.Local{
                                                    .kind = .k_var,
                                                    .is_export = false,
                                                    .was_commonjs_export = true,
                                                    .decls = G.Decl.List.init(decls[0..1]),
                                                },
                                                prop.key.?.loc,
                                            ),
                                            p.s(
                                                S.ExportClause{
                                                    .items = clause_items[0..1],
                                                    .is_single_line = true,
                                                },
                                                prop.key.?.loc,
                                            ),
                                        },
                                    ) catch unreachable;
                                    decls = decls[1..];
                                    clause_items = clause_items[1..];
                                }

                                p.ignoreUsage(p.module_ref);
                                p.commonjs_replacement_stmts = stmts.items;
                                return p.newExpr(E.Missing{}, name_loc);
                            }

                            // Deoptimizations:
                            //      delete module.exports
                            //      module.exports();
                            if (identifier_opts.is_call_target or identifier_opts.is_delete_target or identifier_opts.assign_target != .none) {
                                p.deoptimizeCommonJSNamedExports();
                                return null;
                            }

                            // rewrite `module.exports` to `exports`
                            return .{ .data = .{ .e_special = .module_exports }, .loc = name_loc };
                        } else if (p.options.bundle and strings.eqlComptime(name, "id") and identifier_opts.assign_target == .none) {
                            // inline module.id
                            p.ignoreUsage(p.module_ref);
                            return p.newExpr(E.String.init(p.source.path.pretty), name_loc);
                        } else if (p.options.bundle and strings.eqlComptime(name, "filename") and identifier_opts.assign_target == .none) {
                            // inline module.filename
                            p.ignoreUsage(p.module_ref);
                            return p.newExpr(E.String.init(p.source.path.name.filename), name_loc);
                        } else if (p.options.bundle and strings.eqlComptime(name, "path") and identifier_opts.assign_target == .none) {
                            // inline module.path
                            p.ignoreUsage(p.module_ref);
                            return p.newExpr(E.String.init(p.source.path.pretty), name_loc);
                        }
                    }

                    if (p.shouldUnwrapCommonJSToESM()) {
                        if (!p.is_control_flow_dead and id.ref.eql(p.exports_ref)) {
                            if (!p.commonjs_named_exports_deoptimized) {
                                if (identifier_opts.is_delete_target) {
                                    p.deoptimizeCommonJSNamedExports();
                                    return null;
                                }

                                const named_export_entry = p.commonjs_named_exports.getOrPut(p.allocator, name) catch unreachable;
                                if (!named_export_entry.found_existing) {
                                    const new_ref = p.newSymbol(
                                        .other,
                                        std.fmt.allocPrint(p.allocator, "${any}", .{bun.fmt.fmtIdentifier(name)}) catch unreachable,
                                    ) catch unreachable;
                                    p.module_scope.generated.push(p.allocator, new_ref) catch unreachable;
                                    named_export_entry.value_ptr.* = .{
                                        .loc_ref = LocRef{
                                            .loc = name_loc,
                                            .ref = new_ref,
                                        },
                                        .needs_decl = true,
                                    };
                                    if (p.commonjs_named_exports_needs_conversion == std.math.maxInt(u32))
                                        p.commonjs_named_exports_needs_conversion = @as(u32, @truncate(p.commonjs_named_exports.count() - 1));
                                }

                                const ref = named_export_entry.value_ptr.*.loc_ref.ref.?;
                                p.ignoreUsage(id.ref);
                                p.recordUsage(ref);

                                return p.newExpr(
                                    E.CommonJSExportIdentifier{
                                        .ref = ref,
                                    },
                                    name_loc,
                                );
                            } else if (p.options.features.commonjs_at_runtime and identifier_opts.assign_target != .none) {
                                p.has_commonjs_export_names = true;
                            }
                        }
                    }

                    // Handle references to namespaces or namespace members
                    if (p.ts_namespace.expr == .e_identifier and
                        id.ref.eql(p.ts_namespace.expr.e_identifier.ref) and
                        identifier_opts.assign_target == .none and
                        !identifier_opts.is_delete_target)
                    {
                        return p.maybeRewritePropertyAccessForNamespace(name, &target, loc, name_loc);
                    }
                },
                .e_string => |str| {
                    if (p.options.features.minify_syntax) {
                        // minify "long-string".length to 11
                        if (strings.eqlComptime(name, "length")) {
                            if (str.javascriptLength()) |len| {
                                return p.newExpr(E.Number{ .value = @floatFromInt(len) }, loc);
                            }
                        }
                    }
                },
                .e_inlined_enum => |ie| {
                    continue :sw ie.value.data;
                },
                .e_object => |obj| {
                    if (comptime FeatureFlags.inline_properties_in_transpiler) {
                        if (p.options.features.minify_syntax) {
                            // Rewrite a property access like this:
                            //   { f: () => {} }.f
                            // To:
                            //   () => {}
                            //
                            // To avoid thinking too much about edgecases, only do this for:
                            //   1) Objects with a single property
                            //   2) Not a method, not a computed property
                            if (obj.properties.len == 1 and
                                !identifier_opts.is_delete_target and
                                identifier_opts.assign_target == .none and !identifier_opts.is_call_target)
                            {
                                const prop: G.Property = obj.properties.ptr[0];
                                if (prop.value != null and
                                    prop.flags.count() == 0 and
                                    prop.key != null and
                                    prop.key.?.data == .e_string and
                                    prop.key.?.data.e_string.eql([]const u8, name) and
                                    !bun.strings.eqlComptime(name, "__proto__"))
                                {
                                    return prop.value.?;
                                }
                            }
                        }
                    }
                },
                .e_import_meta => {
                    if (strings.eqlComptime(name, "main")) {
                        return p.valueForImportMetaMain(false, target.loc);
                    }

                    if (strings.eqlComptime(name, "hot")) {
                        return .{ .data = .{
                            .e_special = if (p.options.features.hot_module_reloading) .hot_enabled else .hot_disabled,
                        }, .loc = loc };
                    }

                    // Make all property accesses on `import.meta.url` side effect free.
                    return p.newExpr(
                        E.Dot{
                            .target = target,
                            .name = name,
                            .name_loc = name_loc,
                            .can_be_removed_if_unused = true,
                        },
                        target.loc,
                    );
                },
                .e_require_call_target => {
                    if (strings.eqlComptime(name, "main")) {
                        return .{ .loc = loc, .data = .e_require_main };
                    }
                },
                .e_import_identifier => |id| {
                    // Symbol uses due to a property access off of an imported symbol are tracked
                    // specially. This lets us do tree shaking for cross-file TypeScript enums.
                    if (p.options.bundle and !p.is_control_flow_dead) {
                        const use = p.symbol_uses.getPtr(id.ref).?;
                        use.count_estimate -|= 1;
                        // note: this use is not removed as we assume it exists later

                        // Add a special symbol use instead
                        const gop = p.import_symbol_property_uses.getOrPutValue(
                            p.allocator,
                            id.ref,
                            .{},
                        ) catch bun.outOfMemory();
                        const inner_use = gop.value_ptr.getOrPutValue(
                            p.allocator,
                            name,
                            .{},
                        ) catch bun.outOfMemory();
                        inner_use.value_ptr.count_estimate += 1;
                    }
                },
                inline .e_dot, .e_index => |data, tag| {
                    if (p.ts_namespace.expr == tag and
                        data == @field(p.ts_namespace.expr, @tagName(tag)) and
                        identifier_opts.assign_target == .none and
                        !identifier_opts.is_delete_target)
                    {
                        return p.maybeRewritePropertyAccessForNamespace(name, &target, loc, name_loc);
                    }
                },
                .e_special => |special| switch (special) {
                    .module_exports => {
                        if (p.shouldUnwrapCommonJSToESM()) {
                            if (!p.is_control_flow_dead) {
                                if (!p.commonjs_named_exports_deoptimized) {
                                    if (identifier_opts.is_delete_target) {
                                        p.deoptimizeCommonJSNamedExports();
                                        return null;
                                    }

                                    const named_export_entry = p.commonjs_named_exports.getOrPut(p.allocator, name) catch unreachable;
                                    if (!named_export_entry.found_existing) {
                                        const new_ref = p.newSymbol(
                                            .other,
                                            std.fmt.allocPrint(p.allocator, "${any}", .{bun.fmt.fmtIdentifier(name)}) catch unreachable,
                                        ) catch unreachable;
                                        p.module_scope.generated.push(p.allocator, new_ref) catch unreachable;
                                        named_export_entry.value_ptr.* = .{
                                            .loc_ref = LocRef{
                                                .loc = name_loc,
                                                .ref = new_ref,
                                            },
                                            .needs_decl = true,
                                        };
                                        if (p.commonjs_named_exports_needs_conversion == std.math.maxInt(u32))
                                            p.commonjs_named_exports_needs_conversion = @as(u32, @truncate(p.commonjs_named_exports.count() - 1));
                                    }

                                    const ref = named_export_entry.value_ptr.*.loc_ref.ref.?;
                                    p.recordUsage(ref);

                                    return p.newExpr(
                                        E.CommonJSExportIdentifier{
                                            .ref = ref,
                                            // Record this as from module.exports
                                            .base = .module_dot_exports,
                                        },
                                        name_loc,
                                    );
                                } else if (p.options.features.commonjs_at_runtime and identifier_opts.assign_target != .none) {
                                    p.has_commonjs_export_names = true;
                                }
                            }
                        }
                    },
                    .hot_enabled, .hot_disabled => {
                        const enabled = p.options.features.hot_module_reloading;
                        if (bun.strings.eqlComptime(name, "data")) {
                            return if (enabled)
                                .{ .data = .{ .e_special = .hot_data }, .loc = loc }
                            else
                                Expr.init(E.Object, .{}, loc);
                        }
                        if (bun.strings.eqlComptime(name, "accept")) {
                            if (!enabled) {
                                p.method_call_must_be_replaced_with_undefined = true;
                                return .{ .data = .e_undefined, .loc = loc };
                            }
                            return .{ .data = .{
                                .e_special = .hot_accept,
                            }, .loc = loc };
                        }
                        const lookup_table = comptime bun.ComptimeStringMap(void, [_]struct { [:0]const u8, void }{
                            .{ "decline", {} },
                            .{ "dispose", {} },
                            .{ "prune", {} },
                            .{ "invalidate", {} },
                            .{ "on", {} },
                            .{ "off", {} },
                            .{ "send", {} },
                        });
                        if (lookup_table.has(name)) {
                            if (enabled) {
                                return Expr.init(E.Dot, .{
                                    .target = Expr.initIdentifier(p.hmr_api_ref, target.loc),
                                    .name = name,
                                    .name_loc = name_loc,
                                }, loc);
                            } else {
                                p.method_call_must_be_replaced_with_undefined = true;
                                return .{ .data = .e_undefined, .loc = loc };
                            }
                        } else {
                            // This error is a bit out of place since the HMR
                            // API is validated in the parser instead of at
                            // runtime. When the API is not validated in this
                            // way, the developer may unintentionally read or
                            // write internal fields of HMRModule.
                            p.log.addError(
                                p.source,
                                loc,
                                std.fmt.allocPrint(
                                    p.allocator,
                                    "import.meta.hot.{s} does not exist",
                                    .{name},
                                ) catch bun.outOfMemory(),
                            ) catch bun.outOfMemory();
                            return .{ .data = .e_undefined, .loc = loc };
                        }
                    },
                    else => {},
                },
                else => {},
            }

            return null;
        }

        fn maybeRewritePropertyAccessForNamespace(
            p: *P,
            name: string,
            target: *const Expr,
            loc: logger.Loc,
            name_loc: logger.Loc,
        ) ?Expr {
            if (p.ts_namespace.map.?.get(name)) |value| {
                switch (value.data) {
                    .enum_number => |num| {
                        p.ignoreUsageOfIdentifierInDotChain(target.*);
                        return p.wrapInlinedEnum(
                            .{ .loc = loc, .data = .{ .e_number = .{ .value = num } } },
                            name,
                        );
                    },

                    .enum_string => |str| {
                        p.ignoreUsageOfIdentifierInDotChain(target.*);
                        return p.wrapInlinedEnum(
                            .{ .loc = loc, .data = .{ .e_string = str } },
                            name,
                        );
                    },

                    .namespace => |namespace| {
                        // If this isn't a constant, return a clone of this property access
                        // but with the namespace member data associated with it so that
                        // more property accesses off of this property access are recognized.
                        const expr = if (js_lexer.isIdentifier(name))
                            p.newExpr(E.Dot{
                                .target = target.*,
                                .name = name,
                                .name_loc = name_loc,
                            }, loc)
                        else
                            p.newExpr(E.Dot{
                                .target = target.*,
                                .name = name,
                                .name_loc = name_loc,
                            }, loc);

                        p.ts_namespace = .{
                            .expr = expr.data,
                            .map = namespace,
                        };

                        return expr;
                    },

                    else => {},
                }
            }

            return null;
        }

        pub fn ignoreUsage(p: *P, ref: Ref) void {
            if (!p.is_control_flow_dead and !p.is_revisit_for_substitution) {
                if (comptime Environment.allow_assert) assert(@as(usize, ref.innerIndex()) < p.symbols.items.len);
                p.symbols.items[ref.innerIndex()].use_count_estimate -|= 1;
                var use = p.symbol_uses.get(ref) orelse return;
                use.count_estimate -|= 1;
                if (use.count_estimate == 0) {
                    _ = p.symbol_uses.swapRemove(ref);
                } else {
                    p.symbol_uses.putAssumeCapacity(ref, use);
                }
            }

            // Don't roll back the "tsUseCounts" increment. This must be counted even if
            // the value is ignored because that's what the TypeScript compiler does.
        }

        pub fn ignoreUsageOfIdentifierInDotChain(p: *P, expr: Expr) void {
            var current = expr;
            while (true) {
                switch (current.data) {
                    .e_identifier => |id| {
                        p.ignoreUsage(id.ref);
                    },
                    .e_dot => |dot| {
                        current = dot.target;
                        continue;
                    },
                    .e_index => |index| {
                        if (index.index.isString()) {
                            current = index.target;
                            continue;
                        }
                    },
                    else => return,
                }

                return;
            }
        }

        pub fn isExportToEliminate(p: *P, ref: Ref) bool {
            const symbol_name = p.loadNameFromRef(ref);
            return p.options.features.replace_exports.contains(symbol_name);
        }

        pub fn injectReplacementExport(p: *P, stmts: *StmtList, name_ref: Ref, loc: logger.Loc, replacement: *const RuntimeFeatures.ReplaceableExport) bool {
            switch (replacement.*) {
                .delete => return false,
                .replace => |value| {
                    const count = stmts.items.len;
                    var decls = p.allocator.alloc(G.Decl, 1) catch unreachable;

                    decls[0] = .{ .binding = p.b(B.Identifier{ .ref = name_ref }, loc), .value = value };
                    var local = p.s(
                        S.Local{
                            .is_export = true,
                            .decls = Decl.List.init(decls),
                        },
                        loc,
                    );
                    p.visitAndAppendStmt(stmts, &local) catch unreachable;
                    return count != stmts.items.len;
                },
                .inject => |with| {
                    const count = stmts.items.len;
                    var decls = p.allocator.alloc(G.Decl, 1) catch unreachable;
                    decls[0] = .{
                        .binding = p.b(
                            B.Identifier{ .ref = p.declareSymbol(.other, loc, with.name) catch unreachable },
                            loc,
                        ),
                        .value = with.value,
                    };

                    var local = p.s(
                        S.Local{
                            .is_export = true,
                            .decls = Decl.List.init(decls),
                        },
                        loc,
                    );
                    p.visitAndAppendStmt(stmts, &local) catch unreachable;
                    return count != stmts.items.len;
                },
            }
        }

        pub fn replaceDeclAndPossiblyRemove(p: *P, decl: *G.Decl, replacement: *const RuntimeFeatures.ReplaceableExport) bool {
            switch (replacement.*) {
                .delete => return false,
                .replace => |value| {
                    decl.*.value = p.visitExpr(value);
                    return true;
                },
                .inject => |with| {
                    decl.* = .{
                        .binding = p.b(
                            B.Identifier{ .ref = p.declareSymbol(.other, decl.binding.loc, with.name) catch unreachable },
                            decl.binding.loc,
                        ),
                        .value = p.visitExpr(Expr{ .data = with.value.data, .loc = if (decl.value != null) decl.value.?.loc else decl.binding.loc }),
                    };
                    return true;
                },
            }
        }

        pub fn markExportedDeclsInsideNamespace(p: *P, ns_ref: Ref, decls: []G.Decl) void {
            for (decls) |decl| {
                p.markExportedBindingInsideNamespace(ns_ref, decl.binding);
            }
        }

        pub fn appendIfBodyPreservingScope(noalias p: *P, stmts: *ListManaged(Stmt), body: Stmt) anyerror!void {
            switch (body.data) {
                .s_block => |block| {
                    var keep_block = false;
                    for (block.stmts) |stmt| {
                        if (statementCaresAboutScope(stmt)) {
                            keep_block = true;
                            break;
                        }
                    }

                    if (!keep_block and block.stmts.len > 0) {
                        try stmts.appendSlice(block.stmts);
                        return;
                    }
                },
                else => {},
            }

            if (statementCaresAboutScope(body)) {
                var block_stmts = try p.allocator.alloc(Stmt, 1);
                block_stmts[0] = body;
                try stmts.append(p.s(S.Block{ .stmts = block_stmts }, body.loc));
                return;
            }

            try stmts.append(body);
            return;
        }

        fn markExportedBindingInsideNamespace(p: *P, ref: Ref, binding: BindingNodeIndex) void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |ident| {
                    p.is_exported_inside_namespace.put(p.allocator, ident.ref, ref) catch unreachable;
                },
                .b_array => |array| {
                    for (array.items) |item| {
                        p.markExportedBindingInsideNamespace(ref, item.binding);
                    }
                },
                .b_object => |obj| {
                    for (obj.properties) |item| {
                        p.markExportedBindingInsideNamespace(ref, item.value);
                    }
                },
            }
        }

        pub fn generateClosureForTypeScriptNamespaceOrEnum(
            noalias p: *P,
            noalias stmts: *ListManaged(Stmt),
            stmt_loc: logger.Loc,
            is_export: bool,
            name_loc: logger.Loc,
            original_name_ref: Ref,
            arg_ref: Ref,
            stmts_inside_closure: []Stmt,
            all_values_are_pure: bool,
        ) anyerror!void {
            var name_ref = original_name_ref;

            // Follow the link chain in case symbols were merged
            var symbol: Symbol = p.symbols.items[name_ref.innerIndex()];
            while (symbol.hasLink()) {
                const link = symbol.link;
                name_ref = link;
                symbol = p.symbols.items[name_ref.innerIndex()];
            }
            const allocator = p.allocator;

            // Make sure to only emit a variable once for a given namespace, since there
            // can be multiple namespace blocks for the same namespace
            if ((symbol.kind == .ts_namespace or symbol.kind == .ts_enum) and
                !p.emitted_namespace_vars.contains(name_ref))
            {
                p.emitted_namespace_vars.putNoClobber(allocator, name_ref, {}) catch bun.outOfMemory();

                var decls = allocator.alloc(G.Decl, 1) catch bun.outOfMemory();
                decls[0] = G.Decl{ .binding = p.b(B.Identifier{ .ref = name_ref }, name_loc) };

                if (p.enclosing_namespace_arg_ref == null) {
                    // Top-level namespace: "var"
                    stmts.append(
                        p.s(S.Local{
                            .kind = .k_var,
                            .decls = G.Decl.List.init(decls),
                            .is_export = is_export,
                        }, stmt_loc),
                    ) catch bun.outOfMemory();
                } else {
                    // Nested namespace: "let"
                    stmts.append(
                        p.s(S.Local{
                            .kind = .k_let,
                            .decls = G.Decl.List.init(decls),
                        }, stmt_loc),
                    ) catch bun.outOfMemory();
                }
            }

            const arg_expr: Expr = arg_expr: {
                // TODO: unsupportedJSFeatures.has(.logical_assignment)
                // If the "||=" operator is supported, our minified output can be slightly smaller
                if (is_export) if (p.enclosing_namespace_arg_ref) |namespace| {
                    const name = p.symbols.items[name_ref.innerIndex()].original_name;

                    // "name = (enclosing.name ||= {})"
                    p.recordUsage(namespace);
                    p.recordUsage(name_ref);
                    break :arg_expr Expr.assign(
                        Expr.initIdentifier(name_ref, name_loc),
                        p.newExpr(E.Binary{
                            .op = .bin_logical_or_assign,
                            .left = p.newExpr(
                                E.Dot{
                                    .target = Expr.initIdentifier(namespace, name_loc),
                                    .name = name,
                                    .name_loc = name_loc,
                                },
                                name_loc,
                            ),
                            .right = p.newExpr(E.Object{}, name_loc),
                        }, name_loc),
                    );
                };

                // "name ||= {}"
                p.recordUsage(name_ref);
                break :arg_expr p.newExpr(E.Binary{
                    .op = .bin_logical_or_assign,
                    .left = Expr.initIdentifier(name_ref, name_loc),
                    .right = p.newExpr(E.Object{}, name_loc),
                }, name_loc);
            };

            var func_args = allocator.alloc(G.Arg, 1) catch bun.outOfMemory();
            func_args[0] = .{ .binding = p.b(B.Identifier{ .ref = arg_ref }, name_loc) };

            var args_list = allocator.alloc(ExprNodeIndex, 1) catch bun.outOfMemory();
            args_list[0] = arg_expr;

            // TODO: if unsupported features includes arrow functions
            // const target = p.newExpr(
            //     E.Function{ .func = .{
            //         .args = func_args,
            //         .name = null,
            //         .open_parens_loc = stmt_loc,
            //         .body = G.FnBody{
            //             .loc = stmt_loc,
            //             .stmts = try allocator.dupe(StmtNodeIndex, stmts_inside_closure),
            //         },
            //     } },
            //     stmt_loc,
            // );

            const target = target: {
                // "(() => { foo() })()" => "(() => foo())()"
                if (p.options.features.minify_syntax and stmts_inside_closure.len == 1) {
                    if (stmts_inside_closure[0].data == .s_expr) {
                        stmts_inside_closure[0] = p.s(S.Return{
                            .value = stmts_inside_closure[0].data.s_expr.value,
                        }, stmts_inside_closure[0].loc);
                    }
                }

                break :target p.newExpr(E.Arrow{
                    .args = func_args,
                    .body = .{
                        .loc = stmt_loc,
                        .stmts = try allocator.dupe(StmtNodeIndex, stmts_inside_closure),
                    },
                    .prefer_expr = true,
                }, stmt_loc);
            };

            // Call the closure with the name object
            const call = p.newExpr(
                E.Call{
                    .target = target,
                    .args = ExprNodeList.init(args_list),
                    // TODO: make these fully tree-shakable. this annotation
                    // as-is is incorrect.  This would be done by changing all
                    // enum wrappers into `var Enum = ...` instead of two
                    // separate statements. This way, the @__PURE__ annotation
                    // is attached to the variable binding.
                    //
                    // .can_be_unwrapped_if_unused = all_values_are_pure,
                },
                stmt_loc,
            );

            const closure = p.s(S.SExpr{
                .value = call,
                .does_not_affect_tree_shaking = all_values_are_pure,
            }, stmt_loc);

            stmts.append(closure) catch unreachable;
        }

        pub fn lowerClass(
            noalias p: *P,
            stmtorexpr: js_ast.StmtOrExpr,
        ) []Stmt {
            switch (stmtorexpr) {
                .stmt => |stmt| {
                    if (comptime !is_typescript_enabled) {
                        if (!stmt.data.s_class.class.has_decorators) {
                            var stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                            stmts[0] = stmt;
                            return stmts;
                        }
                    }
                    var class = &stmt.data.s_class.class;
                    var constructor_function: ?*E.Function = null;

                    var static_decorators = ListManaged(Stmt).init(p.allocator);
                    var instance_decorators = ListManaged(Stmt).init(p.allocator);
                    var instance_members = ListManaged(Stmt).init(p.allocator);
                    var static_members = ListManaged(Stmt).init(p.allocator);
                    var class_properties = ListManaged(Property).init(p.allocator);

                    for (class.properties) |*prop| {
                        // merge parameter decorators with method decorators
                        if (prop.flags.contains(.is_method)) {
                            if (prop.value) |prop_value| {
                                switch (prop_value.data) {
                                    .e_function => |func| {
                                        const is_constructor = (prop.key.?.data == .e_string and prop.key.?.data.e_string.eqlComptime("constructor"));

                                        if (is_constructor) constructor_function = func;

                                        for (func.func.args, 0..) |arg, i| {
                                            for (arg.ts_decorators.ptr[0..arg.ts_decorators.len]) |arg_decorator| {
                                                var decorators = if (is_constructor)
                                                    class.ts_decorators.listManaged(p.allocator)
                                                else
                                                    prop.ts_decorators.listManaged(p.allocator);
                                                const args = p.allocator.alloc(Expr, 2) catch unreachable;
                                                args[0] = p.newExpr(E.Number{ .value = @as(f64, @floatFromInt(i)) }, arg_decorator.loc);
                                                args[1] = arg_decorator;
                                                decorators.append(p.callRuntime(arg_decorator.loc, "__legacyDecorateParamTS", args)) catch unreachable;
                                                if (is_constructor) {
                                                    class.ts_decorators.update(decorators);
                                                } else {
                                                    prop.ts_decorators.update(decorators);
                                                }
                                            }
                                        }
                                    },
                                    else => unreachable,
                                }
                            }
                        }

                        // TODO: prop.kind == .declare and prop.value == null

                        if (prop.ts_decorators.len > 0) {
                            const descriptor_key = prop.key.?;
                            const loc = descriptor_key.loc;

                            // TODO: when we have the `accessor` modifier, add `and !prop.flags.contains(.has_accessor_modifier)` to
                            // the if statement.
                            const descriptor_kind: Expr = if (!prop.flags.contains(.is_method))
                                p.newExpr(E.Undefined{}, loc)
                            else
                                p.newExpr(E.Null{}, loc);

                            var target: Expr = undefined;
                            if (prop.flags.contains(.is_static)) {
                                p.recordUsage(class.class_name.?.ref.?);
                                target = p.newExpr(E.Identifier{ .ref = class.class_name.?.ref.? }, class.class_name.?.loc);
                            } else {
                                target = p.newExpr(E.Dot{ .target = p.newExpr(E.Identifier{ .ref = class.class_name.?.ref.? }, class.class_name.?.loc), .name = "prototype", .name_loc = loc }, loc);
                            }

                            var array = prop.ts_decorators.listManaged(p.allocator);

                            if (p.options.features.emit_decorator_metadata) {
                                switch (prop.kind) {
                                    .normal, .abstract => {
                                        {
                                            // design:type
                                            var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                            args[0] = p.newExpr(E.String{ .data = "design:type" }, logger.Loc.Empty);
                                            args[1] = p.serializeMetadata(prop.ts_metadata) catch unreachable;
                                            array.append(p.callRuntime(loc, "__legacyMetadataTS", args)) catch unreachable;
                                        }
                                        // design:paramtypes and design:returntype if method
                                        if (prop.flags.contains(.is_method)) {
                                            if (prop.value) |prop_value| {
                                                {
                                                    var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                                    args[0] = p.newExpr(E.String{ .data = "design:paramtypes" }, logger.Loc.Empty);

                                                    const method_args = prop_value.data.e_function.func.args;
                                                    const args_array = p.allocator.alloc(Expr, method_args.len) catch unreachable;
                                                    for (args_array, method_args) |*entry, method_arg| {
                                                        entry.* = p.serializeMetadata(method_arg.ts_metadata) catch unreachable;
                                                    }

                                                    args[1] = p.newExpr(E.Array{ .items = ExprNodeList.init(args_array) }, logger.Loc.Empty);

                                                    array.append(p.callRuntime(loc, "__legacyMetadataTS", args)) catch unreachable;
                                                }
                                                {
                                                    var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                                    args[0] = p.newExpr(E.String{ .data = "design:returntype" }, logger.Loc.Empty);
                                                    args[1] = p.serializeMetadata(prop_value.data.e_function.func.return_ts_metadata) catch unreachable;
                                                    array.append(p.callRuntime(loc, "__legacyMetadataTS", args)) catch unreachable;
                                                }
                                            }
                                        }
                                    },
                                    .get => if (prop.flags.contains(.is_method)) {
                                        // typescript sets design:type to the return value & design:paramtypes to [].
                                        if (prop.value) |prop_value| {
                                            {
                                                var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                                args[0] = p.newExpr(E.String{ .data = "design:type" }, logger.Loc.Empty);
                                                args[1] = p.serializeMetadata(prop_value.data.e_function.func.return_ts_metadata) catch unreachable;
                                                array.append(p.callRuntime(loc, "__legacyMetadataTS", args)) catch unreachable;
                                            }
                                            {
                                                var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                                args[0] = p.newExpr(E.String{ .data = "design:paramtypes" }, logger.Loc.Empty);
                                                args[1] = p.newExpr(E.Array{ .items = ExprNodeList.init(&[_]Expr{}) }, logger.Loc.Empty);
                                                array.append(p.callRuntime(loc, "__legacyMetadataTS", args)) catch unreachable;
                                            }
                                        }
                                    },
                                    .set => if (prop.flags.contains(.is_method)) {
                                        // typescript sets design:type to the return value & design:paramtypes to [arg].
                                        // note that typescript does not allow you to put a decorator on both the getter and the setter.
                                        // if you do anyway, bun will set design:type and design:paramtypes twice, so it's fine.
                                        if (prop.value) |prop_value| {
                                            const method_args = prop_value.data.e_function.func.args;
                                            {
                                                var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                                args[0] = p.newExpr(E.String{ .data = "design:paramtypes" }, logger.Loc.Empty);

                                                const args_array = p.allocator.alloc(Expr, method_args.len) catch unreachable;
                                                for (args_array, method_args) |*entry, method_arg| {
                                                    entry.* = p.serializeMetadata(method_arg.ts_metadata) catch unreachable;
                                                }

                                                args[1] = p.newExpr(E.Array{ .items = ExprNodeList.init(args_array) }, logger.Loc.Empty);

                                                array.append(p.callRuntime(loc, "__legacyMetadataTS", args)) catch unreachable;
                                            }
                                            if (method_args.len >= 1) {
                                                var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                                args[0] = p.newExpr(E.String{ .data = "design:type" }, logger.Loc.Empty);
                                                args[1] = p.serializeMetadata(method_args[0].ts_metadata) catch unreachable;
                                                array.append(p.callRuntime(loc, "__legacyMetadataTS", args)) catch unreachable;
                                            }
                                        }
                                    },
                                    .spread, .declare => {}, // not allowed in a class
                                    .class_static_block => {}, // not allowed to decorate this
                                }
                            }

                            const args = p.allocator.alloc(Expr, 4) catch unreachable;
                            args[0] = p.newExpr(E.Array{ .items = ExprNodeList.init(array.items) }, loc);
                            args[1] = target;
                            args[2] = descriptor_key;
                            args[3] = descriptor_kind;

                            const decorator = p.callRuntime(prop.key.?.loc, "__legacyDecorateClassTS", args);
                            const decorator_stmt = p.s(S.SExpr{ .value = decorator }, decorator.loc);

                            if (prop.flags.contains(.is_static)) {
                                static_decorators.append(decorator_stmt) catch unreachable;
                            } else {
                                instance_decorators.append(decorator_stmt) catch unreachable;
                            }
                        }

                        if (prop.kind != .class_static_block and !prop.flags.contains(.is_method) and prop.key.?.data != .e_private_identifier and prop.ts_decorators.len > 0) {
                            // remove decorated fields without initializers to avoid assigning undefined.
                            const initializer = if (prop.initializer) |initializer_value| initializer_value else continue;

                            var target: Expr = undefined;
                            if (prop.flags.contains(.is_static)) {
                                p.recordUsage(class.class_name.?.ref.?);
                                target = p.newExpr(E.Identifier{ .ref = class.class_name.?.ref.? }, class.class_name.?.loc);
                            } else {
                                target = p.newExpr(E.This{}, prop.key.?.loc);
                            }

                            if (prop.flags.contains(.is_computed) or prop.key.?.data == .e_number) {
                                target = p.newExpr(E.Index{
                                    .target = target,
                                    .index = prop.key.?,
                                }, prop.key.?.loc);
                            } else {
                                target = p.newExpr(E.Dot{
                                    .target = target,
                                    .name = prop.key.?.data.e_string.data,
                                    .name_loc = prop.key.?.loc,
                                }, prop.key.?.loc);
                            }

                            // remove fields with decorators from class body. Move static members outside of class.
                            if (prop.flags.contains(.is_static)) {
                                static_members.append(Stmt.assign(target, initializer)) catch unreachable;
                            } else {
                                instance_members.append(Stmt.assign(target, initializer)) catch unreachable;
                            }
                            continue;
                        }

                        class_properties.append(prop.*) catch unreachable;
                    }

                    class.properties = class_properties.items;

                    if (instance_members.items.len > 0) {
                        if (constructor_function == null) {
                            var properties = ListManaged(Property).fromOwnedSlice(p.allocator, class.properties);
                            var constructor_stmts = ListManaged(Stmt).init(p.allocator);

                            if (class.extends != null) {
                                const target = p.newExpr(E.Super{}, stmt.loc);
                                const arguments_ref = p.newSymbol(.unbound, arguments_str) catch unreachable;
                                p.current_scope.generated.push(p.allocator, arguments_ref) catch unreachable;

                                const super = p.newExpr(E.Spread{ .value = p.newExpr(E.Identifier{ .ref = arguments_ref }, stmt.loc) }, stmt.loc);
                                const args = ExprNodeList.one(p.allocator, super) catch unreachable;

                                constructor_stmts.append(p.s(S.SExpr{ .value = p.newExpr(E.Call{ .target = target, .args = args }, stmt.loc) }, stmt.loc)) catch unreachable;
                            }

                            constructor_stmts.appendSlice(instance_members.items) catch unreachable;

                            properties.insert(0, G.Property{
                                .flags = Flags.Property.init(.{ .is_method = true }),
                                .key = p.newExpr(E.String{ .data = "constructor" }, stmt.loc),
                                .value = p.newExpr(E.Function{ .func = G.Fn{
                                    .name = null,
                                    .open_parens_loc = logger.Loc.Empty,
                                    .args = &[_]Arg{},
                                    .body = .{ .loc = stmt.loc, .stmts = constructor_stmts.items },
                                    .flags = Flags.Function.init(.{}),
                                } }, stmt.loc),
                            }) catch unreachable;

                            class.properties = properties.items;
                        } else {
                            var constructor_stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, constructor_function.?.func.body.stmts);
                            // statements coming from class body inserted after super call or beginning of constructor.
                            var super_index: ?usize = null;
                            for (constructor_stmts.items, 0..) |item, index| {
                                if (item.data != .s_expr or item.data.s_expr.value.data != .e_call or item.data.s_expr.value.data.e_call.target.data != .e_super) continue;
                                super_index = index;
                                break;
                            }

                            const i = if (super_index) |j| j + 1 else 0;
                            constructor_stmts.insertSlice(i, instance_members.items) catch unreachable;

                            constructor_function.?.func.body.stmts = constructor_stmts.items;
                        }

                        // TODO: make sure "super()" comes before instance field initializers
                        // https://github.com/evanw/esbuild/blob/e9413cc4f7ab87263ea244a999c6fa1f1e34dc65/internal/js_parser/js_parser_lower.go#L2742
                    }

                    var stmts_count: usize = 1 + static_members.items.len + instance_decorators.items.len + static_decorators.items.len;
                    if (class.ts_decorators.len > 0) stmts_count += 1;
                    var stmts = ListManaged(Stmt).initCapacity(p.allocator, stmts_count) catch unreachable;
                    stmts.appendAssumeCapacity(stmt);
                    stmts.appendSliceAssumeCapacity(static_members.items);
                    stmts.appendSliceAssumeCapacity(instance_decorators.items);
                    stmts.appendSliceAssumeCapacity(static_decorators.items);
                    if (class.ts_decorators.len > 0) {
                        var array = class.ts_decorators.listManaged(p.allocator);

                        if (p.options.features.emit_decorator_metadata) {
                            if (constructor_function != null) {
                                // design:paramtypes
                                var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                args[0] = p.newExpr(E.String{ .data = "design:paramtypes" }, logger.Loc.Empty);

                                const constructor_args = constructor_function.?.func.args;
                                if (constructor_args.len > 0) {
                                    var param_array = p.allocator.alloc(Expr, constructor_args.len) catch unreachable;

                                    for (constructor_args, 0..) |constructor_arg, i| {
                                        param_array[i] = p.serializeMetadata(constructor_arg.ts_metadata) catch unreachable;
                                    }

                                    args[1] = p.newExpr(E.Array{ .items = ExprNodeList.init(param_array) }, logger.Loc.Empty);
                                } else {
                                    args[1] = p.newExpr(E.Array{ .items = ExprNodeList.init(&[_]Expr{}) }, logger.Loc.Empty);
                                }

                                array.append(p.callRuntime(stmt.loc, "__legacyMetadataTS", args)) catch unreachable;
                            }
                        }

                        const args = p.allocator.alloc(Expr, 2) catch unreachable;
                        args[0] = p.newExpr(E.Array{ .items = ExprNodeList.init(array.items) }, stmt.loc);
                        args[1] = p.newExpr(E.Identifier{ .ref = class.class_name.?.ref.? }, class.class_name.?.loc);

                        stmts.appendAssumeCapacity(Stmt.assign(
                            p.newExpr(E.Identifier{ .ref = class.class_name.?.ref.? }, class.class_name.?.loc),
                            p.callRuntime(stmt.loc, "__legacyDecorateClassTS", args),
                        ));

                        p.recordUsage(class.class_name.?.ref.?);
                        p.recordUsage(class.class_name.?.ref.?);
                    }
                    return stmts.items;
                },
                .expr => |expr| {
                    var stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                    stmts[0] = p.s(S.SExpr{ .value = expr }, expr.loc);
                    return stmts;
                },
            }
        }

        fn serializeMetadata(noalias p: *P, ts_metadata: TypeScript.Metadata) !Expr {
            return switch (ts_metadata) {
                .m_none,
                .m_any,
                .m_unknown,
                .m_object,
                => p.newExpr(
                    E.Identifier{
                        .ref = (p.findSymbol(logger.Loc.Empty, "Object") catch unreachable).ref,
                    },
                    logger.Loc.Empty,
                ),

                .m_never,
                .m_undefined,
                .m_null,
                .m_void,
                => p.newExpr(
                    E.Undefined{},
                    logger.Loc.Empty,
                ),

                .m_string => p.newExpr(
                    E.Identifier{
                        .ref = (p.findSymbol(logger.Loc.Empty, "String") catch unreachable).ref,
                    },
                    logger.Loc.Empty,
                ),
                .m_number => p.newExpr(
                    E.Identifier{
                        .ref = (p.findSymbol(logger.Loc.Empty, "Number") catch unreachable).ref,
                    },
                    logger.Loc.Empty,
                ),
                .m_function => p.newExpr(
                    E.Identifier{
                        .ref = (p.findSymbol(logger.Loc.Empty, "Function") catch unreachable).ref,
                    },
                    logger.Loc.Empty,
                ),
                .m_boolean => p.newExpr(
                    E.Identifier{
                        .ref = (p.findSymbol(logger.Loc.Empty, "Boolean") catch unreachable).ref,
                    },
                    logger.Loc.Empty,
                ),
                .m_array => p.newExpr(
                    E.Identifier{
                        .ref = (p.findSymbol(logger.Loc.Empty, "Array") catch unreachable).ref,
                    },
                    logger.Loc.Empty,
                ),

                .m_bigint => p.maybeDefinedHelper(
                    p.newExpr(
                        E.Identifier{
                            .ref = (p.findSymbol(logger.Loc.Empty, "BigInt") catch unreachable).ref,
                        },
                        logger.Loc.Empty,
                    ),
                ),

                .m_symbol => p.maybeDefinedHelper(
                    p.newExpr(
                        E.Identifier{
                            .ref = (p.findSymbol(logger.Loc.Empty, "Symbol") catch unreachable).ref,
                        },
                        logger.Loc.Empty,
                    ),
                ),

                .m_promise => p.newExpr(
                    E.Identifier{
                        .ref = (p.findSymbol(logger.Loc.Empty, "Promise") catch unreachable).ref,
                    },
                    logger.Loc.Empty,
                ),

                .m_identifier => |ref| {
                    p.recordUsage(ref);
                    if (p.is_import_item.contains(ref)) {
                        return p.maybeDefinedHelper(p.newExpr(
                            E.ImportIdentifier{
                                .ref = ref,
                            },
                            logger.Loc.Empty,
                        ));
                    }

                    return p.maybeDefinedHelper(p.newExpr(
                        E.Identifier{ .ref = ref },
                        logger.Loc.Empty,
                    ));
                },

                .m_dot => |_refs| {
                    var refs = _refs;
                    bun.assert(refs.items.len >= 2);
                    defer refs.deinit(p.allocator);

                    var dots = p.newExpr(
                        E.Dot{
                            .name = p.loadNameFromRef(refs.items[refs.items.len - 1]),
                            .name_loc = logger.Loc.Empty,
                            .target = undefined,
                        },
                        logger.Loc.Empty,
                    );

                    var current_expr = &dots.data.e_dot.target;
                    var i: usize = refs.items.len - 2;
                    while (i > 0) {
                        current_expr.* = p.newExpr(E.Dot{
                            .name = p.loadNameFromRef(refs.items[i]),
                            .name_loc = logger.Loc.Empty,
                            .target = undefined,
                        }, logger.Loc.Empty);
                        current_expr = &current_expr.data.e_dot.target;
                        i -= 1;
                    }

                    if (p.is_import_item.contains(refs.items[0])) {
                        current_expr.* = p.newExpr(
                            E.ImportIdentifier{
                                .ref = refs.items[0],
                            },
                            logger.Loc.Empty,
                        );
                    } else {
                        current_expr.* = p.newExpr(
                            E.Identifier{
                                .ref = refs.items[0],
                            },
                            logger.Loc.Empty,
                        );
                    }

                    const dot_identifier = current_expr.*;
                    var current_dot = dots;

                    var maybe_defined_dots = p.newExpr(
                        E.Binary{
                            .op = .bin_logical_or,
                            .right = try p.checkIfDefinedHelper(current_dot),
                            .left = undefined,
                        },
                        logger.Loc.Empty,
                    );

                    if (i < refs.items.len - 2) {
                        current_dot = current_dot.data.e_dot.target;
                    }
                    current_expr = &maybe_defined_dots.data.e_binary.left;

                    while (i < refs.items.len - 2) {
                        current_expr.* = p.newExpr(
                            E.Binary{
                                .op = .bin_logical_or,
                                .right = try p.checkIfDefinedHelper(current_dot),
                                .left = undefined,
                            },
                            logger.Loc.Empty,
                        );

                        current_expr = &current_expr.data.e_binary.left;
                        i += 1;
                        if (i < refs.items.len - 2) {
                            current_dot = current_dot.data.e_dot.target;
                        }
                    }

                    current_expr.* = try p.checkIfDefinedHelper(dot_identifier);

                    const root = p.newExpr(
                        E.If{
                            .yes = p.newExpr(
                                E.Identifier{
                                    .ref = (p.findSymbol(logger.Loc.Empty, "Object") catch unreachable).ref,
                                },
                                logger.Loc.Empty,
                            ),
                            .no = dots,
                            .test_ = maybe_defined_dots,
                        },
                        logger.Loc.Empty,
                    );

                    return root;
                },
            };
        }

        fn checkIfDefinedHelper(p: *P, expr: Expr) !Expr {
            return p.newExpr(
                E.Binary{
                    .op = .bin_strict_eq,
                    .left = p.newExpr(
                        E.Unary{
                            .op = .un_typeof,
                            .value = expr,
                        },
                        logger.Loc.Empty,
                    ),
                    .right = p.newExpr(
                        E.String{ .data = "undefined" },
                        logger.Loc.Empty,
                    ),
                },
                logger.Loc.Empty,
            );
        }

        fn maybeDefinedHelper(p: *P, identifier_expr: Expr) !Expr {
            return p.newExpr(
                E.If{
                    .test_ = try p.checkIfDefinedHelper(identifier_expr),
                    .yes = p.newExpr(
                        E.Identifier{
                            .ref = (p.findSymbol(logger.Loc.Empty, "Object") catch unreachable).ref,
                        },
                        logger.Loc.Empty,
                    ),
                    .no = identifier_expr,
                },
                logger.Loc.Empty,
            );
        }

        fn wrapIdentifierNamespace(
            p: *P,
            loc: logger.Loc,
            ref: Ref,
        ) Expr {
            const enclosing_ref = p.enclosing_namespace_arg_ref.?;
            p.recordUsage(enclosing_ref);

            return p.newExpr(E.Dot{
                .target = Expr.initIdentifier(enclosing_ref, loc),
                .name = p.symbols.items[ref.innerIndex()].original_name,
                .name_loc = loc,
            }, loc);
        }

        fn wrapIdentifierHoisting(
            p: *P,
            loc: logger.Loc,
            ref: Ref,
        ) Expr {
            // There was a Zig stage1 bug here we had to copy `ref` into a local
            // const variable or else the result would be wrong
            // I remember that bug in particular took hours, possibly days to uncover.

            p.relocated_top_level_vars.append(p.allocator, LocRef{ .loc = loc, .ref = ref }) catch unreachable;
            p.recordUsage(ref);
            return Expr.initIdentifier(ref, loc);
        }

        fn wrapInlinedEnum(noalias p: *P, value: Expr, comment: string) Expr {
            if (bun.strings.containsComptime(comment, "*/")) {
                // Don't wrap with a comment
                return value;
            }

            // Wrap with a comment
            return p.newExpr(E.InlinedEnum{
                .value = value,
                .comment = comment,
            }, value.loc);
        }

        pub fn valueForDefine(noalias p: *P, loc: logger.Loc, assign_target: js_ast.AssignTarget, is_delete_target: bool, define_data: *const DefineData) Expr {
            switch (define_data.value) {
                .e_identifier => {
                    return p.handleIdentifier(
                        loc,
                        define_data.value.e_identifier,
                        define_data.original_name.?,
                        IdentifierOpts{
                            .assign_target = assign_target,
                            .is_delete_target = is_delete_target,
                            .was_originally_identifier = true,
                        },
                    );
                },
                .e_string => |str| {
                    return p.newExpr(str, loc);
                },
                else => {},
            }

            return Expr{
                .data = define_data.value,
                .loc = loc,
            };
        }

        pub fn isDotDefineMatch(noalias p: *P, expr: Expr, parts: []const string) bool {
            switch (expr.data) {
                .e_dot => |ex| {
                    if (parts.len > 1) {
                        if (ex.optional_chain != null) {
                            return false;
                        }

                        // Intermediates must be dot expressions
                        const last = parts.len - 1;
                        const is_tail_match = strings.eql(parts[last], ex.name);
                        return is_tail_match and p.isDotDefineMatch(ex.target, parts[0..last]);
                    }
                },
                .e_import_meta => {
                    return (parts.len == 2 and strings.eqlComptime(parts[0], "import") and strings.eqlComptime(parts[1], "meta"));
                },
                // Note: this behavior differs from esbuild
                // esbuild does not try to match index accessors
                // we do, but only if it's a UTF8 string
                // the intent is to handle people using this form instead of E.Dot. So we really only want to do this if the accessor can also be an identifier
                .e_index => |index| {
                    if (parts.len > 1 and index.index.data == .e_string and index.index.data.e_string.isUTF8()) {
                        if (index.optional_chain != null) {
                            return false;
                        }

                        const last = parts.len - 1;
                        const is_tail_match = strings.eql(parts[last], index.index.data.e_string.slice(p.allocator));
                        return is_tail_match and p.isDotDefineMatch(index.target, parts[0..last]);
                    }
                },
                .e_identifier => |ex| {

                    // The last expression must be an identifier
                    if (parts.len == 1) {
                        const name = p.loadNameFromRef(ex.ref);
                        if (!strings.eql(name, parts[0])) {
                            return false;
                        }

                        const result = p.findSymbolWithRecordUsage(expr.loc, name, false) catch return false;

                        // We must not be in a "with" statement scope
                        if (result.is_inside_with_scope) {
                            return false;
                        }

                        // when there's actually no symbol by that name, we return Ref.None
                        // If a symbol had already existed by that name, we return .unbound
                        return (result.ref.isNull() or p.symbols.items[result.ref.innerIndex()].kind == .unbound);
                    }
                },
                else => {},
            }

            return false;
        }

        // One statement could potentially expand to several statements
        pub fn stmtsToSingleStmt(noalias p: *P, loc: logger.Loc, stmts: []Stmt) Stmt {
            if (stmts.len == 0) {
                return Stmt{ .data = Prefill.Data.SEmpty, .loc = loc };
            }

            if (stmts.len == 1 and !statementCaresAboutScope(stmts[0])) {
                // "let" and "const" must be put in a block when in a single-statement context
                return stmts[0];
            }

            return p.s(S.Block{ .stmts = stmts }, loc);
        }

        pub fn findLabelSymbol(noalias p: *P, loc: logger.Loc, name: string) FindLabelSymbolResult {
            var res = FindLabelSymbolResult{ .ref = Ref.None, .is_loop = false };

            var _scope: ?*Scope = p.current_scope;

            while (_scope != null and !_scope.?.kindStopsHoisting()) : (_scope = _scope.?.parent.?) {
                const scope = _scope orelse unreachable;
                const label_ref = scope.label_ref orelse continue;
                if (scope.kind == .label and strings.eql(name, p.symbols.items[label_ref.innerIndex()].original_name)) {
                    // Track how many times we've referenced this symbol
                    p.recordUsage(label_ref);
                    res.ref = label_ref;
                    res.is_loop = scope.label_stmt_is_loop;
                    res.found = true;
                    return res;
                }
            }

            const r = js_lexer.rangeOfIdentifier(p.source, loc);
            p.log.addRangeErrorFmt(p.source, r, p.allocator, "There is no containing label named \"{s}\"", .{name}) catch unreachable;

            // Allocate an "unbound" symbol
            const ref = p.newSymbol(.unbound, name) catch unreachable;

            // Track how many times we've referenced this symbol
            p.recordUsage(ref);

            return res;
        }

        fn keepStmtSymbolName(p: *P, loc: logger.Loc, ref: Ref, name: string) Stmt {
            _ = p;
            _ = loc;
            _ = ref;
            _ = name;
            // TODO:
            @compileError("not implemented");
        }

        fn runtimeIdentifierRef(p: *P, loc: logger.Loc, comptime name: string) Ref {
            p.has_called_runtime = true;

            if (!p.runtime_imports.contains(name)) {
                if (!p.options.bundle) {
                    const generated_symbol = p.declareGeneratedSymbol(.other, name) catch unreachable;
                    p.runtime_imports.put(name, generated_symbol);
                    return generated_symbol;
                } else {
                    const loc_ref = js_ast.LocRef{
                        .loc = loc,
                        .ref = p.newSymbol(.other, name) catch unreachable,
                    };
                    p.runtime_imports.put(
                        name,
                        loc_ref.ref.?,
                    );
                    p.module_scope.generated.push(p.allocator, loc_ref.ref.?) catch unreachable;
                    return loc_ref.ref.?;
                }
            } else {
                return p.runtime_imports.at(name).?;
            }
        }

        fn runtimeIdentifier(p: *P, loc: logger.Loc, comptime name: string) Expr {
            const ref = p.runtimeIdentifierRef(loc, name);
            p.recordUsage(ref);
            return p.newExpr(
                E.ImportIdentifier{
                    .ref = ref,
                    .was_originally_identifier = false,
                },
                loc,
            );
        }

        pub fn callRuntime(p: *P, loc: logger.Loc, comptime name: string, args: []Expr) Expr {
            return p.newExpr(
                E.Call{
                    .target = p.runtimeIdentifier(loc, name),
                    .args = ExprNodeList.init(args),
                },
                loc,
            );
        }

        pub fn extractDeclsForBinding(binding: Binding, decls: *ListManaged(G.Decl)) anyerror!void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => {
                    try decls.append(G.Decl{ .binding = binding });
                },
                .b_array => |arr| {
                    for (arr.items) |item| {
                        extractDeclsForBinding(item.binding, decls) catch unreachable;
                    }
                },
                .b_object => |obj| {
                    for (obj.properties) |prop| {
                        extractDeclsForBinding(prop.value, decls) catch unreachable;
                    }
                },
            }
        }

        pub inline fn @"module.exports"(p: *P, loc: logger.Loc) Expr {
            return p.newExpr(E.Dot{ .name = exports_string_name, .name_loc = loc, .target = p.newExpr(E.Identifier{ .ref = p.module_ref }, loc) }, loc);
        }

        // This code is tricky.
        // - Doing it incorrectly will cause segfaults.
        // - Doing it correctly drastically affects runtime performance while parsing larger files
        // The key is in how we remove scopes from the list
        // If we do an orderedRemove, it gets very slow.
        // swapRemove is fast. But a little more dangerous.
        // Instead, we just tombstone it.
        pub fn popAndFlattenScope(p: *P, scope_index: usize) void {
            // Move up to the parent scope
            var to_flatten = p.current_scope;
            var parent = to_flatten.parent.?;
            p.current_scope = parent;

            // Erase this scope from the order. This will shift over the indices of all
            // the scopes that were created after us. However, we shouldn't have to
            // worry about other code with outstanding scope indices for these scopes.
            // These scopes were all created in between this scope's push and pop
            // operations, so they should all be child scopes and should all be popped
            // by the time we get here.
            p.scopes_in_order.items[scope_index] = null;
            // Decrement the length so that in code with lots of scopes, we use
            // less memory and do less work
            p.scopes_in_order.items.len -= @as(usize, @intFromBool(p.scopes_in_order.items.len == scope_index + 1));

            // Remove the last child from the parent scope
            const last = parent.children.len - 1;
            if (comptime Environment.allow_assert) assert(parent.children.ptr[last] == to_flatten);
            parent.children.len -|= 1;

            for (to_flatten.children.slice()) |item| {
                item.parent = parent;
                parent.children.push(p.allocator, item) catch unreachable;
            }
        }

        pub fn maybeCommaSpreadError(p: *P, _comma_after_spread: ?logger.Loc) void {
            const comma_after_spread = _comma_after_spread orelse return;
            if (comma_after_spread.start == -1) return;

            p.log.addRangeError(p.source, logger.Range{ .loc = comma_after_spread, .len = 1 }, "Unexpected \",\" after rest pattern") catch unreachable;
        }

        /// When not transpiling we dont use the renamer, so our solution is to generate really
        /// hard to collide with variables, instead of actually making things collision free
        pub fn generateTempRef(p: *P, default_name: ?string) Ref {
            return p.generateTempRefWithScope(default_name, p.current_scope);
        }

        pub fn generateTempRefWithScope(p: *P, default_name: ?string, scope: *Scope) Ref {
            const name = (if (p.willUseRenamer()) default_name else null) orelse brk: {
                p.temp_ref_count += 1;
                break :brk std.fmt.allocPrint(p.allocator, "__bun_temp_ref_{x}$", .{p.temp_ref_count}) catch bun.outOfMemory();
            };
            const ref = p.newSymbol(.other, name) catch bun.outOfMemory();

            p.temp_refs_to_declare.append(p.allocator, .{
                .ref = ref,
            }) catch bun.outOfMemory();

            scope.generated.append(p.allocator, &.{ref}) catch bun.outOfMemory();

            return ref;
        }

        pub fn computeTsEnumsMap(p: *const P, allocator: Allocator) !js_ast.Ast.TsEnumsMap {
            // When hot module reloading is enabled, we disable enum inlining
            // to avoid making the HMR graph more complicated.
            if (p.options.features.hot_module_reloading)
                return .{};

            const InlinedEnumValue = js_ast.InlinedEnumValue;
            var map: js_ast.Ast.TsEnumsMap = .{};
            try map.ensureTotalCapacity(allocator, @intCast(p.top_level_enums.items.len));
            for (p.top_level_enums.items) |ref| {
                const entry = p.ref_to_ts_namespace_member.getEntry(ref).?;
                const namespace = entry.value_ptr.namespace;
                var inner_map: bun.StringHashMapUnmanaged(InlinedEnumValue) = .{};
                try inner_map.ensureTotalCapacity(allocator, @intCast(namespace.count()));
                for (namespace.keys(), namespace.values()) |key, val| {
                    switch (val.data) {
                        .enum_number => |num| inner_map.putAssumeCapacityNoClobber(
                            key,
                            InlinedEnumValue.encode(.{ .number = num }),
                        ),
                        .enum_string => |str| inner_map.putAssumeCapacityNoClobber(
                            key,
                            InlinedEnumValue.encode(.{ .string = str }),
                        ),
                        else => continue,
                    }
                }
                map.putAssumeCapacity(entry.key_ptr.*, inner_map);
            }
            return map;
        }

        pub fn shouldLowerUsingDeclarations(p: *const P, stmts: []Stmt) bool {
            // TODO: We do not support lowering await, but when we do this needs to point to that var
            const lower_await = false;

            // Check feature flags first, then iterate statements.
            if (!p.options.features.lower_using and !lower_await) return false;

            for (stmts) |stmt| {
                if (stmt.data == .s_local and
                    // Need to re-check lower_using for the k_using case in case lower_await is true
                    ((stmt.data.s_local.kind == .k_using and p.options.features.lower_using) or
                        (stmt.data.s_local.kind == .k_await_using)))
                {
                    return true;
                }
            }

            return false;
        }

        pub const LowerUsingDeclarationsContext = struct {
            first_using_loc: logger.Loc,
            stack_ref: Ref,
            has_await_using: bool,

            pub fn init(p: *P) !LowerUsingDeclarationsContext {
                return LowerUsingDeclarationsContext{
                    .first_using_loc = logger.Loc.Empty,
                    .stack_ref = p.generateTempRef("__stack"),
                    .has_await_using = false,
                };
            }

            pub fn scanStmts(ctx: *LowerUsingDeclarationsContext, p: *P, stmts: []Stmt) void {
                for (stmts) |stmt| {
                    switch (stmt.data) {
                        .s_local => |local| {
                            if (!local.kind.isUsing()) continue;

                            if (ctx.first_using_loc.isEmpty()) {
                                ctx.first_using_loc = stmt.loc;
                            }
                            if (local.kind == .k_await_using) {
                                ctx.has_await_using = true;
                            }
                            for (local.decls.slice()) |*decl| {
                                if (decl.value) |*decl_value| {
                                    const value_loc = decl_value.loc;
                                    p.recordUsage(ctx.stack_ref);
                                    const args = p.allocator.alloc(Expr, 3) catch bun.outOfMemory();
                                    args[0] = Expr{
                                        .data = .{ .e_identifier = .{ .ref = ctx.stack_ref } },
                                        .loc = stmt.loc,
                                    };
                                    args[1] = decl_value.*;
                                    // 1. always pass this param for hopefully better jit performance
                                    // 2. pass 1 or 0 to be shorter than `true` or `false`
                                    args[2] = Expr{
                                        .data = .{ .e_number = .{ .value = if (local.kind == .k_await_using) 1 else 0 } },
                                        .loc = stmt.loc,
                                    };
                                    decl.value = p.callRuntime(value_loc, "__using", args);
                                }
                            }
                            if (p.will_wrap_module_in_try_catch_for_using and p.current_scope.kind == .entry) {
                                local.kind = .k_var;
                            } else {
                                local.kind = .k_const;
                            }
                        },
                        else => {},
                    }
                }
            }

            pub fn finalize(ctx: *LowerUsingDeclarationsContext, p: *P, stmts: []Stmt, should_hoist_fns: bool) ListManaged(Stmt) {
                var result = ListManaged(Stmt).init(p.allocator);
                var exports = ListManaged(js_ast.ClauseItem).init(p.allocator);
                var end: u32 = 0;
                for (stmts) |stmt| {
                    switch (stmt.data) {
                        .s_directive, .s_import, .s_export_from, .s_export_star => {
                            // These can't go in a try/catch block
                            result.append(stmt) catch bun.outOfMemory();
                            continue;
                        },

                        .s_class => {
                            if (stmt.data.s_class.is_export) {
                                // can't go in try/catch; hoist out
                                result.append(stmt) catch bun.outOfMemory();
                                continue;
                            }
                        },

                        .s_export_default => {
                            continue; // this prevents re-exporting default since we already have it as an .s_export_clause
                        },

                        .s_export_clause => |data| {
                            // Merge export clauses together
                            exports.appendSlice(data.items) catch bun.outOfMemory();
                            continue;
                        },

                        .s_function => {
                            if (should_hoist_fns) {
                                // Hoist function declarations for cross-file ESM references
                                result.append(stmt) catch bun.outOfMemory();
                                continue;
                            }
                        },

                        .s_local => |local| {
                            // If any of these are exported, turn it into a "var" and add export clauses
                            if (local.is_export) {
                                local.is_export = false;
                                for (local.decls.slice()) |decl| {
                                    if (decl.binding.data == .b_identifier) {
                                        const identifier = decl.binding.data.b_identifier;
                                        exports.append(js_ast.ClauseItem{
                                            .name = .{
                                                .loc = decl.binding.loc,
                                                .ref = identifier.ref,
                                            },
                                            .alias = p.symbols.items[identifier.ref.inner_index].original_name,
                                            .alias_loc = decl.binding.loc,
                                        }) catch bun.outOfMemory();
                                        local.kind = .k_var;
                                    }
                                }
                            }
                        },

                        else => {},
                    }

                    stmts[end] = stmt;
                    end += 1;
                }

                const non_exported_statements = stmts[0..end];

                const caught_ref = p.generateTempRef("_catch");
                const err_ref = p.generateTempRef("_err");
                const has_err_ref = p.generateTempRef("_hasErr");

                var scope = p.current_scope;
                while (!scope.kindStopsHoisting()) {
                    scope = scope.parent.?;
                }

                const is_top_level = scope == p.module_scope;
                scope.generated.append(p.allocator, &.{
                    ctx.stack_ref,
                    caught_ref,
                    err_ref,
                    has_err_ref,
                }) catch bun.outOfMemory();
                p.declared_symbols.ensureUnusedCapacity(
                    p.allocator,
                    // 5 to include the _promise decl later on:
                    if (ctx.has_await_using) 5 else 4,
                ) catch bun.outOfMemory();
                p.declared_symbols.appendAssumeCapacity(.{ .is_top_level = is_top_level, .ref = ctx.stack_ref });
                p.declared_symbols.appendAssumeCapacity(.{ .is_top_level = is_top_level, .ref = caught_ref });
                p.declared_symbols.appendAssumeCapacity(.{ .is_top_level = is_top_level, .ref = err_ref });
                p.declared_symbols.appendAssumeCapacity(.{ .is_top_level = is_top_level, .ref = has_err_ref });

                const loc = ctx.first_using_loc;
                const call_dispose = call_dispose: {
                    p.recordUsage(ctx.stack_ref);
                    p.recordUsage(err_ref);
                    p.recordUsage(has_err_ref);
                    const args = p.allocator.alloc(Expr, 3) catch bun.outOfMemory();
                    args[0] = Expr{
                        .data = .{ .e_identifier = .{ .ref = ctx.stack_ref } },
                        .loc = loc,
                    };
                    args[1] = Expr{
                        .data = .{ .e_identifier = .{ .ref = err_ref } },
                        .loc = loc,
                    };
                    args[2] = Expr{
                        .data = .{ .e_identifier = .{ .ref = has_err_ref } },
                        .loc = loc,
                    };
                    break :call_dispose p.callRuntime(loc, "__callDispose", args);
                };

                const finally_stmts = finally: {
                    if (ctx.has_await_using) {
                        const promise_ref = p.generateTempRef("_promise");
                        scope.generated.append(p.allocator, &.{promise_ref}) catch bun.outOfMemory();
                        p.declared_symbols.appendAssumeCapacity(.{ .is_top_level = is_top_level, .ref = promise_ref });

                        const promise_ref_expr = p.newExpr(E.Identifier{ .ref = promise_ref }, loc);

                        const await_expr = p.newExpr(E.Await{
                            .value = promise_ref_expr,
                        }, loc);
                        p.recordUsage(promise_ref);

                        const statements = p.allocator.alloc(Stmt, 2) catch bun.outOfMemory();
                        statements[0] = p.s(S.Local{
                            .decls = decls: {
                                const decls = p.allocator.alloc(Decl, 1) catch bun.outOfMemory();
                                decls[0] = .{
                                    .binding = p.b(B.Identifier{ .ref = promise_ref }, loc),
                                    .value = call_dispose,
                                };
                                break :decls G.Decl.List.init(decls);
                            },
                        }, loc);

                        // The "await" must not happen if an error was thrown before the
                        // "await using", so we conditionally await here:
                        //
                        //   var promise = __callDispose(stack, error, hasError);
                        //   promise && await promise;
                        //
                        statements[1] = p.s(S.SExpr{
                            .value = p.newExpr(E.Binary{
                                .op = .bin_logical_and,
                                .left = promise_ref_expr,
                                .right = await_expr,
                            }, loc),
                        }, loc);

                        break :finally statements;
                    } else {
                        const single = p.allocator.alloc(Stmt, 1) catch bun.outOfMemory();
                        single[0] = p.s(S.SExpr{ .value = call_dispose }, call_dispose.loc);
                        break :finally single;
                    }
                };

                // Wrap everything in a try/catch/finally block
                p.recordUsage(caught_ref);
                result.ensureUnusedCapacity(2 + @as(usize, @intFromBool(exports.items.len > 0))) catch bun.outOfMemory();
                result.appendAssumeCapacity(p.s(S.Local{
                    .decls = decls: {
                        const decls = p.allocator.alloc(Decl, 1) catch bun.outOfMemory();
                        decls[0] = .{
                            .binding = p.b(B.Identifier{ .ref = ctx.stack_ref }, loc),
                            .value = p.newExpr(E.Array{}, loc),
                        };
                        break :decls G.Decl.List.init(decls);
                    },
                    .kind = .k_let,
                }, loc));
                result.appendAssumeCapacity(p.s(S.Try{
                    .body = non_exported_statements,
                    .body_loc = loc,
                    .catch_ = .{
                        .binding = p.b(B.Identifier{ .ref = caught_ref }, loc),
                        .body = catch_body: {
                            const statements = p.allocator.alloc(Stmt, 1) catch bun.outOfMemory();
                            statements[0] = p.s(S.Local{
                                .decls = decls: {
                                    const decls = p.allocator.alloc(Decl, 2) catch bun.outOfMemory();
                                    decls[0] = .{
                                        .binding = p.b(B.Identifier{ .ref = err_ref }, loc),
                                        .value = p.newExpr(E.Identifier{ .ref = caught_ref }, loc),
                                    };
                                    decls[1] = .{
                                        .binding = p.b(B.Identifier{ .ref = has_err_ref }, loc),
                                        .value = p.newExpr(E.Number{ .value = 1 }, loc),
                                    };
                                    break :decls G.Decl.List.init(decls);
                                },
                            }, loc);
                            break :catch_body statements;
                        },
                        .body_loc = loc,
                        .loc = loc,
                    },
                    .finally = .{
                        .loc = loc,
                        .stmts = finally_stmts,
                    },
                }, loc));

                if (exports.items.len > 0) {
                    result.appendAssumeCapacity(p.s(S.ExportClause{
                        .items = exports.items,
                        .is_single_line = false,
                    }, loc));
                }

                return result;
            }
        };

        const import_meta_hot_accept_err = "Dependencies to `import.meta.hot.accept` must be statically analyzable module specifiers matching direct imports.";

        /// The signatures for `import.meta.hot.accept` are:
        /// `accept()`                   - self accept
        /// `accept(Function)`           - self accept
        /// `accept(string, Function)`   - accepting another module
        /// `accept(string[], Function)` - accepting multiple modules
        ///
        /// The strings that can be passed in the first argument must be module
        /// specifiers that were imported. We enforce that they line up exactly
        /// with ones that were imported, so that it can share an import record.
        ///
        /// This function replaces all specifier strings with `e_require_resolve_string`
        pub fn handleImportMetaHotAcceptCall(p: *@This(), call: *E.Call) void {
            if (call.args.len == 0) return;
            switch (call.args.at(0).data) {
                .e_string => |str| {
                    call.args.mut(0).data = p.rewriteImportMetaHotAcceptString(str, call.args.at(0).loc) orelse
                        return;
                },
                .e_array => |arr| for (arr.items.slice()) |*item| {
                    if (item.data != .e_string) {
                        p.log.addError(p.source, item.loc, import_meta_hot_accept_err) catch bun.outOfMemory();
                        continue;
                    }
                    item.data = p.rewriteImportMetaHotAcceptString(item.data.e_string, item.loc) orelse
                        return;
                },
                else => return,
            }

            call.target.data.e_special = .hot_accept_visited;
        }

        fn rewriteImportMetaHotAcceptString(p: *P, str: *E.String, loc: logger.Loc) ?Expr.Data {
            str.toUTF8(p.allocator) catch bun.outOfMemory();
            const specifier = str.data;

            const import_record_index = for (p.import_records.items, 0..) |import_record, i| {
                if (bun.strings.eql(specifier, import_record.path.text)) {
                    break i;
                }
            } else {
                p.log.addError(p.source, loc, import_meta_hot_accept_err) catch bun.outOfMemory();
                return null;
            };

            return .{ .e_special = .{
                .resolved_specifier_string = .init(@intCast(import_record_index)),
            } };
        }

        const ReactRefreshExportKind = enum { named, default };

        pub fn handleReactRefreshRegister(p: *P, stmts: *ListManaged(Stmt), original_name: []const u8, ref: Ref, export_kind: ReactRefreshExportKind) !void {
            bun.assert(p.options.features.react_fast_refresh);
            bun.assert(p.current_scope == p.module_scope);

            if (ReactRefresh.isComponentishName(original_name)) {
                try p.emitReactRefreshRegister(stmts, original_name, ref, export_kind);
            }
        }

        pub fn emitReactRefreshRegister(p: *P, stmts: *ListManaged(Stmt), original_name: []const u8, ref: Ref, export_kind: ReactRefreshExportKind) !void {
            bun.assert(p.options.features.react_fast_refresh);
            bun.assert(p.current_scope == p.module_scope);

            // $RefreshReg$(component, "file.ts:Original Name")
            const loc = logger.Loc.Empty;
            try stmts.append(p.s(S.SExpr{ .value = p.newExpr(E.Call{
                .target = Expr.initIdentifier(p.react_refresh.register_ref, loc),
                .args = try ExprNodeList.fromSlice(p.allocator, &.{
                    Expr.initIdentifier(ref, loc),
                    p.newExpr(E.String{
                        .data = try bun.strings.concat(p.allocator, &.{
                            p.source.path.pretty,
                            ":",
                            switch (export_kind) {
                                .named => original_name,
                                .default => "default",
                            },
                        }),
                    }, loc),
                }),
            }, loc) }, loc));

            p.recordUsage(ref);
            p.react_refresh.register_used = true;
        }

        pub fn wrapValueForServerComponentReference(p: *P, val: Expr, original_name: []const u8) Expr {
            bun.assert(p.options.features.server_components.wrapsExports());
            bun.assert(p.current_scope == p.module_scope);

            if (p.options.features.server_components == .wrap_exports_for_server_reference)
                bun.todoPanic(@src(), "registerServerReference", .{});

            const module_path = p.newExpr(E.String{
                .data = if (p.options.jsx.development)
                    p.source.path.pretty
                else
                    bun.todoPanic(@src(), "TODO: unique_key here", .{}),
            }, logger.Loc.Empty);

            // registerClientReference(
            //   Comp,
            //   "src/filepath.tsx",
            //   "Comp"
            // );
            return p.newExpr(E.Call{
                .target = Expr.initIdentifier(p.server_components_wrap_ref, logger.Loc.Empty),
                .args = js_ast.ExprNodeList.fromSlice(p.allocator, &.{
                    val,
                    module_path,
                    p.newExpr(E.String{ .data = original_name }, logger.Loc.Empty),
                }) catch bun.outOfMemory(),
            }, logger.Loc.Empty);
        }

        pub fn handleReactRefreshHookCall(p: *P, hook_call: *E.Call, original_name: []const u8) void {
            bun.assert(p.options.features.react_fast_refresh);
            bun.assert(ReactRefresh.isHookName(original_name));
            const ctx_storage = p.react_refresh.hook_ctx_storage orelse
                return; // not in a function, ignore this hook call.

            // if this function has no hooks recorded, initialize a hook context
            // every function visit provides stack storage, which it will inspect at visit finish.
            const ctx: *ReactRefresh.HookContext = if (ctx_storage.*) |*ctx| ctx else init: {
                p.react_refresh.signature_used = true;

                var scope = p.current_scope;
                while (scope.kind != .function_body and scope.kind != .block and scope.kind != .entry) {
                    scope = scope.parent orelse break;
                }

                ctx_storage.* = .{
                    .hasher = std.hash.Wyhash.init(0),
                    .signature_cb = p.generateTempRefWithScope("_s", scope),
                    .user_hooks = .{},
                };

                // TODO(paperclover): fix the renamer bug. this bug
                // theoretically affects all usages of temp refs, but i cannot
                // find another example of it breaking (like with `using`)
                p.declared_symbols.append(p.allocator, .{
                    .is_top_level = true,
                    .ref = ctx_storage.*.?.signature_cb,
                }) catch bun.outOfMemory();

                break :init &(ctx_storage.*.?);
            };

            ctx.hasher.update(original_name);

            if (ReactRefresh.built_in_hooks.get(original_name)) |built_in_hook| hash_arg: {
                const arg_index: usize = switch (built_in_hook) {
                    // useState first argument is initial state.
                    .useState => 0,
                    // useReducer second argument is initial state.
                    .useReducer => 1,
                    else => break :hash_arg,
                };
                if (hook_call.args.len <= arg_index) break :hash_arg;
                const arg = hook_call.args.slice()[arg_index];
                arg.data.writeToHasher(&ctx.hasher, p.symbols.items);
            } else switch (hook_call.target.data) {
                inline .e_identifier,
                .e_import_identifier,
                .e_commonjs_export_identifier,
                => |id, tag| {
                    const gop = ctx.user_hooks.getOrPut(p.allocator, id.ref) catch bun.outOfMemory();
                    if (!gop.found_existing) {
                        gop.value_ptr.* = .{
                            .data = @unionInit(Expr.Data, @tagName(tag), id),
                            .loc = .Empty,
                        };
                    }
                },
                else => {},
            }

            ctx.hasher.update("\x00");
        }

        pub fn handleReactRefreshPostVisitFunctionBody(p: *P, stmts: *ListManaged(Stmt), hook: *ReactRefresh.HookContext) void {
            bun.assert(p.options.features.react_fast_refresh);

            // We need to prepend `_s();` as a statement.
            if (stmts.items.len == stmts.capacity) {
                // If the ArrayList does not have enough capacity, it is
                // re-allocated entirely to fit. Only one slot of new capacity
                // is used since we know this statement list is not going to be
                // appended to afterwards; This function is a post-visit handler.
                const new_stmts = p.allocator.alloc(Stmt, stmts.items.len + 1) catch bun.outOfMemory();
                @memcpy(new_stmts[1..], stmts.items);
                stmts.deinit();
                stmts.* = ListManaged(Stmt).fromOwnedSlice(p.allocator, new_stmts);
            } else {
                // The array has enough capacity, so there is no possibility of
                // allocation failure. We just move all of the statements over
                // by one, and increase the length using `addOneAssumeCapacity`
                _ = stmts.addOneAssumeCapacity();
                bun.copy(Stmt, stmts.items[1..], stmts.items[0 .. stmts.items.len - 1]);
            }

            const loc = logger.Loc.Empty;
            const prepended_stmt = p.s(S.SExpr{ .value = p.newExpr(E.Call{
                .target = Expr.initIdentifier(hook.signature_cb, loc),
            }, loc) }, loc);
            stmts.items[0] = prepended_stmt;
        }

        pub fn getReactRefreshHookSignalDecl(p: *P, signal_cb_ref: Ref) Stmt {
            const loc = logger.Loc.Empty;
            p.react_refresh.latest_signature_ref = signal_cb_ref;
            // var s_ = $RefreshSig$();
            return p.s(S.Local{ .decls = G.Decl.List.fromSlice(p.allocator, &.{.{
                .binding = p.b(B.Identifier{ .ref = signal_cb_ref }, loc),
                .value = p.newExpr(E.Call{
                    .target = Expr.initIdentifier(p.react_refresh.create_signature_ref, loc),
                }, loc),
            }}) catch bun.outOfMemory() }, loc);
        }

        pub fn getReactRefreshHookSignalInit(p: *P, ctx: *ReactRefresh.HookContext, function_with_hook_calls: Expr) Expr {
            const loc = logger.Loc.Empty;

            const final = ctx.hasher.final();
            const hash_data = p.allocator.alloc(u8, comptime bun.base64.encodeLenFromSize(@sizeOf(@TypeOf(final)))) catch bun.outOfMemory();
            bun.assert(bun.base64.encode(hash_data, std.mem.asBytes(&final)) == hash_data.len);

            const have_custom_hooks = ctx.user_hooks.count() > 0;
            const have_force_arg = have_custom_hooks or p.react_refresh.force_reset;

            const args = p.allocator.alloc(
                Expr,
                2 +
                    @as(usize, @intFromBool(have_force_arg)) +
                    @as(usize, @intFromBool(have_custom_hooks)),
            ) catch bun.outOfMemory();

            args[0] = function_with_hook_calls;
            args[1] = p.newExpr(E.String{ .data = hash_data }, loc);

            if (have_force_arg) args[2] = p.newExpr(E.Boolean{ .value = p.react_refresh.force_reset }, loc);

            if (have_custom_hooks) {
                // () => [useCustom1, useCustom2]
                args[3] = p.newExpr(E.Arrow{
                    .body = .{
                        .stmts = p.allocator.dupe(Stmt, &.{
                            p.s(S.Return{ .value = p.newExpr(E.Array{
                                .items = ExprNodeList.init(ctx.user_hooks.values()),
                            }, loc) }, loc),
                        }) catch bun.outOfMemory(),
                        .loc = loc,
                    },
                    .prefer_expr = true,
                }, loc);
            }

            // _s(func, "<hash>", force, () => [useCustom])
            return p.newExpr(E.Call{
                .target = Expr.initIdentifier(ctx.signature_cb, loc),
                .args = ExprNodeList.init(args),
            }, loc);
        }

        pub fn toAST(
            p: *P,
            parts: *ListManaged(js_ast.Part),
            exports_kind: js_ast.ExportsKind,
            wrap_mode: WrapMode,
            hashbang: []const u8,
        ) !js_ast.Ast {
            const allocator = p.allocator;

            // if (p.options.tree_shaking and p.options.features.trim_unused_imports) {
            //     p.treeShake(&parts, false);
            // }

            const bundling = p.options.bundle;
            var parts_end: usize = @as(usize, @intFromBool(bundling));

            // When bundling with HMR, we need every module to be just a
            // single part, as we later wrap each module into a function,
            // which requires a single part. Otherwise, you'll end up with
            // multiple instances of a module, each with different parts of
            // the file. That is also why tree-shaking is disabled.
            if (p.options.features.hot_module_reloading) {
                bun.assert(!p.options.tree_shaking);
                bun.assert(p.options.features.hot_module_reloading);

                var hmr_transform_ctx = ConvertESMExportsForHmr{
                    .last_part = &parts.items[parts.items.len - 1],
                    .is_in_node_modules = p.source.path.isNodeModule(),
                };
                try hmr_transform_ctx.stmts.ensureTotalCapacity(p.allocator, prealloc_count: {
                    // get a estimate on how many statements there are going to be
                    var count: usize = 0;
                    for (parts.items) |part| count += part.stmts.len;
                    break :prealloc_count count + 2;
                });

                for (parts.items) |part| {
                    // Bake does not care about 'import =', as it handles it on it's own
                    _ = try ImportScanner.scan(P, p, part.stmts, wrap_mode != .none, true, &hmr_transform_ctx);
                }

                try hmr_transform_ctx.finalize(p, parts.items);
            } else {
                // Handle import paths after the whole file has been visited because we need
                // symbol usage counts to be able to remove unused type-only imports in
                // TypeScript code.
                while (true) {
                    var kept_import_equals = false;
                    var removed_import_equals = false;

                    const begin = parts_end;
                    // Potentially remove some statements, then filter out parts to remove any
                    // with no statements
                    for (parts.items[begin..]) |part_| {
                        var part = part_;
                        p.import_records_for_current_part.clearRetainingCapacity();
                        p.declared_symbols.clearRetainingCapacity();

                        const result = try ImportScanner.scan(P, p, part.stmts, wrap_mode != .none, false, {});
                        kept_import_equals = kept_import_equals or result.kept_import_equals;
                        removed_import_equals = removed_import_equals or result.removed_import_equals;

                        part.stmts = result.stmts;
                        if (part.stmts.len > 0) {
                            if (p.module_scope.contains_direct_eval and part.declared_symbols.len() > 0) {
                                // If this file contains a direct call to "eval()", all parts that
                                // declare top-level symbols must be kept since the eval'd code may
                                // reference those symbols.
                                part.can_be_removed_if_unused = false;
                            }
                            if (part.declared_symbols.len() == 0) {
                                part.declared_symbols = p.declared_symbols.clone(p.allocator) catch unreachable;
                            } else {
                                part.declared_symbols.appendList(p.allocator, p.declared_symbols) catch unreachable;
                            }

                            if (part.import_record_indices.len == 0) {
                                part.import_record_indices = @TypeOf(part.import_record_indices).init(
                                    (p.import_records_for_current_part.clone(p.allocator) catch unreachable).items,
                                );
                            } else {
                                part.import_record_indices.append(p.allocator, p.import_records_for_current_part.items) catch unreachable;
                            }

                            parts.items[parts_end] = part;
                            parts_end += 1;
                        }
                    }

                    // We need to iterate multiple times if an import-equals statement was
                    // removed and there are more import-equals statements that may be removed
                    if (!kept_import_equals or !removed_import_equals) {
                        break;
                    }
                }

                // leave the first part in there for namespace export when bundling
                parts.items.len = parts_end;

                // Do a second pass for exported items now that imported items are filled out.
                // This isn't done for HMR because it already deletes all `.s_export_clause`s
                for (parts.items) |part| {
                    for (part.stmts) |stmt| {
                        switch (stmt.data) {
                            .s_export_clause => |clause| {
                                for (clause.items) |item| {
                                    if (p.named_imports.getEntry(item.name.ref.?)) |_import| {
                                        _import.value_ptr.is_exported = true;
                                    }
                                }
                            },
                            else => {},
                        }
                    }
                }
            }

            if (wrap_mode == .bun_commonjs and !p.options.features.remove_cjs_module_wrapper) {
                // This transforms the user's code into.
                //
                //   (function (exports, require, module, __filename, __dirname) {
                //      ...
                //   })
                //
                //  which is then called in `evaluateCommonJSModuleOnce`
                var args = allocator.alloc(Arg, 5 + @as(usize, @intFromBool(p.has_import_meta))) catch bun.outOfMemory();
                args[0..5].* = .{
                    Arg{ .binding = p.b(B.Identifier{ .ref = p.exports_ref }, logger.Loc.Empty) },
                    Arg{ .binding = p.b(B.Identifier{ .ref = p.require_ref }, logger.Loc.Empty) },
                    Arg{ .binding = p.b(B.Identifier{ .ref = p.module_ref }, logger.Loc.Empty) },
                    Arg{ .binding = p.b(B.Identifier{ .ref = p.filename_ref }, logger.Loc.Empty) },
                    Arg{ .binding = p.b(B.Identifier{ .ref = p.dirname_ref }, logger.Loc.Empty) },
                };
                if (p.has_import_meta) {
                    p.import_meta_ref = p.newSymbol(.other, "$Bun_import_meta") catch bun.outOfMemory();
                    args[5] = Arg{ .binding = p.b(B.Identifier{ .ref = p.import_meta_ref }, logger.Loc.Empty) };
                }

                var total_stmts_count: usize = 0;
                for (parts.items) |part| {
                    total_stmts_count += part.stmts.len;
                }

                const preserve_strict_mode = p.module_scope.strict_mode == .explicit_strict_mode and
                    !(parts.items.len > 0 and
                        parts.items[0].stmts.len > 0 and
                        parts.items[0].stmts[0].data == .s_directive);

                total_stmts_count += @as(usize, @intCast(@intFromBool(preserve_strict_mode)));

                const stmts_to_copy = allocator.alloc(Stmt, total_stmts_count) catch bun.outOfMemory();
                {
                    var remaining_stmts = stmts_to_copy;
                    if (preserve_strict_mode) {
                        remaining_stmts[0] = p.s(
                            S.Directive{
                                .value = "use strict",
                            },
                            p.module_scope_directive_loc,
                        );
                        remaining_stmts = remaining_stmts[1..];
                    }

                    for (parts.items) |part| {
                        for (part.stmts, remaining_stmts[0..part.stmts.len]) |src, *dest| {
                            dest.* = src;
                        }
                        remaining_stmts = remaining_stmts[part.stmts.len..];
                    }
                }

                const wrapper = p.newExpr(
                    E.Function{
                        .func = G.Fn{
                            .name = null,
                            .open_parens_loc = logger.Loc.Empty,
                            .args = args,
                            .body = .{ .loc = logger.Loc.Empty, .stmts = stmts_to_copy },
                            .flags = Flags.Function.init(.{ .is_export = false }),
                        },
                    },
                    logger.Loc.Empty,
                );

                var top_level_stmts = p.allocator.alloc(Stmt, 1) catch bun.outOfMemory();
                top_level_stmts[0] = p.s(
                    S.SExpr{
                        .value = wrapper,
                    },
                    logger.Loc.Empty,
                );

                try parts.ensureUnusedCapacity(1);
                parts.items.len = 1;
                parts.items[0].stmts = top_level_stmts;
            }

            var top_level_symbols_to_parts = js_ast.Ast.TopLevelSymbolToParts{};
            var top_level = &top_level_symbols_to_parts;

            if (p.options.bundle) {
                const Ctx = struct {
                    allocator: std.mem.Allocator,
                    top_level_symbols_to_parts: *js_ast.Ast.TopLevelSymbolToParts,
                    symbols: []const js_ast.Symbol,
                    part_index: u32,

                    pub fn next(ctx: @This(), input: Ref) void {
                        // If this symbol was merged, use the symbol at the end of the
                        // linked list in the map. This is the case for multiple "var"
                        // declarations with the same name, for example.
                        var ref = input;
                        var symbol_ref = &ctx.symbols[ref.innerIndex()];
                        while (symbol_ref.hasLink()) : (symbol_ref = &ctx.symbols[ref.innerIndex()]) {
                            ref = symbol_ref.link;
                        }

                        var entry = ctx.top_level_symbols_to_parts.getOrPut(ctx.allocator, ref) catch unreachable;
                        if (!entry.found_existing) {
                            entry.value_ptr.* = .{};
                        }

                        entry.value_ptr.push(ctx.allocator, @as(u32, @truncate(ctx.part_index))) catch unreachable;
                    }
                };

                // Each part tracks the other parts it depends on within this file
                for (parts.items, 0..) |*part, part_index| {
                    const decls = &part.declared_symbols;
                    const ctx = Ctx{
                        .allocator = p.allocator,
                        .top_level_symbols_to_parts = top_level,
                        .symbols = p.symbols.items,
                        .part_index = @as(u32, @truncate(part_index)),
                    };

                    DeclaredSymbol.forEachTopLevelSymbol(decls, ctx, Ctx.next);
                }

                // Pulling in the exports of this module always pulls in the export part

                {
                    var entry = top_level.getOrPut(p.allocator, p.exports_ref) catch unreachable;

                    if (!entry.found_existing) {
                        entry.value_ptr.* = .{};
                    }

                    entry.value_ptr.push(p.allocator, js_ast.namespace_export_part_index) catch unreachable;
                }
            }

            const wrapper_ref: Ref = brk: {
                if (p.options.features.hot_module_reloading) {
                    break :brk p.hmr_api_ref;
                }

                if (p.options.bundle and p.needsWrapperRef(parts.items)) {
                    break :brk p.newSymbol(
                        .other,
                        std.fmt.allocPrint(
                            p.allocator,
                            "require_{any}",
                            .{p.source.fmtIdentifier()},
                        ) catch bun.outOfMemory(),
                    ) catch bun.outOfMemory();
                }

                break :brk Ref.None;
            };

            const parts_list = bun.BabyList(js_ast.Part).fromList(parts);

            return .{
                .runtime_imports = p.runtime_imports,
                .parts = parts_list,
                .module_scope = p.module_scope.*,
                .symbols = js_ast.Symbol.List.fromList(p.symbols),
                .exports_ref = p.exports_ref,
                .wrapper_ref = wrapper_ref,
                .module_ref = p.module_ref,
                .import_records = ImportRecord.List.fromList(p.import_records),
                .export_star_import_records = p.export_star_import_records.items,
                .approximate_newline_count = p.lexer.approximate_newline_count,
                .exports_kind = exports_kind,
                .named_imports = p.named_imports,
                .named_exports = p.named_exports,
                .import_keyword = p.esm_import_keyword,
                .export_keyword = p.esm_export_keyword,
                .top_level_symbols_to_parts = top_level_symbols_to_parts,
                .char_freq = p.computeCharacterFrequency(),
                .directive = if (p.module_scope.strict_mode == .explicit_strict_mode) "use strict" else null,

                // Assign slots to symbols in nested scopes. This is some precomputation for
                // the symbol renaming pass that will happen later in the linker. It's done
                // now in the parser because we want it to be done in parallel per file and
                // we're already executing code in parallel here
                .nested_scope_slot_counts = if (p.options.features.minify_identifiers)
                    renamer.assignNestedScopeSlots(p.allocator, p.module_scope, p.symbols.items)
                else
                    js_ast.SlotCounts{},

                .require_ref = if (p.runtime_imports.__require != null)
                    p.runtime_imports.__require.?
                else
                    p.require_ref,

                .force_cjs_to_esm = p.unwrap_all_requires or exports_kind == .esm_with_dynamic_fallback_from_cjs,
                .uses_module_ref = p.symbols.items[p.module_ref.inner_index].use_count_estimate > 0,
                .uses_exports_ref = p.symbols.items[p.exports_ref.inner_index].use_count_estimate > 0,
                .uses_require_ref = if (p.options.bundle)
                    p.runtime_imports.__require != null and
                        p.symbols.items[p.runtime_imports.__require.?.inner_index].use_count_estimate > 0
                else
                    p.symbols.items[p.require_ref.inner_index].use_count_estimate > 0,
                .commonjs_module_exports_assigned_deoptimized = p.commonjs_module_exports_assigned_deoptimized,
                .top_level_await_keyword = p.top_level_await_keyword,
                .commonjs_named_exports = p.commonjs_named_exports,
                .has_commonjs_export_names = p.has_commonjs_export_names,

                .hashbang = hashbang,

                // TODO: cross-module constant inlining
                // .const_values = p.const_values,
                .ts_enums = try p.computeTsEnumsMap(allocator),

                .import_meta_ref = p.import_meta_ref,
            };
        }

        /// The bundler will generate wrappers to contain top-level side effects using
        /// the '__esm' helper. Example:
        ///
        ///     var init_foo = __esm(() => {
        ///         someExport = Math.random();
        ///     });
        ///
        /// This wrapper can be removed if all of the constructs get moved
        /// outside of the file. Due to paralleization, we can't retroactively
        /// delete the `init_foo` symbol, but instead it must be known far in
        /// advance if the symbol is needed or not.
        ///
        /// The logic in this function must be in sync with the hoisting
        /// logic in `LinkerContext.generateCodeForFileInChunkJS`
        fn needsWrapperRef(p: *const P, parts: []const js_ast.Part) bool {
            bun.assert(p.options.bundle);
            for (parts) |part| {
                for (part.stmts) |stmt| {
                    switch (stmt.data) {
                        .s_function => {},
                        .s_class => |class| if (!class.class.canBeMoved()) return true,
                        .s_local => |local| {
                            if (local.was_commonjs_export or p.commonjs_named_exports.count() == 0) {
                                for (local.decls.slice()) |decl| {
                                    if (decl.value) |value|
                                        if (value.data != .e_missing and !value.canBeMoved())
                                            return true;
                                }
                                continue;
                            }
                            return true;
                        },
                        .s_export_default => |ed| {
                            if (!ed.canBeMoved())
                                return true;
                        },
                        .s_export_equals => |e| {
                            if (!e.value.canBeMoved())
                                return true;
                        },
                        else => return true,
                    }
                }
            }
            return false;
        }

        pub fn init(
            allocator: Allocator,
            log: *logger.Log,
            source: *const logger.Source,
            define: *Define,
            lexer: js_lexer.Lexer,
            opts: Parser.Options,
            this: *P,
        ) anyerror!void {
            var scope_order = try ScopeOrderList.initCapacity(allocator, 1);
            const scope = try allocator.create(Scope);
            scope.* = Scope{
                .members = .{},
                .children = .{},
                .generated = .{},
                .kind = .entry,
                .label_ref = null,
                .parent = null,
            };

            scope_order.appendAssumeCapacity(ScopeOrder{ .loc = locModuleScope, .scope = scope });
            this.* = P{
                .legacy_cjs_import_stmts = @TypeOf(this.legacy_cjs_import_stmts).init(allocator),
                // This must default to true or else parsing "in" won't work right.
                // It will fail for the case in the "in-keyword.js" file
                .allow_in = true,

                .call_target = nullExprData,
                .delete_target = nullExprData,
                .stmt_expr_value = nullExprData,
                .loop_body = nullStmtData,
                .define = define,
                .import_records = undefined,
                .named_imports = undefined,
                .named_exports = .{},
                .log = log,
                .stack_check = bun.StackCheck.init(),
                .allocator = allocator,
                .options = opts,
                .then_catch_chain = ThenCatchChain{ .next_target = nullExprData },
                .to_expr_wrapper_namespace = undefined,
                .to_expr_wrapper_hoisted = undefined,
                .import_transposer = undefined,
                .require_transposer = undefined,
                .require_resolve_transposer = undefined,
                .source = source,
                .macro = MacroState.init(allocator),
                .current_scope = scope,
                .module_scope = scope,
                .scopes_in_order = scope_order,
                .needs_jsx_import = if (comptime only_scan_imports_and_do_not_visit) false else NeedsJSXType{},
                .lexer = lexer,

                // Only enable during bundling, when not bundling CJS
                .commonjs_named_exports_deoptimized = if (opts.bundle) opts.output_format == .cjs else true,
            };
            this.lexer.track_comments = opts.features.minify_identifiers;

            this.unwrap_all_requires = brk: {
                if (opts.bundle and opts.output_format != .cjs) {
                    if (source.path.packageName()) |pkg| {
                        if (opts.features.shouldUnwrapRequire(pkg)) {
                            if (strings.eqlComptime(pkg, "react") or strings.eqlComptime(pkg, "react-dom")) {
                                const version = opts.package_version;
                                if (version.len > 2 and (version[0] == '0' or (version[0] == '1' and version[1] < '8'))) {
                                    break :brk false;
                                }
                            }

                            break :brk true;
                        }
                    }
                }

                break :brk false;
            };

            this.symbols = std.ArrayList(Symbol).init(allocator);

            if (comptime !only_scan_imports_and_do_not_visit) {
                this.import_records = @TypeOf(this.import_records).init(allocator);
                this.named_imports = .{};
            }

            this.to_expr_wrapper_namespace = Binding2ExprWrapper.Namespace.init(this);
            this.to_expr_wrapper_hoisted = Binding2ExprWrapper.Hoisted.init(this);
            this.import_transposer = @TypeOf(this.import_transposer).init(this);
            this.require_transposer = @TypeOf(this.require_transposer).init(this);
            this.require_resolve_transposer = @TypeOf(this.require_resolve_transposer).init(this);

            if (opts.features.top_level_await or comptime only_scan_imports_and_do_not_visit) {
                this.fn_or_arrow_data_parse.allow_await = .allow_expr;
                this.fn_or_arrow_data_parse.is_top_level = true;
            }

            if (comptime !is_typescript_enabled) {
                // This is so it doesn't impact runtime transpiler caching when not in use
                this.options.features.emit_decorator_metadata = false;
            }
        }
    };
}

// Doing this seems to yield a 1% performance improvement parsing larger files
// ❯ hyperfine "../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable" "../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable" --min-runs=500
// Benchmark #1: ../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable
//   Time (mean ± σ):      25.1 ms ±   1.1 ms    [User: 20.4 ms, System: 3.1 ms]
//   Range (min … max):    23.5 ms …  31.7 ms    500 runs

// Benchmark #2: ../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable
//   Time (mean ± σ):      25.6 ms ±   1.3 ms    [User: 20.9 ms, System: 3.1 ms]
//   Range (min … max):    24.1 ms …  39.7 ms    500 runs
// '../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable' ran
// 1.02 ± 0.07 times faster than '../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable'
pub const JavaScriptParser = if (bun.fast_debug_build_mode)
    TSXParser
else
    NewParser(.{});
pub const JSXParser = if (bun.fast_debug_build_mode)
    TSXParser
else
    NewParser(.{ .jsx = .react });
pub const TSXParser = NewParser(.{ .jsx = .react, .typescript = true });
pub const TypeScriptParser = NewParser(.{ .typescript = true });
pub const JavaScriptImportScanner = if (bun.fast_debug_build_mode) TSXImportScanner else NewParser(.{ .scan_only = true });
pub const JSXImportScanner = if (bun.fast_debug_build_mode) TSXImportScanner else NewParser(.{ .jsx = .react, .scan_only = true });
pub const TSXImportScanner = NewParser(.{ .jsx = .react, .typescript = true, .scan_only = true });
pub const TypeScriptImportScanner = if (bun.fast_debug_build_mode) TSXImportScanner else NewParser(.{ .typescript = true, .scan_only = true });

// The "await" and "yield" expressions are never allowed in argument lists but
// may or may not be allowed otherwise depending on the details of the enclosing
// function or module. This needs to be handled when parsing an arrow function
// argument list because we don't know if these expressions are not allowed until
// we reach the "=>" token (or discover the absence of one).
//
// Specifically, for await:
//
//   // This is ok
//   async function foo() { (x = await y) }
//
//   // This is an error
//   async function foo() { (x = await y) => {} }
//
// And for yield:
//
//   // This is ok
//   function* foo() { (x = yield y) }
//
//   // This is an error
//   function* foo() { (x = yield y) => {} }
//
pub const DeferredArrowArgErrors = struct {
    invalid_expr_await: logger.Range = logger.Range.None,
    invalid_expr_yield: logger.Range = logger.Range.None,
};

pub fn newLazyExportAST(
    allocator: std.mem.Allocator,
    define: *Define,
    opts: Parser.Options,
    log_to_copy_into: *logger.Log,
    expr: Expr,
    source: *const logger.Source,
    comptime runtime_api_call: []const u8,
) anyerror!?js_ast.Ast {
    return newLazyExportASTImpl(allocator, define, opts, log_to_copy_into, expr, source, runtime_api_call, .{});
}

pub fn newLazyExportASTImpl(
    allocator: std.mem.Allocator,
    define: *Define,
    opts: Parser.Options,
    log_to_copy_into: *logger.Log,
    expr: Expr,
    source: *const logger.Source,
    comptime runtime_api_call: []const u8,
    symbols: Symbol.List,
) anyerror!?js_ast.Ast {
    var temp_log = logger.Log.init(allocator);
    const log = &temp_log;
    var parser = Parser{
        .options = opts,
        .allocator = allocator,
        .lexer = js_lexer.Lexer.initWithoutReading(log, source, allocator),
        .define = define,
        .source = source,
        .log = log,
    };
    var result = parser.toLazyExportAST(
        expr,
        runtime_api_call,
        symbols,
    ) catch |err| {
        if (temp_log.errors == 0) {
            log_to_copy_into.addRangeError(source, parser.lexer.range(), @errorName(err)) catch unreachable;
        }

        temp_log.appendToMaybeRecycled(log_to_copy_into, source) catch {};
        return null;
    };

    temp_log.appendToMaybeRecycled(log_to_copy_into, source) catch {};
    result.ast.has_lazy_export = true;
    return result.ast;
}

pub const WrapMode = enum {
    none,
    bun_commonjs,
};

/// "Fast Refresh" is React's solution for hot-module-reloading in the context of the UI framework
/// user guide: https://reactnative.dev/docs/fast-refresh (applies to react-dom and native)
///
/// This depends on performing a couple extra transformations at bundle time, as well as
/// including the `react-refresh` NPM package, which is able to do the heavy lifting,
/// integrating with `react` and `react-dom`.
///
/// Prior implementations:
///  [1]: https://github.com/facebook/react/blob/main/packages/react-refresh/src/ReactFreshBabelPlugin.js
///  [2]: https://github.com/swc-project/swc/blob/main/crates/swc_ecma_transforms_react/src/refresh/mod.rs
///
/// Additional reading:
///  [3] https://github.com/facebook/react/issues/16604#issuecomment-528663101
///  [4] https://github.com/facebook/react/blob/master/packages/react-refresh/src/__tests__/ReactFreshIntegration-test.js
///
/// Instead of a plugin which visits the tree separately, Bun's implementation of fast refresh
/// happens in tandem with the visit pass. The responsibilities of the transform are as follows:
///
/// 1. For all Components (which is defined as any top-level function/function variable, that is
///    named with a capital letter; see `isComponentishName`), register them to the runtime using
///    `$RefreshReg$(ComponentFunction, "Component");`. Implemented in `p.handleReactRefreshRegister`
///    HOC components are also registered, but only through a special case for `export default`
///
/// 2. For all functions which call a Hook (a hook is an identifier matching /^use[A-Z]/):
///     a. Outside of the function, create a signature function `const _s = $RefreshSig$();`
///     b. At the start of the function, call `_s()`
///     c. Record all of the hooks called, the variables they are assigned to, and
///        arguments depending on which hook has been used. `useState` and `useReducer`,
///        for example, are special-cased.
///     d. Directly after the function, call `_s(hook, "<hash>", forceReset)`
///         - If a user-defined hook is called, the alterate form is used:
///           `_s(hook, "<hash>", forceReset, () => [useCustom1, useCustom2])`
///
/// The upstream transforms do not declare `$RefreshReg$` or `$RefreshSig$`. A typical
/// implementation might look like this, prepending this data to the module start:
///
///     import * as Refresh from 'react-refresh/runtime';
///     const $RefreshReg$ = (type, id) => Refresh.register(type, "<file id here>" + id);
///     const $RefreshSig$ = Refresh.createSignatureFunctionForTransform;
///
/// Since Bun is a transpiler *and* bundler, we take a slightly different approach. Aside
/// from including the link to the refresh runtime, our notation of $RefreshReg$ is just
/// pointing at `Refresh.register`, which means when we call it, the second argument has
/// to be a string containing the filepath, not just the component name.
pub const ReactRefresh = struct {
    // Set if this JSX/TSX file uses the refresh runtime. If so,
    // we must insert an import statement to it.
    register_used: bool = false,
    signature_used: bool = false,

    /// $RefreshReg$ is called on all top-level variables that are
    /// components, as well as HOCs found in the `export default` clause.
    register_ref: Ref = Ref.None,

    /// $RefreshSig$ is called to create a signature function, which is
    /// used by the refresh runtime to perform smart hook tracking.
    create_signature_ref: Ref = Ref.None,

    /// If a comment with '@refresh reset' is seen, we will forward a
    /// force refresh to the refresh runtime. This lets you reset the
    /// state of hooks on an update on a per-component basis.
    // TODO: this is never set
    force_reset: bool = false,

    /// The last hook that was scanned. This is used when visiting
    /// `.s_local`, as we must hash the variable destructure if the
    /// hook's result is assigned directly to a local.
    last_hook_seen: ?*E.Call = null,

    /// Every function sets up stack memory to hold data related to it's
    /// hook tracking. This is a pointer to that ?HookContext, where an
    /// inner null means there are no hook calls.
    ///
    /// The inner value is initialized when the first hook .e_call is
    /// visited, where the '_s' symbol is reserved. Additional hook calls
    /// append to the `hasher` and `user_hooks` as needed.
    ///
    /// When a function is done visiting, the stack location is checked,
    /// and then it will insert `var _s = ...`, add the `_s()` call at
    /// the start of the function, and then add the call to `_s(func, ...)`.
    hook_ctx_storage: ?*?HookContext = null,

    /// This is the most recently generated `_s` call. This is used to compare
    /// against seen calls to plain identifiers when in "export default" and in
    /// "const Component =" to know if an expression had been wrapped in a hook
    /// signature function.
    latest_signature_ref: Ref = Ref.None,

    pub const HookContext = struct {
        hasher: std.hash.Wyhash,
        signature_cb: Ref,
        user_hooks: std.AutoArrayHashMapUnmanaged(Ref, Expr),
    };

    // https://github.com/facebook/react/blob/d1afcb43fd506297109c32ff462f6f659f9110ae/packages/react-refresh/src/ReactFreshBabelPlugin.js#L42
    pub fn isComponentishName(id: []const u8) bool {
        if (id.len == 0) return false;
        return switch (id[0]) {
            'A'...'Z' => true,
            else => false,
        };
    }

    // https://github.com/facebook/react/blob/d1afcb43fd506297109c32ff462f6f659f9110ae/packages/react-refresh/src/ReactFreshBabelPlugin.js#L408
    pub fn isHookName(id: []const u8) bool {
        return id.len >= 4 and
            strings.hasPrefixComptime(id, "use") and
            switch (id[3]) {
                'A'...'Z' => true,
                else => false,
            };
    }

    pub const built_in_hooks = bun.ComptimeEnumMap(enum {
        useState,
        useReducer,
        useEffect,
        useLayoutEffect,
        useMemo,
        useCallback,
        useRef,
        useContext,
        useImperativeHandle,
        useDebugValue,
        useId,
        useDeferredValue,
        useTransition,
        useInsertionEffect,
        useSyncExternalStore,
        useFormStatus,
        useFormState,
        useActionState,
        useOptimistic,
    });
};

pub const ConvertESMExportsForHmr = struct {
    last_part: *js_ast.Part,
    // files in node modules will not get hot updates, so the code generation
    // can be a bit more concise for re-exports
    is_in_node_modules: bool,
    imports_seen: bun.StringArrayHashMapUnmanaged(ImportRef) = .{},
    export_star_props: std.ArrayListUnmanaged(G.Property) = .{},
    export_props: std.ArrayListUnmanaged(G.Property) = .{},
    stmts: std.ArrayListUnmanaged(Stmt) = .{},

    const ImportRef = struct {
        /// Index into ConvertESMExportsForHmr.stmts
        stmt_index: u32,
    };

    fn convertStmt(ctx: *ConvertESMExportsForHmr, p: anytype, stmt: Stmt) !void {
        const new_stmt = switch (stmt.data) {
            else => brk: {
                break :brk stmt;
            },
            .s_local => |st| stmt: {
                if (!st.is_export) {
                    break :stmt stmt;
                }

                st.is_export = false;

                var new_len: usize = 0;
                for (st.decls.slice()) |*decl_ptr| {
                    const decl = decl_ptr.*; // explicit copy to avoid aliasinng
                    const value = decl.value orelse {
                        st.decls.mut(new_len).* = decl;
                        new_len += 1;
                        try ctx.visitBindingToExport(p, decl.binding);
                        continue;
                    };

                    switch (decl.binding.data) {
                        .b_missing => {},

                        .b_identifier => |id| {
                            const symbol = p.symbols.items[id.ref.inner_index];

                            // if the symbol is not used, we don't need to preserve
                            // a binding in this scope. we can move it to the exports object.
                            if (symbol.use_count_estimate == 0 and value.canBeMoved()) {
                                try ctx.export_props.append(p.allocator, .{
                                    .key = Expr.init(E.String, .{ .data = symbol.original_name }, decl.binding.loc),
                                    .value = value,
                                });
                            } else {
                                st.decls.mut(new_len).* = decl;
                                new_len += 1;
                                try ctx.visitBindingToExport(p, decl.binding);
                            }
                        },

                        else => {
                            st.decls.mut(new_len).* = decl;
                            new_len += 1;
                            try ctx.visitBindingToExport(p, decl.binding);
                        },
                    }
                }
                if (new_len == 0) {
                    return;
                }
                st.decls.len = @intCast(new_len);

                break :stmt stmt;
            },
            .s_export_default => |st| stmt: {
                // When React Fast Refresh needs to tag the default export, the statement
                // cannot be moved, since a local reference is required.
                if (p.options.features.react_fast_refresh and
                    st.value == .stmt and st.value.stmt.data == .s_function)
                fast_refresh_edge_case: {
                    const symbol = st.value.stmt.data.s_function.func.name orelse
                        break :fast_refresh_edge_case;
                    const name = p.symbols.items[symbol.ref.?.inner_index].original_name;
                    if (ReactRefresh.isComponentishName(name)) {
                        // Lower to a function statement, and reference the function in the export list.
                        try ctx.export_props.append(p.allocator, .{
                            .key = Expr.init(E.String, .{ .data = "default" }, stmt.loc),
                            .value = Expr.initIdentifier(symbol.ref.?, stmt.loc),
                        });
                        break :stmt st.value.stmt;
                    }
                    // All other functions can be properly moved.
                }

                // Try to move the export default expression to the end.
                const can_be_moved_to_inner_scope = switch (st.value) {
                    .stmt => |s| switch (s.data) {
                        .s_class => |c| c.class.canBeMoved() and (if (c.class.class_name) |name|
                            p.symbols.items[name.ref.?.inner_index].use_count_estimate == 0
                        else
                            true),
                        .s_function => |f| if (f.func.name) |name|
                            p.symbols.items[name.ref.?.inner_index].use_count_estimate == 0
                        else
                            true,
                        else => unreachable,
                    },
                    .expr => |e| switch (e.data) {
                        .e_identifier => true,
                        else => e.canBeMoved(),
                    },
                };
                if (can_be_moved_to_inner_scope) {
                    try ctx.export_props.append(p.allocator, .{
                        .key = Expr.init(E.String, .{ .data = "default" }, stmt.loc),
                        .value = st.value.toExpr(),
                    });
                    // no statement emitted
                    return;
                }

                // Otherwise, an identifier must be exported
                switch (st.value) {
                    .expr => {
                        const temp_id = p.generateTempRef("default_export");
                        try ctx.last_part.declared_symbols.append(p.allocator, .{ .ref = temp_id, .is_top_level = true });
                        try ctx.last_part.symbol_uses.putNoClobber(p.allocator, temp_id, .{ .count_estimate = 1 });
                        try p.current_scope.generated.push(p.allocator, temp_id);

                        try ctx.export_props.append(p.allocator, .{
                            .key = Expr.init(E.String, .{ .data = "default" }, stmt.loc),
                            .value = Expr.initIdentifier(temp_id, stmt.loc),
                        });

                        break :stmt Stmt.alloc(S.Local, .{
                            .kind = .k_const,
                            .decls = try G.Decl.List.fromSlice(p.allocator, &.{
                                .{
                                    .binding = Binding.alloc(p.allocator, B.Identifier{ .ref = temp_id }, stmt.loc),
                                    .value = st.value.toExpr(),
                                },
                            }),
                        }, stmt.loc);
                    },
                    .stmt => |s| {
                        try ctx.export_props.append(p.allocator, .{
                            .key = Expr.init(E.String, .{ .data = "default" }, stmt.loc),
                            .value = Expr.initIdentifier(switch (s.data) {
                                .s_class => |class| class.class.class_name.?.ref.?,
                                .s_function => |func| func.func.name.?.ref.?,
                                else => unreachable,
                            }, stmt.loc),
                        });
                        break :stmt s;
                    },
                }
            },
            .s_class => |st| stmt: {

                // Strip the "export" keyword
                if (!st.is_export) {
                    break :stmt stmt;
                }

                // Export as CommonJS
                try ctx.export_props.append(p.allocator, .{
                    .key = Expr.init(E.String, .{
                        .data = p.symbols.items[st.class.class_name.?.ref.?.inner_index].original_name,
                    }, stmt.loc),
                    .value = Expr.initIdentifier(st.class.class_name.?.ref.?, stmt.loc),
                });

                st.is_export = false;

                break :stmt stmt;
            },
            .s_function => |st| stmt: {
                // Strip the "export" keyword
                if (!st.func.flags.contains(.is_export)) break :stmt stmt;

                st.func.flags.remove(.is_export);

                try ctx.visitRefToExport(
                    p,
                    st.func.name.?.ref.?,
                    null,
                    stmt.loc,
                    false,
                );

                break :stmt stmt;
            },
            .s_export_clause => |st| {
                for (st.items) |item| {
                    const ref = item.name.ref.?;
                    try ctx.visitRefToExport(p, ref, item.alias, item.name.loc, false);
                }

                return; // do not emit a statement here
            },
            .s_export_from => |st| {
                const namespace_ref = try ctx.deduplicatedImport(
                    p,
                    st.import_record_index,
                    st.namespace_ref,
                    st.items,
                    stmt.loc,
                    null,
                    stmt.loc,
                );
                for (st.items) |*item| {
                    const ref = item.name.ref.?;
                    const symbol = &p.symbols.items[ref.innerIndex()];
                    if (symbol.namespace_alias == null) {
                        symbol.namespace_alias = .{
                            .namespace_ref = namespace_ref,
                            .alias = item.original_name,
                            .import_record_index = st.import_record_index,
                        };
                    }
                    try ctx.visitRefToExport(
                        p,
                        ref,
                        item.alias,
                        item.name.loc,
                        !ctx.is_in_node_modules, // live binding when this may be replaced
                    );

                    // imports and export statements have their alias +
                    // original_name swapped. this is likely a design bug in
                    // the parser but since everything uses these
                    // assumptions, this hack is simpler than making it
                    // proper
                    const alias = item.alias;
                    item.alias = item.original_name;
                    item.original_name = alias;
                }
                return;
            },
            .s_export_star => |st| {
                const namespace_ref = try ctx.deduplicatedImport(
                    p,
                    st.import_record_index,
                    st.namespace_ref,
                    &.{},
                    stmt.loc,
                    null,
                    stmt.loc,
                );

                if (st.alias) |alias| {
                    // 'export * as ns from' creates one named property.
                    try ctx.export_props.append(p.allocator, .{
                        .key = Expr.init(E.String, .{ .data = alias.original_name }, stmt.loc),
                        .value = Expr.initIdentifier(namespace_ref, stmt.loc),
                    });
                } else {
                    // 'export * from' creates a spread, hoisted at the top.
                    try ctx.export_star_props.append(p.allocator, .{
                        .kind = .spread,
                        .value = Expr.initIdentifier(namespace_ref, stmt.loc),
                    });
                }
                return;
            },
            // De-duplicate import statements. It is okay to disregard
            // named/default imports here as we always rewrite them as
            // full qualified property accesses (needed for live-bindings)
            .s_import => |st| {
                _ = try ctx.deduplicatedImport(
                    p,
                    st.import_record_index,
                    st.namespace_ref,
                    st.items,
                    st.star_name_loc,
                    st.default_name,
                    stmt.loc,
                );
                return;
            },
        };

        try ctx.stmts.append(p.allocator, new_stmt);
    }

    /// Deduplicates imports, returning a previously used Ref if present.
    fn deduplicatedImport(
        ctx: *ConvertESMExportsForHmr,
        p: anytype,
        import_record_index: u32,
        namespace_ref: Ref,
        items: []js_ast.ClauseItem,
        star_name_loc: ?logger.Loc,
        default_name: ?js_ast.LocRef,
        loc: logger.Loc,
    ) !Ref {
        const ir = &p.import_records.items[import_record_index];
        const gop = try ctx.imports_seen.getOrPut(p.allocator, ir.path.text);
        if (gop.found_existing) {
            // Disable this one since an older record is getting used.  It isn't
            // practical to delete this import record entry since an import or
            // require expression can exist.
            ir.is_unused = true;

            const stmt = ctx.stmts.items[gop.value_ptr.stmt_index].data.s_import;
            if (items.len > 0) {
                if (stmt.items.len == 0) {
                    stmt.items = items;
                } else {
                    stmt.items = try std.mem.concat(p.allocator, js_ast.ClauseItem, &.{ stmt.items, items });
                }
            }
            if (namespace_ref.isValid()) {
                if (!stmt.namespace_ref.isValid()) {
                    stmt.namespace_ref = namespace_ref;
                    return namespace_ref;
                } else {
                    // Erase this namespace ref, but since it may be used in
                    // existing AST trees, a link must be established.
                    const symbol = &p.symbols.items[namespace_ref.innerIndex()];
                    symbol.use_count_estimate = 0;
                    symbol.link = stmt.namespace_ref;
                    if (@hasField(@typeInfo(@TypeOf(p)).pointer.child, "symbol_uses")) {
                        _ = p.symbol_uses.swapRemove(namespace_ref);
                    }
                }
            }
            if (stmt.star_name_loc == null) if (star_name_loc) |stl| {
                stmt.star_name_loc = stl;
            };
            if (stmt.default_name == null) if (default_name) |dn| {
                stmt.default_name = dn;
            };
            return stmt.namespace_ref;
        }

        try ctx.stmts.append(p.allocator, Stmt.alloc(S.Import, .{
            .import_record_index = import_record_index,
            .is_single_line = true,
            .default_name = default_name,
            .items = items,
            .namespace_ref = namespace_ref,
            .star_name_loc = star_name_loc,
        }, loc));

        gop.value_ptr.* = .{ .stmt_index = @intCast(ctx.stmts.items.len - 1) };
        return namespace_ref;
    }

    fn visitBindingToExport(ctx: *ConvertESMExportsForHmr, p: anytype, binding: Binding) !void {
        switch (binding.data) {
            .b_missing => {},
            .b_identifier => |id| {
                try ctx.visitRefToExport(p, id.ref, null, binding.loc, false);
            },
            .b_array => |array| {
                for (array.items) |item| {
                    try ctx.visitBindingToExport(p, item.binding);
                }
            },
            .b_object => |object| {
                for (object.properties) |item| {
                    try ctx.visitBindingToExport(p, item.value);
                }
            },
        }
    }

    fn visitRefToExport(
        ctx: *ConvertESMExportsForHmr,
        p: anytype,
        ref: Ref,
        export_symbol_name: ?[]const u8,
        loc: logger.Loc,
        is_live_binding_source: bool,
    ) !void {
        const symbol = p.symbols.items[ref.inner_index];
        const id = if (symbol.kind == .import)
            Expr.init(E.ImportIdentifier, .{ .ref = ref }, loc)
        else
            Expr.initIdentifier(ref, loc);
        if (is_live_binding_source or (symbol.kind == .import and !ctx.is_in_node_modules) or symbol.has_been_assigned_to) {
            // TODO (2024-11-24) instead of requiring getters for live-bindings,
            // a callback propagation system should be considered.  mostly
            // because here, these might not even be live bindings, and
            // re-exports are so, so common.
            //
            // update(2025-03-05): HMRModule in ts now contains an exhaustive map
            // of importers. For local live bindings, these can just remember to
            // mutate the field in the exports object. Re-exports can just be
            // encoded into the module format, propagated in `replaceModules`
            const key = Expr.init(E.String, .{
                .data = export_symbol_name orelse symbol.original_name,
            }, loc);

            // This is technically incorrect in that we've marked this as a
            // top level symbol. but all we care about is preventing name
            // collisions, not necessarily the best minificaiton (dev only)
            const arg1 = p.generateTempRef(symbol.original_name);
            try ctx.last_part.declared_symbols.append(p.allocator, .{ .ref = arg1, .is_top_level = true });
            try ctx.last_part.symbol_uses.putNoClobber(p.allocator, arg1, .{ .count_estimate = 1 });
            try p.current_scope.generated.push(p.allocator, arg1);

            // 'get abc() { return abc }'
            try ctx.export_props.append(p.allocator, .{
                .kind = .get,
                .key = key,
                .value = Expr.init(E.Function, .{ .func = .{
                    .body = .{
                        .stmts = try p.allocator.dupe(Stmt, &.{
                            Stmt.alloc(S.Return, .{ .value = id }, loc),
                        }),
                        .loc = loc,
                    },
                } }, loc),
            });
            // no setter is added since live bindings are read-only
        } else {
            // 'abc,'
            try ctx.export_props.append(p.allocator, .{
                .key = Expr.init(E.String, .{
                    .data = export_symbol_name orelse symbol.original_name,
                }, loc),
                .value = id,
            });
        }
    }

    pub fn finalize(ctx: *ConvertESMExportsForHmr, p: anytype, all_parts: []js_ast.Part) !void {
        if (ctx.export_star_props.items.len > 0) {
            if (ctx.export_props.items.len == 0) {
                ctx.export_props = ctx.export_star_props;
            } else {
                const export_star_len = ctx.export_star_props.items.len;
                try ctx.export_props.ensureUnusedCapacity(p.allocator, export_star_len);
                const len = ctx.export_props.items.len;
                ctx.export_props.items.len += export_star_len;
                bun.copy(G.Property, ctx.export_props.items[export_star_len..], ctx.export_props.items[0..len]);
                @memcpy(ctx.export_props.items[0..export_star_len], ctx.export_star_props.items);
            }
        }

        if (ctx.export_props.items.len > 0) {
            const obj = Expr.init(E.Object, .{
                .properties = G.Property.List.fromList(ctx.export_props),
            }, logger.Loc.Empty);

            // `hmr.exports = ...`
            try ctx.stmts.append(p.allocator, Stmt.alloc(S.SExpr, .{
                .value = Expr.assign(
                    Expr.init(E.Dot, .{
                        .target = Expr.initIdentifier(p.hmr_api_ref, logger.Loc.Empty),
                        .name = "exports",
                        .name_loc = logger.Loc.Empty,
                    }, logger.Loc.Empty),
                    obj,
                ),
            }, logger.Loc.Empty));

            // mark a dependency on module_ref so it is renamed
            try ctx.last_part.symbol_uses.put(p.allocator, p.module_ref, .{ .count_estimate = 1 });
            try ctx.last_part.declared_symbols.append(p.allocator, .{ .ref = p.module_ref, .is_top_level = true });
        }

        if (p.options.features.react_fast_refresh and p.react_refresh.register_used) {
            try ctx.stmts.append(p.allocator, Stmt.alloc(S.SExpr, .{
                .value = Expr.init(E.Call, .{
                    .target = Expr.init(E.Dot, .{
                        .target = Expr.initIdentifier(p.hmr_api_ref, .Empty),
                        .name = "reactRefreshAccept",
                        .name_loc = .Empty,
                    }, .Empty),
                    .args = .init(&.{}),
                }, .Empty),
            }, .Empty));
        }

        // Merge all part metadata into the first part.
        for (all_parts[0 .. all_parts.len - 1]) |*part| {
            try ctx.last_part.declared_symbols.appendList(p.allocator, part.declared_symbols);
            try ctx.last_part.import_record_indices.append(p.allocator, part.import_record_indices.slice());
            for (part.symbol_uses.keys(), part.symbol_uses.values()) |k, v| {
                const gop = try ctx.last_part.symbol_uses.getOrPut(p.allocator, k);
                if (!gop.found_existing) {
                    gop.value_ptr.* = v;
                } else {
                    gop.value_ptr.count_estimate += v.count_estimate;
                }
            }
            part.stmts = &.{};
            part.declared_symbols.entries.len = 0;
            part.tag = .dead_due_to_inlining;
            part.dependencies.clearRetainingCapacity();
            try part.dependencies.push(p.allocator, .{
                .part_index = @intCast(all_parts.len - 1),
                .source_index = p.source.index,
            });
        }

        try ctx.last_part.import_record_indices.append(p.allocator, p.import_records_for_current_part.items);
        try ctx.last_part.declared_symbols.appendList(p.allocator, p.declared_symbols);

        ctx.last_part.stmts = ctx.stmts.items;
        ctx.last_part.tag = .none;
    }
};

/// Equivalent of esbuild's js_ast_helpers.ToInt32
pub fn floatToInt32(f: f64) i32 {
    // Special-case non-finite numbers
    if (!std.math.isFinite(f))
        return 0;

    const uint: u32 = @intFromFloat(@mod(@abs(f), std.math.maxInt(u32) + 1));
    const int: i32 = @bitCast(uint);
    return if (f < 0) @as(i32, 0) -% int else int;
}

pub const ParseBindingOptions = struct {
    /// This will prevent parsing of destructuring patterns, as using statement
    /// is only allowed to be `using name, name2, name3`, nothing special.
    is_using_statement: bool = false,
};

// @sortImports

const FeatureFlags = @import("./feature_flags.zig");
const _runtime = @import("./runtime.zig");
pub const fs = @import("./fs.zig");
pub const options = @import("./options.zig");
pub const renamer = @import("./renamer.zig");
const ObjectPool = @import("./pool.zig").ObjectPool;
pub const Parser = @import("ast/Parser.zig").Parser;
pub const SideEffects = @import("ast/SideEffects.zig").SideEffects;
pub const isPackagePath = @import("./resolver/resolver.zig").isPackagePath;

const Index = @import("./ast/base.zig").Index;
pub const Ref = @import("./ast/base.zig").Ref;
const RefCtx = @import("./ast/base.zig").RefCtx;

const Define = @import("./defines.zig").Define;
const DefineData = @import("./defines.zig").DefineData;

pub const importRecord = @import("./import_record.zig");
pub const ImportKind = importRecord.ImportKind;
const ImportRecord = importRecord.ImportRecord;

pub const RuntimeFeatures = _runtime.Runtime.Features;
pub const RuntimeImports = _runtime.Runtime.Imports;
pub const RuntimeNames = _runtime.Runtime.Names;

const bun = @import("bun");
const Environment = bun.Environment;
const JSC = bun.JSC;
const Output = bun.Output;
pub const StringHashMap = bun.StringHashMap;
const StringHashMapUnmanaged = bun.StringHashMapUnmanaged;
const assert = bun.assert;
const default_allocator = bun.default_allocator;
pub const js_printer = bun.js_printer;
pub const logger = bun.logger;
const string = bun.string;
const strings = bun.strings;

pub const js_ast = bun.JSAst;
pub const B = js_ast.B;
pub const Binding = js_ast.Binding;
pub const BindingNodeIndex = js_ast.BindingNodeIndex;
pub const BindingNodeList = js_ast.BindingNodeList;
const DeclaredSymbol = js_ast.DeclaredSymbol;
pub const E = js_ast.E;
pub const Expr = js_ast.Expr;
pub const ExprNodeIndex = js_ast.ExprNodeIndex;
pub const ExprNodeList = js_ast.ExprNodeList;
const Flags = js_ast.Flags;
pub const LocRef = js_ast.LocRef;
pub const S = js_ast.S;
pub const Scope = js_ast.Scope;
pub const Stmt = js_ast.Stmt;
pub const StmtNodeIndex = js_ast.StmtNodeIndex;
pub const StmtNodeList = js_ast.StmtNodeList;
pub const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Arg = G.Arg;
const Decl = G.Decl;
const Property = G.Property;

pub const Op = js_ast.Op;
pub const Level = js_ast.Op.Level;

const SymbolPropertyUseMap = js_ast.Part.SymbolPropertyUseMap;
const SymbolUseMap = js_ast.Part.SymbolUseMap;

pub const js_lexer = bun.js_lexer;
pub const T = js_lexer.T;

pub const std = @import("std");
pub const AutoHashMap = std.AutoHashMap;
const List = std.ArrayListUnmanaged;
const ListManaged = std.ArrayList;
const Map = std.AutoHashMapUnmanaged;
const Allocator = std.mem.Allocator;
