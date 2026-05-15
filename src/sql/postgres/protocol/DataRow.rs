use crate::postgres::AnyPostgresError;
use crate::postgres::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

// Opaque-context pattern (PORTING.md §opaque context): unbounded `<C>`; context
// is forwarded by value to the callback each iteration, so require `C: Copy`.
// The reader is a generic `reader: &mut NewReader<R>`.
// The per-row callback is an `impl FnMut` (monomorphized).
pub fn decode<C: Copy, R: ReaderContext>(
    context: C,
    reader: &mut NewReader<R>,
    mut for_each: impl FnMut(C, u32, Option<&mut Data>) -> Result<bool, AnyPostgresError>,
) -> Result<(), AnyPostgresError> {
    let mut _remaining_bytes = reader.length()?;
    _remaining_bytes = _remaining_bytes.saturating_sub(4);

    let remaining_fields: usize = usize::try_from(reader.short()?.max(0)).expect("int cast");

    for index in 0..remaining_fields {
        let byte_length = reader.int4()?;
        match byte_length {
            0 => {
                let mut empty = Data::EMPTY;
                if !for_each(
                    context,
                    u32::try_from(index).expect("int cast"),
                    Some(&mut empty),
                )? {
                    break;
                }
            }
            NULL_INT4 => {
                if !for_each(context, u32::try_from(index).expect("int cast"), None)? {
                    break;
                }
            }
            _ => {
                let mut bytes = reader.bytes(usize::try_from(byte_length).expect("int cast"))?;
                if !for_each(
                    context,
                    u32::try_from(index).expect("int cast"),
                    Some(&mut bytes),
                )? {
                    break;
                }
            }
        }
    }
    Ok(())
}

pub const NULL_INT4: u32 = 4294967295;
