const bun = @import("bun");
const string = bun.string;

pub const NPMClient = struct {
    bin: string,
    tag: Tag,

    pub const Tag = enum {
        bun,
    };
};
