import { spyOn, test } from "bun:test";
import * as tools from "./tools.js";
test("the spy answers", () => {
  const spy = spyOn(tools, "load").mockImplementation(() => "spied");
  console.log("SAID", tools.ask(), "|", spy.mock.calls.length);
});
