//! Runs the install's `git` commands as child processes on the install thread's event loop.

use core::cell::Cell;
use core::ffi::{CStr, c_void};
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::ffi::CString;

use bstr::BStr;
use bun_core::fmt::for_terminal;
use bun_core::{Output, strings};
use bun_event_loop::EventLoopHandle;
use bun_io::BufferedReader;
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags};
use bun_paths as Path;
use bun_ptr::{BackRef, JsCell, RefPtr, ThisPtr};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{Process, ProcessHandle, Rusage, SpawnEnv, SpawnOptions, Status};
use bun_sys::Fd;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::thread_pool as ThreadPool;

use crate::cache_publish::StagedEntry;
use crate::install::{ExtractData, ExtractDataJson};
use crate::package_manager_task::{self as Task, Tag};
use crate::repository::{GitEnv, Repository, RepositoryExt as _, is_safe_resolved_tag};
use crate::{Error, PackageManager};

impl PackageManager {
    /// Queues a git task; it counts as pending from now on.
    pub(crate) fn enqueue_git_task(&mut self, task: NonNull<Task::Task<'static>>) {
        debug_assert!(
            !self.options.runtime_auto_install,
            "a git child exits through this thread's event loop"
        );
        self.increment_pending_tasks(1);
        self.git_tasks.push_back(task);
    }

    /// Called from `schedule_tasks`; a finished task does not start the next one itself.
    pub(crate) fn start_git_tasks(&mut self) {
        let max = u32::from(bun_core::get_thread_count());
        while self.running_git_tasks.load(Ordering::Relaxed) < max {
            // The first task works out the environment that every git task shares. No other task
            // starts until that is done.
            if !self.has_git_env() && self.running_git_tasks.load(Ordering::Relaxed) > 0 {
                break;
            }
            let Some(task) = self.git_tasks.pop_front() else {
                break;
            };
            self.running_git_tasks.fetch_add(1, Ordering::Relaxed);
            GitSubprocess::start(self, task);
        }
    }

    fn has_git_env(&self) -> bool {
        self.git_env
            .get()
            .as_ref()
            .is_some_and(|env| env.is_settled)
    }
}

/// The command the running child is.
enum Step {
    /// `git` with `GitEnv::CONFIG_QUERY`. The first task runs it before its own commands.
    Config,
    /// `git fetch <url>` in this cached bare repository (clone task).
    Fetch {
        repo: bun_sys::Dir,
        url: Vec<u8>,
        is_retry: bool,
    },
    /// `git clone --bare <url> <tmp>` (clone task). `replaces` is true when the new clone takes
    /// the place of a cached clone that git cannot use.
    Clone { url: Vec<u8>, replaces: bool },
    /// `git log -1 <committish>` (commit task).
    Log,
    /// `git ls-tree -r -z <resolved>` in the bare repository (checkout task). Holds the
    /// `--git-dir=<path>` argument that names that repository.
    ListTree(Vec<u8>),
    /// `git restore --source=<resolved>` from the bare repository into `<tmp>` (checkout task).
    /// Holds the output of the `ListTree` step.
    Checkout(Vec<u8>),
}

/// The filesystem tail of a clone or checkout task; `Task::callback` runs it on a pool worker.
pub(crate) enum Finalize {
    /// The bare repository exists (a cache hit, or `git fetch` refreshed it).
    Repo(Fd),
    /// A fresh bare clone to move into the cache, its URL, and the `replaces` of `Step::Clone`.
    PublishRepo(CacheStaging, Vec<u8>, bool),
    /// A checkout that is already in the cache, and the result of `read_package_json_in` for it.
    CachedCheckout(bun_sys::Dir, bun_sys::Maybe<Vec<u8>>),
    /// A fresh checkout, to strip and move into the cache.
    PublishCheckout(
        CacheStaging,
        /* the output of `git ls-tree -r -z` */ Vec<u8>,
    ),
    Failed {
        staging: Option<CacheStaging>,
        err: Error,
    },
}

impl Finalize {
    /// Completes `task` from its `git_finalize`. Thread-pool side.
    pub(crate) fn run(task: &mut Task::Task<'_>) {
        let finalize = task
            .git_finalize
            .take()
            .expect("a clone or checkout task carries its finalize step");
        let result = match finalize {
            Finalize::Repo(fd) => Ok(Task::Data {
                git_clone: ManuallyDrop::new(fd),
            }),
            Finalize::PublishRepo(staging, url, replaces) => {
                finish_clone(task, staging, &url, replaces).map(|dir| Task::Data {
                    git_clone: ManuallyDrop::new(dir.into_raw()),
                })
            }
            Finalize::CachedCheckout(dir, json) => {
                read_package_json(task, dir, json).map(|data| Task::Data {
                    git_checkout: ManuallyDrop::new(data),
                })
            }
            Finalize::PublishCheckout(staging, tree) => {
                finish_checkout(task, staging, &tree).map(|data| Task::Data {
                    git_checkout: ManuallyDrop::new(data),
                })
            }
            Finalize::Failed { staging, err } => {
                if let Some(staging) = staging {
                    staging.discard();
                }
                Err(err)
            }
        };
        match result {
            Ok(data) => {
                task.status = Task::Status::Success;
                task.err = None;
                task.data = data;
            }
            Err(err) => {
                task.status = Task::Status::Fail;
                task.err = Some(err);
                // `deinit_payload` drops the active `data` arm, so a failure writes one too.
                task.data = match task.tag {
                    Tag::GitClone => Task::Data {
                        git_clone: ManuallyDrop::new(Fd::invalid()),
                    },
                    _ => Task::Data {
                        git_checkout: ManuallyDrop::new(ExtractData::default()),
                    },
                };
            }
        }
    }
}

/// Strips the fresh checkout in `staging`, moves it into the cache, and reads its `package.json`.
fn finish_checkout(
    task: &mut Task::Task<'_>,
    staging: CacheStaging,
    tree: &[u8],
) -> Result<ExtractData, Error> {
    let req = task.request_git_checkout();
    let (name, resolved) = (req.name.slice().to_vec(), req.resolved.slice().to_vec());

    let dir = match bun_sys::Dir::borrow(&staging.cache_dir).open_at(&staging.tmp_name) {
        Ok(dir) => dir,
        Err(err) => {
            staging.discard();
            return Err(err.into());
        }
    };
    let _ = dir.delete_tree(b".git");
    // `.bun-tag` is the cache-hit marker; a checked-in one is replaced.
    let _ = dir.delete_tree(b".bun-tag");
    let prepared = copy_linked_files(&dir, tree)
        .map_err(|err| ("replacing links", err))
        .and_then(|()| strip_node_modules(&dir).map_err(|err| ("cleaning \"node_modules\"", err)))
        .and_then(|()| {
            bun_sys::File::openat(
                dir.fd(),
                bun_core::zstr!(".bun-tag"),
                bun_sys::O::WRONLY
                    | bun_sys::O::CREAT
                    | bun_sys::O::EXCL
                    | if cfg!(windows) {
                        0
                    } else {
                        bun_sys::O::NOFOLLOW
                    },
                0o664,
            )
            .and_then(|f| f.write_all(&resolved))
            .map_err(|err| ("writing \".bun-tag\"", err))
        });
    // Windows cannot rename a directory with an open handle inside it.
    dir.close();
    if let Err((what, err)) = prepared {
        staging.discard();
        task.log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "{} for \"{}\" failed: {}",
                what,
                for_terminal(BStr::new(&name)),
                BStr::new(err.name())
            ),
        );
        return Err(Error::InstallFailed);
    }

    let folder_name = checkout_folder_name(&resolved);
    let package_dir = staging.publish(&mut task.log, &name, &folder_name, &is_usable_checkout)?;
    let json = read_package_json_in(&package_dir);
    read_package_json(task, package_dir, json)
}

