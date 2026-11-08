import { test } from "bun:test";
import { createRequire } from "node:module";

// With a sanitizer plain Bun takes half a minute over the program. The default is 5 s.
test("the program runs inside a test", async () => {
  await createRequire(import.meta.url)("./program.cjs");
}, 120_000);
