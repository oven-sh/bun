import { test } from "bun:test";
globalThis.floating = import("./slow.mjs");
test("the first", () => console.log("SAID a", typeof globalThis.floating));
