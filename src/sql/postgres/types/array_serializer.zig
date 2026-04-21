//! Emits a PG text-format array literal (e.g. `{"a","b"}`) for a JS array
//! bound to an array-typed parameter — used by `sql(object)` expansion.
//! Mirrors `arrayValueSerializer` in `src/js/internal/sql/postgres.ts`.
pub const Error = AnyPostgresError || bun.JSError;

pub fn writeTo(
    globalObject: *jsc.JSGlobalObject,
    value: JSValue,
    element_tag: Tag,
    comptime Context: type,
    writer: protocol.NewWriter(Context),
) Error!void {
    const l = try writer.length();
    try writeArrayLiteral(globalObject, value, element_tag, Context, writer);
    try l.writeExcludingSelf();
}

fn writeArrayLiteral(
    globalObject: *jsc.JSGlobalObject,
    value: JSValue,
    element_tag: Tag,
    comptime Context: type,
    writer: protocol.NewWriter(Context),
) Error!void {
    // Both entry points gate on `value.isArray()` before dispatching here —
    // `writeTo` via `writeBind` in `PostgresRequest.zig`, and the recursive
    // call in `writeElement` below. A non-array would be a caller bug.
    bun.assert(value.isArray());

    var iter = try jsc.JSArrayIterator.init(value, globalObject);
    if (iter.len == 0) {
        try writer.write("{}");
        return;
    }

    try writer.write("{");
    // `box[]` is the sole PG array type whose element delimiter is `;`.
    const delimiter: []const u8 = if (element_tag == .box) ";" else ",";
    var first = true;
    while (try iter.next()) |element| {
        if (!first) try writer.write(delimiter);
        first = false;
        try writeElement(globalObject, element, element_tag, Context, writer);
    }
    try writer.write("}");
}

fn writeElement(
    globalObject: *jsc.JSGlobalObject,
    value: JSValue,
    element_tag: Tag,
    comptime Context: type,
    writer: protocol.NewWriter(Context),
) Error!void {
    if (value.isEmptyOrUndefinedOrNull()) {
        try writer.write("null");
        return;
    }

    // JSON / JSONB elements are JSON values — arrays/objects/primitives all
    // get stringified and embedded as a quoted, escaped string. Must precede
    // the `isArray` branch so e.g. a `jsonb[]` value `[[1,2],[3,4]]`
    // becomes the 1-D literal `{"[1,2]","[3,4]"}` (two jsonb values), not
    // a 2-D PG array `{{"1","2"},{"3","4"}}`.
    if (element_tag == .json or element_tag == .jsonb) {
        var str = bun.String.empty;
        defer str.deref();
        try value.jsonStringifyFast(globalObject, &str);
        const slice = str.toUTF8WithoutRef(bun.default_allocator);
        defer slice.deinit();
        try writer.write("\"");
        try writeEscaped(Context, writer, slice.slice());
        try writer.write("\"");
        return;
    }

    // Nested array -> recurse (multi-dimensional arrays share one element type).
    if (value.isArray()) {
        try writeArrayLiteral(globalObject, value, element_tag, Context, writer);
        return;
    }

    // bytea[] elements are Buffers — encode as `"\x<hex>"`. Typed arrays
    // are NOT matched here; they fall through to the array/default path so
    // they serialize as their own array of numeric elements. This mirrors
    // `arrayValueSerializer` in `src/js/internal/sql/postgres.ts` which
    // gates on `Buffer.isBuffer(value)`, not on `ArrayBuffer.isView`.
    if (element_tag == .bytea and value.isBuffer(globalObject)) {
        if (value.asArrayBuffer(globalObject)) |buf| {
            try writer.write("\"\\\\x");
            try writeHex(Context, writer, buf.byteSlice());
            try writer.write("\"");
            return;
        }
    }

    // bool[] -> canonical `t`/`f` for booleans.
    if (element_tag == .bool and value.isBoolean()) {
        try writer.write(if (value.toBoolean()) "t" else "f");
        return;
    }

    // Date -> ISO 8601 in UTC, quoted. `toISOString` returns an empty slice
    // for non-finite dates (NaN, ±Infinity); emit NULL rather than falling
    // through to `String.fromJS`, which would yield `"Invalid Date"` — PG
    // rejects that as invalid input syntax for any date/timestamp column.
    if (value.isDate()) {
        var iso_buf: [29]u8 = undefined;
        const iso = value.toISOString(globalObject, &iso_buf);
        if (iso.len == 0) {
            try writer.write("null");
            return;
        }
        try writer.write("\"");
        try writer.write(iso);
        try writer.write("\"");
        return;
    }

    // Default: stringify via `String.fromJS` (uses `Array.prototype.toString`
    // for nested JS arrays, but we handled those above). Quote and
    // backslash-escape — universally safe for text[], int[], numeric[],
    // date[], etc.
    var str = try bun.String.fromJS(value, globalObject);
    if (str.tag == .Dead) return error.OutOfMemory;
    defer str.deref();
    const slice = str.toUTF8WithoutRef(bun.default_allocator);
    defer slice.deinit();

    try writer.write("\"");
    try writeEscaped(Context, writer, slice.slice());
    try writer.write("\"");
}

/// PG array-literal element escape: backslash and double-quote are prefixed
/// with a backslash. Mirrors `arrayEscape` in
/// `src/js/internal/sql/postgres.ts`.
fn writeEscaped(
    comptime Context: type,
    writer: protocol.NewWriter(Context),
    bytes: []const u8,
) AnyPostgresError!void {
    var start: usize = 0;
    for (bytes, 0..) |c, i| {
        switch (c) {
            '\\', '"' => {
                if (i > start) try writer.write(bytes[start..i]);
                const escape_pair: [2]u8 = .{ '\\', c };
                try writer.write(&escape_pair);
                start = i + 1;
            },
            else => {},
        }
    }
    if (start < bytes.len) try writer.write(bytes[start..]);
}

const hex_digits = "0123456789abcdef";

fn writeHex(
    comptime Context: type,
    writer: protocol.NewWriter(Context),
    bytes: []const u8,
) AnyPostgresError!void {
    var buf: [2]u8 = undefined;
    for (bytes) |b| {
        buf[0] = hex_digits[b >> 4];
        buf[1] = hex_digits[b & 0xf];
        try writer.write(&buf);
    }
}

const bun = @import("bun");
const protocol = @import("../PostgresProtocol.zig");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Tag = @import("./Tag.zig").Tag;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
