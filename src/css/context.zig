const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");

const ArrayList = std.ArrayListUnmanaged;

pub const SupportsEntry = struct {
    condition: css.SupportsCondition,
    declarations: ArrayList(css.Property),
    important_declarations: ArrayList(css.Property),
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
};
