/// This represents an internal property name that can be mangled. The symbol
/// referenced by this expression should be a "SymbolMangledProp" symbol.
pub const NameOfSymbol = struct {
    ref: Ref = Ref.None,

    /// If true, a preceding comment contains "@__KEY__"
    ///
    /// Currently not used
    has_property_key_comment: bool = false,
};

pub const Array = struct {
    items: ExprNodeList = ExprNodeList{},
    comma_after_spread: ?logger.Loc = null,
    is_single_line: bool = false,
    is_parenthesized: bool = false,
    was_originally_macro: bool = false,
    close_bracket_loc: logger.Loc = logger.Loc.Empty,

    pub fn push(this: *Array, allocator: std.mem.Allocator, item: Expr) !void {
        try this.items.append(allocator, item);
    }

    pub inline fn slice(this: Array) []Expr {
        return this.items.slice();
    }

    pub fn inlineSpreadOfArrayLiterals(
        this: *Array,
        allocator: std.mem.Allocator,
        estimated_count: usize,
    ) !ExprNodeList {
        var out: bun.BabyList(Expr) = try .initCapacity(
            allocator,
            // This over-allocates a little but it's fine
            estimated_count + @as(usize, this.items.len),
        );
        out.expandToCapacity();
        var remain = out.slice();
        for (this.items.slice()) |item| {
            switch (item.data) {
                .e_spread => |val| {
                    if (val.value.data == .e_array) {
                        for (val.value.data.e_array.items.slice()) |inner_item| {
                            if (inner_item.data == .e_missing) {
                                remain[0] = Expr.init(E.Undefined, .{}, inner_item.loc);
                                remain = remain[1..];
                            } else {
                                remain[0] = inner_item;
                                remain = remain[1..];
                            }
                        }

                        // skip empty arrays
                        // don't include the inlined spread.
                        continue;
                    }
                    // non-arrays are kept in
                },
                else => {},
            }

            remain[0] = item;
            remain = remain[1..];
        }

        out.shrinkRetainingCapacity(out.len - remain.len);
        return out;
    }

    pub fn toJS(this: @This(), allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) ToJSError!jsc.JSValue {
        const items = this.items.slice();
        var array = try jsc.JSValue.createEmptyArray(globalObject, items.len);
        array.protect();
        defer array.unprotect();
        for (items, 0..) |expr, j| {
            try array.putIndex(globalObject, @as(u32, @truncate(j)), try expr.data.toJS(allocator, globalObject));
        }

        return array;
    }

    /// Assumes each item in the array is a string
    pub fn alphabetizeStrings(this: *Array) void {
        if (comptime Environment.allow_assert) {
            for (this.items.slice()) |item| {
                bun.assert(item.data == .e_string);
            }
        }
        std.sort.pdq(Expr, this.items.slice(), {}, Sorter.isLessThan);
    }

    const Sorter = struct {
        pub fn isLessThan(ctx: void, lhs: Expr, rhs: Expr) bool {
            return strings.cmpStringsAsc(ctx, lhs.data.e_string.data, rhs.data.e_string.data);
        }
    };
};

pub const Unary = struct {
    op: Op.Code,
    value: ExprNodeIndex,
    flags: Unary.Flags = .{},

    pub const Flags = packed struct(u8) {
        /// The expression "typeof (0, x)" must not become "typeof x" if "x"
        /// is unbound because that could suppress a ReferenceError from "x".
        ///
        /// Also if we know a typeof operator was originally an identifier, then
        /// we know that this typeof operator always has no side effects (even if
        /// we consider the identifier by itself to have a side effect).
        ///
        /// Note that there *is* actually a case where "typeof x" can throw an error:
        /// when "x" is being referenced inside of its TDZ (temporal dead zone). TDZ
        /// checks are not yet handled correctly by Bun, so this possibility is
        /// currently ignored.
        was_originally_typeof_identifier: bool = false,

        /// Similarly the expression "delete (0, x)" must not become "delete x"
        /// because that syntax is invalid in strict mode. We also need to make sure
        /// we don't accidentally change the return value:
        ///
        ///   Returns false:
        ///     "var a; delete (a)"
        ///     "var a = Object.freeze({b: 1}); delete (a.b)"
        ///     "var a = Object.freeze({b: 1}); delete (a?.b)"
        ///     "var a = Object.freeze({b: 1}); delete (a['b'])"
        ///     "var a = Object.freeze({b: 1}); delete (a?.['b'])"
        ///
        ///   Returns true:
        ///     "var a; delete (0, a)"
        ///     "var a = Object.freeze({b: 1}); delete (true && a.b)"
        ///     "var a = Object.freeze({b: 1}); delete (false || a?.b)"
        ///     "var a = Object.freeze({b: 1}); delete (null ?? a?.['b'])"
        ///
        ///     "var a = Object.freeze({b: 1}); delete (true ? a['b'] : a['b'])"
        was_originally_delete_of_identifier_or_property_access: bool = false,
        _: u6 = 0,
    };
};

pub const Binary = struct {
    left: ExprNodeIndex,
    right: ExprNodeIndex,
    op: Op.Code,
};

pub const Boolean = struct {
    value: bool,
    pub fn toJS(this: @This(), ctx: *jsc.JSGlobalObject) jsc.C.JSValueRef {
        return jsc.C.JSValueMakeBoolean(ctx, this.value);
    }
};
pub const Super = struct {};
pub const Null = struct {};
pub const This = struct {};
pub const Undefined = struct {};
pub const New = struct {
    target: ExprNodeIndex,
    args: ExprNodeList = ExprNodeList{},

    // True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
    // this call expression. See the comment inside ECall for more details.
    can_be_unwrapped_if_unused: CallUnwrap = .never,

    close_parens_loc: logger.Loc,
};
pub const NewTarget = struct {
    range: logger.Range,
};
pub const ImportMeta = struct {};
pub const ImportMetaMain = struct {
    /// If we want to print `!import.meta.main`, set this flag to true
    /// instead of wrapping in a unary not. This way, the printer can easily
    /// print `require.main != module` instead of `!(require.main == module)`
    inverted: bool = false,
};

