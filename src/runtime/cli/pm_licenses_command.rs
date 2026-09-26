use std::borrow::Cow;
use std::cmp::Ordering;
use std::io::Write as _;

use bstr::BStr;
use bun_ast::{Expr, Log, Source};
use bun_collections::{DynamicBitSet, StringHashMap, index_sort};
use bun_core::fmt::{PathSep, redacted};
use bun_core::{FileKind, Global, Output, strings};
use bun_install::isolated_install::store::entry::fmt_store_key;
use bun_install::lockfile::{Lockfile, package::PackageColumns as _, reachable, tree};
use bun_install::package_manager::{LogLevel, workspace_selection};
use bun_install::{PackageID, PackageManager, Resolution, ResolutionTag};
use bun_install_types::NodeLinker::NodeLinker;
use bun_parsers::json as JSON;
use bun_paths::{AutoAbsPath, resolve_path};
use bun_sys::{self, Dir, Fd, File};

use crate::cli::package_manager_command::PackageManagerCommand;

const UNKNOWN_LICENSE: &[u8] = b"Unknown";
const MAX_SCAN_DEPTH: usize = 64;

struct PackageInfo {
    name: Option<Box<[u8]>>,
    version: Option<Box<[u8]>>,
    license: Box<[u8]>,
    homepage: Option<Box<[u8]>>,
    author: Option<Box<[u8]>>,
    description: Option<Box<[u8]>>,
    path: Box<[u8]>,
}

struct Entry {
    license: Box<[u8]>,
    name: Box<[u8]>,
    version: Box<[u8]>,
    path: Box<[u8]>,
    semver: Option<bun_semver::Version>,
    homepage: Option<Box<[u8]>>,
    author: Option<Box<[u8]>>,
    description: Option<Box<[u8]>>,
    dev_only: bool,
}

/// Lazily-scanned, sorted entry names of `node_modules/.bun/`; `None` until first needed.
struct BunStore {
    entries: Option<Vec<Box<[u8]>>>,
}

struct DiskIndex {
    entries: Option<StringHashMap<PackageInfo>>,
}

#[derive(Clone, Copy)]
pub(crate) struct LicensesFlags {
    pub(crate) dev_only: bool,
    pub(crate) long: bool,
}

pub(crate) struct PmLicensesCommand;

