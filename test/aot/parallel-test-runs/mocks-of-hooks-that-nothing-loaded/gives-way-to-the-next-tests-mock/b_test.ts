import { test } from "bun:test";

test("the tide", async () => {
  console.log("b:", (await import("./tide.cjs")).height());
  console.log("b:", (await import("./harbor.ts")).report());
});
