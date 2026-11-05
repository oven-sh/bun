import { test, mock } from "bun:test";
mock.module("./n.mjs", () => ({ v: "of n" }));
test("b", async () => { const p = await import("./p.mjs"); console.log("b", String(p.v), Object.keys(p).join()); });