impl PmLicensesCommand {
    pub(crate) fn exec(
        pm: &mut PackageManager,
        positionals: &[&[u8]],
        original_cwd: &[u8],
        flags: LicensesFlags,
    ) -> crate::Result<()> {
        let log_level = pm.options.log_level;
        let not_silent = log_level != LogLevel::Silent;

        if positionals.len() > 1 {
            let subcommand = positionals[1];
            if !strings::eql_comptime(subcommand, b"list")
                && !strings::eql_comptime(subcommand, b"ls")
            {
                if not_silent {
                    Output::err_generic(
                        "unknown subcommand \"{s}\" for bun pm licenses",
                        (BStr::new(subcommand),),
                    );
                    bun_core::note!("did you mean 'bun pm licenses list'?");
                }
                Global::exit(1);
            }
            if positionals.len() > 2 {
                if not_silent {
                    Output::err_generic(
                        "bun pm licenses {s} does not take arguments",
                        (BStr::new(subcommand),),
                    );
                }
                Global::exit(1);
            }
        }

        let configured_linker = pm.options.node_linker;
        let load = pm.load_lockfile_from_cwd::<true>();
        PackageManagerCommand::handle_load_lockfile_errors_for(&load, log_level, "list");
        let isolated = load.node_linker(configured_linker) == NodeLinker::Isolated;

        let json_output = pm.options.json_output;
        let features = pm.options.local_package_features;
        let lockfile: &Lockfile = &pm.lockfile;

        if flags.dev_only && !features.dev_dependencies {
            if not_silent {
                Output::err_generic("--dev cannot be combined with --prod or --omit=dev", ());
            }
            Global::exit(1);
        }

        let mut path = AutoAbsPath::init_top_level_dir();
        let top_len = path.len();
        let _ = path.append(b"node_modules");
        if !bun_sys::exists(path.slice()) {
            if not_silent {
                Output::err_generic("node_modules not found, nothing to list", ());
                bun_core::note!("run 'bun install' first");
            }
            Global::exit(1);
        }
        path.set_length(top_len);

        let filter_patterns = pm.options.filter_patterns;
        let (roots, follow_workspace_edges): (Vec<PackageID>, bool) = if filter_patterns.is_empty()
        {
            (
                vec![pm.root_package_id.get(lockfile, pm.workspace_name_hash)],
                true,
            )
        } else {
            let selection = workspace_selection::select_lockfile_workspaces(
                lockfile,
                filter_patterns,
                original_cwd,
                workspace_selection::RootSelection::Implicit,
            );
            if selection.ids.is_empty() {
                if not_silent {
                    Output::err_generic(
                        "{}",
                        (BStr::new(&workspace_selection::unmatched_message(
                            filter_patterns,
                        )),),
                    );
                }
                Global::exit(1);
            }
            if not_silent {
                workspace_selection::warn_unmatched(filter_patterns, &selection.unmatched_patterns);
            }
            (selection.ids, false)
        };

        // After the exits above so error output keeps a clean stdout.
        if pm.options.should_print_command_name() && !json_output {
            bun_core::pretty!(
                "<r><b>bun pm licenses <r><d>v{}<r>\n\n",
                Global::package_json_version_with_sha
            );
            Output::flush();
        }

        let options = reachable::Options {
            root: 0,
            dev: features.dev_dependencies,
            optional: features.optional_dependencies,
            peer: features.peer_dependencies,
            optional_peer: features.peer_dependencies,
            bundled: true,
            platform: Some((pm.options.cpu, pm.options.os)),
        };
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let walk = if flags.dev_only {
            reachable::dev_packages_from
        } else {
            reachable::packages_from
        };
        let wanted = walk(
            lockfile,
            resolutions,
            &roots,
            follow_workspace_edges,
            options,
        );
        let production: Option<DynamicBitSet> =
            (!json_output && features.dev_dependencies).then(|| {
                reachable::packages_from(
                    lockfile,
                    resolutions,
                    &roots,
                    follow_workspace_edges,
                    reachable::Options {
                        dev: false,
                        ..options
                    },
                )
            });
        let locations = tree_locations(lockfile);

        let packages = lockfile.packages.slice();
        let pkg_names = packages.items_name();
        let pkg_resolution = packages.items_resolution();
        let buf = lockfile.buffers.string_bytes.as_slice();

        let mut log = Log::init();
        let mut store = BunStore { entries: None };
        let mut disk = DiskIndex { entries: None };
        let mut entries: Vec<Entry> = Vec::new();
        let mut missing: usize = 0;
        let mut checked: usize = 0;

        for pkg_id in 0..packages.len() {
            if !wanted.is_set(pkg_id) {
                continue;
            }
            let resolution = &pkg_resolution[pkg_id];
            if matches!(
                resolution.tag,
                ResolutionTag::Root | ResolutionTag::Workspace | ResolutionTag::Symlink
            ) {
                continue;
            }
            checked += 1;

            let mut version: Vec<u8> = Vec::new();
            let _ = write!(&mut version, "{}", resolution.fmt(buf, PathSep::Posix));
            let is_npm = resolution.tag == ResolutionTag::Npm;

            let mut info = if isolated {
                store.read_info(
                    &mut path,
                    top_len,
                    pkg_names[pkg_id],
                    resolution,
                    buf,
                    &mut log,
                )
            } else {
                None
            };

            if info.is_none() {
                if let Some(location) = &locations[pkg_id] {
                    let segments: [&[u8]; 1] = [location];
                    info = read_package_info_at(&mut path, top_len, &segments, &mut log);
                }
                if is_npm {
                    info = info.filter(|info| match &info.version {
                        Some(installed) => installed[..] == version[..],
                        None => true,
                    });
                }
            }

            if info.is_none() && !isolated {
                info = store.read_info(
                    &mut path,
                    top_len,
                    pkg_names[pkg_id],
                    resolution,
                    buf,
                    &mut log,
                );
            }

            if info.is_none() && is_npm {
                info = disk.take(
                    &mut path,
                    top_len,
                    &mut log,
                    pkg_names[pkg_id].slice(buf),
                    &version,
                );
            }

            let Some(info) = info else {
                missing += 1;
                continue;
            };

            entries.push(Entry {
                license: info.license,
                name: pkg_names[pkg_id].slice(buf).into(),
                version: version.into_boxed_slice(),
                path: info.path,
                semver: is_npm.then(|| resolution.npm().version),
                homepage: info.homepage,
                author: info.author,
                description: info.description,
                dev_only: production.as_ref().is_some_and(|prod| !prod.is_set(pkg_id)),
            });
        }

        index_sort::sort_vec_by(&mut entries, |a, b| {
            license_order(&a.license, &b.license)
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| match (a.semver, b.semver) {
                    (Some(x), Some(y)) => x.order(y, buf, buf),
                    (Some(_), None) => Ordering::Less,
                    (None, Some(_)) => Ordering::Greater,
                    (None, None) => Ordering::Equal,
                })
                .then_with(|| a.version.cmp(&b.version))
        });

