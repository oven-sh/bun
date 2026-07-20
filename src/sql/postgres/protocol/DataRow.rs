use crate::postgres::AnyPostgresError;
use crate::postgres::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

// The opaque context is forwarded by value to the callback each iteration,
// so require `C: Copy`.
pub fn decode<C: Copy, R: ReaderContext>(
    context: C,
    reader: &mut NewReader<R>,
    mut for_each: impl FnMut(C, u32, Option<&mut Data>) -> Result<bool, AnyPostgresError>,
) -> Result<(), AnyPostgresError> {
    // The Int32 message length bounds every read below; a field count or cell
    // length that overruns it is a malformed DataRow (libpq: "insufficient
    // data left in message"), not a ShortRead to wait on.
    let mut remaining_bytes = reader.length()?.saturating_sub(4);

    if remaining_bytes < 2 {
        return Err(AnyPostgresError::InvalidMessage);
    }
    let remaining_fields: usize = usize::from(reader.short()?);
    remaining_bytes -= 2;

    for index in 0..remaining_fields {
        if remaining_bytes < 4 {
            return Err(AnyPostgresError::InvalidMessage);
        }
        let byte_length = reader.int4()?;
        remaining_bytes -= 4;
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
                if byte_length > remaining_bytes {
                    return Err(AnyPostgresError::InvalidMessage);
                }
                remaining_bytes -= byte_length;
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

pub(crate) const NULL_INT4: u32 = 4294967295;
