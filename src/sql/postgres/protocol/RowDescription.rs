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
        let mut remaining_bytes = reader.length()?;
        remaining_bytes = remaining_bytes.saturating_sub(4);
        let _ = remaining_bytes;

        let field_count: usize = usize::from(reader.short()?);

        // `Vec::push` so `?` drops already-decoded elements automatically.
        let mut fields: Vec<FieldDescription> = Vec::with_capacity(field_count);
        for _ in 0..field_count {
            fields.push(FieldDescription::decode_internal::<Container>(&mut reader)?);
        }

        Ok(Self {
            fields: fields.into_boxed_slice(),
        })
    }
}
