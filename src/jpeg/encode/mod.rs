//! The encoder: what `tj3Compress8` did with RGBA pixels, 4:2:0 subsampling and otherwise default parameters
//! (turbojpeg.c, jcparam.c, jcmaster.c, jccoefct.c).

mod fdct;
mod huff;
mod marker;
mod phuff;
mod sample;

use crate::error::{Error, Result, try_vec};
use crate::tables::{self, HuffSpec, NATURAL_ORDER};
use fdct::Divisors;
use huff::{BitWriter, Counts, EncodeTable, Output};
use phuff::{AcEncoder, Sink};
use sample::{MCU_SIZE, McuRowSamples};

/// The quantized coefficients of a block.
#[derive(Clone, Copy)]
struct Block {
    /// In row-major order.
    coefs: [i16; 64],
    /// Bit `k` is set if the `k`th coefficient in zigzag order is not zero. Most are, and nothing looks at those.
    nonzero: u64,
}

impl Block {
    /// A block outside of the image.
    const fn flat(dc: i16) -> Self {
        let mut coefs = [0; 64];
        let [first, ..] = &mut coefs;
        *first = dc;
        Block { coefs, nonzero: 0 }
    }

    #[inline(always)]
    fn dc(&self) -> i16 {
        let [dc, ..] = self.coefs;
        dc
    }

    /// The `k`th coefficient in zigzag order.
    #[inline(always)]
    fn zigzag(&self, k: u32) -> i16 {
        let position = NATURAL_ORDER.get(k as usize).copied().unwrap_or(0);
        self.coefs.get(usize::from(position)).copied().unwrap_or(0)
    }

    /// `nonzero` for the coefficients from `first` to `last`.
    #[inline(always)]
    fn nonzero_between(&self, first: u32, last: u32) -> u64 {
        self.nonzero & (u64::MAX << first) & (u64::MAX >> (63 - last))
    }
}

const MAX_DIMENSION: u32 = 65500;

struct Component {
    id: u8,
    /// The sampling factor, horizontal and vertical.
    samp: u8,
    /// The number of its quantization table and of its Huffman tables.
    table: u8,
}

/// Y, Cb and Cr.
const COMPONENTS: [Component; 3] = [
    Component {
        id: 1,
        samp: 2,
        table: 0,
    },
    Component {
        id: 2,
        samp: 1,
        table: 1,
    },
    Component {
        id: 3,
        samp: 1,
        table: 1,
    },
];

struct Scan {
    /// Indexes into `COMPONENTS`.
    comps: &'static [usize],
    /// The first and the last coefficient, in zigzag order.
    ss: u8,
    se: u8,
    /// The bit position that the scan before this one of the same coefficients stopped at, or 0 if this is the first.
    ah: u8,
    /// The bit position that this scan stops at.
    al: u8,
}

const fn scan(comps: &'static [usize], ss: u8, se: u8, ah: u8, al: u8) -> Scan {
    Scan {
        comps,
        ss,
        se,
        ah,
        al,
    }
}

const SEQUENTIAL_SCAN: Scan = scan(&[0, 1, 2], 0, 63, 0, 0);

/// `jpeg_simple_progression` for YCbCr.
const PROGRESSIVE_SCANS: [Scan; 10] = [
    scan(&[0, 1, 2], 0, 0, 0, 1),
    // Enough of luma for a first picture.
    scan(&[0], 1, 5, 0, 2),
    // Chroma is small enough to come all at once.
    scan(&[2], 1, 63, 0, 1),
    scan(&[1], 1, 63, 0, 1),
    scan(&[0], 6, 63, 0, 2),
    scan(&[0], 1, 63, 2, 1),
    scan(&[0, 1, 2], 0, 0, 1, 0),
    scan(&[2], 1, 63, 1, 0),
    scan(&[1], 1, 63, 1, 0),
    // The lowest bit of luma is most of the file.
    scan(&[0], 1, 63, 1, 0),
];

pub struct EncodeOptions<'a> {
    /// From 1 to 100.
    pub quality: u8,
    pub progressive: bool,
    /// Goes into APP2 segments. Must not be empty.
    pub icc_profile: Option<&'a [u8]>,
}

/// `jpeg_set_quality` with `force_baseline`.
fn scaled_quant_table(base: &[u16; 64], quality: u8) -> [u16; 64] {
    let quality = u32::from(quality);
    let scale = if quality < 50 {
        5000 / quality.max(1)
    } else {
        200 - quality * 2
    };
    base.map(|step| ((u32::from(step) * scale + 50) / 100).clamp(1, 255) as u16)
}

