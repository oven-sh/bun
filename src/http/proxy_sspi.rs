//! SSPI (Windows) `Negotiate` / `NTLM` proxy authentication.
//!
//! When a proxy answers `407` with `Proxy-Authenticate: Negotiate` or
//! `Proxy-Authenticate: NTLM`, [`ProxySSPIAuth`] drives the multi-leg SSPI
//! handshake using the current user's logon credentials (no username/password
//! in the proxy URL). Each leg produces a `Proxy-Authorization: <scheme>
//! <base64>` header for [`write_proxy_auth_and_headers`], and the request is
//! re-sent on the *same* TCP connection — NTLM authenticates the connection,
//! so a reconnect between legs would invalidate the server's challenge.
//!
//! On non-Windows targets this module compiles to inert stubs so the call
//! sites in `lib.rs` stay `cfg`-free.

use bun_core::strings;

/// Hard cap on the number of 407→retry round-trips attempted for one
/// connection. Kerberos is usually 1 leg, NTLM is 2; a proxy that keeps
/// returning 407 past this is misbehaving.
pub const MAX_LEGS: u8 = 6;

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Scheme {
    Negotiate,
    Ntlm,
}

impl Scheme {
    pub fn header_prefix(self) -> &'static [u8] {
        match self {
            Self::Negotiate => b"Negotiate ",
            Self::Ntlm => b"NTLM ",
        }
    }
}

/// Parse a `407` response's `Proxy-Authenticate` headers. Returns the scheme
/// to use (preferring `Negotiate`) and any base64 challenge token that
/// accompanied it. A bare `Proxy-Authenticate: Negotiate` yields `(scheme,
/// None)`; `Proxy-Authenticate: Negotiate <b64>` yields `(scheme, Some(..))`.
///
/// `want` restricts the match to a scheme already negotiated on this
/// connection: once leg 1 picked NTLM, leg 2 must not switch to Negotiate
/// even if the proxy offers both.
pub fn select_scheme(
    response: &bun_picohttp::Response<'_>,
    want: Option<Scheme>,
) -> Option<(Scheme, Option<Vec<u8>>)> {
    let mut pick: Option<(Scheme, &[u8])> = None;
    for header in response.headers.list.iter() {
        if !strings::eql_case_insensitive_ascii(header.name(), b"Proxy-Authenticate", true) {
            continue;
        }
        let value = header.value();
        // RFC 7235: scheme is the first token; challenge data (if any) follows
        // after whitespace. SPNEGO/NTLM put a single base64 blob there.
        let (scheme_tok, rest) = match value.iter().position(|&b| b == b' ' || b == b'\t') {
            Some(i) => (&value[..i], strings::trim(&value[i..], b" \t")),
            None => (value, &b""[..]),
        };
        let scheme = if strings::eql_case_insensitive_ascii(scheme_tok, b"Negotiate", true) {
            Scheme::Negotiate
        } else if strings::eql_case_insensitive_ascii(scheme_tok, b"NTLM", true) {
            Scheme::Ntlm
        } else {
            continue;
        };
        if let Some(w) = want {
            if w != scheme {
                continue;
            }
        }
        match (scheme, pick) {
            // Prefer Negotiate (wraps Kerberos; falls back to NTLM itself).
            (Scheme::Negotiate, _) => pick = Some((scheme, rest)),
            (Scheme::Ntlm, None) => pick = Some((scheme, rest)),
            (Scheme::Ntlm, Some(_)) => {}
        }
    }
    let (scheme, rest) = pick?;
    let challenge = if rest.is_empty() {
        None
    } else {
        bun_base64::decode_alloc(rest).ok()
    };
    Some((scheme, challenge))
}

#[cfg(windows)]
pub use windows::ProxySSPIAuth;

#[cfg(windows)]
mod windows {
    use super::Scheme;
    use bun_windows_sys::sspi;
    use core::ptr;

    bun_core::declare_scope!(proxy_sspi, visible);

    /// UTF-16LE, NUL-terminated. Proxy hostnames are ASCII in practice; a
    /// non-ASCII byte is rejected rather than mis-encoded.
    fn ascii_to_wide(s: &[u8]) -> Option<Vec<u16>> {
        let mut out = Vec::with_capacity(s.len() + 1);
        for &b in s {
            if b >= 0x80 {
                return None;
            }
            out.push(u16::from(b));
        }
        out.push(0);
        Some(out)
    }

    const NEGOTIATE_W: [u16; 10] = [
        b'N' as u16,
        b'e' as u16,
        b'g' as u16,
        b'o' as u16,
        b't' as u16,
        b'i' as u16,
        b'a' as u16,
        b't' as u16,
        b'e' as u16,
        0,
    ];
    const NTLM_W: [u16; 5] = [b'N' as u16, b'T' as u16, b'L' as u16, b'M' as u16, 0];

