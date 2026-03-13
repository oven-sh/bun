import { bench, group, run } from "../runner.mjs";

const runAll = !process.argv.includes("--simple");

const small = new Uint8Array(1024);
const medium = new Uint8Array(1024 * 100);
const large = new Uint8Array(1024 * 1024);

for (let i = 0; i < large.length; i++) {
  const value = Math.floor(Math.sin(i / 100) * 128 + 128);
  if (i < small.length) small[i] = value;
  if (i < medium.length) medium[i] = value;
  large[i] = value;
}

const format = new Intl.NumberFormat("en-US", { notation: "compact", unit: "byte" });

async function compress(data, format) {
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  writer.write(data);
  writer.close();

  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const result = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function decompress(data, format) {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(data);
  writer.close();

  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const result = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function roundTrip(data, format) {
  const compressed = await compress(data, format);
  return await decompress(compressed, format);
}

const formats = ["deflate", "gzip", "deflate-raw"];
if (runAll) formats.push("brotli", "zstd");

// Small data benchmarks (1KB)
group(`CompressionStream ${format.format(small.length)}`, () => {
  for (const fmt of formats) {
    try {
      new CompressionStream(fmt);
      bench(fmt, async () => await compress(small, fmt));
    } catch (e) {
      // Skip unsupported formats
    }
  }
});

// Medium data benchmarks (100KB)
group(`CompressionStream ${format.format(medium.length)}`, () => {
  for (const fmt of formats) {
    try {
      new CompressionStream(fmt);
      bench(fmt, async () => await compress(medium, fmt));
    } catch (e) {}
  }
});

// Large data benchmarks (1MB)
group(`CompressionStream ${format.format(large.length)}`, () => {
  for (const fmt of formats) {
    try {
      new CompressionStream(fmt);
      bench(fmt, async () => await compress(large, fmt));
    } catch (e) {
      // Skip unsupported formats
    }
  }
});

const compressedData = {};
for (const fmt of formats) {
  try {
    compressedData[fmt] = {
      small: await compress(small, fmt),
      medium: await compress(medium, fmt),
      large: await compress(large, fmt),
    };
  } catch (e) {
    // Skip unsupported formats
  }
}

group(`DecompressionStream ${format.format(small.length)}`, () => {
  for (const fmt of formats) {
    if (compressedData[fmt]) {
      bench(fmt, async () => await decompress(compressedData[fmt].small, fmt));
    }
  }
});

group(`DecompressionStream ${format.format(medium.length)}`, () => {
  for (const fmt of formats) {
    if (compressedData[fmt]) {
      bench(fmt, async () => await decompress(compressedData[fmt].medium, fmt));
    }
  }
});

group(`DecompressionStream ${format.format(large.length)}`, () => {
  for (const fmt of formats) {
    if (compressedData[fmt]) {
      bench(fmt, async () => await decompress(compressedData[fmt].large, fmt));
    }
  }
});

group(`roundtrip ${format.format(large.length)}`, () => {
  for (const fmt of formats) {
    try {
      new CompressionStream(fmt);
      bench(fmt, async () => await roundTrip(large, fmt));
    } catch (e) {
      // Skip unsupported formats
    }
  }
});

await run();
