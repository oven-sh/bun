//! `bun pm diff` — show what changed between two versions of a package (or a package and a folder/tarball).

use std::collections::BTreeMap;
use std::io::Write as _;

use bstr::BStr;
use bun_alloc::Arena as Bump;
use bun_collections::VecExt as _;
use bun_core::MutableString;
use bun_core::fmt as bun_fmt;
use bun_core::strings::{self, StringOrTinyString};
use bun_core::{Global, Output, pretty, prettyln};
use bun_http as http;
use bun_install::dependency;
use bun_install::lockfile::LoadResult;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::npm::{self, PackageManifest};
use bun_install::{PackageManager, resolution};
use bun_libarchive::lib::{ArchiveIterator, IteratorResult as ArchiveIterResult};
use bun_paths::PathBuffer;
use bun_semver as Semver;
use bun_sys::{Fd, FdExt as _, dir_iterator as DirIterator};
use bun_url::URL;

use crate::cli::pm_diff_normalize as normalize;
use crate::cli::pm_diff_semantic::{self as semantic, Op};
use crate::test_runner::diff::diff_match_patch::Operation;

use bun_core::fmt::buf_print_infallible as buf_print;

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
    let typed: Vec<&[u8]> = diff_args
        .iter()
        .chain(positionals.iter().skip(1))
        .copied()
        .collect();
    let args: Vec<Vec<u8>> = typed
        .iter()
        .map(|&arg| {
            use bun_paths::resolve_path::{join_abs_string, platform};
            match (arg.strip_prefix(b"~/"), bun_core::env_var::HOME.get()) {
                (Some(rest), Some(home)) => {
                    join_abs_string::<platform::Auto>(home, &[rest]).to_vec()
                }
                _ if looks_like_path(arg) && !bun_paths::is_absolute(arg) => {
                    join_abs_string::<platform::Auto>(original_cwd, &[arg]).to_vec()
                }
                _ => arg.to_vec(),
            }
        })
        .collect();
    if args.len() > 2 {
        Output::err_generic("bun pm diff takes at most two package specs or paths", ());
        Global::exit(1);
    }

    let (mut left_spec, mut right_spec) = resolve_sides(pm, &args, original_cwd);
    // `bun pm diff ./pkg` / `./pkg 2.0.0`: a registry side without a name takes it from the local side's package.json.
    let mut left_early: Option<Tree> = None;
    if let (Spec::Dir(_) | Spec::Tarball(_), Spec::Registry { name, .. }) =
        (&left_spec, &mut right_spec)
    {
        if name.is_empty() {
            let local = materialize(pm, &left_spec)?;
            *name = package_name_in(&local).unwrap_or_else(|| {
                Output::err_generic(
                    "{} has no package.json \"name\" to look up in the registry",
                    (BStr::new(&local.label),),
                );
                Global::exit(1);
            });
            left_early = Some(local);
        }
    }
    let mut right = materialize(pm, &right_spec)?;
    if let Spec::Registry { name, .. } = &mut left_spec {
        if name.is_empty() {
            *name = package_name_in(&right).unwrap_or_else(|| {
                Output::err_generic(
                    "{} has no package.json \"name\" to look up in the registry",
                    (BStr::new(&right.label),),
                );
                Global::exit(1);
            });
        }
    }
    let mut left = match left_early {
        Some(tree) => tree,
        None => materialize(pm, &left_spec)?,
    };
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
    print_diff(&left, &right, flags);
    Output::flush();
    Ok(())
}

// ─── spec resolution ────────────────────────────────────────────────────────