    pub struct ProxySSPIAuth {
        scheme: Scheme,
        cred: sspi::CredHandle,
        ctx: sspi::CtxtHandle,
        have_ctx: bool,
        /// `HTTP/<proxyhost>` as NUL-terminated UTF-16.
        spn: Vec<u16>,
        out_buf: Vec<u8>,
        max_token: u32,
        complete: bool,
    }

    impl ProxySSPIAuth {
        pub fn scheme(&self) -> Scheme {
            self.scheme
        }

        pub fn is_complete(&self) -> bool {
            self.complete
        }

        /// Acquire default (current-user) outbound credentials for `scheme` and
        /// size the output buffer from `QuerySecurityPackageInfoW`.
        pub fn new(scheme: Scheme, proxy_host: &[u8]) -> Option<Box<Self>> {
            let pkg_name: &[u16] = match scheme {
                Scheme::Negotiate => &NEGOTIATE_W,
                Scheme::Ntlm => &NTLM_W,
            };

            let mut pkg: *mut sspi::SecPkgInfoW = ptr::null_mut();
            // SAFETY: `pkg_name` is a valid NUL-terminated UTF-16 string; SSPI
            // only reads it. `pkg` receives an SSPI-allocated pointer on
            // success, which is freed below via `FreeContextBuffer`.
            let status = unsafe {
                sspi::QuerySecurityPackageInfoW(pkg_name.as_ptr().cast_mut(), &raw mut pkg)
            };
            if status != sspi::SEC_E_OK || pkg.is_null() {
                bun_core::scoped_log!(
                    proxy_sspi,
                    "QuerySecurityPackageInfoW failed: 0x{:08x}",
                    status as u32
                );
                return None;
            }
            // SAFETY: `pkg` is non-null and points at the SSPI-allocated
            // `SecPkgInfoW` returned above.
            let max_token = unsafe { (*pkg).cbMaxToken };
            // SAFETY: releasing the SSPI allocation from
            // `QuerySecurityPackageInfoW`; `pkg` is not used after this call.
            unsafe { sspi::FreeContextBuffer(pkg.cast()) };

            let mut cred = sspi::CredHandle {
                dwLower: 0,
                dwUpper: 0,
            };
            let mut expiry = sspi::TimeStamp {
                LowPart: 0,
                HighPart: 0,
            };
            // SAFETY: `pkg_name` is a valid NUL-terminated wide string (read-
            // only despite the `*mut` in the SDK signature). `pAuthData = NULL`
            // selects the current logon session's credentials. `cred`/`expiry`
            // are local out-params.
            let status = unsafe {
                sspi::AcquireCredentialsHandleW(
                    ptr::null_mut(),
                    pkg_name.as_ptr().cast_mut(),
                    sspi::SECPKG_CRED_OUTBOUND,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    &raw mut cred,
                    &raw mut expiry,
                )
            };
            if status != sspi::SEC_E_OK {
                bun_core::scoped_log!(
                    proxy_sspi,
                    "AcquireCredentialsHandleW failed: 0x{:08x}",
                    status as u32
                );
                return None;
            }

            // Kerberos needs an SPN; NTLM ignores it. curl passes "" for NTLM.
            let spn = match scheme {
                Scheme::Negotiate => {
                    let host = crate::strip_port_from_host(proxy_host);
                    let mut spn = Vec::with_capacity(b"HTTP/".len() + host.len());
                    spn.extend_from_slice(b"HTTP/");
                    spn.extend_from_slice(host);
                    match ascii_to_wide(&spn) {
                        Some(w) => w,
                        None => {
                            // SAFETY: `cred` was populated by the successful
                            // `AcquireCredentialsHandleW` above.
                            unsafe { sspi::FreeCredentialsHandle(&raw mut cred) };
                            return None;
                        }
                    }
                }
                Scheme::Ntlm => vec![0u16],
            };

            Some(Box::new(Self {
                scheme,
                cred,
                ctx: sspi::CtxtHandle {
                    dwLower: 0,
                    dwUpper: 0,
                },
                have_ctx: false,
                spn,
                out_buf: vec![0u8; max_token as usize],
                max_token,
                complete: false,
            }))
        }

