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

  describe("toDataURL()", () => {
    test("round-trips through createFromDataURL", () => {
      const original = nativeImage.createFromBuffer(Buffer.from(ONE_BY_ONE, "base64"));
      const copy = nativeImage.createFromDataURL(original.toDataURL());
      expect(copy.toPNG().equals(original.toPNG())).toBe(true);
    });
  });
});