fn looks_like_path(spec: &[u8]) -> bool {
    spec.starts_with(b".")
        || spec.starts_with(b"/")
        || spec.starts_with(b"~/")
        || (cfg!(windows) && (spec.starts_with(b"\\") || (spec.len() > 2 && spec[1] == b':')))
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
                let installed = installed_version(pm, &name).unwrap_or_else(|| {
                    Output::err_generic("{} is not in this project's lockfile; give two versions to compare, e.g. `bun pm diff {}@1.0.0 {}@2.0.0`", (BStr::new(&name), BStr::new(&name), BStr::new(&name)));
                    Global::exit(1);
                });
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
            let left = classify(a);
            let is_bare_version = |s: &Spec| matches!(s, Spec::Registry { name, version } if version.is_empty() && Semver::Version::parse(Semver::SlicedString::init(name, name)).valid);
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

fn package_name_in(tree: &Tree) -> Option<Vec<u8>> {
    let bytes = tree.files.get(b"package.json".as_slice())?;
    let bump = Bump::new();
    let src: &[u8] = bump.alloc_slice_copy(bytes);
    let json = bun_parsers::json::parse_utf8(
        &bun_ast::Source::init_path_string(b"package.json", src),
        &mut bun_ast::Log::init(),
        &bump,
    )
    .ok()?;
    let name = json.get_string_cloned(&bump, b"name").ok().flatten()?;
    (!name.is_empty()).then(|| name.to_vec())
}

fn root_package_name(pm: &PackageManager, original_cwd: &[u8]) -> Vec<u8> {
    let mut path = original_cwd.to_vec();
    path.extend_from_slice(b"/package.json");
    // The folder we are in, before the workspace root the manager walked up to.
    if let Ok(bytes) = bun_sys::File::read_from(Fd::cwd(), &path) {
        let bump = Bump::new();
        let src: &[u8] = bump.alloc_slice_copy(&bytes);
        if let Ok(json) = bun_parsers::json::parse_utf8(
            &bun_ast::Source::init_path_string(b"package.json", src),
            &mut bun_ast::Log::init(),
            &bump,
        ) {
            if let Some(name) = json.get_string_cloned(&bump, b"name").ok().flatten() {
                if !name.is_empty() {
                    return name.to_vec();
                }
            }
        }
    }
    let name = &pm.root_package_json_name_at_time_of_init;
    if name.is_empty() {
        Output::err_generic(
            "no package name to compare against: run this inside a package, or pass two specs (e.g. `bun pm diff react@18.0.0 react@19.0.0`)",
            (),
        );
        Global::exit(1);
    }
    name.to_vec()
}

/// The npm version of `name` this project's lockfile resolved, if any.
fn installed_version(pm: &mut PackageManager, name: &[u8]) -> Option<Vec<u8>> {
    // Detach the lockfile while it loads so it and the manager are not borrowed through each other.
    let mut lockfile = core::mem::take(&mut pm.lockfile);
    let mut log = bun_ast::Log::init();
    let log_level = pm.options.log_level;
    let loaded = match lockfile.load_from_cwd::<true>(Some(pm), &mut log) {
        LoadResult::Ok(_) => true,
        LoadResult::NotFound => false,
        // A lockfile that exists but will not load is reported as that, not as "package not installed".
        broken @ LoadResult::Err(_) => {
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            crate::cli::package_manager_command::PackageManagerCommand::handle_load_lockfile_errors(
                &broken, log_level,
            );
            false
        }
    };
    pm.lockfile = lockfile;
    if !loaded {
        return None;
    }
    let lockfile = &*pm.lockfile;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let resolutions = lockfile.packages.items_resolution();
    let mut best: Option<Vec<u8>> = None;
    for (i, pkg_name) in names.iter().enumerate() {
        if pkg_name.slice(string_buf) != name || resolutions[i].tag != resolution::Tag::Npm {
            continue;
        }
        let mut v = Vec::new();
        let _ = write!(&mut v, "{}", resolutions[i].npm().version.fmt(string_buf));
        // Several copies may be installed; the first listed is the hoisted/root one.
        best.get_or_insert(v);
    }
    best
}

// ─── materializing a side ───────────────────────────────────────────────────

fn materialize(pm: &mut PackageManager, spec: &Spec) -> Result<Tree, crate::Error> {
    match spec {
        Spec::Registry { name, version } => fetch_registry_tree(pm, name, version),
        Spec::Tarball(path) => {
            let bytes = match bun_sys::File::read_from(Fd::cwd(), path) {
                Ok(b) => b,
                Err(err) => {
                    Output::err(err, "failed to read {}", (BStr::new(path),));
                    Global::exit(1);
                }
            };
            let mut tree = Tree {
                label: path.clone(),
                files: BTreeMap::new(),
                modes: BTreeMap::new(),
            };
            read_tarball_into(&bytes, &mut tree)?;
            Ok(tree)
        }
        Spec::Dir(path) => read_dir_tree(path),
    }
}

fn read_tarball_into(bytes: &[u8], tree: &mut Tree) -> Result<(), crate::Error> {
    let mut iter = match ArchiveIterator::init(bytes) {
        ArchiveIterResult::Result(it) => it,
        ArchiveIterResult::Err { message, .. } => {
            Output::err_generic("{}: {}", (BStr::new(&tree.label), BStr::new(message)));
            Global::exit(1);
        }
    };
    loop {
        let next = match iter.next() {
            ArchiveIterResult::Result(Some(n)) => n,
            ArchiveIterResult::Result(None) => break,
            ArchiveIterResult::Err { message, .. } => {
                Output::err_generic("{}: {}", (BStr::new(&tree.label), BStr::new(message)));
                Global::exit(1);
            }
        };
        if next.kind != bun_sys::FileKind::File {
            continue;
        }
        let perm = next.entry().perm() & 0o777;
        // libarchive returns NULL from the narrow accessor for non-ASCII names on Windows; go through UTF-16 there.
        #[cfg(windows)]
        let wide_path =
            strings::to_utf8_list_with_type(Vec::new(), next.entry().pathname_w().as_slice())?;
        #[cfg(windows)]
        let path = wide_path.as_slice();
        #[cfg(not(windows))]
        let path = next.entry().pathname().as_bytes();
        // npm tarballs root everything under one folder (usually `package/`).
        let rel = match strings::index_of_char(path, b'/') {
            Some(i) => &path[i as usize + 1..],
            None => path,
        };
        if rel.is_empty() {
            continue;
        }
        let data = match iter.read_entry_data(&next)? {
            ArchiveIterResult::Result(d) => d,
            ArchiveIterResult::Err { message, .. } => {
                Output::err_generic(
                    "{}: {}: {}",
                    (BStr::new(&tree.label), BStr::new(rel), BStr::new(message)),
                );
                Global::exit(1);
            }
        };
        tree.modes.insert(rel.to_vec(), perm);
        tree.files.insert(rel.to_vec(), data.into_vec());
    }
    let _ = iter.close();
    Ok(())
}

fn read_dir_tree(root: &[u8]) -> Result<Tree, crate::Error> {
    let mut tree = Tree {
        label: root.to_vec(),
        files: BTreeMap::new(),
        modes: BTreeMap::new(),
    };
    let root_fd = match bun_sys::open_dir_at(Fd::cwd(), root) {
        Ok(fd) => fd,
        Err(err) => {
            Output::err(err, "failed to open {}", (BStr::new(root),));
            Global::exit(1);
        }
    };
    // A tree with holes would report those files as deleted, so any read failure is fatal.
    let fail = |err: bun_sys::Error, rel: &[u8]| -> ! {
        Output::err(
            err,
            "failed to read {}/{}",
            (BStr::new(root), BStr::new(rel)),
        );
        Global::exit(1);
    };
    let mut stack: Vec<(Fd, Vec<u8>)> = vec![(root_fd, Vec::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let mut it = DirIterator::iterate(dir);
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
                    Ok(sub) => stack.push((sub, rel)),
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
                bun_sys::FileKind::SymLink => {
                    if let Ok(bytes) = bun_sys::File::read_from(dir, name) {
                        tree.files.insert(rel, bytes);
                    }
                }
                _ => {}
            }
        }
        dir.close();
    }
    Ok(tree)
}

