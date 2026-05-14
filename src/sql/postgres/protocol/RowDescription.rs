use super::field_description::FieldDescription;
use super::new_reader::NewReader;

#[derive(Default)]
pub struct RowDescription {
    pub fields: Box<[FieldDescription]>,
}

// Cleanup just releases each field then frees the slice. With
// `fields: Box<[FieldDescription]>`, Rust drops each element then frees the
// slice automatically — no explicit Drop needed.

impl RowDescription {
    // PORT NOTE: out-param constructor (`this.* = .{...}`) reshaped to return `Result<Self, _>`.
    // TODO(port): narrow error set
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        let mut remaining_bytes = reader.length()?;
        remaining_bytes = remaining_bytes.saturating_sub(4);
        let _ = remaining_bytes;

        let field_count: usize = usize::try_from(reader.short()?.max(0)).expect("int cast");

        // PORT NOTE: reshaped to `Vec::push` so `?` drops already-decoded
        // elements automatically on failure.
        let mut fields: Vec<FieldDescription> = Vec::with_capacity(field_count);
        for _ in 0..field_count {
            fields.push(FieldDescription::decode_internal::<Container>(&mut reader)?);
        }

        Ok(Self {
            fields: fields.into_boxed_slice(),
        })
    }
}

// Decoder helper marker — see src/sql/postgres/protocol/DecoderWrap.rs
