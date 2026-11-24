import { jest, test } from "bun:test";
test("t", () => {
  require("./config.cjs");
  jest.doMock("./reader.mjs", () => ({ look: () => "mocked" }));
  console.log("SAID", jest.requireActual("./reader.mjs").look(), require("./reader.mjs").look());
});
