// Accepts a string, TypedArray, or Blob (file blob supported is not implemented but planned)
const input = "hello world".repeat(400);

// Bun.hash() defaults to Wyhash because it's fast
console.log(Bun.hash(input));

console.log(Bun.hash.wyhash(input));
// and returns a number
// all of these hashing functions return numbers, not typed arrays.
console.log(Bun.hash.adler32(input));
console.log(Bun.hash.crc32(input));
console.log(Bun.hash.cityHash32(input));
console.log(Bun.hash.cityHash64(input));
console.log(Bun.hash.murmur32v3(input));
console.log(Bun.hash.murmur64v2(input));

// Second argument accepts a seed where relevant
console.log(Bun.hash(input, 12345));
