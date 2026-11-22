import { test, mock } from "bun:test";
test("t", async () => {
  let said;
  try {
    said = (await import("./user.mjs")).seen;
  } catch (error) {
    said = error.name + ": " + error.message.replace(/'[^']*\//, "'");
  }
  console.log("SAID round", said);
  mock.module("./other.mjs", () => ({ round: 3, far: 4 }));
});
