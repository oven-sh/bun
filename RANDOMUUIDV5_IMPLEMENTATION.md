# Bun.randomUUIDv5 Implementation

This document outlines the implementation of `Bun.randomUUIDv5`, a name-based UUID generation function that uses SHA-1 hashing according to RFC 4122.

## Files Modified

### 1. `/workspace/src/bun.js/uuid.zig`
- Added `UUID5` struct with `init()` method that takes a namespace and name
- Added standard UUID namespaces (DNS, URL, OID, X500) from RFC 4122
- Implemented SHA-1 based UUID generation with proper version and variant bits

### 2. `/workspace/src/bun.js/webcore/Crypto.zig`
- Added `Bun__randomUUIDv5_` function following the same pattern as `randomUUIDv7`
- Added imports for `UUID`, `UUID5` from uuid.zig
- Implemented argument parsing for namespace, name, and optional encoding
- Added support for string and buffer inputs for both namespace and name
- Added comprehensive error handling for invalid inputs

### 3. `/workspace/src/bun.js/bindings/BunObject.cpp`
- Added `BUN_DECLARE_HOST_FUNCTION(Bun__randomUUIDv5);` declaration
- Added entry in bunObjectTable: `randomUUIDv5 Bun__randomUUIDv5 DontDelete|Function 3`

### 4. `/workspace/test/js/bun/util/randomUUIDv5.test.ts`
- Created comprehensive test suite covering:
  - Basic functionality and UUID format validation
  - Deterministic output (same namespace + name = same UUID)
  - Different namespaces/names produce different UUIDs
  - All encoding formats (hex, buffer, base64, base64url)
  - Buffer inputs for namespace and name
  - Error handling for invalid inputs
  - Unicode name support
  - RFC 4122 compliance testing
  - Variant bit validation

## API Usage

```javascript
// Basic usage with string namespace and name
const uuid = Bun.randomUUIDv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com");

// With custom encoding
const uuidBuffer = Bun.randomUUIDv5(namespace, name, "buffer");
const uuidBase64 = Bun.randomUUIDv5(namespace, name, "base64");

// Using buffer inputs
const namespaceBuffer = new Uint8Array(16); // ... populate with UUID bytes
const nameBuffer = new TextEncoder().encode("example");
const uuid = Bun.randomUUIDv5(namespaceBuffer, nameBuffer);
```

## Standard Namespaces

The implementation includes standard namespaces from RFC 4122:

- DNS: `6ba7b810-9dad-11d1-80b4-00c04fd430c8`
- URL: `6ba7b811-9dad-11d1-80b4-00c04fd430c8`  
- OID: `6ba7b812-9dad-11d1-80b4-00c04fd430c8`
- X500: `6ba7b814-9dad-11d1-80b4-00c04fd430c8`

## Implementation Details

### UUID v5 Algorithm (RFC 4122)
1. Convert namespace UUID to network byte order
2. Concatenate namespace + name data
3. Compute SHA-1 hash of the concatenated data
4. Take first 16 bytes of the 20-byte hash
5. Set version bits (4 bits) to 5 in time_hi_and_version field
6. Set variant bits (2 bits) to 10 in clock_seq_hi_and_reserved field

### Key Features
- **Deterministic**: Same namespace + name always produces the same UUID
- **Standards Compliant**: Follows RFC 4122 specification exactly
- **Multiple Input Formats**: Accepts strings or buffers for namespace and name
- **Multiple Output Formats**: Supports hex, buffer, base64, base64url encoding
- **Comprehensive Validation**: Validates UUID format, buffer sizes, encoding types
- **Unicode Support**: Properly handles UTF-8 encoded names

## Testing

Run the test suite with:
```bash
bun test test/js/bun/util/randomUUIDv5.test.ts
```

Note: The function will only be available after rebuilding Bun with the new changes.

## Build Requirements

To make this function available, the Bun binary needs to be rebuilt to include:
1. The new Zig code in uuid.zig and Crypto.zig
2. The C++ bindings in BunObject.cpp
3. The exported function symbols

The implementation follows the exact same pattern as `randomUUIDv7`, so it should integrate seamlessly once built.