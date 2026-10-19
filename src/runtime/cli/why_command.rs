use core::cmp::Ordering;

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
use bun_collections::index_sort;

pub(crate) struct WhyCommand;

const PREFIX_LAST: &[u8] = b"  \xE2\x94\x94\xE2\x94\x80 "; // "  └─ "
const PREFIX_MIDDLE: &[u8] = b"  \xE2\x94\x9C\xE2\x94\x80 "; // "  ├─ "
const PREFIX_CONTINUE: &[u8] = b"  \xE2\x94\x82  "; // "  │  "
const PREFIX_SPACE: &[u8] = b"     ";

// The label of a root package.json with no "name". It has spaces, so it is never a package name.
const UNNAMED_ROOT: &[u8] = b"the root package";

struct VersionInfo {
    version: Box<[u8]>,
    pkg_id: PackageID,
}

#[derive(Clone)]
struct DependentInfo {
    name: Box<[u8]>,
    version: Box<[u8]>,
    /// The name that this dependent uses for the package, if it isn't the package's own name.
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

/// Most specific range first, then by dependency type, then by name.
fn cmp_dependents(a: &DependentInfo, b: &DependentInfo) -> Ordering {
    get_specifier_specificity(&b.spec)
        .cmp(&get_specifier_specificity(&a.spec))
        .then_with(|| {
            get_dependency_type_priority(b.dep_type).cmp(&get_dependency_type_priority(a.dep_type))
        })
        .then_with(|| a.name.cmp(&b.name))
}

#[derive(Clone, Copy)]
enum NamePattern<'a> {
    Exact(&'a [u8]),
    Prefix(&'a [u8]),
    Suffix(&'a [u8]),
    Middle(&'a [u8], &'a [u8]),
    Contains(&'a [u8]),
    Invalid,
}

struct GlobPattern<'a> {
    name: NamePattern<'a>,
    version_pattern: &'a [u8],
    version_query: Option<semver::query::Group>,
}

impl<'a> GlobPattern<'a> {
    fn init(pattern: &'a [u8]) -> GlobPattern<'a> {
        let (name_pattern, version_pattern) = Dependency::split_name_and_maybe_version(pattern);

        let mut result = GlobPattern {
            name: Self::init_for_name(name_pattern),
            version_pattern: b"",
            version_query: None,
        };

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

    fn init_for_name(pattern: &'a [u8]) -> NamePattern<'a> {
        let Some(wildcard_pos) = strings::index_of_char_usize(pattern, b'*') else {
            return NamePattern::Exact(pattern);
        };

        if pattern.len() >= 3 && pattern[0] == b'*' && pattern[pattern.len() - 1] == b'*' {
            let substring = &pattern[1..pattern.len() - 1];
            if !substring.is_empty() && !strings::contains_char(substring, b'*') {
                return NamePattern::Contains(substring);
            }
        }

        if wildcard_pos == pattern.len() - 1 {
            return NamePattern::Prefix(&pattern[0..wildcard_pos]);
        }

        if wildcard_pos == 0 {
            return NamePattern::Suffix(&pattern[1..]);
        }

        if strings::contains_char(&pattern[wildcard_pos + 1..], b'*') {
            return NamePattern::Invalid;
        }

        NamePattern::Middle(&pattern[0..wildcard_pos], &pattern[wildcard_pos + 1..])
    }

    fn matches_name(&self, name: &[u8]) -> bool {
        match self.name {
            NamePattern::Exact(exact) => strings::eql(name, exact),
            NamePattern::Prefix(prefix) => name.starts_with(prefix),
            NamePattern::Suffix(suffix) => name.ends_with(suffix),
            NamePattern::Middle(prefix, suffix) => {
                name.starts_with(prefix) && name.ends_with(suffix)
            }
            NamePattern::Contains(substring) => strings::index_of(name, substring).is_some(),
            NamePattern::Invalid => false,
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
  <blue>\\<package\\><r>     <d>The package name or alias to explain (supports glob patterns like '@org/*')<r>

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
        let positionals = match cli.positionals {
            [b"why", rest @ ..] => rest,
            all => all,
        };

        let (pm, _cwd) = package_manager::init(&mut *ctx, &cli, Subcommand::Why)?;

        let Some(&package_pattern) = positionals.first() else {
            Self::print_usage();
            Global::exit(1);
        };
        Self::exec_with_manager(pm, package_pattern, cli.top_only)
    }

    pub(crate) fn exec_from_pm(
        pm: &mut PackageManager,
        positionals: &[&[u8]],
    ) -> Result<(), crate::Error> {
        if positionals.len() < 2 {
            Self::print_usage();
            Global::exit(1);
        }

        Self::exec_with_manager(pm, positionals[1], pm.options.top_only)
    }

    fn exec_with_manager(
        pm: &mut PackageManager,
        package_pattern: &[u8],
        top_only: bool,
    ) -> Result<(), crate::Error> {
        let max_depth = if top_only {
            1
        } else {
            pm.options.depth.unwrap_or(100)
        };
        let configured_linker = pm.options.node_linker;

        // Load into `pm.lockfile` itself, because a migration fetches the manifests of the packages
        // that it finds there.
        let linker = pm
            .load_lockfile_from_cwd_or_exit::<true>("")
            .node_linker(configured_linker);

        let lockfile: &Lockfile = &pm.lockfile;
        let string_bytes = lockfile.buffers.string_bytes.as_slice();
        let packages = lockfile.packages.slice();
        let dependencies_items = lockfile.buffers.dependencies.as_slice();
        let resolutions_items = lockfile.buffers.resolutions.as_slice();

        let pkg_dep_slices = packages.items_dependencies();
        let pkg_res_slices = packages.items_resolutions();

        let mut target_versions: Vec<VersionInfo> = Vec::new();

        let mut all_dependents: HashMap<PackageID, Vec<DependentInfo>> = HashMap::default();

        // A peer dependency leads to the copy that each placement of its owner resolves, regardless
        // of which one the resolver bound it to.
        let mut peer_targets: HashMap<DependencyID, Vec<PackageID>> = HashMap::default();
        let served_peers = if linker == NodeLinker::Isolated {
            bun_install::isolated_install::served_peers(&*pm, lockfile)?
        } else {
            bun_install::lockfile::tree::served_peers(lockfile)
        };
        for (dep_id, pkg_id) in served_peers {
            peer_targets.entry(dep_id).or_default().push(pkg_id);
        }

        let glob = GlobPattern::init(package_pattern);

        let pkg_names = packages.items_name();
        let pkg_name_hashes = packages.items_name_hash();
        let pkg_resolution = packages.items_resolution();

        // The pattern also selects a package through the name of a dependency that leads to it, so an alias finds the package behind it.
        let mut pkg_matched_by_dep_name = vec![false; packages.len()];

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

                let dep_pkg_version: Box<[u8]> = pkg_resolution[pkg_idx]
                    .fmt(string_bytes, PathSep::Auto)
                    .to_string()
                    .into_bytes()
                    .into_boxed_slice();

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

                    pkg_matched_by_dep_name[target_id as usize] |= glob.matches_name(dep_name);

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
                || !(glob.matches_name(pkg_name) || pkg_matched_by_dep_name[pkg_idx])
            {
                continue;
            }

            let resolution = &pkg_resolution[pkg_idx];

            let version: Box<[u8]> = resolution
                .fmt(string_bytes, PathSep::Auto)
                .to_string()
                .into_bytes()
                .into_boxed_slice();

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

            match all_dependents.get(&target_version.pkg_id) {
                None => bun_core::prettyln!("<d>  └─ No dependents found<r>"),
                Some(_) if max_depth == 0 => {
                    bun_core::prettyln!("<d>  └─ (deeper dependencies hidden)<r>");
                }
                Some(dependents) => {
                    let mut sorted: Vec<DependentInfo> = dependents.clone();
                    index_sort::sort_slice_by(&mut sorted, cmp_dependents);

                    let mut ctx_data = TreeContext {
                        all_dependents: &all_dependents,
                        max_depth,
                        path_tracker: HashMap::default(),
                        expanded: HashMap::default(),
                    };
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
            }

            bun_core::prettyln!("");
            Output::flush();
        }

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

struct TreeContext<'a> {
    all_dependents: &'a HashMap<PackageID, Vec<DependentInfo>>,
    max_depth: usize,
    /// The packages that are being expanded right now. The value records whether a `*circular`
    /// pointed at it.
    path_tracker: HashMap<PackageID, bool>,
    /// The `(depth, cutoff)` of each printed subtree. A repeat that isn't shallower than `cutoff`
    /// is printed as `*deduped`.
    expanded: HashMap<PackageID, (usize, usize)>,
}

/// Returns `(lines printed, cutoff)`. See `TreeContext::expanded`.
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
            if depth >= ctx.max_depth {
                bun_core::prettyln!("<d>{}└─ (deeper dependencies hidden)<r>", BStr::new(prefix));
                lines += 1;
                cutoff = depth;
                break;
            }

            let is_dep_last = dep_idx == len - 1;
            let (branch, next_suffix) = if is_dep_last {
                ("└─ ", "   ")
            } else {
                ("├─ ", "│  ")
            };
            print_package_with_type(&[prefix, branch.as_bytes()].concat(), dep);
            lines += 1;
            let next_prefix = [prefix, next_suffix.as_bytes()].concat();

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
        // Their `*circular` replaced this cut-off subtree, and a repeat reaches it one level
        // further down.
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
