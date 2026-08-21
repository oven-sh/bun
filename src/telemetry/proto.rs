//! Minimal protobuf wire-format writer/reader. Only what OTLP needs: varint,
//! fixed64, fixed32 (unused), length-delimited. No reflection, no allocation
//! beyond the caller's `Vec<u8>`.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum WireType {
    Varint = 0,
    Fixed64 = 1,
    Len = 2,
    Fixed32 = 5,
}

#[inline]
pub const fn varint_len(mut v: u64) -> usize {
    let mut n = 1;
    while v >= 0x80 {
        v >>= 7;
        n += 1;
    }
    n
}

#[inline]
pub const fn tag_len(field: u32) -> usize {
    varint_len((field as u64) << 3)
}

/// Size of a length-delimited field with a `payload`-byte body.
#[inline]
pub const fn len_field_len(field: u32, payload: usize) -> usize {
    tag_len(field) + varint_len(payload as u64) + payload
}

#[inline]
pub fn write_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

#[inline]
pub fn write_tag(out: &mut Vec<u8>, field: u32, wt: WireType) {
    write_varint(out, ((field as u64) << 3) | wt as u64);
}

#[inline]
pub fn write_uint(out: &mut Vec<u8>, field: u32, v: u64) {
    if v == 0 {
        return;
    }
    write_tag(out, field, WireType::Varint);
    write_varint(out, v);
}

#[inline]
pub fn write_int64(out: &mut Vec<u8>, field: u32, v: i64) {
    // int64 (not sint64): negative values are 10-byte two's complement varints.
    if v == 0 {
        return;
    }
    write_tag(out, field, WireType::Varint);
    write_varint(out, v as u64);
}

#[inline]
pub fn write_bool(out: &mut Vec<u8>, field: u32, v: bool) {
    if v {
        write_tag(out, field, WireType::Varint);
        out.push(1);
    }
}

/// Always writes, even when false (needed inside AnyValue oneof).
#[inline]
pub fn write_bool_always(out: &mut Vec<u8>, field: u32, v: bool) {
    write_tag(out, field, WireType::Varint);
    out.push(v as u8);
}

#[inline]
pub fn write_fixed64(out: &mut Vec<u8>, field: u32, v: u64) {
    write_tag(out, field, WireType::Fixed64);
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
pub fn write_fixed64_opt(out: &mut Vec<u8>, field: u32, v: u64) {
    if v != 0 {
        write_fixed64(out, field, v);
    }
}

#[inline]
pub fn write_fixed32(out: &mut Vec<u8>, field: u32, v: u32) {
    if v == 0 {
        return;
    }
    write_tag(out, field, WireType::Fixed32);
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
pub fn write_double(out: &mut Vec<u8>, field: u32, v: f64) {
    write_tag(out, field, WireType::Fixed64);
    out.extend_from_slice(&v.to_bits().to_le_bytes());
}

#[inline]
pub fn write_bytes(out: &mut Vec<u8>, field: u32, v: &[u8]) {
    write_tag(out, field, WireType::Len);
    write_varint(out, v.len() as u64);
    out.extend_from_slice(v);
}

/// `bytes`/`string` field, omitted when empty (proto3 default).
#[inline]
pub fn write_bytes_opt(out: &mut Vec<u8>, field: u32, v: &[u8]) {
    if !v.is_empty() {
        write_bytes(out, field, v);
    }
}

/// Begin a length-delimited field whose payload size is already known.
#[inline]
pub fn write_len_prefix(out: &mut Vec<u8>, field: u32, payload: usize) {
    write_tag(out, field, WireType::Len);
    write_varint(out, payload as u64);
}

/// A nested message whose size isn't known up front. Reserves a 4-byte
/// varint for the length and patches it on `finish`; if the body ends up
/// needing fewer bytes the tail is shifted down (bodies here are small).
pub struct Nested {
    len_at: usize,
    body_at: usize,
}

const RESERVED: usize = 4; // up to 2^28-1 bytes

impl Nested {
    #[inline]
    pub fn begin(out: &mut Vec<u8>, field: u32) -> Nested {
        write_tag(out, field, WireType::Len);
        let len_at = out.len();
        out.extend_from_slice(&[0x80, 0x80, 0x80, 0x00]);
        Nested { len_at, body_at: len_at + RESERVED }
    }

    #[inline]
    pub fn finish(self, out: &mut Vec<u8>) {
        let body_len = out.len() - self.body_at;
        let need = varint_len(body_len as u64);
        debug_assert!(need <= RESERVED, "nested message too large");
        if need < RESERVED {
            let shift = RESERVED - need;
            out.copy_within(self.body_at.., self.body_at - shift);
            out.truncate(out.len() - shift);
        }
        let mut v = body_len as u64;
        let mut i = self.len_at;
        loop {
            let byte = (v as u8) & 0x7f;
            v >>= 7;
            if v == 0 {
                out[i] = byte;
                break;
            }
            out[i] = byte | 0x80;
            i += 1;
        }
    }
}

// ───────────────────────────── reader ─────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DecodeError;

pub struct Reader<'a> {
    pub buf: &'a [u8],
    pub pos: usize,
}

#[derive(Clone, Copy, Debug)]
pub enum Value<'a> {
    Varint(u64),
    Fixed64(u64),
    Fixed32(u32),
    Len(&'a [u8]),
}

impl<'a> Value<'a> {
    #[inline]
    pub fn as_u64(&self) -> u64 {
        match *self {
            Value::Varint(v) | Value::Fixed64(v) => v,
            Value::Fixed32(v) => v as u64,
            Value::Len(_) => 0,
        }
    }
    #[inline]
    pub fn as_bytes(&self) -> &'a [u8] {
        match *self {
            Value::Len(b) => b,
            _ => &[],
        }
    }
    #[inline]
    pub fn as_f64(&self) -> f64 {
        match *self {
            Value::Fixed64(v) => f64::from_bits(v),
            Value::Varint(v) => v as f64,
            Value::Fixed32(v) => f32::from_bits(v) as f64,
            Value::Len(_) => 0.0,
        }
    }
}

