use bun_core::strings;

use super::stack_reader::PacketReader;
use crate::shared::Data;

pub struct AuthSwitchRequest {
    pub header: u8,
    pub plugin_name: Data,
    pub plugin_data: Data,
}

impl Default for AuthSwitchRequest {
    fn default() -> Self {
        Self {
            header: 0xfe,
            plugin_name: Data::Empty,
            plugin_data: Data::Empty,
        }
    }
}

// NOTE: `Data` owns its own cleanup via `Drop`, so no explicit `impl Drop` is needed here.

impl AuthSwitchRequest {
    pub fn decode_internal(&mut self, reader: PacketReader<'_>) -> crate::Result<()> {
        self.header = reader.int::<u8>()?;
        if self.header != 0xfe {
            return Err(crate::Error::InvalidAuthSwitchRequest);
        }

        let remaining = reader.read(reader.peek().len())?;
        let remaining_slice = remaining.slice();
        debug_assert!(matches!(remaining, Data::Temporary(_)));

        if let Some(zero) = strings::index_of_char(remaining_slice, 0) {
            let zero = zero as usize;
            // EOF String
            self.plugin_name = Data::Temporary(bun_ptr::RawSlice::new(&remaining_slice[0..zero]));
            // End Of The Packet String
            self.plugin_data =
                Data::Temporary(bun_ptr::RawSlice::new(&remaining_slice[zero + 1..]));
            return Ok(());
        }
        Err(crate::Error::InvalidAuthSwitchRequest)
    }
}
