/// Buffer for [`ScannerStops`]. Keep one per thread so the allocation is reused from file to file.
#[derive(Default)]
pub struct ScannerStopsBuffer {
    /// As long as the longest text so far needs: the kernel writes all that is read, so nothing
    /// is cleared from one text to the next.
    planes: Vec<u8>,
    /// The address and the length of the text that `planes` is filled for.
    filled_for: Option<(usize, usize)>,
}

/// Where runs of bytes end in a JavaScript or TypeScript source. One kernel call finds them for the
/// whole text, so a scanner gets the length of a name or a string from a load and a bit scan
/// instead of a call per token.
#[derive(Copy, Clone)]
pub struct ScannerStops<'a> {
    /// Everything but ASCII letters, digits, `_` and `$`.
    pub after_name: Stops<'a>,
    /// Everything but tabs and spaces.
    pub after_blanks: Stops<'a>,
    /// `"`, `'`, `` ` ``, `$`, `\`, control characters, and everything that isn't ASCII.
    pub in_string: Stops<'a>,
}

impl ScannerStopsBuffer {
    /// 8 bytes more than the kernel writes, so that `Stops::window` can load a whole word at any
    /// position. They are set, like all bits past the end: a run ends with the text.
    fn plane_len(text: &[u8]) -> usize {
        text.len().div_ceil(64) * 8 + 8
    }

    /// The stops of `text`.
    pub fn find(&mut self, text: &[u8]) -> ScannerStops<'_> {
        self.fill(text);
        self.filled(text)
    }

    /// The stops of `text`, which may be the text of the last call. The caller has held on to that
    /// text since, or has called [`ScannerStopsBuffer::forget`]: another text can get the same address.
    pub fn find_again(&mut self, text: &[u8]) -> ScannerStops<'_> {
        if self.filled_for != Some((text.as_ptr().addr(), text.len())) {
            self.fill(text);
        }
        #[cfg(debug_assertions)]
        {
            let found = self.planes.clone();
            self.fill(text);
            assert!(found == self.planes, "the text has changed");
        }
        self.filled(text)
    }

    /// The memory that the stops of `text` take more than those of any text so far.
    pub fn reserve(&mut self, text: &[u8]) -> &mut [core::mem::MaybeUninit<u8>] {
        let more = (3 * Self::plane_len(text)).saturating_sub(self.planes.len());
        self.planes.reserve(more);
        &mut self.planes.spare_capacity_mut()[..more]
    }

    /// The text of the last call is no longer held on to.
    pub fn forget(&mut self) {
        self.filled_for = None;
    }

    fn fill(&mut self, text: &[u8]) {
        let plane_len = Self::plane_len(text);
        if self.planes.len() < 3 * plane_len {
            self.planes.resize(3 * plane_len, 0);
        }
        let (after_name, rest) = self.planes.split_at_mut(plane_len);
        let (after_blanks, rest) = rest.split_at_mut(plane_len);
        let planes = [after_name, after_blanks, &mut rest[..plane_len]].map(|plane| {
            plane[plane_len - 8..].fill(0xFF);
            plane.as_chunks_mut().0
        });
        bun_simd_kernels::scanner_run_stops(text, planes);
        self.filled_for = Some((text.as_ptr().addr(), text.len()));
    }

    fn filled(&self, text: &[u8]) -> ScannerStops<'_> {
        let plane_len = Self::plane_len(text);
        let (after_name, rest) = self.planes.split_at(plane_len);
        let (after_blanks, rest) = rest.split_at(plane_len);
        ScannerStops {
            after_name: Stops(after_name),
            after_blanks: Stops(after_blanks),
            in_string: Stops(&rest[..plane_len]),
        }
    }
}

/// One bit per byte of a text, lowest bit first. A set bit is a byte that ends a run.
#[derive(Copy, Clone)]
pub struct Stops<'a>(&'a [u8]);

impl Stops<'_> {
    /// The bits from `pos` on. The upper 7 may be zeros that were shifted in.
    #[inline(always)]
    fn window(self, pos: usize) -> u64 {
        let at = pos >> 3;
        match self.0.get(at..at + 8) {
            Some(bits) => u64::from_le_bytes(bits.try_into().unwrap_or_default()) >> (pos & 7),
            None => 1,
        }
    }

    /// The bits of the 64 bytes from `64 * index` on.
    #[inline(always)]
    pub fn block(self, index: usize) -> u64 {
        match self.0.get(index * 8..index * 8 + 8) {
            Some(bits) => u64::from_le_bytes(bits.try_into().unwrap_or_default()),
            None => u64::MAX,
        }
    }

    /// How many bytes there are from `pos` to the next stop. Exact below 57; anything higher only
    /// says that there are at least 57.
    #[inline(always)]
    pub fn run(self, pos: usize) -> u32 {
        self.window(pos).trailing_zeros()
    }

    /// The first stop at or after `pos`. The end of the text is one.
    #[inline(always)]
    pub fn next(self, mut pos: usize) -> usize {
        loop {
            let window = self.window(pos);
            if window != 0 {
                return pos + window.trailing_zeros() as usize;
            }
            pos += 56;
        }
    }
}
