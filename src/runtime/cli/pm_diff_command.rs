//! `bun pm diff` — show what changed between two versions of a package (or a package and a folder/tarball).

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::Write as _;

use bstr::BStr;
use bun_alloc::Arena as Bump;
use bun_archive::tar;
use bun_collections::VecExt as _;
use bun_core::MutableString;
use bun_core::fmt as bun_fmt;
use bun_core::strings;
use bun_core::{Global, Output, StackCheck, pretty, prettyln};
use bun_http as http;
use bun_install::dependency::{self, TagExt as _};
use bun_install::lockfile::LoadResult;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::lockfile::tree;
use bun_install::npm::{self, PackageManifest};
use bun_install::package_manager::options::Do;
use bun_install::package_manager::workspace_manifests::WorkspaceManifests;
use bun_install::{PackageManager, resolution};
use bun_sys::{Fd, dir_iterator as DirIterator};
use bun_threading::{Condvar, Guarded, ThreadPool, thread_pool};
use bun_url::URL;

use crate::cli::pm_diff_normalize as normalize;
use crate::cli::pm_diff_normalize::{Otherwise, Pair};
use crate::cli::pm_diff_semantic::Operation;
use crate::cli::pm_diff_semantic::{self as semantic, Op};

#[derive(Clone, Copy)]
pub(crate) struct DiffFlags {
    /// Compare bytes, not the canonical re-print of JS/CSS/JSON.
    pub raw: bool,
    /// One JSON document instead of text.
    pub json: bool,
    /// Lockstep-rename short locals in every JS file, not only ones that look minified.
    pub unminify: bool,
    /// Fold equivalent syntax as well as layout.
    pub minify: bool,
    /// Files differing only in whitespace count as unchanged.
    pub ignore_space: bool,
    pub name_only: bool,
    pub stat: bool,
    pub context: usize,
}

/// One side of the comparison, as the user wrote it.
enum Spec {
    Registry { name: Vec<u8>, version: Vec<u8> },
    Dir(Vec<u8>),
    Tarball(Vec<u8>),
}

/// A materialized side: every file's contents by relative path.
struct Tree {
    label: Vec<u8>,
    files: BTreeMap<Vec<u8>, Vec<u8>>,
    /// Permission bits per path (0o755…), when the source records them.
    modes: BTreeMap<Vec<u8>, u32>,
    /// The registry manifest's entry for this version, as JSON. `None` unless this side came from a
    /// registry.
    registry_entry: Option<Vec<u8>>,
    /// The tarball that holds the files, until `unpack` has read it.
    packed: Option<Vec<u8>>,
}

/// `original_cwd` is the folder the user ran the command from; inside a workspace the manager has since `chdir`ed
/// to its root, so relative paths and the no-argument form resolve against it.
pub(crate) fn exec(
    pm: &mut PackageManager,
    positionals: &[&[u8]],
    diff_args: &[&[u8]],
    flags: DiffFlags,
    original_cwd: &[u8],
) -> Result<(), crate::Error> {
    // `:path` (alone, or as a suffix on a registry spec) and anything after the two sides narrow the diff to files.
    let mut filters: Vec<Vec<u8>> = Vec::new();
    let mut typed: Vec<&[u8]> = Vec::new();
    for &arg in diff_args.iter().chain(positionals.iter().skip(1)) {
        if let Some(only) = arg.strip_prefix(b":") {
            filters.push(only.to_vec());
        } else if typed.len() == 2 {
            filters.push(arg.to_vec());
        } else if let Some((spec, only)) = split_filter(arg) {
            typed.push(spec);
            filters.push(only.to_vec());
        } else {
            typed.push(arg);
        }
    }
    filters.retain(|f| !f.is_empty());
    let args: Vec<Vec<u8>> = typed
        .iter()
        .map(|&arg| {
            use bun_paths::Path;
            let home = bun_core::env_var::HOME.get_not_empty();
            let (base, typed) = match (arg.strip_prefix(b"~/"), home) {
                (Some(rest), Some(home)) => (Path::resolve(&[original_cwd, home]), rest),
                _ if looks_like_path(arg) && !bun_paths::is_absolute(arg) => {
                    (Path::from(original_cwd), arg)
                }
                _ => return arg.to_vec(),
            };
            let spelling = bun_sys::typed_spelling(&base, typed, bun_paths::from_portable);
            let mut path = Path::resolve(&[&base, &spelling]);
            // The trailing separator is what tells a directory named `lib.tgz/` from a tarball.
            path.copy_trailing_sep_from(arg);
            path.to_vec()
        })
        .collect();

    let (mut left_spec, mut right_spec) = resolve_sides(pm, &args, original_cwd);
    // Two folders are compared as written, because the patch between them has to apply to the files
    // on disk.
    let as_published = !matches!((&left_spec, &right_spec), (Spec::Dir(_), Spec::Dir(_)));
    // `bun pm diff ./pkg` / `./pkg 2.0.0`: a registry side without a name takes it from the local side's package.json.
    let mut left_early: Option<Tree> = None;
    if let (Spec::Dir(_) | Spec::Tarball(_), Spec::Registry { name, .. }) =
        (&left_spec, &mut right_spec)
    {
        if name.is_empty() {
            let mut local = materialize(pm, &left_spec, as_published)?;
            local.unpack().map_err(Unreadable::report)?;
            *name = package_name_in(&local);
            left_early = Some(local);
        }
    }
    let mut right = materialize(pm, &right_spec, as_published)?;
    if let Spec::Registry { name, .. } = &mut left_spec {
        if name.is_empty() {
            right.unpack().map_err(Unreadable::report)?;
            *name = package_name_in(&right);
        }
    }
    let mut left = match left_early {
        Some(tree) => tree,
        None => materialize(pm, &left_spec, as_published)?,
    };
    let threads = Threads::with_stack_of_this_one();
    let packed = |tree: &Tree| tree.packed.as_ref().map_or(0, Vec::len);
    let (unpacked_right, unpacked_left) = threads.join(
        packed(&right).min(packed(&left)),
        || right.unpack(),
        || left.unpack(),
    );
    unpacked_right
        .and(unpacked_left)
        .map_err(Unreadable::report)?;
    // Show local paths the way they were typed, not as resolved against the invoking folder.
    for (tree, spec) in [(&mut left, &left_spec), (&mut right, &right_spec)] {
        if let Spec::Dir(p) | Spec::Tarball(p) = spec {
            match args.iter().position(|a| a == p) {
                Some(i) => tree.label = typed[i].to_vec(),
                None if args.is_empty() => tree.label = b".".to_vec(),
                None => {}
            }
        }
    }
    if !filters.is_empty() {
        let (before_l, before_r) = (left.files.len(), right.files.len());
        let prepared: Vec<Filter<'_>> = filters.iter().map(|it| Filter::new(it)).collect();
        for tree in [&mut left, &mut right] {
            tree.files
                .retain(|path, _| prepared.iter().any(|f| f.matches(path)));
            tree.modes
                .retain(|path, _| prepared.iter().any(|f| f.matches(path)));
        }
        if left.files.is_empty() && right.files.is_empty() && before_l + before_r > 0 {
            Status::clear();
            Output::err_generic(
                "no file in either side matches {}",
                (BStr::new(&filters.join(&b", "[..])),),
            );
            Global::exit(1);
        }
    }
    print_diff(&left, &right, flags, threads);
    Output::flush();
    Ok(())
}

/// `name@1.2.3:lib/x.js` → (`name@1.2.3`, `lib/x.js`). Paths, URLs and drive letters keep their colons.
fn split_filter(arg: &[u8]) -> Option<(&[u8], &[u8])> {
    if looks_like_path(arg)
        || strings::contains(arg, b"://")
        || strings::has_prefix_comptime(arg, b"file:")
        || strings::has_prefix_comptime(arg, b"npm:")
    {
        return None;
    }
    let at = strings::index_of_char(arg, b':')? as usize;
    (at > 0).then(|| (&arg[..at], &arg[at + 1..]))
}

/// A filter names a file exactly, a directory (prefix), a bare file name anywhere in the package, or a glob.
struct Filter<'a> {
    glob: bun_glob::Prepared<&'a [u8]>,
    is_glob: bool,
}

impl<'a> Filter<'a> {
    fn new(filter: &'a [u8]) -> Filter<'a> {
        let filter = filter.strip_prefix(b"./").unwrap_or(filter);
        let filter = filter.strip_suffix(b"/").unwrap_or(filter);
        Filter {
            glob: bun_glob::Prepared::new(filter),
            is_glob: strings::index_of_any(filter, b"*?[{").is_some()
                || bun_glob::has_extglob_prefix(filter),
        }
    }

    fn matches(&self, path: &[u8]) -> bool {
        let filter = self.glob.pattern();
        if path == filter
            || (path.len() > filter.len() && path.starts_with(filter) && path[filter.len()] == b'/')
        {
            return true;
        }
        if self.is_glob {
            return self.glob.r#match(path).matches()
                || (!strings::contains_char(filter, b'/')
                    && self.glob.r#match(bun_paths::basename(path)).matches());
        }
        !strings::contains_char(filter, b'/') && bun_paths::basename(path) == filter
    }
}

fn looks_like_path(spec: &[u8]) -> bool {
    spec.starts_with(b".") || spec.starts_with(b"~/") || bun_paths::is_absolute(spec)
}

fn classify(spec: &[u8]) -> Spec {
    if looks_like_path(spec) {
        if strings::ends_with(spec, b".tgz")
            || strings::ends_with(spec, b".tar.gz")
            || strings::ends_with(spec, b".tar")
        {
            return Spec::Tarball(spec.to_vec());
        }
        return Spec::Dir(spec.to_vec());
    }
    let (name, version) = dependency::split_name_and_version_or_latest(spec);
    // Distinguish "no version given" from an explicit `@latest`.
    let explicit = spec.len() > name.len();
    Spec::Registry {
        name: name.to_vec(),
        version: if explicit {
            version.to_vec()
        } else {
            Vec::new()
        },
    }
}

/// Turns 0, 1 or 2 user arguments into the two sides to compare.
fn resolve_sides(pm: &mut PackageManager, args: &[Vec<u8>], original_cwd: &[u8]) -> (Spec, Spec) {
    let registry = |name: &[u8], version: &[u8]| Spec::Registry {
        name: name.to_vec(),
        version: version.to_vec(),
    };
    match args {
        // In a package folder: what is published under this name → the folder.
        [] => (
            registry(&root_package_name(pm, original_cwd), b"latest"),
            Spec::Dir(original_cwd.to_vec()),
        ),
        [one] => match classify(one) {
            Spec::Registry { name, version } => {
                // `name@a..b`
                if let Some(dots) = strings::index_of(&version, b"..") {
                    return (
                        registry(&name, &version[..dots]),
                        registry(&name, &version[dots + 2..]),
                    );
                }
                // `name` / `name@b`: the version this project has installed → b (default: latest).
                let Some((name, installed)) = installed_version(pm, &name) else {
                    Status::clear();
                    Output::err_generic(
                        "{} is not in this project's lockfile; give two versions to compare, e.g. `bun pm diff {}@1.0.0 {}@2.0.0`",
                        (BStr::new(&name), BStr::new(&name), BStr::new(&name)),
                    );
                    Global::exit(1);
                };
                let target = if version.is_empty() {
                    b"latest".to_vec()
                } else {
                    version
                };
                (
                    Spec::Registry {
                        name: name.clone(),
                        version: installed,
                    },
                    Spec::Registry {
                        name,
                        version: target,
                    },
                )
            }
            // A folder or tarball on its own: what is published under *its* package.json name → it (named once unpacked).
            local => (registry(b"", b"latest"), local),
        },
        [a, b] => {
            let mut left = classify(a);
            // `name 2`: as with a single argument, a bare name on the left means the installed
            // version of that package, if there is one.
            if let Spec::Registry { name, version } = &mut left
                && version.is_empty()
                && let Some(installed) = installed_version(pm, name)
            {
                (*name, *version) = installed;
            }
            // Matches `2`, `^2`, `>=2 <4` and `latest`: what package.json would read as a version
            // or range. Other dist-tags do not match, because a word like `next` is also a package.
            let is_bare_version = |s: &Spec| matches!(s, Spec::Registry { name, version } if version.is_empty() && (dependency::Tag::infer(name) == dependency::Tag::Npm || name == b"latest"));
            let right = match (classify(b), &left) {
                // `name@1 2` — a bare second version reuses the first name.
                (r, Spec::Registry { name, .. }) if is_bare_version(&r) => {
                    let Spec::Registry { name: bare, .. } = r else {
                        unreachable!()
                    };
                    Spec::Registry {
                        name: name.clone(),
                        version: bare,
                    }
                }
                // `./pkg 2` — after a folder/tarball, that package's own name (filled in once unpacked).
                (r, Spec::Dir(_) | Spec::Tarball(_)) if is_bare_version(&r) => {
                    let Spec::Registry { name: bare, .. } = r else {
                        unreachable!()
                    };
                    Spec::Registry {
                        name: Vec::new(),
                        version: bare,
                    }
                }
                (other, _) => other,
            };
            (left, right)
        }
        _ => unreachable!(),
    }
}

fn package_name_in(tree: &Tree) -> Vec<u8> {
    let package_json = tree.files.get(b"package.json".as_slice());
    package_json
        .and_then(|bytes| package_json_name(bytes))
        .unwrap_or_else(|| {
            Status::clear();
            Output::err_generic(
                "{} has no package.json \"name\" to look up in the registry",
                (BStr::new(&tree.label),),
            );
            Global::exit(1);
        })
}

fn package_json_name(bytes: &[u8]) -> Option<Vec<u8>> {
    let bump = Bump::new();
    let src: &[u8] = bump.alloc_slice_copy(bytes);
    let json = bun_parsers::json::parse_utf8(
        &bun_ast::Source::init_path_string(b"package.json", src),
        &mut bun_ast::Log::init(),
        &bump,
    )
    .ok()?;
    let name = json.get_string_cloned(&bump, b"name").ok().flatten()?;
    is_npm_name(name).then(|| name.to_vec())
}

/// npm's package-name grammar (lowercase URL-safe, optional `@scope/`), so nothing else from a package.json is
/// ever printed as a name or sent to a registry.
fn is_npm_name(name: &[u8]) -> bool {
    let ok_part = |p: &[u8]| {
        !p.is_empty()
            && p.len() <= 214
            && !p.starts_with(b".")
            && !p.starts_with(b"_")
            && p.iter().all(|&b| {
                b.is_ascii_lowercase()
                    || b.is_ascii_digit()
                    || matches!(b, b'-' | b'.' | b'_' | b'~')
            })
    };
    match name.strip_prefix(b"@") {
        Some(rest) => {
            let Some(slash) = strings::index_of_char(rest, b'/') else {
                return false;
            };
            let slash = slash as usize;
            ok_part(&rest[..slash]) && ok_part(&rest[slash + 1..])
        }
        None => ok_part(name),
    }
}

fn root_package_name(pm: &PackageManager, original_cwd: &[u8]) -> Vec<u8> {
    let path = bun_paths::Path::from_parts(&[original_cwd, b"package.json"]);
    // The folder we are in, before the workspace root the manager walked up to.
    if let Ok(bytes) = bun_sys::File::read_from(Fd::cwd(), &path)
        && let Some(name) = package_json_name(&bytes)
    {
        return name;
    }
    let name = &pm.root_package_json_name_at_time_of_init;
    if !is_npm_name(name) {
        Status::clear();
        Output::err_generic(
            "no package name to compare against: run this inside a package, or pass two specs (e.g. `bun pm diff react@18.0.0 react@19.0.0`)",
            (),
        );
        Global::exit(1);
    }
    name.to_vec()
}

/// Returns the npm package that `name` refers to in the folder the command was run in, and the
/// version the lockfile resolved for it. `name` may be an alias of that package.
fn installed_version(pm: &mut PackageManager, name: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    // Detach the lockfile while it loads so it and the manager are not borrowed through each other.
    let mut lockfile = core::mem::take(&mut pm.lockfile);
    let mut log = bun_ast::Log::init();
    let log_level = pm.options.log_level;
    let loaded = match lockfile.load_from_cwd::<true>(Some(pm), &mut log) {
        LoadResult::Ok(_) => true,
        LoadResult::NotFound => false,
        // A lockfile that exists but will not load is reported as that, not as "package not installed".
        broken @ LoadResult::Err(_) => {
            let _ = log.print(Output::error_writer());
            crate::cli::package_manager_command::PackageManagerCommand::handle_load_lockfile_errors_for(
                &broken, log_level, "",
            );
            false
        }
    };
    pm.lockfile = lockfile;
    if !loaded {
        return None;
    }
    let member = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);
    let lockfile = &*pm.lockfile;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let resolutions = lockfile.packages.items_resolution();
    // Several copies may be installed, so search in the order `require(name)` would: first the
    // dependencies of the package the command was run in, then the root node_modules.
    let own = lockfile.packages.items_dependencies().get(member as usize);
    let mut folders = tree::Iterator::<{ tree::IteratorPathStyle::NodeModules }>::init(lockfile);
    let hoisted = folders
        .next(None)
        .map(|root| root.dependencies)
        .unwrap_or_default();
    let by_installed_name = own
        .map_or(0..0, |own| own.begin()..own.end())
        .chain(hoisted.iter().copied())
        .filter(|&dep| {
            lockfile.buffers.dependencies[dep as usize]
                .name
                .slice(string_buf)
                == name
        })
        .map(|dep| lockfile.buffers.resolutions[dep as usize] as usize);
    // Fall back to a copy that is nested deeper, or that is only installed under an alias.
    let by_own_name = (0..names.len()).filter(|&id| names[id].slice(string_buf) == name);
    let found = by_installed_name.chain(by_own_name).find(|&id| {
        resolutions
            .get(id)
            .is_some_and(|resolved| resolved.tag == resolution::Tag::Npm)
    })?;
    let version = resolutions[found].npm().version;
    Some((
        names[found].slice(string_buf).to_vec(),
        version.fmt(string_buf).to_string().into_bytes(),
    ))
}

/// A one-line status on stderr while a side is fetched or read, erased before anything else prints — so a large
/// package or a slow registry never looks like a hang. Only when stderr is an interactive terminal.
struct Status;
static STATUS_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
impl Status {
    fn show(what: &str, label: &[u8]) -> Option<Status> {
        if !Output::is_stderr_tty() || !Output::enable_ansi_colors_stderr() {
            return None;
        }
        Output::print_error(format_args!(
            "\x1b[2m{what} {}…\x1b[0m\r",
            BStr::new(&defang(label))
        ));
        Output::flush();
        STATUS_SHOWN.store(true, std::sync::atomic::Ordering::Relaxed);
        Some(Status)
    }
    /// Erase the line; also called before a fatal error, since `Global::exit` never runs `Drop`.
    fn clear() {
        if STATUS_SHOWN.swap(false, std::sync::atomic::Ordering::Relaxed) {
            Output::print_error(format_args!("\x1b[2K\r"));
            Output::flush();
        }
    }
}
impl Drop for Status {
    fn drop(&mut self) {
        Status::clear();
    }
}

fn materialize(
    pm: &mut PackageManager,
    spec: &Spec,
    as_published: bool,
) -> Result<Tree, crate::Error> {
    let _status = match spec {
        Spec::Registry { name, version } => {
            Status::show("fetching", &[&name[..], b"@", &version[..]].concat())
        }
        Spec::Tarball(path) | Spec::Dir(path) => Status::show("reading", path),
    };
    match spec {
        Spec::Registry { name, version } => fetch_registry_tree(pm, name, version),
        Spec::Tarball(path) => {
            let bytes = match bun_sys::File::read_from(Fd::cwd(), path) {
                Ok(b) => b,
                Err(err) => {
                    Status::clear();
                    Output::err(err, "failed to read {}", (BStr::new(path),));
                    Global::exit(1);
                }
            };
            Ok(Tree {
                label: path.clone(),
                files: BTreeMap::new(),
                modes: BTreeMap::new(),
                registry_entry: None,
                packed: Some(bytes),
            })
        }
        Spec::Dir(path) => read_dir_tree(path, as_published.then_some(pm)),
    }
}

/// Why a tarball was not unpacked. The main thread reports it, so that timing does not pick one of two errors.
enum Unreadable {
    Damaged(String),
    Alloc(bun_alloc::AllocError),
}

impl Unreadable {
    fn report(self) -> crate::Error {
        match self {
            Unreadable::Damaged(message) => {
                Status::clear();
                Output::err_generic("{}", (message.as_str(),));
                Global::exit(1);
            }
            Unreadable::Alloc(err) => err.into(),
        }
    }
}

impl Tree {
    fn unpack(&mut self) -> Result<(), Unreadable> {
        match self.packed.take() {
            Some(bytes) => read_tarball_into(&bytes, self),
            None => Ok(()),
        }
    }
}

fn read_tarball_into(bytes: &[u8], tree: &mut Tree) -> Result<(), Unreadable> {
    let fail = |err: tar::Error, message: core::fmt::Arguments<'_>| match err {
        tar::Error::Alloc(err) => Unreadable::Alloc(err),
        _ => Unreadable::Damaged(format!("{}: {message}", BStr::new(&tree.label))),
    };
    let mut reader = bun_archive::open_memory(bytes, tar::Dialect::Npm)
        .map_err(|err| fail(err, format_args!("failed to read tarball")))?;
    while let Some(entry) = reader
        .next_entry()
        .map_err(|err| fail(err, format_args!("failed to read archive header")))?
    {
        if entry.kind() != bun_sys::FileKind::File {
            continue;
        }
        let perm = (entry.perm() & 0o777) as bun_sys::Mode;
        let size = usize::try_from(entry.size().max(0)).expect("int cast");
        let rel = bun_paths::Path::from(&bun_archive::normalize_npm_entry_path(entry));
        if rel.is_empty() {
            continue;
        }
        let rel = rel.into_portable().to_vec();
        let mut data = Vec::new();
        // The header can claim any size.
        (data.try_reserve_exact(size.min(bytes.len())))
            .map_err(|_| Unreadable::Alloc(bun_alloc::AllocError))?;
        reader.read_data(size, &mut data).map_err(|err| {
            let rel = BStr::new(&rel);
            fail(err, format_args!("{rel}: failed to read archive data"))
        })?;
        tree.modes.insert(rel.clone(), perm);
        tree.files.insert(rel, data);
    }
    Ok(())
}

