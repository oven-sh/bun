import { mock, test } from "bun:test";

// What loads, and in which order, for a file that imports "assert" and "should" from "vitest" and nothing else from it.
test("a statement with the names of chai alone", async () => {
  mock.module("vitest", () => {
    console.log("vitest loads");
    return { vi: "the vi of the mock" };
  });
  const { value } = await import("./helper.ts");
  console.log(value);
});