/// The blocks of a component. A row holds a whole number of MCUs, and there is a whole number of rows of MCUs.
struct BlockRows {
    blocks: Vec<Block>,
    blocks_per_row: usize,
}

impl BlockRows {
    fn new(blocks_per_row: usize, rows: usize) -> Result<Self> {
        Ok(BlockRows {
            blocks: try_vec(Block::flat(0), blocks_per_row * rows)?,
            blocks_per_row,
        })
    }

    fn rows(&self) -> impl Iterator<Item = &[Block]> {
        self.blocks.chunks_exact(self.blocks_per_row)
    }
}

/// How much of a component is image. The rest is there to fill up the MCUs.
#[derive(Clone, Copy)]
struct Extent {
    width_in_blocks: usize,
    height_in_blocks: usize,
}

/// Transforms the rows of blocks that a row of MCUs holds of one component.
///
/// `first_row` is the number of the first of them in the image. A block outside of the image has no AC coefficients, and
/// the DC coefficient of the block that precedes it in its MCU, to take the fewest bits.
fn transform_rows(
    samples: &[u8],
    divisors: &Divisors,
    extent: Extent,
    samp: usize,
    first_row: usize,
    out: &mut [Block],
) -> Result<()> {
    let blocks_per_row = out.len() / samp;
    let mut above: Option<&[Block]> = None;
    for ((row, samples), out) in (first_row..)
        .zip(samples.chunks_exact(blocks_per_row * 64))
        .zip(out.chunks_exact_mut(blocks_per_row))
    {
        if row < extent.height_in_blocks {
            let mut lines = samples
                .chunks_exact(blocks_per_row * 8)
                .map(|line| line.as_chunks::<8>().0);
            let lines: [&[[u8; 8]]; 8] = core::array::from_fn(|_| lines.next().unwrap_or_default());
            let (image, dummy) = out
                .split_at_mut_checked(extent.width_in_blocks)
                .ok_or(Error::Internal)?;
            for (x, block) in image.iter_mut().enumerate() {
                let samples = lines.map(|line| line.get(x).copied().unwrap_or_default());
                *block = fdct::forward(&samples, divisors);
            }
            dummy.fill(Block::flat(image.last().ok_or(Error::Internal)?.dc()));
        } else {
            let above = above.ok_or(Error::Internal)?;
            for (out, above) in out.chunks_exact_mut(samp).zip(above.chunks_exact(samp)) {
                out.fill(Block::flat(above.last().ok_or(Error::Internal)?.dc()));
            }
        }
        above = Some(out);
    }
    Ok(())
}

/// The blocks of an MCU in the order in which an interleaved scan has them.
struct Mcu<'a> {
    y: [&'a Block; 4],
    cb: &'a Block,
    cr: &'a Block,
}

fn mcus<'a>(
    y: &'a BlockRows,
    cb: &'a BlockRows,
    cr: &'a BlockRows,
) -> impl Iterator<Item = Mcu<'a>> {
    y.blocks
        .chunks_exact(y.blocks_per_row * 2)
        .zip(cb.rows())
        .zip(cr.rows())
        .flat_map(|((y, cb), cr)| {
            let (top, bottom) = y.split_at(y.len() / 2);
            top.as_chunks::<2>()
                .0
                .iter()
                .zip(bottom.as_chunks::<2>().0)
                .zip(cb)
                .zip(cr)
                .map(|((([y0, y1], [y2, y3]), cb), cr)| Mcu {
                    y: [y0, y1, y2, y3],
                    cb,
                    cr,
                })
        })
}

struct Encoder<'a> {
    rgba: &'a [u8],
    width: u16,
    height: u16,
    mcus_per_row: usize,
    mcu_rows: usize,
    luma_extent: Extent,
    chroma_extent: Extent,
    quant: [[u16; 64]; 2],
    luma_divisors: Divisors,
    chroma_divisors: Divisors,
    samples: McuRowSamples,
}

