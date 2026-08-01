// Initial handshake packet from server

use crate::mysql::Capabilities;
use crate::mysql::StatusFlags;
use crate::mysql::protocol::CharacterSet;
use crate::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::mysql::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

pub struct HandshakeV10 {
    pub(crate) protocol_version: u8,
    pub server_version: Data,
    pub connection_id: u32,
    pub auth_plugin_data_part_1: [u8; 8],
    pub auth_plugin_data_part_2: Box<[u8]>,
    pub capability_flags: Capabilities,
    pub(crate) character_set: CharacterSet,
    pub status_flags: StatusFlags,
    pub auth_plugin_name: Data,
}

impl Default for HandshakeV10 {
    fn default() -> Self {
        Self {
            protocol_version: 10,
            server_version: Data::empty(),
            connection_id: 0,
            auth_plugin_data_part_1: [0u8; 8],
            auth_plugin_data_part_2: Box::default(),
            capability_flags: Capabilities::default(),
            character_set: CharacterSet::default(),
            status_flags: StatusFlags::default(),
            auth_plugin_name: Data::empty(),
        }
    }
}

impl HandshakeV10 {
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        // Protocol version
        self.protocol_version = reader.int::<u8>()?;
        if self.protocol_version != 10 {
            return Err(AnyMySQLError::UnsupportedProtocolVersion);
        }

        // Server version (null-terminated string)
        self.server_version = reader.read_z()?;

        // Connection ID (4 bytes)
        self.connection_id = reader.int::<u32>()?;

        // Auth plugin data part 1 (8 bytes)
        let auth_data = reader.read(8)?;
        self.auth_plugin_data_part_1
            .copy_from_slice(auth_data.slice());

        // Skip filler byte
        let _ = reader.int::<u8>()?;

        // Capability flags (lower 2 bytes)
        let capabilities_lower = reader.int::<u16>()?;

        // Character set — any byte is valid; unknown collation ids are preserved.
        self.character_set = CharacterSet::from_raw(reader.int::<u8>()?);

        // Status flags
        self.status_flags = StatusFlags::from_int(reader.int::<u16>()?);

        // Capability flags (upper 2 bytes)
        let capabilities_upper = reader.int::<u16>()?;
        self.capability_flags = Capabilities::from_int(
            (u32::from(capabilities_upper) << 16) | u32::from(capabilities_lower),
        );

        // Length of auth plugin data
        let auth_plugin_data_len = reader.int::<u8>()?.max(21);

        // Skip reserved bytes
        reader.skip(10);

        // Auth plugin data part 2
        let remaining_auth_len = auth_plugin_data_len - 8;
        let auth_data_2 = reader.read(remaining_auth_len as usize)?;
        self.auth_plugin_data_part_2 = Box::<[u8]>::from(auth_data_2.slice());

        // Auth plugin name
        if self.capability_flags.CLIENT_PLUGIN_AUTH {
            self.auth_plugin_name = reader.read_z()?;
        }

        Ok(())
    }
}
