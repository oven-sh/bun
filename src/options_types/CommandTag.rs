//! `bun.cli.Command.Tag` — the top-level CLI subcommand discriminant.
//! Extracted to `options_types/` so lower tiers (install/, bundler/) can
//! switch on which command is running without importing `cli/`.
//!
//! Heavy methods that reference `Arguments`/`HelpCommand`/`clap` (`params()`,
//! `printHelp()`) live in `src/cli/cli.zig` as free fns; only the pure enum,
//! `char()`, classifier predicates, and the `EnumArray` flag tables are here.

use enum_map::{enum_map, Enum, EnumMap};
use std::sync::LazyLock;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Enum)]
pub enum Tag {
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
    /// arg0 == 'node'
    RunAsNodeCommand,
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
}

impl Tag {
    /// Used by crash reports.
    ///
    /// This must be kept in sync with https://github.com/oven-sh/bun.report/blob/62601d8aafb9c0d29554dfc3f8854044ec04d367/backend/remap.ts#L10
    pub fn char(self) -> u8 {
        match self {
            Tag::AddCommand => b'I',
            Tag::AutoCommand => b'a',
            Tag::BuildCommand => b'b',
            Tag::BunxCommand => b'B',
            Tag::CreateCommand => b'c',
            Tag::DiscordCommand => b'D',
            Tag::GetCompletionsCommand => b'g',
            Tag::HelpCommand => b'h',
            Tag::InitCommand => b'j',
            Tag::InfoCommand => b'v',
            Tag::InstallCommand => b'i',
            Tag::InstallCompletionsCommand => b'C',
            Tag::LinkCommand => b'l',
            Tag::PackageManagerCommand => b'P',
            Tag::RemoveCommand => b'R',
            Tag::RunCommand => b'r',
            Tag::RunAsNodeCommand => b'n',
            Tag::TestCommand => b't',
            Tag::UnlinkCommand => b'U',
            Tag::UpdateCommand => b'u',
            Tag::UpgradeCommand => b'p',
            Tag::ReplCommand => b'G',
            Tag::ReservedCommand => b'w',
            Tag::ExecCommand => b'e',
            Tag::PatchCommand => b'x',
            Tag::PatchCommitCommand => b'z',
            Tag::OutdatedCommand => b'o',
            Tag::UpdateInteractiveCommand => b'U',
            Tag::PublishCommand => b'k',
            Tag::AuditCommand => b'A',
            Tag::WhyCommand => b'W',
            Tag::FuzzilliCommand => b'F',
        }
    }

    pub fn read_global_config(self) -> bool {
        match self {
            Tag::BunxCommand
            | Tag::PackageManagerCommand
            | Tag::InstallCommand
            | Tag::AddCommand
            | Tag::RemoveCommand
            | Tag::UpdateCommand
            | Tag::PatchCommand
            | Tag::PatchCommitCommand
            | Tag::OutdatedCommand
            | Tag::PublishCommand
            | Tag::AuditCommand => true,
            _ => false,
        }
    }

    pub fn is_npm_related(self) -> bool {
        match self {
            Tag::BunxCommand
            | Tag::LinkCommand
            | Tag::UnlinkCommand
            | Tag::PackageManagerCommand
            | Tag::InstallCommand
            | Tag::AddCommand
            | Tag::RemoveCommand
            | Tag::UpdateCommand
            | Tag::PatchCommand
            | Tag::PatchCommitCommand
            | Tag::OutdatedCommand
            | Tag::PublishCommand
            | Tag::AuditCommand => true,
            _ => false,
        }
    }

    // Heavy methods that pull in `Arguments` / help text live in `cli/cli.zig`.
    // In Zig these were aliased here (`params`, `printHelp`) relying on lazy
    // decl resolution so `options_types/` did not compile-depend on `cli/`
    // unless invoked. Rust has no lazy decl resolution; re-exporting
    // `bun_runtime::cli::Command::{tag_params, tag_print_help}` here would create a
    // crate cycle (cli → options_types → cli).
    // TODO(port): call sites of `cmd.params()` / `cmd.printHelp()` must call
    // `bun_runtime::cli::Command::tag_params(cmd)` / `tag_print_help(cmd)` directly.
}

// PERF(port): Zig `pub const ... std.EnumArray(...).initDefault(...)` was a
// compile-time table; `enum_map!` is not const-evaluable so we use LazyLock.
// Phase B may flatten these into `const fn` matches if the lazy init matters.

pub static LOADS_CONFIG: LazyLock<EnumMap<Tag, bool>> = LazyLock::new(|| {
    enum_map! {
        Tag::BuildCommand => true,
        Tag::TestCommand => true,
        Tag::InstallCommand => true,
        Tag::AddCommand => true,
        Tag::RemoveCommand => true,
        Tag::UpdateCommand => true,
        Tag::PatchCommand => true,
        Tag::PatchCommitCommand => true,
        Tag::PackageManagerCommand => true,
        Tag::BunxCommand => true,
        Tag::AutoCommand => true,
        Tag::RunCommand => true,
        Tag::RunAsNodeCommand => true,
        Tag::OutdatedCommand => true,
        Tag::UpdateInteractiveCommand => true,
        Tag::PublishCommand => true,
        Tag::AuditCommand => true,
        _ => false,
    }
});

pub static ALWAYS_LOADS_CONFIG: LazyLock<EnumMap<Tag, bool>> = LazyLock::new(|| {
    enum_map! {
        Tag::BuildCommand => true,
        Tag::TestCommand => true,
        Tag::InstallCommand => true,
        Tag::AddCommand => true,
        Tag::RemoveCommand => true,
        Tag::UpdateCommand => true,
        Tag::PatchCommand => true,
        Tag::PatchCommitCommand => true,
        Tag::PackageManagerCommand => true,
        Tag::BunxCommand => true,
        Tag::OutdatedCommand => true,
        Tag::UpdateInteractiveCommand => true,
        Tag::PublishCommand => true,
        Tag::AuditCommand => true,
        _ => false,
    }
});

pub static USES_GLOBAL_OPTIONS: LazyLock<EnumMap<Tag, bool>> = LazyLock::new(|| {
    enum_map! {
        Tag::AddCommand => false,
        Tag::AuditCommand => false,
        Tag::BunxCommand => false,
        Tag::CreateCommand => false,
        Tag::InfoCommand => false,
        Tag::InstallCommand => false,
        Tag::LinkCommand => false,
        Tag::OutdatedCommand => false,
        Tag::UpdateInteractiveCommand => false,
        Tag::PackageManagerCommand => false,
        Tag::PatchCommand => false,
        Tag::PatchCommitCommand => false,
        Tag::PublishCommand => false,
        Tag::RemoveCommand => false,
        Tag::UnlinkCommand => false,
        Tag::UpdateCommand => false,
        _ => true,
    }
});

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/CommandTag.zig (185 lines)
//   confidence: high
//   todos:      1
//   notes:      params/printHelp aliases dropped (would cycle cli↔options_types); EnumArray tables use LazyLock<EnumMap> since enum_map! is not const
// ──────────────────────────────────────────────────────────────────────────
