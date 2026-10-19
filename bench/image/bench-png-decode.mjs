// Bun.Image vs sharp — PNG decode for every PNG layout (colour type × bit
// depth), plain and Adam7, at an icon size and a screenshot size.
//
// Bun.Image has no decode-only call, so a cell times decode → nearest-neighbour
// resize to 16×16 → PNG encode. The resize reads 256 pixels and the encode
// writes 256, so the rest is the decode: inflate, defilter, and the conversion
// of the layout's rows to RGBA8.
//
// Fixtures are generated in-process so nothing binary is committed. Run with
// --sharp to include the sharp columns (requires `bun install` in this dir
// first), and with --trns to add a tRNS chunk to each layout that can have one.

import zlib from "node:zlib";
import { createRequire } from "node:module";

// ─── fixtures ────────────────────────────────────────────────────────────────

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

// [name, colour type, bit depth]: the 15 layouts PNG allows.
const layouts = [
  ["gray 1", 0, 1],
  ["gray 2", 0, 2],
  ["gray 4", 0, 4],
  ["gray 8", 0, 8],
  ["gray 16", 0, 16],
  ["palette 1", 3, 1],
  ["palette 2", 3, 2],
  ["palette 4", 3, 4],
  ["palette 8", 3, 8],
  ["gray+alpha 8", 4, 8],
  ["gray+alpha 16", 4, 16],
  ["rgb 8", 2, 8],
  ["rgb 16", 2, 16],
  ["rgba 8", 6, 8],
  ["rgba 16", 6, 16],
];
const channelsOf = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
// The first column and row of each Adam7 pass, and the steps between its pixels.
const adam7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

function makePng(w, h, type, depth, interlace, trns) {
  const channels = channelsOf[type];
  const pixelBytes = (channels * depth) >> 3;
  const rows = [];
  for (const [x0, y0, dx, dy] of interlace ? adam7 : [[0, 0, 1, 1]]) {
    const n = Math.ceil((w - x0) / dx);
    if (n <= 0) continue;
    const stride = Math.ceil((n * channels * depth) / 8);
    for (let y = y0; y < h; y += dy) {
      const row = new Uint8Array(1 + stride);
      for (let i = 0, x = x0, p = 1, bit = 0; i < n; i++, x += dx) {
        for (let c = 0; c < channels; c++) {
          // Gradients + a little structure, so inflate has the work a real image gives it.
          const v = (((x * (c + 3) + y * (7 - c)) >> 3) + (((x ^ y) * 13) & 15)) & 255;
          if (depth === 8) {
            row[p++] = v;
          } else if (depth === 16) {
            row[p++] = v;
            row[p++] = (v * 37) & 255;
          } else {
            row[1 + (bit >> 3)] |= (v >> (8 - depth)) << (8 - depth - (bit & 7));
            bit += depth;
          }
        }
      }
      // Sub filter for whole-byte samples, none for palette and packed rows: what encoders pick.
      if (pixelBytes > 0 && type !== 3) {
        for (let i = stride; i > pixelBytes; i--) row[i] -= row[i - pixelBytes];
        row[0] = 1;
      }
      rows.push(row);
    }
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([depth, type, 0, 0, interlace ? 1 : 0], 8);
  const bytes = (length, f) => Uint8Array.from({ length }, (_, i) => f(i) & 255);
  const plte = bytes(3 << depth, i => i * 73 + 29);
  // The alpha of each palette entry, or the one transparent sample: gray 0, or black.
  const alpha = type === 3 ? bytes(1 << depth, i => i * 151 + 40) : new Uint8Array(2 * channels);
  const chunks = [chunk("IHDR", ihdr)];
  if (type === 3) chunks.push(chunk("PLTE", plte));
  if (trns) chunks.push(chunk("tRNS", alpha));
  chunks.push(chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 6 })));
  chunks.push(chunk("IEND", new Uint8Array(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

// ─── runners ────────────────────────────────────────────────────────────────

const wantTrns = process.argv.includes("--trns");
let sharp = null;
if (process.argv.includes("--sharp")) {
  try {
    sharp = createRequire(import.meta.url)("sharp");
    // Match Bun.Image's threading model: one op = one task.
    sharp.concurrency(1);
    sharp.cache(false);
  } catch (e) {
    process.stderr.write(`sharp unavailable: ${e.message}\n`);
  }
}

const viaBun = buf => new Bun.Image(buf).resize(16, 16, { filter: "nearest" }).png().bytes();
const viaSharp = buf => sharp(buf).resize(16, 16, { fit: "fill", kernel: "nearest" }).png().toBuffer();

const WARM = 3;

async function median(fn, fixture, iterations) {
  for (let i = 0; i < WARM; i++) await fn(fixture);
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn(fixture);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1];
}

// ─── output ─────────────────────────────────────────────────────────────────

const ms = t => (t == null ? "—" : `${t.toFixed(t < 10 ? 3 : 1)} ms`);

for (const [w, h, iterations] of [
  [64, 64, 300],
  [1920, 1080, 30],
]) {
  const rows = [];
  for (const [name, type, depth] of layouts) {
    // Only gray, RGB and palette can carry a tRNS chunk.
    const trns = wantTrns && type !== 4 && type !== 6;
    const cells = [];
    process.stderr.write(`  ${w}×${h} ${name}${trns ? " + tRNS" : ""} …`);
    for (const interlace of [false, true]) {
      const png = makePng(w, h, type, depth, interlace, trns);
      cells.push(await median(viaBun, png, iterations), sharp ? await median(viaSharp, png, iterations) : null);
    }
    process.stderr.write(` ${ms(cells[0])}\n`);
    rows.push({ name: trns ? `${name} + tRNS` : name, cells });
  }

  console.log(
    `\n### ${w}×${h} PNG → 16×16, median of ${iterations}, ${process.platform}/${process.arch}, ` +
      `bun ${Bun.version}, sharp ${sharp ? (sharp.versions?.sharp ?? "?") : "n/a"}\n`,
  );
  console.log(`| layout | Bun.Image | sharp | Bun.Image, Adam7 | sharp, Adam7 |`);
  console.log(`|---|---:|---:|---:|---:|`);
  for (const r of rows) console.log(`| ${r.name} | ${r.cells.map(ms).join(" | ")} |`);
}
