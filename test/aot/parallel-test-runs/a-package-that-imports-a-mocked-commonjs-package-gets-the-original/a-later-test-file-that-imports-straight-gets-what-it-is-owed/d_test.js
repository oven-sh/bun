import { test, vi } from "bun:test";

test("t", async () => {
  const { own } = await import("./own2.mjs");
  console.log("SAID d", own(), String(globalThis.order2.filter(it => !it.startsWith("own"))));
});
