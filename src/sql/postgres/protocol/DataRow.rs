use crate::postgres::protocol::NewReader;
use crate::postgres::AnyPostgresError;
use crate::shared::Data;

// Zig: `context: anytype` + `comptime forEach: fn(@TypeOf(context), u32, ?*Data) AnyPostgresError!bool`
// Opaque-context pattern (PORTING.md §anytype): unbounded `<C>`; context is forwarded by value
// to the callback each iteration, so require `C: Copy`.
// `comptime ContextType: type, reader: NewReader(ContextType)` is the paired-param spelling of a
// generic reader → `reader: &mut NewReader<R>`.
// `comptime forEach: fn(...)` → `impl FnMut` (monomorphized, matches Zig comptime).
pub fn decode<C: Copy, R>(
    context: C,
    reader: &mut NewReader<R>,
    mut for_each: impl FnMut(C, u32, Option<&mut Data>) -> Result<bool, AnyPostgresError>,
) -> Result<(), AnyPostgresError> {
    let mut _remaining_bytes = reader.length()?;
    _remaining_bytes = _remaining_bytes.saturating_sub(4);

    let remaining_fields: usize = usize::try_from(reader.short()?.max(0)).unwrap();

    for index in 0..remaining_fields {
        let byte_length = reader.int4()?;
        match byte_length {
            0 => {
                let mut empty = Data::EMPTY;
                if !for_each(context, u32::try_from(index).unwrap(), Some(&mut empty))? {
                    break;
                }
            }
            NULL_INT4 => {
                if !for_each(context, u32::try_from(index).unwrap(), None)? {
                    break;
                }
            }
            _ => {
                let mut bytes = reader.bytes(usize::try_from(byte_length).unwrap())?;
                if !for_each(context, u32::try_from(index).unwrap(), Some(&mut bytes))? {
                    break;
                }
            }
        }
    }
    Ok(())
}

pub const NULL_INT4: u32 = 4294967295;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/DataRow.zig (31 lines)
//   confidence: medium
//   todos:      0
//   notes:      NewReader<R> method sigs assumed (length/short/int4/bytes)
// ──────────────────────────────────────────────────────────────────────────
