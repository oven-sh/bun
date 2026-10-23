// Bun.Image palette PNG: the time of the palette search, per kind of input and per palette size.
//
//   bun bench-palette-search.mjs [--json] [--calls=N] [image files to add as rows]
//
// Prints the least time of N calls of
//   new Bun.Image(input).png({ palette: true, colors, dither }).bytes()
// per row, without and with dither, at 256 to 2 colours. The encode searches
// the palette once per pixel, so the colour count is the length of each
// search. The least of N, so that two builds can be run in turn and compared
// row by row. `--json` prints the rows as one object.
//
// The rows are the kinds of input the search is sensitive to: a screenshot
// and a generated image with flat areas (long runs of one colour), a photo,
// thumbnails of it, and noise (no colour repeats).

import path from "node:path";
import zlib from "node:zlib";

const repo = path.join(import.meta.dir, "..", "..");

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function makePng(w, h, pixelOf) {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set(pixelOf(x, y), y * (1 + w * 4) + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// A window with a title bar, a side bar and a white page: three flat areas,
// and a strip of gradient so that the image has more than 256 colours.
const flat = makePng(1024, 1024, (x, y) => {
  if (y < 48) return [36, 41, 47, 255];
  if (y < 64) return [x >> 2, 128 + (x >> 3), 255 - (x >> 2), 255];
  return x < 240 ? [246, 248, 250, 255] : [255, 255, 255, 255];
});

let seed = 1;
const nextByte = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;
const noise = makePng(512, 512, () => [nextByte(), nextByte(), nextByte(), 255]);

const screenshot = await Bun.file(path.join(repo, "docs/images/guides/digitalocean-3.png")).bytes();
const photo = await Bun.file(path.join(repo, "test/js/node/test/fixtures/person-large.jpg")).bytes();
const thumbnail = size => new Bun.Image(photo).resize(size, size).png().bytes();

const args = process.argv.slice(2);
const json = args.includes("--json");
const calls = Number(args.find(arg => arg.startsWith("--calls="))?.slice("--calls=".length) ?? 0);
const files = args.filter(arg => !arg.startsWith("--"));

const inputs = [
  ["screenshot 5272x2828", screenshot],
  ["flat areas 1024x1024", flat],
  ["photo 1000x1333", photo],
  ["photo 64x64", await thumbnail(64)],
  ["photo 32x32", await thumbnail(32)],
  ["noise 512x512", noise],
];
for (const file of files) inputs.push([path.basename(file), await Bun.file(file).bytes()]);

// From 4 colours up the search takes several entries per step: 4 and 5 are its smallest cases.
const colorCounts = [256, 64, 16, 8, 5, 4, 2];
const encode = (input, colors, dither) => new Bun.Image(input).png({ palette: true, colors, dither }).bytes();

const rows = [];
for (const [name, input] of inputs) {
  const { width, height } = await new Bun.Image(input).metadata();
  const pixels = width * height;
  // About the same work per row: more calls of a smaller image.
  const n = calls || Math.max(5, Math.min(400, Math.round(3e7 / pixels)));
  for (const dither of [false, true]) {
    const row = { name, dither, pixels, calls: n, ms: {}, bytes: {} };
    for (const colors of colorCounts) {
      let least = Infinity;
      for (let i = 0; i < n; i++) {
        const start = Bun.nanoseconds();
        const out = await encode(input, colors, dither);
        least = Math.min(least, Bun.nanoseconds() - start);
        row.bytes[colors] = out.length;
      }
      row.ms[colors] = least / 1e6;
    }
    rows.push(row);
  }
}

if (json) {
  console.log(JSON.stringify({ revision: Bun.revision, rows }));
} else {
  const ms = v => (v >= 10 ? v.toFixed(0) : v.toFixed(3)).padStart(9);
  console.log(`bun ${Bun.version} (${Bun.revision.slice(0, 9)}), least of N calls, ms`);
  console.log(
    `${"input".padEnd(22)}${"dither".padEnd(7)}${"N".padStart(4)}${colorCounts.map(c => String(c).padStart(9)).join("")}`,
  );
  for (const row of rows) {
    const cells = colorCounts.map(c => ms(row.ms[c])).join("");
    console.log(
      `${row.name.padEnd(22)}${(row.dither ? "yes" : "no").padEnd(7)}${String(row.calls).padStart(4)}${cells}`,
    );
  }
}
