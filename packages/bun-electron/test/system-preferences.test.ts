// Ported from Electron's spec/api-system-preferences-spec.ts (cross-platform
// subset).

import { describe, expect, test } from "bun:test";
import { systemPreferences } from "../src/index.ts";

describe("systemPreferences module", () => {
  describe("getMediaAccessStatus", () => {
    test("returns a valid status for known media types", () => {
      for (const t of ["microphone", "camera", "screen"] as const) {
        expect(["not-determined", "granted", "denied", "restricted", "unknown"]).toContain(
          systemPreferences.getMediaAccessStatus(t),
        );
      }
    });

    test("throws on an invalid media type", () => {
      // @ts-expect-error invalid
      expect(() => systemPreferences.getMediaAccessStatus("speakers")).toThrow(TypeError);
    });
  });

  describe("getAnimationSettings", () => {
    test("returns the animation settings shape", () => {
      const s = systemPreferences.getAnimationSettings();
      expect(typeof s.shouldRenderRichAnimation).toBe("boolean");
      expect(typeof s.scrollAnimationsEnabledBySystem).toBe("boolean");
      expect(typeof s.prefersReducedMotion).toBe("boolean");
    });
  });

  describe("getColor", () => {
    test("returns a color for known names", () => {
      expect(systemPreferences.getColor("highlight")).toMatch(/^#?[0-9a-fA-F]{3,8}$/);
    });

    test("throws for unknown color names", () => {
      expect(() => systemPreferences.getColor("not-a-color")).toThrow(/Unknown color/);
    });
  });

  test("getAccentColor returns an RRGGBBAA string", () => {
    expect(systemPreferences.getAccentColor()).toMatch(/^[0-9a-fA-F]{8}$/);
  });

  test("isDarkMode returns a boolean", () => {
    expect(typeof systemPreferences.isDarkMode()).toBe("boolean");
  });
});
