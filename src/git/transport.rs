//! Git wire transports. Everything above this layer (pkt-line, protocol v2,
//! pack indexing, parallel-fetch orchestration) is byte-identical across
//! transports — only [`Remote::handshake`] and [`Remote::request`] differ.
//!
//! [`Remote`] is the seam: HTTP today, subprocess `ssh` today, native libssh2
//! later. A new transport implements those two methods and nothing else.
//!
//! ### HTTP — `bun_http::AsyncHTTP`
//!
//! Everything runs on the bun HTTP thread (uSockets event loop, BoringSSL,
//! H1/H2). This file is just glue: build a request, hand it to the HTTP
//! thread, block the calling thread on a `Guarded<…>` + `Condvar` until the
//! result lands.
//!
//! Two shapes:
//!   * [`get_buffered`] — `GET …/info/refs` and the `ls-refs` POST. Body is a
//!     few KiB, so let `send_sync` collect it whole.
//!   * [`post_streamed`] — the `fetch` POST. The packfile can be GiBs, so the
//!     response-body-streaming signal is set and each chunk is processed in
//!     the HTTP-thread callback (the same pattern `bun install` uses for
//!     tarballs in `NetworkTask::notify`). The caller passes a `Send` sink
//!     that runs **on the HTTP thread**; for git-clone that sink is the
//!     side-band demux + pack file write + in-memory append.

use crate::{Error, Result};
use bun_core::MutableString;
use bun_http::{self as http, AsyncHTTP, FetchRedirect, HTTPClientResult, Method};
use bun_threading::{Condvar, Guarded, thread_pool::Batch};
use core::mem::ManuallyDrop;
use core::ptr::{self, NonNull};
use core::sync::atomic::Ordering;

/// Headers every git smart-HTTP request carries. The HTTP client adds `Host`,
/// `User-Agent`, `Connection`, `Accept-Encoding`, `Content-Length` itself.
const GIT_PROTOCOL: (&str, &str) = ("Git-Protocol", "version=2");

/// Buffered `GET`/small-`POST`: returns `(status, body)`.
pub(crate) fn get_buffered(
    url: &[u8],
    method: Method,
    content_type: Option<&str>,
    body: &[u8],
) -> Result<(u16, Vec<u8>)> {
    let mut hb = build_headers(content_type);
    // SAFETY: `hb.content` is heap-owned by this stack frame, which outlives
    // the `send_sync` call below; detach the borrow so `hb` can be moved.
    let headers_buf: &[u8] = unsafe { bun_ptr::detach_lifetime(hb.content.written_slice()) };
    let entries = core::mem::take(&mut hb.entries);
    let _hold_buf = ManuallyDrop::new(core::mem::take(&mut hb.content));

    let mut out = MutableString::init(0).map_err(|_| Error::Http("OOM".into()))?;
    let mut req = Box::new(AsyncHTTP::init_sync(
        method,
        bun_url::URL::parse(url),
        entries,
        headers_buf,
        ptr::from_mut(&mut out),
        body,
        None,
        None,
        FetchRedirect::Follow,
    ));
    let resp = req
        .send_sync()
        .map_err(|e| Error::Http(format!("{}: {e:?}", bstr::BStr::new(url))))?;
    let status = resp.status_code as u16;
    // `_hold_buf` was leaked above only to outlive the request; reclaim it now
    // that `send_sync` returned.
    drop(ManuallyDrop::into_inner(_hold_buf));
    Ok((status, core::mem::take(&mut out.list)))
}

