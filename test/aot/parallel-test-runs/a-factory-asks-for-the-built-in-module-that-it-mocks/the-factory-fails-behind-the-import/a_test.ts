import { test, mock } from "bun:test";
mock.module("node:path", async () => { const original = await import("node:path"); throw new RangeError("no " + typeof original.join); });
test("a", async () => { try { await import("node:path"); console.log("a loaded"); } catch (e: any) { console.log("a", e.constructor.name, e.message); } });
