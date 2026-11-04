// The factory awaits, and takes no original.
import { test, vi } from "bun:test";

vi.doMock("./rate.cjs", async () => {
  console.log("factory begins");
  await 0;
  console.log("factory goes on");
  return { rate: 2 };
});

test("the require() that came first, the next, an import, and a require() behind it", async () => {
  console.log("first", require("./rate.cjs").rate);
  await new Promise(resolve => setTimeout(resolve, 20));
  console.log("next", require("./rate.cjs").rate);
  console.log("imported", (await import("./rate.cjs")).rate);
  console.log("behind the import", require("./rate.cjs").rate);
});
