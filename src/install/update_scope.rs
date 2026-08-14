use std::sync::OnceLock;

use bstr::BStr;
use bun_collections::HashMap;
use bun_core::{Global, Output, prettyln, strings};
use bun_semver::string::Builder as StringBuilder;

use crate::dependency::Behavior;
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::package_manager::Options::LogLevel;
use crate::package_manager::{UpdateTargetWorkspace, WorkspaceFilter};
use crate::package_manager_real::command_line_arguments::UpdateGroups;
use crate::resolution::Tag as ResolutionTag;
use crate::{DependencyID, PackageManager, PackageNameHash, invalid_package_id};

/// Which workspaces a named `bun update` may re-resolve and rewrite; rows owned by non-workspace packages are always in scope.
pub struct UpdateScope<'a> {
    pub targets: Option<&'a [UpdateTargetWorkspace]>,
    pub invoking: Option<PackageNameHash>,
}

impl<'a> UpdateScope<'a> {
    pub fn of(manager: &'a PackageManager) -> UpdateScope<'a> {
        UpdateScope {
            targets: manager.update_target_workspaces.as_deref(),
            invoking: manager.workspace_name_hash,
        }
    }
}

impl UpdateScope<'_> {
    pub fn contains_workspace(
        &self,
        is_root: bool,
        name_hash: PackageNameHash,
        name: &[u8],
    ) -> bool {
        match self.targets {
            Some(targets) => targets.iter().any(|t| t.matches(is_root, name_hash, name)),
            None => match self.invoking {
                None => is_root,
                Some(hash) => !is_root && hash == name_hash,
            },
        }
    }

    pub fn contains_dependency(&self, lockfile: &Lockfile, dep_id: DependencyID) -> bool {
        let owner = lockfile.get_workspace_pkg_if_workspace_dep(dep_id);
        if owner == invalid_package_id {
            return true;
        }
        let owner = owner as usize;
        let is_root = lockfile.packages.items_resolution()[owner].tag == ResolutionTag::Root;
        let name =
            lockfile.packages.items_name()[owner].slice(lockfile.buffers.string_bytes.as_slice());
        self.contains_workspace(is_root, lockfile.packages.items_name_hash()[owner], name)
    }

    /// One flag per dependency row; rows covered by no package's slice (orphans left by the differ) stay false.
    pub fn walkable_rows(&self, lockfile: &Lockfile) -> Vec<bool> {
        let mut walk = vec![false; lockfile.buffers.dependencies.len()];
        let pkg_res = lockfile.packages.items_resolution();
        let name_hashes = lockfile.packages.items_name_hash();
        let names = lockfile.packages.items_name();
        let buf = lockfile.buffers.string_bytes.as_slice();
        for (id, slice) in lockfile.packages.items_dependencies().iter().enumerate() {
            if slice.len == 0 {
                continue;
            }
            let res = &pkg_res[id];
            let in_scope = match res.tag {
                ResolutionTag::Root | ResolutionTag::Workspace => self.contains_workspace(
                    res.tag == ResolutionTag::Root,
                    name_hashes[id],
                    names[id].slice(buf),
                ),
                _ => true,
            };
            walk[slice.begin() as usize..slice.end() as usize].fill(in_scope);
        }
        walk
    }
}

fn selects(groups: UpdateGroups, behavior: Behavior) -> bool {
    if groups.no_optional && behavior.is_optional() {
        return false;
    }
    if !groups.dev && !groups.prod {
        return true;
    }
    (groups.dev && behavior.is_dev())
        || (groups.prod && (behavior.is_prod() || behavior.is_optional()))
}

fn is_pattern(arg: &[u8]) -> bool {
    arg.starts_with(b"!") || strings::contains_char(arg, b'*')
}

struct Pattern {
    raw: &'static [u8],
    negated: bool,
    glob: &'static [u8],
    hit: bool,
}

impl Pattern {
    fn parse(raw: &'static [u8]) -> Pattern {
        let mut negated = false;
        let mut glob = raw;
        while let Some(rest) = glob.strip_prefix(b"!") {
            negated = !negated;
            glob = rest;
        }
        Pattern {
            raw,
            negated,
            glob,
            hit: false,
        }
    }
}

