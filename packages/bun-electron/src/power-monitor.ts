// powerMonitor — Electron-compatible power/idle state.
//
// Real idle detection and power events require an OS power API that CEF does
// not expose, so idle queries report an active, plugged-in system and the
// power/idle events can be driven programmatically (via _emit) for app logic
// and tests.

import { EventEmitter } from "node:events";

type IdleState = "active" | "idle" | "locked" | "unknown";

class PowerMonitor extends EventEmitter {
  getSystemIdleState(idleThreshold: number): IdleState {
    if (typeof idleThreshold !== "number" || idleThreshold < 0) {
      throw new TypeError("idleThreshold must be a non-negative number");
    }
    return "active";
  }

  getSystemIdleTime(): number {
    return 0;
  }

  isOnBatteryPower(): boolean {
    return false;
  }

  get onBatteryPower(): boolean {
    return this.isOnBatteryPower();
  }

  getCurrentThermalState(): "unknown" | "nominal" | "fair" | "serious" | "critical" {
    return "nominal";
  }

  /** @internal Drive a power event (no real OS hook). */
  _emit(event: string, ...args: unknown[]): void {
    this.emit(event, ...args);
  }
}

export const powerMonitor = new PowerMonitor();
