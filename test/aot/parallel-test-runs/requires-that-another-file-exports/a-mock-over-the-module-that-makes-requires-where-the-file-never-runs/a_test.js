import { mock, test } from "bun:test";
mock.module("node:module", () => ({ createRequire: () => () => ({ name: "made by the mock" }) }));
test("what the mock's require answers is read", async () => {
  const { askMember } = await import("./src/tools.js");
  let said;
  try { said = askMember(); } catch (e) { said = "threw " + e.name; }
  console.log("SAID", said);
});
