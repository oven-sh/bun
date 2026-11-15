import { test, mock } from "bun:test";
mock.module("./m.mjs", () => ({ v: "mocked" }));
test("a", async () => { const p = await import("./p.mjs"); const named = await import("./named.mjs"); console.log("a", String(p.w), named.seen()); });
