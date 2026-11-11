import { test } from "bun:test";
test("whose require", async () => {
  const { askOwn } = await import("./src/maker.js");
  const { askOther } = await import("./src/asks.js");
  console.log("SAID", askOwn() + " | " + askOther());
});
