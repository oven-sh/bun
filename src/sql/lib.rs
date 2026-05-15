#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
pub mod shared {
    #[path = "ColumnIdentifier.rs"]
    pub mod column_identifier;
    #[path = "ConnectionFlags.rs"]
    pub mod connection_flags;
    #[path = "Data.rs"]
    pub mod data;
    #[path = "SQLQueryResultMode.rs"]
    pub mod sql_query_result_mode;

    pub use column_identifier::ColumnIdentifier;
    pub use connection_flags::ConnectionFlags;
    pub use data::Data;
    pub use sql_query_result_mode::SQLQueryResultMode;
}

pub mod mysql {
    #[path = "AuthMethod.rs"]
    pub mod auth_method;
    #[path = "Capabilities.rs"]
    pub mod capabilities;
    #[path = "ConnectionState.rs"]
    pub mod connection_state;
    #[path = "MySQLParam.rs"]
    pub mod mysql_param;
    #[path = "MySQLQueryResult.rs"]
    pub mod mysql_query_result;
    #[path = "MySQLRequest.rs"]
    pub mod mysql_request;
    #[path = "MySQLTypes.rs"]
    pub mod mysql_types;
    #[path = "QueryStatus.rs"]
    pub mod query_status;
    #[path = "SSLMode.rs"]
    pub mod ssl_mode;
    #[path = "StatusFlags.rs"]
    pub mod status_flags;
    #[path = "TLSStatus.rs"]
    pub mod tls_status;

    pub mod protocol {
        #[path = "AnyMySQLError.rs"]
        pub mod any_mysql_error;
        #[path = "CharacterSet.rs"]
        pub mod character_set;
        #[path = "CommandType.rs"]
        pub mod command_type;
        #[path = "EncodeInt.rs"]
        pub mod encode_int;
        #[path = "PacketHeader.rs"]
        pub mod packet_header;
        #[path = "PacketType.rs"]
        pub mod packet_type;

        pub use character_set::CharacterSet;

        #[path = "Auth.rs"]
        pub mod auth;
        #[path = "AuthSwitchRequest.rs"]
        pub mod auth_switch_request;
        #[path = "AuthSwitchResponse.rs"]
        pub mod auth_switch_response;
        #[path = "ColumnDefinition41.rs"]
        pub mod column_definition41;
        #[path = "EOFPacket.rs"]
        pub mod eof_packet;
        #[path = "ErrorPacket.rs"]
        pub mod error_packet;
        #[path = "HandshakeResponse41.rs"]
        pub mod handshake_response41;
        #[path = "HandshakeV10.rs"]
        pub mod handshake_v10;
        #[path = "LocalInfileRequest.rs"]
        pub mod local_infile_request;
        #[path = "NewReader.rs"]
        pub mod new_reader;
        #[path = "NewWriter.rs"]
        pub mod new_writer;
        #[path = "OKPacket.rs"]
        pub mod ok_packet;
        #[path = "PreparedStatement.rs"]
        pub mod prepared_statement;
        #[path = "Query.rs"]
        pub mod query;
        #[path = "ResultSetHeader.rs"]
        pub mod result_set_header;
        #[path = "SSLRequest.rs"]
        pub mod ssl_request;
        #[path = "StackReader.rs"]
        pub mod stack_reader;
        #[path = "StmtPrepareOKPacket.rs"]
        pub mod stmt_prepare_ok_packet;

        // ── flat re-exports for `bun_sql_jsc` ──────────────────────────────
        // sql_jsc names most of these via `bun_sql::mysql::protocol::Foo`
        // (mirroring Zig's flat `MySQLProtocol.zig` namespace), so surface
        // them here as well as via their leaf modules.
        pub use any_mysql_error::{AnyMySQLError, Error};
        pub use auth_switch_request::AuthSwitchRequest;
        pub use auth_switch_response::AuthSwitchResponse;
        pub use column_definition41::{ColumnDefinition41, ColumnFlags};
        pub use eof_packet::EOFPacket;
        pub use error_packet::{ErrorPacket, MySQLErrorOptions};
        pub use handshake_response41::HandshakeResponse41;
        pub use handshake_v10::HandshakeV10;
        pub use local_infile_request::LocalInfileRequest;
        pub use new_reader::{Decode, NewReader, NewReaderOf, ReadableInt, ReaderContext};
        pub use new_writer::{NewWriter, NewWriterWrap, Packet, WriterContext, write_wrap};
        pub use ok_packet::OKPacket;
        pub use packet_header::PacketHeader;
        pub use packet_type::PacketType;
        pub use result_set_header::ResultSetHeader;
        pub use ssl_request::SSLRequest;
        pub use stack_reader::StackReader;
        pub use stmt_prepare_ok_packet::StmtPrepareOKPacket;
        // `protocol::FieldType` (Zig re-export of mysql_types.FieldType).
        pub use crate::mysql::mysql_types::FieldType;
    }