pub const Special = union(enum) {
    /// emits `exports` or `module.exports` depending on `commonjs_named_exports_deoptimized`
    module_exports,
    /// `import.meta.hot`
    hot_enabled,
    /// Acts as .e_undefined, but allows property accesses to the rest of the HMR API.
    hot_disabled,
    /// `import.meta.hot.data` when HMR is enabled. Not reachable when it is disabled.
    hot_data,
    /// `import.meta.hot.accept` when HMR is enabled. Truthy.
    hot_accept,
    /// Converted from `hot_accept` to this in js_parser.zig when it is
    /// passed strings. Printed as `hmr.hot.acceptSpecifiers`
    hot_accept_visited,
    /// Prints the resolved specifier string for an import record.
    resolved_specifier_string: ImportRecord.Index,
};

pub const Call = struct {
    // Node:
    target: ExprNodeIndex,
    args: ExprNodeList = ExprNodeList{},
    optional_chain: ?OptionalChain = null,
    is_direct_eval: bool = false,
    close_paren_loc: logger.Loc = logger.Loc.Empty,

    // True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
    // this call expression. This is an annotation used for tree shaking, and
    // means that the call can be removed if it's unused. It does not mean the
    // call is pure (e.g. it may still return something different if called twice).
    //
    // Note that the arguments are not considered to be part of the call. If the
    // call itself is removed due to this annotation, the arguments must remain
    // if they have side effects.
    can_be_unwrapped_if_unused: CallUnwrap = .never,

    // Used when printing to generate the source prop on the fly
    was_jsx_element: bool = false,

    pub fn hasSameFlagsAs(a: *Call, b: *Call) bool {
        return (a.optional_chain == b.optional_chain and
            a.is_direct_eval == b.is_direct_eval and
            a.can_be_unwrapped_if_unused == b.can_be_unwrapped_if_unused);
    }
};

pub const CallUnwrap = enum(u2) {
    never,
    if_unused,
    if_unused_and_toString_safe,
};

pub const Dot = struct {
    // target is Node
    target: ExprNodeIndex,
    name: string,
    name_loc: logger.Loc,
    optional_chain: ?OptionalChain = null,

    // If true, this property access is known to be free of side-effects. That
    // means it can be removed if the resulting value isn't used.
    can_be_removed_if_unused: bool = false,

    // If true, this property access is a function that, when called, can be
    // unwrapped if the resulting value is unused. Unwrapping means discarding
    // the call target but keeping any arguments with side effects.
    call_can_be_unwrapped_if_unused: CallUnwrap = .never,

    pub fn hasSameFlagsAs(a: *Dot, b: *Dot) bool {
        return (a.optional_chain == b.optional_chain and
            a.is_direct_eval == b.is_direct_eval and
            a.can_be_removed_if_unused == b.can_be_removed_if_unused and a.call_can_be_unwrapped_if_unused == b.call_can_be_unwrapped_if_unused);
    }
};

pub const Index = struct {
    index: ExprNodeIndex,
    target: ExprNodeIndex,
    optional_chain: ?OptionalChain = null,

    pub fn hasSameFlagsAs(a: *E.Index, b: *E.Index) bool {
        return (a.optional_chain == b.optional_chain);
    }
};

pub const Arrow = struct {
    args: []G.Arg = &[_]G.Arg{},
    body: G.FnBody,

    is_async: bool = false,
    has_rest_arg: bool = false,
    prefer_expr: bool = false, // Use shorthand if true and "Body" is a single return statement

    pub const noop_return_undefined: Arrow = .{
        .args = &.{},
        .body = .{
            .loc = .Empty,
            .stmts = &.{},
        },
    };
};

pub const Function = struct { func: G.Fn };

pub const Identifier = struct {
    ref: Ref = Ref.None,

    // If we're inside a "with" statement, this identifier may be a property
    // access. In that case it would be incorrect to remove this identifier since
    // the property access may be a getter or setter with side effects.
    must_keep_due_to_with_stmt: bool = false,

    // If true, this identifier is known to not have a side effect (i.e. to not
    // throw an exception) when referenced. If false, this identifier may or
    // not have side effects when referenced. This is used to allow the removal
    // of known globals such as "Object" if they aren't used.
    can_be_removed_if_unused: bool = false,

    // If true, this identifier represents a function that, when called, can be
    // unwrapped if the resulting value is unused. Unwrapping means discarding
    // the call target but keeping any arguments with side effects.
    call_can_be_unwrapped_if_unused: bool = false,

    pub inline fn init(ref: Ref) Identifier {
        return Identifier{
            .ref = ref,
            .must_keep_due_to_with_stmt = false,
            .can_be_removed_if_unused = false,
            .call_can_be_unwrapped_if_unused = false,
        };
    }
};

/// This is similar to an `Identifier` but it represents a reference to an ES6
/// import item.
///
/// Depending on how the code is linked, the file containing this EImportIdentifier
/// may or may not be in the same module group as the file it was imported from.
///
/// If it's the same module group than we can just merge the import item symbol
/// with the corresponding symbol that was imported, effectively renaming them
/// to be the same thing and statically binding them together.
///
/// But if it's a different module group, then the import must be dynamically
/// evaluated using a property access off the corresponding namespace symbol,
/// which represents the result of a require() call.
///
/// It's stored as a separate type so it's not easy to confuse with a plain
/// identifier. For example, it'd be bad if code trying to convert "{x: x}" into
/// "{x}" shorthand syntax wasn't aware that the "x" in this case is actually
/// "{x: importedNamespace.x}". This separate type forces code to opt-in to
/// doing this instead of opt-out.
pub const ImportIdentifier = struct {
    ref: Ref = Ref.None,

    /// If true, this was originally an identifier expression such as "foo". If
    /// false, this could potentially have been a member access expression such
    /// as "ns.foo" off of an imported namespace object.
    was_originally_identifier: bool = false,
};

/// This is a dot expression on exports, such as `exports.<ref>`. It is given
/// it's own AST node to allow CommonJS unwrapping, in which this can just be
/// the identifier in the Ref
pub const CommonJSExportIdentifier = struct {
    ref: Ref = Ref.None,
    base: Base = .exports,

    /// The original variant of the dot expression must be known so that in the case that we
    /// - fail to convert this to ESM
    /// - ALSO see an assignment to `module.exports` (commonjs_module_exports_assigned_deoptimized)
    /// It must be known if `exports` or `module.exports` was written in source
    /// code, as the distinction will alter behavior. The fixup happens in the printer when
    /// printing this node.
    pub const Base = enum {
        exports,
        module_dot_exports,
    };
};

