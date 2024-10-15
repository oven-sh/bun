const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");

const ArrayList = std.ArrayListUnmanaged;

const MediaRule = css.css_rules.media.MediaRule;
const MediaQuery = css.media_query.MediaQuery;
const MediaCondition = css.media_query.MediaCondition;
const MediaList = css.media_query.MediaList;
const MediaFeature = css.media_query.MediaFeature;
const MediaFeatureName = css.media_query.MediaFeatureName;
const MediaFeatureValue = css.media_query.MediaFeatureValue;
const MediaFeatureId = css.media_query.MediaFeatureId;

pub const SupportsEntry = struct {
    condition: css.SupportsCondition,
    declarations: ArrayList(css.Property),
    important_declarations: ArrayList(css.Property),

    pub fn deinit(this: *@This(), allocator: std.mem.Allocator) void {
        _ = this; // autofix
        _ = allocator; // autofix
        @panic(css.todo_stuff.depth);
    }
};

pub const DeclarationContext = enum {
    none,
    style_rule,
    keyframes,
    style_attribute,
};

pub const PropertyHandlerContext = struct {
    allocator: Allocator,
    targets: css.targets.Targets,
    is_important: bool,
    supports: ArrayList(SupportsEntry),
    ltr: ArrayList(css.Property),
    rtl: ArrayList(css.Property),
    dark: ArrayList(css.Property),
    context: DeclarationContext,
    unused_symbols: *const std.StringArrayHashMapUnmanaged(void),

    pub fn new(
        allocator: Allocator,
        targets: css.targets.Targets,
        unused_symbols: *const std.StringArrayHashMapUnmanaged(void),
    ) PropertyHandlerContext {
        return PropertyHandlerContext{
            .allocator = allocator,
            .targets = targets,
            .is_important = false,
            .supports = ArrayList(SupportsEntry){},
            .ltr = ArrayList(css.Property){},
            .rtl = ArrayList(css.Property){},
            .dark = ArrayList(css.Property){},
            .context = DeclarationContext.none,
            .unused_symbols = unused_symbols,
        };
    }

    pub fn child(this: *const PropertyHandlerContext, context: DeclarationContext) PropertyHandlerContext {
        return PropertyHandlerContext{
            .allocator = this.allocator,
            .targets = this.targets,
            .is_important = false,
            .supports = .{},
            .ltr = .{},
            .rtl = .{},
            .dark = .{},
            .context = context,
            .unused_symbols = this.unused_symbols,
        };
    }

    pub fn getSupportsRules(
        this: *const @This(),
        comptime T: type,
        style_rule: *const css.StyleRule(T),
    ) ArrayList(css.CssRule(T)) {
        if (this.supports.items.len == 0) {
            return .{};
        }

        var dest = ArrayList(css.CssRule(T)).initCapacity(
            this.allocator,
            this.supports.items.len,
        ) catch bun.outOfMemory();

        for (this.supports.items) |*entry| {
            dest.appendAssumeCapacity(css.CssRule(T){
                .supports = css.SupportsRule(T){
                    .condition = entry.condition.deepClone(this.allocator),
                    .rules = css.CssRuleList(T){
                        .v = v: {
                            var v = ArrayList(css.CssRule(T)).initCapacity(this.allocator, 1) catch bun.outOfMemory();

                            v.appendAssumeCapacity(.{ .style = css.StyleRule(T){
                                .selectors = style_rule.selectors.deepClone(this.allocator),
                                .vendor_prefix = css.VendorPrefix{ .none = true },
                                .declarations = css.DeclarationBlock{
                                    .declarations = css.deepClone(css.Property, this.allocator, &entry.declarations),
                                    .important_declarations = css.deepClone(css.Property, this.allocator, &entry.important_declarations),
                                },
                                .rules = css.CssRuleList(T){},
                                .loc = style_rule.loc,
                            } });

                            break :v v;
                        },
                    },
                    .loc = style_rule.loc,
                },
            });
        }

        return dest;
    }

    pub fn getAdditionalRules(
        this: *const @This(),
        comptime T: type,
        style_rule: *const css.StyleRule(T),
    ) ArrayList(css.CssRule(T)) {
        // TODO: :dir/:lang raises the specificity of the selector. Use :where to lower it?
        var dest = ArrayList(css.CssRule(T)){};

        if (this.ltr.items.len > 0) {
            getAdditionalRulesHelper(this, T, "ltr", "ltr", style_rule, &dest);
        }

        if (this.rtl.items.len > 0) {
            getAdditionalRulesHelper(this, T, "rtl", "rtl", style_rule, &dest);
        }

        if (this.dark.items.len > 0) {
            dest.append(this.allocator, css.CssRule(T){
                .media = MediaRule(T){
                    .query = MediaList{
                        .media_queries = brk: {
                            var list = ArrayList(MediaQuery).initCapacity(
                                this.allocator,
                                1,
                            ) catch bun.outOfMemory();

                            list.appendAssumeCapacity(MediaQuery{
                                .qualifier = null,
                                .media_type = .all,
                                .condition = MediaCondition{
                                    .feature = MediaFeature{
                                        .plain = .{
                                            .name = .{ .standard = MediaFeatureId.@"prefers-color-scheme" },
                                            .value = .{ .ident = .{ .v = "dark " } },
                                        },
                                    },
                                },
                            });

                            break :brk list;
                        },
                    },
                    .rules = brk: {
                        var list: css.CssRuleList(T) = .{};

                        list.v.append(this.allocator, css.CssRule(T){
                            .style = css.StyleRule(T){
                                .selectors = style_rule.selectors.deepClone(this.allocator),
                                .vendor_prefix = css.VendorPrefix{ .none = true },
                                .declarations = css.DeclarationBlock{
                                    .declarations = css.deepClone(css.Property, this.allocator, &this.dark),
                                    .important_declarations = .{},
                                },
                                .rules = .{},
                                .loc = style_rule.loc,
                            },
                        }) catch bun.outOfMemory();

                        break :brk list;
                    },
                    .loc = style_rule.loc,
                },
            }) catch bun.outOfMemory();
        }

        return dest;
    }
    pub fn getAdditionalRulesHelper(
        this: *const @This(),
        comptime T: type,
        comptime dir: []const u8,
        comptime decls: []const u8,
        sty: *const css.StyleRule(T),
        dest: *ArrayList(css.CssRule(T)),
    ) void {
        var selectors = sty.selectors.deepClone(this.allocator);
        for (selectors.v.slice_mut()) |*selector| {
            selector.append(this.allocator, css.Component{
                .non_ts_pseudo_class = css.PseudoClass{
                    .dir = .{ .direction = @field(css.selector.parser.Direction, dir) },
                },
            });

            const rule = css.StyleRule(T){
                .selectors = selectors,
                .vendor_prefix = css.VendorPrefix{ .none = true },
                .declarations = css.DeclarationBlock{
                    .declarations = css.deepClone(css.Property, this.allocator, &@field(this, decls)),
                    .important_declarations = .{},
                },
                .rules = .{},
                .loc = sty.loc,
            };

            dest.append(this.allocator, .{ .style = rule }) catch bun.outOfMemory();
        }
    }

    pub fn reset(this: *@This()) void {
        for (this.supports.items) |*supp| {
            supp.deinit(this.allocator);
        }
        this.supports.clearRetainingCapacity();

        for (this.ltr.items) |*ltr| {
            ltr.deinit(this.allocator);
        }
        this.ltr.clearRetainingCapacity();

        for (this.rtl.items) |*rtl| {
            rtl.deinit(this.allocator);
        }
        this.rtl.clearRetainingCapacity();

        for (this.dark.items) |*dark| {
            dark.deinit(this.allocator);
        }
        this.dark.clearRetainingCapacity();
    }
};
