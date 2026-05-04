//! ThumbHash — Evan Wallace's tiny LQIP encoding (public domain).
//! https://github.com/evanw/thumbhash
//!
//! ~21–25 bytes encode the low-order DCT coefficients of L/P/Q (luma + two
//! opponent-colour planes, optionally A) of a ≤100×100 image. Decoding gives a
//! ≤32px blur with the right average colour, aspect ratio and rough structure.
//!
//! `Bun.Image.placeholder()` runs `decode → box-resize ≤100 → encode()` →
//! `decode()` → PNG-encode → `data:` URL, all on the work pool. The hash
//! itself is exposed as the intermediate so a future `as: "hash"` option is
//! one switch away. The encode/decode are scalar f32 and tiny (≤100²·7² mults
//! at the absolute most); not worth a Highway kernel.

use core::f32::consts::PI;

/// Maximum hash length: 5-byte header + (has_alpha ? 1 : 0) + ceil((L+P+Q+A
/// AC counts)/2). Worst case (has_alpha, square) is 5+1+ceil((14+5+5+14)/2)=25.
pub const MAX_LEN: usize = 25;

pub fn encode<'a>(out: &'a mut [u8; MAX_LEN], w: u32, h: u32, rgba: &[u8]) -> &'a mut [u8] {
    // PORT NOTE: Zig returns `out[0..n]`; mirrored here as a mut sub-slice borrow of `out`.
    debug_assert!(w > 0 && w <= 100 && h > 0 && h <= 100);
    debug_assert!(rgba.len() == (w as usize) * (h as usize) * 4);

    // Average colour (alpha-weighted so transparent pixels don't tug it).
    let mut avg: [f32; 4] = [0.0; 4];
    let mut i: usize = 0;
    while i < rgba.len() {
        let a: f32 = rgba[i + 3] as f32 / 255.0;
        avg[0] += a / 255.0 * rgba[i + 0] as f32;
        avg[1] += a / 255.0 * rgba[i + 1] as f32;
        avg[2] += a / 255.0 * rgba[i + 2] as f32;
        avg[3] += a;
        i += 4;
    }
    if avg[3] > 0.0 {
        for c in &mut avg[0..3] {
            *c /= avg[3];
        }
    }

    let npix: f32 = (w * h) as f32;
    let has_alpha = avg[3] < npix;
    let l_limit: f32 = if has_alpha { 5.0 } else { 7.0 }; // fewer luma bits if alpha
    let lx = (1u32).max((l_limit * w as f32 / w.max(h) as f32).round() as u32);
    let ly = (1u32).max((l_limit * h as f32 / w.max(h) as f32).round() as u32);

    // RGBA → LPQA, compositing transparent pixels onto the average so the DCT
    // doesn't see a black fringe.
    // PERF(port): was `undefined` stack arrays — profile in Phase B
    let mut l = [0.0f32; 100 * 100];
    let mut p = [0.0f32; 100 * 100];
    let mut q = [0.0f32; 100 * 100];
    let mut a = [0.0f32; 100 * 100];
    i = 0;
    let mut px: usize = 0;
    while i < rgba.len() {
        let al: f32 = rgba[i + 3] as f32 / 255.0;
        let r = avg[0] * (1.0 - al) + al / 255.0 * rgba[i + 0] as f32;
        let g = avg[1] * (1.0 - al) + al / 255.0 * rgba[i + 1] as f32;
        let b = avg[2] * (1.0 - al) + al / 255.0 * rgba[i + 2] as f32;
        l[px] = (r + g + b) / 3.0;
        p[px] = (r + g) / 2.0 - b;
        q[px] = r - g;
        a[px] = al;
        i += 4;
        px += 1;
    }

    let lc = dct(&l[0..px], w, h, lx.max(3), ly.max(3));
    let pc = dct(&p[0..px], w, h, 3, 3);
    let qc = dct(&q[0..px], w, h, 3, 3);
    let ac = if has_alpha {
        dct(&a[0..px], w, h, 5, 5)
    } else {
        Channel { dc: 1.0, scale: 1.0, ..Channel::default() }
    };

    let land = w > h;
    let h24: u32 = ((63.0 * lc.dc).round() as u32)
        | (((31.5 + 31.5 * pc.dc).round() as u32) << 6)
        | (((31.5 + 31.5 * qc.dc).round() as u32) << 12)
        | (((31.0 * lc.scale).round() as u32) << 18)
        | ((has_alpha as u32) << 23);
    let h16: u16 = u16::try_from(if land { ly } else { lx }).unwrap()
        | (((63.0 * pc.scale).round() as u16) << 3)
        | (((63.0 * qc.scale).round() as u16) << 9)
        | ((land as u16) << 15);
    out[0] = h24 as u8;
    out[1] = (h24 >> 8) as u8;
    out[2] = (h24 >> 16) as u8;
    out[3] = h16 as u8;
    out[4] = (h16 >> 8) as u8;
    let mut n: usize = 5;
    if has_alpha {
        out[5] = ((15.0 * ac.dc).round() as u8) | (((15.0 * ac.scale).round() as u8) << 4);
        n = 6;
    }

    let mut odd = false;
    // PORT NOTE: Zig `inline for` over tuple of &Channel — all same type, plain loop.
    for ch in [&lc, &pc, &qc, &ac] {
        for &f in &ch.ac[0..ch.n] {
            let u: u8 = (15.0 * f).round() as u8;
            if odd {
                out[n - 1] |= u << 4;
            } else {
                out[n] = u;
                n += 1;
            }
            odd = !odd;
        }
    }
    &mut out[..n]
}

