# Windows Path Length Buffer Overflow Fix

## Bug Description

Bun was crashing on Windows when file paths had specific lengths (49151 and 98302 characters). The error message showed:

```
panic(main thread): index out of bounds: index 49151, len 49151
```

## Root Cause

The issue was in the `toWPathMaybeDir` function in `src/string_immutable.zig`. When converting UTF-8 paths to UTF-16 for Windows APIs:

1. The function would convert characters up to the buffer length
2. Then attempt to write a null terminator at `buffer[result_count]`
3. If `result_count == buffer.len`, this would be an out-of-bounds write

For a buffer of size 49151, valid indices are 0-49150. Trying to write to index 49151 causes the crash.

## Solution

The fix ensures we always reserve space for the null terminator:

```zig
// Reserve space for null terminator and optional trailing slash
const reserved_space = 1 + @as(usize, @intFromBool(add_trailing_lash));

// If the buffer is too small to hold even a null terminator, return empty
if (wbuf.len < reserved_space) {
    wbuf[0] = 0;
    return wbuf[0..0 :0];
}

const max_result_len = wbuf.len -| reserved_space;
```

This ensures that:

- We never write beyond the buffer bounds
- The null terminator always has a valid position
- Functions that depend on path conversion handle empty results appropriately

## Additional Changes

Also updated functions like `exists()` and `access()` to handle the case where `osPathKernel32` returns an empty path for overly long inputs:

```zig
// If osPathKernel32 returns an empty path when the input was non-empty,
// it means the path was too long to convert
if (slice.len == 0 and path.slice().len > 0) {
    return .{ .result = false };  // for exists()
    // or return ENAMETOOLONG error for other functions
}
```

## Testing

The fix was verified with:

1. A minimal reproduction that demonstrates the off-by-one error
2. Tests with the exact problematic lengths (49151, 98302)
3. Edge cases with buffers too small for null terminators

This ensures Windows path operations no longer crash with long paths and instead fail gracefully.