/// Fetches `name`'s manifest, resolves `version` (exact, range, or dist-tag), downloads that tarball and unpacks it in memory.
fn fetch_registry_tree(
    pm: &mut PackageManager,
    name: &[u8],
    version: &[u8],
) -> Result<Tree, crate::Error> {
    let bump = Bump::new();
    let scope = pm.scope_for_package_name(name);

    let mut url_buf = PathBuffer::uninit();
    let encoded_name = buf_print(
        url_buf.0.as_mut_slice(),
        format_args!("{}", bun_fmt::dependency_url(name)),
    );
    let mut path_buf = PathBuffer::uninit();
    let manifest_url = buf_print(
        path_buf.0.as_mut_slice(),
        format_args!(
            "{}/{}",
            BStr::new(strings::without_trailing_slash(scope.url.href())),
            BStr::new(encoded_name)
        ),
    );
    let body = registry_get(
        pm,
        scope,
        URL::parse(manifest_url),
        // The abbreviated packument has versions + dist, all this needs; full ones run to tens of MB.
        b"application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
        Some((name, version)),
    )?;

    let mut log = bun_ast::Log::init();
    let manifest = match PackageManifest::parse(
        scope,
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
            Output::err_generic(
                "failed to parse the registry manifest for {}",
                (BStr::new(name),),
            );
            Global::exit(1);
        }
        Err(err) => {
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
        if let Some(r) = manifest.find_by_dist_tag(version) {
            break 'found r;
        }
        let sliced = Semver::SlicedString::init(version, version);
        if let Ok(query) = Semver::query::parse(version, sliced) {
            if let Some(r) = manifest.find_best_version(&query, &manifest.string_buf) {
                break 'found r;
            }
        }
        Output::err_generic(
            "no version of {} matches {}",
            (BStr::new(name), BStr::new(version)),
        );
        Global::exit(1);
    };

    let mut label = Vec::new();
    let _ = write!(
        &mut label,
        "{}@{}",
        BStr::new(name),
        found.version.fmt(&manifest.string_buf)
    );

    let mut tarball_url: Vec<u8> = found.tarball_url(&manifest);
    if tarball_url.is_empty() {
        tarball_url = bun_install::extract_tarball::build_url_with_printer(
            scope.url.href(),
            &StringOrTinyString::init_append_if_needed(name, &mut BumpAppender(&bump))?,
            found.version,
            &manifest.string_buf,
            |args| -> Result<Vec<u8>, bun_alloc::AllocError> {
                let mut v = Vec::new();
                let _ = v.write_fmt(args);
                Ok(v)
            },
        )?;
    }
    let tarball = registry_get(
        pm,
        scope,
        URL::parse(&tarball_url),
        b"application/octet-stream",
        None,
    )?;

    let mut tree = Tree {
        label,
        files: BTreeMap::new(),
        modes: BTreeMap::new(),
    };
    read_tarball_into(tarball.list.as_slice(), &mut tree)?;
    Ok(tree)
}

struct BumpAppender<'a>(&'a Bump);
impl bun_core::strings::Appender for BumpAppender<'_> {
    fn append(&mut self, s: &[u8]) -> Result<&[u8], bun_alloc::AllocError> {
        Ok(self.0.alloc_slice_copy(s))
    }
    fn append_lower_case(&mut self, s: &[u8]) -> Result<&[u8], bun_alloc::AllocError> {
        let out = self.0.alloc_slice_copy(s);
        out.make_ascii_lowercase();
        Ok(out)
    }
}