        if json_output {
            print_json(&entries);
        } else {
            print_text(
                &entries,
                flags.long,
                checked,
                pm.options.should_print_command_name(),
            );
        }

        Output::flush();
        if missing > 0 && not_silent {
            if missing == 1 {
                bun_core::warn!("1 package in bun.lock is not installed and was skipped");
            } else {
                bun_core::warn!(
                    "{} packages in bun.lock are not installed and were skipped",
                    missing
                );
            }
            bun_core::note!("run 'bun install' first");
            Output::flush();
        }
        Ok(())
    }
}

/// Unknown last; otherwise case-insensitive ignoring a leading `(`, so identical licenses stay adjacent for grouping.
fn license_order(a: &[u8], b: &[u8]) -> Ordering {
    (a == UNKNOWN_LICENSE)
        .cmp(&(b == UNKNOWN_LICENSE))
        .then_with(|| {
            let a_key = a.strip_prefix(b"(").unwrap_or(a);
            let b_key = b.strip_prefix(b"(").unwrap_or(b);
            a_key
                .iter()
                .map(u8::to_ascii_lowercase)
                .cmp(b_key.iter().map(u8::to_ascii_lowercase))
        })
        .then_with(|| a.cmp(b))
}

fn printable(s: &[u8]) -> Cow<'_, [u8]> {
    if s.iter().any(u8::is_ascii_control) {
        Cow::Owned(
            s.iter()
                .copied()
                .filter(|b| !b.is_ascii_control())
                .collect(),
        )
    } else {
        Cow::Borrowed(s)
    }
}

fn tree_locations(lockfile: &Lockfile) -> Vec<Option<Box<[u8]>>> {
    let len = lockfile.packages.len();
    let mut out: Vec<Option<Box<[u8]>>> = vec![None; len];
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let buf = lockfile.buffers.string_bytes.as_slice();

    let mut it = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);
    while let Some(folder) = it.next(None) {
        for &dep_id in folder.dependencies {
            let pkg_id = resolutions[dep_id as usize];
            if (pkg_id as usize) >= len || out[pkg_id as usize].is_some() {
                continue;
            }
            let relative_path = folder.relative_path.as_bytes();
            let alias = dependencies[dep_id as usize].name.slice(buf);
            let mut location: Vec<u8> = Vec::with_capacity(relative_path.len() + 1 + alias.len());
            location.extend_from_slice(relative_path);
            location.push(bun_paths::SEP);
            location.extend_from_slice(alias);
            out[pkg_id as usize] = Some(location.into_boxed_slice());
        }
    }

    out
}

fn read_package_info_at(
    path: &mut AutoAbsPath,
    base_len: usize,
    segments: &[&[u8]],
    log: &mut Log,
) -> Option<PackageInfo> {
    path.set_length(base_len);
    for &segment in segments {
        let _ = path.append(segment);
    }
    let dir_len = path.len();
    let _ = path.append(b"package.json");
    let full = path.slice();
    let info = read_package_info(full, &full[..dir_len], log);
    path.set_length(base_len);
    info
}

fn read_package_info(path: &[u8], dir: &[u8], log: &mut Log) -> Option<PackageInfo> {
    let contents = File::read_from(Fd::cwd(), path).ok()?;
    bun_ast::initialize_store_or_reset();
    let source = Source::init_path_string(path, contents.as_slice());
    Some(
        match JSON::parse_package_json_utf8(&source, log, crate::cli::cli_arena()) {
            Ok(json) => PackageInfo {
                name: string_field(&json, b"name"),
                version: string_field(&json, b"version"),
                license: license_of(&json),
                homepage: string_field(&json, b"homepage").or_else(|| repository_of(&json)),
                author: author_of(&json),
                description: string_field(&json, b"description"),
                path: platform_dir(dir),
            },
            Err(_) => PackageInfo {
                name: None,
                version: None,
                license: UNKNOWN_LICENSE.into(),
                homepage: None,
                author: None,
                description: None,
                path: platform_dir(dir),
            },
        },
    )
}

