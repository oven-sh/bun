// Client authentication response

use crate::mysql::capabilities::Capabilities;
use crate::shared::data::Data;
use super::character_set::CharacterSet;
use super::encode_int::encode_length_int;
use super::new_writer::{NewWriter, write_wrap};
use bun_collections::StringHashMap;

bun_output::declare_scope!(MySQLConnection, hidden);

pub struct HandshakeResponse41 {
    pub capability_flags: Capabilities,
    pub max_packet_size: u32,   // default: 0xFFFFFF (16MB)
    pub character_set: CharacterSet, // default: CharacterSet::default()
    pub username: Data,
    pub auth_response: Data,
    pub database: Data,
    pub auth_plugin_name: Data,
    pub connect_attrs: StringHashMap<Box<[u8]>>, // default: empty
    pub sequence_id: u8,
}

// Zig `deinit` only freed owned fields (Data values + connect_attrs keys/values).
// In Rust, `Data: Drop` and `StringHashMap<Box<[u8]>>: Drop` handle this automatically,
// so no explicit `impl Drop` is needed.

impl HandshakeResponse41 {
    pub fn write_internal<Context>(
        &mut self,
        mut writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut packet = writer.start(self.sequence_id)?;

        self.capability_flags.client_connect_attrs = self.connect_attrs.len() > 0;

        // Write client capabilities flags (4 bytes)
        let caps = self.capability_flags.to_int();
        writer.int4(caps)?;
        bun_output::scoped_log!(
            MySQLConnection,
            "Client capabilities: [{}] 0x{:08x} sequence_id: {}",
            self.capability_flags,
            caps,
            self.sequence_id
        );

        // Write max packet size (4 bytes)
        writer.int4(self.max_packet_size)?;

        // Write character set (1 byte)
        writer.int1(self.character_set as u8)?;

        // Write 23 bytes of padding
        writer.write(&[0u8; 23])?;

        // Write username (null terminated)
        writer.write_z(self.username.slice())?;

        // Write auth response based on capabilities
        let auth_data = self.auth_response.slice();
        if self.capability_flags.client_plugin_auth_lenenc_client_data {
            writer.write_length_encoded_string(auth_data)?;
        } else if self.capability_flags.client_secure_connection {
            writer.int1(u8::try_from(auth_data.len()).unwrap())?;
            writer.write(auth_data)?;
        } else {
            writer.write_z(auth_data)?;
        }

        // Write database name if requested
        if self.capability_flags.client_connect_with_db && self.database.slice().len() > 0 {
            writer.write_z(self.database.slice())?;
        }

        // Write auth plugin name if supported
        if self.capability_flags.client_plugin_auth {
            writer.write_z(self.auth_plugin_name.slice())?;
        }

        // Write connect attributes if enabled
        if self.capability_flags.client_connect_attrs {
            let mut total_length: usize = 0;
            for (key, value) in self.connect_attrs.iter() {
                total_length += encode_length_int(key.len()).len();
                total_length += key.len();
                total_length += encode_length_int(value.len()).len();
                total_length += value.len();
            }

            writer.write_length_encoded_int(total_length)?;

            for (key, value) in self.connect_attrs.iter() {
                writer.write_length_encoded_string(key)?;
                writer.write_length_encoded_string(value)?;
            }
        }

        if self.capability_flags.client_zstd_compression_algorithm {
            // writer.write_int::<u8>(self.zstd_compression_algorithm)?;
            debug_assert!(false, "zstd compression algorithm is not supported");
        }

        packet.end()?;
        Ok(())
    }

    // TODO(port): Zig `pub const write = writeWrap(HandshakeResponse41, writeInternal).write;`
    // is a comptime-generated wrapper. Approximated here as a direct delegating method;
    // verify against the ported `write_wrap` signature in Phase B.
    pub fn write<Context>(
        &mut self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        write_wrap(self, Self::write_internal, writer)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/HandshakeResponse41.zig (109 lines)
//   confidence: medium
//   todos:      2
//   notes:      Capabilities field access assumes named bool fields (not bitflags getters); write_wrap signature guessed; struct field defaults noted in comments only.
// ──────────────────────────────────────────────────────────────────────────
