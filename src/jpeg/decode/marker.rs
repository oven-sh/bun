//! Marker segments (jdmarker.c) and the ICC profile they carry (jdicc.c).

use super::input::{M_EOI, Warning};
use super::{Component, Decoder, MAX_COMPS_IN_SCAN, NUM_ARITH_TBLS, NUM_HUFF_TBLS, NUM_QUANT_TBLS};
use crate::error::{Error, Result};
use crate::tables::{HuffSpec, NATURAL_ORDER};

const M_SOF0: u8 = 0xc0;
const M_SOF1: u8 = 0xc1;
const M_SOF2: u8 = 0xc2;
const M_SOF3: u8 = 0xc3;
const M_DHT: u8 = 0xc4;
const M_SOF5: u8 = 0xc5;
const M_SOF6: u8 = 0xc6;
const M_SOF7: u8 = 0xc7;
const M_JPG: u8 = 0xc8;
const M_SOF9: u8 = 0xc9;
const M_SOF10: u8 = 0xca;
const M_SOF11: u8 = 0xcb;
const M_DAC: u8 = 0xcc;
const M_SOF13: u8 = 0xcd;
const M_SOF14: u8 = 0xce;
const M_SOF15: u8 = 0xcf;
const M_RST0: u8 = 0xd0;
const M_RST7: u8 = 0xd7;
const M_SOI: u8 = 0xd8;
const M_SOS: u8 = 0xda;
const M_DQT: u8 = 0xdb;
const M_DNL: u8 = 0xdc;
const M_DRI: u8 = 0xdd;
const M_APP0: u8 = 0xe0;
const M_APP2: u8 = 0xe2;
const M_APP14: u8 = 0xee;
const M_APP15: u8 = 0xef;
const M_COM: u8 = 0xfe;
const M_TEM: u8 = 0x01;

/// How much of an APP0 or APP14 segment is looked at.
const APPN_DATA_LEN: usize = 14;

/// "ICC_PROFILE\0", a sequence number and a count.
const ICC_OVERHEAD_LEN: usize = 14;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reached {
    Sos,
    Eoi,
}

