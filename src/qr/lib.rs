//! QR Code encoder (ISO/IEC 18004).
//!
//! Ported from Nayuki's qrcodegen reference implementation (MIT license,
//! https://www.nayuki.io/page/qr-code-generator-library).
#![allow(clippy::needless_range_loop)]

use core::fmt;

pub const VERSION_MIN: u8 = 1;
pub const VERSION_MAX: u8 = 40;

/// Error correction level. Higher levels tolerate more damage but reduce
/// data capacity.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Ecc {
    /// ~7% of codewords can be restored.
    Low,
    /// ~15% of codewords can be restored.
    Medium,
    /// ~25% of codewords can be restored.
    Quartile,
    /// ~30% of codewords can be restored.
    High,
}

impl Ecc {
    /// 2-bit value placed into the format information (not the enum ordinal).
    fn format_bits(self) -> u8 {
        match self {
            Ecc::Low => 1,
            Ecc::Medium => 0,
            Ecc::Quartile => 3,
            Ecc::High => 2,
        }
    }

    fn ordinal(self) -> usize {
        match self {
            Ecc::Low => 0,
            Ecc::Medium => 1,
            Ecc::Quartile => 2,
            Ecc::High => 3,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Numeric,
    Alphanumeric,
    Byte,
    Kanji,
    Eci,
}

impl Mode {
    fn mode_bits(self) -> u8 {
        match self {
            Mode::Numeric => 0x1,
            Mode::Alphanumeric => 0x2,
            Mode::Byte => 0x4,
            Mode::Kanji => 0x8,
            Mode::Eci => 0x7,
        }
    }

    /// Bit width of the character-count field for the given version.
    fn char_count_bits(self, version: u8) -> u8 {
        debug_assert!((VERSION_MIN..=VERSION_MAX).contains(&version));
        let group = usize::from((version + 7) / 17);
        match self {
            Mode::Numeric => [10, 12, 14][group],
            Mode::Alphanumeric => [9, 11, 13][group],
            Mode::Byte => [8, 16, 16][group],
            Mode::Kanji => [8, 10, 12][group],
            Mode::Eci => 0,
        }
    }
}

/// Reasons encoding can fail. All are user-reachable; none should panic.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EncodeError {
    /// Data does not fit even at the max allowed version.
    DataTooLong { max_bits: usize, need_bits: usize },
    /// Explicit `version` outside 1..=40.
    InvalidVersion,
    /// Explicit `mask` outside 0..=7.
    InvalidMask,
    /// `min_version > max_version`.
    InvalidVersionRange,
}

impl fmt::Display for EncodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            EncodeError::DataTooLong {
                max_bits,
                need_bits,
            } => write!(
                f,
                "data too long: needs {} bits but version allows at most {}",
                need_bits, max_bits
            ),
            EncodeError::InvalidVersion => write!(f, "version must be between 1 and 40"),
            EncodeError::InvalidMask => write!(f, "mask must be between 0 and 7"),
            EncodeError::InvalidVersionRange => {
                write!(f, "minVersion must be <= maxVersion")
            }
        }
    }
}

/// Growable bit buffer, MSB-first.
#[derive(Default, Clone)]
struct BitBuffer(Vec<bool>);

impl BitBuffer {
    fn len(&self) -> usize {
        self.0.len()
    }

    /// Appends the low `len` bits of `val`, MSB first.
    fn append_bits(&mut self, val: u32, len: u8) {
        debug_assert!(len <= 31 && (val >> len) == 0 || len == 32);
        for i in (0..len).rev() {
            self.0.push((val >> i) & 1 != 0);
        }
    }
}

/// One encoded segment (mode + char count + packed bit data).
pub struct Segment {
    mode: Mode,
    /// Character count as defined by the mode, not `data.len()`.
    num_chars: usize,
    data: Vec<bool>,
}

impl Segment {
    /// Byte-mode segment from raw bytes (any binary data, or UTF-8 text).
    pub fn make_bytes(data: &[u8]) -> Segment {
        let mut bb = BitBuffer::default();
        for &b in data {
            bb.append_bits(u32::from(b), 8);
        }
        Segment {
            mode: Mode::Byte,
            num_chars: data.len(),
            data: bb.0,
        }
    }

    /// Numeric-mode segment. Caller guarantees every byte is `b'0'..=b'9'`.
    pub fn make_numeric(digits: &[u8]) -> Segment {
        let mut bb = BitBuffer::default();
        let mut i = 0;
        while i + 3 <= digits.len() {
            let n = u32::from(digits[i] - b'0') * 100
                + u32::from(digits[i + 1] - b'0') * 10
                + u32::from(digits[i + 2] - b'0');
            bb.append_bits(n, 10);
            i += 3;
        }
        let rest = digits.len() - i;
        if rest == 2 {
            let n = u32::from(digits[i] - b'0') * 10 + u32::from(digits[i + 1] - b'0');
            bb.append_bits(n, 7);
        } else if rest == 1 {
            bb.append_bits(u32::from(digits[i] - b'0'), 4);
        }
        Segment {
            mode: Mode::Numeric,
            num_chars: digits.len(),
            data: bb.0,
        }
    }

    /// Alphanumeric-mode segment. Caller guarantees each byte is in the
    /// 45-char alphanumeric set.
    pub fn make_alphanumeric(text: &[u8]) -> Segment {
        let mut bb = BitBuffer::default();
        let mut i = 0;
        while i + 2 <= text.len() {
            let n = u32::from(alnum_value(text[i])) * 45 + u32::from(alnum_value(text[i + 1]));
            bb.append_bits(n, 11);
            i += 2;
        }
        if i < text.len() {
            bb.append_bits(u32::from(alnum_value(text[i])), 6);
        }
        Segment {
            mode: Mode::Alphanumeric,
            num_chars: text.len(),
            data: bb.0,
        }
    }

    /// ECI designator segment for the given assignment value.
    pub fn make_eci(value: u32) -> Result<Segment, EncodeError> {
        let mut bb = BitBuffer::default();
        if value < (1 << 7) {
            bb.append_bits(value, 8);
        } else if value < (1 << 14) {
            bb.append_bits(0b10, 2);
            bb.append_bits(value, 14);
        } else if value < 1_000_000 {
            bb.append_bits(0b110, 3);
            bb.append_bits(value, 21);
        } else {
            return Err(EncodeError::DataTooLong {
                max_bits: 0,
                need_bits: 0,
            });
        }
        Ok(Segment {
            mode: Mode::Eci,
            num_chars: 0,
            data: bb.0,
        })
    }

