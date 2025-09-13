const StmtPrepareOKPacket = @This();
status: u8 = 0,
statement_id: u32 = 0,
num_columns: u16 = 0,
num_params: u16 = 0,
warning_count: u16 = 0,
packet_length: u24,
pub fn decodeInternal(this: *StmtPrepareOKPacket, comptime Context: type, reader: NewReader(Context)) !void {
    this.status = try reader.int(u8);
    if (this.status != 0) {
        return error.InvalidPrepareOKPacket;
    }

    this.statement_id = try reader.int(u32);
    this.num_columns = try reader.int(u16);
    this.num_params = try reader.int(u16);
    _ = try reader.int(u8); // reserved_1
    if (this.packet_length >= 12) {
        this.warning_count = try reader.int(u16);
    }
}

pub const decode = decoderWrap(StmtPrepareOKPacket, decodeInternal).decode;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
