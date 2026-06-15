//! Git wire protocol v2 — `gitprotocol-v2(5)`.
//!
//! v2 is a request/response RPC over the same pkt-line framing as v0/v1. The
//! client opens with `GET …/info/refs?service=git-upload-pack` carrying
//! `Git-Protocol: version=2`; a v2-capable server replies with a capability
//! advertisement (no refs — that's the point of v2). Subsequent commands are
//! `POST …/git-upload-pack` bodies of the form:
//!
//! ```text
//!   command=<name> LF
//!   [capability lines]
//!   0001                    -- delim-pkt
//!   [command args]
//!   0000                    -- flush-pkt
//! ```
//!
//! We use exactly two commands:
//!   * `ls-refs` → `<oid> <refname>\n` lines, flush-terminated.
//!   * `fetch`   → sectioned response; we consume `packfile` (side-band).
//!
//! v2 is chosen over v0 because `ls-refs` can be filtered server-side
//! (`ref-prefix`) — on repos with hundreds of thousands of refs (every PR
//! head on a big GitHub repo) the v0 advertisement alone is tens of MB.

use crate::pktline::{Pkt, PktReader, PktWriter};
use crate::transport::Remote;
use crate::{Error, Oid, Result};

pub(crate) const AGENT: &str = "agent=bun-git/0";

/// One advertised ref. `target` is set when the server sent
/// `symref-target:<ref>` (HEAD only, in practice).
#[derive(Debug, Clone)]
pub(crate) struct Ref {
    pub(crate) name: String,
    pub(crate) oid: Oid,
    pub(crate) symref_target: Option<String>,
}

/// Server capabilities relevant to the clone path.
#[derive(Default)]
pub(crate) struct Caps {
    /// `fetch=… filter` — server accepts `filter <spec>` (partial clone).
    pub(crate) filter: bool,
}

/// Read the v2 capability advertisement and confirm the server speaks v2.
pub(crate) fn handshake(remote: &Remote) -> Result<Caps> {
    let body = remote.handshake()?;
    let mut r = PktReader::new(body.as_slice());
    // smart-HTTP prefixes the v2 advertisement with
    // `# service=git-upload-pack\n` + flush. The `--stateless-rpc
    // --advertise-refs` form (used by LocalTransport) does **not**. Accept
    // both: peek the first line.
    match r.read_text()? {
        Pkt::Data(d) if d == b"# service=git-upload-pack" => {
            // flush, then the real advertisement
            match r.read()? {
                Pkt::Flush => {}
                _ => return Err(Error::Protocol("expected flush after service line".into())),
            }
            match r.read_text()? {
                Pkt::Data(d) if d == b"version 2" => {}
                Pkt::Data(d) => return Err(unsupported(d)),
                _ => return Err(Error::Protocol("empty capability advertisement".into())),
            }
        }
        Pkt::Data(d) if d == b"version 2" => {}
        Pkt::Data(d) => return Err(unsupported(d)),
        _ => return Err(Error::Protocol("empty info/refs response".into())),
    }
    // Drain capability lines until flush, recording the few we act on.
    let mut caps = Caps::default();
    loop {
        match r.read_text()? {
            Pkt::Flush => return Ok(caps),
            Pkt::Data(d) => {
                if let Some(v) = d.strip_prefix(b"fetch=") {
                    caps.filter = v.split(|&b| b == b' ').any(|w| w == b"filter");
                }
            }
            _ => return Err(Error::Protocol("unexpected delim in capabilities".into())),
        }
    }
}

/// `git check-ref-format` (refs.c:check_refname_component) — the subset that
/// matters for what we write to disk: no control bytes (incl. LF — would
/// inject into packed-refs), no SP / `~^:?*[\\` / `..` / `@{` / leading `.`
/// or `/` / trailing `.` `/` `.lock`, must be `HEAD` or under `refs/`.
fn check_ref_format(raw: &[u8]) -> Result<&str> {
    let bad = |why: &str| {
        Err(Error::Protocol(format!(
            "ls-refs: refusing refname {:?}: {why}",
            bstr::BStr::new(raw)
        )))
    };
    let Ok(s) = core::str::from_utf8(raw) else {
        return bad("not UTF-8");
    };
    if s != "HEAD" && !s.starts_with("refs/") {
        return bad("not HEAD or refs/*");
    }
    // `"` isn't in git's own reject set, but a server-supplied
    // `symref-target:` lands inside `[branch "<name>"]` in `.git/config`;
    // rejecting it here keeps the defence at the parse layer instead of the
    // writer.
    if s.bytes()
        .any(|b| b <= 0x20 || b == 0x7f || b" ~^:?*[\\\"".contains(&b))
    {
        return bad("contains control or reserved character");
    }
    if s.contains("..") || s.contains("@{") || s.contains("//") {
        return bad("contains '..', '@{', or '//'");
    }
    if s.ends_with(['/', '.']) || s.ends_with(".lock") || s.starts_with('/') {
        return bad("invalid leading/trailing component");
    }
    if s.split('/').any(|c| c.is_empty() || c.starts_with('.')) {
        return bad("empty or dot-leading component");
    }
    Ok(s)
}

