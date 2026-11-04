import { mock } from "bun:test";
mock.module("./m", () => ({ v: "preload" }));
const { held } = await import("./held.cjs");
(globalThis as any).held = held;
