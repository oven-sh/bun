//! The segments before and between scans (jdmarker.c).

use crate::block::{self, Block, Zigzag};
use crate::huffman::Spec;
use crate::input::Input;
use crate::marker::*;
use crate::{Error, Result};

pub(crate) const MAX_DIMENSION: u32 = 65500;
pub(crate) const MAX_COMPONENTS: usize = 4;

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
    pub(crate) h: u8,
    pub(crate) v: u8,
    pub(crate) quant_table: u8,
}

#[derive(Clone, Copy)]
pub(crate) struct Frame {
    pub(crate) process: Process,
    pub(crate) arithmetic: bool,
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

    pub(crate) fn max_sampling(&self) -> (usize, usize) {
        let max = |(h, v): (u8, u8), it: &Component| (h.max(it.h), v.max(it.v));
        let (h, v) = self.components().iter().fold((1, 1), max);
        (h.into(), v.into())
    }

    /// In a lossless file, each sample counts as a block.
    pub(crate) fn size_in_blocks(&self, component: Component) -> (usize, usize) {
        let unit = match self.process {
            Process::Lossless => 1,
            _ => 8,
        };
        let (max_h, max_v) = self.max_sampling();
        (
            (usize::from(self.width) * usize::from(component.h)).div_ceil(max_h * unit),
            (usize::from(self.height) * usize::from(component.v)).div_ceil(max_v * unit),
        )
    }

    /// Of a scan with more than one component.
    pub(crate) fn size_in_mcus(&self) -> (usize, usize) {
        self.size_in_blocks(Component {
            h: 1,
            v: 1,
            ..Default::default()
        })
    }

    /// With those that fill up the MCUs at the edges.
    pub(crate) fn block_count(&self) -> usize {
        let (mcus_wide, mcus_high) = self.size_in_mcus();
        let in_mcu = self.components().iter().map(|it| usize::from(it.h * it.v));
        mcus_wide * mcus_high * in_mcu.sum::<usize>()
    }

