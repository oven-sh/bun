//! Like Ast but slimmer and for bundling only.
//!
//! On Linux, the hottest function in the bundler is:
//! src.multi_array_list.MultiArrayList(src.js_ast.Ast).ensureTotalCapacity
//! https://share.firefox.dev/3NNlRKt
//!
//! So we make a slimmer version of Ast for bundling that doesn't allocate as much memory

approximate_newline_count: u32 = 0,
nested_scope_slot_counts: SlotCounts = .{},

exports_kind: ExportsKind = .none,

/// These are stored at the AST level instead of on individual AST nodes so
/// they can be manipulated efficiently without a full AST traversal
import_records: ImportRecord.List = .{},

hashbang: string = "",
parts: Part.List = .{},
css: ?*bun.css.BundlerStyleSheet = null,
url_for_css: []const u8 = "",
symbols: Symbol.List = .{},
module_scope: Scope = .{},
char_freq: CharFreq = undefined,
exports_ref: Ref = Ref.None,
module_ref: Ref = Ref.None,
wrapper_ref: Ref = Ref.None,
require_ref: Ref = Ref.None,
top_level_await_keyword: logger.Range,
tla_check: TlaCheck = .{},

// These are used when bundling. They are filled in during the parser pass
// since we already have to traverse the AST then anyway and the parser pass
// is conveniently fully parallelized.
named_imports: NamedImports = .{},
named_exports: NamedExports = .{},
export_star_import_records: []u32 = &.{},

top_level_symbols_to_parts: TopLevelSymbolToParts = .{},

commonjs_named_exports: CommonJSNamedExports = .{},

redirect_import_record_index: u32 = std.math.maxInt(u32),

/// Only populated when bundling. When --server-components is passed, this
/// will be .browser when it is a client component, and the server's target
/// on the server.
target: bun.options.Target = .browser,

// const_values: ConstValuesMap = .{},
ts_enums: Ast.TsEnumsMap = .{},

flags: BundledAst.Flags = .{},

pub const Flags = packed struct(u8) {
    // This is a list of CommonJS features. When a file uses CommonJS features,
    // it's not a candidate for "flat bundling" and must be wrapped in its own
    // closure.
    uses_exports_ref: bool = false,
    uses_module_ref: bool = false,
    // uses_require_ref: bool = false,
    uses_export_keyword: bool = false,
    has_char_freq: bool = false,
    force_cjs_to_esm: bool = false,
    has_lazy_export: bool = false,
    commonjs_module_exports_assigned_deoptimized: bool = false,
    has_explicit_use_strict_directive: bool = false,
};

pub const empty = BundledAst.init(Ast.empty);

pub fn toAST(this: *const BundledAst) Ast {
    return .{
        .approximate_newline_count = this.approximate_newline_count,
        .nested_scope_slot_counts = this.nested_scope_slot_counts,

        .exports_kind = this.exports_kind,

        .import_records = this.import_records,

        .hashbang = this.hashbang,
        .parts = this.parts,
        // This list may be mutated later, so we should store the capacity
        .symbols = this.symbols,
        .module_scope = this.module_scope,
        .char_freq = if (this.flags.has_char_freq) this.char_freq else null,
        .exports_ref = this.exports_ref,
        .module_ref = this.module_ref,
        .wrapper_ref = this.wrapper_ref,
        .require_ref = this.require_ref,
        .top_level_await_keyword = this.top_level_await_keyword,

        // These are used when bundling. They are filled in during the parser pass
        // since we already have to traverse the AST then anyway and the parser pass
        // is conveniently fully parallelized.
        .named_imports = this.named_imports,
        .named_exports = this.named_exports,
        .export_star_import_records = this.export_star_import_records,

        .top_level_symbols_to_parts = this.top_level_symbols_to_parts,

        .commonjs_named_exports = this.commonjs_named_exports,

        .redirect_import_record_index = this.redirect_import_record_index,

        .target = this.target,

        // .const_values = this.const_values,
        .ts_enums = this.ts_enums,

        .uses_exports_ref = this.flags.uses_exports_ref,
        .uses_module_ref = this.flags.uses_module_ref,
        // .uses_require_ref = ast.uses_require_ref,
        .export_keyword = .{ .len = if (this.flags.uses_export_keyword) 1 else 0, .loc = .{} },
        .force_cjs_to_esm = this.flags.force_cjs_to_esm,
        .has_lazy_export = this.flags.has_lazy_export,
        .commonjs_module_exports_assigned_deoptimized = this.flags.commonjs_module_exports_assigned_deoptimized,
        .directive = if (this.flags.has_explicit_use_strict_directive) "use strict" else null,
    };
}

