//! The AWS default credential provider chain:
//!
//!   1. environment (`AWS_ACCESS_KEY_ID` …)
//!   2. the shared config/credentials files for the selected profile — static
//!      keys, `role_arn` + `source_profile`/`credential_source` (STS
//!      AssumeRole), `web_identity_token_file`, `credential_process`, SSO
//!   3. `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` (EKS IRSA)
//!   4. container credentials (`AWS_CONTAINER_CREDENTIALS_{RELATIVE,FULL}_URI`
//!      — ECS, EKS Pod Identity, and anything else speaking that protocol)
//!   5. EC2 instance metadata (IMDSv2, v1 fallback)
//!
//! A source that is *not configured* is skipped with a note; a source that
//! is configured but *fails* stops the chain with that error, so a broken
//! IRSA/SSO setup does not silently fall through to the node's instance role.
//!
//! Written as straight-line `async` code; every network round-trip and the
//! `credential_process` spawn go through [`Io`], which `provider.rs` drives
//! from the JS thread without blocking it. File reads (a few small dotfiles)
//! are done inline.

use std::io::Write as _;

use bstr::BStr;
use bun_core::strings;
use bun_http::Method;
use bun_s3_signing::sigv4;
use bun_s3_signing::{AwsCredentials, CredentialsSource, ProviderError};
use bun_sys::{Fd, File};

use super::config::ChainConfig;
use super::ini::{IniFile, Profile, SectionKind};
use crate::webcore::cloud::form_encode;
use crate::webcore::cloud::io::{
    ChainFuture, HttpError, HttpRequest, HttpResponse, Io, SpawnRequest,
};
use crate::webcore::cloud::json;
use crate::webcore::s3::xml_response;

type Outcome = Result<Option<AwsCredentials>, ProviderError>;
pub type ChainResult = Result<AwsCredentials, ProviderError>;

const MAX_PROFILE_DEPTH: usize = 8;
const STS_TIMEOUT_MS: u32 = 30_000;

pub fn resolve(cfg: ChainConfig, io: Io) -> ChainFuture<ChainResult> {
    Box::pin(async move {
        let mut r = Resolver {
            cfg,
            io,
            config: None,
            credentials: None,
            notes: Vec::new(),
        };
        let c = r.run().await?;
        if let Some(exp) = c.expiration
            && exp <= now_secs() + AwsCredentials::EXPIRY_MARGIN_SECONDS
        {
            let at = sigv4::amz_datetime(exp);
            return Err(err(
                "ERR_AWS_CREDENTIALS",
                format_args!(
                    "credentials from {} were already expired when they arrived (Expiration {}); check this machine's clock",
                    c.source.as_str(),
                    BStr::new(&at)
                ),
            ));
        }
        Ok(c)
    })
}

struct Resolver {
    cfg: ChainConfig,
    io: Io,
    config: Option<IniFile>,
    credentials: Option<IniFile>,
    /// Why each skipped source was skipped, for the final "nothing found" error.
    notes: Vec<u8>,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn err(code: &'static str, args: core::fmt::Arguments<'_>) -> ProviderError {
    let mut v = Vec::new();
    let _ = v.write_fmt(args);
    ProviderError::new(code, v)
}

macro_rules! fail {
    ($($arg:tt)*) => { err("ERR_AWS_CREDENTIALS", format_args!($($arg)*)) };
}

fn creds(
    access_key_id: Box<[u8]>,
    secret_access_key: Box<[u8]>,
    session_token: Option<Box<[u8]>>,
    expiration: Option<u64>,
    account_id: Option<Box<[u8]>>,
    source: CredentialsSource,
) -> AwsCredentials {
    AwsCredentials {
        access_key_id,
        secret_access_key,
        session_token: session_token.unwrap_or_default(),
        expiration,
        account_id,
        region: None,
        source,
    }
}

/// `sts`, `portal.sso`, `oidc` hosts by partition.
pub fn dns_suffix(region: &[u8]) -> &'static str {
    if region.starts_with(b"cn-") {
        "amazonaws.com.cn"
    } else if region.starts_with(b"us-iso-") {
        "c2s.ic.gov"
    } else if region.starts_with(b"us-isob-") {
        "sc2s.sgov.gov"
    } else if region.starts_with(b"eu-isoe-") {
        "cloud.adc-e.uk"
    } else if region.starts_with(b"us-isof-") {
        "csp.hci.ic.gov"
    } else {
        "amazonaws.com"
    }
}

