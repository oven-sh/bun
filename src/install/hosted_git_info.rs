//! Resolves Git URLs and metadata.
//!
//! This library mimics https://www.npmjs.com/package/hosted-git-info. At the time of writing, the
//! latest version is 9.0.0. Although @markovejnovic believes there are bugs in the original
//! library, this library aims to be bug-for-bug compatible with the original.
//!
//! One thing that's really notable is that hosted-git-info supports extensions and we currently
//! offer no support for extensions. This could be added in the future if necessary.
//!
//! # Core Concepts
//!
//! The goal of this library is to transform a Git URL or a "shortcut" (which is a shorthand for a
//! longer URL) into a structured representation of the relevant Git repository.
//!
//! ## Shortcuts
//!
//! A shortcut is a shorthand for a longer URL. For example, `github:user/repo` is a shortcut which
//! resolves to a full Github URL. `gitlab:user/repo` is another example of a shortcut.
//!
//! # Types
//!
//! This library revolves around a couple core types which are briefly described here.
//!
//! ## `HostedGitInfo`
//!
//! This is the main API point of this library. It encapsulates information about a Git repository.
//! To parse URLs into this structure, use the `fromUrl` member function.
//!
//! ## `HostProvider`
//!
//! This enumeration defines all the known Git host providers. Each provider has slightly different
//! properties which need to be accounted for. Further details are provided in its documentation.
//!
//! ## `UrlProtocol`
//!
//! This is a type that encapsulates the different types of protocols that a URL may have. This
//! includes three different cases:
//!
//!   - `well_defined`: A protocol which is directly supported by this library.
//!   - `custom`: A protocol which is not known by this library, but is specified in the URL.
//!               TODO(markovejnovic): How is this handled?
//!   - `unknown`: A protocol which is not specified in the URL.
//!
//! ## `WellDefinedProtocol`
//!
//! This type represents the set of known protocols by this library. Each protocol has slightly
//! different properties which need to be accounted for.
//!
//! It's noteworthy that `WellDefinedProtocol` doesn't refer to "true" protocols, but includes fake
//! tags like `github:` which are handled as "shortcuts" by this library.

use core::ops::Range;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_core::StringBuilder;
use bun_jsc::URL as JscUrl;
use bun_str::strings;
use bun_url::PercentEncoding;
use bstr::BStr;
use enum_map::{enum_map, Enum, EnumMap};

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum HostedGitInfoError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidURL")]
    InvalidURL,
}

impl From<AllocError> for HostedGitInfoError {
    fn from(_: AllocError) -> Self {
        HostedGitInfoError::OutOfMemory
    }
}