impl Encoder<'_> {
    /// Fills in rows of MCUs from `first_mcu_row` on.
    fn transform(
        &mut self,
        first_mcu_row: usize,
        y: &mut BlockRows,
        cb: &mut BlockRows,
        cr: &mut BlockRows,
    ) -> Result<()> {
        let (luma_divisors, chroma_divisors) = (&self.luma_divisors, &self.chroma_divisors);
        let width = usize::from(self.width);
        for (((mcu_row, y), cb), cr) in (first_mcu_row..)
            .zip(y.blocks.chunks_exact_mut(self.mcus_per_row * 4))
            .zip(cb.blocks.chunks_exact_mut(self.mcus_per_row))
            .zip(cr.blocks.chunks_exact_mut(self.mcus_per_row))
        {
            let rows = self
                .rgba
                .get(mcu_row * MCU_SIZE * width * 4..)
                .ok_or(Error::Internal)?;
            self.samples.fill(rows, width)?;
            let samples = &self.samples;
            transform_rows(
                &samples.y,
                luma_divisors,
                self.luma_extent,
                2,
                mcu_row * 2,
                y,
            )?;
            transform_rows(
                &samples.cb,
                chroma_divisors,
                self.chroma_extent,
                1,
                mcu_row,
                cb,
            )?;
            transform_rows(
                &samples.cr,
                chroma_divisors,
                self.chroma_extent,
                1,
                mcu_row,
                cr,
            )?;
        }
        Ok(())
    }

    fn encode_sequential(&mut self, out: &mut Output) -> Result<()> {
        out.frame_header(self.width, self.height, false, &self.quant);
        let specs = [
            (&tables::STD_DC_LUMINANCE, &tables::STD_AC_LUMINANCE),
            (&tables::STD_DC_CHROMINANCE, &tables::STD_AC_CHROMINANCE),
        ];
        for (index, (dc, ac)) in specs.into_iter().enumerate() {
            out.huff_table(index as u8, false, dc);
            out.huff_table(index as u8, true, ac);
        }
        out.scan_header(&SEQUENTIAL_SCAN);

        let [(luma_dc, luma_ac), (chroma_dc, chroma_ac)] = specs;
        let luma_dc = EncodeTable::new(luma_dc)?;
        let luma_ac = EncodeTable::new(luma_ac)?;
        let chroma_dc = EncodeTable::new(chroma_dc)?;
        let chroma_ac = EncodeTable::new(chroma_ac)?;

        let mut y = BlockRows::new(self.mcus_per_row * 2, 2)?;
        let mut cb = BlockRows::new(self.mcus_per_row, 1)?;
        let mut cr = BlockRows::new(self.mcus_per_row, 1)?;
        let mut bits = BitWriter::new(out);
        let [mut last_y, mut last_cb, mut last_cr] = [0i16; 3];
        for mcu_row in 0..self.mcu_rows {
            self.transform(mcu_row, &mut y, &mut cb, &mut cr)?;
            for mcu in mcus(&y, &cb, &cr) {
                for block in mcu.y {
                    huff::encode_block(&mut bits, block, last_y, &luma_dc, &luma_ac);
                    last_y = block.dc();
                }
                huff::encode_block(&mut bits, mcu.cb, last_cb, &chroma_dc, &chroma_ac);
                last_cb = mcu.cb.dc();
                huff::encode_block(&mut bits, mcu.cr, last_cr, &chroma_dc, &chroma_ac);
                last_cr = mcu.cr.dc();
            }
        }
        bits.finish();
        Ok(())
    }

    fn encode_progressive(&mut self, out: &mut Output) -> Result<()> {
        let mut y = BlockRows::new(self.mcus_per_row * 2, self.mcu_rows * 2)?;
        let mut cb = BlockRows::new(self.mcus_per_row, self.mcu_rows)?;
        let mut cr = BlockRows::new(self.mcus_per_row, self.mcu_rows)?;
        self.transform(0, &mut y, &mut cb, &mut cr)?;

        for (index, scan) in PROGRESSIVE_SCANS.iter().enumerate() {
            let al = u32::from(scan.al);
            let is_dc = scan.ss == 0;
            let run = |sink: &mut Sink| match *scan.comps {
                // Only a scan of one component leaves out the blocks that are not image.
                [ci] => {
                    let (blocks, extent, table) = match ci {
                        0 => (&y, self.luma_extent, 0),
                        1 => (&cb, self.chroma_extent, 1),
                        _ => (&cr, self.chroma_extent, 1),
                    };
                    let mut encoder = AcEncoder::new(table, scan);
                    for row in blocks.rows().take(extent.height_in_blocks) {
                        for block in row.iter().take(extent.width_in_blocks) {
                            if scan.ah == 0 {
                                encoder.encode_first(sink, block);
                            } else {
                                encoder.encode_refine(sink, block);
                            }
                        }
                    }
                    encoder.finish(sink);
                }
                _ if scan.ah == 0 => {
                    let [mut last_y, mut last_cb, mut last_cr] = [0i32; 3];
                    for mcu in mcus(&y, &cb, &cr) {
                        for block in mcu.y {
                            last_y = phuff::encode_dc_first(sink, 0, block, al, last_y);
                        }
                        last_cb = phuff::encode_dc_first(sink, 1, mcu.cb, al, last_cb);
                        last_cr = phuff::encode_dc_first(sink, 1, mcu.cr, al, last_cr);
                    }
                }
                _ => {
                    for mcu in mcus(&y, &cb, &cr) {
                        for block in mcu.y.into_iter().chain([mcu.cb, mcu.cr]) {
                            phuff::encode_dc_refine(sink, block, al);
                        }
                    }
                }
            };

            // Refining DC coefficients takes no table: it is a bit for each.
            let mut specs: [Option<HuffSpec>; 2] = [None, None];
            if !is_dc || scan.ah == 0 {
                let mut counts: [Counts; 2] = [[0; 257]; 2];
                run(&mut Sink::Count(&mut counts));
                for comp in scan.comps.iter().filter_map(|&ci| COMPONENTS.get(ci)) {
                    let table = usize::from(comp.table);
                    let (Some(spec), Some(counts)) = (specs.get_mut(table), counts.get(table))
                    else {
                        return Err(Error::Internal);
                    };
                    if spec.is_none() {
                        *spec = Some(huff::optimal_table(counts)?);
                    }
                }
            }

            if index == 0 {
                out.frame_header(self.width, self.height, true, &self.quant);
            }
            let mut tables = [EncodeTable::empty(), EncodeTable::empty()];
            for ((index, spec), table) in specs.iter().enumerate().zip(&mut tables) {
                if let Some(spec) = spec {
                    out.huff_table(index as u8, !is_dc, spec);
                    *table = EncodeTable::new(spec)?;
                }
            }
            out.scan_header(scan);
            let mut bits = BitWriter::new(out);
            run(&mut Sink::Write(&mut bits, &tables));
            bits.finish();
        }
        Ok(())
    }
}

