// Accepts a string, TypedArray, or Blob (file blob support is not implemented but planned)
const input = "hello world".repeat(400);

// Bun.hash() defaults to Wyhash because it's fast
console.log(Bun.hash(input));

console.log(Bun.hash.wyhash(input));
// and returns a bigint
// all of these hashing functions return number if 32-bit or bigint if 64-bit, not typed arrays.
console.log(Bun.hash.adler32(input)); // number
console.log(Bun.hash.crc32(input)); // number
console.log(Bun.hash.cityHash32(input)); // number
console.log(Bun.hash.cityHash64(input)); // bigint
console.log(Bun.hash.xxHash32(input)); // number
console.log(Bun.hash.xxHash64(input)); // bigint
console.log(Bun.hash.xxHash3(input)); // bigint
console.log(Bun.hash.murmur32v3(input)); // number
console.log(Bun.hash.murmur32v2(input)); // number
console.log(Bun.hash.murmur64v2(input)); // bigint
console.log(Bun.hash.rapidhash(input)); // bigint

// Second argument accepts a seed where relevant
console.log(Bun.hash(input, 12345));