// This is similar to EIdentifier but it represents class-private fields and
// methods. It can be used where computed properties can be used, such as
// EIndex and Property.
pub const PrivateIdentifier = struct {
    ref: Ref,
};

/// In development mode, the new JSX transform has a few special props
/// - `React.jsxDEV(type, arguments, key, isStaticChildren, source, self)`
/// - `arguments`:
///      ```{ ...props, children: children, }```
/// - `source`: https://github.com/babel/babel/blob/ef87648f3f05ccc393f89dea7d4c7c57abf398ce/packages/babel-plugin-transform-react-jsx-source/src/index.js#L24-L48
///      ```{
///         fileName: string | null,
///         columnNumber: number | null,
///         lineNumber: number | null,
///      }```
/// - `children`:
///     - static the function is React.jsxsDEV, "jsxs" instead of "jsx"
///     - one child? the function is React.jsxDEV,
///     - no children? the function is React.jsxDEV and children is an empty array.
/// `isStaticChildren`: https://github.com/facebook/react/blob/4ca62cac45c288878d2532e5056981d177f9fdac/packages/react/src/jsx/ReactJSXElementValidator.js#L369-L384
///     This flag means children is an array of JSX Elements literals.
///     The documentation on this is sparse, but it appears that
///     React just calls Object.freeze on the children array.
///     Object.freeze, historically, is quite a bit slower[0] than just not doing that.
///     Given that...I am choosing to always pass "false" to this.
///     This also skips extra state that we'd need to track.
///     If React Fast Refresh ends up using this later, then we can revisit this decision.
///  [0]: https://github.com/automerge/automerge/issues/177
pub const JSXElement = struct {
    /// JSX tag name
    /// <div> => E.String.init("div")
    /// <MyComponent> => E.Identifier{.ref = symbolPointingToMyComponent }
    /// null represents a fragment
    tag: ?ExprNodeIndex = null,

    /// JSX props
    properties: G.Property.List = G.Property.List{},

    /// JSX element children <div>{this_is_a_child_element}</div>
    children: ExprNodeList = ExprNodeList{},

    // needed to make sure parse and visit happen in the same order
    key_prop_index: i32 = -1,

    flags: Flags.JSXElement.Bitset = Flags.JSXElement.Bitset{},

    close_tag_loc: logger.Loc = logger.Loc.Empty,

    pub const SpecialProp = enum {
        __self, // old react transform used this as a prop
        __source,
        key,
        ref,
        any,

        pub const Map = ComptimeStringMap(SpecialProp, .{
            .{ "__self", .__self },
            .{ "__source", .__source },
            .{ "key", .key },
            .{ "ref", .ref },
        });
    };
};

pub const Missing = struct {
    pub fn jsonStringify(_: *const @This(), writer: anytype) !void {
        return try writer.write(null);
    }
};

pub const Number = struct {
    value: f64,

    const double_digit = [_]string{ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "100" };
    const neg_double_digit = [_]string{ "-0", "-1", "-2", "-3", "-4", "-5", "-6", "-7", "-8", "-9", "-10", "-11", "-12", "-13", "-14", "-15", "-16", "-17", "-18", "-19", "-20", "-21", "-22", "-23", "-24", "-25", "-26", "-27", "-28", "-29", "-30", "-31", "-32", "-33", "-34", "-35", "-36", "-37", "-38", "-39", "-40", "-41", "-42", "-43", "-44", "-45", "-46", "-47", "-48", "-49", "-50", "-51", "-52", "-53", "-54", "-55", "-56", "-57", "-58", "-59", "-60", "-61", "-62", "-63", "-64", "-65", "-66", "-67", "-68", "-69", "-70", "-71", "-72", "-73", "-74", "-75", "-76", "-77", "-78", "-79", "-80", "-81", "-82", "-83", "-84", "-85", "-86", "-87", "-88", "-89", "-90", "-91", "-92", "-93", "-94", "-95", "-96", "-97", "-98", "-99", "-100" };

    /// String concatenation with numbers is required by the TypeScript compiler for
    /// "constant expression" handling in enums. We can match the behavior of a JS VM
    /// by calling out to the APIs in WebKit which are responsible for this operation.
    ///
    /// This can return `null` in wasm builds to avoid linking JSC
    pub fn toString(this: Number, allocator: std.mem.Allocator) ?string {
        return toStringFromF64(this.value, allocator);
    }

    pub fn toStringFromF64(value: f64, allocator: std.mem.Allocator) ?string {
        if (value == @trunc(value) and (value < std.math.maxInt(i32) and value > std.math.minInt(i32))) {
            const int_value = @as(i64, @intFromFloat(value));
            const abs = @as(u64, @intCast(@abs(int_value)));

            // do not allocate for a small set of constant numbers: -100 through 100
            if (abs < double_digit.len) {
                return if (int_value < 0)
                    neg_double_digit[abs]
                else
                    double_digit[abs];
            }

            return std.fmt.allocPrint(allocator, "{d}", .{@as(i32, @intCast(int_value))}) catch return null;
        }

        if (std.math.isNan(value)) {
            return "NaN";
        }

        if (std.math.isNegativeInf(value)) {
            return "-Infinity";
        }

        if (std.math.isInf(value)) {
            return "Infinity";
        }

        if (Environment.isNative) {
            var buf: [124]u8 = undefined;
            return bun.handleOom(allocator.dupe(u8, bun.fmt.FormatDouble.dtoa(&buf, value)));
        } else {
            // do not attempt to implement the spec here, it would be error prone.
        }

        return null;
    }

    pub inline fn toU64(self: Number) u64 {
        return self.to(u64);
    }

    pub inline fn toUsize(self: Number) usize {
        return self.to(usize);
    }

    pub inline fn toU32(self: Number) u32 {
        return self.to(u32);
    }

    pub inline fn toU16(self: Number) u16 {
        return self.to(u16);
    }

    pub fn to(self: Number, comptime T: type) T {
        return @as(T, @intFromFloat(@min(@max(@trunc(self.value), 0), comptime @min(std.math.floatMax(f64), @as(f64, @as(comptime_float, std.math.maxInt(T)))))));
    }

    pub fn jsonStringify(self: *const Number, writer: anytype) !void {
        return try writer.write(self.value);
    }

    pub fn toJS(this: @This()) jsc.JSValue {
        return jsc.JSValue.jsNumber(this.value);
    }
};

