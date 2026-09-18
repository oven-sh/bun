use super::field_description::FieldDescription;
use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

#[derive(Default)]
pub struct RowDescription {
    pub fields: Box<[FieldDescription]>,
}

// With `fields: Box<[FieldDescription]>`, Rust drops each element then frees
// the slice automatically — no explicit Drop needed.

impl RowDescription {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        // The Int32 message length bounds the field-count and every per-field
        // read; an overrun is a malformed RowDescription, not a ShortRead.
        let mut remaining_bytes = reader.length()?.saturating_sub(4) as usize;

        if remaining_bytes < 2 {
            return Err(AnyPostgresError::InvalidMessage);
        }
        let field_count: usize = usize::from(reader.short()?);
        remaining_bytes -= 2;

        // `Vec::push` so `?` drops already-decoded elements automatically.
        let mut fields: Vec<FieldDescription> = Vec::with_capacity(field_count);
        for _ in 0..field_count {
            let before = reader.peek().len();
            let field = match FieldDescription::decode_internal::<Container>(&mut reader) {
                Ok(f) => f,
                Err(AnyPostgresError::ShortRead) => return Err(AnyPostgresError::InvalidMessage),
                Err(e) => return Err(e),
            };
            let consumed = before.saturating_sub(reader.peek().len());
            if consumed > remaining_bytes {
                return Err(AnyPostgresError::InvalidMessage);
            }
            remaining_bytes -= consumed;
            fields.push(field);
        }

        Ok(Self {
            fields: fields.into_boxed_slice(),
        })
    }
}
