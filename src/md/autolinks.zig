pub fn isListBullet(c: u8) bool {
    return c == '-' or c == '+' or c == '*';
}

pub fn isListItemMark(c: u8) bool {
    return c == '-' or c == '+' or c == '*' or c == '.' or c == ')';
}

pub const AutolinkResult = ?struct {
    beg: usize,
    end: usize,
};

/// Check that emphasis chars at autolink boundaries are actually resolved delimiters.
/// Called when the relaxed (allow_emph) pass found an autolink but the strict pass didn't.
pub fn isEmphBoundaryResolved(content: []const u8, al: std.meta.Child(AutolinkResult), resolved: []const Parser.EmphDelim) bool {
    // Check left boundary: if it's an emphasis char, it must be a resolved delimiter
    if (al.beg > 0) {
        const prev = content[al.beg - 1];
        if (prev == '*' or prev == '_' or prev == '~') {
            if (!checkLeftBoundary(content, al.beg, false)) {
                // Left boundary failed strict check, emphasis char caused the relaxed match.
                // Verify it's actually resolved.
                var found_resolved = false;
                for (resolved) |d| {
                    if (d.pos <= al.beg - 1 and al.beg - 1 < d.pos + d.count and
                        (d.open_count + d.close_count > 0))
                    {
                        found_resolved = true;
                        break;
                    }
                }
                if (!found_resolved) return false;
            }
        }
    }
    // Check right boundary: if it's an emphasis char, it must be a resolved delimiter
    if (al.end < content.len) {
        const next = content[al.end];
        if (next == '*' or next == '_' or next == '~') {
            if (!checkRightBoundary(content, al.end, false)) {
                var found_resolved = false;
                for (resolved) |d| {
                    if (d.pos <= al.end and al.end < d.pos + d.count and
                        (d.open_count + d.close_count > 0))
                    {
                        found_resolved = true;
                        break;
                    }
                }
                if (!found_resolved) return false;
            }
        }
    }
    return true;
}

/// Scan a URL component (host, path, query, or fragment) following md4c's URL_MAP.
pub fn scanUrlComponent(
    content: []const u8,
    start: usize,
    start_char: u8,
    delim_char: u8,
    allowed_nonalnum: []const u8,
    min_components: u32,
    optional_end_char: u8,
) struct { end: usize, ok: bool } {
    var pos = start;
    var n_components: u32 = 0;
    // Check start character
    if (start_char != 0) {
        if (pos >= content.len or content[pos] != start_char)
            return .{ .end = pos, .ok = min_components == 0 };
        if (min_components > 0 and (pos + 1 >= content.len or !helpers.isAlphaNum(content[pos + 1])))
            return .{ .end = pos, .ok = min_components == 0 };
        pos += 1;
    }

    while (pos < content.len) {
        if (helpers.isAlphaNum(content[pos])) {
            if (n_components == 0)
                n_components = 1;
            pos += 1;
        } else if (isInSet(content[pos], allowed_nonalnum) and
            ((pos > 0 and (helpers.isAlphaNum(content[pos - 1]) or content[pos - 1] == ')' or isInSet(content[pos - 1], allowed_nonalnum))) or content[pos] == '(') and
            ((pos + 1 < content.len and (helpers.isAlphaNum(content[pos + 1]) or content[pos + 1] == '(' or isInSet(content[pos + 1], allowed_nonalnum))) or content[pos] == ')'))
        {
            if (content[pos] == delim_char)
                n_components += 1;
            pos += 1;
        } else {
            break;
        }
    }

    if (pos < content.len and optional_end_char != 0 and content[pos] == optional_end_char)
        pos += 1;

    if (n_components < min_components)
        return .{ .end = pos, .ok = false };

    return .{ .end = pos, .ok = true };
}

pub fn isInSet(c: u8, set: []const u8) bool {
    for (set) |s| {
        if (c == s) return true;
    }
    return false;
}

/// Check left boundary for permissive autolinks.
/// When `allow_emph` is true, emphasis delimiters (*_~) are also valid boundaries.
pub fn checkLeftBoundary(content: []const u8, pos: usize, allow_emph: bool) bool {
    if (pos == 0) return true;
    return switch (content[pos - 1]) {
        ' ', '\t', '\n', '\r', 0x0B, 0x0C => true,
        '(', '{', '[' => true,
        '*', '_', '~' => allow_emph,
        else => false,
    };
}

/// Check right boundary for permissive autolinks.
/// When `allow_emph` is true, emphasis delimiters (*_~) are also valid boundaries.
pub fn checkRightBoundary(content: []const u8, pos: usize, allow_emph: bool) bool {
    if (pos >= content.len) return true;
    return switch (content[pos]) {
        ' ', '\t', '\n', '\r', 0x0B, 0x0C => true,
        ')', '}', ']', '<' => true,
        '.', '!', '?', ',', ';', '&' => true,
        '*', '_', '~' => allow_emph,
        else => false,
    };
}

