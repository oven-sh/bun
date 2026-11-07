//! `tj3Compress8` of RGBA pixels with 4:2:0 and otherwise defaults (turbojpeg.c, jcparam.c, jcmaster.c, jccoefct.c).

mod fdct;
mod huff;
mod marker;
mod phuff;
mod sample;

use crate::alloc::try_vec;
use crate::error::{Error, Result};
use crate::markers::{M_SOF0, M_SOF2};
use crate::tables::{self, HuffSpec, MAX_DIMENSION};
use crate::zigzag::natural_order;
use fdct::Divisors;
use huff::{BitWriter, EncodeTable, SequentialTable};
use marker::{Output, TableClass};
use phuff::{AcEncoder, Sink};
use sample::{MCU_SIZE, McuRowSamples};

/// The side of a block.
const DCTSIZE: usize = 8;

/// The quantized coefficients of a block.
#[derive(Clone, Copy)]
struct Block {
    coefs: [[i16; 8]; 8],
    /// Bit `k` is set if the `k`th coefficient in zigzag order is not zero. Most are zero, and nothing looks at those.
    nonzero: u64,
}

impl Block {
    /// A block with nothing but a DC coefficient.
    const fn flat(dc: i16) -> Self {
        let mut coefs = [[0; 8]; 8];
        let [[first, ..], ..] = &mut coefs;
        *first = dc;
        Block {
            coefs,
            nonzero: (dc != 0) as u64,
        }
    }

    #[inline(always)]
    fn dc(&self) -> i16 {
        let [[dc, ..], ..] = self.coefs;
        dc
    }

    /// The `k`th coefficient in zigzag order.
    #[inline(always)]
    fn coef_at(&self, k: u32) -> i16 {
        self.coefs
            .as_flattened()
            .get(natural_order(k as usize))
            .copied()
            .unwrap_or(0)
    }

    /// `nonzero` for the coefficients from `first` to `last`.
    #[inline(always)]
    fn nonzero_between(&self, first: u32, last: u32) -> u64 {
        self.nonzero & (u64::MAX << first) & (u64::MAX >> (63 - last))
    }
}

#[derive(Clone, Copy)]
enum Component {
    Y,
    Cb,
    Cr,
}

impl Component {
    const ALL: [Component; 3] = [Component::Y, Component::Cb, Component::Cr];

    fn id(self) -> u8 {
        self as u8 + 1
    }

    /// The sampling factor, horizontal and vertical.
    fn sampling(self) -> u8 {
        match self {
            Component::Y => 2,
            Component::Cb | Component::Cr => 1,
        }
    }

    /// Its quantization table and its Huffman tables.
    fn table(self) -> Table {
        match self {
            Component::Y => Table::Luma,
            Component::Cb | Component::Cr => Table::Chroma,
        }
    }
}

/// The discriminant is the number of the table in the file.
#[derive(Clone, Copy)]
enum Table {
    Luma = 0,
    Chroma = 1,
}

#[derive(Default)]
struct PerTable<T> {
    luma: T,
    chroma: T,
}

impl<T> PerTable<T> {
    #[inline(always)]
    fn get(&self, table: Table) -> &T {
        match table {
            Table::Luma => &self.luma,
            Table::Chroma => &self.chroma,
        }
    }

    #[inline(always)]
    fn get_mut(&mut self, table: Table) -> &mut T {
        match table {
            Table::Luma => &mut self.luma,
            Table::Chroma => &mut self.chroma,
        }
    }
}

struct Scan {
    components: &'static [Component],
    /// The first and the last coefficient, in zigzag order.
    ss: u8,
    se: u8,
    /// The bit position that the scan before this one of the same coefficients stopped at, or 0 if this is the first.
    ah: u8,
    /// The bit position that this scan stops at.
    al: u8,
}

const fn scan(components: &'static [Component], ss: u8, se: u8, ah: u8, al: u8) -> Scan {
    Scan {
        components,
        ss,
        se,
        ah,
        al,
    }
}