pub const BigInt = struct {
    value: string,

    pub var empty = BigInt{ .value = "" };

    pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
        return try writer.write(self.value);
    }

    pub fn toJS(_: @This()) jsc.JSValue {
        // TODO:
        return jsc.JSValue.jsNumber(0);
    }
};

pub const Object = struct {
    properties: G.Property.List = G.Property.List{},
    comma_after_spread: ?logger.Loc = null,
    is_single_line: bool = false,
    is_parenthesized: bool = false,
    was_originally_macro: bool = false,

    close_brace_loc: logger.Loc = logger.Loc.Empty,

    // used in TOML parser to merge properties
    pub const Rope = struct {
        head: Expr,
        next: ?*Rope = null,
        pub fn append(this: *Rope, expr: Expr, allocator: std.mem.Allocator) OOM!*Rope {
            if (this.next) |next| {
                return try next.append(expr, allocator);
            }

            const rope = try allocator.create(Rope);
            rope.* = .{ .head = expr };
            this.next = rope;
            return rope;
        }
    };

    pub fn get(self: *const Object, key: string) ?Expr {
        return if (asProperty(self, key)) |query| query.expr else @as(?Expr, null);
    }

    pub fn toJS(this: *Object, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) ToJSError!jsc.JSValue {
        var obj = jsc.JSValue.createEmptyObject(globalObject, this.properties.len);
        obj.protect();
        defer obj.unprotect();
        const props: []const G.Property = this.properties.slice();
        for (props) |prop| {
            if (prop.kind != .normal or prop.class_static_block != null or prop.key == null or prop.value == null) {
                return error.@"Cannot convert argument type to JS";
            }
            const key = try prop.key.?.data.toJS(allocator, globalObject);
            const value = try prop.value.?.toJS(allocator, globalObject);
            try obj.putToPropertyKey(globalObject, key, value);
        }

        return obj;
    }

    pub fn put(self: *Object, allocator: std.mem.Allocator, key: string, expr: Expr) !void {
        if (asProperty(self, key)) |query| {
            self.properties.ptr[query.i].value = expr;
        } else {
            try self.properties.append(allocator, .{
                .key = Expr.init(E.String, E.String.init(key), expr.loc),
                .value = expr,
            });
        }
    }

    pub fn putString(self: *Object, allocator: std.mem.Allocator, key: string, value: string) !void {
        return try put(self, allocator, key, Expr.init(E.String, E.String.init(value), logger.Loc.Empty));
    }

    pub const SetError = error{ OutOfMemory, Clobber };

    pub fn set(self: *const Object, key: Expr, allocator: std.mem.Allocator, value: Expr) SetError!void {
        if (self.hasProperty(key.data.e_string.data)) return error.Clobber;
        try self.properties.append(allocator, .{
            .key = key,
            .value = value,
        });
    }

    pub const RopeQuery = struct {
        expr: Expr,
        rope: *const Rope,
    };

    // this is terribly, shamefully slow
    pub fn setRope(self: *Object, rope: *const Rope, allocator: std.mem.Allocator, value: Expr) SetError!void {
        if (self.get(rope.head.data.e_string.data)) |existing| {
            switch (existing.data) {
                .e_array => |array| {
                    if (rope.next == null) {
                        try array.push(allocator, value);
                        return;
                    }

                    if (array.items.last()) |last| {
                        if (last.data != .e_object) {
                            return error.Clobber;
                        }

                        try last.data.e_object.setRope(rope.next.?, allocator, value);
                        return;
                    }

                    try array.push(allocator, value);
                    return;
                },
                .e_object => |object| {
                    if (rope.next != null) {
                        try object.setRope(rope.next.?, allocator, value);
                        return;
                    }

                    return error.Clobber;
                },
                else => {
                    return error.Clobber;
                },
            }
        }

        var value_ = value;
        if (rope.next) |next| {
            var obj = Expr.init(E.Object, E.Object{ .properties = .{} }, rope.head.loc);
            try obj.data.e_object.setRope(next, allocator, value);
            value_ = obj;
        }

        try self.properties.append(allocator, .{
            .key = rope.head,
            .value = value_,
        });
    }

    pub fn getOrPutObject(self: *Object, rope: *const Rope, allocator: std.mem.Allocator) SetError!Expr {
        if (self.get(rope.head.data.e_string.data)) |existing| {
            switch (existing.data) {
                .e_array => |array| {
                    if (rope.next == null) {
                        return error.Clobber;
                    }

                    if (array.items.last()) |last| {
                        if (last.data != .e_object) {
                            return error.Clobber;
                        }

                        return try last.data.e_object.getOrPutObject(rope.next.?, allocator);
                    }

                    return error.Clobber;
                },
                .e_object => |object| {
                    if (rope.next != null) {
                        return try object.getOrPutObject(rope.next.?, allocator);
                    }

                    // success
                    return existing;
                },
                else => {
                    return error.Clobber;
                },
            }
        }

        if (rope.next) |next| {
            var obj = Expr.init(E.Object, E.Object{ .properties = .{} }, rope.head.loc);
            const out = try obj.data.e_object.getOrPutObject(next, allocator);
            try self.properties.append(allocator, .{
                .key = rope.head,
                .value = obj,
            });
            return out;
        }

        const out = Expr.init(E.Object, E.Object{}, rope.head.loc);
        try self.properties.append(allocator, .{
            .key = rope.head,
            .value = out,
        });
        return out;
    }

    pub fn getOrPutArray(self: *Object, rope: *const Rope, allocator: std.mem.Allocator) SetError!Expr {
        if (self.get(rope.head.data.e_string.data)) |existing| {
            switch (existing.data) {
                .e_array => |array| {
                    if (rope.next == null) {
                        return existing;
                    }

                    if (array.items.last()) |last| {
                        if (last.data != .e_object) {
                            return error.Clobber;
                        }

                        return try last.data.e_object.getOrPutArray(rope.next.?, allocator);
                    }

                    return error.Clobber;
                },
                .e_object => |object| {
                    if (rope.next == null) {
                        return error.Clobber;
                    }

                    return try object.getOrPutArray(rope.next.?, allocator);
                },
                else => {
                    return error.Clobber;
                },
            }
        }

        if (rope.next) |next| {
            var obj = Expr.init(E.Object, E.Object{ .properties = .{} }, rope.head.loc);
            const out = try obj.data.e_object.getOrPutArray(next, allocator);
            try self.properties.append(allocator, .{
                .key = rope.head,
                .value = obj,
            });
            return out;
        }

        const out = Expr.init(E.Array, E.Array{}, rope.head.loc);
        try self.properties.append(allocator, .{
            .key = rope.head,
            .value = out,
        });
        return out;
    }

    pub fn hasProperty(obj: *const Object, name: string) bool {
        for (obj.properties.slice()) |prop| {
            const key = prop.key orelse continue;
            if (key.data != .e_string) continue;
            if (key.data.e_string.eql(string, name)) return true;
        }
        return false;
    }

    pub fn asProperty(obj: *const Object, name: string) ?Expr.Query {
        for (obj.properties.slice(), 0..) |prop, i| {
            const value = prop.value orelse continue;
            const key = prop.key orelse continue;
            if (key.data != .e_string) continue;
            const key_str = key.data.e_string;
            if (key_str.eql(string, name)) {
                return Expr.Query{
                    .expr = value,
                    .loc = key.loc,
                    .i = @as(u32, @truncate(i)),
                };
            }
        }

        return null;
    }

    /// Assumes each key in the property is a string
    pub fn alphabetizeProperties(this: *Object) void {
        if (comptime Environment.isDebug) {
            for (this.properties.slice()) |prop| {
                bun.assert(prop.key.?.data == .e_string);
            }
        }
        std.sort.pdq(G.Property, this.properties.slice(), {}, Sorter.isLessThan);
    }

    pub fn packageJSONSort(this: *Object) void {
        std.sort.pdq(G.Property, this.properties.slice(), {}, PackageJSONSort.Fields.isLessThan);
    }

    const PackageJSONSort = struct {
        const Fields = enum(u8) {
            name = 0,
            version = 1,
            author = 2,
            repository = 3,
            config = 4,
            main = 5,
            module = 6,
            dependencies = 7,
            devDependencies = 8,
            optionalDependencies = 9,
            peerDependencies = 10,
            exports = 11,
            __fake = 12,

            pub const Map = ComptimeStringMap(Fields, .{
                .{ "name", Fields.name },
                .{ "version", Fields.version },
                .{ "author", Fields.author },
                .{ "repository", Fields.repository },
                .{ "config", Fields.config },
                .{ "main", Fields.main },
                .{ "module", Fields.module },
                .{ "dependencies", Fields.dependencies },
                .{ "devDependencies", Fields.devDependencies },
                .{ "optionalDependencies", Fields.optionalDependencies },
                .{ "peerDependencies", Fields.peerDependencies },
                .{ "exports", Fields.exports },
            });

            pub fn isLessThan(ctx: void, lhs: G.Property, rhs: G.Property) bool {
                var lhs_key_size: u8 = @intFromEnum(Fields.__fake);
                var rhs_key_size: u8 = @intFromEnum(Fields.__fake);

                if (lhs.key != null and lhs.key.?.data == .e_string) {
                    lhs_key_size = @intFromEnum(Map.get(lhs.key.?.data.e_string.data) orelse Fields.__fake);
                }

                if (rhs.key != null and rhs.key.?.data == .e_string) {
                    rhs_key_size = @intFromEnum(Map.get(rhs.key.?.data.e_string.data) orelse Fields.__fake);
                }

                return switch (std.math.order(lhs_key_size, rhs_key_size)) {
                    .lt => true,
                    .gt => false,
                    .eq => strings.cmpStringsAsc(ctx, lhs.key.?.data.e_string.data, rhs.key.?.data.e_string.data),
                };
            }
        };
    };

    const Sorter = struct {
        pub fn isLessThan(ctx: void, lhs: G.Property, rhs: G.Property) bool {
            return strings.cmpStringsAsc(ctx, lhs.key.?.data.e_string.data, rhs.key.?.data.e_string.data);
        }
    };
};

