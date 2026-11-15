//! Port of highway_sourcemap.cpp, after Muła's base64 decoder and Masked VByte.
use core::mem::MaybeUninit;

const LUT_LO: [u8; 16] = [
    0x15, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x13, 0x1A, 0x1B, 0x1B, 0x1B, 0x1A,
];
const LUT_HI: [u8; 16] = [
    0x10, 0x10, 0x01, 0x02, 0x04, 0x08, 0x04, 0x08, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10,
];
const LUT_ROLL: [u8; 16] = [
    0x00, 0x10, 0x13, 0x04, 0xBF, 0xBF, 0xB9, 0xB9, 0, 0, 0, 0, 0, 0, 0, 0,
];
const SHUF_BAD: u8 = 0xFE;

static SHUF: [[u8; 16]; 256] = {
    let mut t = [[0x80u8; 16]; 256];
    let mut cont = 0;
    while cont < 256 {
        if cont & (cont >> 1) != 0 {
            t[cont][15] = SHUF_BAD;
        } else {
            let (mut pos, mut k) = (0, 0);
            while k < 5 {
                t[cont][2 * k] = pos as u8;
                if (cont >> pos) & 1 != 0 {
                    t[cont][2 * k + 1] = pos as u8 + 1;
                    pos += 2;
                } else {
                    pos += 1;
                }
                k += 1;
            }
            t[cont][15] = 0;
        }
        cont += 1;
    }
    t
};

#[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
pub struct MappingsState {
    pub gen_line: i32,
    pub gen_col: i32,
    pub orig_line: i32,
    pub orig_col: i32,
    pub src_idx: i32,
    pub name_idx: i32,
    pub needs_sort: bool,
    pub has_names: bool,
    pub fast_blocks: u32,
    pub slow_blocks: u32,
}

pub struct Columns<'a> {
    pub generated: &'a mut [[MaybeUninit<i32>; 2]],
    pub original: &'a mut [[MaybeUninit<i32>; 2]],
    pub src_idx: &'a mut [MaybeUninit<i32>],
    pub name_idx: Option<&'a mut [MaybeUninit<i32>]>,
}

