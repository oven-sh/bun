import { spyOn, test } from "bun:test";
import * as barrel from "./src/barrel.mjs";
import { use } from "./src/user.mjs";
import { useName } from "./src/byname.mjs";
test("a spy through a barrel", () => {
  console.log("SAID before", use(1), "|", useName(1));
  let said = "laid", spy;
  try { spy = spyOn(barrel, "grind").mockReturnValue("spied"); } catch (e) { said = e.name + " " + e.message.split(" of ")[0]; }
  console.log("SAID", said, "| off the object:", use(1), "| by name:", useName(1), "| calls:", spy ? spy.mock.calls.length : -1);
  spy?.mockRestore();
  console.log("SAID after", use(1), "|", useName(1));
});
