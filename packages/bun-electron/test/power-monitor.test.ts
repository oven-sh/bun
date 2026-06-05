// Ported from Electron's spec/api-power-monitor-spec.ts (query + event API
// subset; real power transitions can't be triggered in CI).

import { describe, expect, test } from "bun:test";
import { powerMonitor } from "../src/index.ts";

describe("powerMonitor module", () => {
  test("getSystemIdleState returns a valid state", () => {
    const state = powerMonitor.getSystemIdleState(60);
    expect(["active", "idle", "locked", "unknown"]).toContain(state);
  });

  test("getSystemIdleState validates its argument", () => {
    expect(() => powerMonitor.getSystemIdleState(-1)).toThrow(TypeError);
    expect(() => powerMonitor.getSystemIdleState("x" as never)).toThrow(TypeError);
  });

  test("getSystemIdleTime returns a number", () => {
    expect(typeof powerMonitor.getSystemIdleTime()).toBe("number");
  });

  test("onBatteryPower / isOnBatteryPower agree", () => {
    expect(typeof powerMonitor.isOnBatteryPower()).toBe("boolean");
    expect(powerMonitor.onBatteryPower).toBe(powerMonitor.isOnBatteryPower());
  });

  test("getCurrentThermalState returns a valid value", () => {
    expect(["unknown", "nominal", "fair", "serious", "critical"]).toContain(
      powerMonitor.getCurrentThermalState(),
    );
  });

  test("supports power-event listeners", () => {
    let suspended = false;
    powerMonitor.on("suspend", () => (suspended = true));
    powerMonitor._emit("suspend");
    expect(suspended).toBe(true);
    powerMonitor.removeAllListeners("suspend");
  });
});
