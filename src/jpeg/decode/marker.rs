//! Marker segments (jdmarker.c) and the ICC profile they carry (jdicc.c).

use super::{
    Component, Decoder, MAX_COMPONENTS_IN_SCAN, NUM_ARITH_TABLES, NUM_HUFF_TABLES, NUM_QUANT_TABLES,
};
use crate::error::{Error, Result, try_vec_with_capacity};
use crate::markers::*;
use crate::tables::{HuffSpec, NATURAL_ORDER};
use std::borrow::Cow;

/// How much of an APP0 or APP14 segment is looked at.
const APPN_DATA_LEN: usize = 14;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reached {
    Sos,
    Eoi,
}

impl Decoder<'_> {
    /// Reads markers up to and including the next SOS or EOI.
    pub(crate) fn read_markers(&mut self) -> Result<Reached> {
        loop {
            if self.input.unread_marker == 0 {
                if !self.saw_soi {
                    // No garbage is allowed before SOI, or a file that is not a JPEG would be scanned to its end.
                    let c = self.input.byte();
                    let c2 = self.input.byte();
                    if c != 0xff || c2 != M_SOI {
                        return Err(Error::NoSoi(c, c2));
                    }
                    self.input.unread_marker = c2;
                } else {
                    self.input.next_marker();
                }
            }
            let marker = self.input.unread_marker;
            match marker {
                M_SOI => self.read_soi()?,
                M_SOF0 | M_SOF1 | M_SOF2 | M_SOF3 | M_SOF9 | M_SOF10 | M_SOF11 => {
                    self.read_sof(marker)?;
                }
                M_SOF5 | M_SOF6 | M_SOF7 | M_JPG | M_SOF13 | M_SOF14 | M_SOF15 => {
                    return Err(Error::SofUnsupported(marker));
                }
                M_SOS => {
                    self.read_sos()?;
                    self.input.unread_marker = 0;
                    return Ok(Reached::Sos);
                }
                M_EOI => {
                    self.input.unread_marker = 0;
                    return Ok(Reached::Eoi);
                }
                M_DAC => self.read_dac()?,
                M_DHT => self.read_dht()?,
                M_DQT => self.read_dqt()?,
                M_DRI => self.read_dri()?,
                M_APP0 | M_APP14 => self.read_app0_or_app14(marker),
                M_APP2 if self.in_header => self.save_app2()?,
                M_APP0..=M_APP15 | M_COM | M_DNL => self.skip_segment(),
                M_RST0..=M_RST7 | M_TEM => {}
                _ => return Err(Error::UnknownMarker(marker)),
            }
            self.input.unread_marker = 0;
        }
    }

    fn read_soi(&mut self) -> Result<()> {
        if self.saw_soi {
            return Err(Error::SoiDuplicate);
        }
        self.saw_soi = true;
        Ok(())
    }

    fn read_sof(&mut self, marker: u8) -> Result<()> {
        if self.saw_sof {
            return Err(Error::SofDuplicate);
        }
        self.progressive = matches!(marker, M_SOF2 | M_SOF10);
        self.lossless = matches!(marker, M_SOF3 | M_SOF11);
        self.arith_code = matches!(marker, M_SOF9 | M_SOF10 | M_SOF11);

        let length = i32::from(self.input.u16());
        self.precision = self.input.byte();
        self.height = u32::from(self.input.u16());
        self.width = u32::from(self.input.u16());
        let num_components = self.input.byte();

        // A height of 0 that a DNL marker sets later is not supported.
        if self.height == 0 || self.width == 0 || num_components == 0 {
            return Err(Error::EmptyImage);
        }
        if length - 8 != i32::from(num_components) * 3 {
            return Err(Error::BadLength);
        }

        self.components.clear();
        for _ in 0..num_components {
            let id = self.input.byte();
            let c = self.input.byte();
            let quant_selector = self.input.byte();
            self.components.push(Component {
                id,
                h_samp: u32::from(c >> 4),
                v_samp: u32::from(c & 15),
                quant_selector,
                ..Component::default()
            });
        }
        self.saw_sof = true;
        Ok(())
    }

    fn read_sos(&mut self) -> Result<()> {
        if !self.saw_sof {
            return Err(Error::SosNoSof);
        }
        let length = usize::from(self.input.u16());
        let n = usize::from(self.input.byte());
        if length != n * 2 + 6 || n < 1 || n > MAX_COMPONENTS_IN_SCAN {
            return Err(Error::BadLength);
        }
        self.components_in_scan = n;
        self.scan_components = [None; MAX_COMPONENTS_IN_SCAN];

        for i in 0..n {
            let cc = self.input.byte();
            let c = self.input.byte();

            // As in libjpeg, slot `ci` of the scan is what excuses component `ci`, whichever component that slot holds.
            let found = self
                .components
                .iter()
                .zip(self.scan_components.iter())
                .position(|(comp, slot)| comp.id == cc && slot.is_none());
            let Some(ci) = found else {
                return Err(Error::BadComponentId(cc));
            };
            if self
                .scan_components
                .iter()
                .take(i)
                .any(|&slot| slot == Some(ci))
            {
                return Err(Error::BadComponentId(cc));
            }
            *self.scan_components.get_mut(i).ok_or(Error::Internal)? = Some(ci);
            let comp = self.components.get_mut(ci).ok_or(Error::Internal)?;
            comp.dc_selector = c >> 4;
            comp.ac_selector = c & 15;
        }

        self.ss = self.input.byte();
        self.se = self.input.byte();
        let c = self.input.byte();
        self.ah = c >> 4;
        self.al = c & 15;

        self.input.next_restart_num = 0;
        self.input_scan_number += 1;
        Ok(())
    }

    fn read_dac(&mut self) -> Result<()> {
        let mut length = i32::from(self.input.u16()) - 2;
        while length > 0 {
            let index = self.input.byte();
            let val = self.input.byte();
            length -= 2;

            let i = usize::from(index);
            if let Some(k) = i
                .checked_sub(NUM_ARITH_TABLES)
                .and_then(|i| self.arith_ac_k.get_mut(i))
            {
                *k = val;
            } else if let (Some(l), Some(u)) =
                (self.arith_dc_l.get_mut(i), self.arith_dc_u.get_mut(i))
            {
                *l = val & 0x0f;
                *u = val >> 4;
                if *l > *u {
                    return Err(Error::DacValue(val));
                }
            } else {
                return Err(Error::DacIndex(index));
            }
        }
        if length != 0 {
            return Err(Error::BadLength);
        }
        Ok(())
    }

    fn read_dht(&mut self) -> Result<()> {
        let mut length = i32::from(self.input.u16()) - 2;
        while length > 16 {
            let index = self.input.byte();
            let mut spec = HuffSpec {
                bits: [0; 17],
                huffval: [0; 256],
            };
            let mut count: i32 = 0;
            for b in spec.bits.iter_mut().skip(1) {
                *b = self.input.byte();
                count += i32::from(*b);
            }
            length -= 1 + 16;

            // Enough to stay inside the table. The decoders check the counts more carefully.
            if count > 256 || count > length {
                return Err(Error::BadHuffTable);
            }
            for v in spec.huffval.iter_mut().take(count as usize) {
                *v = self.input.byte();
            }
            length -= count;

            let tables = if index & 0x10 != 0 {
                &mut self.ac_huff
            } else {
                &mut self.dc_huff
            };
            let slot = usize::from(index & !0x10);
            if slot >= NUM_HUFF_TABLES {
                return Err(Error::DhtIndex(index & !0x10));
            }
            *tables.get_mut(slot).ok_or(Error::Internal)? = Some(Box::new(spec));
        }
        if length != 0 {
            return Err(Error::BadLength);
        }
        Ok(())
    }

    fn read_dqt(&mut self) -> Result<()> {
        let mut length = i32::from(self.input.u16()) - 2;
        while length > 0 {
            let n = self.input.byte();
            let prec = n >> 4;
            let n = n & 0x0f;
            if usize::from(n) >= NUM_QUANT_TABLES {
                return Err(Error::DqtIndex(n));
            }
            let table = self
                .quant_tables
                .get_mut(usize::from(n))
                .ok_or(Error::Internal)?
                .get_or_insert([0; 64]);
            for &pos in NATURAL_ORDER.iter().take(64) {
                let v = if prec != 0 {
                    self.input.u16()
                } else {
                    u16::from(self.input.byte())
                };
                if let Some(q) = table.get_mut(usize::from(pos)) {
                    *q = v;
                }
            }
            length -= 64 + 1;
            if prec != 0 {
                length -= 64;
            }
        }
        if length != 0 {
            return Err(Error::BadLength);
        }
        Ok(())
    }

    fn read_dri(&mut self) -> Result<()> {
        if self.input.u16() != 4 {
            return Err(Error::BadLength);
        }
        self.restart_interval = u32::from(self.input.u16());
        Ok(())
    }

    /// APP0 and APP14 say which color space the components are in.
    fn read_app0_or_app14(&mut self, marker: u8) {
        let length = usize::from(self.input.u16()).saturating_sub(2);
        let mut b = [0u8; APPN_DATA_LEN];
        let numtoread = length.min(APPN_DATA_LEN);
        for v in b.iter_mut().take(numtoread) {
            *v = self.input.byte();
        }
        if marker == M_APP0 {
            if numtoread >= 14 && b.starts_with(b"JFIF\0") {
                self.saw_jfif = true;
            }
        } else if numtoread >= 12 && b.starts_with(b"Adobe") {
            let [.., transform, _, _] = b;
            self.adobe_transform = Some(transform);
        }
        self.input.skip(length - numtoread);
    }

    /// APP2 segments are kept whole: they may be pieces of an ICC profile.
    fn save_app2(&mut self) -> Result<()> {
        // A length below 2 is bogus, and nothing is saved or skipped for it.
        let Some(length) = usize::from(self.input.u16()).checked_sub(2) else {
            return Ok(());
        };
        if let Some(data) = self.input.remaining().get(..length) {
            self.app2.push(Cow::Borrowed(data));
            self.input.skip(length);
        } else {
            let mut data = try_vec_with_capacity(length)?;
            data.extend((0..length).map(|_| self.input.byte()));
            self.app2.push(Cow::Owned(data));
        }
        Ok(())
    }

    fn skip_segment(&mut self) {
        let length = usize::from(self.input.u16()).saturating_sub(2);
        self.input.skip(length);
    }

    /// The ICC profile in the APP2 segments before the first scan. A profile whose pieces do not add up is ignored.
    pub fn icc_profile(&self) -> Result<Option<Vec<u8>>> {
        fn icc(marker: &[u8]) -> Option<(u8, u8, &[u8])> {
            let rest = marker.strip_prefix(ICC_SIGNATURE)?;
            let (&[seq_no, count], data) = rest.split_first_chunk::<2>()?;
            Some((seq_no, count, data))
        }

        let mut num_markers: u8 = 0;
        let mut pieces: [Option<&[u8]>; 256] = [None; 256];
        for (seq_no, count, data) in self.app2.iter().filter_map(|m| icc(m)) {
            if num_markers == 0 {
                num_markers = count;
            }
            if num_markers != count || seq_no == 0 || seq_no > num_markers {
                return Ok(None);
            }
            let Some(piece) = pieces.get_mut(usize::from(seq_no)) else {
                return Err(Error::Internal);
            };
            if piece.is_some() {
                return Ok(None);
            }
            *piece = Some(data);
        }
        if num_markers == 0 {
            return Ok(None);
        }

        let pieces = pieces.iter().skip(1).take(usize::from(num_markers));
        let mut total_length = 0usize;
        for piece in pieces.clone() {
            let Some(piece) = piece else {
                return Ok(None);
            };
            total_length += piece.len();
        }
        if total_length == 0 {
            return Ok(None);
        }

        let mut profile = try_vec_with_capacity(total_length)?;
        for piece in pieces.flatten() {
            profile.extend_from_slice(piece);
        }
        Ok(Some(profile))
    }
}
