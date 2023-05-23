// Hardcoded module "node:perf_hooks"
import { throwNotImplemented } from "../shared";

export var performance = globalThis.performance;

export class PerformanceObserver {
  constructor() {
    throwNotImplemented("PerformanceObserver");
  }
}

export class PerformanceEntry {
  constructor() {
    throwNotImplemented("PerformanceEntry");
  }
}
export class PerformanceNodeTiming {
  constructor() {
    throw new Error("PerformanceNodeTiming is not supported in this environment.");
  }
}

export default {
  performance,
  PerformanceEntry,
  PerformanceNodeTiming,
  [Symbol.for("CommonJS")]: 0,
};
