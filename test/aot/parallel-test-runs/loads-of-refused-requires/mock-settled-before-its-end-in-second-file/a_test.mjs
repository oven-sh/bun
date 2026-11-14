import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const say = (...all) => console.log("SAID", globalThis.runs, ...all);
test("t", async () => say("earlier", (await import("./star.mjs")).word));
