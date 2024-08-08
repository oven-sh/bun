const bun = @import("root").bun;

pub const RegularExpression = opaque {
    pub const Flags = enum(u16) {
        none = 0,

        hasIndices = 1 << 0,
        global = 1 << 1,
        ignoreCase = 1 << 2,
        multiline = 1 << 3,
        dotAll = 1 << 4,
        unicode = 1 << 5,
        unicodeSets = 1 << 6,
        sticky = 1 << 7,
    };

    extern fn Yarr__RegularExpression__init(pattern: bun.String, flags: u16) *RegularExpression;
    extern fn Yarr__RegularExpression__deinit(pattern: *RegularExpression) void;
    extern fn Yarr__RegularExpression__isValid(this: *RegularExpression) bool;
    extern fn Yarr__RegularExpression__matchedLength(this: *RegularExpression) i32;
    extern fn Yarr__RegularExpression__searchRev(this: *RegularExpression) i32;
    extern fn Yarr__RegularExpression__matches(this: *RegularExpression, string: bun.String) i32;

    pub inline fn init(pattern: bun.String, flags: Flags) !*RegularExpression {
        var regex = Yarr__RegularExpression__init(pattern, @intFromEnum(flags));
        if (!regex.isValid()) {
            regex.deinit();
            return error.InvalidRegex;
        }
        return regex;
    }

    pub inline fn isValid(this: *RegularExpression) bool {
        return Yarr__RegularExpression__isValid(this);
    }

    // Reserving `match` for a full match result.
    // pub inline fn match(this: *RegularExpression, str: bun.String, startFrom: i32) MatchResult {
    // }

    // Simple boolean matcher
    pub inline fn matches(this: *RegularExpression, str: bun.String) bool {
        return Yarr__RegularExpression__matches(this, str) >= 0;
    }

    pub inline fn searchRev(this: *RegularExpression, str: bun.String) i32 {
        return Yarr__RegularExpression__searchRev(this, str);
    }

    pub inline fn matchedLength(this: *RegularExpression) i32 {
        return Yarr__RegularExpression__matchedLength(this);
    }

    pub inline fn deinit(this: *RegularExpression) void {
        Yarr__RegularExpression__deinit(this);
    }
};
