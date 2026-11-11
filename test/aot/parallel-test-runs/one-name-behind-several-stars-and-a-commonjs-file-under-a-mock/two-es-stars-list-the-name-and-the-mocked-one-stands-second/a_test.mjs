import { test, mock } from "bun:test";
test("under the mock", async () => {
  mock.module("./shapes.mjs", () => ({ round: 10, square: 20 }));
  const wide = await import("./wide.mjs");
  console.log("SAID", Object.keys(wide).sort().join(), wide.round);
  let said;
  try { said = (await import("./reader.mjs")).said(); } catch (error) { said = error.name; }
  console.log("SAID", said);
});
