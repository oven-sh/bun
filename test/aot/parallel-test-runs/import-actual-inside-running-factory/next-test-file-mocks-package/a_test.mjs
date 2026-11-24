import { test } from "bun:test";
test("t", async () => {
  const first = await import("@made-up/kit877");
  first.bump();
  console.log("SAID a", first.count(), globalThis.runs);
}, 5000);