fn registry_get(
    pm: &PackageManager,
    scope: &npm::registry::Scope,
    url: URL<'_>,
    accept: &[u8],
    for_error: Option<(&[u8], &[u8])>,
) -> Result<MutableString, crate::Error> {
    let mut headers = http::HeaderBuilder::default();
    headers.count(b"Accept", accept);
    // `dist.tarball` is registry-controlled; credentials only go back to the registry's own origin.
    let same_origin = {
        let registry = scope.url.url();
        url.protocol == registry.protocol
            && url.hostname == registry.hostname
            && url.get_port_auto() == registry.get_port_auto()
    };
    let (token, auth): (&[u8], &[u8]) = if same_origin {
        (&scope.token, &scope.auth)
    } else {
        (b"", b"")
    };
    if !token.is_empty() {
        headers.count(b"Authorization", b"");
        headers.content.cap += b"Bearer ".len() + token.len();
        headers.count(b"npm-auth-type", b"legacy");
    } else if !auth.is_empty() {
        headers.count(b"Authorization", b"");
        headers.content.cap += b"Basic ".len() + auth.len();
        headers.count(b"npm-auth-type", b"legacy");
    }
    headers.allocate()?;
    headers.append(b"Accept", accept);
    // Raw-byte append: a non-UTF-8 token through Display would grow past the reserved count.
    if !token.is_empty() {
        headers.append_bytes_value(b"Authorization", b"Bearer ", token);
        headers.append(b"npm-auth-type", b"legacy");
    } else if !auth.is_empty() {
        headers.append_bytes_value(b"Authorization", b"Basic ", auth);
        headers.append(b"npm-auth-type", b"legacy");
    }

    let mut response_buf = MutableString::init(64 * 1024)?;
    let http_proxy = pm.http_proxy(&url);
    let display_url = url.href.to_vec();
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::GET,
        url,
        headers.entries,
        headers.content.written_slice(),
        b"",
        http_proxy,
        None,
        http::FetchRedirect::Follow,
    );
    req.client.flags.reject_unauthorized = pm.tls_reject_unauthorized();
    let res = match req.send_sync(&mut response_buf) {
        Ok(r) => r,
        Err(err) => {
            Output::err(err, "GET {} failed", (BStr::new(&display_url),));
            Global::exit(1);
        }
    };
    if res.status_code() >= 400 {
        npm::response_error::<false>(&req, &res, for_error, &mut response_buf)?;
    }
    Ok(response_buf)
}

