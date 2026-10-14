//! `packageExtensions`: extra `dependencies` / `optionalDependencies` /
//! `peerDependencies` (+ `peerDependenciesMeta`) grafted onto third-party
//! packages whose own manifest forgot to declare them. Same shape as pnpm's
//! `package.json#pnpm.packageExtensions` and yarn's
//! `.yarnrc.yml#packageExtensions`:
//!
//! ```json
//! { "react-redux@1": { "peerDependencies": { "react": "*" } } }
//! ```
//!
//! Only the parsed representation lives here so that both `bun_bunfig`
//! (`[install.packageExtensions]`) and `bun_install` (root `package.json`)
//! can build it; applying it to the lockfile is `bun_install`'s job.

use bun_alloc::Arena;
use bun_ast as ast;
use bun_core::strings;

use crate::NodeLinker::FromExprError;
use crate::resolver_hooks::Behavior;

/// One dependency edge an extension adds.
#[derive(Clone)]
pub struct PackageExtensionDependency {
    pub name: Box<[u8]>,
    /// Version specifier text, exactly as written (`"^1"`, `"*"`, `"npm:foo@1"`, ...).
    pub version: Box<[u8]>,
    /// `PROD`, `OPTIONAL`, `PEER` or `PEER | OPTIONAL`.
    pub behavior: Behavior,
}

/// One `"<name>[@<range>]": { ... }` entry.
#[derive(Clone)]
pub struct PackageExtension {
    /// Package name the extension applies to.
    pub name: Box<[u8]>,
    /// Semver range text scoping which resolved versions of `name` it applies
    /// to; empty means any version.
    pub range: Box<[u8]>,
    pub dependencies: Vec<PackageExtensionDependency>,
}

/// How parse problems are reported: bunfig is strict (an error fails config
/// loading), package.json is lenient (a warning, the entry is skipped).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Strictness {
    Error,
    Warn,
}

/// `"name@range"` -> (`name`, `range`); a leading `@` is part of a scoped
/// name, not a separator. No range -> (`key`, `""`).
pub fn split_name_and_range(key: &[u8]) -> (&[u8], &[u8]) {
    let from = usize::from(strings::starts_with(key, b"@"));
    match strings::index_of_char_pos(key, b'@', from) {
        Some(at) => (&key[..at], &key[at + 1..]),
        None => (key, b""),
    }
}

const GROUPS: [(&[u8], Behavior); 3] = [
    (b"dependencies", Behavior::PROD),
    (b"optionalDependencies", Behavior::OPTIONAL),
    (b"peerDependencies", Behavior::PEER),
];

