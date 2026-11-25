import { test } from "bun:test";
test("one", () => { console.log("SAID", globalThis.runs ?? 0); });