/// With `as_published_by`, `workspace:` and `catalog:` versions read as `bun pm pack` publishes them.
fn read_dir_tree(
    root: &[u8],
    as_published_by: Option<&mut PackageManager>,
) -> Result<Tree, crate::Error> {
    let mut tree = Tree {
        label: root.to_vec(),
        files: BTreeMap::new(),
        modes: BTreeMap::new(),
        registry_entry: None,
        packed: None,
    };
    let root_dir = match bun_sys::Dir::open(root) {
        Ok(dir) => dir,
        Err(err) => {
            Status::clear();
            Output::err(err, "failed to open {}", (BStr::new(root),));
            Global::exit(1);
        }
    };
    // A tree with holes would report those files as deleted, so any read failure is fatal.
    let fail = |err: bun_sys::Error, rel: &[u8]| -> ! {
        Status::clear();
        Output::err(
            err,
            "failed to read {}/{}",
            (BStr::new(root), BStr::new(rel)),
        );
        Global::exit(1);
    };
    // A package (has a package.json) is read as `bun pm pack` would publish it: `files`, .npmignore/.gitignore,
    // bins — not the whole checkout with its vendor/ and build/.
    'package: {
        if let Ok(pkg) = bun_sys::File::read_from(&root_dir, b"package.json") {
            // This has to come before the parse below, because it parses other package.json files.
            let manifests = as_published_by.and_then(|pm| manifests_for(pm, root, &pkg));
            let bump = Bump::new();
            let src: &[u8] = bump.alloc_slice_copy(&pkg);
            if let Ok(json) = bun_parsers::json::parse_utf8(
                &bun_ast::Source::init_path_string(b"package.json", src),
                &mut bun_ast::Log::init(),
                &bump,
            ) {
                crate::cli::pack_command::drop_shadowed_properties(json);
                // pack crashes on a malformed `files`; here that just means "not a package we understand": full walk.
                let files_ok = json.get(b"files").is_none_or(|f| {
                    f.as_array().is_some_and(|mut a| {
                        let mut ok = true;
                        while let Some(e) = a.next() {
                            ok &= e.as_string(&bump).is_some();
                        }
                        ok
                    })
                });
                if !files_ok {
                    break 'package;
                }
                // pack's own error paths crash without unwinding: no status line to print over.
                Status::clear();
                let (queue, _bins) = crate::cli::pack_command::published_files(
                    &root_dir,
                    root,
                    &json,
                    &bump,
                    bun_install::package_manager::LogLevel::Silent,
                )?;
                for path in queue.into_paths() {
                    let rel = path.as_bytes();
                    match bun_sys::File::read_from(&root_dir, rel) {
                        Ok(bytes) => {
                            #[cfg(not(windows))]
                            if let Ok(st) = bun_sys::fstatat(&root_dir, path.as_zstr()) {
                                tree.modes.insert(rel.to_vec(), st.st_mode as u32 & 0o777);
                            }
                            tree.files.insert(rel.to_vec(), bytes);
                        }
                        Err(err) => fail(err, rel),
                    }
                }
                let pkg = match &manifests {
                    Some(manifests) => with_published_versions(&pkg, json, manifests, root),
                    None => pkg,
                };
                tree.files.insert(b"package.json".to_vec(), pkg);
                return Ok(tree);
            }
        }
    }
    let mut stack = vec![(root_dir, Vec::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let mut it = DirIterator::iterate_owned(dir);
        let dir = it.dir();
        loop {
            let entry = match it.next() {
                Ok(Some(entry)) => entry,
                Ok(None) => break,
                Err(err) => fail(err, &prefix),
            };
            let name = entry.name.slice_u8();
            if name == b"node_modules" || name == b".git" {
                continue;
            }
            let mut rel = prefix.clone();
            if !rel.is_empty() {
                rel.push(b'/');
            }
            rel.extend_from_slice(name);
            // Some filesystems leave d_type blank: ask lstat what the entry itself is first.
            #[cfg(not(windows))]
            let own_kind = match entry.kind {
                bun_sys::FileKind::Unknown => match bun_sys::lstatat(dir, entry.name.as_zstr()) {
                    Ok(st) => bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode),
                    Err(err) => fail(err, &rel),
                },
                k => k,
            };
            #[cfg(windows)]
            let own_kind = entry.kind;
            // A symlink is read through to a file; a dangling one has nothing to show and a linked folder could loop.
            #[cfg(not(windows))]
            let kind = if own_kind == bun_sys::FileKind::SymLink {
                match bun_sys::fstatat(dir, entry.name.as_zstr()) {
                    Ok(st) => bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode),
                    Err(_) => continue,
                }
            } else {
                own_kind
            };
            #[cfg(windows)]
            let kind = own_kind;
            match kind {
                bun_sys::FileKind::Directory if own_kind == bun_sys::FileKind::SymLink => {}
                bun_sys::FileKind::Directory => match bun_sys::open_dir_at(dir, name) {
                    Ok(sub) => stack.push((bun_sys::Dir::from_fd(sub), rel)),
                    Err(err) => fail(err, &rel),
                },
                bun_sys::FileKind::File => match bun_sys::File::read_from(dir, name) {
                    Ok(bytes) => {
                        #[cfg(not(windows))]
                        if let Ok(st) = bun_sys::fstatat(dir, entry.name.as_zstr()) {
                            tree.modes.insert(rel.clone(), st.st_mode as u32 & 0o777);
                        }
                        tree.files.insert(rel, bytes);
                    }
                    Err(err) => fail(err, &rel),
                },
                // Windows always reports d_type; a symlink is read through (a linked folder just fails the read).
                #[cfg(windows)]
                bun_sys::FileKind::SymLink => match bun_sys::File::read_from(dir, name) {
                    Ok(bytes) => {
                        tree.files.insert(rel, bytes);
                    }
                    Err(err)
                        if matches!(err.get_errno(), bun_sys::E::EISDIR | bun_sys::E::ENOENT) => {}
                    Err(err) => fail(err, &rel),
                },
                _ => {}
            }
        }
    }
    Ok(tree)
}

/// Returns the manifests that `bun pm pack` in `dir` would use to resolve the `workspace:` and
/// `catalog:` specifiers in `manifest`.
fn manifests_for(
    pm: &mut PackageManager,
    dir: &[u8],
    manifest: &[u8],
) -> Option<WorkspaceManifests> {
    if !strings::contains(manifest, b"workspace:") && !strings::contains(manifest, b"catalog:") {
        return None;
    }
    // The manager is in the project's root. Run outside of a project, there is no package.json to load.
    if !bun_sys::exists_z(bun_core::zstr!("package.json")) {
        return None;
    }
    WorkspaceManifests::try_load(pm)
        .ok()
        .filter(|manifests| manifests.contains_package_dir(dir))
}

/// `manifest` (`dir`'s package.json, parsed as `json`) with its `workspace:` and `catalog:` versions as published.
fn with_published_versions(
    manifest: &[u8],
    json: bun_ast::Expr,
    manifests: &WorkspaceManifests,
    dir: &[u8],
) -> Vec<u8> {
    use crate::cli::pack_command::{Substitution, for_each_dependency};
    // The string token of each version to replace (its start and end in `manifest`), and what replaces it.
    let mut edits: Vec<(usize, usize, Vec<u8>)> = Vec::new();
    for_each_dependency(json, |_, dependency| {
        let (Some(name), Some(version)) = (&dependency.key, &dependency.value) else {
            return;
        };
        let (Some(name), Some(spec)) = (
            name.as_utf8_string_literal(),
            version.as_utf8_string_literal(),
        ) else {
            return;
        };
        // A version that doesn't resolve is left as written. pack would refuse to publish it.
        let Some(Ok(published)) =
            Substitution::for_spec(spec).map(|found| found.published(manifests, dir, name))
        else {
            return;
        };
        // So does one spelled with JSON escapes.
        let Ok(at) = usize::try_from(version.loc.start) else {
            return;
        };
        let end = at + spec.len() + 2;
        if manifest.get(at + 1..end - 1) == Some(spec) {
            edits.push((at, end, published));
        }
    });
    bun_collections::index_sort::sort_vec_unstable_by(&mut edits, |a, b| a.0.cmp(&b.0));
    let mut out: Vec<u8> = Vec::with_capacity(manifest.len());
    let mut copied = 0usize;
    for (at, end, published) in &edits {
        out.extend_from_slice(&manifest[copied..*at]);
        let _ = write!(
            out,
            "{}",
            bun_fmt::format_json_string_utf8(published, Default::default())
        );
        copied = *end;
    }
    out.extend_from_slice(&manifest[copied..]);
    out
}

