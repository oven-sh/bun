pub const NPMClient = struct {
    bin: string,
    tag: Tag,

    pub const Tag = enum {
        bun,
    };
};

const string = []const u8;

const bun = @import("bun");
