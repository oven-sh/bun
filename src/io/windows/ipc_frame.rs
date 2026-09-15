//! The framing Node.js-compatible IPC pipes carry on Windows. It is libuv's
//! (`uv_pipe_t` opened with `ipc = 1`), so a Bun process and a Node process on
//! either end of a channel agree on it byte for byte:
//!
//! ```text
//! frame  := header [socket_transfer] [data]
//! header := u32 flags, u32 reserved1, u32 data_length, u32 reserved2   (little-endian)
//! ```
//!
//! `reserved2` must be zero, `data_length` must be zero without
//! [`FLAG_HAS_DATA`], and [`FLAG_TRANSFER_IS_CONNECTION`] is only valid with
//! [`FLAG_HAS_SOCKET_TRANSFER`]. A socket transfer is a `WSAPROTOCOL_INFOW`
//! from `WSADuplicateSocketW` followed by the sender's deferred listen error.
//! Frame boundaries mean nothing to the payload, which is one byte stream.

pub const HEADER_LEN: usize = 16;
pub const SOCKET_TRANSFER_LEN: usize = 632;
/// Offset of the `u32` deferred error inside a socket transfer.
pub const SOCKET_TRANSFER_PROTOCOL_INFO_LEN: usize = 628;

pub const FLAG_HAS_DATA: u32 = 0x01;
pub const FLAG_HAS_SOCKET_TRANSFER: u32 = 0x02;
pub const FLAG_TRANSFER_IS_CONNECTION: u32 = 0x04;
const VALID_FLAGS: u32 = 0x07;

/// The header of a frame that carries `data_len` payload bytes and no socket.
/// Header and payload must reach the pipe in one write so frames from
/// different writers cannot interleave.
pub fn data_header(data_len: u32) -> [u8; HEADER_LEN] {
    let mut header = [0u8; HEADER_LEN];
    let flags = if data_len == 0 { 0 } else { FLAG_HAS_DATA };
    header[0..4].copy_from_slice(&flags.to_le_bytes());
    header[8..12].copy_from_slice(&data_len.to_le_bytes());
    header
}

/// The peer broke the framing; the channel cannot be resynchronized.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidFrame;

pub enum Event<'a> {
    /// The next bytes of the payload stream.
    Data(&'a [u8]),
    /// A socket the peer handed over. It exists as soon as the peer sent it:
    /// a receiver that does not want it still has to materialize it
    /// (`WSASocketW(FROM_PROTOCOL_INFO…)`) and close it.
    SocketTransfer {
        info: &'a [u8; SOCKET_TRANSFER_LEN],
        is_connection: bool,
    },
}

/// Incremental decoder for the receiving side. Input may be split anywhere.
pub struct Decoder {
    header: [u8; HEADER_LEN],
    header_len: usize,
    transfer: Option<Box<[u8; SOCKET_TRANSFER_LEN]>>,
    transfer_len: usize,
    transfer_remaining: usize,
    transfer_is_connection: bool,
    payload_remaining: usize,
}

impl Default for Decoder {
    fn default() -> Self {
        Self::new()
    }
}

impl Decoder {
    pub const fn new() -> Self {
        Self {
            header: [0; HEADER_LEN],
            header_len: 0,
            transfer: None,
            transfer_len: 0,
            transfer_remaining: 0,
            transfer_is_connection: false,
            payload_remaining: 0,
        }
    }