/// Encodes `width * height` RGBA pixels, ignoring alpha.
pub fn encode(rgba: &[u8], width: u32, height: u32, options: &EncodeOptions) -> Result<Vec<u8>> {
    if width == 0 || height == 0 || !(1..=100).contains(&options.quality) {
        return Err(Error::InvalidArgument);
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(Error::ImageTooBig(MAX_DIMENSION));
    }
    let (w, h) = (width as usize, height as usize);
    let rgba = w
        .checked_mul(h)
        .and_then(|pixels| pixels.checked_mul(4))
        .and_then(|len| rgba.get(..len))
        .ok_or(Error::InvalidArgument)?;

    let mcus_per_row = w.div_ceil(MCU_SIZE);
    let quant = [
        scaled_quant_table(&tables::STD_LUMINANCE_QUANT, options.quality),
        scaled_quant_table(&tables::STD_CHROMINANCE_QUANT, options.quality),
    ];
    let [luma_quant, chroma_quant] = &quant;
    let mut encoder = Encoder {
        rgba,
        width: width as u16,
        height: height as u16,
        mcus_per_row,
        mcu_rows: h.div_ceil(MCU_SIZE),
        luma_extent: Extent {
            width_in_blocks: w.div_ceil(8),
            height_in_blocks: h.div_ceil(8),
        },
        chroma_extent: Extent {
            width_in_blocks: w.div_ceil(16),
            height_in_blocks: h.div_ceil(16),
        },
        luma_divisors: Divisors::new(luma_quant),
        chroma_divisors: Divisors::new(chroma_quant),
        quant,
        samples: McuRowSamples::new(mcus_per_row)?,
    };

    let mut out = Output::default();
    out.file_header();
    if let Some(profile) = options.icc_profile {
        out.icc_profile(profile)?;
    }
    if options.progressive {
        encoder.encode_progressive(&mut out)?;
    } else {
        encoder.encode_sequential(&mut out)?;
    }
    out.file_trailer();
    out.finish()
}
