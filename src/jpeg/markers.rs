//! Marker codes: the byte that follows FF.

pub(crate) const M_TEM: u8 = 0x01;
pub(crate) const M_SOF0: u8 = 0xc0;
pub(crate) const M_SOF1: u8 = 0xc1;
pub(crate) const M_SOF2: u8 = 0xc2;
pub(crate) const M_SOF3: u8 = 0xc3;
pub(crate) const M_DHT: u8 = 0xc4;
pub(crate) const M_SOF5: u8 = 0xc5;
pub(crate) const M_SOF6: u8 = 0xc6;
pub(crate) const M_SOF7: u8 = 0xc7;
pub(crate) const M_JPG: u8 = 0xc8;
pub(crate) const M_SOF9: u8 = 0xc9;
pub(crate) const M_SOF10: u8 = 0xca;
pub(crate) const M_SOF11: u8 = 0xcb;
pub(crate) const M_DAC: u8 = 0xcc;
pub(crate) const M_SOF13: u8 = 0xcd;
pub(crate) const M_SOF14: u8 = 0xce;
pub(crate) const M_SOF15: u8 = 0xcf;
pub(crate) const M_RST0: u8 = 0xd0;
pub(crate) const M_RST7: u8 = 0xd7;
pub(crate) const M_SOI: u8 = 0xd8;
pub(crate) const M_EOI: u8 = 0xd9;
pub(crate) const M_SOS: u8 = 0xda;
pub(crate) const M_DQT: u8 = 0xdb;
pub(crate) const M_DNL: u8 = 0xdc;
pub(crate) const M_DRI: u8 = 0xdd;
pub(crate) const M_APP0: u8 = 0xe0;
pub(crate) const M_APP2: u8 = 0xe2;
pub(crate) const M_APP14: u8 = 0xee;
pub(crate) const M_APP15: u8 = 0xef;
pub(crate) const M_COM: u8 = 0xfe;

/// What an APP2 segment with a piece of an ICC profile begins with. The number of the piece and their count follow.
pub(crate) const ICC_SIGNATURE: &[u8; 12] = b"ICC_PROFILE\0";
