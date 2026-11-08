import { test } from "bun:test";
import { createRequire } from "node:module";

test("the program runs inside a test", async () => {
  await createRequire(import.meta.url)("./program.cjs");
});
