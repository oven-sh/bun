const bun = @import("bun");
const JSC = bun.jsc;
const std = @import("std");

/// C++ function that runs the Fuzzilli REPRL loop
/// Takes a callback pointer for executing JavaScript
extern "c" fn bun__fuzzilli__begin_with_global(callback: ?*const anyopaque) void;

/// Callback invoked by C++ to execute a JavaScript script
/// Returns 0 on success, non-zero on exception or error
fn executeScript(script_ptr: [*c]const u8, script_len: c_ulong) callconv(.c) c_int {
    const script_slice = script_ptr[0..script_len];

    // Get path to current bun executable
    var exe_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    const exe_path = std.fs.selfExePath(&exe_path_buf) catch {
        bun.Output.printErrorln("[Zig] ERROR: Failed to get self exe path", .{});
        return 1;
    };

    // Use `bun -e` to execute the script in a fresh process
    // This provides complete state isolation between executions
    const argv = [_][]const u8{
        exe_path,
        "-e",
        script_slice,
    };

    var child = std.process.Child.init(&argv, bun.default_allocator);
    child.stdin_behavior = .Ignore;
    child.stdout_behavior = .Ignore;
    child.stderr_behavior = .Ignore;

    const term = child.spawnAndWait() catch |err| {
        bun.Output.printErrorln("[Zig] ERROR: Failed to spawn: {}", .{err});
        return 1;
    };

    // Return 0 for success, 1 for any failure
    return switch (term) {
        .Exited => |code| if (code == 0) 0 else 1,
        else => 1,
    };
}

pub const FuzzilliCommand = struct {
    pub fn exec(_: bun.cli.Command.Context) !void {
        bun.Output.printErrorln("[Zig] FuzzilliCommand.exec() called", .{});

        // Initialize JSC
        bun.Output.printErrorln("[Zig] Initializing JSC", .{});
        JSC.initialize(false);
        bun.Output.printErrorln("[Zig] JSC initialized", .{});

        // Call C++ to handle REPRL protocol, passing our execute callback
        bun.Output.printErrorln("[Zig] Calling bun__fuzzilli__begin_with_global()", .{});
        bun__fuzzilli__begin_with_global(@ptrCast(&executeScript));

        bun.Output.printErrorln("[Zig] bun__fuzzilli__begin_with_global() returned (should never happen)", .{});
    }
};
