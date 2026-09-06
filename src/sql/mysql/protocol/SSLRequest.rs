// https://dev.mysql.com/doc/dev/mysql-server/8.4.6/page_protocol_connection_phase_packets_protocol_ssl_request.html
// SSLRequest

use crate::mysql::Capabilities;
use crate::mysql::capabilities::MariaDBCapabilities;
use crate::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::mysql::protocol::character_set::CharacterSet;
use crate::mysql::protocol::new_writer::NewWriter;

bun_core::declare_scope!(MySQLConnection, hidden);

pub struct SSLRequest {
    pub capability_flags: Capabilities,
    pub mariadb_capability_flags: MariaDBCapabilities,
    /// 16MB default
    pub max_packet_size: u32,
    pub character_set: CharacterSet,
    pub has_connection_attributes: bool,
}

impl SSLRequest {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &mut self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), AnyMySQLError> {
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
        writer.int1(self.character_set.to_int())?;

        // Same padding layout as HandshakeResponse41: the SSLRequest is that
        // packet's prefix and the server reads its capability bytes the same way.
        writer.write(&[0u8; 19])?;
        writer.int4(self.mariadb_capability_flags.to_int())?;

        packet.end()?;
        Ok(())
    }
}
