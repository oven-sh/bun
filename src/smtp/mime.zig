/// MIME message builder for SMTP.
/// Constructs RFC 5322 compliant email messages with multipart support,
/// quoted-printable encoding, base64 attachments, and RFC 2047 header encoding.
const MimeType = bun.http.MimeType;

/// Options for message building.
pub const BuildOptions = struct {
    message_id_hostname: []const u8 = "bun",
    keep_bcc: bool = false,
    disable_file_access: bool = false,
};

pub fn buildMessageWithOptions(alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue, opts: BuildOptions) ![]const u8 {
    var message = bun.MutableString.initEmpty(alloc);
    const writer = message.writer();

    // Standard headers
    try writeStringField(writer, alloc, globalObject, msg, "from", "From");
    try writeAddressField(writer, alloc, globalObject, msg, "to", "To");
    try writeAddressField(writer, alloc, globalObject, msg, "cc", "Cc");
    // BCC: only include if keepBcc is true (default: strip from headers per RFC 5321)
    if (opts.keep_bcc) {
        try writeAddressField(writer, alloc, globalObject, msg, "bcc", "Bcc");
    }
    try writeStringField(writer, alloc, globalObject, msg, "replyTo", "Reply-To");
    try writeStringField(writer, alloc, globalObject, msg, "inReplyTo", "In-Reply-To");
    try writeStringField(writer, alloc, globalObject, msg, "references", "References");

    // Subject - needs RFC 2047 encoding for non-ASCII
    if (try msg.getTruthy(globalObject, "subject")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        const encoded = try encodeHeaderValue(alloc, utf8.slice());
        defer alloc.free(encoded);
        try writeFoldedHeaderLine(writer, alloc, "Subject", encoded);
    }

    // Date header (RFC 2822 format)
    try writeDateHeader(writer);

    // Message-ID using bun.csprng for cryptographic randomness
    var random_bytes: [16]u8 = undefined;
    bun.csprng(&random_bytes);
    try writer.print("Message-ID: <{s}@{s}>\r\n", .{ std.fmt.bytesToHex(random_bytes, .lower), opts.message_id_hostname });

    try writer.writeAll("MIME-Version: 1.0\r\n");
    try writer.writeAll("X-Mailer: Bun\r\n");

    // Priority headers: priority can be "high", "normal", "low"
    if (try msg.getTruthy(globalObject, "priority")) |v| {
        if (v.isString()) {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            const p = utf8.slice();
            if (bun.strings.eqlComptime(p, "high")) {
                try writer.writeAll("X-Priority: 1 (Highest)\r\nX-MSMail-Priority: High\r\nImportance: High\r\n");
            } else if (bun.strings.eqlComptime(p, "low")) {
                try writer.writeAll("X-Priority: 5 (Lowest)\r\nX-MSMail-Priority: Low\r\nImportance: Low\r\n");
            }
        }
    }

    // List-* headers (for mailing lists)
    if (try msg.getTruthy(globalObject, "list")) |list_obj| {
        if (list_obj.isObject()) {
            try writeListHeader(writer, alloc, globalObject, list_obj, "unsubscribe", "List-Unsubscribe");
            try writeListHeader(writer, alloc, globalObject, list_obj, "subscribe", "List-Subscribe");
            try writeListHeader(writer, alloc, globalObject, list_obj, "help", "List-Help");
            try writeListHeader(writer, alloc, globalObject, list_obj, "post", "List-Post");

            if (try list_obj.getTruthy(globalObject, "id")) |v| {
                if (v.isString()) {
                    const s = try v.toBunString(globalObject);
                    defer s.deref();
                    const u = s.toUTF8WithoutRef(alloc);
                    defer u.deinit();
                    const clean_id = try sanitizeHeaderValue(alloc, u.slice());
                    defer alloc.free(clean_id);
                    try writer.print("List-Id: {s}\r\n", .{clean_id});
                }
            }
        }
    }

    // Custom headers
    try writeCustomHeaders(writer, alloc, globalObject, msg);

    // Determine content parts
    const has_html = (try msg.getTruthy(globalObject, "html")) != null;
    const has_text = (try msg.getTruthy(globalObject, "text")) != null;
    const has_attachments = if (try msg.getTruthy(globalObject, "attachments")) |a| a.isArray() else false;
    const has_ical = (try msg.getTruthy(globalObject, "icalEvent")) != null;

    // Generate boundary using csprng
    var boundary_bytes: [12]u8 = undefined;
    bun.csprng(&boundary_bytes);
    var boundary_buf: [64]u8 = undefined;
    const boundary = std.fmt.bufPrint(&boundary_buf, "----=_Bun_{s}", .{std.fmt.bytesToHex(boundary_bytes, .lower)}) catch "----=_Bun_fallback";

    if (has_attachments) {
        try writer.print("Content-Type: multipart/mixed;\r\n boundary=\"{s}\"\r\n\r\n", .{boundary});

        if (has_html and has_text) {
            var inner_boundary_bytes: [12]u8 = undefined;
            bun.csprng(&inner_boundary_bytes);
            var inner_boundary_buf: [64]u8 = undefined;
            const inner_boundary = std.fmt.bufPrint(&inner_boundary_buf, "----=_Alt_{s}", .{std.fmt.bytesToHex(inner_boundary_bytes, .lower)}) catch "----=_Alt_fallback";

            try writer.print("--{s}\r\nContent-Type: multipart/alternative;\r\n boundary=\"{s}\"\r\n\r\n", .{ boundary, inner_boundary });
            try writeTextPart(writer, alloc, globalObject, msg, inner_boundary);
            try writeHtmlPart(writer, alloc, globalObject, msg, inner_boundary);
            try writer.print("--{s}--\r\n\r\n", .{inner_boundary});
        } else if (has_html) {
            try writer.print("--{s}\r\n", .{boundary});
            try writeInlineHtml(writer, alloc, globalObject, msg);
        } else if (has_text) {
            try writer.print("--{s}\r\n", .{boundary});
            try writeInlineText(writer, alloc, globalObject, msg);
        }

        if (try msg.getTruthy(globalObject, "attachments")) |att_array| {
            var iter = try att_array.arrayIterator(globalObject);
            while (try iter.next()) |att| {
                if (att.isObject()) {
                    try writeAttachmentWithOpts(writer, alloc, globalObject, att, boundary, opts.disable_file_access);
                }
            }
        }

        try writer.print("--{s}--\r\n", .{boundary});
    } else if ((has_html and has_text) or has_ical) {
        try writer.print("Content-Type: multipart/alternative;\r\n boundary=\"{s}\"\r\n\r\n", .{boundary});
        if (has_text) try writeTextPart(writer, alloc, globalObject, msg, boundary);
        if (has_html) try writeHtmlPart(writer, alloc, globalObject, msg, boundary);
        if (has_ical) try writeIcalPart(writer, alloc, globalObject, msg, boundary);
        try writer.print("--{s}--\r\n", .{boundary});
    } else if (has_html) {
        try writeInlineHtml(writer, alloc, globalObject, msg);
    } else {
        try writeInlineText(writer, alloc, globalObject, msg);
    }

    return message.toOwnedSlice();
}

