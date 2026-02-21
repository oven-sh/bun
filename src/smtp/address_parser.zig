/// RFC 5322 email address parser (ported from nodemailer/lib/addressparser).
/// Parses structured email addresses from address field strings.
const MAX_NESTED_GROUP_DEPTH = 50;

pub const Address = struct {
    name: []const u8 = "",
    address: []const u8 = "",
};

pub const Group = struct {
    name: []const u8 = "",
    members: []Address = &.{},
};

pub const ParsedAddress = union(enum) {
    address: Address,
    group: Group,
};

/// Parse an email address string into structured address objects.
pub fn parse(alloc: std.mem.Allocator, input: []const u8) ![]ParsedAddress {
    return parseWithDepth(alloc, input, 0);
}

const ParseError = std.mem.Allocator.Error || error{ JSError, JSTerminated };

fn parseWithDepth(alloc: std.mem.Allocator, input: []const u8, depth: u32) ParseError![]ParsedAddress {
    if (depth > MAX_NESTED_GROUP_DEPTH) return try alloc.alloc(ParsedAddress, 0);
    if (input.len == 0) return try alloc.alloc(ParsedAddress, 0);

    const tokens = try tokenize(alloc, input);

    // Split by , and ; delimiters
    var result_buf: [512]ParsedAddress = undefined;
    var result_count: usize = 0;

    var group_start: usize = 0;
    for (tokens, 0..) |tok, i| {
        if (tok.kind == .operator and tok.value.len == 1 and (tok.value[0] == ',' or tok.value[0] == ';')) {
            if (i > group_start) {
                const parsed = try handleAddress(alloc, tokens[group_start..i], depth);
                for (parsed) |p| {
                    if (result_count < result_buf.len) {
                        result_buf[result_count] = p;
                        result_count += 1;
                    }
                }
                alloc.free(parsed);
            }
            group_start = i + 1;
        }
    }
    if (group_start < tokens.len) {
        const parsed = try handleAddress(alloc, tokens[group_start..], depth);
        for (parsed) |p| {
            if (result_count < result_buf.len) {
                result_buf[result_count] = p;
                result_count += 1;
            }
        }
        alloc.free(parsed);
    }

    const result = try alloc.alloc(ParsedAddress, result_count);
    @memcpy(result, result_buf[0..result_count]);
    return result;
}

/// Extract just the email address from a potentially complex address string.
pub fn extractEmail(addr: []const u8) []const u8 {
    if (std.mem.lastIndexOfScalar(u8, addr, '<')) |start| {
        if (std.mem.indexOfScalarPos(u8, addr, start, '>')) |end| {
            return addr[start + 1 .. end];
        }
    }
    return std.mem.trim(u8, addr, " \t");
}

// ============================================================================
// Tokenizer
// ============================================================================

const TokenKind = enum { operator, text };
const Token = struct { kind: TokenKind, value: []const u8, no_break: bool = false, was_quoted: bool = false };

fn tokenize(alloc: std.mem.Allocator, input: []const u8) ![]Token {
    // Pre-allocate worst case
    var tokens = try alloc.alloc(Token, input.len);
    var token_count: usize = 0;

    var val = bun.MutableString.initEmpty(alloc);

    var op_expecting: u8 = 0;
    var escaped = false;
    var in_text = false;

    var i: usize = 0;
    while (i < input.len) : (i += 1) {
        const chr = input[i];
        const next: u8 = if (i + 1 < input.len) input[i + 1] else 0;

        if (escaped) {
            escaped = false;
            try val.writer().writeByte(chr);
            continue;
        }

        // Closing operator match
        if (op_expecting != 0 and chr == op_expecting) {
            // Flush text
            const trimmed = std.mem.trim(u8, val.slice(), " \t");
            if (trimmed.len > 0) {
                tokens[token_count] = .{ .kind = .text, .value = try alloc.dupe(u8, trimmed), .was_quoted = op_expecting == '"' };
                token_count += 1;
            }
            val.list.clearRetainingCapacity();

            const no_break = next != 0 and next != ' ' and next != '\t' and next != ',' and next != ';';
            tokens[token_count] = .{ .kind = .operator, .value = try alloc.dupe(u8, &[_]u8{chr}), .no_break = no_break };
            token_count += 1;
            op_expecting = 0;
            in_text = false;
            continue;
        }

        // Inside operator pair
        if (op_expecting != 0) {
            if (op_expecting == '"' and chr == '\\') {
                escaped = true;
                continue;
            }
            if (chr == '\r') continue;
            try val.writer().writeByte(if (chr == '\n') ' ' else chr);
            continue;
        }

        // Opening operators
        const expecting: u8 = switch (chr) {
            '"' => '"',
            '(' => ')',
            '<' => '>',
            ',' => 0,
            ':' => ';',
            ';' => 0,
            else => 255,
        };

        if (expecting != 255) {
            // Flush current text
            const trimmed = std.mem.trim(u8, val.slice(), " \t");
            if (trimmed.len > 0) {
                tokens[token_count] = .{ .kind = .text, .value = try alloc.dupe(u8, trimmed) };
                token_count += 1;
            }
            val.list.clearRetainingCapacity();
            in_text = false;

            tokens[token_count] = .{ .kind = .operator, .value = try alloc.dupe(u8, &[_]u8{chr}) };
            token_count += 1;
            op_expecting = expecting;
            continue;
        }

        // Regular text
        if (!in_text) in_text = true;
        if (chr == '\n') {
            try val.writer().writeByte(' ');
        } else if (chr != '\r' and (chr >= 0x21 or chr == ' ' or chr == '\t')) {
            try val.writer().writeByte(chr);
        }
    }

    // Flush remaining
    const trimmed = std.mem.trim(u8, val.slice(), " \t");
    if (trimmed.len > 0) {
        tokens[token_count] = .{ .kind = .text, .value = try alloc.dupe(u8, trimmed) };
        token_count += 1;
    }
    val.deinit();

    // Shrink to actual size
    if (token_count < tokens.len) {
        tokens = try alloc.realloc(tokens, token_count);
    }
    return tokens[0..token_count];
}

