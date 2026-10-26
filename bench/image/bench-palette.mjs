// Bun.Image palette PNG — time, output size and error of
// png({ palette: true, colors }) against truecolour png(), with and without
// dither.
//
// Fixtures are generated in-process so nothing binary is committed: a
// screenshot-like image (flat areas, antialiased text, a gradient banner), the
// same with a banner of one colour per column (under 256 colours, so it fits
// the default palette), a photo-like one (gradients with noise), a thumbnail
// of it, a flat image with sparse marks (opaque and with alpha), a sprite on a
// transparent background and faint greys. Pass PNG/JPEG paths to measure real
// files instead. Run with --sharp to add a sharp column (requires `bun install`
// in this dir first) and with --rounds=N for N timed rounds per row (default
// 7).
//
// `error` is the mean squared difference per channel between the output and
// the pixels Bun.Image decodes from the input, with colour multiplied by
// alpha. `over black` and `over white` are the same for the three colour
// channels as the two images show over that background: an opaque image has
// one number for both. `entries` is the palette size, as "different of all"
// when two entries are the same colour.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
  const px = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    for (let x = 0; x < w; x++) {
      pixel(x, y, px);
      const p = row + 1 + x * 4;
      raw[p] = px[0];
      raw[p + 1] = px[1];
      raw[p + 2] = px[2];
      raw[p + 3] = px[3];
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
const set = (px, r, g, b, a = 255) => ((px[0] = r), (px[1] = g), (px[2] = b), (px[3] = a));

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

// A flat background with one marked pixel every 32 columns and rows: 121
// colours, or 321 with `alpha` (then the background is half transparent).
// The marks sit 3, 8, 20, 50 and 127 levels from the background on each side
// of each channel, so every cut takes a thin layer off the box that holds the
// background, and that box keeps 99.9% of the pixels for 30 to 40 splits.
const marks = alpha => (x, y, px) => {
  const back = alpha ? 127 : 255;
  if (x % 32 || y % 32) return set(px, 127, 127, 127, back);
  const channels = alpha ? 4 : 3;
  const i = (y / 32) * 60 + x / 32;
  const k = i % (channels * 10);
  const ch = k % channels;
  const c = [127, 127, 127, back];
  for (let o = 0, bit = 0; o < channels; o++) if (o !== ch) c[o] += ((i / (channels * 10)) >> bit++) & 1;
  c[ch] = 127 + ((k / channels) & 1 ? 1 : -1) * [127, 50, 20, 8, 3][(k / (channels * 2)) | 0];
  return set(px, c[0], c[1], c[2], c[3]);
};
// Faint greys: rows 0 to 46 are fully transparent, and below them grey 30 to
// 240 runs across under alpha 0 to 48 down. A shadow or a glow on its own
// layer looks like this.
const faint = (x, y, px) => {
  const u = x / 127;
  const v = Math.round(u < 0.5 ? 30 + 98 * 2 * u : 128 + 112 * (2 * u - 1));
  const a = y < 47 ? 0 : Math.round(48 * Math.sqrt((y - 47) / 80));
  return a === 0 ? set(px, 0, 0, 0, 0) : set(px, v, v, v, a);
};
// A round sprite on a fully transparent background: a body with a gradient,
// an antialiased edge and a soft shadow below it.
const sprite = (x, y, px) => {
  const d = Math.hypot(x - 512, y - 480);
  const cover = Math.min(1, Math.max(0, 300.5 - d));
  const shadow = 0.5 * Math.exp(-(((x - 512) / 330) ** 2 + ((y - 840) / 40) ** 2));
  const a = cover + (1 - cover) * shadow;
  if (a < 1 / 510) return set(px, 0, 0, 0, 0);
  const t = (y - 180) / 600;
  const k = cover / a;
  return set(px, k * (250 - 60 * t), k * (190 - 90 * t), k * (60 + 40 * t), 255 * a);
};

// A PNG that is not interlaced, as RGBA pixels and its palette entries: colour
// type 2 or 6 at 8 bits, or colour type 3 at 1, 2, 4 or 8 bits per index.
function decodePng(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  let depth = 8;
  let type = 0;
  let plte = new Uint8Array(0);
  let trns = new Uint8Array(0);
  const idat = [];
  for (let at = 8; at < png.length;) {
    const length = dv.getUint32(at);
    const name = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    const data = png.subarray(at + 8, at + 8 + length);
    if (name === "IHDR") {
      width = dv.getUint32(at + 8);
      height = dv.getUint32(at + 12);
      depth = png[at + 16];
      type = png[at + 17];
      const depths = type === 3 ? [1, 2, 4, 8] : [8];
      if (!depths.includes(depth) || png[at + 20] !== 0 || ![2, 3, 6].includes(type)) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${type}, interlace ${png[at + 20]}`);
      }
    } else if (name === "PLTE") plte = data;
    else if (name === "tRNS") trns = data;
    else if (name === "IDAT") idat.push(data);
    at += 12 + length;
  }
  const bpp = type === 3 ? 1 : type === 2 ? 3 : 4;
  // A row of indices is packed from the high bits of each byte.
  const stride = type === 3 ? Math.ceil((width * depth) / 8) : width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? rows[out + i - bpp] : 0;
      const b = y ? rows[out + i - stride] : 0;
      const c = i >= bpp && y ? rows[out + i - stride - bpp] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[out + i] = raw[src + i] + predicted;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const entries = [];
  for (let i = 0; i < plte.length / 3; i++) {
    entries.push([plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], i < trns.length ? trns[i] : 255]);
  }
  for (let p = 0; p < width * height; p++) {
    if (type === 3) {
      const bit = (p % width) * depth;
      const byte = rows[Math.floor(p / width) * stride + (bit >> 3)];
      rgba.set(entries[(byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)], p * 4);
    } else {
      rgba[p * 4] = rows[p * bpp];
      rgba[p * 4 + 1] = rows[p * bpp + 1];
      rgba[p * 4 + 2] = rows[p * bpp + 2];
      rgba[p * 4 + 3] = type === 6 ? rows[p * bpp + 3] : 255;
    }
  }
  return { rgba, entries };
}
// Mean squared difference per channel, with colour multiplied by alpha: of
// the four channels, and of the colour as it shows over black and over white.
function errorOf(source, output) {
  let [alpha, black, white] = [0, 0, 0];
  for (let i = 0; i < source.length; i += 4) {
    const sa = source[i + 3];
    const oa = output[i + 3];
    for (let c = 0; c < 3; c++) {
      const d = (((source[i + c] * sa + 127) / 255) | 0) - (((output[i + c] * oa + 127) / 255) | 0);
      black += d * d;
      // White shows through what the alpha leaves.
      white += (d - sa + oa) * (d - sa + oa);
    }
    alpha += (sa - oa) * (sa - oa);
  }
  const colour = (source.length / 4) * 3;
  return { error: (black + alpha) / source.length, black: black / colour, white: white / colour };
}

const args = process.argv.slice(2);
const paths = args.filter(a => !a.startsWith("--"));
// [name, PNG, calls per sample]
const fixtures = paths.length
  ? paths.map(p => [p, readFileSync(p), 1])
  : [
      ["screenshot 1920×1080", makePng(1920, 1080, screenshot(1)), 1],
      ["screenshot 1920×1080, under 256 colours", makePng(1920, 1080, screenshot(0)), 1],
      ["photo 1024×768", makePng(1024, 768, photo(1)), 1],
      ["photo 64×48", makePng(64, 48, photo(16)), 50],
      ["flat with sparse marks 1920×1080", makePng(1920, 1080, marks(false)), 1],
      ["flat with sparse marks 1920×1080, with alpha", makePng(1920, 1080, marks(true)), 1],
      ["sprite 1024×1024, with alpha", makePng(1024, 1024, sprite), 1],
      ["faint greys 128×128, with alpha", makePng(128, 128, faint), 20],
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

const ROUNDS = Number(args.find(a => a.startsWith("--rounds="))?.slice(9) ?? 7);
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
  `| input | output | min ms | median ms | bytes | vs truecolour | error | over black | over white | entries |${sharp ? " sharp ms | sharp bytes |" : ""}`,
);
console.log(`|---|---|---:|---:|---:|---:|---:|---:|---:|---:|${sharp ? "---:|---:|" : ""}`);
for (const [name, buf, calls] of fixtures) {
  let source;
  try {
    source = decodePng(await new Bun.Image(buf).png().bytes()).rgba;
  } catch (e) {
    console.log(`| ${name} | not decoded: ${e.message} | | | | | | | | |${sharp ? " | |" : ""}`);
    continue;
  }
  const truecolour = await measure(() => new Bun.Image(buf).png().bytes(), calls);
  const rows = [["png()", truecolour, null]];
  for (const colors of [2, 16, 32, 64, 256]) {
    for (const dither of [false, true]) {
      const label = `palette, colors ${colors}${dither ? ", dither" : ""}`;
      const bun = await measure(() => new Bun.Image(buf).png({ palette: true, colors, dither }).bytes(), calls);
      // Once per row, outside the timed rounds.
      const { rgba, entries } = decodePng(await new Bun.Image(buf).png({ palette: true, colors, dither }).bytes());
      const different = new Set(entries.map(e => e.join())).size;
      bun.errors = errorOf(source, rgba);
      bun.entries = different === entries.length ? `${different}` : `${different} of ${entries.length}`;
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
    const errors = ["error", "black", "white"].map(key => r.errors?.[key].toPrecision(4) ?? "").join(" | ");
    const extra = sharp ? ` ${other ? other.min.toFixed(1) : ""} | ${other ? other.bytes : ""} |` : "";
    console.log(
      `| ${name} | ${label} | ${r.min.toFixed(2)} | ${r.median.toFixed(2)} | ${r.bytes} | ${ratio} | ${errors} | ${r.entries ?? ""} |${extra}`,
    );
  }
}
