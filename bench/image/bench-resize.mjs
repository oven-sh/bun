// Bun.Image vs sharp — wall-clock + RSS for the common server-side image
// pipeline (decode, fit-inside resize, JPEG/WebP encode).
//
// Fixture is generated in-process so nothing binary is committed and the
// numbers are reproducible across machines. Run with --sharp to include the
// sharp column (requires `bun install` in this dir first).

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

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
const pngFixture = makePng(W, H);
process.stderr.write(`${(pngFixture.length / 1024).toFixed(0)} KB PNG, `);
// JPEG-input case shows DCT-domain scaling (the "phone photo → thumbnail"
// path); both engines exploit it so it's apples-to-apples.
const jpegFixture = await new Bun.Image(pngFixture).jpeg({ quality: 92 }).bytes();
process.stderr.write(`${(jpegFixture.length / 1024).toFixed(0)} KB JPEG\n`);

// 4K + phone-camera sizes — JPEG only (PNG at 4K is ~50 MB and just measures
// zlib). 4032×3024 is what an iPhone hands you.
process.stderr.write(`building 3840×2160 + 4032×3024 JPEG fixtures… `);
const jpeg4k = await new Bun.Image(makePng(3840, 2160)).jpeg({ quality: 92 }).bytes();
const jpegPhone = await new Bun.Image(makePng(4032, 3024)).jpeg({ quality: 92 }).bytes();
process.stderr.write(`${(jpeg4k.length / 1024).toFixed(0)} KB / ${(jpegPhone.length / 1024).toFixed(0)} KB\n`);

