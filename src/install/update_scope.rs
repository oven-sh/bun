use std::cell::OnceCell;
use std::sync::OnceLock;

use bstr::BStr;
use bun_collections::bit_set::Range;
use bun_collections::{DynamicBitSet, HashMap, index_sort};
use bun_core::time::nano_timestamp;
use bun_core::{Global, Output, UnwrapOrOom as _, pretty, strings};
use bun_semver::string::Builder as StringBuilder;

use crate::dependency::Behavior;
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{Lockfile, reachable};
use crate::package_manager::Options::LogLevel;
use crate::package_manager::UpdateTargetWorkspace;
use crate::package_manager::workspace_selection::{self, RootSelection};
use crate::package_manager_real::command_line_arguments::UpdateGroups;
use crate::package_manager_real::install_with_manager::loaded_lockfile_name;
use crate::resolution::Tag as ResolutionTag;
use crate::{DependencyID, PackageID, PackageManager, PackageNameHash, invalid_package_id};

/// Which workspaces a `bun update` may re-resolve and rewrite; a non-workspace package's rows are in scope when one of those workspaces reaches it.
pub struct UpdateScope<'a> {
    pub targets: Option<&'a [UpdateTargetWorkspace]>,
    pub invoking: Option<PackageNameHash>,
    whole_workspace: bool,
    /// Walked by `plan_named` before the differ invalidates rows; otherwise `reachable()` walks the lockfile it is given.
    planned: Option<&'a DynamicBitSet>,
    lazy: OnceCell<DynamicBitSet>,
}

impl<'a> UpdateScope<'a> {
    pub fn of(manager: &'a PackageManager) -> UpdateScope<'a> {
        UpdateScope::new(
            manager.update_target_workspaces.as_deref(),
            manager.workspace_name_hash,
            manager.options.filter_patterns.is_empty(),
            manager.named_update_reachable.as_ref(),
        )
    }

    fn new(
        targets: Option<&'a [UpdateTargetWorkspace]>,
        invoking: Option<PackageNameHash>,
        no_filter: bool,
        planned: Option<&'a DynamicBitSet>,
    ) -> UpdateScope<'a> {
        UpdateScope {
            targets,
            invoking,
            whole_workspace: match targets {
                Some(_) => no_filter,
                None => invoking.is_none(),
            },
            planned,
            lazy: OnceCell::new(),
        }
    }
}

/// Runs on the loaded lockfile before the differ invalidates the rows it re-enqueues, like `TransitiveUpdate::plan`.
pub fn plan_named(manager: &mut PackageManager) {
    let reachable = {
        let scope = UpdateScope::of(manager);
        if scope.is_whole_workspace() {
            return;
        }
        scope.walk(&manager.lockfile)
    };
    manager.named_update_reachable = Some(reachable);
}

impl UpdateScope<'_> {
    /// Root cwd without `--filter`, or `-r`: every package in bun.lock is in scope.
    pub(crate) fn is_whole_workspace(&self) -> bool {
        self.whole_workspace
    }

    /// Packages reachable from the in-scope workspaces; every package when `is_whole_workspace()`.
    pub(crate) fn reachable<'s>(&'s self, lockfile: &Lockfile) -> &'s DynamicBitSet {
        if let Some(planned) = self.planned {
            return planned;
        }
        self.lazy.get_or_init(|| self.walk(lockfile))
    }

    fn walk(&self, lockfile: &Lockfile) -> DynamicBitSet {
        let pkg_res = lockfile.packages.items_resolution();
        if self.whole_workspace {
            let mut all = DynamicBitSet::init_empty(pkg_res.len()).unwrap_or_oom();
            all.unmanaged.set_all(true);
            return all;
        }
        let name_hashes = lockfile.packages.items_name_hash();
        let names = lockfile.packages.items_name();
        let buf = lockfile.buffers.string_bytes.as_slice();
        let roots: Vec<PackageID> = (0..pkg_res.len())
            .filter(|&id| {
                let tag = pkg_res[id].tag;
                matches!(tag, ResolutionTag::Root | ResolutionTag::Workspace)
                    && self.contains_workspace(
                        tag == ResolutionTag::Root,
                        name_hashes[id],
                        names[id].slice(buf),
                    )
            })
            .map(|id| id as PackageID)
            .collect();
        // The root's `workspaces` listing is not a dependency edge; a `workspace:` dependency between members is.
        reachable::packages_from(
            lockfile,
            lockfile.buffers.resolutions.as_slice(),
            &roots,
            false,
            reachable::Options::all(0),
        )
    }

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

    fn contains_package(&self, lockfile: &Lockfile, id: usize) -> bool {
        let tag = lockfile.packages.items_resolution()[id].tag;
        match tag {
            ResolutionTag::Root | ResolutionTag::Workspace => self.contains_workspace(
                tag == ResolutionTag::Root,
                lockfile.packages.items_name_hash()[id],
                lockfile.packages.items_name()[id].slice(lockfile.buffers.string_bytes.as_slice()),
            ),
            // Packages appended after the walk (ids past its end) were resolved for an in-scope row.
            _ => {
                self.whole_workspace || self.reachable(lockfile).is_set_allow_out_of_bound(id, true)
            }
        }
    }

    /// Rows owned by no package (orphans left by the differ) are in scope.
    pub fn contains_dependency(&self, lockfile: &Lockfile, dep_id: DependencyID) -> bool {
        match lockfile
            .packages
            .items_dependencies()
            .iter()
            .position(|slice| slice.contains(dep_id))
        {
            Some(owner) => self.contains_package(lockfile, owner),
            None => true,
        }
    }

    /// One bit per dependency row; rows covered by no package's slice (orphans left by the differ) stay unset.
    pub fn walkable_rows(&self, lockfile: &Lockfile) -> DynamicBitSet {
        let mut walk =
            DynamicBitSet::init_empty(lockfile.buffers.dependencies.len()).unwrap_or_oom();
        for (id, slice) in lockfile.packages.items_dependencies().iter().enumerate() {
            if slice.len == 0 {
                continue;
            }
            if self.contains_package(lockfile, id) {
                walk.set_range_value(
                    Range {
                        start: slice.begin() as usize,
                        end: slice.end() as usize,
                    },
                    true,
                );
            }
        }
        walk
    }
}

