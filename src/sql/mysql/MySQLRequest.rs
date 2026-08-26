use super::protocol::command_type::CommandType;
use super::protocol::new_writer::{NewWriter, WriterContext};

bun_core::declare_scope!(MySQLRequest, visible);

pub fn execute_query<Context: WriterContext>(
    query: &[u8],
    writer: NewWriter<Context>,
) -> crate::Result<()> {
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
) -> crate::Result<()> {
    bun_core::scoped_log!(MySQLRequest, "prepareRequest {}", bstr::BStr::new(query));
    let mut packet = writer.start(0)?;
    writer.int1(CommandType::COM_STMT_PREPARE as u8)?;
    writer.write(query)?;

    packet.end()?;
    Ok(())
}
