import { test } from "bun:test";
import it, { a } from "./part.cjs";
test("t", async () => {
  const helper = await import("./helper.mjs");
  console.log("SAID", a, it.a, helper.read(), require.resolve("./part.cjs") in require.cache);
});