/// Streaming `POST`. `sink` is invoked **on the HTTP thread** once per body
/// chunk; this function blocks until the response completes (or `sink`
/// returns an error, which is propagated). Returns the response status.
pub(crate) fn post_streamed<S>(url: &[u8], content_type: &str, body: &[u8], sink: S) -> Result<u16>
where
    S: FnMut(&[u8]) -> Result<()> + Send,
{
    // Heap context shared with the HTTP-thread callback. Layout is fixed for
    // the request's lifetime, so raw pointers into it stay valid.
    struct Ctx<S> {
        /// HTTP client appends each chunk here; callback consumes + resets.
        response_buffer: MutableString,
        /// Set on the first callback that carries headers.
        status: u16,
        sink: S,
        /// `Some` once the final callback has fired.
        done: Guarded<Option<Result<()>>>,
        cv: Condvar,
        /// Backing store for the streaming flag the HTTP client polls.
        signal_store: http::signals::Store,
        /// The `headers_buf` slice the client borrows; owned here so it
        /// outlives the request running on another thread.
        _header_content: bun_core::StringBuilder,
    }

    let mut hb = build_headers(Some(content_type));
    let header_content = core::mem::take(&mut hb.content);
    let entries = core::mem::take(&mut hb.entries);

    let mut ctx = Box::new(Ctx {
        response_buffer: MutableString::init(0).map_err(|_| Error::Http("OOM".into()))?,
        status: 0,
        sink,
        done: Guarded::new(None),
        cv: Condvar::new(),
        signal_store: http::signals::Store::default(),
        _header_content: header_content,
    });
    ctx.signal_store
        .response_body_streaming
        .store(true, Ordering::Relaxed);
    let ctx_ptr: *mut Ctx<S> = &raw mut *ctx;

    // SAFETY: `_header_content` lives in the heap `ctx` and is dropped only
    // after the request completes (we block on `cv` below).
    let headers_buf: &'static [u8] =
        unsafe { bun_ptr::detach_lifetime(ctx._header_content.written_slice()) };

    fn on_chunk<S: FnMut(&[u8]) -> Result<()>>(
        this: *mut Ctx<S>,
        _async_http: *mut AsyncHTTP<'static>,
        mut result: HTTPClientResult<'_>,
    ) {
        // SAFETY: `this` is the `ctx_ptr` we registered; the calling thread is
        // parked on `cv` and touches none of these fields until we set `done`.
        let this = unsafe { &mut *this };
        if let Some(m) = result.metadata.take() {
            this.status = m.response.status_code as u16;
        }
        let mut chunk_result: Result<()> = Ok(());
        let chunk = this.response_buffer.list.as_slice();
        if !chunk.is_empty() && this.status >= 200 && this.status < 300 {
            chunk_result = (this.sink)(chunk);
        }
        // Hand the buffer back empty so the next chunk starts at offset 0.
        this.response_buffer.reset();
        if result.has_more && chunk_result.is_ok() {
            return;
        }
        // Final (or sink errored): wake the caller.
        let outcome = match (chunk_result, result.fail) {
            (Err(e), _) => Err(e),
            (Ok(()), Some(e)) => Err(Error::Http(format!("{e:?}"))),
            (Ok(()), None) => Ok(()),
        };
        let mut g = this.done.lock();
        *g = Some(outcome);
        this.cv.notify_one();
    }

    let signals = http::Signals {
        response_body_streaming: Some(NonNull::from(&ctx.signal_store.response_body_streaming)),
        ..Default::default()
    };
    let opts = http::async_http::Options {
        signals: Some(signals),
        disable_decompression: Some(true),
        // Leave the HTTP-thread idle timeout enabled — a stalled connection
        // would otherwise hang the whole clone (we block on the final
        // callback's condvar).
        ..Default::default()
    };
    // `AsyncHTTP` borrows `url`/`body`/`headers_buf` for `'a`. The request
    // runs on the HTTP thread while this frame is parked on `cv`, so those
    // stack borrows are live for the entire request — but the type wants
    // `'static` once it crosses to the HTTP thread. Mirror `NetworkTask`:
    // detach the lifetimes; the borrows are sound because we block.
    // SAFETY: this stack frame (and `ctx`) outlive the request — we don't
    // return until `done` is set by the final callback.
    let url_s: &'static [u8] = unsafe { bun_ptr::detach_lifetime(url) };
    // SAFETY: same as `url_s`.
    let body_s: &'static [u8] = unsafe { bun_ptr::detach_lifetime(body) };
    let mut req = Box::new(AsyncHTTP::init(
        Method::POST,
        bun_url::URL::parse(url_s),
        entries,
        headers_buf,
        ptr::addr_of_mut!(ctx.response_buffer),
        body_s,
        http::HTTPClientResultCallback::new::<Ctx<S>>(ctx_ptr, on_chunk::<S>),
        FetchRedirect::Follow,
        opts,
    ));
    // The HTTP thread copies `*req` into its threadlocal slot, then writes
    // back via `real`; keep the heap one alive so that pointer stays valid.
    req.real = Some(NonNull::from(&mut *req).cast());

    http::http_thread::init(&Default::default());
    let mut batch = Batch::default();
    req.schedule(&mut batch);
    http::HTTPThread::schedule(batch);

    // Park until the final callback fires.
    let outcome = {
        let mut g = ctx.done.lock();
        loop {
            if let Some(r) = g.take() {
                break r;
            }
            ctx.cv.wait_guarded(&mut g);
        }
    };
    let status = ctx.status;
    // Past this point the HTTP thread will not touch `ctx`/`req` again (the
    // final callback is the last reference), so dropping is safe.
    drop(req);
    drop(ctx);
    outcome.map(|()| status)
}

