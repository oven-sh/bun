const std = @import("std");

pub const ReusableBuffer = @import("buffer/reusable_buffer.zig").ReusableBuffer;
pub const EnvStream = @import("parser/env_stream.zig").EnvStream;
pub const EnvKey = @import("data/env_key.zig").EnvKey;
pub const EnvValue = @import("data/env_value.zig").EnvValue;
pub const EnvPair = @import("data/env_pair.zig").EnvPair;
pub const VariablePosition = @import("data/variable_position.zig").VariablePosition;
pub const ReadResult = @import("data/read_result.zig").ReadResult;
// FinalizeResult was likely in result_enums too, need to check if it's there.
// Re-export read_result.zig might have it.
pub const file_scanner = @import("parser/file_scanner.zig");
pub const ParserOptions = @import("data/parser_options.zig").ParserOptions;
pub const ManagedList = @import("data/managed_list.zig").ManagedList;
pub const EnvPairList = @import("data/env_pair_list.zig").EnvPairList;
pub const VariablePositionList = @import("data/variable_position_list.zig").VariablePositionList;

// Public API from lib.zig (which is still in src/)
pub const parse = @import("lib.zig").parse;
pub const parseFile = @import("lib.zig").parseFile;
pub const parseFileWithOptions = @import("lib.zig").parseFileWithOptions;
pub const parseString = @import("lib.zig").parseString;
pub const parseStringWithOptions = @import("lib.zig").parseStringWithOptions;
pub const parseReader = @import("lib.zig").parseReader;
pub const parseReaderWithOptions = @import("lib.zig").parseReaderWithOptions;
pub const Env = @import("data/env.zig").Env;
pub const reader = struct {
    pub const readKey = @import("parser/read_key.zig").readKey;
    pub const readValue = @import("parser/read_value.zig").readValue;
    pub const readPair = @import("parser/read_pair.zig").readPair;
    pub const readPairs = @import("parser/read_pair.zig").readPairs;
    pub const readPairsWithHints = @import("parser/read_pair.zig").readPairsWithHints;
    pub const readPairsWithOptions = @import("parser/read_pair.zig").readPairsWithOptions;
    pub const readNextChar = @import("parser/read_next_char.zig").readNextChar;
};

// Internal modules for benchmarking/testing
pub const internal = struct {
    pub const quote_parser = @import("parser/quote_parser.zig");
    pub const escape_processor = @import("parser/escape_processor.zig");
    pub const interpolation = @import("interpolation/interpolation.zig");
};

// Exporting sub-modules if needed, or just let them be internal.
// Tests need to cover all files.
test {
    _ = @import("buffer/reusable_buffer.zig");
    _ = @import("parser/env_stream.zig");
    _ = @import("data/env_key.zig");
    _ = @import("data/env_value.zig");
    _ = @import("data/env_pair.zig");
    _ = @import("data/variable_position.zig");
    _ = @import("data/read_result.zig");
    _ = @import("buffer/buffer_utils.zig");
    _ = @import("utils/whitespace_utils.zig");
    _ = @import("parser/escape_processor.zig");
    _ = @import("parser/quote_parser.zig");
    _ = @import("interpolation/interpolation.zig");
    _ = @import("interpolation/finalizer.zig");

    // New parser files
    _ = @import("parser/read_next_char.zig");
    _ = @import("parser/read_key.zig");
    _ = @import("parser/read_value.zig");
    _ = @import("parser/read_pair.zig");

    _ = @import("buffer/memory_utils.zig");
    _ = @import("lib.zig");
    _ = @import("parser/file_scanner.zig");
    _ = @import("data/parser_options.zig");
    _ = @import("data/env.zig");
    _ = @import("data/managed_list.zig");
    _ = @import("data/env_pair_list.zig");
    _ = @import("data/variable_position_list.zig");
}
