//! The static table (Appendix A) and the encoder's way into it.

pub(crate) const LEN: u32 = 61;

const ENTRIES: [(&[u8], &[u8]); LEN as usize] = [
    (b":authority", b""),
    (b":method", b"GET"),
    (b":method", b"POST"),
    (b":path", b"/"),
    (b":path", b"/index.html"),
    (b":scheme", b"http"),
    (b":scheme", b"https"),
    (b":status", b"200"),
    (b":status", b"204"),
    (b":status", b"206"),
    (b":status", b"304"),
    (b":status", b"400"),
    (b":status", b"404"),
    (b":status", b"500"),
    (b"accept-charset", b""),
    (b"accept-encoding", b"gzip, deflate"),
    (b"accept-language", b""),
    (b"accept-ranges", b""),
    (b"accept", b""),
    (b"access-control-allow-origin", b""),
    (b"age", b""),
    (b"allow", b""),
    (b"authorization", b""),
    (b"cache-control", b""),
    (b"content-disposition", b""),
    (b"content-encoding", b""),
    (b"content-language", b""),
    (b"content-length", b""),
    (b"content-location", b""),
    (b"content-range", b""),
    (b"content-type", b""),
    (b"cookie", b""),
    (b"date", b""),
    (b"etag", b""),
    (b"expect", b""),
    (b"expires", b""),
    (b"from", b""),
    (b"host", b""),
    (b"if-match", b""),
    (b"if-modified-since", b""),
    (b"if-none-match", b""),
    (b"if-range", b""),
    (b"if-unmodified-since", b""),
    (b"last-modified", b""),
    (b"link", b""),
    (b"location", b""),
    (b"max-forwards", b""),
    (b"proxy-authenticate", b""),
    (b"proxy-authorization", b""),
    (b"range", b""),
    (b"referer", b""),
    (b"refresh", b""),
    (b"retry-after", b""),
    (b"server", b""),
    (b"set-cookie", b""),
    (b"strict-transport-security", b""),
    (b"transfer-encoding", b""),
    (b"user-agent", b""),
    (b"vary", b""),
    (b"via", b""),
    (b"www-authenticate", b""),
];

/// `index` counts from 1, as on the wire.
pub(crate) fn get(index: u32) -> Option<(&'static [u8], &'static [u8])> {
    ENTRIES.get((index as usize).checked_sub(1)?).copied()
}

/// With this seed no two entries, and no two names, share a slot: a lookup is one probe.
const SEED: u64 = 1751;
const SLOTS: usize = 512;

pub(crate) fn hash_name(name: &[u8]) -> u32 {
    bun_wyhash::hash_with_seed(SEED, name) as u32
}

pub(crate) fn hash_field(name_hash: u32, value: &[u8]) -> u32 {
    bun_wyhash::hash_with_seed(name_hash as u64, value) as u32
}

const fn slot(hash: u32) -> usize {
    hash as usize & (SLOTS - 1)
}

const fn same(a: &[u8], b: &[u8]) -> bool {
    let (mut a, mut b) = (a, b);
    loop {
        match (a.split_first(), b.split_first()) {
            (None, None) => return true,
            (Some((x, a_rest)), Some((y, b_rest))) if *x == *y => (a, b) = (a_rest, b_rest),
            _ => return false,
        }
    }
}

/// Slot to index, 0 for none. A name that several entries have leads to the first of them.
#[allow(
    clippy::indexing_slicing,
    clippy::panic,
    reason = "evaluated at compile time"
)]
const fn build_slots(with_value: bool) -> [u8; SLOTS] {
    let mut slots = [0u8; SLOTS];
    let mut i = 0;
    while i < ENTRIES.len() {
        let (name, value) = ENTRIES[i];
        let name_hash = bun_wyhash::hash_const(SEED, name) as u32;
        let at = slot(if with_value {
            bun_wyhash::hash_const(name_hash as u64, value) as u32
        } else {
            name_hash
        });
        if slots[at] == 0 {
            slots[at] = i as u8 + 1;
        } else if with_value || !same(ENTRIES[slots[at] as usize - 1].0, name) {
            panic!("two static table entries share a slot");
        }
        i += 1;
    }
    slots
}

static BY_FIELD: [u8; SLOTS] = build_slots(true);
static BY_NAME: [u8; SLOTS] = build_slots(false);

pub(crate) fn find(name: &[u8], value: &[u8], field_hash: u32) -> Option<u32> {
    let index = u32::from(*BY_FIELD.get(slot(field_hash))?);
    (get(index)? == (name, value)).then_some(index)
}

pub(crate) fn find_name(name: &[u8], name_hash: u32) -> Option<u32> {
    let index = u32::from(*BY_NAME.get(slot(name_hash))?);
    (get(index)?.0 == name).then_some(index)
}
