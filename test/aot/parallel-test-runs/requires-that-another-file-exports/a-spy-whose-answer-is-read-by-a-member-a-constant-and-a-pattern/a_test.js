import { spyOn, test } from "bun:test";
import * as tools from "./src/tools.js";
test("what the spy answers is read", () => {
  const before = [tools.askMember(), tools.askHeld(), tools.askPattern()].join(" ");
  const spy = spyOn(tools, "load").mockImplementation(() => ({ name: "spied" }));
  const during = [tools.askMember(), tools.askHeld(), tools.askPattern()].join(" ");
  console.log("SAID", before, "|", during, "|", spy.mock.calls.length);
});
