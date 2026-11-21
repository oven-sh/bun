//! RFC 9204 Appendix A.

use bun_hpack::{equal, wrapped};

const LEN: usize = 99;

#[rustfmt::skip]
const ENTRIES: [(&str, &str); LEN] = [
    (":authority", ""),
    (":path", "/"),
    ("age", "0"),
    ("content-disposition", ""),
    ("content-length", "0"),
    ("cookie", ""),
    ("date", ""),
    ("etag", ""),
    ("if-modified-since", ""),
    ("if-none-match", ""),
    ("last-modified", ""),
    ("link", ""),
    ("location", ""),
    ("referer", ""),
    ("set-cookie", ""),
    (":method", "CONNECT"),
    (":method", "DELETE"),
    (":method", "GET"),
    (":method", "HEAD"),
    (":method", "OPTIONS"),
    (":method", "POST"),
    (":method", "PUT"),
    (":scheme", "http"),
    (":scheme", "https"),
    (":status", "103"),
    (":status", "200"),
    (":status", "304"),
    (":status", "404"),
    (":status", "503"),
    ("accept", "*/*"),
    ("accept", "application/dns-message"),
    ("accept-encoding", "gzip, deflate, br"),
    ("accept-ranges", "bytes"),
    ("access-control-allow-headers", "cache-control"),
    ("access-control-allow-headers", "content-type"),
    ("access-control-allow-origin", "*"),
    ("cache-control", "max-age=0"),
    ("cache-control", "max-age=2592000"),
    ("cache-control", "max-age=604800"),
    ("cache-control", "no-cache"),
    ("cache-control", "no-store"),
    ("cache-control", "public, max-age=31536000"),
    ("content-encoding", "br"),
    ("content-encoding", "gzip"),
    ("content-type", "application/dns-message"),
    ("content-type", "application/javascript"),
    ("content-type", "application/json"),
    ("content-type", "application/x-www-form-urlencoded"),
    ("content-type", "image/gif"),
    ("content-type", "image/jpeg"),
    ("content-type", "image/png"),
    ("content-type", "text/css"),
    ("content-type", "text/html; charset=utf-8"),
    ("content-type", "text/plain"),
    ("content-type", "text/plain;charset=utf-8"),
    ("range", "bytes=0-"),
    ("strict-transport-security", "max-age=31536000"),
    ("strict-transport-security", "max-age=31536000; includesubdomains"),
    ("strict-transport-security", "max-age=31536000; includesubdomains; preload"),
    ("vary", "accept-encoding"),
    ("vary", "origin"),
    ("x-content-type-options", "nosniff"),
    ("x-xss-protection", "1; mode=block"),
    (":status", "100"),
    (":status", "204"),
    (":status", "206"),
    (":status", "302"),
    (":status", "400"),
    (":status", "403"),
    (":status", "421"),
    (":status", "425"),
    (":status", "500"),
    ("accept-language", ""),
    ("access-control-allow-credentials", "FALSE"),
    ("access-control-allow-credentials", "TRUE"),
    ("access-control-allow-headers", "*"),
    ("access-control-allow-methods", "get"),
    ("access-control-allow-methods", "get, post, options"),
    ("access-control-allow-methods", "options"),
    ("access-control-expose-headers", "content-length"),
    ("access-control-request-headers", "content-type"),
    ("access-control-request-method", "get"),
    ("access-control-request-method", "post"),
    ("alt-svc", "clear"),
    ("authorization", ""),
    ("content-security-policy", "script-src 'none'; object-src 'none'; base-uri 'none'"),
    ("early-data", "1"),
    ("expect-ct", ""),
    ("forwarded", ""),
    ("if-range", ""),
    ("origin", ""),
    ("purpose", "prefetch"),
    ("server", ""),
    ("timing-allow-origin", "*"),
    ("upgrade-insecure-requests", "1"),
    ("user-agent", ""),
    ("x-forwarded-for", ""),
    ("x-frame-options", "deny"),
    ("x-frame-options", "sameorigin"),
];

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const TEXT_LEN: usize = {
    let (mut len, mut index) = (0, 0);
    while index < LEN {
        len += ENTRIES[index].0.len() + ENTRIES[index].1.len();
        index += 1;
    }
    len
};

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static TEXT: [u8; TEXT_LEN] = {
    let mut text = [0; _];
    let (mut rest, mut index) = (text.as_mut_slice(), 0);
    while index < 2 * LEN {
        let (name, value) = ENTRIES[index / 2];
        let part = [name, value][index % 2].as_bytes();
        let room;
        (room, rest) = rest.split_at_mut(part.len());
        room.copy_from_slice(part);
        index += 1;
    }
    text
};

