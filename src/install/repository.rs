use core::cell::UnsafeCell;
use core::cmp::Ordering;
use core::fmt;
use std::sync::Once;

use bstr::BStr;

use bun_alloc::AllocError;
use bun_core::{self, err, Error};
use bun_paths::{self as Path, PathBuffer};
use bun_semver::String;
use bun_semver::StringBuilder as StringBuilderLike;
use bun_semver::string::Buf as StringBuf;
use bun_str::strings;
#[allow(unused_imports)]
use bun_sys::{File, FdDirExt};

use crate::dependency as Dependency;
use crate::hosted_git_info;
use crate::install::{self as Install, ExtractData, PackageManager};

// TODO(port): bun.ThreadlocalBuffers — Zig returns a raw pointer into thread-local
// storage so callers can return slices that outlive the access. Rust thread_local!
// closures cannot express this without unsafe. Phase B should either (a) make
// try_ssh/try_https take an out-buffer, or (b) wrap in a type that hands out
// `&'static mut PathBuffer` via UnsafeCell with documented single-use invariant.
struct TlBufs {
    final_path_buf: PathBuffer,
    ssh_path_buf: PathBuffer,
    folder_name_buf: PathBuffer,
    json_path_buf: PathBuffer,
}

thread_local! {
    static TL_BUFS: UnsafeCell<TlBufs> = const { UnsafeCell::new(TlBufs {
        final_path_buf: PathBuffer::ZEROED,
        ssh_path_buf: PathBuffer::ZEROED,
        folder_name_buf: PathBuffer::ZEROED,
        json_path_buf: PathBuffer::ZEROED,
    }) };
}

fn tl_bufs() -> *mut TlBufs {
    // SAFETY (audited phase-d):
    // - `TL_BUFS` is thread-local `UnsafeCell<TlBufs>`: no cross-thread sharing, and
    //   `UnsafeCell::get()` is the sanctioned way to obtain `*mut` for interior mut.
    // - Zig's `bun.ThreadlocalBuffers(T).get()` returns `*T` (a freely-aliasing raw
    //   ptr), and `&tl_bufs.get().folder_name_buf` in Zig is raw-ptr field projection
    //   that never asserts uniqueness over sibling buffers. We mirror that exactly:
    //   this function returns `*mut TlBufs`, and call sites project a SINGLE field via
    //   raw-ptr place expr `unsafe { &mut (*tl_bufs()).<field> }` so only that one
    //   field is retagged Unique under Stacked Borrows.
    // - This is load-bearing: per the .zig spec callers (PackageManagerTask.zig:179,206),
    //   `try_https`/`try_ssh` return a slice into `final_path_buf`/`ssh_path_buf` which
    //   is then passed straight into `download(..., url, ...)`. `download` itself
    //   borrows `folder_name_buf`. Materializing `&mut TlBufs` over the WHOLE struct
    //   here would create a fresh Unique tag that invalidates the live `url` slice — UB.
    //   The invariant is therefore disjoint-FIELD access, not whole-struct uniqueness.
    // - The raw pointer is valid for the lifetime of the current thread (thread-local
    //   outlives all in-thread borrows; `TlBufs` has no `Drop`). Callers reborrow into
    //   `&'static mut PathBuffer` per field as a deliberate escape hatch so
    //   `try_ssh`/`try_https` can return slices into the buffer, mirroring the Zig API.
    //   Callers must not retain a slice into a given field across a subsequent reborrow
    //   of that SAME field.
    TL_BUFS.with(|b| b.get())
}

#[derive(Clone, Copy, Default)]
struct SloppyGlobalGitConfig {
    has_askpass: bool,
    has_ssh_command: bool,
}

static mut SLOPPY_HOLDER: SloppyGlobalGitConfig = SloppyGlobalGitConfig {
    has_askpass: false,
    has_ssh_command: false,
};
static LOAD_AND_PARSE_ONCE: Once = Once::new();

impl SloppyGlobalGitConfig {
    pub fn get() -> SloppyGlobalGitConfig {
        LOAD_AND_PARSE_ONCE.call_once(Self::load_and_parse);
        // SAFETY: written exactly once under `Once` above; read-only thereafter.
        unsafe { SLOPPY_HOLDER }
    }