/// git was told to check out each symlink as a plain file. This replaces it with a copy of its
/// target, or removes it. Targets are resolved in `tree` (`git ls-tree -r -z`), never on disk.
fn copy_linked_files(checkout: &bun_sys::Dir, tree: &[u8]) -> bun_sys::Maybe<()> {
    use bun_sys::{E, O};
    const LINK: &[u8] = b"120000";

    if !strings::split(tree, b"\0").any(|entry| entry.starts_with(LINK)) {
        return Ok(());
    }
    let mut entries: Vec<(&[u8], &[u8])> = strings::split(tree, b"\0")
        .filter_map(|entry| strings::split_once_char(entry, b'\t'))
        .map(|(head, path)| (path, &head[..head.len().min(LINK.len())]))
        .collect();
    entries.sort_unstable();

    // Read every symlink's target before replacing any, because a symlink can point to another
    // symlink. `None` marks an entry that is not a symlink, or one that git wrote no file for.
    let mut targets: Vec<Option<Vec<u8>>> = Vec::with_capacity(entries.len());
    for &(path, mode) in &entries {
        if mode != LINK || !stays_in_checkout(path) {
            targets.push(None);
            continue;
        }
        let target = checkout
            .open_file(path, O::RDONLY | O::CLOEXEC | O::NOFOLLOW, 0)
            .and_then(|file| file.read_to_end());
        targets.push(match target {
            Ok(target) => Some(target),
            Err(err) if matches!(err.get_errno(), E::ENOENT | E::EISDIR) => None,
            Err(err) => return Err(err),
        });
    }

    let ends = link_ends(&entries, &targets);
    for (link, end) in ends.iter().enumerate() {
        if targets[link].is_none() {
            continue;
        }
        let path = entries[link].0;
        bun_sys::unlinkat(checkout.fd(), &bun_core::ZBox::from_bytes(path))?;
        let LinkEnd::At(Some(end)) = end else {
            continue;
        };
        let Ok(file) = entries.binary_search_by(|(listed, _)| (*listed).cmp(end)) else {
            continue;
        };
        let (from, mode) = entries[file];
        // git itself creates executable and regular files with these modes, before the umask.
        let mode = match mode {
            b"100755" => 0o777,
            b"100644" => 0o666,
            _ => continue,
        };
        if !stays_in_checkout(from) {
            continue;
        }
        let from = match checkout.open_file(from, O::RDONLY | O::CLOEXEC | O::NOFOLLOW, 0) {
            // A listed file can be missing, because `finish_checkout` deletes a checked-in
            // `.bun-tag`.
            Err(err) if err.get_errno() == E::ENOENT => continue,
            from => from?,
        };
        let to = checkout.open_file(path, O::WRONLY | O::CREAT | O::EXCL | O::CLOEXEC, mode)?;
        bun_sys::copy_file(from.handle(), to.handle())?;
    }
    Ok(())
}

/// Returns true if a path from git's listing stays inside the folder that it's opened from. git
/// doesn't write a file for a path that leaves it.
fn stays_in_checkout(path: &[u8]) -> bool {
    if cfg!(windows) {
        return bun_patch::is_safe_patch_path(path);
    }
    !path.is_empty()
        && path[0] != b'/'
        && !strings::contains_char(path, 0)
        && !strings::split(path, b"/").any(|part| part == b"..")
}

enum LinkEnd {
    Unknown,
    /// Being resolved right now. Reaching this link again means that the links form a loop.
    Walking,
    /// The final path, relative to the repository root, with every symlink in it resolved.
    /// `None` if the link leaves the repository or is part of a loop.
    At(Option<Vec<u8>>),
}

/// Works out where each symlink in `entries` finally leads, following links through other links.
/// It uses only the target text in `targets`, never the disk. `entries` must be sorted by path.
fn link_ends(entries: &[(&[u8], &[u8])], targets: &[Option<Vec<u8>>]) -> Vec<LinkEnd> {
    struct Walk<'a> {
        link: usize,
        /// The path resolved so far.
        at: Vec<u8>,
        /// The path components that still have to be resolved, in reverse order, so the next one is
        /// last.
        rest: Vec<&'a [u8]>,
    }
    let walk_of = |link: usize| {
        let path = entries[link].0;
        let mut rest: Vec<&[u8]> = targets[link]
            .as_deref()
            .map(|target| strings::split(target, b"/").collect())
            .unwrap_or_default();
        rest.reverse();
        Walk {
            link,
            at: path[..strings::last_index_of_char(path, b'/').unwrap_or(0)].to_vec(),
            rest,
        }
    };

    let mut ends: Vec<LinkEnd> = targets
        .iter()
        .map(|target| match target {
            Some(target) if target.first() != Some(&b'/') => LinkEnd::Unknown,
            _ => LinkEnd::At(None),
        })
        .collect();
    // An explicit stack instead of recursion, because a chain of links can be arbitrarily long.
    let mut walks: Vec<Walk<'_>> = Vec::new();
    for first in 0..ends.len() {
        if !matches!(ends[first], LinkEnd::Unknown) {
            continue;
        }
        ends[first] = LinkEnd::Walking;
        walks.push(walk_of(first));
        while let Some(walk) = walks.last_mut() {
            let end = match walk.rest.pop() {
                None => Some(core::mem::take(&mut walk.at)),
                Some(b"" | b".") => continue,
                Some(b"..") if walk.at.is_empty() => None,
                Some(b"..") => {
                    let parent = strings::last_index_of_char(&walk.at, b'/').unwrap_or(0);
                    walk.at.truncate(parent);
                    continue;
                }
                Some(part) => {
                    let parent = walk.at.len();
                    if parent > 0 {
                        walk.at.push(b'/');
                    }
                    walk.at.extend_from_slice(part);
                    let Some(next) = entries
                        .binary_search_by(|(listed, _)| (*listed).cmp(&walk.at))
                        .ok()
                        .filter(|&listed| targets[listed].is_some())
                    else {
                        continue;
                    };
                    match &ends[next] {
                        LinkEnd::At(Some(end)) => {
                            walk.at.clone_from(end);
                            continue;
                        }
                        LinkEnd::At(None) | LinkEnd::Walking => None,
                        LinkEnd::Unknown => {
                            // Resolve that link first, then process this component again.
                            walk.at.truncate(parent);
                            walk.rest.push(part);
                            ends[next] = LinkEnd::Walking;
                            walks.push(walk_of(next));
                            continue;
                        }
                    }
                }
            };
            ends[walk.link] = LinkEnd::At(end);
            walks.pop();
        }
    }
    ends
}

/// Removes a checked-in `node_modules`, as npm and pnpm do, unless the package bundles
/// dependencies.
fn strip_node_modules(checkout: &bun_sys::Dir) -> bun_sys::Maybe<()> {
    // Most repositories have no `node_modules`, and this call also removes one that is a file.
    match checkout.delete_file_z(bun_core::zstr!("node_modules")) {
        Ok(()) => return Ok(()),
        Err(err) if err.get_errno() == bun_sys::E::ENOENT => return Ok(()),
        Err(_) => {}
    }
    crate::initialize_mini_store();
    if bundles_dependencies(checkout) {
        return Ok(());
    }
    checkout.delete_tree(b"node_modules")
}

