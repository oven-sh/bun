// Auth switch response packet

use crate::mysql::protocol::new_writer::NewWriter;
use crate::shared::Data;

#[derive(Default)]
pub struct AuthSwitchResponse {
    pub auth_response: Data,
}

// `Data: Drop` cleans up `auth_response` automatically, so no explicit
// `impl Drop` is needed here.

impl AuthSwitchResponse {
    pub fn write_internal<C: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> crate::Result<()> {
        writer.write(self.auth_response.slice())?;
        Ok(())
    }
}