    pub fn load_and_parse() {
        let Some(home_dir) = bun_core::env_var::HOME.get() else {
            return;
        };

        let mut config_file_path_buf = PathBuffer::uninit();
        let config_file_path = bun_paths::resolve_path::join_abs_string_buf_z::<
            bun_paths::platform::Auto,
        >(home_dir, &mut config_file_path_buf, &[b".gitconfig"]);
        // PERF(port): was stack-fallback alloc (4096) — profile in Phase B
        // MOVE_DOWN: `File::toSource` lives in `bun_logger` (T1→T2 cyclebreak).
        let Ok(source) = bun_logger::to_source(
            config_file_path,
            bun_logger::ToSourceOptions { convert_bom: true },
        ) else {
            return;
        };
        // `defer allocator.free(source.contents)` — handled by Drop on `source`.

        let mut remaining = strings::split(source.contents(), b"\n");
        let mut found_askpass = false;
        let mut found_ssh_command = false;
        let mut in_core = false; // Zig: `@"[core]"`
        while let Some(line_) = remaining.next() {
            if found_askpass && found_ssh_command {
                break;
            }

            let line = strings::trim(line_, b"\t \r");

            if line.is_empty() {
                continue;
            }
            // skip comments
            if line[0] == b'#' {
                continue;
            }

            if line[0] == b'[' {
                if let Some(end_bracket) = strings::index_of_char(line, b']') {
                    if &line[0..end_bracket as usize + 1] == b"[core]" {
                        in_core = true;
                        continue;
                    }
                }
                in_core = false;
                continue;
            }

            if in_core {
                if !found_askpass {
                    const K: &[u8] = b"askpass";
                    if line.len() > K.len()
                        && strings::eql_case_insensitive_ascii_ignore_length(&line[..K.len()], K)
                        && matches!(line[K.len()], b' ' | b'\t' | b'=')
                    {
                        found_askpass = true;
                        continue;
                    }
                }

                if !found_ssh_command {
                    const K: &[u8] = b"sshCommand";
                    if line.len() > K.len()
                        && strings::eql_case_insensitive_ascii_ignore_length(&line[..K.len()], K)
                        && matches!(line[K.len()], b' ' | b'\t' | b'=')
                    {
                        found_ssh_command = true;
                    }
                }
            } else {
                if !found_askpass {
                    const K: &[u8] = b"core.askpass";
                    if line.len() > K.len()
                        && strings::eql_case_insensitive_ascii_ignore_length(&line[..K.len()], K)
                        && matches!(line[K.len()], b' ' | b'\t' | b'=')
                    {
                        found_askpass = true;
                        continue;
                    }
                }

                if !found_ssh_command {
                    const K: &[u8] = b"core.sshCommand";
                    if line.len() > K.len()
                        && strings::eql_case_insensitive_ascii_ignore_length(&line[..K.len()], K)
                        && matches!(line[K.len()], b' ' | b'\t' | b'=')
                    {
                        found_ssh_command = true;
                    }
                }
            }
        }

        // SAFETY: only called once via `Once::call_once`.
        unsafe {
            SLOPPY_HOLDER = SloppyGlobalGitConfig {
                has_askpass: found_askpass,
                has_ssh_command: found_ssh_command,
            };
        }
    }
}

// MOVE_DOWN: data struct + Default + buffer-relative `order`/`count`/`clone`/
// `eql` now live in `bun_install_types::resolver_hooks` so the resolver and
// `Resolution.Value`/`Dependency.Version.Value` can name a real type. The
// install-tier behaviour below (parsing, formatting, git CLI, download/
// checkout) is provided as an extension trait so existing
// `repo.method(...)` / `Repository::method(...)` call sites keep resolving
// once `RepositoryExt` is in scope.
pub use bun_install_types::resolver_hooks::Repository;

pub struct SharedEnv {
    env: Option<bun_dotenv::Map>,
}

// PORT NOTE: Zig's `pub var shared_env` is a process-global anon-struct whose
// `get()` lazily clones `other.map` once and returns the `DotEnv.Map` handle by
// value (Zig struct copy — both copies alias the same backing storage). Rust's
// `Map` owns its storage and is not `Copy`, so we hand out a `&'static Map` into
// the global instead; callers (`GitCloneRequest.env`, `GitCheckoutRequest.env`)
// store the reference. The map is written exactly once on first call from the
// main install thread and never freed, matching Zig's lifetime.
pub static mut SHARED_ENV: SharedEnv = SharedEnv { env: None };

impl SharedEnv {
    pub fn get(other: &mut bun_dotenv::Loader) -> &'static bun_dotenv::Map {
        // SAFETY: `SHARED_ENV` is only initialised from the main install thread
        // during enqueue (single-threaded at that point in Zig too). Once
        // `env` is `Some` it is never reassigned, so the returned `&'static`
        // remains valid for the program lifetime.
        unsafe {
            let this = &mut *core::ptr::addr_of_mut!(SHARED_ENV);
            if this.env.is_none() {
                // Note: currently if the user sets this to some value that causes
                // a prompt for a password, the stdout of the prompt will be masked
                // by further output of the rest of the install process.
                // A value can still be entered, but we need to find a workaround
                // so the user can see what is being prompted. By default the settings
                // below will cause no prompt and throw instead.
                let mut cloned = bun_core::handle_oom(other.map.clone_with_allocator());

                if cloned.get(b"GIT_ASKPASS").is_none() {
                    let config = SloppyGlobalGitConfig::get();
                    if !config.has_askpass {
                        bun_core::handle_oom(cloned.put(b"GIT_ASKPASS", b"echo"));
                    }
                }

                if cloned.get(b"GIT_SSH_COMMAND").is_none() {
                    let config = SloppyGlobalGitConfig::get();
                    if !config.has_ssh_command {
                        bun_core::handle_oom(cloned.put(
                            b"GIT_SSH_COMMAND",
                            b"ssh -oStrictHostKeyChecking=accept-new",
                        ));
                    }
                }

                this.env = Some(cloned);
            }
            this.env.as_ref().unwrap()
        }
    }
}

