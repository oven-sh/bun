// Auth switch response packet

use bun_sql::shared::Data;
use bun_sql::mysql::protocol::new_writer::{NewWriter, write_wrap};

#[derive(Default)]
pub struct AuthSwitchResponse {
    pub auth_response: Data, // = .{ .empty = {} } → Data::default()
}

// Zig `deinit` only forwarded to `self.auth_response.deinit()`; `Data: Drop` handles
// that automatically, so no explicit `impl Drop` is needed here.

impl AuthSwitchResponse {
    pub fn write_internal<C>(&self, writer: NewWriter<C>) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        writer.write(self.auth_response.slice())?;
        Ok(())
    }
}

// TODO(port): `writeWrap(AuthSwitchResponse, writeInternal).write` is a comptime-generated
// wrapper fn. Phase B: express as a macro or blanket-trait impl from new_writer.
write_wrap!(AuthSwitchResponse, write_internal);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/AuthSwitchResponse.zig (18 lines)
//   confidence: medium
//   todos:      2
//   notes:      write_wrap comptime adapter needs Rust-side macro/trait in new_writer
// ──────────────────────────────────────────────────────────────────────────