// ─── diffing & printing ─────────────────────────────────────────────────────

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum Semantic {
    #[default]
    Text,
    /// Both sides parse and print identically: whitespace/quotes/semicolons only.
    FormattingOnly,
    /// Hunks were computed on the canonical re-print (gutter shows original lines when known).
    Normalized { unminified: bool },
    /// `-w`: the bytes differ but not once runs of whitespace are collapsed.
    WhitespaceOnly,
    /// CRLF ↔ LF and nothing else.
    LineEndingsOnly,
    /// Same bytes, different permission bits.
    ModeOnly,
    /// Original lines shown, but what counts as a change was decided on the canonical form; `hidden` textual
    /// differences were folded away as equivalent.
    Projected { hidden: usize },
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
    /// `*.js.map`: regenerated on every build, never worth reading.
    sourcemap: bool,
    hunks: Vec<u8>,
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

/// The terminal view never lets package bytes drive the terminal: C0/C1 controls (bar tab) and bidi overrides are
/// drawn as visible stand-ins.
fn defang(text: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    let suspicious = |b: &u8| (*b < 0x20 && *b != b'\t') || *b == 0x7f || *b == 0xc2 || *b == 0xe2;
    if !text.iter().any(suspicious) {
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
            && ((text[i + 1] == 0x80 && (0xaa..=0xae).contains(&text[i + 2]))
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

/// Every run of ASCII whitespace becomes one space and leading/trailing runs go, for `-w`.
fn collapse_whitespace(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut pending_space = false;
    for &b in bytes {
        if b.is_ascii_whitespace() {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(b' ');
                pending_space = false;
            }
            out.push(b);
        }
    }
    out
}

fn is_binary(bytes: &[u8]) -> bool {
    strings::contains_char(&bytes[..bytes.len().min(8192)], 0)
}

fn count_lines(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        0
    } else {
        strings::count_char(bytes, b'\n') + usize::from(!bytes.ends_with(b"\n"))
    }
}

fn print_diff(left: &Tree, right: &Tree, flags: DiffFlags) {
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
        let mut change = FileChange {
            path,
            highlight: style.pretty && is_js_like(path),
            old,
            new,
            mode_change,
            ..Default::default()
        };
        if old == new {
            change.semantic = Semantic::ModeOnly;
            changes.push(change);
            continue;
        }
        change.binary = old.is_some_and(is_binary) || new.is_some_and(is_binary);
        change.sourcemap = strings::ends_with(path, b".map")
            && new.or(old).is_some_and(|b| b.starts_with(b"{\"version\""));
        if change.binary || change.sourcemap {
            changes.push(change);
            continue;
        }
        if style.pretty {
            if let (Some(o), Some(n)) = (old, new) {
                if (strings::contains_char(o, b'\r') || strings::contains_char(n, b'\r'))
                    && strip_cr(o) == strip_cr(n)
                {
                    change.semantic = Semantic::LineEndingsOnly;
                    changes.push(change);
                    continue;
                }
            }
        }
        // Like `formatting only`, a terminal-view summary; piped output stays a complete patch.
        if flags.ignore_space && style.pretty {
            if let (Some(o), Some(n)) = (old, new) {
                if collapse_whitespace(o) == collapse_whitespace(n) {
                    change.semantic = Semantic::WhitespaceOnly;
                    changes.push(change);
                    continue;
                }
            }
        }
        let nopts = normalize::Options {
            minify_syntax: flags.minify,
            dce: false,
        };
        // Canonical re-print: same parser and printer on both sides, so only meaning survives.
        let (norm_old, norm_new) = if flags.raw {
            (None, None)
        } else {
            (
                old.and_then(|b| normalize::normalize(path, b, nopts)),
                new.and_then(|b| normalize::normalize(path, b, nopts)),
            )
        };
        if !flags.raw && normalize::kind_for(path).is_some() {
            let too_big = |b: Option<&[u8]>| b.is_some_and(|b| b.len() > normalize::MAX_BYTES);
            if too_big(old) || too_big(new) {
                change.not_normalized = Some("too large to normalize");
            } else if (old.is_some() && norm_old.is_none()) || (new.is_some() && norm_new.is_none())
            {
                change.not_normalized = Some("not parsed");
            }
        }
        if let Some(n) = &norm_new {
            let old_imports: &[Vec<u8>] = norm_old.as_ref().map_or(&[], |o| o.imports.as_slice());
            for imp in &n.imports {
                if !old_imports.contains(imp) && !change.new_imports.contains(imp) {
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
        let reprint_equal =
            matches!((&norm_old, &norm_new), (Some(a), Some(b)) if a.text == b.text);
        let js_family = matches!(normalize::kind_for(path), Some(normalize::Kind::Js(_)));
        change.formatting_only = reprint_equal && !js_family;
        match (old, new, &norm_old, &norm_new) {
            // Patch output must apply to the real files, so only the terminal view uses the re-print.
            (Some(o), Some(n), Some(no), Some(nn))
                if style.pretty
                    && (js_family || no.was_minified || nn.was_minified)
                    && (no.was_minified || nn.was_minified || flags.unminify) =>
            {
                // Minified: the original is one enormous line, so the un-minified re-print is what gets shown.
                change.semantic = Semantic::Normalized { unminified: true };
                if no.text == nn.text {
                    change.semantic = Semantic::FormattingOnly;
                    change.formatting_only = true;
                } else {
                    unified_hunks(&no.text, &nn.text, flags.context, style, &mut change);
                    // Minifier name churn: retry with positional names and keep whichever diff is smaller.
                    if js_family && change.added + change.removed > 2 {
                        if let Some((co, cn)) =
                            normalize::normalize_minified_pair(path, o, n, nopts)
                        {
                            let mut alt = FileChange {
                                path,
                                highlight: change.highlight,
                                ..Default::default()
                            };
                            if co.text == cn.text {
                                alt.semantic = Semantic::FormattingOnly;
                            } else {
                                alt.semantic = change.semantic;
                                unified_hunks(&co.text, &cn.text, flags.context, style, &mut alt);
                            }
                            if alt.added + alt.removed < change.added + change.removed {
                                change.semantic = alt.semantic;
                                change.formatting_only = alt.semantic == Semantic::FormattingOnly;
                                change.added = alt.added;
                                change.removed = alt.removed;
                                change.hunks = alt.hunks;
                            }
                        }
                    }
                }
            }
            (Some(o), Some(n), Some(_), Some(_)) if style.pretty && js_family => {
                // Readable code: decide on the aggressive canonical form, show the author's lines.
                match (
                    normalize::normalize(path, o, normalize::Options::KEY),
                    normalize::normalize(path, n, normalize::Options::KEY),
                ) {
                    (Some(ko), Some(kn)) if !ko.map.is_empty() && !kn.map.is_empty() => {
                        let (old_v, new_v) = (view_bytes(o), view_bytes(n));
                        let projection = semantic::project(&old_v, &new_v, &ko, &kn);
                        let shown = projection
                            .ops
                            .iter()
                            .any(|op| op.kind != Operation::Equal || op.affected);
                        if shown {
                            change.semantic = Semantic::Projected {
                                hidden: projection.hidden,
                            };
                            render_ops(
                                &projection.ops,
                                flags.context,
                                style,
                                &mut change,
                                (false, false),
                            );
                        } else {
                            change.semantic = Semantic::FormattingOnly;
                            change.formatting_only = true;
                        }
                    }
                    _ => unified_hunks(o, n, flags.context, style, &mut change),
                }
            }
            (Some(_), Some(_), Some(_), Some(_)) if style.pretty && reprint_equal => {
                // JSON / CSS: no source map to project through; an identical re-print is formatting.
                change.semantic = Semantic::FormattingOnly;
            }
            (None, Some(n), _, _) => change.added = count_lines(n),
            (Some(o), None, _, _) => change.removed = count_lines(o),
            (Some(o), Some(n), _, _) => unified_hunks(o, n, flags.context, style, &mut change),
            (None, None, _, _) => unreachable!(),
        }
        if !flags.name_only
            && !flags.stat
            && change.hunks.is_empty()
            && change.semantic == Semantic::Text
            && (old.is_none() || new.is_none())
        {
            // Whole-file add/remove: render every line as +/-.
            let (op, body) = match (new, old) {
                (Some(n), _) => (Operation::Insert, n),
                (None, Some(o)) => (Operation::Delete, o),
                (None, None) => unreachable!(),
            };
            let n = count_lines(body);
            let range = if new.is_some() {
                (0, 0, 1, n)
            } else {
                (1, n, 0, 0)
            };
            style.hunk_header(&mut change.hunks, range, true);
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
                );
            }
            if unterminated {
                change.hunks.extend_from_slice(NO_NEWLINE_MARKER);
            }
        }
        changes.push(change);
    }

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
        if style.pretty {
            style.file_header(c);
            Output::print(format_args!("{}", BStr::new(&c.hunks)));
            continue;
        }
        Output::print(format_args!(
            "diff --bun a/{} b/{}\n",
            BStr::new(c.path),
            BStr::new(c.path)
        ));
        match (c.old, c.new, c.mode_change) {
            (None, Some(_), Some((_, n))) => {
                Output::print(format_args!("new file mode 100{n:o}\n"))
            }
            (None, Some(_), None) => Output::print(format_args!("new file\n")),
            (Some(_), None, _) => Output::print(format_args!("deleted file\n")),
            (_, _, Some((o, n))) => {
                Output::print(format_args!("old mode 100{o:o}\nnew mode 100{n:o}\n"))
            }
            _ => {}
        }
        if c.semantic == Semantic::ModeOnly {
            continue;
        }
        if c.binary || c.sourcemap {
            Output::print(format_args!(
                "{} files differ ({} → {} bytes)\n",
                if c.sourcemap { "Source map" } else { "Binary" },
                c.old.map_or(0, <[u8]>::len),
                c.new.map_or(0, <[u8]>::len)
            ));
            continue;
        }
        Output::print(format_args!(
            "--- {}\n+++ {}\n",
            if c.old.is_some() {
                PathLabel(b"a/", c.path)
            } else {
                PathLabel(b"", b"/dev/null")
            },
            if c.new.is_some() {
                PathLabel(b"b/", c.path)
            } else {
                PathLabel(b"", b"/dev/null")
            }
        ));
        Output::print(format_args!("{}", BStr::new(&c.hunks)));
    }
    print_summary(left, right, &changes, style);
}

struct PathLabel<'a>(&'a [u8], &'a [u8]);
impl core::fmt::Display for PathLabel<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}{}", BStr::new(self.0), BStr::new(self.1))
    }
}

