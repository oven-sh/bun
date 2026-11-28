//! The tests in test/js/bun/image see the kernels for the CPU that they run on. These see all that it can run.

use bun_simd::target::{Target, set_cpu};
use bun_webp::{Compression, Decoder, encode};

fn picture(width: u32, height: u32, grain: u8, is_opaque: bool) -> Vec<u8> {
    let mut state = 1u32;
    let mut pixel = |x: u32, y: u32| {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        let [r, g, b, _] = state.to_le_bytes().map(|it| it % grain);
        let (slope, step) = ((3 * x + y) as u8, (x / 11 + y / 7) as u8 % 3 * 90);
        let alpha = if is_opaque { 255 } else { (x * y / 4) as u8 };
        [
            slope.saturating_add(r),
            step.saturating_add(g),
            slope ^ b,
            alpha,
        ]
    };
    let positions = (0..height).flat_map(|y| (0..width).map(move |x| (x, y)));
    positions.flat_map(|(x, y)| pixel(x, y)).collect()
}

/// FNV-1a of all files and of what becomes of them, also with a bit changed.
fn checksum() -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut add = |bytes: &[u8]| {
        for &byte in bytes {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
        }
    };
    let lossy = [0, 30, 80, 100].map(|quality| Compression::Lossy { quality });
    for (width, height) in [(1, 40), (15, 3), (16, 16), (33, 50), (100, 35)] {
        for (grain, is_opaque) in [(1, true), (9, false), (255, true)] {
            let rgba = picture(width, height, grain, is_opaque);
            for compression in lossy.into_iter().chain([Compression::Lossless]) {
                let mut file = encode(&rgba, width, height, compression, None).unwrap();
                add(&file);
                add(&Decoder::new(&file).unwrap().decode().unwrap().rgba);
                // Among them is the one for the simple loop filter.
                for bit in 8 * 30..8 * file.len().min(34) {
                    file[bit / 8] ^= 1 << (bit % 8);
                    let image = Decoder::new(&file).and_then(Decoder::decode);
                    add(&image.map_or(Vec::new(), |it| it.rgba));
                    file[bit / 8] ^= 1 << (bit % 8);
                }
            }
        }
    }
    hash
}

struct Noise(u32);

impl Noise {
    fn below(&mut self, end: u32) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        (self.0 >> 4) % end
    }

    fn one_of(&mut self, choices: &[u32]) -> u32 {
        choices[self.below(choices.len() as u32) as usize]
    }
}

/// RFC 6386 section 7.3, for bits that are as likely as not.
fn bool_coded(fields: &[(u32, u32)]) -> Vec<u8> {
    let (mut out, mut range, mut bottom, mut left) = (Vec::<u8>::new(), 255_u32, 0_u32, 24);
    let bits = |&(value, len): &(u32, u32)| (0..len).rev().map(move |at| value >> at & 1);
    for bit in fields.iter().flat_map(bits) {
        let split = 1 + ((range - 1) >> 1);
        bottom += bit * split;
        range = if bit == 1 { range - split } else { split };
        while range < 128 {
            range <<= 1;
            if bottom >> 31 != 0 {
                let last = out.iter().rposition(|&it| it != 255).unwrap();
                out[last] += 1;
                out[last + 1..].fill(0);
            }
            bottom <<= 1;
            left -= 1;
            if left == 0 {
                out.push((bottom >> 24) as u8);
                (bottom, left) = (bottom & 0xff_ffff, 8);
            }
        }
    }
    out
}

/// Behind the header, noise stands for any modes and coefficients.
fn handmade(noise: &mut Noise) -> Vec<u8> {
    let width = noise.one_of(&[1, 1, 2, 3, 17, 40, 62, 64, 100]);
    let height = noise.one_of(&[1, 2, 16, 20, 33, 50]);
    // Four segments, with a quantizer and a level of the filter each.
    let mut fields = vec![(0b1111, 6)];
    fields.extend([(); 4].map(|()| (256 | noise.one_of(&[0, 5, 30, 127]) << 1, 9)));
    fields.extend([(); 4].map(|()| (128 | noise.one_of(&[0, 1, 3, 20, 63]) << 1, 8)));
    fields.extend([(256 | 128, 9); 3]);
    // The type of the filter, its level and sharpness, one partition, and no more about quantizers.
    fields.extend([(noise.below(2), 1), (9, 6), (noise.below(8), 3), (0, 16)]);
    fields.extend((0..500).map(|_| (noise.below(1 << 16), 16)));
    let modes = bool_coded(&fields);
    let mut frame = ((modes.len() as u32) << 5 | 16).to_le_bytes()[..3].to_vec();
    frame.extend([0x9d, 1, 0x2a, width as u8, 0, height as u8, 0]);
    frame.extend(modes);
    // Zeros end blocks, and ones make large coefficients.
    let (zeros, ones) = (noise.one_of(&[1, 3, 30]), noise.one_of(&[1, 1, 4]));
    let end = frame.len() + noise.one_of(&[40, 20_000, 20_000, 20_000]) as usize;
    while frame.len() < end {
        frame.extend((0..noise.below(zeros)).map(|_| 0));
        frame.extend((0..noise.below(ones)).map(|_| 255));
        frame.push(noise.below(256) as u8);
    }
    let mut alpha = vec![noise.one_of(&[0, 4, 8, 12, 16, 24, 28, 32, 64, 2]) as u8];
    let len = width * height - noise.below(8) / 7;
    alpha.extend((0..len).map(|_| noise.below(256) as u8));
    let canvas = [16, 0, 0, 0, width as u8 - 1, 0, 0, height as u8 - 1, 0, 0];
    let chunks = [(b"VP8X", &canvas[..]), (b"ALPH", &alpha), (b"VP8 ", &frame)];
    let mut body = b"WEBP".to_vec();
    for (name, data) in &chunks[noise.one_of(&[0, 2, 2]) as usize..] {
        body.extend(
            [*name, &(data.len() as u32).to_le_bytes()]
                .map(|it| *it)
                .as_flattened(),
        );
        body.extend(*data);
        body.resize(body.len().next_multiple_of(2), 0);
    }
    [b"RIFF", &(body.len() as u32).to_le_bytes()[..], &body].concat()
}