pub const Spread = struct { value: ExprNodeIndex };

/// JavaScript string literal type
pub const String = struct {
    // A version of this where `utf8` and `value` are stored in a packed union, with len as a single u32 was attempted.
    // It did not improve benchmarks. Neither did converting this from a heap-allocated type to a stack-allocated type.
    // TODO: change this to *const anyopaque and change all uses to either .slice8() or .slice16()
    data: []const u8 = "",
    prefer_template: bool = false,

    // A very simple rope implementation
    // We only use this for string folding, so this is kind of overkill
    // We don't need to deal with substrings
    next: ?*String = null,
    end: ?*String = null,
    rope_len: u32 = 0,
    is_utf16: bool = false,

    pub fn isIdentifier(this: *String, allocator: std.mem.Allocator) bool {
        if (!this.isUTF8()) {
            return bun.js_lexer.isIdentifierUTF16(this.slice16());
        }

        return bun.js_lexer.isIdentifier(this.slice(allocator));
    }

    pub const class = E.String{ .data = "class" };

    pub fn push(this: *String, other: *String) void {
        bun.assert(this.isUTF8());
        bun.assert(other.isUTF8());

        if (other.rope_len == 0) {
            other.rope_len = @truncate(other.data.len);
        }

        if (this.rope_len == 0) {
            this.rope_len = @truncate(this.data.len);
        }

        this.rope_len += other.rope_len;
        if (this.next == null) {
            this.next = other;
            this.end = other;
        } else {
            var end = this.end.?;
            while (end.next != null) end = end.end.?;
            end.next = other;
            this.end = other;
        }
    }

    /// Cloning the rope string is rarely needed, see `foldStringAddition`'s
    /// comments and the 'edgecase/EnumInliningRopeStringPoison' test
    pub fn cloneRopeNodes(s: String) String {
        var root = s;

        if (root.next != null) {
            var current: ?*String = &root;
            while (true) {
                const node = current.?;
                if (node.next) |next| {
                    node.next = Expr.Data.Store.append(String, next.*);
                    current = node.next;
                } else {
                    root.end = node;
                    break;
                }
            }
        }

        return root;
    }

    pub fn toUTF8(this: *String, allocator: std.mem.Allocator) !void {
        if (!this.is_utf16) return;
        this.data = try strings.toUTF8Alloc(allocator, this.slice16());
        this.is_utf16 = false;
    }

    pub fn init(value: anytype) String {
        const Value = @TypeOf(value);
        if (Value == []u16 or Value == []const u16) {
            return .{
                .data = @as([*]const u8, @ptrCast(value.ptr))[0..value.len],
                .is_utf16 = true,
            };
        }

        return .{ .data = value };
    }

    /// E.String containing non-ascii characters may not fully work.
    /// https://github.com/oven-sh/bun/issues/11963
    /// More investigation is needed.
    pub fn initReEncodeUTF8(utf8: []const u8, allocator: std.mem.Allocator) String {
        return if (bun.strings.isAllASCII(utf8))
            init(utf8)
        else
            init(bun.handleOom(bun.strings.toUTF16AllocForReal(allocator, utf8, false, false)));
    }

    pub fn slice8(this: *const String) []const u8 {
        bun.assert(!this.is_utf16);
        return this.data;
    }

    pub fn slice16(this: *const String) []const u16 {
        bun.assert(this.is_utf16);
        return @as([*]const u16, @ptrCast(@alignCast(this.data.ptr)))[0..this.data.len];
    }

    pub fn resolveRopeIfNeeded(this: *String, allocator: std.mem.Allocator) void {
        if (this.next == null or !this.isUTF8()) return;
        var bytes = bun.handleOom(std.array_list.Managed(u8).initCapacity(allocator, this.rope_len));
        bytes.appendSliceAssumeCapacity(this.data);
        var str = this.next;
        while (str) |part| {
            bun.handleOom(bytes.appendSlice(part.data));
            str = part.next;
        }
        this.data = bytes.items;
        this.next = null;
    }

    pub fn slice(this: *String, allocator: std.mem.Allocator) []const u8 {
        this.resolveRopeIfNeeded(allocator);
        return bun.handleOom(this.string(allocator));
    }

    fn stringCompareForJavaScript(comptime T: type, a: []const T, b: []const T) std.math.Order {
        const a_slice = a[0..@min(a.len, b.len)];
        const b_slice = b[0..@min(a.len, b.len)];
        for (a_slice, b_slice) |a_char, b_char| {
            const delta: i32 = @as(i32, a_char) - @as(i32, b_char);
            if (delta != 0) {
                return if (delta < 0) .lt else .gt;
            }
        }
        return std.math.order(a.len, b.len);
    }

    /// Compares two strings lexicographically for JavaScript semantics.
    /// Both strings must share the same encoding (UTF-8 vs UTF-16).
    pub inline fn order(this: *const String, other: *const String) std.math.Order {
        bun.debugAssert(this.isUTF8() == other.isUTF8());

        if (this.isUTF8()) {
            return stringCompareForJavaScript(u8, this.data, other.data);
        } else {
            return stringCompareForJavaScript(u16, this.slice16(), other.slice16());
        }
    }

    pub var empty = String{};
    pub var @"true" = String{ .data = "true" };
    pub var @"false" = String{ .data = "false" };
    pub var @"null" = String{ .data = "null" };
    pub var @"undefined" = String{ .data = "undefined" };

    pub fn clone(str: *const String, allocator: std.mem.Allocator) !String {
        return String{
            .data = try allocator.dupe(u8, str.data),
            .prefer_template = str.prefer_template,
            .is_utf16 = !str.isUTF8(),
        };
    }

    pub fn cloneSliceIfNecessary(str: *const String, allocator: std.mem.Allocator) ![]const u8 {
        if (str.isUTF8()) {
            return allocator.dupe(u8, str.string(allocator) catch unreachable);
        }

        return str.string(allocator);
    }

    pub fn javascriptLength(s: *const String) ?u32 {
        if (s.rope_len > 0) {
            // We only support ascii ropes for now
            return s.rope_len;
        }

        if (s.isUTF8()) {
            if (!strings.isAllASCII(s.data)) {
                return null;
            }
            return @truncate(s.data.len);
        }

        return @truncate(s.slice16().len);
    }

    pub inline fn len(s: *const String) usize {
        return if (s.rope_len > 0) s.rope_len else s.data.len;
    }

    pub inline fn isUTF8(s: *const String) bool {
        return !s.is_utf16;
    }

    pub inline fn isBlank(s: *const String) bool {
        return s.len() == 0;
    }

    pub inline fn isPresent(s: *const String) bool {
        return s.len() > 0;
    }

    pub fn eql(s: *const String, comptime _t: type, other: anytype) bool {
        if (s.isUTF8()) {
            switch (_t) {
                @This() => {
                    if (other.isUTF8()) {
                        return strings.eqlLong(s.data, other.data, true);
                    } else {
                        return strings.utf16EqlString(other.slice16(), s.data);
                    }
                },
                []const u8 => {
                    return strings.eqlLong(s.data, other, true);
                },
                []u16, []const u16 => {
                    return strings.utf16EqlString(other, s.data);
                },
                else => {
                    @compileError("Invalid type");
                },
            }
        } else {
            switch (_t) {
                @This() => {
                    if (other.isUTF8()) {
                        return strings.utf16EqlString(s.slice16(), other.data);
                    } else {
                        return std.mem.eql(u16, other.slice16(), s.slice16());
                    }
                },
                []const u8 => {
                    return strings.utf16EqlString(s.slice16(), other);
                },
                []u16, []const u16 => {
                    return std.mem.eql(u16, other.slice16(), s.slice16());
                },
                else => {
                    @compileError("Invalid type");
                },
            }
        }
    }

    pub fn eqlComptime(s: *const String, comptime value: []const u8) bool {
        if (!s.isUTF8()) {
            bun.assertf(s.next == null, "transpiler: utf-16 string is a rope", .{}); // utf-16 strings are not ropes
            return strings.eqlComptimeUTF16(s.slice16(), value);
        }
        if (s.next == null) {
            // latin-1 or utf-8, non-rope
            return strings.eqlComptime(s.data, value);
        }

        // latin-1 or utf-8, rope
        return eql8Rope(s, value);
    }
    fn eql8Rope(s: *const String, value: []const u8) bool {
        bun.assertf(s.next != null and s.isUTF8(), "transpiler: bad call to eql8Rope", .{});
        if (s.rope_len != value.len) return false;
        var i: usize = 0;
        var next: ?*const String = s;
        while (next) |current| : (next = current.next) {
            if (!strings.eqlLong(current.data, value[i..][0..current.data.len], false)) return false;
            i += current.data.len;
        }
        bun.assertf(i == value.len, "transpiler: rope string length mismatch 1", .{});
        bun.assertf(i == s.rope_len, "transpiler: rope string length mismatch 2", .{});
        return true;
    }

    pub fn hasPrefixComptime(s: *const String, comptime value: anytype) bool {
        if (s.data.len < value.len)
            return false;

        return if (s.isUTF8())
            strings.eqlComptime(s.data[0..value.len], value)
        else
            strings.eqlComptimeUTF16(s.slice16()[0..value.len], value);
    }

    pub fn string(s: *const String, allocator: std.mem.Allocator) OOM![]const u8 {
        if (s.isUTF8()) {
            return s.data;
        } else {
            return strings.toUTF8Alloc(allocator, s.slice16());
        }
    }

    pub fn stringZ(s: *const String, allocator: std.mem.Allocator) OOM![:0]const u8 {
        if (s.isUTF8()) {
            return allocator.dupeZ(u8, s.data);
        } else {
            return strings.toUTF8AllocZ(allocator, s.slice16());
        }
    }

    pub fn stringCloned(s: *const String, allocator: std.mem.Allocator) OOM![]const u8 {
        if (s.isUTF8()) {
            return allocator.dupe(u8, s.data);
        } else {
            return strings.toUTF8Alloc(allocator, s.slice16());
        }
    }

    pub fn hash(s: *const String) u64 {
        if (s.isBlank()) return 0;

        if (s.isUTF8()) {
            // hash utf-8
            return bun.hash(s.data);
        } else {
            // hash utf-16
            return bun.hash(@as([*]const u8, @ptrCast(s.slice16().ptr))[0 .. s.slice16().len * 2]);
        }
    }

    pub fn toJS(s: *String, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) !jsc.JSValue {
        s.resolveRopeIfNeeded(allocator);
        if (!s.isPresent()) {
            var emp = bun.String.empty;
            return emp.toJS(globalObject);
        }

        if (s.isUTF8()) {
            if (try strings.toUTF16Alloc(allocator, s.slice8(), false, false)) |utf16| {
                var out, const chars = bun.String.createUninitialized(.utf16, utf16.len);
                @memcpy(chars, utf16);
                return out.transferToJS(globalObject);
            } else {
                var out, const chars = bun.String.createUninitialized(.latin1, s.slice8().len);
                @memcpy(chars, s.slice8());
                return out.transferToJS(globalObject);
            }
        } else {
            var out, const chars = bun.String.createUninitialized(.utf16, s.slice16().len);
            @memcpy(chars, s.slice16());
            return out.transferToJS(globalObject);
        }
    }

    pub fn toZigString(s: *String, allocator: std.mem.Allocator) jsc.ZigString {
        if (s.isUTF8()) {
            return jsc.ZigString.fromUTF8(s.slice(allocator));
        } else {
            return jsc.ZigString.initUTF16(s.slice16());
        }
    }

    pub fn format(s: String, writer: *std.Io.Writer) !void {
        try writer.writeAll("E.String");
        if (s.next == null) {
            try writer.writeAll("(");
            if (s.isUTF8()) {
                try writer.print("\"{s}\"", .{s.data});
            } else {
                try writer.print("\"{f}\"", .{bun.fmt.utf16(s.slice16())});
            }
            try writer.writeAll(")");
        } else {
            try writer.writeAll("(rope: [");
            var it: ?*const String = &s;
            while (it) |part| {
                if (part.isUTF8()) {
                    try writer.print("\"{s}\"", .{part.data});
                } else {
                    try writer.print("\"{f}\"", .{bun.fmt.utf16(part.slice16())});
                }
                it = part.next;
                if (it != null) try writer.writeAll(" ");
            }
            try writer.writeAll("])");
        }
    }

    pub fn jsonStringify(s: *const String, writer: anytype) !void {
        var buf = [_]u8{0} ** 4096;
        var i: usize = 0;
        for (s.slice16()) |char| {
            buf[i] = @as(u8, @intCast(char));
            i += 1;
            if (i >= 4096) {
                break;
            }
        }

        return try writer.write(buf[0..i]);
    }
};

