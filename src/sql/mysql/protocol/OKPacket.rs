// OK Packet
use crate::mysql::StatusFlags;
use crate::mysql::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

pub struct OKPacket {
    pub header: u8,
    pub affected_rows: u64,
    pub last_insert_id: u64,
    pub status_flags: StatusFlags,
    pub warnings: u16,
    pub info: Data,
    pub session_state_changes: Data,
    // TODO(port): Zig u24 — using u32, callers must ensure value fits in 24 bits
    pub packet_size: u32,
}

// Zig field defaults: header=0x00, affected_rows=0, last_insert_id=0, status_flags={},
// warnings=0, info=.empty, session_state_changes=.empty. `packet_size` has NO default
// (caller must supply it), so no `Default` impl — Phase B may add `OKPacket::new(packet_size)`.

// Zig `deinit` only called `this.info.deinit()` and `this.session_state_changes.deinit()`.
// `Data` owns its buffer and has `Drop`, so Rust drops fields automatically — no explicit
// `impl Drop` needed.

impl OKPacket {
    // TODO(port): narrow error set (InvalidOKPacket + reader errors)
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        let mut read_size: usize = 5; // header + status flags + warnings
        self.header = reader.int::<u8>()?;
        if self.header != 0x00 && self.header != 0xfe {
            return Err(bun_core::err!("InvalidOKPacket"));
        }

        // Affected rows (length encoded integer)
        self.affected_rows = reader.encoded_len_int_with_size(&mut read_size)?;

        // Last insert ID (length encoded integer)
        self.last_insert_id = reader.encoded_len_int_with_size(&mut read_size)?;

        // Status flags
        self.status_flags = StatusFlags::from_int(reader.int::<u16>()?);
        // Warnings
        self.warnings = reader.int::<u16>()?;

        // Info (EOF-terminated string)
        if !reader.peek().is_empty() && (self.packet_size as usize) > read_size {
            let remaining = (self.packet_size as usize) - read_size;
            // Zig: @truncate(remaining) — intentional wrap to reader.read's arg type
            self.info = reader.read(remaining as _)?;
        }
        Ok(())
    }
}

// Zig `decoderWrap(@This(), ...)` — see Decode trait in src/sql/mysql/protocol/NewReader.rs
pub use self::OKPacket as _DecoderWrapTarget;

// ported from: src/sql/mysql/protocol/OKPacket.zig
