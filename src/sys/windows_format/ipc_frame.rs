//! The frames around what Node.js and Bun send over the pipe between a process and its child.

const HEADER_LEN: usize = 16;
/// `WSAPROTOCOL_INFOW`
pub const SOCKET_INFO_LEN: usize = 628;
/// With an error of `listen` that the sender leaves to the receiver to report.
const SOCKET_LEN: usize = SOCKET_INFO_LEN + 4;

pub const MAX_HEAD_LEN: usize = HEADER_LEN + SOCKET_LEN;

const HAS_DATA: u32 = 1;
const HAS_SOCKET: u32 = 2;
const SOCKET_IS_CONNECTED: u32 = 4;

pub type SocketInfo = [u8; SOCKET_INFO_LEN];

pub struct Socket<'a> {
    pub info: &'a SocketInfo,
    pub is_connected: bool,
}

/// What comes before `data_len` bytes of data. It goes out in one write, as Node.js sends it.
/// Returns how much of `out` it wrote.
pub fn write_head(
    out: &mut [u8; MAX_HEAD_LEN],
    data_len: u32,
    socket: Option<Socket<'_>>,
) -> usize {
    let mut flags = if data_len > 0 { HAS_DATA } else { 0 };
    if let Some(socket) = &socket {
        flags |= HAS_SOCKET
            | if socket.is_connected {
                SOCKET_IS_CONNECTED
            } else {
                0
            };
    }
    for (field, at) in [flags, 0, data_len, 0].into_iter().zip((0..).step_by(4)) {
        out[at..][..4].copy_from_slice(&field.to_le_bytes());
    }
    let Some(socket) = socket else {
        return HEADER_LEN;
    };
    out[HEADER_LEN..][..SOCKET_INFO_LEN].copy_from_slice(socket.info);
    out[HEADER_LEN + SOCKET_INFO_LEN..MAX_HEAD_LEN].fill(0);
    MAX_HEAD_LEN
}

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidFrame;

#[derive(Debug, PartialEq, Eq)]
pub enum Piece<'a> {
    /// Of one frame.
    Data(&'a [u8]),
    Socket(Box<SocketInfo>),
}

#[derive(Default)]
pub struct Decoder {
    /// As much of a header and a socket as has come.
    head: Vec<u8>,
    data_left: usize,
}

impl Decoder {
    /// Takes what comes next off the start of `chunk`. `None` once that is used up.
    pub fn next<'a>(&mut self, chunk: &mut &'a [u8]) -> Result<Option<Piece<'a>>, InvalidFrame> {
        while !chunk.is_empty() {
            if self.data_left > 0 {
                let data;
                (data, *chunk) = chunk.split_at(self.data_left.min(chunk.len()));
                self.data_left -= data.len();
                return Ok(Some(Piece::Data(data)));
            }
            let head;
            (head, *chunk) = chunk.split_at((self.head_len()? - self.head.len()).min(chunk.len()));
            self.head.extend_from_slice(head);
            if self.head.len() == self.head_len()? {
                let socket = self.head[HEADER_LEN..].first_chunk().copied().map(Box::new);
                self.data_left = self.field(2) as usize;
                self.head.clear();
                if let Some(info) = socket {
                    return Ok(Some(Piece::Socket(info)));
                }
            }
        }
        Ok(None)
    }

    fn field(&self, index: usize) -> u32 {
        u32::from_le_bytes(self.head.as_chunks().0[index])
    }

    /// As far as it is known.
    fn head_len(&self) -> Result<usize, InvalidFrame> {
        if self.head.len() < HEADER_LEN {
            return Ok(HEADER_LEN);
        }
        let flags = self.field(0);
        if flags & !(HAS_DATA | HAS_SOCKET | SOCKET_IS_CONNECTED) != 0
            || flags & (HAS_SOCKET | SOCKET_IS_CONNECTED) == SOCKET_IS_CONNECTED
            || (flags & HAS_DATA == 0 && self.field(2) != 0)
            || self.field(3) != 0
        {
            return Err(InvalidFrame);
        }
        Ok(HEADER_LEN
            + if flags & HAS_SOCKET != 0 {
                SOCKET_LEN
            } else {
                0
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(data: &[u8], info: Option<&SocketInfo>) -> Vec<u8> {
        let mut head = [0; MAX_HEAD_LEN];
        let is_connected = true;
        let socket = info.map(|info| Socket { info, is_connected });
        let len = write_head(&mut head, data.len() as u32, socket);
        let mut out = head[..len].to_vec();
        out.extend_from_slice(data);
        out
    }

    fn header(fields: [u32; 4]) -> Vec<u8> {
        fields.into_iter().flat_map(u32::to_le_bytes).collect()
    }

    #[test]
    fn layout() {
        let mut expected = header([1, 0, 2, 0]);
        expected.extend_from_slice(b"hi");
        assert_eq!(frame(b"hi", None), expected);

        let with_socket = frame(b"hi", Some(&[7; SOCKET_INFO_LEN]));
        assert_eq!(with_socket[..16], header([7, 0, 2, 0]));
        assert_eq!(with_socket.len(), 16 + 632 + 2);
        assert_eq!(with_socket[16 + 627..], [7, 0, 0, 0, 0, b'h', b'i']);
    }

    #[test]
    fn round_trip() {
        let stream = [
            frame(b"first", None),
            frame(b"", None),
            frame(b"second", Some(&[1; SOCKET_INFO_LEN])),
            frame(b"", Some(&[2; SOCKET_INFO_LEN])),
            header([HAS_DATA, 99, 0, 0]),
            frame(b"third", None),
        ]
        .concat();
        for size in 1..=stream.len() {
            let (mut decoder, mut data, mut sockets) = (Decoder::default(), vec![], vec![]);
            for mut chunk in stream.chunks(size) {
                while let Some(piece) = decoder.next(&mut chunk).unwrap() {
                    match piece {
                        Piece::Data(piece) => data.extend_from_slice(piece),
                        Piece::Socket(info) => sockets.push((data.len(), info[627])),
                    }
                }
            }
            assert_eq!(data, b"firstsecondthird");
            assert_eq!(sockets, [(5, 1), (11, 2)]);
        }
    }

    #[test]
    fn invalid_headers() {
        for fields in [[8, 0, 0, 0], [5, 0, 1, 0], [0, 0, 1, 0], [1, 0, 1, 1]] {
            let stream = [frame(b"first", None), header(fields)].concat();
            let (mut decoder, mut chunk) = (Decoder::default(), &*stream);
            assert_eq!(decoder.next(&mut chunk), Ok(Some(Piece::Data(b"first"))));
            assert_eq!(decoder.next(&mut chunk), Err(InvalidFrame));
        }
    }
}
