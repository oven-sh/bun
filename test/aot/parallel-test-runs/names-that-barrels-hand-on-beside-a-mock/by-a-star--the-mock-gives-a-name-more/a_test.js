import { test, mock } from "bun:test";
mock.module("./m.mjs", () => ({ v: "mocked", extra: "more" }));
test("a", async () => { const p = await import("./p.mjs"); console.log("a", String(p.v), String(p.extra), Object.keys(p).join()); });
