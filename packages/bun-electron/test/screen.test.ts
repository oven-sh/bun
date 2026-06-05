// Ported from Electron's spec/api-screen-spec.ts (display metadata subset).

import { beforeAll, describe, expect, test } from "bun:test";
import { screen } from "../src/index.ts";
import { ensureReady } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

describe("screen module", () => {
  describe("screen.getPrimaryDisplay()", () => {
    test("returns a display object with size and bounds", () => {
      const display = screen.getPrimaryDisplay();
      expect(display.bounds.width).toBeGreaterThan(0);
      expect(display.bounds.height).toBeGreaterThan(0);
      expect(display.workArea.width).toBeGreaterThan(0);
      expect(display.scaleFactor).toBeGreaterThan(0);
      expect(typeof display.id).toBe("number");
    });
  });

  describe("screen.getAllDisplays()", () => {
    test("returns at least one display including the primary one", () => {
      const displays = screen.getAllDisplays();
      expect(displays.length).toBeGreaterThanOrEqual(1);
      const primary = screen.getPrimaryDisplay();
      expect(displays.some((d) => d.id === primary.id)).toBe(true);
    });
  });
});