pub static HOSTS: phf::Map<&'static [u8], &'static [u8]> = phf::phf_map! {
    b"bitbucket" => b".org",
    b"github" => b".com",
    b"gitlab" => b".com",
};

/// Install-tier `Repository` behaviour (parsing, formatting, git CLI exec,
/// download/checkout). Data struct + buffer-relative `order`/`count`/`clone`/
/// `eql` are inherent on [`Repository`] (defined in `bun_install_types`).
/// Re-exported from `bun_install::repository` so existing
/// `Repository::method(...)` / `repo.method(...)` call sites resolve via UFCS.
pub trait RepositoryExt: Sized {
    fn parse_append_git(input: &[u8], buf: &mut StringBuf<'_>) -> Result<Repository, AllocError>;
    fn parse_append_github(input: &[u8], buf: &mut StringBuf<'_>) -> Result<Repository, AllocError>;
    fn create_dependency_name_from_version_literal(
        repository: &Repository,
        lockfile: &mut Install::Lockfile,
        dep_id: Install::DependencyID,
    ) -> Vec<u8>;
    fn format_as(&self, label: &str, buf: &[u8], writer: &mut impl fmt::Write) -> fmt::Result;
    fn fmt_store_path<'a>(&'a self, label: &'a str, string_buf: &'a [u8]) -> StorePathFormatter<'a>;
    fn fmt<'a>(&'a self, label: &'a str, buf: &'a [u8]) -> Formatter<'a>;
    fn try_ssh(url: &[u8]) -> Option<&[u8]>;
    fn try_https(url: &[u8]) -> Option<&[u8]>;
    fn download(
        env: &bun_dotenv::Map,
        log: &mut bun_logger::Log,
        cache_dir: bun_sys::Dir,
        task_id: crate::package_manager_task::Id,
        name: &[u8],
        url: &[u8],
        attempt: u8,
    ) -> Result<bun_sys::Dir, Error>;
    fn find_commit(
        env: &mut bun_dotenv::Loader,
        log: &mut bun_logger::Log,
        repo_dir: bun_sys::Dir,
        name: &[u8],
        committish: &[u8],
        task_id: crate::package_manager_task::Id,
    ) -> Result<Vec<u8>, Error>;
    fn checkout(
        env: &bun_dotenv::Map,
        log: &mut bun_logger::Log,
        cache_dir: bun_sys::Dir,
        repo_dir: bun_sys::Dir,
        name: &[u8],
        url: &[u8],
        resolved: &[u8],
    ) -> Result<ExtractData, Error>;
}

fn exec(env: &bun_dotenv::Map, argv: &[&[u8]]) -> Result<Vec<u8>, Error> {
    Repository::__exec(env, argv)
}

impl RepositoryExt for Repository {
    fn parse_append_git(input: &[u8], buf: &mut StringBuf<'_>) -> Result<Repository, AllocError> {
        let mut remain = input;
        if remain.starts_with(b"git+") {
            remain = &remain[b"git+".len()..];
        }
        if let Some(hash) = strings::last_index_of_char(remain, b'#') {
            return Ok(Repository {
                repo: buf.append(&remain[..hash])?,
                committish: buf.append(&remain[hash + 1..])?,
                ..Default::default()
            });
        }
        Ok(Repository {
            repo: buf.append(remain)?,
            ..Default::default()
        })
    }

    pub fn parse_append_github(
        input: &[u8],
        buf: &mut StringBuf<'_>,
    ) -> Result<Repository, AllocError> {
        let mut remain = input;
        if remain.starts_with(b"github:") {
            remain = &remain[b"github:".len()..];
        }
        let mut hash: usize = 0;
        let mut slash: usize = 0;
        for (i, &c) in remain.iter().enumerate() {
            match c {
                b'/' => slash = i,
                b'#' => hash = i,
                _ => {}
            }
        }

        let repo = if hash == 0 {
            &remain[slash + 1..]
        } else {
            &remain[slash + 1..hash]
        };

        let mut result = Repository {
            owner: buf.append(&remain[..slash])?,
            repo: buf.append(repo)?,
            ..Default::default()
        };

        if hash != 0 {
            result.committish = buf.append(&remain[hash + 1..])?;
        }

        Ok(result)
    }

