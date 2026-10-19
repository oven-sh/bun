use crate::postgres::protocol::new_reader::NewReader;
use crate::shared::Data;

pub struct CommandComplete {
    pub command_tag: Data,
}

impl CommandComplete {
    pub fn new() -> Self {
        Self {
            command_tag: Data::Empty,
        }
    }
}

impl CommandComplete {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        &mut self,
        mut reader: NewReader<Container>,
    ) -> crate::Result<()> {
        let remaining = reader.body_length()?;

        let (tag, _) = reader.string_within(remaining)?;
        *self = Self { command_tag: tag };
        Ok(())
    }
}
