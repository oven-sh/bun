/// DKIM (DomainKeys Identified Mail) signing implementation using BoringSSL.
/// Implements RFC 6376 with relaxed/relaxed canonicalization and rsa-sha256.
const BoringSSL = bun.BoringSSL;

pub const DKIMConfig = struct {
    domain_name: []const u8,
    key_selector: []const u8,
    private_key_pem: []const u8,
};

/// Sign a complete RFC822 message with DKIM.
/// Returns the DKIM-Signature header value (without the "DKIM-Signature: " prefix).
/// The caller should prepend this header to the message.
pub fn sign(alloc: std.mem.Allocator, message: []const u8, config: DKIMConfig) ![]const u8 {
    // 1. Split message into headers and body
    const header_end = findHeaderBodySeparator(message);
    const headers_raw = message[0..header_end];
    const body_start = if (header_end + 4 <= message.len) header_end + 4 else message.len; // skip \r\n\r\n
    const body_raw = if (body_start < message.len) message[body_start..] else "";

    // 2. Canonicalize body (relaxed)
    var body_hash_ctx: bun.sha.SHA256 = bun.sha.SHA256.init();
    const canonical_body = canonicalizeBodyRelaxed(alloc, body_raw) catch return error.OutOfMemory;
    defer alloc.free(canonical_body);
    body_hash_ctx.update(canonical_body);
    var body_hash: [bun.sha.SHA256.digest]u8 = undefined;
    body_hash_ctx.final(&body_hash);

    // Base64 encode body hash
    var bh_buf: [128]u8 = undefined;
    const bh_len = bun.base64.encode(&bh_buf, &body_hash);
    const body_hash_b64 = bh_buf[0..bh_len];

    // 3. Determine which headers to sign
    const signed_headers = "from:to:subject:date:message-id:mime-version";

    // 4. Build DKIM-Signature header (without b= value yet)
    var sig_header = bun.MutableString.initEmpty(alloc);
    defer sig_header.deinit();
    const sig_writer = sig_header.writer();

    try sig_writer.print("v=1; a=rsa-sha256; c=relaxed/relaxed; d={s}; s={s}; h={s}; bh={s}; b=", .{
        config.domain_name,
        config.key_selector,
        signed_headers,
        body_hash_b64,
    });

    // 5. Canonicalize headers (relaxed) for signing
    var header_canon = bun.MutableString.initEmpty(alloc);
    defer header_canon.deinit();
    const hc_writer = header_canon.writer();

    // Add each signed header in canonicalized form
    var header_iter = std.mem.splitSequence(u8, signed_headers, ":");
    while (header_iter.next()) |header_name| {
        if (findHeader(headers_raw, header_name)) |header_value| {
            // Relaxed header canonicalization: lowercase name, unfold, compress whitespace
            try hc_writer.writeAll(header_name);
            try hc_writer.writeAll(":");
            try writeCanonicalHeaderValue(hc_writer, header_value);
            try hc_writer.writeAll("\r\n");
        }
    }

    // Add the DKIM-Signature header itself (without trailing \r\n, and with empty b=)
    try hc_writer.writeAll("dkim-signature:");
    try writeCanonicalHeaderValue(hc_writer, sig_header.slice());

    // 6. RSA-SHA256 sign the canonical header hash
    const signature = try rsaSha256Sign(alloc, header_canon.slice(), config.private_key_pem);
    defer alloc.free(signature);

    // Base64 encode signature
    const sig_b64_len = bun.base64.encodeLen(signature);
    const sig_b64 = try alloc.alloc(u8, sig_b64_len);
    defer alloc.free(sig_b64);
    const actual_sig_len = bun.base64.encode(sig_b64, signature);

    // 7. Build complete DKIM-Signature header value
    var result = bun.MutableString.initEmpty(alloc);
    const rw = result.writer();
    try rw.writeAll(sig_header.slice());
    try rw.writeAll(sig_b64[0..actual_sig_len]);

    return result.toOwnedSlice();
}

/// Prepend DKIM-Signature header to a message.
pub fn signMessage(alloc: std.mem.Allocator, message: []const u8, config: DKIMConfig) ![]const u8 {
    const dkim_value = try sign(alloc, message, config);
    defer alloc.free(dkim_value);

    var result = bun.MutableString.initEmpty(alloc);
    const w = result.writer();
    try w.writeAll("DKIM-Signature: ");
    try w.writeAll(dkim_value);
    try w.writeAll("\r\n");
    try w.writeAll(message);
    return result.toOwnedSlice();
}

// ============================================================================
// Internal helpers
// ============================================================================

fn findHeaderBodySeparator(message: []const u8) usize {
    if (std.mem.indexOf(u8, message, "\r\n\r\n")) |pos| return pos;
    if (std.mem.indexOf(u8, message, "\n\n")) |pos| return pos;
    return message.len;
}

