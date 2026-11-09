import { mock, test } from "bun:test";

// What loads, and in which order, for a file whose import of "vitest" names "assert" beside a default name and "vi".
test("a statement with other names", async () => {
  mock.module("vitest", () => {
    console.log("vitest loads");
    return { default: "the default of the mock", vi: "the vi of the mock" };
  });
  const { value } = await import("./helper.ts");
  console.log(value);
});
