// https://dev.mysql.com/doc/dev/mysql-server/8.4.6/page_protocol_connection_phase_packets_protocol_ssl_request.html
// SSLRequest

use crate::mysql::Capabilities;
use crate::mysql::protocol::character_set::CharacterSet;
use crate::mysql::protocol::new_writer::{NewWriter, write_wrap};

bun_core::declare_scope!(MySQLConnection, hidden);

pub struct SSLRequest {
    pub capability_flags: Capabilities,
    /// 16MB default
    pub max_packet_size: u32,
    pub character_set: CharacterSet,
    pub has_connection_attributes: bool,
}

impl Default for SSLRequest {
    fn default() -> Self {
        Self {
            // TODO(port): capability_flags has no Zig default; caller must set it
            capability_flags: Capabilities::default(),
            max_packet_size: 0xFFFFFF, // 16MB default
            character_set: CharacterSet::default(),
            has_connection_attributes: false,
        }
    }
}

impl SSLRequest {
    // Zig: pub fn deinit(_: *SSLRequest) void {}
    // Empty deinit → no Drop impl needed.

    // TODO(port): narrow error set
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &mut self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        let mut packet = writer.start(1)?;

        self.capability_flags.CLIENT_CONNECT_ATTRS = self.has_connection_attributes;

        // Write client capabilities flags (4 bytes)
        let caps = self.capability_flags.to_int();
        writer.int4(caps)?;
        bun_core::scoped_log!(
            MySQLConnection,
            "Client capabilities: [{}] 0x{:08x}",
            self.capability_flags,
            caps
        );

        // Write max packet size (4 bytes)
        writer.int4(self.max_packet_size)?;

        // Write character set (1 byte)
        writer.int1(self.character_set as u8)?;

        // Write 23 bytes of padding
        writer.write(&[0u8; 23])?;

        packet.end()?;
        Ok(())
    }

    // Zig `writeWrap(@This(), ...)` — see src/sql/mysql/protocol/NewWriter.rs
}

// ported from: src/sql/mysql/protocol/SSLRequest.zig