    /// Chooses the most compact single-segment encoding for `text`.
    pub fn make_segments(text: &[u8]) -> Vec<Segment> {
        if text.is_empty() {
            return Vec::new();
        }
        if text.iter().all(|&b| b.is_ascii_digit()) {
            return vec![Segment::make_numeric(text)];
        }
        if text.iter().all(|&b| is_alnum(b)) {
            return vec![Segment::make_alphanumeric(text)];
        }
        vec![Segment::make_bytes(text)]
    }

    /// Total bit length of `segs` at `version`, or None on overflow.
    fn total_bits(segs: &[Segment], version: u8) -> Option<usize> {
        let mut total: usize = 0;
        for seg in segs {
            let cc_bits = seg.mode.char_count_bits(version);
            if seg.num_chars >= (1usize << cc_bits) {
                return None;
            }
            total = total.checked_add(4 + usize::from(cc_bits) + seg.data.len())?;
        }
        Some(total)
    }
}

const ALNUM_CHARSET: &[u8; 45] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

fn is_alnum(b: u8) -> bool {
    ALNUM_CHARSET.contains(&b)
}

fn alnum_value(b: u8) -> u8 {
    ALNUM_CHARSET
        .iter()
        .position(|&c| c == b)
        .expect("caller guarantees alnum") as u8
}

/// An encoded QR symbol.
pub struct QrCode {
    version: u8,
    ecc: Ecc,
    size: u8,
    mask: u8,
    /// Row-major, `size*size` entries, 1 = dark, 0 = light.
    modules: Vec<u8>,
    /// Parallel grid marking function-pattern modules (not maskable).
    is_function: Vec<bool>,
}

impl QrCode {
    pub fn version(&self) -> u8 {
        self.version
    }
    pub fn size(&self) -> u8 {
        self.size
    }
    pub fn ecc(&self) -> Ecc {
        self.ecc
    }
    pub fn mask(&self) -> u8 {
        self.mask
    }
    pub fn modules(&self) -> &[u8] {
        &self.modules
    }
    pub fn into_modules(self) -> Vec<u8> {
        self.modules
    }

    /// True if the module at `(x, y)` is dark. Coordinates outside the grid
    /// return false (the quiet zone).
    pub fn module(&self, x: i32, y: i32) -> bool {
        let s = i32::from(self.size);
        if x < 0 || y < 0 || x >= s || y >= s {
            return false;
        }
        self.modules[(y * s + x) as usize] != 0
    }

    /// Encode arbitrary text/bytes. Picks the smallest single-segment mode
    /// that fits, chooses the smallest version, and boosts ECC if it costs
    /// no extra version.
    pub fn encode_text(text: &[u8], ecc: Ecc) -> Result<QrCode, EncodeError> {
        let segs = Segment::make_segments(text);
        QrCode::encode_segments(&segs, ecc, VERSION_MIN, VERSION_MAX, None, true)
    }

    /// Encode raw bytes in byte mode only (no numeric/alnum analysis).
    pub fn encode_binary(data: &[u8], ecc: Ecc) -> Result<QrCode, EncodeError> {
        let segs = [Segment::make_bytes(data)];
        QrCode::encode_segments(&segs, ecc, VERSION_MIN, VERSION_MAX, None, true)
    }

    /// Full-control encoder entry point.
    pub fn encode_segments(
        segs: &[Segment],
        mut ecc: Ecc,
        min_version: u8,
        max_version: u8,
        mask: Option<u8>,
        boost_ecc: bool,
    ) -> Result<QrCode, EncodeError> {
        if !(VERSION_MIN..=VERSION_MAX).contains(&min_version)
            || !(VERSION_MIN..=VERSION_MAX).contains(&max_version)
        {
            return Err(EncodeError::InvalidVersion);
        }
        if min_version > max_version {
            return Err(EncodeError::InvalidVersionRange);
        }
        if let Some(m) = mask {
            if m > 7 {
                return Err(EncodeError::InvalidMask);
            }
        }

        // Find smallest version that fits.
        let mut version = min_version;
        let used_bits: usize;
        loop {
            let capacity = data_codeword_count(version, ecc) * 8;
            match Segment::total_bits(segs, version) {
                Some(n) if n <= capacity => {
                    used_bits = n;
                    break;
                }
                _ if version >= max_version => {
                    let need = Segment::total_bits(segs, max_version).unwrap_or(usize::MAX);
                    return Err(EncodeError::DataTooLong {
                        max_bits: data_codeword_count(max_version, ecc) * 8,
                        need_bits: need,
                    });
                }
                _ => version += 1,
            }
        }

        // Boost ECC while the data still fits at the chosen version.
        if boost_ecc {
            for &higher in &[Ecc::Medium, Ecc::Quartile, Ecc::High] {
                if used_bits <= data_codeword_count(version, higher) * 8 {
                    ecc = higher;
                }
            }
        }

        // Pack mode/count/data for each segment.
        let mut bb = BitBuffer::default();
        for seg in segs {
            bb.append_bits(u32::from(seg.mode.mode_bits()), 4);
            bb.append_bits(seg.num_chars as u32, seg.mode.char_count_bits(version));
            bb.0.extend_from_slice(&seg.data);
        }
        debug_assert_eq!(bb.len(), used_bits);

        // Terminator + byte align.
        let capacity = data_codeword_count(version, ecc) * 8;
        debug_assert!(bb.len() <= capacity);
        let term = core::cmp::min(4, capacity - bb.len());
        bb.append_bits(0, term as u8);
        let pad_to_byte = (8 - bb.len() % 8) % 8;
        bb.append_bits(0, pad_to_byte as u8);
        debug_assert_eq!(bb.len() % 8, 0);

        // Pad bytes.
        let mut pad: u8 = 0xEC;
        while bb.len() < capacity {
            bb.append_bits(u32::from(pad), 8);
            pad ^= 0xEC ^ 0x11;
        }

        // Bits → bytes.
        let mut codewords = vec![0u8; bb.len() / 8];
        for (i, &bit) in bb.0.iter().enumerate() {
            codewords[i >> 3] |= u8::from(bit) << (7 - (i & 7));
        }

        Ok(QrCode::from_codewords(version, ecc, &codewords, mask))
    }

