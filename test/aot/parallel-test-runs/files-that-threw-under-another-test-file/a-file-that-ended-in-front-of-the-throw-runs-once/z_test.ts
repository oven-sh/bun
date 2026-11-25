import { test } from "bun:test";
test("the run goes on", () => { console.log("runs in all", (globalThis as any).gaugeRuns, (globalThis as any).steadyRuns); });
