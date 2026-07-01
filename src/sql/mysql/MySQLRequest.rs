use super::protocol::command_type::CommandType;
use super::protocol::new_writer::{NewWriter, WriterContext};

bun_core::declare_scope!(MySQLRequest, visible);

pub fn execute_query<Context: WriterContext>(
    query: &[u8],
    writer: NewWriter<Context>,
) -> Result<(), bun_core::Error> {
    bun_core::scoped_log!(
        MySQLRequest,
        "executeQuery len: {} {}",
        query.len(),
        bstr::BStr::new(query)
    );
    // resets the sequence id to zero every time we send a query
    let mut packet = writer.start(0)?;
    writer.int1(CommandType::COM_QUERY as u8)?;
    writer.write(query)?;

    packet.end()?;
    Ok(())
}

pub fn prepare_request<Context: WriterContext>(
    query: &[u8],
    writer: NewWriter<Context>,
) -> Result<(), bun_core::Error> {
    bun_core::scoped_log!(MySQLRequest, "prepareRequest {}", bstr::BStr::new(query));
    let mut packet = writer.start(0)?;
    writer.int1(CommandType::COM_STMT_PREPARE as u8)?;
    writer.write(query)?;

    packet.end()?;
    Ok(())
}

/// COM_STMT_CLOSE deallocates a prepared statement on the server. The server
/// never replies to it, so it is not queued as a request and does not shift
/// response ordering for the commands around it.
/// https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_com_stmt_close.html
pub fn close_request<Context: WriterContext>(
    statement_id: u32,
    writer: NewWriter<Context>,
) -> Result<(), bun_core::Error> {
    bun_core::scoped_log!(MySQLRequest, "closeRequest {}", statement_id);
    // resets the sequence id to zero every time we send a command
    let mut packet = writer.start(0)?;
    writer.int1(CommandType::COM_STMT_CLOSE as u8)?;
    writer.int4(statement_id)?;

    packet.end()?;
    Ok(())
}