/// The caller must initialize an AST store on this thread first.
pub(crate) fn bundles_dependencies(package_dir: &bun_sys::Dir) -> bool {
    let Ok(contents) = read_package_json_in(package_dir) else {
        return false;
    };
    let source = bun_ast::Source::init_path_string("package.json", &contents[..]);
    crate::bun_json::ParsedJson::parse_package_json(&source, &mut bun_ast::Log::init()).is_ok_and(
        |parsed| {
            let root = &parsed.root;
            // Either `true` or a non-empty list of names. `as_array` returns `None` for `[]`.
            (root.get(b"bundleDependencies"))
                .or_else(|| root.get(b"bundledDependencies"))
                .is_some_and(|field| field.as_bool() == Some(true) || field.as_array().is_some())
        },
    )
}

/// Reads the `package.json` in a package's folder, without following a symlink.
pub(crate) fn read_package_json_in(package_dir: &bun_sys::Dir) -> bun_sys::Maybe<Vec<u8>> {
    use bun_sys::O;
    package_dir
        .open_file(b"package.json", O::RDONLY | O::CLOEXEC | O::NOFOLLOW, 0)?
        .read_to_end()
}

/// `json` is the result of `read_package_json_in(&package_dir)`. This closes `package_dir`.
fn read_package_json(
    task: &mut Task::Task<'_>,
    package_dir: bun_sys::Dir,
    json: bun_sys::Maybe<Vec<u8>>,
) -> Result<ExtractData, Error> {
    let req = task.request_git_checkout();
    let name = req.name.slice().to_vec();
    let (url, resolved): (Box<[u8]>, Box<[u8]>) =
        (req.url.slice().into(), req.resolved.slice().into());

    let json_buf = match json {
        Ok(v) => v,
        Err(err) => {
            package_dir.close();
            if err.get_errno() == bun_sys::E::ENOENT {
                // allow git dependencies without package.json
                return Ok(ExtractData {
                    url,
                    resolved,
                    ..Default::default()
                });
            }
            task.log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "\"package.json\" for \"{}\" failed to open: {}",
                    for_terminal(BStr::new(&name)),
                    BStr::new(err.name())
                ),
            );
            return Err(Error::InstallFailed);
        }
    };

    let mut dir_path_buf = Path::path_buffer_pool::get();
    let json_path = match package_dir.get_fd_path(&mut dir_path_buf) {
        Ok(dir_path) => Path::resolve_path::join_abs_string::<Path::platform::Auto>(
            dir_path,
            &[b"package.json"],
        ),
        Err(err) => {
            task.log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "\"package.json\" for \"{}\" failed to resolve: {}",
                    for_terminal(BStr::new(&name)),
                    BStr::new(err.name())
                ),
            );
            package_dir.close();
            return Err(Error::InstallFailed);
        }
    };
    let path = bun_resolver::fs::FileSystem::instance()
        .dirname_store()
        .append(json_path);
    package_dir.close();

    Ok(ExtractData {
        url,
        resolved,
        json: Some(ExtractDataJson {
            path: path?.into(),
            buf: json_buf,
        }),
        ..Default::default()
    })
}

/// `@G@<resolved>`: the cache folder of a checkout.
fn checkout_folder_name(resolved: &[u8]) -> Vec<u8> {
    let mut buf = [0u8; 512];
    crate::package_manager_real::cached_git_folder_name_print(&mut buf, resolved, None)
        .as_bytes()
        .to_vec()
}

/// A cache folder, built under a temporary name and renamed once complete.
pub(crate) struct CacheStaging {
    cache_dir: Fd,
    tmp_name: Vec<u8>,
    /// `<cache dir>/<tmp_name>`
    tmp_path: Vec<u8>,
}

impl CacheStaging {
    fn new(cache_dir: Fd, cache_dir_path: &[u8]) -> Result<Self, Error> {
        let mut tmp_name_buf = [0u8; 64];
        let tmp_name =
            Path::fs::FileSystem::tmpname(b"tmp", &mut tmp_name_buf, bun_core::fast_random())
                .map_err(|_| Error::Sys(bun_errno::SystemErrno::ENOSPC))?
                .to_vec();
        let tmp_path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
            cache_dir_path,
            &[&tmp_name],
        )
        .to_vec();
        Ok(Self {
            cache_dir,
            tmp_name,
            tmp_path,
        })
    }

    fn create(&self) -> bun_sys::Maybe<()> {
        bun_sys::Dir::borrow(&self.cache_dir).make_path(&self.tmp_name)
    }

    fn discard(&self) {
        let _ = bun_sys::Dir::borrow(&self.cache_dir).delete_tree(&self.tmp_name);
    }

    /// Opens `folder_name`, which is either the staging folder renamed into place, or a folder that
    /// already exists and passes `is_complete`.
    fn publish(
        self,
        log: &mut bun_ast::Log,
        name: &[u8],
        folder_name: &[u8],
        is_complete: &dyn Fn(&bun_sys::Dir) -> bool,
    ) -> Result<bun_sys::Dir, Error> {
        StagedEntry::new(self.cache_dir, &bun_core::ZBox::from_bytes(&self.tmp_name))
            .publish_and_open(
                self.cache_dir,
                &bun_core::ZBox::from_bytes(folder_name),
                is_complete,
            )
            .map_err(|err| {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "moving \"{}\" to cache dir failed: {}",
                        for_terminal(BStr::new(name)),
                        err
                    ),
                );
                Error::InstallFailed
            })
    }
}

/// `.bun-tag` is written last, so a checkout that has it is complete.
fn is_tagged_checkout(dir: &bun_sys::Dir) -> bool {
    bun_sys::exists_at(dir.fd(), bun_core::zstr!(".bun-tag"))
}

/// Returns true if `read_package_json_in` failed because `package.json` is a symlink. Only older
/// versions of Bun cached such a checkout. It isn't used, and the commit is checked out again.
fn is_link(json: &bun_sys::Maybe<Vec<u8>>) -> bool {
    matches!(json, Err(err) if err.get_errno() == bun_sys::E::ELOOP)
}

fn is_usable_checkout(dir: &bun_sys::Dir) -> bool {
    is_tagged_checkout(dir) && !is_link(&read_package_json_in(dir))
}

/// Returns the forms of `url` to clone from. The last one is tried first, so https before ssh.
fn clone_urls(url: &[u8]) -> Vec<Vec<u8>> {
    let mut urls: Vec<Vec<u8>> = Vec::new();
    urls.extend(Repository::try_ssh(url));
    urls.extend(Repository::try_https(url));
    // Any other `url` is passed to git unchanged, but only if it has a scheme. git would read
    // anything else as a path relative to the project.
    if urls.is_empty() && strings::contains(url, b"://") {
        urls.push(url.to_vec());
    }
    urls
}

/// Builds the whole `config` file of a cached clone. From `old`, the previous `config`, it keeps
/// only the object and ref storage formats, which git needs to read the repository.
fn clone_config(url: &[u8], old: &[u8]) -> Vec<u8> {
    let mut quoted: Vec<u8> = Vec::with_capacity(url.len());
    for &byte in url {
        match byte {
            b'\\' | b'"' => quoted.extend_from_slice(&[b'\\', byte]),
            b'\n' => quoted.extend_from_slice(b"\\n"),
            _ => quoted.push(byte),
        }
    }
    let mut extensions: Vec<u8> = Vec::new();
    for line in [
        b"\tobjectformat = sha256\n".as_slice(),
        b"\trefstorage = reftable\n",
    ] {
        if strings::contains(old, line) {
            extensions.extend_from_slice(line);
        }
    }
    let version: &[u8] = if extensions.is_empty() {
        b"0\n\tbare = true\n"
    } else {
        b"1\n\tbare = true\n[extensions]\n"
    };
    [
        b"[core]\n\trepositoryformatversion = ".as_slice(),
        version,
        &extensions,
        b"[remote \"origin\"]\n\turl = \"",
        &quoted,
        b"\"\n",
    ]
    .concat()
}

