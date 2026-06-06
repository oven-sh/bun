// Ported from Electron's spec/api-native-image-spec.ts (encoding/metadata
// subset; no raster operations).

import { describe, expect, test } from "bun:test";
import { nativeImage } from "../src/index.ts";

// 1x1 transparent PNG.
const ONE_BY_ONE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("nativeImage module", () => {
  describe("createEmpty()", () => {
    test("returns an empty image", () => {
      const empty = nativeImage.createEmpty();
      expect(empty.isEmpty()).toBe(true);
      expect(empty.getSize()).toEqual({ width: 0, height: 0 });
      expect(empty.getAspectRatio()).toBe(1);
    });
  });

  describe("createFromPath(path)", () => {
    test("returns an empty image when the path does not exist", () => {
      const image = nativeImage.createFromPath("/does/not/exist.png");
      expect(image.isEmpty()).toBe(true);
    });
  });

  describe("createFromBuffer(buffer)", () => {
    test("throws for non-buffer input", () => {
      expect(() => nativeImage.createFromBuffer(1 as never)).toThrow(/buffer must be a node Buffer/);
    });

    test("parses PNG dimensions", () => {
      const image = nativeImage.createFromBuffer(Buffer.from(ONE_BY_ONE, "base64"));
      expect(image.isEmpty()).toBe(false);
      expect(image.getSize()).toEqual({ width: 1, height: 1 });
    });
  });

  describe("createFromDataURL(dataURL)", () => {
    test("decodes a PNG data URL", () => {
      const image = nativeImage.createFromDataURL(`data:image/png;base64,${ONE_BY_ONE}`);
      expect(image.isEmpty()).toBe(false);
      expect(image.getSize()).toEqual({ width: 1, height: 1 });
    });

    test("returns an empty image for malformed data URLs", () => {
      expect(nativeImage.createFromDataURL("data:nope").isEmpty()).toBe(true);
    });
  });

  describe("resize()", () => {
    // Build a 4x4 opaque-red RGBA PNG with the package's own encoder so the
    // codec round-trip is self-consistent.
    function redPng(w: number, h: number) {
      const { encodePNG } = require("../src/png") as typeof import("../src/png");
      const data = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = 255;
        data[i * 4 + 3] = 255;
      }
      return encodePNG({ width: w, height: h, data });
    }

    test("resizes to the requested dimensions", () => {
      const img = nativeImage.createFromBuffer(redPng(4, 4));
      const resized = img.resize({ width: 8, height: 8 });
      expect(resized.getSize()).toEqual({ width: 8, height: 8 });
    });

    test("preserves aspect ratio when only width is given", () => {
      const img = nativeImage.createFromBuffer(redPng(4, 2));
      const resized = img.resize({ width: 8 });
      expect(resized.getSize()).toEqual({ width: 8, height: 4 });
    });

    test("returns the same image when no dimensions are given", () => {
      const img = nativeImage.createFromBuffer(redPng(4, 4));
      expect(img.resize({}).getSize()).toEqual({ width: 4, height: 4 });
    });
  });

  describe("crop()", () => {
    function gradientPng(w: number, h: number) {
      const { encodePNG } = require("../src/png") as typeof import("../src/png");
      const data = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = i & 0xff;
        data[i * 4 + 3] = 255;
      }
      return encodePNG({ width: w, height: h, data });
    }

    test("crops to the requested rectangle", () => {
      const img = nativeImage.createFromBuffer(gradientPng(8, 8));
      const cropped = img.crop({ x: 2, y: 2, width: 4, height: 3 });
      expect(cropped.getSize()).toEqual({ width: 4, height: 3 });
    });

    test("clamps the rectangle to the image bounds", () => {
      const img = nativeImage.createFromBuffer(gradientPng(8, 8));
      const cropped = img.crop({ x: 6, y: 6, width: 10, height: 10 });
      expect(cropped.getSize()).toEqual({ width: 2, height: 2 });
    });
  });

  describe("toDataURL()", () => {
    test("round-trips through createFromDataURL", () => {
      const original = nativeImage.createFromBuffer(Buffer.from(ONE_BY_ONE, "base64"));
      const copy = nativeImage.createFromDataURL(original.toDataURL());
      expect(copy.toPNG().equals(original.toPNG())).toBe(true);
    });
  });
});
