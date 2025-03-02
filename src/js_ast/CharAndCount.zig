//! Utility struct for tracking character frequency in code minification

/// Number of characters to track in frequency analysis
pub const char_freq_count = 64;

/// Structure for tracking character frequency with sorting capabilities
/// The character being tracked
char: u8 = 0,

/// The number of occurrences of this character
count: i32 = 0,

/// Original index position for stable sorting
index: usize = 0,

/// Type alias for an array of character counts
pub const Array = [char_freq_count]CharAndCount;

/// Comparison function for sorting characters by frequency
/// Sort by count (descending), then by index (ascending), then by character value
pub fn lessThan(_: void, a: CharAndCount, b: CharAndCount) bool {
    if (a.count != b.count) {
        return a.count > b.count;
    }

    if (a.index != b.index) {
        return a.index < b.index;
    }

    return a.char < b.char;
}

const CharAndCount = @This();
