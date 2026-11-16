use bun_core::strings;

use super::packet_reader::PacketReader;

pub struct AuthSwitchRequest<'a> {
    pub header: u8,
    pub plugin_name: &'a [u8],
    pub plugin_data: &'a [u8],
}

impl Default for AuthSwitchRequest<'_> {
    fn default() -> Self {
        Self {
            header: 0xfe,
            plugin_name: b"",
            plugin_data: b"",
        }
    }
}

impl<'a> AuthSwitchRequest<'a> {
    pub fn decode_internal(&mut self, reader: PacketReader<'a>) -> crate::Result<()> {
        self.header = reader.int::<u8>()?;
        if self.header != 0xfe {
            return Err(crate::Error::InvalidAuthSwitchRequest);
        }

        let remaining = reader.read(reader.peek().len())?;

        if let Some(zero) = strings::index_of_char(remaining, 0) {
            let zero = zero as usize;
            // EOF String
            self.plugin_name = &remaining[0..zero];
            // End Of The Packet String
            self.plugin_data = &remaining[zero + 1..];
            return Ok(());
        }
        Err(crate::Error::InvalidAuthSwitchRequest)
    }
}