/// Which package.json entries --dev / --prod / --no-optional cover; peer entries are covered only when no selector is given.
pub fn selects(groups: UpdateGroups, behavior: Behavior) -> bool {
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

fn describe_groups(groups: UpdateGroups) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    for (on, flag) in [
        (groups.dev, &b"--dev"[..]),
        (groups.prod, b"--prod"),
        (groups.no_optional, b"--no-optional"),
    ] {
        if on {
            if !out.is_empty() {
                out.push(b' ');
            }
            out.extend_from_slice(flag);
        }
    }
    out
}

fn describe_patterns(patterns: &[Pattern]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    for pattern in patterns {
        if !out.is_empty() {
            out.push(b' ');
        }
        out.push(b'"');
        out.extend_from_slice(pattern.raw);
        out.push(b'"');
    }
    out
}

fn exit_on_lockfile_load_failure(manager: &mut PackageManager, subject: &[u8]) -> &'static str {
    fn missing(silent: bool, subject: &[u8]) -> ! {
        if !silent {
            Output::flush();
            Output::err_generic("no bun.lock to match {} against", (BStr::new(subject),));
            bun_core::pretty_errorln!("    <cyan>bun install<r>");
            Output::flush();
        }
        Global::exit(1);
    }
    let silent = manager.options.log_level == LogLevel::Silent;
    if !manager.options.do_.load_lockfile() {
        missing(silent, subject);
    }
    let load_result = manager.load_lockfile_from_cwd::<true>();
    let lockfile_name = loaded_lockfile_name(&load_result);
    match load_result {
        crate::lockfile::LoadResult::Ok(_) => lockfile_name,
        crate::lockfile::LoadResult::NotFound => missing(silent, subject),
        crate::lockfile::LoadResult::Err(cause) => {
            if !silent && !crate::migration::reported_unsupported_lockfile_version(&cause) {
                Output::err_generic(
                    "failed to {s} lockfile: {s}",
                    (cause.step.verb(), cause.value.name()),
                );
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

    let subject = if patterns.is_empty() {
        describe_groups(groups)
    } else {
        describe_patterns(&patterns)
    };
    let lockfile_name = exit_on_lockfile_load_failure(manager, &subject);

    let selection: Option<Vec<UpdateTargetWorkspace>> = (manager.options.do_.recursive()
        || !manager.options.filter_patterns.is_empty())
    .then(|| {
        let lockfile = &*manager.lockfile;
        let filter_patterns = manager.options.filter_patterns;
        let name_hashes = lockfile.packages.items_name_hash();
        let names = lockfile.packages.items_name();
        let resolutions = lockfile.packages.items_resolution();
        let buf = lockfile.buffers.string_bytes.as_slice();
        let selected = workspace_selection::select_lockfile_workspaces(
            lockfile,
            filter_patterns,
            original_cwd,
            RootSelection::Implicit,
        );
        let silent = manager.options.log_level == LogLevel::Silent;
        if selected.ids.is_empty() && !filter_patterns.is_empty() {
            if silent {
                Global::exit(1);
            }
            workspace_selection::error_unmatched(filter_patterns);
        }
        selected
            .ids
            .into_iter()
            .map(|id| UpdateTargetWorkspace {
                is_root: resolutions[id as usize].tag == ResolutionTag::Root,
                name_hash: name_hashes[id as usize],
                name: Box::from(names[id as usize].slice(buf)),
            })
            .collect()
    });
    let scope = UpdateScope::new(
        selection.as_deref(),
        manager.workspace_name_hash,
        manager.options.filter_patterns.is_empty(),
        None,
    );

    let mut names: Vec<Box<[u8]>> = Vec::new();
    let mut checked: usize = 0;
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
                if !walk.is_set(i) {
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
                checked += 1;
                let dep = &deps[i];
                if owner_is_ws && !selects(groups, dep.behavior) {
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
                if positive_hit
                    && !excluded
                    && decided
                        .insert(pkg_name_hashes[target as usize], ())
                        .is_none()
                {
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
                "no packages in {} match \"{}\"",
                (lockfile_name, BStr::new(pattern.raw)),
            );
        }
    }
    if failed {
        Global::exit(1);
    }
    if names.is_empty() && passthrough.is_empty() {
        if manager.options.should_print_command_name() {
            pretty!(
                "\nChecked <green>{}<r> dependenc{}, none ",
                checked,
                if checked == 1 { "y" } else { "ies" }
            );
            if selecting {
                pretty!("selected by {}", BStr::new(&describe_groups(groups)));
            }
            if !patterns.is_empty() {
                pretty!(
                    "{}match {}",
                    if selecting { " " } else { "" },
                    BStr::new(&describe_patterns(&patterns))
                );
            }
            pretty!(" <d>(no changes)<r> ");
            Output::print_start_end_stdout(bun_core::start_time(), nano_timestamp());
            pretty!("\n");
            Output::flush();
        }
        Global::exit(0);
    }

    index_sort::sort_vec_unstable_by(&mut names, |a, b| a.cmp(b));
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
