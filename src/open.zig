const _global = @import("./global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const std = @import("std");
const DotEnv = @import("env_loader.zig");
const ComptimeStringMap = @import("./comptime_string_map.zig").ComptimeStringMap;
const opener = switch (@import("builtin").target.os.tag) {
    .macos => "/usr/bin/open",
    .windows => "start",
    else => "xdg-open",
};

pub fn openURL(url: string) !void {
    if (comptime Environment.isWasi) {
        Output.prettyln("-> {s}", .{url});
        Output.flush();
        return;
    }

    var args_buf = [_]string{ opener, url };
    var child_process = try std.ChildProcess.init(&args_buf, default_allocator);
    child_process.stderr_behavior = .Pipe;
    child_process.stdin_behavior = .Ignore;
    child_process.stdout_behavior = .Pipe;
    try child_process.spawn();
    _ = try child_process.wait();
    return;
}

pub const Editor = enum(u8) {
    none,
    sublime,
    vscode,
    atom,
    textmate,
    intellij,
    webstorm,
    vim,
    neovim,
    emacs,
    other,

    const StringMap = std.EnumMap(Editor, string);
    const StringArrayMap = std.EnumMap(Editor, []const [:0]const u8);

    const name_map = ComptimeStringMap(Editor, .{
        .{ "sublime", Editor.sublime },
        .{ "subl", Editor.sublime },
        .{ "vscode", Editor.vscode },
        .{ "code", Editor.vscode },
        .{ "textmate", Editor.textmate },
        .{ "mate", Editor.textmate },
        .{ "atom", Editor.atom },
        .{ "idea", Editor.intellij },
        .{ "webstorm", Editor.webstorm },
        .{ "nvim", Editor.neovim },
        .{ "neovim", Editor.neovim },
        .{ "vim", Editor.vim },
        .{ "vi", Editor.vim },
        .{ "emacs", Editor.emacs },
    });

    pub fn byName(name: string) ?Editor {
        if (strings.indexOfChar(name, ' ')) |i| {
            return name_map.get(name[0..i]);
        }

        return name_map.get(name);
    }

    pub fn detect(env: *DotEnv.Loader) ?Editor {
        const vars = .{ "EDITOR", "VISUAL" };
        inline for (vars) |name| {
            if (env.get(name)) |value| {
                const basename = std.fs.path.basename(value);
                if (byName(basename)) |editor| {
                    return editor;
                }
            }
        }

        return null;
    }

    const which = @import("./which.zig").which;
    pub fn byPATH(env: *DotEnv.Loader, buf: *[_global.MAX_PATH_BYTES]u8, cwd: string, out: *[]const u8) ?Editor {
        const PATH = env.get("PATH") orelse return null;

        inline for (default_preference_list) |editor| {
            if (bin_name.get(editor)) |path| {
                if (which(buf, PATH, cwd, path)) |bin| {
                    out.* = std.mem.span(bin);
                    return editor;
                }
            }
        }

        return null;
    }

    pub fn byPATHForEditor(env: *DotEnv.Loader, editor: Editor, buf: *[_global.MAX_PATH_BYTES]u8, cwd: string, out: *[]const u8) bool {
        const PATH = env.get("PATH") orelse return false;

        if (bin_name.get(editor)) |path| {
            if (path.len > 0) {
                if (which(buf, PATH, cwd, path)) |bin| {
                    out.* = std.mem.span(bin);
                    return true;
                }
            }
        }

        return false;
    }

    pub fn byFallbackPathForEditor(editor: Editor, out: ?*[]const u8) bool {
        if (bin_path.get(editor)) |paths| {
            for (paths) |path| {
                if (std.os.open(path, 0, 0)) |opened| {
                    std.os.close(opened);
                    if (out != null) {
                        out.?.* = std.mem.span(path);
                    }
                    return true;
                } else |_| {}
            }
        }

        return false;
    }

    pub fn byFallback(env: *DotEnv.Loader, buf: *[_global.MAX_PATH_BYTES]u8, cwd: string, out: *[]const u8) ?Editor {
        inline for (default_preference_list) |editor| {
            if (byPATHForEditor(env, editor, buf, cwd, out)) {
                return editor;
            }

            if (byFallbackPathForEditor(editor, out)) {
                return editor;
            }
        }

        return null;
    }

    pub const default_preference_list = [_]Editor{
        .vscode,
        .sublime,
        .atom,
        .neovim,

        .webstorm,
        .intellij,
        .textmate,
        .vim,
    };

    pub const bin_name: StringMap = brk: {
        var map = StringMap{};

        map.put(.sublime, "subl");
        map.put(.vscode, "code");
        map.put(.atom, "atom");
        map.put(.textmate, "mate");
        map.put(.intellij, "idea");
        map.put(.webstorm, "webstorm");
        map.put(.vim, "vim");
        map.put(.neovim, "nvim");
        map.put(.emacs, "emacs");
        map.put(.other, "");
        break :brk map;
    };

    pub const bin_path: StringArrayMap = brk: {
        var map = StringArrayMap{};

        if (Environment.isMac) {
            map.put(.vscode, &.{
                "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
                "/Applications/VSCodium.app/Contents/Resources/app/bin/code",
            });
            map.put(
                .atom,
                &.{
                    "/Applications/Atom.app/Contents/Resources/app/atom.sh",
                },
            );
            map.put(
                .sublime,
                &.{
                    "/Applications/Sublime Text 4.app/Contents/SharedSupport/bin/subl",
                    "/Applications/Sublime Text 3.app/Contents/SharedSupport/bin/subl",
                    "/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl",
                    "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
                },
            );
        }

        break :brk map;
    };

    pub fn isJetBrains(editor: Editor) bool {
        return switch (editor) {
            .intellij, .webstorm => true,
            else => false,
        };
    }

    pub fn open(
        editor: Editor,
        binary: string,
        file: []const u8,
        line: ?string,
        column: ?string,
        allocator: std.mem.Allocator,
    ) !void {
        var file_path_buf: [_global.MAX_PATH_BYTES + 1024]u8 = undefined;
        var file_path_buf_stream = std.io.fixedBufferStream(&file_path_buf);
        var file_path_buf_writer = file_path_buf_stream.writer();
        var args_buf: [10]string = undefined;

        var i: usize = 0;

        if (editor == .vim or editor == .emacs or editor == .neovim) {
            args_buf[0] = opener;
            i += 1;

            args_buf[i] = binary;
            i += 1;

            if (Environment.isMac) {
                args_buf[i] = "--args";
                i += 1;
            }
        }

        args_buf[i] = binary;
        i += 1;

        if (editor == .vscode and line != null and line.?.len > 0) {
            args_buf[i] = "--goto";

            i += 1;
        }

        switch (editor) {
            .sublime, .atom, .vscode, .webstorm, .intellij => {
                try file_path_buf_writer.writeAll(file);
                if (line) |line_| {
                    if (line_.len > 0) {
                        try file_path_buf_writer.print(":{s}", .{line_});

                        if (!editor.isJetBrains()) {
                            if (column) |col| {
                                if (col.len > 0)
                                    try file_path_buf_writer.print(":{s}", .{col});
                            }
                        }
                    }
                }
                if (file_path_buf_stream.pos > 0) {
                    args_buf[i] = file_path_buf_stream.getWritten();
                    i += 1;
                }
            },
            .textmate => {
                try file_path_buf_writer.writeAll(file);
                var file_path = file_path_buf_stream.getWritten();

                if (line) |line_| {
                    if (line_.len > 0) {
                        args_buf[i] = "--line";
                        i += 1;

                        try file_path_buf_writer.print("{s}", .{line_});

                        if (column) |col| {
                            if (col.len > 0)
                                try file_path_buf_writer.print(":{s}", .{col});
                        }

                        var line_column = file_path_buf_stream.getWritten()[file_path.len..];
                        if (line_column.len > 0) {
                            args_buf[i] = line_column;
                            i += 1;
                        }
                    }
                }

                if (file_path_buf_stream.pos > 0) {
                    args_buf[i] = file_path;
                    i += 1;
                }
            },
            else => {
                if (file.len > 0) {
                    try file_path_buf_writer.writeAll(file);
                    var file_path = file_path_buf_stream.getWritten();
                    args_buf[i] = file_path;
                    i += 1;
                }
            },
        }

        var child_process = try std.ChildProcess.init(args_buf[0..i], allocator);
        child_process.stderr_behavior = .Pipe;
        child_process.stdin_behavior = .Ignore;
        child_process.stdout_behavior = .Pipe;
        try child_process.spawn();
        var thread = try std.Thread.spawn(.{}, autoClose, .{child_process});
        thread.detach();
    }

    fn autoClose(child_process: *std.ChildProcess) void {
        Global.setThreadName("Open Editor");
        _ = child_process.wait() catch {};
        child_process.deinit();
    }
};
