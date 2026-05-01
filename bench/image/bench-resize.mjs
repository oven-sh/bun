// Bun.Image vs sharp — wall-clock + RSS for the operations Claude Code's
// image pipeline actually runs (decode, fit-inside resize, JPEG/WebP encode).
//
// Fixture is generated in-process so nothing binary is committed and the
// numbers are reproducible across machines. Run with --sharp to include the
// sharp column (requires `bun install` in this dir first).

import zlib from "node:zlib";
import { createRequire } from "node:module";

// ─── synthetic 1920×1080 RGBA8 PNG ───────────────────────────────────────────

function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function makePng(w, h) {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  // Gradient + a little structure so the encoders have something to chew on
  // (flat fields make JPEG/WebP unrealistically fast).
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 4;
      raw[p] = ((x * 255) / w) | 0;
      raw[p + 1] = ((y * 255) / h) | 0;
      raw[p + 2] = ((x ^ y) * 13) & 255;
      raw[p + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const W = 1920,
  H = 1080;
process.stderr.write(`building ${W}×${H} fixture… `);
const fixture = makePng(W, H);
process.stderr.write(`${(fixture.length / 1024).toFixed(0)} KB\n`);

// ─── runners ────────────────────────────────────────────────────────────────

const wantSharp = process.argv.includes("--sharp");
let sharp = null;
if (wantSharp) {
  try {
    sharp = createRequire(import.meta.url)("sharp");
    // Match Bun.Image's threading model: one op = one task; libvips' internal
    // thread pool would otherwise let sharp parallelise the resize and skew
    // wall-clock toward "more cores wins" rather than "faster algorithm wins".
    sharp.concurrency(1);
    sharp.cache(false);
  } catch (e) {
    process.stderr.write(`sharp unavailable: ${e.message}\n`);
  }
}

const ops = {
  "metadata()": {
    bun: buf => new Bun.Image(buf).metadata(),
    sharp: buf => sharp(buf).metadata(),
  },
  "resize 400×400 inside → jpeg q80": {
    bun: buf => new Bun.Image(buf).resize(400, 400, { fit: "inside" }).jpeg({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(400, 400, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
  },
  "resize 800×600 → webp q80": {
    bun: buf => new Bun.Image(buf).resize(800, 600).webp({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(800, 600).webp({ quality: 80 }).toBuffer(),
  },
  "png → jpeg q80 (no resize)": {
    bun: buf => new Bun.Image(buf).jpeg({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).jpeg({ quality: 80 }).toBuffer(),
  },
};

const ITER = 50;
const WARM = 5;

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i),
    hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function bench(fn) {
  for (let i = 0; i < WARM; i++) await fn(fixture);
  if (globalThis.Bun) Bun.gc(true);
  const rss0 = process.memoryUsage().rss;
  let rssPeak = rss0;
  const times = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    await fn(fixture);
    times.push(performance.now() - t0);
    const r = process.memoryUsage().rss;
    if (r > rssPeak) rssPeak = r;
  }
  times.sort((a, b) => a - b);
  return {
    median: quantile(times, 0.5),
    p99: quantile(times, 0.99),
    rssDeltaMB: (rssPeak - rss0) / 1024 / 1024,
  };
}

// ─── output ─────────────────────────────────────────────────────────────────

const rows = [];
for (const [name, impl] of Object.entries(ops)) {
  process.stderr.write(`  ${name} … bun `);
  const b = await bench(impl.bun);
  process.stderr.write(`${b.median.toFixed(1)}ms`);
  let s = null;
  if (sharp) {
    process.stderr.write(` … sharp `);
    s = await bench(impl.sharp);
    process.stderr.write(`${s.median.toFixed(1)}ms`);
  }
  process.stderr.write(`\n`);
  rows.push({ name, bun: b, sharp: s });
}

console.log(
  `\n### ${W}×${H} PNG, ${ITER} iters, ${process.platform}/${process.arch}, sharp ${sharp ? (sharp.versions?.sharp ?? "?") : "n/a"}\n`,
);
console.log(`| op | Bun.Image median | p99 | ΔRSS | sharp median | p99 | ΔRSS | bun÷sharp |`);
console.log(`|---|---:|---:|---:|---:|---:|---:|---:|`);
for (const r of rows) {
  const b = r.bun,
    s = r.sharp;
  const ratio = s ? (b.median / s.median).toFixed(2) + "×" : "—";
  console.log(
    `| ${r.name} | ${b.median.toFixed(2)} ms | ${b.p99.toFixed(2)} ms | ${b.rssDeltaMB.toFixed(1)} MB |` +
      (s
        ? ` ${s.median.toFixed(2)} ms | ${s.p99.toFixed(2)} ms | ${s.rssDeltaMB.toFixed(1)} MB | ${ratio} |`
        : ` — | — | — | — |`),
  );
}
