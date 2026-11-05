import { test, mock } from "bun:test";
mock.module("./m.mjs", () => ({ v: "mocked", other: "mocked other" }));
test("a", async () => { const p = await import("./p.mjs"); console.log("a", String(p.v), String(p.said), Object.keys(p).join()); });
