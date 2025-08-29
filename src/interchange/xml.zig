const std = @import("std");
const bun = @import("bun");
const logger = bun.logger;
const Expr = bun.ast.Expr;
const E = bun.ast.E;
const G = bun.ast.G;

pub const XML = struct {
    const ParseError = error{ OutOfMemory, SyntaxError, StackOverflow };

    pub fn parse(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) ParseError!Expr {
        if (source.contents.len == 0) {
            return Expr.init(E.Null, .{}, .Empty);
        }
        
        var parser = Parser{
            .source = source,
            .log = log,
            .allocator = allocator,
            .current = 0,
            .line = 1,
            .column = 1,
        };

        return parser.parseDocument() catch |err| switch (err) {
            error.XMLParseError => error.SyntaxError,
            else => |e| e,
        };
    }
};

const Parser = struct {
    source: *const logger.Source,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    current: usize,
    line: u32,
    column: u32,

    fn parseDocument(self: *Parser) !Expr {
        self.skipWhitespace();
        
        // Skip XML declaration if present
        if (self.current + 5 < self.source.contents.len and std.mem.startsWith(u8, self.source.contents[self.current..], "<?xml")) {
            while (self.current < self.source.contents.len and !std.mem.startsWith(u8, self.source.contents[self.current..], "?>")) {
                self.advance();
            }
            if (self.current + 1 < self.source.contents.len) {
                self.advance(); // skip '?'
                self.advance(); // skip '>'
            }
            self.skipWhitespace();
        }
        
        if (self.current >= self.source.contents.len) {
            return self.parseError("No root element found");
        }
        
        return self.parseElement();
    }

    fn parseElement(self: *Parser) !Expr {
        // Very simple implementation for now - just handle <tag>text</tag>
        if (self.current >= self.source.contents.len or self.source.contents[self.current] != '<') {
            return self.parseError("Expected '<' to start element");
        }
        self.advance(); // consume '<'

        // Get tag name
        const tag_start = self.current;
        while (self.current < self.source.contents.len and self.source.contents[self.current] != '>' and self.source.contents[self.current] != ' ') {
            self.advance();
        }
        
        if (self.current == tag_start) {
            return self.parseError("Expected element name");
        }

        _ = self.source.contents[tag_start..self.current]; // tag name not used in simplified version
        
        // Skip attributes for now
        while (self.current < self.source.contents.len and self.source.contents[self.current] != '>') {
            self.advance();
        }
        
        if (self.current >= self.source.contents.len) {
            return self.parseError("Expected '>' to close opening tag");
        }
        self.advance(); // consume '>'

        // Get text content
        const text_start = self.current;
        while (self.current < self.source.contents.len and self.source.contents[self.current] != '<') {
            self.advance();
        }
        
        const text_content = self.source.contents[text_start..self.current];
        const trimmed = std.mem.trim(u8, text_content, " \t\n\r");

        // Skip closing tag
        if (self.current < self.source.contents.len and self.source.contents[self.current] == '<') {
            self.advance(); // consume '<'
            if (self.current < self.source.contents.len and self.source.contents[self.current] == '/') {
                self.advance(); // consume '/'
                // Skip tag name
                while (self.current < self.source.contents.len and self.source.contents[self.current] != '>') {
                    self.advance();
                }
                if (self.current < self.source.contents.len) {
                    self.advance(); // consume '>'
                }
            }
        }

        // Return the text content as a string
        if (trimmed.len > 0) {
            return try self.createStringExpr(trimmed);
        } else {
            return try self.createStringExpr("");
        }
    }


    fn createStringExpr(self: *Parser, slice: []const u8) !Expr {
        const string_data = try self.allocator.dupe(u8, slice);
        return Expr.init(E.String, .{ .data = string_data }, .Empty);
    }

    fn skipWhitespace(self: *Parser) void {
        while (self.current < self.source.contents.len) {
            const c = self.source.contents[self.current];
            if (c == ' ' or c == '\t' or c == '\n' or c == '\r') {
                if (c == '\n') {
                    self.line += 1;
                    self.column = 1;
                } else {
                    self.column += 1;
                }
                self.current += 1;
            } else {
                break;
            }
        }
    }


    fn advance(self: *Parser) void {
        if (self.current < self.source.contents.len) {
            if (self.source.contents[self.current] == '\n') {
                self.line += 1;
                self.column = 1;
            } else {
                self.column += 1;
            }
            self.current += 1;
        }
    }

    fn parseError(self: *Parser, msg: []const u8) error{XMLParseError} {
        self.log.addError(
            self.source,
            logger.Loc{ .start = @intCast(self.current) },
            msg,
        ) catch {};
        return error.XMLParseError;
    }
};

