import { spyOn, test } from "bun:test";
import * as barrel from "./src/barrel.mjs";
import { use } from "./src/user.mjs";
import { useOld } from "./src/old.cjs";
test("the default of a marked file, through a barrel", () => {
  console.log("SAID before", use(1), "|", useOld(1));
  let said = "laid", spy;
  try { spy = spyOn(barrel, "grind").mockReturnValue("spied"); } catch (e) { said = e.name + " " + e.message.split(" of ")[0]; }
  console.log("SAID", said, "| import:", use(1), "| require:", useOld(1), "| calls:", spy ? spy.mock.calls.length : -1);
  spy?.mockRestore();
  console.log("SAID after", use(1), "|", useOld(1));
});
