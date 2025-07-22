pub const Block = struct {
    stmts: StmtNodeList,
    close_brace_loc: logger.Loc = logger.Loc.Empty,
};

pub const SExpr = struct {
    value: ExprNodeIndex,

    // This is set to true for automatically-generated expressions that should
    // not affect tree shaking. For example, calling a function from the runtime
    // that doesn't have externally-visible side effects.
    does_not_affect_tree_shaking: bool = false,
};

pub const Comment = struct { text: string };

pub const Directive = struct {
    value: []const u8,
};

pub const ExportClause = struct {
    items: []ClauseItem,
    is_single_line: bool,
};

pub const Empty = struct {};

pub const ExportStar = struct {
    namespace_ref: Ref,
    alias: ?G.ExportStarAlias = null,
    import_record_index: u32,
};

// This is an "export = value;" statement in TypeScript
pub const ExportEquals = struct { value: ExprNodeIndex };

pub const Label = struct { name: LocRef, stmt: StmtNodeIndex };

// This is a stand-in for a TypeScript type declaration
pub const TypeScript = struct {};

pub const Debugger = struct {};

pub const ExportFrom = struct {
    items: []ClauseItem,
    namespace_ref: Ref,
    import_record_index: u32,
    is_single_line: bool,
};

pub const ExportDefault = struct {
    default_name: LocRef, // value may be a SFunction or SClass
    value: StmtOrExpr,

    pub fn canBeMoved(self: *const ExportDefault) bool {
        return switch (self.value) {
            .expr => |e| e.canBeMoved(),
            .stmt => |s| switch (s.data) {
                .s_class => |class| class.class.canBeMoved(),
                .s_function => true,
                else => false,
            },
        };
    }
};

pub const Enum = struct {
    name: LocRef,
    arg: Ref,
    values: []EnumValue,
    is_export: bool,
};

pub const Namespace = struct {
    name: LocRef,
    arg: Ref,
    stmts: StmtNodeList,
    is_export: bool,
};

pub const Function = struct {
    func: G.Fn,
};

pub const Class = struct { class: G.Class, is_export: bool = false };

pub const If = struct {
    test_: ExprNodeIndex,
    yes: StmtNodeIndex,
    no: ?StmtNodeIndex,
};

pub const For = struct {
    // May be a SConst, SLet, SVar, or SExpr
    init: ?StmtNodeIndex = null,
    test_: ?ExprNodeIndex = null,
    update: ?ExprNodeIndex = null,
    body: StmtNodeIndex,
};

pub const ForIn = struct {
    // May be a SConst, SLet, SVar, or SExpr
    init: StmtNodeIndex,
    value: ExprNodeIndex,
    body: StmtNodeIndex,
};

pub const ForOf = struct {
    is_await: bool = false,
    // May be a SConst, SLet, SVar, or SExpr
    init: StmtNodeIndex,
    value: ExprNodeIndex,
    body: StmtNodeIndex,
};

pub const DoWhile = struct { body: StmtNodeIndex, test_: ExprNodeIndex };

pub const While = struct {
    test_: ExprNodeIndex,
    body: StmtNodeIndex,
};

pub const With = struct {
    value: ExprNodeIndex,
    body: StmtNodeIndex,
    body_loc: logger.Loc = logger.Loc.Empty,
};

pub const Try = struct {
    body_loc: logger.Loc,
    body: StmtNodeList,

    catch_: ?Catch = null,
    finally: ?Finally = null,
};

pub const Switch = struct {
    test_: ExprNodeIndex,
    body_loc: logger.Loc,
    cases: []Case,
};

// This object represents all of these types of import statements:
//
//    import 'path'
//    import {item1, item2} from 'path'
//    import * as ns from 'path'
//    import defaultItem, {item1, item2} from 'path'
//    import defaultItem, * as ns from 'path'
//
// Many parts are optional and can be combined in different ways. The only
// restriction is that you cannot have both a clause and a star namespace.
pub const Import = struct {
    // If this is a star import: This is a Ref for the namespace symbol. The Loc
    // for the symbol is StarLoc.
    //
    // Otherwise: This is an auto-generated Ref for the namespace representing
    // the imported file. In this case StarLoc is nil. The NamespaceRef is used
    // when converting this module to a CommonJS module.
    namespace_ref: Ref,
    default_name: ?LocRef = null,
    items: []ClauseItem = &.{},
    star_name_loc: ?logger.Loc = null,
    import_record_index: u32,
    is_single_line: bool = false,
};

pub const Return = struct { value: ?ExprNodeIndex = null };
pub const Throw = struct { value: ExprNodeIndex };

pub const Local = struct {
    kind: Kind = .k_var,
    decls: G.Decl.List = .{},
    is_export: bool = false,
    // The TypeScript compiler doesn't generate code for "import foo = bar"
    // statements where the import is never used.
    was_ts_import_equals: bool = false,

    was_commonjs_export: bool = false,

    pub fn canMergeWith(this: *const Local, other: *const Local) bool {
        return this.kind == other.kind and this.is_export == other.is_export and
            this.was_commonjs_export == other.was_commonjs_export;
    }

    pub const Kind = enum {
        k_var,
        k_let,
        k_const,
        k_using,
        k_await_using,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }

        pub fn isUsing(self: Kind) bool {
            return self == .k_using or self == .k_await_using;
        }

        pub fn isReassignable(kind: Kind) bool {
            return kind == .k_var or kind == .k_let;
        }
    };
};

pub const Break = struct {
    label: ?LocRef = null,
};

pub const Continue = struct {
    label: ?LocRef = null,
};

const string = []const u8;

const bun = @import("bun");
const logger = bun.logger;

const js_ast = bun.ast;
const Case = js_ast.Case;
const Catch = js_ast.Catch;
const ClauseItem = js_ast.ClauseItem;
const EnumValue = js_ast.EnumValue;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const Finally = js_ast.Finally;
const G = js_ast.G;
const LocRef = js_ast.LocRef;
const Ref = js_ast.Ref;
const StmtNodeIndex = js_ast.StmtNodeIndex;
const StmtNodeList = js_ast.StmtNodeList;
const StmtOrExpr = js_ast.StmtOrExpr;
