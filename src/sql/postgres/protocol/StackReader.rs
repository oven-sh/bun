use crate::postgres::any_postgres_error::AnyPostgresError;
use crate::postgres::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::data::Data;
use crate::shared::stack_reader::{ShortRead, WrapReader};

pub use crate::shared::stack_reader::StackReader;

impl ShortRead for AnyPostgresError {
    const SHORT_READ: Self = AnyPostgresError::ShortRead;
}

impl<'a> WrapReader<'a> for NewReader<StackReader<'a>> {
    fn wrap(reader: StackReader<'a>) -> Self {
        NewReader { wrapped: reader }
    }
}

impl<'a> ReaderContext for StackReader<'a> {
    fn mark_message_start(&mut self) {
        StackReader::mark_message_start(self)
    }
    fn peek(&self) -> &[u8] {
        StackReader::peek(self)
    }
    fn skip(&mut self, count: usize) {
        // The shared reader's signed skip clamps to the buffer end, matching
        // the old unsigned behavior even when `count` exceeds `isize::MAX`.
        StackReader::skip(self, isize::try_from(count).unwrap_or(isize::MAX))
    }
    fn ensure_length(&mut self, count: usize) -> bool {
        StackReader::ensure_capacity(self, count)
    }
    fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        StackReader::read(self, count)
    }
    fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        StackReader::read_z(self)
    }
}
