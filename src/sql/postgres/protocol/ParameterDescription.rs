use crate::postgres::postgres_types::Int4;
use crate::postgres::protocol::decoder_wrap::DecoderWrap;
use crate::postgres::protocol::new_reader::NewReader;

#[derive(Default)]
pub struct ParameterDescription {
    pub parameters: Box<[Int4]>,
}

impl ParameterDescription {
    // TODO(port): narrow error set
    // PORT NOTE: out-param constructor (`this.* = .{...}`) reshaped to return Self.
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        let mut remaining_bytes = reader.length()?;
        remaining_bytes = remaining_bytes.saturating_sub(4);
        let _ = remaining_bytes;

        let count = reader.short()?;
        let n = usize::try_from(count.max(0)).expect("int cast");
        let mut parameters: Box<[Int4]> = vec![Int4::default(); n].into_boxed_slice();

        let data = reader.read(n * core::mem::size_of::<Int4>())?;
        // `defer data.deinit()` — handled by Drop.
        let input_params = to_int32_slice(data.slice());
        debug_assert_eq!(input_params.len(), parameters.len());
        for (src, dest) in input_params.iter().zip(parameters.iter_mut()) {
            *dest = Int4::from_ne_bytes(*src).swap_bytes();
        }

        Ok(Self { parameters })
    }

    // Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, bun_core::Error> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}

// workaround for zig compiler TODO
// PORT NOTE: Zig returned `[]align(1) const Int4`; Rust cannot form an unaligned `&[i32]`,
// so we reinterpret as `&[[u8; 4]]` (align 1) and let the caller `from_ne_bytes` each element.
fn to_int32_slice(slice: &[u8]) -> &[[u8; core::mem::size_of::<Int4>()]] {
    // `[u8; 4]` has align 1 and is `AnyBitPattern`, so this is a safe bytemuck
    // cast. Truncate any trailing `len % 4` bytes first to match Zig's
    // `bytesAsSlice` semantics (cast_slice would panic on a remainder).
    let n = core::mem::size_of::<Int4>();
    bun_core::cast_slice(&slice[..slice.len() - slice.len() % n])
}

// ported from: src/sql/postgres/protocol/ParameterDescription.zig
