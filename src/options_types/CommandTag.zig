//! `bun.cli.Command.Tag` — the top-level CLI subcommand discriminant.
//! Extracted to `options_types/` so lower tiers (install/, bundler/) can
//! switch on which command is running without importing `cli/`.
//!
//! Heavy methods that reference `Arguments`/`HelpCommand`/`clap` (`params()`,
//! `printHelp()`) live in `src/cli/cli.zig` as free fns; only the pure enum,
//! `char()`, classifier predicates, and the `EnumArray` flag tables are here.

pub const Tag = enum {
    AddCommand,
    AutoCommand,
    BuildCommand,
    BunxCommand,
    CreateCommand,
    DiscordCommand,
    GetCompletionsCommand,
    HelpCommand,
    InitCommand,
    InfoCommand,
    InstallCommand,
    InstallCompletionsCommand,
    LinkCommand,
    PackageManagerCommand,
    RemoveCommand,
    RunCommand,
    RunAsNodeCommand, // arg0 == 'node'
    TestCommand,
    UnlinkCommand,
    UpdateCommand,
    UpgradeCommand,
    ReplCommand,
    ReservedCommand,
    ExecCommand,
    PatchCommand,
    PatchCommitCommand,
    OutdatedCommand,
    UpdateInteractiveCommand,
    PublishCommand,
    AuditCommand,
    WhyCommand,
    FuzzilliCommand,

    /// Used by crash reports.
    ///
    /// This must be kept in sync with https://github.com/oven-sh/bun.report/blob/62601d8aafb9c0d29554dfc3f8854044ec04d367/backend/remap.ts#L10
    pub fn char(this: Tag) u8 {
        return switch (this) {
            .AddCommand => 'I',
            .AutoCommand => 'a',
            .BuildCommand => 'b',
            .BunxCommand => 'B',
            .CreateCommand => 'c',
            .DiscordCommand => 'D',
            .GetCompletionsCommand => 'g',
            .HelpCommand => 'h',
            .InitCommand => 'j',
            .InfoCommand => 'v',
            .InstallCommand => 'i',
            .InstallCompletionsCommand => 'C',
            .LinkCommand => 'l',
            .PackageManagerCommand => 'P',
            .RemoveCommand => 'R',
            .RunCommand => 'r',
            .RunAsNodeCommand => 'n',
            .TestCommand => 't',
            .UnlinkCommand => 'U',
            .UpdateCommand => 'u',
            .UpgradeCommand => 'p',
            .ReplCommand => 'G',
            .ReservedCommand => 'w',
            .ExecCommand => 'e',
            .PatchCommand => 'x',
            .PatchCommitCommand => 'z',
            .OutdatedCommand => 'o',
            .UpdateInteractiveCommand => 'U',
            .PublishCommand => 'k',
            .AuditCommand => 'A',
            .WhyCommand => 'W',
            .FuzzilliCommand => 'F',
        };
    }

    pub fn readGlobalConfig(this: Tag) bool {
        return switch (this) {
            .BunxCommand,
            .PackageManagerCommand,
            .InstallCommand,
            .AddCommand,
            .RemoveCommand,
            .UpdateCommand,
            .PatchCommand,
            .PatchCommitCommand,
            .OutdatedCommand,
            .PublishCommand,
            .AuditCommand,
            => true,
            else => false,
        };
    }

    pub fn isNPMRelated(this: Tag) bool {
        return switch (this) {
            .BunxCommand,
            .LinkCommand,
            .UnlinkCommand,
            .PackageManagerCommand,
            .InstallCommand,
            .AddCommand,
            .RemoveCommand,
            .UpdateCommand,
            .PatchCommand,
            .PatchCommitCommand,
            .OutdatedCommand,
            .PublishCommand,
            .AuditCommand,
            => true,
            else => false,
        };
    }

    pub const loads_config: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(false, .{
        .BuildCommand = true,
        .TestCommand = true,
        .InstallCommand = true,
        .AddCommand = true,
        .RemoveCommand = true,
        .UpdateCommand = true,
        .PatchCommand = true,
        .PatchCommitCommand = true,
        .PackageManagerCommand = true,
        .BunxCommand = true,
        .AutoCommand = true,
        .RunCommand = true,
        .RunAsNodeCommand = true,
        .OutdatedCommand = true,
        .UpdateInteractiveCommand = true,
        .PublishCommand = true,
        .AuditCommand = true,
    });

    pub const always_loads_config: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(false, .{
        .BuildCommand = true,
        .TestCommand = true,
        .InstallCommand = true,
        .AddCommand = true,
        .RemoveCommand = true,
        .UpdateCommand = true,
        .PatchCommand = true,
        .PatchCommitCommand = true,
        .PackageManagerCommand = true,
        .BunxCommand = true,
        .OutdatedCommand = true,
        .UpdateInteractiveCommand = true,
        .PublishCommand = true,
        .AuditCommand = true,
    });

    pub const uses_global_options: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(true, .{
        .AddCommand = false,
        .AuditCommand = false,
        .BunxCommand = false,
        .CreateCommand = false,
        .InfoCommand = false,
        .InstallCommand = false,
        .LinkCommand = false,
        .OutdatedCommand = false,
        .UpdateInteractiveCommand = false,
        .PackageManagerCommand = false,
        .PatchCommand = false,
        .PatchCommitCommand = false,
        .PublishCommand = false,
        .RemoveCommand = false,
        .UnlinkCommand = false,
        .UpdateCommand = false,
    });

    /// Heavy methods that pull in `Arguments` / help text live in `cli/cli.zig`.
    /// Aliased here so existing `cmd.params()` / `cmd.printHelp()` call sites
    /// keep working; Zig's lazy decl resolution means `options_types/` does
    /// not compile-depend on `cli/` unless one of these is actually invoked.
    pub const params = @import("../cli/cli.zig").Command.tagParams;
    pub const printHelp = @import("../cli/cli.zig").Command.tagPrintHelp;
};

const std = @import("std");
