import { test } from "bun:test";
import { createRequire } from "node:module";

// With a sanitizer plain Bun takes half a minute over the three, and several times that on a busy machine. The default is 5 s.
for (const under of ["plainly", "underTicksOfTheProgram", "underAnInitHook"])
  test(`the program runs inside a test, ${under}`, async () => {
    await createRequire(import.meta.url)("./program.cjs")(under);
  }, 120_000);