pub fn init(ast: Ast) BundledAst {
    return .{
        .approximate_newline_count = @as(u32, @truncate(ast.approximate_newline_count)),
        .nested_scope_slot_counts = ast.nested_scope_slot_counts,

        .exports_kind = ast.exports_kind,

        .import_records = ast.import_records,

        .hashbang = ast.hashbang,
        .parts = ast.parts,
        // This list may be mutated later, so we should store the capacity
        .symbols = ast.symbols,
        .module_scope = ast.module_scope,
        .char_freq = ast.char_freq orelse undefined,
        .exports_ref = ast.exports_ref,
        .module_ref = ast.module_ref,
        .wrapper_ref = ast.wrapper_ref,
        .require_ref = ast.require_ref,
        .top_level_await_keyword = ast.top_level_await_keyword,
        // These are used when bundling. They are filled in during the parser pass
        // since we already have to traverse the AST then anyway and the parser pass
        // is conveniently fully parallelized.
        .named_imports = ast.named_imports,
        .named_exports = ast.named_exports,
        .export_star_import_records = ast.export_star_import_records,

        // .allocator = ast.allocator,
        .top_level_symbols_to_parts = ast.top_level_symbols_to_parts,

        .commonjs_named_exports = ast.commonjs_named_exports,

        .redirect_import_record_index = ast.redirect_import_record_index orelse std.math.maxInt(u32),

        .target = ast.target,

        // .const_values = ast.const_values,
        .ts_enums = ast.ts_enums,

        .flags = .{
            .uses_exports_ref = ast.uses_exports_ref,
            .uses_module_ref = ast.uses_module_ref,
            // .uses_require_ref = ast.uses_require_ref,
            .uses_export_keyword = ast.export_keyword.len > 0,
            .has_char_freq = ast.char_freq != null,
            .force_cjs_to_esm = ast.force_cjs_to_esm,
            .has_lazy_export = ast.has_lazy_export,
            .commonjs_module_exports_assigned_deoptimized = ast.commonjs_module_exports_assigned_deoptimized,
            .has_explicit_use_strict_directive = strings.eqlComptime(ast.directive orelse "", "use strict"),
        },
    };
}

/// TODO: Move this from being done on all parse tasks into the start of the linker. This currently allocates base64 encoding for every small file loaded thing.
pub fn addUrlForCss(
    this: *BundledAst,
    allocator: std.mem.Allocator,
    source: *const logger.Source,
    mime_type_: ?[]const u8,
    unique_key: ?[]const u8,
) void {
    {
        const mime_type = if (mime_type_) |m| m else MimeType.byExtension(bun.strings.trimLeadingChar(std.fs.path.extension(source.path.text), '.')).value;
        const contents = source.contents;
        // TODO: make this configurable
        const COPY_THRESHOLD = 128 * 1024; // 128kb
        const should_copy = contents.len >= COPY_THRESHOLD and unique_key != null;
        if (should_copy) return;
        this.url_for_css = url_for_css: {

            // Encode as base64
            const encode_len = bun.base64.encodeLen(contents);
            const data_url_prefix_len = "data:".len + mime_type.len + ";base64,".len;
            const total_buffer_len = data_url_prefix_len + encode_len;
            var encoded = bun.handleOom(allocator.alloc(u8, total_buffer_len));
            _ = std.fmt.bufPrint(encoded[0..data_url_prefix_len], "data:{s};base64,", .{mime_type}) catch unreachable;
            const len = bun.base64.encode(encoded[data_url_prefix_len..], contents);
            break :url_for_css encoded[0 .. data_url_prefix_len + len];
        };
    }
}

pub const CommonJSNamedExports = Ast.CommonJSNamedExports;
pub const ConstValuesMap = Ast.ConstValuesMap;
pub const NamedExports = Ast.NamedExports;
pub const NamedImports = Ast.NamedImports;
pub const TopLevelSymbolToParts = Ast.TopLevelSymbolToParts;

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const ImportRecord = bun.ImportRecord;
const logger = bun.logger;
const strings = bun.strings;
const MimeType = bun.http.MimeType;

const js_ast = bun.ast;
const Ast = js_ast.Ast;
const BundledAst = js_ast.BundledAst;
const CharFreq = js_ast.CharFreq;
const ExportsKind = js_ast.ExportsKind;
const Part = js_ast.Part;
const Ref = js_ast.Ref;
const Scope = js_ast.Scope;
const SlotCounts = js_ast.SlotCounts;
const Symbol = js_ast.Symbol;
const TlaCheck = js_ast.TlaCheck;
