import { spyOn, test } from "bun:test";
import * as barrel from "./src/barrel.mjs";
import { useOld } from "./src/old.cjs";
test("a spy through a barrel", () => {
  console.log("SAID before", useOld(1), "|", barrel.twice(1));
  let said = "laid", spy;
  try { spy = spyOn(barrel, "grind").mockReturnValue("spied"); } catch (e) { said = e.name + " " + e.message.split(" of ")[0]; }
  console.log("SAID", said, "| require:", useOld(1), "| the file's own calls:", barrel.twice(1), "| calls:", spy ? spy.mock.calls.length : -1);
  spy?.mockRestore();
  console.log("SAID after", useOld(1), "|", barrel.twice(1));
});