/// Reads the clone's `config` file. Returns an empty buffer if it is missing or is a symlink.
fn read_clone_config(repo: &bun_sys::Dir) -> bun_sys::Maybe<Vec<u8>> {
    use bun_sys::{E, O};
    match repo
        .open_file(b"config", O::RDONLY | O::CLOEXEC | O::NOFOLLOW, 0)
        .and_then(|file| file.read_to_end())
    {
        Err(err) if matches!(err.get_errno(), E::ENOENT | E::ELOOP) => Ok(Vec::new()),
        config => config,
    }
}

/// Overwrites the `config` file of the clone in `repo` with the output of `clone_config`.
fn write_clone_config(repo: &bun_sys::Dir, url: &[u8]) -> bun_sys::Maybe<()> {
    let old = read_clone_config(repo)?;
    let config = clone_config(url, &old);
    if config == old {
        return Ok(());
    }
    // Write a temporary file and rename it, so another install never reads a half-written `config`.
    let mut tmp_name_buf = [0u8; 64];
    let tmp_name =
        Path::fs::FileSystem::tmpname(b"tmp", &mut tmp_name_buf, bun_core::fast_random())
            .map_err(|_| bun_sys::Error::from_code(bun_sys::E::ENOSPC, bun_sys::Tag::open))?;
    bun_sys::File::write_file(repo.fd(), tmp_name, &config)?;
    bun_sys::renameat(repo.fd(), tmp_name, repo.fd(), bun_core::zstr!("config"))
}

/// Moves the URL that the clone's `config` records to the end of `urls`, so it is tried first.
fn try_last_url_first(repo: &bun_sys::Dir, urls: &mut Vec<Vec<u8>>) {
    let config = read_clone_config(repo).unwrap_or_default();
    let last = urls
        .iter()
        .position(|url| clone_config(url, &config) == config);
    if let Some(last) = last {
        let url = urls.remove(last);
        urls.push(url);
    }
}

/// Returns whether `repo` is a self-contained bare clone. Given the `config` from `clone_config`,
/// git then reads only the refs and objects stored in this folder.
fn is_own_clone(repo: &bun_sys::Dir) -> bool {
    let has = |name: &bun_core::ZStr| bun_sys::exists_at_type(repo.fd(), name).is_ok();
    // git itself requires the first three before it accepts a folder as a repository. `refs` can
    // be missing if the cache was copied by a tool that skips empty folders.
    has(bun_core::zstr!("HEAD"))
        && has(bun_core::zstr!("objects"))
        && has(bun_core::zstr!("refs"))
        && !has(bun_core::zstr!("commondir"))
        && !has(bun_core::zstr!("modules"))
        && !has(bun_core::zstr!("worktrees"))
        && !has(bun_core::zstr!("objects/info/alternates"))
        && !has(bun_core::zstr!("objects/info/http-alternates"))
        && has_no_links(repo)
}

/// Returns whether `dir` contains no symlink at any depth. `dir` must be a handle that has not
/// been listed before, because a listing continues where the previous one on the handle stopped.
fn has_no_links(dir: &bun_sys::Dir) -> bool {
    use bun_sys::{EntryKind, O};
    // The folders still to list, as paths relative to `dir`. This is a work list instead of
    // recursion because folders can be nested arbitrarily deep.
    let mut folders: Vec<Vec<u8>> = vec![Vec::new()];
    while let Some(folder) = folders.pop() {
        let opened = if folder.is_empty() {
            None
        } else {
            match dir.open_at_with(&folder, O::RDONLY | O::CLOEXEC | O::NOFOLLOW) {
                Ok(opened) => Some(opened),
                // Another install's git may be running here, and git removes folders it empties.
                Err(err) if err.get_errno() == bun_sys::E::ENOENT => continue,
                Err(_) => return false,
            }
        };
        let fd = opened.as_ref().unwrap_or(dir).fd();
        let mut entries = bun_sys::iterate_dir(fd);
        loop {
            let entry = match entries.next() {
                Ok(Some(entry)) => entry,
                Ok(None) => break,
                Err(_) => return false,
            };
            let name = entry.name.slice_u8();
            let kind = match entry.kind {
                EntryKind::Unknown => {
                    match bun_sys::lstatat(fd, &bun_core::ZBox::from_bytes(name)) {
                        Ok(stat) => bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode),
                        Err(_) => return false,
                    }
                }
                known => known,
            };
            match kind {
                EntryKind::SymLink => return false,
                EntryKind::Directory if folder.is_empty() => folders.push(name.to_vec()),
                EntryKind::Directory => folders.push([&folder[..], b"/", name].concat()),
                _ => {}
            }
        }
    }
    true
}

/// Moves the clone of `url` from `staging` into the cache. A usable clone that is already in the
/// cache is kept instead, unless `replaces` is set.
fn finish_clone(
    task: &mut Task::Task<'_>,
    staging: CacheStaging,
    url: &[u8],
    replaces: bool,
) -> Result<bun_sys::Dir, Error> {
    let name = task.request_git_clone().name.slice().to_vec();
    let repo = staging.publish(
        &mut task.log,
        &name,
        &bare_repo_folder_name(task.id),
        &|repo| !replaces && is_own_clone(repo),
    )?;
    if let Err(err) = write_clone_config(&repo, url) {
        task.log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "writing \"config\" for \"{}\" failed: {}",
                for_terminal(BStr::new(&name)),
                BStr::new(err.name())
            ),
        );
        return Err(Error::InstallFailed);
    }
    Ok(repo)
}

/// `<hex(clone task id)>.git`: the cache folder of a bare clone.
pub(crate) fn bare_repo_folder_name(clone_id: Task::Id) -> Vec<u8> {
    format!("{}.git", bun_core::fmt::hex_int_lower::<16>(clone_id.get())).into_bytes()
}

// `finish_*` release the owning ref (freeing `this`), so everything on a path to
// them takes `ThisPtr<Self>` rather than `&self` and touches nothing afterwards;
// mutable state sits in cells so every access is a short shared borrow.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct GitSubprocess {
    ref_count: Cell<u32>,
    /// The single owning ref; `release` drops it and frees the runner.
    owner: Cell<Option<RefPtr<GitSubprocess>>>,
    manager: BackRef<PackageManager, bun_ptr::Mut>,
    /// Ours alone until `finish_on_pool` / `finish_commit` hands it on.
    task: NonNull<Task::Task<'static>>,
    tag: Tag,
    name: Box<[u8]>,
    event_loop: EventLoopHandle,
    cache_dir: Fd,

    step: JsCell<Step>,
    /// Clone URLs still to try, last first (https before ssh).
    urls: JsCell<Vec<Vec<u8>>>,
    /// Every URL tried so far, each with git's stderr. Printed only after the last URL has failed.
    clone_output: JsCell<Vec<u8>>,
    /// Moves into the task's `Finalize`; `Drop` discards it otherwise.
    staging: JsCell<Option<CacheStaging>>,
    read_error: JsCell<Option<bun_sys::Error>>,

    process: JsCell<Option<ProcessHandle>>,
    exit_status: JsCell<Option<Status>>,
    stdout: JsCell<BufferedReader>,
    stderr: JsCell<BufferedReader>,
    remaining_fds: Cell<i8>,
}

