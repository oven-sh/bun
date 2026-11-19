import { test, vi } from "bun:test";
const keys = space => Object.keys(space).filter(key => key !== "default").sort().join();
const say = (...words) => console.log("SAID", ...words, globalThis.runs ?? 0);
test("one", async () => { vi.doUnmock("./gauge.mjs"); say("porch", keys(await import("./porch.js"))); });