/// The header everyone reads first: which versions, how much changed, and the changes worth a second look
/// (install scripts, binaries, dependency and entry-point changes in package.json).
fn print_header(left: &Tree, right: &Tree, style: Style) {
    // `react 18.2.0 → 19.0.0` when both sides are the same package, the two labels otherwise.
    match (split_label(&left.label), split_label(&right.label)) {
        (Some((ln, lv)), Some((rn, rv))) if style.pretty && ln == rn => prettyln!(
            "<b>{}<r> <red>{}<r> <d>→<r> <green>{}<r>",
            BStr::new(ln),
            BStr::new(lv),
            BStr::new(rv)
        ),
        _ => prettyln!(
            "<b>{}<r> <d>→<r> <b>{}<r>",
            BStr::new(&left.label),
            BStr::new(&right.label)
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
    package_json_notes(
        left.files.get(b"package.json".as_slice()),
        right.files.get(b"package.json".as_slice()),
        &mut notes,
        colors,
    );
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
        if let Some(n) = c.new {
            let gained = |needle: fn(&[u8]) -> bool| needle(n) && !c.old.is_some_and(needle);
            if !c.binary && gained(has_terminal_escapes) {
                notes.push(note!(
                    colors,
                    "terminal escape sequences in <b>{}<r> <d>(shown as ␛)<r>",
                    &[BStr::new(c.path).to_string()]
                ));
            }
            if !c.binary && gained(has_bidi_controls) {
                notes.push(note!(colors, "bidirectional text controls in <b>{}<r> <d>(Trojan Source; shown as ‹U+202E›)<r>", &[BStr::new(c.path).to_string()]));
            }
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
    Output::print(format_args!("{}", BStr::new(&out)));
}

/// What the parser saw that a reviewer would want to know: new imports of consequential builtins, other new
/// module specifiers, and growth in risky API use — aggregated across files so a 40-file package stays readable.
fn ast_notes(changes: &[FileChange<'_>], notes: &mut Vec<String>, colors: bool) {
    let mut builtins: Vec<(Vec<u8>, &[u8])> = Vec::new();
    let mut packages: Vec<Vec<u8>> = Vec::new();
    for c in changes {
        for imp in &c.new_imports {
            if normalize::notable_builtin(imp) {
                if !builtins.iter().any(|(b, _)| b == imp) {
                    builtins.push((imp.clone(), c.path));
                }
            } else if !imp.starts_with(b".") && !imp.starts_with(b"/") && !packages.contains(imp) {
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

fn package_json_notes(
    old: Option<&Vec<u8>>,
    new: Option<&Vec<u8>>,
    notes: &mut Vec<String>,
    colors: bool,
) {
    let (Some(old), Some(new)) = (old, new) else {
        return;
    };
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
    let (Some(old), Some(new)) = (parse(old), parse(new)) else {
        return;
    };

    const SCRIPT_KEYS: &[&[u8]] = &[
        b"preinstall",
        b"install",
        b"postinstall",
        b"prepare",
        b"prepublish",
        b"preuninstall",
        b"postuninstall",
    ];
    let old_scripts = old.get_object(b"scripts");
    let new_scripts = new.get_object(b"scripts");
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
        let o = old.get_object(field);
        let n = new.get_object(field);
        let names = |e: Option<&bun_js_parser::Expr>| -> Vec<(Vec<u8>, Vec<u8>)> {
            let Some(e) = e else { return Vec::new() };
            let Some(obj) = e.data.e_object() else {
                return Vec::new();
            };
            obj.properties
                .slice()
                .iter()
                .filter_map(|p| {
                    Some((
                        p.key.as_ref()?.as_string(&bump)?.to_vec(),
                        p.value.as_ref()?.as_string(&bump)?.to_vec(),
                    ))
                })
                .collect()
        };
        let (o, n) = (names(o.as_ref()), names(n.as_ref()));
        let mut bumps: Vec<String> = Vec::new();
        for (name, ver) in &n {
            match o.iter().find(|(on, _)| on == name) {
                None => notes.push(note!(
                    colors,
                    "{} added: <b>{}<r>@{}",
                    &[
                        (BStr::new(field)).to_string(),
                        (BStr::new(name)).to_string(),
                        (BStr::new(ver)).to_string(),
                    ],
                )),
                Some((_, ov)) if ov != ver => bumps.push(note!(
                    colors,
                    "{} <b>{}<r>: {} → {}",
                    &[
                        (BStr::new(field)).to_string(),
                        (BStr::new(name)).to_string(),
                        (BStr::new(ov)).to_string(),
                        (BStr::new(ver)).to_string(),
                    ],
                )),
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
            if !n.iter().any(|(nn, _)| nn == name) {
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
    ] {
        let o = old.get(field).map(|e| expr_text(&e, &bump));
        let n = new.get(field).map(|e| expr_text(&e, &bump));
        if o != n {
            match (o, n) {
                (Some(o), Some(n)) => notes.push(note!(
                    colors,
                    "<b>{}<r> changed: {} → {}",
                    &[
                        (BStr::new(field)).to_string(),
                        (BStr::new(&o)).to_string(),
                        (BStr::new(&n)).to_string(),
                    ],
                )),
                (None, Some(n)) => notes.push(note!(
                    colors,
                    "<b>{}<r> added: {}",
                    &[(BStr::new(field)).to_string(), (BStr::new(&n)).to_string()],
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
}

fn expr_text(e: &bun_js_parser::Expr, bump: &Bump) -> Vec<u8> {
    if let Some(s) = e.as_string(bump) {
        return s.to_vec();
    }
    let mut printer = bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init());
    let source = bun_ast::Source::init_path_string(b"package.json", b"".as_slice());
    let _ = bun_js_printer::print_json(
        &mut printer,
        *e,
        &source,
        bun_js_printer::PrintJsonOptions {
            mangled_props: None,
            ..Default::default()
        },
    );
    // One line: collapse the printer's indentation.
    let mut out: Vec<u8> = Vec::new();
    let mut last_space = false;
    for &b in printer.ctx.get_written() {
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
    if out.len() > 120 {
        out.truncate(117);
        while out.last().is_some_and(|&b| b & 0xC0 == 0x80) {
            out.pop();
        }
        if out.last().is_some_and(|&b| b >= 0xC0) {
            out.pop();
        }
        out.extend_from_slice(b"...");
    }
    out
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

/// Plain output is a valid unified patch; a terminal gets a gutter with line numbers instead of `@@` headers.
#[derive(Clone, Copy)]
struct Style {
    pretty: bool,
    width: usize,
}

impl Style {
    fn detect(flags: DiffFlags) -> Style {
        let pretty = !flags.json && Output::enable_ansi_colors_stdout();
        let width = bun_core::output::File::from(bun_core::Fd::stdout())
            .winsize()
            .map_or(80, |w| w.col as usize)
            .clamp(40, 120);
        Style { pretty, width }
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
    ) {
        let sign = match op {
            Operation::Equal if affected => b'~',
            Operation::Equal => b' ',
            Operation::Delete => b'-',
            Operation::Insert => b'+',
        };
        if !self.pretty {
            out.push(sign);
            out.extend_from_slice(text);
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
        let (num, accent, bg, strong) = match op {
            // Unchanged text whose meaning moved (now dead, or newly live): flagged, not tinted.
            Operation::Equal if affected => (new_no, "\x1b[33m", "", ""),
            Operation::Equal => (new_no, "\x1b[2m", "", ""),
            Operation::Delete => (old_no, "\x1b[31m", "\x1b[48;5;52m", "\x1b[48;5;88m"),
            Operation::Insert => (new_no, "\x1b[32m", "\x1b[48;5;22m", "\x1b[48;5;28m"),
        };
        let _ = write!(
            out,
            "{accent}{num:>5} \x1b[0m\x1b[2m│\x1b[0m{bg}{accent}\x1b[1m{} \x1b[0m{bg}",
            sign as char
        );
        let budget = self.width.saturating_sub(9);
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
                self.segment(out, prefix, highlight, bg);
                out.extend_from_slice(strong.as_bytes());
                self.segment(out, &text[lo..hi], highlight, strong);
                out.extend_from_slice(bg.as_bytes());
                self.segment(out, &text[hi..], highlight, bg);
            }
            _ if op == Operation::Equal && text.len() > budget && budget > 16 => {
                // Context nobody will read to the end: one screen line is enough.
                let mut cut = budget - 1;
                while cut > 0 && text[cut] & 0xC0 == 0x80 {
                    cut -= 1;
                }
                self.segment(out, &text[..cut], highlight, bg);
                out.extend_from_slice("\x1b[2m…\x1b[0m".as_bytes());
            }
            _ => self.segment(out, text, highlight, bg),
        }
        // Erase-to-EOL carries the tint to the edge before resetting.
        out.extend_from_slice(if bg.is_empty() {
            b"\x1b[0m\n".as_slice()
        } else {
            b"\x1b[K\x1b[0m\n".as_slice()
        });
    }

    fn segment(self, out: &mut Vec<u8>, text: &[u8], highlight: bool, bg: &str) {
        if text.is_empty() {
            return;
        }
        let start = out.len();
        let hl = bun_core::fmt::fmt_javascript(
            text,
            bun_core::fmt::HighlighterOptions {
                enable_colors: true,
                check_for_unhighlighted_write: false,
                ..Default::default()
            },
        );
        if !highlight || text.len() > 4096 || write!(out, "{hl}").is_err() {
            out.truncate(start);
            out.extend_from_slice(text);
        } else if !bg.is_empty() {
            // The highlighter resets all attributes between tokens; put the tint back after each reset.
            let tail = out.split_off(start);
            for (i, piece) in strings::split(&tail, b"\x1b").enumerate() {
                if i > 0 {
                    out.push(0x1b);
                }
                if i > 0 && piece.starts_with(b"[0m") {
                    out.extend_from_slice(b"[0m");
                    out.extend_from_slice(bg.as_bytes());
                    out.extend_from_slice(&piece[3..]);
                } else {
                    out.extend_from_slice(piece);
                }
            }
        }
    }

    /// `path ─────────────── +3 -1`, sized to the terminal.
    fn file_header(self, c: &FileChange<'_>) {
        let note = match c.semantic {
            Semantic::Text => "",
            Semantic::FormattingOnly => "\x1b[2mformatting only\x1b[0m",
            Semantic::WhitespaceOnly => "\x1b[2mwhitespace only\x1b[0m",
            Semantic::LineEndingsOnly => "\x1b[2mline endings only\x1b[0m",
            Semantic::ModeOnly => "",
            Semantic::Projected { .. } => "",
            Semantic::Normalized { unminified: true } => "\x1b[35munminified\x1b[0m ",
            Semantic::Normalized { unminified: false } => "\x1b[2mnormalized\x1b[0m ",
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
            (_, _, true) => format!(
                "\x1b[33mbinary\x1b[0m \x1b[2m{} → {} bytes\x1b[0m",
                c.old.map_or(0, <[u8]>::len),
                c.new.map_or(0, <[u8]>::len)
            ),
            (None, Some(_), _) => format!("\x1b[32mnew\x1b[0m \x1b[32m+{}\x1b[0m", c.added),
            (Some(_), None, _) => format!("\x1b[31mdeleted\x1b[0m \x1b[31m-{}\x1b[0m", c.removed),
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
        if let Semantic::Projected { hidden } = c.semantic {
            if hidden > 0 {
                badge = format!("\x1b[2m{hidden} equivalent hidden\x1b[0m {badge}");
            }
        }
        if let Some(why) = c.not_normalized {
            badge = format!("\x1b[2m{why}\x1b[0m {badge}");
        }
        let badge_width = strip_ansi_len(badge.as_bytes());
        let rule = self
            .width
            .saturating_sub(c.path.len() + badge_width + 4)
            .max(2);
        Output::print(format_args!(
            "\n\x1b[1m{}\x1b[0m \x1b[2m{}\x1b[0m {}\n",
            BStr::new(&defang(c.path)),
            "─".repeat(rule),
            badge
        ));
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

/// What the terminal view compares and shows for a text file: line-ending CRs dropped.
fn view_bytes(bytes: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    if strings::contains_char(bytes, b'\r') {
        std::borrow::Cow::Owned(strip_cr(bytes))
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
            style.line(
                &mut change.hunks,
                op.kind,
                op.old_no,
                op.new_no,
                op.text,
                change.highlight,
                emph,
                op.affected,
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
