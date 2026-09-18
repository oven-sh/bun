//! Writer for the subset of the protobuf wire format that `profile.proto` uses.

pub(crate) struct Writer {
    pub(crate) buf: Vec<u8>,
    scratch: Vec<u8>,
}

impl Writer {
    pub(crate) fn new() -> Self {
        Self {
            buf: Vec::new(),
            scratch: Vec::new(),
        }
    }

    fn varint(&mut self, mut value: u64) {
        while value >= 0x80 {
            self.buf.push((value as u8) | 0x80);
            value >>= 7;
        }
        self.buf.push(value as u8);
    }

    fn tag(&mut self, field: u32, wire_type: u8) {
        self.varint((u64::from(field) << 3) | u64::from(wire_type));
    }

    /// proto3 scalar: the default value is left out.
    pub(crate) fn uint64(&mut self, field: u32, value: u64) {
        if value != 0 {
            self.tag(field, 0);
            self.varint(value);
        }
    }

    pub(crate) fn int64(&mut self, field: u32, value: i64) {
        self.uint64(field, value as u64);
    }

    /// A `bytes`/`string` field. Written even when empty: `string_table[0]` must be "".
    pub(crate) fn bytes(&mut self, field: u32, value: &[u8]) {
        self.tag(field, 2);
        self.varint(value.len() as u64);
        self.buf.extend_from_slice(value);
    }

    pub(crate) fn packed(&mut self, field: u32, values: &[u64]) {
        if values.is_empty() {
            return;
        }
        let mut len = 0u64;
        for &v in values {
            len += varint_len(v);
        }
        self.tag(field, 2);
        self.varint(len);
        for &v in values {
            self.varint(v);
        }
    }

    pub(crate) fn message(&mut self, field: u32, fill: impl FnOnce(&mut Writer)) {
        let mut inner = Writer {
            buf: core::mem::take(&mut self.scratch),
            scratch: Vec::new(),
        };
        inner.buf.clear();
        fill(&mut inner);
        self.bytes(field, &inner.buf);
        self.scratch = inner.buf;
    }
}

fn varint_len(value: u64) -> u64 {
    let bits = 64 - (value | 1).leading_zeros();
    u64::from(bits.div_ceil(7))
}
