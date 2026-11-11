// plain.cjs says nothing of CommonJS, and real.cjs, which runs while the graph is loaded, may require it: it has its turn among the modules. No module has a turn where a name is missing.
import { test } from "bun:test";
test("the graph fails for the name", async () => {
  try {
    await import("./top.mjs");
  } catch (error) {
    console.log(error.constructor.name);
  }
  console.log("the test ends");
});
