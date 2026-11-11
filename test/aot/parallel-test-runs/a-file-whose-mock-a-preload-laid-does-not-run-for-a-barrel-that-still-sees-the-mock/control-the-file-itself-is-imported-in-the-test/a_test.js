import { test } from "bun:test";
test("one", async () => { const old = await import("./porch.js"); const itself = await import("./gauge.mjs"); console.log("SAID", globalThis.runs ?? 0, Object.keys(old).sort().join(), Object.keys(itself).sort().join()); });