impl<'a> Reader<'a> {
    #[inline]
    pub fn new(buf: &'a [u8]) -> Self {
        Reader { buf, pos: 0 }
    }

    #[inline]
    pub fn varint(&mut self) -> Result<u64, DecodeError> {
        let mut result: u64 = 0;
        let mut shift = 0u32;
        loop {
            let b = *self.buf.get(self.pos).ok_or(DecodeError)?;
            self.pos += 1;
            if shift >= 64 {
                return Err(DecodeError);
            }
            result |= ((b & 0x7f) as u64) << shift;
            if b & 0x80 == 0 {
                return Ok(result);
            }
            shift += 7;
        }
    }

    /// Next `(field_number, value)` or `None` at end of buffer.
    pub fn next(&mut self) -> Result<Option<(u32, Value<'a>)>, DecodeError> {
        if self.pos >= self.buf.len() {
            return Ok(None);
        }
        let key = self.varint()?;
        let field = (key >> 3) as u32;
        let v = match key & 7 {
            0 => Value::Varint(self.varint()?),
            1 => {
                let end = self.pos.checked_add(8).ok_or(DecodeError)?;
                let b = self.buf.get(self.pos..end).ok_or(DecodeError)?;
                self.pos = end;
                Value::Fixed64(u64::from_le_bytes(b.try_into().unwrap()))
            }
            2 => {
                let len = self.varint()? as usize;
                let end = self.pos.checked_add(len).ok_or(DecodeError)?;
                let b = self.buf.get(self.pos..end).ok_or(DecodeError)?;
                self.pos = end;
                Value::Len(b)
            }
            5 => {
                let end = self.pos.checked_add(4).ok_or(DecodeError)?;
                let b = self.buf.get(self.pos..end).ok_or(DecodeError)?;
                self.pos = end;
                Value::Fixed32(u32::from_le_bytes(b.try_into().unwrap()))
            }
            _ => return Err(DecodeError),
        };
        Ok(Some((field, v)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_roundtrip() {
        for &v in &[0u64, 1, 127, 128, 300, 16383, 16384, u32::MAX as u64, u64::MAX] {
            let mut out = Vec::new();
            write_varint(&mut out, v);
            assert_eq!(out.len(), varint_len(v));
            let mut r = Reader::new(&out);
            assert_eq!(r.varint().unwrap(), v);
        }
    }

    #[test]
    fn nested_patch() {
        for body in [0usize, 1, 127, 128, 20000] {
            let mut out = Vec::new();
            out.push(0xAA);
            let n = Nested::begin(&mut out, 3);
            out.extend(std::iter::repeat(7u8).take(body));
            n.finish(&mut out);
            let mut r = Reader::new(&out[1..]);
            let (f, v) = r.next().unwrap().unwrap();
            assert_eq!(f, 3);
            assert_eq!(v.as_bytes().len(), body);
            assert!(r.next().unwrap().is_none());
        }
    }
}
