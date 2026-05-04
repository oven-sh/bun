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
    pub fn decode_internal<Container>(
        reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        let mut remaining_bytes = reader.length()?;
        remaining_bytes = remaining_bytes.saturating_sub(4);
        let _ = remaining_bytes;

        let field_count: usize = usize::try_from(reader.short()?.max(0)).unwrap();

        // PORT NOTE: Zig allocates an uninit slice, fills it in-place, and uses
        // an `errdefer` to deinit the filled prefix + free on failure. Reshaped
        // to `Vec::push` so `?` drops already-decoded elements automatically.
        let mut fields: Vec<FieldDescription> = Vec::with_capacity(field_count);
        for _ in 0..field_count {
            fields.push(FieldDescription::decode_internal::<Container>(reader)?);
        }

        Ok(Self {
            fields: fields.into_boxed_slice(),
        })
    }
}

// pub const decode = DecoderWrap(RowDescription, decodeInternal).decode;
// TODO(port): `DecoderWrap(T, decodeInternal)` is a comptime `fn(type, fn) -> type`
// generator that produces a `.decode` wrapper. In Rust this becomes a trait impl
// (e.g. `impl Decode for RowDescription`) or a `decoder_wrap!` macro once
// `decoder_wrap.rs` lands in Phase B.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/RowDescription.zig (43 lines)
//   confidence: medium
//   todos:      2
//   notes:      decode_internal reshaped (out-param→Result); DecoderWrap left as TODO for trait/macro in Phase B
// ──────────────────────────────────────────────────────────────────────────