impl GitSubprocess {
    fn start(manager: &mut PackageManager, task: NonNull<Task::Task<'static>>) {
        let cache_dir = manager.get_cache_directory();
        let event_loop = EventLoopHandle::from_any(&mut manager.event_loop);
        // SAFETY: a queued git task is live and idle until its runner hands it on.
        let (tag, name) = unsafe {
            let t = task.as_ref();
            let name: Box<[u8]> = match t.tag {
                Tag::GitClone => t.request_git_clone().name.slice().into(),
                Tag::GitCommit => t.request_git_commit().name.slice().into(),
                Tag::GitCheckout => t.request_git_checkout().name.slice().into(),
                _ => unreachable!("not a git task"),
            };
            (t.tag, name)
        };
        let runner = RefPtr::new(GitSubprocess {
            ref_count: Cell::new(1),
            owner: Cell::new(None),
            manager: BackRef::new_mut(manager),
            task,
            tag,
            name,
            event_loop,
            cache_dir,
            step: JsCell::new(Step::Config),
            urls: JsCell::new(Vec::new()),
            clone_output: JsCell::new(Vec::new()),
            staging: JsCell::new(None),
            read_error: JsCell::new(None),
            process: JsCell::new(None),
            exit_status: JsCell::new(None),
            stdout: JsCell::new(BufferedReader::init::<Self>()),
            stderr: JsCell::new(BufferedReader::init::<Self>()),
            remaining_fds: Cell::new(0),
        });
        let this = runner.this_ptr();
        this.owner.set(Some(runner));
        let result = if this.manager().has_git_env() {
            Self::begin(this)
        } else {
            this.manager().git_env.set(Some(GitEnv::new(None)));
            this.step.set(Step::Config);
            Self::spawn(this, GitEnv::CONFIG_QUERY)
        };
        // An `Err` leaves `this` untouched; an `Ok` may already have freed it.
        if let Err(err) = result {
            Self::fail(this, err);
        }
    }

    /// May free `this` on `Ok`.
    fn begin(this: ThisPtr<Self>) -> Result<(), Error> {
        match this.tag {
            Tag::GitClone => Self::begin_clone(this),
            Tag::GitCommit => Self::begin_commit(this),
            _ => Self::begin_checkout(this),
        }
    }

    fn manager(&self) -> &PackageManager {
        self.manager.get()
    }

