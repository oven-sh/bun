const unicode = @import("std").unicode;

pub const JavascriptString = []u16;
pub fn newJavascriptString(comptime text: []const u8) JavascriptString {
    return unicode.utf8ToUtf16LeStringLiteral(text);
}

pub const NodeIndex = u32;
pub const NodeIndexNone = 4294967293;
