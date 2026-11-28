// plain.cjs says nothing of CommonJS, and real.cjs may require it. Both run before the names are checked.
import { test } from "bun:test";
test("the graph fails for the name", async () => {
  try {
    await import("./top.mjs");
  } catch (error) {
    console.log(error.constructor.name);
  }
  console.log("the test ends");
});
