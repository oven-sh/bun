//! Marker segments (jdmarker.c) and the ICC profile they carry (jdicc.c).

use super::{Component, Decoder, MAX_COMPONENTS_IN_SCAN, NUM_ARITH_TABLES};
use crate::error::{Error, Result, try_box, try_vec_with_capacity};
use crate::markers::*;
use crate::tables::{HuffSpec, natural_order};
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
        self.components.try_reserve(usize::from(num_components))?;
        for _ in 0..num_components {
            let id = self.input.byte();
            let sampling = self.input.byte();
            let quant_selector = self.input.byte();
            self.components.push(Component {
                id,
                h_samp: u32::from(sampling >> 4),
                v_samp: u32::from(sampling & 15),
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
        let count = usize::from(self.input.byte());
        if length != count * 2 + 6 || count < 1 || count > MAX_COMPONENTS_IN_SCAN {
            return Err(Error::BadLength);
        }
        self.components_in_scan = count;
        self.scan_components = [None; MAX_COMPONENTS_IN_SCAN];

        for i in 0..count {
            let id = self.input.byte();
            let selectors = self.input.byte();

            // As in libjpeg, slot `ci` of the scan is what excuses component `ci`, whichever component that slot holds.
            let found = self
                .components
                .iter()
                .zip(self.scan_components.iter())
                .position(|(comp, slot)| comp.id == id && slot.is_none());
            let Some(ci) = found else {
                return Err(Error::BadComponentId(id));
            };
            if self
                .scan_components
                .iter()
                .take(i)
                .any(|&slot| slot == Some(ci))
            {
                return Err(Error::BadComponentId(id));
            }
            *self.scan_components.get_mut(i).ok_or(Error::Internal)? = Some(ci);
            let comp = self.components.get_mut(ci).ok_or(Error::Internal)?;
            comp.dc_selector = selectors >> 4;
            comp.ac_selector = selectors & 15;
        }

        self.ss = self.input.byte();
        self.se = self.input.byte();
        let approximation = self.input.byte();
        self.ah = approximation >> 4;
        self.al = approximation & 15;

        self.input.next_restart_num = 0;
        self.input_scan_number += 1;
        Ok(())
    }

    fn read_dac(&mut self) -> Result<()> {
        let mut length = i32::from(self.input.u16()) - 2;
        while length > 0 {
            let index = self.input.byte();
            let value = self.input.byte();
            length -= 2;

            let i = usize::from(index);
            if let Some(k) = i
                .checked_sub(NUM_ARITH_TABLES)
                .and_then(|i| self.arith_ac_k.get_mut(i))
            {
                *k = value;
            } else if let (Some(l), Some(u)) =
                (self.arith_dc_l.get_mut(i), self.arith_dc_u.get_mut(i))
            {
                *l = value & 0x0f;
                *u = value >> 4;
                if *l > *u {
                    return Err(Error::DacValue(value));
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
            for codes in spec.bits.iter_mut().skip(1) {
                *codes = self.input.byte();
                count += i32::from(*codes);
            }
            length -= 1 + 16;

            // Enough to stay inside the table. The decoders check the counts more carefully.
            if count > 256 || count > length {
                return Err(Error::BadHuffTable);
            }
            for symbol in spec.huffval.iter_mut().take(count as usize) {
                *symbol = self.input.byte();
            }
            length -= count;

            let tables = if index & 0x10 != 0 {
                &mut self.ac_huff
            } else {
                &mut self.dc_huff
            };
            let selector = index & !0x10;
            *tables
                .get_mut(usize::from(selector))
                .ok_or(Error::DhtIndex(selector))? = Some(try_box(spec)?);
        }
        if length != 0 {
            return Err(Error::BadLength);
        }
        Ok(())
    }

    fn read_dqt(&mut self) -> Result<()> {
        let mut length = i32::from(self.input.u16()) - 2;
        while length > 0 {
            let index = self.input.byte();
            let wide = index >> 4 != 0;
            let selector = index & 0x0f;
            let table = self
                .quant_tables
                .get_mut(usize::from(selector))
                .ok_or(Error::DqtIndex(selector))?
                .get_or_insert([0; 64]);
            for k in 0..64 {
                *table.get_mut(natural_order(k)).ok_or(Error::Internal)? = if wide {
                    self.input.u16()
                } else {
                    u16::from(self.input.byte())
                };
            }
            length -= if wide { 1 + 128 } else { 1 + 64 };
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
        let mut data = [0u8; APPN_DATA_LEN];
        let read = length.min(APPN_DATA_LEN);
        for byte in data.iter_mut().take(read) {
            *byte = self.input.byte();
        }
        if marker == M_APP0 {
            if read >= 14 && data.starts_with(b"JFIF\0") {
                self.saw_jfif = true;
            }
        } else if read >= 12 && data.starts_with(b"Adobe") {
            let [.., transform, _, _] = data;
            self.adobe_transform = Some(transform);
        }
        self.input.skip(length - read);
    }

    /// APP2 segments are kept whole: they may be pieces of an ICC profile.
    fn save_app2(&mut self) -> Result<()> {
        // A length below 2 is bogus, and nothing is saved or skipped for it.
        let Some(length) = usize::from(self.input.u16()).checked_sub(2) else {
            return Ok(());
        };
        self.app2.try_reserve(1)?;
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
