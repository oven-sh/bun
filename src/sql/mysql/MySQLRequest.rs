use super::protocol::command_type::CommandType;
use super::protocol::new_writer::NewWriter;

bun_core::declare_scope!(MySQLRequest, visible);

pub fn execute_query(query: &[u8], writer: &mut NewWriter<'_>) -> crate::Result<()> {
    bun_core::scoped_log!(
        MySQLRequest,
        "executeQuery len: {} {}",
        query.len(),
        bstr::BStr::new(query)
    );
    // resets the sequence id to zero every time we send a query
    let packet = writer.start(0)?;
    writer.int1(CommandType::COM_QUERY as u8)?;
    writer.write(query)?;

    packet.end(writer)?;
    Ok(())
}

pub fn prepare_request(query: &[u8], writer: &mut NewWriter<'_>) -> crate::Result<()> {
    bun_core::scoped_log!(MySQLRequest, "prepareRequest {}", bstr::BStr::new(query));
    let packet = writer.start(0)?;
    writer.int1(CommandType::COM_STMT_PREPARE as u8)?;
    writer.write(query)?;

    packet.end(writer)?;
    Ok(())
}

/// The server sends no reply.
pub fn close_statement(statement_id: u32, writer: &mut NewWriter<'_>) -> crate::Result<()> {
    bun_core::scoped_log!(MySQLRequest, "closeStatement {}", statement_id);
    let packet = writer.start(0)?;
    writer.int1(CommandType::COM_STMT_CLOSE as u8)?;
    writer.int4(statement_id)?;

    packet.end(writer)?;
    Ok(())
}

pub fn quit(writer: &mut NewWriter<'_>) -> crate::Result<()> {
    let packet = writer.start(0)?;
    writer.int1(CommandType::COM_QUIT as u8)?;

    packet.end(writer)?;
    Ok(())
}
