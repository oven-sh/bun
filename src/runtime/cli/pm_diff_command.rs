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
use crate::test_runner::diff::diff_match_patch::{self, DiffMatchPatch, Operation};

use bun_core::fmt::buf_print_infallible as buf_print;

#[derive(Clone, Copy)]
pub(crate) struct DiffFlags {
    /// Compare bytes, not the canonical re-print of JS/CSS/JSON.
    pub raw: bool,
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
enum Spec<'a> {
    Registry { name: &'a [u8], version: &'a [u8] },
    Dir(&'a [u8]),
    Tarball(&'a [u8]),
}

/// A materialized side: every file's contents by relative path.
struct Tree {
    label: Vec<u8>,
    files: BTreeMap<Vec<u8>, Vec<u8>>,
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
    let mut args: Vec<&[u8]> = diff_args.to_vec();
    args.extend(positionals.iter().skip(1).copied());
    let typed: Vec<&[u8]> = args.clone();
    for arg in &mut args {
        if let Some(rest) = arg.strip_prefix(b"~/") {
            if let Some(home) = bun_core::env_var::HOME.get() {
                *arg = leak(
                    bun_paths::resolve_path::join_abs_string::<
                        bun_paths::resolve_path::platform::Auto,
                    >(home, &[rest])
                    .to_vec(),
                );
            }
        } else if looks_like_path(arg) && !bun_paths::is_absolute(arg) {
            *arg =
                leak(
                    bun_paths::resolve_path::join_abs_string::<
                        bun_paths::resolve_path::platform::Auto,
                    >(original_cwd, &[arg])
                    .to_vec(),
                );
        }
    }
    if args.len() > 2 {
        Output::err_generic("bun pm diff takes at most two package specs or paths", ());
        Global::exit(1);
    }

    let (mut left_spec, right_spec) = resolve_sides(pm, &args, original_cwd);
    let mut right = materialize(pm, &right_spec)?;
    if let Spec::Registry { name, version } = left_spec {
        if name.is_empty() {
            // `bun pm diff ./pkg`: the registry side is named by the folder/tarball's own package.json.
            let name = package_name_in(&right).unwrap_or_else(|| {
                Output::err_generic(
                    "{} has no package.json \"name\" to look up in the registry",
                    (BStr::new(&right.label),),
                );
                Global::exit(1);
            });
            left_spec = Spec::Registry { name, version };
        }
    }
    let mut left = materialize(pm, &left_spec)?;
    // Show local paths the way they were typed, not as resolved from a scratch cwd.
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
        || (cfg!(windows) && spec.len() > 2 && spec[1] == b':')
}

fn classify(spec: &[u8]) -> Spec<'_> {
    if looks_like_path(spec) {
        if strings::ends_with(spec, b".tgz")
            || strings::ends_with(spec, b".tar.gz")
            || strings::ends_with(spec, b".tar")
        {
            return Spec::Tarball(spec);
        }
        return Spec::Dir(spec);
    }
    let (name, version) = dependency::split_name_and_version_or_latest(spec);
    // Distinguish "no version given" from an explicit `@latest`.
    let explicit = spec.len() > name.len();
    Spec::Registry {
        name,
        version: if explicit { version } else { b"" },
    }
}

/// Turns 0, 1 or 2 user arguments into the two sides to compare.
fn resolve_sides<'a>(
    pm: &mut PackageManager,
    args: &[&'a [u8]],
    original_cwd: &[u8],
) -> (Spec<'a>, Spec<'a>) {
    match args {
        // In a package folder: what is published under this name → the folder.
        [] => {
            let name = root_package_name(pm, original_cwd);
            (
                Spec::Registry {
                    name,
                    version: b"latest",
                },
                Spec::Dir(leak(original_cwd.to_vec())),
            )
        }
        [one] => match classify(one) {
            Spec::Registry { name, version } => {
                // `name@a..b`
                if let Some(dots) = strings::index_of(version, b"..") {
                    let (a, b) = (&version[..dots], &version[dots + 2..]);
                    return (
                        Spec::Registry { name, version: a },
                        Spec::Registry { name, version: b },
                    );
                }
                // `name` / `name@b`: the version this project has installed → b (default: latest).
                let installed = installed_version(pm, name).unwrap_or_else(|| {
                    Output::err_generic("{} is not in this project's lockfile; give two versions to compare, e.g. `bun pm diff {}@1.0.0 {}@2.0.0`", (BStr::new(name), BStr::new(name), BStr::new(name)));
                    Global::exit(1);
                });
                (
                    Spec::Registry {
                        name,
                        version: leak(installed),
                    },
                    Spec::Registry {
                        name,
                        version: if version.is_empty() {
                            b"latest"
                        } else {
                            version
                        },
                    },
                )
            }
            // A folder or tarball on its own: what is published under *its* package.json name → it (named once unpacked).
            local => (
                Spec::Registry {
                    name: b"",
                    version: b"latest",
                },
                local,
            ),
        },
        [a, b] => {
            let left = classify(a);
            let right = match (classify(b), &left) {
                // `name@1 2` — a bare second version reuses the first name.
                (
                    Spec::Registry {
                        name: bare,
                        version: b"",
                    },
                    Spec::Registry { name, .. },
                ) if Semver::Version::parse(Semver::SlicedString::init(bare, bare)).valid => {
                    Spec::Registry {
                        name,
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

fn package_name_in(tree: &Tree) -> Option<&'static [u8]> {
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
    (!name.is_empty()).then(|| leak(name.to_vec()))
}

fn leak(v: Vec<u8>) -> &'static [u8] {
    Vec::leak(v)
}

fn root_package_name(pm: &PackageManager, original_cwd: &[u8]) -> &'static [u8] {
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
                    return leak(name.to_vec());
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
    leak(name.to_vec())
}

/// The npm version of `name` this project's lockfile resolved, if any.
fn installed_version(pm: &mut PackageManager, name: &[u8]) -> Option<Vec<u8>> {
    let pm_ptr: *mut PackageManager = pm;
    // SAFETY: `load_from_cwd` only reads manager options/log; same reshaping as `outdated`.
    let lockfile = unsafe { &mut *(*pm_ptr).lockfile };
    // SAFETY: as above.
    let log = unsafe { &mut *(*pm_ptr).log };
    // SAFETY: as above; the manager outlives this call.
    let manager = unsafe { &mut *pm_ptr };
    if !matches!(
        lockfile.load_from_cwd::<true>(Some(manager), log),
        LoadResult::Ok(_)
    ) {
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

fn materialize(pm: &mut PackageManager, spec: &Spec<'_>) -> Result<Tree, crate::Error> {
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
                label: path.to_vec(),
                files: BTreeMap::new(),
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
        // SAFETY: entry pointer is live until the next `read_next_header`.
        let path = unsafe { (*next.entry).pathname() }.as_bytes();
        // npm tarballs root everything under one folder (usually `package/`).
        let rel = match strings::index_of_char(path, b'/') {
            Some(i) => &path[i as usize + 1..],
            None => path,
        };
        if rel.is_empty() {
            continue;
        }
        // SAFETY: `iter.archive` is the live handle `next` came from.
        let data = match next.read_entry_data(unsafe { &*iter.archive })? {
            ArchiveIterResult::Result(d) => d,
            ArchiveIterResult::Err { message, .. } => {
                Output::err_generic(
                    "{}: {}: {}",
                    (BStr::new(&tree.label), BStr::new(rel), BStr::new(message)),
                );
                Global::exit(1);
            }
        };
        tree.files.insert(rel.to_vec(), data.into_vec());
    }
    let _ = iter.close();
    Ok(())
}

fn read_dir_tree(root: &[u8]) -> Result<Tree, crate::Error> {
    let mut tree = Tree {
        label: root.to_vec(),
        files: BTreeMap::new(),
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
            let kind = match entry.kind {
                // Some filesystems leave d_type blank; symlinks are followed to what they point at.
                #[cfg(not(windows))]
                bun_sys::FileKind::Unknown | bun_sys::FileKind::SymLink => {
                    match bun_sys::fstatat(dir, entry.name.as_zstr()) {
                        Ok(st) => bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode),
                        Err(err) => fail(err, &rel),
                    }
                }
                k => k,
            };
            match kind {
                // A symlinked folder could loop back up the tree, and a published package cannot contain one anyway.
                bun_sys::FileKind::Directory if entry.kind == bun_sys::FileKind::SymLink => {}
                bun_sys::FileKind::Directory => match bun_sys::open_dir_at(dir, name) {
                    Ok(sub) => stack.push((sub, rel)),
                    Err(err) => fail(err, &rel),
                },
                bun_sys::FileKind::File => match bun_sys::File::read_from(dir, name) {
                    Ok(bytes) => {
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
        b"application/json",
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
        URL::parse(leak(tarball_url)),
        b"application/octet-stream",
        None,
    )?;

    let mut tree = Tree {
        label,
        files: BTreeMap::new(),
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
    } else if !auth.is_empty() {
        headers.count(b"Authorization", b"");
        headers.content.cap += b"Basic ".len() + auth.len();
    }
    headers.allocate()?;
    headers.append(b"Accept", accept);
    if !token.is_empty() {
        headers.append_fmt(
            b"Authorization",
            format_args!("Bearer {}", BStr::new(token)),
        );
    } else if !auth.is_empty() {
        headers.append_fmt(b"Authorization", format_args!("Basic {}", BStr::new(auth)));
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
}

#[derive(Default)]
struct FileChange<'a> {
    path: &'a [u8],
    highlight: bool,
    semantic: Semantic,
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

/// Returns whether anything differed.
fn print_diff(left: &Tree, right: &Tree, flags: DiffFlags) -> bool {
    let style = Style::detect();
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
        if old == new {
            continue;
        }
        let mut change = FileChange {
            path,
            highlight: style.pretty && is_js_like(path),
            old,
            new,
            ..Default::default()
        };
        change.binary = old.is_some_and(is_binary) || new.is_some_and(is_binary);
        change.sourcemap = strings::ends_with(path, b".map")
            && new.or(old).is_some_and(|b| b.starts_with(b"{\"version\""));
        if change.binary || change.sourcemap {
            changes.push(change);
            continue;
        }
        if flags.ignore_space {
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
        match (old, new, &norm_old, &norm_new) {
            // Patch output must apply to the real files, so only the terminal view uses the re-print.
            (Some(_), Some(_), Some(no), Some(nn)) if style.pretty && no.text == nn.text => {
                change.semantic = Semantic::FormattingOnly;
            }
            (Some(o), Some(n), Some(no), Some(nn)) if style.pretty => {
                let unminified = no.was_minified || nn.was_minified || flags.unminify;
                change.semantic = Semantic::Normalized { unminified };
                if unminified {
                    unified_hunks(
                        &no.text,
                        &nn.text,
                        flags.context,
                        style,
                        (None, None),
                        &mut change,
                    );
                    // Minifier name churn: retry with positional names and keep whichever diff is smaller.
                    if change.added + change.removed > 2 {
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
                                unified_hunks(
                                    &co.text,
                                    &cn.text,
                                    flags.context,
                                    style,
                                    (None, None),
                                    &mut alt,
                                );
                            }
                            if alt.added + alt.removed < change.added + change.removed {
                                change.semantic = alt.semantic;
                                change.added = alt.added;
                                change.removed = alt.removed;
                                change.hunks = alt.hunks;
                            }
                        }
                    }
                } else {
                    let maps = (Some(no.line_map.as_slice()), Some(nn.line_map.as_slice()));
                    unified_hunks(&no.text, &nn.text, flags.context, style, maps, &mut change);
                }
            }
            (None, Some(n), _, _) => change.added = count_lines(n),
            (Some(o), None, _, _) => change.removed = count_lines(o),
            (Some(o), Some(n), _, _) => {
                unified_hunks(o, n, flags.context, style, (None, None), &mut change)
            }
            (None, None, _, _) => unreachable!(),
        }
        if !flags.name_only
            && !flags.stat
            && change.hunks.is_empty()
            && change.semantic == Semantic::Text
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
                );
            }
            if unterminated {
                change.hunks.extend_from_slice(NO_NEWLINE_MARKER);
            }
        }
        changes.push(change);
    }

    if style.pretty {
        prettyln!("");
    }
    print_header(left, right, style);
    if changes.is_empty() {
        prettyln!("<d>No differences ({} files)<r>", left.files.len());
        return false;
    }
    if !style.pretty || flags.name_only || flags.stat {
        prettyln!("");
    }

    let path_width = changes
        .iter()
        .map(|c| c.path.len())
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
            Output::print(format_args!("{status} {}\n", BStr::new(c.path)));
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
            let padded = format!("{:<width$}", BStr::new(c.path), width = path_width);
            let sep = if style.pretty { "│" } else { "|" };
            if let Semantic::FormattingOnly | Semantic::WhitespaceOnly = c.semantic {
                let what = if c.semantic == Semantic::FormattingOnly {
                    "formatting only"
                } else {
                    "whitespace only"
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
        match (c.old, c.new) {
            (None, Some(_)) => Output::print(format_args!("new file\n")),
            (Some(_), None) => Output::print(format_args!("deleted file\n")),
            _ => {}
        }
        if c.semantic == Semantic::WhitespaceOnly {
            Output::print(format_args!("Whitespace-only changes\n"));
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
    true
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

    let mut notes: Vec<String> = Vec::new();
    package_json_notes(
        left.files.get(b"package.json".as_slice()),
        right.files.get(b"package.json".as_slice()),
        &mut notes,
    );
    ast_notes(changes, &mut notes);
    for c in changes {
        if c.binary && c.old.is_none() {
            notes.push(format!(
                "new binary file <b>{}<r> ({} bytes)",
                Esc(c.path),
                c.new.map_or(0, <[u8]>::len)
            ));
        }
        if c.old.is_none()
            && (strings::ends_with(c.path, b".node")
                || strings::ends_with(c.path, b".sh")
                || strings::ends_with(c.path, b".exe"))
            && !c.binary
        {
            notes.push(format!("new executable-looking file <b>{}<r>", Esc(c.path)));
        }
    }
    if !notes.is_empty() {
        let mark = if style.pretty { "▲" } else { "!" };
        for n in &notes {
            #[allow(clippy::disallowed_methods)]
            Output::pretty(format_args!("  <yellow>{}<r> {}\n", mark, n));
        }
    }
}

/// What the parser saw that a reviewer would want to know: new imports of consequential builtins, other new
/// module specifiers, and growth in risky API use — aggregated across files so a 40-file package stays readable.
fn ast_notes(changes: &[FileChange<'_>], notes: &mut Vec<String>) {
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
        notes.push(format!(
            "now imports <b><magenta>{}<r> <d>({})<r>",
            Esc(b),
            Esc(path)
        ));
    }
    if !packages.is_empty() {
        let shown: Vec<String> = packages
            .iter()
            .take(6)
            .map(|p| format!("<b>{}<r>", Esc(p)))
            .collect();
        let more = if packages.len() > 6 {
            format!(" <d>… and {} more<r>", packages.len() - 6)
        } else {
            String::new()
        };
        notes.push(format!("new module imports: {}{}", shown.join(", "), more));
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
        notes.push(format!(
            "<b>+{n}<r> {label} <d>({}{})<r>",
            Esc(first_path),
            if n > 1 { ", …" } else { "" }
        ));
    }
}

/// User-controlled text headed for `Output::pretty`: `<`/`>` would otherwise be read as colour tags.
struct Esc<T: AsRef<[u8]>>(T);
impl<T: AsRef<[u8]>> core::fmt::Display for Esc<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        for chunk in self.0.as_ref().utf8_chunks() {
            for ch in chunk.valid().chars() {
                if ch == '<' || ch == '>' {
                    f.write_str("\\")?;
                }
                core::fmt::Write::write_char(f, ch)?;
            }
            if !chunk.invalid().is_empty() {
                f.write_str("\u{FFFD}")?;
            }
        }
        Ok(())
    }
}

/// `name@version` → (name, version), minding a leading scope `@`.
fn split_label(label: &[u8]) -> Option<(&[u8], &[u8])> {
    let at = strings::last_index_of_char(label, b'@')?;
    (at > 0).then(|| (&label[..at], &label[at + 1..]))
}

fn package_json_notes(old: Option<&Vec<u8>>, new: Option<&Vec<u8>>, notes: &mut Vec<String>) {
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
            (None, Some(n)) => notes.push(format!(
                "<b>{}<r> script added: <cyan>{}<r>",
                Esc(key),
                Esc(n)
            )),
            (Some(o), Some(n)) if o != n => notes.push(format!(
                "<b>{}<r> script changed: <cyan>{}<r>",
                Esc(key),
                Esc(n)
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
                None => notes.push(format!(
                    "{} added: <b>{}<r>@{}",
                    Esc(field),
                    Esc(name),
                    Esc(ver)
                )),
                Some((_, ov)) if ov != ver => bumps.push(format!(
                    "{} <b>{}<r>: {} → {}",
                    Esc(field),
                    Esc(name),
                    Esc(ov),
                    Esc(ver)
                )),
                _ => {}
            }
        }
        // A release that bumps a family of packages in lockstep is one fact, not thirty.
        if bumps.len() > 4 {
            let rest = bumps.len() - 3;
            bumps.truncate(3);
            bumps.push(format!(
                "<d>… and {} more {} version changes<r>",
                rest,
                Esc(field)
            ));
        }
        notes.append(&mut bumps);
        for (name, _) in &o {
            if !n.iter().any(|(nn, _)| nn == name) {
                notes.push(format!("{} removed: <b>{}<r>", Esc(field), Esc(name)));
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
                (Some(o), Some(n)) => notes.push(format!(
                    "<b>{}<r> changed: {} → {}",
                    Esc(field),
                    Esc(&o),
                    Esc(&n)
                )),
                (None, Some(n)) => notes.push(format!("<b>{}<r> added: {}", Esc(field), Esc(&n))),
                (Some(_), None) => notes.push(format!("<b>{}<r> removed", Esc(field))),
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

struct Lines<'a>(&'a [u8]);
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
    fn detect() -> Style {
        let pretty = Output::enable_ansi_colors_stdout();
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
    ) {
        let sign = match op {
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
        // A CRLF file's `\r` would send the cursor home and let erase-to-EOL wipe the line just drawn.
        let text = text.strip_suffix(b"\r").unwrap_or(text);
        // Changed lines get a tinted background so the foreground is free for syntax colours.
        let (num, accent, bg, strong) = match op {
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
            Semantic::Normalized { unminified: true } => "\x1b[35munminified\x1b[0m ",
            Semantic::Normalized { unminified: false } => "\x1b[2mnormalized\x1b[0m ",
        };
        let badge = match (c.old, c.new, c.binary) {
            _ if matches!(
                c.semantic,
                Semantic::FormattingOnly | Semantic::WhitespaceOnly
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
        let badge_width = strip_ansi_len(badge.as_bytes());
        let rule = self
            .width
            .saturating_sub(c.path.len() + badge_width + 4)
            .max(2);
        Output::print(format_args!(
            "\n\x1b[1m{}\x1b[0m \x1b[2m{}\x1b[0m {}\n",
            BStr::new(c.path),
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
fn pair_emphasis(ops: &[(Operation, &[u8])], k: usize) -> Option<(usize, usize)> {
    let (op, text) = ops[k];
    let partner = match op {
        Operation::Delete
            if k + 1 < ops.len()
                && ops[k + 1].0 == Operation::Insert
                && ops.get(k + 2).is_none_or(|o| o.0 != Operation::Insert)
                && (k == 0 || ops[k - 1].0 != Operation::Delete) =>
        {
            ops[k + 1].1
        }
        Operation::Insert
            if k > 0
                && ops[k - 1].0 == Operation::Delete
                && ops.get(k + 1).is_none_or(|o| o.0 != Operation::Insert)
                && (k < 2 || ops[k - 2].0 != Operation::Delete) =>
        {
            ops[k - 1].1
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
    (old_map, new_map): (Option<&[u32]>, Option<&[u32]>),
    change: &mut FileChange<'_>,
) {
    let map = |m: Option<&[u32]>, line: usize| {
        m.and_then(|m| m.get(line.wrapping_sub(1)))
            .map_or(line, |&l| l as usize)
    };
    let mut dmp = DiffMatchPatch::<usize>::default();
    dmp.config.diff_timeout = 1000;
    let l2c = bun_core::handle_oom(diff_match_patch::diff_lines_to_chars(old, new));
    let char_diffs = bun_core::handle_oom(dmp.diff(&l2c.chars_1, &l2c.chars_2, false));
    let diffs = bun_core::handle_oom(diff_match_patch::diff_chars_to_lines(
        &char_diffs,
        l2c.line_array.as_slice(),
    ));

    // Flatten to (op, line) so context windows are easy to compute.
    let mut ops: Vec<(Operation, &[u8])> = Vec::new();
    for d in &diffs {
        for line in Lines(&d.text) {
            ops.push((d.operation, line));
        }
        match d.operation {
            Operation::Insert => change.added += count_lines(&d.text),
            Operation::Delete => change.removed += count_lines(&d.text),
            Operation::Equal => {}
        }
    }
    // SAFETY-free lifetime note: `d.text` is owned by `diffs`, which lives to the end of this fn; hunks are rendered here.
    // `patch`/`git apply` need to know when a side's last line had no terminator.
    let old_unterminated = !old.is_empty() && !old.ends_with(b"\n");
    let new_unterminated = !new.is_empty() && !new.ends_with(b"\n");
    let last_old = ops.iter().rposition(|(op, _)| *op != Operation::Insert);
    let last_new = ops.iter().rposition(|(op, _)| *op != Operation::Delete);
    let n = ops.len();
    let mut i = 0;
    let mut first = true;
    let (mut old_line, mut new_line) = (1usize, 1usize);
    while i < n {
        if ops[i].0 == Operation::Equal {
            old_line += 1;
            new_line += 1;
            i += 1;
            continue;
        }
        // Start of a hunk: back up `context` equal lines.
        let mut start = i;
        let mut back = 0;
        while start > 0 && ops[start - 1].0 == Operation::Equal && back < context {
            start -= 1;
            back += 1;
        }
        let hunk_old_start = old_line - back;
        let hunk_new_start = new_line - back;
        // Extend until we see more than 2*context equal lines in a row (or the end).
        let mut end = i;
        let mut equal_run = 0;
        while end < n {
            if ops[end].0 == Operation::Equal {
                equal_run += 1;
                if equal_run > 2 * context {
                    break;
                }
            } else {
                equal_run = 0;
            }
            end += 1;
        }
        // Trim trailing context to `context` lines.
        let mut trailing = 0;
        let mut e = end;
        while e > start && ops[e - 1].0 == Operation::Equal {
            trailing += 1;
            e -= 1;
        }
        let end = e + trailing.min(context);

        let (mut old_len, mut new_len) = (0, 0);
        for (op, _) in &ops[start..end] {
            match op {
                Operation::Equal => {
                    old_len += 1;
                    new_len += 1;
                }
                Operation::Delete => old_len += 1,
                Operation::Insert => new_len += 1,
            }
        }
        let old_start = if old_len == 0 {
            hunk_old_start.saturating_sub(1)
        } else {
            hunk_old_start
        };
        let new_start = if new_len == 0 {
            hunk_new_start.saturating_sub(1)
        } else {
            hunk_new_start
        };
        style.hunk_header(
            &mut change.hunks,
            (old_start, old_len, new_start, new_len),
            first,
        );
        first = false;
        let (mut o, mut nn) = (hunk_old_start, hunk_new_start);
        for (k, (op, line)) in ops[start..end].iter().enumerate() {
            let emph = pair_emphasis(&ops[start..end], k);
            style.line(
                &mut change.hunks,
                *op,
                map(old_map, o),
                map(new_map, nn),
                line,
                change.highlight,
                emph,
            );
            let idx = start + k;
            if !style.pretty
                && ((Some(idx) == last_old && old_unterminated)
                    || (Some(idx) == last_new && new_unterminated))
            {
                change.hunks.extend_from_slice(NO_NEWLINE_MARKER);
            }
            match op {
                Operation::Equal => {
                    o += 1;
                    nn += 1;
                }
                Operation::Delete => o += 1,
                Operation::Insert => nn += 1,
            }
        }
        // Advance line counters past this hunk.
        for (op, _) in &ops[i..end] {
            match op {
                Operation::Equal => {
                    old_line += 1;
                    new_line += 1;
                }
                Operation::Delete => old_line += 1,
                Operation::Insert => new_line += 1,
            }
        }
        i = end;
    }
}