        /// Feed an optional server challenge and return the next outbound
        /// token. Returns `None` on any SSPI failure, in which case the caller
        /// should fall through to surfacing the proxy's 407 unchanged.
        pub fn step(&mut self, challenge: Option<&[u8]>) -> Option<&[u8]> {
            let mut in_buf;
            let mut in_desc;
            let p_input: *mut sspi::SecBufferDesc = match challenge {
                Some(c) if !c.is_empty() => {
                    in_buf = sspi::SecBuffer {
                        cbBuffer: c.len() as core::ffi::c_ulong,
                        BufferType: sspi::SECBUFFER_TOKEN,
                        pvBuffer: c.as_ptr().cast_mut().cast(),
                    };
                    in_desc = sspi::SecBufferDesc {
                        ulVersion: sspi::SECBUFFER_VERSION,
                        cBuffers: 1,
                        pBuffers: &raw mut in_buf,
                    };
                    &raw mut in_desc
                }
                _ => ptr::null_mut(),
            };

            let mut out_buf = sspi::SecBuffer {
                cbBuffer: self.max_token,
                BufferType: sspi::SECBUFFER_TOKEN,
                pvBuffer: self.out_buf.as_mut_ptr().cast(),
            };
            let mut out_desc = sspi::SecBufferDesc {
                ulVersion: sspi::SECBUFFER_VERSION,
                cBuffers: 1,
                pBuffers: &raw mut out_buf,
            };
            let mut attrs: core::ffi::c_ulong = 0;
            let mut expiry = sspi::TimeStamp {
                LowPart: 0,
                HighPart: 0,
            };

            let (ctx_req, data_rep) = match self.scheme {
                Scheme::Negotiate => (sspi::ISC_REQ_CONFIDENTIALITY, sspi::SECURITY_NATIVE_DREP),
                Scheme::Ntlm => (0, sspi::SECURITY_NETWORK_DREP),
            };

            let p_ctx = if self.have_ctx {
                &raw mut self.ctx
            } else {
                ptr::null_mut()
            };

            // SAFETY: all pointer args are either NULL or point at live locals
            // / `self` fields for the duration of the call. `spn` is
            // NUL-terminated UTF-16. `out_buf.pvBuffer` has `max_token` bytes
            // of capacity (`self.out_buf`). SSPI writes only within
            // `out_buf.cbBuffer`.
            let mut status = unsafe {
                sspi::InitializeSecurityContextW(
                    &raw mut self.cred,
                    p_ctx,
                    self.spn.as_mut_ptr(),
                    ctx_req,
                    0,
                    data_rep,
                    p_input,
                    0,
                    &raw mut self.ctx,
                    &raw mut out_desc,
                    &raw mut attrs,
                    &raw mut expiry,
                )
            };
            self.have_ctx = true;

            if status == sspi::SEC_I_COMPLETE_NEEDED
                || status == sspi::SEC_I_COMPLETE_AND_CONTINUE
            {
                // SAFETY: `self.ctx` was just populated by
                // `InitializeSecurityContextW`; `out_desc` points at the same
                // live `out_buf`.
                unsafe { sspi::CompleteAuthToken(&raw mut self.ctx, &raw mut out_desc) };
                status = if status == sspi::SEC_I_COMPLETE_NEEDED {
                    sspi::SEC_E_OK
                } else {
                    sspi::SEC_I_CONTINUE_NEEDED
                };
            }

            match status {
                sspi::SEC_E_OK => {
                    self.complete = true;
                    Some(&self.out_buf[..out_buf.cbBuffer as usize])
                }
                sspi::SEC_I_CONTINUE_NEEDED => {
                    Some(&self.out_buf[..out_buf.cbBuffer as usize])
                }
                _ => {
                    bun_core::scoped_log!(
                        proxy_sspi,
                        "InitializeSecurityContextW failed: 0x{:08x}",
                        status as u32
                    );
                    None
                }
            }
        }
    }

    impl Drop for ProxySSPIAuth {
        fn drop(&mut self) {
            if self.have_ctx {
                // SAFETY: `self.ctx` was populated by
                // `InitializeSecurityContextW` (guarded by `have_ctx`).
                unsafe { sspi::DeleteSecurityContext(&raw mut self.ctx) };
            }
            // SAFETY: `self.cred` was populated by a successful
            // `AcquireCredentialsHandleW` in `new`.
            unsafe { sspi::FreeCredentialsHandle(&raw mut self.cred) };
        }
    }
}

#[cfg(not(windows))]
pub use fallback::ProxySSPIAuth;

#[cfg(not(windows))]
mod fallback {
    use super::Scheme;

    /// Uninhabited on non-Windows: `Option<Box<ProxySSPIAuth>>` is a ZST and
    /// every method body is statically unreachable, so the integration sites in
    /// `lib.rs` compile away.
    pub enum ProxySSPIAuth {}

    impl ProxySSPIAuth {
        #[inline(always)]
        pub fn new(_scheme: Scheme, _proxy_host: &[u8]) -> Option<Box<Self>> {
            None
        }
        pub fn scheme(&self) -> Scheme {
            match *self {}
        }
        pub fn is_complete(&self) -> bool {
            match *self {}
        }
        pub fn step(&mut self, _challenge: Option<&[u8]>) -> Option<&[u8]> {
            match *self {}
        }
    }
}