/// Areas that are flat, smooth, grainy, transparent or of few colors.
fn patchwork(noise: &mut Noise) -> (u32, u32, Vec<u8>) {
    let width = noise.one_of(&[1, 2, 5, 15, 16, 31, 47, 70, 130]);
    let height = noise.one_of(&[1, 3, 15, 16, 31, 40, 90]);
    let (size, kinds) = (noise.one_of(&[4, 16, 23, 200]), noise.one_of(&[2, 5, 7]));
    let patches: [_; 16] = std::array::from_fn(|_| (noise.below(kinds), noise.below(1 << 28)));
    let pixel = |i: u32| {
        let (x, y) = (i % width, i / width);
        let (kind, color) = patches[(x / size + y / size * 5) as usize % 16];
        let [r, g, b, slope] = color.to_le_bytes().map(u32::from);
        let smooth = (x * slope + y * (r % 9)) / 3;
        let grain = noise.below([1, 1, 3, 12, 99, 2, 6][kind as usize]);
        let smooth = if kind == 0 { 0 } else { smooth + grain };
        let alpha = [255, 255, 255, 255, 255, 0, smooth][kind as usize];
        [r + smooth, g + smooth / 2, b + 2 * smooth, alpha].map(|it| it as u8)
    };
    (width, height, (0..width * height).flat_map(pixel).collect())
}

fn checksum_of_more() -> u64 {
    let (mut hash, mut noise) = (0_u64, Noise(1));
    let mut add = |bytes: &[u8]| {
        for &byte in bytes.iter().chain(&[1]) {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
        }
    };
    let decode = |file: &[u8]| Decoder::new(file).and_then(Decoder::decode);
    for _ in 0..500 {
        add(&decode(&handmade(&mut noise)).map_or(Vec::new(), |it| it.rgba));
    }
    for i in 0..150 {
        let (width, height, rgba) = patchwork(&mut noise);
        let compression = match i % 3 {
            0 => Compression::Lossless,
            _ => Compression::Lossy { quality: i / 3 * 2 },
        };
        let file = encode(&rgba, width, height, compression, None).unwrap();
        add(&file);
        add(&decode(&file).unwrap().rgba);
    }
    // Repeats after 16 pixels in rows that are as long as the columns.
    let pixel = |i: u32| [(i % 40 % 16 * 9 + i % 40 / 32 * 90) as u8, 9, 99, 255];
    let rgba: Vec<_> = (0..50 * 40).flat_map(pixel).collect();
    add(&encode(&rgba, 50, 40, Compression::Lossy { quality: 90 }, None).unwrap());
    hash
}

/// Pictures for which a choice of the encoder is close.
fn checksum_of_close_calls() -> u64 {
    let mut files = Vec::new();
    for seed in [122, 241, 527, 1740, 1764, 1947, 3515, 11102] {
        let (width, height, rgba) = patchwork(&mut Noise(seed));
        let quality = (seed % 101) as u8;
        let compression = match seed % 3 {
            0 => Compression::Lossless,
            _ => Compression::Lossy { quality },
        };
        files.extend(encode(&rgba, width, height, compression, None).unwrap());
    }
    // Between the two predictions for the first macroblock.
    let grays = [[132, 130, 133, 255], [130, 130, 130, 255]];
    let rgba: Vec<_> = (0..256).flat_map(|i| grays[(i / 2 + i / 32) % 2]).collect();
    files.extend(encode(&rgba, 16, 16, Compression::Lossy { quality: 20 }, None).unwrap());
    let add = |hash: u64, &byte| (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
    files.iter().fold(0, add)
}

#[test]
fn all_targets_write_and_read_the_same() {
    for &target in Target::ALL {
        if set_cpu(target) {
            assert_eq!(checksum(), 0xcd41_aece_f401_1f65, "{target:?}");
            assert_eq!(checksum_of_more(), 3403868502489305262, "{target:?}");
            assert_eq!(checksum_of_close_calls(), 1898335772526929136, "{target:?}");
        }
    }
}
