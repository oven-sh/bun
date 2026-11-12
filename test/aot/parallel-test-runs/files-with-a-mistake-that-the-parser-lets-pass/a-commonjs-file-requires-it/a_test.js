import { test } from "bun:test";
test("nothing of the graph runs", async () => {
  globalThis.ran = [];
  let outcome = "loaded";
  try {
    await import("./panel.cjs");
  } catch (error) {
    outcome = error.name;
  }
  console.log(outcome, "|", globalThis.ran.join() || "nothing ran");
});
