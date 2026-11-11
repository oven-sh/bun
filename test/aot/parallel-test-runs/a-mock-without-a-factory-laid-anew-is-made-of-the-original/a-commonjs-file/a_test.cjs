const { jest, test } = require("bun:test");
require("./valve.cjs");
test("the two", () => {
  jest.mock("./valve.cjs");
  const first = require("./valve.cjs").open;
  first();
  jest.mock("./valve.cjs");
  const second = require("./valve.cjs").open;
  second();
  console.log("SAID", first === second, first.mock.calls.length, second.mock.calls.length);
});