#[cold]
fn unsupported(first: &[u8]) -> Error {
    Error::Protocol(format!(
        "server does not speak protocol v2 (first line: {:?})",
        bstr::BStr::new(first)
    ))
}

/// `ls-refs` filtered to `HEAD` + `refs/heads/*` + `refs/tags/*`.
pub(crate) fn ls_refs(remote: &Remote) -> Result<Vec<Ref>> {
    let mut w = PktWriter::new();
    w.text("command=ls-refs");
    w.text(AGENT);
    w.text("object-format=sha1");
    w.delim();
    w.text("peel");
    w.text("symrefs");
    w.text("ref-prefix HEAD");
    w.text("ref-prefix refs/heads/");
    w.text("ref-prefix refs/tags/");
    w.flush();
    let body = w.finish();

    let mut resp = Vec::new();
    remote.request(&body, |c| {
        resp.extend_from_slice(c);
        Ok(())
    })?;

    let mut out = Vec::new();
    let mut r = PktReader::new(resp.as_slice());
    loop {
        match r.read_text()? {
            Pkt::Flush => break,
            Pkt::Data(line) => out.push(parse_ref_line(line)?),
            other => {
                return Err(Error::Protocol(format!("unexpected {other:?} in ls-refs")));
            }
        }
    }
    Ok(out)
}

fn parse_ref_line(line: &[u8]) -> Result<Ref> {
    // `<oid> <refname>[ symref-target:<ref>][ peeled:<oid>]`
    let mut parts = line.split(|&b| b == b' ');
    let oid = parts
        .next()
        .and_then(Oid::from_hex)
        .ok_or_else(|| Error::Protocol("ls-refs: bad oid".into()))?;
    // The server controls refnames; they go straight into `.git/packed-refs`
    // and `.git/HEAD`, so anything outside `git check-ref-format` rules is a
    // ref-injection (a `\n` would let the server append arbitrary lines).
    let raw = parts
        .next()
        .ok_or_else(|| Error::Protocol("ls-refs: missing refname".into()))?;
    let name = check_ref_format(raw)?.to_owned();
    let mut symref_target = None;
    for attr in parts {
        if let Some(t) = attr.strip_prefix(b"symref-target:") {
            symref_target = Some(check_ref_format(t)?.to_owned());
        }
        // `peeled:<oid>` ignored — we don't write peeled tags into
        // packed-refs yet.
    }
    Ok(Ref {
        name,
        oid,
        symref_target,
    })
}

/// `fetch` for the given wants (no haves — fresh clone). Side-band pack data
/// is streamed to `pack_sink` on the bun HTTP thread.
///
/// `filter` is the protocol-v2 object filter (`blob:none`, `tree:0`, …) or
/// `None` for a full fetch. When set, the resulting pack is a *promisor* pack
/// — objects the filter excluded are simply absent.
pub(crate) fn fetch<S>(
    remote: &Remote,
    wants: &[Oid],
    haves: &[Oid],
    filter: Option<&str>,
    quiet: bool,
    pack_sink: S,
) -> Result<()>
where
    S: FnMut(&[u8]) -> Result<()> + Send,
{
    let mut w = PktWriter::new();
    w.text("command=fetch");
    w.text(AGENT);
    w.text("object-format=sha1");
    w.delim();
    // No `have` lines → server packs from roots. `done` tells the server not
    // to wait for negotiation rounds.
    w.text("ofs-delta");
    if let Some(f) = filter {
        w.text(&format!("filter {f}"));
    }
    for oid in wants {
        w.text(&format!("want {oid}"));
    }
    for oid in haves {
        w.text(&format!("have {oid}"));
    }
    if quiet {
        w.text("no-progress");
    }
    w.text("done");
    w.flush();
    let body = w.finish();

    // Demux side-band as bytes arrive. The closure borrows `demux` from this
    // frame; sound because `Remote::request` blocks until the last callback
    // has returned, so the borrow is live for every invocation.
    let mut demux = SidebandDemux::new(pack_sink, quiet);
    remote.request(&body, |chunk| demux.feed(chunk))?;
    demux.finish()
}

/// Incremental pkt-line + side-band-64k demuxer for the `fetch` response.
///
/// State machine:
///   1. Section headers (`packfile\n`, optionally preceded by
///      `acknowledgments`/`shallow-info` we don't request) until we see
///      `packfile`.
///   2. Side-band data lines: first payload byte is the band (1/2/3).
///   3. Flush ends the response.
struct SidebandDemux<P> {
    /// Bytes not yet forming a complete pkt-line.
    buf: Vec<u8>,
    in_pack_section: bool,
    saw_flush: bool,
    quiet: bool,
    pack: P,
}

