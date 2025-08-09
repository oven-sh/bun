// Complete JIS X 0208 character mapping table (WebKit-compatible)
// Auto-generated from WHATWG index-jis0208.txt
// Total entries: 11104, Non-zero entries: 7724

/// JIS X 0208 character mapping table as embedded binary data
/// Each codepoint is stored as 3 bytes (little-endian)
const JIS0208_TABLE_BYTES: []const u8 = @embedFile("jis0208_table.bin");

/// Get Unicode codepoint for JIS X 0208 pointer (WebKit-compatible)
/// Returns null if pointer is invalid or unmapped  
pub fn getJIS0208CodePoint(pointer: u16) ?u21 {
    if (pointer >= 11104) return null;
    
    const base_offset = @as(usize, pointer) * 3;
    if (base_offset + 2 >= JIS0208_TABLE_BYTES.len) return null;
    
    // Read 3-byte little-endian value
    const byte0 = JIS0208_TABLE_BYTES[base_offset];
    const byte1 = JIS0208_TABLE_BYTES[base_offset + 1];  
    const byte2 = JIS0208_TABLE_BYTES[base_offset + 2];
    
    const codepoint = @as(u21, byte0) | (@as(u21, byte1) << 8) | (@as(u21, byte2) << 16);
    
    return if (codepoint == 0) null else codepoint;
}