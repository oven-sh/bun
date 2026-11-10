import { test } from "bun:test";

test("made up, the earlier file", async () => {
  const { shelf } = await import("./shelf.mjs");
  console.log("SAID earlier " + shelf());
});