#[derive(Clone, Copy)]
struct Channel {
    dc: f32,
    scale: f32,
    ac: [f32; 7 * 7], // upper bound on AC count
    n: usize,
}

impl Default for Channel {
    fn default() -> Self {
        Self { dc: 0.0, scale: 0.0, ac: [0.0; 49], n: 0 }
    }
}

/// Triangular DCT-II of `chan` for the (cx,cy) where cx·ny < nx·(ny−cy) — the
/// "diagonal half" that ThumbHash keeps. Coeffs are normalised to [0,1] by
/// the per-channel max so 4-bit packing is uniform across channels.
fn dct(chan: &[f32], w: u32, h: u32, nx: u32, ny: u32) -> Channel {
    let mut c = Channel::default();
    // PERF(port): was `undefined` stack array — profile in Phase B
    let mut fx = [0.0f32; 100];
    let mut cy: u32 = 0;
    while cy < ny {
        let mut cx: u32 = 0;
        while cx * ny < nx * (ny - cy) {
            for x in 0..w as usize {
                fx[x] = (PI / w as f32 * cx as f32 * (x as f32 + 0.5)).cos();
            }
            let mut f: f32 = 0.0;
            for y in 0..h as usize {
                let fy = (PI / h as f32 * cy as f32 * (y as f32 + 0.5)).cos();
                for x in 0..w as usize {
                    f += chan[x + y * w as usize] * fx[x] * fy;
                }
            }
            f /= (w * h) as f32;
            if cx == 0 && cy == 0 {
                c.dc = f;
            } else {
                c.ac[c.n] = f;
                c.n += 1;
                c.scale = c.scale.max(f.abs());
            }
            cx += 1;
        }
        cy += 1;
    }
    if c.scale > 0.0 {
        for f in &mut c.ac[0..c.n] {
            *f = 0.5 + 0.5 / c.scale * *f;
        }
    }
    c
}

