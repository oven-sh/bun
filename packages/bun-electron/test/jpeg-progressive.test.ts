// Verifies the progressive (SOF2) JPEG decode path. No external JPEG encoder
// exists in this environment, so a minimal progressive encoder (test helper)
// produces a genuinely multi-scan progressive bitstream (DC scan + AC scan,
// spectral selection), which the src decoder must reconstruct.

import { describe, expect, test } from "bun:test";
import { decodeJPEG } from "../src/jpeg.ts";
import { encodeProgressiveGrayscale } from "./helpers/jpeg-progressive-encoder.ts";

function isProgressive(buf: Buffer): boolean {
  for (let i = 2; i + 1 < buf.length; ) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const m = buf[i + 1];
    if (m === 0xc2) return true;
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xda) return false; // reached scan without SOF2
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return false;
}

describe("progressive JPEG decode", () => {
  test("the fixture is actually progressive (SOF2)", () => {
    const gray = new Uint8Array(16 * 16).fill(128);
    const jpeg = encodeProgressiveGrayscale(16, 16, gray);
    expect(isProgressive(jpeg)).toBe(true);
  });

  test("decodes a solid-gray progressive JPEG to the right size and color", () => {
    const W = 16;
    const H = 16;
    const gray = new Uint8Array(W * H).fill(120);
    const jpeg = encodeProgressiveGrayscale(W, H, gray);
    const raw = decodeJPEG(jpeg);
    expect(raw).not.toBeNull();
    expect({ w: raw!.width, h: raw!.height }).toEqual({ w: W, h: H });
    // Solid gray 120 should round-trip closely (q=1, only IDCT rounding).
    const cx = 8;
    const cy = 8;
    const i = (cy * W + cx) * 4;
    expect(Math.abs(raw!.data[i] - 120)).toBeLessThanOrEqual(2);
    expect(raw!.data[i]).toBe(raw!.data[i + 1]); // grayscale -> r==g==b
    expect(raw!.data[i + 1]).toBe(raw!.data[i + 2]);
  });

  test("decodes a gradient progressive JPEG (DC + AC scans combine)", () => {
    const W = 24;
    const H = 24;
    const gray = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        gray[y * W + x] = Math.round((x / (W - 1)) * 255);
      }
    }
    const jpeg = encodeProgressiveGrayscale(W, H, gray);
    const raw = decodeJPEG(jpeg)!;
    expect(raw.width).toBe(W);
    expect(raw.height).toBe(H);
    // The left edge is dark, the right edge bright — proving AC coefficients
    // (which carry the gradient within each block) were decoded, not just DC.
    const left = raw.data[(12 * W + 1) * 4];
    const right = raw.data[(12 * W + (W - 2)) * 4];
    expect(left).toBeLessThan(80);
    expect(right).toBeGreaterThan(175);
  });

  test("nativeImage.resize works on a progressive JPEG", async () => {
    const { nativeImage } = await import("../src/index.ts");
    const gray = new Uint8Array(32 * 32).fill(200);
    const jpeg = encodeProgressiveGrayscale(32, 32, gray);
    const img = nativeImage.createFromBuffer(jpeg);
    expect(img.isEmpty()).toBe(false);
    const resized = img.resize({ width: 16, height: 16 });
    expect(resized.getSize()).toEqual({ width: 16, height: 16 });
  });
});
