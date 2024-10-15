//! Port of the editor detection logic from Next.js. MIT License
//! https://github.com/vercel/next.js/blob/3cde42ff72de76918ce86e652acfca2d8d85727e/packages/next/src/client/components/react-dev-overlay/internal/helpers/launchEditor.ts

program: []const []const u8,
mode: Mode = .other,

fn detectConfig() @This() {
    // TODO:
}

const Options = struct {
    file: []const u8,
    line: []const u8,
    column: []const u8,
};

const Mode = enum {
    atom,
    webstorm,
    notepad_plus_plus,
    idea,
    vim,
    emacs,
    code,
    textmate,
    other,

    pub fn args(mode: Mode, opts: Options, arena: Allocator) ![]const []const u8 {
        switch (mode) {
            .atom => &.{mem.join(arena, &.{ opts.file, opts.line, opts.column }, ":")},
            .webstorm => &.{mem.join(arena, &.{ opts.file, opts.line }, ":")},
        }
    }
};

/// Map from full process name to binary that starts the process. We can"t just
/// re-use full process name, because it will spawn a new instance of the app
/// every time
const common_editors = bun.ComptimeStringMap(if (bun.Environment.isWindows) void else []const u8, switch (bun.Environment.os) {
    .mac => .{
        .{ "/Applications/Atom.app/Contents/MacOS/Atom", "atom" },
        .{ "/Applications/Atom Beta.app/Contents/MacOS/Atom Beta", "/Applications/Atom Beta.app/Contents/MacOS/Atom Beta" },
        .{ "/Applications/Brackets.app/Contents/MacOS/Brackets", "brackets" },
        .{ "/Applications/Sublime Text.app/Contents/MacOS/Sublime Text", "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl" },
        .{ "/Applications/Sublime Text Dev.app/Contents/MacOS/Sublime Text", "/Applications/Sublime Text Dev.app/Contents/SharedSupport/bin/subl" },
        .{ "/Applications/Sublime Text 2.app/Contents/MacOS/Sublime Text 2", "/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl" },
        .{ "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" },
        .{ "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron", "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" },
        .{ "/Applications/VSCodium.app/Contents/MacOS/Electron", "/Applications/VSCodium.app/Contents/Resources/app/bin/code" },
        .{ "/Applications/AppCode.app/Contents/MacOS/appcode", "/Applications/AppCode.app/Contents/MacOS/appcode" },
        .{ "/Applications/CLion.app/Contents/MacOS/clion", "/Applications/CLion.app/Contents/MacOS/clion" },
        .{ "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea", "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea" },
        .{ "/Applications/PhpStorm.app/Contents/MacOS/phpstorm", "/Applications/PhpStorm.app/Contents/MacOS/phpstorm" },
        .{ "/Applications/PyCharm.app/Contents/MacOS/pycharm", "/Applications/PyCharm.app/Contents/MacOS/pycharm" },
        .{ "/Applications/PyCharm CE.app/Contents/MacOS/pycharm", "/Applications/PyCharm CE.app/Contents/MacOS/pycharm" },
        .{ "/Applications/RubyMine.app/Contents/MacOS/rubymine", "/Applications/RubyMine.app/Contents/MacOS/rubymine" },
        .{ "/Applications/WebStorm.app/Contents/MacOS/webstorm", "/Applications/WebStorm.app/Contents/MacOS/webstorm" },
        .{ "/Applications/MacVim.app/Contents/MacOS/MacVim", "mvim" },
        .{ "/Applications/GoLand.app/Contents/MacOS/goland", "/Applications/GoLand.app/Contents/MacOS/goland" },
        .{ "/Applications/Rider.app/Contents/MacOS/rider", "/Applications/Rider.app/Contents/MacOS/rider" },
    },
    .linux => .{
        .{ "atom", "atom" },
        .{ "Brackets", "brackets" },
        .{ "code", "code" },
        .{ "code-insiders", "code-insiders" },
        .{ "vscodium", "vscodium" },
        .{ "emacs", "emacs" },
        .{ "gvim", "gvim" },
        .{ "idea.sh", "idea" },
        .{ "phpstorm.sh", "phpstorm" },
        .{ "pycharm.sh", "pycharm" },
        .{ "rubymine.sh", "rubymine" },
        .{ "sublime_text", "sublime_text" },
        .{ "vim", "vim" },
        .{ "nvim", "nvim" },
        .{ "webstorm.sh", "webstorm" },
        .{ "'goland.sh'", "goland" },
        .{ "rider.sh", "rider" },
    },
    .windows => .{
        "Brackets.exe",
        "Code.exe",
        "Code - Insiders.exe",
        "VSCodium.exe",
        "atom.exe",
        "sublime_text.exe",
        "notepad++.exe",
        "clion.exe",
        "clion64.exe",
        "idea.exe",
        "idea64.exe",
        "phpstorm.exe",
        "phpstorm64.exe",
        "pycharm.exe",
        "pycharm64.exe",
        "rubymine.exe",
        "rubymine64.exe",
        "webstorm.exe",
        "webstorm64.exe",
        "goland.exe",
        "goland64.exe",
        "rider.exe",
        "rider64.exe",
    },
});

const std = @import("std");
const bun = @import("root").bun;
const mem = std.mem;
const Allocator = mem.Allocator;
