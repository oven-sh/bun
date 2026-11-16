//! RGB profiles made of three curves and a matrix, which is what displays and cameras embed.

use crate::paint::raster::{demultiply, multiply};

const STEPS: usize = 4096;
/// From XYZ relative to D50.
const TO_SRGB: [[f32; 3]; 3] = [
    [3.133_856, -1.616_867, -0.490_615],
    [-0.978_768, 1.916_142, 0.033_454],
    [0.071_945, -0.228_991, 1.405_243],
];

pub struct Conversion {
    /// What each value of each channel adds to the positions in `encoded`.
    shares: [[[f32; 4]; 256]; 3],
    encoded: [u8; STEPS],
}

fn word(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(*bytes.get(at..)?.first_chunk()?))
}

fn fixed(bytes: &[u8], at: usize) -> Option<f32> {
    Some(word(bytes, at)? as i32 as f32 / 65536.)
}

fn curve(tag: &[u8]) -> Option<[f32; 256]> {
    let at = |index: usize| index as f32 / 255.;
    if tag.starts_with(b"curv") {
        let table = tag.get(12..)?.as_chunks().0.get(..word(tag, 8)? as usize)?;
        let entry = |index: usize| f32::from(u16::from_be_bytes(table[index.min(table.len() - 1)]));
        return Some(std::array::from_fn(|index| match table.len() {
            0 => at(index),
            1 => at(index).powf(entry(0) / 256.),
            length => {
                let position = at(index) * (length - 1) as f32;
                let (below, above) = (entry(position as usize), entry(position as usize + 1));
                (below + (above - below) * position.fract()) / 65535.
            }
        }));
    }
    tag.starts_with(b"para").then_some(())?;
    let number = |index: usize| fixed(tag, 12 + index * 4);
    let [g, a, b, c, d, e, f] = match word(tag, 8)? >> 16 {
        0 => [number(0)?, 1., 0., 0., 0., 0., 0.],
        1 => [
            number(0)?,
            number(1)?,
            number(2)?,
            0.,
            -number(2)? / number(1)?,
            0.,
            0.,
        ],
        2 => [
            number(0)?,
            number(1)?,
            number(2)?,
            0.,
            -number(2)? / number(1)?,
            number(3)?,
            number(3)?,
        ],
        3 => [
            number(0)?,
            number(1)?,
            number(2)?,
            number(3)?,
            number(4)?,
            0.,
            0.,
        ],
        4 => [
            number(0)?,
            number(1)?,
            number(2)?,
            number(3)?,
            number(4)?,
            number(5)?,
            number(6)?,
        ],
        _ => return None,
    };
    Some(std::array::from_fn(|index| {
        if at(index) >= d {
            (a * at(index) + b).max(0.).powf(g) + e
        } else {
            c * at(index) + f
        }
    }))
}