/// Extract bare email address from "Display Name <email@host>" format.
pub const extractEmail = @import("address_parser.zig").extractEmail;

// ============================================================================
// Header helpers
// ============================================================================

/// Check if a string contains only printable ASCII (plus TAB, CR, LF).
pub fn isPlainText(value: []const u8) bool {
    for (value) |c| {
        if (c > 126 or (c < 32 and c != '\t' and c != '\r' and c != '\n')) return false;
    }
    return true;
}

/// Check if any line in the string exceeds maxLength characters.
pub fn hasLongerLines(value: []const u8, max_length: usize) bool {
    var line_len: usize = 0;
    for (value) |c| {
        if (c == '\n') {
            line_len = 0;
        } else {
            line_len += 1;
            if (line_len > max_length) return true;
        }
    }
    return false;
}

/// Encode a single word using RFC 2047 encoded-word format.
/// encoding: 'B' for base64, 'Q' for quoted-printable.
pub fn encodeWord(alloc: std.mem.Allocator, value: []const u8, encoding: u8) ![]const u8 {
    if (encoding == 'Q' or encoding == 'q') {
        // Quoted-printable encoded-word: =?UTF-8?Q?...?=
        var buf = bun.MutableString.initEmpty(alloc);
        const w = buf.writer();
        try w.writeAll("=?UTF-8?Q?");
        for (value) |c| {
            if (c == ' ') {
                try w.writeByte('_');
            } else if ((c >= 'A' and c <= 'Z') or (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9')) {
                try w.writeByte(c);
            } else {
                const hex = "0123456789ABCDEF";
                try w.writeByte('=');
                try w.writeByte(hex[c >> 4]);
                try w.writeByte(hex[c & 0x0f]);
            }
        }
        try w.writeAll("?=");
        return buf.toOwnedSlice();
    }
    // Base64 encoded-word (default)
    return encodeHeaderValue(alloc, value);
}

/// Encode a header value using RFC 2047 encoded-word if it contains non-ASCII.
/// Always uses base64 encoding.
pub fn encodeHeaderValue(alloc: std.mem.Allocator, value: []const u8) ![]const u8 {
    var needs_encoding = false;
    for (value) |c| {
        if (c > 127 or c == '\r' or c == '\n') {
            needs_encoding = true;
            break;
        }
    }
    if (needs_encoding) {
        // Strip \r\n to prevent header injection, then base64 encode
        var clean = try alloc.alloc(u8, value.len);
        var clean_len: usize = 0;
        for (value) |c| {
            if (c != '\r' and c != '\n') {
                clean[clean_len] = c;
                clean_len += 1;
            }
        }
        const src = clean[0..clean_len];
        defer alloc.free(clean);
        const b64_len = bun.base64.encodeLen(src);
        const result = try alloc.alloc(u8, 10 + b64_len + 2);
        @memcpy(result[0..10], "=?UTF-8?B?");
        const encoded_len = bun.base64.encode(result[10..], src);
        @memcpy(result[10 + encoded_len ..][0..2], "?=");
        return result[0 .. 10 + encoded_len + 2];
    }
    return try alloc.dupe(u8, value);
}

/// Fold a header line at 76 characters per RFC 2822.
/// Inserts CRLF + space at word boundaries.
pub fn foldHeader(alloc: std.mem.Allocator, header: []const u8) ![]const u8 {
    if (header.len <= 76) return try alloc.dupe(u8, header);

    var result = bun.MutableString.initEmpty(alloc);
    const w = result.writer();
    var line_len: usize = 0;

    var i: usize = 0;
    while (i < header.len) {
        // Find next word boundary (space or end)
        var word_end = i;
        while (word_end < header.len and header[word_end] != ' ' and header[word_end] != '\t') : (word_end += 1) {}
        const word = header[i..word_end];

        if (line_len > 0 and line_len + 1 + word.len > 76 and line_len > 0) {
            try w.writeAll("\r\n ");
            line_len = 1;
        } else if (line_len > 0 and i > 0 and (header[i - 1] == ' ' or header[i - 1] == '\t')) {
            // Preserve the space
        }

        try w.writeAll(word);
        line_len += word.len;

        // Skip whitespace
        if (word_end < header.len) {
            try w.writeByte(header[word_end]);
            line_len += 1;
            i = word_end + 1;
        } else {
            i = word_end;
        }
    }

    return result.toOwnedSlice();
}

/// Encode a filename for Content-Disposition per RFC 5987/2231.
/// Returns the parameter string (e.g. `filename="ascii.txt"` or `filename*=utf-8''encoded`).
pub fn encodeNameParam(writer: anytype, param_name: []const u8, filename: []const u8) !void {
    // Check if filename needs encoding (non-ASCII or special chars)
    var needs_encoding = false;
    var needs_quoting = false;
    for (filename) |c| {
        if (c > 127) {
            needs_encoding = true;
            break;
        }
        if (c == '"' or c == '\\' or c == ';' or c == ' ' or c == '(' or c == ')' or c == ',') needs_quoting = true;
    }

    if (needs_encoding) {
        try writer.writeAll(param_name);
        try writer.writeAll("*=utf-8''");
        for (filename) |c| {
            if ((c >= 'A' and c <= 'Z') or (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or
                c == '.' or c == '-' or c == '_' or c == '~')
            {
                try writer.writeByte(c);
            } else {
                const hex = "0123456789ABCDEF";
                try writer.writeByte('%');
                try writer.writeByte(hex[c >> 4]);
                try writer.writeByte(hex[c & 0x0f]);
            }
        }
    } else if (needs_quoting) {
        try writer.writeAll(param_name);
        try writer.writeAll("=\"");
        for (filename) |c| {
            if (c == '"' or c == '\\') try writer.writeByte('\\');
            try writer.writeByte(c);
        }
        try writer.writeByte('"');
    } else {
        try writer.writeAll(param_name);
        try writer.writeAll("=\"");
        try writer.writeAll(filename);
        try writer.writeByte('"');
    }
}

pub fn encodeFilenameParam(writer: anytype, filename: []const u8) !void {
    try encodeNameParam(writer, "filename", filename);
}

/// Write a complete header line with folding at 76 chars.
fn writeFoldedHeaderLine(writer: anytype, alloc: std.mem.Allocator, comptime header_name: []const u8, value: []const u8) !void {
    // Security: strip \r and \n from value to prevent header injection
    const clean = try sanitizeHeaderValue(alloc, value);
    defer alloc.free(clean);
    const full = try std.fmt.allocPrint(alloc, header_name ++ ": {s}", .{clean});
    defer alloc.free(full);
    const folded = try foldHeader(alloc, full);
    defer alloc.free(folded);
    try writer.writeAll(folded);
    try writer.writeAll("\r\n");
}

/// Strip \r and \n from header values to prevent header injection attacks.
/// Always returns an owned allocation that must be freed by the caller.
fn sanitizeHeaderValue(alloc: std.mem.Allocator, value: []const u8) ![]const u8 {
    var has_crlf = false;
    for (value) |c| {
        if (c == '\r' or c == '\n') {
            has_crlf = true;
            break;
        }
    }
    if (!has_crlf) return try alloc.dupe(u8, value);
    var clean = try alloc.alloc(u8, value.len);
    var j: usize = 0;
    for (value) |ch| {
        if (ch != '\r' and ch != '\n') {
            clean[j] = ch;
            j += 1;
        }
    }
    if (j < clean.len) {
        const result = try alloc.dupe(u8, clean[0..j]);
        alloc.free(clean);
        return result;
    }
    return clean;
}

fn writeAddressField(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue, comptime js_key: []const u8, comptime header: []const u8) !void {
    if (try msg.getTruthy(globalObject, js_key)) |v| {
        if (v.isString()) {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            try writeFoldedHeaderLine(writer, alloc, header, utf8.slice());
        } else if (v.isArray()) {
            // Build full value first, then fold
            var val_buf = bun.MutableString.initEmpty(alloc);
            defer val_buf.deinit();
            const vw = val_buf.writer();
            var first = true;
            var iter = try v.arrayIterator(globalObject);
            while (try iter.next()) |item| {
                if (item.isString()) {
                    if (!first) try vw.writeAll(", ");
                    const s = try item.toBunString(globalObject);
                    defer s.deref();
                    const utf8 = s.toUTF8WithoutRef(alloc);
                    defer utf8.deinit();
                    try vw.writeAll(utf8.slice());
                    first = false;
                }
            }
            try writeFoldedHeaderLine(writer, alloc, header, val_buf.slice());
        }
    }
}

fn writeStringField(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue, comptime js_key: []const u8, comptime header: []const u8) !void {
    if (try msg.getTruthy(globalObject, js_key)) |v| {
        if (v.isString()) {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            const encoded = try encodeHeaderValue(alloc, utf8.slice());
            defer alloc.free(encoded);
            try writeFoldedHeaderLine(writer, alloc, header, encoded);
        }
    }
}

fn writeDateHeader(writer: anytype) !void {
    const epoch_secs: u64 = @intCast(std.time.timestamp());
    const epoch_day = epoch_secs / 86400;
    const day_secs = epoch_secs % 86400;
    const hours = day_secs / 3600;
    const mins = (day_secs % 3600) / 60;
    const secs = day_secs % 60;
    const z = epoch_day + 719468;
    const era = z / 146097;
    const doe = z - era * 146097;
    const yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const y = yoe + era * 400;
    const doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const mp = (5 * doy + 2) / 153;
    const d = doy - (153 * mp + 2) / 5 + 1;
    const m = if (mp < 10) mp + 3 else mp - 9;
    const year = if (m <= 2) y + 1 else y;
    const dow = (epoch_day + 4) % 7;
    const day_names = [_][]const u8{ "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" };
    const month_names = [_][]const u8{ "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
    try writer.print("Date: {s}, {d:0>2} {s} {d} {d:0>2}:{d:0>2}:{d:0>2} +0000\r\n", .{
        day_names[dow], d, month_names[m - 1], year, hours, mins, secs,
    });
}

fn writeListHeader(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, list_obj: jsc.JSValue, comptime js_key: []const u8, comptime header: []const u8) !void {
    if (try list_obj.getTruthy(globalObject, js_key)) |v| {
        if (v.isString()) {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const u = s.toUTF8WithoutRef(alloc);
            defer u.deinit();
            const val = u.slice();
            if (bun.strings.hasPrefixComptime(val, "http") or bun.strings.hasPrefixComptime(val, "mailto:")) {
                const wrapped = try std.fmt.allocPrint(alloc, "<{s}>", .{val});
                defer alloc.free(wrapped);
                try writeFoldedHeaderLine(writer, alloc, header, wrapped);
            } else {
                try writeFoldedHeaderLine(writer, alloc, header, val);
            }
        }
    }
}

fn writeCustomHeaders(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue) !void {
    if (try msg.getTruthy(globalObject, "headers")) |headers_val| {
        if (headers_val.getObject()) |headers_obj| {
            var iter = try jsc.JSPropertyIterator(.{
                .skip_empty_name = true,
                .include_value = true,
            }).init(globalObject, headers_obj);
            defer iter.deinit();

            while (try iter.next()) |key| {
                const key_slice = key.toOwnedSlice(alloc) catch continue;
                defer alloc.free(key_slice);
                const val = iter.value;
                if (val.isString()) {
                    const val_s = try val.toBunString(globalObject);
                    defer val_s.deref();
                    const val_utf8 = val_s.toUTF8WithoutRef(alloc);
                    defer val_utf8.deinit();
                    // Fold custom headers at 76 chars; sanitize CRLF
                    const clean_key = try sanitizeHeaderValue(alloc, key_slice);
                    defer alloc.free(clean_key);
                    const clean_val = try sanitizeHeaderValue(alloc, val_utf8.slice());
                    defer alloc.free(clean_val);
                    const full = try std.fmt.allocPrint(alloc, "{s}: {s}", .{ clean_key, clean_val });
                    defer alloc.free(full);
                    const folded = try foldHeader(alloc, full);
                    defer alloc.free(folded);
                    try writer.writeAll(folded);
                    try writer.writeAll("\r\n");
                }
            }
        }
    }
}

/// Extract text content from a JS value that may be a string or { content, encoding } object.
/// Returns owned slice that caller must free.
fn extractTextContent(alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, val: jsc.JSValue) ![]const u8 {
    if (val.isString()) {
        const s = try val.toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        return try alloc.dupe(u8, utf8.slice());
    }
    if (val.isObject()) {
        // { content: "...", encoding: "base64" | "hex" }
        if (try val.getTruthy(globalObject, "content")) |content_val| {
            const s = try content_val.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            const raw = utf8.slice();

            if (try val.getTruthy(globalObject, "encoding")) |enc_val| {
                const es = try enc_val.toBunString(globalObject);
                defer es.deref();
                const eu = es.toUTF8WithoutRef(alloc);
                defer eu.deinit();
                const enc = eu.slice();

                if (bun.strings.eqlComptime(enc, "base64")) {
                    // Decode base64 into a temp buffer, then shrink to actual size
                    const buf = try alloc.alloc(u8, bun.base64.decodeLenUpperBound(raw.len));
                    const decode_result = bun.base64.decode(buf, raw);
                    if (decode_result.isSuccessful()) {
                        if (decode_result.count == buf.len) return buf;
                        const decoded = try alloc.dupe(u8, buf[0..decode_result.count]);
                        alloc.free(buf);
                        return decoded;
                    }
                    alloc.free(buf);
                } else if (bun.strings.eqlComptime(enc, "hex")) {
                    // Decode hex
                    if (raw.len % 2 == 0) {
                        const decoded = try alloc.alloc(u8, raw.len / 2);
                        var i: usize = 0;
                        while (i < raw.len) : (i += 2) {
                            decoded[i / 2] = std.fmt.parseInt(u8, raw[i .. i + 2], 16) catch 0;
                        }
                        return decoded;
                    }
                }
            }
            return try alloc.dupe(u8, raw);
        }
    }
    return try alloc.dupe(u8, "");
}

// ============================================================================
// Body part writers
// ============================================================================

fn writeTextPart(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue, boundary: []const u8) !void {
    try writer.print("--{s}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", .{boundary});
    if (try msg.getTruthy(globalObject, "text")) |v| {
        const content = try extractTextContent(alloc, globalObject, v);
        defer alloc.free(content);
        try writeQuotedPrintable(writer, content);
        try writer.writeAll("\r\n");
    }
}

fn writeHtmlPart(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue, boundary: []const u8) !void {
    try writer.print("--{s}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", .{boundary});
    if (try msg.getTruthy(globalObject, "html")) |v| {
        const content = try extractTextContent(alloc, globalObject, v);
        defer alloc.free(content);
        try writeQuotedPrintable(writer, content);
        try writer.writeAll("\r\n");
    }
}

fn writeInlineText(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue) !void {
    try writer.writeAll("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n");
    if (try msg.getTruthy(globalObject, "text")) |v| {
        const content = try extractTextContent(alloc, globalObject, v);
        defer alloc.free(content);
        try writeQuotedPrintable(writer, content);
    }
}

fn writeInlineHtml(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue) !void {
    try writer.writeAll("Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n");
    if (try msg.getTruthy(globalObject, "html")) |v| {
        const content = try extractTextContent(alloc, globalObject, v);
        defer alloc.free(content);
        try writeQuotedPrintable(writer, content);
    }
}

fn writeIcalPart(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, msg: jsc.JSValue, boundary: []const u8) !void {
    if (try msg.getTruthy(globalObject, "icalEvent")) |ical_val| {
        var method_owned: ?[]u8 = null;
        defer if (method_owned) |m| alloc.free(m);
        var content_owned: ?[]u8 = null;
        defer if (content_owned) |c| alloc.free(c);

        var method: []const u8 = "PUBLISH";
        var content: []const u8 = "";

        if (ical_val.isString()) {
            const s = try ical_val.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            content_owned = try alloc.dupe(u8, utf8.slice());
            content = content_owned.?;
        } else if (ical_val.isObject()) {
            if (try ical_val.getTruthy(globalObject, "method")) |v| {
                const s = try v.toBunString(globalObject);
                defer s.deref();
                const utf8 = s.toUTF8WithoutRef(alloc);
                defer utf8.deinit();
                method_owned = try alloc.dupe(u8, utf8.slice());
                method = method_owned.?;
            }
            if (try ical_val.getTruthy(globalObject, "content")) |v| {
                const s = try v.toBunString(globalObject);
                defer s.deref();
                const utf8 = s.toUTF8WithoutRef(alloc);
                defer utf8.deinit();
                content_owned = try alloc.dupe(u8, utf8.slice());
                content = content_owned.?;
            }
        }

        try writer.print("--{s}\r\nContent-Type: text/calendar; charset=utf-8; method={s}\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", .{ boundary, method });
        try writeQuotedPrintable(writer, content);
        try writer.writeAll("\r\n");
    }
}

// ============================================================================
// Attachment writer
// ============================================================================

fn writeAttachmentWithOpts(writer: anytype, alloc: std.mem.Allocator, globalObject: *jsc.JSGlobalObject, att: jsc.JSValue, boundary: []const u8, disable_file_access: bool) !void {
    // Read all JS string values into owned buffers to avoid use-after-free
    var filename_owned: ?[]u8 = null;
    defer if (filename_owned) |f| alloc.free(f);
    var content_type_owned: ?[]u8 = null;
    defer if (content_type_owned) |c| alloc.free(c);
    var cte_owned: ?[]u8 = null;
    defer if (cte_owned) |c| alloc.free(c);
    var cid_owned: ?[]u8 = null;
    defer if (cid_owned) |c| alloc.free(c);

    var has_filename = true;
    if (try att.getTruthy(globalObject, "filename")) |v| {
        if (v.isBoolean() and !v.toBoolean()) {
            has_filename = false;
        } else if (v.isString()) {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            filename_owned = try alloc.dupe(u8, utf8.slice());
        }
    }
    const filename: []const u8 = filename_owned orelse "attachment";

    var content_type: []const u8 = "application/octet-stream";
    if (try att.getTruthy(globalObject, "contentType")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        content_type_owned = try alloc.dupe(u8, utf8.slice());
        content_type = content_type_owned.?;
    } else if (has_filename) {
        if (std.mem.lastIndexOfScalar(u8, filename, '.')) |dot_pos| {
            const ext = filename[dot_pos + 1 ..];
            const detected = MimeType.byExtension(ext);
            if (detected.value.len > 0) content_type = detected.value;
        }
    }

    var custom_cte: ?[]const u8 = null;
    if (try att.getTruthy(globalObject, "contentTransferEncoding")) |v| {
        if (v.isString()) {
            const s = try v.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            cte_owned = try alloc.dupe(u8, utf8.slice());
            custom_cte = cte_owned.?;
        } else if (v.isBoolean() and !v.toBoolean()) {
            custom_cte = "7bit";
        }
    }

    if (custom_cte == null and bun.strings.hasPrefixComptime(content_type, "message/")) {
        custom_cte = "8bit";
    }

    var cid: ?[]const u8 = null;
    if (try att.getTruthy(globalObject, "cid")) |v| {
        const s = try v.toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        cid_owned = try alloc.dupe(u8, utf8.slice());
        cid = cid_owned.?;
    }

    try writer.print("--{s}\r\n", .{boundary});

    // Content-Type with name parameter using RFC 5987 if needed
    try writer.print("Content-Type: {s}", .{content_type});
    if (has_filename) {
        try writer.writeAll("; ");
        try encodeNameParam(writer, "name", filename);
    }
    try writer.writeAll("\r\n");

    // Content-Disposition
    if (has_filename) {
        if (cid) |content_id| {
            try writer.writeAll("Content-Disposition: inline; ");
            try encodeFilenameParam(writer, filename);
            try writer.writeAll("\r\n");
            const clean_cid = try sanitizeHeaderValue(alloc, content_id);
            defer alloc.free(clean_cid);
            try writer.print("Content-Id: <{s}>\r\n", .{clean_cid});
        } else {
            try writer.writeAll("Content-Disposition: attachment; ");
            try encodeFilenameParam(writer, filename);
            try writer.writeAll("\r\n");
        }
    } else {
        if (cid) |content_id| {
            try writer.writeAll("Content-Disposition: inline\r\n");
            const clean_cid = try sanitizeHeaderValue(alloc, content_id);
            defer alloc.free(clean_cid);
            try writer.print("Content-Id: <{s}>\r\n", .{clean_cid});
        } else {
            try writer.writeAll("Content-Disposition: attachment\r\n");
        }
    }

    const use_cte = custom_cte orelse "base64";
    try writer.print("Content-Transfer-Encoding: {s}\r\n", .{use_cte});

    // Per-attachment custom headers
    if (try att.getTruthy(globalObject, "headers")) |headers_val| {
        if (headers_val.getObject()) |headers_obj| {
            var hiter = try jsc.JSPropertyIterator(.{ .skip_empty_name = true, .include_value = true }).init(globalObject, headers_obj);
            defer hiter.deinit();
            while (try hiter.next()) |key| {
                const ks = key.toOwnedSlice(alloc) catch continue;
                defer alloc.free(ks);
                const hv = hiter.value;
                if (hv.isString()) {
                    const hvs = try hv.toBunString(globalObject);
                    defer hvs.deref();
                    const hvu = hvs.toUTF8WithoutRef(alloc);
                    defer hvu.deinit();
                    const clean_hk = try sanitizeHeaderValue(alloc, ks);
                    defer alloc.free(clean_hk);
                    const clean_hv = try sanitizeHeaderValue(alloc, hvu.slice());
                    defer alloc.free(clean_hv);
                    try writer.print("{s}: {s}\r\n", .{ clean_hk, clean_hv });
                } else {
                    // Support numeric values
                    const clean_hk = try sanitizeHeaderValue(alloc, ks);
                    defer alloc.free(clean_hk);
                    try writer.print("{s}: {d}\r\n", .{ clean_hk, hv.toInt32() });
                }
            }
        }
    }

    try writer.writeAll("\r\n");

    const is_base64 = std.mem.eql(u8, use_cte, "base64");

    if (try att.getTruthy(globalObject, "content")) |content_val| {
        if (content_val.isString()) {
            const s = try content_val.toBunString(globalObject);
            defer s.deref();
            const utf8 = s.toUTF8WithoutRef(alloc);
            defer utf8.deinit();
            if (is_base64) {
                try writeBase64Wrapped(writer, alloc, utf8.slice());
            } else {
                try writer.writeAll(utf8.slice());
            }
        } else if (content_val.asArrayBuffer(globalObject)) |array_buf| {
            if (is_base64) {
                try writeBase64Wrapped(writer, alloc, array_buf.slice());
            } else {
                try writer.writeAll(array_buf.slice());
            }
        }
    } else if (try att.getTruthy(globalObject, "path")) |path_val| {
        const s = try path_val.toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        const path_str = utf8.slice();

        if (bun.strings.hasPrefixComptime(path_str, "data:")) {
            if (std.mem.indexOf(u8, path_str, ",")) |comma_pos| {
                const header = path_str[5..comma_pos];
                const data_part = path_str[comma_pos + 1 ..];
                if (std.mem.indexOf(u8, header, ";base64") != null) {
                    var pos: usize = 0;
                    while (pos < data_part.len) {
                        const end = @min(pos + 76, data_part.len);
                        try writer.writeAll(data_part[pos..end]);
                        try writer.writeAll("\r\n");
                        pos = end;
                    }
                } else if (is_base64) {
                    try writeBase64Wrapped(writer, alloc, data_part);
                } else {
                    try writer.writeAll(data_part);
                }
            }
        } else if (disable_file_access) {
            // File access disabled - skip
            return;
        } else {
            var file = bun.openFile(path_str, .{ .mode = .read_only }) catch return;
            defer file.close();
            const file_data = file.readToEndAlloc(alloc, 50 * 1024 * 1024) catch return;
            defer alloc.free(file_data);
            try writeBase64Wrapped(writer, alloc, file_data);
        }
    }
    try writer.writeAll("\r\n");
}

// ============================================================================
// Content encoding
// ============================================================================

/// Write data as base64 with 76-character line wrapping (RFC 2045).
pub fn writeBase64Wrapped(writer: anytype, alloc: std.mem.Allocator, data: []const u8) !void {
    const b64_len = bun.base64.encodeLen(data);
    const encoded = try alloc.alloc(u8, b64_len);
    defer alloc.free(encoded);
    const actual_len = bun.base64.encode(encoded, data);
    const b64 = encoded[0..actual_len];

    var pos: usize = 0;
    while (pos < b64.len) {
        const end = @min(pos + 76, b64.len);
        try writer.writeAll(b64[pos..end]);
        try writer.writeAll("\r\n");
        pos = end;
    }
}

/// Quoted-Printable encoding (RFC 2045).
/// Handles trailing whitespace encoding, soft line breaks at 76 chars.
pub fn writeQuotedPrintable(writer: anytype, data: []const u8) !void {
    const hex_chars = "0123456789ABCDEF";
    var line_start: usize = 0;

    while (line_start <= data.len) {
        var line_end = line_start;
        while (line_end < data.len and data[line_end] != '\n') : (line_end += 1) {}

        var line = data[line_start..line_end];
        if (line.len > 0 and line[line.len - 1] == '\r') line = line[0 .. line.len - 1];

        // Only the very LAST trailing whitespace char needs encoding per RFC 2045
        const last_char_is_ws = line.len > 0 and (line[line.len - 1] == ' ' or line[line.len - 1] == '\t');

        var out_len: usize = 0;
        for (line, 0..) |c, i| {
            const is_last_trailing_ws = last_char_is_ws and i == line.len - 1;
            const needs_encoding = is_last_trailing_ws or c == '=' or (c < 32 and c != '\t') or c > 126;

            if (needs_encoding) {
                if (out_len + 3 > 75) {
                    try writer.writeAll("=\r\n");
                    out_len = 0;
                }
                try writer.writeByte('=');
                try writer.writeByte(hex_chars[c >> 4]);
                try writer.writeByte(hex_chars[c & 0x0f]);
                out_len += 3;
            } else {
                if (out_len + 1 > 75) {
                    try writer.writeAll("=\r\n");
                    out_len = 0;
                }
                try writer.writeByte(c);
                out_len += 1;
            }
        }

        if (line_end < data.len) {
            try writer.writeAll("\r\n");
        }

        line_start = line_end + 1;
        if (line_end >= data.len) break;
    }
}

/// Testing APIs exposed via bun:internal-for-testing
pub const TestingAPIs = struct {
    pub fn jsIsPlainText(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.arguments();
        if (args.len < 1 or !args[0].isString()) return .js_undefined;
        const s = try args[0].toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(bun.default_allocator);
        defer utf8.deinit();
        return jsc.JSValue.jsBoolean(isPlainText(utf8.slice()));
    }

    pub fn jsHasLongerLines(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.arguments();
        if (args.len < 2) return .js_undefined;
        const s = try args[0].toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(bun.default_allocator);
        defer utf8.deinit();
        return jsc.JSValue.jsBoolean(hasLongerLines(utf8.slice(), @intCast(@max(0, args[1].toInt32()))));
    }

    pub fn jsEncodeWord(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.arguments();
        if (args.len < 1 or !args[0].isString()) return .js_undefined;
        const alloc = bun.default_allocator;
        const s = try args[0].toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        const enc: u8 = if (args.len >= 2 and args[1].isString()) blk: {
            const es = try args[1].toBunString(globalObject);
            defer es.deref();
            const eu = es.toUTF8WithoutRef(alloc);
            defer eu.deinit();
            break :blk if (eu.slice().len > 0) eu.slice()[0] else 'B';
        } else 'B';
        const encoded = try encodeWord(alloc, utf8.slice(), enc);
        defer alloc.free(encoded);
        const result = bun.String.createFormat("{s}", .{encoded}) catch return .js_undefined;
        return result.toJS(globalObject) catch .js_undefined;
    }

    pub fn jsEncodeQP(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.arguments();
        if (args.len < 1 or !args[0].isString()) return .js_undefined;
        const alloc = bun.default_allocator;
        const s = try args[0].toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        var buf = bun.MutableString.initEmpty(alloc);
        defer buf.deinit();
        try writeQuotedPrintable(buf.writer(), utf8.slice());
        const result = bun.String.createFormat("{s}", .{buf.slice()}) catch return .js_undefined;
        return result.toJS(globalObject) catch .js_undefined;
    }

    pub fn jsFoldHeader(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.arguments();
        if (args.len < 1 or !args[0].isString()) return .js_undefined;
        const alloc = bun.default_allocator;
        const s = try args[0].toBunString(globalObject);
        defer s.deref();
        const utf8 = s.toUTF8WithoutRef(alloc);
        defer utf8.deinit();
        const folded = try foldHeader(alloc, utf8.slice());
        defer alloc.free(folded);
        const result = bun.String.createFormat("{s}", .{folded}) catch return .js_undefined;
        return result.toJS(globalObject) catch .js_undefined;
    }
};

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
