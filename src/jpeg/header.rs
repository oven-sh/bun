//! The segments before and between scans (jdmarker.c).

use crate::block::{self, Block, Zigzag};
use crate::huffman::Spec;
use crate::input::Input;
use crate::marker::*;
use crate::{Error, MAX_COMPONENTS, Result};

const MAX_DIMENSION: u32 = 65500;
/// As many as `cjpeg -scans` can write. Chromium, Skia and libtiff stop at about as many.
const MAX_SCANS: u8 = 100;

pub(crate) fn check_size(width: u32, height: u32) -> Result<()> {
    if width.min(height) == 0 || width.max(height) > MAX_DIMENSION {
        return Err(Error::InvalidSize);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Process {
    Sequential,
    Progressive,
    Lossless,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ColorSpace {
    Gray,
    Rgb,
    Ycc,
    Cmyk,
    Ycck,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Component {
    id: u8,
    /// Sampling factors, from 1 to 4.
    pub(crate) h: usize,
    pub(crate) v: usize,
    pub(crate) quant_table: u8,
}

#[derive(Clone, Copy)]
pub(crate) struct Grid {
    pub(crate) wide: usize,
    pub(crate) high: usize,
}

#[derive(Clone, Copy)]
pub(crate) struct Frame {
    pub(crate) process: Process,
    pub(crate) is_arithmetic: bool,
    pub(crate) precision: u8,
    pub(crate) width: u16,
    pub(crate) height: u16,
    components: [Component; MAX_COMPONENTS],
    count: u8,
}

impl Frame {
    pub(crate) fn components(&self) -> &[Component] {
        self.components.get(..self.count.into()).unwrap_or_default()
    }

    pub(crate) fn max_h(&self) -> usize {
        self.components().iter().fold(1, |h, it| it.h.max(h))
    }

    pub(crate) fn max_v(&self) -> usize {
        self.components().iter().fold(1, |v, it| it.v.max(v))
    }

    /// How many samples wide and high a block is. In a lossless file, each sample counts as a block.
    pub(crate) fn block_size(&self) -> usize {
        match self.process {
            Process::Lossless => 1,
            _ => 8,
        }
    }

    /// In units of which an interleaved MCU has `h` by `v`.
    pub(crate) fn size_in_units(&self, h: usize, v: usize) -> Grid {
        let (width, height) = (usize::from(self.width), usize::from(self.height));
        Grid {
            wide: (width * h).div_ceil(self.max_h() * self.block_size()),
            high: (height * v).div_ceil(self.max_v() * self.block_size()),
        }
    }

    pub(crate) fn size_in_blocks(&self, component: Component) -> Grid {
        self.size_in_units(component.h, component.v)
    }

    pub(crate) fn size_in_mcus(&self) -> Grid {
        self.size_in_units(1, 1)
    }

    /// Makes a strip one row of blocks if there is one component. Only smoothing could tell.
    pub(crate) fn ignore_lone_sampling(&mut self) {
        if let (1, [component, ..]) = (self.count, &mut self.components) {
            (component.h, component.v) = (1, 1);
        }
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct ScanComponent {
    /// In [`Frame::components`].
    pub(crate) index: u8,
    pub(crate) dc_table: u8,
    pub(crate) ac_table: u8,
}

#[derive(Clone, Copy)]
pub(crate) enum ScanKind {
    /// A sequential or lossless scan.
    Whole,
    DcFirst,
    DcRefine,
    AcFirst,
    AcRefine,
}

#[derive(Clone, Copy)]
pub(crate) struct Scan {
    components: [ScanComponent; MAX_COMPONENTS],
    count: u8,
    pub(crate) kind: ScanKind,
    /// The first coefficient in zigzag order, or the predictor of a lossless scan.
    pub(crate) ss: u8,
    /// The last coefficient.
    pub(crate) se: u8,
    /// What `al` was in the scan that this one refines, or 0.
    pub(crate) ah: u8,
    /// How many low bits the scan leaves out.
    pub(crate) al: u8,
}

impl Scan {
    pub(crate) fn components(&self) -> &[ScanComponent] {
        self.components.get(..self.count.into()).unwrap_or_default()
    }
}

/// How many DC tables, and how many AC tables, arithmetic coding has.
pub(crate) const ARITHMETIC_TABLES: usize = 16;

pub(crate) struct Tables {
    pub(crate) quant: [Option<Block>; 4],
    pub(crate) dc: [Option<Spec>; 4],
    pub(crate) ac: [Option<Spec>; 4],
    /// For arithmetic coding: `U << 4 | L` of the DC tables, then `Kx` of the AC tables.
    pub(crate) conditioning: [u8; 2 * ARITHMETIC_TABLES],
    pub(crate) restart_interval: u16,
}

struct IccSegment<'a> {
    number: u8,
    count: u8,
    data: &'a [u8],
}

pub(crate) struct Segments<'a> {
    pub(crate) input: Input<'a>,
    pub(crate) tables: Tables,
    scans: u8,
    has_jfif: bool,
    adobe_transform: Option<u8>,
    icc: Vec<IccSegment<'a>>,
}

impl<'a> Segments<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Result<Self> {
        let mut input = Input::new(bytes);
        if input.array() != [0xFF, SOI] {
            return Err(Error::InvalidSignature);
        }
        Ok(Self {
            input,
            tables: Tables {
                quant: [None; 4],
                dc: [None; 4],
                ac: [None; 4],
                // L = 0, U = 1 and Kx = 5 (ITU-T T.81, F.1.4.4).
                conditioning: core::array::from_fn(
                    |i| if i < ARITHMETIC_TABLES { 0x10 } else { 5 },
                ),
                restart_interval: 0,
            },
            scans: 0,
            has_jfif: false,
            adobe_transform: None,
            icc: Vec::new(),
        })
    }

    /// Reads tables and metadata as far as the next SOF, SOS or EOI marker.
    fn next_header(&mut self) -> Result<u8> {
        loop {
            match self.input.next_marker() {
                marker @ (SOF0..=SOF3 | SOF9..=SOF11 | SOS | EOI) => return Ok(marker),
                DAC => self.read_conditioning()?,
                DHT => self.read_huffman_tables()?,
                DQT => self.read_quant_tables()?,
                DRI => {
                    if self.input.u16() != 4 {
                        return Err(Error::InvalidLength);
                    }
                    self.tables.restart_interval = self.input.u16();
                }
                marker @ (APP0..=APP15 | COM | DNL) => self.read_metadata(marker)?,
                RST0..=RST7 | TEM => {}
                SOI => return Err(Error::MarkerOutOfPlace),
                _ => return Err(Error::UnknownMarker),
            }
        }
    }

    /// The length of the segment after its length field.
    fn read_length(&mut self) -> Result<usize> {
        usize::from(self.input.u16())
            .checked_sub(2)
            .ok_or(Error::InvalidLength)
    }

    pub(crate) fn read_frame(&mut self) -> Result<Frame> {
        let marker = self.next_header()?;
        let process = match marker {
            SOS => return Err(Error::MarkerOutOfPlace),
            EOI => return Err(Error::MissingScan),
            SOF2 | SOF10 => Process::Progressive,
            SOF3 | SOF11 => Process::Lossless,
            _ => Process::Sequential,
        };
        let length = self.read_length()?;
        let precision = self.input.byte();
        let height = self.input.u16();
        let width = self.input.u16();
        let count = self.input.byte();
        if length != 6 + 3 * usize::from(count) {
            return Err(Error::InvalidLength);
        }
        check_size(width.into(), height.into())?;
        let valid_precision = match process {
            Process::Lossless => matches!(precision, 2..=16),
            _ => matches!(precision, 8 | 12),
        };
        if !valid_precision || !matches!(count, 1 | 3 | 4) {
            return Err(Error::InvalidFrame);
        }
        let mut components = [Component::default(); MAX_COMPONENTS];
        for component in components.iter_mut().take(count.into()) {
            let [id, sampling, quant_table] = self.input.array();
            let (h, v) = (usize::from(sampling >> 4), usize::from(sampling & 15));
            if !matches!((h, v), (1..=4, 1..=4)) {
                return Err(Error::InvalidFrame);
            }
            *component = Component {
                id,
                h,
                v,
                quant_table,
            };
        }
        Ok(Frame {
            process,
            is_arithmetic: marker >= SOF9,
            precision,
            width,
            height,
            components,
            count,
        })
    }

    /// Reads as far as the data of the next scan. There is none after EOI.
    pub(crate) fn next_scan(&mut self, frame: &Frame) -> Result<Option<Scan>> {
        match self.next_header()? {
            SOS if self.scans == MAX_SCANS => Err(Error::TooManyScans),
            SOS => {
                self.scans += 1;
                self.read_scan(frame).map(Some)
            }
            EOI => Ok(None),
            _ => Err(Error::MarkerOutOfPlace),
        }
    }

    fn read_scan(&mut self, frame: &Frame) -> Result<Scan> {
        let length = self.read_length()?;
        let count = self.input.byte();
        if length != 4 + 2 * usize::from(count) || !matches!(count, 1..=4) {
            return Err(Error::InvalidLength);
        }
        let mut components = [ScanComponent::default(); MAX_COMPONENTS];
        let mut seen = 0u8;
        for (nth, component) in components.iter_mut().take(count.into()).enumerate() {
            let [id, tables] = self.input.array();
            // Starting at `nth` tells components apart that have the same id.
            let (index, _) = (0..)
                .zip(frame.components())
                .skip(nth)
                .find(|(_, candidate)| candidate.id == id)
                .filter(|(index, _)| seen >> index & 1 == 0)
                .ok_or(Error::InvalidScan)?;
            seen |= 1 << index;
            *component = ScanComponent {
                index,
                dc_table: tables >> 4,
                ac_table: tables & 15,
            };
        }
        let [ss, se, ah_al] = self.input.array();
        let (ah, al) = (ah_al >> 4, ah_al & 15);
        Ok(Scan {
            components,
            count,
            kind: match (frame.process, ss, ah) {
                (Process::Progressive, 0, 0) => ScanKind::DcFirst,
                (Process::Progressive, 0, _) => ScanKind::DcRefine,
                (Process::Progressive, _, 0) => ScanKind::AcFirst,
                (Process::Progressive, ..) => ScanKind::AcRefine,
                _ => ScanKind::Whole,
            },
            ss,
            se,
            ah,
            al,
        })
    }

    fn read_conditioning(&mut self) -> Result<()> {
        let length = self.read_length()?;
        if !length.is_multiple_of(2) {
            return Err(Error::InvalidLength);
        }
        for _ in 0..length / 2 {
            let [index, value] = self.input.array();
            if usize::from(index) < ARITHMETIC_TABLES && value & 15 > value >> 4 {
                return Err(Error::InvalidTable);
            }
            *self
                .tables
                .conditioning
                .get_mut(usize::from(index))
                .ok_or(Error::InvalidTable)? = value;
        }
        Ok(())
    }

    fn read_huffman_tables(&mut self) -> Result<()> {
        let mut left = self.read_length()?;
        while left != 0 {
            let index = self.input.byte();
            let mut spec = Spec {
                counts: self.input.array(),
                symbols: [0; 256],
            };
            let count = spec.len();
            let len = 1 + spec.counts.len() + count;
            left = left.checked_sub(len).ok_or(Error::InvalidLength)?;
            spec.symbols
                .get_mut(..count)
                .ok_or(Error::InvalidTable)?
                .fill_with(|| self.input.byte());
            let class = match index >> 4 {
                0 => &mut self.tables.dc,
                1 => &mut self.tables.ac,
                _ => return Err(Error::InvalidTable),
            };
            *class
                .get_mut(usize::from(index & 15))
                .ok_or(Error::InvalidTable)? = Some(spec);
        }
        Ok(())
    }

    fn read_quant_tables(&mut self) -> Result<()> {
        let mut left = self.read_length()?;
        while left != 0 {
            let index = self.input.byte();
            let is_wide = index >> 4 != 0;
            let len = 1 + if is_wide { 2 * 64 } else { 64 };
            left = left.checked_sub(len).ok_or(Error::InvalidLength)?;
            let table = self
                .tables
                .quant
                .get_mut(usize::from(index & 15))
                .ok_or(Error::InvalidTable)?
                .insert(block::ZERO);
            for k in 0..64 {
                *table.at_mut(k) = if is_wide {
                    self.input.u16().cast_signed()
                } else {
                    self.input.byte().into()
                };
            }
        }
        Ok(())
    }

    fn read_metadata(&mut self, marker: u8) -> Result<()> {
        // A length below 2 skips nothing.
        let length = self.read_length().unwrap_or(0);
        // A truncated segment ends the file, so what it says does not matter.
        let Some(data) = self.input.take(length) else {
            return Ok(());
        };
        match marker {
            APP0 if data.len() >= 14 && data.starts_with(&JFIF) => self.has_jfif = true,
            APP14 if data.len() >= 12 && data.starts_with(&ADOBE) => {
                self.adobe_transform = data.get(11).copied();
            }
            // A 256th segment makes the profile invalid, whatever follows.
            APP2 if let Some(&[number, count, ref data @ ..]) = data.strip_prefix(&ICC_PROFILE)
                && self.icc.len() <= u8::MAX.into() =>
            {
                self.icc.try_reserve(1)?;
                self.icc.push(IccSegment {
                    number,
                    count,
                    data,
                });
            }
            _ => {}
        }
        Ok(())
    }

    /// By the segments read so far (`default_decompress_parms()`).
    pub(crate) fn color_space(&self, frame: &Frame) -> ColorSpace {
        match (frame.components(), self.adobe_transform) {
            ([_, _, _], _) if self.has_jfif => ColorSpace::Ycc,
            ([_, _, _], Some(0)) => ColorSpace::Rgb,
            ([_, _, _], Some(_)) => ColorSpace::Ycc,
            ([_, _, _], None) if frame.process == Process::Lossless => ColorSpace::Rgb,
            ([r, g, b], None) if [r.id, g.id, b.id] == *b"RGB" => ColorSpace::Rgb,
            ([_, _, _], None) => ColorSpace::Ycc,
            ([_, _, _, _], None | Some(0)) => ColorSpace::Cmyk,
            ([_, _, _, _], Some(_)) => ColorSpace::Ycck,
            _ => ColorSpace::Gray,
        }
    }

    /// None unless the segments read so far are numbered 1 to n and all say n.
    pub(crate) fn icc_profile(&self) -> Result<Option<Vec<u8>>> {
        let count = self.icc.len();
        let in_order = || {
            (1..=count).map(|number| {
                let mut segments = self.icc.iter();
                segments.find(|it| (it.number.into(), it.count.into()) == (number, count))
            })
        };
        if in_order().any(|segment| segment.is_none()) {
            return Ok(None);
        }
        let mut profile = Vec::new();
        profile.try_reserve_exact(self.icc.iter().map(|segment| segment.data.len()).sum())?;
        for segment in in_order().flatten() {
            profile.extend_from_slice(segment.data);
        }
        Ok((!profile.is_empty()).then_some(profile))
    }
}