/// Fetches `name`'s manifest, resolves `version` (exact, range, or dist-tag), downloads that tarball and unpacks it in memory.
fn fetch_registry_tree(
    pm: &mut PackageManager,
    name: &[u8],
    version: &[u8],
) -> Result<Tree, crate::Error> {
    let bump = Bump::new();
    let scope = pm.scope_for_package_name(name);

    let manifest_url = format!(
        "{}/{}",
        BStr::new(strings::without_trailing_slash(scope.url.href())),
        bun_fmt::dependency_url(name),
    );
    let body = registry_get(
        pm,
        scope,
        URL::parse(manifest_url.as_bytes()),
        true,
        // The abbreviated packument has versions + dist, all this needs; full ones run to tens of MB.
        Some(b"application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*"),
        Some((name, version)),
    )?;

    let mut log = bun_ast::Log::init();
    let manifest = match PackageManifest::parse(
        scope.manifest_cache_key(),
        &mut log,
        body.list.as_slice(),
        name,
        b"",
        b"",
        0,
        true,
    ) {
        Ok(Some(m)) => m,
        Ok(None) => {
            Status::clear();
            Output::err_generic(
                "failed to parse the registry manifest for {}",
                (BStr::new(name),),
            );
            Global::exit(1);
        }
        Err(err) => {
            Status::clear();
            Output::err(
                err,
                "failed to parse the registry manifest for {}",
                (BStr::new(name),),
            );
            Global::exit(1);
        }
    };

    let version = if version.is_empty() {
        b"latest".as_slice()
    } else {
        version
    };
    let found = 'found: {
        match manifest.find_by_spec(version) {
            Ok(r) => break 'found r,
            Err(bun_install::Error::DistTagNotFound | bun_install::Error::NoMatchingVersion) => {}
            Err(err) => return Err(err.into()),
        }
        Status::clear();
        Output::err_generic(
            "no version of {} matches {}",
            (BStr::new(name), BStr::new(version)),
        );
        // What is there instead: the newest releases and the dist-tags.
        let recent: Vec<String> = manifest
            .release_versions()
            .iter()
            .rev()
            .take(5)
            .map(|v| v.fmt(&manifest.string_buf).to_string())
            .collect();
        if !recent.is_empty() {
            bun_core::pretty_errorln!("<d>recent versions:<r> {}", recent.join(", "));
        }
        let tags: Vec<String> = manifest
            .dist_tags()
            .map(|(t, v)| format!("{}: {}", BStr::new(&defang(t)), v.fmt(&manifest.string_buf)))
            .collect();
        if !tags.is_empty() {
            bun_core::pretty_errorln!("<d>tags:<r> {}", tags.join(", "));
        }
        Global::exit(1);
    };

    let mut label = Vec::new();
    let _ = write!(
        &mut label,
        "{}@{}",
        BStr::new(name),
        found.version.fmt(&manifest.string_buf)
    );

    // The version keys are parsed the way `PackageManifest::parse` parses them, so this finds the
    // same entry that `found` was built from.
    let registry_entry = bun_parsers::json::parse_utf8(
        &bun_ast::Source::init_path_string(b"", body.list.as_slice()),
        &mut bun_ast::Log::init(),
        &bump,
    )
    .ok()
    .and_then(|document| document.get_object(b"versions"))
    .and_then(|versions| {
        let versions = versions.data.e_object()?;
        versions.properties.slice().iter().find_map(|entry| {
            let key = entry.key.as_ref()?.as_string(&bump)?;
            let parsed = bun_semver::Version::parse(bun_semver::SlicedString::init(key, key));
            if !parsed.valid || !parsed.version.min().eql(found.version) {
                return None;
            }
            Some(json_text(entry.value.as_ref()?, true))
        })
    });

    let mut tarball_url: Vec<u8> = found.tarball_url(&manifest);
    if tarball_url.is_empty() {
        tarball_url = bun_install::extract_tarball::build_url_with_printer(
            scope.url.href(),
            name,
            found.version,
            &manifest.string_buf,
            |args| -> Result<Vec<u8>, bun_alloc::AllocError> {
                let mut v = Vec::new();
                let _ = v.write_fmt(args);
                Ok(v)
            },
        )?;
    }
    // The same serialisation `bun install` requests and keys `.npmrc` lines by.
    let (tarball_url, normalized) = match npm::registry::normalize_tarball_url(&tarball_url) {
        Some(normalized) => (normalized, true),
        None => (tarball_url.into_boxed_slice(), false),
    };
    let tarball = registry_get(pm, scope, URL::parse(&tarball_url), normalized, None, None)?;
    if pm.options.do_.contains(Do::VERIFY_INTEGRITY) {
        let locked = pm.lockfile.npm_integrity(name, found.version);
        for expected in [Some(found.integrity()), locked].into_iter().flatten() {
            if expected.tag.is_supported() && !expected.verify(tarball.list.as_slice()) {
                Status::clear();
                Output::err_generic(
                    "Integrity check failed for tarball: {}",
                    (BStr::new(&defang(&label)),),
                );
                Global::exit(1);
            }
        }
    }

    Ok(Tree {
        label,
        files: BTreeMap::new(),
        modes: BTreeMap::new(),
        registry_entry,
        packed: Some(tarball.list),
    })
}

fn registry_get(
    pm: &PackageManager,
    scope: &npm::registry::Scope,
    url: URL<'_>,
    normalized: bool,
    // `None` sends the HTTP client's default `Accept` header, as `bun install` does for a tarball.
    accept: Option<&[u8]>,
    for_error: Option<(&[u8], &[u8])>,
) -> Result<MutableString, crate::Error> {
    let mut headers = http::HeaderBuilder::default();
    if let Some(accept) = accept {
        headers.count(b"Accept", accept);
    }
    // The same rule as `bun install` decides which credentials, if any, follow the URL.
    let authorization = pm
        .options
        .tarball_credentials(scope, &url, normalized)
        .and_then(|credentials| credentials.authorization_parts(&url));
    if let Some((scheme, value)) = authorization {
        headers.count(b"Authorization", b"");
        headers.content.cap += scheme.len() + value.len();
        headers.count(b"npm-auth-type", b"legacy");
    }
    headers.allocate()?;
    if let Some(accept) = accept {
        headers.append(b"Accept", accept);
    }
    // Raw-byte append: a non-UTF-8 token through Display would grow past the reserved count.
    if let Some((scheme, value)) = authorization {
        headers.append_bytes_value(b"Authorization", scheme, value);
        headers.append(b"npm-auth-type", b"legacy");
    }

    let mut response_buf = MutableString::init(64 * 1024)?;
    let display_url = url.href;
    let req = pm.registry_request(
        http::Method::GET,
        url,
        headers.entries,
        headers.content.written_slice(),
        b"",
    );
    let res = match pm.send_with_retries(req, &mut response_buf) {
        Ok(r) => r,
        Err(err) => {
            Status::clear();
            let url = bun_core::fmt::redacted_npm_url(display_url);
            Output::err(
                err,
                "GET {} failed",
                (bun_core::fmt::EscapeControlChars(url),),
            );
            Global::exit(1);
        }
    };
    if res.status_code() >= 400 {
        Status::clear();
        npm::response_error::<false>(display_url, &res, for_error, &mut response_buf)?;
    }
    Ok(response_buf)
}

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum Semantic {
    #[default]
    Text,
    /// Both sides parse and print identically: whitespace/quotes/semicolons only.
    FormattingOnly,
    /// Hunks were computed on the canonical re-print (gutter shows original lines when known).
    Normalized,
    /// JSON / CSS shown as their canonical print (no source map to project through).
    Reprinted,
    /// `-w`: the bytes differ but not once runs of whitespace are collapsed.
    WhitespaceOnly,
    /// CRLF ↔ LF and nothing else.
    LineEndingsOnly,
    /// Same bytes, different permission bits.
    ModeOnly,
    /// Original lines shown, but what counts as a change was decided on the canonical form; `hidden` textual
    /// differences were folded away as equivalent.
    Projected,
}

#[derive(Default)]
struct FileChange<'a> {
    path: &'a [u8],
    highlight: bool,
    semantic: Semantic,
    /// Both sides re-print identically (known in every mode; only the terminal view acts on it).
    formatting_only: bool,
    /// (old, new) permission bits when both are known and differ, or a new file arrives executable.
    mode_change: Option<(u32, u32)>,
    /// A parseable kind that was skipped (size cap or parse failure), for the header.
    not_normalized: Option<&'static str>,
    /// New `import`/`require` specifiers and risky-API counts vs the old side, filled when both sides parsed.
    new_imports: Vec<Vec<u8>>,
    signal_deltas: Vec<(&'static str, usize)>,
    old: Option<&'a [u8]>,
    new: Option<&'a [u8]>,
    added: usize,
    removed: usize,
    binary: bool,
    became_binary: bool,
    gained_terminal_escapes: bool,
    gained_bidi_controls: bool,
    /// `*.js.map`: regenerated on every build, never worth reading.
    sourcemap: bool,
    /// Textually different shown lines folded away as equivalent by the key.
    hidden: usize,
    /// Un-minified view: per printed line, where it came from in the original (`line:col`, 1-based), per side.
    origin: Option<[Vec<(u32, u32)>; 2]>,
    hunks: Vec<u8>,
}

impl FileChange<'_> {
    fn bytes(&self) -> usize {
        [self.old, self.new]
            .iter()
            .flatten()
            .map(|side| side.len())
            .sum()
    }

    fn is_js(&self) -> bool {
        matches!(normalize::kind_for(self.path), Some(normalize::Kind::Js(_)))
    }

    fn is_sourcemap(&self) -> bool {
        // Because of the colon, this prefix can only start JSON, never a JavaScript program.
        strings::ends_with(self.path, b".map")
            && (self.new.or(self.old)).is_some_and(|b| b.starts_with(b"{\"version\":"))
    }

    /// Only the terminal view with hunks uses the re-print of a deleted file.
    fn is_parsed(&self, flags: DiffFlags, style: Style) -> bool {
        !flags.raw
            && normalize::kind_for(self.path).is_some()
            && (self.new.is_some() || (style.pretty && style.hunks))
    }

    /// About how long comparing and coloring the file take, in bytes that are parsed or colored. Others take far less.
    fn work(&self, flags: DiffFlags, style: Style) -> usize {
        let is_read_closely = self.highlight || self.is_parsed(flags, style);
        self.bytes() / if is_read_closely { 1 } else { 16 }
    }

    fn memory(&self, flags: DiffFlags, style: Style) -> Memory {
        let sides = [self.old, self.new];
        // `is_binary` may parse such a file to find out, and most often gives up at once.
        let may_be_binary = sides.iter().flatten().any(|side| has_early_nul(side));
        let is_parsed = self.is_parsed(flags, style);
        let mut memory = Memory::default();
        if self.is_sourcemap() && !may_be_binary {
            return memory;
        }
        for side in sides.iter().flatten() {
            if may_be_binary {
                memory.at_most += side.len();
            } else if is_parsed && side.len() <= normalize::MAX_BYTES {
                let tokens = count_tokens(side).max(side.len() / 8);
                memory.at_most += tokens;
                memory.likely += tokens;
            } else {
                memory.at_most += (2 * count_lines(side)).max(side.len() / 8);
            }
        }
        memory
    }
}

/// About how much memory comparing a file takes, in tokens: words, signs and line ends.
#[derive(Default, Clone, Copy)]
struct Memory {
    /// A line that is not parsed counts as two tokens, eight bytes as at least one, and a byte that may be binary as one.
    at_most: usize,
    /// Only the tokens that are parsed.
    likely: usize,
}

impl Memory {
    /// For two files that are compared one after the other.
    fn max(self, other: Memory) -> Memory {
        Memory {
            at_most: self.at_most.max(other.at_most),
            likely: self.likely.max(other.likely),
        }
    }
}

fn count_tokens(text: &[u8]) -> usize {
    let in_word = |b: u8| b.is_ascii_alphanumeric() | (b == b'_') | (b == b'$') | (b >= 0x80);
    let starts_token =
        |(&a, &b): (&u8, &u8)| (b != b' ') & (b != b'\t') & !(in_word(a) & in_word(b));
    // No branches, and sums that fit in a byte, so that the compiler looks at many bytes at once.
    let next = text.get(1..).unwrap_or_default();
    (text.chunks(255).zip(next.chunks(255)))
        .map(|(a, b)| a.iter().zip(b).map(starts_token).map(u8::from).sum::<u8>())
        .map(usize::from)
        .sum()
}

fn is_js_like(path: &[u8]) -> bool {
    matches!(
        normalize::kind_for(path),
        Some(normalize::Kind::Js(_) | normalize::Kind::Json)
    ) || path.ends_with(b".jsonc")
}

fn has_terminal_escapes(bytes: &[u8]) -> bool {
    strings::contains_char(bytes, 0x1b) || strings::contains(bytes, b"\xc2\x9b")
}

/// U+202A–U+202E, U+2066–U+2069 (embedding/override/isolate) — the Trojan Source set.
fn has_bidi_controls(bytes: &[u8]) -> bool {
    let bidi_at = |i: usize| {
        i + 2 < bytes.len()
            && ((bytes[i + 1] == 0x80 && (0xaa..=0xae).contains(&bytes[i + 2]))
                || (bytes[i + 1] == 0x81 && (0xa6..=0xa9).contains(&bytes[i + 2])))
    };
    let mut from = 0;
    while let Some(i) = strings::index_of_char(&bytes[from..], 0xe2) {
        let i = from + i as usize;
        if bidi_at(i) {
            return true;
        }
        from = i + 1;
    }
    false
}

/// Makes bytes that come from a package safe to print to a terminal. C0 and C1 control characters
/// (except tab), bidi overrides and the two Unicode line separators become visible stand-ins.
fn defang(text: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    let suspicious = |b: u8| ((b < 0x20) & (b != b'\t')) | (b == 0x7f) | (b == 0xc2) | (b == 0xe2);
    // No branches, so that the compiler looks at many bytes at once.
    if !text.iter().fold(false, |found, &b| found | suspicious(b)) {
        return std::borrow::Cow::Borrowed(text);
    }
    let mut out = Vec::with_capacity(text.len() + 16);
    let mut i = 0;
    while i < text.len() {
        let b = text[i];
        if b == 0x1b {
            out.extend_from_slice("␛".as_bytes());
        } else if (b < 0x20 && b != b'\t') || b == 0x7f {
            out.push(b'^');
            out.push(if b == 0x7f { b'?' } else { b + 0x40 });
        } else if b == 0xc2 && text.get(i + 1).is_some_and(|c| (0x80..=0x9f).contains(c)) {
            let _ = write!(out, "‹U+{:04X}›", u32::from(text[i + 1]));
            i += 2;
            continue;
        } else if b == 0xe2
            && i + 2 < text.len()
            && ((text[i + 1] == 0x80 && (0xa8..=0xae).contains(&text[i + 2]))
                || (text[i + 1] == 0x81 && (0xa6..=0xa9).contains(&text[i + 2])))
        {
            let cp = 0x2000 + (u32::from(text[i + 1] & 0x3f) << 6) + u32::from(text[i + 2] & 0x3f);
            let _ = write!(out, "‹U+{cp:04X}›");
            i += 3;
            continue;
        } else {
            out.push(b);
        }
        i += 1;
    }
    std::borrow::Cow::Owned(out)
}

/// Drops a `\r` that ends a line (before `\n` or at end of file); a CR in the middle of a line stays (and is drawn).
fn strip_cr(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    for (i, &b) in bytes.iter().enumerate() {
        if !(b == b'\r' && bytes.get(i + 1).is_none_or(|&n| n == b'\n')) {
            out.push(b);
        }
    }
    out
}

/// Every run of spaces, tabs and line endings becomes one byte and leading/trailing runs go, for `-w`. A line break
/// stays one: it ends a comment or a command. What follows a backslash decides if the command goes on, `#!` only
/// counts at the start, and to a shell a form feed or a `\r` on its own is part of a word.
fn collapse_whitespace(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut pending = None;
    for (at, &b) in bytes.iter().enumerate() {
        match b {
            _ if pending.is_none() && out.last() == Some(&b'\\') => out.push(b),
            b'\n' => pending = Some(b),
            b'\r' if bytes.get(at + 1) == Some(&b'\n') => {}
            b' ' | b'\t' => pending = pending.or(Some(b' ')),
            _ => {
                let is_kept = !out.is_empty() || bytes[at..].starts_with(b"#!");
                out.extend(pending.take().filter(|_| is_kept));
                out.push(b);
            }
        }
    }
    out
}

/// Like git, treats a file with a NUL byte near the start as binary. The exceptions are files that
/// something reads as text, such as scripts and the file types that Bun loads as text.
fn is_binary(path: &[u8], bytes: &[u8]) -> bool {
    use bun_ast::Loader;
    has_early_nul(bytes)
        && !bytes.starts_with(b"#!")
        && !path.ends_with(b".sh")
        && match bun_bundler::options::DEFAULT_LOADERS.get(bun_paths::extension(path)) {
            Some(loader) => matches!(loader, Loader::Wasm | Loader::Napi),
            None => normalize::normalize(b"as.js", bytes, Default::default()).is_none(),
        }
}

fn has_early_nul(bytes: &[u8]) -> bool {
    strings::contains_char(&bytes[..bytes.len().min(8192)], 0)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut digest = [0u8; bun_sha_hmac::SHA256::DIGEST];
    let mut hasher = bun_sha_hmac::SHA256::init();
    hasher.update(bytes);
    hasher.r#final(&mut digest);
    bun_fmt::bytes_to_hex_lower_string(&digest)
}

/// Summarizes a change whose contents are not shown, for example
/// `15 → 74 bytes, sha256 1a2b3c4d5e6f → 0f9e8d7c6b5a`.
fn binary_summary(c: &FileChange<'_>) -> String {
    let hash = |side: Option<&[u8]>| side.map_or_else(|| "none".to_string(), sha256_hex);
    format!(
        "{} → {} bytes, sha256 {:.12} → {:.12}",
        c.old.map_or(0, <[u8]>::len),
        c.new.map_or(0, <[u8]>::len),
        hash(c.old),
        hash(c.new)
    )
}

fn count_lines(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        0
    } else {
        strings::count_char(bytes, b'\n') + usize::from(!bytes.ends_with(b"\n"))
    }
}

/// Returns `prefix` + `path` the way a patch header names a file. A name that `git apply` or GNU
/// patch would otherwise misread is C-quoted, which both understand.
fn patch_name(prefix: &[u8], path: &[u8]) -> Vec<u8> {
    let needs_quotes = |b: &u8| matches!(*b, 0..=b' ' | 0x7f | b'"' | b'\\');
    if !path.iter().any(needs_quotes) {
        return [prefix, path].concat();
    }
    let mut out = [&b"\""[..], prefix].concat();
    for &b in path {
        match b {
            b'"' | b'\\' => out.extend_from_slice(&[b'\\', b]),
            0..=0x1f | 0x7f => {
                let _ = write!(out, "\\{b:03o}");
            }
            _ => out.push(b),
        }
    }
    out.push(b'"');
    out
}

