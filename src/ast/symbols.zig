pub fn Symbols(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);

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
    };
}

const string = []const u8;

const bun = @import("bun");
const js_lexer = bun.js_lexer;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const Scope = js_ast.Scope;

const js_parser = bun.js_parser;
const FindSymbolResult = js_parser.FindSymbolResult;
const JSXTransformType = js_parser.JSXTransformType;
const Ref = js_parser.Ref;
const TypeScript = js_parser.TypeScript;
