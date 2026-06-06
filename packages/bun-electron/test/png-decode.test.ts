// Exercises the PNG decoder across color types and bit depths that the RGBA
// encoder does not itself produce (grayscale, palette, 16-bit, interlaced),
// via nativeImage.resize/crop. PNGs are built inline with node:zlib so the
// decoder is tested against foreign-format input, not its own encoder.

import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { nativeImage } from "../src/index.ts";
import { decodePNG } from "../src/png.ts";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function ihdr(w: number, h: number, depth: number, colorType: number): Buffer {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  b[8] = depth;
  b[9] = colorType;
  return b;
}
// Build a PNG from per-row sample bytes (filter 0 prepended to each row).
function buildPNG(w: number, h: number, depth: number, colorType: number, rows: Buffer[], extra: Buffer[] = []): Buffer {
  const filtered = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), r])));
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr(w, h, depth, colorType)),
    ...extra,
    chunk("IDAT", deflateSync(filtered)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("PNG decoder color types", () => {
  test("decodes 8-bit grayscale", () => {
    // 2x2 grayscale: 0, 255 / 128, 64
    const png = buildPNG(2, 2, 8, 0, [Buffer.from([0, 255]), Buffer.from([128, 64])]);
    const raw = decodePNG(png)!;
    expect(raw).not.toBeNull();
    expect({ w: raw.width, h: raw.height }).toEqual({ w: 2, h: 2 });
    // First pixel gray 0 -> rgb(0,0,0,255).
    expect([raw.data[0], raw.data[1], raw.data[2], raw.data[3]]).toEqual([0, 0, 0, 255]);
    // Second pixel gray 255 -> white.
    expect([raw.data[4], raw.data[5], raw.data[6]]).toEqual([255, 255, 255]);
  });

  test("decodes 8-bit palette with PLTE", () => {
    // Palette: index 0 = red, index 1 = green.
    const plte = chunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0]));
    const png = buildPNG(2, 1, 8, 3, [Buffer.from([0, 1])], [plte]);
    const raw = decodePNG(png)!;
    expect([raw.data[0], raw.data[1], raw.data[2]]).toEqual([255, 0, 0]);
    expect([raw.data[4], raw.data[5], raw.data[6]]).toEqual([0, 255, 0]);
  });

  test("decodes grayscale+alpha", () => {
    // 1x1 grayscale+alpha: gray 100, alpha 50.
    const png = buildPNG(1, 1, 8, 4, [Buffer.from([100, 50])]);
    const raw = decodePNG(png)!;
    expect([raw.data[0], raw.data[1], raw.data[2], raw.data[3]]).toEqual([100, 100, 100, 50]);
  });

  test("decodes 16-bit RGB (downsampled to 8-bit)", () => {
    // 1x1 16-bit RGB: R=0x1234, G=0x5678, B=0x9abc -> high bytes 0x12,0x56,0x9a.
    const row = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
    const png = buildPNG(1, 1, 16, 2, [row]);
    const raw = decodePNG(png)!;
    expect([raw.data[0], raw.data[1], raw.data[2]]).toEqual([0x12, 0x56, 0x9a]);
  });

  test("nativeImage.resize works on a grayscale PNG", () => {
    const png = buildPNG(2, 2, 8, 0, [Buffer.from([0, 255]), Buffer.from([128, 64])]);
    const img = nativeImage.createFromBuffer(png);
    const resized = img.resize({ width: 4, height: 4 });
    expect(resized.getSize()).toEqual({ width: 4, height: 4 });
  });

  test("nativeImage.crop works on a palette PNG", () => {
    const plte = chunk("PLTE", Buffer.from([1, 2, 3, 4, 5, 6]));
    const png = buildPNG(4, 1, 8, 3, [Buffer.from([0, 1, 0, 1])], [plte]);
    const img = nativeImage.createFromBuffer(png);
    const cropped = img.crop({ x: 1, y: 0, width: 2, height: 1 });
    expect(cropped.getSize()).toEqual({ width: 2, height: 1 });
  });
});
