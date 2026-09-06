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
    /// u32 file_idx, str formatted_line (ANSI included; printed verbatim);
    /// then, only when the worker runs with `--reporter`, the structured
    /// result (`runner::encode_test_case`): u32 status, u32 assertions,
    /// u64 elapsed_ns, u32 line, str name, u32 n × {str scope_name,
    /// u32 scope_line}, u32 has_failure [, str name, str message, str body]
    TestDone,
    /// 9 × u32: file_idx, pass, fail, skip, todo, expectations, skipped_label,
    /// files, unhandled; u64 elapsed_ns
    FileDone,
    /// 3 × str: failures, skips, todos (verbatim repeat-buffer bytes)
    RepeatBufs,
    // coordinator → worker
    /// u32 file_idx, str path
    Run,
    /// (empty)
    Shutdown,
    /// str report — one source file's coverage from this worker, sent at exit
    /// as `bun_sourcemap_jsc::code_coverage::wire`. The coordinator merges
    /// every worker's per file and writes the one report.
    CoverageFile,
}

impl TryFrom<u8> for Kind {
    type Error = ();
    fn try_from(v: u8) -> Result<Self, ()> {
        // Int → enum: valid only for declared discriminants.
        Ok(match v {
            0 => Kind::Ready,
            1 => Kind::FileStart,
            2 => Kind::TestDone,
            3 => Kind::FileDone,
            4 => Kind::RepeatBufs,
            5 => Kind::Run,
            6 => Kind::Shutdown,
            7 => Kind::CoverageFile,
            _ => return Err(()),
        })
    }
}

/// Upper bound on a single IPC frame payload. The protocol is internal but
/// fd 3 is reachable from test JS via `fs.writeSync(3, ...)`; rejecting
/// nonsensical lengths up-front prevents both a `5 + len` u32 overflow and
/// an unbounded allocation.
pub(crate) const MAX_PAYLOAD: u32 = 64 * 1024 * 1024;

/// Minimal length-prefixed binary codec. Frames build into a reusable buffer
/// then flush in a single write so partial reads on the other side never see a
/// torn header.
#[derive(Default)]
pub struct Frame {
    buf: Vec<u8>,
}

impl Frame {
    pub(crate) const DEFAULT: Self = Self { buf: Vec::new() };

    pub(crate) fn begin(&mut self, kind: Kind) {
        self.buf.clear();
        // reserve header; payload_len patched in send()
        self.buf.extend_from_slice(&[0u8; 4]);
        self.buf.push(kind as u8);
    }

    pub(crate) fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    pub(crate) fn u64(&mut self, v: u64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    pub(crate) fn str(&mut self, s: &[u8]) {
        // Never let a single frame exceed `MAX_PAYLOAD` — the receiver treats that
        // as a corrupt-channel signal and closes, which would surface as a spurious
        // worker crash. Truncate the string in place instead. Leave headroom
        // so the fixed-size tail of the frame (u32s, short paths, and the
        // 4-byte prefixes of any further strings, which go empty) still fits.
        const TRUNC: &[u8] = b"\n... [output truncated: would exceed --parallel IPC frame limit]\n";
        const HEADROOM: usize = 4096;
        let used: usize = (self.buf.len() - 5) + 4; // current payload + str-len prefix
        let room: usize = ((MAX_PAYLOAD as usize) - HEADROOM).saturating_sub(used);
        let (keep, marker): (usize, &[u8]) = if s.len() <= room {
            (s.len(), b"")
        } else if room >= TRUNC.len() {
            (room - TRUNC.len(), TRUNC)
        } else {
            (0, b"")
        };
        self.u32(u32::try_from(keep + marker.len()).unwrap());
        self.buf.extend_from_slice(&s[0..keep]);
        self.buf.extend_from_slice(marker);
    }

    /// Finalize the header and return the encoded bytes. Caller hands them to
    /// `Channel.send`. Valid until the next `begin()`.
    pub(crate) fn finish(&mut self) -> &[u8] {
        let payload_len: u32 = u32::try_from(self.buf.len() - 5).unwrap();
        debug_assert!(payload_len <= MAX_PAYLOAD);
        self.buf[0..4].copy_from_slice(&payload_len.to_le_bytes());
        &self.buf
    }
}

// `deinit` dropped: `Vec<u8>` frees on Drop.

/// Payload reader; bounds-checked, returns zero/empty on truncation.
pub struct Reader<'a> {
    pub p: &'a [u8],
}

impl<'a> Reader<'a> {
    pub(crate) fn u32(&mut self) -> u32 {
        if self.p.len() < 4 {
            return 0;
        }
        let v = u32::from_le_bytes(self.p[0..4].try_into().unwrap());
        self.p = &self.p[4..];
        v
    }

    pub(crate) fn u64(&mut self) -> u64 {
        if self.p.len() < 8 {
            return 0;
        }
        let v = u64::from_le_bytes(self.p[0..8].try_into().unwrap());
        self.p = &self.p[8..];
        v
    }

    pub(crate) fn str(&mut self) -> &'a [u8] {
        let n = self.u32() as usize;
        if self.p.len() < n {
            return b"";
        }
        let s = &self.p[0..n];
        self.p = &self.p[n..];
        s
    }
}
