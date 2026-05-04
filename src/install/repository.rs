use core::cell::UnsafeCell;
use core::cmp::Ordering;
use core::fmt;
use std::sync::Once;

use bstr::BStr;

use bun_alloc::AllocError;
use bun_core::{self, err, Error};
use bun_paths::{self as Path, PathBuffer};
use bun_semver::String;
use bun_str::strings;
use bun_sys::File;

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

fn tl_bufs() -> &'static mut TlBufs {
    // SAFETY: single-threaded per-thread access; callers never hold two &mut to the
    // same buffer at once (matches Zig `tl_bufs.get()` semantics).
    // TODO(port): lifetime — returning &'static mut from thread_local! is unsound if
    // re-entered; reshape in Phase B.
    TL_BUFS.with(|b| unsafe { &mut *b.get() })
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
        let config_file_path = bun_paths::join_abs_string_buf_z(
            home_dir,
            &mut config_file_path_buf,
            &[b".gitconfig"],
            bun_paths::Style::Auto,
        );
        // PERF(port): was stack-fallback alloc (4096) — profile in Phase B
        let Ok(source) = File::to_source(
            config_file_path,
            bun_sys::ToSourceOptions { convert_bom: true },
        )
        .unwrap()
        else {
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

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Repository {
    pub owner: String,
    pub repo: String,
    pub committish: String,
    pub resolved: String,
    pub package_name: String,
}

impl Default for Repository {
    fn default() -> Self {
        Self {
            owner: String::default(),
            repo: String::default(),
            committish: String::default(),
            resolved: String::default(),
            package_name: String::default(),
        }
    }
}

pub struct SharedEnv {
    env: Option<bun_dotenv::Map>,
}

impl SharedEnv {
    pub fn get(&mut self, other: &mut bun_dotenv::Loader) -> bun_dotenv::Map {
        if let Some(env) = &self.env {
            return env.clone();
        }
        // Note: currently if the user sets this to some value that causes
        // a prompt for a password, the stdout of the prompt will be masked
        // by further output of the rest of the install process.
        // A value can still be entered, but we need to find a workaround
        // so the user can see what is being prompted. By default the settings
        // below will cause no prompt and throw instead.
        let mut cloned = other.map.clone();

        if cloned.get(b"GIT_ASKPASS").is_none() {
            let config = SloppyGlobalGitConfig::get();
            if !config.has_askpass {
                cloned.put(b"GIT_ASKPASS", b"echo");
            }
        }

        if cloned.get(b"GIT_SSH_COMMAND").is_none() {
            let config = SloppyGlobalGitConfig::get();
            if !config.has_ssh_command {
                cloned.put(
                    b"GIT_SSH_COMMAND",
                    b"ssh -oStrictHostKeyChecking=accept-new",
                );
            }
        }

        self.env = Some(cloned);
        self.env.clone().unwrap()
    }
}

// TODO(port): `pub var shared_env` mutable static — wrap in OnceLock or thread-local
// in Phase B; Zig mutates `.env` in place across calls.
pub static mut SHARED_ENV: SharedEnv = SharedEnv { env: None };

pub static HOSTS: phf::Map<&'static [u8], &'static [u8]> = phf::phf_map! {
    b"bitbucket" => b".org",
    b"github" => b".com",
    b"gitlab" => b".com",
};

impl Repository {
    pub fn parse_append_git(input: &[u8], buf: &mut String::Buf) -> Result<Repository, AllocError> {
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
        buf: &mut String::Buf,
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
            let mut name_buf = vec![0u8; bun_sha::evp::SHA1::DIGEST];
            let mut sha1 = bun_sha::SHA1::init();
            sha1.update(version_literal);
            sha1.finalize(&mut name_buf[..bun_sha::SHA1::DIGEST]);
            return name_buf;
        }

        name.to_vec()
    }

    pub fn order(
        lhs: &Repository,
        rhs: &Repository,
        lhs_buf: &[u8],
        rhs_buf: &[u8],
    ) -> Ordering {
        let owner_order = lhs.owner.order(&rhs.owner, lhs_buf, rhs_buf);
        if owner_order != Ordering::Equal {
            return owner_order;
        }
        let repo_order = lhs.repo.order(&rhs.repo, lhs_buf, rhs_buf);
        if repo_order != Ordering::Equal {
            return repo_order;
        }

        lhs.committish.order(&rhs.committish, lhs_buf, rhs_buf)
    }

    // TODO(port): `comptime StringBuilder: type` — define a `StringBuilder` trait
    // with `count(&[u8])` and `append<T>(&[u8]) -> T` in bun_install and bound here.
    pub fn count<B>(&self, buf: &[u8], builder: &mut B)
    where
        B: Install::StringBuilderLike,
    {
        builder.count(self.owner.slice(buf));
        builder.count(self.repo.slice(buf));
        builder.count(self.committish.slice(buf));
        builder.count(self.resolved.slice(buf));
        builder.count(self.package_name.slice(buf));
    }

    pub fn clone<B>(&self, buf: &[u8], builder: &mut B) -> Repository
    where
        B: Install::StringBuilderLike,
    {
        Repository {
            owner: builder.append::<String>(self.owner.slice(buf)),
            repo: builder.append::<String>(self.repo.slice(buf)),
            committish: builder.append::<String>(self.committish.slice(buf)),
            resolved: builder.append::<String>(self.resolved.slice(buf)),
            package_name: builder.append::<String>(self.package_name.slice(buf)),
        }
    }

    pub fn eql(lhs: &Repository, rhs: &Repository, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        if !lhs.owner.eql(rhs.owner, lhs_buf, rhs_buf) {
            return false;
        }
        if !lhs.repo.eql(rhs.repo, lhs_buf, rhs_buf) {
            return false;
        }
        if lhs.resolved.is_empty() || rhs.resolved.is_empty() {
            return lhs.committish.eql(rhs.committish, lhs_buf, rhs_buf);
        }
        lhs.resolved.eql(rhs.resolved, lhs_buf, rhs_buf)
    }

    pub fn format_as(
        &self,
        label: &[u8],
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
        label: &'a [u8],
        string_buf: &'a [u8],
    ) -> StorePathFormatter<'a> {
        StorePathFormatter {
            repo: self,
            label,
            string_buf,
        }
    }

    pub fn fmt<'a>(&'a self, label: &'a [u8], buf: &'a [u8]) -> Formatter<'a> {
        Formatter {
            repository: self,
            buf,
            label,
        }
    }

    fn exec(_env: bun_dotenv::Map, argv: &[&[u8]]) -> Result<Vec<u8>, Error> {
        let mut env = _env;
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
        let ssh_path_buf = &mut tl_bufs().ssh_path_buf;
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
            let mut pair = hosted_git_info::UrlProtocolPair {
                url: hosted_git_info::Url::Unmanaged(url),
                protocol: hosted_git_info::Protocol::WellFormed(
                    hosted_git_info::WellFormedProtocol::GitPlusSsh,
                ),
            };

            let Ok(corrected) = hosted_git_info::correct_url(&mut pair) else {
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
        let final_path_buf = &mut tl_bufs().final_path_buf;
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
        env: bun_dotenv::Map,
        log: &mut bun_logger::Log,
        cache_dir: bun_sys::Dir,
        task_id: Install::task::Id,
        name: &[u8],
        url: &[u8],
        attempt: u8,
    ) -> Result<bun_sys::Dir, Error> {
        // TODO(port): std::fs::Dir is banned — using bun_sys::Dir placeholder; verify API in Phase B.
        bun_analytics::Features::git_dependencies_inc();
        let folder_name_buf = &mut tl_bufs().folder_name_buf;
        let folder_name = {
            use std::io::Write;
            let mut cursor = &mut folder_name_buf[..];
            write!(
                &mut cursor,
                "{}.git\0",
                bun_core::fmt::hex_int_lower(task_id.get())
            )
            .map_err(|_| err!("NoSpaceLeft"))?;
            // TODO(port): narrow error set
            let written = folder_name_buf.len() - cursor.len() - 1;
            // SAFETY: NUL written at folder_name_buf[written] above.
            unsafe { bun_str::ZStr::from_raw(folder_name_buf.as_ptr(), written) }
        };

        match cache_dir.open_dir_z(folder_name) {
            Ok(dir) => {
                let path = Path::join_abs_string(
                    PackageManager::get().cache_directory_path,
                    &[folder_name.as_bytes()],
                    Path::Style::Auto,
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

                let target = Path::join_abs_string(
                    PackageManager::get().cache_directory_path,
                    &[folder_name.as_bytes()],
                    Path::Style::Auto,
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
        task_id: Install::task::Id,
    ) -> Result<Vec<u8>, Error> {
        let folder_name_buf = &mut tl_bufs().folder_name_buf;
        let folder_name = {
            use std::io::Write;
            let mut cursor = &mut folder_name_buf[..];
            write!(
                &mut cursor,
                "{}.git",
                bun_core::fmt::hex_int_lower(task_id.get())
            )
            .map_err(|_| err!("NoSpaceLeft"))?;
            // TODO(port): narrow error set
            let written = folder_name_buf.len() - cursor.len();
            &folder_name_buf[..written]
        };
        let path = Path::join_abs_string(
            PackageManager::get().cache_directory_path,
            &[folder_name],
            Path::Style::Auto,
        );

        let _ = repo_dir;

        // SAFETY: see SHARED_ENV TODO above.
        let shared = unsafe { SHARED_ENV.get(env) };

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
        env: bun_dotenv::Map,
        log: &mut bun_logger::Log,
        cache_dir: bun_sys::Dir,
        repo_dir: bun_sys::Dir,
        name: &[u8],
        url: &[u8],
        resolved: &[u8],
    ) -> Result<ExtractData, Error> {
        // TODO(port): std::fs::Dir is banned — using bun_sys::Dir placeholder; verify API in Phase B.
        bun_analytics::Features::git_dependencies_inc();
        let bufs = tl_bufs();
        let folder_name =
            PackageManager::cached_git_folder_name_print(&mut bufs.folder_name_buf, resolved, None);

        let mut package_dir = match bun_sys::open_dir(cache_dir, folder_name) {
            Ok(d) => d,
            Err(not_found) => 'brk: {
                if not_found != err!("ENOENT") {
                    return Err(not_found);
                }

                let target = Path::join_abs_string(
                    PackageManager::get().cache_directory_path,
                    &[folder_name],
                    Path::Style::Auto,
                );

                let repo_path = bun_sys::get_fd_path(
                    bun_sys::Fd::from_std_dir(repo_dir),
                    &mut bufs.final_path_buf,
                )?;

                if let Err(err) = Self::exec(
                    env.clone(),
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

                let folder = Path::join_abs_string(
                    PackageManager::get().cache_directory_path,
                    &[folder_name],
                    Path::Style::Auto,
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
                            b".bun-tag\0",
                            bun_sys::CreateFlags { truncate: true },
                        ) else {
                            break 'insert_tag;
                        };
                        if git_tag.write_all(resolved).is_err() {
                            let _ = dir.delete_file_z(b".bun-tag\0");
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
            match bun_sys::File::read_file_from(package_dir, b"package.json").unwrap() {
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

        let json_path = match json_file.get_path(&mut bufs.json_path_buf).unwrap() {
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

        let ret_json_path = bun_resolver::fs::FileSystem::instance()
            .dirname_store
            .append(json_path)?;

        json_file.close();
        package_dir.close();

        Ok(ExtractData {
            url: url.into(),
            resolved: resolved.into(),
            json: Some(Install::ExtractDataJson {
                path: ret_json_path,
                buf: json_buf,
            }),
        })
    }
}

pub struct StorePathFormatter<'a> {
    repo: &'a Repository,
    label: &'a [u8],
    string_buf: &'a [u8],
}

impl<'a> fmt::Display for StorePathFormatter<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(writer, "{}", Install::fmt_store_path(self.label))?;

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
    label: &'a [u8],
    buf: &'a [u8],
    repository: &'a Repository,
}

impl<'a> fmt::Display for Formatter<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        #[cfg(debug_assertions)]
        debug_assert!(!self.label.is_empty());
        write!(writer, "{}", BStr::new(self.label))?;

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
