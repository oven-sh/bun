import { test } from "bun:test";
test("what has run stays as it is", async () => {
  globalThis.ran = [];
  await import("./lamp.mjs");
  let outcome = "loaded";
  try {
    await import("./panel.mjs");
  } catch (error) {
    outcome = error.name;
  }
  console.log(outcome, "|", globalThis.ran.join() || "nothing ran");
});