// value is in the Node
pub const TemplatePart = struct {
    value: ExprNodeIndex,
    tail_loc: logger.Loc,
    tail: Template.Contents,
};

pub const Template = struct {
    tag: ?ExprNodeIndex = null,
    parts: []TemplatePart = &.{},
    head: Contents,

    pub const Contents = union(Tag) {
        cooked: E.String,
        raw: string,

        const Tag = enum {
            cooked,
            raw,
        };

        pub fn isUTF8(contents: Contents) bool {
            return contents == .cooked and contents.cooked.isUTF8();
        }
    };

    /// "`a${'b'}c`" => "`abc`"
    pub fn fold(
        this: *Template,
        allocator: std.mem.Allocator,
        loc: logger.Loc,
    ) Expr {
        if (this.tag != null or (this.head == .cooked and !this.head.cooked.isUTF8())) {
            // we only fold utf-8/ascii for now
            return Expr{
                .data = .{ .e_template = this },
                .loc = loc,
            };
        }

        bun.assert(this.head == .cooked);

        if (this.parts.len == 0) {
            return Expr.init(E.String, this.head.cooked, loc);
        }

        var parts = std.array_list.Managed(TemplatePart).initCapacity(allocator, this.parts.len) catch unreachable;
        var head = Expr.init(E.String, this.head.cooked, loc);
        for (this.parts) |part_src| {
            var part = part_src;
            bun.assert(part.tail == .cooked);

            part.value = part.value.unwrapInlined();

            switch (part.value.data) {
                .e_number => {
                    if (part.value.data.e_number.toString(allocator)) |s| {
                        part.value = Expr.init(E.String, E.String.init(s), part.value.loc);
                    }
                },
                .e_null => {
                    part.value = Expr.init(E.String, E.String.init("null"), part.value.loc);
                },
                .e_boolean => {
                    part.value = Expr.init(E.String, E.String.init(if (part.value.data.e_boolean.value)
                        "true"
                    else
                        "false"), part.value.loc);
                },
                .e_undefined => {
                    part.value = Expr.init(E.String, E.String.init("undefined"), part.value.loc);
                },
                .e_big_int => |value| {
                    part.value = Expr.init(E.String, E.String.init(value.value), part.value.loc);
                },
                else => {},
            }

            if (part.value.data == .e_string and part.tail.cooked.isUTF8() and part.value.data.e_string.isUTF8()) {
                if (parts.items.len == 0) {
                    if (part.value.data.e_string.len() > 0) {
                        head.data.e_string.push(Expr.init(E.String, part.value.data.e_string.*, logger.Loc.Empty).data.e_string);
                    }

                    if (part.tail.cooked.len() > 0) {
                        head.data.e_string.push(Expr.init(E.String, part.tail.cooked, part.tail_loc).data.e_string);
                    }

                    continue;
                } else {
                    var prev_part = &parts.items[parts.items.len - 1];
                    bun.assert(prev_part.tail == .cooked);

                    if (prev_part.tail.cooked.isUTF8()) {
                        if (part.value.data.e_string.len() > 0) {
                            prev_part.tail.cooked.push(Expr.init(E.String, part.value.data.e_string.*, logger.Loc.Empty).data.e_string);
                        }

                        if (part.tail.cooked.len() > 0) {
                            prev_part.tail.cooked.push(Expr.init(E.String, part.tail.cooked, part.tail_loc).data.e_string);
                        }
                    } else {
                        parts.appendAssumeCapacity(part);
                    }
                }
            } else {
                parts.appendAssumeCapacity(part);
            }
        }

        if (parts.items.len == 0) {
            parts.deinit();
            head.data.e_string.resolveRopeIfNeeded(allocator);
            return head;
        }

        return Expr.init(E.Template, .{
            .tag = null,
            .parts = parts.items,
            .head = .{ .cooked = head.data.e_string.* },
        }, loc);
    }
};

