//! Source span representation for tracking code locations
const std = @import("std");
const bun = @import("root").bun;
const logger = bun.logger;
const string = bun.string;

/// Represents a span of source code text with location information
const Span = @This();

/// The text content of the span
text: string = "",

/// Source location range information
range: logger.Range = .{},

/// Initialize a new span with text and range
pub fn init(text_: string, range_: logger.Range) Span {
    return .{
        .text = text_,
        .range = range_,
    };
}

/// Create an empty span
pub fn empty() Span {
    return .{};
}
