import { test } from "bun:test";
import { createRequire } from "node:module";

let load = createRequire(new URL("./a/", import.meta.url));
const other = createRequire(new URL("./b/", import.meta.url));

test("the require stored last decides the folder", () => {
  console.log(load("./one.cjs").word);
  load = other;
  console.log(load("./one.cjs").word);
});
