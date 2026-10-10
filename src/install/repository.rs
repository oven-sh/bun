use core::fmt;
use std::sync::OnceLock;

use bstr::BStr;
use bun_alloc::AllocError;
use bun_core::ZBox;
use bun_core::strings;
use bun_semver::string::Buf as StringBuf;

use crate::dependency as Dependency;
use crate::hosted_git_info;
use crate::install::{self as Install};
use crate::resolution::fmt_store_url;

#[derive(Clone, Copy, Default)]
struct SloppyGlobalGitConfig {
    has_askpass: bool,
    has_ssh_command: bool,
}

// Written exactly once on first `get()`, then read-only.
static SLOPPY_HOLDER: OnceLock<SloppyGlobalGitConfig> = OnceLock::new();

impl SloppyGlobalGitConfig {
    fn get() -> SloppyGlobalGitConfig {
        *SLOPPY_HOLDER.get_or_init(Self::load_and_parse)
    }

    fn load_and_parse() -> SloppyGlobalGitConfig {
        let Some(home_dir) = bun_core::env_var::HOME.get() else {
            return SloppyGlobalGitConfig::default();
        };

        let mut config_file_path_buf = bun_paths::path_buffer_pool::get();
        let config_file_path = bun_paths::resolve_path::join_abs_string_buf_z::<
            bun_paths::platform::Auto,
        >(home_dir, &mut config_file_path_buf, &[b".gitconfig"]);
        // MOVE_DOWN: `File::toSource` lives in `bun_logger` (T1→T2 cyclebreak).
        let Ok(source) = bun_ast::to_source(
            config_file_path,
            bun_ast::ToSourceOptions { convert_bom: true },
        ) else {
            return SloppyGlobalGitConfig::default();
        };
        // `defer allocator.free(source.contents)` — handled by Drop on `source`.

        let mut remaining = strings::split(source.contents(), b"\n");
        let mut found_askpass = false;
        let mut found_ssh_command = false;
        let mut in_core = false;
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

        SloppyGlobalGitConfig {
            has_askpass: found_askpass,
            has_ssh_command: found_ssh_command,
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

/// The environment every `git` the install spawns runs with (see `GitEnv::get`).
pub(crate) struct GitEnv {
    /// `KEY=VALUE\0` array for spawn.
    pub(crate) envp: bun_dotenv::NullDelimitedEnvMap,
    /// `git` resolved on the env's `PATH`. `None` when git is not installed.
    pub(crate) git: Option<ZBox>,
}

// Written once from the install thread (the only one that spawns git), then read-only.
static GIT_ENV: bun_core::RacyCell<Option<GitEnv>> = bun_core::RacyCell::new(None);

impl GitEnv {
    pub(crate) fn get(loader: &mut bun_dotenv::Loader) -> &'static GitEnv {
        let slot = GIT_ENV.get();
        // SAFETY: only the install thread reaches this. The slot is written
        // once, before any reference into it exists, and never reassigned.
        unsafe {
            if (*slot).is_none() {
                *slot = Some(Self::init(loader));
            }
            (*slot).as_ref().unwrap()
        }
    }

    fn init(loader: &mut bun_dotenv::Loader) -> GitEnv {
        // No prompts by default: the install's own output would hide them.
        let mut map = bun_core::handle_oom(loader.map.clone_with_allocator());

        if map.get(b"GIT_ASKPASS").is_none() {
            let config = SloppyGlobalGitConfig::get();
            if !config.has_askpass {
                bun_core::handle_oom(map.put(b"GIT_ASKPASS", b"echo"));
            }
        }

        if map.get(b"GIT_SSH_COMMAND").is_none() {
            let config = SloppyGlobalGitConfig::get();
            if !config.has_ssh_command {
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
        }
    }
}

bun_core::comptime_string_map! {
    /// TLD appended to the shorthand git hosts. The length dispatch rejects
    /// everything that isn't 6 or 9 bytes (the common case: real hostnames
    /// like `git.company.io`) before any byte compare.
    static HOST_TLDS: &'static [u8] = {
        b"github" => b".com",
        b"gitlab" => b".com",
        b"bitbucket" => b".org",
    };
}

#[inline]
fn host_tld(host: &[u8]) -> Option<&'static [u8]> {
    HOST_TLDS.get(host).copied()
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

/// Install-tier `Repository` behaviour: parsing, formatting, clone URL forms.
pub trait RepositoryExt: Sized {
    fn parse_append_git(input: &[u8], buf: &mut StringBuf<'_>) -> Result<Repository, AllocError>;
    fn parse_append_github(input: &[u8], buf: &mut StringBuf<'_>)
    -> Result<Repository, AllocError>;
    fn create_dependency_name_from_version_literal(
        repository: &Repository,
        string_buf: &[u8],
        dep: &Install::Dependency,
    ) -> Vec<u8>;
    fn format_as(&self, label: &str, buf: &[u8], writer: &mut impl fmt::Write) -> fmt::Result;
    fn fmt_store_path<'a>(&'a self, label: &'a str, string_buf: &'a [u8])
    -> StorePathFormatter<'a>;
    fn fmt<'a>(&'a self, label: &'a str, buf: &'a [u8]) -> Formatter<'a>;
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

    fn create_dependency_name_from_version_literal(
        repository: &Repository,
        string_buf: &[u8],
        dep: &Install::Dependency,
    ) -> Vec<u8> {
        // Callers (`parse_with_json`) hold a split `StringBuilder`
        // borrow on `string_bytes`, so accept the two pieces directly.
        let buf = string_buf;
        let repo_name = repository.repo;
        let repo_name_str = repo_name.slice(buf);

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

    fn try_ssh(url: &[u8]) -> Option<Vec<u8>> {
        // Do not cast explicit http(s) URLs to SSH
        if url.starts_with(b"http") {
            return None;
        }

        if url.starts_with(b"git@") {
            return Some(url.to_vec());
        }

        if url.starts_with(b"ssh://") {
            // Fix malformed ssh:// URLs with colons using hosted_git_info.correctUrl
            // ssh://git@github.com:user/repo -> ssh://git@github.com/user/repo
            let pair = hosted_git_info::UrlProtocolPair {
                url: hosted_git_info::UrlProtocolPairUrl::Unmanaged(url),
                protocol: hosted_git_info::UrlProtocol::WellFormed(
                    hosted_git_info::WellDefinedProtocol::GitPlusSsh,
                ),
            };

            return Some(match hosted_git_info::correct_url(&pair) {
                Ok(corrected) => corrected.url_slice().to_vec(),
                // If correction fails, return original
                Err(_) => url.to_vec(),
            });
        }

        if Dependency::is_scp_like_path(url) {
            return Some(scp_like_to_url(b"ssh://git@", url));
        }

        None
    }

    fn try_https(url: &[u8]) -> Option<Vec<u8>> {
        if url.starts_with(b"http") {
            return Some(url.to_vec());
        }

        if url.starts_with(b"ssh://") {
            let mut out = Vec::with_capacity(url.len() + 2);
            out.extend_from_slice(b"https");
            out.extend_from_slice(&url[b"ssh".len()..]);
            return Some(out);
        }

        if Dependency::is_scp_like_path(url) {
            return Some(scp_like_to_url(b"https://", url));
        }

        None
    }
}

/// `host:path` → `<prefix>host/path`; a shorthand host gets its TLD (`github` → `github.com`).
fn scp_like_to_url(prefix: &[u8], url: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(prefix.len() + url.len() + b".org".len());
    out.extend_from_slice(prefix);
    match strings::index_of_char(url, b':') {
        Some(colon) => {
            let colon = colon as usize;
            out.extend_from_slice(&url[..colon]);
            if let Some(tld) = host_tld(&url[..colon]) {
                out.extend_from_slice(tld);
            }
            out.push(b'/');
            out.extend_from_slice(&url[colon + 1..]);
        }
        None => out.extend_from_slice(url),
    }
    out
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

        write!(
            writer,
            "{}",
            fmt_store_url(self.repo.repo.slice(self.string_buf))
        )?;

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
