//! Everything in the file that is not entropy-coded (jcmarker.c, jcicc.c).

use super::huff::Output;
use super::{COMPONENTS, Scan};
use crate::error::{Error, Result};
use crate::markers::{M_APP0, M_APP2, M_DHT, M_DQT, M_EOI, M_SOF0, M_SOF2, M_SOI, M_SOS};
use crate::tables::{HuffSpec, NATURAL_ORDER};

impl Output {
    fn marker(&mut self, marker: u8) {
        self.extend(&[0xff, marker]);
    }

    /// A marker and the length of its segment, which counts the two bytes of the length.
    fn segment(&mut self, marker: u8, payload: usize) {
        self.marker(marker);
        self.extend(&((payload + 2) as u16).to_be_bytes());
    }

    pub(crate) fn file_header(&mut self) {
        self.marker(M_SOI);
        self.segment(M_APP0, 14);
        self.extend(b"JFIF\0");
        // Version 1.01, a pixel aspect ratio of 1:1 and no thumbnail.
        self.extend(&[1, 1, 0, 0, 1, 0, 1, 0, 0]);
    }

    pub(crate) fn icc_profile(&mut self, profile: &[u8]) -> Result<()> {
        const MAX_DATA_BYTES_IN_MARKER: usize = 65533 - 14;

        // libjpeg takes the length as an `unsigned int`.
        let profile = profile.get(..profile.len() as u32 as usize).unwrap_or(&[]);
        if profile.is_empty() {
            return Err(Error::InvalidArgument);
        }
        let chunks = profile.chunks(MAX_DATA_BYTES_IN_MARKER);
        // A profile that takes more than 255 segments is written all the same, with the numbers cut off.
        let count = chunks.len() as u8;
        for (i, chunk) in chunks.enumerate() {
            self.segment(M_APP2, chunk.len() + 14);
            self.extend(b"ICC_PROFILE\0");
            self.extend(&[(i + 1) as u8, count]);
            self.extend(chunk);
        }
        Ok(())
    }

    /// `quant` is in row-major order, each step from 1 to 255.
    fn quant_table(&mut self, index: u8, quant: &[u16; 64]) {
        self.segment(M_DQT, 1 + 64);
        self.extend(&[index]);
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
        quant: &[[u16; 64]; 2],
    ) {
        for (index, quant) in quant.iter().enumerate() {
            self.quant_table(index as u8, quant);
        }
        self.segment(
            if progressive { M_SOF2 } else { M_SOF0 },
            6 + 3 * COMPONENTS.len(),
        );
        self.extend(&[8]);
        self.extend(&height.to_be_bytes());
        self.extend(&width.to_be_bytes());
        self.extend(&[COMPONENTS.len() as u8]);
        for comp in &COMPONENTS {
            self.extend(&[comp.id, (comp.samp << 4) + comp.samp, comp.table]);
        }
    }

    pub(crate) fn huff_table(&mut self, index: u8, is_ac: bool, spec: &HuffSpec) {
        let [_, bits @ ..] = &spec.bits;
        let length: usize = bits.iter().map(|&count| usize::from(count)).sum();
        self.segment(M_DHT, 1 + 16 + length);
        self.extend(&[index + if is_ac { 0x10 } else { 0 }]);
        self.extend(bits);
        self.extend(spec.huffval.get(..length).unwrap_or(&[]));
    }

    pub(crate) fn scan_header(&mut self, scan: &Scan) {
        self.segment(M_SOS, 1 + 2 * scan.comps.len() + 3);
        self.extend(&[scan.comps.len() as u8]);
        for comp in scan.comps.iter().filter_map(|&ci| COMPONENTS.get(ci)) {
            // A table that the scan does not use is given as 0.
            let dc = if scan.ss == 0 && scan.ah == 0 {
                comp.table
            } else {
                0
            };
            let ac = if scan.se != 0 { comp.table } else { 0 };
            self.extend(&[comp.id, (dc << 4) + ac]);
        }
        self.extend(&[scan.ss, scan.se, (scan.ah << 4) + scan.al]);
    }

    pub(crate) fn file_trailer(&mut self) {
        self.marker(M_EOI);
    }
}