    pub use auth_method::AuthMethod;
    pub use capabilities::Capabilities;
    pub use connection_state::ConnectionState;
    pub use mysql_query_result::MySQLQueryResult;
    pub use query_status::Status as QueryStatus;
    pub use ssl_mode::SSLMode;
    pub use status_flags::{StatusFlag, StatusFlags};
    pub use tls_status::TLSStatus;
}

pub mod postgres {
    #[path = "AnyPostgresError.rs"]
    pub mod any_postgres_error;
    #[path = "CommandTag.rs"]
    pub mod command_tag;
    #[path = "PostgresProtocol.rs"]
    pub mod postgres_protocol;
    #[path = "PostgresTypes.rs"]
    pub mod postgres_types;
    #[path = "SocketMonitor.rs"]
    pub mod socket_monitor;
    #[path = "SSLMode.rs"]
    pub mod ssl_mode;
    #[path = "Status.rs"]
    pub mod status;
    #[path = "TLSStatus.rs"]
    pub mod tls_status;

    pub mod types {
        #[path = "int_types.rs"]
        pub mod int_types;
        #[path = "Tag.rs"]
        pub mod tag;
    }

    pub mod protocol {
        #[path = "FieldType.rs"]
        pub mod field_type;
        #[path = "PortalOrPreparedStatement.rs"]
        pub mod portal_or_prepared_statement;
        #[path = "TransactionStatusIndicator.rs"]
        pub mod transaction_status_indicator;
        #[path = "zHelpers.rs"]
        pub mod z_helpers;

        #[path = "ArrayList.rs"]
        pub mod array_list;
        #[path = "Authentication.rs"]
        pub mod authentication;
        #[path = "BackendKeyData.rs"]
        pub mod backend_key_data;
        #[path = "Close.rs"]
        pub mod close;
        #[path = "CommandComplete.rs"]
        pub mod command_complete;
        #[path = "CopyData.rs"]
        pub mod copy_data;
        #[path = "CopyFail.rs"]
        pub mod copy_fail;
        #[path = "CopyInResponse.rs"]
        pub mod copy_in_response;
        #[path = "CopyOutResponse.rs"]
        pub mod copy_out_response;
        #[path = "DataRow.rs"]
        pub mod data_row;
        #[path = "DecoderWrap.rs"]
        pub mod decoder_wrap;
        #[path = "Describe.rs"]
        pub mod describe;
        #[path = "ErrorResponse.rs"]
        pub mod error_response;
        #[path = "Execute.rs"]
        pub mod execute;
        #[path = "FieldDescription.rs"]
        pub mod field_description;
        #[path = "FieldMessage.rs"]
        pub mod field_message;
        #[path = "NegotiateProtocolVersion.rs"]
        pub mod negotiate_protocol_version;
        #[path = "NewReader.rs"]
        pub mod new_reader;
        #[path = "NewWriter.rs"]
        pub mod new_writer;
        #[path = "NoticeResponse.rs"]
        pub mod notice_response;
        #[path = "NotificationResponse.rs"]
        pub mod notification_response;
        #[path = "ParameterDescription.rs"]
        pub mod parameter_description;
        #[path = "ParameterStatus.rs"]
        pub mod parameter_status;
        #[path = "Parse.rs"]
        pub mod parse;
        #[path = "PasswordMessage.rs"]
        pub mod password_message;
        #[path = "ReadyForQuery.rs"]
        pub mod ready_for_query;
        #[path = "RowDescription.rs"]
        pub mod row_description;
        #[path = "SASLInitialResponse.rs"]
        pub mod sasl_initial_response;
        #[path = "SASLResponse.rs"]
        pub mod sasl_response;
        #[path = "StackReader.rs"]
        pub mod stack_reader;
        #[path = "StartupMessage.rs"]
        pub mod startup_message;
        #[path = "WriteWrap.rs"]
        pub mod write_wrap;

        // ── flat re-exports for `bun_sql_jsc` (Decode/Write trait surface) ──
        pub use decoder_wrap::DecoderWrap;
        pub use new_reader::{NewReader, NewReaderWrap, ProtocolInt, ReaderContext};
        pub use new_writer::{LengthWriter, NewWriter, WriterContext, new_writer};
        pub use write_wrap::WriteWrap;
    }

    pub use any_postgres_error::{AnyPostgresError, PostgresErrorOptions};
    pub use command_tag::CommandTag;
    pub use ssl_mode::SSLMode;
    pub use status::Status;
    pub use tls_status::TLSStatus;
    pub use types::tag::Tag;

    // PascalCase module aliases — Zig callers used `PostgresProtocol.Foo` /
    // `PostgresTypes.Int4` / `SocketMonitor.write` directly; sql_jsc still
    // names them that way.
    pub use postgres_protocol as PostgresProtocol;
    pub use postgres_types as PostgresTypes;
    pub use socket_monitor as SocketMonitor;
}

// Top-level convenience re-export (sql_jsc::jsc references `bun_sql::FieldMessage`).
pub use postgres::protocol::field_message::FieldMessage;
