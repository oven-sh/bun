import { spyOn, test } from "bun:test";
import * as tools from "./src/tools.js";
test("the spy answers", () => {
  const before = tools.ask();
  const spy = spyOn(tools, "load").mockImplementation(() => "spied");
  console.log("SAID", before, "|", tools.ask(), "|", spy.mock.calls.length);
});