impl<P: FnMut(&[u8]) -> Result<()>> SidebandDemux<P> {
    fn new(pack: P, quiet: bool) -> Self {
        Self {
            buf: Vec::with_capacity(65536),
            in_pack_section: false,
            saw_flush: false,
            quiet,
            pack,
        }
    }

    fn feed(&mut self, chunk: &[u8]) -> Result<()> {
        self.buf.extend_from_slice(chunk);
        // Drain every complete pkt-line in `buf`. Work with offsets, not
        // slices, so the disjoint borrows of `self.buf` vs `self.pack`/
        // `self.progress` are visible to the borrow checker.
        let mut consumed = 0usize;
        loop {
            let avail = self.buf.len() - consumed;
            if avail < 4 {
                break;
            }
            let len = parse_hex4(&self.buf[consumed..consumed + 4])?;
            match len {
                0 => {
                    consumed += 4;
                    self.saw_flush = true;
                    // Response is over; any trailing bytes are reported by
                    // `finish`.
                }
                1 => consumed += 4, // delim-pkt between sections
                2 => {
                    consumed += 4; // response-end-pkt; treat as terminator
                    self.saw_flush = true;
                }
                3 => return Err(Error::PktLine("reserved length 0003")),
                _ => {
                    if avail < len {
                        break; // need more bytes
                    }
                    let payload = &self.buf[consumed + 4..consumed + len];
                    consumed += len;
                    if self.in_pack_section {
                        let (&band, data) = payload
                            .split_first()
                            .ok_or_else(|| Error::Protocol("empty side-band line".into()))?;
                        match band {
                            1 => (self.pack)(data)?,
                            2 => {
                                if !self.quiet {
                                    // Band 2 is human progress text; runs on
                                    // the HTTP thread, so go straight to the
                                    // raw fd rather than the buffered Output.
                                    let _ = bun_sys::write(bun_core::Fd::stderr(), data);
                                }
                            }
                            3 => {
                                return Err(Error::Remote(bstr::BStr::new(data).to_string()));
                            }
                            n => {
                                return Err(Error::Protocol(format!("invalid side-band {n}")));
                            }
                        }
                    } else {
                        let line = payload.strip_suffix(b"\n").unwrap_or(payload);
                        if line == b"packfile" {
                            self.in_pack_section = true;
                        } else if let Some(err) = line.strip_prefix(b"ERR ") {
                            return Err(Error::Remote(bstr::BStr::new(err).to_string()));
                        }
                        // Any other section header (`acknowledgments`, `NAK`,
                        // `wanted-refs`, …) is skipped — we sent `done` with
                        // no haves, so the server goes straight to `packfile`.
                    }
                }
            }
        }
        if consumed > 0 {
            self.buf.drain(..consumed);
        }
        Ok(())
    }

    fn finish(self) -> Result<()> {
        if !self.saw_flush {
            return Err(Error::Protocol(
                "fetch response ended without flush-pkt".into(),
            ));
        }
        if !self.in_pack_section {
            return Err(Error::Protocol(
                "fetch response contained no packfile section".into(),
            ));
        }
        if !self.buf.is_empty() {
            return Err(Error::Protocol(format!(
                "{} trailing bytes after fetch flush-pkt",
                self.buf.len()
            )));
        }
        Ok(())
    }
}

fn parse_hex4(b: &[u8]) -> Result<usize> {
    let mut n = 0usize;
    for &c in &b[..4] {
        let d = match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            b'A'..=b'F' => c - b'A' + 10,
            _ => return Err(Error::PktLine("non-hex length prefix")),
        };
        n = (n << 4) | usize::from(d);
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::check_ref_format;

    #[test]
    fn refname_rejects_injection() {
        for bad in [
            &b"refs/heads/main\nevil 0000000000000000000000000000000000000000"[..],
            b"refs/heads/ma\x00in",
            b"refs/heads/ma in",
            b"refs/heads/..",
            b"refs/heads/.hidden",
            b"refs/heads/x.lock",
            b"main",
            b"refs/heads/a~b",
            b"refs/heads/a:b",
            b"refs/heads/a\\b",
            b"refs/heads//double",
        ] {
            assert!(check_ref_format(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn refname_accepts_normal() {
        for ok in [
            "HEAD",
            "refs/heads/main",
            "refs/tags/v1.2.3-rc.1",
            "refs/remotes/origin/feat/x",
        ] {
            assert!(check_ref_format(ok.as_bytes()).is_ok(), "{ok}");
        }
    }
}
