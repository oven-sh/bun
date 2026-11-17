//! The byte after the 0xFF of a marker, and the identifiers that APPn segments start with.

pub(crate) const TEM: u8 = 0x01;
pub(crate) const SOF0: u8 = 0xC0;
pub(crate) const SOF2: u8 = 0xC2;
pub(crate) const SOF3: u8 = 0xC3;
pub(crate) const DHT: u8 = 0xC4;
pub(crate) const SOF9: u8 = 0xC9;
pub(crate) const SOF10: u8 = 0xCA;
pub(crate) const SOF11: u8 = 0xCB;
pub(crate) const DAC: u8 = 0xCC;
pub(crate) const RST0: u8 = 0xD0;
pub(crate) const RST7: u8 = 0xD7;
pub(crate) const SOI: u8 = 0xD8;
pub(crate) const EOI: u8 = 0xD9;
pub(crate) const SOS: u8 = 0xDA;
pub(crate) const DQT: u8 = 0xDB;
pub(crate) const DNL: u8 = 0xDC;
pub(crate) const DRI: u8 = 0xDD;
pub(crate) const APP0: u8 = 0xE0;
pub(crate) const APP2: u8 = 0xE2;
pub(crate) const APP14: u8 = 0xEE;
pub(crate) const APP15: u8 = 0xEF;
pub(crate) const COM: u8 = 0xFE;

pub(crate) const JFIF: [u8; 5] = *b"JFIF\0";
pub(crate) const ADOBE: [u8; 5] = *b"Adobe";
pub(crate) const ICC_PROFILE: [u8; 12] = *b"ICC_PROFILE\0";