// ═══════════════════════════════════════════════════════════════════════════
// Remote — transport-agnostic seam
// ═══════════════════════════════════════════════════════════════════════════

/// A git endpoint reachable over some wire. Everything above this type is
/// transport-agnostic; adding libssh2 (or a unix-socket transport, or git://)
/// means adding a variant here and matching in two methods.
#[derive(Clone)]
pub(crate) enum Remote {
    /// `http[s]://host/path` — stateless smart-HTTP.
    Http { base: String },
    /// `ssh://[user@]host[:port]/path` or `[user@]host:path` (scp-like).
    /// Spawns `ssh … git-upload-pack '<path>'` per request. Swap this arm's
    /// body for libssh2 to go native — callers won't notice.
    Ssh {
        user_host: String,
        port: Option<u16>,
        path: String,
    },
}

impl Remote {
    pub(crate) fn parse(url: &str) -> crate::Result<Self> {
        // The URL is written verbatim into `.git/config` (`url = <url>`), so
        // any control byte — LF in particular — would let the caller inject
        // arbitrary config keys (e.g. `core.sshCommand`). git-config's value
        // grammar also reserves `"` and `\` unless quoted; we don't quote, so
        // reject those too. This also covers HTTP header-splitting and ssh
        // argv weirdness in one place.
        if let Some(b) = url
            .bytes()
            .find(|&b| b < 0x20 || b == 0x7f || b == b'"' || b == b'\\')
        {
            return Err(Error::Http(format!(
                "refusing URL with control/reserved byte 0x{b:02x}: {:?}",
                bstr::BStr::new(url.as_bytes())
            )));
        }
        if url.starts_with("https://") || url.starts_with("http://") {
            return Ok(Remote::Http {
                base: url.trim_end_matches('/').to_owned(),
            });
        }
        if let Some(rest) = url.strip_prefix("ssh://") {
            // ssh://[user@]host[:port]/path
            let (auth, path) = rest
                .split_once('/')
                .ok_or_else(|| Error::Http(format!("ssh URL missing path: {url}")))?;
            let (user_host, port) = match auth.rsplit_once(':') {
                Some((h, p)) if p.bytes().all(|b| b.is_ascii_digit()) => {
                    (h.to_owned(), p.parse().ok())
                }
                _ => (auth.to_owned(), None),
            };
            // Absolute path → cannot become an option to git-upload-pack.
            return Self::ssh_checked(user_host, port, format!("/{path}"));
        }
        // scp-like: [user@]host:path  (no scheme, exactly one ':' before path)
        if let Some((uh, path)) = url.split_once(':') {
            if !uh.contains('/') && !path.starts_with("//") {
                // scp-style paths are relative to the remote home; prefix
                // `./` so a path like `-foo` can't reach upload-pack as a
                // flag (git does the same — `transport.c:prepare_ssh_command`).
                let path = if path.starts_with(['/', '.', '~']) {
                    path.to_owned()
                } else {
                    format!("./{path}")
                };
                return Self::ssh_checked(uh.to_owned(), None, path);
            }
        }
        Err(Error::Http(format!(
            "unsupported URL scheme (http/https/ssh): {url}"
        )))
    }

