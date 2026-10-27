//! libFuzzer: 12 bytes of settings, then a recipe for the data that both encoders get.
#![no_main]
#![allow(dead_code)]
mod args;
mod dec;
mod enc;
mod ffi;
mod rng;

const DICTIONARY: &[u8] = include_bytes!("../../../src/brotli/common/dictionary.bin");
const SIZE_BITS_BY_LENGTH: [u32; 25] = [0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5];
use dec::TEXT;

struct Bytes<'a>(&'a [u8]);
impl Bytes<'_> {
    fn u8(&mut self) -> usize {
        match self.0.split_first() {
            Some((&b, rest)) => {
                self.0 = rest;
                b as usize
            }
            None => 0,
        }
    }
    fn u16(&mut self) -> usize {
        self.u8() | self.u8() << 8
    }
}

/// A few KiB of recipe make up to `limit` bytes of data.
fn expand(recipe: &[u8], limit: usize) -> Vec<u8> {
    let mut r = Bytes(recipe);
    let mut out: Vec<u8> = Vec::new();
    while !r.0.is_empty() && out.len() < limit {
        let op = r.u8();
        match op {
            0..=127 => {
                let n = ((op & 31) + 1).min(r.0.len());
                out.extend_from_slice(&r.0[..n]);
                r.0 = &r.0[n..];
            }
            128..=159 => {
                let b = out.last().copied().unwrap_or(op as u8);
                let n = r.u16();
                out.extend(std::iter::repeat_n(b, n));
            }
            160..=191 => {
                let mut dist = r.u16() + 1;
                if op & 1 != 0 {
                    dist += r.u8() << 16;
                }
                let n = r.u16() << (op >> 1 & 3);
                if dist <= out.len() {
                    for _ in 0..n.min(limit) {
                        out.push(out[out.len() - dist]);
                    }
                }
            }
            192..=207 => {
                let mut rng = rng::Rng(r.u8() as u64);
                let n = r.u16();
                let mask = if op & 1 != 0 { 0xFF } else { 0x0F };
                out.extend((0..n).map(|_| rng.next() as u8 & mask));
            }
            208..=223 => {
                // A word of the static dictionary, as it is or the way a transform changes it.
                let len = 4 + r.u8() % 21;
                let offset: usize = (4..len).map(|l| l << SIZE_BITS_BY_LENGTH[l]).sum();
                let index = r.u16() & ((1 << SIZE_BITS_BY_LENGTH[len]) - 1);
                let start = out.len();
                if op & 1 != 0 {
                    out.push(b' ');
                }
                out.extend_from_slice(&DICTIONARY[offset + index * len..][..len]);
                if op & 2 != 0 {
                    let at = start + (op & 1);
                    out[at] = out[at].to_ascii_uppercase();
                }
                if op & 4 != 0 {
                    out.truncate(out.len() - (op >> 3 & 1) - 1);
                }
                if op & 8 != 0 {
                    out.extend_from_slice(*[&b" "[..], b", ", b". ", b"ing ", b"=\"", b" the "].get(r.u8() % 6).unwrap());
                }
            }
            224..=239 => {
                // The same bytes again and again, with something else in between.
                let n = (4 + (op & 3)).min(r.0.len());
                let marker = r.0[..n].to_vec();
                r.0 = &r.0[n..];
                let mut rng = rng::Rng(r.u8() as u64);
                for _ in 0..r.u16() << (op >> 2 & 3) {
                    if out.len() >= limit {
                        break;
                    }
                    out.extend_from_slice(&marker);
                    out.push(rng.next() as u8);
                }
            }
            _ => {
                let n = r.u16().min(out.len());
                let tail = out[out.len() - n..].to_vec();
                for _ in 0..(op & 15) + 1 {
                    out.extend_from_slice(&tail);
                }
            }
        }
    }
    out.truncate(limit);
    out
}

libfuzzer_sys::fuzz_target!(|input: &[u8]| {
    let Some((h, recipe)) = input.split_first_chunk::<12>() else { return };
    let quality = match h[0] & 15 {
        q @ 0..=11 => u32::from(q),
        12 => 12,
        13 => u32::MAX,
        14 => 1 << 31,
        _ => 1000,
    };
    let slow = (10..1 << 31).contains(&quality);
    let flags = h[4];
    let large_window = flags & 2 != 0;
    // The ring buffer is twice the window.
    let lgwin = u32::from(h[1] & 31).min(if large_window { 26 } else { 31 });
    let mut params = vec![(1, quality), (2, lgwin)];
    if h[2] & 3 != 0 {
        params.push((0, u32::from(h[2] & 3)));
    }
    let lgblock = [0, 0, 0, 0, 16, 17, 18, 20, 22, 5, 30, 24][usize::from(h[3]) % 12];
    if lgblock != 0 {
        params.push((3, lgblock));
    }
    if flags & 1 != 0 {
        params.push((4, 1));
    }
    if large_window {
        params.push((6, 1));
    }
    if h[5] & 7 != 0 {
        let npostfix = u32::from(h[5] & 7) - 1;
        params.push((7, npostfix));
        params.push((8, if h[5] & 8 != 0 { u32::from(h[6]) } else { u32::from(h[6] & 15) << npostfix.min(3) }));
    }
    // Mostly short, for speed.
    let limit = [1 << 10, 2 << 10, 2 << 10, 4 << 10, 4 << 10, 8 << 10, 20 << 10, 72 << 10][usize::from(h[10] >> 5)];
    let data = expand(recipe, if slow { limit.min(6 << 10) } else { limit });
    if flags & 128 != 0 {
        params.push((5, match h[7] & 3 { 0 => data.len() as u32, 1 => 1 << 20, 2 => u32::from(h[7]), _ => u32::MAX }));
    }
    let offset = flags & 64 != 0;
    if offset {
        params.push((9, match h[7] >> 2 & 3 { 0 => 1, 1 => u32::from(h[7]) + 1, 2 => 1 << 30, _ => 70000 }));
    }
    let n = params.len();
    params.rotate_left(usize::from(h[11]) % n);
    let dicts: Vec<Vec<u8>> = match flags >> 4 & 3 {
        0 => vec![],
        1 => vec![TEXT.to_vec()],
        2 => vec![data[..data.len() / 3].to_vec(), TEXT[..9].to_vec()],
        _ => vec![Vec::new(), data[data.len() / 2..].to_vec(), TEXT[..3].to_vec()],
    };
    let misuse = flags & 4 != 0;
    let case = enc::EncCase { data, params, dicts, schedule: u64::from(u16::from_le_bytes([h[8], h[9]])).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 4, misuse };
    match enc::compare(&case) {
        Err(e) => panic!("{e}\nparams {:?} len {} dicts {:?} schedule {} misuse {misuse}", case.params, case.data.len(), case.dicts.iter().map(Vec::len).collect::<Vec<_>>(), case.schedule),
        Ok(out) => {
            if !misuse && !offset {
                if let Err(e) = enc::round_trip(&out, &case.data, &case.dicts, true, u64::from(h[10] & 31)) {
                    panic!("{e}\nparams {:?} len {}", case.params, case.data.len());
                }
            }
        }
    }
});
