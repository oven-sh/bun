pub const tables = [_]config.Table{
    .{
        .name = "buildtime",
        .extensions = &.{
            grapheme_break_no_control,
        },
        .fields = &.{
            grapheme_break_no_control.field("grapheme_break_no_control"),
        },
    },
};

const config = @import("./config.rust");

const config_x = @import("../uucode_lib/src/x/config.x.rust");
const grapheme_break_no_control = config_x.grapheme_break_no_control;
