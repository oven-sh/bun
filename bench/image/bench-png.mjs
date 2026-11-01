// Bun.Image's PNG codec (src/png), one line per case: best time in milliseconds.
//
//   bun run build:release bench/image/bench-png.mjs
//
// There is nothing to compare with in here: run it with the build before a change and the one after. Use release
// builds. What the compiler makes of the loops in src/png depends on how it is run, and a release build optimizes the
// crates at link time.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.endsWith(".png")) yield path;
  }
}
// Screenshots, all 8-bit RGBA.
const screenshots = [...walk(join(import.meta.dir, "../../docs/images"))]
  .map(path => readFileSync(path))
  .sort((a, b) => b.length - a.length)
  .slice(0, 24);
const photo = await new Bun.Image(readFileSync(join(import.meta.dir, "../../docs/images/cat.jpg"))).png().bytes();

async function report(name, rounds, fn) {
  let best = Infinity;
  for (let i = 0; i < rounds; i++) {
    const start = Bun.nanoseconds();
    await fn();
    best = Math.min(best, Bun.nanoseconds() - start);
  }
  console.log(`${(best / 1e6).toFixed(1).padStart(9)}  ${name}`);
}

// Next to nothing but the decoding.
const decode = png => new Bun.Image(png).resize(1, 1, { filter: "nearest" }).png({ compressionLevel: 0 }).bytes();
const each = (files, fn) => async () => {
  for (const file of files) await fn(file);
};

await report("decode 24 screenshots", 7, each(screenshots, decode));
await report("decode a photo", 15, () => decode(photo));
const everyFourth = screenshots.filter((_, i) => i % 4 === 0);
for (const compressionLevel of [0, 1, 6, 9]) {
  const encode = png => new Bun.Image(png).png({ compressionLevel }).bytes();
  await report(`decode 6 screenshots and encode them at level ${compressionLevel}`, 3, each(everyFourth, encode));
  await report(`decode a photo and encode it at level ${compressionLevel}`, 5, () => encode(photo));
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const whole = [[0, 0, 1, 1]];
const adam7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/** Noise with the same filter on every row, stored, so that inflating it costs next to nothing. */
function noise(width, height, depth, colorType, channels, filter, interlaced = false) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([depth, colorType, 0, 0, Number(interlaced)], 8);
  const passes = (interlaced ? adam7 : whole).map(([x, y, xStep, yStep]) => ({
    lineLength: 1 + Math.ceil((Math.ceil((width - x) / xStep) * channels * depth) / 8),
    rows: Math.ceil((height - y) / yStep),
  }));
  const lines = Buffer.alloc(passes.reduce((sum, pass) => sum + pass.lineLength * pass.rows, 0));
  let seed = 1;
  for (let i = 0; i < lines.length; i++) lines[i] = (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;
  let at = 0;
  for (const pass of passes) for (let y = 0; y < pass.rows; y++, at += pass.lineLength) lines[at] = filter;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(lines, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, depth, colorType, channels] of [
  ["RGBA", 8, 6, 4],
  ["RGB", 8, 2, 3],
  ["gray", 8, 0, 1],
  ["gray and alpha", 8, 4, 2],
  ["RGBA", 16, 6, 4],
  ["RGB", 16, 2, 3],
  ["gray", 1, 0, 1],
]) {
  for (const [filter, filterName] of ["None", "Sub", "Up", "Average", "Paeth"].entries()) {
    const png = noise(3000, 2000, depth, colorType, channels, filter);
    await report(`decode 3000x2000 of noise, ${depth}-bit ${name}, ${filterName}`, 9, () => decode(png));
    if (depth !== 8 || channels < 3) continue;
    const interlaced = noise(3000, 2000, depth, colorType, channels, filter, true);
    await report(`decode 3000x2000 of noise, ${depth}-bit ${name}, ${filterName}, interlaced`, 9, () =>
      decode(interlaced),
    );
  }
}
