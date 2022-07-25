const std = @import("std");

test {
    _ = @import("./comptime_string_map.zig");
    _ = @import("./exact_size_matcher.zig");
    _ = @import("./futex.zig");
    _ = @import("./hash_map.zig");
    _ = @import("./js_lexer.zig");
    _ = @import("./js_lexer_tables.zig");
    _ = @import("./global_utils.zig");
    _ = @import("./linear_fifo.zig");
    _ = @import("./string_immutable.zig");
    _ = @import("./string_mutable.zig");
    _ = @import("./which.zig");
    _ = @import("./ast/base.zig");
    _ = @import("./bun.js/webcore/base64.zig");
    _ = @import("./install/bit_set.zig");
    _ = @import("./install/semver.zig");
    _ = @import("./install/update_request.zig");
    _ = @import("./io/fifo.zig");
    _ = @import("./resolver/resolve_path.zig");
    _ = @import("./sourcemap/vlq_bench.zig");
}
