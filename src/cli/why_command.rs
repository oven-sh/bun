use core::cmp::Ordering;
use core::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::io::Write as _;

use bstr::BStr;

use bun_collections::HashMap;
use bun_core::{Global, Output};
use bun_install::install::PackageID;
use bun_install::PackageManager;
use bun_semver as semver;
use bun_str::strings;

use crate::command::{self, Command};
use crate::package_manager_command::PackageManagerCommand;

pub struct WhyCommand;

const PREFIX_LAST: &[u8] = b"  \xE2\x94\x94\xE2\x94\x80 "; // "  └─ "
const PREFIX_MIDDLE: &[u8] = b"  \xE2\x94\x9C\xE2\x94\x80 "; // "  ├─ "
const PREFIX_CONTINUE: &[u8] = b"  \xE2\x94\x82  "; // "  │  "
const PREFIX_SPACE: &[u8] = b"     ";

// PORT NOTE: Zig `var max_depth: usize = 100;` is a mutable container-level global.
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

// PORT NOTE: Zig signature was `fn(void, a, b) bool` (lessThan for std.sort).
// Kept bool-returning lessThan semantics; call sites wrap into a total Ordering
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum PatternType {
    Exact,
    Prefix,
    Suffix,
    Middle,
    Contains,
    Invalid,
}

// PORT NOTE: fields borrow slices of the input `pattern`; lifetime added even though
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
        if let Some(at_pos) = pattern.iter().position(|&b| b == b'@') {
            if at_pos > 0 && at_pos < pattern.len() - 1 {
                let pkg_pattern = &pattern[0..at_pos];
                let version_pattern = &pattern[at_pos + 1..];

                let mut result = Self::init_for_name(pkg_pattern);
                result.version_pattern = version_pattern;

                let sliced = semver::SlicedString::init(version_pattern, version_pattern);
                result.version_query = semver::Query::parse(version_pattern, sliced).ok();

                return result;
            }
        }

        Self::init_for_name(pattern)
    }

    fn init_for_name(pattern: &'a [u8]) -> GlobPattern<'a> {
        if !pattern.iter().any(|&b| b == b'*') {
            return GlobPattern { pattern_type: PatternType::Exact, ..Default::default() };
        }

        if pattern.len() >= 3 && pattern[0] == b'*' && pattern[pattern.len() - 1] == b'*' {
            let substring = &pattern[1..pattern.len() - 1];
            if !substring.is_empty() && !substring.iter().any(|&b| b == b'*') {
                return GlobPattern {
                    pattern_type: PatternType::Contains,
                    substring,
                    ..Default::default()
                };
            }
        }

        if let Some(wildcard_pos) = pattern.iter().position(|&b| b == b'*') {
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

            if pattern[wildcard_pos + 1..].iter().any(|&b| b == b'*') {
                return GlobPattern { pattern_type: PatternType::Invalid, ..Default::default() };
            }

            return GlobPattern {
                pattern_type: PatternType::Middle,
                prefix: &pattern[0..wildcard_pos],
                suffix: &pattern[wildcard_pos + 1..],
                ..Default::default()
            };
        }

        GlobPattern { pattern_type: PatternType::Exact, ..Default::default() }
    }

    fn matches_name(&self, name: &[u8], pattern: &[u8]) -> bool {
        match self.pattern_type {
            PatternType::Exact => strings::eql(name, pattern),
            PatternType::Prefix => name.starts_with(self.prefix),
            PatternType::Suffix => name.ends_with(self.suffix),
            PatternType::Middle => name.starts_with(self.prefix) && name.ends_with(self.suffix),
            PatternType::Contains => strings::index_of(name, self.substring).is_some(),
            _ => false,
        }
    }

    fn matches_version(&self, version: &[u8]) -> bool {
        if self.version_pattern.is_empty() || self.version_pattern == b"latest" {
            return true;
        }

        if let Some(query) = &self.version_query {
            let sliced = semver::SlicedString::init(version, version);
            let version_result = semver::Version::parse(sliced);

            if version_result.valid {
                let semver_version = version_result.version.min();
                return query.satisfies(semver_version, self.version_pattern, version);
            }
        }

        if strings::eql(version, self.version_pattern) {
            return true;
        }

        version.starts_with(self.version_pattern)
    }

    fn matches(&self, name: &[u8], version: &[u8], pattern: &[u8]) -> bool {
        if !self.matches_name(name, pattern) {
            return false;
        }
        if !self.version_pattern.is_empty() && !self.matches_version(version) {
            return false;
        }
        true
    }
}

