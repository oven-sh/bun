const std = @import("std");
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

pub const Shell = enum {
    unknown,
    bash,
    zsh,
    fish,

    const bash_completions = @import("root").completions.bash;
    const zsh_completions = @import("root").completions.zsh;
    const fish_completions = @import("root").completions.fish;

    pub fn completions(this: Shell) []const u8 {
        return switch (this) {
            .bash => std.mem.span(bash_completions),
            .zsh => std.mem.span(zsh_completions),
            .fish => std.mem.span(fish_completions),
            else => "",
        };
    }

    pub fn fromEnv(comptime Type: type, SHELL: Type) Shell {
        const basename = std.fs.path.basename(SHELL);
        if (strings.eqlComptime(basename, "bash")) {
            return Shell.bash;
        } else if (strings.eqlComptime(basename, "zsh")) {
            return Shell.zsh;
        } else if (strings.eqlComptime(basename, "fish")) {
            return Shell.fish;
        } else {
            return Shell.unknown;
        }
    }
};

commands: []const []const u8 = &[_][]u8{},
descriptions: []const []const u8 = &[_][]u8{},
flags: []const []const u8 = &[_][]u8{},
shell: Shell = Shell.unknown,

pub fn print(this: @This()) void {
    defer Output.flush();
    var writer = Output.writer();

    if (this.commands.len == 0) return;
    const delimiter = if (this.shell == Shell.fish) " " else "\n";

    writer.writeAll(this.commands[0]) catch return;

    if (this.descriptions.len > 0) {
        writer.writeAll("\t") catch return;
        writer.writeAll(this.descriptions[0]) catch return;
    }

    if (this.commands.len > 1) {
        for (this.commands[1..]) |cmd, i| {
            writer.writeAll(delimiter) catch return;

            writer.writeAll(cmd) catch return;
            if (this.descriptions.len > 0) {
                writer.writeAll("\t") catch return;
                writer.writeAll(this.descriptions[i]) catch return;
            }
        }
    }
}
