import { test } from "bun:test";
test("a", () => {
  globalThis.heldByEarlierFile = require("./part.cjs");
  console.log(`SAID a ${globalThis.heldByEarlierFile.a} ${globalThis.runsOfPart}`);
});
