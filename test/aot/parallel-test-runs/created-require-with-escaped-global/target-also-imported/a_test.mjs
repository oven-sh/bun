import { test } from "bun:test";
import { createRequire } from "node:module";
import user from "./src/user.cjs";

const load = createRequire(import.meta.url);

test("both ways give one module", () => {
  console.log(load("./src/user.cjs").describe(1), load("./src/user.cjs") === user);
});