    /// Reject inputs that could smuggle an option into `ssh` or
    /// `git-upload-pack` (CVE-2017-1000117). `ssh` treats anything starting
    /// with `-` in the host position as an option (`-oProxyCommand=…` is
    /// arbitrary code exec); `--` alone isn't sufficient because OpenSSH
    /// only honours it for *operands after the host*, so the dash check is
    /// load-bearing. The host part after `user@` is checked too — `ssh`
    /// splits on `@` itself.
    fn ssh_checked(user_host: String, port: Option<u16>, path: String) -> crate::Result<Self> {
        let host = user_host.rsplit('@').next().unwrap_or("");
        if user_host.starts_with('-') || host.starts_with('-') || user_host.is_empty() {
            return Err(Error::Http(format!(
                "refusing suspicious ssh host (starts with '-'): {user_host:?}"
            )));
        }
        if path.starts_with('-') {
            return Err(Error::Http(format!(
                "refusing suspicious ssh path (starts with '-'): {path:?}"
            )));
        }
        Ok(Remote::Ssh {
            user_host,
            port,
            path,
        })
    }

    /// Capability advertisement (protocol-v2 `version 2` + caps + flush).
    pub(crate) fn handshake(&self) -> crate::Result<Vec<u8>> {
        match self {
            Remote::Http { base } => {
                let url = format!("{base}/info/refs?service=git-upload-pack");
                let (status, body) = get_buffered(url.as_bytes(), Method::GET, None, &[])?;
                if status != 200 {
                    return Err(Error::Http(format!("GET {url} → HTTP {status}")));
                }
                Ok(body)
            }
            Remote::Ssh { .. } => {
                // Over SSH the server sends caps unsolicited on connect; an
                // empty body just opens, reads caps, closes.
                let mut out = Vec::new();
                self.request(&[], |c| {
                    out.extend_from_slice(c);
                    Ok(())
                })?;
                Ok(out)
            }
        }
    }

