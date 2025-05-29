# Fix for Node.js HTTP Automatic Headers Issue (BUN-13559)

## Problem

The Node.js test `test-http-automatic-headers.js` was failing because Bun's HTTP server implementation was not automatically adding standard HTTP headers that Node.js adds by default:

- `connection: keep-alive` for HTTP/1.1 connections
- `content-length: 0` when no body is sent
- `date` header with current timestamp

The test was specifically failing on this assertion:
```javascript
assert.strictEqual(res.headers.connection, 'keep-alive');
```

## Root Cause

The issue was in the `NodeHTTPServer__writeHead` function in `src/bun.js/bindings/NodeHTTP.cpp`. This function only wrote headers that were explicitly provided by the user, but didn't add the automatic headers that Node.js adds by default.

## Solution

### Changes Made

1. **Modified `NodeHTTPServer__writeHead` function**: Added logic to track which headers are explicitly set and automatically add missing standard headers.

2. **Updated `writeFetchHeadersToUWSResponse` function**: Extended it to track explicitly set headers when using FetchHeaders objects.

3. **Added header tracking**: The function now tracks whether `connection`, `content-length`, and `date` headers are explicitly set.

4. **Added automatic header logic**: After processing all explicit headers, the function adds:
   - `Connection: keep-alive` if not explicitly set
   - `Content-Length: 0` if not explicitly set (for responses with no body)
   - `Date: <current_timestamp>` if not explicitly set

### Files Modified

- `src/bun.js/bindings/NodeHTTP.cpp`: Main implementation changes
- `test/js/node/test/parallel/test-http-automatic-headers.js`: Copied Node.js test

### Technical Details

The fix ensures Node.js compatibility by:

1. **Connection Header**: Automatically adds `Connection: keep-alive` for HTTP/1.1 unless explicitly overridden
2. **Content-Length Header**: Adds `Content-Length: 0` for responses that don't explicitly set it (matching Node.js behavior for empty responses)
3. **Date Header**: Adds current GMT timestamp in RFC format
4. **Backward Compatibility**: Only adds headers when they're not explicitly set, preserving user-defined values

The implementation handles both regular JavaScript objects and FetchHeaders objects used for header management.

## Testing

The test `test/js/node/test/parallel/test-http-automatic-headers.js` now passes, verifying that:
- Custom headers (x-date, x-connection, x-content-length) are preserved
- Automatic headers (connection, content-length, date) are added when not explicitly set
- The behavior matches Node.js exactly

This fix improves Node.js compatibility for HTTP server responses and resolves the failing test case.