fn findHeader(headers: []const u8, name: []const u8) ?[]const u8 {
    var pos: usize = 0;
    while (pos < headers.len) {
        const line_end = std.mem.indexOfPos(u8, headers, pos, "\r\n") orelse headers.len;
        const line = headers[pos..line_end];

        // Check if this line starts with the header name (case-insensitive)
        if (line.len > name.len and line[name.len] == ':') {
            if (std.ascii.eqlIgnoreCase(line[0..name.len], name)) {
                // Return value after ": "
                var val_start = name.len + 1;
                while (val_start < line.len and line[val_start] == ' ') : (val_start += 1) {}
                return line[val_start..];
            }
        }

        pos = if (line_end + 2 <= headers.len) line_end + 2 else headers.len;
    }
    return null;
}

fn writeCanonicalHeaderValue(writer: anytype, value: []const u8) !void {
    // Relaxed header canonicalization:
    // - Unfold header continuation lines
    // - Reduce all sequences of WSP to a single SP
    // - Remove trailing WSP
    var in_wsp = false;
    for (value) |c| {
        if (c == '\r' or c == '\n') continue;
        if (c == ' ' or c == '\t') {
            in_wsp = true;
        } else {
            if (in_wsp) {
                try writer.writeByte(' ');
                in_wsp = false;
            }
            try writer.writeByte(c);
        }
    }
}

fn canonicalizeBodyRelaxed(alloc: std.mem.Allocator, body: []const u8) ![]const u8 {
    var result = bun.MutableString.initEmpty(alloc);
    const writer = result.writer();

    // Relaxed body canonicalization:
    // - Reduce WSP sequences within lines to single SP
    // - Remove all trailing WSP from lines
    // - Remove all empty lines at end of body
    // - Ensure body ends with \r\n (if non-empty)

    var line_start: usize = 0;
    while (line_start < body.len) {
        const line_end = std.mem.indexOfPos(u8, body, line_start, "\r\n") orelse body.len;
        const line = body[line_start..line_end];

        // Write canonicalized line: compress WSP, trim trailing WSP
        var in_wsp = false;
        var written: usize = 0;
        for (line) |c| {
            if (c == ' ' or c == '\t') {
                in_wsp = true;
            } else {
                if (in_wsp and written > 0) {
                    try writer.writeByte(' ');
                    written += 1;
                }
                in_wsp = false;
                try writer.writeByte(c);
                written += 1;
            }
        }
        try writer.writeAll("\r\n");

        line_start = if (line_end + 2 <= body.len) line_end + 2 else body.len;
    }

    // Remove trailing empty lines
    var slice = result.slice();
    while (slice.len >= 4 and std.mem.eql(u8, slice[slice.len - 4 ..], "\r\n\r\n")) {
        result.list.items.len -= 2;
        slice = result.slice();
    }

    // Ensure ends with \r\n
    if (slice.len == 0 or !std.mem.endsWith(u8, slice, "\r\n")) {
        try writer.writeAll("\r\n");
    }

    return result.toOwnedSlice();
}

fn rsaSha256Sign(alloc: std.mem.Allocator, data: []const u8, private_key_pem: []const u8) ![]const u8 {
    const c = BoringSSL.c;

    // Load private key from PEM
    const bio = c.BIO_new_mem_buf(private_key_pem.ptr, @intCast(private_key_pem.len)) orelse return error.BIOCreateFailed;
    defer _ = c.BIO_free(bio);

    var pkey: [*c]c.EVP_PKEY = null;
    pkey = c.PEM_read_bio_PrivateKey(bio, &pkey, null, null);
    if (pkey == null) return error.PrivateKeyParseFailed;
    defer c.EVP_PKEY_free(pkey);

    // Create signing context
    const md_ctx = c.EVP_MD_CTX_new() orelse return error.MDContextCreateFailed;
    defer c.EVP_MD_CTX_free(md_ctx);

    if (c.EVP_DigestSignInit(md_ctx, null, c.EVP_sha256(), null, pkey) != 1) {
        return error.DigestSignInitFailed;
    }

    if (c.EVP_DigestSignUpdate(md_ctx, data.ptr, data.len) != 1) {
        return error.DigestSignUpdateFailed;
    }

    // Get signature length
    var sig_len: usize = 0;
    if (c.EVP_DigestSignFinal(md_ctx, null, &sig_len) != 1) {
        return error.DigestSignFinalFailed;
    }

    // Sign
    const sig_buf = try alloc.alloc(u8, sig_len);
    errdefer alloc.free(sig_buf);

    if (c.EVP_DigestSignFinal(md_ctx, sig_buf.ptr, &sig_len) != 1) {
        return error.DigestSignFinalFailed;
    }

    return sig_buf[0..sig_len];
}

const bun = @import("bun");
const std = @import("std");
