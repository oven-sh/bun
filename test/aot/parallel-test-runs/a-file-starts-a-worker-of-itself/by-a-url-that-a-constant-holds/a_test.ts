import { test } from "bun:test";
import { run } from "./program.ts";

test("the program", async () => {
  await run();
});