#[derive(Clone, Copy)]
pub(crate) struct Entry {
    /// The name and, right after it, the value.
    pub(crate) field: &'static [u8],
    pub(crate) name_len: u8,
    /// The lowest index with this name.
    pub(crate) first: u8,
    /// The next index with this name, or 0.
    next: u8,
}

impl Entry {
    #[inline(always)]
    pub(crate) fn name(&self) -> &'static [u8] {
        self.field.get(..self.name_len.into()).unwrap_or_default()
    }

    #[inline(always)]
    fn value(&self) -> &'static [u8] {
        self.field.get(self.name_len.into()..).unwrap_or_default()
    }
}

const SLOTS: usize = 128;

/// Differs for all names of the table.
#[inline(always)]
const fn slot(name: &[u8]) -> usize {
    let Some(&end) = name.last_chunk() else {
        return 0;
    };
    let key = (u16::from_le_bytes(end) as u32) << 8 | name.len() as u8 as u32;
    (key.wrapping_mul(0x069f_4373) >> (32 - SLOTS.ilog2())) as usize
}

/// The lowest index of a name. Where there is no name, that of one which belongs elsewhere.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const FIRST_BY_SLOT: [u8; SLOTS] = {
    let (mut table, mut index) = ([0; _], LEN);
    while index > 0 {
        index -= 1;
        table[slot(ENTRIES[index].0.as_bytes())] = index as u8;
    }
    table
};

static BY_SLOT: [u8; SLOTS] = FIRST_BY_SLOT;

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static BY_INDEX: [Entry; LEN.next_power_of_two()] = {
    let mut table = [Entry {
        field: &[],
        name_len: 0,
        first: 0,
        next: 0,
    }; _];
    let mut last_by_slot = FIRST_BY_SLOT;
    let (mut rest, mut index) = (TEXT.as_slice(), 0);
    while index < LEN {
        let (name, value) = ENTRIES[index];
        let slot = slot(name.as_bytes());
        (table[index].field, rest) = rest.split_at(name.len() + value.len());
        table[index].name_len = name.len() as u8;
        table[index].first = FIRST_BY_SLOT[slot];
        if last_by_slot[slot] as usize != index {
            table[last_by_slot[slot] as usize].next = index as u8;
            last_by_slot[slot] = index as u8;
        }
        index += 1;
    }
    table
};

#[inline(always)]
pub(crate) fn get(index: usize) -> Option<&'static Entry> {
    (index < LEN).then(|| wrapped(&BY_INDEX, index))
}

/// Returns the lowest index with this name.
#[inline(always)]
pub(crate) fn find_name(wanted: &[u8]) -> Option<u8> {
    let first = *wrapped(&BY_SLOT, slot(wanted));
    equal(wrapped(&BY_INDEX, first.into()).name(), wanted).then_some(first)
}

/// `first` is the lowest index with the name.
#[inline(always)]
pub(crate) fn find_field(first: u8, value: &[u8]) -> Option<u8> {
    let mut index = first;
    loop {
        let entry = wrapped(&BY_INDEX, index.into());
        if equal(entry.value(), value) {
            return Some(index);
        }
        index = entry.next;
        if index == 0 {
            return None;
        }
    }
}