    pub fn create_dependency_name_from_version_literal(
        repository: &Repository,
        lockfile: &mut Install::Lockfile,
        dep_id: Install::DependencyID,
    ) -> Vec<u8> {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let dep = &lockfile.buffers.dependencies[dep_id as usize];
        let repo_name = repository.repo;
        let repo_name_str = lockfile.str(&repo_name);

        let name = 'brk: {
            let mut remain = repo_name_str;

            if let Some(hash_index) = strings::index_of_char(remain, b'#') {
                remain = &remain[..hash_index as usize];
            }

            if remain.is_empty() {
                break 'brk remain;
            }

            if let Some(slash_index) = strings::last_index_of_char(remain, b'/') {
                remain = &remain[slash_index + 1..];
            }

            remain
        };

        if name.is_empty() {
            let version_literal = dep.version.literal.slice(buf);
            let mut name_buf = [0u8; bun_sha::SHA1::DIGEST];
            let mut sha1 = bun_sha::SHA1::init();
            sha1.update(version_literal);
            sha1.r#final(&mut name_buf);
            return name_buf.to_vec();
        }

        name.to_vec()
    }

    pub fn order(&self, rhs: &Repository, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        let owner_order = self.owner.order(&rhs.owner, lhs_buf, rhs_buf);
        if owner_order != Ordering::Equal {
            return owner_order;
        }
        let repo_order = self.repo.order(&rhs.repo, lhs_buf, rhs_buf);
        if repo_order != Ordering::Equal {
            return repo_order;
        }

        self.committish.order(&rhs.committish, lhs_buf, rhs_buf)
    }

    // `comptime StringBuilder: type` → trait bound on `bun_semver::StringBuilder`
    // (lower-tier crate); body only calls `.count()` and `.append::<String>()`.
    pub fn count<B>(&self, buf: &[u8], builder: &mut B)
    where
        B: StringBuilderLike,
    {
        builder.count(self.owner.slice(buf));
        builder.count(self.repo.slice(buf));
        builder.count(self.committish.slice(buf));
        builder.count(self.resolved.slice(buf));
        builder.count(self.package_name.slice(buf));
    }

    pub fn clone<B>(&self, buf: &[u8], builder: &mut B) -> Repository
    where
        B: StringBuilderLike,
    {
        Repository {
            owner: builder.append::<String>(self.owner.slice(buf)),
            repo: builder.append::<String>(self.repo.slice(buf)),
            committish: builder.append::<String>(self.committish.slice(buf)),
            resolved: builder.append::<String>(self.resolved.slice(buf)),
            package_name: builder.append::<String>(self.package_name.slice(buf)),
        }
    }

    pub fn eql(&self, rhs: &Repository, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        if !self.owner.eql(rhs.owner, lhs_buf, rhs_buf) {
            return false;
        }
        if !self.repo.eql(rhs.repo, lhs_buf, rhs_buf) {
            return false;
        }
        if self.resolved.is_empty() || rhs.resolved.is_empty() {
            return self.committish.eql(rhs.committish, lhs_buf, rhs_buf);
        }
        self.resolved.eql(rhs.resolved, lhs_buf, rhs_buf)
    }

    pub fn format_as(
        &self,
        label: &str,
        buf: &[u8],
        writer: &mut impl fmt::Write,
    ) -> fmt::Result {
        let formatter = Formatter {
            label,
            repository: self,
            buf,
        };
        write!(writer, "{}", formatter)
    }

    pub fn fmt_store_path<'a>(
        &'a self,
        label: &'a str,
        string_buf: &'a [u8],
    ) -> StorePathFormatter<'a> {
        StorePathFormatter {
            repo: self,
            label,
            string_buf,
        }
    }

    pub fn fmt<'a>(&'a self, label: &'a str, buf: &'a [u8]) -> Formatter<'a> {
        Formatter {
            repository: self,
            buf,
            label,
        }
    }

    fn exec(env: &bun_dotenv::Map, argv: &[&[u8]]) -> Result<Vec<u8>, Error> {
        // PORT NOTE: Zig passed `DotEnv.Map` by struct-copy (shallow). Rust's
        // `Map` is move-only; clone via `clone_with_allocator` so callers can
        // hand us a shared `&Map` (matches `PackageManagerTask` call sites).
        let mut env = bun_core::handle_oom(env.clone_with_allocator());
        let std_map = env.std_env_map()?;
        // TODO(port): narrow error set

        // TODO(port): std::process is banned — replace with bun_spawn::spawn_sync.
        // Zig used std.process.Child.run on both Windows and POSIX (identical arms).
        let result = bun_spawn::run(bun_spawn::RunOptions {
            argv,
            env_map: std_map.get(),
        })?;

        match result.term {
            bun_spawn::Term::Exited(sig) => {
                if sig == 0 {
                    return Ok(result.stdout);
                } else if
                // remote: The page could not be found <-- for non git
                // remote: Repository not found. <-- for git
                // remote: fatal repository '<url>' does not exist <-- for git
                (strings::contains(&result.stderr, b"remote:")
                    && strings::contains(&result.stderr, b"not")
                    && strings::contains(&result.stderr, b"found"))
                    || strings::contains(&result.stderr, b"does not exist")
                {
                    return Err(err!("RepositoryNotFound"));
                }
            }
            _ => {}
        }

        Err(err!("InstallFailed"))
    }

    pub fn try_ssh(url: &[u8]) -> Option<&[u8]> {
        // TODO(port): lifetime — returns slice into thread-local buffer; see tl_bufs().
        // SAFETY: raw-ptr field projection — retags only `ssh_path_buf`. See tl_bufs().
        let ssh_path_buf = unsafe { &mut (*tl_bufs()).ssh_path_buf };
        // Do not cast explicit http(s) URLs to SSH
        if url.starts_with(b"http") {
            return None;
        }

        if url.starts_with(b"git@") {
            return Some(url);
        }

        if url.starts_with(b"ssh://") {
            // TODO(markovejnovic): This is a stop-gap. One of the problems with the implementation
            // here is that we should integrate hosted_git_info more thoroughly into the codebase
            // to avoid the allocation and copy here. For now, the thread-local buffer is a good
            // enough solution to avoid having to handle init/deinit.

            // Fix malformed ssh:// URLs with colons using hosted_git_info.correctUrl
            // ssh://git@github.com:user/repo -> ssh://git@github.com/user/repo
            let pair = hosted_git_info::UrlProtocolPair {
                url: hosted_git_info::UrlProtocolPairUrl::Unmanaged(url),
                protocol: hosted_git_info::UrlProtocol::WellFormed(
                    hosted_git_info::WellDefinedProtocol::GitPlusSsh,
                ),
            };

            let Ok(corrected) = hosted_git_info::correct_url(&pair) else {
                return Some(url); // If correction fails, return original
            };

            // Copy corrected URL to thread-local buffer
            let corrected_str = corrected.url_slice();
            let result = &mut ssh_path_buf[..corrected_str.len()];
            result.copy_from_slice(corrected_str);
            return Some(&ssh_path_buf[..corrected_str.len()]);
        }

        if Dependency::is_scp_like_path(url) {
            const PREFIX: &[u8] = b"ssh://git@";
            ssh_path_buf[..PREFIX.len()].copy_from_slice(PREFIX);
            let rest = &mut ssh_path_buf[PREFIX.len()..];

            let colon_index = strings::index_of_char(url, b':');

            if let Some(colon) = colon_index {
                let colon = colon as usize;
                // make sure known hosts have `.com` or `.org`
                if let Some(tld) = HOSTS.get(&url[..colon]) {
                    rest[..colon].copy_from_slice(&url[..colon]);
                    rest[colon..colon + tld.len()].copy_from_slice(tld);
                    rest[colon + tld.len()] = b'/';
                    rest[colon + tld.len() + 1..colon + tld.len() + 1 + (url.len() - colon - 1)]
                        .copy_from_slice(&url[colon + 1..]);
                    let out = &ssh_path_buf[..url.len() + PREFIX.len() + tld.len()];
                    return Some(out);
                }
            }

            rest[..url.len()].copy_from_slice(url);
            if let Some(colon) = colon_index {
                rest[colon as usize] = b'/';
            }
            let final_ = &ssh_path_buf[..url.len() + b"ssh://".len()];
            return Some(final_);
        }

        None
    }

    pub fn try_https(url: &[u8]) -> Option<&[u8]> {
        // TODO(port): lifetime — returns slice into thread-local buffer; see tl_bufs().
        // SAFETY: raw-ptr field projection — retags only `final_path_buf`. See tl_bufs().
        let final_path_buf = unsafe { &mut (*tl_bufs()).final_path_buf };
        if url.starts_with(b"http") {
            return Some(url);
        }

        if url.starts_with(b"ssh://") {
            final_path_buf[..b"https".len()].copy_from_slice(b"https");
            let tail = &url[b"ssh".len()..];
            final_path_buf[b"https".len()..b"https".len() + tail.len()].copy_from_slice(tail);
            let out = &final_path_buf[..url.len() - b"ssh".len() + b"https".len()];
            return Some(out);
        }

        if Dependency::is_scp_like_path(url) {
            const PREFIX: &[u8] = b"https://";
            final_path_buf[..PREFIX.len()].copy_from_slice(PREFIX);
            let rest = &mut final_path_buf[PREFIX.len()..];

            let colon_index = strings::index_of_char(url, b':');

            if let Some(colon) = colon_index {
                let colon = colon as usize;
                // make sure known hosts have `.com` or `.org`
                if let Some(tld) = HOSTS.get(&url[..colon]) {
                    rest[..colon].copy_from_slice(&url[..colon]);
                    rest[colon..colon + tld.len()].copy_from_slice(tld);
                    rest[colon + tld.len()] = b'/';
                    rest[colon + tld.len() + 1..colon + tld.len() + 1 + (url.len() - colon - 1)]
                        .copy_from_slice(&url[colon + 1..]);
                    let out = &final_path_buf[..url.len() + PREFIX.len() + tld.len()];
                    return Some(out);
                }
            }

            rest[..url.len()].copy_from_slice(url);
            if let Some(colon) = colon_index {
                rest[colon as usize] = b'/';
            }
            return Some(&final_path_buf[..url.len() + PREFIX.len()]);
        }

        None
    }

    pub fn download(
        env: &bun_dotenv::Map,
        log: &mut bun_logger::Log,
        cache_dir: bun_sys::Dir,
        task_id: crate::package_manager_task::Id,
        name: &[u8],
        url: &[u8],
        attempt: u8,
    ) -> Result<bun_sys::Dir, Error> {
        // TODO(port): std::fs::Dir is banned — using bun_sys::Dir placeholder; verify API in Phase B.
        bun_analytics::features::git_dependencies.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        // SAFETY: raw-ptr field projection — retags only `folder_name_buf`, leaving any
        // live shared borrow of `final_path_buf`/`ssh_path_buf` (the `url` argument, per
        // PackageManagerTask.zig:179,206) valid under Stacked Borrows. See tl_bufs().
        let folder_name_buf = unsafe { &mut (*tl_bufs()).folder_name_buf };
        let folder_name = {
            use std::io::Write;
            let total = folder_name_buf.len();
            let mut cursor = &mut folder_name_buf[..];
            write!(
                &mut cursor,
                "{}.git\0",
                bun_core::fmt::hex_int_lower::<16>(task_id.get())
            )
            .map_err(|_| err!("NoSpaceLeft"))?;
            // TODO(port): narrow error set
            let written = total - cursor.len() - 1;
            // SAFETY: NUL written at folder_name_buf[written] above.
            unsafe { bun_str::ZStr::from_raw(folder_name_buf.as_ptr(), written) }
        };

        match cache_dir.open_dir_z(folder_name) {
            Ok(dir) => {
                let path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                    &PackageManager::get().cache_directory_path,
                    &[folder_name.as_bytes()],
                );

                if let Err(err) = Self::exec(
                    env,
                    &[b"git", b"-C", path, b"fetch", b"--quiet"],
                ) {
                    log.add_error_fmt(
                        None,
                        bun_logger::Loc::EMPTY,
                        format_args!("\"git fetch\" for \"{}\" failed", BStr::new(name)),
                    )
                    .expect("unreachable");
                    return Err(err);
                }
                Ok(dir)
            }
            Err(not_found) => {
                if not_found != err!("FileNotFound") {
                    return Err(not_found);
                }

                let target = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                    &PackageManager::get().cache_directory_path,
                    &[folder_name.as_bytes()],
                );

                if let Err(err) = Self::exec(
                    env,
                    &[
                        b"git",
                        b"clone",
                        b"-c",
                        b"core.longpaths=true",
                        b"--quiet",
                        b"--bare",
                        url,
                        target,
                    ],
                ) {
                    if err == err!("RepositoryNotFound") || attempt > 1 {
                        log.add_error_fmt(
                            None,
                            bun_logger::Loc::EMPTY,
                            format_args!("\"git clone\" for \"{}\" failed", BStr::new(name)),
                        )
                        .expect("unreachable");
                    }
                    return Err(err);
                }

                cache_dir.open_dir_z(folder_name)
            }
        }
    }

    pub fn find_commit(
        env: &mut bun_dotenv::Loader,
        log: &mut bun_logger::Log,
        repo_dir: bun_sys::Dir,
        name: &[u8],
        committish: &[u8],
        task_id: crate::package_manager_task::Id,
    ) -> Result<Vec<u8>, Error> {
        // SAFETY: raw-ptr field projection — retags only `folder_name_buf`. See tl_bufs().
        let folder_name_buf = unsafe { &mut (*tl_bufs()).folder_name_buf };
        let folder_name = {
            use std::io::Write;
            let total = folder_name_buf.len();
            let mut cursor = &mut folder_name_buf[..];
            write!(
                &mut cursor,
                "{}.git",
                bun_core::fmt::hex_int_lower::<16>(task_id.get())
            )
            .map_err(|_| err!("NoSpaceLeft"))?;
            // TODO(port): narrow error set
            let written = total - cursor.len();
            &folder_name_buf[..written]
        };
        let path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
            &PackageManager::get().cache_directory_path,
            &[folder_name],
        );

        let _ = repo_dir;

        let shared = SharedEnv::get(env);

        let argv_with: [&[u8]; 7] =
            [b"git", b"-C", path, b"log", b"--format=%H", b"-1", committish];
        let argv_without: [&[u8]; 6] = [b"git", b"-C", path, b"log", b"--format=%H", b"-1"];
        let argv: &[&[u8]] = if !committish.is_empty() {
            &argv_with
        } else {
            &argv_without
        };

        let out = match Self::exec(shared, argv) {
            Ok(v) => v,
            Err(err) => {
                log.add_error_fmt(
                    None,
                    bun_logger::Loc::EMPTY,
                    format_args!(
                        "no commit matching \"{}\" found for \"{}\" (but repository exists)",
                        BStr::new(committish),
                        BStr::new(name)
                    ),
                )
                .expect("unreachable");
                return Err(err);
            }
        };

        Ok(strings::trim(&out, b" \t\r\n").to_vec())
        // TODO(port): Zig returned a slice into `exec`'s allocation without trimming
        // in-place; here we own `out` and copy the trimmed slice. Revisit ownership.
    }

    pub fn checkout(
        env: &bun_dotenv::Map,
        log: &mut bun_logger::Log,
        cache_dir: bun_sys::Dir,
        repo_dir: bun_sys::Dir,
        name: &[u8],
        url: &[u8],
        resolved: &[u8],
    ) -> Result<ExtractData, Error> {
        // TODO(port): std::fs::Dir is banned — using bun_sys::Dir placeholder; verify API in Phase B.
        bun_analytics::features::git_dependencies.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let bufs = tl_bufs();
        // SAFETY: raw-ptr field projection — retags only `folder_name_buf`. See tl_bufs().
        let folder_name_buf = unsafe { &mut (*bufs).folder_name_buf };
        let folder_name = crate::package_manager_real::cached_git_folder_name_print(
            &mut folder_name_buf[..],
            resolved,
            None,
        )
        .as_bytes();

        let mut package_dir = match bun_sys::open_dir(cache_dir, folder_name) {
            Ok(d) => d,
            Err(not_found) => 'brk: {
                if not_found != err!("ENOENT") {
                    return Err(not_found);
                }

                let target = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                    &PackageManager::get().cache_directory_path,
                    &[folder_name],
                );

                let repo_path = bun_sys::get_fd_path(
                    bun_sys::Fd::from_std_dir(&repo_dir),
                    // SAFETY: raw-ptr field projection — disjoint from `folder_name_buf`
                    // borrow above. See tl_bufs().
                    unsafe { &mut (*bufs).final_path_buf },
                )?;

                if let Err(err) = Self::exec(
                    env,
                    &[
                        b"git",
                        b"clone",
                        b"-c",
                        b"core.longpaths=true",
                        b"--quiet",
                        b"--no-checkout",
                        repo_path,
                        target,
                    ],
                ) {
                    log.add_error_fmt(
                        None,
                        bun_logger::Loc::EMPTY,
                        format_args!("\"git clone\" for \"{}\" failed", BStr::new(name)),
                    )
                    .expect("unreachable");
                    return Err(err);
                }

                let folder = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                    &PackageManager::get().cache_directory_path,
                    &[folder_name],
                );

                if let Err(err) = Self::exec(
                    env,
                    &[b"git", b"-C", folder, b"checkout", b"--quiet", resolved],
                ) {
                    log.add_error_fmt(
                        None,
                        bun_logger::Loc::EMPTY,
                        format_args!("\"git checkout\" for \"{}\" failed", BStr::new(name)),
                    )
                    .expect("unreachable");
                    return Err(err);
                }
                let dir = bun_sys::open_dir(cache_dir, folder_name)?;
                let _ = dir.delete_tree(b".git");

                if !resolved.is_empty() {
                    'insert_tag: {
                        let Ok(git_tag) = dir.create_file_z(
                            bun_core::zstr!(".bun-tag"),
                            bun_sys::CreateFlags { truncate: true, ..Default::default() },
                        ) else {
                            break 'insert_tag;
                        };
                        if git_tag.write_all(resolved).is_err() {
                            let _ = dir.delete_file_z(bun_core::zstr!(".bun-tag"));
                        }
                        git_tag.close();
                    }
                }

                break 'brk dir;
            }
        };
        // `defer package_dir.close()` — TODO(port): bun_sys::Dir should impl Drop or
        // expose RAII close; for now closed explicitly below on all paths.

        let (json_file, json_buf) =
            match bun_sys::File::read_file_from(package_dir.fd(), b"package.json") {
                Ok(v) => v,
                Err(err) => {
                    if err == err!("ENOENT") {
                        // allow git dependencies without package.json
                        package_dir.close();
                        return Ok(ExtractData {
                            url: url.into(),
                            resolved: resolved.into(),
                            ..Default::default()
                        });
                    }

                    log.add_error_fmt(
                        None,
                        bun_logger::Loc::EMPTY,
                        format_args!(
                            "\"package.json\" for \"{}\" failed to open: {}",
                            BStr::new(name),
                            err.name()
                        ),
                    )
                    .expect("unreachable");
                    package_dir.close();
                    return Err(err!("InstallFailed"));
                }
            };

        // SAFETY: raw-ptr field projection — retags only `json_path_buf`. See tl_bufs().
        let json_path = match json_file.get_path(unsafe { &mut (*bufs).json_path_buf }) {
            Ok(p) => p,
            Err(err) => {
                log.add_error_fmt(
                    None,
                    bun_logger::Loc::EMPTY,
                    format_args!(
                        "\"package.json\" for \"{}\" failed to resolve: {}",
                        BStr::new(name),
                        err.name()
                    ),
                )
                .expect("unreachable");
                json_file.close();
                package_dir.close();
                return Err(err!("InstallFailed"));
            }
        };

        // Zig defers `json_file.close()` / `package_dir.close()` across the
        // `try ...append(json_path)` below. `json_path` lives in the thread-local
        // `json_path_buf` (not in `json_file`), and `json_buf` is an owned alloc,
        // so both fds are dead here — close before the fallible append so the
        // `?`-propagation path doesn't leak them.
        json_file.close();
        package_dir.close();

        // MOVE_DOWN(b0): bun_resolver::fs → bun_sys::fs
        let ret_json_path = bun_sys::fs::FileSystem::instance()
            .dirname_store()
            .append(json_path)?;

        Ok(ExtractData {
            url: url.into(),
            resolved: resolved.into(),
            json: Some(Install::ExtractDataJson {
                path: ret_json_path.into(),
                buf: json_buf,
            }),
            ..Default::default()
        })
    }
}

