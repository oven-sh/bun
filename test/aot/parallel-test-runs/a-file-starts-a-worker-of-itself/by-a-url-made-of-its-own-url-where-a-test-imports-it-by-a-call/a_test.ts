// A file that a test imports is no entry point of the run. In a test run the build does not know the text of import.meta.url: it goes by what the Worker is given.
import { test } from "bun:test";

test("the program", async () => {
  await import("./program.ts");
});