fn platform_dir(dir: &[u8]) -> Box<[u8]> {
    let mut out = dir.to_vec();
    resolve_path::posix_to_platform_in_place(&mut out);
    out.into_boxed_slice()
}

fn str_of(expr: &Expr) -> Option<&[u8]> {
    expr.as_string(crate::cli::cli_arena())
        .filter(|s| !s.is_empty())
}

fn string_field(json: &Expr, key: &[u8]) -> Option<Box<[u8]>> {
    json.get(key).and_then(|e| str_of(&e).map(Into::into))
}

fn string_or_type(expr: &Expr) -> Option<Box<[u8]>> {
    match str_of(expr) {
        Some(s) => Some(s.into()),
        None => string_field(expr, b"type").or_else(|| string_field(expr, b"name")),
    }
}

fn parse_license_field(field: &Expr) -> Option<Box<[u8]>> {
    if let Some(value) = string_or_type(field) {
        return Some(value);
    }

    let mut collected: Vec<Box<[u8]>> = Vec::new();
    let mut items = field.as_array()?;
    while let Some(item) = items.next() {
        if let Some(value) = string_or_type(&item) {
            collected.push(value);
        }
    }

    match collected.len() {
        0 => None,
        1 => collected.pop(),
        _ => {
            let mut joined: Vec<u8> = Vec::new();
            joined.push(b'(');
            for (i, value) in collected.iter().enumerate() {
                if i > 0 {
                    joined.extend_from_slice(b" OR ");
                }
                joined.extend_from_slice(value);
            }
            joined.push(b')');
            Some(joined.into_boxed_slice())
        }
    }
}

fn license_of(json: &Expr) -> Box<[u8]> {
    json.get(b"license")
        .and_then(|field| parse_license_field(&field))
        .or_else(|| {
            json.get(b"licenses")
                .and_then(|field| parse_license_field(&field))
        })
        .unwrap_or_else(|| UNKNOWN_LICENSE.into())
}

fn repository_of(json: &Expr) -> Option<Box<[u8]>> {
    let repository = json.get(b"repository")?;
    match str_of(&repository) {
        Some(s) => Some(s.into()),
        None => string_field(&repository, b"url"),
    }
}

fn author_of(json: &Expr) -> Option<Box<[u8]>> {
    let author = json.get(b"author")?;
    if let Some(s) = str_of(&author) {
        return Some(s.into());
    }

    let mut out: Vec<u8> = Vec::new();
    if let Some(name) = author.get(b"name").as_ref().and_then(str_of) {
        out.extend_from_slice(name);
    }
    if let Some(email) = author.get(b"email").as_ref().and_then(str_of) {
        if !out.is_empty() {
            out.push(b' ');
        }
        out.push(b'<');
        out.extend_from_slice(email);
        out.push(b'>');
    }
    if let Some(url) = author.get(b"url").as_ref().and_then(str_of) {
        if !out.is_empty() {
            out.push(b' ');
        }
        out.push(b'(');
        out.extend_from_slice(url);
        out.push(b')');
    }

    (!out.is_empty()).then(|| out.into_boxed_slice())
}

impl BunStore {
    fn read_info(
        &mut self,
        path: &mut AutoAbsPath,
        top_len: usize,
        pkg_name: bun_semver::String,
        resolution: &Resolution,
        buf: &[u8],
        log: &mut Log,
    ) -> Option<PackageInfo> {
        let entry = self.lookup(path, top_len, pkg_name, resolution, buf)?;
        let segments: [&[u8]; 5] = [
            b"node_modules",
            b".bun",
            entry,
            b"node_modules",
            pkg_name.slice(buf),
        ];
        read_package_info_at(path, top_len, &segments, log)
    }

    fn lookup(
        &mut self,
        path: &mut AutoAbsPath,
        top_len: usize,
        pkg_name: bun_semver::String,
        resolution: &Resolution,
        buf: &[u8],
    ) -> Option<&[u8]> {
        if self.entries.is_none() {
            self.entries = Some(Self::scan(path, top_len));
        }
        let entries = self.entries.as_deref()?;
        if entries.is_empty() {
            return None;
        }

        let mut key: Vec<u8> = Vec::new();
        let _ = write!(&mut key, "{}", fmt_store_key(pkg_name, resolution, buf));

        let i = entries.partition_point(|e| e[..] < key[..]);
        let entry = entries.get(i)?;
        let exact = entry[..] == key[..];
        let peer_suffixed =
            entry.len() > key.len() && entry.starts_with(&key) && entry[key.len()] == b'+';
        (exact || peer_suffixed).then_some(&entry[..])
    }