impl Conversion {
    /// Nothing for a profile of another kind, or one that amounts to sRGB.
    pub fn of(profile: &[u8]) -> Option<Conversion> {
        (profile.get(16..24)? == b"RGB XYZ ").then_some(())?;
        let tags = profile
            .get(132..)?
            .as_chunks::<12>()
            .0
            .get(..word(profile, 128)? as usize)?;
        let tag = |name: &[u8]| {
            profile.get(word(tags.iter().find(|it| it.starts_with(name))?, 4)? as usize..)
        };
        // PQ and HLG are not in the curves.
        tag(b"cicp")
            .is_none_or(|it| !matches!(it.get(9), Some(16 | 18)))
            .then_some(())?;
        let column = |name: &[u8]| {
            tag(name).and_then(|it| Some([fixed(it, 8)?, fixed(it, 12)?, fixed(it, 16)?]))
        };
        let columns = [column(b"rXYZ")?, column(b"gXYZ")?, column(b"bXYZ")?];
        let encode = |it: f32| {
            if it <= 0.003_130_8 {
                it * 12.92
            } else {
                1.055 * it.powf(1. / 2.4) - 0.055
            }
        };
        let linear = [
            curve(tag(b"rTRC")?)?,
            curve(tag(b"gTRC")?)?,
            curve(tag(b"bTRC")?)?,
        ];
        let [x, y, z] = TO_SRGB.map(|row| {
            columns.map(|column| row[0] * column[0] + row[1] * column[1] + row[2] * column[2])
        });
        // White stays about white, and curves rise from about nothing.
        let is_curve =
            |it: &[f32; 256]| it.is_sorted() && it[0].abs() < 0.05 && (it[255] - 1.).abs() < 0.05;
        (linear.iter().all(is_curve)
            && [x, y, z]
                .iter()
                .all(|row| (row.iter().sum::<f32>() - 1.).abs() < 0.05))
        .then_some(())?;
        let last = (STEPS - 1) as f32;
        let conversion = Conversion {
            shares: [0, 1, 2].map(|at| {
                linear[at].map(|it| [x[at], y[at], z[at], 0.].map(|share| share * it * last))
            }),
            encoded: std::array::from_fn(|it| (encode(it as f32 / last) * 255. + 0.5) as u8),
        };
        let mut samples = (0..=255)
            .step_by(15)
            .flat_map(|it| [[it, 0, 0], [0, it, 0], [0, 0, it], [it; 3]]);
        samples
            .any(|it: [u8; 3]| {
                it.iter()
                    .zip(conversion.convert(it))
                    .any(|(a, b)| a.abs_diff(b) > 1)
            })
            .then_some(conversion)
    }

    #[inline(always)]
    fn convert(&self, color: [u8; 3]) -> [u8; 3] {
        let [r, g, b] = [0, 1, 2].map(|it| self.shares[it][usize::from(color[it])]);
        // Adding 2^23 rounds, and leaves the integer in the low bits.
        let at = [0, 1, 2, 3].map(|it| {
            ((r[it] + g[it] + b[it]).max(0.).min((STEPS - 1) as f32) + 8_388_608.).to_bits()
        });
        [0, 1, 2].map(|it| self.encoded[at[it] as usize % STEPS])
    }

    /// `pixels` are premultiplied.
    pub fn apply(&self, pixels: &mut [[u8; 4]]) {
        let (mut before, mut after) = ([0; 4], [0; 4]);
        for pixel in pixels {
            if *pixel != before {
                let [r, g, b, a] = if pixel[3] == 255 {
                    *pixel
                } else {
                    demultiply(*pixel)
                };
                let [r, g, b] = self.convert([r, g, b]);
                (before, after) = (
                    *pixel,
                    if a == 255 {
                        [r, g, b, a]
                    } else {
                        [multiply(r, a), multiply(g, a), multiply(b, a), a]
                    },
                );
            }
            *pixel = after;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Conversion;

    #[test]
    fn swaps_primaries_and_survives_truncation() {
        let mut profile = vec![0; 128];
        profile[16..24].copy_from_slice(b"RGB XYZ ");
        profile.extend(6u32.to_be_bytes());
        for (name, at) in [
            (b"rXYZ", 224u32),
            (b"gXYZ", 204),
            (b"bXYZ", 244),
            (b"rTRC", 264),
            (b"gTRC", 264),
            (b"bTRC", 264),
        ] {
            profile.extend([*name, at.to_be_bytes(), [0; 4]].as_flattened());
        }
        for column in [
            [0.4361, 0.2225, 0.0139],
            [0.3851, 0.7169, 0.0971],
            [0.1431, 0.0606, 0.7141],
        ] {
            profile.extend(b"XYZ \0\0\0\0");
            profile.extend(
                column
                    .map(|it: f32| ((it * 65536.) as u32).to_be_bytes())
                    .as_flattened(),
            );
        }
        profile.extend(b"curv\0\0\0\0\0\0\0\x01\x02\x33");
        let mut pixels = [[255, 0, 0, 255], [0, 128, 0, 128], [0; 4]];
        Conversion::of(&profile).unwrap().apply(&mut pixels);
        assert_eq!(
            pixels.map(|it| it.map(|it| it / 8)),
            [[0, 31, 0, 31], [16, 0, 0, 16], [0; 4]]
        );
        assert!((0..profile.len()).all(|it| Conversion::of(&profile[..it]).is_none()));
    }
}
