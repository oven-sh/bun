pub const PacketType = enum(u8) {
    // Server packets
    OK = 0x00,
    EOF = 0xfe,
    ERROR = 0xff,
    LOCAL_INFILE = 0xfb,

    // Client/server packets
    HANDSHAKE = 0x0a,
    MORE_DATA = 0x01,

    UNKNOWN,
    _,
    pub const AUTH_SWITCH = 0xfe;

    pub fn fromInt(value: u8, header_length: u24) PacketType {
        // https://dev.mysql.com/doc/dev/mysql-server/8.4.5/page_protocol_basic_ok_packet.html
        // These rules distinguish whether the packet represents OK or EOF:
        // OK: header = 0 and length of packet > 7
        // EOF: header = 0xfe and length of packet < 9

        if (value == @intFromEnum(PacketType.OK)) {
            return if (header_length >= 7) .OK else .UNKNOWN;
        }
        if (value == @intFromEnum(PacketType.EOF)) {
            return if (header_length < 9) .EOF else .UNKNOWN;
        }

        return @enumFromInt(value);
    }
};
