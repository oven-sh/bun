use super::field_description::FieldDescription;
use super::new_reader::NewReader;

#[derive(Default)]
pub struct RowDescription {
    pub fields: Box<[FieldDescription]>,
}

// `pub fn deinit` → `impl Drop`: the Zig body only loops `field.deinit()` then
// `default_allocator.free(this.fields)`. With `fields: Box<[FieldDescription]>`,
// Rust drops each element then frees the slice automatically — no explicit Drop
// needed.

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

        // PORT NOTE: Zig allocates an uninit slice, fills it in-place, and uses
        // an `errdefer` to deinit the filled prefix + free on failure. Reshaped
        // to `Vec::push` so `?` drops already-decoded elements automatically.
        let mut fields: Vec<FieldDescription> = Vec::with_capacity(field_count);
        for _ in 0..field_count {
            fields.push(FieldDescription::decode_internal::<Container>(&mut reader)?);
        }

        Ok(Self {
            fields: fields.into_boxed_slice(),
        })
    }
}

// Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs

// ported from: src/sql/postgres/protocol/RowDescription.zig
