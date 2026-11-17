use super::command_type::CommandType;
use super::packet_header::PacketHeader;
use super::packet_writer::PacketWriter;
use crate::mysql::mysql_types::FieldType;

bun_core::declare_scope!(PreparedStatement, hidden);

/// A bound parameter value. The concrete type (`bun_sql_jsc`'s `Value`) lives
/// in a higher-tier crate this crate cannot depend on.
pub trait ExecuteParam {
    fn field_type(&self) -> FieldType;
    fn is_unsigned(&self) -> bool;
    /// The value in the binary protocol's form for `field_type()`; nothing for `MYSQL_TYPE_NULL`.
    fn write(&self, packet: &mut PacketWriter<'_>);
}

pub struct Execute<'a, P: ExecuteParam> {
    /// ID of the prepared statement to execute, returned from COM_STMT_PREPARE
    pub statement_id: u32,
    pub params: &'a [P],
}

impl<P: ExecuteParam> Execute<'_, P> {
    pub fn write(&self, out: &mut Vec<u8>) {
        let mut packet = PacketWriter::start(out, 0);
        packet.int1(CommandType::COM_STMT_EXECUTE as u8);
        packet.int4(self.statement_id);
        packet.int1(0); // flags: no cursor
        packet.int4(1); // iteration count

        if !self.params.is_empty() {
            for params in self.params.chunks(8) {
                packet.int1(params.iter().rfold(0, |null_bitmap, param| {
                    null_bitmap << 1 | u8::from(param.field_type() == FieldType::MYSQL_TYPE_NULL)
                }));
            }

            // new_params_bind_flag: the types belong to the execution, not to the statement
            packet.int1(1);
            for param in self.params {
                let field_type = param.field_type();
                let unsigned = param.is_unsigned();
                bun_core::scoped_log!(
                    PreparedStatement,
                    "param {} unsigned? {}",
                    <&'static str>::from(field_type),
                    unsigned
                );
                packet.int1(field_type as u8);
                packet.int1(if unsigned { 0x80 } else { 0 });
            }

            for param in self.params {
                param.write(&mut packet);
            }
        }
        packet.end();
    }
}

/// For what `Execute::write` made before the server named the statement. `None`: it is too short.
pub fn set_statement_id(execute: &mut [u8], statement_id: u32) -> Option<()> {
    *execute
        .get_mut(PacketHeader::SIZE + 1..)?
        .first_chunk_mut()? = statement_id.to_le_bytes();
    Some(())
}
