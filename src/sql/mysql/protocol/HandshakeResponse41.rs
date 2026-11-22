// Client authentication response

use super::any_mysql_error::Error as AnyMySQLError;
use super::encode_int::encode_length_int;
use super::packet_writer::PacketWriter;
use crate::mysql::auth_method::AuthResponse;
use crate::mysql::capabilities::{Capabilities, MariaDBCapabilities};

const UTF8MB4_GENERAL_CI: u8 = 45;

const CONNECT_ATTRIBUTES: [&[u8]; 4] = [
    b"_client_version",
    bun_core::Global::package_json_version_with_revision.as_bytes(),
    b"_client_name",
    b"Bun",
];

/// https://mariadb.com/kb/en/connection/#handshake-response-packet
fn start(
    capability_flags: Capabilities,
    mariadb_capability_flags: MariaDBCapabilities,
    sequence_id: u8,
    out: &mut Vec<u8>,
) -> PacketWriter<'_> {
    let mut packet = PacketWriter::start(out, sequence_id);
    packet.int4(capability_flags.to_int());
    packet.int4(0); // max packet size
    packet.int1(UTF8MB4_GENERAL_CI);
    // 23 bytes of filler, of which MariaDB reads the last 4.
    packet.write(&[0u8; 19]);
    packet.int4(mariadb_capability_flags.to_int());
    packet
}

/// https://dev.mysql.com/doc/dev/mysql-server/8.4.6/page_protocol_connection_phase_packets_protocol_ssl_request.html
pub(crate) fn write_ssl_request(
    capability_flags: Capabilities,
    mariadb_capability_flags: MariaDBCapabilities,
    out: &mut Vec<u8>,
) {
    start(capability_flags, mariadb_capability_flags, 1, out).end();
}

pub(crate) struct HandshakeResponse41<'a> {
    pub(crate) capability_flags: Capabilities,
    pub(crate) mariadb_capability_flags: MariaDBCapabilities,
    pub(crate) username: &'a [u8],
    pub(crate) auth_response: AuthResponse<'a>,
    pub(crate) database: &'a [u8],
    pub(crate) auth_plugin_name: &'a [u8],
    pub(crate) sequence_id: u8,
}

impl HandshakeResponse41<'_> {
    pub(crate) fn write(&self, out: &mut Vec<u8>) -> Result<(), AnyMySQLError> {
        let mut packet = start(
            self.capability_flags,
            self.mariadb_capability_flags,
            self.sequence_id,
            out,
        );
        packet.write_z(self.username);

        if self.capability_flags.CLIENT_SECURE_CONNECTION {
            packet
                .int1(u8::try_from(self.auth_response.len()).map_err(|_| AnyMySQLError::Overflow)?);
            self.auth_response.write(&mut packet);
        } else {
            self.auth_response.write(&mut packet);
            packet.int1(0);
        }

        if self.capability_flags.CLIENT_CONNECT_WITH_DB {
            packet.write_z(self.database);
        }

        if self.capability_flags.CLIENT_PLUGIN_AUTH {
            packet.write_z(self.auth_plugin_name);
        }

        let attributes_length: usize = CONNECT_ATTRIBUTES
            .iter()
            .map(|text| encode_length_int(text.len() as u64).len() + text.len())
            .sum();
        packet.write_length_encoded_int(attributes_length as u64);
        for text in CONNECT_ATTRIBUTES {
            packet.write_length_encoded_string(text);
        }

        packet.end();
        Ok(())
    }
}
