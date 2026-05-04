// This code is based on https://github.com/frmdstryr/zhp/blob/a4b5700c289c3619647206144e10fb414113a888/src/websocket.zig
// Thank you @frmdstryr.

use core::mem::size_of;

// Zig: enum(u4). Rust has no u4 repr; values are 0x0..=0xF so u8 is layout-safe.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Opcode {
    Continue = 0x0,
    Text = 0x1,
    Binary = 0x2,
    Res3 = 0x3,
    Res4 = 0x4,
    Res5 = 0x5,
    Res6 = 0x6,
    Res7 = 0x7,
    Close = 0x8,
    Ping = 0x9,
    Pong = 0xA,
    ResB = 0xB,
    ResC = 0xC,
    ResD = 0xD,
    ResE = 0xE,
    ResF = 0xF,
}

impl Opcode {
    pub fn is_control(self) -> bool {
        (self as u8) & 0x8 != 0
    }

    #[inline]
    const fn from_raw(n: u8) -> Opcode {
        debug_assert!(n <= 0xF);
        // SAFETY: Opcode is #[repr(u8)] and exhaustively covers 0x0..=0xF.
        unsafe { core::mem::transmute::<u8, Opcode>(n) }
    }
}

// Zig: packed struct(u16) with non-bool fields → #[repr(transparent)] u16 + manual shift accessors.
// Zig packed-struct field order is LSB-first:
//   bits 0..=6   len: u7
//   bit  7       mask: bool
//   bits 8..=11  opcode: Opcode (u4)
//   bits 12..=13 rsv: u2       (default 0)   — rsv2 and rsv3
//   bit  14      compressed: bool (default false) — rsv1
//   bit  15      final: bool   (default true)
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct WebsocketHeader(u16);

impl WebsocketHeader {
    const LEN_SHIFT: u32 = 0;
    const LEN_MASK: u16 = 0b0111_1111;
    const MASK_SHIFT: u32 = 7;
    const OPCODE_SHIFT: u32 = 8;
    const OPCODE_MASK: u16 = 0b1111;
    const RSV_SHIFT: u32 = 12;
    const RSV_MASK: u16 = 0b11;
    const COMPRESSED_SHIFT: u32 = 14;
    const FINAL_SHIFT: u32 = 15;

    /// Construct with the same defaults as the Zig packed struct
    /// (`rsv = 0`, `compressed = false`, `final = true`).
    pub const fn new(len: u8, mask: bool, opcode: Opcode) -> WebsocketHeader {
        let mut bits: u16 = 0;
        bits |= (len as u16 & Self::LEN_MASK) << Self::LEN_SHIFT;
        bits |= (mask as u16) << Self::MASK_SHIFT;
        bits |= (opcode as u16 & Self::OPCODE_MASK) << Self::OPCODE_SHIFT;
        // rsv = 0
        // compressed = false
        bits |= 1u16 << Self::FINAL_SHIFT; // final = true
        WebsocketHeader(bits)
    }

    #[inline] pub const fn bits(self) -> u16 { self.0 }

    #[inline] pub const fn len(self) -> u8 { ((self.0 >> Self::LEN_SHIFT) & Self::LEN_MASK) as u8 }
    #[inline] pub fn set_len(&mut self, v: u8) {
        self.0 = (self.0 & !(Self::LEN_MASK << Self::LEN_SHIFT)) | ((v as u16 & Self::LEN_MASK) << Self::LEN_SHIFT);
    }

    #[inline] pub const fn mask(self) -> bool { (self.0 >> Self::MASK_SHIFT) & 1 != 0 }
    #[inline] pub fn set_mask(&mut self, v: bool) {
        self.0 = (self.0 & !(1u16 << Self::MASK_SHIFT)) | ((v as u16) << Self::MASK_SHIFT);
    }

    #[inline] pub fn opcode(self) -> Opcode { Opcode::from_raw(((self.0 >> Self::OPCODE_SHIFT) & Self::OPCODE_MASK) as u8) }
    #[inline] pub fn set_opcode(&mut self, v: Opcode) {
        self.0 = (self.0 & !(Self::OPCODE_MASK << Self::OPCODE_SHIFT)) | ((v as u16 & Self::OPCODE_MASK) << Self::OPCODE_SHIFT);
    }

    #[inline] pub const fn rsv(self) -> u8 { ((self.0 >> Self::RSV_SHIFT) & Self::RSV_MASK) as u8 }
    #[inline] pub fn set_rsv(&mut self, v: u8) {
        self.0 = (self.0 & !(Self::RSV_MASK << Self::RSV_SHIFT)) | ((v as u16 & Self::RSV_MASK) << Self::RSV_SHIFT);
    }

    #[inline] pub const fn compressed(self) -> bool { (self.0 >> Self::COMPRESSED_SHIFT) & 1 != 0 }
    #[inline] pub fn set_compressed(&mut self, v: bool) {
        self.0 = (self.0 & !(1u16 << Self::COMPRESSED_SHIFT)) | ((v as u16) << Self::COMPRESSED_SHIFT);
    }

    #[inline] pub const fn final_(self) -> bool { (self.0 >> Self::FINAL_SHIFT) & 1 != 0 }
    #[inline] pub fn set_final(&mut self, v: bool) {
        self.0 = (self.0 & !(1u16 << Self::FINAL_SHIFT)) | ((v as u16) << Self::FINAL_SHIFT);
    }

    pub fn write_header(self, writer: &mut impl bun_io::Write, n: usize) -> Result<(), bun_core::Error> {
        // packed structs are sometimes buggy
        // lets check it worked right
        if cfg!(debug_assertions) {
            let buf = self.0.to_be_bytes();
            let casted = u16::from_be_bytes(buf);
            debug_assert!(casted == self.0);
            debug_assert!(WebsocketHeader(casted) == self);
        }

        writer.write_all(&self.0.to_be_bytes())?;
        debug_assert!(self.len() == Self::pack_length(n));
        Ok(())
    }

    pub const fn pack_length(length: usize) -> u8 {
        match length {
            0..=125 => length as u8, // @truncate
            126..=0xFFFF => 126,
            _ => 127,
        }
    }

    const MASK_LENGTH: usize = 4;
    const HEADER_LENGTH: usize = 2;

    pub const fn length_byte_count(byte_length: usize) -> usize {
        match byte_length {
            0..=125 => 0,
            126..=0xFFFF => size_of::<u16>(),
            _ => size_of::<u64>(),
        }
    }

    pub const fn frame_size(byte_length: usize) -> usize {
        Self::HEADER_LENGTH + byte_length + Self::length_byte_count(byte_length)
    }

    pub const fn frame_size_including_mask(byte_length: usize) -> usize {
        Self::frame_size(byte_length) + Self::MASK_LENGTH
    }

    pub const fn slice(self) -> [u8; 2] {
        // @bitCast(@byteSwap(@bitCast(self)))
        self.0.to_be_bytes()
    }

    pub const fn from_slice(bytes: [u8; 2]) -> WebsocketHeader {
        // @bitCast(@byteSwap(@bitCast(bytes)))
        WebsocketHeader(u16::from_be_bytes(bytes))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/websocket.zig (91 lines)
//   confidence: high
//   todos:      0
//   notes:      packed struct(u16) → transparent u16 + shift accessors; Opcode enum(u4) → repr(u8); writer: anytype → &mut impl bun_io::Write
// ──────────────────────────────────────────────────────────────────────────
