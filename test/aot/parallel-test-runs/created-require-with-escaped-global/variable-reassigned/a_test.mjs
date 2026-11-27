import { test } from "bun:test";
import { createRequire } from "node:module";

let load = createRequire(import.meta.url);

test("another function stored in the variable is called", () => {
  console.log(load("./src/user.cjs").describe(1));
  load = name => ({ describe: () => "other function got " + name });
  console.log(load("./src/user.cjs").describe(1));
});
