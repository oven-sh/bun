//! Alt-Svc (RFC 7838) header handling for the HTTP/3 client.
//!
//! When `--experimental-http3-fetch` / `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT`
//! is on, `handleResponseMetadata` calls `record()` for every `Alt-Svc` header
//! and `start_()` calls `lookup()` before opening a TCP socket: if the origin
//! previously advertised `h3`, the request is routed onto the QUIC engine
//! instead. The cache is keyed on the *origin* authority (the host:port the
//! request was sent to) and lives only on the HTTP thread, so it needs no
//! locking.
//!
//! Only same-host alternatives (`h3=":port"` with an empty uri-host) are
//! honored; cross-host alternatives need extra certificate-authority checks
//! (RFC 7838 §2.1) that are out of scope here.

/// One advertised `h3` alternative from an `Alt-Svc` field-value. `port` is
/// the alt-authority port (where QUIC should connect); `ma` is the freshness
/// lifetime in seconds (default 24 h per §3.1).
pub const Entry = struct {
    port: u16,
    ma: u32 = 86400,
};

/// Parse the first usable `h3` alternative out of an `Alt-Svc` field-value, or
/// `null` if none / `clear`. Tolerant of extra whitespace and unknown params.
///
///   Alt-Svc       = clear / 1#alt-value
///   alt-value     = protocol-id "=" alt-authority *( OWS ";" OWS parameter )
///   alt-authority = quoted-string containing [uri-host] ":" port
///
/// Returns `error.Clear` for the literal `clear` so the caller can drop the
/// cache entry.
pub fn parse(field_value: []const u8) error{Clear}!?Entry {
    const value = strings.trim(field_value, " \t");
    if (value.len == 0) return null;
    if (std.ascii.eqlIgnoreCase(value, "clear")) return error.Clear;

    var entries = std.mem.splitScalar(u8, value, ',');
    while (entries.next()) |raw_entry| {
        const entry = strings.trim(raw_entry, " \t");
        if (entry.len == 0) continue;

        var params = std.mem.splitScalar(u8, entry, ';');
        const alternative = strings.trim(params.first(), " \t");

        const eq = strings.indexOfChar(alternative, '=') orelse continue;
        const proto = alternative[0..eq];
        // Only the final IETF "h3" ALPN token; draft `h3-NN` versions are
        // ignored since lsquic is built for the final spec.
        if (!std.ascii.eqlIgnoreCase(proto, "h3")) continue;

        // alt-authority is a quoted-string: `":443"` or `"host:443"`.
        var auth = strings.trim(alternative[eq + 1 ..], " \t");
        if (auth.len >= 2 and auth[0] == '"' and auth[auth.len - 1] == '"') {
            auth = auth[1 .. auth.len - 1];
        }
        const colon = std.mem.lastIndexOfScalar(u8, auth, ':') orelse continue;
        // Same-host alternatives only (empty uri-host).
        if (colon != 0) continue;
        const port = std.fmt.parseInt(u16, auth[colon + 1 ..], 10) catch continue;
        if (port == 0) continue;

        var result: Entry = .{ .port = port };
        while (params.next()) |raw_param| {
            const param = strings.trim(raw_param, " \t");
            const peq = strings.indexOfChar(param, '=') orelse continue;
            if (std.ascii.eqlIgnoreCase(param[0..peq], "ma")) {
                result.ma = std.fmt.parseInt(u32, param[peq + 1 ..], 10) catch result.ma;
            }
            // `persist` and unknown parameters are ignored (§3.1).
        }
        return result;
    }
    return null;
}

/// HTTP-thread-only Alt-Svc cache. Key is `"hostname:port"` of the origin the
/// header was received from; value is the advertised h3 port + expiry.
const Record = struct {
    h3_port: u16,
    expires_at: i64,
};

var cache: std.StringHashMapUnmanaged(Record) = .{};

fn key(buf: []u8, hostname: []const u8, port: u16) []const u8 {
    return std.fmt.bufPrint(buf, "{s}:{d}", .{ hostname, port }) catch buf;
}

/// Remember (or refresh / clear) the h3 alternative for `origin_host:origin_port`
/// from a received `Alt-Svc` field-value. Runs on the HTTP thread inside
/// `handleResponseMetadata`.
pub fn record(origin_host: []const u8, origin_port: u16, field_value: []const u8) void {
    var buf: [256 + 8]u8 = undefined;
    if (origin_host.len > 256) return;
    const k = key(&buf, origin_host, origin_port);

    const entry = parse(field_value) catch {
        // `clear`
        if (cache.fetchRemove(k)) |kv| bun.default_allocator.free(kv.key);
        log("alt-svc clear {s}", .{k});
        return;
    } orelse return;

    const gop = bun.handleOom(cache.getOrPut(bun.default_allocator, k));
    if (!gop.found_existing) {
        gop.key_ptr.* = bun.handleOom(bun.default_allocator.dupe(u8, k));
    }
    gop.value_ptr.* = .{
        .h3_port = entry.port,
        .expires_at = std.time.timestamp() + @as(i64, entry.ma),
    };
    log("alt-svc h3 {s} -> :{d} ma={d}", .{ k, entry.port, entry.ma });
}

/// Look up a previously-advertised h3 alternative for `origin_host:origin_port`.
/// Expired entries are dropped on access. Runs on the HTTP thread inside
/// `start_()`.
pub fn lookup(origin_host: []const u8, origin_port: u16) ?u16 {
    var buf: [256 + 8]u8 = undefined;
    if (origin_host.len > 256) return null;
    const k = key(&buf, origin_host, origin_port);
    const rec = cache.get(k) orelse return null;
    if (std.time.timestamp() > rec.expires_at) {
        if (cache.fetchRemove(k)) |kv| bun.default_allocator.free(kv.key);
        return null;
    }
    return rec.h3_port;
}

const log = bun.Output.scoped(.h3_client, .hidden);

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
