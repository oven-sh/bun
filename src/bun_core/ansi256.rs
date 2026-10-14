//! RGB to the 256-color and 16-color terminal palettes.
//!
//! <https://github.com/tmux/tmux/blob/dae2868d1227b95fd076fb4a5efa6256c7245943/colour.c#L44-L55>

use std::io::Write as _;

const Q2C: [u32; 6] = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

fn sqdist(r_: u32, g_: u32, b_: u32, r: u32, g: u32, b: u32) -> u32 {
    (r_.wrapping_sub(r))
        .wrapping_mul(r_.wrapping_sub(r))
        .wrapping_add((g_.wrapping_sub(g)).wrapping_mul(g_.wrapping_sub(g)))
        .wrapping_add((b_.wrapping_sub(b)).wrapping_mul(b_.wrapping_sub(b)))
}

fn to_6_cube(v: u32) -> u32 {
    if v < 48 {
        return 0;
    }
    if v < 114 {
        return 1;
    }
    (v - 35) / 40
}

/// The index in the 256-color palette that is closest to a color.
pub fn get(r: u32, g: u32, b: u32) -> u32 {
    let qr = to_6_cube(r);
    let cr = Q2C[usize::try_from(qr).expect("int cast")];
    let qg = to_6_cube(g);
    let cg = Q2C[usize::try_from(qg).expect("int cast")];
    let qb = to_6_cube(b);
    let cb = Q2C[usize::try_from(qb).expect("int cast")];

    if cr == r && cg == g && cb == b {
        return 16u32
            .wrapping_add(36u32.wrapping_mul(qr))
            .wrapping_add(6u32.wrapping_mul(qg))
            .wrapping_add(qb);
    }

    let grey_avg = (r.wrapping_add(g).wrapping_add(b)) / 3;
    let grey_idx = if grey_avg > 238 {
        23
    } else {
        // tmux does this in signed int, where (2 - 3) / 10 truncates to 0.
        // Wrapping on u32 would send the palette index into the hundreds of
        // millions for any average below 3.
        grey_avg.saturating_sub(3) / 10
    };
    let grey = 8u32.wrapping_add(10u32.wrapping_mul(grey_idx));

    let d = sqdist(cr, cg, cb, r, g, b);
    if sqdist(grey, grey, grey, r, g, b) < d {
        232u32.wrapping_add(grey_idx)
    } else {
        16u32
            .wrapping_add(36u32.wrapping_mul(qr))
            .wrapping_add(6u32.wrapping_mul(qg))
            .wrapping_add(qb)
    }
}

const TABLE_256: [u8; 256] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 4, 4, 4, 12, 12, 2, 6, 4, 4, 12,
    12, 2, 2, 6, 4, 12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14,
    1, 5, 4, 4, 12, 12, 3, 8, 4, 4, 12, 12, 2, 2, 6, 4, 12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10,
    10, 14, 12, 10, 10, 10, 10, 10, 14, 1, 1, 5, 4, 12, 12, 1, 1, 5, 4, 12, 12, 3, 3, 8, 4, 12,
    12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14, 1, 1, 1, 5, 12, 12,
    1, 1, 1, 5, 12, 12, 1, 1, 1, 5, 12, 12, 3, 3, 3, 7, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10,
    10, 10, 10, 14, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13,
    12, 11, 11, 11, 11, 7, 12, 10, 10, 10, 10, 10, 14, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 9,
    9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 11, 11, 11, 11, 11, 15, 0, 0, 0, 0,
    0, 0, 8, 8, 8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 15, 15, 15, 15, 15, 15,
];

/// The same in the 16-color palette.
pub fn get16(r: u32, g: u32, b: u32) -> u8 {
    let val = get(r, g, b);
    TABLE_256[(val & 0xff) as usize]
}

pub type Buffer = [u8; 24];

/// Takes the channels directly so the pure escape-sequence builder
/// doesn't depend on `bun_css::values::color`.
pub fn from(red: u8, green: u8, blue: u8, buf: &mut Buffer) -> &[u8] {
    let val = get(red as u32, green as u32, blue as u32);
    // 0x1b is the escape character
    buf[0] = 0x1b;
    buf[1] = b'[';
    buf[2] = b'3';
    buf[3] = b'8';
    buf[4] = b';';
    buf[5] = b'5';
    buf[6] = b';';
    let extra_len = {
        let mut cursor = &mut buf[7..];
        let before = cursor.len();
        write!(cursor, "{}m", val).expect("unreachable");
        before - cursor.len()
    };
    &buf[0..7 + extra_len]
}
