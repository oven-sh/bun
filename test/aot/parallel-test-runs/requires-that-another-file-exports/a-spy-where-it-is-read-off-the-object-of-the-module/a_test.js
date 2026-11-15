import { spyOn, test } from "bun:test";
import * as maker from "./maker.js";
import { askWhole, askShort } from "./asks.js";
test("the spy answers", () => {
  const spy = spyOn(maker, "load").mockImplementation(() => "spied");
  console.log("SAID", askWhole(), "|", askShort(), "|", spy.mock.calls.length);
  spy.mockRestore();
  console.log("SAID", askWhole(), "|", askShort());
});
