import { test } from "bun:test";
test("one", async () => { const old = await import("./porch.js"); const fresh = await import("./yard.js"); console.log("SAID", globalThis.runs ?? 0, Object.keys(old).sort().join(), Object.keys(fresh).sort().join()); });