    fn from_codewords(version: u8, ecc: Ecc, data: &[u8], mask: Option<u8>) -> QrCode {
        let size = version * 4 + 17;
        let area = usize::from(size) * usize::from(size);
        let mut qr = QrCode {
            version,
            ecc,
            size,
            mask: 0,
            modules: vec![0u8; area],
            is_function: vec![false; area],
        };
        qr.draw_function_patterns();
        let all = qr.interleave_with_ecc(data);
        qr.draw_codewords(&all);

        // Mask selection.
        let chosen = match mask {
            Some(m) => m,
            None => {
                let mut best = 0u8;
                let mut best_penalty = i32::MAX;
                for m in 0..8 {
                    qr.apply_mask(m);
                    qr.draw_format_bits(m);
                    let p = qr.penalty_score();
                    if p < best_penalty {
                        best = m;
                        best_penalty = p;
                    }
                    qr.apply_mask(m); // undo (XOR)
                }
                best
            }
        };
        qr.mask = chosen;
        qr.apply_mask(chosen);
        qr.draw_format_bits(chosen);
        qr.is_function = Vec::new();
        qr
    }

    fn idx(&self, x: i32, y: i32) -> usize {
        (y * i32::from(self.size) + x) as usize
    }

    fn set_function(&mut self, x: i32, y: i32, dark: bool) {
        let i = self.idx(x, y);
        self.modules[i] = u8::from(dark);
        self.is_function[i] = true;
    }

    fn draw_function_patterns(&mut self) {
        let s = i32::from(self.size);
        // Timing.
        for i in 0..s {
            self.set_function(6, i, i % 2 == 0);
            self.set_function(i, 6, i % 2 == 0);
        }
        // Finders.
        self.draw_finder(3, 3);
        self.draw_finder(s - 4, 3);
        self.draw_finder(3, s - 4);
        // Alignment.
        let aligns = alignment_positions(self.version);
        let n = aligns.len();
        for i in 0..n {
            for j in 0..n {
                // Skip the three finder corners.
                if (i == 0 && j == 0) || (i == 0 && j == n - 1) || (i == n - 1 && j == 0) {
                    continue;
                }
                self.draw_alignment(i32::from(aligns[i]), i32::from(aligns[j]));
            }
        }
        // Format/version placeholders (real bits written later).
        self.draw_format_bits(0);
        self.draw_version();
    }

    fn draw_finder(&mut self, cx: i32, cy: i32) {
        for dy in -4..=4 {
            for dx in -4..=4 {
                let x = cx + dx;
                let y = cy + dy;
                if x < 0 || y < 0 || x >= i32::from(self.size) || y >= i32::from(self.size) {
                    continue;
                }
                let d = dx.abs().max(dy.abs());
                self.set_function(x, y, d != 2 && d != 4);
            }
        }
    }

    fn draw_alignment(&mut self, cx: i32, cy: i32) {
        for dy in -2..=2i32 {
            for dx in -2..=2i32 {
                let d = dx.abs().max(dy.abs());
                self.set_function(cx + dx, cy + dy, d != 1);
            }
        }
    }

    fn draw_format_bits(&mut self, mask: u8) {
        let data: u32 = (u32::from(self.ecc.format_bits()) << 3) | u32::from(mask);
        let mut rem = data;
        for _ in 0..10 {
            rem = (rem << 1) ^ ((rem >> 9) * 0x537);
        }
        let bits = ((data << 10) | rem) ^ 0x5412;
        debug_assert!(bits >> 15 == 0);
        let s = i32::from(self.size);
        // First copy.
        for i in 0..6 {
            self.set_function(8, i, (bits >> i) & 1 != 0);
        }
        self.set_function(8, 7, (bits >> 6) & 1 != 0);
        self.set_function(8, 8, (bits >> 7) & 1 != 0);
        self.set_function(7, 8, (bits >> 8) & 1 != 0);
        for i in 9..15 {
            self.set_function(14 - i, 8, (bits >> i) & 1 != 0);
        }
        // Second copy.
        for i in 0..8 {
            self.set_function(s - 1 - i, 8, (bits >> i) & 1 != 0);
        }
        for i in 8..15 {
            self.set_function(8, s - 15 + i, (bits >> i) & 1 != 0);
        }
        self.set_function(8, s - 8, true);
    }

    fn draw_version(&mut self) {
        if self.version < 7 {
            return;
        }
        let mut rem = u32::from(self.version);
        for _ in 0..12 {
            rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
        }
        let bits = (u32::from(self.version) << 12) | rem;
        debug_assert!(bits >> 18 == 0);
        let s = i32::from(self.size);
        for i in 0..18 {
            let bit = (bits >> i) & 1 != 0;
            let a = s - 11 + (i % 3);
            let b = i / 3;
            self.set_function(a, b, bit);
            self.set_function(b, a, bit);
        }
    }

    fn interleave_with_ecc(&self, data: &[u8]) -> Vec<u8> {
        let ver = self.version;
        let ecc = self.ecc;
        let num_blocks = NUM_ERROR_CORRECTION_BLOCKS[ecc.ordinal()][usize::from(ver)] as usize;
        let ecc_len = ECC_CODEWORDS_PER_BLOCK[ecc.ordinal()][usize::from(ver)] as usize;
        let raw = raw_codeword_count(ver);
        let short_blocks = num_blocks - raw % num_blocks;
        let short_len = raw / num_blocks;

        let rs = reed_solomon_divisor(ecc_len);
        let mut blocks: Vec<Vec<u8>> = Vec::with_capacity(num_blocks);
        let mut k = 0usize;
        for i in 0..num_blocks {
            let dat_len = short_len - ecc_len + usize::from(i >= short_blocks);
            let dat = &data[k..k + dat_len];
            k += dat_len;
            let ecc_bytes = reed_solomon_remainder(dat, &rs);
            let mut block = Vec::with_capacity(short_len + 1);
            block.extend_from_slice(dat);
            if i < short_blocks {
                block.push(0); // placeholder so all blocks are equal length
            }
            block.extend_from_slice(&ecc_bytes);
            blocks.push(block);
        }
        debug_assert_eq!(k, data.len());

        let mut out = Vec::with_capacity(raw);
        for i in 0..blocks[0].len() {
            for (j, block) in blocks.iter().enumerate() {
                // Skip the padding byte in short blocks.
                if i == short_len - ecc_len && j < short_blocks {
                    continue;
                }
                out.push(block[i]);
            }
        }
        debug_assert_eq!(out.len(), raw);
        out
    }