pub struct StorePathFormatter<'a> {
    repo: &'a Repository,
    label: &'a str,
    string_buf: &'a [u8],
}

impl<'a> fmt::Display for StorePathFormatter<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(writer, "{}", Install::fmt_store_path(self.label.as_bytes()))?;

        if !self.repo.owner.is_empty() {
            write!(
                writer,
                "{}",
                self.repo.owner.fmt_store_path(self.string_buf)
            )?;
            // try writer.writeByte(if (this.opts.replace_slashes) '+' else '/');
            writer.write_str("+")?;
        } else if Dependency::is_scp_like_path(self.repo.repo.slice(self.string_buf)) {
            // try writer.print("ssh:{s}", .{if (this.opts.replace_slashes) "++" else "//"});
            writer.write_str("ssh++")?;
        }

        write!(writer, "{}", self.repo.repo.fmt_store_path(self.string_buf))?;

        if !self.repo.resolved.is_empty() {
            writer.write_str("+")?; // this would be '#' but it's not valid on windows
            let mut resolved = self.repo.resolved.slice(self.string_buf);
            if let Some(i) = strings::last_index_of_char(resolved, b'-') {
                resolved = &resolved[i + 1..];
            }
            write!(writer, "{}", Install::fmt_store_path(resolved))?;
        } else if !self.repo.committish.is_empty() {
            writer.write_str("+")?; // this would be '#' but it's not valid on windows
            write!(
                writer,
                "{}",
                self.repo.committish.fmt_store_path(self.string_buf)
            )?;
        }
        Ok(())
    }
}