    /// Call-scoped access to the task; see the field comment.
    #[allow(clippy::mut_from_ref)]
    fn task(&self) -> &mut Task::Task<'static> {
        // SAFETY: the task is owned by `preallocated_resolve_tasks` and touched by
        // nothing else while this runner holds it; every borrow here is call-scoped.
        unsafe { &mut *self.task.as_ptr() }
    }

    /// A clone or commit lookup that only optional dependencies wait for fails with warnings.
    fn is_required(&self) -> bool {
        self.tag == Tag::GitCheckout || self.manager().is_network_task_required(self.task().id)
    }

    fn log_failure(&self, args: core::fmt::Arguments<'_>) {
        let is_required = self.is_required();
        let log = &mut self.task().log;
        if is_required {
            log.add_error_fmt(None, bun_ast::Loc::EMPTY, args);
        } else {
            log.add_warning_fmt(None, bun_ast::Loc::EMPTY, args);
        }
    }

    fn new_staging(&self) -> Result<Vec<u8>, Error> {
        let staging = CacheStaging::new(self.cache_dir, &self.manager().cache_directory_path)?;
        let tmp_path = staging.tmp_path.clone();
        self.staging.set(Some(staging));
        Ok(tmp_path)
    }

    // ── clone ───────────────────────────────────────────────────────────────

    /// May free `this` on `Ok`.
    fn begin_clone(this: ThisPtr<Self>) -> Result<(), Error> {
        bun_analytics::features::git_dependencies.fetch_add(1, Ordering::Relaxed);
        use bun_sys::{E, O};
        let mut urls = clone_urls(this.task().request_git_clone().url.slice());

        let offline = this.manager().options.offline
            == crate::package_manager_real::options::OfflineMode::Offline;
        let folder_name = bare_repo_folder_name(this.task().id);
        // If anything other than a usable clone has this name, clone again. `publish` replaces it.
        match bun_sys::Dir::borrow(&this.cache_dir)
            .open_at_with(&folder_name, O::RDONLY | O::CLOEXEC | O::NOFOLLOW)
        {
            Ok(repo) => {
                if !urls.is_empty() && is_own_clone(&repo) {
                    try_last_url_first(&repo, &mut urls);
                    this.urls.set(urls);
                    // `--prefer-offline` still fetches, because a stale clone may not have the
                    // pinned commit.
                    if !offline {
                        return Self::fetch_next(this, repo);
                    }
                    write_clone_config(&repo, this.urls.get().last().expect("is not empty"))?;
                    Self::finish_on_pool(this, Finalize::Repo(repo.into_raw()));
                    return Ok(());
                }
            }
            Err(err) if matches!(err.get_errno(), E::ENOENT | E::ENOTDIR | E::ELOOP) => {}
            Err(err) => return Err(err.into()),
        }
        this.urls.set(urls);
        if offline {
            this.log_failure(format_args!(
                "--offline: git repository for \"{}\" is not in the cache",
                for_terminal(BStr::new(&this.name))
            ));
            return Err(Error::InstallFailed);
        }
        if this.urls.get().is_empty() {
            return Err(Error::RepositoryNotFound);
        }
        Self::spawn_clone(this, false)
    }

    /// Pops the next URL off `urls`, which must not be empty, and records it in `clone_output`.
    fn next_url(&self, command: &str) -> Vec<u8> {
        let url = self
            .urls
            .with_mut(|urls| urls.pop())
            .expect("a clone URL is left");
        let heading = format!("git {} {}\n", command, for_terminal(BStr::new(&url)));
        self.clone_output
            .with_mut(|output| output.extend_from_slice(heading.as_bytes()));
        url
    }

    /// Appends git's stderr for the URL that `next_url` last returned to `clone_output`.
    fn hold_output(&self, stderr: &[u8]) {
        self.clone_output.with_mut(|output| {
            output.extend_from_slice(stderr);
            if output.last() != Some(&b'\n') {
                output.push(b'\n');
            }
        });
    }

    /// `urls` is not empty. May free `this` on `Ok`.
    fn fetch_next(this: ThisPtr<Self>, repo: bun_sys::Dir) -> Result<(), Error> {
        let url = this.next_url("fetch");
        // Each attempt records its URL in `config`, so the URL that works is the one that remains.
        write_clone_config(&repo, &url)?;
        Self::spawn_fetch(this, repo, &url, false)
    }

    /// Builds `--git-dir=<bare clone>`. With `-C` instead, git would search the parent folders for
    /// a repository if this folder turned out not to be one.
    fn git_dir_arg(&self, clone_id: Task::Id) -> Vec<u8> {
        [
            b"--git-dir=".as_slice(),
            Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                &self.manager().cache_directory_path,
                &[&bare_repo_folder_name(clone_id)],
            ),
        ]
        .concat()
    }

    /// May free `this` on `Ok`.
    fn spawn_fetch(
        this: ThisPtr<Self>,
        repo: bun_sys::Dir,
        url: &[u8],
        is_retry: bool,
    ) -> Result<(), Error> {
        let git_dir = this.git_dir_arg(this.task().id);
        this.step.set(Step::Fetch {
            repo,
            url: url.to_vec(),
            is_retry,
        });
        // `--prune` removes refs that were renamed or deleted upstream.
        Self::spawn(
            this,
            &[
                &git_dir,
                b"-c",
                b"core.longpaths=true",
                b"fetch",
                b"--quiet",
                b"--prune",
                b"--no-recurse-submodules",
                b"--",
                url,
                // A glob, unlike a plain `HEAD`, is allowed to match nothing. That matters when
                // the remote's HEAD does not name an existing branch.
                b"+HEAD*:refs/remotes/origin/HEAD*",
                b"+refs/heads/*:refs/heads/*",
                b"+refs/tags/*:refs/tags/*",
            ],
        )
    }

    /// `urls` is not empty. May free `this` on `Ok`.
    fn spawn_clone(this: ThisPtr<Self>, replaces: bool) -> Result<(), Error> {
        let url = this.next_url("clone");
        let tmp_path = this.new_staging()?;
        this.step.set(Step::Clone {
            url: url.clone(),
            replaces,
        });
        Self::spawn(
            this,
            &[
                b"clone",
                b"-c",
                b"core.longpaths=true",
                b"--quiet",
                b"--bare",
                b"--template=",
                b"--",
                &url,
                &tmp_path,
            ],
        )
    }

    // ── find commit ─────────────────────────────────────────────────────────

    /// May free `this` on `Ok`.
    fn begin_commit(this: ThisPtr<Self>) -> Result<(), Error> {
        let req = this.task().request_git_commit();
        let committish = req.committish.slice().to_vec();
        let git_dir = this.git_dir_arg(req.clone_id);
        this.step.set(Step::Log);
        if committish.is_empty() || committish == b"HEAD" {
            // Prints the first of the two refs that resolves. The fetched `origin/HEAD` comes first
            // because a fetch never updates the clone's own `HEAD`.
            Self::spawn(
                this,
                &[
                    &git_dir,
                    b"log",
                    b"--format=%H",
                    b"-1",
                    b"--no-walk=unsorted",
                    b"--ignore-missing",
                    b"refs/remotes/origin/HEAD",
                    b"HEAD",
                ],
            )
        } else {
            Self::spawn(
                this,
                &[
                    &git_dir,
                    b"log",
                    b"--format=%H",
                    b"-1",
                    b"--end-of-options",
                    &committish,
                ],
            )
        }
    }

    // ── checkout ────────────────────────────────────────────────────────────

    /// May free `this` on `Ok`.
    fn begin_checkout(this: ThisPtr<Self>) -> Result<(), Error> {
        bun_analytics::features::git_dependencies.fetch_add(1, Ordering::Relaxed);
        let req = this.task().request_git_checkout();
        let repo_dir = req.repo_dir;
        let resolved = req.resolved.slice().to_vec();
        if !is_safe_resolved_tag(&resolved) {
            this.log_failure(format_args!(
                "invalid git commit \"{}\" for \"{}\"",
                bun_core::fmt::escape_control_chars(&resolved),
                for_terminal(BStr::new(&this.name))
            ));
            return Err(Error::InstallFailed);
        }

        match bun_sys::Dir::borrow(&this.cache_dir).open_at(&checkout_folder_name(&resolved)) {
            Ok(dir) => {
                if is_tagged_checkout(&dir) {
                    let json = read_package_json_in(&dir);
                    if !is_link(&json) {
                        Self::finish_on_pool(this, Finalize::CachedCheckout(dir, json));
                        return Ok(());
                    }
                }
                dir.close();
            }
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => {}
            Err(err) => return Err(err.into()),
        }

        let mut repo_path_buf = Path::path_buffer_pool::get();
        let repo_path = bun_sys::get_fd_path(repo_dir, &mut repo_path_buf)?;
        let git_dir = [b"--git-dir=".as_slice(), repo_path].concat();
        this.step.set(Step::ListTree(git_dir.clone()));
        // `is_safe_resolved_tag` rejects a leading `-`, so git cannot read `resolved` as an option.
        Self::spawn(this, &[&git_dir, b"ls-tree", b"-r", b"-z", &resolved])
    }

    /// `tree` is the output of `git ls-tree -r -z`. May free `this` on `Ok`.
    fn spawn_checkout(this: ThisPtr<Self>, git_dir: &[u8], tree: Vec<u8>) -> Result<(), Error> {
        let tmp_path = this.new_staging()?;
        let staging = this.staging.get().as_ref();
        staging.expect("`new_staging` has set it").create()?;
        // `git restore` fails when no path matches, so an empty tree skips it.
        if tree.is_empty() {
            let staging = this.staging.take().expect("`new_staging` has set it");
            Self::finish_on_pool(this, Finalize::PublishCheckout(staging, tree));
            return Ok(());
        }

        // This `git restore` never writes an index file, but it does lock one. Each checkout gets
        // its own index path, so parallel checkouts of one repository do not contend for the lock.
        let index = [b"GIT_INDEX_FILE=".as_slice(), &tmp_path, b".index"].concat();
        let index = CString::new(index).map_err(|_| Error::InvalidCharacter)?;
        let work_tree = [b"--work-tree=".as_slice(), &tmp_path].concat();
        let resolved = this.task().request_git_checkout().resolved.slice();
        let source = [b"--source=".as_slice(), resolved].concat();
        this.step.set(Step::Checkout(tree));
        Self::spawn_with(
            this,
            &[
                git_dir,
                &work_tree,
                b"-c",
                b"core.longpaths=true",
                // git writes each symlink as a plain file that holds its target, and
                // `copy_linked_files` processes those files afterwards.
                b"-c",
                b"core.symlinks=false",
                b"restore",
                b"--quiet",
                &source,
                b"--worktree",
                b"--",
                b".",
            ],
            Some(index.as_c_str()),
        )
    }

    // ── the child ───────────────────────────────────────────────────────────

    /// Spawns `git <args>` with stdout and stderr captured. On `Ok` the child
    /// may already have exited and freed `this`.
    fn spawn(this: ThisPtr<Self>, args: &[&[u8]]) -> Result<(), Error> {
        Self::spawn_with(this, args, None)
    }

    /// `variable` is an extra `KEY=VALUE` environment entry for this child only.
    fn spawn_with(
        this: ThisPtr<Self>,
        args: &[&[u8]],
        variable: Option<&CStr>,
    ) -> Result<(), Error> {
        let env = this.manager().git_env.get().as_ref();
        let env = env.expect("`start` sets the environment before any command");
        let Some(git) = &env.git else {
            this.log_failure(format_args!(
                "\"git\" is not installed (needed for \"{}\")",
                for_terminal(BStr::new(&this.name))
            ));
            return Err(Error::Sys(bun_errno::SystemErrno::ENOENT));
        };
        let mut argv: Vec<CString> = Vec::with_capacity(args.len() + 5);
        argv.push(CString::new(git.as_bytes()).map_err(|_| Error::InvalidCharacter)?);
        // No git command that an install runs executes hooks or recurses into submodules.
        for arg in [
            b"-c".as_slice(),
            concat!("core.hooksPath=", bun_core::null_device!()).as_bytes(),
            b"-c",
            b"submodule.recurse=false",
        ]
        .iter()
        .chain(args)
        {
            argv.push(CString::new(*arg).map_err(|_| Error::InvalidCharacter)?);
        }
        let argv: Vec<&CStr> = argv.iter().map(CString::as_c_str).collect();
        let envp: Vec<&CStr> = env.envp.iter().chain(variable).collect();

        let this_ptr: *mut c_void = this.as_ptr().cast();
        this.read_error.set(None);
        this.exit_status.set(None);
        this.remaining_fds.set(0);

        // Windows: the `uv::Pipe` allocations are ours until the spawn succeeds.
        let spawn_options = SpawnOptions {
            stdin: bun_spawn::Stdio::Ignore,
            #[cfg(unix)]
            stdout: bun_spawn::Stdio::Buffer,
            #[cfg(unix)]
            stderr: bun_spawn::Stdio::Buffer,
            #[cfg(windows)]
            stdout: bun_spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                bun_core::ffi::zeroed::<uv::Pipe>(),
            )) as bun_spawn::windows::UvPipePtr),
            #[cfg(windows)]
            stderr: bun_spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                bun_core::ffi::zeroed::<uv::Pipe>(),
            )) as bun_spawn::windows::UvPipePtr),
            #[cfg(windows)]
            windows: bun_spawn::WindowsOptions {
                loop_: this.event_loop,
                ..Default::default()
            },
            stream: false,
            // The kernel kills the child when bun dies, so no git outlives the install.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            linux_pdeathsig: Some(bun_sys::SignalCode::SIGKILL.0),
            ..Default::default()
        };
        #[cfg(windows)]
        let mut spawn_options = spawn_options;

        let spawned =
            match bun_spawn::spawn_process_cstr(&spawn_options, &argv, SpawnEnv::Strings(&envp)) {
                Ok(Ok(spawned)) => spawned,
                res => {
                    #[cfg(windows)]
                    {
                        spawn_options.stdout.deinit();
                        spawn_options.stderr.deinit();
                    }
                    res??;
                    unreachable!();
                }
            };
        // `envp` borrows from `git_env`. The exit handler, which may run below, replaces `git_env`
        // after `Step::Config`.
        drop(envp);
        #[cfg(windows)]
        let mut spawned = spawned;

        // A reader that fails to start reports through `on_reader_error`, which only
        // touches `remaining_fds` / `read_error`, never the reader cell being borrowed.
        #[cfg(unix)]
        for (reader, fd, is_memfd) in [
            (&this.stdout, spawned.stdout, spawned.memfds[1]),
            (&this.stderr, spawned.stderr, spawned.memfds[2]),
        ] {
            let Some(fd) = fd else { continue };
            reader.with_mut(|r| r.set_parent(this_ptr));
            if is_memfd {
                reader.with_mut(|r| r.start_memfd(fd));
                continue;
            }
            let _ = bun_sys::set_nonblocking(fd);
            this.remaining_fds.set(this.remaining_fds.get() + 1);
            reader.with_mut(|r| {
                r.flags.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
                r.start(fd, true)
            })?;
            reader.with_mut(|r| {
                if let Some(poll) = r.handle.get_poll() {
                    poll.set_flag(FilePollFlag::Socket);
                }
            });
        }
        #[cfg(windows)]
        for (reader, pipe) in [
            (&this.stdout, spawned.stdout.take()),
            (&this.stderr, spawned.stderr.take()),
        ] {
            // Take sole ownership of each pipe before `spawned` drops.
            let bun_spawn::SpawnedStdio::Buffer(pipe) = pipe else {
                continue;
            };
            reader.with_mut(|r| {
                r.set_source(bun_io::Source::Pipe(pipe));
                r.set_parent(this_ptr);
            });
            this.remaining_fds.set(this.remaining_fds.get() + 1);
            reader.with_mut(|r| r.start_with_current_pipe())?;
        }

        debug_assert!(this.process.get().is_none());
        let process = spawned.to_process_handle(this.event_loop);
        process.set_exit_handler(this);
        // The exit handler may run inside `watch_or_reap` / `on_exit` and free
        // `this`; after those only the local handle is touched.
        match process.watch_or_reap() {
            Ok(false) => this.process.set(Some(process)),
            Ok(true) => {}
            Err(err) => {
                if !process.has_exited() {
                    process.on_exit(Status::Err(err), &bun_core::ffi::zeroed::<Rusage>());
                }
            }
        }
        Ok(())
    }

    /// The child has exited and both readers are done; ready for the next `spawn`.
    fn reset_polls(&self) {
        debug_assert!(self.remaining_fds.get() == 0);
        self.process.set(None);
        self.stdout.with_mut(|r| r.deinit());
        self.stderr.with_mut(|r| r.deinit());
        self.stdout.set(BufferedReader::init::<Self>());
        self.stderr.set(BufferedReader::init::<Self>());
    }

    /// May free `this`.
    fn on_process_exit(this: ThisPtr<Self>, _: &Process, status: Status, _: &Rusage) {
        this.exit_status.set(Some(status));
        Self::maybe_finished(this);
    }

    /// May free `this`.
    fn on_reader_done(this: ThisPtr<Self>) {
        debug_assert!(this.remaining_fds.get() > 0);
        this.remaining_fds.set(this.remaining_fds.get() - 1);
        Self::maybe_finished(this);
    }

    /// May free `this`.
    fn on_reader_error(this: ThisPtr<Self>, err: bun_sys::Error) {
        debug_assert!(this.remaining_fds.get() > 0);
        this.remaining_fds.set(this.remaining_fds.get() - 1);
        this.read_error.with_mut(|e| {
            e.get_or_insert(err);
        });
        Self::maybe_finished(this);
    }

    /// May free `this`.
    fn maybe_finished(this: ThisPtr<Self>) {
        if this.remaining_fds.get() != 0 {
            return;
        }
        let Some(status) = this.exit_status.take() else {
            return;
        };
        let stdout = this.stdout.with_mut(|r| core::mem::take(r.final_buffer()));
        let stderr = this.stderr.with_mut(|r| core::mem::take(r.final_buffer()));
        Self::on_command_exit(this, &status, &stdout, &stderr);
    }

    /// The child has exited and its output is collected. May free `this`.
    fn on_command_exit(this: ThisPtr<Self>, status: &Status, stdout: &[u8], stderr: &[u8]) {
        let ok = matches!(status, Status::Exited(exit) if exit.code == 0)
            && this.read_error.get().is_none();
        let step = this.step.replace(Step::Config);
        // "remote: Repository not found." / "fatal: repository '<url>' does not exist"
        let not_found = !ok
            && matches!(step, Step::Clone { .. })
            && ((strings::contains(stderr, b"remote:")
                && strings::contains(stderr, b"not")
                && strings::contains(stderr, b"found"))
                || strings::contains(stderr, b"does not exist"));
        // `git fetch` exits with 1 when another install updated a ref first. A second fetch finds
        // that ref already up to date, so it has nothing to write.
        let lost_a_ref = matches!(
            step,
            Step::Fetch {
                is_retry: false,
                ..
            }
        ) && matches!(status, Status::Exited(exit) if exit.code == 1);
        // `Fetch` and `Clone` report later, because they hold on to git's output until the last URL
        // has failed.
        if !ok && matches!(step, Step::Log | Step::ListTree(_) | Step::Checkout(_)) {
            this.report_failure(status, stderr);
        }
        let name = for_terminal(BStr::new(&this.name));
        match step {
            Step::Config => {
                // Exit code 1 means that neither setting is configured. Any other failure is
                // treated the same way.
                let configured: &[u8] = if ok { stdout } else { b"" };
                let env = GitEnv::new(Some(configured));
                this.manager().git_env.set(Some(env));
                this.reset_polls();
                if let Err(err) = Self::begin(this) {
                    Self::fail(this, err);
                }
            }
            Step::Fetch { repo, url, .. } => {
                if ok {
                    Self::finish_on_pool(this, Finalize::Repo(repo.into_raw()));
                    return;
                }
                this.reset_polls();
                if !lost_a_ref {
                    this.hold_output(stderr);
                }
                // git exits with 128 when it cannot reach the remote. Any other code, or an error
                // message that names the clone's own folder, means the cached clone is damaged.
                let is_damaged = matches!(status, Status::Exited(exit) if !matches!(exit.code, 0 | 128))
                    || strings::contains(stderr, &bare_repo_folder_name(this.task().id));
                let next = if lost_a_ref {
                    Self::spawn_fetch(this, repo, &url, true)
                } else if is_damaged {
                    drop(repo);
                    this.urls.with_mut(|urls| urls.push(url));
                    Self::spawn_clone(this, true)
                } else if !this.urls.get().is_empty() {
                    Self::fetch_next(this, repo)
                } else {
                    this.report_failure(status, &this.clone_output.take());
                    this.log_failure(format_args!("\"git fetch\" for \"{}\" failed", name));
                    Err(Error::InstallFailed)
                };
                if let Err(err) = next {
                    Self::fail(this, err);
                }
            }
            Step::Clone { url, replaces } => {
                if ok {
                    let staging = this.staging.take().expect("clone has a staging folder");
                    Self::finish_on_pool(this, Finalize::PublishRepo(staging, url, replaces));
                    return;
                }
                this.hold_output(stderr);
                if !this.urls.get().is_empty() {
                    // Try the next URL form (ssh after https), even after "not found": hosts also
                    // say that about a private repository that the login cannot access.
                    this.staging
                        .take()
                        .expect("clone has a staging folder")
                        .discard();
                    this.reset_polls();
                    if let Err(err) = Self::spawn_clone(this, replaces) {
                        Self::fail(this, err);
                    }
                } else {
                    this.report_failure(status, &this.clone_output.take());
                    this.log_failure(format_args!("\"git clone\" for \"{}\" failed", name));
                    Self::fail(
                        this,
                        if not_found {
                            Error::RepositoryNotFound
                        } else {
                            Error::InstallFailed
                        },
                    );
                }
            }
            Step::Log => {
                let commit = strings::trim(stdout, b" \t\r\n");
                // With `--ignore-missing`, git prints nothing and exits with 0 if no HEAD resolves.
                let result = if ok && !commit.is_empty() {
                    Ok(commit.to_vec())
                } else {
                    Err(Error::InstallFailed)
                };
                Self::finish_commit(this, result);
            }
            Step::ListTree(git_dir) => {
                if ok {
                    this.reset_polls();
                    if let Err(err) = Self::spawn_checkout(this, &git_dir, stdout.to_vec()) {
                        Self::fail(this, err);
                    }
                } else {
                    this.log_failure(format_args!("\"git ls-tree\" for \"{}\" failed", name));
                    Self::fail(this, Error::InstallFailed);
                }
            }
            Step::Checkout(tree) => {
                if ok {
                    let staging = this.staging.take().expect("checkout has a staging folder");
                    Self::finish_on_pool(this, Finalize::PublishCheckout(staging, tree));
                } else {
                    // An older git prints "git: 'restore' is not a git command."
                    if strings::contains(stderr, b"'restore'") {
                        bun_core::note!("git dependencies need git 2.24 or newer");
                    }
                    this.log_failure(format_args!("\"git restore\" for \"{}\" failed", name));
                    Self::fail(this, Error::InstallFailed);
                }
            }
        }
    }

    /// Mirrors git's stderr and termination kind, which name the cause.
    fn report_failure(&self, status: &Status, stderr: &[u8]) {
        let is_required = self.is_required();
        // `--silent` drops warnings.
        if !is_required && self.manager().options.log_level.is_silent() {
            return;
        }
        let cause = match (status, self.read_error.take()) {
            (_, Some(err)) => format!("reading the output of git failed: {err}"),
            (Status::Exited(exit), None) => format!("git failed with exit code {}", exit.code),
            (Status::Signaled(sig), None) => format!("git failed with signal {sig}"),
            (Status::Err(err), None) => format!("spawning git failed: {err}"),
            (Status::Running, None) => "git failed with unknown status".to_owned(),
        };
        if is_required {
            bun_core::err_generic!("{}", cause);
        } else {
            bun_core::warn!("{}", cause);
        }
        if !stderr.is_empty() {
            let ew = Output::error_writer();
            let _ = ew.print(format_args!(
                "{}",
                bun_core::fmt::EscapeControlCharsMultiline(bun_core::fmt::redacted(BStr::new(
                    stderr
                )))
            ));
            if stderr.last() != Some(&b'\n') {
                let _ = ew.write_all(b"\n");
            }
        }
        Output::flush();
    }

    /// Fails the task with `err`. Frees `this`.
    fn fail(this: ThisPtr<Self>, err: Error) {
        if this.tag == Tag::GitCommit {
            Self::finish_commit(this, Err(err));
        } else {
            let staging = this.staging.take();
            Self::finish_on_pool(this, Finalize::Failed { staging, err });
        }
    }

    /// Drops the owning ref: the process handle and readers are torn down on
    /// this (the event loop's) thread, and the git slot is free again.
    fn release(this: ThisPtr<Self>) {
        let owner = this.owner.take().expect("git runner finished twice");
        this.manager()
            .running_git_tasks
            .fetch_sub(1, Ordering::Relaxed);
        drop(owner);
    }

    /// Hands a clone or checkout task to the thread pool for `finalize`.
    /// `Task::callback` pushes the task onto `resolve_tasks`. Frees `this`.
    fn finish_on_pool(this: ThisPtr<Self>, finalize: Finalize) {
        debug_assert!(this.tag != Tag::GitCommit);
        let manager = this.manager;
        let task = this.task;
        this.task().git_finalize = Some(finalize);
        Self::release(this);
        // SAFETY: the task is idle until the pool runs it.
        let batch = ThreadPool::Batch::from(unsafe { &raw mut (*task.as_ptr()).threadpool_task });
        manager.thread_pool.schedule(batch);
    }

    /// Hands the finished commit lookup to `resolve_tasks`. Frees `this`.
    fn finish_commit(this: ThisPtr<Self>, result: Result<Vec<u8>, Error>) {
        debug_assert!(this.tag == Tag::GitCommit);
        let manager = this.manager;
        let task_ptr = this.task;
        {
            let task = this.task();
            // `deinit_payload` drops the active `data` arm, so every path writes one.
            let (status, err, sha) = match result {
                Ok(sha) => (Task::Status::Success, None, sha),
                Err(err) => (Task::Status::Fail, Some(err), Vec::new()),
            };
            task.status = status;
            task.err = err;
            task.data = Task::Data {
                git_commit: ManuallyDrop::new(sha),
            };
        }
        Self::release(this);
        manager.resolve_tasks.push(task_ptr);
        // SAFETY: the manager outlives every task; see `wake_raw`.
        unsafe { PackageManager::wake_raw(manager.as_ptr()) };
    }
}

impl Drop for GitSubprocess {
    fn drop(&mut self) {
        self.process.set(None);
        self.stdout.with_mut(|r| r.deinit());
        self.stderr.with_mut(|r| r.deinit());
        if let Some(staging) = self.staging.take() {
            staging.discard();
        }
    }
}

bun_spawn::link_impl_ProcessExit! {
    InstallGit for GitSubprocess => |this| {
        // SAFETY: `this` is the live runner installed via `set_exit_handler`.
        on_process_exit(process, status, rusage) =>
            GitSubprocess::on_process_exit(ThisPtr::new(this), &*process, status, rusage),
    }
}

bun_io::impl_buffered_reader_parent! {
    InstallGit for GitSubprocess;
    has_on_read_chunk = false;
    // SAFETY: `this` is the live runner registered via `set_parent`.
    on_reader_done  = |this| GitSubprocess::on_reader_done(ThisPtr::new(this));
    // SAFETY: `this` is the live runner registered via `set_parent`.
    on_reader_error = |this, err| GitSubprocess::on_reader_error(ThisPtr::new(this), err);
    loop_           = |this| (*this).event_loop.native_loop();
    event_loop      = |this| (*this).event_loop.as_event_loop_ctx();
}