    /// With nothing to be relative to, the sampling factors of a single component say nothing about the image.
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
pub(crate) struct Scan {
    components: [ScanComponent; MAX_COMPONENTS],
    count: u8,
    /// `Ss`: the first coefficient in zigzag order, or the predictor of a lossless scan.
    pub(crate) first: u8,
    /// `Se`
    pub(crate) last: u8,
    /// `Ah`: what `shift` was in the scan that this one refines, or 0.
    pub(crate) previous_shift: u8,
    /// `Al`
    pub(crate) shift: u8,
}

impl Scan {
    pub(crate) fn components(&self) -> &[ScanComponent] {
        self.components.get(..self.count.into()).unwrap_or_default()
    }
}

pub(crate) struct Tables {
    pub(crate) quant: [Option<Block>; 4],
    pub(crate) dc: [Option<Spec>; 4],
    pub(crate) ac: [Option<Spec>; 4],
    /// For arithmetic coding: `U << 4 | L` of 16 DC tables, then `Kx` of 16 AC tables.
    pub(crate) conditioning: [u8; 32],
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
    frame: Option<Frame>,
    has_jfif: bool,
    adobe_transform: Option<u8>,
    icc: Vec<IccSegment<'a>>,
}

impl<'a> Segments<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Result<Self> {
        let mut input = Input::new(bytes);
        if input.word().to_be_bytes() != [0xFF, SOI] {
            return Err(Error::InvalidSignature);
        }
        Ok(Self {
            input,
            tables: Tables {
                quant: [None; 4],
                dc: [None; 4],
                ac: [None; 4],
                conditioning: core::array::from_fn(|i| if i < 16 { 0x10 } else { 5 }),
                restart_interval: 0,
            },
            frame: None,
            has_jfif: false,
            adobe_transform: None,
            icc: Vec::new(),
        })
    }

    /// Reads as far as the data of the next scan. There is none after EOI.
    pub(crate) fn next_scan(&mut self) -> Result<Option<(Frame, Scan)>> {
        loop {
            match self.input.next_marker() {
                SOF0 | SOF1 => self.read_frame(Process::Sequential, false)?,
                SOF2 => self.read_frame(Process::Progressive, false)?,
                SOF3 => self.read_frame(Process::Lossless, false)?,
                SOF9 => self.read_frame(Process::Sequential, true)?,
                SOF10 => self.read_frame(Process::Progressive, true)?,
                SOF11 => self.read_frame(Process::Lossless, true)?,
                SOS => return self.read_scan().map(Some),
                EOI => return Ok(None),
                DAC => self.read_conditioning()?,
                DHT => self.read_huffman_tables()?,
                DQT => self.read_quant_tables()?,
                DRI => {
                    if self.input.word() != 4 {
                        return Err(Error::InvalidLength);
                    }
                    self.tables.restart_interval = self.input.word();
                }
                marker @ (APP0..=APP15 | COM | DNL) => self.read_metadata(marker)?,
                RST0..=RST7 | TEM => {}
                SOI => return Err(Error::MarkerOutOfPlace),
                _ => return Err(Error::UnknownMarker),
            }
        }
    }

    /// The length of what follows the length.
    fn read_length(&mut self) -> Result<usize> {
        usize::from(self.input.word())
            .checked_sub(2)
            .ok_or(Error::InvalidLength)
    }

    fn read_frame(&mut self, process: Process, arithmetic: bool) -> Result<()> {
        if self.frame.is_some() {
            return Err(Error::MarkerOutOfPlace);
        }
        let length = self.read_length()?;
        let precision = self.input.byte();
        let height = self.input.word();
        let width = self.input.word();
        let count = self.input.byte();
        if length != 6 + 3 * usize::from(count) {
            return Err(Error::InvalidLength);
        }
        if ![width, height]
            .iter()
            .all(|&size| (1..=MAX_DIMENSION).contains(&size.into()))
        {
            return Err(Error::InvalidSize);
        }
        let valid_precision = match process {
            Process::Lossless => matches!(precision, 2..=16),
            _ => matches!(precision, 8 | 12),
        };
        if !valid_precision || !matches!(count, 1 | 3 | 4) {
            return Err(Error::InvalidFrame);
        }
        let mut components = [Component::default(); MAX_COMPONENTS];
        for component in components.iter_mut().take(count.into()) {
            let [id, sampling, quant_table] = core::array::from_fn(|_| self.input.byte());
            let (h, v) = (sampling >> 4, sampling & 15);
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
        self.frame = Some(Frame {
            process,
            arithmetic,
            precision,
            width,
            height,
            components,
            count,
        });
        Ok(())
    }

    fn read_scan(&mut self) -> Result<(Frame, Scan)> {
        let frame = self.frame.ok_or(Error::MarkerOutOfPlace)?;
        let length = self.read_length()?;
        let count = self.input.byte();
        if length != 4 + 2 * usize::from(count) || !matches!(count, 1..=4) {
            return Err(Error::InvalidLength);
        }
        let mut components = [ScanComponent::default(); MAX_COMPONENTS];
        let mut seen = 0u8;
        for (nth, component) in components.iter_mut().take(count.into()).enumerate() {
            let [id, tables] = self.input.word().to_be_bytes();
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
        let [first, last, shifts] = core::array::from_fn(|_| self.input.byte());
        let scan = Scan {
            components,
            count,
            first,
            last,
            previous_shift: shifts >> 4,
            shift: shifts & 15,
        };
        Ok((frame, scan))
    }

    fn read_conditioning(&mut self) -> Result<()> {
        let length = self.read_length()?;
        if !length.is_multiple_of(2) {
            return Err(Error::InvalidLength);
        }
        for _ in 0..length / 2 {
            let [index, value] = self.input.word().to_be_bytes();
            if index < 16 && value & 15 > value >> 4 {
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
                counts: core::array::from_fn(|_| self.input.byte()),
                symbols: [0; 256],
            };
            let count = spec.len();
            left = left.checked_sub(17 + count).ok_or(Error::InvalidLength)?;
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
            left = left
                .checked_sub(if is_wide { 129 } else { 65 })
                .ok_or(Error::InvalidLength)?;
            let table = self
                .tables
                .quant
                .get_mut(usize::from(index & 15))
                .ok_or(Error::InvalidTable)?
                .insert(block::ZERO);
            for k in 0..64 {
                *table.at_mut(k) = if is_wide {
                    self.input.word().cast_signed()
                } else {
                    self.input.byte().into()
                };
            }
        }
        Ok(())
    }

    fn read_metadata(&mut self, marker: u8) -> Result<()> {
        let length = self.read_length().unwrap_or(0);
        // No scan comes after a segment that is cut off.
        let Some(data) = self.input.take(length) else {
            return Ok(());
        };
        match (marker, data.split_first_chunk::<12>()) {
            (APP0, Some((start, [_, _, ..]))) if start.starts_with(&JFIF) => self.has_jfif = true,
            (APP14, Some((start @ &[.., transform], _))) if start.starts_with(&ADOBE) => {
                self.adobe_transform = Some(transform);
            }
            // One more than there can be is enough to tell that there are too many.
            (APP2, Some((&ICC_PROFILE, &[number, count, ref data @ ..])))
                if self.icc.len() <= u8::MAX.into() =>
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

    /// Going by the segments so far (`default_decompress_parms()`).
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

    /// Going by the segments so far. There is none unless they are numbered from 1 and agree on how many they are.
    pub(crate) fn icc_profile(&mut self) -> Result<Option<Vec<u8>>> {
        self.icc.sort_unstable_by_key(|segment| segment.number);
        let is_whole = self.icc.iter().zip(1..).all(|(segment, number)| {
            usize::from(segment.number) == number && usize::from(segment.count) == self.icc.len()
        });
        let len = self.icc.iter().map(|segment| segment.data.len()).sum();
        if !is_whole || len == 0 {
            return Ok(None);
        }
        let mut profile = Vec::new();
        profile.try_reserve_exact(len)?;
        for segment in &self.icc {
            profile.extend_from_slice(segment.data);
        }
        Ok(Some(profile))
    }
}
