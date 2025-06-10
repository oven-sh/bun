# X25519 deriveBits Implementation for Bun WebCrypto API

## Overview

This document describes the implementation of X25519 `deriveBits` operation in Bun's WebCrypto API to address the issue where X25519 key generation works but `crypto.subtle.deriveBits()` throws `NotSupportedError`.

## Implementation Details

### Files Modified/Created

1. **src/bun.js/bindings/webcrypto/CryptoAlgorithmX25519OpenSSL.cpp** (New file)

   - Implements the platform-specific `platformDeriveBits` function using OpenSSL
   - Uses the BoringSSL `X25519()` function to perform the ECDH operation
   - Returns a 32-byte shared secret

2. **src/bun.js/bindings/webcrypto/CryptoAlgorithmX25519.h**

   - Updated the `deriveBits` method signature to match the base class (changed from `std::optional<size_t>` to `size_t`)
   - Added `override` keyword to ensure proper virtual function override

3. **src/bun.js/bindings/webcrypto/CryptoAlgorithmX25519.cpp**

   - Updated the `deriveBits` implementation to match the corrected signature
   - The implementation already had the logic to validate keys and dispatch the operation

4. **cmake/sources/CxxSources.txt**
   - Added `src/bun.js/bindings/webcrypto/CryptoAlgorithmX25519OpenSSL.cpp` to the list of C++ sources

### Key Implementation Points

1. **OpenSSL Integration**: The implementation uses BoringSSL's `X25519()` function from `<openssl/curve25519.h>` to perform the Diffie-Hellman operation.

2. **Key Validation**: The implementation validates that:

   - The base key is a private key
   - The public key parameter is a public key
   - Both keys use the X25519 algorithm
   - Both keys have the correct size (32 bytes)

3. **Signature Fix**: The original issue was that the `deriveBits` method signature didn't match the base class virtual function, so it wasn't being called. This was fixed by:
   - Changing `std::optional<size_t> length` to `size_t length`
   - Adding the `override` keyword

### Test Coverage

The implementation includes comprehensive tests in `test/x25519-derive-bits.test.ts`:

- Basic X25519 key operations
- deriveBits functionality
- Shared secret consistency
- Imported key support
- Null length handling
- Error cases

### Build Instructions

To build with the new implementation:

```bash
cd /workspace
bun run build
# or
cmake --build build/debug
```

### Expected Behavior

After this implementation, the following code should work:

```typescript
const keyPair1 = await crypto.subtle.generateKey({ name: "X25519" }, false, [
  "deriveBits",
]);
const keyPair2 = await crypto.subtle.generateKey({ name: "X25519" }, false, [
  "deriveBits",
]);

const sharedSecret = await crypto.subtle.deriveBits(
  { name: "X25519", public: keyPair2.publicKey },
  keyPair1.privateKey,
  256, // bits
);
```

This brings Bun's WebCrypto X25519 support in line with Node.js and Deno.