pub struct Formatter<'a> {
    label: &'a str,
    buf: &'a [u8],
    repository: &'a Repository,
}

impl<'a> fmt::Display for Formatter<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        #[cfg(debug_assertions)]
        debug_assert!(!self.label.is_empty());
        writer.write_str(self.label)?;

        let repo = self.repository.repo.slice(self.buf);
        if !self.repository.owner.is_empty() {
            write!(
                writer,
                "{}",
                BStr::new(self.repository.owner.slice(self.buf))
            )?;
            writer.write_str("/")?;
        } else if Dependency::is_scp_like_path(repo) {
            writer.write_str("ssh://")?;
        }
        write!(writer, "{}", BStr::new(repo))?;

        if !self.repository.resolved.is_empty() {
            writer.write_str("#")?;
            let mut resolved = self.repository.resolved.slice(self.buf);
            if let Some(i) = strings::last_index_of_char(resolved, b'-') {
                resolved = &resolved[i + 1..];
            }
            write!(writer, "{}", BStr::new(resolved))?;
        } else if !self.repository.committish.is_empty() {
            writer.write_str("#")?;
            write!(
                writer,
                "{}",
                BStr::new(self.repository.committish.slice(self.buf))
            )?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/repository.zig (726 lines)
//   confidence: medium
//   todos:      14
//   notes:      thread-local buffer slices + std::process/std::fs usage need Phase B reshape; SHARED_ENV mutable static needs sync wrapper
// ──────────────────────────────────────────────────────────────────────────
