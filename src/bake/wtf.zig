pub const Packed = packed struct(u32) {
    kind: enum(u2) { none, route, client, server },
    data: u30,
};

comptime {
    @compileLog(@as(u32, @bitCast(Packed{ .kind = .none, .data = 1 })));
}