    /// Decode `input`, handing each piece to `sink` in wire order.
    pub fn feed(
        &mut self,
        mut input: &[u8],
        mut sink: impl FnMut(Event<'_>),
    ) -> Result<(), InvalidFrame> {
        while !input.is_empty() {
            if self.transfer_remaining > 0 {
                let take = self.transfer_remaining.min(input.len());
                let transfer = self
                    .transfer
                    .get_or_insert_with(|| Box::new([0; SOCKET_TRANSFER_LEN]));
                transfer[self.transfer_len..self.transfer_len + take]
                    .copy_from_slice(&input[..take]);
                self.transfer_len += take;
                self.transfer_remaining -= take;
                input = &input[take..];
                if self.transfer_remaining == 0 {
                    self.transfer_len = 0;
                    sink(Event::SocketTransfer {
                        info: transfer,
                        is_connection: self.transfer_is_connection,
                    });
                }
                continue;
            }
            if self.payload_remaining > 0 {
                let take = self.payload_remaining.min(input.len());
                sink(Event::Data(&input[..take]));
                self.payload_remaining -= take;
                input = &input[take..];
                continue;
            }

            let take = (HEADER_LEN - self.header_len).min(input.len());
            self.header[self.header_len..self.header_len + take].copy_from_slice(&input[..take]);
            self.header_len += take;
            input = &input[take..];
            if self.header_len < HEADER_LEN {
                break;
            }
            self.header_len = 0;

            let field = |index: usize| {
                let mut bytes = [0u8; 4];
                bytes.copy_from_slice(&self.header[index * 4..index * 4 + 4]);
                u32::from_le_bytes(bytes)
            };
            let (flags, data_length, reserved2) = (field(0), field(2), field(3));
            if flags & !VALID_FLAGS != 0
                || reserved2 != 0
                || (flags & FLAG_TRANSFER_IS_CONNECTION != 0
                    && flags & FLAG_HAS_SOCKET_TRANSFER == 0)
                || (flags & FLAG_HAS_DATA == 0 && data_length != 0)
            {
                return Err(InvalidFrame);
            }
            if flags & FLAG_HAS_SOCKET_TRANSFER != 0 {
                self.transfer_remaining = SOCKET_TRANSFER_LEN;
                self.transfer_is_connection = flags & FLAG_TRANSFER_IS_CONNECTION != 0;
            }
            self.payload_remaining = data_length as usize;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(decoder: &mut Decoder, input: &[u8]) -> Result<(Vec<u8>, usize), InvalidFrame> {
        let mut data = Vec::new();
        let mut sockets = 0;
        decoder.feed(input, |event| match event {
            Event::Data(bytes) => data.extend_from_slice(bytes),
            Event::SocketTransfer { .. } => sockets += 1,
        })?;
        Ok((data, sockets))
    }

    #[test]
    fn round_trips_data_split_anywhere() {
        let mut wire = Vec::new();
        wire.extend_from_slice(&data_header(5));
        wire.extend_from_slice(b"hello");
        wire.extend_from_slice(&data_header(0));
        wire.extend_from_slice(&data_header(6));
        wire.extend_from_slice(b" world");
        for split in 0..wire.len() {
            let mut decoder = Decoder::new();
            let (mut data, _) = collect(&mut decoder, &wire[..split]).unwrap();
            data.extend(collect(&mut decoder, &wire[split..]).unwrap().0);
            assert_eq!(data, b"hello world");
        }
    }

    #[test]
    fn socket_transfer_precedes_its_data() {
        let mut wire = Vec::new();
        let mut header = data_header(2);
        header[0] = (FLAG_HAS_DATA | FLAG_HAS_SOCKET_TRANSFER | FLAG_TRANSFER_IS_CONNECTION) as u8;
        wire.extend_from_slice(&header);
        wire.extend_from_slice(&[7u8; SOCKET_TRANSFER_LEN]);
        wire.extend_from_slice(b"ok");
        let mut decoder = Decoder::new();
        let mut order = Vec::new();
        decoder
            .feed(&wire, |event| match event {
                Event::Data(bytes) => order.push(bytes.len()),
                Event::SocketTransfer {
                    info,
                    is_connection,
                } => {
                    assert!(is_connection);
                    assert_eq!(info[0], 7);
                    order.push(usize::MAX);
                }
            })
            .unwrap();
        assert_eq!(order, [usize::MAX, 2]);
    }

    #[test]
    fn rejects_bad_headers() {
        let mut unknown_flag = data_header(1);
        unknown_flag[0] = 0x08;
        let mut reserved = data_header(1);
        reserved[12] = 1;
        let mut connection_without_transfer = data_header(1);
        connection_without_transfer[0] = (FLAG_HAS_DATA | FLAG_TRANSFER_IS_CONNECTION) as u8;
        let mut length_without_data = data_header(1);
        length_without_data[0] = 0;
        for header in [
            unknown_flag,
            reserved,
            connection_without_transfer,
            length_without_data,
        ] {
            assert_eq!(collect(&mut Decoder::new(), &header), Err(InvalidFrame),);
        }
    }
}