fn is_valid_region(region: &[u8]) -> bool {
    !region.is_empty()
        && region.len() <= 32
        && region
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn snippet(body: &[u8]) -> &BStr {
    let body = body.trim_ascii();
    BStr::new(&body[..body.len().min(240)])
}

impl Resolver {
    fn note(&mut self, args: core::fmt::Arguments<'_>) {
        if !self.notes.is_empty() {
            self.notes.extend_from_slice(b"; ");
        }
        let _ = self.notes.write_fmt(args);
    }

    /// One round-trip on the HTTP thread, through the configured proxy if any.
    async fn http(&self, mut req: HttpRequest, proxied: bool) -> Result<HttpResponse, HttpError> {
        if proxied {
            req.proxy_url = self.cfg.proxy_for(&req.url).map(Box::from);
        }
        self.io.http(req).await
    }

    async fn run(&mut self) -> ChainResult {
        if let Some(c) = self.from_env()? {
            return Ok(c);
        }
        let profile = self.cfg.effective_profile().to_vec();
        let mut visited: Vec<Box<[u8]>> = Vec::new();
        if let Some(mut c) = self.from_profile(&profile, &mut visited, 0).await? {
            if c.region.is_none() {
                c.region = self
                    .profile_region(&profile)
                    .or_else(|| self.cfg.region.clone());
            }
            return Ok(c);
        }
        if let Some(mut c) = self.from_web_identity_env().await? {
            c.region = self
                .cfg
                .region
                .clone()
                .or_else(|| self.profile_region(&profile));
            return Ok(c);
        }
        if let Some(mut c) = self.from_container().await? {
            c.region = self
                .cfg
                .region
                .clone()
                .or_else(|| self.profile_region(&profile));
            return Ok(c);
        }
        if let Some(mut c) = self.from_imds().await? {
            c.region = self
                .cfg
                .region
                .clone()
                .or_else(|| self.profile_region(&profile));
            return Ok(c);
        }
        Err(err(
            "ERR_AWS_MISSING_CREDENTIALS",
            format_args!(
                "Could not find AWS credentials in any source: {}",
                BStr::new(&self.notes)
            ),
        ))
    }

    // ── 1. environment ────────────────────────────────────────────────────

    fn from_env(&mut self) -> Outcome {
        if self.cfg.profile_is_explicit() {
            self.note(format_args!(
                "environment (skipped because a profile is selected)"
            ));
            return Ok(None);
        }
        match self.env_static() {
            Some(c) => Ok(Some(c)),
            None => {
                self.note(format_args!(
                    "environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set)"
                ));
                Ok(None)
            }
        }
    }

    fn env_static(&self) -> Option<AwsCredentials> {
        let (Some(akid), Some(secret)) = (&self.cfg.access_key_id, &self.cfg.secret_access_key)
        else {
            return None;
        };
        let mut c = creds(
            akid.clone(),
            secret.clone(),
            self.cfg.session_token.clone(),
            None,
            self.cfg.account_id.clone(),
            CredentialsSource::Env,
        );
        c.region.clone_from(&self.cfg.region);
        Some(c)
    }

    // ── 2. shared config / credentials files ──────────────────────────────

    fn load_files(&mut self) {
        if self.config.is_some() {
            return;
        }
        let read = |path: Option<Vec<u8>>, is_config: bool| -> IniFile {
            match path {
                Some(p) => match File::read_from(Fd::cwd(), &p) {
                    Ok(bytes) => IniFile::parse(&bytes, is_config),
                    Err(_) => IniFile::default(),
                },
                None => IniFile::default(),
            }
        };
        self.config = Some(read(self.cfg.config_file_path(), true));
        self.credentials = Some(read(self.cfg.credentials_file_path(), false));
    }

    fn profile(&mut self, name: &[u8]) -> Option<Profile<'_>> {
        self.load_files();
        Profile::lookup(
            name,
            self.credentials.as_ref().unwrap(),
            self.config.as_ref().unwrap(),
        )
    }

    fn profile_region(&mut self, name: &[u8]) -> Option<Box<[u8]>> {
        self.profile(name)
            .and_then(|p| p.get(b"region").map(Box::from))
    }

    /// Boxed because `source_profile` makes it recursive.
    fn from_profile<'a>(
        &'a mut self,
        name: &'a [u8],
        visited: &'a mut Vec<Box<[u8]>>,
        depth: usize,
    ) -> core::pin::Pin<Box<dyn core::future::Future<Output = Outcome> + 'a>> {
        Box::pin(self.from_profile_inner(name, visited, depth))
    }

    async fn from_profile_inner(
        &mut self,
        name: &[u8],
        visited: &mut Vec<Box<[u8]>>,
        depth: usize,
    ) -> Outcome {
        if depth >= MAX_PROFILE_DEPTH {
            return Err(fail!(
                "profile \"{}\": source_profile chain is too deep",
                BStr::new(name)
            ));
        }
        if visited.iter().any(|v| &**v == name) {
            return Err(fail!(
                "profile \"{}\": source_profile chain loops back on itself",
                BStr::new(name)
            ));
        }
        visited.push(Box::from(name));

        let explicit = depth > 0 || self.cfg.profile.is_some();
        // Copy out what we need so `self` is free for the network calls below.
        struct P {
            access_key_id: Option<Box<[u8]>>,
            secret_access_key: Option<Box<[u8]>>,
            session_token: Option<Box<[u8]>>,
            account_id: Option<Box<[u8]>>,
            role_arn: Option<Box<[u8]>>,
            source_profile: Option<Box<[u8]>>,
            credential_source: Option<Box<[u8]>>,
            role_session_name: Option<Box<[u8]>>,
            external_id: Option<Box<[u8]>>,
            duration_seconds: Option<Box<[u8]>>,
            mfa_serial: Option<Box<[u8]>>,
            web_identity_token_file: Option<Box<[u8]>>,
            credential_process: Option<Box<[u8]>>,
            sso_session: Option<Box<[u8]>>,
            sso_start_url: Option<Box<[u8]>>,
            sso_region: Option<Box<[u8]>>,
            sso_account_id: Option<Box<[u8]>>,
            sso_role_name: Option<Box<[u8]>>,
            region: Option<Box<[u8]>>,
        }
        let config_path = self.cfg.config_file_path();
        let credentials_path = self.cfg.credentials_file_path();
        let p = match self.profile(name) {
            Some(p) => {
                let g = |k: &[u8]| p.get(k).map(Box::from);
                P {
                    access_key_id: g(b"aws_access_key_id"),
                    secret_access_key: g(b"aws_secret_access_key"),
                    session_token: g(b"aws_session_token"),
                    account_id: g(b"aws_account_id"),
                    role_arn: g(b"role_arn"),
                    source_profile: g(b"source_profile"),
                    credential_source: g(b"credential_source"),
                    role_session_name: g(b"role_session_name"),
                    external_id: g(b"external_id"),
                    duration_seconds: g(b"duration_seconds"),
                    mfa_serial: g(b"mfa_serial"),
                    web_identity_token_file: g(b"web_identity_token_file"),
                    credential_process: g(b"credential_process"),
                    sso_session: g(b"sso_session"),
                    sso_start_url: g(b"sso_start_url"),
                    sso_region: g(b"sso_region"),
                    sso_account_id: g(b"sso_account_id"),
                    sso_role_name: g(b"sso_role_name"),
                    region: g(b"region"),
                }
            }
            None => {
                if explicit {
                    return Err(fail!(
                        "profile \"{}\" was not found in {} or {}",
                        BStr::new(name),
                        BStr::new(credentials_path.as_deref().unwrap_or(b"~/.aws/credentials")),
                        BStr::new(config_path.as_deref().unwrap_or(b"~/.aws/config")),
                    ));
                }
                self.note(format_args!(
                    "profile \"{}\" (not found in {} or {})",
                    BStr::new(name),
                    BStr::new(credentials_path.as_deref().unwrap_or(b"~/.aws/credentials")),
                    BStr::new(config_path.as_deref().unwrap_or(b"~/.aws/config")),
                ));
                return Ok(None);
            }
        };

        // (a) assume role via source_profile / credential_source
        if let Some(role_arn) = &p.role_arn
            && (p.source_profile.is_some() || p.credential_source.is_some())
        {
            if p.mfa_serial.is_some() {
                return Err(fail!(
                    "profile \"{}\": mfa_serial requires an interactive MFA prompt, which is not supported",
                    BStr::new(name)
                ));
            }
            let source = if let Some(src) = &p.source_profile {
                if &**src == name {
                    // Self-referencing source_profile means "use my own static keys".
                    match (&p.access_key_id, &p.secret_access_key) {
                        (Some(a), Some(s)) => creds(
                            a.clone(),
                            s.clone(),
                            p.session_token.clone(),
                            None,
                            None,
                            CredentialsSource::Profile,
                        ),
                        _ => {
                            return Err(fail!(
                                "profile \"{}\": source_profile points at itself but has no static credentials",
                                BStr::new(name)
                            ));
                        }
                    }
                } else {
                    match self.from_profile(src, visited, depth + 1).await? {
                        Some(c) => c,
                        None => {
                            return Err(fail!(
                                "profile \"{}\": source_profile \"{}\" did not yield credentials",
                                BStr::new(name),
                                BStr::new(src)
                            ));
                        }
                    }
                }
            } else {
                let cs = p.credential_source.as_deref().unwrap();
                let got = if cs.eq_ignore_ascii_case(b"Environment") {
                    self.env_static()
                } else if cs.eq_ignore_ascii_case(b"Ec2InstanceMetadata") {
                    self.from_imds().await?
                } else if cs.eq_ignore_ascii_case(b"EcsContainer") {
                    self.from_container().await?
                } else {
                    return Err(fail!(
                        "profile \"{}\": unsupported credential_source \"{}\" (expected Environment, Ec2InstanceMetadata or EcsContainer)",
                        BStr::new(name),
                        BStr::new(cs)
                    ));
                };
                match got {
                    Some(c) => c,
                    None => {
                        return Err(fail!(
                            "profile \"{}\": credential_source {} did not yield credentials",
                            BStr::new(name),
                            BStr::new(cs)
                        ));
                    }
                }
            };
            let region = p.region.clone().or_else(|| self.cfg.region.clone());
            let mut c = self
                .assume_role(
                    name,
                    &source,
                    role_arn,
                    p.role_session_name.as_deref(),
                    p.external_id.as_deref(),
                    p.duration_seconds.as_deref(),
                    region.as_deref(),
                )
                .await?;
            c.region.clone_from(&p.region);
            return Ok(Some(c));
        }

        // (b) static keys
        if let (Some(a), Some(s)) = (&p.access_key_id, &p.secret_access_key) {
            let mut c = creds(
                a.clone(),
                s.clone(),
                p.session_token.clone(),
                None,
                p.account_id.clone(),
                CredentialsSource::Profile,
            );
            c.region.clone_from(&p.region);
            return Ok(Some(c));
        }

        // (c) web identity token file
        if let (Some(token_file), Some(role_arn)) = (&p.web_identity_token_file, &p.role_arn) {
            let region = p.region.clone().or_else(|| self.cfg.region.clone());
            let token_file = self.cfg.expand_home(token_file);
            let mut c = self
                .assume_role_with_web_identity(
                    &token_file,
                    role_arn,
                    p.role_session_name.as_deref(),
                    region.as_deref(),
                )
                .await?;
            c.region.clone_from(&p.region);
            return Ok(Some(c));
        }

        // (d) credential_process
        if let Some(cmd) = &p.credential_process {
            let mut c = self.from_process(name, cmd).await?;
            c.region.clone_from(&p.region);
            return Ok(Some(c));
        }

        // (e) SSO
        if p.sso_account_id.is_some()
            || p.sso_role_name.is_some()
            || p.sso_session.is_some()
            || p.sso_start_url.is_some()
        {
            let (Some(account_id), Some(role_name)) = (&p.sso_account_id, &p.sso_role_name) else {
                return Err(fail!(
                    "profile \"{}\": SSO profiles need both sso_account_id and sso_role_name",
                    BStr::new(name)
                ));
            };
            let (start_url, sso_region, session_name) = if let Some(session) = &p.sso_session {
                self.load_files();
                let cfg = self.config.as_ref().unwrap();
                let Some(sec) = cfg.section(SectionKind::SsoSession, session) else {
                    return Err(fail!(
                        "profile \"{}\": sso_session \"{}\" has no [sso-session {}] section in {}",
                        BStr::new(name),
                        BStr::new(session),
                        BStr::new(session),
                        BStr::new(config_path.as_deref().unwrap_or(b"~/.aws/config")),
                    ));
                };
                let (Some(u), Some(r)) = (sec.get(b"sso_start_url"), sec.get(b"sso_region")) else {
                    return Err(fail!(
                        "[sso-session {}] needs sso_start_url and sso_region",
                        BStr::new(session)
                    ));
                };
                (
                    Box::<[u8]>::from(u),
                    Box::<[u8]>::from(r),
                    Some(session.clone()),
                )
            } else {
                let (Some(u), Some(r)) = (&p.sso_start_url, &p.sso_region) else {
                    return Err(fail!(
                        "profile \"{}\": legacy SSO profiles need sso_start_url and sso_region",
                        BStr::new(name)
                    ));
                };
                (u.clone(), r.clone(), None)
            };
            let mut c = self
                .from_sso(
                    name,
                    &start_url,
                    &sso_region,
                    session_name.as_deref(),
                    account_id,
                    role_name,
                )
                .await?;
            c.region.clone_from(&p.region);
            return Ok(Some(c));
        }

        if p.role_arn.is_some() {
            return Err(fail!(
                "profile \"{}\" has role_arn but no source_profile, credential_source or web_identity_token_file",
                BStr::new(name)
            ));
        }
        if explicit {
            return Err(fail!(
                "profile \"{}\" does not contain credentials (expected aws_access_key_id/aws_secret_access_key, role_arn, credential_process, web_identity_token_file or sso_*)",
                BStr::new(name)
            ));
        }
        self.note(format_args!(
            "profile \"{}\" (has no credential settings)",
            BStr::new(name)
        ));
        Ok(None)
    }

    // ── STS ───────────────────────────────────────────────────────────────

    fn sts_endpoint(&self, region: Option<&[u8]>) -> Result<(Vec<u8>, Box<[u8]>), ProviderError> {
        let region: &[u8] = region.filter(|r| !r.is_empty()).unwrap_or(b"us-east-1");
        if !is_valid_region(region) {
            return Err(fail!("invalid AWS region \"{}\"", BStr::new(region)));
        }
        if let Some(ep) = &self.cfg.endpoint_url_sts {
            let mut url = strings::trim_right(ep, b"/").to_vec();
            url.push(b'/');
            return Ok((url, Box::from(region)));
        }
        let mut url = Vec::with_capacity(48);
        if self.cfg.sts_regional_endpoints_legacy && dns_suffix(region) == "amazonaws.com" {
            url.extend_from_slice(b"https://sts.amazonaws.com/");
            return Ok((url, Box::from(b"us-east-1".as_slice())));
        }
        let _ = write!(
            &mut url,
            "https://sts.{}.{}/",
            BStr::new(region),
            dns_suffix(region)
        );
        Ok((url, Box::from(region)))
    }

    fn default_session_name() -> Vec<u8> {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("bun-{ms}").into_bytes()
    }

    fn sts_credentials_from_xml(
        &self,
        what: &str,
        status: u32,
        body: &[u8],
        result_el: &[u8],
        source: CredentialsSource,
    ) -> Result<AwsCredentials, ProviderError> {
        if status != 200 {
            let (code, message) = xml_response::parse(body, |root| {
                // <ErrorResponse><Error><Code/><Message/></Error></ErrorResponse>
                let e = root.child(b"Error").unwrap_or(root);
                (
                    e.child_nonempty_text(b"Code"),
                    e.child_nonempty_text(b"Message"),
                )
            })
            .unwrap_or((None, None));
            return Err(fail!(
                "{what} failed with HTTP {status}: {} {}",
                BStr::new(code.as_deref().unwrap_or(b"")),
                BStr::new(
                    message
                        .as_deref()
                        .unwrap_or_else(|| &body[..body.len().min(240)])
                ),
            ));
        }
        let parsed = xml_response::parse(body, |root| {
            let c = root.child(result_el)?.child(b"Credentials")?;
            Some((
                c.child_nonempty_text(b"AccessKeyId")?,
                c.child_nonempty_text(b"SecretAccessKey")?,
                c.child_nonempty_text(b"SessionToken")?,
                c.child_nonempty_text(b"Expiration"),
            ))
        })
        .flatten();
        let Some((akid, secret, token, expiration)) = parsed else {
            return Err(fail!(
                "{what} returned an unexpected response: {}",
                snippet(body)
            ));
        };
        Ok(creds(
            akid,
            secret,
            Some(token),
            expiration.as_deref().and_then(sigv4::parse_iso8601),
            None,
            source,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    async fn assume_role(
        &self,
        profile: &[u8],
        source: &AwsCredentials,
        role_arn: &[u8],
        session_name: Option<&[u8]>,
        external_id: Option<&[u8]>,
        duration_seconds: Option<&[u8]>,
        region: Option<&[u8]>,
    ) -> Result<AwsCredentials, ProviderError> {
        let (url, region) = self.sts_endpoint(region)?;
        let default_name = Self::default_session_name();
        let mut body = Vec::with_capacity(256);
        let mut pairs: Vec<(&[u8], &[u8])> = vec![
            (b"Action", b"AssumeRole"),
            (b"Version", b"2011-06-15"),
            (b"RoleArn", role_arn),
            (b"RoleSessionName", session_name.unwrap_or(&default_name)),
        ];
        if let Some(e) = external_id {
            pairs.push((b"ExternalId", e));
        }
        if let Some(d) = duration_seconds {
            pairs.push((b"DurationSeconds", d));
        }
        form_encode(&mut body, &pairs);

        let parsed = bun_url::URL::parse(&url);
        let host = parsed.host;
        let signed = sigv4::sign(
            &source.sigv4(),
            &sigv4::Request {
                method: b"POST",
                host,
                path: parsed.raw_pathname(),
                query: b"",
                headers: &[(
                    b"content-type",
                    b"application/x-www-form-urlencoded; charset=utf-8",
                )],
                payload: sigv4::Payload::Bytes(&body),
                scope: sigv4::Scope {
                    service: b"sts",
                    region: &region,
                },
                datetime: None,
                s3_path_semantics: Some(false),
            },
        )
        .map_err(|e| {
            fail!(
                "profile \"{}\": could not sign STS AssumeRole request: {e:?}",
                BStr::new(profile)
            )
        })?;

        let mut req = HttpRequest::post(url.clone(), body)
            .header(
                b"content-type",
                b"application/x-www-form-urlencoded; charset=utf-8",
            )
            .header(b"authorization", &signed.authorization)
            .header(b"x-amz-date", &signed.amz_date)
            .header(b"accept", b"application/xml")
            .timeout(STS_TIMEOUT_MS);
        if let Some(t) = source.session_token() {
            req = req.header(b"x-amz-security-token", t);
        }
        let res = self.http(req, true).await.map_err(|e| {
            fail!(
                "profile \"{}\": STS AssumeRole request to {} failed: {e}",
                BStr::new(profile),
                BStr::new(&url)
            )
        })?;
        self.sts_credentials_from_xml(
            "STS AssumeRole",
            res.status,
            &res.body,
            b"AssumeRoleResult",
            CredentialsSource::AssumeRole,
        )
    }

    async fn assume_role_with_web_identity(
        &self,
        token_file: &[u8],
        role_arn: &[u8],
        session_name: Option<&[u8]>,
        region: Option<&[u8]>,
    ) -> Result<AwsCredentials, ProviderError> {
        let token = File::read_from(Fd::cwd(), token_file).map_err(|e| {
            fail!(
                "could not read web identity token file {}: {}",
                BStr::new(token_file),
                BStr::new(e.name())
            )
        })?;
        let token = token.trim_ascii();
        if token.is_empty() {
            return Err(fail!(
                "web identity token file {} is empty",
                BStr::new(token_file)
            ));
        }
        let (url, _region) = self.sts_endpoint(region)?;
        let default_name = self
            .cfg
            .role_session_name
            .as_deref()
            .map(<[u8]>::to_vec)
            .unwrap_or_else(Self::default_session_name);
        let mut body = Vec::with_capacity(512 + token.len());
        form_encode(
            &mut body,
            &[
                (b"Action", b"AssumeRoleWithWebIdentity"),
                (b"Version", b"2011-06-15"),
                (b"RoleArn", role_arn),
                (b"RoleSessionName", session_name.unwrap_or(&default_name)),
                (b"WebIdentityToken", token),
            ],
        );
        let req = HttpRequest::post(url.clone(), body)
            .header(
                b"content-type",
                b"application/x-www-form-urlencoded; charset=utf-8",
            )
            .header(b"accept", b"application/xml")
            .timeout(STS_TIMEOUT_MS);
        let res = self.http(req, true).await.map_err(|e| {
            fail!(
                "STS AssumeRoleWithWebIdentity request to {} failed: {e}",
                BStr::new(&url)
            )
        })?;
        self.sts_credentials_from_xml(
            "STS AssumeRoleWithWebIdentity",
            res.status,
            &res.body,
            b"AssumeRoleWithWebIdentityResult",
            CredentialsSource::WebIdentity,
        )
    }

    // ── 3. web identity from env (IRSA) ───────────────────────────────────

    async fn from_web_identity_env(&mut self) -> Outcome {
        let (Some(file), Some(role)) = (
            self.cfg.web_identity_token_file.clone(),
            self.cfg.role_arn.clone(),
        ) else {
            self.note(format_args!(
                "web identity (AWS_WEB_IDENTITY_TOKEN_FILE / AWS_ROLE_ARN not set)"
            ));
            return Ok(None);
        };
        let region = self.cfg.region.clone();
        self.assume_role_with_web_identity(&file, &role, None, region.as_deref())
            .await
            .map(Some)
    }

    // ── credential_process ────────────────────────────────────────────────

    async fn from_process(
        &self,
        profile: &[u8],
        command: &[u8],
    ) -> Result<AwsCredentials, ProviderError> {
        #[cfg(windows)]
        let argv: [&[u8]; 3] = [b"cmd.exe", b"/C", command];
        #[cfg(not(windows))]
        let argv: [&[u8]; 3] = [b"/bin/sh", b"-c", command];
        let result = self
            .io
            .spawn(SpawnRequest {
                argv: argv.iter().map(|a| Box::from(*a)).collect(),
                windows_verbatim_arguments: true,
            })
            .await
            .map_err(|e| {
                fail!(
                    "profile \"{}\": could not run credential_process: {e}",
                    BStr::new(profile)
                )
            })?;
        match result.term {
            bun_spawn::Term::Exited(0) => {}
            term => {
                let stderr = result.stderr.trim_ascii();
                return Err(fail!(
                    "profile \"{}\": credential_process exited with {term:?}{}{}",
                    BStr::new(profile),
                    if stderr.is_empty() { "" } else { ": " },
                    BStr::new(&stderr[..stderr.len().min(500)]),
                ));
            }
        }
        let parsed = json::parse(&result.stdout, |o| {
            (
                o.number(b"Version"),
                o.str(b"AccessKeyId"),
                o.str(b"SecretAccessKey"),
                o.str(b"SessionToken"),
                o.str(b"Expiration"),
                o.str(b"AccountId"),
            )
        });
        let Some((version, Some(akid), Some(secret), token, expiration, account_id)) = parsed
        else {
            return Err(fail!(
                "profile \"{}\": credential_process did not print a JSON object with AccessKeyId and SecretAccessKey",
                BStr::new(profile)
            ));
        };
        if version != Some(1.0) {
            return Err(fail!(
                "profile \"{}\": credential_process output must have \"Version\": 1",
                BStr::new(profile)
            ));
        }
        let expiration = match expiration {
            Some(e) => match sigv4::parse_iso8601(&e) {
                Some(t) => Some(t),
                None => {
                    return Err(fail!(
                        "profile \"{}\": credential_process printed an invalid Expiration \"{}\"",
                        BStr::new(profile),
                        BStr::new(&e)
                    ));
                }
            },
            None => None,
        };
        Ok(creds(
            akid,
            secret,
            token,
            expiration,
            account_id,
            CredentialsSource::Process,
        ))
    }

    // ── SSO ───────────────────────────────────────────────────────────────

    async fn from_sso(
        &self,
        profile: &[u8],
        start_url: &[u8],
        sso_region: &[u8],
        session_name: Option<&[u8]>,
        account_id: &[u8],
        role_name: &[u8],
    ) -> Result<AwsCredentials, ProviderError> {
        if !is_valid_region(sso_region) {
            return Err(fail!(
                "profile \"{}\": invalid sso_region \"{}\"",
                BStr::new(profile),
                BStr::new(sso_region)
            ));
        }
        // Token cache: ~/.aws/sso/cache/<sha1(session name | start url)>.json
        let key_input = session_name.unwrap_or(start_url);
        let mut digest = [0u8; bun_sha_hmac::sha::hashers::SHA1::DIGEST];
        bun_sha_hmac::sha::hashers::SHA1::hash(key_input, &mut digest);
        let Some(dir) = self.cfg.sso_cache_dir() else {
            return Err(fail!(
                "profile \"{}\": cannot locate the SSO token cache (HOME is not set)",
                BStr::new(profile)
            ));
        };
        let mut path = dir;
        let _ = write!(
            &mut path,
            "{}{}.json",
            bun_paths::SEP_STR,
            bun_core::fmt::hex_lower(&digest)
        );
        let login_hint = || -> String {
            match session_name {
                Some(s) => format!("run `aws sso login --sso-session {}`", BStr::new(s)),
                None => format!("run `aws sso login --profile {}`", BStr::new(profile)),
            }
        };
        let cache = File::read_from(Fd::cwd(), &path).map_err(|_| {
            fail!(
                "profile \"{}\": no cached SSO token at {}; {}",
                BStr::new(profile),
                BStr::new(&path),
                login_hint()
            )
        })?;
        struct Token {
            access_token: Option<Box<[u8]>>,
            expires_at: Option<Box<[u8]>>,
            refresh_token: Option<Box<[u8]>>,
            client_id: Option<Box<[u8]>>,
            client_secret: Option<Box<[u8]>>,
            registration_expires_at: Option<Box<[u8]>>,
        }
        let Some(mut tok) = json::parse(&cache, |o| Token {
            access_token: o.str(b"accessToken"),
            expires_at: o.str(b"expiresAt"),
            refresh_token: o.str(b"refreshToken"),
            client_id: o.str(b"clientId"),
            client_secret: o.str(b"clientSecret"),
            registration_expires_at: o.str(b"registrationExpiresAt"),
        }) else {
            return Err(fail!(
                "profile \"{}\": SSO token cache {} is not valid JSON; {}",
                BStr::new(profile),
                BStr::new(&path),
                login_hint()
            ));
        };
        let now = now_secs();
        let expires_at = tok
            .expires_at
            .as_deref()
            .and_then(sigv4::parse_iso8601)
            .unwrap_or(0);
        let mut access_token = tok.access_token.take();
        if access_token.is_none() || expires_at <= now + 60 {
            // Try a refresh if the cache carries a registered client.
            let registration_ok = tok
                .registration_expires_at
                .as_deref()
                .and_then(sigv4::parse_iso8601)
                .is_none_or(|t| t > now);
            if let (Some(rt), Some(cid), Some(cs), true) = (
                &tok.refresh_token,
                &tok.client_id,
                &tok.client_secret,
                registration_ok,
            ) {
                access_token = self
                    .sso_refresh(profile, sso_region, &path, &cache, rt, cid, cs)
                    .await?;
            } else {
                return Err(fail!(
                    "profile \"{}\": the cached SSO token has expired; {}",
                    BStr::new(profile),
                    login_hint()
                ));
            }
        }
        let Some(access_token) = access_token else {
            return Err(fail!(
                "profile \"{}\": SSO token cache has no accessToken; {}",
                BStr::new(profile),
                login_hint()
            ));
        };

        let mut url = Vec::with_capacity(128);
        let _ = write!(
            &mut url,
            "https://portal.sso.{}.{}/federation/credentials?",
            BStr::new(sso_region),
            dns_suffix(sso_region)
        );
        form_encode(
            &mut url,
            &[(b"account_id", account_id), (b"role_name", role_name)],
        );
        let req = HttpRequest::get(url)
            .header(b"x-amz-sso_bearer_token", &access_token)
            .header(b"accept", b"application/json")
            .timeout(STS_TIMEOUT_MS);
        let res = self.http(req, true).await.map_err(|e| {
            fail!(
                "profile \"{}\": SSO GetRoleCredentials request failed: {e}",
                BStr::new(profile)
            )
        })?;
        if res.status == 401 || res.status == 403 {
            return Err(fail!(
                "profile \"{}\": SSO GetRoleCredentials was rejected (HTTP {}): {}; {}",
                BStr::new(profile),
                res.status,
                snippet(&res.body),
                login_hint()
            ));
        }
        if res.status != 200 {
            return Err(fail!(
                "profile \"{}\": SSO GetRoleCredentials failed with HTTP {}: {}",
                BStr::new(profile),
                res.status,
                snippet(&res.body)
            ));
        }
        let parsed = json::parse(&res.body, |o| {
            let rc = o.object(b"roleCredentials")?;
            Some((
                rc.str(b"accessKeyId")?,
                rc.str(b"secretAccessKey")?,
                rc.str(b"sessionToken"),
                rc.number(b"expiration"),
            ))
        })
        .flatten();
        let Some((akid, secret, token, expiration_ms)) = parsed else {
            return Err(fail!(
                "profile \"{}\": SSO GetRoleCredentials returned an unexpected response: {}",
                BStr::new(profile),
                snippet(&res.body)
            ));
        };
        Ok(creds(
            akid,
            secret,
            token,
            expiration_ms
                .filter(|m| m.is_finite() && *m > 0.0)
                .map(|m| (m / 1000.0) as u64),
            Some(Box::from(account_id)),
            CredentialsSource::Sso,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    async fn sso_refresh(
        &self,
        profile: &[u8],
        sso_region: &[u8],
        cache_path: &[u8],
        cache_body: &[u8],
        refresh_token: &[u8],
        client_id: &[u8],
        client_secret: &[u8],
    ) -> Result<Option<Box<[u8]>>, ProviderError> {
        let mut url = Vec::with_capacity(64);
        let _ = write!(
            &mut url,
            "https://oidc.{}.{}/token",
            BStr::new(sso_region),
            dns_suffix(sso_region)
        );
        let mut body = Vec::with_capacity(256 + refresh_token.len());
        body.extend_from_slice(b"{\"clientId\":");
        json::push_string(&mut body, client_id);
        body.extend_from_slice(b",\"clientSecret\":");
        json::push_string(&mut body, client_secret);
        body.extend_from_slice(b",\"grantType\":\"refresh_token\",\"refreshToken\":");
        json::push_string(&mut body, refresh_token);
        body.push(b'}');
        let req = HttpRequest::post(url, body)
            .header(b"content-type", b"application/json")
            .timeout(STS_TIMEOUT_MS);
        let res = self.http(req, true).await.map_err(|e| {
            fail!(
                "profile \"{}\": refreshing the SSO token failed: {e}",
                BStr::new(profile)
            )
        })?;
        if res.status != 200 {
            return Err(fail!(
                "profile \"{}\": the cached SSO token has expired and refreshing it failed (HTTP {}); run `aws sso login`",
                BStr::new(profile),
                res.status
            ));
        }
        let Some((Some(access_token), expires_in, new_refresh)) = json::parse(&res.body, |o| {
            (
                o.str(b"accessToken"),
                o.number(b"expiresIn"),
                o.str(b"refreshToken"),
            )
        }) else {
            return Err(fail!(
                "profile \"{}\": SSO token refresh returned an unexpected response",
                BStr::new(profile)
            ));
        };
        // Best-effort write-back so other tools see the refreshed token.
        let Some(expires_in) = expires_in.filter(|s| s.is_finite() && *s > 0.0) else {
            return Ok(Some(access_token));
        };
        let expires_at = sigv4::amz_datetime(now_secs() + expires_in as u64);
        let iso = format!(
            "{}-{}-{}T{}:{}:{}Z",
            BStr::new(&expires_at[0..4]),
            BStr::new(&expires_at[4..6]),
            BStr::new(&expires_at[6..8]),
            BStr::new(&expires_at[9..11]),
            BStr::new(&expires_at[11..13]),
            BStr::new(&expires_at[13..15]),
        );
        if let Some(updated) = rewrite_sso_cache(
            cache_body,
            &access_token,
            iso.as_bytes(),
            new_refresh.as_deref(),
        ) {
            write_sso_cache(cache_path, &updated);
        }
        Ok(Some(access_token))
    }

    // ── 4. container credentials ──────────────────────────────────────────

    async fn from_container(&mut self) -> Outcome {
        let url: Vec<u8> = if let Some(rel) = &self.cfg.container_relative_uri {
            let mut u = b"http://169.254.170.2".to_vec();
            if !rel.starts_with(b"/") {
                u.push(b'/');
            }
            u.extend_from_slice(rel);
            u
        } else if let Some(full) = &self.cfg.container_full_uri {
            let parsed = bun_url::URL::parse(full);
            let host = parsed.hostname;
            let allowed = parsed.is_https()
                || (parsed.is_http()
                    && (host == b"localhost"
                        || host == b"[::1]"
                        || host == b"169.254.170.2"
                        || host == b"169.254.170.23"
                        || host.eq_ignore_ascii_case(b"[fd00:ec2::23]")
                        || is_ipv4_loopback(host)));
            if !allowed {
                return Err(fail!(
                    "AWS_CONTAINER_CREDENTIALS_FULL_URI \"{}\" must be https://, or http:// to a loopback / ECS / EKS link-local address",
                    BStr::new(full)
                ));
            }
            full.to_vec()
        } else {
            self.note(format_args!(
                "container (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI / _FULL_URI not set)"
            ));
            return Ok(None);
        };

        let token: Option<Vec<u8>> = if let Some(file) = &self.cfg.container_auth_token_file {
            match File::read_from(Fd::cwd(), file) {
                Ok(t) => Some(strings::trim(&t, b" \t\r\n").to_vec()),
                Err(e) => {
                    return Err(fail!(
                        "could not read AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE {}: {}",
                        BStr::new(file),
                        BStr::new(e.name())
                    ));
                }
            }
        } else {
            self.cfg.container_auth_token.as_deref().map(<[u8]>::to_vec)
        };
        if let Some(t) = &token {
            if strings::index_of_any(t, b"\r\n").is_some() {
                return Err(fail!(
                    "AWS_CONTAINER_AUTHORIZATION_TOKEN contains a newline"
                ));
            }
        }
        let mut last_err = None;
        for _ in 0..self.cfg.imds_attempts.max(1) {
            let mut req = HttpRequest::get(url.clone())
                .header(b"accept", b"application/json")
                .timeout(self.cfg.imds_timeout_ms.max(1000));
            if let Some(t) = &token {
                req = req.header(b"authorization", t);
            }
            match self.http(req, false).await {
                Ok(res) if res.status == 200 => {
                    return parse_json_credentials(
                        "container credentials endpoint",
                        &res.body,
                        CredentialsSource::Container,
                    )
                    .map(Some);
                }
                Ok(res) if res.status >= 500 => {
                    last_err = Some(fail!(
                        "container credentials endpoint {} answered HTTP {}: {}",
                        BStr::new(&url),
                        res.status,
                        snippet(&res.body)
                    ));
                }
                Ok(res) => {
                    return Err(fail!(
                        "container credentials endpoint {} answered HTTP {}: {}",
                        BStr::new(&url),
                        res.status,
                        snippet(&res.body)
                    ));
                }
                Err(e) => {
                    let interrupted = e.is_interruption();
                    last_err = Some(fail!(
                        "container credentials endpoint {} is unreachable: {e}",
                        BStr::new(&url)
                    ));
                    if interrupted {
                        break;
                    }
                }
            }
        }
        Err(last_err.expect("attempts >= 1"))
    }

    // ── 5. EC2 instance metadata ──────────────────────────────────────────

    async fn from_imds(&mut self) -> Outcome {
        if self.cfg.imds_disabled {
            self.note(format_args!(
                "EC2 instance metadata (AWS_EC2_METADATA_DISABLED is set)"
            ));
            return Ok(None);
        }
        let base: Vec<u8> = match &self.cfg.imds_endpoint {
            Some(ep) => {
                let parsed = bun_url::URL::parse(ep);
                if !(parsed.is_http() || parsed.is_https()) || parsed.hostname.is_empty() {
                    return Err(fail!(
                        "AWS_EC2_METADATA_SERVICE_ENDPOINT \"{}\" is not an http(s) URL",
                        BStr::new(ep)
                    ));
                }
                strings::trim_right(ep, b"/").to_vec()
            }
            None if self.cfg.imds_ipv6 => b"http://[fd00:ec2::254]".to_vec(),
            None => b"http://169.254.169.254".to_vec(),
        };
        let timeout = self.cfg.imds_timeout_ms;
        let attempts = self.cfg.imds_attempts.max(1);
        let join = |path: &str| -> Vec<u8> {
            let mut u = base.clone();
            u.extend_from_slice(path.as_bytes());
            u
        };

        // IMDSv2 session token.
        let mut token: Option<Vec<u8>> = None;
        let mut token_put_error: Option<HttpError> = None;
        let put = HttpRequest::new(Method::PUT, join("/latest/api/token"))
            .header(b"x-aws-ec2-metadata-token-ttl-seconds", b"21600")
            .timeout(timeout);
        match self.http(put, false).await {
            Ok(res) if res.status == 200 => {
                let t = strings::trim(&res.body, b" \t\r\n");
                if t.is_empty() || strings::index_of_any(t, b"\r\n").is_some() {
                    return Err(fail!(
                        "EC2 instance metadata returned an invalid session token"
                    ));
                }
                token = Some(t.to_vec());
            }
            Ok(res) if matches!(res.status, 401 | 403 | 404 | 405) => {
                if self.cfg.imds_v1_disabled {
                    return Err(fail!(
                        "EC2 instance metadata token request answered HTTP {} and IMDSv1 fallback is disabled (AWS_EC2_METADATA_V1_DISABLED)",
                        res.status
                    ));
                }
                // fall through to IMDSv1
            }
            Ok(res) => {
                return Err(fail!(
                    "EC2 instance metadata token request answered HTTP {}: {}",
                    res.status,
                    snippet(&res.body)
                ));
            }
            Err(e) => {
                // No answer to the token PUT: either not on EC2, or IMDSv2's
                // response cannot reach us (container with hop limit 1). Try
                // one IMDSv1 GET before giving up, like the SDKs do.
                if self.cfg.imds_v1_disabled {
                    self.note(format_args!(
                        "EC2 instance metadata ({} is unreachable: {e})",
                        BStr::new(&base)
                    ));
                    return Ok(None);
                }
                token_put_error = Some(e);
            }
        }

        let attempts = if token_put_error.is_some() {
            1
        } else {
            attempts
        };

        let role_url = join("/latest/meta-data/iam/security-credentials/");
        let res = match (
            self.imds_get(&role_url, token.as_deref(), attempts).await,
            &token_put_error,
        ) {
            (Ok(res), _) => res,
            (Err(_), Some(e)) => {
                self.note(format_args!(
                    "EC2 instance metadata ({} is unreachable: {e})",
                    BStr::new(&base)
                ));
                return Ok(None);
            }
            (Err(e), None) => return Err(e),
        };
        if res.status == 401
            && let Some(e) = &token_put_error
        {
            return Err(fail!(
                "EC2 instance metadata requires IMDSv2 but the session token request got no response ({e}); if this is a container, raise the instance's metadata hop limit to 2"
            ));
        }
        if res.status == 404 {
            self.note(format_args!(
                "EC2 instance metadata (no IAM role is attached to this instance)"
            ));
            return Ok(None);
        }
        if res.status != 200 {
            return Err(fail!(
                "EC2 instance metadata {} answered HTTP {}: {}",
                BStr::new(&role_url),
                res.status,
                snippet(&res.body)
            ));
        }
        let role = strings::split(&res.body, b"\n")
            .map(|l| strings::trim(l, b" \t\r"))
            .find(|l| !l.is_empty())
            .map(<[u8]>::to_vec);
        let Some(role) = role else {
            self.note(format_args!(
                "EC2 instance metadata (no IAM role is attached to this instance)"
            ));
            return Ok(None);
        };
        if !role.iter().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, b'+' | b'=' | b',' | b'.' | b'@' | b'_' | b'-')
        }) {
            return Err(fail!("EC2 instance metadata returned an invalid role name"));
        }
        let mut creds_url = role_url;
        creds_url.extend_from_slice(&role);
        let res = self
            .imds_get(&creds_url, token.as_deref(), attempts)
            .await?;
        if res.status != 200 {
            return Err(fail!(
                "EC2 instance metadata {} answered HTTP {}: {}",
                BStr::new(&creds_url),
                res.status,
                snippet(&res.body)
            ));
        }
        parse_json_credentials("EC2 instance metadata", &res.body, CredentialsSource::Imds)
            .map(Some)
    }

    async fn imds_get(
        &self,
        url: &[u8],
        token: Option<&[u8]>,
        attempts: u32,
    ) -> Result<HttpResponse, ProviderError> {
        let mut last = None;
        for _ in 0..attempts.max(1) {
            let mut req = HttpRequest::get(url.to_vec()).timeout(self.cfg.imds_timeout_ms);
            if let Some(t) = token {
                req = req.header(b"x-aws-ec2-metadata-token", t);
            }
            match self.http(req, false).await {
                Ok(res) if res.status >= 500 => {
                    last = Some(fail!(
                        "EC2 instance metadata {} answered HTTP {}",
                        BStr::new(url),
                        res.status
                    ));
                }
                Ok(res) => return Ok(res),
                Err(e) => {
                    let interrupted = e.is_interruption();
                    last = Some(fail!(
                        "EC2 instance metadata {} is unreachable: {e}",
                        BStr::new(url)
                    ));
                    if interrupted {
                        break;
                    }
                }
            }
        }
        Err(last.expect("attempts >= 1"))
    }
}

fn is_ipv4_loopback(host: &[u8]) -> bool {
    // 127.0.0.0/8
    let parts: Vec<&[u8]> = strings::split(host, b".").collect();
    parts.len() == 4
        && parts[0] == b"127"
        && parts[1..]
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 3 && p.iter().all(u8::is_ascii_digit))
}

/// `{AccessKeyId, SecretAccessKey, Token, Expiration, AccountId, Code?}`
fn parse_json_credentials(
    what: &str,
    body: &[u8],
    source: CredentialsSource,
) -> Result<AwsCredentials, ProviderError> {
    let parsed = json::parse(body, |o| {
        (
            o.str(b"Code"),
            o.str(b"AccessKeyId"),
            o.str(b"SecretAccessKey"),
            o.str(b"Token"),
            o.str(b"Expiration"),
            o.str(b"AccountId"),
            o.str(b"Message"),
        )
    });
    let Some((code, akid, secret, token, expiration, account_id, message)) = parsed else {
        return Err(fail!(
            "{what} returned a response that is not JSON: {}",
            snippet(body)
        ));
    };
    if let Some(code) = &code {
        if !code.eq_ignore_ascii_case(b"Success") {
            return Err(fail!(
                "{what} returned Code \"{}\": {}",
                BStr::new(code),
                BStr::new(message.as_deref().unwrap_or(b""))
            ));
        }
    }
    let (Some(akid), Some(secret)) = (akid, secret) else {
        return Err(fail!(
            "{what} response is missing AccessKeyId/SecretAccessKey"
        ));
    };
    let expiration = match expiration {
        Some(e) => Some(sigv4::parse_iso8601(&e).ok_or_else(|| {
            fail!(
                "{what} returned an invalid Expiration \"{}\"",
                BStr::new(&e)
            )
        })?),
        None => None,
    };
    Ok(creds(akid, secret, token, expiration, account_id, source))
}

/// Best-effort: replace the cache file whole or not at all (other tools read
/// it), keeping its owner so `sudo bun …` does not lock the user out of it.
fn write_sso_cache(cache_path: &[u8], contents: &[u8]) {
    let mut tmp = cache_path.to_vec();
    let _ = write!(
        &mut tmp,
        ".bun-{}-{:x}",
        std::process::id(),
        bun_core::time::nano_timestamp()
    );
    let tmp = bun_core::ZBox::from_vec(tmp);
    let dest = bun_core::ZBox::from_bytes(cache_path);
    let replaced = File::openat(
        Fd::cwd(),
        tmp.as_bytes(),
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::EXCL | bun_sys::O::CLOEXEC,
        0o600,
    )
    .and_then(|f| {
        #[cfg(unix)]
        if let Ok(st) = bun_sys::fstatat(Fd::cwd(), &dest) {
            let _ = bun_sys::fchown(f.handle(), st.st_uid as u32, st.st_gid as u32);
        }
        f.write_all(contents)
    })
    .and_then(|()| bun_sys::renameat(Fd::cwd(), &tmp, Fd::cwd(), &dest));
    if replaced.is_err() {
        let _ = bun_sys::unlinkat(Fd::cwd(), &tmp);
    }
}

/// Replace `accessToken` / `expiresAt` (/ `refreshToken`) in the cached SSO
/// token JSON, keeping every other key. Returns `None` if the document is not
/// a flat JSON object we can round-trip.
fn rewrite_sso_cache(
    original: &[u8],
    access_token: &[u8],
    expires_at_iso: &[u8],
    refresh_token: Option<&[u8]>,
) -> Option<Vec<u8>> {
    json::parse(original, |o| {
        let mut out = Vec::with_capacity(original.len() + 64);
        out.push(b'{');
        let mut first = true;
        let mut push = |k: &[u8], v: &[u8], out: &mut Vec<u8>| {
            if !first {
                out.push(b',');
            }
            first = false;
            json::push_string(out, k);
            out.push(b':');
            json::push_string(out, v);
        };
        for prop in o.0.properties() {
            let key = prop.key.slice();
            let value: Option<Box<[u8]>> = match key {
                b"accessToken" => Some(Box::from(access_token)),
                b"expiresAt" => Some(Box::from(expires_at_iso)),
                b"refreshToken" => Some(Box::from(
                    refresh_token.unwrap_or_else(|| prop.value.as_str().unwrap_or(b"")),
                )),
                _ => prop.value.as_str().map(Box::from),
            };
            // Non-string values (there are none in practice) are dropped
            // rather than mis-serialised.
            if let Some(v) = value {
                push(key, &v[..], &mut out);
            }
        }
        out.push(b'}');
        out
    })
}
