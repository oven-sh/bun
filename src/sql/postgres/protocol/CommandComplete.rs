use crate::postgres::protocol::new_reader::NewReader;

pub struct CommandComplete<'a> {
    pub command_tag: &'a [u8],
}

impl<'a> CommandComplete<'a> {
    pub fn decode_internal(reader: &NewReader<'a>) -> crate::Result<Self> {
        let remaining = reader.body_length()?;

        let (command_tag, _) = reader.string_within(remaining)?;
        Ok(Self { command_tag })
    }
}
