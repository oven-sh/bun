//! Framing that Node.js and Bun use on the IPC pipe between a process and its child.

/// Four `u32` fields: flags, reserved, data length, reserved.
const FIXED_HEADER_LEN: usize = 16;
/// `WSAPROTOCOL_INFOW`
pub const SOCKET_INFO_LEN: usize = 628;
/// The socket info, followed by a `u32` delayed `listen` error for the receiver to report.
const SOCKET_TRANSFER_LEN: usize = SOCKET_INFO_LEN + 4;

pub const MAX_HEADER_LEN: usize = FIXED_HEADER_LEN + SOCKET_TRANSFER_LEN;

const HAS_DATA: u32 = 1;
const HAS_SOCKET: u32 = 2;
const SOCKET_IS_CONNECTED: u32 = 4;

pub struct SocketTransfer<'a> {
    pub info: &'a [u8; SOCKET_INFO_LEN],
    pub is_connected: bool,
}

/// Returns the length of the header for `data_len` bytes of data. Send it in a single write, as Node.js does.
pub fn write_header(
    out: &mut [u8; MAX_HEADER_LEN],
    data_len: u32,
    socket: Option<SocketTransfer<'_>>,
) -> usize {
    let mut flags = if data_len > 0 { HAS_DATA } else { 0 };
    if let Some(socket) = &socket {
        flags |= HAS_SOCKET;
        if socket.is_connected {
            flags |= SOCKET_IS_CONNECTED;
        }
    }
    for (field, offset) in [flags, 0, data_len, 0].into_iter().zip((0..).step_by(4)) {
        out[offset..][..4].copy_from_slice(&field.to_le_bytes());
    }
    let Some(socket) = socket else {
        return FIXED_HEADER_LEN;
    };
    out[FIXED_HEADER_LEN..][..SOCKET_INFO_LEN].copy_from_slice(socket.info);
    out[FIXED_HEADER_LEN + SOCKET_INFO_LEN..MAX_HEADER_LEN].fill(0);
    MAX_HEADER_LEN
}

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidFrame;

#[derive(Debug, PartialEq, Eq)]
pub enum Item<'a> {
    /// All or part of the data of a single frame.
    Data(&'a [u8]),
    Socket(Box<[u8; SOCKET_INFO_LEN]>),
}

#[derive(Default)]
pub struct Decoder {
    /// The header bytes received so far.
    header: Vec<u8>,
    remaining_data_len: usize,
}

impl Decoder {
    /// Consumes the next item from the front of `chunk`. `None` once `chunk` is empty.
    pub fn decode<'a>(&mut self, chunk: &mut &'a [u8]) -> Result<Option<Item<'a>>, InvalidFrame> {
        while !chunk.is_empty() {
            if self.remaining_data_len > 0 {
                let data;
                (data, *chunk) = chunk.split_at(self.remaining_data_len.min(chunk.len()));
                self.remaining_data_len -= data.len();
                return Ok(Some(Item::Data(data)));
            }
            let missing_len = self.expected_header_len()? - self.header.len();
            let header_bytes;
            (header_bytes, *chunk) = chunk.split_at(missing_len.min(chunk.len()));
            self.header.extend_from_slice(header_bytes);
            if self.header.len() == self.expected_header_len()? {
                let socket_info = self.header[FIXED_HEADER_LEN..]
                    .first_chunk()
                    .copied()
                    .map(Box::new);
                self.remaining_data_len = self.header_field(2) as usize;
                self.header.clear();
                if let Some(info) = socket_info {
                    return Ok(Some(Item::Socket(info)));
                }
            }
        }
        Ok(None)
    }

    fn header_field(&self, index: usize) -> u32 {
        u32::from_le_bytes(self.header.as_chunks().0[index])
    }

    /// `FIXED_HEADER_LEN` until the fixed header is complete.
    fn expected_header_len(&self) -> Result<usize, InvalidFrame> {
        if self.header.len() < FIXED_HEADER_LEN {
            return Ok(FIXED_HEADER_LEN);
        }
        let flags = self.header_field(0);
        if flags & !(HAS_DATA | HAS_SOCKET | SOCKET_IS_CONNECTED) != 0
            || flags & (HAS_SOCKET | SOCKET_IS_CONNECTED) == SOCKET_IS_CONNECTED
            || (flags & HAS_DATA == 0 && self.header_field(2) != 0)
            || self.header_field(3) != 0
        {
            return Err(InvalidFrame);
        }
        Ok(if flags & HAS_SOCKET != 0 {
            MAX_HEADER_LEN
        } else {
            FIXED_HEADER_LEN
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_frame(data: &[u8], info: Option<&[u8; SOCKET_INFO_LEN]>) -> Vec<u8> {
        let mut header = [0; MAX_HEADER_LEN];
        let is_connected = true;
        let socket = info.map(|info| SocketTransfer { info, is_connected });
        let len = write_header(&mut header, data.len() as u32, socket);
        let mut out = header[..len].to_vec();
        out.extend_from_slice(data);
        out
    }

    fn encode_fixed_header(fields: [u32; 4]) -> Vec<u8> {
        fields.into_iter().flat_map(u32::to_le_bytes).collect()
    }

    #[test]
    fn writes_header_layout() {
        let mut expected = encode_fixed_header([1, 0, 2, 0]);
        expected.extend_from_slice(b"hi");
        assert_eq!(encode_frame(b"hi", None), expected);

        let socket_frame = encode_frame(b"hi", Some(&[7; SOCKET_INFO_LEN]));
        assert_eq!(socket_frame[..16], encode_fixed_header([7, 0, 2, 0]));
        assert_eq!(socket_frame.len(), 16 + 632 + 2);
        assert_eq!(socket_frame[16 + 627..], [7, 0, 0, 0, 0, b'h', b'i']);
    }

    #[test]
    fn round_trips_with_every_chunk_size() {
        let stream = [
            encode_frame(b"first", None),
            encode_frame(b"", None),
            encode_frame(b"second", Some(&[1; SOCKET_INFO_LEN])),
            encode_frame(b"", Some(&[2; SOCKET_INFO_LEN])),
            encode_fixed_header([HAS_DATA, 99, 0, 0]),
            encode_frame(b"third", None),
        ]
        .concat();
        for chunk_size in 1..=stream.len() {
            let mut decoder = Decoder::default();
            let mut data = vec![];
            let mut sockets = vec![];
            for mut chunk in stream.chunks(chunk_size) {
                while let Some(item) = decoder.decode(&mut chunk).unwrap() {
                    match item {
                        Item::Data(bytes) => data.extend_from_slice(bytes),
                        Item::Socket(info) => sockets.push((data.len(), info[627])),
                    }
                }
            }
            assert_eq!(data, b"firstsecondthird");
            assert_eq!(sockets, [(5, 1), (11, 2)]);
        }
    }

    #[test]
    fn reports_invalid_header() {
        for fields in [[8, 0, 0, 0], [5, 0, 1, 0], [0, 0, 1, 0], [1, 0, 1, 1]] {
            let stream = [encode_frame(b"first", None), encode_fixed_header(fields)].concat();
            let mut decoder = Decoder::default();
            let mut chunk = &*stream;
            assert_eq!(decoder.decode(&mut chunk), Ok(Some(Item::Data(b"first"))));
            assert_eq!(decoder.decode(&mut chunk), Err(InvalidFrame));
        }
    }
}
