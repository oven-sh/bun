#![allow(non_snake_case, non_camel_case_types)]
#![warn(unused_must_use)]

pub mod error;
pub use error::{Error, Result};

pub mod shared {
    #[path = "ColumnIdentifier.rs"]
    pub mod column_identifier;
    #[path = "ConnectionFlags.rs"]
    pub mod connection_flags;
    #[path = "SQLQueryResultMode.rs"]
    pub mod sql_query_result_mode;
    #[path = "SSLMode.rs"]
    pub mod ssl_mode;
    #[path = "StackReader.rs"]
    pub(crate) mod stack_reader;

    pub use column_identifier::ColumnIdentifier;
    pub use connection_flags::ConnectionFlags;
    pub use sql_query_result_mode::SQLQueryResultMode;
    pub use ssl_mode::SSLMode;
}

pub mod mysql {
    #[path = "AuthMethod.rs"]
    pub mod auth_method;
    #[path = "Capabilities.rs"]
    pub(crate) mod capabilities;
    #[path = "MySQLQueryResult.rs"]
    pub mod mysql_query_result;
    #[path = "MySQLRequest.rs"]
    pub mod mysql_request;
    #[path = "MySQLTypes.rs"]
    pub mod mysql_types;
    #[path = "Session.rs"]
    pub mod session;
    #[path = "StatusFlags.rs"]
    pub(crate) mod status_flags;

    pub mod protocol {
        #[path = "AnyMySQLError.rs"]
        pub mod any_mysql_error;
        #[path = "CommandType.rs"]
        pub(crate) mod command_type;
        #[path = "EncodeInt.rs"]
        pub mod encode_int;
        #[path = "PacketHeader.rs"]
        pub(crate) mod packet_header;
        #[path = "PacketType.rs"]
        pub(crate) mod packet_type;

        #[path = "Auth.rs"]
        pub(crate) mod auth;
        #[path = "AuthSwitchRequest.rs"]
        pub(crate) mod auth_switch_request;
        #[path = "ColumnDefinition41.rs"]
        pub mod column_definition41;
        #[path = "EOFPacket.rs"]
        pub(crate) mod eof_packet;
        #[path = "ErrorPacket.rs"]
        pub mod error_packet;
        #[path = "HandshakeResponse41.rs"]
        pub(crate) mod handshake_response41;
        #[path = "HandshakeV10.rs"]
        pub(crate) mod handshake_v10;
        #[path = "OKPacket.rs"]
        pub(crate) mod ok_packet;
        #[path = "PacketReader.rs"]
        pub mod packet_reader;
        #[path = "PacketWriter.rs"]
        pub mod packet_writer;
        #[path = "PreparedStatement.rs"]
        pub mod prepared_statement;
        #[path = "StmtPrepareOKPacket.rs"]
        pub(crate) mod stmt_prepare_ok_packet;

        // ── flat re-exports for `bun_sql_jsc` ──────────────────────────────
        // sql_jsc names most of these via `bun_sql::mysql::protocol::Foo`,
        // so surface them here as well as via their leaf modules.
        pub use column_definition41::ColumnDefinition41;
        // `protocol::FieldType` (re-export of mysql_types.FieldType).
        pub use crate::mysql::mysql_types::FieldType;
    }

    pub(crate) use capabilities::Capabilities;
    pub use mysql_query_result::MySQLQueryResult;
    pub(crate) use status_flags::StatusFlags;
}

pub mod postgres {
    #[path = "AnyPostgresError.rs"]
    pub mod any_postgres_error;
    #[path = "CommandTag.rs"]
    pub mod command_tag;
    pub mod frontend;
    pub mod handshake;
    pub mod pipeline;
    #[path = "PostgresProtocol.rs"]
    pub mod postgres_protocol;
    #[path = "PostgresTypes.rs"]
    pub mod postgres_types;
    #[path = "SocketMonitor.rs"]
    pub mod socket_monitor;

    pub mod types {
        #[path = "int_types.rs"]
        pub mod int_types;
        #[path = "Tag.rs"]
        pub mod tag;
    }

    pub mod protocol {
        #[path = "FieldType.rs"]
        pub mod field_type;

        #[path = "BackendKeyData.rs"]
        pub mod backend_key_data;
        #[path = "CommandComplete.rs"]
        pub mod command_complete;
        #[path = "DataRow.rs"]
        pub mod data_row;
        #[path = "ErrorResponse.rs"]
        pub mod error_response;
        #[path = "FieldDescription.rs"]
        pub mod field_description;
        #[path = "FieldMessage.rs"]
        pub mod field_message;
        #[path = "NewReader.rs"]
        pub mod new_reader;
        pub mod notice_response {
            /// Same wire format as `ErrorResponse` (length-prefixed list of
            /// field messages), so it reuses the same decoder.
            pub type NoticeResponse = super::error_response::ErrorResponse;
        }
        #[path = "NotificationResponse.rs"]
        pub mod notification_response;
        #[path = "ParameterDescription.rs"]
        pub mod parameter_description;
        #[path = "ParameterStatus.rs"]
        pub mod parameter_status;
        #[path = "ReadyForQuery.rs"]
        pub mod ready_for_query;
        #[path = "RowDescription.rs"]
        pub mod row_description;
    }

    pub use any_postgres_error::{AnyPostgresError, PostgresErrorOptions};
    pub use command_tag::CommandTag;
}