const SEQUENTIAL_SCAN: Scan = scan(&Component::ALL, 0, 63, 0, 0);

/// `jpeg_simple_progression` for YCbCr.
const PROGRESSIVE_SCANS: [Scan; 10] = [
    scan(&Component::ALL, 0, 0, 0, 1),
    // Enough of luma for a first picture.
    scan(&[Component::Y], 1, 5, 0, 2),
    // Chroma is small enough to come all at once.
    scan(&[Component::Cr], 1, 63, 0, 1),
    scan(&[Component::Cb], 1, 63, 0, 1),
    scan(&[Component::Y], 6, 63, 0, 2),
    scan(&[Component::Y], 1, 63, 2, 1),
    scan(&Component::ALL, 0, 0, 1, 0),
    scan(&[Component::Cr], 1, 63, 1, 0),
    scan(&[Component::Cb], 1, 63, 1, 0),
    // The lowest bit of luma is most of the file.
    scan(&[Component::Y], 1, 63, 1, 0),
];

pub struct EncodeOptions<'a> {
    /// From 1 to 100.
    pub quality: u8,
    /// Ten scans from coarse to fine with tables made for them, instead of one with the tables of the standard.
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
    /// Rows of blocks in a row of MCUs.
    sampling: usize,
}

impl BlockRows {
    fn new(component: Component, mcus_per_row: usize, mcu_rows: usize) -> Result<Self> {
        let sampling = usize::from(component.sampling());
        let blocks_per_row = mcus_per_row * sampling;
        Ok(BlockRows {
            blocks: try_vec(Block::flat(0), blocks_per_row * mcu_rows * sampling)?,
            blocks_per_row,
            sampling,
        })
    }

    fn rows(&self) -> impl Iterator<Item = &[Block]> {
        self.blocks.chunks_exact(self.blocks_per_row)
    }

    fn mcu_rows(&self) -> impl Iterator<Item = &[Block]> {
        self.blocks
            .chunks_exact(self.blocks_per_row * self.sampling)
    }

    fn mcu_rows_mut(&mut self) -> impl Iterator<Item = &mut [Block]> {
        self.blocks
            .chunks_exact_mut(self.blocks_per_row * self.sampling)
    }
}

/// How much of a component is image. The rest is there to fill up the MCUs.
#[derive(Clone, Copy)]
struct Extent {
    width_in_blocks: usize,
    height_in_blocks: usize,
}

