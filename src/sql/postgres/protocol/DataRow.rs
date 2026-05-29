use crate::postgres::AnyPostgresError;
use crate::postgres::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

pub fn decode<C: Copy, R: ReaderContext>(
    context: C,
    reader: &mut NewReader<R>,
    mut for_each: impl FnMut(C, u32, Option<&mut Data>) -> Result<bool, AnyPostgresError>,
) -> Result<(), AnyPostgresError> {
    let mut _remaining_bytes = reader.length()?;
    _remaining_bytes = _remaining_bytes.saturating_sub(4);

    let remaining_fields: usize = usize::from(reader.short()?);

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

pub(crate) const NULL_INT4: u32 = 4294967295;

// ported from: src/sql/postgres/protocol/DataRow.zig
