//! VP8L to pixels.

mod bit_reader;
mod groups;
mod huffman;
mod pixels;
mod transform;

use core::ops::Range;

use self::bit_reader::BitReader;
use self::pixels::Coding;
pub(crate) use self::transform::MAX_BUNDLE_LEN;
use self::transform::{Lookup, Palette, Transform};
use super::{IMAGE_SIZE_BITS, SIGNATURE, TransformType, VERSION_BITS, subsampled};
use crate::error::{Error, Result};
use crate::slice::InBounds;
use crate::vec;

type Rgba = [u8; 4];

pub(crate) struct Header<'a> {
    pub(crate) width: u16,
    pub(crate) height: u16,
    /// Behind the header.
    reader: BitReader<'a>,
}

impl<'a> Header<'a> {
    pub(crate) fn parse(bytes: &'a [u8]) -> Result<Self> {
        let mut reader = BitReader::new(bytes);
        let signature = reader.read(8);
        let width = reader.read(IMAGE_SIZE_BITS) as u16 + 1;
        let height = reader.read(IMAGE_SIZE_BITS) as u16 + 1;
        let _has_alpha = reader.read_flag();
        let version = reader.read(VERSION_BITS);
        if bytes.len() < 5 {
            return Err(Error::UnexpectedEof);
        }
        if signature != SIGNATURE.into() || version != 0 {
            return Err(Error::InvalidLosslessBitstream);
        }
        Ok(Self {
            width,
            height,
            reader,
        })
    }

    pub(crate) fn decode(self) -> Result<Vec<Rgba>> {
        Stream::read(self.reader, self.width.into(), self.height.into())?.decode()
    }
}

/// The green channel of an image that has no header.
pub(crate) enum Green {
    Pixels(Vec<Rgba>),
    Indexed(IndexedGreen),
}

pub(crate) struct IndexedGreen {
    bundles: Vec<u8>,
    bundles_per_row: usize,
    lookup: Lookup<u8>,
}

impl IndexedGreen {
    /// With fewer than `MAX_BUNDLE_LEN` more behind each, unless it has one pixel. `to` has room for them.
    pub(crate) fn append_rows(&self, rows: Range<usize>, to: &mut Vec<u8>) {
        let per_row = self.bundles_per_row;
        let bundles = self.bundles.part(rows.start * per_row..rows.end * per_row);
        self.lookup.append(bundles, |&bundle| bundle, to);
    }
}

pub(crate) fn decode_green(bytes: &[u8], width: usize, height: usize) -> Result<Green> {
    let mut stream = Stream::read(BitReader::new(bytes), width, height)?;
    if let [Transform::ColorIndexing(palette)] = stream.transforms.as_slice()
        && stream.coding.green_stands_alone()
    {
        let lookup = palette.lookup(width, |[_, green, ..]| green)?;
        return Ok(Green::Indexed(IndexedGreen {
            bundles: stream.read_greens()?,
            bundles_per_row: stream.coded_width,
            lookup,
        }));
    }
    stream.decode().map(Green::Pixels)
}

/// An image of which all but the pixels has been read.
struct Stream<'a> {
    reader: BitReader<'a>,
    width: usize,
    height: usize,
    /// In the order they were applied.
    transforms: Vec<Transform>,
    /// Less than `width` if a palette bundles its indices.
    coded_width: usize,
    coding: Coding,
}

impl<'a> Stream<'a> {
    fn read(mut reader: BitReader<'a>, width: usize, height: usize) -> Result<Self> {
        let mut transforms = vec::with_room(4)?;
        let mut coded_width = width;
        let mut unseen = [
            TransformType::Predictor,
            TransformType::CrossColor,
            TransformType::SubtractGreen,
            TransformType::ColorIndexing,
        ]
        .map(Some);
        while reader.read_flag() {
            let transform_type = unseen
                .get_mut(reader.read(2) as usize)
                .and_then(Option::take)
                .ok_or(Error::InvalidLosslessBitstream)?;
            let transform = Transform::read(&mut reader, transform_type, coded_width, height)?;
            if let Transform::ColorIndexing(palette) = &transform {
                coded_width = subsampled(width, palette.bundle_bits);
            }
            transforms.push(transform);
        }
        let coding = Coding::read(&mut reader, coded_width, height)?;
        Ok(Self {
            reader,
            width,
            height,
            transforms,
            coded_width,
            coding,
        })
    }

    fn read_greens(&mut self) -> Result<Vec<u8>> {
        self.coding
            .read_greens(&mut self.reader, self.coded_width, self.height)
    }

    fn read_pixels(&mut self) -> Result<Vec<Rgba>> {
        self.coding
            .read_pixels(&mut self.reader, self.coded_width, self.height)
    }

    fn decode(mut self) -> Result<Vec<Rgba>> {
        let transforms = core::mem::take(&mut self.transforms);
        let mut around = transforms.split_inclusive(|it| matches!(it, Transform::ColorIndexing(_)));
        let (first, later) = (around.next(), around.next().unwrap_or_default());
        if let Some([earlier @ .., Transform::ColorIndexing(palette)]) = first {
            let mut pixels = if later.is_empty() && self.coding.green_stands_alone() {
                let bundles = self.read_greens()?;
                self.look_up(palette, &bundles, |&bundle| bundle)?
            } else if palette.bundle_bits > 0 {
                let mut bundles = self.read_pixels()?;
                transform::undo(later, &mut bundles, self.coded_width);
                self.look_up(palette, &bundles, |&[_, bundle, ..]| bundle)?
            } else {
                return self.decode_in_place(&transforms);
            };
            transform::undo(earlier, &mut pixels, self.width);
            return Ok(pixels);
        }
        self.decode_in_place(&transforms)
    }

    fn decode_in_place(mut self, transforms: &[Transform]) -> Result<Vec<Rgba>> {
        let mut pixels = self.read_pixels()?;
        transform::undo(transforms, &mut pixels, self.width);
        Ok(pixels)
    }

    fn look_up<T>(
        &self,
        palette: &Palette,
        coded: &[T],
        bundle: impl Fn(&T) -> u8,
    ) -> Result<Vec<Rgba>> {
        let lookup = palette.lookup(self.width, |color| color)?;
        let mut pixels = vec::with_room(self.width * self.height + MAX_BUNDLE_LEN)?;
        if self.coded_width << lookup.bundle_bits == self.width {
            lookup.append(coded, bundle, &mut pixels);
            return Ok(pixels);
        }
        for coded_row in coded.chunks_exact(self.coded_width.max(1)) {
            let end = pixels.len() + self.width;
            lookup.append(coded_row, &bundle, &mut pixels);
            pixels.truncate(end);
        }
        Ok(pixels)
    }
}
