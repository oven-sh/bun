use crate::postgres::protocol::new_reader::NewReader;
use crate::shared::Data;

pub struct CommandComplete {
    pub command_tag: Data,
}

impl Default for CommandComplete {
    fn default() -> Self {
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
        let remaining = (reader.length()? - 4) as usize;

        let (tag, _) = reader.string_within(remaining)?;
        *self = Self { command_tag: tag };
        Ok(())
    }
}