// The same pictures as files, for metadata() by path: it reads a head of the
// file, and more when the header is longer than that head.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "bun-image-bench-"));
process.on("exit", () => fs.rmSync(fixtureDir, { recursive: true, force: true }));
function fixtureFile(name, bytes) {
  const file = path.join(fixtureDir, name);
  fs.writeFileSync(file, bytes);
  return file;
}
// `total` bytes of JPEG comment segments, to go between SOI and the rest.
function jpegComments(total) {
  const out = [];
  while (total > 0) {
    const size = total <= 65537 ? total : Math.min(65537, total - 4);
    const segment = Buffer.alloc(size, 0x20);
    segment.set([0xff, 0xfe, (size - 2) >> 8, (size - 2) & 255]);
    out.push(segment);
    total -= size;
  }
  return Buffer.concat(out);
}
const jpegWith = (...inserted) => Buffer.concat([jpegPhone.subarray(0, 2), ...inserted, jpegPhone.subarray(2)]);
// libjpeg warns about stray bytes between two segments and reads the header all the same.
const app0End = 4 + ((jpegPhone[4] << 8) | jpegPhone[5]);
const jpegStray = Buffer.concat([jpegPhone.subarray(0, app0End), Buffer.alloc(5), jpegPhone.subarray(app0End)]);
const files = {
  png: fixtureFile("fixture.png", pngFixture),
  small: fixtureFile("small.png", makePng(64, 64)),
  jpeg: fixtureFile("phone.jpg", jpegPhone),
  jpeg100k: fixtureFile("phone-100k-header.jpg", jpegWith(jpegComments(100_000))),
  jpeg400k: fixtureFile("phone-400k-header.jpg", jpegWith(jpegComments(400_000))),
  jpegStray: fixtureFile("phone-stray-bytes.jpg", jpegStray),
};
// One metadata() by path is mostly the trip to the thread pool and back. A
// batch of calls at once shows the read.
const BATCH = 256;
const batch = f => file => Promise.all(Array.from({ length: BATCH }, () => f(file)));

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
  "metadata() [PNG]": {
    fixture: pngFixture,
    bun: buf => new Bun.Image(buf).metadata(),
    sharp: buf => sharp(buf).metadata(),
  },
  [`metadata() × ${BATCH} [PNG file]`]: {
    fixture: files.png,
    bun: batch(file => new Bun.Image(file).metadata()),
    sharp: batch(file => sharp(file).metadata()),
  },
  [`metadata() × ${BATCH} [PNG file, 64 KiB or less]`]: {
    fixture: files.small,
    bun: batch(file => new Bun.Image(file).metadata()),
    sharp: batch(file => sharp(file).metadata()),
  },
  [`metadata() × ${BATCH} [12MP JPEG file]`]: {
    fixture: files.jpeg,
    bun: batch(file => new Bun.Image(file).metadata()),
    sharp: batch(file => sharp(file).metadata()),
  },
  [`metadata() × ${BATCH} [12MP JPEG file, 100 KB before the frame header]`]: {
    fixture: files.jpeg100k,
    bun: batch(file => new Bun.Image(file).metadata()),
    sharp: batch(file => sharp(file).metadata()),
  },
  [`metadata() × ${BATCH} [12MP JPEG file, 400 KB before the frame header: read whole]`]: {
    fixture: files.jpeg400k,
    bun: batch(file => new Bun.Image(file).metadata()),
    sharp: batch(file => sharp(file).metadata()),
  },
  [`metadata() × ${BATCH} [12MP JPEG file, stray bytes in the header: read whole]`]: {
    fixture: files.jpegStray,
    bun: batch(file => new Bun.Image(file).metadata()),
    sharp: batch(file => sharp(file).metadata()),
  },
  "metadata() then resize 400×300 → jpeg [12MP JPEG file]": {
    fixture: files.jpeg,
    bun: async file => {
      const img = new Bun.Image(file);
      await img.metadata();
      return img.resize(400, 300, { fit: "inside" }).jpeg({ quality: 80 }).bytes();
    },
    sharp: async file => {
      await sharp(file).metadata();
      return sharp(file).resize(400, 300, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
    },
  },
  "PNG resize 400×400 inside → jpeg q80": {
    fixture: pngFixture,
    bun: buf => new Bun.Image(buf).resize(400, 400, { fit: "inside" }).jpeg({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(400, 400, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
  },
  "PNG resize 800×600 → webp q80": {
    fixture: pngFixture,
    bun: buf => new Bun.Image(buf).resize(800, 600).webp({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(800, 600).webp({ quality: 80 }).toBuffer(),
  },
  "PNG → jpeg q80 (no resize)": {
    fixture: pngFixture,
    bun: buf => new Bun.Image(buf).jpeg({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).jpeg({ quality: 80 }).toBuffer(),
  },
  "JPEG resize 400×400 inside → jpeg q80": {
    fixture: jpegFixture,
    bun: buf => new Bun.Image(buf).resize(400, 400, { fit: "inside" }).jpeg({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(400, 400, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
  },
  "JPEG resize 200×200 inside → webp q80": {
    fixture: jpegFixture,
    bun: buf => new Bun.Image(buf).resize(200, 200, { fit: "inside" }).webp({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(200, 200, { fit: "inside" }).webp({ quality: 80 }).toBuffer(),
  },
  "JPEG → webp q80 (no resize)": {
    fixture: jpegFixture,
    bun: buf => new Bun.Image(buf).webp({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).webp({ quality: 80 }).toBuffer(),
  },
  "4K JPEG → 800×450 → jpeg": {
    fixture: jpeg4k,
    bun: buf => new Bun.Image(buf).resize(800, 450, { fit: "inside" }).jpeg({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(800, 450, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
  },
  "4K JPEG → 1920×1080 → jpeg": {
    fixture: jpeg4k,
    bun: buf => new Bun.Image(buf).resize(1920, 1080, { fit: "inside" }).jpeg({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(1920, 1080, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
  },
  "12MP JPEG → 400×300 → jpeg": {
    fixture: jpegPhone,
    bun: buf => new Bun.Image(buf).resize(400, 300, { fit: "inside" }).jpeg({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(400, 300, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
  },
  "12MP JPEG → 1024×768 → webp": {
    fixture: jpegPhone,
    bun: buf => new Bun.Image(buf).resize(1024, 768, { fit: "inside" }).webp({ quality: 80 }).bytes(),
    sharp: buf => sharp(buf).resize(1024, 768, { fit: "inside" }).webp({ quality: 80 }).toBuffer(),
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

async function bench(fn, fixture) {
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
  const b = await bench(impl.bun, impl.fixture);
  process.stderr.write(`${b.median.toFixed(1)}ms`);
  let s = null;
  if (sharp) {
    process.stderr.write(` … sharp `);
    s = await bench(impl.sharp, impl.fixture);
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
