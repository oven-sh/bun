use crate::postgres::AnyPostgresError;
use crate::postgres::postgres_types::Int4;
use crate::postgres::protocol::new_reader::NewReader;

#[derive(Default)]
pub struct ParameterDescription {
    pub parameters: Box<[Int4]>,
}

impl ParameterDescription {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        // The Int32 message length bounds the Int16 count and the Int32[n]
        // body; an overrun is a malformed message, not a ShortRead.
        let remaining_bytes = reader.length()?.saturating_sub(4) as usize;

        if remaining_bytes < 2 {
            return Err(AnyPostgresError::InvalidMessage);
        }
        let count = reader.short()?;
        let n = usize::from(count);
        if n * core::mem::size_of::<Int4>() > remaining_bytes - 2 {
            return Err(AnyPostgresError::InvalidMessage);
        }
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

    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, AnyPostgresError> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}

// Rust cannot form an unaligned `&[i32]`, so we reinterpret as `&[[u8; 4]]`
// (align 1) and let the caller `from_ne_bytes` each element.
fn to_int32_slice(slice: &[u8]) -> &[[u8; core::mem::size_of::<Int4>()]] {
    // `[u8; 4]` has align 1 and is `AnyBitPattern`, so this is a safe cast
    // cast. Truncate any trailing `len % 4` bytes first (cast_slice would
    // panic on a remainder).
    let n = core::mem::size_of::<Int4>();
    bun_core::cast_slice(&slice[..slice.len() - slice.len() % n])
}
