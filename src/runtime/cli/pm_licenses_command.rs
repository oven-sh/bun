use std::cmp::Ordering;
use std::io::Write as _;

use bstr::BStr;
use bun_ast::{Expr, Log, Source};
use bun_collections::StringHashMap;
use bun_core::fmt::PathSep;
use bun_core::{FileKind, Global, Output, strings};
use bun_install::lockfile::{Lockfile, package::PackageColumns as _, tree};
use bun_install::npm::{Architecture, OperatingSystem};
use bun_install::{PackageID, PackageManager, Resolution, ResolutionTag};
use bun_parsers::json as JSON;
use bun_paths::AutoAbsPath;
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
}

struct Entry {
    license: Box<[u8]>,
    name: Box<[u8]>,
    version: Box<[u8]>,
    semver: Option<bun_semver::Version>,
    homepage: Option<Box<[u8]>>,
    author: Option<Box<[u8]>>,
}

/// Lazily-scanned, sorted entry names of `node_modules/.bun/`; `None` until first needed.
struct BunStore {
    entries: Option<Vec<Box<[u8]>>>,
}

struct DiskIndex {
    entries: Option<StringHashMap<PackageInfo>>,
}

pub(crate) struct PmLicensesCommand;

impl PmLicensesCommand {
    pub(crate) fn exec(
        pm: &mut PackageManager,
        positionals: &[&[u8]],
        production: bool,
    ) -> crate::Result<()> {
        if positionals.len() > 1
            && !strings::eql_comptime(positionals[1], b"list")
            && !strings::eql_comptime(positionals[1], b"ls")
        {
            Output::err_generic("Unknown subcommand: {s}", (BStr::new(positionals[1]),));
            Global::exit(1);
        }

        let log_level = pm.options.log_level;
        let load = pm.load_lockfile_from_cwd::<true>();
        PackageManagerCommand::handle_load_lockfile_errors(&load, log_level);

        let json_output = pm.options.json_output;
        let root_id = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);
        let lockfile: &Lockfile = &pm.lockfile;

        let mut path = AutoAbsPath::init_top_level_dir();
        let top_len = path.len();
        let _ = path.append(b"node_modules");
        if !bun_sys::exists(path.slice()) {
            Output::err_generic("node_modules not found. Run \"bun install\" first", ());
            Global::exit(1);
        }
        path.set_length(top_len);

        let wanted =
            reachable_packages(lockfile, root_id, production, pm.options.cpu, pm.options.os);
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

        for pkg_id in 0..packages.len() {
            if !wanted[pkg_id] {
                continue;
            }
            let resolution = &pkg_resolution[pkg_id];
            if matches!(
                resolution.tag,
                ResolutionTag::Root | ResolutionTag::Workspace | ResolutionTag::Symlink
            ) {
                continue;
            }

            let mut version: Vec<u8> = Vec::new();
            let _ = write!(&mut version, "{}", resolution.fmt(buf, PathSep::Posix));
            let is_npm = resolution.tag == ResolutionTag::Npm;

            let mut info = match &locations[pkg_id] {
                Some(location) => {
                    let segments: [&[u8]; 2] = [location, b"package.json"];
                    read_package_info_at(&mut path, top_len, &segments, &mut log)
                }
                None => None,
            };

            if is_npm {
                info = info.filter(|info| match &info.version {
                    Some(installed) => installed[..] == version[..],
                    None => true,
                });
            }

            if info.is_none() {
                let store_entry: Option<Box<[u8]>> = store
                    .lookup(&mut path, top_len, pkg_names[pkg_id], resolution, buf)
                    .map(Into::into);
                if let Some(store_entry) = store_entry {
                    let segments: [&[u8]; 6] = [
                        b"node_modules",
                        b".bun",
                        &store_entry,
                        b"node_modules",
                        pkg_names[pkg_id].slice(buf),
                        b"package.json",
                    ];
                    info = read_package_info_at(&mut path, top_len, &segments, &mut log);
                }
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
                semver: is_npm.then(|| resolution.npm().version),
                homepage: info.homepage,
                author: info.author,
            });
        }

        if missing > 0 {
            Output::warn(format_args!(
                "omitted {} {} from the lockfile not found in node_modules",
                missing,
                if missing == 1 { "package" } else { "packages" },
            ));
        }

        entries.sort_by(|a, b| {
            sort_key(a)
                .cmp(&sort_key(b))
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
            print_text(&entries);
        }

        Output::flush();
        Ok(())
    }
}

fn sort_key(e: &Entry) -> (bool, &[u8], &[u8]) {
    (
        &e.license[..] == UNKNOWN_LICENSE,
        &e.license[..],
        &e.name[..],
    )
}

