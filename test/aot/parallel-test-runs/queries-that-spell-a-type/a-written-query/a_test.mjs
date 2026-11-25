import { test } from "bun:test";
import text from "./part.mjs" with { type: "text" };
test("a file under a query beside its text", async () => {
  const copy = await import("./part.mjs?text");
  console.log(typeof text, text.length, typeof copy.default, copy.value);
});
