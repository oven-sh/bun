// Accepts a string, TypedArray, or Blob (file blob support is not implemented but planned)
const input = "hello world".repeat(400);

const input = "hello world".repeat(400);
const hashFunctions = {
    'Default': Bun.hash,
    'Wyhash': Bun.hash.wyhash,
    'Adler32': Bun.hash.adler32,
    'CRC32': Bun.hash.crc32,
    'CityHash32': Bun.hash.cityHash32,
    'CityHash64': Bun.hash.cityHash64,
    'Murmur32v3': Bun.hash.murmur32v3,
    'Murmur32v2': Bun.hash.murmur32v2,
    'Murmur64v2': Bun.hash.murmur64v2
};
Object.entries(hashFunctions).forEach(([name, func]) => {
    console.log(`${name}: ${func(input)}`);
});
console.log('Default with seed:', Bun.hash(input, 12345));
