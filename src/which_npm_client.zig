pub const NPMClient = struct {
    bin: string,
    tag: Tag,

    pub const Tag = enum {
        bun,
    };
};

const bun = @import("bun");
const string = bun.Str;