/// Detect permissive autolinks at the given position in content.
/// `pos` is the position of the trigger character ('@', ':', or '.').
pub fn findPermissiveAutolink(content: []const u8, pos: usize, allow_emph: bool) AutolinkResult {
    if (pos >= content.len) return null;
    const c = content[pos];

    if (c == ':') {
        // URL autolink: check for http://, https://, ftp://
        const Scheme = struct { name: []const u8, suffix: []const u8 };
        const schemes = [_]Scheme{
            .{ .name = "http", .suffix = "//" },
            .{ .name = "https", .suffix = "//" },
            .{ .name = "ftp", .suffix = "//" },
        };

        for (schemes) |scheme| {
            const slen = scheme.name.len;
            const suflen = scheme.suffix.len;
            if (pos >= slen and pos + 1 + suflen < content.len) {
                if (helpers.asciiCaseEql(content[pos - slen .. pos], scheme.name) and
                    std.mem.eql(u8, content[pos + 1 .. pos + 1 + suflen], scheme.suffix))
                {
                    const beg = pos - slen;
                    if (!checkLeftBoundary(content, beg, allow_emph)) continue;

                    var end = pos + 1 + suflen;
                    // Scan URL components: host (mandatory), path, query, fragment
                    const host = scanUrlComponent(content, end, 0, '.', ".-_", 2, 0);
                    if (!host.ok) continue;
                    end = host.end;

                    const path = scanUrlComponent(content, end, '/', '/', "/.-_~*+%", 0, '/');
                    end = path.end;

                    const query = scanUrlComponent(content, end, '?', '&', "&.-+_=()~*%", 1, 0);
                    end = query.end;

                    const frag = scanUrlComponent(content, end, '#', 0, ".-+_~*%", 1, 0);
                    end = frag.end;

                    end = postProcessAutolinkEnd(content, beg, end);

                    if (!checkRightBoundary(content, end, allow_emph)) continue;

                    return .{ .beg = beg, .end = end };
                }
            }
        }
    } else if (c == '@') {
        // Email autolink: scan backward for username, forward for domain
        if (pos == 0 or pos + 3 >= content.len) return null;
        if (!helpers.isAlphaNum(content[pos - 1]) or !helpers.isAlphaNum(content[pos + 1]))
            return null;

        // Scan backward for username
        var beg = pos;
        while (beg > 0) {
            if (helpers.isAlphaNum(content[beg - 1])) {
                beg -= 1;
            } else if (beg >= 2 and helpers.isAlphaNum(content[beg - 2]) and
                isInSet(content[beg - 1], ".-_+") and helpers.isAlphaNum(content[beg]))
            {
                beg -= 1;
            } else {
                break;
            }
        }
        if (beg == pos) return null; // empty username

        if (!checkLeftBoundary(content, beg, allow_emph)) return null;

        // Scan forward for domain (host component only for email)
        const host = scanUrlComponent(content, pos + 1, 0, '.', ".-_", 2, 0);
        if (!host.ok) return null;
        const end = host.end;

        if (!checkRightBoundary(content, end, allow_emph)) return null;

        return .{ .beg = beg, .end = end };
    } else if (c == '.') {
        // WWW autolink: check for "www." prefix
        if (pos < 3) return null;
        if (!helpers.asciiCaseEql(content[pos - 3 .. pos], "www"))
            return null;

        const beg = pos - 3;
        if (!checkLeftBoundary(content, beg, allow_emph)) return null;

        // Scan URL components starting from after the '.'
        var end = pos + 1;
        const host = scanUrlComponent(content, end, 0, '.', ".-_", 1, 0);
        if (!host.ok) return null;
        end = host.end;

        const path = scanUrlComponent(content, end, '/', '/', "/.-_~*+%", 0, '/');
        end = path.end;

        const query = scanUrlComponent(content, end, '?', '&', "&.-+_=()~*%", 1, 0);
        end = query.end;

        const frag = scanUrlComponent(content, end, '#', 0, ".-+_~*%", 1, 0);
        end = frag.end;

        end = postProcessAutolinkEnd(content, beg, end);

        if (!checkRightBoundary(content, end, allow_emph)) return null;

        return .{ .beg = beg, .end = end };
    }

    return null;
}

/// GFM post-processing: trim trailing unbalanced `)` and entity-like suffixes from autolink URLs.
fn postProcessAutolinkEnd(content: []const u8, beg: usize, end_in: usize) usize {
    var end = end_in;

    // Trim trailing entity-like suffixes.
    // GFM spec: "If an autolink ends in a semicolon (;), we check to see if it
    // appears to resemble an entity reference; if the preceding text is &
    // followed by one or more alphanumeric characters."
    // Case 1: URL itself ends with `;` (e.g., `&hl;` was fully scanned)
    if (end > beg and content[end - 1] == ';') {
        var j = end - 2;
        while (j > beg and helpers.isAlphaNum(content[j])) j -= 1;
        if (j >= beg and content[j] == '&') {
            end = j;
        }
    }
    // Case 2: `;` is the next char after URL end (scanner stopped before `;`)
    // e.g., URL = `commonmark&hl`, next char is `;` → trim `&hl`
    if (end < content.len and content[end] == ';' and end > beg) {
        var j = end - 1;
        while (j > beg and helpers.isAlphaNum(content[j])) j -= 1;
        if (j >= beg and content[j] == '&') {
            end = j;
        }
    }

    // Trim trailing unbalanced `)`: count all ( and ) in the URL.
    // If closing > opening, remove trailing ) until balanced.
    while (end > beg and content[end - 1] == ')') {
        var open: i32 = 0;
        var close: i32 = 0;
        for (content[beg..end]) |ch| {
            if (ch == '(') open += 1;
            if (ch == ')') close += 1;
        }
        if (close > open) {
            end -= 1;
        } else {
            break;
        }
    }

    return end;
}

const helpers = @import("./helpers.zig");
const parser_mod = @import("./parser.zig");
const std = @import("std");

const Parser = parser_mod.Parser;
const EmphDelim = Parser.EmphDelim;
