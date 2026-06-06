// Ported from Electron's spec/api-desktop-capturer-spec.ts (getSources shape).

import { beforeAll, describe, expect, test } from "bun:test";
import { desktopCapturer } from "../src/index.ts";
import { ensureReady } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

describe("desktopCapturer module", () => {
  test("getSources({ types: ['screen'] }) returns screen sources", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    expect(sources.length).toBeGreaterThanOrEqual(1);
    for (const source of sources) {
      expect(typeof source.id).toBe("string");
      expect(source.id).toStartWith("screen:");
      expect(typeof source.name).toBe("string");
      expect(typeof source.display_id).toBe("string");
      expect(source.thumbnail.isEmpty()).toBe(true);
    }
  });

  test("getSources({ types: [] }) returns no sources", async () => {
    const sources = await desktopCapturer.getSources({ types: [] });
    expect(sources).toEqual([]);
  });

  test("throws when options.types is missing", async () => {
    await expect(desktopCapturer.getSources({} as never)).rejects.toThrow(/types must be an array/);
  });
});
