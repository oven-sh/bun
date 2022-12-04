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

const lex = @import("../js_lexer.zig");
const logger = @import("bun").logger;

const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");

const allocators = @import("../allocators.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const fs = @import("../fs.zig");
const URL = @import("../url.zig").URL;
const ParseJSON = @import("../json_parser.zig").ParseJSON;
const Archive = @import("../libarchive/libarchive.zig").Archive;
const Zlib = @import("../zlib.zig");
const JSPrinter = @import("../js_printer.zig");
const DotEnv = @import("../env_loader.zig");
const NPMClient = @import("../which_npm_client.zig").NPMClient;
const which = @import("../which.zig").which;
const clap = @import("bun").clap;
const Lock = @import("../lock.zig").Lock;
const Headers = @import("bun").HTTP.Headers;
const CopyFile = @import("../copy_file.zig");
const ShellCompletions = @import("./shell_completions.zig");

pub const InstallCompletionsCommand = struct {
    pub fn testPath(_: string) !std.fs.Dir {}
    pub fn exec(allocator: std.mem.Allocator) !void {
        var shell = ShellCompletions.Shell.unknown;
        if (bun.getenvZ("SHELL")) |shell_name| {
            shell = ShellCompletions.Shell.fromEnv(@TypeOf(shell_name), shell_name);
        }

        // Fail silently on auto-update.
        const fail_exit_code: u8 = if (bun.getenvZ("IS_BUN_AUTO_UPDATE") == null) 1 else 0;

        switch (shell) {
            .unknown => {
                Output.prettyErrorln("<r><red>error:<r> Unknown or unsupported shell. Please set $SHELL to one of zsh, fish, or bash. To manually output completions, run this:\n      bun getcompletes", .{});
                Global.exit(fail_exit_code);
            },
            else => {},
        }

        var stdout = std.io.getStdOut();

        if (bun.getenvZ("IS_BUN_AUTO_UPDATE") == null) {
            if (!stdout.isTty()) {
                try stdout.writeAll(shell.completions());
                Global.exit(0);
            }
        }

        var completions_dir: string = "";
        var output_dir: std.fs.Dir = found: {
            var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var cwd = std.os.getcwd(&cwd_buf) catch {
                Output.prettyErrorln("<r><red>error<r>: Could not get current working directory", .{});
                Global.exit(fail_exit_code);
            };

            for (std.os.argv) |arg, i| {
                if (strings.eqlComptime(std.mem.span(arg), "completions")) {
                    if (std.os.argv.len > i + 1) {
                        const input = std.mem.span(std.os.argv[i + 1]);

                        if (!std.fs.path.isAbsolute(input)) {
                            completions_dir = resolve_path.joinAbs(
                                cwd,
                                .auto,
                                input,
                            );
                        } else {
                            completions_dir = input;
                        }

                        if (!std.fs.path.isAbsolute(completions_dir)) {
                            Output.prettyErrorln("<r><red>error:<r> Please pass an absolute path. {s} is invalid", .{completions_dir});
                            Global.exit(fail_exit_code);
                        }

                        break :found std.fs.openDirAbsolute(completions_dir, .{
                            .iterate = true,
                        }) catch |err| {
                            Output.prettyErrorln("<r><red>error:<r> accessing {s} errored {s}", .{ completions_dir, @errorName(err) });
                            Global.exit(fail_exit_code);
                        };
                    }

                    break;
                }
            }

            switch (shell) {
                .fish => {
                    if (bun.getenvZ("XDG_CONFIG_HOME")) |config_dir| {
                        outer: {
                            var paths = [_]string{ std.mem.span(config_dir), "./fish/completions" };
                            completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);
                            break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                break :outer;
                        }
                    }

                    if (bun.getenvZ("XDG_DATA_HOME")) |data_dir| {
                        outer: {
                            var paths = [_]string{ std.mem.span(data_dir), "./fish/completions" };
                            completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);

                            break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                break :outer;
                        }
                    }

                    if (bun.getenvZ("HOME")) |home_dir| {
                        outer: {
                            var paths = [_]string{ std.mem.span(home_dir), "./.config/fish/completions" };
                            completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);
                            break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                break :outer;
                        }
                    }

                    outer: {
                        if (Environment.isMac) {
                            if (!Environment.isAarch64) {
                                // homebrew fish
                                completions_dir = "/usr/local/share/fish/completions";
                                break :found std.fs.openDirAbsoluteZ("/usr/local/share/fish/completions", .{ .iterate = true }) catch
                                    break :outer;
                            } else {
                                // homebrew fish
                                completions_dir = "/opt/homebrew/share/fish/completions";
                                break :found std.fs.openDirAbsoluteZ("/opt/homebrew/share/fish/completions", .{ .iterate = true }) catch
                                    break :outer;
                            }
                        }
                    }

                    outer: {
                        completions_dir = "/etc/fish/completions";
                        break :found std.fs.openDirAbsoluteZ("/etc/fish/completions", .{ .iterate = true }) catch break :outer;
                    }
                },
                .zsh => {
                    if (bun.getenvZ("fpath")) |fpath| {
                        var splitter = std.mem.split(u8, std.mem.span(fpath), " ");

                        while (splitter.next()) |dir| {
                            completions_dir = dir;
                            break :found std.fs.openDirAbsolute(dir, .{ .iterate = true }) catch continue;
                        }
                    }

                    if (bun.getenvZ("XDG_DATA_HOME")) |data_dir| {
                        outer: {
                            var paths = [_]string{ std.mem.span(data_dir), "./zsh-completions" };
                            completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);

                            break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                break :outer;
                        }
                    }

                    if (bun.getenvZ("BUN_INSTALL")) |home_dir| {
                        outer: {
                            completions_dir = home_dir;
                            break :found std.fs.openDirAbsolute(home_dir, .{ .iterate = true }) catch
                                break :outer;
                        }
                    }

                    if (bun.getenvZ("HOME")) |home_dir| {
                        {
                            outer: {
                                var paths = [_]string{ std.mem.span(home_dir), "./.oh-my-zsh/completions" };
                                completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);
                                break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                    break :outer;
                            }
                        }

                        {
                            outer: {
                                var paths = [_]string{ std.mem.span(home_dir), "./.bun" };
                                completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);
                                break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                    break :outer;
                            }
                        }
                    }

                    const dirs_to_try = [_]string{
                        "/usr/local/share/zsh/site-functions",
                        "/usr/local/share/zsh/completions",
                        "/opt/homebrew/share/zsh/completions",
                        "/opt/homebrew/share/zsh/site-functions",
                    };

                    for (dirs_to_try) |dir| {
                        completions_dir = dir;
                        break :found std.fs.openDirAbsolute(dir, .{ .iterate = true }) catch continue;
                    }
                },
                .bash => {
                    if (bun.getenvZ("XDG_DATA_HOME")) |data_dir| {
                        outer: {
                            var paths = [_]string{ std.mem.span(data_dir), "./bash-completion/completions" };
                            completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);
                            break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                break :outer;
                        }
                    }

                    if (bun.getenvZ("XDG_CONFIG_HOME")) |config_dir| {
                        outer: {
                            var paths = [_]string{ std.mem.span(config_dir), "./bash-completion/completions" };
                            completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);

                            break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                break :outer;
                        }
                    }

                    if (bun.getenvZ("HOME")) |home_dir| {
                        {
                            outer: {
                                var paths = [_]string{ std.mem.span(home_dir), "./.oh-my-bash/custom/completions" };
                                completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);

                                break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                    break :outer;
                            }
                        }
                        {
                            outer: {
                                var paths = [_]string{ std.mem.span(home_dir), "./.bash_completion.d" };
                                completions_dir = resolve_path.joinAbsString(cwd, &paths, .auto);

                                break :found std.fs.openDirAbsolute(completions_dir, .{ .iterate = true }) catch
                                    break :outer;
                            }
                        }
                    }

                    const dirs_to_try = [_]string{
                        "/opt/homebrew/share/bash-completion/completions/",
                        "/opt/local/share/bash-completion/completions/",
                    };

                    for (dirs_to_try) |dir| {
                        completions_dir = dir;
                        break :found std.fs.openDirAbsolute(dir, .{ .iterate = true }) catch continue;
                    }
                },
                else => unreachable,
            }

            Output.prettyErrorln(
                "<r><red>error:<r> Could not find a directory to install completions in.\n",
                .{},
            );

            if (shell == .zsh) {
                Output.prettyErrorln(
                    "\nzsh tip: One of the directories in $fpath might work. If you use oh-my-zsh, try mkdir $HOME/.oh-my-zsh/completions; and bun completions again\n.",
                    .{},
                );
            }

            Output.errorLn(
                "Please either pipe it:\n   bun completions > /to/a/file\n\n Or pass a directory:\n\n   bun completions /my/completions/dir\n",
                .{},
            );
            Global.exit(fail_exit_code);
        };

        const filename = switch (shell) {
            .fish => "bun.fish",
            .zsh => "_bun",
            .bash => "bun.completion.bash",
            else => unreachable,
        };

        std.debug.assert(completions_dir.len > 0);

        var output_file = output_dir.createFileZ(filename, .{
            .truncate = true,
        }) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> Could not open {s} for writing: {s}", .{
                filename,
                @errorName(err),
            });
            Global.exit(fail_exit_code);
        };

        output_file.writeAll(shell.completions()) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> Could not write to {s}: {s}", .{
                filename,
                @errorName(err),
            });
            Global.exit(fail_exit_code);
        };

        defer output_file.close();
        output_dir.close();

        // Check if they need to load the zsh completions file into their .zshrc
        if (shell == .zsh) {
            var completions_absolute_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var completions_path = std.os.getFdPath(output_file.handle, &completions_absolute_path_buf) catch unreachable;
            var zshrc_filepath: [bun.MAX_PATH_BYTES]u8 = undefined;
            const needs_to_tell_them_to_add_completions_file = brk: {
                var dot_zshrc: std.fs.File = zshrc: {
                    first: {

                        // https://zsh.sourceforge.io/Intro/intro_3.html
                        // There are five startup files that zsh will read commands from:
                        // $ZDOTDIR/.zshenv
                        // $ZDOTDIR/.zprofile
                        // $ZDOTDIR/.zshrc
                        // $ZDOTDIR/.zlogin
                        // $ZDOTDIR/.zlogout

                        if (bun.getenvZ("ZDOTDIR")) |zdot_dir| {
                            std.mem.copy(u8, &zshrc_filepath, std.mem.span(zdot_dir));
                            std.mem.copy(u8, zshrc_filepath[zdot_dir.len..], "/.zshrc");
                            zshrc_filepath[zdot_dir.len + "/.zshrc".len] = 0;
                            var filepath = zshrc_filepath[0 .. zdot_dir.len + "/.zshrc".len :0];
                            break :zshrc std.fs.openFileAbsoluteZ(filepath, .{ .mode = .read_write }) catch break :first;
                        }
                    }

                    second: {
                        if (bun.getenvZ("HOME")) |zdot_dir| {
                            std.mem.copy(u8, &zshrc_filepath, std.mem.span(zdot_dir));
                            std.mem.copy(u8, zshrc_filepath[zdot_dir.len..], "/.zshrc");
                            zshrc_filepath[zdot_dir.len + "/.zshrc".len] = 0;
                            var filepath = zshrc_filepath[0 .. zdot_dir.len + "/.zshrc".len :0];
                            break :zshrc std.fs.openFileAbsoluteZ(filepath, .{ .mode = .read_write }) catch break :second;
                        }
                    }

                    third: {
                        if (bun.getenvZ("HOME")) |zdot_dir| {
                            std.mem.copy(u8, &zshrc_filepath, std.mem.span(zdot_dir));
                            std.mem.copy(u8, zshrc_filepath[zdot_dir.len..], "/.zshenv");
                            zshrc_filepath[zdot_dir.len + "/.zshenv".len] = 0;
                            var filepath = zshrc_filepath[0 .. zdot_dir.len + "/.zshenv".len :0];
                            break :zshrc std.fs.openFileAbsoluteZ(filepath, .{ .mode = .read_write }) catch break :third;
                        }
                    }

                    break :brk true;
                };
                defer dot_zshrc.close();
                var buf = allocator.alloc(
                    u8,
                    // making up a number big enough to not overflow
                    (dot_zshrc.getEndPos() catch break :brk true) + completions_path.len * 4 + 96,
                ) catch break :brk true;

                const read = dot_zshrc.preadAll(
                    buf,
                    0,
                ) catch break :brk true;

                var contents = buf[0..read];

                // Do they possibly have it in the file already?
                if (std.mem.indexOf(u8, contents, completions_path) != null) {
                    break :brk false;
                }

                // Okay, we need to add it

                // We need to add it to the end of the file
                var remaining = buf[read..];
                var extra = std.fmt.bufPrint(remaining, "\n# bun completions\n[ -s \"{s}\" ] && source \"{s}\"\n", .{
                    completions_path,
                    completions_path,
                }) catch unreachable;

                dot_zshrc.pwriteAll(extra, read) catch break :brk true;

                Output.prettyErrorln("<r><d>Enabled loading bun's completions in .zshrc<r>", .{});
                break :brk false;
            };

            if (needs_to_tell_them_to_add_completions_file) {
                Output.prettyErrorln("<r>To enable completions, add this to your .zshrc:\n      <b>[ -s \"{s}\" ] && source \"{s}\"", .{
                    completions_path,
                    completions_path,
                });
            }
        }

        Output.prettyErrorln("<r><d>Installed completions to {s}/{s}<r>\n", .{
            completions_dir,
            filename,
        });
        Output.flush();
    }
};
