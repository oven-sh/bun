use core::fmt;

use bstr::BStr;
use bun_alloc::AllocError;
use bun_core::ZBox;
use bun_core::strings;
use bun_semver::string::Buf as StringBuf;

use crate::dependency as Dependency;
use crate::hosted_git_info;
use crate::resolution::fmt_store_url;

// MOVE_DOWN: data struct + Default + buffer-relative `order`/`count`/`clone`/
// `eql` now live in `bun_install_types::resolver_hooks` so the resolver and
// `Resolution.Value`/`Dependency.Version.Value` can name a real type. The
// install-tier behaviour below (parsing, formatting, git CLI, download/
// checkout) is provided as an extension trait so existing
// `repo.method(...)` / `Repository::method(...)` call sites keep resolving
// once `RepositoryExt` is in scope.
pub use bun_install_types::resolver_hooks::Repository;

/// The environment of every `git` process that `bun install` spawns.
pub(crate) struct GitEnv {
    /// `KEY=VALUE\0` array for spawn.
    pub(crate) envp: bun_dotenv::NullDelimitedEnvMap,
    /// `git` resolved on the env's `PATH`. `None` when git is not installed.
    pub(crate) git: Option<ZBox>,
    /// False for the provisional environment that only `CONFIG_QUERY` itself runs in.
    pub(crate) is_settled: bool,
}

impl GitEnv {
    /// Prints `core.askpass` and `core.sshcommand`, each only if a file, include, or variable that
    /// git reads sets it. `--git-dir` excludes the project's own config, which no clone reads.
    pub(crate) const CONFIG_QUERY: &'static [&'static [u8]] = &[
        concat!("--git-dir=", bun_core::null_device!()).as_bytes(),
        b"config",
        b"--name-only",
        b"--get-regexp",
        br"^core\.(askpass|sshcommand)$",
    ];

    /// `configured` is the output of `CONFIG_QUERY`, or `None` for the environment that runs it.
    pub(crate) fn new(configured: Option<&[u8]>) -> GitEnv {
        let mut map = bun_core::handle_oom(bun_dotenv::Map::for_git_child());
        // `bunx` sets these for its own install only. Git runs the user's hooks, which must not
        // inherit them.
        map.remove(b"BUN_INTERNAL_BUNX_INSTALL");
        map.remove(b"BUN_INTERNAL_BUNX_HAS_COPY");
        // Git ignores `refs/replace`, so a commit hash always gives the content that it names.
        bun_core::handle_oom(map.put(b"GIT_NO_REPLACE_OBJECTS", b"1"));

        if let Some(configured) = configured {
            // Prompts are off by default, because the install's own output would hide them.
            if map.get(b"GIT_ASKPASS").is_none() && !strings::contains(configured, b"core.askpass")
            {
                bun_core::handle_oom(map.put(b"GIT_ASKPASS", b"echo"));
            }

            // `GIT_SSH_COMMAND` overrides `core.sshCommand` and `GIT_SSH`, so it is only set when
            // the user has set neither.
            if map.get(b"GIT_SSH_COMMAND").is_none()
                && map.get(b"GIT_SSH").is_none()
                && !strings::contains(configured, b"core.sshcommand")
            {
                bun_core::handle_oom(map.put(
                    b"GIT_SSH_COMMAND",
                    b"ssh -oStrictHostKeyChecking=accept-new",
                ));
            }
        }

        // The spawn does no `PATH` search; resolve `git` on the child's `PATH`.
        let mut git_buf = bun_paths::path_buffer_pool::get();
        let git = bun_which::which(&mut git_buf, map.get(b"PATH").unwrap_or(b""), b"", b"git")
            .map(|git| ZBox::from_bytes(git.as_bytes()));

        GitEnv {
            envp: bun_core::handle_oom(map.create_null_delimited_env_map()),
            git,
            is_settled: configured.is_some(),
        }
    }
}

/// The domain of a shorthand host: `gitlab.com` for the `gitlab` in `gitlab:user/repo`.
fn shorthand_domain(host: &[u8]) -> Option<&'static [u8]> {
    hosted_git_info::HostProvider::from_shortcut(host, false).map(|provider| provider.domain())
}

/// The pieces of `locked_scp_like`.
fn locked_scp_like_parts(repo: &[u8]) -> Option<[&[u8]; 4]> {
    if !Dependency::is_scp_like_path(repo) {
        return None;
    }
    let host = &repo[..strings::index_of_char_usize(repo, b':').unwrap_or(0)];
    Some(match shorthand_domain(host) {
        Some(_) => scp_like_url_parts(b"ssh://git@", repo),
        None => [b"ssh://", repo, b"", b""],
    })
}