    fn draw_codewords(&mut self, data: &[u8]) {
        let s = i32::from(self.size);
        let mut bit_index: usize = 0;
        let mut right: i32 = s - 1;
        while right >= 1 {
            if right == 6 {
                right = 5;
            }
            for v in 0..s {
                for j in 0..2 {
                    let x = right - j;
                    let upward = ((right + 1) & 2) == 0;
                    let y = if upward { s - 1 - v } else { v };
                    let idx = self.idx(x, y);
                    if self.is_function[idx] {
                        continue;
                    }
                    if bit_index < data.len() * 8 {
                        let byte = data[bit_index >> 3];
                        self.modules[idx] = (byte >> (7 - (bit_index & 7))) & 1;
                    }
                    bit_index += 1;
                }
            }
            right -= 2;
        }
        debug_assert!(bit_index >= data.len() * 8);
    }

    fn apply_mask(&mut self, mask: u8) {
        let s = i32::from(self.size);
        for y in 0..s {
            for x in 0..s {
                let invert = match mask {
                    0 => (x + y) % 2 == 0,
                    1 => y % 2 == 0,
                    2 => x % 3 == 0,
                    3 => (x + y) % 3 == 0,
                    4 => (x / 3 + y / 2) % 2 == 0,
                    5 => x * y % 2 + x * y % 3 == 0,
                    6 => (x * y % 2 + x * y % 3) % 2 == 0,
                    7 => ((x + y) % 2 + x * y % 3) % 2 == 0,
                    _ => false,
                };
                let i = self.idx(x, y);
                if invert && !self.is_function[i] {
                    self.modules[i] ^= 1;
                }
            }
        }
    }

    fn penalty_score(&self) -> i32 {
        const N1: i32 = 3;
        const N2: i32 = 3;
        const N3: i32 = 40;
        const N4: i32 = 10;
        let s = i32::from(self.size);
        let mut score: i32 = 0;

        // Runs of same color (rows and columns) + finder-like patterns.
        for y in 0..s {
            let mut run_color = 0u8;
            let mut run_len: i32 = 0;
            let mut history = [0i32; 7];
            for x in 0..s {
                let c = self.modules[self.idx(x, y)];
                if c == run_color {
                    run_len += 1;
                    if run_len == 5 {
                        score += N1;
                    } else if run_len > 5 {
                        score += 1;
                    }
                } else {
                    finder_push(&mut history, run_len);
                    if run_color == 0 {
                        score += finder_count(&history) * N3;
                    }
                    run_color = c;
                    run_len = 1;
                }
            }
            score += finder_terminate(run_color, run_len, &mut history, s) * N3;
        }
        for x in 0..s {
            let mut run_color = 0u8;
            let mut run_len: i32 = 0;
            let mut history = [0i32; 7];
            for y in 0..s {
                let c = self.modules[self.idx(x, y)];
                if c == run_color {
                    run_len += 1;
                    if run_len == 5 {
                        score += N1;
                    } else if run_len > 5 {
                        score += 1;
                    }
                } else {
                    finder_push(&mut history, run_len);
                    if run_color == 0 {
                        score += finder_count(&history) * N3;
                    }
                    run_color = c;
                    run_len = 1;
                }
            }
            score += finder_terminate(run_color, run_len, &mut history, s) * N3;
        }

        // 2×2 blocks of same color.
        for y in 0..s - 1 {
            for x in 0..s - 1 {
                let c = self.modules[self.idx(x, y)];
                if c == self.modules[self.idx(x + 1, y)]
                    && c == self.modules[self.idx(x, y + 1)]
                    && c == self.modules[self.idx(x + 1, y + 1)]
                {
                    score += N2;
                }
            }
        }

        // Dark/light balance.
        let dark: i32 = self.modules.iter().map(|&m| i32::from(m)).sum();
        let total = s * s;
        let k = ((dark * 20 - total * 10).abs() + total - 1) / total - 1;
        score += k * N4;

        score
    }
}

fn finder_push(history: &mut [i32; 7], run_len: i32) {
    history.copy_within(0..6, 1);
    history[0] = run_len;
}

fn finder_count(history: &[i32; 7]) -> i32 {
    let n = history[1];
    let core =
        n > 0 && history[2] == n && history[3] == n * 3 && history[4] == n && history[5] == n;
    let mut c = 0;
    if core && history[0] >= n * 4 && history[6] >= n {
        c += 1;
    }
    if core && history[6] >= n * 4 && history[0] >= n {
        c += 1;
    }
    c
}

fn finder_terminate(run_color: u8, mut run_len: i32, history: &mut [i32; 7], size: i32) -> i32 {
    if run_color == 1 {
        finder_push(history, run_len);
        run_len = 0;
    }
    run_len += size;
    finder_push(history, run_len);
    finder_count(history)
}

fn alignment_positions(version: u8) -> Vec<u8> {
    if version == 1 {
        return Vec::new();
    }
    let count = usize::from(version) / 7 + 2;
    let size = version * 4 + 17;
    let step = if version == 32 {
        26
    } else {
        ((u16::from(version) * 4 + u16::from(count as u8) * 2 + 1)
            / (u16::from(count as u8) * 2 - 2)) as u8
            * 2
    };
    let mut out = vec![0u8; count];
    out[0] = 6;
    let mut pos = size - 7;
    for i in (1..count).rev() {
        out[i] = pos;
        pos = pos.wrapping_sub(step);
    }
    out
}

fn raw_codeword_count(version: u8) -> usize {
    let v = usize::from(version);
    let size = v * 4 + 17;
    let mut bits = size * size;
    // Function patterns.
    bits -= 8 * 8 * 3; // finders+separators
    bits -= 15 * 2 + 1; // format
    bits -= (size - 16) * 2; // timing
    if version >= 2 {
        let n = v / 7 + 2;
        // Alignment modules, less the 2(n-2)·5 already counted as timing.
        bits -= (n * n - 3) * 25 - (n - 2) * 2 * 5;
        if version >= 7 {
            bits -= 6 * 3 * 2; // version info
        }
    }
    bits / 8
}

fn data_codeword_count(version: u8, ecc: Ecc) -> usize {
    raw_codeword_count(version)
        - usize::from(ECC_CODEWORDS_PER_BLOCK[ecc.ordinal()][usize::from(version)])
            * usize::from(NUM_ERROR_CORRECTION_BLOCKS[ecc.ordinal()][usize::from(version)])
}

fn reed_solomon_divisor(degree: usize) -> Vec<u8> {
    debug_assert!((1..=255).contains(&degree));
    let mut out = vec![0u8; degree];
    *out.last_mut().unwrap() = 1;
    let mut root: u8 = 1;
    for _ in 0..degree {
        for j in 0..degree {
            out[j] = gf_mul(out[j], root);
            if j + 1 < degree {
                out[j] ^= out[j + 1];
            }
        }
        root = gf_mul(root, 0x02);
    }
    out
}