    fn scan(path: &mut AutoAbsPath, top_len: usize) -> Vec<Box<[u8]>> {
        path.set_length(top_len);
        let _ = path.append(b"node_modules");
        let _ = path.append(b".bun");
        let names: Vec<Box<[u8]>> = list_dir(path.slice())
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        path.set_length(top_len);
        names
    }
}

/// Sorted by name: readdir order differs per filesystem and `DiskIndex` keeps the first copy it sees.
fn list_dir(path: &[u8]) -> Vec<(Box<[u8]>, FileKind)> {
    let mut out: Vec<(Box<[u8]>, FileKind)> = Vec::new();
    let Ok(dir) = Dir::open(path) else {
        return out;
    };
    let mut iter = bun_sys::iterate_dir(dir.fd());
    while let Ok(Some(entry)) = iter.next() {
        out.push((entry.name.slice_u8().into(), entry.kind));
    }
    index_sort::sort_vec_unstable_by(&mut out, |a, b| a.0.cmp(&b.0));
    out
}

fn disk_key(name: &[u8], version: &[u8]) -> Vec<u8> {
    let mut key: Vec<u8> = Vec::with_capacity(name.len() + 1 + version.len());
    key.extend_from_slice(name);
    key.push(b'@');
    key.extend_from_slice(version);
    key
}

impl DiskIndex {
    fn take(
        &mut self,
        path: &mut AutoAbsPath,
        top_len: usize,
        log: &mut Log,
        name: &[u8],
        version: &[u8],
    ) -> Option<PackageInfo> {
        let entries = self.entries.get_or_insert_with(|| {
            let mut entries = StringHashMap::default();
            path.set_length(top_len);
            let _ = path.append(b"node_modules");
            Self::scan_node_modules(path, 0, log, &mut entries);
            path.set_length(top_len);
            entries
        });
        entries.remove(&disk_key(name, version)[..])
    }

    fn scan_node_modules(
        path: &mut AutoAbsPath,
        depth: usize,
        log: &mut Log,
        out: &mut StringHashMap<PackageInfo>,
    ) {
        let nm_len = path.len();
        for (name, kind) in list_dir(path.slice()) {
            if name.starts_with(b".") || (depth > 0 && kind == FileKind::SymLink) {
                continue;
            }
            if path.append(&name[..]).is_err() {
                continue;
            }
            if !name.starts_with(b"@") {
                Self::scan_package(path, depth, log, out);
            } else {
                let scope_len = path.len();
                for (scoped_name, scoped_kind) in list_dir(path.slice()) {
                    if scoped_name.starts_with(b".")
                        || (depth > 0 && scoped_kind == FileKind::SymLink)
                    {
                        continue;
                    }
                    if path.append(&scoped_name[..]).is_ok() {
                        Self::scan_package(path, depth, log, out);
                    }
                    path.set_length(scope_len);
                }
            }
            path.set_length(nm_len);
        }
    }

