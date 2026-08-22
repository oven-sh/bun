//! Minimal protobuf wire-format writer/reader: varint, fixed64, fixed32,
//! length-delimited. No reflection, no allocation beyond the caller's `Vec<u8>`.

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

/// A length-delimited field whose body size isn't known up front. `RESERVE`
/// length bytes are written as a padded (non-minimal but valid) varint so a
/// body shorter than 2^(7*RESERVE) never has to move; longer bodies are
/// shifted on `finish` (rare).
pub struct Nested<const RESERVE: usize> {
    len_at: usize,
}

impl<const RESERVE: usize> Nested<RESERVE> {
    #[inline]
    pub fn begin(out: &mut Vec<u8>, field: u32) -> Self {
        write_tag(out, field, WireType::Len);
        let len_at = out.len();
        let mut pad = [0x80u8; RESERVE];
        pad[RESERVE - 1] = 0;
        out.extend_from_slice(&pad);
        Nested { len_at }
    }

    /// Re-open a field begun earlier (e.g. copied from a template) whose
    /// length bytes start at `len_at`.
    #[inline]
    pub fn at(len_at: usize) -> Self {
        Nested { len_at }
    }

    #[inline]
    pub fn len_at(&self) -> usize {
        self.len_at
    }

    #[inline]
    pub fn finish(self, out: &mut Vec<u8>) {
        let body_at = self.len_at + RESERVE;
        let body_len = out.len() - body_at;
        if body_len < (1 << (7 * RESERVE)) {
            let mut v = body_len;
            for b in &mut out[self.len_at..body_at - 1] {
                *b = (v as u8 & 0x7f) | 0x80;
                v >>= 7;
            }
            out[body_at - 1] = v as u8;
            return;
        }
        self.finish_slow(out, body_len);
    }

    #[cold]
    #[inline(never)]
    fn finish_slow(self, out: &mut Vec<u8>, body_len: usize) {
        let body_at = self.len_at + RESERVE;
        let extra = varint_len(body_len as u64) - RESERVE;
        let old_len = out.len();
        out.resize(old_len + extra, 0);
        out.copy_within(body_at..old_len, body_at + extra);
        let mut v = body_len;
        for b in &mut out[self.len_at..body_at + extra - 1] {
            *b = (v as u8 & 0x7f) | 0x80;
            v >>= 7;
        }
        out[body_at + extra - 1] = v as u8;
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
        for &v in &[
            0u64,
            1,
            127,
            128,
            300,
            16383,
            16384,
            u32::MAX as u64,
            u64::MAX,
        ] {
            let mut out = Vec::new();
            write_varint(&mut out, v);
            assert_eq!(out.len(), varint_len(v));
            let mut r = Reader::new(&out);
            assert_eq!(r.varint().unwrap(), v);
        }
    }

    fn nested_case<const R: usize>(body: usize) {
        let mut out = vec![0xAA];
        let n = Nested::<R>::begin(&mut out, 3);
        out.extend(std::iter::repeat_n(7u8, body));
        n.finish(&mut out);
        let mut r = Reader::new(&out[1..]);
        let (f, v) = r.next().unwrap().unwrap();
        assert_eq!(f, 3);
        assert_eq!(v.as_bytes().len(), body);
        assert!(r.next().unwrap().is_none());
    }

    #[test]
    fn nested_patch() {
        for body in [0usize, 1, 127, 128, 16383, 16384, 20000] {
            nested_case::<2>(body);
            nested_case::<5>(body);
        }
    }
}