fn reachable_packages(
    lockfile: &Lockfile,
    root_id: PackageID,
    production: bool,
    cpu: Architecture,
    os: OperatingSystem,
) -> Vec<bool> {
    let packages = lockfile.packages.slice();
    let pkg_resolution = packages.items_resolution();
    let pkg_metas = packages.items_meta();
    let pkg_dependencies = packages.items_dependencies();
    let pkg_resolutions = packages.items_resolutions();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let len = packages.len();

    let mut marked = vec![false; len];
    if (root_id as usize) >= len {
        return marked;
    }
    marked[root_id as usize] = true;
    let mut work: Vec<PackageID> = vec![root_id];

    while let Some(pkg) = work.pop() {
        let skip_dev = production
            && matches!(
                pkg_resolution[pkg as usize].tag,
                ResolutionTag::Root | ResolutionTag::Workspace
            );
        let dep_slice = pkg_dependencies[pkg as usize].get(dependencies);
        let res_slice = pkg_resolutions[pkg as usize].get(resolutions);

        for (dep, &dep_pkg_id) in dep_slice.iter().zip(res_slice.iter()) {
            if (dep_pkg_id as usize) >= len {
                continue;
            }
            if skip_dev && dep.behavior.is_dev() {
                continue;
            }
            if pkg_metas[dep_pkg_id as usize].is_disabled(cpu, os) {
                continue;
            }
            if !marked[dep_pkg_id as usize] {
                marked[dep_pkg_id as usize] = true;
                work.push(dep_pkg_id);
            }
        }
    }

    marked
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
    let info = read_package_info(path.slice(), log);
    path.set_length(base_len);
    info
}

fn read_package_info(path: &[u8], log: &mut Log) -> Option<PackageInfo> {
    let contents = File::read_from(Fd::cwd(), path).ok()?;
    bun_ast::initialize_store_or_reset();
    let source = Source::init_path_string(path, contents.as_slice());
    Some(
        match JSON::parse_package_json_utf8(&source, log, crate::cli::cli_arena()) {
            Ok(json) => PackageInfo {
                name: string_field(&json, b"name"),
                version: string_field(&json, b"version"),
                license: license_of(&json),
                homepage: string_field(&json, b"homepage"),
                author: author_of(&json),
            },
            Err(_) => PackageInfo {
                name: None,
                version: None,
                license: UNKNOWN_LICENSE.into(),
                homepage: None,
                author: None,
            },
        },
    )
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
        if resolution.tag == ResolutionTag::Folder {
            let _ = write!(
                &mut key,
                "{}@file+{}",
                pkg_name.fmt_store_path(buf),
                resolution.fmt_store_path(buf)
            );
        } else {
            let _ = write!(
                &mut key,
                "{}@{}",
                pkg_name.fmt_store_path(buf),
                resolution.fmt_store_path(buf)
            );
        }

        let i = entries.partition_point(|e| &e[..] < &key[..]);
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
        let mut names: Vec<Box<[u8]>> = list_dir(path.slice())
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        path.set_length(top_len);
        names.sort_unstable();
        names
    }
}

fn list_dir(path: &[u8]) -> Vec<(Box<[u8]>, FileKind)> {
    let mut out: Vec<(Box<[u8]>, FileKind)> = Vec::new();
    let Ok(dir) = Dir::open(path) else {
        return out;
    };
    let mut iter = bun_sys::iterate_dir(dir.fd());
    while let Ok(Some(entry)) = iter.next() {
        out.push((entry.name.slice_u8().into(), entry.kind));
    }
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
        if let Some(info) = read_package_info_at(path, pkg_len, &[b"package.json"], log) {
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

fn print_text(entries: &[Entry]) {
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
        bun_core::prettyln!("<b>{}<r> <d>({})<r>", BStr::new(license), end - start);
        for (i, entry) in entries[start..end].iter().enumerate() {
            if start + i + 1 < end {
                bun_core::prettyln!(
                    "<d>├──<r> {}<d>@{}<r>",
                    BStr::new(&entry.name),
                    BStr::new(&entry.version)
                );
            } else {
                bun_core::prettyln!(
                    "<d>└──<r> {}<d>@{}<r>",
                    BStr::new(&entry.name),
                    BStr::new(&entry.version)
                );
            }
        }

        start = end;
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
            out.extend_from_slice(b",\n      \"versions\": [");
            let mut previous: Option<&[u8]> = None;
            for entry in &entries[group_start..group_end] {
                if previous == Some(&entry.version[..]) {
                    continue;
                }
                if previous.is_some() {
                    out.extend_from_slice(b", ");
                }
                json_string(&mut out, &entry.version);
                previous = Some(&entry.version[..]);
            }
            out.push(b']');
            let newest = &entries[group_end - 1];
            if let Some(homepage) = &newest.homepage {
                out.extend_from_slice(b",\n      \"homepage\": ");
                json_string(&mut out, homepage);
            }
            if let Some(author) = &newest.author {
                out.extend_from_slice(b",\n      \"author\": ");
                json_string(&mut out, author);
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