    fn scan_package(
        path: &mut AutoAbsPath,
        depth: usize,
        log: &mut Log,
        out: &mut StringHashMap<PackageInfo>,
    ) {
        let pkg_len = path.len();
        if let Some(info) = read_package_info_at(path, pkg_len, &[], log) {
            if let (Some(name), Some(version)) = (&info.name, &info.version) {
                let key = disk_key(name, version);
                if !out.contains_key(&key[..]) {
                    let _ = out.put(&key, info);
                }
            }
        }
        if depth < MAX_SCAN_DEPTH && path.append(b"node_modules").is_ok() {
            Self::scan_node_modules(path, depth + 1, log, out);
        }
        path.set_length(pkg_len);
    }
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

fn print_text(entries: &[Entry], long: bool, checked: usize, summary: bool) {
    if entries.is_empty() {
        bun_core::pretty!("No packages to list");
        if summary {
            bun_core::pretty!(
                " <d>(checked {} package{} in bun.lock)<r> ",
                checked,
                plural(checked)
            );
            Output::print_start_end_stdout(
                bun_core::start_time(),
                bun_core::time::nano_timestamp(),
            );
        }
        bun_core::pretty!("\n");
        return;
    }

    let mut licenses = 0;
    let mut start = 0;
    while start < entries.len() {
        let license = &entries[start].license;
        let mut end = start + 1;
        while end < entries.len() && entries[end].license == *license {
            end += 1;
        }

        if start > 0 {
            Output::print(format_args!("\n"));
        }
        licenses += 1;
        bun_core::prettyln!(
            "<b>{}<r> <d>({})<r>",
            BStr::new(&printable(license)),
            end - start
        );
        for (i, entry) in entries[start..end].iter().enumerate() {
            let last = start + i + 1 == end;
            bun_core::pretty!(
                "<d>{}<r> {}<d>@{}<r>",
                if last { "└──" } else { "├──" },
                BStr::new(&entry.name),
                redacted(BStr::new(&entry.version))
            );
            if entry.dev_only {
                bun_core::pretty!(" <d>(dev)<r>");
            }
            Output::print(format_args!("\n"));
            if long {
                for field in [&entry.author, &entry.description, &entry.homepage]
                    .into_iter()
                    .flatten()
                {
                    if last {
                        bun_core::prettyln!("    <d>{}<r>", BStr::new(&printable(field)));
                    } else {
                        bun_core::prettyln!("<d>│   {}<r>", BStr::new(&printable(field)));
                    }
                }
            }
        }

        start = end;
    }

    if summary {
        bun_core::pretty!(
            "\n<b>{}<r> package{} across {} license{} <d>(checked {} package{} in bun.lock)<r> ",
            entries.len(),
            plural(entries.len()),
            licenses,
            plural(licenses),
            checked,
            plural(checked)
        );
        Output::print_start_end_stdout(bun_core::start_time(), bun_core::time::nano_timestamp());
        bun_core::pretty!("\n");
    }
}

fn json_string(out: &mut Vec<u8>, s: &[u8]) {
    let _ = write!(
        out,
        "{}",
        bun_core::fmt::format_json_string_utf8(s, Default::default())
    );
}

fn print_json(entries: &[Entry]) {
    let mut out: Vec<u8> = Vec::new();

    if entries.is_empty() {
        out.extend_from_slice(b"{}\n");
        let _ = Output::writer().write_all(&out);
        return;
    }

    out.extend_from_slice(b"{\n");
    let mut start = 0;
    while start < entries.len() {
        let license = &entries[start].license;
        let mut end = start + 1;
        while end < entries.len() && entries[end].license == *license {
            end += 1;
        }

        if start > 0 {
            out.extend_from_slice(b",\n");
        }
        out.extend_from_slice(b"  ");
        json_string(&mut out, license);
        out.extend_from_slice(b": [");

        let mut group_start = start;
        let mut first_group = true;
        while group_start < end {
            let first = &entries[group_start];
            let mut group_end = group_start + 1;
            while group_end < end && entries[group_end].name == first.name {
                group_end += 1;
            }

            if !first_group {
                out.push(b',');
            }
            first_group = false;
            out.extend_from_slice(b"\n    {\n      \"name\": ");
            json_string(&mut out, &first.name);
            let mut kept: Vec<&Entry> = Vec::new();
            for entry in &entries[group_start..group_end] {
                if kept
                    .last()
                    .is_none_or(|previous| previous.version != entry.version)
                {
                    kept.push(entry);
                }
            }
            out.extend_from_slice(b",\n      \"versions\": [");
            for (i, entry) in kept.iter().enumerate() {
                if i > 0 {
                    out.extend_from_slice(b", ");
                }
                let version = redacted(BStr::new(&entry.version)).to_string();
                json_string(&mut out, version.as_bytes());
            }
            out.extend_from_slice(b"],\n      \"paths\": [");
            for (i, entry) in kept.iter().enumerate() {
                if i > 0 {
                    out.extend_from_slice(b", ");
                }
                json_string(&mut out, &entry.path);
            }
            out.extend_from_slice(b"],\n      \"license\": ");
            json_string(&mut out, license);
            let newest = &entries[group_end - 1];
            let extra: [(&[u8], &Option<Box<[u8]>>); 3] = [
                (b"author", &newest.author),
                (b"description", &newest.description),
                (b"homepage", &newest.homepage),
            ];
            for (key, value) in extra {
                if let Some(value) = value {
                    out.extend_from_slice(b",\n      \"");
                    out.extend_from_slice(key);
                    out.extend_from_slice(b"\": ");
                    json_string(&mut out, value);
                }
            }
            out.extend_from_slice(b"\n    }");

            group_start = group_end;
        }

        out.extend_from_slice(b"\n  ]");
        start = end;
    }
    out.extend_from_slice(b"\n}\n");

    let _ = Output::writer().write_all(&out);
}
