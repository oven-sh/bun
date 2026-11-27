import { test } from "bun:test";
test("t", async () => {
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.name; }
  console.log("SAID", said);
});
