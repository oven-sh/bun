// Auth switch response packet

use crate::mysql::protocol::new_writer::{NewWriter, write_wrap};
use crate::shared::Data;

#[derive(Default)]
pub struct AuthSwitchResponse {
    pub auth_response: Data, // = .{ .empty = {} } → Data::default()
}

// Zig `deinit` only forwarded to `self.auth_response.deinit()`; `Data: Drop` handles
// that automatically, so no explicit `impl Drop` is needed here.

impl AuthSwitchResponse {
    pub fn write_internal<C: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        writer.write(self.auth_response.slice())?;
        Ok(())
    }

    // Zig: `pub const write = writeWrap(AuthSwitchResponse, writeInternal).write;`
    pub fn write<C: super::new_writer::WriterContext>(
        &self,
        context: C,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(NewWriter { wrapped: context })
    }
}

// ported from: src/sql/mysql/protocol/AuthSwitchResponse.zig