/// The `repo` to record in the lockfile for `host:path`: `ssh://host:path`, which is what reading
/// bun.lock's `git+ssh://host:path` gives back. A shorthand (`gitlab:user/repo`) becomes a URL.
pub(crate) fn locked_scp_like(repo: &[u8]) -> Option<Vec<u8>> {
    locked_scp_like_parts(repo).map(|parts| parts.concat())
}

/// Whether a lockfile has `locked` as the `repo` of the repository that a specifier names as
/// `declared`. A lockfile from before `locked_scp_like` has `ssh://host:path` for a shorthand too.
pub(crate) fn is_locked_as(declared: &[u8], locked: &[u8]) -> bool {
    if declared == locked {
        return true;
    }
    let Some(parts) = locked_scp_like_parts(declared) else {
        return false;
    };
    let mut rest = Some(locked);
    for part in parts {
        rest = rest.and_then(|rest| rest.strip_prefix(part));
    }
    rest.is_some_and(<[u8]>::is_empty) || locked.strip_prefix(b"ssh://") == Some(declared)
}

/// `resolved` is the `.bun-tag` value persisted to the lockfile (a commit SHA for
/// `git`, or `<owner>-<repo>-<sha>` for `github`). It is concatenated into a cache
/// directory name and passed to `git checkout`, so it must be a single safe path
/// component: no separators, no NUL, and no leading `-` that git would parse as an
/// option.
pub(crate) fn is_safe_resolved_tag(resolved: &[u8]) -> bool {
    !resolved.is_empty()
        && resolved.len() <= 256
        && resolved[0] != b'-'
        && resolved != b"."
        && resolved != b".."
        && resolved
            .iter()
            .all(|&b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// The name of the root folder in GitHub's tarball of `commit`. A fresh install records that name
/// as `resolved`.
pub(crate) fn github_tarball_tag(owner: &[u8], repo: &[u8], commit: &[u8]) -> Option<Vec<u8>> {
    let tag = [owner, b"-", repo, b"-", &commit[..commit.len().min(7)]].concat();
    is_safe_resolved_tag(&tag).then_some(tag)
}

/// Install-tier `Repository` behaviour: parsing, formatting, clone URL forms.
pub trait RepositoryExt: Sized {
    fn parse_append_git(input: &[u8], buf: &mut StringBuf<'_>) -> Result<Repository, AllocError>;
    fn parse_append_github(input: &[u8], buf: &mut StringBuf<'_>)
    -> Result<Repository, AllocError>;
    /// For a checkout whose package.json has no `name` (or no package.json at all).
    fn fallback_package_name<'a>(&'a self, string_buf: &'a [u8]) -> &'a [u8];
    fn format_as(&self, label: &str, buf: &[u8], writer: &mut impl fmt::Write) -> fmt::Result;
    fn fmt_store_path<'a>(&'a self, label: &'a str, string_buf: &'a [u8])
    -> StorePathFormatter<'a>;
    fn fmt<'a>(&'a self, label: &'a str, buf: &'a [u8]) -> Formatter<'a>;
    /// The commit in `resolved` (`<owner>-<repo>-<commit>` for GitHub).
    fn resolved_commit<'a>(&'a self, buf: &'a [u8]) -> &'a [u8];
    /// The ssh form of a git URL; `None` for an explicit `http(s)://` URL.
    fn try_ssh(url: &[u8]) -> Option<Vec<u8>>;
    /// The https form of a git URL, or `None` when it has none.
    fn try_https(url: &[u8]) -> Option<Vec<u8>>;
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

    fn parse_append_github(
        input: &[u8],
        buf: &mut StringBuf<'_>,
    ) -> Result<Repository, AllocError> {
        let mut remain = input;
        if remain.starts_with(b"github:") {
            remain = &remain[b"github:".len()..];
        }
        let (before_hash, committish) = match strings::last_index_of_char(remain, b'#') {
            Some(hash) => (&remain[..hash], Some(&remain[hash + 1..])),
            None => (remain, None),
        };
        let (owner, repo) = match strings::last_index_of_char(before_hash, b'/') {
            Some(slash) => (&before_hash[..slash], &before_hash[slash + 1..]),
            None => (&remain[..0], before_hash),
        };

        let mut result = Repository {
            owner: buf.append(owner)?,
            repo: buf.append(repo)?,
            ..Default::default()
        };

        if let Some(committish) = committish {
            result.committish = buf.append(committish)?;
        }

        Ok(result)
    }

    fn fallback_package_name<'a>(&'a self, string_buf: &'a [u8]) -> &'a [u8] {
        let mut repo = self.repo.slice(string_buf);
        if let Some(hash_index) = strings::index_of_char(repo, b'#') {
            repo = &repo[..hash_index as usize];
        }
        Dependency::fallback_package_name(repo)
    }

    fn format_as(&self, label: &str, buf: &[u8], writer: &mut impl fmt::Write) -> fmt::Result {
        let formatter = Formatter {
            label,
            repository: self,
            buf,
        };
        write!(writer, "{}", formatter)
    }

    fn fmt_store_path<'a>(
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

    fn fmt<'a>(&'a self, label: &'a str, buf: &'a [u8]) -> Formatter<'a> {
        Formatter {
            repository: self,
            buf,
            label,
        }
    }

    fn resolved_commit<'a>(&'a self, buf: &'a [u8]) -> &'a [u8] {
        let resolved = self.resolved.slice(buf);
        match strings::last_index_of_char(resolved, b'-') {
            Some(i) => &resolved[i + 1..],
            None => resolved,
        }
    }

    fn try_ssh(url: &[u8]) -> Option<Vec<u8>> {
        // Do not cast explicit http(s) URLs to SSH
        if url.starts_with(b"http") {
            return None;
        }

        // `git@host:path`. git reads `git@host/path` as a path on this machine.
        if url.starts_with(b"git@")
            && strings::index_of_any(url, b":/").is_some_and(|at| url[at] == b':')
        {
            return Some(url.to_vec());
        }

        if let Some(path) = scp_like_path(url) {
            let host_end = strings::index_of_any(path, b":/").unwrap_or(path.len());
            // A user that looks like an option stays behind `git@`.
            let has_user = path[0] != b'-' && strings::contains_char(&path[..host_end], b'@');
            let prefix: &[u8] = if has_user { b"ssh://" } else { b"ssh://git@" };
            return Some(scp_like_to_url(prefix, path));
        }

        url.starts_with(b"ssh://").then(|| url.to_vec())
    }

    fn try_https(url: &[u8]) -> Option<Vec<u8>> {
        if url.starts_with(b"http") {
            return Some(url.to_vec());
        }

        if let Some(path) = scp_like_path(url) {
            return Some(scp_like_to_url(b"https://", path));
        }

        let rest = url.strip_prefix(b"ssh://")?;
        // On the hosts that have a shorthand, `git@` is only the ssh account, so https drops it.
        let hosted = rest.strip_prefix(b"git@").filter(|hosted| {
            let host_end = strings::index_of_char_usize(hosted, b'/').unwrap_or(hosted.len());
            hosted_git_info::HostProvider::from_domain(&hosted[..host_end]).is_some()
        });
        Some([b"https://".as_slice(), hosted.unwrap_or(rest)].concat())
    }
}

