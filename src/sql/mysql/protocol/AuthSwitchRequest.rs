use bun_core::strings;

use super::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

pub struct AuthSwitchRequest {
    pub header: u8,
    pub plugin_name: Data,
    pub plugin_data: Data,
    // TODO(port): Zig u24 — no native Rust u24; using u32 (value always fits in 24 bits)
    pub packet_size: u32,
}

impl Default for AuthSwitchRequest {
    fn default() -> Self {
        Self {
            header: 0xfe,
            plugin_name: Data::Empty,
            plugin_data: Data::Empty,
            packet_size: 0,
        }
    }
}

// NOTE: Zig `deinit` only called `plugin_name.deinit()` / `plugin_data.deinit()`.
// `Data` owns its own cleanup via `Drop`, so no explicit `impl Drop` is needed here.

impl AuthSwitchRequest {
    // TODO(port): narrow error set (Zig: error.InvalidAuthSwitchRequest + reader errors)
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        self.header = reader.int::<u8>()?;
        if self.header != 0xfe {
            return Err(bun_core::err!("InvalidAuthSwitchRequest"));
        }

        let remaining = reader.read((self.packet_size - 1) as usize)?;
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
        Err(bun_core::err!("InvalidAuthSwitchRequest"))
    }
}

// Zig: `pub const decode = decoderWrap(AuthSwitchRequest, decodeInternal).decode;`
impl AuthSwitchRequest {
    pub fn decode<Context: ReaderContext>(
        &mut self,
        context: Context,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/mysql/protocol/AuthSwitchRequest.zig
