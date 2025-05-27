const std = @import("std");
const bun = @import("bun");
const Output = bun.Output;
const strings = bun.strings;

pub const Shell = enum {
    unknown,
    bash,
    zsh,
    fish,
    pwsh,

    const bash_completions = @embedFile("completions-bash");
    const zsh_completions = @embedFile("completions-zsh");
    const fish_completions = @embedFile("completions-fish");

    pub fn completions(this: Shell) []const u8 {
        return switch (this) {
            .bash => bash_completions,
            .zsh => zsh_completions,
            .fish => fish_completions,
            else => "",
        };
    }

    pub fn fromEnv(comptime Type: type, SHELL: Type) Shell {
        const basename = std.fs.path.basename(SHELL);
        if (strings.eqlComptime(basename, "bash")) {
            return .bash;
        } else if (strings.eqlComptime(basename, "zsh")) {
            return .zsh;
        } else if (strings.eqlComptime(basename, "fish")) {
            return .fish;
        } else if (strings.eqlComptime(basename, "pwsh") or
            strings.eqlComptime(basename, "powershell"))
        {
            return .pwsh;
        } else {
            return .unknown;
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
        for (this.commands[1..], 0..) |cmd, i| {
            writer.writeAll(delimiter) catch return;

            writer.writeAll(cmd) catch return;
            if (this.descriptions.len > 0) {
                writer.writeAll("\t") catch return;
                writer.writeAll(this.descriptions[i]) catch return;
            }
        }
    }
}
