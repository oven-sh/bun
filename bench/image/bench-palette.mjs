// Bun.Image palette PNG — time and output size of png({ palette: true, colors })
// against truecolour png(), with and without dither.
//
// Fixtures are generated in-process so nothing binary is committed: a
// screenshot-like image (flat areas, antialiased text, a gradient banner), the
// same with a banner of one colour per column (under 256 colours, so it fits
// the default palette), a photo-like one (gradients with noise) and a
// thumbnail of it. Pass PNG/JPEG paths to measure real files instead. Run
// with --sharp to add a sharp column (requires `bun install` in this dir
// first).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";
import zlib from "node:zlib";

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
function makePng(w, h, pixel) {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(h * (1 + w * 4));
  const px = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    for (let x = 0; x < w; x++) {
      pixel(x, y, px);
      const p = row + 1 + x * 4;
      raw[p] = px[0];
      raw[p + 1] = px[1];
      raw[p + 2] = px[2];
      raw[p + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const hash = (x, y) => (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) >>> 0;
const set = (px, r, g, b) => ((px[0] = r), (px[1] = g), (px[2] = b));

// 1920×1080: header, sidebar, text lines with 16 levels of edge coverage,
// three flat buttons, one gradient banner. `bannerRows` is 1 for a banner
// that also changes down its rows (thousands of colours) and 0 for one colour
// per column.
const screenshot = bannerRows => (x, y, px) => {
  if (y < 64) return set(px, 32, 34, 37);
  if (x < 240) return set(px, 241, 243, 245);
  if (y >= 80 && y < 200 && x >= 280) {
    const t = (x - 280) / 1640;
    const s = (bannerRows * (y - 80)) / 120;
    return set(px, 40 + 100 * t, 80 - 20 * t + 60 * s, 200 - 40 * s);
  }
  if (y >= 980 && y < 1020 && x >= 280 && x < 640) {
    const which = ((x - 280) / 120) | 0;
    return which === 0 ? set(px, 31, 136, 61) : which === 1 ? set(px, 9, 105, 218) : set(px, 207, 34, 46);
  }
  if (y >= 240 && y < 960 && x >= 280 && x < 1800 && y % 24 >= 8 && y % 24 < 18 && hash(x >> 3, (y / 24) | 0) % 5) {
    const cover = (hash(x, y) >>> 8) % 16;
    const v = 250 - ((250 - 36) * cover) / 15;
    return set(px, v, v + (cover >> 2), v + (cover >> 1));
  }
  return set(px, 250, 250, 250);
};
// Smooth gradients plus ±6 of noise per channel, `step` source pixels apart.
const photo = step => (x, y, px) => {
  const n = hash(x, y);
  const wave = (v, k) => Math.sin(v * k) * 0.5 + 0.5;
  const fx = (x * step) / 1024;
  const fy = (y * step) / 768;
  set(
    px,
    10 + 235 * wave(fx, 6.3) + (n % 13) - 6,
    10 + 235 * wave(fy + fx * 0.5, 4.1) + ((n >>> 8) % 13) - 6,
    10 + 235 * wave(fx + fy, 3.0) + ((n >>> 16) % 13) - 6,
  );
};

const args = process.argv.slice(2);
const paths = args.filter(a => !a.startsWith("--"));
// [name, PNG, calls per sample]
const fixtures = paths.length
  ? paths.map(p => [basename(p), readFileSync(p), 1])
  : [
      ["screenshot 1920×1080", makePng(1920, 1080, screenshot(1)), 1],
      ["screenshot 1920×1080, under 256 colours", makePng(1920, 1080, screenshot(0)), 1],
      ["photo 1024×768", makePng(1024, 768, photo(1)), 1],
      ["photo 64×48", makePng(64, 48, photo(16)), 50],
    ];

let sharp = null;
if (args.includes("--sharp")) {
  try {
    sharp = createRequire(import.meta.url)("sharp");
    // One op = one task, as in Bun.Image.
    sharp.concurrency(1);
    sharp.cache(false);
  } catch (e) {
    process.stderr.write(`sharp unavailable: ${e.message}\n`);
  }
}

const ROUNDS = 7;
async function measure(fn, calls) {
  const times = [];
  let bytes = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = performance.now();
    for (let call = 0; call < calls; call++) bytes = (await fn()).length;
    times.push((performance.now() - t0) / calls);
  }
  times.sort((a, b) => a - b);
  return { min: times[0], median: times[ROUNDS >> 1], bytes };
}

console.log(`\n### palette PNG, ${ROUNDS} rounds, ${process.platform}/${process.arch}, bun ${Bun.version}\n`);
console.log(
  `| input | output | min ms | median ms | bytes | vs truecolour |${sharp ? " sharp ms | sharp bytes |" : ""}`,
);
console.log(`|---|---|---:|---:|---:|---:|${sharp ? "---:|---:|" : ""}`);
for (const [name, buf, calls] of fixtures) {
  const truecolour = await measure(() => new Bun.Image(buf).png().bytes(), calls);
  const rows = [["png()", truecolour, null]];
  for (const colors of [2, 16, 64, 256]) {
    for (const dither of [false, true]) {
      const label = `palette, colors ${colors}${dither ? ", dither" : ""}`;
      const bun = await measure(() => new Bun.Image(buf).png({ palette: true, colors, dither }).bytes(), calls);
      // sharp rounds colours up to 2, 4, 16 or 256.
      const other =
        sharp && colors !== 64
          ? await measure(
              () =>
                sharp(buf)
                  .png({ palette: true, colours: colors, dither: dither ? 1 : 0 })
                  .toBuffer(),
              calls,
            )
          : null;
      rows.push([label, bun, other]);
    }
  }
  // A Response body is encoded on the JS thread.
  rows.push([
    "palette, colors 256, as Response body",
    await measure(() => new Response(new Bun.Image(buf).png({ palette: true })).bytes(), calls),
    null,
  ]);
  for (const [label, r, other] of rows) {
    const ratio = `${(truecolour.bytes / r.bytes).toFixed(2)}×`;
    const extra = sharp ? ` ${other ? other.min.toFixed(1) : ""} | ${other ? other.bytes : ""} |` : "";
    console.log(
      `| ${name} | ${label} | ${r.min.toFixed(2)} | ${r.median.toFixed(2)} | ${r.bytes} | ${ratio} |${extra}`,
    );
  }
}
