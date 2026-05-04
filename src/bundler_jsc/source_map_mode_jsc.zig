//! `fromJS` for `bun.schema.api.SourceMapMode` — kept out of
//! `options_types/schema.zig` so that file has no `JSGlobalObject`/`JSValue`
//! references.

pub fn sourceMapModeFromJS(global: *bun.jsc.JSGlobalObject, value: bun.jsc.JSValue) bun.JSError!?SourceMapMode {
    if (value.isString()) {
        const str = try value.toSliceOrNull(global);
        defer str.deinit();
        const utf8 = str.slice();
        if (bun.strings.eqlComptime(utf8, "none")) {
            return .none;
        }
        if (bun.strings.eqlComptime(utf8, "inline")) {
            return .@"inline";
        }
        if (bun.strings.eqlComptime(utf8, "external")) {
            return .external;
        }
        if (bun.strings.eqlComptime(utf8, "linked")) {
            return .linked;
        }
    }
    return null;
}

const bun = @import("bun");
const SourceMapMode = bun.schema.api.SourceMapMode;
