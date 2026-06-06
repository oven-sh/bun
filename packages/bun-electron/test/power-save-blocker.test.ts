// Ported from Electron's spec/api-power-save-blocker-spec.ts.

import { describe, expect, test } from "bun:test";
import { powerSaveBlocker } from "../src/index.ts";

describe("powerSaveBlocker module", () => {
  test("start returns an id and isStarted reflects it", () => {
    const id = powerSaveBlocker.start("prevent-app-suspension");
    expect(typeof id).toBe("number");
    expect(powerSaveBlocker.isStarted(id)).toBe(true);
    powerSaveBlocker.stop(id);
  });

  test("stop ends the blocker", () => {
    const id = powerSaveBlocker.start("prevent-display-sleep");
    expect(powerSaveBlocker.stop(id)).toBe(true);
    expect(powerSaveBlocker.isStarted(id)).toBe(false);
  });

  test("stop on an unknown id returns false", () => {
    expect(powerSaveBlocker.stop(99999)).toBe(false);
  });

  test("rejects an invalid blocker type", () => {
    // @ts-expect-error invalid type
    expect(() => powerSaveBlocker.start("prevent-nothing")).toThrow(TypeError);
  });

  test("multiple blockers have distinct ids", () => {
    const a = powerSaveBlocker.start("prevent-app-suspension");
    const b = powerSaveBlocker.start("prevent-display-sleep");
    expect(a).not.toBe(b);
    powerSaveBlocker.stop(a);
    powerSaveBlocker.stop(b);
  });
});