fn reed_solomon_remainder(data: &[u8], divisor: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; divisor.len()];
    for &b in data {
        let factor = b ^ out[0];
        out.copy_within(1.., 0);
        *out.last_mut().unwrap() = 0;
        for (o, &d) in out.iter_mut().zip(divisor) {
            *o ^= gf_mul(d, factor);
        }
    }
    out
}

/// GF(256) multiplication with reducing polynomial x^8 + x^4 + x^3 + x^2 + 1.
fn gf_mul(x: u8, y: u8) -> u8 {
    let mut z: u16 = 0;
    for i in (0..8).rev() {
        z = (z << 1) ^ ((z >> 7) * 0x11D);
        z ^= u16::from((y >> i) & 1) * u16::from(x);
    }
    z as u8
}

// Index 0 is a placeholder; valid versions are 1..=40.
static ECC_CODEWORDS_PER_BLOCK: [[u8; 41]; 4] = [
    [
        0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28,
        30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
    [
        0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28,
        28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    ],
    [
        0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30,
        30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
    [
        0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24,
        30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
];

static NUM_ERROR_CORRECTION_BLOCKS: [[u8; 41]; 4] = [
    [
        0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13,
        14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
    ],
    [
        0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21,
        23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
    ],
    [
        0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29,
        34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
    ],
    [
        0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32,
        35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
    ],
];

// ─── Renderers ──────────────────────────────────────────────────────────────

/// SVG output. `light`/`dark` are UTF-8 CSS color strings.
pub fn to_svg(qr: &QrCode, border: u32, light: &[u8], dark: &[u8]) -> Vec<u8> {
    use std::io::Write as _;
    let s = u32::from(qr.size());
    let dim = s + border * 2;
    let mut out: Vec<u8> = Vec::with_capacity(256 + qr.modules().len() * 6);
    out.extend_from_slice(br#"<?xml version="1.0" encoding="UTF-8"?>"#);
    out.push(b'\n');
    let _ = write!(
        out,
        r#"<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 {d} {d}" stroke="none">"#,
        d = dim
    );
    out.push(b'\n');
    out.extend_from_slice(br#"<rect width="100%" height="100%" fill=""#);
    xml_escape_into(&mut out, light);
    out.extend_from_slice(b"\"/>\n");
    out.extend_from_slice(br#"<path d=""#);
    let mut first = true;
    for y in 0..s {
        for x in 0..s {
            if qr.module(x as i32, y as i32) {
                if !first {
                    out.push(b' ');
                }
                first = false;
                let _ = write!(out, "M{},{}h1v1h-1z", x + border, y + border);
            }
        }
    }
    out.extend_from_slice(br#"" fill=""#);
    xml_escape_into(&mut out, dark);
    out.extend_from_slice(b"\"/>\n</svg>\n");
    out
}

fn xml_escape_into(out: &mut Vec<u8>, s: &[u8]) {
    for &b in s {
        match b {
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            b'&' => out.extend_from_slice(b"&amp;"),
            b'"' => out.extend_from_slice(b"&quot;"),
            b'\'' => out.extend_from_slice(b"&#39;"),
            0x00..=0x1F => {}
            _ => out.push(b),
        }
    }
}

/// Rasterize to RGBA8 at `scale` px/module, using `light`/`dark` as 0xRRGGBBAA.
pub fn to_rgba(qr: &QrCode, border: u32, scale: u32, light: u32, dark: u32) -> (Vec<u8>, u32, u32) {
    let s = i32::from(qr.size());
    let b = border as i32;
    let dim_modules = (s + 2 * b) as u32;
    let dim_px = dim_modules * scale;
    let px_count = (dim_px as usize) * (dim_px as usize);
    let mut out = vec![0u8; px_count * 4];
    let light = light.to_be_bytes();
    let dark = dark.to_be_bytes();
    for py in 0..dim_px {
        let my = py as i32 / scale as i32 - b;
        for px in 0..dim_px {
            let mx = px as i32 / scale as i32 - b;
            let c = if qr.module(mx, my) { dark } else { light };
            let off = ((py * dim_px + px) as usize) * 4;
            out[off..off + 4].copy_from_slice(&c);
        }
    }
    (out, dim_px, dim_px)
}

/// Terminal block output. Two modules per row using U+2580 upper-half block.
pub fn to_text(qr: &QrCode, border: u32, invert: bool) -> String {
    let s = i32::from(qr.size());
    let b = border as i32;
    let dim = s + 2 * b;
    // Capacity: dim cols × ceil(dim/2) rows × up to 3 UTF-8 bytes + newline.
    let mut out = String::with_capacity((dim as usize) * (dim as usize / 2 + 1) * 4);
    let mut y = -b;
    while y < s + b {
        for x in -b..s + b {
            let top = qr.module(x, y) ^ invert;
            let bot = qr.module(x, y + 1) ^ invert;
            out.push(match (top, bot) {
                (true, true) => '\u{2588}',
                (true, false) => '\u{2580}',
                (false, true) => '\u{2584}',
                (false, false) => ' ',
            });
        }
        out.push('\n');
        y += 2;
    }
    out
}

// ─── Decoder (module matrix → bytes) ────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DecodeError {
    InvalidSize,
    InvalidFormatInfo,
    InvalidVersionInfo,
    ReedSolomonFailure,
    InvalidStructure,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DecodeError::InvalidSize => {
                write!(f, "matrix size must be 21..=177 and congruent to 1 mod 4")
            }
            DecodeError::InvalidFormatInfo => write!(f, "unable to read format information"),
            DecodeError::InvalidVersionInfo => write!(f, "version information mismatch"),
            DecodeError::ReedSolomonFailure => {
                write!(
                    f,
                    "too many errors in data (Reed-Solomon correction failed)"
                )
            }
            DecodeError::InvalidStructure => write!(f, "invalid segment structure"),
        }
    }
}

pub struct Decoded {
    pub version: u8,
    pub ecc: Ecc,
    pub mask: u8,
    pub bytes: Vec<u8>,
}

/// Decode a row-major `size*size` module matrix (0 = light, non-zero = dark).
pub fn decode_matrix(modules: &[u8], size: usize) -> Result<Decoded, DecodeError> {
    if !(21..=177).contains(&size) || !(size - 17).is_multiple_of(4) || modules.len() != size * size
    {
        return Err(DecodeError::InvalidSize);
    }
    let version = ((size - 17) / 4) as u8;
    let get = |x: i32, y: i32| -> bool { modules[(y as usize) * size + (x as usize)] != 0 };

    // Format info (two copies, BCH-protected, XOR 0x5412).
    let (ecc, mask) = read_format(&get, size)?;

    // Build the is_function map so we know which modules carry data.
    let is_fn = build_function_map(version);

    // Extract raw codewords in the same zig-zag order the encoder wrote them.
    let raw = raw_codeword_count(version);
    let mut code = vec![0u8; raw];
    let mut bit_index: usize = 0;
    let s = size as i32;
    let mut right: i32 = s - 1;
    while right >= 1 {
        if right == 6 {
            right = 5;
        }
        for v in 0..s {
            for j in 0..2 {
                let x = right - j;
                let upward = ((right + 1) & 2) == 0;
                let y = if upward { s - 1 - v } else { v };
                let idx = (y as usize) * size + (x as usize);
                if is_fn[idx] {
                    continue;
                }
                if bit_index < raw * 8 {
                    let bit = get(x, y) ^ mask_bit(mask, x, y);
                    code[bit_index >> 3] |= u8::from(bit) << (7 - (bit_index & 7));
                }
                bit_index += 1;
            }
        }
        right -= 2;
    }

    // Deinterleave into blocks and correct each with Reed-Solomon.
    let data = deinterleave_and_correct(version, ecc, &code)?;

    // Parse segments back to bytes (UTF-8 for text modes).
    let bytes = parse_segments(&data, version)?;

    Ok(Decoded {
        version,
        ecc,
        mask,
        bytes,
    })
}

fn mask_bit(mask: u8, x: i32, y: i32) -> bool {
    match mask {
        0 => (x + y) % 2 == 0,
        1 => y % 2 == 0,
        2 => x % 3 == 0,
        3 => (x + y) % 3 == 0,
        4 => (x / 3 + y / 2) % 2 == 0,
        5 => x * y % 2 + x * y % 3 == 0,
        6 => (x * y % 2 + x * y % 3) % 2 == 0,
        7 => ((x + y) % 2 + x * y % 3) % 2 == 0,
        _ => false,
    }
}

fn read_format(get: &impl Fn(i32, i32) -> bool, size: usize) -> Result<(Ecc, u8), DecodeError> {
    let s = size as i32;
    // Read both copies as raw 15-bit words.
    let read_copy_a = || -> u32 {
        let mut bits: u32 = 0;
        for i in 0..6 {
            bits |= u32::from(get(8, i)) << i;
        }
        bits |= u32::from(get(8, 7)) << 6;
        bits |= u32::from(get(8, 8)) << 7;
        bits |= u32::from(get(7, 8)) << 8;
        for i in 9..15 {
            bits |= u32::from(get(14 - i, 8)) << i;
        }
        bits
    };
    let read_copy_b = || -> u32 {
        let mut bits: u32 = 0;
        for i in 0..8 {
            bits |= u32::from(get(s - 1 - i, 8)) << i;
        }
        for i in 8..15 {
            bits |= u32::from(get(8, s - 15 + i)) << i;
        }
        bits
    };
    // Brute-force the 32 valid codewords; pick the one closest (Hamming) to
    // either copy. BCH(15,5) corrects up to 3 bit errors.
    let a = read_copy_a();
    let b = read_copy_b();
    let mut best: Option<(u32, u8)> = None;
    for data in 0u32..32 {
        let mut rem = data;
        for _ in 0..10 {
            rem = (rem << 1) ^ ((rem >> 9) * 0x537);
        }
        let cw = ((data << 10) | rem) ^ 0x5412;
        let d = core::cmp::min((cw ^ a).count_ones(), (cw ^ b).count_ones());
        match best {
            None => best = Some((d, data as u8)),
            Some((bd, _)) if d < bd => best = Some((d, data as u8)),
            _ => {}
        }
    }
    let (dist, data) = best.unwrap();
    if dist > 3 {
        return Err(DecodeError::InvalidFormatInfo);
    }
    let ecc = match (data >> 3) & 0b11 {
        1 => Ecc::Low,
        0 => Ecc::Medium,
        3 => Ecc::Quartile,
        2 => Ecc::High,
        _ => return Err(DecodeError::InvalidFormatInfo),
    };
    Ok((ecc, data & 0b111))
}

fn build_function_map(version: u8) -> Vec<bool> {
    let size = usize::from(version) * 4 + 17;
    let mut f = vec![false; size * size];
    let set = |f: &mut Vec<bool>, x: i32, y: i32| {
        if x >= 0 && y >= 0 && (x as usize) < size && (y as usize) < size {
            f[(y as usize) * size + (x as usize)] = true;
        }
    };
    let s = size as i32;
    for i in 0..s {
        set(&mut f, 6, i);
        set(&mut f, i, 6);
    }
    for &(cx, cy) in &[(3, 3), (s - 4, 3), (3, s - 4)] {
        for dy in -4..=4 {
            for dx in -4..=4 {
                set(&mut f, cx + dx, cy + dy);
            }
        }
    }
    let aligns = alignment_positions(version);
    let n = aligns.len();
    for i in 0..n {
        for j in 0..n {
            if (i == 0 && j == 0) || (i == 0 && j == n - 1) || (i == n - 1 && j == 0) {
                continue;
            }
            let cx = i32::from(aligns[i]);
            let cy = i32::from(aligns[j]);
            for dy in -2..=2 {
                for dx in -2..=2 {
                    set(&mut f, cx + dx, cy + dy);
                }
            }
        }
    }
    // Format info positions + dark module.
    for i in 0..9 {
        set(&mut f, 8, i);
        set(&mut f, i, 8);
    }
    for i in 0..8 {
        set(&mut f, s - 1 - i, 8);
        set(&mut f, 8, s - 1 - i);
    }
    if version >= 7 {
        for i in 0..18i32 {
            let a = s - 11 + (i % 3);
            let b = i / 3;
            set(&mut f, a, b);
            set(&mut f, b, a);
        }
    }
    f
}

fn deinterleave_and_correct(version: u8, ecc: Ecc, code: &[u8]) -> Result<Vec<u8>, DecodeError> {
    let num_blocks = NUM_ERROR_CORRECTION_BLOCKS[ecc.ordinal()][usize::from(version)] as usize;
    let ecc_len = ECC_CODEWORDS_PER_BLOCK[ecc.ordinal()][usize::from(version)] as usize;
    let raw = raw_codeword_count(version);
    let short_blocks = num_blocks - raw % num_blocks;
    let short_len = raw / num_blocks;

    // Deinterleave.
    let mut blocks: Vec<Vec<u8>> = (0..num_blocks)
        .map(|i| {
            let len = short_len + usize::from(i >= short_blocks);
            vec![0u8; len]
        })
        .collect();
    let mut k = 0usize;
    // Data bytes (column by column across blocks).
    for i in 0..short_len - ecc_len + 1 {
        for (j, block) in blocks.iter_mut().enumerate() {
            if i == short_len - ecc_len && j < short_blocks {
                continue;
            }
            block[i] = code[k];
            k += 1;
        }
    }
    // ECC bytes.
    for i in 0..ecc_len {
        for (j, block) in blocks.iter_mut().enumerate() {
            let dat_len = short_len - ecc_len + usize::from(j >= short_blocks);
            block[dat_len + i] = code[k];
            k += 1;
        }
    }
    debug_assert_eq!(k, raw);

    // Correct each block and collect the data portion.
    let mut out = Vec::with_capacity(raw - ecc_len * num_blocks);
    for (j, block) in blocks.iter_mut().enumerate() {
        reed_solomon_correct(block, ecc_len)?;
        let dat_len = short_len - ecc_len + usize::from(j >= short_blocks);
        out.extend_from_slice(&block[..dat_len]);
    }
    Ok(out)
}

/// Reed-Solomon syndrome decoder over GF(256), correcting up to `ecc_len/2`
/// byte errors in-place. Uses Berlekamp-Massey for the locator polynomial.
fn reed_solomon_correct(block: &mut [u8], ecc_len: usize) -> Result<(), DecodeError> {
    // Syndromes S_i = block(α^i), i = 0..ecc_len-1.
    let mut syn = vec![0u8; ecc_len];
    let mut any = 0u8;
    for i in 0..ecc_len {
        let root = gf_exp(i as u8);
        let mut s = 0u8;
        for &b in block.iter() {
            s = gf_mul(s, root) ^ b;
        }
        syn[i] = s;
        any |= s;
    }
    if any == 0 {
        return Ok(());
    }

    // Berlekamp-Massey → error locator polynomial Λ.
    let mut lambda = vec![0u8; ecc_len + 1];
    let mut prev = vec![0u8; ecc_len + 1];
    lambda[0] = 1;
    prev[0] = 1;
    let mut l: usize = 0;
    let mut m: isize = 1;
    let mut bb: u8 = 1;
    for n in 0..ecc_len {
        let mut delta = syn[n];
        for i in 1..=l {
            delta ^= gf_mul(lambda[i], syn[n - i]);
        }
        if delta == 0 {
            m += 1;
        } else if 2 * l <= n {
            let t = lambda.clone();
            let coef = gf_mul(delta, gf_inv(bb));
            for i in 0..=ecc_len {
                if (i as isize) >= m && i - m as usize <= ecc_len {
                    lambda[i] ^= gf_mul(coef, prev[i - m as usize]);
                }
            }
            l = n + 1 - l;
            prev = t;
            bb = delta;
            m = 1;
        } else {
            let coef = gf_mul(delta, gf_inv(bb));
            for i in 0..=ecc_len {
                if (i as isize) >= m && i - m as usize <= ecc_len {
                    lambda[i] ^= gf_mul(coef, prev[i - m as usize]);
                }
            }
            m += 1;
        }
    }
    if l > ecc_len / 2 {
        return Err(DecodeError::ReedSolomonFailure);
    }

    // Error evaluator Ω = (S·Λ) mod x^ecc_len.
    let mut omega = vec![0u8; ecc_len];
    for i in 0..ecc_len {
        let mut s = 0u8;
        for j in 0..=i.min(l) {
            s ^= gf_mul(lambda[j], syn[i - j]);
        }
        omega[i] = s;
    }

    // Chien search for roots of Λ → error positions.
    let n = block.len();
    let mut found = 0usize;
    for pos in 0..n {
        // x_inv = α^{-pos}; root of Λ means Λ(x_inv) == 0.
        let x_inv = gf_exp(((255 - (pos % 255)) % 255) as u8);
        let mut lv = 0u8;
        let mut xp = 1u8;
        for k in 0..=l {
            lv ^= gf_mul(lambda[k], xp);
            xp = gf_mul(xp, x_inv);
        }
        if lv != 0 {
            continue;
        }
        // Forney: magnitude = Ω(x_inv) / Λ'(x_inv), with the QR generator's
        // first root α^0 so no extra x factor.
        let mut ov = 0u8;
        let mut xp = 1u8;
        for k in 0..ecc_len {
            ov ^= gf_mul(omega[k], xp);
            xp = gf_mul(xp, x_inv);
        }
        let mut dv = 0u8;
        let mut xp = x_inv;
        let mut k = 1usize;
        while k <= l {
            dv ^= gf_mul(lambda[k], xp);
            xp = gf_mul(xp, gf_mul(x_inv, x_inv));
            k += 2;
        }
        if dv == 0 {
            return Err(DecodeError::ReedSolomonFailure);
        }
        let mag = gf_mul(ov, gf_inv(dv));
        block[n - 1 - pos] ^= mag;
        found += 1;
    }
    if found != l {
        return Err(DecodeError::ReedSolomonFailure);
    }
    Ok(())
}

fn gf_exp(e: u8) -> u8 {
    let mut v: u16 = 1;
    for _ in 0..e {
        v <<= 1;
        if v & 0x100 != 0 {
            v ^= 0x11D;
        }
    }
    v as u8
}

fn gf_inv(x: u8) -> u8 {
    debug_assert!(x != 0);
    // α^255 = 1, so x^{-1} = x^{254}.
    let mut r = 1u8;
    let mut base = x;
    let mut e: u16 = 254;
    while e > 0 {
        if e & 1 != 0 {
            r = gf_mul(r, base);
        }
        base = gf_mul(base, base);
        e >>= 1;
    }
    r
}

fn parse_segments(data: &[u8], version: u8) -> Result<Vec<u8>, DecodeError> {
    let total_bits = data.len() * 8;
    let mut pos: usize = 0;
    let read = |pos: usize, n: usize| -> u32 {
        let mut v: u32 = 0;
        for i in 0..n {
            let bit = (data[(pos + i) >> 3] >> (7 - ((pos + i) & 7))) & 1;
            v = (v << 1) | u32::from(bit);
        }
        v
    };
    let mut out = Vec::new();
    while pos + 4 <= total_bits {
        let mode = read(pos, 4);
        pos += 4;
        if mode == 0 {
            break;
        }
        let m = match mode {
            0x1 => Mode::Numeric,
            0x2 => Mode::Alphanumeric,
            0x4 => Mode::Byte,
            0x8 => Mode::Kanji,
            0x7 => Mode::Eci,
            _ => return Err(DecodeError::InvalidStructure),
        };
        if m == Mode::Eci {
            // Skip the ECI designator; we emit bytes as-is.
            if pos + 8 > total_bits {
                return Err(DecodeError::InvalidStructure);
            }
            let first = read(pos, 8);
            let take = if first & 0x80 == 0 {
                8
            } else if first & 0xC0 == 0x80 {
                16
            } else {
                24
            };
            if pos + take > total_bits {
                return Err(DecodeError::InvalidStructure);
            }
            pos += take;
            continue;
        }
        let cc_bits = usize::from(m.char_count_bits(version));
        if pos + cc_bits > total_bits {
            return Err(DecodeError::InvalidStructure);
        }
        let count = read(pos, cc_bits) as usize;
        pos += cc_bits;
        match m {
            Mode::Byte => {
                if pos + count * 8 > total_bits {
                    return Err(DecodeError::InvalidStructure);
                }
                for _ in 0..count {
                    out.push(read(pos, 8) as u8);
                    pos += 8;
                }
            }
            Mode::Numeric => {
                let mut left = count;
                while left >= 3 {
                    if pos + 10 > total_bits {
                        return Err(DecodeError::InvalidStructure);
                    }
                    let v = read(pos, 10);
                    pos += 10;
                    out.push(b'0' + (v / 100) as u8);
                    out.push(b'0' + ((v / 10) % 10) as u8);
                    out.push(b'0' + (v % 10) as u8);
                    left -= 3;
                }
                if left == 2 {
                    let v = read(pos, 7);
                    pos += 7;
                    out.push(b'0' + (v / 10) as u8);
                    out.push(b'0' + (v % 10) as u8);
                } else if left == 1 {
                    let v = read(pos, 4);
                    pos += 4;
                    out.push(b'0' + v as u8);
                }
            }
            Mode::Alphanumeric => {
                let mut left = count;
                while left >= 2 {
                    if pos + 11 > total_bits {
                        return Err(DecodeError::InvalidStructure);
                    }
                    let v = read(pos, 11);
                    pos += 11;
                    out.push(ALNUM_CHARSET[(v / 45) as usize]);
                    out.push(ALNUM_CHARSET[(v % 45) as usize]);
                    left -= 2;
                }
                if left == 1 {
                    let v = read(pos, 6);
                    pos += 6;
                    out.push(ALNUM_CHARSET[v as usize]);
                }
            }
            Mode::Kanji => {
                // Emit Shift-JIS bytes (2 per char); caller decodes if needed.
                for _ in 0..count {
                    if pos + 13 > total_bits {
                        return Err(DecodeError::InvalidStructure);
                    }
                    let v = read(pos, 13);
                    pos += 13;
                    let mut w = (v / 0xC0) << 8 | (v % 0xC0);
                    w += if w < 0x1F00 { 0x8140 } else { 0xC140 };
                    out.push((w >> 8) as u8);
                    out.push(w as u8);
                }
            }
            Mode::Eci => {}
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_version_and_size() {
        let qr = QrCode::encode_text(b"Hello, world!", Ecc::Medium).unwrap();
        assert_eq!(qr.version(), 1);
        assert_eq!(qr.size(), 21);
        // 13 byte-mode chars = 116 bits; v1-Q capacity is 104, so no boost.
        assert_eq!(qr.ecc(), Ecc::Medium);
    }

    #[test]
    fn numeric_mode_capacity() {
        // 7089 digits is the documented max for version 40-L numeric.
        let digits = vec![b'3'; 7089];
        let qr = QrCode::encode_segments(
            &[Segment::make_numeric(&digits)],
            Ecc::Low,
            VERSION_MIN,
            VERSION_MAX,
            None,
            false,
        )
        .unwrap();
        assert_eq!(qr.version(), 40);
        let over = vec![b'3'; 7090];
        assert!(
            QrCode::encode_segments(
                &[Segment::make_numeric(&over)],
                Ecc::Low,
                VERSION_MIN,
                VERSION_MAX,
                None,
                false
            )
            .is_err()
        );
    }

    #[test]
    fn alignment_positions_v7() {
        assert_eq!(alignment_positions(7), vec![6, 22, 38]);
    }

    #[test]
    fn data_capacity_v1() {
        assert_eq!(data_codeword_count(1, Ecc::Low), 19);
        assert_eq!(data_codeword_count(1, Ecc::Medium), 16);
        assert_eq!(data_codeword_count(1, Ecc::Quartile), 13);
        assert_eq!(data_codeword_count(1, Ecc::High), 9);
    }

    #[test]
    fn roundtrip_text() {
        for input in [
            &b""[..],
            b"A",
            b"HELLO WORLD",
            b"Hello, world!",
            b"https://bun.com",
            b"01234567890123456789",
            "こんにちは世界".as_bytes(),
        ] {
            for ecc in [Ecc::Low, Ecc::Medium, Ecc::Quartile, Ecc::High] {
                let qr = QrCode::encode_text(input, ecc).unwrap();
                let decoded = decode_matrix(qr.modules(), usize::from(qr.size())).unwrap();
                assert_eq!(decoded.bytes, input, "input={:?} ecc={:?}", input, ecc);
                assert_eq!(decoded.version, qr.version());
                assert_eq!(decoded.mask, qr.mask());
            }
        }
    }

    #[test]
    fn roundtrip_with_bit_errors() {
        let qr = QrCode::encode_text(b"Hello, world!", Ecc::High).unwrap();
        let mut m = qr.modules().to_vec();
        // Flip a few data modules (not in the format-info area).
        for &i in &[10 * 21 + 10, 11 * 21 + 11, 12 * 21 + 12] {
            m[i] ^= 1;
        }
        let decoded = decode_matrix(&m, usize::from(qr.size())).unwrap();
        assert_eq!(decoded.bytes, b"Hello, world!");
    }

    #[test]
    fn roundtrip_binary() {
        let data: Vec<u8> = (0..=255u8).collect();
        let qr = QrCode::encode_binary(&data, Ecc::Medium).unwrap();
        let decoded = decode_matrix(qr.modules(), usize::from(qr.size())).unwrap();
        assert_eq!(decoded.bytes, data);
    }
}
