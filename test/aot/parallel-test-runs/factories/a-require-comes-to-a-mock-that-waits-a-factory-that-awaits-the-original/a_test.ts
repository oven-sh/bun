// A require() cannot wait for a factory that awaits, so it does not call it: it answers the original, whose body runs now, and the mock waits for an import.
import { test, vi } from "bun:test";

vi.doMock("./rate.cjs", async importOriginal => {
  console.log("factory begins");
  const original = await importOriginal();
  console.log("factory has", original.rate);
  return { ...original, rate: 2 };
});

test("the require() that came first, the next, an import, and a require() behind it", async () => {
  console.log("first", require("./rate.cjs").rate);
  await new Promise(resolve => setTimeout(resolve, 20));
  console.log("next", require("./rate.cjs").rate);
  console.log("imported", (await import("./rate.cjs")).rate);
  console.log("behind the import", require("./rate.cjs").rate);
});
