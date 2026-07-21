//! `bun.cli.Command.Tag` — the top-level CLI subcommand discriminant.
//! Extracted to `options_types/` so lower tiers (install/, bundler/) can
//! switch on which command is running without importing `cli/`.
//!
//! Heavy methods that reference `Arguments`/`HelpCommand`/`clap` (`params()`,
//! `printHelp()`) live in the CLI crate as free fns; only the pure enum,
//! `char()`, classifier predicates, and the `EnumArray` flag tables are here.

use enum_map::Enum;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Enum, core::marker::ConstParamTy)]
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
        // Every command that loads a local `bunfig.toml` also loads the global
        // one first so the documented shallow merge (local overrides global)
        // applies uniformly to runtime and install settings alike.
        LOADS_CONFIG[self]
    }

    pub fn is_npm_related(self) -> bool {
        matches!(
            self,
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
                | Tag::AuditCommand
        )
    }

    /// Number of variants. Mirrors `enum_map::Enum::LENGTH` so const-array
    /// tables below can size themselves without naming the trait at every use.
    pub const COUNT: usize = <Self as Enum>::LENGTH;

    // Heavy methods that pull in `Arguments` / help text live in the CLI crate.
    // Re-exporting
    // `bun_runtime::cli::Command::{tag_params, tag_print_help}` here would create a
    // crate cycle (cli → options_types → cli).
}

/// `.rodata` flag table indexed by [`Tag`] discriminant. These tables cost zero
/// init code on the startup path.
#[repr(transparent)]
pub struct TagTable<V: 'static>(pub [V; Tag::COUNT]);

impl<V> core::ops::Index<Tag> for TagTable<V> {
    type Output = V;
    #[inline]
    fn index(&self, tag: Tag) -> &V {
        &self.0[tag as usize]
    }
}

pub static LOADS_CONFIG: TagTable<bool> = TagTable({
    let mut a = [false; Tag::COUNT];
    a[Tag::BuildCommand as usize] = true;
    a[Tag::TestCommand as usize] = true;
    a[Tag::InstallCommand as usize] = true;
    a[Tag::AddCommand as usize] = true;
    a[Tag::RemoveCommand as usize] = true;
    a[Tag::UpdateCommand as usize] = true;
    a[Tag::PatchCommand as usize] = true;
    a[Tag::PatchCommitCommand as usize] = true;
    a[Tag::PackageManagerCommand as usize] = true;
    a[Tag::BunxCommand as usize] = true;
    a[Tag::AutoCommand as usize] = true;
    a[Tag::RunCommand as usize] = true;
    a[Tag::RunAsNodeCommand as usize] = true;
    a[Tag::OutdatedCommand as usize] = true;
    a[Tag::UpdateInteractiveCommand as usize] = true;
    a[Tag::PublishCommand as usize] = true;
    a[Tag::AuditCommand as usize] = true;
    a
});

pub static ALWAYS_LOADS_CONFIG: TagTable<bool> = TagTable({
    let mut a = [false; Tag::COUNT];
    a[Tag::BuildCommand as usize] = true;
    a[Tag::TestCommand as usize] = true;
    a[Tag::InstallCommand as usize] = true;
    a[Tag::AddCommand as usize] = true;
    a[Tag::RemoveCommand as usize] = true;
    a[Tag::UpdateCommand as usize] = true;
    a[Tag::PatchCommand as usize] = true;
    a[Tag::PatchCommitCommand as usize] = true;
    a[Tag::PackageManagerCommand as usize] = true;
    a[Tag::BunxCommand as usize] = true;
    a[Tag::OutdatedCommand as usize] = true;
    a[Tag::UpdateInteractiveCommand as usize] = true;
    a[Tag::PublishCommand as usize] = true;
    a[Tag::AuditCommand as usize] = true;
    a
});

pub static USES_GLOBAL_OPTIONS: TagTable<bool> = TagTable({
    let mut a = [true; Tag::COUNT];
    a[Tag::AddCommand as usize] = false;
    a[Tag::AuditCommand as usize] = false;
    a[Tag::BunxCommand as usize] = false;
    a[Tag::CreateCommand as usize] = false;
    a[Tag::InfoCommand as usize] = false;
    a[Tag::InstallCommand as usize] = false;
    a[Tag::LinkCommand as usize] = false;
    a[Tag::OutdatedCommand as usize] = false;
    a[Tag::UpdateInteractiveCommand as usize] = false;
    a[Tag::PackageManagerCommand as usize] = false;
    a[Tag::PatchCommand as usize] = false;
    a[Tag::PatchCommitCommand as usize] = false;
    a[Tag::PublishCommand as usize] = false;
    a[Tag::RemoveCommand as usize] = false;
    a[Tag::UnlinkCommand as usize] = false;
    a[Tag::UpdateCommand as usize] = false;
    a
});
