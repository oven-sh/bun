import { test } from "bun:test";
test("b", async () => { const p = await import("./p.mjs"); console.log("b", String(p.v)); });
