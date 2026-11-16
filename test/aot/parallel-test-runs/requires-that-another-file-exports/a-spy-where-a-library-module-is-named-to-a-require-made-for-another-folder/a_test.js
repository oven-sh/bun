import { spyOn, test } from "bun:test";
import * as maker from "./src/maker.js";
import { askOther } from "./src/asks.js";
test("the spy answers", () => {
  const spy = spyOn(maker, "load").mockImplementation(() => ({ sep: "spied" }));
  console.log("SAID", maker.askOwn(), askOther(), "|", spy.mock.calls.length);
});
