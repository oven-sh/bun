//! https://html.spec.whatwg.org/#preferred-density-corrected-dimensions

const ORIENTATION: u16 = 0x112;
const RESOLUTION: [u16; 2] = [0x11a, 0x11b];
const RESOLUTION_UNIT: u16 = 0x128;
const EXIF_DIRECTORY: u16 = 0x8769;
const PIXEL_DIMENSION: [u16; 2] = [0xa002, 0xa003];
const INCH: f64 = 2.0;

struct Tiff<'b> {
    bytes: &'b [u8],
    is_little_endian: bool,
}

impl Tiff<'_> {
    fn short(&self, at: usize) -> Option<u16> {
        let bytes = *self.bytes.get(at..)?.first_chunk()?;
        Some(if self.is_little_endian {
            u16::from_le_bytes(bytes)
        } else {
            u16::from_be_bytes(bytes)
        })
    }

    fn long(&self, at: usize) -> Option<u32> {
        let bytes = *self.bytes.get(at..)?.first_chunk()?;
        Some(if self.is_little_endian {
            u32::from_le_bytes(bytes)
        } else {
            u32::from_be_bytes(bytes)
        })
    }

    fn number(&self, directory: usize, tag: u16) -> Option<f64> {
        let entry = (0..usize::from(self.short(directory)?))
            .map(|it| directory + 2 + it * 12)
            .find(|it| self.short(*it) == Some(tag))?;
        let value = self.long(entry + 8)?;
        match self.short(entry + 2)? {
            3 => self.short(entry + 8).map(f64::from),
            4 => Some(value.into()),
            5 => Some(
                f64::from(self.long(value as usize)?) / f64::from(self.long(value as usize + 4)?),
            ),
            _ => None,
        }
    }
}

#[optimize(size)]
pub(super) fn corrected_size(jpeg: &[u8], size: [u32; 2], is_oriented: bool) -> Option<[f64; 2]> {
    let mut rest = jpeg.strip_prefix(b"\xff\xd8")?;
    let bytes = loop {
        let [0xff, marker @ 0xe0..=0xef, high, low, ref contents @ ..] = *rest else {
            return None;
        };
        match contents {
            [b'E', b'x', b'i', b'f', _, _, tiff @ ..] if marker == 0xe1 => break tiff,
            _ => rest = rest.get(2 + usize::from(u16::from_be_bytes([high, low]))..)?,
        }
    };
    let tiff = Tiff {
        bytes,
        is_little_endian: bytes.first() == Some(&b'I'),
    };
    let first = tiff.long(4)? as usize;
    let exif = tiff
        .number(first, EXIF_DIRECTORY)
        .filter(|_| tiff.number(first, RESOLUTION_UNIT) == Some(INCH))? as usize;
    let number = |tag| tiff.number(exif, tag).or_else(|| tiff.number(first, tag));
    let mut axes = [0, 1].map(|axis| number(PIXEL_DIMENSION[axis]).zip(number(RESOLUTION[axis])));
    if is_oriented && number(ORIENTATION).is_some_and(|it| it > 4.0) {
        axes.reverse();
    }
    let checked = |axis: usize| {
        axes[axis].filter(|(length, resolution)| {
            *length > 0.0 && f64::from(size[axis]) * 72.0 / resolution == *length
        })
    };
    Some([checked(0)?.0, checked(1)?.0])
}