impl From<HostedGitInfoError> for bun_core::Error {
    fn from(e: HostedGitInfoError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ParseUrlError {
    #[error("InvalidGitUrl")]
    InvalidGitUrl,
    #[error("OutOfMemory")]
    OutOfMemory,
}

impl From<AllocError> for ParseUrlError {
    fn from(_: AllocError) -> Self {
        ParseUrlError::OutOfMemory
    }
}

impl From<ParseUrlError> for bun_core::Error {
    fn from(e: ParseUrlError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Representation
// ──────────────────────────────────────────────────────────────────────────

/// Represents how a URL should be reported when formatting it as a string.
///
/// Input strings may be given in any format and they may be formatted in any format. If you wish
/// to format a URL in a specific format, you can use its `format*` methods. However, each input
/// string has a "default" representation which is used when calling `toString()`. Depending on the
/// input, the default representation may be different.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Representation {
    /// foo/bar
    Shortcut,
    /// git+ssh://git@domain/user/project.git#committish
    Sshurl,
    /// ssh://domain/user/project.git#committish
    Ssh,
    /// https://domain/user/project.git#committish
    Https,
    /// git://domain/user/project.git#committish
    Git,
    /// http://domain/user/project.git#committish
    Http,
}

// ──────────────────────────────────────────────────────────────────────────
// HostedGitInfo
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: reshaped for borrowck. The Zig stores `committish`/`project`/`user`
// as `[]const u8` slices that alias into `_memory_buffer` (a single owned
// allocation). Rust can't express that self-reference safely without lifetimes
// on the struct (forbidden in Phase A). We store byte ranges into
// `_memory_buffer` instead and expose slice accessors.
pub struct HostedGitInfo {
    committish: Option<Range<usize>>,
    project: Range<usize>,
    user: Option<Range<usize>>,
    pub host_provider: HostProvider,
    pub default_representation: Representation,

    _memory_buffer: Box<[u8]>,
}

impl HostedGitInfo {
    #[inline]
    pub fn committish(&self) -> Option<&[u8]> {
        self.committish.clone().map(|r| &self._memory_buffer[r])
    }
    #[inline]
    pub fn project(&self) -> &[u8] {
        &self._memory_buffer[self.project.clone()]
    }
    #[inline]
    pub fn user(&self) -> Option<&[u8]> {
        self.user.clone().map(|r| &self._memory_buffer[r])
    }

    /// Helper function to decode a percent-encoded string and append it to a StringBuilder.
    /// Returns the decoded slice and updates the StringBuilder's length.
    ///
    /// The reason we need to do this is because we get URLs like github:user%20name/repo and we
    /// need to decode them to 'user name/repo'. It would be nice if we could get all the
    /// functionality of jsc.URL WITHOUT the percent-encoding, but alas, we cannot. And we need the
    /// jsc.URL functionality for parsing, validating and punycode-decoding the URL.
    ///
    /// Therefore, we use this function to first take a URL string, encode it into a *jsc.URL and
    /// then decode it back to a normal string. Kind of a lot of work, but it works.
    ///
    /// PORT NOTE: returns a `Range<usize>` into the StringBuilder's allocated buffer
    /// instead of a borrowed slice (see struct-level note).
    fn decode_and_append(
        sb: &mut StringBuilder,
        input: &[u8],
    ) -> Result<Range<usize>, HostedGitInfoError> {
        let start = sb.len;
        let writable = sb.writable();
        // TODO(port): PercentEncoding.decode in Zig takes a writer; here we assume a
        // `decode_into(dst: &mut [u8], src: &[u8]) -> Result<usize, _>` shape.
        let decoded_len =
            PercentEncoding::decode_into(writable, input).map_err(|_| HostedGitInfoError::InvalidURL)?;
        sb.len += decoded_len;
        Ok(start..start + decoded_len)
    }

    fn copy_from(
        committish: Option<&[u8]>,
        project: &[u8],
        user: Option<&[u8]>,
        host_provider: HostProvider,
        default_representation: Representation,
    ) -> Result<Self, HostedGitInfoError> {
        let mut sb = StringBuilder::default();

        if let Some(u) = user {
            sb.count(u);
        }
        sb.count(project);
        if let Some(c) = committish {
            sb.count(c);
        }

        sb.allocate().map_err(|_| HostedGitInfoError::OutOfMemory)?;

        // Decode user, project, committish while copying
        let user_part = match user {
            Some(u) => Some(Self::decode_and_append(&mut sb, u)?),
            None => None,
        };
        let project_part = Self::decode_and_append(&mut sb, project)?;
        let committish_part = match committish {
            Some(c) => Some(Self::decode_and_append(&mut sb, c)?),
            None => None,
        };

        let owned_buffer = sb.allocated_slice();

        Ok(Self {
            committish: committish_part,
            project: project_part,
            user: user_part,
            host_provider,
            default_representation,
            _memory_buffer: owned_buffer,
        })
    }

    /// Initialize a HostedGitInfo from an extracted structure.
    /// Takes ownership of the extracted structure.
    fn move_from_extracted(
        extracted: &mut ExtractResult,
        host_provider: HostProvider,
        default_representation: Representation,
    ) -> Self {
        let moved = extracted.move_out();
        Self {
            committish: extracted.committish.clone(),
            project: extracted.project.clone(),
            user: extracted.user.clone(),
            host_provider,
            default_representation,
            _memory_buffer: moved,
        }
    }

    // PORT NOTE: `pub fn deinit` → `impl Drop`. Body only freed `_memory_buffer`;
    // `Box<[u8]>` drops automatically, so no explicit Drop impl is needed.

    // PORT NOTE: `pub const toJS = @import("../install_jsc/...")` deleted —
    // `to_js` is an extension-trait method living in `bun_install_jsc`.

    pub struct StringPair {
        // TODO(port): lifetime/ownership of these slices unclear; never constructed in this file.
        pub save_spec: Box<[u8]>,
        pub fetch_spec: Option<Box<[u8]>>,
    }

    /// Given a URL-like (including shortcuts) string, parses it into a HostedGitInfo structure.
    /// The HostedGitInfo is valid only for as long as `git_url` is valid.
    pub fn from_url(git_url: &[u8]) -> Result<Option<Self>, HostedGitInfoError> {
        // git_url_mut may carry two ownership semantics:
        //  - It aliases `git_url`, in which case it must not be freed.
        //  - It actually points to a new allocation, in which case it must be freed.
        // PORT NOTE: modeled as Cow-like local; Drop handles the owned case.
        let mut git_url_owned: Option<Vec<u8>> = None;
        let mut git_url_mut: &[u8] = git_url;

        if is_github_shorthand(git_url) {
            // In this case we have to prefix the url with `github:`.
            //
            // NOTE(markovejnovic): I don't exactly understand why this is treated specially.
            //
            // TODO(markovejnovic): Perhaps we can avoid this allocation...
            // This one seems quite easy to get rid of.
            let concatenated = strings::concat(&[b"github:", git_url]);
            git_url_owned = Some(concatenated);
            git_url_mut = git_url_owned.as_deref().unwrap();
        }

        let Ok(parsed) = parse_url(git_url_mut) else {
            return Ok(None);
        };
        // `parsed.url` is `Box<JscUrl>`; Drop handles `defer parsed.url.deinit()`.

        let host_provider = match parsed.proto {
            UrlProtocol::WellFormed(p) => {
                p.host_provider().or_else(|| HostProvider::from_url_domain(&parsed.url))
            }
            UrlProtocol::Unknown => HostProvider::from_url_domain(&parsed.url),
            UrlProtocol::Custom(_) => HostProvider::from_url(&parsed.url),
        };
        let Some(host_provider) = host_provider else {
            return Ok(None);
        };

        let is_shortcut = matches!(parsed.proto, UrlProtocol::WellFormed(p) if p.is_shortcut());
        if !is_shortcut {
            let Some(mut extracted) = host_provider.extract(&parsed.url)? else {
                return Ok(None);
            };
            return Ok(Some(HostedGitInfo::move_from_extracted(
                &mut extracted,
                host_provider,
                parsed.proto.default_representation(),
            )));
        }

        // Shortcut path: github:user/repo, gitlab:user/repo, etc. (from-url.js line 68-96)
        let pathname_owned = parsed.url.pathname().to_owned_slice()?;
        // Drop handles `defer allocator.free(pathname_owned)`.

        // Strip leading / (from-url.js line 69)
        let mut pathname: &[u8] = strings::trim_prefix(&pathname_owned, b"/");

        // Strip auth (from-url.js line 70-74)
        if let Some(first_at) = strings::index_of_char(pathname, b'@') {
            pathname = &pathname[first_at + 1..];
        }

        // extract user and project from pathname (from-url.js line 76-86)
        let mut user_part: Option<&[u8]> = None;
        let project_part: &[u8] = 'blk: {
            if let Some(last_slash) = strings::last_index_of_char(pathname, b'/') {
                let user_str = &pathname[0..last_slash];
                // We want nulls only, never empty strings (from-url.js line 79-82)
                if !user_str.is_empty() {
                    user_part = Some(user_str);
                }
                break 'blk &pathname[last_slash + 1..];
            } else {
                break 'blk pathname;
            }
        };

        // Strip .git suffix (from-url.js line 88-90)
        let project_trimmed = strings::trim_suffix(project_part, b".git");

        // Get committish from URL fragment (from-url.js line 92-94)
        let fragment = parsed.url.fragment_identifier().to_owned_slice()?;
        let committish: Option<&[u8]> = if !fragment.is_empty() { Some(&fragment) } else { None };

        // copy_from will URL-decode user, project, and committish
        Ok(Some(HostedGitInfo::copy_from(
            committish,
            project_trimmed,
            user_part,
            host_provider,
            Representation::Shortcut, // Shortcuts always use shortcut representation
        )?))
    }
}

// PORT NOTE: Zig nested `pub const StringPair = struct {...}` inside HostedGitInfo;
// Rust can't nest struct defs inside `impl`, so it lives at module scope but is
// re-exported through the type's namespace conceptually.
// TODO(port): the `pub struct StringPair` above inside `impl` is invalid Rust — hoist here in Phase B.

// ──────────────────────────────────────────────────────────────────────────
// parse_url
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: anonymous return struct in Zig → named struct here.
// `url` is OWNED per LIFETIMES.tsv (jsc.URL.fromString creates; caller deinits).
pub struct ParsedUrl<'a> {
    pub url: Box<JscUrl>,
    pub proto: UrlProtocol<'a>,
}

/// Handles input like git:github.com:user/repo and inserting the // after the first : if necessary
///
/// May error with `error.InvalidGitUrl` if the URL is not valid.
///
/// Note that this may or may not allocate but it manages its own memory.
pub fn parse_url(npa_str: &[u8]) -> Result<ParsedUrl<'_>, ParseUrlError> {
    // Certain users can provide values like user:password@github.com:foo/bar and we want to
    // "correct" the protocol to be git+ssh://user:password@github.com:foo/bar
    let proto_pair = normalize_protocol(npa_str);
    // Drop handles `defer proto_pair.deinit()`.

    // TODO(markovejnovic): We might be able to avoid this allocation if we rework how jsc.URL
    //                      accepts strings.
    let maybe_url = proto_pair.to_url();
    if let Some(url) = maybe_url {
        return Ok(ParsedUrl { url, proto: proto_pair.protocol });
    }

    // Now that may fail, if the URL is not nicely formatted. In that case, we try to correct the
    // URL and parse it.
    let corrected = correct_url(&proto_pair)?;
    let corrected_url = corrected.to_url();
    if let Some(url) = corrected_url {
        return Ok(ParsedUrl { url, proto: corrected.protocol });
    }

    // Otherwise, we complain.
    Err(ParseUrlError::InvalidGitUrl)
}

// ──────────────────────────────────────────────────────────────────────────
// WellDefinedProtocol
// ──────────────────────────────────────────────────────────────────────────

/// Enumeration of possible URL protocols.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum WellDefinedProtocol {
    Git,
    GitPlusFile,
    GitPlusFtp,
    GitPlusHttp,
    GitPlusHttps,
    GitPlusRsync,
    GitPlusSsh,
    Http,
    Https,
    Ssh,

    // Non-standard protocols.
    Github,
    Bitbucket,
    Gitlab,
    Gist,
    Sourcehut,
}

