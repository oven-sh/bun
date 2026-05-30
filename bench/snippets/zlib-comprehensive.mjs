// Comprehensive zlib benchmark: sync, async, streaming, realistic payloads.
// Designed to compare cloudflare-zlib vs zlib-ng on the workloads Bun cares about:
//   - HTTP gzip response encoding (streaming, level 1/6)
//   - npm tarball gunzip (streaming inflate, ~10-500KB inputs)
//   - fetch() Content-Encoding: gzip decoding
//   - Bun.gzipSync / node:zlib one-shot

import { bench, group, run } from "../runner.mjs";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

// ─── Test corpora ───
// "html": realistic web page — repeated structure with varying content (compresses well, ~85%)
// "json": API response — keys repeat, values vary (compresses ~70%)
// "binary": random bytes — incompressible, exercises the "give up fast" path
// "code": minified JS — what npm tarballs actually contain

function makeHtml(kb) {
  let s = "<!DOCTYPE html><html><head><title>Bench</title></head><body>";
  let i = 0;
  while (s.length < kb * 1024) {
    s += `<div class="item" id="item-${i}"><h2>Item ${i}</h2><p>Lorem ipsum dolor sit amet ${i % 17}.</p></div>`;
    i++;
  }
  return Buffer.from(s);
}

function makeJson(kb) {
  const arr = [];
  let i = 0;
  while (JSON.stringify(arr).length < kb * 1024) {
    arr.push({ id: i, name: `user_${i}`, email: `u${i}@example.com`, active: i % 3 === 0, score: (i * 7919) % 1000 });
    i++;
  }
  return Buffer.from(JSON.stringify(arr));
}

const corpora = {
  "html-4K": makeHtml(4),
  "html-128K": makeHtml(128),
  "html-1M": makeHtml(1024),
  "json-128K": makeJson(128),
  "binary-128K": crypto.randomBytes(128 * 1024),
};

// Pre-compress for decompression benches
const gzipped = {};
for (const [name, buf] of Object.entries(corpora)) {
  gzipped[name] = zlib.gzipSync(buf, { level: 6 });
}

// ─── Sync one-shot ───
group("gzipSync level=1", () => {
  for (const [name, buf] of Object.entries(corpora)) {
    bench(name, () => zlib.gzipSync(buf, { level: 1 }));
  }
});

group("gzipSync level=6", () => {
  for (const [name, buf] of Object.entries(corpora)) {
    bench(name, () => zlib.gzipSync(buf, { level: 6 }));
  }
});

group("gunzipSync", () => {
  for (const [name, buf] of Object.entries(gzipped)) {
    bench(name, () => zlib.gunzipSync(buf));
  }
});

// ─── Async one-shot (threadpool) ───
group("gzip async level=6", () => {
  for (const [name, buf] of Object.entries(corpora)) {
    bench(name, async () => await gzip(buf, { level: 6 }));
  }
});

group("gunzip async", () => {
  for (const [name, buf] of Object.entries(gzipped)) {
    bench(name, async () => await gunzip(buf));
  }
});

// ─── Streaming (HTTP server / npm install path) ───
// Feed input in 16KB chunks like a real socket would.
function chunked(buf, size = 16 * 1024) {
  const chunks = [];
  for (let i = 0; i < buf.length; i += size) chunks.push(buf.subarray(i, i + size));
  return chunks;
}

const streamInputs = {
  "html-128K": chunked(corpora["html-128K"]),
  "html-1M": chunked(corpora["html-1M"]),
};
const streamGzInputs = {
  "html-128K": chunked(gzipped["html-128K"]),
  "html-1M": chunked(gzipped["html-1M"]),
};

async function drain(stream) {
  for await (const _ of stream);
}

group("createGzip stream level=1", () => {
  for (const [name, chunks] of Object.entries(streamInputs)) {
    bench(name, async () => {
      const gz = zlib.createGzip({ level: 1 });
      const src = Readable.from(chunks);
      await pipeline(src, gz, drain);
    });
  }
});

group("createGzip stream level=6", () => {
  for (const [name, chunks] of Object.entries(streamInputs)) {
    bench(name, async () => {
      const gz = zlib.createGzip({ level: 6 });
      const src = Readable.from(chunks);
      await pipeline(src, gz, drain);
    });
  }
});

group("createGunzip stream", () => {
  for (const [name, chunks] of Object.entries(streamGzInputs)) {
    bench(name, async () => {
      const gz = zlib.createGunzip();
      const src = Readable.from(chunks);
      await pipeline(src, gz, drain);
    });
  }
});

// ─── deflateInit/inflateInit overhead (small payloads, many iterations) ───
// zlib-ng has higher init cost due to larger state structs. This matters for
// per-request gzip on tiny responses.
const tiny = Buffer.from("Hello, World!");
const tinyGz = zlib.gzipSync(tiny);

group("init overhead (13B payload)", () => {
  bench("gzipSync", () => zlib.gzipSync(tiny, { level: 6 }));
  bench("gunzipSync", () => zlib.gunzipSync(tinyGz));
  bench("deflateSync", () => zlib.deflateSync(tiny, { level: 6 }));
  bench("inflateSync", () => zlib.inflateSync(zlib.deflateSync(tiny)));
});

// ─── Compression ratio (printed, not benched) ───
console.log("\n# Compression ratio (output bytes, level=6):");
console.log("# corpus       input      output     ratio");
for (const [name, buf] of Object.entries(corpora)) {
  const out = zlib.gzipSync(buf, { level: 6 });
  console.log(
    `# ${name.padEnd(12)} ${String(buf.length).padStart(8)}  ${String(out.length).padStart(8)}  ${((out.length / buf.length) * 100).toFixed(1)}%`,
  );
}
console.log(`# zlib version: ${process.versions.zlib}\n`);

await run();
