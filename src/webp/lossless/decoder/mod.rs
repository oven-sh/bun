//! VP8L to pixels.

mod bit_reader;
mod groups;
mod huffman;
mod pixels;
mod transform;

use core::alloc::Allocator;
use core::ops::Range;
use std::alloc::Global;

use bun_alloc::Lender;

use self::bit_reader::BitReader;
use self::pixels::Coding;
pub(crate) use self::transform::MAX_BUNDLE_LEN;
use self::transform::{Lookup, Palette, Transform};
use super::{IMAGE_SIZE_BITS, SIGNATURE, TransformType, VERSION_BITS, subsampled};
use crate::error::{Error, Result};
use crate::slice::InBounds;
use crate::vec;

type Rgba = [u8; 4];
type Picture<'a> = Vec<Rgba, Lender<'a>>;

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

    pub(crate) fn decode(self, lender: Lender) -> Result<Picture> {
        Stream::read(self.reader, self.width.into(), self.height.into())?.decode(lender)
    }
}

/// The green channel of an image that has no header.
pub(crate) enum Green<'a> {
    Pixels(Picture<'a>),
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

pub(crate) fn decode_green<'a>(
    bytes: &[u8],
    width: usize,
    height: usize,
    lender: Lender<'a>,
) -> Result<Green<'a>> {
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
    stream.decode(lender).map(Green::Pixels)
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

    fn read_pixels<A: Allocator>(&mut self, allocator: A) -> Result<Vec<Rgba, A>> {
        self.coding
            .read_pixels(&mut self.reader, self.coded_width, self.height, allocator)
    }

    fn decode(mut self, lender: Lender) -> Result<Picture> {
        let transforms = core::mem::take(&mut self.transforms);
        let mut around = transforms.split_inclusive(|it| matches!(it, Transform::ColorIndexing(_)));
        let (first, later) = (around.next(), around.next().unwrap_or_default());
        if let Some([earlier @ .., Transform::ColorIndexing(palette)]) = first {
            let mut pixels = if later.is_empty() && self.coding.green_stands_alone() {
                let bundles = self.read_greens()?;
                self.look_up(palette, &bundles, |&bundle| bundle, lender)?
            } else if palette.bundle_bits > 0 {
                let mut bundles = self.read_pixels(Global)?;
                transform::undo(later, &mut bundles, self.coded_width);
                self.look_up(palette, &bundles, |&[_, bundle, ..]| bundle, lender)?
            } else {
                return self.decode_in_place(&transforms, lender);
            };
            transform::undo(earlier, &mut pixels, self.width);
            return Ok(pixels);
        }
        self.decode_in_place(&transforms, lender)
    }

    fn decode_in_place<'b>(
        mut self,
        transforms: &[Transform],
        lender: Lender<'b>,
    ) -> Result<Picture<'b>> {
        let mut pixels = self.read_pixels(lender)?;
        transform::undo(transforms, &mut pixels, self.width);
        Ok(pixels)
    }

    fn look_up<'b, T>(
        &self,
        palette: &Palette,
        coded: &[T],
        bundle: impl Fn(&T) -> u8,
        lender: Lender<'b>,
    ) -> Result<Picture<'b>> {
        let lookup = palette.lookup(self.width, |color| color)?;
        let mut pixels = vec::with_room_in(self.width * self.height, lender)?;
        let padded = self.coded_width << lookup.bundle_bits;
        if padded == self.width {
            lookup.append(coded, bundle, &mut pixels);
            return Ok(pixels);
        }
        for coded_row in coded.chunks_exact(self.coded_width.max(1)) {
            if padded <= pixels.capacity() - pixels.len() {
                let end = pixels.len() + self.width;
                lookup.append(coded_row, &bundle, &mut pixels);
                pixels.truncate(end);
            } else {
                let mut row = vec::with_room_in(padded, Lender::NONE)?;
                lookup.append(coded_row, &bundle, &mut row);
                pixels.extend_from_slice(row.part(..self.width));
            }
        }
        Ok(pixels)
    }
}
