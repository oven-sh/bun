// Visual side-by-side: Sharp vs Bun.Image, on real photos.
//
// Pulls a fixed set of CC0 photos from picsum.photos (deterministic by ID) +
// two synthetic torture patterns (zone plate, checker — the only place
// resampler differences are *obvious*). Runs each through a resize×filter×
// format matrix on BOTH engines, composes every pair into a single labelled
// split-screen PNG, and writes a comparison.md that just lists those.
//
// Run with the release build:
//   build/release/bun bench/image/visual-compare.mjs
// Then:
//   cd bench/image/out && gh gist create -d "Bun.Image vs Sharp visual" comparison.md cmp_*.png src_*.jpg

import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import zlib from "node:zlib";

const OUT = new URL("./out/", import.meta.url).pathname;
const CACHE = new URL("./.cache/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

// ─── real photo set ─────────────────────────────────────────────────────────
// IDs hand-picked from picsum.photos/images for content variety. ~2400×1600
// JPEG each (~400 KB). Cached so re-runs don't re-fetch.
const PICS = [
  { id: 1015, name: "river", note: "fine foliage texture" },
  { id: 1025, name: "pug", note: "fur detail, shallow DOF" },
  { id: 1040, name: "castle", note: "hard architectural edges" },
  { id: 1043, name: "leaves", note: "high-frequency green" },
  { id: 1056, name: "road", note: "vanishing-point lines" },
  { id: 1069, name: "jellyfish", note: "soft gradients on black" },
  { id: 1074, name: "lion", note: "fur + bokeh" },
  { id: 1080, name: "strawberries", note: "saturated red, seed detail" },
  { id: 110, name: "field", note: "sky gradient banding test" },
  { id: 237, name: "puppy", note: "dark fur, high contrast" },
  { id: 433, name: "bear", note: "fur, snow highlights" },
  { id: 660, name: "city-night", note: "point lights, noise" },
];

async function fetchPic(p) {
  const path = CACHE + `pic_${p.id}.jpg`;
  if (existsSync(path)) return readFileSync(path);
  process.stderr.write(`  fetch ${p.name} (#${p.id})… `);
  const res = await fetch(`https://picsum.photos/id/${p.id}/2400/1600`, { redirect: "follow" });
  if (!res.ok) throw new Error(`picsum ${p.id}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  process.stderr.write(`${(buf.length / 1024).toFixed(0)} KB\n`);
  return buf;
}

// ─── synthetic torture patterns (kept; they're where filters visibly differ) ─
function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function makePng(w, h, px) {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      const p = row + 1 + x * 4;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
      raw[p + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}
const SYN_W = 1024;
const synthetic = {
  zoneplate: {
    note: "Moiré / ringing torture test",
    bytes: makePng(SYN_W, SYN_W, (x, y) => {
      const cx = x - SYN_W / 2,
        cy = y - SYN_W / 2;
      const v = Math.round(128 + 127 * Math.cos((cx * cx + cy * cy) / 512));
      return [v, v, v];
    }),
  },
  checker8: {
    note: "hard-edge ringing",
    bytes: makePng(SYN_W, SYN_W, (x, y) => ((((x >> 3) + (y >> 3)) & 1) === 0 ? [0, 0, 0] : [255, 255, 255])),
  },
};

// ─── matrix ─────────────────────────────────────────────────────────────────
const resizes = [
  { name: "thumb_400_lanczos3", w: 400, h: 267, filter: "lanczos3" },
  { name: "thumb_400_mitchell", w: 400, h: 267, filter: "mitchell" },
  { name: "thumb_200_mks2013", w: 200, h: 133, filter: "mks2013" },
  { name: "tiny_64_lanczos3", w: 64, h: 64, filter: "lanczos3", fit: "inside" },
];
const formats = [
  { name: "jpegq80", enc: "jpeg", opts: { quality: 80 } },
  { name: "webpq80", enc: "webp", opts: { quality: 80 } },
  { name: "png", enc: "png", opts: {} },
];
const sharpKernel = { lanczos3: "lanczos3", mitchell: "mitchell", mks2013: "mks2013", nearest: "nearest" };

// ─── compose helper ─────────────────────────────────────────────────────────
async function compose(sharpOut, bunOut, sharpSize, bunSize) {
  // Display tiles capped at 320; checker underlay; label strip below.
  const sMeta = await sharp(sharpOut).metadata();
  const tile = Math.min(320, sMeta.width);
  const gutter = 2,
    label = 28;
  const svg = Buffer.from(`
    <svg width="${tile * 2 + gutter}" height="${tile + label}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#1a1b1e"/>
      <text x="${tile / 2}" y="${tile + 19}" fill="#888" font-family="monospace"
            font-size="12" text-anchor="middle">sharp · ${(sharpSize / 1024).toFixed(1)} KB</text>
      <text x="${tile + gutter + tile / 2}" y="${tile + 19}" fill="#fff" font-family="monospace"
            font-size="12" text-anchor="middle" font-weight="bold">Bun.Image · ${(bunSize / 1024).toFixed(1)} KB</text>
    </svg>`);
  const sT = await sharp(sharpOut).resize(tile, tile, { fit: "inside" }).png().toBuffer();
  const bT = await sharp(bunOut).resize(tile, tile, { fit: "inside" }).png().toBuffer();
  const sM = await sharp(sT).metadata();
  const top = Math.floor((tile - sM.height) / 2);
  return sharp(svg)
    .composite([
      { input: sT, top, left: 0 },
      { input: bT, top, left: tile + gutter },
    ])
    .png()
    .toBuffer();
}

// ─── run ────────────────────────────────────────────────────────────────────
process.stderr.write("Fetching photos…\n");
const sources = [];
for (const p of PICS) sources.push({ name: p.name, note: p.note, bytes: await fetchPic(p) });
for (const [name, s] of Object.entries(synthetic)) sources.push({ name, note: s.note, bytes: s.bytes });

const rows = [];
let n = 0;
const total = sources.length * resizes.length * formats.length;
process.stderr.write(
  `Processing ${sources.length} sources × ${resizes.length} resizes × ${formats.length} formats = ${total}…\n`,
);

for (const src of sources) {
  // Save a 600-wide source thumbnail for the markdown header.
  const srcThumb = await sharp(src.bytes).resize(600, 600, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
  writeFileSync(OUT + `src_${src.name}.jpg`, srcThumb);

  for (const rz of resizes) {
    for (const fmt of formats) {
      const stem = `${src.name}__${rz.name}__${fmt.name}`;
      n++;
      process.stderr.write(`[${n}/${total}] ${stem}      \r`);

      const bunOut = await new Bun.Image(src.bytes)
        .resize(rz.w, rz.h, { filter: rz.filter, fit: rz.fit ?? "fill" })
        [fmt.enc](fmt.opts)
        .bytes();
      const sharpOut = await sharp(src.bytes)
        .resize(rz.w, rz.h, { kernel: sharpKernel[rz.filter], fit: rz.fit ?? "fill" })
        [fmt.enc](fmt.opts)
        .toBuffer();

      const cmp = await compose(sharpOut, bunOut, sharpOut.length, bunOut.length);
      writeFileSync(OUT + `cmp_${stem}.png`, cmp);

      rows.push({
        src: src.name,
        rz: rz.name,
        fmt: fmt.name,
        stem,
        bunSize: bunOut.length,
        sharpSize: sharpOut.length,
      });
    }
  }
}
process.stderr.write("\n");

// ─── markdown ───────────────────────────────────────────────────────────────
let md = `# Bun.Image vs Sharp — visual comparison

${PICS.length} CC0 photos from [picsum.photos](https://picsum.photos) (2400×1600
source) + 2 synthetic torture patterns. Every pair is **left = sharp, right =
Bun.Image**, with the encoded byte size under each. Bun.Image runs the i16
fixed-point Highway path; sharp is libvips ${sharp.versions.vips}.

`;

for (const src of sources) {
  md += `---\n\n## ${src.name}\n\n*${src.note}*\n\n![](src_${src.name}.jpg)\n\n`;
  for (const rz of resizes) {
    md += `### ${rz.name.replaceAll("_", " ")}\n\n`;
    for (const fmt of formats) {
      const r = rows.find(x => x.src === src.name && x.rz === rz.name && x.fmt === fmt.name);
      const ds = (((r.bunSize - r.sharpSize) / r.sharpSize) * 100).toFixed(0);
      md += `**${fmt.name}** (Δ ${ds > 0 ? "+" : ""}${ds}%)  \n![](cmp_${r.stem}.png)\n\n`;
    }
  }
}

writeFileSync(OUT + "comparison.md", md);
const cmpCount = rows.length;
console.log(`\nWrote ${cmpCount} composites + ${sources.length} source thumbs + comparison.md to ${OUT}`);
console.log(
  `\nUpload as a private gist:\n  cd ${OUT} && gh gist create -d "Bun.Image vs Sharp visual" comparison.md src_*.jpg cmp_*.png\n`,
);
