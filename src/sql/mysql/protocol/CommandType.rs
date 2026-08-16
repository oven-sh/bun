// Command packet types
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum CommandType {
    COM_QUERY = 0x03,
    COM_STMT_PREPARE = 0x16,
    COM_STMT_EXECUTE = 0x17,
}