// ============================================================================
// Address handler
// ============================================================================

fn handleAddress(alloc: std.mem.Allocator, tokens: []const Token, depth: u32) ParseError![]ParsedAddress {
    var addr_buf: [64][]const u8 = undefined;
    var addr_count: usize = 0;
    var text_buf: [64][]const u8 = undefined;
    var text_count: usize = 0;
    var text_quoted_buf: [64]bool = undefined;
    var comment_buf: [64][]const u8 = undefined;
    var comment_count: usize = 0;
    var group_buf: [256][]const u8 = undefined;
    var group_count: usize = 0;

    var is_group = false;
    var state: enum { text, address, comment, group } = .text;
    var in_quotes = false;

    for (tokens) |tok| {
        if (tok.kind == .operator and tok.value.len == 1) {
            switch (tok.value[0]) {
                '<' => {
                    state = .address;
                    in_quotes = false;
                    continue;
                },
                '(' => {
                    state = .comment;
                    in_quotes = false;
                    continue;
                },
                ':' => {
                    state = .group;
                    is_group = true;
                    in_quotes = false;
                    continue;
                },
                '"' => {
                    in_quotes = !in_quotes;
                    state = .text;
                    continue;
                },
                '>', ')' => {
                    state = .text;
                    in_quotes = false;
                    continue;
                },
                else => {
                    state = .text;
                    in_quotes = false;
                    continue;
                },
            }
        }
        if (tok.kind == .operator) continue;

        switch (state) {
            .address => if (addr_count < addr_buf.len) {
                addr_buf[addr_count] = tok.value;
                addr_count += 1;
            },
            .comment => if (comment_count < comment_buf.len) {
                comment_buf[comment_count] = tok.value;
                comment_count += 1;
            },
            .group => if (group_count < group_buf.len) {
                group_buf[group_count] = tok.value;
                group_count += 1;
            },
            .text => if (text_count < text_buf.len) {
                text_buf[text_count] = tok.value;
                text_quoted_buf[text_count] = in_quotes or tok.was_quoted;
                text_count += 1;
            },
        }
    }

    // If no text but has comments, use comments as text
    if (text_count == 0 and comment_count > 0) {
        for (comment_buf[0..comment_count], 0..) |c, ci| {
            if (text_count < text_buf.len) {
                text_buf[text_count] = c;
                text_quoted_buf[text_count] = false;
                text_count += 1;
            }
            _ = ci;
        }
    }

    var result = try alloc.alloc(ParsedAddress, 1);
    var result_count: usize = 0;

    if (is_group) {
        const group_str = try std.mem.join(alloc, ",", group_buf[0..group_count]);
        defer alloc.free(group_str);
        const members_parsed = try parseWithDepth(alloc, group_str, depth + 1);
        defer alloc.free(members_parsed);

        // Flatten and count
        var member_count: usize = 0;
        for (members_parsed) |m| {
            switch (m) {
                .address => member_count += 1,
                .group => |g| member_count += g.members.len,
            }
        }

        const members = try alloc.alloc(Address, member_count);
        var mi: usize = 0;
        for (members_parsed) |m| {
            switch (m) {
                .address => |a| {
                    members[mi] = a;
                    mi += 1;
                },
                .group => |g| {
                    for (g.members) |gm| {
                        members[mi] = gm;
                        mi += 1;
                    }
                },
            }
        }

        const name = try std.mem.join(alloc, " ", text_buf[0..text_count]);
        result[0] = .{ .group = .{ .name = name, .members = members } };
        result_count = 1;
    } else {
        var address: []const u8 = "";
        if (addr_count > 0) {
            // Fix Bug 2: strip content before last '<' in address
            var raw_addr = addr_buf[0];
            if (std.mem.lastIndexOfScalar(u8, raw_addr, '<')) |lt| {
                raw_addr = std.mem.trim(u8, raw_addr[lt + 1 ..], " \t");
            }
            address = raw_addr;
        } else if (text_count > 0) {
            // Fix Bug 3: if a quoted text is followed by @domain text, concatenate them
            if (text_count >= 2) {
                var ci: usize = 0;
                while (ci + 1 < text_count) : (ci += 1) {
                    if (text_quoted_buf[ci] and !text_quoted_buf[ci + 1] and
                        text_buf[ci + 1].len > 0 and text_buf[ci + 1][0] == '@')
                    {
                        // Concatenate: "quoted" + "@domain" = "quoted@domain"
                        const joined = try std.fmt.allocPrint(alloc, "{s}{s}", .{ text_buf[ci], text_buf[ci + 1] });
                        address = joined;
                        // Remove both tokens
                        var k2 = ci;
                        while (k2 + 2 < text_count) : (k2 += 1) {
                            text_buf[k2] = text_buf[k2 + 2];
                            text_quoted_buf[k2] = text_quoted_buf[k2 + 2];
                        }
                        text_count -= 2;
                        break;
                    }
                }
            }

            // Look for email in non-quoted text (security: don't extract from quoted strings)
            // Skip if already found address via quoted+domain concatenation above
            var idx: usize = if (address.len > 0) 0 else text_count;
            while (idx > 0) {
                idx -= 1;
                if (!text_quoted_buf[idx] and std.mem.indexOfScalar(u8, text_buf[idx], '@') != null) {
                    // Fix Bug 1: if the token contains spaces, extract just the email part
                    const token = text_buf[idx];
                    if (std.mem.indexOfAny(u8, token, " \t") != null) {
                        // Split: find the word containing @
                        var words_iter = std.mem.splitAny(u8, token, " \t");
                        var remaining_parts: [64][]const u8 = undefined;
                        var remaining_count: usize = 0;
                        var found_email: ?[]const u8 = null;
                        while (words_iter.next()) |word| {
                            if (found_email == null and std.mem.indexOfScalar(u8, word, '@') != null) {
                                found_email = word;
                            } else if (word.len > 0) {
                                if (remaining_count < remaining_parts.len) {
                                    remaining_parts[remaining_count] = word;
                                    remaining_count += 1;
                                }
                            }
                        }
                        if (found_email) |email| {
                            address = email;
                            // Replace the original token with the remaining text parts
                            if (remaining_count > 0) {
                                text_buf[idx] = try std.mem.join(alloc, " ", remaining_parts[0..remaining_count]);
                                text_quoted_buf[idx] = false;
                            } else {
                                var j = idx;
                                while (j + 1 < text_count) : (j += 1) {
                                    text_buf[j] = text_buf[j + 1];
                                    text_quoted_buf[j] = text_quoted_buf[j + 1];
                                }
                                text_count -= 1;
                            }
                            break;
                        }
                    } else {
                        address = token;
                        var j = idx;
                        while (j + 1 < text_count) : (j += 1) {
                            text_buf[j] = text_buf[j + 1];
                            text_quoted_buf[j] = text_quoted_buf[j + 1];
                        }
                        text_count -= 1;
                        break;
                    }
                }
            }

            // Fix Bug 4: if still no address and ALL text is quoted, check if it contains @
            if (address.len == 0) {
                var all_quoted = true;
                for (text_quoted_buf[0..text_count]) |q| {
                    if (!q) {
                        all_quoted = false;
                        break;
                    }
                }
                if (all_quoted and text_count > 0) {
                    for (text_buf[0..text_count], 0..) |t, ti| {
                        if (std.mem.indexOfScalar(u8, t, '@') != null) {
                            address = t;
                            var j = ti;
                            while (j + 1 < text_count) : (j += 1) {
                                text_buf[j] = text_buf[j + 1];
                                text_quoted_buf[j] = text_quoted_buf[j + 1];
                            }
                            text_count -= 1;
                            break;
                        }
                    }
                }
            }
        }

        var name = try std.mem.join(alloc, " ", text_buf[0..text_count]);
        // If no display name found but we have comments, use the first comment
        if (name.len == 0 and comment_count > 0) {
            alloc.free(name);
            name = try alloc.dupe(u8, comment_buf[0]);
        }

        if (std.mem.eql(u8, name, address)) {
            if (std.mem.indexOfScalar(u8, address, '@') != null) {
                result[0] = .{ .address = .{ .name = "", .address = address } };
            } else {
                result[0] = .{ .address = .{ .name = name, .address = "" } };
            }
        } else {
            result[0] = .{ .address = .{ .name = name, .address = address } };
        }
        result_count = 1;
    }

    return result[0..result_count];
}

const bun = @import("bun");
const std = @import("std");