/// Returns the `host:path` in `url`, which bun.lock writes as `ssh://host:path`. An `ssh://` URL
/// that parses is a real URL instead: its colon comes before a port.
pub(crate) fn scp_like_path(url: &[u8]) -> Option<&[u8]> {
    let path = match url.strip_prefix(b"ssh://") {
        Some(_) if bun_url::whatwg::Parsed::from_utf8(url).is_some() => return None,
        Some(path) => path,
        None => url,
    };
    Dependency::is_scp_like_path(path).then_some(path)
}

/// The pieces of `<prefix>host/path` for `host:path`. A shorthand host like `github` becomes its
/// domain.
fn scp_like_url_parts<'a>(prefix: &'a [u8], url: &'a [u8]) -> [&'a [u8]; 4] {
    // The colons inside a bracketed host (`git@[::1]:path`) are part of the host.
    let bracket = match strings::index_of_any(url, b"[:") {
        Some(at) if url[at] == b'[' => strings::index_of_char_usize(url, b']').unwrap_or(0),
        _ => 0,
    };
    let Some(colon) = strings::index_of_char_pos(url, b':', bracket) else {
        return [prefix, url, b"", b""];
    };
    let (host, path) = (&url[..colon], &url[colon + 1..]);
    [prefix, shorthand_domain(host).unwrap_or(host), b"/", path]
}

/// Turns `host:path` into `<prefix>host/path`.
fn scp_like_to_url(prefix: &[u8], url: &[u8]) -> Vec<u8> {
    scp_like_url_parts(prefix, url).concat()
}

pub struct StorePathFormatter<'a> {
    repo: &'a Repository,
    label: &'a str,
    string_buf: &'a [u8],
}

impl<'a> fmt::Display for StorePathFormatter<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            writer,
            "{}",
            bun_semver::string::fmt_store_path(self.label.as_bytes())
        )?;

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

        write!(
            writer,
            "{}",
            fmt_store_url(self.repo.repo.slice(self.string_buf))
        )?;

        if !self.repo.resolved.is_empty() {
            writer.write_str("+")?; // this would be '#' but it's not valid on windows
            let resolved = self.repo.resolved_commit(self.string_buf);
            write!(writer, "{}", bun_semver::string::fmt_store_path(resolved))?;
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
            let resolved = self.repository.resolved_commit(self.buf);
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