/// Transforms the `samp` rows of blocks that row `mcu_row` of MCUs holds of one component.
fn transform_rows(
    samples: &[u8],
    divisors: &Divisors,
    extent: Extent,
    samp: usize,
    mcu_row: usize,
    out: &mut [Block],
) -> Result<()> {
    let blocks_per_row = out.len() / samp;
    let mut above: Option<&[Block]> = None;
    for ((row, samples), out) in (mcu_row * samp..)
        .zip(samples.chunks_exact(blocks_per_row * DCTSIZE * DCTSIZE))
        .zip(out.chunks_exact_mut(blocks_per_row))
    {
        if row < extent.height_in_blocks {
            let (eights, _) = samples.as_chunks::<8>();
            let (image, dummy) = out
                .split_at_mut_checked(extent.width_in_blocks)
                .ok_or(Error::Internal)?;
            for (x, block) in image.iter_mut().enumerate() {
                let mut samples = [[0; 8]; 8];
                for (row, line) in samples.iter_mut().zip(eights.chunks_exact(blocks_per_row)) {
                    *row = *line.get(x).ok_or(Error::Internal)?;
                }
                *block = fdct::forward(&samples, divisors);
            }
            // A block outside of the image has the DC coefficient of the one before it in its MCU: the fewest bits.
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
    y.mcu_rows()
        .zip(cb.mcu_rows())
        .zip(cr.mcu_rows())
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
    quant: PerTable<[u16; 64]>,
    divisors: PerTable<Divisors>,
    samples: McuRowSamples,
}

impl Encoder<'_> {
    fn extent(&self, component: Component) -> Extent {
        let pixels_per_block = MCU_SIZE / usize::from(component.sampling());
        Extent {
            width_in_blocks: usize::from(self.width).div_ceil(pixels_per_block),
            height_in_blocks: usize::from(self.height).div_ceil(pixels_per_block),
        }
    }

    /// Fills in rows of MCUs from `first_mcu_row` on.
    fn transform(
        &mut self,
        first_mcu_row: usize,
        y: &mut BlockRows,
        cb: &mut BlockRows,
        cr: &mut BlockRows,
    ) -> Result<()> {
        let width = usize::from(self.width);
        let mcu_rows = y
            .mcu_rows_mut()
            .zip(cb.mcu_rows_mut())
            .zip(cr.mcu_rows_mut());
        for (mcu_row, ((y, cb), cr)) in (first_mcu_row..).zip(mcu_rows) {
            let rows = self
                .rgba
                .get(mcu_row * MCU_SIZE * width * 4..)
                .ok_or(Error::Internal)?;
            self.samples.fill(rows, width)?;
            let samples = &self.samples;
            for (component, samples, out) in [
                (Component::Y, &samples.y, y),
                (Component::Cb, &samples.cb, cb),
                (Component::Cr, &samples.cr, cr),
            ] {
                let divisors = self.divisors.get(component.table());
                let (extent, samp) = (self.extent(component), component.sampling());
                transform_rows(samples, divisors, extent, usize::from(samp), mcu_row, out)?;
            }
        }
        Ok(())
    }

    fn encode_sequential(&mut self, out: &mut Output) -> Result<()> {
        out.frame_header(M_SOF0, self.width, self.height, &self.quant);
        out.huff_table(Table::Luma, TableClass::Dc, &tables::STD_DC_LUMINANCE);
        out.huff_table(Table::Luma, TableClass::Ac, &tables::STD_AC_LUMINANCE);
        out.huff_table(Table::Chroma, TableClass::Dc, &tables::STD_DC_CHROMINANCE);
        out.huff_table(Table::Chroma, TableClass::Ac, &tables::STD_AC_CHROMINANCE);
        out.scan_header(&SEQUENTIAL_SCAN);

        let luma_dc = SequentialTable::new(&tables::STD_DC_LUMINANCE);
        let luma_ac = SequentialTable::new(&tables::STD_AC_LUMINANCE);
        let chroma_dc = SequentialTable::new(&tables::STD_DC_CHROMINANCE);
        let chroma_ac = SequentialTable::new(&tables::STD_AC_CHROMINANCE);

        let mut y = BlockRows::new(Component::Y, self.mcus_per_row, 1)?;
        let mut cb = BlockRows::new(Component::Cb, self.mcus_per_row, 1)?;
        let mut cr = BlockRows::new(Component::Cr, self.mcus_per_row, 1)?;
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
            bits.check()?;
        }
        bits.finish()
    }

    fn encode_progressive(&mut self, out: &mut Output) -> Result<()> {
        let mut y = BlockRows::new(Component::Y, self.mcus_per_row, self.mcu_rows)?;
        let mut cb = BlockRows::new(Component::Cb, self.mcus_per_row, self.mcu_rows)?;
        let mut cr = BlockRows::new(Component::Cr, self.mcus_per_row, self.mcu_rows)?;
        self.transform(0, &mut y, &mut cb, &mut cr)?;

        out.frame_header(M_SOF2, self.width, self.height, &self.quant);
        for scan in &PROGRESSIVE_SCANS {
            let al = u32::from(scan.al);
            let class = if scan.ss == 0 {
                TableClass::Dc
            } else {
                TableClass::Ac
            };
            let run = |sink: &mut Sink| -> Result<()> {
                match *scan.components {
                    // Only a scan of one component leaves out the blocks that are not image.
                    [component] => {
                        let blocks = match component {
                            Component::Y => &y,
                            Component::Cb => &cb,
                            Component::Cr => &cr,
                        };
                        let extent = self.extent(component);
                        let mut encoder = AcEncoder::new(component.table(), scan)?;
                        for row in blocks.rows().take(extent.height_in_blocks) {
                            for block in row.iter().take(extent.width_in_blocks) {
                                if scan.ah == 0 {
                                    encoder.encode_first(sink, block);
                                } else {
                                    encoder.encode_refine(sink, block);
                                }
                            }
                            sink.check()?;
                        }
                        encoder.finish(sink);
                    }
                    _ if scan.ah == 0 => {
                        let [mut last_y, mut last_cb, mut last_cr] = [0i32; 3];
                        for mcu in mcus(&y, &cb, &cr) {
                            for block in mcu.y {
                                last_y =
                                    phuff::encode_dc_first(sink, Table::Luma, block, al, last_y);
                            }
                            last_cb =
                                phuff::encode_dc_first(sink, Table::Chroma, mcu.cb, al, last_cb);
                            last_cr =
                                phuff::encode_dc_first(sink, Table::Chroma, mcu.cr, al, last_cr);
                        }
                    }
                    _ => {
                        for mcu in mcus(&y, &cb, &cr) {
                            for block in mcu.y.into_iter().chain([mcu.cb, mcu.cr]) {
                                phuff::encode_dc_refine(sink, block, al);
                            }
                        }
                    }
                }
                Ok(())
            };

            // Refining DC coefficients takes no table: it is a bit for each.
            let mut specs: PerTable<Option<HuffSpec>> = PerTable::default();
            if matches!(class, TableClass::Ac) || scan.ah == 0 {
                let mut counts = PerTable {
                    luma: [0; 256],
                    chroma: [0; 256],
                };
                run(&mut Sink::Count(&mut counts))?;
                for component in scan.components {
                    let table = component.table();
                    let spec = specs.get_mut(table);
                    if spec.is_none() {
                        *spec = Some(huff::optimal_table(counts.get(table))?);
                    }
                }
            }

            let mut tables = PerTable {
                luma: EncodeTable::empty(),
                chroma: EncodeTable::empty(),
            };
            for table in [Table::Luma, Table::Chroma] {
                if let Some(spec) = specs.get(table) {
                    out.huff_table(table, class, spec);
                    *tables.get_mut(table) = EncodeTable::new(spec);
                }
            }
            out.scan_header(scan);
            let mut bits = BitWriter::new(out);
            run(&mut Sink::Write(&mut bits, &tables))?;
            bits.finish()?;
        }
        Ok(())
    }
}

/// Encodes `width * height` RGBA pixels, ignoring alpha, as YCbCr 4:2:0.
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
    let quant = PerTable {
        luma: scaled_quant_table(&tables::STD_LUMINANCE_QUANT, options.quality),
        chroma: scaled_quant_table(&tables::STD_CHROMINANCE_QUANT, options.quality),
    };
    let mut encoder = Encoder {
        rgba,
        width: width as u16,
        height: height as u16,
        mcus_per_row,
        mcu_rows: h.div_ceil(MCU_SIZE),
        divisors: PerTable {
            luma: Divisors::new(&quant.luma),
            chroma: Divisors::new(&quant.chroma),
        },
        quant,
        samples: McuRowSamples::new(mcus_per_row)?,
    };

    let mut out = Output::default();
    out.file_header();
    if let Some(profile) = options.icc_profile {
        out.icc_profile(profile)?;
    }
    out.check()?;
    if options.progressive {
        encoder.encode_progressive(&mut out)?;
    } else {
        encoder.encode_sequential(&mut out)?;
    }
    out.file_trailer();
    out.finish()
}
