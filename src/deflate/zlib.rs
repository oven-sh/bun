//! What RFC 1950 puts around a stream.

pub(crate) const HEADER_LEN: usize = 2;

pub(crate) fn header(level: u8) -> [u8; HEADER_LEN] {
    const METHOD_AND_WINDOW: u16 = 0x78;
    let effort = match level {
        ..2 => 0,
        2..6 => 1,
        6..8 => 2,
        _ => 3,
    };
    let header = (METHOD_AND_WINDOW << 8) | (effort << 6);
    header.next_multiple_of(31).to_be_bytes()
}

pub(crate) fn trailer(data: &[u8]) -> [u8; 4] {
    bun_highway::adler32(data).to_be_bytes()
}
