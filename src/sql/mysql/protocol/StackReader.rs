use super::any_mysql_error::Error as AnyMySQLError;
use super::new_reader::{NewReader, ReaderContext};
use crate::shared::stack_reader::{ShortRead, WrapReader};

pub use crate::shared::stack_reader::StackReader;

pub type PacketReader<'a> = NewReader<StackReader<'a>>;

/// The reader holds a whole packet: more bytes from the socket cannot complete a field.
impl ShortRead for AnyMySQLError {
    const SHORT_READ: Self = AnyMySQLError::MalformedPacket;
}

impl<'a> WrapReader<'a> for NewReader<StackReader<'a>> {
    fn wrap(reader: StackReader<'a>) -> Self {
        NewReader { wrapped: reader }
    }
}

impl<'a> ReaderContext for StackReader<'a> {
    fn mark_message_start(self) {
        StackReader::mark_message_start(&self)
    }
    fn peek(&self) -> &[u8] {
        StackReader::peek(self)
    }
    fn ensure_capacity(self, count: usize) -> bool {
        StackReader::ensure_capacity(&self, count)
    }
    fn set_offset_from_start(self, offset: usize) {
        StackReader::set_offset_from_start(&self, offset)
    }
}