fn strip_negations(arg: &[u8]) -> &[u8] {
    let mut rest = arg;
    while let Some(r) = rest.strip_prefix(b"!") {
        rest = r;
    }
    rest
}

fn has_version_suffix(arg: &[u8]) -> bool {
    let rest = strip_negations(arg);
    rest.len() > 1 && strings::contains_char(&rest[1..], b'@')
}

fn name_of_plain_arg(arg: &[u8]) -> &[u8] {
    match strings::index_of_char_usize(&arg[1.min(arg.len())..], b'@') {
        Some(i) => &arg[..i + 1],
        None => arg,
    }
}

fn matches(glob: &[u8], name: &[u8]) -> bool {
    if glob == b"*" {
        true
    } else if strings::contains_char(glob, b'*') {
        bun_glob::r#match(glob, name).matches()
    } else {
        glob == name
    }
}

fn exit_on_lockfile_load_failure(manager: &mut PackageManager) {
    fn missing(silent: bool) -> ! {
        if !silent {
            Output::err_generic("missing lockfile, nothing to update", ());
        }
        Global::exit(1);
    }
    let silent = manager.options.log_level == LogLevel::Silent;
    if !manager.options.do_.load_lockfile() {
        missing(silent);
    }
    match manager.load_lockfile_from_cwd::<true>() {
        crate::lockfile::LoadResult::Ok(_) => {}
        crate::lockfile::LoadResult::NotFound => missing(silent),
        crate::lockfile::LoadResult::Err(cause) => {
            if !silent {
                let what: &str = match cause.step {
                    crate::lockfile::LoadStep::OpenFile => "open",
                    crate::lockfile::LoadStep::ReadFile => "read",
                    crate::lockfile::LoadStep::ParseFile => "parse",
                    crate::lockfile::LoadStep::Migrating => "migrate",
                };
                Output::err_generic("failed to {s} lockfile: {s}", (what, cause.value.name()));
                if manager.log_mut().has_errors() {
                    let _ = manager
                        .log_mut()
                        .print(std::ptr::from_mut(Output::error_writer()));
                }
            }
            Global::exit(1);
        }
    }
}

