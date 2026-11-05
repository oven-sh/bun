import { test, mock } from "bun:test";
mock.module("./m.mjs", () => ({ v: "mocked" }));
test("a", async () => { const p = await import("./p.mjs"); console.log("a", String(p.v), Object.keys(p).join()); });