    /// One protocol-v2 command: send `body`, stream the response to `sink`.
    /// Stateless per call (HTTP semantics) — each call is a fresh connection.
    pub(crate) fn request<S>(&self, body: &[u8], sink: S) -> crate::Result<()>
    where
        S: FnMut(&[u8]) -> crate::Result<()> + Send,
    {
        match self {
            Remote::Http { base } => {
                let url = format!("{base}/git-upload-pack");
                let status = post_streamed(
                    url.as_bytes(),
                    "application/x-git-upload-pack-request",
                    body,
                    sink,
                )?;
                if status != 200 {
                    return Err(Error::Http(format!("POST {url} → HTTP {status}")));
                }
                Ok(())
            }
            #[cfg(unix)]
            Remote::Ssh {
                user_host,
                port,
                path,
            } => ssh::request(user_host, *port, path, body, sink),
            #[cfg(not(unix))]
            Remote::Ssh { .. } => Err(Error::Http(
                "ssh transport not yet implemented on this platform".into(),
            )),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SSH via subprocess `ssh`
// ═══════════════════════════════════════════════════════════════════════════
//
// One `ssh` per request — same stateless shape as HTTP, so the parallel-fetch
// orchestration works unchanged (each bucket spawns its own `ssh`).
// `ControlMaster` is forced off so N spawns are N TCP connections (otherwise
// they'd multiplex over one and we'd lose the bandwidth fan-out).
//
// **libssh2 swap-point**: replace this module's `request()` body with a
// libssh2 session+channel; the signature and call sites stay identical.
#[cfg(unix)]
mod ssh {
    use super::*;
    use bun_core::Fd;
    use bun_sys as sys;
    use core::ffi::{CStr, c_char};

    pub(super) fn request<S>(
        user_host: &str,
        port: Option<u16>,
        path: &str,
        body: &[u8],
        mut sink: S,
    ) -> crate::Result<()>
    where
        S: FnMut(&[u8]) -> crate::Result<()> + Send,
    {
        // Two pipes: child's stdin (we write), child's stdout (we read).
        let [in_r, in_w] = sys::pipe()?;
        let [out_r, out_w] = sys::pipe()?;

        let port_s;
        let mut argv: Vec<&str> = vec![
            "ssh",
            "-o",
            "ControlMaster=no",
            "-o",
            "ControlPath=none",
            "-o",
            "SendEnv=GIT_PROTOCOL",
        ];
        if let Some(p) = port {
            port_s = p.to_string();
            argv.push("-p");
            argv.push(&port_s);
        }
        // `--` ends ssh's own option parsing. `Remote::ssh_checked` already
        // rejected a leading-dash host, but defence in depth costs nothing.
        argv.push("--");
        argv.push(user_host);
        argv.push("git-upload-pack");
        argv.push(path);

        let pid = spawn_with_pipes(&argv, in_r, out_w)?;
        // Parent doesn't need the child's ends.
        let _ = sys::close(in_r);
        let _ = sys::close(out_w);

        // Server sends caps unsolicited; drain them to the first flush-pkt
        // before writing the command (avoids deadlock if caps fill the pipe
        // buffer — they won't, but this is the protocol-correct order).
        let mut pre = Vec::with_capacity(4096);
        drain_until_flush(out_r, &mut pre)?;
        if body.is_empty() {
            // Handshake-only call: caps are the response.
            sink(&pre)?;
            let _ = sys::close(in_w);
        } else {
            // Discard caps (caller already did handshake), send the command,
            // then stream the response.
            write_all(in_w, body)?;
            let _ = sys::close(in_w);
            stream(out_r, &mut sink)?;
        }
        let _ = sys::close(out_r);
        wait(pid)?;
        Ok(())
    }

    /// posix_spawnp `ssh` with the given argv, dup2'ing the pipe fds to its
    /// stdin/stdout. stderr is inherited so auth/host-key prompts surface.
    ///
    /// This is the **libssh2 swap-point**: a native impl replaces this body
    /// with `Session::handshake` + `Channel::exec("git-upload-pack …")`; the
    /// caller's read/write loop on the returned handle stays the same shape.
    #[allow(clippy::as_ptr_cast_mut, clippy::ptr_cast_constness)]
    fn spawn_with_pipes(argv: &[&str], child_stdin: Fd, child_stdout: Fd) -> crate::Result<i32> {
        // NUL-terminate argv strings (own the storage; posix_spawnp copies).
        let mut cstrs: Vec<Vec<u8>> = argv
            .iter()
            .map(|s| {
                let mut v = s.as_bytes().to_vec();
                v.push(0);
                v
            })
            .collect();
        let mut argv_ptrs: Vec<*mut c_char> = cstrs
            .iter_mut()
            .map(|s| s.as_mut_ptr().cast::<c_char>())
            .collect();
        argv_ptrs.push(core::ptr::null_mut());
        // env: inherit + GIT_PROTOCOL=version=2. `environ` is process-global.
        unsafe extern "C" {
            static mut environ: *const *const c_char;
        }
        let proto = c"GIT_PROTOCOL=version=2";
        // SAFETY: `environ` is the libc-maintained env array; we copy its
        // pointers (read-only) and append one static literal. posix_spawnp
        // reads argv/envp before returning, so the borrowed pointers only
        // need to live for this call.
        let mut envp: Vec<*mut c_char> = unsafe {
            let mut v = Vec::new();
            let mut p = environ;
            while !(*p).is_null() {
                v.push((*p).cast_mut());
                p = p.add(1);
            }
            v
        };
        envp.push(proto.as_ptr().cast_mut());
        envp.push(core::ptr::null_mut());

        let mut actions = core::mem::MaybeUninit::<libc::posix_spawn_file_actions_t>::zeroed();
        // SAFETY: zero-init is the documented starting state before *_init;
        // init/adddup2/destroy are paired below.
        unsafe {
            libc::posix_spawn_file_actions_init(actions.as_mut_ptr());
            libc::posix_spawn_file_actions_adddup2(actions.as_mut_ptr(), child_stdin.native(), 0);
            libc::posix_spawn_file_actions_adddup2(actions.as_mut_ptr(), child_stdout.native(), 1);
        }
        let mut pid: libc::pid_t = 0;
        // SAFETY: argv/envp are NUL-terminated arrays of C strings valid for
        // the call; `actions` was initialised above.
        let rc = unsafe {
            libc::posix_spawnp(
                &raw mut pid,
                argv_ptrs[0],
                actions.as_ptr(),
                core::ptr::null(),
                argv_ptrs.as_ptr(),
                envp.as_ptr(),
            )
        };
        // SAFETY: paired with init above.
        unsafe { libc::posix_spawn_file_actions_destroy(actions.as_mut_ptr()) };
        if rc != 0 {
            // SAFETY: strerror returns a static C string for any errno.
            let msg = unsafe { CStr::from_ptr(libc::strerror(rc)) };
            return Err(Error::Http(format!(
                "posix_spawnp ssh failed: {}",
                bstr::BStr::new(msg.to_bytes())
            )));
        }
        Ok(pid)
    }

    fn write_all(fd: Fd, mut buf: &[u8]) -> crate::Result<()> {
        while !buf.is_empty() {
            let n = sys::write(fd, buf)?;
            buf = &buf[n..];
        }
        Ok(())
    }

    fn stream<S: FnMut(&[u8]) -> crate::Result<()>>(fd: Fd, sink: &mut S) -> crate::Result<()> {
        let mut buf = [0u8; 65536];
        loop {
            let n = sys::read(fd, &mut buf)?;
            if n == 0 {
                return Ok(());
            }
            sink(&buf[..n])?;
        }
    }

    /// Read until a flush-pkt (`0000`) is seen; returns everything read
    /// including the flush.
    fn drain_until_flush(fd: Fd, out: &mut Vec<u8>) -> crate::Result<()> {
        let mut buf = [0u8; 4096];
        loop {
            let n = sys::read(fd, &mut buf)?;
            if n == 0 {
                return Ok(());
            }
            out.extend_from_slice(&buf[..n]);
            if out.windows(4).any(|w| w == b"0000") {
                return Ok(());
            }
        }
    }

    fn wait(pid: i32) -> crate::Result<()> {
        let mut status = 0i32;
        // SAFETY: pid was returned by posix_spawnp; status is a valid out-ptr.
        let rc = unsafe { libc::waitpid(pid, &raw mut status, 0) };
        if rc < 0 {
            return Err(Error::Http("waitpid failed".into()));
        }
        if !libc::WIFEXITED(status) || libc::WEXITSTATUS(status) != 0 {
            return Err(Error::Http(format!(
                "ssh exited with status {}",
                libc::WEXITSTATUS(status)
            )));
        }
        Ok(())
    }
}

fn build_headers(content_type: Option<&str>) -> http::HeaderBuilder {
    let mut hb = http::HeaderBuilder::default();
    hb.count(GIT_PROTOCOL.0, GIT_PROTOCOL.1);
    if let Some(ct) = content_type {
        hb.count("Content-Type", ct);
        hb.count("Accept", "application/x-git-upload-pack-result");
    }
    hb.allocate().expect("OOM");
    hb.append(GIT_PROTOCOL.0, GIT_PROTOCOL.1);
    if let Some(ct) = content_type {
        hb.append("Content-Type", ct);
        hb.append("Accept", "application/x-git-upload-pack-result");
    }
    hb
}

#[cfg(test)]
mod tests {
    use super::Remote;

    #[test]
    fn ssh_rejects_option_smuggling() {
        // CVE-2017-1000117 vectors: host position becomes an ssh option.
        for url in [
            "ssh://-oProxyCommand=id/x",
            "ssh://user@-oProxyCommand=id/x",
            "-oProxyCommand=id:path",
            "git@-oProxyCommand=id:path",
        ] {
            assert!(Remote::parse(url).is_err(), "should reject {url}");
        }
        // Path that would become a flag: scp-style gets `./` prefixed.
        match Remote::parse("git@github.com:-upload-pack-flag").unwrap() {
            Remote::Ssh { path, .. } => assert_eq!(path, "./-upload-pack-flag"),
            _ => panic!(),
        }
        // ssh:// path is always absolute.
        match Remote::parse("ssh://h/-x").unwrap() {
            Remote::Ssh { path, .. } => assert_eq!(path, "/-x"),
            _ => panic!(),
        }
    }

    #[test]
    fn rejects_config_injection() {
        for url in [
            "https://h/\n[core]\n\tsshCommand = id",
            "https://h/x\r\nfoo",
            "ssh://h/p\"x",
            "git@h:p\\x",
            "https://h/p\tx",
        ] {
            assert!(Remote::parse(url).is_err(), "should reject {url:?}");
        }
    }

    #[test]
    fn ssh_accepts_normal_urls() {
        for url in [
            "ssh://git@github.com/owner/repo.git",
            "ssh://git@github.com:22/owner/repo.git",
            "git@github.com:owner/repo.git",
        ] {
            assert!(
                matches!(Remote::parse(url), Ok(Remote::Ssh { .. })),
                "{url}"
            );
        }
    }
}