pub struct Decoded {
    pub rgba: Box<[u8]>,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum DecodeError {
    #[error("DecodeFailed")]
    DecodeFailed,
    #[error("OutOfMemory")]
    OutOfMemory,
}

impl From<DecodeError> for bun_core::Error {
    fn from(e: DecodeError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

/// Decode `hash` to a ≤32px RGBA image. Returns `error.DecodeFailed` if the
/// hash is too short. Output is `bun.default_allocator`-owned.
pub fn decode(hash: &[u8]) -> Result<Decoded, DecodeError> {
    if hash.len() < 5 {
        return Err(DecodeError::DecodeFailed);
    }
    let h24: u32 = hash[0] as u32 | (hash[1] as u32) << 8 | (hash[2] as u32) << 16;
    let h16: u16 = hash[3] as u16 | (hash[4] as u16) << 8;
    let l_dc: f32 = (h24 & 63) as f32 / 63.0;
    let p_dc: f32 = ((h24 >> 6) & 63) as f32 / 31.5 - 1.0;
    let q_dc: f32 = ((h24 >> 12) & 63) as f32 / 31.5 - 1.0;
    let l_scale: f32 = ((h24 >> 18) & 31) as f32 / 31.0;
    let has_alpha = (h24 >> 23) != 0;
    let p_scale: f32 = ((h16 >> 3) & 63) as f32 / 63.0;
    let q_scale: f32 = ((h16 >> 9) & 63) as f32 / 63.0;
    let land = (h16 >> 15) != 0;
    let l_max: u32 = if has_alpha { 5 } else { 7 };
    let lx = 3u32.max(if land { l_max } else { (h16 & 7) as u32 });
    let ly = 3u32.max(if land { (h16 & 7) as u32 } else { l_max });
    let mut a_dc: f32 = 1.0;
    let mut a_scale: f32 = 1.0;
    let mut off: usize = 5;
    if has_alpha {
        if hash.len() < 6 {
            return Err(DecodeError::DecodeFailed);
        }
        a_dc = (hash[5] & 15) as f32 / 15.0;
        a_scale = (hash[5] >> 4) as f32 / 15.0;
        off = 6;
    }

    let mut nibbles = NibbleReader { src: hash, i: off, hi: false };
    // PERF(port): was `undefined` stack arrays — profile in Phase B
    let mut l_ac = [0.0f32; 49];
    let mut p_ac = [0.0f32; 5];
    let mut q_ac = [0.0f32; 5];
    let mut a_ac = [0.0f32; 14];
    let ln = nibbles.channel(&mut l_ac, lx, ly, l_scale)?;
    // 1.25× saturation boost on decode compensates for 4-bit quantisation
    // washing the chroma out — matches the reference impl.
    let pn = nibbles.channel(&mut p_ac, 3, 3, p_scale * 1.25)?;
    let qn = nibbles.channel(&mut q_ac, 3, 3, q_scale * 1.25)?;
    let an = if has_alpha { nibbles.channel(&mut a_ac, 5, 5, a_scale)? } else { 0 };

    let ratio = lx as f32 / ly as f32;
    let w: u32 = if ratio > 1.0 { 32 } else { (32.0 * ratio).round() as u32 };
    let h: u32 = if ratio > 1.0 { (32.0 / ratio).round() as u32 } else { 32 };
    // PORT NOTE: `bun.default_allocator.alloc` → boxed slice (global mimalloc); aborts on OOM.
    let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4].into_boxed_slice();
    // errdefer free → dropped; Box<[u8]> Drop handles it.

    let mut fx = [0.0f32; 7];
    let mut fy = [0.0f32; 7];
    for y in 0..h as usize {
        for x in 0..w as usize {
            let mut lv = l_dc;
            let mut pv = p_dc;
            let mut qv = q_dc;
            let mut av = a_dc;
            let nf = lx.max(if has_alpha { 5 } else { 3 });
            for c in 0..nf as usize {
                fx[c] = (PI / w as f32 * (x as f32 + 0.5) * c as f32).cos();
            }
            for c in 0..ly.max(if has_alpha { 5 } else { 3 }) as usize {
                fy[c] = (PI / h as f32 * (y as f32 + 0.5) * c as f32).cos();
            }
            lv += idct(&l_ac[0..ln], lx, ly, &fx, &fy);
            pv += idct(&p_ac[0..pn], 3, 3, &fx, &fy);
            qv += idct(&q_ac[0..qn], 3, 3, &fx, &fy);
            if has_alpha {
                av += idct(&a_ac[0..an], 5, 5, &fx, &fy);
            }
            let b = lv - 2.0 / 3.0 * pv;
            let r = (3.0 * lv - b + qv) / 2.0;
            let g = r - qv;
            let o = (y * w as usize + x) * 4;
            rgba[o + 0] = clamp8(r);
            rgba[o + 1] = clamp8(g);
            rgba[o + 2] = clamp8(b);
            rgba[o + 3] = clamp8(av);
        }
    }
    Ok(Decoded { rgba, w, h })
}

#[inline]
fn idct(ac: &[f32], nx: u32, ny: u32, fx: &[f32; 7], fy: &[f32; 7]) -> f32 {
    let mut v: f32 = 0.0;
    let mut j: usize = 0;
    let mut cy: u32 = 0;
    while cy < ny {
        let mut cx: u32 = if cy > 0 { 0 } else { 1 };
        let fy2 = fy[cy as usize] * 2.0;
        while cx * ny < nx * (ny - cy) {
            v += ac[j] * fx[cx as usize] * fy2;
            j += 1;
            cx += 1;
        }
        cy += 1;
    }
    v
}

// PORT NOTE: local borrow-param view; lifetime is fn-scoped to `decode`.
struct NibbleReader<'a> {
    src: &'a [u8],
    i: usize,
    hi: bool,
}

impl<'a> NibbleReader<'a> {
    fn next(&mut self) -> Result<u8, DecodeError> {
        if self.i >= self.src.len() {
            return Err(DecodeError::DecodeFailed);
        }
        let v = if self.hi { self.src[self.i] >> 4 } else { self.src[self.i] & 15 };
        if self.hi {
            self.i += 1;
        }
        self.hi = !self.hi;
        Ok(v)
    }

    fn channel(&mut self, out: &mut [f32], nx: u32, ny: u32, scale: f32) -> Result<usize, DecodeError> {
        let mut n: usize = 0;
        let mut cy: u32 = 0;
        while cy < ny {
            let mut cx: u32 = if cy > 0 { 0 } else { 1 };
            while cx * ny < nx * (ny - cy) {
                out[n] = (self.next()? as f32 / 7.5 - 1.0) * scale;
                n += 1;
                cx += 1;
            }
            cy += 1;
        }
        Ok(n)
    }
}

#[inline]
fn clamp8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0) as u8
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/thumbhash.zig (260 lines)
//   confidence: high
//   todos:      0
//   notes:      160KB stack arrays kept (parity with Zig)
// ──────────────────────────────────────────────────────────────────────────
