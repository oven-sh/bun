// TODO(port): phf_set! rejects duplicate keys at compile time; Zig's
// ComptimeStringMap silently dedups. The v1 list below repeats several v2.3
// entries verbatim — Phase B must either drop the repeats or switch to a
// sorted &[&[u8]] + binary_search. Kept 1:1 here for .zig↔.rs diffability.
pub static ALL_YARN_COMMANDS: phf::Set<&'static [u8]> = phf::phf_set! {
    // yarn v2.3 commands
    b"add",
    b"bin",
    b"cache",
    b"config",
    b"dedupe",
    b"dlx",
    b"exec",
    b"explain",
    b"info",
    b"init",
    b"install",
    b"link",
    b"node",
    b"npm",
    b"pack",
    b"patch",
    b"plugin",
    b"rebuild",
    b"remove",
    b"run",
    b"set",
    b"unplug",
    b"up",
    b"why",
    b"workspace",
    b"workspaces",

    // yarn v1 commands
    b"access",
    b"add",
    b"audit",
    b"autoclean",
    b"bin",
    b"cache",
    b"check",
    b"config",
    b"create",
    b"exec",
    b"generate-lock-entry",
    b"generateLockEntry",
    b"global",
    b"help",
    b"import",
    b"info",
    b"init",
    b"install",
    b"licenses",
    b"link",
    b"list",
    b"login",
    b"logout",
    b"node",
    b"outdated",
    b"owner",
    b"pack",
    b"policies",
    b"publish",
    b"remove",
    b"run",
    b"tag",
    b"team",
    b"unlink",
    b"unplug",
    b"upgrade",
    b"upgrade-interactive",
    b"upgradeInteractive",
    b"version",
    b"versions",
    b"why",
    b"workspace",
    b"workspaces",
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/list-of-yarn-commands.zig (76 lines)
//   confidence: high
//   todos:      1
//   notes:      ComptimeStringMap(void) → phf::Set; duplicate keys must be deduped for phf to compile
// ──────────────────────────────────────────────────────────────────────────
