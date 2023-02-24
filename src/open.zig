const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
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
    var child_process = std.ChildProcess.init(&args_buf, default_allocator);
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
    pub fn byPATH(env: *DotEnv.Loader, buf: *[bun.MAX_PATH_BYTES]u8, cwd: string, out: *[]const u8) ?Editor {
        const PATH = env.get("PATH") orelse return null;

        inline for (default_preference_list) |editor| {
            if (bin_name.get(editor)) |path| {
                if (which(buf, PATH, cwd, path)) |bin| {
                    out.* = bun.asByteSlice(bin);
                    return editor;
                }
            }
        }

        return null;
    }

    pub fn byPATHForEditor(env: *DotEnv.Loader, editor: Editor, buf: *[bun.MAX_PATH_BYTES]u8, cwd: string, out: *[]const u8) bool {
        const PATH = env.get("PATH") orelse return false;

        if (bin_name.get(editor)) |path| {
            if (path.len > 0) {
                if (which(buf, PATH, cwd, path)) |bin| {
                    out.* = bun.asByteSlice(bin);
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
                        out.?.* = bun.asByteSlice(path);
                    }
                    return true;
                } else |_| {}
            }
        }

        return false;
    }

    pub fn byFallback(env: *DotEnv.Loader, buf: *[bun.MAX_PATH_BYTES]u8, cwd: string, out: *[]const u8) ?Editor {
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
        _: std.mem.Allocator,
    ) !void {
        var spawned = try default_allocator.create(SpawnedEditorContext);
        spawned.* = .{};
        var file_path_buf_stream = std.io.fixedBufferStream(&spawned.file_path_buf);
        var file_path_buf_writer = file_path_buf_stream.writer();
        var args_buf = &spawned.buf;
        errdefer default_allocator.destroy(spawned);

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

        spawned.child_process = std.ChildProcess.init(args_buf[0..i], default_allocator);
        var thread = try std.Thread.spawn(.{}, autoClose, .{spawned});
        thread.detach();
    }
    const SpawnedEditorContext = struct {
        file_path_buf: [1024 + bun.MAX_PATH_BYTES]u8 = undefined,
        buf: [10]string = undefined,
        child_process: std.ChildProcess = undefined,
    };

    fn autoClose(spawned: *SpawnedEditorContext) void {
        defer bun.default_allocator.destroy(spawned);

        Global.setThreadName("Open Editor");
        spawned.child_process.spawn() catch return;
        _ = spawned.child_process.wait() catch {};
    }
};

pub const EditorContext = struct {
    editor: ?Editor = null,
    name: string = "",
    path: string = "",
    const Fs = @import("./fs.zig");

    pub fn openInEditor(this: *EditorContext, editor_: Editor, blob: []const u8, id: string, tmpdir: std.fs.Dir, line: string, column: string) void {
        _openInEditor(this.path, editor_, blob, id, tmpdir, line, column) catch |err| {
            if (editor_ != .other) {
                Output.prettyErrorln("Error {s} opening in {s}", .{ @errorName(err), @tagName(editor_) });
            }

            this.editor = Editor.none;
        };
    }

    fn _openInEditor(path: string, editor_: Editor, blob: []const u8, id: string, tmpdir: std.fs.Dir, line: string, column: string) !void {
        var basename_buf: [512]u8 = undefined;
        var basename = std.fs.path.basename(id);
        if (strings.endsWith(basename, ".bun") and basename.len < 499) {
            bun.copy(u8, &basename_buf, basename);
            basename_buf[basename.len..][0..3].* = ".js".*;
            basename = basename_buf[0 .. basename.len + 3];
        }

        try tmpdir.writeFile(basename, blob);

        var opened = try tmpdir.openFile(basename, .{});
        defer opened.close();
        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        try editor_.open(
            path,
            try bun.getFdPath(opened.handle, &path_buf),
            line,
            column,
            default_allocator,
        );
    }

    pub fn autoDetectEditor(this: *EditorContext, env: *DotEnv.Loader) void {
        if (this.editor == null) {
            this.detectEditor(env);
        }
    }
    pub fn detectEditor(this: *EditorContext, env: *DotEnv.Loader) void {
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        var out: string = "";
        // first: choose from user preference
        if (this.name.len > 0) {
            // /usr/bin/vim
            if (std.fs.path.isAbsolute(this.name)) {
                this.editor = Editor.byName(std.fs.path.basename(this.name)) orelse Editor.other;
                this.path = this.name;
                return;
            }

            // "vscode"
            if (Editor.byName(std.fs.path.basename(this.name))) |editor_| {
                if (Editor.byPATHForEditor(env, editor_, &buf, Fs.FileSystem.instance.top_level_dir, &out)) {
                    this.editor = editor_;
                    this.path = Fs.FileSystem.instance.dirname_store.append(string, out) catch unreachable;
                    return;
                }

                // not in path, try common ones
                if (Editor.byFallbackPathForEditor(editor_, &out)) {
                    this.editor = editor_;
                    this.path = Fs.FileSystem.instance.dirname_store.append(string, out) catch unreachable;
                    return;
                }
            }
        }

        // EDITOR=code
        if (Editor.detect(env)) |editor_| {
            if (Editor.byPATHForEditor(env, editor_, &buf, Fs.FileSystem.instance.top_level_dir, &out)) {
                this.editor = editor_;
                this.path = Fs.FileSystem.instance.dirname_store.append(string, out) catch unreachable;
                return;
            }

            // not in path, try common ones
            if (Editor.byFallbackPathForEditor(editor_, &out)) {
                this.editor = editor_;
                this.path = Fs.FileSystem.instance.dirname_store.append(string, out) catch unreachable;
                return;
            }
        }

        // Don't know, so we will just guess based on what exists
        if (Editor.byFallback(env, &buf, Fs.FileSystem.instance.top_level_dir, &out)) |editor_| {
            this.editor = editor_;
            this.path = Fs.FileSystem.instance.dirname_store.append(string, out) catch unreachable;
            return;
        }

        this.editor = Editor.none;
    }
};
