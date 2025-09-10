const bun = @import("bun");
const logger = bun.logger;

const strip_ansi_source = logger.Source.initPathString("/bun-nativefill/strip-ansi.js", "export default Bun.stripAnsi;");
const string_width_source = logger.Source.initPathString("/bun-nativefill/string-width.js", "export default Bun.stringWidth;");
const better_sqlite3_source = logger.Source.initPathString("/bun-nativefill/better-sqlite3.js", "export { Database as default } from 'bun:sqlite';");

pub const Map = bun.ComptimeStringMap(*const logger.Source, .{
    .{ "strip-ansi", &strip_ansi_source },
    .{ "string-width", &string_width_source },
    .{ "better-sqlite3", &better_sqlite3_source },
});