impl WellDefinedProtocol {
    /// Mapping from protocol string (without colon) to WellDefinedProtocol.
    pub static STRINGS: phf::Map<&'static [u8], WellDefinedProtocol> = phf::phf_map! {
        b"bitbucket" => WellDefinedProtocol::Bitbucket,
        b"gist" => WellDefinedProtocol::Gist,
        b"git+file" => WellDefinedProtocol::GitPlusFile,
        b"git+ftp" => WellDefinedProtocol::GitPlusFtp,
        b"git+http" => WellDefinedProtocol::GitPlusHttp,
        b"git+https" => WellDefinedProtocol::GitPlusHttps,
        b"git+rsync" => WellDefinedProtocol::GitPlusRsync,
        b"git+ssh" => WellDefinedProtocol::GitPlusSsh,
        b"git" => WellDefinedProtocol::Git,
        b"github" => WellDefinedProtocol::Github,
        b"gitlab" => WellDefinedProtocol::Gitlab,
        b"http" => WellDefinedProtocol::Http,
        b"https" => WellDefinedProtocol::Https,
        b"sourcehut" => WellDefinedProtocol::Sourcehut,
        b"ssh" => WellDefinedProtocol::Ssh,
    };

    // PORT NOTE: Zig `strings.getKey(self)` did reverse lookup; provide explicit map.
    fn protocol_str(self) -> &'static [u8] {
        match self {
            Self::Bitbucket => b"bitbucket",
            Self::Gist => b"gist",
            Self::GitPlusFile => b"git+file",
            Self::GitPlusFtp => b"git+ftp",
            Self::GitPlusHttp => b"git+http",
            Self::GitPlusHttps => b"git+https",
            Self::GitPlusRsync => b"git+rsync",
            Self::GitPlusSsh => b"git+ssh",
            Self::Git => b"git",
            Self::Github => b"github",
            Self::Gitlab => b"gitlab",
            Self::Http => b"http",
            Self::Https => b"https",
            Self::Sourcehut => b"sourcehut",
            Self::Ssh => b"ssh",
        }
    }

    /// Look up a protocol from a string that includes the trailing colon (e.g., "https:").
    /// This method strips the colon before looking up in the strings map.
    pub fn from_string_with_colon(protocol_with_colon: &[u8]) -> Option<Self> {
        if protocol_with_colon.is_empty() {
            None
        } else {
            Self::STRINGS
                .get(strings::trim_suffix(protocol_with_colon, b":"))
                .copied()
        }
    }

    /// Maximum length of any protocol string in the strings map (computed at compile time).
    // PORT NOTE: Zig computed this with a comptime loop over `strings.kvs`. The
    // longest keys ("git+https", "git+rsync", "sourcehut", "bitbucket") are 9 bytes.
    pub const MAX_PROTOCOL_LENGTH: usize = 9;

    /// Buffer type for holding a protocol string with colon (e.g., "git+rsync:").
    /// Sized to hold the longest protocol name plus one character for the colon.
    pub type StringWithColonBuffer = [u8; Self::MAX_PROTOCOL_LENGTH + 1];

    /// Get the protocol string with colon (e.g., "https:") for a given protocol enum.
    /// Takes a buffer pointer to hold the result.
    /// Returns a slice into that buffer containing the protocol string with colon.
    pub fn to_string_with_colon(self, buf: &mut StringWithColonBuffer) -> &[u8] {
        // Look up the protocol string (without colon) from the map
        let protocol_str = self.protocol_str();

        // Copy to buffer and append colon
        buf[0..protocol_str.len()].copy_from_slice(protocol_str);
        buf[protocol_str.len()] = b':';
        &buf[0..protocol_str.len() + 1]
    }

    /// The set of characters that must appear between <protocol><resource-identifier>.
    /// For example, in `git+ssh://user@host:repo`, the `//` is the magic string. Some protocols
    /// don't support this, for example `github:user/repo` is valid.
    ///
    /// Kind of arbitrary and implemented to match hosted-git-info's behavior.
    fn protocol_resource_identifier_concatenation_token(self) -> &'static [u8] {
        match self {
            Self::Git
            | Self::GitPlusFile
            | Self::GitPlusFtp
            | Self::GitPlusHttp
            | Self::GitPlusHttps
            | Self::GitPlusRsync
            | Self::GitPlusSsh
            | Self::Http
            | Self::Https
            | Self::Ssh => b"//",
            Self::Github | Self::Bitbucket | Self::Gitlab | Self::Gist | Self::Sourcehut => b"",
        }
    }

    /// Determine the default representation for this protocol.
    /// Mirrors the logic in from-url.js line 110.
    fn default_representation(self) -> Representation {
        match self {
            Self::GitPlusSsh | Self::Ssh | Self::GitPlusHttp => Representation::Sshurl,
            Self::GitPlusHttps => Representation::Https,
            Self::GitPlusFile | Self::GitPlusFtp | Self::GitPlusRsync | Self::Git => {
                Representation::Git
            }
            Self::Http => Representation::Http,
            Self::Https => Representation::Https,
            Self::Github | Self::Bitbucket | Self::Gitlab | Self::Gist | Self::Sourcehut => {
                Representation::Shortcut
            }
        }
    }

    /// Certain protocols will have associated host providers. This method returns the associated
    /// host provider, if one exists.
    fn host_provider(self) -> Option<HostProvider> {
        match self {
            Self::Github => Some(HostProvider::Github),
            Self::Bitbucket => Some(HostProvider::Bitbucket),
            Self::Gitlab => Some(HostProvider::Gitlab),
            Self::Gist => Some(HostProvider::Gist),
            Self::Sourcehut => Some(HostProvider::Sourcehut),
            _ => None,
        }
    }

    fn is_shortcut(self) -> bool {
        matches!(
            self,
            Self::Github | Self::Bitbucket | Self::Gitlab | Self::Gist | Self::Sourcehut
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// isGitHubShorthand
// ──────────────────────────────────────────────────────────────────────────

/// Test whether the given node-package-arg string is a GitHub shorthand.
///
/// This mirrors the implementation of hosted-git-info, though it is significantly faster.
pub fn is_github_shorthand(npa_str: &[u8]) -> bool {
    // The implementation in hosted-git-info is a multi-pass algorithm. We've opted to implement a
    // single-pass algorithm for better performance.
    //
    // This could be even faster with SIMD but this is probably good enough for now.
    if npa_str.is_empty() {
        return false;
    }

    // Implements doesNotStartWithDot
    if npa_str[0] == b'.' || npa_str[0] == b'/' {
        return false;
    }

    let mut pound_idx: Option<usize> = None;
    let mut seen_slash = false;

    for (i, &c) in npa_str.iter().enumerate() {
        match c {
            // Implement atOnlyAfterHash and colonOnlyAfterHash
            b':' | b'@' => {
                if pound_idx.is_none() {
                    return false;
                }
            }

            b'#' => {
                pound_idx = Some(i);
            }
            b'/' => {
                // Implements secondSlashOnlyAfterHash
                if seen_slash && pound_idx.is_none() {
                    return false;
                }

                seen_slash = true;
            }
            _ => {
                // Implement spaceOnlyAfterHash
                // PORT NOTE: match Zig std.ascii.isWhitespace exactly (includes VT 0x0B and FF 0x0C;
                // Rust u8::is_ascii_whitespace excludes VT).
                if matches!(c, b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C) && pound_idx.is_none() {
                    return false;
                }
            }
        }
    }

    // Implements doesNotEndWithSlash
    let does_not_end_with_slash = if let Some(pi) = pound_idx {
        pi == 0 || npa_str[pi - 1] != b'/'
    } else {
        !npa_str.is_empty() && npa_str[npa_str.len() - 1] != b'/'
    };

    // Implement hasSlash
    seen_slash && does_not_end_with_slash
}

// ──────────────────────────────────────────────────────────────────────────
// UrlProtocol / UrlProtocolPair
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): lifetime on transient struct — `Custom` borrows from the input
// `npa_str`. This is BORROW_PARAM-shaped; verify in Phase B.
#[derive(Debug, Clone, Copy)]
pub enum UrlProtocol<'a> {
    WellFormed(WellDefinedProtocol),

    /// A protocol which is not known by the library. Includes the : character, but not the
    /// double-slash, so `foo://bar` would yield `foo:`.
    Custom(&'a [u8]),

    /// Either no protocol was specified or the library couldn't figure it out.
    Unknown,
}

impl<'a> UrlProtocol<'a> {
    /// Deduces the default representation for this protocol.
    pub fn default_representation(self) -> Representation {
        match self {
            UrlProtocol::WellFormed(p) => p.default_representation(),
            _ => Representation::Sshurl, // Unknown/custom protocols default to sshurl
        }
    }
}

// PORT NOTE: `url: union(enum) { managed: {buf, allocator}, unmanaged: []const u8 }`
// → enum with `Managed(Box<[u8]>)` / `Unmanaged(&'a [u8])`. Allocator dropped.
pub enum UrlProtocolPairUrl<'a> {
    Managed(Box<[u8]>),
    Unmanaged(&'a [u8]),
}

pub struct UrlProtocolPair<'a> {
    pub url: UrlProtocolPairUrl<'a>,
    pub protocol: UrlProtocol<'a>,
}

