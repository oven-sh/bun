{% callout %}

Bun implements the `createHash` and `createHmac` functions from [`node:crypto`](https://nodejs.org/api/crypto.html) in addition to the Bun-native APIs documented below.

{% /callout %}

## `Bun.password`

`Bun.password` is a collection of utility functions for hashing and verifying passwords with various cryptographically secure algorithms.

```ts
const password = "super-secure-pa$$word";

const hash = await Bun.password.hash(password);
// => $argon2id$v=19$m=65536,t=2,p=1$tFq+9AVr1bfPxQdh6E8DQRhEXg/M/SqYCNu6gVdRRNs$GzJ8PuBi+K+BVojzPfS5mjnC8OpLGtv8KJqF99eP6a4

const isMatch = await Bun.password.verify(password, hash);
// => true
```

The second argument to `Bun.password.hash` accepts a params object that lets you pick and configure the hashing algorithm.

```ts
const password = "super-secure-pa$$word";

// use argon2 (default)
const argonHash = await Bun.password.hash(password, {
  algorithm: "argon2id", // "argon2id" | "argon2i" | "argon2d"
  memoryCost: 4, // memory usage in kibibytes
  timeCost: 3, // the number of iterations
});

// use bcrypt
const bcryptHash = await Bun.password.hash(password, {
  algorithm: "bcrypt",
  cost: 4, // number between 4-31
});
```

The algorithm used to create the hash is stored in the hash itself. When using `bcrypt`, the returned hash is encoded in [Modular Crypt Format](https://passlib.readthedocs.io/en/stable/modular_crypt_format.html) for compatibility with most existing `bcrypt` implementations; with `argon2` the result is encoded in the newer [PHC format](https://github.com/P-H-C/phc-string-format/blob/master/phc-sf-spec.md).

The `verify` function automatically detects the algorithm based on the input hash and use the correct verification method. It can correctly infer the algorithm from both PHC- or MCF-encoded hashes.

```ts
const password = "super-secure-pa$$word";

const hash = await Bun.password.hash(password, {
  /* config */
});

const isMatch = await Bun.password.verify(password, hash);
// => true
```

Synchronous versions of all functions are also available. Keep in mind that these functions are computationally expensive, so using a blocking API may degrade application performance.

```ts
const password = "super-secure-pa$$word";

const hash = Bun.password.hashSync(password, {
  /* config */
});

const isMatch = Bun.password.verifySync(password, hash);
// => true
```

### Salt

When you use `Bun.password.hash`, a salt is automatically generated and included in the hash.

### bcrypt - Modular Crypt Format

In the following [Modular Crypt Format](https://passlib.readthedocs.io/en/stable/modular_crypt_format.html) hash (used by `bcrypt`):

Input:

```ts
await Bun.password.hash("hello", {
  algorithm: "bcrypt",
});
```

Output:

```sh
$2b$10$Lyj9kHYZtiyfxh2G60TEfeqs7xkkGiEFFDi3iJGc50ZG/XJ1sxIFi;
```

The format is composed of:

- `bcrypt`: `$2b`
- `rounds`: `$10` - rounds (log10 of the actual number of rounds)
- `salt`: `$Lyj9kHYZtiyfxh2G60TEfeqs7xkkGiEFFDi3iJGc50ZG/XJ1sxIFi`
- `hash`: `$GzJ8PuBi+K+BVojzPfS5mjnC8OpLGtv8KJqF99eP6a4`

By default, the bcrypt library truncates passwords longer than 72 bytes. In Bun, if you pass `Bun.password.hash` a password longer than 72 bytes and use the `bcrypt` algorithm, the password will be hashed via SHA-512 before being passed to bcrypt.

```ts
await Bun.password.hash("hello".repeat(100), {
  algorithm: "bcrypt",
});
```

So instead of sending bcrypt a 500-byte password silently truncated to 72 bytes, Bun will hash the password using SHA-512 and send the hashed password to bcrypt (only if it exceeds 72 bytes). This is a more secure default behavior.

### argon2 - PHC format

In the following [PHC format](https://github.com/P-H-C/phc-string-format/blob/master/phc-sf-spec.md) hash (used by `argon2`):

Input:

```ts
await Bun.password.hash("hello", {
  algorithm: "argon2id",
});
```

Output:

```sh
$argon2id$v=19$m=65536,t=2,p=1$xXnlSvPh4ym5KYmxKAuuHVlDvy2QGHBNuI6bJJrRDOs$2YY6M48XmHn+s5NoBaL+ficzXajq2Yj8wut3r0vnrwI
```

The format is composed of:

- `algorithm`: `$argon2id`
- `version`: `$v=19`
- `memory cost`: `65536`
- `iterations`: `t=2`
- `parallelism`: `p=1`
- `salt`: `$xXnlSvPh4ym5KYmxKAuuHVlDvy2QGHBNuI6bJJrRDOs`
- `hash`: `$2YY6M48XmHn+s5NoBaL+ficzXajq2Yj8wut3r0vnrwI`

## `Bun.hash`

`Bun.hash` is a collection of utilities for _non-cryptographic_ hashing. Non-cryptographic hashing algorithms are optimized for speed of computation over collision-resistance or security.

The standard `Bun.hash` functions uses [Wyhash](https://github.com/wangyi-fudan/wyhash) to generate a 64-bit hash from an input of arbitrary size.

```ts
Bun.hash("some data here");
// 11562320457524636935n
```

The input can be a string, `TypedArray`, `DataView`, `ArrayBuffer`, or `SharedArrayBuffer`.

```ts
const arr = new Uint8Array([1, 2, 3, 4]);

Bun.hash("some data here");
Bun.hash(arr);
Bun.hash(arr.buffer);
Bun.hash(new DataView(arr.buffer));
```

Optionally, an integer seed can be specified as the second parameter. For 64-bit hashes seeds above `Number.MAX_SAFE_INTEGER` should be given as BigInt to avoid loss of precision.

```ts
Bun.hash("some data here", 1234);
// 15724820720172937558n
```

Additional hashing algorithms are available as properties on `Bun.hash`. The API is the same for each, only changing the return type from number for 32-bit hashes to bigint for 64-bit hashes.

```ts
Bun.hash.wyhash("data", 1234); // equivalent to Bun.hash()
Bun.hash.crc32("data", 1234);
Bun.hash.adler32("data", 1234);
Bun.hash.cityHash32("data", 1234);
Bun.hash.cityHash64("data", 1234);
Bun.hash.xxHash32("data", 1234);
Bun.hash.xxHash64("data", 1234);
Bun.hash.xxHash3("data", 1234);
Bun.hash.murmur32v3("data", 1234);
Bun.hash.murmur32v2("data", 1234);
Bun.hash.murmur64v2("data", 1234);
Bun.hash.rapidhash("data", 1234);
```

## `Bun.CryptoHasher`

`Bun.CryptoHasher` is a general-purpose utility class that lets you incrementally compute a hash of string or binary data using a range of cryptographic hash algorithms. The following algorithms are supported:

- `"blake2b256"`
- `"blake2b512"`
- `"md4"`
- `"md5"`
- `"ripemd160"`
- `"sha1"`
- `"sha224"`
- `"sha256"`
- `"sha384"`
- `"sha512"`
- `"sha512-224"`
- `"sha512-256"`
- `"sha3-224"`
- `"sha3-256"`
- `"sha3-384"`
- `"sha3-512"`
- `"shake128"`
- `"shake256"`

```ts
const hasher = new Bun.CryptoHasher("sha256");
hasher.update("hello world");
hasher.digest();
// Uint8Array(32) [ <byte>, <byte>, ... ]
```

Once initialized, data can be incrementally fed to to the hasher using `.update()`. This method accepts `string`, `TypedArray`, and `ArrayBuffer`.

```ts
const hasher = new Bun.CryptoHasher("sha256");

hasher.update("hello world");
hasher.update(new Uint8Array([1, 2, 3]));
hasher.update(new ArrayBuffer(10));
```

If a `string` is passed, an optional second parameter can be used to specify the encoding (default `'utf-8'`). The following encodings are supported:

{% table %}

---

- Binary encodings
- `"base64"` `"base64url"` `"hex"` `"binary"`

---

- Character encodings
- `"utf8"` `"utf-8"` `"utf16le"` `"latin1"`

---

- Legacy character encodings
- `"ascii"` `"binary"` `"ucs2"` `"ucs-2"`

{% /table %}

```ts
hasher.update("hello world"); // defaults to utf8
hasher.update("hello world", "hex");
hasher.update("hello world", "base64");
hasher.update("hello world", "latin1");
```

After the data has been feed into the hasher, a final hash can be computed using `.digest()`. By default, this method returns a `Uint8Array` containing the hash.

```ts
const hasher = new Bun.CryptoHasher("sha256");
hasher.update("hello world");

hasher.digest();
// => Uint8Array(32) [ 185, 77, 39, 185, 147, ... ]
```

The `.digest()` method can optionally return the hash as a string. To do so, specify an encoding:

```ts
hasher.digest("base64");
// => "uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek="

hasher.digest("hex");
// => "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
```

Alternatively, the method can write the hash into a pre-existing `TypedArray` instance. This may be desirable in some performance-sensitive applications.

```ts
const arr = new Uint8Array(32);

hasher.digest(arr);

console.log(arr);
// => Uint8Array(32) [ 185, 77, 39, 185, 147, ... ]
```

### HMAC in `Bun.CryptoHasher`

`Bun.CryptoHasher` can be used to compute HMAC digests. To do so, pass the key to the constructor.

```ts
const hasher = new Bun.CryptoHasher("sha256", "secret-key");
hasher.update("hello world");
console.log(hasher.digest("hex"));
// => "095d5a21fe6d0646db223fdf3de6436bb8dfb2fab0b51677ecf6441fcf5f2a67"
```

When using HMAC, a more limited set of algorithms are supported:

- `"blake2b512"`
- `"md5"`
- `"sha1"`
- `"sha224"`
- `"sha256"`
- `"sha384"`
- `"sha512-224"`
- `"sha512-256"`
- `"sha512"`

Unlike the non-HMAC `Bun.CryptoHasher`, the HMAC `Bun.CryptoHasher` instance is not reset after `.digest()` is called, and attempting to use the same instance again will throw an error.

Other methods like `.copy()` and `.update()` are supported (as long as it's before `.digest()`), but methods like `.digest()` that finalize the hasher are not.

```ts
const hasher = new Bun.CryptoHasher("sha256", "secret-key");
hasher.update("hello world");

const copy = hasher.copy();
copy.update("!");
console.log(copy.digest("hex"));
// => "3840176c3d8923f59ac402b7550404b28ab11cb0ef1fa199130a5c37864b5497"

console.log(hasher.digest("hex"));
// => "095d5a21fe6d0646db223fdf3de6436bb8dfb2fab0b51677ecf6441fcf5f2a67"
```

## Individual Hash Algorithm Classes

In addition to the generic `Bun.CryptoHasher`, Bun provides individual classes for each supported hash algorithm. These offer a more direct API and can be slightly more performant for specific use cases.

### Available Hash Classes

The following individual hash classes are available:

- `Bun.MD4` - MD4 hash algorithm (16 bytes)
- `Bun.MD5` - MD5 hash algorithm (16 bytes)
- `Bun.SHA1` - SHA-1 hash algorithm (20 bytes)
- `Bun.SHA224` - SHA-224 hash algorithm (28 bytes)
- `Bun.SHA256` - SHA-256 hash algorithm (32 bytes)
- `Bun.SHA384` - SHA-384 hash algorithm (48 bytes)
- `Bun.SHA512` - SHA-512 hash algorithm (64 bytes)
- `Bun.SHA512_256` - SHA-512/256 hash algorithm (32 bytes)

### Instance Methods

Each hash class provides the same interface:

```ts
// Create a new hasher instance
const hasher = new Bun.SHA256();

// Update with data (can be called multiple times)
hasher.update("hello");
hasher.update(" world");

// Get the final hash
const hash = hasher.digest("hex");
console.log(hash);
// => "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
```

The `.update()` method accepts strings, `TypedArray`, `ArrayBuffer`, and `Blob` objects:

```ts
const hasher = new Bun.SHA256();
hasher.update("hello");
hasher.update(new Uint8Array([32, 119, 111, 114, 108, 100])); // " world"
hasher.update(new ArrayBuffer(1));

const result = hasher.digest("hex");
```

The `.digest()` method can return the hash in different formats:

```ts
const hasher = new Bun.SHA256();
hasher.update("hello world");

// As a Uint8Array (default)
const bytes = hasher.digest();

// As a hex string
const hex = hasher.digest("hex");

// As a base64 string
const base64 = hasher.digest("base64");

// As a base64url string
const base64url = hasher.digest("base64url");

// Write directly into a TypedArray (more efficient)
const buffer = new Uint8Array(32);
hasher.digest(buffer);
```

{% callout %}
**Important**: Once `.digest()` is called on a hasher instance, it cannot be reused. Calling `.update()` or `.digest()` again will throw an error. Create a new instance for each hash operation.
{% /callout %}

### Static Methods

Each hash class also provides a static `.hash()` method for one-shot hashing:

```ts
// Hash a string and return as hex
const hex = Bun.SHA256.hash("hello world", "hex");
// => "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"

// Hash and return as Uint8Array
const bytes = Bun.SHA256.hash("hello world");

// Hash directly into a buffer (most efficient)
const buffer = new Uint8Array(32);
Bun.SHA256.hash("hello world", buffer);
```

### Properties

Each hash class has a static `byteLength` property indicating the output size:

```ts
console.log(Bun.SHA256.byteLength); // => 32
console.log(Bun.SHA1.byteLength); // => 20
console.log(Bun.MD5.byteLength); // => 16
```

### Security Considerations

{% callout type="warning" %}
**Legacy Algorithms**: MD4, MD5, and SHA1 are considered cryptographically broken and should not be used for security-sensitive applications. They are provided for compatibility with legacy systems only.

- **MD4**: Severely broken, avoid entirely
- **MD5**: Vulnerable to collision attacks, suitable only for checksums
- **SHA1**: Deprecated due to collision vulnerabilities, avoid for new applications

For new applications, use SHA-256 or higher.
{% /callout %}

### Performance Characteristics

The individual hash classes are optimized for performance:

- **SHA-256**: Excellent balance of security and performance, recommended for most use cases
- **SHA-512**: Faster than SHA-256 on 64-bit systems, larger output
- **SHA-384**: Truncated SHA-512, good compromise between SHA-256 and SHA-512
- **SHA-224**: Truncated SHA-256, smaller output when space is constrained
- **SHA-512/256**: Modern variant of SHA-512 with 256-bit output

### Examples

#### Basic Usage

```ts
// Using instance methods for incremental hashing
const hasher = new Bun.SHA256();
hasher.update("The quick brown fox ");
hasher.update("jumps over the lazy dog");
const hash = hasher.digest("hex");

// Using static method for one-shot hashing
const quickHash = Bun.SHA256.hash(
  "The quick brown fox jumps over the lazy dog",
  "hex",
);

// Both produce the same result
console.log(hash === quickHash); // => true
```

#### Hashing Large Data

```ts
// For large data, use the static method or write into a buffer
const data = new Uint8Array(1024 * 1024); // 1MB of data
crypto.getRandomValues(data);

// Method 1: Static method
const hash1 = Bun.SHA256.hash(data, "hex");

// Method 2: Write into existing buffer (avoids allocation)
const output = new Uint8Array(32);
Bun.SHA256.hash(data, output);
const hash2 = Array.from(output, byte =>
  byte.toString(16).padStart(2, "0"),
).join("");

console.log(hash1 === hash2); // => true
```

#### Algorithm Comparison

```ts
const data = "hello world";

console.log("MD5:        ", Bun.MD5.hash(data, "hex")); // 16 bytes
console.log("SHA1:       ", Bun.SHA1.hash(data, "hex")); // 20 bytes
console.log("SHA224:     ", Bun.SHA224.hash(data, "hex")); // 28 bytes
console.log("SHA256:     ", Bun.SHA256.hash(data, "hex")); // 32 bytes
console.log("SHA384:     ", Bun.SHA384.hash(data, "hex")); // 48 bytes
console.log("SHA512:     ", Bun.SHA512.hash(data, "hex")); // 64 bytes
console.log("SHA512/256: ", Bun.SHA512_256.hash(data, "hex")); // 32 bytes
```
