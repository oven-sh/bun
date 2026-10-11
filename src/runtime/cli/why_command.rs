use core::cmp::Ordering;
use core::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::io::Write as _;

use bstr::BStr;

use bun_collections::HashMap;
use bun_core::fmt::{PathSep, escape_control_chars, for_terminal};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_install::dependency::Behavior;
use bun_install::lockfile::Lockfile;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::{
    CommandLineArguments, Dependency, DependencyExt as _, DependencyID, PackageID, PackageManager,
    ResolutionTag, Subcommand, package_manager,
};
use bun_install_types::NodeLinker::NodeLinker;
use bun_semver as semver;

use crate::command;
use crate::package_manager_command::PackageManagerCommand;
use bun_collections::index_sort;

pub(crate) struct WhyCommand;

const PREFIX_LAST: &[u8] = b"  \xE2\x94\x94\xE2\x94\x80 "; // "  └─ "
const PREFIX_MIDDLE: &[u8] = b"  \xE2\x94\x9C\xE2\x94\x80 "; // "  ├─ "
const PREFIX_CONTINUE: &[u8] = b"  \xE2\x94\x82  "; // "  │  "
const PREFIX_SPACE: &[u8] = b"     ";

// The label of a root package.json with no "name". It has spaces, so it is never a package name.
const UNNAMED_ROOT: &[u8] = b"the root package";

// Using AtomicUsize for safe interior mutability on a single-threaded CLI path.
static MAX_DEPTH: AtomicUsize = AtomicUsize::new(100);

struct VersionInfo {
    version: Box<[u8]>,
    pkg_id: PackageID,
}

