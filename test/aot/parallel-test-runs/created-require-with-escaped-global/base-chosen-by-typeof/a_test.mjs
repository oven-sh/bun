import { test } from "bun:test";
import { createRequire } from "node:module";

const load = createRequire(typeof __filename === "string" ? __filename : import.meta.url);

test("either name of the file is a base", () => {
  console.log(load("./src/user.cjs").describe(1));
});
