// Client authentication response

use super::character_set::CharacterSet;
use super::encode_int::encode_length_int;
use super::new_writer::{NewWriter, write_wrap};
use crate::mysql::capabilities::Capabilities;
use crate::shared::data::Data;
use bun_collections::StringHashMap;

bun_core::declare_scope!(MySQLConnection, hidden);

pub struct HandshakeResponse41 {
    pub capability_flags: Capabilities,
    pub max_packet_size: u32,        // default: 0xFFFFFF (16MB)
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
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &mut self,
        mut writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut packet = writer.start(self.sequence_id)?;

        self.capability_flags.CLIENT_CONNECT_ATTRS = self.connect_attrs.len() > 0;

        // Write client capabilities flags (4 bytes)
        let caps = self.capability_flags.to_int();
        writer.int4(caps)?;
        bun_core::scoped_log!(
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
        if self.capability_flags.CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA {
            writer.write_length_encoded_string(auth_data)?;
        } else if self.capability_flags.CLIENT_SECURE_CONNECTION {
            writer.int1(u8::try_from(auth_data.len()).expect("int cast"))?;
            writer.write(auth_data)?;
        } else {
            writer.write_z(auth_data)?;
        }

        // Write database name if requested
        if self.capability_flags.CLIENT_CONNECT_WITH_DB && self.database.slice().len() > 0 {
            writer.write_z(self.database.slice())?;
        }

        // Write auth plugin name if supported
        if self.capability_flags.CLIENT_PLUGIN_AUTH {
            writer.write_z(self.auth_plugin_name.slice())?;
        }

        // Write connect attributes if enabled
        if self.capability_flags.CLIENT_CONNECT_ATTRS {
            let mut total_length: usize = 0;
            for (key, value) in self.connect_attrs.iter() {
                total_length += encode_length_int(key.len() as u64).len();
                total_length += key.len();
                total_length += encode_length_int(value.len() as u64).len();
                total_length += value.len();
            }

            writer.write_length_encoded_int(total_length as u64)?;

            for (key, value) in self.connect_attrs.iter() {
                writer.write_length_encoded_string(key)?;
                writer.write_length_encoded_string(value)?;
            }
        }

        if self.capability_flags.CLIENT_ZSTD_COMPRESSION_ALGORITHM {
            // writer.write_int::<u8>(self.zstd_compression_algorithm)?;
            debug_assert!(false, "zstd compression algorithm is not supported");
        }

        packet.end()?;
        Ok(())
    }

    // Zig `writeWrap(@This(), ...)` — see src/sql/mysql/protocol/NewWriter.rs
    pub fn write<Context: super::new_writer::WriterContext>(
        &mut self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}

// ported from: src/sql/mysql/protocol/HandshakeResponse41.zig