#[inline(always)]
fn decode_vlq(sextets: &[u8; 80], cont: u64, p: &mut usize, end: usize) -> i32 {
    let (mut vlq, mut shift) = (0u32, 0u32);
    loop {
        vlq |= u32::from(sextets[*p] & 31) << (shift & 31);
        let more = (cont >> *p) & 1 != 0;
        *p += 1;
        if !more || *p >= end {
            break;
        }
        shift += 5;
    }
    let sign = -((vlq & 1) as i32);
    ((vlq >> 1) as i32 ^ sign) - sign
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I32, U8, U32, x128};

    fn shuffle_decode(sextets: &[u8; 80], at: usize, shuffle: &[u8; 16]) -> [i16; 8] {
        use x128::{U8, U16};
        let gathered: U16 = U8::load_from(&sextets[at..at + 16])
            .lookup(U8::load(shuffle))
            .cast();
        let raw = gathered & 0x001F | (gathered & 0x1F00) >> 3;
        let sign = U16::zero() - (raw & 1);
        ((raw >> 1 ^ sign) - sign).cast::<i16>().lanes()
    }

    fn prefix_sum(v: I32) -> I32 {
        let mut v: U32 = v.cast();
        v = v + v.slide_up(1);
        v = v + v.slide_up(2);
        if U32::LANES > 4 {
            v = v + v.slide_up(4);
        }
        if U32::LANES > 8 {
            v = v + v.slide_up(8);
        }
        v.cast()
    }

    /// Returns the rows written and the offset for the scalar decoder to resume at.
    #[export]
    pub fn parse_mappings(
        bytes: &[u8],
        out: Columns<'_>,
        sources_count: i32,
        state: &mut MappingsState,
    ) -> (usize, usize) {
        let n = U8::LANES;
        let k = I32::LANES;
        let cap = out.src_idx.len();
        let (generated, original, sources) = (
            &mut out.generated[..cap],
            &mut out.original[..cap],
            out.src_idx,
        );
        let mut names = out.name_idx.map(|names| &mut names[..cap]);
        let last_source = sources_count.wrapping_sub(1);
        let mut s = *state;

        let mut sextets = [0u8; 80];
        let mut deltas = [0i8; 64];
        let mut columns = [[0i32; 16]; 4];

        let seg5 = n / 5;
        let mask5 = (1u64 << (seg5 * 5)) - 1;
        let comma5 = 0x0842_1084_2108_4210 & mask5;

        let (mut pos, mut rows) = (0, 0);
        'blocks: while let Some(block) = bytes.get(pos..pos + n) {
            let input = U8::load_from(block);
            let (hi, lo) = (input >> 4, input & 0x0F);
            let not_b64 = (U8::table(&LUT_LO).lookup(lo) & U8::table(&LUT_HI).lookup(hi)).ne(0);
            let roll = U8::table(&LUT_ROLL).lookup(hi + input.eq(b'/').to_vec());
            let sx = not_b64.select(0xFF, input + roll);
            let is_semi = input.eq(b';');
            let is_delim = input.eq(b',') | is_semi;
            let is_invalid = not_b64 & !is_delim;
            sx.store_to(&mut sextets);
            let delim_bits = is_delim.bits();
            let cont_bits = ((sx & 0x20).ne(0) & !not_b64).bits();
            let (semi_bits, invalid_bits) = if (is_semi | is_invalid).none() {
                (0, 0)
            } else {
                (is_semi.bits(), is_invalid.bits())
            };

            let sign = U8::zero() - (sx & 1);
            ((sx >> 1 ^ sign) - sign).cast::<i8>().store_to(&mut deltas);

            'fast: {
                if (cont_bits | semi_bits | invalid_bits | (delim_bits ^ comma5)) & mask5 == 0
                    && rows + seg5 <= cap
                {
                    let (mut col, mut src, mut line, mut ocol) =
                        (s.gen_col, s.src_idx, s.orig_line, s.orig_col);
                    let (mut sort, mut range) = (0, 0);
                    let (g, o, i) = (
                        &mut generated[rows..rows + seg5],
                        &mut original[rows..rows + seg5],
                        &mut sources[rows..rows + seg5],
                    );
                    for (((d, g), o), i) in deltas.as_chunks::<5>().0.iter().zip(g).zip(o).zip(i) {
                        col = col.wrapping_add(d[0].into());
                        sort |= d[0];
                        src = src.wrapping_add(d[1].into());
                        line = line.wrapping_add(d[2].into());
                        ocol = ocol.wrapping_add(d[3].into());
                        range |= col | src | last_source.wrapping_sub(src) | line | ocol;
                        *g = [s.gen_line, col].map(MaybeUninit::new);
                        *o = [line, ocol].map(MaybeUninit::new);
                        i.write(src);
                    }
                    if range < 0 {
                        break 'fast;
                    }
                    if let Some(names) = &mut names {
                        names[rows..rows + seg5].fill(MaybeUninit::new(if s.has_names {
                            s.name_idx
                        } else {
                            -1
                        }));
                    }
                    (s.gen_col, s.src_idx, s.orig_line, s.orig_col) = (col, src, line, ocol);
                    s.needs_sort |= sort < 0;
                    rows += seg5;
                    pos += seg5 * 5;
                    s.fast_blocks += 1;
                    continue 'blocks;
                }

                if semi_bits | invalid_bits != 0 || delim_bits == 0 {
                    break 'fast;
                }
                let (mut dm, mut cm, mut bp, mut m) = (delim_bits, cont_bits, 0usize, 0usize);
                for column in &mut columns {
                    I32::zero().store_to(column);
                }
                loop {
                    let len = dm.trailing_zeros();
                    if len.wrapping_sub(4) > 6 || (cm >> (len - 1)) & 1 != 0 {
                        break 'fast;
                    }
                    let cont = cm & ((1 << len) - 1);
                    let fields = if cont == 0 {
                        len
                    } else {
                        len - cont.count_ones()
                    };
                    let shuffle = &SHUF[(cont & 0xFF) as usize];
                    if fields != 4 || cont >> 8 != 0 || shuffle[15] == SHUF_BAD {
                        break 'fast;
                    }
                    let d = shuffle_decode(&sextets, bp, shuffle);
                    columns[0][m] = d[0].into();
                    columns[1][m] = d[1].into();
                    columns[2][m] = d[2].into();
                    columns[3][m] = d[3].into();
                    m += 1;
                    bp += len as usize + 1;
                    dm >>= len + 1;
                    cm >>= len + 1;
                    if dm == 0 || bp >= n {
                        break;
                    }
                }
                if rows + m > cap {
                    break 'fast;
                }
                let column = |c: usize| I32::load_from(&columns[c]);
                let col = prefix_sum(column(0)) + s.gen_col;
                let src = prefix_sum(column(1)) + s.src_idx;
                let line = prefix_sum(column(2)) + s.orig_line;
                let ocol = prefix_sum(column(3)) + s.orig_col;
                if (col | src | (I32::splat(last_source) - src) | line | ocol)
                    .lt(0)
                    .any()
                {
                    break 'fast;
                }
                s.needs_sort |= column(0).lt(0).any();

                let (g_lo, g_hi) = I32::splat(s.gen_line).interleave(col);
                let (o_lo, o_hi) = line.interleave(ocol);
                let name = if s.has_names { s.name_idx } else { -1 };
                if rows + k <= cap {
                    // Whole vectors: the rows after the first `m` are written again.
                    let (g, o) = (
                        generated[rows..rows + k].as_flattened_mut(),
                        original[rows..rows + k].as_flattened_mut(),
                    );
                    g_lo.write_to(g);
                    g_hi.write_to(&mut g[k..]);
                    o_lo.write_to(o);
                    o_hi.write_to(&mut o[k..]);
                    src.write_to(&mut sources[rows..]);
                    if let Some(names) = &mut names {
                        I32::splat(name).write_to(&mut names[rows..]);
                    }
                } else {
                    let (g, o) = ([g_lo.lanes(), g_hi.lanes()], [o_lo.lanes(), o_hi.lanes()]);
                    generated[rows..rows + m]
                        .as_flattened_mut()
                        .write_copy_of_slice(&g.as_flattened()[..2 * m]);
                    original[rows..rows + m]
                        .as_flattened_mut()
                        .write_copy_of_slice(&o.as_flattened()[..2 * m]);
                    sources[rows..rows + m].write_copy_of_slice(&src.lanes()[..m]);
                    if let Some(names) = &mut names {
                        names[rows..rows + m].fill(MaybeUninit::new(name));
                    }
                }
                (s.gen_col, s.src_idx, s.orig_line, s.orig_col) = (
                    col.lanes()[m - 1],
                    src.lanes()[m - 1],
                    line.lanes()[m - 1],
                    ocol.lanes()[m - 1],
                );
                rows += m;
                pos += bp;
                s.fast_blocks += 1;
                continue 'blocks;
            }

            s.slow_blocks += 1;
            let first_invalid = if invalid_bits != 0 {
                invalid_bits.trailing_zeros() as usize
            } else {
                n
            };
            let (mut delim, mut semi, mut cont, mut p) = (delim_bits, semi_bits, cont_bits, 0usize);
            let bail = loop {
                if semi & 1 != 0 {
                    let run = (!semi).trailing_zeros();
                    s.gen_line = s.gen_line.wrapping_add(run as i32);
                    s.gen_col = 0;
                    p += run as usize;
                    if run == 64 {
                        break false;
                    }
                    delim >>= run;
                    semi >>= run;
                    cont >>= run;
                }
                if p >= n {
                    break false;
                }
                if delim & 1 != 0 {
                    break true;
                }
                if delim == 0 {
                    break p == 0;
                }
                let len = delim.trailing_zeros() as usize;
                if p + len > first_invalid || (cont >> (len - 1)) & 1 != 0 || len > 10 {
                    break true;
                }
                let seg_cont = cont & ((1 << len) - 1);
                let fields = if seg_cont == 0 {
                    len
                } else {
                    len - seg_cont.count_ones() as usize
                };
                if fields > 5 {
                    break true;
                }

                let shuffle = &SHUF[(seg_cont & 0xFF) as usize];
                let mut d = [0i32; 5];
                if fields >= 4 && seg_cont >> 8 == 0 && shuffle[15] != SHUF_BAD {
                    if rows >= cap {
                        break true;
                    }
                    let v = shuffle_decode(&sextets, p, shuffle);
                    d = [
                        v[0].into(),
                        v[1].into(),
                        v[2].into(),
                        v[3].into(),
                        if fields == 5 { v[4].into() } else { 0 },
                    ];
                } else if fields >= 4 {
                    if rows >= cap {
                        break true;
                    }
                    let mut q = p;
                    for field in &mut d[..fields] {
                        *field = decode_vlq(&sextets, cont_bits, &mut q, p + len);
                    }
                } else if fields == 1 && len <= 7 {
                    d[0] = decode_vlq(&sextets, cont_bits, &mut { p }, p + len);
                } else {
                    break true;
                }

                let col = s.gen_col.wrapping_add(d[0]);
                if col < 0 {
                    break true;
                }
                if fields != 1 {
                    let (src, line, ocol) = (
                        s.src_idx.wrapping_add(d[1]),
                        s.orig_line.wrapping_add(d[2]),
                        s.orig_col.wrapping_add(d[3]),
                    );
                    if (src | last_source.wrapping_sub(src) | line | ocol) < 0 {
                        break true;
                    }
                    (s.src_idx, s.orig_line, s.orig_col) = (src, line, ocol);
                    if fields == 5 {
                        s.name_idx = s.name_idx.wrapping_add(d[4]);
                        s.has_names = true;
                    }
                    generated[rows] = [s.gen_line, col].map(MaybeUninit::new);
                    original[rows] = [line, ocol].map(MaybeUninit::new);
                    sources[rows].write(src);
                    if let Some(names) = &mut names {
                        names[rows].write(if s.has_names { s.name_idx } else { -1 });
                    }
                    rows += 1;
                }
                s.needs_sort |= d[0] < 0;
                s.gen_col = col;
                let advance = len + usize::from((semi >> len) & 1 == 0);
                p += advance;
                if p >= n {
                    break false;
                }
                delim >>= advance;
                semi >>= advance;
                cont >>= advance;
            };
            pos += p;
            if bail {
                break;
            }
        }
        *state = s;
        (rows, pos)
    }
}