pub const RegExp = struct {
    value: string,

    // This exists for JavaScript bindings
    // The RegExp constructor expects flags as a second argument.
    // We want to avoid re-lexing the flags, so we store them here.
    // This is the index of the first character in a flag, not the "/"
    // /foo/gim
    //      ^
    flags_offset: ?u16 = null,

    pub var empty = RegExp{ .value = "" };

    pub fn pattern(this: RegExp) string {

        // rewind until we reach the /foo/gim
        //                               ^
        // should only ever be a single character
        // but we're being cautious
        if (this.flags_offset) |i_| {
            var i = i_;
            while (i > 0 and this.value[i] != '/') {
                i -= 1;
            }

            return std.mem.trim(u8, this.value[0..i], "/");
        }

        return std.mem.trim(u8, this.value, "/");
    }

    pub fn flags(this: RegExp) string {
        // rewind until we reach the /foo/gim
        //                               ^
        // should only ever be a single character
        // but we're being cautious
        if (this.flags_offset) |i| {
            return this.value[i..];
        }

        return "";
    }

    pub fn jsonStringify(self: *const RegExp, writer: anytype) !void {
        return try writer.write(self.value);
    }
};

pub const Await = struct {
    value: ExprNodeIndex,
};

pub const Yield = struct {
    value: ?ExprNodeIndex = null,
    is_star: bool = false,
};

