//! Wire protocol over the fd-3 IPC channel: length-prefixed binary frames.
//!   [u32 LE payload_len][u8 kind][payload]
//! Strings within a payload are [u32 LE len][bytes].

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Kind {
    // worker → coordinator
    /// (empty)
    Ready,
    /// u32 file_idx
    FileStart,
    /// u32 file_idx, str formatted_line (ANSI included; printed verbatim)
    TestDone,
    /// 9 × u32: file_idx, pass, fail, skip, todo, expectations, skipped_label, files, unhandled
    FileDone,
    /// 3 × str: failures, skips, todos (verbatim repeat-buffer bytes)
    RepeatBufs,
    /// str path
    JunitFile,
    /// str path
    CoverageFile,
    // coordinator → worker
    /// u32 file_idx, str path
    Run,
    /// (empty)
    Shutdown,
}

/// Upper bound on a single IPC frame payload. The protocol is internal but
/// fd 3 is reachable from test JS via `fs.writeSync(3, ...)`; rejecting
/// nonsensical lengths up-front prevents both a `5 + len` u32 overflow and
/// an unbounded allocation.
pub const MAX_PAYLOAD: u32 = 64 * 1024 * 1024;

/// Minimal length-prefixed binary codec. Frames build into a reusable buffer
/// then flush in a single write so partial reads on the other side never see a
/// torn header.
#[derive(Default)]
pub struct Frame {
    buf: Vec<u8>,
}

impl Frame {
    pub fn begin(&mut self, kind: Kind) {
        self.buf.clear();
        // reserve header; payload_len patched in send()
        self.buf.extend_from_slice(&[0u8; 4]);
        self.buf.push(kind as u8);
    }

    pub fn u32_(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    pub fn str(&mut self, s: &[u8]) {
        // Never let a single frame exceed `MAX_PAYLOAD` — the receiver treats that
        // as a corrupt-channel signal and closes, which would surface as a spurious
        // worker crash. Truncate the string in place instead. Leave a small
        // headroom so a few following u32s/short paths in the same frame still fit.
        const TRUNC: &[u8] = b"\n... [output truncated: would exceed --parallel IPC frame limit]\n";
        const HEADROOM: usize = 256;
        let used: usize = (self.buf.len() - 5) + 4; // current payload + str-len prefix
        let room: usize = if (MAX_PAYLOAD as usize) > used + HEADROOM {
            (MAX_PAYLOAD as usize) - used - HEADROOM
        } else {
            0
        };
        if s.len() <= room {
            self.u32_(u32::try_from(s.len()).unwrap());
            self.buf.extend_from_slice(s);
            return;
        }
        let keep: usize = if room > TRUNC.len() { room - TRUNC.len() } else { 0 };
        self.u32_(u32::try_from(keep + TRUNC.len()).unwrap());
        self.buf.extend_from_slice(&s[0..keep]);
        self.buf.extend_from_slice(TRUNC);
    }

    /// Finalize the header and return the encoded bytes. Caller hands them to
    /// `Channel.send`. Valid until the next `begin()`.
    pub fn finish(&mut self) -> &[u8] {
        let payload_len: u32 = u32::try_from(self.buf.len() - 5).unwrap();
        debug_assert!(payload_len <= MAX_PAYLOAD);
        self.buf[0..4].copy_from_slice(&payload_len.to_le_bytes());
        &self.buf
    }
}

// `deinit` dropped: `Vec<u8>` frees on Drop.

/// Payload reader; bounds-checked, returns zero/empty on truncation.
pub struct Reader<'a> {
    // TODO(port): lifetime — borrowed cursor over caller-owned payload slice
    pub p: &'a [u8],
}

impl<'a> Reader<'a> {
    pub fn u32_(&mut self) -> u32 {
        if self.p.len() < 4 {
            return 0;
        }
        let v = u32::from_le_bytes(self.p[0..4].try_into().unwrap());
        self.p = &self.p[4..];
        v
    }

    pub fn str(&mut self) -> &'a [u8] {
        let n = self.u32_() as usize;
        if self.p.len() < n {
            return b"";
        }
        let s = &self.p[0..n];
        self.p = &self.p[n..];
        s
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/test/parallel/Frame.zig (93 lines)
//   confidence: high
//   todos:      1
//   notes:      Reader<'a> carries a lifetime for the borrowed payload cursor; revisit if Phase B forbids struct lifetimes here.
// ──────────────────────────────────────────────────────────────────────────
