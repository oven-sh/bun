import { test } from "bun:test";
import { createRequire } from "node:module";

const load = createRequire(import.meta.dir + "/");

test("a directory path with a trailing slash is a base", () => {
  console.log(load("./src/user.cjs").describe(1));
});
