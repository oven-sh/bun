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
        reader.length()?;

        let tag = reader.read_z()?;
        *self = Self { command_tag: tag };
        Ok(())
    }

    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        context: Container,
    ) -> crate::Result<()> {
        self.decode_internal(NewReader { wrapped: context })
    }
}
