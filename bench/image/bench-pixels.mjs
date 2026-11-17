// The ways from an 800x500 WebP to its pixels, and from pixels to a file. One frame at a time, as a player does it.
//
//   bun run build:release bench/image/bench-pixels.mjs
//
// Each case runs in a process of its own, for its peak memory.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const [width, height, frames] = [800, 500, 1000];
const photo = join(import.meta.dir, "../../test/js/node/test/fixtures/person-large.jpg");
const webp = await new Bun.Image(photo).resize(width, height).webp({ quality: 80 }).bytes();

// At level 0 the rows are not filtered, so this is the least that a reader of the PNG has to do.
function pixelsOfStoredPng(png) {
  const view = new DataView(png.buffer, png.byteOffset);
  const parts = [];
  for (let at = 8, length; at < png.length; at += 12 + length) {
    length = view.getUint32(at);
    if (view.getUint32(at + 4) === 0x49444154) parts.push(png.subarray(at + 8, at + 8 + length));
  }
  const rows = inflateSync(Buffer.concat(parts), { chunkSize: (1 + 4 * width) * height });
  const pixels = new Uint8ClampedArray(4 * width * height);
  for (let y = 0; y < height; y++) {
    const start = y * (1 + 4 * width) + 1;
    pixels.set(rows.subarray(start, start + 4 * width), y * 4 * width);
  }
  return pixels;
}

function bmpOf({ data }) {
  const bmp = Buffer.allocUnsafe(122 + data.length).fill(0, 0, 122);
  bmp.write("BM");
  [bmp.length, 0, 122, 108, width, -height, 0x200001, 3, data.length].forEach((it, i) =>
    bmp.writeInt32LE(it, 2 + 4 * i),
  );
  [0xff, 0xff00, 0xff0000, 0xff000000].forEach((mask, i) => bmp.writeUInt32LE(mask, 54 + 4 * i));
  bmp.set(data, 122);
  return bmp;
}

const frame = await new Bun.Image(webp).imageData();
const cases = {
  "decode: PNG round trip": async () =>
    pixelsOfStoredPng(await new Bun.Image(webp).png({ compressionLevel: 0 }).bytes()),
  "decode: imageData()": () => new Bun.Image(webp).imageData(),
  "decode: imageData(target)": () => new Bun.Image(webp).imageData(frame),
  "encode as JPEG: from a BMP": () => new Bun.Image(bmpOf(frame)).jpeg().bytes(),
  "encode as JPEG: from an ImageData": () => new Bun.Image(frame).jpeg().bytes(),
};

const name = process.argv[2];
if (name === undefined) {
  console.log("   p50 µs    p99 µs  frames/s   peak MB");
  for (const name in cases) spawnSync(process.execPath, [import.meta.path, name], { stdio: "inherit" });
} else {
  const times = [];
  for (let i = -100; i < frames; i++) {
    const start = Bun.nanoseconds();
    await cases[name]();
    if (i >= 0) times.push((Bun.nanoseconds() - start) / 1000);
  }
  times.sort((a, b) => a - b);
  const perSecond = (frames * 1e6) / times.reduce((a, b) => a + b);
  const columns = [times[frames * 0.5], times[frames * 0.99], perSecond, process.resourceUsage().maxRSS / 1024];
  console.log(`${columns.map(it => it.toFixed(0).padStart(9)).join(" ")}  ${name}`);
}