/// Parse a `packageExtensions` object expression (TOML table or JSON object)
/// and append every well-formed entry to `out`.
///
/// With [`Strictness::Error`] the first malformed value logs an error and
/// returns `Err(UnexpectedExpr)`; with [`Strictness::Warn`] it logs a warning
/// and that value is skipped.
pub fn parse_from_expr(
    out: &mut Vec<PackageExtension>,
    expr: &ast::Expr,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    strictness: Strictness,
) -> Result<(), FromExprError> {
    // Scratch arena for `as_string_cloned` (TOML strings may be UTF-16 in the
    // AST); every slice is copied into a `Box` before this returns.
    let arena = Arena::new();

    let report = |log: &mut bun_ast::Log, loc: ast::Loc, text: &'static [u8]| match strictness {
        Strictness::Error => {
            log.add_error_opts(
                text,
                bun_ast::AddErrorOptions {
                    loc,
                    redact_sensitive_information: true,
                    source: Some(source),
                    ..Default::default()
                },
            );
            Err(FromExprError::UnexpectedExpr)
        }
        Strictness::Warn => {
            log.add_warning(Some(source), loc, text);
            Ok(())
        }
    };

    if !expr.is_object() {
        return report(
            log,
            expr.loc,
            b"Expected \"packageExtensions\" to be an object",
        );
    }

    out.reserve(expr.property_count());
    expr.try_for_each_property(|key, key_loc, value| -> Result<(), FromExprError> {
        let (name, range) = split_name_and_range(key);
        if name.is_empty() {
            return report(log, key_loc, b"Expected a package name");
        }
        // `name@<range>`: reject a range that is missing (`name@`) or parses
        // to nothing here, once, rather than letting the extension silently
        // match everything / nothing.
        if range.is_empty() && key.last() == Some(&b'@') {
            return report(
                log,
                key_loc,
                b"Expected a semver range after \"@\" in the package name",
            );
        }
        if !range.is_empty() && range != b"*" {
            let query = bun_semver::query::parse(range, bun_semver::SlicedString::init(range, range))?;
            if query.is_empty() {
                return report(log, key_loc, b"Expected a semver range after \"@\" in the package name");
            }
        }
        if !value.is_object() {
            return report(
                log,
                value.loc,
                b"Expected an object with \"dependencies\", \"optionalDependencies\", \"peerDependencies\" and/or \"peerDependenciesMeta\"",
            );
        }

        let mut extension = PackageExtension {
            name: Box::from(name),
            range: Box::from(range),
            dependencies: Vec::new(),
        };

        // `peerDependenciesMeta: { "<name>": { optional: true } }`
        let mut optional_peers: Vec<Box<[u8]>> = Vec::new();
        if let Some(meta) = value.get(b"peerDependenciesMeta") {
            if !meta.is_object() {
                report(log, meta.loc, b"Expected \"peerDependenciesMeta\" to be an object")?;
            }
            meta.for_each_property(|peer, _, peer_meta| {
                if peer_meta.get(b"optional").and_then(|e| e.as_bool()) == Some(true) {
                    optional_peers.push(Box::from(peer));
                }
            });
        }

        for (field, behavior) in GROUPS {
            let Some(group) = value.get(field) else {
                continue;
            };
            if !group.is_object() {
                report(log, group.loc, b"Expected an object of \"name\": \"version range\"")?;
                continue;
            }
            group.try_for_each_property(
                |dep_name, dep_loc, dep_version| -> Result<(), FromExprError> {
                    if dep_name.is_empty() {
                        return report(log, dep_loc, b"Expected a dependency name");
                    }
                    let Some(version) = dep_version.as_string_cloned(&arena)? else {
                        return report(log, dep_version.loc, b"Expected a version range string");
                    };
                    let mut behavior = behavior;
                    if behavior.is_peer() && optional_peers.iter().any(|p| **p == *dep_name) {
                        behavior.insert(Behavior::OPTIONAL);
                    }
                    let dependency = PackageExtensionDependency {
                        name: Box::from(dep_name),
                        version: Box::from(version),
                        behavior,
                    };
                    // Same name in two groups: like a manifest,
                    // `optionalDependencies` overrides `dependencies` and a
                    // duplicate `peerDependencies` entry (optional or not) is
                    // ignored. (`is_optional()` is already false for optional
                    // peers; the peer check just makes that explicit.)
                    match extension.dependencies.iter_mut().find(|d| *d.name == *dep_name) {
                        Some(existing) if behavior.is_optional() && !behavior.is_peer() => {
                            *existing = dependency
                        }
                        Some(_) => {}
                        None => extension.dependencies.push(dependency),
                    }
                    Ok(())
                },
            )?;
        }

        // A `peerDependenciesMeta` entry with no matching `peerDependencies`
        // entry declares an optional peer on any version (yarn/npm behaviour).
        for peer in optional_peers {
            if extension.dependencies.iter().any(|d| d.name == peer) {
                continue;
            }
            extension.dependencies.push(PackageExtensionDependency {
                name: peer,
                version: Box::from(&b"*"[..]),
                behavior: Behavior::PEER | Behavior::OPTIONAL,
            });
        }

        if !extension.dependencies.is_empty() {
            out.push(extension);
        }
        Ok(())
    })
}
