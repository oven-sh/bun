// A factory that never settles holds the import() that came to it, and no test: the run ends, with no word of a factory that never settled.
import { expect, mock, test } from "bun:test";

mock.module("./late", () => new Promise(() => {}));
let hasSettled = false;
void import("./late").finally(() => {
  hasSettled = true;
});

test("runs", async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  console.log("the import has settled", hasSettled);
  expect(hasSettled).toBe(false);
});
