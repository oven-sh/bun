use super::new_writer::NewWriter;
use super::portal_or_prepared_statement::PortalOrPreparedStatement;
use super::write_wrap::WriteWrap;

/// Close (F)
/// Byte1('C')
/// - Identifies the message as a Close command.
/// Int32
/// - Length of message contents in bytes, including self.
/// Byte1
/// - 'S' to close a prepared statement; or 'P' to close a portal.
/// String
/// - The name of the prepared statement or portal to close (an empty string selects the unnamed prepared statement or portal).
pub struct Close {
    pub p: PortalOrPreparedStatement,
}

impl Close {
    fn write_internal<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let p = &self.p;
        let count: u32 = core::mem::size_of::<u32>() as u32
            + 1
            + u32::try_from(p.slice().len()).unwrap()
            + 1;
        // PORT NOTE: Zig source builds `[_]u8{'C'} ++ @byteSwap(count) ++ [_]u8{p.tag()}`;
        // intent is 'C' · big-endian u32 count · tag byte. Reshaped to a fixed 6-byte buffer.
        let mut header = [0u8; 6];
        header[0] = b'C';
        header[1..5].copy_from_slice(&count.to_be_bytes());
        header[5] = p.tag();
        writer.write(&header)?;
        writer.write(p.slice())?;
        writer.write(&[0u8])?;
        Ok(())
    }

    // Zig: `pub const write = WriteWrap(@This(), writeInternal);`
    // TODO(port): WriteWrap is a comptime fn-wrapper (super::write_wrap). Phase B should
    // resolve whether this becomes a trait impl or macro; for now forward directly.
    pub fn write<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        let _ = WriteWrap::<Self>;
        self.write_internal(writer)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/Close.zig (37 lines)
//   confidence: medium
//   todos:      2
//   notes:      WriteWrap comptime wrapper stubbed; header concat reshaped to to_be_bytes buffer
// ──────────────────────────────────────────────────────────────────────────