impl<'a> UrlProtocolPair<'a> {
    pub fn url_slice(&self) -> &[u8] {
        match &self.url {
            UrlProtocolPairUrl::Managed(s) => s,
            UrlProtocolPairUrl::Unmanaged(s) => s,
        }
    }

    // PORT NOTE: `deinit` → Drop; `Managed(Box<[u8]>)` frees automatically.

    /// Given a protocol pair, create a jsc.URL if possible. May allocate, but owns its memory.
    fn to_url(&self) -> Option<Box<JscUrl>> {
        // Ehhh.. Old IE's max path length was 2K so let's just use that. I searched for a
        // statistical distribution of URL lengths and found nothing.
        const _LONG_URL_THRESH: usize = 2048;
        // PERF(port): was stack-fallback (std.heap.stackFallback) — profile in Phase B

        let mut protocol_buf: WellDefinedProtocol::StringWithColonBuffer =
            [0u8; WellDefinedProtocol::MAX_PROTOCOL_LENGTH + 1];

        match self.protocol {
            // If we have no protocol, we can assume it is git+ssh.
            UrlProtocol::Unknown => {
                Self::concat_parts_to_url(&[b"git+ssh://", self.url_slice()])
            }
            UrlProtocol::Custom(proto_str) => {
                Self::concat_parts_to_url(&[proto_str, b"//", self.url_slice()])
            }
            // This feels counter-intuitive but is correct. It's not github://foo/bar, it's
            // github:foo/bar.
            UrlProtocol::WellFormed(proto_tag) => Self::concat_parts_to_url(&[
                proto_tag.to_string_with_colon(&mut protocol_buf),
                // Wordy name for a double-slash or empty string. github:foo/bar is valid, but
                // git+ssh://foo/bar is also valid.
                proto_tag.protocol_resource_identifier_concatenation_token(),
                self.url_slice(),
            ]),
        }
    }

