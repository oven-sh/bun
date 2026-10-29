//! The file being written, and everything in it that is not entropy-coded (jcmarker.c, jcicc.c).

use super::{Component, PerTable, Scan, Table};
use crate::error::{Error, Result};
use crate::markers::{
    ICC_SIGNATURE, M_APP0, M_APP2, M_DHT, M_DQT, M_EOI, M_SOF0, M_SOF2, M_SOI, M_SOS,
};
use crate::tables::HuffSpec;
use crate::zigzag::NATURAL_ORDER;

/// What a Huffman table codes. The discriminant is Tc in a DHT segment.
#[derive(Clone, Copy)]
pub(crate) enum TableClass {
    Dc = 0,
    Ac = 1,
}

/// The file so far. Running out of memory is remembered instead of returned, to keep it out of the inner loops.
#[derive(Default)]
pub(crate) struct Output {
    bytes: Vec<u8>,
    out_of_memory: bool,
}

impl Output {
    #[inline(always)]
    pub(crate) fn extend(&mut self, bytes: &[u8]) {
        if self.bytes.try_reserve(bytes.len()).is_err() {
            self.give_up();
            return;
        }
        self.bytes.extend_from_slice(bytes);
    }

    #[cold]
    fn give_up(&mut self) {
        self.out_of_memory = true;
        self.bytes = Vec::new();
    }

    /// For the outer loops, which would otherwise go on for nothing.
    pub(crate) fn check(&self) -> Result<()> {
        if self.out_of_memory {
            return Err(bun_alloc::AllocError.into());
        }
        Ok(())
    }

    pub(crate) fn finish(self) -> Result<Vec<u8>> {
        self.check()?;
        Ok(self.bytes)
    }

    fn marker(&mut self, marker: u8) {
        self.extend(&[0xff, marker]);
    }

    /// A marker and the length of its segment, which counts the two bytes of the length.
    fn segment(&mut self, marker: u8, payload: usize) {
        self.marker(marker);
        self.extend(&((payload + 2) as u16).to_be_bytes());
    }

    pub(crate) fn file_header(&mut self) {
        // Version 1.01, a pixel aspect ratio of 1:1 and no thumbnail.
        const JFIF: &[u8] = b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0";
        self.marker(M_SOI);
        self.segment(M_APP0, JFIF.len());
        self.extend(JFIF);
    }

    pub(crate) fn icc_profile(&mut self, profile: &[u8]) -> Result<()> {
        const OVERHEAD: usize = ICC_SIGNATURE.len() + 2;
        // The length of a segment has 16 bits and counts itself.
        const MAX_DATA_BYTES_IN_MARKER: usize = u16::MAX as usize - 2 - OVERHEAD;

        // libjpeg takes the length as an `unsigned int`.
        let profile = profile.get(..profile.len() as u32 as usize).unwrap_or(&[]);
        if profile.is_empty() {
            return Err(Error::InvalidArgument);
        }
        let chunks = profile.chunks(MAX_DATA_BYTES_IN_MARKER);
        // A profile that takes more than 255 segments is written all the same, with the numbers cut off.
        let count = chunks.len() as u8;
        for (i, chunk) in chunks.enumerate() {
            self.segment(M_APP2, chunk.len() + OVERHEAD);
            self.extend(ICC_SIGNATURE);
            self.extend(&[(i + 1) as u8, count]);
            self.extend(chunk);
        }
        Ok(())
    }

    /// `quant` is in row-major order, each step from 1 to 255.
    fn quant_table(&mut self, table: Table, quant: &[u16; 64]) {
        self.segment(M_DQT, 1 + quant.len());
        self.extend(&[table as u8]);
        let mut zigzag = [0u8; 64];
        for (out, &position) in zigzag.iter_mut().zip(&NATURAL_ORDER) {
            *out = quant.get(usize::from(position)).copied().unwrap_or(0) as u8;
        }
        self.extend(&zigzag);
    }

    pub(crate) fn frame_header(
        &mut self,
        width: u16,
        height: u16,
        progressive: bool,
        quant: &PerTable<[u16; 64]>,
    ) {
        self.quant_table(Table::Luma, &quant.luma);
        self.quant_table(Table::Chroma, &quant.chroma);
        self.segment(
            if progressive { M_SOF2 } else { M_SOF0 },
            6 + 3 * Component::ALL.len(),
        );
        // Bits in a sample.
        self.extend(&[8]);
        self.extend(&height.to_be_bytes());
        self.extend(&width.to_be_bytes());
        self.extend(&[Component::ALL.len() as u8]);
        for component in Component::ALL {
            let sampling = component.sampling();
            self.extend(&[
                component.id(),
                (sampling << 4) + sampling,
                component.table() as u8,
            ]);
        }
    }

    pub(crate) fn huff_table(&mut self, table: Table, class: TableClass, spec: &HuffSpec) {
        let [_, bits @ ..] = &spec.bits;
        let length: usize = bits.iter().map(|&count| usize::from(count)).sum();
        self.segment(M_DHT, 1 + bits.len() + length);
        self.extend(&[((class as u8) << 4) + table as u8]);
        self.extend(bits);
        self.extend(spec.huffval.get(..length).unwrap_or(&[]));
    }

    pub(crate) fn scan_header(&mut self, scan: &Scan) {
        self.segment(M_SOS, 1 + 2 * scan.components.len() + 3);
        self.extend(&[scan.components.len() as u8]);
        for component in scan.components {
            // A table that the scan does not use is given as 0.
            let table = component.table() as u8;
            let dc = if scan.ss == 0 && scan.ah == 0 {
                table
            } else {
                0
            };
            let ac = if scan.se != 0 { table } else { 0 };
            self.extend(&[component.id(), (dc << 4) + ac]);
        }
        self.extend(&[scan.ss, scan.se, (scan.ah << 4) + scan.al]);
    }

    pub(crate) fn file_trailer(&mut self) {
        self.marker(M_EOI);
    }
}
