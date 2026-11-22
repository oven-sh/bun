import { test } from "bun:test";
import { createRequire } from "node:module";

const load = createRequire(new URL("./src/", import.meta.url));

test("the URL of a folder is a base", () => {
  console.log(load("./user.cjs").describe(1));
});
