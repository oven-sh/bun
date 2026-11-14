import { test, mock } from "bun:test";
test("t", async () => {
  let said;
  try {
    const top = await import("./top.mjs");
    said = typeof top.round + " " + Object.keys(top).join();
  } catch (error) {
    said = error.name + ": " + error.message.replace(/'[^']*\//, "'");
  }
  console.log("SAID top", said);
  mock.module("./other.mjs", () => ({ round: 3, far: 4 }));
});
