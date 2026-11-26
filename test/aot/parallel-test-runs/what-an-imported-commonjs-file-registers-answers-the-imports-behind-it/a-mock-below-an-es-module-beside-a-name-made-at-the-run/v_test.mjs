import { test } from "bun:test";
test("v", async () => {
  if (!globalThis.never) return;
  await import(globalThis.never);
  delete require.cache[globalThis.never];
});
