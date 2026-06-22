use super::any_mysql_error::Error as AnyMySQLError;
use super::new_reader::{NewReader, ReaderContext};
use crate::shared::data::Data;
use crate::shared::stack_reader::{ShortRead, WrapReader};

pub use crate::shared::stack_reader::StackReader;

impl ShortRead for AnyMySQLError {
    const SHORT_READ: Self = AnyMySQLError::ShortRead;
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
    fn skip(self, count: isize) {
        StackReader::skip(&self, count)
    }
    fn ensure_capacity(self, count: usize) -> bool {
        StackReader::ensure_capacity(&self, count)
    }
    fn read(self, count: usize) -> Result<Data, AnyMySQLError> {
        StackReader::read(&self, count)
    }
    fn read_z(self) -> Result<Data, AnyMySQLError> {
        StackReader::read_z(&self)
    }
    fn set_offset_from_start(self, offset: usize) {
        StackReader::set_offset_from_start(&self, offset)
    }
}
