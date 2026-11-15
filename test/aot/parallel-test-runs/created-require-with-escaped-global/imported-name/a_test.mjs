import { test } from "bun:test";
import { createRequire } from "node:module";

const load = createRequire(import.meta.url);

test("the file loads once and is cached", () => {
  console.log(load("./src/user.cjs").describe(1));
  console.log(load("./src/user.cjs").describe("a"), load("./src/user.cjs") === load("./src/user.cjs"));
});