    fn concat_parts_to_url(parts: &[&[u8]]) -> Option<Box<JscUrl>> {
        // TODO(markovejnovic): There is a sad unnecessary allocation here that I don't know how to
        // get rid of -- in theory, URL.zig could allocate once.
        let new_str = strings::concat(parts);
        // Drop handles `defer allocator.free(new_str)`.
        JscUrl::from_string(bun_str::String::init(&new_str))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// normalize_protocol / correct_url
// ──────────────────────────────────────────────────────────────────────────

/// Given a loose string that may or may not be a valid URL, attempt to normalize it.
///
/// Returns a struct containing the URL string with the `protocol://` part removed and a tagged
/// enumeration. If the protocol is known, it is returned as a WellDefinedProtocol. If the protocol
/// is specified in the URL, it is given as a slice and if it is not specified, the `unknown` field
/// is returned. The result is a view into `npa_str` which must, consequently, remain stable.
///
/// This mirrors the `correctProtocol` function in `hosted-git-info/parse-url.js`.
fn normalize_protocol(npa_str: &[u8]) -> UrlProtocolPair<'_> {
    let mut first_colon_idx: i32 = -1;
    if let Some(idx) = strings::index_of_char(npa_str, b':') {
        first_colon_idx = i32::try_from(idx).unwrap();
    }

    // The cast here is safe -- first_colon_idx is guaranteed to be [-1, infty)
    let proto_slice = &npa_str[0..usize::try_from(first_colon_idx + 1).unwrap()];

    if let Some(url_protocol) = WellDefinedProtocol::from_string_with_colon(proto_slice) {
        // We need to slice off the protocol from the string. Note there are two very annoying
        // cases -- one where the protocol string is foo://bar and one where it is foo:bar.
        let post_colon =
            strings::substring(npa_str, usize::try_from(first_colon_idx + 1).unwrap(), None);

        return UrlProtocolPair {
            url: UrlProtocolPairUrl::Unmanaged(if post_colon.starts_with(b"//") {
                &post_colon[2..post_colon.len()]
            } else {
                post_colon
            }),
            protocol: UrlProtocol::WellFormed(url_protocol),
        };
    }

    // Now we search for the @ character to see if we have a user@host:path GIT+SSH style URL.
    let first_at_idx = strings::index_of_char(npa_str, b'@');
    if let Some(at_idx) = first_at_idx {
        // We have an @ in the string
        if first_colon_idx != -1 {
            // We have a : in the string.
            if i32::try_from(at_idx).unwrap() > first_colon_idx {
                // The @ is after the :, so we have something like user:pass@host which is a valid
                // URL. and should be promoted to git_plus_ssh. It's guaranteed that the issue is
                // not that we have proto://user@host:path because we would've caught that above.
                return UrlProtocolPair {
                    url: UrlProtocolPairUrl::Unmanaged(npa_str),
                    protocol: UrlProtocol::WellFormed(WellDefinedProtocol::GitPlusSsh),
                };
            } else {
                // Otherwise we have something like user@host:path which is also a valid URL.
                // Things are, however, different, since we don't really know what the protocol is.
                // Remember, we would've hit the proto://user@host:path above.

                // NOTE(markovejnovic): I don't, at this moment, understand how exactly
                // hosted-git-info and npm-package-arg handle this "unknown" protocol as of now.
                // We can't really guess either -- there's no :// which comes before @
                return UrlProtocolPair {
                    url: UrlProtocolPairUrl::Unmanaged(npa_str),
                    protocol: UrlProtocol::Unknown,
                };
            }
        } else {
            // Something like user@host which is also a valid URL. Since no :, that means that the
            // URL is as good as it gets. No need to slice.
            return UrlProtocolPair {
                url: UrlProtocolPairUrl::Unmanaged(npa_str),
                protocol: UrlProtocol::WellFormed(WellDefinedProtocol::GitPlusSsh),
            };
        }
    }

    // The next thing we can try is to search for the double slash and treat this protocol as a
    // custom one.
    //
    // NOTE(markovejnovic): I also think this is wrong in parse-url.js.
    // They:
    // 1. Test the protocol against known protocols (which is fine)
    // 2. Then, if not found, they go through that hoop of checking for @ and : guessing if it is a
    //    git+ssh URL or not
    // 3. And finally, they search for ://.
    //
    // The last two steps feel like they should happen in reverse order:
    //
    // If I have a foobar://user:host@path URL (and foobar is not given as a known protocol), their
    // implementation will not report this as a foobar protocol, but rather as
    // git+ssh://foobar://user:host@path which, I think, is wrong.
    //
    // I even tested it: https://tinyurl.com/5y4e6zrw
    //
    // Our goal is to be bug-for-bug compatible, at least for now, so this is how I re-implemented
    // it.
    let maybe_dup_slash_idx = strings::index_of(npa_str, b"//");
    if let Some(dup_slash_idx) = maybe_dup_slash_idx {
        if i32::try_from(dup_slash_idx).unwrap() == first_colon_idx + 1 {
            return UrlProtocolPair {
                url: UrlProtocolPairUrl::Unmanaged(strings::substring(
                    npa_str,
                    dup_slash_idx + 2,
                    None,
                )),
                protocol: UrlProtocol::Custom(&npa_str[0..dup_slash_idx]),
            };
        }
    }

    // Well, otherwise we have to split the original URL into two pieces,
    // right at the colon.
    if first_colon_idx != -1 {
        return UrlProtocolPair {
            url: UrlProtocolPairUrl::Unmanaged(strings::substring(
                npa_str,
                usize::try_from(first_colon_idx + 1).unwrap(),
                None,
            )),
            protocol: UrlProtocol::Custom(
                &npa_str[0..usize::try_from(first_colon_idx + 1).unwrap()],
            ),
        };
    }

    // Well we couldn't figure out anything.
    UrlProtocolPair {
        url: UrlProtocolPairUrl::Unmanaged(npa_str),
        protocol: UrlProtocol::Unknown,
    }
}

/// Attempt to correct an scp-style URL into a proper URL, parsable with jsc.URL.
///
/// This function assumes that the input is an scp-style URL.
pub fn correct_url<'a>(
    url_proto_pair: &UrlProtocolPair<'a>,
) -> Result<UrlProtocolPair<'a>, AllocError> {
    let at_idx: isize =
        if let Some(idx) = strings::last_index_before_char(url_proto_pair.url_slice(), b'@', b'#') {
            isize::try_from(idx).unwrap()
        } else {
            -1
        };

    let col_idx: isize =
        if let Some(idx) = strings::last_index_before_char(url_proto_pair.url_slice(), b':', b'#') {
            isize::try_from(idx).unwrap()
        } else {
            -1
        };

    if col_idx > at_idx {
        let mut duped: Box<[u8]> = Box::from(url_proto_pair.url_slice());
        duped[usize::try_from(col_idx).unwrap()] = b'/';

        return Ok(UrlProtocolPair {
            url: UrlProtocolPairUrl::Managed(duped),
            protocol: UrlProtocol::WellFormed(WellDefinedProtocol::GitPlusSsh),
        });
    }

    if col_idx == -1 && matches!(url_proto_pair.protocol, UrlProtocol::Unknown) {
        // PORT NOTE: Zig copies `url_proto_pair.url` (a tagged union) by value. Here
        // we know `normalize_protocol` only ever returns `Unmanaged`, so re-borrow.
        return Ok(UrlProtocolPair {
            url: match &url_proto_pair.url {
                UrlProtocolPairUrl::Unmanaged(s) => UrlProtocolPairUrl::Unmanaged(s),
                UrlProtocolPairUrl::Managed(s) => UrlProtocolPairUrl::Managed(s.clone()),
            },
            protocol: UrlProtocol::WellFormed(WellDefinedProtocol::GitPlusSsh),
        });
    }

    Ok(UrlProtocolPair {
        url: match &url_proto_pair.url {
            UrlProtocolPairUrl::Unmanaged(s) => UrlProtocolPairUrl::Unmanaged(s),
            UrlProtocolPairUrl::Managed(s) => UrlProtocolPairUrl::Managed(s.clone()),
        },
        protocol: url_proto_pair.protocol,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// HostProvider
// ──────────────────────────────────────────────────────────────────────────

/// This enumeration encapsulates all known host providers and their configurations.
///
/// Providers each have different configuration fields and, on top of that, have different
/// mechanisms for formatting URLs. For example, GitHub will format SSH URLs as
/// `git+ssh://git@${domain}/${user}/${project}.git${maybeJoin('#', committish)}`, while `gist`
/// will format URLs as `git+ssh://git@${domain}/${project}.git${maybeJoin('#', committish)}`. This
/// structure encapsulates the differences between providers and how they handle all of that.
///
/// Effectively, this enumeration acts as a registry of all known providers and a vtable for
/// jumping between different behavior for different providers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Enum, strum::IntoStaticStr)]
#[strum(serialize_all = "lowercase")]
pub enum HostProvider {
    Bitbucket,
    Gist,
    Github,
    Gitlab,
    Sourcehut,
}

impl HostProvider {
    const ALL: [HostProvider; 5] = [
        HostProvider::Bitbucket,
        HostProvider::Gist,
        HostProvider::Github,
        HostProvider::Gitlab,
        HostProvider::Sourcehut,
    ];

    fn format_ssh(
        self,
        user: Option<&[u8]>,
        project: &[u8],
        committish: Option<&[u8]>,
    ) -> Result<Vec<u8>, AllocError> {
        (configs()[self].format_ssh)(self, user, project, committish)
    }

    fn format_ssh_url(
        self,
        user: Option<&[u8]>,
        project: &[u8],
        committish: Option<&[u8]>,
    ) -> Result<Vec<u8>, AllocError> {
        (configs()[self].format_sshurl)(self, user, project, committish)
    }

    fn format_https(
        self,
        auth: Option<&[u8]>,
        user: Option<&[u8]>,
        project: &[u8],
        committish: Option<&[u8]>,
    ) -> Result<Vec<u8>, AllocError> {
        (configs()[self].format_https)(self, auth, user, project, committish)
    }

    fn format_shortcut(
        self,
        user: Option<&[u8]>,
        project: &[u8],
        committish: Option<&[u8]>,
    ) -> Result<Vec<u8>, AllocError> {
        (configs()[self].format_shortcut)(self, user, project, committish)
    }

    fn extract(self, url: &JscUrl) -> Result<Option<ExtractResult>, HostedGitInfoError> {
        (configs()[self].format_extract)(url)
    }

    /// Return the string representation of the provider.
    pub fn type_str(self) -> &'static str {
        <&'static str>::from(self)
    }

    fn shortcut(self) -> &'static [u8] {
        configs()[self].shortcut
    }

    pub fn domain(self) -> &'static [u8] {
        configs()[self].domain
    }

    fn protocols(self) -> &'static [WellDefinedProtocol] {
        configs()[self].protocols
    }

    fn shortcut_without_colon(self) -> &'static [u8] {
        let shct = self.shortcut();
        &shct[0..shct.len() - 1]
    }

    fn tree_path(self) -> Option<&'static [u8]> {
        configs()[self].tree_path
    }

    fn blob_path(self) -> Option<&'static [u8]> {
        configs()[self].blob_path
    }

    fn edit_path(self) -> Option<&'static [u8]> {
        configs()[self].edit_path
    }

    /// Find the appropriate host provider by its shortcut (e.g. "github:").
    ///
    /// The second parameter allows you to declare whether the given string includes the protocol:
    /// colon or not.
    // PERF(port): was comptime monomorphization — profile in Phase B
    fn from_shortcut(shortcut_str: &[u8], with_colon: bool) -> Option<HostProvider> {
        // PORT NOTE: Zig used `inline for (std.meta.fields(Self))` (comptime reflection).
        for provider in Self::ALL {
            let shortcut_matches = if with_colon {
                provider.shortcut() == shortcut_str
            } else {
                provider.shortcut_without_colon() == shortcut_str
            };

            if shortcut_matches {
                return Some(provider);
            }
        }

        None
    }

    /// Find the appropriate host provider by its domain (e.g. "github.com").
    fn from_domain(domain_str: &[u8]) -> Option<HostProvider> {
        // PORT NOTE: Zig used `inline for (std.meta.fields(Self))` (comptime reflection).
        for provider in Self::ALL {
            if provider.domain() == domain_str {
                return Some(provider);
            }
        }

        None
    }

    /// Parse a URL and return the appropriate host provider, if any.
    fn from_url(url: &JscUrl) -> Option<HostProvider> {
        let proto_str = url.protocol();
        // Drop handles `defer proto_str.deref()`.

        // Try shortcut first (github:, gitlab:, etc.)
        if let Some(provider) = HostProvider::from_shortcut(proto_str.byte_slice(), false) {
            return Some(provider);
        }

        HostProvider::from_url_domain(url)
    }

    /// Given a URL, use the domain in the URL to find the appropriate host provider.
    fn from_url_domain(url: &JscUrl) -> Option<HostProvider> {
        const _MAX_HOSTNAME_LEN: usize = 253;
        // PERF(port): was stack-fallback (FixedBufferAllocator) — profile in Phase B

        let hostname_str = url.hostname();
        // Drop handles `defer hostname_str.deref()`.

        let hostname_utf8 = hostname_str.to_utf8();
        let hostname = strings::without_prefix(hostname_utf8.slice(), b"www.");

        HostProvider::from_domain(hostname)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HostProvider::Config
// ──────────────────────────────────────────────────────────────────────────

pub struct Config {
    pub protocols: &'static [WellDefinedProtocol],
    pub domain: &'static [u8],
    pub shortcut: &'static [u8],
    pub tree_path: Option<&'static [u8]>,
    pub blob_path: Option<&'static [u8]>,
    pub edit_path: Option<&'static [u8]>,

    pub format_ssh: formatters::ssh::Type,
    pub format_sshurl: formatters::ssh_url::Type,
    pub format_https: formatters::https::Type,
    pub format_shortcut: formatters::shortcut::Type,
    pub format_git: formatters::git::Type,
    pub format_extract: formatters::extract::Type,
}

// PORT NOTE: `ExtractResult` corresponds to `Config.formatters.extract.Result`.
// Reshaped to use `Range<usize>` into `_owned_buffer` (see HostedGitInfo note).
pub struct ExtractResult {
    pub user: Option<Range<usize>>,
    pub project: Range<usize>,
    pub committish: Option<Range<usize>>,
    _owned_buffer: Option<Box<[u8]>>,
}

impl ExtractResult {
    // PORT NOTE: `deinit` → Drop; `Option<Box<[u8]>>` frees automatically.

    /// Return the buffer which owns this Result and the allocator responsible for
    /// freeing it.
    ///
    /// Same semantics as C++ STL. Safe-to-deinit Result after this, not safe to
    /// use it.
    fn move_out(&mut self) -> Box<[u8]> {
        let Some(buffer) = self._owned_buffer.take() else {
            panic!(
                "Cannot move an empty Result. This is a bug in Bun. Please \
                 report this issue on GitHub."
            );
        };
        buffer
    }
}

/// Encapsulates all the various foramtters that different hosts may have. Usually this has
/// to do with URLs, but could be other things.
pub mod formatters {
    use super::*;

    pub(super) fn requires_user(user: Option<&[u8]>) {
        if user.is_none() {
            panic!(
                "Attempted to format a default SSH URL without a user. This is an \
                 irrecoverable programming bug in Bun. Please report this issue \
                 on GitHub."
            );
        }
    }

    /// Mirrors hosts.js's sshtemplate
    pub mod ssh {
        use super::*;

        pub type Type = fn(
            self_: HostProvider,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError>;

        pub fn default(
            self_: HostProvider,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            requires_user(user);
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "git@{}:{}/{}.git{}{}",
                BStr::new(self_.domain()),
                BStr::new(user.unwrap()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }

        pub fn gist(
            self_: HostProvider,
            _user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "git@{}:{}.git{}{}",
                BStr::new(self_.domain()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }
    }

    /// Mirrors hosts.js's sshurltemplate
    pub mod ssh_url {
        use super::*;

        pub type Type = fn(
            self_: HostProvider,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError>;

        pub fn default(
            self_: HostProvider,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            requires_user(user);
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "git+ssh://git@{}/{}/{}.git{}{}",
                BStr::new(self_.domain()),
                BStr::new(user.unwrap()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }

        pub fn gist(
            self_: HostProvider,
            _user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "git+ssh://git@{}/{}.git{}{}",
                BStr::new(self_.domain()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }
    }

    /// Mirrors hosts.js's httpstemplate
    pub mod https {
        use super::*;

        pub type Type = fn(
            self_: HostProvider,
            auth: Option<&[u8]>,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError>;

        pub fn default(
            self_: HostProvider,
            auth: Option<&[u8]>,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            requires_user(user);

            let auth_str: &[u8] = auth.unwrap_or(b"");
            let auth_sep: &[u8] = if !auth_str.is_empty() { b"@" } else { b"" };
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "git+https://{}{}{}/{}/{}.git{}{}",
                BStr::new(auth_str),
                BStr::new(auth_sep),
                BStr::new(self_.domain()),
                BStr::new(user.unwrap()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }

        pub fn gist(
            self_: HostProvider,
            _auth: Option<&[u8]>,
            _user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "git+https://{}/{}.git{}{}",
                BStr::new(self_.domain()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }

        pub fn sourcehut(
            self_: HostProvider,
            _auth: Option<&[u8]>,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            requires_user(user);

            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "https://{}/{}/{}.git{}{}",
                BStr::new(self_.domain()),
                BStr::new(user.unwrap()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }
    }

    /// Mirrors hosts.js's shortcuttemplate
    pub mod shortcut {
        use super::*;

        pub type Type = fn(
            self_: HostProvider,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError>;

        pub fn default(
            self_: HostProvider,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            requires_user(user);

            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "{}{}/{}{}{}",
                BStr::new(self_.shortcut()),
                BStr::new(user.unwrap()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }

        pub fn gist(
            self_: HostProvider,
            _user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "{}{}{}{}",
                BStr::new(self_.shortcut()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }
    }

    /// Mirrors hosts.js's extract function
    pub mod extract {
        use super::*;

        pub type Type =
            fn(url: &JscUrl) -> Result<Option<ExtractResult>, HostedGitInfoError>;

        pub fn github(url: &JscUrl) -> Result<Option<ExtractResult>, HostedGitInfoError> {
            let pathname_owned = url.pathname().to_owned_slice()?;
            let pathname = strings::trim_prefix(&pathname_owned, b"/");

            let mut iter = pathname.split(|&b| b == b'/');
            let Some(user_part) = iter.next() else { return Ok(None); };
            let Some(project_part) = iter.next() else { return Ok(None); };
            let type_part = iter.next();
            let committish_part = iter.next();

            let project = strings::trim_suffix(project_part, b".git");

            if user_part.is_empty() || project.is_empty() {
                return Ok(None);
            }

            // If the type part says something other than "tree", we're not looking at a
            // github URL that we understand.
            if let Some(tp) = type_part {
                if tp != b"tree" {
                    return Ok(None);
                }
            }

            // PORT NOTE: in Zig the `committish` borrow from `fragment_utf8` is freed
            // before being copied into the StringBuilder. We hold the owned fragment
            // here to keep the borrow valid until copied.
            let fragment_utf8;
            let committish: Option<&[u8]> = if type_part.is_none() {
                let fragment_str = url.fragment_identifier();
                fragment_utf8 = fragment_str.to_utf8();
                let fragment = fragment_utf8.slice();
                if !fragment.is_empty() {
                    Some(fragment)
                } else {
                    None
                }
            } else {
                committish_part
            };

            let mut sb = StringBuilder::default();
            sb.count(user_part);
            sb.count(project);
            if let Some(c) = committish {
                sb.count(c);
            }

            sb.allocate()?;

            let user_slice = HostedGitInfo::decode_and_append(&mut sb, user_part)?;
            let project_slice = HostedGitInfo::decode_and_append(&mut sb, project)?;
            let committish_slice = match committish {
                Some(c) => Some(HostedGitInfo::decode_and_append(&mut sb, c)?),
                None => None,
            };

            Ok(Some(ExtractResult {
                user: Some(user_slice),
                project: project_slice,
                committish: committish_slice,
                _owned_buffer: Some(sb.allocated_slice()),
            }))
        }

        pub fn bitbucket(url: &JscUrl) -> Result<Option<ExtractResult>, HostedGitInfoError> {
            let pathname_owned = url.pathname().to_owned_slice()?;
            let pathname = strings::trim_prefix(&pathname_owned, b"/");

            let mut iter = pathname.split(|&b| b == b'/');
            let Some(user_part) = iter.next() else { return Ok(None); };
            let Some(project_part) = iter.next() else { return Ok(None); };
            let aux = iter.next();

            if let Some(a) = aux {
                if a == b"get" {
                    return Ok(None);
                }
            }

            let project = strings::trim_suffix(project_part, b".git");

            if user_part.is_empty() || project.is_empty() {
                return Ok(None);
            }

            let fragment_str = url.fragment_identifier();
            let fragment_utf8 = fragment_str.to_utf8();
            let fragment = fragment_utf8.slice();
            let committish: Option<&[u8]> =
                if !fragment.is_empty() { Some(fragment) } else { None };

            let mut sb = StringBuilder::default();
            sb.count(user_part);
            sb.count(project);
            if let Some(c) = committish {
                sb.count(c);
            }

            sb.allocate()?;

            let user_slice = HostedGitInfo::decode_and_append(&mut sb, user_part)?;
            let project_slice = HostedGitInfo::decode_and_append(&mut sb, project)?;
            let committish_slice = match committish {
                Some(c) => Some(HostedGitInfo::decode_and_append(&mut sb, c)?),
                None => None,
            };

            Ok(Some(ExtractResult {
                user: Some(user_slice),
                project: project_slice,
                committish: committish_slice,
                _owned_buffer: Some(sb.allocated_slice()),
            }))
        }

        pub fn gitlab(url: &JscUrl) -> Result<Option<ExtractResult>, HostedGitInfoError> {
            let pathname_owned = url.pathname().to_owned_slice()?;
            let pathname = strings::trim_prefix(&pathname_owned, b"/");

            if strings::index_of(pathname, b"/-/").is_some()
                || strings::index_of(pathname, b"/archive.tar.gz").is_some()
            {
                return Ok(None);
            }

            let Some(end_slash) = strings::last_index_of_char(pathname, b'/') else {
                return Ok(None);
            };
            let project_part = &pathname[end_slash + 1..];
            let user_part = &pathname[0..end_slash];

            let project = strings::trim_suffix(project_part, b".git");

            if user_part.is_empty() || project.is_empty() {
                return Ok(None);
            }

            let fragment_str = url.fragment_identifier();
            let fragment_utf8 = fragment_str.to_utf8();
            let committish = fragment_utf8.slice();

            let mut sb = StringBuilder::default();
            sb.count(user_part);
            sb.count(project);
            if !committish.is_empty() {
                sb.count(committish);
            }

            sb.allocate()?;

            let user_slice = HostedGitInfo::decode_and_append(&mut sb, user_part)?;
            let project_slice = HostedGitInfo::decode_and_append(&mut sb, project)?;
            let committish_slice = if !committish.is_empty() {
                let Ok(r) = HostedGitInfo::decode_and_append(&mut sb, committish) else {
                    return Ok(None);
                };
                Some(r)
            } else {
                None
            };

            Ok(Some(ExtractResult {
                user: Some(user_slice),
                project: project_slice,
                committish: committish_slice,
                _owned_buffer: Some(sb.allocated_slice()),
            }))
        }

        pub fn gist(url: &JscUrl) -> Result<Option<ExtractResult>, HostedGitInfoError> {
            let pathname_owned = url.pathname().to_owned_slice()?;
            let pathname = strings::trim_prefix(&pathname_owned, b"/");

            let mut iter = pathname.split(|&b| b == b'/');
            let Some(mut user_part) = iter.next() else { return Ok(None); };
            let mut project_part = iter.next();
            let aux = iter.next();

            if let Some(a) = aux {
                if a == b"raw" {
                    return Ok(None);
                }
            }

            if project_part.is_none() || project_part.unwrap().is_empty() {
                project_part = Some(user_part);
                user_part = b"";
            }

            let project = strings::trim_suffix(project_part.unwrap(), b".git");
            let user: Option<&[u8]> = if !user_part.is_empty() { Some(user_part) } else { None };

            if project.is_empty() {
                return Ok(None);
            }

            let fragment_str = url.fragment_identifier();
            let fragment_utf8 = fragment_str.to_utf8();
            let fragment = fragment_utf8.slice();
            let committish: Option<&[u8]> =
                if !fragment.is_empty() { Some(fragment) } else { None };

            let mut sb = StringBuilder::default();
            if let Some(u) = user {
                sb.count(u);
            }
            sb.count(project);
            if let Some(c) = committish {
                sb.count(c);
            }

            let Ok(()) = sb.allocate() else { return Ok(None); };

            let user_slice = match user {
                Some(u) => {
                    let Ok(r) = HostedGitInfo::decode_and_append(&mut sb, u) else {
                        return Ok(None);
                    };
                    Some(r)
                }
                None => None,
            };
            let Ok(project_slice) = HostedGitInfo::decode_and_append(&mut sb, project) else {
                return Ok(None);
            };
            let committish_slice = match committish {
                Some(c) => {
                    let Ok(r) = HostedGitInfo::decode_and_append(&mut sb, c) else {
                        return Ok(None);
                    };
                    Some(r)
                }
                None => None,
            };

            Ok(Some(ExtractResult {
                user: user_slice,
                project: project_slice,
                committish: committish_slice,
                _owned_buffer: Some(sb.allocated_slice()),
            }))
        }

        pub fn sourcehut(url: &JscUrl) -> Result<Option<ExtractResult>, HostedGitInfoError> {
            let pathname_owned = url.pathname().to_owned_slice()?;
            let pathname = strings::trim_prefix(&pathname_owned, b"/");

            let mut iter = pathname.split(|&b| b == b'/');
            let Some(user_part) = iter.next() else { return Ok(None); };
            let Some(project_part) = iter.next() else { return Ok(None); };
            let aux = iter.next();

            if let Some(a) = aux {
                if a == b"archive" {
                    return Ok(None);
                }
            }

            let project = strings::trim_suffix(project_part, b".git");

            if user_part.is_empty() || project.is_empty() {
                return Ok(None);
            }

            let fragment_str = url.fragment_identifier();
            let fragment_utf8 = fragment_str.to_utf8();
            let fragment = fragment_utf8.slice();
            let committish: Option<&[u8]> =
                if !fragment.is_empty() { Some(fragment) } else { None };

            let mut sb = StringBuilder::default();
            sb.count(user_part);
            sb.count(project);
            if let Some(c) = committish {
                sb.count(c);
            }

            let Ok(()) = sb.allocate() else { return Ok(None); };

            // PORT NOTE: Zig inlines PercentEncoding.decode here instead of calling
            // decodeAndAppend (returns null instead of erroring on decode failure).
            let user_slice = 'blk: {
                let start = sb.len;
                let writable = sb.writable();
                let Ok(decoded_len) = PercentEncoding::decode_into(writable, user_part) else {
                    return Ok(None);
                };
                sb.len += decoded_len;
                break 'blk start..start + decoded_len;
            };
            let project_slice = 'blk: {
                let start = sb.len;
                let writable = sb.writable();
                let Ok(decoded_len) = PercentEncoding::decode_into(writable, project) else {
                    return Ok(None);
                };
                sb.len += decoded_len;
                break 'blk start..start + decoded_len;
            };
            let committish_slice = if let Some(c) = committish {
                let start = sb.len;
                let writable = sb.writable();
                let Ok(decoded_len) = PercentEncoding::decode_into(writable, c) else {
                    return Ok(None);
                };
                sb.len += decoded_len;
                Some(start..start + decoded_len)
            } else {
                None
            };

            Ok(Some(ExtractResult {
                user: Some(user_slice),
                project: project_slice,
                committish: committish_slice,
                _owned_buffer: Some(sb.allocated_slice()),
            }))
        }
    }

    /// Mirrors hosts.js's gittemplate
    pub mod git {
        use super::*;

        pub type Type = Option<
            fn(
                self_: HostProvider,
                auth: Option<&[u8]>,
                user: Option<&[u8]>,
                project: &[u8],
                committish: Option<&[u8]>,
            ) -> Result<Vec<u8>, AllocError>,
        >;

        pub const DEFAULT: Type = None;

        pub fn github(
            self_: HostProvider,
            auth: Option<&[u8]>,
            user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            requires_user(user);

            let auth_str: &[u8] = auth.unwrap_or(b"");
            let auth_sep: &[u8] = if !auth_str.is_empty() { b"@" } else { b"" };
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "git://{}{}{}/{}/{}.git{}{}",
                BStr::new(auth_str),
                BStr::new(auth_sep),
                BStr::new(self_.domain()),
                BStr::new(user.unwrap()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }

        pub fn gist(
            self_: HostProvider,
            _auth: Option<&[u8]>,
            _user: Option<&[u8]>,
            project: &[u8],
            committish: Option<&[u8]>,
        ) -> Result<Vec<u8>, AllocError> {
            let cmsh: &[u8] = committish.unwrap_or(b"");
            let cmsh_sep: &[u8] = if !cmsh.is_empty() { b"#" } else { b"" };

            let mut v = Vec::new();
            write!(
                &mut v,
                "git://{}/{}.git{}{}",
                BStr::new(self_.domain()),
                BStr::new(project),
                BStr::new(cmsh_sep),
                BStr::new(cmsh),
            )
            .map_err(|_| AllocError)?;
            Ok(v)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// configs (std.enums.EnumArray)
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): `std.enums.EnumArray(Self, Config).init(.{...})` is a const dense
// array indexed by enum. `enum_map::EnumMap` can't be const-initialized with fn
// pointers easily; using a `once_cell`/`LazyLock` static here. Phase B may
// flatten this into a `match`-based accessor for zero overhead.
fn configs() -> &'static EnumMap<HostProvider, Config> {
    use std::sync::OnceLock;
    static CONFIGS: OnceLock<EnumMap<HostProvider, Config>> = OnceLock::new();
    CONFIGS.get_or_init(|| {
        enum_map! {
            HostProvider::Bitbucket => Config {
                protocols: &[
                    WellDefinedProtocol::GitPlusHttp,
                    WellDefinedProtocol::GitPlusHttps,
                    WellDefinedProtocol::Ssh,
                    WellDefinedProtocol::Https,
                ],
                domain: b"bitbucket.org",
                shortcut: b"bitbucket:",
                tree_path: Some(b"src"),
                blob_path: Some(b"src"),
                edit_path: Some(b"?mode=edit"),
                format_ssh: formatters::ssh::default,
                format_sshurl: formatters::ssh_url::default,
                format_https: formatters::https::default,
                format_shortcut: formatters::shortcut::default,
                format_git: formatters::git::DEFAULT,
                format_extract: formatters::extract::bitbucket,
            },
            HostProvider::Gist => Config {
                protocols: &[
                    WellDefinedProtocol::Git,
                    WellDefinedProtocol::GitPlusSsh,
                    WellDefinedProtocol::GitPlusHttps,
                    WellDefinedProtocol::Ssh,
                    WellDefinedProtocol::Https,
                ],
                domain: b"gist.github.com",
                shortcut: b"gist:",
                tree_path: None,
                blob_path: None,
                edit_path: Some(b"edit"),
                format_ssh: formatters::ssh::gist,
                format_sshurl: formatters::ssh_url::gist,
                format_https: formatters::https::gist,
                format_shortcut: formatters::shortcut::gist,
                format_git: Some(formatters::git::gist),
                format_extract: formatters::extract::gist,
            },
            HostProvider::Github => Config {
                protocols: &[
                    WellDefinedProtocol::Git,
                    WellDefinedProtocol::Http,
                    WellDefinedProtocol::GitPlusSsh,
                    WellDefinedProtocol::GitPlusHttps,
                    WellDefinedProtocol::Ssh,
                    WellDefinedProtocol::Https,
                ],
                domain: b"github.com",
                shortcut: b"github:",
                tree_path: Some(b"tree"),
                blob_path: Some(b"blob"),
                edit_path: Some(b"edit"),
                format_ssh: formatters::ssh::default,
                format_sshurl: formatters::ssh_url::default,
                format_https: formatters::https::default,
                format_shortcut: formatters::shortcut::default,
                format_git: Some(formatters::git::github),
                format_extract: formatters::extract::github,
            },
            HostProvider::Gitlab => Config {
                protocols: &[
                    WellDefinedProtocol::GitPlusSsh,
                    WellDefinedProtocol::GitPlusHttps,
                    WellDefinedProtocol::Ssh,
                    WellDefinedProtocol::Https,
                ],
                domain: b"gitlab.com",
                shortcut: b"gitlab:",
                tree_path: Some(b"tree"),
                blob_path: Some(b"tree"),
                edit_path: Some(b"-/edit"),
                format_ssh: formatters::ssh::default,
                format_sshurl: formatters::ssh_url::default,
                format_https: formatters::https::default,
                format_shortcut: formatters::shortcut::default,
                format_git: formatters::git::DEFAULT,
                format_extract: formatters::extract::gitlab,
            },
            HostProvider::Sourcehut => Config {
                protocols: &[
                    WellDefinedProtocol::GitPlusSsh,
                    WellDefinedProtocol::Https,
                ],
                domain: b"git.sr.ht",
                shortcut: b"sourcehut:",
                tree_path: Some(b"tree"),
                blob_path: Some(b"tree"),
                edit_path: None,
                format_ssh: formatters::ssh::default,
                format_sshurl: formatters::ssh_url::default,
                format_https: formatters::https::sourcehut,
                format_shortcut: formatters::shortcut::default,
                format_git: formatters::git::DEFAULT,
                format_extract: formatters::extract::sourcehut,
            },
        }
    })
}

// ──────────────────────────────────────────────────────────────────────────
// TestingAPIs
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: `pub const X = @import("../install_jsc/...")` aliases deleted —
// `js_parse_url` / `js_from_url` live in `bun_install_jsc` as extension methods.
pub mod testing_apis {
    // TODO(port): move to *_jsc — these were re-exports of jsc-layer fns.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/hosted_git_info.zig (1652 lines)
//   confidence: medium
//   todos:      6
//   notes:      Self-referential slices reshaped to Range<usize> into owned buffer; UrlProtocol/UrlProtocolPair carry <'a> (BORROW_PARAM); StringBuilder/PercentEncoding/JscUrl APIs assumed — verify shapes in Phase B; nested `StringPair` struct inside impl is invalid Rust, hoist in Phase B.
// ──────────────────────────────────────────────────────────────────────────