#[derive(Clone)]
struct DependentInfo {
    name: Box<[u8]>,
    version: Box<[u8]>,
    /// What this dependent calls the package, when that is not the package's name.
    alias: Option<Box<[u8]>>,
    spec: Box<[u8]>,
    dep_type: DependencyType,
    pkg_id: PackageID,
    workspace: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DependencyType {
    Dev,
    Prod,
    Peer,
    Optional,
    OptionalPeer,
}

fn get_specifier_specificity(spec: &[u8]) -> u8 {
    if spec.is_empty() {
        return 9;
    }
    if spec[0] == b'*' {
        return 1;
    }
    if strings::index_of(spec, b".x").is_some() {
        return 5;
    }
    if strings::index_of_any(spec, b"<>=").is_some() {
        return 6;
    }
    if spec[0] == b'~' {
        return 7;
    }
    if spec[0] == b'^' {
        return 8;
    }
    if strings::index_of(spec, b"workspace:").is_some() {
        return 9;
    }
    if spec[0].is_ascii_digit() {
        return 10;
    }
    3
}

fn get_dependency_type_priority(dep_type: DependencyType) -> u8 {
    match dep_type {
        DependencyType::Prod => 4,
        DependencyType::Peer => 3,
        DependencyType::OptionalPeer => 2,
        DependencyType::Optional => 1,
        DependencyType::Dev => 0,
    }
}

// Bool-returning lessThan semantics; call sites wrap into a total Ordering
// (Less if a<b, Greater if b<a, else Equal — required since Rust 1.81 sort_by
// panics on non-total comparators).
fn compare_dependents(a: &DependentInfo, b: &DependentInfo) -> bool {
    let a_specificity = get_specifier_specificity(&a.spec);
    let b_specificity = get_specifier_specificity(&b.spec);

    if a_specificity != b_specificity {
        return a_specificity > b_specificity;
    }

    let a_type_priority = get_dependency_type_priority(a.dep_type);
    let b_type_priority = get_dependency_type_priority(b.dep_type);

    if a_type_priority != b_type_priority {
        return a_type_priority > b_type_priority;
    }

    a.name[..] < b.name[..]
}

fn cmp_dependents(a: &DependentInfo, b: &DependentInfo) -> Ordering {
    if compare_dependents(a, b) {
        Ordering::Less
    } else if compare_dependents(b, a) {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PatternType {
    Exact,
    Prefix,
    Suffix,
    Middle,
    Contains,
    Invalid,
}

// Fields borrow slices of the input `pattern`; lifetime added even though
// PORTING.md prefers Box/&'static for []const u8 fields — these are pure views over
// a caller-owned slice (BORROW_PARAM), never freed, never literal-only.
struct GlobPattern<'a> {
    pattern_type: PatternType,
    prefix: &'a [u8],
    suffix: &'a [u8],
    substring: &'a [u8],
    version_pattern: &'a [u8],
    version_query: Option<semver::query::Group>,
}

impl<'a> Default for GlobPattern<'a> {
    fn default() -> Self {
        Self {
            pattern_type: PatternType::Exact,
            prefix: b"",
            suffix: b"",
            substring: b"",
            version_pattern: b"",
            version_query: None,
        }
    }
}

impl<'a> GlobPattern<'a> {
    fn init(pattern: &'a [u8]) -> GlobPattern<'a> {
        let (name_pattern, version_pattern) = Dependency::split_name_and_maybe_version(pattern);

        let mut result = Self::init_for_name(name_pattern);

        if let Some(version_pattern) = version_pattern {
            result.version_pattern = version_pattern;

            let sliced = semver::SlicedString::init(version_pattern, version_pattern);
            // An empty group (`workspace:packages/a`, `beta`) satisfies every version.
            result.version_query = semver::query::parse(version_pattern, sliced)
                .ok()
                .filter(|group| !group.is_empty());
        }

        result
    }

    /// `Exact` keeps the whole name in `prefix`.
    fn init_for_name(pattern: &'a [u8]) -> GlobPattern<'a> {
        if !strings::contains_char(pattern, b'*') {
            return GlobPattern {
                pattern_type: PatternType::Exact,
                prefix: pattern,
                ..Default::default()
            };
        }

        if pattern.len() >= 3 && pattern[0] == b'*' && pattern[pattern.len() - 1] == b'*' {
            let substring = &pattern[1..pattern.len() - 1];
            if !substring.is_empty() && !strings::contains_char(substring, b'*') {
                return GlobPattern {
                    pattern_type: PatternType::Contains,
                    substring,
                    ..Default::default()
                };
            }
        }

        if let Some(wildcard_pos) = strings::index_of_char_usize(pattern, b'*') {
            if wildcard_pos == pattern.len() - 1 {
                return GlobPattern {
                    pattern_type: PatternType::Prefix,
                    prefix: &pattern[0..wildcard_pos],
                    ..Default::default()
                };
            }

            if wildcard_pos == 0 {
                return GlobPattern {
                    pattern_type: PatternType::Suffix,
                    suffix: &pattern[1..],
                    ..Default::default()
                };
            }

            if strings::contains_char(&pattern[wildcard_pos + 1..], b'*') {
                return GlobPattern {
                    pattern_type: PatternType::Invalid,
                    ..Default::default()
                };
            }

            return GlobPattern {
                pattern_type: PatternType::Middle,
                prefix: &pattern[0..wildcard_pos],
                suffix: &pattern[wildcard_pos + 1..],
                ..Default::default()
            };
        }

        GlobPattern {
            pattern_type: PatternType::Exact,
            prefix: pattern,
            ..Default::default()
        }
    }

    fn matches_name(&self, name: &[u8]) -> bool {
        match self.pattern_type {
            PatternType::Exact => strings::eql(name, self.prefix),
            PatternType::Prefix => name.starts_with(self.prefix),
            PatternType::Suffix => name.ends_with(self.suffix),
            PatternType::Middle => name.starts_with(self.prefix) && name.ends_with(self.suffix),
            PatternType::Contains => strings::index_of(name, self.substring).is_some(),
            _ => false,
        }
    }

    /// `version` slices into `string_bytes`. `resolution` is the printed resolution.
    fn matches_version(
        &self,
        version: Option<semver::Version>,
        string_bytes: &[u8],
        resolution: &[u8],
    ) -> bool {
        if self.version_pattern.is_empty()
            || self.version_pattern == b"latest"
            || self.version_pattern == b"*"
        {
            return true;
        }

        if let (Some(query), Some(version)) = (&self.version_query, version) {
            return query.satisfies(version, self.version_pattern, string_bytes);
        }

        resolution.starts_with(self.version_pattern)
    }
}

impl WhyCommand {
    fn print_usage() {
        bun_core::prettyln!(
            concat!("<r><b>bun why<r> <d>v", "{}", "<r>"),
            Global::package_json_version_with_sha
        );

        bun_core::pretty!(
            "\
Explain why a package is installed

<b>Arguments:<r>
  <blue>\\<package\\><r>     <d>The package name to explain (supports glob patterns like '@org/*')<r>

<b>Options:<r>
  <cyan>--top<r>         <d>Show only the top dependency tree instead of nested ones<r>
  <cyan>--depth<r> <blue>\\<NUM\\><r> <d>Maximum depth of the dependency tree to display<r>

<b>Examples:<r>
  <d>$<r> <b><green>bun why<r> <blue>react<r>
  <d>$<r> <b><green>bun why<r> <blue>\"@types/*\"<r> <cyan>--depth<r> <blue>2<r>
  <d>$<r> <b><green>bun why<r> <blue>\"*-lodash\"<r> <cyan>--top<r>
"
        );
        Output::flush();
    }

    pub(crate) fn exec(ctx: command::Context) -> Result<(), crate::Error> {
        let cli = CommandLineArguments::parse(Subcommand::Why)?;
        // Capture the few `cli` fields we read after `init` consumes it.
        let positionals = cli.positionals;
        let top_only = cli.top_only;

        let (pm, _cwd) = package_manager::init(&mut *ctx, cli, Subcommand::Why)?;

        if positionals.is_empty() {
            Self::print_usage();
            Global::exit(1);
        }

        if positionals[0] == b"why" {
            if positionals.len() < 2 {
                Self::print_usage();
                Global::exit(1);
            }
            return Self::exec_with_manager(ctx, pm, positionals[1], top_only);
        }

        Self::exec_with_manager(ctx, pm, positionals[0], top_only)
    }

    pub(crate) fn exec_from_pm(
        ctx: command::Context,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
    ) -> Result<(), crate::Error> {
        if positionals.len() < 2 {
            Self::print_usage();
            Global::exit(1);
        }

        Self::exec_with_manager(ctx, pm, positionals[1], pm.options.top_only)
    }

    fn exec_with_manager(
        ctx: command::Context,
        pm: &mut PackageManager,
        package_pattern: &[u8],
        top_only: bool,
    ) -> Result<(), crate::Error> {
        // Detach the `Box<Lockfile>` from `pm`
        // so `load_from_cwd` can take `Option<&mut PackageManager>` without
        // overlapping the `&mut self` lockfile borrow.
        let depth_opt = pm.options.depth;
        let log_level = pm.options.log_level;
        let configured_linker = pm.options.node_linker;
        // SAFETY: CLI dispatch is single-threaded and `log`'s last use is the
        // `load_from_cwd` call below, which receives it as the sole `&mut Log`;
        // no other path (`pm`, `ctx`) reborrows the process-static `Log` while
        // this reference is live.
        let log = unsafe { ctx.log_mut() };

        let mut lockfile_box: Box<Lockfile> = core::mem::take(&mut pm.lockfile);
        let load_lockfile = lockfile_box.load_from_cwd::<true>(Some(pm), log);
        PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, log_level);
        let linker = load_lockfile.node_linker(configured_linker);

        if top_only {
            MAX_DEPTH.store(1, AtomicOrdering::Relaxed);
        } else if let Some(depth) = depth_opt {
            MAX_DEPTH.store(depth, AtomicOrdering::Relaxed);
        } else {
            MAX_DEPTH.store(100, AtomicOrdering::Relaxed);
        }

        let lockfile: &Lockfile = &lockfile_box;
        let string_bytes = lockfile.buffers.string_bytes.as_slice();
        let packages = lockfile.packages.slice();
        let dependencies_items = lockfile.buffers.dependencies.as_slice();
        let resolutions_items = lockfile.buffers.resolutions.as_slice();

        let _pkg_names = packages.items_name();
        let pkg_dep_slices = packages.items_dependencies();
        let pkg_res_slices = packages.items_resolutions();
        let _pkg_resolution = packages.items_resolution();

        let mut target_versions: Vec<VersionInfo> = Vec::new();

        let mut all_dependents: HashMap<PackageID, Vec<DependentInfo>> = HashMap::default();

        // A peer edge leads to the copy each placement of its owner resolves, whichever one the resolver bound it to.
        let mut peer_targets: HashMap<DependencyID, Vec<PackageID>> = HashMap::default();
        let served_peers = if linker == NodeLinker::Isolated {
            bun_install::isolated_install::served_peers(pm, lockfile)?
        } else {
            bun_install::lockfile::tree::served_peers(lockfile)
        };
        for (dep_id, pkg_id) in served_peers {
            peer_targets.entry(dep_id).or_default().push(pkg_id);
        }

        let glob = GlobPattern::init(package_pattern);

        // The column-backed `PackageList` exposes
        // `items_name()` / `items_dependencies()` / … directly, so we read
        // columns by index instead of materialising a `Package` row.
        let pkg_names = packages.items_name();
        let pkg_name_hashes = packages.items_name_hash();
        let _pkg_dependencies = packages.items_dependencies();
        let _pkg_resolutions = packages.items_resolutions();
        let pkg_resolution = packages.items_resolution();

        // The pattern also selects a package through the name of a dependency that leads to it, so an alias finds the package behind it.
        let mut matched_by_dependency_name = vec![false; packages.len()];

        for pkg_idx in 0..packages.len() {
            let pkg_name = pkg_names[pkg_idx].slice(string_bytes);

            let dependent_name =
                if pkg_name.is_empty() && pkg_resolution[pkg_idx].tag == ResolutionTag::Root {
                    UNNAMED_ROOT
                } else {
                    pkg_name
                };

            let dependencies = pkg_dep_slices[pkg_idx].get(dependencies_items);
            let resolutions = pkg_res_slices[pkg_idx].get(resolutions_items);

            for (dep_idx, dependency) in dependencies.iter().enumerate() {
                let dep_id = pkg_dep_slices[pkg_idx].begin() + dep_idx as DependencyID;
                let targets: &[PackageID] = match peer_targets.get(&dep_id) {
                    Some(served) => served,
                    None => core::slice::from_ref(&resolutions[dep_idx]),
                };

                let mut dep_version_buf: Vec<u8> = Vec::new();
                write!(
                    &mut dep_version_buf,
                    "{}",
                    pkg_resolution[pkg_idx].fmt(string_bytes, PathSep::Auto)
                )
                .expect("unreachable");
                let dep_pkg_version: Box<[u8]> = dep_version_buf.into_boxed_slice();

                let dep_name = dependency.name.slice(string_bytes);
                let spec = dependency.version.literal.slice(string_bytes);

                let dep_type = if dependency.behavior.contains(Behavior::DEV) {
                    DependencyType::Dev
                } else if dependency.behavior.contains(Behavior::OPTIONAL)
                    && dependency.behavior.contains(Behavior::PEER)
                {
                    DependencyType::OptionalPeer
                } else if dependency.behavior.contains(Behavior::OPTIONAL) {
                    DependencyType::Optional
                } else if dependency.behavior.contains(Behavior::PEER) {
                    DependencyType::Peer
                } else {
                    DependencyType::Prod
                };

                let workspace = strings::has_prefix(&dep_pkg_version, b"workspace:")
                    || dep_pkg_version.is_empty();

                for &target_id in targets {
                    if target_id as usize >= packages.len() {
                        continue;
                    }

                    matched_by_dependency_name[target_id as usize] |= glob.matches_name(dep_name);

                    let target_name = pkg_names[target_id as usize].slice(string_bytes);
                    all_dependents
                        .entry(target_id)
                        .or_default()
                        .push(DependentInfo {
                            name: Box::<[u8]>::from(dependent_name),
                            version: dep_pkg_version.clone(),
                            alias: (dep_name != target_name).then(|| Box::<[u8]>::from(dep_name)),
                            spec: Box::<[u8]>::from(spec),
                            dep_type,
                            pkg_id: PackageID::try_from(pkg_idx).expect("int cast"),
                            workspace,
                        });
                }
            }
        }

        for pkg_idx in 0..packages.len() {
            let pkg_name = pkg_names[pkg_idx].slice(string_bytes);

            if pkg_name.is_empty()
                || !(glob.matches_name(pkg_name) || matched_by_dependency_name[pkg_idx])
            {
                continue;
            }

            let resolution = &pkg_resolution[pkg_idx];

            let mut version_buf: Vec<u8> = Vec::new();
            write!(
                &mut version_buf,
                "{}",
                resolution.fmt(string_bytes, PathSep::Auto)
            )
            .expect("unreachable");
            let version: Box<[u8]> = version_buf.into_boxed_slice();

            let semver_version = match resolution.tag {
                ResolutionTag::Npm => Some(resolution.npm().version),
                ResolutionTag::Workspace => lockfile
                    .workspace_versions
                    .get(&pkg_name_hashes[pkg_idx])
                    .copied(),
                _ => None,
            };

            if !glob.matches_version(semver_version, string_bytes, &version) {
                continue;
            }

            target_versions.push(VersionInfo {
                version,
                pkg_id: PackageID::try_from(pkg_idx).expect("int cast"),
            });
        }

        if target_versions.is_empty() {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: No packages matching '{}' found in lockfile",
                BStr::new(package_pattern)
            );
            Global::exit(1);
        }

        for target_version in &target_versions {
            let target_name = pkg_names[target_version.pkg_id as usize].slice(string_bytes);
            bun_core::prettyln!(
                "<b>{}@{}<r>",
                escape_control_chars(target_name),
                for_terminal(BStr::new(&target_version.version))
            );

            if let Some(dependents) = all_dependents.get(&target_version.pkg_id) {
                if dependents.is_empty() {
                    bun_core::prettyln!("<d>  └─ No dependents found<r>");
                } else if MAX_DEPTH.load(AtomicOrdering::Relaxed) == 0 {
                    bun_core::prettyln!("<d>  └─ (deeper dependencies hidden)<r>");
                } else {
                    // Clone the slice so it can be sorted while `ctx_data`
                    // still borrows `all_dependents`.
                    let mut sorted: Vec<DependentInfo> = dependents.clone();
                    index_sort::sort_slice_by(&mut sorted, cmp_dependents);

                    let mut ctx_data = TreeContext::init(&all_dependents);
                    ctx_data.path_tracker.insert(target_version.pkg_id, false);

                    let len = sorted.len();
                    for (dep_idx, dep) in sorted.iter().enumerate() {
                        let is_last = dep_idx == len - 1;
                        let prefix: &[u8] = if is_last { PREFIX_LAST } else { PREFIX_MIDDLE };

                        print_package_with_type(prefix, dep);
                        if !top_only {
                            print_dependency_tree(
                                &mut ctx_data,
                                dep.pkg_id,
                                if is_last {
                                    PREFIX_SPACE
                                } else {
                                    PREFIX_CONTINUE
                                },
                                1,
                                is_last,
                                dep.workspace,
                            );
                        }
                    }
                }
            } else {
                bun_core::prettyln!("<d>  └─ No dependents found<r>");
            }

            bun_core::prettyln!("");
            Output::flush();
        }

        // Restore detached lockfile back onto the manager singleton.
        pm.lockfile = lockfile_box;

        Ok(())
    }
}

fn print_package_with_type(prefix: &[u8], package: &DependentInfo) {
    bun_core::pretty!("<d>{}<r>", BStr::new(prefix));

    match package.dep_type {
        DependencyType::Dev => bun_core::pretty!("<magenta>dev<r> "),
        DependencyType::Peer => bun_core::pretty!("<yellow>peer<r> "),
        DependencyType::Optional => bun_core::pretty!("<cyan>optional<r> "),
        DependencyType::OptionalPeer => bun_core::pretty!("<cyan>optional peer<r> "),
        _ => {}
    }

    if package.workspace {
        bun_core::pretty!("<blue>{}<r>", escape_control_chars(&package.name));
        if !package.version.is_empty() {
            bun_core::pretty!("<d><blue>@workspace<r>");
        }
    } else {
        bun_core::pretty!("{}", escape_control_chars(&package.name));
        if !package.version.is_empty() {
            bun_core::pretty!("<d>@{}<r>", for_terminal(BStr::new(&package.version)));
        }
    }

    if package.spec.is_empty() {
        bun_core::prettyln!("");
    } else if let Some(alias) = &package.alias {
        bun_core::prettyln!(
            " <d>(requires {}@{})<r>",
            escape_control_chars(alias),
            for_terminal(BStr::new(&package.spec))
        );
    } else {
        bun_core::prettyln!(
            " <d>(requires {})<r>",
            for_terminal(BStr::new(&package.spec))
        );
    }
}

pub(crate) struct TreeContext<'a> {
    all_dependents: &'a HashMap<PackageID, Vec<DependentInfo>>,
    /// Packages being expanded right now; the value records whether a `*circular` pointed at it.
    path_tracker: HashMap<PackageID, bool>,
    /// `(depth, cutoff)` of subtrees already printed; repeats print `*deduped` (there are
    /// exponentially many paths) unless shallower than `cutoff`, where a branch cut at `MAX_DEPTH` shows more.
    expanded: HashMap<PackageID, (usize, usize)>,
}

impl<'a> TreeContext<'a> {
    fn init(all_dependents: &'a HashMap<PackageID, Vec<DependentInfo>>) -> TreeContext<'a> {
        TreeContext {
            all_dependents,
            path_tracker: HashMap::default(),
            expanded: HashMap::default(),
        }
    }
}

/// Returns `(lines printed, cutoff)`; see `TreeContext::expanded`.
fn print_dependency_tree(
    ctx: &mut TreeContext<'_>,
    current_pkg_id: PackageID,
    prefix: &[u8],
    depth: usize,
    printed_break_line: bool,
    parent_is_workspace: bool,
) -> (usize, usize) {
    if let Some(pointed_at_by_cycle) = ctx.path_tracker.get_mut(&current_pkg_id) {
        *pointed_at_by_cycle = true;
        bun_core::prettyln!("<d>{}└─ <yellow>*circular<r>", BStr::new(prefix));
        return (1, 0);
    }

    if let Some(&(_, cutoff)) = ctx.expanded.get(&current_pkg_id).filter(|e| depth >= e.1) {
        bun_core::prettyln!("<d>{}└─ *deduped<r>", BStr::new(prefix));
        return (1, cutoff);
    }

    ctx.path_tracker.insert(current_pkg_id, false);
    // All post-insert exit paths below remove explicitly. Error paths are gone
    // (alloc failures abort under global mimalloc).

    let (mut lines, mut cutoff) = (0usize, 0usize);

    if let Some(dependents) = ctx.all_dependents.get(&current_pkg_id) {
        // The root depends on every workspace, so it is left out of a workspace's dependents.
        let mut sorted_dependents: Vec<DependentInfo> = dependents
            .iter()
            .filter(|dep| !(parent_is_workspace && dep.version.is_empty()))
            .cloned()
            .collect();
        index_sort::sort_slice_by(&mut sorted_dependents, cmp_dependents);

        let len = sorted_dependents.len();
        for (dep_idx, dep) in sorted_dependents.iter().enumerate() {
            if depth >= MAX_DEPTH.load(AtomicOrdering::Relaxed) {
                bun_core::prettyln!("<d>{}└─ (deeper dependencies hidden)<r>", BStr::new(prefix));
                lines += 1;
                cutoff = depth;
                break;
            }

            let is_dep_last = dep_idx == len - 1;
            let prefix_char: &[u8] = if is_dep_last {
                "└─ ".as_bytes()
            } else {
                "├─ ".as_bytes()
            };

            let mut full_prefix: Vec<u8> = Vec::with_capacity(prefix.len() + prefix_char.len());
            full_prefix.extend_from_slice(prefix);
            full_prefix.extend_from_slice(prefix_char);
            print_package_with_type(&full_prefix, dep);
            lines += 1;

            let next_suffix: &[u8] = if is_dep_last {
                b"   "
            } else {
                "│  ".as_bytes()
            };
            let mut next_prefix: Vec<u8> = Vec::with_capacity(prefix.len() + next_suffix.len());
            next_prefix.extend_from_slice(prefix);
            next_prefix.extend_from_slice(next_suffix);

            let print_break_line = is_dep_last && len > 1 && !printed_break_line;
            let (subtree_lines, subtree_cutoff) = print_dependency_tree(
                ctx,
                dep.pkg_id,
                &next_prefix,
                depth + 1,
                printed_break_line || print_break_line,
                dep.workspace,
            );
            lines += subtree_lines;
            // A dependent repeats one level deeper than this package does.
            cutoff = cutoff.max(subtree_cutoff.saturating_sub(1));

            if print_break_line {
                bun_core::prettyln!("<d>{}<r>", BStr::new(prefix));
            }
        }
    }

    if ctx.path_tracker.remove(&current_pkg_id) == Some(true) && cutoff > 0 {
        // Their `*circular` stood in for this cut-off subtree; a repeat reaches it one level down.
        for (their_depth, their_cutoff) in ctx.expanded.values_mut() {
            if *their_depth > depth {
                *their_cutoff = (*their_cutoff).max(cutoff - 1);
            }
        }
    }

    // A one-line subtree is no longer than the `*deduped` marker, so it is repeated instead.
    if lines > 1 {
        ctx.expanded.insert(current_pkg_id, (depth, cutoff));
    }

    (lines, cutoff)
}