impl Decoder<'_> {
    /// Reads markers up to and including the next SOS or EOI.
    pub(crate) fn read_markers(&mut self) -> Result<Reached> {
        loop {
            if self.inp.unread_marker == 0 {
                if !self.saw_soi {
                    // No garbage is allowed before SOI, or a file that is not a JPEG would be scanned to its end.
                    let c = self.inp.byte();
                    let c2 = self.inp.byte();
                    if c != 0xff || c2 != M_SOI {
                        return Err(Error::NoSoi(c, c2));
                    }
                    self.inp.unread_marker = c2;
                } else {
                    self.inp.next_marker();
                }
            }
            let marker = self.inp.unread_marker;
            match marker {
                M_SOI => self.get_soi()?,
                M_SOF0 | M_SOF1 => self.get_sof(false, false, false)?,
                M_SOF2 => self.get_sof(true, false, false)?,
                M_SOF3 => self.get_sof(false, true, false)?,
                M_SOF9 => self.get_sof(false, false, true)?,
                M_SOF10 => self.get_sof(true, false, true)?,
                M_SOF11 => self.get_sof(false, true, true)?,
                M_SOF5 | M_SOF6 | M_SOF7 | M_JPG | M_SOF13 | M_SOF14 | M_SOF15 => {
                    return Err(Error::SofUnsupported(marker));
                }
                M_SOS => {
                    self.get_sos()?;
                    self.inp.unread_marker = 0;
                    return Ok(Reached::Sos);
                }
                M_EOI => {
                    self.inp.unread_marker = 0;
                    return Ok(Reached::Eoi);
                }
                M_DAC => self.get_dac()?,
                M_DHT => self.get_dht()?,
                M_DQT => self.get_dqt()?,
                M_DRI => self.get_dri()?,
                M_APP0 | M_APP14 => self.get_interesting_appn(marker),
                M_APP2 => self.save_app2()?,
                M_APP0..=M_APP15 | M_COM | M_DNL => self.skip_variable(),
                M_RST0..=M_RST7 | M_TEM => {}
                _ => return Err(Error::UnknownMarker(marker)),
            }
            self.inp.unread_marker = 0;
        }
    }

    fn get_soi(&mut self) -> Result<()> {
        if self.saw_soi {
            return Err(Error::SoiDuplicate);
        }
        self.arith_dc_l = [0; NUM_ARITH_TBLS];
        self.arith_dc_u = [1; NUM_ARITH_TBLS];
        self.arith_ac_k = [5; NUM_ARITH_TBLS];
        self.restart_interval = 0;
        self.saw_jfif = false;
        self.saw_adobe = false;
        self.adobe_transform = 0;
        self.saw_soi = true;
        Ok(())
    }

    fn get_sof(&mut self, progressive: bool, lossless: bool, arith: bool) -> Result<()> {
        if self.saw_sof {
            return Err(Error::SofDuplicate);
        }
        self.progressive = progressive;
        self.lossless = lossless;
        self.arith_code = arith;

        let length = i32::from(self.inp.u16());
        self.precision = self.inp.byte();
        self.height = u32::from(self.inp.u16());
        self.width = u32::from(self.inp.u16());
        let num_components = self.inp.byte();

        // A height of 0 that a DNL marker sets later is not supported.
        if self.height == 0 || self.width == 0 || num_components == 0 {
            return Err(Error::EmptyImage);
        }
        if length - 8 != i32::from(num_components) * 3 {
            return Err(Error::BadLength);
        }

        self.comps.clear();
        for _ in 0..num_components {
            let id = self.inp.byte();
            let c = self.inp.byte();
            let quant_tbl_no = self.inp.byte();
            self.comps.push(Component {
                id,
                h_samp: u32::from(c >> 4),
                v_samp: u32::from(c & 15),
                quant_tbl_no,
                ..Component::default()
            });
        }
        self.saw_sof = true;
        Ok(())
    }

    fn get_sos(&mut self) -> Result<()> {
        if !self.saw_sof {
            return Err(Error::SosNoSof);
        }
        let length = usize::from(self.inp.u16());
        let n = usize::from(self.inp.byte());
        if length != n * 2 + 6 || n < 1 || n > MAX_COMPS_IN_SCAN {
            return Err(Error::BadLength);
        }
        self.comps_in_scan = n;
        self.cur_comp = [None; MAX_COMPS_IN_SCAN];

        for i in 0..n {
            let cc = self.inp.byte();
            let c = self.inp.byte();

            // As in libjpeg, slot `ci` of the scan is what excuses component `ci`, whichever component that slot holds.
            let found = self
                .comps
                .iter()
                .zip(self.cur_comp.iter())
                .position(|(comp, slot)| comp.id == cc && slot.is_none());
            let Some(ci) = found else {
                return Err(Error::BadComponentId(cc));
            };
            if self.cur_comp.iter().take(i).any(|&slot| slot == Some(ci)) {
                return Err(Error::BadComponentId(cc));
            }
            *self.cur_comp.get_mut(i).ok_or(Error::Internal)? = Some(ci);
            let comp = self.comps.get_mut(ci).ok_or(Error::Internal)?;
            comp.dc_tbl_no = c >> 4;
            comp.ac_tbl_no = c & 15;
        }

        self.ss = self.inp.byte();
        self.se = self.inp.byte();
        let c = self.inp.byte();
        self.ah = c >> 4;
        self.al = c & 15;

        self.inp.next_restart_num = 0;
        self.input_scan_number += 1;
        Ok(())
    }

    fn get_dac(&mut self) -> Result<()> {
        let mut length = i32::from(self.inp.u16()) - 2;
        while length > 0 {
            let index = self.inp.byte();
            let val = self.inp.byte();
            length -= 2;

            let i = usize::from(index);
            if let Some(k) = i
                .checked_sub(NUM_ARITH_TBLS)
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

    fn get_dht(&mut self) -> Result<()> {
        let mut length = i32::from(self.inp.u16()) - 2;
        while length > 16 {
            let index = self.inp.byte();
            let mut spec = HuffSpec {
                bits: [0; 17],
                huffval: [0; 256],
            };
            let mut count: i32 = 0;
            for b in spec.bits.iter_mut().skip(1) {
                *b = self.inp.byte();
                count += i32::from(*b);
            }
            length -= 1 + 16;

            // Enough to stay inside the table. The decoders check the counts more carefully.
            if count > 256 || count > length {
                return Err(Error::BadHuffTable);
            }
            for v in spec.huffval.iter_mut().take(count as usize) {
                *v = self.inp.byte();
            }
            length -= count;

            let tables = if index & 0x10 != 0 {
                &mut self.ac_huff
            } else {
                &mut self.dc_huff
            };
            let slot = usize::from(index & !0x10);
            if slot >= NUM_HUFF_TBLS {
                return Err(Error::DhtIndex(index & !0x10));
            }
            *tables.get_mut(slot).ok_or(Error::Internal)? = Some(Box::new(spec));
        }
        if length != 0 {
            return Err(Error::BadLength);
        }
        Ok(())
    }

    fn get_dqt(&mut self) -> Result<()> {
        let mut length = i32::from(self.inp.u16()) - 2;
        while length > 0 {
            let n = self.inp.byte();
            let prec = n >> 4;
            let n = n & 0x0f;
            if usize::from(n) >= NUM_QUANT_TBLS {
                return Err(Error::DqtIndex(n));
            }
            let table = self
                .quant_tbls
                .get_mut(usize::from(n))
                .ok_or(Error::Internal)?
                .get_or_insert([0; 64]);
            for &pos in NATURAL_ORDER.iter().take(64) {
                let v = if prec != 0 {
                    self.inp.u16()
                } else {
                    u16::from(self.inp.byte())
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

    fn get_dri(&mut self) -> Result<()> {
        if self.inp.u16() != 4 {
            return Err(Error::BadLength);
        }
        self.restart_interval = u32::from(self.inp.u16());
        Ok(())
    }

    /// APP0 and APP14 say which color space the components are in.
    fn get_interesting_appn(&mut self, marker: u8) {
        let length = usize::from(self.inp.u16()).saturating_sub(2);
        let mut b = [0u8; APPN_DATA_LEN];
        let numtoread = length.min(APPN_DATA_LEN);
        for v in b.iter_mut().take(numtoread) {
            *v = self.inp.byte();
        }
        if marker == M_APP0 {
            if numtoread >= 14 && b.starts_with(b"JFIF\0") {
                self.saw_jfif = true;
                let [.., major, _, _, _, _, _, _, _, _] = b;
                if major != 1 {
                    self.inp.warn(Warning::JfifMajor);
                }
            }
        } else if numtoread >= 12 && b.starts_with(b"Adobe") {
            let [.., transform, _, _] = b;
            self.saw_adobe = true;
            self.adobe_transform = transform;
        }
        self.inp.skip(length - numtoread);
    }

    /// APP2 segments are kept whole: they may be pieces of an ICC profile.
    fn save_app2(&mut self) -> Result<()> {
        // A length below 2 is bogus, and nothing is saved or skipped for it.
        let Some(length) = usize::from(self.inp.u16()).checked_sub(2) else {
            return Ok(());
        };
        let mut data = Vec::new();
        data.try_reserve_exact(length)
            .map_err(|_| Error::OutOfMemory)?;
        let real = self.inp.remaining();
        if let Some(real) = real.get(..length) {
            data.extend_from_slice(real);
            self.inp.advance(length);
        } else {
            for _ in 0..length {
                data.push(self.inp.byte());
            }
        }
        self.app2.push(data);
        Ok(())
    }

    fn skip_variable(&mut self) {
        let length = usize::from(self.inp.u16()).saturating_sub(2);
        self.inp.skip(length);
    }

    /// Puts the ICC profile together from the APP2 segments read so far. A profile whose pieces do not add up is
    /// ignored.
    pub(crate) fn read_icc_profile(&mut self) -> Result<Option<Vec<u8>>> {
        fn icc(marker: &[u8]) -> Option<(u8, u8, &[u8])> {
            let rest = marker.strip_prefix(b"ICC_PROFILE\0")?;
            let (&[seq_no, count], data) = rest.split_first_chunk::<2>()?;
            Some((seq_no, count, data))
        }
        const _: () = assert!(ICC_OVERHEAD_LEN == b"ICC_PROFILE\0".len() + 2);

        let mut num_markers: u8 = 0;
        let mut pieces: [Option<&[u8]>; 256] = [None; 256];
        for (seq_no, count, data) in self.app2.iter().filter_map(|m| icc(m)) {
            if num_markers == 0 {
                num_markers = count;
            } else if num_markers != count {
                self.inp.warn(Warning::BogusIcc);
                return Ok(None);
            }
            if seq_no == 0 || seq_no > num_markers {
                self.inp.warn(Warning::BogusIcc);
                return Ok(None);
            }
            let Some(piece) = pieces.get_mut(usize::from(seq_no)) else {
                return Err(Error::Internal);
            };
            if piece.is_some() {
                self.inp.warn(Warning::BogusIcc);
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
                self.inp.warn(Warning::BogusIcc);
                return Ok(None);
            };
            total_length += piece.len();
        }
        if total_length == 0 {
            self.inp.warn(Warning::BogusIcc);
            return Ok(None);
        }

        let mut profile = Vec::new();
        profile
            .try_reserve_exact(total_length)
            .map_err(|_| Error::OutOfMemory)?;
        for piece in pieces.flatten() {
            profile.extend_from_slice(piece);
        }
        Ok(Some(profile))
    }
}
