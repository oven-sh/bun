// TextEncoderStream / TextDecoderStream / CompressionStream / DecompressionStream throughput.
// 64 KiB chunks; MB/s of payload through the transform (decoded / uncompressed bytes).
// Portable across Bun, Node, and Deno; each scenario reports the best of RUNS passes.
const CHUNK = 64 * 1024;
const CHUNKS = 256; // 16 MiB per pass
const RUNS = 5;
const BYTES = CHUNK * CHUNKS;

// UTF-8 with multi-byte content sprinkled in so decoding is not pure-ASCII.
const textChunk = (() => {
  const s = "hello world 🌊 stream ✨ ".repeat(3000);
  return new TextEncoder().encode(s).slice(0, CHUNK);
})();
// JSON-ish compressible payload.
const compressibleChunk = new TextEncoder()
  .encode(JSON.stringify({ messages: Array.from({ length: 500 }, (_, i) => ({ id: i, role: "user", body: "the quick brown fox jumps over the lazy dog" })) }))
  .slice(0, CHUNK);

const source = chunk =>
  new ReadableStream({
    pull(c) {
      if (this.i === undefined) this.i = 0;
      if (this.i++ < CHUNKS) c.enqueue(chunk);
      else c.close();
    },
  });

async function drainBytes(rs) {
  const reader = rs.getReader();
  let n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return n;
    n += typeof value === "string" ? value.length : value.byteLength;
  }
}

let compressed;
{
  // Pre-compress one pass of input for the decompression scenario.
  const parts = [];
  const rs = source(compressibleChunk).pipeThrough(new CompressionStream("gzip"));
  const reader = rs.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  let total = 0;
  for (const p of parts) total += p.byteLength;
  compressed = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    compressed.set(p, off);
    off += p.byteLength;
  }
}
const compressedSource = () =>
  new ReadableStream({
    start(c) {
      // 64 KiB slices of the gzip stream.
      for (let i = 0; i < compressed.byteLength; i += CHUNK) c.enqueue(compressed.subarray(i, Math.min(i + CHUNK, compressed.byteLength)));
      c.close();
    },
  });

// A 64 K-character string chunk (mostly ASCII with multi-byte content mixed in).
const stringChunk = ("hello world \u{1F30A} stream \u2728 " + "x".repeat(40)).repeat(1200).slice(0, CHUNK);

const scenarios = {
  "TextEncoderStream": () => drainBytes(source(stringChunk).pipeThrough(new TextEncoderStream())),
  "TextDecoderStream": () => drainBytes(source(textChunk).pipeThrough(new TextDecoderStream())),
  "CompressionStream (gzip)": () => drainBytes(source(compressibleChunk).pipeThrough(new CompressionStream("gzip"))),
  "DecompressionStream (gzip)": () => drainBytes(compressedSource().pipeThrough(new DecompressionStream("gzip"))),
};

const only = (globalThis.process?.argv ?? []).find(a => a.startsWith("--scenario="))?.slice("--scenario=".length);
for (const [name, fn] of Object.entries(scenarios)) {
  if (only && name !== only) continue;
  await fn(); // warmup
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    best = Math.min(best, performance.now() - t0);
  }
  // Throughput in terms of the uncompressed/decoded payload the transform handled.
  const mbps = BYTES / 1024 / 1024 / (best / 1000);
  console.log(`${name.padEnd(30)} ${mbps.toFixed(0).padStart(6)} MB/s  (${best.toFixed(1)} ms)`);
}
