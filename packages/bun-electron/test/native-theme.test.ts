// Ported from Electron's spec/api-native-theme-spec.ts (themeSource subset).

import { afterEach, describe, expect, test } from "bun:test";
import { nativeTheme } from "../src/index.ts";

afterEach(() => {
  nativeTheme.themeSource = "system";
  nativeTheme.removeAllListeners("updated");
});

describe("nativeTheme module", () => {
  test("defaults to system theme source", () => {
    expect(nativeTheme.themeSource).toBe("system");
  });

  test("themeSource 'dark' makes shouldUseDarkColors true", () => {
    nativeTheme.themeSource = "dark";
    expect(nativeTheme.shouldUseDarkColors).toBe(true);
  });

  test("themeSource 'light' makes shouldUseDarkColors false", () => {
    nativeTheme.themeSource = "light";
    expect(nativeTheme.shouldUseDarkColors).toBe(false);
  });

  test("emits 'updated' when themeSource changes", () => {
    let updated = 0;
    nativeTheme.on("updated", () => updated++);
    nativeTheme.themeSource = "dark";
    expect(updated).toBeGreaterThanOrEqual(1);
  });

  test("rejects an invalid themeSource", () => {
    expect(() => {
      // @ts-expect-error invalid value
      nativeTheme.themeSource = "rainbow";
    }).toThrow(TypeError);
  });

  test("exposes high-contrast / inverted getters", () => {
    expect(typeof nativeTheme.shouldUseHighContrastColors).toBe("boolean");
    expect(typeof nativeTheme.shouldUseInvertedColorScheme).toBe("boolean");
  });
});