impl WhyCommand {
    pub fn print_usage() {
        Output::prettyln(format_args!(
            concat!("<r><b>bun why<r> <d>v", "{}", "<r>"),
            Global::PACKAGE_JSON_VERSION_WITH_SHA
        ));

        // PORT NOTE: Zig multiline literal preserved verbatim.
        let usage_text = "Explain why a package is installed\n\
\n\
<b>Arguments:<r>\n\
  <blue>\\<package\\><r>     <d>The package name to explain (supports glob patterns like '@org/*')<r>\n\
\n\
<b>Options:<r>\n\
  <cyan>--top<r>         <d>Show only the top dependency tree instead of nested ones<r>\n\
  <cyan>--depth<r> <blue>\\<NUM\\><r> <d>Maximum depth of the dependency tree to display<r>\n\
\n\
<b>Examples:<r>\n\
  <d>$<r> <b><green>bun why<r> <blue>react<r>\n\
  <d>$<r> <b><green>bun why<r> <blue>\"@types/*\"<r> <cyan>--depth<r> <blue>2<r>\n\
  <d>$<r> <b><green>bun why<r> <blue>\"*-lodash\"<r> <cyan>--top<r>\n\
";
        Output::pretty(format_args!("{usage_text}"));
        Output::flush();
    }

    pub fn exec(ctx: &mut command::Context) -> Result<(), bun_core::Error> {
        let cli = PackageManager::CommandLineArguments::parse(PackageManager::Subcommand::Why)?;
        let (pm, _) = PackageManager::init(ctx, &cli, PackageManager::Subcommand::Why)?;

        if cli.positionals.len() < 1 {
            Self::print_usage();
            Global::exit(1);
        }

        if cli.positionals[0].as_ref() == b"why" {
            if cli.positionals.len() < 2 {
                Self::print_usage();
                Global::exit(1);
            }
            return Self::exec_with_manager(ctx, pm, &cli.positionals[1], cli.top_only);
        }

        Self::exec_with_manager(ctx, pm, &cli.positionals[0], cli.top_only)
    }

    pub fn exec_from_pm(
        ctx: &mut command::Context,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
    ) -> Result<(), bun_core::Error> {
        if positionals.len() < 2 {
            Self::print_usage();
            Global::exit(1);
        }

        Self::exec_with_manager(ctx, pm, positionals[1], pm.options.top_only)
    }

    pub fn exec_with_manager(
        ctx: &mut command::Context,
        pm: &mut PackageManager,
        package_pattern: &[u8],
        top_only: bool,
    ) -> Result<(), bun_core::Error> {
        let load_lockfile = pm.lockfile.load_from_cwd(pm, &mut ctx.log, true);
        PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, pm);

        if top_only {
            MAX_DEPTH.store(1, AtomicOrdering::Relaxed);
        } else if let Some(depth) = pm.options.depth {
            MAX_DEPTH.store(depth, AtomicOrdering::Relaxed);
        } else {
            MAX_DEPTH.store(100, AtomicOrdering::Relaxed);
        }

        let lockfile = load_lockfile.ok.lockfile;
        let string_bytes = lockfile.buffers.string_bytes.as_slice();
        let packages = lockfile.packages.slice();
        let dependencies_items = lockfile.buffers.dependencies.as_slice();
        let resolutions_items = lockfile.buffers.resolutions.as_slice();

        // PERF(port): was arena bulk-free — Zig used ArenaAllocator for all_dependents
        // and per-dep string dupes. Now using global allocator + Drop.

        let mut target_versions: Vec<VersionInfo> = Vec::new();
        // (defer free loop deleted — Box<[u8]> field + Vec Drop handle it)

        let mut all_dependents: HashMap<PackageID, Vec<DependentInfo>> = HashMap::default();

        let glob = GlobPattern::init(package_pattern);