/// Turns `bun update` patterns and `--dev`/`--prod`/`--no-optional` into the concrete names the named path expects; a plain `bun update [name]` returns before doing anything.
pub fn expand_positionals(manager: &mut PackageManager, original_cwd: &[u8], groups: UpdateGroups) {
    let positionals = manager.options.positionals;
    let args = positionals.get(1..).unwrap_or(&[]);
    let selecting = !groups.is_default();
    if !selecting && !args.iter().any(|a| is_pattern(a)) {
        return;
    }

    let mut patterns: Vec<Pattern> = Vec::new();
    let mut passthrough: Vec<&'static [u8]> = Vec::new();
    for &arg in args {
        if selecting {
            if has_version_suffix(arg) {
                Output::err_generic(
                    "a version cannot be combined with --dev, --prod or --no-optional: {}",
                    (BStr::new(arg),),
                );
                Global::exit(1);
            }
            patterns.push(Pattern::parse(arg));
        } else if is_pattern(arg) {
            if has_version_suffix(arg) {
                Output::err_generic(
                    "a version cannot be combined with a pattern: {}",
                    (BStr::new(arg),),
                );
                Global::exit(1);
            }
            patterns.push(Pattern::parse(arg));
        } else {
            passthrough.push(arg);
        }
    }

    exit_on_lockfile_load_failure(manager);

    let selection: Option<Vec<UpdateTargetWorkspace>> = (manager.options.do_.recursive()
        || !manager.options.filter_patterns.is_empty())
    .then(|| {
        let lockfile = &*manager.lockfile;
        let name_hashes = lockfile.packages.items_name_hash();
        let names = lockfile.packages.items_name();
        let resolutions = lockfile.packages.items_resolution();
        let buf = lockfile.buffers.string_bytes.as_slice();
        WorkspaceFilter::select_workspaces(lockfile, manager.options.filter_patterns, original_cwd)
            .into_iter()
            .map(|id| UpdateTargetWorkspace {
                is_root: resolutions[id as usize].tag == ResolutionTag::Root,
                name_hash: name_hashes[id as usize],
                name: Box::from(names[id as usize].slice(buf)),
            })
            .collect()
    });
    let scope = UpdateScope {
        targets: selection.as_deref(),
        invoking: manager.workspace_name_hash,
    };

    let mut names: Vec<Box<[u8]>> = Vec::new();
    {
        let lockfile = &*manager.lockfile;
        let walk = scope.walkable_rows(lockfile);
        let pkg_res = lockfile.packages.items_resolution();
        let pkg_names = lockfile.packages.items_name();
        let pkg_name_hashes = lockfile.packages.items_name_hash();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let buf = lockfile.buffers.string_bytes.as_slice();
        let include_transitive = !selecting;

        let mut decided: HashMap<PackageNameHash, ()> = HashMap::new();
        for &arg in &passthrough {
            decided.insert(StringBuilder::string_hash(name_of_plain_arg(arg)), ());
        }

        for (owner, slice) in lockfile.packages.items_dependencies().iter().enumerate() {
            if slice.len == 0 {
                continue;
            }
            let owner_is_ws = matches!(
                pkg_res[owner].tag,
                ResolutionTag::Root | ResolutionTag::Workspace
            );
            if !owner_is_ws && !include_transitive {
                continue;
            }
            for i in slice.begin() as usize..slice.end() as usize {
                if !walk[i] {
                    continue;
                }
                let target = resolutions[i];
                if target == invalid_package_id
                    || matches!(
                        pkg_res[target as usize].tag,
                        ResolutionTag::Root | ResolutionTag::Workspace
                    )
                {
                    continue;
                }
                let dep = &deps[i];
                if owner_is_ws && !selects(groups, dep.behavior) {
                    continue;
                }
                let real_hash = pkg_name_hashes[target as usize];
                if decided.insert(real_hash, ()).is_some() {
                    continue;
                }
                let real = pkg_names[target as usize].slice(buf);
                let alias = dep.name.slice(buf);
                let mut positive_hit = patterns.iter().all(|p| p.negated);
                let mut excluded = false;
                for pattern in patterns.iter_mut() {
                    if !matches(pattern.glob, real)
                        && !(alias != real && matches(pattern.glob, alias))
                    {
                        continue;
                    }
                    if pattern.negated {
                        excluded = true;
                    } else {
                        pattern.hit = true;
                        positive_hit = true;
                    }
                }
                if positive_hit && !excluded {
                    // The named path matches `npm:` aliases through the real name, so the real name reaches both spellings.
                    names.push(Box::from(real));
                }
            }
        }
    }

    let mut failed = false;
    for pattern in patterns.iter().filter(|p| !p.negated && !p.hit) {
        failed = true;
        if selecting {
            Output::err_generic(
                "no dependencies in the selected groups match \"{}\"",
                (BStr::new(pattern.raw),),
            );
        } else {
            Output::err_generic(
                "no packages in bun.lock match \"{}\"",
                (BStr::new(pattern.raw),),
            );
        }
    }
    if failed {
        Global::exit(1);
    }
    if names.is_empty() && passthrough.is_empty() {
        if manager.options.log_level != LogLevel::Silent {
            prettyln!("No packages to update");
            Output::flush();
        }
        Global::exit(0);
    }

    names.sort_unstable();
    static EXPANDED_NAMES: OnceLock<Vec<Box<[u8]>>> = OnceLock::new();
    static EXPANDED_POSITIONALS: OnceLock<Vec<&'static [u8]>> = OnceLock::new();
    let expanded = EXPANDED_NAMES.get_or_init(|| names);
    let expanded_positionals = EXPANDED_POSITIONALS.get_or_init(|| {
        let mut out: Vec<&'static [u8]> =
            Vec::with_capacity(1 + passthrough.len() + expanded.len());
        out.push(positionals[0]);
        out.extend(passthrough.iter().copied());
        out.extend(expanded.iter().map(|name| &**name));
        out
    });
    manager.options.positionals = expanded_positionals.as_slice();
}