pub const If = struct {
    test_: ExprNodeIndex,
    yes: ExprNodeIndex,
    no: ExprNodeIndex,
};

pub const RequireString = struct {
    import_record_index: u32 = 0,

    unwrapped_id: u32 = std.math.maxInt(u32),
};

pub const RequireResolveString = struct {
    import_record_index: u32,

    // close_paren_loc: logger.Loc = logger.Loc.Empty,
};

pub const InlinedEnum = struct {
    value: ExprNodeIndex,
    comment: string,
};

pub const Import = struct {
    expr: ExprNodeIndex,
    options: ExprNodeIndex = Expr.empty,
    import_record_index: u32,

    /// TODO:
    /// Comments inside "import()" expressions have special meaning for Webpack.
    /// Preserving comments inside these expressions makes it possible to use
    /// esbuild as a TypeScript-to-JavaScript frontend for Webpack to improve
    /// performance. We intentionally do not interpret these comments in esbuild
    /// because esbuild is not Webpack. But we do preserve them since doing so is
    /// harmless, easy to maintain, and useful to people. See the Webpack docs for
    /// more info: https://webpack.js.org/api/module-methods/#magic-comments.
    // leading_interior_comments: []G.Comment = &([_]G.Comment{}),

    pub fn isImportRecordNull(this: *const Import) bool {
        return this.import_record_index == std.math.maxInt(u32);
    }

    pub fn importRecordLoader(import: *const Import) ?bun.options.Loader {
        // This logic is duplicated in js_printer.zig fn parsePath()
        const obj = import.options.data.as(.e_object) orelse
            return null;
        const with = obj.get("with") orelse obj.get("assert") orelse
            return null;
        const with_obj = with.data.as(.e_object) orelse
            return null;
        const str = (with_obj.get("type") orelse
            return null).data.as(.e_string) orelse
            return null;

        if (!str.is_utf16) if (bun.options.Loader.fromString(str.data)) |loader| {
            if (loader == .sqlite) {
                const embed = with_obj.get("embed") orelse return loader;
                const embed_str = embed.data.as(.e_string) orelse return loader;
                if (embed_str.eqlComptime("true")) {
                    return .sqlite_embedded;
                }
            }
            return loader;
        };

        return null;
    }
};

pub const Class = G.Class;

const string = []const u8;
const stringZ = [:0]const u8;

const std = @import("std");

const bun = @import("bun");
const ComptimeStringMap = bun.ComptimeStringMap;
const Environment = bun.Environment;
const ImportRecord = bun.ImportRecord;
const OOM = bun.OOM;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;
const Loader = bun.options.Loader;

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const Flags = js_ast.Flags;
const G = js_ast.G;
const Op = js_ast.Op;
const OptionalChain = js_ast.OptionalChain;
const Ref = js_ast.Ref;
const ToJSError = js_ast.ToJSError;