        for pkg_idx in 0..packages.len() {
            let pkg = packages.get(pkg_idx);
            let pkg_name = pkg.name.slice(string_bytes);

            if pkg_name.is_empty() {
                continue;
            }

            let dependencies = pkg.dependencies.get(dependencies_items);
            let resolutions = pkg.resolutions.get(resolutions_items);

            for (dep_idx, dependency) in dependencies.iter().enumerate() {
                let target_id = resolutions[dep_idx];
                if target_id as usize >= packages.len() {
                    continue;
                }

                let dependents_entry = all_dependents.entry(target_id).or_insert_with(Vec::new);

                let mut dep_version_buf: Vec<u8> = Vec::new();
                // TODO(port): MultiArrayList column access `packages.items(.resolution)` — exact Rust API TBD
                write!(
                    &mut dep_version_buf,
                    "{}",
                    packages.items_resolution()[pkg_idx].fmt(string_bytes, bun_install::resolution::FmtMode::Auto)
                )
                .expect("unreachable");
                let dep_pkg_version: Box<[u8]> = dep_version_buf.into_boxed_slice();

                let spec: Box<[u8]> =
                    Box::<[u8]>::from(dependency.version.literal.slice(string_bytes));

                let dep_type = if dependency.behavior.dev {
                    DependencyType::Dev
                } else if dependency.behavior.optional && dependency.behavior.peer {
                    DependencyType::OptionalPeer
                } else if dependency.behavior.optional {
                    DependencyType::Optional
                } else if dependency.behavior.peer {
                    DependencyType::Peer
                } else {
                    DependencyType::Prod
                };

                let workspace = strings::has_prefix(&dep_pkg_version, b"workspace:")
                    || dep_pkg_version.is_empty();

                dependents_entry.push(DependentInfo {
                    name: Box::<[u8]>::from(pkg_name),
                    version: dep_pkg_version,
                    spec,
                    dep_type,
                    pkg_id: PackageID::try_from(pkg_idx).unwrap(),
                    workspace,
                });
            }

            if !glob.matches_name(pkg_name, package_pattern) {
                continue;
            }

            let mut version_buf: Vec<u8> = Vec::new();
            // TODO(port): MultiArrayList column access `packages.items(.resolution)` — exact Rust API TBD
            write!(
                &mut version_buf,
                "{}",
                packages.items_resolution()[pkg_idx].fmt(string_bytes, bun_install::resolution::FmtMode::Auto)
            )
            .expect("unreachable");
            let version: Box<[u8]> = version_buf.into_boxed_slice();

            if !glob.matches_version(&version) {
                continue;
            }

            target_versions.push(VersionInfo {
                version,
                pkg_id: PackageID::try_from(pkg_idx).unwrap(),
            });
        }

        if target_versions.is_empty() {
            Output::prettyln(format_args!(
                "<r><red>error<r>: No packages matching '{}' found in lockfile",
                BStr::new(package_pattern)
            ));
            Global::exit(1);
        }

        for target_version in &target_versions {
            let target_pkg = packages.get(target_version.pkg_id as usize);
            let target_name = target_pkg.name.slice(string_bytes);
            Output::prettyln(format_args!(
                "<b>{}@{}<r>",
                BStr::new(target_name),
                BStr::new(&target_version.version)
            ));

            if let Some(dependents) = all_dependents.get_mut(&target_version.pkg_id) {
                if dependents.is_empty() {
                    Output::prettyln(format_args!("<d>  └─ No dependents found<r>"));
                } else if MAX_DEPTH.load(AtomicOrdering::Relaxed) == 0 {
                    Output::prettyln(format_args!("<d>  └─ (deeper dependencies hidden)<r>"));
                } else {
                    let mut ctx_data =
                        TreeContext::init(string_bytes, top_only, &all_dependents);
                    // PORT NOTE: reshaped for borrowck — Zig sorted via mutable
                    // `dependents.items` while also holding `&all_dependents` in ctx_data.
                    // Clone the slice to sort independently.
                    let mut sorted: Vec<DependentInfo> = dependents.clone();
                    sorted.sort_by(|a, b| {
                        if compare_dependents(a, b) {
                            Ordering::Less
                        } else if compare_dependents(b, a) {
                            Ordering::Greater
                        } else {
                            Ordering::Equal
                        }
                    });

                    let len = sorted.len();
                    for (dep_idx, dep) in sorted.iter().enumerate() {
                        let is_last = dep_idx == len - 1;
                        let prefix: &[u8] = if is_last { PREFIX_LAST } else { PREFIX_MIDDLE };

                        print_package_with_type(prefix, dep);
                        if !top_only {
                            print_dependency_tree(
                                &mut ctx_data,
                                dep.pkg_id,
                                if is_last { PREFIX_SPACE } else { PREFIX_CONTINUE },
                                1,
                                is_last,
                                dep.workspace,
                            );
                        }
                    }

                    ctx_data.clear_path_tracker();
                }
            } else {
                Output::prettyln(format_args!("<d>  └─ No dependents found<r>"));
            }

            Output::prettyln(format_args!(""));
            Output::flush();
        }

        Ok(())
    }
}

