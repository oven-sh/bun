import { spyOn, test } from "bun:test";
import * as maker from "./maker.js";
import { askWritten, askChosen } from "./asks.js";
test("the spy answers", () => {
  const spy = spyOn(maker, "load").mockImplementation(() => ({ sep: 7 }));
  console.log("SAID", askWritten(), "|", askChosen(), "|", spy.mock.calls.length);
});