/// Starts the threads that files are unpacked and compared on.
#[derive(Clone, Copy)]
pub(crate) struct Threads {
    stack_size: usize,
}

impl Threads {
    const MIN_BYTES: usize = 256 << 10;

    /// A file that nests too deep for the stack is not parsed, so a thread gets at least as much as this one has left.
    fn with_stack_of_this_one() -> Threads {
        /// Upper bound on the stack that a thread has used when it starts on a file.
        const THREAD_START: usize = 64 << 10;
        /// What the calling thread has left of its stack varies from run to run, because the kernel starts it at a
        /// random address. The stack size is rounded up to a multiple of this, so that it doesn't.
        const STACK_STEP: usize = 1 << 20;

        let remaining = StackCheck::init().remaining() + StackCheck::THRESHOLD;
        Threads {
            stack_size: remaining.next_multiple_of(STACK_STEP) + THREAD_START,
        }
    }

    /// The pool must not be moved once it has started a thread.
    fn pool_for(self, changes: &[FileChange<'_>], flags: DiffFlags, style: Style) -> ThreadPool {
        /// One more thread per this much work. With less, starting it costs more than it saves.
        const WORK_PER_THREAD: usize = 64 << 10;
        /// More take more memory, and no less time on real packages.
        const MAX_THREADS: usize = 8;

        let work: usize = (changes.iter())
            .filter(|change| change.semantic != Semantic::ModeOnly)
            .map(|change| change.work(flags, style))
            .sum();
        let threads = (1 + work / WORK_PER_THREAD)
            .min(usize::from(bun_core::get_thread_count()))
            .min(MAX_THREADS);
        ThreadPool::init(thread_pool::Config {
            max_threads: threads as u32,
            stack_size: u32::try_from(self.stack_size).unwrap_or(u32::MAX),
        })
        .named("Diff")
        .without_spare_threads()
    }

    /// Runs `there` on a new thread while `here` runs on this one. Runs neither if the OS cannot start a thread, or if
    /// `bytes`, which is about how much input the new thread takes off this one, is under `MIN_BYTES`.
    pub(crate) fn try_join<A, B: Send>(
        self,
        bytes: usize,
        here: impl FnOnce() -> A,
        there: impl FnOnce() -> B + Send,
    ) -> Option<(A, B)> {
        if bytes < Self::MIN_BYTES {
            return None;
        }
        std::thread::scope(|scope| {
            // SAFETY: this command starts no VM, so `there` holds no state of one.
            let thread = std::thread::Builder::new()
                .stack_size(self.stack_size)
                .spawn_scoped(scope, || {
                    Output::Source::configure_named_thread(bun_core::zstr!("Diff"));
                    there()
                })
                .ok()?;
            Some((here(), thread.join().ok()?))
        })
    }

    /// Like `try_join`, but runs both on this thread instead of neither.
    pub(crate) fn join<A, B: Send>(
        self,
        bytes: usize,
        mut here: impl FnMut() -> A,
        mut there: impl FnMut() -> B + Send,
    ) -> (A, B) {
        self.try_join(bytes, &mut here, &mut there)
            .unwrap_or_else(|| (here(), there()))
    }
}

/// Files that one thread compares one after the other. Its memory is that of the largest.
type Part<'c, 'a> = &'c mut [&'c mut FileChange<'a>];

struct Queue<'c, 'a> {
    /// The parts that no thread has taken yet, by `Memory::at_most` and then by position.
    parts: BTreeMap<(usize, usize), Part<'c, 'a>>,
    /// `Memory::at_most` of the parts that are being compared.
    running: Vec<usize>,
    /// How many tokens these may have in total, without the largest.
    beside_largest: usize,
}

impl Queue<'_, '_> {
    /// How many tokens one more part may have.
    fn room(&self) -> usize {
        let total: usize = self.running.iter().sum();
        match self.running.iter().max() {
            Some(largest) if total > self.beside_largest => self.beside_largest - (total - largest),
            _ => usize::MAX,
        }
    }
}

/// Compares the files on the threads of `pool`, or on this one without it.
fn compare_all(
    changes: &mut [FileChange<'_>],
    flags: DiffFlags,
    style: Style,
    threads: Threads,
    pool: Option<&ThreadPool>,
) {
    /// Beside one file of any size, files with as many tokens as the largest parsed one has are
    /// compared at the same time, within these limits. A token takes some 100 bytes of memory.
    const MIN_BESIDE: usize = 128 << 10;
    const MAX_BESIDE: usize = 4 << 20;
    /// A part ends with the file that brings it to this much work, so small files do not take a turn each.
    const WORK_PER_PART: usize = 16 << 10;

    let mut files: Vec<&mut FileChange<'_>> = changes
        .iter_mut()
        .filter(|change| change.semantic != Semantic::ModeOnly)
        .collect();
    let Some(pool) = pool else {
        for file in files {
            compare(file, flags, style, threads);
        }
        return;
    };
    let mut in_part = 0;
    let mut parts: Vec<(Memory, Part<'_, '_>)> = files
        .split_inclusive_mut(|file| {
            in_part += file.work(flags, style);
            let is_full = in_part >= WORK_PER_PART;
            if is_full {
                in_part = 0;
            }
            is_full
        })
        .map(|part| (Memory::default(), part))
        .collect();
    let workers = pool.max_threads().min(parts.len());

    pool.each_ptr(
        (),
        |(), (memory, part), _| {
            *memory = (part.iter()).fold(*memory, |most, file| most.max(file.memory(flags, style)));
        },
        &mut parts,
    );
    let largest = parts.iter().map(|(memory, _)| memory.likely).max();
    let shared = Guarded::new(Queue {
        running: Vec::with_capacity(workers),
        beside_largest: largest.unwrap_or(0).clamp(MIN_BESIDE, MAX_BESIDE),
        parts: (parts.into_iter().enumerate())
            .map(|(at, (memory, part))| ((memory.at_most, at), part))
            .collect(),
    });
    let has_room = Condvar::new();
    let work = || {
        let mut queue = shared.lock();
        while !queue.parts.is_empty() {
            let mut fitting = queue.parts.range(..=(queue.room(), usize::MAX));
            let next = fitting.next_back().map(|(&next, _)| next);
            let Some(((tokens, _), part)) = next.and_then(|it| queue.parts.remove_entry(&it))
            else {
                has_room.wait_guarded(&mut queue);
                continue;
            };
            queue.running.push(tokens);
            // Each thread wakes the next, if that one finds a part or can end.
            if (queue.parts.keys().next()).is_none_or(|smallest| smallest.0 <= queue.room()) {
                has_room.notify_one();
            }
            drop(queue);
            for file in part {
                compare(file, flags, style, threads);
            }
            queue = shared.lock();
            if let Some(at) = queue.running.iter().position(|&it| it == tokens) {
                queue.running.swap_remove(at);
            }
        }
        has_room.notify_one();
    };
    // This thread does not join in: whether a file is parsed must not depend on the thread that takes it.
    pool.each_iter((), |(), _| work(), workers, 0..workers);
}

/// Decides what changed between the two sides of a file, and renders it.
fn compare(change: &mut FileChange<'_>, flags: DiffFlags, style: Style, threads: Threads) {
    let FileChange { path, old, new, .. } = *change;
    let [old_binary, new_binary] = [old, new].map(|side| side.map(|side| is_binary(path, side)));
    change.binary = old_binary == Some(true) || new_binary == Some(true);
    change.became_binary = old_binary == Some(false) && new_binary == Some(true);
    let gained = |has: fn(&[u8]) -> bool| new.is_some_and(has) && !old.is_some_and(has);
    change.gained_terminal_escapes = !change.binary && gained(has_terminal_escapes);
    change.gained_bidi_controls = !change.binary && gained(has_bidi_controls);
    change.sourcemap = change.is_sourcemap();
    if change.binary || change.sourcemap {
        return;
    }
    if style.pretty {
        if let (Some(o), Some(n)) = (old, new) {
            if (strings::contains_char(o, b'\r') || strings::contains_char(n, b'\r'))
                && strip_cr(o) == strip_cr(n)
            {
                change.semantic = Semantic::LineEndingsOnly;
                return;
            }
        }
    }
    // Like `formatting only`, a terminal-view summary; piped output stays a complete patch.
    if flags.ignore_space && style.pretty {
        if let (Some(o), Some(n)) = (old, new) {
            if collapse_whitespace(o) == collapse_whitespace(n) {
                change.semantic = Semantic::WhitespaceOnly;
                return;
            }
        }
    }
    // Readable JS is compared on the aggressive key and shown as written; minified JS is shown re-printed,
    // so it gets the gentler display print.
    let (is_parsed, js_family) = (change.is_parsed(flags, style), change.is_js());
    let readable_js = js_family
        && is_parsed
        && !flags.unminify
        && !old.is_some_and(normalize::looks_minified)
        && !new.is_some_and(normalize::looks_minified);
    let nopts = normalize::Options {
        minify_syntax: flags.minify,
        dce: false,
        relayout: true,
        source_map: style.pretty,
    };
    let popts = if readable_js {
        normalize::Options {
            source_map: style.pretty && old.is_some() && new.is_some(),
            ..normalize::Options::KEY
        }
    } else {
        nopts
    };
    let mut renamed = None;
    // Canonical re-print: same parser and printer on both sides, so only meaning survives.
    let (norm_old, norm_new) = match (is_parsed, readable_js, old, new) {
        (false, ..) => (None, None),
        // Both sides of readable JS are keyed together so their locals get lockstep names.
        (true, true, Some(o), Some(n)) => {
            match normalize::normalize_key_pair(path, o, n, popts, Otherwise::PrintApart, threads) {
                Pair::Renamed { old, new, .. } => (Some(old), Some(new)),
                Pair::Apart { old, new } => (old, new),
            }
        }
        (true, false, Some(o), Some(n)) if js_family && style.pretty => {
            match normalize::normalize_minified_pair(path, o, n, nopts, threads) {
                Pair::Renamed { old, new, .. } => {
                    renamed = Some((old, new));
                    let not_shown = nopts.without_source_map();
                    threads.join(
                        o.len().min(n.len()),
                        || normalize::normalize(path, o, not_shown),
                        || normalize::normalize(path, n, not_shown),
                    )
                }
                Pair::Apart { old, new } => (old, new),
            }
        }
        _ => (
            old.and_then(|b| normalize::normalize(path, b, popts)),
            new.and_then(|b| normalize::normalize(path, b, popts)),
        ),
    };
    if is_parsed {
        let too_big = |b: Option<&[u8]>| b.is_some_and(|b| b.len() > normalize::MAX_BYTES);
        if too_big(old) || too_big(new) {
            change.not_normalized = Some("too large to normalize");
        } else if (old.is_some() && norm_old.is_none()) || (new.is_some() && norm_new.is_none()) {
            change.not_normalized = Some("not parsed");
        }
    }
    if let Some(n) = &norm_new {
        let mut seen: BTreeSet<&Vec<u8>> = norm_old.iter().flat_map(|o| &o.imports).collect();
        for imp in &n.imports {
            if seen.insert(imp) {
                change.new_imports.push(imp.clone());
            }
        }
        let before = norm_old
            .as_ref()
            .map_or([0; normalize::SIGNALS.len()], |o| {
                normalize::count_signals(&o.text)
            });
        let after = normalize::count_signals(&n.text);
        for (i, (_, label)) in normalize::SIGNALS.iter().enumerate() {
            if after[i] > before[i] {
                change.signal_deltas.push((label, after[i] - before[i]));
            }
        }
    }
    // Equal re-prints prove the code is the same; comments and TypeScript types are not in the re-print, so
    // those are checked separately before anything is called "formatting only".
    let reprint_equal = matches!((&norm_old, &norm_new), (Some(a), Some(b)) if a.text == b.text);
    change.formatting_only = reprint_equal && !js_family;
    match (old, new, &norm_old, &norm_new) {
        // Patch output must apply to the real files, so only the terminal view uses the re-print.
        (Some(o), Some(n), Some(no), Some(nn))
            if style.pretty
                && (js_family || no.was_minified || nn.was_minified)
                && (no.was_minified || nn.was_minified || flags.unminify) =>
        {
            // Minified: the original is one enormous line, so an un-minified re-print stands in as the source —
            // locals renamed in lockstep, banner comment as written — and the folded key decides what changed.
            change.semantic = Semantic::Normalized;
            let (disp_o, disp_n) = match &renamed {
                Some((co, cn)) => (co, cn),
                None => (no, nn),
            };
            let (shown_o, shown_n) = (with_banner(o, disp_o), with_banner(n, disp_n));
            let faithful =
                [(o, no, &shown_o), (n, nn, &shown_n)]
                    .iter()
                    .all(|&(raw, print, shown)| {
                        if renamed.is_some() {
                            normalize::stands_for_renamed(path, raw, &shown.text, nopts, threads)
                        } else {
                            normalize::stands_for(path, print, &shown.text, nopts)
                        }
                    });
            let keys = (js_family && faithful).then(|| {
                let options = normalize::Options::KEY;
                normalize::normalize_key_pair(path, o, n, options, Otherwise::GiveUp, threads)
            });
            match keys {
                // A re-print that does not parse as the same file is not shown in the file's
                // place. The raw text is diffed instead.
                _ if !faithful => {
                    change.semantic = Semantic::Text;
                    unified_hunks(o, n, flags.context, style, change);
                }
                Some(Pair::Renamed {
                    old: mut ko,
                    new: mut kn,
                    ..
                }) if !ko.map.is_empty() && !kn.map.is_empty() => {
                    rebase_key_onto(&mut ko, &shown_o, disp_o);
                    rebase_key_onto(&mut kn, &shown_n, disp_n);
                    let (projection, _) =
                        semantic::project(&shown_o.text, &shown_n.text, &ko, &kn, threads);
                    let same_key = ko.text == kn.text;
                    if !same_key && shown_o.text == shown_n.text {
                        // The code differs but the re-prints are identical, so only the raw
                        // text can show the change.
                        change.semantic = Semantic::Text;
                        unified_hunks(o, n, flags.context, style, change);
                    } else if !projection.holds(path, &shown_o.text, &shown_n.text, same_key) {
                        change.origin = Some([shown_o.origin, shown_n.origin]);
                        unified_hunks(&shown_o.text, &shown_n.text, flags.context, style, change);
                    } else if projection
                        .ops
                        .iter()
                        .any(|op| op.kind != Operation::Equal || op.affected)
                    {
                        change.hidden = projection.hidden;
                        change.origin = Some([shown_o.origin, shown_n.origin]);
                        render_ops(
                            &projection.ops,
                            flags.context,
                            style,
                            change,
                            (false, false),
                        );
                    } else {
                        change.semantic = Semantic::FormattingOnly;
                        change.formatting_only = true;
                    }
                }
                _ if shown_o.text == shown_n.text => {
                    change.semantic = Semantic::FormattingOnly;
                    change.formatting_only = true;
                }
                _ => {
                    change.origin = Some([shown_o.origin, shown_n.origin]);
                    unified_hunks(&shown_o.text, &shown_n.text, flags.context, style, change);
                }
            }
        }
        (Some(o), Some(n), Some(ko), Some(kn)) if style.pretty && js_family => {
            // Readable code: decide on the aggressive canonical form, show the author's lines.
            match (ko, kn) {
                (ko, kn) if !ko.map.is_empty() && !kn.map.is_empty() => {
                    let (old_v, new_v) = (view_bytes(o), view_bytes(n));
                    let (projection, unfolded) = semantic::project(&old_v, &new_v, ko, kn, threads);
                    let shown = projection
                        .ops
                        .iter()
                        .any(|op| op.kind != Operation::Equal || op.affected);
                    if !projection.holds(path, &old_v, &new_v, ko.text == kn.text) {
                        render_ops(&unfolded, flags.context, style, change, (false, false));
                    } else if shown {
                        change.semantic = Semantic::Projected;
                        change.hidden = projection.hidden;
                        render_ops(
                            &projection.ops,
                            flags.context,
                            style,
                            change,
                            (false, false),
                        );
                    } else {
                        change.semantic = Semantic::FormattingOnly;
                        change.formatting_only = true;
                    }
                }
                _ => unified_hunks(o, n, flags.context, style, change),
            }
        }
        (Some(_), Some(_), Some(_), Some(_)) if style.pretty && reprint_equal => {
            // JSON / CSS: no source map to project through; an identical re-print is formatting.
            change.semantic = Semantic::FormattingOnly;
        }
        (Some(_), Some(_), Some(no), Some(nn)) if style.pretty => {
            // JSON / CSS with a real change: the canonical prints are what is compared and shown, so a
            // reformat around one edit is one edit.
            change.semantic = Semantic::Reprinted;
            unified_hunks(&no.text, &nn.text, flags.context, style, change);
        }
        (None, Some(n), _, _) => change.added = count_lines(n),
        (Some(o), None, _, _) => change.removed = count_lines(o),
        (Some(o), Some(n), _, _) => unified_hunks(o, n, flags.context, style, change),
        (None, None, _, _) => unreachable!(),
    }
    if style.hunks
        && change.hunks.is_empty()
        && change.semantic == Semantic::Text
        && (old.is_none() || new.is_none())
    {
        // Whole-file add/remove: render every line as +/- (a minified bundle in its readable re-print).
        let (op, raw, norm) = match (new, old) {
            (Some(n), _) => (Operation::Insert, n, &norm_new),
            (None, Some(o)) => (Operation::Delete, o, &norm_old),
            (None, None) => unreachable!(),
        };
        let shown = match norm {
            Some(norm) if style.pretty && norm.was_minified => Some(with_banner(raw, norm))
                .filter(|shown| normalize::stands_for(path, norm, &shown.text, nopts)),
            _ => None,
        };
        let body = shown.as_ref().map_or(raw, |shown| &shown.text);
        if body.len() != raw.len() {
            change.semantic = Semantic::Normalized;
            change.origin = shown
                .as_ref()
                .map(|shown| [shown.origin.clone(), shown.origin.clone()]);
            if op == Operation::Insert {
                change.added = count_lines(body)
            } else {
                change.removed = count_lines(body)
            }
        }
        let n = count_lines(body);
        let range = if new.is_some() {
            (0, 0, 1, n)
        } else {
            (1, n, 0, 0)
        };
        // An empty file has no lines, and a hunk header without lines corrupts the patch.
        if n > 0 {
            style.hunk_header(&mut change.hunks, range, true);
        }
        let unterminated = !style.pretty && !body.is_empty() && !body.ends_with(b"\n");
        for (i, line) in Lines(body).enumerate() {
            style.line(
                &mut change.hunks,
                op,
                i + 1,
                i + 1,
                line,
                change.highlight,
                None,
                false,
                change
                    .origin
                    .as_ref()
                    .map(|[o, _]| o.get(i).copied().unwrap_or((0, 0))),
            );
        }
        if unterminated {
            change.hunks.extend_from_slice(NO_NEWLINE_MARKER);
        }
    }
}

fn print_diff(left: &Tree, right: &Tree, flags: DiffFlags, threads: Threads) {
    let style = Style::detect(flags);
    let mut changes: Vec<FileChange> = Vec::new();

    let mut paths: Vec<&[u8]> = left
        .files
        .keys()
        .chain(right.files.keys())
        .map(Vec::as_slice)
        .collect();
    paths.sort_unstable();
    paths.dedup();
    for path in paths {
        let old = left.files.get(path).map(Vec::as_slice);
        let new = right.files.get(path).map(Vec::as_slice);
        let (old_mode, new_mode) = (
            left.modes.get(path).copied(),
            right.modes.get(path).copied(),
        );
        let mode_change = match (old_mode, new_mode) {
            (Some(o), Some(n)) if (o ^ n) & 0o111 != 0 => Some((o, n)),
            (None, Some(n)) if old.is_none() && n & 0o111 != 0 => Some((0, n)),
            _ => None,
        };
        if old == new && mode_change.is_none() {
            continue;
        }
        changes.push(FileChange {
            path,
            highlight: style.pretty && is_js_like(path),
            semantic: if old == new {
                Semantic::ModeOnly
            } else {
                Semantic::Text
            },
            old,
            new,
            mode_change,
            ..Default::default()
        });
    }
    let pool = threads.pool_for(&changes, flags, style);
    if pool.max_threads() > 1 {
        pool.warm(1);
    }
    // If the OS cannot start the pool's first thread, what is scheduled on the pool never runs.
    let pool = pool.has_workers().then_some(&pool);
    compare_all(&mut changes, flags, style, threads, pool);

    if flags.json {
        print_json(left, right, &changes, flags);
        return;
    }
    if style.pretty {
        prettyln!("");
    }
    print_header(left, right, style);
    if changes.is_empty() {
        prettyln!("<d>No differences ({} files)<r>", left.files.len());
        return;
    }
    if !style.pretty || flags.name_only || flags.stat {
        prettyln!("");
    }

    if style.pretty && style.hunks {
        print_in_colors(&changes, style, pool);
        print_summary(left, right, &changes, style);
        return;
    }

    let path_width = changes
        .iter()
        .map(|c| defang(c.path).len())
        .max()
        .unwrap_or(0)
        .min(60);
    let max_delta = changes
        .iter()
        .map(|c| c.added + c.removed)
        .max()
        .unwrap_or(1)
        .max(1);
    for c in &changes {
        let status = match (c.old, c.new) {
            (None, Some(_)) => "A",
            (Some(_), None) => "D",
            _ => "M",
        };
        if flags.name_only {
            Output::print(format_args!("{status} {}\n", BStr::new(&defang(c.path))));
            continue;
        }
        if flags.stat {
            // Bars scale to the biggest change so a 2-line edit next to a 500-line one still shows.
            let width = 40usize;
            let scale = |n: usize| {
                if max_delta <= width {
                    n
                } else {
                    (n * width).div_ceil(max_delta)
                }
            };
            let (bar_add, bar_del) = ("+".repeat(scale(c.added)), "-".repeat(scale(c.removed)));
            let padded = format!("{:<width$}", BStr::new(&defang(c.path)), width = path_width);
            let sep = if style.pretty { "│" } else { "|" };
            if let Semantic::FormattingOnly
            | Semantic::WhitespaceOnly
            | Semantic::LineEndingsOnly
            | Semantic::ModeOnly = c.semantic
            {
                let what = match c.semantic {
                    Semantic::FormattingOnly => "formatting only".to_string(),
                    Semantic::WhitespaceOnly => "whitespace only".to_string(),
                    Semantic::LineEndingsOnly => "line endings only".to_string(),
                    _ => c
                        .mode_change
                        .map_or(String::new(), |(o, n)| format!("mode {o:o} → {n:o}")),
                };
                pretty!(" {} <d>{}<r> <d>{}<r>\n", padded, sep, what);
                continue;
            }
            if c.binary || c.sourcemap {
                pretty!(
                    " {} <d>{}<r> <yellow>{}<r>   {} → {} bytes\n",
                    padded,
                    sep,
                    if c.sourcemap { "map" } else { "bin" },
                    c.old.map_or(0, <[u8]>::len),
                    c.new.map_or(0, <[u8]>::len)
                );
            } else {
                pretty!(
                    " {} <d>{}<r> {:>5} <green>{}<r><red>{}<r>\n",
                    padded,
                    sep,
                    c.added + c.removed,
                    bar_add,
                    bar_del
                );
            }
            continue;
        }
        // A file whose contents the patch omits gets neither a `diff --git` header nor a mode line,
        // because GNU patch would apply the mode line to the previous file.
        let in_patch = !c.binary && !c.sourcemap;
        let header: &[u8] = if in_patch {
            b"diff --git "
        } else {
            b"diff --bun "
        };
        let (mut a, mut b) = (patch_name(b"a/", c.path), patch_name(b"b/", c.path));
        if style.escape {
            (a, b) = (defang(&a).into_owned(), defang(&b).into_owned());
        }
        // Output that goes to a file is written as raw bytes, not through `Display`. A Latin-1
        // context line has to come out unchanged for the patch to apply.
        let put = |part: &[u8]| {
            if style.escape {
                print_lossy(part);
            } else {
                Output::print_bytes(part);
            }
        };
        for part in [header, &a, b" ", &b, b"\n"] {
            put(part);
        }
        match (c.old, c.new, c.mode_change) {
            (None, Some(_), _) if !in_patch => Output::print(format_args!("new file\n")),
            (Some(_), None, _) if !in_patch => Output::print(format_args!("deleted file\n")),
            (None, Some(_), mode) => Output::print(format_args!(
                "new file mode 100{:o}\n",
                mode.map_or(0o644, |(_, n)| n)
            )),
            (Some(_), None, _) => {
                let mode = left.modes.get(c.path).copied().unwrap_or(0);
                Output::print(format_args!(
                    "deleted file mode 100{}\n",
                    if mode & 0o111 != 0 { 755 } else { 644 }
                ))
            }
            (_, _, Some((o, n))) if in_patch => {
                Output::print(format_args!("old mode 100{o:o}\nnew mode 100{n:o}\n"))
            }
            _ => {}
        }
        if c.semantic == Semantic::ModeOnly {
            continue;
        }
        if c.sourcemap {
            Output::print(format_args!(
                "Source map files differ ({} → {} bytes)\n",
                c.old.map_or(0, <[u8]>::len),
                c.new.map_or(0, <[u8]>::len)
            ));
            continue;
        }
        if c.binary {
            Output::print(format_args!(
                "Binary files differ ({})\n",
                binary_summary(c)
            ));
            continue;
        }
        // An added or removed empty file is written the way git writes it: an `index` line with the
        // null object ID and the empty blob's ID, and no hunk.
        if c.hunks.is_empty() {
            Output::print(format_args!(
                "index {}\n",
                if c.new.is_some() {
                    "0000000..e69de29"
                } else {
                    "e69de29..0000000"
                }
            ));
            continue;
        }
        let old_name: &[u8] = if c.old.is_some() { &a } else { b"/dev/null" };
        let new_name: &[u8] = if c.new.is_some() { &b } else { b"/dev/null" };
        for part in [&b"--- "[..], old_name, b"\n+++ ", new_name, b"\n", &c.hunks] {
            put(part);
        }
    }
    print_summary(left, right, &changes, style);
}

/// Prints the terminal view. Syntax colours make it much longer, so only what is about to be printed has them.
fn print_in_colors(changes: &[FileChange<'_>], style: Style, pool: Option<&ThreadPool>) {
    const BYTES_PER_PART: usize = 64 << 10;
    const PARTS_PER_THREAD: usize = 4;

    struct Ahead<Parts: Iterator> {
        parts: core::iter::Peekable<Parts>,
        printed: usize,
        /// The parts after the printed ones, each `None` until a thread is done with it.
        colored: VecDeque<Option<Vec<u8>>>,
    }

    // The first piece of a file has its header.
    let mut pieces = changes.iter().flat_map(|change| {
        let (mut header, mut rest) = (Some(change), change.hunks.as_slice());
        core::iter::from_fn(move || {
            if header.is_none() && rest.is_empty() {
                return None;
            }
            let piece;
            (piece, rest) = split_marked(rest, BYTES_PER_PART);
            Some((header.take(), piece))
        })
    });
    // The header of a binary file has the hashes of its sides.
    let header_work = |it: &FileChange<'_>| {
        it.path.len() + style.width * "─".len() + if it.binary { it.bytes() } else { 0 }
    };
    // A part has pieces of several files, so that small files do not take a turn each.
    let parts = core::iter::from_fn(move || {
        let (mut part, mut len) = (Vec::new(), 0);
        while len < BYTES_PER_PART
            && let Some((header, piece)) = pieces.next()
        {
            len += piece.len() + header.map_or(0, header_work);
            part.push((header, piece));
        }
        (!part.is_empty()).then_some(part)
    });
    let color = |part: Vec<(Option<&FileChange<'_>>, &[u8])>| {
        let mut out = Vec::with_capacity(2 * BYTES_PER_PART);
        for (header, piece) in part {
            if let Some(change) = header {
                style.file_header(&mut out, change);
            }
            style.highlight(&mut out, piece);
        }
        if strings::is_valid_utf8(&out) {
            out
        } else {
            BStr::new(&out).to_string().into_bytes()
        }
    };
    let Some(pool) = pool else {
        return parts.for_each(|part| Output::print_bytes(&color(part)));
    };

    let threads = pool.max_threads();
    let shared = Guarded::new(Ahead {
        parts: parts.peekable(),
        printed: 0,
        colored: VecDeque::new(),
    });
    let (has_room, has_next) = (Condvar::new(), Condvar::new());
    let work = || {
        let mut ahead = shared.lock();
        loop {
            if ahead.colored.len() == PARTS_PER_THREAD * threads {
                has_room.wait_guarded(&mut ahead);
                continue;
            }
            let Some(part) = ahead.parts.next() else {
                // Each thread that ends wakes the next.
                return has_room.notify_one();
            };
            let at = ahead.printed + ahead.colored.len();
            ahead.colored.push_back(None);
            drop(ahead);
            let colored = color(part);
            ahead = shared.lock();
            let at = at - ahead.printed;
            ahead.colored[at] = Some(colored);
            if at == 0 {
                has_next.notify_one();
            }
        }
    };
    let print = || {
        let mut ahead = shared.lock();
        while !ahead.colored.is_empty() || ahead.parts.peek().is_some() {
            let Some(Some(next)) = ahead.colored.pop_front_if(|next| next.is_some()) else {
                has_next.wait_guarded(&mut ahead);
                continue;
            };
            ahead.printed += 1;
            has_room.notify_one();
            drop(ahead);
            Output::print_bytes(&next);
            ahead = shared.lock();
        }
    };
    pool.each_while((), |(), (), _| work(), &vec![(); threads], print);
}

/// Prints U+FFFD in place of what is not UTF-8.
fn print_lossy(bytes: &[u8]) {
    if strings::is_valid_utf8(bytes) {
        Output::print_bytes(bytes);
    } else {
        Output::print(format_args!("{}", BStr::new(bytes)));
    }
}

/// The header everyone reads first: which versions, how much changed, and the changes worth a second look
/// (install scripts, binaries, dependency and entry-point changes in package.json).
fn print_header(left: &Tree, right: &Tree, style: Style) {
    // `react 18.2.0 → 19.0.0` when both sides are the same package, the two labels otherwise.
    match (split_label(&left.label), split_label(&right.label)) {
        (Some((ln, lv)), Some((rn, rv))) if style.pretty && ln == rn => prettyln!(
            "<b>{}<r> <red>{}<r> <d>→<r> <green>{}<r>",
            BStr::new(&defang(ln)),
            BStr::new(&defang(lv)),
            BStr::new(&defang(rv))
        ),
        _ => prettyln!(
            "<b>{}<r> <d>→<r> <b>{}<r>",
            BStr::new(&defang(&left.label)),
            BStr::new(&defang(&right.label))
        ),
    }
}

/// Printed after the hunks: the end of the output is what is left on screen, so the totals and the changes worth
/// a second look (install scripts, new imports of consequential builtins, binaries, …) go there.
fn print_summary(left: &Tree, right: &Tree, changes: &[FileChange<'_>], style: Style) {
    let (mut files_added, mut files_removed, mut files_changed, mut lines_added, mut lines_removed) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    for c in changes {
        match (c.old, c.new) {
            (None, Some(_)) => files_added += 1,
            (Some(_), None) => files_removed += 1,
            _ => files_changed += 1,
        }
        lines_added += c.added;
        lines_removed += c.removed;
    }
    prettyln!("");
    print_header(left, right, style);
    if style.pretty {
        let mut line = format!(
            "<d>{} file{}<r>  <green>+{}<r> <red>-{}<r>",
            changes.len(),
            if changes.len() == 1 { "" } else { "s" },
            lines_added,
            lines_removed
        );
        if files_added > 0 {
            line.push_str(&format!("  <d>·<r>  <green>{files_added} new<r>"));
        }
        if files_removed > 0 {
            line.push_str(&format!("  <d>·<r>  <red>{files_removed} deleted<r>"));
        }
        let formatting_only = changes
            .iter()
            .filter(|c| c.semantic == Semantic::FormattingOnly)
            .count();
        if formatting_only > 0 {
            line.push_str(&format!("  <d>·  {formatting_only} formatting only<r>"));
        }
        let whitespace_only = changes
            .iter()
            .filter(|c| c.semantic == Semantic::WhitespaceOnly)
            .count();
        if whitespace_only > 0 {
            line.push_str(&format!("  <d>·  {whitespace_only} whitespace only<r>"));
        }
        let endings_only = changes
            .iter()
            .filter(|c| c.semantic == Semantic::LineEndingsOnly)
            .count();
        if endings_only > 0 {
            line.push_str(&format!("  <d>·  {endings_only} line endings only<r>"));
        }
        #[allow(clippy::disallowed_methods)]
        Output::pretty(format_args!("{line}\n"));
    } else {
        prettyln!(
            "{} file{} changed, {} added, {} removed  (+{} -{} lines)",
            files_changed,
            if files_changed == 1 { "" } else { "s" },
            files_added,
            files_removed,
            lines_added,
            lines_removed
        );
    }

    let notes = collect_notes(left, right, changes, style.pretty);
    let mark = if style.pretty {
        bun_core::pretty_fmt!("  <yellow>▲<r> ", true)
    } else {
        "  ! "
    };
    for n in &notes {
        Output::print(format_args!("{mark}{n}\n"));
    }
}

/// The changes worth a second look, as colour-tagged strings (user text already escaped).
fn collect_notes(
    left: &Tree,
    right: &Tree,
    changes: &[FileChange<'_>],
    colors: bool,
) -> Vec<String> {
    let mut notes: Vec<String> = Vec::new();
    package_json_notes(left, right, &mut notes, colors);
    ast_notes(changes, &mut notes, colors);
    for c in changes {
        match c.mode_change {
            Some((0, n)) => notes.push(note!(
                colors,
                "new executable file <b>{}<r> <d>({})<r>",
                &[BStr::new(c.path).to_string(), format!("{n:o}")]
            )),
            Some((o, n)) if n & 0o111 != 0 => notes.push(note!(
                colors,
                "now executable: <b>{}<r> <d>({} → {})<r>",
                &[
                    BStr::new(c.path).to_string(),
                    format!("{o:o}"),
                    format!("{n:o}")
                ]
            )),
            _ => {}
        }
        if c.gained_terminal_escapes {
            notes.push(note!(
                colors,
                "terminal escape sequences in <b>{}<r> <d>(shown as ␛)<r>",
                &[BStr::new(c.path).to_string()]
            ));
        }
        if c.gained_bidi_controls {
            notes.push(note!(
                colors,
                "bidirectional text controls in <b>{}<r> <d>(Trojan Source; shown as ‹U+202E›)<r>",
                &[BStr::new(c.path).to_string()]
            ));
        }
        if c.binary && c.old.is_none() {
            notes.push(note!(
                colors,
                "new binary file <b>{}<r> ({} bytes)",
                &[
                    (BStr::new(c.path)).to_string(),
                    (c.new.map_or(0, <[u8]>::len)).to_string(),
                ],
            ));
        }
        if c.became_binary {
            notes.push(note!(
                colors,
                "<b>{}<r> was text and is now binary",
                &[BStr::new(c.path).to_string()]
            ));
        }
        if c.old.is_none()
            && (strings::ends_with(c.path, b".node")
                || strings::ends_with(c.path, b".sh")
                || strings::ends_with(c.path, b".exe"))
            && !c.binary
        {
            notes.push(note!(
                colors,
                "new executable-looking file <b>{}<r>",
                &[(BStr::new(c.path)).to_string()],
            ));
        }
    }
    notes
}

/// `--json`: one document with both labels, per-file status/counts/patch text, the notes as plain strings, and totals.
fn print_json(left: &Tree, right: &Tree, changes: &[FileChange<'_>], flags: DiffFlags) {
    fn js(s: &[u8]) -> bun_core::fmt::JSONFormatterUTF8<'_> {
        bun_core::fmt::format_json_string_utf8(s, Default::default())
    }
    let mut out: Vec<u8> = Vec::with_capacity(4096);
    let _ = write!(
        out,
        "{{\n  \"from\": {},\n  \"to\": {},\n  \"files\": [",
        js(&left.label),
        js(&right.label)
    );
    let (mut lines_added, mut lines_removed, mut added, mut deleted) =
        (0usize, 0usize, 0usize, 0usize);
    for (i, c) in changes.iter().enumerate() {
        let status = match (c.old, c.new) {
            (None, Some(_)) => {
                added += 1;
                "added"
            }
            (Some(_), None) => {
                deleted += 1;
                "deleted"
            }
            _ => "modified",
        };
        lines_added += c.added;
        lines_removed += c.removed;
        let _ = write!(
            out,
            "{}\n    {{ \"path\": {}, \"status\": \"{}\", \"binary\": {}, \"sourceMap\": {}, \"formattingOnly\": {}, \"linesAdded\": {}, \"linesRemoved\": {}, \"bytesBefore\": {}, \"bytesAfter\": {}{}",
            if i == 0 { "" } else { "," },
            js(c.path),
            status,
            c.binary,
            c.sourcemap,
            c.formatting_only,
            c.added,
            c.removed,
            c.old.map_or(0, <[u8]>::len),
            c.new.map_or(0, <[u8]>::len),
            c.mode_change.map_or(String::new(), |(o, n)| format!(
                ", \"modeBefore\": \"{o:o}\", \"modeAfter\": \"{n:o}\""
            )),
        );
        if !flags.name_only && !flags.stat && !c.binary && !c.sourcemap {
            let _ = write!(out, ", \"patch\": {}", js(&c.hunks));
        }
        if c.binary {
            for (key, side) in [("sha256Before", c.old), ("sha256After", c.new)] {
                if let Some(bytes) = side {
                    let _ = write!(out, ", \"{key}\": \"{}\"", sha256_hex(bytes));
                }
            }
        }
        out.extend_from_slice(b" }");
    }
    let _ = write!(
        out,
        "{}],\n  \"notes\": [",
        if changes.is_empty() { "" } else { "\n  " }
    );
    for (i, n) in collect_notes(left, right, changes, false)
        .iter()
        .enumerate()
    {
        let _ = write!(
            out,
            "{}{}",
            if i == 0 { "" } else { ", " },
            js(n.as_bytes())
        );
    }
    let formatting_only = changes.iter().filter(|c| c.formatting_only).count();
    let _ = write!(
        out,
        "],\n  \"totals\": {{ \"files\": {}, \"added\": {}, \"deleted\": {}, \"linesAdded\": {}, \"linesRemoved\": {}, \"formattingOnly\": {} }}\n}}\n",
        changes.len(),
        added,
        deleted,
        lines_added,
        lines_removed,
        formatting_only
    );
    print_lossy(&out);
}

/// What the parser saw that a reviewer would want to know: new imports of consequential builtins, other new
/// module specifiers, and growth in risky API use — aggregated across files so a 40-file package stays readable.
fn ast_notes(changes: &[FileChange<'_>], notes: &mut Vec<String>, colors: bool) {
    let mut builtins: Vec<(Vec<u8>, &[u8])> = Vec::new();
    let mut packages: Vec<Vec<u8>> = Vec::new();
    let mut seen = BTreeSet::new();
    for c in changes {
        for imp in c.new_imports.iter().filter(|&imp| seen.insert(imp)) {
            if normalize::notable_builtin(imp) {
                builtins.push((imp.clone(), c.path));
            } else if !imp.starts_with(b".") && !imp.starts_with(b"/") {
                packages.push(imp.clone());
            }
        }
    }
    for (b, path) in &builtins {
        notes.push(note!(
            colors,
            "now imports <b><magenta>{}<r> <d>({})<r>",
            &[(BStr::new(b)).to_string(), (BStr::new(path)).to_string()],
        ));
    }
    if !packages.is_empty() {
        let shown: Vec<String> = packages
            .iter()
            .take(6)
            .map(|p| note!(colors, "<b>{}<r>", &[BStr::new(p).to_string()]))
            .collect();
        let more = if packages.len() > 6 {
            note!(
                colors,
                " <d>… and {} more<r>",
                &[(packages.len() - 6).to_string()],
            )
        } else {
            String::new()
        };
        notes.push([String::from("new module imports: "), shown.join(", "), more].concat());
    }
    let mut totals: Vec<(&'static str, usize, &[u8])> = Vec::new();
    for c in changes {
        for &(label, n) in &c.signal_deltas {
            match totals.iter_mut().find(|(l, _, _)| *l == label) {
                Some(t) => t.1 += n,
                None => totals.push((label, n, c.path)),
            }
        }
    }
    for (label, n, first_path) in totals {
        // URLs churn in license headers and doc strings; only call out the sharper tools.
        if label.ends_with("URL") && n < 3 {
            continue;
        }
        notes.push(note!(
            colors,
            "<b>+{}<r> {} <d>({}{})<r>",
            &[
                (n).to_string(),
                (label).to_string(),
                (BStr::new(first_path)).to_string(),
                (if n > 1 { ", …" } else { "" }).to_string(),
            ],
        ));
    }
}

/// Renders our colour-tag template at compile time and only then drops the (untrusted) args into its `{}` slots,
/// so package.json text can never be read as markup.
macro_rules! note {
    ($colors:expr, $tpl:literal, &[$($arg:expr),* $(,)?] $(,)?) => {
        fill_note(if $colors { bun_core::pretty_fmt!($tpl, true) } else { bun_core::pretty_fmt!($tpl, false) }, &[$($arg),*])
    };
}
use note;

fn fill_note(rendered: &str, args: &[String]) -> String {
    let mut out = String::with_capacity(rendered.len() + 32);
    let mut args = args.iter();
    let mut rest = rendered;
    while let Some(at) = strings::index_of(rest.as_bytes(), b"{}") {
        out.push_str(&rest[..at]);
        if let Some(a) = args.next() {
            let _ = core::fmt::Write::write_fmt(
                &mut out,
                format_args!("{}", BStr::new(&defang(a.as_bytes()))),
            );
        }
        rest = &rest[at + 2..];
    }
    out.push_str(rest);
    out
}

/// `name@version` → (name, version), minding a leading scope `@`.
fn split_label(label: &[u8]) -> Option<(&[u8], &[u8])> {
    let at = strings::last_index_of_char(label, b'@')?;
    (at > 0).then(|| (&label[..at], &label[at + 1..]))
}

/// The fields that `bun install` reads from the registry manifest's entry for a version, not from
/// the package.json inside the tarball.
const INSTALL_FIELDS: [&[u8]; 8] = [
    b"dependencies",
    b"optionalDependencies",
    b"peerDependencies",
    b"bin",
    b"directories",
    b"os",
    b"cpu",
    b"libc",
];

/// One side's package.json, with each field read from wherever `bun install` would read it.
struct Manifest {
    file: bun_ast::Expr,
    /// The registry manifest's entry for this version.
    entry: Option<bun_ast::Expr>,
    /// The fields of `entry` whose values differ from those in `file`.
    overridden: Vec<&'static [u8]>,
}

impl Manifest {
    fn get(&self, field: &[u8]) -> Option<bun_ast::Expr> {
        match &self.entry {
            Some(entry) if self.overridden.contains(&field) => entry.get(field),
            _ => self.file.get(field),
        }
    }
}

/// Returns the properties of the object `e` whose values are strings.
fn string_pairs(e: Option<&bun_ast::Expr>, bump: &Bump) -> Vec<(Vec<u8>, Vec<u8>)> {
    let Some(obj) = e.and_then(|e| e.data.e_object()) else {
        return Vec::new();
    };
    obj.properties
        .slice()
        .iter()
        .filter_map(|p| {
            Some((
                p.key.as_ref()?.as_string(bump)?.to_vec(),
                p.value.as_ref()?.as_string(bump)?.to_vec(),
            ))
        })
        .collect()
}

/// Returns one of `INSTALL_FIELDS` as sorted pairs, normalized so that two spellings that install
/// the same thing compare equal. A registry rewrites some fields when a package is published.
fn install_view(json: &bun_ast::Expr, field: &[u8], bump: &Bump) -> Vec<(Vec<u8>, Vec<u8>)> {
    let Some(value) = json.get(field) else {
        return Vec::new();
    };
    let mut pairs = string_pairs(Some(&value), bump);
    match field {
        b"bin" => {
            // `"bin": "./cli.js"` is short for `{ "<package name without its scope>": "cli.js" }`.
            if let (Some(path), Some(name)) = (
                value.as_string(bump),
                json.get(b"name").and_then(|name| name.as_string(bump)),
            ) {
                pairs.push((name.to_vec(), path.to_vec()));
            }
            for (name, path) in &mut pairs {
                *name = bun_paths::basename(name).to_vec();
                let mut normal = bun_paths::Path::from(b"/");
                normal.push_inside(&strings::replace_char(path, b'\\', b'/'));
                if path.ends_with(b"/") {
                    normal.push_trailing_sep();
                }
                *path = normal.to_vec();
            }
        }
        b"directories" => pairs.retain(|(name, _)| name == b"bin"),
        b"os" | b"cpu" | b"libc" => {
            if let Some(only) = value.as_string(bump) {
                pairs.push((only.to_vec(), Vec::new()));
            }
            let mut list = value.as_array();
            while let Some(item) = list.as_mut().and_then(|list| list.next()) {
                if let Some(item) = item.as_string(bump) {
                    pairs.push((item.to_vec(), Vec::new()));
                }
            }
        }
        // A package listed in both fields is optional, and some registry entries repeat the
        // optional dependencies under `dependencies`.
        b"dependencies" => {
            let optional = install_view(json, b"optionalDependencies", bump);
            pairs.retain(|(name, _)| {
                (optional.binary_search_by(|(other, _)| other.cmp(name))).is_err()
            });
        }
        _ => {}
    }
    pairs.sort_unstable();
    pairs
}

fn package_json_notes(left: &Tree, right: &Tree, notes: &mut Vec<String>, colors: bool) {
    bun_ast::initialize_store();
    let bump = Bump::new();
    let parse = |bytes: &[u8]| {
        let src: &[u8] = bump.alloc_slice_copy(bytes);
        bun_parsers::json::parse_utf8(
            &bun_ast::Source::init_path_string(b"package.json", src),
            &mut bun_ast::Log::init(),
            &bump,
        )
        .ok()
    };
    let mut side = |tree: &Tree| -> Option<Manifest> {
        let file = parse(tree.files.get(b"package.json".as_slice())?)?;
        let entry = tree.registry_entry.as_deref().and_then(parse);
        let mut overridden = Vec::new();
        for field in INSTALL_FIELDS {
            let Some(entry) = &entry else { break };
            // This command requests the abbreviated registry manifest, which omits `libc`.
            if (field == b"libc" && entry.get(field).is_none())
                || install_view(entry, field, &bump) == install_view(&file, field, &bump)
            {
                continue;
            }
            overridden.push(field);
            let text = |json: &bun_ast::Expr| match json.get(field) {
                Some(value) => expr_text(&value, &bump),
                None => b"nothing".to_vec(),
            };
            let (theirs, ours) = (text(entry), text(&file));
            let at = first_difference(&theirs, &ours);
            notes.push(note!(
                colors,
                "registry and package.json of {} disagree on <b>{}<r>: {} <d>vs<r> {} <d>(bun install uses the registry's)<r>",
                &[
                    BStr::new(&tree.label).to_string(),
                    BStr::new(field).to_string(),
                    BStr::new(&clip(&theirs, at)).to_string(),
                    BStr::new(&clip(&ours, at)).to_string(),
                ],
            ));
        }
        Some(Manifest {
            file,
            entry,
            overridden,
        })
    };
    let (Some(old), Some(new)) = (side(left), side(right)) else {
        return;
    };
    // When a key appears twice, which value wins depends on the tool that reads the file.
    if let Some(object) = new.file.data.e_object() {
        let keys = object
            .properties
            .slice()
            .iter()
            .filter_map(|p| p.key.as_ref()?.as_string(&bump));
        let mut seen = BTreeSet::new();
        for key in keys {
            if !seen.insert(key) {
                notes.push(note!(
                    colors,
                    "<b>{}<r> listed more than once in package.json",
                    &[BStr::new(key).to_string()],
                ));
            }
        }
    }

    const SCRIPT_KEYS: &[&[u8]] = &[
        b"preinstall",
        b"install",
        b"postinstall",
        b"prepare",
        b"prepublish",
        b"preuninstall",
        b"postuninstall",
    ];
    let old_scripts = old.file.get_object(b"scripts");
    let new_scripts = new.file.get_object(b"scripts");
    for key in SCRIPT_KEYS {
        let o = old_scripts.and_then(|s| s.get_string_cloned(&bump, key).ok().flatten());
        let n = new_scripts.and_then(|s| s.get_string_cloned(&bump, key).ok().flatten());
        match (o, n) {
            (None, Some(n)) => notes.push(note!(
                colors,
                "<b>{}<r> script added: <cyan>{}<r>",
                &[(BStr::new(key)).to_string(), (BStr::new(n)).to_string()],
            )),
            (Some(o), Some(n)) if o != n => notes.push(note!(
                colors,
                "<b>{}<r> script changed: <cyan>{}<r>",
                &[(BStr::new(key)).to_string(), (BStr::new(n)).to_string()],
            )),
            _ => {}
        }
    }
    for field in [
        b"dependencies".as_slice(),
        b"optionalDependencies",
        b"peerDependencies",
    ] {
        let o = string_pairs(old.get(field).as_ref(), &bump);
        let n = string_pairs(new.get(field).as_ref(), &bump);
        // A version bump goes from one range to another, like `^1.0.0` → `^1.0.1`. A range that
        // becomes a URL, a repository or an alias of another package is not a bump.
        let is_range = |version: &[u8]| {
            dependency::Tag::infer(version) == dependency::Tag::Npm && !version.starts_with(b"npm:")
        };
        // Of several entries with one name the first counts, so it is inserted last.
        let mut old_versions = BTreeMap::new();
        old_versions.extend(o.iter().rev().map(|(name, ver)| (name, ver)));
        let new_names: BTreeSet<_> = n.iter().map(|(name, _)| name).collect();
        let mut bumps: Vec<String> = Vec::new();
        for (name, ver) in &n {
            match old_versions.get(name) {
                None => notes.push(note!(
                    colors,
                    "{} added: <b>{}<r>@{}",
                    &[
                        (BStr::new(field)).to_string(),
                        (BStr::new(name)).to_string(),
                        (BStr::new(ver)).to_string(),
                    ],
                )),
                Some(&ov) if ov != ver => {
                    let list = if is_range(ov) && is_range(ver) {
                        &mut bumps
                    } else {
                        &mut *notes
                    };
                    list.push(note!(
                        colors,
                        "{} <b>{}<r>: {} → {}",
                        &[
                            (BStr::new(field)).to_string(),
                            (BStr::new(name)).to_string(),
                            (BStr::new(ov)).to_string(),
                            (BStr::new(ver)).to_string(),
                        ],
                    ))
                }
                _ => {}
            }
        }
        // A release that bumps a family of packages in lockstep is one fact, not thirty.
        if bumps.len() > 4 {
            let rest = bumps.len() - 3;
            bumps.truncate(3);
            bumps.push(note!(
                colors,
                "<d>… and {} more {} version changes<r>",
                &[(rest).to_string(), (BStr::new(field)).to_string()],
            ));
        }
        notes.append(&mut bumps);
        for (name, _) in &o {
            if !new_names.contains(name) {
                notes.push(note!(
                    colors,
                    "{} removed: <b>{}<r>",
                    &[
                        (BStr::new(field)).to_string(),
                        (BStr::new(name)).to_string(),
                    ],
                ));
            }
        }
    }
    for field in [
        b"main".as_slice(),
        b"module",
        b"types",
        b"bin",
        b"exports",
        b"engines",
        b"license",
        b"type",
        b"browser",
        b"imports",
        b"directories",
        b"os",
        b"cpu",
        b"libc",
        b"bundleDependencies",
        b"bundledDependencies",
    ] {
        // Compare the full values. Only the text shown in a note is truncated.
        let differ = |(o, n): &(Option<bun_ast::Expr>, Option<bun_ast::Expr>)| {
            o.map(|e| json_text(&e, true)) != n.map(|e| json_text(&e, true))
        };
        // Compare the values `bun install` uses first, then the package.json files, which other
        // tools read.
        let Some((o, n)) = [
            (old.get(field), new.get(field)),
            (old.file.get(field), new.file.get(field)),
        ]
        .into_iter()
        .find(differ) else {
            continue;
        };
        match (o, n) {
            (Some(o), Some(n)) => {
                let (o, n) = (expr_text(&o, &bump), expr_text(&n, &bump));
                let at = first_difference(&o, &n);
                notes.push(note!(
                    colors,
                    "<b>{}<r> changed: {} → {}",
                    &[
                        (BStr::new(field)).to_string(),
                        (BStr::new(&clip(&o, at))).to_string(),
                        (BStr::new(&clip(&n, at))).to_string(),
                    ],
                ))
            }
            (None, Some(n)) => notes.push(note!(
                colors,
                "<b>{}<r> added: {}",
                &[
                    (BStr::new(field)).to_string(),
                    (BStr::new(&clip(&expr_text(&n, &bump), 0))).to_string(),
                ],
            )),
            (Some(_), None) => notes.push(note!(
                colors,
                "<b>{}<r> removed",
                &[(BStr::new(field)).to_string()],
            )),
            (None, None) => {}
        }
    }
}

/// Prints `e` as JSON. With `minify_whitespace`, the text does not depend on how the file that `e`
/// was read from is formatted.
fn json_text(e: &bun_ast::Expr, minify_whitespace: bool) -> Vec<u8> {
    let mut printer = bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init());
    let source = bun_ast::Source::init_path_string(b"package.json", b"".as_slice());
    let _ = bun_js_printer::print_json(
        &mut printer,
        *e,
        &source,
        bun_js_printer::PrintJsonOptions {
            // No caller shows the indentation.
            indent: bun_ast::Indentation {
                scalar: 0,
                ..Default::default()
            },
            mangled_props: None,
            minify_whitespace,
        },
    );
    printer.ctx.get_written().to_vec()
}

/// Prints `e` on a single line, for use in a note.
fn expr_text(e: &bun_ast::Expr, bump: &Bump) -> Vec<u8> {
    if let Some(s) = e.as_string(bump) {
        return s.to_vec();
    }
    // Collapse the printer's line breaks.
    let mut out: Vec<u8> = Vec::new();
    let mut last_space = false;
    for b in json_text(e, false) {
        let ws = b == b'\n' || b == b' ' || b == b'\t';
        if ws {
            if !last_space {
                out.push(b' ');
            }
        } else {
            out.push(b);
        }
        last_space = ws;
    }
    out
}

fn first_difference(a: &[u8], b: &[u8]) -> usize {
    a.iter().zip(b).take_while(|(a, b)| a == b).count()
}

/// Returns at most about 120 bytes of `text`, in a window that includes the byte at index `at`.
fn clip(text: &[u8], at: usize) -> Vec<u8> {
    if text.len() <= 120 {
        return text.to_vec();
    }
    // Never cut in the middle of a UTF-8 sequence.
    let boundary = |mut i: usize| {
        while i > 0 && i < text.len() && text[i] & 0xC0 == 0x80 {
            i -= 1;
        }
        i
    };
    let start = if at < 100 { 0 } else { boundary(at - 40) };
    let end = boundary((start + 117).min(text.len()));
    let dots = |cut: bool| -> &'static [u8] { if cut { b"..." } else { b"" } };
    [dots(start > 0), &text[start..end], dots(end < text.len())].concat()
}

pub(crate) struct Lines<'a>(pub &'a [u8]);
impl<'a> Iterator for Lines<'a> {
    type Item = &'a [u8];
    fn next(&mut self) -> Option<&'a [u8]> {
        if self.0.is_empty() {
            return None;
        }
        match strings::index_of_char(self.0, b'\n') {
            Some(i) => {
                let i = i as usize;
                let (line, rest) = self.0.split_at(i + 1);
                self.0 = rest;
                Some(&line[..i])
            }
            None => {
                let line = self.0;
                self.0 = b"";
                Some(line)
            }
        }
    }
}

/// Line tints for removed/added lines and the stronger tint for the differing span within them.
#[derive(Clone, Copy)]
enum Tint {
    None,
    Del,
    DelStrong,
    Ins,
    InsStrong,
}

/// Indexed by `Tint`.
type Palette = [&'static str; 5];

/// GitHub's diff colours where the terminal can show them exactly, the nearest xterm-256 cells otherwise; the
/// light set keeps default (dark) text readable, the dark set keeps default (light) text readable.
static PALETTES: [Palette; 4] = [
    // dark, 256
    [
        "",
        "\x1b[48;5;52m",
        "\x1b[48;5;88m",
        "\x1b[48;5;22m",
        "\x1b[48;5;28m",
    ],
    // dark, truecolor
    [
        "",
        "\x1b[48;2;68;20;24m",
        "\x1b[48;2;134;40;48m",
        "\x1b[48;2;18;54;30m",
        "\x1b[48;2;30;104;52m",
    ],
    // light, 256
    [
        "",
        "\x1b[48;5;224m",
        "\x1b[48;5;217m",
        "\x1b[48;5;194m",
        "\x1b[48;5;157m",
    ],
    // light, truecolor
    [
        "",
        "\x1b[48;2;255;235;233m",
        "\x1b[48;2;255;193;192m",
        "\x1b[48;2;218;251;225m",
        "\x1b[48;2;172;238;187m",
    ],
];

/// Plain output is a valid unified patch; a terminal gets a gutter with line numbers instead of `@@` headers.
#[derive(Clone, Copy)]
struct Style {
    pretty: bool,
    /// True when the output goes to a terminal, either in color or (with `NO_COLOR`) as a plain
    /// patch. Bytes from a package then go through `defang`.
    escape: bool,
    /// False with `--name-only` and `--stat`, which only count the changed lines.
    hunks: bool,
    width: usize,
    palette: &'static Palette,
}

impl Style {
    fn detect(flags: DiffFlags) -> Style {
        let pretty = !flags.json && Output::enable_ansi_colors_stdout();
        // `| less -R` / `| head` still render on the terminal stderr is attached to; `COLUMNS` has the last word.
        let winsize = |fd: bun_core::Fd| {
            bun_core::output::File::from(fd)
                .winsize()
                .map(|w| w.col as usize)
                .filter(|&c| c > 0)
        };
        let width = bun_core::env_var::COLUMNS
            .get()
            .map(|c| c as usize)
            .or_else(|| winsize(bun_core::Fd::stdout()))
            .or_else(|| winsize(bun_core::Fd::stderr()))
            .unwrap_or(80)
            .clamp(40, 160);
        let palette = if pretty {
            let truecolor = bun_core::env_var::COLORTERM.get().is_some_and(|v| {
                strings::eql_comptime(v, b"truecolor") || strings::eql_comptime(v, b"24bit")
            });
            let light = bun_md::root::detect_light_background_probing();
            &PALETTES[usize::from(light) * 2 + usize::from(truecolor)]
        } else {
            &PALETTES[0]
        };
        Style {
            pretty,
            escape: pretty || (!flags.json && Output::is_stdout_tty()),
            hunks: !flags.name_only && !flags.stat,
            width,
            palette,
        }
    }

    fn hunk_header(
        self,
        out: &mut Vec<u8>,
        (old_start, old_len, new_start, new_len): (usize, usize, usize, usize),
        first: bool,
    ) {
        if self.pretty {
            if !first {
                out.extend_from_slice("\x1b[2m    ⋮\x1b[0m\n".as_bytes());
            }
        } else {
            let _ = writeln!(out, "@@ -{old_start},{old_len} +{new_start},{new_len} @@");
        }
    }

    /// `emph` is the byte range that differs from this line's -/+ partner; it gets a stronger tint and, on lines
    /// wider than the terminal, the shared prefix before it is elided so the change is on screen.
    #[allow(clippy::too_many_arguments)]
    fn line(
        self,
        out: &mut Vec<u8>,
        op: Operation,
        old_no: usize,
        new_no: usize,
        text: &[u8],
        highlight: bool,
        emph: Option<(usize, usize)>,
        affected: bool,
        pos: Option<(u32, u32)>,
    ) {
        let sign = match op {
            Operation::Equal if affected => b'~',
            Operation::Equal => b' ',
            Operation::Delete => b'-',
            Operation::Insert => b'+',
        };
        if !self.pretty {
            out.push(sign);
            if self.escape {
                out.extend_from_slice(&defang(text));
            } else {
                out.extend_from_slice(text);
            }
            out.push(b'\n');
            return;
        }
        // Nothing from the package may drive the terminal: CR, ESC and friends become visible marks.
        let text = text.strip_suffix(b"\r").unwrap_or(text);
        let emph = emph.map(|(lo, hi)| {
            (
                defang(&text[..lo.min(text.len())]).len(),
                defang(&text[..hi.min(text.len())]).len(),
            )
        });
        let text: &[u8] = &defang(text);
        // Changed lines get a tinted background so the foreground is free for syntax colours.
        let (num, accent, tint, strong) = match op {
            // Unchanged text whose meaning moved (now dead, or newly live): flagged, not tinted.
            Operation::Equal if affected => (new_no, "\x1b[33m", Tint::None, Tint::None),
            Operation::Equal => (new_no, "\x1b[2m", Tint::None, Tint::None),
            Operation::Delete => (old_no, "\x1b[31m", Tint::Del, Tint::DelStrong),
            Operation::Insert => (new_no, "\x1b[32m", Tint::Ins, Tint::InsStrong),
        };
        let bg = self.palette[tint as usize];
        // Re-printed (un-minified) lines are numbered by where they sit in the original: `line:col`.
        // `(0, 0)` is the no-mapping sentinel (CSS/JSON re-prints have no source map): plain numbering then.
        let pos = pos.filter(|&(l, _)| l > 0);
        let gw: usize = if pos.is_some() { 9 } else { 5 };
        let (mut line_buf, mut col_buf) = (bun_fmt::ItoaBuf::new(), bun_fmt::ItoaBuf::new());
        let (line, colon, col): (&[u8], &[u8], &[u8]) = match pos {
            Some((l, c)) => (
                bun_fmt::itoa(&mut line_buf, l),
                b":",
                bun_fmt::itoa(&mut col_buf, c),
            ),
            None => (bun_fmt::itoa(&mut line_buf, num), b"", b""),
        };
        let padding = gw.saturating_sub(line.len() + colon.len() + col.len());
        for part in [
            accent.as_bytes(),
            &b"         "[..padding],
            line,
            colon,
            col,
            " \x1b[0m\x1b[2m│\x1b[0m".as_bytes(),
            bg.as_bytes(),
            accent.as_bytes(),
            b"\x1b[1m",
            &[sign],
            b" \x1b[0m",
            bg.as_bytes(),
        ] {
            out.extend_from_slice(part);
        }
        let budget = self.width.saturating_sub(gw + 4);
        match emph {
            Some((lo, hi)) if lo < hi || text.len() > budget => {
                let mut prefix = &text[..lo];
                // Keep ~24 columns of lead-in; drop the rest of a long shared prefix.
                if text.len() > budget && lo > 32 {
                    let mut cut = lo - 24;
                    // Land the cut between tokens rather than mid-identifier when one is near.
                    let ident = |b: u8| {
                        b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b & 0x80 != 0
                    };
                    for _ in 0..16 {
                        if cut == 0 || !ident(text[cut - 1]) || !ident(text[cut]) {
                            break;
                        }
                        cut -= 1;
                    }
                    while cut > 0 && text[cut] & 0xC0 == 0x80 {
                        cut -= 1;
                    }
                    out.extend_from_slice("\x1b[2m…\x1b[22m".as_bytes());
                    out.extend_from_slice(bg.as_bytes());
                    prefix = &text[cut..lo];
                }
                segment(out, prefix, highlight, tint);
                out.extend_from_slice(self.palette[strong as usize].as_bytes());
                segment(out, &text[lo..hi], highlight, strong);
                out.extend_from_slice(bg.as_bytes());
                segment(out, &text[hi..], highlight, tint);
            }
            _ if op == Operation::Equal && text.len() > budget && budget > 16 => {
                // Context nobody will read to the end: one screen line is enough.
                let mut cut = budget - 1;
                while cut > 0 && text[cut] & 0xC0 == 0x80 {
                    cut -= 1;
                }
                segment(out, &text[..cut], highlight, tint);
                out.extend_from_slice("\x1b[2m…\x1b[0m".as_bytes());
            }
            _ => segment(out, text, highlight, tint),
        }
        // Erase-to-EOL carries the tint to the edge before resetting.
        out.extend_from_slice(if bg.is_empty() {
            b"\x1b[0m\n".as_slice()
        } else {
            b"\x1b[K\x1b[0m\n".as_slice()
        });
    }

    /// Copies `lines`, with syntax colours for the code that `segment` has marked in them.
    fn highlight(self, out: &mut Vec<u8>, mut lines: &[u8]) {
        while let Some((plain, [tint, marked @ ..])) = strings::split_once_char(lines, CODE_START)
            && let Some((code, rest)) = strings::split_once_char(marked, CODE_END)
        {
            out.extend_from_slice(plain);
            let bg = self.palette[usize::from(*tint)];
            let hl = bun_core::fmt::fmt_javascript(
                code,
                bun_core::fmt::HighlighterOptions {
                    enable_colors: true,
                    check_for_unhighlighted_write: false,
                    ..Default::default()
                },
            );
            let before = out.len();
            if core::fmt::write(&mut Tinted { out, bg }, format_args!("{hl}")).is_err() {
                out.truncate(before);
                out.extend_from_slice(code);
            }
            lines = rest;
        }
        out.extend_from_slice(lines);
    }

    /// `path ─────────────── +3 -1`, sized to the terminal.
    fn file_header(self, out: &mut Vec<u8>, c: &FileChange<'_>) {
        let note = match c.semantic {
            Semantic::Text => "",
            Semantic::FormattingOnly => "\x1b[2mformatting only\x1b[0m",
            Semantic::WhitespaceOnly => "\x1b[2mwhitespace only\x1b[0m",
            Semantic::LineEndingsOnly => "\x1b[2mline endings only\x1b[0m",
            Semantic::ModeOnly => "",
            Semantic::Projected => "",
            Semantic::Normalized => "\x1b[35munminified\x1b[0m ",
            Semantic::Reprinted => "\x1b[2mnormalized\x1b[0m ",
        };
        let mut badge = match (c.old, c.new, c.binary) {
            _ if matches!(
                c.semantic,
                Semantic::FormattingOnly | Semantic::WhitespaceOnly | Semantic::LineEndingsOnly
            ) =>
            {
                note.to_string()
            }
            _ if c.sourcemap => format!(
                "\x1b[2msource map {} → {} bytes\x1b[0m",
                c.old.map_or(0, <[u8]>::len),
                c.new.map_or(0, <[u8]>::len)
            ),
            (_, _, true) => format!("\x1b[33mbinary\x1b[0m \x1b[2m{}\x1b[0m", binary_summary(c)),
            (None, Some(_), _) => format!("{note}\x1b[32mnew\x1b[0m \x1b[32m+{}\x1b[0m", c.added),
            (Some(_), None, _) => {
                format!("{note}\x1b[31mdeleted\x1b[0m \x1b[31m-{}\x1b[0m", c.removed)
            }
            _ => {
                let mut s = String::from(note);
                if c.added > 0 {
                    s.push_str(&format!("\x1b[32m+{}\x1b[0m", c.added));
                }
                if c.removed > 0 {
                    if !s.is_empty() {
                        s.push(' ');
                    }
                    s.push_str(&format!("\x1b[31m-{}\x1b[0m", c.removed));
                }
                s
            }
        };
        if let Some((o, n)) = c.mode_change {
            let mode = if o == 0 {
                format!("\x1b[33mexecutable\x1b[0m {n:o}")
            } else {
                format!("\x1b[33mmode\x1b[0m {o:o} → {n:o}")
            };
            badge = if c.semantic == Semantic::ModeOnly {
                mode
            } else {
                format!("{mode} {badge}")
            };
        }
        if c.hidden > 0 {
            badge = format!("\x1b[2m{} folded\x1b[0m {badge}", c.hidden);
        }
        if let Some(why) = c.not_normalized {
            badge = format!("\x1b[2m{why}\x1b[0m {badge}");
        }
        let badge_width = strip_ansi_len(badge.as_bytes());
        let mut shown_path = defang(c.path);
        // A path too long for the line keeps its tail: the file name is the part that matters.
        let room = self.width.saturating_sub(badge_width + 8);
        if strip_ansi_len(&shown_path) > room && room > 8 {
            let mut cut = shown_path.len() - shown_path.len().min(room - 1);
            while cut < shown_path.len() && (shown_path[cut] & 0xC0) == 0x80 {
                cut += 1;
            }
            shown_path = ["…".as_bytes(), &shown_path[cut..]].concat().into();
        }
        let rule = self
            .width
            .saturating_sub(strip_ansi_len(&shown_path) + badge_width + 4)
            .max(2);
        let _ = write!(
            out,
            "\n\x1b[1m{}\x1b[0m \x1b[2m{}\x1b[0m {}\n",
            BStr::new(&shown_path),
            "─".repeat(rule),
            badge
        );
    }
}

/// Around code that `Style::highlight` is to colour. `defang` leaves neither in the text of a file.
const CODE_START: u8 = 0x0e;
const CODE_END: u8 = 0x0f;

fn segment(out: &mut Vec<u8>, text: &[u8], highlight: bool, tint: Tint) {
    if highlight && !text.is_empty() && text.len() <= 4096 {
        out.extend_from_slice(&[CODE_START, tint as u8]);
        out.extend_from_slice(text);
        out.push(CODE_END);
    } else {
        out.extend_from_slice(text);
    }
}

/// Splits at `at`, or after the marked code or the character that `at` is inside of. `text` starts outside of both.
fn split_marked(text: &[u8], at: usize) -> (&[u8], &[u8]) {
    let mut at = at.min(text.len());
    if let Some(start) = strings::last_index_of_char(&text[..at], CODE_START)
        && let Some(len) = strings::index_of_char_usize(&text[start..], CODE_END)
    {
        at = at.max(start + len + 1);
    }
    // A character has three of these at most, so the halves get U+FFFD where the whole would.
    let continues = |byte: &&u8| **byte & 0xC0 == 0x80;
    text.split_at(at + text[at..].iter().take(3).take_while(continues).count())
}

/// The highlighter resets all attributes between tokens. This puts the tint back after each reset.
struct Tinted<'a> {
    out: &'a mut Vec<u8>,
    bg: &'a str,
}

impl core::fmt::Write for Tinted<'_> {
    fn write_str(&mut self, text: &str) -> core::fmt::Result {
        const RESET: &[u8] = b"\x1b[0m";
        let mut rest = text.as_bytes();
        while let Some(at) = strings::index_of(rest, RESET) {
            let part;
            (part, rest) = rest.split_at(at + RESET.len());
            self.out.extend_from_slice(part);
            self.out.extend_from_slice(self.bg.as_bytes());
        }
        self.out.extend_from_slice(rest);
        Ok(())
    }
}

fn strip_ansi_len(s: &[u8]) -> usize {
    let (mut n, mut in_esc) = (0, false);
    for &b in s {
        match (in_esc, b) {
            (false, 0x1b) => in_esc = true,
            (true, b'm') => in_esc = false,
            (true, _) => {}
            // Count UTF-8 scalar starts, not continuation bytes.
            (false, b) => n += usize::from(b & 0xC0 != 0x80),
        }
    }
    n
}

/// For a `-` line immediately followed by exactly one `+` line (or vice versa), the byte range where they differ.
fn pair_emphasis(ops: &[Op<'_>], k: usize) -> Option<(usize, usize)> {
    let (op, text) = (ops[k].kind, ops[k].text);
    let partner = match op {
        Operation::Delete
            if k + 1 < ops.len()
                && ops[k + 1].kind == Operation::Insert
                && ops.get(k + 2).is_none_or(|o| o.kind != Operation::Insert)
                && (k == 0 || ops[k - 1].kind != Operation::Delete) =>
        {
            ops[k + 1].text
        }
        Operation::Insert
            if k > 0
                && ops[k - 1].kind == Operation::Delete
                && ops.get(k + 1).is_none_or(|o| o.kind != Operation::Insert)
                && (k < 2 || ops[k - 2].kind != Operation::Delete) =>
        {
            ops[k - 1].text
        }
        _ => return None,
    };
    let mut lo = text.iter().zip(partner).take_while(|(a, b)| a == b).count();
    let max_suffix = text.len().min(partner.len()) - lo;
    let suffix = text
        .iter()
        .rev()
        .zip(partner.iter().rev())
        .take(max_suffix)
        .take_while(|(a, b)| a == b)
        .count();
    let mut hi = text.len() - suffix;
    while lo > 0 && text.get(lo).is_some_and(|b| b & 0xC0 == 0x80) {
        lo -= 1;
    }
    while hi < text.len() && text[hi] & 0xC0 == 0x80 {
        hi += 1;
    }
    Some((lo, hi))
}

/// Line diff via diff-match-patch, rendered as unified hunks with `context` lines around each change.
const NO_NEWLINE_MARKER: &[u8] = b"\\ No newline at end of file\n";

fn unified_hunks(
    old: &[u8],
    new: &[u8],
    context: usize,
    style: Style,
    change: &mut FileChange<'_>,
) {
    // The terminal view compares CRLF files as if they were LF, so a line-ending flip is not a wall of -/+.
    let (old_v, new_v);
    let (old, new) = if style.pretty {
        (old_v, new_v) = (view_bytes(old), view_bytes(new));
        (&*old_v, &*new_v)
    } else {
        (old, new)
    };
    let ops = semantic::line_ops(old, new);
    // `patch`/`git apply` need to know when a side's last line had no terminator.
    let unterminated = (
        !old.is_empty() && !old.ends_with(b"\n"),
        !new.is_empty() && !new.ends_with(b"\n"),
    );
    render_ops(&ops, context, style, change, unterminated);
}

/// The un-minified view of a file: its leading comment block as written (the print drops it), then the print;
/// alongside, each shown line's original `line:col`.
struct Shown {
    text: Vec<u8>,
    origin: Vec<(u32, u32)>,
    /// Printed line `g` is shown at line `g + banner - skipped` (lines `< skipped` are not shown).
    banner: u32,
    skipped: u32,
}

fn with_banner(raw: &[u8], norm: &normalize::Normalized) -> Shown {
    let mut i = 0usize;
    loop {
        while i < raw.len() && raw[i].is_ascii_whitespace() {
            i += 1;
        }
        if raw[i..].starts_with(b"//") {
            i = strings::index_of_char(&raw[i..], b'\n').map_or(raw.len(), |e| i + e as usize);
        } else if raw[i..].starts_with(b"/*") {
            i = strings::index_of(&raw[i + 2..], b"*/").map_or(raw.len(), |e| i + 2 + e + 2);
        } else {
            break;
        }
    }
    // Back to the end of the banner's last full line, so code sharing a line with it stays with the print.
    let end = strings::last_index_of_char(&raw[..i], b'\n').map_or(0, |p| p + 1);
    let banner = &raw[..end];
    let mut text = Vec::with_capacity(banner.len() + norm.text.len());
    let mut origin = Vec::new();
    for (l, line) in Lines(banner).enumerate() {
        text.extend_from_slice(line.trim_ascii_end());
        text.push(b'\n');
        origin.push((l as u32 + 1, 1));
    }
    // The printer keeps some of those comments (`/*!`, `@license`) itself; the written banner supersedes them.
    let printed_origin = origin_of(norm);
    let mut skip = 0usize;
    let mut in_block = false;
    let mut offset = 0usize;
    for line in Lines(&norm.text) {
        let t = line.trim_ascii();
        let comment = in_block || t.is_empty() || t.starts_with(b"//") || t.starts_with(b"/*");
        if !comment || banner.is_empty() {
            break;
        }
        if t.starts_with(b"/*") {
            in_block = true;
        }
        if in_block && strings::contains(t, b"*/") {
            in_block = false;
        }
        skip += 1;
        offset += line.len() + 1;
    }
    let banner = origin.len() as u32;
    text.extend_from_slice(&norm.text[offset.min(norm.text.len())..]);
    origin.extend(printed_origin.into_iter().skip(skip));
    Shown {
        text,
        origin,
        banner,
        skipped: skip as u32,
    }
}

/// Re-address a key's source map from the minified original onto the lines of the un-minified display, so the
/// projection can treat that display as "the source": same AST nodes, so the original positions coincide.
fn rebase_key_onto(
    key: &mut normalize::Normalized,
    shown: &Shown,
    display: &normalize::Normalized,
) {
    // Sorted by source position. The first print of a position comes first.
    let mut at: Vec<_> = (display.map.iter())
        .filter(|m| m.gen_line >= shown.skipped)
        .map(|m| ((m.orig_line, m.orig_col), (m.gen_line, m.gen_col)))
        .collect();
    at.sort_unstable();
    key.map.retain_mut(|m| {
        let original = (m.orig_line, m.orig_col);
        match at.get(at.partition_point(|it| it.0 < original)) {
            Some(&(found, (line, col))) if found == original => {
                m.orig_line = line + shown.banner - shown.skipped;
                m.orig_col = col;
                true
            }
            _ => false,
        }
    });
}

/// Printed line → original `line:col` of the first thing on it, for gutters in the un-minified view.
fn origin_of(norm: &normalize::Normalized) -> Vec<(u32, u32)> {
    let lines = strings::count_char(&norm.text, b'\n') + 1;
    let mut out = vec![(0u32, 0u32); lines];
    // The first mapping at or after the indentation: one emitted at column 0 belongs to the line break itself.
    let indents: Vec<u32> = Lines(&norm.text)
        .map(|l| l.iter().take_while(|&&b| b == b' ').count() as u32)
        .collect();
    for m in norm.map.iter().rev() {
        let g = m.gen_line as usize;
        if let (Some(slot), Some(&indent)) = (out.get_mut(g), indents.get(g)) {
            if m.gen_col >= indent || *slot == (0, 0) {
                *slot = (m.orig_line + 1, m.orig_col + 1);
            }
        }
    }
    // Lines the printer added on its own (a lone `}`) inherit the position above them.
    for i in 1..out.len() {
        if out[i] == (0, 0) {
            out[i] = out[i - 1];
        }
    }
    out
}

/// What the terminal view compares and shows for a text file: line-ending CRs dropped.
fn view_bytes(bytes: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    // A missing newline at EOF is the patch's business (`\ No newline…`), not a visible -/+ pair of equal lines.
    let terminated = bytes.is_empty() || bytes.ends_with(b"\n");
    if strings::contains_char(bytes, b'\r') || !terminated {
        let mut v = strip_cr(bytes);
        if !v.is_empty() && !v.ends_with(b"\n") {
            v.push(b'\n');
        }
        std::borrow::Cow::Owned(v)
    } else {
        std::borrow::Cow::Borrowed(bytes)
    }
}

/// Windows of `context` lines around every change (a `~` affected line counts as one), rendered per the style.
fn render_ops(
    ops: &[Op<'_>],
    context: usize,
    style: Style,
    change: &mut FileChange<'_>,
    (old_unterminated, new_unterminated): (bool, bool),
) {
    for op in ops {
        match op.kind {
            Operation::Insert => change.added += 1,
            Operation::Delete => change.removed += 1,
            Operation::Equal => {}
        }
    }
    if !style.hunks {
        return;
    }
    let is_change = |op: &Op| op.kind != Operation::Equal || op.affected;
    let last_old = ops.iter().rposition(|op| op.kind != Operation::Insert);
    let last_new = ops.iter().rposition(|op| op.kind != Operation::Delete);
    let n = ops.len();
    let mut i = 0;
    let mut first = true;
    while i < n {
        if !is_change(&ops[i]) {
            i += 1;
            continue;
        }
        let mut start = i;
        while start > 0 && !is_change(&ops[start - 1]) && i - start < context {
            start -= 1;
        }
        // Extend until more than 2*context quiet lines in a row (or the end), then keep `context` of them.
        let mut end = i;
        let mut quiet = 0;
        while end < n {
            if is_change(&ops[end]) {
                quiet = 0;
            } else {
                quiet += 1;
                if quiet > 2 * context {
                    break;
                }
            }
            end += 1;
        }
        let mut e = end;
        let mut trailing = 0;
        while e > start && !is_change(&ops[e - 1]) {
            trailing += 1;
            e -= 1;
        }
        let end = e + trailing.min(context);
        let window = &ops[start..end];

        let old_len = window
            .iter()
            .filter(|op| op.kind != Operation::Insert)
            .count();
        let new_len = window
            .iter()
            .filter(|op| op.kind != Operation::Delete)
            .count();
        // An op numbers the line it consumed; a side that did not advance still names the line before the gap.
        let old_start = window
            .iter()
            .find(|op| op.kind != Operation::Insert)
            .map_or(window[0].old_no, |op| op.old_no);
        let new_start = window
            .iter()
            .find(|op| op.kind != Operation::Delete)
            .map_or(window[0].new_no, |op| op.new_no);
        style.hunk_header(
            &mut change.hunks,
            (old_start, old_len, new_start, new_len),
            first,
        );
        first = false;
        for (k, op) in window.iter().enumerate() {
            let emph = pair_emphasis(window, k);
            let pos = change.origin.as_ref().map(|[o, n]| {
                let (side, no) = if op.kind == Operation::Delete {
                    (o, op.old_no)
                } else {
                    (n, op.new_no)
                };
                side.get(no.wrapping_sub(1)).copied().unwrap_or((0, 0))
            });
            style.line(
                &mut change.hunks,
                op.kind,
                op.old_no,
                op.new_no,
                op.text,
                change.highlight,
                emph,
                op.affected,
                pos,
            );
            let idx = start + k;
            if !style.pretty
                && ((Some(idx) == last_old && old_unterminated)
                    || (Some(idx) == last_new && new_unterminated))
            {
                change.hunks.extend_from_slice(NO_NEWLINE_MARKER);
            }
        }
        i = end;
    }
}