fn print_package_with_type(prefix: &[u8], package: &DependentInfo) {
    Output::pretty(format_args!("<d>{}<r>", BStr::new(prefix)));

    match package.dep_type {
        DependencyType::Dev => Output::pretty(format_args!("<magenta>dev<r> ")),
        DependencyType::Peer => Output::pretty(format_args!("<yellow>peer<r> ")),
        DependencyType::Optional => Output::pretty(format_args!("<cyan>optional<r> ")),
        DependencyType::OptionalPeer => Output::pretty(format_args!("<cyan>optional peer<r> ")),
        _ => {}
    }

    if package.workspace {
        Output::pretty(format_args!("<blue>{}<r>", BStr::new(&package.name)));
        if !package.version.is_empty() {
            Output::pretty(format_args!("<d><blue>@workspace<r>"));
        }
    } else {
        Output::pretty(format_args!("{}", BStr::new(&package.name)));
        if !package.version.is_empty() {
            Output::pretty(format_args!("<d>@{}<r>", BStr::new(&package.version)));
        }
    }

    if !package.spec.is_empty() {
        Output::prettyln(format_args!(" <d>(requires {})<r>", BStr::new(&package.spec)));
    } else {
        Output::prettyln(format_args!(""));
    }
}

struct TreeContext<'a> {
    // allocator field deleted — global mimalloc
    string_bytes: &'a [u8],
    top_only: bool,
    all_dependents: &'a HashMap<PackageID, Vec<DependentInfo>>,
    path_tracker: HashMap<PackageID, usize>,
}

impl<'a> TreeContext<'a> {
    fn init(
        string_bytes: &'a [u8],
        top_only: bool,
        all_dependents: &'a HashMap<PackageID, Vec<DependentInfo>>,
    ) -> TreeContext<'a> {
        TreeContext {
            string_bytes,
            top_only,
            all_dependents,
            path_tracker: HashMap::default(),
        }
    }

    fn clear_path_tracker(&mut self) {
        self.path_tracker.clear();
    }
}

fn print_dependency_tree(
    ctx: &mut TreeContext<'_>,
    current_pkg_id: PackageID,
    prefix: &[u8],
    depth: usize,
    printed_break_line: bool,
    parent_is_workspace: bool,
) {
    if ctx.path_tracker.get(&current_pkg_id).is_some() {
        Output::prettyln(format_args!("<d>{}└─ <yellow>*circular<r>", BStr::new(prefix)));
        return;
    }

    ctx.path_tracker.insert(current_pkg_id, depth);
    // PORT NOTE: reshaped for borrowck — Zig used `defer path_tracker.remove(...)`.
    // All post-insert exit paths below remove explicitly. Error paths are gone
    // (alloc failures abort under global mimalloc), so no errdefer needed.

    if let Some(dependents) = ctx.all_dependents.get(&current_pkg_id) {
        let mut sorted_dependents: Vec<DependentInfo> = dependents.clone();

        sorted_dependents.sort_by(|a, b| {
            if compare_dependents(a, b) {
                Ordering::Less
            } else if compare_dependents(b, a) {
                Ordering::Greater
            } else {
                Ordering::Equal
            }
        });

        let len = sorted_dependents.len();
        for (dep_idx, dep) in sorted_dependents.iter().enumerate() {
            if parent_is_workspace && dep.version.is_empty() {
                continue;
            }

            if depth >= MAX_DEPTH.load(AtomicOrdering::Relaxed) {
                Output::prettyln(format_args!(
                    "<d>{}└─ (deeper dependencies hidden)<r>",
                    BStr::new(prefix)
                ));
                ctx.path_tracker.remove(&current_pkg_id);
                return;
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

            let next_suffix: &[u8] = if is_dep_last {
                b"   "
            } else {
                "│  ".as_bytes()
            };
            let mut next_prefix: Vec<u8> = Vec::with_capacity(prefix.len() + next_suffix.len());
            next_prefix.extend_from_slice(prefix);
            next_prefix.extend_from_slice(next_suffix);

            let print_break_line = is_dep_last && len > 1 && !printed_break_line;
            print_dependency_tree(
                ctx,
                dep.pkg_id,
                &next_prefix,
                depth + 1,
                printed_break_line || print_break_line,
                dep.workspace,
            );

            if print_break_line {
                Output::prettyln(format_args!("<d>{}<r>", BStr::new(prefix)));
            }
        }
    }

    ctx.path_tracker.remove(&current_pkg_id);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/why_command.zig (492 lines)
//   confidence: medium
//   todos:      2
//   notes:      Output::pretty/prettyln assumed fn(format_args!); MultiArrayList column API + PackageManager/Semver paths need Phase-B wiring; mutable global → AtomicUsize; defer-remove + in-place sort reshaped for borrowck.
// ──────────────────────────────────────────────────────────────────────────
