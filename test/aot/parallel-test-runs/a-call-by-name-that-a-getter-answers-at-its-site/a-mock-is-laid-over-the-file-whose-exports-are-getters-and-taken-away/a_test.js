import { test, mock, spyOn } from "bun:test";
test("calls through the getters of a file's exports follow a mock and a spy", async () => {
  const user = require("./user.cjs");
  const { through } = await import("./star.mjs");
  const look = word => console.log("SAID", word, user.held(200), user.asked(200), through(200));
  look("as written");
  mock.module("./lib.cjs", () => ({ add: (a, b) => a * b, low: a => a + 1000 }));
  look("under the mock");
  mock.module("./lib.cjs", () => ({ add: (a, b) => a - b, low: a => -a }));
  look("under the second mock");
  mock.restore();
  look("behind restore");
  const lib = require("./lib.cjs");
  const spy = spyOn(lib, "low").mockImplementation(a => a + 5);
  look("under a spy");
  console.log("SAID the spy was called", spy.mock.calls.length > 0);
  spy.mockRestore();
  look("behind the spy");
});
