use super::protocol::command_type::CommandType;
use super::protocol::packet_writer::PacketWriter;

bun_core::declare_scope!(MySQLRequest, visible);

/// The sequence ids start over with every command.
fn write_command(command: CommandType, argument: &[u8], out: &mut Vec<u8>) {
    let mut packet = PacketWriter::start(out, 0);
    packet.int1(command as u8);
    packet.write(argument);
    packet.end();
}

pub fn execute_query(query: &[u8], out: &mut Vec<u8>) {
    bun_core::scoped_log!(
        MySQLRequest,
        "executeQuery len: {} {}",
        query.len(),
        bstr::BStr::new(query)
    );
    write_command(CommandType::COM_QUERY, query, out);
}

pub fn prepare_request(query: &[u8], out: &mut Vec<u8>) {
    bun_core::scoped_log!(MySQLRequest, "prepareRequest {}", bstr::BStr::new(query));
    write_command(CommandType::COM_STMT_PREPARE, query, out);
}

/// The server sends no reply.
pub fn close_statement(statement_id: u32, out: &mut Vec<u8>) {
    bun_core::scoped_log!(MySQLRequest, "closeStatement {}", statement_id);
    write_command(
        CommandType::COM_STMT_CLOSE,
        &statement_id.to_le_bytes(),
        out,
    );
}

pub fn quit(out: &mut Vec<u8>) {
    write_command(CommandType::COM_QUIT, b"", out);
}
