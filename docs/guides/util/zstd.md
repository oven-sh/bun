---
name: Compress and decompress data with Zstandard (zstd)
---

Bun provides fast, built-in support for [Zstandard compression](https://facebook.github.io/zstd/), a high-performance compression algorithm developed by Facebook. Zstandard offers an excellent balance of compression ratio, speed, and memory usage.

## Synchronous compression

Use `Bun.zstdCompressSync()` to synchronously compress data with Zstandard.

```ts
const data = "Hello, world! ".repeat(100);
const compressed = Bun.zstdCompressSync(data);
// => Uint8Array

console.log(`Original: ${data.length} bytes`);
console.log(`Compressed: ${compressed.length} bytes`);
console.log(`Compression ratio: ${(data.length / compressed.length).toFixed(2)}x`);
```

The function accepts strings, `Uint8Array`, `ArrayBuffer`, `Buffer`, and other binary data types:

```ts
// String
const textCompressed = Bun.zstdCompressSync("Hello, world!");

// Buffer
const bufferCompressed = Bun.zstdCompressSync(Buffer.from("Hello, world!"));

// Uint8Array
const uint8Compressed = Bun.zstdCompressSync(new TextEncoder().encode("Hello, world!"));
```

## Synchronous decompression

Use `Bun.zstdDecompressSync()` to decompress Zstandard-compressed data:

```ts
const compressed = Bun.zstdCompressSync("Hello, world!");
const decompressed = Bun.zstdDecompressSync(compressed);

// Convert back to string
const text = new TextDecoder().decode(decompressed);
console.log(text); // => "Hello, world!"
```

## Asynchronous compression

Use `Bun.zstdCompress()` for asynchronous compression. This is useful for large data that might block the event loop:

```ts
const data = "Hello, world! ".repeat(10000);
const compressed = await Bun.zstdCompress(data);
// => Promise<Buffer>

console.log(`Compressed ${data.length} bytes to ${compressed.length} bytes`);
```

## Asynchronous decompression

Use `Bun.zstdDecompress()` for asynchronous decompression:

```ts
const compressed = await Bun.zstdCompress("Hello, world!");
const decompressed = await Bun.zstdDecompress(compressed);

const text = new TextDecoder().decode(decompressed);
console.log(text); // => "Hello, world!"
```

## Compression levels

Zstandard supports compression levels from 1 to 22, where:
- **Level 1**: Fastest compression, larger file size
- **Level 3**: Default level (good balance of speed and compression)  
- **Level 19**: Very high compression, slower
- **Level 22**: Maximum compression, slowest

```ts
const data = "Hello, world! ".repeat(1000);

// Fast compression (level 1)
const fast = Bun.zstdCompressSync(data, { level: 1 });

// Balanced compression (level 3, default)
const balanced = Bun.zstdCompressSync(data, { level: 3 });

// High compression (level 19)
const small = Bun.zstdCompressSync(data, { level: 19 });

console.log(`Fast (level 1): ${fast.length} bytes`);
console.log(`Balanced (level 3): ${balanced.length} bytes`);
console.log(`High (level 19): ${small.length} bytes`);
```

The same level options work for async compression:

```ts
const compressed = await Bun.zstdCompress(data, { level: 19 });
```

## Error handling

Both sync and async functions will throw errors for invalid input:

```ts
try {
  // Invalid compression level
  Bun.zstdCompressSync("data", { level: 0 }); // Error: level must be 1-22
} catch (error) {
  console.error(error.message); // => "Compression level must be between 1 and 22"
}

try {
  // Invalid compressed data
  Bun.zstdDecompressSync("not compressed data");
} catch (error) {
  console.error("Decompression failed:", error.message);
}
```

For async functions, handle errors with try/catch or `.catch()`:

```ts
try {
  await Bun.zstdDecompress("invalid data");
} catch (error) {
  console.error("Async decompression failed:", error.message);
}
```

## Working with files

Compress and decompress files efficiently:

```ts
// Compress a file
const file = Bun.file("large-file.txt");
const data = await file.bytes();
const compressed = await Bun.zstdCompress(data, { level: 6 });
await Bun.write("large-file.txt.zst", compressed);

// Decompress a file
const compressedFile = Bun.file("large-file.txt.zst");
const compressedData = await compressedFile.bytes();
const decompressed = await Bun.zstdDecompress(compressedData);
await Bun.write("large-file-restored.txt", decompressed);
```

## Performance characteristics

Zstandard offers excellent performance compared to other compression algorithms:

- **Speed**: Faster decompression than gzip, competitive compression speed
- **Compression ratio**: Better than gzip, similar to or better than brotli
- **Memory usage**: Moderate memory requirements
- **Real-time friendly**: Suitable for real-time applications due to fast decompression

Example performance comparison for a 1MB text file:

```ts
const data = "Sample data ".repeat(100000); // ~1MB

console.time("zstd compress");
const zstdCompressed = Bun.zstdCompressSync(data, { level: 3 });
console.timeEnd("zstd compress");

console.time("gzip compress");
const gzipCompressed = Bun.gzipSync(data);
console.timeEnd("gzip compress");

console.log(`Zstandard: ${zstdCompressed.length} bytes`);
console.log(`Gzip: ${gzipCompressed.length} bytes`);
```

## HTTP compression

Zstandard is supported in modern browsers and can be used for HTTP compression. When building web servers, check the `Accept-Encoding` header:

```ts
const server = Bun.serve({
  async fetch(req) {
    const acceptEncoding = req.headers.get("Accept-Encoding") || "";
    const content = "Large response content...";
    
    if (acceptEncoding.includes("zstd")) {
      const compressed = await Bun.zstdCompress(content, { level: 6 });
      return new Response(compressed, {
        headers: {
          "Content-Encoding": "zstd",
          "Content-Type": "text/plain"
        }
      });
    }
    
    return new Response(content);
  }
});
```

## When to use Zstandard

Choose Zstandard when you need:

- **Better compression ratios** than gzip with similar or better speed
- **Fast decompression** for frequently accessed compressed data
- **Streaming support** (via Node.js compatible `zlib` streams)
- **Modern web applications** where browser support allows

For maximum compatibility, consider falling back to gzip for older clients.

---

See [Docs > API > Utils](/docs/api/utils) for more compression utilities including gzip, deflate, and brotli.