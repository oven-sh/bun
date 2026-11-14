import { test } from "bun:test";
const found = await import("./slow.mjs");
test("the second", () => console.log("SAID b", found.value, globalThis.order.join(" ")));
