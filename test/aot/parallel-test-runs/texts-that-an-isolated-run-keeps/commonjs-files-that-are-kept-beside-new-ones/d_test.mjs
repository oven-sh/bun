import { test } from "bun:test";
await import("./mixed.mjs");
test("below one call", () => console.log(order.join()));
