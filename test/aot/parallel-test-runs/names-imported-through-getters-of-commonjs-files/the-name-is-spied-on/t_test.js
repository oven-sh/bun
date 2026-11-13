import { test, spyOn } from "bun:test";
test("a spy on the object of the file", () => {
  const first = require("./first.mjs");
  const spy = spyOn(require("./gauge.cjs"), "name").mockImplementation(() => "spy");
  const second = require("./second.mjs");
  console.log(first.read(), second.read(), require("./door.cjs").name(), spy.mock.calls.length);
});
